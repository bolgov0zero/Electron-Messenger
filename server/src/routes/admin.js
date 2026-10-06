const router = require('express').Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { authMiddleware, adminMiddleware } = require('../auth');
const announcements = require('../announcements');
const { sendTo, broadcast, broadcastAll, getStatus, isConnected, getClients, sendToConn, getConnCount, getConnMeta, initUpdateProgress, getUpdateProgress, getMessageWithStatus } = require('../ws');
const monitor = require('../monitor');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');
const { logAudit } = require('../audit');

function getDirSize(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      try { total += fs.statSync(path.join(dir, f)).size; } catch {}
    }
  } catch {}
  return total;
}

function deleteChatFiles(chatId) {
  const rows = db.prepare('SELECT attachment FROM messages WHERE chat_id = ? AND attachment IS NOT NULL').all(chatId);
  rows.forEach(r => {
    try {
      const att = JSON.parse(r.attachment);
      [att?.url, att?.thumb].forEach(u => {
        if (!u) return;
        const fp = path.join(FILES_DIR, path.basename(u));
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
    } catch {}
  });
}

// ── Версия сервера ──
const VERSION_FILE = path.join(__dirname, '..', '..', 'version.json');
// Шаги обновления: update.sh дописывает сюда строки, админка читает их через /server/update-status
const UPDATE_STATUS_FILE = path.join(path.dirname(DB_PATH), 'update-status.log');
function getLocalVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version; } catch { return '0.0.0'; }
}
// Версия, с которой запущен этот процесс. getLocalVersion читает файл, а update.sh меняет
// его ещё до перезапуска — по файлу старый процесс рапортовал бы уже новую версию
const RUNNING_VERSION = getLocalVersion();

// Учёт обращений к GitHub: сколько ответов получено за последний час и что GitHub сообщил
// об остатке лимита в заголовках самих ответов (так цифра свежее, чем у отдельного запроса)
const _ghCalls = [];
let _ghSeen = null;
function ghNote(res) {
  const now = Date.now();
  _ghCalls.push(now);
  while (_ghCalls.length && now - _ghCalls[0] > 3600_000) _ghCalls.shift();
  const h = res.headers || {}, n = k => Number(h['x-ratelimit-' + k]);
  if (Number.isFinite(n('remaining')) && Number.isFinite(n('reset'))) _ghSeen = { limit: n('limit'), remaining: n('remaining'), reset: n('reset') };
}

// Файл из репозитория на GitHub: версия сервера и описание релиза
function fetchRepoFile(repoPath) {
  return new Promise((resolve) => {
    try {
      const token = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get()?.value;
      const headers = { 'User-Agent': 'Electron-Server', 'Accept': 'application/vnd.github.v3+json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // Используем GitHub API — не кешируется CDN, в отличие от raw.githubusercontent.com
      const req = https.request({
        hostname: 'api.github.com',
        path: '/repos/bolgov0zero/Electron-Messenger/contents/' + repoPath,
        headers,
      }, res => {
        ghNote(res);
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          clearTimeout(timer);
          // Контент закодирован в base64
          try { resolve(Buffer.from(JSON.parse(data).content, 'base64').toString('utf8')); }
          catch { resolve(null); }
        });
      });
      // Общий срок на весь запрос. req.setTimeout не годится: он считает простой уже
      // открытого соединения, а зависнуть можно раньше — на поиске адреса или подключении,
      // и тогда кнопка «Проверить» крутилась бы бесконечно
      const timer = setTimeout(() => { req.destroy(); resolve(null); }, 8000);
      req.on('error', () => { clearTimeout(timer); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

async function fetchRemoteVersion() {
  const content = await fetchRepoFile('server/version.json');
  try { return JSON.parse(content).version; } catch { return null; }
}

router.use(authMiddleware, adminMiddleware);

router.get('/stats', (req, res) => {
  const pageCount = db.prepare('PRAGMA page_count').get()['page_count'];
  const pageSize  = db.prepare('PRAGMA page_size').get()['page_size'];
  res.json({
    // Считаем ровно то, что видно в списках: без ботов (вебхуки, __system__)
    // и без тем — иначе бейджи и плитки показывают больше, чем есть на вкладках
    users:    db.prepare('SELECT COUNT(*) as c FROM users WHERE is_bot IS NULL OR is_bot = 0').get().c,
    chats:    db.prepare("SELECT COUNT(*) as c FROM chats WHERE type='direct'").get().c,
    groups:   db.prepare("SELECT COUNT(*) as c FROM chats WHERE type='group'").get().c,
    rooms:    db.prepare("SELECT COUNT(*) as c FROM chats WHERE type='room' AND parent_id IS NULL").get().c,
    messages: db.prepare('SELECT COUNT(*) as c FROM messages WHERE deleted = 0').get().c,
    uptimeSeconds: Math.floor(process.uptime()),
    dbBytes: pageCount * pageSize,
    filesBytes: getDirSize(FILES_DIR),
    // тот же счёт, что и во вкладке «Файлы»: без миниатюр и без дублей
    filesCount: collectFiles().length,
    wsConnections: getConnCount(),
    serverVersion: getLocalVersion(),
    pushSubscriptions: (() => { try { return db.prepare('SELECT COUNT(*) as c FROM push_subscriptions').get().c; } catch { return 0; } })(),
  });
});

// Сообщения за период для графика на главной: 24 часа по часам, неделя и месяц по дням,
// год по месяцам. Границы — по часовому поясу администратора (tz — смещение в минутах):
// сервер часто живёт в UTC, и сутки по его часам начинались бы не в полночь.
// Подсчёт кэшируем: за год это перебор большой части истории, а главная опрашивает
// каждые 10 секунд — без кэша это было бы видно на графике отклика сервера.
const ACTIVITY = {
  '24h': { unit: 'hour', count: 24, ttl: 10e3 },
  '7d': { unit: 'day', count: 7, ttl: 60e3 },
  '30d': { unit: 'day', count: 30, ttl: 5 * 60e3 },
  '1y': { unit: 'month', count: 12, ttl: 5 * 60e3 },
};
const activityCache = new Map();

router.get('/activity', (req, res) => {
  const range = ACTIVITY[req.query.range] ? req.query.range : '24h';
  const { unit, count, ttl } = ACTIVITY[range];
  const tz = Math.max(-840, Math.min(840, Math.round(Number(req.query.tz) || 0)));
  const cacheKey = `${range}:${tz}`;
  const hit = activityCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl) return res.json(hit.data);

  // Считаем в сдвинутом времени: к UTC прибавляем смещение, и UTC-методы Date дают
  // местные часы и даты. Date.UTC сам переносит отрицательные часы, дни и месяцы.
  const off = tz * 60;
  const local = new Date(Date.now() + off * 1000);
  const [Y, M, D, h] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours()];
  const starts = [];
  for (let i = count - 1; i >= 0; i--) {
    starts.push(unit === 'hour' ? Date.UTC(Y, M, D, h - i)
      : unit === 'day' ? Date.UTC(Y, M, D - i)
      : Date.UTC(Y, M - i, 1));
  }
  const format = { hour: '%Y-%m-%d %H', day: '%Y-%m-%d', month: '%Y-%m' }[unit];
  const rows = db.prepare(`
    SELECT strftime('${format}', sent_at + ?, 'unixepoch') AS k, COUNT(*) AS n
    FROM messages WHERE deleted = 0 AND sent_at >= ? GROUP BY k
  `).all(off, Math.floor(starts[0] / 1000) - off);
  const byKey = new Map(rows.map(r => [r.k, r.n]));
  const p2 = n => String(n).padStart(2, '0');
  const keyOf = ms => {
    const d = new Date(ms);
    const ym = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
    return unit === 'month' ? ym : unit === 'day' ? `${ym}-${p2(d.getUTCDate())}` : `${ym}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}`;
  };
  const data = { range, unit, buckets: starts.map(ms => ({ t: ms - off * 1000, n: byKey.get(keyOf(ms)) || 0 })) };
  activityCache.set(cacheKey, { at: Date.now(), data });
  res.json(data);
});

// Create room (admin only) — notifies members via WS
router.post('/rooms', (req, res) => {
  const { name, member_ids, read_only } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Missing name' });
  const result = db.prepare("INSERT INTO chats (type, name, created_by, read_only) VALUES ('room', ?, ?, ?)").run(name.trim(), req.user.id, read_only ? 1 : 0);
  const chatId = result.lastInsertRowid;
  if (Array.isArray(member_ids) && member_ids.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
    member_ids.forEach(uid => { ins.run(chatId, uid); sendTo(uid, { type: 'reload_chats' }); });
  }
  logAudit(req, 'rooms', 'Создание комнаты', `«${name.trim()}», участников: ${Array.isArray(member_ids) ? member_ids.length : 0}`);
  res.json({ id: chatId });
});

// Админ меняет состав не из самого чата — участники могут не знать, кто это
// сделал, поэтому формулировка безличная, без указания автора. Только для
// group/room (в личных сообщениях состава как такового нет) и только для
// самого чата, без дублей в подкомнатах при каскаде.
function memberEventLabel(chatType, action) {
  const place = chatType === 'room' ? 'комнат' : 'групп';
  return action === 'add' ? `в ${place}у` : `из ${place}ы`;
}

// Add member to any chat/room — notify via WS
router.post('/chats/:id/members', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
  const chatId = Number(req.params.id);
  const userId = Number(user_id);
  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
  ins.run(chatId, userId);
  db.prepare('SELECT id FROM chats WHERE parent_id = ?').all(chatId)
    .forEach(s => ins.run(s.id, userId));
  db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId)
    .forEach(({ user_id: uid }) => sendTo(uid, { type: 'reload_chats' }));
  if (chat && chat.type !== 'direct') {
    const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '—';
    announcements.sendSystemMessage(chatId, `${name} добавлен(а) ${memberEventLabel(chat.type, 'add')}`, 'member_add');
    const chatName = db.prepare('SELECT name FROM chats WHERE id = ?').get(chatId)?.name || `#${chatId}`;
    logAudit(req, 'rooms', 'Добавление участника', `${name} → «${chatName}»`);
  }
  res.json({ ok: true });
});

// Remove member from any chat/room
router.delete('/chats/:id/members/:userId', (req, res) => {
  const chatId = Number(req.params.id);
  const kickedId = Number(req.params.userId);
  const chat = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId);
  const remaining = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').all(chatId, kickedId);
  const del = db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?');
  del.run(chatId, kickedId);
  db.prepare('SELECT id FROM chats WHERE parent_id = ?').all(chatId)
    .forEach(s => { del.run(s.id, kickedId); sendTo(kickedId, { type: 'chat_deleted', chat_id: s.id }); });
  remaining.forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  sendTo(kickedId, { type: 'chat_deleted', chat_id: chatId });
  if (chat && chat.type !== 'direct') {
    const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(kickedId)?.display_name || '—';
    announcements.sendSystemMessage(chatId, `${name} удалён(а) ${memberEventLabel(chat.type, 'remove')}`, 'member_remove');
    const chatName = db.prepare('SELECT name FROM chats WHERE id = ?').get(chatId)?.name || `#${chatId}`;
    logAudit(req, 'rooms', 'Удаление участника', `${name} из «${chatName}»`);
  }
  res.json({ ok: true });
});

// Rename room
router.patch('/rooms/:id', (req, res) => {
  const { name, read_only } = req.body;
  const hasName = name !== undefined;
  const hasReadOnly = read_only !== undefined;
  if (hasName && !String(name).trim()) return res.status(400).json({ error: 'Missing name' });
  if (!hasName && !hasReadOnly) return res.status(400).json({ error: 'Nothing to update' });
  const prev = db.prepare("SELECT name, read_only FROM chats WHERE id = ? AND type = 'room'").get(req.params.id);
  if (hasName) db.prepare("UPDATE chats SET name = ? WHERE id = ? AND type = 'room'").run(String(name).trim(), req.params.id);
  if (hasReadOnly) db.prepare("UPDATE chats SET read_only = ? WHERE id = ? AND type = 'room'").run(read_only ? 1 : 0, req.params.id);
  const newName = hasName ? String(name).trim() : prev?.name;
  const isReadOnly = hasReadOnly ? !!read_only : !!prev?.read_only;
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.id);
  members.forEach(({ user_id }) => sendTo(user_id, { type: 'chat_updated', chat_id: Number(req.params.id), name: newName, read_only: isReadOnly }));
  if (hasName) logAudit(req, 'rooms', 'Переименование комнаты', `«${prev?.name || '?'}» → «${newName}»`);
  if (hasReadOnly && !!prev?.read_only !== !!read_only) logAudit(req, 'rooms', 'Режим «только чтение»', `«${newName}»: ${read_only ? 'включён' : 'выключен'}`);
  res.json({ ok: true });
});

// Upload avatar for any chat/room (admin)
function isImgBuf(buf) {
  return (buf[0]===0xFF&&buf[1]===0xD8)||(buf[0]===0x89&&buf[1]===0x50)||
         (buf[0]===0x47&&buf[1]===0x49)||(buf[0]===0x52&&buf[1]===0x49);
}
router.post('/chats/:id/avatar', (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Missing data' });
  const buf = Buffer.from(data, 'base64');
  if (!isImgBuf(buf)) return res.status(400).json({ error: 'Not an image' });
  const avatarDir = path.join(__dirname, '..', '..', '..', 'chat_db', 'avatar');
  fs.mkdirSync(avatarDir, { recursive: true });
  fs.writeFileSync(path.join(avatarDir, `chat_${req.params.id}.jpg`), buf);
  res.json({ ok: true });
});

router.get('/users', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const avatarDir = path.join(__dirname, '..', '..', '..', 'chat_db', 'avatar');
  const users = db.prepare('SELECT id, username, display_name, is_admin, tag, banned, created_at, last_seen_at, totp_required, totp_secret, can_announce FROM users WHERE is_bot IS NULL OR is_bot = 0 ORDER BY created_at DESC').all();
  // Устройства, с которых человек сейчас в сети: в списке это «Electron 2.15.9 · macOS»
  const devices = new Map();
  for (const c of getClients()) {
    if (!devices.has(c.userId)) devices.set(c.userId, []);
    devices.get(c.userId).push({ version: c.clientVersion, platform: c.osPlatform, hostname: c.hostname, scope: c.installScope, since: c.connectedAt });
  }
  res.json(users.map(u => {
    const { totp_secret, ...rest } = u;
    return {
      ...rest,
      banned: !!u.banned,
      connected: isConnected(u.id),
      status: getStatus(u.id), // online / away / offline — с учётом фокуса окон
      clients: devices.get(u.id) || [],
      has_avatar: fs.existsSync(path.join(avatarDir, `${u.id}.jpg`)),
      can_announce: !!u.can_announce,
      totp_required: !!u.totp_required,
      totp_configured: !!totp_secret, // сам секрет наружу никогда не отдаём
    };
  }));
});

router.get('/chats', (req, res) => {
  const chats = db.prepare(`
    SELECT c.id, c.type, c.name, c.created_at, c.created_by, c.parent_id, c.position, c.is_secret, c.read_only,
      (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND deleted = 0) as message_count,
      (SELECT MAX(sent_at) FROM messages WHERE chat_id = c.id AND deleted = 0) as last_at,
      (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
      (SELECT GROUP_CONCAT(u.id || char(31) || u.display_name, char(30)) FROM users u
       JOIN chat_members cm ON cm.user_id = u.id WHERE cm.chat_id = c.id ORDER BY cm.joined_at) as member_list
    FROM chats c ORDER BY c.created_at DESC
  `).all();
  // Участники с номером и признаком фото — таблицы показывают настоящие аватарки.
  // Номер и имя берём одной строкой, чтобы их порядок гарантированно совпадал.
  const hasPhoto = new Map();
  const photo = id => {
    if (!hasPhoto.has(id)) hasPhoto.set(id, fs.existsSync(path.join(AVATAR_DIR, `${id}.jpg`)));
    return hasPhoto.get(id);
  };
  chats.forEach(c => {
    c.members = (c.member_list ? c.member_list.split('\x1e') : []).map(row => {
      const [id, name] = row.split('\x1f');
      return { id: Number(id), name, has_avatar: photo(Number(id)) };
    });
    c.member_names = c.members.map(m => m.name);
    delete c.member_list;
  });
  // Сообщения за последние 7 дней по дням — мини-график активности в «Комнатах»
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const week = new Map();
  db.prepare('SELECT chat_id, CAST((sent_at - ?) / 86400 AS INTEGER) AS d, COUNT(*) AS n FROM messages WHERE deleted = 0 AND sent_at >= ? GROUP BY chat_id, d')
    .all(since, since)
    .forEach(r => {
      if (r.d < 0 || r.d > 6) return;
      if (!week.has(r.chat_id)) week.set(r.chat_id, [0, 0, 0, 0, 0, 0, 0]);
      week.get(r.chat_id)[r.d] += r.n;
    });
  res.json(chats.map(c => ({
    ...c,
    week: week.get(c.id) || [0, 0, 0, 0, 0, 0, 0],
    has_avatar: fs.existsSync(path.join(AVATAR_DIR, `chat_${c.id}.jpg`)),
  })));
});

router.get('/chats/:id/members', (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, cm.joined_at FROM users u
    JOIN chat_members cm ON cm.user_id = u.id WHERE cm.chat_id = ? ORDER BY cm.joined_at
  `).all(req.params.id);
  res.json(members);
});

// ── Кэш последней версии клиента с GitHub Releases (обновляется раз в 15 минут) ──
let _versionCache = { version: null, fetchedAt: 0 };
const VERSION_CACHE_TTL = 15 * 60 * 1000;

// Возвращает последнюю версию клиента из releases/latest (тег вида c1.4.x → 1.4.x).
// Используется для сравнения с clientVersion, которую клиент присылает при подключении.
async function fetchLatestVersion(force = false) {
  const now = Date.now();
  if (!force && _versionCache.version && now - _versionCache.fetchedAt < VERSION_CACHE_TTL) {
    return _versionCache.version;
  }
  try {
    const token = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get()?.value;
    const headers = { 'User-Agent': 'Electron-Admin', 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.github.com',
        path: '/repos/bolgov0zero/Electron-Messenger/releases/latest',
        headers,
      }, res => {
        ghNote(res);
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('parse')); } });
      });
      req.on('error', reject);
      req.end();
    });
    if (data.tag_name) {
      _versionCache = { version: data.tag_name.replace(/^[a-zA-Z]+/, ''), fetchedAt: now };
    }
  } catch {}
  return _versionCache.version;
}

// Список подключённых клиентов + последняя версия с GitHub
router.get('/clients', async (req, res) => {
  const clients = getClients();
  const latestVersion = await fetchLatestVersion(req.query.force === 'true');
  res.json({ clients, latestVersion });
});

// ── Настройки ──
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Маскируем токен
  if (settings.github_token) settings.github_token_set = true;
  delete settings.github_token;
  // Секреты не должны уходить в браузер даже админу
  delete settings.jwt_secret;
  delete settings.vapid_private;
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const allowed = ['github_token', 'edit_time_limit',
    'upload_image_max_size', 'upload_image_extensions',
    'upload_video_max_size', 'upload_video_extensions',
    'upload_file_max_size', 'upload_file_extensions', 'upload_file_lifetime',
    'backup_schedule_days', 'backup_schedule_time', 'backup_retention_days',
    ];
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  const keepEmpty = ['upload_image_extensions', 'upload_video_extensions', 'upload_file_extensions', 'upload_file_lifetime', 'backup_retention_days'];
  for (const key of allowed) {
    if (key in req.body) {
      const val = req.body[key]?.trim() ?? '';
      if (val || keepEmpty.includes(key)) upsert.run(key, val);
      else del.run(key);
    }
  }
  _versionCache = { version: null, fetchedAt: 0 }; // сбросить кэш
  logAudit(req, 'server', 'Изменение настроек', Object.keys(req.body).filter(k => allowed.includes(k)).join(', ') || '—');
  res.json({ ok: true });
});

// Принудительное обновление — сервер сам находит нужный ассет по платформе клиента
router.post('/clients/:connId/force-update', async (req, res) => {
  const connId = Number(req.params.connId);
  const meta = getConnMeta(connId);
  const platform = meta?.osPlatform || '';
  let downloadUrl = null;
  try {
    const token = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get()?.value;
    const headers = { 'User-Agent': 'Electron-Admin', 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = await new Promise((resolve, reject) => {
      const req2 = https.request({ hostname: 'api.github.com', path: '/repos/bolgov0zero/Electron-Messenger/releases/latest', headers }, r => {
        ghNote(r);
        let body = ''; r.on('data', c => body += c); r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
      });
      req2.on('error', reject);
      req2.end();
    });
    const assets = data.assets || [];
    // Выбираем ассет по платформе; для Linux предпочитаем x86_64 если платформа не arm
    const asset = platform === 'win32'  ? assets.find(a => /\.exe$/i.test(a.name))
                : platform === 'darwin' ? assets.find(a => /\.dmg$/i.test(a.name))
                : assets.find(a => /\.deb$/i.test(a.name));
    downloadUrl = asset?.browser_download_url || null;
  } catch {}
  initUpdateProgress(connId);
  sendToConn(connId, { type: 'force_update', downloadUrl });
  logAudit(req, 'server', 'Принудительное обновление клиента', meta?.hostname || `conn #${connId}`);
  res.json({ ok: true, downloadUrl });
});

router.get('/updates/progress', (req, res) => {
  res.json(getUpdateProgress());
});

// Завершить ВСЕ сессии пользователя (все устройства).
// Отметка нужна для выключенных клиентов: сообщение по соединению до них
// не дойдёт, а при следующем запуске старый токен уже не подойдёт.
router.post('/users/:id/logout', (req, res) => {
  const userId = Number(req.params.id);
  db.prepare('UPDATE users SET sessions_valid_from = unixepoch() WHERE id = ?').run(userId);
  sendTo(userId, { type: 'force_logout' });
  const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '—';
  logAudit(req, 'security', 'Завершение всех сессий', name);
  res.json({ ok: true });
});

// Блокировка / разблокировка пользователя
router.post('/users/:id/ban', (req, res) => {
  const userId = Number(req.params.id);
  db.prepare('UPDATE users SET banned = 1, sessions_valid_from = unixepoch() WHERE id = ?').run(userId);
  sendTo(userId, { type: 'force_logout' });
  const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '—';
  logAudit(req, 'moderation', 'Блокировка пользователя', name);
  res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
  const userId = Number(req.params.id);
  db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(userId);
  const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '—';
  logAudit(req, 'moderation', 'Разблокировка пользователя', name);
  res.json({ ok: true });
});

// Требовать 2FA для входа в админ-панель — имеет смысл только для админов;
// сама настройка (секрет/QR) происходит у самого пользователя при следующем
// входе в админку, не здесь.
router.patch('/users/:id/totp', (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT display_name, is_admin FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const required = !!req.body.required;
  db.prepare('UPDATE users SET totp_required = ? WHERE id = ?').run(required ? 1 : 0, userId);
  logAudit(req, 'security', required ? 'Включено требование 2FA' : 'Отключено требование 2FA', user.display_name);
  res.json({ ok: true });
});

// Право отправлять объявления из клиента. Клиент узнаёт о смене сразу, если человек в сети
router.patch('/users/:id/announce', (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const allowed = !!req.body.allowed;
  db.prepare('UPDATE users SET can_announce = ? WHERE id = ?').run(allowed ? 1 : 0, userId);
  logAudit(req, 'security', allowed ? 'Включено право отправлять объявления' : 'Отключено право отправлять объявления', user.display_name);
  sendTo(userId, { type: 'perms', can_announce: allowed });
  res.json({ ok: true });
});

// Сброс 2FA — на случай утерянного приложения-аутентификатора. При следующем
// входе в админку пользователь настраивает её заново (требование остаётся,
// если было включено).
router.post('/users/:id/totp/reset', (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL WHERE id = ?').run(userId);
  logAudit(req, 'security', 'Сброс 2FA', user.display_name);
  res.json({ ok: true });
});

// Принудительный выход
router.post('/clients/:connId/force-logout', (req, res) => {
  const connId = Number(req.params.connId);
  const meta = getConnMeta(connId);
  sendToConn(connId, { type: 'force_logout' });
  logAudit(req, 'security', 'Принудительный выход клиента', meta?.hostname || `conn #${connId}`);
  res.json({ ok: true });
});

// Принудительный перезапуск клиента (только Electron: app.relaunch + exit)
router.post('/clients/:connId/force-restart', (req, res) => {
  const connId = Number(req.params.connId);
  const meta = getConnMeta(connId);
  sendToConn(connId, { type: 'force_restart' });
  logAudit(req, 'server', 'Принудительный перезапуск клиента', meta?.hostname || `conn #${connId}`);
  res.json({ ok: true });
});

// Перезапуск службы systemd
router.post('/system/restart', (req, res) => {
  const { exec } = require('child_process');
  exec('systemctl is-active electron', (err, stdout) => {
    const active = (stdout || '').trim();
    if (active !== 'active' && active !== 'activating') {
      return res.status(400).json({ error: 'Служба electron не активна или не найдена. Перезапуск невозможен.' });
    }
    monitor.addEvent('restart');
    logAudit(req, 'server', 'Перезапуск сервера', null);
    res.json({ ok: true });
    setTimeout(() => exec('systemctl restart electron'), 300);
  });
});

// Версия сервера
function semverGt(a, b) {
  if (!a || !b) return false;
  const n = v => v.replace(/^[^\d]*/, '').split('.').map(Number);
  const [am, an, ap] = n(a), [bm, bn, bp] = n(b);
  return am !== bm ? am > bm : an !== bn ? an > bn : ap > bp;
}

// Остаток лимита запросов к GitHub — то, что GitHub сам насчитал для этого токена (или для адреса
// сервера, если токена нет). Запрос /rate_limit в лимит не засчитывается, поэтому опрос ничего не тратит
router.get('/github/rate', (req, res) => {
  const token = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get()?.value;
  const headers = { 'User-Agent': 'Electron-Admin', 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let done = false;
  const finish = (code, body) => { if (done) return; done = true; clearTimeout(timer); res.status(code).json(body); };
  const req2 = https.request({ hostname: 'api.github.com', path: '/rate_limit', headers }, r => {
    let body = '';
    r.on('data', c => body += c);
    r.on('end', () => {
      if (r.statusCode === 401) return finish(502, { error: 'GitHub не принял токен' });
      try {
        const c = JSON.parse(body).resources.core;
        let limit = c.limit, remaining = c.remaining, reset = c.reset;
        // Заголовки настоящих ответов точнее отдельного /rate_limit: у него бывает «чистое» окно с расходом 0
        // и сбросом через час, хотя запросы уже идут. Пока окно из заголовков не закончилось, берём меньший остаток
        if (_ghSeen && _ghSeen.reset * 1000 > Date.now() && _ghSeen.remaining < remaining) {
          limit = _ghSeen.limit || limit; remaining = _ghSeen.remaining; reset = _ghSeen.reset;
        }
        const cut = Date.now() - 3600_000;
        finish(200, { limit, remaining, used: limit - remaining, reset, authenticated: !!token, own: _ghCalls.filter(t => t > cut).length });
      } catch { finish(502, { error: 'GitHub вернул неожиданный ответ' }); }
    });
  });
  const timer = setTimeout(() => { req2.destroy(); finish(504, { error: 'GitHub не ответил' }); }, 8000);
  req2.on('error', () => finish(502, { error: 'Нет связи с GitHub' }));
  req2.end();
});

router.get('/server/version', async (req, res) => {
  const local = getLocalVersion();
  const remote = await fetchRemoteVersion();
  const hasUpdate = semverGt(remote, local);
  // «Что нового» — описание последнего релиза: в репозитории оно одно и переписывается каждым релизом
  const notes = hasUpdate ? await fetchRepoFile('RELEASE_NOTES.md') : null;
  res.json({ current: local, latest: remote, hasUpdate, notes: notes ? notes.trim().slice(0, 4000) : null });
});

// Обновление сервера с GitHub
router.post('/server/update', (req, res) => {
  const { exec } = require('child_process');
  // Проверяем, что служба управляется systemd и активна — иначе перезапуск после
  // обновления не сработает (например, установка без root), а админка не должна
  // рапортовать ложный успех.
  exec('systemctl is-active electron', (err, stdout) => {
    const active = (stdout || '').trim();
    if (active !== 'active' && active !== 'activating') {
      return res.status(400).json({ error: 'Служба electron не активна или не найдена. Обновление невозможно.' });
    }
    const updateSh = path.join(__dirname, '..', '..', 'update.sh');
    // Обновление запускается ОТДЕЛЬНЫМ транзиентным юнитом через systemd-run.
    // Раньше скрипт был дочерним процессом самого сервера и жил в его cgroup:
    // при перезапуске службы systemd убивал всю группу — установка обрывалась
    // на середине, оставляя недописанный better_sqlite3.node, и служба уходила
    // в цикл падений с SIGBUS. Транзиентный юнит переживает перезапуск сервера.
    // Файл шагов — с чистого листа: update.sh дописывает в него строки по ходу работы
    try { fs.writeFileSync(UPDATE_STATUS_FILE, ''); } catch {}
    const cmd = `systemd-run --unit=electron-update --collect --description="Обновление Electron" --setenv=UPDATE_STATUS_FILE=${JSON.stringify(UPDATE_STATUS_FILE)} /bin/bash ${JSON.stringify(updateSh)}`;
    // Отметка на графиках: всплеск нагрузки и разрыв при перезапуске — это обновление
    monitor.addEvent('update');
    logAudit(req, 'server', 'Обновление сервера', null);
    res.json({ ok: true });
    setTimeout(() => exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('[Update] не удалось запустить обновление:', err.message, '\n', stderr);
        console.error('[Update] журнал обновления: journalctl -u electron-update');
        try { fs.appendFileSync(UPDATE_STATUS_FILE, `${Math.floor(Date.now() / 1000)} result failed не удалось запустить обновление\n`); } catch {}
      } else {
        console.log('[Update] обновление запущено отдельным юнитом electron-update');
      }
    }), 300);
  });
});

// Ход обновления: что update.sh записал в файл шагов. Пока служба перезапускается,
// сервер недоступен — админка это переживает и дочитывает шаги, когда он вернётся.
router.get('/server/update-status', (req, res) => {
  const steps = {};
  let result = null, error = null, startedAt = null;
  let text = '';
  try { text = fs.readFileSync(UPDATE_STATUS_FILE, 'utf8'); } catch {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d+) (\w+) (\w+) ?(.*)$/);
    if (!m) continue;
    const [, t, step, state, msg] = m;
    if (!startedAt) startedAt = Number(t) * 1000;
    if (step === 'result') { result = state; if (msg) error = msg; continue; }
    steps[step] = { state, msg: msg || null };
    if (state === 'failed' && msg) error = msg;
  }
  res.json({ version: getLocalVersion(), running: RUNNING_VERSION, startedAt, steps, result, error });
});

// История релизов — читается из RELEASE_HISTORY.md (не из git log: коммиты
// переписывать нельзя, а вид нужен причёсанный — см. ../../RELEASE_HISTORY.md
// в корне репозитория). Формат одной записи:
//   ## c2.15.54 / s1.2.383 — 2 октября 2026 г.
//
//   **Добавлено**
//   - пункт
//   **Исправлено**
//   - пункт
// Новые записи дописываются СВЕРХУ при каждом релизе, в том же формате.
router.get('/release-notes', (req, res) => {
  const filePath = path.join(__dirname, '..', '..', '..', 'RELEASE_HISTORY.md');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return res.json({ server: [], client: [] });
  }
  const server = [], client = [];
  const blocks = content.split(/\n(?=## )/);
  for (const block of blocks) {
    const header = /^##\s+(.+?)\s+—\s+(.+)$/m.exec(block);
    if (!header) continue;
    const [, verPart, dateLabel] = header;
    const cMatch = /c([\d.]+)/.exec(verPart);
    const sMatch = /s([\d.]+)/.exec(verPart);
    const sections = [];
    const sectionRe = /\*\*(.+?)\*\*\n((?:- .+\n?)+)/g;
    let m;
    while ((m = sectionRe.exec(block))) {
      sections.push({ label: m[1], items: m[2].split('\n').filter(Boolean).map(l => l.replace(/^- /, '')) });
    }
    const entry = { dateLabel, sections };
    if (cMatch) client.push({ ...entry, version: cMatch[1] });
    if (sMatch) server.push({ ...entry, version: sMatch[1] });
  }
  res.json({ server, client });
});

// Аудит-лог: последние N действий, новые сверху. Фильтрация по категории и
// поиск — на клиенте, как у страницы «Файлы» (один запрос, дальше всё в JS).
router.get('/audit-log', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.category, a.action, a.target, a.ip, a.created_at,
      COALESCE(u.display_name, 'Удалённый аккаунт') as actor_name, u.tag as actor_tag, a.actor_id
    FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?
  `).all(Math.max(1, Math.min(1000, Number(req.query.limit) || 1000)));
  const avatarDir = path.join(__dirname, '..', '..', '..', 'chat_db', 'avatar');
  res.json(rows.map(r => ({ ...r, actor_has_avatar: r.actor_id ? fs.existsSync(path.join(avatarDir, `${r.actor_id}.jpg`)) : false })));
});

// ── Главная: живые графики и сводка ──

// Точки графиков. Первый запрос — весь последний час, дальше только новые (since)
router.get('/monitor', (req, res) => {
  res.json({ ...monitor.snapshot(req.query.since), ws: getConnCount() });
});

// Сводка: сервер, служба, хранилище и чат. Опрашивается реже графиков
router.get('/overview', async (req, res) => {
  const count = sql => db.prepare(sql).get().c;

  // Кто в сети: соединения по людям — у одного человека бывает и компьютер, и телефон
  const avatarDir = path.join(path.dirname(DB_PATH), 'avatar');
  const byUser = new Map();
  for (const c of getClients()) {
    const u = byUser.get(c.userId) || { id: c.userId, name: c.displayName, since: c.connectedAt, clients: [] };
    u.since = Math.min(u.since, c.connectedAt);
    u.clients.push({ version: c.clientVersion, platform: c.osPlatform, hostname: c.hostname });
    byUser.set(c.userId, u);
  }
  const online = [...byUser.values()]
    .sort((a, b) => b.since - a.since)
    .map(u => ({ ...u, has_avatar: fs.existsSync(path.join(avatarDir, `${u.id}.jpg`)) }));

  const storage = monitor.storageInfo();
  const cacheSize = db.pragma('cache_size', { simple: true });
  const pageSize = db.pragma('page_size', { simple: true });
  res.json({
    host: monitor.hostInfo(),
    version: RUNNING_VERSION,
    uptime: Math.floor(process.uptime()),
    service: await monitor.serviceInfo(),
    storage,
    // Отрицательный cache_size — предел в КиБ, положительный — в страницах
    sqliteCacheBytes: cacheSize < 0 ? -cacheSize * 1024 : cacheSize * pageSize,
    chat: {
      users: count('SELECT COUNT(*) AS c FROM users WHERE is_bot IS NULL OR is_bot = 0'),
      rooms: count("SELECT COUNT(*) AS c FROM chats WHERE type='room' AND parent_id IS NULL"),
      groups: count("SELECT COUNT(*) AS c FROM chats WHERE type='group'"),
      chats: count("SELECT COUNT(*) AS c FROM chats WHERE type='direct'"),
      messages: count('SELECT COUNT(*) AS c FROM messages WHERE deleted = 0'),
      // Тот же счёт, что во вкладке «Файлы»: файлы на диске без миниатюр
      files: storage.files.count,
    },
    online,
  });
});

// ── Вебхуки ──
const AVATAR_DIR = path.join(path.dirname(DB_PATH), 'avatar');

function genToken() {
  return crypto.randomBytes(24).toString('base64url');
}

router.get('/webhooks', (req, res) => {
  const webhooks = db.prepare(`
    SELECT w.id, w.token, w.chat_id, w.created_at,
      u.id as user_id, u.display_name as name, u.tag,
      c.name as chat_name, c.type as chat_type,
      (SELECT COUNT(*) FROM messages m WHERE m.sender_id = w.user_id) as message_count
    FROM webhooks w
    JOIN users u ON u.id = w.user_id
    JOIN chats c ON c.id = w.chat_id
    ORDER BY w.created_at DESC
  `).all();
  // Сообщения бота по дням за неделю — видно, пишет ли внешняя система. По чату и времени:
  // бот пишет в один чат, и запрос идёт по индексу, а не перебором всех сообщений
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const weekOf = db.prepare('SELECT CAST((sent_at - ?) / 86400 AS INTEGER) AS d, COUNT(*) AS n FROM messages WHERE chat_id = ? AND sender_id = ? AND sent_at >= ? GROUP BY d');
  res.json(webhooks.map(w => {
    const week = [0, 0, 0, 0, 0, 0, 0];
    weekOf.all(since, w.chat_id, w.user_id, since).forEach(r => { if (r.d >= 0 && r.d < 7) week[r.d] += r.n; });
    return { ...w, week, has_avatar: fs.existsSync(path.join(AVATAR_DIR, `${w.user_id}.jpg`)) };
  }));
});

router.post('/webhooks', (req, res) => {
  const { name, tag, chat_id } = req.body;
  if (!name?.trim() || !chat_id) return res.status(400).json({ error: 'Missing fields' });
  const chat = db.prepare("SELECT id FROM chats WHERE id = ? AND type IN ('group', 'room')").get(Number(chat_id));
  if (!chat) return res.status(400).json({ error: 'Invalid chat: must be a group or room' });

  const botUsername = 'bot_' + crypto.randomBytes(6).toString('hex');
  const token = genToken();

  const botResult = db.prepare("INSERT INTO users (username, password_hash, display_name, is_bot, tag) VALUES (?, ?, ?, 1, ?)")
    .run(botUsername, '*', name.trim(), tag?.trim() || null);
  const botId = botResult.lastInsertRowid;

  db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(Number(chat_id), botId);

  const whResult = db.prepare('INSERT INTO webhooks (token, user_id, chat_id) VALUES (?, ?, ?)').run(token, botId, Number(chat_id));
  res.json({ id: Number(whResult.lastInsertRowid), token, user_id: Number(botId) });
});

router.delete('/webhooks/:id', (req, res) => {
  const wh = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(Number(req.params.id));
  if (!wh) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(wh.id);
  res.json({ ok: true });
});

router.post('/webhooks/:id/regen-token', (req, res) => {
  const wh = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(Number(req.params.id));
  if (!wh) return res.status(404).json({ error: 'Not found' });
  const newToken = genToken();
  db.prepare('UPDATE webhooks SET token = ? WHERE id = ?').run(newToken, wh.id);
  res.json({ ok: true, token: newToken });
});

router.post('/webhooks/:id/avatar', (req, res) => {
  const wh = db.prepare('SELECT user_id FROM webhooks WHERE id = ?').get(Number(req.params.id));
  if (!wh) return res.status(404).json({ error: 'Not found' });
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Missing data' });
  const buf = Buffer.from(data, 'base64');
  if (!isImgBuf(buf)) return res.status(400).json({ error: 'Not an image' });
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  fs.writeFileSync(path.join(AVATAR_DIR, `${wh.user_id}.jpg`), buf);
  res.json({ ok: true });
});

// ── Темы ──
router.get('/topics/:roomId', (req, res) => {
  const roomId = Number(req.params.roomId);
  const room = db.prepare("SELECT id FROM chats WHERE id = ? AND type = 'room' AND parent_id IS NULL").get(roomId);
  if (!room) return res.status(404).json({ error: 'Not found' });
  const topics = db.prepare('SELECT id, name, position FROM chats WHERE parent_id = ? ORDER BY position, id').all(roomId);
  res.json(topics.map(s => ({
    ...s,
    has_avatar: fs.existsSync(path.join(AVATAR_DIR, `chat_${s.id}.jpg`)),
    message_count: db.prepare('SELECT COUNT(*) as c FROM messages WHERE chat_id = ?').get(s.id).c,
  })));
});

router.post('/topics', (req, res) => {
  const { name, room_id } = req.body;
  if (!name?.trim() || !room_id) return res.status(400).json({ error: 'Missing fields' });
  const room = db.prepare("SELECT id FROM chats WHERE id = ? AND type = 'room' AND parent_id IS NULL").get(Number(room_id));
  if (!room) return res.status(400).json({ error: 'Invalid room' });
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM chats WHERE parent_id = ?').get(Number(room_id)).m;
  const result = db.transaction(() => {
    const r = db.prepare("INSERT INTO chats (type, name, parent_id, position) VALUES ('room', ?, ?, ?)").run(name.trim(), Number(room_id), maxPos + 1);
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(Number(room_id));
    const ins = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)');
    members.forEach(({ user_id }) => ins.run(r.lastInsertRowid, user_id));
    return r.lastInsertRowid;
  })();
  const { sendTo } = require('../ws');
  db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(Number(room_id))
    .forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  const roomName = db.prepare('SELECT name FROM chats WHERE id = ?').get(Number(room_id))?.name || `#${room_id}`;
  logAudit(req, 'rooms', 'Создание темы', `«${name.trim()}» в «${roomName}»`);
  res.json({ id: Number(result) });
});

router.patch('/topics/:id', (req, res) => {
  const sub = db.prepare('SELECT id, parent_id FROM chats WHERE id = ? AND parent_id IS NOT NULL').get(Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const { name } = req.body;
  if (name?.trim()) db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(name.trim(), sub.id);
  const { sendTo } = require('../ws');
  db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(sub.parent_id)
    .forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  res.json({ ok: true });
});

router.delete('/topics/:id', (req, res) => {
  const sub = db.prepare('SELECT id, parent_id, name FROM chats WHERE id = ? AND parent_id IS NOT NULL').get(Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(sub.id);
  deleteChatFiles(sub.id);
  db.prepare('DELETE FROM chats WHERE id = ?').run(sub.id);
  members.forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  logAudit(req, 'rooms', 'Удаление темы', `«${sub.name}»`);
  res.json({ ok: true });
});

router.post('/topics/:id/avatar', (req, res) => {
  const sub = db.prepare('SELECT id FROM chats WHERE id = ? AND parent_id IS NOT NULL').get(Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Missing data' });
  const buf = Buffer.from(data, 'base64');
  if (!isImgBuf(buf)) return res.status(400).json({ error: 'Not an image' });
  fs.writeFileSync(path.join(AVATAR_DIR, `chat_${sub.id}.jpg`), buf);
  res.json({ ok: true });
});

router.post('/topics/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Invalid' });
  const upd = db.prepare('UPDATE chats SET position = ? WHERE id = ? AND parent_id IS NOT NULL');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
  res.json({ ok: true });
});

// ── Файлы ──

// Список файлов: вложения из живых сообщений плюс то, что лежит на диске без
// привязки. Миниатюры (_t.webp у картинок, _t.jpg — кадр-превью у видео) не
// считаются отдельными файлами. Одна функция на
// дашборд и на вкладку — иначе счётчики расходятся, как было с миниатюрами.
function collectFiles() {
  const msgs = db.prepare(`
    SELECT m.id, m.chat_id, m.attachment, m.sent_at, m.sender_id,
           u.display_name as sender_name, c.name as chat_name, c.type as chat_type
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN chats c ON c.id = m.chat_id
    WHERE m.attachment IS NOT NULL AND m.deleted = 0
  `).all();

  const fileMap = new Map();
  for (const msg of msgs) {
    try {
      const att = JSON.parse(msg.attachment);
      if (!att?.url) continue;
      const fname = path.basename(att.url);
      // Миниатюры (webp у картинок, кадр-превью jpg у видео) — не отдельные файлы
      if (/_t\.(webp|jpg)$/.test(fname)) continue;
      if (!fileMap.has(fname)) {
        // Зашифрованный файл: имя и тип в базе не хранятся — админка видит только
        // факт и размер, открыть или скачать его нельзя
        const enc = att.enc === 1;
        fileMap.set(fname, {
          filename: fname, encrypted: enc,
          name: enc ? null : (att.name || null), mime: enc ? null : (att.mime || null), thumb: enc ? null : (att.thumb || null),
          message_id: msg.id, chat_id: msg.chat_id, sender_id: msg.sender_id,
          chat_name: msg.chat_name, chat_type: msg.chat_type,
          sender_name: msg.sender_name, sent_at: msg.sent_at,
        });
      }
    } catch {}
  }

  // У личных чатов нет названия — подставляем имена собеседников, иначе в списке
  // файлов вместо чата стоял прочерк
  const directIds = [...new Set([...fileMap.values()].filter(f => f.chat_type === 'direct').map(f => f.chat_id))];
  if (directIds.length) {
    const ph = directIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT cm.chat_id, COALESCE(u.display_name, 'Удалённый аккаунт') AS name
      FROM chat_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id IN (${ph}) ORDER BY cm.chat_id, u.display_name
    `).all(...directIds);
    const byChat = new Map();
    rows.forEach(r => { if (!byChat.has(r.chat_id)) byChat.set(r.chat_id, []); byChat.get(r.chat_id).push(r.name); });
    for (const f of fileMap.values()) {
      if (f.chat_type === 'direct') f.chat_name = (byChat.get(f.chat_id) || []).join(' — ') || 'Личный чат';
    }
  }

  // Вторичный источник: файлы на диске, не привязанные ни к одному сообщению
  try {
    for (const fname of fs.readdirSync(FILES_DIR)) {
      if (/_t\.(webp|jpg)$/.test(fname) || fileMap.has(fname)) continue;
      fileMap.set(fname, { filename: fname });
    }
  } catch {}

  // Только то, что действительно лежит на диске. Сообщение с удалённым файлом
  // живо — в чате у него заглушка «Файл удалён», — но в списке файлов ему
  // места нет: смотреть и удалять там уже нечего, а строка висела с пометкой
  // «отсутствует» и завышала счётчик
  const out = [];
  for (const f of fileMap.values()) {
    let stat;
    try { stat = fs.statSync(path.join(FILES_DIR, f.filename)); } catch { continue; }
    out.push({ ...f, size: stat.size, mtime: stat.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

router.get('/files', (req, res) => {
  res.json(collectFiles());
});

router.delete('/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename) return res.status(400).json({ error: 'Invalid filename' });

  const withAtt = db.prepare('SELECT id, chat_id FROM messages WHERE deleted = 0 AND attachment LIKE ?').all(`%${filename}%`);
  const withFwd = db.prepare('SELECT id, chat_id, forward_data FROM messages WHERE deleted = 0 AND forward_data LIKE ?').all(`%${filename}%`);

  // Удалить файл и миниатюру с диска (webp у картинок, кадр-превью jpg у видео)
  const base = filename.replace(/\.[^.]+$/, '');
  [filename, base + '_t.webp', base + '_t.jpg'].forEach(n => {
    const p = path.join(FILES_DIR, n);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  });

  // Обновить forward_data: убрать url/thumb вложения, добавить expired
  for (const msg of withFwd) {
    try {
      const fd = JSON.parse(msg.forward_data);
      if (fd?.attachment?.url && path.basename(fd.attachment.url) === filename) {
        fd.attachment = { name: fd.attachment.name, mime: fd.attachment.mime, expired: true };
        db.prepare('UPDATE messages SET forward_data = ? WHERE id = ?').run(JSON.stringify(fd), msg.id);
      }
    } catch {}
  }

  // Broadcast message_edited для затронутых сообщений
  const allAffected = new Map();
  [...withAtt, ...withFwd].forEach(m => allAffected.set(m.id, m.chat_id));
  for (const [msgId, chatId] of allAffected) {
    const updated = getMessageWithStatus(msgId, null);
    if (updated) broadcast(chatId, { type: 'message_edited', message: updated });
  }

  res.json({ ok: true });
});

// ── Объявления ──

// Профиль системного пользователя (имя, тег, аватар) больше не настраивается:
// объявление в чате рисуется отдельной плашкой и ни одно из этих полей не показывает.
//
// Отправка и планирование живут в announcements.js — сюда приходит уже разобранный
// запрос. kind: popup | banner | chat, target: all | select.
router.post('/announcement', (req, res) => {
  const p = announcements.parseRequest(req.body, req.user.id);
  if (p.error) return res.status(p.status || 400).json({ error: p.error });
  res.json({ ok: true, ...announcements.create(p) });
});

// Журнал: все объявления всех типов, свежие сверху
router.get('/announcements', (req, res) => {
  res.json(announcements.journal());
});

router.post('/announcements/:id/stop', (req, res) => {
  if (!announcements.stop(Number(req.params.id))) return res.status(400).json({ error: 'Полоса уже не показывается' });
  res.json({ ok: true });
});

router.delete('/announcements/:id', (req, res) => {
  const ok = announcements.remove(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ── РЕЗЕРВНЫЕ КОПИИ ──
// Только по кнопке, без автоматики. db.backup() — штатный онлайн-бэкап SQLite:
// работает на живой базе с WAL и не блокирует пользователей.
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_RE = /^chat-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/;

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(n => BACKUP_RE.test(n))
      .map(name => {
        const st = fs.statSync(path.join(BACKUP_DIR, name));
        return { name, size: st.size, created_at: Math.floor(st.mtimeMs / 1000) };
      })
      .sort((a, b) => b.created_at - a.created_at);
  } catch { return []; }
}

async function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const name = `chat-${ts}.db`;
  await db.backup(path.join(BACKUP_DIR, name));
  return name;
}

// Срок хранения — вручную в днях, пусто/0 = хранить всегда (тот же принцип, что и у
// upload_file_lifetime для файлов). Чистим после каждого создания копии и раз в 6 часов —
// на случай, если новых копий долго не было, а старые всё равно должны истечь.
function pruneBackups() {
  const days = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'backup_retention_days'").get()?.value || '0');
  if (!days) return;
  const cutoff = Date.now() - days * 86_400_000;
  for (const b of listBackups()) {
    if (b.created_at * 1000 < cutoff) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); console.log('[Backup] Удалена устаревшая копия:', b.name); } catch {}
    }
  }
}
setInterval(pruneBackups, 6 * 3_600_000).unref();

router.get('/backups', (req, res) => res.json(listBackups()));

router.post('/backups', async (req, res) => {
  try {
    const name = await createBackup();
    console.log('[Backup] Создана копия:', name);
    pruneBackups();
    res.json({ ok: true, name, backups: listBackups() });
  } catch (e) {
    console.error('[Backup] Ошибка:', e.message);
    res.status(500).json({ error: 'Не удалось создать копию: ' + e.message });
  }
});

router.delete('/backups/:name', (req, res) => {
  const name = req.params.name;
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: 'Некорректное имя' });
  try {
    fs.unlinkSync(path.join(BACKUP_DIR, name));
    console.log('[Backup] Копия удалена вручную:', name);
    res.json({ ok: true, backups: listBackups() });
  } catch (e) {
    res.status(404).json({ error: 'Копия не найдена' });
  }
});

// Расписание: дни недели (0=вс..6=сб, как Date.getDay()) и время «ЧЧ:ММ» по времени
// сервера. Пусто — автокопирования нет, только по кнопке. Проверка раз в минуту;
// _lastAutoBackupKey не даёт запустить копию дважды в одну и ту же минуту
let _lastAutoBackupKey = null;
function startBackupSchedule() {
  setInterval(async () => {
    const daysRaw = db.prepare("SELECT value FROM settings WHERE key = 'backup_schedule_days'").get()?.value || '';
    const days = daysRaw.split(',').map(s => s.trim()).filter(Boolean).map(Number);
    if (!days.length) return;
    const time = db.prepare("SELECT value FROM settings WHERE key = 'backup_schedule_time'").get()?.value || '';
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) return;
    const now = new Date();
    if (!days.includes(now.getDay()) || now.getHours() !== Number(m[1]) || now.getMinutes() !== Number(m[2])) return;
    const key = now.toISOString().slice(0, 16);
    if (_lastAutoBackupKey === key) return;
    _lastAutoBackupKey = key;
    try {
      const name = await createBackup();
      console.log('[Backup] Автоматическая копия создана:', name);
      pruneBackups();
    } catch (e) { console.error('[Backup] Ошибка автокопии:', e.message); }
  }, 30_000);
}

router.get('/backups/:name/download', (req, res) => {
  // Имя сверяем с шаблоном, а не только с basename — иначе путь можно подобрать
  const name = req.params.name;
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: 'Некорректное имя' });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Копия не найдена' });
  res.download(file, name);
});

module.exports = router;
module.exports.startBackupSchedule = startBackupSchedule;
