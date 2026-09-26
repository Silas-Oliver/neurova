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
      // Opening the port resets the board, and the bootloader eats anything sent during
      // the first second or so — so ask once the sketch is actually running. The board
      // also announces its status on boot; either answer is handled the same way.
      setTimeout(() => { if(writer) sendCommand('STATUS').catch(()=>{}); }, 2000);
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
    emgStreamingActive = false;  // the board can't hear STOP anymore; just stop tracking it as running
    setConnectedUI(false);
    // Nothing can be tested without a board, and on the next connect the board tells us
    // its baseline again — so don't leave the tests looking open.
    boardBaseline = null;
    setTestUnlocked(false);
    renderCalibScreen();
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

  // Matches "EMG_LIVE:873" — a single raw ADC reading from the streaming EMG command.
  function parseEmgLive(line){
    const m = line.match(/^EMG_LIVE:(\d+)/i);
    if(!m) return null;
    return parseInt(m[1], 10);
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
  let savedAccountCalib = null;
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
  // An excursion is over once the signal has fallen most of the way back toward rest.
  // Judging the end by how far it has come down, rather than by a fixed timer, means one
  // contraction marks once whether it lasts half a second or five, and two genuine
  // contractions never merge just because they happened close together.
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
  let emgSampleCount = 0;        // drives the scrolling gridlines, so a flat trace still reads as live
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

  function feedEmgSample(raw){
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
      const returnLevel = emgBaselineMean + (EMG_EVENT_END_FRACTION * (emgEventPeak - emgBaselineMean));
      if(emgDetectValue <= returnLevel) emgInEvent = false;
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
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // The panel's CSS grid is static, which made a resting trace indistinguishable from a
    // frozen one. The canvas paints its own copy of that grid instead — same 22px pitch
    // and weight, so it reads as continuous with the panel — but scrolls the vertical
    // lines with the data. A flat signal then still visibly flows.
    const GRID = 22;
    ctx.fillStyle = '#132622';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for(let y = GRID; y < h; y += GRID){
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
    }
    const pxPerSample = w / (EMG_PLOT_MAX_POINTS - 1);
    const scrollOffset = (emgSampleCount * pxPerSample) % GRID;
    for(let x = -scrollOffset; x < w; x += GRID){
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke();
    }

    let minV, maxV;
    if(emgPhase === 'live' && emgYAxisMin !== null && emgYAxisMax !== null){
      minV = emgYAxisMin;
      maxV = emgYAxisMax;
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
    if(emgPhase === 'live' && emgBaselineMean !== null){
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(234,246,241,0.55)';
      ctx.lineWidth = 1;
      const baselineY = toY(emgBaselineMean);
      ctx.moveTo(0, baselineY);
      ctx.lineTo(w, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);
    }


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
    } else if(user){
      el.innerHTML = '';
    } else {
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
    setTestUnlocked(true);
    renderCalibScreen();
  }

  // Hands the account's remembered baseline to the board, but only when the board is
  // connected and doesn't already have one of its own.
  function maybePushSavedBaseline(){
    if(!port || !writer) return;
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

  function finishCalibration(result){
    clearTimeout(calibTimeoutId);
    clearInterval(calibProgressTimer);
    setCalibProgress(1);
    calibrating = false;

    if(result.ok && result.baseline !== null){
      boardBaseline = { ohms: result.baseline, source: 'measured' };
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
      else if(appState === 'EMG_DEBUG'){ stopEmgStreamIfActive(); goTo('MENU'); }
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
      const previousUid = currentUser ? currentUser.uid : null;
      currentUser = user;
      const newUid = user ? user.uid : null;
      if(!user){ authMode = 'login'; confirmingDelete = false; deleteError = ''; needsReauth = false; cachedProfile = null; calibLoadFailed = false; }
      authError = '';
      authBusy = false;
      renderAccountPanel();
      renderDataAuthBanner();
      if(window.Neurova.onAccountChange) window.Neurova.onAccountChange();
      // See resetCalibration's comment: only the "was a guest, now signing into a
      // brand-new account" transition gets to keep a just-measured baseline.
      const guestToNewAccount = (previousUid === null) && (newUid !== null);
      if(window.Neurova.resetCalibration) window.Neurova.resetCalibration(guestToNewAccount);
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
