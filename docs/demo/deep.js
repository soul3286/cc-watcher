// Tier 2 — deep interaction: the stats sheet (session / today / records / achievements / secrets), dashboard energy,
// event exploration and pane reordering. Loaded before the main script and exposed as window.CCWDeep. It reaches the
// main script's globals (sessions, persist, live, sfx…) only when called, never at load, and never feeds live state.
(function () {
  const D = document;
  const el = (tag, cls, text) => {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtNum = n => (typeof n === 'number' ? n.toLocaleString() : n);
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const pad = n => String(n).padStart(2, '0');
  const dayKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const longDay = k => dateOf(k).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const kv = rows => {
    const dl = el('dl', 'kv');
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', fmtNum(v)));
    return dl;
  };
  const section = (title, ...kids) => { const s = el('section', 'sec'); s.append(el('h3', '', title), ...kids); return s; };
  const projName = key => persist(p => p.nickname(key)) || persist(p => p.project(key)?.name) || key;
  const secretsFound = d => Object.keys(d.discovery).length + Object.keys(d.eggs).length;

  // ---------------------------------------------------------------------------------------------------------------
  // Catalogs. Ids are the ones the main script unlocks; secret entries stay "???" until earned.
  const ACHIEVEMENTS = [
    ['firstBlood', 'FIRST BLOOD', 'First successful action.'],
    ['comboStarter', 'COMBO STARTER', 'Reach a 5x combo.'],
    ['firstTest', 'GREEN LIGHT', 'First passing test run.'],
    ['century', 'CENTURY', '100 successful actions.'],
    ['personalBest', 'PERSONAL BEST', 'Beat your best combo.'],
    ['comeback', 'COMEBACK', 'Bounce back from an error with a 5x combo.'],
    ['speedDemon', 'SPEED DEMON', '10 clean results in 15 seconds.'],
    ['nightOwl', 'NIGHT OWL', 'Watch activity between midnight and 5am.'],
    ['marathon', 'MARATHON', 'A 4-hour session.'],
    ['events-1000', 'LOOKOUT', '1,000 events observed.'],
    ['successes-1000', 'ONE THOUSAND', '1,000 successful actions.'],
    ['events-10000', 'WATCHTOWER', '10,000 events observed.'],
    ['successes-10000', 'TEN THOUSAND', '10,000 successful actions.'],
    ['events-100000', 'OBSERVATORY', '100,000 events observed.', true],
    ['comboLegend', 'LEGEND', 'A 500x combo.', true],
    ['codeGods', 'FAVOURED', 'The code gods smiled on a long combo.', true],
  ];
  const SECRETS = {
    secretHandshake: 'Secret handshake', codeGods: 'The code gods', ufo: 'UFO sighting', ufoSpooked: 'Spooked the UFO',
    traveler: 'The traveler', meteor: 'Meteor', moon: 'Midnight moon',
    wizard: 'Wizard mode', juggling: 'Push juggle', happy: 'Test dance', dizzy: 'rm -rf dizzy', overheated: 'Overheated',
    annoyed: 'Annoyed', doubleJump: 'Double jump', party: 'Party mode',
    toybox: 'The toy box', 'toy-confetti': 'Confetti', 'toy-celebrate': 'Just because', 'toy-sticker': 'Sticker book',
    'toy-highfive': 'High five', 'toy-coffee': 'Coffee break', 'toy-doodle': 'Doodler', 'toy-ripple': 'Ripples',
    'game-hunt': 'Pixel hunter', 'game-catch': 'Quick hands', 'game-bug': 'Bug spotter', 'game-reaction': 'Reflexes', 'game-bingo': 'BINGO!',
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Dashboard energy: events/min across every live session over a rolling 2 minutes. Levels ease one step at a time
  // (quicker up than down) and drop to "unknown" the moment the watcher is unreachable.
  const ENERGY = ['calm', 'active', 'busy', 'chaotic'];
  const ENERGY_HINT = {
    calm: 'Calm — under 5 events a minute across all sessions',
    active: 'Active — 5 to 20 events a minute across all sessions',
    busy: 'Busy — 20 to 60 events a minute across all sessions',
    chaotic: 'Chaotic — over 60 events a minute, or more than 30% of results failing',
  };
  const WINDOW_MS = 120_000, UP_MS = 3000, DOWN_MS = 8000;
  const MOTES = [0, 3, 7, 12], TICK_GAP_MS = [1200, 1200, 2500, 5000];
  let hits = []; // [time, failed: true | false | null (not a result)]
  let level = 0, levelAt = 0, known = false;

  function energyEvent(ev, replayed) {
    if (ev.kind === 'session_start') return;
    hits.push([replayed ? ev.ts : Date.now(), ev.kind === 'tool_result' ? !ev.ok : null]);
  }

  function energyTarget(now) {
    hits = hits.filter(([t]) => now - t <= WINDOW_MS);
    const perMin = hits.length * 60_000 / WINDOW_MS;
    const results = hits.filter(h => h[1] !== null), failed = results.filter(h => h[1]).length;
    // A couple of failures in a quiet stretch isn't chaos: the error rule needs ACTIVE traffic and 5+ results.
    if (perMin > 60 || (perMin >= 5 && results.length >= 5 && failed / results.length > 0.3)) return 3;
    return perMin >= 20 ? 2 : perMin >= 5 ? 1 : 0;
  }

  function energyTick() {
    if (!live) {
      if (known) { known = false; level = 0; renderEnergy(); }
      return;
    }
    const now = Date.now(), target = energyTarget(now), was = known;
    known = true;
    if (target !== level && now - levelAt >= (target > level ? UP_MS : DOWN_MS)) {
      level += Math.sign(target - level);
      levelAt = now;
      renderEnergy();
    } else if (!was) renderEnergy();
  }

  function renderEnergy() {
    const name = ENERGY[level], badge = $('#energy');
    D.documentElement.dataset.energy = known ? name : 'calm';
    badge.dataset.level = known ? level : -1;
    badge.querySelector('b').textContent = known ? name : '—';
    badge.title = known ? ENERGY_HINT[name] : 'Dashboard energy — unknown while not connected';
    badge.setAttribute('aria-label', `Dashboard energy: ${known ? name : 'unknown, not connected'}`);
    renderMotes(known ? MOTES[level] : 0);
  }

  // Ambient pixel motes drifting up behind the panes; count follows energy, none when calm.
  function renderMotes(n) {
    const layer = $('#motes');
    if (reduceMotion()) n = 0;
    while (layer.children.length > n) layer.lastElementChild.remove();
    while (layer.children.length < n) {
      const m = el('i');
      m.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;animation-duration:${14 + Math.round(Math.random() * 12)}s;`
        + `animation-delay:-${Math.round(Math.random() * 20)}s;opacity:${(0.14 + Math.random() * 0.2).toFixed(2)}`;
      layer.append(m);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Stats sheet. Session stats come from live panes (frozen and labelled "not live" while disconnected); everything
  // else comes from saved progress.
  const TABS = { session: renderSession, today: renderToday, records: renderRecords, achievements: renderAchievements, secrets: renderSecrets, games: renderGames };
  let tab = 'session', dayPicked = null, milestones = 0, refreshTimer = 0;

  const liveLine = () => (live ? el('p', 'live-line on', '● LIVE')
    : el('p', 'live-line off', `NOT LIVE — frozen as of ${lastMsgAt ? new Date(lastMsgAt).toLocaleTimeString() : 'never connected'}`));

  function renderSession(body) {
    const list = [...sessions.values()], now = live ? Date.now() : lastMsgAt || Date.now();
    body.append(liveLine());
    if (!list.length) return body.append(el('p', 'note', 'No sessions yet — this fills in with the first event.'));
    const sum = k => list.reduce((n, s) => n + (s[k] ?? 0), 0), max = f => Math.max(0, ...list.map(f));
    const age = s => Math.max(0, now - (persist(p => p.sessionFirstSeen(s.id)) ?? s.startedAt));
    const open = list.filter(s => !s.collapsed);
    body.append(kv([
      ['Events', sum('count')], ['Successful actions', sum('ok')], ['Errors', sum('err')],
      ['Current combo', `${max(s => s.combo)}x`], ['Best combo', `${max(s => s.maxCombo ?? 0)}x`],
      ['Best streak', max(s => s.maxRun ?? 0)], ['Personal best combo', P ? `${P.data.records.bestCombo}x` : '—'],
      ['Longest session', fmtDuration(max(age))], ['Projects active', new Set(open.map(s => s.key ?? s.id)).size],
      ['Milestones reached', milestones],
    ]));
    const table = el('table', 'panes');
    const head = table.createTHead().insertRow();
    for (const h of ['Session', 'Events', 'OK', 'Err', 'Best', 'Time']) head.append(el('th', '', h));
    const tb = table.createTBody();
    for (const s of list) {
      const r = tb.insertRow(), name = el('td', 'name', displayName(s));
      if (s.collapsed) name.append(el('span', 'docked', ' · idle'));
      r.append(name, ...[s.count, s.ok ?? 0, s.err ?? 0, `${s.maxCombo ?? 0}x`, fmtDuration(age(s))].map(v => el('td', '', fmtNum(v))));
    }
    body.append(section('Per session', table),
      el('p', 'note', "Covers what this page has seen since it connected, plus the watcher's last 30 minutes. Lifetime totals are under Records."));
  }

  const mostActive = projects => {
    const [key, n] = Object.entries(projects ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [];
    return key ? `${projName(key)} (${fmtNum(n)})` : '—';
  };

  function renderToday(body) {
    const data = P.data, t = new Date();
    const days = [...Array(7)].map((_, i) => dayKeyOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6 + i)));
    const picked = days.includes(dayPicked) ? dayPicked : days[6];
    const peak = Math.max(1, ...days.map(k => data.daily[k]?.events ?? 0));
    const chart = el('div', 'days');
    chart.setAttribute('role', 'group');
    chart.setAttribute('aria-label', 'Last 7 days — pick a day');
    for (const k of days) {
      const n = data.daily[k]?.events ?? 0, b = el('button', 'day'), col = el('span', 'col'), bar = el('span', 'bar');
      b.type = 'button';
      b.setAttribute('aria-pressed', k === picked);
      b.setAttribute('aria-label', `${longDay(k)}: ${n} events`);
      b.title = `${fmtNum(n)} events`;
      bar.style.height = `${Math.round((n / peak) * 100)}%`;
      col.append(bar);
      b.append(col, el('span', 'lbl', k === days[6] ? 'today' : dateOf(k).toLocaleDateString(undefined, { weekday: 'short' })));
      b.onclick = () => { dayPicked = k; renderSheet(true); };
      chart.append(b);
    }
    const d = data.daily[picked];
    body.append(section(picked === days[6] ? 'Today' : longDay(picked), chart, d ? kv([
      ['Events', d.events], ['Successful actions', d.successfulActions], ['Errors', d.errors],
      ['Best streak', d.bestRun], ['Best combo', `${d.bestCombo}x`], ['Longest session', fmtDuration(d.longestSessionMs)],
      ['Most active project', mostActive(d.projects)], ['Most sessions at once', d.peakActive],
    ]) : el('p', 'note', 'Nothing observed that day.')));
    body.append(kv([['Day streak', `${P.dayStreak} · best ${data.records.bestDayStreak}`]]),
      el('p', 'note', 'Days roll over at local midnight. All-time bests are under Records.'));
  }

  function renderRecords(body) {
    const { totals: t, records: r, projects, achievements } = P.data;
    const [topKey, top] = Object.entries(projects).sort((a, b) => b[1].events - a[1].events)[0] ?? [];
    body.append(section('Lifetime', kv([
      ['Events observed', t.events], ['Successful actions', t.successfulActions], ['Errors', t.errors],
      ['Sessions', t.sessions], ['Projects', Object.keys(projects).length],
      ['Best streak', r.bestRun], ['Best combo', `${r.bestCombo}x`], ['Longest session', fmtDuration(r.longestSessionMs)],
      ['Most sessions at once', r.peakActive], ['Day streak', `${P.dayStreak} · best ${r.bestDayStreak}`],
      ['Achievements', ACHIEVEMENTS.filter(([id]) => achievements[id]).length], ['Secrets found', secretsFound(P.data)],
    ])), section('Best days', kv([
      ['Most events in a day', r.bestDayEvents], ['Most successes in a day', r.bestDaySuccesses],
      ['Most active project', topKey ? `${projName(topKey)} (${fmtNum(top.events)})` : '—'],
    ])), el('p', 'note', "Saved by the watcher on your computer and shared by every device you open it on (each keeps a copy for when it can't reach the watcher). Live sessions are never saved — they're rebuilt from the watcher every time the page connects."));
  }

  function renderAchievements(body) {
    const got = P.data.achievements;
    body.append(el('p', 'big-count', `${ACHIEVEMENTS.filter(([id]) => got[id]).length} / ${ACHIEVEMENTS.length} unlocked`));
    const ul = el('ul', 'achs');
    for (const [id, name, desc, secret] of ACHIEVEMENTS) {
      const at = got[id], shown = at || !secret, li = el('li', `ach ${at ? 'got' : secret ? 'secret' : 'locked'}`);
      li.append(el('span', 'medal'), el('b', '', shown ? name : '???'), el('span', 'desc', shown ? desc : 'Secret — keep watching.'));
      if (at) { const time = el('time', '', fmtDate(at)); time.dateTime = new Date(at).toISOString(); li.append(time); }
      ul.append(li);
    }
    body.append(ul);
  }

  function renderSecrets(body) {
    const { discovery, eggs } = P.data;
    const found = [...Object.entries(discovery).map(([k, t]) => [k, t, 0]), ...Object.entries(eggs).map(([k, e]) => [k, e.first, e.count])]
      .sort((a, b) => a[1] - b[1]);
    body.append(el('p', 'big-count', `SECRETS FOUND: ${found.length}`));
    if (!found.length) return body.append(el('p', 'note', 'Nothing yet. Some things only happen once in a long while — keep watching.'));
    const ul = el('ul', 'secrets');
    for (const [k, t, n] of found) {
      const li = el('li', 'secret-row');
      li.append(el('span', 'star', '✦'), el('b', '', SECRETS[k] ?? k), el('time', '', `${fmtDate(t)}${n > 1 ? ` · ×${n}` : ''}`));
      ul.append(li);
    }
    body.append(ul, el('p', 'note', "How many are there? That's a secret too."));
  }

  // Games: today's bingo card (this device) and mini-game tallies summed over every device.
  function renderGames(body) {
    const T = window.CCWToys, t = P.gameTotals, last = T?.lastBingo;
    const of = g => (t[`${g}Shown`] ? `${fmtNum(t[`${g}Won`])} / ${fmtNum(t[`${g}Shown`])}` : '—');
    if (T) body.append(section('Bingo', T.bingoCard(), el('p', 'note', last
      ? `Last BINGO at ${new Date(last.at).toLocaleTimeString()} — a fresh card was dealt.`
      : 'Squares fill only from real events this device sees live. Any line of three is a BINGO. New card each day.')));
    body.append(section('Games', kv([
      ['Reaction best', t.reactionBest ? `${fmtNum(t.reactionBest)}ms` : '—'], ['Bingos', t.bingoWins],
      ['Pixel Hunt (caught / seen)', of('hunt')], ['Catch the Pixel (caught / seen)', of('catch')],
      ['Find the Bug (found / seen)', of('bug')], ['Reaction tests (finished / offered)', of('reaction')],
    ])), el('p', 'note', 'Mini-games pop up rarely, only while the dashboard is live and calm. Your tallies are shared by every device.'));
  }

  function renderSheet(keepScroll = false) {
    const dlg = $('#progressDlg'), body = $('#sheetBody'), top = body.scrollTop;
    for (const b of dlg.querySelectorAll('[role=tab]')) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    }
    body.replaceChildren();
    if (!P && tab !== 'session') body.append(el('p', 'note', 'Saved progress is unavailable in this browser.'));
    else fx(() => TABS[tab](body));
    if (keepScroll) body.scrollTop = top;
    // "fresh" describes load time; once anything is recorded it's no longer true.
    const status = P?.status === 'fresh' && P.data.totals.events ? null : P?.status;
    $('#progressNote').textContent = P && tab !== 'session'
      ? [!P.writer && 'Another cc-watcher tab is recording — this one is view-only.', PROGRESS_NOTES[status]].filter(Boolean).join(' ') : '';
    $('#progressReset').hidden = !P || tab !== 'records';
  }

  function openStats() {
    renderSheet();
    $('#progressDlg').showModal();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!$('#progressDlg').open) return clearInterval(refreshTimer);
      if (tab === 'session' && live) renderSheet(true);
    }, 2000);
  }

  function setTab(name, focus = false) {
    tab = name;
    renderSheet();
    $('#sheetBody').scrollTop = 0;
    if (focus) $(`#progressDlg [data-tab=${name}]`).focus();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Event exploration: tap/click a log row for its details, the events around it, and a replay of its effect.
  const KIND = { tool_use: 'Tool call', tool_result: 'Tool result', turn_end: 'Turn finished', text: 'Message' };
  const fmtGap = ms => (ms < 1000 ? `${Math.max(0, ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : fmtDuration(ms));
  const TRUNCATED_AT = 159; // the watcher keeps the first 160 characters of inputs/results
  let evRow = null;

  function selectRow(row) {
    D.querySelectorAll('.ev.sel').forEach(r => r.classList.remove('sel'));
    row?.classList.add('sel');
  }

  function onFeedClick(e) {
    const row = e.target.closest('.ev');
    if (!row?.ev || String(getSelection() ?? '')) return; // selecting text to copy isn't a tap
    openEvent(row);
  }

  function onFeedKey(s, e) {
    const rows = [...s.feed.children];
    if (!rows.length) return;
    const cur = s.feed.querySelector('.ev.sel');
    if (e.key === 'Enter' || e.key === ' ') { if (cur) { e.preventDefault(); openEvent(cur); } return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = cur ? rows.indexOf(cur) : rows.length, next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))];
    selectRow(next);
    next.scrollIntoView({ block: 'nearest' });
  }

  function openEvent(row) {
    evRow = row;
    selectRow(row);
    renderEvent();
    if (!$('#eventDlg').open) $('#eventDlg').showModal();
  }

  function renderEvent() {
    const row = evRow, { ev, sess: s } = row, body = $('#eventBody');
    const rows = [...s.feed.children], i = rows.indexOf(row), prev = rows[i - 1]?.ev;
    const text = row.querySelector('.body').textContent;
    $('#eventTitle').textContent = `${row.querySelector('.tag').textContent} · ${new Date(ev.ts).toLocaleTimeString()}`;
    body.replaceChildren();
    if (row.notable) body.append(el('p', 'notable-why', `✦ ${row.notable}`));
    if (text) {
      const pre = el('pre', 'ev-text', text);
      pre.dataset.group = row.dataset.group;
      body.append(pre);
      if (text.length >= TRUNCATED_AT) body.append(el('p', 'note', 'Shortened — the watcher keeps the first 160 characters.'));
    }
    body.append(kv([
      ['Session', `${displayName(s)} · ${s.id}`], ['Kind', KIND[ev.kind] ?? ev.kind], ...(ev.tool ? [['Tool', ev.tool]] : []),
      ...(ev.kind === 'tool_result' ? [['Result', ev.ok ? 'success' : 'error']] : []),
      ['Time', new Date(ev.ts).toLocaleString()], ['Since previous', prev ? fmtGap(ev.ts - prev.ts) : '—'],
      ['In this log', i < 0 ? 'scrolled out' : `${i + 1} of ${rows.length}`],
    ]));
    if (i >= 0) {
      const ctx = el('ol', 'ctx');
      for (let j = Math.max(0, i - 3); j <= Math.min(rows.length - 1, i + 3); j++) {
        const r = rows[j], b = el('button', j === i ? 'cur' : '');
        b.type = 'button';
        b.dataset.group = r.dataset.group;
        b.append(el('span', 'time', new Date(r.ev.ts).toLocaleTimeString()), el('span', 'tag', r.querySelector('.tag').textContent),
          el('span', 'txt', r.querySelector('.body').textContent));
        if (j === i) b.setAttribute('aria-current', 'true');
        else b.onclick = () => openEvent(r);
        const li = el('li');
        li.append(b);
        ctx.append(li);
      }
      body.append(section('Around it', ctx));
    }
    const replay = $('#evReplay');
    $('#evPrev').disabled = i <= 0;
    $('#evNext').disabled = i < 0 || i >= rows.length - 1;
    replay.disabled = s.collapsed || !s.panel.isConnected;
    replay.title = replay.disabled ? 'This pane is docked — expand it first' : "Play this event's effect again (labelled as a replay)";
    row.scrollIntoView({ block: 'nearest' });
  }

  function stepEvent(dir) {
    const next = dir < 0 ? evRow?.previousElementSibling : evRow?.nextElementSibling;
    if (next?.ev) openEvent(next);
  }

  // Cosmetic only and labelled "replay": no pane state, badge or progress changes.
  function replayEffect() {
    const row = evRow, ev = row?.ev, s = row?.sess;
    $('#eventDlg').close();
    if (!s || s.collapsed) return;
    setTimeout(() => fx(() => {
      cheer(s, '↺ replay', 'say');
      if (ev.kind === 'tool_use') { flashLed(s); hop(s.mascot); sfx('tick', s, row.dataset.group); }
      else if (ev.kind === 'tool_result' && ev.ok) { burst(s.mascot, { n: 6, spread: 18 }); sfx('success', s); }
      else if (ev.kind === 'tool_result') { wobble(s.panel); wobble(s.mascot); sfx('error', s); }
      else if (ev.kind === 'turn_end') { burst(s.mascot, { n: 10, spread: 28 }); sfx('complete', s); }
      else pop(s.verb);
      if (row.notable) { burst(s.mascot, { n: 12, spread: 34, color: 'var(--bash)' }); sfx('milestone', s); }
      row.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
      if (!reduceMotion()) row.animate({ backgroundColor: ['color-mix(in srgb, var(--accent) 35%, transparent)', 'transparent'] }, { duration: 900, easing: 'ease-out' });
    }), 120);
  }

  // Row bookkeeping, called by the main script as each row is appended.
  function tagRow(row, s, ev) {
    row.ev = ev;
    row.sess = s;
    if (!s.notable) return;
    row.classList.add('notable');
    row.notable = s.notable;
    row.title = `✦ ${s.notable}`;
    s.notable = null;
  }

  // Counts milestones this page has reached, and marks the event that caused one as notable.
  function milestone(s, msg) {
    milestones++;
    if (s) s.notable = msg;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Pane reordering. Mouse: drag the header. Touch: long-press the header, or drag the ⠿ grip straight away (it opts
  // out of scrolling, so it never fights the page). Keyboard: arrow keys on the grip. Order is saved per project in
  // prefs, so it syncs between devices; pinned panes stay above unpinned ones.
  const LONG_PRESS_MS = 450, SLOP = 8, EDGE = 56;
  let press = null, drag = null, dragEndedAt = 0;

  const sameGroup = (a, b) => isPinned(a) === isPinned(b);
  const visiblePanes = () => [...grid.children].map(p => p.sess).filter(Boolean);

  function initReorder(s) {
    const head = s.panel.querySelector('.panel-head'), grip = s.panel.querySelector('.act.grip');
    s.panel.sess = s;
    if (!s.key) return;
    grip.hidden = false;
    grip.addEventListener('pointerdown', e => startPress(s, e, true));
    grip.addEventListener('keydown', e => keyMove(s, e));
    grip.addEventListener('click', () => { if (Date.now() - dragEndedAt > 300) note('Drag ⠿ to move this pane · arrow keys work too'); });
    head.addEventListener('pointerdown', e => { if (!e.target.closest('button, input')) startPress(s, e, false); });
    head.addEventListener('contextmenu', e => { if (press || drag) e.preventDefault(); });
  }

  function startPress(s, e, fromGrip) {
    if (drag || press || focused || s.collapsed || e.button !== 0 || !e.isPrimary) return;
    press = { s, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', timer: 0, last: null };
    if (press.touch && fromGrip) return begin(e);
    if (press.touch) {
      s.panel.classList.add('pressing');
      press.timer = setTimeout(() => { if (press) { navigator.vibrate?.(12); begin(press.last ?? e); } }, LONG_PRESS_MS);
    }
  }

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.s.panel.classList.remove('pressing');
    press = null;
  }

  function begin(e) {
    const { s, id } = press, r = s.panel.getBoundingClientRect();
    cancelPress();
    drag = { s, id, offX: e.clientX - r.left, offY: e.clientY - r.top, tx: 0, ty: 0, x: e.clientX, y: e.clientY, swapAt: 0, raf: 0, start: visiblePanes() };
    getSelection()?.removeAllRanges(); // a mouse drag across the header shouldn't leave text highlighted
    s.panel.classList.add('dragging');
    D.body.classList.add('reordering');
    try { s.panel.querySelector('.panel-head').setPointerCapture(id); } catch {}
    sfx('pop', s);
    follow();
  }

  function onMove(e) {
    if (press && e.pointerId === press.id) {
      press.last = e;
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP;
      if (far && press.touch) cancelPress(); // moved before the long-press armed: it's a scroll
      else if (far) begin(e);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    follow();
    autoScroll();
  }

  const place = () => {
    const r = drag.s.panel.getBoundingClientRect();
    drag.tx = drag.x - drag.offX - (r.left - drag.tx);
    drag.ty = drag.y - drag.offY - (r.top - drag.ty);
    drag.s.panel.style.translate = `${drag.tx}px ${drag.ty}px`;
  };

  // Keeps the lifted pane under the pointer and slots it into place as it passes over another pane.
  function follow() {
    const { s } = drag;
    place();
    if (Date.now() - drag.swapAt < 200) return; // let the last shuffle settle before hit-testing again
    const over = visiblePanes().find(o => {
      if (o === s || !sameGroup(o, s)) return false;
      const b = o.panel.getBoundingClientRect();
      return drag.x >= b.left && drag.x <= b.right && drag.y >= b.top && drag.y <= b.bottom;
    });
    if (!over) return;
    const kids = [...grid.children], after = kids.indexOf(s.panel) < kids.indexOf(over.panel);
    moveAnimated(s, after ? over.panel.nextElementSibling : over.panel);
    drag.swapAt = Date.now();
    place();
  }

  // FLIP: neighbours glide to their new slots instead of jumping. Moving a node resets its feed's scroll, so restore it.
  function moveAnimated(s, before) {
    const others = visiblePanes().filter(o => o !== s), from = new Map(others.map(o => [o, o.panel.getBoundingClientRect()]));
    const top = s.feed.scrollTop;
    grid.insertBefore(s.panel, before);
    s.feed.scrollTop = s.atBottom ? s.feed.scrollHeight : top;
    if (reduceMotion()) return;
    for (const [o, a] of from) {
      const b = o.panel.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) o.panel.animate({ transform: [`translate(${dx}px, ${dy}px)`, 'none'] }, { duration: 180, easing: EASE });
    }
  }

  function autoScroll() {
    cancelAnimationFrame(drag.raf);
    const g = grid.getBoundingClientRect(), v = drag.y < g.top + EDGE ? -1 : drag.y > g.bottom - EDGE ? 1 : 0;
    if (!v) return;
    drag.raf = requestAnimationFrame(() => {
      if (!drag) return;
      grid.scrollTop += v * 10;
      follow();
      autoScroll();
    });
  }

  const placeAll = () => { for (const o of orderedSessions().reverse()) if (!o.collapsed) placePanel(o); };

  function end(commit) {
    const { s, start } = drag;
    cancelAnimationFrame(drag.raf);
    try { s.panel.querySelector('.panel-head').releasePointerCapture(drag.id); } catch {}
    drag = null;
    dragEndedAt = Date.now();
    s.panel.classList.remove('dragging');
    s.panel.style.translate = ''; // its transition glides it into the slot
    D.body.classList.remove('reordering');
    if (!commit) return placeAll(); // saved order is unchanged, so this puts everything back
    if (visiblePanes().every((o, i) => o === start[i])) return;
    saveOrder();
    sfx('pop', s);
  }

  // DOM order of the visible panes first, then every other remembered project in its old place.
  function saveOrder() {
    const keys = visiblePanes().map(o => o.key).filter(Boolean);
    persist(p => p.setOrder([...new Set([...keys, ...p.order])]));
    placeAll();
  }

  function keyMove(s, e) {
    const dir = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!dir || focused) return;
    e.preventDefault();
    e.stopPropagation(); // not a Konami step
    const list = visiblePanes(), other = list[list.indexOf(s) + dir];
    if (!other || !sameGroup(other, s)) return;
    moveAnimated(s, dir < 0 ? other.panel : other.panel.nextElementSibling);
    saveOrder();
    s.panel.querySelector('.act.grip').focus();
    sfx('pop', s);
  }

  function onUp(e) {
    if (press && e.pointerId === press.id) return cancelPress();
    if (drag && e.pointerId === drag.id) end(e.type === 'pointerup');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Session replay, read on demand from Claude Code's own logs (the watcher stores nothing). It runs in its own
  // window with its own mascot and log: it never touches live panes, sound, energy or progress.
  const GAP_MS = 3000, RP_ROWS = 250;
  let rp = null;

  // Nickname, else the saved project name, else the watcher's readable name — never the raw folder key.
  const rpName = item => persist(p => p.nickname(item.projectKey)) || persist(p => p.project(item.projectKey)?.name) || item.project;
  const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtBytes = n => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

  async function openReplay() {
    const dlg = $('#replayDlg');
    if (!dlg.open) dlg.showModal();
    stopReplay();
    $('#rpPlayer').hidden = true;
    $('#rpBack').hidden = true;
    $('#replayTitle').textContent = 'Replay';
    const pick = $('#rpPick');
    pick.hidden = false;
    pick.replaceChildren(el('p', 'note', 'Loading recordings…'));
    let list;
    try {
      const r = await fetch('/api/replays', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      ({ list } = await r.json());
    } catch {
      return pick.replaceChildren(el('p', 'live-line off', "Can't reach the watcher"),
        el('p', 'note', 'Replays are read from Claude Code\'s logs on your computer, so the watcher has to be running.'));
    }
    pick.replaceChildren(el('p', 'note', "Played back from Claude Code's own session logs — nothing extra is stored. Claude Code keeps its logs for about 30 days."));
    if (!list.length) return pick.append(el('p', 'note', 'No session logs found yet.'));
    const ul = el('ul', 'rp-list');
    for (const item of list) {
      const b = el('button'), name = el('b', '', rpName(item));
      b.type = 'button';
      if (item.live) name.append(el('span', 'livetag', '● STILL RUNNING'));
      const day = new Date(item.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const time = new Date(item.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      b.append(name, el('span', 'size', fmtBytes(item.bytes)), el('span', 'when', `${day} · ${time} · ${fmtDuration(item.end - item.start)} · ${item.session}`));
      b.onclick = () => loadReplay(item);
      const li = el('li');
      li.append(b);
      ul.append(li);
    }
    pick.append(ul);
  }

  async function loadReplay(item) {
    const pick = $('#rpPick');
    pick.replaceChildren(el('p', 'note', 'Reading the session log…'));
    let data;
    try {
      const r = await fetch(`/api/replay?p=${encodeURIComponent(item.p)}&s=${encodeURIComponent(item.s)}`, { cache: 'no-store' });
      data = await r.json();
      if (!r.ok) throw new Error(data.error);
    } catch (e) {
      return pick.replaceChildren(el('p', 'live-line off', e.message || "Can't reach the watcher"), el('p', 'note', 'Go back and try another session.'));
    }
    const events = data.events.filter(e => KIND[e.kind]).sort((a, b) => a.ts - b.ts);
    if (!events.length) return pick.replaceChildren(el('p', 'note', 'Nothing to replay in this session — no tool calls or messages were logged.'));
    // Timeline with long pauses squeezed to GAP_MS, so an afternoon of thinking doesn't mean minutes of nothing.
    const t = [0];
    for (let i = 1; i < events.length; i++) t.push(t[i - 1] + Math.min(GAP_MS, Math.max(0, events[i].ts - events[i - 1].ts)));
    rp = { item, events, t, total: t.at(-1) + 800, pos: 0, idx: -1, speed: rp?.speed ?? 1, playing: false, raf: 0, last: 0, pose: '' };
    pick.hidden = true;
    $('#rpBack').hidden = false;
    $('#rpPlayer').hidden = false;
    $('#replayTitle').textContent = `Replay · ${rpName(item)}`;
    const end = new Date(events.at(-1).ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('#rpWhen').textContent = `recorded ${new Date(events[0].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${end}${item.live ? ' (so far)' : ''} · not live${data.truncated ? ' · last 20,000 events' : ''}`;
    $('#rpScrub').max = rp.total;
    renderSpeed();
    seek(0);
  }

  const RP_POSE = { tool_use: () => SRC.working, error: () => SRC.error, turn_end: () => donePose(), idle: () => SRC.idle };
  function showEvent(ev) {
    const failed = ev.kind === 'tool_result' && !ev.ok;
    const key = ev.kind === 'tool_use' ? 'tool_use' : failed ? 'error' : ev.kind === 'turn_end' ? 'turn_end' : 'idle';
    const src = RP_POSE[key]();
    if (rp.pose !== src) { rp.pose = src; D.querySelector('.rp-sprite').src = src; }
    const [verb, detail] = ev.kind === 'tool_use' ? [VERBS[ev.tool] ?? ev.tool, ev.input]
      : failed ? ['Error', ev.preview] : ev.kind === 'turn_end' ? ['Done', ev.text || 'turn complete']
      : ev.kind === 'text' ? ['Responding', ev.text] : ['Idle', ev.preview];
    $('#rpVerb').textContent = verb;
    $('#rpDetail').textContent = detail ?? '';
    $('#rpClock').textContent = `recorded at ${new Date(ev.ts).toLocaleTimeString()} · event ${rp.idx + 1} of ${rp.events.length}`;
  }

  function rpRow(ev) {
    const [group, tag, body] = ev.kind === 'tool_use' ? [GROUPS[ev.tool] ?? 'other', ev.tool, ev.input]
      : ev.kind === 'tool_result' ? (ev.ok ? ['ok', 'ok', ev.preview] : ['err', 'error', ev.preview])
      : ev.kind === 'turn_end' ? ['done', 'done', ev.text] : ['text', 'note', ev.text];
    const row = el('li', 'ev');
    row.dataset.group = group;
    for (const [cls, text] of [['time', new Date(ev.ts).toLocaleTimeString()], ['ico', ICONS[group]], ['tag', tag], ['body', body || '']]) row.append(el('span', cls, text));
    return row;
  }

  // Plays one event forward: row, pose, a small burst — the same vocabulary as live, minus sound.
  function step() {
    const ev = rp.events[++rp.idx], feed = $('#rpFeed');
    feed.append(rpRow(ev));
    while (feed.children.length > RP_ROWS) feed.firstElementChild.remove();
    feed.scrollTop = feed.scrollHeight;
    showEvent(ev);
    const host = D.querySelector('.rp-mascot');
    if (ev.kind === 'tool_result' && ev.ok) burst(host, { n: 4, spread: 14, color: 'var(--read)' });
    else if (ev.kind === 'tool_result') wobble(host);
    else if (ev.kind === 'turn_end') burst(host, { n: 10, spread: 26, color: 'var(--read)' });
  }

  // Jump anywhere: rebuild the visible log up to that point without animating every row in.
  function seek(pos) {
    rp.pos = Math.max(0, Math.min(rp.total, pos));
    // Events strictly before pos have played, so position 0 is "ready" with nothing shown yet.
    let lo = 0, hi = rp.t.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rp.t[mid] < rp.pos) lo = mid + 1; else hi = mid; }
    rp.idx = lo - 1;
    const feed = $('#rpFeed');
    feed.classList.add('quiet');
    feed.replaceChildren(...rp.events.slice(Math.max(0, rp.idx - RP_ROWS + 1), rp.idx + 1).map(rpRow));
    feed.scrollTop = feed.scrollHeight;
    requestAnimationFrame(() => feed.classList.remove('quiet'));
    if (rp.idx >= 0) showEvent(rp.events[rp.idx]);
    else {
      rp.pose = SRC.idle;
      D.querySelector('.rp-sprite').src = SRC.idle;
      $('#rpVerb').textContent = 'Ready';
      $('#rpDetail').textContent = 'press play';
      $('#rpClock').textContent = `${rp.events.length} events recorded`;
    }
    renderTime();
  }

  function renderTime() {
    $('#rpScrub').value = rp.pos;
    $('#rpTime').textContent = `${fmtClock(rp.pos)} / ${fmtClock(rp.total)}`;
    $('#rpPlay').textContent = rp.playing ? '❚❚' : '▶';
    $('#rpPlay').setAttribute('aria-label', rp.playing ? 'Pause' : 'Play');
  }

  function renderSpeed() {
    for (const b of D.querySelectorAll('.rp-speeds button')) b.setAttribute('aria-pressed', Number(b.dataset.speed) === rp.speed);
  }

  function frame(now) {
    if (!rp?.playing) return;
    rp.pos = Math.min(rp.total, rp.pos + (now - rp.last) * rp.speed);
    rp.last = now;
    while (rp.idx + 1 < rp.events.length && rp.t[rp.idx + 1] < rp.pos) step();
    if (rp.pos >= rp.total) rp.playing = false;
    renderTime();
    if (rp.playing) rp.raf = requestAnimationFrame(frame);
  }

  function togglePlay(on = !rp?.playing) {
    if (!rp) return;
    if (on && rp.pos >= rp.total) seek(0); // play again from the start
    rp.playing = on;
    cancelAnimationFrame(rp.raf);
    if (on) { rp.last = performance.now(); rp.raf = requestAnimationFrame(frame); }
    renderTime();
  }

  function stopReplay() {
    if (rp) { rp.playing = false; cancelAnimationFrame(rp.raf); }
  }

  function initReplay() {
    const dlg = $('#replayDlg');
    $('#replayBtn').onclick = () => fx(openReplay);
    $('#rpBack').onclick = () => fx(openReplay);
    $('#rpPlay').onclick = () => togglePlay();
    $('#rpScrub').addEventListener('input', e => rp && seek(Number(e.target.value)));
    for (const b of D.querySelectorAll('.rp-speeds button')) b.onclick = () => { if (rp) { rp.speed = Number(b.dataset.speed); renderSpeed(); } };
    dlg.addEventListener('close', stopReplay);
    dlg.addEventListener('keydown', e => {
      if (!rp || $('#rpPlayer').hidden || e.target.matches('input, button')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(rp.pos + (e.key === 'ArrowLeft' ? -5000 : 5000)); }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  function init() {
    initReplay();
    $('#energy').onclick = () => note($('#energy').title);
    setInterval(() => fx(energyTick), 1000);
    renderEnergy();

    const dlg = $('#progressDlg');
    for (const b of dlg.querySelectorAll('[role=tab]')) b.onclick = () => setTab(b.dataset.tab);
    dlg.querySelector('[role=tablist]').addEventListener('keydown', e => {
      const names = Object.keys(TABS), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      setTab(names[(names.indexOf(tab) + d + names.length) % names.length], true);
    });
    for (const sheet of D.querySelectorAll('dialog.sheet')) {
      sheet.querySelector('.sheet-x:not(.rp-back)').onclick = () => sheet.close();
      // A tap on the dimmed backdrop closes the sheet.
      sheet.addEventListener('click', e => {
        if (e.target !== sheet) return;
        const r = sheet.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
      });
    }
    $('#evPrev').onclick = () => stepEvent(-1);
    $('#evNext').onclick = () => stepEvent(1);
    $('#evReplay').onclick = replayEffect;

    addEventListener('pointermove', e => fx(() => onMove(e)));
    addEventListener('pointerup', e => fx(() => onUp(e)));
    addEventListener('pointercancel', e => fx(() => onUp(e)));
    // Once a pane is lifted the finger moves it, not the page.
    D.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
    addEventListener('keydown', e => { if (drag && e.key === 'Escape') { e.stopPropagation(); end(false); } }, true);
  }

  window.CCWDeep = {
    init, openStats, refreshSheet: () => $('#progressDlg').open && renderSheet(true),
    energyEvent, tickGap: () => TICK_GAP_MS[known ? level : 0],
    onFeedClick, onFeedKey, tagRow, milestone, initReorder,
    isDragging: s => drag?.s === s, recentlyDragged: () => !!drag || !!press || Date.now() - dragEndedAt < 400,
    secretsFound: () => (P ? secretsFound(P.data) : 0),
  };
})();
