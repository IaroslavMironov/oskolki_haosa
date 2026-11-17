import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, DATA } from './db.js';

/*
 * Файлы контента. В посте путь хранится относительно корня репозитория сайта (docs/контент/…)
 * или data/media/… для загруженного через кабинет. Наружу из этих двух папок — нельзя.
 */

export const REPO = path.resolve(ROOT, '../..');
const ALLOWED = [REPO, DATA].map((p) => path.resolve(p) + path.sep);
const exec = promisify(execFile);

export function abs(rel) {
  const p = path.resolve(REPO, rel);
  if (!ALLOWED.some((a) => p.startsWith(a))) throw new Error(`файл вне разрешённых папок: ${rel}`);
  return p;
}

export const isVideo = (p) => /\.(mp4|mov|m4v|webm)$/i.test(p);
export const isImage = (p) => /\.(jpe?g|png|webp)$/i.test(p);
export const mime = (p) => ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(p).toLowerCase()] || 'application/octet-stream';

const cache = new Map();
/** Размер, длительность, кадр. ffprobe есть — точные цифры; нет — только размер файла. */
export async function probe(rel) {
  const p = abs(rel);
  if (!existsSync(p)) return { missing: true };
  const { size, mtimeMs } = statSync(p);
  const k = `${p}:${mtimeMs}`;
  if (cache.has(k)) return cache.get(k);
  const info = { size, mb: +(size / 1048576).toFixed(1), video: isVideo(p), image: isImage(p) };
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration',
      '-of', 'json', p]);
    const j = JSON.parse(stdout);
    const v = j.streams.find((s) => s.codec_type === 'video');
    Object.assign(info, { width: v?.width, height: v?.height, codec: v?.codec_name, audio: j.streams.some((s) => s.codec_type === 'audio'),
      duration: info.video ? +(+j.format?.duration || 0).toFixed(1) : undefined });
  } catch { /* ffprobe нет — проверим только размер */ }
  cache.set(k, info);
  return info;
}

/*
 * Проверка файлов под правила формата площадки. rules (из platforms/*.js):
 * { media: 'video'|'image'|'images'|'any'|'none', minSec, maxSec, maxMB, maxImages, vertical, maxCaption }
 * Возвращает список проблем по-русски; пустой — можно публиковать.
 */
export async function check(rules, post, caption) {
  const out = [];
  if (!rules) return ['площадка не умеет такой формат'];
  const files = post.media;
  const videos = files.filter(isVideo), images = files.filter(isImage);
  if (rules.media === 'none' && files.length) out.push('этот формат без файлов');
  if (rules.media === 'video' && videos.length !== 1) out.push('нужен ровно один ролик');
  if (rules.media === 'image' && images.length !== 1) out.push('нужна одна картинка');
  if (rules.media === 'images' && ((!images.length && !rules.allowEmpty) || images.length !== files.length)) out.push(rules.allowEmpty ? 'сюда — только картинки (ролик — в клип или «вручную»)' : 'нужны только картинки');
  if (rules.maxFiles && files.length > rules.maxFiles) out.push(rules.maxFiles === 1 ? 'нужен один файл' : `файлов больше ${rules.maxFiles}`);
  if (rules.media === 'any' && rules.maxFiles && !files.length) out.push('нужен файл');
  if (rules.jpeg && images.some((f) => !/\.jpe?g$/i.test(f))) out.push('картинки только JPEG');
  if (rules.maxImages && images.length > rules.maxImages) out.push(`картинок больше ${rules.maxImages}`);
  if (rules.minImages && images.length < rules.minImages) out.push(`нужно хотя бы ${rules.minImages} картинки`);
  if (rules.maxCaption && caption.length > rules.maxCaption) out.push(`подпись длиннее ${rules.maxCaption} знаков (${caption.length})`);
  if (rules.needsText && !caption.trim() && !files.length) out.push('пустой пост');
  for (const f of files) {
    const i = await probe(f).catch((e) => ({ error: e.message }));
    if (i.error) { out.push(i.error); continue; }
    if (i.missing) { out.push(`нет файла ${f}`); continue; }
    if (rules.maxMB && i.mb > rules.maxMB) out.push(`${path.basename(f)}: ${i.mb} МБ, предел ${rules.maxMB}`);
    if (i.video && i.duration) {
      if (rules.maxSec && i.duration > rules.maxSec) out.push(`${path.basename(f)}: ${i.duration} с, предел ${rules.maxSec} с`);
      if (rules.minSec && i.duration < rules.minSec) out.push(`${path.basename(f)}: ${i.duration} с, нужно от ${rules.minSec} с`);
    }
    if (i.video && rules.vertical && i.width && i.width >= i.height) out.push(`${path.basename(f)}: ролик не вертикальный (${i.width}×${i.height})`);
  }
  return out;
}

/** Файлы для выбора в кабинете: готовый контент из docs/ и загруженное в data/media. */
export function listFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'исходники' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (isVideo(p) || isImage(p)) out.push(path.relative(REPO, p));
    }
  };
  for (const d of [path.join(REPO, 'docs'), path.join(DATA, 'media')]) if (existsSync(d)) walk(d);
  return out.sort();
}
