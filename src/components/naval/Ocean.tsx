import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { engineRef } from "@/lib/market/store";
import { seaState } from "@/lib/market/rules";
import { view } from "./layout";

const SUN_ELEV = 38; // degrees: high enough to glint into a near top-down camera
const SUN_AZ = 180; // north: sun behind the Bears → glints across the strait

function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 15 + Math.random() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    for (const dx of [-256, 0, 256])
      for (const dy of [-256, 0, 256]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

const RAIN_MAX = 2200;

type V<T> = { value: T };
interface WaterU {
  time: V<number>;
  distortionScale: V<number>;
  size: V<number>;
  waterColor: V<THREE.Color>;
  mirrorSampler: V<THREE.Texture | null>;
}
interface SkyU {
  turbidity: V<number>;
  rayleigh: V<number>;
  mieCoefficient: V<number>;
  mieDirectionalG: V<number>;
  sunPosition: V<THREE.Vector3>;
}
const wu = (w: Water) => w.material.uniforms as unknown as WaterU;
const sku = (s: Sky) => s.material.uniforms as unknown as SkyU;

export function Ocean() {
  const { scene, gl } = useThree();
  const normals = useLoader(THREE.TextureLoader, "/textures/waternormals.jpg");
  const sun = useMemo(() => {
    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEV);
    const theta = THREE.MathUtils.degToRad(SUN_AZ);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }, []);

  const water = useMemo(() => {
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    const w = new Water(new THREE.PlaneGeometry(3000, 3000), {
      textureWidth: view.mobile ? 256 : 512,
      textureHeight: view.mobile ? 256 : 512,
      waterNormals: normals,
      sunDirection: sun.clone(),
      sunColor: 0xfff1d6,
      waterColor: 0x0a2a33,
      distortionScale: 2.5,
      fog: true,
      alpha: 1,
    });
    w.rotation.x = -Math.PI / 2;
    wu(w).size.value = 2.2;
    return w;
  }, [normals, sun]);

  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(10000);
    const u = sku(s);
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.85;
    u.sunPosition.value.copy(sun);
    return s;
  }, [sun]);

  const clouds = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, opacity: 0.15, color: "#ffffff", depthWrite: false, fog: false }),
    );
    m.rotation.x = Math.PI / 2;
    m.position.y = 45;
    return m;
  }, []);

  const rain = useMemo(() => {
    const pos = new Float32Array(RAIN_MAX * 6);
    for (let i = 0; i < RAIN_MAX; i++) {
      const x = (Math.random() - 0.5) * 60;
      const y = Math.random() * 25;
      const z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x + 0.05, y + 0.6, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#b8c8d4", transparent: true, opacity: 0.45 }));
    l.frustumCulled = false;
    return l;
  }, []);

  const fog = useMemo(() => new THREE.Fog("#a9bcc6", 45, 260), []);
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const storm = useRef(0);
  const flashT = useRef(0);
  const calmFog = useMemo(() => new THREE.Color("#a9bcc6"), []);
  const stormFog = useMemo(() => new THREE.Color("#3a4248"), []);
  const warFog = useMemo(() => new THREE.Color("#4a2e2a"), []);

  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
      water.geometry.dispose();
      water.material.dispose();
      wu(water).mirrorSampler.value?.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.geometry.dispose();
      (clouds.material as THREE.MeshBasicMaterial).map?.dispose();
      (clouds.material as THREE.Material).dispose();
      rain.geometry.dispose();
      (rain.material as THREE.Material).dispose();
    };
  }, [scene, fog, water, sky, clouds, rain]);

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const e = engineRef.current;
    const phase = e?.phase.current ?? "P0";
    const war = phase === "P5";
    const mood = phase === "P5" ? 0.85 : phase === "P3" ? 0.4 : phase === "P1" || phase === "P7" ? 0 : 0.1;
    const target = Math.max(e ? seaState(e.volBps) : 0, mood);
    storm.current += (target - storm.current) * (1 - Math.exp(-0.6 * dt));
    const s = storm.current;
    view.storm = s;
    view.war = war;

    const u = wu(water);
    u.time.value += dt * (0.45 + s * 1.1);
    u.distortionScale.value = 2.2 + s * 5.5;
    u.size.value = 2.2 - s * 1.0;
    u.waterColor.value.setRGB(0.04 - s * 0.02, 0.16 - s * 0.07, 0.2 - s * 0.08);

    const su = sku(sky);
    su.turbidity.value = 4 + s * 14;
    su.rayleigh.value = 1.4 + s * 2.4;
    su.mieCoefficient.value = 0.005 + s * 0.02;

    const cm = clouds.material as THREE.MeshBasicMaterial;
    cm.opacity = 0.12 + s * 0.78;
    cm.color.setScalar(1 - s * 0.72);
    cm.map!.offset.x += dt * (0.003 + s * 0.012);

    fog.color.copy(calmFog).lerp(war ? warFog : stormFog, s);
    fog.near = 45 - s * 28;
    fog.far = 260 - s * 160;

    // lightning only in FULL WAR
    flashT.current = Math.max(0, flashT.current - dt * 4);
    if (war && Math.random() < dt * 0.4) flashT.current = 1;
    if (sunLight.current) sunLight.current.intensity = 2.6 * (1 - s * 0.6) + flashT.current * 3;
    if (hemi.current) hemi.current.intensity = 0.9 * (1 - s * 0.35) + flashT.current * 1.5;
    gl.toneMappingExposure = 0.55 - s * 0.12 + flashT.current * 0.4;

    // rain
    const count = Math.floor(RAIN_MAX * Math.max(0, (s - 0.25) / 0.75) * (view.mobile ? 0.5 : 1));
    rain.geometry.setDrawRange(0, count * 2);
    if (count > 0) {
      const p = rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      const a = p.array as unknown as number[];
      const fall = (18 + s * 10) * dt;
      for (let i = 0; i < count; i++) {
        const k = i * 6;
        a[k + 1] = a[k + 1]! - fall;
        a[k + 4] = a[k + 4]! - fall;
        if (a[k + 1]! < 0) {
          a[k + 1] = a[k + 1]! + 25;
          a[k + 4] = a[k + 4]! + 25;
        }
      }
      p.needsUpdate = true;
    }
    rain.position.set(view.offsetX, 0, 0);
  });

  return (
    <>
      <primitive object={sky} />
      <primitive object={water} />
      <primitive object={clouds} />
      <primitive object={rain} />
      <hemisphereLight ref={hemi} args={["#cfe3f0", "#1d3a44", 0.9]} />
      <directionalLight ref={sunLight} position={[sun.x * 100, sun.y * 100 + 30, sun.z * 100]} intensity={2.6} color="#fff0d8" />
      <ambientLight intensity={0.25} />
      <Environment frames={1} resolution={128}>
        <Lightformer intensity={2.5} position={[0, 6, -10]} scale={[20, 4, 1]} color="#ffe6c4" />
        <Lightformer intensity={1} position={[-8, 3, 4]} rotation-y={Math.PI / 2} scale={[20, 2, 1]} color="#9fc3d6" />
        <Lightformer intensity={0.6} position={[8, 2, 6]} rotation-y={-Math.PI / 2} scale={[20, 2, 1]} color="#6e8ea0" />
      </Environment>
    </>
  );
}
