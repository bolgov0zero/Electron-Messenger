# -*- coding: utf-8 -*-
"""Шаг 4. Собирает из частей Google шрифты sbix: в каждой части убирает SVG-таблицу и кладёт
вместо неё PNG из work/pngq. cmap и таблица лигатур (составные смайлы) остаются от Google.
Результат: OUT/noto-sbix-N.woff2 и OUT/../noto-emoji-sbix.css с описанием частей."""
import json, os, re
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.sbixStrike import Strike
from fontTools.ttLib.tables.sbixGlyph import Glyph as SG
from fontTools.ttLib.scaleUpem import scale_upem

WORK, OUT = os.environ['WORK'], os.environ['OUT']
PPEM, BELOW = 128, -31         # картинки нарисованы при кегле 128 px, низ на 31 px ниже базовой линии
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(WORK + '/tasks.json'))
ranges = {int(k): v for k, v in meta['ranges'].items()}
total = 0
for idx in sorted(ranges):
    f = TTFont(f'{WORK}/chunks/{idx}.woff2')
    order = f.getGlyphOrder()
    sbix = newTable('sbix'); sbix.version = 1; sbix.flags = 1
    strike = Strike(ppem=PPEM, resolution=72)
    n = 0
    for d in f['SVG '].docList:
        for gid in range(d.startGlyphID, d.endGlyphID + 1):
            p = f'{WORK}/pngq/{idx}_{gid}.png'
            if not os.path.exists(p): continue
            name = order[gid]
            strike.glyphs[name] = SG(glyphName=name, graphicType='png ', imageData=open(p, 'rb').read(), originOffsetX=0, originOffsetY=BELOW)
            n += 1
    sbix.strikes[PPEM] = strike
    del f['SVG ']
    # У частей Google 1024 единицы на em, а Apple (CoreText) масштабирует картинки sbix с учётом этой величины:
    # при 1024 смайлы выходят вдвое мельче. Приводим к 2048, как у самого Noto.
    if f['head'].unitsPerEm != 2048: scale_upem(f, 2048)
    f['sbix'] = sbix
    f.flavor = 'woff2'
    path = f'{OUT}/noto-sbix-{idx}.woff2'
    f.save(path)
    size = os.path.getsize(path); total += size
    print(idx, n, 'картинок,', round(size / 1024), 'КБ')
print('всего', round(total / 1048576, 1), 'МБ')
# CSS: те же диапазоны символов, что у Google. Адреса — от места, где лежит CSS
faces = []
for idx in sorted(ranges):
    faces.append("@font-face {\n  font-family: '@@FAMILY@@';\n  font-style: normal; font-weight: 400; font-display: swap;\n"
                 f"  src: url('@@DIR@@/noto-sbix-{idx}.woff2') format('woff2');\n  unicode-range: {ranges[idx]};\n}}")
open(WORK + '/sbix-faces.css', 'w', encoding='utf-8').write('\n'.join(faces) + '\n')
