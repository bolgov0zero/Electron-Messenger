#!/bin/bash
# Сборка server/src/public/shared/video-prep.js (+ копия в client/src/).
# Зависимости ставятся сами (npm i в этом каталоге; node_modules в git не входит).
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm i --no-audit --no-fund
npx esbuild entry.js --bundle --minify --format=iife --target=es2020 \
  --legal-comments=none --outfile=../../server/src/public/shared/video-prep.js
cp ../../server/src/public/shared/video-prep.js ../../client/src/video-prep.js
ls -la ../../server/src/public/shared/video-prep.js
