/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

// Local files first (fully offline, see scripts/setup-assets.mjs), CDN as a fallback.
const LOCAL = `${self.location.origin}/mediapipe/`;
const G = 'https://storage.googleapis.com/mediapipe-models/';
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const poseFile = (v: string) => `pose_landmarker_${v}.task`;
const poseCdn = (v: string) => `${G}pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`;
const HAND_CDN = `${G}hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const FACE_CDN = `${G}face_landmarker/face_landmarker/float16/1/face_landmarker.task`;

// FIX: MediaPipe 0.10.x loads its WASM glue with importScripts(), which THROWS inside module workers
// ("Module scripts don't support importScripts()"), so tracking never started. Polyfill it with a synchronous
// XHR + global eval, which is exactly what importScripts does for classic scripts.
(() => {
  const g = self as unknown as { importScripts?: (...urls: string[]) => void };
  if (typeof g.importScripts !== 'function') return;
  try { g.importScripts(); return; } catch { /* module worker: polyfill below */ }
  g.importScripts = (...urls: string[]) => {
    for (const u of urls) {
      const x = new XMLHttpRequest();
      x.open('GET', String(u), false); x.send();
      if (x.status !== 0 && (x.status < 200 || x.status >= 300)) throw new Error(`Failed to load ${u} (HTTP ${x.status})`);
      (0, eval)(`${x.responseText}\n//# sourceURL=${u}`);
    }
  };
})();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type FS = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
async function build<T>(make: (fs: FS, url: string, d: 'GPU' | 'CPU') => Promise<T>, local: string, remote: string): Promise<T> {
  const attempt = async (wasm: string, url: string) => {
    const fs = await FilesetResolver.forVisionTasks(wasm);
    try { return await make(fs, url, 'GPU'); } catch { return make(fs, url, 'CPU'); } // GPU -> CPU fallback
  };
  try { return await attempt(`${LOCAL}wasm`, `${LOCAL}${local}`); }
  catch (e1) {
    try { return await attempt(CDN_WASM, remote); }
    catch (e2) {
      const short = (e: unknown) => msg(e).replace(/\s+/g, ' ').slice(0, 110);
      throw new Error(`Could not load ${local}. Local: ${short(e1)} | CDN: ${short(e2)}. Fix: connect to the internet once and run "npm run setup:assets".`);
    }
  }
}

let pose: PoseLandmarker | null = null, hand: HandLandmarker | null = null, face: FaceLandmarker | null = null;
let namesSent = false;

async function init(model: string) {
  const v = ['lite', 'full', 'heavy'].includes(model) ? model : 'lite';
  pose = await build((fs, url, d) => PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: url, delegate: d }, runningMode: 'VIDEO', numPoses: 1 }), poseFile(v), poseCdn(v));
  // FIX: hands and face are optional: if one fails to load, body tracking still works and the user is told why.
  const warnings: string[] = [];
  try {
    hand = await build((fs, url, d) => HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: url, delegate: d }, runningMode: 'VIDEO', numHands: 2 }), 'hand_landmarker.task', HAND_CDN);
  } catch (e) { warnings.push(`Hand tracking unavailable: ${msg(e)}`); }
  try {
    // 478 landmarks (incl. iris) + 52 blendshapes + head transform matrix
    face = await build((fs, url, d) => FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: url, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    }), 'face_landmarker.task', FACE_CDN);
  } catch (e) { warnings.push(`Face tracking unavailable: ${msg(e)}`); }
  self.postMessage({ type: 'ready', warnings });
}

const pack2d = (l?: { x: number; y: number }[]) => {
  if (!l) return null;
  const a = new Float32Array(l.length * 2);
  l.forEach((p, i) => { a[i * 2] = p.x; a[i * 2 + 1] = p.y; });
  return a;
};

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') { init(m.model).catch((err) => self.postMessage({ type: 'error', message: `Tracking failed to start: ${msg(err)}` })); return; }
  if (m.type !== 'frame') return;
  const bmp = m.bitmap as ImageBitmap;
  // FIX: any exception used to leave the client waiting forever (tracking froze). Always answer, and always free the bitmap.
  try { if (pose) processFrame(m, bmp); else self.postMessage({ type: 'frame-error', message: 'Tracking models are not ready yet.', sent: m.sent }); }
  catch (err) { self.postMessage({ type: 'frame-error', message: `Tracking error: ${msg(err)}`, sent: m.sent }); }
  finally { try { bmp.close(); } catch { /* already closed */ } }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let frameNo = 0;
function processFrame(m: any, bmp: ImageBitmap) {
  if (!pose) return;
  const t0 = performance.now(), ts = m.ts as number;
  const pr = pose.detectForVideo(bmp, ts);
  // PERF: pose runs every frame; hands / face run on every Nth frame (offset so they rarely land on the same frame).
  // Skipped frames send no hand/face data and the rigs simply keep their last values, which the smoothing filters hide.
  const n = frameNo++, hE = Math.max(1, m.handEvery | 0), fE = Math.max(1, m.faceEvery | 0);
  const handsRan = !!(m.hands && hand) && n % hE === 0, faceRan = !!(m.face && face) && n % fE === (fE > 1 ? 1 : 0);
  const hr = handsRan ? hand!.detectForVideo(bmp, ts) : null;
  const fr = faceRan ? face!.detectForVideo(bmp, ts) : null;

  const lm = pr.landmarks[0];
  const poseKey = lm && lm[23] && lm[24] && lm[11] && lm[12]
    ? Float32Array.from([lm[23].x, lm[23].y, lm[24].x, lm[24].y, lm[11].x, lm[11].y, lm[12].x, lm[12].y]) : null;
  let world: Float32Array | null = null;
  const lms = pr.worldLandmarks[0];
  if (lms) {
    world = new Float32Array(33 * 4); // x,y,z,visibility
    lms.forEach((l, i) => { world![i * 4] = l.x; world![i * 4 + 1] = l.y; world![i * 4 + 2] = l.z; world![i * 4 + 3] = l.visibility ?? 0; });
  }

  // Assign each hand to the user's left/right by proximity to the pose wrists (more reliable than the label).
  let left: Float32Array | null = null, right: Float32Array | null = null;
  let leftImg: Float32Array | null = null, rightImg: Float32Array | null = null;
  const pl = pr.landmarks[0]?.[15], prr = pr.landmarks[0]?.[16];
  hr?.landmarks.forEach((img, h) => {
    const w = hr.worldLandmarks[h], wr = img[0];
    if (!w || !wr) return;
    let isLeft = hr.handedness[h]?.[0]?.categoryName === 'Right'; // label is swapped for unmirrored frames
    if (pl && prr) isLeft = Math.hypot(wr.x - pl.x, wr.y - pl.y) < Math.hypot(wr.x - prr.x, wr.y - prr.y);
    const a = new Float32Array(63);
    w.forEach((l, i) => { a[i * 3] = l.x; a[i * 3 + 1] = l.y; a[i * 3 + 2] = l.z; });
    if (isLeft && !left) { left = a; leftImg = m.overlay ? pack2d(img) : null; }
    else if (!right) { right = a; rightImg = m.overlay ? pack2d(img) : null; }
  });

  // Face: blendshape weights (52), head transform matrix, landmarks for the preview overlay
  let blend: Float32Array | null = null, names: string[] | null = null, faceMatrix: Float32Array | null = null;
  const cats = fr?.faceBlendshapes?.[0]?.categories;
  if (cats) {
    blend = Float32Array.from(cats, (c) => c.score);
    if (!namesSent) { names = cats.map((c) => c.categoryName); namesSent = true; }
  }
  const mat = fr?.facialTransformationMatrixes?.[0]?.data;
  if (mat) faceMatrix = Float32Array.from(mat);

  const out = {
    type: 'result', world, left, right, blend, names, faceMatrix, poseKey,
    poseImg: m.overlay ? pack2d(pr.landmarks[0]) : null, faceImg: m.overlay ? pack2d(fr?.faceLandmarks?.[0]) : null,
    leftImg, rightImg, handsRan, faceRan, sent: m.sent, inferMs: performance.now() - t0,
  };
  const transfer = [world, left, right, blend, faceMatrix, poseKey, out.poseImg, out.faceImg, leftImg, rightImg]
    .filter((x): x is Float32Array => !!x).map((x) => x.buffer);
  (self as unknown as Worker).postMessage(out, transfer);
}
