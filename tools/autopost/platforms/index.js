import vk from './vk.js';
import youtube from './youtube.js';
import instagram from './instagram.js';
import tiktok from './tiktok.js';
import telegram from './telegram.js';

/*
 * Площадки. У каждой: title, color, formats { код: { title, auto, rules, hint } }, publish(ctx) → { id, url, note },
 * по желанию stats(), maintain() (продление ключа), oauth { start, callback } или connectToken(body).
 * auto: false — площадка не даёт публиковать этот формат по API: сервис готовит пакет, человек выкладывает сам.
 */
export const PLATFORMS = { vk, telegram, youtube, instagram, tiktok };
