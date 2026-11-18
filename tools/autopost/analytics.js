import { db, all, run, log, now } from './db.js';
import { account, setting } from './secrets.js';
import { PLATFORMS } from './platforms/index.js';
import { communityStats } from './platforms/vk.js';

/*
 * Аналитика: снимок подписчиков каждой площадки раз в сутки (рост виден только с того дня, как начали записывать)
 * + цифры публикаций (их собирает collectStats в publish.js). Что площадка не отдаёт — показываем честно, с причиной.
 */

db.exec(`create table if not exists followers (
  platform text not null,
  day text not null,
  count integer,
  extra text,
  primary key (platform, day)
)`);

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // день по Москве
const errors = new Map(); // площадка → почему нет цифры (последняя попытка)

/** Снимок подписчиков; за сегодня перезаписывается — в истории остаётся последнее значение дня. */
export async function snapshotFollowers() {
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const acc = account(k);
    if (!p.followers || acc?.status !== 'connected') continue;
    try {
      const r = await p.followers(acc);
      if (r.error) { errors.set(k, r.error); continue; }
      errors.delete(k);
      const { count, ...extra } = r;
      run(`insert into followers (platform, day, count, extra) values (?,?,?,?)
        on conflict(platform, day) do update set count=excluded.count, extra=excluded.extra`, k, today(), count, JSON.stringify(extra));
    } catch (e) {
      errors.set(k, e.message);
      log(`${p.title}: подписчики не собрались: ${e.message}`, { level: 'warn' });
    }
  }
}

/* Чего площадка не отдаёт по публикациям — подпись в разделе, чтобы пустые клетки не путали. */
const LIMITS = {
  vk: 'просмотры, лайки, репосты, комментарии постов (посты находятся на стене сами); охват, клипы и статистика сообщества — после подтверждения бизнес-профиля VK ID и «Войти через VK ID»',
  telegram: 'просмотры — с открытой страницы канала; лайков у постов нет',
  instagram: 'лайки и комментарии; просмотры и охват — после права instagram_manage_insights в новом маркере Meta',
  tiktok: 'цифры роликов — после права video.list в приложении TikTok и ссылки на ролик',
  youtube: 'просмотры, лайки, комментарии',
};

/* Прослушивания — вручную из кабинета артиста (через API их не получить): месяц → слушатели VK Музыки и Яндекса, доход. */
db.exec('create table if not exists music (month text primary key, vk integer, yandex integer, income integer, by text, at text)');
export function saveMusic(b, by) {
  if (!/^\d{4}-\d\d$/.test(b.month || '')) return { error: 'месяц — в виде 2026-11' };
  const n = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(+String(v).replace(/\s/g, ''))) || 0);
  run('insert into music (month, vk, yandex, income, by, at) values (?,?,?,?,?,?) on conflict(month) do update set vk=excluded.vk, yandex=excluded.yandex, income=excluded.income, by=excluded.by, at=excluded.at',
    b.month, n(b.vk), n(b.yandex), n(b.income), by, now());
  log(`прослушивания за ${b.month} внесены`, { by });
  return { ok: true };
}

export function analyticsState() {
  const since = new Date(Date.now() + 3 * 3600_000 - 60 * 864e5).toISOString().slice(0, 10);
  const rows = all('select * from followers where day >= ? order by day', since);
  const series = Object.groupBy(rows, (r) => r.platform);
  return {
    now: now(),
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => [k, {
      title: p.title, connected: account(k)?.status === 'connected', limit: LIMITS[k],
      error: errors.get(k) || null,
      followers: (series[k] || []).map((r) => ({ day: r.day, count: r.count, ...JSON.parse(r.extra || '{}') })),
    }])),
    music: all('select month, vk, yandex, income from music order by month'),
    posts: all(`select t.id, t.platform, t.format, t.url, t.published_at, t.stats, t.stats_at, p.id as post_id, p.title, p.release
      from targets t join posts p on p.id=t.post_id where t.status='published' and t.removed_at is null order by t.published_at desc`)
      .map((r) => ({ ...r, stats: r.stats ? JSON.parse(r.stats) : null })),
  };
}

/*
 * Сайт: Яндекс Метрика (только чтение, токен с правом metrika:read — в «Площадки → Сервис»).
 * История живёт в самой Метрике, поэтому в базу не пишем — спрашиваем за 30 дней и держим ответ 10 минут.
 */
const COUNTER = 114248884; // счётчик oskolkihaosa.ru, тот же, что в index.html сайта
let siteCache = null;
// Куда кликают с сайта (внешние ссылки): true — это «слушать».
const LINKS = [[/music\.yandex\./, 'Яндекс Музыка', true], [/vk\.(ru|com)\/(artist|music|audio)/, 'VK Музыка', true], [/(^|\/\/)t\.me\//, 'Telegram'],
  [/vk\.(ru|com)\//, 'Сообщество VK'], [/youtube\.|youtu\.be/, 'YouTube'], [/instagram\./, 'Instagram'], [/tiktok\./, 'TikTok']];
// Instagram открывает ссылки через редирект Meta — Метрика пишет такие визиты как «Facebook».
const NETWORK = { Facebook: 'Instagram / Facebook' };

async function metrika(token, params) {
  const q = new URLSearchParams({ ids: COUNTER, date1: '30daysAgo', date2: 'today', limit: 50, lang: 'ru', accuracy: 'full', ...params });
  const r = await fetch(`https://api-metrika.yandex.net/stat/v1/data?${q}`, { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? 'Метрика не приняла токен — нужен токен с правом «получение статистики» от аккаунта, где есть счётчик' : j.message || `Метрика ответила ${r.status}`);
  const rows = j.data.map((x) => ({ id: x.dimensions[0]?.id ?? null, name: x.dimensions[0]?.name ?? null, n: x.metrics }));
  rows.totals = j.totals || [];
  return rows;
}

export async function siteState(force = false) {
  const token = setting('METRIKA_TOKEN');
  if (!token) return { connected: false };
  if (!force && siteCache && Date.now() - siteCache.at < 600_000) return siteCache.v;
  let v;
  try {
    const [days, sources, social, utm, links] = await Promise.all([
      metrika(token, { dimensions: 'ym:s:date', metrics: 'ym:s:visits,ym:s:users', sort: 'ym:s:date' }),
      metrika(token, { dimensions: 'ym:s:lastTrafficSource', metrics: 'ym:s:visits', sort: '-ym:s:visits' }),
      metrika(token, { dimensions: 'ym:s:lastSocialNetwork', metrics: 'ym:s:visits', sort: '-ym:s:visits' }),
      metrika(token, { dimensions: 'ym:s:lastUTMSource', metrics: 'ym:s:visits', sort: '-ym:s:visits' }),
      metrika(token, { dimensions: 'ym:el:URL', metrics: 'ym:el:links', sort: '-ym:el:links', limit: 200 }),
    ]);
    const clicks = new Map();
    for (const l of links) {
      const [, name = new URL(l.name).hostname, listen = false] = LINKS.find(([re]) => re.test(l.name)) || [];
      const c = clicks.get(name) || { name, clicks: 0, listen };
      c.clicks += l.n[0]; clicks.set(name, c);
    }
    // «Из соцсетей» раскладываем по сетям — ради этого блок и нужен.
    const from = [...sources.filter((s) => s.id !== 'social'), ...social.filter((s) => s.name).map((s) => ({ ...s, name: NETWORK[s.name] || s.name }))]
      .map((s) => ({ name: s.name, visits: s.n[0] })).sort((a, b) => b.visits - a.visits);
    v = {
      connected: true,
      days: days.map((d) => ({ day: d.name, visits: d.n[0], users: d.n[1] })),
      visits: days.totals[0] ?? 0, users: days.totals[1] ?? 0, // уникальные за 30 дней — не сумма по дням
      links: [...clicks.values()].sort((a, b) => b.clicks - a.clicks),
      sources: from,
      utm: utm.filter((u) => u.name).map((u) => ({ name: u.name, visits: u.n[0] })),
    };
  } catch (e) {
    v = { connected: true, error: e.message };
  }
  siteCache = { at: Date.now(), v };
  return v;
}

/* VK-сообщество по дням (ключ администратора через VK ID): держим ответ 10 минут, как сайт. */
let vkCache = null;
export async function vkCommunity(force = false) {
  const acc = account('vk');
  if (acc?.status !== 'connected') return null;
  if (!force && vkCache && Date.now() - vkCache.at < 600_000) return vkCache.v;
  let v;
  try { const days = await communityStats(acc); v = days ? { connected: true, days } : { connected: false }; }
  catch (e) { v = { connected: true, error: e.message }; }
  vkCache = { at: Date.now(), v };
  return v;
}
