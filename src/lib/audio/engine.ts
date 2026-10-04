import type { Phase } from "@/lib/battle/phase";

/**
 * Web Audio engine: one master gain, per-category buses, stereo panning by
 * screen x, max 8 simultaneous one-shots with priority. Every category has a
 * sample slot (/sfx/<category>.mp3); missing files fall back to procedural synths.
 */
export type SfxCat = "mg" | "gun" | "torpedo" | "broadside" | "fighter" | "dive" | "fled" | "surface" | "sink" | "reinforce" | "liquidation" | "cascade";
export const SFX: SfxCat[] = ["mg", "gun", "torpedo", "broadside", "fighter", "dive", "fled", "surface", "sink", "reinforce", "liquidation", "cascade"];
const PRIORITY: Record<SfxCat, number> = { mg: 1, reinforce: 2, gun: 3, surface: 4, torpedo: 5, dive: 6, fighter: 6, fled: 7, sink: 7, liquidation: 8, broadside: 8, cascade: 9 };
const BUS: Record<SfxCat, "weapons" | "ships" | "air" | "alarms"> = {
  mg: "weapons", gun: "weapons", torpedo: "weapons", broadside: "weapons",
  fighter: "air", liquidation: "air",
  dive: "alarms", fled: "alarms", cascade: "alarms",
  surface: "ships", sink: "ships", reinforce: "ships",
};
const MAX_VOICES = 12;
/** Voice lines: file in /public/vo or speechSynthesis fallback. */
export const VO_FILES: Record<string, string> = { P2: "p2_contact", P3: "p3_fire", P5: "p5_brace", P6push: "p6_push", P6fall: "p6_fallback", P7: "p7_ceasefire", torpedo: "torpedo" };
const VO_COOLDOWN = 8;
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
  voBusyUntil = 0;
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
        g.gain.value = b === "weapons" ? 0.9 : b === "vo" ? 1.2 : 0.8;
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
      void this.loadSlots();
      this.startMusic();
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
    await Promise.all([...SFX.map((c) => load(c, `/sfx/${c}.mp3`)), ...LAYERS.map((l) => load("music:" + l, `/music/${l}.mp3`))]);
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
  }
  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }
  private applyVolume() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  play(cat: SfxCat, opts: { x?: number; gain?: number; shots?: number } = {}) {
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
      if (this.voices[low]!.pri > pri) {
        this.dropped++;
        return;
      }
      this.voices[low]!.stop();
      this.voices.splice(low, 1);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, opts.x ?? 0));
    const out = ctx.createGain();
    out.gain.value = opts.gain ?? 1;
    out.connect(pan);
    pan.connect(this.buses[BUS[cat]]!);
    const nodes: AudioScheduledSourceNode[] = [];
    const buf = this.samples.get(cat);
    let dur: number;
    if (buf) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(out);
      s.start(now);
      nodes.push(s);
      dur = buf.duration;
    } else dur = this.synth(cat, out, now, nodes, opts.shots ?? 4);
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
    setTimeout(() => pan.disconnect(), (dur + 0.5) * 1000);
  }

  /** Play a radio line: file through a radio filter, else speechSynthesis. One at a time, 8 s cooldown. */
  async voice(key: string, text: string): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return false;
    const now = ctx.currentTime;
    if (now < this.voBusyUntil || now - this.lastVoiceAt < VO_COOLDOWN) return false;
    const file = VO_FILES[key];
    this.lastVoiceAt = now;
    if (file) {
      const buf = await this.loadVo(file);
      if (buf) {
        this.radioBuffer(buf);
        this.voPlayed.push(key);
        return true;
      }
    }
    if (typeof speechSynthesis === "undefined") return false;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    u.lang = "en-US";
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    u.voice = voices.find((v) => /male|david|daniel|alex|fred|george|guy|mark/i.test(v.name) && !/female/i.test(v.name)) ?? voices[0] ?? null;
    u.pitch = 0.8;
    const est = 0.5 + text.length * 0.06;
    this.voBusyUntil = now + est;
    this.static(now, 0.18);
    this.duck(now, est);
    u.onend = () => {
      this.voBusyUntil = 0;
      if (this.ctx) this.static(this.ctx.currentTime, 0.15);
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    this.voPlayed.push(key + " (tts)");
    return true;
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
  private async loadVo(file: string) {
    const key = "vo:" + file;
    if (!this.samples.has(key)) {
      this.samples.set(key, null);
      try {
        const r = await fetch(`/vo/${file}.wav`);
        if (r.ok && !(r.headers.get("content-type") ?? "").includes("html")) this.samples.set(key, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
      } catch { /* slot empty */ }
    }
    return this.samples.get(key) ?? null;
  }
  private radioBuffer(buf: AudioBuffer) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.2;
    this.static(ctx.currentTime, 0.2);
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
    this.static(t + buf.duration, 0.15);
  }
  private static(t: number, dur: number) {
    const n: AudioScheduledSourceNode[] = [];
    this.chain(this.noiseSrc(t, dur, n), this.buses["vo"]!, this.filt("bandpass", 2500, 0.5), this.env(t, 0.005, 0.18, dur));
  }
  /** Duck music by 6 dB while a voice speaks. */
  private duck(t: number, dur: number) {
    const m = this.music;
    if (!m) return;
    m.gain.cancelScheduledValues(t);
    m.gain.setTargetAtTime(0.45 * 0.5, t, 0.05);
    m.gain.setTargetAtTime(0.45, t + dur + 0.2, 0.3);
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

  private synth(cat: SfxCat, out: AudioNode, t: number, n: AudioScheduledSourceNode[], fills = 4): number {
    switch (cat) {
      case "mg": {
        // deck machine-gun burst: one crack per fill (capped)
        const shots = Math.max(2, Math.min(10, fills));
        const gap = 0.055;
        for (let i = 0; i < shots; i++) {
          const ti = t + i * gap + Math.random() * 0.008;
          this.chain(this.noiseSrc(ti, 0.05, n), out, this.filt("bandpass", 1400 + Math.random() * 900, 1.1), this.env(ti, 0.001, 0.7, 0.05));
          this.chain(this.noiseSrc(ti, 0.08, n), out, this.filt("lowpass", 500), this.env(ti, 0.001, 0.5, 0.08));
        }
        return shots * gap + 0.08;
      }
      case "gun":
        // deck gun: sharp crack + low thump + short tail
        this.chain(this.noiseSrc(t, 0.08, n), out, this.filt("bandpass", 2200, 0.9), this.env(t, 0.001, 0.9, 0.08));
        this.boom(t, out, n, 110, 0.55, 1600, 0.85);
        return 0.6;
      case "torpedo":
        // launch: filtered noise sweep, then a muffled underwater boom
        {
          const src = this.noiseSrc(t, 0.45, n);
          const f = this.filt("bandpass", 600, 1.5);
          f.frequency.setValueAtTime(400, t);
          f.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
          this.chain(src, out, f, this.env(t, 0.03, 0.55, 0.45));
          this.chain(this.osc("sine", 180, 60, t, 0.15, n), out, this.env(t, 0.002, 0.5, 0.15));
        }
        this.boom(t + 0.45, out, n, 55, 1.1, 320, 1);
        this.chain(this.noiseSrc(t + 0.45, 0.6, n), out, this.filt("bandpass", 500, 0.7), this.env(t + 0.45, 0.01, 0.5, 0.6));
        return 1.6;
      case "broadside":
        for (let i = 0; i < 5; i++) {
          const ti = t + i * 0.06;
          this.chain(this.noiseSrc(ti, 0.1, n), out, this.filt("bandpass", 1600, 0.8), this.env(ti, 0.001, 0.9, 0.1));
          this.boom(ti, out, n, 65 - i * 5, 0.9, 1200, 0.85);
        }
        this.chain(this.osc("sine", 40, 28, t, 2.2, n), out, this.env(t, 0.05, 0.8, 2.2));
        this.chain(this.noiseSrc(t + 0.2, 2, n), out, this.filt("lowpass", 400), this.env(t + 0.2, 0.2, 0.5, 2));
        return 2.3;
      case "fighter": {
        const o = this.osc("sawtooth", 520, 210, t, 1.6, n);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        this.chain(o, out, this.filt("lowpass", 1400), g);
        this.chain(this.noiseSrc(t, 1.6, n), out, this.filt("bandpass", 900, 0.6), this.env(t, 0.7, 0.25, 1.6));
        for (let i = 0; i < 8; i++) this.chain(this.noiseSrc(t + 0.5 + i * 0.06, 0.05, n), out, this.filt("bandpass", 1300, 1), this.env(t + 0.5 + i * 0.06, 0.002, 0.3, 0.05));
        return 1.7;
      }
      case "dive":
      case "fled": {
        const fast = cat === "fled";
        const step = fast ? 0.15 : 0.4;
        const cycles = fast ? 6 : 3;
        for (let i = 0; i < cycles; i++) {
          const f = i % 2 ? 330 : 440;
          this.chain(this.osc("square", f, f, t + i * step, step * 0.9, n), out, this.filt("lowpass", 1800), this.env(t + i * step, 0.01, fast ? 0.32 : 0.22, step * 0.9));
        }
        const pt = t + cycles * step;
        this.chain(this.osc("sine", 1250, 1180, pt, 1.4, n), out, this.env(pt, 0.005, 0.3, 1.4));
        return cycles * step + 1.5;
      }
      case "surface":
        this.chain(this.noiseSrc(t, 1.3, n), out, this.filt("highpass", 1500), this.env(t, 0.08, 0.3, 1.3));
        return 1.4;
      case "sink":
        this.chain(this.osc("sawtooth", 70, 32, t, 2.2, n), out, this.filt("lowpass", 280, 4), this.env(t, 0.2, 0.5, 2.2));
        this.chain(this.noiseSrc(t + 0.3, 2, n), out, this.filt("lowpass", 600), this.env(t + 0.3, 0.3, 0.45, 2));
        return 2.4;
      case "reinforce":
        this.chain(this.osc("sawtooth", 110, 108, t, 1.2, n), out, this.filt("lowpass", 500), this.env(t, 0.1, 0.18, 1.2));
        this.chain(this.osc("sawtooth", 165, 162, t, 1.2, n), out, this.filt("lowpass", 500), this.env(t, 0.1, 0.12, 1.2));
        return 1.3;
      case "liquidation":
        this.chain(this.osc("sine", 1900, 380, t, 1.1, n), out, this.env(t, 0.05, 0.22, 1.1));
        this.boom(t + 1.1, out, n, 50, 1.2, 600, 1);
        return 2.4;
      case "cascade": {
        const o = this.osc("sine", 300, 300, t, 3.2, n);
        o.frequency.linearRampToValueAtTime(900, t + 1.5);
        o.frequency.linearRampToValueAtTime(300, t + 3.1);
        this.chain(o, out, this.env(t, 0.3, 0.3, 3.2));
        return 3.3;
      }
    }
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
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
/** Map world x to stereo pan. */
export const panX = (x: number, halfW: number) => Math.max(-1, Math.min(1, x / Math.max(halfW, 1)));
