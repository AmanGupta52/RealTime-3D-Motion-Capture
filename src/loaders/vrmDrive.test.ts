import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from '../retarget/Retargeter';
import { makeVrm } from './testVrm';
import { vrmBoneMap, prepareVrm } from './loadModel';

function armsDown() {
  const w = new Float32Array(33 * 4), set = (i: number, x: number, y: number) => w.set([x, y, 0, 1], i * 4);
  set(7, 0.08, -0.6); set(8, -0.08, -0.6); set(11, 0.2, -0.4); set(12, -0.2, -0.4); set(23, 0.1, 0); set(24, -0.1, 0);
  set(13, 0.2, -0.1); set(14, -0.2, -0.1); set(15, 0.2, 0.2); set(16, -0.2, 0.2);
  return w;
}
const dir = (root: THREE.Object3D, a: string, b: string) => {
  root.updateMatrixWorld(true); const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  root.getObjectByName(a)!.getWorldPosition(pa); root.getObjectByName(b)!.getWorldPosition(pb); return pb.sub(pa).normalize();
};

describe('VRM models are driven by tracking', () => {
  it('moves the real bones (vrm.update must not reset them to the rest pose)', async () => {
    const { vrm } = await makeVrm(); prepareVrm(vrm);
    const rt = new Retargeter(vrm.scene, vrmBoneMap(vrm), vrm); rt.smoothing = 0;
    expect(rt.missing).toEqual([]);
    rt.onPose(armsDown(), 0); rt.onPose(armsDown(), 33);
    for (let i = 0; i < 5; i++) rt.update(1 / 60 * 10); // the render loop: retargeter update + vrm.update(dt)
    expect(dir(vrm.scene, 'LeftUpperArm', 'LeftLowerArm').y).toBeLessThan(-0.95);
    expect(dir(vrm.scene, 'RightUpperArm', 'RightLowerArm').y).toBeLessThan(-0.95);
  });
  it('proves the bug: without the fix, vrm.update() resets the pose', async () => {
    const { vrm } = await makeVrm(); // autoUpdateHumanBones left at its default (true)
    const rt = new Retargeter(vrm.scene, vrmBoneMap(vrm), vrm); rt.smoothing = 0;
    rt.onPose(armsDown(), 0); rt.onPose(armsDown(), 33); rt.update(0.5);
    expect(Math.abs(dir(vrm.scene, 'LeftUpperArm', 'LeftLowerArm').y)).toBeLessThan(0.1); // still in the T-pose
  });

  it('moves the legs too', async () => {
    const { vrm } = await makeVrm(); prepareVrm(vrm);
    const rt = new Retargeter(vrm.scene, vrmBoneMap(vrm), vrm); rt.smoothing = 0;
    const w = armsDown(), set = (i: number, x: number, y: number, z = 0) => w.set([x, y, z, 1], i * 4);
    set(25, 0.1, 0.0, -0.4); set(27, 0.1, 0.4, -0.4); set(26, -0.1, 0.4); set(28, -0.1, 0.8); // left knee raised, right leg straight
    set(29, 0.1, 0.45, -0.35); set(31, 0.1, 0.45, -0.55); set(30, -0.1, 0.85, 0.05); set(32, -0.1, 0.85, -0.15);
    rt.onPose(w, 0); rt.onPose(w, 33); rt.update(0.5);
    expect(dir(vrm.scene, 'LeftUpperLeg', 'LeftLowerLeg').z).toBeGreaterThan(0.9);
    expect(dir(vrm.scene, 'RightUpperLeg', 'RightLowerLeg').y).toBeLessThan(-0.97);
  });
  it('opens the mouth and blinks through real VRM expressions', async () => {
    const { vrm, face } = await makeVrm(true); prepareVrm(vrm);
    const rt = new Retargeter(vrm.scene, vrmBoneMap(vrm), vrm); rt.smoothing = 0;
    const names = ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight'], blend = Float32Array.from([0.8, 0.9, 0.0]);
    const id = Float32Array.from(new THREE.Matrix4().identity().toArray());
    rt.onFace(names, blend, id, 0); rt.onFace(null, blend, id, 33); rt.onPose(new Float32Array(33 * 4), 66);
    rt.update(0.5);
    const inf = face!.morphTargetInfluences!;
    expect(inf[0]).toBeGreaterThan(0.95); // aa  <- jawOpen 0.8
    expect(inf[1]).toBeGreaterThan(0.95); // blinkLeft  <- eyeBlinkLeft 0.9
    expect(inf[2]).toBeLessThan(0.05);    // blinkRight stays open
  });
});
