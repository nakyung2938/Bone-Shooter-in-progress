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
      if (!['hit', 'recovery', 'fire', 'damage'].includes(event.type)) return;
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
      c.strokeStyle = game.time - game.damageAt < .16 ? C.violet : '#b487de70';
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
      c.fillStyle = '#efbc4840';
      c.fillRect(-s.size * .86, -s.size * .13, s.size * .48, s.size * .065);
      c.fillStyle = '#fffef730';
      c.fillRect(-s.size * 1.03, s.size * .075, s.size * .58, s.size * .045);
      c.restore();
      this.sprite(pose.sprite, pose.x, pose.y, pose.w, pose.h, {
        angle: pose.angle,
        alpha
      });
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
      const loaded = projectilePose({ ...origin, size: 104 * l.unit, sprite: game.nextMeal,
        angle: Math.atan2(game.aimDirection.y, game.aimDirection.x) });
      this.sprite(loaded.sprite, origin.x, origin.y, loaded.w, loaded.h, {angle: loaded.angle});
      const art = this.assets.serving_tray;
      if (!art) return;
      const width = 300 * l.unit, height = width * art.height / art.width * (1 - kick * .018);
      // Anchor the tray's base during recoil and keep waiting food behind the entire launcher.
      this.sprite('serving_tray', p.x, p.y + p.h * .5 - height / 2, width, height);
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
        const text = e.type === 'damage' ? '−1' : `+${e.score}`;
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
