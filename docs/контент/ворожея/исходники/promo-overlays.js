// Прозрачные слои с надписями 1080×1920 для роликов плана (шрифты и цвета — как на сайте и в роликах «Ворожеи»).
// node overlays.js <папка> — пишет <имя>.png на каждый слой из L.
const { chromium } = require('playwright-core');
const OUT = process.argv[2];

const grad = (from = 1000) => `<div style="position:absolute;left:0;right:0;top:${from}px;bottom:0;background:linear-gradient(rgba(6,4,10,0),rgba(6,4,10,.88) 45%,rgba(6,4,10,.95))"></div>`;
const t = (y, html, css = '') => `<div style="position:absolute;left:60px;right:60px;top:${y}px;text-align:center;${css}">${html}</div>`;
const label = (y, s, col = '#d6a35c') => t(y, s, `font:500 30px Spectral;letter-spacing:14px;color:${col};text-transform:uppercase;text-shadow:0 0 12px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.9)`);
const uni = (y, s, size, col, glow) => t(y, s, `font:600 ${size}px 'Cormorant Unicase';letter-spacing:8px;color:${col};text-shadow:0 0 30px ${glow},0 0 60px ${glow}`);
const ital = (y, s, size, col = '#f3e2d6') => t(y, s, `font:italic 500 ${size}px 'Cormorant Garamond';color:${col};text-shadow:0 2px 18px rgba(0,0,0,.9)`);
const site = (y, s = 'oskolkihaosa.ru') => t(y, s, `font:500 30px Spectral;letter-spacing:12px;color:#f3e2d6;text-transform:uppercase;text-shadow:0 0 18px rgba(255,45,149,.6)`);

const HERO = [
  ['ayla', 'Айла', 'Хмельная тень', 'Лидер отряда · ассасин', 'Хмельная тень', '#ffb02e', 1],
  ['miri', 'Мири', 'Принцесса-катастрофа', 'Гитара отряда', 'Сладкая дрянь', '#ff3fb4', 2],
  ['ilvy', 'Ильви', 'Рыжий мех', 'Бас · хульдра из леса', 'Рыжий мех', '#3dffa0', 3],
  ['vulkan', 'Вулкан', 'Фундамент отряда', 'Барабаны · кузнец', 'Трон ещё ждёт', '#ff6a1a', 4],
];
const L = {};
for (const [k, name, epithet, role, song, aura, n] of HERO) {
  L[`${k}-a`] = label(200, `Отряд · ${n}/4`) + grad(1050) + uni(1215, name.toUpperCase(), 170, '#f3e2d6', aura + 'cc') + ital(1405, epithet, 66, aura);
  L[`${k}-b`] = grad(1050) + label(1170, role) + ital(1245, `♪ «${song}»`, 76) + site(1375, 'песня — на oskolkihaosa.ru');
}
L.sd = uni(250, 'МИРИ', 120, '#f3e2d6', '#ff3fb4cc') + ital(400, '«Сладкая дрянь»', 70, '#ff7ac3') + label(1330, 'клип отряда') + site(1395);
L['kor-a'] = grad(1000) + label(1150, 'Письмо Визиусу · 13 лет спустя') + ital(1225, 'Прячься, предатель —', 92);
L['kor-b'] = grad(1000) + uni(1185, 'КОРОНА ГОРИТ', 92, '#f3e2d6', '#ff6a1acc') + ital(1330, 'Визиус узнал: племянницы живы', 56) + site(1420, '♪ «Корона горит» · oskolkihaosa.ru');

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [name, body] of Object.entries(L)) {
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@600&family=Cormorant+Garamond:ital,wght@1,500&family=Spectral:wght@500&display=swap" rel="stylesheet">
      <style>html,body{margin:0;width:1080px;height:1920px;background:transparent;overflow:hidden}</style></head>
      <body><div style="position:relative;width:1080px;height:1920px">${body}</div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${name}.png`, omitBackground: true });
  }
  console.log(Object.keys(L).length, 'слоёв');
  await b.close();
})();
