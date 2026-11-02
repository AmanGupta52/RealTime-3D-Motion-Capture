/**
 * One Euro Filter (Casiez et al. 2012): low-pass filter whose cutoff rises with signal speed,
 * so slow motion is smooth (low jitter) and fast motion has low lag.
 * cutoff = minCutoff + beta * |filtered derivative|
 */
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

export class OneEuroFilter {
  private xPrev = 0; private dxPrev = 0; private ready = false;
  constructor(public minCutoff = 1, public beta = 0, public dCutoff = 1) {}

  filter(x: number, dt: number): number {
    if (!this.ready || dt <= 0) { this.ready = true; this.xPrev = x; this.dxPrev = 0; return x; }
    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const a = alpha(this.minCutoff + this.beta * Math.abs(dxHat), dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat; this.dxPrev = dxHat;
    return xHat;
  }
  reset() { this.ready = false; }
}
