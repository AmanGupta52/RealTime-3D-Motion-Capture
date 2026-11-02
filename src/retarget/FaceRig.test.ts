import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { createDefaultHumanoid } from './DefaultHumanoid';

describe('FaceRig via Retargeter', () => {
  it('turns the head by the facial transformation matrix', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0;
    const m = new THREE.Matrix4().makeRotationY(0.5);
    rt.onFace(null, null, Float32Array.from(m.toArray()), 0);
    rt.onFace(null, null, Float32Array.from(m.toArray()), 33);
    rt.onPose(new Float32Array(33 * 4), 66); // zero visibility: body stays, face drives the head
    rt.update(10); root.updateMatrixWorld(true);
    const fwd = root.getObjectByName('Head')!.getWorldDirection(new THREE.Vector3());
    expect(fwd.x).toBeCloseTo(Math.sin(0.5), 2);
    expect(fwd.z).toBeCloseTo(Math.cos(0.5), 2);
  });
  it('mirrors head yaw', () => {
    const root = createDefaultHumanoid(), rt = new Retargeter(root); rt.smoothing = 0; rt.mirror = true;
    const m = Float32Array.from(new THREE.Matrix4().makeRotationY(0.5).toArray());
    rt.onFace(null, null, m, 0); rt.onFace(null, null, m, 33);
    rt.onPose(new Float32Array(33 * 4), 66); rt.update(10); root.updateMatrixWorld(true);
    expect(root.getObjectByName('Head')!.getWorldDirection(new THREE.Vector3()).x).toBeCloseTo(-Math.sin(0.5), 2);
  });
});
