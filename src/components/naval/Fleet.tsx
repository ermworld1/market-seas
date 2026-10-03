import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef } from "@/lib/market/store";
import { fmtPrice } from "@/lib/market/predictions";
import type { BookSide, Tier } from "@/lib/market/types";
import { makeFleetMaterial, useModelGeometry } from "./models";
import { TIERS, TIER_SCALE, type Display, sideSign, view, xFor, zFor } from "./layout";

const CAP = 26;
const SIDES: BookSide[] = ["bid", "ask"];
const dummy = new THREE.Object3D();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const col = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const FOG = new THREE.Color(0.55, 0.6, 0.64);

export function Fleet() {
  const geos: Record<Tier, THREE.BufferGeometry> = {
    patrol: useModelGeometry("patrol"),
    frigate: useModelGeometry("frigate"),
    cruiser: useModelGeometry("cruiser"),
    battleship: useModelGeometry("battleship"),
  };
  const mats = useMemo(() => ({ bid: makeFleetMaterial("bulls"), ask: makeFleetMaterial("bears") }), []);
  useEffect(() => () => {
    mats.bid.dispose();
    mats.ask.dispose();
  }, [mats]);

  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const labelGroups = useRef<Record<BookSide, THREE.Group | null>>({ bid: null, ask: null });
  const labelText = useRef<Record<BookSide, HTMLDivElement | null>>({ bid: null, ask: null });
  const repairGroups = useRef<(THREE.Group | null)[]>([]);
  const repairEls = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    for (const m of Object.values(meshes.current)) {
      if (!m) continue;
      for (let i = 0; i < CAP; i++) m.setColorAt(i, WHITE);
      m.count = 0;
    }
    return () => view.displays.clear();
  }, []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    view.time += dt;
    const e = engineRef.current;
    view.frameEvents = e ? e.drain() : [];
    const counts: Record<string, number> = {};
    const { glow, smoke } = view.fx;

    if (e && e.bids.length && e.asks.length) {
      const mid = e.mid;
      const cap = view.cap;
      const bids = e.bids.slice(0, cap);
      const asks = e.asks.slice(0, cap);
      const far = Math.max(mid - bids[bids.length - 1]!.price, asks[asks.length - 1]!.price - mid, mid * 2e-5);
      if (!view.mid || Math.abs(mid - view.mid) > view.range * 1.5) {
        view.mid = mid;
        view.range = far;
      } else {
        view.mid += (mid - view.mid) * (1 - Math.exp(-5 * dt));
        view.range += (far - view.range) * (1 - Math.exp(-1.5 * dt));
      }

      for (const ev of view.frameEvents) {
        if (ev.type === "sink" || ev.type === "ghost" || ev.type === "pulled") {
          const d = view.displays.get(ev.side + ev.price);
          if (d && !d.departing) d.departing = { kind: ev.type, t0: view.time };
          if (ev.type === "sink") view.sinkPulse = 1;
        }
      }

      const seen = new Set<string>();
      for (const side of SIDES) {
        const list = side === "bid" ? bids : asks;
        const vis: Display[] = [];
        list.forEach((l, i) => {
          const key = side + l.price;
          let d = view.displays.get(key);
          if (!d) {
            const z = zFor(side, l.price);
            d = {
              key,
              side,
              price: l.price,
              x: xFor(l.price, i),
              z: z + sideSign(side) * 2.5,
              y: 0,
              s: 0.05,
              tier: l.tier,
              level: l,
              departing: null,
              hitFlash: 0,
              roll: 0,
              pitch: 0,
              fade: 0,
            };
            view.displays.set(key, d);
          }
          if (d.departing && d.departing.kind !== "sink") d.departing = null;
          d.level = l;
          d.tier = l.tier;
          seen.add(key);
          vis.push(d);
        });
        view.visible[side] = vis;
      }

      const now = Date.now();
      const kMove = 1 - Math.exp(-4 * dt);
      const kScale = 1 - Math.exp(-3 * dt);
      const mobileK = view.mobile ? 0.85 : 1;
      const stormBob = 1 + view.storm * 3;
      for (const d of view.displays.values()) {
        const sign = sideSign(d.side);
        if (!seen.has(d.key) && !d.departing) d.departing = { kind: "drop", t0: view.time };
        const bob = Math.sin(view.time * 1.4 + d.x * 1.7 + d.price) * 0.025 * stormBob;
        if (!d.departing && d.level) {
          const l = d.level;
          const tz = zFor(d.side, d.price);
          const ts = TIER_SCALE[l.tier] * (1 + 0.3 * l.tierFrac) * mobileK;
          const prevZ = d.z;
          d.z += (tz - d.z) * kMove;
          d.s += (ts - d.s) * kScale;
          d.roll += (l.damage * 0.32 + Math.sin(view.time * 0.9 + d.x) * 0.03 * stormBob - d.roll) * kMove;
          d.pitch += (0 - d.pitch) * kMove;
          d.y = bob - l.damage * 0.05 * d.s;
          d.fade += (0 - d.fade) * kMove;
          const speed = Math.abs(d.z - prevZ) / Math.max(dt, 1e-4);
          if (smoke && speed > 0.35 && Math.random() < dt * 30) {
            smoke.emit({
              x: d.x + (Math.random() - 0.5) * 0.15 * d.s,
              y: 0.03,
              z: d.z + sign * 0.5 * d.s,
              life: 1.4,
              size: 0.35 * d.s,
              grow: 2,
              color: "#e8f1f4",
              alpha: 0.55,
            });
          }
          if (smoke && l.damage > 0.12 && Math.random() < dt * l.damage * 10) {
            smoke.emit({
              x: d.x + (Math.random() - 0.5) * 0.2 * d.s,
              y: 0.25 * d.s,
              z: d.z + (Math.random() - 0.5) * 0.4 * d.s,
              vx: 0.3,
              vy: 0.9,
              life: 2.6,
              size: 0.5 * d.s,
              grow: 3,
              color: "#2a2826",
              alpha: 0.7,
              drag: 0.6,
            });
          }
          if (glow && l.damage > 0.4 && Math.random() < dt * l.damage * 14) {
            glow.emit({
              x: d.x + (Math.random() - 0.5) * 0.25 * d.s,
              y: 0.2 * d.s,
              z: d.z + (Math.random() - 0.5) * 0.35 * d.s,
              vy: 0.6,
              life: 0.5,
              size: 0.35 * d.s,
              grow: -0.6,
              color: "#ff7a1a",
              alpha: 0.9,
            });
          }
          if (glow && l.repairUntil > now && Math.random() < dt * 22) {
            glow.emit({
              x: d.x + (Math.random() - 0.5) * 0.3 * d.s,
              y: 0.22 * d.s,
              z: d.z + (Math.random() - 0.5) * 0.6 * d.s,
              vx: (Math.random() - 0.5) * 2,
              vy: 1.2 + Math.random(),
              vz: (Math.random() - 0.5) * 2,
              life: 0.45,
              size: 0.12,
              color: "#5dff8a",
              gravity: 5,
            });
          }
        } else if (d.departing) {
          const age = view.time - d.departing.t0;
          const k = d.departing.kind;
          if (k === "sink") {
            d.pitch = Math.min(0.75, age * 0.45);
            d.roll += dt * 0.25;
            d.y = -age * age * 0.18 * Math.max(1, d.s);
            if (smoke && Math.random() < dt * 25)
              smoke.emit({
                x: d.x + (Math.random() - 0.5) * d.s * 0.4,
                y: 0.02,
                z: d.z + (Math.random() - 0.5) * d.s * 0.8,
                vy: 0.25,
                life: 1.6,
                size: 0.3 + Math.random() * 0.3,
                grow: 2.2,
                color: "#f2f7f8",
                alpha: 0.75,
              });
            if (age > 3.2) view.displays.delete(d.key);
          } else if (k === "ghost") {
            d.z += sign * dt * 2.6;
            d.fade = Math.min(1, age / 1.5);
            d.y = bob - age * 0.12;
            if (smoke && Math.random() < dt * 28)
              smoke.emit({
                x: d.x + (Math.random() - 0.5) * d.s,
                y: 0.15 + Math.random() * 0.3,
                z: d.z + sign * (0.3 + Math.random() * 0.6) * d.s,
                vx: (Math.random() - 0.5) * 0.4,
                vy: 0.1,
                life: 2.4,
                size: 1.0 * d.s,
                grow: 1.8,
                color: "#b9c4c9",
                alpha: 0.5,
              });
            if (age > 1.5) view.displays.delete(d.key);
          } else {
            d.s *= Math.exp(-(k === "drop" ? 4 : 2.5) * dt);
            d.fade = Math.min(1, age);
            d.z += sign * dt * 0.8;
            if (age > 1) view.displays.delete(d.key);
          }
        }
        d.hitFlash *= Math.exp(-6 * dt);

        // write instance
        const mkey = d.side + d.tier;
        const m = meshes.current[mkey];
        const n = counts[mkey] ?? 0;
        if (!m || n >= CAP) continue;
        euler.set(d.pitch, d.side === "bid" ? 0 : Math.PI, d.roll);
        dummy.position.set(d.x, d.y, d.z);
        dummy.quaternion.setFromEuler(euler);
        dummy.scale.setScalar(Math.max(0.001, d.s));
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        const dmg = d.level?.damage ?? 0;
        col.copy(WHITE).lerp(FOG, d.fade).multiplyScalar(1 - dmg * 0.45 + d.hitFlash * 1.5);
        m.setColorAt(n, col);
        counts[mkey] = n + 1;
      }
    }

    for (const side of SIDES)
      for (const t of TIERS) {
        const m = meshes.current[side + t];
        if (!m) continue;
        m.count = counts[side + t] ?? 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }

    // battleship labels
    for (const side of SIDES) {
      const g = labelGroups.current[side];
      const el = labelText.current[side];
      if (!g || !el) continue;
      const b = view.visible[side].find((d) => d.tier === "battleship" && !d.departing);
      if (b) {
        g.position.set(b.x, 0.55 * b.s + 0.45, b.z);
        const txt = `Battleship ${fmtPrice(b.price)}`;
        if (el.textContent !== txt) el.textContent = txt;
        el.style.display = "";
      } else el.style.display = "none";
    }
    // repair tags
    const now = Date.now();
    const repairing = [...view.visible.bid, ...view.visible.ask].filter((d) => (d.level?.repairUntil ?? 0) > now);
    repairGroups.current.forEach((g, i) => {
      const el = repairEls.current[i];
      if (!g || !el) return;
      const d = repairing[i];
      if (d) {
        g.position.set(d.x, 0.45 * d.s + 0.2, d.z);
        el.style.display = "";
      } else el.style.display = "none";
    });
  });

  return (
    <group>
      {SIDES.map((side) =>
        TIERS.map((t) => (
          <instancedMesh
            key={side + t}
            ref={(m) => {
              meshes.current[side + t] = m;
            }}
            args={[geos[t], mats[side], CAP]}
            frustumCulled={false}
            castShadow
          />
        )),
      )}
      {SIDES.map((side) => (
        <group key={side} ref={(g) => (labelGroups.current[side] = g)}>
          <Html center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div
              ref={(el) => {
                labelText.current[side] = el;
              }}
              className={`ship-tag ${side === "bid" ? "text-bull" : "text-bear"}`}
              style={{ display: "none" }}
            />
          </Html>
        </group>
      ))}
      {[0, 1].map((i) => (
        <group key={i} ref={(g) => (repairGroups.current[i] = g)}>
          <Html center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
            <div
              ref={(el) => {
                repairEls.current[i] = el;
              }}
              className="ship-tag text-ok"
              style={{ display: "none", marginTop: 30 }}
            >
              repair (inferred)
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

