// ── ОБЪЯВЛЕНИЯ ──
// Три вида в одном журнале:
//   popup  — модальное окно, видят только те, кто в сети в момент отправки;
//   banner — полоса вверху окна, живёт заданное число минут и догоняет тех,
//            кто был офлайн: клиент запрашивает активные при каждом входе;
//   chat   — обычное сообщение от системного пользователя в группы и комнаты.
//
// Отложенная отправка хранится в базе, а не таймером в памяти: перезапуск сервера
// не должен терять запланированное. Раз в 10 секунд проверяем наступившие.

const { filterAsync } = require('./aiter.js');
const dal = require('./dal');
const { broadcast, broadcastAll, sendTo, getMessageWithStatus } = require('./ws');
const spaces = require('./spaces');

const TICK_MS = 10000;

function parseTargets(row) {
  try { return JSON.parse(row.targets || '[]'); } catch { return []; }
}

// Люди выбранных пространств (без служебных и заблокированных)
async function usersOfSpaces(wsIds) {
  if (!wsIds.length) return [];
  return (await dal.all(`SELECT id FROM users WHERE (is_bot IS NULL OR is_bot = 0) AND COALESCE(banned, 0) = 0
    AND id IN (SELECT user_id FROM user_workspaces WHERE workspace_id IN (${wsIds.map(() => '?').join(',')}))`, ...wsIds)).map(r => r.id);
}

// Группы и комнаты выбранных пространств. Администратор: где есть хоть один участник из них.
// Пользователь с правом объявлений (strict): только те, где все люди из выбранных пространств,
// чтобы ему не открывались чужие чаты.
async function chatsOfSpaces(wsIds, strict) {
  if (!wsIds.length) return [];
  const inList = wsIds.map(() => '?').join(',');
  const rows = await dal.all(`SELECT c.id,
      SUM(CASE WHEN u.id IN (SELECT user_id FROM user_workspaces WHERE workspace_id IN (${inList})) THEN 1 ELSE 0 END) AS inside, COUNT(*) AS total
    FROM chats c JOIN chat_members cm ON cm.chat_id = c.id JOIN users u ON u.id = cm.user_id
    WHERE c.type IN ('group', 'room') AND COALESCE(c.is_secret, 0) = 0 AND COALESCE(u.is_bot, 0) = 0
    GROUP BY c.id`, ...wsIds);
  return rows.filter(r => strict ? r.inside === r.total : r.inside > 0).map(r => r.id);
}

// Кому адресовано объявление: пустой список = всем.
async function recipientIds(row) {
  if (row.target === 'all') {
    return (await dal.all("SELECT id FROM users WHERE (is_bot IS NULL OR is_bot = 0) AND banned = 0")).map(r => r.id);
  }
  if (row.target === 'spaces') return await usersOfSpaces(parseTargets(row));
  return parseTargets(row);
}

function bannerPayload(row) {
  return { id: row.id, text: row.text, expires_at: row.expires_at, sent_at: row.sent_at };
}

async function systemUserId() {
  const r = await dal.get("SELECT value FROM settings WHERE key = 'system_user_id'");
  return r ? Number(r.value) : null;
}

// Системное сообщение вне объявлений — например, уведомление о составе группы/комнаты.
// Та же механика, что у deliver() для kind:'chat': обычное сообщение от системного
// пользователя, разослано как любое новое сообщение. `kind` (например
// 'member_add'/'member_remove') отличает это от обычного объявления в
// system_kind — клиент рисует их разным оформлением (не как объявление с
// колокольчиком).
async function sendSystemMessage(chatId, text, kind = null) {
  const sysId = await systemUserId();
  if (!sysId) return;
  const r = await dal.run('INSERT INTO messages (chat_id, sender_id, text, system_kind) VALUES (?, ?, ?, ?)', chatId, sysId, text, kind);
  const msg = await getMessageWithStatus(r.lastInsertRowid, null);
  if (msg) await broadcast(chatId, { type: 'message', message: msg });
  // Группа с участниками на других серверах: системное сообщение (вступил, вышел…) уходит и им
  try { await require('./federation').onGroupMessage(r.lastInsertRowid); } catch (e) { console.warn('[Fed] системное сообщение:', e.message); }
}

// Отправка наступившего объявления. Возвращает число адресатов — для ответа админке.
async function deliver(row) {
  const now = Math.floor(Date.now() / 1000);

  if (row.kind === 'chat') {
    const sysId = await systemUserId();
    if (!sysId) return 0;
    // «Всем» — только группы и комнаты. Выбранные вручную могут быть и личными чатами (системное
    // сообщение видят оба участника); секретные чаты исключены: их тексты зашифрованы
    const authorAdmin = row.author_id ? (await spaces.isAdminUser(row.author_id)) : true;
    const chatIds = row.target === 'all'
      ? (await dal.all("SELECT id FROM chats WHERE type IN ('group', 'room')")).map(r => r.id)
      : row.target === 'spaces' ? (await chatsOfSpaces(parseTargets(row), !authorAdmin))
      : (await filterAsync(parseTargets(row), async id => (await dal.get('SELECT 1 FROM chats WHERE id = ? AND COALESCE(is_secret, 0) = 0', id))));
    const insertMsg = 'INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)';
    for (const chatId of chatIds) {
      const r = await dal.run(insertMsg, chatId, sysId, row.text);
      const msg = await getMessageWithStatus(r.lastInsertRowid, null);
      if (msg) await broadcast(chatId, { type: 'message', message: msg });
      try { await require('./federation').onGroupMessage(r.lastInsertRowid); } catch {}   // группы и комнаты с участниками на других серверах
    }
    await dal.run('UPDATE announcements SET sent_at = ? WHERE id = ?', now, row.id);
    return chatIds.length;
  }

  const expires = row.kind === 'banner' ? now + (row.duration_min || 0) * 60 : null;
  await dal.run('UPDATE announcements SET sent_at = ?, expires_at = ? WHERE id = ?', now, expires, row.id);
  const fresh = { ...row, sent_at: now, expires_at: expires };

  const payload = row.kind === 'banner'
    ? { type: 'banner', announcement: bannerPayload(fresh) }
    : { type: 'announcement', text: row.text };

  if (row.target === 'all') {
    broadcastAll(payload);
    return 0; // «всем» — точное число адресатов не считаем
  }
  const ids = await recipientIds(row);
  ids.forEach(uid => sendTo(uid, payload));
  return ids.length;
}

async function create({ kind, text, author_id, start_at, duration_min, target, targets }) {
  const now = Math.floor(Date.now() / 1000);
  const startAt = start_at && start_at > now ? Math.floor(start_at) : now;
  const r = await dal.run(`INSERT INTO announcements (kind, text, author_id, start_at, duration_min, target, targets)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`, kind, text, author_id || null, startAt, kind === 'banner' ? (duration_min || 0) : null,
         target, JSON.stringify(targets || []));

  const row = await dal.get('SELECT * FROM announcements WHERE id = ?', r.lastInsertRowid);
  const count = startAt <= now ? (await deliver(row)) : 0;
  return { id: row.id, scheduled: startAt > now, count };
}

// Наступившее — отправить. Ошибка на одном объявлении не должна ронять цикл.
let delivering = false;   // долгая рассылка не должна перекрываться следующим тиком: иначе то же объявление уйдёт дважды
async function deliverDue() {
  if (delivering) return;
  delivering = true;
  try { await deliverDueNow(); } finally { delivering = false; }
}
async function deliverDueNow() {
  const now = Math.floor(Date.now() / 1000);
  const due = await dal.all('SELECT * FROM announcements WHERE sent_at IS NULL AND start_at <= ?', now);
  for (const row of due) {
    try { await deliver(row); } catch (e) { console.warn('[announcements] не отправлено', row.id, e.message); }
  }
}

let timer = null;
async function startScheduler() {
  if (timer) return;
  await deliverDue();
  timer = setInterval(deliverDue, TICK_MS);
  timer.unref?.();
}

// Активные полосы для пользователя: отправленные, ещё не истёкшие, адресованные
// ему и не закрытые им. Клиент запрашивает это при входе и при переподключении.
async function activeBannersFor(userId) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await dal.all(`
    SELECT a.* FROM announcements a
    WHERE a.kind = 'banner' AND a.sent_at IS NOT NULL AND a.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM announcement_dismissed d WHERE d.announcement_id = a.id AND d.user_id = ?)
    ORDER BY a.sent_at`, now, userId);
  return (await filterAsync(rows
    , async r => r.target === 'all' || (r.target === 'spaces' ? (await spaces.wsIdsOf(userId)).some(id => parseTargets(r).includes(id)) : parseTargets(r).includes(userId))))
    .map(bannerPayload);
}

async function dismiss(id, userId) {
  await dal.run('INSERT OR IGNORE INTO announcement_dismissed (announcement_id, user_id) VALUES (?, ?)', id, userId);
}

// Журнал для админки. Имена адресатов разворачиваем здесь, чтобы админка не
// делала отдельных запросов на каждую строку.
async function journal() {
  const rows = await dal.all(`
    SELECT a.*, u.display_name AS author_name, u.username AS author_username,
           (SELECT COUNT(*) FROM announcement_dismissed d WHERE d.announcement_id = a.id) AS dismissed_count
    FROM announcements a LEFT JOIN users u ON u.id = a.author_id
    ORDER BY COALESCE(a.sent_at, a.start_at) DESC, a.id DESC`);

  const userName = 'SELECT display_name FROM users WHERE id = ?';
  const chatName = 'SELECT name FROM chats WHERE id = ?';
  const wsName = 'SELECT name FROM workspaces WHERE id = ?';
  const chatPair = `SELECT GROUP_CONCAT(u.display_name, ' → ') AS name FROM chat_members cm
    JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`;

  return (await Promise.all(rows.map(async r => {
    const ids = parseTargets(r);
    const names = r.target === 'all' ? [] : r.target === 'spaces' ? (await Promise.all(ids.map(async id => (await dal.get(wsName, id))?.name || '—'))) : (await Promise.all(ids.map(async id => {
      const row = r.kind === 'chat' ? (await dal.get(chatName, id)) : (await dal.get(userName, id));
      // у личного чата названия нет — берём имена участников
      if (r.kind === 'chat' && row && !row.name) return (await dal.get(chatPair, id))?.name || '—';
      return row ? (row.display_name || row.name) : '—';
    })));
    return { ...r, targets: ids, target_names: names };
  })));
}

// Удаление: запланированное просто не уйдёт, активная полоса снимается у всех.
async function remove(id) {
  const row = await dal.get('SELECT * FROM announcements WHERE id = ?', id);
  if (!row) return false;
  const now = Math.floor(Date.now() / 1000);
  if (row.kind === 'banner' && row.sent_at && row.expires_at > now) {
    broadcastAll({ type: 'banner_removed', id: row.id });
  }
  await dal.run('DELETE FROM announcement_dismissed WHERE announcement_id = ?', id);
  await dal.run('DELETE FROM announcements WHERE id = ?', id);
  return true;
}

// Досрочно снять полосу: у всех она исчезает сразу, а запись остаётся в журнале как завершённая
async function stop(id) {
  const row = await dal.get('SELECT * FROM announcements WHERE id = ?', id);
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.kind !== 'banner' || !row.sent_at || row.expires_at <= now) return false;
  await dal.run('UPDATE announcements SET expires_at = ? WHERE id = ?', now, id);
  broadcastAll({ type: 'banner_removed', id: row.id });
  return true;
}

// Разбор и проверка запроса на отправку: один на админку и на клиент, чтобы правила не разошлись.
// Возвращает { error } или параметры для create().
async function parseRequest(body, authorId) {
  const { kind, text, target, targets, start_at, duration_min } = body || {};
  if (!String(text || '').trim()) return { error: 'Нет текста' };
  if (!['popup', 'banner', 'chat'].includes(kind)) return { error: 'Неизвестный тип' };
  let list = (targets || []).map(Number).filter(Boolean);
  let tgt = target === 'select' ? 'select' : target === 'spaces' ? 'spaces' : 'all';
  // Пользователь с правом объявлений работает только внутри своего пространства; администратор — где угодно
  const author = authorId ? (await dal.get('SELECT is_admin, workspace_id FROM users WHERE id = ?', authorId)) : null;
  if (author && !author.is_admin) {
    // Все пространства автора: человек может состоять в нескольких
    const own = await spaces.wsIdsOf(authorId);
    if (tgt === 'all' || tgt === 'spaces') { tgt = 'spaces'; list = own; }
    else if (kind === 'chat') {
      const okChats = new Set((await chatsOfSpaces(own, true)));
      list = list.filter(id => okChats.has(id));
    } else list = (await filterAsync(list, async id => (await spaces.wsIdsOf(id)).some(w => own.includes(w))));
  } else if (tgt === 'spaces') {
    list = (await filterAsync(list, async id => (await dal.get('SELECT 1 FROM workspaces WHERE id = ?', id))));
    if (!list.length) return { error: 'Выберите пространства' };
  }
  if (tgt === 'select' && list.length === 0) return { error: kind === 'chat' ? 'Выберите чаты' : 'Выберите получателей' };
  if (kind === 'banner' && !(duration_min > 0)) return { error: 'Укажите время отображения' };
  if (kind === 'chat' && !(await systemUserId())) return { error: 'Системный пользователь не найден', status: 500 };
  return { kind, text: String(text).trim(), author_id: authorId, start_at: Number(start_at) || 0, duration_min: Number(duration_min) || 0, target: tgt, targets: list };
}

module.exports = { chatsOfSpaces, usersOfSpaces, parseRequest, create, journal, remove, stop, activeBannersFor, dismiss, startScheduler, sendSystemMessage };
