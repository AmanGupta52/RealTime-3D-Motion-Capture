import * as THREE from 'three';
import { OneEuroFilter } from '../utils/OneEuroFilter';
import type { VRM } from '@pixiv/three-vrm';
import type { BoneKey } from './boneMap';

const ARKIT = ('browDownLeft,browDownRight,browInnerUp,browOuterUpLeft,browOuterUpRight,cheekPuff,cheekSquintLeft,cheekSquintRight,' +
  'eyeBlinkLeft,eyeBlinkRight,eyeLookDownLeft,eyeLookDownRight,eyeLookInLeft,eyeLookInRight,eyeLookOutLeft,eyeLookOutRight,' +
  'eyeLookUpLeft,eyeLookUpRight,eyeSquintLeft,eyeSquintRight,eyeWideLeft,eyeWideRight,jawForward,jawLeft,jawOpen,jawRight,' +
  'mouthClose,mouthDimpleLeft,mouthDimpleRight,mouthFrownLeft,mouthFrownRight,mouthFunnel,mouthLeft,mouthLowerDownLeft,' +
  'mouthLowerDownRight,mouthPressLeft,mouthPressRight,mouthPucker,mouthRight,mouthRollLower,mouthRollUpper,mouthShrugLower,' +
  'mouthShrugUpper,mouthSmileLeft,mouthSmileRight,mouthStretchLeft,mouthStretchRight,mouthUpperUpLeft,mouthUpperUpRight,' +
  'noseSneerLeft,noseSneerRight,tongueOut').split(',');
const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const ARKIT_BY_NORM = new Map(ARKIT.map((n) => [norm(n), n]));
const swapLR = (n: string) => (/Left$/.test(n) ? n.replace(/Left$/, 'Right') : /Right$/.test(n) ? n.replace(/Right$/, 'Left') : n);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** MediaPipe's blink score rarely reaches 1 and rests around 0.1-0.2, so shape it: fully closed at ~0.7, fully open below ~0.15. */
const gateBlink = (x: number) => clamp01((x - 0.15) / 0.55);
/** Same idea for the mouth: a wide-open mouth only scores ~0.6-0.8 on jawOpen. */
const gateMouth = (x: number) => clamp01(x * 1.35);
const gateExpr = (x: number, lo = 0.3) => clamp01((x - lo) / (1 - lo));

type Getter = (name: string) => number;
const avg = (g: Getter, a: string, b: string) => (g(a) + g(b)) / 2;
/** Morph-target names used by other tools (Ready Player Me visemes, "mouthOpen", "Blink_L"...) mapped onto the ARKit scores.
 *  Only used for meshes that have no exact ARKit names, so models that already speak ARKit are never driven twice. */
const ALIASES: Record<string, (g: Getter) => number> = {
  mouthopen: (g) => g('jawOpen'), openmouth: (g) => g('jawOpen'), mouthopened: (g) => g('jawOpen'), jawopened: (g) => g('jawOpen'),
  aa: (g) => g('jawOpen'), visemeaa: (g) => g('jawOpen'), vrcvisaa: (g) => g('jawOpen'), a: (g) => g('jawOpen'),
  visemeo: (g) => g('mouthFunnel'), visemeu: (g) => g('mouthPucker'), vrcviso: (g) => g('mouthFunnel'), vrcvisou: (g) => g('mouthPucker'),
  visemee: (g) => avg(g, 'mouthStretchLeft', 'mouthStretchRight'), visemei: (g) => avg(g, 'mouthSmileLeft', 'mouthSmileRight'),
  blink: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')), blinkboth: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')),
  eyesclosed: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')), eyeclosed: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')),
  eyesclose: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')), eyeclose: (g) => Math.max(g('eyeBlinkLeft'), g('eyeBlinkRight')),
  blinkl: (g) => g('eyeBlinkLeft'), blinkleft: (g) => g('eyeBlinkLeft'), eyeclosedl: (g) => g('eyeBlinkLeft'), eyecloseleft: (g) => g('eyeBlinkLeft'),
  eyeclosel: (g) => g('eyeBlinkLeft'), winkl: (g) => g('eyeBlinkLeft'), winkleft: (g) => g('eyeBlinkLeft'),
  blinkr: (g) => g('eyeBlinkRight'), blinkright: (g) => g('eyeBlinkRight'), eyeclosedr: (g) => g('eyeBlinkRight'), eyecloseright: (g) => g('eyeBlinkRight'),
  eyecloser: (g) => g('eyeBlinkRight'), winkr: (g) => g('eyeBlinkRight'), winkright: (g) => g('eyeBlinkRight'),
  smile: (g) => avg(g, 'mouthSmileLeft', 'mouthSmileRight'), mouthsmile: (g) => avg(g, 'mouthSmileLeft', 'mouthSmileRight'),
  happy: (g) => avg(g, 'mouthSmileLeft', 'mouthSmileRight'), sad: (g) => avg(g, 'mouthFrownLeft', 'mouthFrownRight'),
  frown: (g) => avg(g, 'mouthFrownLeft', 'mouthFrownRight'), angry: (g) => avg(g, 'browDownLeft', 'browDownRight'),
  surprised: (g) => avg(g, 'eyeWideLeft', 'eyeWideRight'), browup: (g) => g('browInnerUp'),
};
const MOUTH_ALIASES = new Set(['mouthopen', 'openmouth', 'mouthopened', 'jawopened', 'aa', 'visemeaa', 'vrcvisaa', 'a']);
const BLINK_ALIASES = new Set(['blink', 'blinkboth', 'eyesclosed', 'eyeclosed', 'eyesclose', 'eyeclose', 'blinkl', 'blinkleft', 'eyeclosedl', 'eyecloseleft',
  'eyeclosel', 'winkl', 'winkleft', 'blinkr', 'blinkright', 'eyeclosedr', 'eyecloseright', 'eyecloser', 'winkr', 'winkright']);

interface Part { bone: THREE.Object3D; target: THREE.Quaternion; shown: THREE.Quaternion; solved: boolean }
const part = (bone: THREE.Object3D): Part => ({ bone, target: bone.quaternion.clone(), shown: bone.quaternion.clone(), solved: false });

/**
 * Face: head/neck rotation from MediaPipe's facial transformation matrix, eye gaze + blink from blendshapes,
 * and every ARKit blendshape (52) applied to any matching morph target on the model (names are matched loosely).
 * Models without morph targets (e.g. stylised creatures) still get head turn, gaze and a blink squash on the eye bones.
 */
export class FaceRig {
  active = false; mirror = false;
  private head?: Part; private neck?: Part; private eyes: (Part | undefined)[] = [undefined, undefined]; // [char left, char right]
  private restHead = new THREE.Quaternion(); private restNeck = new THREE.Quaternion();
  private restEye = [new THREE.Quaternion(), new THREE.Quaternion()];
  private blinkAxis = [1, 1]; private baseScale = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)]; private shownBlink = [0, 0];
  private morphs: { mesh: THREE.Mesh; idx: number; drive: () => number }[] = [];
  private jaw?: Part; private restJaw = new THREE.Quaternion(); private jawAxis = new THREE.Vector3(1, 0, 0);
  /** The 52 blendshape names arrive once per tracking session. Keep them so a rig created later (model switch, bone-map edit) still works. */
  static names: string[] | null = null;
  private hasBlinkMorph = false;
  private index = new Map<string, number>();
  private vals = new Float32Array(64);
  private filters = Array.from({ length: 64 }, () => new OneEuroFilter(3, 1));
  private qFace = new THREE.Quaternion(); private neutral = new THREE.Quaternion(); private neutralInv = new THREE.Quaternion();
  private delta = new THREE.Quaternion(); private qd = new THREE.Quaternion(); private qf = new THREE.Quaternion(); private acc = new THREE.Quaternion(); private n = 0; private sampling = false;
  private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion(); private qc = new THREE.Quaternion();
  private eul = new THREE.Euler(); private mat = new THREE.Matrix4(); private pp = new THREE.Vector3(); private ss = new THREE.Vector3();
  private lastT = 0; private tData = -1e9; private hasMatrix = false;

  constructor(root: THREE.Object3D, map: Partial<Record<BoneKey, THREE.Object3D>>, private vrm?: VRM) {
    root.updateMatrixWorld(true);
    if (map.head) { this.head = part(map.head); map.head.getWorldQuaternion(this.restHead); }
    if (map.neck) { this.neck = part(map.neck); map.neck.getWorldQuaternion(this.restNeck); }
    [map.lEye, map.rEye].forEach((e, i) => {
      if (!e) return;
      this.eyes[i] = part(e); e.getWorldQuaternion(this.restEye[i]!); this.baseScale[i]!.copy(e.scale);
      // squash the local axis that points most vertically at rest, so a blink closes the eye whatever the bone's roll
      let best = -1;
      for (let a = 0; a < 3; a++) {
        const v = new THREE.Vector3().setComponent(a, 1).applyQuaternion(this.restEye[i]!);
        if (Math.abs(v.y) > best) { best = Math.abs(v.y); this.blinkAxis[i] = a; }
      }
    });
    if (FaceRig.names) FaceRig.names.forEach((nm, i) => this.index.set(nm, i));
    // jaw bone (some rigs have one): opening the mouth rotates it down
    root.traverse((o) => { if (!this.jaw && (o as THREE.Bone).isBone && /jaw/i.test(o.name) && !/jawline/i.test(o.name)) { this.jaw = part(o); o.getWorldQuaternion(this.restJaw); } });
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
      const exact: { idx: number; name: string }[] = [], alias: { idx: number; f: (g: Getter) => number; gate: (x: number) => number; blink: boolean }[] = [];
      for (const [key, idx] of Object.entries(mesh.morphTargetDictionary)) {
        const name = ARKIT_BY_NORM.get(norm(key));
        if (name) exact.push({ idx, name });
        else {
          const k = norm(key), f = ALIASES[k], blink = BLINK_ALIASES.has(k);
          if (f) alias.push({ idx, f, gate: MOUTH_ALIASES.has(k) ? gateMouth : blink ? gateBlink : (x) => x, blink });
        }
      }
      for (const e of exact) { this.morphs.push({ mesh, idx: e.idx, drive: () => this.v(e.name) }); if (e.name.startsWith('eyeBlink')) this.hasBlinkMorph = true; }
      if (!exact.length && !vrm) for (const a of alias) { // alias names only on meshes with no ARKit names, and never on VRM (it has its own expression system)
        this.morphs.push({ mesh, idx: a.idx, drive: () => a.gate(a.f((n) => this.v(n))) });
        if (a.blink) this.hasBlinkMorph = true;
      }
    });
    this.active = !!this.head || this.morphs.length > 0 || !!vrm || !!this.jaw;
  }

  get morphCount() { return this.morphs.length; }
  /** True while fresh head data is arriving; the body solver then lets this rig drive the head. */
  drivesHead(nowMs: number) { return !!this.head && this.hasMatrix && nowMs - this.tData < 250; }

  private v(name: string) {
    const k = this.index.get(this.mirror ? swapLR(name) : name);
    return k === undefined ? 0 : this.vals[k]!;
  }

  onData(names: string[] | null, blend: Float32Array | null, matrix: Float32Array | null, tMs: number) {
    if (!this.active) return;
    if (names) { FaceRig.names = names; if (this.index.size === 0) names.forEach((nm, i) => this.index.set(nm, i)); }
    const t = tMs / 1000, dt = this.lastT ? t - this.lastT : 1 / 30;
    this.lastT = t; if (dt <= 0) return;
    if (blend) for (let i = 0; i < blend.length && i < 64; i++) this.vals[i] = this.filters[i]!.filter(blend[i]!, dt);
    if (matrix) {
      this.mat.fromArray(matrix).decompose(this.pp, this.qFace, this.ss);
      // matrix axes: x right, y up, z toward the viewer = our model space. Mirror = reflect across the x = 0 plane.
      if (this.mirror) this.qFace.set(this.qFace.x, -this.qFace.y, -this.qFace.z, this.qFace.w);
      this.delta.copy(this.qFace).multiply(this.neutralInv); // rotation relative to the calibrated neutral face
      const ang = 2 * Math.acos(Math.min(1, Math.abs(this.delta.w)));
      if (ang > 1.4) { this.qa.identity().slerp(this.delta, 1.4 / ang); this.delta.copy(this.qa); } // neck/head range limit (~80 deg)
      if (this.sampling) { this.n++; if (this.n === 1) this.acc.copy(this.qFace); else this.acc.slerp(this.qFace, 1 / this.n); }
      this.hasMatrix = true; this.tData = performance.now();
    }
  }

  beginSample() { this.sampling = true; this.n = 0; this.neutral.identity(); this.neutralInv.identity(); }
  endSample() {
    this.sampling = false;
    if (this.n > 0) { this.neutral.copy(this.acc); this.neutralInv.copy(this.acc).invert(); }
  }

  private place(p: Part, world: THREE.Quaternion) {
    const par = p.bone.parent;
    if (par) { par.getWorldQuaternion(this.qc).invert(); world.premultiply(this.qc); }
    p.bone.quaternion.copy(world); p.bone.updateMatrixWorld(true);
    p.target.copy(world); p.solved = true;
  }

  /** Runs after the spine and before the arms (arms may be children of the head on some rigs). */
  solve(frameQ?: THREE.Quaternion) {
    if (!this.head) return;
    // express the head rotation in the rotated character frame (view-rotation control)
    if (frameQ) this.qd.copy(frameQ).multiply(this.delta).multiply(this.qf.copy(frameQ).invert()); else this.qd.copy(this.delta);
    if (this.neck) { this.qa.identity().slerp(this.qd, 0.4).multiply(this.restNeck); this.place(this.neck, this.qa); }
    this.qa.copy(this.qd).multiply(this.restHead); this.place(this.head, this.qa);
    const PM = 0.35, YM = 0.5; // max eye pitch / yaw (rad)
    const yaw = [this.v('eyeLookOutLeft') - this.v('eyeLookInLeft'), this.v('eyeLookInRight') - this.v('eyeLookOutRight')];
    const pitch = [this.v('eyeLookDownLeft') - this.v('eyeLookUpLeft'), this.v('eyeLookDownRight') - this.v('eyeLookUpRight')];
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i]; if (!eye) continue;
      this.qb.setFromEuler(this.eul.set(pitch[i]! * PM, yaw[i]! * YM, 0, 'YXZ'));
      // eyeWorld = headDelta * gaze * restWorld : the gaze rides on top of the head turn
      this.qa.copy(this.qd).multiply(this.qb).multiply(this.restEye[i]!);
      this.place(eye, this.qa);
    }
    if (this.jaw) { // mouth open: rotate the jaw bone about the character's left-right axis (front goes down)
      this.qb.setFromAxisAngle(this.jawAxis, gateMouth(this.v('jawOpen')) * 0.5);
      this.qa.copy(this.qd).multiply(this.qb).multiply(this.restJaw); this.place(this.jaw, this.qa);
    }
  }

  /** Every render frame: slerp bones, ease morph targets, squash eye bones for blinks (when the model has no blink morph). */
  update(k: number, dt = 0) {
    if (!this.active) return;
    for (const p of [this.head, this.neck, this.eyes[0], this.eyes[1], this.jaw]) {
      if (p?.solved) { p.shown.slerp(p.target, k); p.bone.quaternion.copy(p.shown); }
    }
    for (const m of this.morphs) {
      const inf = m.mesh.morphTargetInfluences!, cur = inf[m.idx]!;
      inf[m.idx] = cur + (m.drive() - cur) * k;
    }
    if (!this.hasBlinkMorph) {
      const b = [gateBlink(this.v('eyeBlinkLeft')), gateBlink(this.v('eyeBlinkRight'))];
      for (let i = 0; i < 2; i++) {
        const eye = this.eyes[i]?.bone; if (!eye) continue;
        this.shownBlink[i] = this.shownBlink[i]! + (b[i]! - this.shownBlink[i]!) * k;
        const a = this.blinkAxis[i]!;
        eye.scale.copy(this.baseScale[i]!);
        eye.scale.setComponent(a, this.baseScale[i]!.getComponent(a) * (1 - 0.9 * this.shownBlink[i]!));
      }
    }
    if (this.vrm?.expressionManager) { // VRM expression presets driven from the ARKit blendshapes
      const e = this.vrm.expressionManager, v = (n: string) => this.v(n), g = (a: string, b: string) => (v(a) + v(b)) / 2;
      e.setValue('blinkLeft', gateBlink(v('eyeBlinkLeft'))); e.setValue('blinkRight', gateBlink(v('eyeBlinkRight')));
      e.setValue('aa', gateMouth(v('jawOpen'))); e.setValue('ou', v('mouthPucker')); e.setValue('oh', v('mouthFunnel'));
      e.setValue('ih', g('mouthStretchLeft', 'mouthStretchRight'));
      e.setValue('ee', g('mouthSmileLeft', 'mouthSmileRight') / 4);
      e.setValue('happy', gateExpr(g('mouthSmileLeft', 'mouthSmileRight'), 0.2));
      e.setValue('sad', gateExpr(g('mouthFrownLeft', 'mouthFrownRight')));
      e.setValue('angry', gateExpr(g('browDownLeft', 'browDownRight'), 0.4));
      e.setValue('surprised', gateExpr(Math.min(g('eyeWideLeft', 'eyeWideRight'), v('browInnerUp') + 0.3), 0.5));
    }
    if (this.vrm && dt > 0) this.vrm.update(dt); // spring bones, expressions
  }
}
