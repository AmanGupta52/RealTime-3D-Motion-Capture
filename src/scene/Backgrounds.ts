import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { BgConfig } from '../state/settings';

export const PRESETS: Record<string, string[]> = {
  studio: ['#eef1f6', '#aeb8c8'], 'dark void': ['#050507'], sunset: ['#2b1055', '#d4507a', '#ffb26b'],
  'city night': ['#050a1e', '#16275a', '#6b2f8f'], space: ['#000008', '#0a0a2a'], forest: ['#0a1f12', '#2c6b3a', '#8fbf7a'],
  'neon room': ['#12002b', '#8a00c8', '#00e5ff'],
};
export interface BgAssets { image?: Blob; video?: Blob; hdri?: Blob }

/** Switches backgrounds instantly (no reload) and disposes the previous textures, videos and blob URLs. */
export class BackgroundManager {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.Texture | null = null; private env: THREE.Texture | null = null;
  private media: HTMLImageElement | HTMLVideoElement | null = null; private url: string | null = null;
  private pmrem: THREE.PMREMGenerator; private room: THREE.Texture;
  private cfg: BgConfig | null = null; private w = 1280; private h = 720;
  private starsSeed = 7;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.room = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // built-in studio lighting (no download)
    this.canvas.width = this.w; this.canvas.height = this.h;
  }

  resize(w: number, h: number) {
    const s = Math.min(1, 1280 / Math.max(1, w));
    this.w = Math.max(2, Math.round(w * s)); this.h = Math.max(2, Math.round(h * s));
    this.canvas.width = this.w; this.canvas.height = this.h;
    if (this.tex) { this.draw(); this.tex.needsUpdate = true; }
  }

  private disposeCurrent() {
    this.tex?.dispose(); this.tex = null; this.env?.dispose(); this.env = null;
    if (this.media instanceof HTMLVideoElement) { this.media.pause(); this.media.removeAttribute('src'); this.media.load(); }
    this.media = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }

  async apply(cfg: BgConfig, assets: BgAssets) {
    this.cfg = cfg; this.disposeCurrent();
    const sc = this.scene;
    sc.backgroundBlurriness = 0; sc.backgroundIntensity = 1;
    sc.backgroundRotation.set(0, 0, 0); sc.environmentRotation.set(0, 0, 0);
    sc.environment = this.room;
    switch (cfg.mode) {
      case 'solid': sc.background = new THREE.Color(cfg.color).multiplyScalar(cfg.brightness); break;
      case 'green': sc.background = new THREE.Color(0x00ff00); break;       // chroma key for OBS
      case 'transparent': sc.background = null; break;
      case 'gradient': case 'preset': this.useCanvas(); break;
      case 'image': {
        if (!assets.image) throw new Error('Upload an image first.');
        const img = new Image(); this.url = URL.createObjectURL(assets.image); img.src = this.url; await img.decode();
        this.media = img; this.useCanvas(); break;
      }
      case 'video': {
        if (!assets.video) throw new Error('Upload a video first.');
        const v = document.createElement('video'); this.url = URL.createObjectURL(assets.video);
        v.src = this.url; v.loop = true; v.muted = true; v.playsInline = true; await v.play();
        this.media = v; this.useCanvas(); break;
      }
      case 'hdri': {
        let bg: THREE.Texture = this.room;
        if (cfg.hdri === 'file') {
          if (!assets.hdri) throw new Error('Upload an .hdr file first.');
          this.url = URL.createObjectURL(assets.hdri);
          const eq = await new RGBELoader().loadAsync(this.url);
          eq.mapping = THREE.EquirectangularReflectionMapping; this.env = eq; bg = eq;
        }
        sc.background = bg;
        sc.environment = cfg.hdriLights ? bg : null;               // separate toggle: does the HDRI also light the model?
        sc.backgroundBlurriness = cfg.blur; sc.backgroundIntensity = cfg.brightness;
        sc.backgroundRotation.y = sc.environmentRotation.y = THREE.MathUtils.degToRad(cfg.rotation);
        break;
      }
    }
  }

  private useCanvas() {
    this.draw();
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.tex;
  }

  /** Call every frame: video backgrounds re-draw (fit/blur/brightness applied on the 2D canvas). */
  update() {
    if (this.media instanceof HTMLVideoElement && this.tex) { this.draw(); this.tex.needsUpdate = true; }
  }

  private draw() {
    const c = this.cfg, g = this.ctx, w = this.w, h = this.h;
    if (!c) return;
    g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (this.media) {
      const sw = this.media instanceof HTMLVideoElement ? this.media.videoWidth : this.media.naturalWidth;
      const sh = this.media instanceof HTMLVideoElement ? this.media.videoHeight : this.media.naturalHeight;
      if (!sw || !sh) return;
      g.filter = `brightness(${c.brightness}) blur(${Math.round(c.blur * 24)}px)`;
      if (c.fit === 'stretch') g.drawImage(this.media, 0, 0, w, h);
      else {
        const s = c.fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
        g.drawImage(this.media, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
      }
      g.filter = 'none'; return;
    }
    const stops = c.mode === 'preset' ? PRESETS[c.preset] ?? PRESETS.studio! : [c.g1, c.g2, c.g3].slice(0, c.stops);
    const a = THREE.MathUtils.degToRad(c.mode === 'preset' ? 160 : c.angle);               // CSS-style angle (0 = to top)
    const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)), cx = w / 2, cy = h / 2;
    const gr = g.createLinearGradient(cx - Math.sin(a) * len / 2, cy + Math.cos(a) * len / 2, cx + Math.sin(a) * len / 2, cy - Math.cos(a) * len / 2);
    stops.forEach((col, i) => gr.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), col));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (c.mode === 'preset' && c.preset === 'space') {
      let r = this.starsSeed; g.fillStyle = '#fff';
      for (let i = 0; i < 260; i++) { r = (r * 16807) % 2147483647; const x = (r % 1000) / 1000 * w; r = (r * 16807) % 2147483647; const y = (r % 1000) / 1000 * h; g.globalAlpha = 0.3 + (i % 7) / 10; g.fillRect(x, y, 1.5, 1.5); }
      g.globalAlpha = 1;
    }
    if (c.brightness !== 1) { g.fillStyle = c.brightness < 1 ? `rgba(0,0,0,${1 - c.brightness})` : `rgba(255,255,255,${Math.min(1, c.brightness - 1)})`; g.fillRect(0, 0, w, h); }
  }
}
