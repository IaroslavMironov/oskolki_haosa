import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Хранилище — один файл SQLite (data/autopost.db). Для одного сообщества хватает с запасом;
 * ponytail: при переносе на сервер с несколькими процессами — Postgres и очередь как в Нейро-продюсере (src/jobs/queue.js).
 *
 * post   — единица контента: ролик/картинка/карусель/текст + общая подпись.
 * target — публикация этой единицы на одной площадке: своё время, формат, подпись, статус, ссылка, цифры.
 */

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.AUTOPOST_DATA || path.join(ROOT, 'data');
mkdirSync(path.join(DATA, 'media'), { recursive: true });

export const db = new DatabaseSync(process.env.AUTOPOST_DB || path.join(DATA, 'autopost.db'));
db.exec(`
pragma journal_mode = wal;
pragma foreign_keys = on;
create table if not exists posts (
  id integer primary key,
  title text not null,
  kind text not null check (kind in ('video','image','carousel','text')),
  caption text not null default '',
  media text not null default '[]',
  release text,
  note text not null default '',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists targets (
  id integer primary key,
  post_id integer not null references posts(id) on delete cascade,
  platform text not null,
  format text not null,
  caption text,
  title text,
  planned_at text not null,
  mode text not null default 'auto' check (mode in ('auto','manual')),
  status text not null default 'draft',
  attempts integer not null default 0,
  error text,
  url text,
  remote_id text,
  progress text,
  published_at text,
  stats text,
  stats_at text,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists targets_due on targets(status, planned_at);
create table if not exists accounts (
  platform text primary key,
  title text,
  secret text,
  expires_at text,
  status text not null default 'off',
  error text,
  updated_at text
);
create table if not exists users (
  id integer primary key,
  login text not null unique,
  name text not null,
  pass text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at text not null
);
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists events (
  id integer primary key,
  at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  post_id integer,
  target_id integer,
  level text not null default 'info',
  text text not null
);
`);

// Кто сделал действие — в журнал (появилось с входом по паролю).
try { db.exec('alter table events add column actor text'); } catch { /* уже есть */ }

export const all = (sql, ...a) => db.prepare(sql).all(...a);
export const get = (sql, ...a) => db.prepare(sql).get(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);
export const now = () => new Date().toISOString();

export function log(text, { postId = null, targetId = null, level = 'info', by = null } = {}) {
  run('insert into events (post_id, target_id, level, text, actor) values (?,?,?,?,?)', postId, targetId, level, String(text).slice(0, 1000), by);
}

/** Атомарная смена статуса: true, только если статус был одним из from (два исполнителя не возьмут одно). */
export function move(id, from, to, fields = {}) {
  const keys = Object.keys(fields);
  const sets = ['status = ?', 'updated_at = ?', ...keys.map((k) => `${k} = ?`)].join(', ');
  const r = run(`update targets set ${sets} where id = ? and status in (${from.map(() => '?').join(',')})`,
    to, now(), ...keys.map((k) => fields[k]), id, ...from);
  return r.changes === 1;
}

export const parsePost = (p) => p && { ...p, media: JSON.parse(p.media) };
