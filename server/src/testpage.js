'use strict';
// /test — тестовая страница ленты мобильного клиента: настоящий интерфейс /m на выдуманных данных (200 сообщений, картинки,
// превью ссылок, события), без входа и без обращений к чатам. Нужна, чтобы проверять прокрутку и измерять рывки.
// Картинки рисуются на лету по адресу /test/img/<n>.jpg?w=&h=&delay= и кэшируются в памяти; delay имитирует медленную сеть.
const fs = require('fs');
const path = require('path');
let sharp = null;
try { sharp = require('sharp'); } catch {}

const M_INDEX = path.join(__dirname, 'public/m/index.html');
const cache = new Map();   // ключ → Buffer, не больше 80 штук
const CAP = (v, min, max, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function svgFor(id, w, h) {
  const hue = (id * 47) % 360, hue2 = (hue + 70) % 360;
  let s = 1 + id; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  let shapes = '';
  for (let i = 0; i < 70; i++) {
    const cx = Math.round(rnd() * w), cy = Math.round(rnd() * h), r = Math.round((0.02 + rnd() * 0.12) * Math.min(w, h));
    shapes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${Math.round(rnd() * 360)},70%,${40 + Math.round(rnd() * 35)}%)" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`;
  }
  const fs = Math.round(Math.min(w, h) * 0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,45%)"/><stop offset="1" stop-color="hsl(${hue2},70%,62%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes}<text x="50%" y="52%" font-size="${fs}" font-family="Arial" font-weight="700" fill="#fff" fill-opacity=".9" text-anchor="middle">${id}</text><text x="50%" y="${Math.round(h * 0.9)}" font-size="${Math.round(fs / 4)}" font-family="Arial" fill="#fff" fill-opacity=".8" text-anchor="middle">${w}×${h}</text></svg>`;
}

function mount(app, express, serverVersion) {
  app.get(['/test/img/:id.jpg', '/test/img/:id.svg'], async (req, res) => {
    const id = CAP(req.params.id, 0, 9999, 0), w = CAP(req.query.w, 16, 4000, 800), h = CAP(req.query.h, 16, 4000, 600), delay = CAP(req.query.delay, 0, 4000, 0);
    const key = `${id}:${w}:${h}`;
    let buf = cache.get(key), type = 'image/jpeg';
    if (!buf) {
      const svg = svgFor(id, w, h);
      if (sharp) { try { buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer(); } catch {} }
      if (!buf) { buf = Buffer.from(svg); type = 'image/svg+xml'; }
      if (cache.size >= 80) cache.delete(cache.keys().next().value);
      cache.set(key, buf);
    } else if (!sharp) type = 'image/svg+xml';
    setTimeout(() => { res.set('Cache-Control', 'public, max-age=3600').type(type).send(buf); }, delay);
  });
  // Страница: тот же index.html, что у /m, но вместо входа — выдуманные данные (public/test/boot.js) и панель измерений
  app.get(['/test', '/test/', '/test/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const v = serverVersion();
      const html = fs.readFileSync(M_INDEX, 'utf8').replace(/\?v=[\w.\-]+/g, '?v=' + v)
        .replace('<script src="/m/js/main.js?v=' + v + '"></script>', `<link rel="stylesheet" href="/test/test.css?v=${v}"><script src="/test/boot.js?v=${v}"></script>\n<script src="/m/js/main.js?v=${v}"></script>`)
        .replace('<title>Electron</title>', '<title>Тест ленты</title>');
      res.type('html').send(html);
    } catch (e) { res.status(500).send('test page error'); }
  });
  app.use('/test', express.static(path.join(__dirname, 'public/test'), { maxAge: 0 }));
}
module.exports = { mount };
