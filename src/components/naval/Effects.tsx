import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef, fx } from "@/lib/market/store";
import type { BattleEvent, BookSide, Weapon } from "@/lib/market/types";
import { tracersFor } from "@/lib/market/rules";
import { audio, panX } from "@/lib/audio/engine";
import { makeAircraftMaterial, useModelGeometry } from "./models";
import { ParticlePool } from "./particles";
import { displayFor, fireStats, GAP, DEPTH, REAR, type Display, sideSign, view, xForPrice, zForBucket } from "./layout";
import { introArrived, INTRO_MS } from "@/lib/market/positioning";

const MAX_PROJ = 2400;
interface Proj {
  on: boolean;
  fx: number; fy: number; fz: number;
  tx: number; ty: number; tz: number;
  t: number; dur: number; arc: number; size: number; len: number;
  color: THREE.Color;
  weapon: Weapon | "bomb" | "cannon";
  /** liquidation notional for the first bomb of a liquidation bomber: plays the big blast */
  blast?: number;
  target: Display | null;
  side?: BookSide;
}
interface Plane {
  on: boolean;
  t: number;
  dur: number;
  ax: number; az: number; bx: number; bz: number;
  alt: number;
  side: BookSide;
  next: number;
  kind: "bomber" | "fighter";
  bank?: number;
  formation?: number;
  /** real liquidated notional carried by a liquidation bomber (drives the impact blast) */
  notional?: number;
}

const dummy = new THREE.Object3D();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const axis = new THREE.Vector3();
const toCam = new THREE.Vector3();
const side = new THREE.Vector3();
const up = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lastMg = { buy: 0, sell: 0 };
const lastGun = { buy: 0, sell: 0 };
const pendingShots = { buy: 0, sell: 0 };
const mat4 = new THREE.Matrix4();
let mgThisFrame = 0;
const COLORS = {
  mg: new THREE.Color(1.5, 1.1, 0.35),
  gun: new THREE.Color(2.0, 0.95, 0.25),
  torpedo: new THREE.Color(0.15, 0.17, 0.18),
  broadside: new THREE.Color(2.3, 1.45, 0.5),
  bomb: new THREE.Color(0.08, 0.08, 0.08),
  cannon: new THREE.Color(1.8, 1.4, 0.6),
};
const POWER: Record<Proj["weapon"], number> = { mg: 0.15, cannon: 0.25, gun: 0.55, torpedo: 1.1, broadside: 1.4, bomb: 1.6 };

/** Find the target ship for a bucket; if it is gone, continue into the next ship deeper in the book. */
function targetFor(side: BookSide, b: number): Display | null {
  const list = view.visible[side];
  if (!list.length) return null;
  const exact = view.bucketVisual.get(side + b) ?? view.displays.get(side + b);
  if (exact && !exact.departing && view.visible[side].includes(exact)) return exact;
  // asks: next higher bucket; bids: next lower bucket
  let best: Display | null = null;
  for (const d of list) {
    const ahead = side === "ask" ? d.b >= b : d.b <= b;
    if (!ahead) continue;
    if (!best || Math.abs(d.b - b) < Math.abs(best.b - b)) best = d;
  }
  return best ?? list[0]!;
}

export function Effects() {
  const pools = useMemo(() => {
    const glow = new ParticlePool(1400, true);
    const smoke = new ParticlePool(2000, false);
    view.fx.glow = glow;
    view.fx.smoke = smoke;
    return { glow, smoke };
  }, []);
  useEffect(
    () => () => {
      pools.glow.dispose();
      pools.smoke.dispose();
      view.fx.glow = null;
      view.fx.smoke = null;
    },
    [pools],
  );

  const bomberGeo = useModelGeometry("bomber");
  const fighterGeo = useModelGeometry("fighter");
  // aircraft wear the colour of the side that sends them (the opposite of the side they attack)
  const airMats = useMemo(() => ({ bid: makeAircraftMaterial(), ask: makeAircraftMaterial() }), []);
  const planeMat = airMats.ask;
  const fighterMat = airMats.bid;
  const projMesh = useRef<THREE.InstancedMesh>(null);
  // camera-facing streak: a unit quad in the XZ plane (length along Z), tapered by a soft alpha texture
  const projGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const projMat = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(0.75, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0.6)");
    g.fillStyle = grad; g.fillRect(0, 0, 8, 64);
    const side = g.createLinearGradient(0, 0, 8, 0);
    side.addColorStop(0, "rgba(0,0,0,1)"); side.addColorStop(0.5, "rgba(0,0,0,0)"); side.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = side; g.fillRect(0, 0, 8, 64);
    const tex = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ toneMapped: false, map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  }, []);
  const projs = useMemo<Proj[]>(
    () => Array.from({ length: MAX_PROJ }, () => ({ on: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 0, dur: 1, arc: 0, size: 0.05, len: 0.3, color: COLORS.mg, weapon: "mg" as const, target: null })),
    [],
  );
  const planes = useMemo<Plane[]>(
    () => Array.from({ length: 16 }, (_, i) => ({ on: false, t: 0, dur: 1, ax: 0, az: 0, bx: 0, bz: 0, alt: 6, side: "bid" as BookSide, next: 0, kind: i < 12 ? ("bomber" as const) : ("fighter" as const) })),
    [],
  );
  const planeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const voices = useRef<(ReturnType<typeof audio.aircraftStart>)[]>([]);
  const gunsOn = useRef<boolean[]>([]);
  const bombed = useRef<boolean[]>([]);
  const prevDist = useRef<number[]>([]);
  useEffect(() => () => { voices.current.forEach((v) => v?.stop()); }, []);
  const lastPlane = useRef<Plane | null>(null);
  const boom = useRef({ x: 0, z: 0, k: 0 });
  const boomLight = useRef<THREE.PointLight>(null);
  const flakT = useRef(0);
  const planeDirV = useMemo(() => ({ x: 1, z: 0 }), []);
  const planeAnchor = useRef({ x: 0, y: 0, z: 0 });
  const shot = useRef(0);
  const cursor = useRef(0);
  const pendingFire = useRef<Extract<BattleEvent, { type: "fire" }>[]>([]);

  useEffect(() => {
    const m = projMesh.current;
    if (m) for (let i = 0; i < MAX_PROJ; i++) m.setColorAt(i, COLORS.mg);
    return () => {
      projGeo.dispose();
      projMat.dispose();
      airMats.bid.dispose();
      airMats.ask.dispose();
    };
  }, [projGeo, projMat, airMats]);

  /** Never drops a shot: when the pool is full the oldest projectile is recycled. */
  const spawn = (p: Partial<Proj> & Pick<Proj, "fx" | "fy" | "fz" | "tx" | "ty" | "tz" | "dur" | "weapon">) => {
    let free: Proj | undefined;
    for (let k = 0; k < MAX_PROJ; k++) {
      const q = projs[(cursor.current + k) % MAX_PROJ]!;
      if (!q.on) {
        free = q;
        cursor.current = (cursor.current + k + 1) % MAX_PROJ;
        break;
      }
    }
    if (!free) {
      free = projs[cursor.current]!;
      cursor.current = (cursor.current + 1) % MAX_PROJ;
    }
    Object.assign(free, { arc: 0, size: 0.05, len: 0.3, target: null, blast: undefined, ...p, on: true, t: 0 });
    free.color = COLORS[p.weapon];
  };

  const splash = (x: number, z: number, power: number) => {
    const n = Math.round(4 + power * 14);
    for (let i = 0; i < n; i++)
      pools.smoke.emit({ x: x + (Math.random() - 0.5) * 0.3 * power, y: 0.05, z: z + (Math.random() - 0.5) * 0.3 * power, vx: (Math.random() - 0.5) * 1.5 * power, vy: 2 + Math.random() * 3.5 * power, vz: (Math.random() - 0.5) * 1.5 * power, life: 0.9 + power * 0.4, size: 0.16 + Math.random() * 0.22 * power, grow: 1.4, color: "#f4fbff", alpha: 0.85, gravity: 7 });
    for (let i = 0; i < 2 + power * 3; i++)
      pools.smoke.emit({ x: x + (Math.random() - 0.5) * power, y: 0.03, z: z + (Math.random() - 0.5) * power, life: 2.2, size: 0.45 * power + 0.25, grow: 2.5, color: "#dde9ee", alpha: 0.5 });
  };
  const flash = (x: number, y: number, z: number, size: number, color = "#ffb347") => pools.glow.emit({ x, y, z, life: 0.16, size, grow: 0.6, color, alpha: 1 });

  const impact = (p: Proj) => {
    const power = POWER[p.weapon];
    // bombs explode loudly on the aircraft bus so they are not ducked with the ships' guns
    if (p.weapon === "bomb") {
      if (p.blast) audio.liquidationBlast(p.blast, panX(p.tx - view.frontX, REAR));
      else audio.play("sink", { x: panX(p.tx - view.frontX, REAR), gain: 0.45, bus: "air" });
    }
    const d = p.target;
    if (d && !d.departing && Math.random() < 0.9) {
      d.hitFlash = Math.min(1, d.hitFlash + 0.08 + power * 0.3);
      audio.play("hit", { x: panX(p.tx - view.frontX, REAR), gain: 0.5 + power * 0.4 });
      flash(p.tx, p.ty + 0.1, p.tz, 0.5 * power + 0.25);
      if (power > 0.5)
        for (let i = 0; i < 5 * power; i++)
          pools.glow.emit({ x: p.tx, y: p.ty + 0.1, z: p.tz, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.6, size: 0.16, color: "#ff8a2a", gravity: 5 });
      if (power > 0.3)
        for (let i = 0; i < 3 * power; i++)
          pools.smoke.emit({ x: p.tx, y: p.ty + 0.2, z: p.tz, vx: 0.2, vy: 0.8, life: 2, size: 0.35 * power + 0.2, grow: 2.5, color: "#2b2826", alpha: 0.7, drag: 0.5 });
      if (power >= 1) {
        splash(p.tx, p.tz, power * 0.8);
        // fireball + debris + tall water column + light flash on the water
        pools.glow.emit({ x: p.tx, y: p.ty + 0.4, z: p.tz, vy: 0.8, life: 0.7, size: 1.6 * power, grow: 1.2, color: "#ff9a3a", alpha: 1 });
        for (let i = 0; i < 8 * power; i++) pools.glow.emit({ x: p.tx, y: p.ty + 0.3, z: p.tz, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 1.1, size: 0.09, color: "#3a2a20", alpha: 1, gravity: 9 });
        for (let i = 0; i < 10; i++) pools.smoke.emit({ x: p.tx + (Math.random() - 0.5) * 0.3, y: 0.1, z: p.tz + (Math.random() - 0.5) * 0.3, vy: 5 + Math.random() * 4, life: 1.4, size: 0.4, grow: 1.6, color: "#f2f8fb", alpha: 0.85, gravity: 6 });
        boom.current = { x: p.tx, z: p.tz, k: 1 };
      }
    } else if (power > 0.2 || Math.random() < 0.35) { audio.play("miss", { x: panX(p.tx - view.frontX, REAR), gain: 0.35 + power * 0.25 }); splash(p.tx, p.tz, power * 0.7); }
  };

  const fire = (ev: Extract<BattleEvent, { type: "fire" }>) => {
    const sSide: BookSide = ev.taker === "buy" ? "bid" : "ask";
    const sign = sideSign(sSide);
    const shooters = view.visible[sSide];
    const target = targetFor(ev.target, ev.b);
    const near = shooters.length ? shooters.slice(0, Math.min(8, shooters.length)) : [];
    const shooter: Display | null =
      ev.weapon === "broadside" ? (shooters.find((d) => d.tier === "battleship") ?? near[0] ?? null) : (near[shot.current++ % Math.max(1, near.length)] ?? null);
    const mx = shooter ? shooter.x - sign * 0.25 * shooter.s : view.frontX - sign * GAP;
    const my = shooter ? 0.28 * shooter.s : 0.2;
    const mz = shooter ? shooter.z : zForBucket(ev.b);
    const tx = target ? target.x : xForPrice(ev.target, ev.price);
    const ty = target ? 0.18 * target.s : 0;
    const tz = target ? target.z : zForBucket(ev.b);
    const base = { target, side: sSide };
    if (ev.notional >= 250_000 || ev.weapon === "broadside") view.track = { side: sSide, fx: mx, fz: mz, tx, tz, t0: view.time, dur: ev.weapon === "torpedo" ? 0.45 : 0.35 };
    if (ev.weapon === "broadside") { fx.slowmo = Math.max(fx.slowmo, 0.5); fx.slowScale = 0.4; }
    // guns are heard from the firing fleet: Buyers' guns on the left speaker, Sellers' on the right
    const pan = { x: sign * (0.35 + 0.55 * Math.min(1, Math.abs(mx - view.frontX) / REAR)), dist: Math.min(1, Math.abs(mx - view.cameraX) / (REAR * 1.2)) };
    // one tracer per underlying fill (capped at 24)
    const n = tracersFor(ev.fills);
    for (let i = 0; i < n; i++)
      spawn({ ...base, weapon: "mg", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.18, ty, tz: tz + (Math.random() - 0.5) * 0.35, dur: 0.14 + i * 0.012, arc: 0.12, size: 0.03, len: 0.45 });
    engineRef.current && (engineRef.current.tracersSpawned += n);
    // near miss: trade printed in a bucket with no ship → splash where it landed
    if (!displayFor(ev.target, ev.b)) splash(xForPrice(ev.target, ev.price), zForBucket(ev.b), 0.35);
    const now = performance.now();
    const wall = Date.now();
    if (fireStats.last) fireStats.maxGap = Math.max(fireStats.maxGap, now - fireStats.last);
    if (fireStats.lastWall) fireStats.maxGapActive = Math.max(fireStats.maxGapActive, wall - Math.max(fireStats.lastWall, ev.t));
    if (fireStats.recvLast) fireStats.maxRecvGap = Math.max(fireStats.maxRecvGap, ev.t - fireStats.recvLast);
    fireStats.recvLast = Math.max(fireStats.recvLast, ev.t);
    fireStats.maxLag = Math.max(fireStats.maxLag, wall - ev.t);
    fireStats.last = now;
    fireStats.lastWall = wall;
    if (ev.weapon === "mg") {
      flash(mx, my, mz, 0.3, "#ffe08a"); // muzzle flash on the taker fleet
      // dense frames merge into volleys: every trade still fires its tracers; the sound merges shots
      // one machine-gun burst per side every 0.2 s at most; trades in between join the next burst.
      // (one sound per trade made a constant crackle at Binance's trade rate)
      const sideKey = ev.taker;
      const t0 = performance.now();
      pendingShots[sideKey] += n;
      if (t0 - lastMg[sideKey] >= 110) {
        lastMg[sideKey] = t0;
        audio.play("mg", { ...pan, shots: pendingShots[sideKey], gain: Math.min(1, 0.55 + pendingShots[sideKey] * 0.03) });
        pendingShots[sideKey] = 0;
      } else audio.mergeShots(n);
    } else if (ev.weapon === "gun") {
      flash(mx, my, mz, 0.55);
      for (let i = 0; i < 2; i++) spawn({ ...base, weapon: "gun", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.4, ty, tz, dur: 0.32 + i * 0.05, arc: 1.4, size: 0.06, len: 0.3 });
      const t1 = performance.now();
      if (t1 - lastGun[ev.taker] >= 120) { lastGun[ev.taker] = t1; audio.play("gun", pan); } else audio.mergeShots(1);
    } else if (ev.weapon === "torpedo") {
      flash(mx, my, mz, 0.6);
      // no camera shake for torpedoes: they are frequent and constant shake read as ships jumping
      spawn({ ...base, weapon: "torpedo", fx: mx, fy: 0.01, fz: mz, tx, ty: 0.01, tz, dur: 0.45, size: 0.05, len: 0.5 });
      audio.play("gun5", pan);
      audio.play("torpedo", { ...pan, gain: 0.55 });
      audio.torpedoVoice(ev.target);
    } else {
      fx.shake = Math.min(0.7, fx.shake + 0.45);
      const s = shooter?.s ?? 1;
      for (let i = 0; i < 6; i++) {
        const ox = (i - 2.5) * 0.12 * s;
        flash(mx + ox, my, mz, 1.1, "#ffd27a");
        spawn({ ...base, weapon: "broadside", fx: mx + ox, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.8, ty, tz: tz + (Math.random() - 0.5) * 0.6, dur: 0.4 + i * 0.015, arc: 2.4, size: 0.09, len: 0.4 });
      }
      audio.play("broadside", pan);
    }
  };

  const launch = (kind: Plane["kind"], init: Omit<Plane, "on" | "t" | "next" | "kind">) => {
    const p = planes.find((q) => !q.on && q.kind === kind);
    if (!p) return;
    Object.assign(p, { formation: undefined, notional: undefined, bank: undefined }, init, { on: true, t: 0, next: 0 });
    const mesh = planeRefs.current[planes.indexOf(p)];
    if (mesh) mesh.material = airMats[p.side === "bid" ? "ask" : "bid"];
    lastPlane.current = p;
  };

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05) * (fx.slowmo > 0 ? fx.slowScale : 1);
    // point-sprite scale: perspective cameras need focal-length based sizing
    const cam = state.camera as THREE.PerspectiveCamera;
    const scale = cam.isPerspectiveCamera ? (0.2 * state.size.height) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) : 600;
    for (const pool of [pools.glow, pools.smoke]) (pool.points.material as THREE.ShaderMaterial).uniforms["uScale"]!.value = scale;
    if (cam.isPerspectiveCamera) camPos.copy(cam.position);
    else camPos.copy(cam.position).sub(state.camera.getWorldDirection(axis).multiplyScalar(1000)); // ortho: view from infinity
    mgThisFrame = 0;
    const e = engineRef.current;
    const introElapsed = performance.now() - view.introStartedAt;
    const incoming = view.frameEvents.filter((event): event is Extract<BattleEvent, { type: "fire" }> => event.type === "fire");
    pendingFire.current.push(...incoming);
    const readyFire: Extract<BattleEvent, { type: "fire" }>[] = [];
    pendingFire.current = pendingFire.current.filter((ev) => {
      const target = targetFor(ev.target, ev.b);
      const shooterSide: BookSide = ev.taker === "buy" ? "bid" : "ask";
      const shooter = view.visible[shooterSide][0];
      const ready = introElapsed >= INTRO_MS || (!!target && !!shooter && introArrived(target.tier, introElapsed) && introArrived(shooter.tier, introElapsed));
      if (ready) readyFire.push(ev);
      return !ready;
    });
    for (const ev of [...view.frameEvents.filter((event) => event.type !== "fire"), ...readyFire]) {
      if (ev.type === "fire") {
        fire(ev);
        if (e) e.tradesVisualized++;
      } else if (ev.type === "fighter") {
        const pts = ev.buckets.map((b) => targetFor(ev.target, b)).filter(Boolean) as Display[];
        const a = pts[0];
        const z0 = a?.z ?? zForBucket(ev.buckets[0] ?? 0);
        const last = pts[pts.length - 1];
        const x1 = last?.x ?? view.frontX + sideSign(ev.target) * (GAP + 5);
        const x0 = a?.x ?? view.frontX;
        // strafe horizontally through the swept price buckets
        const dir = sideSign(ev.target);
        const attacker = ev.target === "ask" ? "bid" : "ask";
        const rear = view.frontX + sideSign(attacker) * REAR;
        const targetX = x1 + dir * 4;
        for (let i = 0; i < ev.formation; i++) {
          const row = Math.floor(i / 2);
          const wing = i === 0 ? 0 : i % 2 ? -1 : 1;
          launch("fighter", { dur: 3.1 + row * 0.12, ax: rear - sideSign(attacker) * row * 0.8, az: z0 + wing * (0.75 + row * 0.35), bx: targetX, bz: z0 + wing * 0.28, alt: 0.65 + row * 0.12, side: ev.target, formation: i });
        }
        view.fighterWaves++;

      } else if (ev.type === "liquidation") {
        const side: BookSide = ev.liquidated === "longs" ? "bid" : "ask";
        const x = view.frontX + sideSign(side) * (GAP + DEPTH * 0.82);
        const span = view.halfW + 14;
        launch("bomber", { dur: 3.8, ax: x, az: -span, bx: x, bz: span, alt: 6, side, notional: ev.notional });
        if (engineRef.current?.phase.current === "P5") {
          const cap = view.quality === "low" ? 5 : view.quality === "medium" ? 8 : 12;
          const wave = Math.max(2, Math.min(cap, Math.round(ev.notional / 75_000) + 1)); // scaled by the real liquidation size
          for (let i = 1; i < wave; i++) launch(i % 3 ? "bomber" : "fighter", { dur: 3.2 + i * 0.12, ax: x + (Math.random() - 0.5) * 7, az: -span - i, bx: view.frontX, bz: span + i, alt: 4 + Math.random() * 5, side, formation: i });
        }
      } else if (ev.type === "sink") {
        const d = displayFor(ev.side, ev.b);
        if (d) splash(d.x, d.z, Math.min(2, 0.6 + d.s * 0.4));
      }
    }

    view.planeActive = !!lastPlane.current?.on;
    // planes
    planes.forEach((p, i) => {
      const m = planeRefs.current[i];
      if (!m) return;
      if (!p.on) {
        m.visible = false;
        return;
      }
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      // engine sound lives exactly as long as this aircraft is visible
      if (!voices.current[i]) { voices.current[i] = audio.aircraftStart(p.kind, p.dur, !p.formation); gunsOn.current[i] = false; bombed.current[i] = false; prevDist.current[i] = 0; }
      const pull = p.kind === "fighter" ? Math.max(0, (u - 0.72) / 0.28) : 0;
      const x = p.ax + (p.bx - p.ax) * u;
      const z = p.az + (p.bz - p.az) * u + pull * pull * (p.formation && p.formation % 2 ? -2 : 2);
      m.visible = true;
      m.position.set(x, p.alt + Math.sin(p.t * 2) * 0.1 + pull * pull * 4.5, z);
      if (p === lastPlane.current) { const a = planeAnchor.current; a.x = x; a.y = m.position.y; a.z = z; view.plane = a; const L = Math.hypot(p.bx - p.ax, p.bz - p.az) || 1; planeDirV.x = (p.bx - p.ax) / L; planeDirV.z = (p.bz - p.az) / L; view.planeDir = planeDirV; }
      m.rotation.set(0, Math.atan2(-(p.bz - p.az), p.bx - p.ax) + Math.PI, p.kind === "fighter" ? Math.sin(p.t * 3) * 0.12 + pull * (p.formation && p.formation % 2 ? -0.8 : 0.8) : 0);
      if (p.kind === "bomber") {
        if (Math.abs(z) < view.halfW + 1 && p.t >= p.next) {
          p.next = p.t + 0.2;
          const rear = view.visible[p.side];
          const target = rear.length ? rear[Math.max(0, rear.length - 1 - Math.floor(Math.random() * Math.min(10, rear.length)))]! : null;
          const tx = p.ax + (Math.random() - 0.5) * 2;
          const tz = z - 1.2;
          const hit = target && Math.abs(target.z - tz) < 3 ? target : null;
          const firstBomb = !bombed.current[i];
          spawn({ weapon: "bomb", fx: x, fy: p.alt - 0.3, fz: z, tx: hit ? hit.x : tx, ty: hit ? 0.2 * hit.s : 0, tz: hit ? hit.z : tz, dur: 0.75, size: 0.08, len: 0.25, target: hit, ...(firstBomb && p.notional ? { blast: p.notional } : {}) });
          if (firstBomb) { bombed.current[i] = true; voices.current[i]?.bomb(0.75); }
        }
      } else if (p.t >= p.next && u > 0.1 && u < 0.85) {
        p.next = p.t + 0.05;
        spawn({ weapon: "cannon", fx: x, fy: p.alt, fz: z, tx: x + sideSign(p.side) * 1.2, ty: 0.1, tz: z + (Math.random() - 0.5) * 0.4, dur: 0.18, size: 0.035, len: 0.5, target: null });
        if (Math.random() < 0.45) splash(x + sideSign(p.side) * 1.2, z, 0.22);
        if (u < 0.3 || pull > 0) pools.smoke.emit({ x, y: m.position.y, z, life: 1.2, size: 0.05, grow: 1.1, color: "#eef4f5", alpha: 0.42 });
      }
      const vce = voices.current[i];
      if (vce) {
        const d = m.position.distanceTo(camPos);
        const vRad = prevDist.current[i] ? (prevDist.current[i]! - d) / Math.max(dt, 1e-3) : 0;
        prevDist.current[i] = d;
        // loudness from on-screen distance to the action, not from the camera (the map camera sits far away)
        const close = Math.max(0, 1 - Math.abs(x - view.cameraX) / (view.halfW * 2.2 + REAR));
        vce.update(panX(x - view.frontX, REAR), 0.45 + 0.55 * close, 1 + Math.max(-0.25, Math.min(0.25, vRad / 120)), pull);
        if (p.kind === "fighter" && !gunsOn.current[i] && u > 0.1) { gunsOn.current[i] = true; vce.guns(p.dur * 0.75, panX(x - view.frontX, REAR)); }
      }
      if (u >= 1) {
        p.on = false;
        voices.current[i]?.stop();
        voices.current[i] = null;
      }
    });

    // projectiles
    const m = projMesh.current;
    let n = 0;
    for (const p of projs) {
      if (!p.on) continue;
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);

      const h = p.arc * 4 * u * (1 - u);
      tmpA.set(p.fx + (p.tx - p.fx) * u, p.fy + (p.ty - p.fy) * u + h, p.fz + (p.tz - p.fz) * u);
      if (p.weapon === "torpedo" && Math.random() < 0.9) pools.smoke.emit({ x: tmpA.x, y: 0.03, z: tmpA.z, life: 1.2, size: 0.2, grow: 2.2, color: "#eef7fa", alpha: 0.7 });
      if (u >= 1) {
        p.on = false;
        impact(p);
        continue;
      }
      if (!m) continue;
      const u2 = Math.min(1, u + 0.02);
      const h2 = p.arc * 4 * u2 * (1 - u2);
      tmpB.set(p.fx + (p.tx - p.fx) * u2, p.fy + (p.ty - p.fy) * u2 + h2, p.fz + (p.tz - p.fz) * u2);
      // billboard around the flight axis; width/length shrink near the camera so close tracers stay thin streaks
      axis.subVectors(tmpB, tmpA);
      if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0);
      axis.normalize();
      toCam.subVectors(camPos, tmpA);
      const dist = toCam.length();
      side.crossVectors(axis, toCam).normalize();
      up.crossVectors(side, axis);
      const near = Math.min(1, dist / 14);
      const w = Math.max(0.006, p.size * 1.4 * near);
      const len = p.len * (0.35 + 0.65 * near);
      mat4.makeBasis(side.multiplyScalar(w), up, axis.multiplyScalar(len));
      mat4.setPosition(tmpA);
      m.setMatrixAt(n, mat4);
      m.setColorAt(n, p.color);
      n++;
    }
    if (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // impact light flash on the water
    const bl = boomLight.current;
    if (bl) { boom.current.k = Math.max(0, boom.current.k - dt * 3); bl.intensity = boom.current.k * 40; bl.position.set(boom.current.x, 1.2, boom.current.z); bl.visible = boom.current.k > 0.01; }
    // flak: black puffs with flashes whenever real aircraft are in the sky
    let active = 0;
    for (const q of planes) if (q.on) active++;
    if (active) {
      flakT.current -= dt;
      if (flakT.current <= 0) {
        flakT.current = (view.quality === "low" ? 0.35 : view.quality === "medium" ? 0.18 : 0.09) / Math.min(4, active);
        const fx0 = view.frontX + (Math.random() - 0.5) * REAR * 1.6, fy0 = 3 + Math.random() * 6, fz0 = (Math.random() - 0.5) * view.halfW * 2;
        pools.glow.emit({ x: fx0, y: fy0, z: fz0, life: 0.12, size: 0.9, grow: 0.4, color: "#ffd890", alpha: 1 });
        pools.smoke.emit({ x: fx0, y: fy0, z: fz0, vy: 0.1, life: 2.6, size: 0.7, grow: 1.8, color: "#141414", alpha: 0.8, drag: 0.8 });
        if (Math.random() < 0.28) audio.play("flak", { x: panX(fx0 - view.frontX, REAR), gain: 0.55 });
      }
    }
    pools.glow.update(dt);
    pools.smoke.update(dt);
  });

  return (
    <group>
      <pointLight ref={boomLight} color="#ff9a4a" distance={14} decay={1.6} intensity={0} />
      <primitive object={pools.smoke.points} />
      <primitive object={pools.glow.points} />
      <instancedMesh ref={projMesh} args={[projGeo, projMat, MAX_PROJ]} frustumCulled={false} />
      {planes.map((p, i) => (
        <mesh
          key={i}
          ref={(r) => {
            planeRefs.current[i] = r;
          }}
          geometry={p.kind === "bomber" ? bomberGeo : fighterGeo}
          material={p.kind === "bomber" ? planeMat : fighterMat}
          scale={p.kind === "bomber" ? 3 : 0.9}
          visible={false}
        />
      ))}
    </group>
  );
}
