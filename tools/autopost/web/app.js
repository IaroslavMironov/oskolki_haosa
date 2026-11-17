/* Кабинет автопостинга. Без сборки: один модуль, состояние с сервера раз в 5 секунд. */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MSK = 3 * 3600_000; // Москва без перехода на летнее время
const toInput = (iso) => new Date(Date.parse(iso) + MSK).toISOString().slice(0, 16);
const fromInput = (v) => `${v}:00+03:00`;
const day = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long' });
const time = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const dayKey = (iso) => toInput(iso).slice(0, 10);
const media = (p) => `/media?p=${encodeURIComponent(p)}`;
const isVideo = (p) => /\.(mp4|mov|m4v|webm)$/i.test(p);
const base = (p) => p.split('/').pop();

const STATUS = {
  draft: ['Черновик', 'muted'], scheduled: ['В очереди', 'blue'], publishing: ['Публикуется', 'gold'], published: ['Опубликовано', 'green'],
  failed: ['Ошибка', 'red'], unknown: ['Проверить вручную', 'red'], due: ['Выложить вручную', 'gold'], cancelled: ['Отменено', 'muted'],
};
const ATTENTION = ['failed', 'unknown', 'due'];

let S = null;
let filter = localStorage.getItem('ap-filter') || 'upcoming';
let release = '';

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-autopost': '1' }, body: body && JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('нужно войти'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `ошибка ${r.status}`);
  return j;
}

function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text; t.className = `toast ${bad ? 'bad' : ''}`; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 3500);
}

async function load() {
  S = await api('GET', '/api/state');
  $('#dry').hidden = !S.dry;
  $('#me-name').textContent = S.me.name;
  render();
}

function render() {
  const tab = (location.hash || '#queue').slice(1);
  for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== `tab-${tab}`;
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('on', a.dataset.tab === tab);
  if (tab === 'queue') renderQueue();
  if (tab === 'accounts') renderAccounts();
  if (tab === 'log') renderLog();
}

// ---------- Очередь ----------

const chip = (platform, format) => {
  const p = S.platforms[platform];
  return `<span class="chip" style="--c:${p.color}">${esc(p.title)}<i>${esc(p.formats[format]?.title || format)}</i></span>`;
};
const pill = (status) => `<span class="pill ${STATUS[status][1]}">${STATUS[status][0]}</span>`;
const statsLine = (s) => (s ? Object.entries(s).filter(([, v]) => v != null).map(([k, v]) => `${({ views: '👁', likes: '♥', comments: '💬', shares: '↗', reach: 'охват', saved: 'сохр.' })[k] || k} ${v}`).join(' · ') : '');

function actions(t) {
  const b = (act, label, cls = 'ghost') => `<button class="${cls} small" data-act="${act}" data-id="${t.id}">${label}</button>`;
  switch (t.status) {
    case 'draft': return b('schedule', 'В очередь', 'primary') + b('cancel', 'Отменить');
    case 'failed': return b('schedule', 'Ещё раз в очередь', 'primary') + b('pack', 'Пакет') + b('cancel', 'Отменить');
    case 'scheduled': return b('unschedule', 'Снять с очереди') + (t.mode === 'manual' ? b('pack', 'Пакет') : '');
    case 'due': return b('pack', 'Пакет и ссылка', 'primary') + b('cancel', 'Отменить');
    case 'unknown': return b('mark', 'Вышло — вставить ссылку', 'primary') + b('retry', 'Не вышло — в черновик');
    case 'published': return t.url ? `<a class="ghost small btn" href="${esc(t.url)}" target="_blank" rel="noopener">Открыть ↗</a>` : '';
    default: return '';
  }
}

function renderQueue() {
  const releases = [...new Set(S.posts.map((p) => p.release).filter(Boolean))];
  const counts = { attention: 0 };
  const rows = S.posts.flatMap((p) => p.targets.map((t) => ({ ...t, post: p })));
  for (const r of rows) if (ATTENTION.includes(r.status)) counts.attention++;
  const F = { upcoming: 'Предстоящее', attention: `Требует внимания${counts.attention ? ` · ${counts.attention}` : ''}`, published: 'Опубликовано', all: 'Всё' };
  $('#filters').innerHTML = Object.entries(F).map(([k, v]) => `<button class="seg ${filter === k ? 'on' : ''} ${k === 'attention' && counts.attention ? 'alert' : ''}" data-filter="${k}">${v}</button>`).join('')
    + (releases.length ? `<select id="release"><option value="">все релизы</option>${releases.map((r) => `<option ${r === release ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>` : '');

  const keep = {
    upcoming: (t) => ['draft', 'scheduled', 'publishing', 'due', 'failed', 'unknown'].includes(t.status),
    attention: (t) => ATTENTION.includes(t.status),
    published: (t) => t.status === 'published',
    all: () => true,
  }[filter];
  const list = rows.filter((t) => keep(t) && (!release || t.post.release === release))
    .sort((a, b) => (filter === 'published' ? b.planned_at.localeCompare(a.planned_at) : a.planned_at.localeCompare(b.planned_at)));
  const orphans = S.posts.filter((p) => !p.targets.length && (!release || p.release === release));

  if (!list.length && !orphans.length) {
    $('#queue-list').innerHTML = `<div class="empty"><p>${filter === 'attention' ? 'Всё спокойно. Ни одна весть не застряла в пути.' : 'Тишина перед бурей — здесь пока пусто.'}</p>
      ${S.posts.length ? '' : '<p class="muted">Создайте пост — или загрузите пробный план релиза «Ворожеи»: <code>npm run demo</code></p>'}</div>`;
    return;
  }
  // Один пост в одно время — одна карточка, площадки строками внутри.
  const cards = [...Map.groupBy(list, (t) => `${t.post.id}|${t.planned_at}`).values()];
  const groups = Map.groupBy(cards, (c) => dayKey(c[0].planned_at));
  const today = dayKey(S.now);
  let html = '';
  for (const [k, items] of groups) {
    html += `<div class="day ${k < today ? 'past' : ''} ${k === today ? 'today' : ''}"><h3>${esc(day(items[0][0].planned_at))}${k === today ? ' · <b>сегодня</b>' : ''}</h3>`;
    for (const ts of items) {
      const p = ts[0].post;
      const thumb = p.media[0] ? (isVideo(p.media[0]) ? `<video src="${media(p.media[0])}#t=1" muted preload="metadata"></video>` : `<img src="${media(p.media[0])}" loading="lazy" alt="">`) : '<span class="nothumb">Aa</span>';
      const worst = ts.some((t) => ['failed', 'unknown'].includes(t.status)) ? 'st-failed' : ts.some((t) => t.status === 'due') ? 'st-due' : '';
      html += `<article class="row ${worst}">
        <time>${time(ts[0].planned_at)}</time>
        <div class="thumb" data-edit="${p.id}">${thumb}</div>
        <div class="what">
          <a href="#" data-edit="${p.id}" class="ttl">${esc(p.title)}</a>
          <div class="sub muted small">${esc(p.caption.split('\n')[0].slice(0, 110))}</div>
          <div class="tl">${ts.map((t) => `<div class="tline">
            ${chip(t.platform, t.format)}${t.mode === 'manual' ? '<span class="tag">вручную</span>' : ''} ${pill(t.status)}
            ${t.progress ? `<span class="prog">${esc(t.progress)}</span>` : ''}
            ${t.error ? `<span class="err">${esc(t.error)}</span>` : ''}
            ${t.stats ? `<span class="stats">${statsLine(t.stats)}</span>` : ''}
            <span class="acts">${actions(t)}</span></div>`).join('')}</div>
        </div>
      </article>`;
    }
    html += '</div>';
  }
  if (orphans.length && filter !== 'published') {
    html += `<div class="day"><h3>Без площадок</h3>${orphans.map((p) => `<article class="row"><time>—</time><div class="thumb" data-edit="${p.id}">${p.media[0] && !isVideo(p.media[0]) ? `<img src="${media(p.media[0])}" alt="">` : '<span class="nothumb">Aa</span>'}</div>
      <div class="what"><a href="#" data-edit="${p.id}" class="ttl">${esc(p.title)}</a><div class="sub muted small">отметьте площадки в посте</div></div></article>`).join('')}</div>`;
  }
  $('#queue-list').innerHTML = html;
}

async function act(name, id) {
  const t = S.posts.flatMap((p) => p.targets.map((x) => ({ ...x, post: p }))).find((x) => x.id === +id);
  if (name === 'pack') return openPack(t);
  if (name === 'mark') {
    const url = prompt('Ссылка на вышедший пост (можно пусто):', '');
    if (url === null) return;
    await api('POST', `/api/targets/${id}/mark`, { url: url.trim() });
  } else if (name === 'cancel' && !confirm('Отменить эту публикацию?')) return;
  else await api('POST', `/api/targets/${id}/${name}`, {});
  if (name === 'schedule') toast('В очереди');
  await load();
}

// ---------- Пакет для ручной публикации ----------

function openPack(t) {
  const p = t.post, f = S.platforms[t.platform].formats[t.format];
  const caption = t.caption ?? p.caption;
  $('#pack-body').innerHTML = `
    <header class="ed-head"><h2>${chip(t.platform, t.format)} ${esc(p.title)}</h2><button type="button" class="x" data-close aria-label="Закрыть">×</button></header>
    <p class="muted small">${esc(f.hint || '')}</p>
    ${caption ? `<div class="pack-cap"><pre>${esc(caption)}</pre><button class="ghost small" data-copy>Скопировать подпись</button></div>` : ''}
    ${t.title ? `<p><b>Название:</b> ${esc(t.title)}</p>` : ''}
    <div class="pack-files">${p.media.map((m) => `<a class="ghost small btn" href="${media(m)}" download="${esc(base(m))}">⬇ ${esc(base(m))}</a>`).join('')}</div>
    ${t.status === 'published' ? '' : `<label>Ссылка на вышедший пост<input id="pack-url" placeholder="https://…"></label>
    <footer class="ed-foot"><span class="spacer"></span><button class="primary" data-mark="${t.id}">Опубликовано</button></footer>`}`;
  $('#pack').showModal();
}

// ---------- Площадки ----------

const field = (f) => `<label>${esc(f.label)}<input name="${f.key}" autocomplete="off" spellcheck="false"
  ${f.secret ? `type="password" placeholder="${f.set ? 'задано ✓ — пусто, чтобы не менять' : ''}"` : `value="${esc(f.value || '')}"`}></label>`;
const settingsForm = (fields, extra = '') => `<form class="set-form">${fields.map(field).join('')}<div class="acc-act"><button class="primary small">Сохранить</button>${extra}</div></form>`;

function renderAccounts() {
  const cards = Object.entries(S.platforms).map(([k, p]) => {
    const state = p.connected ? '<span class="pill green">подключено</span>' : p.status === 'error' ? '<span class="pill red">ошибка входа</span>' : '<span class="pill muted">не подключено</span>';
    let connect = '';
    if (p.connect === 'oauth') {
      connect = p.appReady
        ? `<a class="primary btn" href="/oauth/${k}/start" target="_blank" rel="opener">${p.connected ? 'Войти заново' : `Войти в ${esc(p.title)}`}</a>`
        : `<button class="primary" disabled>Войти в ${esc(p.title)}</button><span class="muted small">сначала ключи приложения — см. «Настройка»</span>`;
    }
    if (p.connect === 'token') connect = `<form class="tok" data-platform="${k}">${(p.fields || [['token', 'Ключ доступа']]).map(([n, l]) => `<input name="${n}" placeholder="${esc(l)}" autocomplete="off" spellcheck="false">`).join('')}<button class="primary">${p.connected ? 'Заменить' : 'Подключить'}</button></form>`;
    return `<section class="acc" style="--c:${p.color}">
      <header><h3>${esc(p.title)}</h3>${state}</header>
      ${p.account ? `<p class="acc-who"><b>${esc(p.account)}</b>${p.expires ? ` <span class="muted small">· ключ до ${new Date(p.expires).toLocaleDateString('ru-RU')}</span>` : ''}</p>` : ''}
      ${p.error ? `<p class="err small">${esc(p.error)}</p>` : ''}
      <div class="acc-act">${connect}${p.connected || p.status === 'error' ? `<button class="ghost danger small" data-disconnect="${k}">Отключить</button>` : ''}</div>
      ${p.connect === 'oauth' && p.appReady && !p.connected ? `<form class="paste" data-paste="${k}">
        <p class="muted small">Вход откроется в новой вкладке. Если после «Разрешить» там будет страница «не удаётся открыть <b>localhost</b>» — это нормально: скопируйте <b>весь адрес из адресной строки</b> этой вкладки и вставьте сюда.</p>
        <div class="tok"><input name="url" placeholder="http://localhost:4777/oauth/${k}/callback?state=…&code=…" autocomplete="off" spellcheck="false"><button class="primary">Завершить вход</button></div>
      </form>` : ''}
      <details class="setup" ${p.connected ? '' : 'open'}>
        <summary>Настройка</summary>
        <p class="muted small">${esc(p.setup)}</p>
        <ol class="steps">${p.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
        ${p.connect === 'oauth' ? `<div class="copy-row"><span class="muted small">Адрес входа (Redirect URI)</span><code>${esc(p.redirect)}</code><button type="button" class="ghost small" data-copytext="${esc(p.redirect)}">Копировать</button></div>` : ''}
        ${p.app.length ? settingsForm(p.app) : ''}
      </details>
      <details class="caps"><summary>Что умеет</summary>
        <ul class="formats">${Object.values(p.formats).map((f) => `<li><b>${esc(f.title)}</b> ${f.auto ? '<span class="tag ok">авто</span>' : '<span class="tag">вручную</span>'}<br><span class="muted small">${esc(f.hint || '')}</span></li>`).join('')}</ul>
      </details>
    </section>`;
  });
  const sv = S.service, F = Object.fromEntries(sv.fields.map((f) => [f.key, f]));
  const service = `<section class="acc service" style="--c:var(--gold)">
    <header><h3>Сервис</h3></header>
    <div class="svc">
      <h4>Тестовый режим ${S.dry ? '<span class="pill gold">включён</span>' : '<span class="pill green">выключен — публикуем по-настоящему</span>'}</h4>
      <p class="muted small">В тестовом режиме очередь, проверки и статусы настоящие, но на площадки ничего не уходит.</p>
      <button class="${S.dry ? 'primary' : 'ghost'} small" data-dry="${S.dry ? '0' : '1'}">${S.dry ? 'Выключить — публиковать по-настоящему' : 'Включить тестовый режим'}</button>
    </div>
    <div class="svc">
      <h4>Уведомления в Telegram ${F.TG_BOT_TOKEN.set && F.TG_CHAT_ID.set ? '<span class="pill green">настроены</span>' : ''}</h4>
      <ol class="steps"><li>В Telegram у <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>: /newbot → имя «Глашатай» → скопируйте ключ.</li>
        <li>Напишите новому боту «привет» (или добавьте его в чат с Ярославом).</li>
        <li>id чата: напишите <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a> — он ответит вашим id; для группы id начинается с «-100».</li></ol>
      ${settingsForm([F.TG_BOT_TOKEN, F.TG_CHAT_ID], F.TG_BOT_TOKEN.set && F.TG_CHAT_ID.set ? '<button type="button" class="ghost small" data-notify-test>Отправить проверку</button>' : '')}
    </div>
    <div class="svc">
      <h4>Публичная папка для Instagram ${F.MEDIA_PUBLIC_URL.set ? '<span class="pill green">задана</span>' : '<span class="pill muted">ещё нет</span>'}</h4>
      <p class="muted small">Instagram забирает ролики по ссылке. На сервере это папка, которую отдаёт сайт; настроим при переносе Глашатая на сервер.</p>
      ${settingsForm([F.MEDIA_SCP_TARGET, F.MEDIA_PUBLIC_URL])}
    </div>
    <div class="svc">
      <h4>Прокси ${sv.proxy ? '<span class="pill green">включён</span>' : '<span class="pill muted">нет</span>'}</h4>
      <p class="muted small">Нужен Instagram и TikTok: из России их API закрыты. Задаётся на сервере (HTTPS_PROXY), не в кабинете.</p>
    </div>
  </section>`;
  $('#accounts-list').innerHTML = cards.join('') + service;
}

// ---------- Журнал ----------

function renderLog() {
  const titles = Object.fromEntries(S.posts.map((p) => [p.id, p.title]));
  $('#log-list').innerHTML = S.events.map((e) => `<li class="lv-${e.level}"><time>${esc(day(e.at))}, ${time(e.at)}</time>
    ${e.actor ? `<b class="who">${esc(e.actor)}</b> ` : ''}${e.post_id && titles[e.post_id] ? `<a href="#" data-edit="${e.post_id}">${esc(titles[e.post_id])}</a> — ` : ''}${esc(e.text)}</li>`).join('') || '<li class="muted">Пока пусто.</li>';
}

// ---------- Редактор поста ----------

let E = null;
let library = null;

const kindOf = (files) => (!files.length ? 'text' : files.some(isVideo) ? 'video' : files.length > 1 ? 'carousel' : 'image');
const KIND = { text: 'текстовый пост', video: 'ролик', image: 'картинка', carousel: 'карусель' };

function defaultTime() {
  const other = E.targets.find((t) => !t.removed);
  if (other) return other.planned;
  const d = new Date(Date.now() + MSK + 864e5);
  return `${d.toISOString().slice(0, 10)}T12:00`;
}

function openEditor(post) {
  E = post
    ? { id: post.id, media: [...post.media], removed: [], targets: post.targets.filter((t) => t.status !== 'cancelled').map((t) => ({ ...t, planned: toInput(t.planned_at), open: t.caption != null })) }
    : { id: null, media: [], removed: [], targets: [] };
  const f = $('#post-form');
  f.title.value = post?.title || ''; f.caption.value = post?.caption || ''; f.release.value = post?.release || ''; f.note.value = post?.note || '';
  $('#ed-title').textContent = post ? 'Пост' : 'Новый пост';
  $('#del').hidden = !post;
  renderPicked(); renderTargets(); check();
  $('#editor').showModal();
}

function renderPicked() {
  $('#media-kind').textContent = `· ${KIND[kindOf(E.media)]}`;
  $('#picked').innerHTML = E.media.map((m, i) => `<figure>${isVideo(m) ? `<video src="${media(m)}#t=1" muted preload="metadata"></video>` : `<img src="${media(m)}" alt="">`}
    <figcaption>${esc(base(m))}</figcaption><span class="pk-act">${i ? `<button type="button" data-left="${i}" title="Левее">←</button>` : ''}<button type="button" data-unpick="${i}" title="Убрать">×</button></span></figure>`).join('')
    || '<p class="muted small">Без файлов — текстовый пост (только VK).</p>';
  if (library) renderLibrary();
}

function renderLibrary() {
  const groups = Map.groupBy(library, (f) => f.path.split('/').slice(0, -1).join('/'));
  $('#library').innerHTML = [...groups].map(([dir, files]) => `<div class="lib-dir"><h4>${esc(dir)}</h4><div class="lib-grid">${files.map((f) => `
    <button type="button" class="lib-item ${E.media.includes(f.path) ? 'on' : ''}" data-pick="${esc(f.path)}" title="${esc(f.path)}">
      ${f.video ? `<video src="${media(f.path)}#t=1" muted preload="metadata"></video>` : `<img src="${media(f.path)}" loading="lazy" alt="">`}
      <span>${esc(base(f.path))}</span><small>${f.video ? `${f.duration ?? '?'} с · ` : ''}${f.width ? `${f.width}×${f.height} · ` : ''}${f.mb} МБ</small></button>`).join('')}</div></div>`).join('');
}

function renderTargets() {
  const kind = kindOf(E.media);
  let html = '';
  for (const [k, p] of Object.entries(S.platforms)) {
    html += `<div class="tp" style="--c:${p.color}"><h4>${esc(p.title)}${p.connected || S.dry ? '' : ' <span class="muted small">· не подключён</span>'}</h4>`;
    for (const [fk, f] of Object.entries(p.formats)) {
      const t = E.targets.find((x) => x.platform === k && x.format === fk && !x.removed);
      const fits = fitsKind(f.rules, kind);
      const locked = t && !['draft', 'failed'].includes(t.status) && t.id;
      html += `<div class="tf ${t ? 'on' : ''} ${fits ? '' : 'unfit'}">
        <label class="tf-head"><input type="checkbox" data-tgl="${k}/${fk}" ${t ? 'checked' : ''} ${locked ? 'disabled' : ''}> <b>${esc(f.title)}</b>
          ${f.auto ? '' : '<span class="tag">пакет</span>'} ${fits ? '' : `<span class="muted small">не для «${KIND[kind]}»</span>`}
          ${t?.status && t.status !== 'draft' ? pill(t.status) : ''}</label>`;
      if (t && !locked) {
        const i = E.targets.indexOf(t);
        html += `<div class="tf-body">
          <div class="tf-when"><input type="datetime-local" data-f="planned" data-i="${i}" value="${t.planned}">
          <select data-f="mode" data-i="${i}"><option value="auto" ${t.mode !== 'manual' ? 'selected' : ''} ${f.auto ? '' : 'disabled'}>автоматом</option><option value="manual" ${t.mode === 'manual' ? 'selected' : ''}>вручную</option></select></div>
          ${f.rules.title ? `<input data-f="title" data-i="${i}" placeholder="Название (по умолчанию — название поста)" value="${esc(t.title || '')}" maxlength="100">` : ''}
          ${t.open ? `<textarea data-f="caption" data-i="${i}" rows="4" placeholder="Своя подпись для ${esc(p.title)}">${esc(t.caption ?? '')}</textarea>` : `<button type="button" class="link small" data-own="${i}">своя подпись для ${esc(p.title)}</button>`}
          <p class="hint small">${esc(f.hint || '')}</p>
          <ul class="problems" data-problems="${k}/${fk}"></ul>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  $('#targets').innerHTML = html;
}

function fitsKind(r, kind) {
  if (r.media === 'video') return kind === 'video';
  if (r.media === 'image') return kind === 'image';
  if (r.media === 'images') return kind === 'image' || kind === 'carousel' || (r.allowEmpty && kind === 'text');
  if (r.media === 'none') return kind === 'text';
  if (r.maxFiles === 1) return kind === 'video' || kind === 'image';
  return true;
}

function formData() {
  const f = $('#post-form');
  return {
    title: f.title.value, caption: f.caption.value, release: f.release.value.trim(), note: f.note.value,
    kind: kindOf(E.media), media: E.media,
    targets: E.targets.filter((t) => !t.removed && (!t.id || ['draft', 'failed'].includes(t.status)))
      .map((t) => ({ id: t.id, platform: t.platform, format: t.format, planned_at: fromInput(t.planned), mode: t.mode || 'auto', caption: t.open ? t.caption ?? '' : null, title: t.title || null })),
    removeTargets: E.removed,
  };
}

let checkT;
function check() {
  const len = $('#post-form').caption.value.length;
  $('#cap-count').textContent = len ? `${len} зн.` : '';
  clearTimeout(checkT);
  checkT = setTimeout(async () => {
    const r = await api('POST', '/api/check', formData()).catch(() => null);
    if (!r) return;
    for (const ul of document.querySelectorAll('[data-problems]')) {
      const list = r[ul.dataset.problems] || [];
      ul.innerHTML = list.length ? list.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="ok">готово к публикации</li>';
    }
  }, 350);
}

async function save(queue) {
  const body = formData();
  if (!body.title.trim()) return toast('Нужно название', true);
  const { id } = await api(E.id ? 'PUT' : 'POST', E.id ? `/api/posts/${E.id}` : '/api/posts', body).catch((e) => (toast(e.message, true), {}));
  if (!id) return;
  if (queue) {
    await load();
    const post = S.posts.find((p) => p.id === id);
    const errs = [];
    for (const t of post.targets.filter((x) => ['draft', 'failed'].includes(x.status))) {
      await api('POST', `/api/targets/${t.id}/schedule`, {}).catch((e) => errs.push(`${S.platforms[t.platform].title}: ${e.message}`));
    }
    if (errs.length) toast(`Не всё в очереди — ${errs.join(' · ')}`, true); else toast('Сохранено, всё в очереди');
  } else toast('Сохранено');
  $('#editor').close();
  await load();
}

// ---------- События ----------

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-act],[data-edit],[data-filter],[data-close],[data-copy],[data-copytext],[data-mark],[data-disconnect],[data-pick],[data-unpick],[data-left],[data-own],[data-dry],[data-notify-test]')?.dataset;
  if (!d) return;
  try {
    if (d.act) await act(d.act, d.id);
    else if (d.edit) { e.preventDefault(); openEditor(S.posts.find((p) => p.id === +d.edit)); }
    else if (d.filter) { filter = d.filter; localStorage.setItem('ap-filter', filter); renderQueue(); }
    else if ('close' in d) e.target.closest('dialog').close();
    else if (d.copytext) { await navigator.clipboard.writeText(d.copytext); toast('Скопировано'); }
    else if (d.dry) {
      if (d.dry === '0' && !confirm('Выключить тестовый режим? Посты из очереди начнут уходить на подключённые площадки.')) return;
      await api('POST', '/api/dry', { on: d.dry === '1' }); await load();
    }
    else if ('notifyTest' in d) { await api('POST', '/api/notify-test'); toast('Отправлено — проверьте Telegram'); }
    else if ('copy' in d) { await navigator.clipboard.writeText($('.pack-cap pre').textContent); toast('Подпись скопирована'); }
    else if (d.mark) { await api('POST', `/api/targets/${d.mark}/mark`, { url: $('#pack-url').value.trim() }); $('#pack').close(); toast('Отмечено'); await load(); }
    else if (d.disconnect) { if (confirm('Отключить площадку? Ключ удалится.')) { await api('DELETE', `/api/accounts/${d.disconnect}`); await load(); } }
    else if (d.pick) { const i = E.media.indexOf(d.pick); i >= 0 ? E.media.splice(i, 1) : E.media.push(d.pick); renderPicked(); renderTargets(); check(); }
    else if (d.unpick) { E.media.splice(+d.unpick, 1); renderPicked(); renderTargets(); check(); }
    else if (d.left) { const i = +d.left; [E.media[i - 1], E.media[i]] = [E.media[i], E.media[i - 1]]; renderPicked(); check(); }
    else if (d.own) { E.targets[+d.own].open = true; E.targets[+d.own].caption ??= $('#post-form').caption.value; renderTargets(); check(); }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'release') { release = e.target.value; renderQueue(); }
  const tgl = e.target.dataset?.tgl;
  if (tgl) {
    const [platform, format] = tgl.split('/');
    const t = E.targets.find((x) => x.platform === platform && x.format === format && !x.removed);
    if (t) { t.removed = true; if (t.id) E.removed.push(t.id); }
    else E.targets.push({ platform, format, planned: defaultTime(), mode: S.platforms[platform].formats[format].auto ? 'auto' : 'manual' });
    renderTargets(); check();
  }
});

document.addEventListener('input', (e) => {
  const { f, i } = e.target.dataset || {};
  if (f) E.targets[+i][f] = e.target.value;
  if (e.target.closest('#post-form')) check();
});

document.addEventListener('submit', async (e) => {
  const set = e.target.closest('.set-form');
  if (set) {
    e.preventDefault();
    try { await api('POST', '/api/settings', Object.fromEntries(new FormData(set))); toast('Сохранено'); await load(); } catch (err) { toast(err.message, true); }
    return;
  }
  if (e.target.id === 'pw-form') {
    e.preventDefault();
    try { await api('POST', '/api/password', Object.fromEntries(new FormData(e.target))); location.href = '/login.html'; } catch (err) { toast(err.message, true); }
    return;
  }
  const paste = e.target.closest('.paste');
  if (paste) {
    e.preventDefault();
    try { const r = await api('POST', `/api/oauth/${paste.dataset.paste}/paste`, Object.fromEntries(new FormData(paste))); toast(`Подключено: ${r.title || ''}`); await load(); } catch (err) { toast(err.message, true); }
    return;
  }
  const tok = e.target.closest('.tok');
  if (!tok || tok.closest('.paste')) return;
  e.preventDefault();
  try {
    const r = await api('POST', `/api/accounts/${tok.dataset.platform}`, Object.fromEntries(new FormData(tok)));
    toast(`Подключено: ${r.title || ''}`); await load();
  } catch (err) { toast(err.message, true); }
});

$('#new').onclick = () => openEditor(null);
$('#me-pw').onclick = () => { $('#pw-form').reset(); $('#pw').showModal(); };
$('#me-out').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
$('#save').onclick = () => save(false);
$('#save-queue').onclick = () => save(true);
$('#del').onclick = async () => {
  if (!confirm('Удалить пост вместе с публикациями-черновиками?')) return;
  try { await api('DELETE', `/api/posts/${E.id}`); $('#editor').close(); await load(); } catch (err) { toast(err.message, true); }
};
$('#rub-prophecy').onclick = async (e) => {
  e.target.disabled = true; toast('Рисую пророчества…');
  try { const r = await api('POST', '/api/rubrics/prophecy', { days: 7 }); toast(r.created ? `Готово: ${r.created} черновиков — проверьте и поставьте в очередь` : 'На неделю вперёд уже всё есть'); filter = 'upcoming'; await load(); }
  catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
};
$('#run').onclick = async () => { const r = await api('POST', '/api/run'); toast(r.ran ? `В работе: ${r.ran}` : 'Ничему ещё не подошло время'); await load(); };
$('.library').addEventListener('toggle', async (e) => {
  if (!e.target.open || library) return;
  $('#library').innerHTML = '<p class="muted small">Ищу файлы…</p>';
  library = (await api('GET', '/api/files')).files;
  renderLibrary();
});
$('#upload').onchange = async (e) => {
  for (const file of e.target.files) {
    toast(`Загружаю ${file.name}…`);
    const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'x-autopost': '1' } }).then((x) => x.json());
    E.media.push(r.path);
  }
  library = null; e.target.value = '';
  renderPicked(); renderTargets(); check();
};

// Искры: десяток угольков, параметры случайные — каждый раз чуть иначе.
$('.embers').innerHTML = Array.from({ length: 14 }, () => {
  const c = ['#ff8a3d', '#ff8a3d', '#ff2d95', '#a58cff'][Math.floor(Math.random() * 4)];
  return `<i style="--x:${Math.random() * 100}%;--s:${2 + Math.random() * 3}px;--d:${9 + Math.random() * 10}s;--w:${-Math.random() * 18}s;--dx:${(Math.random() - .5) * 60}px;--c:${c}"></i>`;
}).join('');
window.addEventListener('hashchange', render);
await load();
// Пока открыт редактор — не перерисовываем под руками; очередь обновляется сама.
setInterval(() => {
  const typing = document.activeElement?.matches('input, textarea, select') || document.querySelector('details.setup[open] input:not(:placeholder-shown)');
  if (!$('#editor').open && !$('#pack').open && !$('#pw').open && !typing && document.visibilityState === 'visible') load().catch(() => {});
}, 5000);
