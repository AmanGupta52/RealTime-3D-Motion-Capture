import * as THREE from 'three';

/** Built-in rigged humanoid (T-pose, faces +Z, left = +X, ~1.7 m). A real Bone hierarchy with rigid armor parts. */
export function createDefaultHumanoid(): THREE.Group {
  const root = new THREE.Group(); root.name = 'DefaultHumanoid';
  const red = new THREE.MeshStandardMaterial({ color: 0xb3202a, metalness: 0.85, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a437, metalness: 0.9, roughness: 0.25 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x66ddff, emissive: 0x66ddff, emissiveIntensity: 3 });

  const bone = (name: string, parent: THREE.Object3D, x: number, y: number) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, 0); parent.add(b); return b;
  };
  /** Capsule from `b` to its child so the limb visibly follows the bone. */
  const limb = (b: THREE.Bone, child: THREE.Bone, r: number, m: THREE.Material = red) => {
    const v = child.position, len = v.length();
    const g = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(len - 2 * r, 0.001), 4, 12), m);
    g.position.copy(v).multiplyScalar(0.5);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    b.add(g);
  };
  const ball = (b: THREE.Object3D, r: number, y: number, z: number, m: THREE.Material) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m); s.position.set(0, y, z); b.add(s);
  };

  // [name, x, z, segment lengths] in hand-local space; fingers extend along the arm direction
  const FS: [string, number, number, number[]][] = [
    ['Index', 0.05, 0.03, [0.035, 0.022, 0.018]], ['Middle', 0.06, 0.01, [0.04, 0.025, 0.02]],
    ['Ring', 0.055, -0.01, [0.036, 0.023, 0.019]], ['Pinky', 0.045, -0.03, [0.028, 0.018, 0.016]],
  ];
  const addFingers = (hand: THREE.Bone, side: string, s: number) => {
    for (const [name, x, z, L] of FS) {
      const bs: THREE.Bone[] = [];
      L.forEach((_, k) => {
        const b = bone(`${side}${name}${k + 1}`, bs[k - 1] ?? hand, k === 0 ? s * x : s * L[k - 1]!, 0);
        if (k === 0) b.position.z = z;
        bs.push(b);
      });
      const tip = new THREE.Bone(); tip.position.set(s * L[2]!, 0, 0);
      bs.forEach((b, k) => limb(b, bs[k + 1] ?? tip, 0.01, gold));
    }
    const ts: THREE.Bone[] = [];
    [0, 1, 2].forEach((k) => {
      const b = bone(`${side}Thumb${k + 1}`, ts[k - 1] ?? hand, 0, 0);
      b.position.set(k === 0 ? s * 0.02 : s * 0.012, 0, k === 0 ? 0.035 : 0.022); ts.push(b);
    });
    const tt = new THREE.Bone(); tt.position.set(s * 0.012, 0, 0.022);
    ts.forEach((b, k) => limb(b, ts[k + 1] ?? tt, 0.011, gold));
  };

  const hips = bone('Hips', root, 0, 0.89);
  const spine = bone('Spine', hips, 0, 0.1);
  const chest = bone('Chest', spine, 0, 0.2);
  const neck = bone('Neck', chest, 0, 0.25);
  const head = bone('Head', neck, 0, 0.08);
  limb(hips, spine, 0.12); limb(spine, chest, 0.13); limb(chest, neck, 0.14); limb(neck, head, 0.05, gold);
  ball(head, 0.11, 0.1, 0, gold);
  ball(chest, 0.035, 0.1, 0.12, glow); // arc reactor

  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) {
    const sh = bone(`${side}Shoulder`, chest, s * 0.04, 0.2);
    const ua = bone(`${side}UpperArm`, sh, s * 0.14, 0);
    const fa = bone(`${side}LowerArm`, ua, s * 0.29, 0);
    const hand = bone(`${side}Hand`, fa, s * 0.26, 0);
    limb(sh, ua, 0.05, gold); limb(ua, fa, 0.05); limb(fa, hand, 0.04, gold); ball(hand, 0.05, 0, 0, gold); addFingers(hand, side, s);

    const ul = bone(`${side}UpperLeg`, hips, s * 0.09, -0.05);
    const ll = bone(`${side}LowerLeg`, ul, 0, -0.42);
    const foot = bone(`${side}Foot`, ll, 0, -0.42);
    limb(ul, ll, 0.075); limb(ll, foot, 0.06, gold);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.22), red); f.position.set(0, -0.02, 0.06); foot.add(f);
  }
  return root;
}
