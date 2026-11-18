import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { db, run, all, log } from './db.js';
import { REPO } from './media.js';

/*
 * Загрузка контент-плана в Глашатай: npm run plan -- plans/<файл>.js
 * Посты плана (release = RELEASE файла) пересоздаются, кроме уже ушедших в работу. Всё — черновиками: в очередь ставит человек.
 * Заодно пишет человеческую версию плана в docs/контент/<…>/контент-план.md (out в файле плана).
 */

const file = process.argv[2];
if (!file) { console.log('npm run plan -- plans/<файл>.js'); process.exit(1); }
const { PLAN, RELEASE, OUT, COMMENT = null } = await import(pathToFileURL(path.resolve(file)).href);

const kind = (m) => (!m.length ? 'text' : m.some((f) => /\.(mp4|mov)$/i.test(f)) ? 'video' : m.length > 1 ? 'carousel' : 'image');
const iso = (date, hhmm) => new Date(`${date}T${hhmm}:00+03:00`).toISOString();
// TikTok — вручную, как VK (18.11: черновики через API доходят, но приложение перестало их показывать во «Входящих»)
const AUTO = new Set(['youtube/short', 'instagram/reels', 'instagram/image', 'instagram/carousel', 'telegram/post']);

db.exec('begin');
// Пересоздаём только черновики плана: опубликованное и стоящее в очереди не трогаем.
const busy = new Set(all(`select distinct p.title from posts p join targets t on t.post_id=p.id where p.release=? and t.status not in ('draft','cancelled')`, RELEASE).map((r) => r.title));
run(`delete from posts where release=? and title not in (${[...busy].map(() => '?').join(',') || "''"})`, RELEASE, ...busy);
let posts = 0, targets = 0;
for (const it of PLAN) {
  if (busy.has(it.title)) continue;
  const note = [it.need ? `НУЖЕН ФАЙЛ: ${it.need}` : '', it.note || ''].filter(Boolean).join('\n');
  const [date, time] = it.at.split('T');
  // Один пост — одна площадка: на каждую площадку пункта плана — свой пост со своей подписью.
  for (const [pf, o] of Object.entries(it.to)) {
    const [platform, format] = pf.split('/');
    const mode = o.manual || !AUTO.has(pf) ? 'manual' : 'auto';
    const comment = o.comment ?? it.comment ?? (['youtube/short', 'instagram/reels', 'tiktok/draft'].includes(pf) ? COMMENT : null);
    // approved_at не ставим: подготовленное Claude ждёт утверждения человеком
    const id = Number(run('insert into posts (title, kind, caption, media, release, note, comment, cover_sec) values (?,?,?,?,?,?,?,?)',
      it.title, kind(it.media), o.caption ?? it.caption ?? '', JSON.stringify(it.media), RELEASE, note, comment, it.cover ?? null).lastInsertRowid);
    run('insert into targets (post_id, platform, format, planned_at, mode, title, oracle) values (?,?,?,?,?,?,?)',
      id, platform, format, iso(date, o.at || time), mode, o.title ?? null, o.oracle ? 1 : 0);
    posts++; targets++;
  }
}
db.exec('commit');
log(`загружен план «${RELEASE}»: ${posts} постов, ${targets} публикаций — черновиками`);
console.log(`План «${RELEASE}»: ${posts} постов, ${targets} публикаций — черновиками${busy.size ? ` (не тронуты уже запущенные: ${[...busy].join(', ')})` : ''}.`);

// Человеческая версия плана.
if (OUT) {
  const NAMES = { 'youtube/short': 'YouTube Shorts', 'instagram/reels': 'Instagram Reels', 'tiktok/draft': 'TikTok (черновик)', 'telegram/post': 'Telegram',
    'vk/post': 'VK пост', 'vk/clip': 'VK клип', 'instagram/image': 'Instagram фото', 'instagram/carousel': 'Instagram карусель' };
  const day = (d) => new Date(`${d}T12:00:00+03:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
  let md = `# Контент-план «${RELEASE}»\n\nСобран из \`tools/autopost/${file.replace(/^.*?plans\//, 'plans/')}\` — правки вносить туда и загружать заново: \`npm run plan -- ${file}\`.\nСтратегия — [стратегия-площадок.md](../стратегия-площадок.md). ✅ — файл готов, 🛠 — файл ещё надо сделать.\n`;
  let cur = '';
  for (const it of [...PLAN].sort((a, b) => a.at.localeCompare(b.at))) {
    const [date, time] = it.at.split('T');
    if (date !== cur) { md += `\n## ${day(date)}\n\n| Время | Что | Куда | Файл |\n|---|---|---|---|\n`; cur = date; }
    const where = Object.entries(it.to).map(([pf, o]) => `${NAMES[pf] || pf}${o.at ? ` ${o.at}` : ''}${o.manual || !AUTO.has(pf) ? ' (вручную)' : ''}`).join(', ');
    const f = it.need ? `🛠 ${it.need}` : it.media.length ? `✅ ${it.media.map((m) => m.split('/').pop()).join(', ')}` : '— (текст)';
    md += `| ${time} | **${it.title}** | ${where} | ${f} |\n`;
  }
  md += '\n## Подписи\n';
  for (const it of [...PLAN].sort((a, b) => a.at.localeCompare(b.at))) {
    md += `\n### ${it.title}\n\n${(it.caption || '').split('\n').map((l) => `> ${l}`).join('\n')}\n`;
    for (const [pf, o] of Object.entries(it.to)) {
      if (o.title) md += `\n**${NAMES[pf]}, название:** ${o.title}\n`;
      if (o.caption) md += `\n**${NAMES[pf]}:**\n${o.caption.split('\n').map((l) => `> ${l}`).join('\n')}\n`;
    }
    if (it.note) md += `\n*${it.note}*\n`;
  }
  writeFileSync(path.join(REPO, OUT), md);
  console.log(`Записан ${OUT}`);
}
