import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { PoseSnapshot } from '../retarget/pose';

export interface Take {
  name: string; fps: number; boneNames: string[]; hipsIndex: number;
  times: number[]; quats: number[][]; hips: number[][]; // per frame: all bone local quaternions (x,y,z,w...) and hips local position
}

/** Records every bone's local rotation (+ hips position) at a fixed rate. */
export class MotionRecorder {
  recording = false;
  private take: Take | null = null; private acc = 0; private t = 0;
  constructor(private bones: THREE.Bone[], private hips?: THREE.Object3D) {}

  start(name: string, fps = 30) {
    this.take = { name, fps, boneNames: this.bones.map((b) => b.name), hipsIndex: this.hips ? this.bones.indexOf(this.hips as THREE.Bone) : -1, times: [], quats: [], hips: [] };
    this.acc = 0; this.t = 0; this.recording = true;
  }
  /** Call every render frame. */
  sample(dt: number) {
    if (!this.recording || !this.take) return;
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / this.take.fps) return;
    this.acc = 0;
    const q: number[] = [];
    for (const b of this.bones) q.push(+b.quaternion.x.toFixed(5), +b.quaternion.y.toFixed(5), +b.quaternion.z.toFixed(5), +b.quaternion.w.toFixed(5));
    this.take.times.push(+this.t.toFixed(4)); this.take.quats.push(q);
    this.take.hips.push(this.hips ? [this.hips.position.x, this.hips.position.y, this.hips.position.z] : [0, 0, 0]);
  }
  stop(): Take | null { this.recording = false; const t = this.take; this.take = null; return t && t.times.length ? t : null; }
  get seconds() { return this.t; }
}

/** Replays a take by writing bone rotations directly (interpolated between frames, looped). */
export class Player {
  playing = false; take: Take | null = null; private t = 0;
  constructor(private bones: THREE.Bone[], private hips?: THREE.Object3D) {}
  play(take: Take) {
    if (take.boneNames.length !== this.bones.length || take.boneNames.some((n, i) => n !== this.bones[i]!.name))
      throw new Error('This take was recorded on a different model (bone names do not match).');
    this.take = take; this.t = 0; this.playing = true;
  }
  stop() { this.playing = false; }
  update(dt: number) {
    const tk = this.take; if (!this.playing || !tk) return;
    const end = tk.times[tk.times.length - 1]!; this.t += dt; if (this.t > end) this.t = 0;
    let i = 0; while (i < tk.times.length - 2 && tk.times[i + 1]! < this.t) i++;
    const t0 = tk.times[i]!, t1 = tk.times[Math.min(i + 1, tk.times.length - 1)]!, k = t1 > t0 ? (this.t - t0) / (t1 - t0) : 0;
    const a = new THREE.Quaternion(), b = new THREE.Quaternion();
    this.bones.forEach((bone, j) => {
      a.fromArray(tk.quats[i]!, j * 4); b.fromArray(tk.quats[Math.min(i + 1, tk.quats.length - 1)]!, j * 4);
      bone.quaternion.copy(a.slerp(b, k));
    });
    if (this.hips && tk.hips[i]) this.hips.position.fromArray(tk.hips[i]!);
  }
}

/** Runs `fn` with the model in its rest pose, then puts the current pose back. */
function withRest<T>(rest: PoseSnapshot, root: THREE.Object3D, bones: THREE.Bone[], fn: () => T): T {
  const saved = bones.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  rest.restore();
  try { return fn(); } finally { bones.forEach((b, i) => { b.quaternion.copy(saved[i]!.q); b.position.copy(saved[i]!.p); }); root.updateMatrixWorld(true); }
}

/**
 * BVH export. Joint offsets are rest-pose world offsets; each joint's rotation is its world-space delta from the rest pose
 * relative to its parent's delta, so the file plays correctly even though the rig's bone axes are arbitrary.
 */
export function toBVH(take: Take, bones: THREE.Bone[], root: THREE.Object3D, rest: PoseSnapshot): string {
  return withRest(rest, root, bones, () => {
    const idx = new Map(bones.map((b, i) => [b, i])), parent = bones.map((b) => (b.parent && idx.has(b.parent as THREE.Bone) ? idx.get(b.parent as THREE.Bone)! : -1));
    root.updateMatrixWorld(true);
    const restQ = bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion())), restP = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const roots = bones.map((_, i) => i).filter((i) => parent[i] === -1);
    const posRoot = take.hipsIndex >= 0 && parent[take.hipsIndex] === -1 ? take.hipsIndex : roots[0]!;
    const f = (n: number) => (n * 100).toFixed(4); // metres -> cm
    const lines: string[] = ['HIERARCHY'];
    const write = (i: number, depth: number, isRoot: boolean) => {
      const pad = '  '.repeat(depth), b = bones[i]!, name = (b.name || `bone${i}`).replace(/\s+/g, '_');
      const off = parent[i] === -1 ? new THREE.Vector3() : restP[i]!.clone().sub(restP[parent[i]!]!);
      lines.push(`${pad}${isRoot ? 'ROOT' : 'JOINT'} ${name}_${i}`, `${pad}{`, `${pad}  OFFSET ${f(off.x)} ${f(off.y)} ${f(off.z)}`);
      lines.push(`${pad}  CHANNELS ${i === posRoot ? '6 Xposition Yposition Zposition' : '3'} Zrotation Xrotation Yrotation`);
      const kids = bones.map((_, k) => k).filter((k) => parent[k] === i);
      if (!kids.length) { lines.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET 0 ${f(0.05)} 0`, `${pad}  }`); }
      kids.forEach((k) => write(k, depth + 1, false));
      lines.push(`${pad}}`);
    };
    // BVH allows one ROOT: with several top-level bones, wrap them in a zero-offset Origin
    if (roots.length === 1) write(roots[0]!, 0, true);
    else {
      lines.push('ROOT Origin', '{', '  OFFSET 0 0 0', '  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation');
      roots.forEach((r) => write(r, 1, false)); lines.push('}');
    }
    const useOrigin = roots.length !== 1;
    lines.push('MOTION', `Frames: ${take.times.length}`, `Frame Time: ${(1 / take.fps).toFixed(6)}`);
    const q = new THREE.Quaternion(), delta: THREE.Quaternion[] = bones.map(() => new THREE.Quaternion()), e = new THREE.Euler();
    const deg = (r: number) => THREE.MathUtils.radToDeg(r).toFixed(4);
    for (let fi = 0; fi < take.times.length; fi++) {
      bones.forEach((b, j) => { b.quaternion.fromArray(take.quats[fi]!, j * 4); });
      if (take.hipsIndex >= 0) bones[take.hipsIndex]!.position.fromArray(take.hips[fi]!);
      root.updateMatrixWorld(true);
      const row: string[] = [];
      if (useOrigin) row.push('0 0 0 0 0 0');
      bones.forEach((b, j) => { delta[j]!.copy(b.getWorldQuaternion(q)).multiply(restQ[j]!.clone().invert()); });
      // emit in hierarchy (depth-first) order, matching the writer above
      const order: number[] = [];
      const walk = (i: number) => { order.push(i); bones.forEach((_, k) => { if (parent[k] === i) walk(k); }); };
      roots.forEach(walk);
      for (const i of order) {
        const rel = parent[i] === -1 ? delta[i]!.clone() : delta[parent[i]!]!.clone().invert().multiply(delta[i]!);
        e.setFromQuaternion(rel, 'ZXY');
        const p = i === posRoot ? bones[i]!.getWorldPosition(new THREE.Vector3()) : null;
        row.push(`${p ? `${f(p.x)} ${f(p.y)} ${f(p.z)} ` : ''}${deg(e.z)} ${deg(e.x)} ${deg(e.y)}`);
      }
      lines.push(row.join(' '));
    }
    return lines.join('\n');
  });
}

/** Animated GLB: the model in its rest pose plus one AnimationClip with a rotation track per bone (and hips position). */
export async function toGLB(take: Take, bones: THREE.Bone[], root: THREE.Object3D, rest: PoseSnapshot): Promise<ArrayBuffer> {
  const tracks: THREE.KeyframeTrack[] = [];
  bones.forEach((b, j) => {
    const v: number[] = []; take.quats.forEach((q) => v.push(q[j * 4]!, q[j * 4 + 1]!, q[j * 4 + 2]!, q[j * 4 + 3]!));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, take.times, v));
  });
  if (take.hipsIndex >= 0) tracks.push(new THREE.VectorKeyframeTrack(`${bones[take.hipsIndex]!.name}.position`, take.times, take.hips.flat()));
  const clip = new THREE.AnimationClip(take.name, -1, tracks);
  const saved = bones.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  rest.restore();
  try {
    return (await new GLTFExporter().parseAsync(root, { binary: true, animations: [clip], onlyVisible: false })) as ArrayBuffer;
  } finally { bones.forEach((b, i) => { b.quaternion.copy(saved[i]!.q); b.position.copy(saved[i]!.p); }); root.updateMatrixWorld(true); }
}

export function download(data: Blob | string | ArrayBuffer, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
