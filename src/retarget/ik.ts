import * as THREE from 'three';

const root = new THREE.Vector3(), dir = new THREE.Vector3();

/**
 * FABRIK inverse kinematics on joint positions `p` (modified in place) with fixed segment lengths `len`.
 * Reaches `target` if possible, otherwise stretches straight toward it. Bone lengths are always preserved.
 */
export function fabrik(p: THREE.Vector3[], len: number[], target: THREE.Vector3, iterations = 8) {
  const n = p.length;
  root.copy(p[0]!);
  const total = len.reduce((a, b) => a + b, 0);
  if (root.distanceTo(target) >= total) {
    dir.subVectors(target, root).normalize();
    for (let i = 0; i < n - 1; i++) p[i + 1]!.copy(p[i]!).addScaledVector(dir, len[i]!);
    return;
  }
  for (let it = 0; it < iterations; it++) {
    p[n - 1]!.copy(target); // backward pass: end effector onto the target
    for (let i = n - 2; i >= 0; i--) { dir.subVectors(p[i]!, p[i + 1]!).normalize(); p[i]!.copy(p[i + 1]!).addScaledVector(dir, len[i]!); }
    p[0]!.copy(root);       // forward pass: root back to its anchor
    for (let i = 0; i < n - 1; i++) { dir.subVectors(p[i + 1]!, p[i]!).normalize(); p[i + 1]!.copy(p[i]!).addScaledVector(dir, len[i]!); }
    if (p[n - 1]!.distanceTo(target) < 1e-4) break;
  }
}
