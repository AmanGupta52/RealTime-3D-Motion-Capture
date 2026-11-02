import type { PoseResult } from '../tracking/TrackingClient';

const POSE_LINES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [23, 24], [11, 23], [12, 24], [23, 25], [25, 27], [24, 26], [26, 28]] as const;

/** Draws the tracked skeleton, face mesh points and hands over the camera preview (input-preview overlay). */
export function drawOverlay(c: HTMLCanvasElement, w: number, h: number, r: PoseResult) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const dots = (a: Float32Array | null, color: string, s: number) => {
    if (!a) return;
    g.fillStyle = color;
    for (let i = 0; i < a.length; i += 2) g.fillRect(a[i]! * w - s / 2, a[i + 1]! * h - s / 2, s, s);
  };
  if (r.poseImg) {
    g.strokeStyle = '#00cff7'; g.lineWidth = 3; g.beginPath();
    for (const [a, b] of POSE_LINES) { g.moveTo(r.poseImg[a * 2]! * w, r.poseImg[a * 2 + 1]! * h); g.lineTo(r.poseImg[b * 2]! * w, r.poseImg[b * 2 + 1]! * h); }
    g.stroke(); dots(r.poseImg, '#ff0364', 5);
  }
  dots(r.faceImg, '#c0c0c0b0', 1.6); dots(r.leftImg, '#eb1064', 4); dots(r.rightImg, '#22c3e3', 4);
}
