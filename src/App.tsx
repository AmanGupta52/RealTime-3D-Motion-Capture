import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bone, Object3D } from 'three';
import { useStore } from './state/store';
import { SceneManager } from './scene/SceneManager';
import { PRESETS, Adaptive, presetFromFrameMs } from './scene/quality';
import type { BgAssets } from './scene/Backgrounds';
import { TrackingClient } from './tracking/TrackingClient';
import { listCameras, openCamera, openFile, stopStream } from './tracking/camera';
import { loadModel, SUPPORTED, type LoadedModel } from './loaders/loadModel';
import { Retargeter } from './retarget/Retargeter';
import { autoMap, type BoneKey } from './retarget/boneMap';
import { snapshotPose, type PoseSnapshot } from './retarget/pose';
import { MotionRecorder, Player, toBVH, toGLB, download, type Take } from './record/MotionRecorder';
import { drawOverlay } from './ui/overlay';
import { BackgroundPanel, LightingPanel, PostPanel, QualityPanel, MappingPanel, Slider, Check, Sel, Group } from './ui/Panels';
import { DEFAULTS, loadSettings, saveSettings, listProfiles, saveProfile, loadProfile, deleteProfile, type Settings } from './state/settings';
import * as store from './state/modelStore';

interface Entry { id: string; name: string; kind: 'url' | 'user'; url?: string; note: string }
/** Built-in models come from public/models/models.json. Only entries whose file really exists in that folder are listed. */
async function loadManifest(): Promise<Entry[]> {
  type Item = { name: string; path: string; type?: string };
  const toEntry = (m: Item): Entry | null => {
    const file = decodeURIComponent(m.path.split(/[\\/]/).pop() ?? '');
    return m.name && file ? { id: m.name, name: m.name, kind: 'url', url: `./models/${encodeURIComponent(file)}`, note: (m.type ?? file.split('.').pop() ?? '').toUpperCase() } : null;
  };
  try {
    // available.json is written by `npm run scan:models` (automatic in dev/build/desktop) and only lists files that exist,
    // so the app never probes for missing files (no 404 noise).
    const r = await fetch('./models/available.json');
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return ((await r.json()) as Item[]).map(toEntry).filter((e): e is Entry => !!e);
  } catch { /* fall through */ }
  try { // fallback: probe each file listed in models.json
    const r = await fetch('./models/models.json'); if (!r.ok) return [];
    const out: Entry[] = [];
    for (const m of (await r.json()) as Item[]) {
      const e = toEntry(m); if (!e) continue;
      const head = await fetch(e.url!, { method: 'HEAD' }).catch(() => null);
      if (head?.ok && !(head.headers.get('content-type') ?? '').includes('text/html')) out.push(e);
    }
    return out;
  } catch { return []; }
}
let BUILTIN: Entry[] = [], manifestDone = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Tab = 'model' | 'mocap' | 'background' | 'lighting' | 'post' | 'quality' | 'mapping' | 'settings';
const TABS: [Tab, string][] = [['model', 'Model'], ['mocap', 'Mocap'], ['background', 'Background'], ['lighting', 'Lighting'], ['post', 'Post-FX'], ['quality', 'Quality'], ['mapping', 'Bone map'], ['settings', 'Settings']];
const mapKey = (id: string) => `mocapstudio.map.${id}`;
const readMap = (id: string): Partial<Record<BoneKey, string>> => { try { return JSON.parse(localStorage.getItem(mapKey(id)) ?? '{}'); } catch { return {}; } };

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const sm = useRef(new SceneManager());
  const rt = useRef<Retargeter | null>(null), trk = useRef<TrackingClient | null>(null);
  const loaded = useRef<LoadedModel | null>(null), rest = useRef<PoseSnapshot | null>(null);
  const rec = useRef<MotionRecorder | null>(null), player = useRef<Player | null>(null);
  const assets = useRef<BgAssets>({}), adaptive = useRef(new Adaptive(50)), activeId = useRef(''), hint = useRef({ faceSeen: 0, legSeen: 0, shown: '' }), ovCache = useRef<{ leftImg: Float32Array | null; rightImg: Float32Array | null; faceImg: Float32Array | null }>({ leftImg: null, rightImg: null, faceImg: null });
  const { renderFps, trackingFps, latencyMs, status, error, set } = useStore();

  const [s, setS] = useState<Settings>(loadSettings);
  const sref = useRef(s); sref.current = s;
  const upd = useCallback((p: Partial<Settings>) => setS((prev) => { const n = { ...prev, ...p }; saveSettings(n); return n; }), []);
  const level = s.quality === 'auto' ? s.autoLevel : s.quality, q = PRESETS[level];
  const qref = useRef(q); qref.current = q;

  const [tab, setTab] = useState<Tab>('model'), [hide, setHide] = useState(false), [ready, setReady] = useState(false);
  const [models, setModels] = useState<Entry[]>([]), [active, setActive] = useState('');
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]), [source, setSource] = useState<'camera' | 'file'>('camera'), [vfile, setVfile] = useState<File | null>(null);
  const [running, setRunning] = useState(false), [count, setCount] = useState<number | null>(null), [camFail, setCamFail] = useState(false);
  const [recording, setRecording] = useState(false), [playing, setPlaying] = useState(false), [vrec, setVrec] = useState(false);
  const [takes, setTakes] = useState<Take[]>([]), [takeIdx, setTakeIdx] = useState(0);
  const [names, setNames] = useState<string[]>([]), [auto, setAuto] = useState<Partial<Record<BoneKey, string>>>({}), [mapping, setMapping] = useState<Partial<Record<BoneKey, string>>>({});
  const [assetRev, setAssetRev] = useState(0), [profiles, setProfiles] = useState<string[]>(listProfiles()), [profName, setProfName] = useState('');

  // ---------- model + retargeter ----------
  const buildRetargeter = useCallback((id: string) => {
    const m = loaded.current; if (!m) return;
    rest.current?.restore();
    const override: Partial<Record<BoneKey, Object3D | undefined>> = { ...m.boneMap };
    const saved = readMap(id);
    for (const [k, n] of Object.entries(saved) as [BoneKey, string][]) override[k] = n ? m.root.getObjectByName(n) ?? undefined : undefined;
    const r = new Retargeter(m.root, override as Partial<Record<BoneKey, Object3D>>, m.vrm);
    rt.current = r; syncRt();
    rec.current = new MotionRecorder(m.bones, r.hipsBone); player.current = new Player(m.bones, r.hipsBone);
    sm.current.followTarget = r.hipsBone ?? null;
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncRt = () => {
    const r = rt.current, c = sref.current; if (!r) return;
    r.mirror = c.mirror; r.smoothing = c.smoothing; r.sensitivity = c.sensitivity; r.mode = c.mode; r.ik = c.ik; r.legs = c.legs; r.rootMotion = c.rootMotion;
  };

  const attach = (m: LoadedModel, id: string) => {
    player.current?.stop(); setPlaying(false);
    sm.current.setModel(m.root);
    loaded.current = m; rest.current = snapshotPose(m.root); activeId.current = id;
    const objs: Object3D[] = []; m.root.traverse((o) => { if (o.name) objs.push(o); });
    objs.sort((a, b) => Number(!!(b as Bone).isBone) - Number(!!(a as Bone).isBone));
    setNames([...new Set(objs.map((o) => o.name))]);
    setAuto(Object.fromEntries(Object.entries(autoMap(m.root)).map(([k, o]) => [k, o!.name])) as Partial<Record<BoneKey, string>>);
    setMapping(readMap(id));
    return buildRetargeter(id);
  };

  const useEntry = async (e: Entry) => {
    try {
      set({ status: `loading ${e.name}`, error: null });
      let m: LoadedModel;
      {
        const src = e.kind === 'url' ? e.url! : await store.getModel(e.id);
        if (!src) throw new Error('Model file not found in the library.');
        m = await loadModel(src, (p) => set({ status: `loading ${Math.round(p * 100)}%` }), qref.current.texture);
      }
      const r = attach(m, e.id);
      let warn = m.warning ?? null;
      if (!warn && r?.missing.length) warn = `Could not auto-detect: ${r.missing.join(', ')}. Fix it in the "Bone map" tab.`;
      set({ status: `${e.name} ready (${r?.morphCount ?? 0} face morphs)`, error: warn });
      setActive(e.id); upd({ lastModel: e.id });
    } catch (err) { set({ error: (err as Error).message, status: 'idle' }); }
  };

  const refreshUser = useCallback(async () => {
    if (!manifestDone) { BUILTIN = await loadManifest(); manifestDone = true; }
    const n = await store.listModels().catch(() => [] as string[]);
    const list = [...BUILTIN, ...n.map((x): Entry => ({ id: x, name: x, kind: 'user', note: 'Imported model' }))];
    setModels(list); return list;
  }, []);
  const importModel = async (f?: File) => {
    if (!f) return;
    try { await store.saveModel(f); await refreshUser(); await useEntry({ id: f.name, name: f.name, kind: 'user', note: '' }); }
    catch (err) { set({ error: (err as Error).message }); }
  };
  const del = async (e: Entry) => { await store.deleteModel(e.id); await refreshUser(); if (active === e.id) { const first = BUILTIN[0]; if (first) await useEntry(first); } };

  // ---------- init ----------
  useEffect(() => {
    const sc = sm.current;
    sc.onFps = (f) => {
      set({ renderFps: Math.round(f) });
      if (sref.current.quality === 'auto') { const nl = adaptive.current.push(f, sref.current.autoLevel); if (nl) upd({ autoLevel: nl }); }
    };
    sc.onFrame = (dt) => {
      const r = rt.current; if (r) r.frameQ.copy(sc.holder.quaternion);
      if (player.current?.playing) player.current.update(dt); else r?.update(dt);
      rec.current?.sample(dt);
    };
    (async () => {
      await sc.init(canvas.current!);
      for (const k of ['image', 'video', 'hdri'] as const) { const b = await store.getRaw<Blob>(`asset:${k}`).catch(() => undefined); if (b) assets.current[k] = b; }
      sc.setQuality(PRESETS[sref.current.quality === 'auto' ? sref.current.autoLevel : sref.current.quality]);
      setReady(true);
      const list = await refreshUser();
      const tk = await store.keys('take:').catch(() => [] as string[]);
      setTakes((await Promise.all(tk.map((k) => store.getRaw<Take>(k)))).filter((x): x is Take => !!x));
      const first = list.find((m) => m.id === sref.current.lastModel) ?? list[0];
      if (first) await useEntry(first);
      else set({ status: 'no models found', error: 'No models found. Copy your model files into public/models/ (next to models.json), then restart the app.' });
      if (!sref.current.benchmarked) { // Auto preset: benchmark hardware on first launch
        set({ status: 'benchmarking your hardware…' });
        sc.setQuality(PRESETS.high);
        const lvl = presetFromFrameMs(await sc.measureFrameMs(40));
        sc.setQuality(PRESETS[lvl]); upd({ autoLevel: lvl, benchmarked: true }); set({ status: `hardware benchmark: ${lvl} preset` });
      }
    })().catch((e) => set({ error: String(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- settings -> scene / retargeter / tracker ----------
  useEffect(() => { document.documentElement.dataset.theme = s.theme; }, [s.theme]);
  useEffect(() => { if (s.quality === 'auto') adaptive.current.reset(); }, [s.quality]);
  useEffect(() => { if (ready) sm.current.setQuality(q); }, [level, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) sm.current.applyLook(s, q); }, [ready, level, s.light, s.post, s.view, s.bg.floor, s.bg.env3d, s.bg.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    const h = setTimeout(() => sm.current.bg.apply(s.bg, assets.current).catch((e) => set({ error: (e as Error).message })), 120);
    return () => clearTimeout(h);
  }, [ready, s.bg, assetRev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(syncRt, [s.mirror, s.smoothing, s.sensitivity, s.mode, s.ik, s.legs, s.rootMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = trk.current; if (!t) return;
    t.hands = s.hands && s.mode !== 'face'; t.face = s.face && s.mode !== 'hands'; t.overlay = s.overlay; t.maxFps = q.trackFps; t.handEvery = q.handEvery; t.faceEvery = q.faceEvery;
  }, [s.hands, s.face, s.mode, s.overlay, q.trackFps, q.handEvery, q.faceEvery]);
  useEffect(() => { if (tab === 'mocap') listCameras().then(setCams).catch(() => {}); }, [tab, running]);

  // ---------- mocap ----------
  const stop = () => {
    trk.current?.stop(); trk.current = null;
    if (video.current) stopStream(video.current);
    ov.current?.getContext('2d')?.clearRect(0, 0, ov.current.width, ov.current.height);
    setRunning(false); set({ status: 'stopped', trackingFps: 0, latencyMs: 0 });
  };
  const start = async () => {
    try {
      stop(); set({ error: null, status: 'starting input' }); setCamFail(false);
      try { // FIX: only genuine camera/input failures open the 'Camera problem' dialog (it used to regex-match any message containing e.g. 'https')
        if (source === 'file') { if (!vfile) throw new Error('Choose a video file first.'); await openFile(video.current!, vfile); }
        else await openCamera(video.current!, q.res, s.deviceId || undefined);
      } catch (e) { setCamFail(source === 'camera'); throw e; }
      set({ status: 'loading tracking models' });
      const t = new TrackingClient(q.complexity); trk.current = t;
      t.hands = s.hands && s.mode !== 'face'; t.face = s.face && s.mode !== 'hands'; t.overlay = s.overlay; t.maxFps = q.trackFps; t.handEvery = q.handEvery; t.faceEvery = q.faceEvery;
      let n = 0, t0 = performance.now();
      hint.current = { faceSeen: t0, legSeen: t0, shown: '' };
      let isReady = false;
      t.onReady = () => { isReady = true; set({ status: 'tracking' }); };
      t.onResult = (r, lat) => {
        const k = player.current?.playing ? null : rt.current; // FIX: live tracking overwrote the bones while a take was replaying
        k?.onFace(r.names, r.blend, r.faceMatrix, r.sent); k?.onHands(r.left, r.right, r.sent); k?.onPose(r.world, r.sent, r.poseKey);
        if (sref.current.overlay && ov.current && video.current) {
          const c = ovCache.current; // hands / face are not tracked on every frame: keep their last overlay on skipped frames
          if (r.handsRan) { c.leftImg = r.leftImg; c.rightImg = r.rightImg; }
          if (r.faceRan) c.faceImg = r.faceImg;
          drawOverlay(ov.current, video.current.videoWidth, video.current.videoHeight, { ...r, leftImg: c.leftImg, rightImg: c.rightImg, faceImg: c.faceImg });
        }
        { // tell the user when the face / legs are not being seen, instead of silently doing nothing
          const tn = performance.now(), h = hint.current, c = sref.current;
          if (r.blend) h.faceSeen = tn;
          if (r.world && [25, 26, 27, 28].some((i) => r.world![i * 4 + 3]! > 0.5)) h.legSeen = tn;
          const msg = c.face && c.mode !== 'hands' && tn - h.faceSeen > 5000 ? 'Face not detected: move closer (about 1 m) and face the camera'
            : c.legs && c.mode === 'full' && tn - h.legSeen > 5000 ? 'Legs not visible: step back so your whole body is in frame, or switch to Upper body' : '';
          if (msg !== h.shown) { h.shown = msg; set({ status: msg || 'tracking' }); }
        }
        n++; const now = performance.now();
        if (now - t0 >= 1000) { set({ trackingFps: Math.round((n * 1000) / (now - t0)), latencyMs: Math.round(lat) }); n = 0; t0 = now; }
      };
      t.onWarning = (m) => set({ error: m });
      t.onError = (m) => {
        // FIX: if the models fail to load the app used to sit on 'Stop' with the camera on and no tracking. Reset it instead.
        // Once running, per-frame errors are throttled and the watchdog recovers the loop, so tracking keeps going.
        if (!isReady) { stop(); set({ error: m, status: 'tracking could not start' }); } else set({ error: m });
      };
      t.start(video.current!); setRunning(true);
    } catch (e) { set({ error: (e as Error).message, status: 'idle' }); }
  };
  const calibrate = async () => {
    if (!running || count !== null) return;
    for (let n = 2; n > 0; n--) { setCount(n); await sleep(1000); }
    setCount(0); rt.current?.beginSample(); await sleep(600); rt.current?.endSample();
    setCount(null); set({ status: 'calibrated' });
  };

  // ---------- takes / export / capture ----------
  const take = takes[takeIdx];
  const toggleRec = async () => {
    const r = rec.current; if (!r) return;
    if (!recording) { if (playing) return; r.start(`take-${new Date().toTimeString().slice(0, 8).replace(/:/g, '-')}`); setRecording(true); set({ status: 'recording motion…' }); return; }
    const t = r.stop(); setRecording(false);
    if (t) { await store.putRaw(`take:${t.name}`, t); setTakes((p) => [...p, t]); setTakeIdx(takes.length); set({ status: `saved ${t.name} (${t.times.length} frames)` }); }
  };
  const togglePlay = () => {
    const p = player.current; if (!p) return;
    if (playing) { p.stop(); setPlaying(false); return; }
    if (!take || recording) return;
    try { p.play(take); setPlaying(true); } catch (e) { set({ error: (e as Error).message }); }
  };
  const exportAs = async (kind: 'bvh' | 'glb' | 'json') => {
    const m = loaded.current; if (!take || !m || !rest.current) return;
    try {
      if (kind === 'bvh') download(toBVH(take, m.bones, m.root, rest.current), `${take.name}.bvh`, 'text/plain');
      else if (kind === 'glb') download(await toGLB(take, m.bones, m.root, rest.current), `${take.name}.glb`, 'model/gltf-binary');
      else download(JSON.stringify(take), `${take.name}.json`, 'application/json');
    } catch (e) { set({ error: `Export failed: ${(e as Error).message}` }); }
  };
  const loadTake = async (f?: File) => {
    if (!f) return;
    try { const t = JSON.parse(await f.text()) as Take; if (!t.times || !t.quats) throw new Error('Not a take file.'); await store.putRaw(`take:${t.name}`, t); setTakes((p) => [...p, t]); setTakeIdx(takes.length); }
    catch (e) { set({ error: (e as Error).message }); }
  };
  const shot = async () => { const b = await sm.current.screenshot(); if (b) download(b, `mocap-${Date.now()}.png`); };
  const toggleVideo = async () => {
    if (!vrec) { try { sm.current.startVideo(); setVrec(true); } catch (e) { set({ error: (e as Error).message }); } return; }
    download(await sm.current.stopVideo(), `mocap-${Date.now()}.webm`, 'video/webm'); setVrec(false);
  };
  const upload = async (kind: 'image' | 'video' | 'hdri', f: File) => {
    assets.current[kind] = f; await store.putRaw(`asset:${kind}`, f).catch(() => {});
    upd({ bg: { ...s.bg, mode: kind, ...(kind === 'hdri' ? { hdri: 'file' as const } : {}) } }); setAssetRev((n) => n + 1);
  };
  const setMap = (k: BoneKey, name: string) => {
    const m = { ...mapping, [k]: name }; setMapping(m); localStorage.setItem(mapKey(activeId.current), JSON.stringify(m)); buildRetargeter(activeId.current);
  };
  const resetMap = () => { localStorage.removeItem(mapKey(activeId.current)); setMapping({}); buildRetargeter(activeId.current); };

  // ---------- shortcuts ----------
  const act = useRef<Record<string, () => void>>({});
  act.current = { ' ': () => (running ? stop() : start()), c: calibrate, r: toggleRec, p: togglePlay, s: shot, v: toggleVideo, m: () => upd({ mirror: !s.mirror }), h: () => setHide((x) => !x) };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      // FIX: held keys fired repeatedly (Space toggled Start/Stop many times). Space on a focused button already clicks it natively.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(tag) || (e.key === ' ' && /button/i.test(tag))) return;
      const f = act.current[e.key.toLowerCase()]; if (f) { e.preventDefault(); f(); }
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, []);

  const camProblem = !!error && camFail;
  return (
    <div className={`app ${hide ? 'hide' : ''}`}>
      <div className="top">
        <span className="logo">Mocap Studio</span>
        <span className="sp" />
        <button className="btn" onClick={calibrate} disabled={count !== null || !running} title="Calibrate (C)">Calibrate</button>
        {running ? <button className="fab stop" onClick={stop} title="Stop (Space)">Stop</button> : <button className="fab" onClick={start} title="Start (Space)">Start Mocap</button>}
      </div>
      <div className="main">
        <div className="side">
          <div className="tabs">{TABS.map(([t, l]) => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{l}</button>)}</div>
          {tab === 'model' && (<>
            <label className="btn primary">Import model
              <input type="file" accept={SUPPORTED.map((e) => `.${e}`).join(',')} hidden onChange={(e) => { importModel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <small className="tip">GLB · GLTF · VRM · FBX · OBJ · DAE · USDZ · ZIP (model + textures)</small>
            <div className="grid">{models.map((m) => (
              <div key={m.id} className={`mcard ${active === m.id ? 'on' : ''}`} onClick={() => useEntry(m)}>
                <b>{m.name}</b><small>{m.note}</small>
                {m.kind === 'user' && <button className="btn" onClick={(ev) => { ev.stopPropagation(); del(m); }}>Remove</button>}
              </div>))}</div>
            <Group title="Character transform">
              <Slider label="Scale" v={s.view.scale} min={0.3} max={3} on={(v) => upd({ view: { ...s.view, scale: v } })} />
              <Slider label="Position X" v={s.view.x} min={-3} max={3} on={(v) => upd({ view: { ...s.view, x: v } })} />
              <Slider label="Position Y" v={s.view.y} min={-1} max={2} on={(v) => upd({ view: { ...s.view, y: v } })} />
              <Slider label="Position Z" v={s.view.z} min={-3} max={3} on={(v) => upd({ view: { ...s.view, z: v } })} />
              <Slider label="Rotation" v={s.view.rotY} min={-180} max={180} step={1} on={(v) => upd({ view: { ...s.view, rotY: v } })} />
              <button className="btn" onClick={() => upd({ view: DEFAULTS.view })}>Reset transform</button>
            </Group>
            <Group title="Camera">
              <div className="grid"><button className="btn" onClick={() => sm.current.cameraPreset('front')}>Front</button><button className="btn" onClick={() => sm.current.cameraPreset('side')}>Side</button>
                <button className="btn" onClick={() => sm.current.cameraPreset('3/4')}>3/4</button></div>
              <Check label="Follow character" v={s.view.follow} on={(v) => upd({ view: { ...s.view, follow: v } })} />
            </Group>
          </>)}
          {tab === 'mocap' && (<>
            <Group title="Input">
              <Sel label="Source" v={source} on={(v) => setSource(v as 'camera' | 'file')} opts={[['camera', 'Camera'], ['file', 'Video file']]} />
              {source === 'camera'
                ? <Sel label="Camera" v={s.deviceId} on={(v) => upd({ deviceId: v })} opts={[['', 'Default'], ...cams.map((c): [string, string] => [c.deviceId, c.label || 'Camera'])]} />
                : <label className="btn">{vfile ? vfile.name : 'Choose video…'}<input type="file" accept="video/*" hidden onChange={(e) => setVfile(e.target.files?.[0] ?? null)} /></label>}
              <small className="tip">Resolution, body model and tracking FPS come from the Quality preset ({level}).</small>
            </Group>
            <Group title="Tracking">
              <Sel label="Mode" v={s.mode} on={(v) => upd({ mode: v as Settings['mode'] })} opts={[['full', 'Full body'], ['upper', 'Upper body (desk)'], ['hands', 'Hands only'], ['face', 'Face only']]} />
              <Check label="Face (478 pts + 52 blendshapes)" v={s.face} on={(v) => upd({ face: v })} />
              <Check label="Hands + fingers" v={s.hands} on={(v) => upd({ hands: v })} />
              <Check label="Legs" v={s.legs} on={(v) => upd({ legs: v })} tip="Unreliable when seated: use Upper body mode" />
              <Check label="IK (hands / feet land correctly)" v={s.ik} on={(v) => upd({ ik: v })} />
              <Check label="Root motion (hips follow you)" v={s.rootMotion} on={(v) => upd({ rootMotion: v })} />
              <Check label="Mirror mode (M)" v={s.mirror} on={(v) => upd({ mirror: v })} />
              <Slider label="Smoothing" v={s.smoothing} min={0} max={1} on={(v) => upd({ smoothing: v })} />
              <Slider label="Sensitivity" v={s.sensitivity} min={0.5} max={1.5} on={(v) => upd({ sensitivity: v })} tip="Amplitude of limb motion" />
            </Group>
            <Group title="Tips for best results">
              <small className="tip">Good, even lighting · plain background · full body visible (or use Upper body) · camera at chest height · 2–3 m away. Single-camera depth is estimated, occlusion can glitch, legs are unreliable when seated. Calibrate: humanoids in a T-pose, creatures with arms down.</small>
            </Group>
          </>)}
          {tab === 'background' && <BackgroundPanel bg={s.bg} set={(p) => upd({ bg: { ...s.bg, ...p } })} upload={upload} />}
          {tab === 'lighting' && <LightingPanel s={s} set={upd} />}
          {tab === 'post' && <PostPanel s={s} set={upd} />}
          {tab === 'quality' && <QualityPanel s={s} set={upd} level={level} />}
          {tab === 'mapping' && <MappingPanel names={names} mapping={mapping} auto={auto} onChange={setMap} onReset={resetMap} />}
          {tab === 'settings' && (<>
            <Sel label="Theme" v={s.theme} on={(v) => upd({ theme: v as Settings['theme'] })} opts={[['dark', 'Dark'], ['light', 'Light']]} />
            <Check label="Overlay on camera preview" v={s.overlay} on={(v) => upd({ overlay: v })} />
            <Group title="Profiles (all settings)">
              <div className="row"><input style={{ flex: 1 }} placeholder="Profile name" value={profName} onChange={(e) => setProfName(e.target.value)} />
                <button className="btn" onClick={() => { if (profName.trim()) { saveProfile(profName.trim(), s); setProfiles(listProfiles()); } }}>Save</button></div>
              {profiles.map((p) => (<div className="row" key={p}><span>{p}</span>
                <button className="btn" onClick={() => { const l = loadProfile(p); if (l) { setS(l); saveSettings(l); setAssetRev((n) => n + 1); } }}>Load</button>
                <button className="btn" onClick={() => { deleteProfile(p); setProfiles(listProfiles()); }}>Delete</button></div>))}
            </Group>
            <Group title="Keyboard shortcuts">
              <small className="tip"><kbd>Space</kbd> start/stop · <kbd>C</kbd> calibrate · <kbd>R</kbd> record motion · <kbd>P</kbd> play take · <kbd>S</kbd> screenshot · <kbd>V</kbd> video · <kbd>M</kbd> mirror · <kbd>H</kbd> hide panel</small>
            </Group>
            <button className="btn" onClick={() => { upd({ onboarded: false }); }}>Show the tutorial again</button>
          </>)}
        </div>
        <div className="view">
          <canvas ref={canvas} className="stage" />
          <div className="pip" style={{ display: running ? 'block' : 'none' }}><video ref={video} muted playsInline /><canvas ref={ov} /></div>
          <div className="hud">render {renderFps} fps · tracking {trackingFps} fps · latency {latencyMs} ms · {level}</div>
          <div className={`toast ${error && !camProblem ? 'err' : ''}`}>{camProblem ? status : error ?? status}</div>
          <div className="bar">
            <button className={`btn ${recording ? 'rec' : ''}`} onClick={toggleRec} disabled={playing} title="Record motion (R)">{recording ? '■ Stop rec' : '● Record'}</button>
            <button className="btn" onClick={togglePlay} disabled={!take || recording} title="Play take (P)">{playing ? '■ Stop' : '▶ Play'}</button>
            <select value={takeIdx} onChange={(e) => setTakeIdx(+e.target.value)} disabled={!takes.length}>
              {takes.length ? takes.map((t, i) => <option key={t.name + i} value={i}>{t.name} ({(t.times[t.times.length - 1] ?? 0).toFixed(1)}s)</option>) : <option>No takes</option>}</select>
            <button className="btn" onClick={() => exportAs('bvh')} disabled={!take} title="Export BVH">BVH</button>
            <button className="btn" onClick={() => exportAs('glb')} disabled={!take} title="Export animated GLB">GLB</button>
            <button className="btn" onClick={() => exportAs('json')} disabled={!take} title="Save take file">Save</button>
            <label className="btn" title="Load a saved take">Load<input type="file" accept=".json" hidden onChange={(e) => { loadTake(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <button className="btn" onClick={shot} title="Screenshot (S)">Screenshot</button>
            <button className={`btn ${vrec ? 'rec' : ''}`} onClick={toggleVideo} title="Record video (V)">{vrec ? '■ Stop video' : 'Video'}</button>
          </div>
          {count !== null && <div className="count">{count > 0 ? `Hold still in ${count}` : 'Hold still…'}</div>}
          {camProblem && (
            <div className="modal"><div className="card"><h3>Camera problem</h3><div className="err">{error}</div>
              <ul><li>Windows: Settings &rarr; Privacy &amp; security &rarr; Camera &rarr; allow desktop apps. macOS: System Settings &rarr; Privacy &amp; Security &rarr; Camera.</li><li>Close other apps that use the camera (Zoom, Teams, OBS).</li><li>Plug the camera in again, then retry.</li></ul>
              <div className="row"><button className="btn" onClick={() => set({ error: null })}>Dismiss</button><button className="fab" onClick={() => start()}>Retry</button></div></div></div>
          )}
          {!s.onboarded && (
            <div className="modal"><div className="card"><h3>Welcome to Mocap Studio</h3>
              <ul><li>Pick a model in <b>Model</b> (or import your own), then press <b>Start Mocap</b>.</li>
                <li>Stand 2–3 m from the camera in good light, then press <b>Calibrate</b> (T-pose for humanoids, arms down for creatures).</li>
                <li>Use <b>Record</b> to capture motion and export it as BVH or animated GLB.</li>
                <li>Change look and feel in Background, Lighting, Post-FX and Quality. Press <kbd>H</kbd> to hide the panel.</li></ul>
              <button className="fab" onClick={() => upd({ onboarded: true })}>Get started</button></div></div>
          )}
        </div>
      </div>
    </div>
  );
}
