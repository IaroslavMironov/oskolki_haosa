#!/usr/bin/env node
/* Рендерит карту из map.js в готовые картинки opt/map-{1600,2400,3200}.webp.
   Зачем: растеризация SVG с текстурными фильтрами тяжела для телефона, а готовый WebP
   декодируется быстро. Если координаты в data.js потом поменяют, сайт заметит (по ключу)
   и нарисует карту кодом сам, так что ничего не сломается — просто перезапусти этот скрипт.

   Запуск из корня проекта:  node tools/render-map.js
   Нужны: Google Chrome, `npm i playwright-core`, python3 + Pillow (как для optimize.py). */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.error('Нужен playwright-core: npm i playwright-core'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..');
global.window = {};
for (const f of ['data.js', 'map.js']) (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const D = window.CODEX, M = window.CodexMap;
const L = Object.fromEntries(D.locations.map(l => [l.title, l.map]));
const locs = { castle: L['Замок Элронда'], forest: L['Лес у замка'], town: L['Дороги и таверны'] };
const art = M.build(locs);
const W = 3200, H = 2000, SIZES = [1600, 2400, 3200];

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  await p.setContent(`<body style="margin:0;background:#120d09"><img id="m" style="display:block;width:${W}px;height:${H}px" src="data:image/svg+xml;base64,${Buffer.from(art.svg).toString('base64')}"></body>`);
  await p.evaluate(() => document.getElementById('m').decode());
  const png = path.join(os.tmpdir(), 'codex-map.png');
  await p.screenshot({ path: png });
  await b.close();
  execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
for w in map(int, sys.argv[3:]):
    im.resize((w, w * 10 // 16), Image.LANCZOS).save(f'{sys.argv[2]}/map-{w}.webp', 'WEBP', quality=82, method=6)
`, png, path.join(ROOT, 'opt'), ...SIZES.map(String)]);
  fs.writeFileSync(path.join(ROOT, 'opt', 'map-manifest.js'),
    `// сгенерировано tools/render-map.js — не править руками\nwindow.OPT_MAP = ${JSON.stringify({ key: M.key(locs), sizes: SIZES })};\n`);
  for (const w of SIZES) console.log(`opt/map-${w}.webp`, (fs.statSync(path.join(ROOT, 'opt', `map-${w}.webp`)).size / 1024).toFixed(0) + ' KB');
})();
