/* Карта земель Элронда — рисуется кодом в SVG один раз и показывается картинкой.
   Холст 1600×1000. Положения замка, леса и деревни берутся из data.js (locations[].map),
   рельеф строится вокруг них, так что метки и рисунок всегда совпадают. */
window.CodexMap = (() => {
  const W = 1600, H = 1000;
  const f = n => Math.round(n * 10) / 10;
  const seeded = n => () => (n = (n * 16807) % 2147483647) / 2147483647;

  // Катмулл-Ром → плотная ломаная (для рек/дорог; заодно даёт точки для проверки расстояний)
  function sample(pts, steps = 14) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  const poly = (pts, close) => 'M' + pts.map(p => `${f(p[0])} ${f(p[1])}`).join('L') + (close ? 'Z' : '');
  const near = (x, y, pts, d) => pts.some(p => (p[0] - x) ** 2 + (p[1] - y) ** 2 < d * d);

  function build(locs) {
    const rnd = seeded(20251113);
    const R = (a, b) => a + rnd() * (b - a);
    const castle = locs.castle || { x: 480, y: 360 }, forest = locs.forest || { x: 760, y: 560 }, town = locs.town || { x: 1240, y: 700 };
    const dark = { x: Math.min(W - 180, town.x + 140), y: Math.max(260, town.y - 330) }; // Тёмная чаща за рекой
    const trap = { x: forest.x - 90, y: forest.y + 70 };                                  // поляна с капканом

    /* ── река: из горного озера на юг, между лесом и деревней ── */
    const lake = { x: (forest.x + town.x) / 2 + 40, y: 175 };
    const bridge = { x: (forest.x + town.x) / 2 + 10, y: (forest.y + town.y) / 2 + 40 };
    const riverPts = sample([[lake.x, lake.y + 20], [lake.x - 60, 300], [bridge.x + 40, bridge.y - 170], [bridge.x, bridge.y], [bridge.x - 40, bridge.y + 160], [bridge.x + 30, H + 30]], 18);

    /* ── дороги ── */
    const gate = { x: castle.x + 10, y: castle.y + 60 };
    const roadMain = sample([[-20, castle.y + 90], [castle.x - 140, castle.y + 80], [gate.x, gate.y], [castle.x + 170, forest.y - 150], [forest.x + 120, forest.y - 110], [bridge.x - 70, bridge.y - 10], [bridge.x, bridge.y], [town.x - 80, town.y + 10], [town.x, town.y + 20], [town.x + 200, town.y + 40], [W + 20, town.y + 70]], 12);
    const roadSouth = sample([[town.x, town.y + 20], [town.x + 20, town.y + 160], [town.x - 30, H + 20]], 12);
    const roads = roadMain.concat(roadSouth);

    /* ── маршрут побега (рисуется отдельным оверлеем) ── */
    const route = sample([[castle.x + 30, castle.y + 40], [castle.x + 90, castle.y + 120], [forest.x - 170, forest.y - 40], [trap.x + 10, trap.y - 40], [forest.x, forest.y]], 16);

    /* ── граница королевства ── */
    const border = [];
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const r = 1 + .06 * Math.sin(a * 3 + 1) + .04 * Math.sin(a * 7 + 2) + R(-.015, .015);
      border.push([800 + Math.cos(a) * 690 * r, 540 + Math.sin(a) * 400 * r]);
    }

    /* ── горы: две гряды на севере ── */
    const mounts = [];
    for (const [row, y0, hMin, hMax, alpha] of [[0, 190, 55, 95, .55], [1, 245, 75, 140, 1]]) {
      for (let x = 70 + row * 40; x < lake.x - 70; x += R(55, 95)) {
        if (Math.abs(x - castle.x) < 120 && row === 1 && castle.y < 420) continue; // не заслоняем замок
        mounts.push({ x, y: y0 + R(-18, 22), w: R(90, 160), h: R(hMin, hMax), alpha });
      }
    }
    for (let x = lake.x + 90; x < W - 80; x += R(70, 110)) mounts.push({ x, y: 210 + R(-15, 20), w: R(80, 130), h: R(50, 95), alpha: .8 });
    mounts.sort((a, b) => a.y - b.y);
    const mountSvg = mounts.map(m => {
      const L = m.x - m.w / 2, Rr = m.x + m.w / 2, px = m.x + R(-.08, .08) * m.w, py = m.y - m.h, mid = m.x + R(-.02, .12) * m.w;
      const jag = (a, b, n) => Array.from({ length: n }, (_, i) => { const t = (i + 1) / (n + 1); return [a[0] + (b[0] - a[0]) * t + R(-3, 3), a[1] + (b[1] - a[1]) * t + R(-4, 4)]; });
      const le = [[L, m.y], ...jag([L, m.y], [px, py], 3), [px, py]], re = [[px, py], ...jag([px, py], [Rr, m.y], 3), [Rr, m.y]];
      let hatch = '';
      for (let i = 1; i <= 6; i++) { const t = i / 7; const a = [px + (mid - px) * t, py + (m.y - py) * t], b = [px + (Rr - px) * t, py + (m.y - py) * t]; hatch += `M${f(a[0] + 3)} ${f(a[1])}L${f(a[0] + (b[0] - a[0]) * .55)} ${f(a[1] + 6)}`; }
      const sn = .26; const s1 = [px + (L - px) * sn, py + (m.y - py) * sn], s2 = [px + (Rr - px) * sn * .9, py + (m.y - py) * sn * .9];
      return `<g opacity="${m.alpha}">
        <path d="${poly([...le, [mid, m.y]], 1)}" fill="#3a2b1d"/>
        <path d="${poly([...re, [mid, m.y]], 1)}" fill="#160f0a"/>
        <path d="M${f(s1[0])} ${f(s1[1])}L${f(px)} ${f(py)}L${f(s2[0])} ${f(s2[1])}L${f((px + s2[0]) / 2 + 2)} ${f(s2[1] - 6)}L${f(px - 1)} ${f(s1[1] + 5)}L${f((px + s1[0]) / 2)} ${f(s1[1] - 4)}Z" fill="#d9cdbb" opacity=".55"/>
        <path d="${hatch}" stroke="#d6a35c" stroke-opacity=".28" stroke-width="1"/>
        <path d="${poly([...le, ...re.slice(1)])}M${f(px)} ${f(py)}Q${f((px + mid) / 2 + 4)} ${f((py + m.y) / 2)} ${f(mid)} ${f(m.y)}" fill="none" stroke="#d6a35c" stroke-opacity=".62" stroke-width="1.4" stroke-linejoin="round"/>
      </g>`;
    }).join('');

    /* ── холмы ── */
    let hills = '';
    for (let i = 0; i < 26; i++) {
      const x = R(90, W - 90), y = R(300, H - 80);
      if (near(x, y, [[castle.x, castle.y], [forest.x, forest.y], [town.x, town.y], [dark.x, dark.y]], 190) || near(x, y, riverPts, 40)) continue;
      const w = R(26, 50);
      hills += `<path d="M${f(x - w / 2)} ${f(y)}Q${f(x)} ${f(y - w * .55)} ${f(x + w / 2)} ${f(y)}" fill="#2a1f15" stroke="#d6a35c" stroke-opacity=".38" stroke-width="1.2"/>
        <path d="M${f(x + w * .12)} ${f(y - w * .18)}l${f(w * .12)} ${f(w * .14)}M${f(x + w * .25)} ${f(y - w * .1)}l${f(w * .1)} ${f(w * .1)}" stroke="#d6a35c" stroke-opacity=".22"/>`;
    }
    /* ── трава/штрихи ── */
    let tufts = '';
    for (let i = 0; i < 160; i++) {
      const x = R(60, W - 60), y = R(330, H - 60);
      if (near(x, y, riverPts, 24) || near(x, y, [[forest.x, forest.y]], 260)) continue;
      tufts += `M${f(x)} ${f(y)}l2 -5l2 5M${f(x + 5)} ${f(y)}l1.5 -4`;
    }

    /* ── лес ── */
    const inForest = (x, y) => {
      const blobs = [[forest.x, forest.y, 300, 185], [(castle.x + forest.x) / 2 + 20, (castle.y + forest.y) / 2 + 30, 200, 130], [forest.x - 260, forest.y + 140, 140, 90]];
      return blobs.some(([cx, cy, rx, ry]) => {
        const a = Math.atan2(y - cy, x - cx), n = 1 + .12 * Math.sin(a * 5 + cx) + .08 * Math.sin(a * 9 + cy);
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < n * n;
      });
    };
    const trees = [];
    for (let y = forest.y - 280; y < forest.y + 300; y += 12) for (let x = castle.x - 120; x < bridge.x - 30; x += 14) {
      const tx = x + R(-5, 5), ty = y + R(-4, 4);
      if (!inForest(tx, ty) || near(tx, ty, roads, 13) || near(tx, ty, riverPts, 22) || near(tx, ty, [[trap.x, trap.y]], 34) || near(tx, ty, [[castle.x, castle.y + 20]], 120) || rnd() < .08) continue;
      trees.push({ x: tx, y: ty, s: R(15, 24), kind: rnd() < .72 ? 'fir' : 'oak' });
    }
    // разрозненные рощи
    for (let g = 0; g < 9; g++) {
      const gx = R(120, W - 120), gy = R(380, H - 90);
      if (near(gx, gy, [[town.x, town.y], [castle.x, castle.y]], 130) || inForest(gx, gy) || near(gx, gy, riverPts, 40)) continue;
      for (let k = 0; k < 7; k++) { const tx = gx + R(-30, 30), ty = gy + R(-16, 16); if (!near(tx, ty, roads, 12)) trees.push({ x: tx, y: ty, s: R(12, 18), kind: rnd() < .5 ? 'fir' : 'oak' }); }
    }
    // Тёмная чаща — мёртвые корявые деревья
    const dead = [];
    for (let i = 0; i < 46; i++) {
      const a = R(0, Math.PI * 2), d = Math.sqrt(rnd());
      const x = dark.x + Math.cos(a) * 150 * d, y = dark.y + Math.sin(a) * 85 * d;
      if (near(x, y, [[dark.x + 10, dark.y + 10]], 28) || near(x, y, riverPts, 20)) continue;
      dead.push({ x, y, s: R(16, 26) });
    }
    trees.sort((a, b) => a.y - b.y);
    const fir = ({ x, y, s }) => {
      const w = s * .42;
      const pts = [[x, y - s], [x + w * .5, y - s * .58], [x + w * .28, y - s * .58], [x + w * .78, y - s * .2], [x + w * .45, y - s * .2], [x + w, y + s * .08], [x - w, y + s * .08], [x - w * .45, y - s * .2], [x - w * .78, y - s * .2], [x - w * .28, y - s * .58], [x - w * .5, y - s * .58]];
      return `<path d="${poly(pts, 1)}" fill="#13201a" stroke="#6f9a72" stroke-opacity=".6" stroke-width=".9" stroke-linejoin="round"/><path d="${poly([[x, y - s], ...pts.slice(1, 6), [x, y + s * .08]], 1)}" fill="#000" fill-opacity=".38"/>`;
    };
    const oak = ({ x, y, s }) => {
      const cx = x, cy = y - s * .5, r = s * .42, pts = [];
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const rr = r * R(.82, 1.08); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .9]); }
      return `<path d="M${f(x)} ${f(y + s * .08)}V${f(cy)}" stroke="#4a3420" stroke-width="2"/><path d="${poly(sample([...pts, pts[0], pts[1]], 3).slice(2), 1)}" fill="#18271b" stroke="#7fa877" stroke-opacity=".55" stroke-width=".9"/><path d="M${f(cx - r * .55)} ${f(cy - r * .25)}Q${f(cx - r * .2)} ${f(cy - r * .75)} ${f(cx + r * .3)} ${f(cy - r * .6)}" fill="none" stroke="#a9c99d" stroke-opacity=".35"/>`;
    };
    const deadTree = ({ x, y, s }) => {
      let d = `M${f(x)} ${f(y)}C${f(x + R(-3, 3))} ${f(y - s * .4)} ${f(x + R(-4, 4))} ${f(y - s * .7)} ${f(x + R(-2, 2))} ${f(y - s)}`;
      for (let b = 0; b < 4; b++) { const by = y - s * R(.35, .85), side = b % 2 ? 1 : -1; d += `M${f(x)} ${f(by)}q${f(side * s * .2)} ${f(-s * .05)} ${f(side * s * R(.3, .45))} ${f(-s * R(.15, .3))}`; }
      return `<path d="${d}" fill="none" stroke="#8a7a66" stroke-opacity=".7" stroke-width="1.3" stroke-linecap="round"/>`;
    };
    // подложка лесного массива: те же шумные эллипсы, что и в inForest
    const floor = [[forest.x, forest.y, 300, 185], [(castle.x + forest.x) / 2 + 20, (castle.y + forest.y) / 2 + 30, 200, 130], [forest.x - 260, forest.y + 140, 140, 90]].map(([cx, cy, rx, ry]) => {
      const pts = [];
      for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, n = (1 + .12 * Math.sin(a * 5 + cx) + .08 * Math.sin(a * 9 + cy)) * 1.04; pts.push([cx + Math.cos(a) * rx * n, cy + Math.sin(a) * ry * n]); }
      return `<path d="${poly(pts, 1)}"/>`;
    }).join('');
    // обрезаем подложку по западному берегу реки
    const westClip = `<clipPath id="west"><path d="${poly([[0, 0], ...riverPts.map(p => [p[0] - 10, p[1]]), [0, H]], 1)}"/></clipPath>`;
    const forestFloor = `${westClip}<g clip-path="url(#west)" fill="#14251a" fill-opacity=".55" stroke="#6f9a72" stroke-opacity=".22" stroke-width="2">${floor}</g>`;

    /* ── поля у деревни: участки с бороздами ── */
    let fields = '';
    [[-150, 90, 70, 44, -12], [-60, 120, 80, 40, 8], [40, 110, 70, 46, -6], [150, 80, 64, 42, 14], [120, 150, 76, 40, -10], [-120, 160, 60, 36, 4]].forEach(([dx, dy, w, h, rot]) => {
      const x = town.x + dx, y = town.y + dy;
      if (y > H - 60 || x > W - 70) return;
      let furrows = ''; for (let k = 6; k < w; k += 7) furrows += `M${k - w / 2} ${-h / 2 + 3}v${h - 6}`;
      fields += `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#6b5228" fill-opacity=".22" stroke="#d6a35c" stroke-opacity=".35"/><path d="${furrows}" stroke="#d6a35c" stroke-opacity=".22"/></g>`;
    });

    /* ── каменный круг (капище) и болото — оживляют пустые земли ── */
    const stones = (() => {
      const cx = 250, cy = 720; let s = `<ellipse cx="${cx}" cy="${cy}" rx="52" ry="24" fill="#d6a35c" fill-opacity=".05" stroke="#d6a35c" stroke-opacity=".2" stroke-dasharray="3 5"/>`;
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, x = cx + Math.cos(a) * 46, y = cy + Math.sin(a) * 20; s += `<path d="M${f(x - 4)} ${f(y + 4)}v-11q4 -5 8 0v11Z" fill="#2c2118" stroke="#d6a35c" stroke-opacity=".75" stroke-width="1.1"/>`; }
      return s + `<rect x="${cx - 9}" y="${cy - 5}" width="18" height="8" fill="#2c2118" stroke="#d6a35c" stroke-opacity=".75"/>`;
    })();
    const marsh = (() => {
      const cx = forest.x - 40, cy = Math.min(H - 110, forest.y + 300); let s = '';
      for (let i = 0; i < 7; i++) { const x = cx + R(-90, 90), y = cy + R(-25, 25); s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(R(14, 28))}" ry="${f(R(5, 9))}" fill="#1b2a30" fill-opacity=".8" stroke="#8fb8c4" stroke-opacity=".25"/>`; }
      let reeds = ''; for (let i = 0; i < 40; i++) { const x = cx + R(-120, 120), y = cy + R(-34, 34); reeds += `M${f(x)} ${f(y)}v-8M${f(x + 3)} ${f(y)}l1 -6M${f(x - 3)} ${f(y)}l-1 -5`; }
      return s + `<path d="${reeds}" stroke="#a9c99d" stroke-opacity=".35" stroke-width=".9"/>`;
    })();

    const forestShadow = trees.length ? `<g fill="#000" opacity=".28">${trees.filter(t => t.s > 14).map(t => `<ellipse cx="${f(t.x + 4)}" cy="${f(t.y + 5)}" rx="${f(t.s * .5)}" ry="${f(t.s * .18)}"/>`).join('')}</g>` : '';
    const treeSvg = trees.map(t => t.kind === 'fir' ? fir(t) : oak(t)).join('');
    const deadSvg = dead.sort((a, b) => a.y - b.y).map(deadTree).join('');

    /* ── замок на скале ── */
    const castleSvg = (() => {
      const { x, y } = castle, b = y + 44;
      const tower = (tx, top, w, roof) => `<rect x="${f(tx - w / 2)}" y="${f(top)}" width="${f(w)}" height="${f(b - top)}" fill="#1b130d" stroke="#d6a35c" stroke-width="1.4"/>
        <rect x="${f(tx)}" y="${f(top)}" width="${f(w / 2)}" height="${f(b - top)}" fill="#000" opacity=".35"/>
        <path d="M${f(tx - w / 2 - 3)} ${f(top)}L${f(tx)} ${f(top - roof)}L${f(tx + w / 2 + 3)} ${f(top)}Z" fill="#4a0f1c" stroke="#d6a35c" stroke-width="1.3"/>
        <path d="M${f(tx)} ${f(top - roof)}L${f(tx + w / 2 + 3)} ${f(top)}L${f(tx)} ${f(top)}Z" fill="#000" opacity=".35"/>
        <rect x="${f(tx - 2.5)}" y="${f(top + 12)}" width="5" height="8" rx="2.5" fill="#ffb35a"/>`;
      const cren = (x0, x1, top) => { let s = ''; for (let cx = x0; cx < x1 - 4; cx += 9) s += `<rect x="${f(cx)}" y="${f(top - 6)}" width="5" height="6" fill="#1b130d" stroke="#d6a35c" stroke-width="1"/>`; return s; };
      return `<g>
        <circle cx="${x}" cy="${y}" r="190" fill="url(#castleGlow)"/>
        <path d="M${x - 150} ${b + 34}C${x - 120} ${b - 6} ${x - 80} ${b + 4} ${x - 40} ${b - 8}S${x + 70} ${b - 4} ${x + 110} ${b + 6}S${x + 150} ${b + 22} ${x + 165} ${b + 34}Z" fill="#241a11" stroke="#d6a35c" stroke-opacity=".55" stroke-width="1.4"/>
        <path d="M${x - 110} ${b + 22}l14 -10M${x - 70} ${b + 18}l12 -8M${x + 60} ${b + 16}l14 -9M${x + 100} ${b + 24}l12 -8M${x - 20} ${b + 26}l10 -6" stroke="#d6a35c" stroke-opacity=".3"/>
        ${tower(x - 52, y - 48, 20, 26)}${tower(x + 52, y - 52, 20, 28)}
        <rect x="${x - 30}" y="${y - 84}" width="60" height="${b - y + 84}" fill="#1f160f" stroke="#d6a35c" stroke-width="1.5"/>
        <rect x="${x}" y="${y - 84}" width="30" height="${b - y + 84}" fill="#000" opacity=".3"/>
        ${cren(x - 30, x + 30, y - 84)}
        <path d="M${x - 14} ${y - 84}L${x} ${y - 132}L${x + 14} ${y - 84}Z" fill="#4a0f1c" stroke="#d6a35c" stroke-width="1.3"/>
        <path d="M${x} ${y - 132}v-20" stroke="#d6a35c" stroke-width="1.3"/><path d="M${x} ${y - 152}l24 6l-24 7Z" fill="#9a1024" stroke="#d6a35c" stroke-width=".8"/>
        <rect x="${x - 16}" y="${y - 66}" width="6" height="10" rx="3" fill="#ffb35a"/><rect x="${x + 10}" y="${y - 66}" width="6" height="10" rx="3" fill="#ffb35a"/><rect x="${x - 3}" y="${y - 44}" width="6" height="10" rx="3" fill="#ffb35a"/>
        <rect x="${x - 96}" y="${y - 6}" width="192" height="${b - y + 6}" fill="#1b130d" stroke="#d6a35c" stroke-width="1.4"/>
        <path d="${(() => { let d = ''; for (let yy = y + 2, r = 0; yy < b; yy += 8, r++) { d += `M${x - 95} ${yy}H${x + 95}`; for (let xx = x - 96 + (r % 2 ? 8 : 0); xx < x + 96; xx += 16) d += `M${xx} ${yy}v8`; } for (let yy = y - 76, r = 0; yy < y - 6; yy += 8, r++) { d += `M${x - 29} ${yy}H${x + 29}`; for (let xx = x - 30 + (r % 2 ? 7 : 0); xx < x + 30; xx += 14) d += `M${xx} ${yy}v8`; } return d; })()}" stroke="#d6a35c" stroke-opacity=".13"/>
        <rect x="${x}" y="${y - 6}" width="96" height="${b - y + 6}" fill="#000" opacity=".3"/>
        ${cren(x - 96, x + 96, y - 6)}
        <path d="M${x - 11} ${b}v-18a11 11 0 0 1 22 0v18Z" fill="#0a0705" stroke="#d6a35c" stroke-width="1.2"/>
        ${tower(x - 100, y - 30, 26, 32)}${tower(x + 100, y - 30, 26, 32)}
        <g fill="#ffb35a" opacity=".9"><rect x="${x - 60}" y="${y + 10}" width="4" height="6"/><rect x="${x + 44}" y="${y + 12}" width="4" height="6"/><rect x="${x - 38}" y="${y + 20}" width="4" height="6"/></g>
        <circle cx="${x}" cy="${y - 50}" r="70" fill="url(#windowGlow)"/>
        <path d="M${x + 60} ${y - 90}c-8 -14 10 -22 2 -38c-6 -12 8 -20 4 -32" fill="none" stroke="#a3958a" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>
      </g>`;
    })();

    /* ── деревня с таверной ── */
    const townSvg = (() => {
      const house = (hx, hy, w, h, roof, big) => `<g>
        ${big ? '' : `<rect x="${f(hx + w * .18)}" y="${f(hy - h - roof * .8)}" width="5" height="${f(roof * .7)}" fill="#1b130d" stroke="#d6a35c" stroke-width=".8"/><path d="M${f(hx + w * .18 + 2)} ${f(hy - h - roof * .9)}c-6 -8 6 -12 0 -20c-4 -6 4 -10 2 -16" fill="none" stroke="#a3958a" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`}
        <rect x="${f(hx - w / 2)}" y="${f(hy - h)}" width="${f(w)}" height="${f(h)}" fill="#221810" stroke="#d6a35c" stroke-width="1.2"/>
        <path d="M${f(hx - w / 2 - 4)} ${f(hy - h)}L${f(hx)} ${f(hy - h - roof)}L${f(hx + w / 2 + 4)} ${f(hy - h)}Z" fill="#3b1a12" stroke="#d6a35c" stroke-width="1.2"/>
        <path d="M${f(hx)} ${f(hy - h - roof)}L${f(hx + w / 2 + 4)} ${f(hy - h)}L${f(hx)} ${f(hy - h)}Z" fill="#000" opacity=".3"/>
        <rect x="${f(hx - w * .28)}" y="${f(hy - h * .62)}" width="${f(w * .18)}" height="${f(h * .28)}" fill="#ffb35a"/>
        ${big ? `<rect x="${f(hx + w * .12)}" y="${f(hy - h * .62)}" width="${f(w * .18)}" height="${f(h * .28)}" fill="#ffb35a"/><path d="M${f(hx + w / 2)} ${f(hy - h * .8)}h14v4" fill="none" stroke="#d6a35c"/><rect x="${f(hx + w / 2 + 8)}" y="${f(hy - h * .8 + 4)}" width="12" height="9" fill="#9a1024" stroke="#d6a35c" stroke-width=".8"/>` : ''}
      </g>`;
      const { x, y } = town;
      const spots = [[-70, -26, 26, 20, 16], [-34, -44, 24, 18, 15], [40, -40, 26, 20, 16], [78, -10, 24, 18, 15], [-56, 26, 26, 20, 16], [62, 34, 24, 18, 14]];
      return `<g><ellipse cx="${x}" cy="${y + 10}" rx="140" ry="70" fill="url(#townGlow)"/>
        ${spots.map(([dx, dy, w, h, r]) => house(x + dx, y + dy, w, h, r)).join('')}
        ${house(x + 4, y + 6, 44, 30, 22, true)}</g>`;
    })();

    /* ── изба на курьих ногах в Тёмной чаще ── */
    const hutSvg = (() => {
      const x = dark.x + 10, y = dark.y + 10;
      return `<g><path d="M${x - 8} ${y + 22}l-5 14l-6 2M${x - 13} ${y + 36}l3 3M${x + 8} ${y + 22}l6 13l6 2M${x + 14} ${y + 35}l-2 4" fill="none" stroke="#d6a35c" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/>
        <rect x="${x - 15}" y="${y}" width="30" height="22" fill="#1c140d" stroke="#d6a35c" stroke-width="1.2"/>
        <path d="M${x - 19} ${y}L${x} ${y - 16}L${x + 19} ${y}Z" fill="#2a1d14" stroke="#d6a35c" stroke-width="1.2"/>
        <rect x="${x - 4}" y="${y + 6}" width="8" height="7" fill="#b9ff9a" opacity=".55"/></g>`;
    })();

    /* ── капкан на поляне ── */
    const trapSvg = `<g transform="translate(${trap.x} ${trap.y})" fill="none" stroke="#d6a35c" stroke-opacity=".85" stroke-width="1.3">
      <circle r="9"/><path d="M-9 0l3 -4l3 4l3 -4l3 4l3 -4l3 4M-9 0l3 4l3 -4l3 4l3 -4l3 4l3 -4"/><path d="M9 0q10 2 16 10" stroke-dasharray="2 2"/></g>`;

    /* ── мост ── */
    const bridgeSvg = `<g transform="translate(${bridge.x} ${bridge.y}) rotate(-8)">
      <path d="M-26 -9h52M-26 9h52" stroke="#d6a35c" stroke-width="1.6"/>
      <rect x="-24" y="-7" width="48" height="14" fill="#2b1e14" stroke="#d6a35c" stroke-width="1"/>
      <path d="M-16 -7v14M-6 -7v14M4 -7v14M14 -7v14" stroke="#d6a35c" stroke-opacity=".45"/></g>`;

    /* ── роза ветров ── */
    const compass = (() => {
      const cx = W - 140, cy = 140; let pts = '';
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 - Math.PI / 2, L = k % 2 ? 46 : 84, w = k % 2 ? 8 : 13;
        const tip = [cx + Math.cos(a) * L, cy + Math.sin(a) * L], l = [cx + Math.cos(a - Math.PI / 2) * w, cy + Math.sin(a - Math.PI / 2) * w], r = [cx + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + Math.PI / 2) * w];
        pts += `<path d="${poly([[cx, cy], l, tip], 1)}" fill="${k % 2 ? '#5a4632' : '#d6a35c'}" stroke="#d6a35c" stroke-width=".8"/><path d="${poly([[cx, cy], tip, r], 1)}" fill="${k % 2 ? '#241a11' : '#6b4a26'}" stroke="#d6a35c" stroke-width=".8"/>`;
      }
      return `<g><circle cx="${cx}" cy="${cy}" r="62" fill="none" stroke="#d6a35c" stroke-opacity=".55" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${cy}" r="55" fill="none" stroke="#d6a35c" stroke-opacity=".5" stroke-width="5" stroke-dasharray="1 4.76"/>
        <circle cx="${cx}" cy="${cy}" r="28" fill="none" stroke="#d6a35c" stroke-opacity=".35"/>
        ${pts}<circle cx="${cx}" cy="${cy}" r="5" fill="#9a1024" stroke="#d6a35c"/></g>`;
    })();

    /* ── картуш-лента под название ── */
    const cart = (() => {
      const x = 70, y = H - 150, w = 360, h = 58;
      return `<g><path d="M${x - 26} ${y + 14}l26 -4v${h}l-26 4l12 -${h / 2 + 2}Z" fill="#3a1418" stroke="#d6a35c" stroke-width="1.2"/>
        <path d="M${x + w + 26} ${y + 14}l-26 -4v${h}l26 4l-12 -${h / 2 + 2}Z" fill="#3a1418" stroke="#d6a35c" stroke-width="1.2"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#5a1620" stroke="#d6a35c" stroke-width="1.5"/>
        <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="none" stroke="#d6a35c" stroke-opacity=".45"/></g>`;
    })();

    /* ── рамка с угловыми узорами ── */
    const corner = (cx, cy, sx, sy) => `<g transform="translate(${cx} ${cy}) scale(${sx} ${sy})" fill="none" stroke="#d6a35c" stroke-width="1.4">
      <path d="M0 46V0h46" stroke-width="2"/><path d="M10 40c0-16 14-30 30-30" stroke-opacity=".6"/><path d="M22 22l8 -8l8 8l-8 8Z" fill="#9a1024"/><circle cx="6" cy="6" r="3" fill="#d6a35c"/></g>`;
    const frame = `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="#d6a35c" stroke-opacity=".6" stroke-width="2.5"/>
      <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="#d6a35c" stroke-opacity=".3"/>
      <rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="#d6a35c" stroke-opacity=".18" stroke-width="4" stroke-dasharray="2 10"/>
      ${corner(22, 22, 1, 1)}${corner(W - 22, 22, -1, 1)}${corner(22, H - 22, 1, -1)}${corner(W - 22, H - 22, -1, -1)}`;

    /* ── меридианы ── */
    const meridians = [0, 1, 2, 3].map(i => `<path d="M${260 + i * 360} 30Q${230 + i * 360} ${H / 2} ${260 + i * 360} ${H - 30}" fill="none" stroke="#d6a35c" stroke-opacity=".07"/>`).join('') +
      [0, 1, 2].map(i => `<path d="M30 ${260 + i * 240}Q${W / 2} ${230 + i * 240} ${W - 30} ${260 + i * 240}" fill="none" stroke="#d6a35c" stroke-opacity=".07"/>`).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">
  <defs>
    <radialGradient id="paper" cx="50%" cy="50%" r="72%"><stop offset="0" stop-color="#4d3a26"/><stop offset=".5" stop-color="#33261a"/><stop offset="1" stop-color="#130d09"/></radialGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#050302" stop-opacity=".88"/></radialGradient>
    <radialGradient id="castleGlow"><stop offset="0" stop-color="#9a1024" stop-opacity=".45"/><stop offset="1" stop-color="#9a1024" stop-opacity="0"/></radialGradient>
    <radialGradient id="windowGlow"><stop offset="0" stop-color="#ffb35a" stop-opacity=".22"/><stop offset="1" stop-color="#ffb35a" stop-opacity="0"/></radialGradient>
    <radialGradient id="townGlow"><stop offset="0" stop-color="#ff9a3d" stop-opacity=".22"/><stop offset="1" stop-color="#ff9a3d" stop-opacity="0"/></radialGradient>
    <radialGradient id="darkGlow"><stop offset="0" stop-color="#2a0d2e" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .85  0 0 0 0 .7  0 0 0 0 .5  0 0 0 .16 0"/></filter>
    <filter id="stain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0032" numOctaves="4" seed="9"/><feColorMatrix values="0 0 0 0 .04  0 0 0 0 .02  0 0 0 0 .01  0 0 0 -1.6 1.05"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>
  <rect width="${W}" height="${H}" filter="url(#stain)" opacity=".75"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  ${meridians}
  <path d="${poly(border, 1)}" fill="#f0c890" fill-opacity=".025" stroke="#9a1024" stroke-opacity=".5" stroke-width="2" stroke-dasharray="10 6 2 6"/>
  <path d="${tufts}" fill="none" stroke="#d6a35c" stroke-opacity=".2" stroke-width=".9"/>
  ${hills}
  ${fields}
  ${stones}
  ${marsh}
  <ellipse cx="${dark.x}" cy="${dark.y}" rx="210" ry="130" fill="url(#darkGlow)"/>
  <path d="${poly(roadMain)}M${poly(roadSouth).slice(1)}" fill="none" stroke="#d6a35c" stroke-opacity=".08" stroke-width="10" stroke-linecap="round"/>
  <path d="${poly(roadMain)}M${poly(roadSouth).slice(1)}" fill="none" stroke="#d6a35c" stroke-opacity=".6" stroke-width="2.4" stroke-dasharray="1 7" stroke-linecap="round"/>
  <ellipse cx="${lake.x}" cy="${lake.y}" rx="62" ry="30" fill="#1b2a30" stroke="#0b1114" stroke-width="5"/>
  <ellipse cx="${lake.x}" cy="${lake.y}" rx="62" ry="30" fill="none" stroke="#8fb8c4" stroke-opacity=".35"/>
  <path d="${poly(riverPts)}" fill="none" stroke="#0b1114" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${poly(riverPts)}" fill="none" stroke="#21343b" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${poly(riverPts)}" fill="none" stroke="#8fb8c4" stroke-opacity=".35" stroke-width="1.6" stroke-dasharray="14 10"/>
  <path d="M${lake.x - 30} ${lake.y - 4}h18M${lake.x + 6} ${lake.y + 6}h22M${lake.x - 10} ${lake.y + 14}h14" stroke="#8fb8c4" stroke-opacity=".4"/>
  ${mountSvg}
  ${bridgeSvg}
  ${forestFloor}
  ${forestShadow}
  ${treeSvg}
  ${deadSvg}
  ${hutSvg}
  ${trapSvg}
  ${castleSvg}
  ${townSvg}
  ${compass}
  ${cart}
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  ${frame}
</svg>`;
    return { svg, route, W, H, dark, trap, lake, bridge };
  }

  return { build, poly };
})();
