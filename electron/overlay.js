// Mascot-only overlay behaviour. main.js runs this inside the overlay window's copy of the normal dashboard page (main
// world, after the page's own scripts), so it can read the live `sessions` and reuse CCWToys; the browser, phone and
// the dashboard window never run it. It changes nothing the page records — it only picks which pane's mascot is shown,
// and turns clicks on Clawd into: click → toy/game popup, double-click → dashboard, drag → move the window.
(() => {
  if (window.ccwOverlay) return;
  window.ccwOverlay = true;
  const D = document, root = D.documentElement, bridge = window.ccwDesktop;
  root.classList.add('ccw-overlay'); // scopes electron/overlay.css; only this window ever gets it
  // Needs you first (waiting on approval, error), then working, done, idle, asleep.
  const RANK = { waiting: 5, error: 4, working: 3, done: 2, idle: 1, away: 0 };
  const HIT = '.panel.ccw-primary .mascot, #ccwClawd, .toy-game, .toy-sticker, .toybox';
  const CLAWD = '.panel.ccw-primary .mascot, #ccwClawd';
  const GAMES = [['hunt', '🎯', 'Pixel hunt'], ['catch', '🫳', 'Catch'], ['bug', '🐞', 'Find bug'], ['reaction', '⚡', 'Reaction']];
  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { console.warn('ccw overlay:', e); } };
  const num = k => parseFloat(getComputedStyle(root).getPropertyValue(k)) || 0;
  const el = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const fallback = el('div'), img = el('img'), badge = el('div');
  fallback.id = 'ccwClawd';
  img.alt = '';
  fallback.append(img);
  badge.id = 'ccwBadge';
  badge.hidden = true;
  D.body.append(fallback, badge);

  // --- which session Clawd shows ---
  let primary = null;
  const rank = o => RANK[o?.state] ?? 0;
  const better = (a, b) => !a || rank(b) > rank(a) || (rank(b) === rank(a) && b.lastEventAt > a.lastEventAt);
  const best = list => list.reduce((a, b) => (better(a, b) ? b : a), null);

  const update = safe(() => {
    const all = [...sessions.values()];
    const shown = all.filter(o => !o.collapsed && o.panel.isConnected);
    let p = best(shown);
    // Stay put when the current pane is just as important, and never yank away a game being played in it.
    if (primary && shown.includes(primary) && (rank(primary) >= rank(p) || CCWToys?.active)) p = primary;
    if (p !== primary) {
      primary?.panel.classList.remove('ccw-primary');
      p?.panel.classList.add('ccw-primary');
      primary = p;
    }
    root.classList.toggle('ccw-has-pane', !!p);
    const who = p ?? best(all);
    if (!p) {
      const src = who?.pose ?? CCW_SPRITES.pose.still;
      if (img.getAttribute('src') !== src) img.src = src;
    }
    badge.hidden = shown.length < 2;
    badge.textContent = shown.length;
    const status = D.body.classList.contains('offline') ? "can't reach the watcher"
      : `${who?.state ?? 'no sessions yet'}${shown.length > 1 ? ` · ${shown.length} sessions` : ''}`;
    const title = `${status}\nclick: toys & games · double-click: dashboard · drag: move`;
    for (const e of [p?.mascot, fallback]) if (e && e.title !== title) e.title = title;
    // A sound preference synced from another device can't wait for a click here to start audio.
    if (soundOn && (!audio || audio.state === 'suspended')) unlockAudio();
  });

  // --- click-through: catch the mouse only over Clawd, the popup, a game or a sticker ---
  let hit = false, dragging = false, down = null, clickTimer = 0, lastXY = null;
  const setHit = on => { if (on !== hit) { hit = on; bridge?.hit(on); } };
  const wantHit = t => dragging || !!D.querySelector('dialog[open]') || !!t?.closest?.(HIT);
  // While clicks pass through, the app sends the real cursor position; once the window catches the mouse, the
  // page's own mouse events are exact and take over until the pointer leaves the hit parts.
  addEventListener('ccw-cursor', () => {
    const xy = root.dataset.ccwCursor ? root.dataset.ccwCursor.split(',').map(Number) : null;
    lastXY = xy;
    if (!hit || !xy) setHit(xy ? wantHit(D.elementFromPoint(...xy)) : dragging || !!D.querySelector('dialog[open]'));
  });
  addEventListener('mousemove', e => { if (hit) { lastXY = [e.clientX, e.clientY]; setHit(wantHit(e.target)); } }, true);
  root.addEventListener('mouseleave', () => { lastXY = null; setHit(dragging || !!D.querySelector('dialog[open]')); });
  // Something under a still pointer can vanish (game ends, popup closes): re-check so no dead spot keeps eating clicks.
  const recheck = () => { if (hit && !dragging) setHit(wantHit(lastXY && D.elementFromPoint(...lastXY))); };

  // --- popup: the dashboard's own toy box plus a games row ---
  const h1 = () => D.querySelector('.topbar h1');
  const box = () => D.querySelector('.toybox');
  const closeBox = () => { if (box()) h1()?.click(); };

  function position(b = box()) {
    if (!b) return;
    const S = num('--sprite'), cx = num('--ccw-cx'), cy = num('--ccw-cy'), gap = num('--ccw-gap'), r = b.getBoundingClientRect();
    b.style.left = `${root.dataset.ccwSide === 'left' ? cx - S / 2 - gap - r.width : cx + S / 2 + gap}px`;
    b.style.top = `${Math.min(Math.max(cy - r.height / 2, 4), innerHeight - r.height - 4)}px`;
  }

  const tile = (ico, label, run) => {
    const t = el('button', 'toy');
    t.type = 'button';
    t.setAttribute('aria-label', label);
    t.append(el('span', 'ico', ico), el('span', 'lbl', label));
    t.onclick = safe(run);
    return t;
  };

  function play(id) {
    closeBox();
    if (!CCWToys?.spawn(id, true)) note('games need a live session on screen', false, 3500);
  }

  function toggleBingo(b) {
    const card = b.querySelector('.bingo');
    if (card) card.remove(); else b.append(CCWToys.bingoCard());
    position(b);
  }

  const openBox = safe(() => {
    if (box()) return;
    h1()?.click(); // the page's toggleBox(): same toys, secrets and auto-close as the dashboard
    const b = box();
    if (!b) return;
    b.append(el('span', 'toy-label', 'games'), ...GAMES.map(([id, ico, label]) => tile(ico, label, () => play(id))),
      tile('▦', 'Bingo', () => toggleBingo(b)));
    position(b);
  });

  // --- Clawd: click, double-click, drag. Captured here so the page's own mascot poke doesn't also fire. ---
  const clawd = t => t?.closest?.(CLAWD);
  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('ccw-dragging');
    bridge?.drag(false);
  };
  addEventListener('pointerdown', safe(e => {
    const c = clawd(e.target);
    if (!c || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    down = { x: e.screenX, y: e.screenY, box: !!box() };
    c.setPointerCapture?.(e.pointerId);
  }), true);
  addEventListener('pointermove', safe(e => {
    if (!down || dragging || Math.hypot(e.screenX - down.x, e.screenY - down.y) < 5) return;
    dragging = true;
    clearTimeout(clickTimer);
    clickTimer = 0;
    root.classList.add('ccw-dragging');
    closeBox();
    setHit(true);
    bridge?.drag(true, [down.x, down.y]); // grab point = where the button went down, so Clawd doesn't lag the cursor
  }), true);
  addEventListener('pointerup', safe(e => {
    if (!down) return;
    e.stopPropagation();
    const wasOpen = down.box;
    down = null;
    if (dragging) return stopDrag();
    if (clickTimer) { // second click in time: dashboard
      clearTimeout(clickTimer);
      clickTimer = 0;
      closeBox();
      return bridge?.dashboard();
    }
    clickTimer = setTimeout(() => { clickTimer = 0; if (wasOpen) closeBox(); else openBox(); }, 350);
  }), true);
  addEventListener('pointercancel', () => { down = null; stopDrag(); }, true);
  for (const t of ['click', 'dblclick']) addEventListener(t, e => { if (clawd(e.target)) { e.stopPropagation(); e.preventDefault(); } }, true);

  // Clicking any other app (or the desktop) closes the popup, like clicking away.
  addEventListener('ccw-blur', () => { closeBox(); stopDrag(); down = null; });
  addEventListener('ccw-geo', () => position());

  update();
  setInterval(() => { update(); recheck(); }, 300);
})();
