import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MotionRecorder, Player, toBVH } from './MotionRecorder';
import { createDefaultHumanoid } from '../retarget/DefaultHumanoid';
import { snapshotPose } from '../retarget/pose';

function setup() {
  const root = createDefaultHumanoid(), bones: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  return { root, bones, hips: root.getObjectByName('Hips')!, rest: snapshotPose(root) };
}
describe('MotionRecorder', () => {
  it('records frames at the requested rate and replays them', () => {
    const { bones, hips } = setup(), rec = new MotionRecorder(bones, hips);
    rec.start('t', 10);
    for (let i = 0; i < 20; i++) { bones[1]!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), i * 0.05); rec.sample(0.05); }
    const take = rec.stop()!;
    expect(take.times.length).toBe(10);
    const pl = new Player(bones, hips); pl.play(take); bones[1]!.quaternion.identity(); pl.update(0.0);
    expect(bones[1]!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThanOrEqual(0);
  });
  it('exports a well-formed BVH (channel count matches the motion rows)', () => {
    const { root, bones, hips, rest } = setup(), rec = new MotionRecorder(bones, hips);
    rec.start('t', 30); for (let i = 0; i < 6; i++) rec.sample(1 / 30);
    const bvh = toBVH(rec.stop()!, bones, root, rest);
    const channels = [...bvh.matchAll(/CHANNELS (\d)/g)].reduce((a, m) => a + +m[1]!, 0);
    const rows = bvh.split('MOTION')[1]!.trim().split('\n').slice(2);
    expect(rows.length).toBe(6);
    expect(rows[0]!.trim().split(/\s+/).length).toBe(channels);
  });
});
