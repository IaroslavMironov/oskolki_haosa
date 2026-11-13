#!/usr/bin/env python3
"""Пережимает все *.jpg из корня сайта в WebP нескольких размеров → opt/.

Запуск из корня проекта:  python3 tools/optimize.py
Нужен Pillow:              pip3 install pillow

Сайт сам подхватывает оптимизированные версии через opt/manifest.js,
а если картинки там нет (например, только что добавили новую) — показывает оригинал.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'opt'
WIDTHS = [160, 480, 960]  # + оригинальная ширина (160 — миниатюры)
QUALITY = 78

OUT.mkdir(exist_ok=True)
manifest = {}
for src in sorted(ROOT.glob('*.jpg')):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    sizes = [x for x in WIDTHS if x < w] + [w]
    for tw in sizes:
        dst = OUT / f'{src.stem}-{tw}.webp'
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            im.resize((tw, round(h * tw / w)), Image.LANCZOS).save(dst, 'WEBP', quality=QUALITY, method=6)
    manifest[src.name] = sizes
    print(f'{src.name:16} {w}x{h} → {sizes}')

(OUT / 'manifest.js').write_text(
    '// сгенерировано tools/optimize.py — не править руками\nwindow.OPT = ' + json.dumps(manifest, ensure_ascii=False) + ';\n',
    encoding='utf-8')
print('manifest:', len(manifest), 'картинок')
