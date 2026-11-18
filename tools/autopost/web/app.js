/* Кабинет автопостинга. Без сборки: один модуль, состояние с сервера раз в 5 секунд. */

import { preview, full } from './preview.js';
import { renderAnalytics } from './analytics.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MSK = 3 * 3600_000; // Москва без перехода на летнее время
const toInput = (iso) => new Date(Date.parse(iso) + MSK).toISOString().slice(0, 16);
const fromInput = (v) => `${v}:00+03:00`;
const day = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long' });
const time = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const dayKey = (iso) => toInput(iso).slice(0, 10);
const media = (p) => `/media?p=${encodeURIComponent(p)}`;
const vthumb = (p, sec) => `<img src="/thumb?p=${encodeURIComponent(p)}&t=${sec ?? 1}" loading="lazy" alt="">`;
const isVideo = (p) => /\.(mp4|mov|m4v|webm)$/i.test(p);
const base = (p) => p.split('/').pop();

const STATUS = {
  draft: ['Черновик', 'muted'], scheduled: ['В очереди', 'blue'], publishing: ['Публикуется', 'gold'], published: ['Опубликовано', 'green'],
  failed: ['Ошибка', 'red'], unknown: ['Проверить вручную', 'red'], due: ['Ждёт вас', 'gold'], cancelled: ['Отменено', 'muted'],
};
const ATTENTION = ['failed', 'unknown', 'due'];
const openTasks = (t) => (t.tasks || []).filter((x) => !x.done).length;
// На утверждении: пост подготовил Claude, человек ещё не посмотрел. Ждущие файла не считаем — смотреть пока нечего;
// ручные (VK) — тоже: их человек выкладывает сам, это и есть проверка.
const toApprove = (t) => t.status === 'draft' && !t.post.approved_at && !/НУЖЕН ФАЙЛ/.test(t.post.note || '') && levelOf(t) !== 'manual';
const needsMe = (t) => ATTENTION.includes(t.status) || (t.status === 'published' && openTasks(t) > 0);
// Кто публикует: ⚡ сам — Глашатай целиком; ◐ полуавтомат — загрузит сам, опубликуете вы; ✋ вручную — по «Пакету».
const LEVEL = { full: ['⚡ сам', 'lv-full', 'Глашатай опубликует сам'], half: ['◐ полуавтомат', 'lv-half', 'Глашатай загрузит, опубликуете вы в приложении'], manual: ['✋ вручную', 'lv-manual', 'Выкладываете вы по «Пакету», Глашатай напомнит'] };
const levelOf = (t) => (t.mode === 'manual' ? 'manual' : S.platforms[t.platform].formats[t.format]?.level || 'full');
const lvl = (l) => `<span class="lv ${LEVEL[l][1]}" title="${LEVEL[l][2]}">${LEVEL[l][0]}</span>`;

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

// quiet — фоновое обновление: если на сервере ничего не поменялось, не перерисовываем (иначе миниатюры мерцают)
let lastState = '';
async function load(quiet = false) {
  const next = await api('GET', '/api/state');
  const sig = JSON.stringify({ ...next, now: null });
  if (quiet && sig === lastState) return;
  lastState = sig; S = next;
  $('#dry').hidden = !S.dry;
  $('#me-name').textContent = S.me.name;
  document.body.classList.toggle('readonly', !!S.me.readonly);
  render();
}

function render() {
  const tab = (location.hash || '#queue').slice(1);
  for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== `tab-${tab}`;
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('on', a.dataset.tab === tab);
  if (tab === 'queue') renderQueue();
  if (tab === 'accounts') renderAccounts();
  if (tab === 'log') renderLog();
  // Аналитика — по открытию вкладки (не каждые 5 секунд: цифры меняются раз в час).
  if (tab === 'analytics' && render.last !== 'analytics') renderAnalytics($('#analytics-view'), Object.fromEntries(Object.entries(S.platforms).map(([k, p]) => [k, p.color])), api).catch((e) => toast(e.message, true));
  render.last = tab;
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
  // Выкладываете вы — отметить «вышло» можно прямо из очереди, в любой момент (выложили раньше срока — тоже).
  const mine = levelOf(t) === 'manual', done = b('mark', '✓ Выложил', 'primary');
  switch (t.status) {
    case 'draft': return mine ? done + b('pack', 'Пакет') + b('cancel', 'Отменить')
      : (t.post.approved_at ? b('schedule', 'В очередь', 'primary') : b('approve', 'Утвердить', 'primary')) + b('cancel', 'Отменить');
    case 'failed': return b('schedule', 'Ещё раз в очередь', 'primary') + b('pack', 'Пакет') + b('cancel', 'Отменить');
    case 'scheduled': return mine ? done + b('pack', 'Пакет') + b('unschedule', 'Снять с очереди') : b('unschedule', 'Снять с очереди');
    case 'due': return done + b('pack', 'Пакет') + b('cancel', 'Отменить');
    case 'unknown': return b('mark', 'Вышло — вставить ссылку', 'primary') + b('retry', 'Не вышло — в черновик');
    case 'published': return t.url ? `<a class="ghost small btn" href="${esc(t.url)}" target="_blank" rel="noopener">Открыть ↗</a>` : `<button class="ghost small" data-edit="${t.post_id}">＋ Ссылка</button>`;
    default: return '';
  }
}

function renderQueue() {
  const releases = [...new Set(S.posts.map((p) => p.release).filter(Boolean))];
  const rows = S.posts.flatMap((p) => p.targets.map((t) => ({ ...t, post: p })));
  const counts = { attention: rows.filter(needsMe).length, approve: rows.filter(toApprove).length };
  const F = { upcoming: 'Предстоящее', attention: `Требует внимания${counts.attention ? ` · ${counts.attention}` : ''}`,
    ...(counts.approve || filter === 'approve' ? { approve: `На утверждении${counts.approve ? ` · ${counts.approve}` : ''}` } : {}), published: 'Опубликовано', all: 'Всё' };
  $('#filters').innerHTML = Object.entries(F).map(([k, v]) => `<button class="seg ${filter === k ? 'on' : ''} ${k === 'attention' && counts.attention ? 'alert' : ''}" data-filter="${k}">${v}</button>`).join('')
    + `<span class="legend">${Object.keys(LEVEL).map((l) => `${lvl(l)} <span class="muted small">${{ full: 'публикует Глашатай', half: 'загрузит Глашатай, публикуете вы', manual: 'публикуете вы, Глашатай напомнит' }[l]}</span>`).join(' ')}</span>`
    + (releases.length ? `<select id="release"><option value="">все релизы</option>${releases.map((r) => `<option ${r === release ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>` : '');

  const keep = {
    upcoming: (t) => ['draft', 'scheduled', 'publishing', 'due', 'failed', 'unknown'].includes(t.status),
    attention: (t) => needsMe(t),
    approve: (t) => toApprove(t),
    published: (t) => t.status === 'published',
    all: () => true,
  }[filter];
  const list = rows.filter((t) => keep(t) && (!release || t.post.release === release))
    .sort((a, b) => (filter === 'published' ? b.planned_at.localeCompare(a.planned_at) : a.planned_at.localeCompare(b.planned_at)));
  const orphans = S.posts.filter((p) => !p.targets.length && (!release || p.release === release));

  if (!list.length && !orphans.length) {
    $('#queue-list').innerHTML = `<div class="empty"><p>${filter === 'attention' ? 'Всё спокойно. Ни одна весть не застряла в пути.' : filter === 'approve' ? 'Всё утверждено.' : 'Тишина перед бурей — здесь пока пусто.'}</p>
      ${S.posts.length ? '' : '<p class="muted">Создайте пост — или загрузите пробный план релиза «Ворожеи»: <code>npm run demo</code></p>'}</div>`;
    return;
  }
  // Один пост в одно время — одна карточка, площадки строками внутри.
  const cards = [...Map.groupBy(list, (t) => `${t.post.id}|${t.planned_at}`).values()];
  const groups = Map.groupBy(cards, (c) => dayKey(c[0].planned_at));
  const today = dayKey(S.now);
  let html = '';
  for (const [k, items] of groups) {
    const live = items.flat().filter((t) => t.status !== 'cancelled');
    const self = live.filter((t) => levelOf(t) === 'full').length, yours = live.length - self;
    html += `<div class="day ${k < today ? 'past' : ''} ${k === today ? 'today' : ''}"><h3>${esc(day(items[0][0].planned_at))}${k === today ? ' · <b>сегодня</b>' : ''}<span class="day-sum">${self ? `⚡ ${self} сам` : ''}${self && yours ? ' · ' : ''}${yours ? `✋ ${yours} ваших` : ''}</span></h3>`;
    for (const ts of items) {
      const p = ts[0].post;
      const thumb = p.media[0] ? (isVideo(p.media[0]) ? vthumb(p.media[0], p.cover_sec) : `<img src="${media(p.media[0])}" loading="lazy" alt="">`) : '<span class="nothumb">Aa</span>';
      const worst = ts.some((t) => ['failed', 'unknown'].includes(t.status)) ? 'st-failed' : ts.some((t) => t.status === 'due') ? 'st-due' : '';
      html += `<article class="row ${worst}">
        <time>${time(ts[0].planned_at)}</time>
        <div class="thumb" data-edit="${p.id}">${thumb}</div>
        <div class="what">
          <a href="#" data-edit="${p.id}" class="ttl">${esc(p.title)}</a>${ts.some((t) => t.oracle) ? ' <span class="pill" title="Ворожея отвечает на номера карт в комментариях">🔮</span>' : ''}${!ts.some(toApprove) ? '' : ' <span class="pill gold" title="Подготовил Claude — посмотрите и утвердите, иначе в очередь не встанет">📝 на утверждении</span>'}
          <div class="sub muted small">${esc(p.caption.split('\n')[0].slice(0, 110))}</div>
          <div class="tl">${ts.map((t) => `<div class="tline">
            ${chip(t.platform, t.format)}${lvl(levelOf(t))} ${openTasks(t) ? `<button class="tag-task" data-edit="${t.post_id}" title="${esc(t.tasks.filter((x) => !x.done).map((x) => x.title).join(', '))}">✋ ${openTasks(t)} ${openTasks(t) === 1 ? 'задача' : 'задачи'}</button>` : ''} ${t.status === 'due' && t.remote_id ? '<span class="pill gold">Черновик в TikTok — опубликуйте</span>' : pill(t.status)}
            ${t.progress ? `<span class="prog">${esc(t.progress)}</span>` : ''}
            ${t.error ? `<span class="err">${esc(t.error)}</span>` : ''}
            ${t.stats ? `<span class="stats">${statsLine(t.stats)}</span>` : ''}
            <span class="acts"><button class="ghost small" data-act="preview" data-id="${t.id}" title="Как это будет выглядеть">👁</button>${actions(t)}</span></div>`).join('')}</div>
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
  if (name === 'approve') { await api('POST', `/api/posts/${t.post_id}/approve`, {}); toast('Утверждено — теперь можно в очередь'); return load(); }
  if (name === 'preview') return openPreview([{ platform: t.platform, format: t.format, caption: t.caption ?? t.post.caption, title: t.title || t.post.title, files: t.post.media, planned: t.planned_at }], 0);
  if (name === 'mark') {
    const url = prompt(`${S.platforms[t.platform].title}: ссылка на вышедший пост (можно оставить пустым)`, '');
    if (url === null) return;
    await api('POST', `/api/targets/${id}/mark`, { url: url.trim() });
    toast('Отмечено: опубликовано');
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

// ---------- Предпросмотр ----------

let PV = [];
let PV_MODE = 'feed';
function openPreview(items, i = 0) {
  PV = items;
  if (!items.length) return toast('Отметьте хотя бы одну площадку', true);
  $('#pv-tabs').innerHTML = items.map((x, j) => `<button type="button" class="seg ${j === i ? 'on' : ''}" data-pv="${j}">${esc(S.platforms[x.platform].title)} · ${esc(S.platforms[x.platform].formats[x.format].title)}</button>`).join('');
  const x = items[i];
  PV.i = i;
  $('#pv-mode').innerHTML = ['feed', 'full'].map((m) => `<button type="button" class="seg ${PV_MODE === m ? 'on' : ''}" data-pv-mode="${m}">${m === 'feed' ? 'Как в ленте' : 'Полностью: подпись и файлы'}</button>`).join('');
  $('#pv-body').innerHTML = `<div class="pv-stage">${PV_MODE === 'full' ? full(x) : preview({ ...x, account: S.platforms[x.platform].account, when: x.planned ? `${day(x.planned)} в ${time(x.planned)}` : 'сейчас' })}</div>`;
  if (!$('#pv').open) $('#pv').showModal();
}

function previewFromEditor() {
  const b = formData();
  openPreview(b.targets.map((t) => ({ platform: t.platform, format: t.format, caption: t.caption ?? b.caption, title: t.title || b.title, files: b.media, planned: t.planned_at })));
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
      ${k === 'vk' ? `<div class="svc vkid"><h4>Статистика VK ${S.vkid.connected ? '<span class="pill green">подключена</span>' : '<span class="pill muted">ещё нет</span>'}</h4>
        <p class="muted small">Просмотры и охват постов и клипов, статистика сообщества. Ключ сообщества их не отдаёт — нужен вход администратора через VK ID (только чтение).${S.vkid.title ? ` Вошёл: <b>${esc(S.vkid.title)}</b>.` : ''}</p>
        ${S.vkid.error ? `<p class="err small">${esc(S.vkid.error)}</p>` : ''}
        <a class="${S.vkid.connected ? 'ghost' : 'primary'} small btn" href="/oauth/vkid/start" target="_blank" rel="opener">${S.vkid.connected ? 'Войти заново' : 'Войти через VK ID'}</a></div>` : ''}
      <div class="acc-act">${connect}${p.connected && p.test ? `<button class="ghost small" data-test="${k}" title="Настоящий путь публикации, но ничего не видно подписчикам">Проверить</button>` : ''}${p.connected || p.status === 'error' ? `<button class="ghost danger small" data-disconnect="${k}">Отключить</button>` : ''}</div>
      ${p.connect === 'oauth' && p.appReady && (!p.connected || p.loopback) ? `<form class="paste" data-paste="${k}">
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
        <ul class="formats">${Object.values(p.formats).map((f) => `<li><b>${esc(f.title)}</b> ${lvl(f.level)}<br><span class="muted small">${esc(f.hint || '')}</span></li>`).join('')}</ul>
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
      <h4>Уведомления в Telegram</h4>
      ${sv.notify.bot ? `<p class="muted small">Бот <b>@${esc(sv.notify.bot)}</b> пишет каждому, кто подключился: что вышло, что выложить руками и что сломалось.</p>
        <ul class="people">${sv.notify.people.map((u) => `<li>${esc(u.name)}${u.me ? ' <span class="muted small">(вы)</span>' : ''} — ${u.linked ? `<span class="pill green">подключено</span> <span class="muted small">${esc(u.tg_name || '')}</span>` : '<span class="pill muted">не подключено</span>'}</li>`).join('')}</ul>
        <div class="acc-act">${sv.notify.people.find((u) => u.me)?.linked
          ? '<button type="button" class="ghost small" data-notify-test>Отправить проверку</button><button type="button" class="ghost danger small" data-tg-unlink>Отключить мои уведомления</button>'
          : '<button type="button" class="primary small" data-tg-link>Подключить мой Telegram</button>'}</div>`
        : '<p class="muted small">Сначала подключите бота в карточке «Telegram» выше — уведомления присылает он же.</p>'}
    </div>
    <div class="svc">
      <h4>Публичная папка (фото в Instagram) ${F.MEDIA_PUBLIC_URL.set ? '<span class="pill green">задана</span>' : '<span class="pill muted">ещё нет</span>'}</h4>
      <p class="muted small">Нужна только для фото и каруселей Instagram: их Meta берёт по ссылке. Reels загружаются напрямую и без неё. Пока Глашатай работает локально — фото в Instagram выкладываются вручную.</p>
      ${settingsForm([F.MEDIA_SCP_TARGET, F.MEDIA_PUBLIC_URL])}
    </div>
    <div class="svc">
      <h4>Яндекс Метрика (сайт) ${F.METRIKA_TOKEN.set ? '<span class="pill green">подключена</span>' : '<span class="pill muted">ещё нет</span>'}</h4>
      <p class="muted small">Посетители oskolkihaosa.ru и откуда они пришли — в «Аналитике», рядом с цифрами постов. Токен — с oauth.yandex.ru, право только «получение статистики»: менять что-либо на сайте и в Метрике Глашатай не сможет.</p>
      ${settingsForm([F.METRIKA_TOKEN])}
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

/* copy — «Копия на другую площадку»: то же содержимое, новый пост без площадки. */
function openEditor(post, { copy = false } = {}) {
  E = post && !copy
    ? { id: post.id, media: [...post.media], removed: [], targets: post.targets.filter((t) => t.status !== 'cancelled').map((t) => ({ ...t, planned: toInput(t.planned_at) })) }
    : { id: null, media: post ? [...post.media] : [], removed: [], targets: [] };
  const f = $('#post-form');
  f.title.value = post?.title || ''; f.caption.value = post?.caption || ''; f.release.value = post?.release || ''; f.note.value = post?.note || '';
  E.cover_sec = post?.cover_sec ?? null; E.cover_image = post?.cover_image ?? null; E.manualOpen = false;
  f.comment.value = post?.comment || '';
  f.oracle.checked = !!post?.targets?.some((t) => t.oracle);
  const mine = E.targets[0];
  $('#ed-title').textContent = E.id ? (mine ? `Пост · ${S.platforms[mine.platform].title} · ${S.platforms[mine.platform].formats[mine.format]?.title || ''}` : 'Пост') : copy ? 'Копия на другую площадку' : 'Новый пост';
  $('#cap-hint').textContent = E.id && mine ? `для ${S.platforms[mine.platform].title}` : 'одна на все отмеченные площадки — потом у каждого поста можно поправить свою';
  $('#del').hidden = !E.id;
  editorState(mine); renderApprove(E.id && post);
  renderPicked(); renderTargets(); check();
  $('#editor').showModal();
}

/*
 * Что можно с постом — по состоянию его публикации:
 *   черновик/ошибка — всё; в очереди (и «ждёт вас» без загрузки) — правка, остаётся в очереди;
 *   на площадке (опубликовано, публикуется, неясно, загруженный черновик TikTok) — только смотреть и сделать копию.
 */
const onPlatform = (t) => t && (['publishing', 'published', 'unknown'].includes(t.status) || (t.status === 'due' && t.remote_id));
/* Утверждение: что подготовил Claude, сначала смотрит человек. Без него «В очередь» не пустит. */
function renderApprove(post) {
  const el = $('#ed-approve');
  el.hidden = !post;
  if (!post) return;
  const when = post.approved_at ? `${day(post.approved_at)} в ${time(post.approved_at)}` : '';
  el.className = `ed-approve ${post.approved_at ? 'ok' : 'wait'}`;
  el.innerHTML = post.approved_at
    ? `✓ Утверждено${post.approved_by && post.approved_by !== 'до правила' ? `: ${esc(post.approved_by)}` : ''}${post.approved_by === 'до правила' ? ' (было в работе до правила утверждения)' : `, ${when}`}`
      + (post.targets.some((t) => !['draft', 'cancelled', 'failed'].includes(t.status)) ? '' : ' <button type="button" class="ghost small" data-approve="0">Снять утверждение</button>')
    : `📝 <b>На утверждении.</b> Это подготовил Claude — посмотрите файл (👁 Предпросмотр), подпись и комментарий. Пока не утвердите, в очередь пост не встанет.
       <button type="button" class="primary small" data-approve="1">Утвердить</button>`;
}

function editorState(t) {
  const locked = onPlatform(t), queued = t && (t.status === 'scheduled' || (t.status === 'due' && !t.remote_id));
  E.locked = locked;
  for (const el of $('#post-form').querySelectorAll('.ed-main input, .ed-main textarea, .ed-main select, .ed-main .upload, .library')) {
    if (el.matches('.upload, .library')) el.hidden = locked; else el.disabled = locked;
  }
  $('#picked').classList.toggle('ro', locked);
  $('#comment-tpl').hidden = locked;
  $('#save').hidden = locked; $('#save-queue').hidden = locked || queued; $('#del').hidden = !E.id || locked;
  $('#ed-copy').hidden = !E.id; $('#ed-unschedule').hidden = !(t && t.status === 'scheduled');
  $('#save').textContent = queued ? 'Сохранить (останется в очереди)' : 'Сохранить черновиком';
  const st = $('#ed-state');
  st.hidden = !t || t.status === 'draft';
  if (!t || t.status === 'draft') return;
  const when = (iso) => `${day(iso)} в ${time(iso)}`;
  st.className = `ed-state st-${t.status}`;
  st.innerHTML = {
    published: `✅ Опубликовано ${t.published_at ? when(t.published_at) : ''} ${t.url ? `· <a href="${esc(t.url)}" target="_blank" rel="noopener">Открыть ↗</a>` : ''} ${t.stats ? `· ${statsLine(t.stats)}` : ''}<br><span class="small">Пост уже на площадке — здесь его не изменить. Выпустить ещё раз — «＋ Копия».</span>`,
    publishing: '⏳ Публикуется прямо сейчас — подождите.',
    unknown: `⚠️ Связь оборвалась посреди отправки — проверьте площадку. ${esc(t.error || '')}`,
    due: t.remote_id ? '◐ Ролик уже в TikTok (черновик во «Входящих»). Опубликуйте в приложении и отметьте «Опубликовано» в очереди.' : `✋ Пора выложить вручную (${when(t.planned_at)}) — «Пакет» в очереди. Правки здесь попадут в пакет.`,
    scheduled: `🕓 В очереди на ${when(t.planned_at)}. Правки сохранятся — пост останется в очереди.`,
    failed: `❌ Не вышло: ${esc(t.error || '')}. Поправьте и снова «в очередь».`,
    cancelled: 'Отменено.',
  }[t.status] || '';
}

function renderPicked() {
  $('#media-kind').textContent = `· ${KIND[kindOf(E.media)]}`;
  $('#picked').innerHTML = E.media.map((m, i) => `<figure>${isVideo(m) ? `<video src="${media(m)}#t=1" muted preload="metadata"></video>` : `<img src="${media(m)}" alt="">`}
    <figcaption>${esc(base(m))}</figcaption><span class="pk-act">${i ? `<button type="button" data-left="${i}" title="Левее">←</button>` : ''}<button type="button" data-unpick="${i}" title="Убрать">×</button></span></figure>`).join('')
    || '<p class="muted small">Без файлов — текстовый пост (только VK).</p>';
  renderCover();
  if (library) renderLibrary();
}

// Обложка: кадр ролика (ползунок с живым кадром) или своя картинка.
/* Выбранные форматы: у сохранённого поста — его площадка, у нового — все отмеченные. */
const chosen = () => E.targets.filter((t) => !t.removed).map((t) => ({ t, p: S.platforms[t.platform], f: S.platforms[t.platform].formats[t.format] }));
const names = (list) => [...new Set(list.map((x) => x.p.title))].join(', ');

function renderCover() {
  const v = E.media.find(isVideo);
  const sel = chosen(), can = sel.filter((x) => x.f.cover.length), inApp = sel.filter((x) => !x.f.cover.length && x.f.rules.media === 'video');
  // Блок обложки — только если хоть одна выбранная площадка ставит обложку сама.
  $('#cover').hidden = !v || !can.length;
  if ($('#cover').hidden) return;
  const withImg = can.filter((x) => x.f.cover.includes('image'));
  $('#cover-note').textContent = [`ставит сама: ${names(can)}`, inApp.length ? `в приложении выбираете: ${names(inApp)}` : ''].filter(Boolean).join(' · ');
  $('#cover-image-opt').hidden = $('#cover-upload-btn').hidden = !withImg.length;
  $('#cover-image-note').textContent = withImg.length < can.length ? `(${names(withImg)}; остальные возьмут кадр сами)` : '';
  if (!withImg.length && E.cover_image) E.cover_image = null;
  const mode = E.cover_image ? 'image' : E.cover_sec != null ? 'frame' : 'auto';
  for (const r of document.querySelectorAll('[name=cover-mode]')) r.checked = r.value === mode;
  const vid = $('#cover-video'), img = $('#cover-img'), range = $('#cover-sec');
  if (vid.dataset.src !== v) { vid.src = media(v); vid.dataset.src = v; vid.onloadedmetadata = () => { range.max = Math.max(0, vid.duration - 0.1).toFixed(1); vid.currentTime = E.cover_sec ?? 1; }; }
  else if (E.cover_sec != null) vid.currentTime = E.cover_sec;
  range.value = E.cover_sec ?? 1;
  $('#cover-sec-label').textContent = `${(+range.value).toFixed(1)} с`;
  img.hidden = mode !== 'image'; vid.hidden = mode === 'image';
  if (mode === 'image') img.src = media(E.cover_image);
}

function renderLibrary() {
  const groups = Map.groupBy(library, (f) => f.path.split('/').slice(0, -1).join('/'));
  $('#library').innerHTML = [...groups].map(([dir, files]) => `<div class="lib-dir"><h4>${esc(dir)}</h4><div class="lib-grid">${files.map((f) => `
    <button type="button" class="lib-item ${E.media.includes(f.path) ? 'on' : ''}" data-pick="${esc(f.path)}" title="${esc(f.path)}">
      ${f.video ? vthumb(f.path) : `<img src="${media(f.path)}" loading="lazy" alt="">`}
      <span>${esc(base(f.path))}</span><small>${f.video ? `${f.duration ?? '?'} с · ` : ''}${f.width ? `${f.width}×${f.height} · ` : ''}${f.mb} МБ</small></button>`).join('')}</div></div>`).join('');
}

function renderTargets() {
  const kind = kindOf(E.media);
  // Один пост — одна площадка: у сохранённого поста показываем только его площадку.
  const mine = E.id ? E.targets.find((x) => !x.removed) : null;
  let html = E.id ? '' : '<p class="muted small">Каждая отмеченная площадка станет <b>отдельным постом</b> с этим содержимым — дальше у каждого своя подпись, время и обложка.</p>';
  for (const [k, p] of Object.entries(S.platforms)) {
    if (mine && k !== mine.platform) continue;
    html += `<div class="tp" style="--c:${p.color}"><h4>${esc(p.title)}${p.connected || S.dry ? '' : ' <span class="muted small">· не подключён</span>'}</h4>`;
    for (const [fk, f] of Object.entries(p.formats)) {
      if (mine && fk !== mine.format) continue;
      const t = E.targets.find((x) => x.platform === k && x.format === fk && !x.removed);
      const fits = fitsKind(f.rules, kind);
      const locked = t && t.id && !['draft', 'failed', 'scheduled'].includes(t.status) && !(t.status === 'due' && !t.remote_id);
      html += `<div class="tf ${t ? 'on' : ''} ${fits ? '' : 'unfit'}">
        <label class="tf-head"><input type="checkbox" data-tgl="${k}/${fk}" ${t ? 'checked' : ''} ${locked ? 'disabled' : ''}> <b>${esc(f.title)}</b>
          ${lvl(t && t.mode === 'manual' ? 'manual' : f.level)} ${fits ? '' : `<span class="muted small">не для «${KIND[kind]}»</span>`}
          ${t?.status && t.status !== 'draft' ? pill(t.status) : ''}</label>`;
      if (t && !locked) {
        const i = E.targets.indexOf(t);
        html += `<div class="tf-body">
          <div class="tf-when"><input type="datetime-local" data-f="planned" data-i="${i}" value="${t.planned}">
          <select data-f="mode" data-i="${i}"><option value="auto" ${t.mode !== 'manual' ? 'selected' : ''} ${f.auto ? '' : 'disabled'}>автоматом</option><option value="manual" ${t.mode === 'manual' ? 'selected' : ''}>вручную</option></select></div>
          ${f.rules.title ? `<input data-f="title" data-i="${i}" placeholder="Название (по умолчанию — название поста)" value="${esc(t.title || '')}" maxlength="100">` : ''}
          <p class="hint small">${esc(f.hint || '')}</p>
          <ul class="problems" data-problems="${k}/${fk}"></ul>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  if (E.id) html += `<button type="button" class="ghost small copy-post" data-copy-post>＋ Копия на другую площадку</button>`;
  $('#targets').innerHTML = html;
  renderCover(); renderCaption(); renderManual(); renderComment(); renderTasks();
}

/* Подпись — по возможностям: истории без подписи; TikTok-черновик — подпись не уходит, её вставляют вручную. */
const COMMENT_TPL = '🎧 Полная песня — в VK Музыке и Яндекс Музыке. Ссылка в профиле ↑\nЛетопись отряда — в Telegram: @oskolkihaosa';

/* Первый комментарий — только где у площадки есть комментарии; кто его оставит — Глашатай (auto) или вы (manual). */
function renderComment() {
  $('#oracle-box').hidden = !chosen().some((x) => ['youtube', 'instagram'].includes(x.t.platform));
  const sel = chosen().filter((x) => x.f.comment);
  $('#comment-box').hidden = !sel.length;
  if (!sel.length) return;
  const auto = sel.filter((x) => x.f.comment === 'auto'), man = sel.filter((x) => x.f.comment === 'manual');
  $('#comment-hint').textContent = [auto.length ? `оставит Глашатай: ${names(auto)}` : '', man.length ? `оставите вы: ${names(man)}` : '', 'закрепляете вы'].filter(Boolean).join(' · ');
}

/* Задачи после публикации: галочка, «Скопировать», ссылка на пост. */
function renderTasks() {
  const box = $('#ed-tasks'), t = E.id ? E.targets[0] : null;
  const tasks = t?.tasks || [];
  box.hidden = !tasks.length;
  if (!tasks.length) return;
  const left = tasks.filter((x) => !x.done).length;
  box.innerHTML = `<b>${left ? `✋ Осталось сделать: ${left}` : '✓ Всё сделано'}</b>${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener" class="small">открыть пост ↗</a>` : ''}
    <ul class="tasks">${tasks.map((x) => `<li class="${x.done ? 'done' : ''}">
      <label><input type="checkbox" data-task="${x.key}" ${x.done ? 'checked' : ''}> ${esc(x.title)}</label>
      ${x.copy ? `<button type="button" class="ghost small" data-task-copy="${x.key}">Скопировать</button>` : ''}
      ${x.note && !x.done ? `<div class="small muted">${esc(x.note)}</div>` : ''}</li>`).join('')}</ul>`;
}

function renderCaption() {
  const sel = chosen(), lab = $('#post-form').caption.closest('label');
  $('#title-hint').textContent = sel.some((x) => x.f.rules.title) ? 'для себя и название ролика на YouTube (если не задано своё)' : 'для себя — на площадку не уходит';
  lab.hidden = sel.length > 0 && sel.every((x) => x.f.caption === 'none');
  const copy = sel.filter((x) => x.f.caption === 'copy');
  const mine = E.id ? E.targets[0] : null;
  $('#cap-hint').textContent = copy.length
    ? `${names(copy)} не принимает подпись автоматически — вставите сами, бот пришлёт её в Telegram`
    : mine ? `для ${S.platforms[mine.platform].title}` : 'одна на все отмеченные площадки — потом у каждого поста можно поправить свою';
}

/*
 * «Вручную»: что сделать самому и отметка «вышло». Показывается для ручных и полуавтоматических форматов,
 * для ошибок и «неясно», и по просьбе для автоматических («выложу сам»). У вышедшего — добавить ссылку.
 */
function renderManual() {
  const box = $('#ed-manual'), t = E.id ? E.targets[0] : null;
  if (!t) { box.hidden = true; return; }
  const p = S.platforms[t.platform], f = p.formats[t.format], post = S.posts.find((x) => x.id === E.id);
  const level = levelOf(t);
  if (t.status === 'published') {
    box.hidden = !!t.url;
    box.innerHTML = t.url ? '' : `<b>Ссылка на вышедший пост</b><div class="tok"><input id="man-url" placeholder="https://…"><button type="button" class="primary small" data-man="link">Добавить ссылку</button></div>`;
    return;
  }
  const need = level !== 'full' || ['failed', 'unknown'].includes(t.status) || E.manualOpen;
  box.hidden = false;
  if (!need) { box.innerHTML = '<button type="button" class="link small" data-man="open">Выложу на этой площадке сам, вручную</button>'; return; }
  const why = t.status === 'failed' ? 'Автоматически не вышло — можно выложить вручную:' : t.status === 'unknown' ? 'Проверьте площадку: если поста нет — выложите вручную:' : level === 'half' ? 'Глашатай загрузит ролик сам, остальное — вы:' : level === 'manual' ? 'Эту публикацию выкладываете вы:' : 'Выложить вручную вместо Глашатая:';
  box.innerHTML = `<b>✋ Вручную · ${esc(p.title)} ${esc(f.title)}</b><p class="small muted">${why}</p>
    <ol class="steps">${f.manual.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="acc-act">${post?.caption && f.caption !== 'none' ? '<button type="button" class="ghost small" data-man="copy">Скопировать подпись</button>' : ''}
      ${(post?.media || []).map((m) => `<a class="ghost small btn" href="${media(m)}" download="${esc(base(m))}">⬇ ${esc(base(m))}</a>`).join('')}</div>
    <div class="tok"><input id="man-url" placeholder="Ссылка на вышедший пост (можно пусто)"><button type="button" class="primary small" data-man="mark">Опубликовано вручную</button></div>`;
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
    comment: $('#comment-box').hidden ? null : $('#post-form').comment.value,
    ...($('#oracle-box').hidden ? {} : { oracle: $('#post-form').oracle.checked }),
    cover_sec: E.media.some(isVideo) ? E.cover_sec : null, cover_image: E.media.some(isVideo) ? E.cover_image : null,
    targets: E.targets.filter((t) => !t.removed && (!t.id || ['draft', 'failed', 'scheduled'].includes(t.status) || (t.status === 'due' && !t.remote_id)))
      .map((t) => ({ id: t.id, platform: t.platform, format: t.format, planned_at: fromInput(t.planned), mode: t.mode || 'auto', caption: null, title: t.title || null })),
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
  const r = await api(E.id ? 'PUT' : 'POST', E.id ? `/api/posts/${E.id}` : '/api/posts', body).catch((e) => (toast(e.message, true), {}));
  if (!r.id) return;
  const ids = r.ids || [r.id];
  if (queue) {
    await load();
    const errs = [];
    for (const t of S.posts.filter((p) => ids.includes(p.id)).flatMap((p) => p.targets).filter((x) => ['draft', 'failed'].includes(x.status))) {
      await api('POST', `/api/targets/${t.id}/schedule`, {}).catch((e) => errs.push(`${S.platforms[t.platform].title}: ${e.message}`));
    }
    if (errs.length) toast(`Не всё в очереди — ${errs.join(' · ')}`, true); else toast('Сохранено, всё в очереди');
  } else toast(ids.length > 1 ? `Сохранено: ${ids.length} поста — по одному на площадку` : 'Сохранено');
  $('#editor').close();
  await load();
}

// ---------- События ----------

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-act],[data-edit],[data-filter],[data-close],[data-copy],[data-copytext],[data-mark],[data-disconnect],[data-pick],[data-unpick],[data-left],[data-dry],[data-notify-test],[data-tg-link],[data-tg-unlink],[data-pv],[data-pv-more],[data-test],[data-pv-mode],[data-copy-post],[data-man],[data-task-copy],[data-approve]')?.dataset;
  if (!d) return;
  try {
    if (d.taskCopy) { await navigator.clipboard.writeText(E.targets[0].tasks.find((x) => x.key === d.taskCopy).copy); toast('Скопировано'); }
    else if (d.man) {
      const t = E.targets[0];
      if (d.man === 'open') { E.manualOpen = true; renderManual(); }
      if (d.man === 'copy') { await navigator.clipboard.writeText(S.posts.find((x) => x.id === E.id).caption); toast('Подпись скопирована'); }
      if (d.man === 'mark' || d.man === 'link') {
        await api('POST', `/api/targets/${t.id}/${d.man}`, { url: $('#man-url').value.trim() });
        toast(d.man === 'mark' ? 'Отмечено: опубликовано вручную' : 'Ссылка добавлена'); $('#editor').close(); await load();
      }
    }
    else if ('copyPost' in d) {
      const f = $('#post-form'), src = { title: f.title.value, caption: f.caption.value, release: f.release.value, note: f.note.value, media: [...E.media], cover_sec: E.cover_sec, cover_image: E.cover_image, targets: [] };
      openEditor(src, { copy: true });
    }
    else if (d.pvMode) { PV_MODE = d.pvMode; openPreview(PV, PV.i || 0); }
    else if (d.pv) openPreview(PV, +d.pv);
    else if ('pvMore' in d) { e.preventDefault(); const t = e.target.closest('.pv-text'); t.querySelector('.pv-short').hidden = true; t.querySelector('.pv-full').hidden = false; }
    else if (d.approve) {
      await api('POST', `/api/posts/${E.id}/approve`, { on: d.approve === '1' });
      toast(d.approve === '1' ? 'Утверждено — теперь можно в очередь' : 'Утверждение снято');
      await load(); renderApprove(S.posts.find((p) => p.id === E.id));
    }
    else if (d.act) await act(d.act, d.id);
    else if (d.edit) { e.preventDefault(); openEditor(S.posts.find((p) => p.id === +d.edit)); }
    else if (d.filter) { filter = d.filter; localStorage.setItem('ap-filter', filter); renderQueue(); }
    else if ('close' in d) e.target.closest('dialog').close();
    else if (d.copytext) { await navigator.clipboard.writeText(d.copytext); toast('Скопировано'); }
    else if (d.dry) {
      if (d.dry === '0' && !confirm('Выключить тестовый режим? Посты из очереди начнут уходить на подключённые площадки.')) return;
      await api('POST', '/api/dry', { on: d.dry === '1' }); await load();
    }
    else if (d.test) {
      const btn = e.target.closest('button'); btn.disabled = true; btn.textContent = 'Проверяю…';
      try { const r = await api('POST', `/api/test/${d.test}`); toast(`✓ ${S.platforms[d.test].title}: ${r.text}`); }
      catch (err) { toast(`✗ ${S.platforms[d.test].title}: ${err.message}`, true); }
      finally { await load(); }
    }
    else if ('tgLink' in d) {
      const r = await api('POST', '/api/me/telegram');
      window.open(r.link, '_blank');
      toast('Откроется бот — нажмите «Start» (Запустить). Статус обновится сам.');
    }
    else if ('tgUnlink' in d) { await api('DELETE', '/api/me/telegram'); await load(); }
    else if ('notifyTest' in d) { await api('POST', '/api/notify-test'); toast('Отправлено — проверьте Telegram'); }
    else if ('copy' in d) { await navigator.clipboard.writeText($('.pack-cap pre').textContent); toast('Подпись скопирована'); }
    else if (d.mark) { await api('POST', `/api/targets/${d.mark}/mark`, { url: $('#pack-url').value.trim() }); $('#pack').close(); toast('Отмечено'); await load(); }
    else if (d.disconnect) { if (confirm('Отключить площадку? Ключ удалится.')) { await api('DELETE', `/api/accounts/${d.disconnect}`); await load(); } }
    else if (d.pick) { const i = E.media.indexOf(d.pick); i >= 0 ? E.media.splice(i, 1) : E.media.push(d.pick); renderPicked(); renderTargets(); check(); }
    else if (d.unpick) { E.media.splice(+d.unpick, 1); renderPicked(); renderTargets(); check(); }
    else if (d.left) { const i = +d.left; [E.media[i - 1], E.media[i]] = [E.media[i], E.media[i - 1]]; renderPicked(); check(); }
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
$('#ed-preview').onclick = previewFromEditor;
$('#ed-unschedule').onclick = async () => {
  const t = E.targets[0];
  try { await api('POST', `/api/targets/${t.id}/unschedule`, {}); toast('Снято с очереди — теперь черновик'); $('#editor').close(); await load(); } catch (err) { toast(err.message, true); }
};
$('#save-queue').onclick = () => save(true);
$('#del').onclick = async () => {
  if (!confirm('Удалить пост вместе с публикациями-черновиками?')) return;
  try { await api('DELETE', `/api/posts/${E.id}`); $('#editor').close(); await load(); } catch (err) { toast(err.message, true); }
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
// Галочки задач после публикации.
document.addEventListener('change', async (e) => {
  const key = e.target.dataset?.task;
  if (!key) return;
  const t = E.targets[0];
  try {
    await api('POST', `/api/targets/${t.id}/task`, { key, done: e.target.checked });
    t.tasks.find((x) => x.key === key).done = e.target.checked;
    renderTasks(); load();
  } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
});
$('#comment-tpl').onclick = () => { $('#post-form').comment.value = COMMENT_TPL; check(); };

// Обложка: режим, ползунок, своя картинка.
document.addEventListener('change', (e) => {
  if (e.target.name === 'cover-mode') {
    if (e.target.value === 'auto') { E.cover_sec = null; E.cover_image = null; }
    if (e.target.value === 'frame') { E.cover_image = null; E.cover_sec = +$('#cover-sec').value; }
    if (e.target.value === 'image' && !E.cover_image) { $('#cover-upload').click(); return; }
    renderCover();
  }
});
$('#cover-sec').addEventListener('input', (e) => { E.cover_image = null; E.cover_sec = +e.target.value; renderCover(); });
$('#cover-upload').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return renderCover();
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'x-autopost': '1' } }).then((x) => x.json());
  E.cover_image = r.path; E.cover_sec = null; e.target.value = '';
  renderCover();
};

window.addEventListener('hashchange', render);
await load();
// Пока открыт редактор — не перерисовываем под руками; очередь обновляется сама.
setInterval(() => {
  const typing = document.activeElement?.matches('input, textarea, select') || document.querySelector('details.setup[open] input:not(:placeholder-shown)');
  if (!$('#editor').open && !$('#pack').open && !$('#pw').open && !$('#pv').open && !typing && document.visibilityState === 'visible') load(true).catch(() => {});
}, 5000);
