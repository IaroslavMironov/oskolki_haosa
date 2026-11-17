import crypto from 'node:crypto';
import { statSync, openAsBlob } from 'node:fs';
import { call, form } from './http.js';
import { saveAccount, setting, rememberLogin, loginVerifier, forgetLogin } from '../secrets.js';
import { notSent } from '../publish.js';

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
const SCOPES = 'user.info.basic,video.upload,video.publish,video.list';
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

async function publish({ account: acc, format, files: [file], caption, progress }) {
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
      post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true, brand_content_toggle: false } });
  }
  // После загрузки TikTok сам доводит публикацию — обрыв дальше уже «неясно» (call без safe).
  await upload(init.upload_url, file, size, chunk, progress);
  for (let i = 0; i < 60; i++) {
    const s = await api('/v2/post/publish/status/fetch/', access, { publish_id: init.publish_id });
    if (s.status === 'FAILED') throw new Error(`TikTok: ${s.fail_reason || 'публикация не прошла'}`);
    if (s.status === 'SEND_TO_USER_INBOX') return { id: init.publish_id, note: 'черновик во «Входящих» TikTok — откройте приложение и опубликуйте' };
    if (s.status === 'PUBLISH_COMPLETE') {
      const pid = s.publicaly_available_post_id?.[0];
      return { id: pid ? String(pid) : init.publish_id, url: pid ? `https://www.tiktok.com/video/${pid}` : null, note: pid ? '' : 'опубликовано приватно (приложение без аудита TikTok)' };
    }
    progress(`TikTok обрабатывает… ${i * 10} с`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { id: init.publish_id, note: 'TikTok ещё обрабатывает — проверьте в приложении' };
}

async function stats({ target, account: acc }) {
  if (!/^\d+$/.test(target.remote_id)) return null;
  const d = await api('/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', await token(acc), { filters: { video_ids: [target.remote_id] } });
  const v = d.videos?.[0] || {};
  return { views: v.view_count ?? 0, likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0 };
}

export default {
  title: 'TikTok', color: '#25f4ee', oauth, publish, stats,
  connect: 'oauth',
  setup: 'Сначала проверьте в приложении TikTok, что аккаунт группы вообще может загружать видео: аккаунтам из региона РФ TikTok это закрыл.',
  app: [['TIKTOK_CLIENT_KEY', 'Client key'], ['TIKTOK_CLIENT_SECRET', 'Client secret', true]],
  steps: [
    'Войдите на <a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">developers.tiktok.com</a> и создайте приложение «Глашатай».',
    'Добавьте продукты <b>Login Kit</b> и <b>Content Posting API</b>, области: user.info.basic, video.upload, video.publish, video.list.',
    'Платформа — <b>Desktop</b> (на сервере — Web), Redirect URI: <code>{redirect}</code>.',
    'Включите <b>Sandbox</b> и добавьте аккаунт группы в «Target users» — так проверка приложения TikTok не нужна (черновики во «Входящие» работают).',
    'Скопируйте Client key и Client secret (из Sandbox) в поля ниже → «Сохранить» → «Войти» под аккаунтом группы.',
  ],
  connect: 'oauth',
  formats: {
    draft: { title: 'Черновик', auto: true, rules: { media: 'video', vertical: true, minSec: 3, maxSec: 600, maxMB: 1024 },
      hint: 'Ролик придёт во «Входящие» TikTok, подпись и публикация — в приложении одним нажатием. Не больше 5 черновиков в сутки. Подпись скопируйте из кабинета.' },
    video: { title: 'Публикация', auto: true, rules: { media: 'video', vertical: true, minSec: 3, maxSec: 600, maxMB: 1024, maxCaption: 2200 },
      hint: 'Без аудита приложения TikTok — только «видно мне» и только с приватного аккаунта.' },
  },
};
