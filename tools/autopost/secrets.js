import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA, db, get, run, now } from './db.js';

/*
 * Ключи площадок храним зашифрованными (AES-256-GCM, как в Нейро-продюсере src/utils/crypto.js):
 * копия базы не должна давать доступ к сообществу и каналам.
 * Ключ шифрования — SECRET_KEY (64 hex). Не задан — создаём data/secret.key.
 * ponytail: ключ рядом с базой защищает только от утечки одной базы; на сервере SECRET_KEY только в окружении.
 */

function key() {
  let raw = process.env.SECRET_KEY;
  const file = path.join(DATA, 'secret.key');
  if (!raw && existsSync(file)) raw = readFileSync(file, 'utf8').trim();
  if (!raw) { raw = crypto.randomBytes(32).toString('hex'); writeFileSync(file, raw, { mode: 0o600 }); }
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('SECRET_KEY: нужно 64 hex-символа');
  return Buffer.from(raw, 'hex');
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

export function decrypt(packed) {
  const [v, iv, tag, data] = String(packed).split(':');
  if (v !== 'v1') throw new Error('неизвестный формат секрета');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Подключение площадки: { platform, title, status, expires_at, secret: {...} } или null. */
export function account(platform) {
  const a = get('select * from accounts where platform = ?', platform);
  if (!a) return null;
  return { ...a, secret: a.secret ? JSON.parse(decrypt(a.secret)) : {} };
}

export function saveAccount(platform, { title, secret, expiresAt = null, status = 'connected', error = null }) {
  run(`insert into accounts (platform, title, secret, expires_at, status, error, updated_at) values (?,?,?,?,?,?,?)
    on conflict(platform) do update set title=coalesce(excluded.title, title), secret=excluded.secret,
      expires_at=excluded.expires_at, status=excluded.status, error=excluded.error, updated_at=excluded.updated_at`,
  platform, title ?? null, encrypt(JSON.stringify(secret)), expiresAt, status, error, now());
}

export const setAccountStatus = (platform, status, error = null) =>
  run('update accounts set status=?, error=?, updated_at=? where platform=?', status, error, now(), platform);

export const dropAccount = (platform) => run('delete from accounts where platform = ?', platform);

/*
 * Настройки сервиса из кабинета (ключи приложений площадок, бот уведомлений, публичная папка) — тоже зашифрованы.
 * Не задано в кабинете — берём из окружения (.env): так на сервере можно задать всё заранее.
 */
export function setting(key) {
  const r = get('select value from settings where key = ?', key);
  return r ? decrypt(r.value) : (process.env[key] || '');
}

export function saveSetting(key, value) {
  value = String(value ?? '').trim();
  if (!value) return run('delete from settings where key = ?', key);
  run(`insert into settings (key, value, updated_at) values (?,?,?) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
    key, encrypt(value), now());
}

/*
 * Начатые входы в площадки (OAuth): state → проверочный код PKCE. В базе, а не в памяти:
 * пока человек на странице Google/TikTok, сервис может перезапуститься — вход не должен теряться.
 * Живут 15 минут; гаснут после удачного входа (повторный заход на адрес возврата не ломает вход).
 */
db.exec('create table if not exists oauth_states (state text primary key, verifier text not null, at integer not null)');
export function rememberLogin(state, verifier) {
  run('delete from oauth_states where at < ?', Date.now() - 15 * 60_000);
  run('insert into oauth_states (state, verifier, at) values (?,?,?)', state, encrypt(verifier), Date.now());
}
export function loginVerifier(state) {
  const r = get('select verifier from oauth_states where state = ? and at > ?', String(state || ''), Date.now() - 15 * 60_000);
  return r ? decrypt(r.verifier) : null;
}
export const forgetLogin = (state) => run('delete from oauth_states where state = ?', String(state || ''));
