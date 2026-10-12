// Рабочие пространства: кто кого видит. Единое место для правила видимости — им пользуются
// списки людей, присутствие, создание чатов и групп, объявления и рассылка событий.
//
// Правило: человек B виден человеку A, если они в одном пространстве или B добавлен в контакты A
// (контакты односторонние: A видит B, а B не видит A). Администратор видит всех. Совместные чаты
// и группы видимость не меняют: участники друг друга там видят, но в списках и поиске чужих нет.
const db = require('./db');

const DEFAULT_WS = 1;

const q = {
  user: db.prepare('SELECT id, workspace_id, is_admin FROM users WHERE id = ?'),
  contact: db.prepare('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?'),
};

function wsOf(userId) { return q.user.get(userId)?.workspace_id || DEFAULT_WS; }
function isAdminUser(userId) { return !!q.user.get(userId)?.is_admin; }

// Видит ли viewer человека target в списках и поиске
function canSee(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const v = q.user.get(viewerId), t = q.user.get(targetId);
  if (!v || !t) return false;
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
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.tag, u.workspace_id, w.name AS workspace_name
    FROM users u JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id != ? AND COALESCE(u.is_bot, 0) = 0 ORDER BY u.display_name`).all(viewerId);
  const contacts = new Set(db.prepare('SELECT contact_id FROM contacts WHERE owner_id = ?').all(viewerId).map(r => r.contact_id));
  const co = new Set(db.prepare(`SELECT DISTINCT cm2.user_id AS id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id WHERE cm1.user_id = ?`).all(viewerId).map(r => r.id));
  const out = [];
  for (const u of rows) {
    const same = u.workspace_id === me.workspace_id, isContact = contacts.has(u.id);
    let rel = null;
    if (same) rel = 'ws';
    else if (me.is_admin || isContact) rel = 'other';
    else if (co.has(u.id)) rel = 'chat';
    if (!rel) continue;
    out.push({ ...u, rel, contact: isContact });
  }
  return out;
}

// Видимые viewer (то есть без «только по чату») — для присутствия
function visibleIds(viewerId) {
  return listFor(viewerId).filter(u => u.rel !== 'chat').map(u => u.id);
}

// Смена пространства: ручные контакты, которые теперь в одном пространстве с владельцем, удаляются
// (и у самого человека, и у тех, кто добавил его, а он теперь «свой»).
function afterMove(userId, newWs) {
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_id IN (SELECT id FROM users WHERE workspace_id = ?)').run(userId, newWs);
  db.prepare('DELETE FROM contacts WHERE contact_id = ? AND owner_id IN (SELECT id FROM users WHERE workspace_id = ?)').run(userId, newWs);
}

module.exports = { DEFAULT_WS, wsOf, isAdminUser, canSee, viewersOf, knownByOf, isBlocked, listFor, visibleIds, afterMove };
