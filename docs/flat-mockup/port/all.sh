#!/bin/bash
# Снимки ВСЕХ сцен живого /m во всех темах в одну папку: ./all.sh <папка> [акцент]   (стенд должен быть запущен: serve.sh start)
HERE="$(cd "$(dirname "$0")" && pwd)"
SCR=/private/tmp/claude-501/-Users-bolgov-Documents-My-Projects-Chat/1b100143-140b-4b9d-bfad-21021ebb6c08/scratchpad
OUT="$1"; ACC="${2:-teal}"
SC=$(python3 - <<PY
import runpy,sys,os
sys.argv=['scenes.py','live','/tmp/none','dark','teal','chats','/tmp/none.json']
g=runpy.run_path('$HERE/scenes.py'); print(','.join(g['LIVE'].keys()))
PY
)
SC=$(echo "$SC" | tail -1)
rm -f /tmp/none.json
mkdir -p "$OUT"
for t in light dark navy; do
  python3 "$HERE/scenes.py" live "$OUT" $t $ACC "$SC" "$SCR/cfg-all-$t.json" >/dev/null
  python3 - <<PY
import json
p='$SCR/cfg-all-$t.json'; c=json.load(open(p)); c['runs'][0]['storage']=[['m_spaces_rail','1']]; json.dump(c,open(p,'w'),ensure_ascii=False)
PY
  "$HERE/live.sh" "$SCR/cfg-all-$t.json" $t 2>&1 | grep -v "vibrate\|ResizeObserver"
done
echo ALLDONE
