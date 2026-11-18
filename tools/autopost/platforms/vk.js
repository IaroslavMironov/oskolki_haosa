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
    // 5 у VK — и «ключ отозван», и «метод только для ключа пользователя»: по одной ошибке ключ не браковать.
    const hint = { 5: ' — VK не пускает с этим ключом (метод только для ключа пользователя или ключ отозван)', 15: ' — у ключа нет прав на это действие', 27: ' — этот метод не работает с ключом сообщества', 214: ' — публикация запрещена настройками сообщества' }[code] || '';
    throw notSent(`VK ${method}: ${body.error.error_msg} (${code})${hint}`);
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

/*
 * Фото на стену (getWallUploadServer) — только ключом пользователя. Проверено 17.11.2026:
 * ключом сообщества ошибка 27, а фото, загруженное «для сообщений», VK молча выкидывает из поста.
 * Поэтому с ключом сообщества посты с картинками идут «вручную» (rules.autoNoMedia), здесь — путь для ключа пользователя.
 */
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

/* Подписчики сообщества. Просмотры постов ключом сообщества VK не отдаёт (wall.getById/stats.get — ошибка 27). */
async function followers(acc) {
  const r = await vk('groups.getById', { group_id: acc.secret.gid, fields: 'members_count' }, acc.secret.token);
  return { count: (r.groups?.[0] || r[0]).members_count };
}

/* Проверка без публики: отложенный текстовый пост на год вперёд (виден только админам). */
async function test({ account: acc }) {
  const { token, gid } = acc.secret;
  const r = await vk('wall.post', { owner_id: `-${gid}`, from_group: 1, message: 'Глашатай · проверка (удалите)',
    publish_date: Math.floor(Date.now() / 1000) + 300 * 86400 }, token);
  // Удалять посты ключом сообщества VK не даёт — проверочный остаётся в «Отложенных» (подписчики его не видят).
  return `текстовый пост создан отложенным на год вперёд (№${r.post_id}) — подписчики его не видят; удалите его в «Отложенных записях» сообщества`;
}

export default {
  title: 'ВКонтакте', color: '#4c8dff', publish, followers, connectToken, test,
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
    post: { title: 'Пост', auto: true, cover: [], caption: 'auto', manual: ['Скачать картинки', 'VK → сообщество → «Создать запись»: текст и картинки (для релиза — прикрепить трек из VK Музыки)', 'Опубликовать и вставить сюда ссылку на запись'], rules: { media: 'images', maxImages: 10, needsText: true, maxCaption: 15000, allowEmpty: true, autoNoMedia: true },
      hint: 'Автоматом — только текст: картинки ключом сообщества VK загрузить не даёт (проверено). Пост с картинками — «вручную»: Глашатай напомнит и даст картинку с подписью. Трек из VK Музыки тоже прикрепляется вручную.' },
    story: { title: 'История', auto: true, cover: [], caption: 'none', manual: ['Скачать файл', 'VK → сообщество → История: файл', 'Опубликовать и отметить здесь'], rules: { media: 'any', maxFiles: 1, maxSec: 60, vertical: true },
      hint: 'Картинка или ролик до 60 с, сразу в ленту историй.' },
    clip: { title: 'Клип', auto: false, comment: 'manual', cover: [], caption: 'auto', manual: ['Скачать ролик', 'VK → Клипы → Загрузить: ролик, описание, обложку выбрать в VK', 'Опубликовать и вставить сюда ссылку на клип'], rules: { media: 'video', vertical: true, maxSec: 180 },
      hint: 'Клипы VK по API не публикуются (открытого метода нет). Сервис напомнит в срок: скачайте ролик и подпись из «Пакета», выложите в приложении VK и вставьте ссылку.' },
    video: { title: 'Видео в пост', auto: false, comment: 'manual', cover: [], caption: 'auto', manual: ['Скачать ролик', 'VK → сообщество → Видео → Загрузить: название, описание, обложка; затем прикрепить к записи', 'Опубликовать и вставить сюда ссылку'], rules: { media: 'video' },
      hint: 'Загрузка видео по API — только с особым правом от поддержки VK. Пока — вручную по «Пакету».' },
  },
};
