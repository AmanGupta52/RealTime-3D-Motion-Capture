import type * as THREE from 'three';

export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
export type FingerKey = `${'l' | 'r'}${(typeof FINGERS)[number]}${1 | 2 | 3}`;
export type BoneKey = 'hips' | 'spine' | 'neck' | 'head'
  | 'lUpperArm' | 'lForeArm' | 'lHand' | 'rUpperArm' | 'rForeArm' | 'rHand'
  | 'lUpperLeg' | 'rUpperLeg' | 'lLowerLeg' | 'rLowerLeg' | 'lFoot' | 'rFoot' | 'lEye' | 'rEye' | FingerKey;

/** Bones shown in the bone-mapping editor. */
export const MAP_KEYS: BoneKey[] = ['hips', 'spine', 'neck', 'head', 'lEye', 'rEye', 'lUpperArm', 'lForeArm', 'lHand', 'rUpperArm', 'rForeArm', 'rHand',
  'lUpperLeg', 'lLowerLeg', 'lFoot', 'rUpperLeg', 'rLowerLeg', 'rFoot'];

/** "mixamorig:LeftForeArm", "forearm.L", "J_Bip_L_LowerArm" -> "leftforearm"-style lowercase tokens. */
export const normName = (n: string) => n.replace(/^.*mixamorig:?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const side = (s: 'l' | 'r', names: string) => {
  const w = s === 'l' ? 'left' : 'right';
  return new RegExp(`^(?:${w}|${s})(?:${names})$|^(?:${names})(?:${w}|${s})$`);
};

// Priority-ordered patterns covering Mixamo, VRM/Unity humanoid, Blender (.L/.R) and generic naming.
const PATTERNS: Record<string, RegExp[]> = {
  hips: [/^(hips|pelvis)$/, /^root$/], spine: [/^spine$/, /^spine1$/, /^body$/], neck: [/^neck$/], head: [/^head$/],
};
for (const s of ['l', 'r'] as const) {
  PATTERNS[`${s}UpperArm`] = [side(s, 'upperarm|arm')];
  PATTERNS[`${s}ForeArm`] = [side(s, 'forearm|lowerarm')];
  PATTERNS[`${s}Hand`] = [side(s, 'hand')];
  PATTERNS[`${s}UpperLeg`] = [side(s, 'upperleg|upleg|thigh'), side(s, 'leg')];
  PATTERNS[`${s}Eye`] = [side(s, 'eye')];
  PATTERNS[`${s}LowerLeg`] = [side(s, 'lowerleg|calf|shin'), side(s, 'leg')];
  PATTERNS[`${s}Foot`] = [side(s, 'foot')];
  const tok: Record<string, string> = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Pinky: 'pinky|little' };
  for (const F of FINGERS) {
    // thumbs: 1=metacarpal, 2=proximal, 3=distal; other fingers: 1=proximal, 2=intermediate, 3=distal
    const segs = F === 'Thumb' ? ['1|metacarpal', '2|proximal', '3|distal'] : ['1|proximal', '2|intermediate', '3|distal'];
    segs.forEach((sg, k) => { PATTERNS[`${s}${F}${k + 1}`] = [side(s, `(?:hand)?(?:${tok[F]})(?:${sg})`)]; });
  }
}

export function autoMap(root: THREE.Object3D): Partial<Record<BoneKey, THREE.Object3D>> {
  const out: Partial<Record<BoneKey, THREE.Object3D>> = {};
  const objs: { n: string; o: THREE.Object3D }[] = [];
  root.traverse((o) => { if (o.name) objs.push({ n: normName(o.name), o }); });
  // prefer real bones over same-named meshes (stylised rigs often parent an 'Eye.R' mesh under the 'Eye-L' bone)
  objs.sort((a, b) => Number(!!(b.o as THREE.Bone).isBone) - Number(!!(a.o as THREE.Bone).isBone));
  for (const key of Object.keys(PATTERNS) as BoneKey[]) {
    for (const re of PATTERNS[key]!) {
      const hit = objs.find((x) => re.test(x.n));
      if (hit) { out[key] = hit.o; break; }
    }
  }
  // single-bone legs ('Leg-L') match both patterns: keep them as the upper leg only
  for (const [lo, up] of [['lLowerLeg', 'lUpperLeg'], ['rLowerLeg', 'rUpperLeg']] as const) if (out[lo] && out[lo] === out[up]) delete out[lo];
  return out;
}
