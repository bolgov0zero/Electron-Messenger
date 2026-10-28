// Рабочие пространства: контакты, блокировки и управление пространствами из админки.
// Правило видимости — в spaces.js, здесь только маршруты.
const express = require('express');
const dal = require('../dal');
const { authMiddleware, adminMiddleware } = require('../auth');
const { sendTo, broadcastAll } = require('../ws');
const { logAudit } = require('../audit');
const spaces = require('../spaces');
const fed = require('../federation');
const fsp = require('../fedspaces');

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

// Пространства человека (все, где он состоит): клиенты показывают их в панели и фильтруют по ним чаты и контакты.
// shared — пространство общее для нескольких серверов, servers — сколько серверов в нём; people — людей этого сервера
contacts.get('/spaces', async (req, res) => {
  res.json((await dal.all(`SELECT w.id, w.name, (w.fed_uid IS NOT NULL) AS shared,
      (SELECT COUNT(*) FROM fed_space_servers s WHERE s.space_uid = w.fed_uid AND s.state = 'active') AS servers,
      (SELECT COUNT(*) FROM user_workspaces x JOIN users u ON u.id = x.user_id WHERE x.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0) AS people
    FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY (w.fed_uid IS NULL), w.name`, req.user.id)).map(w => ({ ...w, shared: !!w.shared })));
});

const publicUser = async (viewerId, id) => (await spaces.listFor(viewerId)).find(u => u.id === id) || null;

// Добавить в контакты по точному логину. Второму человеку ничего не отправляется.
// Ответ «не найден» одинаков для несуществующего, заблокированного и служебного логина.
contacts.post('/', async (req, res) => {
  if (tooMany(req.user.id)) return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
  const login = String(req.body?.username || '').trim().replace(/^@/, '');
  if (!login) return res.status(400).json({ error: 'Введите логин' });
  // Адрес вида «@сервер:логин» с подключённого сервера: человек из другой организации
  const addr = fed.parseAddr(login);
  if (addr && (await fed.peerByInstance(addr.instance))) return await addFederated(req, res, login);
  const target = (await dal.get('SELECT id, workspace_id FROM users WHERE username = ? AND COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0', login))
    || (await dal.get('SELECT id, workspace_id FROM users WHERE LOWER(username) = LOWER(?) AND COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0', login));
  if (!target || target.id === req.user.id) {
    // Старый вид адреса «сервер@логин» больше не принимается: подсказываем новый
    const old = /^([a-z0-9][a-z0-9._-]{1,31})@.+$/i.exec(login);
    if (old && (await fed.peerByInstance(old[1].toLowerCase()))) return res.status(400).json({ error: 'Введите адрес вида @сервер:логин', code: 'bad_address' });
    return res.status(404).json({ error: 'Пользователь с таким логином не найден', code: 'not_found' });
  }
  if ((await spaces.shares(req.user.id, target.id))) return res.status(409).json({ error: 'Этот человек уже в вашем пространстве, добавлять не нужно', code: 'same_space' });
  if ((await dal.get('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?', req.user.id, target.id)))
    return res.status(409).json({ error: 'Этот человек уже у вас в контактах', code: 'already' });
  await dal.run('INSERT INTO contacts (owner_id, contact_id) VALUES (?, ?)', req.user.id, target.id);
  sendTo(req.user.id, { type: 'contacts_changed' });   // остальные устройства обновят список
  await notifyLimit(target.id, req.user.id);
  // Если второй человек уже добавил вас, присутствие теперь видно с обеих сторон: его клиенты обновляют статусы (события «кто добавил» нет)
  if ((await spaces.mutualContact(req.user.id, target.id))) sendTo(target.id, { type: 'presence_refresh' });
  res.json({ ok: true, user: (await publicUser(req.user.id, target.id)) });
});

async function addFederated(req, res, address) {
  const r = await fed.lookupRemote(address);
  if (r.error) return res.status(r.code === 'offline' ? 503 : 404).json({ error: r.error, code: r.code });
  const target = r.shadow;
  if ((await dal.get('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?', req.user.id, target.id)))
    return res.status(409).json({ error: 'Этот человек уже у вас в контактах', code: 'already' });
  await dal.run('INSERT INTO contacts (owner_id, contact_id) VALUES (?, ?)', req.user.id, target.id);
  sendTo(req.user.id, { type: 'contacts_changed' });
  await fed.onContactAdded(req.user.id, target.id);
  if ((await spaces.mutualContact(req.user.id, target.id))) sendTo(req.user.id, { type: 'presence_refresh' });
  res.json({ ok: true, user: (await publicUser(req.user.id, target.id)) });
}

// Контакт добавлен или удалён: у отправителя меняется ограничение «сообщений без ответа», сообщаем его клиентам
async function notifyLimit(senderId, recipientId) {
  for (const chatId of (await spaces.directChatIds(senderId, recipientId))) sendTo(senderId, { type: 'chat_limit', chat_id: chatId, dm_limit: (await spaces.limitFor(senderId, recipientId)) }) ;
}
contacts.delete('/:id', async (req, res) => {
  const wasMutual = await spaces.mutualContact(req.user.id, Number(req.params.id));
  const removed = (await dal.run('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?', req.user.id, Number(req.params.id))).changes;
  if (removed && (await spaces.isFed(Number(req.params.id)))) await fed.onContactRemoved(req.user.id, Number(req.params.id));
  if (wasMutual) sendTo(Number(req.params.id), { type: 'presence_refresh' });
  sendTo(req.user.id, { type: 'contacts_changed' });
  await notifyLimit(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ── Блокировки ──
const blocks = express.Router();
blocks.use(authMiddleware);

blocks.get('/', async (req, res) => {
  res.json((await dal.all(`SELECT u.id, u.username, u.display_name, u.tag, u.workspace_id, w.name AS workspace_name, b.created_at, (u.is_bot = 2) AS federated, u.fed_login AS login, u.fed_instance AS server_id
    FROM user_blocks b JOIN users u ON u.id = b.blocked_id LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC`, req.user.id)).map(r => ({ ...r, federated: !!r.federated })));
});

blocks.post('/', async (req, res) => {
  const id = Number(req.body?.user_id);
  const target = id && (await dal.get('SELECT id, is_admin, is_bot FROM users WHERE id = ?', id));
  if (!target || (target.is_bot && target.is_bot !== spaces.FED) || id === req.user.id) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.is_admin) return res.status(400).json({ error: 'Администратора заблокировать нельзя' });
  await dal.run('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', req.user.id, id);
  sendTo(req.user.id, { type: 'blocks_changed' });
  res.json({ ok: true });
});

blocks.delete('/:id', async (req, res) => {
  await dal.run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, Number(req.params.id));
  sendTo(req.user.id, { type: 'blocks_changed' });
  res.json({ ok: true });
});

// ── Администрирование пространств ──
const admin = express.Router();
admin.use(authMiddleware, adminMiddleware);

const nameOk = n => { const s = String(n || '').trim().replace(/\s+/g, ' '); return s && s.length <= 60 ? s : null; };

admin.get('/', async (req, res) => {
  res.json((await Promise.all((await dal.all(`SELECT w.id, w.name, w.created_at, w.fed_uid, w.fed_host, (w.id = ?) AS is_default,
      (SELECT COUNT(*) FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0) AS users,
      (SELECT COUNT(*) FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0
        AND (SELECT COUNT(*) FROM user_workspaces m2 WHERE m2.user_id = m.user_id) = 1) AS only_here
    FROM workspaces w ORDER BY w.id`, spaces.DEFAULT_WS)).map(async w => ({ ...w, is_default: !!w.is_default, fed: (await fsp.adminInfo(w)), candidates: (await fsp.candidates(w)) })))));
});
// Приглашения и просьбы общих пространств
admin.get('/fed/offers', async (req, res) => res.json((await fsp.offersList())));
admin.post('/fed/offers/:uid/accept', async (req, res) => {
  const r = await fsp.acceptOffer(String(req.params.uid), req.body?.attach ? Number(req.body.attach) : null);
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', r.attached ? 'Общее пространство принято (объединено с существующим)' : 'Общее пространство принято', r.name);
  res.json(r);
});
admin.post('/fed/offers/:uid/decline', async (req, res) => {
  const r = await fsp.declineOffer(String(req.params.uid));
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', 'Общее пространство отклонено', String(req.params.uid));
  res.json(r);
});
admin.post('/fed/asks/:id/approve', async (req, res) => {
  const r = await fsp.approveAsk(Number(req.params.id));
  if (r.error) return res.status(404).json(r);
  logAudit(req, 'server', 'Общее пространство: расширение одобрено', String(req.params.id));
  res.json(r);
});
admin.post('/fed/asks/:id/decline', async (req, res) => {
  const r = await fsp.declineAsk(Number(req.params.id));
  if (r.error) return res.status(404).json(r);
  res.json(r);
});
// «Общее»: включить или выключить, пригласить сервер, убрать сервер (или выйти самому)
admin.post('/:id/shared', async (req, res) => {
  const id = Number(req.params.id), w = await dal.get('SELECT name FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  const r = req.body?.on ? (await fsp.enableShared(id)) : (await fsp.disableShared(id));
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', req.body?.on ? 'Пространство стало общим' : 'Пространство перестало быть общим', w.name);
  broadcastAll({ type: 'directory_changed' });
  res.json({ ok: true });
});
admin.post('/:id/servers', async (req, res) => {
  const id = Number(req.params.id), w = await dal.get('SELECT name FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  const r = await fsp.offerServer(id, req.body?.instance);
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', 'Общее пространство: сервер приглашён', `${w.name} → ${String(req.body?.instance).slice(0, 40)}`);
  res.json(r);
});
admin.delete('/:id/servers/:inst', async (req, res) => {
  const id = Number(req.params.id), w = await dal.get('SELECT name FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  const r = await fsp.removeServer(id, String(req.params.inst));
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', 'Общее пространство: сервер убран', `${w.name}: ${String(req.params.inst).slice(0, 40)}`);
  broadcastAll({ type: 'directory_changed' });
  res.json(r);
});

admin.post('/', async (req, res) => {
  const name = nameOk(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите название (до 60 символов)' });
  try {
    const r = await dal.run('INSERT INTO workspaces (name) VALUES (?)', name);
    logAudit(req, 'server', 'Пространство создано', name);
    res.json({ id: r.lastInsertRowid, name });
  } catch (e) {
    if (!/UNIQUE|unique|duplicate|23505/.test(String(e && e.message) + String(e && e.code))) { console.warn('[spaces.js]', e && e.message); return res.status(500).json({ error: 'Internal error' }); }
    res.status(409).json({ error: 'Пространство с таким названием уже есть' });
  }
});

admin.patch('/:id', async (req, res) => {
  const id = Number(req.params.id), name = nameOk(req.body?.name);
  const w = await dal.get('SELECT name, fed_uid, fed_host FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  if (!name) return res.status(400).json({ error: 'Введите название (до 60 символов)' });
  if (w.fed_uid && w.fed_host !== (await fed.identity()).id) return res.status(400).json({ error: 'Название общего пространства задаёт его хозяин' });
  try {
    await dal.run('UPDATE workspaces SET name = ? WHERE id = ?', name, id);
    if (w.fed_uid) await fsp.broadcastTree(w.fed_uid);
    logAudit(req, 'server', 'Пространство переименовано', `«${w.name}» → «${name}»`);
    broadcastAll({ type: 'directory_changed' });   // подписи пространств обновляются у всех
    res.json({ ok: true });
  } catch (e) {
    if (!/UNIQUE|unique|duplicate|23505/.test(String(e && e.message) + String(e && e.code))) { console.warn('[spaces.js]', e && e.message); return res.status(500).json({ error: 'Internal error' }); }
    res.status(409).json({ error: 'Пространство с таким названием уже есть' });
  }
});

admin.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const w = await dal.get('SELECT name, fed_uid FROM workspaces WHERE id = ?', id);
  if (!w) return res.status(404).json({ error: 'Пространство не найдено' });
  if (w.fed_uid) return res.status(400).json({ error: 'Пространство общее. Сначала выключите «Общее» (хозяин) или выйдите из него.' });
  if (id === spaces.DEFAULT_WS) return res.status(400).json({ error: 'Основное пространство удалить нельзя' });
  // Пространство убирается у всех, кто в нём состоял; если оно было единственным, человек переходит в основное
  const members = (await dal.all('SELECT m.user_id FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND COALESCE(u.is_bot, 0) = 0', id)).map(r => r.user_id);
  let moved = 0;
  await dal.tx(() => (async () => {
    for (const uid of members) {
      const rest = (await spaces.wsIdsOf(uid)).filter(x => x !== id);
      if (!rest.length) moved++;
      await spaces.setWorkspaces(uid, rest.length ? rest : [spaces.DEFAULT_WS]);
    }
    await dal.run('DELETE FROM workspaces WHERE id = ?', id);
  })());
  for (const uid of members) { try { await spaces.afterMove(uid); } catch {} } ;
  logAudit(req, 'server', 'Пространство удалено', members.length ? `${w.name}: людей ${members.length}, переведено в основное ${moved}` : w.name);
  if (members.length) broadcastAll({ type: 'directory_changed' });
  res.json({ ok: true, people: members.length, moved });
});

module.exports = { contacts, blocks, admin };
