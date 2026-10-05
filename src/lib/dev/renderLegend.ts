/**
 * Dev-only: renders every legend icon from the exact scene models, materials and
 * effect colours (run from a headless browser; never imported by the app).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MODELS, makeFleetMaterial, normalizeGeometry } from "@/components/naval/models";
import { makeFighterGeometry } from "@/components/naval/fighter";
import { SIDE_HEX, UNIT_PAINT_HEX } from "@/lib/battle/units";

const W = 240;
const H = 120;
type Side = "bid" | "ask";

export async function renderLegend(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const loader = new GLTFLoader();
  const geo = async (n: keyof typeof MODELS, kind: "ship" | "air") => normalizeGeometry((await loader.loadAsync(MODELS[n])).scene, kind);
  const shot = (g: THREE.BufferGeometry, mat: THREE.Material, side: Side | "neutral", scale: number, air = false) => {
    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(new THREE.HemisphereLight("#f2f7fa", "#50616b", 1.65));
    const d = new THREE.DirectionalLight("#fff8e8", 2.6);
    d.position.set(2, 4, 3);
    scene.add(d);
    const m = new THREE.Mesh(g, mat);
    m.rotation.y = side === "bid" ? Math.PI * 0.72 : side === "ask" ? -Math.PI * 0.28 : -Math.PI * 0.22;
    m.scale.setScalar(scale);
    scene.add(m);
    if (!air) {
      const green = new THREE.MeshStandardMaterial({ color: UNIT_PAINT_HEX.bid, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.84 });
      const red = new THREE.MeshStandardMaterial({ color: UNIT_PAINT_HEX.ask, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.84 });
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.012, 0.12).translate(-0.19, 0.14, 0), green);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.012, 0.12).translate(0.19, 0.14, 0), red);
      for (const q of [left, right]) { q.rotation.y = m.rotation.y; q.scale.setScalar(scale); scene.add(q); }
    }
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    cam.position.set(0.55, air ? 1.05 : 0.72, 2.55);
    cam.lookAt(0, air ? 0 : 0.1, 0);
    r.setClearColor(0, 0);
    r.render(scene, cam);
    return r.domElement.toDataURL("image/png");
  };
  const ships: [string, keyof typeof MODELS, number][] = [
    ["patrol", "patrol", 0.7], ["destroyer", "frigate", 0.78], ["frigate", "frigate", 0.95], ["cruiser", "cruiser", 1], ["battleship", "battleship", 1],
    ["tanker", "tanker", 1], ["transport", "transport", 1],
  ];
  for (const [id, model, sc] of ships) {
    const g = await geo(model, "ship");
    const mat = model === "transport" ? new THREE.MeshStandardMaterial({ color: "#68747a", emissive: 0x000000, emissiveIntensity: 0, metalness: 0.3, roughness: 0.72 }) : makeFleetMaterial("neutral", id === "destroyer");
    out[id] = shot(g, mat, "neutral", sc);
  }
  const air = () => new THREE.MeshStandardMaterial({ color: new THREE.Color("#4d565b").convertSRGBToLinear(), emissive: 0x000000, emissiveIntensity: 0, metalness: 0.4, roughness: 0.62, flatShading: true });
  const bomber = await geo("bomber", "air");
  const fighter = makeFighterGeometry();
  fighter.computeBoundingBox();
  out.bomber = shot(bomber, air(), "neutral", 1, true);
  out.fighter = shot(fighter, air(), "neutral", 0.9, true);
  r.dispose();
  // effect icons: same colours as the scene's effects
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const tint = (side: Side, base: string) => {
    const a = new THREE.Color(base);
    return "#" + a.lerp(new THREE.Color(SIDE_HEX[side]), 0.6).getHexString();
  };
  const fx = (name: string, draw: () => void) => {
    g.clearRect(0, 0, W, H);
    g.save();
    draw();
    g.restore();
    out[name] = c.toDataURL("image/png");
  };
  const streak = (x0: number, y0: number, x1: number, y1: number, w: number, col: string) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, col);
    g.strokeStyle = gr;
    g.lineWidth = w;
    g.lineCap = "round";
    g.shadowColor = col;
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const dir = (side: Side) => (side === "bid" ? 1 : -1);
  for (const side of ["bid", "ask"] as Side[]) {
    const L = (x: number) => (dir(side) > 0 ? x : W - x);
    fx(`fx-mg-${side}`, () => { for (let i = 0; i < 4; i++) streak(L(30 + i * 40), 40 + i * 9, L(80 + i * 40), 38 + i * 9, 3, tint(side, "#ffd27a")); });
    fx(`fx-gun-${side}`, () => {
      g.strokeStyle = tint(side, "#ffb050"); g.lineWidth = 2; g.setLineDash([4, 6]);
      g.beginPath(); g.moveTo(L(30), 90); g.quadraticCurveTo(L(128), 0, L(226), 90); g.stroke(); g.setLineDash([]);
      g.fillStyle = tint(side, "#ffe0a0"); g.shadowColor = g.fillStyle; g.shadowBlur = 12; g.beginPath(); g.arc(L(150), 38, 6, 0, 7); g.fill();
    });
    fx(`fx-torpedo-${side}`, () => {
      g.fillStyle = "rgba(230,246,250,0.75)";
      for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(L(20 + i * 11), 62 + Math.sin(i) * 3, 2 + i * 0.35, 0, 7); g.fill(); }
      g.fillStyle = "#2a2e31"; g.fillRect(L(dir(side) > 0 ? 214 : 242), 58, 28, 8);
    });
    fx(`fx-broadside-${side}`, () => { for (let i = 0; i < 5; i++) streak(L(30), 30 + i * 13, L(220), 26 + i * 13, 5, tint(side, "#ffb84a")); });
  }
  for (const id of ["fx-mg", "fx-gun", "fx-torpedo", "fx-broadside"]) out[id] = out[`${id}-bid`]!;
  const water = () => { g.fillStyle = "rgba(60,110,130,0.35)"; g.fillRect(0, 78, W, 34); };
  const puff = (x: number, y: number, r: number, col: string) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  fx("fx-sink", () => { water(); g.fillStyle = "#3b4045"; g.beginPath(); g.moveTo(90, 82); g.lineTo(150, 50); g.lineTo(170, 62); g.lineTo(120, 92); g.fill(); puff(140, 70, 30, "rgba(255,140,40,0.8)"); });
  fx("fx-fire", () => { puff(128, 60, 34, "rgba(255,120,30,0.9)"); puff(120, 30, 34, "rgba(20,20,20,0.8)"); });
  fx("fx-dive", () => { water(); g.fillStyle = "#3b4045"; g.fillRect(110, 76, 50, 6); g.fillRect(130, 64, 8, 14); for (let i = 0; i < 6; i++) puff(100 - i * 12, 80, 8, "rgba(230,246,250,0.7)"); });
  fx("fx-smoke", () => { for (let i = 0; i < 6; i++) puff(60 + i * 26, 64 - (i % 2) * 10, 28, "rgba(220,224,228,0.7)"); });
  fx("fx-surface", () => { water(); g.fillStyle = "#3b4045"; g.fillRect(100, 70, 60, 10); g.fillRect(124, 54, 10, 18); puff(130, 80, 40, "rgba(230,246,250,0.5)"); });
  fx("fx-reinforce", () => { g.font = "700 40px sans-serif"; g.textAlign = "center"; g.fillStyle = "#e8f0ff"; g.fillText("+$1.2M", 128, 70); });
  fx("fx-repair", () => { g.font = "600 24px sans-serif"; g.textAlign = "center"; g.fillStyle = "#7be3a7"; g.fillText("repair (inferred)", 128, 64); });
  fx("fx-splash", () => { water(); g.fillStyle = "rgba(235,248,252,0.9)"; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(128 + (i - 4) * 6, 70 - Math.abs(4 - i) * -4 - 10, 4, 22 - Math.abs(4 - i) * 4, 0, 0, 7); g.fill(); } });
  fx("fx-flak", () => { for (const [x, y] of [[60, 40], [130, 26], [190, 52], [100, 70]]) { puff(x!, y!, 18, "rgba(15,15,15,0.9)"); puff(x!, y!, 6, "rgba(255,190,90,0.9)"); } });
  fx("fx-cascade", () => { puff(128, 60, 60, "rgba(255,90,30,0.7)"); for (const [x, y] of [[50, 30], [200, 24], [140, 40]]) puff(x!, y!, 14, "rgba(15,15,15,0.9)"); g.fillStyle = "#2a2e31"; for (let i = 0; i < 4; i++) g.fillRect(40 + i * 50, 14 + (i % 2) * 10, 22, 4); });
  fx("fx-strait", () => { g.strokeStyle = "#fff4d6"; g.shadowColor = "#fff4d6"; g.shadowBlur = 14; g.lineWidth = 4; g.beginPath(); g.moveTo(128, 6); g.lineTo(128, 106); g.stroke(); for (let y = 12; y < 110; y += 20) { g.fillStyle = "#fff"; g.beginPath(); g.arc(128, y, 4, 0, 7); g.fill(); } });
  fx("fx-storm", () => { g.fillStyle = "rgba(58,66,72,0.8)"; g.fillRect(0, 0, W, 40); g.strokeStyle = "rgba(200,215,225,0.7)"; g.lineWidth = 1.5; for (let i = 0; i < 30; i++) { const x = (i * 37) % W; g.beginPath(); g.moveTo(x, 40 + (i % 5) * 10); g.lineTo(x - 6, 58 + (i % 5) * 10); g.stroke(); } });
  return out;
}
