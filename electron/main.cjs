// Electron shell: runs the app as a native desktop window (no browser). Production build is served from a
// privileged app:// protocol so module workers, WASM and camera access work exactly like on localhost.
const { app, BrowserWindow, protocol, net, session, systemPreferences, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV = process.env.VITE_DEV === '1';
const DEV_URL = 'http://127.0.0.1:5173'; // FIX: 'localhost' can resolve to IPv6 (::1) while Vite listens on IPv4 -> blank window
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// FIX: opening the app twice made two windows fight over the same camera.
if (!app.requestSingleInstanceLock()) app.quit();
let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function errorPage(title, detail) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(
    `<body style="font:15px system-ui;background:#0f1115;color:#e6e8ee;padding:40px"><h2>${esc(title)}</h2><pre style="white-space:pre-wrap;color:#ff8a8a">${esc(detail)}</pre>` +
    `<p>Try again with <b>npm run build</b> then <b>npm run desktop</b>. If it keeps happening, update your GPU drivers.</p></body>`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 880, minWidth: 980, minHeight: 620,
    backgroundColor: '#0f1115', title: 'Mocap Studio', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // never open stray windows
  // FIX: a failed load or a crashed GPU/renderer process used to leave a silent blank window.
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win?.loadURL(errorPage('Mocap Studio could not load', `${desc} (${code})\n${url}`));
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    const msg = `The graphics process stopped (${d.reason}).`;
    dialog.showMessageBox(win, { type: 'error', title: 'Mocap Studio', message: msg, detail: 'The app will reload.' }).then(() => win?.reload());
  });
  if (process.env.MOCAP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  win.loadURL(DEV ? DEV_URL : 'app://local/index.html');
}

app.whenReady().then(async () => {
  // allow camera only (request AND check: device labels need the check handler to say yes)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  // FIX: on macOS the packaged app never got a camera prompt, so the camera was always black.
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('camera'); } catch { /* user can allow it in System Settings */ } }

  protocol.handle('app', async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 }); // FIX: 'dist-evil' also matched startsWith(DIST)
    try { return await net.fetch(pathToFileURL(file).toString()); }
    catch { return new Response('not found', { status: 404 }); } // FIX: a missing file used to reject and surface as a confusing 'Failed to fetch'
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
