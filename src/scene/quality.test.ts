import { describe, it, expect } from 'vitest';
import { Adaptive } from './quality';

describe('Adaptive quality', () => {
  it('drops after sustained low fps', () => {
    const a = new Adaptive(50); let out = null as string | null;
    for (let i = 0; i < 4; i++) out = a.push(20, 'high');
    expect(out).toBe('medium');
  });
  it('does not bounce back up to a level that just failed', () => {
    const a = new Adaptive(50);
    for (let i = 0; i < 4; i++) a.push(20, 'high'); // high -> medium, high is now off limits
    let up: string | null = null;
    for (let i = 0; i < 200; i++) up = a.push(60, 'medium') ?? up;
    expect(up).toBeNull();
  });
  it('can still climb when it never failed above', () => {
    const a = new Adaptive(50); let up: string | null = null;
    for (let i = 0; i < 60; i++) up = a.push(60, 'low') ?? up;
    expect(up).toBe('medium');
  });
});
