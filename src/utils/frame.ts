import * as THREE from 'three';
const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(), m = new THREE.Matrix4();
const pq = new THREE.Quaternion(), tmp = new THREE.Quaternion();

/** Orthonormal frame from primary axis `a` and side hint `b`: x=a, z=a×b, y=z×x. Returns its rotation. */
export function frameQ(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Quaternion) {
  x.copy(a).normalize(); z.crossVectors(x, b).normalize(); y.crossVectors(z, x);
  return out.setFromRotationMatrix(m.makeBasis(x, y, z));
}
export function findBone(root: THREE.Object3D, n: string) {
  let f: THREE.Object3D | undefined;
  root.traverse(o => { if (!f && (o.name === 'mixamorig' + n || o.name === 'mixamorig:' + n || o.name === n)) f = o; });
  return f;
}
/** Set a bone's WORLD rotation: local = inv(parentWorld) * target, slerped by k. Call top-down. */
export function driveBone(bone: THREE.Object3D, targetWorld: THREE.Quaternion, k: number) {
  const parent = bone.parent!; parent.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(pq).invert();
  tmp.copy(targetWorld).premultiply(pq);
  bone.quaternion.slerp(tmp, k); bone.updateWorldMatrix(false, true);
}
