// Claude Code Live Watcher — tails ~/.claude/projects/*/*.jsonl and streams parsed
// tool-call events to a browser dashboard over WebSocket. Multi-session aware.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const { mergeState, sanitizeState } = require('./public/progress.js');

const PORT = process.env.PORT || 4790;
const CLAUDE_DIR = process.env.CC_WATCH_DIR || path.join(os.homedir(), '.claude', 'projects');

// Track byte offsets so we only read new lines appended to each file.
const fileOffsets = new Map(); // filePath -> last read byte offset
const sessionMeta = new Map(); // filePath -> { projectName, sessionId }

function projectNameFromEncodedPath(encoded) {
  // Claude Code encodes the full project path with '-' replacing separators.
  // Take the last 3 segments for readability, e.g. "...-Herewear-storefront-app" -> "Herewear-storefront-app".
  const parts = encoded.split('-').filter(Boolean);
  return parts.slice(-3).join('-') || encoded;
}

// fromLog: use the time the log recorded (replay) instead of the time the watcher read the line (live).
function parseLine(line, meta, fromLog = false) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const ts = fromLog ? Date.parse(obj.timestamp) : Date.now();
  if (!ts) return null;

  // Claude Code session lines vary by type: user/assistant messages, tool_use, tool_result.
  const base = { session: meta.sessionId, project: meta.projectName, projectKey: meta.projectKey, ts };

  if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
    // end_turn = Claude finished and handed control back to the user.
    if (obj.message.stop_reason === 'end_turn') {
      const text = obj.message.content.find(b => b.type === 'text' && b.text?.trim())?.text.trim().slice(0, 280) ?? '';
      return { ...base, kind: 'turn_end', text };
    }
    for (const block of obj.message.content) {
      if (block.type === 'tool_use') {
        return {
          ...base,
          kind: 'tool_use',
          tool: block.name,
          input: summarizeInput(block.name, block.input),
        };
      }
      if (block.type === 'text' && block.text?.trim()) {
        return { ...base, kind: 'text', text: block.text.trim().slice(0, 280) };
      }
    }
  }
  if (obj.type === 'user' && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'tool_result') {
        return {
          ...base,
          kind: 'tool_result',
          ok: !block.is_error,
          preview: summarizeResult(block.content),
        };
      }
    }
  }
  return null;
}

function summarizeInput(tool, input) {
  if (!input) return '';
  if (tool === 'Bash') return (input.command || '').slice(0, 160);
  if (tool === 'Edit' || tool === 'Write' || tool === 'Read' || tool === 'NotebookEdit') {
    return input.file_path || input.path || '';
  }
  if (tool === 'Grep' || tool === 'Glob') return input.pattern || '';
  return JSON.stringify(input).slice(0, 160);
}

function summarizeResult(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return (text || '').slice(0, 160);
}

function readNewLines(filePath, meta) {
  const stat = fs.statSync(filePath);
  const prevOffset = fileOffsets.get(filePath) || 0;
  if (stat.size < prevOffset) fileOffsets.set(filePath, 0); // file truncated/rotated
  const start = fileOffsets.get(filePath) || 0;
  if (stat.size <= start) return [];

  const buf = Buffer.alloc(stat.size - start);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  fileOffsets.set(filePath, stat.size);

  return buf.toString('utf8').split('\n').filter(Boolean)
    .map(line => parseLine(line, meta)).filter(Boolean);
}

// --- shared progress: one record for every device (desktop tab, phone PWA). Same blob the browser keeps in
// localStorage; each device syncs its copy here and gets the merge back (merge rules live in progress.js). ---
const DATA_FILE = process.env.CCW_DATA_FILE || path.join(__dirname, 'progress.json');
let shared = null;
try {
  shared = sanitizeState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  if (!shared) throw new Error('unrecognised format');
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error(`Saved progress at ${DATA_FILE} unusable (${e.message}) — kept as ${DATA_FILE}.corrupt, starting empty.`);
    try { fs.renameSync(DATA_FILE, `${DATA_FILE}.corrupt`); } catch {}
  }
}

function syncProgress(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
  req.on('end', () => {
    let incoming = null;
    try { incoming = sanitizeState(JSON.parse(body)); } catch {}
    if (!incoming) { res.writeHead(400); return res.end(); }
    const merged = shared ? mergeState(shared, incoming) : incoming;
    if (JSON.stringify(merged) !== JSON.stringify(shared)) {
      shared = merged;
      try {
        fs.writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(shared));
        fs.renameSync(`${DATA_FILE}.tmp`, DATA_FILE); // atomic: a crash mid-write never leaves a half file
      } catch (e) { console.error('Could not save progress:', e.message); }
      broadcast({ kind: 'progress' }); // other devices pull the new merge
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(shared));
  });
}

// --- session replay: read straight from Claude Code's own logs, on demand. Nothing is copied or stored, so a
// recording lasts exactly as long as Claude Code keeps that log. Only top-level session logs are offered. ---
const REPLAY_LIST_MAX = 100, REPLAY_EVENTS_MAX = 20_000;
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

// The first timestamp within a log's first 64 KB: when the session started.
function logStart(file) {
  try {
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(65_536), n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8', 0, n).match(/"timestamp":"([^"]+)"/);
    return m ? Date.parse(m[1]) || null : null;
  } catch { return null; }
}

function listReplays(res) {
  const logs = [];
  try {
    for (const dir of fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(CLAUDE_DIR, dir.name))) {
        if (!f.endsWith('.jsonl')) continue;
        const file = path.join(CLAUDE_DIR, dir.name, f), { size, mtimeMs } = fs.statSync(file);
        logs.push({ p: dir.name, s: f.slice(0, -'.jsonl'.length), file, size, mtimeMs });
      }
    }
  } catch (e) { return json(res, 500, { error: e.message }); }
  const list = logs.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, REPLAY_LIST_MAX).map(l => ({
    p: l.p, s: l.s, project: projectNameFromEncodedPath(l.p), projectKey: l.p, session: l.s.slice(0, 8),
    start: logStart(l.file) ?? l.mtimeMs, end: l.mtimeMs, bytes: l.size, live: Date.now() - l.mtimeMs < 120_000,
  }));
  json(res, 200, { list });
}

function sendReplay(req, res) {
  const q = new URL(req.url, 'http://x').searchParams, p = q.get('p') ?? '', s = q.get('s') ?? '';
  // Plain names only, so nothing can reach outside the projects folder.
  if (!/^[\w-][\w.-]*$/.test(p) || !/^[\w-]+$/.test(s)) return json(res, 400, { error: 'bad session' });
  const file = path.join(CLAUDE_DIR, p, `${s}.jsonl`);
  if (!file.startsWith(path.join(CLAUDE_DIR, path.sep))) return json(res, 400, { error: 'bad session' });
  fs.readFile(file, 'utf8', (err, text) => {
    if (err) return json(res, 404, { error: 'That session log no longer exists.' });
    const meta = { sessionId: s.slice(0, 8), projectName: projectNameFromEncodedPath(p), projectKey: p };
    const events = text.split('\n').filter(Boolean).map(line => parseLine(line, meta, true)).filter(Boolean);
    json(res, 200, { ...meta, events: events.slice(-REPLAY_EVENTS_MAX), truncated: events.length > REPLAY_EVENTS_MAX });
  });
}

// --- HTTP + WebSocket server ---
const server = http.createServer((req, res) => {
  if (req.url === '/api/replays') return req.method === 'GET' ? listReplays(res) : json(res, 405, {});
  if (req.url.startsWith('/api/replay?')) return req.method === 'GET' ? sendReplay(req, res) : json(res, 405, {});
  if (req.url === '/api/progress') {
    if (req.method === 'POST') return syncProgress(req, res);
    res.writeHead(405); return res.end();
  }
  const filePath = req.url.split('?')[0].replace(/^\/$/, '/index.html'); // "/?demo=1" is the page too
  const full = path.join(__dirname, 'public', filePath);
  if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(full);
    const type = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif',
      '.webmanifest': 'application/manifest+json', '.json': 'application/json',
    }[ext] || 'text/plain';
    // The service worker must always be revalidated or app updates would be stuck behind a stale worker.
    res.writeHead(200, { 'Content-Type': type, ...(filePath === '/sw.js' && { 'Cache-Control': 'no-cache' }) });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });
const clients = new Set();

// Recent events per session, replayed to a client on connect so a phone waking from lock screen rebuilds its panels
// from real activity. In memory only: nothing from before this process started is ever replayed.
const BOOT = Date.now().toString(36); // a new boot id tells clients their old seq numbers are meaningless
const RECENT_PER_SESSION = 50, RECENT_MS = 30 * 60_000;
const recent = new Map(); // sessionId -> events[]
let seq = 0;
function emit(event) {
  event.seq = ++seq;
  const list = recent.get(event.session) ?? [];
  recent.delete(event.session); // re-insert so Map order = most recently active last
  recent.set(event.session, list);
  list.push(event);
  if (list.length > RECENT_PER_SESSION) list.shift();
  broadcast(event);
}
const snapshot = () => {
  const cutoff = Date.now() - RECENT_MS;
  for (const [id, list] of recent) if (list.at(-1).ts < cutoff) recent.delete(id);
  return { kind: 'snapshot', boot: BOOT, events: [...recent.values()].flat().sort((a, b) => a.seq - b.seq) };
};

wss.on('connection', ws => {
  clients.add(ws);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify(snapshot()));
});
function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
}
// Heartbeat both ways: ping drops phones that vanished without closing (lock screen, network switch); the 'hb'
// message lets the page notice a silently dead socket, which browsers otherwise never report.
setInterval(() => {
  for (const ws of clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  broadcast({ kind: 'hb' });
}, 10_000);

// --- Watch for new/changed .jsonl files across all project dirs ---
if (!fs.existsSync(CLAUDE_DIR)) {
  console.error(`No Claude projects dir found at ${CLAUDE_DIR}. Is Claude Code installed / have you run a session yet?`);
}

// chokidar v4+ dropped glob support — watch the dir and filter to .jsonl files instead.
const watcher = chokidar.watch(CLAUDE_DIR, {
  ignored: (p, stats) => stats?.isFile() && !p.endsWith('.jsonl'),
  persistent: true,
  usePolling: true,   // more reliable on Windows/OneDrive-synced dirs
  interval: 400,
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 100 },
});

let startupComplete = false;

watcher.on('ready', () => {
  startupComplete = true;
  const watched = watcher.getWatched();
  const fileCount = Object.values(watched).reduce((n, arr) => n + arr.length, 0);
  console.log(`Watcher ready. Tracking ${fileCount} files/dirs under ${CLAUDE_DIR}`);
});
watcher.on('error', err => console.error('Watcher error:', err));

function ensureMeta(filePath) {
  if (sessionMeta.has(filePath)) return sessionMeta.get(filePath);
  const projectDir = path.basename(path.dirname(filePath));
  const sessionId = path.basename(filePath, '.jsonl');
  // projectKey is the full encoded project path: a stable identity for persisted per-project records.
  // projectName is lossy (last 3 segments) and can collide, so it's display-only.
  const meta = { projectName: projectNameFromEncodedPath(projectDir), projectKey: projectDir, sessionId: sessionId.slice(0, 8) };
  sessionMeta.set(filePath, meta);
  return meta;
}

watcher.on('add', filePath => {
  const meta = ensureMeta(filePath);
  // Don't replay history on startup, but read a session created after boot from byte 0 — its first lines are live activity.
  fileOffsets.set(filePath, startupComplete ? 0 : fs.statSync(filePath).size);
  // Initial scan fires 'add' for every existing log — only announce sessions created after boot.
  if (!startupComplete) return;
  emit({ kind: 'session_start', session: meta.sessionId, project: meta.projectName, projectKey: meta.projectKey, ts: Date.now() });
  for (const event of readNewLines(filePath, meta)) emit(event);
});

watcher.on('change', filePath => {
  const meta = ensureMeta(filePath);
  for (const event of readNewLines(filePath, meta)) emit(event);
});

server.listen(PORT, () => {
  console.log(`Claude Code watcher running: http://localhost:${PORT}`);
  console.log(`Watching: ${CLAUDE_DIR}`);
  console.log(`Progress: ${DATA_FILE}`);
});
