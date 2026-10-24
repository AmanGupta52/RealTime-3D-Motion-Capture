import { describe, it, expect, vi } from 'vitest';
import { LandmarkInterpolator } from '../src/tracking/interpolate';
import { unpackResult } from '../src/tracking/protocol';
import type { P3 } from '../src/tracking/types';

const lm = (x: number): P3[] => Array.from({ length: 33 }, () => ({ x, y: 0, z: 0, v: 1 }));

describe('LandmarkInterpolator', () => {
  it('returns nothing before data, then holds the first frame', () => {
    const it = new LandmarkInterpolator(), out: P3[] = []; expect(it.sample(0, out)).toBe(false);
    it.push(lm(1), 100); expect(it.sample(120, out)).toBe(true); expect(out[0].x).toBe(1);
  });
  it('extrapolates by gain × progress between tracking frames, capped at one interval', () => {
    const it = new LandmarkInterpolator(), out: P3[] = []; it.gain = 0.5;
    it.push(lm(0), 0); it.push(lm(1), 33);
    it.sample(33, out); expect(out[0].x).toBeCloseTo(1, 5);
    it.sample(33 + 16.5, out); expect(out[0].x).toBeCloseTo(1.25, 5);   // halfway: 1 + 1·0.5·0.5
    it.sample(500, out); expect(out[0].x).toBeCloseTo(1.5, 5);          // stalled tracker: capped, no runaway
  });
  it('gain 0 holds the newest frame', () => {
    const it = new LandmarkInterpolator(), out: P3[] = []; it.gain = 0; it.push(lm(0), 0); it.push(lm(1), 33);
    it.sample(50, out); expect(out[0].x).toBe(1);
  });
});

describe('unpackResult', () => {
  it('decodes the wire format', () => {
    const pose = new Float32Array(132); pose[4] = 0.5; pose[7] = 0.9; const blend = Float32Array.from([0.25, 0.75]);
    const r = unpackResult({ type: 'result', ts: 5, inferMs: 7, pose, img: new Float32Array(66), hands: [], faceMatrix: Float32Array.from({ length: 16 }, (_, i) => i), blend }, ['jawOpen', 'eyeBlinkLeft']);
    expect(r.pose![1].x).toBeCloseTo(0.5); expect(r.pose![1].v).toBeCloseTo(0.9); expect(r.blend).toEqual({ jawOpen: 0.25, eyeBlinkLeft: 0.75 }); expect(r.faceMatrix![15]).toBe(15);
  });
});

describe('worker logic (MediaPipe mocked)', () => {
  it('init → ready; frame → packed result; timestamps stay strictly increasing; bitmap closed', async () => {
    const mkLm = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0.1, z: 0.2, visibility: 0.9 }));
    const calls: number[] = [];
    const Fake = (res: (ts: number) => unknown) => ({ createFromOptions: async () => ({ detectForVideo: (_b: unknown, ts: number) => { calls.push(ts); return res(ts); } }) });
    vi.doMock('@mediapipe/tasks-vision', () => ({
      FilesetResolver: { forVisionTasks: async () => ({}) },
      PoseLandmarker: Fake(() => ({ worldLandmarks: [mkLm(33)], landmarks: [mkLm(33)] })),
      HandLandmarker: Fake(() => ({ landmarks: [mkLm(21)], worldLandmarks: [mkLm(21)] })),
      FaceLandmarker: Fake(() => ({ faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.4 }] }], facialTransformationMatrixes: [{ data: new Float32Array(16) }] })),
    }));
    const sent: any[] = []; const g = globalThis as any; g.self = g; g.postMessage = (m: unknown) => sent.push(m);
    await import('../src/tracking/worker');
    g.onmessage({ data: { type: 'init', wasmBase: '/wasm', poseModel: 'full', hands: true, face: true } });
    await new Promise(r => setTimeout(r, 10)); expect(sent[0]).toEqual({ type: 'ready', delegate: 'GPU' });
    let closed = 0; const bmp = { close: () => closed++ };
    g.onmessage({ data: { type: 'frame', bitmap: bmp, ts: 100 } }); g.onmessage({ data: { type: 'frame', bitmap: bmp, ts: 100 } }); // duplicate ts
    const res = sent.filter(m => m.type === 'result');
    expect(res).toHaveLength(2); expect(closed).toBe(2);
    expect(res[0].pose).toHaveLength(132); expect(res[0].hands).toHaveLength(1); expect(res[0].blendNames).toEqual(['jawOpen']); expect(res[1].blendNames).toBeUndefined();
    const pose = calls.filter((_, i) => i % 3 === 0); expect(pose[1]).toBeGreaterThan(pose[0]);   // monotonic even with a repeated ts
    g.onmessage({ data: { type: 'config', hands: false, face: false } });
    const before = calls.length; g.onmessage({ data: { type: 'frame', bitmap: bmp, ts: 200 } });
    expect(calls.length - before).toBe(1);                                                          // only pose ran
  });
});
