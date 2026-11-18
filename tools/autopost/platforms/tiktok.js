import crypto from 'node:crypto';
import { statSync, openAsBlob } from 'node:fs';
import { call, form } from './http.js';
import { saveAccount, setting, rememberLogin, loginVerifier, forgetLogin } from '../secrets.js';
import { notSent } from '../publish.js';
import { run, all } from '../db.js';

/*
 * TikTok: Content Posting API. Разведка 17.11.2026 (docs/площадки.md):
 *  — «Прямая публикация» без аудита — только SELF_ONLY и только с приватного аккаунта. Аудит «утилиты для своего аккаунта»
 *    правила TikTok прямо называют неприемлемым → для группы реалистичен ЧЕРНОВИК: ролик падает во «Входящие» приложения,
 *    человек жмёт «Опубликовать» в TikTok (подпись и приватность выбирает там). Лимит — 5 черновиков в сутки.
 *  — Приложение регистрировать как Desktop: тогда разрешён адрес http://localhost:ПОРТ; PKCE-вызов — HEX от sha256 (не base64url).
 *  — ключ доступа короткий, ключ обновления меняется при каждом обновлении — сохраняем новый сразу.
 *  — из российского региона аккаунта TikTok загрузку не даёт — нужен аккаунт, заведённый вне РФ. Проверить на живом.
 */

const API = 'https://open.tiktokapis.com';
// Черновики + цифры: подписчики (user.info.stats) и ролики аккаунта (video.list). Права должны быть и в приложении TikTok — иначе вход не пустит.
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,user.info.stats,video.upload,video.list';
const cfg = () => {
  const key = setting('TIKTOK_CLIENT_KEY'), secret = setting('TIKTOK_CLIENT_SECRET');
  if (!key || !secret) throw new Error('сначала вставьте Client key и Client secret приложения TikTok («Площадки → TikTok → Настройка»)');
  return { key, secret };
};

async function tokenRequest(params, title) {
  const { key, secret } = cfg();
  const { body } = await call(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: key, client_secret: secret, ...params }) }, { safe: true });
  if (!body.access_token) throw Object.assign(notSent(`TikTok не выдал ключ: ${body.error_description || body.error || 'нет ответа'}`), { auth: true });
  const s = { access: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000, refresh: body.refresh_token, open_id: body.open_id };
  saveAccount('tiktok', { title, secret: s, expiresAt: new Date(Date.now() + body.refresh_expires_in * 1000).toISOString() });
  return s;
}

export const oauth = {
  start(redirect) {
    const { key } = cfg();
    const state = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
    rememberLogin(state, verifier);
    return `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: key, scope: SCOPES, response_type: 'code', redirect_uri: redirect, state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('hex'), code_challenge_method: 'S256' })}`;
  },
  async callback(params, redirect) {
    if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
    const verifier = loginVerifier(params.get('state'));
    if (!verifier) throw new Error(params.get('state') ? 'ссылка входа устарела (прошло больше 15 минут) — нажмите «Войти» ещё раз' : 'площадка вернула без state — нажмите «Войти» ещё раз');
    const s = await tokenRequest({ code: params.get('code'), grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: verifier }, 'TikTok');
    forgetLogin(params.get('state'));
    const info = await api('/v2/user/info/?fields=open_id,display_name', s.access, null, 'GET').catch(() => null);
    const title = info?.user?.display_name || 'TikTok';
    saveAccount('tiktok', { title, secret: s });
    return { title };
  },
};

async function token(acc) {
  if (acc.secret.access && acc.secret.until > Date.now()) return acc.secret.access;
  return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.secret.refresh }, acc.title)).access;
}

/** Вызов API: TikTok отвечает 200 с error.code ≠ "ok" — это тоже ошибка. */
async function api(path, access, body, method = 'POST', opts = { safe: true }) {
  const { body: r } = await call(`${API}${path}`, { method, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json; charset=UTF-8' },
    ...(body ? { body: JSON.stringify(body) } : {}) }, opts);
  if (r.error && r.error.code !== 'ok') throw Object.assign(notSent(`TikTok: ${r.error.message || r.error.code}`), { auth: /token/.test(r.error.code) });
  return r.data;
}

/** Ролик одним куском (до 64 МБ; наши 10–30 МБ), иначе — кусками по 10 МБ, последний добирает остаток. */
async function upload(url, file, size, chunk, progress) {
  const count = Math.max(1, Math.floor(size / chunk));
  const blob = await openAsBlob(file);
  for (let i = 0; i < count; i++) {
    const start = i * chunk, end = i === count - 1 ? size : start + chunk;
    progress(`загружаю в TikTok ${Math.round((end / size) * 100)}%`);
    await call(url, { method: 'PUT', body: blob.slice(start, end),
      headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end - 1}/${size}` } }, { timeout: 10 * 60_000 });
  }
}

async function publish({ account: acc, format, files: [file], caption, progress, cover = {} }) {
  const access = await token(acc);
  const size = statSync(file).size;
  const chunk = size <= 64 * 1048576 ? size : 10 * 1048576;
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: Math.max(1, Math.floor(size / chunk)) };
  let init;
  if (format === 'draft') init = await api('/v2/post/publish/inbox/video/init/', access, { source_info });
  else {
    // Прямая публикация: приватность — из разрешённых аккаунту. Без аудита TikTok даст только SELF_ONLY.
    const creator = await api('/v2/post/publish/creator_info/query/', access, {});
    const want = process.env.TIKTOK_PRIVACY || 'PUBLIC_TO_EVERYONE';
    const privacy = creator.privacy_level_options?.includes(want) ? want : creator.privacy_level_options?.[0];
    if (!privacy) throw notSent('TikTok сейчас не даёт публиковать с этого аккаунта');
    init = await api('/v2/post/publish/video/init/', access, { source_info,
      post_info: { title: caption.slice(0, 2200), privacy_level: privacy, ...(cover.sec != null ? { video_cover_timestamp_ms: Math.round(cover.sec * 1000) } : {}), disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true, brand_content_toggle: false } });
  }
  // После загрузки TikTok сам доводит публикацию — обрыв дальше уже «неясно» (call без safe).
  await upload(init.upload_url, file, size, chunk, progress);
  // Ждём не больше 2 минут: публикации идут по очереди, долгое ожидание держит остальные. Файл уже у TikTok — дальше он доводит сам.
  for (let i = 0; i < 12; i++) {
    const s = await api('/v2/post/publish/status/fetch/', access, { publish_id: init.publish_id });
    if (s.status === 'FAILED') throw new Error(`TikTok: ${s.fail_reason || 'публикация не прошла'}`);
    if (s.status === 'SEND_TO_USER_INBOX') return { id: init.publish_id, pending: true, note: 'черновик во «Входящих» TikTok — откройте приложение и опубликуйте' };
    if (s.status === 'PUBLISH_COMPLETE') {
      const pid = s.publicaly_available_post_id?.[0];
      return { id: pid ? String(pid) : init.publish_id, url: pid ? `https://www.tiktok.com/video/${pid}` : null, note: pid ? '' : 'опубликовано приватно (приложение без аудита TikTok)' };
    }
    progress(`TikTok обрабатывает… ${i * 10} с`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { id: init.publish_id, pending: format === 'draft', note: 'файл загружен, TikTok ещё обрабатывает — черновик появится во «Входящих» приложения' };
}

const FIELDS = 'id,create_time,share_url,view_count,like_count,comment_count,share_count';
const numbers = (v) => ({ views: v.view_count ?? 0, likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0 });

/*
 * Черновик публикует человек в приложении — ссылки на ролик у нас нет. Находим его сами в списке роликов аккаунта:
 * самый ранний из вышедших после загрузки черновика и ещё не привязанных к другой публикации. Нашли — запоминаем id и ссылку.
 * ponytail: сопоставление по времени; два черновика, опубликованные в обратном порядке, перепутаются — тогда вставить ссылку руками.
 */
async function stats({ target, account: acc }) {
  const access = await token(acc);
  let id = /^\d{10,}$/.test(target.remote_id || '') ? target.remote_id : target.url?.match(/\/video\/(\d+)/)?.[1];
  if (!id) {
    const d = await api(`/v2/video/list/?fields=${FIELDS}`, access, { max_count: 20 });
    const taken = new Set(all("select remote_id from targets where platform='tiktok' and id<>?", target.id).map((r) => r.remote_id));
    const after = Date.parse(target.published_at) / 1000 - 3600;
    const v = (d.videos || []).filter((x) => x.create_time >= after && !taken.has(String(x.id))).sort((a, b) => a.create_time - b.create_time)[0];
    if (!v) return null;
    run('update targets set remote_id=?, url=coalesce(url, ?) where id=?', String(v.id), v.share_url?.split('?')[0] || null, target.id);
    return numbers(v);
  }
  const d = await api(`/v2/video/query/?fields=${FIELDS}`, access, { filters: { video_ids: [id] } });
  return numbers(d.videos?.[0] || {});
}

/* Проверка: настоящий черновик во «Входящие» — публике не виден. Заодно показывает, пускает ли TikTok загрузку с этого аккаунта. */
async function test({ account: acc, video }) {
  const r = await publish({ account: acc, format: 'draft', files: [video], caption: '', progress: () => {} });
  return r.note || 'ролик загрузился черновиком';
}

/* Подписчики — область user.info.stats: её нужно добавить в приложение TikTok (Sandbox) и войти заново. */
async function followers(acc) {
  try {
    const d = await api('/v2/user/info/?fields=follower_count,likes_count,video_count', await token(acc), null, 'GET');
    return { count: d.user.follower_count ?? 0, likes: d.user.likes_count ?? 0, posts: d.user.video_count ?? 0 };
  } catch (e) {
    if (/scope/.test(e.message)) return { error: 'нужно право user.info.stats: добавьте его в приложении TikTok (Sandbox → Scopes) и войдите заново' };
    throw e;
  }
}

export default {
  title: 'TikTok', color: '#25f4ee', oauth, publish, stats, test, followers,
  connect: 'oauth',
  setup: 'Сначала проверьте в приложении TikTok, что аккаунт группы вообще может загружать видео: аккаунтам из региона РФ TikTok это закрыл.',
  app: [['TIKTOK_CLIENT_KEY', 'Client key'], ['TIKTOK_CLIENT_SECRET', 'Client secret', true]],
  steps: [
    'Войдите на <a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">developers.tiktok.com</a> и создайте приложение «Глашатай».',
    'Добавьте продукты <b>Login Kit</b> и <b>Content Posting API</b> (без Direct Post), области: <b>user.info.basic</b> и <b>video.upload</b>.',
    'Платформа — <b>Desktop</b> (на сервере — Web), Redirect URI: <code>{redirect}</code>.',
    'Включите <b>Sandbox</b> и добавьте аккаунт группы в «Target users» — так проверка приложения TikTok не нужна (черновики во «Входящие» работают). Если Sandbox просит описание и демо-видео — заполните (текст и видео подготовлены), отправлять на проверку не нужно.',
    'Скопируйте Client key и Client secret (из Sandbox) в поля ниже → «Сохранить» → «Войти» под аккаунтом группы.',
  ],
  connect: 'oauth',
  formats: {
    draft: { title: 'Черновик', auto: true, level: 'half', comment: 'manual', cover: [], caption: 'copy', manual: ['Открыть TikTok на телефоне → Входящие → Уведомления системы → «Ваше видео из приложения Глашатай готово»', 'Вставить подпись — бот прислал её в Telegram (касание копирует) или «Скопировать подпись» здесь', 'Выбрать обложку в TikTok', 'Опубликовать и вставить сюда ссылку на ролик'], rules: { media: 'video', vertical: true, minSec: 3, maxSec: 600, maxMB: 1024 },
      hint: 'Ролик придёт во «Входящие» TikTok, подпись и публикация — в приложении одним нажатием. Подпись TikTok к черновику не принимает — её пришлёт бот в Telegram, касание копирует. Не больше 5 черновиков в сутки.' },
    video: { title: 'Публикация', auto: true, comment: 'manual', cover: ['frame'], caption: 'auto', manual: ['Скачать ролик', 'TikTok → ＋ (или tiktok.com/tiktokstudio/upload): ролик, подпись, обложка', 'Опубликовать и вставить сюда ссылку'], rules: { media: 'video', vertical: true, minSec: 3, maxSec: 600, maxMB: 1024, maxCaption: 2200 },
      hint: 'Без аудита приложения TikTok — только «видно мне» и только с приватного аккаунта.' },
  },
};
