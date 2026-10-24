export type P3 = { x: number; y: number; z: number; v: number };
export type HandObs = { img: { x: number; y: number }; w: P3[] };
export interface TrackResult {
  ts: number;                                   // capture time (performance.now of the main thread)
  inferMs: number;                              // time spent inside the worker
  pose: P3[] | null;                            // filtered world landmarks (metres, hip-centred)
  img: { x: number; y: number }[] | null;       // normalized image landmarks
  hands: HandObs[]; faceMatrix: number[] | null; blend: Record<string, number> | null;
}
