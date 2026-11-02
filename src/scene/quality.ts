import type { Preset } from '../state/settings';

export interface Quality {
  complexity: 'lite' | 'full' | 'heavy'; res: '480p' | '720p' | '1080p'; trackFps: number;
  handEvery: number; faceEvery: number; // run hand / face tracking on every Nth tracked frame (pose runs every frame)
  pixelRatio: number; shadow: number; bloom: boolean; ssao: boolean; smaa: boolean; texture: number;
}
export const PRESETS: Record<Preset, Quality> = {
  low:    { complexity: 'lite',  res: '480p',  trackFps: 24, handEvery: 2, faceEvery: 3, pixelRatio: 0.75, shadow: 512,  bloom: false, ssao: false, smaa: false, texture: 1024 },
  medium: { complexity: 'lite',  res: '720p',  trackFps: 30, handEvery: 1, faceEvery: 2, pixelRatio: 1,    shadow: 1024, bloom: true,  ssao: false, smaa: true,  texture: 2048 },
  high:   { complexity: 'full',  res: '720p',  trackFps: 30, handEvery: 1, faceEvery: 1, pixelRatio: 1.5,  shadow: 2048, bloom: true,  ssao: false, smaa: true,  texture: 4096 },
  ultra:  { complexity: 'heavy', res: '1080p', trackFps: 30, handEvery: 1, faceEvery: 1, pixelRatio: 2,    shadow: 4096, bloom: true,  ssao: true,  smaa: true,  texture: 4096 },
};
export const LEVELS: Preset[] = ['low', 'medium', 'high', 'ultra'];

/** Maps the average frame time of a short render benchmark (at the High preset) to a starting preset. */
export function presetFromFrameMs(ms: number): Preset {
  const cores = navigator.hardwareConcurrency || 4;
  const p: Preset = ms < 9 ? 'ultra' : ms < 15 ? 'high' : ms < 26 ? 'medium' : 'low';
  return cores <= 4 && (p === 'ultra' || p === 'high') ? 'medium' : p;
}

/** Lowers the preset when fps stays under target. It only raises it again after a long, steady stretch of headroom, and never
 *  back above a level that already failed. PERF: it used to oscillate every ~10 s, and each switch reallocated all render
 *  targets and shadow maps, which showed up as a regular stutter. */
export class Adaptive {
  private low = 0; private high = 0; private cap = LEVELS.length - 1;
  constructor(public target = 50) {}
  /** Forget what failed (call when the user picks a quality manually). */
  reset() { this.low = 0; this.high = 0; this.cap = LEVELS.length - 1; }
  push(fps: number, level: Preset): Preset | null {
    if (typeof document !== 'undefined' && document.hidden) return null; // a hidden window is throttled; not a real measurement
    const i = LEVELS.indexOf(level);
    if (fps < this.target * 0.8) { this.low++; this.high = 0; } else if (fps > this.target * 0.97) { this.high++; this.low = 0; } else { this.low = 0; this.high = 0; }
    if (this.low >= 4 && i > 0) { this.low = 0; this.cap = i - 1; return LEVELS[i - 1]!; }
    if (this.high >= 45 && i < this.cap) { this.high = 0; return LEVELS[i + 1]!; }
    return null;
  }
}
