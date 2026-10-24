/** One Euro Filter (Casiez et al. 2012): adaptive low-pass; cutoff rises with speed to cut lag. */
export class OneEuro {
  private x = 0; private dx = 0; private t = 0; private init = false;
  constructor(private minCutoff = 1.0, private beta = 0.02, private dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tSec: number): number {
    if (!this.init) { this.init = true; this.x = v; this.t = tSec; return v; }
    const dt = Math.max(1e-3, tSec - this.t); this.t = tSec;
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}
