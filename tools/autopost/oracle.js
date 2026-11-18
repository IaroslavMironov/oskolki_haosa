import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db, all, get, run, log, now } from './db.js';
import { account } from './secrets.js';
import { PLATFORMS } from './platforms/index.js';
import { REPO } from './media.js';
import { DRY } from './publish.js';

/*
 * «Ворожея отвечает»: под роликами с включённым флагом (targets.oracle) зритель пишет номер карты —
 * Глашатай отвечает от имени канала пророчеством из колоды сайта (data.js, 42 карты).
 *  1–3   → случайная карта (у двоих, выбравших «2», — разные);  4–42 → пророчество под этим номером.
 * Отвечаем один раз человеку под роликом; на свои комментарии и комментарии без номера — молчим.
 * Обе площадки — раз в 30 с (мгновенных оповещений о комментариях YouTube не даёт; решение Владислава 18.11 — 30 с).
 * Включать только на роликах, где зовём выбрать карту (гадание): «Вытяни карту», «Пророчество дня», «Ворожея отвечает».
 * Шаблон ответа утверждён Владиславом 18.11.2026.
 */

db.exec(`create table if not exists oracle (
  platform text not null, comment_id text not null, target_id integer, author text, card integer, reply_id text, at text,
  primary key (platform, comment_id))`);
try { db.exec('alter table targets add column oracle integer not null default 0'); } catch { /* уже есть */ }

const YT_DAILY = 100; // ответ на YouTube стоит 50 единиц из 10 000 бесплатных в сутки; опрос раз в 30 с — ещё ~2 900 на ролик
const ORD = ['Первая', 'Вторая', 'Третья'];
const INTRO = ['🔮', '🔮 Карты легли.', '🕯', '🔮 Ворожея перевернула карту.', '🌒'];

function site() {
  const w = {};
  new Function('window', readFileSync(path.join(REPO, 'data.js'), 'utf8'))(w);
  const D = Object.values(w)[0];
  return { deck: D.prophecies };
}

/** Номер карты из комментария: короткий текст с одним числом 1–42 («2», «карта 2», «№17!»). Иначе null. */
export function cardNumber(text) {
  const t = String(text || '').trim();
  if (t.length > 40) return null;
  const m = t.match(/^[^\d]{0,15}?(\d{1,2})[^\d]{0,15}$/);
  const n = m ? +m[1] : 0;
  return n >= 1 && n <= 42 ? n : null;
}

export function replyText(n, { deck }, rnd = Math.random) {
  const i = n <= 3 ? Math.floor(rnd() * deck.length) : n - 1;
  const p = deck[i];
  const head = n <= 3 ? `${ORD[n - 1]} карта` : `Карта №${n}`;
  const intro = INTRO[Math.floor(rnd() * INTRO.length)];
  // только гадание, без рекламы трека — решение Владислава 18.11
  return { card: i + 1, text: `${intro} ${head} — «${p.card}».\n«${p.text}»` };
}

const lastErr = new Map(); // одна и та же ошибка не забивает журнал
const warn = (t, msg) => { if (lastErr.get(t.id) !== msg) { lastErr.set(t.id, msg); log(`Ворожея отвечает · ${PLATFORMS[t.platform].title}: ${msg}`, { targetId: t.id, level: 'warn' }); } };

async function serve(t, ctx) {
  const p = PLATFORMS[t.platform], acc = account(t.platform);
  if (!p.oracle || acc?.status !== 'connected') return;
  const comments = await p.oracle.list(acc, t.remote_id);
  for (const c of comments) {
    if (c.own || get('select 1 from oracle where platform=? and comment_id=?', t.platform, c.id)) continue;
    const n = cardNumber(c.text);
    if (!n) continue;
    if (t.platform === 'youtube' && get("select count(*) n from oracle where platform='youtube' and at > ?", new Date(Date.now() - 864e5).toISOString()).n >= YT_DAILY) return warn(t, `дневной предел ${YT_DAILY} ответов — продолжу завтра`);
    const before = c.author && get('select card from oracle where platform=? and target_id=? and author=? and card is not null', t.platform, t.id, c.author);
    const r = before
      ? { card: null, text: `🔮 Твоя карта уже открыта — «${ctx.deck[before.card - 1].card}». Ворожея не гадает дважды на одном пути.` }
      : replyText(n, ctx);
    const id = await p.oracle.reply(acc, c.id, r.text);
    run('insert into oracle (platform, comment_id, target_id, author, card, reply_id, at) values (?,?,?,?,?,?,?)', t.platform, c.id, t.id, c.author || null, r.card, id || null, now());
    lastErr.delete(t.id);
  }
}

/** Раз в 30 с из server.js. */
export async function oracleRound() {
  if (DRY()) return;
  const ctx = site();
  const targets = all(`select * from targets where oracle=1 and status='published' and removed_at is null and remote_id is not null
    and published_at > ?`, new Date(Date.now() - 30 * 864e5).toISOString());
  for (const t of targets) {
    try { await serve(t, ctx); } catch (e) { warn(t, e.message); }
  }
}

/** Сколько карт вытянули под публикацией — для кабинета. */
export const oracleCounts = () => Object.fromEntries(all('select target_id, count(*) n from oracle group by target_id').map((r) => [r.target_id, r.n]));
