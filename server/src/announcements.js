// ── ОБЪЯВЛЕНИЯ ──
// Три вида в одном журнале:
//   popup  — модальное окно, видят только те, кто в сети в момент отправки;
//   banner — полоса вверху окна, живёт заданное число минут и догоняет тех,
//            кто был офлайн: клиент запрашивает активные при каждом входе;
//   chat   — обычное сообщение от системного пользователя в группы и комнаты.
//
// Отложенная отправка хранится в базе, а не таймером в памяти: перезапуск сервера
// не должен терять запланированное. Раз в 10 секунд проверяем наступившие.

const db = require('./db');
const { broadcast, broadcastAll, sendTo, getMessageWithStatus } = require('./ws');
const spaces = require('./spaces');

const TICK_MS = 10000;

function parseTargets(row) {
  try { return JSON.parse(row.targets || '[]'); } catch { return []; }
}

// Люди выбранных пространств (без служебных и заблокированных)
function usersOfSpaces(wsIds) {
  if (!wsIds.length) return [];
  return db.prepare(`SELECT id FROM users WHERE (is_bot IS NULL OR is_bot = 0) AND COALESCE(banned, 0) = 0
    AND id IN (SELECT user_id FROM user_workspaces WHERE workspace_id IN (${wsIds.map(() => '?').join(',')}))`).all(...wsIds).map(r => r.id);
}

// Группы и комнаты выбранных пространств. Администратор: где есть хоть один участник из них.
// Пользователь с правом объявлений (strict): только те, где все люди из выбранных пространств,
// чтобы ему не открывались чужие чаты.
function chatsOfSpaces(wsIds, strict) {
  if (!wsIds.length) return [];
  const inList = wsIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT c.id,
      SUM(CASE WHEN u.id IN (SELECT user_id FROM user_workspaces WHERE workspace_id IN (${inList})) THEN 1 ELSE 0 END) AS inside, COUNT(*) AS total
    FROM chats c JOIN chat_members cm ON cm.chat_id = c.id JOIN users u ON u.id = cm.user_id
    WHERE c.type IN ('group', 'room') AND COALESCE(c.is_secret, 0) = 0 AND COALESCE(u.is_bot, 0) = 0
    GROUP BY c.id`).all(...wsIds);
  return rows.filter(r => strict ? r.inside === r.total : r.inside > 0).map(r => r.id);
}

// Кому адресовано объявление: пустой список = всем.
function recipientIds(row) {
  if (row.target === 'all') {
    return db.prepare("SELECT id FROM users WHERE (is_bot IS NULL OR is_bot = 0) AND banned = 0").all().map(r => r.id);
  }
  if (row.target === 'spaces') return usersOfSpaces(parseTargets(row));
  return parseTargets(row);
}

function bannerPayload(row) {
  return { id: row.id, text: row.text, expires_at: row.expires_at, sent_at: row.sent_at };
}

function systemUserId() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'system_user_id'").get();
  return r ? Number(r.value) : null;
}

// Системное сообщение вне объявлений — например, уведомление о составе группы/комнаты.
// Та же механика, что у deliver() для kind:'chat': обычное сообщение от системного
// пользователя, разослано как любое новое сообщение. `kind` (например
// 'member_add'/'member_remove') отличает это от обычного объявления в
// system_kind — клиент рисует их разным оформлением (не как объявление с
// колокольчиком).
function sendSystemMessage(chatId, text, kind = null) {
  const sysId = systemUserId();
  if (!sysId) return;
  const r = db.prepare('INSERT INTO messages (chat_id, sender_id, text, system_kind) VALUES (?, ?, ?, ?)').run(chatId, sysId, text, kind);
  const msg = getMessageWithStatus(r.lastInsertRowid, null);
  if (msg) broadcast(chatId, { type: 'message', message: msg });
  // Группа с участниками на других серверах: системное сообщение (вступил, вышел…) уходит и им
  try { require('./federation').onGroupMessage(r.lastInsertRowid); } catch (e) { console.warn('[Fed] системное сообщение:', e.message); }
}

// Отправка наступившего объявления. Возвращает число адресатов — для ответа админке.
function deliver(row) {
  const now = Math.floor(Date.now() / 1000);

  if (row.kind === 'chat') {
    const sysId = systemUserId();
    if (!sysId) return 0;
    // «Всем» — только группы и комнаты. Выбранные вручную могут быть и личными чатами (системное
    // сообщение видят оба участника); секретные чаты исключены: их тексты зашифрованы
    const authorAdmin = row.author_id ? spaces.isAdminUser(row.author_id) : true;
    const chatIds = row.target === 'all'
      ? db.prepare("SELECT id FROM chats WHERE type IN ('group', 'room')").all().map(r => r.id)
      : row.target === 'spaces' ? chatsOfSpaces(parseTargets(row), !authorAdmin)
      : parseTargets(row).filter(id => db.prepare('SELECT 1 FROM chats WHERE id = ? AND COALESCE(is_secret, 0) = 0').get(id));
    const insertMsg = db.prepare('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)');
    for (const chatId of chatIds) {
      const r = insertMsg.run(chatId, sysId, row.text);
      const msg = getMessageWithStatus(r.lastInsertRowid, null);
      if (msg) broadcast(chatId, { type: 'message', message: msg });
    }
    db.prepare('UPDATE announcements SET sent_at = ? WHERE id = ?').run(now, row.id);
    return chatIds.length;
  }

  const expires = row.kind === 'banner' ? now + (row.duration_min || 0) * 60 : null;
  db.prepare('UPDATE announcements SET sent_at = ?, expires_at = ? WHERE id = ?').run(now, expires, row.id);
  const fresh = { ...row, sent_at: now, expires_at: expires };

  const payload = row.kind === 'banner'
    ? { type: 'banner', announcement: bannerPayload(fresh) }
    : { type: 'announcement', text: row.text };

  if (row.target === 'all') {
    broadcastAll(payload);
    return 0; // «всем» — точное число адресатов не считаем
  }
  const ids = recipientIds(row);
  ids.forEach(uid => sendTo(uid, payload));
  return ids.length;
}

function create({ kind, text, author_id, start_at, duration_min, target, targets }) {
  const now = Math.floor(Date.now() / 1000);
  const startAt = start_at && start_at > now ? Math.floor(start_at) : now;
  const r = db.prepare(`INSERT INTO announcements (kind, text, author_id, start_at, duration_min, target, targets)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, text, author_id || null, startAt, kind === 'banner' ? (duration_min || 0) : null,
         target, JSON.stringify(targets || []));

  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(r.lastInsertRowid);
  const count = startAt <= now ? deliver(row) : 0;
  return { id: row.id, scheduled: startAt > now, count };
}

// Наступившее — отправить. Ошибка на одном объявлении не должна ронять цикл.
function deliverDue() {
  const now = Math.floor(Date.now() / 1000);
  const due = db.prepare('SELECT * FROM announcements WHERE sent_at IS NULL AND start_at <= ?').all(now);
  for (const row of due) {
    try { deliver(row); } catch (e) { console.warn('[announcements] не отправлено', row.id, e.message); }
  }
}

let timer = null;
function startScheduler() {
  if (timer) return;
  deliverDue();
  timer = setInterval(deliverDue, TICK_MS);
  timer.unref?.();
}

// Активные полосы для пользователя: отправленные, ещё не истёкшие, адресованные
// ему и не закрытые им. Клиент запрашивает это при входе и при переподключении.
function activeBannersFor(userId) {
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(`
    SELECT a.* FROM announcements a
    WHERE a.kind = 'banner' AND a.sent_at IS NOT NULL AND a.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM announcement_dismissed d WHERE d.announcement_id = a.id AND d.user_id = ?)
    ORDER BY a.sent_at`).all(now, userId);
  return rows
    .filter(r => r.target === 'all' || (r.target === 'spaces' ? spaces.wsIdsOf(userId).some(id => parseTargets(r).includes(id)) : parseTargets(r).includes(userId)))
    .map(bannerPayload);
}

function dismiss(id, userId) {
  db.prepare('INSERT OR IGNORE INTO announcement_dismissed (announcement_id, user_id) VALUES (?, ?)').run(id, userId);
}

// Журнал для админки. Имена адресатов разворачиваем здесь, чтобы админка не
// делала отдельных запросов на каждую строку.
function journal() {
  const rows = db.prepare(`
    SELECT a.*, u.display_name AS author_name, u.username AS author_username,
           (SELECT COUNT(*) FROM announcement_dismissed d WHERE d.announcement_id = a.id) AS dismissed_count
    FROM announcements a LEFT JOIN users u ON u.id = a.author_id
    ORDER BY COALESCE(a.sent_at, a.start_at) DESC, a.id DESC`).all();

  const userName = db.prepare('SELECT display_name FROM users WHERE id = ?');
  const chatName = db.prepare('SELECT name FROM chats WHERE id = ?');
  const wsName = db.prepare('SELECT name FROM workspaces WHERE id = ?');
  const chatPair = db.prepare(`SELECT GROUP_CONCAT(u.display_name, ' → ') AS name FROM chat_members cm
    JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`);

  return rows.map(r => {
    const ids = parseTargets(r);
    const names = r.target === 'all' ? [] : r.target === 'spaces' ? ids.map(id => wsName.get(id)?.name || '—') : ids.map(id => {
      const row = r.kind === 'chat' ? chatName.get(id) : userName.get(id);
      // у личного чата названия нет — берём имена участников
      if (r.kind === 'chat' && row && !row.name) return chatPair.get(id)?.name || '—';
      return row ? (row.display_name || row.name) : '—';
    });
    return { ...r, targets: ids, target_names: names };
  });
}

// Удаление: запланированное просто не уйдёт, активная полоса снимается у всех.
function remove(id) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!row) return false;
  const now = Math.floor(Date.now() / 1000);
  if (row.kind === 'banner' && row.sent_at && row.expires_at > now) {
    broadcastAll({ type: 'banner_removed', id: row.id });
  }
  db.prepare('DELETE FROM announcement_dismissed WHERE announcement_id = ?').run(id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  return true;
}

// Досрочно снять полосу: у всех она исчезает сразу, а запись остаётся в журнале как завершённая
function stop(id) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.kind !== 'banner' || !row.sent_at || row.expires_at <= now) return false;
  db.prepare('UPDATE announcements SET expires_at = ? WHERE id = ?').run(now, id);
  broadcastAll({ type: 'banner_removed', id: row.id });
  return true;
}

// Разбор и проверка запроса на отправку: один на админку и на клиент, чтобы правила не разошлись.
// Возвращает { error } или параметры для create().
function parseRequest(body, authorId) {
  const { kind, text, target, targets, start_at, duration_min } = body || {};
  if (!String(text || '').trim()) return { error: 'Нет текста' };
  if (!['popup', 'banner', 'chat'].includes(kind)) return { error: 'Неизвестный тип' };
  let list = (targets || []).map(Number).filter(Boolean);
  let tgt = target === 'select' ? 'select' : target === 'spaces' ? 'spaces' : 'all';
  // Пользователь с правом объявлений работает только внутри своего пространства; администратор — где угодно
  const author = authorId ? db.prepare('SELECT is_admin, workspace_id FROM users WHERE id = ?').get(authorId) : null;
  if (author && !author.is_admin) {
    // Все пространства автора: человек может состоять в нескольких
    const own = spaces.wsIdsOf(authorId);
    if (tgt === 'all' || tgt === 'spaces') { tgt = 'spaces'; list = own; }
    else if (kind === 'chat') {
      const okChats = new Set(chatsOfSpaces(own, true));
      list = list.filter(id => okChats.has(id));
    } else list = list.filter(id => spaces.wsIdsOf(id).some(w => own.includes(w)));
  } else if (tgt === 'spaces') {
    list = list.filter(id => db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(id));
    if (!list.length) return { error: 'Выберите пространства' };
  }
  if (tgt === 'select' && list.length === 0) return { error: kind === 'chat' ? 'Выберите чаты' : 'Выберите получателей' };
  if (kind === 'banner' && !(duration_min > 0)) return { error: 'Укажите время отображения' };
  if (kind === 'chat' && !systemUserId()) return { error: 'Системный пользователь не найден', status: 500 };
  return { kind, text: String(text).trim(), author_id: authorId, start_at: Number(start_at) || 0, duration_min: Number(duration_min) || 0, target: tgt, targets: list };
}

module.exports = { chatsOfSpaces, usersOfSpaces, parseRequest, create, journal, remove, stop, activeBannersFor, dismiss, startScheduler, sendSystemMessage };
