import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { OneEuroFilter } from '../utils/OneEuroFilter';
import { autoMap, normName, type BoneKey } from './boneMap';
import { HandRig } from './HandRig';
import { FaceRig } from './FaceRig';
import { fabrik } from './IK';

const N = 33; // MediaPipe pose landmarks
const CORE = new Set<string>(['hips', 'spine', 'head', 'lUpperArm', 'rUpperArm']); // only these are reported when missing
// Top-down solve order (parents first).
const ORDER = ['hips', 'spine', 'head', 'lUpperArm', 'lForeArm', 'rUpperArm', 'rForeArm',
  'lUpperLeg', 'lLowerLeg', 'rUpperLeg', 'rLowerLeg', 'lFoot', 'rFoot'] as const;
type SolveKey = (typeof ORDER)[number];
const LEG_KEYS = new Set<string>(['lUpperLeg', 'lLowerLeg', 'rUpperLeg', 'rLowerLeg', 'lFoot', 'rFoot']);
const ARM_KEYS = new Set<string>(['lUpperArm', 'lForeArm', 'rUpperArm', 'rForeArm']);
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1), BACK = new THREE.Vector3(0, 0, -1); // model front is +Z
export type Mode = 'full' | 'upper' | 'hands' | 'face';

/** A two-bone limb (arm or leg) solved with IK. a,b,c = landmark ids of root joint, middle joint, end. */
interface Limb {
  up: SolveKey; lo: SolveKey; end: BoneKey; a: number; b: number; c: number; leg: boolean; side: 'l' | 'r';
  ok: boolean; upDir: THREE.Vector3; lock: { active: boolean; x: number; z: number };
}
const mkLimbs = (): Limb[] => [
  { up: 'lUpperArm', lo: 'lForeArm', end: 'lHand', a: 11, b: 13, c: 15, leg: false, side: 'l' },
  { up: 'rUpperArm', lo: 'rForeArm', end: 'rHand', a: 12, b: 14, c: 16, leg: false, side: 'r' },
  { up: 'lUpperLeg', lo: 'lLowerLeg', end: 'lFoot', a: 23, b: 25, c: 27, leg: true, side: 'l' },
  { up: 'rUpperLeg', lo: 'rLowerLeg', end: 'rFoot', a: 24, b: 26, c: 28, leg: true, side: 'r' },
].map((l) => ({ ...l, ok: false, upDir: new THREE.Vector3(), lock: { active: false, x: 0, z: 0 } }) as Limb);

interface Chain {
  key: SolveKey; bone: THREE.Object3D; limb?: Limb; role?: 'up' | 'lo';
  restQ: THREE.Quaternion;   // bone world rotation in the model's rest pose
  restDir: THREE.Vector3;    // world direction the bone "points" in the rest pose
  bias: THREE.Quaternion;    // calibration: maps the user's neutral direction onto restDir
  sum: THREE.Vector3;        // calibration accumulator
  target: THREE.Quaternion;  // latest solved local rotation (tracking rate)
  shown: THREE.Quaternion;   // interpolated local rotation (render rate)
  solved: boolean;
}

/**
 * Direction-based retargeting. For each bone we measure where the user's limb points (landmark A -> B, in model space)
 * and rotate the bone from its rest direction to that direction:
 *   worldQ = fromUnitVectors(restDir, targetDir) * restWorldQ ;  localQ = inverse(parentWorldQ) * worldQ
 * Aiming is absolute, so errors never accumulate down the chain. Limbs use FABRIK IK so hands and feet land correctly on
 * characters with different proportions; elbows/knees/spine have joint limits; feet are locked (XZ) while planted.
 */
export class Retargeter {
  mirror = false;
  smoothing = 0.5;      // 0 = responsive, 1 = very smooth
  sensitivity = 1;      // amplitude of limb motion around the rest pose
  mode: Mode = 'full';
  ik = true; legs = true; rootMotion = false;
  readonly frameQ = new THREE.Quaternion(); // rotation of the character holder (view rotation control)
  readonly missing: string[] = [];
  private chains: Chain[] = []; private limbs = mkLimbs();
  private rigs: HandRig[] = []; private face: FaceRig;
  private armSpan = { l: false, r: false }; // single-bone arms (creatures) follow shoulder->wrist
  private filters: OneEuroFilter[] = []; private keyFilters = Array.from({ length: 8 }, () => new OneEuroFilter(2, 0.5));
  private sm = new Float32Array(N * 3); private vis = new Float32Array(N); private keySm = new Float32Array(8); private hasKey = false;
  private lastT = 0; private sampling = false;
  private neutral = new THREE.Vector3(); private neutralSet = false;
  private restHipsLocal = new THREE.Vector3(); private rootMoved = false;
  private ikU = new THREE.Vector3(); private ikL = new THREE.Vector3(); private j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private tgt = new THREE.Vector3(); private dv = new THREE.Vector3(); private tmp = new THREE.Vector3();
  private va = new THREE.Vector3(); private vb = new THREE.Vector3(); private vc = new THREE.Vector3();
  private vd = new THREE.Vector3(); private ve = new THREE.Vector3(); private d = new THREE.Vector3();
  private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();
  private hv = new THREE.Vector3(); private ex = new THREE.Vector3(1, 0, 0);

  constructor(private root: THREE.Object3D, override: Partial<Record<BoneKey, THREE.Object3D>> = {}, vrm?: VRM) {
    for (let i = 0; i < N * 3; i++) this.filters.push(new OneEuroFilter(1, 1.5));
    root.updateMatrixWorld(true);
    const m = { ...autoMap(root), ...override };
    const dirTo = (a: THREE.Object3D | undefined, b: THREE.Object3D | undefined, fb: THREE.Vector3) =>
      a && b ? b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize() : fb;
    const X = (s: number) => new THREE.Vector3(s, 0, 0);
    const down = () => new THREE.Vector3(0, -1, 0), fwd = () => new THREE.Vector3(0, 0, 1);
    // creature rigs: the tip of a limb is a sibling control bone named e.g. 'Arm-Ctrl-L' for 'Arm-L'
    const bones = new Map<string, THREE.Object3D>();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(normName(o.name), o); });
    const tipOf = (b?: THREE.Object3D) => (b ? bones.get(normName(b.name).replace(/([lr])$/, 'ctrl$1')) : undefined);
    const footDir = (f?: THREE.Object3D) => { const t = f?.children.find((c) => (c as THREE.Bone).isBone); return f && t ? dirTo(f, t, fwd()) : fwd(); };
    const rest: Record<SolveKey, THREE.Vector3> = {
      hips: dirTo(m.lUpperLeg, m.rUpperLeg, X(-1)),
      spine: dirTo(m.spine, m.neck, UP.clone()),
      head: m.lEye && m.rEye ? dirTo(m.lEye, m.rEye, X(-1)) : X(-1), // left -> right eye at rest (model left = +X)
      lUpperArm: dirTo(m.lUpperArm, m.lForeArm ?? tipOf(m.lUpperArm), X(1)), lForeArm: dirTo(m.lForeArm, m.lHand, X(1)),
      rUpperArm: dirTo(m.rUpperArm, m.rForeArm ?? tipOf(m.rUpperArm), X(-1)), rForeArm: dirTo(m.rForeArm, m.rHand, X(-1)),
      lUpperLeg: dirTo(m.lUpperLeg, m.lLowerLeg, down()), lLowerLeg: dirTo(m.lLowerLeg, m.lFoot, down()),
      rUpperLeg: dirTo(m.rUpperLeg, m.rLowerLeg, down()), rLowerLeg: dirTo(m.rLowerLeg, m.rFoot, down()),
      lFoot: footDir(m.lFoot), rFoot: footDir(m.rFoot),
    };
    const limbOf = (k: SolveKey) => this.limbs.find((l) => l.up === k || l.lo === k);
    for (const key of ORDER) {
      const bone = m[key];
      if (!bone) { if (CORE.has(key)) this.missing.push(key); continue; }
      const limb = limbOf(key);
      this.chains.push({
        key, bone, limb, role: limb ? (limb.up === key ? 'up' : 'lo') : undefined,
        restQ: bone.getWorldQuaternion(new THREE.Quaternion()), restDir: rest[key],
        bias: new THREE.Quaternion(), sum: new THREE.Vector3(),
        target: bone.quaternion.clone(), shown: bone.quaternion.clone(), solved: false,
      });
    }
    for (const s of ['l', 'r'] as const) {
      const rig = new HandRig(s, m); this.rigs.push(rig);
      if (!rig.active && (s === 'l' ? m.lHand : m.rHand)) this.missing.push(`${s}Hand+fingers`);
    }
    this.face = new FaceRig(root, m, vrm);
    this.armSpan = { l: !m.lForeArm, r: !m.rForeArm };
    const hips = this.hipsBone; if (hips) this.restHipsLocal.copy(hips.position);
    this.endBones = { lHand: m.lHand, rHand: m.rHand, lFoot: m.lFoot, rFoot: m.rFoot };
    this.shoulderBones = [m.lUpperArm, m.rUpperArm];
  }
  private endBones: Partial<Record<BoneKey, THREE.Object3D>>; private shoulderBones: (THREE.Object3D | undefined)[];

  get morphCount() { return this.face.morphCount; }
  get hipsBone() { return this.chains.find((c) => c.key === 'hips')?.bone; }

  // ---- landmark access: MediaPipe world (x right, y down, z toward camera = negative) -> model (x left, y up, z front)
  private idx(i: number) { return this.mirror && i >= 7 ? (i % 2 ? i + 1 : i - 1) : i; } // swap left/right when mirrored
  private pos(i: number, out: THREE.Vector3) {
    const k = this.idx(i) * 3, s = this.mirror ? -1 : 1;
    return out.set(s * this.sm[k]!, -this.sm[k + 1]!, -this.sm[k + 2]!).applyQuaternion(this.frameQ);
  }
  private ok(a: number, b: number) { return (this.vis[this.idx(a)] ?? 0) > 0.5 && (this.vis[this.idx(b)] ?? 0) > 0.5; }
  private seg(a: number, b: number, out: THREE.Vector3) {
    if (!this.ok(a, b)) return false;
    out.subVectors(this.pos(b, this.va), this.pos(a, this.vb)); return true;
  }

  private dir(key: SolveKey, out: THREE.Vector3): boolean {
    switch (key) {
      case 'hips': return this.seg(23, 24, out);
      case 'head': return this.seg(7, 8, out);
      case 'lUpperArm': return this.armSpan.l ? this.seg(11, 15, out) : this.seg(11, 13, out);
      case 'lForeArm': return this.seg(13, 15, out);
      case 'rUpperArm': return this.armSpan.r ? this.seg(12, 16, out) : this.seg(12, 14, out);
      case 'rForeArm': return this.seg(14, 16, out);
      case 'lUpperLeg': return this.seg(23, 25, out);
      case 'lLowerLeg': return this.seg(25, 27, out);
      case 'rUpperLeg': return this.seg(24, 26, out);
      case 'rLowerLeg': return this.seg(26, 28, out);
      case 'lFoot': return this.seg(29, 31, out); // heel -> toe
      case 'rFoot': return this.seg(30, 32, out);
      case 'spine': {
        if (!this.ok(11, 12) || !this.ok(23, 24)) return false;
        this.pos(11, this.va).add(this.pos(12, this.vb)).multiplyScalar(0.5);
        this.pos(23, this.vb).add(this.pos(24, this.vc)).multiplyScalar(0.5);
        out.subVectors(this.va, this.vb); return true;
      }
    }
  }

  private minCutoff() { return 8 * Math.pow(0.3 / 8, this.smoothing); } // 8 Hz (raw) ... 0.3 Hz (heavy)

  /** Call at tracking rate with MediaPipe world landmarks (33 x [x,y,z,visibility]), a timestamp (ms) and the 8 image-space key values. */
  onPose(world: Float32Array | null, tMs: number, key: Float32Array | null = null) {
    if (!world) return;
    const t = tMs / 1000, dt = this.lastT ? t - this.lastT : 1 / 30;
    this.lastT = t; if (dt <= 0) return;
    const minC = this.minCutoff();
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 3; c++) {
        const f = this.filters[i * 3 + c]!; f.minCutoff = minC;
        this.sm[i * 3 + c] = f.filter(world[i * 4 + c]!, dt);
      }
      this.vis[i] = world[i * 4 + 3]!;
    }
    if (key) { for (let i = 0; i < 8; i++) this.keySm[i] = this.keyFilters[i]!.filter(key[i]!, dt); this.hasKey = true; }
    this.solve();
  }

  /** Per-hand world landmarks (21 x [x,y,z]); cached and applied in the next solve. */
  onHands(left: Float32Array | null, right: Float32Array | null, tMs: number) {
    const [l, r] = this.mirror ? [right, left] : [left, right]; // mirrored: your right hand drives the character's left
    this.rigs[0]!.setData(l, tMs / 1000, this.minCutoff());
    this.rigs[1]!.setData(r, tMs / 1000, this.minCutoff());
  }

  /** 52 blendshape scores, their names (first frame only) and the 4x4 head transform. */
  onFace(names: string[] | null, blend: Float32Array | null, matrix: Float32Array | null, tMs: number) {
    this.face.mirror = this.mirror;
    this.face.onData(names, blend, matrix, tMs);
  }

  private allowed(k: SolveKey) {
    switch (this.mode) {
      case 'face': return k === 'head';
      case 'hands': return ARM_KEYS.has(k);
      case 'upper': return !LEG_KEYS.has(k);
      default: return this.legs || !LEG_KEYS.has(k);
    }
  }

  /** Keeps the angle between ref and v below max (elbow/knee/spine limits). v is modified in place. */
  private limit(ref: THREE.Vector3, v: THREE.Vector3, max: number, bendTo?: THREE.Vector3) {
    const ang = Math.acos(Math.max(-1, Math.min(1, ref.dot(v))));
    if (ang <= max) return;
    this.tmp.crossVectors(ref, v);
    if (this.tmp.lengthSq() < 1e-10) {
      // FIX: a limb folded exactly back onto itself (v == -ref) has no defined bend plane, and the limit was silently skipped,
      // so the elbow/knee bent a full 180 deg. Pick the anatomical bend direction (forearm forward, shin backward) instead.
      if (bendTo) { this.hv.copy(bendTo).applyQuaternion(this.frameQ); this.tmp.crossVectors(ref, this.hv); }
      if (this.tmp.lengthSq() < 1e-10) { this.tmp.crossVectors(ref, Math.abs(ref.x) < 0.9 ? this.ex : UP); }
      if (this.tmp.lengthSq() < 1e-10) return;
    }
    this.qb.setFromAxisAngle(this.tmp.normalize(), max);
    v.copy(ref).applyQuaternion(this.qb);
  }

  /** FABRIK for one limb: scale the user's limb to the character's bone lengths and solve joint positions. */
  private ikLimb(L: Limb, up: Chain, lo: Chain): boolean {
    const end = this.endBones[L.end];
    if (!end || !this.ok(L.a, L.b) || !this.ok(L.b, L.c)) return false;
    up.bone.getWorldPosition(this.j[0]!); lo.bone.getWorldPosition(this.j[1]!); end.getWorldPosition(this.j[2]!);
    const l1 = this.j[0]!.distanceTo(this.j[1]!), l2 = this.j[1]!.distanceTo(this.j[2]!);
    const pa = this.pos(L.a, this.va), pb = this.pos(L.b, this.vb), pc = this.pos(L.c, this.vc);
    const plen = pa.distanceTo(pb) + pb.distanceTo(pc);
    if (l1 < 1e-6 || l2 < 1e-6 || plen < 1e-4) return false;
    const s = (l1 + l2) / plen; // character limb length / user limb length
    this.tgt.subVectors(pc, pa).multiplyScalar(s).add(this.j[0]!);
    // initial joint guess from the user's own pose keeps the bend plane (elbow / knee direction)
    this.j[1]!.subVectors(pb, pa).normalize().multiplyScalar(l1).add(this.j[0]!);
    this.j[2]!.subVectors(pc, pb).normalize().multiplyScalar(l2).add(this.j[1]!);
    if (L.leg && this.ok(27, 28)) this.footLock(L);
    fabrik(this.j, [l1, l2], this.tgt, 8);
    this.ikU.subVectors(this.j[1]!, this.j[0]!); this.ikL.subVectors(this.j[2]!, this.j[1]!);
    return true;
  }

  /** Foot locking: while a foot is planted (near the lowest ankle) its ground position stays fixed, so it cannot slide. */
  private footLock(L: Limb) {
    const ay = this.pos(27, this.vd).y, by = this.pos(28, this.ve).y;
    const planted = (L.side === 'l' ? ay : by) - Math.min(ay, by) < 0.05;
    if (!planted) { L.lock.active = false; return; }
    if (!L.lock.active) { L.lock.active = true; L.lock.x = this.tgt.x; L.lock.z = this.tgt.z; }
    else { this.tgt.x = L.lock.x; this.tgt.z = L.lock.z; }
  }

  /** Optional root motion: hips translate with the user's hips (image position + shoulder-width scale for depth). */
  private rootTranslate(hips: THREE.Object3D) {
    if (!this.rootMotion || !this.hasKey) {
      if (this.rootMoved) { hips.position.copy(this.restHipsLocal); this.rootMoved = false; }
      return;
    }
    const k = this.keySm, hx = (k[0]! + k[2]!) / 2, hy = (k[1]! + k[3]!) / 2, sw = Math.hypot(k[4]! - k[6]!, k[5]! - k[7]!);
    if (!this.neutralSet) { this.neutral.set(hx, hy, Math.max(sw, 1e-3)); this.neutralSet = true; }
    const [sa, sb] = this.shoulderBones;
    const model = sa && sb ? sa.getWorldPosition(this.va).distanceTo(sb.getWorldPosition(this.vb)) : 0.4;
    const mpu = model / this.neutral.z, s = this.mirror ? -1 : 1; // metres per image unit
    this.dv.set(s * (hx - this.neutral.x) * mpu, -(hy - this.neutral.y) * mpu, Math.max(-1.5, Math.min(1.5, (sw / this.neutral.z - 1) * 1.2)))
      .applyQuaternion(this.frameQ);
    const p = hips.parent;
    this.tmp.copy(this.restHipsLocal); if (p) p.localToWorld(this.tmp);
    this.tmp.add(this.dv); if (p) p.worldToLocal(this.tmp);
    hips.position.copy(this.tmp); hips.updateMatrixWorld(true); this.rootMoved = true;
  }

  private solve() {
    this.root.updateMatrixWorld(true);
    const now = performance.now();
    for (const l of this.limbs) l.ok = false;
    for (const c of this.chains) {
      if (!this.allowed(c.key)) continue;
      if (c.key === 'head' && this.face.drivesHead(now)) { this.face.solve(this.frameQ); continue; }
      let ok: boolean;
      const L = c.limb;
      if (L && c.role === 'up' && this.ik) {
        const lo = this.chains.find((x) => x.key === L.lo);
        L.ok = !!lo && this.ikLimb(L, c, lo);
        ok = L.ok; if (ok) this.d.copy(this.ikU); else ok = this.dir(c.key, this.d);
      } else if (L && c.role === 'lo' && L.ok) { this.d.copy(this.ikL); ok = true; }
      else ok = this.dir(c.key, this.d);
      if (!ok || this.d.lengthSq() < 1e-8) continue;
      this.d.normalize();
      if (this.sampling) c.sum.add(this.d);
      this.d.applyQuaternion(c.bias);
      if (c.key !== 'hips' && c.key !== 'spine' && c.key !== 'head') this.d.sub(c.restDir).multiplyScalar(this.sensitivity).add(c.restDir).normalize();
      if (c.key === 'spine') this.limit(UP, this.d, 1.0);                         // spine lean <= ~57 deg
      if (L && c.role === 'up') L.upDir.copy(this.d);
      if (L && c.role === 'lo') this.limit(L.upDir, this.d, 2.6, L.leg ? BACK : FRONT);                  // elbow / knee <= ~150 deg
      this.qa.setFromUnitVectors(c.restDir, this.d).multiply(c.restQ);            // desired world rotation
      const p = c.bone.parent;
      if (p) { p.getWorldQuaternion(this.qb).invert(); this.qa.premultiply(this.qb); } // -> local
      c.bone.quaternion.copy(this.qa); c.bone.updateMatrixWorld(true);            // children see the new parent pose
      c.target.copy(this.qa); c.solved = true;
      if (c.key === 'hips') this.rootTranslate(c.bone);
    }
    if (this.mode !== 'face') for (const r of this.rigs) r.solve(this.mirror, this.frameQ); // after the forearms
  }

  /** Call every render frame: slerps toward the latest target so 60+ fps rendering stays smooth at 20-30 fps tracking. */
  update(dt: number) {
    const k = 1 - Math.exp(-dt * 25);
    for (const c of this.chains) {
      if (!c.solved || !this.allowed(c.key)) continue;
      c.shown.slerp(c.target, k); c.bone.quaternion.copy(c.shown);
    }
    if (this.mode !== 'face') for (const r of this.rigs) r.update(k);
    if (this.mode !== 'hands') this.face.update(k, dt);
  }

  /** Calibration: average the user's neutral directions (T-pose for humanoids, arms down for creatures) and bias them onto the rest pose. */
  beginSample() { this.sampling = true; this.face.beginSample(); for (const c of this.chains) { c.sum.set(0, 0, 0); c.bias.identity(); } }
  endSample() {
    this.sampling = false; this.face.endSample(); this.neutralSet = false;
    for (const c of this.chains) if (c.sum.lengthSq() > 1e-6) c.bias.setFromUnitVectors(c.sum.normalize(), c.restDir);
  }
}
