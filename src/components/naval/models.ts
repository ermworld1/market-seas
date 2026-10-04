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

export function useModelGeometry(name: ModelName): THREE.BufferGeometry {
  const { scene } = useGLTF(MODELS[name]);
  ensureSimplifier();
  return useMemo(() => {
    const key = name;
    let g = cache.get(key);
    if (!g) {
      g = simplify(normalizeGeometry(scene, name === "bomber" ? "air" : "ship"), TARGET_TRIS[name] ?? 5000);
      cache.set(key, g);
    }
    return g;
  }, [scene, name]);
}

export function preloadModels() {
  for (const url of Object.values(MODELS)) useGLTF.preload(url);
}

/** Shared realistic naval paint; side identity comes from physical stripes, deck marks and flags. */
export function makeFleetMaterial(side: "buyers" | "sellers", trim = false) {
  const color = new THREE.Color(trim ? "#657076" : side === "buyers" ? "#37454a" : "#414348").convertSRGBToLinear();
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: 0x000000,
    emissiveIntensity: 0,
    metalness: trim ? 0.48 : 0.62,
    roughness: trim ? 0.58 : 0.72,
    flatShading: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vHullPos;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHullPos = position;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vHullPos;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>\nfloat below = smoothstep(0.03, -0.08, vHullPos.y);\ndiffuseColor.rgb *= mix(1.0, 0.42, below);\nfloat weather = sin(vHullPos.x * 73.0 + sin(vHullPos.z * 51.0)) * sin(vHullPos.y * 117.0);\nfloat rust = smoothstep(0.84, 1.0, weather) * smoothstep(0.18, -0.02, vHullPos.y);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.075, 0.035), rust * 0.32);`,
    );
  };
  material.customProgramCacheKey = () => `naval-weather-${side}-${trim}`;
  return material;
}
