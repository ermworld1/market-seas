import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Procedural low-poly swept-wing jet, nose along -X (same convention as the bomber). ~60 triangles. */
export function makeFighterGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.ConeGeometry(0.09, 1, 6).rotateZ(Math.PI / 2); // tip → -X
  parts.push(body);
  const tail = new THREE.CylinderGeometry(0.09, 0.07, 0.35, 6).rotateZ(Math.PI / 2).translate(0.62, 0, 0);
  parts.push(tail);
  const wing = (sign: number) => {
    const s = new THREE.Shape();
    s.moveTo(-0.1, 0);
    s.lineTo(0.35, sign * 0.55);
    s.lineTo(0.5, sign * 0.55);
    s.lineTo(0.35, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    return g;
  };
  parts.push(wing(1), wing(-1));
  const fin = new THREE.Shape();
  fin.moveTo(0.5, 0);
  fin.lineTo(0.78, 0.28);
  fin.lineTo(0.82, 0.28);
  fin.lineTo(0.8, 0);
  parts.push(new THREE.ExtrudeGeometry(fin, { depth: 0.015, bevelEnabled: false }));
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => {
    p.deleteAttribute("uv");
    return p;
  }), false)!;
  g.computeVertexNormals();
  parts.forEach((p) => p.dispose());
  return g;
}
