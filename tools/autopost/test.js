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

function target({ at = now(), media = [rel(clip)], caption = 'подпись', status = 'scheduled', approved = true } = {}) {
  const pid = Number(run("insert into posts (title, kind, caption, media, approved_at) values ('тест','video',?,?,?)", caption, JSON.stringify(media), approved ? now() : null).lastInsertRowid);
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

test('не утверждённый человеком пост не публикуется, даже если стоит в очереди', async () => {
  const id = target({ approved: false });
  calls = 0;
  await publishDue();
  assert.equal(calls, 0);
  assert.equal(T(id).status, 'failed');
  assert.match(T(id).error, /не утверждён/);
  assert.match((await problems({ ...T(id) })).join(), /не утверждён/);
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

test('Telegram: альбом с длинной подписью — альбом и текст следом; одно фото — с подписью', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    const body = opts.body instanceof FormData ? Object.fromEntries([...opts.body.keys()].map((k) => [k, typeof opts.body.get(k) === 'string' ? opts.body.get(k) : 'FILE'])) : JSON.parse(opts.body);
    sent.push({ method, body });
    const result = method === 'sendMediaGroup' ? [{ message_id: 7 }, { message_id: 8 }] : { message_id: 9 };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  };
  try {
    const img = path.join(process.env.AUTOPOST_DATA, 'media', 'p.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-y', img]);
    const acc = { secret: { token: 't', chat: '-1001', username: 'oskolki' } };
    const r = await PLATFORMS.telegram.publish({ account: acc, files: [img, img, img], caption: 'я'.repeat(1500) });
    assert.deepEqual(sent.map((s) => s.method), ['sendMediaGroup', 'sendMessage']);
    assert.equal(JSON.parse(sent[0].body.media)[0].caption, undefined);
    assert.equal(r.url, 'https://t.me/oskolki/7');
    sent.length = 0;
    await PLATFORMS.telegram.publish({ account: acc, files: [img], caption: 'коротко' });
    assert.deepEqual(sent.map((s) => [s.method, s.body.caption]), [['sendPhoto', 'коротко']]);
  } finally { globalThis.fetch = realFetch; }
});

test('задачи после публикации: комментарий оставлен сам → закрыт, «закрепить» — человеку; не пустили → ручная задача', async () => {
  const left = (id) => JSON.parse(T(id).tasks).filter((x) => !x.done).map((x) => x.key);
  const a = target();
  run("update posts set comment='слушать в профиле' where id=(select post_id from targets where id=?)", a);
  const said = [];
  PLATFORMS.youtube.comment = async ({ text }) => { said.push(text); };
  await publishDue();
  assert.deepEqual(said, ['слушать в профиле']);
  assert.deepEqual(left(a), ['pin']);

  const b = target();
  run("update posts set comment='слушать в профиле' where id=(select post_id from targets where id=?)", b);
  PLATFORMS.youtube.comment = async () => { throw new Error('нет права'); };
  await publishDue();
  assert.equal(T(b).status, 'published');
  assert.deepEqual(left(b), ['comment', 'pin']);
  assert.match(JSON.parse(T(b).tasks)[0].note, /нет права/);
});

test('Метрика: «соцсети» раскладываются по сетям, пустые метки отброшены; без токена — «не подключено»', async () => {
  const { siteState } = await import('./analytics.js');
  const { saveSetting } = await import('./secrets.js');
  assert.deepEqual(await siteState(true), { connected: false });
  saveSetting('METRIKA_TOKEN', 't');
  const rows = { 'ym:s:date': [[null, '2026-11-17', 5, 4], [null, '2026-11-18', 9, 7]], 'ym:s:lastTrafficSource': [['social', 'Переходы из социальных сетей', 8], ['direct', 'Прямые заходы', 6]],
    'ym:s:lastSocialNetwork': [['vk', 'ВКонтакте', 5], ['tg', 'Telegram', 3]], 'ym:s:lastUTMSource': [[null, null, 10], ['tiktok', 'tiktok', 4]],
    'ym:el:URL': [[null, 'https://music.yandex.ru/artist/1', 3], [null, 'https://vk.ru/artist/2', 2], [null, 'https://vk.ru/oskolki_haosa', 4], [null, 'https://music.yandex.ru/album/9', 1]] };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const d = new URL(url).searchParams.get('dimensions');
    return { ok: true, json: async () => ({ data: rows[d].map(([id, name, ...n]) => ({ dimensions: [{ id, name }], metrics: n })), totals: d === 'ym:s:date' ? [14, 9] : [] }) };
  };
  try {
    const s = await siteState(true);
    assert.deepEqual(s.sources, [{ name: 'Прямые заходы', visits: 6 }, { name: 'ВКонтакте', visits: 5 }, { name: 'Telegram', visits: 3 }]);
    assert.deepEqual(s.utm, [{ name: 'tiktok', visits: 4 }]);
    assert.equal(s.days[1].users, 7);
    assert.equal(s.users, 9); // итог за период из Метрики, а не 4+7
    assert.deepEqual(s.links, [{ name: 'Яндекс Музыка', clicks: 4, listen: true }, { name: 'Сообщество VK', clicks: 4, listen: false }, { name: 'VK Музыка', clicks: 2, listen: true }]);
  } finally { globalThis.fetch = real; }
});
