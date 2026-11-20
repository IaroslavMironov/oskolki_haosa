import crypto from 'node:crypto';
import { statSync, openAsBlob } from 'node:fs';
import { coverFile } from '../media.js';
import { call, form, hashtags } from './http.js';
import { saveAccount, setting, rememberLogin, loginVerifier, forgetLogin } from '../secrets.js';
import { notSent } from '../publish.js';

/*
 * YouTube Shorts: Data API v3, вход Google OAuth (Desktop-клиент, адрес localhost, PKCE).
 * Разведка 17.11.2026 (docs/площадки.md):
 *  — с 02.11.2026 видео от непроверенных приложений больше не запираются в «приватные» — аудит не нужен;
 *  — videos.insert — своя квота 100 загрузок в сутки;
 *  — Short = вертикальный или квадратный ролик до 3 минут, отдельного флага в API нет;
 *  — экран согласия держать «In production» (без проверки): в режиме Testing ключ обновления живёт 7 дней.
 */

// force-ssl — комментарии от имени канала (и правка видео). Добавлено 17.11.2026: старый вход без него — комментарий уйдёт в ручные задачи.
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl';
const cfg = () => {
  const id = setting('YT_CLIENT_ID'), secret = setting('YT_CLIENT_SECRET');
  if (!id || !secret) throw new Error('сначала вставьте Client ID и Client secret приложения Google («Площадки → YouTube → Настройка»)');
  return { id, secret };
};

/** Ответы Google при входе — по-человечески. */
function googleError(e) {
  const code = e.body?.error;
  if (code === 'invalid_client') return 'Google не узнаёт приложение: новый клиент включается от 5 минут до нескольких часов после создания — подождите и нажмите «Войти» ещё раз. Если не помогло — проверьте, что Client ID и Client secret скопированы из одного и того же клиента.';
  if (code === 'invalid_grant') return 'код входа уже использован или устарел — нажмите «Войти» ещё раз';
  if (code === 'redirect_uri_mismatch') return 'адрес возврата не совпал: для кабинета на ноутбуке нужен клиент типа Desktop app';
  return e.message;
}

export const oauth = {
  start(redirect) {
    const { id } = cfg();
    const state = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url');
    rememberLogin(state, verifier);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES,
      access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
  },
  async callback(params, redirect) {
    if (params.get('error')) throw new Error(params.get('error'));
    const verifier = loginVerifier(params.get('state'));
    if (!verifier) throw new Error(params.get('state') ? 'ссылка входа устарела (прошло больше 15 минут) — нажмите «Войти» ещё раз' : 'площадка вернула без state — нажмите «Войти» ещё раз');
    const { id, secret } = cfg();
    const tok = await call('https://oauth2.googleapis.com/token', { method: 'POST',
      body: form({ grant_type: 'authorization_code', code: params.get('code'), code_verifier: verifier, client_id: id, client_secret: secret, redirect_uri: redirect }) }, { safe: true })
      .then((r) => r.body, (e) => { throw new Error(googleError(e)); });
    if (!tok.refresh_token) throw new Error('Google не выдал ключ обновления — отзовите доступ в myaccount.google.com/permissions и войдите снова');
    const { body: ch } = await call('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${tok.access_token}` } }, { safe: true });
    const title = ch.items?.[0]?.snippet?.title || 'канал';
    forgetLogin(params.get('state'));
    saveAccount('youtube', { title, secret: { refresh: tok.refresh_token, access: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000, channel: ch.items?.[0]?.id } });
    return { title };
  },
};

/** Свежий ключ доступа (живёт час) по ключу обновления. */
async function token(acc) {
  const s = acc.secret;
  if (s.access && s.until > Date.now()) return s.access;
  const { id, secret } = cfg();
  try {
    const { body } = await call('https://oauth2.googleapis.com/token', { method: 'POST',
      body: form({ grant_type: 'refresh_token', refresh_token: s.refresh, client_id: id, client_secret: secret }) }, { safe: true });
    saveAccount('youtube', { title: acc.title, secret: { ...s, access: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 } });
    return body.access_token;
  } catch (e) {
    if (e.body?.error === 'invalid_grant') throw Object.assign(notSent('вход в YouTube истёк — подключите канал заново'), { auth: true });
    throw e;
  }
}

async function publish({ account: acc, files: [file], caption, title, progress, private: priv = false, cover = {} }) {
  const access = await token(acc);
  const tags = hashtags(caption).slice(0, 15);
  // Название — до 100 знаков без < >; описание — до 5000 байт.
  const meta = {
    snippet: { title: title.replace(/[<>]/g, '').slice(0, 100), description: caption.replace(/[<>]/g, ''), tags, categoryId: '10', defaultLanguage: 'ru', defaultAudioLanguage: 'ru' },
    // Музыка и ролики группы сделаны нейросетями — честная пометка «изменённый/синтетический контент».
    status: { privacyStatus: priv ? 'private' : 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: process.env.YT_SYNTHETIC !== '0' },
  };
  const size = statSync(file).size;
  progress('открываю загрузку');
  const { res } = await call('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', body: JSON.stringify(meta),
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
  }, { safe: true });
  const session = res.headers.get('location');
  if (!session) throw notSent('YouTube не дал адрес загрузки');
  progress(`загружаю ${(size / 1048576).toFixed(1)} МБ`);
  // ponytail: одним запросом, без докачки (308/Range) — ролики по 10–30 МБ; докачку — если связь с Google начнёт рваться.
  const { body: video } = await call(session, { method: 'PUT', body: await openAsBlob(file), headers: { 'content-type': 'video/mp4' } }, { timeout: 15 * 60_000 });
  const note = cover.image || cover.sec != null ? await setCover(access, video.id, file, cover, progress) : '';
  return { id: video.id, url: `https://youtube.com/shorts/${video.id}`, note };
}

/*
 * Обложка Shorts: thumbnails.set — с 03.11.2026 и для Shorts, но только после обработки ролика.
 * Ждём обработку до 4 минут; не дождались или YouTube отказал — ролик уже вышел, обложку можно поставить в Studio.
 * Нужны «расширенные функции» канала (подтверждённый телефон), иначе YouTube отвечает 403.
 */
async function setCover(access, id, file, cover, progress) {
  const img = await coverFile(file, cover);
  for (let i = 0; i < 24; i++) {
    const { body } = await call(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${id}`, { headers: { authorization: `Bearer ${access}` } }, { safe: true });
    const st = body.items?.[0]?.processingDetails?.processingStatus;
    if (st === 'succeeded') break;
    if (st === 'failed' || st === 'terminated') return 'обложка не поставлена: YouTube не обработал ролик';
    progress(`YouTube обрабатывает ролик перед обложкой… ${i * 10} с`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  try {
    await call(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'image/jpeg' }, body: await openAsBlob(img) }, { safe: true });
    return 'обложка поставлена';
  } catch (e) {
    return e.status === 403 ? 'обложка не поставлена: включите «расширенные функции» канала (YouTube Studio → Настройки → Канал → Доступные функции)' : `обложка не поставлена: ${e.message}`;
  }
}

async function stats({ target, account: acc }) {
  const { body } = await call(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${target.remote_id}`, { headers: { authorization: `Bearer ${await token(acc)}` } }, { safe: true });
  const s = body.items?.[0]?.statistics || {};
  return { views: +s.viewCount || 0, likes: +s.likeCount || 0, comments: +s.commentCount || 0 };
}

/* Проверка без публики: настоящая загрузка, но приватно — видно только владельцу канала. */
async function test({ account: acc, video }) {
  const r = await publish({ account: acc, files: [video], caption: 'Проверка Глашатая — приватное видео, можно удалить.', title: 'Глашатай · проверка (приватное)', progress: () => {}, private: true });
  return `ролик загрузился приватным (${r.url}) — виден только вам, удалите в YouTube Studio`;
}

/* Первый комментарий от имени канала. Закрепить через API нельзя — это ручная задача. */
async function comment({ account: acc, id, text }) {
  try {
    await call('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet', { method: 'POST', headers: { authorization: `Bearer ${await token(acc)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ snippet: { videoId: id, topLevelComment: { snippet: { textOriginal: text } } } }) }, { safe: true });
  } catch (e) {
    throw new Error(e.status === 403 ? 'YouTube не дал оставить комментарий — войдите в YouTube в Глашатае заново (нужно право на комментарии)' : e.message);
  }
}

/* «Ворожея отвечает»: верхние комментарии под роликом и ответ веткой (право youtube.force-ssl). */
export const oracle = {
  async list(acc, video) {
    const { body } = await call(`https://www.googleapis.com/youtube/v3/commentThreads?${form({ part: 'snippet', videoId: video, order: 'time', maxResults: 50, textFormat: 'plainText' })}`,
      { headers: { authorization: `Bearer ${await token(acc)}` } }, { safe: true });
    return (body.items || []).map((t) => {
      const s = t.snippet.topLevelComment.snippet;
      return { id: t.id, text: s.textOriginal, author: s.authorChannelId?.value || s.authorDisplayName, own: s.authorChannelId?.value === acc.secret.channel };
    });
  },
  async reply(acc, thread, text) {
    try {
      const { body } = await call('https://www.googleapis.com/youtube/v3/comments?part=snippet', { method: 'POST', headers: { authorization: `Bearer ${await token(acc)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ snippet: { parentId: thread, textOriginal: text } }) }, { safe: true });
      return body.id;
    } catch (e) {
      throw new Error(e.status === 403 ? 'YouTube не дал ответить — войдите в YouTube в Глашатае заново (нужно право на комментарии)' : e.message);
    }
  },
};

async function followers(acc) {
  const { body } = await call('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: { authorization: `Bearer ${await token(acc)}` } }, { safe: true });
  const s = body.items?.[0]?.statistics || {};
  return { count: +s.subscriberCount || 0, views: +s.viewCount || 0, posts: +s.videoCount || 0 };
}

export default {
  title: 'YouTube', color: '#ff3b3b', oauth, publish, stats, test, followers, comment, oracle,
  loopback: 'http://localhost:4777/oauth/youtube/callback',
  setup: 'Один раз, ≈15 минут, под Google-аккаунтом, которому принадлежит канал группы.',
  app: [['YT_CLIENT_ID', 'Client ID'], ['YT_CLIENT_SECRET', 'Client secret', true]],
  steps: [
    'Откройте <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> под аккаунтом канала и создайте проект «Глашатай».',
    'Включите <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">YouTube Data API v3</a> → Enable.',
    '<a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a> → Get started: название «Глашатай», ваша почта, тип <b>External</b>.',
    'Там же <b>Audience → Publish app</b> (статус «In production»). Проверку проходить не нужно, а без этого вход слетает каждые 7 дней.',
    '<b>Clients → Create client</b>: на ноутбуке — тип <b>Desktop app</b>; на сервере — <b>Web application</b> с адресом <code>{redirect}</code>.',
    'Скопируйте Client ID и Client secret в поля ниже → «Сохранить» → «Войти». Google предупредит, что приложение не проверено: <b>Advanced → Go to Глашатай</b> — это ваше же приложение.',
  ],
  connect: 'oauth',
  formats: {
    short: { title: 'Shorts', auto: true, comment: 'auto', cover: ['frame', 'image'], caption: 'auto', manual: ['Скачать ролик', 'YouTube Studio → Создать → Загрузить: название, описание, обложка', 'Опубликовать и нажать «✓ Выложил»'], rules: { media: 'video', vertical: true, maxSec: 180, maxCaption: 2400, title: true },
      hint: 'Публикуется сразу публично. Название — до 100 знаков, описание — до ~2400 знаков кириллицы (5000 байт), хэштеги из подписи уходят в теги.' },
  },
};

