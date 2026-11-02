import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { FaceRig } from './FaceRig';
import { createDefaultHumanoid } from './DefaultHumanoid';

const ID = Float32Array.from(new THREE.Matrix4().identity().toArray());
function withMorphs(dict: Record<string, number>) {
  const root = createDefaultHumanoid(), mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = dict; mesh.morphTargetInfluences = Object.keys(dict).map(() => 0);
  root.getObjectByName('Head')!.add(mesh); return { root, mesh };
}
/** Sends two face frames (so smoothing settles) and runs one render update. */
function feed(rt: Retargeter, names: string[] | null, blend: number[]) {
  const b = Float32Array.from(blend);
  rt.onFace(names, b, ID, 0); rt.onFace(null, b, ID, 33); rt.onPose(new Float32Array(33 * 4), 66); rt.update(10);
}
beforeEach(() => { FaceRig.names = null; });

describe('Face: mouth and eyes', () => {
  it('drives ARKit morph targets (mouth open, blink)', () => {
    const { root, mesh } = withMorphs({ jawOpen: 0, eyeBlinkLeft: 1, eyeBlinkRight: 2, mouthSmileLeft: 3 });
    feed(new Retargeter(root), ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'mouthSmileLeft'], [0.6, 0.8, 0, 0.4]);
    const i = mesh.morphTargetInfluences!;
    expect(i[0]).toBeCloseTo(0.6, 1); expect(i[1]).toBeCloseTo(0.8, 1); expect(i[2]).toBeCloseTo(0, 1); expect(i[3]).toBeCloseTo(0.4, 1);
  });
  it('drives models that name their morphs differently (mouthOpen, Blink_L)', () => {
    const { root, mesh } = withMorphs({ mouthOpen: 0, Blink_L: 1, Blink_R: 2 });
    feed(new Retargeter(root), ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight'], [0.8, 0.9, 0.05]);
    const i = mesh.morphTargetInfluences!;
    expect(i[0]).toBeGreaterThan(0.95); expect(i[1]).toBeGreaterThan(0.95); expect(i[2]).toBeLessThan(0.05);
  });
  it('does not drive the same mouth twice when a mesh already has ARKit names', () => {
    const { root, mesh } = withMorphs({ jawOpen: 0, mouthOpen: 1 });
    feed(new Retargeter(root), ['jawOpen'], [0.7]);
    expect(mesh.morphTargetInfluences![0]).toBeCloseTo(0.7, 1); expect(mesh.morphTargetInfluences![1]).toBe(0);
  });
  it('swaps left and right when mirrored', () => {
    const { root, mesh } = withMorphs({ eyeBlinkLeft: 0, eyeBlinkRight: 1 });
    const rt = new Retargeter(root); rt.mirror = true;
    feed(rt, ['eyeBlinkLeft', 'eyeBlinkRight'], [0, 1]); // the user's RIGHT eye blinks
    expect(mesh.morphTargetInfluences![0]).toBeGreaterThan(0.9); expect(mesh.morphTargetInfluences![1]).toBeLessThan(0.1);
  });
  it('keeps working after a model switch (the blendshape names are only sent once per session)', () => {
    feed(new Retargeter(createDefaultHumanoid()), ['jawOpen', 'eyeBlinkLeft'], [0.5, 0.5]); // first model receives the names
    const { root, mesh } = withMorphs({ jawOpen: 0 });                                       // user switches model: new rig, no names
    feed(new Retargeter(root), null, [0.6, 0.1]);
    expect(mesh.morphTargetInfluences![0]).toBeCloseTo(0.6, 1);
  });
  it('opens a jaw bone when the model has one', () => {
    const root = createDefaultHumanoid(), jaw = new THREE.Bone(), tip = new THREE.Bone();
    jaw.name = 'Jaw'; jaw.position.set(0, 0.05, 0); tip.name = 'JawTip'; tip.position.set(0, 0, 0.1); jaw.add(tip);
    root.getObjectByName('Head')!.add(jaw);
    feed(new Retargeter(root), ['jawOpen'], [1]);
    root.updateMatrixWorld(true);
    const d = tip.getWorldPosition(new THREE.Vector3()).sub(jaw.getWorldPosition(new THREE.Vector3())).normalize();
    expect(d.y).toBeLessThan(-0.4); // the chin dropped (it pointed straight forward before)
  });
  it('closes the eyes on models with eye bones but no morph targets', () => {
    const root = createDefaultHumanoid(), head = root.getObjectByName('Head')!;
    for (const [n, x] of [['LeftEye', 0.03], ['RightEye', -0.03]] as const) { const e = new THREE.Bone(); e.name = n; e.position.set(x, 0.08, 0.08); head.add(e); }
    feed(new Retargeter(root), ['eyeBlinkLeft', 'eyeBlinkRight'], [1, 0]);
    expect(root.getObjectByName('LeftEye')!.scale.y).toBeLessThan(0.3);  // closed
    expect(root.getObjectByName('RightEye')!.scale.y).toBeGreaterThan(0.9); // open
  });
});
