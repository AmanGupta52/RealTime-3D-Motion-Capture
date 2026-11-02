# Mocap Studio

Real-time webcam 3D motion capture as a native desktop app (Electron). Tracks body, hands, fingers and face with one webcam
and drives a rigged 3D character (humanoid, VRM or stylised creature) with smoothing, IK, recording and export.

## Run (Windows / macOS / Linux, Node 18+)
    npm install           # also copies MediaPipe WASM, Draco and KTX2 decoders and downloads the tracking models once
    npm run desktop       # build and open the desktop app
    npm run desktop:dev   # development with hot reload
    npm run package       # Windows installer (electron-builder)
    npm test              # filters, retargeting, IK, hands, face, recorder/BVH tests
    npm run build         # strict TypeScript check + production bundle
After the first install the app works fully offline. If a model download fails, `npm run setup:assets` retries; until then it falls back to the CDN.

## Updating
1. Replace the project files with the new version (keep your own `public/models` if you added models).
2. `npm install` (also refreshes the MediaPipe WASM/Draco/KTX2 files and retries missing model downloads).
3. `npm test` and `npm run build` should both finish with no errors.
4. `npm run desktop` to run it, or `npm run package` to build a new Windows installer (`npm run package:mac` on a Mac).
Your settings, imported models and recorded takes are stored by the app itself and survive an update.
See `CHANGELOG.md` for what changed in each version.

## If tracking says "could not start"
Run `npm run setup:assets` once with internet access. It downloads the five MediaPipe `.task` models into `public/mediapipe/`.
Then `npm run desktop` again. Set `MOCAP_DEVTOOLS=1` before launching to open the developer console.

## Your models (the model list)
The Model tab lists exactly the models in `public/models/models.json`: Ashtra, Hanako, VAL, Sendagaya, Amaris, Natsuki, IceDwen, Mousey, Vanguard.
1. Copy the files into `public/models/`: `test.vrm`, `three-vrm-girl.vrm`, `VAL.vrm`, `shibu_sendagaya.vrm`, `SampleA.vrm`, `SampleB.vrm`, `bdd.glb`, `Mousey.fbx`, `Vanguard.fbx`.
2. Run `npm run desktop`. It scans the folder first and prints which models were found and which files are still missing. A model only appears once its file is in the folder.
3. To add another model later, copy its file there and add an entry (`name`, `path`, `type`) to `models.json`.
Only `name`, `path` and `type` are used; the bone binding is detected automatically. The Import button still works for one-off files.

## Face and leg tips
- **Face:** MediaPipe needs a face that is large enough in the picture. Stand or sit about **1 m** from the camera and face it. For face-only work choose the **Face** or **Upper body** mode in the Mocap tab. At full-body distance (2-3 m) the face is usually too small to read.
- **Legs:** a leg only moves when the camera can see it. Keep your whole body in frame (feet included), good light, and avoid long loose clothing. Use **Upper body** when sitting.
- **What a model needs for a mouth:** VRM expressions, ARKit morph targets (jawOpen, eyeBlinkLeft...), a common alternative name (mouthOpen, Blink_L, visemes) or a bone named like `Jaw`. A model with none of these (for example IceDwen) can only turn its head and move or blink its eye bones.

## Features
- **Tracking:** MediaPipe Tasks Vision in a Web Worker (GPU delegate, CPU fallback): pose (33 world landmarks), hands (21 each), face (478 landmarks, 52 blendshapes, head matrix). One Euro smoothing, render-rate interpolation.
- **Retargeting:** per-bone direction aiming in world space, T-pose calibration, FABRIK IK for arms and legs, elbow/knee/spine/neck limits, foot locking, optional root motion, modes (full / upper body / hands / face), mirror, smoothing + sensitivity.
- **Models:** GLB, GLTF, VRM, FBX, OBJ, DAE, USDZ, ZIP (textures resolved by file name); Draco, Meshopt, KTX2. Auto-detects Mixamo / VRM / Unity / Blender names, plus a Bone map editor saved per model. Non-humanoid creatures work (IceDwen / `bdd.glb`).
- **Look:** PBR, ACES, key/fill/rim lights, soft shadows + ground shadow, bloom, SSAO, SMAA, depth of field, vignette, built-in studio IBL.
- **Backgrounds:** solid, gradient (2-3 stops, angle), 7 presets, HDRI (built-in or .hdr upload, blur, rotation, lights-the-model toggle), image, looped video, transparent, green screen, grid / reflective floor, room / stage. Persisted.
- **Performance:** Low / Medium / High / Ultra / Auto (first-launch benchmark + adaptive up/down).
- **Capture:** record motion, export BVH or animated GLB, save/load takes, replay, screenshot (PNG), viewport video (WebM), settings profiles.
- **UX:** keyboard shortcuts (Space, C, R, P, S, V, M, H), tooltips, first-run tutorial, camera-permission error screen.

## OBS
Use Background = Green screen and add a Window Capture of this app with a Chroma Key filter on #00FF00.

## Troubleshooting
- **Camera black / denied:** Windows Settings > Privacy & security > Camera > allow desktop apps; close Zoom/Teams/OBS using the camera.
- **GPU issues / low FPS:** Quality = Low, or Mode = Upper body, turn off hands or face. If the window is blank, update GPU drivers.
- **Models fail to load at startup:** run `npm run setup:assets` with internet access once.
- **Legs jitter while seated:** use Mode = Upper body.
- Camera access needs HTTPS or localhost; the desktop app serves itself over a secure custom protocol, so this does not apply.

## Known limitations
Single-webcam depth is estimated; occlusion can glitch; legs are unreliable when seated. Mesh LOD is not implemented (needs LOD data in the model). The app is a desktop app, so PWA install is not used. Thumb mapping for VRM0-style rigs is approximate.
