import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Retargeter } from '../src/retarget/solver';
import { HandSolver } from '../src/retarget/hands';
import type { P3 } from '../src/tracking/types';

const blank = (): P3[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 1 }));
const set = (lm: P3[], i: number, x: number, y: number, z: number) => { lm[i] = { x, y, z, v: 1 }; };
/** Standing person facing camera, rotated by `yaw` about the vertical axis (raw MediaPipe coords: y down). */
function person(yaw: number): P3[] {
  const lm = blank(), c = Math.cos(yaw), s = Math.sin(yaw);
  const R = (x: number, z: number): [number, number] => [x * c + z * s, -x * s + z * c];
  const put = (i: number, x: number, y: number, z: number) => { const [rx, rz] = R(x, z); set(lm, i, rx, y, rz); };
  put(23, 0.1, 0, 0); put(24, -0.1, 0, 0); put(11, 0.2, -0.5, 0); put(12, -0.2, -0.5, 0);
  put(7, 0.08, -0.75, 0); put(8, -0.08, -0.75, 0); put(0, 0, -0.75, -0.1); // nose toward camera (z smaller)
  return lm;
}
function torsoRig() {
  const root = new THREE.Group(); const mk = (n: string, p: THREE.Object3D, y: number) => { const b = new THREE.Bone(); b.name = 'mixamorig' + n; b.position.y = y; p.add(b); return b; };
  const hips = mk('Hips', root, 1), spine = mk('Spine1', hips, 0.3), head = mk('Head', spine, 0.4); return { root, hips, spine, head };
}
const yawOf = (o: THREE.Object3D) => new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;

describe('torso + calibration', () => {
  it('facing the camera leaves the rig at rest', () => {
    const { root, hips, head } = torsoRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.bind(root);
    for (let i = 0; i < 5; i++) rt.apply(person(0));
    expect(Math.abs(yawOf(hips))).toBeLessThan(1e-3); expect(Math.abs(yawOf(head))).toBeLessThan(1e-3);
  });
  it('a 40° body turn rotates hips and head by 40° about Y', () => {
    const { root, hips, head } = torsoRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.bind(root);
    for (let i = 0; i < 20; i++) rt.apply(person(THREE.MathUtils.degToRad(40)));
    expect(Math.abs(Math.abs(yawOf(hips)) - THREE.MathUtils.degToRad(40))).toBeLessThan(0.02);
    expect(Math.abs(Math.abs(yawOf(head)) - THREE.MathUtils.degToRad(40))).toBeLessThan(0.02);
  });
  it('calibrating while turned 25° cancels that offset', () => {
    const { root, hips } = torsoRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.bind(root);
    expect(rt.calibrate(person(THREE.MathUtils.degToRad(25)))).toBe(true);
    for (let i = 0; i < 5; i++) rt.apply(person(THREE.MathUtils.degToRad(25)));
    expect(Math.abs(yawOf(hips))).toBeLessThan(1e-3);
  });
});

describe('fingers', () => {
  it('a 90° bend in the landmarks rotates the finger bone by 90°', () => {
    const root = new THREE.Group(); const mk = (n: string, p: THREE.Object3D, x: number) => { const b = new THREE.Bone(); b.name = 'mixamorig' + n; b.position.x = x; p.add(b); return b; };
    const hand = mk('LeftHand', root, 0); mk('LeftHandMiddle1', hand, 0.1); mk('LeftHandIndex1', hand, 0.1).position.z = 0.02; mk('LeftHandPinky1', hand, 0.1).position.z = -0.02;
    const idx1 = mk('LeftHandIndex1x', hand, 0.1); idx1.name = 'mixamorigLeftHandIndex1'; // keep a single Index1
    const hs = new HandSolver(); hs.bind(root);
    const w: P3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, v: 1 }));
    // wrist(0) -> index MCP(5) along +x, then PIP(6) turned 90° down: bone Index1 bend at joint n=1
    w[0] = { x: 0, y: 0, z: 0, v: 1 }; w[5] = { x: 0.1, y: 0, z: 0, v: 1 }; w[6] = { x: 0.1, y: 0.05, z: 0, v: 1 }; w[9] = { x: 0.1, y: 0, z: 0.0, v: 1 };
    w[17] = { x: 0.1, y: 0, z: -0.04, v: 1 };
    const rest = root.getObjectByName('mixamorigLeftHandIndex1')!;
    hs.apply([{ img: { x: 0.5, y: 0.5 }, w }], [{ x: 0.5, y: 0.5 }, { x: 9, y: 9 }], false, 0);
    const angle = rest.quaternion.angleTo(new THREE.Quaternion());
    expect(angle).toBeGreaterThan(1.0); expect(angle).toBeLessThanOrEqual(1.6 + 1e-3);
  });
});

import { FaceSolver } from '../src/retarget/face';
describe('face', () => {
  const yawMatrix = (deg: number) => new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(deg)).toArray();
  it('head follows the face matrix yaw; mirror reverses it', () => {
    for (const [mirror, sign] of [[false, 1], [true, -1]] as const) {
      const { root, head } = torsoRig(); const rt = new Retargeter(); rt.mirror = mirror; rt.smoothing = 0; rt.bind(root);
      rt.setFace(yawMatrix(30)); const lm = person(0); for (let i = 0; i < 5; i++) rt.apply(lm);
      expect(yawOf(head)).toBeCloseTo(sign * THREE.MathUtils.degToRad(30), 2);
    }
  });
  it('blendshapes drive morph targets, swapping sides when mirrored', () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.morphTargetDictionary = { eyeBlinkLeft: 0, eyeBlinkRight: 1, jawOpen: 2 }; mesh.morphTargetInfluences = [0, 0, 0];
    const root = new THREE.Group(); root.add(mesh); const fs = new FaceSolver(); expect(fs.bind(root)).toBe(3);
    fs.apply({ eyeBlinkLeft: 1, jawOpen: 0.5 }, true, 0);
    expect(mesh.morphTargetInfluences).toEqual([0, 1, 0.5]);
  });
});

import { solveTwoBone } from '../src/retarget/ik';
describe('two-bone IK', () => {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  it('reaches a reachable target and bends toward the pole', () => {
    const up = V(0, 0, 0), lo = V(0, 0, 0), A = V(0, 0, 0), T = V(1.2, 0, 0);
    solveTwoBone(A, T, 1, 1, V(0, 1, 0), up, lo);
    const end = A.clone().addScaledVector(up, 1).addScaledVector(lo, 1);
    expect(end.distanceTo(T)).toBeLessThan(1e-3); expect(up.y).toBeGreaterThan(0.3);
  });
  it('straightens instead of stretching when out of reach', () => {
    const up = V(0, 0, 0), lo = V(0, 0, 0);
    const d = solveTwoBone(V(0, 0, 0), V(5, 0, 0), 1, 1, V(0, 1, 0), up, lo);
    expect(d).toBeLessThanOrEqual(2); expect(up.angleTo(lo)).toBeLessThan(0.05);
  });
});

function legRig() { // hips at y=1, each leg 0.5 + 0.5 long, foot on the floor
  const root = new THREE.Group(); const mk = (n: string, p: THREE.Object3D, x: number, y: number) => { const b = new THREE.Bone(); b.name = 'mixamorig' + n; b.position.set(x, y, 0); p.add(b); return b; };
  const hips = mk('Hips', root, 0, 1); const L: Record<string, THREE.Object3D> = {};
  for (const [s, x] of [['Left', 0.1], ['Right', -0.1]] as const) { const u = mk(s + 'UpLeg', hips, x, 0), l = mk(s + 'Leg', u, 0, -0.5), f = mk(s + 'Foot', l, 0, -0.5); L[s + 'Foot'] = f; L[s + 'Leg'] = l; }
  return { root, hips, L };
}
const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const standing = (ankleX = 0.1): P3[] => { const lm = person(0);
  set(lm, 25, 0.1, 0.45, 0); set(lm, 27, ankleX, 0.9, 0); set(lm, 26, -0.1, 0.45, 0); set(lm, 28, -0.1, 0.9, 0); return lm; };

describe('legs', () => {
  it('scales a shorter tracked leg to the character: foot lands on the floor', () => {
    const { root, L } = legRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.legs = true; rt.bind(root);
    for (let i = 0; i < 10; i++) rt.apply(standing());
    expect(wp(L.LeftFoot).y).toBeLessThan(0.02); expect(wp(L.LeftFoot).x).toBeCloseTo(0.1, 1);
  });
  it('a raised knee points forward (+z for a model facing +z)', () => {
    const { root, L } = legRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.legs = true; rt.bind(root);
    const lm = standing(); set(lm, 25, 0.1, 0.1, -0.3); set(lm, 27, 0.1, 0.5, -0.1); // thigh forward, shin down
    for (let i = 0; i < 10; i++) rt.apply(lm);
    expect(wp(L.LeftLeg).z).toBeGreaterThan(0.2);
  });
  it('refuses to hyper-extend the knee backwards', () => {
    const { root, L } = legRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.legs = true; rt.bind(root);
    const lm = standing(); set(lm, 25, 0.1, 0.45, 0.3); set(lm, 27, 0.1, 0.9, 0); // knee pushed backward
    for (let i = 0; i < 10; i++) rt.apply(lm);
    const knee = wp(L.LeftLeg), foot = wp(L.LeftFoot), hip = wp(L.LeftLeg.parent!);
    expect(knee.clone().sub(hip).normalize().angleTo(foot.clone().sub(knee).normalize())).toBeLessThan(0.1);
  });
  it('foot lock pins a planted foot against small jitter; off, the foot follows', () => {
    const run = (lock: boolean) => {
      const { root, L } = legRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.legs = true; rt.footLock = lock; rt.bind(root);
      for (let i = 0; i < 5; i++) rt.apply(standing(0.1), 1 / 30);
      const x0 = wp(L.LeftFoot).x; rt.apply(standing(0.12), 1 / 30); return Math.abs(wp(L.LeftFoot).x - x0);
    };
    expect(run(true)).toBeLessThan(0.002); expect(run(false)).toBeGreaterThan(0.01);
  });
});

describe('root motion', () => {
  it('moving right in the image moves the hips right, scaled by torso size', () => {
    const { root, hips } = torsoRig(); const rt = new Retargeter(); rt.mirror = false; rt.smoothing = 0; rt.rootMotion = true; rt.bind(root);
    const im = (dx: number) => { const a = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
      a[23] = a[24] = { x: 0.5 + dx, y: 0.6 }; a[11] = a[12] = { x: 0.5 + dx, y: 0.35 }; return a; };
    rt.setImage(im(0), 1); rt.apply(person(0)); const x0 = wp(hips).x;
    rt.setImage(im(0.1), 1); rt.apply(person(0));
    expect(wp(hips).x - x0).toBeCloseTo(0.2, 1); // 0.5 m torso over 0.25 image units → 2 m per unit
  });
});
