#!/bin/sh
# Сборка шрифта Noto Color Emoji в формате sbix для Safari и iPhone.
# Нужно: Python с fonttools и brotli (pip install fonttools brotli), Electron из client/node_modules,
# sharp из server/node_modules. Запуск: WORK=/tmp/sbix OUT=server/src/public/chat/assets/fonts-sbix sh scripts/sbix/build.sh
set -e
D="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-python3}"
ELECTRON="${ELECTRON:-$D/../../client/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}"
: "${WORK:?задайте WORK}"; : "${OUT:?задайте OUT}"
WORK="$WORK" $PY "$D/extract.py"
WORK="$WORK" "$ELECTRON" "$D/render.js" 2>&1 | grep -v 'ERROR:\|WARNING' | tr '\r' '\n' | tail -2
WORK="$WORK" node "$D/pack.js"
WORK="$WORK" OUT="$OUT" $PY "$D/build.py"
