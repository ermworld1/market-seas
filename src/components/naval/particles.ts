import * as THREE from "three";

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
uniform float uSoft;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, uSoft, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
}`;

export interface EmitOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  grow?: number;
  color: THREE.ColorRepresentation | THREE.Color;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const tmpColor = new THREE.Color();

/** GPU point-sprite pool: one draw call, zero allocations during play. */
export class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private baseAlpha: Float32Array;
  private baseSize: Float32Array;
  private grow: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  live = 0;

  constructor(
    readonly capacity: number,
    additive: boolean,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.25 } },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  emit(o: EmitOpts) {
    // find a free slot, starting at the cursor; overwrite oldest if full
    let i = this.cursor;
    for (let n = 0; n < this.capacity; n++) {
      const j = (this.cursor + n) % this.capacity;
      if (this.life[j]! <= 0) {
        i = j;
        break;
      }
    }
    this.cursor = (i + 1) % this.capacity;
    const k = i * 3;
    this.pos[k]! = o.x;
    this.pos[k + 1]! = o.y;
    this.pos[k + 2]! = o.z;
    this.vel[k]! = o.vx ?? 0;
    this.vel[k + 1]! = o.vy ?? 0;
    this.vel[k + 2]! = o.vz ?? 0;
    tmpColor.set(o.color as THREE.ColorRepresentation);
    this.col[k] = tmpColor.r;
    this.col[k + 1] = tmpColor.g;
    this.col[k + 2] = tmpColor.b;
    this.life[i]! = this.maxLife[i]! = o.life;
    this.baseSize[i]! = o.size;
    this.grow[i]! = o.grow ?? 0;
    this.baseAlpha[i]! = o.alpha ?? 1;
    this.grav[i]! = o.gravity ?? 0;
    this.drag[i]! = o.drag ?? 0;
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) {
        if (this.alpha[i]! !== 0) this.alpha[i]! = 0;
        continue;
      }
      live++;
      this.life[i]! -= dt;
      const k = i * 3;
      const damp = Math.exp(-this.drag[i]! * dt);
      this.vel[k]! *= damp;
      this.vel[k + 2]! *= damp;
      this.vel[k + 1]! = this.vel[k + 1]! * damp - this.grav[i]! * dt;
      this.pos[k]! += this.vel[k]! * dt;
      this.pos[k + 1]! += this.vel[k + 1]! * dt;
      this.pos[k + 2]! += this.vel[k + 2]! * dt;
      if (this.grav[i]! > 0 && this.pos[k + 1]! < 0) this.life[i]! = 0;
      const t = 1 - Math.max(0, this.life[i]!) / this.maxLife[i]!;
      this.size[i]! = this.baseSize[i]! * (1 + this.grow[i]! * t);
      this.alpha[i]! = this.baseAlpha[i]! * (t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9);
    }
    this.live = live;
    const g = this.points.geometry;
    g.getAttribute("position").needsUpdate = true;
    g.getAttribute("aColor").needsUpdate = true;
    g.getAttribute("aAlpha").needsUpdate = true;
    g.getAttribute("aSize").needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
