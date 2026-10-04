import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { connectFront } from "@/lib/market/binance";
import { MarketEngine } from "@/lib/market/engine";
import { engineRef, fx, loadProgress, useBattle } from "@/lib/market/store";
import { track } from "@/lib/analytics";
import { Background } from "./Background";
import { Effects } from "./Effects";
import { Fleet } from "./Fleet";
import { Ocean } from "./Ocean";
import { ELEVATION, REAR, view } from "./layout";
import { preloadModels } from "./models";
import { Hud } from "./Hud";
import { useDirector } from "./useDirector";
import { Guard } from "./Guard";
import { screen } from "./screen";

const lookAt = new THREE.Vector3();
const tmp = new THREE.Vector3();

/**
 * Orthographic camera ~65° above the horizon, centred on the strait: both
 * fleets render at the same scale regardless of distance from the camera.
 */
function CameraRig() {
  const { camera, size } = useThree();
  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const cam = camera as THREE.OrthographicCamera;
    view.mobile = size.width < 768;
    view.cap = view.mobile ? 50 : 120;
    const elev = THREE.MathUtils.degToRad(ELEVATION);
    // reserve space for the header (top) and sidebar (desktop right)
    const topPx = view.mobile ? 250 : 200;
    const botPx = view.mobile ? 215 : 110;
    const sidePx = size.width >= 1100 ? 340 : 0;
    const usableH = Math.max(200, size.height - topPx - botPx);
    const zoom = usableH / (2 * (REAR + 0.8) * Math.sin(elev));
    if (Math.abs(cam.zoom - zoom) > 1e-3) {
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
    }
    view.halfW = Math.max(3.2, ((size.width - sidePx) / 2 / zoom) * 0.9);
    // shift the strait so it sits in the middle of the free area
    const shiftX = sidePx / 2 / zoom;
    const shiftY = ((topPx - botPx) / 2 / zoom) / Math.sin(elev);
    view.offsetX = 0;
    fx.shake = Math.max(0, fx.shake - dt * 2.2);
    const sh = fx.shake * fx.shake * 0.25;
    lookAt.set(shiftX + (Math.random() - 0.5) * sh, 0, -shiftY + (Math.random() - 0.5) * sh);
    cam.position.set(lookAt.x, Math.sin(elev) * 100, lookAt.z + Math.cos(elev) * 100);
    cam.lookAt(lookAt);
    if (import.meta.env.DEV) (window as unknown as { __nmsInfo: unknown }).__nmsInfo = state.gl.info.render;
  });
  return null;
}

/** Projects world anchors to screen pixels for the DOM label layer (no drei Html). */
function Projector() {
  const { camera, size } = useThree();
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 1 / 30) return;
    acc.current = 0;
    const p = (a: { x: number; y: number; z: number } | null) => {
      if (!a) return null;
      tmp.set(a.x, a.y, a.z).project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height };
    };
    const A = view.anchors;
    screen.flag.bid = p(A.flag.bid);
    screen.flag.ask = p(A.flag.ask);
    screen.near = p(A.near);
    screen.repairs = A.repairs.map((r) => p(r)!);
    screen.floaters = A.floaters.map((f) => ({ ...p(f)!, id: f.id, text: f.text, tone: f.tone, age: view.time - f.t0 }));
    screen.strait = p({ x: 0, y: 0, z: 0 });
  });
  return null;
}

function useFront() {
  const nonce = useBattle((s) => s.nonce);
  useEffect(() => {
    const engine = new MarketEngine();
    engineRef.current = engine;
    view.displays.clear();
    view.mid = 0;
    let stop = () => {};
    try {
      stop = connectFront(engine, (status, detail) => useBattle.setState({ status, statusDetail: detail }));
    } catch (err) {
      console.error("[data] failed to start", err);
      useBattle.setState({ status: "unavailable", statusDetail: "data layer failed to start" });
    }
    return () => {
      stop();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [nonce]);
}

export default function Battle() {
  useFront();
  useDirector();
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    preloadModels();
  }
  useEffect(() => {
    loadProgress();
    track("page_view");
    const t0 = Date.now();
    const end = () => track("session_end", Math.round((Date.now() - t0) / 1000));
    window.addEventListener("pagehide", end);
    return () => window.removeEventListener("pagehide", end);
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <Guard name="scene" fallback={<div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">3D view unavailable on this device. Live data still runs below.</div>}>
        <div id="battle-canvas" className="absolute inset-0">
          <Canvas
            orthographic
            dpr={[1, 1.75]}
            camera={{ position: [0, 90, 42], zoom: 30, near: 0.1, far: 1000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.55, powerPreference: "high-performance", preserveDrawingBuffer: true }}
          >
            <CameraRig />
            <Projector />
            <Suspense fallback={null}>
              <Ocean />
            </Suspense>
            <Suspense fallback={null}>
              <Fleet />
              <Effects />
              <Background />
            </Suspense>
          </Canvas>
        </div>
      </Guard>
      <Guard name="hud">
        <Hud />
      </Guard>
    </div>
  );
}
