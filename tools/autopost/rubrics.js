import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { all, run, log, db, DATA } from './db.js';
import { REPO } from './media.js';

/*
 * Рубрики — контент, который сервис делает сам. Сейчас одна: «Пророчество дня».
 * Пророчества — те же 42, что в гадании на сайте (data.js), по кругу без повторов.
 * Картинка — шаблон web/tpl/prophecy.html, снимок делает Chrome без окна (уже стоит на маке, без библиотек).
 * Посты создаются ЧЕРНОВИКАМИ: в очередь их ставит человек — от имени группы выходит только одобренное.
 */

const exec = promisify(execFile);
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RELEASE = 'пророчество-дня';
const MSK = 3 * 3600_000;

export function prophecies() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(path.join(REPO, 'data.js'), 'utf8'), ctx);
  return ctx.window.CODEX.prophecies.map((p) => (typeof p === 'string' ? { card: 'Пророчество', text: p } : p));
}

/** Картинка 1080×1350 JPEG (Instagram принимает только JPEG). */
export async function renderProphecy(p, port) {
  const name = `prophecy-${Date.now()}`;
  const png = path.join(DATA, 'media', `${name}.png`), jpg = path.join(DATA, 'media', `${name}.jpg`);
  const url = `http://localhost:${port}/tpl/prophecy.html?${new URLSearchParams({ card: p.card, text: p.text })}`;
  await exec(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1350',
    `--screenshot=${png}`, '--virtual-time-budget=6000', url], { timeout: 60_000 }).catch((e) => {
    throw new Error(e.code === 'ENOENT' ? 'здесь нет Chrome, чтобы нарисовать картинку (CHROME_BIN) — рубрику пока запускайте с ноутбука' : `Chrome: ${e.message}`);
  });
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', png, '-q:v', '2', jpg]);
  rmSync(png);
  return path.relative(REPO, jpg);
}

export const caption = (p) => `🔮 Пророчество дня · ${p.card}\n«${p.text}»\n\nЭто — для всех. Своё вытяни у Ворожеи: oskolkihaosa.ru\n#осколкихаоса #пророчестводня #ворожея`;

/** Черновики на days дней вперёд (с завтрашнего), в hour по Москве. Дни, где пророчество уже есть, пропускает. */
export async function planProphecies({ days = 7, hour = '10:00', port }) {
  const list = prophecies();
  const existing = all('select p.note, t.planned_at from posts p left join targets t on t.post_id=p.id where p.release=?', RELEASE);
  const usedDays = new Set(existing.filter((e) => e.planned_at).map((e) => new Date(Date.parse(e.planned_at) + MSK).toISOString().slice(0, 10)));
  // По кругу: сначала те, что ещё не выходили; круг кончился — всё заново.
  const used = new Set(existing.map((e) => e.note));
  let queue = list.filter((p) => !used.has(`${p.card}|${p.text}`));
  const created = [];
  for (let d = 1; d <= days; d++) {
    const date = new Date(Date.now() + MSK + d * 864e5).toISOString().slice(0, 10);
    if (usedDays.has(date)) continue;
    if (!queue.length) queue = [...list];
    const p = queue.splice(Math.floor(Math.random() * queue.length), 1)[0];
    const img = await renderProphecy(p, port);
    const at = new Date(`${date}T${hour}:00+03:00`).toISOString();
    db.exec('begin');
    const id = Number(run('insert into posts (title, kind, caption, media, release, note) values (?,?,?,?,?,?)',
      `Пророчество дня: ${p.card}`, 'image', caption(p), JSON.stringify([img]), RELEASE, `${p.card}|${p.text}`).lastInsertRowid);
    for (const [platform, format] of [['vk', 'post'], ['instagram', 'image']]) {
      run('insert into targets (post_id, platform, format, planned_at) values (?,?,?,?)', id, platform, format, at);
    }
    db.exec('commit');
    created.push(id);
  }
  if (created.length) log(`рубрика «Пророчество дня»: ${created.length} черновиков`);
  return { created: created.length };
}
