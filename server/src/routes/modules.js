// Модули — необязательные возможности клиента. Сейчас один: «Анимированные смайлы».
//
// Два уровня. Админ включает модуль на сервере (таблица modules): пока он выключен, у
// пользователей его нет вообще, ни в настройках, ни в панели смайлов. Включённый модуль
// пользователь включает у себя на каждом устройстве отдельно; выбор хранит сам клиент,
// на сервер он только сообщает (module_devices) — для статистики в админке.
//
// Журнал module_events: включение и выключение (админом и пользователем), начало загрузки и
// её ошибка. Окончание загрузки намеренно не пишем. Храним год.
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { logAudit } = require('../audit');

const PACK_ROOT = path.join(__dirname, '..', 'public', 'modules');
const KEEP_DAYS = 365;
const CLIENTS = ['electron', 'web', 'mobile'];

// Реестр модулей. Новый модуль — новая запись здесь и своя папка в public/modules.
const REGISTRY = {
  animoji: {
    title: 'Анимированные смайлы',
    description: 'Смайлы и жесты оживают в сообщениях и реакциях. Нажатие на смайл в сообщении проигрывает анимацию ещё раз.',
    icon: '😀',
    // Пояснение в окне загрузки и под переключателем
    note: 'Смайлы оживают только в переписке: в сообщениях и реакциях. В панели смайлов они остаются неподвижными. Нажмите на смайл в сообщении, чтобы увидеть анимацию ещё раз.',
    needsDownload: true,
  },
};

function pack(key) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, key, 'manifest.json'), 'utf8'));
    return { version: m.version, count: m.count, bytes: m.bytes };
  } catch { return { version: 0, count: 0, bytes: 0 }; }
}

const isOn = key => !!db.prepare('SELECT enabled FROM modules WHERE key = ?').get(key)?.enabled;

function logEvent(key, req, ev) {
  db.prepare('INSERT INTO module_events (module, user_id, device_id, client, version, event, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key, req.user?.id || null, ev.device_id || null, ev.client || null, ev.version || null, ev.event, ev.detail || null);
}

const cleanup = () => {
  try { db.prepare('DELETE FROM module_events WHERE created_at < unixepoch() - ?').run(KEEP_DAYS * 86400); }
  catch (e) { console.warn('[Modules] не удалось почистить журнал:', e.message); }
};
cleanup();
setInterval(cleanup, 24 * 3600 * 1000).unref();

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// ── Для клиентов ──
const user = require('express').Router();

// Что доступно этому пользователю: только включённые админом модули
user.get('/', authMiddleware, (req, res) => {
  res.json(Object.entries(REGISTRY).filter(([k]) => isOn(k)).map(([k, m]) => ({
    key: k, title: m.title, description: m.description, icon: m.icon, note: m.note, needsDownload: m.needsDownload,
    base: `/modules/${k}`, ...pack(k),
  })));
});

// Клиент сообщает, включён ли модуль на этом устройстве
user.post('/:key/device', authMiddleware, (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key] || !isOn(key)) return res.status(404).json({ error: 'Модуль недоступен' });
  const device_id = str(req.body?.device_id, 64), client = str(req.body?.client, 16), version = str(req.body?.version, 32);
  const enabled = req.body?.enabled ? 1 : 0;
  const packVer = str(String(req.body?.pack ?? ''), 16);
  if (!device_id || !CLIENTS.includes(client)) return res.status(400).json({ error: 'Неверные данные' });
  const prev = db.prepare('SELECT enabled FROM module_devices WHERE module = ? AND user_id = ? AND device_id = ?').get(key, req.user.id, device_id);
  db.prepare(`INSERT INTO module_devices (module, user_id, device_id, client, version, enabled, pack_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(module, user_id, device_id) DO UPDATE SET client = excluded.client, version = excluded.version, enabled = excluded.enabled, pack_version = excluded.pack_version, updated_at = unixepoch()`)
    .run(key, req.user.id, device_id, client, version, enabled, packVer);
  if ((prev ? !!prev.enabled : false) !== !!enabled) logEvent(key, req, { device_id, client, version, event: enabled ? 'user_on' : 'user_off' });
  res.json({ ok: true });
});

// Начало загрузки (или обновления) набора и её ошибка (только Electron: веб и мобильный подгружают по мере показа)
user.post('/:key/event', authMiddleware, (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key] || !isOn(key)) return res.status(404).json({ error: 'Модуль недоступен' });
  const event = req.body?.event;
  if (!['download_start', 'download_error', 'update_start', 'update_error'].includes(event)) return res.status(400).json({ error: 'Неверное событие' });
  logEvent(key, req, { device_id: str(req.body?.device_id, 64), client: str(req.body?.client, 16), version: str(req.body?.version, 32), event, detail: str(req.body?.detail, 200) });
  res.json({ ok: true });
});

// ── Для админки ──
const admin = require('express').Router();
admin.use(authMiddleware, adminMiddleware);

function stats(key) {
  const one = sql => db.prepare(sql).get(key);
  const users = one("SELECT COUNT(DISTINCT user_id) n FROM module_devices WHERE module = ? AND enabled = 1").n;
  const by = Object.fromEntries(CLIENTS.map(c => [c, db.prepare("SELECT COUNT(DISTINCT user_id) n FROM module_devices WHERE module = ? AND enabled = 1 AND client = ?").get(key, c).n]));
  const total = db.prepare("SELECT COUNT(*) n FROM users WHERE is_bot = 0 AND COALESCE(banned, 0) = 0").get().n;
  const errors = db.prepare("SELECT COUNT(*) n FROM module_events WHERE module = ? AND event = 'download_error' AND created_at > unixepoch() - 30 * 86400").get(key).n;
  // Устройства с включённым модулем, у которых набор не той версии, что сейчас на сервере
  const cur = String(pack(key).version);
  const outdated = db.prepare("SELECT COUNT(*) n FROM module_devices WHERE module = ? AND enabled = 1 AND COALESCE(pack_version, '') != ?").get(key, cur).n;
  return { users, total, byClient: by, errors30d: errors, outdated };
}

admin.get('/', (req, res) => {
  res.json(Object.entries(REGISTRY).map(([k, m]) => ({
    key: k, title: m.title, description: m.description, needsDownload: m.needsDownload,
    enabled: isOn(k), ...pack(k), stats: stats(k), keepDays: KEEP_DAYS,
  })));
});

admin.put('/:key', (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key]) return res.status(404).json({ error: 'Нет такого модуля' });
  const enabled = req.body?.enabled ? 1 : 0;
  const was = isOn(key);
  db.prepare(`INSERT INTO modules (key, enabled, updated_at, updated_by) VALUES (?, ?, unixepoch(), ?)
    ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = unixepoch(), updated_by = excluded.updated_by`)
    .run(key, enabled, req.user.id);
  if (was !== !!enabled) {
    logEvent(key, req, { client: 'admin', event: enabled ? 'admin_on' : 'admin_off' });
    logAudit(req, 'server', `Модуль «${REGISTRY[key].title}»`, enabled ? 'включён' : 'выключен');
    // Клиенты узнают сразу, без перезапуска: заново спрашивают список модулей
    try { require('../ws').broadcastAll({ type: 'modules_changed' }); } catch (e) { console.warn('[Modules] не удалось разослать:', e.message); }
  }
  res.json({ ok: true, enabled: !!enabled });
});

const EVENT_GROUPS = { on: ['admin_on', 'user_on'], off: ['admin_off', 'user_off'], dl: ['download_start', 'update_start'], err: ['download_error', 'update_error'] };

admin.get('/:key/log', (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key]) return res.status(404).json({ error: 'Нет такого модуля' });
  const where = ['e.module = ?'], args = [key];
  const group = EVENT_GROUPS[req.query.event];
  if (group) { where.push(`e.event IN (${group.map(() => '?').join(',')})`); args.push(...group); }
  if (CLIENTS.includes(req.query.client) || req.query.client === 'admin') { where.push('e.client = ?'); args.push(req.query.client); }
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), KEEP_DAYS);
  where.push('e.created_at > unixepoch() - ?'); args.push(days * 86400);
  const q = str(req.query.q, 60).trim().toLowerCase();
  if (q) { where.push('(LOWER(u.display_name) LIKE ? OR LOWER(u.username) LIKE ? OR LOWER(COALESCE(e.client, \'\')) LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const from = `FROM module_events e LEFT JOIN users u ON u.id = e.user_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...args).n;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200), offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = db.prepare(`SELECT e.id, e.created_at, e.client, e.version, e.event, e.detail, u.id user_id, u.display_name, u.username ${from} ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, rows });
});

module.exports = { user, admin };
