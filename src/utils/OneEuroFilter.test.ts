import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from './OneEuroFilter';

describe('OneEuroFilter', () => {
  it('passes the first sample through and keeps a constant signal constant', () => {
    const f = new OneEuroFilter(1, 0);
    expect(f.filter(5, 1 / 30)).toBe(5);
    for (let i = 0; i < 50; i++) expect(f.filter(5, 1 / 30)).toBeCloseTo(5, 6);
  });
  it('converges to a step', () => {
    const f = new OneEuroFilter(2, 1);
    f.filter(0, 1 / 30);
    let y = 0; for (let i = 0; i < 120; i++) y = f.filter(1, 1 / 30);
    expect(y).toBeGreaterThan(0.99);
  });
  it('reduces jitter vs raw input', () => {
    const f = new OneEuroFilter(0.5, 0);
    let rawVar = 0, outVar = 0, prevOut = 0;
    for (let i = 0; i < 200; i++) {
      const x = (i % 2 ? 1 : -1) * 0.01, y = f.filter(x, 1 / 30);
      if (i > 20) { rawVar += x * x; outVar += (y - prevOut) ** 2 + y * y; }
      prevOut = y;
    }
    expect(outVar).toBeLessThan(rawVar);
  });
});
