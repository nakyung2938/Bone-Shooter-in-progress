(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game-core.js'));else root.BonRenderer = factory(root.BonGame);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const {
    COLORS: C,
    CONFIG,
    DIALOGUE,
    enemyPose,
    recoveryPose,
    muzzle,
    solveShot,
    trajectoryPoint,
    projectileRange,
    shotOpacity,
    projectilePose,
    clamp
  } = Core;
  class Renderer {
    constructor(canvas, assets, reducedMotion = false) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.assets = assets;
      this.reducedMotion = reducedMotion;
      this.effects = [];
    }
    resize(layout) {
      this.layout = layout;
    }
    add(event) {
      if (!['hit', 'recovery', 'fire', 'damage', 'upgrade'].includes(event.type)) return;
      if (event.enemyId !== undefined) for (const previous of this.effects) if (previous.enemyId === event.enemyId) previous.suppressPopup = true;
      const count = this.reducedMotion ? 4 : event.type === 'recovery' ? 18 : event.type === 'fire' ? 5 : 10;
      const particles = Array.from({
        length: count
      }, (_, i) => {
        const angle = i / count * Math.PI * 2 + (event.angle || 0);
        return {
          vx: Math.cos(angle) * (55 + i % 4 * 34),
          vy: Math.sin(angle) * (55 + i % 4 * 34) - 35,
          spin: angle,
          color: i % 3 ? C.white : C.yellow
        };
      });
      this.effects.push({
        ...event,
        particles
      });
      if (this.effects.length > 40) this.effects.shift();
    }
    remap(old, next) {
      for (const e of this.effects) {
        e.x *= next.width / old.width;
        e.y *= next.height / old.height;
        if (e.popupX !== undefined) {
          e.popupX *= next.width / old.width;
          e.popupY *= next.height / old.height;
        }
      }
    }
    sprite(name, x, y, w, h, {
      alpha = 1,
      angle = 0,
      filter = 'none'
    } = {}) {
      const img = this.assets[name];
      if (!img) return;
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.globalAlpha = alpha;
      c.filter = filter;
      c.drawImage(img, -w / 2, -h / 2, w, h);
      c.restore();
    }
    ellipse(x, y, rx, ry, color) {
      const c = this.ctx;
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    }
    backdropCrop(layout, fullBleed = false) {
      const img = this.assets.background_violet;
      if (!img) return null;
      const top = fullBleed ? 0 : layout.fieldTop - 20;
      const height = layout.height - top;
      const scale = Math.max(layout.width / img.width, height / img.height);
      const sw = layout.width / scale, sh = height / scale;
      // Keep the shop and lamp in view on wide screens without stretching the street.
      const anchor = layout.mode === 'desktopLandscape' ? .1 : 0;
      return {sx:(img.width - sw) / 2, sy:(img.height - sh) * anchor, sw, sh, top, height};
    }
    drawBackdrop(game) {
      const c = this.ctx, l = game.layout;
      const fullBleed = game.status === 'ready' || game.status === 'ended';
      const crop = this.backdropCrop(l, fullBleed);
      c.fillStyle = C.cream;
      c.fillRect(0, 0, l.width, l.height);
      if (crop) {
        c.drawImage(this.assets.background_violet, crop.sx, crop.sy, crop.sw, crop.sh, 0, crop.top, l.width, crop.height);
        c.fillStyle = '#59307219';
        c.fillRect(0, crop.top, l.width, crop.height);
      }
      if (fullBleed) return;
      // This boundary is decorative only. It never shifts the world or pointer transform.
      c.fillStyle = '#100b19a3';
      c.fillRect(0, l.dangerY, l.width, l.height - l.dangerY);
      c.save();
      c.strokeStyle = game.bonusActive ? C.yellow : game.time - game.damageAt < .16 ? C.violet : '#b487de70';
      c.lineWidth = 2 * l.unit;
      c.setLineDash([7 * l.unit, 8 * l.unit]);
      c.beginPath();
      c.moveTo(16 * l.unit, l.dangerY);
      c.lineTo(l.width - 16 * l.unit, l.dangerY);
      c.stroke();
      c.restore();
    }
    draw(game, aim) {
      const l = game.layout,
        c = this.ctx;
      c.setTransform(this.canvas.width / l.width, 0, 0, this.canvas.height / l.height, 0, 0);
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, l.width, l.height);
      this.drawBackdrop(game);
      if (game.status === 'ready' || game.status === 'ended') return;
      c.save();
      c.beginPath();
      c.rect(0, l.fieldTop - 15, l.width, l.height - l.fieldTop + 15);
      c.clip();
      this.drawSwipeHint(game, aim);
      this.guide(game, aim);
      for (const e of [...game.enemies].sort((a, b) => a.y - b.y)) this.enemy(e, game);
      this.drawSpeech(game, aim);
      for (const s of game.shots) this.shot(s);
      this.player(game, aim);
      this.drawEffects(game);
      c.restore();
      this.drawBonus(game);
      this.drawLevelUp(game);
    }
    meal(pose, level = 1, alpha = 1, fall = 0) {
      this.sprite(pose.sprite, pose.x, pose.y, pose.w, pose.h, {angle: pose.angle || 0, alpha});
      if (level < 2) return;
      const c = this.ctx;
      c.save();
      c.globalAlpha = alpha;
      c.translate(pose.x, pose.y);
      c.rotate(pose.angle || 0);
      // Pixel abalone slices sit inside the original bowl silhouette, not outside its hitbox.
      const slices = level === 3 ? [[-.18,-.24], [0,-.29], [.18,-.24], [-.09,-.06], [.11,-.06]] : [[-.12,-.20], [.12,-.18]];
      for (let i = 0; i < slices.length; i++) {
        const [x,y] = slices[i];
        c.save();
        c.translate(x * pose.w, y * pose.h - fall * (1 + i * .15));
        c.rotate((i % 2 ? 1 : -1) * .24);
        c.scale(pose.w / 100, pose.w / 100);
        const outline = [[-12,-2],[-10,-2],[-10,-4],[-7,-4],[-7,-6],[-3,-6],[-3,-7],
          [3,-7],[3,-6],[7,-6],[7,-4],[10,-4],[10,-2],[12,-2],[12,2],
          [10,2],[10,4],[7,4],[7,6],[3,6],[3,7],[-3,7],[-3,6],[-7,6],[-7,4],[-10,4],[-10,2],[-12,2]];
        for (const [scale,color] of [[1,'#41402a'], [.87,'#a7814b'], [.70,'#f7d99a']]) {
          c.fillStyle = color;
          c.beginPath();
          outline.forEach(([px,py],i) => i ? c.lineTo(px*scale,py*scale) : c.moveTo(px*scale,py*scale));
          c.closePath();c.fill();
        }
        c.fillStyle = '#fff1c9';
        c.fillRect(-4,-4,7,2);c.fillRect(-6,-2,3,2);
        c.fillStyle = '#be975f';
        for (const offset of [-4,0,4]) {
          c.fillRect(offset,-2,1,2);c.fillRect(offset+1,0,1,2);c.fillRect(offset+2,2,1,1);
        }
        c.restore();
      }
      c.restore();
    }
    levelUpLayout(game) {
      if (!game.levelUp) return null;
      const l = game.layout;
      const scale = Math.min(l.unit, (l.width - 32) / 600, (l.dangerY - l.fieldTop - 24) / 480);
      return {x:l.width / 2, y:(l.fieldTop + l.dangerY) / 2, scale,
        width:600 * scale, height:480 * scale};
    }
    drawLevelUp(game) {
      const box = this.levelUpLayout(game);
      if (!box) return;
      const c = this.ctx, l = game.layout, t = game.levelUp;
      const enter = this.reducedMotion ? 1 : clamp(t.age / .18, 0, 1);
      const exit = clamp((t.duration - t.age) / .16, 0, 1);
      const settled = this.reducedMotion ? 1 : clamp((t.age - .20) / .32, 0, 1);
      c.save();
      c.fillStyle = '#08050ee0';
      c.fillRect(0, l.fieldTop - 14, l.width, l.height - l.fieldTop + 14);
      c.globalAlpha = exit;
      c.translate(box.x, box.y + (1 - enter) * 12 * box.scale);
      c.scale(box.scale, box.scale);
      c.textAlign = 'center';
      c.fillStyle = C.violet;
      c.font = '24px Mulmaru, sans-serif';
      c.fillText(t.kind === 'rush' ? 'BONUS TIME · LV. 02' : 'TOPPING UPGRADE · LV. 03', 0, -190);
      c.font = '64px Mulmaru, sans-serif';
      c.fillStyle = '#6a3c96';
      c.fillText(t.kind === 'rush' ? 'LEVEL UP!' : 'POWER UP!', 3, -122);
      c.fillStyle = C.yellow;
      c.fillText(t.kind === 'rush' ? 'LEVEL UP!' : 'POWER UP!', 0, -128);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, radius = 125 + (this.reducedMotion ? 0 : settled * 30);
        const x = Math.cos(angle) * radius, y = -5 + Math.sin(angle) * radius * .5;
        c.fillStyle = i % 2 ? C.violet : C.yellow;
        c.fillRect(x - 2, y - 8, 4, 16); c.fillRect(x - 8, y - 2, 16, 4);
      }
      const size = 230 + 16 * settled;
      this.meal({sprite:t.sprite, x:0, y:3, w:size, h:size * 210 / 260}, t.level, 1, (1 - settled) * 28);
      c.font = '34px Mulmaru, sans-serif';
      c.fillStyle = C.white;
      c.fillText(t.kind === 'rush' ? '전복 토핑 추가!' : '전복 토핑 더블!', 0, 137);
      c.font = '23px Mulmaru, sans-serif';
      c.fillStyle = C.yellow;
      c.fillText(t.kind === 'rush' ? '회복 점수 ×2  ·  연사 UP' : '크기 UP  ·  연사 한 번 더 UP', 0, 175);
      c.fillStyle = '#493252';
      c.fillRect(-110, 203, 220, 5);
      c.fillStyle = C.violet;
      c.fillRect(-110, 203, 220 * clamp(t.age / t.duration, 0, 1), 5);
      c.restore();
    }
    drawBonus(game) {
      const c = this.ctx, l = game.layout, u = l.unit;
      c.save();
      if (game.menuItem) {
        const p = game.menuItem;
        c.fillStyle = '#201329e6';
        c.fillRect(p.x - p.w / 2 - 8 * u, p.y - p.h / 2 - 8 * u, p.w + 16 * u, p.h + 16 * u);
        c.strokeStyle = C.yellow;
        c.lineWidth = 4 * u;
        c.strokeRect(p.x - p.w / 2 - 8 * u, p.y - p.h / 2 - 8 * u, p.w + 16 * u, p.h + 16 * u);
        this.meal(p, 3);
        c.fillStyle = C.yellow;
        c.textAlign = 'center';
        c.font = `${20 * u}px Mulmaru, sans-serif`;
        c.fillText('전복 더블!', p.x, p.y - p.h / 2 - 18 * u);
        c.fillRect(p.x - p.w / 2, p.y + p.h / 2 + 16 * u,
          p.w * clamp((p.expires - game.time) / CONFIG.menuLifetime, 0, 1), 4 * u);
      }
      const notice = game.notice && game.time < game.notice.until;
      if (notice || game.bonusActive) {
        const text = notice ? game.notice.text : `RUSH ×2 · ${Math.ceil(CONFIG.bonusEnd - game.time)}s${game.time < game.boostUntil ? ` · UP ${Math.ceil(game.boostUntil - game.time)}s` : ''}`;
        c.font = `${26 * u}px Mulmaru, sans-serif`;
        c.textAlign = 'center';
        const width = Math.min(l.width - 24 * u, c.measureText(text).width + 32 * u);
        c.fillStyle = '#160e24ed';
        c.fillRect((l.width - width) / 2, l.statusY, width, 44 * u);
        c.fillStyle = C.yellow;
        c.fillText(text, l.width / 2, l.statusY + 30 * u, width - 16 * u);
        if (game.bonusActive) c.fillRect((l.width - width) / 2, l.statusY + 43 * u,
          width * clamp((CONFIG.bonusEnd - game.time) / (CONFIG.bonusEnd - CONFIG.bonusStart), 0, 1), 2 * u);
      }
      c.restore();
    }
    enemy(e, game) {
      const p = enemyPose(e, game.time),
        since = game.time - e.hitAt;
      this.ellipse(p.x, p.y + p.h * .48, p.w * .40, 7 * game.layout.unit, '#00000080');
      if (e.hits >= CONFIG.hitsToRecover) {
        const age = game.time - e.recoveredAt;
        if (age < .1) this.sprite(p.sprite, p.x, p.y, p.w, p.h, {
          alpha: 1 - age / .1,
          filter: 'brightness(1.8)'
        });
        const human = recoveryPose(e, game.time, game.layout.unit, this.reducedMotion);
        this.sprite(human.sprite, human.x, human.y, human.w, human.h, {alpha: human.alpha});
        if (age > .14 && age < .75) {
          const c = this.ctx, u = game.layout.unit;
          c.save();
          c.globalAlpha = Math.sin((age - .14) / .61 * Math.PI) * .9;
          for (const direction of [-1, 1]) {
            const x = human.x + direction * (human.w * .56 + 7 * u);
            const y = human.y - human.h * .23;
            c.fillStyle = C.yellow;
            c.fillRect(x - 2 * u, y - 7 * u, 4 * u, 14 * u);
            c.fillRect(x - 7 * u, y - 2 * u, 14 * u, 4 * u);
            c.fillStyle = C.white;
            c.fillRect(x - 2 * u, y - 2 * u, 4 * u, 4 * u);
          }
          c.restore();
        }
        if (age < .38) {
          const c = this.ctx;
          c.save();
          c.strokeStyle = C.yellow;
          c.lineWidth = 3 * game.layout.unit;
          c.globalAlpha = 1 - age / .38;
          for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4,
              r = 20 + age * 110;
            c.beginPath();
            c.moveTo(p.x + Math.cos(a) * r, p.y - p.h * .18 + Math.sin(a) * r);
            c.lineTo(p.x + Math.cos(a) * (r + 8), p.y - p.h * .18 + Math.sin(a) * (r + 8));
            c.stroke();
          }
          c.restore();
        }
      } else this.sprite(p.sprite, p.x, p.y, p.w, p.h, {
        filter: since < .042 ? 'brightness(2)' : e.hits === 1 ? 'sepia(.55) saturate(.55)' : 'none'
      });
    }
    shot(s) {
      const c = this.ctx, alpha = shotOpacity(s), pose = projectilePose(s);
      c.save();
      c.globalAlpha = alpha;
      c.translate(s.x, s.y);
      c.rotate(s.angle);
      c.fillStyle = s.level > 1 ? '#efbc48b0' : '#efbc4840';
      c.fillRect(-s.size * .86, -s.size * .13, s.size * .48, s.size * .065);
      c.fillStyle = s.level > 1 ? '#fff2b880' : '#fffef730';
      c.fillRect(-s.size * 1.03, s.size * .075, s.size * .58, s.size * .045);
      if (s.level === 3) {
        c.fillStyle = C.yellow;
        for (const [x,y] of [[-.8,-.25], [-1.15,.22]]) {
          c.fillRect(s.size * x - 2, s.size * y - 6, 4, 12);
          c.fillRect(s.size * x - 6, s.size * y - 2, 12, 4);
        }
      }
      c.restore();
      this.meal(pose, s.level, alpha);
    }
    swipeHintLayout(game, aim = {active: false}) {
      if (game.status !== 'playing' || game.fired > 0 || aim.active || game.time >= 8) return null;
      const l = game.layout, u = l.unit;
      const span = Math.min(l.width * .62, 560 * u);
      const radius = 24 * u, y = l.dangerY - 168 * u;
      const left = l.player.x - span / 2, right = l.player.x + span / 2;
      const bounds = {x:left - radius,y:y - radius,w:span + radius * 2,h:radius * 2};
      if (bounds.y < l.fieldTop || bounds.y + bounds.h >= l.dangerY) return null;
      const offset = this.reducedMotion ? 0 : Math.sin((game.time - .25) * Math.PI / 1.2) * span * .38;
      const alpha = clamp((game.time - .08) / .2, 0, 1) * clamp((8 - game.time) / .8, 0, 1);
      return {left, right, y, radius, center:l.player.x, touchX:l.player.x + offset, alpha, bounds};
    }
    drawSwipeHint(game, aim) {
      const hint = this.swipeHintLayout(game, aim);
      if (!hint || hint.alpha <= 0) return;
      const c = this.ctx, u = game.layout.unit;
      c.save();
      c.globalAlpha = hint.alpha * .78;
      c.strokeStyle = '#08060ccc';
      c.lineWidth = 7 * u;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(hint.left, hint.y);
      c.lineTo(hint.right, hint.y);
      c.moveTo(hint.left + 12 * u, hint.y - 11 * u);
      c.lineTo(hint.left, hint.y);
      c.lineTo(hint.left + 12 * u, hint.y + 11 * u);
      c.moveTo(hint.right - 12 * u, hint.y - 11 * u);
      c.lineTo(hint.right, hint.y);
      c.lineTo(hint.right - 12 * u, hint.y + 11 * u);
      c.stroke();
      c.globalAlpha = hint.alpha * .9;
      c.strokeStyle = C.ink;
      c.lineWidth = 3.5 * u;
      c.beginPath();
      c.moveTo(hint.left, hint.y);
      c.lineTo(hint.right, hint.y);
      c.moveTo(hint.left + 12 * u, hint.y - 11 * u);
      c.lineTo(hint.left, hint.y);
      c.lineTo(hint.left + 12 * u, hint.y + 11 * u);
      c.moveTo(hint.right - 12 * u, hint.y - 11 * u);
      c.lineTo(hint.right, hint.y);
      c.lineTo(hint.right - 12 * u, hint.y + 11 * u);
      c.stroke();
      c.globalAlpha = hint.alpha * .34;
      for (const x of [hint.left, hint.center, hint.right]) {
        c.beginPath();
        c.arc(x, hint.y, hint.radius, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = hint.alpha * .95;
      c.fillStyle = C.white;
      c.beginPath();
      c.arc(hint.touchX, hint.y, 6 * u, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(hint.touchX, hint.y, hint.radius, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    guideLayout(game, aim = {active: false}) {
      const l = game.layout, origin = muzzle(l), direction = game.aimDirection;
      const active = !!(aim.active && aim.point && aim.point.x >= 0 && aim.point.x <= l.width &&
        aim.point.y >= l.fieldTop && aim.point.y <= l.dangerY);
      const target = active ? aim.point : {x: origin.x + direction.x * l.height, y: origin.y + direction.y * l.height};
      const solution = solveShot(l, target);
      if (!solution) return null;
      const length = Math.min(solution.distance, l.height * .36, 390 * l.unit,
        projectileRange(l, solution.angle, 0) - 18 * l.unit);
      if (length <= 0) return null;
      return {solution, active, target, end: trajectoryPoint(solution, length / Math.hypot(solution.vx, solution.vy))};
    }
    guide(game, aim) {
      const guide = this.guideLayout(game, aim);
      if (!guide) return;
      const {solution: s, end, active, target} = guide;
      const c = this.ctx, u = game.layout.unit;
      c.save();
      c.strokeStyle = '#08060ccc';
      c.lineWidth = 7 * u;
      c.lineCap = 'round';
      if (!active) c.setLineDash([2 * u, 22 * u]);
      c.beginPath();
      c.moveTo(s.x, s.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      c.strokeStyle = C.ink;
      c.globalAlpha = active ? .9 : .75;
      c.lineWidth = 3 * u;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(s.x, s.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = C.yellow;
      c.lineWidth = 3 * u;
      const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
      c.beginPath();
      c.moveTo(end.x - dx * 10 * u - dy * 7 * u, end.y - dy * 10 * u + dx * 7 * u);
      c.lineTo(end.x, end.y);
      c.lineTo(end.x - dx * 10 * u + dy * 7 * u, end.y - dy * 10 * u - dx * 7 * u);
      c.stroke();
      if (active) {
        c.lineWidth = 2 * u;
        c.beginPath();
        c.arc(target.x, target.y, 10 * u, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    }
    player(game, aim) {
      const l = game.layout,
        p = l.player,
        elapsed = game.time - game.firedAt;
      const kick = this.reducedMotion ? 0 : Math.sin(clamp(elapsed / CONFIG.fireInterval, 0, 1) * Math.PI);
      const origin = muzzle(l);
      const level = game.mealLevel();
      const loaded = projectilePose({ ...origin, size: game.mealSize(), sprite: game.nextMeal,
        angle: Math.atan2(game.aimDirection.y, game.aimDirection.x) });
      this.meal(loaded, level);
      const art = this.assets.serving_tray;
      if (!art) return;
      const width = 300 * l.unit, height = width * art.height / art.width * (1 - kick * .018);
      // Anchor the tray's base during recoil and keep waiting food behind the entire launcher.
      this.sprite('serving_tray', p.x, p.y + p.h * .5 - height / 2, width, height);
      if (level > 1) {
        const c = this.ctx, u = l.unit, x = p.x + 182 * u, y = p.y;
        c.save();
        c.textAlign = 'center';
        c.font = `${24 * u}px Mulmaru, sans-serif`;
        c.fillStyle = C.yellow;
        c.fillText(`LV.${level}`, x, y);
        c.font = `${19 * u}px Mulmaru, sans-serif`;
        c.fillStyle = C.white;
        c.fillText(level === 3 ? '전복 더블' : '전복 토핑', x, y + 26 * u);
        const remaining = level === 3 ? (game.boostUntil - game.time) / CONFIG.menuBoostDuration :
          (CONFIG.bonusEnd - game.time) / (CONFIG.bonusEnd - CONFIG.bonusStart);
        c.fillStyle = C.violet;
        c.fillRect(x - 42 * u, y + 39 * u, 84 * u, 4 * u);
        c.fillStyle = C.yellow;
        c.fillRect(x - 42 * u, y + 39 * u, 84 * u * clamp(remaining, 0, 1), 4 * u);
        c.restore();
      }
    }
    speechLayout(game, aim = {active: false}) {
      const speech = game.speech;
      if (!speech || game.time - speech.startedAt >= (speech.duration ?? DIALOGUE.duration)) return null;
      const speaker = game.enemies.find(e => e.id === speech.enemyId);
      if (!speaker || speaker.dead || (speaker.hits >= CONFIG.hitsToRecover && speech.kind !== 'recovery') || game.time - speaker.hitAt < .7) return null;
      const l = game.layout, u = l.unit;
      const p = speech.kind === 'recovery' ? recoveryPose(speaker, game.time, u, this.reducedMotion) : enemyPose(speaker, game.time);
      const font = `${20 * u}px Mulmaru, sans-serif`, padding = 18 * u;
      const maxWidth = Math.min(224 * u, l.width - padding * 4);
      const c = this.ctx, lines = [];
      c.save();
      c.font = font;
      let line = '';
      for (const character of speech.text) {
        if (line && c.measureText(line + character).width > maxWidth) {
          lines.push(line.trim());
          line = '';
        }
        line += character;
      }
      if (line.trim()) lines.push(line.trim());
      const width = Math.max(...lines.map(text => c.measureText(text).width)) + padding * 2;
      c.restore();
      const lineHeight = 26 * u, height = lines.length * lineHeight + 24 * u;
      const tailHeight = 12 * u, shadow = 3 * u;
      const x = clamp(p.x - width / 2, padding, l.width - padding - width);
      const y = p.y - p.h / 2 - 22 * u - height;
      if (y < l.fieldTop || y + height + tailHeight + shadow > l.dangerY) return null;
      const overlaps = b => x < b.x + b.w && x + width > b.x && y < b.y + b.h && y + height + tailHeight + shadow > b.y;
      for (const e of game.enemies) {
        if (e.id === speaker.id) continue;
        const other = e.hits >= CONFIG.hitsToRecover ? recoveryPose(e, game.time, u, this.reducedMotion) : enemyPose(e, game.time);
        if (overlaps({x:other.x - other.w / 2 - 4 * u,y:other.y - other.h / 2 - 4 * u,w:other.w + 8 * u,h:other.h + 8 * u})) return null;
      }
      for (const e of this.effects) {
        if (e.type === 'fire' || e.suppressPopup || game.time - e.time >= .7) continue;
        if (overlaps({x:(e.popupX ?? e.x) - 85 * u,y:(e.popupY ?? e.y) - (game.time - e.time) * 40 - 18 * u,w:170 * u,h:70 * u})) return null;
      }
      if (aim.active && overlaps({x:aim.point.x - 12 * u,y:aim.point.y - 12 * u,w:24 * u,h:24 * u})) return null;
      return {x, y, width, height, lines, lineHeight, font, tailHeight, shadow,
        tailX:clamp(p.x + 4 * u, x + 26 * u, x + width - 26 * u)};
    }
    drawSpeech(game, aim) {
      const box = this.speechLayout(game, aim);
      if (!box) return;
      const c = this.ctx, u = game.layout.unit, age = game.time - game.speech.startedAt;
      c.save();
      c.globalAlpha = Math.min(clamp(age / .12, 0, 1), clamp(((game.speech.duration ?? DIALOGUE.duration) - age) / .2, 0, 1));
      c.translate(box.x, box.y);
      const edge = 2 * u, step = 6 * u, right = box.width - edge, bottom = box.height - edge;
      const tail = box.tailX - box.x;
      // One stepped silhouette keeps the angled tail attached to the pixel-rounded bubble.
      const points = [
        [edge + step * 2, edge], [right - step * 2, edge],
        [right - step * 2, edge + step], [right - step, edge + step],
        [right - step, edge + step * 2], [right, edge + step * 2],
        [right, bottom - step * 2], [right - step, bottom - step * 2],
        [right - step, bottom - step], [right - step * 2, bottom - step],
        [right - step * 2, bottom], [tail + 10 * u, bottom],
        [tail + 10 * u, bottom + 4 * u], [tail + 6 * u, bottom + 4 * u],
        [tail + 6 * u, bottom + 8 * u], [tail + 2 * u, bottom + 8 * u],
        [tail + 2 * u, bottom + box.tailHeight], [tail - 10 * u, bottom + box.tailHeight],
        [tail - 10 * u, bottom + 8 * u], [tail - 6 * u, bottom + 8 * u],
        [tail - 6 * u, bottom], [edge + step * 2, bottom],
        [edge + step * 2, bottom - step], [edge + step, bottom - step],
        [edge + step, bottom - step * 2], [edge, bottom - step * 2],
        [edge, edge + step * 2], [edge + step, edge + step * 2],
        [edge + step, edge + step], [edge + step * 2, edge + step]
      ];
      c.lineWidth = 4 * u;
      c.lineJoin = 'miter';
      for (const offset of [box.shadow, 0]) {
        c.beginPath();
        points.forEach(([x, y], i) => i ? c.lineTo(x, y + offset) : c.moveTo(x, y + offset));
        c.closePath();
        c.fillStyle = offset ? '#513565' : C.ink;
        c.strokeStyle = offset ? '#513565' : '#1a1323';
        c.fill();
        c.stroke();
      }
      c.fillStyle = C.white;
      c.fillRect(18 * u, 5 * u, box.width - 36 * u, 3 * u);
      c.font = box.font;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#302039';
      box.lines.forEach((line, i) => c.fillText(line, box.width / 2, 12 * u + (i + .5) * box.lineHeight));
      c.restore();
    }
    drawEffects(game) {
      const c = this.ctx,
        l = game.layout;
      this.effects = this.effects.filter(e => game.time - e.time < .7);
      for (const e of this.effects) {
        const age = game.time - e.time;
        if ((e.type === 'hit' || e.type === 'recovery') && age < .13) {
          const t = age / .13, strength = (e.type === 'recovery' ? 1.25 : 1) * l.unit;
          c.save();
          c.translate(e.x, e.y);
          c.rotate(e.angle || 0);
          c.globalAlpha = 1 - t;
          c.strokeStyle = C.yellow;
          c.lineWidth = 3 * l.unit;
          if (!this.reducedMotion) {
            c.beginPath();
            c.arc(0, 0, (9 + t * 28) * strength, 0, Math.PI * 2);
            c.stroke();
          }
          c.fillStyle = C.white;
          c.beginPath();
          for (let i = 0; i < 16; i++) {
            const angle = i * Math.PI / 8;
            const radius = (i % 2 ? 5 : i % 4 ? 14 : 24) * strength * (1 - t * .4);
            const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.closePath();
          c.fill();
          c.restore();
        }
        if (age < .38) for (const p of e.particles) {
          c.save();
          c.globalAlpha = 1 - age / .38;
          c.translate(e.x + p.vx * age, e.y + p.vy * age + 120 * age * age);
          c.rotate(p.spin + age * 4);
          this.ellipse(0, 0, 4.5 * l.unit, 2 * l.unit, p.color);
          c.strokeStyle = '#b79a5960';
          c.lineWidth = .8;
          c.stroke();
          c.restore();
        }
        if (e.type === 'fire' || e.suppressPopup) continue;
        c.save();
        c.globalAlpha = clamp(1 - (age - .35) / .35, 0, 1);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `${26 * l.unit}px Mulmaru, sans-serif`;
        c.lineJoin = 'round';
        c.lineWidth = 5 * l.unit;
        c.strokeStyle = C.cream;
        const text = e.type === 'upgrade' ? 'UP!' : e.type === 'damage' ? '−1' : `+${e.score}`;
        const x = clamp(e.popupX ?? e.x, 60 * l.unit, l.width - 60 * l.unit);
        const y = Math.max(l.fieldTop + 15, (e.popupY ?? e.y) - age * 40);
        c.strokeText(text, x, y);
        c.fillStyle = e.type === 'damage' ? C.violet : C.yellow;
        c.fillText(text, x, y);
        if (e.combo >= 2) {
          c.font = `${15 * l.unit}px Mulmaru, sans-serif`;
          c.fillStyle = C.ink;
          c.strokeText(`${e.combo} COMBO`, x, y + 24 * l.unit);
          c.fillText(`${e.combo} COMBO`, x, y + 24 * l.unit);
        }
        c.restore();
      }
    }
  }
  return Renderer;
});
