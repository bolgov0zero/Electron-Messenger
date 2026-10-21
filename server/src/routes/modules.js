// Модули — необязательные возможности клиента (сейчас один: GIF от Klipy, см. REGISTRY).
//
// Два уровня. Админ включает модуль на сервере (таблица modules): пока он выключен, у
// пользователей его нет вообще, ни в настройках, ни в панели смайлов. Включённый модуль
// пользователь включает у себя на каждом устройстве отдельно; выбор хранит сам клиент,
// на сервер он только сообщает (module_devices) — для статистики в админке.
//
// Журнал module_events: включение и выключение (админом и пользователем), начало загрузки и
// её ошибка. Окончание загрузки намеренно не пишем. Храним год.
const { filterAsync } = require('../aiter.js');
const path = require('path');
const fs = require('fs');
const dal = require('../dal');
const { authMiddleware, adminMiddleware } = require('../auth');
const { logAudit } = require('../audit');

const PACK_ROOT = path.join(__dirname, '..', 'public', 'modules');
const KEEP_DAYS = 365;
const CLIENTS = ['electron', 'web', 'mobile'];

// Реестр модулей. Новый модуль — новая запись здесь и своя папка в public/modules/<ключ> с manifest.json.
// Поля: title, description, icon, note (пояснение под переключателем), needsDownload (нужен ли набор файлов).
// Сейчас модулей нет: «Анимированные смайлы» сняты в s2.1.61, раздел оставлен как задел на будущее.
const REGISTRY = {
  gif: {
    title: 'GIF', provider: 'Klipy', icon: 'GIF', needsDownload: false,
    description: 'Поиск и отправка GIF из библиотеки Klipy. Вкладка «GIF» появится в панели смайлов.',
    note: 'Поиск и картинки загружаются напрямую с серверов Klipy, поэтому сервис видит ваш IP-адрес и поисковые запросы. Файлы на сервер чата не копируются. Включённый модуль нужен, чтобы искать и отправлять GIF: присланные вам GIF видны и без него. В секретных чатах GIF недоступны.',
  },
};
const gifLib = require('../gif');

function pack(key) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, key, 'manifest.json'), 'utf8'));
    return { version: m.version, count: m.count, bytes: m.bytes };
  } catch { return { version: 0, count: 0, bytes: 0 }; }
}

const isOn = async key => !!(await dal.get('SELECT enabled FROM modules WHERE key = ?', key))?.enabled && (key !== 'gif' || !!(await gifLib.getKey()));

async function logEvent(key, req, ev) {
  await dal.run('INSERT INTO module_events (module, user_id, device_id, client, version, event, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', key, req.user?.id || null, ev.device_id || null, ev.client || null, ev.version || null, ev.event, ev.detail || null);
}

const cleanup = async () => {
  try { await dal.run('DELETE FROM module_events WHERE created_at < unixepoch() - ?', KEEP_DAYS * 86400); }
  catch (e) { console.warn('[Modules] не удалось почистить журнал:', e.message); }
};
// Журнал чистится после запуска сервера (index.js вызывает init) и раз в сутки
function init() { cleanup(); setInterval(cleanup, 24 * 3600 * 1000).unref(); }

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// ── Для клиентов ──
const user = require('express').Router();

// Что доступно этому пользователю: только включённые админом модули
user.get('/', authMiddleware, async (req, res) => {
  res.json((await Promise.all((await filterAsync(Object.entries(REGISTRY), async ([k]) => (await isOn(k)))).map(async ([k, m]) => ({
    key: k, title: m.title, description: m.description, icon: m.icon, note: m.note, needsDownload: m.needsDownload, provider: m.provider || null,
    base: `/modules/${k}`, ...pack(k),
    // Ключ Klipy нужен клиенту: по условиям сервиса запросы идут с устройства пользователя
    ...(k === 'gif' ? { config: { provider: 'klipy', key: (await gifLib.getKey()) } } : {}),
  })))));
});

// Клиент сообщает, включён ли модуль на этом устройстве
user.post('/:key/device', authMiddleware, async (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key] || !(await isOn(key))) return res.status(404).json({ error: 'Модуль недоступен' });
  const device_id = str(req.body?.device_id, 64), client = str(req.body?.client, 16), version = str(req.body?.version, 32);
  const enabled = req.body?.enabled ? 1 : 0;
  const packVer = str(String(req.body?.pack ?? ''), 16);
  if (!device_id || !CLIENTS.includes(client)) return res.status(400).json({ error: 'Неверные данные' });
  const prev = await dal.get('SELECT enabled FROM module_devices WHERE module = ? AND user_id = ? AND device_id = ?', key, req.user.id, device_id);
  await dal.run(`INSERT INTO module_devices (module, user_id, device_id, client, version, enabled, pack_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(module, user_id, device_id) DO UPDATE SET client = excluded.client, version = excluded.version, enabled = excluded.enabled, pack_version = excluded.pack_version, updated_at = unixepoch()`, key, req.user.id, device_id, client, version, enabled, packVer);
  if ((prev ? !!prev.enabled : false) !== !!enabled) await logEvent(key, req, { device_id, client, version, event: enabled ? 'user_on' : 'user_off' });
  res.json({ ok: true });
});

// Начало загрузки (или обновления) набора и её ошибка (только Electron: веб и мобильный подгружают по мере показа)
user.post('/:key/event', authMiddleware, async (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key] || !(await isOn(key))) return res.status(404).json({ error: 'Модуль недоступен' });
  const event = req.body?.event;
  if (!['download_start', 'download_error', 'update_start', 'update_error'].includes(event)) return res.status(400).json({ error: 'Неверное событие' });
  await logEvent(key, req, { device_id: str(req.body?.device_id, 64), client: str(req.body?.client, 16), version: str(req.body?.version, 32), event, detail: str(req.body?.detail, 200) });
  res.json({ ok: true });
});

// ── Для админки ──
const admin = require('express').Router();
admin.use(authMiddleware, adminMiddleware);

async function stats(key) {
  const one = async sql => (await dal.get(sql, key));
  const users = (await one("SELECT COUNT(DISTINCT user_id) n FROM module_devices WHERE module = ? AND enabled = 1")).n;
  const by = Object.fromEntries((await Promise.all(CLIENTS.map(async c => [c, (await dal.get("SELECT COUNT(DISTINCT user_id) n FROM module_devices WHERE module = ? AND enabled = 1 AND client = ?", key, c)).n]))));
  const total = (await dal.get("SELECT COUNT(*) n FROM users WHERE is_bot = 0 AND COALESCE(banned, 0) = 0")).n;
  const errors = (await dal.get("SELECT COUNT(*) n FROM module_events WHERE module = ? AND event = 'download_error' AND created_at > unixepoch() - 30 * 86400", key)).n;
  // Устройства с включённым модулем, у которых набор не той версии, что сейчас на сервере
  const cur = String(pack(key).version);
  const outdated = (await dal.get("SELECT COUNT(*) n FROM module_devices WHERE module = ? AND enabled = 1 AND COALESCE(pack_version, '') != ?", key, cur)).n;
  return { users, total, byClient: by, errors30d: errors, outdated };
}

admin.get('/', async (req, res) => {
  res.json((await Promise.all(Object.entries(REGISTRY).map(async ([k, m]) => ({
    key: k, title: m.title, description: m.description, needsDownload: m.needsDownload,
    enabled: (await isOn(k)), ...pack(k), stats: (await stats(k)), keepDays: KEEP_DAYS, icon: REGISTRY[k].icon, provider: REGISTRY[k].provider || null,
    ...(k === 'gif' ? { config: { hasKey: !!(await gifLib.getKey()), tail: (await gifLib.getKey()).slice(-4) } } : {}),
  })))));
});

admin.put('/:key', async (req, res) => {
  const key = req.params.key;
  if (!REGISTRY[key]) return res.status(404).json({ error: 'Нет такого модуля' });
  const enabled = req.body?.enabled ? 1 : 0;
  if (key === 'gif' && enabled && !(await gifLib.getKey())) return res.status(400).json({ error: 'Сначала сохраните API-ключ Klipy' });
  const was = await isOn(key);
  await dal.run(`INSERT INTO modules (key, enabled, updated_at, updated_by) VALUES (?, ?, unixepoch(), ?)
    ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = unixepoch(), updated_by = excluded.updated_by`, key, enabled, req.user.id);
  if (was !== !!enabled) {
    await logEvent(key, req, { client: 'admin', event: enabled ? 'admin_on' : 'admin_off' });
    logAudit(req, 'server', `Модуль «${REGISTRY[key].title}»`, enabled ? 'включён' : 'выключен');
    // Клиенты узнают сразу, без перезапуска: заново спрашивают список модулей
    try { require('../ws').broadcastAll({ type: 'modules_changed' }); } catch (e) { console.warn('[Modules] не удалось разослать:', e.message); }
  }
  res.json({ ok: true, enabled: !!enabled });
});

// Ключ целиком получает только администратор: для проверки с его устройства (клиентам он и так выдаётся при включении модуля)
admin.get('/gif/key', async (req, res) => res.json({ key: (await gifLib.getKey()) }));

// API-ключ Klipy: сохранить, заменить или удалить (без ключа модуль выключается)
admin.put('/gif/key', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (key.length < 8 || key.length > 200 || !/^[\w.~-]+$/.test(key)) return res.status(400).json({ error: 'Ключ выглядит неверно: латиница, цифры и - _ . ~, не короче 8 символов' });
  const had = !!(await gifLib.getKey());
  await gifLib.setKey(key);
  logAudit(req, 'server', 'Модуль «GIF»', had ? 'API-ключ Klipy заменён' : 'API-ключ Klipy сохранён');
  try { require('../ws').broadcastAll({ type: 'modules_changed' }); } catch {}
  res.json({ ok: true, hasKey: true, tail: key.slice(-4) });
});
admin.delete('/gif/key', async (req, res) => {
  if (!(await gifLib.getKey())) return res.json({ ok: true });
  await gifLib.setKey('');
  await dal.run("UPDATE modules SET enabled = 0, updated_at = unixepoch(), updated_by = ? WHERE key = 'gif'", req.user.id);
  await logEvent('gif', req, { client: 'admin', event: 'admin_off' });
  logAudit(req, 'server', 'Модуль «GIF»', 'API-ключ Klipy удалён, модуль выключен');
  try { require('../ws').broadcastAll({ type: 'modules_changed' }); } catch {}
  res.json({ ok: true });
});

const EVENT_GROUPS = { on: ['admin_on', 'user_on'], off: ['admin_off', 'user_off'], dl: ['download_start', 'update_start'], err: ['download_error', 'update_error'] };

admin.get('/:key/log', async (req, res) => {
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
  const total = (await dal.get(`SELECT COUNT(*) n ${from}`, ...args)).n;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200), offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = await dal.all(`SELECT e.id, e.created_at, e.client, e.version, e.event, e.detail, u.id user_id, u.display_name, u.username ${from} ORDER BY e.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  res.json({ total, rows });
});

module.exports = { user, admin, init };
