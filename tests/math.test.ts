import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OneEuro } from '../src/utils/oneEuro';
import { Retargeter } from '../src/retarget/solver';
import type { P3 } from '../src/tracking/types';

const blank = (): P3[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 1 }));

function armRig() { // T-pose: LeftArm -> LeftForeArm -> LeftHand along +x (1 unit each)
  const root = new THREE.Group(); const mk = (n: string, x: number, parent: THREE.Object3D) => {
    const b = new THREE.Bone(); b.name = n; b.position.set(x, 0, 0); parent.add(b); return b; };
  const arm = mk('mixamorigLeftArm', 0, root), fore = mk('mixamorigLeftForeArm', 1, arm), hand = mk('mixamorigLeftHand', 1, fore);
  return { root, arm, fore, hand };
}
const dirOf = (a: THREE.Object3D, b: THREE.Object3D) => {
  const p = a.getWorldPosition(new THREE.Vector3()), q = b.getWorldPosition(new THREE.Vector3()); return q.sub(p).normalize(); };

describe('OneEuro', () => {
  it('holds a constant signal', () => { const f = new OneEuro(); let v = 0; for (let i = 0; i < 30; i++) v = f.filter(2, i / 30); expect(v).toBeCloseTo(2, 5); });
  it('converges to a step and lags less when moving fast', () => {
    const f = new OneEuro(1, 0.05); let v = 0; for (let i = 0; i < 90; i++) v = f.filter(i < 10 ? 0 : 1, i / 30);
    expect(v).toBeGreaterThan(0.99);
  });
});

describe('Retargeter limbs', () => {
  it('arm pointing down in the image drives the left arm down (no mirror)', () => {
    const { root, arm, fore } = armRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.bind(root);
    const lm = blank(); lm[11] = { x: 0, y: 0, z: 0, v: 1 }; lm[13] = { x: 0, y: 0.3, z: 0, v: 1 }; lm[15] = { x: 0, y: 0.6, z: 0, v: 1 };
    for (let i = 0; i < 20; i++) rt.apply(lm);
    expect(dirOf(arm, fore).distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-3);
  });
  it('mirror: user right arm raised drives the character left arm up', () => {
    const { root, arm, fore } = armRig(); const rt = new Retargeter(); rt.mirror = true; rt.smoothing = 0; rt.bind(root);
    const lm = blank(); lm[12] = { x: 0, y: 0, z: 0, v: 1 }; lm[14] = { x: 0, y: -0.3, z: 0, v: 1 }; lm[16] = { x: 0, y: -0.6, z: 0, v: 1 };
    for (let i = 0; i < 20; i++) rt.apply(lm);
    expect(dirOf(arm, fore).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-3);
  });
  it('mirror: user right arm out to their right becomes character left arm toward +x (screen right)', () => {
    const { root, arm, fore } = armRig(); const rt = new Retargeter(); rt.mirror = true; rt.smoothing = 0; rt.bind(root);
    const lm = blank(); lm[12] = { x: 0, y: 0, z: 0, v: 1 }; lm[14] = { x: -0.3, y: 0, z: 0, v: 1 }; lm[16] = { x: -0.6, y: 0, z: 0, v: 1 };
    for (let i = 0; i < 20; i++) rt.apply(lm);
    expect(dirOf(arm, fore).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-3);
  });
  it('low-visibility landmarks are ignored', () => {
    const { root, arm, fore } = armRig(); const rt = new Retargeter(); rt.mirror = false; rt.bind(root);
    const lm = blank(); lm[11].v = 0.1; lm[13] = { x: 0, y: 0.3, z: 0, v: 1 };
    rt.apply(lm); expect(dirOf(arm, fore).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6);
  });
});
