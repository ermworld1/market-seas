import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { engineRef } from "@/lib/market/store";
import { makeAircraftMaterial, useModelGeometry } from "./models";
import { DEPTH, REAR, view } from "./layout";

const BUOYS = 24;
const CONVOY = 5;
const dummy = new THREE.Object3D();

/** Last-price buoys, one neutral funding tanker, neutral open-interest convoy. */
export function Background() {
  const tankerGeo = useModelGeometry("tanker");
  const transportGeo = useModelGeometry("transport");
  const mats = useMemo(
    () => ({
      transport: makeAircraftMaterial(),
      buoy: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#fff4d6", emissiveIntensity: 2.2, toneMapped: false }),
    }),
    [],
  );
  const buoyGeo = useMemo(() => new THREE.SphereGeometry(0.09, 10, 8), []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      buoyGeo.dispose();
    },
    [mats, buoyGeo],
  );

  const buoys = useRef<THREE.InstancedMesh>(null);
  const convoy = useRef<THREE.InstancedMesh>(null);
  const tankers = useRef<Record<"bid" | "ask", THREE.Mesh | null>>({ bid: null, ask: null });
  const buoyX = useRef(0);
  const conv = useRef({ p: 0 });
  const root = useRef<THREE.Group>(null);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const e = engineRef.current;
    const t = view.time;
    // nothing here is shown until real market data has arrived
    if (root.current) root.current.visible = !!e && e.hasBook && e.mark > 0;

    // buoys at the last traded price (view.frontX)
    const tx = view.frontX;
    buoyX.current += (tx - buoyX.current) * (1 - Math.exp(-3 * dt));
    view.sinkPulse = Math.max(0, view.sinkPulse - dt * 1.5);
    const b = buoys.current;
    if (b) {
      const span = view.halfW + 4;
      for (let i = 0; i < BUOYS; i++) {
        const z = -span + (i / (BUOYS - 1)) * span * 2;
        dummy.position.set(buoyX.current, 0.05 + Math.sin(t * 2 + i) * 0.03 * (1 + view.storm * 3), z);
        dummy.scale.setScalar(1 + view.sinkPulse * 1.2 + Math.sin(t * 3 + i * 0.7) * 0.12);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
      }
      b.instanceMatrix.needsUpdate = true;
    }

    // funding tanker: ONE neutral supply ship at the far end of the strait.
    // Funding is paid between longs and shorts, not between the buy and sell
    // fleets, so it is never attached to a side; the HUD labels who pays whom.
    const tk = tankers.current.bid;
    if (tk) {
      tk.position.set(view.frontX + 1.2, Math.sin(t * 1.1) * 0.03, -view.halfW * 1.05);
      tk.rotation.set(0, Math.PI / 2, Math.sin(t) * 0.02);
    }

    // OI convoy: neutral. Open interest is not sided, so the convoy sails in along
    // the far horizon (parallel to the front) when OI rises and sails out when it falls.
    const state = e?.convoy ?? "none";
    const c = conv.current;
    if (state === "in") c.p = Math.min(1, c.p + dt / 18);
    else if (state === "out") c.p = Math.max(0, c.p - dt / 14);
    const cv = convoy.current;
    if (cv) {
      const eased = c.p * c.p * (3 - 2 * c.p);
      for (let i = 0; i < CONVOY; i++) {
        const x = view.frontX + (i - 2) * 2.6 + (1 - eased) * 60;
        dummy.position.set(x, Math.sin(t + i) * 0.03, -view.halfW * 1.25 - (i % 2) * 1.1);
        dummy.rotation.set(0, Math.PI, 0);
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
      <mesh ref={(m) => (tankers.current.bid = m)} geometry={tankerGeo} material={mats.transport} scale={2.1} />
    </group>
  );
}
