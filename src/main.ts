import { TrackingClient } from './tracking/client';
import { LandmarkInterpolator } from './tracking/interpolate';
import type { P3, TrackResult } from './tracking/types';
import { Retargeter } from './retarget/solver';
import { HandSolver } from './retarget/hands';
import { FaceSolver } from './retarget/face';
import { Viewer } from './scene/viewer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewer = new Viewer($('c') as HTMLCanvasElement);
const client = new TrackingClient(); const interp = new LandmarkInterpolator();
const rt = new Retargeter(); const hs = new HandSolver(); const fs = new FaceSolver();
const video = $('cam') as HTMLVideoElement; const msg = $('msg'); const stats = $('stats');
const lmBuf: P3[] = []; let cur: TrackResult | null = null;
let tracking = false, useHands = true, useFace = true, haveSample = false;
let prevT = 0, trackN = 0, renderN = 0, lastStat = performance.now(), latency = 0, infer = 0;

client.onResult = r => {
  trackN++; latency = performance.now() - r.ts; infer = r.inferMs;
  if (!r.pose) return;
  interp.push(r.pose, performance.now()); cur = r;
};

async function onFile(f: File) {
  try { msg.textContent = 'Loading…'; const m = await viewer.loadGLB(f); const missing = rt.bind(m); hs.bind(m); const nm = fs.bind(m);
    msg.textContent = missing.length ? `Missing bones: ${missing.join(', ')}. Rig it at mixamo.com.` : `Model ready (${nm} face morph targets). Start camera, then calibrate.`;
  } catch (e) { msg.textContent = 'Load failed: ' + (e as Error).message; }
}
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) void onFile(f); });

$('start').onclick = async () => {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 } });
  } catch (e) { msg.textContent = 'Camera error: allow permission (needs https or localhost). ' + (e as Error).message; return; }
  try {
    msg.textContent = 'Loading trackers…'; await client.start({ hands: useHands, face: useFace }); tracking = true;
    msg.textContent = `Tracking on ${client.delegate}. Stand 2–3 m back, full body visible.`;
  } catch (e) { msg.textContent = 'Tracker error: ' + (e as Error).message; }
};
$('calib').onclick = () => {
  if (!tracking) { msg.textContent = 'Start the camera first.'; return; }
  let n = 2; msg.textContent = `T-pose in ${n}…`;
  const iv = setInterval(() => {
    if (--n > 0) { msg.textContent = `T-pose in ${n}…`; return; }
    clearInterval(iv);
    msg.textContent = haveSample && rt.calibrate(lmBuf) ? 'Calibrated.' : 'Calibration failed: keep torso and head visible.';
  }, 1000);
};
const on = (id: string, fn: (el: HTMLInputElement) => void) => { const el = $(id) as HTMLInputElement; el.oninput = () => fn(el); };
on('mirror', el => rt.setMirror(el.checked)); on('smooth', el => rt.smoothing = +el.value);
on('legs', el => rt.legs = el.checked); on('flip', el => hs.flip = el.checked);
on('hands', el => { useHands = el.checked; client.configure(useHands, useFace); });
on('face', el => { useFace = el.checked; client.configure(useHands, useFace); if (!useFace) rt.setFace(null); });
on('ikarms', el => rt.ikArms = el.checked); on('root', el => rt.rootMotion = el.checked); on('lock', el => rt.footLock = el.checked);
($('mode') as HTMLSelectElement).onchange = e => {
  const m = (e.target as HTMLSelectElement).value; // full | upper | hands | face
  rt.torsoOn = m === 'full' || m === 'upper'; rt.arms = rt.torsoOn || m === 'hands'; rt.headOn = m !== 'hands';
  const legs = $('legs') as HTMLInputElement; if (m !== 'full') { rt.legs = false; legs.checked = false; }
  if (m === 'face') { rt.arms = false; useHands = false; ($('hands') as HTMLInputElement).checked = false; client.configure(useHands, useFace); }
};

function loop(t: number) {
  if (tracking) client.submit(video, t);                       // back-pressured: skipped while the worker is busy
  if (cur && interp.sample(t, lmBuf)) {                        // render-rate samples of tracking-rate data
    haveSample = true; const dt = Math.min(0.1, (t - (prevT || t)) / 1000);
    rt.setFace(useFace ? cur.faceMatrix : null); rt.setImage(cur.img, video.videoWidth / (video.videoHeight || 1));
    rt.apply(lmBuf, dt);
    if (useHands && cur.img) hs.apply(cur.hands, [cur.img[15], cur.img[16]], rt.mirror, rt.smoothing, dt);
    if (useFace && cur.blend) fs.apply(cur.blend, rt.mirror, rt.smoothing, dt);
  }
  prevT = t; renderN++; viewer.render();
  if (t - lastStat > 1000) {
    stats.textContent = `render ${renderN} fps · tracking ${trackN} fps · latency ${latency.toFixed(0)} ms (infer ${infer.toFixed(0)})`;
    renderN = trackN = 0; lastStat = t;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
