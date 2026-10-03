import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { connectFront } from "@/lib/market/binance";
import { MarketEngine } from "@/lib/market/engine";
import { engineRef, fx, useBattle } from "@/lib/market/store";
import { Background } from "./Background";
import { Effects } from "./Effects";
import { Fleet } from "./Fleet";
import { Ocean } from "./Ocean";
import { view } from "./layout";
import { preloadModels } from "./models";
import { Hud } from "./Hud";
import { usePredictionRounds } from "./usePredictionRounds";

const lookAt = new THREE.Vector3();

function CameraRig() {
  const { camera, size } = useThree();
  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const aspect = size.width / size.height;
    view.mobile = size.width < 768;
    view.cap = view.mobile ? 12 : 20;
    const cam = camera as THREE.PerspectiveCamera;
    // ~35° look-down over the strait; back off on portrait so both fleets fit
    const dist = aspect < 1 ? 25 + (1 - aspect) * 6 : 24;
    const fov = aspect < 1 ? 62 : 48;
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect);
    view.halfW = THREE.MathUtils.clamp(0.62 * dist * Math.tan(hHalf), 3.6, 12);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const elev = THREE.MathUtils.degToRad(35);
    const t = state.clock.elapsedTime;
    fx.shake = Math.max(0, fx.shake - dt * 2.2);
    const sh = fx.shake * fx.shake * 0.35;
    cam.position.set(
      Math.sin(t * 0.05) * 0.6 + (Math.random() - 0.5) * sh,
      Math.sin(elev) * dist + (Math.random() - 0.5) * sh,
      Math.cos(elev) * dist + 2.5,
    );
    lookAt.set(0, 0, aspect < 1 ? 1.5 : 2.5);
    cam.lookAt(lookAt);
    if (import.meta.env.DEV) (window as unknown as { __nmsInfo: unknown }).__nmsInfo = state.gl.info.render;
  });
  return null;
}

function useFront() {
  const symbol = useBattle((s) => s.symbol);
  const nonce = useBattle((s) => s.nonce);
  useEffect(() => {
    const engine = new MarketEngine(symbol);
    engineRef.current = engine;
    view.displays.clear();
    view.mid = 0;
    const stop = connectFront(engine, (status, detail) => useBattle.setState({ status, statusDetail: detail }));
    const iv = setInterval(() => {
      const now = Date.now();
      useBattle.setState({
        hud: {
          mark: engine.mark,
          spread: engine.spread,
          bestBid: engine.bestBid,
          bestAsk: engine.bestAsk,
          funding: engine.funding,
          oi: engine.oi,
          oiChangePct: engine.oiChangePct,
          latency: engine.lastMsgAt ? now - engine.lastMsgAt : 0,
          ghostsPerMin: engine.ghostsPerMinute(now),
          lastLiq: engine.lastLiq,
          fullWar: engine.fullWar(now),
          volBps: engine.volBps,
          convoy: engine.convoy,
          hasBook: engine.bids.length > 0 && engine.asks.length > 0,
        },
      });
    }, 250);
    return () => {
      stop();
      clearInterval(iv);
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [symbol, nonce]);
}

export default function Battle() {
  useFront();
  usePredictionRounds();
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    preloadModels();
  }
  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 16, 24], fov: 48, near: 0.5, far: 20000 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.55, powerPreference: "high-performance" }}
      >
        <CameraRig />
        <Suspense fallback={null}>
          <Ocean />
        </Suspense>
        <Suspense fallback={null}>
          <Fleet />
          <Effects />
          <Background />
        </Suspense>
      </Canvas>
      <Hud />
    </div>
  );
}
