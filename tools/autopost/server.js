import http from 'node:http';
import { createReadStream, existsSync, statSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, all, get, run, log, move, now, parsePost, DATA } from './db.js';
import { abs, listFiles, probe, mime, REPO, thumbFile } from './media.js';
import { publicTarget } from './pubmedia.js';
import { account, dropAccount, setting, saveSetting } from './secrets.js';
import { login, logout, userOf, changePassword, allowLogin, COOKIE } from './auth.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { notify, linkStart, unlink, linkState, pollUpdates, botUsername } from './notify.js';
import { PLATFORMS } from './platforms/index.js';
import { oauth as vkidOauth } from './platforms/vkid.js';
import { snapshotFollowers, analyticsState, siteState, vkCommunity, saveMusic } from './analytics.js';
import { oracleRound } from './oracle.js';
import { publishDue, recoverInterrupted, collectStats, maintainAccounts, problems, DRY, fmt, tasksFor } from './publish.js';

/*
 * «Глашатай» — кабинет автопостинга: очередь, редактор публикаций, площадки, журнал.
 * Вход по логину и паролю (auth.js), у всех вошедших права одинаковые.
 * На ноутбуке слушает 127.0.0.1; на сервере — тоже, наружу его выводит nginx с https (deploy/).
 */

const PORT = +process.env.PORT || 4777;
const HOST = process.env.HOST || '127.0.0.1';
// Адрес кабинета снаружи: для входа в площадки (OAuth возвращает сюда) и для пометки cookie «только https».
const BASE = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE.startsWith('https://');
const PUBLIC = new Set(['/login.html', '/style.css', '/api/login']);
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const json = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
/*
 * GET-ответы и статика — с ETag: путь до сервера из-за границы медленный (~330 мс, мало пропускает), а кабинет
 * опрашивает очередь каждые 5 с. Не изменилось — 304 без тела, браузер берёт своё. Поле now в отпечаток не входит.
 */
const etagOf = (s) => `"${createHash('sha1').update(s).digest('base64url')}"`;
function sendTagged(req, res, type, body, tagSrc = body) {
  const tag = etagOf(tagSrc);
  // nginx при сжатии делает отпечаток «нестрогим» (W/"…") — сравниваем без этой приставки
  if (String(req.headers['if-none-match'] || '').replace(/^W\//, '') === tag) { res.writeHead(304, { etag: tag, 'cache-control': 'no-cache' }); return res.end(); }
  res.writeHead(200, { 'content-type': type, etag: tag, 'cache-control': 'no-cache' });
  res.end(body);
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (res, title, text) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Глашатай</title><link href="https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@500&family=Inter:wght@400;500&display=swap" rel="stylesheet"><link rel="stylesheet" href="/style.css">
    <main class="note"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn primary" href="/#accounts">Вернуться к площадкам</a></main>`); };

// Настройки, которые вводятся в кабинете: ключи приложений площадок + сервис. [ключ, подпись, секрет?]
const SERVICE = [
  ['MEDIA_SCP_TARGET', 'Куда класть файлы (сервер:/папка/ или /папка/)'], ['MEDIA_PUBLIC_URL', 'Откуда они видны (https://…/m/)'],
  ['METRIKA_TOKEN', 'Токен Яндекс Метрики (только чтение статистики)', true],
];
const SETTING_KEYS = new Map([...SERVICE, ...Object.values(PLATFORMS).flatMap((p) => p.app || [])].map(([k, , secret]) => [k, !!secret]));
const settingView = (k) => { const v = setting(k); return { set: !!v, value: SETTING_KEYS.get(k) ? null : v }; };
// Адрес возврата после входа. У YouTube клиент Google «для компьютера»: он возвращает только на localhost —
// с сервера страница не откроется, человек вставляет её адрес в кабинет («Завершить вход»).
const redirectFor = (k) => PLATFORMS[k]?.loopback || `${BASE}/oauth/${k}/callback`;
const readBody = async (req) => { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };

// ---------- состояние для кабинета ----------

async function state(me) {
  const posts = all('select * from posts order by id desc').map(parsePost);
  const targets = all('select * from targets order by planned_at, id');
  const byPost = Object.groupBy(targets, (t) => t.post_id);
  return {
    me,
    dry: DRY(),
    now: now(),
    service: { fields: SERVICE.map(([k, l, secret]) => ({ key: k, label: l, secret: !!secret, ...settingView(k) })),
      proxy: Boolean(process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)),
      notify: { bot: await botUsername().catch(() => null), people: linkState().map((u) => ({ ...u, linked: !!u.linked, me: u.id === me.id })) } },
    vkid: (({ status, title, error } = account('vkid') || {}) => ({ connected: status === 'connected', title: title || null, error: error || null }))(),
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, p]) => {
      const a = account(k);
      const redirect = redirectFor(k);
      const app = (p.app || []).map(([key, label, secret]) => ({ key, label, secret: !!secret, ...settingView(key) }));
      return [k, { title: p.title, color: p.color, setup: p.setup, redirect, loopback: !!p.loopback, app, appReady: app.every((f) => f.set),
        steps: (p.steps || []).map((x) => x.replaceAll('{redirect}', redirect)), test: !!p.test, connected: a?.status === 'connected', status: a?.status || 'off',
        account: a?.title || null, error: a?.error || null, expires: a?.expires_at || null, connect: p.connect || null, fields: p.fields || null,
        formats: Object.fromEntries(Object.entries(p.formats).map(([f, d]) => [f, { title: d.title, auto: d.auto, level: d.level || (d.auto ? 'full' : 'manual'), hint: d.hint, rules: d.rules, cover: d.cover || [], caption: d.caption || 'auto', manual: d.manual || [], comment: d.comment || null }])) }];
    })),
    posts: posts.map((p) => ({ ...p, targets: (byPost[p.id] || []).map((t) => ({ ...t, stats: t.stats && JSON.parse(t.stats), tasks: t.tasks ? JSON.parse(t.tasks) : [] })) })),
    events: all('select * from events order by id desc limit 200'),
  };
}

// ---------- посты и публикации ----------

const KINDS = ['video', 'image', 'carousel', 'text'];
const TARGET_FIELDS = ['platform', 'format', 'caption', 'title', 'planned_at', 'mode'];

function cleanTarget(t) {
  if (!PLATFORMS[t.platform]?.formats[t.format]) throw new Error(`неизвестный формат ${t.platform}/${t.format}`);
  if (Number.isNaN(Date.parse(t.planned_at))) throw new Error('неверное время публикации');
  return { ...t, planned_at: new Date(t.planned_at).toISOString(), mode: t.mode === 'manual' ? 'manual' : 'auto',
    caption: t.caption?.trim() ? t.caption : null, title: t.title?.trim() || null };
}

/*
 * Правило: один пост — одна площадка (решение 17.11.2026): у каждой своя подпись, время, обложка и статус.
 * Новый пост с несколькими отмеченными площадками превращается в отдельный пост на каждую — с одинаковым содержимым.
 */
function savePost(b, id = null, by = null) {
  if (!id && (b.targets || []).length > 1) {
    const ids = b.targets.map((t) => savePost({ ...b, targets: [t] }, null, by).id);
    return { id: ids[0], ids };
  }
  if (id) {
    const done = get('select status from targets where post_id=? and (status in (?,?,?) or (status=? and remote_id is not null))', id, 'publishing', 'published', 'unknown', 'due');
    if (done) throw new Error('пост уже на площадке — здесь его не изменить; для нового выпуска сделайте копию');
    const have = get("select count(*) n from targets where post_id=? and status <> 'cancelled'", id).n - (b.removeTargets || []).length;
    if (have + (b.targets || []).filter((t) => !t.id).length > 1) throw new Error('у поста одна площадка — для другой сделайте копию («Копия на другую площадку»)');
  }
  if (!b.title?.trim()) throw new Error('нужно название');
  if (!KINDS.includes(b.kind)) throw new Error('неизвестный вид');
  const media = (b.media || []).map(String);
  media.forEach(abs);
  db.exec('begin');
  try {
    const coverSec = Number.isFinite(+b.cover_sec) && b.cover_sec !== null && b.cover_sec !== '' ? +b.cover_sec : null;
    const coverImage = b.cover_image ? String(b.cover_image) : null;
    const comment = String(b.comment || '').trim() || null;
    if (coverImage) abs(coverImage);
    if (id) run('update posts set title=?, kind=?, caption=?, media=?, release=?, note=?, cover_sec=?, cover_image=?, comment=? where id=?', b.title.trim(), b.kind, b.caption || '', JSON.stringify(media), b.release || null, b.note || '', coverSec, coverImage, comment, id);
    else id = Number(run('insert into posts (title, kind, caption, media, release, note, cover_sec, cover_image, comment, approved_at, approved_by) values (?,?,?,?,?,?,?,?,?,?,?)', b.title.trim(), b.kind, b.caption || '', JSON.stringify(media), b.release || null, b.note || '', coverSec, coverImage, comment, now(), by).lastInsertRowid);
    // Публикации: новые добавляем, изменённые правим, только пока не ушли в работу.
    for (const raw of b.targets || []) {
      const t = cleanTarget(raw);
      if (raw.id) {
        const old = get('select status from targets where id=? and post_id=?', raw.id, id);
        if (!old) continue;
        if (!['draft', 'failed', 'scheduled', 'due'].includes(old.status)) continue;
        run(`update targets set ${TARGET_FIELDS.map((f) => `${f}=?`).join(',')}, updated_at=? where id=?`, ...TARGET_FIELDS.map((f) => t[f]), now(), raw.id);
      } else {
        run(`insert into targets (post_id, ${TARGET_FIELDS.join(',')}) values (?,?,?,?,?,?,?)`, id, ...TARGET_FIELDS.map((f) => t[f]));
      }
    }
    for (const tid of b.removeTargets || []) run("delete from targets where id=? and post_id=? and status in ('draft','failed','cancelled')", tid, id);
    // «Ворожея отвечает» — только YouTube и Instagram (там можно отвечать на комментарии); включают на гадательных роликах
    if ('oracle' in b) run("update targets set oracle=? where post_id=? and platform in ('youtube','instagram')", b.oracle ? 1 : 0, id);
    db.exec('commit');
  } catch (e) { db.exec('rollback'); throw e; }
  log(b.id ? 'пост изменён' : 'пост создан', { postId: id, by });
  return { id };
}

/* Действия с публикацией. */
const ACTIONS = {
  // В очередь — только если всё проверено: файлы, подпись, подключение.
  async schedule(t, b, by) {
    const issues = await problems(t);
    if (issues.length) return { error: issues.join('; ') };
    if (!move(t.id, ['draft', 'failed'], 'scheduled', { error: null, attempts: 0 })) return { error: 'уже в работе' };
    log(`в очереди: ${PLATFORMS[t.platform].title} · ${fmt(t).title}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  unschedule(t, b, by) {
    if (!move(t.id, ['scheduled', 'due'], 'draft')) return { error: 'уже публикуется или опубликовано' };
    log(`снято с очереди: ${PLATFORMS[t.platform].title}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  cancel(t, b, by) {
    if (!move(t.id, ['draft', 'scheduled', 'due', 'failed', 'unknown'], 'cancelled')) return { error: 'нельзя' };
    log(`отменено: ${PLATFORMS[t.platform].title}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  // «Опубликовано вручную» — для пакетов и для «неясно, вышло ли»: человек проверил площадку и вставил ссылку.
  mark(t, b, by) {
    // Вышло руками: задача «опубликовать» закрыта; комментарий и закрепление — задачами, если у поста есть комментарий.
    const post = parsePost(get('select * from posts where id=?', t.post_id));
    const tasks = t.tasks ? JSON.parse(t.tasks) : tasksFor(t, post);
    for (const x of tasks) if (x.key === 'publish') x.done = true;
    if (!move(t.id, ['due', 'unknown', 'scheduled', 'draft', 'failed'], 'published', { url: b.url || null, published_at: now(), error: null, tasks: JSON.stringify(tasks) })) return { error: 'нельзя' };
    log(`${PLATFORMS[t.platform].title}: отмечено как опубликованное ${b.url || ''}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  // Галочка задачи после публикации.
  task(t, b, by) {
    const tasks = t.tasks ? JSON.parse(t.tasks) : [];
    const x = tasks.find((y) => y.key === b.key);
    if (!x) return { error: 'нет такой задачи' };
    x.done = !!b.done;
    run('update targets set tasks=?, updated_at=? where id=?', JSON.stringify(tasks), now(), t.id);
    log(`${PLATFORMS[t.platform].title}: ${x.done ? '✓' : '↺'} ${x.title}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  // Ссылка к уже вышедшему (например, TikTok опубликован из приложения, а ссылку вставили позже).
  // Пост удалили на площадке — убрать из аналитики (и вернуть, если ошиблись).
  removed(t, b, by) {
    if (t.status !== 'published') return { error: 'убрать можно только вышедшее' };
    run('update targets set removed_at=?, updated_at=? where id=?', b.on === false ? null : now(), now(), t.id);
    log(`${PLATFORMS[t.platform].title}: ${b.on === false ? 'возвращено в аналитику' : 'удалено на площадке — убрано из аналитики'}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  link(t, b, by) {
    if (t.status !== 'published') return { error: 'ссылку добавляют к опубликованному' };
    run('update targets set url=?, updated_at=? where id=?', String(b.url || '').trim() || null, now(), t.id);
    log(`${PLATFORMS[t.platform].title}: ссылка ${b.url || 'убрана'}`, { postId: t.post_id, targetId: t.id, by });
    return { ok: true };
  },
  // Повторить после «неясно» — только явным решением человека.
  retry: (t) => (move(t.id, ['unknown', 'failed'], 'draft', { error: null }) ? { ok: true } : { error: 'нельзя' }),
};

// ---------- проверка площадок без публики ----------

/* Проверочные файлы — из картинки «Пророчество дня»: JPEG 1080×1350 и вертикальный ролик 1080×1920, 6 с, с тихим звуком. */
async function testMedia() {
  const exec = promisify(execFile);
  const src = path.join(REPO, 'docs/контент/ворожея/картинки/пророчество-дня-око.jpg');
  const image = path.join(DATA, 'media', '_проверка.jpg'), video = path.join(DATA, 'media', '_проверка.mp4');
  if (!existsSync(image)) await exec('ffmpeg', ['-v', 'error', '-y', '-i', src, '-q:v', '3', image]);
  if (!existsSync(video)) {
    await exec('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', src, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '6',
      '-vf', 'scale=1080:1350,pad=1080:1920:0:285:color=0x0c0812,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', video]);
  }
  return { image, video };
}

async function testPlatform(k, me) {
  const p = PLATFORMS[k], acc = account(k);
  if (!p?.test) return null;
  if (acc?.status !== 'connected') return { error: `${p.title} не подключён` };
  try {
    const text = await p.test({ account: acc, ...(await testMedia()), me: get('select * from users where id=?', me.id) });
    log(`${p.title}: проверка прошла — ${text}`, { by: me.name });
    return { ok: true, text };
  } catch (e) {
    log(`${p.title}: проверка не прошла — ${e.message}`, { by: me.name, level: 'error' });
    return { error: e.message };
  }
}

// ---------- маршруты ----------

const ROUTES = [
  ['GET', /^\/api\/state$/, (b, m, me) => state(me)],
  ['GET', /^\/api\/analytics$/, async () => ({ ...analyticsState(), site: await siteState(), vk: await vkCommunity() })],
  ['POST', /^\/api\/music$/, (b, m, me) => saveMusic(b, me.name)],
  ['POST', /^\/api\/analytics\/refresh$/, async (b, m, me) => { await snapshotFollowers(); await collectStats({ force: true }); await siteState(true); await vkCommunity(true); log('цифры обновлены вручную', { by: me.name }); return { ok: true }; }],
  ['POST', /^\/api\/logout$/, () => ({ ok: true, logout: true })],
  ['POST', /^\/api\/password$/, (b, m, me) => changePassword(me.id, b.old, b.new)],
  ['POST', /^\/api\/settings$/, (b, m, me) => {
    for (const [k, v] of Object.entries(b)) {
      if (!SETTING_KEYS.has(k)) return { error: `неизвестная настройка ${k}` };
      // Пустое поле секрета — «не менять»: в кабинете секреты не показываются, поле всегда пустое.
      if (SETTING_KEYS.get(k) && !String(v).trim()) continue;
      saveSetting(k, v);
    }
    log(`настройки изменены: ${Object.keys(b).join(', ')}`, { by: me.name });
    return { ok: true };
  }],
  ['DELETE', /^\/api\/settings\/(\w+)$/, (b, m, me) => {
    if (!SETTING_KEYS.has(m[1])) return null;
    saveSetting(m[1], '');
    log(`настройка удалена: ${m[1]}`, { by: me.name });
    return { ok: true };
  }],
  // Вход с другого компьютера (через туннель): площадка возвращает на localhost того, кто входит, — там Глашатая нет,
  // страница не открывается, но код входа уже в адресной строке. Человек копирует адрес сюда — вход завершается.
  ['POST', /^\/api\/oauth\/(\w+)\/paste$/, async (b, m, me) => {
    const p = PLATFORMS[m[1]];
    if (!p?.oauth) return null;
    let params;
    try { params = new URL(String(b.url || '').trim()).searchParams; } catch { return { error: 'Это не адрес — скопируйте всю строку из адресной строки браузера' }; }
    if (params.get('error')) return { error: `${p.title} ответил: ${params.get('error_description') || params.get('error')}` };
    if (!params.get('code')) return { error: 'В адресе нет кода входа — скопируйте адрес той страницы, что открылась после «Разрешить»' };
    try {
      const r = await p.oauth.callback(params, redirectFor(m[1]));
      log(`${p.title}: подключено ${r.title || ''}`, { by: me.name });
      return { ok: true, title: r.title };
    } catch (e) {
      log(`${p.title}: вход не удался: ${e.message}`, { level: 'error', by: me.name });
      return { error: e.message };
    }
  }],
  ['POST', /^\/api\/dry$/, (b, m, me) => {
    saveSetting('AUTOPOST_DRY', b.on ? '1' : '0');
    log(b.on ? 'включён тестовый режим' : 'тестовый режим выключен — публикации уходят на площадки', { by: me.name, level: b.on ? 'info' : 'warn' });
    return { ok: true };
  }],
  ['POST', /^\/api\/notify-test$/, async (b, m, me) => {
    await notify(`🔔 Глашатай на связи. Проверку отправил(а) ${me.name}.`, { strict: true });
    return { ok: true };
  }],
  ['POST', /^\/api\/test\/(\w+)$/, (b, m, me) => testPlatform(m[1], me)],
  ['POST', /^\/api\/me\/telegram$/, (b, m, me) => linkStart(me.id)],
  ['DELETE', /^\/api\/me\/telegram$/, (b, m, me) => { unlink(me.id); log('уведомления в Telegram отключены', { by: me.name }); return { ok: true }; }],
  ['GET', /^\/api\/files$/, async () => ({ files: await Promise.all(listFiles().map(async (f) => ({ path: f, ...(await probe(f)) }))) })],
  ['POST', /^\/api\/posts$/, (b, m, me) => savePost(b, null, me.name)],
  ['PUT', /^\/api\/posts\/(\d+)$/, (b, m, me) => savePost({ ...b, id: +m[1] }, +m[1], me.name)],
  ['POST', /^\/api\/posts\/(\d+)\/approve$/, (b, m, me) => {
    const p = get('select title from posts where id=?', +m[1]);
    if (!p) return null;
    if (b.on === false) {
      if (get("select 1 from targets where post_id=? and status not in ('draft','cancelled','failed')", +m[1])) return { error: 'пост уже в очереди или вышел — сначала снимите с очереди' };
      run('update posts set approved_at=null, approved_by=null where id=?', +m[1]);
    } else run('update posts set approved_at=?, approved_by=? where id=?', now(), me.name, +m[1]);
    log(`${b.on === false ? 'утверждение снято' : 'утверждено'}: «${p.title}»`, { postId: +m[1], by: me.name });
    return { ok: true };
  }],
  ['DELETE', /^\/api\/posts\/(\d+)$/, (b, m, me) => {
    if (get("select 1 from targets where post_id=? and status in ('publishing','published')", +m[1])) return { error: 'у поста есть опубликованное — удалять нельзя, только отменить остальное' };
    const p = get('select title from posts where id=?', +m[1]);
    run('delete from posts where id=?', +m[1]);
    log(`пост удалён: «${p?.title}»`, { by: me.name });
    return { ok: true };
  }],
  ['POST', /^\/api\/targets\/(\d+)\/(\w+)$/, async (b, m, me) => {
    const t = get('select * from targets where id=?', +m[1]);
    if (!t || !Object.hasOwn(ACTIONS, m[2])) return null;
    return ACTIONS[m[2]](t, b, me.name);
  }],
  ['GET', /^\/api\/targets\/(\d+)\/check$/, async (b, m) => {
    const t = get('select * from targets where id=?', +m[1]);
    return t ? { problems: await problems(t) } : null;
  }],
  ['POST', /^\/api\/check$/, async (b) => {
    // Проверка ещё не сохранённого поста из редактора: какие площадки примут файлы.
    const post = { ...b, media: b.media || [] };
    const out = {};
    for (const t of b.targets || []) out[`${t.platform}/${t.format}`] = await problems({ ...t, post_id: 0 }, post);
    return out;
  }],
  ['POST', /^\/api\/run$/, async () => ({ ran: await publishDue() })],
  ['DELETE', /^\/api\/accounts\/(\w+)$/, (b, m, me) => { dropAccount(m[1]); log(`${PLATFORMS[m[1]]?.title}: отключено`, { by: me.name }); return { ok: true }; }],
  ['POST', /^\/api\/accounts\/(\w+)$/, async (b, m, me) => {
    const p = PLATFORMS[m[1]];
    if (!p?.connectToken) return { error: 'для этой площадки — вход через кнопку' };
    const r = await p.connectToken(b);
    if (r.ok) log(`${p.title}: подключено ${r.title || ''}`, { by: me.name });
    return r;
  }],
];

function sendFile(req, res, p) {
  if (!existsSync(p) || statSync(p).isDirectory()) return json(res, 404, { error: 'нет файла' });
  const { size } = statSync(p);
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = +range[1], end = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { 'content-type': mime(p), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': mime(p), 'content-length': size, 'accept-ranges': 'bytes' });
  return req.method === 'HEAD' ? res.end() : createReadStream(p).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Защита от чужих страниц в браузере: простая форма не может поставить свой заголовок, а с ним — нужен CORS, которого мы не даём.
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-autopost'] !== '1') return json(res, 403, { error: 'нет заголовка x-autopost' });
  // Вход.
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    if (!allowLogin(ip)) return json(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    const b = await readBody(req).catch(() => ({}));
    const s = await login(b.login, b.password);
    if (!s) return json(res, 401, { error: 'Неверный логин или пароль' });
    log('вошёл в кабинет', { by: s.user.name });
    return json(res, 200, { ok: true }, { 'set-cookie': cookie(s.token, s.maxAge) });
  }
  const me = userOf(req);
  if (!me && !PUBLIC.has(url.pathname)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'нужно войти' });
    res.writeHead(302, { location: '/login.html' });
    return res.end();
  }
  // Только просмотр: читать всё можно, менять — только свой пароль (и выйти); ещё можно обновить цифры аналитики.
  if (me?.readonly && (url.pathname.startsWith('/oauth/') || (!['GET', 'HEAD'].includes(req.method) && !['/api/logout', '/api/password', '/api/analytics/refresh'].includes(url.pathname))))
    return json(res, 403, { error: 'у вас доступ только на просмотр' });
  if (me && url.pathname === '/login.html') { res.writeHead(302, { location: '/' }); return res.end(); }
  // Файлы контента — для превью в кабинете.
  if (url.pathname === '/media') return sendFile(req, res, abs(url.searchParams.get('p') || ''));
  // Миниатюра ролика — картинкой: 40 видеоплееров в очереди браузер держит плохо, они мигают. Имя кадра меняется с файлом — кешировать можно надолго.
  if (url.pathname === '/thumb') {
    const f = await thumbFile(url.searchParams.get('p') || '', Math.max(0, +url.searchParams.get('t') || 1));
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' });
    return res.end(await readFile(f));
  }
  // Загрузка своего файла: тело — сам файл, имя в ?name=.
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const name = `${Date.now()}-${path.basename(url.searchParams.get('name') || 'file').replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
    const p = path.join(DATA, 'media', name);
    await pipeline(req, createWriteStream(p));
    return json(res, 200, { path: path.relative(REPO, p) });
  }
  // Вход в площадку (OAuth): /oauth/<площадка>/start → площадка → /oauth/<площадка>/callback.
  const oauth = /^\/oauth\/(\w+)\/(start|callback)$/.exec(url.pathname);
  // vkid — не площадка, а второй ключ VK (администратора) только для статистики.
  const OAUTH = { ...PLATFORMS, vkid: { title: 'VK ID (статистика VK)', oauth: vkidOauth } };
  if (oauth && OAUTH[oauth[1]]?.oauth) {
    const p = OAUTH[oauth[1]];
    const redirect = redirectFor(oauth[1]);
    // Разбор входа: что пришло на адрес возврата (код скрыт). ponytail: убрать, когда вход у всех заработает.
    console.log(new Date().toISOString(), `oauth ${oauth[1]} ${oauth[2]}`, url.search.replace(/code=[^&]+/, 'code=…'),
      '| ref:', req.headers.referer || '-', '| ua:', (req.headers['user-agent'] || '').slice(0, 90), '| sec-fetch:', req.headers['sec-fetch-mode'] || '-', req.headers['sec-purpose'] || '');
    try {
      if (oauth[2] === 'start') { res.writeHead(302, { location: await p.oauth.start(redirect) }); return res.end(); }
      const r = await p.oauth.callback(url.searchParams, redirect);
      log(`${p.title}: подключено ${r.title || ''}`, { by: me.name });
      return page(res, `${p.title}: подключено`, `${r.title || ''} — можно закрыть эту вкладку.`);
    } catch (e) {
      log(`${p.title}: вход не удался: ${e.message}`, { level: 'error', by: me.name });
      return page(res, `${p.title}: вход не удался`, e.message);
    }
  }
  if (url.pathname.startsWith('/api/')) {
    const route = ROUTES.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) return json(res, 404, { error: 'not_found' });
    try {
      const r = await route[2](req.method === 'GET' ? {} : await readBody(req), route[1].exec(url.pathname), me);
      if (r?.logout) { logout(req); return json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) }); }
      if (r === null) return json(res, 404, { error: 'not_found' });
      if (req.method === 'GET' && !r.error) {
        const body = JSON.stringify(r);
        return sendTagged(req, res, 'application/json; charset=utf-8', body, 'now' in r ? JSON.stringify({ ...r, now: null }) : body);
      }
      return json(res, r.error ? 400 : 200, r);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
  // Кабинет — статика из web/.
  const file = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) return json(res, 404, { error: 'not_found' });
  const st = statSync(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  return sendTagged(req, res, type, await readFile(file), `${st.mtimeMs}-${st.size}`);
}

export const server = http.createServer((req, res) => handle(req, res).catch((e) => json(res, 500, { error: e.message })));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recoverInterrupted();
  server.listen(PORT, HOST, () => console.log(`Глашатай: ${BASE}${DRY() ? '  (тестовый режим: на площадки ничего не уходит)' : ''}`));
  // Расписание: публикации раз в 20 с, цифры раз в час (внутри — не чаще 6 ч на пост).
  setInterval(() => publishDue().catch((e) => log(`расписание: ${e.message}`, { level: 'error' })), 20_000);
  // Раз в час: цифры публикаций (не чаще 6 ч на пост), снимок подписчиков (за день — последнее значение), продление ключей.
  const hourly = () => collectStats().then(snapshotFollowers).then(maintainAccounts).catch((e) => log(`цифры: ${e.message}`, { level: 'error' }));
  setInterval(hourly, 3600_000);
  // «Ворожея отвечает» — комментарии с номером карты под включёнными роликами
  setInterval(() => oracleRound().catch((e) => log(`Ворожея отвечает: ${e.message}`, { level: 'error' })), 30_000);
  hourly();
  publishDue();
  pollUpdates();
}
