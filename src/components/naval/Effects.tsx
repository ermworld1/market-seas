import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef, fx } from "@/lib/market/store";
import type { BattleEvent, BookSide, Weapon } from "@/lib/market/types";
import { tracersFor } from "@/lib/market/rules";
import { audio, panX } from "@/lib/audio/engine";
import { useModelGeometry } from "./models";
import { ParticlePool } from "./particles";
import { fireStats, GAP, DEPTH, type Display, sideSign, view, xFor, zFor } from "./layout";
import { makeFighterGeometry } from "./fighter";

const MAX_PROJ = 2400;
interface Proj {
  on: boolean;
  fx: number; fy: number; fz: number;
  tx: number; ty: number; tz: number;
  t: number; dur: number; arc: number; size: number; len: number;
  color: THREE.Color;
  weapon: Weapon | "bomb" | "cannon";
  target: Display | null;
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
}

const dummy = new THREE.Object3D();
const beamGeo = new THREE.CylinderGeometry(0.05, 1.6, 22, 12, 1, true).translate(0, 11, 0);
const beamMat = new THREE.MeshBasicMaterial({ color: "#fff3cf", transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
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
  const exact = view.displays.get(side + b);
  if (exact && !exact.departing) return exact;
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
  const fighterGeo = useMemo(() => makeFighterGeometry(), []);
  const planeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3d4236", metalness: 0.5, roughness: 0.55 }), []);
  const fighterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7d8790", metalness: 0.6, roughness: 0.4, flatShading: true }), []);
  const projMesh = useRef<THREE.InstancedMesh>(null);
  const projGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2), []);
  const projMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const projs = useMemo<Proj[]>(
    () => Array.from({ length: MAX_PROJ }, () => ({ on: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 0, dur: 1, arc: 0, size: 0.05, len: 0.3, color: COLORS.mg, weapon: "mg" as const, target: null })),
    [],
  );
  const planes = useMemo<Plane[]>(
    () => Array.from({ length: 8 }, (_, i) => ({ on: false, t: 0, dur: 1, ax: 0, az: 0, bx: 0, bz: 0, alt: 6, side: "bid" as BookSide, next: 0, kind: i < 4 ? ("bomber" as const) : ("fighter" as const) })),
    [],
  );
  const planeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shot = useRef(0);
  const cursor = useRef(0);

  useEffect(() => {
    const m = projMesh.current;
    if (m) for (let i = 0; i < MAX_PROJ; i++) m.setColorAt(i, COLORS.mg);
    return () => {
      projGeo.dispose();
      projMat.dispose();
      planeMat.dispose();
      fighterMat.dispose();
      fighterGeo.dispose();
    };
  }, [projGeo, projMat, planeMat, fighterMat, fighterGeo]);

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
    Object.assign(free, { arc: 0, size: 0.05, len: 0.3, target: null, ...p, on: true, t: 0 });
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
    const d = p.target;
    if (d && !d.departing && Math.random() < 0.9) {
      d.hitFlash = Math.min(1, d.hitFlash + 0.08 + power * 0.3);
      flash(p.tx, p.ty + 0.1, p.tz, 0.5 * power + 0.25);
      if (power > 0.5)
        for (let i = 0; i < 5 * power; i++)
          pools.glow.emit({ x: p.tx, y: p.ty + 0.1, z: p.tz, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.6, size: 0.16, color: "#ff8a2a", gravity: 5 });
      if (power > 0.3)
        for (let i = 0; i < 3 * power; i++)
          pools.smoke.emit({ x: p.tx, y: p.ty + 0.2, z: p.tz, vx: 0.2, vy: 0.8, life: 2, size: 0.35 * power + 0.2, grow: 2.5, color: "#2b2826", alpha: 0.7, drag: 0.5 });
      if (power >= 1) splash(p.tx, p.tz, power * 0.8);
    } else if (power > 0.2 || Math.random() < 0.35) splash(p.tx, p.tz, power * 0.7);
  };

  const fire = (ev: Extract<BattleEvent, { type: "fire" }>) => {
    const sSide: BookSide = ev.taker === "buy" ? "bid" : "ask";
    const sign = sideSign(sSide);
    const shooters = view.visible[sSide];
    const target = targetFor(ev.target, ev.b);
    const near = shooters.length ? shooters.slice(0, Math.min(8, shooters.length)) : [];
    const shooter: Display | null =
      ev.weapon === "broadside" ? (shooters.find((d) => d.tier === "battleship") ?? near[0] ?? null) : (near[shot.current++ % Math.max(1, near.length)] ?? null);
    const mx = shooter ? shooter.x : xFor(ev.b);
    const my = shooter ? 0.28 * shooter.s : 0.2;
    const mz = shooter ? shooter.z - sign * 0.25 * shooter.s : sign * GAP;
    const tx = target ? target.x : xFor(ev.b);
    const ty = target ? 0.18 * target.s : 0;
    const tz = target ? target.z : zFor(ev.target, ev.price);
    const base = { target };
    const pan = { x: panX(mx, view.halfW) };
    // one tracer per underlying fill (capped at 24)
    const n = tracersFor(ev.fills);
    for (let i = 0; i < n; i++)
      spawn({ ...base, weapon: "mg", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.35, ty, tz: tz + (Math.random() - 0.5) * 0.35, dur: 0.14 + i * 0.012, arc: 0.12, size: 0.03, len: 0.45 });
    engineRef.current && (engineRef.current.tracersSpawned += n);
    // near miss: trade printed in a bucket with no ship → splash where it landed
    if (!view.displays.get(ev.target + ev.b)) splash(xFor(ev.b), zFor(ev.target, ev.price), 0.35);
    const now = performance.now();
    if (fireStats.last) fireStats.maxGap = Math.max(fireStats.maxGap, now - fireStats.last);
    fireStats.last = now;
    if (ev.weapon === "mg") {
      flash(mx, my, mz, 0.3, "#ffe08a"); // muzzle flash on the taker fleet
      audio.play("mg", { ...pan, shots: n });
    } else if (ev.weapon === "gun") {
      flash(mx, my, mz, 0.55);
      for (let i = 0; i < 2; i++) spawn({ ...base, weapon: "gun", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.4, ty, tz, dur: 0.32 + i * 0.05, arc: 1.4, size: 0.06, len: 0.3 });
      audio.play("gun", pan);
    } else if (ev.weapon === "torpedo") {
      flash(mx, my, mz, 0.6);
      fx.shake = Math.min(1.2, fx.shake + 0.35);
      spawn({ ...base, weapon: "torpedo", fx: mx, fy: 0.01, fz: mz, tx, ty: 0.01, tz, dur: 0.45, size: 0.05, len: 0.5 });
      audio.play("torpedo", pan);
      audio.torpedoVoice();
    } else {
      fx.shake = Math.min(1.2, fx.shake + 0.8);
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
    Object.assign(p, init, { on: true, t: 0, next: 0 });
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05) * (fx.slowmo > 0 ? 0.35 : 1);
    const e = engineRef.current;
    for (const ev of view.frameEvents) {
      if (ev.type === "fire") {
        fire(ev);
        if (e) e.tradesVisualized++;
      } else if (ev.type === "fighter") {
        const pts = ev.buckets.map((b) => targetFor(ev.target, b)).filter(Boolean) as Display[];
        const a = pts[0];
        const z0 = a?.z ?? sideSign(ev.target) * (GAP + 2);
        const z1 = pts[pts.length - 1]?.z ?? z0 + sideSign(ev.target) * 3;
        const x0 = a?.x ?? 0;
        // strafe along the swept row: enter from the strait, exit past the last ship
        const dir = sideSign(ev.target);
        launch("fighter", { dur: 1.6, ax: x0 - 1.5, az: dir * GAP * 0.5 - dir * 2, bx: x0 + 1.5, bz: z1 + dir * 6, alt: 1.6, side: ev.target });
        void z0;
        audio.play("fighter", { x: panX(x0, view.halfW) });
      } else if (ev.type === "liquidation") {
        const side: BookSide = ev.liquidated === "longs" ? "bid" : "ask";
        const z = sideSign(side) * (GAP + DEPTH * 0.75);
        const span = view.halfW + 14;
        launch("bomber", { dur: 3.8, ax: span + view.offsetX, az: z, bx: -span + view.offsetX, bz: z, alt: 6, side });
        audio.play("liquidation");
      } else if (ev.type === "sink") {
        const d = view.displays.get(ev.side + ev.b);
        if (d) splash(d.x, d.z, Math.min(2, 0.6 + d.s * 0.4));
      }
    }

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
      const x = p.ax + (p.bx - p.ax) * u;
      const z = p.az + (p.bz - p.az) * u;
      m.visible = true;
      m.position.set(x, p.alt + Math.sin(p.t * 2) * 0.1, z);
      m.rotation.set(0, Math.atan2(-(p.bz - p.az), p.bx - p.ax) + Math.PI, p.kind === "fighter" ? Math.sin(p.t * 3) * 0.3 : 0);
      if (p.kind === "bomber") {
        if (Math.abs(x - view.offsetX) < view.halfW + 1 && p.t >= p.next) {
          p.next = p.t + 0.2;
          const rear = view.visible[p.side];
          const target = rear.length ? rear[Math.max(0, rear.length - 1 - Math.floor(Math.random() * Math.min(10, rear.length)))]! : null;
          const tx = x - 1.2;
          const tz = p.az + (Math.random() - 0.5) * 3;
          const hit = target && Math.abs(target.x - tx) < 3 ? target : null;
          spawn({ weapon: "bomb", fx: x, fy: p.alt - 0.3, fz: z, tx: hit ? hit.x : tx, ty: hit ? 0.2 * hit.s : 0, tz: hit ? hit.z : tz, dur: 0.75, size: 0.08, len: 0.25, target: hit });
        }
      } else if (p.t >= p.next && u > 0.1 && u < 0.85) {
        p.next = p.t + 0.05;
        spawn({ weapon: "cannon", fx: x, fy: p.alt, fz: z, tx: x + (Math.random() - 0.5) * 0.4, ty: 0.1, tz: z + sideSign(p.side) * 1.2, dur: 0.18, size: 0.035, len: 0.5, target: null });
      }
      if (u >= 1) p.on = false;
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
      dummy.position.copy(tmpA);
      dummy.lookAt(tmpB);
      dummy.scale.set(p.size, p.size, p.len);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      m.setColorAt(n, p.color);
      n++;
    }
    if (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    pools.glow.update(dt);
    pools.smoke.update(dt);
    // searchlights sweeping the night sky from the rear of each fleet
    lightRefs.current.forEach((l, i) => {
      if (!l) return;
      const side = i < 2 ? -1 : 1;
      l.position.set(view.offsetX + (i % 2 ? 1 : -1) * view.halfW * 0.55, 0, side * (GAP + DEPTH + 1));
      l.rotation.set(side * -0.5 + Math.sin(view.time * 0.23 + i * 1.7) * 0.25, 0, Math.sin(view.time * 0.31 + i * 2.3) * 0.6);
    });
  });

  return (
    <group>
      <primitive object={pools.smoke.points} />
      <primitive object={pools.glow.points} />
      {[0, 1, 2, 3].map((i) => (
        <mesh key={"sl" + i} ref={(r) => { lightRefs.current[i] = r; }} geometry={beamGeo} material={beamMat} frustumCulled={false} />
      ))}
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
