# Changelog

## 1.0.5
### Face: mouth, eyes, expressions
- **Fixed: face animation stopped after switching models.** MediaPipe sends the 52 blendshape names only once per tracking session, but every model switch creates a new face rig that never received them, so it ignored all blendshapes. The names are now remembered.
- Mouth opens when you open yours, on every kind of model: VRM expressions (`aa`, `ou`, `oh`, `ih`, `ee`), ARKit morph targets, morph targets with other names (`mouthOpen`, `Blink_L`, Ready Player Me visemes...), and now **jaw bones** (rotates down).
- Blinks are shaped so a real blink fully closes the eyes (MediaPipe's score rarely reaches 1). Models with eye bones but no morph targets close the eyes by squashing the eye bones.
- VRM models also get `happy`, `sad`, `angry` and `surprised` from your expression.
- On-screen hints: "Face not detected: move closer" and "Legs not visible: step back" appear after 5 s instead of silently doing nothing.
- Tests: real VRM files with expressions (mouth + blink), morph targets, name aliases, jaw bone, eye bones, mirroring, and the model-switch bug.

### Legs
- Added thorough leg tests (standing, raised knee, kick back, step sideways, with and without IK) on the default rig, randomly rotated rigs and a real VRM. All pass.

## 1.0.4
### Fixed
- **VRM models never moved** (Ashtra, Hanako, VAL, Sendagaya, Amaris, Natsuki). three-vrm's `vrm.update()` copies a "normalized" rest pose over the real bones every frame, and the app calls it every frame, so the pose from tracking was wiped immediately. That copy is now switched off for VRM models (expressions and spring bones still update).
- Added tests that load a real VRM file through the real three-vrm loader and check the character follows the pose. One of them reproduces the old bug.
- Added tests that run the solver on rigs with randomly rotated bone axes (like real FBX / GLB / VRM files). All pass, so bone-axis conventions are not a problem.

### Performance
- Tracking load is lighter on weaker presets: pose runs on every frame, hands on every 2nd and face on every 3rd frame (Low), face on every 2nd (Medium). Smoothing hides the gaps. The camera preview keeps the last hand/face points between updates.
- The light vignette effect no longer forces the Low preset through the post-processing chain, so Low renders directly.

## 1.0.3
### Fixed
- **"Could not auto-detect: lHand+fingers, rHand+fingers"** on every VRM model. The VRM standard calls the pinky "Little", but the app asked for "Pinky", so hand and finger tracking was switched off on all VRM models. A hand rig without a pinky bone also works now.
- Added a regression test that checks every bone name the VRM mapper asks for against the official VRM list.

### Performance (smoother, no hangs)
- Auto quality no longer bounces up and down every ~10 s. Each bounce rebuilt every render buffer and shadow map and caused a regular stutter. It now needs a long steady stretch before raising quality and never goes back to a level that just failed.
- Rendering skips the post-processing pipeline when no effect is enabled (faster on weaker GPUs).
- Camera frames sent to tracking are shrunk to what the models actually use (640/960/1280 px), so far less data is copied per frame. Tracking is capped at 30 fps (it was 60 on Ultra), which leaves GPU time for rendering.
- Large model textures are resized off the main thread, so importing a big VRM/GLB no longer freezes the window.
- Switching models now frees the old skeleton and decoded textures (GPU memory was leaking).
- No more 404 noise in the console: `npm run scan:models` (automatic) writes the list of model files that really exist.

## 1.0.2
- Model list is now only your 9 models, read from `public/models/models.json`.
- A model shows up only when its file exists in `public/models/`.

## 1.0.1

### Critical
- **Tracking never started.** MediaPipe loads its WASM engine with `importScripts()`, which throws inside the module Web Worker
  this app uses (`Module scripts don't support importScripts()`). The worker now polyfills it (sync XHR + global eval).
  Verified in Chrome and in real Electron over the `app://` protocol.
- **Tracking could freeze permanently.** Any exception in the worker, or a failed camera-frame capture, left the "busy" flag set
  forever. The worker now always answers, the client has a 4 s watchdog, and errors are shown (throttled) instead of swallowed.

### Fixed
- Open, flat hands showed ~18 degrees of finger bend (finger base angle was measured against the wrong reference). Test now passes.
- A limb folded exactly back on itself skipped the elbow/knee limit and bent 180 degrees. It now bends in the natural direction.
- A model-loading failure was shown as "Camera problem" (error text containing a URL matched the word "https"). Only real
  camera failures open that dialog now.
- If tracking models fail to load, the app now resets (Start button, camera off) and explains the fix instead of sitting on "Stop".
- Hands/face models are optional: if one fails to load, body tracking still works and you get a warning.
- Saved camera that was unplugged made Start fail forever; it now falls back to the default camera.
- `setup-assets` could leave a truncated model file that was never re-downloaded; downloads now go to `.part` and are verified.
- Playing back a take was overwritten by live tracking while the camera was running.
- Held keys re-triggered shortcuts (Space toggled Start/Stop repeatedly).
- Electron: blank window in dev mode (`localhost` vs IPv6), no camera prompt on macOS, a blank window on GPU/renderer crash,
  two app instances fighting over the camera, a path check that also matched `dist-evil`, and missing files surfacing as a confusing "Failed to fetch".
- IndexedDB opened a new never-closed connection on every read/write; blob URL leak when switching video files.
- Removed a stray empty folder named `src/{tracking,scene,loaders,state}` (a shell brace-expansion typo).

### Changed
- `npm run package` now runs the strict type-check first; added `package:mac` and `typecheck`.
- Vite dev server binds to `127.0.0.1`.
