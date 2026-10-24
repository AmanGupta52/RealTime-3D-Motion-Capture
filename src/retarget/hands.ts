import * as THREE from 'three';
import type { HandObs } from '../tracking/types';
import { frameQ, findBone, driveBone } from '../utils/frame';

const FINGERS = [['Thumb', 1], ['Index', 5], ['Middle', 9], ['Ring', 13], ['Pinky', 17]] as const;
const MAX_BEND = [1.6, 1.9, 1.3]; // MCP, PIP, DIP human limits (rad)
interface Fing { bone: THREE.Object3D; restLocal: THREE.Quaternion; seq: number[]; n: number }
interface Hand { side: 'Left' | 'Right'; bone: THREE.Object3D; restWorldQ: THREE.Quaternion; restFrameInv: THREE.Quaternion; fingers: Fing[] }

/** Wrist orientation from the palm frame (wrist->middle MCP, index->pinky MCP) + finger curl from joint angles. */
export class HandSolver {
  fingerAxis = new THREE.Vector3(0, 0, 1); flip = false; // Mixamo curls about local Z; flip if fingers bend backwards
  private hands: Hand[] = [];
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3(); private d = new THREE.Vector3();
  private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion();

  bind(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true); this.hands = [];
    const p = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    for (const side of ['Left', 'Right'] as const) {
      const bone = findBone(root, side + 'Hand'), mid = findBone(root, side + 'HandMiddle1');
      const idx = findBone(root, side + 'HandIndex1'), pnk = findBone(root, side + 'HandPinky1');
      if (!bone || !mid || !idx || !pnk) continue;
      const dir = p(mid).sub(p(bone)), sd = p(pnk).sub(p(idx));
      const fingers: Fing[] = [];
      for (const [name, base] of FINGERS) for (let n = 1; n <= 3; n++) {
        const fb = findBone(root, `${side}Hand${name}${n}`); if (!fb) continue;
        fingers.push({ bone: fb, restLocal: fb.quaternion.clone(), seq: [0, base, base + 1, base + 2, base + 3], n });
      }
      this.hands.push({ side, bone, fingers, restWorldQ: bone.getWorldQuaternion(new THREE.Quaternion()),
        restFrameInv: frameQ(dir, sd, new THREE.Quaternion()).invert() });
    }
  }

  /** wrists: normalized image coords of pose wrists 15/16, used to match each detected hand to a body side (avoids handedness-label mirroring bugs). */
  apply(obs: HandObs[], wrists: { x: number; y: number }[], mirror: boolean, smoothing: number, dt = 1 / 60) {
    const k = 1 - Math.pow(smoothing * 0.9, Math.max(dt, 1e-3) * 60), sx = mirror ? -1 : 1;
    for (const h of this.hands) {
      const w = wrists[(h.side === 'Left') !== mirror ? 0 : 1]; if (!w) continue; // [0]=pose 15 (user left), [1]=16
      let best: HandObs | null = null, bd = 0.2;
      for (const o of obs) { const dd = Math.hypot(o.img.x - w.x, o.img.y - w.y); if (dd < bd) { bd = dd; best = o; } }
      if (!best) continue;
      const L = best.w, pt = (i: number, o: THREE.Vector3) => o.set(sx * L[i].x, -L[i].y, -L[i].z);
      pt(9, this.a).sub(pt(0, this.b));               // palm direction
      pt(17, this.c).sub(pt(5, this.d));              // palm side (index->pinky)
      this.q.copy(frameQ(this.a, this.c, this.q2)).multiply(h.restFrameInv).multiply(h.restWorldQ);
      driveBone(h.bone, this.q, k);
      for (const f of h.fingers) {
        const P = f.seq, n = f.n; // bend at joint n between segments (P[n-1]->P[n]) and (P[n]->P[n+1])
        pt(P[n], this.a).sub(pt(P[n - 1], this.b)); pt(P[n + 1], this.c).sub(pt(P[n], this.d));
        const bend = Math.min(this.a.angleTo(this.c), MAX_BEND[n - 1]);
        this.q.setFromAxisAngle(this.fingerAxis, (this.flip ? -1 : 1) * bend);
        this.q2.copy(f.restLocal).multiply(this.q); f.bone.quaternion.slerp(this.q2, Math.min(1, k * 1.3));
      }
      h.bone.updateWorldMatrix(false, true);
    }
  }
}
