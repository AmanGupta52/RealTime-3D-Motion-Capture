export interface BgConfig {
  mode: 'solid' | 'gradient' | 'preset' | 'hdri' | 'image' | 'video' | 'transparent' | 'green';
  color: string; stops: 2 | 3; g1: string; g2: string; g3: string; angle: number; preset: string;
  hdri: 'room' | 'file'; blur: number; brightness: number; rotation: number; hdriLights: boolean;
  fit: 'cover' | 'contain' | 'stretch'; floor: 'none' | 'grid' | 'glossy'; env3d: 'none' | 'room' | 'stage';
}
export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export interface Settings {
  theme: 'dark' | 'light'; onboarded: boolean; benchmarked: boolean; lastModel: string;
  deviceId: string; mode: 'full' | 'upper' | 'hands' | 'face';
  mirror: boolean; smoothing: number; sensitivity: number;
  hands: boolean; face: boolean; legs: boolean; ik: boolean; rootMotion: boolean; overlay: boolean;
  bg: BgConfig;
  light: { key: number; fill: number; rim: number; ambient: number; shadows: boolean; keyColor: string };
  post: { bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number; ssao: boolean; smaa: boolean; dof: boolean; dofFocus: number; vignette: number };
  quality: 'auto' | Preset; autoLevel: Preset;
  view: { scale: number; x: number; y: number; z: number; rotY: number; follow: boolean };
}
export const DEFAULTS: Settings = {
  theme: 'dark', onboarded: false, benchmarked: false, lastModel: '', deviceId: '', mode: 'full',
  mirror: false, smoothing: 0.5, sensitivity: 1, hands: true, face: true, legs: true, ik: true, rootMotion: false, overlay: true,
  bg: { mode: 'preset', color: '#14171f', stops: 2, g1: '#1b2540', g2: '#6b2f8f', g3: '#ff7e5f', angle: 160, preset: 'studio',
    hdri: 'room', blur: 0.3, brightness: 1, rotation: 0, hdriLights: true, fit: 'cover', floor: 'grid', env3d: 'none' },
  light: { key: 1, fill: 0.5, rim: 0.7, ambient: 0.8, shadows: true, keyColor: '#ffffff' },
  post: { bloom: true, bloomStrength: 0.5, bloomRadius: 0.4, bloomThreshold: 0.85, ssao: false, smaa: true, dof: false, dofFocus: 3.2, vignette: 0.25 },
  quality: 'auto', autoLevel: 'medium',
  view: { scale: 1, x: 0, y: 0, z: 0, rotY: 0, follow: false },
};
const KEY = 'mocapstudio.settings.v2', PROF = 'mocapstudio.profiles.v1';
const merge = (d: Settings, s: Partial<Settings>): Settings => ({
  ...d, ...s, bg: { ...d.bg, ...s.bg }, light: { ...d.light, ...s.light }, post: { ...d.post, ...s.post }, view: { ...d.view, ...s.view },
});
export function loadSettings(): Settings {
  try { return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return DEFAULTS; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }

// Named settings profiles (full settings snapshots)
const readProfiles = (): Record<string, Settings> => { try { return JSON.parse(localStorage.getItem(PROF) ?? '{}'); } catch { return {}; } };
export const listProfiles = () => Object.keys(readProfiles());
export const saveProfile = (name: string, s: Settings) => localStorage.setItem(PROF, JSON.stringify({ ...readProfiles(), [name]: s }));
export const loadProfile = (name: string): Settings | null => { const p = readProfiles()[name]; return p ? merge(DEFAULTS, p) : null; };
export const deleteProfile = (name: string) => { const p = readProfiles(); delete p[name]; localStorage.setItem(PROF, JSON.stringify(p)); };
