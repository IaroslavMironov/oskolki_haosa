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

/* ── выход новых песен (D.releases): до даты всё помеченное release скрыто, после — открыто само;
   newDays дней после выхода — «Новое». С ?preview в адресе — посмотреть заранее, как будет после выхода ── */
const PREVIEW = new URLSearchParams(location.search).has('preview');
const relState = key => {
  const r = D.releases?.[key]; if (!r) return { out: true, fresh: false };
  const at = Date.parse(r.date || ''), out = PREVIEW || at <= Date.now(); // пустая дата → NaN → скрыто
  return { out, fresh: out && (PREVIEW || Date.now() - at < (r.newDays ?? 30) * 864e5) };
};
for (const t in TYPES) D[t] = D[t].filter(i => {
  if (i.reveal) { const s = relState(i.reveal.release); if (s.out) { Object.assign(i, i.reveal); i.isNew = s.fresh; } }
  if (!i.release) return true;
  const s = relState(i.release); i.isNew = s.fresh;
  return s.out;
});
if (D.propheciesRelease && !relState(D.propheciesRelease).out) D.prophecies = []; // гадание запечатано до выхода песни

/* ── связи: прямые + обратные ── */
const find = (t, title) => (D[t] || []).find(i => i.title === title);
const hasTheme = c => !!find('songs', c.theme)?.preview; // тема есть, только когда у её песни есть отрывок
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
  //       'later' — окно кодекса на телефоне: стартует после проявления окна (не в тот же момент, что анимация)
  const preload = { auto: 'none', one: 'metadata', later: 'metadata' }[mode] || 'auto';
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
const ico = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
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
  Theme.unlock(); initAnalyser(); // клик по печати — жест пользователя, разрешаем звук и анализатор
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
  // Осколки — заранее вырезанные картинки с прозрачностью (tools/cut-hero.py, те же многоугольники).
  // Раньше резали на лету через clip-path: на Android это 6 слоёв-масок, которые пересчитывались в каждом кадре.
  hero.shards = polys.map((p, i) => {
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), bw = Math.max(...xs) - x0, bh = Math.max(...ys) - y0;
    const el = new Image();
    el.className = 'hero-shard'; el.alt = ''; el.decoding = 'async'; el.fetchPriority = 'high';
    el.src = `opt/hero-shard-${i}.webp`;
    el.style.cssText = `left:${x0}%;top:${y0}%;width:${bw}%;height:${bh}%`;
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length - C[0], cy = p.reduce((s, q) => s + q[1], 0) / p.length - C[1];
    const l = Math.hypot(cx, cy) || 1;
    const sh = { el, dx: cx / l, dy: cy / l, depth: .5 + (i % 3) * .35, rot: (i % 2 ? 1 : -1) * (2 + i) };
    // для CSS-анимации от прокрутки (телефон): направление разлёта и поворот
    el.style.setProperty('--dx', sh.dx.toFixed(3)); el.style.setProperty('--dy', sh.dy.toFixed(3)); el.style.setProperty('--rot', `${sh.rot}deg`);
    box.appendChild(el);
    return sh;
  });
  if (fine) addEventListener('pointermove', e => { hero.tx = e.clientX / innerWidth * 2 - 1; hero.ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
}
// Телефон: разлёт осколков ведёт сам браузер (animation-timeline: scroll) — в том же потоке, что и прокрутка.
// Из JS он отставал на кадр от пальца, и осколки «дрожали» относительно страницы.
const heroCss = !fine && CSS.supports?.('animation-timeline: scroll()');
if (heroCss) document.documentElement.classList.add('sda');
function tickHero() {
  if (heroCss) return;
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
    <article class="card${c.isNew ? ' is-new' : ''}" ${openAttr(c)} data-faction="${c.faction}" data-reveal style="--i:${i % 4};--aura:${esc(c.aura || '#ff7a2e')}" data-aura="${esc(c.aura || '#ff7a2e')}" tabindex="0" aria-label="${esc(c.title)} — открыть в кодексе">
      <span class="card-glow" aria-hidden="true"></span>
      <div class="card-in">
        <div class="card-media">${c.video ? imgTag(c.img, c.title, SIZES.card) : ''}${media(c, '', fine ? 'hover' : 'one', SIZES.card)}</div>
        <div class="card-glare"></div>
        <div class="card-frame"></div>
        ${hasTheme(c) ? `<span class="card-sing" aria-hidden="true"></span><button class="card-play" data-theme="${esc(c.theme)}" data-on="" data-off="" aria-pressed="false" aria-label="Слушать тему: «${esc(c.theme)}»">${ico('note')}</button>` : ''}
        <div class="card-body">
          ${c.isNew ? '<span class="new-tag">Новое</span>' : ''}<span class="card-tag">${esc(FACTION[c.faction] || '')}${c.role ? ' · ' + esc(c.role) : ''}</span>
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
  // Телефон: видео героя оживает только вместе с его темой — по нажатию ♪ (см. Theme: mark/unmark), а не от касаний при листании.

  // видео лежит поверх картинки героя и видно, только пока играет: на паузе плавно растворяется
  // (раньше оставался стоп-кадр), а через полсекунды перематывается в начало — следующий показ начнётся с картинки
  document.querySelectorAll('#cards video').forEach(v => {
    v.addEventListener('playing', () => v.classList.add('on'));
    v.addEventListener('pause', () => { v.classList.remove('on'); setTimeout(() => { if (v.paused) v.currentTime = 0; }, 500); });
  });

  // ПК: подгружаем темы заранее, когда раздел персонажей на подходе — тогда звук при наведении стартует сразу
  if (fine) {
    const pre = new IntersectionObserver(([e]) => { if (e.isIntersecting) { Theme.preload(D.characters.map(c => find('songs', c.theme))); pre.disconnect(); } }, { rootMargin: '900px 0px' });
    pre.observe($('#characters'));
  }

  // ушли из раздела персонажей — тема замолкает (на телефоне иначе играла дальше, где бы ты ни был)
  new IntersectionObserver(([e]) => e.isIntersecting || Theme.stop()).observe($('#characters'));

  $$('#cards .card').forEach((card, i) => {
    const v = fine && $('video', card);
    const theme = find('songs', D.characters[i].theme);
    card.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; v && v.play().catch(() => {}); Theme.hover(theme, card); });
    card.addEventListener('pointerleave', e => {
      // у касания «уход» приходит сразу после пальца (ещё до клика) — иначе ♪ выключался бы сам
      if (e.pointerType !== 'mouse') return;
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

/* ── тема персонажа: ♪ на карточке (везде) + наведение (ПК) ──
   У каждой песни свой <audio>: на ПК темы подгружаются заранее, поэтому звук стартует сразу.
   Раньше один элемент менял src при каждом наведении: первая попытка не успевала загрузиться,
   прерывалась уходом мыши — и мы ошибочно показывали «браузер заблокировал звук». */
const Theme = (() => {
  const pool = new Map();
  const get = song => {
    let a = pool.get(song);
    if (!a) { a = new Audio(); a.preload = fine ? 'auto' : 'none'; a.src = song.preview; a._beats = window.BEATS?.[song.preview]; a.onended = () => cur === a && stop(true); pool.set(song, a); }
    return a;
  };
  let timer = 0, cur = null, curCard = null, on = true, pend = null;
  try { on = localStorage.getItem('codex-sound') !== 'off'; } catch {}
  const fade = (a, to, ms, done) => {
    cancelAnimationFrame(a._fade);
    const from = a.volume, t0 = performance.now();
    const step = t => { const k = clamp((t - t0) / ms); a.volume = from + (to - from) * k; k < 1 ? (a._fade = requestAnimationFrame(step)) : done?.(); };
    a._fade = requestAnimationFrame(step);
  };
  const btn = $('#sound-toggle');
  const paint = () => { btn.classList.toggle('off', !on); btn.setAttribute('aria-pressed', on); btn.setAttribute('aria-label', on ? 'Выключить звук при наведении на героев' : 'Включить звук при наведении на героев'); btn.title = on ? 'Звук при наведении: вкл' : 'Звук при наведении: выкл'; };
  btn.addEventListener('click', () => { on = !on; try { localStorage.setItem('codex-sound', on ? 'on' : 'off'); } catch {} if (!on) stop(); paint(); });
  paint();
  // card — карточка героя (кнопка ♪ внутри) или сама кнопка темы в кодексе; надписи кнопки — в data-on / data-off
  const btnOf = card => card.matches('[data-theme]') ? card : $('.card-play', card);
  const mark = (card, text) => {
    const tag = $('.card-sing', card); if (tag) tag.textContent = text;
    card.classList.add('sing');
    const b = btnOf(card); if (b) { b.innerHTML = ico('pause') + b.dataset.on; b.setAttribute('aria-pressed', 'true'); }
    if (card.classList.contains('card')) $('.card-media video', card)?.play().catch(() => {}); // герой оживает вместе со своей темой
  };
  const unmark = card => {
    card.classList.remove('sing');
    const b = btnOf(card); if (b) { b.innerHTML = ico('note') + b.dataset.off; b.setAttribute('aria-pressed', 'false'); }
    if (card.classList.contains('card')) $('.card-media video', card)?.pause();
  };
  function stop(fast) {
    clearTimeout(timer);
    const a = cur, card = curCard; cur = curCard = null;
    if (card) unmark(card);
    if (a && !a.paused) fade(a, 0, fast ? 120 : 400, () => { if (cur !== a) a.pause(); });
  }
  function start(song, card, tap) {
    if (!song?.preview) return;
    if (playing && !player.paused) { if (!tap) return; player.pause(); setPlaying(null); } // наведение не перебивает песню из плеера
    stop(true);
    const a = get(song);
    hookAudio(a, tap); // тема тоже двигает эквалайзер и искры
    cur = a; curCard = card;
    try { a.currentTime = 1.1; } catch {} // пропускаем вшитое в отрывок затухание
    a.volume = 0;
    mark(card, a.readyState >= 3 ? '♪ ' + song.title : '♪ загрузка…');
    a.play().then(() => {
      if (cur !== a) return a.pause();
      fade(a, .8, 300); mark(card, '♪ ' + song.title);
    }).catch(err => {
      if (cur !== a || err.name === 'AbortError') return; // прервали сами (ушли с карточки) — это не ошибка
      mark(card, err.name === 'NotAllowedError' ? '🔇 Нажми ♪ — браузер ждёт касания' : '⚠ Не удалось загрузить');
    });
  }
  return {
    hover(song, card) { if (!on) return; clearTimeout(timer); pend = { song, card }; timer = setTimeout(() => { pend = null; start(song, card, false); }, 220); },
    leave(card) { clearTimeout(timer); pend = null; if (curCard === card) stop(); },
    // открыли кодекс героя: тема с карточки «переезжает» на кнопку в кодексе и продолжает играть
    adopt(card, btn) {
      if (pend?.card === card) { clearTimeout(timer); const s = pend.song; pend = null; return start(s, btn, false); }
      if (curCard !== card || !cur) return;
      unmark(card); curCard = btn; mark(btn, '');
    },
    // кнопка темы в кодексе исчезает (закрыли окно / перелистнули): playing — играла ли она
    release(root) { if (curCard && root.contains(curCard)) { stop(); return true; } return false; },
    toggle(song, card) { if (curCard === card && cur && !cur.paused) stop(); else start(song, card, true); },
    stop,
    active: () => cur && !cur.paused ? cur : null,
    source: () => cur && !cur.paused ? curCard : null, // карточка (или кнопка в кодексе), откуда звучит тема
    preload(songs) { songs.forEach(s => s?.preview && get(s)); },
    // на каждом касании/клике «разблокируем» ещё не разблокированные элементы (нужно Safari)
    unlock() {
      pool.forEach(a => {
        if (a._unlocked || a === cur) return;
        a._unlocked = true; a.muted = true;
        a.play().then(() => { if (cur !== a) a.pause(); a.muted = false; }).catch(() => { a.muted = false; a._unlocked = false; });
      });
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
  sec.style.height = `${extra + (S.vh || innerHeight)}px`;
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
        <div class="torch-dark"><div class="torch-light"></div></div>
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
              <span class="seal-half l"></span>
              <span class="seal-half r"></span>
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
    const st = torch._t = { x: .5, y: .45, tx: .5, ty: .45, last: 0, on: false, el: torch, light: $('.torch-light', torch), hint: $('.torch-hint', torch) };
    const size = () => { st.w = torch.offsetWidth; st.h = torch.offsetHeight; st.half = st.light.offsetWidth / 2; };
    size(); addEventListener('resize', size);
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
  // свет — готовый градиент 280px, двигаем и чуть «дышим» масштабом: только transform, без перерисовки
  const k = 1 + Math.sin(t / 90) * .03 + Math.sin(t / 37) * .02; // радиус на телефоне меньше — задан в CSS
  st.light.style.transform = `translate3d(${(st.x * st.w - st.half).toFixed(1)}px, ${(st.y * st.h - st.half).toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
}

/* ═══════════ Карта ═══════════ */
const Map2 = { world: null, stage: null, k: 1, sel: -1 };
function initMap() {
  const L = Object.fromEntries(D.locations.map(l => [l.title, l.map]));
  const locs = { castle: L['Замок Элронда'], forest: L['Лес у замка'], town: L['Дороги и таверны'] };
  // есть готовая картинка под эти координаты (tools/render-map.js) — берём её, иначе рисуем кодом
  const ready = window.OPT_MAP && OPT_MAP.key === CodexMap.key(locs);
  const art = CodexMap.build(locs, { geometryOnly: ready });
  const { W, H } = art;
  const pct = (x, y) => `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%`;
  const stage = Map2.stage = $('#map-stage'), world = Map2.world = $('#map-world'), wrap = $('.map-wrap');

  // рисунок — одна картинка (рельеф не живёт в DOM и не перерисовывается при анимациях); грузим на подходе к карте
  const img = $('#map-art');
  img.onload = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => wrap.classList.add('ready'));
  const load = () => {
    if (ready) {
      img.sizes = '(max-width: 900px) calc((62svh - 2px) * 1.6), min(1240px, 100vw)';
      img.srcset = OPT_MAP.sizes.map(w => `opt/map-${w}.webp ${w}w`).join(', ');
      img.src = `opt/map-${OPT_MAP.sizes[1]}.webp`;
    } else img.src = URL.createObjectURL(new Blob([art.svg], { type: 'image/svg+xml' }));
  };
  const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { load(); near.disconnect(); } }, { rootMargin: '1200px 0px' });
  near.observe(stage);

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
    panel.innerHTML = `<div class="mp-img">${media(l, '', 'auto', SIZES.panel)}</div><p class="kicker" style="margin-top:14px">Локация</p><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p><button class="btn" ${openAttr(l)}>Открыть в кодексе</button>`;
    watchVideos(panel);
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
  if (narrow()) show(0); // на ПК панель появляется по клику на метку
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
  // карты открыты (песня вышла)
  $('.oracle-side .lead').textContent = 'Айла приходила к ней узнать исход битвы. Теперь карты открыты — вытяни свою.';
  if (find('characters', 'Ворожея')?.isNew) $('.oracle-side .kicker').insertAdjacentHTML('afterbegin', '<span class="new-tag">Новое</span>');
  // Колода: на лицевой стороне — название карты, само пророчество — крупно под картами (на узкой карте не помещалось).
  // N гаданий в сутки на человека (до полуночи по его часам), без повторов, пока не пройдена вся колода.
  // Счёт — в браузере посетителя: сервера нет, так что это мягкое ограничение, а не защита.
  const P = D.prophecies.map(p => typeof p === 'string' ? { card: 'Пророчество', text: p } : p);
  const PER_DAY = D.oracleDaily || 3, KEY = 'codex-oracle';
  const reading = $('#oracle-reading'), left = $('#oracle-left');
  const today = () => new Date().toLocaleDateString('sv'); // ГГГГ-ММ-ДД по местному времени
  let st = {};
  try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  if (st.day !== today()) st = { day: today(), used: 0, last: null, seen: st.seen || [] };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const untilMidnight = () => {
    const m = Math.ceil((new Date().setHours(24, 0, 0, 0) - Date.now()) / 6e4), h = Math.floor(m / 60);
    return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
  };
  const status = () => {
    const n = PER_DAY - st.used;
    left.textContent = n > 0 ? `Гаданий на сегодня: ${n} из ${PER_DAY}` : `Ворожея устала. Новые карты — через ${untilMidnight()}.`;
    left.classList.toggle('tired', n <= 0);
    again.hidden = n <= 0 || !box.classList.contains('drawn');
  };
  const show = (i, first) => {
    reading.innerHTML = `<span class="or-card">${esc(P[i].card)}</span>«${esc(P[i].text)}»`;
    reading.classList.remove('show'); void reading.offsetWidth; reading.classList.add('show');
    if (first) reading.insertAdjacentHTML('afterbegin', '<span class="or-note">Твоё пророчество на сегодня</span>');
  };
  // три разных карты, которых ещё не было (колода прошла целиком — начинаем заново)
  const draw3 = () => {
    let pool = P.map((_, i) => i).filter(i => !st.seen.includes(i));
    if (pool.length < 3) { st.seen = []; pool = P.map((_, i) => i); }
    return pool.sort(() => Math.random() - .5).slice(0, 3);
  };
  const deal = (flipLast) => {
    box.classList.remove('drawn');
    const ids = flipLast != null ? [flipLast, ...draw3().filter(i => i !== flipLast).slice(0, 2)] : draw3();
    box.innerHTML = ids.map((p, i) => `
      <button class="ocard" style="--i:${i}" data-p="${p}" aria-label="Вытянуть карту ${i + 1}">
        <span class="ocard-face ocard-back"><svg aria-hidden="true"><use href="#eye"/></svg></span>
        <span class="ocard-face ocard-front"><svg aria-hidden="true"><use href="#eye"/></svg><b>${esc(P[p].card)}</b></span>
      </button>`).join('');
    if (flipLast == null) { reading.classList.remove('show'); reading.innerHTML = ''; }
    status();
  };
  box.addEventListener('click', e => {
    const c = e.target.closest('.ocard');
    if (!c || box.classList.contains('drawn')) return;
    if (st.used >= PER_DAY) { status(); return; }
    const i = +c.dataset.p;
    c.classList.add('flipped');
    box.classList.add('drawn');
    st.used++; st.last = i; st.seen.push(i); save();
    const r = c.getBoundingClientRect();
    Embers.burst(r.left + r.width / 2, r.top + r.height / 2, 50, 'violet');
    setTimeout(() => { show(i); status(); }, 650);
  });
  again.addEventListener('click', () => deal());
  // гадания на сегодня закончились — показываем последнее пророчество, карты закрыты до полуночи
  if (st.used >= PER_DAY && st.last != null && P[st.last]) {
    deal(st.last);
    const c = box.firstElementChild; c.classList.add('flipped'); box.classList.add('drawn');
    show(st.last, true); status();
  } else deal();
}

/* ═══════════ Песни ═══════════ */
const player = new Audio();
let playing = null, songCover = null;
function initSongs() {
  // новинки — первыми в списке, со звёздочкой вместо номера
  const order = D.songs.map((s, i) => [s, i]).sort((a, b) => (b[0].isNew ? 1 : 0) - (a[0].isNew ? 1 : 0));
  $('#song-list').innerHTML = order.map(([s, i]) => `
    <li class="song${s.isNew ? ' is-new' : ''}" data-i="${i}" ${openAttr(s)} tabindex="0">
      <span class="song-num">${s.isNew ? '✦' : ROMAN[i] || i + 1}</span>
      <img class="song-thumb" src="${esc(best(s.img, 120))}" alt="" loading="lazy" decoding="async">
      <span><span class="song-title">${esc(s.title)}</span><span class="song-sub">${esc(s.text)}</span></span>
      <span class="song-right">${s.isNew ? '<span class="song-badge new">Новое</span>' : ''}${s.clip ? '<span class="song-badge hot">Клип</span>' : ''}${s.lyrics ? '<span class="song-badge">Текст</span>' : ''}<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${s.preview ? `<button class="song-play" data-play="${esc(s.title)}" aria-label="Слушать отрывок «${esc(s.title)}»">${ico('play')}</button>` : ''}</span>
    </li>`).join('');
  const sleeve = $('#sleeve'), label = $('#vinyl-label'), wrap = $('.songs');
  const setCover = songCover = s => { const u = `url("${best(s.img, 480)}")`; sleeve.style.backgroundImage = u; label.style.backgroundImage = u; };
  setCover(D.songs[0]);
  $$('.song').forEach(row => {
    row.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; setCover(D.songs[row.dataset.i]); wrap.classList.add('hovering'); });
    row.addEventListener('pointerleave', () => wrap.classList.remove('hovering'));
  });
  player.addEventListener('ended', () => setPlaying(null));
  $('#now-toggle').addEventListener('click', () => playing && togglePlay(playing));
  $('#now-title').addEventListener('click', e => playing && openEntry(playing, e.clientX, e.clientY));
  // клип со звуком глушит отрывок
  document.addEventListener('play', e => { if (!e.target.closest?.('.clip')) return; Theme.stop(true); if (playing) { player.pause(); setPlaying(null); } }, true);
}
function setPlaying(song) {
  playing = song;
  if (song) songCover?.(song); // обложка и пластинка — того трека, что играет
  $$('.song').forEach(r => r.classList.toggle('playing', !!song && D.songs[r.dataset.i] === song));
  $$('[data-play]').forEach(b => {
    const on = song && b.dataset.play === song.title, ic = b.classList.contains('song-play');
    b.innerHTML = ico(on ? 'pause' : 'play') + (ic ? '' : on ? ' Пауза' : ' Слушать отрывок');
  });
  const now = $('#now');
  now.classList.toggle('on', !!song);
  if (song) { $('#now-title').textContent = song.title; $('#now-title').setAttribute('aria-label', `Открыть песню «${song.title}»`); }
  beat.eq = song ? $('.song.playing .eq') : null;
}
function togglePlay(song) {
  if (playing === song) { player.pause(); setPlaying(null); return; }
  initAnalyser(); hookAudio(player, true);
  Theme.stop();
  beat.avg = null; beat.n = 0;
  player.src = song.preview; player._beats = window.BEATS?.[song.preview]; setPlaying(song);
  player.play().catch(e => { if (e.name !== 'AbortError' && playing === song) setPlaying(null); }); // не загрузилось — не показываем «играет»
}

/* ── музыка управляет светом: бас → искры, неон, эквалайзер ── */
const beat = { an: null, data: null, v: 0, prev: 0, eq: null, bar: null };
// один анализатор на всю музыку сайта: трек из плеера и темы героев.
// Создаём на взломе печати (это касание — браузер разрешает звук), дальше только подключаем элементы.
function initAnalyser() {
  if (beat.ctx) { if (beat.ctx.state !== 'running') beat.ctx.resume().catch(() => {}); return; }
  if (location.protocol === 'file:') return; // с file:// Chrome глушит звук через анализатор — играем без подсветки
  try {
    const ctx = beat.ctx = new (window.AudioContext || window.webkitAudioContext)();
    beat.an = ctx.createAnalyser(); beat.an.fftSize = 256; beat.an.smoothingTimeConstant = .7;
    beat.an.connect(ctx.destination);
    beat.data = new Uint8Array(beat.an.frequencyBinCount);
    beat.bar = $('#now-bar');
  } catch { /* без анализатора просто играет */ }
}
// пускаем звук элемента через анализатор (один раз навсегда). Без касания (наведение) — только если контекст уже
// работает: подключённый к остановленному контексту элемент замолкает.
function hookAudio(a, gesture) {
  if (!beat.an || a._src || (!gesture && beat.ctx.state !== 'running')) return;
  try { a._src = beat.ctx.createMediaElementSource(a); a._src.connect(beat.an); } catch { /* играет мимо анализатора */ }
}
const AURA = '#ff7a2e'; // цвет по умолчанию — угли
// цвет песни: герой, чья это тема, иначе первый герой песни
const auraOf = song => (D.characters.find(c => c.theme === song?.title) || find('characters', song?.characters?.[0]))?.aura || AURA;
function musicSource() {
  if (playing && !player.paused) {
    // раздел песен на экране — искры из строки трека, иначе из мини-плеера (класс .off ставит наблюдатель — без замеров)
    const row = !$('#songs').classList.contains('off') && $('.song.playing');
    return { el: row || $('#now'), aura: auraOf(playing) };
  }
  const el = Theme.source();
  return el ? { el, aura: el.closest('[data-aura]')?.dataset.aura || AURA } : null;
}
// --beat пишем не в корень страницы (это пересчёт стилей всего документа в каждом кадре), а только туда, где он нужен
beat.level = 0; beat.pulse = 0; beat.mid = 0; beat.css = '';
// только на два элемента без потомков — пересчёт стиля крошечный, а сама вспышка — прозрачность слоя
const setBeat = s => { if (s === beat.css) return; beat.css = s; [$('.song.playing .song-play'), $('#vinyl-label')].forEach(e => e?.style.setProperty('--beat', s)); };
function tickBeat() {
  const src = playing && !player.paused ? player : Theme.active();
  if (!src) {
    if (beat.v) { beat.v = 0; setBeat('0'); }
    if (beat.glow) { beat.glow.style.opacity = ''; beat.glow._o = ''; beat.glow = null; }
    beat.level = beat.level > .005 ? beat.level * .94 : 0; // атмосфера успокаивается плавно
    beat.pulse *= .85;
    return 0;
  }
  beat.level += (1 - beat.level) * .05;
  // Удары — по заранее найденным долям (opt/beats.js, tools/beats.py): срабатывают ровно по времени
  // воспроизведения, не позже. Анализатор (если подключён) — только для мягкого «дыхания» между ударами.
  let hit = false, power = 1, v = 0, band = null;
  const grid = src._beats;
  if (grid) {
    const ct = src.currentTime - (beat.ctx?.outputLatency || 0);
    if (src !== beat.gSrc || ct < beat.gT - .05 || ct - beat.gT > .6) { // новая песня или перемотка — ищем место в сетке
      beat.gSrc = src; beat.gi = grid.findIndex(b => b[0] > ct); if (beat.gi < 0) beat.gi = grid.length;
    }
    while (beat.gi < grid.length && grid[beat.gi][0] <= ct) { hit = true; power = .4 + grid[beat.gi][1] * .6; beat.gi++; }
    beat.gT = ct;
  }
  if (beat.an && src._src) {
    beat.an.getByteFrequencyData(beat.data);
    band = (a, b) => { let x = 0; for (let i = a; i < b; i++) x += beat.data[i]; return x / (b - a) / 255; };
    const bass = band(1, 6);
    beat.mid += (band(8, 40) - beat.mid) * .2;
    beat.n = (beat.n || 0) + 1;
    beat.avg = beat.avg == null ? bass : beat.avg + (bass - beat.avg) * (beat.n < 90 ? .2 : .03);
    beat.v += (bass - beat.v) * .5;
    v = clamp((beat.v - beat.avg) * 8);
    if (!grid) { // песни без сетки: удар = резкий скачок «барабанов» (бочка + малый)
      const drums = bass + band(6, 20) * .6, flux = Math.max(0, drums - (beat.lastDrums ?? drums)); beat.lastDrums = drums;
      beat.fluxAvg = (beat.fluxAvg ?? flux) + (flux - (beat.fluxAvg ?? flux)) * .06;
      hit = flux > beat.fluxAvg * 1.9 + .015 && performance.now() - (beat.kickT || 0) > 200;
    }
  }
  beat.pulse = hit ? Math.max(power, beat.pulse) : beat.pulse * (fine ? .9 : .88); // вспышка сразу, гаснет мягко
  setBeat(Math.max(v, beat.pulse * .8).toFixed(2));
  // откуда звучит и каким цветом: карточка героя (его аура) или строка трека / мини-плеер
  const ms = musicSource();
  Embers.aura = ms?.aura || null;
  beat.srcEl = ms?.el || null;
  const g = ms?.el.classList.contains('card') ? $('.card-glow', ms.el) : null;
  if (beat.glow !== g) { if (beat.glow) beat.glow.style.opacity = ''; beat.glow = g; }
  if (g) { const o = (.25 + beat.pulse * .75).toFixed(2); if (o !== g._o) { g._o = o; g.style.opacity = o; } } // рамка карточки пульсирует
  if (hit && !reduce) {
    beat.kickT = performance.now();
    Embers.kick(power);
    if (ms && !S.modal) Embers.emit(beat.rect || ms.el.getBoundingClientRect(), ms.aura, Math.round((fine ? 24 : 13) * power));
  }
  if (src !== player || !band) return v;
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
    <div class="entry-media">${item.img || item.video ? media(item, '', fine ? 'play' : 'later', SIZES.entry) : '<div class="entry-noimg" aria-hidden="true">?</div>'}${item.img ? crackSvg() : ''}</div>
    <div class="entry-info">
      <p class="kicker" ${n()}>${item.isNew ? '<span class="new-tag">Новое</span>' : ''}${kicker}</p>
      <h2 ${n()} id="entry-title">${esc(item.title)}</h2>
      ${item.epithet ? `<p class="entry-ep" ${n()}>${esc(item.epithet)}</p>` : ''}
      ${item.quote ? `<blockquote class="entry-quote" ${n()}>${esc(item.quote)}</blockquote>` : ''}
      <p class="entry-text" ${n()}>${esc(item.text)}</p>
      ${item.preview || listen || hasTheme(item) ? `<div class="scene-actions" ${n()}>${hasTheme(item) ? `<button class="btn play-btn" data-theme="${esc(item.theme)}" data-aura="${esc(item.aura || '')}" data-on=" Тема: «${esc(item.theme)}»" data-off=" Тема героя: «${esc(item.theme)}»" aria-pressed="false">${ico('note')} Тема героя: «${esc(item.theme)}»</button>` : ''}${item.preview ? `<button class="btn play-btn" data-play="${esc(item.title)}">${playing === item ? ico('pause') + ' Пауза' : ico('play') + ' Слушать отрывок'}</button>` : ''}${listen}</div>` : ''}
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
  // телефон: видео стартует, когда окно уже проявилось и текст «приехал» (старт декодера посреди анимации давал рывки)
  if (!fine) { const v = $('#entry-body .entry-media video'); if (v) setTimeout(() => entry.item === item && !entry.el.hidden && v.play().catch(() => {}), 1100); }
}
function openEntry(item, x, y) {
  const el = entry.el;
  const wasOpen = el.classList.contains('open');
  entry.item = item;
  if (wasOpen) {
    const body = $('#entry-body');
    body.classList.add('swap');
    setTimeout(() => {
      const was = Theme.release(body); // тема играла — у следующего героя заиграет его
      renderEntry(item); body.classList.remove('swap'); restartAnim();
      const tb = was && $('[data-theme]', body); if (tb) Theme.toggle(find('songs', tb.dataset.theme), tb);
    }, 300);
    return;
  }
  entry.back = document.activeElement;
  renderEntry(item);
  // открыли героя с карточки — его тема продолжает играть уже в кодексе
  const tb = item.type === 'characters' && $('#entry-body [data-theme]');
  if (tb) Theme.adopt($$('#cards .card')[D.characters.indexOf(item)], tb);
  el.style.setProperty('--cx', `${x ?? innerWidth / 2}px`);
  el.style.setProperty('--cy', `${y ?? innerHeight / 2}px`);
  el.hidden = false;
  S.modal = true; Embers.paused(true); // окно закрывает искры — не тратим на них кадры
  // на телефоне не трогаем overflow у <html> (на Android это дёргает адресную строку и страницу) —
  // прокрутку держит overscroll-behavior: contain у самого окна кодекса
  if (fine) { document.documentElement.classList.add('modal'); setBehind(true); } // Tab не уходит за окно
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  $('#entry-close').focus({ preventScroll: true });
}
const setBehind = on => ['main', '#nav'].forEach(s => { $(s).inert = on; });
function restartAnim() { const el = entry.el; el.classList.remove('open'); void el.offsetWidth; el.classList.add('open'); }
function closeEntry() {
  const el = entry.el;
  if (el.hidden) return;
  el.classList.remove('open');
  document.documentElement.classList.remove('modal'); setBehind(false);
  S.modal = false; S.dirty = true; Embers.paused(false);
  $$('video', el).forEach(v => v.pause());
  Theme.release(el); // закрыли кодекс — тема героя затихает
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
// каждое касание: разблокируем звук; если телефон усыпил аудиоконтекст (свернули браузер) — будим
document.addEventListener('pointerdown', () => { Theme.unlock(); if (beat.ctx && beat.ctx.state !== 'running') beat.ctx.resume().catch(() => {}); }, { passive: true });
document.addEventListener('click', e => {
  const th = e.target.closest('[data-theme]');
  if (th) { e.stopPropagation(); return Theme.toggle(find('songs', th.dataset.theme), th.closest('.card') || th); }
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

/* ═══════════ Искры (canvas) ═══════════
   Сама симуляция — в embers.js. Здесь — только «пульт»: размеры, события, музыка.
   Если браузер умеет — искры живут в отдельном потоке и не зависят от прокрутки (раньше на телефоне замирали). */
const Embers = (() => {
  const cv = $('#embers');
  let W = 0, H = 0, send = () => {}, local = null;
  const size = () => {
    // искры — мягкие пятна, им не нужна ретина: 1–1.25 пикселя на точку в 2–4 раза дешевле
    const dpr = Math.min(fine ? 1.25 : 1, devicePixelRatio || 1);
    W = innerWidth; H = Math.max(innerHeight, fine ? 0 : H || 0);
    cv.style.height = H + 'px'; // на телефоне буфер выше экрана (адресная строка) — иначе картинку сплющивало
    return [W, H, dpr, innerHeight];
  };
  if (!reduce) {
    let worker = null;
    try { if (cv.transferControlToOffscreen && location.protocol !== 'file:') worker = new Worker('embers.js'); } catch { worker = null; }
    if (worker) {
      const oc = cv.transferControlToOffscreen();
      worker.postMessage({ init: 1, canvas: oc, fine, size: size() }, [oc]);
      send = (k, ...a) => worker.postMessage({ k, a });
    } else if (window.EmbersSim) {
      local = EmbersSim(cv.getContext('2d'), fine); local.resize(...size());
      send = (k, ...a) => local[k](...a);
    }
  }
  addEventListener('resize', () => {
    // адресная строка на телефоне меняет только высоту — буфер не пересоздаём (дорого и даёт мигание), сообщаем видимую высоту
    if (!fine && W === innerWidth && H >= innerHeight) return send('set', { vis: innerHeight });
    send('resize', ...size());
  });
  let lastX = 0, lastY = 0;
  if (fine) addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - lastX, e.clientY - lastY) > 14) { send('trail', e.clientX, e.clientY); lastX = e.clientX; lastY = e.clientY; }
  }, { passive: true });
  const last = { heat: -1, level: -1, mid: -1, aura: undefined };
  const push = (k, v, eps) => { if (eps ? Math.abs(v - last[k]) > eps : v !== last[k]) { last[k] = v; send('set', { [k]: v }); } };
  return {
    set heat(v) { push('heat', v, .02); },
    set aura(v) { push('aura', v); },
    music(level, mid) { push('level', level, .01); push('mid', mid, .02); },
    paused(p) { send('set', { paused: p }); },
    burst: (x, y, n, pal) => send('burst', x, y, n, pal),
    emit: (r, hex, n) => send('emit', { left: r.left, top: r.top, width: r.width, height: r.height }, hex, n),
    kick: p => send('kick', p),
    tick: t => local?.tick(t) // в отдельном потоке искры крутят кадры сами
  };
})();

/* ═══════════ Курсор ═══════════ */
const cur = { x: -100, y: -100, rx: -100, ry: -100, dot: $('.cursor-dot'), ring: $('.cursor-ring') };
if (fine) {
  addEventListener('pointermove', e => {
    cur.x = e.clientX; cur.y = e.clientY;
    document.documentElement.classList.add('moved');
    const seal = !!e.target.closest?.('.seal');
    const big = !seal && !!e.target.closest?.('a, button, [data-open], .ocard');
    if (big !== cur.big) { cur.big = big; cur.ring.classList.toggle('big', big); }
    if (seal !== cur.seal) { cur.seal = seal; cur.ring.classList.toggle('hide', seal); }
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
// Стабильная высота экрана. innerHeight на Android меняется, когда прячется/появляется адресная строка,
// и раньше от этого пересчитывалась высота хроники — всё ниже неё «прыгало» на ~56px («ходуном ходит»).
// 100svh не меняется — берём её (и sticky-панели тоже на svh, так что прогресс совпадает).
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
document.body.appendChild(probe);
function measure() {
  S.vh = probe.offsetHeight || innerHeight;
  S.w = innerWidth;
  sizeChronicle();
  prog = $$('[data-progress]').map(el => ({ el, top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight, p: -1, id: el.id, blood: el.classList.contains('scene-blood') }));
  S.max = Math.max(1, document.documentElement.scrollHeight - S.vh);
  S.dirty = true;
}
function tickScroll() {
  const y = S.y, vh = S.vh;
  const scrolled = y > 40;
  if (scrolled !== S.scrolled) { S.scrolled = scrolled; els.nav.classList.toggle('scrolled', scrolled); }
  if (fine) els.fuse.style.setProperty('--p', (y / S.max).toFixed(4)); // на телефоне фитиль скрыт
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
// новая песня: точка у «Песни» в меню и плашка на первом экране (newDays дней после выхода)
const fresh = D.songs.filter(s => s.isNew);
if (fresh.length) {
  $('.nav-links a[href="#songs"]').classList.add('has-new');
  $('.hero-copy .btn').insertAdjacentHTML('afterend', fresh.map(s => `<button class="news" ${openAttr(s)}><span class="news-dot" aria-hidden="true"></span>Новая песня · «${esc(s.title)}»</button>`).join(''));
}
$('#finale-links').innerHTML = linkBtns(D.links);
$('#songs-links').innerHTML = linkBtns(D.links, undefined, ['yandex', 'vk']);
$('#nav-social').innerHTML = Object.keys(LINK_NAMES).filter(k => D.links?.[k] && k !== 'vk')
  .map(k => `<a href="${esc(D.links[k])}" target="_blank" rel="noopener" aria-label="${LINK_NAMES[k]}" title="${LINK_NAMES[k]}">${icon(k)}</a>`).join('');

let mRaf = 0;
const remeasure = () => { cancelAnimationFrame(mRaf); mRaf = requestAnimationFrame(measure); };
// на телефоне ресайз «только по высоте» — это адресная строка: ничего не пересчитываем
addEventListener('resize', () => { if (!fine && innerWidth === S.w) return; remeasure(); });
addEventListener('load', remeasure);
document.fonts?.ready.then(remeasure);
new ResizeObserver(remeasure).observe($('main'));
addEventListener('scroll', () => { S.dirty = true; }, { passive: true });
measure();

(function loop(t) {
  // положение карточки/строки, откуда звучит музыка, меряем в начале кадра, пока раскладка свежая (дальше в кадре пишем стили)
  if (beat.srcEl) beat.rect = beat.srcEl.getBoundingClientRect();
  const y = scrollY;
  if (y !== S.y) { S.y = y; S.dirty = true; S.moved = t; }
  if (!S.modal) {
    if (S.dirty) { tickScroll(); S.dirty = false; }
    tickHero(); tickTorch(t);
    Embers.heat = Math.max(S.heat, tickBeat() * .9);
    Embers.music(beat.level, beat.mid); Embers.tick(t);
  } else tickBeat();
  tickCursor();
  requestAnimationFrame(loop);
})(0);
})();
