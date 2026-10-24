import * as THREE from 'three';
const u = new THREE.Vector3(), pp = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3();

/**
 * Analytic two-bone IK (law of cosines). Root joint at A, bone lengths l1/l2, wanted end position T.
 * `pole` picks which way the middle joint (knee/elbow) bends. Writes world directions of both bones.
 * Unreachable targets are clamped to the reachable shell so limbs straighten instead of stretching.
 * Returns the distance actually reached.
 */
export function solveTwoBone(A: THREE.Vector3, T: THREE.Vector3, l1: number, l2: number,
  pole: THREE.Vector3, upperDir: THREE.Vector3, lowerDir: THREE.Vector3): number {
  u.subVectors(T, A); let d = u.length();
  if (d < 1e-6) { u.set(0, -1, 0); d = 1e-6; } else u.divideScalar(d);
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  pp.copy(pole).addScaledVector(u, -pole.dot(u));            // pole component perpendicular to A->T
  if (pp.lengthSq() < 1e-10) { pp.set(0, 0, 1).addScaledVector(u, -u.z); if (pp.lengthSq() < 1e-10) pp.set(1, 0, 0); }
  pp.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  E.copy(u).multiplyScalar(l1 * cosA).addScaledVector(pp, l1 * sinA).add(A);   // middle joint
  upperDir.subVectors(E, A).normalize();
  Tc.copy(u).multiplyScalar(d).add(A); lowerDir.subVectors(Tc, E).normalize();
  return d;
}
