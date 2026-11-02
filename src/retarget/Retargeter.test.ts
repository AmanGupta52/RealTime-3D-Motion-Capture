import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { createDefaultHumanoid } from './DefaultHumanoid';

/** Synthetic landmarks (MediaPipe space: y down). Arms point down or out sideways. */
function pose(arms: 'down' | 'out') {
  const w = new Float32Array(33 * 4);
  const set = (i: number, x: number, y: number) => w.set([x, y, 0, 1], i * 4);
  const dy = arms === 'down' ? 0.3 : 0, dx = arms === 'out' ? 0.3 : 0;
  set(7, 0.08, -0.6); set(8, -0.08, -0.6); set(11, 0.2, -0.4); set(12, -0.2, -0.4); set(23, 0.1, 0); set(24, -0.1, 0);
  set(13, 0.2 + dx, -0.4 + dy); set(14, -0.2 - dx, -0.4 + dy);
  set(15, 0.2 + 2 * dx, -0.4 + 2 * dy); set(16, -0.2 - 2 * dx, -0.4 + 2 * dy);
  return w;
}
function dirBetween(root: THREE.Object3D, a: string, b: string) {
  root.updateMatrixWorld(true);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  root.getObjectByName(a)!.getWorldPosition(pa); root.getObjectByName(b)!.getWorldPosition(pb);
  return pb.sub(pa).normalize();
}
function run(root: THREE.Object3D, rt: Retargeter, p: Float32Array) {
  rt.onPose(p, 0); rt.onPose(p, 33); rt.update(10);
}

describe('Retargeter', () => {
  it('finds every upper-body bone on the default humanoid', () => {
    expect(new Retargeter(createDefaultHumanoid()).missing).toEqual([]);
  });
  it('points the left upper arm down when the user lowers their arm', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0;
    run(root, rt, pose('down'));
    const d = dirBetween(root, 'LeftUpperArm', 'LeftLowerArm');
    expect(d.y).toBeCloseTo(-1, 2);
  });
  it('keeps the arms horizontal in a T-pose', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0;
    run(root, rt, pose('out'));
    expect(dirBetween(root, 'LeftUpperArm', 'LeftLowerArm').x).toBeCloseTo(1, 2);
    expect(dirBetween(root, 'RightUpperArm', 'RightLowerArm').x).toBeCloseTo(-1, 2);
  });
});

describe('Retargeter legs, modes and limits', () => {
  const legsPose = () => {
    const w = new Float32Array(33 * 4);
    const set = (i: number, x: number, y: number, z = 0) => w.set([x, y, z, 1], i * 4);
    set(11, 0.2, -0.4); set(12, -0.2, -0.4); set(23, 0.1, 0); set(24, -0.1, 0);
    set(25, 0.1, 0.4, -0.3); set(26, -0.1, 0.4); set(27, 0.1, 0.8, -0.3); set(28, -0.1, 0.8); // left knee forward, shin down
    set(29, 0.1, 0.85, -0.3); set(31, 0.1, 0.85, -0.45); set(30, -0.1, 0.85); set(32, -0.1, 0.85, -0.15);
    return w;
  };
  it('bends the left knee forward and keeps the right leg straight', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0;
    rt.onPose(legsPose(), 0); rt.onPose(legsPose(), 33); rt.update(10);
    const d = dirBetween(root, 'LeftUpperLeg', 'LeftLowerLeg');
    expect(d.z).toBeGreaterThan(0.2); // thigh points forward (+Z)
    expect(dirBetween(root, 'RightUpperLeg', 'RightLowerLeg').y).toBeLessThan(-0.95);
  });
  it('upper-body mode ignores the legs', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0; rt.mode = 'upper';
    rt.onPose(legsPose(), 0); rt.onPose(legsPose(), 33); rt.update(10);
    expect(dirBetween(root, 'LeftUpperLeg', 'LeftLowerLeg').z).toBeCloseTo(0, 2);
  });
  it('limits the elbow bend to ~150 degrees', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0; rt.ik = false;
    const w = pose('down'); w.set([0.2, -0.4 - 0.001, 0, 1], 15 * 4); // wrist folded back onto the shoulder
    rt.onPose(w, 0); rt.onPose(w, 33); rt.update(10);
    const u = dirBetween(root, 'LeftUpperArm', 'LeftLowerArm'), l = dirBetween(root, 'LeftLowerArm', 'LeftHand');
    expect(Math.acos(Math.max(-1, Math.min(1, u.dot(l))))).toBeLessThan(2.7);
  });
});
