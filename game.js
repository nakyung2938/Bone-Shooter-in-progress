(() => {
  'use strict';

  const {
    Game,
    layoutFor,
    screenToGame,
    CONFIG
  } = window.BonGame;
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'),
    arena = $('gameArena'),
    hud = $('hud');
  const assets = {};
  const paths = ['background', 'bonjuk_bowl', ...window.BonGame.MEALS, 'heart', ...['gray', 'white', 'blue'].flatMap(color => [`human_${color}`, ...['front', 'side_a', 'side_b'].map(side => `zombie_${color}_${side}`)])];
  const game = new Game(layoutFor(390, 780));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new window.BonRenderer(canvas, assets, reducedMotion);
  const aim = {
    active: false,
    pointerId: null,
    clientX: 0,
    clientY: 0,
    point: {
      x: 0,
      y: 0
    }
  };
  let lastFrame = performance.now(),
    lastDpr = 0,
    assetsReady = false,
    loadPromise = null,
    audio = null,
    soundEnabled = true;
  let lastScore = -1,
    lastLives = -1,
    lastSecond = -1;
  const helpDialog = $('helpDialog');
  let helpSeen = false;
  let helpAction = 'dismiss';
  let helpReturnStatus = 'ready';
  let helpReturnFocus = null;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    const next = layoutFor(rect.width, rect.height, hud.getBoundingClientRect().height);
    const old = game.layout;
    const changed = next.width !== old.width || next.height !== old.height || next.fieldTop !== old.fieldTop || next.mode !== old.mode;
    if (changed) {
      game.resize(next);
      renderer.remap(old, next);
    }
    const width = Math.round(rect.width * dpr),
      height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    lastDpr = dpr;
    renderer.resize(game.layout);
    arena.dataset.layout = game.layout.mode;
    if (aim.active) {
      aim.point = screenToGame(aim.clientX, aim.clientY, rect, game.layout);
      updateHeldFire();
    }
    renderer.draw(game, aim);
  }
  new ResizeObserver(resize).observe(arena);
  new ResizeObserver(resize).observe(hud);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => requestAnimationFrame(resize));
  window.visualViewport?.addEventListener('resize', resize);
  function updateHud() {
    const second = Math.ceil(game.timeLeft);
    if (lastScore !== game.score) {
      $('scoreText').textContent = String(game.score).padStart(6, '0');
      lastScore = game.score;
      const parent = $('scoreText').parentElement;
      parent.classList.remove('pop');
      if (game.score) requestAnimationFrame(() => parent.classList.add('pop'));
    }
    if (lastSecond !== second) {
      $('timeText').textContent = `00:${String(second).padStart(2, '0')}`;
      lastSecond = second;
      $('timeText').parentElement.classList.toggle('urgent', second <= 5);
    }
    if (lastLives !== game.lives) {
      for (const [i, heart] of [...$('hearts').children].entries()) heart.classList.toggle('empty', i >= game.lives);
      $('hearts').setAttribute('aria-label', `체력 ${game.lives} / ${CONFIG.lives}`);
      if (lastLives > game.lives) {
        $('hearts').classList.remove('damage');
        requestAnimationFrame(() => $('hearts').classList.add('damage'));
        $('announcement').textContent = `남은 체력 ${game.lives}`;
      }
      lastLives = game.lives;
    }
  }
  function syncScreens() {
    $('startScreen').hidden = game.status !== 'ready';
    $('pauseScreen').hidden = game.status !== 'paused';
    $('resultScreen').hidden = game.status !== 'ended';
    $('pauseBtn').disabled = !['playing', 'paused'].includes(game.status);
    hud.style.visibility = game.status === 'ready' ? 'hidden' : 'visible';
    canvas.tabIndex = game.status === 'playing' ? 0 : -1;
    canvas.setAttribute('aria-hidden', String(game.status !== 'playing'));
    $('pauseBtn').setAttribute('aria-label', game.status === 'paused' ? '계속하기' : '일시정지');
    $('pauseBtn').title = game.status === 'paused' ? '계속하기' : '일시정지';
  }
  function cancelAim() {
    game.stopFiring();
    const id = aim.pointerId;
    aim.active = false;
    aim.pointerId = null;
    canvas.dataset.aiming = 'false';
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function unlockAudio() {
    if (!soundEnabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!audio && Context) audio = new Context();
      audio?.resume().catch(() => {});
    } catch {
      audio = null;
    }
  }
  function tone(frequency, end, duration, gain = .045, delay = 0, type = 'triangle') {
    if (!soundEnabled || !audio || audio.state !== 'running') return;
    const start = audio.currentTime + delay,
      osc = audio.createOscillator(),
      volume = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(end, start + duration);
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(gain, start + .003);
    volume.gain.exponentialRampToValueAtTime(.0001, start + duration);
    osc.connect(volume);
    volume.connect(audio.destination);
    osc.start(start);
    osc.stop(start + duration + .01);
    osc.onended = () => {
      osc.disconnect();
      volume.disconnect();
    };
  }
  function sound(type) {
    if (type === 'fire') tone(440, 130, .07, .04);
    if (type === 'hit' || type === 'recovery') {
      tone(180, 55, .09, .09);
      tone(920, 230, .035, .025, 0, 'square');
    }
    if (type === 'recovery') {
      tone(660, 660, .09, .04, .035);
      tone(880, 880, .13, .035, .10);
    }
    if (type === 'damage') tone(150, 65, .15, .055);
  }
  function setSound() {
    $('soundBtn').setAttribute('aria-pressed', String(soundEnabled));
    $('soundBtn').setAttribute('aria-label', soundEnabled ? '소리 끄기' : '소리 켜기');
    $('soundBtn').title = soundEnabled ? '소리 끄기' : '소리 켜기';
    $('soundOn').toggleAttribute('hidden', !soundEnabled);
    $('soundOff').toggleAttribute('hidden', soundEnabled);
  }
  function showResult() {
    cancelAim();
    syncScreens();
    $('resultTitle').textContent = game.endReason === 'time' ? 'TIME UP!' : 'GAME OVER';
    $('resultMessage').textContent = game.recovered ? `${game.recovered}명의 일상을 되찾았어요` : '다음 한 발은 더 따뜻하게!';
    $('resultScore').textContent = game.score.toLocaleString('ko-KR');
    const reward = game.reward();
    $('couponReward').textContent = reward ? reward.amount ? `${reward.amount.toLocaleString('ko-KR')}원 쿠폰` : reward.label : '다음 한 발을 응원해요';
    $('rewardNote').textContent = reward ? '리워드 미리보기 · 실제 쿠폰은 발급되지 않아요' : '';
    $('announcement').textContent = `${$('resultTitle').textContent}. 최종 점수 ${game.score}`;
    $('restartBtn').focus({
      preventScroll: true
    });
  }
  function processEvents() {
    for (const e of game.drainEvents()) {
      renderer.add(e);
      sound(e.type);
      if (e.type === 'end') showResult();
    }
  }
  function start() {
    if (helpDialog.open) return;
    if (!assetsReady) {
      loadAssets();
      return;
    }
    cancelAim();
    unlockAudio();
    renderer.effects = [];
    game.start();
    lastFrame = performance.now();
    syncScreens();
    updateHud();
    resize();
    canvas.focus({
      preventScroll: true
    });
  }
  function pause() {
    if (game.status !== 'playing') return;
    cancelAim();
    game.pause();
    audio?.suspend().catch(() => {});
    syncScreens();
    $('resumeBtn').focus({
      preventScroll: true
    });
  }
  function resume() {
    if (game.status !== 'paused' || helpDialog.open) return;
    game.resume();
    unlockAudio();
    lastFrame = performance.now();
    syncScreens();
    canvas.focus({
      preventScroll: true
    });
  }
  function openHelp(action = 'dismiss') {
    if (helpDialog.open) return;
    helpAction = action;
    helpReturnStatus = game.status;
    helpReturnFocus = document.activeElement;
    cancelAim();
    if (game.status === 'playing') {
      game.pause();
      audio?.suspend().catch(() => {});
      syncScreens();
    }
    $('helpGoal').textContent = `${CONFIG.duration}초 안에 최고 점수에 도전해요.`;
    $('helpRecovery').textContent = `같은 좀비를 ${CONFIG.hitsToRecover}번 맞히면 사람으로 회복돼요.`;
    $('helpPoints').textContent = `적중 +${CONFIG.hitScore} · 회복 보너스 +${CONFIG.recoveryScore}`;
    $('helpCombo').textContent = `${CONFIG.comboWindow}초 안에 연속으로 맞히면 COMBO!`;
    $('helpLives').textContent = `하트는 ${CONFIG.lives}개. 좀비가 하단 경계를 넘으면 하나씩 줄고, 모두 잃으면 게임이 끝나요.`;
    $('helpConfirmLabel').textContent = action === 'start' ? '알겠어요, 시작!' : helpReturnStatus === 'playing' ? '계속 플레이' : '확인';
    helpDialog.showModal();
    $('helpTitle').focus({ preventScroll: true });
  }
  function closeHelp(confirmed = false) {
    if (!helpDialog.open) return;
    if (confirmed) helpSeen = true;
    helpDialog.close();
    if (confirmed && helpAction === 'start') {
      start();
    } else if (helpReturnStatus === 'playing') {
      resume();
    } else {
      helpReturnFocus?.focus({ preventScroll: true });
    }
  }
  function requestStart() {
    if (!assetsReady) {
      loadAssets();
      return;
    }
    if (helpSeen) start();
    else openHelp('start');
  }
  function updatePointer(event) {
    aim.clientX = event.clientX;
    aim.clientY = event.clientY;
    aim.point = screenToGame(event.clientX, event.clientY, canvas.getBoundingClientRect(), game.layout);
  }
  function updateHeldFire() {
    const rect = canvas.getBoundingClientRect();
    const inside = aim.clientX >= rect.left && aim.clientX <= rect.right &&
      aim.clientY >= rect.top && aim.clientY <= rect.bottom &&
      aim.point.y >= game.layout.fieldTop && aim.point.y <= game.layout.dangerY;
    game.setFiring(aim.active && inside ? aim.point : null);
  }
  canvas.addEventListener('pointerdown', event => {
    if (game.status !== 'playing' || aim.active || event.isPrimary === false || event.button !== 0) return;
    resize();
    updatePointer(event);
    if (aim.point.y < game.layout.fieldTop || aim.point.y > game.layout.dangerY) return;
    event.preventDefault();
    unlockAudio();
    aim.active = true;
    aim.pointerId = event.pointerId;
    canvas.dataset.aiming = 'true';
    canvas.setPointerCapture(event.pointerId);
    updateHeldFire();
    processEvents();
    renderer.draw(game, aim);
  });
  canvas.addEventListener('pointermove', event => {
    if (!aim.active || event.pointerId !== aim.pointerId) return;
    event.preventDefault();
    updatePointer(event);
    updateHeldFire();
  });
  canvas.addEventListener('pointerup', event => {
    if (!aim.active || event.pointerId !== aim.pointerId) return;
    event.preventDefault();
    cancelAim();
    processEvents();
    renderer.draw(game, aim);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (event.pointerId === aim.pointerId) cancelAim();
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  $('startBtn').addEventListener('click', requestStart);
  $('restartBtn').addEventListener('click', start);
  $('helpBtn').addEventListener('click', () => openHelp());
  $('helpCloseBtn').addEventListener('click', () => closeHelp());
  $('helpConfirmBtn').addEventListener('click', () => closeHelp(true));
  helpDialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeHelp();
  });
  $('pauseBtn').addEventListener('click', () => game.status === 'paused' ? resume() : pause());
  $('resumeBtn').addEventListener('click', resume);
  $('soundBtn').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    setSound();
    if (soundEnabled) unlockAudio();else audio?.suspend().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', pause);
  document.addEventListener('keydown', event => {
    if (helpDialog.open) return;
    if (event.key === 'Escape') {
      if (game.status === 'paused') resume();else pause();
    }
  });
  function loadAssets() {
    if (loadPromise) return loadPromise;
    $('startBtn').disabled = true;
    $('startLabel').textContent = '준비 중';
    $('loadStatus').textContent = '';
    const fontReady = document.fonts ? document.fonts.load('24px Mulmaru', '본죽 게임 방법 SCORE 0123456789').then(faces => {
      if (!faces.length) throw new Error('font');
    }) : Promise.resolve();
    loadPromise = Promise.all([fontReady, ...paths.map(name => new Promise((resolve, reject) => {
      if (assets[name]) {
        resolve();
        return;
      }
      const image = new Image();
      image.onload = () => {
        assets[name] = image;
        resolve();
      };
      image.onerror = () => reject(new Error(name));
      image.src = `${name}.png`;
    }))]).then(() => {
      assetsReady = true;
      $('startLabel').textContent = 'START';
      $('startBtn').disabled = false;
      resize();
    }).catch(() => {
      $('startLabel').textContent = '다시 불러오기';
      $('startBtn').disabled = false;
      $('loadStatus').textContent = '게임 파일을 불러오지 못했어요. 다시 시도해주세요.';
    }).finally(() => {
      loadPromise = null;
    });
    return loadPromise;
  }
  function frame(now) {
    if ((window.devicePixelRatio || 1) !== lastDpr) resize();
    const dt = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (game.status === 'playing') {
      game.advance(dt);
      processEvents();
      updateHud();
    }
    renderer.draw(game, aim);
    requestAnimationFrame(frame);
  }
  // Test hooks are present only in an explicitly requested local QA session.
  if (new URLSearchParams(location.search).has('qa')) window.BonQA = {
    game,
    renderer,
    aim,
    resize,
    assets,
    get ready() {
      return assetsReady;
    }
  };
  resize();
  setSound();
  syncScreens();
  updateHud();
  loadAssets();
  document.fonts?.ready.then(resize);
  requestAnimationFrame(frame);
})();
