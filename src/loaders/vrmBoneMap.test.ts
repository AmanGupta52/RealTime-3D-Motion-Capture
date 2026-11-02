import { describe, it, expect } from 'vitest';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { vrmBoneMap } from './loadModel';

describe('VRM bone mapping', () => {
  const valid = new Set<string>(Object.values(VRMHumanBoneName));
  const make = () => {
    const asked: string[] = [], nodes = new Map<string, THREE.Object3D>();
    const vrm = { humanoid: { getRawBoneNode: (n: string) => { asked.push(n); if (!nodes.has(n)) nodes.set(n, new THREE.Bone()); return nodes.get(n); } } };
    return { asked, out: vrmBoneMap(vrm as never) };
  };
  it('only asks for bone names that exist in the VRM standard', () => {
    const { asked } = make();
    expect(asked.filter((n) => !valid.has(n))).toEqual([]);
  });
  it('maps all five fingers on both hands (the pinky is called "Little" in VRM)', () => {
    const { out } = make();
    for (const s of ['l', 'r']) for (const F of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (const n of [1, 2, 3])
      expect(out[`${s}${F}${n}` as keyof typeof out], `${s}${F}${n}`).toBeTruthy();
  });
});
