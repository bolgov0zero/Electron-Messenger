#!/usr/bin/env node
// Готовит фоновые узоры переписки из исходников в assets/patterns-src.
//
// Исходники — обои под экран телефона: чёрная обводка на прозрачном фоне. Два
// препятствия. Первое: края не сходятся, при замощении виден шов, — поэтому
// собираем зеркальную плитку 2×2 (оригинал плюс три отражения), такая стыкуется
// сама с собой при любом размере. Второе: цвет узора зависит от темы, а в
// картинке он всегда чёрный, — поэтому цвет из файла не нужен вовсе, клиент
// использует картинку как маску и заливает её цветом темы. Храним только альфу,
// огрублённую до восьми уровней: на штрихе разницы не видно даже вблизи, а
// файл выходит вчетверо легче.
//
// Запуск: node scripts/build-patterns.js

const sharp = require('/Users/bolgov/Documents/My Projects/Chat/server/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'patterns-src');
const OUT = [
  path.join(ROOT, 'client', 'src', 'assets', 'patterns'),
  path.join(ROOT, 'server', 'src', 'public', 'chat', 'assets', 'patterns'),
];

const QUAD = 480;        // ширина четверти плитки в пикселях
const ALPHA_LEVELS = 8;  // ступеней прозрачности

(async () => {
  for (const dir of OUT) fs.mkdirSync(dir, { recursive: true });

  for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.png')).sort()) {
    const meta = await sharp(path.join(SRC, file)).metadata();
    const quadH = Math.round(QUAD * meta.height / meta.width);

    const raw = await sharp(path.join(SRC, file))
      .resize(QUAD, quadH).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const step = 255 / (ALPHA_LEVELS - 1);
    for (let i = 3; i < raw.data.length; i += raw.info.channels) {
      raw.data[i] = Math.round(Math.round(raw.data[i] / step) * step);
    }

    const quad = await sharp(raw.data, { raw: raw.info }).toColourspace('b-w').png().toBuffer();
    const [flipH, flipV, flipHV] = await Promise.all([
      sharp(quad).flop().png().toBuffer(),
      sharp(quad).flip().png().toBuffer(),
      sharp(quad).flop().flip().png().toBuffer(),
    ]);

    const tile = await sharp({ create: {
        width: QUAD * 2, height: quadH * 2, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: quad,   left: 0,    top: 0 },
        { input: flipH,  left: QUAD, top: 0 },
        { input: flipV,  left: 0,    top: quadH },
        { input: flipHV, left: QUAD, top: quadH },
      ])
      .png({ compressionLevel: 9, effort: 10, palette: true, colours: ALPHA_LEVELS })
      .toBuffer();

    for (const dir of OUT) fs.writeFileSync(path.join(dir, file), tile);
    console.log(`${file.padEnd(16)} ${QUAD * 2}×${quadH * 2}  ${Math.round(tile.length / 1024)} КБ`);
  }
})();
