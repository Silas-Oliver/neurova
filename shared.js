window.Neurova = window.Neurova || {};

(function(){
  // ---------------- page routing ----------------
  const PAGES = ['home', 'test-menu', 'data', 'specs', 'account'];
  let dataChartReady = false;
  let sessionNum = 0;
  let contactSeries = [];
  let signalSeries = [];
  let animFrame = null;
  const SAMPLE_SESSIONS = [
    { contact: 62, signal: 30 },
    { contact: 68, signal: 34 },
    { contact: 71, signal: 38 },
    { contact: 75, signal: 41 },
    { contact: 79, signal: 47 },
    { contact: 83, signal: 52 },
    { contact: 88, signal: 58 }
  ];
  const CHART = { padLeft: 46, padRight: 24, padTop: 16, padBottom: 30, pointGap: 68, height: 240 };

  function showPage(name){
    if(!PAGES.includes(name)) name = 'home';
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('page-active', p.dataset.page === name));
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
    window.scrollTo(0, 0);
    history.replaceState(null, '', '#' + name);
    if(name === 'data' && !dataChartReady){
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

  showPage((location.hash || '#home').slice(1));

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

  // ---------------- clock ----------------
  function tickClock(){
    document.getElementById('scopeClock').textContent = new Date().toLocaleTimeString('en-GB');
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------------- serial support check ----------------
  const serialSupported = 'serial' in navigator;
  if(!serialSupported){
    document.getElementById('unsupportedNotice').style.display = 'block';
  }

  let port = null;
  let writer = null;
  let reader = null;
  let readableClosed = null;
  let keepReading = false;

  const topStatusDot = document.getElementById('topStatusDot');
  const topStatusText = document.getElementById('topStatusText');
  const panelStatusDot = document.getElementById('panelStatusDot');
  const panelStatusText = document.getElementById('panelStatusText');
  const panelStateLabel = document.getElementById('panelStateLabel');
  const enterMenuBtn = document.getElementById('enterMenuBtn');
  const heroConnectBtn = document.getElementById('heroConnectBtn');
  const panelConnectBtn = document.getElementById('panelConnectBtn');
  const baudSelect = document.getElementById('baudSelect');

  function setConnectedUI(connected){
    [topStatusDot, panelStatusDot].forEach(d => d.classList.toggle('on', connected));
    topStatusText.textContent = connected ? 'Board connected' : 'No device connected';
    panelStatusText.textContent = connected ? 'Connected' : 'Not connected';
    enterMenuBtn.disabled = !connected;
    heroConnectBtn.textContent = connected ? 'Board connected' : 'Connect the board';
    heroConnectBtn.disabled = connected;
    panelConnectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  }
  setConnectedUI(false);

  async function connectSerial(){
    if(!serialSupported){
      alert('This browser doesn\'t support Web Serial. Try Chrome or Edge on desktop.');
      return;
    }
    try{
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: parseInt(baudSelect.value, 10) });
      writer = port.writable.getWriter();
      setConnectedUI(true);
      startReadLoop();
    }catch(err){
      if(err && err.name !== 'NotFoundError'){
        console.error(err);
        alert('Could not connect: ' + err.message + (err.message && err.message.toLowerCase().includes('open') ? '\n\nThis usually means something else has the port — close the Arduino IDE\'s Serial Monitor/Plotter, close other tabs using this port, or unplug and replug the board, then try again.' : ''));
      }
    }
  }

  async function disconnectSerial(){
    keepReading = false;
    try{ if(reader){ await reader.cancel(); } }catch(e){}
    try{ if(writer){ writer.releaseLock(); } }catch(e){}
    try{ if(readableClosed){ await readableClosed.catch(()=>{}); } }catch(e){}
    try{ if(port){ await port.close(); } }catch(e){}
    port = null; writer = null; reader = null;
    setConnectedUI(false);
  }

  async function toggleConnection(){
    if(port){ await disconnectSerial(); }
    else{ await connectSerial(); }
  }

  heroConnectBtn.addEventListener('click', connectSerial);
  panelConnectBtn.addEventListener('click', toggleConnection);

  async function sendCommand(cmd){
    if(!writer){
      alert('Connect the board first.');
      return false;
    }
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(cmd + '\n'));
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

  function handleIncomingLine(line){
    line = line.trim();
    if(!line) return;

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
  const SAMPLE_WINDOW_MS = 2500; // matches the Arduino's own ~3s sampling loop, just for the progress ring

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

  function setVerdict(text, kind, summary){
    const el = document.getElementById('verdictText');
    el.textContent = text;
    el.style.setProperty('--accent', kind === 'good' ? 'var(--good)' : kind === 'warn' ? 'var(--warn)' : kind === 'bad' ? 'var(--bad)' : 'var(--muted)');
    document.getElementById('summaryText').textContent = summary || '';
  }

  function setCalibStatus(text, kind, summary){
    const el = document.getElementById('calibStatusText');
    el.textContent = text;
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
    setCalibStatus('Idle', 'muted', 'Run calibration to capture a baseline.');
    setCalibProgress(0);
    setResultIcon('calibIcon', 'muted', false);
    document.getElementById('calibLiveValue').textContent = '—';
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
    } else if(user){
      el.innerHTML = '';
    } else {
      el.innerHTML = `<div class="calib-auth-note">Not signed in — this baseline will be forgotten if you close this tab. <a href="#account" data-nav="account" id="calibAuthNoteLink">Log in to save it</a>.</div>`;
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

  window.Neurova.applySavedCalibration = function(data){
    if(!data || typeof data.calibrationBaseline !== 'number') return;
    setCalibLiveValue(data.calibrationBaseline);
    setResultIcon('calibIcon', 'good', false);
    setCalibStatus('Calibrated', 'good', 'Baseline: ' + (Math.round(data.calibrationBaseline * 100) / 100) + ' Ω — loaded from your account. Recalibrate anytime for a fresh reading.');
    setTestUnlocked(true);
  };

  // Wipes the calibration screen back to a clean, un-calibrated state — used whenever
  // the signed-in account changes (login, logout, or switching accounts), so a previous
  // account's baseline can never linger on screen or leave the contact test unlocked
  // for someone it doesn't belong to.
  window.Neurova.resetCalibration = function(){
    document.getElementById('calibLiveValue').textContent = '—';
    setResultIcon('calibIcon', 'muted', false);
    setCalibProgress(0);
    setCalibStatus('Idle', 'muted', 'Run calibration to capture a baseline.');
    setTestUnlocked(false);
  };

  function finishCalibration(result){
    clearTimeout(calibTimeoutId);
    clearInterval(calibProgressTimer);
    setCalibProgress(1);
    calibrating = false;

    if(result.ok && result.baseline !== null){
      setCalibLiveValue(result.baseline);
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
    } else if(e.code === 'Space'){
      if(appState === 'CALIBRATE' || appState === 'CONTACT_TEST'){
        e.preventDefault();
        if(appState === 'CALIBRATE') document.getElementById('runCalibrateBtn').click();
        else document.getElementById('runTestBtn').click();
      }
    }
  });

  // ---------------- data page: sample/simulated chart (pure SVG, no external libs) ----------------

  function clamp(v){ return Math.max(0, Math.min(100, v)); }
  function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

  function appendDataLogRow(n, contact, signal, simulated){
    const el = document.getElementById('dataLog');
    const row = document.createElement('div');
    row.className = 'log-row';
    const tag = simulated ? '[simulated]' : '[sample]';
    row.textContent = `Session ${n}  ${tag}  contact ${contact}  signal ${signal}`;
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;
  }

  function xFor(i){ return CHART.padLeft + i * CHART.pointGap; }
  function yFor(v){ return CHART.padTop + (100 - v) / 100 * (CHART.height - CHART.padTop - CHART.padBottom); }

  // Renders the chart showing the first `revealCount` points fully, blended toward
  // the next point by `frac` (0..1) — this one function drives both the initial
  // left-to-right draw-in and each new-point extension, just with different ranges.
  function renderChart(revealCount, frac){
    const svg = document.getElementById('dataChartSvg');
    const n = contactSeries.length;
    if(n === 0){ svg.innerHTML = ''; return; }

    const width = CHART.padLeft + (n - 1) * CHART.pointGap + CHART.padRight;
    svg.setAttribute('viewBox', `0 0 ${Math.max(width, 260)} ${CHART.height}`);
    svg.setAttribute('width', Math.max(width, 260));
    svg.setAttribute('height', CHART.height);

    const shownFull = Math.min(revealCount, n - 1);
    const hasPartial = frac > 0 && shownFull < n - 1;

    function seriesPoints(series){
      const pts = [];
      for(let i = 0; i <= shownFull; i++) pts.push([xFor(i), yFor(series[i])]);
      if(hasPartial){
        const a = series[shownFull], b = series[shownFull + 1];
        const v = a + (b - a) * frac;
        pts.push([xFor(shownFull + frac), yFor(v)]);
      }
      return pts;
    }

    function pathD(pts){
      return pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    }

    function gridAndAxes(){
      let s = '';
      [0, 25, 50, 75, 100].forEach(v => {
        const y = yFor(v);
        s += `<line x1="${CHART.padLeft}" y1="${y}" x2="${width - CHART.padRight}" y2="${y}" stroke="#e3e9e6" stroke-width="1"/>`;
        s += `<text x="${CHART.padLeft - 10}" y="${y + 3}" text-anchor="end" font-family="IBM Plex Mono" font-size="10" fill="#8fa39d">${v}</text>`;
      });
      for(let i = 0; i < n; i++){
        s += `<text x="${xFor(i)}" y="${CHART.height - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="10" fill="#8fa39d">S${i + 1}</text>`;
      }
      return s;
    }

    function circles(pts, color, upToFull){
      let s = '';
      for(let i = 0; i <= upToFull; i++){
        s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.4" fill="${color}"/>`;
      }
      return s;
    }

    const contactPts = seriesPoints(contactSeries);
    const signalPts = seriesPoints(signalSeries);

    svg.innerHTML =
      gridAndAxes() +
      `<path d="${pathD(contactPts)}" fill="none" stroke="var(--good)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${pathD(signalPts)}" fill="none" stroke="var(--warn)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
      circles(contactPts, 'var(--good)', shownFull) +
      circles(signalPts, 'var(--warn)', shownFull);
  }

  // Animates the reveal from `fromCount` points to `toCount` points, sweeping
  // smoothly across every segment in between.
  function animateReveal(fromCount, toCount, duration){
    if(animFrame) cancelAnimationFrame(animFrame);
    const start = performance.now();
    const span = toCount - fromCount;
    function frame(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(t);
      const current = fromCount + span * eased;
      renderChart(Math.floor(current), current - Math.floor(current));
      if(t < 1){
        animFrame = requestAnimationFrame(frame);
      } else {
        renderChart(toCount, 0);
        const scroller = document.getElementById('chartScroll');
        scroller.scrollLeft = scroller.scrollWidth;
      }
    }
    animFrame = requestAnimationFrame(frame);
  }

  function loadSampleData(){
    document.getElementById('dataLog').innerHTML = '';
    sessionNum = 0;
    contactSeries = [];
    signalSeries = [];
    SAMPLE_SESSIONS.forEach(s => {
      sessionNum += 1;
      contactSeries.push(s.contact);
      signalSeries.push(s.signal);
      appendDataLogRow(sessionNum, s.contact, s.signal, false);
    });
  }

  function initDataChart(){
    loadSampleData();
    renderChart(0, 0);
    animateReveal(0, contactSeries.length - 1, 900);
  }

  document.getElementById('addSessionBtn').addEventListener('click', () => {
    if(contactSeries.length === 0) return;
    const prevCount = contactSeries.length - 1;
    sessionNum += 1;
    const lastContact = contactSeries[contactSeries.length - 1];
    const lastSignal = signalSeries[signalSeries.length - 1];
    // simulate a mostly-improving trend with some natural noise
    const newContact = clamp(Math.round(lastContact + (Math.random() * 8 - 2)));
    const newSignal = clamp(Math.round(lastSignal + (Math.random() * 7 - 1)));
    contactSeries.push(newContact);
    signalSeries.push(newSignal);
    appendDataLogRow(sessionNum, newContact, newSignal, true);
    animateReveal(prevCount, contactSeries.length - 1, 550);
  });

  document.getElementById('resetDataBtn').addEventListener('click', () => {
    loadSampleData();
    renderChart(0, 0);
    animateReveal(0, contactSeries.length - 1, 900);
  });

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
      'neurova/timeout': "That's taking much longer than it should — check your connection and try again."
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  function initials(name){
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function displayNameOf(user){
    return (user && user.displayName) ? user.displayName : (user ? user.email : '');
  }

  const GOOGLE_ICON_SVG = `<svg viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.617z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>`;

  async function signInWithGoogle(){
    authError = '';
    authBusy = true;
    renderAccountPanel();
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      if(db && result.user){
        db.collection('users').doc(result.user.uid).set({
          email: result.user.email,
          name: result.user.displayName || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error('Profile write failed:', err));
      }
      // onAuthStateChanged will re-render on success
    } catch(err){
      authBusy = false;
      authError = friendlyAuthError(err.code);
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

  function buildExportBlob(){
    const exportObj = {
      email: currentUser.email,
      name: currentUser.displayName || (cachedProfile && cachedProfile.name) || null,
      memberSince: memberSinceText() || null,
      calibrationBaselineOhms: (cachedProfile && typeof cachedProfile.calibrationBaseline === 'number') ? cachedProfile.calibrationBaseline : null,
      exportedAt: new Date().toISOString()
    };
    return new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  }

  function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportMyData(){
    // Common case: we already have a cached profile (login always fetches one), so this
    // is fully synchronous and the download fires in the same tick as the click.
    if(cachedProfile !== null){
      triggerDownload(buildExportBlob(), 'neurova-account-data.json');
      return;
    }
    // Rare fallback: nothing cached yet (e.g. clicked right after login before the
    // background fetch resolved) — fetch once, cache it, then download.
    const btn = document.getElementById('exportDataBtn');
    exportBusy = true;
    if(btn){ btn.disabled = true; btn.textContent = 'Preparing export…'; }
    try{
      if(db && currentUser){
        const snap = await db.collection('users').doc(currentUser.uid).get();
        cachedProfile = snap.exists ? snap.data() : {};
      } else {
        cachedProfile = {};
      }
      triggerDownload(buildExportBlob(), 'neurova-account-data.json');
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

  async function deleteAccountData(){
    if(db && currentUser){
      try{ await withTimeout(db.collection('users').doc(currentUser.uid).delete(), NETWORK_TIMEOUT_MS); }
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

  function renderLoggedOutForm(){
    if(!accountPanel) return;
    const isSignup = authMode === 'signup';
    accountPanel.innerHTML = `
      <div class="auth-card">
        <h3>${isSignup ? 'Create an account' : 'Log in'}</h3>
        <p class="auth-sub">${isSignup ? 'A name, an email, and a password — nothing else is collected.' : 'Log in to the account you set up earlier.'}</p>
        ${authError ? `<div class="auth-error">${authError}</div>` : ''}
        <button type="button" class="btn-google" id="googleSignInBtn" ${authBusy ? 'disabled' : ''}>
          ${GOOGLE_ICON_SVG}<span>Continue with Google</span>
        </button>
        <div class="auth-divider">or</div>
        <form id="authForm">
          ${isSignup ? `
          <div class="form-group">
            <label for="authName">Name</label>
            <input type="text" id="authName" autocomplete="name" required>
          </div>` : ''}
          <div class="form-group">
            <label for="authEmail">Email</label>
            <input type="email" id="authEmail" autocomplete="email" required>
          </div>
          <div class="form-group">
            <label for="authPassword">Password</label>
            <input type="password" id="authPassword" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required minlength="6">
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
      </div>`;

    document.getElementById('authToggle').addEventListener('click', () => {
      authMode = isSignup ? 'login' : 'signup';
      authError = '';
      renderLoggedOutForm();
    });

    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);

    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = isSignup ? document.getElementById('authName').value.trim() : '';
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
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
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true }).catch(err => console.error('Profile write failed:', err));
            }
            renderAccountPanel();
            renderDataAuthBanner();
          }
        } else {
          await auth.signInWithEmailAndPassword(email, password);
        }
        // onAuthStateChanged also re-renders on success; harmless if it fires again
      } catch(err){
        authBusy = false;
        authError = friendlyAuthError(err.code);
        renderLoggedOutForm();
      }
    });
  }

  function renderAccountPanel(){
    if(!accountPanel) return;
    if(!firebaseReady) return renderNotConfigured();
    if(currentUser) return renderSignedIn();
    return renderLoggedOutForm();
  }

  function renderDataAuthBanner(){
    if(!dataAuthBanner) return;
    if(!firebaseReady){ dataAuthBanner.innerHTML = ''; return; }
    if(currentUser){
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
      currentUser = user;
      if(!user){ authMode = 'login'; confirmingDelete = false; deleteError = ''; needsReauth = false; cachedProfile = null; calibLoadFailed = false; }
      authError = '';
      authBusy = false;
      renderAccountPanel();
      renderDataAuthBanner();
      if(window.Neurova.onAccountChange) window.Neurova.onAccountChange();
      if(window.Neurova.resetCalibration) window.Neurova.resetCalibration();
      if(user) loadSavedCalibrationForCurrentUser();
    });
  } else {
    renderAccountPanel();
    renderDataAuthBanner();
  }
})();

// ---------------- remember a manually-chosen desktop/mobile version ----------------
function setNeurovaVersion(v){
  try{ localStorage.setItem('neurovaSiteVersion', v); }catch(e){ /* storage unavailable, link still navigates */ }
}
