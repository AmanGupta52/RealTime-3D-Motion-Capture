// Test helper: builds a real VRM 1.0 binary (skeleton + optional face mesh with morph targets and VRM expressions)
// from the default humanoid and loads it with the real three-vrm loader.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { createDefaultHumanoid } from '../retarget/DefaultHumanoid';

export async function makeVrm(withFace = false): Promise<{ vrm: VRM; face?: THREE.Mesh }> {
  const src = createDefaultHumanoid(), nodes: Record<string, unknown>[] = [], idx = new Map<THREE.Object3D, number>();
  const visit = (o: THREE.Object3D): number => {
    const i = nodes.length; nodes.push({}); idx.set(o, i);
    const kids = o.children.filter((c) => (c as THREE.Bone).isBone).map(visit);
    nodes[i] = { name: o.name, translation: o.position.toArray(), ...(kids.length ? { children: kids } : {}) };
    return i;
  };
  visit(src.getObjectByName('Hips')!);
  const n = (name: string) => ({ node: idx.get(src.getObjectByName(name)!)! });
  const humanBones: Record<string, { node: number }> = {
    hips: n('Hips'), spine: n('Spine'), chest: n('Chest'), neck: n('Neck'), head: n('Head'),
    leftUpperArm: n('LeftUpperArm'), leftLowerArm: n('LeftLowerArm'), leftHand: n('LeftHand'),
    rightUpperArm: n('RightUpperArm'), rightLowerArm: n('RightLowerArm'), rightHand: n('RightHand'),
    leftUpperLeg: n('LeftUpperLeg'), leftLowerLeg: n('LeftLowerLeg'), leftFoot: n('LeftFoot'),
    rightUpperLeg: n('RightUpperLeg'), rightLowerLeg: n('RightLowerLeg'), rightFoot: n('RightFoot'),
  };
  const vrmExt: Record<string, unknown> = {
    specVersion: '1.0',
    meta: { name: 'test', version: '1', authors: ['t'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'everyone', commercialUsage: 'personalNonProfit', creditNotation: 'unnecessary', allowRedistribution: false, modification: 'prohibited' },
    humanoid: { humanBones },
  };
  const json: Record<string, unknown> = { asset: { version: '2.0' }, extensionsUsed: ['VRMC_vrm'], scene: 0, scenes: [{ nodes: [0] }], nodes, extensions: { VRMC_vrm: vrmExt } };
  let bin: Uint8Array | null = null;
  if (withFace) {
    const faceIdx = nodes.length; nodes.push({ name: 'Face', mesh: 0 });
    const head = nodes[humanBones.head!.node]!; head.children = [...((head.children as number[]) ?? []), faceIdx];
    const f = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, 0.1, 0, 0, 0.1]); // triangle + one morph delta set
    bin = new Uint8Array(f.buffer);
    json.buffers = [{ byteLength: 72 }];
    json.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }];
    json.accessors = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }];
    json.meshes = [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }, { POSITION: 1 }, { POSITION: 1 }] }], extras: { targetNames: ['aa', 'blinkL', 'blinkR'] } }];
    const bind = (index: number) => ({ morphTargetBinds: [{ node: faceIdx, index, weight: 1 }] });
    vrmExt.expressions = { preset: { aa: bind(0), blinkLeft: bind(1), blinkRight: bind(2) } };
  }
  const pad = (b: Uint8Array, fill = 0) => { const o = new Uint8Array(Math.ceil(b.length / 4) * 4).fill(fill); o.set(b); return o; };
  const jb = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20), bb = bin ? pad(bin) : null;
  const total = 12 + 8 + jb.length + (bb ? 8 + bb.length : 0), glb = new ArrayBuffer(total), dv = new DataView(glb);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); new Uint8Array(glb, 20, jb.length).set(jb);
  if (bb) { const o = 20 + jb.length; dv.setUint32(o, bb.length, true); dv.setUint32(o + 4, 0x004e4942, true); new Uint8Array(glb, o + 8, bb.length).set(bb); }
  const loader = new GLTFLoader(); loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.parseAsync(glb, '');
  const vrm = gltf.userData.vrm as VRM;
  return { vrm, face: withFace ? (vrm.scene.getObjectByName('Face') as THREE.Mesh) : undefined };
}
