#!/bin/bash
# Снимки основного окна Электрона по темам из config.json: ./shot-electron.sh <config.json> [тема ...]   (по умолчанию light navy)
HERE="$(cd "$(dirname "$0")" && pwd)"; CFG="$1"; shift
THEMES="${@:-light navy}"
cd "$HERE/../../../client" || exit 1
for t in $THEMES; do timeout 280 npx electron "$HERE/shot-electron.js" "$CFG" "$t" 2>&1 | grep -v "Push\|incognito\|service_worker\|mach_port\|quota\|field_trial\|Autofill\|dbus\|ERROR:\(gpu\|command\)"; done
