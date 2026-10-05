import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef, fx } from "@/lib/market/store";
import { usd } from "@/lib/market/predictions";
import type { BookSide, Tier } from "@/lib/market/types";
import type { Tracked } from "@/lib/battle/orderRules";
import { audio, panX } from "@/lib/audio/engine";
import { UNIT_PAINT_HEX } from "@/lib/battle/units";
import { introProgress, separateStationDepth } from "@/lib/market/positioning";
import { makeFleetMaterial, useModelGeometry } from "./models";
import { CAPITAL, REAR, TIERS, TIER_SCALE, addFloater, displayFor, type Display, sideSign, updateFront, view, xForPrice, zForStation } from "./layout";

const CAP = 130;
const SIDES: BookSide[] = ["bid", "ask"];
const dummy = new THREE.Object3D();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const col = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const FOG = new THREE.Color(0.55, 0.6, 0.64);
const SIDE_COL = { bid: new THREE.Color(UNIT_PAINT_HEX.bid), ask: new THREE.Color(UNIT_PAINT_HEX.ask) };
const flagGeo = new THREE.PlaneGeometry(0.24, 0.14).translate(0.12, 0, 0);
const poleGeo = new THREE.BoxGeometry(0.012, 0.3, 0.012).translate(0, -0.08, 0);
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
  const frigateLow = useModelGeometry("frigate", "low");
  const frigateHigh = useModelGeometry("frigate", "high");
  const geos: Record<"high" | "low", Record<Tier, THREE.BufferGeometry>> = {
    low: {
      patrol: useModelGeometry("patrol", "low"), destroyer: frigateLow, frigate: frigateLow,
      cruiser: useModelGeometry("cruiser", "low"), battleship: useModelGeometry("battleship", "low"),
    },
    high: {
      patrol: useModelGeometry("patrol", "high"), destroyer: frigateHigh, frigate: frigateHigh,
      cruiser: useModelGeometry("cruiser", "high"), battleship: useModelGeometry("battleship", "high"),
    },
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
    const paint = (side: BookSide) => new THREE.MeshStandardMaterial({ color: SIDE_COL[side], emissive: 0x000000, emissiveIntensity: 0, metalness: 0.18, roughness: 0.78, side: THREE.DoubleSide });
    const flag = (side: BookSide) => {
      const material = new THREE.MeshStandardMaterial({ color: SIDE_COL[side], emissive: 0x000000, emissiveIntensity: 0, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
      material.onBeforeCompile = (shader) => {
        shader.uniforms["uTime"] = { value: 0 };
        material.userData["shader"] = shader;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat clothK=(position.x+0.08)/0.16; transformed.z += sin(uTime*5.0+clothK*5.5)*0.018*clothK;");
      };
      material.customProgramCacheKey = () => `fleet-flag-${side}`;
      return material;
    };
    return {
      paint: { bid: paint("bid"), ask: paint("ask") },
      flag: { bid: flag("bid"), ask: flag("ask") },
      pole: new THREE.MeshStandardMaterial({ color: "#20252b", emissive: 0x000000, emissiveIntensity: 0, metalness: 0.75, roughness: 0.4 }),
    };
  }, []);
  useEffect(() => () => { [marks.paint.bid, marks.paint.ask, marks.flag.bid, marks.flag.ask, marks.pole].forEach((m) => m.dispose()); }, [marks]);
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
    for (const side of SIDES) {
      const shader = marks.flag[side].userData["shader"] as { uniforms?: Record<string, { value: number }> } | undefined;
      const time = shader?.uniforms?.["uTime"];
      if (time) time.value = view.time;
    }
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
        const d = displayFor(ev.side, ev.b);
        const sign = sideSign(ev.side);
        const pan = { x: panX((d?.x ?? view.frontX) - view.frontX, REAR) };
        switch (ev.type) {
          case "sink":
            // a ship holds a whole price band: it only goes down when nothing is left in the band
            if (d && !d.departing && (d.memberCount ?? 1) <= 1) d.departing = { kind: "sink", t0: view.time };
            else if (d) { d.hitFlash = 1; d.damage = Math.min(0.9, d.damage + 0.3); }
            view.sinkPulse = 1;
            audio.play("sink", pan);
            break;
          case "dive":
          case "fled":
            if (d && !d.departing && (d.memberCount ?? 1) <= 1) d.departing = { kind: ev.type, t0: view.time };
            else if (d) d.smoke = 1.6;
            audio.play(ev.type, pan);
            break;
          case "pulled":
            if (d && !d.departing && (d.memberCount ?? 1) <= 1) d.departing = { kind: "pulled", t0: view.time };
            else if (d) d.smoke = 1.2;
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
            const from = displayFor(ev.side, ev.from);
            const to = displayFor(ev.side, ev.b);
            // only capital ships surface visibly, at most once per 20 s; small market-maker requotes just move
            if (to && (to.tier === "cruiser" || to.tier === "battleship") && view.time - (to.lastSurface ?? -99) > 20) { to.surfacing = 1; to.lastSurface = view.time; }
            if (smoke && to) {
              const fx0 = from?.x ?? xForPrice(ev.side, ev.fromPrice);
              const fz0 = from?.z ?? zForStation(Date.now());
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
              if (view.time - (d.lastSurface ?? -99) > 20) { d.surfacing = 1; d.lastSurface = view.time; }
              addFloater({ x: d.x, y: 0.4, z: d.z }, `hidden ${usd(ev.notional)}`, "sub");
            }
            audio.play("surface", pan);
            break;
          case "reinforce":
            if (d) d.damage *= 0.4;
            if (d && ev.notional >= e.bucketSampler.quantile(0.9)) {
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
      updateFront(e.last || e.mark || mid);
      view.bucketVisual.clear();
      for (const side of SIDES) {
        const qualityCap = view.quality === "low" ? (view.mobile ? 34 : 72) : view.quality === "medium" ? (view.mobile ? 44 : 96) : view.cap;
        const ships = [...e.trackers[side].ships.values()]
          .filter((s) => passes(s, mid))
          .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price))
          .slice(0, qualityCap);
        const vis: Display[] = [];
        const visualCap = Math.min(qualityCap, view.presentation === "cinema" ? 25 : 40);
        // Stable ships: buckets are grouped into FIXED absolute price bands, so a ship keeps its identity
        // while orders churn underneath. (Rank-based grouping swapped the representative bucket every
        // few hundred ms, which made ships vanish, respawn and look like they were jumping.)
        const w = e.width || 1;
        const span = Math.max(mid * 0.011, w);
        if (!view.bandW || Math.abs(view.bandW - Math.ceil(span / visualCap / w) * w) > w * 2) view.bandW = Math.max(w, Math.ceil(span / visualCap / w) * w);
        const bands = new Map<number, Tracked[]>();
        for (const sh of ships) {
          const band = Math.floor(sh.price / view.bandW);
          let arr = bands.get(band);
          if (!arr) { arr = []; bands.set(band, arr); }
          arr.push(sh);
        }
        const shown = [...bands.entries()].sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0])).slice(0, visualCap).map(([band, members]) => {
          const ship = members.reduce((best, candidate) => candidate.notional > best.notional ? candidate : best);
          const total = members.reduce((sum, candidate) => sum + candidate.notional, 0);
          return { band, ship, members, weight: THREE.MathUtils.clamp(Math.sqrt(total / Math.max(ship.notional, 1)), 1, 1.35) };
        });
        const stationTargets = separateStationDepth(shown.map(({ band, ship: s, members, weight }) => ({
          key: `${side}#${band}`,
          x: xForPrice(side, s.price),
          z: zForStation(Math.min(...members.map((member) => member.bornAt))),
          length: TIER_SCALE[s.tier] * weight * 1.08,
          beam: TIER_SCALE[s.tier] * weight * 0.32,
        })), view.halfW * 0.96);
        for (let gi = 0; gi < shown.length; gi++) {
          const { band, ship: s, members, weight } = shown[gi]!;
          const key = `${side}#${band}`;
          let d = view.displays.get(key);
          if (!d) {
            const x = xForPrice(side, s.price);
            d = {
              key, side, b: s.b, price: s.price, x, z: -view.halfW, y: 0, s: 0.05, tier: s.tier, ship: s,
              departing: null, surfacing: 0, smoke: 0, hitFlash: 0, damage: 0, roll: 0, pitch: 0, fade: 0, visualWeight: 1, lod: "low",
              introBorn: view.introSerial, stationZ: zForStation(s.bornAt),
            };
            view.displays.set(key, d);
          }
          if (d.departing && d.departing.kind === "drop") d.departing = null;
          d.ship = s;
          // hysteresis: a ship only changes class (and model) after the new class has held for 2.5 s,
          // otherwise percentile jitter swaps the hull every few frames and the ship appears to jump
          if (s.tier !== d.tier) {
            if (d.pendingTier !== s.tier) { d.pendingTier = s.tier; d.pendingSince = view.time; }
            else if (view.time - (d.pendingSince ?? 0) > 2.5 || s.tier === "battleship" || d.tier === "battleship") { d.tier = s.tier; d.pendingTier = undefined; }
          } else d.pendingTier = undefined;
          d.price = s.price;
          d.visualWeight = weight;
          d.memberCount = members.length;
          // LOD with a margin so ships near the cut-off do not flip between meshes
          const wantHigh = gi < (view.mobile ? 4 : 8) || d.tier === "battleship";
          const keepHigh = d.lod === "high" && gi < (view.mobile ? 6 : 11);
          d.lod = wantHigh || keepHigh ? "high" : "low";
          for (const member of members) view.bucketVisual.set(side + member.b, d);
          const station = stationTargets.get(key);
          if (station) d.stationZ = station.z;
          seen.add(key);
          if (!d.departing) vis.push(d);
        }
        view.visible[side] = vis;
      }

      const now = Date.now();
      const kMove = 1 - Math.exp(-4 * dt);
      const kScale = 1 - Math.exp(-3 * dt);
      const mobileK = view.mobile ? 1.4 : 1;
      const stormBob = 1 + view.storm * 1.5;
      const repairs: { x: number; y: number; z: number }[] = [];
      let near: Display | null = null;
      for (const d of view.displays.values()) {
        const sign = sideSign(d.side);
        if (!seen.has(d.key) && !d.departing) d.departing = { kind: "drop", t0: view.time };
        // phase is fixed per ship (not tied to x, which moves with price) so the swell stays smooth
        d.seed ??= Math.random() * Math.PI * 2;
        const bob = Math.sin(view.time * 0.8 + d.seed) * 0.004 * stormBob; // near-flat: calm-water swell only
        let hidden = subsOnly;
        if (!d.departing && d.ship) {
          const s = d.ship;
          const exactX = xForPrice(d.side, d.price);
          const introElapsed = performance.now() - view.introStartedAt;
          const intro = introProgress(s.tier, introElapsed);
          const tx = exactX + sign * REAR * (1 - intro);
          const targetZ = d.stationZ;
          const ts = TIER_SCALE[d.tier] * d.visualWeight * mobileK;
          const dx = (tx - d.x) * kMove;
          d.x += dx;
          d.z += (targetZ - d.z) * kMove;
          // wake behind moving ships (and a faint bow wash on big ones)
          const speed = Math.abs(dx) / Math.max(dt, 1e-3);
          if (smoke && (speed > 0.15 ? Math.random() < dt * 40 : Math.random() < dt * 2.2 * d.s))
            smoke.emit({ x: d.x + sign * 0.5 * d.s, y: 0.02, z: d.z + (Math.random() - 0.5) * 0.15 * d.s, vx: sign * (0.15 + speed * 0.08), vz: (Math.random() - 0.5) * 0.3, life: 2.4, size: 0.12 + 0.1 * d.s, grow: 3.2, color: "#e1ecee", alpha: 0.68 });
          d.s += (ts - d.s) * kScale;
          // damage persists until the order is refilled (reinforce/repair) or sunk
          d.roll += (d.damage * 0.3 + Math.sin(view.time * 0.7 + (d.seed ?? 0)) * 0.025 * stormBob - d.roll) * kMove;
          d.pitch += (0 - d.pitch) * kMove;
          let targetY = bob - d.damage * 0.05 * d.s;
          if (d.surfacing > 0) {
            d.surfacing = Math.max(0, d.surfacing - dt / 1.6);
            targetY -= d.surfacing * d.surfacing * 0.25 * d.s;
            hidden = false;
            if (smoke && Math.random() < dt * 30) smoke.emit({ x: d.x + (Math.random() - 0.5) * 0.5 * d.s, y: 0.03, z: d.z + (Math.random() - 0.5) * d.s, vy: 0.3, life: 1.2, size: 0.3, grow: 2, color: "#f4fbff", alpha: 0.7 });
          }
          // ease vertical changes (damage, refills, surfacing) instead of snapping
          d.y += (targetY - d.y) * Math.min(1, dt * 3);
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

        const mkey = d.side + d.tier + d.lod;
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
        col.copy(WHITE).lerp(FOG, d.fade).multiplyScalar(1 - d.damage * 0.38);
        m.setColorAt(n, col);
        counts[mkey] = n + 1;
        const hk = d.side as string;
        const hn = counts["h" + hk] ?? 0;
        const fm = markings.current["f" + hk];
        const pm = markings.current["p" + hk];
        if (fm && pm && hn < MARK_CAP) {
          const sz = Math.max(0.001, d.s) * (1 - d.fade * 0.6);
          dummy.rotation.copy(euler);
          dummy.position.set(d.x, d.y, d.z);
          dummy.scale.setScalar(sz);
          dummy.updateMatrix();
          const fs = (0.2 + d.s * 0.38) * (d.tier === "battleship" ? 1.35 : 1) * (1 - d.fade);
          dummy.position.set(d.x, d.y + 0.39 * d.s + 0.12, d.z);
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
      for (const t of TIERS)
        for (const lod of ["high", "low"] as const) {
          const m = meshes.current[side + t + lod];
          if (!m) continue;
          m.count = counts[side + t + lod] ?? 0;
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
        }
    for (const side of SIDES)
      for (const p of ["f", "p"]) {
        const m = markings.current[p + side];
        if (!m) continue;
        m.count = counts["h" + side] ?? 0;
        m.instanceMatrix.needsUpdate = true;
      }
  });

  return (
    <group>
      {SIDES.map((side) =>
        TIERS.flatMap((t) => (["high", "low"] as const).map((lod) => (
          <instancedMesh
            key={side + t + lod}
            ref={(m) => {
              meshes.current[side + t + lod] = m;
            }}
            args={[geos[lod][t], t === "destroyer" ? (side === "bid" ? mats.bidTrim : mats.askTrim) : mats[side], CAP]}
            castShadow
            receiveShadow
            frustumCulled={false}
          />
        ))),
      )}
      {SIDES.map((side) => (
        <group key={"mk" + side}>
          <instancedMesh ref={(m) => { markings.current["f" + side] = m; }} args={[flagGeo, marks.flag[side], MARK_CAP]} frustumCulled={false} />
          <instancedMesh ref={(m) => { markings.current["p" + side] = m; }} args={[poleGeo, marks.pole, MARK_CAP]} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}
