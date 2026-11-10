#!/usr/bin/env python3
"""Складывает прозрачные снимки callin-*.png поверх серого фона и печатает альфу углов окна: python3 composite-callin.py <папка>"""
import sys, glob, os
from PIL import Image
d = sys.argv[1]
for f in sorted(glob.glob(os.path.join(d, 'callin-*.png'))):
    if f.endswith('-on.png'): continue
    im = Image.open(f).convert('RGBA'); w, h = im.size
    print(os.path.basename(f), im.size, 'углы альфа:', [im.getpixel(p)[3] for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]])
    bg = Image.new('RGBA', (w + 40, h + 40), (150, 160, 172, 255) if '-navy' not in f else (40, 46, 54, 255))
    bg.alpha_composite(im, (20, 20)); bg.convert('RGB').save(f[:-4] + '-on.png')
