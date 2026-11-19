import { db, all, get, move, log, now, parsePost, run } from './db.js';
import { account, setAccountStatus, setting } from './secrets.js';
import { abs, check } from './media.js';
import { PLATFORMS } from './platforms/index.js';
import { notify, sendPackage } from './notify.js';
import { publicTarget } from './pubmedia.js';

/*
 * Публикация по расписанию. Правило из Нейро-продюсера (src/publish/service.js):
 * не опубликовал — не страшно, опубликовал не то или дважды — плохо. Поэтому:
 *  — попытка отмечается ДО отправки (status → publishing);
 *  — повтор только если площадка точно ничего не опубликовала (ошибка с пометкой notSent);
 *  — оборвалось посреди отправки (процесс упал, связь пропала) — статус «unknown»: человек смотрит площадку сам;
 *  — опоздали больше чем на STALE_HOURS — не публикуем: пост «завтра релиз», вышедший после релиза, хуже, чем никакой.
 *
 * Статусы публикации (target):
 *   draft → scheduled → publishing → published
 *                               ↘ failed (ошибка, ничего не вышло)   ↘ unknown (неясно, вышло ли)
 *   manual: scheduled → due (пора выложить руками) → published (человек вставил ссылку)
 */

export const STALE_HOURS = 6;
const MAX_ATTEMPTS = 3;
// Тестовый режим: переключается в кабинете (настройка AUTOPOST_DRY), по умолчанию — из .env.
export const DRY = () => setting('AUTOPOST_DRY') === '1';

/** Ошибка, после которой на площадке точно ничего не появилось: можно повторить. */
export const notSent = (message) => Object.assign(new Error(message), { notSent: true });

export const fmt = (t) => PLATFORMS[t.platform]?.formats[t.format];
export const captionOf = (t, post) => (t.caption ?? post.caption ?? '').trim();

/*
 * Задачи после публикации — то, что остаётся человеку: опубликовать черновик TikTok, оставить и закрепить комментарий.
 * Хранятся у публикации (targets.tasks), отмечаются галочкой в кабинете; незакрытые — в «Требует внимания».
 */
export function tasksFor(t, post, { pending = false } = {}) {
  const f = fmt(t), out = [];
  if (pending) out.push({ key: 'publish', title: `Опубликовать черновик в ${PLATFORMS[t.platform].title}, вставив подпись`, copy: captionOf(t, post) || null, done: false });
  if (post.comment?.trim() && f?.comment) {
    out.push({ key: 'comment', title: 'Оставить первый комментарий', copy: post.comment.trim(), done: false });
    out.push({ key: 'pin', title: 'Закрепить комментарий', done: false });
  }
  return out;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Напоминание о незакрытых задачах + тексты отдельными сообщениями (в Telegram моноширинный текст копируется касанием). */
async function remindTasks(p, post, url, tasks) {
  const open = tasks.filter((x) => !x.done);
  if (!open.length) return;
  await notify(`✋ ${p.title}, «${post.title}» — осталось:\n${open.map((x) => `• ${x.title}`).join('\n')}${url ? `\n${url}` : ''}`);
  for (const x of open) if (x.copy) await notify(`<code>${esc(x.copy)}</code>`, { html: true });
}

/** Что мешает публикации (файлы, длина подписи, подключение). Пусто — можно ставить в очередь. */
export async function problems(t, post = parsePost(get('select * from posts where id=?', t.post_id))) {
  const f = fmt(t);
  if (!f) return [`${t.platform}: формат «${t.format}» не поддерживается`];
  const out = await check(f.rules, post, captionOf(t, post));
  if (t.post_id && !post.approved_at) out.push('пост не утверждён — откройте его и нажмите «Утвердить»');
  if (f.rules.title && !(t.title || post.title)) out.push('нужно название');
  if (/\[(ссылка|вставить|TODO)[^\]]*\]/i.test(captionOf(t, post))) out.push('в подписи осталась заглушка вида «[ссылка]» — замените её');
  if (t.mode === 'auto' && !f.auto) out.push('этот формат площадка не даёт публиковать автоматически — только пакет для ручной');
  if (t.mode === 'auto' && f.rules.needsPublic && !publicTarget()) out.push(`${PLATFORMS[t.platform].title}: картинки берутся только по публичной ссылке, а папки нет — выберите «вручную» (ролики Reels идут автоматом)`);
  if (t.mode === 'auto' && f.rules.autoNoMedia && post.media.length) out.push(`${PLATFORMS[t.platform].title}: картинки автоматом не загружаются — выберите «вручную», Глашатай напомнит и даст файл с подписью`);
  if (t.mode === 'auto' && !DRY() && account(t.platform)?.status !== 'connected') out.push(`${PLATFORMS[t.platform].title} не подключён`);
  // Reels без выбранной обложки Instagram берёт кадр сам, и сменить его потом нельзя (дважды выходило так 17–18.11)
  if (t.platform === 'instagram' && t.format === 'reels' && post.media.some((m) => /\.(mp4|mov)$/i.test(m)) && post.cover_sec == null && !post.cover_image)
    out.push('Instagram: выберите обложку (кадр или картинку) — без неё Reels выйдет с кадром, который выберет Instagram, и поменять его потом нельзя');
  return out;
}

async function publishOne(t) {
  const post = parsePost(get('select * from posts where id=?', t.post_id));
  const late = Date.now() - Date.parse(t.planned_at);
  const ctx = { targetId: t.id, postId: post.id };
  if (late > STALE_HOURS * 3600_000) {
    move(t.id, ['scheduled'], 'failed', { error: `пропущено время публикации (опоздание ${Math.round(late / 3600_000)} ч) — назначьте новое` });
    log('пропущено время публикации', { ...ctx, level: 'warn' });
    notify(`⏰ Пропущено время: «${post.title}» в ${PLATFORMS[t.platform].title} — назначьте новое в кабинете`);
    return;
  }
  if (t.mode === 'manual') return; // ручные — в remindManual: пакет в бота
  // Повтор после «точно не отправилось» — с паузой 1, 4, 16 минут.
  if (t.attempts > 0 && Date.now() - Date.parse(t.updated_at) < 4 ** (t.attempts - 1) * 60_000) return;
  const issues = await problems(t, post);
  if (issues.length) {
    move(t.id, ['scheduled'], 'failed', { error: issues.join('; ') });
    log(`не опубликовано: ${issues.join('; ')}`, { ...ctx, level: 'error' });
    notify(`❌ Не опубликовано «${post.title}» в ${PLATFORMS[t.platform].title}: ${issues.join('; ')}`);
    return;
  }
  if (!move(t.id, ['scheduled'], 'publishing', { attempts: t.attempts + 1, error: null, progress: null })) return;
  const p = PLATFORMS[t.platform];
  log(`${p.title}: публикую${DRY() ? ' (тестовый режим)' : ''}`, ctx);
  try {
    const acc = DRY() ? null : account(t.platform);
    const progress = (text) => run('update targets set progress=? where id=?', text, t.id);
    const publish = DRY() ? dryPublish : p.publish;
    const r = await publish({
      target: t, post, format: t.format, caption: captionOf(t, post), title: t.title || post.title,
      files: post.media.map(abs), account: acc, progress,
      cover: { sec: post.cover_sec ?? null, image: post.cover_image ? abs(post.cover_image) : null },
    });
    // Задачи после публикации; первый комментарий на YouTube и в Instagram Глашатай пробует оставить сам.
    const tasks = tasksFor(t, post, { pending: r.pending });
    const c = tasks.find((x) => x.key === 'comment');
    if (c && !r.pending && fmt(t).comment === 'auto' && p.comment) {
      try { await p.comment({ account: acc, id: r.id, text: c.copy }); Object.assign(c, { done: true, title: 'Комментарий оставлен Глашатаем', auto: true }); }
      catch (e) { c.note = e.message; log(`${p.title}: комментарий не оставлен: ${e.message}`, { ...ctx, level: 'warn' }); }
    }
    // Полуавтомат (черновик TikTok): файл на площадке, но публикует человек — «ждёт вас», пока не отметит «вышло».
    if (r.pending) move(t.id, ['publishing'], 'due', { remote_id: r.id ?? null, progress: null, error: null, tasks: JSON.stringify(tasks) });
    else move(t.id, ['publishing'], 'published', { url: r.url ?? null, remote_id: r.id ?? null, published_at: now(), progress: null, tasks: JSON.stringify(tasks) });
    log(`${p.title}: ${r.pending ? 'загружено, ждёт вашей публикации' : 'опубликовано'} ${r.url || ''}${r.note ? ` — ${r.note}` : ''}`, ctx);
    // Черновик TikTok человек дописывает в приложении — подпись приходит в Telegram, чтобы скопировать с телефона.
    if (!DRY()) {
      await notify(`${r.pending ? '◐' : '✅'} ${p.title}: «${post.title}» ${r.url || ''}${r.note ? `\n${r.note}` : ''}`);
      await remindTasks(p, post, r.url, tasks);
    }
  } catch (e) {
    const msg = String(e.message).slice(0, 500);
    if (e.auth) setAccountStatus(t.platform, 'error', msg);
    if (e.notSent && t.attempts + 1 < MAX_ATTEMPTS) {
      move(t.id, ['publishing'], 'scheduled', { error: `${msg} — повторю` });
      log(`${p.title}: не вышло, повторю: ${msg}`, { ...ctx, level: 'warn' });
    } else {
      move(t.id, ['publishing'], e.notSent ? 'failed' : 'unknown', { error: msg, progress: null });
      log(`${p.title}: ${e.notSent ? 'ошибка' : 'оборвалось — проверьте площадку, вышел ли пост'}: ${msg}`, { ...ctx, level: 'error' });
      notify(`${e.notSent ? '❌' : '⚠️'} ${p.title}, «${post.title}»: ${e.notSent ? 'ошибка' : 'оборвалось посреди отправки — проверьте, вышел ли пост'}: ${msg}`);
    }
  }
}

let busy = false;
/** Всё, чему подошло время. Раз в 20 секунд из server.js, по одному: загрузки тяжёлые. */
export async function publishDue() {
  if (busy) return 0;
  busy = true;
  try {
    const due = all("select * from targets where status='scheduled' and planned_at <= ? order by planned_at, id limit 20", now());
    for (const t of due) await publishOne(t);
    await remindManual();
    return due.length;
  } finally { busy = false; }
}

/*
 * Ручные публикации (VK, TikTok): в назначенное время — пакет в бота, один раз (reminded_at). VK-черновики в очередь
 * не ставят, поэтому смотрим и черновики. Прошло больше STALE_HOURS — не шлём (не заваливаем чат старьём).
 */
try { db.exec('alter table targets add column reminded_at text'); } catch { /* уже есть */ }
export async function remindManual() {
  const rows = all(`select * from targets where mode='manual' and status in ('draft','scheduled','due') and reminded_at is null and planned_at <= ?
    order by planned_at limit 10`, now());
  for (const t of rows) {
    run('update targets set reminded_at=? where id=?', now(), t.id); // сначала метка — пакет не уйдёт дважды
    const post = parsePost(get('select * from posts where id=?', t.post_id));
    if (Date.now() - Date.parse(t.planned_at) > STALE_HOURS * 3600_000 || /НУЖЕН ФАЙЛ/.test(post.note || '')) continue;
    if (t.status === 'scheduled') move(t.id, ['scheduled'], 'due');
    const p = PLATFORMS[t.platform], f = fmt(t);
    log(`пора выложить вручную: ${p.title} — пакет в Telegram`, { targetId: t.id, postId: post.id });
    const when = new Date(t.planned_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    // только что и куда — дальше файл, подпись и комментарий, чтобы сразу копировать (Владислав 18.11: без инструкций)
    await sendPackage({
      head: `✋ ${post.title.replace(/^Ролик:\s*/, '')} · ${p.title}, ${f.title} · ${when}`,
      files: post.media.map(abs), caption: f.caption === 'none' ? '' : captionOf(t, post), comment: f.comment ? post.comment || '' : '', targetId: t.id,
    });
  }
}

/** Процесс упал посреди отправки: такие публикации нельзя повторять вслепую. Вызывается при старте. */
export function recoverInterrupted() {
  for (const t of all("select id, post_id from targets where status='publishing'")) {
    move(t.id, ['publishing'], 'unknown', { error: 'сервис перезапустился во время отправки — проверьте площадку, вышел ли пост', progress: null });
    log('отправка прервалась перезапуском', { postId: t.post_id, targetId: t.id, level: 'warn' });
  }
}

/** Цифры опубликованного (просмотры, лайки) — раз в 6 часов, первые 30 дней после выхода. */
export async function collectStats({ force = false } = {}) {
  if (DRY()) return;
  const rows = all(`select * from targets where status='published' and removed_at is null and (remote_id is not null or url is not null or platform='vk')
    and published_at > ? and (stats_at is null or stats_at < ?)`, new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() - (force ? 0 : 6 * 3600e3)).toISOString());
  for (const t of rows) {
    const p = PLATFORMS[t.platform];
    const acc = account(t.platform);
    if (!p.stats || acc?.status !== 'connected') continue;
    try {
      const s = await p.stats({ target: t, account: acc });
      if (!s) continue;
      run('update targets set stats=?, stats_at=? where id=?', JSON.stringify(s), now(), t.id);
    } catch (e) { log(`${p.title}: цифры не собрались: ${e.message}`, { targetId: t.id, level: 'warn' }); }
  }
}

/** Продление ключей площадок (Instagram — раз в неделю, иначе через 60 дней отвалится). Раз в час из server.js. */
export async function maintainAccounts() {
  if (DRY()) return;
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const acc = account(k);
    if (!p.maintain || acc?.status !== 'connected') continue;
    try { await p.maintain(acc); } catch (e) { log(`${p.title}: ключ не продлился: ${e.message}`, { level: 'warn' }); }
  }
}

/* Тестовый режим: всё как по-настоящему (проверка файлов, очередь, статусы), но площадки не трогаем. */
async function dryPublish({ target, progress }) {
  progress('загрузка (тест)');
  await new Promise((r) => setTimeout(r, 800));
  if (/\[fail\]/i.test(target.caption || '')) throw notSent('тестовая ошибка по пометке [fail] в подписи');
  return { id: `dry-${target.id}`, url: null, note: 'тестовый режим — на площадку ничего не ушло' };
}
