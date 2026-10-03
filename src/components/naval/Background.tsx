import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef } from "@/lib/market/store";
import { makeFleetMaterial, useModelGeometry } from "./models";
import { DEPTH, REAR, view } from "./layout";

const BUOYS = 15;
const CONVOY = 5;
const dummy = new THREE.Object3D();

/** Mark-price buoys, funding tankers + oil slicks, open-interest convoy. */
export function Background() {
  const tankerGeo = useModelGeometry("tanker");
  const transportGeo = useModelGeometry("transport");
  const mats = useMemo(
    () => ({
      bulls: makeFleetMaterial("bulls"),
      bears: makeFleetMaterial("bears"),
      transport: new THREE.MeshStandardMaterial({ color: "#5d6669", metalness: 0.4, roughness: 0.6 }),
      buoy: new THREE.MeshStandardMaterial({ color: "#ffefc2", emissive: "#ffcf5a", emissiveIntensity: 2.2, toneMapped: false }),
      slick: new THREE.MeshBasicMaterial({ color: "#07090a", transparent: true, opacity: 0, depthWrite: false }),
    }),
    [],
  );
  const slickGeo = useMemo(() => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), []);
  const buoyGeo = useMemo(() => new THREE.SphereGeometry(0.09, 10, 8), []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      slickGeo.dispose();
      buoyGeo.dispose();
    },
    [mats, slickGeo, buoyGeo],
  );

  const buoys = useRef<THREE.InstancedMesh>(null);
  const convoy = useRef<THREE.InstancedMesh>(null);
  const tankers = useRef<Record<"bid" | "ask", THREE.Mesh | null>>({ bid: null, ask: null });
  const slicks = useRef<Record<"bid" | "ask", THREE.Mesh | null>>({ bid: null, ask: null });
  const slickSize = useRef({ bid: 0, ask: 0 });
  const buoyZ = useRef(0);
  const conv = useRef({ side: 1, p: 0 });
  const root = useRef<THREE.Group>(null);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const e = engineRef.current;
    const t = view.time;
    // nothing here is shown until real market data has arrived
    if (root.current) root.current.visible = !!e && e.bids.length > 0 && e.mark > 0;

    // buoys at mark price
    const mark = e?.mark || view.mid;
    const tz = view.mid && mark ? THREE.MathUtils.clamp((-(mark - view.mid) / Math.max(view.range, 1e-9)) * DEPTH, -0.95, 0.95) : 0;
    buoyZ.current += (tz - buoyZ.current) * (1 - Math.exp(-3 * dt));
    view.sinkPulse = Math.max(0, view.sinkPulse - dt * 1.5);
    const b = buoys.current;
    if (b) {
      const span = view.halfW + 4;
      for (let i = 0; i < BUOYS; i++) {
        const x = -span + (i / (BUOYS - 1)) * span * 2;
        dummy.position.set(x, 0.05 + Math.sin(t * 2 + i) * 0.03 * (1 + view.storm * 3), buoyZ.current);
        dummy.scale.setScalar(1 + view.sinkPulse * 1.2 + Math.sin(t * 3 + i * 0.7) * 0.12);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
      }
      b.instanceMatrix.needsUpdate = true;
    }

    // funding tankers
    const funding = e?.funding ?? 0;
    const leaking = { bid: funding > 0, ask: funding < 0 };
    for (const side of ["bid", "ask"] as const) {
      const sign = side === "ask" ? -1 : 1;
      const tk = tankers.current[side];
      const x = view.halfW * (side === "bid" ? 0.62 : -0.62);
      const z = sign * REAR;
      if (tk) {
        tk.position.set(x, Math.sin(t * 1.1 + sign) * 0.03, z);
        tk.rotation.set(0, side === "bid" ? 0 : Math.PI, leaking[side] ? 0.08 : Math.sin(t) * 0.02);
      }
      const target = leaking[side] ? Math.min(5, 1.5 + Math.abs(funding) * 40000) : 0;
      slickSize.current[side] += (target - slickSize.current[side]) * (1 - Math.exp(-0.15 * dt));
      const sl = slicks.current[side];
      if (sl) {
        const r = slickSize.current[side];
        sl.visible = r > 0.05;
        sl.position.set(x + 0.6, 0.03, z + sign * 0.8);
        sl.scale.set(r * 1.3, 1, r * (0.8 + Math.sin(t * 0.3) * 0.05));
        (sl.material as THREE.MeshBasicMaterial).opacity = Math.min(0.62, r * 0.2);
      }
      if (leaking[side] && view.fx.smoke && Math.random() < dt * 4)
        view.fx.smoke.emit({ x: x + 0.2, y: 0.02, z: z + sign * 0.3, vx: 0.15, life: 3, size: 0.45, grow: 1.5, color: "#0b0c0c", alpha: 0.6 });
    }

    // OI convoy
    const state = e?.convoy ?? "none";
    const c = conv.current;
    if (state === "in-bulls" || state === "in-bears") {
      const want = state === "in-bulls" ? 1 : -1;
      if (c.side !== want && c.p > 0.01) c.p = Math.max(0, c.p - dt / 10);
      else {
        c.side = want;
        c.p = Math.min(1, c.p + dt / 18);
      }
    } else if (state === "out") c.p = Math.max(0, c.p - dt / 14);
    const cv = convoy.current;
    if (cv) {
      const eased = c.p * c.p * (3 - 2 * c.p);
      for (let i = 0; i < CONVOY; i++) {
        const z = c.side * (REAR + 5 + (i % 2) * 2.2 + (1 - eased) * 70);
        dummy.position.set((i - 2) * Math.max(2.2, view.halfW * 0.4), Math.sin(t + i) * 0.03, z);
        dummy.rotation.set(0, c.side > 0 ? 0 : Math.PI, 0);
        dummy.scale.setScalar(c.p > 0.002 ? 1.6 : 0.0001);
        dummy.updateMatrix();
        cv.setMatrixAt(i, dummy.matrix);
      }
      cv.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <instancedMesh ref={buoys} args={[buoyGeo, mats.buoy, BUOYS]} frustumCulled={false} />
      <instancedMesh ref={convoy} args={[transportGeo, mats.transport, CONVOY]} frustumCulled={false} />
      <mesh ref={(m) => (tankers.current.bid = m)} geometry={tankerGeo} material={mats.bulls} scale={2.1} />
      <mesh ref={(m) => (tankers.current.ask = m)} geometry={tankerGeo} material={mats.bears} scale={2.1} />
      <mesh ref={(m) => (slicks.current.bid = m)} geometry={slickGeo} material={mats.slick} renderOrder={1} />
      <mesh ref={(m) => (slicks.current.ask = m)} geometry={slickGeo} material={mats.slick} renderOrder={1} />
    </group>
  );
}
