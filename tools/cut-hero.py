#!/usr/bin/env python3
"""Режет портрет героя (cover.jpg) на осколки с прозрачностью: opt/hero-shard-{0..5}.webp.

Зачем: раньше каждый осколок вырезался на лету через CSS clip-path — на Android это
отдельный слой-маска, который видеокарта пересчитывает в каждом кадре прокрутки.
Готовые кусочки — просто картинки, их двигать дёшево.

Многоугольники — в процентах картинки; те же самые в app.js (polys в initHero). Поменял тут — поменяй там.
Запуск из корня проекта:  python3 tools/cut-hero.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
C = (52, 36)
POLYS = [
    [C, (30, 0), (100, 0), (100, 14)],
    [C, (100, 14), (100, 66)],
    [C, (100, 66), (100, 100), (64, 100)],
    [C, (64, 100), (0, 100), (0, 82)],
    [C, (0, 82), (0, 26)],
    [C, (0, 26), (0, 0), (30, 0)],
]
SS = 4  # сглаживание края: маску рисуем в 4 раза крупнее и уменьшаем

src = Image.open(ROOT / 'cover.jpg').convert('RGB')
W, H = src.size
for i, poly in enumerate(POLYS):
    pts = [(x / 100 * W, y / 100 * H) for x, y in poly]
    x0, y0 = int(min(p[0] for p in pts)), int(min(p[1] for p in pts))
    x1, y1 = -(-max(p[0] for p in pts) // 1), -(-max(p[1] for p in pts) // 1)
    x1, y1 = int(x1), int(y1)
    w, h = x1 - x0, y1 - y0
    mask = Image.new('L', (w * SS, h * SS), 0)
    ImageDraw.Draw(mask).polygon([((x - x0) * SS, (y - y0) * SS) for x, y in pts], fill=255)
    piece = src.crop((x0, y0, x1, y1)).convert('RGBA')
    piece.putalpha(mask.resize((w, h), Image.LANCZOS))
    out = ROOT / 'opt' / f'hero-shard-{i}.webp'
    piece.save(out, 'WEBP', quality=80, method=6)
    print(out.relative_to(ROOT), f'{w}x{h}', f'{out.stat().st_size // 1024} KB')
