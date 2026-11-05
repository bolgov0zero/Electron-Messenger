#!/usr/bin/env python3
# Разовая правка: шрифт макетов — Inter (у DM Sans нет кириллицы). Запуск из папки docs/flat-mockup.
import re
for p in ['src/flat-b.css', 'src-mobile/flat-b-m.css']:
    s = open(p, encoding='utf-8').read()
    s = s.replace("--ff:'DM Sans',-apple-system,system-ui,sans-serif;", "--ff:Inter,-apple-system,system-ui,sans-serif;")
    s = s.replace('шрифт DM Sans', 'шрифт Inter').replace('DM Sans', 'Inter')
    open(p, 'w', encoding='utf-8').write(s)
for p in ['src/build.py', 'src-calls/build.py', 'src-mobile/build.py']:
    s = open(p, encoding='utf-8').read()
    s = re.sub(r"&family=DM\+Sans:ital,opsz,wght@0,9\.\.40,400;0,9\.\.40,500;0,9\.\.40,600;0,9\.\.40,700", '', s)
    s = s.replace('<td>DM Sans</td>', '<td>Inter</td>')
    open(p, 'w', encoding='utf-8').write(s)
print('ok')
