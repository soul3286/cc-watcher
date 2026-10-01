// Desktop app for the cc-watcher dashboard. Two views of the same http://127.0.0.1:4790 page the browser and phone use
// (so progress syncs through the watcher like any other device):
//  - overlay: a transparent, click-through, always-on-top window showing only Clawd (default)
//  - dashboard: a normal window with everything, opened on request; closing or minimizing it returns to the overlay.
// Only one of the two pages is loaded at a time, so there's one progress writer, one set of sounds, one device.
// It never touches ~/.claude; the watcher server it may start reads that folder read-only, as always.
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, Notification, ipcMain, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4790; // same override server.js honours; the spawned server inherits it
const URL = `http://127.0.0.1:${PORT}/`;
const ICON = path.join(__dirname, 'icon.ico');
const SETTINGS = path.join(app.getPath('userData'), 'desktop.json');
const DEFAULTS = { mascotSize: 112, onTop: true, dash: { width: 1100, height: 760 } };
const KEYS = { dash: 'Ctrl+Alt+D', mascot: 'Ctrl+Alt+M' };
const GAP = 8, SIDE_W = 240; // room each side of Clawd for the popup / game bubble
const WEB = { contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' };

// Tests run a second copy beside an installed one; a separate data folder also means a separate single-instance lock.
if (process.env.CCW_USER_DATA) app.setPath('userData', process.env.CCW_USER_DATA);
if (!app.requestSingleInstanceLock()) app.exit(0);
app.setAppUserModelId('com.ccwatcher.desktop'); // Windows toasts need it

let ov, dash, tray, quitting = false, mascotHidden = false, soundOn = false, saveTimer, dragTimer, geo, pos;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const s = { ...DEFAULTS, ...readJson(SETTINGS) };
for (const k of ['sizes', 'opacity', 'compact', 'x', 'y']) delete s[k]; // old floating-window settings

// Dev runs the project's own server.js. The installed app runs the copy bundled beside it (resources/app) and keeps
// progress and logs in its app-data folder, since the install folder is replaced on update. "projectDir" in
// desktop.json points either at another copy of the project instead (its own progress.json and logs).
const projectDir = s.projectDir ?? (app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..'));
const bundled = app.isPackaged && !s.projectDir;
const dataDir = bundled ? app.getPath('userData') : projectDir;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); } catch (e) { console.error('desktop settings not saved:', e.message); }
  }, 300);
}

// --- watcher: reuse a running one, otherwise start this project's server.js ---
const ping = () => new Promise(done => {
  const req = http.get(`${URL}manifest.webmanifest`, { timeout: 1500 }, r => { r.resume(); done(r.statusCode === 200); });
  req.on('error', () => done(false)).on('timeout', () => { req.destroy(); done(false); });
});

async function ensureWatcher() {
  if (await ping()) return 'running';
  const server = projectDir && path.join(projectDir, 'server.js');
  if (!server || !fs.existsSync(server)) return `server.js not found (${projectDir ?? 'no project folder set'})`;
  // The log can be locked by another watcher's shell redirect; losing the log beats not starting.
  const log = n => { try { return fs.openSync(path.join(dataDir, n), 'a'); } catch { return 'ignore'; } };
  // Electron's bundled Node runs the server, so Node needn't be on PATH. Detached: it outlives this app,
  // because the browser tab and phone may still be using it.
  spawn(process.execPath, [server], {
    cwd: projectDir, detached: true, windowsHide: true,
    stdio: ['ignore', log('watcher.log'), log('watcher.log.err')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(bundled && { CCW_DATA_FILE: path.join(dataDir, 'progress.json') }) },
  }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await ping()) return 'started';
  }
  return 'did not start (see watcher.log.err)';
}

const guard = w => {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL)) e.preventDefault(); });
};
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// --- overlay geometry ---
// The window never changes size (only position), which sidesteps the frameless-window growth bug on scaled displays.
// `s.clawd` is Clawd's centre in screen coordinates; the window sits around him, pushed inside the screen, and the
// page is told where he is inside it (cx/cy) and which side has room for the popup and game bubble.
function layout() {
  const S = clamp(Math.round(Number(s.mascotSize) || DEFAULTS.mascotSize), 48, 320);
  const W = S + 2 * (GAP + SIDE_W) + 16, H = Math.max(S + 160, 430);
  const wa0 = screen.getPrimaryDisplay().workArea;
  let c = s.clawd;
  const onSome = c && screen.getAllDisplays().some(({ workArea: a }) => c.x >= a.x && c.x < a.x + a.width && c.y >= a.y && c.y < a.y + a.height);
  if (!onSome) c = { x: wa0.x + wa0.width - S / 2 - 40, y: wa0.y + wa0.height - S / 2 - 40 }; // unplugged monitor → bottom-right
  const wa = screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) }).workArea;
  c = { x: Math.round(clamp(c.x, wa.x + S / 2, wa.x + wa.width - S / 2)), y: Math.round(clamp(c.y, wa.y + S / 2, wa.y + wa.height - S / 2)) };
  const x = Math.round(clamp(c.x - W / 2, wa.x, wa.x + wa.width - W)), y = Math.round(clamp(c.y - H / 2, wa.y, wa.y + wa.height - H));
  const cx = c.x - x, cy = c.y - y;
  const side = cx > W / 2 ? 'left' : cx < W / 2 ? 'right' : c.x > wa.x + wa.width / 2 ? 'left' : 'right';
  if (!onSome || s.clawd?.x !== c.x || s.clawd?.y !== c.y) { s.clawd = c; save(); }
  return { S, W, H, x, y, cx, cy, side, gap: GAP };
}

function setPos(x, y) {
  pos = { x, y };
  ov.setBounds({ x, y, width: geo.W, height: geo.H }); // size re-sent every time so it can't drift
}

function place() {
  if (!ov) return;
  geo = layout();
  ov.webContents.send('ccw-geo', geo);
  setPos(geo.x, geo.y);
}

// Drag is driven from here with the OS cursor position, so it stays exact at any display scaling.
function drag(on, from) {
  clearInterval(dragTimer);
  if (on) {
    // Offset from where the button went down (page screen coords), not from where the drag threshold was crossed.
    const [fx, fy] = Array.isArray(from) && from.every(Number.isFinite) ? from : Object.values(screen.getCursorScreenPoint());
    const off = { x: fx - pos.x, y: fy - pos.y };
    dragTimer = setInterval(() => { const p = screen.getCursorScreenPoint(); setPos(p.x - off.x, p.y - off.y); }, 16);
  } else if (dragTimer != null && geo && pos) {
    dragTimer = null;
    s.clawd = { x: pos.x + geo.cx, y: pos.y + geo.cy };
    place(); save();
  }
}

// Which parts catch the mouse is decided by the page from the real cursor position, sent from here. Electron's own
// forwarding of mouse moves to a click-through window reports shifted coordinates on scaled (125%) displays.
let cursorInside = false;
function watchCursor() {
  setInterval(() => {
    if (!ov?.isVisible() || !pos || !geo) return;
    const p = screen.getCursorScreenPoint(), x = p.x - pos.x, y = p.y - pos.y;
    const inside = x >= 0 && y >= 0 && x < geo.W && y < geo.H;
    if (inside || cursorInside) ov.webContents.send('ccw-cursor', inside ? [x, y] : null);
    cursorInside = inside;
  }, 33);
}

// --- overlay window ---
const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8');
const overlayJs = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');

function showOverlay() {
  if (!ov || dash || mascotHidden) return;
  ov.showInactive(); // never steal focus from what you're typing in
  ov.setAlwaysOnTop(s.onTop, 'screen-saver');
}

function createOverlay() {
  geo = layout();
  ov = new BrowserWindow({
    x: geo.x, y: geo.y, width: geo.W, height: geo.H,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, show: false, icon: ICON, title: 'CC Live',
    webPreferences: { ...WEB, preload: path.join(__dirname, 'preload.js') },
  });
  setPos(geo.x, geo.y); // re-apply exactly: scaled displays create frameless windows a few px off
  // Click-through everywhere by default; the page switches it off while the pointer is over Clawd or a popup.
  ov.setIgnoreMouseEvents(true);
  watchCursor();
  guard(ov);
  ov.webContents.on('dom-ready', async () => {
    if (!ov.webContents.getURL().startsWith(URL)) return;
    ov.webContents.send('ccw-geo', geo);
    await ov.webContents.insertCSS(overlayCss);
    await ov.webContents.executeJavaScript(overlayJs).catch(e => console.error('overlay script:', e.message));
    setTimeout(showOverlay, 120); // let the restyled page paint before showing, so the full dashboard never flashes
  });
  ov.webContents.on('did-fail-load', (_, code, desc, url, mainFrame) => {
    if (!mainFrame || code === -3 || url === 'about:blank') return;
    ov.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent"><div style="padding:6px 10px;border-radius:6px;background:#0d0a08e0;color:#8c7667;font:11px Consolas,monospace">CC Live: can't reach the watcher on :${PORT}. Retrying…</div></body>`)}`);
    showOverlay();
    setTimeout(() => ensureWatcher().then(() => !dash && ov.loadURL(URL)), 3000);
  });
  ov.webContents.on('did-start-loading', () => { drag(false); ov.setIgnoreMouseEvents(true); });
  ov.on('blur', () => ov.webContents.send('ccw-blur'));
  ov.on('close', e => { if (!quitting) { e.preventDefault(); setMascot(false); } });
  ov.loadURL(URL);
}

ipcMain.on('ccw-overlay', (e, what, arg, extra) => {
  if (e.sender !== ov?.webContents) return;
  if (what === 'hit') ov.setIgnoreMouseEvents(!arg);
  else if (what === 'drag') drag(arg, extra);
  else if (what === 'dashboard') openDashboard();
});

// --- dashboard window ---
function openDashboard() {
  if (dash) { if (dash.isMinimized()) dash.restore(); dash.show(); dash.focus(); return; }
  drag(false);
  ov.hide();
  ov.webContents.loadURL('about:blank'); // unload the overlay page: one page, one writer, no double sounds
  const d = s.dash;
  const fits = d.x != null && screen.getAllDisplays().some(({ workArea: a }) =>
    d.x < a.x + a.width - 80 && d.x + d.width > a.x + 80 && d.y >= a.y - 10 && d.y < a.y + a.height - 80);
  dash = new BrowserWindow({
    ...(fits ? { x: d.x, y: d.y } : {}), width: d.width, height: d.height, minWidth: 420, minHeight: 320,
    show: false, backgroundColor: '#0d0a08', icon: ICON, title: 'CC Live', autoHideMenuBar: true, webPreferences: WEB,
  });
  dash.setMenu(null);
  if (d.max) dash.maximize();
  guard(dash);
  // Saved only on user moves/resizes, never read back after we set it (same creep lesson as before).
  const remember = () => {
    if (dash.isMinimized()) return;
    s.dash = dash.isMaximized() ? { ...s.dash, max: true } : { ...dash.getNormalBounds(), max: false };
    save();
  };
  dash.on('moved', remember).on('resized', remember).on('maximize', remember).on('unmaximize', remember);
  dash.on('minimize', () => dash.close()); // minimizing returns to the mascot, same as closing
  dash.on('closed', () => {
    dash = null;
    mascotHidden = false; // never leave nothing on screen
    ov.loadURL(URL);
    refreshTray();
  });
  dash.webContents.on('did-fail-load', (_, code, desc, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    dash.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0d0a08;color:#8c7667;font:12px Consolas,monospace">Can't reach the watcher on :${PORT}. Retrying…</body>`)}`);
    setTimeout(() => ensureWatcher().then(() => dash?.loadURL(URL)), 3000);
  });
  dash.once('ready-to-show', () => { dash.show(); dash.focus(); });
  dash.loadURL(URL);
  refreshTray();
}

const toggleDashboard = () => (dash ? dash.close() : openDashboard());

function setMascot(show) {
  mascotHidden = !show;
  if (show) showOverlay(); else ov.hide();
  refreshTray();
}

// --- tray & controls ---
const notify = body => Notification.isSupported() && new Notification({ title: 'CC Live', body, icon: nativeImage.createFromPath(ICON), silent: true }).show();
// Sound is the page's own setting (synced like every other device); ask whichever page is loaded.
const page = () => (dash ?? ov)?.webContents;
const readSound = () => page()?.executeJavaScript('typeof soundOn === "boolean" && soundOn').then(v => { soundOn = v === true; }).catch(() => {});

function setOnTop(on) {
  s.onTop = on;
  ov.setAlwaysOnTop(on, 'screen-saver');
  save(); refreshTray();
}

function menu() {
  const login = app.isPackaged && app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: dash ? 'Back to mascot' : 'Show dashboard', accelerator: KEYS.dash, registerAccelerator: false, click: toggleDashboard },
    { label: mascotHidden ? 'Show mascot' : 'Hide mascot', accelerator: KEYS.mascot, registerAccelerator: false, enabled: !dash, click: () => setMascot(mascotHidden) },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: s.onTop, click: i => setOnTop(i.checked) },
    { label: 'Mute sound', type: 'checkbox', checked: !soundOn,
      click: () => page()?.executeJavaScript('document.getElementById("sound")?.click()').then(readSound) },
    { label: app.isPackaged ? 'Launch at login' : 'Launch at login (installed app only)', type: 'checkbox', checked: login, enabled: app.isPackaged,
      click: i => { app.setLoginItemSettings({ openAtLogin: i.checked }); refreshTray(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  tray?.setToolTip(`CC Live · ${dash ? 'dashboard open' : mascotHidden ? 'mascot hidden' : 'mascot'} · click for the dashboard`);
}

function registerKeys() {
  const failed = Object.entries({ [KEYS.dash]: toggleDashboard, [KEYS.mascot]: () => !dash && setMascot(mascotHidden) })
    .filter(([k, fn]) => !globalShortcut.register(k, fn)).map(([k]) => k);
  if (failed.length) notify(`Hotkeys taken by another app: ${failed.join(', ')}. Use the tray icon instead.`);
}

app.on('second-instance', () => openDashboard());
app.on('window-all-closed', () => {}); // only the tray's Quit ends the app
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  const watcher = await ensureWatcher().catch(e => `could not be started (${e.message})`);
  console.log(`watcher: ${watcher}`);
  createOverlay();
  tray = new Tray(ICON);
  tray.on('click', openDashboard);
  tray.on('right-click', async () => { await readSound(); tray.popUpContextMenu(menu()); });
  refreshTray();
  registerKeys();
  // Monitor unplugged / resolution or scaling changed: pull Clawd back on-screen.
  for (const ev of ['display-removed', 'display-added', 'display-metrics-changed']) screen.on(ev, () => setTimeout(place, 300));
  if (!/running|started/.test(watcher)) notify(`Watcher ${watcher}.`);
});
