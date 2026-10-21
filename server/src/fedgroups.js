// Группы в федерации: люди с разных серверов в одной группе.
//
// Устройство («звезда»):
//  • Группа живёт на сервере, где её создали (хозяин). У остальных серверов — зеркало: обычный чат со своими людьми,
//    «теневыми» участниками с других серверов и сообщениями, пришедшими от хозяина. chats.fed_instance / fed_chat_id
//    связывают зеркало с оригиналом; у самого хозяина оба поля пусты.
//  • Гостевые серверы между собой не общаются: сообщение гостя идёт хозяину, хозяин рассылает остальным.
//    Гость может писать, ставить реакции, править и удалять своё и выходить; управляет составом, названием и самой
//    группой только хозяин («с одного сервера управлять другим нельзя»).
//  • Человека с другого сервера приглашают, и он сам соглашается или отказывается. До согласия он лежит в chat_invites,
//    а не в chat_members, поэтому не виден участникам и не получает ни сообщений, ни статусов.
//    Согласие идёт запросом «вопрос-ответ» (gjoin), чтобы результат был известен сразу; отказ молчаливый и стоит в очереди.
//  • Сообщения хозяина гостям лежат в очереди fed_outbox и доходят после восстановления связи. Писать в зеркало при
//    оборванной связи нельзя (сервер отклоняет сообщение), поэтому расхождений истории не возникает.
//  • Счётчик «в сети N из M»: каждый гость сообщает хозяину только число своих людей в сети, хозяин суммирует и рассылает итог.
//  • Каждое событие несёт h — идентификатор сервера-хозяина группы: по нему видно, кто из двоих хозяин, а gid — номер группы у него.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const spaces = require('./spaces');
const gifLib = require('./gif');

const PROTO = 2;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');
const AVATAR_DIR = path.join(path.dirname(DB_PATH), 'avatar');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const F = () => require('./federation');
const wsm = () => require('./ws');
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const getS = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;
const isGroupType = t => t === 'group' || t === 'room';
const nameOf = id => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || '—';

const chatById = id => db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
const mirrorOf = (inst, gid) => db.prepare('SELECT * FROM chats WHERE fed_instance = ? AND fed_chat_id = ?').get(String(inst), gid);
const isMember = (chatId, userId) => !!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
const hasInvite = (chatId, userId) => !!db.prepare('SELECT 1 FROM chat_invites WHERE chat_id = ? AND user_id = ?').get(chatId, userId);

function systemUserId() { return Number(getS('system_user_id', '0')) || null; }

// ─────────────────────────── вспомогательное ───────────────────────────
// Серверы, чьи люди состоят в группе (для хозяина): им рассылаем всё, что происходит в группе
function hostedPeers(chatId) {
  return db.prepare(`SELECT DISTINCT p.* FROM chat_members cm JOIN users s ON s.id = cm.user_id AND s.is_bot = 2
    JOIN fed_peers p ON p.instance_id = s.fed_instance WHERE cm.chat_id = ? AND p.status = 'active'`).all(chatId);
}
// Серверы, которым группа ещё нужна: участники и приглашённые (например, чтобы сообщить об удалении группы)
function involvedPeers(chatId) {
  const byMember = hostedPeers(chatId);
  const byInvite = db.prepare(`SELECT DISTINCT p.* FROM chat_invites i JOIN users s ON s.id = i.user_id AND s.is_bot = 2
    JOIN fed_peers p ON p.instance_id = s.fed_instance WHERE i.chat_id = ? AND p.status = 'active'`).all(chatId);
  const seen = new Set(byMember.map(p => p.id));
  return byMember.concat(byInvite.filter(p => !seen.has(p.id)));
}
const homeEvent = (chat, ev) => ({ h: F().identity().id, gid: chat.id, ...ev });
// Событие от гостя к хозяину: h и gid — адрес группы у хозяина
const toHomeEvent = (chat, ev) => ({ h: chat.fed_instance, gid: chat.fed_chat_id, ...ev });

// Пока группа относится к федерации: у неё есть зеркало или участники с других серверов
function isFederated(chat) {
  if (!chat || !isGroupType(chat.type)) return false;
  if (chat.fed_instance) return true;
  return !!db.prepare('SELECT 1 FROM chat_members cm JOIN users s ON s.id = cm.user_id WHERE cm.chat_id = ? AND s.is_bot = 2 LIMIT 1').get(chat.id);
}
const isMirror = chat => !!(chat && chat.fed_instance);
function mirrorOnline(chat) {
  const p = chat?.fed_instance && F().peerByInstance(chat.fed_instance);
  return !!(p && p.status === 'active' && F().isOnline(p.id));
}

// Тень человека с любого сервера. Если человек с третьего сервера, его данные и аватарку берём через хозяина группы
function shadowVia(peer, inst, login, name, av) {
  if (!ID_RE.test(inst) || !login) return null;
  const fake = inst === peer.instance_id ? peer : { ...peer, instance_id: inst, via: true };
  return F().ensureShadow(fake, login, name, av);
}
function rosterOf(chatId) {
  const me = F().identity();
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.is_bot, u.fed_instance, u.fed_login, u.fed_avatar_v
    FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND COALESCE(u.is_bot, 0) IN (0, 2) ORDER BY cm.joined_at, u.id`).all(chatId)
    .map(u => u.is_bot === 2
      ? { i: u.fed_instance, l: u.fed_login, n: u.display_name, av: u.fed_avatar_v || '' }
      : { i: me.id, l: u.username, n: u.display_name, av: F().avatarVersion(u.id) });
}
function chatAvatarV(chatId) {
  try { return String(Math.floor(fs.statSync(path.join(AVATAR_DIR, `chat_${chatId}.jpg`)).mtimeMs)); } catch { return ''; }
}
const stateOf = chat => {
  const st = { name: chat.name || '', av: chatAvatarV(chat.id), roster: rosterOf(chat.id) };
  if (chat.type === 'room') {
    st.ro = chat.read_only ? 1 : 0; st.tm = chat.topics_manual ? 1 : 0;
    st.topics = topicsOf(chat.id).map(t => ({ id: t.id, n: t.name || '', p: t.position || 0 }));
  }
  return st;
};
function sendState(chat, onlyPeer) {
  if (chat?.parent_id) chat = chatById(chat.parent_id);   // состав и темы описывает комната, а не тема
  if (!chat) return;
  const st = stateOf(chat);
  (onlyPeer ? [onlyPeer] : hostedPeers(chat.id)).forEach(p => F().enqueue(p.id, homeEvent(chat, { k: 'gstate', ...st })));
  if (!onlyPeer) membersChanged(chat.id);   // сюда приходят все изменения состава: счётчик «в сети N из M» у открывших чат обновится
}
function realLocalMembers(chatId) {
  return db.prepare('SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND COALESCE(u.is_bot, 0) = 0').all(chatId).map(r => r.user_id);
}
function notifyReload(chatId) {
  realLocalMembers(chatId).forEach(id => wsm().sendTo(id, { type: 'reload_chats' }));
}
// Темы комнаты — отдельные чаты с parent_id
const topicsOf = chatId => db.prepare('SELECT * FROM chats WHERE parent_id = ? ORDER BY position, id').all(chatId);
const treeIds = chatId => [chatId, ...topicsOf(chatId).map(t => t.id)];
function purgeFiles(chatId) {
  db.prepare('SELECT attachment FROM messages WHERE chat_id = ? AND attachment IS NOT NULL').all(chatId).forEach(r => {
    try { require('./attach').purge(JSON.parse(r.attachment)); } catch {}
  });
}
// Зеркало больше никому не нужно: ни участников, ни приглашённых
function dropMirrorIfEmpty(chat) {
  if (!chat || !chat.fed_instance) return;
  const left = realLocalMembers(chat.id).length + db.prepare('SELECT COUNT(*) c FROM chat_invites WHERE chat_id = ?').get(chat.id).c;
  if (left) return;
  purgeTree(chat.id);
}
// Чат вместе с темами: файлы с диска, строки из базы (темы уходят каскадом), счётчики из памяти
function purgeTree(chatId) {
  const ids = treeIds(chatId);
  ids.forEach(purgeFiles);
  db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  ids.forEach(forget);
}

// ─────────────────────────── сообщения ───────────────────────────
function cleanAtt(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.gif !== undefined) return gifLib.sanitize(a);
  return { name: str(a.name, 200), size: Number(a.size) || 0, mime: str(a.mime, 100), w: Number(a.w) || null, h: Number(a.h) || null, thumb: !!a.thumb };
}
function msgEvent(m, gidOf) {
  const u = db.prepare('SELECT username, display_name, is_bot, fed_instance, fed_login, fed_avatar_v FROM users WHERE id = ?').get(m.sender_id);
  if (!u) return null;
  const me = F().identity();
  const uid = m.fed_uid || `${me.id}:${m.id}`;
  if (!m.fed_uid) db.prepare('UPDATE messages SET fed_uid = ? WHERE id = ?').run(uid, m.id);
  const ev = { k: 'gmsg', uid, text: m.text || '', ts: m.sent_at };
  if (u.is_bot === 1) {
    if (u.username === '__system__') ev.sys = m.system_kind || '';   // системное: «вступил», объявление
    else { ev.bot = m.sender_id; ev.fn = u.display_name; }          // вебхук комнаты: у гостя появится бот с этим именем
  } else if (u.is_bot === 2) {
    ev.fi = u.fed_instance; ev.fl = u.fed_login; ev.fn = u.display_name; ev.av = u.fed_avatar_v || '';   // чужое сообщение, которое хозяин досылает гостю
  } else { ev.fi = me.id; ev.fl = u.username; ev.fn = u.display_name; ev.av = F().avatarVersion(m.sender_id); }
  let att = null;
  try {
    const a = m.attachment ? JSON.parse(m.attachment) : null;
    if (a?.url) att = F().describeAtt(a);
    else if (a?.gif) att = { gif: a.gif };
  } catch {}
  if (att) ev.att = att;
  try { const f = m.forward_data ? JSON.parse(m.forward_data) : null; if (f) ev.fwd = { name: f.name, text: f.text }; } catch {}
  if (m.reply_to_id) ev.reply = db.prepare('SELECT fed_uid FROM messages WHERE id = ?').get(m.reply_to_id)?.fed_uid || null;
  const men = mentionList(m);
  if (men) ev.men = men;
  return Object.assign(ev, gidOf);
}
// Упоминания: у каждого человека свой номер на каждом сервере, поэтому по сети идут адреса и слово, которым упомянули (t)
function mentionList(m) {
  let ids = null;
  try { ids = m.mentions ? JSON.parse(m.mentions) : null; } catch {}
  if (!Array.isArray(ids) || !ids.length) return null;
  const me = F().identity().id, out = [];
  db.prepare(`SELECT username, is_bot, fed_instance, fed_login FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids.map(Number)).forEach(u => {
    if (u.is_bot === 2) out.push({ i: u.fed_instance, l: u.fed_login, t: u.username });
    else if (!u.is_bot) out.push({ i: me, l: u.username, t: u.username });
  });
  return out.length ? out : null;
}
// Получатель подставляет своих людей и свои имена в тексте
function applyMentions(text, men, selfId) {
  if (!Array.isArray(men) || !men.length) return { text, json: null };
  const me = F().identity().id, ids = [];
  men.slice(0, 50).forEach(e => {
    const i = str(e?.i, 32), l = str(e?.l, 64), t = str(e?.t, 100);
    if (!i || !l) return;
    const u = i === me ? F().findLocalUser(l) : F().shadowByAddr(i, l);
    if (!u) return;
    const uname = i === me ? u.username : `${i}:${l}`;
    if (u.id !== selfId) ids.push(u.id);
    if (t && t.toLowerCase() !== uname.toLowerCase()) text = text.replace(new RegExp('@' + escRe(t) + '(?![\\w.:-])', 'gi'), () => '@' + uname);
  });
  return { text, json: ids.length ? JSON.stringify([...new Set(ids)]) : null };
}
// Свое сообщение в группе: гость отправляет хозяину, хозяин всем гостям
function onMessage(msgId) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!m || m.deleted) return;
  const chat = chatById(m.chat_id);
  if (!chat || !isGroupType(chat.type) || chat.is_secret) return;
  const sender = db.prepare('SELECT is_bot FROM users WHERE id = ?').get(m.sender_id);
  if (!sender || sender.is_bot === 2) return;   // чужие сообщения хозяин пересылает сам (recvMsg)
  if (chat.fed_instance) {
    const peer = F().peerByInstance(chat.fed_instance);
    const ev = peer && msgEvent(m, { h: chat.fed_instance, gid: chat.fed_chat_id });
    if (ev) F().enqueue(peer.id, ev);
    return;
  }
  const peers = hostedPeers(chat.id);
  if (!peers.length) return;
  const ev = msgEvent(m, { h: F().identity().id, gid: chat.id });
  if (ev) { ev.seq = m.id; peers.forEach(p => F().enqueue(p.id, ev)); }
}

// Какая группа и в какой роли: мы хозяин (событие от гостя) или гость (событие от хозяина)
function locate(peer, ev) {
  const me = F().identity().id, gid = Math.floor(Number(ev.gid));
  if (!gid) return null;
  if (ev.h === me) {
    const chat = chatById(gid);
    return chat && !chat.fed_instance && isGroupType(chat.type) ? { chat, home: true } : null;
  }
  if (ev.h === peer.instance_id) {
    const chat = mirrorOf(peer.instance_id, gid);
    return chat ? { chat, home: false } : null;
  }
  return null;
}
const isReadOnly = chat => !!(chat.read_only || (chat.parent_id && chatById(chat.parent_id)?.read_only));
// Вебхук комнаты у гостя: бот с именем и номером из комнаты хозяина
function botFor(peer, botId, name) {
  if (!botId) return null;
  const username = `fedbot:${peer.instance_id}:${botId}`;
  let u = db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(username);
  if (!u) {
    const r = db.prepare("INSERT INTO users (username, password_hash, display_name, is_bot, workspace_id) VALUES (?, '', ?, 1, 0)").run(username, name || 'Бот');
    return { id: r.lastInsertRowid };
  }
  if (name && name !== u.display_name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, u.id);
  return { id: u.id };
}
function rejectMsg(peer, ev, reason) { F().enqueue(peer.id, { k: 'rej', uid: ev.uid, reason }); }

async function recvMsg(peer, ev) {
  const at = locate(peer, ev), uid = str(ev.uid, 80);
  if (!at || !uid) return;
  const { chat, home } = at;
  const seq = !home && Math.floor(Number(ev.seq)) > 0 ? Math.floor(Number(ev.seq)) : null;
  if (db.prepare('SELECT 1 FROM messages WHERE fed_uid = ?').get(uid)) {   // повтор после обрыва; номер у хозяина запоминаем
    if (seq) db.prepare('UPDATE messages SET fed_seq = ? WHERE fed_uid = ? AND fed_seq IS NULL').run(seq, uid);
    return;
  }
  const me = F().identity().id;
  let sender, sys = null;
  if (typeof ev.sys === 'string') {
    if (home) return;   // системные сообщения придумывает только хозяин
    sender = { id: systemUserId() }; sys = str(ev.sys, 30) || null;
    if (!sender.id) return;
  } else if (ev.bot !== undefined) {
    if (home) return;   // вебхуки живут только у хозяина
    sender = botFor(peer, Math.floor(Number(ev.bot)), str(ev.fn, 80));
    if (!sender) return;
  } else {
    const fi = str(ev.fi, 32), fl = str(ev.fl, 64);
    if (home) {
      if (fi !== peer.instance_id) return;
      sender = F().remoteUser(peer, fl);
      if (!sender || !isMember(chat.id, sender.id)) return rejectMsg(peer, ev, 'not_member');
      // Комната «только для чтения» (и её темы): писать может только вебхук
      if (isReadOnly(chat)) return rejectMsg(peer, ev, 'read_only');
    } else {
      if (fi === me) return;
      sender = shadowVia(peer, fi, fl, str(ev.fn, 80), ev.av === undefined ? undefined : str(ev.av, 40));
      if (!sender) return;
    }
  }
  let text = str(ev.text, 4096);
  const mm = applyMentions(text, ev.men, sender.id);
  text = mm.text;
  let attachment = null;
  if (ev.att && typeof ev.att === 'object') attachment = ev.att.gif ? gifLib.sanitize(ev.att) : await F().receiveAttachments(peer, uid, ev.att);
  let fwdJson = null;
  if (ev.fwd && typeof ev.fwd === 'object' && sender.id) fwdJson = JSON.stringify({ user_id: sender.id, name: str(ev.fwd.name, 80), text: str(ev.fwd.text, 4096), attachment: null, is_bot: false });
  if (!text && !attachment && !fwdJson) return;
  // Пока мы ждали файл, мог прийти повтор: проверяем ещё раз
  if (db.prepare('SELECT 1 FROM messages WHERE fed_uid = ?').get(uid)) return;
  const replyTo = ev.reply ? db.prepare('SELECT id FROM messages WHERE fed_uid = ? AND chat_id = ?').get(str(ev.reply, 80), chat.id)?.id || null : null;
  const now = Math.floor(Date.now() / 1000);
  const ts = Math.min(Math.floor(Number(ev.ts)) || now, now);
  const targets = realLocalMembers(chat.id).filter(id => id !== sender.id);
  const msgId = db.transaction(() => {
    const r = db.prepare('INSERT INTO messages (chat_id, sender_id, text, sent_at, reply_to_id, attachment, forward_data, fed_uid, system_kind, mentions, fed_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(chat.id, sender.id, text, ts, replyTo, attachment ? JSON.stringify(attachment) : null, fwdJson, uid, sys, mm.json, seq);
    targets.filter(id => wsm().hasOpenConnection(id)).forEach(id => {
      db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)').run(r.lastInsertRowid, id);
      db.prepare('UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()) WHERE message_id = ? AND user_id = ?').run(r.lastInsertRowid, id);
    });
    return r.lastInsertRowid;
  })();
  wsm().finishMessage(msgId, chat.id, sender.id);
  if (home) {
    // Остальным гостям уходит то же сообщение; автор подтверждён нами (fi — его сервер)
    const out = { k: 'gmsg', h: me, gid: chat.id, uid, text: str(ev.text, 4096), ts, seq: msgId, fi: peer.instance_id, fl: sender.fed_login, fn: sender.display_name, av: sender.fed_avatar_v || '' };
    if (Array.isArray(ev.men)) out.men = ev.men.slice(0, 50).map(e => ({ i: str(e?.i, 32), l: str(e?.l, 64), t: str(e?.t, 100) }));
    const att = cleanAtt(ev.att), fwd = ev.fwd && typeof ev.fwd === 'object' ? { name: str(ev.fwd.name, 80), text: str(ev.fwd.text, 4096) } : null;
    if (att) out.att = att;
    if (fwd) out.fwd = fwd;
    if (ev.reply) out.reply = str(ev.reply, 80);
    hostedPeers(chat.id).filter(p => p.id !== peer.id).forEach(p => F().enqueue(p.id, out));
  }
}

// Правки, удаления и реакции: те же правила, что и для сообщений
function localMsg(chat, uid) { return db.prepare('SELECT * FROM messages WHERE fed_uid = ? AND chat_id = ? AND deleted = 0').get(str(uid, 80), chat.id); }
// Автор события вправе менять сообщение: у хозяина — только человек этого гостя, у гостя — любой, кроме наших собственных (их правим мы)
function mayChange(peer, home, msg) {
  const s = db.prepare('SELECT is_bot, fed_instance FROM users WHERE id = ?').get(msg.sender_id);
  if (!s || s.is_bot !== 2) return false;
  return home ? s.fed_instance === peer.instance_id : true;
}
function relay(chat, exceptPeerId, ev) {
  hostedPeers(chat.id).filter(p => p.id !== exceptPeerId).forEach(p => F().enqueue(p.id, ev));
}
function recvEdit(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const msg = localMsg(at.chat, ev.uid), text = str(ev.text, 4096).trim();
  if (!msg || !text || !mayChange(peer, at.home, msg)) return;
  db.prepare('UPDATE messages SET text = ?, edited_at = unixepoch() WHERE id = ?').run(text, msg.id);
  const w = wsm();
  w.broadcast(msg.chat_id, { type: 'message_edited', message: w.getMessageWithStatus(msg.id, msg.sender_id) });
  if (db.prepare('SELECT 1 FROM pinned_messages WHERE message_id = ?').get(msg.id)) w.broadcast(msg.chat_id, { type: 'pins_updated', chat_id: msg.chat_id, pins: w.getPins(msg.chat_id) });
  if (at.home) relay(at.chat, peer.id, { k: 'gedit', h: F().identity().id, gid: at.chat.id, uid: msg.fed_uid, text });
}
function recvDel(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const msg = localMsg(at.chat, ev.uid);
  if (!msg || !mayChange(peer, at.home, msg)) return;
  F().removeMessageFiles(msg);
  db.prepare("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?").run(msg.id);
  const w = wsm();
  w.broadcast(msg.chat_id, { type: 'message_deleted', message_id: msg.id, chat_id: msg.chat_id });
  if (db.prepare('DELETE FROM pinned_messages WHERE message_id = ?').run(msg.id).changes) w.broadcast(msg.chat_id, { type: 'pins_updated', chat_id: msg.chat_id, pins: w.getPins(msg.chat_id) });
  if (at.home) relay(at.chat, peer.id, { k: 'gdel', h: F().identity().id, gid: at.chat.id, uid: msg.fed_uid });
}
function recvReact(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const msg = localMsg(at.chat, ev.uid), emoji = str(ev.emoji, 16);
  if (!msg || !emoji || !/\p{Extended_Pictographic}/u.test(emoji)) return;
  const me = F().identity().id, fi = str(ev.fi, 32), fl = str(ev.fl, 64);
  let who;
  if (at.home) {
    if (fi !== peer.instance_id) return;
    who = F().remoteUser(peer, fl);
    if (!who || !isMember(at.chat.id, who.id)) return;
  } else {
    if (fi === me) return;
    who = shadowVia(peer, fi, fl, undefined, undefined);
    if (!who) return;
  }
  if (ev.on) db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, reaction) VALUES (?, ?, ?)').run(msg.id, who.id, emoji);
  else db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').run(msg.id, who.id, emoji);
  const counts = db.prepare('SELECT reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY reaction').all(msg.id);
  const w = wsm();
  w.broadcast(msg.chat_id, { type: 'reaction_update', message_id: msg.id, counts });
  if (ev.on && msg.sender_id !== who.id && db.prepare('SELECT is_bot FROM users WHERE id = ?').get(msg.sender_id)?.is_bot === 0) w.sendTo(msg.sender_id, { type: 'reaction_notify', chatId: msg.chat_id, reactorName: who.display_name, reaction: emoji });
  if (at.home) relay(at.chat, peer.id, { k: 'greact', h: me, gid: at.chat.id, uid: msg.fed_uid, fi, fl, emoji, on: !!ev.on });
}
// Хуки от ws.js для правок собственных сообщений и реакций
function ownEvent(chat, ev) {
  if (!chat || !isGroupType(chat.type)) return;
  if (chat.fed_instance) { const peer = F().peerByInstance(chat.fed_instance); if (peer) F().enqueue(peer.id, toHomeEvent(chat, ev)); return; }
  hostedPeers(chat.id).forEach(p => F().enqueue(p.id, homeEvent(chat, ev)));
}
function onEdit(m) { if (m.fed_uid) ownEvent(chatById(m.chat_id), { k: 'gedit', uid: m.fed_uid, text: m.text }); }
function onDelete(m) { if (m.fed_uid) ownEvent(chatById(m.chat_id), { k: 'gdel', uid: m.fed_uid }); }
function onReact(m, userId, emoji, on) {
  if (!m.fed_uid) return;
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  ownEvent(chatById(m.chat_id), { k: 'greact', uid: m.fed_uid, fi: F().identity().id, fl: u.username, emoji, on: !!on });
}

// ─────────────────────────── приглашения ───────────────────────────
const invTimes = new Map();
function limitOk(map, peerId, setting) {
  const limit = Math.max(1, Number(getS(setting, '20')) || 20);
  const now = Date.now(), list = (map.get(peerId) || []).filter(t => now - t < 3600000);
  if (list.length >= limit) { map.set(peerId, list); return false; }
  list.push(now); map.set(peerId, list); return true;
}
const inTimes = new Map();

// Хозяин приглашает человека с другого сервера. Человек должен быть в контактах пригласившего (проверяет вызывающий)
function invite(chat, inviterId, shadow) {
  const peer = F().peerByInstance(shadow.fed_instance);
  if (!peer || peer.status !== 'active') return { error: 'Соединение с сервером этого человека не найдено' };
  if (peer.proto < PROTO) return { error: 'Этот сервер ещё не поддерживает группы: пусть его администратор обновит сервер' };
  if (isMember(chat.id, shadow.id)) return { ok: true, member: true };
  if (hasInvite(chat.id, shadow.id)) return { ok: true, pending: true };
  if (!limitOk(invTimes, peer.id, 'fed_invites_per_hour')) return { error: 'Слишком много приглашений на этот сервер за час. Попробуйте позже.' };
  db.prepare('INSERT INTO chat_invites (chat_id, user_id, invited_by) VALUES (?, ?, ?)').run(chat.id, shadow.id, inviterId);
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(inviterId);
  F().enqueue(peer.id, homeEvent(chat, { k: 'ginv', kind: chat.type === 'room' ? 'room' : 'group', name: chat.name || '', to: shadow.fed_login, from: u.username, fn: u.display_name, av: F().avatarVersion(inviterId), ts: Math.floor(Date.now() / 1000) }));
  return { ok: true, pending: true };
}
function cancelInvite(chat, shadow) {
  if (!db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, shadow.id).changes) return false;
  const peer = F().peerByInstance(shadow.fed_instance);
  if (peer) F().enqueue(peer.id, homeEvent(chat, { k: 'ginv_cancel', to: shadow.fed_login }));
  return true;
}
function declineBack(peer, ev, login) {
  F().enqueue(peer.id, { k: 'gresp', h: ev.h, gid: Math.floor(Number(ev.gid)), login, ok: false });
}
function recvInvite(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const gid = Math.floor(Number(ev.gid)), local = F().findLocalUser(str(ev.to, 64));
  if (!gid) return;
  if (!local) return declineBack(peer, ev, str(ev.to, 64));
  const inviter = F().ensureShadow(peer, str(ev.from, 64), str(ev.fn, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (!inviter) return declineBack(peer, ev, local.username);
  if (getS('fed_groups_in', '1') !== '1' || spaces.isBlocked(local.id, inviter.id)) return declineBack(peer, ev, local.username);
  let chat = mirrorOf(peer.instance_id, gid);
  if (chat && (isMember(chat.id, local.id) || hasInvite(chat.id, local.id))) return;
  if (!limitOk(inTimes, peer.id, 'fed_invites_per_hour')) return declineBack(peer, ev, local.username);
  const kind = ev.kind === 'room' ? 'room' : 'group';
  const name = str(ev.name, 100).trim() || (kind === 'room' ? 'Комната' : 'Группа');
  db.transaction(() => {
    if (!chat) {
      const r = db.prepare("INSERT INTO chats (type, name, created_by, fed_instance, fed_chat_id) VALUES (?, ?, ?, ?, ?)").run(kind, name, inviter.id, peer.instance_id, gid);
      chat = chatById(r.lastInsertRowid);
    }
    db.prepare('INSERT OR IGNORE INTO chat_invites (chat_id, user_id, invited_by) VALUES (?, ?, ?)').run(chat.id, local.id, inviter.id);
  })();
  const notify = () => {
    wsm().sendTo(local.id, { type: 'reload_chats' });
    try {
      const push = require('./routes/push');
      if (push.hasPushSubscription(local.id)) push.sendPushToUser(local.id, { title: name, body: `${inviter.display_name} приглашает вас в ${kind === 'room' ? 'комнату' : 'группу'}`, chatId: chat.id });
    } catch {}
  };
  // Приглашающий и приглашённый в одном общем пространстве: человек с другого сервера для него как свой, вступает без подтверждения.
  // Если не получилось (нет связи), остаётся обычное приглашение
  if (spaces.shares(local.id, inviter.id)) { accept(chat, local.id).then(r => { if (r.error) notify(); }, notify); return; }
  notify();
}
function recvInviteCancel(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const chat = mirrorOf(peer.instance_id, Math.floor(Number(ev.gid))), local = F().findLocalUser(str(ev.to, 64));
  if (!chat || !local) return;
  if (db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, local.id).changes) {
    wsm().sendTo(local.id, { type: 'chat_deleted', chat_id: chat.id });
    dropMirrorIfEmpty(chat);
  }
}
// Отказ приглашённого (хозяин): приглашение исчезает без следа
function recvResp(peer, ev) {
  const at = locate(peer, ev);
  if (!at || !at.home) return;
  const sh = F().remoteUser(peer, str(ev.login, 64));
  if (sh && !ev.ok) db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(at.chat.id, sh.id);
}
// Согласие (хозяин): запрос «вопрос-ответ», ответ — состав группы для зеркала
async function reqJoin(peer, f) {
  const gid = Math.floor(Number(f.gid));
  const chat = chatById(gid);
  if (!chat || chat.fed_instance || !isGroupType(chat.type)) throw new Error('gone');
  const sh = F().remoteUser(peer, str(f.login, 64));
  if (!sh) throw new Error('no_invite');
  if (!isMember(chat.id, sh.id)) {
    if (!hasInvite(chat.id, sh.id)) throw new Error('no_invite');
    db.transaction(() => {
      db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, sh.id);
      treeIds(chat.id).forEach(id => db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(id, sh.id));   // в комнате — и в её темы
    })();
    sendState(chat);
    require('./announcements').sendSystemMessage(chat.id, `${sh.display_name} вступил(а) в ${chat.type === 'room' ? 'комнату' : 'группу'}`, 'member_add');
    notifyReload(chat.id);
    membersChanged(chat.id);
  }
  return stateOf(chat);
}
// Гость нажал «Вступить»
async function accept(chat, userId) {
  if (!hasInvite(chat.id, userId)) return { error: 'Приглашения нет', status: 404 };
  const peer = F().peerByInstance(chat.fed_instance);
  if (!peer || peer.status !== 'active' || !F().isOnline(peer.id)) return { error: 'Нет связи с сервером этой группы. Попробуйте позже.', status: 503 };
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  let st;
  try { st = await F().rpc(peer.id, 'gjoin', { gid: chat.fed_chat_id, login: u.username }); }
  catch (e) {
    if (e.message === 'no_invite' || e.message === 'gone') { db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, userId); wsm().sendTo(userId, { type: 'chat_deleted', chat_id: chat.id }); dropMirrorIfEmpty(chat); return { error: 'Приглашение больше не действует', status: 410 }; }
    return { error: 'Нет связи с сервером этой группы. Попробуйте позже.', status: 503 };
  }
  db.transaction(() => {
    db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, userId);
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(chat.id, userId);
  })();
  applyState(peer, chat, st);
  wsm().sendTo(userId, { type: 'reload_chats' });
  membersChanged(chat.id);
  return { ok: true };
}
// Гость нажал «Отклонить»
function decline(chat, userId) {
  if (!db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, userId).changes) return;
  const peer = F().peerByInstance(chat.fed_instance);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (peer) F().enqueue(peer.id, toHomeEvent(chat, { k: 'gresp', login: u.username, ok: false }));
  wsm().sendTo(userId, { type: 'chat_deleted', chat_id: chat.id });
  dropMirrorIfEmpty(chat);
}

// ─────────────────────────── состав ───────────────────────────
function applyState(peer, chat, st) {
  const me = F().identity().id;
  const name = str(st.name, 100).trim();
  if (name && name !== chat.name) db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(name, chat.id);
  if (st.av !== undefined && str(st.av, 40) !== String(chat.fed_avatar_v || '')) fetchChatAvatar(peer, chat, str(st.av, 40));
  if (st.ro !== undefined && chat.type === 'room') {
    const ro = st.ro ? 1 : 0, tm = st.tm ? 1 : 0;
    if (ro !== (chat.read_only ? 1 : 0) || tm !== (chat.topics_manual ? 1 : 0)) {
      db.prepare('UPDATE chats SET read_only = ?, topics_manual = ? WHERE id = ?').run(ro, tm, chat.id);
      realLocalMembers(chat.id).forEach(id => wsm().sendTo(id, { type: 'chat_updated', chat_id: chat.id, name: name || chat.name, read_only: !!ro, topics_manual: !!tm }));
    }
  }
  const want = new Set();
  (Array.isArray(st.roster) ? st.roster.slice(0, 1000) : []).forEach(e => {
    const i = str(e?.i, 32), l = str(e?.l, 64);
    if (!i || !l || i === me) return;   // свои люди состоят в зеркале сами
    const sh = shadowVia(peer, i, l, str(e.n, 80), e.av === undefined ? undefined : str(e.av, 40));
    if (sh) want.add(sh.id);
  });
  const have = new Set(db.prepare('SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND u.is_bot = 2').all(chat.id).map(r => r.user_id));
  db.transaction(() => {
    have.forEach(id => { if (!want.has(id)) db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chat.id, id); });
    want.forEach(id => { if (!have.has(id)) db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(chat.id, id); });
  })();
  if (chat.type === 'room' && Array.isArray(st.topics)) syncTopics(peer, chat, st.topics);
  notifyReload(chat.id);
}
// Темы зеркала комнаты повторяют темы хозяина; их участники — те же, что у комнаты
function syncTopics(peer, room, topics) {
  const keep = new Set();
  db.transaction(() => {
    topics.slice(0, 200).forEach(t => {
      const tid = Math.floor(Number(t?.id)); if (!tid) return;
      const name = str(t.n, 100) || 'Тема', pos = Math.floor(Number(t.p)) || 0;
      let c = mirrorOf(peer.instance_id, tid);
      if (!c) {
        const r = db.prepare("INSERT INTO chats (type, name, parent_id, position, fed_instance, fed_chat_id) VALUES ('room', ?, ?, ?, ?, ?)").run(name, room.id, pos, peer.instance_id, tid);
        c = chatById(r.lastInsertRowid);
      } else if (c.name !== name || c.position !== pos || c.parent_id !== room.id) {
        db.prepare('UPDATE chats SET name = ?, position = ?, parent_id = ? WHERE id = ?').run(name, pos, room.id, c.id);
      }
      keep.add(c.id);
    });
  })();
  topicsOf(room.id).filter(t => t.fed_instance === peer.instance_id && !keep.has(t.id)).forEach(t => { purgeFiles(t.id); db.prepare('DELETE FROM chats WHERE id = ?').run(t.id); forget(t.id); });
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(room.id).map(r => r.user_id);
  db.transaction(() => keep.forEach(tid => {
    members.forEach(uid => db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(tid, uid));
    db.prepare(`DELETE FROM chat_members WHERE chat_id = ? AND user_id NOT IN (${members.map(() => '?').join(',') || 'NULL'})`).run(tid, ...members);
  }))();
}
function recvState(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const chat = mirrorOf(peer.instance_id, Math.floor(Number(ev.gid)));
  if (chat) { applyState(peer, chat, ev); membersChanged(chat.id); }
}
// Хозяин убрал человека (или он сам вышел) — гость убирает группу у этого человека
function recvKick(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const chat = mirrorOf(peer.instance_id, Math.floor(Number(ev.gid))), local = F().findLocalUser(str(ev.to, 64));
  if (!chat || !local) return;
  const ids = treeIds(chat.id);
  ids.forEach(id => db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, local.id));
  db.prepare('DELETE FROM chat_invites WHERE chat_id = ? AND user_id = ?').run(chat.id, local.id);
  ids.forEach(id => wsm().sendTo(local.id, { type: 'chat_deleted', chat_id: id }));
  dropMirrorIfEmpty(chat);
  if (chatById(chat.id)) { notifyReload(chat.id); membersChanged(chat.id); }
}
function recvDrop(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const chat = mirrorOf(peer.instance_id, Math.floor(Number(ev.gid)));
  if (!chat) return;
  const ids = realLocalMembers(chat.id).concat(db.prepare('SELECT user_id FROM chat_invites WHERE chat_id = ?').all(chat.id).map(r => r.user_id));
  const tree = treeIds(chat.id);
  purgeTree(chat.id);
  ids.forEach(id => tree.forEach(cid => wsm().sendTo(id, { type: 'chat_deleted', chat_id: cid })));
}
// Гость вышел сам (хозяин)
function recvLeave(peer, ev) {
  const at = locate(peer, ev);
  if (!at || !at.home) return;
  const sh = F().remoteUser(peer, str(ev.login, 64));
  if (!sh || !isMember(at.chat.id, sh.id)) return;
  treeIds(at.chat.id).forEach(id => db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, sh.id));
  sendState(at.chat);
  require('./announcements').sendSystemMessage(at.chat.id, `${sh.display_name} покинул(а) ${at.chat.type === 'room' ? 'комнату' : 'группу'}`, 'member_remove');
  notifyReload(at.chat.id);
  membersChanged(at.chat.id);
}

// ── Действия хозяина (вызываются из маршрутов) ──
// Хозяин убирает участника с другого сервера или отменяет его приглашение
function removeRemote(chat, shadow) {
  if (cancelInvite(chat, shadow)) return;
  if (!isMember(chat.id, shadow.id)) return;
  const peer = F().peerByInstance(shadow.fed_instance);
  treeIds(chat.id).forEach(id => db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, shadow.id));
  if (peer) F().enqueue(peer.id, homeEvent(chat, { k: 'gkick', to: shadow.fed_login }));
  sendState(chat);
  membersChanged(chat.id);
}
function afterRename(chat) { if (!chat.fed_instance) sendState(chat); }
// Группа удаляется у хозяина: сообщаем серверам, где есть её зеркало (вызывать до удаления из базы)
function dropAll(chat) {
  if (!chat || chat.fed_instance || !isGroupType(chat.type)) return;
  involvedPeers(chat.id).forEach(p => F().enqueue(p.id, homeEvent(chat, { k: 'gdrop' })));
}
// Гость выходит из зеркала
function leaveMirror(chat, userId) {
  const peer = F().peerByInstance(chat.fed_instance);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (peer && u) F().enqueue(peer.id, toHomeEvent(chat, { k: 'gleave', login: u.username }));
}

// ─────────────────────────── «в сети N из M» ───────────────────────────
const reported = new Map();    // хозяин: `${chatId}:${peerId}` → сколько людей этого гостя в сети
const sentOn = new Map();      // гость: chatId → последнее отправленное хозяину число
const mirrorAgg = new Map();   // гость: chatId → { on, total } от хозяина
const sentAgg = new Map();     // хозяин: chatId → последняя разосланная сводка
const watchers = new Map();    // chatId → множество соединений клиентов, у которых чат открыт
const timers = new Map();
function forget(chatId) {
  [...reported.keys()].forEach(k => { if (k.startsWith(chatId + ':')) reported.delete(k); });
  sentOn.delete(chatId); mirrorAgg.delete(chatId); sentAgg.delete(chatId); watchers.delete(chatId);
  clearTimeout(timers.get(chatId)); timers.delete(chatId);
}
function localStats(chatId) {
  let total = 0, on = 0, remoteTotal = 0;
  db.prepare('SELECT cm.user_id, u.is_bot FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?').all(chatId).forEach(r => {
    if (r.is_bot === 1) return;
    if (r.is_bot === 2) { remoteTotal++; return; }
    total++;
    if (wsm().getStatus(r.user_id) !== 'offline') on++;
  });
  return { on, total, remoteTotal };
}
function aggregate(chat) {
  const s = localStats(chat.id);
  if (chat.fed_instance) {
    const a = mirrorAgg.get(chat.id);
    return { online: a ? a.on : s.on, total: a ? Math.max(a.total, s.total) : s.total + s.remoteTotal, local: s.on };
  }
  let remoteOn = 0;
  hostedPeers(chat.id).forEach(p => { remoteOn += reported.get(chat.id + ':' + p.id) || 0; });
  return { online: s.on + remoteOn, total: s.total + s.remoteTotal, local: s.on };
}
function refresh(chatId) {
  const chat = chatById(chatId);
  if (!chat || !isGroupType(chat.type)) return;
  const a = aggregate(chat);
  const w = watchers.get(chatId);
  if (w) { const msg = JSON.stringify({ type: 'chat_online', chat_id: chatId, online: a.online, total: a.total }); w.forEach(ws => { if (ws.readyState === 1) ws.send(msg); }); }
  if (chat.fed_instance) {
    const peer = F().peerByInstance(chat.fed_instance);
    if (peer && F().isOnline(peer.id) && sentOn.get(chatId) !== a.local) {
      sentOn.set(chatId, a.local);
      F().sendLive(peer.id, toHomeEvent(chat, { k: 'gonline', n: a.local }));
    }
  } else {
    const key = a.online + '/' + a.total;
    const peers = hostedPeers(chatId);
    if (peers.length && sentAgg.get(chatId) !== key) {
      sentAgg.set(chatId, key);
      peers.forEach(p => F().sendLive(p.id, homeEvent(chat, { k: 'gcount', on: a.online, total: a.total })));
    }
  }
}
// Пересчёт откладываем: человек может мигать «в сети / не в сети» чаще, чем нужно кому-то об этом сообщать
// Состав чата изменился: «в сети N из M» пересчитывается у открывших чат. У комнаты и её тем состав общий, пересчитываем все
function membersChanged(chatId) {
  const c = chatById(chatId);
  if (!c) return;
  treeIds(c.parent_id || c.id).forEach(touch);
}
function touch(chatId) {
  if (timers.has(chatId)) return;
  timers.set(chatId, setTimeout(() => { timers.delete(chatId); try { refresh(chatId); } catch (e) { console.warn('[FedGroups] счётчик:', e.message); } }, 1500));
}
const involvedSql = `SELECT cm.chat_id AS id FROM chat_members cm JOIN chats c ON c.id = cm.chat_id WHERE cm.user_id = ? AND c.type IN ('group', 'room')
  AND (c.fed_instance IS NOT NULL OR EXISTS (SELECT 1 FROM chat_members x JOIN users s ON s.id = x.user_id WHERE x.chat_id = c.id AND s.is_bot = 2))`;
// Статус человека изменился: пересчитываем чаты, где счёт кому-то нужен
function onUserStatus(userId) {
  const ids = new Set(db.prepare(involvedSql).all(userId).map(r => r.id));
  for (const cid of watchers.keys()) if (isMember(cid, userId)) ids.add(cid);
  ids.forEach(touch);
}
function watch(ws, chatId, userId) {
  unwatch(ws);
  const chat = chatById(chatId);
  if (!chat || !isGroupType(chat.type) || !isMember(chatId, userId)) return;
  if (!watchers.has(chatId)) watchers.set(chatId, new Set());
  watchers.get(chatId).add(ws);
  ws._watchChat = chatId;
  const a = aggregate(chat);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'chat_online', chat_id: chatId, online: a.online, total: a.total }));
}
function unwatch(ws) {
  const id = ws._watchChat;
  if (!id) return;
  ws._watchChat = null;
  const s = watchers.get(id);
  if (s) { s.delete(ws); if (!s.size) watchers.delete(id); }
}
function recvOnline(peer, ev) {
  const at = locate(peer, ev);
  if (!at || !at.home) return;
  reported.set(at.chat.id + ':' + peer.id, Math.max(0, Math.floor(Number(ev.n)) || 0));
  touch(at.chat.id);
}
function recvCount(peer, ev) {
  if (ev.h !== peer.instance_id) return;
  const chat = mirrorOf(peer.instance_id, Math.floor(Number(ev.gid)));
  if (!chat) return;
  mirrorAgg.set(chat.id, { on: Math.max(0, Math.floor(Number(ev.on)) || 0), total: Math.max(0, Math.floor(Number(ev.total)) || 0) });
  refresh(chat.id);
}

// ─────────────────────────── связь между серверами ───────────────────────────
// Связь с сервером появилась или пропала: клиенты зеркальных групп обновляют плашку, счёт пересылается заново
function onLink(peer, online) {
  const users = new Set(db.prepare(`SELECT cm.user_id AS id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE c.fed_instance = ?
    UNION SELECT i.user_id FROM chats c JOIN chat_invites i ON i.chat_id = c.id WHERE c.fed_instance = ?`).all(peer.instance_id, peer.instance_id).map(r => r.id));
  users.forEach(id => wsm().sendTo(id, { type: 'fed_link', instance: peer.instance_id, online }));
  if (online) {
    db.prepare('SELECT * FROM chats WHERE fed_instance = ?').all(peer.instance_id).forEach(c => {
      sentOn.delete(c.id); touch(c.id);
      if (realLocalMembers(c.id).length) resyncChat(peer, c).catch(() => {});   // что написали за время обрыва
    });
    db.prepare(`SELECT DISTINCT cm.chat_id AS id FROM chat_members cm JOIN users s ON s.id = cm.user_id AND s.is_bot = 2 WHERE s.fed_instance = ?`).all(peer.instance_id)
      .forEach(c => { sentAgg.delete(c.id); touch(c.id); });
  } else {
    [...reported.keys()].forEach(k => { if (k.endsWith(':' + peer.id)) { const cid = Number(k.split(':')[0]); reported.delete(k); touch(cid); } });
  }
}
// Другой сервер сообщил версию протокола. Группы — с версии 2
function recvCaps(peer, ev) {
  const v = Math.max(0, Math.floor(Number(ev.v)) || 0);
  const ver = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/.test(String(ev.ver || '')) ? String(ev.ver) : null;   // версия сервера партнёра: у старых серверов её нет
  db.prepare('UPDATE fed_peers SET proto = ?, sp = ?, ver = COALESCE(?, ver) WHERE id = ?').run(v, ev.sp ? 1 : 0, ver, peer.id);
}
function sendCaps(peerId) { F().sendLive(peerId, { k: 'caps', v: PROTO, sp: 1, ver: F().ownVersion() }); }


// ─────────────────────────── «печатает», закрепы, галочки ───────────────────────────
const nameRow = id => db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(id);
// Кто автор события: у хозяина — человек отправившего гостя (и участник группы), у гостя — любой, кого мы знаем по составу
function actorOf(peer, at, ev) {
  const fi = str(ev.fi, 32), fl = str(ev.fl, 64), me = F().identity().id;
  if (at.home) {
    if (fi !== peer.instance_id) return null;
    const sh = F().remoteUser(peer, fl);
    return sh && isMember(at.chat.id, sh.id) ? sh : null;
  }
  return fi === me ? null : F().shadowByAddr(fi, fl);
}
function onTyping(chatId, userId) {
  const chat = chatById(chatId);
  if (!chat || !isGroupType(chat.type) || !isFederated(chat)) return;
  const u = nameRow(userId), ev = { k: 'gtyp', fi: F().identity().id, fl: u.username };
  if (chat.fed_instance) { const p = F().peerByInstance(chat.fed_instance); if (p) F().sendLive(p.id, toHomeEvent(chat, ev)); return; }
  hostedPeers(chat.id).forEach(p => F().sendLive(p.id, homeEvent(chat, ev)));
}
function recvTyping(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const who = actorOf(peer, at, ev); if (!who) return;
  // «Печатает» видят те же, кто видит присутствие: у людей с других серверов это взаимные контакты
  realLocalMembers(at.chat.id).filter(id => spaces.canSeePresence(id, who.id))
    .forEach(id => wsm().sendTo(id, { type: 'typing', chat_id: at.chat.id, user_id: who.id, sender_name: who.display_name }));
  if (at.home) hostedPeers(at.chat.id).filter(p => p.id !== peer.id).forEach(p => F().sendLive(p.id, homeEvent(at.chat, { k: 'gtyp', fi: peer.instance_id, fl: who.fed_login })));
}
function onPin(chatId, msgId, userId, on) {
  const m = db.prepare('SELECT fed_uid FROM messages WHERE id = ?').get(msgId);
  if (!m?.fed_uid) return;
  ownEvent(chatById(chatId), { k: 'gpin', uid: m.fed_uid, on: !!on, fi: F().identity().id, fl: nameRow(userId).username });
}
function recvPin(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const msg = localMsg(at.chat, ev.uid), who = msg && actorOf(peer, at, ev);
  if (!msg || !who) return;
  if (ev.on) db.prepare('INSERT OR IGNORE INTO pinned_messages (chat_id, message_id, pinned_by) VALUES (?, ?, ?)').run(at.chat.id, msg.id, who.id);
  else db.prepare('DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ?').run(at.chat.id, msg.id);
  wsm().broadcast(at.chat.id, { type: 'pins_updated', chat_id: at.chat.id, pins: wsm().getPins(at.chat.id) });
  if (at.home) relay(at.chat, peer.id, { k: 'gpin', h: F().identity().id, gid: at.chat.id, uid: msg.fed_uid, on: !!ev.on, fi: peer.instance_id, fl: who.fed_login });
}
// «Доставлено» и «прочитано» по сообщению чужого автора идут к его серверу: гость → хозяин → сервер автора
function onStatus(kind, readerId, maxLocalId) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(maxLocalId);
  const chat = m?.fed_uid && chatById(m.chat_id);
  if (!chat || !isGroupType(chat.type)) return;
  const ev = { k: 'gstat', st: kind === 'read' ? 'read' : 'dlv', uid: m.fed_uid, fi: F().identity().id, fl: nameRow(readerId).username };
  if (chat.fed_instance) { const p = F().peerByInstance(chat.fed_instance); if (p) F().enqueue(p.id, toHomeEvent(chat, ev)); return; }
  const a = db.prepare('SELECT fed_instance FROM users WHERE id = ? AND is_bot = 2').get(m.sender_id), p = a && F().peerByInstance(a.fed_instance);
  if (p) F().enqueue(p.id, homeEvent(chat, ev));
}
function recvStat(peer, ev) {
  const at = locate(peer, ev); if (!at) return;
  const msg = db.prepare('SELECT * FROM messages WHERE fed_uid = ? AND chat_id = ?').get(str(ev.uid, 80), at.chat.id), who = msg && actorOf(peer, at, ev);
  if (!msg || !who) return;
  const author = db.prepare('SELECT id, is_bot, fed_instance FROM users WHERE id = ?').get(msg.sender_id);
  if (!author) return;
  if (author.is_bot === 0) {
    const read = ev.st === 'read';
    const ids = db.prepare('SELECT id FROM messages WHERE chat_id = ? AND sender_id = ? AND id <= ? AND deleted = 0 ORDER BY id').all(at.chat.id, author.id, msg.id).map(r => r.id);
    if (!ids.length) return;
    const ins = db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)');
    const upd = db.prepare(`UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch())${read ? ', read_at = COALESCE(read_at, unixepoch())' : ''} WHERE message_id = ? AND user_id = ?`);
    db.transaction(() => ids.forEach(id => { ins.run(id, who.id); upd.run(id, who.id); }))();
    wsm().sendTo(author.id, { type: 'status_range', chat_id: at.chat.id, kind: read ? 'read' : 'delivered', min_id: ids[0], max_id: ids[ids.length - 1], reader_id: who.id });
  } else if (author.is_bot === 2 && at.home && author.fed_instance !== peer.instance_id) {
    const p = F().peerByInstance(author.fed_instance);
    if (p) F().enqueue(p.id, homeEvent(at.chat, { k: 'gstat', st: ev.st === 'read' ? 'read' : 'dlv', uid: msg.fed_uid, fi: peer.instance_id, fl: who.fed_login }));
  }
}

// ─────────────────────────── пропущенное после обрыва ───────────────────────────
// Очередь хранит события 14 дней, а связь могла пропасть и на дольше: гость при каждом подключении спрашивает у хозяина сообщения,
// которых у него нет (по номеру сообщения у хозяина). Дубли отсекает fed_uid, так что лишнего не будет
async function resyncChat(peer, chat) {
  for (let n = 0; n < 20; n++) {
    const after = db.prepare('SELECT COALESCE(MAX(fed_seq), 0) AS s FROM messages WHERE chat_id = ?').get(chat.id).s;
    let r;
    try { r = await F().rpc(peer.id, 'ghist', { gid: chat.fed_chat_id, after, limit: 100 }); } catch { return; }
    const evs = Array.isArray(r?.events) ? r.events : [];
    for (const ev of evs) { try { await recvMsg(peer, { ...ev, h: peer.instance_id, gid: chat.fed_chat_id }); } catch (e) { console.warn('[FedGroups] досылка:', e.message); } }
    if (!r?.more || !evs.length) return;
  }
}
async function reqHist(peer, f) {
  const chat = chatById(Math.floor(Number(f.gid)));
  if (!chat || chat.fed_instance || !isGroupType(chat.type)) throw new Error('gone');
  // Только то, что написано с момента вступления первого человека этого сервера
  const mj = db.prepare('SELECT MIN(cm.joined_at) AS j FROM chat_members cm JOIN users s ON s.id = cm.user_id WHERE cm.chat_id = ? AND s.is_bot = 2 AND s.fed_instance = ?').get(chat.id, peer.instance_id);
  if (!mj || mj.j == null) throw new Error('gone');
  const after = Math.max(0, Math.floor(Number(f.after)) || 0), limit = Math.min(100, Math.max(1, Math.floor(Number(f.limit)) || 100));
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id > ? AND deleted = 0 AND sent_at >= ? ORDER BY id LIMIT ?').all(chat.id, after, mj.j, limit + 1);
  const events = rows.slice(0, limit).map(m => { const ev = msgEvent(m, { h: F().identity().id, gid: chat.id }); if (ev) ev.seq = m.id; return ev; }).filter(Boolean);
  return { events, more: rows.length > limit };
}

// ─────────────────────────── аватарка группы ───────────────────────────
async function fetchChatAvatar(peer, chat, av) {
  db.prepare('UPDATE chats SET fed_avatar_v = ? WHERE id = ?').run(av, chat.id);   // раньше запроса: не запускаем дважды
  const file = path.join(AVATAR_DIR, `chat_${chat.id}.jpg`);
  if (!av) { try { fs.unlinkSync(file); } catch {} announceChatAvatar(chat.id); return; }
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  try {
    await F().fetchFile(peer.id, { op: 'gavatar', gid: chat.fed_chat_id }, tmp, 2 * 1024 * 1024);
    const buf = fs.readFileSync(tmp);
    if (!require('./routes/users').isImageBuffer(buf)) throw new Error('not image');
    let out = buf;
    try { out = await require('sharp')(buf).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer(); } catch {}
    fs.writeFileSync(file, out);
    announceChatAvatar(chat.id);
  } catch { db.prepare('UPDATE chats SET fed_avatar_v = NULL WHERE id = ?').run(chat.id); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
function announceChatAvatar(chatId) { realLocalMembers(chatId).forEach(id => wsm().sendTo(id, { type: 'avatar_updated', user_id: 0 })); }
// Хозяин отдаёт аватарку группы серверу, чьи люди в ней состоят
function chatAvatarFile(peer, gid) {
  const chat = chatById(Math.floor(Number(gid)));
  if (!chat || chat.fed_instance || !isGroupType(chat.type) || !hostedPeers(chat.id).some(p => p.id === peer.id)) return null;
  const file = path.join(AVATAR_DIR, `chat_${chat.id}.jpg`);
  return fs.existsSync(file) ? file : null;
}

async function handle(peer, ev) {
  switch (ev.k) {
    case 'caps': return recvCaps(peer, ev);
    case 'ginv': return recvInvite(peer, ev);
    case 'ginv_cancel': return recvInviteCancel(peer, ev);
    case 'gresp': return recvResp(peer, ev);
    case 'gstate': return recvState(peer, ev);
    case 'gkick': return recvKick(peer, ev);
    case 'gdrop': return recvDrop(peer, ev);
    case 'gleave': return recvLeave(peer, ev);
    case 'gmsg': return recvMsg(peer, ev);
    case 'gedit': return recvEdit(peer, ev);
    case 'gdel': return recvDel(peer, ev);
    case 'greact': return recvReact(peer, ev);
    case 'gtyp': return recvTyping(peer, ev);
    case 'gpin': return recvPin(peer, ev);
    case 'gstat': return recvStat(peer, ev);
    case 'gonline': return recvOnline(peer, ev);
    case 'gcount': return recvCount(peer, ev);
  }
}
async function handleReq(peer, f) {
  if (f.op === 'gjoin') return reqJoin(peer, f);
  if (f.op === 'ghist') return reqHist(peer, f);
  throw new Error('unknown');
}

// ─────────────────────────── для маршрутов ───────────────────────────
// Приглашения, ждущие ответа от человека с другого сервера: видят пригласивший и администратор
function pendingFor(chat, viewerId, isAdmin) {
  if (chat.fed_instance) return [];
  return db.prepare(`SELECT i.user_id AS id, u.display_name, u.fed_login AS login, u.fed_instance AS server_id, i.invited_by FROM chat_invites i
    JOIN users u ON u.id = i.user_id WHERE i.chat_id = ? ORDER BY i.created_at`).all(chat.id)
    .filter(r => isAdmin || r.invited_by === viewerId)
    .map(({ invited_by, ...r }) => ({ ...r, federated: true }));
}
function inviteInfo(chatId, userId) {
  const r = db.prepare('SELECT i.created_at, u.display_name FROM chat_invites i LEFT JOIN users u ON u.id = i.invited_by WHERE i.chat_id = ? AND i.user_id = ?').get(chatId, userId);
  return r ? { from_name: r.display_name || '', at: r.created_at } : null;
}

module.exports = {
  PROTO, isFederated, isMirror, mirrorOnline, hostedPeers, involvedPeers,
  invite, cancelInvite, removeRemote, afterRename, dropAll, leaveMirror, accept, decline, dropMirrorIfEmpty, sendState,
  onMessage, onEdit, onDelete, onReact, onTyping, onPin, onStatus, treeIds, chatAvatarFile, handle, handleReq, sendCaps, onLink,
  watch, unwatch, onUserStatus, touch, membersChanged,
  pendingFor, inviteInfo,
};
