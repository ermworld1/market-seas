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
import { DEPTH, ELEVATION, GAP, REAR, view } from "./layout";
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
  const { camera, size, gl } = useThree();
  const gesture = useRef({ pointers: new Map<number, number>(), lastX: 0, pinch: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (window.innerWidth >= 768) return;
      gesture.current.pointers.set(e.pointerId, e.clientX);
      gesture.current.lastX = e.clientX;
      if (gesture.current.pointers.size === 2) {
        const xs = [...gesture.current.pointers.values()];
        gesture.current.pinch = Math.abs((xs[1] ?? 0) - (xs[0] ?? 0));
      }
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!gesture.current.pointers.has(e.pointerId) || window.innerWidth >= 768) return;
      gesture.current.pointers.set(e.pointerId, e.clientX);
      if (gesture.current.pointers.size === 1) {
        const dx = e.clientX - gesture.current.lastX;
        view.cameraX = THREE.MathUtils.clamp(view.cameraX - dx / 34 / view.zoomScale, view.frontX - DEPTH, view.frontX + DEPTH);
        gesture.current.lastX = e.clientX;
      } else {
        const xs = [...gesture.current.pointers.values()];
        const distance = Math.abs((xs[1] ?? 0) - (xs[0] ?? 0));
        if (gesture.current.pinch > 4) view.zoomScale = THREE.MathUtils.clamp(view.zoomScale * (distance / gesture.current.pinch), 0.65, 2.2);
        gesture.current.pinch = distance;
      }
    };
    const up = (e: PointerEvent) => {
      gesture.current.pointers.delete(e.pointerId);
      gesture.current.pinch = 0;
    };
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl]);
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
    const usableW = Math.max(220, size.width - sidePx);
    const worldHalfX = view.mobile ? GAP + DEPTH * 0.4 : REAR;
    const zoomX = usableW / (2 * worldHalfX);
    const zoomY = usableH / (2 * 8.5 * Math.sin(elev));
    const zoom = Math.min(zoomX, zoomY) * (view.mobile ? view.zoomScale : 1);
    if (Math.abs(cam.zoom - zoom) > 1e-3) {
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
    }
    view.halfW = Math.max(4.5, (usableH / 2 / zoom / Math.sin(elev)) * 0.82);
    // shift the strait so it sits in the middle of the free area
    const shiftX = sidePx / 2 / zoom;
    const shiftY = ((topPx - botPx) / 2 / zoom) / Math.sin(elev);
    if (!view.mobile) view.cameraX = 0;
    fx.shake = Math.max(0, fx.shake - dt * 2.2);
    const sh = fx.shake * fx.shake * 0.25;
    lookAt.set(view.cameraX + shiftX + (Math.random() - 0.5) * sh, 0, -shiftY + (Math.random() - 0.5) * sh);
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
    screen.strait = p({ x: view.frontX, y: 0, z: 0 });
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
    view.origin = 0;
    view.frontX = 0;
    view.cameraX = 0;
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
