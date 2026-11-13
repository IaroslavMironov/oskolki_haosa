/* Кодекс «Осколки хаоса» — движок. Контент — в data.js, рисунок карты — в map.js */
(() => {
const D = window.CODEX;
const OPT = window.OPT || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const narrow = () => innerWidth <= 900;
if (fine) document.documentElement.classList.add('fine');
// после перезагрузки всегда начинаем сверху, без восстановления старой позиции
history.scrollRestoration = 'manual';
scrollTo({ top: 0, behavior: 'instant' });

const TYPES = { characters: 'Персонажи', timeline: 'Хроника', events: 'События', locations: 'Локации', songs: 'Песни' };
const ONE = { characters: 'Персонаж', timeline: 'Хроника', events: 'Событие', locations: 'Локация', songs: 'Песня' };
const CHIP = { characters: '', timeline: 'gold', events: 'gold', locations: 'violet', songs: '' };
const FACTION = { otryad: 'Отряд', dvor: 'Двор', teni: 'Тени' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

/* ── связи: прямые + обратные ── */
const find = (t, title) => (D[t] || []).find(i => i.title === title);
const links = new Map();
const addLink = (item, t, title) => {
  if (!links.has(item)) links.set(item, {});
  (links.get(item)[t] ||= new Set()).add(title);
};
for (const t in TYPES) for (const item of D[t]) {
  item.type = t;
  for (const rt in TYPES) for (const title of item[rt] || []) {
    const target = find(rt, title);
    if (!target) continue;
    addLink(item, rt, title);
    addLink(target, t, item.title);
  }
}

/* ═══════════ Картинки: WebP нужного размера (opt/, см. tools/optimize.py) ═══════════ */
const stem = src => 'opt/' + src.replace(/\.\w+$/, '');
const srcset = src => OPT[src] ? OPT[src].map(w => `${stem(src)}-${w}.webp ${w}w`).join(', ') : '';
// один URL под нужную ширину (для фонов, постеров, лайтбокса); нет в манифесте — оригинал
const best = (src, want) => { const s = OPT[src]; if (!s) return src; return `${stem(src)}-${s.find(w => w >= want) || s[s.length - 1]}.webp`; };
const SIZES = {
  card: '(max-width: 900px) 50vw, 300px',
  chron: '(max-width: 900px) 84vw, 440px',
  full: '100vw',
  entry: '(max-width: 900px) 100vw, 50vw',
  panel: '(max-width: 900px) 100vw, 320px',
  thumb: '120px'
};
const imgTag = (src, alt = '', sizes = SIZES.full, cls = '', eager = false) =>
  `<img class="${cls}" src="${esc(best(src, 960))}" ${OPT[src] ? `srcset="${srcset(src)}" sizes="${sizes}"` : ''} alt="${esc(alt)}" decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>`;

/* картинка или «оживлённое» видео.
   mode: 'auto' — играет, пока видно на экране; 'hover' — по наведению; 'play' — сразу */
//       'one' — карточки на телефоне: одновременно играет только одно видео (см. initCharacters)
function media(item, cls = '', mode = 'auto', sizes = SIZES.full) {
  const preload = { auto: 'none', one: 'metadata' }[mode] || 'auto';
  if (item.video) return `<video class="${cls}" src="${esc(item.video)}" poster="${esc(item.img ? best(item.img, 480) : '')}" muted loop playsinline preload="${preload}" ${mode === 'play' ? 'autoplay' : mode === 'auto' ? 'data-auto' : ''}></video>`;
  return item.img ? imgTag(item.img, item.title, sizes, cls) : '';
}
const vidIo = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause()), { threshold: .25 });
const watchVideos = (root = document) => $$('video[data-auto]', root).forEach(v => vidIo.observe(v));
const LINK_NAMES = { yandex: 'Яндекс Музыка', vk: 'VK Музыка', vkGroup: 'Сообщество VK' };
const LINK_ICON = { yandex: 'i-yandex', vk: 'i-vk', vkGroup: 'i-vk' };
const icon = k => LINK_ICON[k] ? `<svg class="li" aria-hidden="true"><use href="#${LINK_ICON[k]}"/></svg>` : '';
// keys — какие ссылки показывать (на странице песни сообщество не нужно)
const linkBtns = (links, cls = 'btn ghost listen', keys = Object.keys(LINK_NAMES)) => keys.filter(k => links?.[k])
  .map(k => `<a class="${cls}" href="${esc(links[k])}" target="_blank" rel="noopener">${icon(k)}${LINK_NAMES[k]} <span aria-hidden="true">↗</span></a>`).join('');
const openAttr = item => `data-open="${item.type}|${esc(item.title)}"`;

/* общее состояние кадра: всё, что зависит от прокрутки, считаем только когда она изменилась */
const S = { y: -1, vh: innerHeight, max: 1, dirty: true, modal: false, heat: 0 };

/* ═══════════ Заставка ═══════════ */
function initSplash() {
  const t = $('#splash-title');
  let k = 0;
  const row = (word, cls) => `<span class="row ${cls}">${[...word].map(ch => {
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
    return `<span class="ch" style="--tx:${Math.cos(a) * d}px;--ty:${Math.sin(a) * d}px;--r:${(Math.random() - .5) * 120}deg;--d:${.15 + (k++) * .07}s">${ch}</span>`;
  }).join('')}</span>`;
  t.innerHTML = row('ОСКОЛКИ', 'r1') + row('ХАОСА', 'r2');
  const splash = $('#splash'), inner = $('.splash-inner');
  // анимацию букв начинаем только когда шрифт загружен — иначе посреди полёта буквы «перескакивают» на другой шрифт
  const go = () => { if (splash.classList.contains('go')) return; splash.classList.add('go'); setTimeout(() => inner.classList.add('settled'), 3400); };
  Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 2500))]).then(go, go);
  $('#splash-seal').addEventListener('click', breakSeal, { once: true });
}

function breakSeal(e) {
  const splash = $('#splash'), inner = $('.splash-inner', splash);
  const seal = $('#splash-seal');
  splash.classList.add('go');
  inner.classList.add('settled');
  seal.classList.add('broken');
  Theme.unlock(find('songs', D.characters[0].theme)?.preview); // клик по печати — жест пользователя, разрешаем звук
  const enter = () => {
    document.body.classList.remove('locked');
    document.body.classList.add('entered');
    scrollTo({ top: 0, behavior: 'instant' }); // instant: иначе smooth-скролл проезжает всю страницу
    measure();
  };
  if (reduce) { splash.style.transition = 'opacity .6s'; splash.style.opacity = 0; enter(); setTimeout(() => splash.remove(), 700); return; }

  const W = innerWidth, H = innerHeight;
  const px = e.clientX || W / 2, py = e.clientY || H / 2;
  const fx = px / W * 100, fy = py / H * 100;
  // сетка с дрожанием → треугольники-осколки
  const C = W > 700 ? 6 : 3, R = 4, pts = [];
  for (let r = 0; r <= R; r++) {
    pts[r] = [];
    for (let c = 0; c <= C; c++) {
      const edgeX = c === 0 || c === C, edgeY = r === 0 || r === R;
      pts[r][c] = [c / C * 100 + (edgeX ? 0 : (Math.random() - .5) * 70 / C), r / R * 100 + (edgeY ? 0 : (Math.random() - .5) * 70 / R)];
    }
  }
  const tris = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const a = pts[r][c], b = pts[r][c + 1], d = pts[r + 1][c], f = pts[r + 1][c + 1];
    if ((r + c) % 2) tris.push([a, b, f], [a, f, d]); else tris.push([a, b, d], [b, f, d]);
  }
  setTimeout(() => {
    seal.closest('.splash-center').style.visibility = 'hidden';
    // Каждый осколок — блок размером со свой треугольник (а не на весь экран):
    // иначе десятки полноэкранных слоёв съедают видеопамять и iPhone перезагружает вкладку.
    const shards = tris.map(tri => {
      const pp = tri.map(p => [p[0] / 100 * W, p[1] / 100 * H]);
      const x0 = Math.floor(Math.min(...pp.map(p => p[0]))), y0 = Math.floor(Math.min(...pp.map(p => p[1])));
      const x1 = Math.ceil(Math.max(...pp.map(p => p[0]))), y1 = Math.ceil(Math.max(...pp.map(p => p[1])));
      const s = document.createElement('div');
      s.className = 'shard';
      s.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;clip-path:polygon(${pp.map(p => `${(p[0] - x0).toFixed(1)}px ${(p[1] - y0).toFixed(1)}px`).join(',')})`;
      const clone = inner.cloneNode(true);
      clone.classList.add('shard-clone');
      clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      clone.querySelector('.splash-center').style.visibility = 'visible';
      clone.style.cssText = `inset:auto;left:${-x0}px;top:${-y0}px;width:${W}px;height:${H}px`;
      s.appendChild(clone);
      splash.appendChild(s);
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const dx = (cx - fx) * W / 100, dy = (cy - fy) * H / 100, dist = Math.hypot(dx, dy) || 1;
      return { s, dx: dx / dist, dy: dy / dist, dist };
    });
    inner.style.visibility = 'hidden';
    const flash = document.createElement('div');
    flash.className = 'splash-flash';
    flash.style.cssText = `--fx:${fx}%;--fy:${fy}%`;
    splash.appendChild(flash);
    document.body.classList.add('shake');
    Embers.burst(px, py, 90);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      shards.forEach(({ s, dx, dy, dist }) => {
        const force = 300 + Math.random() * 500;
        s.style.transitionDelay = `${dist * .25}ms`;
        s.style.transform = `translate(${dx * force}px, ${dy * force + 240}px) rotate(${(Math.random() - .5) * 90}deg) scale(${.7 + Math.random() * .3})`;
        s.style.opacity = 0;
      });
      enter();
    }));
    setTimeout(() => { splash.remove(); document.body.classList.remove('shake'); }, 2300);
  }, 420);
}

/* ═══════════ Герой: портрет-осколки ═══════════ */
const hero = { shards: [], mx: 0, my: 0, tx: 0, ty: 0, last: '' };
function initHero() {
  $('#hero-tag').textContent = D.hero.tagline;
  const C = [52, 36];
  const polys = [
    [C, [30, 0], [100, 0], [100, 14]],
    [C, [100, 14], [100, 66]],
    [C, [100, 66], [100, 100], [64, 100]],
    [C, [64, 100], [0, 100], [0, 82]],
    [C, [0, 82], [0, 26]],
    [C, [0, 26], [0, 0], [30, 0]]
  ];
  const box = $('#hero-shards');
  hero.portrait = $('#hero-portrait');
  hero.copy = $('.hero-copy');
  const img = imgTag(D.hero.img, 'Айла в горящей короне', '(max-width: 900px) 100vw, 40vw', '', true);
  hero.shards = polys.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'hero-shard';
    el.style.setProperty('--clip', `polygon(${p.map(q => `${q[0]}% ${q[1]}%`).join(',')})`);
    el.innerHTML = i ? img.replace(/alt="[^"]*"/, 'alt=""') : img;
    box.appendChild(el);
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length - C[0], cy = p.reduce((s, q) => s + q[1], 0) / p.length - C[1];
    const l = Math.hypot(cx, cy) || 1;
    return { el, dx: cx / l, dy: cy / l, depth: .5 + (i % 3) * .35, rot: (i % 2 ? 1 : -1) * (2 + i) };
  });
  if (fine) addEventListener('pointermove', e => { hero.tx = e.clientX / innerWidth * 2 - 1; hero.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
}
function tickHero() {
  if (S.y > S.vh * 1.05 && hero.done) return; // герой ушёл с экрана — ничего не считаем
  hero.mx += (hero.tx - hero.mx) * .06;
  hero.my += (hero.ty - hero.my) * .06;
  const hp = clamp(S.y / S.vh);
  const key = `${hp.toFixed(3)}|${hero.mx.toFixed(3)}|${hero.my.toFixed(3)}`;
  if (key === hero.last) return; // ничего не изменилось — не трогаем стили
  hero.last = key; hero.done = hp >= 1;
  hero.portrait.style.setProperty('--hp', hp.toFixed(3));
  const spread = hp * 80 + 3;
  for (const s of hero.shards) {
    s.el.style.transform = `translate3d(${(s.dx * spread + hero.mx * s.depth * 14).toFixed(1)}px, ${(s.dy * spread + hero.my * s.depth * 14).toFixed(1)}px, 0) rotate(${(s.rot * hp).toFixed(2)}deg)`;
  }
  hero.copy.style.transform = `translate3d(${(hero.mx * -10).toFixed(1)}px, ${(hero.my * -8 + hp * -80).toFixed(1)}px, 0)`;
  hero.copy.style.opacity = (1 - hp * 1.2).toFixed(3);
}

/* ═══════════ Пролог ═══════════ */
let proWords = [], proLit = -1;
function initPrologue() {
  $('#prologue-text').innerHTML = D.prologue.split(/\s+/).map(w => {
    const hot = /^\*|\*[.,—!?]*$/.test(w);
    return `<span class="w${hot ? ' hot' : ''}">${esc(w.replace(/\*/g, ''))}</span>`;
  }).join(' ');
  proWords = $$('#prologue-text .w');
}

/* ═══════════ Персонажи ═══════════ */
function initCharacters() {
  $('#cards').innerHTML = D.characters.map((c, i) => `
    <article class="card" ${openAttr(c)} data-faction="${c.faction}" data-reveal style="--i:${i % 4}" tabindex="0" aria-label="${esc(c.title)} — открыть в кодексе">
      <div class="card-in">
        <div class="card-media">${media(c, '', fine ? 'hover' : 'one', SIZES.card)}</div>
        <div class="card-glare"></div>
        <div class="card-frame"></div>
        ${c.theme ? '<span class="card-sing" aria-hidden="true"></span>' : ''}
        <div class="card-body">
          <span class="card-tag">${esc(FACTION[c.faction] || '')}${c.role ? ' · ' + esc(c.role) : ''}</span>
          <h3>${esc(c.title)}</h3>
          ${c.epithet ? `<p class="card-ep">${esc(c.epithet)}</p>` : ''}
        </div>
      </div>
    </article>`).join('');

  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#filters button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    let k = 0;
    $$('#cards .card').forEach(card => {
      const show = b.dataset.f === 'all' || card.dataset.faction === b.dataset.f;
      card.classList.toggle('out', !show);
      card.classList.remove('pop');
      if (show) { void card.offsetWidth; card.style.setProperty('--k', k++); card.classList.add('pop'); }
    });
    measure();
  });

  // Телефон: четыре видео сразу дают ~50% рывков на слабом CPU — играет только самое видимое
  if (!fine) {
    const ratio = new Map();
    const pick = new IntersectionObserver(es => {
      es.forEach(e => ratio.set(e.target, e.intersectionRatio));
      let top = null, best = .5;
      ratio.forEach((r, v) => { if (r > best) { best = r; top = v; } });
      ratio.forEach((r, v) => v === top ? v.play().catch(() => {}) : v.pause());
    }, { threshold: [0, .25, .5, .75, 1] });
    $$('#cards video').forEach(v => pick.observe(v));
  }

  $$('#cards .card').forEach((card, i) => {
    const v = fine && $('video', card);
    const theme = find('songs', D.characters[i].theme);
    card.addEventListener('pointerenter', () => { v && v.play().catch(() => {}); fine && Theme.hover(theme, card); });
    card.addEventListener('pointerleave', () => {
      Theme.leave(card);
      v && v.pause();
      const s = card.style; ['--rx', '--ry', '--mx', '--my'].forEach(p => s.removeProperty(p));
    });
    if (!fine) return;
    let raf = 0, ev, rect;
    card.addEventListener('pointerenter', () => { rect = card.getBoundingClientRect(); });
    card.addEventListener('pointermove', e => {
      ev = e;
      if (raf) return;
      raf = requestAnimationFrame(() => { // не чаще кадра, без повторного замера размеров
        raf = 0;
        const r = rect || card.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        const s = card.style;
        s.setProperty('--ry', `${((x - .5) * 16).toFixed(2)}deg`);
        s.setProperty('--rx', `${((.5 - y) * 14).toFixed(2)}deg`);
        s.setProperty('--mx', (x * 2 - 1).toFixed(3));
        s.setProperty('--my', (y * 2 - 1).toFixed(3));
        s.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
        s.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      });
    }, { passive: true });
  });
}

/* ── тема персонажа: отрывок при задержке курсора на карточке ── */
const Theme = (() => {
  const a = new Audio();
  a.preload = 'none';
  let timer = 0, fadeRaf = 0, cur = null;
  let on = true;
  try { on = localStorage.getItem('codex-sound') !== 'off'; } catch {}
  const fade = (to, ms, done) => {
    cancelAnimationFrame(fadeRaf);
    const from = a.volume, t0 = performance.now();
    const step = t => { const k = clamp((t - t0) / ms); a.volume = from + (to - from) * k; k < 1 ? (fadeRaf = requestAnimationFrame(step)) : done?.(); };
    fadeRaf = requestAnimationFrame(step);
  };
  const stop = () => { clearTimeout(timer); if (cur) cur.classList.remove('sing'); cur = null; if (!a.paused) fade(0, 450, () => a.pause()); };
  const btn = $('#sound-toggle');
  const paint = () => { btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', on); btn.setAttribute('aria-label', on ? 'Выключить звук персонажей' : 'Включить звук персонажей'); btn.title = on ? 'Звук персонажей: вкл' : 'Звук персонажей: выкл'; };
  btn.addEventListener('click', () => { Theme.unlock(); on = !on; try { localStorage.setItem('codex-sound', on ? 'on' : 'off'); } catch {} if (!on) stop(); paint(); });
  paint();
  const say = (card, text) => { const tag = $('.card-sing', card); if (tag) tag.textContent = text; cur = card; card.classList.add('sing'); };
  return {
    hover(song, card) {
      if (!song?.preview || (playing && !player.paused)) return; // не перебиваем включённую вручную песню
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!on) return say(card, '🔇 Звук выключен — кнопка вверху');
        if (!a.src.endsWith(song.preview)) a.src = song.preview;
        a.currentTime = 1.1; // пропускаем вшитое в отрывок затухание
        a.volume = 0;
        a.play().then(() => { fade(.8, 300); say(card, '♪ ' + song.title); })
          .catch(() => { say(card, '🔇 Браузер заблокировал звук — кликни по странице'); btn.classList.add('ask'); });
      }, 250);
    },
    leave: stop,
    stop,
    // вызывается в момент клика: «разблокирует» элемент для строгих браузеров (Safari и др.)
    unlock(src) {
      if (a.dataset.unlocked) return;
      a.dataset.unlocked = 1;
      if (!a.src && src) a.src = src;
      a.muted = true;
      a.play().then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; delete a.dataset.unlocked; });
      btn.classList.remove('ask');
    }
  };
})();

/* ═══════════ Хроника ═══════════ */
function initChronicle() {
  $('#chron-track').innerHTML = D.timeline.map(t => {
    const songs = (t.songs || []).map(s => find('songs', s)).filter(Boolean);
    return `
    <article class="chron-panel" ${openAttr(t)} tabindex="0">
      ${t.future ? '<div class="chron-future" aria-hidden="true">?</div>' : `<div class="chron-img">${media(t, '', 'auto', SIZES.chron)}</div>`}
      <div>
        <div class="chron-year">${esc(t.year)}</div>
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.text)}</p>
        ${songs.length ? `<div class="chips">${songs.map(s => `<button class="chip" ${openAttr(s)}>♪ ${esc(s.title)}</button>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }).join('');
}
function sizeChronicle() {
  const sec = $('#chronicle'), track = $('#chron-track');
  const extra = Math.max(0, track.scrollWidth - innerWidth);
  sec.style.height = `${extra + innerHeight}px`;
  sec._extra = extra;
}

/* ═══════════ События ═══════════ */
function initEvents() {
  const actions = ev => `<div class="scene-actions"><button class="btn" ${openAttr(ev)}>Открыть в кодексе</button>${
    (links.get(ev)?.songs ? [...links.get(ev).songs] : []).map(s => `<button class="btn ghost" ${openAttr(find('songs', s))}>♪ ${esc(s)}</button>`).join('')}</div>`;
  $('#scenes').innerHTML = D.events.map(ev => {
    if (ev.scene === 'blood') {
      const drips = Array.from({ length: narrow() ? 12 : 22 }, () =>
        `<i class="drip" style="left:${Math.random() * 100}%;--w:${4 + Math.random() * 12}px;--len:${15 + Math.random() * 60};--s:${Math.random() * .35}"></i>`).join('');
      return `<div class="scene scene-blood" data-progress>
        <div class="scene-sticky">
          <div class="scene-bg">${media(ev)}</div>
          <div class="blood-veil"></div>
          <div class="drips" aria-hidden="true"><div class="drip-top"></div>${drips}</div>
          <div class="scene-text">
            <p class="kicker" style="--t:.05">${esc(ev.year || '')}</p>
            <h2 class="blood-title" style="--t:.12">${esc(ev.title)}</h2>
            <p style="--t:.3">${esc(ev.text)}</p>
            <div style="--t:.45">${actions(ev)}</div>
          </div>
        </div></div>`;
    }
    if (ev.scene === 'torch') return `<div class="scene scene-torch" id="torch">
        <div class="scene-bg">${media(ev)}</div>
        <div class="torch-dark"></div>
        <p class="torch-hint">${fine ? 'Веди факелом' : 'Коснись тьмы'}</p>
        <div class="scene-text" data-reveal>
          <p class="kicker">${esc(ev.year || '')}</p>
          <h2>${esc(ev.title)}</h2>
          <p>${esc(ev.text)}</p>
          ${actions(ev)}
        </div></div>`;
    if (ev.scene === 'letter') {
      const lines = (ev.letter || ev.text).split('\n');
      let i = 0;
      return `<div class="scene scene-letter">
        <div class="scene-text" data-reveal>
          <p class="kicker">${esc(ev.year || '')}</p>
          <h2>${esc(ev.title)}</h2>
          <p>${esc(ev.text)}</p>
          <div class="scene-actions">${actions(ev).replace(/^<div class="scene-actions">|<\/div>$/g, '')}<button class="btn ghost" data-full="${esc(ev.img)}">Оригинал письма</button></div>
        </div>
        <div class="letter-stage" id="letter-stage">
          <div class="envelope">
            <div class="env-flap"></div>
            <button class="seal" id="letter-seal" aria-label="Сломать печать письма">
              <span class="seal-half l"><svg aria-hidden="true"><use href="#crown"/></svg></span>
              <span class="seal-half r"><svg aria-hidden="true"><use href="#crown"/></svg></span>
            </button>
          </div>
          <p class="letter-hint">Сломай печать</p>
          <div class="parchment">${lines.map(l => l.trim() ? `<span class="ln" style="--i:${i++}">${esc(l)}</span>` : '<span class="gap"></span>').join('')}</div>
        </div></div>`;
    }
    return `<div class="scene scene-plain">
      <div class="scene-bg">${media(ev)}</div>
      <div class="scene-text" data-reveal><p class="kicker">${esc(ev.year || '')}</p><h2>${esc(ev.title)}</h2><p>${esc(ev.text)}</p>${actions(ev)}</div></div>`;
  }).join('');

  const seal = $('#letter-seal');
  seal?.addEventListener('click', e => {
    seal.classList.add('broken');
    $('#letter-stage').classList.add('open');
    Embers.burst(e.clientX, e.clientY, 40, 'blood');
  }, { once: true });

  const torch = $('#torch');
  if (torch) {
    const st = torch._t = { x: .5, y: .45, tx: .5, ty: .45, last: 0, on: false, el: torch, hint: $('.torch-hint', torch) };
    const move = e => {
      const r = torch.getBoundingClientRect();
      st.tx = (e.clientX - r.left) / r.width; st.ty = (e.clientY - r.top) / r.height;
      st.last = performance.now();
      st.hint.classList.add('gone');
    };
    torch.addEventListener('pointermove', move, { passive: true });
    torch.addEventListener('pointerdown', move, { passive: true });
    torch.addEventListener('pointerenter', () => $('.cursor-ring')?.classList.add('torch'));
    torch.addEventListener('pointerleave', () => $('.cursor-ring')?.classList.remove('torch'));
    new IntersectionObserver(([en]) => st.on = en.isIntersecting).observe(torch);
    tickTorch.st = st;
  }
}
function tickTorch(t) {
  const st = tickTorch.st;
  if (!st?.on) return;
  if (t - st.last > 2500) { // автопилот: факел бродит сам
    st.tx = .5 + Math.sin(t / 2100) * .3;
    st.ty = .45 + Math.sin(t / 1300) * .18;
  }
  st.x += (st.tx - st.x) * .08; st.y += (st.ty - st.y) * .08;
  const r = (innerWidth < 700 ? 170 : 280) * (1 + Math.sin(t / 90) * .03 + Math.sin(t / 37) * .02);
  const s = st.el.style;
  s.setProperty('--x', `${(st.x * 100).toFixed(2)}%`); s.setProperty('--y', `${(st.y * 100).toFixed(2)}%`); s.setProperty('--r', `${r.toFixed(0)}px`);
}

/* ═══════════ Карта ═══════════ */
const Map2 = { world: null, stage: null, k: 1, sel: -1 };
function initMap() {
  const L = Object.fromEntries(D.locations.map(l => [l.title, l.map]));
  const art = CodexMap.build({ castle: L['Замок Элронда'], forest: L['Лес у замка'], town: L['Дороги и таверны'] });
  const { W, H } = art;
  const pct = (x, y) => `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%`;
  const stage = Map2.stage = $('#map-stage'), world = Map2.world = $('#map-world'), wrap = $('.map-wrap');

  // рисунок → картинка один раз (рельеф не живёт в DOM и не перерисовывается при анимациях)
  const img = $('#map-art');
  const url = URL.createObjectURL(new Blob([art.svg], { type: 'image/svg+xml' }));
  img.onload = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => wrap.classList.add('ready'));
  img.src = url;

  // путь побега — отдельный лёгкий слой, прорисовывается при появлении карты
  const d = CodexMap.poly(art.route);
  $('#map-route').innerHTML = `
    <defs><mask id="route-mask" maskUnits="userSpaceOnUse"><path class="route-draw" d="${d}" pathLength="1" stroke="#fff" stroke-width="16" fill="none" stroke-linecap="round"/></mask></defs>
    <g mask="url(#route-mask)" fill="none" stroke-linecap="round">
      <path d="${d}" stroke="#ff2d95" stroke-opacity=".22" stroke-width="12"/>
      <path d="${d}" stroke="#ff7ac3" stroke-width="3.2" stroke-dasharray="11 8"/>
    </g>`;

  // подписи (HTML — чтобы был фирменный шрифт)
  const mid = art.route[Math.floor(art.route.length * .45)];
  const labels = [
    ['map-title', 250, H - 121, 'Королевство Элронда'],
    ['map-region', 300, 288, 'Северный хребет'],
    ['map-region', art.dark.x, art.dark.y - 112, 'Тёмная чаща'],
    ['map-region small river', art.bridge.x + 56, art.bridge.y - 240, 'река'],
    ['map-north', W - 140, 40, 'С'],
    ['map-note', art.trap.x, art.trap.y + 30, 'Здесь Айла спасла Ильви из капкана'],
    ['map-note', art.dark.x + 10, art.dark.y + 66, 'Изба на курьих ногах · «След в след»'],
    ['map-note hot', mid[0] - 70, mid[1] - 18, 'Путь побега · ночь бойни']
  ];
  $('#map-labels').innerHTML = labels.map(([c, x, y, t]) => `<span class="${c}" style="${pct(x, y)}">${esc(t)}</span>`).join('');
  $('#map-pins').innerHTML = D.locations.map((l, i) => l.map ? `
    <button class="map-pin" data-loc="${i}" style="${pct(l.map.x, l.map.y)}" aria-label="${esc(l.title)}">
      <span class="pin-ring"></span><span class="pin-dot"></span><span class="pin-name">${esc(l.title)}</span>
    </button>` : '').join('');

  const panel = $('#map-panel'), reset = $('#map-reset');
  // панель выезжает с противоположной от метки стороны, чтобы не закрывать то, что выбрали
  const show = i => {
    const l = D.locations[i];
    panel.classList.toggle('left', !narrow() && l.map && l.map.x / W > .55);
    panel.classList.add('on');
    if (Map2.sel === i) return;
    Map2.sel = i;
    $$('.map-pin').forEach(p => p.classList.toggle('active', +p.dataset.loc === i));
    panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
    panel.innerHTML = `<div class="mp-img">${media(l, '', 'play', SIZES.panel)}</div><p class="kicker" style="margin-top:14px">Локация</p><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p><button class="btn" ${openAttr(l)}>Открыть в кодексе</button>`;
  };
  // «камера»: подлетает к локации (ПК) или прокручивает карту к ней (телефон)
  const focus = i => {
    const p = D.locations[i].map; if (!p) return;
    show(i);
    if (narrow()) { stage.scrollTo({ left: p.x / W * world.offsetWidth - stage.clientWidth / 2, behavior: 'smooth' }); return; }
    const sw = stage.clientWidth, sh = stage.clientHeight, k = 1.75, pw = panel.offsetWidth + 40;
    const cx = panel.classList.contains('left') ? pw + (sw - pw) / 2 : (sw - pw) / 2; // центр свободной от панели части
    const tx = clamp(cx - p.x / W * sw * k, sw - sw * k, 0), ty = clamp(sh / 2 - p.y / H * sh * k, sh - sh * k, 0);
    world.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${k})`;
    wrap.classList.add('zoomed'); reset.hidden = false;
  };
  const unfocus = () => {
    world.style.transform = ''; wrap.classList.remove('zoomed'); reset.hidden = true;
    if (!narrow()) { panel.classList.remove('on'); $$('.map-pin').forEach(p => p.classList.remove('active')); Map2.sel = -1; }
  };
  $$('.map-pin').forEach(p => {
    // наведение только подсвечивает метку (CSS); панель — по клику, вместе с «камерой»,
    // иначе всплывающая панель закрывала соседние метки
    p.addEventListener('click', e => { e.stopPropagation(); focus(+p.dataset.loc); });
  });
  stage.addEventListener('click', e => { if (!e.target.closest('.map-pin') && (wrap.classList.contains('zoomed') || panel.classList.contains('on'))) unfocus(); });
  reset.addEventListener('click', unfocus);
  addEventListener('keydown', e => e.key === 'Escape' && wrap.classList.contains('zoomed') && entry.el.hidden && unfocus());

  // лёгкий наклон карты за курсором (только transform)
  if (fine && !reduce) {
    const tilt = $('#map-tilt'); let raf = 0, ev;
    stage.addEventListener('pointermove', e => {
      ev = e; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const r = stage.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width - .5, y = (ev.clientY - r.top) / r.height - .5;
        tilt.style.transform = `rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg)`;
      });
    }, { passive: true });
    stage.addEventListener('pointerleave', () => { tilt.style.transform = ''; });
  }
  if (narrow()) show(0); // на ПК панель появляется по наведению на метку
  // на телефоне стартуем с замка
  requestAnimationFrame(() => { if (narrow() && L['Замок Элронда']) stage.scrollLeft = L['Замок Элронда'].x / W * world.offsetWidth - 60; });
}

/* ═══════════ Гадание ═══════════ */
function initOracle() {
  $('.oracle-portrait').innerHTML = imgTag('vorozheya.jpg', 'Ворожея', '(max-width: 900px) 260px, 380px');
  const box = $('#ocards'), again = $('#oracle-again');
  if (!D.prophecies?.length) { // раздел запечатан до выхода трека
    $('#oracle').classList.add('sealed');
    box.innerHTML = [0, 1, 2].map(i => `
      <button class="ocard" style="--i:${i}" aria-label="Карта запечатана">
        <span class="ocard-face ocard-back"><svg aria-hidden="true"><use href="#eye"/></svg><i class="ocard-lock"></i></span>
      </button>`).join('');
    const msg = $('#oracle-msg');
    box.addEventListener('click', e => {
      const c = e.target.closest('.ocard'); if (!c) return;
      c.classList.remove('deny'); void c.offsetWidth; c.classList.add('deny');
      const r = c.getBoundingClientRect();
      Embers.burst(r.left + r.width / 2, r.top + r.height / 2, 24, 'violet');
      msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
    });
    return;
  }
  const deal = () => {
    box.classList.remove('drawn');
    again.hidden = true;
    const pool = [...D.prophecies].sort(() => Math.random() - .5);
    box.innerHTML = [0, 1, 2].map(i => `
      <button class="ocard" style="--i:${i}" aria-label="Вытянуть карту ${i + 1}">
        <span class="ocard-face ocard-back"><svg aria-hidden="true"><use href="#eye"/></svg></span>
        <span class="ocard-face ocard-front">${esc(pool[i])}</span>
      </button>`).join('');
  };
  box.addEventListener('click', e => {
    const c = e.target.closest('.ocard');
    if (!c || box.classList.contains('drawn')) return;
    c.classList.add('flipped');
    box.classList.add('drawn');
    const r = c.getBoundingClientRect();
    Embers.burst(r.left + r.width / 2, r.top + r.height / 2, 50, 'violet');
    setTimeout(() => (again.hidden = false), 1000);
  });
  again.addEventListener('click', deal);
  deal();
}

/* ═══════════ Песни ═══════════ */
const player = new Audio();
let playing = null;
function initSongs() {
  $('#song-list').innerHTML = D.songs.map((s, i) => `
    <li class="song" data-i="${i}" ${openAttr(s)} tabindex="0">
      <span class="song-num">${ROMAN[i] || i + 1}</span>
      <img class="song-thumb" src="${esc(best(s.img, 120))}" alt="" loading="lazy" decoding="async">
      <span><span class="song-title">${esc(s.title)}</span><span class="song-sub">${esc(s.text)}</span></span>
      <span class="song-right">${s.clip ? '<span class="song-badge hot">Клип</span>' : ''}${s.lyrics ? '<span class="song-badge">Текст</span>' : ''}<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${s.preview ? `<button class="song-play" data-play="${esc(s.title)}" aria-label="Слушать отрывок «${esc(s.title)}»">▶</button>` : ''}</span>
    </li>`).join('');
  const sleeve = $('#sleeve'), label = $('#vinyl-label'), wrap = $('.songs');
  const setCover = s => { const u = `url("${best(s.img, 480)}")`; sleeve.style.backgroundImage = u; label.style.backgroundImage = u; };
  setCover(D.songs[0]);
  $$('.song').forEach(row => {
    row.addEventListener('pointerenter', () => { setCover(D.songs[row.dataset.i]); wrap.classList.add('hovering'); });
    row.addEventListener('pointerleave', () => wrap.classList.remove('hovering'));
  });
  player.addEventListener('ended', () => setPlaying(null));
  $('#now-toggle').addEventListener('click', () => playing && togglePlay(playing));
  $('#now-title').addEventListener('click', e => playing && openEntry(playing, e.clientX, e.clientY));
  // клип со звуком глушит отрывок
  document.addEventListener('play', e => { if (e.target.closest?.('.clip') && playing) { player.pause(); setPlaying(null); } }, true);
}
function setPlaying(song) {
  playing = song;
  $$('.song').forEach(r => r.classList.toggle('playing', !!song && D.songs[r.dataset.i] === song));
  $$('[data-play]').forEach(b => {
    const on = song && b.dataset.play === song.title, ic = b.classList.contains('song-play');
    b.textContent = ic ? (on ? '❚❚' : '▶') : (on ? '❚❚ Пауза' : '▶ Слушать отрывок');
  });
  const now = $('#now');
  now.classList.toggle('on', !!song);
  if (song) { $('#now-title').textContent = song.title; $('#now-title').setAttribute('aria-label', `Открыть песню «${song.title}»`); }
  beat.eq = song ? $('.song.playing .eq') : null;
}
function togglePlay(song) {
  if (playing === song) { player.pause(); setPlaying(null); return; }
  initAnalyser();
  Theme.stop();
  beat.avg = null; beat.n = 0;
  player.src = song.preview; player.play().catch(() => {}); setPlaying(song);
}

/* ── музыка управляет светом: бас → искры, неон, эквалайзер ── */
const beat = { an: null, data: null, v: 0, prev: 0, eq: null, bar: null };
function initAnalyser() {
  if (beat.an) { beat.ctx.resume(); return; }
  if (location.protocol === 'file:') return; // с file:// Chrome глушит звук через анализатор — играем без подсветки
  try {
    const ctx = beat.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(player);
    beat.an = ctx.createAnalyser(); beat.an.fftSize = 256; beat.an.smoothingTimeConstant = .7;
    src.connect(beat.an); beat.an.connect(ctx.destination);
    beat.data = new Uint8Array(beat.an.frequencyBinCount);
    beat.bar = $('#now-bar');
  } catch { /* без анализатора просто играет */ }
}
function tickBeat() {
  if (!beat.an || !playing || player.paused) { if (beat.v) { beat.v = 0; document.documentElement.style.setProperty('--beat', 0); } return 0; }
  beat.an.getByteFrequencyData(beat.data);
  const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += beat.data[i]; return s / (b - a) / 255; };
  const bass = band(1, 6);
  beat.n = (beat.n || 0) + 1;
  beat.avg = beat.avg == null ? bass : beat.avg + (bass - beat.avg) * (beat.n < 90 ? .2 : .03); // адаптивный порог: вспышки на ударах, а не постоянный гул
  beat.v += (bass - beat.v) * .5;
  const v = clamp((beat.v - beat.avg) * 8);
  document.documentElement.style.setProperty('--beat', v.toFixed(2));
  if (v - beat.prev > .22 && v > .55 && !reduce) for (let i = 0; i < 3; i++) Embers.burst(Math.random() * innerWidth, innerHeight + 5, 5);
  beat.prev = v;
  if (beat.eq) [band(1, 4), band(4, 12), band(12, 30), band(30, 70)].forEach((b, i) => beat.eq.children[i].style.transform = `scaleY(${(.15 + b * .95).toFixed(2)})`);
  if (beat.bar && player.duration) beat.bar.style.transform = `scaleX(${(player.currentTime / player.duration).toFixed(3)})`;
  return v;
}

/* ═══════════ Страница кодекса ═══════════ */
const entry = { el: null, item: null };
function crackSvg() {
  let n = Math.floor(Math.random() * 1e6) + 1;
  const rnd = () => (n = (n * 16807) % 2147483647) / 2147483647;
  let d = '';
  const ox = 70 + rnd() * 20, oy = 20 + rnd() * 30;
  for (let i = 0; i < 7; i++) {
    let x = ox, y = oy, a = rnd() * Math.PI * 2;
    d += `M${x} ${y}`;
    for (let j = 0; j < 5; j++) { a += (rnd() - .5) * .9; x += Math.cos(a) * (6 + rnd() * 10); y += Math.sin(a) * (6 + rnd() * 10); d += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
  }
  return `<svg class="crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="rgba(255,122,195,.75)" stroke-width=".3" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderEntry(item) {
  const t = item.type, rel = links.get(item) || {};
  const gallery = [...new Set([item.img, ...(item.gallery || [])].filter(Boolean))];
  let i = 0; const n = () => `style="--i:${i++}"`;
  const kicker = [ONE[t], FACTION[item.faction], item.role, item.year].filter(Boolean).map(esc).join(' · ');
  const listen = linkBtns(item.links) || (t === 'songs' ? linkBtns(D.links, undefined, ['yandex', 'vk']) : ''); // нет ссылки на трек — ведём на артиста
  $('#entry-body').innerHTML = `
    <div class="entry-media">${item.img || item.video ? media(item, '', 'play', SIZES.entry) : '<div class="entry-noimg" aria-hidden="true">?</div>'}${item.img ? crackSvg() : ''}</div>
    <div class="entry-info">
      <p class="kicker" ${n()}>${kicker}</p>
      <h2 ${n()} id="entry-title">${esc(item.title)}</h2>
      ${item.epithet ? `<p class="entry-ep" ${n()}>${esc(item.epithet)}</p>` : ''}
      ${item.quote ? `<blockquote class="entry-quote" ${n()}>${esc(item.quote)}</blockquote>` : ''}
      <p class="entry-text" ${n()}>${esc(item.text)}</p>
      ${item.preview || listen ? `<div class="scene-actions" ${n()}>${item.preview ? `<button class="btn play-btn" data-play="${esc(item.title)}">${playing === item ? '❚❚ Пауза' : '▶ Слушать отрывок'}</button>` : ''}${listen}</div>` : ''}
      ${item.clip ? `<div class="clip" ${n()}><p class="kicker">Клип · фрагмент</p><video src="${esc(item.clip)}" poster="${esc(item.clipPoster || item.img || '')}" controls playsinline preload="none"></video></div>` : ''}
      ${item.lyrics ? `<div class="lyrics" ${n()}>${esc(item.lyrics)}</div>` : ''}
      ${Object.keys(TYPES).filter(rt => rel[rt]?.size).map(rt => `
        <div class="rel" ${n()}><h4>${TYPES[rt]}</h4><div class="chips">${[...rel[rt]].map(title => {
          const x = find(rt, title); return x ? `<button class="chip ${CHIP[rt]}" ${openAttr(x)}>${rt === 'songs' ? '♪ ' : ''}${esc(title)}</button>` : '';
        }).join('')}</div></div>`).join('')}
      ${gallery.length > 1 ? `<div class="gal" ${n()}>${gallery.map(src => `<button data-full="${esc(src)}" aria-label="Открыть изображение">${imgTag(src, '', SIZES.thumb)}</button>`).join('')}</div>` : ''}
    </div>`;
  entry.el.setAttribute('aria-labelledby', 'entry-title');
  entry.el.scrollTop = 0;
}
function openEntry(item, x, y) {
  const el = entry.el;
  const wasOpen = el.classList.contains('open');
  entry.item = item;
  if (wasOpen) {
    const body = $('#entry-body');
    body.classList.add('swap');
    setTimeout(() => { renderEntry(item); body.classList.remove('swap'); restartAnim(); }, 300);
    return;
  }
  entry.back = document.activeElement;
  renderEntry(item);
  el.style.setProperty('--cx', `${x ?? innerWidth / 2}px`);
  el.style.setProperty('--cy', `${y ?? innerHeight / 2}px`);
  el.hidden = false;
  S.modal = true;
  document.documentElement.classList.add('modal');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  $('#entry-close').focus({ preventScroll: true });
}
function restartAnim() { const el = entry.el; el.classList.remove('open'); void el.offsetWidth; el.classList.add('open'); }
function closeEntry() {
  const el = entry.el;
  if (el.hidden) return;
  el.classList.remove('open');
  document.documentElement.classList.remove('modal');
  S.modal = false; S.dirty = true;
  $$('video', el).forEach(v => v.pause());
  entry.back?.focus?.({ preventScroll: true });
  setTimeout(() => { if (!el.classList.contains('open')) { el.hidden = true; $('#entry-body').innerHTML = ''; } }, 900);
}
function stepEntry(d) {
  const list = D[entry.item.type];
  const i = list.indexOf(entry.item);
  openEntry(list[(i + d + list.length) % list.length]);
}
function initEntry() {
  entry.el = $('#entry');
  $('#entry-close').addEventListener('click', closeEntry);
  $('#entry-prev').addEventListener('click', () => stepEntry(-1));
  $('#entry-next').addEventListener('click', () => stepEntry(1));
}

/* ── лайтбокс ── */
function openFull(src) {
  const lb = $('#lightbox');
  $('img', lb).src = best(src, 4000);
  lb.hidden = false;
}
$('#lightbox').addEventListener('click', e => e.currentTarget.hidden = true);

/* ── общие клики/клавиши ── */
document.addEventListener('pointerdown', () => Theme.unlock(find('songs', D.characters[0].theme)?.preview), { once: true });
document.addEventListener('click', e => {
  const full = e.target.closest('[data-full]');
  if (full) { e.stopPropagation(); return openFull(full.dataset.full); }
  const play = e.target.closest('[data-play]');
  if (play) return togglePlay(find('songs', play.dataset.play));
  const o = e.target.closest('[data-open]');
  if (!o) return;
  const [t, title] = o.dataset.open.split('|');
  const item = find(t, title);
  if (!item) return;
  openEntry(item, e.clientX || undefined, e.clientY || undefined);
});
let typed = '';
document.addEventListener('keydown', e => {
  if (!$('#lightbox').hidden && e.key === 'Escape') return ($('#lightbox').hidden = true);
  if (!entry.el.hidden) {
    if (e.key === 'Escape') closeEntry();
    if (e.key === 'ArrowRight') stepEntry(1);
    if (e.key === 'ArrowLeft') stepEntry(-1);
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.card, .song, .chron-panel')) { e.preventDefault(); e.target.click(); }
  // пасхалка: набери «хаос»
  if (e.key.length === 1) {
    typed = (typed + e.key.toLowerCase()).slice(-4);
    if (typed === 'хаос' || typed === 'xaoc') chaos();
  }
});
function chaos() {
  document.body.classList.add('glitch');
  Embers.burst(innerWidth / 2, innerHeight / 2, 160);
  setTimeout(() => document.body.classList.remove('glitch'), 1300);
}

/* ═══════════ Искры (canvas) ═══════════ */
const Embers = (() => {
  const cv = $('#embers'), ctx = cv.getContext('2d');
  let W, H, parts = [];
  const COLORS = { ember: [[255, 150, 60], [255, 190, 110], [255, 45, 149]], blood: [[220, 30, 50], [150, 10, 30], [255, 90, 70]], violet: [[165, 140, 255], [220, 200, 255], [255, 122, 195]] };
  // цвета заранее строками — без мусора в каждом кадре
  const PAL = Object.fromEntries(Object.entries(COLORS).map(([k, list]) => [k, list.map(([r, g, b]) => [`rgb(${r},${g},${b})`, `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`])]));
  const resize = () => {
    // искры — мягкие пятна, им не нужна ретина: 1–1.25 пикселя на точку в 2–4 раза дешевле
    const dpr = Math.min(fine ? 1.25 : 1, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const spawn = (x, y, o = {}) => {
    const pal = PAL[o.pal || 'ember'];
    parts.push({
      x, y, vx: o.vx ?? (Math.random() - .5) * .4, vy: o.vy ?? -(.3 + Math.random() * .9),
      life: 0, max: o.max ?? 220 + Math.random() * 260, size: o.size ?? .6 + Math.random() * 1.8,
      seed: Math.random() * 100, c: pal[Math.floor(Math.random() * pal.length)], ambient: !!o.ambient
    });
  };
  let lastX = 0, lastY = 0, heat = 0, amb = 0;
  if (fine) addEventListener('pointermove', e => {
    const d = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    if (d > 14 && parts.length < 300) {
      spawn(e.clientX, e.clientY, { vx: (Math.random() - .5) * .6, vy: -.2 - Math.random() * .6, max: 50 + Math.random() * 40, size: .5 + Math.random() * 1.2 });
      lastX = e.clientX; lastY = e.clientY;
    }
  }, { passive: true });
  addEventListener('resize', resize); resize();
  return {
    set heat(v) { heat = v; },
    burst(x, y, n, pal) {
      if (reduce) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 6;
        spawn(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, max: 60 + Math.random() * 90, size: .8 + Math.random() * 2.2, pal });
      }
    },
    tick(t) {
      if (reduce) return;
      const target = (W < 700 ? 22 : 50) * (1 + heat * 1.5);
      if (amb < target && Math.random() < .5) spawn(Math.random() * W, H + 10, { ambient: true, pal: heat > .3 && Math.random() < heat ? 'blood' : 'ember' });
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      let alive = 0; amb = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.life++;
        if (p.life >= p.max || p.y < -20) continue;
        parts[alive++] = p;
        if (p.ambient) amb++;
        p.vx += Math.sin(t / 700 + p.seed) * .012;
        if (!p.ambient) { p.vx *= .965; p.vy = p.vy * .965 - .02; } else p.vy -= .002;
        p.x += p.vx; p.y += p.vy;
        const k = p.life / p.max, a = (k < .1 ? k * 10 : 1 - (k - .1) / .9) * (.6 + Math.sin(t / 60 + p.seed) * .4);
        ctx.globalAlpha = a * .18; ctx.fillStyle = p.c[0];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 4, 0, 6.283); ctx.fill();
        ctx.globalAlpha = a; ctx.fillStyle = p.c[1];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      }
      parts.length = alive;
      ctx.globalAlpha = 1;
    }
  };
})();

/* ═══════════ Курсор ═══════════ */
const cur = { x: -100, y: -100, rx: -100, ry: -100, dot: $('.cursor-dot'), ring: $('.cursor-ring') };
if (fine) {
  addEventListener('pointermove', e => {
    cur.x = e.clientX; cur.y = e.clientY;
    document.documentElement.classList.add('moved');
    const big = !!e.target.closest?.('a, button, [data-open], .ocard');
    if (big !== cur.big) { cur.big = big; cur.ring.classList.toggle('big', big); }
  }, { passive: true });
  document.addEventListener('pointerleave', () => document.documentElement.classList.remove('moved'));
}
function tickCursor() {
  if (!fine) return;
  const dx = cur.x - cur.rx, dy = cur.y - cur.ry;
  if (Math.abs(dx) < .1 && Math.abs(dy) < .1 && cur.drawn === cur.x + cur.y) return; // курсор стоит — не пишем стили
  cur.rx += dx * .18; cur.ry += dy * .18; cur.drawn = cur.x + cur.y;
  cur.dot.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
  cur.ring.style.transform = `translate3d(${cur.rx.toFixed(1)}px, ${cur.ry.toFixed(1)}px, 0)`;
}

/* ═══════════ Скролл-механики ═══════════
   Позиции секций меряем только при изменении размеров (measure), а в кадре — одна арифметика от scrollY. */
let prog = [];
const els = {};
function measure() {
  S.vh = innerHeight;
  sizeChronicle();
  prog = $$('[data-progress]').map(el => ({ el, top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight, p: -1, id: el.id, blood: el.classList.contains('scene-blood') }));
  S.max = Math.max(1, document.documentElement.scrollHeight - S.vh);
  S.dirty = true;
}
function tickScroll() {
  const y = S.y, vh = S.vh;
  const scrolled = y > 40;
  if (scrolled !== S.scrolled) { S.scrolled = scrolled; els.nav.classList.toggle('scrolled', scrolled); }
  els.fuse.style.setProperty('--p', (y / S.max).toFixed(4));
  let heat = 0;
  for (const s of prog) {
    if (y + vh < s.top - vh * .2 || y > s.top + s.h) continue;
    const p = clamp((y - s.top) / Math.max(1, s.h - vh));
    if (Math.abs(s.p - p) < .0005) { if (s.blood) heat = Math.max(heat, Math.sin(p * Math.PI)); continue; }
    s.p = p;
    s.el.style.setProperty('--p', p.toFixed(4));
    if (s.blood) heat = Math.max(heat, Math.sin(p * Math.PI));
    if (s.id === 'prologue' && proWords.length) {
      const lit = Math.floor(clamp(p * 1.25) * proWords.length);
      if (lit !== proLit) { const lo = Math.min(lit, proLit), hi = Math.max(lit, proLit); for (let i = Math.max(0, lo); i < Math.min(proWords.length, hi); i++) proWords[i].classList.toggle('lit', i < lit); proLit = lit; }
    }
    if (s.id === 'chronicle') els.track.style.transform = `translate3d(${(-p * (s.el._extra || 0)).toFixed(1)}px,0,0)`;
  }
  S.heat = heat;
}

/* ═══════════ Навигация, появление, пауза анимаций вне экрана ═══════════ */
function initObservers() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  $$('[data-reveal], .map-wrap').forEach(el => io.observe(el));
  const navLinks = $$('.nav-links a'), strip = $('.nav-links');
  const navIo = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    navLinks.forEach(a => {
      const on = a.getAttribute('href') === '#' + e.target.id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      // прокручиваем только полоску меню (scrollIntoView мог дёргать саму страницу)
      if (on && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: a.offsetLeft - strip.clientWidth / 2 + a.offsetWidth / 2, behavior: 'smooth' });
    });
  }), { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach(a => { const s = $(a.getAttribute('href')); s && navIo.observe(s); });
  // бесконечные CSS-анимации (пластинка, «дыхание» картинок, карты) ставим на паузу, когда секции не видно
  const offIo = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('off', !e.isIntersecting)), { rootMargin: '100px 0px' });
  $$('#hero, #chronicle, .scene, #map, #oracle, #songs, .finale').forEach(el => offIo.observe(el));
}

/* ═══════════ Старт ═══════════ */
els.nav = $('#nav'); els.fuse = $('.fuse'); els.track = $('#chron-track');
initSplash(); initHero(); initPrologue(); initCharacters(); initChronicle(); initEvents(); initMap(); initOracle(); initSongs(); initEntry(); initObservers();
watchVideos();
$('#year').textContent = new Date().getFullYear();
$('#finale-links').innerHTML = linkBtns(D.links);
$('#songs-links').innerHTML = linkBtns(D.links, undefined, ['yandex', 'vk']);
$('#nav-social').innerHTML = Object.keys(LINK_NAMES).filter(k => D.links?.[k] && k !== 'vk')
  .map(k => `<a href="${esc(D.links[k])}" target="_blank" rel="noopener" aria-label="${LINK_NAMES[k]}" title="${LINK_NAMES[k]}">${icon(k)}</a>`).join('');

let mRaf = 0;
const remeasure = () => { cancelAnimationFrame(mRaf); mRaf = requestAnimationFrame(measure); };
addEventListener('resize', remeasure);
addEventListener('load', remeasure);
document.fonts?.ready.then(remeasure);
new ResizeObserver(remeasure).observe($('main'));
addEventListener('scroll', () => { S.dirty = true; }, { passive: true });
measure();

(function loop(t) {
  const y = scrollY;
  if (y !== S.y) { S.y = y; S.dirty = true; }
  if (!S.modal) {
    if (S.dirty) { tickScroll(); S.dirty = false; }
    tickHero(); tickTorch(t);
    Embers.heat = Math.max(S.heat, tickBeat() * .9);
    Embers.tick(t);
  } else tickBeat();
  tickCursor();
  requestAnimationFrame(loop);
})(0);
})();
