#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/client/package.json"

CURRENT=$(node -p "require('$PKG').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Разряд переносим только из patch в minor. Раньше здесь был ещё перенос из
# minor в major при minor>=10, и на версии 2.14.9 он сработал разом: 2.14.9
# превратилось в 3.0.0, хотя major поднимать никто не собирался. Major теперь
# поднимается только руками — это решение о продукте, а не арифметика.
PATCH=$((PATCH + 1))
if [ "$PATCH" -ge 10 ]; then
  PATCH=0
  MINOR=$((MINOR + 1))
fi

NEW="$MAJOR.$MINOR.$PATCH"

node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG'));
  pkg.version = '$NEW';
  fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
"

echo "$NEW"
