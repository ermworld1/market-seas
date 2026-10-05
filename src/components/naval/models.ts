import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";

let simplifierReady = false;
let simplifierPromise: Promise<void> | null = null;
function ensureSimplifier() {
  if (simplifierReady) return;
  simplifierPromise ??= MeshoptSimplifier.ready.then(() => {
    simplifierReady = true;
  });
  throw simplifierPromise;
}

/** Fleet ships are small on screen: decimate ~30k-triangle hulls to a mobile budget. */
const TARGET_TRIS: Record<string, number> = { patrol: 600, frigate: 1000, cruiser: 1800, battleship: 3200, tanker: 2000, transport: 1200, bomber: 1500 };

function simplify(src: THREE.BufferGeometry, targetTris: number) {
  // weld UV/normal seams so the simplifier can collapse edges
  const bare = new THREE.BufferGeometry();
  bare.setAttribute("position", src.getAttribute("position"));
  if (src.getIndex()) bare.setIndex(src.getIndex());
  const geo = mergeVertices(bare, 1e-4);
  const index = geo.getIndex();
  if (!index) return src;
  const pos = geo.getAttribute("position");
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(index.array), positions, 3, targetTris * 3, 0.05);
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  // faceted normals keep hard hull/superstructure edges readable after decimation
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  src.dispose();
  return flat;
}

export const MODELS = {
  patrol: "/models/patrol.glb",
  frigate: "/models/frigate.glb",
  cruiser: "/models/cruiser.glb",
  battleship: "/models/battleship.glb",
  tanker: "/models/tanker.glb",
  bomber: "/models/bomber.glb",
  transport: "/models/transport.glb",
} as const;
export type ModelName = keyof typeof MODELS;

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Merge every mesh in a GLB into one geometry, centre it, scale its longest
 * axis to 1 while preserving the delivered bow direction (-X).
 * Ships sit with their keel slightly below y=0 (the water plane).
 */
export function normalizeGeometry(scene: THREE.Object3D, kind: "ship" | "air"): THREE.BufferGeometry {
  scene.updateWorldMatrix(true, true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = new THREE.BufferGeometry();
    const src = m.geometry;
    g.setAttribute("position", src.getAttribute("position").clone());
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    if (src.getAttribute("normal")) g.setAttribute("normal", src.getAttribute("normal").clone());
    g.applyMatrix4(m.matrixWorld);
    parts.push(g);
  });
  const geo: THREE.BufferGeometry =
    parts.length === 1 ? parts[0]! : mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // longest axis to X (models are delivered along X already; this guards variants)
  geo.translate(-center.x, -center.y, -center.z);
  if (size.z > size.x && kind === "ship") geo.rotateY(Math.PI / 2);
  geo.computeBoundingBox();
  const s2 = geo.boundingBox!.getSize(new THREE.Vector3());
  const len = Math.max(s2.x, s2.z);
  geo.scale(1 / len, 1 / len, 1 / len);
  geo.computeBoundingBox();
  if (kind === "ship") {
    // keel 4% of length under water
    geo.translate(0, -geo.boundingBox!.min.y - 0.04, 0);
    // bow stays on -X; fleet instances rotate Sellers by PI to face left
  } else {
    // bomber: nose (-X) stays -X, fly along -X
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function useModelGeometry(name: ModelName, detail: "high" | "low" = "low"): THREE.BufferGeometry {
  const { scene } = useGLTF(MODELS[name]);
  if (detail === "low") ensureSimplifier();
  return useMemo(() => {
    const key = `${name}-${detail}`;
    let g = cache.get(key);
    if (!g) {
      const normalized = normalizeGeometry(scene, name === "bomber" ? "air" : "ship");
      g = detail === "high" ? normalized : simplify(normalized, TARGET_TRIS[name] ?? 5000);
      cache.set(key, g);
    }
    return g;
  }, [scene, name, detail]);
}

export function preloadModels() {
  for (const url of Object.values(MODELS)) useGLTF.preload(url);
}

/** Shared matte naval paint with a full deck and upper-hull side band; emissive is always zero. */
export function makeFleetMaterial(side: "buyers" | "sellers" | "neutral", trim = false) {
  const color = new THREE.Color(trim ? "#778187" : "#59666d").convertSRGBToLinear();
  const sideColor = new THREE.Color(side === "buyers" ? "#2F8F57" : side === "sellers" ? "#C0392B" : "#727b80").convertSRGBToLinear();
  const material = new THREE.MeshPhysicalMaterial({
    color,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: trim ? 0.3 : 0.34,
    roughness: trim ? 0.7 : 0.8,
    clearcoat: 0.03,
    clearcoatRoughness: 0.78,
    flatShading: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uSidePaint"] = { value: sideColor };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vHullPos;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHullPos = position;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vHullPos;\nuniform vec3 uSidePaint;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>\nfloat belowWater = 1.0 - smoothstep(-0.045, 0.005, vHullPos.y);\nfloat upperHull = smoothstep(0.025, 0.065, vHullPos.y) * (1.0 - smoothstep(0.145, 0.19, vHullPos.y));\nfloat mainDeck = smoothstep(0.09, 0.125, vHullPos.y) * (1.0 - smoothstep(0.19, 0.25, vHullPos.y));\nfloat superstructure = smoothstep(0.19, 0.28, vHullPos.y);\nfloat funnelBand = smoothstep(0.30, 0.36, vHullPos.y) * (1.0 - smoothstep(0.40, 0.47, vHullPos.y));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.055, 0.045), belowWater * 0.94);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSidePaint, max(upperHull * 0.96, mainDeck));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.62, 0.63), superstructure * 0.88);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSidePaint, funnelBand * 0.9);\nfloat panel = sin(vHullPos.x * 94.0) * sin(vHullPos.z * 71.0);\ndiffuseColor.rgb *= 0.98 + panel * 0.018;\nfloat weather = sin(vHullPos.x * 73.0 + sin(vHullPos.z * 51.0)) * sin(vHullPos.y * 117.0);\nfloat rust = smoothstep(0.91, 1.0, weather) * smoothstep(0.18, -0.02, vHullPos.y);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.075, 0.035), rust * 0.16);`,
    );
  };
  material.customProgramCacheKey = () => `naval-weather-${side}-${trim}`;
  return material;
}
