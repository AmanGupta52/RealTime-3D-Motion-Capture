import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { createDefaultHumanoid } from './DefaultHumanoid';

/** Body pose in MediaPipe world space (y down, z negative = toward the camera = the character's front). */
function body(legs: Record<number, [number, number, number]>) {
  const w = new Float32Array(33 * 4), set = (i: number, x: number, y: number, z = 0) => w.set([x, y, z, 1], i * 4);
  set(7, 0.08, -0.6); set(8, -0.08, -0.6); set(11, 0.2, -0.4); set(12, -0.2, -0.4); set(23, 0.1, 0); set(24, -0.1, 0);
  set(13, 0.2, -0.1); set(14, -0.2, -0.1); set(15, 0.2, 0.2); set(16, -0.2, 0.2);
  // standing: knees 0.4 below hips, ankles 0.8 below, heel/toe pointing forward
  const std: Record<number, [number, number, number]> = {
    25: [0.1, 0.4, 0], 26: [-0.1, 0.4, 0], 27: [0.1, 0.8, 0], 28: [-0.1, 0.8, 0],
    29: [0.1, 0.85, 0.05], 30: [-0.1, 0.85, 0.05], 31: [0.1, 0.85, -0.15], 32: [-0.1, 0.85, -0.15],
  };
  for (const [i, v] of Object.entries({ ...std, ...legs })) set(Number(i), ...(v as [number, number, number]));
  return w;
}
const dir = (root: THREE.Object3D, a: string, b: string) => {
  root.updateMatrixWorld(true); const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  root.getObjectByName(a)!.getWorldPosition(pa); root.getObjectByName(b)!.getWorldPosition(pb); return pb.sub(pa).normalize();
};
function drive(root: THREE.Object3D, p: Float32Array, ik: boolean) {
  const rt = new Retargeter(root); rt.smoothing = 0; rt.ik = ik;
  rt.onPose(p, 0); rt.onPose(p, 33); rt.update(10); return rt;
}

describe.each([true, false])('legs move (IK %s)', (ik) => {
  it('stands straight: both legs point down', () => {
    const root = createDefaultHumanoid(); drive(root, body({}), ik);
    for (const s of ['Left', 'Right']) {
      expect(dir(root, `${s}UpperLeg`, `${s}LowerLeg`).y).toBeLessThan(-0.97);
      expect(dir(root, `${s}LowerLeg`, `${s}Foot`).y).toBeLessThan(-0.97);
    }
  });
  it('raised knee: thigh forward, shin down', () => {
    const root = createDefaultHumanoid();
    drive(root, body({ 25: [0.1, 0.0, -0.4], 27: [0.1, 0.4, -0.4], 29: [0.1, 0.45, -0.35], 31: [0.1, 0.45, -0.55] }), ik);
    expect(dir(root, 'LeftUpperLeg', 'LeftLowerLeg').z).toBeGreaterThan(0.9);
    expect(dir(root, 'LeftLowerLeg', 'LeftFoot').y).toBeLessThan(-0.8);
    expect(dir(root, 'RightUpperLeg', 'RightLowerLeg').y).toBeLessThan(-0.97); // other leg unaffected
  });
  it('leg kicked back: shin points backward', () => {
    const root = createDefaultHumanoid();
    drive(root, body({ 28: [-0.1, 0.4, 0.4], 30: [-0.1, 0.4, 0.4], 32: [-0.1, 0.4, 0.25] }), ik);
    expect(dir(root, 'RightLowerLeg', 'RightFoot').z).toBeLessThan(-0.5);
  });
  it('leg stepped out sideways', () => {
    const root = createDefaultHumanoid();
    drive(root, body({ 25: [0.4, 0.3, 0], 27: [0.7, 0.55, 0] }), ik);
    expect(dir(root, 'LeftUpperLeg', 'LeftLowerLeg').x).toBeGreaterThan(0.5); // character's left = +X
  });
});
