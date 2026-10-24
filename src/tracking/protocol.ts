import type { TrackResult } from './types';

export type InMsg =
  | { type: 'init'; wasmBase: string; poseModel: 'lite' | 'full' | 'heavy'; hands: boolean; face: boolean }
  | { type: 'config'; hands: boolean; face: boolean }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number };
export interface WireResult {
  type: 'result'; ts: number; inferMs: number;
  pose: Float32Array | null;                    // 33 × (x, y, z, visibility)
  img: Float32Array | null;                     // 33 × (x, y)
  hands: { img: [number, number]; w: Float32Array }[]; // w: 21 × (x, y, z)
  faceMatrix: Float32Array | null; blend: Float32Array | null; blendNames?: string[];
}
export type OutMsg = { type: 'ready'; delegate: 'GPU' | 'CPU' } | { type: 'error'; message: string } | WireResult;

/** Turn the compact typed-array wire format into the structures the solvers use. */
export function unpackResult(m: WireResult, names: string[]): TrackResult {
  const pose = m.pose && Array.from({ length: 33 }, (_, i) => ({ x: m.pose![i * 4], y: m.pose![i * 4 + 1], z: m.pose![i * 4 + 2], v: m.pose![i * 4 + 3] }));
  const img = m.img && Array.from({ length: 33 }, (_, i) => ({ x: m.img![i * 2], y: m.img![i * 2 + 1] }));
  const hands = m.hands.map(h => ({ img: { x: h.img[0], y: h.img[1] },
    w: Array.from({ length: 21 }, (_, i) => ({ x: h.w[i * 3], y: h.w[i * 3 + 1], z: h.w[i * 3 + 2], v: 1 })) }));
  let blend: Record<string, number> | null = null;
  if (m.blend) { blend = {}; for (let i = 0; i < names.length && i < m.blend.length; i++) blend[names[i]] = m.blend[i]; }
  return { ts: m.ts, inferMs: m.inferMs, pose, img, hands, faceMatrix: m.faceMatrix && Array.from(m.faceMatrix), blend };
}
