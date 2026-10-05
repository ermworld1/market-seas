import type { Phase } from "@/lib/battle/phase";
import { BANK, CAT_FOLDER, bankUrls, type BankFolder } from "./bank";
import { chainText, type VoiceChain, type VoiceChannel, type VoicePart } from "./navalVoice";

/**
 * Web Audio engine: one master gain, per-category buses, stereo panning by
 * screen x, max 8 simultaneous one-shots with priority. Recorded CC0 files
 * live in /sfx/<folder>/<n>.mp3 (see bank.ts); missing files fall back to procedural synths.
 */
export type SfxCat = "mg" | "gun" | "gun5" | "miss" | "torpedo" | "broadside" | "fighter" | "flak" | "dive" | "fled" | "surface" | "sink" | "reinforce" | "liquidation" | "cascade" | "hit" | "klaxon" | "bosun";
export const SFX: SfxCat[] = ["mg", "gun", "gun5", "miss", "torpedo", "broadside", "fighter", "flak", "dive", "fled", "surface", "sink", "reinforce", "liquidation", "cascade", "hit", "klaxon", "bosun"];
const PRIORITY: Record<SfxCat, number> = { mg: 1, reinforce: 2, hit: 2, miss: 2, gun: 3, gun5: 5, surface: 4, torpedo: 6, dive: 6, fighter: 7, flak: 5, fled: 7, sink: 7, liquidation: 8, broadside: 8, cascade: 9, klaxon: 9, bosun: 5 };
const BUS: Record<SfxCat, "weapons" | "ships" | "air" | "alarms"> = {
  mg: "weapons", hit: "weapons", miss: "weapons", gun: "weapons", gun5: "weapons", torpedo: "weapons", broadside: "weapons",
  fighter: "air", flak: "air", liquidation: "air",
  dive: "alarms", fled: "alarms", cascade: "alarms", klaxon: "alarms", bosun: "alarms",
  surface: "ships", sink: "ships", reinforce: "ships",
};
const MAX_VOICES = 12;
/** Voice lines are recorded files in /public/vo. There is deliberately no TTS path. */
export const VO_FILES: Record<string, string> = { P3: "p3_fire", P4: "capital", P5: "p5_brace", P6push: "p6_push", P6fall: "p6_fallback", P7: "p7_ceasefire", torpedo: "torpedo", dive: "dive", surface: "surface", flagsunk: "flagsunk", liq: "bombers", radiocheck: "cap_stations", flaghit: "p3_fire", fighter: "p3_fire", start: "cap_stations", warn: "cap_holdline", end: "p7_ceasefire", capital: "capital", cap_commence: "cap_commence", cap_holdline: "cap_holdline", cap_stations: "cap_stations", adm_openfire: "adm_openfire", adm_break: "adm_break", adm_withdraw: "adm_withdraw", spot_hit: "spot_hit", spot_aircraft: "spot_aircraft", spot_sonar: "spot_sonar", spot_fire: "spot_fire", spot_breaking: "spot_breaking" };
const VO_COOLDOWN = 6;
const VARIANTS = 6;
const LAYERS = ["sea", "drone", "drums", "brass", "choir"] as const;
type Layer = (typeof LAYERS)[number];

interface Voice {
  pri: number;
  end: number;
  stop: () => void;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buses: Record<string, GainNode> = {};
  music: GainNode | null = null;
  layerGain: Partial<Record<Layer, GainNode>> = {};
  samples = new Map<string, AudioBuffer | null>();
  voices: Voice[] = [];
  enabled = false;
  volume = 0.7;
  phase: Phase | "P0" = "P0";
  played = 0;
  dropped = 0;
  byCat: Record<string, number> = {};
  voPlayed: string[] = [];
  voByCharacter: Record<string, number> = { captain: 0, admiral: 0, spotter: 0 };
  voBusyUntil = 0;
  /** distinct procedural variants played per category */
  variants: Record<string, number[]> = {};
  ambience = { pops: 0, booms: 0, horns: 0, chatter: 0, active: false };
  intensity = 0;
  private lastVariant: Record<string, number> = {};
  private reverb: ConvolverNode | null = null;
  private ambTimer: ReturnType<typeof setInterval> | null = null;
  private siren: { stop: () => void } | null = null;
  private battleBed: { s: AudioBufferSourceNode; g: GainNode } | null = null;
  private pending: { key: string; text: string; at: number } | null = null;
  private navalQueue: VoiceChain[] = [];
  private navalBusy = false;
  voiceChainLog: Array<{ at: number; id: string; role: string; channel: VoiceChannel; clips: string[]; text: string; played: boolean }> = [];
  private radioChecked = false;
  private lastVoiceAt = -1e9;
  private lastTorpedoVoice = 0;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private drumTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  recordDest: MediaStreamAudioDestinationNode | null = null;

  /** Must be called from a user gesture (phones). */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      // glue + loudness so dense firefights stay audible on phone speakers
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.ratio.value = 6;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.15;
      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);
      this.recordDest = ctx.createMediaStreamDestination();
      this.comp.connect(this.recordDest);
      for (const b of ["weapons", "ships", "air", "alarms", "vo"]) {
        const g = ctx.createGain();
        g.gain.value = b === "weapons" ? 0.9 : b === "vo" ? 1.58 : 0.8;
        g.connect(this.master);
        this.buses[b] = g;
      }
      this.music = ctx.createGain();
      this.music.gain.value = 0.45;
      this.music.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // shared reverb (generated impulse) for the battle space
      this.reverb = ctx.createConvolver();
      const ir = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d2 = ir.getChannelData(c); for (let i = 0; i < d2.length; i++) d2[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d2.length, 3.2); }
      this.reverb.buffer = ir;
      const rg = ctx.createGain(); rg.gain.value = 0.5;
      this.reverb.connect(rg).connect(this.master);
      for (const b of ["amb", "chatter"]) { const g = ctx.createGain(); g.gain.value = b === "amb" ? 0.7 : 0.5; g.connect(this.master); this.buses[b] = g; }
      void this.loadSlots();
      this.startMusic();
      this.startAmbience();
    }
    // iOS needs a silent buffer started inside the gesture
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, 22050);
    s.connect(this.ctx.destination);
    s.start();
    await this.ctx.resume();
  }
  get state() {
    return this.ctx?.state ?? "none";
  }

  private async loadSlots() {
    const ctx = this.ctx!;
    const load = async (key: string, url: string) => {
      try {
        const r = await fetch(url);
        const type = r.headers.get("content-type") ?? "";
        if (!r.ok || type.includes("html")) throw new Error("missing");
        this.samples.set(key, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch {
        this.samples.set(key, null);
      }
    };
    // music stems are optional: only layers listed in /music/manifest.json are fetched (no 404 noise)
    let stems: string[] = [];
    try {
      const m = await fetch("/music/manifest.json");
      if (m.ok) stems = ((await m.json()) as { layers?: string[] }).layers ?? [];
    } catch {
      stems = [];
    }
    await Promise.all([
      ...(Object.keys(BANK) as BankFolder[]).flatMap((f) => bankUrls(f).map((u, i) => load(`${f}/${i + 1}`, u))),
      ...LAYERS.filter((l) => stems.includes(l)).map((l) => load("music:" + l, `/music/${l}.mp3`)),
    ]);
    // swap procedural layers for stems when present
    for (const l of LAYERS) {
      const buf = this.samples.get("music:" + l);
      const g = this.layerGain[l];
      if (buf && g && this.ctx) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(g);
        src.start();
        (g as GainNode & { stem?: boolean }).stem = true;
      }
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyVolume();
    if (on) void this.runNavalQueue();
  }
  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }
  private applyVolume() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  /**
   * One-shot with variety: random variant (never the same twice in a row), pitch ±10 %,
   * gain ±3 dB, pan from x, distance low-pass + delay + reverb send for far shots.
   */
  play(cat: SfxCat, opts: { x?: number; xEnd?: number; panSeconds?: number; gain?: number; shots?: number; dist?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    if (ctx.state !== "running") {
      void ctx.resume();
      return;
    }
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    const pri = PRIORITY[cat];
    if (this.voices.length >= MAX_VOICES) {
      let low = 0;
      for (let i = 1; i < this.voices.length; i++) {
        const v = this.voices[i]!, l = this.voices[low]!;
        if (v.pri < l.pri || (v.pri === l.pri && v.end < l.end)) low = i; // steal oldest of lowest priority
      }
      // gunfire always sounds: weapons steal the weakest voice; others need higher priority
      if (BUS[cat] !== "weapons" && this.voices[low]!.pri > pri) {
        this.dropped++;
        return;
      }
      this.voices[low]!.stop();
      this.voices.splice(low, 1);
    }
    const bufs = this.bank(CAT_FOLDER[cat]);
    const nv = bufs.length || VARIANTS;
    let v = Math.floor(Math.random() * nv);
    if (nv > 1 && v === this.lastVariant[cat]) v = (v + 1 + Math.floor(Math.random() * (nv - 1))) % nv;
    this.lastVariant[cat] = v;
    const seen = (this.variants[cat] ??= []);
    if (!seen.includes(v)) seen.push(v);
    const pitch = 0.9 + Math.random() * 0.2;
    const dist = Math.max(0, Math.min(1, opts.dist ?? Math.abs(opts.x ?? 0) * 0.5));
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, opts.x ?? 0));
    if (opts.xEnd != null) {
      pan.pan.setValueAtTime(pan.pan.value, now);
      pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, opts.xEnd)), now + (opts.panSeconds ?? 2.5));
    }
    const out = ctx.createGain();
    out.gain.value = (opts.gain ?? 1) * Math.pow(10, (Math.random() * 6 - 3) / 20) * (1 - dist * 0.45);
    const lp = this.filt("lowpass", 16000 - dist * 13500, 0.5);
    const delay = ctx.createDelay(0.7);
    const isGun = BUS[cat] === "weapons" && cat !== "hit" && cat !== "miss";
    delay.delayTime.value = isGun && dist > 0.35 ? 0.2 + dist * 0.4 : dist * 0.14;
    out.connect(lp).connect(delay).connect(pan);
    pan.connect(this.buses[BUS[cat]]!);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.08 + dist * 0.35 + (v % 3) * 0.05;
      pan.connect(send).connect(this.reverb);
    }
    const nodes: AudioScheduledSourceNode[] = [];
    const buf = bufs[v] ?? null;
    let dur: number;
    if (buf) {
      this.recorded[cat] = (this.recorded[cat] ?? 0) + 1;
      if (cat === "mg") this.oneShot("casing", now + buf.duration / pitch + 0.08, out, nodes, 0.35);
      if (cat === "liquidation") this.synth("liquidation", out, now, nodes, 1, v, pitch); // keep the dive whistle
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = pitch;
      s.connect(out);
      s.start(now);
      nodes.push(s);
      dur = buf.duration / pitch;
      if (["mg", "gun", "torpedo", "broadside", "hit", "fighter", "flak"].includes(cat)) dur = Math.max(dur, this.synth(cat, out, now, nodes, opts.shots ?? 4, v % VARIANTS, pitch));
    } else dur = this.synth(cat, out, now, nodes, opts.shots ?? 4, v, pitch);
    this.played++;
    this.byCat[cat] = (this.byCat[cat] ?? 0) + 1;
    this.voices.push({
      pri,
      end: now + dur,
      stop: () => {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        for (const n of nodes) try { n.stop(ctx.currentTime + 0.1); } catch { /* ended */ }
      },
    });
    setTimeout(() => pan.disconnect(), (dur + 1.5) * 1000);
  }

  /** Shots from merged volleys are still counted (the frame already plays several bursts). */
  /** recorded files counted per category (sample vs synth). */
  recorded: Record<string, number> = {};
  private bank(f: BankFolder | undefined): AudioBuffer[] {
    if (!f) return [];
    const out: AudioBuffer[] = [];
    for (let i = 1; i <= BANK[f]; i++) { const b = this.samples.get(`${f}/${i}`); if (b) out.push(b); }
    return out;
  }
  /** Plays a random file from a folder into a node; returns false when the folder has no files. */
  private oneShot(f: BankFolder, t: number, out: AudioNode, nodes: AudioScheduledSourceNode[], gain = 1, rate = 1): boolean {
    const bufs = this.bank(f);
    if (!bufs.length || !this.ctx) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
    s.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(out); s.start(t); nodes.push(s);
    return true;
  }
  /** Looping bed from a folder; returns a stopper or null when missing. */
  private bed(f: BankFolder, out: AudioNode, gain: number) {
    const b = this.bank(f)[0];
    if (!b || !this.ctx) return null;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(out); s.start();
    return { s, g };
  }
  mergeShots(n: number) {
    this.byCat["mg"] = (this.byCat["mg"] ?? 0) + 1;
    this.merged += n;
  }
  merged = 0;

  /** First sound enable: a supplied Captain recording so the radio is heard at once. */
  radioCheck() {
    if (this.radioChecked) return;
    this.radioChecked = true;
    this.lastVoiceAt = -1e9;
    void this.voice("cap_stations", "Battle stations! All hands to battle stations!");
  }

  /** Opening movement is the only non-market ship motion: alarm, telegraph and engines. */
  openingAdvance() {
    this.play("klaxon", { gain: 0.9 });
    this.play("reinforce", { x: -0.7, gain: 0.7 });
    window.setTimeout(() => this.play("reinforce", { x: 0.7, gain: 0.7 }), 180);
  }

  enqueueVoiceChain(chain: VoiceChain) {
    const duplicate = this.navalQueue.find((item) => item.id === chain.id);
    if (!duplicate) this.navalQueue.push(chain);
    this.navalQueue.sort((a, b) => b.priority - a.priority);
    void this.runNavalQueue();
  }

  private async runNavalQueue() {
    if (this.navalBusy || !this.ctx || !this.enabled) return;
    const chain = this.navalQueue.shift();
    if (!chain) return;
    this.navalBusy = true;
    for (const entry of chain.lines) {
      let played = false;
      const channel = entry.channel ?? chain.channel;
      for (const part of entry.parts) {
        played = (await this.playVoicePart(part, channel)) || played;
        await new Promise((resolve) => window.setTimeout(resolve, 120 + Math.random() * 80));
      }
      this.voiceChainLog.push({ at: Date.now(), id: chain.id, role: entry.role, channel, clips: entry.parts.map((part) => part.clip), text: entry.parts.map((part) => part.word).join(" "), played });
      if (this.voiceChainLog.length > 120) this.voiceChainLog.shift();
    }
    this.voPlayed.push(chain.id);
    this.navalBusy = false;
    window.setTimeout(() => void this.runNavalQueue(), 180);
  }

  private async playVoicePart(part: VoicePart, channel: VoiceChannel) {
    const ctx = this.ctx;
    if (!ctx) return false;
    const buf = await this.loadVo(part.clip);
    if (!buf) return false;
    const t = Math.max(ctx.currentTime + 0.03, this.voBusyUntil);
    const source = ctx.createBufferSource(); source.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = channel === "1mc" ? 1.35 : channel === "phone" ? 1.05 : 1.15;
    if (channel === "tbs") {
      this.micClick(t - 0.025); this.static(t, Math.min(0.12, buf.duration));
      this.chain(source, this.buses["vo"]!, this.filt("highpass", 300, 0.8), this.filt("lowpass", 3400, 0.8), gain);
      this.static(t + buf.duration, 0.18); this.micClick(t + buf.duration + 0.12);
    } else if (channel === "phone") {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256); for (let i = 0; i < curve.length; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 1.5); }
      shaper.curve = curve;
      this.chain(source, this.buses["vo"]!, this.filt("highpass", 400, 0.8), this.filt("lowpass", 3000, 0.8), shaper, gain);
    } else {
      const delay = ctx.createDelay(0.3); delay.delayTime.value = 0.11;
      const echo = ctx.createGain(); echo.gain.value = 0.18;
      delay.connect(echo).connect(this.buses["vo"]!);
      source.connect(delay);
      this.chain(source, this.buses["vo"]!, this.filt("highpass", 180, 0.7), this.filt("lowpass", 6500, 0.7), gain);
    }
    source.start(t);
    this.voBusyUntil = t + buf.duration;
    this.duck(t, buf.duration);
    await new Promise((resolve) => window.setTimeout(resolve, (buf.duration + 0.03) * 1000));
    return true;
  }

  describeVoiceChain(chain: VoiceChain) { return chainText(chain); }

  /** Play a radio line through mic clicks, static, a band-limited handset, and a squelch tail. */
  async voice(key: string, text: string): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return false;
    const now = ctx.currentTime;
    if (now < this.voBusyUntil || now - this.lastVoiceAt < VO_COOLDOWN) {
      // keep the newest line and play it as soon as the radio is free (dropped after 6 s)
      this.pending = { key, text, at: now };
      return false;
    }
    this.pending = null;
    const file = VO_FILES[key];
    const character = key.startsWith("cap_") ? "captain" : key.startsWith("adm_") ? "admiral" : "spotter";
    if (file) {
      const buf = await this.loadVo(`legacy:${file}`);
      if (buf) {
        this.lastVoiceAt = now;
        this.radioBuffer(buf);
        this.voPlayed.push(key);
        this.voByCharacter[character] = (this.voByCharacter[character] ?? 0) + 1;
        return true;
      }
    }
    return false;
  }
  /** Play once on the first torpedo after 30 s without any voice. */
  torpedoVoice() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastVoiceAt < 30 || now - this.lastTorpedoVoice < 30) return;
    this.lastTorpedoVoice = now;
    void this.voice("torpedo", "Torpedo in the water!");
  }
  hasVoiceBeenQuiet(seconds: number) {
    return !!this.ctx && this.ctx.currentTime - this.lastVoiceAt >= seconds;
  }
  private voLoads = new Map<string, Promise<AudioBuffer | null>>();
  /** One shared load per file, so concurrent lines never fall back to TTS while a file is still loading. */
  private loadVo(file: string) {
    let p = this.voLoads.get(file);
    if (!p) {
      p = (async () => {
        try {
          const legacy = file.startsWith("legacy:");
          const name = legacy ? file.slice(7) : file;
          const r = await fetch(legacy ? `/vo/${name}.wav` : `/vo/naval/${name}.mp3`);
          if (r.ok && !(r.headers.get("content-type") ?? "").includes("html")) return await this.ctx!.decodeAudioData(await r.arrayBuffer());
        } catch { /* slot empty */ }
        return null;
      })();
      this.voLoads.set(file, p);
    }
    return p;
  }
  private radioBuffer(buf: AudioBuffer) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.2;
    this.micClick(ctx.currentTime);
    this.static(ctx.currentTime + 0.03, 0.2);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    shaper.curve = curve;
    const g = ctx.createGain();
    g.gain.value = 1.1;
    this.chain(s, this.buses["vo"]!, this.filt("highpass", 300, 0.8), this.filt("lowpass", 3400, 0.8), this.filt("peaking", 1800, 1), shaper, g);
    s.start(t);
    this.voBusyUntil = t + buf.duration;
    this.duck(t, buf.duration);
    this.static(t + buf.duration, 0.2);
    this.micClick(t + buf.duration + 0.12);
  }
  private micClick(t: number) {
    const n: AudioScheduledSourceNode[] = [];
    this.chain(this.noiseSrc(t, 0.025, n), this.buses["vo"]!, this.filt("highpass", 1800, 1.2), this.env(t, 0.001, 0.35, 0.025));
  }
  private static(t: number, dur: number) {
    const n: AudioScheduledSourceNode[] = [];
    this.chain(this.noiseSrc(t, dur, n), this.buses["vo"]!, this.filt("bandpass", 2500, 0.5), this.env(t, 0.005, 0.18, dur));
  }
  /** Duck effects and music by 6 dB while a voice speaks. */
  private duck(t: number, dur: number) {
    const targets: Array<[GainNode | null | undefined, number]> = [[this.music, 0.45], [this.buses["weapons"], 0.9], [this.buses["ships"], 0.8], [this.buses["air"], 0.8]];
    for (const [g, base] of targets) {
      if (!g) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(base * 0.5, t, 0.05);
      g.gain.setTargetAtTime(base, t + dur + 0.2, 0.3);
    }
  }

  // ───────── aircraft: one engine voice per visible plane, alive exactly as long as the plane ─────────
  aircraftLog: { kind: string; ev: "spawn" | "exit" | "guns" | "bomb"; t: number }[] = [];
  /** Starts a looping propeller engine for one aircraft. Returns null when audio is off. */
  aircraftStart(kind: "fighter" | "bomber") {
    const ctx = this.ctx;
    const bus = this.buses["air"] ?? this.buses["weapons"];
    if (!ctx || !this.enabled || !bus) return null;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    const pan = ctx.createStereoPanner();
    out.connect(pan).connect(bus);
    const nodes: OscillatorNode[] = [];
    // fighter: one radial engine; bomber: four slightly detuned engines (beating drone)
    const base = kind === "fighter" ? 92 : 58;
    const engines = kind === "fighter" ? 1 : 4;
    const lp = this.filt("lowpass", kind === "fighter" ? 1400 : 700, 0.9);
    const beat = ctx.createGain();
    beat.gain.value = 0.75;
    lp.connect(beat).connect(out);
    for (let i = 0; i < engines; i++) {
      for (const [mult, type, g] of [[1, "sawtooth", 0.22], [2, "square", 0.06], [0.5, "sine", 0.3]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = base * mult * (1 + (i - 1.5) * 0.012);
        const og = ctx.createGain();
        og.gain.value = g / engines;
        o.connect(og).connect(lp);
        o.start(t);
        nodes.push(o);
      }
    }
    // propeller beat: amplitude modulation at blade-pass rate
    const am = ctx.createOscillator();
    am.frequency.value = kind === "fighter" ? 38 : 24;
    const amg = ctx.createGain();
    amg.gain.value = 0.25;
    am.connect(amg).connect(beat.gain);
    am.start(t);
    nodes.push(am);
    // air rush
    const rush: AudioScheduledSourceNode[] = [];
    const ns = this.noiseSrc(t, 60, rush);
    const ng = ctx.createGain();
    ng.gain.value = kind === "fighter" ? 0.08 : 0.05;
    ns.connect(this.filt("bandpass", 1800, 0.5)).connect(ng).connect(out);
    this.aircraftLog.push({ kind, ev: "spawn", t: performance.now() });
    let stopped = false;
    return {
      /** pan -1..1 from screen x, closeness 0..1 (1 = at the camera), pitch from doppler (1 = none), climb 0..1 */
      update: (panV: number, closeness: number, pitch: number, climb: number) => {
        if (stopped || !this.ctx) return;
        const now = this.ctx.currentTime;
        pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, panV)), now, 0.05);
        out.gain.setTargetAtTime(0.02 + 0.55 * closeness * closeness, now, 0.08);
        const f = Math.max(0.7, Math.min(1.4, pitch)) * (1 + climb * 0.18);
        for (const o of nodes) if (o !== am) o.detune.setTargetAtTime(1200 * Math.log2(f), now, 0.06);
        lp.frequency.setTargetAtTime((kind === "fighter" ? 900 : 500) + 2200 * closeness, now, 0.1);
      },
      /** wing guns: a burst for the visible strafing time */
      guns: (dur: number, panV: number) => {
        if (stopped || !this.ctx) return;
        const now = this.ctx.currentTime;
        const n2: AudioScheduledSourceNode[] = [];
        const p2 = this.ctx.createStereoPanner();
        p2.pan.value = Math.max(-1, Math.min(1, panV));
        p2.connect(bus);
        for (let k = 0; k * 0.07 < dur; k++) this.chain(this.noiseSrc(now + k * 0.07, 0.04, n2), p2, this.filt("bandpass", 1300 + Math.random() * 500, 0.9), this.env(now + k * 0.07, 0.002, 0.5, 0.05));
        this.aircraftLog.push({ kind, ev: "guns", t: performance.now() });
      },
      /** falling-bomb whistle for exactly the bomb's visible fall time */
      bomb: (fall: number) => {
        if (stopped || !this.ctx) return;
        const now = this.ctx.currentTime;
        const n2: AudioScheduledSourceNode[] = [];
        this.chain(this.osc("sine", 1900, 420, now, fall, n2), bus, this.env(now, 0.05, 0.12, fall));
        this.aircraftLog.push({ kind, ev: "bomb", t: performance.now() });
      },
      stop: () => {
        if (stopped || !this.ctx) return;
        stopped = true;
        const now = this.ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, 0.12);
        for (const o of nodes) o.stop(now + 0.6);
        for (const r of rush) r.stop(now + 0.6);
        this.aircraftLog.push({ kind, ev: "exit", t: performance.now() });
      },
    };
  }

  // ───────── procedural synth kit ─────────
  private noiseSrc(t: number, dur: number, nodes: AudioScheduledSourceNode[]) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random());
    s.stop(t + dur);
    nodes.push(s);
    return s;
  }
  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, nodes: AudioScheduledSourceNode[]) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    nodes.push(o);
    return o;
  }
  private env(t: number, a: number, peak: number, dur: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }
  private filt(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  private chain(src: AudioNode, out: AudioNode, ...mid: AudioNode[]) {
    let cur = src;
    for (const m of mid) {
      cur.connect(m);
      cur = m;
    }
    cur.connect(out);
  }
  private boom(t: number, out: AudioNode, nodes: AudioScheduledSourceNode[], f = 70, dur = 0.6, lp = 900, peak = 0.9) {
    this.chain(this.noiseSrc(t, dur, nodes), out, this.filt("lowpass", lp), this.env(t, 0.005, peak, dur));
    this.chain(this.osc("sine", f, f * 0.45, t, dur, nodes), out, this.env(t, 0.005, peak, dur));
  }

  /** Brass shell casings clinking on the deck after a burst. */
  private casings(t: number, out: AudioNode, n: AudioScheduledSourceNode[], count: number) {
    for (let i = 0; i < count; i++) {
      const ti = t + i * (0.05 + Math.random() * 0.07);
      const f = 3800 + Math.random() * 3200;
      this.chain(this.osc("sine", f, f * 0.97, ti, 0.07, n), out, this.env(ti, 0.001, 0.07 + Math.random() * 0.05, 0.07));
      this.chain(this.osc("triangle", f * 1.51, f * 1.48, ti, 0.04, n), out, this.env(ti, 0.001, 0.03, 0.04));
    }
  }
  /** Long rolling echo of a big gun off the sea and the far fleet. */
  private echo(t: number, out: AudioNode, n: AudioScheduledSourceNode[], peak: number, lp = 500) {
    for (let i = 0; i < 4; i++) {
      const ti = t + 0.35 + i * (0.38 + Math.random() * 0.2);
      this.chain(this.noiseSrc(ti, 0.9, n), out, this.filt("lowpass", lp - i * 80), this.env(ti, 0.04, peak * Math.pow(0.55, i), 0.9));
    }
  }

  private synth(cat: SfxCat, out: AudioNode, t: number, n: AudioScheduledSourceNode[], fills: number, v: number, pitch: number): number {
    const P = pitch;
    switch (cat) {
      case "mg": {
        // six machine-gun voices: bark colour, cyclic rate, low body, crack shape
        const V = [
          { bp: 1500, q: 1.1, gap: 0.055, body: 520, dec: 0.05 },
          { bp: 2300, q: 1.6, gap: 0.045, body: 700, dec: 0.035 },
          { bp: 1100, q: 0.8, gap: 0.07, body: 380, dec: 0.07 },
          { bp: 3000, q: 2.2, gap: 0.04, body: 900, dec: 0.03 },
          { bp: 1800, q: 0.9, gap: 0.062, body: 450, dec: 0.06 },
          { bp: 900, q: 1.3, gap: 0.085, body: 300, dec: 0.09 },
        ][v]!;
        const shots = Math.max(2, Math.min(12, fills));
        for (let i = 0; i < shots; i++) {
          const ti = t + i * V.gap + Math.random() * 0.01;
          this.chain(this.noiseSrc(ti, V.dec, n), out, this.filt("bandpass", V.bp * P * (0.85 + Math.random() * 0.3), V.q), this.env(ti, 0.001, 0.7, V.dec));
          this.chain(this.noiseSrc(ti, V.dec * 1.6, n), out, this.filt("lowpass", V.body * P), this.env(ti, 0.001, 0.5, V.dec * 1.6));
        }
        const end = t + shots * V.gap;
        this.casings(end + 0.08, out, n, 2 + Math.floor(Math.random() * 3));
        return shots * V.gap + 0.45;
      }
      case "hit": {
        // metallic ricochet / ping off armour
        const f0 = [3400, 2600, 4200, 3000, 5000, 2200][v]! * P;
        const o = this.osc(v % 2 ? "sine" : "triangle", f0, f0 * (0.3 + v * 0.05), t, 0.28 + v * 0.03, n);
        this.chain(o, out, this.filt("bandpass", f0 * 0.7, 3), this.env(t, 0.002, 0.22, 0.3 + v * 0.03));
        this.chain(this.noiseSrc(t, 0.04, n), out, this.filt("highpass", 2500), this.env(t, 0.001, 0.3, 0.04));
        return 0.4;
      }
      case "miss": {
        this.chain(this.osc("sine", 1600 * P, 320 * P, t, 0.38, n), out, this.env(t, 0.01, 0.18, 0.38));
        this.chain(this.noiseSrc(t + 0.3, 0.55, n), out, this.filt("highpass", 900), this.env(t + 0.3, 0.01, 0.32, 0.55));
        return 0.9;
      }
      case "gun": {
        // 40 mm Bofors / pom-pom: paired mechanical thumps.
        for (let i = 0; i < 2; i++) {
          const ti = t + i * 0.12;
          this.chain(this.noiseSrc(ti, 0.055, n), out, this.filt("bandpass", (900 + v * 120) * P, 0.8), this.env(ti, 0.001, 0.85, 0.055));
          this.boom(ti, out, n, 125 * P, 0.18, 750, 0.45);
        }
        return 0.48;
      }
      case "gun5": {
        // 5-inch dual-purpose gun: sharp crack, short body and shell whistle.
        const V = [[2200, 110, 1600], [2800, 90, 1300], [1700, 130, 1900], [3200, 75, 1100], [2000, 100, 1500], [2500, 120, 2200]][v]!;
        this.chain(this.noiseSrc(t, 0.06, n), out, this.filt("highpass", V[0]! * P), this.env(t, 0.0005, 1, 0.06));
        this.chain(this.noiseSrc(t, 0.1, n), out, this.filt("bandpass", V[0]! * 0.7 * P, 0.9), this.env(t, 0.001, 0.8, 0.1));
        this.boom(t, out, n, V[1]! * P, 0.7, V[2]!, 0.9);
        this.chain(this.osc("sine", 48 * P, 30, t, 0.9, n), out, this.env(t, 0.01, 0.7, 0.9));
        this.echo(t, out, n, 0.35);
        this.chain(this.osc("sine", 1800 * P, 420, t + 0.08, 0.32, n), out, this.env(t + 0.08, 0.01, 0.13, 0.32));
        return 2.4;
      }
      case "torpedo": {
        // launch hiss sweep, then a muffled underwater boom and spray
        const V = [[400, 3000], [300, 2200], [600, 3800], [250, 1800], [500, 2600], [350, 4200]][v]!;
        const src = this.noiseSrc(t, 0.45, n);
        const f = this.filt("bandpass", 600, 1.5);
        f.frequency.setValueAtTime(V[0]! * P, t);
        f.frequency.exponentialRampToValueAtTime(V[1]! * P, t + 0.4);
        this.chain(src, out, f, this.env(t, 0.03, 0.55, 0.45));
        this.chain(this.osc("sine", 180 * P, 60, t, 0.15, n), out, this.env(t, 0.002, 0.5, 0.15));
        this.boom(t + 0.45, out, n, (45 + v * 5) * P, 1.1, 260 + v * 40, 1);
        this.chain(this.noiseSrc(t + 0.45, 0.7, n), out, this.filt("bandpass", 450 + v * 60, 0.7), this.env(t + 0.45, 0.01, 0.5, 0.7));
        this.echo(t + 0.45, out, n, 0.25, 350);
        return 2.6;
      }
      case "broadside": {
        const guns = 4 + (v % 4);
        const spacing = 0.04 + v * 0.012;
        for (let i = 0; i < guns; i++) {
          const ti = t + i * spacing + Math.random() * 0.02;
          this.chain(this.noiseSrc(ti, 0.07, n), out, this.filt("highpass", (2000 + v * 250) * P), this.env(ti, 0.0005, 0.9, 0.07));
          this.boom(ti, out, n, (70 - i * 5) * P, 0.9, 1200, 0.85);
        }
        this.chain(this.osc("sine", 38 * P, 26, t, 2.4, n), out, this.env(t, 0.05, 0.85, 2.4));
        this.echo(t, out, n, 0.5, 450);
        return 3.2;
      }
      case "fighter": {
        const f0 = [520, 460, 600, 420, 560, 680][v]! * P;
        const o = this.osc(v % 2 ? "sawtooth" : "square", f0, f0 * 0.4, t, 1.6, n);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        this.chain(o, out, this.filt("lowpass", 1100 + v * 150), g);
        this.chain(this.noiseSrc(t, 1.6, n), out, this.filt("bandpass", 800 + v * 100, 0.6), this.env(t, 0.7, 0.25, 1.6));
        for (let i = 0; i < 8 + v; i++) this.chain(this.noiseSrc(t + 0.5 + i * 0.05, 0.04, n), out, this.filt("bandpass", 1300 + v * 200, 1), this.env(t + 0.5 + i * 0.05, 0.002, 0.3, 0.04));
        // Low pass-by rumble, dive scream and a heavy wing-gun burst under the recording.
        this.chain(this.osc("sine", 58 * P, 34, t + 0.25, 2.1, n), out, this.env(t + 0.25, 0.25, 0.55, 2.1));
        this.chain(this.osc("sawtooth", 2100 * P, 720, t + 0.12, 1.1, n), out, this.filt("bandpass", 1600, 2.8), this.env(t + 0.12, 0.08, 0.18, 1.1));
        for (let i = 0; i < 14; i++) this.chain(this.noiseSrc(t + 0.62 + i * 0.045, 0.035, n), out, this.filt("bandpass", 1500 + (i % 3) * 500, 1.2), this.env(t + 0.62 + i * 0.045, 0.001, 0.34, 0.035));
        return 2.5;
      }
      case "flak": {
        for (let i = 0; i < 3 + (v % 3); i++) {
          const ti = t + i * 0.09;
          this.chain(this.noiseSrc(ti, 0.055, n), out, this.filt("highpass", 1800 + v * 180), this.env(ti, 0.001, 0.45, 0.055));
        }
        return 0.7;
      }
      case "dive":
      case "fled": {
        const fast = cat === "fled";
        const step = (fast ? 0.15 : 0.4) * (0.85 + v * 0.06);
        const cycles = fast ? 6 : 3;
        const hi = [440, 520, 400, 470, 560, 380][v]! * P;
        for (let i = 0; i < cycles; i++) {
          const f = i % 2 ? hi * 0.75 : hi;
          this.chain(this.osc(v % 2 ? "square" : "sawtooth", f, f, t + i * step, step * 0.9, n), out, this.filt("lowpass", 1600 + v * 150), this.env(t + i * step, 0.01, fast ? 0.3 : 0.2, step * 0.9));
        }
        const pt = t + cycles * step;
        this.chain(this.osc("sine", (1150 + v * 60) * P, 1100, pt, 1.4, n), out, this.env(pt, 0.005, 0.3, 1.4));
        return cycles * step + 1.5;
      }
      case "surface":
        this.chain(this.noiseSrc(t, 1.3, n), out, this.filt(v % 2 ? "highpass" : "bandpass", (1200 + v * 300) * P, 0.7), this.env(t, 0.08, 0.3, 1.3));
        return 1.4;
      case "sink":
        this.chain(this.osc("sawtooth", (60 + v * 6) * P, 30, t, 2.2, n), out, this.filt("lowpass", 240 + v * 30, 4), this.env(t, 0.2, 0.5, 2.2));
        this.chain(this.noiseSrc(t + 0.3, 2, n), out, this.filt("lowpass", 500 + v * 80), this.env(t + 0.3, 0.3, 0.45, 2));
        for (let i = 0; i < 2 + v; i++) { const ti = t + 0.4 + Math.random() * 1.6; this.chain(this.osc("sine", 90 + Math.random() * 60, 40, ti, 0.3, n), out, this.env(ti, 0.01, 0.2, 0.3)); } // groaning hull + bubbles
        return 2.4;
      case "reinforce": {
        const f = (100 + v * 8) * P;
        this.chain(this.osc("sawtooth", f, f * 0.98, t, 1.2, n), out, this.filt("lowpass", 500), this.env(t, 0.1, 0.18, 1.2));
        this.chain(this.osc("sawtooth", f * 1.5, f * 1.48, t, 1.2, n), out, this.filt("lowpass", 500), this.env(t, 0.1, 0.12, 1.2));
        return 1.3;
      }
      case "liquidation": {
        // dive-bomber whistle descending before impact, then the bomb
        const len = 1.1 + v * 0.12;
        const f0 = [1900, 2300, 1700, 2600, 2100, 1500][v]! * P;
        this.chain(this.osc("sine", f0, f0 * 0.22, t, len, n), out, this.env(t, 0.05, 0.22, len));
        this.chain(this.noiseSrc(t, len, n), out, this.filt("bandpass", f0 * 0.6, 4), this.env(t, 0.3, 0.06, len));
        this.boom(t + len, out, n, (45 + v * 4) * P, 1.3, 600, 1);
        this.echo(t + len, out, n, 0.4, 420);
        return len + 2.4;
      }
      case "cascade": {
        const o = this.osc("sine", 300, 300, t, 3.2, n);
        o.frequency.linearRampToValueAtTime(900 * P, t + 1.5);
        o.frequency.linearRampToValueAtTime(300, t + 3.1);
        this.chain(o, out, this.env(t, 0.3, 0.3, 3.2));
        return 3.3;
      }
      case "klaxon": {
        for (let i = 0; i < 4; i++) this.chain(this.osc("sawtooth", i % 2 ? 520 : 390, i % 2 ? 520 : 390, t + i * 0.42, 0.36, n), out, this.filt("lowpass", 1600), this.env(t + i * 0.42, 0.02, 0.25, 0.36));
        return 1.9;
      }
      case "bosun": {
        this.chain(this.osc("sine", 2100, 3300, t, 0.55, n), out, this.env(t, 0.02, 0.17, 0.55));
        this.chain(this.osc("sine", 3200, 1700, t + 0.56, 0.48, n), out, this.env(t + 0.56, 0.02, 0.15, 0.48));
        return 1.1;
      }
    }
  }

  // ───────── continuous war ambience + radio chatter ─────────
  setIntensity(x: number) {
    this.intensity = Math.max(0, Math.min(1, x));
  }
  private startAmbience() {
    const ctx = this.ctx!;
    const amb = this.buses["amb"]!;
    const keep: AudioScheduledSourceNode[] = [];
    // recorded beds when available: sea + distant battle (its gain follows intensity)
    const recWaves = this.bed("waves", amb, 0.5);
    this.battleBed = this.bed("battle", amb, 0.05);
    // sea wind + waves bed (procedural fallback, kept quiet under the recording)
    const waves = this.noiseSrc(ctx.currentTime, 1e6, keep);
    const wg = ctx.createGain();
    wg.gain.value = recWaves ? 0.05 : 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ctx.createGain();
    lg.gain.value = 0.08;
    lfo.connect(lg).connect(wg.gain);
    lfo.start();
    this.chain(waves, amb, this.filt("lowpass", 520), wg);
    const wind = this.noiseSrc(ctx.currentTime, 1e6, keep);
    const wind2 = ctx.createGain();
    wind2.gain.value = 0.035;
    this.chain(wind, amb, this.filt("bandpass", 1100, 0.3), wind2);
    // Low engine-room vibration beneath the weather and distant guns.
    for (const f of [31, 47, 63]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.012;
      o.connect(this.filt("lowpass", 180)).connect(g).connect(amb); o.start();
    }
    // radio chatter bed: faint static under the music
    const hiss = this.noiseSrc(ctx.currentTime, 1e6, keep);
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    this.chain(hiss, this.buses["chatter"]!, this.filt("bandpass", 2600, 0.6), hg);
    this.ambience.active = true;
    let nextChatter = ctx.currentTime + 2;
    this.ambTimer = setInterval(() => {
      const c = this.ctx;
      if (!c || !this.enabled || c.state !== "running") return;
      const t = c.currentTime + 0.05;
      const k = this.intensity;
      const step = 0.2;
      const n: AudioScheduledSourceNode[] = [];
      if (this.battleBed) this.battleBed.g.gain.setTargetAtTime(0.05 + 0.4 * k, t, 1.5);
      // far-off AA flak pops
      if (Math.random() < step * (0.6 + 4 * k)) {
        this.ambience.pops++;
        const g = c.createStereoPanner(); g.pan.value = Math.random() * 2 - 1; g.connect(amb);
        const far = this.filt("lowpass", 1600 + Math.random() * 1500); far.connect(g);
        if (!this.oneShot("flak", t, far, n, 0.25 + 0.3 * k)) this.chain(this.noiseSrc(t, 0.12, n), g, this.filt("bandpass", 500 + Math.random() * 700, 1.2), this.filt("lowpass", 1400), this.env(t, 0.002, 0.18 + 0.2 * k, 0.12));
        if (this.reverb) g.connect(this.reverb);
      }
      // distant explosions
      if (Math.random() < step * (0.12 + 0.7 * k)) {
        this.ambience.booms++;
        const g = c.createStereoPanner(); g.pan.value = Math.random() * 2 - 1; g.connect(amb);
        const far = this.filt("lowpass", 500 + Math.random() * 400); far.connect(g);
        if (!this.oneShot("explosion", t, far, n, 0.35 + 0.35 * k, 0.8)) this.boom(t, g, n, 35 + Math.random() * 25, 1.6, 220 + Math.random() * 200, 0.35 + 0.3 * k);
        if (this.reverb) g.connect(this.reverb);
      }
      // ship horns (rare)
      if (Math.random() < step / 35) {
        this.ambience.horns++;
        const f = 80 + Math.random() * 40;
        const hp = c.createStereoPanner(); hp.pan.value = Math.random() * 1.6 - 0.8; hp.connect(amb);
        const hf = this.filt("lowpass", 1200); hf.connect(hp);
        if (!this.oneShot("horn", t, hf, n, 0.3)) for (const m of [1, 1.5]) this.chain(this.osc("sawtooth", f * m, f * m * 0.99, t, 2.2, n), amb, this.filt("lowpass", 380), this.env(t, 0.25, 0.07, 2.2));
      }
      // radio chatter: short filtered murmurs and beeps
      if (t >= nextChatter && t >= this.voBusyUntil) {
        this.ambience.chatter++;
        nextChatter = t + 3 + Math.random() * 5;
        const ch = this.buses["chatter"]!;
        if (Math.random() < 0.3 && this.oneShot("radio", t, ch, n, 0.18)) { /* recorded static/beeps */ }
        else if (Math.random() < 0.35) this.chain(this.osc("sine", 1000 + Math.random() * 400, 1000, t, 0.08, n), ch, this.env(t, 0.003, 0.05, 0.08));
        else {
          const d = 0.6 + Math.random() * 0.8;
          const src = this.noiseSrc(t, d, n);
          const am = c.createGain(); am.gain.value = 0;
          const mod = this.osc("square", 4 + Math.random() * 3, 5, t, d, n);
          const mg = c.createGain(); mg.gain.value = 0.04;
          mod.connect(mg).connect(am.gain);
          this.chain(src, ch, this.filt("bandpass", 500 + Math.random() * 900, 2.5), this.filt("lowpass", 1800), am);
        }
      }
      // play a queued radio line once the radio is free
      const pd = this.pending;
      if (pd && t - pd.at > 6) this.pending = null;
      else if (pd && t >= this.voBusyUntil && t - this.lastVoiceAt >= VO_COOLDOWN) { this.pending = null; void this.voice(pd.key, pd.text); }
    }, 200);
  }
  /** Air-raid siren loop for the whole cascade. */
  private setSiren(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) { this.siren?.stop(); this.siren = null; return; }
    if (this.siren) return;
    const rec = this.bed("siren", this.buses["alarms"]!, 0.0001);
    if (rec) {
      rec.g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 1.5);
      this.siren = { stop: () => { rec.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); rec.s.stop(ctx.currentTime + 3); } };
      return;
    }
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 600;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.22;
    const lg = ctx.createGain();
    lg.gain.value = 300;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 1.5);
    o.connect(this.filt("lowpass", 1800)).connect(g).connect(this.buses["alarms"]!);
    o.start(); lfo.start();
    this.siren = { stop: () => { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); o.stop(ctx.currentTime + 3); lfo.stop(ctx.currentTime + 3); } };
  }

  // ───────── adaptive music ─────────
  private startMusic() {
    const ctx = this.ctx!;
    const keep: AudioScheduledSourceNode[] = [];
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.music!);
      this.layerGain[l] = g;
    }
    // sea + wind
    const sea = this.noiseSrc(ctx.currentTime, 1e6, keep);
    const seaF = this.filt("lowpass", 380);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.25;
    const seaG = ctx.createGain();
    seaG.gain.value = 0.45;
    lfo.connect(lfoG).connect(seaG.gain);
    lfo.start();
    this.chain(sea, this.layerGain.sea!, seaF, seaG);
    const wind = this.noiseSrc(ctx.currentTime, 1e6, keep);
    const wg = ctx.createGain();
    wg.gain.value = 0.08;
    this.chain(wind, this.layerGain.sea!, this.filt("bandpass", 700, 0.4), wg);
    // low strings drone (D)
    for (const f of [73.4, 110, 146.8, 147.3]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      o.connect(this.filt("lowpass", 520)).connect(g).connect(this.layerGain.drone!);
      o.start();
    }
    // choir pad
    for (const f of [293.7, 349.2, 440, 587.3]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.5;
      const vg = ctx.createGain();
      vg.gain.value = 2;
      vib.connect(vg).connect(o.frequency);
      vib.start();
      const g = ctx.createGain();
      g.gain.value = 0.035;
      o.connect(g).connect(this.layerGain.choir!);
      o.start();
    }
    // drums + brass scheduler (100 bpm)
    this.nextBeat = ctx.currentTime + 0.1;
    this.drumTimer = setInterval(() => this.schedule(), 100);
    this.setPhase(this.phase);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 0.6;
    while (this.nextBeat < ctx.currentTime + 0.3) {
      const t = this.nextBeat;
      const b = this.beat++;
      const nodes: AudioScheduledSourceNode[] = [];
      const dg = this.layerGain.drums!;
      if (!(dg as GainNode & { stem?: boolean }).stem) {
        if (b % 2 === 0) this.chain(this.osc("sine", 110, 45, t, 0.35, nodes), dg, this.env(t, 0.003, 0.7, 0.35));
        if (b % 4 === 3) this.chain(this.noiseSrc(t, 0.2, nodes), dg, this.filt("bandpass", 220, 1.5), this.env(t, 0.003, 0.5, 0.2));
        this.chain(this.osc("triangle", 160, 90, t + spb / 2, 0.15, nodes), dg, this.env(t + spb / 2, 0.003, 0.2, 0.15));
      }
      const bg = this.layerGain.brass!;
      if (b % 8 === 0 && !(bg as GainNode & { stem?: boolean }).stem)
        for (const f of [146.8, 220, 293.7]) this.chain(this.osc("sawtooth", f, f, t, 0.5, nodes), bg, this.filt("lowpass", 1200), this.env(t, 0.03, 0.12, 0.5));
      this.nextBeat += spb;
    }
  }

  setPhase(p: Phase | "P0") {
    const prev = this.phase;
    this.phase = p;
    const ctx = this.ctx;
    if (!ctx) return;
    const mix: Record<string, Partial<Record<Layer, number>>> = {
      P1: { sea: 1, drone: 0.7 },
      P0: { sea: 0.8, drone: 0.7, drums: 0.25 },
      P2: { sea: 0.6, drone: 0.7, drums: 0.8, brass: 0.6 },
      P3: { sea: 0.5, drone: 0.8, drums: 1, brass: 0.8 },
      P4: { sea: 0.5, drone: 0.8, drums: 1, brass: 1 },
      P5: { sea: 0.4, drone: 1, drums: 1, brass: 1, choir: 1 },
      P6: { sea: 0.6, drone: 0.8, drums: 0.8, brass: 0.6, choir: 0.4 },
      P7: { sea: 1, drone: 0.6 },
    };
    const m = mix[p] ?? mix["P0"]!;
    this.setSiren(p === "P5");
    for (const l of LAYERS) this.layerGain[l]?.gain.setTargetAtTime(m[l] ?? 0, ctx.currentTime, 0.6); // ~2 s crossfade
    if (!this.enabled || p === prev) return;
    const t = ctx.currentTime;
    const nodes: AudioScheduledSourceNode[] = [];
    if (p === "P4") for (const f of [98, 146.8, 196, 293.7]) this.chain(this.osc("sawtooth", f, f, t, 1.4, nodes), this.music!, this.filt("lowpass", 1600), this.env(t, 0.02, 0.18, 1.4));
    if (p === "P5") this.play("cascade");
    if (p === "P6") [293.7, 349.2, 440, 587.3, 698.5].forEach((f, i) => this.chain(this.osc("triangle", f, f, t + i * 0.18, 0.35, nodes), this.music!, this.env(t + i * 0.18, 0.01, 0.2, 0.35)));
  }

  dispose() {
    if (this.drumTimer) clearInterval(this.drumTimer);
    if (this.ambTimer) clearInterval(this.ambTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
/** Map world x to stereo pan. */
export const panX = (x: number, halfW: number) => Math.max(-1, Math.min(1, x / Math.max(halfW, 1)));
