import crypto from 'node:crypto';
import { call, form } from './http.js';
import { account, saveAccount, rememberLogin, loginVerifier, forgetLogin, setting } from '../secrets.js';

/*
 * VK ID (OAuth 2.1 + PKCE) — ключ администратора сообщества только для статистики: ключ сообщества её не отдаёт (ошибка 27).
 * Приложение «Глашатай» в кабинете VK ID: id.vk.ru/about/business/go, ID 54905675, доверенный адрес — {BASE}/oauth/vkid/callback.
 * Ключ доступа живёт ~1 час, ключ обновления меняется при каждом обновлении — сохраняем новый сразу (как у TikTok).
 * Публикует VK по-прежнему человек; этим ключом ничего не пишем, только читаем.
 */

const ID = 'https://id.vk.ru';
const APP = process.env.VKID_APP_ID || '54905675';
const SCOPE = 'wall stats groups video';
const V = '5.199';

async function tokenRequest(params) {
  const { body } = await call(`${ID}/oauth2/auth`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: APP, ...params }) }, { safe: true });
  if (!body.access_token) throw new Error(`VK ID не выдал ключ: ${body.error_description || body.error || 'нет ответа'}`);
  return body;
}

const save = (b, device, title) => {
  saveAccount('vkid', { title, secret: { access: b.access_token, until: Date.now() + (b.expires_in - 60) * 1000, refresh: b.refresh_token, device, user: b.user_id, scope: b.scope } });
};

export const oauth = {
  start(redirect) {
    const state = crypto.randomBytes(24).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
    rememberLogin(state, verifier);
    return `${ID}/authorize?${form({ response_type: 'code', client_id: APP, redirect_uri: redirect, state, scope: SCOPE,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })}`;
  },
  async callback(params, redirect) {
    if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
    const state = params.get('state'), verifier = loginVerifier(state);
    if (!verifier) throw new Error('ссылка входа устарела (прошло больше 15 минут) — нажмите «Войти через VK ID» ещё раз');
    const device = params.get('device_id');
    const b = await tokenRequest({ grant_type: 'authorization_code', code: params.get('code'), code_verifier: verifier, device_id: device, redirect_uri: redirect, state });
    forgetLogin(state);
    const me = await api('users.get', {}, b.access_token).catch(() => null);
    const title = me?.[0] ? `${me[0].first_name} ${me[0].last_name}` : 'VK ID';
    save(b, device, title);
    return { title: `${title} — права: ${b.scope || '?'}` };
  },
};

async function token() {
  const a = account('vkid');
  if (a?.status !== 'connected') return null;
  if (a.secret.access && a.secret.until > Date.now()) return a.secret.access;
  const b = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.secret.refresh, device_id: a.secret.device, state: crypto.randomBytes(16).toString('base64url') });
  save(b, a.secret.device, a.title);
  return b.access_token;
}

async function api(method, params, access) {
  const { body } = await call(`https://api.vk.com/method/${method}`, { method: 'POST', body: form({ ...params, access_token: access, v: V }) }, { safe: true });
  if (body.error) throw new Error(`VK: ${body.error.error_msg} (${body.error.error_code})`);
  return body.response;
}

/*
 * Без входа администратора — сервисный ключ приложения (VK_SERVICE_TOKEN): он читает открытую стену
 * (просмотры, лайки, репосты, комментарии), но не статистику и не клипы. Расширенные права VK ID дают
 * только после подтверждения бизнес-профиля в кабинете VK ID.
 */
const SERVICE_OK = new Set(['wall.get', 'groups.getById']);

/** Вызов VK API ключом администратора, а без него — сервисным, где VK это разрешает; null — нечем. */
export async function vkAdmin(method, params) {
  const service = setting('VK_SERVICE_TOKEN');
  const access = await token().catch(() => null);
  if (access) {
    // VK ID может выдать урезанные права (только профиль) — тогда открытую стену читаем сервисным ключом
    try { return await api(method, params, access); } catch (e) { if (!(service && SERVICE_OK.has(method))) throw e; }
  }
  return service && SERVICE_OK.has(method) ? api(method, params, service) : null;
}
