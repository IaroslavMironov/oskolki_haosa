/* Кодекс «Осколки хаоса» — движок. Контент — в data.js */
(() => {
const D = window.CODEX;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
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

/* картинка или «оживлённое» видео.
   mode: 'auto' — играет, пока видно на экране; 'hover' — по наведению; 'play' — сразу */
function media(item, cls = '', mode = 'auto') {
  // hover-видео грузим заранее (они ~300 КБ), иначе при наведении рывок на загрузку первого кадра
  if (item.video) return `<video class="${cls}" src="${esc(item.video)}" poster="${esc(item.img || '')}" muted loop playsinline preload="${mode === 'auto' ? 'none' : 'auto'}" ${mode === 'play' ? 'autoplay' : mode === 'auto' ? 'data-auto' : ''}></video>`;
  return item.img ? `<img class="${cls}" src="${esc(item.img)}" alt="${esc(item.title)}" loading="lazy">` : '';
}
const vidIo = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause()), { threshold: .25 });
const watchVideos = (root = document) => $$('video[data-auto]', root).forEach(v => vidIo.observe(v));
const LINK_NAMES = { yandex: 'Яндекс Музыка', vk: 'VK Музыка', vkGroup: 'Сообщество VK' };
const LINK_ICON = { yandex: 'i-yandex', vk: 'i-vk', vkGroup: 'i-vk' };
const icon = k => LINK_ICON[k] ? `<svg class="li"><use href="#${LINK_ICON[k]}"/></svg>` : '';
// keys — какие ссылки показывать (на странице песни сообщество не нужно)
const linkBtns = (links, cls = 'btn ghost listen', keys = Object.keys(LINK_NAMES)) => keys.filter(k => links?.[k])
  .map(k => `<a class="${cls}" href="${esc(links[k])}" target="_blank" rel="noopener">${icon(k)}${LINK_NAMES[k]} <span>↗</span></a>`).join('');
const openAttr = item => `data-open="${item.type}|${esc(item.title)}"`;

/* ═══════════ Заставка ═══════════ */
function initSplash() {
  const t = $('#splash-title');
  let k = 0;
  const row = (word, cls) => `<span class="row ${cls}">${[...word].map(ch => {
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
    return `<span class="ch" style="--tx:${Math.cos(a) * d}px;--ty:${Math.sin(a) * d}px;--r:${(Math.random() - .5) * 120}deg;--d:${.15 + (k++) * .07}s">${ch}</span>`;
  }).join('')}</span>`;
  t.innerHTML = row('ОСКОЛКИ', 'r1') + row('ХАОСА', 'r2');
  const inner = $('.splash-inner');
  setTimeout(() => inner.classList.add('settled'), 3400);
  $('#splash-seal').addEventListener('click', breakSeal, { once: true });
}

function breakSeal(e) {
  const splash = $('#splash'), inner = $('.splash-inner', splash);
  const seal = $('#splash-seal');
  inner.classList.add('settled');
  seal.classList.add('broken');
  Theme.unlock(find('songs', D.characters[0].theme)?.preview); // клик по печати — жест пользователя, разрешаем звук
  const enter = () => {
    document.body.classList.remove('locked');
    document.body.classList.add('entered');
    scrollTo({ top: 0, behavior: 'instant' }); // instant: иначе smooth-скролл проезжает всю страницу
  };
  if (reduce) { splash.style.transition = 'opacity .6s'; splash.style.opacity = 0; enter(); setTimeout(() => splash.remove(), 700); return; }

  const W = innerWidth, H = innerHeight;
  const px = e.clientX || W / 2, py = e.clientY || H / 2;
  const fx = px / W * 100, fy = py / H * 100;
  // сетка с дрожанием → треугольники-осколки
  const C = W > 700 ? 6 : 3, R = W > 700 ? 4 : 4, pts = [];
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
      const px = tri.map(p => [p[0] / 100 * W, p[1] / 100 * H]);
      const x0 = Math.floor(Math.min(...px.map(p => p[0]))), y0 = Math.floor(Math.min(...px.map(p => p[1])));
      const x1 = Math.ceil(Math.max(...px.map(p => p[0]))), y1 = Math.ceil(Math.max(...px.map(p => p[1])));
      const s = document.createElement('div');
      s.className = 'shard';
      s.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;clip-path:polygon(${px.map(p => `${(p[0] - x0).toFixed(1)}px ${(p[1] - y0).toFixed(1)}px`).join(',')})`;
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
const hero = { shards: [], mx: 0, my: 0, tx: 0, ty: 0 };
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
  hero.shards = polys.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'hero-shard';
    el.style.setProperty('--clip', `polygon(${p.map(q => `${q[0]}% ${q[1]}%`).join(',')})`);
    el.innerHTML = `<img src="${esc(D.hero.img)}" alt="${i ? '' : 'Айла в горящей короне'}">`;
    box.appendChild(el);
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length - C[0], cy = p.reduce((s, q) => s + q[1], 0) / p.length - C[1];
    const l = Math.hypot(cx, cy) || 1;
    return { el, dx: cx / l, dy: cy / l, depth: .5 + (i % 3) * .35, rot: (i % 2 ? 1 : -1) * (2 + i) };
  });
  if (fine) addEventListener('pointermove', e => { hero.tx = e.clientX / innerWidth * 2 - 1; hero.ty = e.clientY / innerHeight * 2 - 1; });
}
function tickHero() {
  const hp = clamp(scrollY / innerHeight);
  if (hp >= 1 && hero.lastHp >= 1) return;
  hero.lastHp = hp;
  hero.mx += (hero.tx - hero.mx) * .06;
  hero.my += (hero.ty - hero.my) * .06;
  const portrait = $('#hero-portrait');
  portrait.style.setProperty('--hp', hp);
  const spread = hp * 80 + 3;
  for (const s of hero.shards) {
    s.el.style.transform = `translate(${s.dx * spread + hero.mx * s.depth * 14}px, ${s.dy * spread + hero.my * s.depth * 14}px) rotate(${s.rot * hp}deg)`;
  }
  $('.hero-copy').style.transform = `translate(${hero.mx * -10}px, ${hero.my * -8 + hp * -80}px)`;
  $('.hero-copy').style.opacity = 1 - hp * 1.2;
}

/* ═══════════ Пролог ═══════════ */
let proWords = [], proLit = -1;
function initPrologue() {
  const html = D.prologue.split(/\s+/).map(w => {
    const hot = /^\*|\*[.,—!?]*$/.test(w);
    return `<span class="w${hot ? ' hot' : ''}">${esc(w.replace(/\*/g, ''))}</span>`;
  }).join(' ');
  $('#prologue-text').innerHTML = html;
  proWords = $$('#prologue-text .w');
}

/* ═══════════ Персонажи ═══════════ */
function initCharacters() {
  $('#cards').innerHTML = D.characters.map((c, i) => `
    <article class="card" ${openAttr(c)} data-faction="${c.faction}" data-reveal style="--i:${i % 4}" tabindex="0">
      <div class="card-in">
        <div class="card-media">${media(c, '', fine ? 'hover' : 'auto')}</div>
        <div class="card-glare"></div>
        <div class="card-frame"></div>
        ${c.theme ? '<span class="card-sing"></span>' : ''}
        <div class="card-body">
          <span class="card-tag">${esc(FACTION[c.faction] || '')}${c.role ? ' · ' + esc(c.role) : ''}</span>
          <h3>${esc(c.title)}</h3>
          ${c.epithet ? `<p class="card-ep">${esc(c.epithet)}</p>` : ''}
        </div>
      </div>
    </article>`).join('');

  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#filters button').forEach(x => x.classList.toggle('active', x === b));
    let k = 0;
    $$('#cards .card').forEach(card => {
      const show = b.dataset.f === 'all' || card.dataset.faction === b.dataset.f;
      card.classList.toggle('out', !show);
      card.classList.remove('pop');
      if (show) { void card.offsetWidth; card.style.setProperty('--k', k++); card.classList.add('pop'); }
    });
  });

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
    let raf = 0, ev;
    card.addEventListener('pointermove', e => {
      ev = e;
      if (raf) return;
      raf = requestAnimationFrame(() => { // не чаще кадра
        raf = 0;
        const r = card.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        const s = card.style;
        s.setProperty('--ry', `${(x - .5) * 16}deg`);
        s.setProperty('--rx', `${(.5 - y) * 14}deg`);
        s.setProperty('--mx', x * 2 - 1);
        s.setProperty('--my', y * 2 - 1);
        s.setProperty('--gx', `${x * 100}%`);
        s.setProperty('--gy', `${y * 100}%`);
      });
    });
  });
}

/* ── тема персонажа: отрывок при задержке курсора на карточке ── */
const Theme = (() => {
  const a = new Audio();
  let timer = 0, fadeRaf = 0, cur = null;
  let on = true;
  try { on = localStorage.getItem('codex-sound') !== 'off'; } catch {}
  const fade = (to, ms, done) => {
    cancelAnimationFrame(fadeRaf);
    const from = a.volume, t0 = performance.now();
    const step = t => { const k = clamp((t - t0) / ms); a.volume = from + (to - from) * k; k < 1 ? (fadeRaf = requestAnimationFrame(step)) : done?.(); };
    fadeRaf = requestAnimationFrame(step);
  };
  const stop = () => { clearTimeout(timer); if (cur) cur.classList.remove('sing'); cur = null; fade(0, 450, () => a.pause()); };
  const btn = $('#sound-toggle');
  const paint = () => { btn.classList.toggle('off', !on); btn.setAttribute('aria-label', on ? 'Выключить звук персонажей' : 'Включить звук персонажей'); btn.title = on ? 'Звук персонажей: вкл' : 'Звук персонажей: выкл'; };
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
    <article class="chron-panel" ${openAttr(t)}>
      ${t.future ? '<div class="chron-future">?</div>' : `<div class="chron-img">${media(t)}</div>`}
      <div>
        <div class="chron-year">${esc(t.year)}</div>
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.text)}</p>
        ${songs.length ? `<div class="chips">${songs.map(s => `<button class="chip" ${openAttr(s)}>♪ ${esc(s.title)}</button>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }).join('');
  sizeChronicle();
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
      const drips = Array.from({ length: 22 }, () =>
        `<i class="drip" style="left:${Math.random() * 100}%;--w:${4 + Math.random() * 12}px;--len:${15 + Math.random() * 60};--s:${Math.random() * .35}"></i>`).join('');
      return `<div class="scene scene-blood" data-progress>
        <div class="scene-sticky">
          <div class="scene-bg">${media(ev)}</div>
          <div class="blood-veil"></div>
          <div class="drips"><div class="drip-top"></div>${drips}</div>
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
              <span class="seal-half l"><svg><use href="#crown"/></svg></span>
              <span class="seal-half r"><svg><use href="#crown"/></svg></span>
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
    const st = torch._t = { x: .5, y: .45, tx: .5, ty: .45, last: 0, on: false };
    const move = e => {
      const r = torch.getBoundingClientRect();
      st.tx = (e.clientX - r.left) / r.width; st.ty = (e.clientY - r.top) / r.height;
      st.last = performance.now();
      $('.torch-hint', torch).classList.add('gone');
    };
    torch.addEventListener('pointermove', move);
    torch.addEventListener('pointerdown', move);
    torch.addEventListener('pointerenter', () => $('.cursor-ring')?.classList.add('torch'));
    torch.addEventListener('pointerleave', () => $('.cursor-ring')?.classList.remove('torch'));
    new IntersectionObserver(([en]) => st.on = en.isIntersecting).observe(torch);
  }
}
function tickTorch(t) {
  const torch = $('#torch'); const st = torch?._t;
  if (!st?.on) return;
  if (t - st.last > 2500) { // автопилот: факел бродит сам
    st.tx = .5 + Math.sin(t / 2100) * .3;
    st.ty = .45 + Math.sin(t / 1300) * .18;
  }
  st.x += (st.tx - st.x) * .08; st.y += (st.ty - st.y) * .08;
  const r = (innerWidth < 700 ? 170 : 280) * (1 + Math.sin(t / 90) * .03 + Math.sin(t / 37) * .02);
  const s = torch.style;
  s.setProperty('--x', `${st.x * 100}%`); s.setProperty('--y', `${st.y * 100}%`); s.setProperty('--r', `${r}px`);
}

/* ═══════════ Карта ═══════════ */
function seeded(n) { return () => (n = (n * 16807) % 2147483647) / 2147483647; }
function initMap() {
  const rnd = seeded(11);
  const L = Object.fromEntries(D.locations.map(l => [l.title, l]));
  const castle = L['Замок Элронда']?.map, forest = L['Лес у замка']?.map, roads = L['Дороги и таверны']?.map;
  const trees = [];
  for (let i = 0; i < 170; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    const x = 540 + Math.cos(a) * 210 * d, y = 350 + Math.sin(a) * 120 * d, s = 9 + rnd() * 9;
    trees.push([x, y, s]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  const treeSvg = trees.map(([x, y, s]) => `<path d="M${x} ${y - s * 1.3}L${x + s * .6} ${y + s * .4}L${x - s * .6} ${y + s * .4}Z"/>`).join('');
  const mountains = [[80, 120], [150, 95], [220, 130], [300, 90], [380, 125], [460, 100], [540, 70], [620, 110]].map(([x, y]) =>
    `<path d="M${x - 50} ${y + 40}L${x} ${y - 30}L${x + 50} ${y + 40}"/><path class="snow" d="M${x - 14} ${y - 10}L${x} ${y - 30}L${x + 14} ${y - 10}"/>`).join('');
  const houses = roads ? [[0, 0], [28, 12], [-24, 18], [52, -6], [10, 30]].map(([dx, dy]) => {
    const x = roads.x + dx + 20, y = roads.y + dy - 30;
    return `<path d="M${x - 10} ${y}V${y - 14}L${x} ${y - 24}L${x + 10} ${y - 14}V${y}Z"/>`;
  }).join('') : '';
  const castleSvg = castle ? (() => {
    const { x, y } = castle; const b = y + 4;
    return `<g class="castle-g">
      <path d="M${x - 46} ${b}V${b - 34}H${x + 46}V${b}Z"/>
      <path d="M${x - 58} ${b}V${b - 58}h8v6h6v-6h8v58Z"/><path d="M${x + 36} ${b}V${b - 58}h8v6h6v-6h8v58Z"/>
      <path d="M${x - 14} ${b - 34}V${b - 82}h7v7h7v-7h7v7h7v-7h0v48Z"/>
      <path d="M${x - 7} ${b}v-14a7 7 0 0 1 14 0v14"/>
      <path class="flag" d="M${x} ${b - 82}v-22l18 6l-18 6"/></g>`;
  })() : '';
  const routePath = castle && forest ? `M${castle.x + 10} ${castle.y + 10} C ${castle.x + 70} ${castle.y + 90}, ${forest.x - 120} ${forest.y - 10}, ${forest.x} ${forest.y}` : '';
  const roadPath = castle && roads ? `M${castle.x} ${castle.y + 6} C ${castle.x + 160} ${castle.y + 30}, ${castle.x + 200} ${roads.y - 40}, ${roads.x} ${roads.y} S 960 520, 1010 540` : '';

  $('#map-svg').innerHTML = `
    <defs>
      <radialGradient id="parch" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a1f17"/><stop offset=".7" stop-color="#15100c"/><stop offset="1" stop-color="#070505"/></radialGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <mask id="route-mask"><path class="route-draw" d="${routePath}" pathLength="1" stroke="#fff" stroke-width="10" fill="none"/></mask>
    </defs>
    <rect width="1000" height="620" fill="url(#parch)"/>
    <rect x="14" y="14" width="972" height="592" fill="none" stroke="rgba(214,163,92,.35)"/>
    <rect x="22" y="22" width="956" height="576" fill="none" stroke="rgba(214,163,92,.18)"/>
    <text class="lbl-big" x="500" y="600" text-anchor="middle">КОРОЛЕВСТВО</text>
    <path d="M700 -10 C 650 120, 760 200, 700 320 S 640 520, 720 640" fill="none" stroke="rgba(80,130,150,.35)" stroke-width="7"/>
    <g fill="#120d0a" stroke="rgba(214,163,92,.45)" stroke-width="1.4" stroke-linejoin="round">${mountains.replace(/class="snow"/g, 'stroke="rgba(236,227,214,.5)" fill="none"')}</g>
    <path d="${roadPath}" fill="none" stroke="rgba(214,163,92,.4)" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>
    <g fill="#16231a" stroke="rgba(90,140,95,.55)" stroke-width="1">${treeSvg}</g>
    <g fill="#140f0c" stroke="rgba(214,163,92,.7)" stroke-width="1.6">${castleSvg}${houses}</g>
    <path d="${routePath}" mask="url(#route-mask)" fill="none" stroke="#ff2d95" stroke-width="3" stroke-dasharray="9 7" filter="url(#glow)"/>
    <g transform="translate(900 110)" stroke="rgba(214,163,92,.6)" fill="none">
      <circle r="38"/><circle r="30" stroke-dasharray="2 4"/>
      <path d="M0 -52L7 0L0 52L-7 0Z" fill="rgba(214,163,92,.25)"/><path d="M-52 0L0 -7L52 0L0 7Z"/>
      <text y="-58" text-anchor="middle" stroke="none" style="font-size:16px">С</text>
    </g>
    ${D.locations.filter(l => l.map).map((l, i) => `
      <g class="pin" data-loc="${i}" transform="translate(${l.map.x} ${l.map.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
        <circle class="ring" r="9" fill="none" stroke="#ff2d95" stroke-width="2"/>
        <circle class="dot" r="8" fill="rgba(255,45,149,.35)" stroke="#ff2d95" stroke-width="2" filter="url(#glow)"/>
        <circle class="core" r="3" fill="#ff7ac3"/>
        <text class="lbl" y="${l.map.y > 400 ? 44 : -26}" text-anchor="middle">${esc(l.title)}</text>
      </g>`).join('')}
    ${castle && forest ? `<text x="${(castle.x + forest.x) / 2 - 30}" y="${(castle.y + forest.y) / 2 + 40}" style="font-size:14px;fill:rgba(255,122,195,.8);font-style:italic" text-anchor="middle">путь побега</text>` : ''}`;

  const panel = $('#map-panel');
  const show = i => {
    const l = D.locations[i];
    $$('.pin').forEach(p => p.classList.toggle('active', +p.dataset.loc === i));
    panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
    panel.innerHTML = `<div class="mp-img">${media(l, '', 'play')}</div><p class="kicker" style="margin-top:14px">Локация</p><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p><button class="btn" ${openAttr(l)}>Открыть в кодексе</button>`;
  };
  $$('.pin').forEach(p => {
    const go = () => show(+p.dataset.loc);
    p.addEventListener('click', go);
    p.addEventListener('pointerenter', () => fine && go());
    p.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go()));
  });
  show(0);
}

/* ═══════════ Гадание ═══════════ */
function initOracle() {
  const box = $('#ocards'), again = $('#oracle-again');
  if (!D.prophecies?.length) { // раздел запечатан до выхода трека
    $('#oracle').classList.add('sealed');
    box.innerHTML = [0, 1, 2].map(i => `
      <button class="ocard" style="--i:${i}" aria-label="Карта запечатана">
        <span class="ocard-face ocard-back"><svg><use href="#eye"/></svg><i class="ocard-lock"></i></span>
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
        <span class="ocard-face ocard-back"><svg><use href="#eye"/></svg></span>
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
      <img class="song-thumb" src="${esc(s.img)}" alt="" loading="lazy">
      <span><span class="song-title">${esc(s.title)}</span><span class="song-sub">${esc(s.text)}</span></span>
      <span class="song-right">${s.clip ? '<span class="song-badge hot">Клип</span>' : ''}${s.lyrics ? '<span class="song-badge">Текст</span>' : ''}<span class="eq"><i></i><i></i><i></i><i></i></span>${s.preview ? `<button class="song-play" data-play="${esc(s.title)}" aria-label="Слушать отрывок «${esc(s.title)}»">▶</button>` : ''}</span>
    </li>`).join('');
  const sleeve = $('#sleeve'), label = $('#vinyl-label'), wrap = $('.songs');
  const setCover = s => { sleeve.style.backgroundImage = `url("${s.img}")`; label.style.backgroundImage = `url("${s.img}")`; };
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
    const on = song && b.dataset.play === song.title, icon = b.classList.contains('song-play');
    b.textContent = icon ? (on ? '❚❚' : '▶') : (on ? '❚❚ Пауза' : '▶ Слушать отрывок');
  });
  const now = $('#now');
  now.classList.toggle('on', !!song);
  if (song) $('#now-title').textContent = song.title;
}
function togglePlay(song) {
  if (playing === song) { player.pause(); setPlaying(null); return; }
  initAnalyser();
  Theme.stop();
  beat.avg = null; beat.n = 0;
  player.src = song.preview; player.play().catch(() => {}); setPlaying(song);
}

/* ── музыка управляет светом: бас → искры, неон, эквалайзер ── */
const beat = { an: null, data: null, v: 0, prev: 0 };
function initAnalyser() {
  if (beat.an) { beat.ctx.resume(); return; }
  if (location.protocol === 'file:') return; // с file:// Chrome глушит звук через анализатор — играем без подсветки
  try {
    const ctx = beat.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(player);
    beat.an = ctx.createAnalyser(); beat.an.fftSize = 256; beat.an.smoothingTimeConstant = .7;
    src.connect(beat.an); beat.an.connect(ctx.destination);
    beat.data = new Uint8Array(beat.an.frequencyBinCount);
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
  document.documentElement.style.setProperty('--beat', v.toFixed(3));
  if (v - beat.prev > .22 && v > .55 && !reduce) for (let i = 0; i < 3; i++) Embers.burst(Math.random() * innerWidth, innerHeight + 5, 5);
  beat.prev = v;
  const eq = $('.song.playing .eq');
  if (eq) [band(1, 4), band(4, 12), band(12, 30), band(30, 70)].forEach((b, i) => eq.children[i].style.transform = `scaleY(${.15 + b * .95})`);
  const pr = $('#now-bar'); if (pr && player.duration) pr.style.transform = `scaleX(${player.currentTime / player.duration})`;
  return v;
}

/* ═══════════ Страница кодекса ═══════════ */
const entry = { el: null, item: null };
function crackSvg() {
  const rnd = seeded(Math.floor(Math.random() * 1e6) + 1);
  let d = '';
  const ox = 70 + rnd() * 20, oy = 20 + rnd() * 30;
  for (let i = 0; i < 7; i++) {
    let x = ox, y = oy, a = rnd() * Math.PI * 2;
    d += `M${x} ${y}`;
    for (let j = 0; j < 5; j++) { a += (rnd() - .5) * .9; x += Math.cos(a) * (6 + rnd() * 10); y += Math.sin(a) * (6 + rnd() * 10); d += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
  }
  return `<svg class="crack" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="rgba(255,122,195,.7)" stroke-width=".25" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 3px #ff2d95)"/></svg>`;
}
function renderEntry(item) {
  const t = item.type, rel = links.get(item) || {};
  const gallery = [...new Set([item.img, ...(item.gallery || [])].filter(Boolean))];
  let i = 0; const n = () => `style="--i:${i++}"`;
  const kicker = [ONE[t], FACTION[item.faction], item.role, item.year].filter(Boolean).map(esc).join(' · ');
  const listen = linkBtns(item.links) || (t === 'songs' ? linkBtns(D.links, undefined, ['yandex', 'vk']) : ''); // нет ссылки на трек — ведём на артиста
  $('#entry-body').innerHTML = `
    <div class="entry-media">${item.img || item.video ? media(item, '', 'play') : '<div class="entry-noimg">?</div>'}${item.img ? crackSvg() : ''}</div>
    <div class="entry-info">
      <p class="kicker" ${n()}>${kicker}</p>
      <h2 ${n()}>${esc(item.title)}</h2>
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
      ${gallery.length > 1 ? `<div class="gal" ${n()}>${gallery.map(src => `<button data-full="${esc(src)}" aria-label="Открыть изображение"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>`;
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
  renderEntry(item);
  el.style.setProperty('--cx', `${x ?? innerWidth / 2}px`);
  el.style.setProperty('--cy', `${y ?? innerHeight / 2}px`);
  el.hidden = false;
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
  $$('video', el).forEach(v => v.pause());
  setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 900);
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
  $('img', lb).src = src;
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
  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const spawn = (x, y, o = {}) => {
    const pal = COLORS[o.pal || 'ember'];
    parts.push({
      x, y, vx: o.vx ?? (Math.random() - .5) * .4, vy: o.vy ?? -(.3 + Math.random() * .9),
      life: 0, max: o.max ?? 220 + Math.random() * 260, size: o.size ?? .6 + Math.random() * 1.8,
      seed: Math.random() * 100, c: pal[Math.floor(Math.random() * pal.length)], ambient: !!o.ambient
    });
  };
  let lastX = 0, lastY = 0, heat = 0;
  if (fine) addEventListener('pointermove', e => {
    const d = Math.hypot(e.clientX - lastX, e.clientY - lastY);
    if (d > 14 && parts.length < 400) {
      spawn(e.clientX, e.clientY, { vx: (Math.random() - .5) * .6, vy: -.2 - Math.random() * .6, max: 50 + Math.random() * 40, size: .5 + Math.random() * 1.2 });
      lastX = e.clientX; lastY = e.clientY;
    }
  });
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
      const target = (W < 700 ? 26 : 55) * (1 + heat * 1.5);
      let amb = 0; for (const p of parts) if (p.ambient) amb++;
      if (amb < target && Math.random() < .5) spawn(Math.random() * W, H + 10, { ambient: true, pal: heat > .3 && Math.random() < heat ? 'blood' : 'ember' });
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      parts = parts.filter(p => p.life < p.max && p.y > -20);
      for (const p of parts) {
        p.life++;
        p.vx += Math.sin(t / 700 + p.seed) * .012;
        if (!p.ambient) { p.vx *= .965; p.vy = p.vy * .965 - .02; } else p.vy -= .002;
        p.x += p.vx; p.y += p.vy;
        const k = p.life / p.max, a = (k < .1 ? k * 10 : 1 - (k - .1) / .9) * (.6 + Math.sin(t / 60 + p.seed) * .4);
        const [r, g, b] = p.c;
        ctx.fillStyle = `rgba(${r},${g},${b},${a * .18})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 4, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
      }
    }
  };
})();

/* ═══════════ Курсор ═══════════ */
const cur = { x: -100, y: -100, rx: -100, ry: -100 };
if (fine) {
  const ring = $('.cursor-ring');
  addEventListener('pointermove', e => {
    cur.x = e.clientX; cur.y = e.clientY;
    document.documentElement.classList.add('moved');
    ring.classList.toggle('big', !!e.target.closest?.('a, button, [data-open], .pin, .ocard'));
  });
  document.addEventListener('pointerleave', () => document.documentElement.classList.remove('moved'));
}
function tickCursor() {
  if (!fine) return;
  cur.rx += (cur.x - cur.rx) * .18; cur.ry += (cur.y - cur.ry) * .18;
  $('.cursor-dot').style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
  $('.cursor-ring').style.transform = `translate3d(${cur.rx}px, ${cur.ry}px, 0)`;
}

/* ═══════════ Скролл-механики ═══════════ */
function tickScroll() {
  const vh = innerHeight;
  $('#nav').classList.toggle('scrolled', scrollY > 40);
  const max = document.documentElement.scrollHeight - vh;
  $('.fuse').style.setProperty('--p', max > 0 ? scrollY / max : 0);

  let heat = 0;
  for (const el of $$('[data-progress]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < -vh || r.top > vh * 2) continue;
    const p = clamp(-r.top / Math.max(1, r.height - vh));
    if (Math.abs((el._p ?? -1) - p) > .001) { el._p = p; el.style.setProperty('--p', p.toFixed(4)); }
    if (el.classList.contains('scene-blood') && r.top < vh && r.bottom > 0) heat = Math.max(heat, Math.sin(p * Math.PI));
    if (el.id === 'prologue' && proWords.length) {
      const lit = Math.floor(clamp(p * 1.25) * proWords.length);
      if (lit !== proLit) { proWords.forEach((w, i) => w.classList.toggle('lit', i < lit)); proLit = lit; }
    }
    if (el.id === 'chronicle') $('#chron-track').style.transform = `translate3d(${-p * (el._extra || 0)}px,0,0)`;
  }
  Embers.heat = Math.max(heat, tickBeat() * .9);
}

/* ═══════════ Навигация + появление ═══════════ */
function initObservers() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  $$('[data-reveal], .map-wrap').forEach(el => io.observe(el));
  const links = $$('.nav-links a');
  const navIo = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    links.forEach(a => {
      const on = a.getAttribute('href') === '#' + e.target.id;
      a.classList.toggle('active', on);
      if (on) a.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }), { rootMargin: '-45% 0px -50% 0px' });
  links.forEach(a => { const s = $(a.getAttribute('href')); s && navIo.observe(s); });
}

/* ═══════════ Старт ═══════════ */
initSplash(); initHero(); initPrologue(); initCharacters(); initChronicle(); initEvents(); initMap(); initOracle(); initSongs(); initEntry(); initObservers();
watchVideos();
$('#year').textContent = new Date().getFullYear();
$('#finale-links').innerHTML = linkBtns(D.links);
$('#songs-links').innerHTML = linkBtns(D.links, undefined, ['yandex', 'vk']);
$('#nav-social').innerHTML = Object.keys(LINK_NAMES).filter(k => D.links?.[k] && k !== 'vk')
  .map(k => `<a href="${esc(D.links[k])}" target="_blank" rel="noopener" aria-label="${LINK_NAMES[k]}" title="${LINK_NAMES[k]}">${icon(k)}</a>`).join('');
addEventListener('resize', sizeChronicle);
addEventListener('load', sizeChronicle);
(function loop(t) {
  tickScroll(); tickHero(); tickTorch(t); tickCursor(); Embers.tick(t);
  requestAnimationFrame(loop);
})(0);
})();
