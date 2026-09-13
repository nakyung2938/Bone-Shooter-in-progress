(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/sat.js'), require('./assets/hit-shapes.js'));else root.BonGame = factory(root.SAT, root.BonHitShapes);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SAT, shapes) {
  'use strict';

  const CONFIG = Object.freeze({
    duration: 30,
    lives: 3,
    hitsToRecover: 2,
    hitScore: 100,
    recoveryScore: 250,
    recoveryDuration: 1.65,
    shotSpeed: 1200,
    fireInterval: .16,
    shotSize: 100,
    shotFadeStart: .55,
    comboWindow: 3,
    step: 1 / 120,
    // Set amounts only when a real promotion and coupon issuance are connected.
    coupons: [{
      minScore: 4500,
      label: '쿠폰 3',
      amount: null
    }, {
      minScore: 2700,
      label: '쿠폰 2',
      amount: null
    }, {
      minScore: 900,
      label: '쿠폰 1',
      amount: null
    }]
  });
  const COLORS = {
    cream: '#0b090f',
    violet: '#b487de',
    white: '#fffef7',
    yellow: '#efbc48',
    ink: '#fff0d9'
  };
  const GROUPS = ['gray', 'white', 'blue'];
  const MEALS = Object.freeze(['meal_porridge', 'meal_bibimbap']);
  const DIALOGUE = Object.freeze({
    duration: 2.4,
    interval: 4.2,
    headroom: 96,
    reactionDelay: .72,
    hitLines: Object.freeze(['오... 좀 살겠죽!', '기운이 돌아온죽!']),
    recoveryLines: Object.freeze(['본죽 먹고 회복 완료!', '든든하게 살아났죽!', '본죽이랑 죽이 잘 맞네!']),
    lines: Object.freeze([
      '죽죽죽 힘내자!!!',
      '야근 해본죽 있어?',
      '배고파서 좀비 됨...',
      '퇴근하고 싶죽...',
      '오늘도 버텨본죽!',
      '든든하게 가보자고!'
    ])
  });
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function layoutFor(cssWidth, cssHeight, hudHeight = 80) {
    const aspect = cssWidth / cssHeight;
    const mode = aspect >= 1.18 ? 'desktopLandscape' : cssWidth >= 600 ? 'tablet' : 'mobilePortrait';
    const width = mode === 'desktopLandscape' ? 900 * aspect : mode === 'tablet' ? 900 : 720;
    const height = width / aspect;
    const unit = mode === 'desktopLandscape' ? .88 : 1;
    const trayWidth = 244 * unit,
      trayHeight = 144 * unit;
    const player = {
      x: width / 2,
      y: height - trayHeight * .57 - 24,
      w: trayWidth,
      h: trayHeight
    };
    return {
      mode,
      width,
      height,
      unit,
      player,
      cssWidth,
      cssHeight,
      fieldTop: hudHeight * width / cssWidth + 20,
      dangerY: player.y - trayHeight * .60,
      enemyHeight: 170 * unit,
      maxEnemies: mode === 'desktopLandscape' ? 4 : 3
    };
  }
  function screenToGame(clientX, clientY, rect, layout) {
    return {
      x: (clientX - rect.left) * layout.width / rect.width,
      y: (clientY - rect.top) * layout.height / rect.height
    };
  }
  function gameToScreen(point, rect, layout) {
    return {
      x: rect.left + point.x * rect.width / layout.width,
      y: rect.top + point.y * rect.height / layout.height
    };
  }
  const muzzle = l => ({
    x: l.player.x,
    y: l.player.y - l.player.h * .24
  });
  // Guide and projectile use this single solution, without spread, auto-aim, or hidden gravity.
  function solveShot(layout, target) {
    const origin = muzzle(layout),
      dx = target.x - origin.x,
      dy = target.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 24 * layout.unit || dy >= -12 * layout.unit) return null;
    const speed = CONFIG.shotSpeed * layout.unit;
    return {
      x: origin.x,
      y: origin.y,
      vx: dx / distance * speed,
      vy: dy / distance * speed,
      angle: Math.atan2(dy, dx),
      distance
    };
  }
  const trajectoryPoint = (shot, seconds) => ({
    x: shot.x + shot.vx * seconds,
    y: shot.y + shot.vy * seconds
  });
  function projectileRange(layout, angle, size) {
    const origin = muzzle(layout), dx = Math.cos(angle), dy = Math.sin(angle);
    const top = (layout.fieldTop - origin.y) / dy;
    const side = Math.abs(dx) < 1e-8 ? Infinity : ((dx > 0 ? layout.width : 0) - origin.x) / dx;
    return Math.min(top, side) + size * .5;
  }
  function shotOpacity(shot) {
    const start = shot.maxDistance * CONFIG.shotFadeStart;
    const t = clamp((shot.travelled - start) / (shot.maxDistance - start), 0, 1);
    return 1 - t * t * (3 - 2 * t);
  }
  function enemyPose(e, time) {
    const sinceHit = time - e.hitAt,
      kick = Math.max(0, 1 - sinceHit / .15);
    const squash = Math.sin(clamp(sinceHit / .18, 0, 1) * Math.PI) * .18;
    return {
      x: e.x + e.kickX * kick,
      y: e.y + e.kickY * kick + Math.sin(e.walk * 10) * 2,
      w: e.w * (1 + squash),
      h: e.h * (1 - squash * .65),
      sprite: e.sprite
    };
  }
  function recoveryPose(e, time, unit, reducedMotion = false) {
    const age = Math.max(0, time - e.recoveredAt);
    const jump = reducedMotion ? 0 : Math.sin(clamp((age - .08) / .5, 0, 1) * Math.PI) * 28 * unit;
    const squash = reducedMotion ? 0 : Math.sin(clamp(age / .18, 0, 1) * Math.PI) * .1 +
      Math.sin(clamp((age - .58) / .16, 0, 1) * Math.PI) * .05;
    const h = e.h * (1 - squash), w = e.w * (1 + squash);
    return {x: e.x, y: e.y + (e.h - h) / 2 - jump, w, h,
      sprite: `human_${e.group}`,
      alpha: clamp((age - .04) / .1, 0, 1) * clamp((CONFIG.recoveryDuration - age) / .24, 0, 1)};
  }
  function projectilePose(shot) {
    return {
      x: shot.x,
      y: shot.y,
      w: shot.size,
      h: shot.size * 210 / 260,
      sprite: shot.sprite,
      // Keep the food readable; rendering and collision share the same slight tilt.
      angle: clamp(shot.angle + Math.PI / 2, -.45, .45) * .65
    };
  }
  function projectilePolygon(shot) {
    const pose = projectilePose(shot);
    return new SAT.Polygon(new SAT.Vector(pose.x, pose.y), shapes[pose.sprite].hull.map(([x, y]) => new SAT.Vector(x * pose.w, y * pose.h))).setAngle(pose.angle);
  }
  function contactPoint(polygon, left, top, width, height) {
    const right = left + width,
      bottom = top + height,
      contacts = [];
    const points = polygon.calcPoints.map(p => ({
      x: p.x + polygon.pos.x,
      y: p.y + polygon.pos.y
    }));
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (a.x >= left && a.x <= right && a.y >= top && a.y <= bottom) contacts.push(a);
      if (b.x !== a.x) for (const x of [left, right]) {
        const t = (x - a.x) / (b.x - a.x),
          y = lerp(a.y, b.y, t);
        if (t >= 0 && t <= 1 && y >= top && y <= bottom) contacts.push({
          x,
          y
        });
      }
      if (b.y !== a.y) for (const y of [top, bottom]) {
        const t = (y - a.y) / (b.y - a.y),
          x = lerp(a.x, b.x, t);
        if (t >= 0 && t <= 1 && x >= left && x <= right) contacts.push({
          x,
          y
        });
      }
    }
    for (const x of [left, right]) for (const y of [top, bottom]) if (SAT.pointInPolygon(new SAT.Vector(x, y), polygon)) contacts.push({
      x,
      y
    });
    if (!contacts.length) return {
      x: clamp(polygon.pos.x, left, right),
      y: clamp(polygon.pos.y, top, bottom)
    };
    return {
      x: contacts.reduce((sum, p) => sum + p.x, 0) / contacts.length,
      y: contacts.reduce((sum, p) => sum + p.y, 0) / contacts.length
    };
  }
  function intersectsSprite(projectile, pose) {
    const b = projectile.getAABBAsBox();
    if (b.pos.x > pose.x + pose.w / 2 || b.pos.x + b.w < pose.x - pose.w / 2 || b.pos.y > pose.y + pose.h / 2 || b.pos.y + b.h < pose.y - pose.h / 2) return null;
    const response = new SAT.Response();
    // Four-source-pixel bands follow the alpha silhouette, including the leg gap.
    for (const [x, y, w, h] of shapes[pose.sprite].bands) {
      const left = pose.x + x * pose.w,
        top = pose.y + y * pose.h,
        width = w * pose.w,
        height = h * pose.h;
      if (left > b.pos.x + b.w || left + width < b.pos.x || top > b.pos.y + b.h || top + height < b.pos.y) continue;
      const band = new SAT.Box(new SAT.Vector(left, top), width, height).toPolygon();
      response.clear();
      if (SAT.testPolygonPolygon(projectile, band, response)) return contactPoint(projectile, left, top, width, height);
    }
    return null;
  }
  function sweepHit(shot, end, from, to) {
    const travel = Math.hypot(end.x - shot.x, end.y - shot.y) + Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(travel / 2)),
      polygon = projectilePolygon(shot);
    const at = t => {
      polygon.pos.x = lerp(shot.x, end.x, t);
      polygon.pos.y = lerp(shot.y, end.y, t);
      return intersectsSprite(polygon, {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        w: lerp(from.w, to.w, t),
        h: lerp(from.h, to.h, t),
        sprite: to.sprite
      });
    };
    for (let step = 0; step <= steps; step++) {
      let high = step / steps,
        contact = at(high);
      if (!contact) continue;
      let low = Math.max(0, (step - 1) / steps);
      for (let i = 0; i < 7; i++) {
        const mid = (low + high) / 2,
          candidate = at(mid);
        if (candidate) {
          high = mid;
          contact = candidate;
        } else low = mid;
      }
      return {
        t: high,
        contact,
        x: lerp(shot.x, end.x, high),
        y: lerp(shot.y, end.y, high)
      };
    }
    return null;
  }
  class Game {
    constructor(layout, random = Math.random, dialogueRandom = Math.random) {
      this.layout = layout;
      this.random = random;
      this.dialogueRandom = dialogueRandom;
      this.status = 'ready';
      this.time = 0;
      this.timeLeft = CONFIG.duration;
      this.score = 0;
      this.lives = CONFIG.lives;
      this.enemies = [];
      this.shots = [];
      this.events = [];
      this.combo = 0;
      this.recovered = 0;
      this.fired = 0;
      this.hitCount = 0;
      this.nextId = 1;
      this.spawnIn = 0;
      this.lastHit = -Infinity;
      this.accumulator = 0;
      this.endReason = '';
      this.damageAt = -Infinity;
      this.firedAt = -Infinity;
      this.firingTarget = null;
      this.aimDirection = {x: 0, y: -1};
      this.nextFireAt = 0;
      this.nextMeal = MEALS[0];
      this.speech = null;
      this.pendingSpeech = null;
      this.lastSpeech = '';
      this.nextSpeechAt = 1.2;
    }
    start() {
      Object.assign(this, new Game(this.layout, this.random, this.dialogueRandom));
      this.status = 'playing';
      this.nextMeal = this.pickMeal();
      this.spawn();
      this.spawnIn = 1.35;
    }
    pause() {
      if (this.status === 'playing') {
        this.stopFiring();
        this.status = 'paused';
        this.accumulator = 0;
      }
    }
    resume() {
      if (this.status === 'paused') this.status = 'playing';
    }
    emit(type, data = {}) {
      this.events.push({
        type,
        time: this.time,
        ...data
      });
    }
    drainEvents() {
      return this.events.splice(0);
    }
    pickMeal() {
      return MEALS[this.random() < .5 ? 0 : 1];
    }
    showSpeech(speaker, kind = 'idle') {
      const pool = kind === 'hit' ? DIALOGUE.hitLines : kind === 'recovery' ? DIALOGUE.recoveryLines : DIALOGUE.lines;
      const lines = pool.filter(line => line !== this.lastSpeech);
      const text = lines[Math.floor(this.dialogueRandom() * lines.length)];
      const duration = kind === 'recovery' ? CONFIG.recoveryDuration - DIALOGUE.reactionDelay : DIALOGUE.duration;
      this.speech = {enemyId: speaker.id, text, kind, duration, startedAt: this.time};
      this.lastSpeech = text;
      this.nextSpeechAt = this.time + DIALOGUE.interval + this.dialogueRandom() * .8;
    }
    queueReaction(speaker, kind) {
      // A short recovery line may finish before another character takes over the conversation.
      if (this.speech?.kind === 'recovery' && this.speech.enemyId !== speaker.id) return;
      if (this.pendingSpeech?.kind === 'recovery' && this.pendingSpeech.enemyId !== speaker.id) return;
      this.speech = null;
      this.pendingSpeech = {enemyId: speaker.id, kind, readyAt: this.time + DIALOGUE.reactionDelay};
    }
    updateSpeech() {
      if (this.status !== 'playing') return;
      if (this.speech) {
        const speaker = this.enemies.find(e => e.id === this.speech.enemyId);
        if (!speaker || speaker.dead || (speaker.hits >= CONFIG.hitsToRecover && this.speech.kind !== 'recovery') ||
            this.time - this.speech.startedAt >= (this.speech.duration ?? DIALOGUE.duration)) this.speech = null;
      }
      if (this.pendingSpeech) {
        const pending = this.pendingSpeech;
        const speaker = this.enemies.find(e => e.id === pending.enemyId && !e.dead);
        if (!speaker || (speaker.hits >= CONFIG.hitsToRecover && pending.kind !== 'recovery')) this.pendingSpeech = null;
        else if (this.time + 1e-7 >= pending.readyAt) {
          this.showSpeech(speaker, pending.kind);
          this.pendingSpeech = null;
        }
      }
      if (this.speech || this.pendingSpeech || this.time < this.nextSpeechAt) return;
      const l = this.layout;
      const candidates = this.enemies.filter(e => !e.dead && e.hits < CONFIG.hitsToRecover && this.time - e.hitAt > .7 &&
        enemyPose(e, this.time).y - e.h * .5 >= l.fieldTop + DIALOGUE.headroom * l.unit && e.y + e.h < l.dangerY);
      if (!candidates.length) {
        this.nextSpeechAt = this.time + .3;
        return;
      }
      // Cosmetic dialogue must not change food selection or enemy spawn randomness.
      const speaker = candidates[Math.floor(this.dialogueRandom() * candidates.length)];
      this.showSpeech(speaker);
    }
    fire(target) {
      if (this.status !== 'playing') return null;
      const solution = solveShot(this.layout, target);
      if (!solution) return null;
      this.aimDirection = {x: Math.cos(solution.angle), y: Math.sin(solution.angle)};
      const shot = {
        ...solution,
        id: this.nextId++,
        age: 0,
        travelled: 0,
        size: CONFIG.shotSize * this.layout.unit,
        sprite: this.nextMeal
      };
      shot.maxDistance = projectileRange(this.layout, shot.angle, shot.size);
      this.shots.push(shot);
      this.fired++;
      this.firedAt = this.time;
      this.nextMeal = this.pickMeal();
      this.emit('fire', {
        x: shot.x,
        y: shot.y,
        angle: shot.angle
      });
      return shot;
    }
    setFiring(target) {
      const solution = target && solveShot(this.layout, target);
      if (this.status !== 'playing' || !solution) {
        this.stopFiring();
        return;
      }
      const justPressed = this.firingTarget === null;
      this.aimDirection = {x: Math.cos(solution.angle), y: Math.sin(solution.angle)};
      this.firingTarget = { ...target };
      if (justPressed) {
        this.fire(this.firingTarget);
        this.nextFireAt = this.time + CONFIG.fireInterval;
      }
    }
    stopFiring() {
      this.firingTarget = null;
    }
    spawn() {
      const l = this.layout;
      if (this.enemies.filter(e => e.hits < CONFIG.hitsToRecover).length >= l.maxEnemies) return;
      const h = l.enemyHeight,
        w = h * 260 / 420;
      const lanes = l.mode === 'desktopLandscape' ? [.12, .31, .50, .69, .88] : [.19, .5, .81];
      const occupied = this.enemies.filter(e => e.hits < CONFIG.hitsToRecover);
      const available = lanes.filter(lane => !occupied.some(e => Math.abs(e.lane - lane) < .13));
      const candidates = available.length ? available : lanes.filter(lane => !occupied.some(e => Math.abs(e.lane - lane) < .13 && e.y < l.fieldTop + h * 2));
      if (!candidates.length) return;
      const lane = candidates[Math.floor(this.random() * candidates.length)],
        group = GROUPS[Math.floor(this.random() * 3)];
      const phase = this.random() * Math.PI * 2;
      this.enemies.push({
        id: this.nextId++,
        x: lane * l.width + Math.sin(phase) * l.width * .032,
        y: l.fieldTop + h * .53,
        w,
        h,
        lane,
        group,
        phase,
        walk: 0,
        hits: 0,
        hitAt: -Infinity,
        recoveredAt: -Infinity,
        kickX: 0,
        kickY: 0,
        sprite: `zombie_${group}_front`,
        speed: Math.max(18, (l.dangerY - l.fieldTop - h) / (9.2 - this.random() * 1.5))
      });
    }
    finish(reason) {
      if (this.status === 'ended') return;
      this.stopFiring();
      this.status = 'ended';
      this.endReason = reason;
      this.shots.length = 0;
      this.speech = null;
      this.pendingSpeech = null;
      this.accumulator = 0;
      this.emit('end', {
        reason
      });
    }
    advance(seconds) {
      if (this.status !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
      this.accumulator += seconds;
      while (this.accumulator + 1e-9 >= CONFIG.step && this.status === 'playing') {
        this.accumulator -= CONFIG.step;
        this.step(Math.min(CONFIG.step, this.timeLeft));
      }
    }
    step(dt) {
      const previousTime = this.time;
      this.time += dt;
      this.timeLeft = Math.max(0, CONFIG.duration - this.time);
      if (this.timeLeft < 1e-7) {
        this.timeLeft = 0;
        this.finish('time');
        return;
      }
      if (this.firingTarget && this.time + 1e-7 >= this.nextFireAt) {
        this.fire(this.firingTarget);
        this.nextFireAt += CONFIG.fireInterval;
      }
      const l = this.layout;
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        this.spawn();
        this.spawnIn = 1.25 + this.random() * .3;
      }
      const poses = new Map();
      for (const e of this.enemies) {
        if (e.hits >= CONFIG.hitsToRecover) continue;
        const before = enemyPose(e, previousTime);
        e.walk += dt;
        const sideSpeed = Math.cos(e.walk * 1.6 + e.phase);
        e.x = clamp(e.lane * l.width + Math.sin(e.walk * 1.6 + e.phase) * l.width * .032, e.w * .65, l.width - e.w * .65);
        e.y += e.speed * dt;
        e.sprite = `zombie_${e.group}_${Math.abs(sideSpeed) < .35 ? 'front' : sideSpeed > 0 ? 'side_a' : 'side_b'}`;
        poses.set(e.id, [before, enemyPose(e, this.time)]);
      }
      for (const shot of this.shots) {
        shot.age += dt;
        const speed = Math.hypot(shot.vx, shot.vy);
        const travel = Math.min(speed * dt, Math.max(0, shot.maxDistance - shot.travelled));
        if (travel < 1e-7) {
          shot.dead = true;
          this.combo = 0;
          continue;
        }
        const end = trajectoryPoint(shot, travel / speed);
        let first = null;
        for (const e of this.enemies) {
          if (e.hits >= CONFIG.hitsToRecover) continue;
          const [from, to] = poses.get(e.id);
          if (Math.max(shot.x, end.x) + shot.size < Math.min(from.x, to.x) - e.w || Math.min(shot.x, end.x) - shot.size > Math.max(from.x, to.x) + e.w || Math.max(shot.y, end.y) + shot.size < Math.min(from.y, to.y) - e.h || Math.min(shot.y, end.y) - shot.size > Math.max(from.y, to.y) + e.h) continue;
          const fraction = travel / (speed * dt);
          const finalPose = fraction < 1 ? {
            ...to, x: lerp(from.x, to.x, fraction), y: lerp(from.y, to.y, fraction),
            w: lerp(from.w, to.w, fraction), h: lerp(from.h, to.h, fraction)
          } : to;
          const collision = sweepHit(shot, end, from, finalPose);
          if (collision && (!first || collision.t < first.t)) first = {
            ...collision,
            enemy: e
          };
        }
        if (first) {
          shot.travelled += travel * first.t;
          shot.x = first.x;
          shot.y = first.y;
          shot.dead = true;
          this.hit(first.enemy, shot, first.contact);
        } else {
          shot.travelled += travel;
          shot.x = end.x;
          shot.y = end.y;
        }
        if (!shot.dead && (shot.travelled >= shot.maxDistance - 1e-7 || shot.x < -shot.size || shot.x > l.width + shot.size || shot.y < l.fieldTop - shot.size || shot.age > 3)) {
          shot.dead = true;
          this.combo = 0;
        }
      }
      this.shots = this.shots.filter(s => !s.dead);
      for (const e of this.enemies) {
        if (e.hits >= CONFIG.hitsToRecover) continue;
        const pose = enemyPose(e, this.time);
        if (pose.y + pose.h * .5 >= l.dangerY) {
          e.dead = true;
          this.lives = Math.max(0, this.lives - 1);
          this.combo = 0;
          this.damageAt = this.time;
          this.emit('damage', {
            x: e.x,
            y: l.dangerY
          });
          if (!this.lives) {
            this.finish('hp');
            break;
          }
        }
      }
      this.enemies = this.enemies.filter(e => !e.dead && (e.hits < CONFIG.hitsToRecover || this.time - e.recoveredAt < CONFIG.recoveryDuration));
      this.updateSpeech();
    }
    hit(e, shot, contact) {
      if (this.speech?.enemyId === e.id) this.speech = null;
      e.hits++;
      e.hitAt = this.time;
      e.kickX = Math.cos(shot.angle) * 14 * this.layout.unit;
      e.kickY = Math.sin(shot.angle) * 11 * this.layout.unit;
      this.combo = this.time - this.lastHit <= CONFIG.comboWindow ? this.combo + 1 : 1;
      this.lastHit = this.time;
      this.hitCount++;
      this.score += CONFIG.hitScore;
      const recovered = e.hits >= CONFIG.hitsToRecover;
      if (recovered) {
        e.recoveredAt = this.time;
        this.score += CONFIG.recoveryScore;
        this.recovered++;
      }
      this.queueReaction(e, recovered ? 'recovery' : 'hit');
      this.emit(recovered ? 'recovery' : 'hit', {
        ...contact,
        enemyId: e.id,
        angle: shot.angle,
        popupX: e.x,
        popupY: e.y - e.h * .5 - (recovered ? 58 : 40) * this.layout.unit,
        combo: this.combo,
        score: CONFIG.hitScore + (recovered ? CONFIG.recoveryScore : 0)
      });
    }
    resize(next) {
      const old = this.layout,
        sx = next.width / old.width,
        sy = next.height / old.height;
      if (this.firingTarget) {
        this.firingTarget.x *= sx;
        this.firingTarget.y *= sy;
      }
      for (const e of this.enemies) {
        const oldStart = old.fieldTop + e.h * .53;
        const progress = (e.y - oldStart) / Math.max(1, old.dangerY - e.h * .5 - oldStart);
        e.h = next.enemyHeight;
        e.w = e.h * 260 / 420;
        const newStart = next.fieldTop + e.h * .53;
        e.y = newStart + progress * (next.dangerY - e.h * .5 - newStart);
        e.x *= sx;
        e.speed *= (next.dangerY - newStart) / (old.dangerY - oldStart);
        e.kickX *= next.unit / old.unit;
        e.kickY *= next.unit / old.unit;
      }
      for (const s of this.shots) {
        const rangeProgress = s.travelled / s.maxDistance;
        s.x *= sx;
        s.y *= sy;
        s.vx *= sx;
        s.vy *= sy;
        s.angle = Math.atan2(s.vy, s.vx);
        s.size *= next.unit / old.unit;
        s.maxDistance = projectileRange(next, s.angle, s.size);
        s.travelled = rangeProgress * s.maxDistance;
      }
      this.layout = next;
    }
    reward() {
      return CONFIG.coupons.find(tier => this.score >= tier.minScore) || null;
    }
  }
  return {
    CONFIG,
    COLORS,
    GROUPS,
    MEALS,
    DIALOGUE,
    Game,
    layoutFor,
    screenToGame,
    gameToScreen,
    solveShot,
    trajectoryPoint,
    projectileRange,
    shotOpacity,
    muzzle,
    enemyPose,
    recoveryPose,
    projectilePose,
    projectilePolygon,
    intersectsSprite,
    sweepHit,
    clamp,
    lerp
  };
});
