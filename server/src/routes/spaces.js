// Рабочие пространства: контакты, блокировки и управление пространствами из админки.
// Правило видимости — в spaces.js, здесь только маршруты.
const express = require('express');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { sendTo, broadcastAll } = require('../ws');
const { logAudit } = require('../audit');
const spaces = require('../spaces');

// ── Контакты ──
const contacts = express.Router();
contacts.use(authMiddleware);

// Перебор логинов: не больше 10 попыток в минуту на человека
const tries = new Map();
function tooMany(userId) {
  const now = Date.now(), list = (tries.get(userId) || []).filter(t => now - t < 60000);
  list.push(now); tries.set(userId, list);
  return list.length > 10;
}

const publicUser = (viewerId, id) => spaces.listFor(viewerId).find(u => u.id === id) || null;

// Добавить в контакты по точному логину. Второму человеку ничего не отправляется.
// Ответ «не найден» одинаков для несуществующего, заблокированного и служебного логина.
contacts.post('/', (req, res) => {
  if (tooMany(req.user.id)) return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
  const login = String(req.body?.username || '').trim().replace(/^@/, '');
  if (!login) return res.status(400).json({ error: 'Введите логин' });
  const target = db.prepare('SELECT id, workspace_id FROM users WHERE username = ? AND COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0').get(login)
    || db.prepare('SELECT id, workspace_id FROM users WHERE LOWER(username) = LOWER(?) AND COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0').get(login);
  if (!target || target.id === req.user.id) return res.status(404).json({ error: 'Пользователь с таким логином не найден', code: 'not_found' });
  if (target.workspace_id === spaces.wsOf(req.user.id)) return res.status(409).json({ error: 'Этот человек уже в вашем пространстве, добавлять не нужно', code: 'same_space' });
  if (db.prepare('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?').get(req.user.id, target.id))
    return res.status(409).json({ error: 'Этот человек уже у вас в контактах', code: 'already' });
  db.prepare('INSERT INTO contacts (owner_id, contact_id) VALUES (?, ?)').run(req.user.id, target.id);
  sendTo(req.user.id, { type: 'contacts_changed' });   // остальные устройства обновят список
  notifyLimit(target.id, req.user.id);
  // Если второй человек уже добавил вас, присутствие теперь видно с обеих сторон: его клиенты обновляют статусы (события «кто добавил» нет)
  if (spaces.mutualContact(req.user.id, target.id)) sendTo(target.id, { type: 'presence_refresh' });
  res.json({ ok: true, user: publicUser(req.user.id, target.id) });
});

// Контакт добавлен или удалён: у отправителя меняется ограничение «сообщений без ответа», сообщаем его клиентам
function notifyLimit(senderId, recipientId) {
  spaces.directChatIds(senderId, recipientId).forEach(chatId => sendTo(senderId, { type: 'chat_limit', chat_id: chatId, dm_limit: spaces.limitFor(senderId, recipientId) }));
}
contacts.delete('/:id', (req, res) => {
  const wasMutual = spaces.mutualContact(req.user.id, Number(req.params.id));
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?').run(req.user.id, Number(req.params.id));
  if (wasMutual) sendTo(Number(req.params.id), { type: 'presence_refresh' });
  sendTo(req.user.id, { type: 'contacts_changed' });
  notifyLimit(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ── Блокировки ──
const blocks = express.Router();
blocks.use(authMiddleware);

blocks.get('/', (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.display_name, u.tag, u.workspace_id, w.name AS workspace_name, b.created_at
    FROM user_blocks b JOIN users u ON u.id = b.blocked_id JOIN workspaces w ON w.id = u.workspace_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC`).all(req.user.id));
});

blocks.post('/', (req, res) => {
  const id = Number(req.body?.user_id);
  const target = id && db.prepare('SELECT id, is_admin, is_bot FROM users WHERE id = ?').get(id);
  if (!target || target.is_bot || id === req.user.id) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.is_admin) return res.status(400).json({ error: 'Администратора заблокировать нельзя' });
  db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, id);
  sendTo(req.user.id, { type: 'blocks_changed' });
  res.json({ ok: true });
});

blocks.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, Number(req.params.id));
  sendTo(req.user.id, { type: 'blocks_changed' });
  res.json({ ok: true });
});

// ── Администрирование пространств ──
const admin = express.Router();
admin.use(authMiddleware, adminMiddleware);

const nameOk = n => { const s = String(n || '').trim().replace(/\s+/g, ' '); return s && s.length <= 60 ? s : null; };

admin.get('/', (req, res) => {
  res.json(db.prepare(`SELECT w.id, w.name, w.created_at, (w.id = ?) AS is_default,
      (SELECT COUNT(*) FROM users u WHERE u.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0) AS users
    FROM workspaces w ORDER BY w.id`).all(spaces.DEFAULT_WS).map(w => ({ ...w, is_default: !!w.is_default })));
});

admin.post('/', (req, res) => {
  const name = nameOk(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите название (до 60 символов)' });
  try {
    const r = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name);
    logAudit(req, 'server', 'Пространство создано', name);
    res.json({ id: r.lastInsertRowid, name });
  } catch { res.status(409).json({ error: 'Пространство с таким названием уже есть' }); }
});

admin.patch('/:id', (req, res) => {
  const id = Number(req.params.id), name = nameOk(req.body?.name);
  const w = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  if (!name) return res.status(400).json({ error: 'Введите название (до 60 символов)' });
  try {
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
    logAudit(req, 'server', 'Пространство переименовано', `«${w.name}» → «${name}»`);
    broadcastAll({ type: 'directory_changed' });   // подписи пространств обновляются у всех
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Пространство с таким названием уже есть' }); }
});

admin.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  if (id === spaces.DEFAULT_WS) return res.status(400).json({ error: 'Основное пространство удалить нельзя' });
  if (db.prepare('SELECT 1 FROM users WHERE workspace_id = ? LIMIT 1').get(id)) return res.status(400).json({ error: 'В пространстве есть люди. Сначала переведите их в другое.' });
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  logAudit(req, 'server', 'Пространство удалено', w.name);
  res.json({ ok: true });
});

module.exports = { contacts, blocks, admin };
