// Progression persistence: easter eggs, achievements, records, streaks, totals, per-project settings, prefs.
// Live session state (panels, WORKING/IDLE/DONE, feeds) is deliberately NOT stored here — it's rebuilt from the
// watcher on every load, so a closed window can never come back claiming a session is still working.
(function (root) {
  const VERSION = 2;
  const DEVICE_KEY = 'ccw.device', KEY = 'ccw.progress', PREFS_KEY = 'ccw.prefs', LEGACY_SOUND_KEY = 'ccw.sound', CORRUPT_KEY = 'ccw.progress.corrupt';
  const DAYS_KEPT = 120, SESSIONS_KEPT = 300;
  const TOTALS = ['events', 'toolCalls', 'successfulActions', 'errors', 'turns', 'sessions'];
  const RECORDS = ['bestRun', 'bestCombo', 'bestBurst', 'sessionEvents', 'sessionFiles', 'longestSessionMs', 'peakActive', 'bestDayStreak',
    'bestDayEvents', 'bestDaySuccesses'];
  const DAILY = ['events', 'toolCalls', 'successfulActions', 'errors', 'bestRun', 'bestCombo', 'longestSessionMs', 'peakActive'];
  // Best-day records outlive the pruned daily history. Additive fields: older builds drop them on load and merging by
  // max restores them, so no schema bump is needed.
  const DAY_BESTS = { events: 'bestDayEvents', successfulActions: 'bestDaySuccesses' };
  const ORDER_MAX = 200;
  const UNLOCKS = ['achievements', 'cosmetics', 'discovery'];
  // Mini-game tallies. Unlike live events, each device plays its own games, so every device keeps its own counters
  // (merged per device by max) and totals are the sum across devices — max alone would lose one device's plays.
  const GAMES = ['hunt', 'catch', 'bug', 'reaction'];
  const GAME_COUNTS = [...GAMES.flatMap(g => [`${g}Shown`, `${g}Won`]), 'bingoWins'];
  const DEVICES_KEPT = 20;

  // MIGRATIONS[n] upgrades a v-n blob to v-(n+1). Add one per schema change; sanitize() then fills gaps and drops junk.
  const MIGRATIONS = {
    1: d => ({ ...d, v: 2, games: { reactionBest: 0, devices: {} } }),
  };

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const count = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const stamp = v => (Number.isFinite(v) && v > 0 ? v : null);
  const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
  const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, count(o?.[k])]));
  // Keys come from folder names and session ids; never let one address the prototype chain.
  const safeKey = k => typeof k === 'string' && k !== '' && !['__proto__', 'constructor', 'prototype'].includes(k);
  const mapOf = (o, fn) => Object.fromEntries(
    Object.entries(isObj(o) ? o : {}).filter(([k]) => safeKey(k)).map(([k, v]) => [k, fn(v)]).filter(([, v]) => v != null));
  const pad = n => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); };
  const isDay = k => /^\d{4}-\d{2}-\d{2}$/.test(k);
  const recentDays = (daily, n) => Object.fromEntries(Object.keys(daily).filter(isDay).sort().slice(-n).map(k => [k, daily[k]]));
  const newestSessions = (s, n) => Object.fromEntries(Object.entries(s).sort((a, b) => a[1] - b[1]).slice(-n));

  // resetAt marks a reset so syncing devices adopt it instead of merging old progress back in.
  const fresh = (now = Date.now(), v = VERSION) => ({
    v, createdAt: now, resetAt: 0,
    totals: zeros(TOTALS), records: zeros(RECORDS), dayStreak: { last: null, current: 0 },
    achievements: {}, cosmetics: {}, discovery: {}, eggs: {}, projects: {}, daily: {}, sessions: {},
    games: { reactionBest: 0, devices: {} },
  });
  const freshDay = () => ({ ...zeros(DAILY), projects: {} });

  const project = (p, now) => ({
    name: typeof p?.name === 'string' ? p.name.slice(0, 120) : '',
    firstSeen: stamp(p?.firstSeen) ?? now, lastSeen: stamp(p?.lastSeen) ?? now, events: count(p?.events),
  });

  const gameDevice = x => (isObj(x) ? { ...pick(x, GAME_COUNTS), at: stamp(x.at) ?? 0 } : null);
  const games = g => ({
    reactionBest: count(g?.reactionBest),
    devices: Object.fromEntries(Object.entries(mapOf(g?.devices, gameDevice)).sort((a, b) => a[1].at - b[1].at).slice(-DEVICES_KEPT)),
  });

  // Coerces any object into a valid blob: missing fields get defaults, wrong types are dropped.
  function sanitize(d, v = VERSION, now = Date.now()) {
    const daily = recentDays(mapOf(d.daily, x => (isObj(x) ? { ...pick(x, DAILY), projects: mapOf(x.projects, n => count(n) || null) } : null)), DAYS_KEPT);
    const records = pick(d.records, RECORDS);
    // Also backfills best days for data saved before these records existed.
    for (const [field, rec] of Object.entries(DAY_BESTS)) records[rec] = Math.max(records[rec], ...Object.values(daily).map(x => x[field]));
    return {
      v,
      createdAt: stamp(d.createdAt) ?? now,
      resetAt: stamp(d.resetAt) ?? 0,
      totals: pick(d.totals, TOTALS),
      records,
      dayStreak: { last: isDay(d.dayStreak?.last) ? d.dayStreak.last : null, current: count(d.dayStreak?.current) },
      ...Object.fromEntries(UNLOCKS.map(k => [k, mapOf(d[k], stamp)])),
      eggs: mapOf(d.eggs, e => (stamp(e?.first) ? { first: e.first, count: Math.max(1, count(e.count)) } : null)),
      projects: mapOf(d.projects, p => (isObj(p) ? project(p, now) : null)),
      daily,
      sessions: newestSessions(mapOf(d.sessions, stamp), SESSIONS_KEPT),
      games: games(d.games),
    };
  }

  // Per-project nickname/pin are user settings, so they live with prefs: any tab may write them.
  const projectPref = x => {
    const nickname = typeof x?.nickname === 'string' ? x.nickname.trim().slice(0, 40) : '', pinned = x?.pinned === true;
    return nickname || pinned ? { nickname, pinned } : null;
  };
  // stamps: last-change time per pref ('sound', 'p:<projectKey>') so devices merge last-writer-wins; a stamp without an
  // entry is a deletion. Unstamped legacy values get stamp 1 so they beat a fresh device's defaults (stamp 0).
  // order: pane order as project keys, one synced setting (stamp 'order'). Older builds drop it but keep its stamp,
  // and equal stamps favour the side that still has the list.
  function sanitizePrefs(p) {
    const projects = mapOf(p?.projects, projectPref), stamps = mapOf(p?.stamps, stamp);
    for (const k of Object.keys(projects)) stamps[`p:${k}`] ??= 1;
    if (p?.sound === true) stamps.sound ??= 1;
    const order = [...new Set(Array.isArray(p?.order) ? p.order.filter(safeKey) : [])].slice(0, ORDER_MAX);
    return { v: 1, sound: p?.sound === true, projects, stamps, order };
  }

  // --- cross-device merge. Every device sees the same live events, so counters merge by max (never summed, which
  // would double-count); unlocks union keeping the earliest time; prefs go to whichever device changed them last. ---
  const keysOf = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const union = (a, b, fn) => Object.fromEntries(keysOf(a, b).map(k => [k, a[k] == null ? b[k] : b[k] == null ? a[k] : fn(a[k], b[k])]));
  const maxOf = (a, b) => union(a, b, Math.max);
  const dayBefore = k => { const [y, m, d] = k.split('-').map(Number); return dayKey(new Date(y, m - 1, d - 1)); };

  function mergeStreak(a, b) {
    if (a.last === b.last) return { last: a.last, current: Math.max(a.current, b.current) };
    const [newer, older] = (a.last ?? '') > (b.last ?? '') ? [a, b] : [b, a];
    // The newer side may have restarted at 1 without knowing the other device kept the streak alive yesterday.
    return older.last && older.last === dayBefore(newer.last)
      ? { last: newer.last, current: Math.max(newer.current, older.current + 1) } : newer;
  }

  function mergeProgress(a, b) {
    const dayStreak = mergeStreak(a.dayStreak, b.dayStreak), records = maxOf(a.records, b.records);
    records.bestDayStreak = Math.max(records.bestDayStreak, dayStreak.current);
    return sanitize({
      createdAt: Math.min(a.createdAt, b.createdAt), resetAt: a.resetAt,
      totals: maxOf(a.totals, b.totals), records, dayStreak,
      ...Object.fromEntries(UNLOCKS.map(k => [k, union(a[k], b[k], Math.min)])),
      eggs: union(a.eggs, b.eggs, (x, y) => ({ first: Math.min(x.first, y.first), count: Math.max(x.count, y.count) })),
      projects: union(a.projects, b.projects, (x, y) => ({
        name: (x.lastSeen >= y.lastSeen ? x : y).name, firstSeen: Math.min(x.firstSeen, y.firstSeen),
        lastSeen: Math.max(x.lastSeen, y.lastSeen), events: Math.max(x.events, y.events),
      })),
      daily: union(a.daily, b.daily, (x, y) => ({ ...maxOf(pick(x, DAILY), pick(y, DAILY)), projects: maxOf(x.projects, y.projects) })),
      sessions: union(a.sessions, b.sessions, Math.min),
      games: {
        // Lowest non-zero time wins (0 = never played); sanitize turns the both-unplayed Infinity back into 0.
        reactionBest: Math.min(a.games.reactionBest || Infinity, b.games.reactionBest || Infinity),
        devices: union(a.games.devices, b.games.devices, maxOf),
      },
    }, a.v);
  }

  function mergePrefs(a, b) {
    const win = k => ((a.stamps[k] ?? 0) >= (b.stamps[k] ?? 0) ? a : b);
    const projects = Object.fromEntries(keysOf(a.projects, b.projects).map(k => [k, win(`p:${k}`).projects[k]]));
    const order = (a.stamps.order ?? 0) === (b.stamps.order ?? 0) && !a.order.length ? b.order : win('order').order;
    return sanitizePrefs({ sound: win('sound').sound, projects, stamps: maxOf(a.stamps, b.stamps), order });
  }

  // State = { progress, prefs }, both already sanitized. A newer reset wins outright.
  const mergeState = (a, b) => a.progress.resetAt !== b.progress.resetAt
    ? (a.progress.resetAt > b.progress.resetAt ? a : b)
    : { progress: mergeProgress(a.progress, b.progress), prefs: mergePrefs(a.prefs, b.prefs) };
  // Older versions are migrated up (the watcher's saved file and not-yet-updated devices); returns null for anything
  // newer or unmigratable — never merge what this build can't fully understand.
  function sanitizeState(s, version = VERSION, migrations = MIGRATIONS) {
    let d = s?.progress;
    if (!isObj(d) || !Number.isInteger(d.v) || d.v < 1 || d.v > version) return null;
    try { for (let n = d.v; n < version; n++) d = migrations[n](d); } catch { return null; }
    return { progress: sanitize(d, version), prefs: sanitizePrefs(s.prefs) };
  }

  const newDeviceId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function createStore(storage, { version = VERSION, migrations = MIGRATIONS, warn = () => {}, writer = true, onChange = () => {}, deviceId = newDeviceId() } = {}) {
    let data, prefs, status, frozen = false, timer = null;
    const listeners = new Set();

    const write = (key, value) => {
      try { storage.setItem(key, value); return true; } catch (e) { warn(`save failed (${e?.name})`); return false; }
    };

    function corrupt(raw, why) {
      warn(`saved progress unusable (${why}) — starting fresh; old copy kept at ${CORRUPT_KEY}`);
      write(CORRUPT_KEY, raw);
      return { data: fresh(Date.now(), version), status: 'recovered' };
    }

    function parse(raw) {
      if (raw == null) return { data: fresh(Date.now(), version), status: 'fresh' };
      let d;
      try { d = JSON.parse(raw); } catch { return corrupt(raw, 'unparseable JSON'); }
      if (!isObj(d) || !Number.isInteger(d.v) || d.v < 1) return corrupt(raw, 'not a progress object');
      if (d.v > version) return { data: sanitize(d, d.v), status: 'newer' };
      const from = d.v;
      try {
        for (let n = from; n < version; n++) d = migrations[n](d);
      } catch (e) { return corrupt(raw, `migration from v${from} failed: ${e?.message}`); }
      return { data: sanitize(d, version), status: from < version ? 'migrated' : 'loaded' };
    }

    function loadPrefs() {
      try {
        const raw = storage.getItem(PREFS_KEY);
        if (raw != null) return sanitizePrefs(JSON.parse(raw));
        const legacy = storage.getItem(LEGACY_SOUND_KEY);
        const p = sanitizePrefs({ sound: legacy === '1' });
        if (legacy != null && write(PREFS_KEY, JSON.stringify(p))) storage.removeItem(LEGACY_SOUND_KEY);
        return p;
      } catch { return sanitizePrefs(); }
    }

    function load() {
      clearTimeout(timer); timer = null;
      if (!storage) { data = fresh(Date.now(), version); prefs = sanitizePrefs(); status = 'unavailable'; return; }
      let raw = null;
      try { raw = storage.getItem(KEY); } catch {}
      ({ data, status } = parse(raw));
      // A newer build's data would lose fields if this build re-saved it, so leave it alone.
      frozen = status === 'newer';
      if (frozen) warn(`saved progress is v${data.v}, this build understands v${version} — read-only this session`);
      prefs = loadPrefs();
      if (status === 'recovered') save();
      listeners.forEach(fn => fn());
    }

    function save() {
      clearTimeout(timer); timer = null;
      if (!storage || frozen || !writer) return;
      if (write(KEY, JSON.stringify(data))) return onChange();
      // Most likely quota: shed the bulkiest history and retry once.
      data.daily = recentDays(data.daily, 14);
      data.sessions = newestSessions(data.sessions, 50);
      if (!write(KEY, JSON.stringify(data))) status = 'save-failed';
      onChange();
    }

    const mutate = fn => {
      if (frozen || !writer) return false;
      const result = fn();
      timer ??= setTimeout(save, 1000);
      return result;
    };

    // Touching today also advances the consecutive-day streak.
    function today() {
      const k = dayKey();
      if (data.dayStreak.last !== k) {
        data.dayStreak = { last: k, current: data.dayStreak.last === yesterday() ? data.dayStreak.current + 1 : 1 };
        data.records.bestDayStreak = Math.max(data.records.bestDayStreak, data.dayStreak.current);
      }
      return (data.daily[k] ??= freshDay());
    }

    const ensureProject = key => (data.projects[key] ??= project(null, Date.now()));
    const writePrefs = () => storage && write(PREFS_KEY, JSON.stringify(prefs));
    const changePrefs = next => { prefs = sanitizePrefs(next); writePrefs(); onChange(true); };
    function setProjectPref(key, patch) {
      changePrefs({ ...prefs, projects: { ...prefs.projects, [key]: { ...prefs.projects[key], ...patch } }, stamps: { ...prefs.stamps, [`p:${key}`]: Date.now() } });
      return true;
    }

    load();

    return {
      get data() { return data; },
      get prefs() { return prefs; },
      get status() { return status; },
      get writer() { return writer; },
      get frozen() { return frozen; },
      get dayStreak() { return [dayKey(), yesterday()].includes(data.dayStreak.last) ? data.dayStreak.current : 0; },
      get today() { return data.daily[dayKey()] ?? freshDay(); },
      setWriter(on) { writer = on; },
      reload: load,
      save,
      onReload(fn) { listeners.add(fn); },

      bump: (field, n = 1) => TOTALS.includes(field) && mutate(() => {
        data.totals[field] += n;
        const d = today();
        if (DAILY.includes(field)) d[field] += n;
        if (DAY_BESTS[field]) data.records[DAY_BESTS[field]] = Math.max(data.records[DAY_BESTS[field]], d[field]);
      }),
      // Returns true when `value` sets a new all-time record.
      best: (field, value) => RECORDS.includes(field) && Number.isFinite(value) && mutate(() => {
        const d = today();
        if (DAILY.includes(field)) d[field] = Math.max(d[field], Math.floor(value));
        if (!(value > data.records[field])) return false;
        data.records[field] = Math.floor(value);
        return true;
      }),
      // `key` must identify the repo exactly (the watcher's full encoded project dir). A renamed or moved repo gets a
      // new key and so a new record — guessing a merge from display names could fuse two different projects.
      projectEvent: (key, name) => safeKey(key) && mutate(() => {
        const p = ensureProject(key);
        if (name) p.name = String(name).slice(0, 120);
        p.lastSeen = Date.now();
        p.events++;
        const d = today();
        d.projects[key] = (d.projects[key] ?? 0) + 1;
      }),
      // Remembers first-seen per session id, so a page reload mid-session neither recounts it nor restarts its clock.
      session: id => safeKey(id) && mutate(() => {
        if (data.sessions[id]) return false;
        data.sessions = newestSessions({ ...data.sessions, [id]: Date.now() }, SESSIONS_KEPT);
        data.totals.sessions++;
        today();
        return true;
      }),
      sessionFirstSeen: id => data.sessions[id] ?? null,
      // Returns true the first time an egg is ever seen.
      foundEgg: key => safeKey(key) && mutate(() => {
        const e = data.eggs[key];
        if (e) { e.count++; return false; }
        data.eggs[key] = { first: Date.now(), count: 1 };
        return true;
      }),
      // kind: achievements | cosmetics | discovery. Returns true when newly unlocked.
      unlock: (kind, id) => UNLOCKS.includes(kind) && safeKey(id) && mutate(() => {
        if (data[kind][id]) return false;
        data[kind][id] = Date.now();
        return true;
      }),
      project: key => (safeKey(key) ? data.projects[key] ?? null : null),

      // Mini-games: `field` is one of GAME_COUNTS, credited to this device only.
      game: (field, n = 1) => GAME_COUNTS.includes(field) && safeKey(deviceId) && mutate(() => {
        const dev = (data.games.devices[deviceId] ??= gameDevice({}));
        dev[field] += n;
        dev.at = Date.now();
        return true;
      }),
      // Returns true when `ms` is a new best (lowest) reaction time.
      reactionTime: ms => Number.isFinite(ms) && ms > 0 && mutate(() => {
        const best = data.games.reactionBest;
        if (best && best <= ms) return false;
        data.games.reactionBest = Math.round(ms);
        return true;
      }),
      get gameTotals() {
        const t = Object.fromEntries(GAME_COUNTS.map(k => [k, 0]));
        for (const dev of Object.values(data.games.devices)) for (const k of GAME_COUNTS) t[k] += dev[k];
        return { ...t, reactionBest: data.games.reactionBest };
      },

      // Prefs live under their own key so any tab can change them without racing the recording tab's progress writes.
      setPref(k, v) { changePrefs({ ...prefs, [k]: v, stamps: { ...prefs.stamps, [k]: Date.now() } }); },
      nickname: key => (safeKey(key) ? prefs.projects[key]?.nickname ?? '' : ''),
      pinned: key => safeKey(key) && prefs.projects[key]?.pinned === true,
      setNickname: (key, nick) => safeKey(key) && setProjectPref(key, { nickname: String(nick ?? '') }),
      setPinned: (key, on) => safeKey(key) && setProjectPref(key, { pinned: !!on }),
      get order() { return prefs.order; },
      setOrder(keys) { changePrefs({ ...prefs, order: keys, stamps: { ...prefs.stamps, order: Date.now() } }); },

      // Wipes only this app's own browser keys — never Claude Code, repos, or session logs.
      reset() {
        clearTimeout(timer); timer = null;
        data = { ...fresh(Date.now(), version), resetAt: Date.now() }; prefs = sanitizePrefs(); frozen = false; status = 'reset';
        if (storage) for (const k of [KEY, PREFS_KEY, LEGACY_SOUND_KEY, CORRUPT_KEY]) try { storage.removeItem(k); } catch {}
        listeners.forEach(fn => fn());
        onChange(true);
      },

      // Cross-device sync: exportState() goes to the watcher, adopt() folds its merged reply back in. Merging into the
      // current state (not replacing it) keeps anything recorded while the request was in flight.
      exportState: () => ({ progress: data, prefs }),
      adopt(state) {
        const theirs = sanitizeState(state, version, migrations);
        if (!theirs || frozen) return false;
        const before = JSON.stringify({ progress: data, prefs }), merged = mergeState({ progress: data, prefs }, theirs);
        if (JSON.stringify(merged) === before) return false;
        ({ progress: data, prefs } = merged);
        clearTimeout(timer); timer = null;
        if (storage && writer) write(KEY, JSON.stringify(data));
        writePrefs();
        listeners.forEach(fn => fn());
        return true;
      },
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { createStore, sanitize, fresh, dayKey, mergeState, sanitizeState, VERSION, KEY, PREFS_KEY, LEGACY_SOUND_KEY, CORRUPT_KEY, GAME_COUNTS };
    return;
  }

  function browserStorage() {
    try {
      const s = root.localStorage;
      s.setItem('ccw.probe', '1');
      s.removeItem('ccw.probe');
      return s;
    } catch { return null; }
  }

  // Every open tab receives the same live events; only the lock holder records them, or totals would double.
  // Tabs start as non-writers so nothing (not even a corruption-recovery save) is written before the lock decides.
  const locks = navigator.locks;
  // Progress syncs through the watcher (server.js /api/progress) so every device shares one record. Offline, the local
  // copy keeps working and catches up on the next successful sync.
  let syncTimer = 0, inFlight = null, again = false;
  const syncSoon = (urgent = false) => {
    if (urgent) clearTimeout(syncTimer), syncTimer = 0;
    syncTimer ||= setTimeout(() => { syncTimer = 0; sync(); }, urgent ? 300 : 5000);
  };
  async function sync() {
    // Only the recording tab syncs; follower tabs pick the result up through storage events.
    if (!store.writer || store.frozen || !root.fetch) return;
    if (inFlight) { again = true; return; }
    inFlight = fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(store.exportState()) })
      .then(r => (r.ok ? r.json() : null)).then(s => s && store.adopt(s)).catch(() => {});
    await inFlight;
    inFlight = null;
    if (again) { again = false; sync(); }
  }
  // A stable id per browser so each device's game tallies merge separately (see GAMES above).
  const deviceId = (s => {
    try { let id = s?.getItem(DEVICE_KEY); if (!id) { id = newDeviceId(); s?.setItem(DEVICE_KEY, id); } return id; } catch { return newDeviceId(); }
  })(browserStorage());
  const store = root.CCWProgress = createStore(browserStorage(), { warn: msg => console.warn(`[cc-watcher] ${msg}`), writer: !locks, onChange: syncSoon, deviceId });
  Object.assign(store, { sync, syncSoon });
  const becomeWriter = () => { store.setWriter(true); store.reload(); sync(); }; // reload picks up what the previous writer flushed
  locks?.request(`ccw.progress.writer${root.CCW_DEMO ? '.demo' : ''}`, () => { becomeWriter(); return new Promise(() => {}); }).catch(becomeWriter);
  addEventListener('storage', e => {
    if (e.key !== null && e.key !== KEY && e.key !== PREFS_KEY) return;
    store.reload();
    if (e.key === PREFS_KEY) syncSoon(true); // a follower tab changed a pref; the writer carries it to the watcher
  });
  addEventListener('pagehide', () => store.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.save(); });
})(typeof window !== 'undefined' ? window : globalThis);
