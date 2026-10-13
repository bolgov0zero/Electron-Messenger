// Рабочие пространства: кто кого видит. Единое место для правила видимости — им пользуются
// списки людей, присутствие, создание чатов и групп, объявления и рассылка событий.
//
// Правило: человек B виден человеку A, если они в одном пространстве или B добавлен в контакты A
// (контакты односторонние: A видит B, а B не видит A). Администратор видит всех. Совместные чаты
// и группы видимость не меняют: участники друг друга там видят, но в списках и поиске чужих нет.
//
// Человек с другого сервера (федерация) хранится как «теневой» пользователь, is_bot = 2. Он виден только тому,
// кто добавил его в контакты (администратор тоже), а в пространстве его нет.
const db = require('./db');

const DEFAULT_WS = 1;

const q = {
  user: db.prepare('SELECT id, workspace_id, is_admin, is_bot FROM users WHERE id = ?'),
  contact: db.prepare('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?'),
};

function wsOf(userId) { return q.user.get(userId)?.workspace_id || DEFAULT_WS; }
// Человек с другого сервера
const FED = 2;
function isFed(userId) { return q.user.get(userId)?.is_bot === FED; }
function isAdminUser(userId) { return !!q.user.get(userId)?.is_admin; }

// Видит ли viewer человека target в списках и поиске
function canSee(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const v = q.user.get(viewerId), t = q.user.get(targetId);
  if (!v || !t) return false;
  if (t.is_bot === FED || v.is_bot === FED) return !!q.contact.get(viewerId, targetId);
  if (v.is_admin) return true;
  if (v.workspace_id === t.workspace_id) return true;
  return !!q.contact.get(viewerId, targetId);
}

// Кто видит человека target (кроме него самого): одно пространство, добавившие в контакты, администраторы.
// Именно им рассылаем присутствие.
function viewersOf(targetId) {
  const t = q.user.get(targetId);
  if (!t) return [];
  const ids = new Set();
  db.prepare('SELECT id FROM users WHERE workspace_id = ? OR is_admin = 1').all(t.workspace_id).forEach(r => ids.add(r.id));
  db.prepare('SELECT owner_id FROM contacts WHERE contact_id = ?').all(targetId).forEach(r => ids.add(r.owner_id));
  ids.delete(targetId);
  return [...ids];
}

// Кто знает человека target: видящие его плюс все, с кем у него общий чат. Им рассылаем смену имени и тега.
function knownByOf(targetId) {
  const ids = new Set(viewersOf(targetId));
  db.prepare(`SELECT DISTINCT cm2.user_id AS id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id WHERE cm1.user_id = ?`).all(targetId).forEach(r => ids.add(r.id));
  ids.delete(targetId);
  return [...ids];
}

// Заблокировал ли blocker человека blocked
function isBlocked(blockerId, blockedId) {
  return !!db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}

// Список людей для viewer: видимые и те, кого он знает по совместным чатам.
//   rel: 'ws' — то же пространство, 'other' — видимый из другого (контакт или администратору всё видно),
//        'chat' — только по совместному чату (в списки выбора не попадает).
//   contact — добавлен вручную (такого можно удалить из контактов).
function listFor(viewerId) {
  const me = q.user.get(viewerId);
  if (!me) return [];
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.tag, u.workspace_id, w.name AS workspace_name, u.is_bot
    FROM users u LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id != ? AND COALESCE(u.is_bot, 0) IN (0, ${FED}) ORDER BY u.display_name`).all(viewerId);
  const contacts = new Set(db.prepare('SELECT contact_id FROM contacts WHERE owner_id = ?').all(viewerId).map(r => r.contact_id));
  const co = new Set(db.prepare(`SELECT DISTINCT cm2.user_id AS id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id WHERE cm1.user_id = ?`).all(viewerId).map(r => r.id));
  const out = [];
  for (const u of rows) {
    const fed = u.is_bot === FED, isContact = contacts.has(u.id);
    const same = !fed && u.workspace_id === me.workspace_id;
    let rel = null;
    if (same) rel = 'ws';
    else if ((!fed && me.is_admin) || isContact) rel = 'other';
    else if (co.has(u.id)) rel = 'chat';
    if (!rel) continue;
    const { is_bot, ...rest } = u;
    // У человека с другого сервера нет пространства: клиент показывает вместо него значок «другой сервер»
    out.push(fed ? { ...rest, workspace_id: 0, workspace_name: null, rel, contact: isContact, federated: true } : { ...rest, rel, contact: isContact });
  }
  return out;
}

// Видимые viewer (то есть без «только по чату») — для присутствия
function visibleIds(viewerId) {
  return listFor(viewerId).filter(u => u.rel !== 'chat').map(u => u.id);
}

// ── Присутствие («в сети», «печатает…») ──
// Строже, чем видимость в списках: своё пространство видит всех, администратор видит всех на своём сервере,
// а человека из другого пространства — только если контакты добавлены с обеих сторон. Односторонне
// добавленный присутствия не видит: вместо него клиент показывает заглушку «был давно».
function mutualContact(a, b) { return !!(q.contact.get(a, b) && q.contact.get(b, a)); }
function canSeePresence(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const v = q.user.get(viewerId), t = q.user.get(targetId);
  if (!v || !t) return false;
  if (v.is_bot === FED || t.is_bot === FED) return mutualContact(viewerId, targetId);
  return !!v.is_admin || v.workspace_id === t.workspace_id || mutualContact(viewerId, targetId);
}
// Кому разослать присутствие человека target
function presenceViewers(targetId) {
  const t = q.user.get(targetId);
  if (!t) return [];
  const ids = new Set();
  // Человек с другого сервера: статус видят только те, кто с ним в контактах друг у друга
  if (t.is_bot !== FED) db.prepare('SELECT id FROM users WHERE workspace_id = ? OR is_admin = 1').all(t.workspace_id).forEach(r => ids.add(r.id));
  db.prepare('SELECT c1.owner_id AS id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id WHERE c1.contact_id = ?')
    .all(targetId).forEach(r => ids.add(r.id));
  ids.delete(targetId);
  return [...ids];
}
// Чьё присутствие видит viewer
function presenceIds(viewerId) {
  const v = q.user.get(viewerId);
  if (!v) return [];
  const ids = new Set(v.is_admin
    ? db.prepare(`SELECT id FROM users WHERE id != ? AND COALESCE(is_bot, 0) != ${FED}`).all(viewerId).map(r => r.id)
    : db.prepare('SELECT id FROM users WHERE workspace_id = ? AND id != ? AND COALESCE(is_bot, 0) != ?').all(v.workspace_id, viewerId, FED).map(r => r.id));
  db.prepare('SELECT c1.contact_id AS id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id WHERE c1.owner_id = ?')
    .all(viewerId).forEach(r => ids.add(r.id));
  return [...ids];
}

// Смена пространства: ручные контакты, которые теперь в одном пространстве с владельцем, удаляются
// (и у самого человека, и у тех, кто добавил его, а он теперь «свой»).
function afterMove(userId, newWs) {
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_id IN (SELECT id FROM users WHERE workspace_id = ?)').run(userId, newWs);
  db.prepare('DELETE FROM contacts WHERE contact_id = ? AND owner_id IN (SELECT id FROM users WHERE workspace_id = ?)').run(userId, newWs);
}

// ── Новые переписки между пространствами ──
// Фундаментальное ограничение, не настройка: если люди из разных пространств, а получатель не добавил отправителя
// в контакты, отправитель может написать только DM_LIMIT сообщений подряд без ответа. Ответ получателя (любое его
// сообщение в личном чате) или добавление в контакты снимает ограничение. Администратор как отправитель
// ограничению не подчиняется. Считает сервер получателя; клиент лишь показывает остаток.
const DM_LIMIT = 2;
function limitApplies(senderId, recipientId) {
  const s = q.user.get(senderId), r = q.user.get(recipientId);
  // Администратор не ограничен у себя на сервере, но для человека с другого сервера он обычный собеседник
  if (!s || !r || (s.is_admin && r.is_bot !== FED)) return false;
  if (s.workspace_id === r.workspace_id) return false;
  return !q.contact.get(recipientId, senderId);
}
const limitUsed = (senderId, recipientId) => db.prepare('SELECT n FROM dm_limits WHERE sender_id = ? AND recipient_id = ?').get(senderId, recipientId)?.n || 0;
// Состояние для клиента отправителя: null — ограничения нет, иначе { used, max }
function limitFor(senderId, recipientId) {
  return limitApplies(senderId, recipientId) ? { used: limitUsed(senderId, recipientId), max: DM_LIMIT } : null;
}
function limitBump(senderId, recipientId) {
  db.prepare('INSERT INTO dm_limits (sender_id, recipient_id, n) VALUES (?, ?, 1) ON CONFLICT(sender_id, recipient_id) DO UPDATE SET n = n + 1').run(senderId, recipientId);
}
function limitReset(senderId, recipientId) {
  db.prepare('DELETE FROM dm_limits WHERE sender_id = ? AND recipient_id = ?').run(senderId, recipientId);
}
// Личные чаты (обычные и секретные) двух людей
const directChatIds = (a, b) => db.prepare(`SELECT c.id FROM chats c
  JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
  JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
  WHERE c.type = 'direct'`).all(a, b).map(r => r.id);

module.exports = { FED, isFed, mutualContact, canSeePresence, presenceViewers, presenceIds, DM_LIMIT, limitApplies, limitUsed, limitFor, limitBump, limitReset, directChatIds, DEFAULT_WS, wsOf, isAdminUser, canSee, viewersOf, knownByOf, isBlocked, listFor, visibleIds, afterMove };
