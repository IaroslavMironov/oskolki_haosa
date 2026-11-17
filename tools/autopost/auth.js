import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { get, run, now } from './db.js';

/*
 * Вход в кабинет — из Нейро-продюсера (src/http/auth.js, туда — из gcanalitics):
 * пароль — scrypt, сессия — случайный токен в httpOnly-cookie, в базе только его хеш.
 * Права у всех одинаковые (Владислав и Ярослав). Заводит людей команда: npm run user -- <логин> "<Имя>".
 */

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
export const COOKIE = 'glashatai';
const sha = (t) => createHash('sha256').update(t).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scryptAsync(password, salt, 64)).toString('hex')}`;
}

async function verify(password, stored) {
  const [, salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

/** 12 символов ≈ 72 бита: подбором не взять, продиктовать можно. */
export const generatePassword = () => randomBytes(9).toString('base64url');

export async function login(loginName, password) {
  const u = get('select * from users where login = ?', String(loginName || '').trim().toLowerCase());
  // Нет такого — всё равно считаем scrypt: по времени ответа не понять, есть ли логин.
  const ok = await verify(String(password || ''), u?.pass || 'scrypt:00:00');
  if (!u || !ok) return null;
  const token = randomBytes(32).toString('base64url');
  run('insert into sessions (token_hash, user_id, expires_at) values (?,?,?)', sha(token), u.id, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  run('delete from sessions where expires_at < ?', now());
  return { token, maxAge: SESSION_DAYS * 86400, user: { id: u.id, login: u.login, name: u.name } };
}

export const readCookie = (req) => (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

export function userOf(req) {
  const token = readCookie(req);
  if (!token) return null;
  return get(`select u.id, u.login, u.name from sessions s join users u on u.id = s.user_id
    where s.token_hash = ? and s.expires_at > ?`, sha(token), now()) || null;
}

export const logout = (req) => run('delete from sessions where token_hash = ?', sha(readCookie(req) || ''));

export async function changePassword(userId, oldPass, newPass) {
  const u = get('select * from users where id = ?', userId);
  if (!await verify(String(oldPass || ''), u.pass)) return { error: 'Старый пароль не подходит' };
  if (String(newPass || '').length < 8) return { error: 'Новый пароль — не короче 8 знаков' };
  run('update users set pass = ? where id = ?', await hashPassword(newPass), userId);
  // Остальные устройства выходят: сменил пароль — значит, старый мог утечь.
  run('delete from sessions where user_id = ?', userId);
  return { ok: true };
}

/** Скользящее окно попыток входа по IP — от перебора паролей (из gcanalitics). */
const hits = new Map();
export function allowLogin(ip, max = 10, windowMs = 10 * 60_000) {
  const t = Date.now();
  const arr = (hits.get(ip) || []).filter((x) => x > t - windowMs);
  if (arr.length >= max) return false;
  arr.push(t);
  hits.set(ip, arr);
  return true;
}

/* npm run user -- <логин> "<Имя>" — завести человека или выдать новый пароль существующему. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [loginName, name] = process.argv.slice(2);
  if (!/^[a-z0-9_-]{3,32}$/.test(loginName || '')) {
    console.log('Логин — латиницей, 3–32 знака: npm run user -- yaroslav "Ярослав"');
    process.exit(1);
  }
  const password = generatePassword();
  const pass = await hashPassword(password);
  const old = get('select id, name from users where login = ?', loginName);
  if (old) {
    run('update users set pass = ?, name = coalesce(?, name) where id = ?', pass, name || null, old.id);
    run('delete from sessions where user_id = ?', old.id);
  } else run('insert into users (login, name, pass) values (?,?,?)', loginName, name || loginName, pass);
  console.log(`${old ? 'Новый пароль' : 'Заведён'}: ${name || old?.name || loginName}\n  логин:  ${loginName}\n  пароль: ${password}`);
}
