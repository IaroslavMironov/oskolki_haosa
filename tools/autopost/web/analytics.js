/*
 * Вкладка «Аналитика»: подписчики по площадкам (плитка: число, изменение за 7 дней, линия по дням),
 * средние просмотры на публикацию (полосы одного цвета — величина, не идентичность) и таблица всех публикаций.
 * Цвет данных — один акцент (золото); цвет площадки — только у подписи-чипа, не у марок.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
const dayRu = (d) => new Date(`${d}T12:00:00+03:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
const FORMAT = { short: 'Shorts', reels: 'Reels', post: 'Пост', image: 'Фото', carousel: 'Карусель', story: 'История', clip: 'Клип', video: 'Видео', draft: 'Черновик' };

let sort = { key: 'published_at', dir: -1 };
let A = null;

/* Линия подписчиков по дням: 2px, точки ≥8px целевой зоной, подсказка при наведении на точку. */
function spark(points, label = 'Подписчики по дням') {
  if (points.length < 2) return '<p class="an-muted">линия появится со второго дня</p>';
  const W = 220, H = 48, P = 4;
  const ys = points.map((p) => p.count), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const xy = points.map((p, i) => [P + (i * (W - 2 * P)) / (points.length - 1), H - P - ((p.count - min) / span) * (H - 2 * P)]);
  return `<svg class="an-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    <polyline points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xy.map(([x, y], i) => `<g class="an-pt"><circle cx="${x}" cy="${y}" r="9" fill="transparent"><title>${dayRu(points[i].day)}: ${fmt(points[i].count)}</title></circle><circle cx="${x}" cy="${y}" r="${i === xy.length - 1 ? 3.5 : 0}" fill="var(--gold)" stroke="#141018" stroke-width="2"/></g>`).join('')}
  </svg>`;
}

function tile(k, p, color) {
  const f = p.followers, last = f.at(-1), weekAgo = f.find((x) => x.day >= new Date(Date.now() + 3 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10)) || f[0];
  const delta = last && weekAgo && last !== weekAgo ? last.count - weekAgo.count : null;
  const extra = [last?.views != null ? `просмотров канала: ${fmt(last.views)}` : '', last?.posts != null ? `публикаций: ${fmt(last.posts)}` : ''].filter(Boolean).join(' · ');
  return `<section class="an-tile">
    <header><span class="chip" style="--c:${color}">${esc(p.title)}</span>${p.connected ? '' : '<span class="an-muted">не подключено</span>'}</header>
    ${last ? `<div class="an-big">${fmt(last.count)}</div><div class="an-sub">подписчиков${delta != null ? ` · <b class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '+' : ''}${fmt(delta)}</b> с ${dayRu(weekAgo.day)}` : ''}</div>`
      : `<div class="an-big an-muted">—</div><div class="an-sub">${esc(p.error || (p.connected ? 'соберётся в течение часа' : ''))}</div>`}
    ${last ? spark(f) : ''}
    ${extra ? `<div class="an-sub">${extra}</div>` : ''}
  </section>`;
}

/* Средние просмотры на публикацию по площадке и формату: горизонтальные полосы, один цвет, значение подписью. */
function bars(posts, platforms) {
  const groups = Map.groupBy(posts.filter((p) => p.stats?.views != null), (p) => `${platforms[p.platform].title} · ${FORMAT[p.format] || p.format}`);
  const rows = [...groups].map(([name, list]) => ({ name, n: list.length, avg: Math.round(list.reduce((s, p) => s + p.stats.views, 0) / list.length) })).sort((a, b) => b.avg - a.avg);
  if (!rows.length) return '<p class="an-muted">Появится, когда у публикаций соберутся просмотры (раз в 6 часов или кнопкой «Обновить цифры»).</p>';
  const max = Math.max(...rows.map((r) => r.avg)) || 1;
  return `<div class="an-bars">${rows.map((r) => `<div class="an-bar" title="${esc(r.name)}: в среднем ${fmt(r.avg)} просмотров на публикацию (публикаций: ${r.n})">
    <span class="an-bar-name">${esc(r.name)}</span>
    <span class="an-bar-track"><i style="width:${Math.max(2, (r.avg / max) * 100)}%"></i></span>
    <span class="an-bar-val">${fmt(r.avg)} <small>· ${r.n} публ.</small></span></div>`).join('')}</div>`;
}

/* Сайт из Яндекс Метрики: посетители за 30 дней (линия по дням) и откуда пришли (полосы, один цвет). */
function site(s) {
  if (!s?.connected) return '<p class="an-muted">Подключите Яндекс Метрику в «Площадки → Сервис» — здесь появятся посетители сайта и откуда они пришли.</p>';
  if (s.error) return `<p class="an-muted">Метрика: ${esc(s.error)}</p>`;
  const listen = s.links.filter((l) => l.listen).reduce((a, l) => a + l.clicks, 0);
  const bars = (list, unit) => { const max = Math.max(1, ...list.map((x) => x.n)); return `<div class="an-bars">${list.map((x) => `<div class="an-bar" title="${esc(x.name)}: ${fmt(x.n)} ${unit} за 30 дней"><span class="an-bar-name">${esc(x.name)}</span>
    <span class="an-bar-track"><i style="width:${Math.max(2, (x.n / max) * 100)}%"></i></span><span class="an-bar-val">${fmt(x.n)}</span></div>`).join('')}</div>`; };
  return `<div class="an-site">
    <section class="an-tile"><header><span class="chip" style="--c:var(--gold)">oskolkihaosa.ru</span><span class="an-muted">30 дней</span></header>
      <div class="an-big">${fmt(s.users)}</div><div class="an-sub">посетителей · ${fmt(s.visits)} визитов · 🎧 <b>${fmt(listen)}</b> кликов «слушать»</div>
      ${spark(s.days.map((d) => ({ day: d.day, count: d.visits })), 'Визиты по дням')}</section>
    <div><h4 class="an-h4">Откуда пришли <span class="an-muted">· визиты</span></h4>${s.sources.length ? bars(s.sources.map((x) => ({ name: x.name, n: x.visits })), 'визитов') : '<p class="an-muted">Визитов пока нет.</p>'}
      ${s.utm.length ? `<h4 class="an-h4">По меткам в ссылках профилей</h4>${bars(s.utm.map((x) => ({ name: x.name, n: x.visits })), 'визитов')}` : ''}
      <h4 class="an-h4">Куда кликают с сайта <span class="an-muted">· 🎧 — слушать</span></h4>${s.links.length ? bars(s.links.map((x) => ({ name: `${x.listen ? '🎧 ' : ''}${x.name}`, n: x.clicks })), 'кликов') : `<p class="an-muted">${esc(s.note || 'Кликов по внешним ссылкам пока нет.')}</p>`}</div>
  </div>`;
}

/* VK-сообщество за 30 дней (ключ администратора): охват по дням, посетители, подписались/отписались. */
function vkBlock(v) {
  if (v?.pending) return '<p class="an-muted">VK пока не открыл приложению «Глашатай» доступ к статистике сообщества — ждём ответа поддержки VK. Как откроют, нажмите «Войти через VK ID» в карточке «ВКонтакте» ещё раз, и здесь появятся охват, посетители и отписки. Цифры постов (просмотры, лайки, репосты) уже собираются — они в таблице ниже.</p>';
  if (!v?.connected) return '<p class="an-muted">Охват сообщества, посетители и отписки появятся после подтверждения бизнес-профиля в кабинете VK ID и входа «Войти через VK ID» в карточке «ВКонтакте». Цифры постов уже собираются сервисным ключом.</p>';
  if (v.error) return `<p class="an-muted">${esc(v.error)}</p>`;
  const sum = (k) => v.days.reduce((a, d) => a + d[k], 0);
  return `<div class="an-site"><section class="an-tile"><header><span class="chip" style="--c:#4c8dff">Сообщество VK</span><span class="an-muted">30 дней</span></header>
    <div class="an-big">${fmt(Math.round(sum('reach') / Math.max(1, v.days.length)))}</div><div class="an-sub">охват в день, в среднем · из них подписчиков ${fmt(Math.round(sum('reach_subscribers') / Math.max(1, v.days.length)))}</div>
    ${spark(v.days.map((d) => ({ day: d.day, count: d.reach })), 'Охват по дням')}</section>
    <div class="an-kv"><div><b>${fmt(sum('visitors'))}</b><span>посетителей</span></div><div><b>${fmt(sum('views'))}</b><span>просмотров страницы</span></div>
      <div><b class="up">+${fmt(sum('subscribed'))}</b><span>подписались</span></div><div><b class="down">−${fmt(sum('unsubscribed'))}</b><span>отписались</span></div></div></div>`;
}

/* Прослушивания по месяцам — вносит человек из кабинета артиста VK Музыки и Яндекса. */
function music(rows) {
  const last = rows.at(-1);
  const month = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
  return `${rows.length ? `<div class="an-table-wrap"><table class="an-table"><thead><tr><th>Месяц</th><th class="num">VK Музыка</th><th class="num">Яндекс Музыка</th><th class="num">Доход, ₽</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.month)}</td><td class="num">${fmt(r.vk)}</td><td class="num">${fmt(r.yandex)}</td><td class="num">${fmt(r.income)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="an-muted">Пока не вносили.</p>'}
    <form class="an-music" data-music><input name="month" value="${month}" pattern="\\d{4}-\\d{2}" title="месяц: 2026-11"><input name="vk" inputmode="numeric" placeholder="слушателей VK Музыки" value="${last?.month === month ? last.vk ?? '' : ''}">
      <input name="yandex" inputmode="numeric" placeholder="слушателей Яндекса" value="${last?.month === month ? last.yandex ?? '' : ''}"><input name="income" inputmode="numeric" placeholder="доход, ₽" value="${last?.month === month ? last.income ?? '' : ''}">
      <button class="primary small">Сохранить</button></form>
    <p class="an-muted small">Цифры — из кабинета артиста VK Музыки и Яндекс Музыки или отчёта дистрибьютора: по API площадки их не отдают.</p>`;
}

const COLS = [['published_at', 'Дата'], ['platform', 'Площадка'], ['title', 'Пост'], ['views', 'Просмотры'], ['reach', 'Охват'], ['likes', 'Лайки'], ['comments', 'Комм.'], ['er', 'Вовлечённость']];
const NUM = ['views', 'reach', 'likes', 'comments', 'er'];
const val = (p, k) => (k === 'er' ? er(p) : NUM.includes(k) ? p.stats?.[k] ?? null : p[k]);
// Вовлечённость = (лайки + комментарии + репосты) / просмотры — только где площадка отдаёт и то и другое (у Telegram лайков нет — не 0%, а «—»).
const er = (p) => (p.stats?.views && (p.stats.likes != null || p.stats.comments != null) ? ((p.stats.likes || 0) + (p.stats.comments || 0) + (p.stats.shares || 0)) / p.stats.views : null);

function table(posts, platforms) {
  const list = [...posts].sort((a, b) => {
    const x = val(a, sort.key), y = val(b, sort.key);
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
  });
  if (!list.length) return '<p class="an-muted">Опубликованного пока нет.</p>';
  return `<div class="an-table-wrap"><table class="an-table"><thead><tr>${COLS.map(([k, t]) => `<th data-sort="${k}" class="${NUM.includes(k) ? 'num' : ''}">${t}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody>${list.map((p) => `<tr>
      <td>${p.published_at ? new Date(p.published_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }) : '—'}</td>
      <td><span class="chip" style="--c:${platforms[p.platform].color}">${esc(platforms[p.platform].title)}<i>${esc(FORMAT[p.format] || p.format)}</i></span></td>
      <td class="an-title"><a href="#" data-edit="${p.post_id}">${esc(p.title)}</a></td>
      <td class="num">${fmt(p.stats?.views)}</td><td class="num" title="${p.stats?.reach_subscribers != null ? `из них подписчиков: ${fmt(p.stats.reach_subscribers)}` : ''}">${fmt(p.stats?.reach)}</td><td class="num">${fmt(p.stats?.likes)}</td><td class="num">${fmt(p.stats?.comments)}</td>
      <td class="num">${er(p) == null ? '—' : `${(er(p) * 100).toFixed(1)}%`}</td>
      <td class="an-act">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="Открыть">↗</a>` : ''}<button class="link small" data-removed="${p.id}" title="Удалили на площадке — убрать из аналитики">✕</button></td></tr>`).join('')}</tbody></table></div>`;
}

export async function renderAnalytics(el, colors, api) {
  A = await api('GET', '/api/analytics');
  const P = Object.fromEntries(Object.entries(A.platforms).map(([k, p]) => [k, { ...p, color: colors[k] }]));
  const first = Object.values(A.platforms).flatMap((p) => p.followers.map((f) => f.day)).sort()[0];
  el.innerHTML = `
    <div class="an-head"><h2>Аналитика</h2><span class="an-muted">${first ? `подписчики записываются с ${dayRu(first)}` : ''}</span>
      <button class="ghost small" id="an-refresh">Обновить цифры</button></div>
    <div class="an-tiles">${Object.entries(P).map(([k, p]) => tile(k, p, p.color)).join('')}</div>
    <h3 class="an-h">Прослушивания <span class="an-muted">· вносятся вручную раз в месяц</span></h3>${music(A.music)}
    <h3 class="an-h">ВКонтакте <span class="an-muted">· сообщество</span></h3>${vkBlock(A.vk)}
    <h3 class="an-h">Сайт <span class="an-muted">· Яндекс Метрика</span></h3>${site(A.site)}
    <h3 class="an-h">Средние просмотры на публикацию</h3>${bars(A.posts, P)}
    <h3 class="an-h">Публикации <span class="an-muted">· нажмите на заголовок столбца, чтобы отсортировать</span></h3>${table(A.posts, P)}
    <ul class="an-limits">${Object.values(P).map((p) => `<li><b>${esc(p.title)}:</b> ${esc(p.limit)}</li>`).join('')}</ul>`;
  el.querySelector('#an-refresh').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Собираю…';
    try { await api('POST', '/api/analytics/refresh'); } finally { await renderAnalytics(el, colors, api); }
  };
  const mf = el.querySelector('[data-music]');
  if (mf) mf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/music', Object.fromEntries(new FormData(mf))); } catch (err) { alert(err.message); }
    renderAnalytics(el, colors, api);
  };
  for (const b of el.querySelectorAll('[data-removed]')) b.onclick = async () => {
    if (!confirm('Эту публикацию удалили на площадке? Она пропадёт из аналитики (в журнале останется).')) return;
    await api('POST', `/api/targets/${b.dataset.removed}/removed`, {});
    renderAnalytics(el, colors, api);
  };
  for (const th of el.querySelectorAll('[data-sort]')) th.onclick = () => {
    sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : -1 };
    renderAnalytics(el, colors, api);
  };
}
