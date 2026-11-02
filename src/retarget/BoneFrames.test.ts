import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from './Retargeter';
import { createDefaultHumanoid } from './DefaultHumanoid';

/** Real rigs (Mixamo FBX, Blender, VRoid...) have arbitrary local bone axes. Rebuild the humanoid so every bone has a random
 *  frame while all world positions stay identical, then check the result in world space. */
function reframe(seed: number) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const root = createDefaultHumanoid(); root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = []; root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const world = new Map(bones.map((b) => [b, b.getWorldPosition(new THREE.Vector3())]));
  for (const b of bones) { // parents come before children
    const F = new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(F));
    b.parent!.updateMatrixWorld(true); b.updateMatrixWorld(true);
    b.position.copy(b.parent!.worldToLocal(world.get(b)!.clone()));
    b.updateMatrixWorld(true);
  }
  return root;
}
function pose(arms: 'down' | 'out') {
  const w = new Float32Array(33 * 4), set = (i: number, x: number, y: number, z = 0) => w.set([x, y, z, 1], i * 4);
  const dy = arms === 'down' ? 0.3 : 0, dx = arms === 'out' ? 0.3 : 0;
  set(7, 0.08, -0.6); set(8, -0.08, -0.6); set(11, 0.2, -0.4); set(12, -0.2, -0.4); set(23, 0.1, 0); set(24, -0.1, 0);
  set(13, 0.2 + dx, -0.4 + dy); set(14, -0.2 - dx, -0.4 + dy); set(15, 0.2 + 2 * dx, -0.4 + 2 * dy); set(16, -0.2 - 2 * dx, -0.4 + 2 * dy);
  set(25, 0.1, 0.4, -0.3); set(26, -0.1, 0.4); set(27, 0.1, 0.8, -0.3); set(28, -0.1, 0.8);
  return w;
}
const dir = (root: THREE.Object3D, a: string, b: string) => {
  root.updateMatrixWorld(true); const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  root.getObjectByName(a)!.getWorldPosition(pa); root.getObjectByName(b)!.getWorldPosition(pb); return pb.sub(pa).normalize();
};

describe('Retargeter with arbitrary bone axes (like real FBX / GLB / VRM files)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`arms and legs end up in the right world direction (rig #${seed})`, () => {
      const root = reframe(seed), rt = new Retargeter(root); rt.smoothing = 0;
      expect(rt.missing).toEqual([]);
      rt.onPose(pose('down'), 0); rt.onPose(pose('down'), 33); rt.update(10);
      expect(dir(root, 'LeftUpperArm', 'LeftLowerArm').y).toBeLessThan(-0.97);
      expect(dir(root, 'RightUpperArm', 'RightLowerArm').y).toBeLessThan(-0.97);
      expect(dir(root, 'LeftLowerArm', 'LeftHand').y).toBeLessThan(-0.97);
      expect(dir(root, 'LeftUpperLeg', 'LeftLowerLeg').z).toBeGreaterThan(0.2); // knee forward
      rt.onPose(pose('out'), 66); rt.onPose(pose('out'), 99); rt.update(10);
      expect(dir(root, 'LeftUpperArm', 'LeftLowerArm').x).toBeGreaterThan(0.97);
      expect(dir(root, 'RightUpperArm', 'RightLowerArm').x).toBeLessThan(-0.97);
    });
  }
});
