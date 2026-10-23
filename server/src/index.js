const http = require('http');
const express = require('express');
require('./asyncsafe');
// Задачи запуска, которые обращаются к базе: выполняются после dal.init(), до открытия порта
const boot = [];
const dal = require('./dal');
// На время перевода на асинхронный слой данных: забытый await или сбой запроса
// пишется в журнал, а не роняет весь сервер
process.on('unhandledRejection', e => console.error('[Необработанная ошибка]', e));
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');

const app = express();
// Доверяем первому прокси (nginx): req.ip берётся из X-Forwarded-For корректно,
// а не из самодельного разбора заголовка, который можно подделать
app.set('trust proxy', 1);
const server = http.createServer(app);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Для всех ответов: не отдавать чужим сайтам полный адрес страницы и выключить возможности браузера, которыми клиенты не пользуются
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Микрофон, геолокация и платежи: только сам сайт, адрес указан явно (так проверяют сканеры); клиенты ими не пользуются
  const ph = String(req.headers.host || '').replace(/[^\w.:\-\[\]]/g, '');
  const own = ph ? `(self "${req.protocol}://${ph}")` : '(self)';
  res.setHeader('Permissions-Policy', `camera=(), microphone=${own}, geolocation=${own}, payment=${own}, usb=(), display-capture=(), serial=(), bluetooth=()`);
  next();
});
// Защитные заголовки страниц (админка, веб-клиент, мобильный клиент, страница гостя): их нельзя встроить в чужой сайт, а скрипты,
// внешние адреса и подключения ограничены. Политика мягкая: inline-скрипты и стили разрешены, потому что клиенты на них построены
const PAGE_PATH = /^\/(admin|chat|m|g)(\/|$)/;
app.use((req, res, next) => {
  if (!PAGE_PATH.test(req.path)) return next();
  const host = String(req.headers.host || '').replace(/[^\w.:\-\[\]]/g, '');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src * data: blob:",
    "media-src * data: blob:",
    `connect-src 'self' blob: data: ws://${host} wss://${host} https://api.klipy.com https://api.giphy.com`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

// Пока идёт перенос базы, изменяющие запросы не принимаются (запись всё равно запрещена в dal)
app.use((req, res, next) => {
  if (!require('./maintenance').isOn() || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.path.startsWith('/api/admin/database')) return next();
  res.status(503).json({ error: 'Идёт перенос базы данных, попробуйте через несколько минут', code: 'maintenance' });
});

app.use(express.json({ limit: '10mb' }));
// index.html админки — всегда свежий: HTTP-кэш уже приводил к устаревшей админке после обновления
app.get(['/admin', '/admin/', '/admin/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.get('/chat/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public/chat/manifest.json'));
});
// index.html — всегда свежий (без HTTP-кэша), иначе PWA рендерит старую вёрстку.
// Версию в ?v= подставляем на лету: в файле она была захардкожена и отставала на
// десятки релизов, из-за чего браузер мог держать в кэше старые style.css и app.js.
const CHAT_INDEX = path.join(__dirname, 'public/chat/index.html');
function serverVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version; }
  catch { return '0'; }
}
// Страница ссылается на style.css, app.js и остальное относительными адресами, поэтому без завершающего слэша («/chat»)
// браузер искал бы их в корне сайта и показывал страницу без стилей и скриптов: ведём на «/chat/»
// Главная страница сайта: с телефона ведёт в мобильную версию, с остальных устройств в веб-версию. Редирект временный (302) и без кэша:
// решение зависит от устройства. Планшеты (iPad, Android без слова Mobile) считаются компьютером. Клиент сюда не заходит: ему нужны только /api и /ws
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile.+Android|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile.+Firefox|Firefox.+Mobile/i;
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'User-Agent');
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, (PHONE_UA.test(req.headers['user-agent'] || '') ? '/m/' : '/chat/') + q);
});
app.get('/chat', (req, res, next) => {
  if (req.originalUrl.split('?')[0] !== '/chat') return next();   // маршрут без слэша совпадает и с «/chat/»
  res.redirect(301, '/chat/' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''));
});
app.get(['/chat/', '/chat/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const html = fs.readFileSync(CHAT_INDEX, 'utf8').replace(/\?v=[\w.\-]+/g, '?v=' + serverVersion());
    res.type('html').send(html);
  } catch {
    res.sendFile(CHAT_INDEX);
  }
});
app.use('/chat', express.static(path.join(__dirname, 'public/chat')));
// Страница гостя по ссылке: /g/<токен>. Это тот же веб-клиент (/chat), запущенный в гостевом режиме: страница собирается из
// chat/index.html на лету, поэтому внешний вид и поведение всегда совпадают с веб-версией. Ни кэша, ни индексации,
// ссылка не уходит в Referer. Хранилище браузера у гостя отдельное (см. SHIM), чтобы не задеть сессию того же браузера в /chat
const GUEST_SHIM = `<script>(function(){
  var seg = location.pathname.split('/')[2] || '', P = 'guest:' + seg.slice(0, 24) + ':', real = window.localStorage;
  var own = function () { var o = []; try { for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(P) === 0) o.push(k.slice(P.length)); } } catch (e) {} return o; };
  var api = { getItem: function (k) { return real.getItem(P + k); }, setItem: function (k, v) { real.setItem(P + k, String(v)); }, removeItem: function (k) { real.removeItem(P + k); },
    clear: function () { own().forEach(function (k) { real.removeItem(P + k); }); }, key: function (i) { var o = own(); return i < o.length ? o[i] : null; } };
  var shim = new Proxy({}, {
    get: function (t, p) { if (p === 'length') return own().length; if (typeof p === 'string' && api[p]) return api[p]; return typeof p === 'string' ? real.getItem(P + p) : undefined; },
    set: function (t, p, v) { if (typeof p === 'string') real.setItem(P + p, String(v)); return true; },
    deleteProperty: function (t, p) { if (typeof p === 'string') real.removeItem(P + p); return true; },
    has: function (t, p) { return typeof p === 'string' && (!!api[p] || real.getItem(P + p) !== null); },
    ownKeys: function () { return own(); },
    getOwnPropertyDescriptor: function (t, p) { return typeof p === 'string' && real.getItem(P + p) !== null ? { value: real.getItem(P + p), enumerable: true, configurable: true, writable: true } : undefined; }
  });
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  window.__GUEST__ = { token: decodeURIComponent(seg), ls: real };
})();</script>`;
function guestPageHtml() {
  let html = fs.readFileSync(CHAT_INDEX, 'utf8').replace(/\?v=[\w.\-]+/g, '?v=' + serverVersion());
  html = html.replace('<html lang="ru">', '<html lang="ru" class="guest">')
    .replace('<head>', '<head>\n<base href="/chat/">\n<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="no-referrer">\n' + GUEST_SHIM)
    .replace(/\(function\(\)\{\s*var mq = matchMedia[\s\S]*?\}\)\(\);/, '')           // заглушка «для телефона есть /m»: гость открывает ссылку с любого устройства
    .replace(/<link rel="manifest"[^>]*>\s*/, '')
    .replace('<title>Electron</title>', '<title>Электрон · гостевой вход</title>\n<link rel="stylesheet" href="/g/g.css?v=' + serverVersion() + '">')
    .replace('</body>', '<script src="/g/g.js?v=' + serverVersion() + '"></script>\n</body>');   // с номером версии: браузер или прокси не отдадут старые файлы гостя
  return html;
}
app.use('/g', (req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use('/g', express.static(path.join(__dirname, 'public/g'), { index: false, maxAge: 0 }));
app.get('/g/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.type('html').send(guestPageHtml()); } catch { res.status(500).send('Страница недоступна'); }
});
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));

// /m — мобильный клиент (PWA для iOS), отдельный от /chat; тот же принцип
// подмены версии в index.html, чтобы не залипал в HTTP-кэше между релизами
const M_INDEX = path.join(__dirname, 'public/m/index.html');
app.get(['/m', '/m/', '/m/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const html = fs.readFileSync(M_INDEX, 'utf8').replace(/\?v=[\w.\-]+/g, '?v=' + serverVersion());
    res.type('html').send(html);
  } catch {
    res.sendFile(M_INDEX);
  }
});
app.use('/m', express.static(path.join(__dirname, 'public/m')));
// Файлы модулей (наборы, которые клиенты скачивают). Клиенты добавляют ?v=<версия набора>, поэтому кэшировать можно надолго
app.use('/modules', express.static(path.join(__dirname, 'public/modules'), { maxAge: '30d' }));
// Имя файла — timestamp+случайная строка, при новой загрузке никогда не переиспользуется,
// поэтому старое имя гарантированно не сменит содержимое: можно кэшировать надолго
// Зашифрованные файлы секретных чатов — только для участников чата, без публичного доступа
app.get('/files/enc_:name', require('./auth').authMiddleware, async (req, res) => {
  const url = `/files/enc_${req.params.name}`;
  const row = await dal.get(`
    SELECT m.chat_id FROM messages m WHERE m.attachment LIKE ? LIMIT 1
  `, `%"url":"${url}"%`);
  if (!row || !(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', row.chat_id, req.user.id)))
    return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(FILES_DIR, `enc_${req.params.name}`), err => { if (err) res.status(404).end(); });
});
// Превью картинки для ленты мобильного клиента: 720 px по ширине, webp. Делается при первом запросе и лежит рядом с файлом
// (имя_p.webp), поэтому и старые вложения получают превью без переделки. Оригинал остаётся для просмотра на весь экран
let _sharp = null; try { _sharp = require('sharp'); } catch {}
const _pvBusy = new Map();
app.get('/fp/:name', async (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  if (!/^[\w.\-]+$/.test(name) || name.startsWith('enc_') || !/\.(jpe?g|png|webp)$/i.test(name)) return res.status(404).end();
  const src = path.join(FILES_DIR, name), out = path.join(FILES_DIR, name.replace(/\.[^.]*$/, '') + '_p.webp');
  const fallback = () => res.redirect(302, '/files/' + encodeURIComponent(name));
  if (!fs.existsSync(src)) return res.status(404).end();
  if (!_sharp) return fallback();
  try {
    if (!fs.existsSync(out)) {
      let job = _pvBusy.get(out);
      if (!job) {
        job = _sharp(src, { limitInputPixels: 80e6 }).rotate().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out + '.tmp')
          .then(() => fs.renameSync(out + '.tmp', out)).finally(() => _pvBusy.delete(out));
        _pvBusy.set(out, job);
      }
      await job;
    }
    res.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/webp');
    res.sendFile(out, err => { if (err && !res.headersSent) fallback(); });
  } catch { try { fs.unlinkSync(out + '.tmp'); } catch {} if (!res.headersSent) fallback(); }
});
// Файлы лежат на том же домене, что и клиенты: страница, открытая прямо по ссылке, получила бы доступ к токену пользователя.
// nosniff запрещает браузеру считать файл страницей по содержимому, а типы, которые браузер исполняет (html, svg, xml, js), отдаются только на скачивание
const ACTIVE_EXT = /\.(x?html?|svgz?|xml|xsl|xslt|js|mjs|jsx|hta|mht|mhtml|swf)$/i;
const safeFileHeaders = (res, filePath) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (ACTIVE_EXT.test(filePath)) { res.setHeader('Content-Disposition', 'attachment'); }
};
app.use('/files', express.static(FILES_DIR, { maxAge: '1y', immutable: true, setHeaders: safeFileHeaders }));
app.use('/lp', express.static(require('./linkprev').DIR, { maxAge: '1y', immutable: true, setHeaders: safeFileHeaders }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/messages', require('./routes/messages'));
const uploadRouter = require('./routes/upload');
app.use('/api/upload', uploadRouter);
boot.push(() => uploadRouter.startCleanupJob());
const adminRouter = require('./routes/admin');
app.use('/api/admin', adminRouter);
adminRouter.startBackupSchedule();
const modulesRouter = require('./routes/modules');
boot.push(() => modulesRouter.init());
app.use('/api/modules', modulesRouter.user);
app.use('/api/admin/modules', modulesRouter.admin);
const spacesRouter = require('./routes/spaces');
app.use('/api/contacts', spacesRouter.contacts);
app.use('/api/blocks', spacesRouter.blocks);
app.use('/api/admin/workspaces', spacesRouter.admin);
app.use('/api/folders', require('./routes/folders'));
app.use('/api/guest', require('./routes/guest'));
app.use('/api/preview', require('./routes/preview'));
const pushRouter = require('./routes/push');
boot.push(() => pushRouter.init());
app.use('/api/push', pushRouter);
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/secret', require('./routes/secret'));
const federationRouter = require('./routes/federation');
app.use('/api/admin/federation', federationRouter.admin);
app.use('/fed/v1', federationRouter.pub);

app.get('/api/release-notes', (req, res) => {
  const notesPath = path.join(__dirname, '../../RELEASE_NOTES.md');
  try { res.type('text/plain').send(require('fs').readFileSync(notesPath, 'utf8')); }
  catch { res.status(404).end(); }
});

require('./ws').setup(server);
// Межсерверные соединения (федерация) приходят на /fed того же порта
boot.push(() => require('./federation').mount(server));
// Отложенные объявления живут в базе; планировщик поднимает наступившие,
// в том числе те, чьё время пришло, пока сервер был выключен.
boot.push(() => require('./announcements').startScheduler());
// Гостевые ссылки: загрузка действующих гостей и закрытие тех, у кого срок вышел, пока сервер не работал
boot.push(() => require('./guest').startScheduler());
// Журнал времени доставки и прочтения: раз в сутки убираются записи старше окна
boot.push(() => require('./statusmarks').start());
// Нагрузка сервера для живых графиков на главной админки; история переживает перезапуск
const monitor = require('./monitor');
monitor.setOnlineProvider(require('./ws').onlineUserCount);
monitor.start();
if (require('./dal').pg) boot.push(() => { require('./pgmon').start(); });

const PORT = process.env.PORT || 3000;
dal.init().then(() => require('./auth').init()).then(async () => { for (const task of boot) await task(); }).then(() => server.listen(PORT, () => {
  console.log(`Electron server running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
})).catch(e => { console.error('[Старт] не удалось запустить сервер:', e); process.exit(1); });
