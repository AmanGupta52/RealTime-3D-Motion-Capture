import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fabrik } from './IK';

describe('fabrik', () => {
  it('reaches a reachable target and preserves bone lengths', () => {
    const p = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0.1), new THREE.Vector3(2, 0, 0)];
    const t = new THREE.Vector3(1.2, 0.8, 0);
    fabrik(p, [1, 1], t);
    expect(p[2]!.distanceTo(t)).toBeLessThan(1e-3);
    expect(p[0]!.distanceTo(p[1]!)).toBeCloseTo(1, 3);
    expect(p[1]!.distanceTo(p[2]!)).toBeCloseTo(1, 3);
  });
  it('stretches toward an unreachable target', () => {
    const p = [new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0)];
    fabrik(p, [1, 1], new THREE.Vector3(0, 5, 0));
    expect(p[2]!.x).toBeCloseTo(0, 5); expect(p[2]!.y).toBeCloseTo(2, 5);
  });
});
