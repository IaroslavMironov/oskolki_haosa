/* Искры: симуляция и отрисовка.
   Обычно работает в отдельном потоке (Web Worker + OffscreenCanvas): искры не тормозят прокрутку
   и сами не замирают, когда основной поток занят. Где так нельзя — этот же код в основном потоке (window.EmbersSim).
   Каждая искра — готовый спрайт свечения (drawImage), а не два круга-пути: для видеокарты в разы дешевле. */
(function (G) {
  const COLORS = {
    ember: [[255, 150, 60], [255, 190, 110], [255, 45, 149]],
    blood: [[220, 30, 50], [150, 10, 30], [255, 90, 70]],
    violet: [[165, 140, 255], [220, 200, 255], [255, 122, 195]]
  };
  const canvas = s => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const S = 32; // спрайт 32×32: ядро ~ четверть радиуса, дальше мягкий ореол
  function sprite(base, hot) {
    const c = canvas(S), x = c.getContext('2d'), g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const rgba = (v, a) => `rgba(${v[0]},${v[1]},${v[2]},${a})`;
    g.addColorStop(0, rgba(hot, 1)); g.addColorStop(.2, rgba(hot, 1)); g.addColorStop(.27, rgba(base, .32));
    g.addColorStop(.6, rgba(base, .12)); g.addColorStop(1, rgba(base, 0));
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return c;
  }
  const hexRgb = k => [1, 3, 5].map(i => parseInt(k.slice(i, i + 2), 16));
  const up = (v, d) => v.map(c => Math.min(255, c + d));

  function Embers(ctx, fine) {
    let W = 1, H = 1, vis = 1, parts = [], heat = 0, amb = 0, glow = null, impulse = 0, aura = null, level = 0, mid = 0, paused = false, odd = false;
    const PAL = {};
    // палитра: набор спрайтов. Пресеты — угли/кровь/фиолет; '#rrggbb' — цвет героя (сам цвет, раскалённый, почти белый)
    const palOf = k => PAL[k] || (PAL[k] = COLORS[k]
      ? COLORS[k].map(c => sprite(c, up(c, 60)))
      : (c => [sprite(c, up(c, 90)), sprite(up(c, 90), [255, 248, 240]), sprite(c, c)])(hexRgb(k)));
    const spawn = (x, y, o = {}) => {
      const pal = palOf(o.pal || 'ember');
      parts.push({
        x, y, vx: o.vx ?? (Math.random() - .5) * .4, vy: o.vy ?? -(.3 + Math.random() * .9),
        life: 0, max: o.max ?? 220 + Math.random() * 260, size: o.size ?? .6 + Math.random() * 1.8,
        seed: Math.random() * 100, img: pal[Math.floor(Math.random() * pal.length)], ambient: !!o.ambient
      });
    };
    return {
      resize(w, h, dpr, v) {
        W = w; H = h; vis = v; glow = null;
        ctx.canvas.width = Math.round(W * dpr); ctx.canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
      set(o) {
        if ('heat' in o) heat = o.heat; if ('level' in o) level = o.level; if ('mid' in o) mid = o.mid;
        if ('aura' in o) aura = o.aura; if ('vis' in o) { vis = o.vis; glow = null; }
        if ('paused' in o) { paused = o.paused; if (paused) ctx.clearRect(0, 0, W, H); }
      },
      trail(x, y) {
        if (parts.length < 300) spawn(x, y, { vx: (Math.random() - .5) * .6, vy: -.2 - Math.random() * .6, max: 50 + Math.random() * 40, size: .5 + Math.random() * 1.2 });
      },
      burst(x, y, n, pal) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 6;
          spawn(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, max: 60 + Math.random() * 90, size: .8 + Math.random() * 2.2, pal });
        }
      },
      // удар в музыке: из карточки играющего героя (или строки трека / мини-плеера) искры его цвета разлетаются наружу
      emit(r, hex, n) {
        if (parts.length > 320) return;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, per = 2 * (r.width + r.height);
        for (let i = 0; i < n; i++) {
          let d = Math.random() * per, x, y; // случайная точка на краю
          if (d < r.width) { x = r.left + d; y = r.top; }
          else if ((d -= r.width) < r.width) { x = r.left + d; y = r.top + r.height; }
          else if ((d -= r.width) < r.height) { x = r.left; y = r.top + d; }
          else { x = r.left + r.width; y = r.top + d - r.height; }
          const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1, s = 2.2 + Math.random() * 3.6;
          spawn(x, y, { vx: dx / l * s, vy: dy / l * s - 1.2, max: 45 + Math.random() * 55, size: .8 + Math.random() * 1.9, pal: hex });
        }
      },
      kick(p = 1) { impulse = p; }, // все искры на экране разом «подпрыгивают» — так ритм видно глазом
      tick(t) {
        if (paused) return;
        // телефон: 30 кадров в секунду для искр — разницы на глаз нет, нагрузка вдвое меньше
        if (!fine && (odd = !odd)) return;
        const music = level, tint = aura && music > .3;
        const target = (W < 700 ? 16 : 50) * (1 + heat * 1.5 + music * .8); // под музыку искр больше
        if (amb < target && Math.random() < .5) spawn(Math.random() * W, H + 10, { ambient: true, pal: tint && Math.random() < .65 ? aura : heat > .3 && Math.random() < heat ? 'blood' : 'ember' });
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        const imp = impulse * music; impulse *= fine ? .9 : .81;
        // снизу дышит отсвет цвета героя: вспыхивает на ударе
        if (music > .01) {
          const bottom = Math.min(H, vis); // на телефоне буфер может быть выше видимого экрана
          const col = aura || '#ff6e28';
          if (!glow || glow.col !== col) {
            // радиус — ровно до верхнего края заливки (bottom * .3): свечение гаснет до нуля, а не обрывается линией
            const cy = bottom + W * .1, g = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, cy - bottom * .3);
            g.addColorStop(0, col); g.addColorStop(.45, col + '55'); g.addColorStop(1, col + '00');
            glow = { g, col, top: bottom * .3, h: bottom * .7 };
          }
          ctx.globalAlpha = music * (.06 + imp * .3); ctx.fillStyle = glow.g; ctx.fillRect(0, glow.top, W, glow.h);
        }
        const sway = mid * music * .05, bright = 1 + imp * 1.4;
        let alive = 0; amb = 0;
        const st = fine ? 1 : 2; // на 30 fps двигаем за кадр вдвое дальше — скорость искр та же
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          p.life += st;
          if (p.life >= p.max || p.y < -20) continue;
          parts[alive++] = p;
          if (p.ambient) amb++;
          p.vx += Math.sin(t / 700 + p.seed) * (.012 + sway) * st;
          if (!p.ambient) { p.vx *= st > 1 ? .931 : .965; p.vy = p.vy * (st > 1 ? .931 : .965) - .02 * st; } else p.vy -= .002 * st;
          p.x += p.vx * st; p.y += p.vy * st;
          if (imp > .02 && p.ambient) { p.y -= imp * 6 * st; p.x += (p.x - W / 2) / W * imp * 4 * st; } // общий рывок вверх и чуть врозь
          const k = p.life / p.max, a = Math.min(1, (k < .1 ? k * 10 : 1 - (k - .1) / .9) * (.6 + Math.sin(t / 60 + p.seed) * .4) * bright);
          const r = p.size * 4;
          ctx.globalAlpha = a; ctx.drawImage(p.img, p.x - r, p.y - r, r * 2, r * 2);
        }
        parts.length = alive;
        ctx.globalAlpha = 1;
      }
    };
  }

  if (typeof document === 'undefined') { // мы — поток-воркер
    let E;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(() => cb(performance.now()), 16);
    const loop = t => { E.tick(t); raf(loop); };
    onmessage = ({ data: m }) => {
      if (m.init) { E = Embers(m.canvas.getContext('2d'), m.fine); E.resize(...m.size); raf(loop); return; }
      E?.[m.k](...m.a);
    };
  } else G.EmbersSim = Embers;
})(self);
