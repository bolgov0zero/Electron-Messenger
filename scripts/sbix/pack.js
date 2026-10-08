// Шаг 3. Сжимает PNG из work/png в палитровые (256 цветов): шрифт получается в разы легче.
const fs = require('fs'), path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'sharp'));
const WORK = process.env.WORK;
(async () => {
  const src = path.join(WORK, 'png'), dst = path.join(WORK, 'pngq');
  fs.mkdirSync(dst, { recursive: true });
  let a = 0, b = 0, n = 0;
  const files = fs.readdirSync(src).filter(f => f.endsWith('.png'));
  for (let i = 0; i < files.length; i += 16) {
    await Promise.all(files.slice(i, i + 16).map(async f => {
      const buf = fs.readFileSync(path.join(src, f));
      const q = await sharp(buf).png({ palette: true, quality: 85, effort: 8, compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(path.join(dst, f), q); a += buf.length; b += q.length; n++;
    }));
  }
  console.log(`${n} картинок: ${(a / 1048576).toFixed(1)} МБ → ${(b / 1048576).toFixed(1)} МБ`);
})();
