import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { BackgroundManager } from './Backgrounds';
import { initKtx2 } from '../loaders/loadModel';
import type { Settings } from '../state/settings';
import { PRESETS, type Quality } from './quality';

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.25 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); float d=distance(vUv,vec2(0.5)); c.rgb*=1.0-smoothstep(0.35,0.85,d)*amount; gl_FragColor=c; }',
};

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  readonly holder = new THREE.Group(); // user-controlled scale / position / rotation of the character
  renderer!: THREE.WebGLRenderer; controls!: OrbitControls; composer!: EffectComposer; bg!: BackgroundManager;
  followTarget: THREE.Object3D | null = null; follow = false;
  onFps: (fps: number) => void = () => {};
  onFrame: (dt: number) => void = () => {};
  private quality: Quality = PRESETS.medium;
  private p!: { ssao: SSAOPass; bokeh: BokehPass; bloom: UnrealBloomPass; vignette: ShaderPass; smaa: SMAAPass };
  private key = new THREE.DirectionalLight(); private fill = new THREE.DirectionalLight(); private rim = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 1);
  private catcher!: THREE.Mesh; private grid!: THREE.GridHelper; private glossy!: THREE.Mesh; private room = new THREE.Group(); private stage = new THREE.Group();
  private model: THREE.Object3D | null = null; private direct = false;
  private frames = 0; private last = performance.now(); private prev = performance.now(); private tmp = new THREE.Vector3();
  private w = 1; private h = 1; private shot: ((b: Blob | null) => void) | null = null;
  private rec: MediaRecorder | null = null; private chunks: Blob[] = [];

  async init(canvas: HTMLCanvasElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    initKtx2(r);
    this.bg = new BackgroundManager(this.scene, r);
    this.camera.position.set(0, 1.4, 3.2);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.target.set(0, 1, 0); this.controls.enableDamping = true;

    this.key.position.set(2.5, 4, 3); this.key.shadow.camera.left = -3; this.key.shadow.camera.right = 3;
    this.key.shadow.camera.top = 4; this.key.shadow.camera.bottom = -1; this.key.shadow.bias = -0.0005;
    this.fill.position.set(-3, 2, 2); this.rim.position.set(0, 3, -4);
    this.scene.add(this.hemi, this.key, this.fill, this.rim, this.holder);

    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.catcher.rotation.x = -Math.PI / 2; this.catcher.position.y = 0.001; this.catcher.receiveShadow = true;
    this.grid = new THREE.GridHelper(10, 20, 0x667089, 0x3a4152);
    this.glossy = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.15, metalness: 0.6 }));
    this.glossy.rotation.x = -Math.PI / 2; this.glossy.position.y = -0.002; this.glossy.receiveShadow = true;
    const room = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f3b, side: THREE.BackSide, roughness: 0.9 }));
    room.position.y = 2; this.room.add(room);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.15, 48), new THREE.MeshStandardMaterial({ color: 0x20232c, roughness: 0.4, metalness: 0.4 }));
    plat.position.y = -0.075; plat.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshStandardMaterial({ color: 0x191c25, roughness: 0.8 }));
    wall.position.set(0, 2, -2.6); this.stage.add(plat, wall);
    this.scene.add(this.catcher, this.grid, this.glossy, this.room, this.stage);

    const c = this.composer = new EffectComposer(r);
    c.addPass(new RenderPass(this.scene, this.camera));
    const ssao = new SSAOPass(this.scene, this.camera, 1, 1); ssao.kernelRadius = 0.3; ssao.minDistance = 0.001; ssao.maxDistance = 0.1; c.addPass(ssao);
    const bokeh = new BokehPass(this.scene, this.camera, { focus: 3.2, aperture: 0.0002, maxblur: 0.01 }); c.addPass(bokeh);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.85); c.addPass(bloom);
    c.addPass(new OutputPass());                                    // tone mapping (ACES) + sRGB
    const vignette = new ShaderPass(VIGNETTE); c.addPass(vignette);
    const smaa = new SMAAPass(1, 1); c.addPass(smaa);
    this.p = { ssao, bokeh, bloom, vignette, smaa };

    const resize = () => { const el = canvas.parentElement!; this.resize(el.clientWidth, el.clientHeight); };
    new ResizeObserver(resize).observe(canvas.parentElement!); resize();
    r.setAnimationLoop(() => this.frame());
  }

  resize(w: number, h: number) {
    this.w = Math.max(2, w); this.h = Math.max(2, h);
    const pr = this.quality.pixelRatio;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(this.w, this.h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(this.w, this.h);
    this.camera.aspect = this.w / this.h; this.camera.updateProjectionMatrix();
    this.bg.resize(this.w, this.h);
  }

  /** Render-side quality (pixel ratio, shadow resolution). Post-fx flags are applied in applyLook. */
  setQuality(q: Quality) {
    this.quality = q;
    this.key.shadow.mapSize.set(q.shadow, q.shadow); this.key.shadow.map?.dispose(); this.key.shadow.map = null;
    if (this.renderer) this.resize(this.w, this.h);
  }

  /** Lighting, post-processing, floor, 3D environment, character transform and camera follow. */
  applyLook(s: Settings, q: Quality = this.quality) {
    const L = s.light, P = s.post, mode = s.bg.mode;
    this.key.intensity = L.key * 3; this.key.color.set(L.keyColor); this.fill.intensity = L.fill * 1.5; this.rim.intensity = L.rim * 3;
    this.hemi.intensity = L.ambient * 0.5; this.scene.environmentIntensity = L.ambient;
    const sh = L.shadows && q.shadow > 0;
    this.renderer.shadowMap.enabled = sh; this.key.castShadow = sh; this.catcher.visible = sh;
    this.direct = mode === 'transparent' || mode === 'green';   // keeps alpha / exact chroma green: skip the post chain
    this.renderer.toneMapping = mode === 'green' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, mode === 'transparent' ? 0 : 1);
    const p = this.p;
    p.bloom.enabled = P.bloom && q.bloom; p.bloom.strength = P.bloomStrength; p.bloom.radius = P.bloomRadius; p.bloom.threshold = P.bloomThreshold;
    p.ssao.enabled = P.ssao && q.ssao; p.smaa.enabled = P.smaa && q.smaa;
    p.bokeh.enabled = P.dof; (p.bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms['focus']!.value = P.dofFocus;
    p.vignette.enabled = P.vignette > 0 && (q.bloom || q.smaa); // PERF: the light vignette alone no longer forces the Low preset through the post-processing chain p.vignette.uniforms['amount']!.value = P.vignette;
    // PERF: with no post effect enabled (e.g. the Low preset) the EffectComposer only added an extra full-screen HDR pass.
    // Render straight to the screen instead (hardware MSAA, same tone mapping): noticeably faster on weaker GPUs.
    const anyPost = p.bloom.enabled || p.ssao.enabled || p.smaa.enabled || p.bokeh.enabled || p.vignette.enabled;
    this.direct = mode === 'transparent' || mode === 'green' || !anyPost;
    this.grid.visible = s.bg.floor === 'grid'; this.glossy.visible = s.bg.floor === 'glossy';
    this.room.visible = s.bg.env3d === 'room'; this.stage.visible = s.bg.env3d === 'stage';
    const v = s.view;
    this.holder.scale.setScalar(v.scale); this.holder.position.set(v.x, v.y, v.z); this.holder.rotation.y = THREE.MathUtils.degToRad(v.rotY);
    this.follow = v.follow;
  }

  setModel(root: THREE.Object3D) {
    if (this.model) { this.holder.remove(this.model); this.disposeTree(this.model); }
    this.model = root; this.holder.add(root);
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  }

  cameraPreset(name: 'front' | 'side' | '3/4') {
    const pos = name === 'front' ? [0, 1.4, 3.2] : name === 'side' ? [3.2, 1.4, 0] : [2.3, 1.5, 2.3];
    this.camera.position.set(pos[0]!, pos[1]!, pos[2]!); this.controls.target.set(0, 1, 0);
  }

  screenshot(): Promise<Blob | null> { return new Promise((res) => { this.shot = res; }); }
  startVideo() {
    const stream = this.renderer.domElement.captureStream(60); this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
  }
  stopVideo(): Promise<Blob> {
    return new Promise((res) => { const r = this.rec!; r.onstop = () => res(new Blob(this.chunks, { type: 'video/webm' })); r.stop(); this.rec = null; });
  }
  get videoRecording() { return !!this.rec; }

  /** Average frame time (ms) over `frames` rendered frames; used by the Auto quality benchmark. */
  measureFrameMs(frames = 40): Promise<number> {
    return new Promise((res) => {
      let n = 0, t0 = 0; const prevHook = this.onFrame;
      this.onFrame = (dt) => { prevHook(dt); if (n === 5) t0 = performance.now(); if (++n >= frames + 5) { this.onFrame = prevHook; res((performance.now() - t0) / frames); } };
    });
  }

  private frame() {
    const t = performance.now(), dt = Math.min((t - this.prev) / 1000, 0.1); this.prev = t;
    this.onFrame(dt); this.bg.update();
    if (this.follow && this.followTarget) {
      this.followTarget.getWorldPosition(this.tmp); this.tmp.y = Math.max(0.8, this.tmp.y * 0.9);
      this.controls.target.lerp(this.tmp, 0.08);
    }
    this.controls.update();
    if (this.direct) this.renderer.render(this.scene, this.camera); else this.composer.render(dt);
    if (this.shot) { const cb = this.shot; this.shot = null; this.renderer.domElement.toBlob((b) => cb(b), 'image/png'); }
    this.frames++;
    if (t - this.last >= 1000) { this.onFps((this.frames * 1000) / (t - this.last)); this.frames = 0; this.last = t; }
  }

  private disposeTree(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh; if (!m.isMesh) return;
      m.geometry.dispose();
      (m as THREE.SkinnedMesh).skeleton?.dispose(); // PERF: free the bone texture, or every model switch leaked GPU memory
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
        Object.values(mt).forEach((v) => {
          const t = v as THREE.Texture; if (!t?.isTexture) return;
          t.dispose(); (t.image as { close?: () => void } | undefined)?.close?.(); // also release the decoded bitmap
        });
        mt.dispose();
      });
    });
  }
}
