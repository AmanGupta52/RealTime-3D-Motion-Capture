import type { P3 } from './types';

/**
 * Bridges tracking rate (20–30 Hz) and render rate (60+ Hz). Between two tracking frames it extrapolates a little past
 * the newest one instead of delaying output by a whole frame (keeps latency low): out = cur + (cur - prev) * k,
 * k = clamp((now - tCur) / (tCur - tPrev), 0, 1) * gain. gain 0 = hold; the solvers' smoothing does the rest. Allocation-free.
 */
export class LandmarkInterpolator {
  gain = 0.5;
  private prev = new Float32Array(0); private cur = new Float32Array(0); private tPrev = 0; private tCur = 0; private n = 0; private has = 0;
  push(lm: P3[], t: number) {
    if (lm.length !== this.n) { this.n = lm.length; this.prev = new Float32Array(this.n * 4); this.cur = new Float32Array(this.n * 4); this.has = 0; }
    const swap = this.prev; this.prev = this.cur; this.cur = swap; this.tPrev = this.tCur; this.tCur = t;
    for (let i = 0; i < this.n; i++) { const p = lm[i], o = i * 4; this.cur[o] = p.x; this.cur[o + 1] = p.y; this.cur[o + 2] = p.z; this.cur[o + 3] = p.v; }
    this.has = Math.min(2, this.has + 1);
  }
  sample(now: number, out: P3[]): boolean {
    if (!this.has) return false;
    while (out.length < this.n) out.push({ x: 0, y: 0, z: 0, v: 0 });
    const span = this.tCur - this.tPrev;
    const k = this.has < 2 || span <= 0 ? 0 : Math.min(1, Math.max(0, (now - this.tCur) / span)) * this.gain;
    for (let i = 0; i < this.n; i++) {
      const o = i * 4, p = out[i], c = this.cur, q = this.prev;
      p.x = c[o] + (c[o] - q[o]) * k; p.y = c[o + 1] + (c[o + 1] - q[o + 1]) * k; p.z = c[o + 2] + (c[o + 2] - q[o + 2]) * k; p.v = c[o + 3];
    }
    return true;
  }
}
