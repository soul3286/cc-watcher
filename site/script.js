// Landing page behaviour: hero activity loop (Clawd acts out a session, naps when you go quiet), scroll reveals,
// feature micro-interactions, copy buttons and the phone menu. No libraries; everything degrades to static content.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPR = 'demo/sprites/';

  // ---------- header ----------
  const top = $('.top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const menuBtn = $('.menu-btn'), nav = $('#nav');
  const setMenu = open => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', open); menuBtn.textContent = open ? 'Close' : 'Menu'; };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => e.target.closest('a') && setMenu(false));
  addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

  // ---------- hero stage ----------
  const stage = $('.stage'), img = $('#clawd-img'), cap = $('#stage-cap'), log = $('#log');
  const el = { pill: $('#st-pill'), title: $('#st-title'), detail: $('#st-detail'), meta: $('#st-meta') };
  const chips = $$('.chips li');
  const STEPS = [
    { s: 'read', title: 'Reading file', detail: 'src/garden.ts', tag: ['Read', 't-read'] },
    { s: 'read', title: 'Searching', detail: 'renderTile', tag: ['Grep', 't-read'] },
    { s: 'edit', title: 'Editing file', detail: 'src/render/canvas.ts', tag: ['Edit', 't-edit'] },
    { s: 'edit', title: 'Editing file', detail: 'src/util/grid.ts', tag: ['Edit', 't-edit'] },
    { s: 'run', title: 'Running command', detail: 'npm test', tag: ['Bash', 't-run'], then: ['ok', 't-ok', '112 passing'] },
    { s: 'wait', title: 'Waiting on you', detail: 'git push · needs your OK', tag: ['Bash', 't-run'], img: 'mascot-waiting.gif', dur: 2800 },
    { s: 'done', title: 'Done', detail: 'Grid renders in 12ms. All 112 tests pass.', then: ['done', 't-ok', 'turn complete'], img: 'mascot-done.gif', dur: 3400 },
    { s: 'idle', title: 'Idle', detail: 'waiting for next action…', img: 'mascot-idle-vibe.gif', dur: 5200 },
  ];
  const PILL = { read: 'WORKING', edit: 'WORKING', run: 'WORKING', wait: 'WAITING', done: 'DONE', idle: 'IDLE', asleep: 'ASLEEP' };
  const CAP = 'psst — try clicking him';
  let i = 0, events = 12, streak = 4, timer = 0, visible = true, sleeping = false, busy = false;
  const clock = () => new Date().toTimeString().slice(0, 8);
  const sprite = f => { const src = SPR + f; if (!img.src.endsWith(src)) img.src = src; };
  const meta = () => { el.meta.textContent = `${events} EVENTS · STREAK ${streak}`; };

  function addLog([tool, cls, text]) {
    const li = document.createElement('li');
    li.className = 'new';
    li.innerHTML = `<time>${clock()}</time><b class="${cls}"></b><span></span>`;
    li.querySelector('b').textContent = tool; li.querySelector('span').textContent = text;
    log.append(li);
    while (log.children.length > 3) log.firstElementChild.remove();
  }

  function show(st) {
    stage.dataset.s = st.s;
    el.pill.textContent = PILL[st.s];
    chips.forEach(c => c.classList.toggle('on', c.dataset.k === st.s));
    stage.classList.add('swap');
    setTimeout(() => { el.title.textContent = st.title; el.detail.textContent = st.detail; stage.classList.remove('swap'); }, 160);
    sprite(st.img ?? 'mascot.gif');
  }

  function step() {
    clearTimeout(timer);
    if (!visible || sleeping || busy) return;
    const st = STEPS[i];
    show(st);
    if (st.tag) { addLog([...st.tag, st.detail.split(' · ')[0]]); events++; }
    if (st.then) setTimeout(() => { addLog(st.then); events++; streak++; meta(); }, 900);
    meta();
    i = (i + 1) % STEPS.length;
    timer = setTimeout(step, st.dur ?? 2100);
  }

  // Sleepy Clawd: after a while with no input he yawns and dozes off; any input wakes him.
  let quietT = 0;
  function fallAsleep() {
    if (!visible || busy) return;
    sleeping = true; clearTimeout(timer);
    show({ s: 'idle', title: 'Yawning…', detail: 'it has been quiet for a bit', img: 'mascot-idle-yawn.gif' });
    timer = setTimeout(() => {
      show({ s: 'asleep', title: 'Asleep', detail: 'zzz… move the mouse to wake him', img: 'mascot-asleep.png' });
      cap.textContent = 'shh — he dozed off';
    }, 4300);
  }
  function poke() {
    clearTimeout(quietT);
    quietT = setTimeout(fallAsleep, 28_000);
    if (sleeping) { sleeping = false; cap.textContent = CAP; i = 0; step(); }
  }

  // Petting: each click is a happy hop; every fifth is a party.
  let pets = 0, petT = 0;
  $('#clawd').addEventListener('click', () => {
    pets++; clearTimeout(petT); clearTimeout(timer);
    busy = true; sleeping = false;
    const party = pets % 5 === 0;
    show({ s: 'done', title: party ? `COMBO ×${pets}!` : `Pet ×${pets}`, detail: party ? 'Clawd is throwing a party.' : 'Clawd approves.',
      img: calm ? 'mascot-idle.png' : party ? 'egg-party.gif' : 'egg-happy.gif' });
    el.pill.textContent = party ? 'PARTY' : 'HAPPY';
    cap.textContent = party ? 'you found the party' : `${5 - (pets % 5)} more for a surprise`;
    petT = setTimeout(() => { busy = false; cap.textContent = CAP; calm ? show({ ...STEPS[0], img: 'mascot-idle.png' }) : step(); }, party ? 4200 : 2600);
    if (!calm) poke();
  });

  stage.dataset.s = 'read';
  if (calm) sprite('mascot-idle.png'); // reduced motion: a still, readable snapshot; no loop, no naps
  else {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && !document.hidden;
      clearTimeout(timer);
      if (visible && !busy && !sleeping) timer = setTimeout(step, 600);
    }).observe(stage);
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; visible ? step() : clearTimeout(timer); });
    ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(t => addEventListener(t, poke, { passive: true }));
    poke();
    // Warm the next poses so swaps never flash empty.
    addEventListener('load', () => setTimeout(() => ['mascot-waiting.gif', 'mascot-done.gif', 'mascot-idle-vibe.gif', 'mascot-idle-yawn.gif', 'mascot-asleep.png', 'egg-happy.gif']
      .forEach(f => { new Image().src = SPR + f; }), 1500));
  }

  // ---------- live demo: the whole dashboard, so only load it when it is about to scroll into view ----------
  const frame = $('#demo-frame');
  const loadDemo = () => { if (!frame.src) frame.src = frame.dataset.src; };
  if ('IntersectionObserver' in window) {
    const fio = new IntersectionObserver(([e]) => { if (e.isIntersecting) { loadDemo(); fio.disconnect(); } }, { rootMargin: '200px 0px' });
    fio.observe(frame);
  } else loadDemo();
  $$('a[href="#demo"]').forEach(a => a.addEventListener('click', loadDemo));
  // The video poster is a big image far down the page: fetch it only when the video comes near.
  const video = $('video[data-poster]');
  const loadPoster = () => { video.poster = video.dataset.poster; };
  if ('IntersectionObserver' in window) {
    const vio = new IntersectionObserver(([e]) => { if (e.isIntersecting) { loadPoster(); vio.disconnect(); } }, { rootMargin: '400px 0px' });
    vio.observe(video);
  } else loadPoster();

  // ---------- reveals + feature micro-interactions ----------
  function countUp(b) {
    const n = +b.dataset.count, t0 = performance.now();
    const tick = t => { const k = Math.min(1, (t - t0) / 900); b.textContent = Math.round(n * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function play(card) {
    card.classList.remove('play'); void card.offsetWidth; card.classList.add('play');
    $$('[data-count]', card).forEach(countUp);
  }
  if ('IntersectionObserver' in window && !calm) {
    $$('[data-count]').forEach(b => { b.textContent = '0'; });
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.matches('[data-play]')) setTimeout(() => play(e.target), 250);
      io.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    $$('.reveal').forEach(r => io.observe(r));
    $$('[data-play]').forEach(c => c.addEventListener('pointerenter', () => c.classList.contains('in') && play(c)));
  } else $$('.reveal').forEach(r => r.classList.add('in'));

  // Clawd's moods (feature card)
  const MOODS = { working: ['mascot.gif', 'working'], done: ['mascot-done.gif', 'done'], error: ['mascot-error.gif', 'hitting an error'], asleep: ['mascot-asleep.png', 'asleep'] };
  const moodImg = $('#mood-img'), moodBtns = $$('.mood-btns button');
  moodBtns.forEach(b => b.addEventListener('click', () => {
    const [f, label] = MOODS[b.dataset.mood];
    moodImg.src = SPR + f; moodImg.alt = `Clawd, ${label}`;
    moodBtns.forEach(o => o.setAttribute('aria-pressed', o === b));
  }));

  // ---------- copy buttons ----------
  const status = $('#copy-status');
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta); ta.select();
      const ok = (() => { try { return document.execCommand('copy'); } catch { return false; } })();
      ta.remove(); return ok;
    }
  }
  $$('.copy').forEach(b => b.addEventListener('click', async () => {
    const ok = await copy(b.dataset.copy);
    b.textContent = ok ? 'Copied' : 'Select & copy';
    b.classList.toggle('done', ok);
    status.textContent = ok ? `Copied: ${b.dataset.copy}` : 'Copy failed. The text is selected, copy it manually.';
    if (!ok) getSelection().selectAllChildren(b.previousElementSibling);
    clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1800);
  }));
})();
