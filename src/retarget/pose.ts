import type * as THREE from 'three';

export interface PoseSnapshot { restore(): void }
/** Snapshot of every node's local transform so the model can be returned to its rest pose (for re-mapping and export). */
export function snapshotPose(root: THREE.Object3D): PoseSnapshot {
  const items: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  root.traverse((o) => items.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  return { restore() { for (const i of items) { i.o.position.copy(i.p); i.o.quaternion.copy(i.q); i.o.scale.copy(i.s); } root.updateMatrixWorld(true); } };
}
