// Makes the app fully offline: copies MediaPipe WASM + Draco decoders from node_modules and downloads the .task models once.
import { cpSync, mkdirSync, existsSync, statSync, createWriteStream, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const pub = 'public';
for (const d of ['mediapipe/wasm', 'draco', 'basis', 'models']) mkdirSync(`${pub}/${d}`, { recursive: true });
try {
  cpSync('node_modules/@mediapipe/tasks-vision/wasm', `${pub}/mediapipe/wasm`, { recursive: true });
  cpSync('node_modules/three/examples/jsm/libs/draco/gltf', `${pub}/draco`, { recursive: true });
  cpSync('node_modules/three/examples/jsm/libs/basis', `${pub}/basis`, { recursive: true }); // KTX2 transcoder
} catch (e) { console.warn('[assets] copy failed:', e.message); }

const G = 'https://storage.googleapis.com/mediapipe-models/';
const files = {
  'pose_landmarker_lite.task': `${G}pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'pose_landmarker_full.task': `${G}pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  'pose_landmarker_heavy.task': `${G}pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
  'hand_landmarker.task': `${G}hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'face_landmarker.task': `${G}face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
};
for (const [name, url] of Object.entries(files)) {
  const out = `${pub}/mediapipe/${name}`, part = `${out}.part`;
  if (existsSync(out) && statSync(out).size > 100000) continue;
  try {
    // FIX: download to a .part file and rename when complete. Writing straight to the final name left a truncated model
    // behind after an interrupted download, which the size check above then accepted forever.
    const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(part));
    const want = Number(r.headers.get('content-length') ?? 0), got = statSync(part).size;
    if (want && got !== want) throw new Error(`incomplete download (${got} of ${want} bytes)`);
    renameSync(part, out);
    console.log('[assets] downloaded', name);
  } catch (e) {
    try { rmSync(part, { force: true }); } catch { /* ignore */ }
    console.warn(`[assets] could not download ${name} (${e.message}); the app will fall back to the CDN at runtime. Retry with: npm run setup:assets`);
  }
}
