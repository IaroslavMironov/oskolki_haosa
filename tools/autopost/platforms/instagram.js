import { statSync, openAsBlob } from 'node:fs';
import { call, form } from './http.js';
import { saveAccount, setting } from '../secrets.js';
import { log } from '../db.js';
import { notSent } from '../publish.js';
import { publicUrl } from '../pubmedia.js';
import { isVideo } from '../media.js';

/*
 * Instagram: API публикации Instagram (graph.instagram.com или graph.facebook.com — см. ниже) — без страницы Facebook.
 * Разведка 17.11.2026 (docs/площадки.md):
 *  — для своего аккаунта хватает стандартного доступа: без проверки приложения и бизнеса;
 *  — ключ — кнопкой «Generate token» в панели приложения Meta (60 дней), продлеваем сами (ig_refresh_token);
 *  — файлы Meta забирает по публичной ссылке (pubmedia.js); отложенной публикации в API нет — время держим мы;
 *  — из РФ API закрыт: запросы через прокси (NODE_USE_ENV_PROXY + HTTPS_PROXY), а файл Meta берёт с нашего сервера напрямую.
 * Порядок: контейнер → ждём FINISHED → media_publish. До media_publish в ленте ничего нет — ошибки там можно повторять.
 */

const V = process.env.IG_API_VERSION || 'v24.0';
/*
 * Маркеры бывают двух видов (17.11.2026: новые приложения Meta получают только «единый вход»):
 *  — IGAA… — вход через Instagram, API на graph.instagram.com;
 *  — EAA…  — «единый вход» (Unified login) / вход через Facebook, API на graph.facebook.com.
 * Публикация (контейнер → media_publish) у обоих одинаковая, отличается адрес. Адрес запоминаем при подключении.
 */
const HOSTS = { ig: `https://graph.instagram.com/${V}`, fb: `https://graph.facebook.com/${V}` };
const get = (host, path, token, params = {}) => call(`${HOSTS[host]}/${path}?${form({ ...params, access_token: token })}`, {}, { safe: true }).then((r) => r.body);
const post = (host, path, token, params, opts) => call(`${HOSTS[host]}/${path}`, { method: 'POST', body: form({ ...params, access_token: token }) }, opts).then((r) => r.body);

/**
 * Кто это: пробуем по очереди разные способы — какой маркер на каком адресе понимается. → { host, user, username }
 * igId — id аккаунта Instagram из панели Meta (цифры под ником рядом с «Создать маркер»), по желанию.
 */
async function whoIs(token, igId) {
  const named = (host, user, username) => { if (!username) throw new Error('нет имени аккаунта'); return { host, user: String(user), username }; };
  const tries = [
    ['ig /me', async () => { const me = await get('ig', 'me', token, { fields: 'user_id,username' }); return named('ig', me.user_id || me.id, me.username); }],
    ...(igId ? [
      ['fb /igid', async () => { const me = await get('fb', igId, token, { fields: 'id,username' }); return named('fb', me.id, me.username); }],
      ['ig /igid', async () => { const me = await get('ig', igId, token, { fields: 'id,username' }); return named('ig', me.id, me.username); }],
    ] : []),
    ['fb /me/accounts', async () => {
      const r = await get('fb', 'me/accounts', token, { fields: 'instagram_business_account{id,username}' });
      const ig = r.data?.map((p) => p.instagram_business_account).find(Boolean);
      if (!ig) throw new Error('к страницам Facebook этого маркера не привязан Instagram');
      return named('fb', ig.id, ig.username);
    }],
  ];
  const errors = [];
  for (const [name, t] of tries) {
    try { return await t(); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  // Подробности — в журнал (без маркера): по ним видно, какой путь ближе всего к рабочему.
  log(`Instagram: маркер не подошёл ни одним способом — ${errors.join(' | ')}`, { level: 'warn' });
  const net = errors.find((m) => /нет связи/.test(m));
  if (net) throw new Error(`${net} — из России API Instagram закрыт, включите VPN и повторите`);
  throw new Error(igId ? 'ни один способ не подошёл — подробности в «Журнале»' : 'впишите во второе поле id аккаунта Instagram (цифры под ником рядом с «Создать маркер» в панели Meta) и нажмите ещё раз');
}

/** Ключ из панели Meta → узнаём аккаунт и адрес API, сохраняем. */
export async function connectToken({ token, igid }) {
  token = String(token || '').trim();
  if (token.length < 50) return { error: 'Это не похоже на маркер (длинная строка из панели Meta → «Создать маркер»)' };
  try {
    const who = await whoIs(token, String(igid || '').replace(/\D/g, '') || null);
    // Срок маркера «единого входа» спрашиваем у самой Meta; не ответила — считаем, как у Instagram, 60 дней.
    let expires = Date.now() + 60 * 864e5;
    if (who.host === 'fb') {
      const d = await get('fb', 'debug_token', token, { input_token: token }).catch(() => null);
      if (d?.data?.expires_at === 0) expires = null;
      else if (d?.data?.expires_at) expires = d.data.expires_at * 1000;
    }
    saveAccount('instagram', { title: `@${who.username}`, secret: { token, user: who.user, host: who.host, got: Date.now() }, expiresAt: expires && new Date(expires).toISOString() });
    return { ok: true, title: `@${who.username}` };
  } catch (e) { return { error: `Instagram не принял маркер: ${e.message}` }; }
}

/** Продление маркера Instagram (IGAA…): не раньше суток после выдачи, раз в неделю. «Единый вход» так не продлевается — за 7 дней до конца напомним. */
export async function maintain(acc) {
  if ((acc.secret.host || 'ig') !== 'ig') {
    if (acc.expires_at && Date.parse(acc.expires_at) - Date.now() < 7 * 864e5) throw new Error(`маркер истекает ${new Date(acc.expires_at).toLocaleDateString('ru-RU')} — создайте новый в панели Meta и вставьте в кабинет`);
    return;
  }
  if (Date.now() - (acc.secret.got || 0) < 7 * 864e5) return;
  const r = await call(`https://graph.instagram.com/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: acc.secret.token })}`, {}, { safe: true });
  saveAccount('instagram', { title: acc.title, secret: { ...acc.secret, token: r.body.access_token, got: Date.now() }, expiresAt: new Date(Date.now() + r.body.expires_in * 1000).toISOString() });
}

/** Контейнер обрабатывается на стороне Meta: ждём до 10 минут. */
async function ready(host, id, token, progress) {
  for (let i = 0; i < 60; i++) {
    const { status_code: s } = await get(host, id, token, { fields: 'status_code' });
    if (s === 'FINISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw notSent(`Instagram не принял файл (${s}) — проверьте формат ролика`);
    progress(`Instagram обрабатывает файл… ${i * 10} с`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw notSent('Instagram обрабатывает файл дольше 10 минут — попробуйте позже');
}

/*
 * Видео — прямой загрузкой (upload_type=resumable → rupload.facebook.com), без публичной ссылки:
 * проверено 17.11.2026 с маркером «единого входа» (graph.facebook.com) — Meta приняла и обработала ролик.
 * Картинки Meta берёт только по ссылке (image_url) — нужна публичная папка.
 */
async function container(host, user, token, file, params) {
  if (!isVideo(file)) return post(host, `${user}/media`, token, { ...params, image_url: await publicUrl(file) }, { safe: true }).then((r) => r.id);
  if (host !== 'fb') return post(host, `${user}/media`, token, { ...params, video_url: await publicUrl(file) }, { safe: true }).then((r) => r.id);
  const c = await post(host, `${user}/media`, token, { ...params, upload_type: 'resumable' }, { safe: true });
  const { size } = statSync(file);
  const { body } = await call(c.uri, { method: 'POST', headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(size) }, body: await openAsBlob(file) }, { safe: true, timeout: 15 * 60_000 });
  if (!body.success) throw notSent(`Instagram не принял файл: ${body.message || JSON.stringify(body)}`);
  return c.id;
}

async function publish({ account: acc, format, files, caption, progress, cover = {} }) {
  const { token, user } = acc.secret, host = acc.secret.host || 'ig';
  const make = (file, params) => container(host, user, token, file, params);
  progress('загружаю в Instagram');
  let id;
  // Обложка — кадр ролика (thumb_offset, мс). Свою картинку (cover_url) Instagram берёт только по публичной ссылке.
  if (format === 'reels') id = await make(files[0], { media_type: 'REELS', caption, share_to_feed: true, ...(cover.sec != null ? { thumb_offset: Math.round(cover.sec * 1000) } : {}) });
  else if (format === 'image') id = await make(files[0], { caption });
  else if (format === 'story') id = await make(files[0], { media_type: 'STORIES' });
  else if (format === 'carousel') {
    const children = [];
    for (const f of files) children.push(await make(f, { is_carousel_item: true, ...(isVideo(f) ? { media_type: 'VIDEO' } : {}) }));
    for (const c of children) await ready(host, c, token, progress);
    id = await post(host, `${user}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption }, { safe: true }).then((r) => r.id);
  }
  await ready(host, id, token, progress);
  progress('публикую');
  const { id: mediaId } = await post(host, `${user}/media_publish`, token, { creation_id: id });
  const link = await get(host, mediaId, token, { fields: 'permalink' }).catch(() => ({}));
  return { id: mediaId, url: link.permalink || null };
}

async function stats({ target, account: acc }) {
  const host = acc.secret.host || 'ig', token = acc.secret.token;
  const metric = target.format === 'story' ? 'views,reach' : 'views,reach,likes,comments,shares,saved';
  try {
    const r = await get(host, `${target.remote_id}/insights`, token, { metric });
    return Object.fromEntries((r.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  } catch {
    // Нет права instagram_business_manage_insights — просмотров не будет, но лайки и комментарии видны всем.
    const m = await get(host, target.remote_id, token, { fields: 'like_count,comments_count' });
    return { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 };
  }
}

/* Первый комментарий от имени аккаунта. Закрепить через API нельзя — ручная задача. */
async function comment({ account: acc, id, text }) {
  try { await post(acc.secret.host || 'ig', `${id}/comments`, acc.secret.token, { message: text }, { safe: true }); } catch (e) {
    throw new Error(/permission|\(#10\)|\(#200\)/i.test(e.message) ? 'Instagram не дал оставить комментарий — нужно право instagram_business_manage_comments в приложении Meta и новый маркер' : e.message);
  }
}

async function followers(acc) {
  const r = await get(acc.secret.host || 'ig', acc.secret.user, acc.secret.token, { fields: 'followers_count,media_count' });
  return { count: r.followers_count ?? 0, posts: r.media_count ?? 0 };
}

/*
 * Проверка без публики: квота публикаций (её отдают только при праве публиковать) и, если есть откуда отдать файл,
 * настоящий Reels-контейнер — Meta забирает и обрабатывает ролик, но media_publish не вызываем: контейнер сгорает за сутки, никто его не видит.
 */
async function test({ account: acc, video }) {
  const host = acc.secret.host || 'ig', { token, user } = acc.secret;
  const r = await get(host, `${user}/content_publishing_limit`, token, { fields: 'quota_usage,config' });
  const q = r.data?.[0];
  const quota = `право публиковать есть (${q?.quota_usage ?? 0} из ${q?.config?.quota_total ?? '?'} за сутки)`;
  const id = await container(host, user, token, video, { media_type: 'REELS', caption: 'проверка' });
  await ready(host, id, token, () => {});
  return `${quota}; проверочный ролик загружен напрямую и обработан (не опубликован, сгорит сам за сутки)`;
}

export default {
  title: 'Instagram', color: '#e1306c', publish, stats, maintain, connectToken, test, followers, comment,
  connect: 'token',
  setup: 'Один раз, ≈20 минут. Reels загружаются напрямую с этого компьютера; фото и карусели Meta берёт только по публичной ссылке — без «Публичной папки» они идут вручную. Из России API Instagram доступен только через VPN/прокси.',
  fields: [['token', 'Маркер доступа (Создать маркер)'], ['igid', 'id аккаунта Instagram (цифры под ником)']],
  steps: [
    'В приложении Instagram переведите аккаунт группы в <b>профессиональный</b>: Настройки → Тип аккаунта → Автор.',
    'На <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noopener">developers.facebook.com</a> создайте приложение типа <b>Business</b> и добавьте продукт <b>Instagram</b>.',
    '<b>API setup with Instagram login → Add account</b>: войдите аккаунтом группы (при необходимости примите приглашение тестировщика в приложении Instagram: Настройки → Приложения и сайты).',
    'Нажмите <b>Generate token</b> напротив аккаунта и вставьте ключ ниже. Ключ живёт 60 дней — сервис продлевает его сам.',
  ],
  formats: {
    reels: { title: 'Reels', auto: true, comment: 'auto', cover: ['frame'], caption: 'auto', manual: ['Скачать ролик', 'Instagram → ＋ → Reels: ролик, подпись, обложка', 'Опубликовать и вставить сюда ссылку'], rules: { media: 'video', vertical: true, minSec: 3, maxSec: 900, maxMB: 300, maxCaption: 2200 },
      hint: 'Сразу в ленту и вкладку Reels. До 2200 знаков и 30 хэштегов. Кадр-обложку выбирайте здесь: у ролика, выложенного через Глашатай, Instagram обычно не даёт сменить обложку потом.' },
    image: { title: 'Фото', auto: true, comment: 'auto', cover: [], caption: 'auto', manual: ['Скачать картинку', 'Instagram → ＋ → Публикация: картинка и подпись', 'Опубликовать и вставить сюда ссылку'], rules: { media: 'image', jpeg: true, maxMB: 8, maxCaption: 2200, needsPublic: true }, hint: 'Только JPEG до 8 МБ, пропорции от 4:5 до 1.91:1.' },
    carousel: { title: 'Карусель', auto: true, comment: 'auto', cover: [], caption: 'auto', manual: ['Скачать картинки', 'Instagram → ＋ → Публикация → выбрать несколько: картинки по порядку, подпись', 'Опубликовать и вставить сюда ссылку'], rules: { media: 'images', minImages: 2, maxImages: 20, jpeg: true, maxMB: 8, maxCaption: 2200, needsPublic: true },
      hint: 'До 20 картинок; всё обрежется по пропорциям первой.' },
    story: { title: 'История', auto: true, cover: [], caption: 'none', manual: ['Скачать файл', 'Instagram → ＋ → История: файл, при желании стикер-ссылка на oskolkihaosa.ru', 'Опубликовать и отметить здесь'], rules: { media: 'any', maxFiles: 1, maxSec: 60, maxMB: 100 },
      hint: 'Без подписи и стикеров: ссылку-стикер API поставить не даёт — для истории со ссылкой выбирайте «вручную».' },
  },
};
