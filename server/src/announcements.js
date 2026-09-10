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

const TICK_MS = 10000;

function parseTargets(row) {
  try { return JSON.parse(row.targets || '[]'); } catch { return []; }
}

// Кому адресовано объявление: пустой список = всем.
function recipientIds(row) {
  if (row.target === 'all') {
    return db.prepare("SELECT id FROM users WHERE (is_bot IS NULL OR is_bot = 0) AND banned = 0").all().map(r => r.id);
  }
  return parseTargets(row);
}

function bannerPayload(row) {
  return { id: row.id, text: row.text, expires_at: row.expires_at, sent_at: row.sent_at };
}

function systemUserId() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'system_user_id'").get();
  return r ? Number(r.value) : null;
}

// Отправка наступившего объявления. Возвращает число адресатов — для ответа админке.
function deliver(row) {
  const now = Math.floor(Date.now() / 1000);

  if (row.kind === 'chat') {
    const sysId = systemUserId();
    if (!sysId) return 0;
    const chatIds = row.target === 'all'
      ? db.prepare("SELECT id FROM chats WHERE type IN ('group', 'room')").all().map(r => r.id)
      : parseTargets(row);
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
  const ids = parseTargets(row);
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
    .filter(r => r.target === 'all' || parseTargets(r).includes(userId))
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

  return rows.map(r => {
    const ids = parseTargets(r);
    const names = r.target === 'all' ? [] : ids.map(id => {
      const row = r.kind === 'chat' ? chatName.get(id) : userName.get(id);
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

module.exports = { create, journal, remove, stop, activeBannersFor, dismiss, startScheduler };
