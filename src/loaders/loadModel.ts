import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { unzipSync } from 'fflate';
import { autoMap, type BoneKey, FINGERS } from '../retarget/boneMap';

const draco = new DRACOLoader().setDecoderPath('/draco/'); // copied by scripts/setup-assets.mjs
let ktx2: KTX2Loader | null = null;
export function initKtx2(r: THREE.WebGLRenderer) { ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(r); }

export interface LoadedModel {
  root: THREE.Object3D; bones: THREE.Bone[]; warning?: string;
  boneMap?: Partial<Record<BoneKey, THREE.Object3D>>; vrm?: VRM; format: string;
}
export const SUPPORTED = ['glb', 'gltf', 'vrm', 'fbx', 'obj', 'dae', 'usdz', 'zip'];
const MODEL_EXT = ['glb', 'gltf', 'vrm', 'fbx', 'dae', 'obj', 'usdz'];
const base = (p: string) => decodeURIComponent(p.split('?')[0]!.split(/[\\/]/).pop() ?? '').toLowerCase();

/** If the rig was authored rotated (the eye line is not along X), turn the whole model to face +Z. */
function faceFront(root: THREE.Object3D, map: Partial<Record<BoneKey, THREE.Object3D>>) {
  root.updateMatrixWorld(true);
  const m = { ...autoMap(root), ...map };
  if (!m.lEye || !m.rEye) return;
  const d = m.rEye.getWorldPosition(new THREE.Vector3()).sub(m.lEye.getWorldPosition(new THREE.Vector3()));
  d.y = 0;
  if (d.lengthSq() < 1e-10) return;
  root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(d.normalize(), new THREE.Vector3(-1, 0, 0)));
}

/** Downscale textures larger than `max` px (quality presets control texture size).
 *  PERF: ImageBitmap textures (GLB/VRM) are resized with createImageBitmap, which runs off the main thread, so loading a big
 *  model no longer freezes the UI. The original bitmap is closed to free memory. Other image types use a canvas. */
async function limitTextures(root: THREE.Object3D, max: number) {
  const seen = new Set<THREE.Texture>(), jobs: Promise<void>[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(mt)) {
        const t = v as THREE.Texture;
        if (!t?.isTexture || seen.has(t)) continue; seen.add(t);
        const img = t.image as (CanvasImageSource & { width: number; height: number; close?: () => void }) | undefined;
        if (!img || !img.width || img.width <= max || (t as unknown as { isCompressedTexture?: boolean }).isCompressedTexture) continue;
        const s = max / Math.max(img.width, img.height), w = Math.round(img.width * s), h = Math.round(img.height * s);
        if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
          jobs.push(createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }).then((bmp) => {
            t.image = bmp; t.needsUpdate = true; img.close();
          }).catch(() => { /* keep the full-size texture */ }));
        } else {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d')!.drawImage(img, 0, 0, w, h);
          t.image = c; t.needsUpdate = true;
        }
      }
    }
  });
  await Promise.all(jobs);
}

/** FIX: three-vrm's vrm.update() copies the NORMALIZED humanoid pose onto the real bones every frame
 *  (VRMHumanoid.autoUpdateHumanBones, on by default). The app drives the real bones directly, so that copy reset every VRM
 *  model to its rest pose each frame and the character never moved. Turn it off. Expressions and spring bones still update. */
export function prepareVrm(vrm: VRM) { vrm.humanoid.autoUpdateHumanBones = false; }

/** VRM humanoid bones -> our bone keys (raw skeleton nodes, so skinning stays intact). */
export function vrmBoneMap(vrm: VRM): Partial<Record<BoneKey, THREE.Object3D>> {
  const h = vrm.humanoid, out: Partial<Record<BoneKey, THREE.Object3D>> = {};
  const get = (n: string) => h.getRawBoneNode(n as never) ?? undefined;
  const set = (k: BoneKey, n: string) => { const b = get(n); if (b) out[k] = b; };
  for (const [s, side] of [['l', 'left'], ['r', 'right']] as const) {
    set(`${s}UpperArm`, `${side}UpperArm`); set(`${s}ForeArm`, `${side}LowerArm`); set(`${s}Hand`, `${side}Hand`);
    set(`${s}UpperLeg`, `${side}UpperLeg`); set(`${s}LowerLeg`, `${side}LowerLeg`); set(`${s}Foot`, `${side}Foot`); set(`${s}Eye`, `${side}Eye`);
    for (const F of FINGERS) {
      const segs = F === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      // FIX: the VRM standard calls the pinky 'Little'. Looking it up as 'Pinky' never matched, so hand tracking was
      // disabled on every VRM model (the 'Could not auto-detect: lHand+fingers, rHand+fingers' warning).
      const vrmName = F === 'Pinky' ? 'Little' : F;
      segs.forEach((sg, i) => set(`${s}${F}${i + 1}` as BoneKey, `${side}${vrmName}${sg}`));
    }
  }
  set('hips', 'hips'); set('spine', 'spine'); set('neck', 'neck'); set('head', 'head');
  return out;
}

/** GLB / GLTF / VRM / FBX / OBJ / DAE / USDZ, or a ZIP containing one of them plus its textures. */
export async function loadModel(src: File | string, onProgress?: (p: number) => void, maxTexture = 4096): Promise<LoadedModel> {
  const name = typeof src === 'string' ? src : src.name;
  let ext = base(name).split('.').pop() ?? '';
  if (!SUPPORTED.includes(ext)) throw new Error(`.${ext} is not supported. Use ${SUPPORTED.join(', ').toUpperCase()}.`);

  const manager = new THREE.LoadingManager();
  const urls: string[] = []; const blobUrl = (b: Blob) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  let mainUrl: string;
  try {
    if (ext === 'zip') {
      const bytes = new Uint8Array(typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer());
      const files = unzipSync(bytes), table = new Map<string, string>();
      let main = '';
      for (const [path, data] of Object.entries(files)) {
        if (path.endsWith('/')) continue;
        const u = blobUrl(new Blob([data as BlobPart])); table.set(base(path), u);
        const e = base(path).split('.').pop() ?? '';
        if (MODEL_EXT.includes(e) && (!main || MODEL_EXT.indexOf(e) < MODEL_EXT.indexOf(main.split('.').pop()!))) main = base(path);
      }
      if (!main) throw new Error('No model file (GLB/GLTF/VRM/FBX/DAE/OBJ/USDZ) found inside the ZIP.');
      manager.setURLModifier((u) => table.get(base(u)) ?? u); // resolve texture paths by file name
      mainUrl = table.get(main)!; ext = main.split('.').pop()!;
    } else mainUrl = typeof src === 'string' ? src : blobUrl(src);

    const progress = (e: ProgressEvent) => e.total && onProgress?.(e.loaded / e.total);
    let root: THREE.Object3D, vrm: VRM | undefined;
    if (ext === 'glb' || ext === 'gltf' || ext === 'vrm') {
      const l = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
      if (ktx2) l.setKTX2Loader(ktx2);
      l.register((p) => new VRMLoaderPlugin(p));
      const g = await l.loadAsync(mainUrl, progress);
      root = g.scene; vrm = g.userData.vrm as VRM | undefined; if (vrm) prepareVrm(vrm);
    } else if (ext === 'fbx') root = await new FBXLoader(manager).loadAsync(mainUrl, progress);
    else if (ext === 'dae') root = (await new ColladaLoader(manager).loadAsync(mainUrl, progress))!.scene;
    else if (ext === 'usdz') root = await new USDZLoader(manager).loadAsync(mainUrl, progress);
    else root = await new OBJLoader(manager).loadAsync(mainUrl, progress);

    const bones: THREE.Bone[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const boneMap = vrm ? vrmBoneMap(vrm) : undefined;
    faceFront(root, boneMap ?? {});
    await limitTextures(root, maxTexture);
    // auto-scale to ~1.8 m tall, centre, stand on the floor
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    root.scale.multiplyScalar(1.8 / (size.y || 1)); root.updateMatrixWorld(true);
    box.setFromObject(root);
    root.position.y -= box.min.y; root.position.x -= (box.min.x + box.max.x) / 2; root.position.z -= (box.min.z + box.max.z) / 2;
    root.updateMatrixWorld(true);
    return {
      root, bones, boneMap, vrm, format: ext,
      warning: bones.length ? undefined : 'This model has no skeleton, so it cannot be driven. Rig it with Mixamo (mixamo.com) or Blender auto-rig (Rigify), then re-import.',
    };
  } finally { setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60_000); }
}
