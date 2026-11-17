import { notSent } from '../publish.js';

/*
 * Общий вызов API площадок. Прокси для заблокированных из РФ площадок — штатный в Node:
 * NODE_USE_ENV_PROXY=1 + HTTPS_PROXY=… + NO_PROXY=vk.com,… (см. .env.example), без библиотек.
 *
 * Связь не установилась (запрос точно не ушёл) → notSent: можно повторить.
 * Оборвалось после отправки → обычная ошибка: публикатор пометит «неясно, вышло ли».
 */

const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

export class ApiError extends Error {
  constructor(message, { status, body, auth = false } = {}) { super(message); this.status = status; this.body = body; this.auth = auth; }
}

/** fetch с понятной ошибкой. safe=true — запрос ничего не меняет (чтение, создание черновика): любую ошибку можно повторить. */
export async function call(url, opts = {}, { safe = false, timeout = 60_000 } = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const code = e.cause?.code || e.code;
    if (safe || NOT_CONNECTED.has(code)) throw notSent(`нет связи с ${new URL(url).host} (${code || e.name})`);
    throw new Error(`связь с ${new URL(url).host} оборвалась — неизвестно, дошёл ли запрос (${code || e.name})`);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = body.error?.message || body.error_description || body.error?.error_msg || body.message || body.raw || `HTTP ${res.status}`;
    const err = new ApiError(`${new URL(url).host}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, { status: res.status, body, auth: res.status === 401 });
    // 4xx — запрос отклонён, на площадке ничего не появилось. 5xx — сервер мог успеть что-то сделать.
    if (safe || (res.status >= 400 && res.status < 500)) err.notSent = true;
    throw err;
  }
  return { body, res };
}

export const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));

/** Хэштеги из подписи — в теги YouTube и т.п. */
export const hashtags = (text) => [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)))];
