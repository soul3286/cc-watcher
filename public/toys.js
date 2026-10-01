// Tier 3 — toys: rare mini-games inside the mascot strips, session bingo filled only by real live events, and a
// hidden toy box (tap the title). Loaded after deep.js and exposed as window.CCWToys. Like deep.js it reaches the main
// script's globals (sessions, live, persist, sfx, burst…) only when called, every entry point runs through fx(), and
// nothing here feeds live state or event progress. Games only ever sit in a pane's mascot strip, never over a feed.
(function () {
  const D = document;
  const el = (tag, cls, text) => {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (cls, text, label) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const anyOf = list => list[Math.floor(Math.random() * list.length)];
  const pad = n => String(n).padStart(2, '0');
  const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  const isLive = () => live && !D.body.classList.contains('offline');
  const calmEnough = () => ['calm', 'active'].includes(D.documentElement.dataset.energy);
  const visiblePanes = () => {
    const list = [...sessions.values()].filter(s => !s.collapsed && s.stage.isConnected && s.stage.offsetParent);
    return focused && list.includes(focused) ? [focused] : list;
  };
  const found = id => { if (unlock(id, 'discovery')) secretNote(); };

  // Pixel art, one character per cell (same format as the sky visitors).
  const ART = {
    bug: { rows: ['.o...o.', '..o.o..', '.ooooo.', 'oeoooeo', '.ooooo.', 'o.o.o.o'], pal: { o: '#8c7667', e: '#f2e4d8' } },
    oddBug: { rows: ['o.....o', '.o...o.', '.ooooo.', 'oeoooeo', '.ooooo.', 'o.o.o.o'], pal: { o: '#8c7667', e: '#f2e4d8' } },
    star: { rows: ['...y...', '..yyy..', 'yyyyyyy', '.yyyyy.', '.yy.yy.', 'y.....y'], pal: { y: '#ffc53d' } },
    heart: { rows: ['.oo.oo.', 'ooooooo', 'ooooooo', '.ooooo.', '..ooo..', '...o...'], pal: { o: '#ff8a3d' } },
    check: { rows: ['......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...', '..g....'], pal: { g: '#ffa94d' } },
    beetle: { rows: ['.a...a.', '..bbb..', '.bbbbb.', 'bbwbwbb', '.bbbbb.', 'b.b.b.b'], pal: { a: '#8c7667', b: '#ffa94d', w: '#0d0a08' } },
    hand: { rows: ['.o.o.o.', '.o.o.o.', '.ooooo.', 'oooooo.', '.oooo..', '..ooo..'], pal: { o: '#f2e4d8' } },
    cup: { rows: ['.s..s..', '..s..s.', '.......', 'wwwww..', 'wbbbwww', 'wbbbw.w', 'wwwwww.', '.www...'], pal: { s: '#8c766799', w: '#f2e4d8', b: '#8c5a3c' } },
  };
  const sprite = (art, cell = 3) => { const e = pixelSprite(art, cell); e.style.position = 'relative'; return e; };

  // -------------------------------------------------------------------------------------------------------------
  // Mini-games. A lottery each minute; only in the recording tab, while live, visible, calm or active, with no sheet
  // open, no pane being dragged and no celebration or sky visitor playing. At most one every 20 minutes.
  const ODDS = { calm: 1 / 30, active: 1 / 45 };
  const GAP_MS = 20 * 60_000, LIFE_MS = 8000;
  let lastGameAt = Date.now() - GAP_MS / 2, game = null;

  const canPlay = () => P?.writer && !P.frozen && isLive() && !D.hidden && !D.querySelector('dialog[open]') && !Deep?.recentlyDragged()
    && calmEnough() && !game && !skyBusy && Date.now() - bigAt > 6000 && visiblePanes().length > 0;

  function tick() {
    if (Date.now() - lastGameAt < GAP_MS || !canPlay()) return;
    if (Math.random() < ODDS[D.documentElement.dataset.energy]) spawn(anyOf(reduceMotion() ? ['hunt', 'bug', 'reaction'] : Object.keys(GAMES)));
  }

  // `force` (console/test hook only) skips the lottery and the gap, but still needs a live, visible pane.
  function spawn(name, force = false) {
    if (!GAMES[name] || game || (force ? !isLive() || !visiblePanes().length : !canPlay())) return false;
    if (name === 'catch' && reduceMotion()) name = 'hunt';
    lastGameAt = Date.now();
    persist(p => p.game(`${name}Shown`));
    GAMES[name](anyOf(visiblePanes()));
    return true;
  }

  function start(name, s, host, life = LIFE_MS) {
    host.classList.add('toy-game');
    s.stage.append(host);
    game = { name, s, host, timers: [setTimeout(() => endGame(false), life)] };
    // A dropped connection ends the game at once: nothing playful stays up over a frozen dashboard.
    game.watch = setInterval(() => fx(() => { if (!isLive() || s.collapsed || !host.isConnected) endGame(false); }), 1000);
    return game;
  }

  function endGame(won, linger = 0) {
    if (!game) return;
    const g = game;
    game = null;
    g.timers.forEach(clearTimeout);
    clearInterval(g.watch);
    g.anim?.cancel();
    if (won) {
      persist(p => p.game(`${g.name}Won`));
      found(`game-${g.name}`);
    }
    g.host.querySelectorAll('button').forEach(b => { b.disabled = true; });
    setTimeout(() => {
      const a = !reduceMotion() && g.host.animate({ opacity: [1, 0] }, { duration: 220, easing: 'ease-out' });
      if (a) a.onfinish = () => g.host.remove(); else g.host.remove();
    }, linger);
    Deep?.refreshSheet();
  }

  // A free 44px spot inside the strip, right of the mascot when there's room (it never leaves the strip).
  function spot(s, w = 44, h = 44) {
    const st = s.stage, m = s.mascot, W = st.clientWidth, H = st.clientHeight;
    const minX = m.offsetLeft + m.offsetWidth + 4 + w < W ? m.offsetLeft + m.offsetWidth + 4 : 4;
    return { x: Math.round(rnd(minX, Math.max(minX, W - w - 4))), y: Math.round(rnd(2, Math.max(2, H - h - 2))), W, H, minX };
  }
  const place = (e, { x, y }) => { e.style.left = `${x}px`; e.style.top = `${y}px`; };
  const closer = () => { const b = btn('toy-x', '✕', 'Dismiss game'); b.onclick = () => fx(() => endGame(false)); return b; };
  const strip = (cls, label) => { const e = el('div', `toy-strip ${cls}`); e.setAttribute('role', 'group'); e.setAttribute('aria-label', label); return e; };
  const cheerWin = (s, host, text) => {
    const r = host.getBoundingClientRect(), st = s.stage.getBoundingClientRect();
    burst(s.stage, { n: 10, spread: 22, x: (r.left + r.width / 2 - st.left) / st.width, y: (r.top + r.height / 2 - st.top) / st.height, color: 'var(--bash)' });
    sfx('success', s);
    note(text, false, 3000);
  };

  const GAMES = {
    // A stray pixel blinks somewhere in the strip; tap it before it fades.
    hunt(s) {
      const b = btn('toy-target hunt', '', 'A stray pixel — tap it');
      b.append(el('i', 'toy-px'));
      place(b, spot(s));
      b.onclick = () => fx(() => { cheerWin(s, b, '✦ pixel caught'); endGame(true); });
      start('hunt', s, b);
    },
    // A pixel drifts across the strip; tap it on the way.
    catch(s) {
      const b = btn('toy-target catch', '', 'A moving pixel — catch it');
      b.append(el('i', 'toy-px'));
      const { minX, W, H } = spot(s), y = Math.max(2, (H - 44) / 2), ltr = Math.random() < 0.5;
      const [x0, x1] = ltr ? [minX, W - 48] : [W - 48, minX];
      place(b, { x: 0, y: 0 });
      const g = start('catch', s, b, 6500);
      g.anim = b.animate([0, 0.25, 0.5, 0.75, 1].map((t, i) => ({
        transform: `translate(${Math.round(x0 + (x1 - x0) * t)}px, ${Math.round(y + (i % 2 ? -1 : 1) * Math.min(18, y - 2))}px)`,
      })), { duration: 6000, easing: 'linear', fill: 'forwards' });
      b.onclick = () => fx(() => {
        b.style.transform = getComputedStyle(b).transform;
        g.anim.cancel();
        cheerWin(s, b, '✦ caught it');
        endGame(true);
      });
    },
    // Five pixel bugs; one is subtly different. One guess.
    bug(s) {
      const host = strip('bugs', 'Find the bug — one is different'), odd = Math.floor(Math.random() * 5);
      host.append(el('span', 'toy-label', 'find the bug'));
      for (let i = 0; i < 5; i++) {
        const b = btn('toy-bug', '', `Bug ${i + 1}`);
        b.append(sprite(i === odd ? ART.oddBug : ART.bug));
        if (i === odd) b.dataset.odd = '';
        b.onclick = () => fx(() => {
          if (!game) return;
          if (i === odd) { cheerWin(s, b, '✦ found the bug'); endGame(true); return; }
          wobble(host);
          host.querySelector('[data-odd]').classList.add('reveal');
          endGame(false, 900);
        });
        host.append(b);
      }
      host.append(closer());
      start('bug', s, host, 12_000);
    },
    // READY? → wait → GO! Nothing starts until the READY? chip is tapped.
    reaction(s) {
      const host = strip('reaction', 'Reaction test'), b = btn('toy-react', 'READY?');
      host.append(b, closer());
      const g = start('reaction', s, host, 10_000);
      let phase = 'ready', goAt = 0;
      const set = (p, text) => { phase = p; b.dataset.phase = p; b.textContent = text; };
      const hit = e => fx(() => {
        if (!game || e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (phase === 'ready') {
          g.timers.forEach(clearTimeout);
          set('wait', 'wait for it…');
          g.timers = [setTimeout(() => { set('go', 'GO!'); goAt = performance.now(); sfx('pop', s); }, rnd(1200, 3500)),
            setTimeout(() => endGame(false), 12_000)];
        } else if (phase === 'wait') {
          set('done', 'too soon!');
          endGame(false, 1200);
        } else if (phase === 'go') {
          const ms = Math.round(performance.now() - goAt), best = persist(p => p.reactionTime(ms)) === true;
          set('done', `${ms}ms${best ? ' · NEW BEST' : ''}`);
          if (best) cheerWin(s, b, `⚡ reaction best · ${ms}ms`); else sfx('success', s);
          endGame(true, 2200);
        }
      });
      // pointerdown, not click: click waits for the finger to lift, which would add its own delay to the time.
      b.addEventListener('pointerdown', hit);
      b.addEventListener('keydown', hit);
    },
  };

  // -------------------------------------------------------------------------------------------------------------
  // Session bingo: a 3×3 card per device per day. Squares fill only from live events this device's recording tab
  // actually receives — never from reconnect catch-up, replays or anything simulated. No free square.
  const BINGO_KEY = 'ccw.bingo';
  const used = (...tools) => (s, ev) => ev.kind === 'tool_use' && tools.includes(ev.tool);
  // `re` is a getter: TEST_RE is a main-script global, which doesn't exist yet while this file loads.
  const okAfter = re => (s, ev) => ev.kind === 'tool_result' && ev.ok && s.lastUse?.tool === 'Bash' && re().test(s.lastUse.input ?? '');
  const SQUARES = {
    error: ['ERROR', (s, ev) => ev.kind === 'tool_result' && !ev.ok],
    test: ['TEST PASSED', okAfter(() => TEST_RE)],
    write: ['FILE WRITTEN', used('Write')],
    tool: ['TOOL CALL', (s, ev) => ev.kind === 'tool_use'],
    streak: ['10x STREAK', s => s.combo >= 10],
    edit: ['EDIT', used('Edit', 'MultiEdit', 'NotebookEdit')],
    search: ['SEARCH', used('Grep', 'Glob')],
    read: ['READ', used('Read')],
    bash: ['COMMAND', used('Bash')],
    commit: ['GIT COMMIT', okAfter(() => /\bgit\s+commit\b/)],
    comeback: ['COMEBACK', s => s.toyComeback],
    agent: ['SUBAGENT', used('Task', 'Agent')],
    web: ['WEB', used('WebFetch', 'WebSearch')],
    todo: ['TODO LIST', used('TodoWrite')],
    done: ['TURN DONE', (s, ev) => ev.kind === 'turn_end'],
    session: ['NEW SESSION', (s, ev) => ev.kind === 'session_start'],
    pair: ['2 SESSIONS AT ONCE', () => [...sessions.values()].filter(o => Date.now() - o.lastEventAt < 60_000).length >= 2],
  };
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  let card = null, lastBingo = null;

  function deal() {
    const ids = Object.keys(SQUARES).sort(() => Math.random() - 0.5).slice(0, 9);
    card = { day: today(), ids, hit: ids.map(() => 0) };
    store.set(BINGO_KEY, JSON.stringify(card));
    return card;
  }
  function currentCard() {
    if (card?.day === today()) return card;
    try {
      const c = JSON.parse(store.get(BINGO_KEY));
      if (c?.day === today() && Array.isArray(c.ids) && c.ids.length === 9 && c.ids.every(id => SQUARES[id]) && Array.isArray(c.hit) && c.hit.length === 9)
        return (card = { day: c.day, ids: c.ids, hit: c.hit.map(t => (Number.isFinite(t) && t > 0 ? t : 0)) });
    } catch {}
    return deal();
  }

  // Called by the main script for each live (never replayed) event, after its own reactions have run.
  function onEvent(s, ev) {
    if (ev.kind === 'tool_result') {
      if (!ev.ok) s.toyErr = true;
      s.toyComeback = ev.ok && s.toyErr && s.combo >= 3;
      if (s.toyComeback) s.toyErr = false;
    } else s.toyComeback = false;
    if (!P?.writer || P.frozen) return;
    const c = currentCard();
    let changed = false;
    c.ids.forEach((id, i) => { if (!c.hit[i] && SQUARES[id][1](s, ev)) { c.hit[i] = Date.now(); changed = true; } });
    if (!changed) return;
    store.set(BINGO_KEY, JSON.stringify(c));
    if (LINES.some(line => line.every(i => c.hit[i]))) {
      lastBingo = { ...c, at: Date.now() };
      persist(p => p.game('bingoWins'));
      // One note, so a first-ever bingo's secret doesn't overwrite the BINGO itself.
      const secret = unlock('game-bingo', 'discovery') ? ` · ✦ secrets found: ${Deep?.secretsFound() ?? '?'}` : '';
      note(`★ BINGO! ★ new card dealt${secret}`, true, 5000);
      // Busy and chaotic dashboards get the note only.
      if (calmEnough() && !s.collapsed) { sfx('fanfare', s); burst(s.mascot, { n: 14, spread: 34, color: 'var(--bash)' }); }
      deal();
    }
    Deep?.refreshSheet();
  }

  function bingoCard(c = currentCard()) {
    const g = el('div', 'bingo');
    g.setAttribute('role', 'grid');
    g.setAttribute('aria-label', 'Bingo card');
    for (let r = 0; r < 3; r++) {
      const row = el('div', 'bingo-row');
      row.setAttribute('role', 'row');
      for (let i = r * 3; i < r * 3 + 3; i++) {
        const cell = el('div', `bingo-cell${c.hit[i] ? ' hit' : ''}`, SQUARES[c.ids[i]][0]);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', `${SQUARES[c.ids[i]][0]}: ${c.hit[i] ? `seen at ${new Date(c.hit[i]).toLocaleTimeString()}` : 'not yet'}`);
        if (c.hit[i]) cell.title = `seen ${new Date(c.hit[i]).toLocaleTimeString()}`;
        row.append(cell);
      }
      g.append(row);
    }
    return g;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Toy box: tap (or Enter on) the title. Every toy is purely decorative — none counts as a milestone or progress,
  // except that first use of each is a secret.
  let box = null, boxTimer = 0;
  const TOYS = [
    ['confetti', '🎉', 'Confetti', confetti],
    ['celebrate', '✨', 'Celebrate', celebrateAll],
    ['sticker', '★', 'Sticker', sticker],
    ['highfive', '✋', 'High five', () => propAll(ART.hand, 'high five!', 'pop')],
    ['coffee', '☕', 'Coffee', () => propAll(ART.cup, 'thanks ☕', 'pop', true)],
    ['doodle', '✎', 'Doodle', openDoodle],
  ];

  function toggleBox(show = !box) {
    clearTimeout(boxTimer);
    if (!show) { box?.remove(); box = null; return; }
    box = el('div', 'toybox');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Toy box');
    box.append(el('span', 'toy-label', 'toy box'));
    for (const [id, icon, label, run] of TOYS) {
      const b = btn('toy', '', label);
      b.append(el('span', 'ico', icon), el('span', 'lbl', label));
      b.onclick = () => fx(() => { toggleBox(false); run(); found(`toy-${id}`); });
      box.append(b);
    }
    $('.topbar').append(box);
    box.querySelector('button').focus({ preventScroll: true });
    found('toybox');
    const idle = () => { clearTimeout(boxTimer); boxTimer = setTimeout(() => toggleBox(false), 10_000); };
    box.addEventListener('pointermove', idle);
    box.addEventListener('focusin', idle);
    idle();
  }

  function confetti() {
    if (reduceMotion()) return note('🎉 confetti!', false, 2500);
    const c = el('canvas', 'toy-confetti'), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    D.body.append(c);
    const ctx = c.getContext('2d'), cell = Math.max(3, Math.round(4 * dpr)), colors = ['--accent', '--bash', '--read', '--text'].map(cssVar);
    const parts = [...Array(90)].map(() => ({ x: rnd(0, W) * dpr, y: rnd(-H * 0.3, 0) * dpr, vx: rnd(-0.6, 0.6) * dpr, vy: rnd(1.5, 3.5) * dpr, color: anyOf(colors) }));
    const t0 = performance.now();
    sfx('party');
    (function frame(t) {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.globalAlpha = Math.min(1, (2400 - (t - t0)) / 500);
      for (const p of parts) {
        p.x += p.vx + Math.sin((t + p.y) / 300) * 0.4 * dpr; p.y += p.vy;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x / cell) * cell, Math.round(p.y / cell) * cell, cell, cell);
      }
      if (t - t0 < 2400 && c.isConnected) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // Looks like a celebration but never goes through celebrate(): no milestone row, no cooldown taken from real ones.
  function celebrateAll() {
    const list = visiblePanes().slice(0, 4);
    if (!list.length || reduceMotion()) note('✨ woo!', false, 2500);
    for (const s of list) { fireworks(s); cheer(s, 'woo!', 'big'); }
    if (list.length) { sweep(); sfx('fanfare', list[0]); }
  }

  function sticker() {
    const s = anyOf(visiblePanes());
    if (!s) return note('no pane to stick it on', false, 2500);
    s.stage.querySelectorAll('.toy-sticker').forEach((x, i, all) => { if (all.length - i > 2) x.remove(); }); // at most 3
    const b = btn('toy-sticker', '', 'Sticker — tap to peel off');
    b.append(sprite(ART[anyOf(['star', 'heart', 'check', 'beetle'])], 4));
    place(b, spot(s));
    s.stage.append(b);
    if (!reduceMotion()) b.animate({ scale: [1.6, 1], rotate: ['-20deg', `${Math.round(rnd(-12, 12))}deg`] }, { duration: 260, easing: EASE, fill: 'forwards' });
    sfx('pop', s);
    const peel = () => {
      const a = !reduceMotion() && b.animate({ opacity: [1, 0], translate: ['0 0', '0 -10px'] }, { duration: 260, easing: 'ease-in' });
      if (a) a.onfinish = () => b.remove(); else b.remove();
    };
    b.onclick = () => fx(peel);
    setTimeout(() => fx(peel), 120_000);
  }

  // High five / coffee: a pixel prop pops up beside each visible mascot, which hops and says thanks.
  function propAll(art, line, sound, steam = false) {
    const list = visiblePanes().slice(0, 4);
    if (!list.length) return note(line, false, 2500);
    for (const s of list) {
      const p = el('div', 'toy-prop');
      p.append(sprite(art, 3));
      s.mascot.append(p);
      hop(s.mascot);
      say(s, line, 1, true);
      if (!reduceMotion()) {
        p.animate({ translate: ['0 8px', '0 0'], opacity: [0, 1] }, { duration: 220, easing: EASE });
        if (steam) burst(p, { n: 3, spread: 10, size: 2, y: 0.1, color: 'var(--dim)', dur: 1200 });
      }
      setTimeout(() => p.remove(), 2600);
    }
    sfx(sound, list[0]);
  }

  // Ripple: a tap on empty dashboard background sends out a ring of pixels. Never prevents default, so it can't
  // interfere with scrolling, and panes (the real content) never ripple.
  function ripple(e) {
    if (reduceMotion() || e.button > 0 || Deep?.recentlyDragged() || !e.target.matches('main, #grid, #dock, #dockList, #empty')) return;
    const layer = $('#sky');
    for (let i = 0; i < 12; i++) {
      const p = el('i', 'px');
      p.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;width:3px;height:3px;background:var(--accent);position:fixed`;
      layer.append(p);
      const a = (i / 12) * Math.PI * 2;
      p.animate([{ transform: 'translate(-50%,-50%)', opacity: 0.9 },
        { transform: `translate(calc(-50% + ${Math.round(Math.cos(a) * 26)}px), calc(-50% + ${Math.round(Math.sin(a) * 26)}px))`, opacity: 0 }],
      { duration: 520, easing: 'ease-out' }).onfinish = () => p.remove();
    }
    found('toy-ripple');
  }

  // Doodle: a 32×24 pixel pad inside a sheet. Only the pad takes touches (touch-action: none on it alone), so the
  // page and the sheet scroll normally everywhere else. Doodles are never saved.
  const PAD_W = 32, PAD_H = 24;
  let ink = '', drawing = null;
  function openDoodle() {
    if (!ink) ink = cssVar('--accent');
    renderInks();
    $('#doodleDlg').showModal();
  }
  function renderInks() {
    $('#doodleInks').replaceChildren(...['--accent', '--bash', '--read', '--text', '--bg'].map(v => {
      const color = cssVar(v), b = btn('ink', v === '--bg' ? '⌫' : '', v === '--bg' ? 'Eraser' : `Ink ${v.slice(2)}`);
      b.style.setProperty('--ink', color);
      b.setAttribute('aria-pressed', color === ink);
      b.onclick = () => { ink = color; renderInks(); };
      return b;
    }));
  }
  function padCell(e) {
    const r = $('#doodlePad').getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * PAD_W), Math.floor((e.clientY - r.top) / r.height * PAD_H)];
  }
  function paint(from, to) {
    const ctx = $('#doodlePad').getContext('2d'), n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1);
    ctx.fillStyle = ink;
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(from[0] + (to[0] - from[0]) * i / n), Math.round(from[1] + (to[1] - from[1]) * i / n), 1, 1);
  }
  function clearPad() {
    const ctx = $('#doodlePad').getContext('2d');
    ctx.fillStyle = cssVar('--bg');
    ctx.fillRect(0, 0, PAD_W, PAD_H);
  }
  function initDoodle() {
    const c = $('#doodlePad');
    c.width = PAD_W; c.height = PAD_H;
    clearPad();
    c.addEventListener('pointerdown', e => fx(() => {
      c.setPointerCapture(e.pointerId);
      drawing = padCell(e);
      paint(drawing, drawing);
    }));
    c.addEventListener('pointermove', e => fx(() => { if (!drawing) return; const at = padCell(e); paint(drawing, at); drawing = at; }));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(t, () => { drawing = null; });
    $('#doodleClear').onclick = () => fx(clearPad);
  }

  // -------------------------------------------------------------------------------------------------------------
  function init() {
    const h1 = $('.topbar h1');
    h1.tabIndex = 0;
    h1.setAttribute('role', 'button');
    h1.setAttribute('aria-label', 'Claude Code · Live');
    h1.addEventListener('click', () => fx(() => toggleBox()));
    h1.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fx(() => toggleBox()); } });
    D.addEventListener('pointerdown', e => fx(() => { if (box && !box.contains(e.target) && !h1.contains(e.target)) toggleBox(false); }), true);
    $('main').addEventListener('pointerdown', e => fx(() => ripple(e)));
    // Esc dismisses a game or the toy box first; only then does it reach focus mode and the rest.
    addEventListener('keydown', e => {
      if (e.key !== 'Escape' || D.querySelector('dialog[open]') || !(game || box)) return;
      e.stopPropagation();
      fx(() => { if (box) { toggleBox(false); h1.focus({ preventScroll: true }); } else endGame(false); });
    }, true);
    D.addEventListener('visibilitychange', () => fx(() => { if (D.hidden) endGame(false); }));
    initDoodle();
    setInterval(() => fx(tick), 60_000);
  }

  window.CCWToys = {
    init, onEvent, bingoCard, spawn,
    get lastBingo() { return lastBingo; },
    get active() { return game?.name ?? null; },
  };
})();
