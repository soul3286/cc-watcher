const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, dayKey, mergeState, sanitizeState, VERSION, GAME_COUNTS, KEY, PREFS_KEY, LEGACY_SOUND_KEY, CORRUPT_KEY } = require('../public/progress.js');

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const saved = s => JSON.parse(s.m.get(KEY));

test('empty storage starts fresh', () => {
  const p = createStore(memStorage());
  assert.equal(p.status, 'fresh');
  assert.equal(p.data.totals.events, 0);
  assert.equal(p.prefs.sound, false);
});

test('legacy ccw.sound migrates into prefs and is removed', () => {
  const s = memStorage({ [LEGACY_SOUND_KEY]: '1' });
  const p = createStore(s);
  assert.equal(p.prefs.sound, true);
  assert.equal(s.m.has(LEGACY_SOUND_KEY), false);
  assert.deepEqual(JSON.parse(s.m.get(PREFS_KEY)), { v: 1, sound: true, projects: {}, stamps: { sound: 1 }, order: [] }, 'legacy value stamped so it beats a fresh device');
});

for (const [label, raw] of [['unparseable JSON', '{not json'], ['array', '[1,2]'], ['missing version', '{"totals":{}}'], ['v=0', '{"v":0}'], ['null', 'null']]) {
  test(`corrupt (${label}) → fresh progress, raw kept aside, fresh blob written`, () => {
    const s = memStorage({ [KEY]: raw, [PREFS_KEY]: '{"v":1,"sound":true}' });
    const p = createStore(s);
    assert.equal(p.status, 'recovered');
    assert.equal(s.m.get(CORRUPT_KEY), raw);
    assert.equal(saved(s).v, VERSION);
    assert.equal(p.prefs.sound, true, 'prefs survive progress corruption');
  });
}

test('missing fields and wrong types are repaired, valid data kept', () => {
  const s = memStorage({ [KEY]: JSON.stringify({
    v: VERSION, totals: { events: 42, errors: 'lots', toolCalls: -3 }, records: { bestCombo: 7.9 },
    eggs: { wizard: { first: 123, count: 2 }, bad: 'x' }, achievements: { firstBlood: 5, nope: 'yes' },
    projects: { 'C--dev-app': { name: 'dev-app', nickname: 'Appy', pinned: true, events: 9 }, junk: 5 },
    daily: { '2026-09-01': { events: 3, projects: { a: 2, b: -1 } }, 'not-a-day': { events: 1 } },
    sessions: { abc: 100, bad: 'x' },
  }).replace('"junk"', '"__proto__":{"x":1},"junk"') });
  const p = createStore(s);
  assert.equal(p.status, 'loaded');
  assert.equal(p.data.totals.events, 42);
  assert.equal(p.data.totals.errors, 0);
  assert.equal(p.data.totals.toolCalls, 0);
  assert.equal(p.data.totals.successfulActions, 0);
  assert.equal(p.data.records.bestCombo, 7);
  assert.deepEqual(p.data.eggs, { wizard: { first: 123, count: 2 } });
  assert.deepEqual(p.data.achievements, { firstBlood: 5 });
  assert.deepEqual(Object.keys(p.data.projects), ['C--dev-app']);
  assert.equal('nickname' in p.data.projects['C--dev-app'], false, 'nicknames live in prefs now');
  assert.deepEqual(Object.keys(p.data.daily), ['2026-09-01']);
  assert.deepEqual(p.data.daily['2026-09-01'].projects, { a: 2 });
  assert.deepEqual(p.data.sessions, { abc: 100 });
  assert.deepEqual(p.data.cosmetics, {});
  assert.equal({}.x, undefined, 'no prototype pollution');
});

test('newer schema version is read-only: loads, never overwrites', () => {
  const raw = JSON.stringify({ v: 99, totals: { events: 5 }, futureField: true });
  const s = memStorage({ [KEY]: raw });
  const p = createStore(s);
  assert.equal(p.status, 'newer');
  assert.equal(p.data.totals.events, 5);
  assert.equal(p.bump('events'), false);
  p.save();
  assert.equal(s.m.get(KEY), raw);
});

test('migrations run in order from the stored version', () => {
  const s = memStorage({ [KEY]: JSON.stringify({ v: 1, totals: { events: 3 }, oldName: 11 }) });
  const p = createStore(s, { version: 3, migrations: {
    1: d => ({ ...d, v: 2, records: { bestCombo: d.oldName } }),
    2: d => ({ ...d, v: 3, totals: { ...d.totals, turns: 1 } }),
  } });
  assert.equal(p.status, 'migrated');
  assert.equal(p.data.v, 3);
  assert.equal(p.data.records.bestCombo, 11);
  assert.equal(p.data.totals.turns, 1);
});

test('a failing migration recovers to fresh instead of throwing', () => {
  const s = memStorage({ [KEY]: '{"v":1}' });
  const p = createStore(s, { version: 2, migrations: { 1: () => { throw new Error('boom'); } } });
  assert.equal(p.status, 'recovered');
  assert.equal(p.data.v, 2);
});

test('no storage at all: in-memory only, never throws', () => {
  const p = createStore(null);
  assert.equal(p.status, 'unavailable');
  p.bump('events');
  p.save();
  p.setPref('sound', true);
  p.reset();
  assert.equal(p.data.totals.events, 0);
});

test('storage that throws on every call degrades gracefully', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); }, removeItem() { throw new Error('denied'); } };
  const p = createStore(bad);
  assert.equal(p.status, 'fresh');
  p.bump('events');
  assert.doesNotThrow(() => p.save());
  assert.equal(p.status, 'save-failed');
  assert.doesNotThrow(() => { p.setPref('sound', true); p.reset(); });
});

test('recording: totals, daily, records, day streak, projects, sessions, eggs, unlocks', () => {
  const s = memStorage();
  const p = createStore(s);
  p.bump('events'); p.bump('successfulActions');
  assert.equal(p.best('bestCombo', 4), true);
  assert.equal(p.best('bestCombo', 3), false);
  assert.equal(p.best('bestCombo', 4), false);
  assert.equal(p.today.bestCombo, 4);
  assert.equal(p.today.events, 1);
  assert.equal(p.dayStreak, 1);

  p.projectEvent('C--dev-app', 'dev-app'); p.projectEvent('C--dev-app', 'dev-app');
  assert.equal(p.project('C--dev-app').events, 2);
  assert.equal(p.today.projects['C--dev-app'], 2);
  assert.equal(p.projectEvent('__proto__', 'x'), false);
  assert.equal(p.projectEvent('', 'x'), false);

  assert.equal(p.session('abc12345'), true);
  assert.equal(p.session('abc12345'), false, 'reloaded session is not recounted');
  assert.equal(p.data.totals.sessions, 1);
  assert.ok(p.sessionFirstSeen('abc12345') > 0);

  assert.equal(p.foundEgg('wizard'), true);
  assert.equal(p.foundEgg('wizard'), false);
  assert.equal(p.data.eggs.wizard.count, 2);
  assert.equal(p.unlock('achievements', 'firstBlood'), true);
  assert.equal(p.unlock('achievements', 'firstBlood'), false);
  assert.equal(p.unlock('bogus', 'x'), false);
  assert.equal(p.bump('bogus'), false);

  p.save();
  const again = createStore(s);
  assert.equal(again.status, 'loaded');
  assert.deepEqual(again.data, p.data, 'round-trips through storage');
});

test('day streak continues from yesterday and resets after a gap', () => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const p = createStore(memStorage({ [KEY]: JSON.stringify({ v: 1, dayStreak: { last: dayKey(y), current: 4 }, records: { bestDayStreak: 4 } }) }));
  assert.equal(p.dayStreak, 4, 'still alive before any activity today');
  p.bump('events');
  assert.equal(p.data.dayStreak.current, 5);
  assert.equal(p.data.records.bestDayStreak, 5);

  const p2 = createStore(memStorage({ [KEY]: JSON.stringify({ v: 1, dayStreak: { last: '2020-01-01', current: 9 }, records: { bestDayStreak: 9 } }) }));
  assert.equal(p2.dayStreak, 0);
  p2.bump('events');
  assert.equal(p2.data.dayStreak.current, 1);
  assert.equal(p2.data.records.bestDayStreak, 9);
});

test('non-writer tab (another tab holds the lock) records nothing but can change prefs', () => {
  const s = memStorage();
  const p = createStore(s);
  p.setWriter(false);
  assert.equal(p.bump('events'), false);
  p.save();
  assert.equal(s.m.has(KEY), false);
  p.setPref('sound', true);
  assert.equal(JSON.parse(s.m.get(PREFS_KEY)).sound, true);
});

test('a tab that starts as non-writer writes nothing until it gets the lock, then still reports recovery', () => {
  const s = memStorage({ [KEY]: '{broken' });
  const p = createStore(s, { writer: false });
  assert.equal(p.status, 'recovered');
  assert.equal(s.m.get(KEY), '{broken', 'no recovery save before the lock');
  p.setWriter(true);
  p.reload();
  assert.equal(p.status, 'recovered');
  assert.equal(saved(s).v, VERSION);
});

test('reset clears only cc-watcher keys and notifies listeners', () => {
  const s = memStorage({ [KEY]: '{"v":1,"totals":{"events":9}}', [PREFS_KEY]: '{"v":1,"sound":true}', [CORRUPT_KEY]: 'x', 'other.app': 'keep' });
  const p = createStore(s);
  let notified = 0;
  p.onReload(() => notified++);
  p.reset();
  assert.equal(notified, 1);
  assert.equal(p.data.totals.events, 0);
  assert.equal(p.prefs.sound, false);
  assert.deepEqual([...s.m.keys()], ['other.app']);
});

test('nicknames and pins live in prefs: any tab can set them, sanitised, cleared by reset', () => {
  const s = memStorage({ [PREFS_KEY]: JSON.stringify({ v: 1, sound: true, projects: { a: { nickname: '  Appy  ', pinned: 'yes' }, b: {}, __proto__x: 1 } }) });
  const p = createStore(s);
  assert.deepEqual(p.prefs.projects, { a: { nickname: 'Appy', pinned: false } });
  p.setWriter(false); // a follower tab
  assert.equal(p.setPinned('b', true), true);
  assert.equal(p.setNickname('b', 'x'.repeat(60)), true);
  assert.equal(p.pinned('b'), true);
  assert.equal(p.nickname('b').length, 40);
  assert.equal(JSON.parse(s.m.get(PREFS_KEY)).projects.b.pinned, true);
  p.setNickname('a', '');
  assert.equal(p.nickname('a'), '');
  assert.equal('a' in p.prefs.projects, false, 'empty entries are dropped');
  assert.equal(p.setPinned('__proto__', true), false);
  assert.equal(p.prefs.sound, true, 'other prefs untouched');
  p.reset();
  assert.deepEqual(p.prefs.projects, {});
});

// --- cross-device sync ---
const stateOf = p => JSON.parse(JSON.stringify(p.exportState()));
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };

test('merge: same live events seen on two devices are never double-counted', () => {
  const desk = createStore(memStorage()), phone = createStore(memStorage());
  for (const p of [desk, phone]) { p.bump('events', 5); p.best('bestCombo', 3); }
  desk.bump('events', 2); // desktop saw two more while the phone slept
  phone.best('bestCombo', 7);
  const m = mergeState(sanitizeState(stateOf(desk)), sanitizeState(stateOf(phone)));
  assert.equal(m.progress.totals.events, 7);
  assert.equal(m.progress.records.bestCombo, 7);
  assert.equal(m.progress.daily[dayKey()].events, 7);
});

test('merge: unlocks, eggs, projects and sessions union with earliest first-seen', () => {
  const a = sanitizeState({ progress: { v: 1, achievements: { x: 100 }, eggs: { wizard: { first: 50, count: 2 } }, sessions: { s1: 10 },
    projects: { k: { name: 'old', firstSeen: 5, lastSeen: 20, events: 3 } } } });
  const b = sanitizeState({ progress: { v: 1, achievements: { x: 90, y: 200 }, eggs: { wizard: { first: 60, count: 5 } }, sessions: { s1: 12, s2: 30 },
    projects: { k: { name: 'new', firstSeen: 7, lastSeen: 40, events: 9 } } } });
  const { progress: m } = mergeState(a, b);
  assert.deepEqual(m.achievements, { x: 90, y: 200 });
  assert.deepEqual(m.eggs.wizard, { first: 50, count: 5 });
  assert.deepEqual(m.sessions, { s1: 10, s2: 30 });
  assert.deepEqual(m.projects.k, { name: 'new', firstSeen: 5, lastSeen: 40, events: 9 });
  assert.deepEqual(mergeState(b, a).progress, m, 'order-independent');
});

test('merge: a device restarting the day streak at 1 continues the other device’s streak', () => {
  const a = sanitizeState({ progress: { v: 1, dayStreak: { last: daysAgo(1), current: 6 }, records: { bestDayStreak: 6 } } });
  const b = sanitizeState({ progress: { v: 1, dayStreak: { last: dayKey(), current: 1 }, records: { bestDayStreak: 1 } } });
  const { progress: m } = mergeState(a, b);
  assert.deepEqual(m.dayStreak, { last: dayKey(), current: 7 });
  assert.equal(m.records.bestDayStreak, 7);
  const gap = sanitizeState({ progress: { v: 1, dayStreak: { last: daysAgo(3), current: 9 } } });
  assert.deepEqual(mergeState(gap, b).progress.dayStreak, { last: dayKey(), current: 1 }, 'a gap still breaks it');
});

test('merge: prefs are last-writer-wins per setting, deletions included; legacy beats a fresh device', () => {
  const desk = createStore(memStorage({ [PREFS_KEY]: JSON.stringify({ v: 1, sound: true, projects: { a: { nickname: 'Appy' } } }) }));
  const phone = createStore(memStorage());
  let m = mergeState(sanitizeState(stateOf(phone)), sanitizeState(stateOf(desk)));
  assert.equal(m.prefs.sound, true);
  assert.equal(m.prefs.projects.a.nickname, 'Appy');
  phone.adopt(m);
  phone.setNickname('a', ''); // cleared on the phone later
  desk.setPinned('b', true);
  m = mergeState(sanitizeState(stateOf(desk)), sanitizeState(stateOf(phone)));
  assert.equal('a' in m.prefs.projects, false, 'newer deletion wins');
  assert.equal(m.prefs.projects.b.pinned, true);
});

test('merge: a reset on one device wins over older progress everywhere', () => {
  const desk = createStore(memStorage()), phone = createStore(memStorage());
  desk.bump('events', 50); phone.bump('events', 50); phone.setPref('sound', true);
  desk.reset();
  const m = mergeState(sanitizeState(stateOf(phone)), sanitizeState(stateOf(desk)));
  assert.equal(m.progress.totals.events, 0);
  assert.equal(m.prefs.sound, false);
  assert.equal(phone.adopt(m), true);
  assert.equal(phone.data.totals.events, 0);
});

test('adopt: merges into current state, notifies, persists; ignores junk and other versions', () => {
  const s = memStorage(), p = createStore(s);
  let notified = 0;
  p.onReload(() => notified++);
  p.bump('events', 3);
  const other = createStore(memStorage()); other.bump('events', 1); other.unlock('achievements', 'z');
  assert.equal(p.adopt(stateOf(other)), true);
  assert.equal(p.data.totals.events, 3, 'kept local count recorded meanwhile');
  assert.ok(p.data.achievements.z);
  assert.equal(saved(s).achievements.z, p.data.achievements.z);
  assert.equal(notified, 1);
  assert.equal(p.adopt(stateOf(p)), false, 'no-op merge does not notify');
  assert.equal(p.adopt({ progress: { v: 99 } }), false);
  assert.equal(p.adopt('junk'), false);
  assert.equal(sanitizeState({ progress: { v: 99 } }), null, 'newer versions refused');
});

test('onChange fires on save, pref change and reset (drives background sync)', () => {
  const calls = [];
  const p = createStore(memStorage(), { onChange: urgent => calls.push(!!urgent) });
  p.bump('events'); p.save(); p.setPref('sound', true); p.reset();
  assert.deepEqual(calls, [false, true, true]);
});

test('best-day records: raised by bumps, backfilled from daily history, survive pruning of old days', () => {
  const p = createStore(memStorage());
  p.bump('events', 3);
  p.bump('successfulActions', 2);
  assert.equal(p.data.records.bestDayEvents, 3);
  assert.equal(p.data.records.bestDaySuccesses, 2);
  const s = memStorage({ [KEY]: JSON.stringify({ v: 1, daily: { '2026-01-02': { events: 40, successfulActions: 9 }, '2026-01-03': { events: 12 } } }) });
  const q = createStore(s);
  assert.equal(q.data.records.bestDayEvents, 40, 'backfilled for data saved before the record existed');
  assert.equal(q.data.records.bestDaySuccesses, 9);
  const merged = mergeState(
    { progress: q.data, prefs: q.prefs },
    sanitizeState({ progress: { ...q.data, daily: {}, records: { ...q.data.records, bestDayEvents: 0 } }, prefs: q.prefs }));
  assert.equal(merged.progress.records.bestDayEvents, 40, 'merge keeps the max');
});

test('pane order: sanitised, synced last-writer-wins, cleared by reset', () => {
  const p = createStore(memStorage());
  p.setOrder(['a', 'b', 'a', '__proto__', 7, 'c']);
  assert.deepEqual(p.order, ['a', 'b', 'c']);
  assert.ok(p.prefs.stamps.order > 0);
  const older = { progress: p.data, prefs: { ...p.prefs, order: ['c', 'b', 'a'], stamps: { ...p.prefs.stamps, order: 1 } } };
  assert.deepEqual(mergeState({ progress: p.data, prefs: p.prefs }, older).prefs.order, ['a', 'b', 'c'], 'newer order wins');
  assert.deepEqual(mergeState(older, { progress: p.data, prefs: p.prefs }).prefs.order, ['a', 'b', 'c'], 'either direction');
  p.reset();
  assert.deepEqual(p.order, []);
});

test('pane order: an older build that dropped the list (but kept its stamp) never wipes it', () => {
  const p = createStore(memStorage());
  p.setOrder(['x', 'y']);
  const oldClient = { progress: p.data, prefs: { v: 1, sound: false, projects: {}, stamps: { ...p.prefs.stamps } } };
  const server = { progress: p.data, prefs: p.prefs };
  assert.deepEqual(mergeState(server, sanitizeState(oldClient)).prefs.order, ['x', 'y']);
  assert.deepEqual(mergeState(sanitizeState(oldClient), server).prefs.order, ['x', 'y']);
});

test('older-build blobs without the new records still load and merge', () => {
  const p = createStore(memStorage());
  p.bump('events', 5);
  const { bestDayEvents, bestDaySuccesses, ...oldRecords } = p.data.records;
  const old = sanitizeState({ progress: { ...p.data, daily: {}, records: oldRecords }, prefs: { v: 1, sound: false } });
  assert.ok(old, 'accepted');
  assert.equal(mergeState({ progress: p.data, prefs: p.prefs }, old).progress.records.bestDayEvents, 5);
});

// --- v2: mini-game tallies ---
const V1_BLOB = { v: 1, createdAt: 1000, totals: { events: 7 }, records: { bestCombo: 9 }, discovery: { ufo: 5 }, eggs: {}, projects: {}, daily: {}, sessions: {} };

test('v1 → v2: saved v1 progress migrates on load with empty game tallies, everything else kept', () => {
  assert.equal(VERSION, 2);
  const s = memStorage({ [KEY]: JSON.stringify(V1_BLOB) });
  const p = createStore(s);
  assert.equal(p.status, 'migrated');
  assert.equal(p.data.v, 2);
  assert.equal(p.data.totals.events, 7);
  assert.equal(p.data.records.bestCombo, 9);
  assert.equal(p.data.discovery.ufo, 5);
  assert.deepEqual(p.data.games, { reactionBest: 0, devices: {} });
});

test('v1 → v2: the watcher file and a not-yet-updated device (v1 sync) are migrated, not refused', () => {
  const st = sanitizeState({ progress: V1_BLOB, prefs: { v: 1, sound: true } });
  assert.ok(st, 'v1 accepted');
  assert.equal(st.progress.v, 2);
  assert.equal(st.progress.totals.events, 7);
  assert.equal(st.prefs.sound, true);
  const p = createStore(memStorage({}), { deviceId: 'desk' });
  p.game('huntWon');
  const merged = mergeState({ progress: p.data, prefs: p.prefs }, st);
  assert.equal(merged.progress.games.devices.desk.huntWon, 1);
  assert.equal(merged.progress.totals.events, 7);
  assert.equal(sanitizeState({ progress: { v: 1 } }, 2, { 1: () => { throw new Error('x'); } }), null, 'failed migration refused');
});

test('games: per-device counters sum across devices and never double-count on re-sync', () => {
  const desk = createStore(memStorage(), { deviceId: 'desk' }), phone = createStore(memStorage(), { deviceId: 'phone' });
  desk.game('huntWon'); desk.game('huntWon'); desk.game('bingoWins');
  phone.game('huntWon'); phone.game('huntWon'); phone.game('huntWon');
  assert.equal(desk.game('nope'), false, 'unknown field rejected');
  assert.equal(desk.adopt(stateOf(phone)), true);
  assert.equal(desk.gameTotals.huntWon, 5, '2 + 3, not max(2, 3)');
  assert.equal(desk.gameTotals.bingoWins, 1);
  assert.equal(phone.adopt(stateOf(desk)), true);
  assert.equal(phone.adopt(stateOf(desk)), false, 're-sync is a no-op');
  assert.equal(phone.gameTotals.huntWon, 5);
  phone.game('huntWon');
  desk.adopt(stateOf(phone));
  assert.equal(desk.gameTotals.huntWon, 6);
  for (const k of GAME_COUNTS) assert.equal(typeof desk.gameTotals[k], 'number');
});

test('games: reaction best is the lowest time on any device; unplayed (0) never wins', () => {
  const a = createStore(memStorage(), { deviceId: 'a' }), b = createStore(memStorage(), { deviceId: 'b' });
  assert.equal(a.reactionTime(320), true);
  assert.equal(a.reactionTime(400), false);
  assert.equal(a.reactionTime(-5), false);
  assert.equal(a.reactionTime(NaN), false);
  b.adopt(stateOf(a));
  assert.equal(b.data.games.reactionBest, 320, 'unplayed side adopts the time');
  assert.equal(b.reactionTime(250), true);
  a.adopt(stateOf(b));
  assert.equal(a.data.games.reactionBest, 250);
  const empty = mergeState(stateOf(createStore(memStorage())), stateOf(createStore(memStorage())));
  assert.equal(empty.progress.games.reactionBest, 0);
});

test('games: junk sanitised, prototype keys dropped, device list capped, cleared by reset, follower tab records nothing', () => {
  const devices = Object.fromEntries([...Array(30)].map((_, i) => [`d${i}`, { huntWon: 1, at: i + 1 }]));
  const p = createStore(memStorage({ [KEY]: JSON.stringify({ ...V1_BLOB, v: 2, games: {
    reactionBest: 'fast', devices: { ...devices, ['__proto__']: { huntWon: 9 }, bad: 'x', neg: { huntWon: -4, bingoWins: 2.7, at: 99 } },
  } }) }), { deviceId: 'me' });
  assert.equal(p.data.games.reactionBest, 0);
  assert.equal(Object.keys(p.data.games.devices).length, 20);
  assert.equal(p.data.games.devices.neg.huntWon, 0);
  assert.equal(p.data.games.devices.neg.bingoWins, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(p.data.games.devices, '__proto__'));
  p.reset();
  assert.deepEqual(p.data.games, { reactionBest: 0, devices: {} });
  const f = createStore(memStorage(), { writer: false, deviceId: 'f' });
  assert.equal(f.game('huntWon'), false);
  assert.equal(f.reactionTime(200), false);
});
