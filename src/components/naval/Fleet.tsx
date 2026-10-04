import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef, fx } from "@/lib/market/store";
import { usd } from "@/lib/market/predictions";
import type { BookSide, Tier } from "@/lib/market/types";
import type { Tracked } from "@/lib/battle/orderRules";
import { audio, panX } from "@/lib/audio/engine";
import { makeFleetMaterial, useModelGeometry } from "./models";
import { CAPITAL, REAR, TIERS, TIER_SCALE, addFloater, type Display, sideSign, updateFront, view, xForPrice, zForBucket } from "./layout";

const CAP = 130;
const SIDES: BookSide[] = ["bid", "ask"];
const dummy = new THREE.Object3D();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const col = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const FOG = new THREE.Color(0.55, 0.6, 0.64);
const SIDE_COL = { bid: new THREE.Color("#0ecb81"), ask: new THREE.Color("#f6465d") };
const stripeGeo = new THREE.BoxGeometry(0.92, 0.055, 0.15).translate(0, 0.015, 0);
const deckGeo = new THREE.BoxGeometry(0.38, 0.025, 0.12).translate(-0.08, 0.18, 0);
const foamGeo = new THREE.RingGeometry(0.34, 0.48, 20).rotateX(-Math.PI / 2);
const flagGeo = new THREE.PlaneGeometry(0.16, 0.1).translate(0.08, 0, 0);
const poleGeo = new THREE.BoxGeometry(0.012, 0.22, 0.012).translate(0, -0.06, 0);
const MARK_CAP = CAP * 5;

function textTexture(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "800 72px 'Oswald', 'Arial Narrow', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = color;
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const labelGeo = new THREE.PlaneGeometry(4.2, 0.79).rotateX(-Math.PI / 2);
/** "BUYERS" / "SELLERS" painted on the water at the rear of each fleet. */
export function WaterLabels() {
  const mats = useMemo(() => ({
    bid: new THREE.MeshBasicMaterial({ map: textTexture("BUYERS", "#0ecb81"), transparent: true, depthWrite: false, fog: false }),
    ask: new THREE.MeshBasicMaterial({ map: textTexture("SELLERS", "#f6465d"), transparent: true, depthWrite: false, fog: false }),
  }), []);
  useEffect(() => () => { mats.bid.map?.dispose(); mats.ask.map?.dispose(); mats.bid.dispose(); mats.ask.dispose(); }, [mats]);
  const refs = useRef<Record<BookSide, THREE.Mesh | null>>({ bid: null, ask: null });
  useFrame(() => {
    for (const side of SIDES) {
      const m = refs.current[side];
      if (!m) continue;
      m.position.set(view.frontX + sideSign(side) * (view.mobile ? 2.4 : 3.4), 0.06, view.halfW * 1.02);
      m.scale.setScalar(view.mobile ? 0.8 : 1);
    }
  });
  return <>{SIDES.map((side) => <mesh key={side} ref={(r) => { refs.current[side] = r; }} geometry={labelGeo} material={mats[side]} renderOrder={2} />)}</>;
}

function passes(s: Tracked, mid: number) {
  if (view.viewMode === "capital" && !CAPITAL.includes(s.tier)) return false;
  if (view.filter === "1m" && s.notional < 1e6) return false;
  if (view.filter === "near" && Math.abs(s.price - mid) / mid > 0.001) return false;
  return true;
}

const QK = { low: 0.35, medium: 0.7, high: 1 } as const;
export function Fleet() {
  const frigate = useModelGeometry("frigate");
  const geos: Record<Tier, THREE.BufferGeometry> = {
    patrol: useModelGeometry("patrol"),
    destroyer: frigate,
    frigate,
    cruiser: useModelGeometry("cruiser"),
    battleship: useModelGeometry("battleship"),
  };
  const mats = useMemo(
    () => ({
      bid: makeFleetMaterial("buyers"),
      ask: makeFleetMaterial("sellers"),
      bidTrim: makeFleetMaterial("buyers", true),
      askTrim: makeFleetMaterial("sellers", true),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const marks = useMemo(() => {
    const paint = (side: BookSide) => new THREE.MeshStandardMaterial({ color: SIDE_COL[side], metalness: 0.35, roughness: 0.64, side: THREE.DoubleSide });
    return {
      paint: { bid: paint("bid"), ask: paint("ask") },
      pole: new THREE.MeshStandardMaterial({ color: "#20252b", metalness: 0.75, roughness: 0.4 }),
      foam: new THREE.MeshStandardMaterial({ color: "#d8e5e8", transparent: true, opacity: 0.5, roughness: 0.9, depthWrite: false }),
    };
  }, []);
  useEffect(() => () => { [marks.paint.bid, marks.paint.ask, marks.pole, marks.foam].forEach((m) => m.dispose()); }, [marks]);
  const markings = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});

  useEffect(() => {
    for (const m of Object.values(meshes.current)) {
      if (!m) continue;
      for (let i = 0; i < CAP; i++) m.setColorAt(i, WHITE);
      m.count = 0;
    }
    return () => view.displays.clear();
  }, []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05) * (fx.slowmo > 0 ? fx.slowScale : 1);
    view.frameMs += (raw * 1000 - view.frameMs) * 0.05;
    view.time += dt;
    fx.slowmo = Math.max(0, fx.slowmo - Math.min(raw, 0.05));
    const e = engineRef.current;
    view.frameEvents = e ? e.drain() : [];
    const counts: Record<string, number> = {};
    const { glow, smoke } = view.fx;
    const subsOnly = view.filter === "subs";

    if (e && e.hasBook && e.ref) {
      const mid = e.mid || e.ref;
      view.mid = view.mid ? view.mid + (mid - view.mid) * (1 - Math.exp(-5 * dt)) : mid;

      // order-change events → display states
      for (const ev of view.frameEvents) {
        if (!("b" in ev) || ev.type === "fire") continue;
        const key = ev.side + ev.b;
        const d = view.displays.get(key);
        const sign = sideSign(ev.side);
        const pan = { x: panX((d?.x ?? view.frontX) - view.frontX, REAR) };
        switch (ev.type) {
          case "sink":
            if (d && !d.departing) d.departing = { kind: "sink", t0: view.time };
            view.sinkPulse = 1;
            audio.play("sink", pan);
            break;
          case "dive":
          case "fled":
            if (d && !d.departing) d.departing = { kind: ev.type, t0: view.time };
            audio.play(ev.type, pan);
            break;
          case "pulled":
            if (d && !d.departing) d.departing = { kind: "pulled", t0: view.time };
            break;
          case "cancel":
            if (d) d.smoke = 1.6;
            break;
          case "damage":
            if (d) {
              d.hitFlash = Math.min(1, d.hitFlash + 0.4);
              d.damage = Math.min(0.9, 1 - ev.hp);
            }
            break;
          case "relocate": {
            const from = view.displays.get(ev.side + ev.from);
            const to = view.displays.get(key);
            if (to) to.surfacing = 1;
            if (smoke && to) {
              const fx0 = from?.x ?? xForPrice(ev.side, ev.fromPrice);
              const fz0 = from?.z ?? zForBucket(ev.from);
              for (let i = 0; i <= 14; i++) {
                const u = i / 14;
                smoke.emit({ x: fx0 + (to.x - fx0) * u, y: 0.02, z: fz0 + (to.z - fz0) * u, life: 2.5, size: 0.35, grow: 1.6, color: "#e6f2f6", alpha: 0.6 });
              }
            }
            audio.play("surface", pan);
            break;
          }
          case "hidden":
            if (d) {
              d.surfacing = 1;
              addFloater({ x: d.x, y: 0.4, z: d.z }, `hidden ${usd(ev.notional)}`, "sub");
            }
            audio.play("surface", pan);
            break;
          case "reinforce":
            if (d) d.damage *= 0.4;
            if (d && ev.notional >= 1_500_000) {
              addFloater({ x: d.x + sign * 0.2, y: 0.4, z: d.z }, `+${usd(ev.notional)}`, ev.side === "bid" ? "buy" : "sell");
              if (ev.notional >= 5e6) audio.play("reinforce", pan);
            }
            break;
          case "repair":
            if (d) d.damage = 0;
            break;
        }
      }

      // visible ships: nearest buckets first, up to the cap
      const seen = new Set<string>();
      updateFront(e.mark || mid);
      for (const side of SIDES) {
        const qualityCap = view.quality === "low" ? (view.mobile ? 34 : 72) : view.quality === "medium" ? (view.mobile ? 44 : 96) : view.cap;
        const ships = [...e.trackers[side].ships.values()]
          .filter((s) => passes(s, mid))
          .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price))
          .slice(0, qualityCap);
        const vis: Display[] = [];
        for (const s of ships) {
          const key = side + s.b;
          let d = view.displays.get(key);
          if (!d) {
            const x = xForPrice(side, s.price);
            d = {
              key, side, b: s.b, price: s.price, x: x + sideSign(side) * 1.5, z: zForBucket(s.b), y: 0, s: 0.05, tier: s.tier, ship: s,
              departing: null, surfacing: 0, smoke: 0, hitFlash: 0, damage: 0, roll: 0, pitch: 0, fade: 0,
            };
            view.displays.set(key, d);
          }
          if (d.departing && d.departing.kind === "drop") d.departing = null;
          d.ship = s;
          d.tier = s.tier;
          d.price = s.price;
          seen.add(key);
          if (!d.departing) vis.push(d);
        }
        view.visible[side] = vis;
      }

      const now = Date.now();
      const kMove = 1 - Math.exp(-4 * dt);
      const kScale = 1 - Math.exp(-3 * dt);
      const mobileK = view.mobile ? 1.4 : 1;
      const stormBob = 1 + view.storm * 3;
      const repairs: { x: number; y: number; z: number }[] = [];
      let near: Display | null = null;
      for (const d of view.displays.values()) {
        const sign = sideSign(d.side);
        if (!seen.has(d.key) && !d.departing) d.departing = { kind: "drop", t0: view.time };
        const bob = Math.sin(view.time * 1.4 + d.x * 1.7 + d.b) * 0.02 * stormBob;
        let hidden = subsOnly;
        if (!d.departing && d.ship) {
          const s = d.ship;
          const tx = xForPrice(d.side, d.price);
          const ts = TIER_SCALE[s.tier] * (1 + 0.25 * s.tierFrac) * mobileK;
          const dx = (tx - d.x) * kMove;
          d.x += dx;
          // wake behind moving ships (and a faint bow wash on big ones)
          const speed = Math.abs(dx) / Math.max(dt, 1e-3);
          if (smoke && (speed > 0.15 ? Math.random() < dt * 40 : Math.random() < dt * 2.2 * d.s))
            smoke.emit({ x: d.x + sign * 0.5 * d.s, y: 0.02, z: d.z + (Math.random() - 0.5) * 0.15 * d.s, vx: sign * (0.15 + speed * 0.08), vz: (Math.random() - 0.5) * 0.3, life: 2.4, size: 0.12 + 0.1 * d.s, grow: 3.2, color: "#e1ecee", alpha: 0.68 });
          d.s += (ts - d.s) * kScale;
          // damage persists until the order is refilled (reinforce/repair) or sunk
          d.roll += (d.damage * 0.3 + Math.sin(view.time * 0.9 + d.x) * 0.03 * stormBob - d.roll) * kMove;
          d.pitch += (0 - d.pitch) * kMove;
          d.y = bob - d.damage * 0.05 * d.s;
          if (d.surfacing > 0) {
            d.surfacing = Math.max(0, d.surfacing - dt / 1.2);
            d.y -= d.surfacing * d.surfacing * 0.6 * d.s;
            hidden = false;
            if (smoke && Math.random() < dt * 30) smoke.emit({ x: d.x + (Math.random() - 0.5) * 0.5 * d.s, y: 0.03, z: d.z + (Math.random() - 0.5) * d.s, vy: 0.3, life: 1.2, size: 0.3, grow: 2, color: "#f4fbff", alpha: 0.7 });
          }
          d.fade += (0 - d.fade) * kMove;
          if (smoke && d.smoke > 0) {
            d.smoke -= dt;
            if (Math.random() < dt * 40)
              smoke.emit({ x: d.x + sign * 0.4 * d.s, y: 0.1, z: d.z + (Math.random() - 0.5) * d.s, vz: (Math.random() - 0.5) * 0.5, vy: 0.15, life: 3, size: 0.6 * d.s + 0.3, grow: 2.2, color: "#c9d2d6", alpha: 0.55 });
          }
          if (smoke && d.damage > 0.15 && Math.random() < dt * d.damage * 8)
            smoke.emit({ x: d.x, y: 0.25 * d.s, z: d.z, vx: 0.3, vy: 0.9, life: 2.4, size: 0.45 * d.s, grow: 3, color: "#2a2826", alpha: 0.65, drag: 0.6 });
          // heavy damage: tall black column (stacked soft billboards rising 6–10 units) + deck fire
          if (smoke && d.damage > 0.45 && Math.random() < dt * d.damage * QK[view.quality] * 6)
            smoke.emit({ x: d.x + (Math.random() - 0.5) * 0.2 * d.s, y: 0.4 * d.s, z: d.z, vx: 0.25, vy: 1.6 + Math.random() * 0.6, life: 4.5, size: 0.5 * d.s + 0.3, grow: 3.5, color: "#1c1a19", alpha: 0.7, drag: 0.15 });
          if (glow && d.damage > 0.45 && Math.random() < dt * d.damage * 10 * QK[view.quality])
            glow.emit({ x: d.x, y: 0.2 * d.s, z: d.z, vy: 0.6, life: 0.5, size: 0.3 * d.s, grow: -0.6, color: "#ff7a1a", alpha: 0.9 });
          if (s.repairUntil > now) {
            if (glow && Math.random() < dt * 18)
              glow.emit({ x: d.x + (Math.random() - 0.5) * 0.3 * d.s, y: 0.22 * d.s, z: d.z + (Math.random() - 0.5) * 0.5 * d.s, vx: (Math.random() - 0.5) * 2, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 2, life: 0.45, size: 0.12, color: "#5dff8a", gravity: 5 });
            if (repairs.length < 3) repairs.push({ x: d.x, y: 0.5 * d.s, z: d.z });
          }
          if (!near || Math.abs(d.x - view.frontX) < Math.abs(near.x - view.frontX)) near = d;
        } else if (d.departing) {
          const age = view.time - d.departing.t0;
          const k = d.departing.kind;
          hidden = subsOnly && k !== "dive" && k !== "fled";
          if (k === "sink") {
            d.pitch = Math.min(0.75, age * 0.45);
            d.roll += dt * 0.25;
            d.y = -age * age * 0.16 * Math.max(1, d.s);
            if (smoke && Math.random() < dt * 25)
              smoke.emit({ x: d.x + (Math.random() - 0.5) * d.s * 0.4, y: 0.02, z: d.z + (Math.random() - 0.5) * d.s * 0.8, vy: 0.25, life: 1.6, size: 0.3 + Math.random() * 0.3, grow: 2.2, color: "#f2f7f8", alpha: 0.75 });
            if (age > 3.2) view.displays.delete(d.key);
          } else if (k === "dive" || k === "fled") {
            const speed = k === "fled" ? 2.2 : 1;
            d.pitch = Math.min(0.12, age * 0.2);
            d.y = -age * age * 0.35 * speed * Math.max(1, d.s * 0.6);
            d.x += sign * dt * 1.5 * speed; // heading away from the strait
            d.fade = Math.min(1, age / 1.4);
            if (smoke && Math.random() < dt * 35)
              smoke.emit({ x: d.x + (Math.random() - 0.5) * 0.4 * d.s, y: 0.02, z: d.z + (Math.random() - 0.5) * 0.6 * d.s, vy: 0.4, life: 1.1, size: 0.18, grow: 1.4, color: "#f4fbff", alpha: 0.8 });
            if (smoke && age > 0.8 && Math.random() < dt * 20)
              smoke.emit({ x: d.x + sign * age * 0.6, y: 0.02, z: d.z, life: 1.8, size: 0.2, grow: 2.4, color: "#eaf6fa", alpha: 0.6 }); // periscope wake
            if (age > 2.4) view.displays.delete(d.key);
          } else {
            d.s *= Math.exp(-(k === "drop" ? 4 : 2.5) * dt);
            d.fade = Math.min(1, age);
            d.x += sign * dt * 0.8;
            if (age > 1) view.displays.delete(d.key);
          }
        }
        d.hitFlash *= Math.exp(-6 * dt);
        if (hidden) continue;

        const mkey = d.side + d.tier;
        const m = meshes.current[mkey];
        const n = counts[mkey] ?? 0;
        if (!m || n >= CAP) continue;
        euler.set(d.pitch, d.side === "bid" ? Math.PI : 0, d.roll);
        dummy.position.set(d.x, d.y, d.z);
        dummy.quaternion.setFromEuler(euler);
        dummy.scale.setScalar(Math.max(0.001, d.s));
        dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        const selected = view.selectedBucket?.side === d.side && view.selectedBucket.b === d.b;
        col.copy(WHITE).lerp(FOG, d.fade).multiplyScalar((selected ? 1.12 : 1) * (1 - d.damage * 0.38 + d.hitFlash * 0.45));
        m.setColorAt(n, col);
        counts[mkey] = n + 1;
        const hk = d.side as string;
        const hn = counts["h" + hk] ?? 0;
        const sm = markings.current["s" + hk];
        const dm = markings.current["d" + hk];
        const fm = markings.current["f" + hk];
        const pm = markings.current["p" + hk];
        const wm = markings.current["w" + hk];
        if (sm && dm && fm && pm && wm && hn < MARK_CAP) {
          const sz = Math.max(0.001, d.s) * (1 - d.fade * 0.6);
          dummy.rotation.copy(euler);
          dummy.position.set(d.x, d.y, d.z);
          dummy.scale.setScalar(sz);
          dummy.updateMatrix();
          sm.setMatrixAt(hn, dummy.matrix);
          dm.setMatrixAt(hn, dummy.matrix);
          dummy.position.set(d.x, 0.018, d.z);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.setScalar(sz * (0.9 + d.damage * 0.15));
          dummy.updateMatrix();
          wm.setMatrixAt(hn, dummy.matrix);
          const fs = (0.22 + d.s * 0.48) * (1 - d.fade);
          dummy.position.set(d.x, d.y + 0.34 * d.s + 0.16, d.z);
          dummy.rotation.set(0, d.side === "bid" ? 0 : Math.PI, Math.sin(view.time * 5 + d.b) * 0.16);
          dummy.scale.setScalar(Math.max(0.001, fs));
          dummy.updateMatrix();
          fm.setMatrixAt(hn, dummy.matrix);
          pm.setMatrixAt(hn, dummy.matrix);
          counts["h" + hk] = hn + 1;
        }
      }

      // screen anchors for the DOM label layer
      for (const side of SIDES) {
        const f = view.visible[side].find((d) => d.tier === "battleship");
        view.anchors.flag[side] = f ? { x: f.x, y: 0.45 * f.s + 0.3, z: f.z } : null;
      }
      view.anchors.repairs = repairs;
      view.anchors.near = near ? { x: near.x, y: 0.3, z: near.z } : null;
      const fl = view.anchors.floaters;
      for (let i = fl.length - 1; i >= 0; i--) if (view.time - fl[i]!.t0 > 1.8) fl.splice(i, 1);
    }

    for (const side of SIDES)
      for (const t of TIERS) {
        const m = meshes.current[side + t];
        if (!m) continue;
        m.count = counts[side + t] ?? 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    for (const side of SIDES)
      for (const p of ["s", "d", "f", "p", "w"]) {
        const m = markings.current[p + side];
        if (!m) continue;
        m.count = counts["h" + side] ?? 0;
        m.instanceMatrix.needsUpdate = true;
      }
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
            args={[geos[t], t === "destroyer" ? (side === "bid" ? mats.bidTrim : mats.askTrim) : mats[side], CAP]}
            frustumCulled={false}
          />
        )),
      )}
      {SIDES.map((side) => (
        <group key={"mk" + side}>
          <instancedMesh ref={(m) => { markings.current["s" + side] = m; }} args={[stripeGeo, marks.paint[side], MARK_CAP]} frustumCulled={false} />
          <instancedMesh ref={(m) => { markings.current["d" + side] = m; }} args={[deckGeo, marks.paint[side], MARK_CAP]} frustumCulled={false} />
          <instancedMesh ref={(m) => { markings.current["w" + side] = m; }} args={[foamGeo, marks.foam, MARK_CAP]} frustumCulled={false} renderOrder={1} />
          <instancedMesh ref={(m) => { markings.current["f" + side] = m; }} args={[flagGeo, marks.paint[side], MARK_CAP]} frustumCulled={false} />
          <instancedMesh ref={(m) => { markings.current["p" + side] = m; }} args={[poleGeo, marks.pole, MARK_CAP]} frustumCulled={false} />
        </group>
      ))}
      <WaterLabels />
    </group>
  );
}
