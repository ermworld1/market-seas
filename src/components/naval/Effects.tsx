import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { fx } from "@/lib/market/store";
import type { BookSide, Weapon } from "@/lib/market/types";
import { useModelGeometry } from "./models";
import { ParticlePool } from "./particles";
import { DEPTH, GAP, type Display, sideSign, view } from "./layout";

const MAX_PROJ = 360;
interface Proj {
  on: boolean;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  t: number;
  dur: number;
  arc: number;
  size: number;
  len: number;
  color: THREE.Color;
  weapon: Weapon | "bomb";
  target: Display | null;
  hitFrac: number;
}
interface Bomber {
  on: boolean;
  t: number;
  z: number;
  side: BookSide;
  nextDrop: number;
}

const dummy = new THREE.Object3D();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const COLORS = {
  mg: new THREE.Color(1.6, 1.15, 0.35),
  gun: new THREE.Color(2.2, 1.0, 0.25),
  torpedo: new THREE.Color(0.15, 0.17, 0.18),
  broadside: new THREE.Color(2.4, 1.5, 0.5),
  bomb: new THREE.Color(0.08, 0.08, 0.08),
};

export function Effects() {
  const pools = useMemo(() => {
    const glow = new ParticlePool(900, true);
    const smoke = new ParticlePool(1400, false);
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
  const bomberMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3d4236", metalness: 0.5, roughness: 0.55 }),
    [],
  );
  const projMesh = useRef<THREE.InstancedMesh>(null);
  const projGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).rotateX(Math.PI / 2), []);
  const projMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const projs = useMemo<Proj[]>(
    () =>
      Array.from({ length: MAX_PROJ }, () => ({
        on: false,
        fx: 0,
        fy: 0,
        fz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        t: 0,
        dur: 1,
        arc: 0,
        size: 0.05,
        len: 0.3,
        color: COLORS.mg,
        weapon: "mg",
        target: null,
        hitFrac: 0,
      })),
    [],
  );
  const bombers = useMemo<Bomber[]>(() => Array.from({ length: 3 }, () => ({ on: false, t: 0, z: 0, side: "bid", nextDrop: 0 })), []);
  const bomberRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shot = useRef(0);

  useEffect(() => {
    const m = projMesh.current;
    if (m) for (let i = 0; i < MAX_PROJ; i++) m.setColorAt(i, COLORS.mg);
    return () => {
      projGeo.dispose();
      projMat.dispose();
      bomberMat.dispose();
    };
  }, [projGeo, projMat, bomberMat]);

  const spawn = (p: Partial<Proj> & Pick<Proj, "fx" | "fy" | "fz" | "tx" | "ty" | "tz" | "dur" | "weapon">) => {
    const free = projs.find((q) => !q.on);
    if (!free) return;
    Object.assign(free, { arc: 0, size: 0.05, len: 0.3, target: null, hitFrac: 0, ...p, on: true, t: 0 });
    free.color = COLORS[p.weapon];
  };

  const splash = (x: number, z: number, power: number) => {
    const n = Math.round(6 + power * 16);
    for (let i = 0; i < n; i++)
      pools.smoke.emit({
        x: x + (Math.random() - 0.5) * 0.3 * power,
        y: 0.05,
        z: z + (Math.random() - 0.5) * 0.3 * power,
        vx: (Math.random() - 0.5) * 1.5 * power,
        vy: 2 + Math.random() * 3.5 * power,
        vz: (Math.random() - 0.5) * 1.5 * power,
        life: 0.9 + power * 0.4,
        size: 0.18 + Math.random() * 0.25 * power,
        grow: 1.4,
        color: "#f4fbff",
        alpha: 0.85,
        gravity: 7,
      });
    for (let i = 0; i < 3 + power * 4; i++)
      pools.smoke.emit({
        x: x + (Math.random() - 0.5) * power,
        y: 0.03,
        z: z + (Math.random() - 0.5) * power,
        life: 2.2,
        size: 0.5 * power + 0.3,
        grow: 2.5,
        color: "#dde9ee",
        alpha: 0.5,
      });
  };

  const flash = (x: number, y: number, z: number, size: number, color = "#ffb347") => {
    pools.glow.emit({ x, y, z, life: 0.18, size, grow: 0.6, color, alpha: 1 });
  };

  const impact = (p: Proj) => {
    const power = p.weapon === "mg" ? 0.2 : p.weapon === "gun" ? 0.55 : p.weapon === "torpedo" ? 1.1 : p.weapon === "broadside" ? 1.4 : 1.6;
    const d = p.target;
    const onShip = d && !d.departing && Math.random() < 0.85;
    if (onShip && d) {
      d.hitFlash = Math.min(1, d.hitFlash + 0.25 + p.hitFrac);
      flash(p.tx, p.ty + 0.1, p.tz, 0.6 * power + 0.3);
      if (power > 0.5)
        for (let i = 0; i < 6 * power; i++)
          pools.glow.emit({
            x: p.tx,
            y: p.ty + 0.1,
            z: p.tz,
            vx: (Math.random() - 0.5) * 3,
            vy: 1 + Math.random() * 2,
            vz: (Math.random() - 0.5) * 3,
            life: 0.6,
            size: 0.18,
            color: "#ff8a2a",
            gravity: 5,
          });
      if (power > 0.3)
        for (let i = 0; i < 3 * power; i++)
          pools.smoke.emit({
            x: p.tx,
            y: p.ty + 0.2,
            z: p.tz,
            vx: 0.2,
            vy: 0.8,
            life: 2,
            size: 0.4 * power + 0.2,
            grow: 2.5,
            color: "#2b2826",
            alpha: 0.7,
            drag: 0.5,
          });
      if (p.weapon === "torpedo" || p.weapon === "broadside" || p.weapon === "bomb") splash(p.tx, p.tz, power * 0.8);
    } else splash(p.tx, p.tz, power * 0.7);
  };

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    // ── events → projectiles
    let budget = 30;
    for (const ev of view.frameEvents) {
      if (ev.type === "fire") {
        const sSide: BookSide = ev.shooter === "bulls" ? "bid" : "ask";
        const shooters = view.visible[sSide];
        const targets = view.visible[ev.target];
        if (!shooters.length || !targets.length) continue;
        if (ev.weapon === "mg" && budget-- <= 0) continue;
        const target = targets.find((d) => d.price === ev.price) ?? targets[0]!;
        const sign = sideSign(sSide);
        const shooter: Display =
          ev.weapon === "broadside"
            ? (shooters.find((d) => d.tier === "battleship") ?? shooters[0]!)
            : shooters[shot.current++ % Math.min(5, shooters.length)]!;
        const mx = shooter.x;
        const my = 0.28 * shooter.s;
        const mz = shooter.z - sign * 0.25 * shooter.s;
        const tx = target.x;
        const ty = 0.18 * target.s;
        const tz = target.z;
        const base = { target, hitFrac: ev.hitFrac };
        if (ev.weapon === "mg") {
          for (let i = 0; i < 3; i++)
            spawn({ ...base, weapon: "mg", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.3, ty, tz: tz + (Math.random() - 0.5) * 0.3, dur: 0.16 + i * 0.03, arc: 0.15, size: 0.035, len: 0.5 });
        } else if (ev.weapon === "gun") {
          flash(mx, my, mz, 0.6);
          for (let i = 0; i < 2; i++)
            spawn({ ...base, weapon: "gun", fx: mx, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.4, ty, tz, dur: 0.34 + i * 0.05, arc: 1.6, size: 0.06, len: 0.3 });
        } else if (ev.weapon === "torpedo") {
          spawn({ ...base, weapon: "torpedo", fx: mx, fy: 0.01, fz: mz, tx, ty: 0.01, tz, dur: 0.45, size: 0.05, len: 0.5 });
        } else {
          fx.shake = Math.min(1.2, fx.shake + 0.8);
          for (let i = 0; i < 6; i++) {
            const ox = (i - 2.5) * 0.12 * shooter.s;
            flash(mx + ox, my, mz, 1.2, "#ffd27a");
            spawn({ ...base, weapon: "broadside", fx: mx + ox, fy: my, fz: mz, tx: tx + (Math.random() - 0.5) * 0.8, ty, tz: tz + (Math.random() - 0.5) * 0.6, dur: 0.4 + i * 0.015, arc: 2.6, size: 0.09, len: 0.4 });
          }
        }
      } else if (ev.type === "liquidation") {
        const b = bombers.find((q) => !q.on);
        if (b) {
          b.on = true;
          b.t = 0;
          b.nextDrop = 0;
          b.side = ev.liquidated === "longs" ? "bid" : "ask";
          b.z = sideSign(b.side) * (GAP + DEPTH * 0.8);
        }
      }
    }

    // ── bombers
    bombers.forEach((b, i) => {
      const m = bomberRefs.current[i];
      if (!m) return;
      if (!b.on) {
        m.visible = false;
        return;
      }
      b.t += dt;
      const DUR = 3.8;
      const span = view.halfW + 22;
      const x = span - (b.t / DUR) * span * 2;
      m.visible = true;
      m.position.set(x, 6 + Math.sin(b.t * 2) * 0.15, b.z);
      m.rotation.set(Math.sin(b.t * 1.7) * 0.05, 0, 0);
      if (Math.abs(x) < view.halfW + 1 && b.t >= b.nextDrop) {
        b.nextDrop = b.t + 0.2;
        const rear = view.visible[b.side];
        const target = rear.length ? rear[Math.max(0, rear.length - 1 - Math.floor(Math.random() * Math.min(6, rear.length)))] : null;
        const tx = x - 1.2;
        const tz = b.z + (Math.random() - 0.5) * 3;
        const near = target && Math.abs(target.x - tx) < 2.5 ? target : null;
        spawn({ weapon: "bomb", fx: x, fy: 5.7, fz: b.z, tx: near ? near.x : tx, ty: near ? 0.2 * near.s : 0, tz: near ? near.z : tz, dur: 0.75, size: 0.08, len: 0.25, target: near, hitFrac: 0.4 });
      }
      if (b.t > DUR) b.on = false;
    });

    // ── projectiles
    const m = projMesh.current;
    let n = 0;
    for (const p of projs) {
      if (!p.on) continue;
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      const h = p.arc * 4 * u * (1 - u);
      tmpA.set(p.fx + (p.tx - p.fx) * u, p.fy + (p.ty - p.fy) * u + h, p.fz + (p.tz - p.fz) * u);
      if (p.weapon === "torpedo" && Math.random() < 0.9)
        pools.smoke.emit({ x: tmpA.x, y: 0.03, z: tmpA.z, life: 1.2, size: 0.22, grow: 2.2, color: "#eef7fa", alpha: 0.7 });
      if (u >= 1) {
        p.on = false;
        impact(p);
        continue;
      }
      if (!m || n >= MAX_PROJ) continue;
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
    void state;
  });

  return (
    <group>
      <primitive object={pools.smoke.points} />
      <primitive object={pools.glow.points} />
      <instancedMesh ref={projMesh} args={[projGeo, projMat, MAX_PROJ]} frustumCulled={false} />
      {bombers.map((_, i) => (
        <mesh
          key={i}
          ref={(r) => {
            bomberRefs.current[i] = r;
          }}
          geometry={bomberGeo}
          material={bomberMat}
          scale={3}
          visible={false}
        />
      ))}
    </group>
  );
}
