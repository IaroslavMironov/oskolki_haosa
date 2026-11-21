import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { call, form } from './http.js';
import { saveAccount } from '../secrets.js';
import { notSent } from '../publish.js';
import { isVideo, mime } from '../media.js';
import { run, all } from '../db.js';
import { vkAdmin } from './vkid.js';

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

/*
 * Цифры постов и клипов — ключом администратора (VK ID): ключ сообщества их не отдаёт (ошибка 27).
 * Посты выкладывает человек, ссылку может не вставить — тогда ищем запись сами: ближайшая к плановому времени,
 * вышедшая не раньше чем за 6 часов до него и ещё не привязанная к другой публикации.
 * ponytail: сопоставление по времени; два поста одного вида в одни сутки могут перепутаться — тогда вставить ссылку руками.
 */
const REF = /(wall|clip|video)(-\d+_\d+)/;
async function findOwn(target, gid) {
  const clip = target.format === 'clip' || target.format === 'video';
  // Клипы сообщества video.get не отдаёт (count 0, 21.11) — находим их на стене: запись с вложением-клипом.
  const r = await vkAdmin('wall.get', { owner_id: `-${gid}`, count: 50 });
  if (!r) return null;
  const taken = new Set(all("select remote_id from targets where platform='vk' and (remote_id is not null or url is not null) and id<>?", target.id)
    .map((x) => REF.exec(x.remote_id || '')?.[0] || REF.exec(x.url || '')?.[0]));
  const plan = Date.parse(target.planned_at) / 1000, until = Date.parse(target.published_at || new Date().toISOString()) / 1000 + 7200;
  const vid = (x) => x.attachments?.find((a) => a.type === 'video')?.video;
  const best = (r.items || []).map((x) => ({ x, ref: clip ? (vid(x) ? `clip${vid(x).owner_id}_${vid(x).id}` : null) : vid(x)?.type === 'short_video' ? null : `wall-${gid}_${x.id}` }))
    .filter(({ ref }) => ref)
    .filter(({ x, ref }) => x.date >= plan - 6 * 3600 && x.date <= until && !taken.has(ref) && !x.is_pinned_duplicate)
    .sort((a, b) => Math.abs(a.x.date - plan) - Math.abs(b.x.date - plan))[0];
  if (!best) return null;
  run('update targets set remote_id=?, url=coalesce(url, ?) where id=?', best.ref, `https://vk.com/${best.ref}`, target.id);
  return best.ref;
}

async function stats({ target, account: acc }) {
  const gid = acc.secret.gid;
  const ref = REF.exec(target.remote_id || '')?.[0] || REF.exec(target.url || '')?.[0] || await findOwn(target, gid);
  if (!ref) return null;
  const [, kind, id] = REF.exec(ref);
  if (kind === 'wall') {
    // wall.getById сервисному ключу недоступен (ошибка 1051) — берём пост из ленты стены (последние 100 записей)
    const [owner, pid] = id.split('_');
    const r = await vkAdmin('wall.get', { owner_id: owner, count: 100 });
    const p = (r?.items || []).find((x) => String(x.id) === pid);
    if (!p) return null;
    const reach = await vkAdmin('stats.getPostReach', { owner_id: `-${gid}`, post_ids: id.split('_')[1] }).catch(() => null);
    const R = reach?.[0] || {};
    return { views: p.views?.count ?? null, likes: p.likes?.count ?? 0, comments: p.comments?.count ?? 0, shares: p.reposts?.count ?? 0,
      reach: R.reach_total ?? null, reach_subscribers: R.reach_subscribers ?? null };
  }
  const r = await vkAdmin('video.get', { videos: id });
  const v = r?.items?.[0];
  if (!v) return null;
  return { views: v.views ?? null, likes: v.likes?.count ?? 0, comments: v.comments ?? 0, shares: v.reposts?.count ?? 0 };
}

/** Сообщество по дням за 30 дней: охват, посетители, подписались/отписались. null — VK ID не подключён. */
export async function communityStats(acc) {
  const from = Math.floor(Date.now() / 1000) - 30 * 86400;
  const r = await vkAdmin('stats.get', { group_id: acc.secret.gid, timestamp_from: from, interval: 'day', extended: 1 });
  if (!r) return null;
  return r.map((d) => ({ day: new Date(d.period_from * 1000 + 3 * 3600e3).toISOString().slice(0, 10), reach: d.reach?.reach ?? 0, reach_subscribers: d.reach?.reach_subscribers ?? 0,
    visitors: d.visitors?.visitors ?? 0, views: d.visitors?.views ?? 0, subscribed: d.activity?.subscribed ?? 0, unsubscribed: d.activity?.unsubscribed ?? 0 }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/* Подписчики сообщества — ключом сообщества. */
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
  title: 'ВКонтакте', color: '#4c8dff', publish, followers, connectToken, test, stats,
  connect: 'token',
  fields: [['token', 'Ключ доступа сообщества'], ['group', 'Ссылка на сообщество (можно пусто)']],
  // цифры постов на стене без входа администратора: id.vk.ru → приложение «Глашатай» → Service token
  app: [['VK_SERVICE_TOKEN', 'Сервисный ключ приложения VK (цифры постов)', true]],
  setup: 'Пять минут, нужен админ сообщества.',
  steps: [
    'Откройте сообщество → <b>Управление → Работа с API → Ключи доступа → Создать ключ</b>.',
    'Отметьте права: <b>управление сообществом, фотографии, истории</b> → Создать, подтвердите кодом.',
    'Ключ показывается один раз — сразу вставьте его в поле ниже. Сообщество сервис узнает по ключу сам; второе поле — только если VK не ответит (тогда вставьте ссылку на сообщество, например vk.com/oskolkihaosa).',
    'После подключения опубликуйте первый пост и проверьте, что он вышел: публикацию ключом сообщества VK официально не описывает.',
  ],
  formats: {
    post: { title: 'Пост', auto: true, cover: [], caption: 'auto', manual: ['Скачать картинки', 'VK → сообщество → «Создать запись»: текст и картинки (для релиза — прикрепить трек из VK Музыки)', 'Опубликовать и нажать «✓ Выложил»'], rules: { media: 'images', maxImages: 10, needsText: true, maxCaption: 15000, allowEmpty: true, autoNoMedia: true },
      hint: 'Автоматом — только текст: картинки ключом сообщества VK загрузить не даёт (проверено). Пост с картинками — «вручную»: Глашатай напомнит и даст картинку с подписью. Трек из VK Музыки тоже прикрепляется вручную.' },
    story: { title: 'История', auto: true, cover: [], caption: 'none', manual: ['Скачать файл', 'VK → сообщество → История: файл', 'Опубликовать и нажать «✓ Выложил»'], rules: { media: 'any', maxFiles: 1, maxSec: 60, vertical: true },
      hint: 'Картинка или ролик до 60 с, сразу в ленту историй.' },
    clip: { title: 'Клип', auto: false, comment: 'manual', cover: [], caption: 'auto', manual: ['Скачать ролик', 'VK → Клипы → Загрузить: ролик, описание, обложку выбрать в VK', 'Опубликовать и нажать «✓ Выложил»'], rules: { media: 'video', vertical: true, maxSec: 180 },
      hint: 'Клипы VK по API не публикуются (открытого метода нет). Сервис напомнит в срок: скачайте ролик и подпись из «Пакета», выложите в приложении VK и вставьте ссылку.' },
    video: { title: 'Видео в пост', auto: false, comment: 'manual', cover: [], caption: 'auto', manual: ['Скачать ролик', 'VK → сообщество → Видео → Загрузить: название, описание, обложка; затем прикрепить к записи', 'Опубликовать и нажать «✓ Выложил»'], rules: { media: 'video' },
      hint: 'Загрузка видео по API — только с особым правом от поддержки VK. Пока — вручную по «Пакету».' },
  },
};
