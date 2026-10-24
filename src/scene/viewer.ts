import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** WebGL2 renderer for Stage 1; WebGPU + post-fx arrive in the visual-polish stage. */
export class Viewer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; model?: THREE.Object3D;
  private loader = new GLTFLoader();
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x10131a);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100); this.camera.position.set(0, 1.3, 3.2);
    new OrbitControls(this.camera, canvas).target.set(0, 1, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 4, 3); key.castShadow = true; this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.scene.add(new THREE.GridHelper(6, 12, 0x333344, 0x222233));
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    addEventListener('resize', () => this.resize()); this.resize();
  }
  resize() { const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  async loadGLB(file: File): Promise<THREE.Object3D> {
    const gltf = await this.loader.parseAsync(await file.arrayBuffer(), '');
    if (this.model) { this.scene.remove(this.model); this.model.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
    const m = gltf.scene; const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    m.scale.setScalar(1.75 / size.y); // auto-scale to ~1.75 m
    const b2 = new THREE.Box3().setFromObject(m); m.position.y -= b2.min.y; m.position.x -= (b2.min.x + b2.max.x) / 2;
    m.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.scene.add(m); this.model = m; return m;
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
