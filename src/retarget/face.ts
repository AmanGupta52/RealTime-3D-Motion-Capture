import * as THREE from 'three';

/** Drives ARKit-named morph targets (eyeBlinkLeft, jawOpen, mouthSmileRight…) from MediaPipe's 52 blendshapes. */
export class FaceSolver {
  private targets: { mesh: THREE.Mesh; map: Map<string, number> }[] = [];
  /** Returns the number of distinct blendshape names found on the model. */
  bind(root: THREE.Object3D): number {
    this.targets = []; const names = new Set<string>();
    root.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh || !m.morphTargetDictionary) return;
      const map = new Map<string, number>();
      for (const [k, i] of Object.entries(m.morphTargetDictionary)) { map.set(k.toLowerCase(), i); names.add(k.toLowerCase()); }
      this.targets.push({ mesh: m, map });
    });
    return names.size;
  }
  static swapSide(n: string) { return n.replace(/Left$/, '§').replace(/Right$/, 'Left').replace(/§$/, 'Right'); }
  apply(scores: Record<string, number>, mirror: boolean, smoothing: number, dt = 1 / 60) {
    if (!this.targets.length) return;
    const k = 1 - Math.pow(smoothing * 0.8, Math.max(dt, 1e-3) * 60);
    for (const name in scores) {
      const key = (mirror ? FaceSolver.swapSide(name) : name).toLowerCase(), v = scores[name];
      for (const t of this.targets) {
        const i = t.map.get(key); if (i === undefined) continue;
        const inf = t.mesh.morphTargetInfluences!; inf[i] += (v - inf[i]) * k;
      }
    }
  }
}
