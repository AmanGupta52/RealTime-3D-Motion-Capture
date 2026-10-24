import * as THREE from 'three';
import type { P3 } from '../tracking/types';
import { frameQ, findBone, driveBone } from '../utils/frame';
import { solveTwoBone } from './ik';

const MIN_VIS = 0.5;
/** Swap left/right MediaPipe indices (nose=0 stays; pairs 7/8, 11/12 … 31/32). */
export const sw = (i: number) => (i < 7 ? i : i % 2 === 1 ? i + 1 : i - 1);
const CHAINS = [
  { u: 'LeftArm', l: 'LeftForeArm', e: 'LeftHand', ids: [11, 13, 15], leg: false },
  { u: 'RightArm', l: 'RightForeArm', e: 'RightHand', ids: [12, 14, 16], leg: false },
  { u: 'LeftUpLeg', l: 'LeftLeg', e: 'LeftFoot', ids: [23, 25, 27], leg: true },
  { u: 'RightUpLeg', l: 'RightLeg', e: 'RightFoot', ids: [24, 26, 28], leg: true },
] as const;
// Joint limits (radians)
const MAX_ELBOW = 2.7, MAX_KNEE = 2.55, MAX_CHEST = 0.9, MAX_HEAD = 1.4;

type Kind = 'hips' | 'chest' | 'head';
interface Limb { bone: THREE.Object3D; restDir: THREE.Vector3; restWorldQ: THREE.Quaternion }
interface Torso { bone: THREE.Object3D; restWorldQ: THREE.Quaternion; restPos: THREE.Vector3; kind: Kind; calibInv: THREE.Quaternion }
interface Chain {
  ids: readonly number[]; leg: boolean; upper: Limb; lower: Limb; l1: number; l2: number; floorY: number; ema: number;
  locked: boolean; hasPrev: boolean; lockPos: THREE.Vector3; rawPrev: THREE.Vector3; uDir: THREE.Vector3; lDir: THREE.Vector3;
}

export class Retargeter {
  mirror = true; smoothing = 0.4; legs = false;
  arms = true; torsoOn = true; headOn = true;     // body-part modes
  ikArms = false;                                   // match hand reach to the character's proportions
  rootMotion = false; footLock = true;
  private chains: Chain[] = []; private torso: Torso[] = [];
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  private d = new THREE.Vector3(); private e = new THREE.Vector3(); private rootPos = new THREE.Vector3();
  private tgt = new THREE.Vector3(); private pole = new THREE.Vector3(); private ax = new THREE.Vector3(); private lat = new THREE.Vector3();
  private fq = new THREE.Quaternion(); private tq = new THREE.Quaternion(); private delta = new THREE.Quaternion();
  private hq = new THREE.Quaternion(); private last = new THREE.Quaternion();
  private lm: P3[] = [];
  private hasFace = false; private faceQ = new THREE.Quaternion(); private mtx = new THREE.Matrix4();
  private fp = new THREE.Vector3(); private fs = new THREE.Vector3();
  private img: { x: number; y: number }[] | null = null; private aspect = 16 / 9;
  private rootRef: { hx: number; hy: number; tu: number } | null = null; private mpu = 0; private scale = 1;

  /** Head rotation from MediaPipe's facial transformation matrix (column-major 4x4, camera space x right, y up, z toward viewer). null → fall back to pose ears/nose. */
  setFace(m: ArrayLike<number> | null) {
    this.hasFace = !!m; if (!m) return;
    this.mtx.fromArray(m as number[]).decompose(this.fp, this.faceQ, this.fs);
    if (this.mirror) { this.faceQ.y = -this.faceQ.y; this.faceQ.z = -this.faceQ.z; } // reflect x: R' = M R M
  }
  /** Normalized image landmarks + video aspect (w/h); needed only for root motion. */
  setImage(im: { x: number; y: number }[] | null, aspect: number) { this.img = im; this.aspect = aspect; }
  setMirror(v: boolean) { this.mirror = v; this.rootRef = null; for (const t of this.torso) t.calibInv.identity(); } // frames flip → recalibrate

  bind(root: THREE.Object3D): string[] {
    root.updateWorldMatrix(true, true);
    const missing: string[] = []; this.chains = []; this.torso = []; this.rootRef = null;
    const p = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const limb = (bone: THREE.Object3D, child: THREE.Object3D): Limb =>
      ({ bone, restDir: p(child).sub(p(bone)).normalize(), restWorldQ: bone.getWorldQuaternion(new THREE.Quaternion()) });
    for (const def of CHAINS) {
      const u = findBone(root, def.u), l = findBone(root, def.l), e = findBone(root, def.e);
      if (!u || !l || !e) { missing.push(def.u); continue; }
      this.chains.push({ ids: def.ids, leg: def.leg, upper: limb(u, l), lower: limb(l, e), l1: p(l).distanceTo(p(u)), l2: p(e).distanceTo(p(l)),
        floorY: p(e).y, ema: 0, locked: false, hasPrev: false, lockPos: new THREE.Vector3(), rawPrev: new THREE.Vector3(),
        uDir: new THREE.Vector3(), lDir: new THREE.Vector3() });
    }
    for (const [name, kind] of [['Hips', 'hips'], ['Spine1', 'chest'], ['Head', 'head']] as [string, Kind][]) {
      const bone = findBone(root, name); if (!bone) { missing.push(name); continue; }
      this.torso.push({ bone, kind, restPos: p(bone), restWorldQ: bone.getWorldQuaternion(new THREE.Quaternion()), calibInv: new THREE.Quaternion() });
    }
    return missing;
  }

  // MediaPipe world (x right, y down, z away) -> model (x, -y, -z); mirror reflects x and swaps sides.
  private idx(i: number) { return this.mirror ? sw(i) : i; }
  private pt(i: number, out: THREE.Vector3) { const p = this.lm[this.idx(i)]; return out.set((this.mirror ? -1 : 1) * p.x, -p.y, -p.z); }
  private vis(i: number) { return this.lm[this.idx(i)].v; }

  /** Body-part frame (lateral axis + up/forward hint) in model space. Rest frames are identity (model faces +z, +x = its left). */
  private frameFor(kind: Kind, out: THREE.Quaternion): boolean {
    if (kind === 'head') {
      if (this.hasFace) { out.copy(this.faceQ); return true; }
      if ([7, 8, 0].some(i => this.vis(i) < MIN_VIS)) return false;
      this.pt(7, this.a); this.pt(8, this.b); this.c.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.pt(0, this.d).sub(this.c);                 // forward = ear midpoint -> nose
      this.a.sub(this.b);                              // lateral = right ear -> left ear
      frameQ(this.a, this.e.crossVectors(this.d, this.a), out); return true;
    }
    if ([11, 12, 23, 24].some(i => this.vis(i) < MIN_VIS)) return false;
    this.pt(23, this.a); this.pt(24, this.b); this.c.addVectors(this.a, this.b);
    this.pt(11, this.d); this.pt(12, this.e); this.d.add(this.e).sub(this.c).multiplyScalar(0.5); // up (direction only)
    const [l, r] = kind === 'hips' ? [23, 24] : [11, 12];
    this.pt(l, this.a); this.pt(r, this.b); this.a.sub(this.b);
    frameQ(this.a, this.d, out); return true;
  }

  /** Call while the user holds a T-pose: cancels camera yaw/tilt and body offsets for torso & head, and zeroes root motion. */
  calibrate(lm: P3[]): boolean {
    this.lm = lm; let ok = true; this.rootRef = null;
    for (const t of this.torso) { if (this.frameFor(t.kind, this.fq)) t.calibInv.copy(this.fq).invert(); else ok = false; }
    return ok;
  }

  /** Hip translation from image-space landmarks (world landmarks are hip-centred, so they carry no translation). */
  private updateRoot(k: number) {
    const hips = this.torso.find(t => t.kind === 'hips'); if (!hips || !this.rootMotion || !this.img) return;
    if ([11, 12, 23, 24].some(i => this.vis(i) < MIN_VIS)) return;
    const im = this.img, hx = (im[23].x + im[24].x) / 2, hy = (im[23].y + im[24].y) / 2;
    const tu = Math.hypot(((im[11].x + im[12].x) / 2 - hx) * this.aspect, (im[11].y + im[12].y) / 2 - hy);
    if (tu < 1e-3) return;
    if (!this.rootRef) this.rootRef = { hx, hy, tu };
    this.pt(11, this.a).add(this.pt(12, this.b)).multiplyScalar(0.5); this.pt(23, this.c).add(this.pt(24, this.d)).multiplyScalar(0.5);
    const mpu = this.a.distanceTo(this.c) / tu; this.mpu = this.mpu ? this.mpu + (mpu - this.mpu) * 0.05 : mpu; // metres per image unit
    const s = this.scale, ref = this.rootRef;
    this.tgt.set((this.mirror ? -1 : 1) * (hx - ref.hx) * this.aspect * this.mpu, -(hy - ref.hy) * this.mpu, (1 - ref.tu / tu) * 2.5)
      .multiplyScalar(s).add(hips.restPos);
    const par = hips.bone.parent!; par.updateWorldMatrix(true, false); par.worldToLocal(this.tgt);
    hips.bone.position.lerp(this.tgt, k);
  }

  private clampRel(q: THREE.Quaternion, ref: THREE.Quaternion, max: number) {
    const ang = q.angleTo(ref); if (ang > max) q.copy(ref).slerp(q, max / ang);
  }

  /** dt = seconds since the previous call (used by foot locking). */
  apply(lm: P3[], dt = 1 / 30) {
    this.lm = lm; const k = 1 - Math.pow(this.smoothing * 0.9, Math.max(dt, 1e-3) * 60); // slider up = smoother; same feel at any frame rate
    const hips = this.torso.find(t => t.kind === 'hips');
    if (hips) hips.bone.getWorldQuaternion(this.hq); else this.hq.identity();
    let haveLast = false;
    if (this.torsoOn) this.updateRoot(k);
    for (const t of this.torso) {                     // top-down: hips, chest, head (with spine/neck limits)
      if (t.kind === 'head' ? !this.headOn : !this.torsoOn) continue;
      if (!this.frameFor(t.kind, this.fq)) continue;
      this.tq.copy(this.fq).multiply(t.calibInv).multiply(t.restWorldQ);
      if (haveLast && t.kind !== 'hips') this.clampRel(this.tq, this.last, t.kind === 'chest' ? MAX_CHEST : MAX_HEAD);
      this.last.copy(this.tq); haveLast = true;
      driveBone(t.bone, this.tq, k);
    }
    for (const c of this.chains) {
      if (c.leg ? !this.legs : !this.arms) continue;
      this.solveChain(c, k, dt);
    }
  }

  private solveChain(c: Chain, k: number, dt: number) {
    const [ia, ib, ic] = c.ids;
    if (this.vis(ia) < MIN_VIS || this.vis(ib) < MIN_VIS || this.vis(ic) < MIN_VIS) return; // confidence gating
    this.pt(ia, this.a); this.pt(ib, this.b); this.pt(ic, this.c);  // tracked root / mid / end in model space
    if (c.leg || this.ikArms) {
      // IK: scale the tracked root->end vector by the character/human limb-length ratio so feet & hands land correctly.
      const len = this.a.distanceTo(this.b) + this.b.distanceTo(this.c);
      c.ema = c.ema ? c.ema + (len - c.ema) * 0.05 : len;
      const sc = (c.l1 + c.l2) / c.ema; if (c.leg) this.scale = sc;
      c.upper.bone.getWorldPosition(this.rootPos);
      this.tgt.subVectors(this.c, this.a).multiplyScalar(sc).add(this.rootPos);
      if (c.leg && this.footLock) this.lockFoot(c, dt);
      this.d.subVectors(this.c, this.a).normalize();
      this.pole.subVectors(this.b, this.a); this.pole.addScaledVector(this.d, -this.pole.dot(this.d));
      if (this.pole.lengthSq() < 1e-4) this.pole.set(0, c.leg ? 0 : -1, c.leg ? 1 : 0).applyQuaternion(this.hq); // straight limb: knees forward, elbows down
      solveTwoBone(this.rootPos, this.tgt, c.l1, c.l2, this.pole, c.uDir, c.lDir);
    } else {
      c.uDir.subVectors(this.b, this.a).normalize(); c.lDir.subVectors(this.c, this.b).normalize();
    }
    // Hinge limits: max flexion, and no hyper-extension (knee must flex backwards relative to the hips' lateral axis).
    const ang = c.uDir.angleTo(c.lDir);
    if (ang > 1e-3) {
      this.ax.crossVectors(c.uDir, c.lDir).normalize();
      if (c.leg) { this.lat.set(1, 0, 0).applyQuaternion(this.hq); if (this.ax.dot(this.lat) < 0 && ang > 0.05) { c.lDir.copy(c.uDir); return this.drive(c, k); } }
      const max = c.leg ? MAX_KNEE : MAX_ELBOW;
      if (ang > max) c.lDir.copy(c.uDir).applyAxisAngle(this.ax, max);
    }
    this.drive(c, k);
  }

  private drive(c: Chain, k: number) {
    for (const [l, dir] of [[c.upper, c.uDir], [c.lower, c.lDir]] as const) {
      this.delta.setFromUnitVectors(l.restDir, dir);
      this.tq.copy(this.delta).multiply(l.restWorldQ);
      driveBone(l.bone, this.tq, k);
    }
  }

  /** Plant a foot while it is near the floor and slow; release on lift-off, fast motion, or when out of reach. */
  private lockFoot(c: Chain, dt: number) {
    const t = this.tgt; t.y = Math.max(t.y, c.floorY);
    const h = t.y - c.floorY;
    const speed = c.hasPrev ? t.distanceTo(c.rawPrev) / Math.max(dt, 1e-3) : 99;
    c.rawPrev.copy(t); c.hasPrev = true;
    if (!c.locked) { if (h < 0.06 && speed < 0.35) { c.locked = true; c.lockPos.copy(t); } return; }
    if (h > 0.09 || speed > 0.9 || this.rootPos.distanceTo(c.lockPos) > (c.l1 + c.l2) * 1.05) { c.locked = false; return; } // a straight standing leg is at full reach, so allow slack
    t.x = c.lockPos.x; t.z = c.lockPos.z;
  }
}
