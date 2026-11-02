import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { createDefaultHumanoid } from './DefaultHumanoid';

/** Left hand, palm down, fingers out. MediaPipe space (y down, z toward camera negative). */
function hand(fist: boolean) {
  const a = new Float32Array(63);
  const set = (i: number, x: number, y: number, z: number) => { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; };
  for (let k = 1; k <= 4; k++) set(k, 0.02 + 0.02 * k, 0, -0.03 - 0.01 * k); // thumb
  for (let f = 1; f <= 4; f++) {
    const b = 4 * f + 1, z = -0.03 + (f - 1) * 0.02, x = 0.09;
    set(b, x, 0, z);
    if (!fist) { set(b + 1, x + 0.03, 0, z); set(b + 2, x + 0.05, 0, z); set(b + 3, x + 0.07, 0, z); }
    else { set(b + 1, x, 0.03, z); set(b + 2, x - 0.02, 0.03, z); set(b + 3, x - 0.02, 0, z); } // curl toward the palm (down)
  }
  return a;
}
function run(h: Float32Array) {
  const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0;
  rt.onHands(h, null, 0); rt.onHands(h, null, 33);
  rt.onPose(new Float32Array(33 * 4), 66); rt.update(10); // zero visibility: arms stay put, hands still solve
  root.updateMatrixWorld(true);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  root.getObjectByName('LeftIndex1')!.getWorldPosition(a); root.getObjectByName('LeftIndex2')!.getWorldPosition(b);
  return b.sub(a).normalize();
}

describe('HandRig', () => {
  it('keeps fingers straight for an open hand', () => { expect(run(hand(false)).x).toBeCloseTo(1, 1); });
  it('curls fingers toward the palm for a fist, clamped at 90 degrees', () => { expect(run(hand(true)).y).toBeCloseTo(-1, 1); });
});
