// Demo mode: made-up sessions that show cc-watcher off without a live Claude Code (first run, the showcase video).
// Loaded before every other script. When on, it swaps the three things the page talks through, so no other file
// needs to know about it:
//  - WebSocket → a scripted socket: demo events enter by the same door as real ones (onMessage → handleEvent);
//  - localStorage → `ccw.demo.*` keys, so demo streaks and badges never mix with real progress;
//  - fetch /api/* → nothing syncs to the watcher's progress.json; Replay plays a canned session, never real logs.
// Mode: ?demo=1 / ?demo=0 force it for one load; otherwise the saved choice (`ccw.mode`), else auto — a live page
// that finds no sessions switches itself to demo. Real sessions starting during a demo only bring an offer to switch.
(() => {
  const safe = fn => { try { return fn(); } catch { return null; } };
  const ls = safe(() => window.localStorage), ss = safe(() => window.sessionStorage);
  const get = (st, k) => safe(() => st?.getItem(k));
  const set = (st, k, v) => safe(() => (v == null ? st?.removeItem(k) : st?.setItem(k, v)));
  const MODE = 'ccw.mode', AUTO = 'ccw.demoAuto';
  const q = new URLSearchParams(location.search).get('demo');
  const saved = get(ls, MODE), desktop = !!window.ccwDesktop; // the Electron windows never switch on their own
  const autoOk = !saved && !desktop && q !== '0';
  const on = window.CCW_DEMO = q === '1' || (q !== '0' && (saved === 'demo' || (autoOk && get(ss, AUTO) === '1')));

  const reload = () => { const u = new URL(location.href); u.searchParams.delete('demo'); location.replace(u); };
  const choose = demo => { set(ls, MODE, demo ? 'demo' : 'live'); set(ss, AUTO, null); reload(); };
  const ready = fn => (document.readyState === 'loading' ? addEventListener('DOMContentLoaded', fn) : fn());

  if (!on) {
    ready(() => {
      const b = document.createElement('button');
      b.id = 'demoBtn';
      b.type = 'button';
      b.textContent = '▶ Demo';
      b.title = 'Show a demo with made-up sessions';
      b.onclick = () => choose(true);
      document.getElementById('sound')?.before(b);
    });
    // Auto: once the watcher has answered (live for a moment, snapshot applied) and there is nothing to show → demo.
    if (autoOk) ready(() => {
      let liveSince = 0;
      const t = setInterval(() => {
        const isLive = safe(() => live), n = safe(() => sessions.size);
        if (!isLive) return void (liveSince = 0);
        liveSince ||= Date.now();
        if (n) return clearInterval(t);
        if (Date.now() - liveSince > 1500) { clearInterval(t); set(ss, AUTO, '1'); reload(); }
      }, 300);
      setTimeout(() => clearInterval(t), 15_000);
    });
    return;
  }

  // --- separate storage ---
  if (ls) {
    const K = k => `ccw.demo.${String(k).replace(/^ccw\./, '')}`;
    const mine = () => Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter(k => k?.startsWith('ccw.demo.'));
    const store = {
      getItem: k => ls.getItem(K(k)), setItem: (k, v) => ls.setItem(K(k), String(v)), removeItem: k => ls.removeItem(K(k)),
      clear: () => mine().forEach(k => ls.removeItem(k)),
      key: i => (k => k && `ccw.${k.slice(9)}`)(mine()[i]), get length() { return mine().length; },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store });
  }

  // --- made-up world ---
  const P = name => ({ name, key: `-home-demo-projects-${name}`, dir: `/home/demo/projects/${name}` });
  const A = { id: 'a7c31f90', ...P('pixel-garden') };
  const B = { id: 'b2e84d17', ...P('recipe-api') };
  const C = { id: 'c9f05a62', ...P('tide-notes') };

  // --- fetch: nothing leaves for the watcher; replay is canned ---
  const REPLAY_START = Date.now() - 26 * 3600_000;
  const REPLAYS = [
    { p: A.key, s: 'demo-replay-1', project: A.name, projectKey: A.key, session: '5d1e7a02', start: REPLAY_START, end: REPLAY_START + 1260_000, bytes: 412_672, live: false },
    { p: B.key, s: 'demo-replay-2', project: B.name, projectKey: B.key, session: '8b40c3fe', start: REPLAY_START - 5400_000, end: REPLAY_START - 4700_000, bytes: 198_144, live: false },
  ];
  function replayEvents() {
    let ts = REPLAY_START;
    const out = [], add = (gap, e) => out.push({ ts: ts += gap * 1000, ...e });
    add(0, { kind: 'text', text: 'I\'ll add watering schedules to the garden. First, the plant model.' });
    for (const f of ['src/plant.ts', 'src/garden.ts', 'src/schedule.ts']) {
      add(3, { kind: 'tool_use', tool: 'Read', input: `${A.dir}/${f}` }); add(1, { kind: 'tool_result', ok: true, preview: 'export …' });
    }
    add(4, { kind: 'tool_use', tool: 'Grep', input: 'waterEvery' }); add(1, { kind: 'tool_result', ok: true, preview: 'src/plant.ts:14' });
    for (const f of ['src/plant.ts', 'src/schedule.ts', 'src/ui/calendar.tsx', 'src/ui/plant-card.tsx']) {
      add(6, { kind: 'tool_use', tool: 'Edit', input: `${A.dir}/${f}` }); add(1, { kind: 'tool_result', ok: true, preview: 'The file has been updated.' });
    }
    add(5, { kind: 'tool_use', tool: 'Bash', input: 'npm test' }); add(9, { kind: 'tool_result', ok: false, preview: '1 failing: schedule › skips frozen days' });
    add(3, { kind: 'text', text: 'One test fails: frozen days still get watered. Fixing the date check.' });
    add(5, { kind: 'tool_use', tool: 'Edit', input: `${A.dir}/src/schedule.ts` }); add(1, { kind: 'tool_result', ok: true, preview: 'The file has been updated.' });
    add(4, { kind: 'tool_use', tool: 'Bash', input: 'npm test' }); add(8, { kind: 'tool_result', ok: true, preview: '48 passing' });
    add(3, { kind: 'turn_end', text: 'Watering schedules are in, frozen days are skipped, and all 48 tests pass.' });
    return out;
  }
  const realFetch = window.fetch?.bind(window);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return realFetch(input, init);
    if (u.pathname === '/api/replays') return Promise.resolve(json({ list: REPLAYS }));
    if (u.pathname === '/api/replay') return Promise.resolve(json({ events: replayEvents() }));
    return Promise.resolve(json({ error: 'demo mode: nothing is synced' }, 403));
  };

  // --- scripted socket ---
  const RealWS = window.WebSocket;
  let sock = null, seq = 0, started = false;
  class DemoSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() {
      this.readyState = 0;
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        sock = this;
        this.onopen?.();
        this.deliver({ kind: 'snapshot', boot: 'demo', events: [] });
        if (!started) { started = true; loop(); }
      }, 150);
    }
    deliver(m) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) }); }
    send() {}
    close() {
      if (this.readyState > 1) return;
      this.readyState = 3;
      if (sock === this) sock = null;
      this.onclose?.();
    }
  }
  window.WebSocket = DemoSocket;
  setInterval(() => sock?.deliver({ kind: 'hb' }), 10_000);

  const emit = (s, kind, x = {}) => sock?.deliver({ session: s.id, project: s.name, projectKey: s.key, ts: Date.now(), kind, seq: ++seq, ...x });
  const pane = s => safe(() => sessions.get(s.id));
  // ~3-minute loop. Times are seconds from the loop start; sleeping and "100 tool calls" are compressed.
  function script() {
    const steps = [];
    let t = 0;
    const at = (dt, fn) => steps.push([t += dt, fn]);
    const call = (s, tool, input, gap = 1.1, res = { ok: true, preview: '' }) => {
      at(gap, () => emit(s, 'tool_use', { tool, input }));
      at(0.6, () => emit(s, 'tool_result', res));
    };
    const edited = { ok: true, preview: 'The file has been updated.' };

    // pixel-garden: a long successful run → combo, streak, files milestone, overheating, then the Code Gods.
    at(0.5, () => emit(A, 'session_start'));
    at(0.8, () => emit(A, 'text', { text: 'Let me see how the garden grid renders before speeding it up.' }));
    call(A, 'Read', `${A.dir}/src/garden.ts`, 1.5);
    call(A, 'Grep', 'renderTile');
    call(A, 'Read', `${A.dir}/src/tiles.ts`);
    const files = ['src/garden.ts', 'src/tiles.ts', 'src/render/canvas.ts', 'src/render/sprites.ts', 'src/render/layers.ts',
      'src/state/plants.ts', 'src/state/weather.ts', 'src/ui/toolbar.tsx', 'src/ui/inspector.tsx', 'src/ui/minimap.tsx',
      'src/util/grid.ts', 'src/util/color.ts'];
    for (const f of files) call(A, 'Edit', `${A.dir}/${f}`, 1.3, edited);
    at(0.5, () => emit(B, 'session_start'));
    call(B, 'Read', `${B.dir}/src/routes/recipes.js`, 0.8);
    call(A, 'Bash', 'npm run bench', 1.2, { ok: true, preview: 'grid render: 41ms → 12ms' });
    call(A, 'Bash', 'npm test', 1.4, { ok: true, preview: '112 passing' });
    at(1.5, () => (s => s && s.combo >= 15 && safe(() => codeGods(s)))(pane(A)));
    at(3, () => emit(A, 'turn_end', { text: 'The grid now renders in 12ms instead of 41ms, and all 112 tests pass.' }));

    // recipe-api: an error, then the comeback; a push that waits for approval first.
    at(2, () => emit(B, 'text', { text: 'Adding pagination to GET /recipes.' }));
    call(B, 'Edit', `${B.dir}/src/routes/recipes.js`, 2, edited);
    call(B, 'Edit', `${B.dir}/src/db/queries.js`, 1.5, edited);
    at(2, () => emit(B, 'tool_use', { tool: 'Bash', input: 'npm test' }));
    at(3, () => emit(B, 'tool_result', { ok: false, preview: '2 failing: GET /recipes › returns page 2 (expected 200, got 500)' }));
    at(4, () => emit(B, 'text', { text: 'Two tests fail: the handler never awaits the count query. Fixing that.' }));
    call(B, 'Read', `${B.dir}/src/db/queries.js`, 2);
    call(B, 'Edit', `${B.dir}/src/routes/recipes.js`, 2, edited);
    call(B, 'Bash', 'npm test', 1.5, { ok: true, preview: '37 passing' });
    call(B, 'Bash', 'npm run lint', 1.5, { ok: true, preview: '0 problems' });
    call(B, 'Bash', 'git commit -am "Paginate GET /recipes"', 1.5, { ok: true, preview: '[main 4c1d2e9] Paginate GET /recipes' });
    at(1.5, () => emit(B, 'tool_use', { tool: 'Bash', input: 'git push' }));
    at(10, () => emit(B, 'tool_result', { ok: true, preview: 'main -> main' }));
    at(2, () => emit(B, 'turn_end', { text: 'Pagination works, tests and lint pass, and it is pushed.' }));

    // tide-notes: a session that has been going for hours → its 100th tool call is the wizard.
    at(3, () => emit(C, 'session_start'));
    at(1, () => (s => s && (s.toolCount = Math.max(s.toolCount, 99)))(pane(C)));
    call(C, 'Read', `${C.dir}/notes/2026-09-30.md`, 0.5);
    call(C, 'Edit', `${C.dir}/src/sync.ts`, 3, edited);
    at(3, () => emit(C, 'turn_end', { text: 'Offline edits now sync when the connection returns.' }));

    // pixel-garden has been quiet "for half an hour": it falls asleep in place.
    at(12, () => (s => s && Object.assign(s, { lastEventAt: Date.now() - 31 * 60_000, expandedAt: Date.now() }))(pane(A)));
    at(40, () => {});
    return steps;
  }
  function loop() {
    const steps = script();
    for (const [sec, fn] of steps) setTimeout(() => safe(fn), sec * 1000);
    setTimeout(loop, steps.at(-1)[0] * 1000 + 1000);
  }

  // --- real Claude Code activity during a demo: offer to switch, never switch on its own ---
  let offered = false;
  if (RealWS) {
    const watch = () => {
      const w = new RealWS(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
      w.onmessage = m => {
        const e = safe(() => JSON.parse(m.data));
        if (!offered && e && (e.kind === 'snapshot' ? e.events?.length : !['hb', 'progress'].includes(e.kind))) {
          offered = true;
          ready(() => document.getElementById('demoOffer')?.removeAttribute('hidden'));
        }
      };
      w.onclose = () => { if (!offered) setTimeout(watch, 10_000); };
    };
    watch();
  }

  // --- always-visible marking: badge (can't be dismissed), striped panes ---
  ready(() => {
    document.body.classList.add('ccw-demo');
    const h1 = document.querySelector('.topbar h1');
    if (h1) h1.textContent = h1.textContent.replace(/live/i, 'Demo'); // the title must never claim "live" here
    const st = document.createElement('style');
    st.textContent = `
      #demoBadge { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 6px; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: 1px; color: #111;
        background: repeating-linear-gradient(135deg, #ffcf4a 0 10px, #ffbf1f 10px 20px); box-shadow: 0 2px 10px rgb(0 0 0 / .35); }
      #demoBadge .live { background: #111; color: #ffcf4a; border-color: #111; }
      #demoOffer { font-weight: 600; letter-spacing: 0; }
      #demoOffer[hidden] { display: none; }
      @media (max-width: 520px) { #demoBadge { right: 12px; flex-wrap: wrap; } }
      #demoBadge button { font: inherit; letter-spacing: 0; font-weight: 600; color: #111; background: rgb(255 255 255 / .55);
        border: 1px solid rgb(0 0 0 / .25); border-radius: 4px; padding: 2px 6px; cursor: pointer; }
      body.ccw-demo .panel { outline: 2px dashed color-mix(in srgb, #ffbf1f 70%, transparent); outline-offset: 2px; }
      body.ccw-demo #conn, body.ccw-demo .topbar h1 { color: #ffbf1f; }
      body.ccw-demo .topbar h1::before { color: #ffbf1f; animation: none; }`;
    document.head.append(st);
    const badge = document.createElement('div');
    badge.id = 'demoBadge';
    badge.setAttribute('role', 'note');
    badge.innerHTML = '<span>DEMO · made-up sessions</span><span id="demoOffer" role="status" hidden>· Real sessions started!</span>'
      + '<button type="button" class="live">Switch to live</button><button type="button" class="credits">Credits</button>';
    badge.querySelector('.live').onclick = () => choose(false);
    badge.querySelector('.credits').onclick = () => document.getElementById('creditsDlg')?.showModal();
    document.body.append(badge);
  });
})();
