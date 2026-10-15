// Превью ссылок: сервер забирает у страницы заголовок, имя сайта и картинку (og-теги). Запрос идёт всегда с сервера,
// чтобы адрес и устройство человека не светились на чужом сайте. Картинка сжимается и ложится в chat_db/linkprev.
// Защита от SSRF: адрес проверяется при каждом соединении (в том числе после редиректов), во внутреннюю сеть не ходим.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const DIR = path.join(path.dirname(DB_PATH), 'linkprev');
fs.mkdirSync(DIR, { recursive: true });

let sharp = null;
try { sharp = require('sharp'); } catch {}

// Частные, служебные и локальные адреса
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (m) return isPrivateIp(m[1]);
    return /^(fc|fd|fe[89ab])/.test(v) || v.startsWith('ff');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

// Проверка адреса в момент соединения: соединяемся только с тем, что проверили
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = list.filter(a => !isPrivateIp(a.address));
    if (!ok.length) return cb(new Error('private address'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

// Загрузка с ограничениями: время, размер, число редиректов. Возвращает { buf, type, url } или null
function get(url, { max, accept, partial, depth = 0 }) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return resolve(null);
    if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return resolve(null);
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && isPrivateIp(bare)) return resolve(null);
    const lib = u.protocol === 'https:' ? https : http;
    let done = false, timer = null;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = lib.request(u, {
      method: 'GET', lookup: safeLookup, timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ElectronLinkPreview/1.0)', Accept: accept, 'Accept-Language': 'ru,en;q=0.8' },
    }, res => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (depth >= 3) return finish(null);
        let next; try { next = new URL(res.headers.location, u).toString(); } catch { return finish(null); }
        return get(next, { max, accept, partial, depth: depth + 1 }).then(finish);
      }
      if (code !== 200) { res.resume(); return finish(null); }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const chunks = []; let size = 0;
      res.on('data', c => {
        size += c.length;
        chunks.push(c);
        // Страница большая: теги лежат в начале, поэтому берём начало (картинки целиком нужны, их обрываем отказом)
        if (size > max) { res.destroy(); return finish(partial ? { buf: Buffer.concat(chunks).subarray(0, max), type: String(res.headers['content-type'] || '').toLowerCase(), url: u.toString() } : null); }
      });
      res.on('end', () => finish({ buf: Buffer.concat(chunks), type, url: u.toString() }));
      res.on('error', () => finish(null));
    });
    timer = setTimeout(() => { req.destroy(); finish(null); }, 9000);
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
    req.end();
  });
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };
function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}

// Значение meta-тега по property/name, в любом порядке атрибутов
function meta(html, names) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const n of names) {
    for (const t of tags) {
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(t);
      if (!key || key[1].toLowerCase() !== n) continue;
      const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(t);
      if (c && (c[1] || c[2])) return decode(c[1] || c[2]);
    }
  }
  return '';
}

const cache = new Map();   // url -> { at, data }
const TTL = 3600e3;

async function fetchPreview(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const page = await get(url, { max: 768 * 1024, partial: true, accept: 'text/html,application/xhtml+xml;q=0.9' });
  let data = null;
  if (page && /html|xml/.test(page.type)) {
    let html = page.buf.toString('utf8');
    const cs = /charset=["']?([\w-]+)/i.exec(page.type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(html.slice(0, 2048));
    if (cs && /^(windows-1251|cp1251)$/i.test(cs[1])) { try { html = new TextDecoder('windows-1251').decode(page.buf); } catch {} }
    const head = html.slice(0, 200000);
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
    const title = (meta(head, ['og:title', 'twitter:title']) || decode(t ? t[1] : '')).slice(0, 200);
    const host = new URL(page.url).hostname.replace(/^www\./, '');
    const site = (meta(head, ['og:site_name']) || host).slice(0, 100);
    let image = null;
    const img = meta(head, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
    if (img && sharp) {
      try { image = await saveImage(new URL(img, page.url).toString()); } catch {}
    }
    if (title || image) data = { url: page.url.length <= 600 ? page.url : url, title, site, image };
  }
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

async function saveImage(src) {
  const r = await get(src, { max: 6 * 1024 * 1024, accept: 'image/*' });
  if (!r || !/^image\/(jpeg|png|webp|gif)/.test(r.type)) return null;
  const name = crypto.createHash('sha256').update(src).digest('hex').slice(0, 32) + '.jpg';
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) {
    const out = await sharp(r.buf, { limitInputPixels: 40e6 }).rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    fs.writeFileSync(file, out);
  }
  return '/lp/' + name;
}

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

// Превью из присланного клиентом сообщения: чужих картинок не принимаем, только наши
function sanitize(p) {
  if (!p || typeof p !== 'object') return null;
  let url = str(p.url, 600);
  try { const x = new URL(url); if (x.protocol !== 'http:' && x.protocol !== 'https:') return null; url = x.toString(); } catch { return null; }
  const title = str(p.title, 200), site = str(p.site, 100);
  let image = null;
  if (typeof p.image === 'string' && /^\/lp\/[a-f0-9]{32}\.jpg$/.test(p.image) && fs.existsSync(path.join(DIR, p.image.slice(4)))) image = p.image;
  if (!title && !image) return null;
  return { url, title, site, image };
}

module.exports = { fetchPreview, sanitize, DIR, isPrivateIp };
