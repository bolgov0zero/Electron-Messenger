#!/bin/bash
# Снимки живого /m по всем темам из config.json: ./live.sh <config.json> [тема ...]   (по умолчанию light dark navy)
HERE="$(cd "$(dirname "$0")" && pwd)"; CFG="$1"; shift
THEMES="${@:-light dark navy}"
cd "$HERE/../../../client" || exit 1
for t in $THEMES; do timeout 280 npx electron "$HERE/shot-live.js" "$CFG" "$t" 2>&1 | grep -v "Push\|incognito\|service_worker\|mach_port\|quota\|field_trial"; done
