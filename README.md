# Web MoCap
```
npm install
npm run dev      # runs `npm run prep` first: copies the MediaPipe WASM to public/wasm and bundles the tracking worker
```
Open http://localhost:5173 (camera needs localhost or https).
1. Drop a Mixamo-rigged GLB (T-pose / A-pose rest). 2. Start camera. 3. Stand 2–3 m back, full body visible. 4. Calibrate T-pose.

Notes: tracking runs in a classic Web Worker (`public/tracker.worker.js`, generated). Model files (~30 MB total) load from Google's CDN
on first use; download them into `public/` and edit `MODELS` in `src/tracking/worker.ts` for fully offline use.
Troubleshooting: camera blocked → site settings; "Tracker error" → run `npm run prep`; slow → pick the Lite pose model, close GPU-heavy tabs.
Tests: `npm test`.
