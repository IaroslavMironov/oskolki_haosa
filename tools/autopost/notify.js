import { randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { isVideo, mime, probe } from './media.js';
import { setting, account } from './secrets.js';
import { db, all, get, run, now } from './db.js';

/*
 * Уведомления в Telegram: каждый сам привязывает свой Telegram
 * одноразовым кодом из кабинета: ссылка t.me/<бот>?start=<код> → бот запоминает его чат.
 * Бот — тот же, что публикует в канал (Площадки → Telegram); отдельный можно задать TG_BOT_TOKEN.
 * Сообщения боту принимаем долгим опросом из процесса Глашатая — наружу ничего открывать не нужно.
 * Ошибка отправки уведомления не роняет публикацию — только пишется в консоль.
 */

const CODE_TTL_MIN = 15;
for (const col of ['tg_chat_id text', 'tg_name text', 'tg_code text', 'tg_code_at text']) {
  try { db.exec(`alter table users add column ${col}`); } catch { /* уже есть */ }
}

export const botToken = () => setting('TG_BOT_TOKEN') || account('telegram')?.secret?.token || '';

async function tg(method, body, timeout = 15_000) {
  const token = botToken();
  if (!token) throw new Error('бот не подключён: «Площадки → Telegram»');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
  return j.result;
}

let botName = { token: null, name: null };
export async function botUsername() {
  const token = botToken();
  if (!token) return null;
  if (botName.token !== token) botName = { token, name: (await tg('getMe', {}).catch(() => null))?.username || null };
  return botName.name;
}

async function tgFile(method, fields, field, file, timeout = 5 * 60_000) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) body.append(k, String(v));
  body.append(field, await openAsBlob(file, { type: mime(file) }), path.basename(file));
  const r = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: 'POST', body, signal: AbortSignal.timeout(timeout) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
  return j.result;
}

const chatsAll = () => [...new Set([...all('select tg_chat_id from users where tg_chat_id is not null').map((r) => r.tg_chat_id), setting('TG_CHAT_ID')].filter(Boolean))];

/*
 * Пакет для ручной публикации (VK, TikTok) прямо в бота: что и куда, файлы, подпись и первый комментарий
 * отдельными сообщениями — их удобно зажать и скопировать. Видео — как есть (бот не пережимает),
 * картинки — документом, чтобы не потерять качество. Владислав 18.11: «чтобы все материалы приходили в бот».
 */
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/**
 * Пакет для ручной публикации (VK, TikTok). Владислав 18–20.11: без инструкций, но чтобы пакеты не сливались:
 *  1) ролик с шапкой-подписью (черта, площадка, когда, что) — или шапка отдельным сообщением, если файлов не один ролик;
 *  2) «подпись» и 3) «комментарий» — у каждого метка площадки, сам текст в блоке: касание копирует его целиком;
 *  кнопка «✓ Выложил» под последним сообщением — отмечает публикацию в Глашатае (как в кабинете).
 */
// Где в Telegram стоит кнопка «✓ Выложил» пакета: [[чат, сообщение]] — чтобы отметка в кабинете меняла кнопку и в боте.
try { db.exec('alter table targets add column tg_msgs text'); } catch { /* уже есть */ }
const DONE_KB = { inline_keyboard: [[{ text: '✓ Выложено', callback_data: 'done' }]] };

/** Публикация отмечена (где угодно) — у всех её пакетов в боте кнопка становится «✓ Выложено». */
export async function packageDone(targetId) {
  const r = get('select tg_msgs from targets where id=?', targetId);
  for (const [chat, msg] of JSON.parse(r?.tg_msgs || '[]')) {
    await tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: DONE_KB }).catch(() => {}); // уже изменена / удалена — не важно
  }
}

export async function sendPackage({ where, when, title, files = [], caption = '', comment = '', targetId = null }) {
  const kb = targetId ? { inline_keyboard: [[{ text: '✓ Выложил', callback_data: `mark:${targetId}`, style: 'success' }]] } : null;
  const tag = `<b>${esc(where)}</b>`, head = `━━━━━━━━━━━━━━━━\n${tag} · ${esc(when)}\n${esc(title)}`;
  const texts = [caption && ['📝 подпись', caption], comment && ['💬 комментарий', comment]].filter(Boolean);
  const html = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const oneVideo = files.length === 1 && isVideo(files[0]);
  const btn = (isLast) => (kb && isLast ? { reply_markup: kb } : {});
  const sent = []; // сообщения с кнопкой
  for (const c of chatsAll()) {
    try {
      let m;
      if (!oneVideo) m = await tg('sendMessage', { chat_id: c, text: head, ...html, ...btn(!files.length && !texts.length) });
      for (const [i, f] of files.entries()) {
        const extra = { ...(oneVideo ? { caption: head, parse_mode: 'HTML' } : {}), ...(kb && !texts.length && i === files.length - 1 ? { reply_markup: JSON.stringify(kb) } : {}) };
        // без размеров и длительности Telegram показывает вертикальный ролик криво (квадратом/сплющенным)
        if (isVideo(f)) { const v = await probe(f); m = await tgFile('sendVideo', { chat_id: c, supports_streaming: true, width: v.width, height: v.height, duration: v.duration ? Math.round(v.duration) : null, ...extra }, 'video', f); }
        else m = await tgFile('sendDocument', { chat_id: c, ...extra }, 'document', f);
      }
      for (const [i, [label, text]] of texts.entries()) {
        m = await tg('sendMessage', { chat_id: c, text: `${tag} · ${label}\n<pre>${esc(text.slice(0, 3800))}</pre>`, ...html, ...btn(i === texts.length - 1) });
      }
      if (kb && m?.message_id) sent.push([c, m.message_id]); // кнопка всегда под последним сообщением пакета
    } catch (e) { console.warn('telegram (пакет):', e.message); }
  }
  if (targetId && sent.length) run('update targets set tg_msgs=? where id=?', JSON.stringify(sent), targetId);
}

/** Всем, кто подключил уведомления (+ общий чат TG_CHAT_ID, если задан). strict — для кнопки «Проверить»: ошибки наружу. */
export async function notify(text, { strict = false, chat = null, html = false } = {}) {
  const chats = chat ? [chat] : [...new Set([...all('select tg_chat_id from users where tg_chat_id is not null').map((r) => r.tg_chat_id), setting('TG_CHAT_ID')].filter(Boolean))];
  if (!botToken() || !chats.length) { if (strict) throw new Error(botToken() ? 'никто ещё не подключил уведомления' : 'бот не подключён: «Площадки → Telegram»'); return; }
  for (const c of chats) {
    try { await tg('sendMessage', { chat_id: c, text: text.slice(0, 4000), link_preview_options: { is_disabled: true }, ...(html ? { parse_mode: 'HTML' } : {}) }); } catch (e) {
      if (strict) throw new Error(`Telegram: ${e.message}`);
      console.warn('telegram:', e.message);
    }
  }
}

/* ── Привязка из кабинета ── */

export async function linkStart(userId) {
  const name = await botUsername();
  if (!name) return { error: 'Сначала подключите бота: «Площадки → Telegram»' };
  const code = randomBytes(12).toString('base64url');
  run('update users set tg_code=?, tg_code_at=? where id=?', code, now(), userId);
  return { link: `https://t.me/${name}?start=${code}` };
}

export const unlink = (userId) => run('update users set tg_chat_id=null, tg_name=null where id=?', userId);
export const linkState = () => all('select id, name, tg_chat_id is not null as linked, tg_name from users order by id');

const HELP = 'Это бот «Осколков хаоса»: он публикует посты в канал и присылает уведомления Глашатая. '
  + 'Чтобы получать уведомления: Глашатай → «Площадки» → «Сервис» → «Подключить мой Telegram».';

/* Кнопка «✓ Выложил» из пакета: server.js регистрирует, как отметить (тот же mark, что в кабинете). */
let markHandler = null;
export const onMarkButton = (fn) => { markHandler = fn; };

async function handleButton(q) {
  const user = get('select id, name from users where tg_chat_id=?', String(q.message?.chat?.id || ''));
  const id = +(/^mark:(\d+)$/.exec(q.data || '') || [])[1];
  if (!user || !id || !markHandler) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Не получилось — отметьте в кабинете' });
  const r = await markHandler(id, user.name);
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: r.ok ? 'Отмечено: опубликовано' : r.already ? 'Уже отмечено' : `Не получилось: ${r.error}` });
  // у остальных (второй человек, старые пакеты) кнопку меняет packageDone из отметки; эту — сразу
  if (r.ok || r.already) await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: DONE_KB }).catch(() => {});
}

export async function handleUpdate(u) {
  if (u?.callback_query) return handleButton(u.callback_query);
  const msg = u?.message;
  if (!msg?.chat || msg.chat.type !== 'private') return;
  const chatId = String(msg.chat.id), text = String(msg.text || '').trim();
  if (/^\/stop\b/.test(text)) {
    run('update users set tg_chat_id=null, tg_name=null where tg_chat_id=?', chatId);
    return tg('sendMessage', { chat_id: chatId, text: 'Отключено: уведомлений больше не будет. Подключить снова — в Глашатае.' });
  }
  const code = (text.match(/^\/start\s+([A-Za-z0-9_-]{8,64})$/) || [])[1];
  if (!code) return tg('sendMessage', { chat_id: chatId, text: HELP });
  const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') + (msg.from?.username ? ` (@${msg.from.username})` : '');
  const u2 = get('select id, name from users where tg_code=? and tg_code_at > ?', code, new Date(Date.now() - CODE_TTL_MIN * 60_000).toISOString());
  if (!u2) return tg('sendMessage', { chat_id: chatId, text: 'Код не подошёл или устарел (он живёт 15 минут). Нажмите «Подключить мой Telegram» в Глашатае ещё раз.' });
  // Чат привязан к одному человеку: если был у другого — переезжает.
  run('update users set tg_chat_id=null, tg_name=null where tg_chat_id=?', chatId);
  run('update users set tg_chat_id=?, tg_name=?, tg_code=null, tg_code_at=null where id=?', chatId, who.slice(0, 120) || null, u2.id);
  return tg('sendMessage', { chat_id: chatId, text: `Готово, ${u2.name}: сюда будут приходить уведомления Глашатая — что вышло, что выложить руками и что сломалось. Отключить — /stop.` });
}

/* Долгий опрос. Один процесс на бота: второй (например, Глашатай на сервере и на ноутбуке сразу) получит 409 — пишем и ждём. */
export async function pollUpdates({ stop = () => false } = {}) {
  let offset = 0;
  while (!stop()) {
    if (!botToken()) { await new Promise((r) => setTimeout(r, 30_000)); continue; }
    try {
      const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 70_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u).catch((e) => console.warn('бот: не обработал сообщение', e.message));
      }
    } catch (e) {
      console.warn('бот: опрос не прошёл:', e.message);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}
