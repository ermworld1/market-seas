import * as THREE from "three";
import { fx } from "@/lib/market/store";
import { DEPTH, GAP, REAR, sideSign, view } from "./layout";

/**
 * Cinema camera poses (perspective). Reads only mutable scene state written by
 * Effects/Fleet from real events; never creates events.
 */
const pos = new THREE.Vector3();
const look = new THREE.Vector3();
const curPos = new THREE.Vector3(0, 6, 30);
const curLook = new THREE.Vector3();
let lastKind = "";
let cutAt = 0;

function wide(t: number) {
  // Readable 40° oblique establishing view: hull sides, decks and superstructure stay visible.
  const side = 0; // fixed, centred on the front line (no periodic side swap)
  const dist = view.mobile ? 14 : 12;
  const elevation = THREE.MathUtils.degToRad(40);
  pos.set(view.frontX + side * 4.8, dist * Math.sin(elevation), view.halfW * 0.55 + dist * Math.cos(elevation));
  look.set(view.frontX, 0.35, 0);
}

export function cinemaPose(cam: THREE.PerspectiveCamera, dt: number) {
  const t = view.time;
  const shot = view.shot && performance.now() < view.shot.until ? view.shot : null;
  // aircraft shots only cut while that real aircraft is actually in the sky
  const air = shot?.kind === "fighter" || shot?.kind === "bomber";
  const kind = shot && !(air && !view.planeActive && lastKind !== shot.kind) ? shot.kind : "wide";
  const target = shot?.side && shot.bucket !== undefined ? (view.bucketVisual.get(shot.side + shot.bucket) ?? view.displays.get(shot.side + shot.bucket)) : null;
  const tr = view.track;
  const plane = view.plane;
  const pd = view.planeDir;
  let snap = false;
  if (kind !== lastKind) { snap = kind !== "wide"; lastKind = kind; cutAt = t; if (kind !== "wide") view.cuts[kind] = (view.cuts[kind] ?? 0) + 1; }
  const age = t - cutAt;
  let fov = view.mobile ? 39 : 36;
  let dof = 0; // focus distance for depth of field (0 = off)
  switch (kind) {
    case "trade":
    case "broadside": {
      if (tr) {
        // deck at gun height behind the muzzle; track the projectile to impact
        const s = sideSign(tr.side);
        const u = Math.min(1, (t - tr.t0) / Math.max(0.05, tr.dur));
        const hero = kind === "broadside";
        pos.set(tr.fx - s * (hero ? 3.2 : 1.6), hero ? 0.35 : 0.55, tr.fz + (hero ? 2.6 : 0.9));
        look.set(tr.fx + (tr.tx - tr.fx) * u, 0.3, tr.fz + (tr.tz - tr.fz) * u);
        if (hero && age < 0.3) look.set(tr.fx, 0.5, tr.fz);
        fov = hero ? 34 : 38;
        dof = pos.distanceTo(look);
      } else wide(t);
      break;
    }
    case "fighter":
      if (plane && pd) {
        pos.set(plane.x - pd.x * 3, plane.y + 1.1, plane.z - pd.z * 3);
        look.set(plane.x + pd.x * 4, plane.y - 0.6, plane.z + pd.z * 4);
        fov = 50; dof = 3.2;
      } else wide(t);
      break;
    case "bomber":
      if (age < 1.2 && plane && pd) {
        // dive POV from the bomber
        pos.set(plane.x, plane.y + 0.3, plane.z);
        look.set(plane.x + pd.x * 3, 0, plane.z + pd.z * 3 + 1);
        fov = 55;
      } else {
        // waterline view of the bomb impact zone at the fleet rear
        const s = sideSign(shot?.side ?? "bid");
        const x = view.frontX + s * (GAP + DEPTH * 0.82);
        pos.set(x - s * 6, 0.25, view.halfW * 0.5 + 6);
        look.set(x, 0.8, 0);
        fov = 40; dof = 9;
        if (age < 1.3) snap = true;
      }
      break;
    case "cascade":
      pos.set(view.frontX + Math.sin(t * 0.1) * 3, 2.2, view.halfW + 16);
      look.set(view.frontX, 2.5, 0);
      fov = 55;
      fx.shake = Math.max(fx.shake, 0.25);
      break;
    case "flagship":
      if (target) {
        const s = sideSign(target.side);
        pos.set(target.x - s * 4, 0.6, target.z + 5);
        look.set(target.x, 0.1, target.z);
        fov = 36; dof = pos.distanceTo(look);
      } else wide(t);
      break;
    default:
      wide(t);
  }
  const k = snap ? 1 : 1 - Math.exp(-(kind === "wide" ? 0.8 : 6) * dt);
  curPos.lerp(pos, k);
  curLook.lerp(look, k);
  const sh = fx.shake * fx.shake * 0.3;
  const tt = performance.now() / 1000;
  cam.position.set(curPos.x + Math.sin(tt * 23) * sh * 0.5, Math.max(0.15, curPos.y + Math.sin(tt * 19 + 0.7) * sh * 0.4), curPos.z);
  cam.lookAt(curLook);
  if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * (snap ? 1 : 0.1); cam.updateProjectionMatrix(); }
  view.focus = dof;
}
