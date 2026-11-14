#!/usr/bin/env node
/* Рендерит сургучную печать в opt/seal.webp (с прозрачностью).
   Рельеф — карта высот (капля воска, вдавленный оттиск, выпуклые корона и надпись),
   свет — SVG-фильтры освещения. Считается один раз здесь, на сайте — просто картинка.

   Запуск из корня проекта:  node tools/render-seal.js [preview.png]
   Нужны: Google Chrome, `npm i playwright-core`, python3 + Pillow. */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.error('Нужен playwright-core: npm i playwright-core'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..');

const S = 400, C = 200;
// неровный край капли: несколько гармоник + два «натёка» воска
const blob = (() => {
  const pts = [];
  for (let i = 0; i < 240; i++) {
    const a = i / 240 * Math.PI * 2;
    let r = 146 + 5 * Math.sin(3 * a + 1.3) + 3.5 * Math.sin(5 * a + .4) + 2 * Math.sin(9 * a + 2.1) + 1.2 * Math.sin(17 * a);
    for (const [c, w, h] of [[.7, .32, 11], [3.9, .25, 8], [5.3, .18, 6]]) {
      const d = Math.atan2(Math.sin(a - c), Math.cos(a - c));
      r += h * Math.exp(-(d * d) / (2 * w * w));
    }
    pts.push(`${(C + Math.cos(a) * r).toFixed(1)},${(C + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
})();
const crown = 'M10 46 L6 20 L20 32 L32 12 L44 32 L58 20 L54 46 Z';
const SX = 202, SY = 197; // штамп вдавлен чуть не по центру — как рукой

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <clipPath id="clip"><path d="${blob}"/></clipPath>
  <path id="top" d="M${SX - 86} ${SY} A86 86 0 0 1 ${SX + 86} ${SY}"/>
  <path id="bot" d="M${SX - 101} ${SY} A101 101 0 0 0 ${SX + 101} ${SY}"/>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="soft2"><feGaussianBlur stdDeviation="2.2"/></filter>
  <filter id="soft1"><feGaussianBlur stdDeviation=".9"/></filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
  <filter id="wax" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="h0"/>
    <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .5 0 0 0 0" result="na"/>
    <feComposite in="h0" in2="na" operator="arithmetic" k2="1" k3=".09" result="h"/>
    <feDiffuseLighting in="h" surfaceScale="7" diffuseConstant="1.15" lighting-color="#fff" result="diff">
      <feDistantLight azimuth="235" elevation="48"/>
    </feDiffuseLighting>
    <feSpecularLighting in="h" surfaceScale="7" specularConstant=".95" specularExponent="30" lighting-color="#ffd9d4" result="spec">
      <feDistantLight azimuth="235" elevation="52"/>
    </feSpecularLighting>
    <feFlood flood-color="#860a1c" result="wax"/>
    <feComposite in="diff" in2="wax" operator="arithmetic" k1="1.18" result="lit"/>
    <feComposite in="spec" in2="spec" operator="arithmetic" k1="0" k2=".85" result="spec2"/>
    <feComposite in="lit" in2="spec2" operator="arithmetic" k2="1" k3="1"/>
  </filter>
  <radialGradient id="depth" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a0005" stop-opacity=".5"/>
  </radialGradient>
</defs>
<!-- тень на бумаге -->
<path d="${blob}" fill="#000" opacity=".55" filter="url(#shadow)" transform="translate(5 9)"/>
<g clip-path="url(#clip)">
  <!-- карта высот (светлее = выше) → освещение -->
  <g filter="url(#wax)">
    <rect width="${S}" height="${S}" fill="#000"/>
    <path d="${blob}" fill="#fff" filter="url(#soft)"/>
    <circle cx="${SX}" cy="${SY}" r="112" fill="#6a6a6a" filter="url(#soft2)"/>
    <circle cx="${SX}" cy="${SY}" r="112" fill="none" stroke="#e8e8e8" stroke-width="5" filter="url(#soft2)"/>
    <g fill="#b8b8b8" filter="url(#soft1)">
      <circle cx="${SX}" cy="${SY}" r="104" fill="none" stroke="#a8a8a8" stroke-width="2"/>
      <circle cx="${SX}" cy="${SY}" r="70" fill="none" stroke="#a8a8a8" stroke-width="2"/>
      <text font-family="Cormorant Unicase" font-weight="700" font-size="27" letter-spacing="7" text-anchor="middle">
        <textPath href="#top" startOffset="50%">ОСКОЛКИ</textPath>
      </text>
      <text font-family="Cormorant Unicase" font-weight="700" font-size="27" letter-spacing="9" text-anchor="middle">
        <textPath href="#bot" startOffset="50%">ХАОСА</textPath>
      </text>
      <path d="M${SX - 93} ${SY - 7} l5 7 l-5 7 l-5 -7z M${SX + 93} ${SY - 7} l5 7 l-5 7 l-5 -7z" fill="#c4c4c4"/>
      <g transform="translate(${SX - 48} ${SY - 50}) scale(1.5)">
        <path d="${crown}" fill="#9a9a9a" stroke="#c4c4c4" stroke-width="3.2" stroke-linejoin="round"/>
        <path d="M12 54 H52" stroke="#c4c4c4" stroke-width="3.2" stroke-linecap="round"/>
        <circle cx="32" cy="34" r="3.4" fill="#d0d0d0"/>
        <circle cx="6" cy="20" r="2.6" fill="#d0d0d0"/><circle cx="32" cy="12" r="2.6" fill="#d0d0d0"/><circle cx="58" cy="20" r="2.6" fill="#d0d0d0"/>
      </g>
    </g>
  </g>
  <path d="${blob}" fill="url(#depth)"/>
</g>
</svg>`;

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: S, height: S }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@700&display=block" rel="stylesheet"></head>
    <body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const png = process.argv[2] || path.join(os.tmpdir(), 'codex-seal.png');
  await p.screenshot({ path: png, omitBackground: true });
  await b.close();
  execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGBA').resize((360, 360), Image.LANCZOS).save(sys.argv[2], 'WEBP', quality=88, method=6)
`, png, path.join(ROOT, 'opt', 'seal.webp')]);
  console.log('opt/seal.webp', (fs.statSync(path.join(ROOT, 'opt', 'seal.webp')).size / 1024).toFixed(0) + ' KB');
})();
