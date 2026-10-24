// Copies MediaPipe's WASM runtime next to the app (version-matched, works offline) and bundles the tracking worker
// as a CLASSIC script: MediaPipe's loader needs importScripts(), which module workers (Vite's default) don't have.
import { cpSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('public', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', { recursive: true });
await build({ entryPoints: ['src/tracking/worker.ts'], bundle: true, format: 'iife', target: 'es2022', minify: true, outfile: 'public/tracker.worker.js' });
console.log('prep: wasm copied, worker bundled');
