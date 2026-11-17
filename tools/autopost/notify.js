import { setting } from './secrets.js';

/*
 * Уведомления в Telegram: что вышло, что выложить руками, что сломалось. Без TG_BOT_TOKEN и TG_CHAT_ID — молчим.
 * Бот — любой свой (@BotFather), чат — личка или группа участников, куда бот добавлен.
 * ponytail: ошибка отправки только пишется в консоль — уведомление не должно ронять публикацию.
 */
export async function notify(text, { strict = false } = {}) {
  const token = setting('TG_BOT_TOKEN'), chat = setting('TG_CHAT_ID');
  if (!token || !chat) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(15_000) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description);
  } catch (e) {
    if (strict) throw new Error(`Telegram: ${e.message}`);
    console.warn('telegram:', e.message);
  }
}
