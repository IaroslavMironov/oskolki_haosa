import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { call, form } from './http.js';
import { saveAccount } from '../secrets.js';
import { notSent } from '../publish.js';
import { isVideo, mime } from '../media.js';

/*
 * VK: стена и истории сообщества. Основа — Нейро-продюсер (src/channels/vk.js).
 * Разведка 17.11.2026 (docs/площадки.md):
 *  — клипов в открытом API нет (shortVideo.* не документированы и работают только у приложений VK) → клип = пакет, выкладываем руками;
 *  — обычное видео (video.save) — только ключ пользователя с правом video, его VK даёт «в исключительных случаях» через поддержку → пакет;
 *  — истории — ключ сообщества с правом «истории» подходит;
 *  — wall.post и загрузка фото на стену по схеме API — ключ пользователя, но Нейро-продюсер публикует ключом сообщества.
 *    Проверить первым живым постом; отказ VK придёт понятной ошибкой «Ошибка», пост не выйдет дважды.
 */

const V = '5.199';

export async function vk(method, params, token, opts = { safe: true }) {
  const { body } = await call(`https://api.vk.com/method/${method}`, { method: 'POST', body: form({ ...params, access_token: token, v: V }) }, opts);
  if (body.error) {
    const code = body.error.error_code;
    const hint = { 5: ' — ключ недействителен, подключите заново', 15: ' — у ключа нет прав на это действие', 27: ' — этот метод не работает с ключом сообщества', 214: ' — публикация запрещена настройками сообщества' }[code] || '';
    const e = notSent(`VK ${method}: ${body.error.error_msg} (${code})${hint}`);
    e.auth = code === 5;
    throw e;
  }
  return body.response;
}

async function upload(url, field, file) {
  const fd = new FormData();
  fd.append(field, await openAsBlob(file, { type: mime(file) }), path.basename(file));
  const { body } = await call(url, { method: 'POST', body: fd }, { safe: true, timeout: 10 * 60_000 });
  if (body.error) throw notSent(`VK не принял файл: ${typeof body.error === 'string' ? body.error : JSON.stringify(body.error)}`);
  return body;
}

async function wallPhoto(gid, token, file) {
  const server = await vk('photos.getWallUploadServer', { group_id: gid }, token);
  const up = await upload(server.upload_url, 'photo', file);
  const [saved] = await vk('photos.saveWallPhoto', { group_id: gid, photo: up.photo, server: up.server, hash: up.hash }, token);
  return `photo${saved.owner_id}_${saved.id}`;
}

/*
 * Ключ сообщества сам знает своё сообщество: groups.getById без group_id вернёт его.
 * Поэтому id можно не вводить; если ввели — подойдут цифры, ссылка vk.com/… или короткое имя.
 */
export async function connectToken({ token, group }) {
  token = String(token || '').trim();
  if (!token) return { error: 'Вставьте ключ доступа сообщества' };
  const ref = String(group || process.env.VK_GROUP_ID || '').trim().replace(/^(https?:\/\/)?(m\.)?vk\.(com|ru)\//, '').replace(/[/?#].*$/, '').replace(/^(club|public)(?=\d+$)/, '');
  try {
    const r = await vk('groups.getById', ref ? { group_id: ref } : {}, token);
    const g = r.groups?.[0] || r[0];
    if (!g?.id) return { error: 'VK не сказал, какое это сообщество — вставьте ссылку на него во второе поле' };
    saveAccount('vk', { title: g.name, secret: { token, gid: String(g.id) } });
    return { ok: true, title: g.name };
  } catch (e) { return { error: `VK не принял ключ: ${e.message}` }; }
}

async function publish({ account: acc, format, files, caption, progress }) {
  const { token, gid } = acc.secret;
  if (format === 'post') {
    const attachments = [];
    for (const f of files) { progress(`загружаю ${path.basename(f)}`); attachments.push(await wallPhoto(gid, token, f)); }
    // Отправка самого поста: 4xx/ошибка VK — не вышел; обрыв связи — «проверить вручную».
    const r = await vk('wall.post', { owner_id: `-${gid}`, from_group: 1, message: caption, attachments: attachments.join(',') || null }, token, {});
    return { id: String(r.post_id), url: `https://vk.com/wall-${gid}_${r.post_id}` };
  }
  if (format === 'story') {
    const [file] = files;
    const video = isVideo(file);
    const server = await vk(video ? 'stories.getVideoUploadServer' : 'stories.getPhotoUploadServer', { group_id: gid, add_to_news: 1 }, token);
    progress('загружаю историю');
    const up = await upload(server.upload_url, video ? 'video_file' : 'file', file);
    const result = up.response?.upload_result || up.upload_result;
    if (!result) throw notSent('VK не вернул результат загрузки истории');
    const r = await vk('stories.save', { upload_results: result }, token, {});
    const s = r.items?.[0];
    return { id: s ? `${s.owner_id}_${s.id}` : null, url: s ? `https://vk.com/story${s.owner_id}_${s.id}` : null };
  }
  throw notSent(`VK: формат «${format}» публикуется только вручную`);
}

/* Цифры поста: просмотры, лайки, репосты, комментарии. */
async function stats({ target, account: acc }) {
  if (target.format !== 'post') return null;
  const [p] = await vk('wall.getById', { posts: `-${acc.secret.gid}_${target.remote_id}` }, acc.secret.token).then((r) => r.items || r);
  return p ? { views: p.views?.count ?? 0, likes: p.likes?.count ?? 0, comments: p.comments?.count ?? 0, shares: p.reposts?.count ?? 0 } : null;
}

export default {
  title: 'ВКонтакте', color: '#4c8dff', publish, stats, connectToken,
  connect: 'token',
  fields: [['token', 'Ключ доступа сообщества'], ['group', 'Ссылка на сообщество (можно пусто)']],
  setup: 'Пять минут, нужен админ сообщества.',
  steps: [
    'Откройте сообщество → <b>Управление → Работа с API → Ключи доступа → Создать ключ</b>.',
    'Отметьте права: <b>управление сообществом, фотографии, истории</b> → Создать, подтвердите кодом.',
    'Ключ показывается один раз — сразу вставьте его в поле ниже. Сообщество сервис узнает по ключу сам; второе поле — только если VK не ответит (тогда вставьте ссылку на сообщество, например vk.com/oskolkihaosa).',
    'После подключения опубликуйте первый пост и проверьте, что он вышел: публикацию ключом сообщества VK официально не описывает.',
  ],
  formats: {
    post: { title: 'Пост', auto: true, rules: { media: 'images', maxImages: 10, needsText: true, maxCaption: 15000, allowEmpty: true },
      hint: 'Текст и до 10 картинок. Трек из VK Музыки к посту API прикрепить не даёт — релизный пост выкладывайте вручную.' },
    story: { title: 'История', auto: true, rules: { media: 'any', maxFiles: 1, maxSec: 60, vertical: true },
      hint: 'Картинка или ролик до 60 с, сразу в ленту историй.' },
    clip: { title: 'Клип', auto: false, rules: { media: 'video', vertical: true, maxSec: 180 },
      hint: 'Клипы VK по API не публикуются (открытого метода нет). Сервис напомнит в срок: скачайте ролик и подпись из «Пакета», выложите в приложении VK и вставьте ссылку.' },
    video: { title: 'Видео в пост', auto: false, rules: { media: 'video' },
      hint: 'Загрузка видео по API — только с особым правом от поддержки VK. Пока — вручную по «Пакету».' },
  },
};
