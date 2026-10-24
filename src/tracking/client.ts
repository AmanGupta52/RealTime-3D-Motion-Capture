import type { InMsg, OutMsg } from './protocol';
import { unpackResult } from './protocol';
import type { TrackResult } from './types';

/** Main-thread side of the tracking worker, with back-pressure: at most one frame in flight, so rendering never queues behind tracking. */
export class TrackingClient {
  onResult: (r: TrackResult) => void = () => {};
  delegate = ''; private w: Worker | null = null; private ready = false; private busy = false; private busySince = 0; private names: string[] = [];

  start(opts: { poseModel?: 'lite' | 'full' | 'heavy'; hands: boolean; face: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.w = new Worker(new URL('tracker.worker.js', document.baseURI));        // classic worker (see scripts/prep.mjs)
      this.w.onerror = ev => reject(new Error(ev.message || 'Tracking worker failed to start (did `npm run prep` run?)'));
      this.w.onmessage = (e: MessageEvent<OutMsg>) => {
        const m = e.data;
        if (m.type === 'ready') { this.ready = true; this.delegate = m.delegate; resolve(); }
        else if (m.type === 'error') reject(new Error(m.message));
        else { this.busy = false; if (m.blendNames) this.names = m.blendNames; this.onResult(unpackResult(m, this.names)); }
      };
      this.post({ type: 'init', wasmBase: new URL('wasm', document.baseURI).href, poseModel: opts.poseModel ?? 'full', hands: opts.hands, face: opts.face });
    });
  }
  configure(hands: boolean, face: boolean) { this.post({ type: 'config', hands, face }); }
  /** Send the current video frame unless the worker is still busy (watchdog resets a stuck worker after 2 s). */
  submit(video: HTMLVideoElement, ts: number) {
    if (!this.ready || video.readyState < 2) return;
    if (this.busy && ts - this.busySince < 2000) return;
    this.busy = true; this.busySince = ts;
    createImageBitmap(video).then(b => this.w!.postMessage({ type: 'frame', bitmap: b, ts } satisfies InMsg, [b])).catch(() => { this.busy = false; });
  }
  stop() { this.w?.terminate(); this.w = null; this.ready = false; }
  private post(m: InMsg) { this.w?.postMessage(m); }
}
