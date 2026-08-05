const { WebSocketServer } = require('ws');
const db = require('./db');
const { wsAuth } = require('./auth');

// Ленивая загрузка чтобы избежать циклических зависимостей
function pushToUser(userId, payload) {
  try { require('./routes/push').sendPushToUser(userId, payload); } catch (e) {
    console.error('[Push] pushToUser error:', e);
  }
}

// Проверяет, есть ли у пользователя хотя бы одно ОТКРЫТОЕ соединение (readyState===1).
// Нельзя полагаться только на clients.size — зомби-сокеты остаются в Set до срабатывания
// heartbeat (30 сек), не пропуская push-уведомления всё это время.
function hasOpenConnection(userId) {
  const conns = clients.get(userId);
  if (!conns) return false;
  for (const ws of conns) {
    if (ws.readyState === 1) return true;
  }
  return false;
}
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');

function deleteAttachmentFile(attachment) {
  if (!attachment) return;
  try {
    const att = typeof attachment === 'string' ? JSON.parse(attachment) : attachment;
    [att?.url, att?.thumb].forEach(u => {
      if (!u) return;
      const filepath = path.join(FILES_DIR, path.basename(u));
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    });
  } catch {}
}

// userId -> Set<ws>
const clients = new Map();
// userId -> 'online'|'offline'
const userStatus = new Map();

let connCounter = 0;
// connId -> { ws, userId, username, displayName, hostname, clientVersion, osPlatform, osRelease, connectedAt }
const connMeta = new Map();

// connId -> { username, displayName, hostname, clientVersion, pct, status, error, startedAt }
// status: 'pending' | 'downloading' | 'installing' | 'restarting' | 'restarted' | 'error'
const updateProgress = new Map();

function initUpdateProgress(connId) {
  const meta = connMeta.get(connId);
  if (!meta) return;
  updateProgress.set(connId, {
    username: meta.username, displayName: meta.displayName,
    hostname: meta.hostname, clientVersion: meta.clientVersion,
    pct: 0, status: 'pending', error: null, startedAt: Date.now(),
  });
  // Чистим записи старше 30 мин чтобы карта не росла бесконечно
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, entry] of updateProgress) {
    if (entry.startedAt < cutoff) updateProgress.delete(id);
  }
}
function getUpdateProgress() { return Array.from(updateProgress.entries()).map(([connId, e]) => ({ connId, ...e })); }
function clearUpdateProgress(connIds) { connIds.forEach(id => updateProgress.delete(id)); }

function getConn(userId) { return clients.get(userId) || new Set(); }

function broadcast(chatId, payload, excludeUserId = null) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  members.forEach(({ user_id }) => {
    if (user_id === excludeUserId) return;
    getConn(user_id).forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); });
  });
}

function sendTo(userId, payload) {
  getConn(userId).forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); });
}

function insertCallRecord(callerId, calleeId, status, durationSec) {
  try {
    const chat = db.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
      JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct' LIMIT 1
    `).get(callerId, calleeId);
    if (!chat) return;
    const text = JSON.stringify({ initiator_id: callerId, status, duration: durationSec });
    const row = db.prepare(`INSERT INTO messages (chat_id, sender_id, text, msg_type) VALUES (?, ?, ?, 'call')`).run(chat.id, callerId, text);
    const callerRow = db.prepare(`SELECT COALESCE(display_name, username) as name, tag FROM users WHERE id = ?`).get(callerId);
    const sentAt = Math.floor(Date.now() / 1000);
    const msg = {
      id: row.lastInsertRowid, chat_id: chat.id, text, sent_at: sentAt, msg_type: 'call',
      sender_id: callerId, sender_name: callerRow?.name || '', sender_tag: callerRow?.tag || null,
      edited_at: null, deleted: 0, attachment: null, mentions: null,
      reply_to_id: null, reply_text: null, reply_deleted: null, reply_sender_name: null,
      status: { delivered: 0, read: 0, total: 0 }, reactions: [],
    };
    broadcast(chat.id, { type: 'message', message: msg });
  } catch (e) { console.error('[call record]', e.message); }
}

function getStatus(userId) { return userStatus.get(userId) || 'offline'; }
// Есть ли у пользователя хоть одно активное WS-соединение (для админки)
function isConnected(userId) {
  const conns = clients.get(userId);
  if (!conns) return false;
  for (const ws of conns) { if (ws.readyState === 1) return true; }
  return false;
}

// Агрегированный статус: online если хоть одно устройство активно, иначе offline.
function computeStatus(userId) {
  const conns = clients.get(userId);
  if (!conns || !conns.size) return 'offline';
  for (const ws of conns) {
    if (ws.readyState === 1 && ws._status === 'online') return 'online';
  }
  return 'offline';
}

// Пересчитать агрегат и разослать собеседникам ТОЛЬКО при реальном изменении статуса.
function broadcastStatus(userId) {
  const status = computeStatus(userId);
  if (userStatus.get(userId) === status) return; // не изменилось — не шумим
  userStatus.set(userId, status);
  const peers = db.prepare(`
    SELECT DISTINCT cm2.user_id FROM chat_members cm1
    JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id != cm1.user_id
    JOIN chats c ON c.id = cm1.chat_id WHERE cm1.user_id = ? AND c.type = 'direct'
  `).all(userId).map(r => r.user_id);
  let last_seen;
  if (status === 'offline') {
    const row = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(userId);
    last_seen = row?.last_seen_at || Math.floor(Date.now() / 1000);
  }
  const payload = JSON.stringify({ type: 'presence', user_id: userId, status, last_seen });
  peers.forEach(peerId => {
    getConn(peerId).forEach(ws => { if (ws.readyState === 1) ws.send(payload); });
  });
}

// Лимит редактирования сообщений (сек), настраивается в админке. По умолчанию 2 минуты.
function getEditTimeLimit() {
  const v = Number(db.prepare("SELECT value FROM settings WHERE key = 'edit_time_limit'").get()?.value);
  return v > 0 ? v : 120;
}

function callsEnabled() {
  const v = db.prepare("SELECT value FROM settings WHERE key = 'calls_enabled'").get()?.value;
  return v !== '0';
}

// userId -> { peerId, startedAt }
const activeCalls = new Map();

// calleeId -> { callerId, callerName, timer } — вызов отправлен offline-абоненту, ждём реконнекта
const pendingCalls = new Map();

function getMessageWithStatus(msgId, viewerId) {
  const msg = db.prepare(`
    SELECT m.id, m.chat_id, m.text, m.sent_at, m.edited_at, m.deleted, m.attachment, m.mentions,
      u.id as sender_id, COALESCE(u.display_name, 'Удалённый аккаунт') as sender_name, u.tag as sender_tag,
      m.reply_to_id,
      rm.text as reply_text, COALESCE(ru.display_name, 'Удалённый аккаунт') as reply_sender_name
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages rm ON rm.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.sender_id
    WHERE m.id = ?
  `).get(msgId);
  if (!msg) return null;
  if (msg.attachment) try { msg.attachment = JSON.parse(msg.attachment); } catch { msg.attachment = null; }
  if (msg.mentions) try { msg.mentions = JSON.parse(msg.mentions); } catch { msg.mentions = null; }

  // IS NOT вместо != — sender_id может быть NULL (удалённый аккаунт)
  const memberCount = db.prepare('SELECT COUNT(*) as c FROM chat_members WHERE chat_id = ? AND user_id IS NOT ?').get(msg.chat_id, msg.sender_id).c;
  const delivered = db.prepare('SELECT COUNT(*) as c FROM message_status WHERE message_id = ? AND delivered_at IS NOT NULL').get(msgId).c;
  const read = db.prepare('SELECT COUNT(*) as c FROM message_status WHERE message_id = ? AND read_at IS NOT NULL').get(msgId).c;
  // Реакции — чтобы WS-payload совпадал по форме с REST /api/messages
  const reactions = db.prepare('SELECT reaction, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY reaction').all(msgId);

  return { ...msg, reactions, status: { delivered, read, total: memberCount } };
}

function setup(server) {
  // maxPayload: вложения ходят через /api/upload, по WS — только текст и метаданные.
  // Без лимита один клиент может прислать фрейм на сотни МБ (дефолт ws — 100 MiB).
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

  // Серверный heartbeat: отлавливаем «зомби»-сокеты (клиент пропал без TCP-close).
  // Без него пользователь остаётся «онлайн», а push ему не уходит.
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} return; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    let user;
    try { user = wsAuth(url.searchParams.get('token')); } catch { ws.close(1008, 'Unauthorized'); return; }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws._status = 'online'; // уточнится первым set_status от клиента (~через 300мс)

    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);
    broadcastStatus(user.id);

    const connId = ++connCounter;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '—';
    connMeta.set(connId, { ws, userId: user.id, username: user.username, displayName: user.display_name, hostname: '—', clientVersion: '—', osPlatform: '—', osRelease: '—', installScope: null, connectedAt: Date.now(), clientIp });
    ws._connId = connId;

    ws.on('message', raw => {
      let data; try { data = JSON.parse(raw); } catch { return; }

      if (data.type === 'message') {
        // Flood-контроль: скользящее окно 20 сообщений / 10 сек на соединение
        const nowMs = Date.now();
        if (!ws._msgTimes) ws._msgTimes = [];
        ws._msgTimes = ws._msgTimes.filter(t => nowMs - t < 10_000);
        if (ws._msgTimes.length >= 20) return;
        ws._msgTimes.push(nowMs);
        const { chat_id, reply_to_id, attachment } = data;
        // Лимит как в Telegram (4096 символов) — иначе одно гигантское сообщение
        // разойдётся всем участникам и осядет в БД
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 4096) : '';
        if (!chat_id || (!text && !attachment)) return;
        if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat_id, user.id)) return;
        if (reply_to_id) {
          const ref = db.prepare('SELECT chat_id FROM messages WHERE id = ?').get(reply_to_id);
          if (!ref || ref.chat_id !== chat_id) return;
        }

        // Unhide chat for any members who had hidden it (e.g. deleted direct chat)
        const hidden = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND hidden_at IS NOT NULL').all(chat_id);
        if (hidden.length) {
          db.prepare('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND hidden_at IS NOT NULL').run(chat_id);
          hidden.forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
        }

        const attJson = attachment ? JSON.stringify(attachment) : null;

        // Упоминания: @username участников чата (кроме себя)
        let mentionsJson = null;
        if (text.includes('@')) {
          const names = [...text.matchAll(/@([\w.-]+)/g)].map(m => m[1].toLowerCase());
          if (names.length) {
            const members = db.prepare('SELECT u.id, u.username FROM users u JOIN chat_members cm ON cm.user_id = u.id WHERE cm.chat_id = ?').all(chat_id);
            const ids = members.filter(mb => mb.id !== user.id && names.includes(mb.username.toLowerCase())).map(mb => mb.id);
            if (ids.length) mentionsJson = JSON.stringify(ids);
          }
        }

        // Подготавливаем стейтменты вне транзакции — db.prepare нельзя вызывать внутри неё
        const stmtInsertMsg = db.prepare('INSERT INTO messages (chat_id, sender_id, text, reply_to_id, attachment, mentions) VALUES (?, ?, ?, ?, ?, ?)');
        const stmtGetMembers = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?');
        const stmtInsStatus = db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)');
        const stmtUpdDelivered = db.prepare('UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()) WHERE message_id = ? AND user_id = ?');

        // Вставка сообщения и статусов доставки в одной транзакции
        const msgId = db.transaction(() => {
          const result = stmtInsertMsg.run(chat_id, user.id, text, reply_to_id || null, attJson, mentionsJson);
          const newMsgId = result.lastInsertRowid;
          // Пометить как delivered тем участникам, которые сейчас онлайн (кроме отправителя)
          const members = stmtGetMembers.all(chat_id, user.id);
          members.forEach(({ user_id }) => {
            if (hasOpenConnection(user_id)) {
              stmtInsStatus.run(newMsgId, user_id);
              stmtUpdDelivered.run(newMsgId, user_id);
            }
          });
          return newMsgId;
        })();

        const msg = getMessageWithStatus(msgId, user.id);
        broadcast(chat_id, { type: 'message', message: msg });

        // Push-уведомления всем участникам (кроме отправителя).
        // Отправляем push независимо от наличия WS-соединения — пользователь
        // может быть залогинен с нескольких устройств (PC + PWA). Service Worker
        // сам подавит уведомление, если PWA открыта и активна прямо сейчас.
        const chat = db.prepare('SELECT type, name FROM chats WHERE id = ?').get(chat_id);
        const allMembers = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').all(chat_id, user.id);
        const stmtUnread = db.prepare(`
          SELECT COUNT(*) AS c FROM messages m
          JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
          LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
          WHERE m.sender_id IS NOT ? AND m.deleted = 0 AND ms.read_at IS NULL
        `);
        allMembers.forEach(({ user_id }) => {
          const chatTitle = chat?.type === 'direct' ? msg.sender_name : (chat?.name || 'Electron');
          const unread = stmtUnread.get(user_id, user_id, user_id).c;
          pushToUser(user_id, {
            title: chatTitle,
            body: msg.text || (msg.attachment ? '🖼 Изображение' : ''),
            chatId: chat_id,
            unread,
          });
        });
      }

      if (data.type === 'delivered') {
        const { message_id } = data;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
        if (!msg || msg.sender_id === user.id) return;
        db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)').run(message_id, user.id);
        db.prepare('UPDATE message_status SET delivered_at = unixepoch() WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL').run(message_id, user.id);
        const updated = getMessageWithStatus(message_id, msg.sender_id);
        sendTo(msg.sender_id, { type: 'status_update', message: updated });
      }

      if (data.type === 'read') {
        const { chat_id } = data;
        if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat_id, user.id)) return;
        // Только реально непрочитанные — иначе на чате в 5000 сообщений каждый вход
        // в чат рассылал status_update по КАЖДОМУ сообщению (шторм WS + SQL)
        const unread = db.prepare(`
          SELECT m.id, m.sender_id FROM messages m
          LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
          WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0 AND ms.read_at IS NULL
        `).all(user.id, chat_id, user.id);
        if (!unread.length) return;
        // Подготавливаем стейтменты вне транзакции
        const stmtReadInsert = db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)');
        const stmtReadUpdate = db.prepare('UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()), read_at = COALESCE(read_at, unixepoch()) WHERE message_id = ? AND user_id = ?');
        // Обновляем статусы всех непрочитанных сообщений в одной транзакции
        db.transaction(() => {
          unread.forEach(({ id }) => { stmtReadInsert.run(id, user.id); stmtReadUpdate.run(id, user.id); });
        })();
        // Одно событие-диапазон на отправителя вместо status_update на каждое
        // сообщение (модель read_up_to из Telegram): меньше трафика и SQL
        const bySender = new Map();
        unread.forEach(({ id, sender_id }) => {
          if (!sender_id) return; // удалённый аккаунт
          const r = bySender.get(sender_id) || { min: id, max: id };
          r.min = Math.min(r.min, id); r.max = Math.max(r.max, id);
          bySender.set(sender_id, r);
        });
        bySender.forEach((r, senderId) => {
          sendTo(senderId, { type: 'status_range', chat_id, kind: 'read', min_id: r.min, max_id: r.max, reader_id: user.id });
        });
        // Синхронизация прочтения между устройствами самого пользователя
        getConn(user.id).forEach(w => { if (w !== ws && w.readyState === 1) w.send(JSON.stringify({ type: 'chat_read', chat_id })); });
      }

      if (data.type === 'edit_message') {
        const { message_id } = data;
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 4096) : '';
        if (!text) return;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(message_id);
        if (!msg || msg.sender_id !== user.id) return;
        if (Date.now() / 1000 - msg.sent_at > getEditTimeLimit()) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'edit_rejected', message_id, reason: 'time' }));
          return;
        }
        db.prepare('UPDATE messages SET text = ?, edited_at = unixepoch() WHERE id = ?').run(text.trim(), message_id);
        const updated = getMessageWithStatus(message_id, user.id);
        broadcast(msg.chat_id, { type: 'message_edited', message: updated });
      }

      if (data.type === 'delete_message') {
        const { message_id } = data;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(message_id);
        if (!msg || msg.sender_id !== user.id) return;
        deleteAttachmentFile(msg.attachment);
        db.prepare("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?").run(message_id);
        broadcast(msg.chat_id, { type: 'message_deleted', message_id, chat_id: msg.chat_id });
      }

      if (data.type === 'set_status') {
        const s = data.status;
        if (s === 'online' || s === 'offline') {
          if (s === 'offline') {
            try { db.prepare('UPDATE users SET last_seen_at = unixepoch() WHERE id = ?').run(user.id); } catch {}
          }
          ws._status = s;
          broadcastStatus(user.id);
        }
      }

      if (data.type === 'react') {
        const { message_id, reaction } = data;
        // Любой эмодзи (как в Telegram), но именно эмодзи: короткая строка с пиктограммой
        if (typeof reaction !== 'string' || !reaction || reaction.length > 16) return;
        if (!/\p{Extended_Pictographic}/u.test(reaction)) return;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(message_id);
        if (!msg) return;
        if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(msg.chat_id, user.id)) return;
        const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').get(message_id, user.id, reaction);
        if (existing) {
          db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').run(message_id, user.id, reaction);
        } else {
          db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, reaction) VALUES (?, ?, ?)').run(message_id, user.id, reaction);
        }
        const counts = db.prepare('SELECT reaction, COUNT(*) as count FROM reactions WHERE message_id = ? GROUP BY reaction').all(message_id);
        broadcast(msg.chat_id, { type: 'reaction_update', message_id, counts });
      }

      if (data.type === 'typing') {
        const { chat_id } = data;
        // Троттлинг: не чаще раза в 2 сек на чат, иначе каждый keystroke уходит всем участникам
        const now = Date.now();
        if (!ws._typingAt) ws._typingAt = new Map();
        if (now - (ws._typingAt.get(chat_id) || 0) < 2000) return;
        ws._typingAt.set(chat_id, now);
        if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat_id, user.id)) return;
        broadcast(chat_id, { type: 'typing', chat_id, user_id: user.id, sender_name: user.display_name }, user.id);
      }

      if (data.type === 'client_info') {
        const meta = connMeta.get(ws._connId);
        if (meta) { meta.hostname = data.hostname || '—'; meta.clientVersion = data.clientVersion || '—'; meta.osPlatform = data.osPlatform || '—'; meta.osRelease = data.osRelease || '—'; meta.installScope = data.installScope || null; }
      }

      if (data.type === 'update_progress') {
        const entry = updateProgress.get(ws._connId);
        if (entry) {
          entry.pct = typeof data.pct === 'number' ? data.pct : entry.pct;
          entry.status = data.status || entry.status;
          entry.error = data.error || null;
        }
      }

      if (data.type === 'call_initiate') {
        const { peer_id } = data;
        if (!peer_id || peer_id === user.id) return;
        if (!callsEnabled()) { ws.send(JSON.stringify({ type: 'call_disabled' })); return; }
        if (activeCalls.has(user.id)) { ws.send(JSON.stringify({ type: 'call_busy_self' })); return; }
        const chat = db.prepare(`
          SELECT c.id FROM chats c
          JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
          JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
          WHERE c.type = 'direct' LIMIT 1
        `).get(user.id, peer_id);
        if (!chat) return;
        if (!hasOpenConnection(peer_id)) {
          if (pendingCalls.has(peer_id)) {
            // Уже есть ожидающий вызов для этого абонента
            ws.send(JSON.stringify({ type: 'call_busy', peer_id }));
            return;
          }
          const callerRow2 = db.prepare('SELECT display_name FROM users WHERE id = ?').get(user.id);
          pushToUser(peer_id, {
            type: 'call',
            title: 'Входящий звонок',
            body: callerRow2?.display_name || user.username,
            callerId: user.id,
            callerName: callerRow2?.display_name || user.username,
          });
          // Caller помечается как "в ожидании" — блокируем повторный вызов
          activeCalls.set(user.id, { peerId: peer_id, startedAt: Date.now(), initiatorId: user.id, pending: true });
          const timer = setTimeout(() => {
            pendingCalls.delete(peer_id);
            activeCalls.delete(user.id);
            try { db.prepare('INSERT INTO missed_calls (caller_id, callee_id) VALUES (?, ?)').run(user.id, peer_id); } catch {}
            insertCallRecord(user.id, peer_id, 'missed', 0);
            sendTo(user.id, { type: 'call_unavailable', peer_id });
          }, 30000);
          pendingCalls.set(peer_id, { callerId: user.id, callerName: callerRow2?.display_name || user.username, timer });
          ws.send(JSON.stringify({ type: 'call_ringing', peer_id }));
          return;
        }
        if (activeCalls.has(peer_id)) { ws.send(JSON.stringify({ type: 'call_busy', peer_id })); return; }
        activeCalls.set(user.id, { peerId: peer_id, startedAt: Date.now(), initiatorId: user.id });
        activeCalls.set(peer_id, { peerId: user.id, startedAt: Date.now(), initiatorId: user.id });
        const callerRow = db.prepare('SELECT display_name FROM users WHERE id = ?').get(user.id);
        // Push всегда — PWA может быть в фоне при живом WS-соединении
        pushToUser(peer_id, {
          type: 'call',
          title: 'Входящий звонок',
          body: callerRow?.display_name || user.username,
          callerId: user.id,
          callerName: callerRow?.display_name || user.username,
        });
        sendTo(peer_id, { type: 'call_incoming', caller_id: user.id, caller_name: callerRow?.display_name || user.username });
      }

      if (data.type === 'call_accept') {
        const { peer_id } = data;
        if (!peer_id) return;
        const now = Date.now();
        const myEntry = activeCalls.get(user.id);
        const peerEntry = activeCalls.get(peer_id);
        if (myEntry) myEntry.answeredAt = now;
        if (peerEntry) peerEntry.answeredAt = now;
        // Сбрасываем входящий звонок на других устройствах того же пользователя
        getConn(user.id).forEach(otherWs => {
          if (otherWs !== ws && otherWs.readyState === 1)
            otherWs.send(JSON.stringify({ type: 'call_taken' }));
        });
        sendTo(peer_id, { type: 'call_accepted', peer_id: user.id });
      }

      if (data.type === 'call_reject') {
        const { peer_id } = data;
        if (!peer_id) return;
        // Caller отменяет вызов пока абонент offline (pending)
        if (pendingCalls.has(peer_id) && pendingCalls.get(peer_id).callerId === user.id) {
          const pending = pendingCalls.get(peer_id);
          clearTimeout(pending.timer);
          pendingCalls.delete(peer_id);
          activeCalls.delete(user.id);
          try { db.prepare('INSERT INTO missed_calls (caller_id, callee_id) VALUES (?, ?)').run(user.id, peer_id); } catch {}
          insertCallRecord(user.id, peer_id, 'missed', 0);
          return;
        }
        const entry = activeCalls.get(user.id) || activeCalls.get(peer_id);
        const initiatorId = entry?.initiatorId || peer_id;
        const calleeId = initiatorId === user.id ? peer_id : user.id;
        activeCalls.delete(user.id);
        activeCalls.delete(peer_id);
        insertCallRecord(initiatorId, calleeId, 'rejected', 0);
        sendTo(peer_id, { type: 'call_rejected', peer_id: user.id });
      }

      if (data.type === 'call_end') {
        const { peer_id } = data;
        if (!peer_id) return;
        const entry = activeCalls.get(user.id) || activeCalls.get(peer_id);
        const initiatorId = entry?.initiatorId || user.id;
        const calleeId = initiatorId === user.id ? peer_id : user.id;
        const durationSec = entry?.answeredAt ? Math.floor((Date.now() - entry.answeredAt) / 1000) : 0;
        activeCalls.delete(user.id);
        activeCalls.delete(peer_id);
        insertCallRecord(initiatorId, calleeId, 'ended', durationSec);
        sendTo(peer_id, { type: 'call_ended', peer_id: user.id });
      }

      if (data.type === 'webrtc_offer' || data.type === 'webrtc_answer' || data.type === 'webrtc_ice') {
        const { peer_id } = data;
        if (!peer_id) return;
        sendTo(peer_id, { ...data, peer_id: user.id });
      }

      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });

    ws.on('close', () => {
      try { db.prepare('UPDATE users SET last_seen_at = unixepoch() WHERE id = ?').run(user.id); } catch {}
      const updEntry = updateProgress.get(ws._connId);
      if (updEntry && updEntry.status === 'restarting') { updEntry.status = 'restarted'; updEntry.pct = 100; }
      connMeta.delete(ws._connId);
      // Caller дисконнектился пока ожидал offline-абонента
      const activeCall = activeCalls.get(user.id);
      if (activeCall?.pending && !hasOpenConnection(user.id)) {
        const peerId = activeCall.peerId;
        const pending = pendingCalls.get(peerId);
        if (pending) { clearTimeout(pending.timer); pendingCalls.delete(peerId); }
        activeCalls.delete(user.id);
        try { db.prepare('INSERT INTO missed_calls (caller_id, callee_id) VALUES (?, ?)').run(user.id, peerId); } catch {}
        insertCallRecord(user.id, peerId, 'missed', 0);
      }
      // Завершить активный звонок при разрыве соединения
      else if (activeCall && !hasOpenConnection(user.id)) {
        const initiatorId = activeCall.initiatorId || user.id;
        const calleeId = initiatorId === user.id ? activeCall.peerId : user.id;
        const durationSec = activeCall.answeredAt ? Math.floor((Date.now() - activeCall.answeredAt) / 1000) : 0;
        const dropStatus = activeCall.answeredAt ? 'ended' : 'missed';
        activeCalls.delete(user.id);
        activeCalls.delete(activeCall.peerId);
        insertCallRecord(initiatorId, calleeId, dropStatus, durationSec);
        sendTo(activeCall.peerId, { type: 'call_ended', peer_id: user.id });
      }
      const conns = clients.get(user.id);
      if (conns) {
        conns.delete(ws);
        if (!conns.size) clients.delete(user.id);
      }
      // Пересчитываем агрегат: если осталось активное устройство — статус не упадёт в offline.
      broadcastStatus(user.id);
    });

    // Конфигурация для клиента: лимит редактирования подхватывается без релиза клиента
    ws.send(JSON.stringify({ type: 'connected', user_id: user.id, edit_time_limit: getEditTimeLimit() }));

    // Ожидающий входящий звонок (абонент был offline, теперь подключился)
    if (pendingCalls.has(user.id)) {
      const pending = pendingCalls.get(user.id);
      clearTimeout(pending.timer);
      pendingCalls.delete(user.id);
      activeCalls.delete(pending.callerId); // снимаем pending-блок с caller
      activeCalls.set(user.id, { peerId: pending.callerId, startedAt: Date.now(), initiatorId: pending.callerId });
      activeCalls.set(pending.callerId, { peerId: user.id, startedAt: Date.now(), initiatorId: pending.callerId });
      sendTo(pending.callerId, { type: 'call_ringing_live', peer_id: user.id }); // caller: абонент онлайн
      ws.send(JSON.stringify({ type: 'call_incoming', caller_id: pending.callerId, caller_name: pending.callerName }));
    }

    // Пропущенные звонки
    setImmediate(() => {
      try {
        const missedCalls = db.prepare(`
          SELECT mc.id, mc.caller_id, u.display_name AS caller_name, mc.occurred_at
          FROM missed_calls mc JOIN users u ON u.id = mc.caller_id
          WHERE mc.callee_id = ? ORDER BY mc.occurred_at DESC LIMIT 20
        `).all(user.id);
        if (missedCalls.length) {
          db.prepare('DELETE FROM missed_calls WHERE callee_id = ?').run(user.id);
          ws.send(JSON.stringify({ type: 'missed_calls', calls: missedCalls }));
        }
      } catch {}
    });

    // Авто-доставка при подключении: безопасно, после регистрации всех обработчиков
    setImmediate(() => {
      try {
        const undelivered = db.prepare(`
          SELECT m.id, m.sender_id, m.chat_id FROM messages m
          JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
          LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
          WHERE m.sender_id != ? AND m.deleted = 0 AND ms.delivered_at IS NULL
        `).all(user.id, user.id, user.id);
        if (!undelivered.length) return;
        const ins = db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)');
        const upd = db.prepare('UPDATE message_status SET delivered_at = unixepoch() WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL');
        db.transaction(() => {
          undelivered.forEach(({ id }) => { ins.run(id, user.id); upd.run(id, user.id); });
        })();
        // Диапазоны по (отправитель, чат) вместо события на каждое сообщение
        const byKey = new Map();
        undelivered.forEach(({ id, sender_id, chat_id }) => {
          if (!sender_id) return; // удалённый аккаунт
          const key = sender_id + ':' + chat_id;
          const r = byKey.get(key) || { sender_id, chat_id, min: id, max: id };
          r.min = Math.min(r.min, id); r.max = Math.max(r.max, id);
          byKey.set(key, r);
        });
        byKey.forEach(r => {
          sendTo(r.sender_id, { type: 'status_range', chat_id: r.chat_id, kind: 'delivered', min_id: r.min, max_id: r.max, reader_id: user.id });
        });
      } catch (e) { console.error('auto-deliver error:', e); }
    });
  });
}

function getClients() {
  return Array.from(connMeta.values()).map(m => ({
    connId: m.ws._connId,
    userId: m.userId,
    username: m.username,
    displayName: m.displayName,
    hostname: m.hostname,
    clientVersion: m.clientVersion,
    osPlatform: m.osPlatform,
    osRelease: m.osRelease,
    installScope: m.installScope,
    connectedAt: m.connectedAt,
    clientIp: m.clientIp,
    status: userStatus.get(m.userId) || 'offline',
  }));
}

function sendToConn(connId, payload) {
  const meta = connMeta.get(connId);
  if (meta && meta.ws.readyState === 1) meta.ws.send(JSON.stringify(payload));
}

function getConnCount() { return connMeta.size; }

function getConnMeta(connId) { return connMeta.get(connId) || null; }

module.exports = { setup, broadcast, sendTo, getStatus, isConnected, getClients, sendToConn, getConnCount, getConnMeta, initUpdateProgress, getUpdateProgress, clearUpdateProgress };
