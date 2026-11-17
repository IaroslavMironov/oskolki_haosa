// статичные материалы «Ворожеи»: карусель-досье, пророчества дня, сторис
const { chromium } = require('playwright-core');
const D = '/private/tmp/claude-501/-Users-vladislavzherebtsov-Cursor----------------------/43ed27f2-9d17-4819-9175-b5dfe5f42572/scratchpad/vor/';
const O = '/Users/vladislavzherebtsov/Cursor Проекты/Осколки Хаоса/docs/контент/ворожея/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
  require('fs').mkdirSync(O + 'картинки', { recursive: true });
  for (const [q, out, h] of [['k=dossier1', 'карусель-досье-1', 1350], ['k=dossier2', 'карусель-досье-2', 1350], ['k=dossier3', 'карусель-досье-3', 1350],
    ['k=prophecy&i=0', 'пророчество-дня-око', 1350], ['k=prophecy&i=1', 'пророчество-дня-пламя', 1350], ['k=prophecy&i=2', 'пророчество-дня-луна', 1350], ['k=story', 'сторис-завтра', 1920]]) {
    const p = await b.newPage({ viewport: { width: 1080, height: h } });
    await p.goto(`file://${D}poster.html?${q}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
    await p.screenshot({ path: `${O}картинки/${out}.jpg`, type: 'jpeg', quality: 92 }); await p.close();
  }
  await b.close(); console.log('ok');
})();
