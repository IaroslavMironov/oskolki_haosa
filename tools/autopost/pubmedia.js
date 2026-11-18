import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { notSent } from './publish.js';
import { setting } from './secrets.js';

/*
 * Публичная ссылка на файл. Instagram (и фото в TikTok) забирают видео и картинки сами, по https-адресу —
 * загрузки файла напрямую для «входа через Instagram» нет (разведка 17.11.2026).
 *
 * MEDIA_SCP_TARGET — куда скопировать (например сервер:/var/www/oskolki-media/),
 * MEDIA_PUBLIC_URL — откуда он виден снаружи (https://oskolkihaosa.ru/m/).
 * Имя файла — хэш содержимого: ссылку не угадать, повторная выкладка того же файла ничего не копирует.
 *
 * ponytail: старые файлы не чистятся — раз в полгода `find … -mtime +30 -delete` на сервере, если места станет мало.
 */

const exec = promisify(execFile);
const done = new Map();

/** Куда класть и откуда видно — из настроек («Сервис → Публичная папка»). Нет — null: картинки в Instagram идут вручную. */
export function publicTarget() {
  const base = setting('MEDIA_PUBLIC_URL'), target = setting('MEDIA_SCP_TARGET');
  return base && target ? { base, target } : null;
}

export async function publicUrl(file) {
  const pt = publicTarget();
  if (!pt) throw notSent('Instagram забирает картинки только по ссылке, а публичной папки нет — выложите вручную («Пакет»)');
  const { base, target } = pt;
  const { mtimeMs, size } = statSync(file);
  const key = `${file}:${mtimeMs}:${size}:${base}`;
  if (done.has(key)) return done.get(key);
  const name = crypto.createHash('sha256').update(key).digest('hex').slice(0, 24) + path.extname(file).toLowerCase();
  try {
    // «сервер:/папка/» — копируем по scp (с ноутбука); просто «/папка/» — сервис сам на сервере, кладём рядом.
    if (target.includes(':')) await exec('scp', ['-q', '-o', 'BatchMode=yes', file, `${target.replace(/\/?$/, '/')}${name}`], { timeout: 10 * 60_000 });
    else { mkdirSync(target, { recursive: true }); copyFileSync(file, path.join(target, name)); }
  } catch (e) { throw notSent(`не удалось выложить файл в публичную папку: ${e.stderr || e.message}`); }
  const url = `${base.replace(/\/?$/, '/')}${name}`;
  // Проверяем, что файл виден снаружи: иначе площадка получит битую ссылку.
  const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!r?.ok) throw notSent(`файл выложен, но не открывается по ${url} (${r?.status || 'нет ответа'})`);
  done.set(key, url);
  return url;
}
