import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { call } from './http.js';
import { saveAccount } from '../secrets.js';
import { notSent } from '../publish.js';
import { readFileSync } from 'node:fs';
import { isVideo, mime, coverFile, REPO } from '../media.js';

/*
 * Кнопки «слушать» — под каждым постом канала (решение Владислава 18.11: «всегда с кнопками»), адреса в текст не пишем. Ведут на последнюю вышедшую песню сайта (data.js: песня с release,
 * чья дата уже наступила) — в день нового релиза переключаются сами; вышедшей нет — на страницу артиста. Цветные — Bot API, style.
 */
export function listenButtons(now = Date.now()) {
  const w = {};
  new Function('window', readFileSync(path.join(REPO, 'data.js'), 'utf8'))(w);
  const D = Object.values(w)[0];
  const out = Object.entries(D.releases || {}).filter(([, r]) => Date.parse(r.date) <= now).sort((a, b) => Date.parse(b[1].date) - Date.parse(a[1].date));
  const song = out.length ? D.songs.find((s) => s.release === out[0][0] && (s.links?.vk || s.links?.yandex)) : null;
  const L = song?.links || D.links || {};
  const row = [L.vk && { text: '▶ VK Музыка', url: L.vk, style: 'primary' }, L.yandex && { text: '▶ Яндекс Музыка', url: L.yandex, style: 'success' }].filter(Boolean);
  return row.length ? { inline_keyboard: [row] } : null;
}

/*
 * Telegram-канал: бот — админ канала с правом публиковать. Bot API без библиотек.
 * Раскладка поста — как в Нейро-продюсере (src/publish/service.js, туда — из «Бот AI Алина»):
 *  2–10 файлов — альбом, подпись к первому (до 1024 знаков), длиннее — текст следом отдельным сообщением;
 *  один файл — фото/видео с подписью (до 1024), длиннее — файл, потом текст; без файлов — сообщение до 4096.
 * Ответ «не ok» — запрос отклонён, ничего не вышло; обрыв связи после отправки — «проверить вручную» (http.js).
 * Цифр просмотров Bot API не отдаёт — статистику канала смотрим в самом Telegram.
 */

const CAPTION = 1024, MESSAGE = 4096;

async function tg(token, method, payload = {}, files = []) {
  let body, headers;
  if (files.length) {
    body = new FormData();
    for (const [k, v] of Object.entries(payload)) if (v != null) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const [field, file] of files) body.append(field, await openAsBlob(file, { type: mime(file) }), path.basename(file));
  } else { body = JSON.stringify(payload); headers = { 'content-type': 'application/json' }; }
  const { body: r } = await call(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body, headers }, { timeout: 10 * 60_000 })
    .catch((e) => { if (e.body?.description) e.message = `Telegram ${method}: ${e.body.description}`; throw e; });
  if (!r.ok) throw notSent(`Telegram ${method}: ${r.description}`);
  return r.result;
}

export async function connectToken({ token, channel }) {
  token = String(token || '').trim();
  const ref = String(channel || '').trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '');
  if (!/^\d{5,}:[\w-]{30,}$/.test(token)) return { error: 'Это не похоже на ключ бота: он выглядит как 123456789:AA… (от @BotFather)' };
  if (!ref) return { error: 'Укажите канал: @имя или ссылку t.me/…' };
  try {
    const me = await tg(token, 'getMe');
    const chat = await tg(token, 'getChat', { chat_id: /^-?\d+$/.test(ref) ? ref : `@${ref}` });
    const member = await tg(token, 'getChatMember', { chat_id: chat.id, user_id: me.id });
    if (member.status !== 'administrator' || member.can_post_messages === false) {
      return { error: `Добавьте @${me.username} в администраторы канала «${chat.title}» с правом публиковать сообщения и нажмите ещё раз` };
    }
    saveAccount('telegram', { title: `${chat.title}${chat.username ? ` (@${chat.username})` : ''}`, secret: { token, chat: String(chat.id), username: chat.username || null, bot: me.username } });
    return { ok: true, title: chat.title };
  } catch (e) { return { error: `Telegram: ${e.message}` }; }
}

async function publish({ account: acc, files, caption, cover = {} }) {
  const { token, chat, username } = acc.secret;
  const link = (m) => (username ? `https://t.me/${username}/${m.message_id}` : null);
  const kb = listenButtons();
  // кнопки — под сообщением с подписью; у альбома их не бывает, поэтому подпись альбома с кнопками идёт отдельным сообщением
  const text = (t) => tg(token, 'sendMessage', { chat_id: chat, text: t, link_preview_options: { is_disabled: false }, ...(kb ? { reply_markup: kb } : {}) });
  let first;
  if (files.length >= 2) {
    const short = caption.length <= CAPTION && !kb;
    const media = files.map((f, i) => ({ type: isVideo(f) ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 && short && caption ? { caption } : {}) }));
    [first] = await tg(token, 'sendMediaGroup', { chat_id: chat, media }, files.map((f, i) => [`f${i}`, f]));
    if (!short) await text(caption);
  } else if (files.length === 1) {
    const [f] = files, video = isVideo(f), short = caption.length <= CAPTION;
    // Обложка видео — Bot API 8.3 (sendVideo cover): своя картинка или кадр. В альбомах не ставим.
    const cov = video ? await coverFile(f, cover) : null;
    first = await tg(token, video ? 'sendVideo' : 'sendPhoto', { chat_id: chat, ...(short && caption ? { caption } : {}), ...(short && kb ? { reply_markup: kb } : {}), ...(video ? { supports_streaming: true } : {}), ...(cov ? { cover: 'attach://cover' } : {}) },
      [[video ? 'video' : 'photo', f], ...(cov ? [['cover', cov]] : [])]);
    if (!short) await text(caption);
  } else first = await text(caption);
  return { id: String(first.message_id), url: link(first) };
}

/* Проверка без публики: бот всё ещё админ канала с правом публиковать; проверочное фото — в личку проверяющему. */
async function test({ account: acc, image, me }) {
  const { token, chat } = acc.secret;
  const bot = await tg(token, 'getMe');
  const member = await tg(token, 'getChatMember', { chat_id: chat, user_id: bot.id });
  if (member.status !== 'administrator' || member.can_post_messages === false) throw notSent(`@${bot.username} больше не админ канала с правом публиковать`);
  if (!me?.tg_chat_id) return 'бот — админ канала с правом публиковать (подключите свои уведомления — пришлю проверочное фото в личку)';
  await tg(token, 'sendPhoto', { chat_id: me.tg_chat_id, caption: 'Глашатай · проверка: так фото с подписью уйдёт в канал.' }, [['photo', image]]);
  return 'бот — админ канала с правом публиковать; проверочное фото — у вас в личке';
}

async function followers(acc) {
  return { count: await tg(acc.secret.token, 'getChatMemberCount', { chat_id: acc.secret.chat }) };
}

/* Просмотры: Bot API их не отдаёт, но у открытого канала они видны на встраиваемой странице поста. «1.2K» → 1200. */
async function stats({ target, account: acc }) {
  if (!acc.secret.username) return null;
  const html = await (await fetch(`https://t.me/${acc.secret.username}/${target.remote_id}?embed=1&mode=tme`, { signal: AbortSignal.timeout(20_000) })).text();
  const raw = html.match(/tgme_widget_message_views">([^<]+)</)?.[1];
  if (!raw) return null;
  const n = parseFloat(raw.replace(',', '.')) * ({ K: 1e3, M: 1e6 }[raw.trim().slice(-1)] || 1);
  return { views: Math.round(n) };
}

export default {
  title: 'Telegram', color: '#2aabee', publish, connectToken, test, followers, stats,
  connect: 'token',
  fields: [['token', 'Ключ бота (от @BotFather)'], ['channel', 'Канал: @имя или t.me/…']],
  setup: 'Пять минут. Подойдёт тот же бот, что для уведомлений, или отдельный.',
  steps: [
    'В Telegram у <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>: /newbot → имя «Глашатай» → скопируйте ключ (или возьмите ключ уже созданного бота).',
    'Откройте канал группы → Управление каналом → <b>Администраторы → Добавить администратора</b> → найдите бота по имени → оставьте право <b>«Публикация сообщений»</b> → Сохранить.',
    'Вставьте ниже ключ бота и канал (@имя канала или ссылку t.me/…; для закрытого канала — его id, начинается с -100) → «Подключить». Сервис сам проверит, что бот — админ с правом публиковать.',
  ],
  formats: {
    post: { title: 'Пост', auto: true, cover: ['frame', 'image'], caption: 'auto', manual: ['Скачать файлы', 'Telegram → канал → вставить файлы и подпись', 'Опубликовать и вставить сюда ссылку на пост'], rules: { media: 'any', maxFiles: 10, maxMB: 50, needsText: true, maxCaption: MESSAGE },
      hint: 'Текст, фото, ролик или альбом до 10 файлов. Подпись до 1024 знаков — под файлом, длиннее — отдельным сообщением следом. Файлы до 50 МБ.' },
  },
};
