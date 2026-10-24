// Tracking worker (bundled as a classic script by scripts/prep.mjs). Receives ImageBitmaps, returns filtered landmarks.
import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { OneEuro } from '../utils/oneEuro';
import type { InMsg, OutMsg, WireResult } from './protocol';

const ctx = self as unknown as { postMessage(m: OutMsg, t?: Transferable[]): void; onmessage: ((e: { data: InMsg }) => void) | null };
const MODELS = 'https://storage.googleapis.com/mediapipe-models/';
let pose: PoseLandmarker, hand: HandLandmarker, face: FaceLandmarker;
let useHands = true, useFace = true, lastTs = 0, namesSent = false;
const filters: OneEuro[] = Array.from({ length: 33 * 3 }, () => new OneEuro(1.2, 0.05));

async function init(m: Extract<InMsg, { type: 'init' }>) {
  useHands = m.hands; useFace = m.face;
  const fs = await FilesetResolver.forVisionTasks(m.wasmBase);
  const make = async (d: 'GPU' | 'CPU') => {
    pose = await PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `${MODELS}pose_landmarker/pose_landmarker_${m.poseModel}/float16/latest/pose_landmarker_${m.poseModel}.task`, delegate: d }, runningMode: 'VIDEO', numPoses: 1 });
    hand = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `${MODELS}hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`, delegate: d }, runningMode: 'VIDEO', numHands: 2 });
    face = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `${MODELS}face_landmarker/face_landmarker/float16/latest/face_landmarker.task`, delegate: d }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  };
  let delegate: 'GPU' | 'CPU' = 'GPU';
  try { await make('GPU'); } catch { delegate = 'CPU'; await make('CPU'); }
  ctx.postMessage({ type: 'ready', delegate });
}

function frame(bitmap: ImageBitmap, tIn: number) {
  const t0 = performance.now(); const ts = Math.max(tIn, lastTs + 1); lastTs = ts;     // MediaPipe needs strictly increasing timestamps
  const out: WireResult = { type: 'result', ts: tIn, inferMs: 0, pose: null, img: null, hands: [], faceMatrix: null, blend: null };
  const transfer: Transferable[] = [];
  try {
    const r = pose.detectForVideo(bitmap, ts); const w = r.worldLandmarks[0], im = r.landmarks[0];
    if (w && im) {
      const sec = ts / 1000; out.pose = new Float32Array(33 * 4); out.img = new Float32Array(33 * 2);
      for (let i = 0; i < 33; i++) {
        out.pose[i * 4] = filters[i * 3].filter(w[i].x, sec); out.pose[i * 4 + 1] = filters[i * 3 + 1].filter(w[i].y, sec);
        out.pose[i * 4 + 2] = filters[i * 3 + 2].filter(w[i].z, sec); out.pose[i * 4 + 3] = w[i].visibility ?? 0;
        out.img[i * 2] = im[i].x; out.img[i * 2 + 1] = im[i].y;
      }
      transfer.push(out.pose.buffer, out.img.buffer);
      if (useHands) {
        const h = hand.detectForVideo(bitmap, ts);
        h.landmarks.forEach((l, k) => { const a = new Float32Array(63); h.worldLandmarks[k].forEach((p, i) => { a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z; });
          out.hands.push({ img: [l[0].x, l[0].y], w: a }); transfer.push(a.buffer); });
      }
      if (useFace) {
        const f = face.detectForVideo(bitmap, ts);
        if (f.facialTransformationMatrixes[0]) { out.faceMatrix = Float32Array.from(f.facialTransformationMatrixes[0].data); transfer.push(out.faceMatrix.buffer); }
        const cats = f.faceBlendshapes[0]?.categories;
        if (cats) {
          if (!namesSent) { out.blendNames = cats.map(c => c.categoryName); namesSent = true; }
          out.blend = Float32Array.from(cats, c => c.score); transfer.push(out.blend.buffer);
        }
      }
    }
  } catch (e) { console.error('tracking frame failed', e); }
  finally { bitmap.close(); }
  out.inferMs = performance.now() - t0; ctx.postMessage(out, transfer);
}

ctx.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') init(m).catch(err => ctx.postMessage({ type: 'error', message: String(err?.message ?? err) }));
  else if (m.type === 'config') { useHands = m.hands; useFace = m.face; }
  else frame(m.bitmap, m.ts);
};
