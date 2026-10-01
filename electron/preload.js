// Overlay window only (the dashboard window has no preload). Runs in an isolated world and gives the overlay script
// three calls: hit (catch clicks or let them through), drag start/stop, and open the dashboard. It also lays out
// where Clawd and his bubble sit inside the transparent window, from the geometry main.js sends.
const { contextBridge, ipcRenderer } = require('electron');

const send = (...a) => ipcRenderer.send('ccw-overlay', ...a);
contextBridge.exposeInMainWorld('ccwDesktop', {
  hit: on => send('hit', !!on),
  drag: (on, from) => send('drag', !!on, from),
  dashboard: () => send('dashboard'),
});

const BUBBLE_W = 220;
let geo = null;

function apply() {
  const root = document.documentElement; // null when the preload first runs — look it up each time
  if (!root || !geo) return;
  const { S, H, cx, cy, side, gap } = geo, bh = Math.max(S, 104);
  const panelLeft = side === 'right' ? cx + S / 2 + gap : cx - S / 2 - gap - BUBBLE_W;
  const panelTop = Math.min(Math.max(cy - bh / 2, 4), H - bh - 4);
  const vars = {
    '--sprite': S, '--ccw-cx': cx, '--ccw-cy': cy, '--ccw-gap': gap, '--ccw-bw': BUBBLE_W, '--ccw-bh': bh,
    '--ccw-pl': panelLeft, '--ccw-pt': panelTop,
    // Clawd sits outside his strip, so games placed "right of the mascot" land in the bubble on either side.
    '--ccw-ml': side === 'right' ? -(S + gap) : BUBBLE_W + gap, '--ccw-mt': cy - S / 2 - panelTop,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, `${v}px`);
  root.dataset.ccwSide = side;
  dispatchEvent(new Event('ccw-geo'));
}

ipcRenderer.on('ccw-geo', (_, g) => { geo = g; apply(); });
ipcRenderer.on('ccw-blur', () => dispatchEvent(new Event('ccw-blur')));
// Cursor position inside the window (or none), handed over as an attribute: event details don't cross worlds.
ipcRenderer.on('ccw-cursor', (_, xy) => {
  if (!document.documentElement) return;
  document.documentElement.dataset.ccwCursor = xy ? xy.join(',') : '';
  dispatchEvent(new Event('ccw-cursor'));
});
addEventListener('DOMContentLoaded', apply);
