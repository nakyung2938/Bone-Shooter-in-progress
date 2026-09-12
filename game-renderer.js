(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game-core.js'));else root.BonRenderer = factory(root.BonGame);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const {
    COLORS: C,
    CONFIG,
    enemyPose,
    muzzle,
    solveShot,
    trajectoryPoint,
    shotOpacity,
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
    draw(game, aim) {
      const l = game.layout,
        c = this.ctx;
      c.setTransform(this.canvas.width / l.width, 0, 0, this.canvas.height / l.height, 0, 0);
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, l.width, l.height);
      c.fillStyle = C.cream;
      c.fillRect(0, 0, l.width, l.height);
      // The bottom band is the player area; neither the world nor the aiming guide shakes.
      c.fillStyle = '#211b1a';
      c.fillRect(0, l.dangerY, l.width, l.height - l.dangerY);
      c.fillStyle = game.time - game.damageAt < .16 ? '#f05a55b0' : '#f05a5538';
      c.fillRect(0, l.dangerY, l.width, 2 * l.unit);
      c.save();
      c.beginPath();
      c.rect(0, l.fieldTop - 15, l.width, l.height - l.fieldTop + 15);
      c.clip();
      for (const e of [...game.enemies].sort((a, b) => a.y - b.y)) this.enemy(e, game);
      for (const s of game.shots) this.shot(s);
      this.guide(game, aim);
      this.player(game, aim);
      this.drawEffects(game);
      c.restore();
    }
    enemy(e, game) {
      const p = enemyPose(e, game.time),
        since = game.time - e.hitAt;
      this.ellipse(p.x, p.y + p.h * .48, p.w * .40, 5 * game.layout.unit, '#27231e10');
      if (e.hits >= CONFIG.hitsToRecover) {
        const age = game.time - e.recoveredAt;
        if (age < .1) this.sprite(p.sprite, p.x, p.y, p.w, p.h, {
          alpha: 1 - age / .1,
          filter: 'brightness(1.8)'
        });
        const appear = clamp((age - .045) / .12, 0, 1),
          fade = clamp((.72 - age) / .17, 0, 1);
        const pop = this.reducedMotion ? 1 : .88 + Math.sin(clamp(age / .30, 0, 1) * Math.PI) * .15;
        this.sprite(`human_${e.group}`, p.x, p.y - 8 * Math.sin(age / .72 * Math.PI), e.w * pop, e.h * pop, {
          alpha: appear * fade
        });
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
      const c = this.ctx, alpha = shotOpacity(s);
      c.save();
      c.globalAlpha = alpha;
      c.translate(s.x, s.y);
      c.rotate(s.angle);
      c.fillStyle = '#efbc4860';
      c.beginPath();
      c.moveTo(-10, -4);
      c.lineTo(-45, 0);
      c.lineTo(-10, 4);
      c.fill();
      c.restore();
      this.sprite('rice_idle', s.x, s.y, s.size, s.size * 210 / 260, {
        angle: s.angle + .26,
        alpha
      });
    }
    guide(game, aim) {
      if (!aim.active) return;
      const l = game.layout,
        s = solveShot(l, aim.point);
      if (!s) return;
      const c = this.ctx,
        length = Math.min(s.distance, l.height * .27, 270 * l.unit);
      const end = trajectoryPoint(s, length / Math.hypot(s.vx, s.vy));
      c.save();
      c.strokeStyle = '#f05a5560';
      c.lineWidth = 2.5 * l.unit;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(s.x, s.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      this.ellipse(end.x, end.y, 3 * l.unit, 3 * l.unit, C.red);
      c.strokeStyle = '#efbc48c0';
      c.lineWidth = 1.6 * l.unit;
      c.beginPath();
      c.arc(aim.point.x, aim.point.y, 10 * l.unit, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    player(game, aim) {
      const l = game.layout,
        p = l.player,
        elapsed = game.time - game.firedAt;
      const kick = this.reducedMotion ? 0 : Math.sin(clamp(elapsed / .15, 0, 1) * Math.PI) * .08;
      this.ellipse(p.x, p.y + p.h * .40, p.w * .43, 8 * l.unit, '#27231e10');
      this.sprite('bonjuk_bowl', p.x, p.y + kick * 20, p.w * (1 + kick), p.h * (1 - kick));
      const origin = muzzle(l);
      if (game.shots.length === 0 || aim.active) this.sprite('rice_idle', origin.x, origin.y - 9 * l.unit, 55 * l.unit, 55 * l.unit * 210 / 260, {
        angle: -.30
      });
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
        c.fillStyle = C.red;
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
