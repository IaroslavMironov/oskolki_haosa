import { call, form } from './http.js';
import { saveAccount } from '../secrets.js';
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

const media = async (file, extra = {}) => (isVideo(file) ? { video_url: await publicUrl(file), ...extra } : { image_url: await publicUrl(file), ...extra });

async function publish({ account: acc, format, files, caption, progress }) {
  const { token, user } = acc.secret, host = acc.secret.host || 'ig';
  const container = (params) => post(host, `${user}/media`, token, params, { safe: true }).then((r) => r.id);
  progress('выкладываю файл для Instagram');
  let id;
  if (format === 'reels') id = await container({ media_type: 'REELS', ...(await media(files[0])), caption, share_to_feed: true });
  else if (format === 'image') id = await container({ ...(await media(files[0])), caption });
  else if (format === 'story') id = await container({ media_type: 'STORIES', ...(await media(files[0])) });
  else if (format === 'carousel') {
    const children = [];
    for (const f of files) children.push(await container({ is_carousel_item: true, ...(await media(f, isVideo(f) ? { media_type: 'VIDEO' } : {})) }));
    for (const c of children) await ready(host, c, token, progress);
    id = await container({ media_type: 'CAROUSEL', children: children.join(','), caption });
  }
  await ready(host, id, token, progress);
  progress('публикую');
  const { id: mediaId } = await post(host, `${user}/media_publish`, token, { creation_id: id });
  const link = await get(host, mediaId, token, { fields: 'permalink' }).catch(() => ({}));
  return { id: mediaId, url: link.permalink || null };
}

async function stats({ target, account: acc }) {
  const metric = target.format === 'story' ? 'views,reach' : 'views,reach,likes,comments,shares,saved';
  const r = await get(acc.secret.host || 'ig', `${target.remote_id}/insights`, acc.secret.token, { metric });
  return Object.fromEntries((r.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
}

export default {
  title: 'Instagram', color: '#e1306c', publish, stats, maintain, connectToken,
  connect: 'token',
  setup: 'Один раз, ≈20 минут. Из России Instagram API работает только через зарубежный прокси (настраивается на сервере), а файлы Meta забирает по публичной ссылке — это «Публичная папка» в карточке «Сервис».',
  fields: [['token', 'Маркер доступа (Создать маркер)'], ['igid', 'id аккаунта Instagram (цифры под ником)']],
  steps: [
    'В приложении Instagram переведите аккаунт группы в <b>профессиональный</b>: Настройки → Тип аккаунта → Автор.',
    'На <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noopener">developers.facebook.com</a> создайте приложение типа <b>Business</b> и добавьте продукт <b>Instagram</b>.',
    '<b>API setup with Instagram login → Add account</b>: войдите аккаунтом группы (при необходимости примите приглашение тестировщика в приложении Instagram: Настройки → Приложения и сайты).',
    'Нажмите <b>Generate token</b> напротив аккаунта и вставьте ключ ниже. Ключ живёт 60 дней — сервис продлевает его сам.',
  ],
  formats: {
    reels: { title: 'Reels', auto: true, rules: { media: 'video', vertical: true, minSec: 3, maxSec: 900, maxMB: 300, maxCaption: 2200 },
      hint: 'Сразу в ленту и вкладку Reels. До 2200 знаков и 30 хэштегов.' },
    image: { title: 'Фото', auto: true, rules: { media: 'image', jpeg: true, maxMB: 8, maxCaption: 2200 }, hint: 'Только JPEG до 8 МБ, пропорции от 4:5 до 1.91:1.' },
    carousel: { title: 'Карусель', auto: true, rules: { media: 'images', minImages: 2, maxImages: 20, jpeg: true, maxMB: 8, maxCaption: 2200 },
      hint: 'До 20 картинок; всё обрежется по пропорциям первой.' },
    story: { title: 'История', auto: true, rules: { media: 'any', maxFiles: 1, maxSec: 60, maxMB: 100 },
      hint: 'Без подписи и стикеров: ссылку-стикер API поставить не даёт — для истории со ссылкой выбирайте «вручную».' },
  },
};
