/*
 * Тест, который кликает: настоящий Chrome открывает сайт-кодекс и проходит главный путь посетителя —
 * сломать печать → герои и песни на месте → вытянуть карту у Ворожеи → кнопки «слушать» ведут в VK Музыку и Яндекс.
 * Внешние запросы (шрифты, Метрика) отрезаны — тест не зависит от сети. Нет Chrome — пропускаем.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => p && existsSync(p));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Сайт — статика, как у nginx на сервере.
const server = createServer(async (req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  try { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;
const browser = CHROME ? await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] }) : null;
after(async () => { await browser?.close(); server.close(); });

test('сайт: печать → герои, песни → карта Ворожеи → «слушать»', { skip: !CHROME && 'нет Chrome' }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith(BASE) || r.url().startsWith('data:') ? r.continue() : r.abort()));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.click('#splash-seal');
  await page.waitForSelector('body.entered', { timeout: 10000 });

  assert.ok(await page.$$eval('#cards > *', (x) => x.length) >= 5, 'карточки героев на месте');
  assert.ok(await page.$$eval('#song-list li', (x) => x.length) >= 5, 'песни на месте');

  await page.$eval('#oracle', (el) => el.scrollIntoView());
  await page.waitForFunction(() => document.querySelector('#ocards').classList.contains('in')); // карты «проявились»
  await new Promise((r) => setTimeout(r, 1200)); // и долетели на место
  await page.click('#ocards .ocard');
  await page.waitForFunction(() => document.querySelector('#oracle-reading')?.textContent.trim().length > 10, { timeout: 5000 });

  const hrefs = await page.$$eval('#finale-links a', (a) => a.map((x) => x.href));
  assert.ok(hrefs.some((h) => /vk\.(com|ru)/.test(h)), 'есть ссылка на VK');
  assert.ok(hrefs.some((h) => /music\.yandex/.test(h)), 'есть ссылка на Яндекс Музыку');
  assert.deepEqual(errors, [], 'без ошибок в браузере');
});
