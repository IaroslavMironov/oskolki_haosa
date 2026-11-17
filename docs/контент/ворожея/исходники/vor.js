// рендер визуалайзеров «Ворожеи»: node vor.js A [t1,t2..] — пробные кадры (время от начала ролика); без списка — все кадры
const { chromium } = require('playwright-core');
const D = '/private/tmp/claude-501/-Users-vladislavzherebtsov-Cursor----------------------/43ed27f2-9d17-4819-9175-b5dfe5f42572/scratchpad/vor/';
(async () => {
  const clip = process.argv[2], test = process.argv[3];
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`file://${D}render.html?clip=${clip}`); await p.evaluate(() => window.ready);
  const dur = await p.evaluate(() => window.DUR);
  const list = test ? test.split(',').map(Number) : Array.from({ length: Math.round(dur * 24) }, (_, i) => i / 24);
  const dir = `${D}${test ? 'test' : 'out'}_${clip}/`; require('fs').mkdirSync(dir, { recursive: true });
  for (const [i, t] of list.entries()) {
    await p.evaluate(t => window.render(t), t);
    await p.locator('#c').screenshot({ path: dir + (test ? `t${t}.png` : String(i + 1).padStart(4, '0') + '.png') });
  }
  console.log(clip, list.length, 'frames', dur.toFixed(2), errs);
  await b.close();
})();
