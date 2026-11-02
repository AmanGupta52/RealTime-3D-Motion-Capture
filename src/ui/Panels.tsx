import type { ReactNode } from 'react';
import type { BgConfig, Settings } from '../state/settings';
import { PRESETS as BG_PRESETS } from '../scene/Backgrounds';
import { PRESETS as Q } from '../scene/quality';
import { MAP_KEYS, type BoneKey } from '../retarget/boneMap';

export const Slider = ({ label, v, min, max, step = 0.01, on, tip }: { label: string; v: number; min: number; max: number; step?: number; on: (n: number) => void; tip?: string }) => (
  <label className="fld" title={tip}><span>{label}<i>{Number.isInteger(step) ? v : v.toFixed(2)}</i></span>
    <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)} /></label>
);
export const Check = ({ label, v, on, tip }: { label: string; v: boolean; on: (b: boolean) => void; tip?: string }) => (
  <label className="row" title={tip}><span>{label}</span><input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} /></label>
);
export const Sel = ({ label, v, opts, on }: { label: string; v: string; opts: (string | [string, string])[]; on: (s: string) => void }) => (
  <label className="row"><span>{label}</span>
    <select value={v} onChange={(e) => on(e.target.value)}>{opts.map((o) => { const [val, text] = typeof o === 'string' ? [o, o] : o; return <option key={val} value={val}>{text}</option>; })}</select></label>
);
export const Col = ({ label, v, on }: { label: string; v: string; on: (s: string) => void }) => (
  <label className="row"><span>{label}</span><input type="color" value={v} onChange={(e) => on(e.target.value)} /></label>
);
export const Group = ({ title, children }: { title: string; children: ReactNode }) => <><h4>{title}</h4>{children}</>;
const File = ({ label, accept, on }: { label: string; accept: string; on: (f: File) => void }) => (
  <label className="btn">{label}<input type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) on(f); e.target.value = ''; }} /></label>
);

export function BackgroundPanel({ bg, set, upload }: { bg: BgConfig; set: (p: Partial<BgConfig>) => void; upload: (kind: 'image' | 'video' | 'hdri', f: File) => void }) {
  const m = bg.mode;
  return (<>
    <Sel label="Background" v={m} on={(v) => set({ mode: v as BgConfig['mode'] })} opts={[['preset', 'Preset'], ['solid', 'Solid color'], ['gradient', 'Gradient'], ['hdri', 'HDRI environment'], ['image', 'Image'], ['video', 'Video'], ['transparent', 'Transparent'], ['green', 'Green screen (#00FF00)']]} />
    {m === 'preset' && <Sel label="Preset" v={bg.preset} on={(v) => set({ preset: v })} opts={Object.keys(BG_PRESETS)} />}
    {m === 'solid' && <Col label="Color" v={bg.color} on={(v) => set({ color: v })} />}
    {m === 'gradient' && (<>
      <Sel label="Color stops" v={String(bg.stops)} on={(v) => set({ stops: +v as 2 | 3 })} opts={['2', '3']} />
      <Col label="Stop 1" v={bg.g1} on={(v) => set({ g1: v })} /><Col label="Stop 2" v={bg.g2} on={(v) => set({ g2: v })} />
      {bg.stops === 3 && <Col label="Stop 3" v={bg.g3} on={(v) => set({ g3: v })} />}
      <Slider label="Angle" v={bg.angle} min={0} max={360} step={1} on={(v) => set({ angle: v })} />
    </>)}
    {m === 'hdri' && (<>
      <Sel label="Source" v={bg.hdri} on={(v) => set({ hdri: v as 'room' | 'file' })} opts={[['room', 'Built-in studio'], ['file', 'Upload .hdr']]} />
      {bg.hdri === 'file' && <File label="Choose .hdr file" accept=".hdr" on={(f) => upload('hdri', f)} />}
      <Check label="HDRI also lights the model" v={bg.hdriLights} on={(v) => set({ hdriLights: v })} />
      <Slider label="Rotation" v={bg.rotation} min={0} max={360} step={1} on={(v) => set({ rotation: v })} />
    </>)}
    {m === 'image' && <File label="Choose image (JPG / PNG / WebP)" accept="image/jpeg,image/png,image/webp" on={(f) => upload('image', f)} />}
    {m === 'video' && <File label="Choose video (MP4 / WebM)" accept="video/mp4,video/webm" on={(f) => upload('video', f)} />}
    {(m === 'image' || m === 'video') && <Sel label="Fit" v={bg.fit} on={(v) => set({ fit: v as BgConfig['fit'] })} opts={[['cover', 'Fill (crop)'], ['contain', 'Fit (letterbox)'], ['stretch', 'Stretch']]} />}
    {!['transparent', 'green'].includes(m) && (<>
      <Slider label="Brightness" v={bg.brightness} min={0.1} max={2} on={(v) => set({ brightness: v })} />
      {['hdri', 'image', 'video'].includes(m) && <Slider label="Blur" v={bg.blur} min={0} max={1} on={(v) => set({ blur: v })} />}
    </>)}
    {m === 'green' && <small className="tip">Key out #00FF00 in OBS (Filters &rarr; Chroma Key), capturing this window.</small>}
    {m === 'transparent' && <small className="tip">Alpha is kept for screenshots; post-processing is bypassed in this mode.</small>}
    <Group title="3D environment">
      <Sel label="Floor" v={bg.floor} on={(v) => set({ floor: v as BgConfig['floor'] })} opts={[['none', 'None'], ['grid', 'Grid'], ['glossy', 'Reflective (env)']]} />
      <Sel label="Set" v={bg.env3d} on={(v) => set({ env3d: v as BgConfig['env3d'] })} opts={[['none', 'None'], ['room', 'Simple room'], ['stage', 'Stage']]} />
    </Group>
  </>);
}

export function LightingPanel({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const L = s.light, u = (p: Partial<Settings['light']>) => set({ light: { ...L, ...p } });
  return (<>
    <Slider label="Key light" v={L.key} min={0} max={2} on={(v) => u({ key: v })} />
    <Col label="Key color" v={L.keyColor} on={(v) => u({ keyColor: v })} />
    <Slider label="Fill light" v={L.fill} min={0} max={2} on={(v) => u({ fill: v })} />
    <Slider label="Rim light" v={L.rim} min={0} max={2} on={(v) => u({ rim: v })} />
    <Slider label="Ambient / environment" v={L.ambient} min={0} max={2} on={(v) => u({ ambient: v })} />
    <Check label="Soft shadows + ground shadow" v={L.shadows} on={(v) => u({ shadows: v })} />
  </>);
}

export function PostPanel({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const P = s.post, u = (p: Partial<Settings['post']>) => set({ post: { ...P, ...p } });
  return (<>
    <Check label="Bloom (arc reactor glow)" v={P.bloom} on={(v) => u({ bloom: v })} />
    {P.bloom && (<><Slider label="Strength" v={P.bloomStrength} min={0} max={2} on={(v) => u({ bloomStrength: v })} />
      <Slider label="Radius" v={P.bloomRadius} min={0} max={1} on={(v) => u({ bloomRadius: v })} />
      <Slider label="Threshold" v={P.bloomThreshold} min={0} max={1} on={(v) => u({ bloomThreshold: v })} /></>)}
    <Check label="SSAO (ambient occlusion)" v={P.ssao} on={(v) => u({ ssao: v })} />
    <Check label="Anti-aliasing (SMAA)" v={P.smaa} on={(v) => u({ smaa: v })} />
    <Check label="Depth of field" v={P.dof} on={(v) => u({ dof: v })} />
    {P.dof && <Slider label="Focus distance" v={P.dofFocus} min={0.5} max={10} on={(v) => u({ dofFocus: v })} />}
    <Slider label="Vignette" v={P.vignette} min={0} max={1} on={(v) => u({ vignette: v })} />
    <small className="tip">Effects that the current quality preset disables are skipped automatically.</small>
  </>);
}

export function QualityPanel({ s, set, level }: { s: Settings; set: (p: Partial<Settings>) => void; level: string }) {
  const q = Q[level as keyof typeof Q];
  return (<>
    <Sel label="Quality" v={s.quality} on={(v) => set({ quality: v as Settings['quality'] })} opts={[['auto', 'Auto (adaptive)'], 'low', 'medium', 'high', 'ultra']} />
    <small className="tip">Active level: <b>{level}</b>. Auto benchmarks your PC on first launch, then lowers or raises the level to hold the target FPS.</small>
    <table className="qt"><tbody>
      <tr><td>Body model</td><td>{q.complexity}</td></tr><tr><td>Camera</td><td>{q.res}</td></tr><tr><td>Tracking FPS</td><td>{q.trackFps}</td></tr>
      <tr><td>Pixel ratio</td><td>{q.pixelRatio}</td></tr><tr><td>Shadow map</td><td>{q.shadow}</td></tr>
      <tr><td>Bloom / SSAO / SMAA</td><td>{[q.bloom, q.ssao, q.smaa].map((b) => (b ? 'on' : 'off')).join(' / ')}</td></tr>
      <tr><td>Max texture</td><td>{q.texture}px</td></tr>
    </tbody></table>
    <small className="tip">Camera, body model and texture size apply the next time you Start Mocap / load a model.</small>
  </>);
}

export function MappingPanel({ names, mapping, auto, onChange, onReset }: {
  names: string[]; mapping: Partial<Record<BoneKey, string>>; auto: Partial<Record<BoneKey, string>>;
  onChange: (k: BoneKey, name: string) => void; onReset: () => void;
}) {
  return (<>
    <small className="tip">Auto-detected bones are pre-selected. Change any dropdown to correct the mapping; it is saved for this model.</small>
    {MAP_KEYS.map((k) => (
      <label className="row" key={k}><span>{k}</span>
        <select value={mapping[k] ?? auto[k] ?? ''} onChange={(e) => onChange(k, e.target.value)}>
          <option value="">(none)</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    ))}
    <button className="btn" onClick={onReset}>Reset to auto-detect</button>
  </>);
}
