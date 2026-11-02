export interface PoseResult {
  world: Float32Array | null; left: Float32Array | null; right: Float32Array | null;
  blend: Float32Array | null; names: string[] | null; faceMatrix: Float32Array | null;
  poseImg: Float32Array | null; faceImg: Float32Array | null; leftImg: Float32Array | null; rightImg: Float32Array | null;
  poseKey: Float32Array | null; // hips + shoulders in image space (root motion)
  handsRan: boolean; faceRan: boolean; // false on frames where that tracker was skipped (keep the previous overlay)
  sent: number; inferMs: number;
}

const WATCHDOG_MS = 4000; // a frame that is never answered must not freeze tracking

/** Feeds video frames to the worker. Drops frames while the worker is busy so latency never builds up. */
export class TrackingClient {
  hands = true; face = true; overlay = true; maxFps = 60; handEvery = 1; faceEvery = 1;
  private lastSent = 0; private lastErrAt = 0;
  private worker = new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
  private busy = false; private ready = false; private raf = 0; private running = false;
  onResult: (r: PoseResult, latencyMs: number) => void = () => {};
  onError: (m: string) => void = () => {};
  onWarning: (m: string) => void = () => {};
  onReady: () => void = () => {};

  private maxSide: number;
  constructor(model: 'lite' | 'full' | 'heavy' = 'lite') {
    // PERF: the MediaPipe models work on ~256 px crops, so copying full 720p/1080p frames every frame is wasted work.
    this.maxSide = model === 'lite' ? 640 : model === 'full' ? 960 : 1280;
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true; this.onReady();
        if (m.warnings?.length) this.onWarning((m.warnings as string[]).join(' | '));
      } else if (m.type === 'error') this.onError(m.message);
      else if (m.type === 'frame-error') { this.busy = false; this.reportThrottled(m.message); }
      else if (m.type === 'result') { this.busy = false; this.onResult(m, performance.now() - m.sent); }
    };
    // FIX: a worker that fails to load or crashes used to be completely silent (app stuck on "loading tracking models").
    this.worker.onerror = (e) => { this.busy = false; this.onError(`Tracking worker error: ${e.message || 'failed to load worker script'}`); };
    this.worker.onmessageerror = () => { this.busy = false; this.reportThrottled('Tracking worker sent unreadable data.'); };
    this.worker.postMessage({ type: 'init', model });
  }

  private reportThrottled(m: string) { // at most one error toast per 3 s, so a per-frame failure cannot flood the UI
    const now = performance.now(); if (now - this.lastErrAt < 3000) return;
    this.lastErrAt = now; this.onError(m);
  }

  start(video: HTMLVideoElement) {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      const now0 = performance.now();
      if (this.busy && now0 - this.lastSent > WATCHDOG_MS) this.busy = false; // watchdog
      if (this.ready && !this.busy && video.readyState >= 2 && video.videoWidth > 0 && now0 - this.lastSent >= 1000 / this.maxFps) {
        this.busy = true; this.lastSent = now0;
        try {
          const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, this.maxSide / Math.max(vw, vh));
          const bitmap = k < 1
            ? await createImageBitmap(video, { resizeWidth: Math.round(vw * k), resizeHeight: Math.round(vh * k), resizeQuality: 'low' })
            : await createImageBitmap(video);
          const now = performance.now();
          this.worker.postMessage({ type: 'frame', bitmap, ts: now, sent: now, hands: this.hands, face: this.face, overlay: this.overlay, handEvery: this.handEvery, faceEvery: this.faceEvery }, [bitmap]);
        } catch (err) { // FIX: a failed capture used to leave busy=true forever and kill the loop
          this.busy = false; this.reportThrottled(`Could not read a camera frame: ${(err as Error).message}`);
        }
      }
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    void loop();
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.worker.terminate(); }
}
