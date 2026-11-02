import * as THREE from 'three';
import { OneEuroFilter } from '../utils/OneEuroFilter';
import { FINGERS, type BoneKey } from './boneMap';

/** Max flexion per joint (radians): [MCP/CMC, PIP/MCP, DIP/IP]. Human limits; also hides tracking spikes. */
const LIMITS: Record<(typeof FINGERS)[number], [number, number, number]> = {
  Thumb: [0.9, 1.2, 1.4], Index: [1.57, 1.9, 1.4], Middle: [1.57, 1.9, 1.4], Ring: [1.57, 1.9, 1.4], Pinky: [1.57, 1.9, 1.4],
};

interface Joint {
  bone: THREE.Object3D; restLocal: THREE.Quaternion; axis: THREE.Vector3; max: number;
  target: THREE.Quaternion; shown: THREE.Quaternion;
  a0: number; a1: number; b0: number; b1: number; // landmark pairs: incoming (a0->a1) and outgoing (b0->b1) segments
}

/**
 * One hand: wrist orientation from the palm frame (wrist->middle knuckle, index knuckle->pinky knuckle),
 * finger flexion from the angle between consecutive finger segments (clamped to human limits).
 * Assumes the model's rest pose is a T-pose with palms facing down.
 */
export class HandRig {
  active = false;
  private hasData = false; private lastT = 0; private solved = false;
  private hand!: THREE.Object3D;
  private restQ = new THREE.Quaternion(); private restInv = new THREE.Quaternion();
  private target = new THREE.Quaternion(); private shown = new THREE.Quaternion();
  private joints: Joint[] = [];
  private filters = Array.from({ length: 63 }, () => new OneEuroFilter(1, 1.5));
  private lm = new Float32Array(63);
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  private bx = new THREE.Vector3(); private by = new THREE.Vector3(); private bz = new THREE.Vector3();
  private m = new THREE.Matrix4(); private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();

  constructor(side: 'l' | 'r', map: Partial<Record<BoneKey, THREE.Object3D>>) {
    const get = (n: string) => map[`${side}${n}` as BoneKey];
    const hand = get('Hand'), mid = get('Middle1'), idx = get('Index1'), pin = get('Pinky1') ?? get('Ring1'); // FIX: a rig without a pinky still tracks
    if (!hand || !mid || !idx || !pin) return;
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    this.hand = hand;
    this.frame(wp(mid).sub(wp(hand)), wp(idx).sub(wp(pin)));
    this.restInv.setFromRotationMatrix(this.m).invert();
    hand.getWorldQuaternion(this.restQ);
    this.target.copy(hand.quaternion); this.shown.copy(hand.quaternion);

    FINGERS.forEach((F, fi) => {
      const bones = [1, 2, 3].map((n) => get(`${F}${n}`));
      const base = fi === 0 ? 1 : 4 * fi + 1; // first landmark of this finger (thumb 1..4, index 5..8, ... pinky 17..20)
      bones.forEach((bone, s) => {
        if (!bone) return;
        const next = bones[s + 1], prev = bones[s - 1];
        const fwd = next ? wp(next).sub(wp(bone)) : prev ? wp(bone).sub(wp(prev)) : null;
        if (!fwd) return;
        fwd.normalize();
        // Curl axis: rotating `fwd` about (fwd x palmDir) by +angle moves the finger toward the palm (palm faces -Y at rest).
        const palm = new THREE.Vector3(0, -1, 0); palm.addScaledVector(fwd, -fwd.dot(palm)); // down, made perpendicular to the finger
        if (palm.lengthSq() < 1e-4) palm.set(0, 0, 1);
        palm.normalize();
        const axis = fwd.clone().cross(palm).normalize().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
        this.joints.push({
          bone, restLocal: bone.quaternion.clone(), axis, max: LIMITS[F][s]!,
          target: bone.quaternion.clone(), shown: bone.quaternion.clone(),
          // FIX: the finger-base (MCP) joint was measured against wrist -> THAT finger's knuckle. Knuckles sit sideways of the
          // wrist, so an open, flat hand already read ~18 deg of flexion (fingers looked bent). Measure against the palm
          // direction (wrist -> middle knuckle) for all four fingers instead; the thumb keeps its own geometry.
          a0: s === 0 ? 0 : base + s - 1, a1: s === 0 ? (fi > 0 ? 9 : base) : base + s,
          b0: base + s, b1: base + s + 1,
        });
      });
    });
    this.active = true;
  }

  /** Orthonormal palm frame: z = forward, y = z x side, x = y x z. */
  private frame(fwd: THREE.Vector3, side: THREE.Vector3) {
    this.bz.copy(fwd).normalize();
    this.by.crossVectors(this.bz, side).normalize();
    this.bx.crossVectors(this.by, this.bz);
    this.m.makeBasis(this.bx, this.by, this.bz);
  }
  // MediaPipe (x right, y down, z toward camera negative) -> model (x left, y up, z front); mirror flips x.
  private pos(i: number, out: THREE.Vector3, s: number) {
    return out.set(s * this.lm[i * 3]!, -this.lm[i * 3 + 1]!, -this.lm[i * 3 + 2]!);
  }

  setData(raw: Float32Array | null, t: number, minCutoff: number) {
    if (!this.active || !raw) return;
    const dt = this.lastT ? t - this.lastT : 1 / 30;
    this.lastT = t; if (dt <= 0) return;
    for (let i = 0; i < 63; i++) { const f = this.filters[i]!; f.minCutoff = minCutoff; this.lm[i] = f.filter(raw[i]!, dt); }
    this.hasData = true;
  }

  /** Must run after the forearm has been solved this frame. */
  solve(mirror: boolean, frameQ?: THREE.Quaternion) {
    if (!this.active || !this.hasData) return;
    const s = mirror ? -1 : 1;
    this.pos(9, this.a, s).sub(this.pos(0, this.c, s));
    this.pos(5, this.b, s).sub(this.pos(17, this.c, s));
    if (frameQ) { this.a.applyQuaternion(frameQ); this.b.applyQuaternion(frameQ); } // character rotated by the view controls
    if (this.a.lengthSq() < 1e-8 || this.b.lengthSq() < 1e-8) return;
    this.frame(this.a, this.b);
    // world = (targetFrame * restFrame^-1) * restWorldQ, then convert to local space
    this.qa.setFromRotationMatrix(this.m).multiply(this.restInv).multiply(this.restQ);
    const par = this.hand.parent;
    if (par) { par.getWorldQuaternion(this.qb).invert(); this.qa.premultiply(this.qb); }
    this.hand.quaternion.copy(this.qa); this.hand.updateMatrixWorld(true);
    this.target.copy(this.qa); this.solved = true;

    for (const j of this.joints) {
      this.pos(j.a1, this.a, s).sub(this.pos(j.a0, this.c, s)).normalize();
      this.pos(j.b1, this.b, s).sub(this.pos(j.b0, this.c, s)).normalize();
      const theta = Math.min(Math.acos(Math.max(-1, Math.min(1, this.a.dot(this.b)))), j.max);
      j.target.copy(j.restLocal).multiply(this.qa.setFromAxisAngle(j.axis, theta));
    }
  }

  update(k: number) {
    if (!this.solved) return;
    this.shown.slerp(this.target, k); this.hand.quaternion.copy(this.shown);
    for (const j of this.joints) { j.shown.slerp(j.target, k); j.bone.quaternion.copy(j.shown); }
  }
}
