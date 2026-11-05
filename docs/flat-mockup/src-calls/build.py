#!/usr/bin/env python3
"""Сборка docs/flat-mockup/calls.html: стеклянный макет звонков docs/glass-mockup/calls.html + токены варианта B (из src/flat-b.css) + calls-b.css.
Запуск из папки docs/flat-mockup/src-calls:  python3 -I build.py"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
rd = lambda p: open(p, encoding='utf-8').read()
src = rd(os.path.join(ROOT, 'docs/glass-mockup/calls.html'))


def sub(old, new):
    global src
    assert src.count(old) >= 1, 'не найдено: ' + old[:70]
    src = src.replace(old, new, 1)


# токены B — общий блок из flat-b.css (до раздела «поверхности»)
fb = rd(os.path.join(ROOT, 'docs/flat-mockup/src/flat-b.css'))
tokens = fb[:fb.index('/* ───── поверхности')]
sub('<title>Макет: аудио- и видеозвонки</title>', '<title>Макет: звонки, вариант B (без стекла)</title>')
sub('family=Inter:wght@400;500;600;700;800&display=swap', 'family=Inter:wght@400;500;600;700;800&display=swap')
sub('</style>\n</head>', tokens + '\n' + rd(os.path.join(HERE, 'calls-b.css')) + '\n</style>\n</head>')
sub('<h1>Макет: звонки</h1>', '<h1>Звонки · вариант B</h1><a class="btn sm" href="index.html">← Десктоп</a><a class="btn sm" href="mobile.html">Мобильный →</a>')
out = os.path.join(ROOT, 'docs/flat-mockup/calls.html')
open(out, 'w', encoding='utf-8').write(src)
print('готово:', out, len(src), 'байт')
