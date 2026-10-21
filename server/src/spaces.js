// Рабочие пространства: кто кого видит. Единое место для правила видимости — им пользуются
// списки людей, присутствие, создание чатов и групп, объявления и рассылка событий.
//
// Правило: человек B виден человеку A, если у них есть общее пространство (человек может состоять в нескольких)
// или B добавлен в контакты A (контакты односторонние: A видит B, а B не видит A). Администратор видит всех. Совместные чаты
// и группы видимость не меняют: участники друг друга там видят, но в списках и поиске чужих нет.
//
// Человек с другого сервера (федерация) хранится как «теневой» пользователь, is_bot = 2. Он виден тому, кто добавил его
// в контакты (администратор тоже), и тем, с кем у него общее пространство: пространство может быть общим для нескольких
// серверов (workspaces.fed_uid), тогда люди остальных серверов состоят в его зеркале у нас (user_workspaces).
const dal = require('./dal');

const DEFAULT_WS = 1;

const q = {
  user: 'SELECT id, workspace_id, is_admin, is_bot FROM users WHERE id = ?',
  contact: 'SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?',
};

// Основное пространство человека (users.workspace_id): его читают старые клиенты и места, где нужно одно значение
async function wsOf(userId) { return (await dal.get(q.user, userId))?.workspace_id || DEFAULT_WS; }
// Все пространства человека. Нет строк (служебный пользователь, старая запись) — берём основное
const qWs = 'SELECT workspace_id FROM user_workspaces WHERE user_id = ? ORDER BY workspace_id';
async function wsIdsOf(userId) {
  const ids = (await dal.all(qWs, userId)).map(r => r.workspace_id);
  if (ids.length) return ids;
  // У человека с другого сервера пространств нет, пока он не состоит в общем: подставлять «основное» нельзя, иначе он «делит» его со всеми
  return (await dal.get(q.user, userId))?.is_bot === FED ? [] : [(await wsOf(userId))];
}
// Общие пространства двух людей (номера)
async function sharedIds(a, b) {
  const bs = new Set((await wsIdsOf(b)));
  return (await wsIdsOf(a)).filter(id => bs.has(id));
}
const shares = async (a, b) => (await sharedIds(a, b)).length > 0;
// Задать пространства человеку (список номеров, хотя бы одно). Основным становится наименьший номер.
async function setWorkspaces(userId, ids) {
  const list = [...new Set(ids.map(Number))].filter(Boolean).sort((x, y) => x - y);
  const prev = await wsIdsOf(userId);
  await dal.tx(() => (async () => {
    await dal.run('DELETE FROM user_workspaces WHERE user_id = ?', userId);
    const ins = 'INSERT INTO user_workspaces (user_id, workspace_id) VALUES (?, ?)';
    for (const id of list) (await dal.run(ins, userId, id)) ;
    await dal.run('UPDATE users SET workspace_id = ? WHERE id = ?', list[0], userId);
  })());
  // Если в этих пространствах состоят люди других серверов, они должны узнать об изменении состава
  try { await require('./fedspaces').membersChanged([...new Set([...prev, ...list])]); } catch {}
  return list;
}
// Человек с другого сервера
const FED = 2;
async function isFed(userId) { return (await dal.get(q.user, userId))?.is_bot === FED; }
async function isAdminUser(userId) { return !!(await dal.get(q.user, userId))?.is_admin; }

// Видит ли viewer человека target в списках и поиске
async function canSee(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const v = await dal.get(q.user, viewerId), t = await dal.get(q.user, targetId);
  if (!v || !t) return false;
  if (t.is_bot === FED || v.is_bot === FED) return !!(await dal.get(q.contact, viewerId, targetId)) || (await shares(viewerId, targetId));
  if (v.is_admin) return true;
  if ((await shares(viewerId, targetId))) return true;
  return !!(await dal.get(q.contact, viewerId, targetId));
}

// Люди (номера) любого из перечисленных пространств
async function usersInSpaces(wsIds) {
  if (!wsIds.length) return [];
  return (await dal.all(`SELECT DISTINCT user_id AS id FROM user_workspaces WHERE workspace_id IN (${wsIds.map(() => '?').join(',')})`, ...wsIds)).map(r => r.id);
}

// Кто видит человека target (кроме него самого): одно пространство, добавившие в контакты, администраторы.
// Именно им рассылаем присутствие.
async function viewersOf(targetId) {
  const t = await dal.get(q.user, targetId);
  if (!t) return [];
  const ids = new Set();
  (await usersInSpaces((await wsIdsOf(targetId)))).forEach(id => ids.add(id));
  (await dal.all('SELECT id FROM users WHERE is_admin = 1')).forEach(r => ids.add(r.id));
  (await dal.all('SELECT owner_id FROM contacts WHERE contact_id = ?', targetId)).forEach(r => ids.add(r.owner_id));
  ids.delete(targetId);
  return [...ids];
}

// Кто знает человека target: видящие его плюс все, с кем у него общий чат. Им рассылаем смену имени и тега.
async function knownByOf(targetId) {
  const ids = new Set((await viewersOf(targetId)));
  (await dal.all(`SELECT DISTINCT cm2.user_id AS id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id WHERE cm1.user_id = ?`, targetId)).forEach(r => ids.add(r.id));
  ids.delete(targetId);
  return [...ids];
}

// Заблокировал ли blocker человека blocked
async function isBlocked(blockerId, blockedId) {
  return !!(await dal.get('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', blockerId, blockedId));
}

// Список людей для viewer: видимые и те, кого он знает по совместным чатам.
//   rel: 'ws' — то же пространство, 'other' — видимый из другого (контакт или администратору всё видно),
//        'chat' — только по совместному чату (в списки выбора не попадает).
//   contact — добавлен вручную (такого можно удалить из контактов).
async function listFor(viewerId) {
  const me = await dal.get(q.user, viewerId);
  if (!me) return [];
  const rows = await dal.all(`SELECT u.id, u.username, u.display_name, u.tag, u.workspace_id, w.name AS workspace_name, u.is_bot, u.fed_login, u.fed_instance
    FROM users u LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id != ? AND COALESCE(u.is_bot, 0) IN (0, ${FED}) ORDER BY u.display_name`, viewerId);
  const contacts = new Set((await dal.all('SELECT contact_id FROM contacts WHERE owner_id = ?', viewerId)).map(r => r.contact_id));
  const co = new Set((await dal.all(`SELECT DISTINCT cm2.user_id AS id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id WHERE cm1.user_id = ?`, viewerId)).map(r => r.id));
  // Членства всех людей и названия пространств одним проходом
  const wsName = new Map((await dal.all('SELECT id, name FROM workspaces')).map(w => [w.id, w.name]));
  const memb = new Map();
  (await dal.all('SELECT user_id, workspace_id FROM user_workspaces ORDER BY workspace_id')).forEach(r => {
    if (!memb.has(r.user_id)) memb.set(r.user_id, []);
    memb.get(r.user_id).push(r.workspace_id);
  });
  const mine = new Set(memb.get(viewerId) || [me.workspace_id]);
  const out = [];
  for (const u of rows) {
    const fed = u.is_bot === FED, isContact = contacts.has(u.id);
    // У человека с другого сервера есть только членства в зеркалах общих пространств
    const common = (memb.get(u.id) || [u.workspace_id]).filter(id => mine.has(id));
    const same = common.length > 0;
    let rel = null;
    if (same) rel = 'ws';
    else if ((!fed && me.is_admin) || isContact) rel = 'other';
    else if (co.has(u.id)) rel = 'chat';
    if (!rel) continue;
    const { is_bot, fed_login, fed_instance, ...rest } = u;
    // У человека с другого сервера нет пространства: клиент показывает вместо него значок «другой сервер».
    // login и server_id отдаём отдельно, чтобы клиент не разбирал служебное имя (оно менялось: «сервер@логин» → «сервер:логин»)
    // shared_workspaces — только общие с вами пространства (названия): чужие членства человека не раскрываются
    const shared = common.map(id => wsName.get(id)).filter(Boolean);
    out.push(fed ? { ...rest, workspace_id: 0, workspace_name: null, rel, contact: isContact, federated: true, login: fed_login, server_id: fed_instance, shared_workspaces: shared, ws_ids: common }
      : { ...rest, rel, contact: isContact, shared_workspaces: shared, ws_ids: common });
  }
  return out;
}

// Видимые viewer (то есть без «только по чату») — для присутствия
async function visibleIds(viewerId) {
  return (await listFor(viewerId)).filter(u => u.rel !== 'chat').map(u => u.id);
}

// ── Присутствие («в сети», «печатает…») ──
// Строже, чем видимость в списках: своё пространство видит всех, администратор видит всех на своём сервере,
// а человека из другого пространства — только если контакты добавлены с обеих сторон. Односторонне
// добавленный присутствия не видит: вместо него клиент показывает заглушку «был давно».
async function mutualContact(a, b) { return !!((await dal.get(q.contact, a, b)) && (await dal.get(q.contact, b, a))); }
async function canSeePresence(viewerId, targetId) {
  if (viewerId === targetId) return true;
  const v = await dal.get(q.user, viewerId), t = await dal.get(q.user, targetId);
  if (!v || !t) return false;
  if (v.is_bot === FED || t.is_bot === FED) return (await mutualContact(viewerId, targetId)) || (await shares(viewerId, targetId));
  return !!v.is_admin || (await shares(viewerId, targetId)) || (await mutualContact(viewerId, targetId));
}
// Кому разослать присутствие человека target
async function presenceViewers(targetId) {
  const t = await dal.get(q.user, targetId);
  if (!t) return [];
  const ids = new Set();
  // Человек с другого сервера: статус видят взаимные контакты и те, у кого с ним общее пространство
  if (t.is_bot !== FED) {
    (await usersInSpaces((await wsIdsOf(targetId)))).forEach(id => ids.add(id));
    (await dal.all('SELECT id FROM users WHERE is_admin = 1')).forEach(r => ids.add(r.id));
  } else {
    for (const id of (await usersInSpaces((await wsIdsOf(targetId))))) { if (!(await isFed(id))) ids.add(id); } ;
  }
  (await dal.all('SELECT c1.owner_id AS id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id WHERE c1.contact_id = ?', targetId)).forEach(r => ids.add(r.id));
  ids.delete(targetId);
  return [...ids];
}
// Чьё присутствие видит viewer
async function presenceIds(viewerId) {
  const v = await dal.get(q.user, viewerId);
  if (!v) return [];
  const ids = new Set(v.is_admin ? (await dal.all(`SELECT id FROM users WHERE id != ? AND COALESCE(is_bot, 0) != ${FED}`, viewerId)).map(r => r.id) : []);
  (await usersInSpaces((await wsIdsOf(viewerId)))).forEach(id => { if (id !== viewerId) ids.add(id); });
  (await dal.all('SELECT c1.contact_id AS id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id WHERE c1.owner_id = ?', viewerId)).forEach(r => ids.add(r.id));
  return [...ids];
}

// Смена пространств человека: ручные контакты, которые теперь в одном пространстве с владельцем, удаляются
// (и у самого человека, и у тех, кто добавил его, а он теперь «свой»).
// Сколько человек должны получить сообщение (для галочек): все участники чата, кроме автора.
// Люди с других серверов тоже считаются: их «доставлено» и «прочитано» приходят по федерации
async function recipientCount(chatId, exceptUserId) {
  return (await dal.get('SELECT COUNT(*) AS c FROM chat_members WHERE chat_id = ? AND user_id IS NOT ?', chatId, exceptUserId ?? null)).c;
}

async function afterMove(userId) {
  const sameSpace = `SELECT user_id FROM user_workspaces WHERE workspace_id IN (SELECT workspace_id FROM user_workspaces WHERE user_id = ?)`;
  await dal.run(`DELETE FROM contacts WHERE owner_id = ? AND contact_id IN (${sameSpace})`, userId, userId);
  await dal.run(`DELETE FROM contacts WHERE contact_id = ? AND owner_id IN (${sameSpace})`, userId, userId);
}

// ── Новые переписки между пространствами ──
// Фундаментальное ограничение, не настройка: если люди из разных пространств, а получатель не добавил отправителя
// в контакты, отправитель может написать только DM_LIMIT сообщений подряд без ответа. Ответ получателя (любое его
// сообщение в личном чате) или добавление в контакты снимает ограничение. Администратор как отправитель
// ограничению не подчиняется. Считает сервер получателя; клиент лишь показывает остаток.
const DM_LIMIT = 2;
async function limitApplies(senderId, recipientId) {
  const s = await dal.get(q.user, senderId), r = await dal.get(q.user, recipientId);
  // Администратор не ограничен у себя на сервере, но для человека с другого сервера он обычный собеседник
  if (!s || !r || (s.is_admin && r.is_bot !== FED)) return false;
  if ((await shares(senderId, recipientId))) return false;
  return !(await dal.get(q.contact, recipientId, senderId));
}
const limitUsed = async (senderId, recipientId) => (await dal.get('SELECT n FROM dm_limits WHERE sender_id = ? AND recipient_id = ?', senderId, recipientId))?.n || 0;
// Состояние для клиента отправителя: null — ограничения нет, иначе { used, max }
async function limitFor(senderId, recipientId) {
  return (await limitApplies(senderId, recipientId)) ? { used: (await limitUsed(senderId, recipientId)), max: DM_LIMIT } : null;
}
async function limitBump(senderId, recipientId) {
  await dal.run('INSERT INTO dm_limits (sender_id, recipient_id, n) VALUES (?, ?, 1) ON CONFLICT(sender_id, recipient_id) DO UPDATE SET n = dm_limits.n + 1', senderId, recipientId);
}
async function limitReset(senderId, recipientId) {
  await dal.run('DELETE FROM dm_limits WHERE sender_id = ? AND recipient_id = ?', senderId, recipientId);
}
// Личные чаты (обычные и секретные) двух людей
const directChatIds = async (a, b) => (await dal.all(`SELECT c.id FROM chats c
  JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
  JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
  WHERE c.type = 'direct'`, a, b)).map(r => r.id);

module.exports = { FED, isFed, recipientCount, mutualContact, canSeePresence, presenceViewers, presenceIds, DM_LIMIT, limitApplies, limitUsed, limitFor, limitBump, limitReset, directChatIds, DEFAULT_WS, wsOf, wsIdsOf, sharedIds, shares, setWorkspaces, usersInSpaces, isAdminUser, canSee, viewersOf, knownByOf, isBlocked, listFor, visibleIds, afterMove };
