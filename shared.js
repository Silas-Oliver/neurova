window.Neurova = window.Neurova || {};

(function(){
  // ---------------- page routing ----------------
  const PAGES = ['home', 'test-menu', 'data', 'specs', 'contact', 'account'];
  let dataChartReady = false;
  // Declared up here, not beside initDataChart far below. showPage() runs during
  // module init and calls initDataChart() when the page loads straight onto #data,
  // which reached this binding before its declaration had run -- a temporal dead
  // zone ReferenceError that left the chart uninitialised on that one entry path.
  let dataLoadToken = 0;

  // ---------------- arrival routing ----------------
  //
  // No page is restricted. A visitor who arrives signed out is shown the sign-in screen
  // once, on arrival, with wherever they were heading remembered so that signing in --
  // or continuing as a guest -- drops them there rather than on Home. After that they
  // are free to go anywhere, signed in or not; the prompts in the pages do the work of
  // explaining what an account adds.
  //
  // This is a soft wall rather than a gate, deliberately. A hard per-navigation check
  // made Contact unreachable for exactly the person most likely to need it: someone who
  // cannot sign in and wants to say so.

  // The destination someone was aiming for when the sign-in screen interrupted them,
  // held across the sign-in -- including across a Google popup, which is why this is
  // sessionStorage and not a variable.
  const DEST_KEY = 'neurovaAuthDest';
  function rememberDestination(name){
    if(!name || name === 'account' || !PAGES.includes(name)) return;
    try{ sessionStorage.setItem(DEST_KEY, name); }catch(e){ /* storage unavailable */ }
  }
  function takeDestination(){
    let d = null;
    try{ d = sessionStorage.getItem(DEST_KEY); sessionStorage.removeItem(DEST_KEY); }catch(e){}
    return (d && PAGES.includes(d)) ? d : null;
  }
  window.Neurova.rememberDestination = rememberDestination;
  window.Neurova.takeDestination = takeDestination;

  // ---------------- build identifier ----------------
  //
  // Taken out of this file's own ?v=, not written here as a literal. The whole point
  // of showing it is to answer "am I looking at a stale page", and a hardcoded string
  // cannot answer that -- it would be served from the same cache as everything else
  // and would confidently report whatever version it was cached alongside. Reading it
  // back off the URL the browser actually fetched means the number shown is, by
  // construction, the build running in this tab.
  //
  // document.currentScript is read at parse time; by the time any handler runs it is
  // null, which is why this is captured here at the top rather than where it is used.
  const BUILD = (function(){
    try{
      const self = document.currentScript
        || document.querySelector('script[src*="shared.js"]');
      const m = self && /[?&]v=([^&"']+)/.exec(self.getAttribute('src') || '');
      return m ? decodeURIComponent(m[1]) : 'unversioned';
    }catch(e){ return 'unversioned'; }
  })();
  window.Neurova.build = BUILD;

  document.querySelectorAll('[data-version]').forEach(el => { el.textContent = BUILD; });

  // Also on the console, so it can be read off a phone over remote inspection, or
  // quoted in a bug report, without hunting for the footer.
  try{ console.info('Neurova build ' + BUILD); }catch(e){}

  // ---------------- motion helpers ----------------
  //
  // Replays the CSS entrance on an element whose text was just rewritten. Changing
  // textContent does not restart an animation -- the node is the same node -- so the
  // class is removed, a reflow is forced to flush that removal, and it goes back on.
  // Reading offsetWidth is what makes this work; without it the browser coalesces the
  // remove and the add into no change at all.
  //
  // Skipped outright under reduced motion: the global CSS rule already collapses the
  // duration, but adding and removing classes on every live reading is pointless work
  // for someone who has asked not to see it.
  const prefersReducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function replayLanding(el){
    if(!el || prefersReducedMotion) return;
    el.classList.remove('did-land');
    void el.offsetWidth;
    el.classList.add('did-land');
  }
  window.Neurova.replayLanding = replayLanding;

  // Points a panel's transform-origin at whatever opened it, so it grows out of its
  // own trigger. Falls back to the element's middle when there is no trigger to read,
  // which is also what the CSS does if this never runs.
  function setGrowOrigin(panel, trigger){
    if(!panel) return;
    if(!trigger || prefersReducedMotion){
      panel.style.removeProperty('--ox');
      panel.style.removeProperty('--oy');
      return;
    }
    const p = panel.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    // offsetWidth/Height rather than the rect's: the panel may already be scaled by
    // its own entrance, and a scaled rect would put the origin a few pixels adrift
    // and make the panel visibly slide as it grows.
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const left = p.left + (p.width - pw) / 2;
    const top = p.top + (p.height - ph) / 2;
    panel.style.setProperty('--ox', ((t.left + t.width / 2) - left) + 'px');
    panel.style.setProperty('--oy', ((t.top + t.height / 2) - top) + 'px');
  }
  window.Neurova.setGrowOrigin = setGrowOrigin;

  // Identity is required for every page except the one that grants it. A guest counts
  // -- the gate is not about having paid or registered, it is that nothing renders for
  // a visitor the app has never been introduced to.
  //
  // 'account' is the sole exception, because it is where the gate sends people and a
  // gate redirecting to a gated page is a loop.
  const OPEN_PAGES = ['account'];
  function gateArmed(){ return window.Neurova.authSettled === true; }
  function hasIdentity(){ return !!(window.Neurova.getUser && window.Neurova.getUser()); }

  function showPage(name){
    if(!PAGES.includes(name)) name = 'home';

    // Every route goes through here -- a nav click, the mobile dock, the back button,
    // a hash typed into the bar, and the redirect that lands on desktop.html or
    // mobile.html -- so this is the one place the check has to be.
    if(gateArmed() && !hasIdentity() && !OPEN_PAGES.includes(name)){
      rememberDestination(name);
      name = 'account';
    }

    document.querySelectorAll('.page').forEach(p => {
      const active = p.dataset.page === name;
      p.classList.toggle('page-active', active);
      if(!active){ p.classList.remove('is-entering'); return; }
      // The entrance is a class the page wears briefly, never its resting state, so a
      // stalled animation can dim the page for one timeout at worst and never strand
      // it at opacity zero. Reduced motion skips the whole dance.
      if(prefersReducedMotion) return;
      p.classList.remove('is-entering');
      void p.offsetWidth;          // flush, so re-navigating to the same page replays
      p.classList.add('is-entering');
      clearTimeout(p._enterTimer);
      // Comfortably longer than --dur-page, so this only ever fires as the backstop
      // it is meant to be and never clips an animation that is still running.
      p._enterTimer = setTimeout(() => p.classList.remove('is-entering'), 700);
    });
    // The sign-in page takes over the viewport, but only while it is the page on screen —
    // being signed out must not strip the chrome from the rest of the site.
    document.body.classList.toggle('on-account', name === 'account');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
    window.scrollTo(0, 0);
    history.replaceState(null, '', '#' + name);
    // Reload every visit, not just the first. Sessions are written by running a test on
    // the Test menu, so the common path is to log something and then come straight here —
    // loading once per page load meant that new session was missing until a manual
    // refresh. The read is small and superseded loads discard themselves.
    if(name === 'data'){
      dataChartReady = true;
      initDataChart();
    }
  }

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      showPage(el.dataset.nav);
      closeMobileNav();
    });
  });

  // Deferred by one microtask rather than called inline. showPage() reaches forward into
  // initDataChart(), DATA_METRICS and renderMetricTabs, all declared much further down
  // this module. Landing straight on #data therefore ran those reads before their
  // declarations had executed and threw "Cannot access before initialization", leaving
  // the chart uninitialised on that one entry path. A microtask runs after the module
  // body finishes and before paint, so nothing is visibly delayed.
  queueMicrotask(() => showPage((location.hash || '#home').slice(1)));
  window.Neurova.goToPage = showPage;

  // Until now nothing listened for this, so editing the hash by hand changed the address
  // bar and nothing else -- the page only caught up on a reload. That is both a bug in
  // its own right (the back button did nothing) and a hole in the gate, since the check
  // above can only run on a navigation it is told about. showPage uses replaceState
  // rather than pushState, so this fires for manual edits and for the browser's own
  // back and forward, and never for our own navigations.
  window.addEventListener('hashchange', () => {
    showPage((location.hash || '#home').slice(1));
  });

  // ---------------- mobile hamburger nav ----------------
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const mobileNavPanel = document.getElementById('mobileNavPanel');

  function openMobileNav(){
    hamburgerBtn.classList.add('open');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    mobileNavPanel.classList.add('open');
  }
  function closeMobileNav(){
    if(!hamburgerBtn || !mobileNavPanel) return;
    hamburgerBtn.classList.remove('open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    mobileNavPanel.classList.remove('open');
  }
  if(hamburgerBtn && mobileNavPanel){
    hamburgerBtn.addEventListener('click', () => {
      if(mobileNavPanel.classList.contains('open')) closeMobileNav();
      else openMobileNav();
    });
  }

  // ---------------- roadmap: featured card + grid, auto-cycling ----------------
  const ROADMAP_TESTS = [
    {
      status: 'live', label: 'Live', title: 'Electrode contact check',
      short: "Verifies electrode-to-skin contact is good before trusting anything else.",
      long: "Calibrate against your own best-contact baseline, then verify the electrode's resistance is in range before every session starts. Nothing else on this list can be trusted without it.",
      icon: `<circle cx="8" cy="20" r="3.4" stroke="var(--good)" stroke-width="1.8"/><circle cx="24" cy="20" r="3.4" stroke="var(--good)" stroke-width="1.8"/><path d="M11.5 20H20.5" stroke="var(--good)" stroke-width="1.8"/><path d="M12 10l3 3 6-7" stroke="var(--good)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    {
      status: 'next', label: 'Next', title: 'Reaction-time test',
      short: "A countdown, then a randomly-timed cue — timing the nerve signal, then the finger.",
      long: "A countdown, then a randomly-timed cue — measuring how long the muscle's electrical signal takes to fire (premotor time), and then how long the finger takes to actually start moving (electromechanical delay).",
      icon: `<circle cx="16" cy="18" r="9" stroke="var(--warn)" stroke-width="1.8"/><path d="M16 18V12" stroke="var(--warn)" stroke-width="1.8" stroke-linecap="round"/><path d="M16 18l4 3" stroke="var(--warn)" stroke-width="1.8" stroke-linecap="round"/><path d="M13 6H19" stroke="var(--warn)" stroke-width="1.8" stroke-linecap="round"/>`
    },
    {
      status: 'next', label: 'Next', title: 'Baseline recording',
      short: "Captures a short reference recording once contact reads good or better.",
      long: "Once contact is confirmed good, captures a short reference recording of the tracked signal — the baseline every later session gets compared against to see whether things are trending toward recovery.",
      icon: `<rect x="4" y="6" width="24" height="20" rx="3" stroke="var(--warn)" stroke-width="1.6"/><path d="M7 18 L11 18 L13 11 L16 23 L19 14 L21 18 L25 18" stroke="var(--warn)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    {
      status: 'planned', label: 'Planned', title: 'Session logging',
      short: "Bundles a test run's numbers with the contact quality it was measured under.",
      long: "Each worn session is stored with its contact quality, timestamp, and signal summary, so a session measured under bad contact is never mistaken for — or compared directly against — one measured under good contact.",
      icon: `<rect x="6" y="8" width="20" height="4.5" rx="1.5" stroke="var(--muted)" stroke-width="1.6"/><rect x="6" y="14.5" width="20" height="4.5" rx="1.5" stroke="var(--muted)" stroke-width="1.6"/><rect x="6" y="21" width="20" height="4.5" rx="1.5" stroke="var(--muted)" stroke-width="1.6"/>`
    },
    {
      status: 'planned', label: 'Planned', title: 'Recovery tracking over time',
      short: "Plots the same metric session by session to show trend, plateau, or a need for follow-up.",
      long: "Sessions laid out across weeks to show whether signal strength and reaction timing are trending toward recovery, plateauing, or worth flagging to a clinician for a closer look.",
      icon: `<path d="M5 23 L12 15 L17 19 L27 7" stroke="var(--muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 7H27V13" stroke="var(--muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  ];

  const roadmapLayout = document.getElementById('roadmapLayout');
  const testFeatured = document.getElementById('testFeatured');
  const testGrid = document.getElementById('testGrid');
  let roadmapIndex = 0;
  let roadmapTimer = null;
  const roadmapReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function roadmapIconSvg(icon){
    return `<svg viewBox="0 0 32 32" fill="none">${icon}</svg>`;
  }

  function renderFeatured(){
    const t = ROADMAP_TESTS[roadmapIndex];
    const dots = ROADMAP_TESTS.map((_, i) =>
      `<button class="roadmap-dot${i === roadmapIndex ? ' active' : ''}" data-idx="${i}" aria-label="Show ${ROADMAP_TESTS[i].title}"></button>`
    ).join('');
    testFeatured.innerHTML = `
      <div class="test-featured-body" id="testFeaturedBody">
        <div class="icon-wrap">${roadmapIconSvg(t.icon)}</div>
        <span class="status-chip-sm st-${t.status}">${t.label}</span>
        <h3>${t.title}</h3>
        <p>${t.long}</p>
      </div>
      <div class="roadmap-dots">${dots}</div>`;
    testFeatured.querySelectorAll('.roadmap-dot').forEach(dot => {
      dot.addEventListener('click', () => selectRoadmap(parseInt(dot.dataset.idx, 10)));
    });
  }

  function renderGrid(){
    const others = ROADMAP_TESTS.map((t, i) => ({ t, i })).filter(x => x.i !== roadmapIndex);
    testGrid.innerHTML = others.map(({ t, i }) => `
      <button class="test-card" data-idx="${i}" type="button">
        <div class="icon-wrap">${roadmapIconSvg(t.icon)}</div>
        <span class="status-chip-sm st-${t.status}">${t.label}</span>
        <h3>${t.title}</h3>
        <p>${t.short}</p>
      </button>`).join('');
    testGrid.querySelectorAll('.test-card').forEach(card => {
      card.addEventListener('click', () => selectRoadmap(parseInt(card.dataset.idx, 10)));
    });
  }

  function renderRoadmap(){
    renderFeatured();
    renderGrid();
  }

  function selectRoadmap(idx){
    if(idx === roadmapIndex) return;
    const body = document.getElementById('testFeaturedBody');
    const cards = testGrid.querySelectorAll('.test-card');
    if(roadmapReducedMotion || !body){
      roadmapIndex = idx;
      renderRoadmap();
    } else {
      body.classList.add('fading');
      cards.forEach(c => c.classList.add('fading'));
      setTimeout(() => {
        roadmapIndex = idx;
        renderRoadmap();
      }, 180);
    }
    restartRoadmapTimer();
  }

  function advanceRoadmap(){
    selectRoadmap((roadmapIndex + 1) % ROADMAP_TESTS.length);
  }

  function restartRoadmapTimer(){
    if(roadmapTimer) clearInterval(roadmapTimer);
    if(roadmapReducedMotion) return;
    roadmapTimer = setInterval(advanceRoadmap, 8000);
  }

  if(testFeatured && testGrid){
    renderRoadmap();
    restartRoadmapTimer();
    roadmapLayout.addEventListener('mouseenter', () => { if(roadmapTimer) clearInterval(roadmapTimer); });
    roadmapLayout.addEventListener('mouseleave', () => restartRoadmapTimer());
  }


  // ---------------- home motion ----------------
  //
  // Scroll reveals and a counting readout. Both are checked against
  // prefers-reduced-motion, and both leave the page fully legible if the
  // observer never fires -- the reveal class only ever adds opacity back.
  (function(){
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tiles = document.querySelectorAll('.jump-tile');
    if(tiles.length && !reduced && 'IntersectionObserver' in window){
      tiles.forEach((t, i) => {
        t.classList.add('reveal');
        t.style.transitionDelay = (i * 70) + 'ms';
      });
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.15 });
      tiles.forEach(t => io.observe(t));
    }

  })();


  // ---------------- rotating accent band ----------------
  //
  // Same idea as the roadmap carousel that used to sit on this page: one claim at a time,
  // changed on a timer, so a static band earns a second look. One panel rather than a
  // featured-plus-four, which is what makes it readable at this size.
  (function(){
    // The tests themselves, in the order the test menu runs them -- not assorted facts
    // about the project. Each one is a thing you can actually go and do.
    const SHOW_SLIDES = [
      { pill:'Contact check', title:'Every Test Starts<br>With Contact Quality',
        sub:'Loose contact and a stalled nerve look identical. One of them is fixable in seconds.' },
      { pill:'Calibration',   title:'Your Baseline,<br>Not A Fixed Number',
        sub:'Skin varies between people and across a day. Every reading is judged against your own.' },
      { pill:'EMG',           title:'Watch The Muscle<br>Before The Hand Moves',
        sub:'Electrical activity reaches the skin whether or not the finger follows.' },
      { pill:'Flex',          title:'How Far It Actually<br>Moved, In Degrees',
        sub:'Bend angle across the finger, measured against your own open and closed hand.' },
      { pill:'Sessions',      title:'One Reading Means<br>Little. Twenty Mean A Trend.',
        sub:'Every run logged and plotted, so change over weeks is visible rather than remembered.' }
    ];
    const band = document.getElementById('ecShow');
    const body = document.getElementById('ecShowBody');
    const dots = document.getElementById('ecShowDots');
    if(!band || !body || !dots) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let idx = 0, timer = null;

    function paint(){
      const s = SHOW_SLIDES[idx];
      document.getElementById('ecShowPill').textContent = s.pill;
      document.getElementById('ecShowTitle').innerHTML = s.title;
      document.getElementById('ecShowSub').textContent = s.sub;
      dots.querySelectorAll('button').forEach((d, i) => d.classList.toggle('active', i === idx));
    }
    function go(i){
      if(i === idx) return;
      idx = i;
      if(reduced){ paint(); return; }
      // Fade out, swap, fade back, so the text never changes under the reader's eye.
      body.classList.add('fading');
      setTimeout(() => { paint(); body.classList.remove('fading'); }, 220);
      restart();
    }
    function restart(){
      if(timer) clearInterval(timer);
      if(reduced) return;
      timer = setInterval(() => go((idx + 1) % SHOW_SLIDES.length), 10000);
    }

    dots.innerHTML = SHOW_SLIDES.map((s, i) =>
      `<button class="ec-dot${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="${s.pill}"></button>`).join('');
    dots.querySelectorAll('button').forEach(d =>
      d.addEventListener('click', () => go(parseInt(d.dataset.i, 10))));

    paint();
    restart();
    // Stop advancing while someone is reading it.
    // Clicking anywhere on the band advances it, so the dots are a shortcut rather than
    // the only way through. The dots stop the click bubbling into a second advance.
    band.addEventListener('click', () => go((idx + 1) % SHOW_SLIDES.length));
    band.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go((idx + 1) % SHOW_SLIDES.length); }
    });
    dots.addEventListener('click', e => e.stopPropagation());

    band.addEventListener('mouseenter', () => { if(timer) clearInterval(timer); });
    band.addEventListener('mouseleave', restart);
  })();

  // ---------------- clock ----------------
  function tickClock(){
    const clockEl = document.getElementById('scopeClock');
    const scopeEl = document.getElementById('heroScope');
    // A running clock on a panel full of invented numbers reads as a live instrument.
    // While it is a sample it says so, and only starts ticking once a board is attached.
    if(clockEl) clockEl.textContent = (scopeEl && scopeEl.classList.contains('is-sample'))
      ? 'SAMPLE'
      : new Date().toLocaleTimeString('en-GB');
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------------- serial support check ----------------
  const serialSupported = 'serial' in navigator;

  let port = null;
  let writer = null;
  // The one thing everything above this line needs from a glove: somewhere to send a
  // command. Web Serial fills it from a real port today; the simulator fills it from a
  // script; a Bluetooth transport will fill it from a GATT characteristic without any
  // of the callers knowing. Connected-ness is "is there a link", not "is there a port".
  let link = null;   // { kind, send(line), close() }
  const simulated = /[?&#]sim\b/.test(location.href);
  let reader = null;
  let readableClosed = null;
  let keepReading = false;

  const topStatusDot = document.getElementById('topStatusDot');
  const topStatusText = document.getElementById('topStatusText');
  // Both the home panel and the test-menu panel carry a status readout. They used to
  // share one id, so getElementById only ever found the first and the test-menu one sat
  // on "Not connected" however connected you were -- while the Disconnect button beside
  // it said otherwise. Classes, and update every match.
  const panelStatusDots = document.querySelectorAll('.js-panel-dot');
  const panelStatusTexts = document.querySelectorAll('.js-panel-status');
  const panelStateLabel = document.getElementById('panelStateLabel');
  const enterMenuBtn = document.getElementById('enterMenuBtn');
  const heroConnectBtn = document.getElementById('heroConnectBtn');
  const panelConnectBtn = document.getElementById('panelConnectBtn');
  const baudSelect = document.getElementById('baudSelect');

  // The hero panel shows placeholder readings until a board is attached. Connecting clears
  // the sample marking and hands it over to real values, so it stops being decoration and
  // becomes an actual readout.
  function setScopeSampleMode(isSample){
    const scopeEl = document.getElementById('heroScope');
    if(scopeEl) scopeEl.classList.toggle('is-sample', isSample);
    // No invented readings. With nothing measured yet the panel shows a dash, which is
    // information; a plausible-looking number is not. Real values arrive from the board,
    // through setHeroReading, and only once it has actually measured something.
    clearHeroReading();
  }

  function clearHeroReading(){
    setScopeText('scopeValueLabel', 'Contact impedance');
    setScopeText('scopeValueNum', '—');
    setScopeText('scopeValueUnit', '');
  }

  // Shows an impedance the board reported. kΩ past a thousand, because five significant
  // digits of ohms is noise at this size and nothing downstream needs that precision.
  function setHeroReading(ohms, label){
    if(ohms === null || ohms === undefined || !isFinite(ohms)){
      clearHeroReading();
      return;
    }
    // Every caller of this is a discrete event -- a baseline restored, a calibration
    // finished, a test finished -- never a streaming tick, so a landing here marks a
    // real moment rather than flickering on every sample.
    const card = document.querySelector('.ec-hero-card-read');
    const prev = card ? card.textContent : null;
    setScopeText('scopeValueLabel', label);
    if(ohms >= 1000){
      setScopeText('scopeValueNum', (Math.round(ohms / 100) / 10).toFixed(1));
      setScopeText('scopeValueUnit', 'kΩ');
    } else {
      setScopeText('scopeValueNum', String(Math.round(ohms)));
      setScopeText('scopeValueUnit', 'Ω');
    }
    if(card && card.textContent !== prev && window.Neurova.replayLanding){
      window.Neurova.replayLanding(card);
    }
  }

  function setScopeText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function setConnectedUI(connected){
    setScopeSampleMode(!connected);
    topStatusDot.classList.toggle('on', connected);
    panelStatusDots.forEach(d => d.classList.toggle('on', connected));
    topStatusText.textContent = connected ? 'Glove connected' : 'No glove connected';
    panelStatusTexts.forEach(t => { t.textContent = connected ? 'Connected' : 'Not connected'; });
    enterMenuBtn.disabled = !connected;
    heroConnectBtn.textContent = connected ? 'Glove connected' : 'Connect your glove';
    heroConnectBtn.disabled = connected;
    panelConnectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  }
  setConnectedUI(false);

  async function connectSerial(){
    if(simulated){ connectSimulator(); return; }
    // Desktop keeps the cable: Web Serial is what the board speaks today and what every
    // existing instruction assumes. A phone has no Web Serial at all, so it goes to
    // Bluetooth automatically; ?ble forces it on desktop for testing a wireless board.
    if(forceBle || (!serialSupported && bluetoothSupported)){ await connectBluetooth(); return; }
    if(!serialSupported){
      alert('This browser can\'t connect to the glove. Use Chrome or Edge on desktop for a cabled glove, or Chrome on Android for a wireless one.');
      return;
    }
    try{
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: parseInt(baudSelect.value, 10) });
      writer = port.writable.getWriter();
      const encoder = new TextEncoder();
      link = { kind: 'serial', send: (l) => writer.write(encoder.encode(l + '\n')) };
      setConnectedUI(true);
      startReadLoop();
      // Opening the port resets the board, and the bootloader eats anything sent during
      // the first second or so — so ask once the sketch is actually running. The board
      // also announces its status on boot; either answer is handled the same way.
      setTimeout(() => { if(link) sendCommand('STATUS').catch(()=>{}); }, 2000);
    }catch(err){
      if(err && err.name !== 'NotFoundError'){
        console.error(err);
        alert('Could not connect: ' + err.message + (err.message && err.message.toLowerCase().includes('open') ? '\n\nThis usually means something else has the port — close the Arduino IDE\'s Serial Monitor/Plotter, close other tabs using this port, or unplug and replug your glove, then try again.' : ''));
      }
    }
  }

  async function disconnectSerial(){
    keepReading = false;
    if(bleDevice){ try{ bleDevice.removeEventListener('gattserverdisconnected', handleBleDropped); }catch(e){} }
    bleDevice = null;
    bleBuffer = '';
    try{ if(link && link.close){ link.close(); } }catch(e){}
    link = null;
    try{ if(reader){ await reader.cancel(); } }catch(e){}
    try{ if(writer){ writer.releaseLock(); } }catch(e){}
    try{ if(readableClosed){ await readableClosed.catch(()=>{}); } }catch(e){}
    try{ if(port){ await port.close(); } }catch(e){}
    port = null; writer = null; reader = null;
    emgStreamingActive = false;  // the board can't hear STOP anymore; just stop tracking it as running
    setConnectedUI(false);
    // Nothing can be tested without a board, and on the next connect the board tells us
    // its baseline again — so don't leave the tests looking open.
    boardBaseline = null;
    setTestUnlocked(false);
    renderCalibScreen();
  }

  // ---------------- bluetooth ----------------
  // Nordic UART Service: serial over BLE, and the service an nRF52840 exposes by default.
  // Picked because the firmware already speaks newline-delimited text and NUS carries
  // exactly that -- so the parser, the command set and the simulator are all untouched by
  // the move off a cable. Web Bluetooth needs HTTPS and a user gesture; the connect
  // button is one.
  const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';   // phone writes here
  const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // glove notifies here
  const bluetoothSupported = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  const forceBle = /[?&#]ble\b/.test(location.href);

  // The "unsupported" notice used to appear whenever Web Serial was missing, which meant
  // every phone saw it. That was right when a cable was the only way in; with Bluetooth
  // it would be telling an Android user to go and find a desktop for no reason. Shown
  // now only when neither transport exists -- which is an iPhone or iPad, where no
  // browser can reach the glove at all.
  if(!serialSupported && !bluetoothSupported){
    const notice = document.getElementById('unsupportedNotice');
    if(notice) notice.style.display = 'block';
  }
  let bleDevice = null;
  let bleBuffer = '';

  // The default BLE payload is 20 bytes. Commands are short, but SETBASELINE with a six
  // figure number plus a newline is already close, so everything is written in slices
  // rather than assuming one will fit.
  async function bleWrite(ch, bytes){
    for(let i = 0; i < bytes.length; i += 20){
      const slice = bytes.slice(i, i + 20);
      try{
        if(ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(slice);
        else await ch.writeValue(slice);
      }catch(e){
        await ch.writeValue(slice);
      }
    }
  }

  async function connectBluetooth(){
    if(!bluetoothSupported){
      alert('This browser can\'t use Bluetooth. On a phone, try Chrome on Android — iPhone and iPad browsers have no Bluetooth access.');
      return;
    }
    try{
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [NUS_SERVICE] }] });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(NUS_SERVICE);
      const rx = await service.getCharacteristic(NUS_RX);
      const tx = await service.getCharacteristic(NUS_TX);

      bleBuffer = '';
      const decoder = new TextDecoder();
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', (e) => {
        // Notifications arrive in packets, not lines -- a line can span two of them and a
        // packet can hold several. Same buffering the serial read loop does.
        bleBuffer += decoder.decode(e.target.value);
        let i;
        while((i = bleBuffer.indexOf('\n')) >= 0){
          const line = bleBuffer.slice(0, i);
          bleBuffer = bleBuffer.slice(i + 1);
          handleIncomingLine(line);
        }
      });

      device.addEventListener('gattserverdisconnected', handleBleDropped);
      bleDevice = device;

      const encoder = new TextEncoder();
      link = {
        kind: 'bluetooth',
        send: (l) => bleWrite(rx, encoder.encode(l + '\n')),
        close: () => { try{ if(device.gatt.connected) device.gatt.disconnect(); }catch(e){} }
      };
      setConnectedUI(true);
      // No bootloader to wait out over BLE, unlike opening a serial port.
      setTimeout(() => { if(link) sendCommand('STATUS').catch(()=>{}); }, 300);
    }catch(err){
      // Dismissing the chooser is a NotFoundError and is not worth a dialog.
      if(err && err.name !== 'NotFoundError'){
        console.error('Bluetooth connect failed:', err);
        alert('Could not connect over Bluetooth: ' + (err.message || err.name));
      }
    }
  }

  // The glove walking out of range is a disconnect the user did not ask for, so it has to
  // tear down the same state the Disconnect button does -- otherwise the tests stay
  // unlocked against a glove that is not there.
  function handleBleDropped(){
    if(!bleDevice) return;
    bleDevice = null;
    link = null;
    bleBuffer = '';
    setConnectedUI(false);
    boardBaseline = null;
    setTestUnlocked(false);
    renderCalibScreen();
  }

  // ---------------- simulated glove ----------------
  // Speaks the same line protocol as ContactTest-Final.ino, so everything above it --
  // the calibration screen, the contact test, the EMG and flex readouts, session
  // logging -- runs exactly as it does against the real board. Enabled with ?sim on the
  // URL and nowhere else, so an ordinary visitor never meets it. The point is to let the
  // app be built and demonstrated while the hardware is still in pieces; it is a stand-in
  // for a glove, not evidence that one works.
  function connectSimulator(){
    let baseline = null;         // Ω, null until calibrated
    let emgTimer = null, flexTimer = null, flexPhase = 0;
    const timers = new Set();

    const emit = (line) => handleIncomingLine(line);
    const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    // Real contact wanders; a flat number would make every screen look better behaved
    // than the hardware has ever been.
    const jitter = (v, frac) => v * (1 + (Math.random() - 0.5) * 2 * frac);

    function receive(cmd){
      cmd = String(cmd).trim();
      if(cmd === 'STATUS'){
        after(60, () => emit(baseline === null ? 'STATUS:uncalibrated'
                                               : 'STATUS:calibrated:' + baseline.toFixed(0) + ':measured'));
        return;
      }
      const setB = cmd.match(/^SETBASELINE:(-?\d+(?:\.\d+)?)$/i);
      if(setB){
        baseline = parseFloat(setB[1]);
        after(60, () => emit('BASELINE_SET:' + baseline.toFixed(0) + ':restored'));
        return;
      }
      if(cmd === 'CALIBRATE'){
        emit('Hold still — sampling contact.');
        [600, 1200, 1800].forEach((ms, i) => after(ms, () => emit('sample ' + (i + 1) + ' of 3')));
        after(2400, () => {
          baseline = jitter(812000, 0.04);
          emit('CALIBRATION_RESULT:done:' + baseline.toFixed(0));
        });
        return;
      }
      if(cmd === 'TEST'){
        if(baseline === null){ after(60, () => emit('Not calibrated.')); return; }
        emit('Measuring contact…');
        after(1800, () => {
          const avg = jitter(baseline * 1.08, 0.06);
          const good = 6 + Math.floor(Math.random() * 4);
          const poor = 10 - good;
          const verdict = good >= 9 ? 'EXCELLENT' : good >= 7 ? 'GOOD' : 'MARGINAL';
          emit('TEST_RESULT:' + verdict + ':' + good + ',' + poor + ',0:' + avg.toFixed(0));
        });
        return;
      }
      if(cmd === 'EMG_STREAM_START'){
        if(emgTimer) return;
        let t = 0;
        // Resting noise with an occasional burst, so the trace is not a flat line.
        emgTimer = setInterval(() => {
          t += 1;
          const burst = (t % 140) < 25 ? 180 + Math.random() * 120 : 0;
          emit('EMG_LIVE:' + Math.round(330 + (Math.random() - 0.5) * 40 + burst));
        }, 20);
        return;
      }
      if(cmd === 'EMG_STREAM_STOP'){ clearInterval(emgTimer); emgTimer = null; return; }
      if(cmd === 'FLEX_STREAM_START'){
        if(flexTimer) return;
        flexTimer = setInterval(() => {
          flexPhase += 0.06;
          const pct = Math.round(45 + 42 * Math.sin(flexPhase));
          emit('FLEX_LIVE:' + pct + ',' + (520 + pct * 1.9).toFixed(1));
        }, 40);
        return;
      }
      if(cmd === 'FLEX_STREAM_STOP'){ clearInterval(flexTimer); flexTimer = null; return; }
      if(/^FLEXCAL:/i.test(cmd)){ after(80, () => emit(cmd + ':OK')); return; }
    }

    function close(){
      timers.forEach(clearTimeout); timers.clear();
      clearInterval(emgTimer); emgTimer = null;
      clearInterval(flexTimer); flexTimer = null;
    }

    link = { kind: 'simulated', send: (l) => { receive(l); return Promise.resolve(); }, close };
    setConnectedUI(true);
    // A real board announces itself on boot; so does this one.
    after(150, () => emit('CONFIG:1000000:5.00'));
    after(300, () => emit('STATUS:uncalibrated'));
  }

  async function toggleConnection(){
    if(link){ await disconnectSerial(); }
    else{ await connectSerial(); }
  }

  heroConnectBtn.addEventListener('click', connectSerial);
  panelConnectBtn.addEventListener('click', toggleConnection);

  async function sendCommand(cmd){
    if(!link){
      alert('Connect your glove first.');
      return false;
    }
    await link.send(cmd);
    return true;
  }

  // ---------------- read loop ----------------
  let lineBuffer = '';

  // Matches "CALIBRATION_RESULT:done:998046" or "CALIBRATION_RESULT:failed"
  function parseCalibrationResult(line){
    const m = line.match(/CALIBRATION_RESULT:(done|failed)(?::(-?\d+(?:\.\d+)?))?/i);
    if(!m) return null;
    return { ok: m[1].toLowerCase() === 'done', baseline: m[2] !== undefined ? parseFloat(m[2]) : null };
  }

  // Matches "TEST_RESULT:EXCELLENT:8,1,1:212345"
  function parseTestResult(line){
    const m = line.match(/TEST_RESULT:([A-Z_]+):(\d+),(\d+),(\d+):(-?\d+(?:\.\d+)?|N\/A)/i);
    if(!m) return null;
    return {
      verdict: m[1].toUpperCase(),
      good: parseInt(m[2], 10),
      poor: parseInt(m[3], 10),
      none: parseInt(m[4], 10),
      avgResistance: m[5].toUpperCase() === 'N/A' ? null : parseFloat(m[5])
    };
  }

  // Matches "EMG_LIVE:873" — a single raw ADC reading from the streaming EMG command.
  function parseEmgLive(line){
    const m = line.match(/^EMG_LIVE:(\d+)/i);
    if(!m) return null;
    return parseInt(m[1], 10);
  }

  // Matches "FLEX_LIVE:62,715" -- bend percentage first, then the raw ADC reading. The
  // percentage is -1 until the board has both ends of the range, since a percentage of an
  // unknown range is meaningless rather than merely imprecise.
  function parseFlexLive(line){
    const m = line.match(/^FLEX_LIVE:(-?\d+),([\d.]+)/i);
    if(!m) return null;
    return { percent: parseInt(m[1], 10), raw: parseFloat(m[2]) };
  }

  // "FLEX_CAL:flat=860.2", "FLEX_CAL:bent=570.4", "FLEX_CAL:done", "FLEX_CAL:failed -- ..."
  function parseFlexCal(line){
    const m = line.match(/^FLEX_CAL:(flat|bent)=([\d.]+)/i);
    if(m) return { end: m[1].toLowerCase(), raw: parseFloat(m[2]) };
    if(/^FLEX_CAL:done/i.test(line)) return { done: true };
    if(/^FLEX_CAL:failed/i.test(line)) return { failed: line.replace(/^FLEX_CAL:failed\s*--?\s*/i, '') };
    return null;
  }

  // Matches "STATUS:calibrated:4820:measured", "STATUS:calibrated:4820:restored",
  // "STATUS:uncalibrated" and "BASELINE_SET:4820:restored".
  function parseBoardBaselineLine(line){
    let m = line.match(/^STATUS:calibrated:(-?\d+(?:\.\d+)?):(measured|restored)/i);
    if(m) return { ohms: parseFloat(m[1]), source: m[2].toLowerCase() };
    if(/^STATUS:uncalibrated/i.test(line)) return { ohms: null, source: 'none' };
    m = line.match(/^BASELINE_SET:(-?\d+(?:\.\d+)?):restored/i);
    if(m) return { ohms: parseFloat(m[1]), source: 'restored' };
    if(/^BASELINE_SET:failed/i.test(line)) return { ohms: null, source: 'none' };
    return null;
  }

  function handleIncomingLine(line){
    line = line.trim();
    if(!line) return;

    // "CONFIG:1000000:5.00" — the divider the board is actually running.
    const cfg = line.match(/^CONFIG:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)/i);
    if(cfg){
      boardConfig = { fixedResistorOhms: parseFloat(cfg[1]), adcReferenceV: parseFloat(cfg[2]) };
    }

    // The board reports what baseline it is actually holding, unprompted on boot and in
    // reply to STATUS. That reply — not anything the account remembers — is what decides
    // whether the tests are usable, since the board is what does the comparing.
    const baselineReport = parseBoardBaselineLine(line);
    if(baselineReport){
      applyBoardBaseline(baselineReport);
    }

    const activeScreen = document.querySelector('.screen.active');
    const screenName = activeScreen ? activeScreen.dataset.screen : null;

    if(screenName === 'CALIBRATE'){
      appendLog('calibLog', line);
      const result = parseCalibrationResult(line);
      if(result && calibrating){
        finishCalibration(result);
      }
    } else if(screenName === 'CONTACT_TEST'){
      appendLog('testLog', line);
      const result = parseTestResult(line);
      if(result && testing){
        finishContactTest(result);
      }
    } else if(screenName === 'EMG_DEBUG'){
      const raw = parseEmgLive(line);
      if(raw !== null){
        feedEmgSample(raw);
      }
    } else if(screenName === 'FLEX'){
      const sample = parseFlexLive(line);
      if(sample) feedFlexSample(sample);
      const cal = parseFlexCal(line);
      if(cal) handleFlexCal(cal);
    }
  }

  async function startReadLoop(){
    keepReading = true;
    const textDecoder = new TextDecoderStream();
    readableClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();
    try{
      while(keepReading){
        const { value, done } = await reader.read();
        if(done) break;
        if(value){
          lineBuffer += value;
          let idx;
          while((idx = lineBuffer.indexOf('\n')) >= 0){
            const line = lineBuffer.slice(0, idx);
            lineBuffer = lineBuffer.slice(idx + 1);
            handleIncomingLine(line);
          }
        }
      }
    }catch(err){
      console.error('Serial read ended:', err);
    }finally{
      try{ reader.releaseLock(); }catch(e){}
    }
  }

  function appendLog(id, text){
    const el = document.getElementById(id);
    const row = document.createElement('div');
    const t = new Date().toLocaleTimeString('en-GB');
    row.textContent = t + '  ' + text;
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;
    while(el.children.length > 60){ el.removeChild(el.firstChild); }
  }

  // ---------------- app state machine (mirrors keyPressed) ----------------
  let appState = 'HOME';
  let calibrating = false;
  let testing = false;
  let calibrationDone = false;
  // Two separate facts the screen has to tell apart.
  //
  // boardBaseline is what the board itself is holding right now — {ohms, source}, where
  // source is 'measured' (calibrated on skin in this session) or 'restored' (recovered
  // from the board's EEPROM or pushed over from the account). The board does the actual
  // comparing, so this — and only this — is what unlocks the tests.
  //
  // savedAccountCalib is the number Firestore remembers. On its own it's just history:
  // it unlocks nothing until the board has confirmed it actually took it.
  let boardBaseline = null;
  let boardConfig = null;        // {fixedResistorOhms, adcReferenceV} as reported by CONFIG
  let savedAccountCalib = null;
  // How long CALIBRATE and TEST actually take on the board, for the progress ring only.
  // Both run the same sequence, and it grew considerably when the check moved to AC:
  //
  //   relay settling before the measurement                        ~15 ms
  //   the path check, two reads either side of a 1200 ms settle  ~2470 ms
  //   10 samples x (32-cycle AC measurement ~73 ms + 300 ms gap)  ~3730 ms
  //   printing each sample's line back at 9600 baud               ~420 ms
  //
  // The 1200 ms settles dominate and are inherited from the DC path check, which an AC
  // measurement does not actually need -- worth revisiting, and this constant should
  // follow it down when it happens.
  //
  // Rounded UP: a ring that reaches full and then waits reads as a hang, while one still
  // climbing when the result lands simply completes.
  const SAMPLE_WINDOW_MS = 6800;

  const goTestBtn = document.getElementById('goTestBtn');
  const runTestBtn = document.getElementById('runTestBtn');
  const testOptionHint = document.getElementById('testOptionHint');

  const goReactionBtn = document.getElementById('goReactionBtn');
  const goBaselineBtn = document.getElementById('goBaselineBtn');
  const reactionOptionHint = document.getElementById('reactionOptionHint');
  const baselineOptionHint = document.getElementById('baselineOptionHint');

  function setTestUnlocked(unlocked){
    calibrationDone = unlocked;
    goTestBtn.disabled = !unlocked;
    runTestBtn.disabled = !unlocked;
    goReactionBtn.disabled = !unlocked;
    goBaselineBtn.disabled = !unlocked;
    testOptionHint.textContent = unlocked
      ? 'Check current electrode placement against the baseline.'
      : 'Run a calibration first to unlock this.';
    reactionOptionHint.textContent = unlocked
      ? 'Coming next — not built yet.'
      : 'Run a calibration first to unlock this.';
    baselineOptionHint.textContent = unlocked
      ? 'Coming next — not built yet.'
      : 'Run a calibration first to unlock this.';
  }
  setTestUnlocked(false);

  const screens = document.querySelectorAll('.screen');
  function goTo(state){
    appState = state;
    screens.forEach(s => s.classList.toggle('active', s.dataset.screen === state));
    panelStateLabel.textContent = 'STATE: ' + state;
  }

  // ---------------- EMG live view (dev tool — not a roadmap test, no verdict/logging) ----------------
  //
  // Detection is built on the person's own resting signal, not a fixed universal number —
  // the same "judge against a personal baseline" idea the contact-check already uses.
  // First, hold still for 10 seconds so the natural variability of *your* resting EMG can
  // be measured. After that the Y-axis is fixed to a range built from that baseline (not
  // re-scaled every frame).
  //
  // What counts as movement is the *onset* — how fast the signal is climbing — not how
  // high it gets. Judging by height alone misses the thing we actually care about: a flex
  // that rises sharply but peaks just under some absolute line reads as nothing, while a
  // slow drift up (sweat, an electrode settling, the arm resting differently) eventually
  // crosses it and reads as movement. Rate of change separates those cleanly — a real
  // contraction has a steep leading edge, drift does not, however far it eventually goes.
  const EMG_PLOT_MAX_POINTS = 200;
  const EMG_BASELINE_DURATION_MS = 10000;
  const EMG_STREAM_EXPECTED_INTERVAL_MS = 25;  // matches EMG_STREAM_INTERVAL_MS in the firmware
  // This EMG module's envelope moves DOWN as the muscle works -- about 790 at rest and 350
  // at full effort on the bench, graded in between, and confirmed as muscle activity rather
  // than movement artifact by an isometric contraction producing the same swing while
  // pressing on an electrode produces none. Everything below is written around a signal
  // that RISES with effort, so the sample is flipped once here on the way in rather than
  // teaching onset detection, peak tracking and the plot to each handle both directions.
  //
  // Done on this side rather than in firmware deliberately: the board's job is to report
  // what it measures, and a polarity that belongs to one particular module should not be
  // baked into the measurement path -- where it also cannot be changed without reflashing.
  const EMG_SIGNAL_INVERTED = true;
  const EMG_ADC_MAX = 1023;
  const EMG_LIVE_SMOOTHING_ALPHA = 0.3;      // light smoothing for the plotted line only
  const EMG_DETECT_ALPHA = 0.6;              // faster, less-lagged signal used for the movement decision itself —
                                              // separate from the plot line, so a quick flex's peak doesn't get
                                              // blunted by the smoothing that makes the plot look nice
  const EMG_HUMP_STDDEV_MULTIPLE = 3;        // still used to size the fixed Y-axis, not to decide movement
  const EMG_MIN_STDDEV_FLOOR = 0.5;          // one ADC count is the smallest real difference; anything below that is quantisation
  // Rise measured across a short window rather than between consecutive samples: a single
  // sample-to-sample step is mostly noise, while ~150ms is about the timescale a real
  // contraction's leading edge takes to develop.
  // Longer window than the onset itself needs, because the signal is only a couple of
  // counts tall: a wider window accumulates more of the rise while quantisation noise
  // stays put, which is the only way to separate the two at this amplitude.
  const EMG_SLOPE_WINDOW_SAMPLES = 12;       // ~300ms at 25ms/sample
  const EMG_SLOPE_STDDEV_MULTIPLE = 4;       // how many resting-slope std-devs counts as a sudden change
  const EMG_MIN_SLOPE_FLOOR = 1;             // ADC counts across the window; one count is the resolution limit
  const EMG_MOVEMENT_HOLD_MS = 600;          // an onset is an instant — keep the readout lit long enough to read
  const EMG_REFRACTORY_MS = 300;             // backstop only; the excursion latch does the real work
  // An excursion ends the moment the signal turns and starts coming down — once a hump is
  // declining, the contraction that made it is already over. That is measured the same
  // way the onset is, as a rate of change judged against the person's own resting drift,
  // just in the other direction: rising past the threshold starts the event, falling past
  // it ends the event. Holding a contraction plateaus rather than declines, so a held
  // clench stays a single event and its tremor does not chop it up.
  //
  // The fraction below is a backstop for the case the slope test cannot catch: a signal
  // that sags back toward rest too gradually to ever count as declining.
  const EMG_EVENT_END_FRACTION = 0.3;        // share of the peak excursion left when the event ends
  // How tall the fixed Y-axis is. Scaling it purely to the baseline's own std-dev zooms
  // right in on a quiet signal, so ordinary resting noise fills the plot and everything
  // looks frantic. The floor keeps the view wide enough that rest reads as a flat band and
  // a real contraction is the thing that stands out.
  const EMG_AXIS_MIN_SPAN = 12;              // ADC counts — minimum height of the plotted range
  const EMG_AXIS_STDDEV_SPAN = 16;           // for a noisier baseline, size the range from its std-dev instead
  const EMG_AXIS_HEADROOM = 0.6;             // share of the range that sits above the baseline, since flexes only go up

  let emgStreamingActive = false;
  let emgPhase = 'idle';  // 'idle' | 'baseline' | 'live'
  let emgSmoothedValue = null;
  let emgDetectValue = null;
  let emgPlotPoints = [];
  let emgBaselineSamples = [];
  let emgBaselineMean = null;
  let emgBaselineStdDev = null;
  let emgDetectHistory = [];     // recent detect-smoothed values, for measuring rise across a window
  let emgBaselineSlopes = [];    // how much the signal drifts at rest — what a real onset has to beat
  let emgSlopeThreshold = null;
  let emgLastOnsetAt = 0;
  let emgMovementUntil = 0;
  let emgSampleCount = 0;        // advances the baseline's dashes, so a flat trace still reads as live
  let emgInEvent = false;        // true from an onset until the signal comes back down
  let emgEventPeak = null;       // highest point reached during the current excursion
  let emgYAxisMin = null;
  let emgYAxisMax = null;
  let emgBaselineCountdownTimer = null;
  let emgBaselineFinishTimer = null;
  let emgBaselineDeadline = null;

  // Scope palette, matching the home page's hero widget.
  const SCOPE_TRACE = '#5fbf8f';       // active signal
  const SCOPE_QUIET = '#7fa89c';       // resting signal and labels
  const SCOPE_BRIGHT = '#eaf6f1';      // readouts

  function setEmgMovementUI(moving){
    setResultIcon('emgMovementIcon', moving ? 'good' : 'muted', moving);
    const textEl = document.getElementById('emgMovementText');
    if(textEl){
      textEl.textContent = moving ? 'Movement' : 'Resting';
      textEl.style.color = moving ? SCOPE_TRACE : SCOPE_BRIGHT;
    }
  }

  function setEmgStatusText(text){
    const el = document.getElementById('emgStatusText');
    if(el) el.textContent = text;
  }

  function resetEmgPlotState(){
    if(emgBaselineCountdownTimer){ clearInterval(emgBaselineCountdownTimer); emgBaselineCountdownTimer = null; }
    if(emgBaselineFinishTimer){ clearTimeout(emgBaselineFinishTimer); emgBaselineFinishTimer = null; }
    emgPhase = 'idle';
    emgSmoothedValue = null;
    emgDetectValue = null;
    emgPlotPoints = [];
    emgBaselineSamples = [];
    emgBaselineMean = null;
    emgBaselineStdDev = null;
    emgDetectHistory = [];
    emgBaselineSlopes = [];
    emgSlopeThreshold = null;
    emgLastOnsetAt = 0;
    emgMovementUntil = 0;
    emgInEvent = false;
    emgEventPeak = null;
    const canvas = document.getElementById('emgCanvas');
    if(canvas){
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setEmgMovementUI(false);
    ['emgBaselineStat', 'emgThresholdStat'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.textContent = '—';
    });
    const phaseLabel = document.getElementById('emgPhaseLabel');
    if(phaseLabel) phaseLabel.textContent = 'BENCH TOOL';
    setEmgStatusText('Stay relaxed, then capture a baseline to start.');
    const liveValueEl = document.getElementById('emgLiveValue');
    if(liveValueEl){ liveValueEl.textContent = '—'; }
    const toggleBtn = document.getElementById('emgStreamToggleBtn');
    if(toggleBtn) toggleBtn.textContent = 'Capture baseline (10s)';
  }

  // How much the signal has climbed across the last EMG_SLOPE_WINDOW_SAMPLES. Positive
  // means rising; returns null until there's enough history to measure a full window.
  function currentEmgRise(){
    if(emgDetectHistory.length <= EMG_SLOPE_WINDOW_SAMPLES) return null;
    return emgDetectValue - emgDetectHistory[0];
  }

  function feedEmgSample(reading){
    // From here down, larger always means more effort.
    const raw = EMG_SIGNAL_INVERTED ? (EMG_ADC_MAX - reading) : reading;
    emgSmoothedValue = (emgSmoothedValue === null) ? raw : (EMG_LIVE_SMOOTHING_ALPHA * raw + (1 - EMG_LIVE_SMOOTHING_ALPHA) * emgSmoothedValue);
    emgDetectValue = (emgDetectValue === null) ? raw : (EMG_DETECT_ALPHA * raw + (1 - EMG_DETECT_ALPHA) * emgDetectValue);

    emgDetectHistory.push(emgDetectValue);
    if(emgDetectHistory.length > EMG_SLOPE_WINDOW_SAMPLES + 1){ emgDetectHistory.shift(); }
    const rise = currentEmgRise();

    const liveValueEl = document.getElementById('emgLiveValue');

    if(emgPhase === 'baseline'){
      emgBaselineSamples.push(raw);
      // Resting rise is the yardstick: whatever the signal does on its own while you hold
      // still is what a deliberate movement has to clearly out-climb.
      if(rise !== null){ emgBaselineSlopes.push(rise); }
      emgPlotPoints.push({ raw, smoothed: emgSmoothedValue, onset: false, inEvent: false });
      if(emgPlotPoints.length > EMG_PLOT_MAX_POINTS){ emgPlotPoints.shift(); }
      if(liveValueEl){ liveValueEl.textContent = raw; }
      drawEmgCanvas();
      return;
    }

    if(emgPhase !== 'live') return;

    const now = Date.now();
    let onset = false;
    if(!emgInEvent && rise !== null && emgSlopeThreshold !== null
       && rise > emgSlopeThreshold
       && (now - emgLastOnsetAt) > EMG_REFRACTORY_MS){
      onset = true;
      emgInEvent = true;
      emgEventPeak = emgDetectValue;
      emgLastOnsetAt = now;
      emgMovementUntil = now + EMG_MOVEMENT_HOLD_MS;
    }

    if(emgInEvent){
      if(emgDetectValue > emgEventPeak) emgEventPeak = emgDetectValue;
      const declining = (rise !== null && emgSlopeThreshold !== null && rise < -emgSlopeThreshold);
      const returnLevel = emgBaselineMean + (EMG_EVENT_END_FRACTION * (emgEventPeak - emgBaselineMean));
      if(declining || emgDetectValue <= returnLevel) emgInEvent = false;
    }

    emgSampleCount++;
    emgPlotPoints.push({ raw, smoothed: emgSmoothedValue, onset, inEvent: emgInEvent });
    if(emgPlotPoints.length > EMG_PLOT_MAX_POINTS){ emgPlotPoints.shift(); }

    setEmgMovementUI(emgInEvent || now < emgMovementUntil);
    if(liveValueEl){ liveValueEl.textContent = raw; }

    drawEmgCanvas();
  }

  // Runs the 10-second hold-still window, then computes this person's resting mean and
  // standard deviation and switches into live detection against that personal baseline.
  function startBaselineCapture(){
    emgPhase = 'baseline';
    emgBaselineSamples = [];
    emgBaselineSlopes = [];
    emgDetectHistory = [];
    emgSlopeThreshold = null;
    emgPlotPoints = [];
    emgSmoothedValue = null;
    emgDetectValue = null;
    emgBaselineDeadline = Date.now() + EMG_BASELINE_DURATION_MS;
    setEmgStatusText('Stay relaxed — capturing baseline… ' + Math.ceil(EMG_BASELINE_DURATION_MS / 1000) + 's');

    emgBaselineCountdownTimer = setInterval(() => {
      const remainingMs = emgBaselineDeadline - Date.now();
      const remainingS = Math.max(0, Math.ceil(remainingMs / 1000));
      setEmgStatusText('Stay relaxed — capturing baseline… ' + remainingS + 's');
    }, 250);

    emgBaselineFinishTimer = setTimeout(finishBaselineCapture, EMG_BASELINE_DURATION_MS);
  }

  function finishBaselineCapture(){
    if(emgBaselineCountdownTimer){ clearInterval(emgBaselineCountdownTimer); emgBaselineCountdownTimer = null; }

    // Guards against a stream that dropped out mid-capture — same spirit as
    // CALIB_MIN_VALID_SAMPLES on the Arduino side: don't quietly build a baseline out of
    // far fewer samples than a real 10-second capture should contain.
    const expectedSamples = EMG_BASELINE_DURATION_MS / EMG_STREAM_EXPECTED_INTERVAL_MS;
    if(emgBaselineSamples.length < expectedSamples * 0.5){
      setEmgStatusText('Baseline capture interrupted — check the connection and try again.');
      stopEmgStreamIfActive();
      return;
    }

    const n = emgBaselineSamples.length;
    const mean = emgBaselineSamples.reduce((sum, v) => sum + v, 0) / n;
    const variance = emgBaselineSamples.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / n;
    const stdDev = Math.max(Math.sqrt(variance), EMG_MIN_STDDEV_FLOOR);

    emgBaselineMean = mean;
    emgBaselineStdDev = stdDev;

    // The movement test itself: how steeply the signal climbs, measured against how
    // steeply it drifts while you're holding still. The floor keeps an unusually quiet
    // capture from setting a threshold so low that ordinary noise trips it.
    let slopeThreshold = EMG_MIN_SLOPE_FLOOR;
    if(emgBaselineSlopes.length > 0){
      const sn = emgBaselineSlopes.length;
      const slopeMean = emgBaselineSlopes.reduce((sum, v) => sum + v, 0) / sn;
      const slopeVar = emgBaselineSlopes.reduce((sum, v) => sum + (v - slopeMean) * (v - slopeMean), 0) / sn;
      slopeThreshold = Math.max(slopeMean + (EMG_SLOPE_STDDEV_MULTIPLE * Math.sqrt(slopeVar)), EMG_MIN_SLOPE_FLOOR);
    }
    emgSlopeThreshold = slopeThreshold;
    // Fixed once, from the baseline — not re-scaled every frame — so a hump is visually
    // obvious against a steady reference rather than the axis chasing the signal around.
    const axisSpan = Math.max(EMG_AXIS_MIN_SPAN, EMG_AXIS_STDDEV_SPAN * stdDev);
    emgYAxisMin = Math.max(0, mean - (axisSpan * (1 - EMG_AXIS_HEADROOM)));
    emgYAxisMax = Math.min(1023, mean + (axisSpan * EMG_AXIS_HEADROOM));

    // Prefill the plot at the resting level so the trace spans the full width from the
    // first live sample onward. Starting from an empty buffer drew a partial line that
    // grew in from the left and left the panel looking unfinished for the first few
    // seconds, and again briefly after every restart.
    emgPlotPoints = [];
    for(let i = 0; i < EMG_PLOT_MAX_POINTS; i++){
      emgPlotPoints.push({ raw: mean, smoothed: mean, onset: false, inEvent: false });
    }
    emgSmoothedValue = mean;
    emgDetectValue = mean;
    emgDetectHistory = [];
    emgLastOnsetAt = 0;
    emgMovementUntil = 0;
    emgInEvent = false;
    emgEventPeak = null;
    emgPhase = 'live';
    const baseStat = document.getElementById('emgBaselineStat');
    if(baseStat) baseStat.textContent = Math.round(mean) + ' ± ' + Math.round(stdDev);
    const thrStat = document.getElementById('emgThresholdStat');
    if(thrStat) thrStat.textContent = '+' + (Math.round(slopeThreshold * 10) / 10) + ' / ' +
      Math.round(EMG_SLOPE_WINDOW_SAMPLES * EMG_STREAM_EXPECTED_INTERVAL_MS) + 'ms';
    const phaseLabel = document.getElementById('emgPhaseLabel');
    if(phaseLabel) phaseLabel.textContent = 'WATCHING';

    setEmgStatusText('Baseline: ' + Math.round(mean) + ' ± ' + Math.round(stdDev) +
      ' — watching for a rise of ' + (Math.round(slopeThreshold * 10) / 10) + '+ per ' +
      Math.round(EMG_SLOPE_WINDOW_SAMPLES * EMG_STREAM_EXPECTED_INTERVAL_MS) + 'ms.');
    const toggleBtn = document.getElementById('emgStreamToggleBtn');
    if(toggleBtn) toggleBtn.textContent = 'Stop';
  }

  function drawEmgCanvas(){
    const canvas = document.getElementById('emgCanvas');
    if(!canvas || emgPlotPoints.length === 0) return;
    // The canvas element was a fixed 600x150 backing store stretched to whatever width
    // the panel happens to be, so every line on it was resampled and came out soft. Size
    // the backing store to the element's real size times the display's pixel ratio, and
    // scale the context to match, so a pixel drawn is a pixel shown.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const backingW = Math.round(w * dpr), backingH = Math.round(h * dpr);
    if(canvas.width !== backingW || canvas.height !== backingH){
      canvas.width = backingW;
      canvas.height = backingH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // reset each frame; resizing clears it
    ctx.clearRect(0, 0, w, h);

    let minV, maxV;
    if(emgPhase === 'live' && emgYAxisMin !== null && emgYAxisMax !== null){
      // The fixed range is derived from resting standard deviation, which is deliberately
      // tight so small movements are legible. A real contraction is far larger than any
      // resting wobble -- hundreds of counts against a few -- so it would simply run off
      // the top of that scale and flatten against the edge, hiding exactly the part worth
      // seeing. The baseline range is therefore a MINIMUM rather than the whole story:
      // it still sets how sensitive the chart is at rest, and the axis opens up only as
      // far as the visible data actually needs.
      minV = emgYAxisMin;
      maxV = emgYAxisMax;
      let dataMin = Infinity, dataMax = -Infinity;
      emgPlotPoints.forEach(p => { dataMin = Math.min(dataMin, p.raw); dataMax = Math.max(dataMax, p.raw); });
      if(dataMax > dataMin){
        // A little padding so a peak sits below the edge rather than touching it.
        const pad = (dataMax - dataMin) * 0.08;
        minV = Math.max(0, Math.min(minV, dataMin - pad));
        maxV = Math.min(1023, Math.max(maxV, dataMax + pad));
      }
    } else {
      // Still finding the baseline — auto-scale just enough to show the capture is alive;
      // the real fixed range only exists once the baseline itself exists.
      minV = Infinity; maxV = -Infinity;
      emgPlotPoints.forEach(p => { minV = Math.min(minV, p.raw); maxV = Math.max(maxV, p.raw); });
      if(maxV - minV < 10){ maxV += 5; minV -= 5; }
    }
    const toY = v => h - ((v - minV) / (maxV - minV)) * h;
    const toX = i => 1 + (i / (EMG_PLOT_MAX_POINTS - 1)) * (w - 2);



    const drawLine = (key, color, lineWidth) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      emgPlotPoints.forEach((p, i) => {
        const x = toX(i), y = toY(p[key]);
        if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    // Canvas needs a resolved color, not CSS variable syntax — pull the site's actual
    // "good" color from the stylesheet so this matches the rest of the theme automatically.
    const accentColor = SCOPE_TRACE;
    const restColor = SCOPE_QUIET;
    drawLine('raw', 'rgba(255,255,255,0.30)', 1);  // raw signal — its jitter is the other cue that this is live

    // The smoothed trace is drawn in runs rather than one path, so the stretch the board
    // judged to be a contraction is green and everything else is neutral. Colouring the
    // span says more than a marker at the onset did — it shows how long the contraction
    // lasted, not just when it began — and it annotates the plot without adding anything
    // on top of it to crowd the view.
    if(emgPlotPoints.length >= 2){
      let runStart = 0;
      for(let i = 1; i <= emgPlotPoints.length; i++){
        const atEnd = (i === emgPlotPoints.length);
        const changed = !atEnd && (!!emgPlotPoints[i].inEvent !== !!emgPlotPoints[runStart].inEvent);
        if(!atEnd && !changed) continue;

        ctx.beginPath();
        ctx.strokeStyle = emgPlotPoints[runStart].inEvent ? accentColor : restColor;
        ctx.lineWidth = 2;
        // Start one sample early so consecutive runs join up instead of leaving gaps.
        const from = Math.max(0, runStart - 1);
        for(let j = from; j < i; j++){
          const x = toX(j), y = toY(emgPlotPoints[j].smoothed);
          if(j === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        runStart = i;
      }
    }

    // Drawn last, on top of the trace. Underneath it was invisible exactly when it
    // mattered most — at rest, where the trace sits on the baseline and hid it.
    //
    // Its dashes travel with the data, at the same pixels-per-sample the trace scrolls
    // at, which gives back the motion the scrolling grid was there for. A steady signal
    // no longer looks like a frozen one, and unlike the grid this cannot fall out of
    // alignment with anything — it is one line the canvas already owns.
    if(emgPhase === 'live' && emgBaselineMean !== null){
      // The gap is deliberately three times the dash. A sample advances the pattern by
      // w/199 pixels — near 4 — so an 8px period would step half a period per frame and
      // read as flicker rather than travel, the same aliasing that makes wagon wheels
      // appear to spin backwards. A 16px period puts each step at about a quarter, which
      // reads as motion in an unambiguous direction.
      const DASH = 4, GAP = 12;
      const pxPerSample = w / (EMG_PLOT_MAX_POINTS - 1);
      ctx.beginPath();
      ctx.setLineDash([DASH, GAP]);
      ctx.lineDashOffset = (emgSampleCount * pxPerSample) % (DASH + GAP);
      ctx.strokeStyle = 'rgba(234,246,241,0.55)';
      ctx.lineWidth = 1;
      const baselineY = toY(emgBaselineMean);
      ctx.moveTo(0, baselineY);
      ctx.lineTo(w, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }


  }

  function setVerdict(text, kind, summary){
    const el = document.getElementById('verdictText');
    const changed = el.textContent !== text;
    el.textContent = text;
    // Only when it actually changed. Re-rendering the same verdict should not make
    // the panel twitch.
    if(changed && window.Neurova.replayLanding) window.Neurova.replayLanding(el);
    el.style.setProperty('--accent', kind === 'good' ? 'var(--good)' : kind === 'warn' ? 'var(--warn)' : kind === 'bad' ? 'var(--bad)' : 'var(--muted)');
    document.getElementById('summaryText').textContent = summary || '';
  }

  function setCalibStatus(text, kind, summary){
    const el = document.getElementById('calibStatusText');
    const changed = el.textContent !== text;
    el.textContent = text;
    if(changed && window.Neurova.replayLanding) window.Neurova.replayLanding(el);
    el.style.setProperty('--accent', kind === 'good' ? 'var(--good)' : kind === 'warn' ? 'var(--warn)' : 'var(--muted)');
    document.getElementById('calibSummaryText').textContent = summary || '';
  }

  // ---------------- calibration ring ----------------
  const RING_CIRC = 327; // 2 * PI * 52
  function setCalibProgress(fraction){
    const el = document.getElementById('calibRingProgress');
    el.style.strokeDashoffset = String(RING_CIRC - Math.min(1, Math.max(0, fraction)) * RING_CIRC);
  }
  function setCalibLiveValue(value){
    document.getElementById('calibLiveValue').textContent = Math.round(value * 100) / 100;
  }

  // ---------------- shared result icon ----------------
  function setResultIcon(elId, kind, pulsing){
    const el = document.getElementById(elId);
    if(!el) return;   // some layouts show state as text alone, with no icon
    el.classList.toggle('pulsing', !!pulsing);
    const colors = {
      good: 'rgba(63,143,95,0.85)',
      warn: 'rgba(217,138,61,0.85)',
      bad: 'rgba(194,75,62,0.85)',
      muted: 'rgba(255,255,255,0.08)'
    };
    const symbols = { good: '✓', warn: '!', bad: '✕', muted: pulsing ? '…' : '—' };
    el.style.background = colors[kind] || colors.muted;
    el.textContent = symbols[kind] || symbols.muted;
  }

  // ---------------- contact-test quality meter ----------------
  // Order matters — must match the segments' data-level attributes left to right.
  const QUALITY_LEVELS = ['NO_CONTACT', 'POOR', 'MARGINAL', 'GOOD', 'EXCELLENT'];
  const LEVEL_KIND = { NO_CONTACT: 'bad', POOR: 'bad', MARGINAL: 'warn', GOOD: 'good', EXCELLENT: 'good' };

  function setQualityMeter(verdict){
    document.querySelectorAll('.quality-seg').forEach(seg => {
      seg.classList.toggle('active', seg.dataset.level === verdict);
    });
  }

  function renderStatPills(good, poor, none, avgResistance){
    const pills = document.getElementById('statPills');
    let html = '';
    html += '<span class="stat-pill"><span class="dot good"></span>Good <b>' + good + '</b></span>';
    html += '<span class="stat-pill"><span class="dot warn"></span>Poor <b>' + poor + '</b></span>';
    html += '<span class="stat-pill"><span class="dot bad"></span>None <b>' + none + '</b></span>';
    if(avgResistance !== null){
      html += '<span class="stat-pill">Avg <b>' + (Math.round(avgResistance*100)/100) + ' Ω</b></span>';
    }
    pills.innerHTML = html;
  }
  enterMenuBtn.addEventListener('click', () => goTo('MENU'));
  document.getElementById('goCalibrateBtn').addEventListener('click', () => {
    goTo('CALIBRATE');
    renderCalibScreen();
  });
  goTestBtn.addEventListener('click', () => {
    if(goTestBtn.disabled) return;
    goTo('CONTACT_TEST');
    setVerdict('Idle', 'muted', 'Run the test to sample this placement.');
    setResultIcon('testIcon', 'muted', false);
    setQualityMeter(null);
    document.getElementById('statPills').innerHTML = '';
  });
  document.getElementById('menuBackBtn').addEventListener('click', () => goTo('HOME'));
  document.getElementById('calibBackBtn').addEventListener('click', () => goTo('MENU'));
  document.getElementById('testBackBtn').addEventListener('click', () => goTo('MENU'));
  goReactionBtn.addEventListener('click', () => {
    if(goReactionBtn.disabled) return;
    goTo('REACTION_TIME');
  });
  document.getElementById('reactionBackBtn').addEventListener('click', () => goTo('MENU'));
  goBaselineBtn.addEventListener('click', () => {
    if(goBaselineBtn.disabled) return;
    goTo('BASELINE_RECORDING');
  });
  document.getElementById('baselineBackBtn').addEventListener('click', () => goTo('MENU'));

  // EMG live view is a dev tool, not a roadmap test — always enabled, no calibration gate.
  function stopEmgStreamIfActive(){
    if(emgBaselineCountdownTimer){ clearInterval(emgBaselineCountdownTimer); emgBaselineCountdownTimer = null; }
    if(emgBaselineFinishTimer){ clearTimeout(emgBaselineFinishTimer); emgBaselineFinishTimer = null; }
    if(!emgStreamingActive){ emgPhase = 'idle'; return; }
    sendCommand('EMG_STREAM_STOP');
    emgStreamingActive = false;
    emgPhase = 'idle';
    const toggleBtn = document.getElementById('emgStreamToggleBtn');
    if(toggleBtn) toggleBtn.textContent = 'Capture baseline (10s)';
    setEmgStatusText('Stay relaxed, then capture a baseline to start.');
  }


  // ---------------- flex sensor view ----------------
  //
  // Deliberately simpler than the EMG view. EMG needs onset detection because the
  // interesting event is a sudden change buried in a noisy signal. Bend angle is neither
  // noisy nor ambiguous: the number IS the answer, so the job here is calibration and an
  // honest plot rather than inference.
  const FLEX_PLOT_MAX_POINTS = 240;
  let flexPoints = [];
  let flexStreaming = false;
  let flexFlatRaw = null, flexBentRaw = null;

  function setFlexText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function feedFlexSample(sample){
    flexPoints.push(sample);
    if(flexPoints.length > FLEX_PLOT_MAX_POINTS) flexPoints.shift();
    setFlexText('flexRawStat', Math.round(sample.raw));
    // -1 is the board saying it has no range to measure against, which is a different
    // thing from 0% and should not be displayed as one.
    setFlexText('flexPercentStat', sample.percent < 0 ? '—' : sample.percent + '%');
    drawFlexCanvas();
  }

  function handleFlexCal(cal){
    if(cal.end === 'flat'){
      flexFlatRaw = cal.raw;
      setFlexText('flexFlatStat', Math.round(cal.raw));
      setFlexText('flexStatusText', 'Open hand captured. Now make a full fist and capture that.');
    } else if(cal.end === 'bent'){
      flexBentRaw = cal.raw;
      setFlexText('flexBentStat', Math.round(cal.raw));
    } else if(cal.done){
      setFlexText('flexPhaseLabel', 'CALIBRATED');
      setFlexText('flexStatusText', 'Calibrated. Start the live view to watch the bend angle.');
    } else if(cal.failed){
      setFlexText('flexPhaseLabel', 'UNCALIBRATED');
      setFlexText('flexStatusText', cal.failed);
    }
  }

  function drawFlexCanvas(){
    const canvas = document.getElementById('flexCanvas');
    if(!canvas || flexPoints.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if(canvas.width !== bw || canvas.height !== bh){ canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Fixed 0-100% axis once calibrated. The whole point of calibrating is that the scale
    // stops moving, so an auto-scaling plot would throw that away -- a 5% wobble would
    // fill the canvas and look like a full fist.
    const calibrated = flexPoints.some(p => p.percent >= 0);
    const lo = calibrated ? -10 : 0;
    const hi = calibrated ? 110 : 1023;
    const value = p => calibrated ? p.percent : p.raw;
    const toY = v => h - ((v - lo) / (hi - lo)) * h;
    const toX = i => 1 + (i / (FLEX_PLOT_MAX_POINTS - 1)) * (w - 2);

    if(calibrated){
      ctx.strokeStyle = 'rgba(47,110,99,0.18)';
      ctx.lineWidth = 1;
      [0, 50, 100].forEach(pct => {
        const y = Math.round(toY(pct)) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      });
    }

    ctx.beginPath();
    ctx.strokeStyle = '#2f6e63';
    ctx.lineWidth = 2;
    flexPoints.forEach((p, i) => {
      const x = toX(i), y = toY(value(p));
      if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function wireFlexScreen(){
    const flatBtn = document.getElementById('flexCalFlatBtn');
    const bentBtn = document.getElementById('flexCalBentBtn');
    const toggleBtn = document.getElementById('flexStreamToggleBtn');
    const backBtn = document.getElementById('flexBackBtn');
    const goBtn = document.getElementById('goFlexBtn');
    if(!flatBtn || !goBtn) return;

    goBtn.addEventListener('click', () => {
      flexPoints = [];
      goTo('FLEX');
    });

    flatBtn.addEventListener('click', async () => {
      setFlexText('flexStatusText', 'Hold your hand open and still…');
      await sendCommand('FLEXCAL:FLAT');
    });
    bentBtn.addEventListener('click', async () => {
      setFlexText('flexStatusText', 'Hold a full fist and still…');
      await sendCommand('FLEXCAL:BENT');
    });

    toggleBtn.addEventListener('click', async () => {
      if(flexStreaming){
        await sendCommand('FLEX_STREAM_STOP');
        flexStreaming = false;
        toggleBtn.textContent = 'Start live view';
      } else {
        flexPoints = [];
        const sent = await sendCommand('FLEX_STREAM_START');
        if(!sent) return;
        flexStreaming = true;
        toggleBtn.textContent = 'Stop live view';
      }
    });

    // Leaving the screen with the board still streaming would keep it talking into a view
    // nobody is watching, and the EMG screen has the same hazard.
    backBtn.addEventListener('click', async () => {
      if(flexStreaming){
        await sendCommand('FLEX_STREAM_STOP');
        flexStreaming = false;
        toggleBtn.textContent = 'Start live view';
      }
      goTo('MENU');
    });
  }
  wireFlexScreen();

  document.getElementById('goEmgDebugBtn').addEventListener('click', () => {
    resetEmgPlotState();
    goTo('EMG_DEBUG');
  });
  document.getElementById('emgDebugBackBtn').addEventListener('click', () => {
    stopEmgStreamIfActive();
    goTo('MENU');
  });
  document.getElementById('emgStreamToggleBtn').addEventListener('click', async () => {
    if(emgPhase === 'idle'){
      resetEmgPlotState();
      const sent = await sendCommand('EMG_STREAM_START');
      if(!sent) return;
      emgStreamingActive = true;
      const toggleBtn = document.getElementById('emgStreamToggleBtn');
      if(toggleBtn) toggleBtn.textContent = 'Cancel';
      startBaselineCapture();
    } else {
      stopEmgStreamIfActive();
    }
  });

  // How long to wait for the board to actually respond before giving up —
  // this is a "something's wrong" timeout, separate from normal completion.
  const RESPONSE_TIMEOUT_MS = 8000;

  let calibTimeoutId = null;
  let testTimeoutId = null;
  let calibProgressTimer = null;

  function renderCalibAuthNote(){
    const el = document.getElementById('calibAuthNote');
    if(!el) return;
    const user = window.Neurova.getUser ? window.Neurova.getUser() : null;
    const loadFailed = window.Neurova.calibLoadFailed ? window.Neurova.calibLoadFailed() : false;
    if(user && loadFailed){
      el.innerHTML = `<div class="calib-auth-note">Couldn't reach your saved baseline — check your connection. <a href="#" id="calibRetryLink">Try again</a>, or just run a new calibration below.</div>`;
      const retry = document.getElementById('calibRetryLink');
      if(retry) retry.addEventListener('click', (e) => {
        e.preventDefault();
        el.innerHTML = `<div class="calib-auth-note">Checking your account for a saved baseline…</div>`;
        if(window.Neurova.retryLoadCalibration) window.Neurova.retryLoadCalibration();
      });
    } else if(user && user.isAnonymous){
      // A guest's baseline does save -- an anonymous account is a real account as far as
      // the database is concerned -- so the warning is not "this will be lost now" but
      // "this is tied to a browser, and browsers get cleared".
      el.innerHTML = `<div class="calib-auth-note">Calibrating as a guest — this baseline saves, but only in this browser. <a href="#account" data-nav="account" id="calibAuthNoteLink">Create an account to keep it</a>.</div>`;
      const gl = document.getElementById('calibAuthNoteLink');
      if(gl) gl.addEventListener('click', (e) => {
        e.preventDefault();
        if(window.Neurova.goToPage) window.Neurova.goToPage('account');
      });
    } else if(user){
      el.innerHTML = '';
    } else {
      // Unreachable in normal use now that the route gate requires an identity, but left
      // in place: it is the correct thing to say if the gate is ever relaxed, and an
      // empty note would be the wrong failure.
      el.innerHTML = `<div class="calib-auth-note">Not signed in — the board will remember this baseline, but only this board will. <a href="#account" data-nav="account" id="calibAuthNoteLink">Log in to save it to your account</a>.</div>`;
      const link = document.getElementById('calibAuthNoteLink');
      if(link) link.addEventListener('click', (e) => {
        e.preventDefault();
        const navLink = document.querySelector('.topnav a[data-nav="account"], .mobile-nav-panel a[data-nav="account"]');
        if(navLink) navLink.click();
      });
    }
  }
  renderCalibAuthNote();
  window.Neurova.onAccountChange = function(){ renderCalibAuthNote(); };

  // A saved baseline is history until the board confirms it has taken it. Once the board
  // is connected we offer it over (SETBASELINE), and the board's own reply is what
  // decides whether the tests open up.
  window.Neurova.applySavedCalibration = function(data){
    if(!data || typeof data.calibrationBaseline !== 'number') return;
    savedAccountCalib = data;
    maybePushSavedBaseline();
    if(boardBaseline) return; // whatever the board already holds wins
    renderCalibScreen();
  };

  function savedAccountDateText(){
    const stamp = savedAccountCalib && savedAccountCalib.calibrationSavedAt;
    if(stamp && typeof stamp.toDate === 'function'){
      try{ return ' (saved ' + stamp.toDate().toLocaleDateString() + ')'; }catch(e){ /* fall through */ }
    }
    return '';
  }

  // Records what the board says it's holding and opens or closes the tests to match, so
  // the lock state always tracks the board rather than the account.
  function applyBoardBaseline(report){
    if(report.source === 'none'){
      boardBaseline = null;
      setTestUnlocked(false);
      maybePushSavedBaseline();
      renderCalibScreen();
      return;
    }
    boardBaseline = { ohms: report.ohms, source: report.source };
    // The board announces its stored baseline on boot, so the hero panel has a real
    // number to show the moment it connects instead of sitting on a dash.
    setHeroReading(report.ohms, 'Stored baseline');
    setTestUnlocked(true);
    renderCalibScreen();
  }

  // Hands the account's remembered baseline to the board, but only when the board is
  // connected and doesn't already have one of its own.
  function maybePushSavedBaseline(){
    if(!link) return;
    if(boardBaseline) return;
    if(!savedAccountCalib || typeof savedAccountCalib.calibrationBaseline !== 'number') return;
    sendCommand('SETBASELINE:' + savedAccountCalib.calibrationBaseline).catch(()=>{});
  }

  // Draws the calibration screen from whatever is actually true right now, so opening the
  // screen can never contradict the lock state of the tests: a baseline measured on skin
  // this session reads green, one restored from the board or the account reads amber and
  // says so, an account number the board hasn't taken yet is muted history, and anything
  // else is a clean Idle.
  function renderCalibScreen(){
    if(boardBaseline && boardBaseline.source === 'measured'){
      setCalibProgress(1);
      setCalibLiveValue(boardBaseline.ohms);
      setResultIcon('calibIcon', 'good', false);
      setCalibStatus('Calibrated', 'good',
        'Baseline: ' + (Math.round(boardBaseline.ohms * 100) / 100) + ' Ω — measured on your skin in this session.');
      return;
    }

    if(boardBaseline && boardBaseline.source === 'restored'){
      setCalibProgress(1);
      setCalibLiveValue(boardBaseline.ohms);
      setResultIcon('calibIcon', 'warn', false);
      setCalibStatus('Baseline restored', 'warn',
        (Math.round(boardBaseline.ohms * 100) / 100) + ' Ω' + savedAccountDateText() +
        ' — reused from your last calibration, not measured today. Skin changes with hydration, temperature and exactly where the electrodes sit, so recalibrate if a verdict looks off.');
      return;
    }

    setCalibProgress(0);
    setResultIcon('calibIcon', 'muted', false);

    if(savedAccountCalib && typeof savedAccountCalib.calibrationBaseline === 'number'){
      setCalibLiveValue(savedAccountCalib.calibrationBaseline);
      setCalibStatus('Last saved baseline', 'muted',
        (Math.round(savedAccountCalib.calibrationBaseline * 100) / 100) + ' Ω from your account' + savedAccountDateText() +
        ' — connect the board and it will pick this up automatically, or run a fresh calibration below.');
      return;
    }

    document.getElementById('calibLiveValue').textContent = '—';
    setCalibStatus('Idle', 'muted', 'Run calibration to capture a baseline.');
  }

  // Wipes the calibration screen back to a clean, un-calibrated state — used whenever
  // the signed-in account changes (login, logout, or switching accounts), so a previous
  // account's baseline can never linger on screen or leave the contact test unlocked
  // for someone it doesn't belong to.
  //
  // preserveMeasuredBaseline is true for exactly one transition: no account was signed in,
  // and a specific account is now appearing for the first time in this sitting (calibrate
  // as a guest, then sign up). That's the only case where "this is a physical fact about
  // whoever's wearing the glove right now" safely holds. Any other transition — a
  // different account taking over, or simply signing out — can't safely assume that, so
  // it's treated exactly like a restored baseline and cleared. Without this distinction,
  // a measured baseline from one account could otherwise silently carry into the next
  // account that logs in on the same physical board.
  window.Neurova.resetCalibration = function(preserveMeasuredBaseline){
    savedAccountCalib = null;
    const shouldClearMeasured = !preserveMeasuredBaseline;
    if(boardBaseline && (boardBaseline.source === 'restored' || (boardBaseline.source === 'measured' && shouldClearMeasured))){
      boardBaseline = null;
      setTestUnlocked(false);
    }
    renderCalibScreen();
  };

  // Attaches the board's own circuit constants to every record. A resistance is only
  // comparable against another taken through the same divider, so storing the divider
  // alongside the number is what keeps a resistor swap from silently corrupting a trend.
  function logSessionIfPossible(session){
    if(!window.Neurova.logSession) return;
    if(!window.Neurova.getUser || !window.Neurova.getUser()) return;
    if(boardConfig){
      session.fixedResistorOhms = boardConfig.fixedResistorOhms;
      session.adcReferenceV = boardConfig.adcReferenceV;
    }
    window.Neurova.logSession(session).catch(() => {});
  }

  function finishCalibration(result){
    clearTimeout(calibTimeoutId);
    clearInterval(calibProgressTimer);
    setCalibProgress(1);
    calibrating = false;

    if(result.ok && result.baseline !== null){
      boardBaseline = { ohms: result.baseline, source: 'measured' };
      logSessionIfPossible({
        type: 'calibration',
        baselineOhms: result.baseline
      });
      setCalibLiveValue(result.baseline);
      setHeroReading(result.baseline, 'Baseline');
      setResultIcon('calibIcon', 'good', false);
      setTestUnlocked(true);
      const baselineText = 'Baseline: ' + (Math.round(result.baseline * 100) / 100) + ' Ω — ';
      if(window.Neurova.saveCalibration && window.Neurova.getUser && window.Neurova.getUser()){
        setCalibStatus('Calibrated', 'good', baselineText + 'saving to your account…');
        window.Neurova.saveCalibration(result.baseline).then(saved => {
          setCalibStatus('Calibrated', 'good', baselineText + (saved ? 'saved to your account.' : 'ready for the contact test.'));
        });
      } else {
        setCalibStatus('Calibrated', 'good', baselineText + 'ready for the contact test.');
      }
    }else{
      setResultIcon('calibIcon', 'bad', false);
      setCalibStatus('Calibration failed', 'warn', 'The board couldn\'t get enough valid readings — check electrode contact and try again.');
    }
  }

  function finishContactTest(result){
    clearTimeout(testTimeoutId);
    testing = false;

    // The newest measurement wins the panel. A test with no usable samples leaves
    // avgResistance null, and setHeroReading falls back to a dash rather than a zero.
    if(result.avgResistance !== null && result.avgResistance !== undefined){
      setHeroReading(result.avgResistance, 'Last contact test');
    }

    logSessionIfPossible({
      type: 'contact',
      verdict: result.verdict,
      goodCount: result.good,
      poorCount: result.poor,
      noneCount: result.none,
      avgResistanceOhms: (result.avgResistance === null ? null : result.avgResistance),
      baselineOhms: boardBaseline ? boardBaseline.ohms : null,
      baselineSource: boardBaseline ? boardBaseline.source : null
    });

    const kind = LEVEL_KIND[result.verdict] || 'muted';
    const label = result.verdict.replace(/_/g, ' ').toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());

    setQualityMeter(result.verdict);
    setResultIcon('testIcon', kind, false);
    renderStatPills(result.good, result.poor, result.none, result.avgResistance);
    setVerdict(label, kind, 'Averaged over ' + (result.good + result.poor + result.none) + ' samples.');
  }

  document.getElementById('runCalibrateBtn').addEventListener('click', async () => {
    if(appState !== 'CALIBRATE' || calibrating) return;
    const sent = await sendCommand('CALIBRATE');
    if(!sent) return;

    calibrating = true;
    setCalibStatus('Calibrating…', 'warn', 'Hold your best, firmest contact steady.');
    setResultIcon('calibIcon', 'muted', true);
    appendLog('calibLog', '> CALIBRATE');

    const start = Date.now();
    const expectedDuration = SAMPLE_WINDOW_MS;
    calibProgressTimer = setInterval(() => {
      setCalibProgress((Date.now() - start) / expectedDuration);
    }, 60);

    calibTimeoutId = setTimeout(() => {
      clearInterval(calibProgressTimer);
      setCalibProgress(1);
      calibrating = false;
      setResultIcon('calibIcon', 'bad', false);
      setCalibStatus('No response from board', 'warn', 'Didn\'t hear back from the board — check the connection and try again.');
    }, RESPONSE_TIMEOUT_MS);
  });

  document.getElementById('runTestBtn').addEventListener('click', async () => {
    if(appState !== 'CONTACT_TEST' || testing || !calibrationDone) return;
    const sent = await sendCommand('TEST');
    if(!sent) return;

    testing = true;
    setVerdict('Sampling…', 'warn', '');
    setResultIcon('testIcon', 'muted', true);
    setQualityMeter(null);
    document.getElementById('statPills').innerHTML = '';
    appendLog('testLog', '> TEST');

    testTimeoutId = setTimeout(() => {
      testing = false;
      setResultIcon('testIcon', 'bad', false);
      setVerdict('No response from board', 'warn', 'Didn\'t hear back from the board — check the connection and try again.');
    }, RESPONSE_TIMEOUT_MS);
  });

  // keyboard parity with the sketch: Esc = back, Space = run
  document.addEventListener('keydown', (e) => {
    const panelInView = document.getElementById('page-test-menu').classList.contains('page-active');
    if(!panelInView) return;

    if(e.key === 'Escape'){
      if(appState === 'MENU') goTo('HOME');
      else if(appState === 'CALIBRATE' || appState === 'CONTACT_TEST' || appState === 'REACTION_TIME' || appState === 'BASELINE_RECORDING') goTo('MENU');
      else if(appState === 'EMG_DEBUG'){ stopEmgStreamIfActive(); goTo('MENU'); }
    } else if(e.code === 'Space'){
      if(appState === 'CALIBRATE' || appState === 'CONTACT_TEST'){
        e.preventDefault();
        if(appState === 'CALIBRATE') document.getElementById('runCalibrateBtn').click();
        else document.getElementById('runTestBtn').click();
      }
    }
  });

  // ---------------- data page: session history (pure SVG, no external libs) ----------------
  //
  // Shows real logged sessions when there are any, and clearly-labelled sample data when
  // there are not, so an empty account never looks like a flat trend. Which quantity is
  // plotted is switchable, because the sessions carry several and they are measured in
  // different units — contact quality is a percentage, the others are resistances.

  function fmtOhms(v){
    if(v === null || v === undefined || !isFinite(v)) return '—';
    if(Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + ' MΩ';
    if(Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + ' kΩ';
    return Math.round(v) + ' Ω';
  }

  function fmtMultiple(v){ return (v === null || v === undefined) ? '—' : v.toFixed(2) + '×'; }

  // Contact quality used to lead this list, plotted as a share of good samples. It was
  // the wrong shape for a trend: contact has to read good every session before anything
  // else is worth recording, so the honest view of it is pass/fail on the day, not a
  // line that can slope. What replaces it is the same measurement judged against the
  // baseline it was taken under, which does carry information across sessions.
  const DATA_METRICS = [
    { key: 'resistance', label: 'Contact resistance', from: 'contact', fmt: fmtOhms,
      blurb: 'Average skin resistance measured during the test. Lower usually means firmer contact.',
      value: s => (typeof s.avgResistanceOhms === 'number' ? s.avgResistanceOhms : null) },
    { key: 'baseline', label: 'Calibrated baseline', from: 'calibration', fmt: fmtOhms,
      blurb: 'The personal baseline captured at each calibration. How much this moves between days is your drift.',
      value: s => (typeof s.baselineOhms === 'number' ? s.baselineOhms : null) },
    { key: 'margin', label: 'Contact vs baseline', from: 'contact', fmt: fmtMultiple,
      blurb: 'Average resistance as a multiple of the baseline that session was judged against. Closer to 1 means the electrodes sat as firmly as they did at calibration.',
      value: s => (typeof s.avgResistanceOhms === 'number'
                   && typeof s.baselineOhms === 'number'
                   && s.baselineOhms > 0)
        ? (s.avgResistanceOhms / s.baselineOhms) : null }
  ];

  let dataSessions = null;      // real sessions, oldest first; null when not signed in
  let dataMetricKey = 'resistance';   // 'contact' was removed; this is the first tab now
  let chartPoints = [];         // { value, label, detail }

  function activeMetric(){ return DATA_METRICS.find(m => m.key === dataMetricKey) || DATA_METRICS[0]; }

  const CHART = { padLeft: 58, padRight: 24, padTop: 16, padBottom: 30, pointGap: 68, height: 240 };
  function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

  // The y-axis is derived from the data rather than fixed, since a resistance trend and a
  // percentage cannot share one scale. Percentages keep a 0-100 frame so a good run still
  // looks like a good run rather than being stretched to fill the panel.
  let chartScale = { min: 0, max: 100 };
  // The spacing actually used between points. CHART.pointGap is the floor, not the
  // value: with a handful of sessions the chart spreads to fill whatever width the card
  // has, and only once the points are dense enough to need more than that does it stop
  // widening and start scrolling.
  let chartGap = CHART.pointGap;
  function computeScale(values, metric){
    const vals = values.filter(v => typeof v === 'number' && isFinite(v));
    if(metric.fixed) return { min: metric.fixed[0], max: metric.fixed[1] };
    if(!vals.length) return { min: 0, max: 1 };
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if(min === max){ const bump = Math.abs(min) * 0.1 || 1; min -= bump; max += bump; }
    const pad = (max - min) * 0.15;
    return { min: min - pad, max: max + pad };
  }

  function xFor(i){ return CHART.padLeft + i * chartGap; }
  function yFor(v){
    const span = chartScale.max - chartScale.min || 1;
    const t = (v - chartScale.min) / span;
    return CHART.padTop + (1 - t) * (CHART.height - CHART.padTop - CHART.padBottom);
  }

  function renderChart(revealCount, frac){
    const svg = document.getElementById('dataChartSvg');
    if(!svg) return;
    const n = chartPoints.length;
    if(n === 0){ svg.innerHTML = ''; svg.setAttribute('viewBox', '0 0 260 240'); return; }

    const metric = activeMetric();

    // Fill the card rather than drawing a fixed 68px per point and leaving the rest of
    // it empty. Five sessions at a fixed gap came to 354px, so on a desktop the chart sat
    // in the left quarter of a 1240px card with nothing beside it. The gap now stretches
    // to whatever room there is, with CHART.pointGap as the minimum -- so a long history
    // still reaches the point where it scrolls instead of cramming.
    const scroller = document.getElementById('chartScroll');
    const avail = scroller ? scroller.clientWidth : 0;
    const gaps = Math.max(0, n - 1);
    const roomPerGap = gaps ? (avail - CHART.padLeft - CHART.padRight) / gaps : CHART.pointGap;
    chartGap = Math.max(CHART.pointGap, roomPerGap || CHART.pointGap);

    const width = CHART.padLeft + gaps * chartGap + CHART.padRight;
    svg.setAttribute('viewBox', `0 0 ${Math.max(width, 260)} ${CHART.height}`);
    svg.setAttribute('width', Math.max(width, 260));
    svg.setAttribute('height', CHART.height);

    // Clamped at both ends, and the partial segment checks the point it is about to read.
    // An in-flight animation frame can land after chartPoints has been replaced by a
    // metric switch, and a negative revealCount indexes chartPoints[-1]; either way this
    // threw "Cannot read properties of undefined (reading 'value')" and killed the frame.
    const shownFull = Math.max(0, Math.min(revealCount, n - 1));
    const hasPartial = frac > 0 && shownFull < n - 1 && !!chartPoints[shownFull + 1];

    let grid = '';
    for(let k = 0; k <= 4; k++){
      const v = chartScale.min + (chartScale.max - chartScale.min) * (k / 4);
      const y = yFor(v);
      grid += `<line x1="${CHART.padLeft}" y1="${y}" x2="${Math.max(width, 260) - CHART.padRight}" y2="${y}" stroke="#e3e9e6" stroke-width="1"/>`;
      grid += `<text x="${CHART.padLeft - 10}" y="${y + 3}" text-anchor="end" font-family="IBM Plex Mono" font-size="10" fill="#8fa39d">${metric.fmt(v)}</text>`;
    }
    for(let i = 0; i < n; i++){
      grid += `<text x="${xFor(i)}" y="${CHART.height - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#8fa39d">${chartPoints[i].label}</text>`;
    }

    const pts = [];
    for(let i = 0; i <= shownFull; i++) pts.push([xFor(i), yFor(chartPoints[i].value)]);
    if(hasPartial){
      const a = chartPoints[shownFull].value, b = chartPoints[shownFull + 1].value;
      pts.push([xFor(shownFull + frac), yFor(a + (b - a) * frac)]);
    }
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    let dots = '';
    for(let i = 0; i <= shownFull; i++){
      dots += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.4" fill="var(--primary)"><title>${chartPoints[i].detail}</title></circle>`;
    }

    svg.innerHTML = grid +
      `<path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      dots;
  }

  let animFrame = null;
  let animFallback = null;
  function animateReveal(fromCount, toCount, duration){
    if(animFrame) cancelAnimationFrame(animFrame);
    if(animFallback) clearTimeout(animFallback);
    if(toCount <= 0){ renderChart(0, 0); return; }
    const start = performance.now();
    const span = toCount - fromCount;
    let settled = false;

    function settle(){
      if(settled) return;
      settled = true;
      if(animFrame) cancelAnimationFrame(animFrame);
      renderChart(toCount, 0);
      const scroller = document.getElementById('chartScroll');
      if(scroller) scroller.scrollLeft = scroller.scrollWidth;
    }

    // The chart is only ever drawn inside a frame callback, so if frames stop arriving
    // it keeps whatever was on screen before. document.hidden does not catch that: a
    // window that is merely backgrounded, occluded or power-throttled still reports
    // itself visible while rAF drops to a couple of frames a second. Measured two frames
    // in 800ms in one such case, which left the chart showing the previous metric while
    // the blurb beneath it described the new one. setTimeout keeps firing when rAF does
    // not, so this guarantees the final state lands either way.
    animFallback = setTimeout(settle, duration + 400);

    function frame(now){
      if(settled) return;
      const t = Math.min(1, (now - start) / duration);
      const current = fromCount + span * easeInOutCubic(t);
      renderChart(Math.floor(current), current - Math.floor(current));
      if(t < 1){ animFrame = requestAnimationFrame(frame); }
      else { clearTimeout(animFallback); settle(); }
    }
    animFrame = requestAnimationFrame(frame);
  }

  const SAMPLE_SESSIONS = [
    { type:'contact', goodCount:6, poorCount:3, noneCount:1, avgResistanceOhms: 980000, baselineOhms: 760000 },
    { type:'contact', goodCount:7, poorCount:3, noneCount:0, avgResistanceOhms: 910000, baselineOhms: 760000 },
    { type:'contact', goodCount:7, poorCount:2, noneCount:1, avgResistanceOhms: 870000, baselineOhms: 760000 },
    { type:'contact', goodCount:8, poorCount:2, noneCount:0, avgResistanceOhms: 840000, baselineOhms: 745000 },
    { type:'contact', goodCount:9, poorCount:1, noneCount:0, avgResistanceOhms: 790000, baselineOhms: 745000 },
    { type:'calibration', baselineOhms: 760000 },
    { type:'calibration', baselineOhms: 745000 },
    { type:'calibration', baselineOhms: 752000 }
  ];

  function usingRealData(){ return Array.isArray(dataSessions) && dataSessions.length > 0; }

  function sessionsForChart(){
    const metric = activeMetric();
    const source = usingRealData() ? dataSessions : SAMPLE_SESSIONS;
    return source.filter(s => s.type === metric.from);
  }

  function rebuildChartPoints(){
    const metric = activeMetric();
    const rows = sessionsForChart();
    chartPoints = rows.map((s, i) => {
      const v = metric.value(s);
      const when = s.atMs ? new Date(s.atMs).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : ('S' + (i + 1));
      return { value: v, label: when, detail: metric.label + ': ' + metric.fmt(v) };
    }).filter(p => p.value !== null && isFinite(p.value));
    chartScale = computeScale(chartPoints.map(p => p.value), metric);
  }

  // The chart sizes itself from the card, so it has to be redrawn when the card changes
  // width -- rotating a tablet, or dragging a desktop window narrower. Debounced, drawn
  // in its settled state, and only while the Data page is the one on screen.
  let chartResizeTimer = null;
  window.addEventListener('resize', () => {
    if(chartResizeTimer) clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
      const page = document.getElementById('page-data');
      if(page && page.classList.contains('page-active') && chartPoints.length){
        renderChart(chartPoints.length - 1, 0);
      }
    }, 150);
  });

  function renderMetricTabs(){
    const wrap = document.getElementById('dataMetricTabs');
    if(!wrap) return;
    wrap.innerHTML = '';
    DATA_METRICS.forEach(m => {
      const b = document.createElement('button');
      b.className = 'btn ' + (m.key === dataMetricKey ? 'btn-primary' : 'btn-ghost');
      b.textContent = m.label;
      b.addEventListener('click', () => {
        if(dataMetricKey === m.key) return;
        dataMetricKey = m.key;
        renderMetricTabs();
        refreshDataView(true);
      });
      wrap.appendChild(b);
    });
  }

  function renderSessionLog(){
    const el = document.getElementById('dataLog');
    if(!el) return;
    const rows = usingRealData() ? dataSessions : SAMPLE_SESSIONS;
    const tag = usingRealData() ? '' : '  [sample]';
    el.innerHTML = '';
    rows.slice().reverse().forEach(s => {
      const when = s.atMs ? new Date(s.atMs).toLocaleString() : '—';
      const row = document.createElement('div');
      row.className = 'log-row';
      row.textContent = s.type === 'calibration'
        ? `${when}  calibration  baseline ${fmtOhms(s.baselineOhms)}${tag}`
        : `${when}  contact  ${String(s.verdict || '').toLowerCase() || 'n/a'}  avg ${fmtOhms(s.avgResistanceOhms)}${tag}`;
      el.appendChild(row);
    });
  }

  function refreshDataView(animate){
    const metric = activeMetric();
    rebuildChartPoints();
    renderSessionLog();

    const src = document.getElementById('dataSourceLabel');
    if(src){
      src.textContent = usingRealData()
        ? chartPoints.length + ' logged session' + (chartPoints.length === 1 ? '' : 's')
        : 'sample data — nothing logged yet';
    }
    const blurb = document.getElementById('dataMetricBlurb');
    if(blurb) blurb.textContent = metric.blurb;

    const empty = document.getElementById('dataEmpty');
    if(empty) empty.hidden = chartPoints.length > 0;

    // requestAnimationFrame does not run while the page is hidden, so an animated reveal
    // started in a background tab would never paint and the chart would sit showing
    // whatever was there before. Draw straight away in that case.
    if(animate && chartPoints.length > 1 && !document.hidden) animateReveal(0, chartPoints.length - 1, 700);
    else renderChart(chartPoints.length - 1, 0);
  }

  // Pulls the account's own history. Kept separate from rendering so a failed or slow
  // read leaves the page showing something rather than nothing.
  //
  // Auth changes and manual refreshes can both start a load, so two can be in flight at
  // once — and whichever finishes last would otherwise win regardless of which was asked
  // for last. The token means a superseded load discards its own result instead of
  // overwriting newer data, which is what made a signed-in page fall back to sample data.
  async function initDataChart(){
    const token = ++dataLoadToken;
    renderMetricTabs();
    refreshDataView(false);

    const rows = window.Neurova.loadSessions ? await window.Neurova.loadSessions(200) : null;
    if(token !== dataLoadToken) return;

    dataSessions = rows;
    refreshDataView(true);
  }
  window.Neurova.refreshDataPage = () => { if(dataChartReady) initDataChart(); };

  const refreshBtn = document.getElementById('refreshDataBtn');
  if(refreshBtn) refreshBtn.addEventListener('click', () => initDataChart());
})();

// ---------------- account / authentication ----------------
(function(){
  const accountPanel = document.getElementById('accountPanel');
  const dataAuthBanner = document.getElementById('dataAuthBanner');
  if(!accountPanel && !dataAuthBanner) return;

  const config = window.NEUROVA_FIREBASE_CONFIG;
  const configIsPlaceholder = !config || String(config.apiKey || '').indexOf('PASTE') !== -1;
  const firebaseLoaded = typeof window.firebase !== 'undefined';
  const firebaseReady = firebaseLoaded && !configIsPlaceholder;

  let auth = null;
  let db = null;
  let currentUser = null;
  let authMode = 'login'; // 'login' | 'signup'
  let authError = '';
  let authBusy = false;
  let confirmingDelete = false;
  let deleteBusy = false;
  let deleteError = '';
  let needsReauth = false;
  let calibLoadFailed = false;
  let exportBusy = false;

  if(firebaseReady){
    try{
      if(!firebase.apps.length) firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.firestore();
      // Firestore's default connection can silently stall for a long time on networks
      // that block its usual streaming connection (school wifi, some proxies/extensions),
      // only recovering once it times out and falls back on its own. This setting skips
      // straight to the reliable fallback instead of waiting through that timeout.
      db.settings({ experimentalAutoDetectLongPolling: true, useFetchStreams: false });
      // Once a document has been fetched successfully, keep a local copy so a later
      // flaky moment (or a genuinely offline visit) can still read it from cache
      // instead of failing outright with "client is offline".
      db.enablePersistence({ synchronizeTabs: true }).catch(e => {
        console.warn('Firestore offline persistence not enabled:', e.code);
      });
    }catch(e){
      console.error('Firebase failed to initialize:', e);
    }
  }

  // Two different questions, and only one of them Firebase can answer while signed out.
  // Whether someone is signed in right now is auth state; whether they have ever had an
  // account is not, so it is remembered here. That is what decides whether a signed-out
  // visitor should be met with the sign-up form or the log-in form.
  const HAS_ACCOUNT_KEY = 'neurovaHasAccount';

  function rememberHasAccount(){
    try{ localStorage.setItem(HAS_ACCOUNT_KEY, '1'); }catch(e){ /* storage unavailable */ }
  }
  function hasAccountBefore(){
    try{ return localStorage.getItem(HAS_ACCOUNT_KEY) === '1'; }catch(e){ return false; }
  }

  // Releases the pre-paint gate from <head>. Called once routing is settled, whichever
  // way it resolved — including when Firebase is not configured at all, since the site
  // must never depend on an auth answer that is not coming.
  function revealSite(){
    document.documentElement.classList.remove('auth-pending');
  }

  let initialAuthResolved = false;
  let sentToSignIn = false;   // true when this visit was routed to the account page

  // Runs once, on the first auth state Firebase reports after it has checked for a
  // persisted session. Signed in -- as a full account or as a guest -- the visitor is
  // left wherever they were heading. Signed out, they are sent to sign in, to sign-up if
  // this browser has never seen an account and to log-in if it has.
  //
  // This used to carry two escape hatches, and each one defeated the gate by itself: a
  // once-per-browser-session flag, so the second visit to any page sailed through, and an
  // exemption for any URL carrying a hash, on the reasoning that a shared link is a
  // deliberate destination. The second was the larger hole -- it meant typing #data was
  // not merely tolerated but was the documented way past the sign-in screen. A deliberate
  // destination is now honoured by remembering it and going there after sign-in, which
  // gets the visitor to the same page without leaving the door open to do it.
  function routeOnFirstResolve(user){
    if(user){ if(!user.isAnonymous) rememberHasAccount(); revealSite(); return; }

    // No once-per-session reprieve any more. It used to return early if the sign-in
    // screen had already been shown this session, which is precisely what made
    // "Switch to desktop version" a way in: that link is an ordinary href to the other
    // HTML file, so it reloaded the site with the flag already set and sailed straight
    // past. Typing either filename did the same. The flag is gone; the gate in
    // showPage now holds on every load and every navigation.

    // Hold on to where they were trying to go before we overwrite it with the sign-in
    // screen, so signing in can finish the journey instead of dumping them on Home.
    const landing = (location.hash || '#home').slice(1);
    if(window.Neurova.rememberDestination) window.Neurova.rememberDestination(landing);

    authMode = hasAccountBefore() ? 'login' : 'signup';
    sentToSignIn = true;
    renderAccountPanel();
    if(window.Neurova.goToPage) window.Neurova.goToPage('account');
    revealSite();   // last, so the sign-in page is what appears rather than the home page
  }

  window.Neurova.getUser = () => currentUser;
  window.Neurova.calibLoadFailed = () => calibLoadFailed;

  window.Neurova.saveCalibration = async function(baselineOhms){
    if(!firebaseReady || !currentUser || !db) return false;
    try{
      await db.collection('users').doc(currentUser.uid).set({
        calibrationBaseline: baselineOhms,
        calibrationSavedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      cachedProfile = Object.assign({}, cachedProfile, { calibrationBaseline: baselineOhms });
      return true;
    }catch(e){
      console.error('Saving calibration baseline failed:', e);
      return false;
    }
  };

  async function loadSavedCalibrationForCurrentUser(attempt){
    attempt = attempt || 1;
    if(!firebaseReady || !currentUser || !db) return;
    try{
      const snap = await db.collection('users').doc(currentUser.uid).get();
      cachedProfile = snap.exists ? snap.data() : {};
      calibLoadFailed = false;
      if(snap.exists && window.Neurova.applySavedCalibration){
        window.Neurova.applySavedCalibration(snap.data());
      }
      if(window.Neurova.onAccountChange) window.Neurova.onAccountChange();
    }catch(e){
      console.error('Loading saved calibration failed (attempt ' + attempt + '):', e);
      // Firestore's SDK can decide internally that it's "offline" and reject new
      // requests immediately without actually retrying the network — so a plain
      // retry can fail the same way even once the connection is fine again.
      // Explicitly cycling the network off/on forces it to actually re-probe
      // the connection instead of waiting on its own internal backoff timer.
      if(attempt < 3){
        try{ await db.disableNetwork(); await db.enableNetwork(); }catch(e2){ /* best effort */ }
        setTimeout(() => loadSavedCalibrationForCurrentUser(attempt + 1), attempt * 3000);
      } else {
        calibLoadFailed = true;
        if(window.Neurova.onAccountChange) window.Neurova.onAccountChange();
      }
    }
  }
  window.Neurova.retryLoadCalibration = () => loadSavedCalibrationForCurrentUser();

  // ---------------- session history ----------------
  //
  // Every calibration and contact test is a dated record under the signed-in user, in the
  // subcollection the security rule's {document=**} wildcard already covers. Writes are
  // fire-and-forget: a session that fails to save must never interrupt a test that has
  // already been run on someone's arm.
  window.Neurova.logSession = async function(session){
    if(!firebaseReady || !currentUser || !db) return false;
    try{
      await db.collection('users').doc(currentUser.uid).collection('sessions').add(
        Object.assign({}, session, { at: firebase.firestore.FieldValue.serverTimestamp() })
      );
      return true;
    }catch(e){
      console.error('Logging session failed:', e);
      return false;
    }
  };

  // Returns oldest-first for charting, or null when there is no account to read from —
  // which the Data page needs to tell apart from an account that simply has no sessions.
  window.Neurova.loadSessions = async function(max){
    if(!firebaseReady || !currentUser || !db) return null;
    try{
      const snap = await db.collection('users').doc(currentUser.uid).collection('sessions')
        .orderBy('at', 'desc').limit(max || 200).get();
      const out = [];
      snap.forEach(doc => {
        const d = doc.data();
        out.push(Object.assign({ id: doc.id }, d, {
          atMs: (d.at && typeof d.at.toMillis === 'function') ? d.at.toMillis() : null
        }));
      });
      return out.reverse();
    }catch(e){
      console.error('Loading sessions failed:', e);
      return null;
    }
  };

  function friendlyAuthError(code){
    const map = {
      'auth/email-already-in-use': "That email already has an account — try logging in instead.",
      'auth/invalid-email': "That doesn't look like a valid email address.",
      'auth/weak-password': "Passwords need to be at least 6 characters.",
      'auth/user-not-found': "No account found with that email.",
      'auth/wrong-password': "That password doesn't match this account.",
      'auth/invalid-credential': "That email and password combination doesn't match an account.",
      'auth/too-many-requests': "Too many attempts — wait a bit before trying again.",
      'auth/network-request-failed': "Couldn't reach the server — check your connection and try again.",
      'auth/popup-closed-by-user': "The Google sign-in window was closed before finishing — try again.",
      'auth/popup-blocked': "Your browser blocked the sign-in popup — allow popups for this site and try again.",
      'auth/cancelled-popup-request': "That sign-in attempt was cancelled — try again.",
      'auth/account-exists-with-different-credential': "This email is already used with a different sign-in method — try logging in with a password instead.",
      'auth/unauthorized-domain': "This site's domain isn't authorized for Google sign-in yet in the Firebase console.",
      // The email-link flow has its own failure modes, and every one of them was landing
      // on the generic fallback — which said nothing about what to actually fix.
      'auth/operation-not-allowed': "Email link sign-in isn't switched on for this project yet — enable it under Authentication, Sign-in method, Email/Password.",
      'auth/unauthorized-continue-uri': "This site's domain isn't on Firebase's authorized domains list — add it under Authentication, Settings, Authorized domains.",
      'auth/invalid-continue-uri': "The return address for the sign-in link isn't valid.",
      'auth/missing-continue-uri': "No return address was given for the sign-in link.",
      'auth/invalid-action-code': "That sign-in link has already been used, or it expired. Ask for a new one.",
      'auth/expired-action-code': "That sign-in link expired. Ask for a new one.",
      'auth/user-disabled': "That account has been disabled.",
      // What Firebase returns when the Anonymous provider is switched off, which is how
      // every project starts. Without this the guest button fails with the generic
      // "something went wrong", which points at nothing.
      'auth/admin-restricted-operation': "Guest access isn't switched on for this project yet — enable Anonymous under Authentication, Sign-in method.",
      // Firebase's no-cost plan allows 5 email-link sign-ins per day across the whole
      // project. Nothing is broken when this happens and waiting is the only cure, so the
      // message points at the two routes that have no such limit.
      'auth/quota-exceeded': "Email sign-in links have run out for today — the free Firebase plan allows five a day. Use Google, or a password, until it resets.",
      'auth/requires-recent-login': "Please sign in again before making that change.",
      'neurova/timeout': "That's taking much longer than it should — check your connection and try again."
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  // Keeps the exact code alongside the readable message. A generic "something went wrong"
  // hid a specific, fixable cause more than once while building this, and the code is the
  // part that says which one it was.
  let lastAuthErrorCode = '';
  function reportAuthError(where, err){
    lastAuthErrorCode = (err && err.code) || '';
    console.error('[neurova auth] ' + where, {
      code: lastAuthErrorCode,
      message: err && err.message,
      href: location.href,
      storedEmail: (function(){ try{ return localStorage.getItem(EMAIL_FOR_LINK_KEY); }catch(e){ return '(unavailable)'; } })()
    });
    return friendlyAuthError(lastAuthErrorCode);
  }

  function authErrorBlock(){
    if(!authError) return '';
    return `<div class="auth-error">${esc(authError)}` +
      (lastAuthErrorCode ? `<span class="auth-error-code">${esc(lastAuthErrorCode)}</span>` : '') +
      `</div>`;
  }

  function initials(name){
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function displayNameOf(user){
    if(!user) return '';
    // A guest has neither a display name nor an email, and the old fallback chain ran
    // straight off the end into null -- which the Data page printed literally, as
    // "Signed in as null".
    if(user.isAnonymous) return 'Guest';
    return user.displayName || user.email || '';
  }


  // ---------------- passwordless email link ----------------
  //
  // On mobile the sign-in screen asks for an email and nothing else: Firebase mails a
  // link, following it signs the person in, and whether that creates the account or
  // returns to an existing one is the same action either way. Passwords still exist --
  // an account can set one during onboarding and use it through the fallback below --
  // but nothing requires one to get in.
  // Passwordless email-link sign-in is built and working, but switched off: Firebase's
  // no-cost plan allows only five of these a day for the entire project, which is not
  // enough to put in front of anyone. Everything it needs is still here — the send, the
  // wait screen, the return handler, the different-device confirmation and the onboarding
  // steps. Flip this to true to bring it back, which is worth doing if the project ever
  // moves to the Blaze plan, where the same limit is 25,000 a day.
  const PASSWORDLESS_SIGNIN_ENABLED = false;

  const EMAIL_FOR_LINK_KEY = 'neurovaEmailForSignIn';
  // Shown on the wait screen so the message can be found when it is filtered. Update this
  // if the sender is ever changed in the Firebase console.
  const LINK_SENDER_ADDRESS = 'noreply@neurovatech.me';

  // 'credentials' | 'linkSent' | 'confirmEmail'
  let authFlow = 'credentials';
  let usePasswordFallback = false;
  let pendingEmail = '';
  let onboardStep = 0;

  // Must match the CSS breakpoint, not just the mobile document. desktop.html in a narrow
  // window gets the stacked layout from the media query, and would otherwise show it
  // wrapped around the desktop password form.
  function isMobileLayout(){
    return document.body.classList.contains('force-mobile')
      || window.matchMedia('(max-width: 860px)').matches;
  }
  // Mobile gets the link flow when it is enabled; desktop keeps the password form either
  // way. With the flag off, every layout falls through to the password form.
  function useLinkFlow(){
    return PASSWORDLESS_SIGNIN_ENABLED && isMobileLayout() && !usePasswordFallback;
  }

  // Where the emailed link lands. It must come back to a page that runs this script, and
  // handleCodeInApp is what makes Firebase hand the code to us rather than to its own
  // hosted handler.
  function linkActionSettings(){
    return {
      url: location.origin + location.pathname + '#account',
      handleCodeInApp: true
    };
  }

  async function sendSignInLink(email){
    await auth.sendSignInLinkToEmail(email, linkActionSettings());
    // Firebase needs the address back when the link is followed, and the link itself does
    // not carry it — so it is stashed here and read on return.
    try{ localStorage.setItem(EMAIL_FOR_LINK_KEY, email); }catch(e){ /* storage unavailable */ }
  }

  // Runs on load. Returns true when the current URL is a sign-in link we handled, so the
  // caller knows not to route the visitor anywhere else first.
  // Deliberately not gated on the flag. A link already sitting in someone's inbox should
  // still sign them in, and this only does anything when the URL actually carries a code.
  async function completeEmailLinkSignIn(){
    if(!auth || !auth.isSignInWithEmailLink || !auth.isSignInWithEmailLink(location.href)) return false;

    let email = '';
    try{ email = localStorage.getItem(EMAIL_FOR_LINK_KEY) || ''; }catch(e){}

    // Opened on a different device or browser than the one that asked for the link, so
    // there is nothing stored. Ask for the address rather than failing.
    if(!email){
      authFlow = 'confirmEmail';
      renderAccountPanel();
      if(window.Neurova.goToPage) window.Neurova.goToPage('account');
      return true;
    }
    await finishLinkSignIn(email);
    return true;
  }

  async function finishLinkSignIn(email){
    try{
      await auth.signInWithEmailLink(email, location.href);
      try{ localStorage.removeItem(EMAIL_FOR_LINK_KEY); }catch(e){}
      // Strip the one-time code out of the address bar so a reload or a shared URL cannot
      // replay it.
      history.replaceState(null, '', location.pathname + '#account');
      authFlow = 'credentials';
      authError = '';
    }catch(err){
      authFlow = 'credentials';
      authError = reportAuthError('signInWithEmailLink', err);
      renderAccountPanel();
    }
  }

  // Someone arriving by link has no display name yet, which is also what marks them as
  // new: a Google account brings one with it and skips onboarding entirely.
  function needsOnboarding(){
    // A guest has no display name and never will, so the displayName test alone would
    // march every visitor into onboarding and ask them to name an account they never
    // created. Anonymous sessions skip it.
    return !!currentUser && !currentUser.isAnonymous && !currentUser.displayName;
  }

  function isGuest(){
    return !!currentUser && currentUser.isAnonymous;
  }

  // Firebase anonymous auth rather than a local "guest" flag. It issues a real uid, so
  // a guest's calibration saves under the same Firestore rules as anyone else's and the
  // rest of the site needs no special case. The cost is that the session lives in this
  // browser only -- which the guest panel says plainly.
  async function signInAsGuest(){
    authError = '';
    authBusy = true;
    renderAccountPanel();
    try{
      await auth.signInAnonymously();
      // onAuthStateChanged re-renders on success.
    }catch(err){
      authBusy = false;
      authError = reportAuthError('auth', err);
      renderAccountPanel();
    }
  }

  // ---------------- consent gate ----------------
  //
  // Shown when someone is about to create an account, and only then. Logging in does not
  // raise it, because the agreement was given once already and asking again on every
  // visit trains people to click past it. Guest sign-in does not raise it either: it
  // creates no name, no address and nothing anyone could be held to.
  //
  // The version strings are what make the record meaningful. "They agreed" is worth very
  // little on its own; "they agreed to version 1.0 on this date" is a fact that survives
  // the documents being rewritten later.
  const TERMS_VERSION = '1.0';
  const PRIVACY_VERSION = '2026-11-17';
  const PENDING_CONSENT_KEY = 'neurovaPendingConsent';

  let consentOpen = false;

  // Resolves true when both boxes are ticked and the person confirms, false if they back
  // out. Callers await it and simply do nothing on false.
  // trigger is the control that set this off, used only to point the panel's growth
  // at it. Everything still works when it is omitted -- the panel grows from its own
  // centre, which is what the CSS falls back to.
  function requireConsent(trigger){
    if(consentOpen) return Promise.resolve(false);
    consentOpen = true;

    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'consent-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', 'consentTitle');
      backdrop.innerHTML = `
        <div class="consent-modal">
          <h3 id="consentTitle">Before you create an account</h3>
          <p class="consent-sub">Two things to agree to. Both open in a new tab, and neither is long.</p>

          <label class="consent-row" for="consentTerms">
            <input type="checkbox" id="consentTerms">
            <span>I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a>.</span>
          </label>

          <label class="consent-row" for="consentPrivacy">
            <input type="checkbox" id="consentPrivacy">
            <span>I have read the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
          </label>

          <p class="consent-hint" id="consentHint" role="status" aria-live="polite">Tick both to continue.</p>

          <div class="consent-actions">
            <button type="button" class="btn btn-primary" id="consentAccept">Agree and continue</button>
            <button type="button" class="btn btn-ghost" id="consentCancel">Cancel</button>
          </div>
        </div>`;

      document.body.appendChild(backdrop);

      // After the append, so the panel has been laid out and has a box to measure --
      // before it, every rect would be zero and the origin would land in the corner.
      if(window.Neurova.setGrowOrigin){
        window.Neurova.setGrowOrigin(backdrop.querySelector('.consent-modal'), trigger);
      }

      const termsBox = backdrop.querySelector('#consentTerms');
      const privacyBox = backdrop.querySelector('#consentPrivacy');
      const hint = backdrop.querySelector('#consentHint');
      const boxes = [termsBox, privacyBox];

      const previouslyFocused = document.activeElement;
      backdrop.querySelector('#consentAccept').focus();

      function close(result){
        consentOpen = false;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        // Put focus back where it was, or the page is left with focus on <body> and a
        // keyboard user has to tab in from the top again.
        if(previouslyFocused && previouslyFocused.focus) {
          try{ previouslyFocused.focus(); }catch(e){}
        }
        resolve(result);
      }

      // Clearing the nudge the moment a box is ticked matters more than it looks: the
      // outline is the only thing on screen saying what is wrong, and leaving it up on a
      // box that has since been ticked is worse than never showing it.
      boxes.forEach(b => b.addEventListener('change', () => {
        if(b.checked) b.closest('.consent-row').classList.remove('is-missing');
        if(boxes.every(x => x.checked)) hint.classList.remove('is-shown');
      }));

      backdrop.querySelector('#consentAccept').addEventListener('click', () => {
        const missing = boxes.filter(b => !b.checked);
        if(missing.length){
          hint.classList.add('is-shown');
          missing.forEach(b => {
            const row = b.closest('.consent-row');
            // Restart the animation rather than let a second click be silent: removing
            // the class, forcing a reflow and re-adding it is the only reliable way to
            // replay a CSS animation on an element that already has it.
            row.classList.remove('is-missing');
            void row.offsetWidth;
            row.classList.add('is-missing');
          });
          missing[0].focus();
          return;
        }
        // The email-link route collects consent before the account exists -- the link
        // still has to be followed first. Marking it here and flushing it once there is
        // a uid to attach it to is what stops that route recording nothing at all.
        try{ localStorage.setItem(PENDING_CONSENT_KEY, '1'); }catch(e){}
        close(true);
      });

      backdrop.querySelector('#consentCancel').addEventListener('click', () => close(false));

      // Clicking the dimmed area backs out, but only when the click started there --
      // without the target check, releasing the mouse outside the card after selecting
      // text inside it would close the dialog.
      backdrop.addEventListener('mousedown', e => { if(e.target === backdrop) close(false); });

      function onKey(e){
        if(e.key === 'Escape'){ e.preventDefault(); close(false); return; }
        if(e.key !== 'Tab') return;
        // Keep focus inside the dialog. Without this, tabbing past the last button lands
        // on the sign-in form behind the backdrop, which is still fully interactive.
        const focusable = backdrop.querySelectorAll('a[href], button, input[type="checkbox"]');
        if(!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
    });
  }

  // Written after the account exists, because there is nowhere to put it before then.
  // Merged rather than set, so it cannot clobber a profile write racing alongside it,
  // and fire-and-forget, because a failed consent write must not strand someone who has
  // just successfully created an account.
  function recordConsent(uid){
    try{ localStorage.removeItem(PENDING_CONSENT_KEY); }catch(e){}
    if(!db || !uid) return;
    db.collection('users').doc(uid).set({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(err => console.error('Consent record failed:', err));
  }

  // Writes a consent that was agreed to earlier in this browser but had no account to
  // attach itself to at the time. No marker means nothing to flush, so this is safe to
  // call on any successful sign-in.
  function flushPendingConsent(uid){
    let pending = false;
    try{ pending = localStorage.getItem(PENDING_CONSENT_KEY) === '1'; }catch(e){}
    if(pending) recordConsent(uid);
  }

  const GOOGLE_ICON_SVG = `<svg viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.617z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>`;

  // isSigningUp is passed by the caller rather than read from authMode, because the same
  // Google button appears on the log-in screen, where consent was given long ago and
  // asking again would be noise.
  async function signInWithGoogle(isSigningUp){
    const googleBtn = document.getElementById('googleSignInBtn');
    // Asking up front when the screen is offering to create an account keeps the terms
    // in front of someone before Google's popup appears, which is the right order.
    if(isSigningUp){
      const agreed = await requireConsent(googleBtn);
      if(!agreed) return;
    }
    authError = '';
    authBusy = true;
    renderAccountPanel();
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      if(!result.user) return;

      // The screen's mode is a guess, not a fact. "Log in" is shown to any browser that
      // has held an account before, but the Google button there creates a new account
      // just as readily as the one on the sign-up screen -- a different Google address,
      // or the same person on a shared computer, and Firebase silently registers it.
      // That path collected no consent at all.
      //
      // additionalUserInfo.isNewUser is the fact. When an account really was just
      // created and the terms were not already agreed to, ask now; declining deletes the
      // account again, so none can exist without consent. A returning user never sees
      // this, which is why it is not simply shown on every Google sign-in.
      const isNew = !!(result.additionalUserInfo && result.additionalUserInfo.isNewUser);
      if(isNew && !isSigningUp){
        const agreed = await requireConsent(document.getElementById('googleSignInBtn') || googleBtn);
        if(!agreed){
          try{ await result.user.delete(); }
          catch(e){ console.error('Could not undo the new account:', e); try{ await auth.signOut(); }catch(e2){} }
          authBusy = false;
          renderAccountPanel();
          return;
        }
      }

      if(db){
        db.collection('users').doc(result.user.uid).set({
          email: result.user.email,
          name: result.user.displayName || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Profile write failed:', err));
      }
      if(isSigningUp || isNew) recordConsent(result.user.uid);
      // onAuthStateChanged will re-render on success
    } catch(err){
      authBusy = false;
      authError = reportAuthError('auth', err);
      renderAccountPanel();
    }
  }

  function renderNotConfigured(){
    if(!accountPanel) return;
    accountPanel.innerHTML = `
      <div class="auth-card">
        <h3>Accounts aren't connected yet</h3>
        <p class="auth-sub">This site's Firebase project hasn't been set up yet, so sign-in isn't live. Once a real config is pasted into <span class="mono">firebase-config.js</span>, this page will let you create an account and log in from any device.</p>
      </div>`;
  }

  function memberSinceText(){
    const t = currentUser && currentUser.metadata && currentUser.metadata.creationTime;
    if(!t) return '';
    const d = new Date(t);
    if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Cached copy of this user's Firestore profile doc, kept in sync whenever we read or
  // write it (login restore, calibration save). Lets "Export my data" build its file
  // instantly from memory instead of awaiting a fresh network read — a download
  // triggered after an async gap can get silently blocked by the browser as not being
  // tied closely enough to the click that started it.
  let cachedProfile = null;

  function buildExportBlob(sessions){
    const exportObj = {
      email: currentUser.email,
      name: currentUser.displayName || (cachedProfile && cachedProfile.name) || null,
      memberSince: memberSinceText() || null,
      calibrationBaselineOhms: (cachedProfile && typeof cachedProfile.calibrationBaseline === 'number') ? cachedProfile.calibrationBaseline : null,
      termsVersion: (cachedProfile && cachedProfile.termsVersion) || null,
      privacyVersion: (cachedProfile && cachedProfile.privacyVersion) || null,
      // The session history is the part of the account anyone would actually want back,
      // and for a long time it was the one part the export left out. null rather than []
      // when the read failed, so an export cannot quietly imply an empty history.
      sessions: Array.isArray(sessions)
        ? sessions.map(ses => {
            const out = Object.assign({}, ses);
            // A Firestore Timestamp does not survive JSON.stringify as anything useful,
            // and atMs is already the same instant in a portable form.
            delete out.at;
            if(typeof out.atMs === 'number') out.takenAt = new Date(out.atMs).toISOString();
            return out;
          })
        : null,
      sessionCount: Array.isArray(sessions) ? sessions.length : null,
      exportedAt: new Date().toISOString()
    };
    return new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  }

  async function triggerDownload(blob, filename){
    // An anchor with a download attribute is the desktop answer and does nothing visible
    // on iOS, where WebKit ignores it for blob URLs -- which is why Export my data
    // appeared dead on a phone. The share sheet is the platform's own way to save a file,
    // so try that first where it exists, and fall back to the anchor everywhere else.
    if(navigator.canShare && navigator.share && window.File){
      try{
        const file = new File([blob], filename, { type: blob.type });
        if(navigator.canShare({ files: [file] })){
          await navigator.share({ files: [file], title: filename });
          return;
        }
      }catch(err){
        // Dismissing the sheet is a decision, not a failure -- don't then download behind
        // their back. Anything else falls through to the anchor.
        if(err && err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download on some browsers before it has read
    // the blob, so give it a moment.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function exportMyData(){
    // The session history always needs a fetch, so unlike before there is no synchronous
    // path -- the button goes busy every time. That is the right trade for an export that
    // actually contains the history.
    const btn = document.getElementById('exportDataBtn');
    exportBusy = true;
    if(btn){ btn.disabled = true; btn.textContent = 'Preparing export…'; }
    try{
      if(cachedProfile === null){
        if(db && currentUser){
          const snap = await db.collection('users').doc(currentUser.uid).get();
          cachedProfile = snap.exists ? snap.data() : {};
        } else {
          cachedProfile = {};
        }
      }
      // Null, not [], if this fails: see buildExportBlob. Asking for far more than the
      // chart does, because an export should be everything rather than a recent window.
      let sessions = null;
      try{
        if(window.Neurova.loadSessions) sessions = await window.Neurova.loadSessions(5000);
      }catch(e){ console.error('Session history unavailable for export:', e); }

      await triggerDownload(buildExportBlob(sessions), 'neurova-account-data.json');
    }catch(e){
      console.error('Export failed:', e);
      deleteError = ''; // unrelated field, just being explicit we're not touching it
      alert('Export failed — please check your connection and try again.');
    }finally{
      exportBusy = false;
      if(btn){ btn.disabled = false; btn.textContent = 'Export my data'; }
    }
  }

  // Wraps a promise so it gives up with a clear error instead of hanging forever if the
  // connection stalls — without this, a stuck network request leaves "Deleting…" (or any
  // other busy state) spinning indefinitely with no feedback at all.
  function withTimeout(promise, ms){
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if(settled) return;
        settled = true;
        reject({ code: 'neurova/timeout' });
      }, ms);
      promise.then(
        (val) => { if(settled) return; settled = true; clearTimeout(timer); resolve(val); },
        (err) => { if(settled) return; settled = true; clearTimeout(timer); reject(err); }
      );
    });
  }
  const NETWORK_TIMEOUT_MS = 12000;

  // Firestore does not cascade. Deleting users/{uid} leaves users/{uid}/sessions/* fully
  // intact -- the documents simply stop having a reachable parent, which from the owner's
  // side is indistinguishable from deletion and from the database's side is not deletion
  // at all. Every session therefore has to be removed by hand, before the parent goes.
  //
  // Batched 300 at a time (the server limit is 500) and looped, because a history built
  // up over months of daily tests will not come back in one page.
  async function deleteSessionHistory(uid){
    if(!db || !uid) return;
    const sessions = db.collection('users').doc(uid).collection('sessions');
    for(;;){
      const snap = await withTimeout(sessions.limit(300).get(), NETWORK_TIMEOUT_MS);
      if(snap.empty) return;
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await withTimeout(batch.commit(), NETWORK_TIMEOUT_MS);
      // A short page means that was the last of them. Checking this rather than looping
      // until empty saves one round trip on the common case of a handful of sessions.
      if(snap.size < 300) return;
    }
  }

  async function deleteAccountData(){
    if(db && currentUser){
      const uid = currentUser.uid;
      // Order matters. The auth account is deleted last, because the security rules
      // allow these writes only while its owner is signed in -- drop the account first
      // and the sessions become permanently undeletable by anyone but an administrator.
      try{ await deleteSessionHistory(uid); }
      catch(e){ console.error('Deleting session history failed or timed out:', e); }
      try{ await withTimeout(db.collection('users').doc(uid).delete(), NETWORK_TIMEOUT_MS); }
      catch(e){ console.error('Deleting profile doc failed or timed out:', e); }
    }
    await withTimeout(currentUser.delete(), NETWORK_TIMEOUT_MS);
    // onAuthStateChanged fires with null and re-renders to the logged-out form.
  }

  async function performDeleteAccount(){
    deleteBusy = true;
    deleteError = '';
    renderSignedIn();
    try{
      await deleteAccountData();
    }catch(e){
      deleteBusy = false;
      if(e && e.code === 'auth/requires-recent-login'){
        // Firebase blocks deletion unless the session is "fresh" — rather than dead-end
        // the person with a log-out-and-back-in instruction, reauthenticate right here.
        needsReauth = true;
      } else {
        deleteError = friendlyAuthError(e && e.code);
      }
      renderSignedIn();
    }
  }

  async function reauthenticateAndDelete(password){
    deleteBusy = true;
    deleteError = '';
    renderSignedIn();
    try{
      const providerId = (currentUser.providerData[0] && currentUser.providerData[0].providerId) || 'password';
      if(providerId === 'google.com'){
        await withTimeout(currentUser.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider()), NETWORK_TIMEOUT_MS);
      } else {
        const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
        await withTimeout(currentUser.reauthenticateWithCredential(cred), NETWORK_TIMEOUT_MS);
      }
      await deleteAccountData();
    }catch(e){
      deleteBusy = false;
      deleteError = friendlyAuthError(e && e.code);
      renderSignedIn();
    }
  }

  // Deliberately not renderSignedIn with the name swapped out: that panel offers
  // "member since", an export and account deletion, none of which mean anything for a
  // session that exists only in this browser.
  function renderGuest(){
    if(!accountPanel) return;
    accountPanel.innerHTML = `
      <div class="auth-card">
        <div class="auth-signed-in-row">
          <div class="auth-avatar">G</div>
          <div>
            <div style="font-weight:600;">Browsing as a guest</div>
            <div style="color:var(--muted); font-size:12.5px;">No account, nothing to sign out of</div>
          </div>
        </div>
        <div class="auth-note">Every page and every test works exactly as it does with an account. What you save — a calibration baseline, for instance — is kept against a temporary guest session that lives in this browser. Clear your site data or open the site on another device and it is gone.</div>
        <div class="auth-actions">
          <button class="btn btn-primary" id="guestUpgradeBtn" ${authBusy ? 'disabled' : ''}>Create a real account</button>
          <button class="btn btn-ghost" id="guestLeaveBtn" ${authBusy ? 'disabled' : ''}>Leave guest mode</button>
        </div>
      </div>`;

    // Both routes end at the signed-out form. Signing out first is what makes the
    // sign-up screen appear rather than this panel again.
    const leave = async (mode) => {
      authBusy = true; renderGuest();
      try{ await auth.signOut(); }catch(e){ console.error('Guest sign-out failed:', e); }
      authBusy = false;
      authMode = mode;
      usePasswordFallback = false;
      authError = '';
    };
    document.getElementById('guestUpgradeBtn').addEventListener('click', () => leave('signup'));
    document.getElementById('guestLeaveBtn').addEventListener('click', () => leave('login'));
  }

  function renderSignedIn(){
    if(!accountPanel) return;
    const name = displayNameOf(currentUser);
    const showEmailSecondary = currentUser.displayName && currentUser.displayName !== currentUser.email;
    const since = memberSinceText();
    const isGoogleAccount = currentUser.providerData[0] && currentUser.providerData[0].providerId === 'google.com';

    let deleteSection;
    if(needsReauth){
      deleteSection = `
      <div class="danger-zone">
        ${deleteError ? `<div class="auth-error">${deleteError}</div>` : ''}
        <p class="danger-copy">For security, please confirm it's you before this account gets deleted.</p>
        ${isGoogleAccount ? `
        <div class="auth-actions">
          <button class="btn btn-danger" id="reauthConfirmBtn" ${deleteBusy ? 'disabled' : ''}>${deleteBusy ? 'Please wait…' : 'Confirm with Google & delete'}</button>
          <button class="btn btn-ghost" id="cancelDeleteBtn" ${deleteBusy ? 'disabled' : ''}>Cancel</button>
        </div>` : `
        <form id="reauthForm">
          <div class="form-group">
            <label for="reauthPassword">Password</label>
            <input type="password" id="reauthPassword" autocomplete="current-password" required>
          </div>
          <div class="auth-actions">
            <button type="submit" class="btn btn-danger" id="reauthConfirmBtn" ${deleteBusy ? 'disabled' : ''}>${deleteBusy ? 'Please wait…' : 'Confirm & delete'}</button>
            <button type="button" class="btn btn-ghost" id="cancelDeleteBtn" ${deleteBusy ? 'disabled' : ''}>Cancel</button>
          </div>
        </form>`}
      </div>`;
    } else if(confirmingDelete){
      deleteSection = `
      <div class="danger-zone">
        ${deleteError ? `<div class="auth-error">${deleteError}</div>` : ''}
        <p class="danger-copy">This permanently deletes your account and any saved data, including your calibration baseline. This can't be undone.</p>
        <div class="auth-actions">
          <button class="btn btn-danger" id="confirmDeleteBtn" ${deleteBusy ? 'disabled' : ''}>${deleteBusy ? 'Deleting…' : 'Yes, delete my account'}</button>
          <button class="btn btn-ghost" id="cancelDeleteBtn" ${deleteBusy ? 'disabled' : ''}>Cancel</button>
        </div>
      </div>`;
    } else {
      deleteSection = `<button class="btn-text-danger" id="deleteAccountBtn">Delete account</button>`;
    }

    accountPanel.innerHTML = `
      <div class="auth-card">
        <div class="auth-signed-in-row">
          <div class="auth-avatar">${initials(name)}</div>
          <div>
            <div style="font-weight:600;">${name}</div>
            <div style="color:var(--muted); font-size:12.5px;">${showEmailSecondary ? currentUser.email : 'Signed in'}</div>
          </div>
        </div>
        ${since ? `<div class="member-since">Member since ${since}</div>` : ''}
        <div class="auth-actions">
          <button class="btn btn-ghost" id="logoutBtn" ${authBusy ? 'disabled' : ''}>Log out</button>
          <button class="btn btn-ghost" id="exportDataBtn" ${exportBusy ? 'disabled' : ''}>${exportBusy ? 'Preparing export…' : 'Export my data'}</button>
        </div>
        <div class="auth-note">Session logging isn't built yet, so there's nothing to sync across devices just yet — but your account is ready for when it is.</div>
        <div class="danger-zone-wrap">${deleteSection}</div>
      </div>`;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      authBusy = true; renderSignedIn();
      try{ await auth.signOut(); } catch(e){ console.error(e); }
      authBusy = false;
    });
    document.getElementById('exportDataBtn').addEventListener('click', exportMyData);

    if(needsReauth){
      const cancel = () => { needsReauth = false; confirmingDelete = false; deleteError = ''; renderSignedIn(); };
      document.getElementById('cancelDeleteBtn').addEventListener('click', cancel);
      if(isGoogleAccount){
        document.getElementById('reauthConfirmBtn').addEventListener('click', () => reauthenticateAndDelete());
      } else {
        document.getElementById('reauthForm').addEventListener('submit', (e) => {
          e.preventDefault();
          reauthenticateAndDelete(document.getElementById('reauthPassword').value);
        });
      }
    } else if(confirmingDelete){
      document.getElementById('confirmDeleteBtn').addEventListener('click', performDeleteAccount);
      document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
        confirmingDelete = false; deleteError = ''; renderSignedIn();
      });
    } else {
      document.getElementById('deleteAccountBtn').addEventListener('click', () => {
        confirmingDelete = true; renderSignedIn();
      });
    }
  }

  // Shared frame for every signed-out and onboarding screen, so they cannot drift apart.
  // These screens build markup by string, so any value a person typed has to be escaped
  // on the way in. They are all values the signed-in user entered themselves, so nobody
  // else is at risk — but an address containing a quote would still break the markup.
  function esc(v){
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function authShell(inner, opts){
    const o = opts || {};
    return `
      <div class="auth-split${o.minimal ? ' auth-minimal' : ''}">
        <div class="auth-split-form">
          <div class="auth-brand">
            <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="18" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>
              <path d="M9 12H15" stroke="currentColor" stroke-width="1.6"/>
            </svg>
            <span>Neurova</span>
          </div>
          ${inner}
        </div>
        ${o.minimal ? '' : `<div class="auth-split-art"><img src="login-art.jpg" alt="" decoding="async"></div>`}
      </div>`;
  }


  // "Check your email" — deliberately without the artwork, so the one outstanding action
  // is the only thing on screen.
  function renderLinkSent(){
    accountPanel.innerHTML = authShell(`
      <div class="auth-card auth-card-standalone">
        <h3 class="auth-card-title">Check your email to finish signing in</h3>
        <div class="auth-sent-box">
          <p class="auth-sent-label">We sent a link to</p>
          <p class="auth-sent-email">${esc(pendingEmail)}</p>
        </div>
        <p class="auth-sent-hint">
          It usually arrives within a minute. If you don't see it, check your spam folder —
          look for <span class="mono">${LINK_SENDER_ADDRESS}</span>.
        </p>
        <div class="auth-actions">
          <button type="button" class="btn btn-ghost" id="resendLinkBtn" ${authBusy ? 'disabled' : ''}>
            ${authBusy ? 'Sending…' : 'Resend the link'}
          </button>
        </div>
        <button type="button" class="auth-linkish" id="changeEmailBtn">Change email address</button>
      </div>`, { minimal: true });
    const resend = document.getElementById('resendLinkBtn');
    if(resend) resend.addEventListener('click', async () => {
      authBusy = true; authError = ''; renderAccountPanel();
      try{ await sendSignInLink(pendingEmail); }
      catch(err){ authError = reportAuthError('resendSignInLink', err); }
      authBusy = false; renderAccountPanel();
    });
    document.getElementById('changeEmailBtn').addEventListener('click', () => {
      authFlow = 'credentials';
      authError = '';
      renderAccountPanel();
    });
  }

  // The link was opened somewhere other than where it was requested, so the address it
  // was sent to is not stored here and Firebase needs it back to complete the sign-in.
  function renderConfirmEmail(){
    accountPanel.innerHTML = authShell(`
      <div class="auth-card auth-card-standalone">
        <h3 class="auth-card-title">Confirm your email</h3>
        <p class="auth-sub">You opened the link on a different device. Enter the address you asked for it with.</p>
        ${authErrorBlock()}
        <form id="confirmEmailForm">
          <div class="form-group">
            <label for="confirmEmailInput">Email</label>
            <input type="email" id="confirmEmailInput" autocomplete="email" placeholder="you@example.com" required>
          </div>
          <div class="auth-actions">
            <button type="submit" class="btn btn-primary" ${authBusy ? 'disabled' : ''}>
              ${authBusy ? 'Signing in…' : 'Finish signing in'}
            </button>
          </div>
        </form>
      </div>`, { minimal: true });
    document.getElementById('confirmEmailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Read before re-rendering. Re-rendering replaces the input with a fresh, empty one,
      // so reading afterwards submitted an empty string and Firebase correctly rejected
      // it as not an email — which read as "your address is wrong" when it was fine.
      const email = document.getElementById('confirmEmailInput').value.trim();
      if(!email) return;
      authBusy = true; authError = ''; renderAccountPanel();
      await finishLinkSignIn(email);
      authBusy = false;
      renderAccountPanel();
    });
  }

  // ---------------- onboarding ----------------
  //
  // Only for accounts arriving without a name, which in practice means the email-link
  // route. The password step is genuinely optional: the link is enough to sign in, and a
  // password only exists so the fallback on the sign-in screen has something to accept.
  const ONBOARD_STEPS = 3;

  function onboardDots(){
    let d = '';
    for(let i = 0; i < ONBOARD_STEPS; i++){
      d += `<span class="onboard-dot${i === onboardStep ? ' is-current' : ''}"></span>`;
    }
    return `<div class="onboard-dots">${d}</div>`;
  }

  function onboardFooter(){
    return `<p class="onboard-foot">Signed in as ${esc(currentUser.email)}</p>`;
  }

  function renderOnboarding(){
    if(onboardStep === 0){
      accountPanel.innerHTML = authShell(`
        ${onboardDots()}
        <h2 class="auth-headline">Let's set up your account</h2>
        <p class="auth-tagline">Two quick things, then you're in.</p>
        <div class="auth-card auth-card-standalone">
          <div class="auth-actions">
            <button type="button" class="btn btn-primary" id="onboardNext">Get started</button>
          </div>
        </div>
        ${onboardFooter()}`, { minimal: true });
      document.getElementById('onboardNext').addEventListener('click', () => {
        onboardStep = 1; renderAccountPanel();
      });
      return;
    }

    if(onboardStep === 1){
      accountPanel.innerHTML = authShell(`
        ${onboardDots()}
        <h2 class="auth-headline">Set a password</h2>
        <p class="auth-tagline">Optional — you can always sign in by email link instead.</p>
        ${authErrorBlock()}
        <div class="auth-card auth-card-standalone">
          <form id="onboardPasswordForm">
            <div class="form-group">
              <label for="onboardPassword">Password</label>
              <input type="password" id="onboardPassword" autocomplete="new-password" placeholder="At least 6 characters" minlength="6">
            </div>
            <div class="auth-actions">
              <button type="submit" class="btn btn-primary" ${authBusy ? 'disabled' : ''}>
                ${authBusy ? 'Saving…' : 'Set password'}
              </button>
            </div>
          </form>
          <button type="button" class="auth-linkish" id="onboardSkip">Skip for now</button>
        </div>
        ${onboardFooter()}`, { minimal: true });
      document.getElementById('onboardSkip').addEventListener('click', () => {
        authError = ''; onboardStep = 2; renderAccountPanel();
      });
      document.getElementById('onboardPasswordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = document.getElementById('onboardPassword').value;
        if(!pw){ onboardStep = 2; renderAccountPanel(); return; }
        authBusy = true; authError = ''; renderAccountPanel();
        try{
          await currentUser.updatePassword(pw);
          onboardStep = 2;
        }catch(err){
          authError = reportAuthError('sendSignInLinkToEmail', err);
          // No number of retries fixes a daily quota, so switch to the form that still
          // works instead of leaving them on the one that cannot.
          if(lastAuthErrorCode === 'auth/quota-exceeded'){
            usePasswordFallback = true;
            authMode = hasAccountBefore() ? 'login' : 'signup';
          }
        }
        authBusy = false;
        renderAccountPanel();
      });
      return;
    }

    accountPanel.innerHTML = authShell(`
      ${onboardDots()}
      <h2 class="auth-headline">What's your name?</h2>
      <p class="auth-tagline">Used to label your own sessions — nothing else.</p>
      ${authErrorBlock()}
      <div class="auth-card auth-card-standalone">
        <form id="onboardNameForm">
          <div class="form-group">
            <label for="onboardName">Name</label>
            <input type="text" id="onboardName" autocomplete="name" placeholder="Enter your full name" required>
          </div>
          <div class="auth-actions">
            <button type="submit" class="btn btn-primary" ${authBusy ? 'disabled' : ''}>
              ${authBusy ? 'Finishing…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
      ${onboardFooter()}`, { minimal: true });
    document.getElementById('onboardNameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('onboardName').value.trim();
      if(!name) return;
      authBusy = true; authError = ''; renderAccountPanel();
      try{
        await currentUser.updateProfile({ displayName: name });
        if(db){
          db.collection('users').doc(currentUser.uid).set({
            email: currentUser.email, name: name,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(err => console.error('Profile write failed:', err));
        }
        flushPendingConsent(currentUser.uid);
        currentUser = auth.currentUser;
        onboardStep = 0;
        authBusy = false;
        renderAccountPanel();
        renderDataAuthBanner();
        renderGuestUpsells();
        // Onboarding done — hand them the site.
        if(window.Neurova.goToPage) window.Neurova.goToPage('home');
        return;
      }catch(err){
        authError = reportAuthError('auth', err);
      }
      authBusy = false;
      renderAccountPanel();
    });
  }

  function renderLoggedOutForm(){
    if(!accountPanel) return;

    // Mobile asks for an email and nothing else. Sign-up and sign-in are the same action
    // here — the link either returns you to an account or creates one — so there is no
    // mode to toggle between.
    if(useLinkFlow()){
      accountPanel.innerHTML = authShell(`
        <h2 class="auth-headline">Progress you can see, not just feel</h2>
        <div class="auth-card">
          ${authErrorBlock()}
          <button type="button" class="btn-google" id="googleSignInBtn" ${authBusy ? 'disabled' : ''}>
            ${GOOGLE_ICON_SVG}<span>Continue with Google</span>
          </button>
          <div class="auth-divider">or</div>
          <form id="linkForm">
            <div class="form-group">
              <label for="linkEmail">Email</label>
              <input type="email" id="linkEmail" autocomplete="email" placeholder="Personal or work email" required>
            </div>
            <div class="auth-actions">
              <button type="submit" class="btn btn-primary" ${authBusy ? 'disabled' : ''}>
                ${authBusy ? 'Sending…' : 'Continue with email'}
              </button>
            </div>
          </form>
          <button type="button" class="auth-linkish" id="usePasswordBtn">Use a password instead</button>
          <button type="button" class="auth-linkish" id="guestSignInBtn" ${authBusy ? 'disabled' : ''}>Continue as a guest</button>
        </div>`);
      document.getElementById('guestSignInBtn').addEventListener('click', signInAsGuest);
      // The link screen cannot tell a new account from a returning one -- the same email
      // does both jobs. A browser that has never held an account is treated as a sign-up,
      // which is the same signal routeOnFirstResolve uses to pick its opening mode.
      // Passing the handler directly would hand the click Event in as isSigningUp, and an
      // Event is truthy, so every log-in would raise the dialog too.
      const linkIsSignup = !hasAccountBefore();
      document.getElementById('googleSignInBtn')
        .addEventListener('click', () => signInWithGoogle(linkIsSignup));
      document.getElementById('usePasswordBtn').addEventListener('click', () => {
        usePasswordFallback = true;
        authError = '';
        // The link screen makes no distinction between signing up and signing in, so
        // arriving here from it carries no signal about which was meant. Default to the
        // one that can do both jobs — a new account, with the toggle to log in instead —
        // rather than to the form that cannot create one.
        authMode = hasAccountBefore() ? 'login' : 'signup';
        renderAccountPanel();
      });
      document.getElementById('linkForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('linkEmail').value.trim();
        // Consent before the link is sent, not after it is followed. The link can land in
        // a different browser from the one it was requested in, and a dialog raised there
        // would be asking someone to agree to terms in the middle of an email click.
        if(linkIsSignup){
          const agreed = await requireConsent(e.target.querySelector('button[type="submit"]'));
          if(!agreed) return;
        }
        authBusy = true; authError = ''; renderAccountPanel();
        try{
          await sendSignInLink(email);
          pendingEmail = email;
          authFlow = 'linkSent';
        }catch(err){
          authError = reportAuthError('auth', err);
        }
        authBusy = false;
        renderAccountPanel();
      });
      return;
    }

    const isSignup = authMode === 'signup';
    // Same shell as every other signed-out screen, so the frame cannot drift between
    // them — which is exactly how the brand mark ended up in two slightly different
    // versions.
    accountPanel.innerHTML = authShell(`
        <h2 class="auth-headline">Progress you can see, not just feel</h2>
        <p class="auth-tagline">A personal record of nerve recovery, session by session</p>
      <div class="auth-card">
        <p class="auth-sub">${isSignup ? 'A name, an email, and a password — nothing else is collected.' : 'Log in to the account you set up earlier.'}</p>
        ${authErrorBlock()}
        <button type="button" class="btn-google" id="googleSignInBtn" ${authBusy ? 'disabled' : ''}>
          ${GOOGLE_ICON_SVG}<span>Continue with Google</span>
        </button>
        <div class="auth-divider">or</div>
        <form id="authForm">
          ${isSignup ? `
          <div class="form-group">
            <label for="authName">Name</label>
            <input type="text" id="authName" autocomplete="name" placeholder="Your name" required>
          </div>` : ''}
          <div class="form-group">
            <label for="authEmail">Email</label>
            <input type="email" id="authEmail" autocomplete="email" placeholder="Personal or work email" required>
          </div>
          <div class="form-group">
            <label for="authPassword">Password</label>
            <input type="password" id="authPassword" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="Password" required minlength="6">
          </div>
          <div class="auth-actions">
            <button type="submit" class="btn btn-primary" id="authSubmitBtn" ${authBusy ? 'disabled' : ''}>
              ${authBusy ? 'Please wait…' : (isSignup ? 'Create account' : 'Log in')}
            </button>
          </div>
        </form>
        <div class="auth-toggle">
          ${isSignup
            ? `Already have an account? <a id="authToggle">Log in</a>`
            : `Don't have an account yet? <a id="authToggle">Create one</a>`}
        </div>
        ${(PASSWORDLESS_SIGNIN_ENABLED && isMobileLayout()) ? `
        <button type="button" class="auth-linkish" id="useLinkBtn">Use an email link instead</button>` : ''}
        <button type="button" class="auth-linkish" id="guestSignInBtn" ${authBusy ? 'disabled' : ''}>Continue as a guest</button>
      </div>`);

    document.getElementById('guestSignInBtn').addEventListener('click', signInAsGuest);

    // Without this the password form is a dead end: the button that got you here only
    // exists on the link screen, so there was no way back to the passwordless flow.
    const backToLink = document.getElementById('useLinkBtn');
    if(backToLink) backToLink.addEventListener('click', () => {
      usePasswordFallback = false; authError = ''; renderAccountPanel();
    });

    document.getElementById('authToggle').addEventListener('click', () => {
      authMode = isSignup ? 'login' : 'signup';
      authError = '';
      renderLoggedOutForm();
    });

    document.getElementById('googleSignInBtn')
      .addEventListener('click', () => signInWithGoogle(isSignup));

    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = isSignup ? document.getElementById('authName').value.trim() : '';
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;

      // Raised here rather than on the button, so the browser's own required-field and
      // email-format validation has already run. Being asked to accept terms and only
      // then told the password is too short would be the wrong order.
      if(isSignup){
        const agreed = await requireConsent(document.getElementById('authSubmitBtn'));
        if(!agreed) return;
      }

      authError = '';
      authBusy = true;
      renderLoggedOutForm();
      try{
        if(isSignup){
          const cred = await auth.createUserWithEmailAndPassword(email, password);
          if(cred.user){
            try{ await cred.user.updateProfile({ displayName: name }); } catch(e){ console.error('Profile name update failed:', e); }
            currentUser = auth.currentUser;
            if(db){
              db.collection('users').doc(cred.user.uid).set({
                email: cred.user.email,
                name: name,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                termsVersion: TERMS_VERSION,
                privacyVersion: PRIVACY_VERSION,
                termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true }).catch(err => console.error('Profile write failed:', err));
            }
            renderAccountPanel();
            renderDataAuthBanner();
            renderGuestUpsells();
          }
        } else {
          await auth.signInWithEmailAndPassword(email, password);
        }
        // onAuthStateChanged also re-renders on success; harmless if it fires again
      } catch(err){
        authBusy = false;
        authError = reportAuthError('auth', err);
        renderLoggedOutForm();
      }
    });
  }

  function renderAccountPanel(){
    if(!accountPanel) return;
    // Drives the full-screen treatment. Onboarding counts too — it is still part of
    // getting in, so the site chrome stays out of the way until it is finished.
    const takeover = !!firebaseReady && (!currentUser || needsOnboarding());
    document.body.classList.toggle('auth-fullscreen', takeover);
    if(!firebaseReady) return renderNotConfigured();
    if(isGuest()) return renderGuest();
    if(currentUser) return needsOnboarding() ? renderOnboarding() : renderSignedIn();
    if(authFlow === 'linkSent') return renderLinkSent();
    if(authFlow === 'confirmEmail') return renderConfirmEmail();
    return renderLoggedOutForm();
  }

  // ---------------- guest upsell ----------------
  //
  // Driven from the markup rather than from a list in here: any element carrying
  // data-upsell becomes a prompt, with the attribute's value as the sentence. Adding one
  // to a new page is then a line of HTML, and the wording for each page lives next to the
  // thing it is talking about.
  //
  // Anyone without a real account: guests and signed-out visitors alike, since both can
  // browse the whole site. Someone who already has an account never sees these -- a
  // prompt shown to a person who has already done the thing is how a prompt becomes
  // wallpaper.
  function renderGuestUpsells(){
    const slots = document.querySelectorAll('[data-upsell]');
    if(!slots.length) return;
    const guest = isGuest();
    const show = firebaseReady && (guest || !currentUser);
    const lead = guest ? "You're a guest." : "You're not signed in.";
    slots.forEach(slot => {
      if(!show){ slot.innerHTML = ''; return; }
      // The two states are not the same and must not claim to be: a guest's results are
      // saved to an anonymous account, a signed-out visitor's are not saved at all.
      // data-upsell-out carries the signed-out wording where that distinction matters.
      const msg = (!guest && slot.getAttribute('data-upsell-out'))
        || slot.getAttribute('data-upsell') || '';
      const soft = slot.hasAttribute('data-upsell-soft') ? ' is-soft' : '';
      slot.innerHTML = `<div class="upsell${soft}"><span><strong>${lead}</strong> ${msg}</span><a role="button" tabindex="0">Create an account</a></div>`;
      const link = slot.querySelector('a');
      if(!link) return;
      const go = (e) => {
        e.preventDefault();
        if(window.Neurova.goToPage) window.Neurova.goToPage('account');
      };
      link.addEventListener('click', go);
      link.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') go(e); });
    });
  }

  function renderDataAuthBanner(){
    if(!dataAuthBanner) return;
    if(!firebaseReady){ dataAuthBanner.innerHTML = ''; return; }
    if(isGuest()){
      // Worth its own line rather than "Signed in as Guest": a guest's data does not
      // follow them anywhere, which is the thing they need to know on a page about
      // history.
      dataAuthBanner.innerHTML = `<div class="data-auth-banner"><span>Browsing as a guest — this history lives in this browser only. It won't follow you to another device, and clearing your browser erases it for good.</span><a href="#account" data-nav="account">Create an account</a></div>`;
      const gLink = dataAuthBanner.querySelector('a[data-nav]');
      if(gLink) gLink.addEventListener('click', (e) => {
        e.preventDefault();
        if(window.Neurova.goToPage) window.Neurova.goToPage('account');
      });
    } else if(currentUser){
      dataAuthBanner.innerHTML = `<div class="data-auth-banner"><span>Signed in as <b style="color:var(--ink);">${displayNameOf(currentUser)}</b> — real sessions will sync here once session logging is built.</span></div>`;
    } else {
      dataAuthBanner.innerHTML = `<div class="data-auth-banner"><span>You're not signed in — this sample data is local to this browser only.</span><a href="#account" data-nav="account">Log in</a></div>`;
      const link = dataAuthBanner.querySelector('a[data-nav]');
      if(link) link.addEventListener('click', (e) => {
        e.preventDefault();
        const navLink = document.querySelector('.topnav a[data-nav="account"], .mobile-nav-panel a[data-nav="account"]');
        if(navLink) navLink.click();
      });
    }
  }

  if(firebaseReady && auth){
    auth.onAuthStateChanged(user => {
      const previousUid = currentUser ? currentUser.uid : null;
      currentUser = user;
      const newUid = user ? user.uid : null;
      if(!user){ authFlow = 'credentials'; usePasswordFallback = false; onboardStep = 0; authMode = 'login'; confirmingDelete = false; deleteError = ''; needsReauth = false; cachedProfile = null; calibLoadFailed = false; }
      authError = '';
      authBusy = false;
      renderAccountPanel();
      renderDataAuthBanner();
      renderGuestUpsells();
      if(window.Neurova.onAccountChange) window.Neurova.onAccountChange();
      // See resetCalibration's comment: only the "was a guest, now signing into a
      // brand-new account" transition gets to keep a just-measured baseline.
      const guestToNewAccount = (previousUid === null) && (newUid !== null);
      if(window.Neurova.resetCalibration) window.Neurova.resetCalibration(guestToNewAccount);
      // Signing in or out changes whose history the Data page should be showing.
      if(window.Neurova.refreshDataPage) window.Neurova.refreshDataPage();
      if(user) loadSavedCalibrationForCurrentUser();

      // Until Firebase answers, "no user" and "not asked yet" are the same thing, so
      // the gate stays open and the document stays hidden behind .auth-pending. From
      // here a missing user really does mean signed out.
      window.Neurova.authSettled = true;

      if(!initialAuthResolved){
        initialAuthResolved = true;
        // Arriving on a sign-in link takes priority: it is already a destination, and
        // routing the visitor to the sign-in page would throw the code away.
        completeEmailLinkSignIn().then(handled => {
          if(handled){ revealSite(); return; }
          routeOnFirstResolve(user);
        }).catch(() => routeOnFirstResolve(user));
      } else if(user){
        if(!user.isAnonymous) rememberHasAccount();
        // They only landed on this page because they were signed out. Now that they are
        // not, finish the journey the gate interrupted -- back to the page they actually
        // asked for, or Home if they came in through the front door.
        if(sentToSignIn){
          sentToSignIn = false;
          const dest = window.Neurova.takeDestination ? window.Neurova.takeDestination() : null;
          if(window.Neurova.goToPage) window.Neurova.goToPage(dest || 'home');
        }
      } else {
        // Signed out part-way through. Re-run the current route so the gate closes
        // behind them instead of leaving the last signed-in page on screen.
        if(window.Neurova.goToPage) window.Neurova.goToPage((location.hash || '#home').slice(1));
      }
    });
  } else {
    renderAccountPanel();
    renderDataAuthBanner();
    renderGuestUpsells();
    revealSite();
  }

  // ---------------- contact form ----------------
  // Lives in this IIFE because it needs db, withTimeout and NETWORK_TIMEOUT_MS, which
  // are all scoped here. Writes to a top-level 'messages' collection, not under a user,
  // because the whole point is that someone without an account can reach us.
  // Public by design -- it identifies the form, not the inbox. The destination address
  // lives in the Web3Forms dashboard, so it can be changed without touching this file,
  // and there is still no address on the page for a scraper to take.
  const WEB3FORMS_KEY = 'a970554d-9d63-47de-8dac-36da1bac54e0';

  async function emailContactMessage(name, email, message){
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      // Deliberately no subject or from_name here. Web3Forms lets the request override
      // the dashboard, so sending them from code silently wins over whatever is set
      // under Email Configuration and makes those fields look broken. Leaving them out
      // keeps the subject and sender name editable in the dashboard, with no deploy.
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        name: name,
        email: email,
        message: message
      })
    });
    // A 200 with success:false is still a failure -- the key could be wrong or the
    // monthly quota spent, and neither shows up as a bad status code.
    const data = await res.json().catch(() => ({}));
    if(!res.ok || data.success === false) throw new Error(data.message || ('HTTP ' + res.status));
    return data;
  }

  const contactForm = document.getElementById('contactForm');
  if(contactForm){
    const nameEl = document.getElementById('contactName');
    const emailEl = document.getElementById('contactEmail');
    const msgEl = document.getElementById('contactMessage');
    const trapEl = document.getElementById('contactCompany');
    const statusEl = document.getElementById('contactStatus');
    const submitBtn = document.getElementById('contactSubmit');
    let sending = false;

    function setStatus(text, kind){
      statusEl.textContent = text || '';
      statusEl.className = 'contact-status' + (kind ? ' is-' + kind : '');
    }
    function fail(text, el){
      setStatus(text, 'err');
      if(el) el.focus();
    }

    // Clear the error as soon as they start fixing it, so it does not sit there
    // contradicting what is now in the field.
    [nameEl, emailEl, msgEl].forEach(el => {
      el.addEventListener('input', () => {
        if(statusEl.classList.contains('is-err')) setStatus('');
      });
    });

    contactForm.addEventListener('submit', async e => {
      e.preventDefault();
      if(sending) return;

      // Filled only by a script. Report success and drop it -- telling a bot it failed
      // just invites it to retry with the field left blank.
      if(trapEl.value){
        contactForm.reset();
        setStatus('Sent. I read these myself and will reply to the address you gave.', 'ok');
        return;
      }

      const name = nameEl.value.trim();
      const email = emailEl.value.trim();
      const message = msgEl.value.trim();

      if(!name) return fail('Add your name, so I know who this is from.', nameEl);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email address does not look right, and a reply would not reach you.', emailEl);
      if(message.length < 10) return fail('Add a bit more than that — a sentence or two is plenty.', msgEl);
      sending = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      setStatus('');

      // Two independent routes, tried together rather than one after the other.
      // Firestore is the durable copy -- it survives a spent email quota or an outage
      // at Web3Forms. The email is the part that actually gets noticed. Either one
      // landing means the message is not lost, so this only reports failure when both
      // fail. Running them in parallel also means one slow route cannot delay the other.
      const store = db
        ? withTimeout(db.collection('messages').add({
            name: name,
            email: email,
            message: message,
            at: firebase.firestore.FieldValue.serverTimestamp()
          }), NETWORK_TIMEOUT_MS)
        : Promise.reject(new Error('Firestore unavailable'));
      const mail = withTimeout(emailContactMessage(name, email, message), NETWORK_TIMEOUT_MS);

      const [storeResult, mailResult] = await Promise.allSettled([store, mail]);
      if(storeResult.status === 'rejected') console.error('Contact message not saved:', storeResult.reason);
      if(mailResult.status === 'rejected') console.error('Contact message not emailed:', mailResult.reason);

      if(storeResult.status === 'rejected' && mailResult.status === 'rejected'){
        setStatus('That did not send. Check your connection and try again.', 'err');
      } else {
        contactForm.reset();
        setStatus('Sent. I read these myself and will reply to the address you gave.', 'ok');
      }

      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send message';
    });
  }
})();

// ---------------- remember a manually-chosen desktop/mobile version ----------------
function setNeurovaVersion(v){
  try{ localStorage.setItem('neurovaSiteVersion', v); }catch(e){ /* storage unavailable, link still navigates */ }
}
