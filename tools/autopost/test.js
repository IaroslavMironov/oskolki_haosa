import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Главные правила публикации на своей временной базе: площадки подменены, в сеть не ходим. */

process.env.AUTOPOST_DATA = mkdtempSync(path.join(tmpdir(), 'autopost-'));
process.env.AUTOPOST_DRY = '0';
const { run, get, now } = await import('./db.js');
const { saveAccount } = await import('./secrets.js');
const { PLATFORMS } = await import('./platforms/index.js');
const { publishDue, recoverInterrupted, problems, notSent } = await import('./publish.js');
const { REPO } = await import('./media.js');

const clip = path.join(process.env.AUTOPOST_DATA, 'media', 'clip.mp4');
const wide = path.join(process.env.AUTOPOST_DATA, 'media', 'wide.mp4');
for (const [f, s] of [[clip, '108x192'], [wide, '192x108']]) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${s}:d=4`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', f]);
}
const rel = (f) => path.relative(REPO, f);
saveAccount('youtube', { title: 'тест', secret: {} });

let calls = 0, behaviour = () => ({ id: 'v1', url: 'https://youtube.com/shorts/v1' });
PLATFORMS.youtube.publish = async (ctx) => { calls++; return behaviour(ctx); };

function target({ at = now(), media = [rel(clip)], caption = 'подпись', status = 'scheduled' } = {}) {
  const pid = Number(run("insert into posts (title, kind, caption, media) values ('тест','video',?,?)", caption, JSON.stringify(media)).lastInsertRowid);
  return Number(run("insert into targets (post_id, platform, format, planned_at, status) values (?, 'youtube', 'short', ?, ?)", pid, at, status).lastInsertRowid);
}
const T = (id) => get('select * from targets where id=?', id);

test('пора — публикует один раз и сохраняет ссылку', async () => {
  const id = target();
  calls = 0;
  await publishDue();
  await publishDue();
  assert.equal(calls, 1);
  assert.equal(T(id).status, 'published');
  assert.equal(T(id).url, 'https://youtube.com/shorts/v1');
});

test('опоздание больше 6 часов — не публикует', async () => {
  const id = target({ at: new Date(Date.now() - 7 * 3600e3).toISOString() });
  calls = 0;
  await publishDue();
  assert.equal(calls, 0);
  assert.equal(T(id).status, 'failed');
});

test('«точно не отправилось» — повтор с паузой, после трёх попыток — ошибка', async () => {
  const id = target();
  behaviour = () => { throw notSent('нет связи'); };
  await publishDue();
  assert.equal(T(id).status, 'scheduled');
  assert.equal(T(id).attempts, 1);
  await publishDue(); // пауза ещё не прошла — не трогает
  assert.equal(T(id).attempts, 1);
  run("update targets set updated_at='2000-01-01T00:00:00Z', planned_at=? where id=?", now(), id);
  await publishDue();
  run("update targets set updated_at='2000-01-01T00:00:00Z' where id=?", id);
  await publishDue();
  assert.equal(T(id).status, 'failed');
  assert.equal(T(id).attempts, 3);
  behaviour = () => ({ id: 'v1' });
});

test('оборвалось посреди отправки — «проверить вручную», без повтора', async () => {
  const id = target();
  behaviour = () => { throw new Error('связь оборвалась'); };
  calls = 0;
  await publishDue();
  await publishDue();
  assert.equal(T(id).status, 'unknown');
  assert.equal(calls, 1);
  behaviour = () => ({ id: 'v1' });
});

test('упал процесс во время отправки — после перезапуска «проверить вручную»', () => {
  const id = target({ status: 'publishing' });
  recoverInterrupted();
  assert.equal(T(id).status, 'unknown');
});

test('проверка файлов: горизонтальный ролик и длинная подпись не проходят в Shorts', async () => {
  const bad = await problems({ platform: 'youtube', format: 'short', mode: 'auto', post_id: 0 }, { title: 't', media: [rel(wide)], caption: 'я'.repeat(3000) });
  assert.ok(bad.some((x) => x.includes('не вертикальный')));
  assert.ok(bad.some((x) => x.includes('подпись длиннее')));
  const ok = await problems({ platform: 'youtube', format: 'short', mode: 'auto', post_id: 0 }, { title: 't', media: [rel(clip)], caption: 'ок' });
  assert.deepEqual(ok, []);
});

test('вручную — в срок становится «выложить вручную», площадку не трогает', async () => {
  const id = target();
  run("update targets set mode='manual' where id=?", id);
  calls = 0;
  await publishDue();
  assert.equal(calls, 0);
  assert.equal(T(id).status, 'due');
});

test('вход: верный пароль даёт сессию, неверный — нет, смена пароля выкидывает старые сессии', async () => {
  const { hashPassword, login, userOf, changePassword } = await import('./auth.js');
  run("insert into users (login, name, pass) values ('yaroslav', 'Ярослав', ?)", await hashPassword('секрет-123'));
  assert.equal(await login('yaroslav', 'не тот'), null);
  assert.equal(await login('nobody', 'секрет-123'), null);
  const s = await login('Yaroslav ', 'секрет-123');
  const req = { headers: { cookie: `glashatai=${s.token}` } };
  assert.equal(userOf(req).name, 'Ярослав');
  assert.equal(userOf({ headers: { cookie: 'glashatai=подделка' } }), null);
  assert.ok((await changePassword(userOf(req).id, 'не тот', 'новый-пароль')).error);
  assert.ok((await changePassword(userOf(req).id, 'секрет-123', 'новый-пароль')).ok);
  assert.equal(userOf(req), null);
  assert.ok(await login('yaroslav', 'новый-пароль'));
});
