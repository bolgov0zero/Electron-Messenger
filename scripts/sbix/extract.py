# -*- coding: utf-8 -*-
"""Шаг 1. Скачивает у Google Fonts части шрифта Noto Color Emoji в варианте для Safari
(SVG-в-OpenType) и раскладывает их SVG-документы в work/docs, а список глифов — в work/tasks.json.
Состав частей и их диапазоны символов берём у Google как есть.
Результат: work/chunks/N.woff2, work/chunks.css, work/docs/N_START.svg, work/tasks.json"""
import json, os, re, urllib.request
from fontTools.ttLib import TTFont

WORK = os.environ['WORK']
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
def get(url): return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})).read()

for d in ('chunks', 'docs'): os.makedirs(f'{WORK}/{d}', exist_ok=True)
css = get('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji').decode()
open(WORK + '/chunks.css', 'w', encoding='utf-8').write(css)
tasks = []; ranges = {}
for b in re.findall(r'@font-face\s*\{[^}]*\}', css):
    m = re.search(r'url\((https://[^)]+\.(\d+)\.woff2)\)', b); idx = int(m.group(2))
    ranges[idx] = re.search(r'unicode-range:\s*([^;]*);', b).group(1).strip()
    path = f'{WORK}/chunks/{idx}.woff2'
    if not os.path.exists(path): open(path, 'wb').write(get(m.group(1)))
    f = TTFont(path)
    for d in f['SVG '].docList:
        data = d.data if isinstance(d.data, str) else d.data.decode('utf-8')
        open(f'{WORK}/docs/{idx}_{d.startGlyphID}.svg', 'w', encoding='utf-8').write(data)
        for gid in range(d.startGlyphID, d.endGlyphID + 1): tasks.append([idx, d.startGlyphID, gid])
    print(idx, len(f.getGlyphOrder()), 'глифов,', sum(1 for t in tasks if t[0] == idx), 'с картинкой')
json.dump({'ranges': ranges, 'tasks': tasks}, open(WORK + '/tasks.json', 'w'))
print('всего картинок:', len(tasks))
