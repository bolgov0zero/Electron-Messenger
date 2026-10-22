const { WebSocketServer } = require('ws');
const { filterAsync } = require('./aiter.js');
const dal = require('./dal');
const maintenance = require('./maintenance');
const spaces = require('./spaces');
const unreadCounts = require('./unread');
const gifLib = require('./gif');
const linkPrev = require('./linkprev');
const attach = require('./attach');
const guestLib = require('./guest');
// Требуем лениво, как и sendPushToUser ниже: push.js при загрузке генерирует
// ключи, и раньше времени его дёргать не нужно
async function hasPushSubscription(userId) {
  try { return await require('./routes/push').hasPushSubscription(userId); }
  catch { return false; }
}
const { wsAuth } = require('./auth');
// Федерация подключается лениво: federation.js сам требует ws.js
const fed = () => require('./federation');
const groups = () => require('./fedgroups');

// Ленивая загрузка чтобы избежать циклических зависимостей
async function pushToUser(userId, payload) {
  try { await require('./routes/push').sendPushToUser(userId, payload); } catch (e) {
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
  try { attach.purge(typeof attachment === 'string' ? JSON.parse(attachment) : attachment); } catch {}
}

// «пользователь:client_id» -> { id сообщения, время }: защита от дублей при повторной отправке (15 минут)
const recentSends = new Map();

// userId -> Set<ws>
const clients = new Map();
// userId -> 'online'|'offline'
const userStatus = new Map();
// userId -> true, если человек сейчас «с телефона»: в сети, и последним активным был мобильный клиент (/m)
const userMobile = new Map();

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

async function broadcast(chatId, payload, excludeUserId = null) {
  const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', chatId);
  members.forEach(({ user_id }) => {
    if (user_id === excludeUserId) return;
    // Гость не получает ничего о сообщениях до своего подключения; цитаты старых сообщений ему скрываются
    const pl = guestLib.isGuest(user_id) ? guestLib.forRecipient(user_id, payload) : payload;
    if (!pl) return;
    const json = JSON.stringify(pl);
    getConn(user_id).forEach(ws => { if (ws.readyState === 1) ws.send(json); });
  });
}

// Число пересылок сообщения (без удалённых копий) всем в чате, где оно лежит
async function emitForwardCount(srcId) {
  try {
    const r = await dal.get('SELECT chat_id FROM messages WHERE id = ?', srcId);
    if (!r) return;
    const count = Number((await dal.get('SELECT COUNT(*) AS c FROM messages WHERE fwd_src = ? AND deleted = 0', srcId)).c) || 0;
    await broadcast(r.chat_id, { type: 'forward_count', message_id: srcId, count });
  } catch (e) { console.warn('[Пересылки]', e.message); }
}

function sendTo(userId, payload) {
  getConn(userId).forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); });
}

function getStatus(userId) { return userStatus.get(userId) || 'offline'; }
function getMobile(userId) { return !!userMobile.get(userId) && getStatus(userId) === 'online'; }
// Есть ли у пользователя хоть одно активное WS-соединение (для админки)
function isConnected(userId) {
  const conns = clients.get(userId);
  if (!conns) return false;
  for (const ws of conns) { if (ws.readyState === 1) return true; }
  return false;
}

// Агрегированный статус: online, если хоть одно устройство в фокусе; away («отошёл»),
// если есть подключённые устройства, но все без фокуса; иначе offline
function computeStatus(userId) {
  const conns = clients.get(userId);
  if (!conns || !conns.size) return 'offline';
  let away = false;
  for (const ws of conns) {
    if (ws.readyState !== 1) continue;
    if (ws._status === 'online') return 'online';
    if (ws._status === 'away') away = true;
  }
  return away ? 'away' : 'offline';
}

// Телефон показывается только у статуса «в сети» и только если из подключённых в сети клиентов последним был активен мобильный
// (_statusAt — момент последнего set_status). «Отошёл» — всегда обычная точка
function computeMobile(userId, status) {
  if (status !== 'online') return false;
  let best = null;
  for (const ws of clients.get(userId) || []) {
    if (ws.readyState !== 1 || ws._status !== 'online') continue;
    if (!best || (ws._statusAt || 0) >= (best._statusAt || 0)) best = ws;
  }
  return !!(best && best._mobile);
}

// Пересчитать агрегат и разослать собеседникам ТОЛЬКО при реальном изменении статуса (или смене «с телефона»).
async function broadcastStatus(userId) {
  if (guestLib.isGuest(userId)) return;
  const status = computeStatus(userId);
  const mobile = computeMobile(userId, status);
  if (userStatus.get(userId) === status && !!userMobile.get(userId) === mobile) return; // не изменилось — не шумим
  userStatus.set(userId, status);
  userMobile.set(userId, mobile);
  // Статус видят те, для кого человек виден: его пространство, добавившие его в контакты и администраторы.
  // Из других пространств присутствие не отслеживается
  const online = new Set(clients.keys());
  const peers = (await spaces.presenceViewers(userId)).filter(id => online.has(id));
  let last_seen;
  if (status === 'offline') {
    const row = await dal.get('SELECT last_seen_at FROM users WHERE id = ?', userId);
    last_seen = row?.last_seen_at || Math.floor(Date.now() / 1000);
  }
  const payload = JSON.stringify({ type: 'presence', user_id: userId, status, last_seen, mobile: mobile || undefined });
  peers.forEach(peerId => {
    getConn(peerId).forEach(ws => { if (ws.readyState === 1) ws.send(payload); });
  });
  // Люди с других серверов, которые видят нас взаимно, узнают статус по федерации
  await fed().onPresence(userId, status, last_seen, mobile);
  // Счётчик «в сети N из M» в шапках групп и комнат
  try { await groups().onUserStatus(userId); } catch (e) { console.warn('[Groups] счётчик:', e.message); }
}

// Лимит редактирования сообщений (сек), настраивается в админке. По умолчанию 2 минуты.
async function getEditTimeLimit() {
  const v = Number((await dal.get("SELECT value FROM settings WHERE key = 'edit_time_limit'"))?.value);
  return v > 0 ? v : 120;
}

// Список закреплённых сообщений чата — свежие первыми: плашка показывает
// последнее закреплённое, дальше перебор идёт к более старым.
async function getPins(chatId, floor = 0) {
  return (await dal.all(`
    SELECT p.message_id, p.pinned_by, p.pinned_at,
      m.text, m.deleted, m.attachment,
      COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') AS sender_name
    FROM pinned_messages p
    JOIN messages m ON m.id = p.message_id
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE p.chat_id = ? AND m.deleted = 0 AND m.id > ?
    ORDER BY p.pinned_at DESC, p.message_id DESC
  `, chatId, Number(floor) || 0)).map(r => {
    if (r.attachment) { try { r.attachment = JSON.parse(r.attachment); } catch { r.attachment = null; } }
    return r;
  });
}
function sanitizeEncAttachment(att) {
  if (!att || att.enc !== 1 || typeof att.url !== 'string') return null;
  if (!/^\/files\/enc_[\w.-]+$/.test(att.url)) return null;
  if (typeof att.fiv !== 'string' || att.fiv.length > 64) return null;
  return { url: att.url, enc: 1, fiv: att.fiv, size: Number(att.size) || 0 };
}

async function getMessageWithStatus(msgId, viewerId) {
  const msg = await dal.get(`
    SELECT m.id, m.chat_id, m.text, m.iv, m.sent_at, m.edited_at, m.deleted, m.attachment, m.mentions, m.forward_data, m.link_preview, m.system_kind, (SELECT COUNT(*) FROM messages fx WHERE fx.fwd_src = m.id AND fx.deleted = 0) AS forward_count,
      u.id as sender_id, u.username as sender_username, COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, COALESCE(u.tag, m.guest_tag) as sender_tag, (u.is_bot = 1) as sender_is_bot,
      m.reply_to_id,
      rm.text as reply_text, rm.attachment as reply_attachment, rm.deleted as reply_deleted,
      COALESCE(ru.display_name, rm.guest_name, 'Удалённый аккаунт') as reply_sender_name, (ru.is_bot = 1) as reply_sender_is_bot,
      ru.id as reply_sender_id, COALESCE(ru.tag, rm.guest_tag) as reply_sender_tag
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages rm ON rm.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.sender_id
    WHERE m.id = ?
  `, msgId);
  if (!msg) return null;
  if (msg.attachment) try { msg.attachment = JSON.parse(msg.attachment); } catch { msg.attachment = null; }
  if (msg.attachment?.url) msg.attachment = attach.markExpired(msg.attachment);
  if (msg.mentions) try { msg.mentions = JSON.parse(msg.mentions); } catch { msg.mentions = null; }
  if (msg.reply_attachment) try { msg.reply_attachment = JSON.parse(msg.reply_attachment); } catch { msg.reply_attachment = null; }
  if (msg.forward_data) try { msg.forward_data = JSON.parse(msg.forward_data); } catch { msg.forward_data = null; }
  if (msg.link_preview) try { msg.link_preview = JSON.parse(msg.link_preview); } catch { msg.link_preview = null; }

  // IS NOT вместо != — sender_id может быть NULL (удалённый аккаунт)
  const memberCount = await spaces.recipientCount(msg.chat_id, msg.sender_id);
  const delivered = (await dal.get('SELECT COUNT(*) as c FROM message_status WHERE message_id = ? AND delivered_at IS NOT NULL', msgId)).c;
  const read = (await dal.get('SELECT COUNT(*) as c FROM message_status WHERE message_id = ? AND read_at IS NOT NULL', msgId)).c;
  // Реакции — чтобы WS-payload совпадал по форме с REST /api/messages
  const reactions = await dal.all('SELECT reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY reaction', msgId);

  return { ...msg, reactions, status: { delivered, read, total: memberCount } };
}

// Всё, что происходит после того, как сообщение записано в базу: рассылка участникам чата и push.
// Общая для сообщений своих пользователей и пришедших с другого сервера.
async function finishMessage(msgId, chat_id, senderId, clientId) {
  const msg = await getMessageWithStatus(msgId, senderId);
  if (clientId) msg.client_id = clientId;   // отправитель по нему находит своё неподтверждённое сообщение
  const chatMeta = await dal.get('SELECT type, name, parent_id, is_secret FROM chats WHERE id = ?', chat_id);
  if (chatMeta?.parent_id) msg.parent_id = chatMeta.parent_id;
  await broadcast(chat_id, { type: 'message', message: msg });

  // Push-уведомления всем участникам (кроме отправителя).
  const chat = chatMeta;
  const allMembers = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?', chat_id, senderId);
  const stmtMuted = 'SELECT 1 FROM muted_chats WHERE user_id = ? AND (chat_id = ? OR chat_id = ?) AND (until IS NULL OR until > unixepoch())';
  allMembers.forEach(async ({ user_id }) => { try {
    const parentId = chatMeta?.parent_id || chat_id;
    if ((await dal.get(stmtMuted, user_id, chat_id, parentId))) return;
    // Сначала проверяем подписку, потом считаем. Раньше порядок был обратный,
    // и счётчик непрочитанного (перебор всей переписки человека) считался
    // каждому получателю на каждое сообщение — включая тех, у кого никакой
    // подписки нет, то есть всех, кто сидит в настольном клиенте. На группе
    // из одиннадцати человек это занимало 122 мс, и всё это время сервер
    // не обслуживал никого: обращения к базе синхронные.
    if (!(await hasPushSubscription(user_id))) return;
    const chatTitle = chat?.is_secret ? 'Секретный чат' : chat?.type === 'direct' ? msg.sender_name : (chat?.name || 'Electron');
    const unread = await unreadCounts.total(user_id);
    // Секретный чат: в пуше только факт наличия сообщения, без содержимого —
    // сервер и так не может расшифровать текст, а превью сознательно не
    // показываем даже тем, у кого ключ есть (защита от подглядывания).
    await pushToUser(user_id, {
      title: chatTitle,
      body: chat?.is_secret ? 'Новое сообщение' : (String(msg.text || '').replace(/\|\|(?! )([^|\n]*[^|\n ])\|\|/g, '∗∗∗') || (msg.attachment ? (msg.attachment.gif ? 'GIF' : msg.attachment.more?.length ? `📎 Вложений: ${msg.attachment.more.length + 1}` : '🖼 Изображение') : '')),
      chatId: chat_id,
      unread,
    });
  } catch (e) { console.warn('[Push] уведомление не отправлено:', e.message); } });
  return msg;
}

// Статус человека с другого сервера приходит по федерации; рассылаем его тем, кто видит присутствие
async function setRemoteStatus(userId, status, lastSeen, mobile) {
  if (lastSeen) { try { await dal.run('UPDATE users SET last_seen_at = ? WHERE id = ?', lastSeen, userId); } catch {} }
  mobile = !!mobile && status === 'online';
  if (userStatus.get(userId) === status && !lastSeen && !!userMobile.get(userId) === mobile) return;
  userStatus.set(userId, status);
  userMobile.set(userId, mobile);
  const payload = JSON.stringify({ type: 'presence', user_id: userId, status, last_seen: status === 'offline' ? (lastSeen || Math.floor(Date.now() / 1000)) : undefined, mobile: mobile || undefined });
  (await spaces.presenceViewers(userId)).forEach(id => getConn(id).forEach(w => { if (w.readyState === 1) w.send(payload); }));
}

function setup(server) {
  // maxPayload: вложения ходят через /api/upload, по WS — только текст и метаданные.
  // Без лимита один клиент может прислать фрейм на сотни МБ (дефолт ws — 100 MiB).
  // noServer: на одном порту живут два сокета, клиентский /ws и межсерверный /fed (см. federation.js), разводим их вручную
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let p = ''; try { p = new URL(req.url, 'http://localhost').pathname; } catch {}
    if (p === '/ws') wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

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
    // Проверка токена и подготовка соединения обращаются к базе асинхронно, а клиент может прислать
    // сообщение сразу после открытия. Поэтому слушатель ставится сразу: сообщения копятся и отдаются
    // обработчику в порядке прихода, как только он готов
    let handler = null;
    const queue = [];
    ws.on('message', raw => { if (handler) handler(raw); else queue.push(raw); });
    const setHandler = fn => { handler = fn; queue.splice(0).forEach(fn); };
    wsAuth(url.searchParams.get('token')).then(user => attachConn(ws, req, user, setHandler), () => ws.close(1008, 'Unauthorized'));
  });

  async function attachConn(ws, req, user, setHandler) {

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws._status = 'online'; // уточнится первым set_status от клиента (~через 300мс)
    ws._statusAt = Date.now();

    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);
    await broadcastStatus(user.id);

    const connId = ++connCounter;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '—';
    connMeta.set(connId, { ws, userId: user.id, username: user.username, displayName: user.display_name, hostname: '—', clientVersion: '—', osPlatform: '—', osRelease: '—', installScope: null, connectedAt: Date.now(), clientIp });
    ws._connId = connId;

    setHandler(async raw => {
      let data; try { data = JSON.parse(raw); } catch { return; }

      // Гость: короткий список событий (запрет по умолчанию); порог истории применяется ниже, где читаются сообщения
      if (user.is_guest && !guestLib.WS_ALLOW.has(data.type)) return;
      const gfloor = user.is_guest ? guestLib.floorOf(user.id) : 0;

      // Перенос базы: запись запрещена, клиент получает отказ и оставляет сообщение неотправленным
      if (maintenance.isOn() && ['message', 'edit_message', 'delete_message', 'react', 'pin_message', 'unpin_message', 'read', 'delivered'].includes(data.type)) {
        if (data.type === 'message') ws.send(JSON.stringify({ type: 'send_rejected', chat_id: data.chat_id, reason: 'maintenance' }));
        return;
      }

      if (data.type === 'message') {
        // Flood-контроль: скользящее окно 20 сообщений / 10 сек на соединение
        const nowMs = Date.now();
        if (!ws._msgTimes) ws._msgTimes = [];
        ws._msgTimes = ws._msgTimes.filter(t => nowMs - t < 10_000);
        if (ws._msgTimes.length >= 20) return;
        ws._msgTimes.push(nowMs);
        const { chat_id, reply_to_id, iv } = data;
        // Повторная отправка после обрыва связи: сообщение с тем же client_id второй раз не создаём, отдаём уже созданное
        const clientId = typeof data.client_id === 'string' && /^[\w.\-]{1,40}$/.test(data.client_id) ? data.client_id : null;
        const sendKey = clientId ? user.id + ':' + clientId : null;
        if (sendKey && recentSends.has(sendKey)) {
          const prev = await getMessageWithStatus(recentSends.get(sendKey).id, user.id);
          if (prev && !prev.deleted) { prev.client_id = clientId; ws.send(JSON.stringify({ type: 'message', message: prev })); }
          return;
        }
        const chatRow = await dal.get('SELECT c.is_secret, c.read_only, (SELECT p.read_only FROM chats p WHERE p.id = c.parent_id) AS parent_read_only FROM chats c WHERE c.id = ?', chat_id);
        // Комната «только для чтения» (и её темы) — писать может только вебхук; реакции остаются
        if (chatRow?.read_only || chatRow?.parent_read_only) {
          ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'read_only' }));
          return;
        }
        const isSecret = !!chatRow?.is_secret;
        // Личный чат: если один из двоих заблокировал другого, сообщение не доставляется
        const dm = await dal.get("SELECT cm.user_id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE c.id = ? AND c.type = 'direct' AND cm.user_id != ?", chat_id, user.id);
        if (dm) {
          if ((await spaces.isBlocked(dm.user_id, user.id))) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'blocked' })); return; }
          if ((await spaces.isBlocked(user.id, dm.user_id))) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'you_blocked' })); return; }
          // Люди из разных пространств: без ответа и без добавления в контакты — не больше DM_LIMIT сообщений подряд
          const lim = await spaces.limitFor(user.id, dm.user_id);
          if (lim && lim.used >= lim.max) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'limit', dm_limit: lim })); return; }
          // Собеседник с другого сервера: соединение должно существовать (не удалено), а секретных чатов с ним нет
          if ((await spaces.isFed(dm.user_id)) && (isSecret || !(await fed().peerOfUser(dm.user_id)))) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'federation_off' })); return; }
        }
        // Зеркало группы с другого сервера: пока связи нет, писать в него нельзя (сообщение разошлось бы с оригиналом)
        const gm = await dal.get("SELECT fed_instance FROM chats WHERE id = ? AND fed_instance IS NOT NULL", chat_id);
        if (gm) {
          const gp = await fed().peerByInstance(gm.fed_instance);
          if (!gp || gp.status !== 'active' || !fed().isOnline(gp.id)) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'fed_offline' })); return; }
        }
        // В секретном чате attachment/forward_data пока не поддерживаются (не шифруются),
        // а text — это base64-шифротекст, который нельзя обрезать как обычный текст
        // (slice по символам испортил бы шифротекст) — лимит по длине выше и без .trim().
        // В секретном чате вложение — только зашифрованный файл: имя и тип клиент
        // прячет в шифротексте сообщения, сюда приходит лишь ссылка и вектор
        let attachment = isSecret ? sanitizeEncAttachment(data.attachment) : data.attachment;
        // GIF из Klipy: файла у нас нет, вложение — только проверенные ссылки Klipy; нужен включённый модуль
        if (!isSecret && attachment && typeof attachment === 'object') attachment = attach.sanitize(attachment);
        if (!isSecret && attachment && typeof attachment === 'object' && attachment.gif !== undefined) {
          attachment = gifLib.sanitize(attachment);
          if (!attachment || !(await gifLib.isOn())) { ws.send(JSON.stringify({ type: 'send_rejected', chat_id, reason: 'gif_off' })); return; }
        }
        const forward_data = isSecret ? null : data.forward_data;
        const text = isSecret
          ? (typeof data.text === 'string' ? data.text.slice(0, 8192) : '')
          : (typeof data.text === 'string' ? data.text.trim().slice(0, 4096) : '');
        // Лимит как в Telegram (4096 символов) — иначе одно гигантское сообщение
        // разойдётся всем участникам и осядет в БД
        const hasForward = forward_data && typeof forward_data === 'object' && forward_data.user_id;
        if (!chat_id || (!text && !attachment && !hasForward)) return;
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chat_id, user.id))) return;
        if (reply_to_id) {
          const ref = await dal.get('SELECT chat_id FROM messages WHERE id = ?', reply_to_id);
          if (!ref || ref.chat_id !== chat_id) return;
        }

        // Unhide chat for any members who had hidden it (e.g. deleted direct chat)
        const hidden = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ? AND hidden_at IS NOT NULL', chat_id);
        if (hidden.length) {
          await dal.run('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND hidden_at IS NOT NULL', chat_id);
          hidden.forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
        }

        const attJson = attachment ? JSON.stringify(attachment) : null;
        const fdJson = (forward_data && typeof forward_data === 'object' && forward_data.user_id)
          ? JSON.stringify({ user_id: forward_data.user_id, name: forward_data.name || '',
              text: (forward_data.text || '').slice(0, 4096),
              attachment: (forward_data.attachment && forward_data.attachment.gif !== undefined) ? gifLib.sanitize(forward_data.attachment) : attach.sanitize(forward_data.attachment || null),
              is_bot: !!forward_data.is_bot })
          : null;

        // Пересылка: запоминаем исходное сообщение (при пересылке пересланного — самое первое), если отправитель его видит
        let fwdSrc = null;
        if (fdJson && !isSecret && !user.is_guest && Number(forward_data.src) > 0) {
          const sr = await dal.get('SELECT m.id, m.fwd_src FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ? JOIN chats c ON c.id = m.chat_id AND c.is_secret = 0 WHERE m.id = ? AND m.deleted = 0', user.id, Number(forward_data.src));
          if (sr) fwdSrc = sr.fwd_src || sr.id;
        }

        // Превью ссылки: только проверенное (картинка — наша), в секретных чатах не бывает
        const lpObj = isSecret ? null : linkPrev.sanitize(data.link_preview);
        const lpJson = lpObj ? JSON.stringify(lpObj) : null;

        // Упоминания: @username участников чата (кроме себя). В секретном чате text —
        // шифротекст, разбирать его на упоминания бессмысленно и не нужно.
        let mentionsJson = null;
        if (!isSecret && text.includes('@')) {
          const names = [...text.matchAll(/@([\w.-]+(?::[\w.-]+)?)/g)].map(m => m[1].toLowerCase());
          if (names.length) {
            const members = await dal.all('SELECT u.id, u.username FROM users u JOIN chat_members cm ON cm.user_id = u.id WHERE cm.chat_id = ?', chat_id);
            const ids = members.filter(mb => mb.id !== user.id && names.includes(mb.username.toLowerCase())).map(mb => mb.id);
            if (ids.length) mentionsJson = JSON.stringify(ids);
          }
        }

        // Подготавливаем стейтменты вне транзакции — db.prepare нельзя вызывать внутри неё
        const stmtInsertMsg = 'INSERT INTO messages (chat_id, sender_id, text, iv, reply_to_id, attachment, mentions, forward_data, link_preview, fwd_src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const stmtGetMembers = 'SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?';
        const stmtInsStatus = 'INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)';
        const stmtUpdDelivered = 'UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()) WHERE message_id = ? AND user_id = ?';

        // Вставка сообщения и статусов доставки в одной транзакции
        const msgId = await dal.tx(() => (async () => {
          const result = await dal.run(stmtInsertMsg, chat_id, user.id, text, isSecret && typeof iv === 'string' ? iv.slice(0, 256) : null, reply_to_id || null, attJson, mentionsJson, fdJson, lpJson, fwdSrc);
          const newMsgId = result.lastInsertRowid;
          // Пометить как delivered тем участникам, которые сейчас онлайн (кроме отправителя)
          const members = await dal.all(stmtGetMembers, chat_id, user.id);
          for (const { user_id } of members) {
            if (hasOpenConnection(user_id)) {
              await dal.run(stmtInsStatus, newMsgId, user_id);
              await dal.run(stmtUpdDelivered, newMsgId, user_id);
            }
          } ;
          return newMsgId;
        })());

        // Счётчик «без ответа»: своё сообщение увеличивает его у меня, а у собеседника (если он мне писал) сбрасывает
        if (dm) {
          if ((await spaces.limitApplies(user.id, dm.user_id))) { await spaces.limitBump(user.id, dm.user_id); ws.send(JSON.stringify({ type: 'chat_limit', chat_id, dm_limit: (await spaces.limitFor(user.id, dm.user_id)) })); }
          if ((await spaces.limitUsed(dm.user_id, user.id)) > 0) {
            await spaces.limitReset(dm.user_id, user.id);
            sendTo(dm.user_id, { type: 'chat_limit', chat_id, dm_limit: (await spaces.limitFor(dm.user_id, user.id)) });
          }
        }
        if (sendKey) {
          recentSends.set(sendKey, { id: msgId, t: Date.now() });
          if (recentSends.size > 2000) { const old = Date.now() - 900_000; for (const [k, v] of recentSends) if (v.t < old) recentSends.delete(k); }
        }
        await finishMessage(msgId, chat_id, user.id, clientId);
        if (fwdSrc) await emitForwardCount(fwdSrc);   // у автора и читателей исходного сообщения обновится «переслали N раз»
        // Собеседник с другого сервера: сообщение уходит в очередь отправки
        if (dm && (await spaces.isFed(dm.user_id))) await fed().onLocalMessage(msgId);
        // Группа с участниками или хозяином на другом сервере
        if (!dm && !isSecret) await fed().onGroupMessage(msgId);
      }

      if (data.type === 'delivered') {
        const { message_id } = data;
        const msg = await dal.get('SELECT * FROM messages WHERE id = ?', message_id);
        if (!msg || msg.sender_id === user.id || msg.id <= gfloor) return;
        // Членство в чате — как в обработчике 'read' ниже: иначе можно подтвердить
        // доставку чужого сообщения и исказить счётчики статусов
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', msg.chat_id, user.id))) return;
        await dal.run('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)', message_id, user.id);
        await dal.run('UPDATE message_status SET delivered_at = unixepoch() WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL', message_id, user.id);
        const updated = await getMessageWithStatus(message_id, msg.sender_id);
        sendTo(msg.sender_id, { type: 'status_update', message: updated });
        if ((await spaces.isFed(msg.sender_id))) await fed().onStatus('dlv', msg.sender_id, user.id, message_id);
      }

      if (data.type === 'read') {
        const { chat_id } = data;
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chat_id, user.id))) return;
        // Только реально непрочитанные — иначе на чате в 5000 сообщений каждый вход
        // в чат рассылал status_update по КАЖДОМУ сообщению (шторм WS + SQL)
        const unread = await dal.all(`
          SELECT m.id, m.sender_id FROM messages m
          LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
          WHERE m.chat_id = ? AND m.id > ? AND m.sender_id IS NOT ? AND m.deleted = 0 AND ms.read_at IS NULL
        `, user.id, chat_id, gfloor, user.id);
        // Отметка «докуда прочитано» — до раннего выхода: если непрочитанного нет,
        // отметку всё равно надо подтянуть к последнему сообщению, иначе она может
        // отстать и счётчик покажет непрочитанное там, где его нет
        await unreadCounts.markRead(user.id, chat_id);
        if (!unread.length) return;
        // Подготавливаем стейтменты вне транзакции
        const stmtReadInsert = 'INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)';
        const stmtReadUpdate = 'UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()), read_at = COALESCE(read_at, unixepoch()) WHERE message_id = ? AND user_id = ?';
        // Обновляем статусы всех непрочитанных сообщений в одной транзакции
        await dal.tx(() => (async () => {
          for (const { id } of unread) { await dal.run(stmtReadInsert, id, user.id); await dal.run(stmtReadUpdate, id, user.id); } ;
        })());
        // Одно событие-диапазон на отправителя вместо status_update на каждое
        // сообщение (модель read_up_to из Telegram): меньше трафика и SQL
        const bySender = new Map();
        unread.forEach(({ id, sender_id }) => {
          if (!sender_id) return; // удалённый аккаунт
          const r = bySender.get(sender_id) || { min: id, max: id };
          r.min = Math.min(r.min, id); r.max = Math.max(r.max, id);
          bySender.set(sender_id, r);
        });
        for (const [senderId, r] of bySender) {
          sendTo(senderId, { type: 'status_range', chat_id, kind: 'read', min_id: r.min, max_id: r.max, reader_id: user.id });
          // Отправитель с другого сервера узнаёт о прочтении по федерации
          if ((await spaces.isFed(senderId))) await fed().onStatus('read', senderId, user.id, r.max);
        } ;
        // Синхронизация прочтения между устройствами самого пользователя
        getConn(user.id).forEach(w => { if (w !== ws && w.readyState === 1) w.send(JSON.stringify({ type: 'chat_read', chat_id })); });
      }

      if (data.type === 'edit_message') {
        const { message_id } = data;
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 4096) : '';
        if (!text) return;
        const msg = await dal.get('SELECT * FROM messages WHERE id = ? AND deleted = 0', message_id);
        if (!msg || msg.sender_id !== user.id) return;
        // Редактирование в секретных чатах не поддерживается (не шифруется)
        if ((await dal.get('SELECT is_secret FROM chats WHERE id = ?', msg.chat_id))?.is_secret) return;
        if (Date.now() / 1000 - msg.sent_at > (await getEditTimeLimit())) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'edit_rejected', message_id, reason: 'time' }));
          return;
        }
        // link_preview в запросе: объект — заменить превью, null — убрать, поля нет — оставить как было
        if (data.link_preview !== undefined) {
          const lp = linkPrev.sanitize(data.link_preview);
          await dal.run('UPDATE messages SET link_preview = ? WHERE id = ?', lp ? JSON.stringify(lp) : null, message_id);
        }
        await dal.run('UPDATE messages SET text = ?, edited_at = unixepoch() WHERE id = ?', text.trim(), message_id);
        const updated = await getMessageWithStatus(message_id, user.id);
        await broadcast(msg.chat_id, { type: 'message_edited', message: updated });
        // Если сообщение закреплено — обновим текст в плашке, иначе там останется старый
        const isPinned = await dal.get('SELECT 1 FROM pinned_messages WHERE message_id = ?', message_id);
        if (isPinned) await broadcast(msg.chat_id, { type: 'pins_updated', chat_id: msg.chat_id, pins: (await getPins(msg.chat_id)) });
        if (msg.fed_uid) await fed().onEdit(message_id);
      }

      if (data.type === 'delete_message') {
        const { message_id } = data;
        const msg = await dal.get('SELECT * FROM messages WHERE id = ? AND deleted = 0', message_id);
        if (!msg || msg.sender_id !== user.id) return;
        // Удаляем файл только если на него нет ссылок из других сообщений (в т.ч. пересланных)
        const attObj = msg.attachment ? (() => { try { return JSON.parse(msg.attachment); } catch { return null; } })() : null;
        if (attObj?.url) {
          await attach.release(attObj, message_id);
        } else if (msg.attachment) {
          deleteAttachmentFile(msg.attachment);
        }
        await dal.run("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?", message_id);
        await broadcast(msg.chat_id, { type: 'message_deleted', message_id, chat_id: msg.chat_id });
        if (msg.fwd_src) await emitForwardCount(msg.fwd_src);   // удалили копию: у исходного сообщения число пересылок уменьшилось
        if (msg.fed_uid) await fed().onDelete(msg);
        // Удаление мягкое (deleted = 1), поэтому ON DELETE CASCADE не сработает —
        // снимаем закрепление руками и сообщаем клиентам
        const wasPinned = (await dal.run('DELETE FROM pinned_messages WHERE message_id = ?', message_id)).changes;
        if (wasPinned) await broadcast(msg.chat_id, { type: 'pins_updated', chat_id: msg.chat_id, pins: (await getPins(msg.chat_id)) });
      }

      if (data.type === 'set_status') {
        const s = data.status;
        if (s === 'online' || s === 'away' || s === 'offline') {
          if (s === 'offline') {
            try { await dal.run('UPDATE users SET last_seen_at = unixepoch() WHERE id = ?', user.id); } catch {}
          }
          ws._status = s;
          ws._statusAt = Date.now();
          await broadcastStatus(user.id);
        }
      }

      if (data.type === 'react') {
        const { message_id, reaction } = data;
        // Любой эмодзи (как в Telegram), но именно эмодзи: короткая строка с пиктограммой
        if (typeof reaction !== 'string' || !reaction || reaction.length > 16) return;
        if (!/\p{Extended_Pictographic}/u.test(reaction)) return;
        const msg = await dal.get('SELECT * FROM messages WHERE id = ? AND deleted = 0', message_id);
        if (!msg || msg.id <= gfloor) return;
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', msg.chat_id, user.id))) return;
        const existing = await dal.get('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?', message_id, user.id, reaction);
        const isAdd = !existing;
        if (existing) {
          await dal.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?', message_id, user.id, reaction);
        } else {
          await dal.run('INSERT OR IGNORE INTO reactions (message_id, user_id, reaction) VALUES (?, ?, ?)', message_id, user.id, reaction);
        }
        const counts = await dal.all('SELECT reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY reaction', message_id);
        await broadcast(msg.chat_id, { type: 'reaction_update', message_id, counts });
        if (msg.fed_uid) await fed().onReact(msg, user.id, reaction, isAdd);

        // Уведомление автору сообщения о новой реакции — только при добавлении
        // (не при снятии) и не самому себе. Только пуш/нативное уведомление,
        // счётчики непрочитанного не трогаем.
        if (isAdd && msg.sender_id !== user.id) {
          const chatMeta = await dal.get('SELECT parent_id FROM chats WHERE id = ?', msg.chat_id);
          const parentId = chatMeta?.parent_id || msg.chat_id;
          const muted = await dal.get('SELECT 1 FROM muted_chats WHERE user_id = ? AND (chat_id = ? OR chat_id = ?) AND (until IS NULL OR until > unixepoch())', msg.sender_id, msg.chat_id, parentId);
          if (!muted) {
            if ((await hasPushSubscription(msg.sender_id))) {
              await pushToUser(msg.sender_id, {
                title: user.display_name,
                body: `${reaction} на ваше сообщение`,
                chatId: msg.chat_id,
                unread: await unreadCounts.total(msg.sender_id),
              });
            }
            sendTo(msg.sender_id, {
              type: 'reaction_notify',
              chatId: msg.chat_id,
              reactorName: user.display_name,
              reaction,
            });
          }
        }
      }

      // Закрепление доступно любому участнику чата — открепление тоже
      if (data.type === 'pin_message' || data.type === 'unpin_message') {
        const { message_id } = data;
        const msg = await dal.get('SELECT chat_id FROM messages WHERE id = ? AND deleted = 0', message_id);
        if (!msg) return;
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', msg.chat_id, user.id))) return;
        if (data.type === 'pin_message') {
          await dal.run('INSERT OR IGNORE INTO pinned_messages (chat_id, message_id, pinned_by) VALUES (?, ?, ?)', msg.chat_id, message_id, user.id);
        } else {
          await dal.run('DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ?', msg.chat_id, message_id);
        }
        await fed().onPin(msg.chat_id, message_id, user.id, data.type === 'pin_message');
        await broadcast(msg.chat_id, { type: 'pins_updated', chat_id: msg.chat_id, pins: (await getPins(msg.chat_id)) });
      }

      if (data.type === 'typing') {
        const { chat_id } = data;
        // Троттлинг: не чаще раза в 2 сек на чат, иначе каждый keystroke уходит всем участникам
        const now = Date.now();
        if (!ws._typingAt) ws._typingAt = new Map();
        if (now - (ws._typingAt.get(chat_id) || 0) < 2000) return;
        ws._typingAt.set(chat_id, now);
        if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chat_id, user.id))) return;
        // «Печатает…» видят те же, кто видит присутствие: иначе по нему можно узнать, что человек в сети
        (await filterAsync((await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?', chat_id, user.id))
          , async m => (await spaces.canSeePresence(m.user_id, user.id))))
          .forEach(m => sendTo(m.user_id, { type: 'typing', chat_id, user_id: user.id, sender_name: user.display_name }));
        await fed().onTyping(chat_id, user.id);
      }

      // Чат открыт в клиенте: присылаем и обновляем «в сети N из M»
      if (data.type === 'watch_chat') await groups().watch(ws, Number(data.chat_id), user.id);
      if (data.type === 'unwatch_chat') groups().unwatch(ws);

      if (data.type === 'client_info') {
        const meta = connMeta.get(ws._connId);
        if (meta) { meta.hostname = data.hostname || '—'; meta.clientVersion = data.clientVersion || '—'; meta.osPlatform = data.osPlatform || '—'; meta.osRelease = data.osRelease || '—'; meta.installScope = data.installScope || null; }
        // Мобильная версия (/m) сообщает о себе: от этого зависит значок «с телефона» у статуса
        const mob = data.mobile === true;
        if (ws._mobile !== mob) { ws._mobile = mob; await broadcastStatus(user.id); }
      }

      if (data.type === 'update_progress') {
        const entry = updateProgress.get(ws._connId);
        if (entry) {
          entry.pct = typeof data.pct === 'number' ? data.pct : entry.pct;
          entry.status = data.status || entry.status;
          entry.error = data.error || null;
        }
      }

      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });

    ws.on('close', async () => {
      try { groups().unwatch(ws); } catch {}
      try { await dal.run('UPDATE users SET last_seen_at = unixepoch() WHERE id = ?', user.id); } catch {}
      const updEntry = updateProgress.get(ws._connId);
      if (updEntry && updEntry.status === 'restarting') { updEntry.status = 'restarted'; updEntry.pct = 100; }
      connMeta.delete(ws._connId);
      const conns = clients.get(user.id);
      if (conns) {
        conns.delete(ws);
        if (!conns.size) clients.delete(user.id);
      }
      // Пересчитываем агрегат: если осталось активное устройство — статус не упадёт в offline.
      await broadcastStatus(user.id);
    });

    // Конфигурация для клиента: лимит редактирования подхватывается без релиза клиента
    ws.send(JSON.stringify({ type: 'connected', user_id: user.id, edit_time_limit: (await getEditTimeLimit()) }));

    // Авто-доставка при подключении: безопасно, после регистрации всех обработчиков
    setImmediate(async () => {
      try {
        const undelivered = await dal.all(`
          SELECT m.id, m.sender_id, m.chat_id FROM messages m
          JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
          LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
          WHERE m.sender_id != ? AND m.deleted = 0 AND ms.delivered_at IS NULL
        `, user.id, user.id, user.id);
        if (!undelivered.length) return;
        const ins = 'INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)';
        const upd = 'UPDATE message_status SET delivered_at = unixepoch() WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL';
        await dal.tx(() => (async () => {
          for (const { id } of undelivered) { await dal.run(ins, id, user.id); await dal.run(upd, id, user.id); } ;
        })());
        // Диапазоны по (отправитель, чат) вместо события на каждое сообщение
        const byKey = new Map();
        undelivered.forEach(({ id, sender_id, chat_id }) => {
          if (!sender_id) return; // удалённый аккаунт
          const key = sender_id + ':' + chat_id;
          const r = byKey.get(key) || { sender_id, chat_id, min: id, max: id };
          r.min = Math.min(r.min, id); r.max = Math.max(r.max, id);
          byKey.set(key, r);
        });
        for (const r of byKey.values()) {
          sendTo(r.sender_id, { type: 'status_range', chat_id: r.chat_id, kind: 'delivered', min_id: r.min, max_id: r.max, reader_id: user.id });
          if ((await spaces.isFed(r.sender_id))) await fed().onStatus('dlv', r.sender_id, user.id, r.max);
        } ;
      } catch (e) { console.error('auto-deliver error:', e); }
    });
  }
}

// Сколько разных людей сейчас в сети (у одного может быть несколько устройств)
function onlineUserCount() { return new Set(getClients().map(c => c.userId)).size; }
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

function broadcastAll(payload) {
  for (const [uid, conns] of clients) {
    if (guestLib.isGuest(uid)) continue;    // объявления и служебные события гостям не нужны
    conns.forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); });
  }
}
// Разорвать все соединения пользователя (закрытие доступа гостя)
function kick(userId) {
  getConn(userId).forEach(ws => { try { ws.close(4001, 'guest_ended'); } catch {} });
}

module.exports = { setup, kick, finishMessage, setRemoteStatus, hasOpenConnection, onlineUserCount, getPins, broadcast, broadcastAll, sendTo, getStatus, getMobile, isConnected, getClients, sendToConn, getConnCount, getConnMeta, initUpdateProgress, getUpdateProgress, clearUpdateProgress, getMessageWithStatus };
