#!/usr/bin/env python3
"""Сборка макета панели смайлов: вшивает настоящие данные (client/src/emoji-data.js) в шаблон.
Запуск: python3 docs/flat-mockup/src-emoji/build.py → docs/flat-mockup/emoji.html"""
import pathlib

here = pathlib.Path(__file__).resolve().parent
root = here.parents[2]
data = (root / 'client/src/emoji-data.js').read_text(encoding='utf-8')
tpl = (here / 'emoji.tpl.html').read_text(encoding='utf-8')
out = tpl.replace('/*DATA*/', data.replace('</script', '<\\/script'))
(here.parent / 'emoji.html').write_text(out, encoding='utf-8')
print('emoji.html', len(out) // 1024, 'КБ')
