// Сравнение двух папок со снимками (до/после): node compare.js <до> <после> [порог по каналу, 12] [выход: папка с картинками различий]
// Печатает по каждому файлу долю отличающихся пикселей; различия сохраняются в виде красной маски поверх затемнённого снимка «после».
const path = require('path'), fs = require('fs');
const sharp = require(require.resolve('sharp', { paths: [path.resolve(__dirname, '../../../server')] }));
const [A, B, TH = '12', OUT] = process.argv.slice(2);
(async () => {
  const th = +TH, rows = [];
  for (const f of fs.readdirSync(A).filter(x => x.endsWith('.png')).sort()) {
    if (!fs.existsSync(path.join(B, f))) { rows.push([f, 'нет в «после»', 1]); continue; }
    const a = await sharp(path.join(A, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(path.join(B, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) { rows.push([f, 'размеры', 1]); continue; }
    let n = 0; const o = Buffer.from(b.data);
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > th) { n++; o[i] = 255; o[i + 1] = 0; o[i + 2] = 0; } else { o[i] >>= 2; o[i + 1] >>= 2; o[i + 2] >>= 2; }
    }
    const r = n / (a.info.width * a.info.height);
    rows.push([f, n, r]);
    if (OUT && n) { fs.mkdirSync(OUT, { recursive: true }); await sharp(o, { raw: { width: b.info.width, height: b.info.height, channels: 4 } }).png().toFile(path.join(OUT, f)); }
  }
  rows.sort((x, y) => y[2] - x[2]);
  const bad = rows.filter(r => r[2] > 0.001);
  console.log('файлов:', rows.length, ' с различием >0.1% пикселей:', bad.length);
  bad.forEach(r => console.log((r[2] * 100).toFixed(2) + '%', r[0]));
})();
