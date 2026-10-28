'use strict';
// ── ГОСТЕВЫЕ ССЫЛКИ ──
//
// Хозяин группы или администратор создаёт ссылку на время: по ней человек без учётной записи входит в одну
// группу или комнату, пишет и отвечает. Гость — пользователь с is_bot = 3 (в списках людей его нет). Правила:
//   · одна ссылка — один гость; ссылку можно открывать много раз, но только с устройства первого входа
//     (ключ устройства хранится в браузере гостя, в базе его хеш);
//   · гость видит сообщения только после подключения (base_msg_id — наибольший номер сообщения чата на тот
//     момент); всё, что приходит и читается, проходит через этот порог;
//   · при подключении и отключении в чат пишется системное сообщение;
//   · по истечении срока или при отзыве доступ закрывается полностью (членство и сессия снимаются).
// В базе хранится только хеш токена: показать ссылку повторно нельзя, только создать новую.

const crypto = require('crypto');
const dal = require('./dal');

const IS_GUEST = 3;                         // значение users.is_bot у гостя
const TAG = 'Гость';
const MIN_TTL = 10 * 60, MAX_TTL = 30 * 24 * 3600;
const TOKEN_TTL = MAX_TTL;                  // токен гостя живёт долго: срок доступа проверяется по ссылке при каждом запросе, так продление не требует нового входа
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

// Действующие гости в памяти: userId → { chatId, base, linkId }. Нужны синхронно при рассылке и чтении
const active = new Map();
const isGuest = userId => active.has(userId);
const floorOf = userId => (active.get(userId)?.base) || 0;
const chatOf = userId => active.get(userId)?.chatId || 0;

async function load() {
  active.clear();
  for (const r of await dal.all('SELECT id, guest_user_id, chat_id, base_msg_id FROM guest_links WHERE guest_user_id IS NOT NULL AND ended_at IS NULL AND revoked_at IS NULL'))
    active.set(r.guest_user_id, { chatId: r.chat_id, base: r.base_msg_id, linkId: r.id });
}

// Что гость может получить в событии. null — не отправлять. Сообщения до подключения (порог base) не отдаются
// ни в каком виде: ни правка старого сообщения, ни реакция на него, ни цитата
function forRecipient(userId, payload) {
  const g = active.get(userId);
  if (!g) return payload;
  const mid = payload.message ? payload.message.id : payload.message_id;
  if (mid && mid <= g.base) return null;
  if (payload.type === 'pins_updated' && Array.isArray(payload.pins)) return { ...payload, pins: payload.pins.filter(p => p.message_id > g.base) };
  if (payload.message) {
    let m = scrub(payload.message);
    if (m.reply_to_id && m.reply_to_id <= g.base) m = hideQuote(m);
    return { ...payload, message: m };
  }
  return payload;
}
// Логины людей гостю не нужны: только имя. Системный отправитель остаётся, по нему клиент узнаёт служебные сообщения
function scrub(m) {
  return m.sender_username && m.sender_username !== '__system__' ? { ...m, sender_username: '' } : m;
}
// Цитата сообщения, написанного до подключения гостя: текст и автор скрываются
function hideQuote(m) {
  return { ...m, reply_text: null, reply_attachment: null, reply_sender_name: '', reply_sender_id: null, reply_sender_tag: null, reply_sender_is_bot: 0, reply_hidden: true };
}
function sanitizeRows(userId, rows) {
  const base = floorOf(userId);
  if (!base && !isGuest(userId)) return rows;
  return rows.map(m => { const x = scrub(m); return x.reply_to_id && x.reply_to_id <= base ? hideQuote(x) : x; });
}

// Комната с темами: писать можно только в темы, самой комнаты в ленте нет. Гость входит в комнату и во все её темы сразу
const topicIds = async roomId => (await dal.all('SELECT id FROM chats WHERE parent_id = ? ORDER BY position, id', roomId)).map(r => r.id);
const hasTopics = async roomId => !!(await dal.get('SELECT 1 FROM chats WHERE parent_id = ? LIMIT 1', roomId));

// Можно ли такому чату выдавать гостевые ссылки: группа или комната на этом сервере, не тема и не секретный чат
async function checkChat(chatId) {
  const c = await dal.get('SELECT id, type, name, parent_id, is_secret, fed_instance FROM chats WHERE id = ?', chatId);
  if (!c || (c.type !== 'group' && c.type !== 'room')) return { error: 'Гостевая ссылка возможна только для группы или комнаты' };
  if (c.parent_id) return { error: 'Ссылку создают для комнаты целиком, не для темы' };
  if (c.is_secret) return { error: 'Для секретного чата ссылки не выдаются' };
  if (c.fed_instance) return { error: 'Группа находится на другом сервере: ссылку создаёт её владелец' };
  return { chat: c };
}

async function create(chat, creatorId, ttlSec) {
  const ttl = Math.floor(Number(ttlSec));
  if (!(ttl >= MIN_TTL && ttl <= MAX_TTL)) throw new Error('Срок ссылки от 10 минут до 30 суток');
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = now() + ttl;
  const r = await dal.run('INSERT INTO guest_links (chat_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?)', chat.id, sha(token), creatorId, expires);
  return { id: r.lastInsertRowid, token, expires_at: expires };
}

const state = r => (r.revoked_at ? 'revoked' : r.ended_at || r.expires_at <= now() ? 'expired' : r.guest_user_id ? 'active' : 'pending');
async function list(chatId) {
  const rows = await dal.all(`
    SELECT g.id, g.created_at, g.expires_at, g.revoked_at, g.ended_at, g.guest_user_id, g.guest_name, g.device_hash, g.first_used_at, g.last_used_at,
      COALESCE(cu.display_name, '') AS created_by_name
    FROM guest_links g LEFT JOIN users cu ON cu.id = g.created_by
    WHERE g.chat_id = ? ORDER BY g.id DESC LIMIT 100`, chatId);
  return rows.map(r => ({ id: r.id, state: state(r), created_at: r.created_at, expires_at: r.expires_at, created_by_name: r.created_by_name,
    guest_name: r.guest_name || null, first_used_at: r.first_used_at, last_used_at: r.last_used_at, bound: !!r.device_hash }));
}

function cleanName(v) {
  const n = String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= 60 ? n : null;
}

// Сведения о ссылке для страницы гостя: название чата, срок, занята ли (без входа и без имени)
async function peek(token) {
  const r = await dal.get('SELECT g.*, c.name AS chat_name FROM guest_links g JOIN chats c ON c.id = g.chat_id WHERE g.token_hash = ?', sha(token));
  if (!r) return { status: 404, code: 'not_found' };
  const st = state(r);
  if (st === 'revoked' || st === 'expired') return { status: 410, code: st };
  return { status: 200, chat_name: r.chat_name, expires_at: r.expires_at, claimed: st === 'active' };
}

// Вход по ссылке. dk — ключ устройства из браузера гостя; name — имя при первом входе.
// Возвращает { status, code } при отказе или { status: 200, user, link, device_key, expires_at }
async function open(token, name, dk) {
  const row = await dal.get('SELECT * FROM guest_links WHERE token_hash = ?', sha(token));
  if (!row) return { status: 404, code: 'not_found' };
  const st = state(row);
  if (st === 'revoked' || st === 'expired') return { status: 410, code: st };
  const t = now();

  if (row.guest_user_id) {
    // Ссылка уже занята: войти можно только с устройства первого входа (или после сброса привязки администратором)
    let key = String(dk || '');
    if (row.device_hash) {
      const a = Buffer.from(sha(key), 'hex'), b = Buffer.from(row.device_hash, 'hex');
      if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { status: 403, code: 'other_device' };
    } else {
      key = crypto.randomBytes(24).toString('hex');
      await dal.run('UPDATE guest_links SET device_hash = ? WHERE id = ? AND device_hash IS NULL', sha(key), row.id);
    }
    await dal.run('UPDATE guest_links SET last_used_at = ? WHERE id = ?', t, row.id);
    const u = await dal.get('SELECT id, username, display_name, tag FROM users WHERE id = ?', row.guest_user_id);
    if (!u) return { status: 410, code: 'expired' };
    return { status: 200, user: u, link: row, device_key: key, expires_at: row.expires_at };
  }

  const nm = cleanName(name);
  if (!nm) return { status: 400, code: 'name_required' };
  const chk = await checkChat(row.chat_id);
  if (chk.error) return { status: 410, code: 'expired' };
  const key = crypto.randomBytes(24).toString('hex');
  let user = null;
  const claimed = await dal.tx(async () => {
    await dal.lock('guest:' + row.id);
    const cur = await dal.get('SELECT guest_user_id FROM guest_links WHERE id = ?', row.id);
    if (cur.guest_user_id) return false;      // кто-то открыл ссылку одновременно с нами
    // Номера сообщений общие для всех чатов, поэтому один порог действует и в темах комнаты
    const tids = await topicIds(row.chat_id), all = [row.chat_id, ...tids];
    const base = (await dal.get(`SELECT COALESCE(MAX(id), 0) AS m FROM messages WHERE chat_id IN (${all.map(() => '?').join(',')})`, ...all)).m;
    const uname = 'guest_' + crypto.randomBytes(6).toString('hex');
    const ur = await dal.run("INSERT INTO users (username, password_hash, display_name, is_bot, tag) VALUES (?, '*', ?, ?, ?)", uname, nm, IS_GUEST, TAG);
    for (const cid of all) {
      await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', cid, ur.lastInsertRowid);
      // Прочитано до порога: счётчики непрочитанного в темах не считают сообщения, которых гость не видит
      if (tids.length) await dal.run('INSERT INTO chat_read_state (user_id, chat_id, last_read_id) VALUES (?, ?, ?)', ur.lastInsertRowid, cid, base);
    }
    await dal.run('UPDATE guest_links SET guest_user_id = ?, guest_name = ?, device_hash = ?, base_msg_id = ?, first_used_at = ?, last_used_at = ? WHERE id = ?',
      ur.lastInsertRowid, nm, sha(key), base, t, t, row.id);
    user = { id: ur.lastInsertRowid, username: uname, display_name: nm, tag: TAG };
    active.set(user.id, { chatId: row.chat_id, base, linkId: row.id });
    return true;
  });
  if (!claimed) return { status: 403, code: 'other_device' };
  if (!(await hasTopics(row.chat_id))) await sys(row.chat_id, `${nm} подключился(ась)`, 'guest_join');   // в ленте комнаты с темами записи не видно
  try { require('./ws').broadcast(row.chat_id, { type: 'reload_chats' }); } catch {}   // у участников обновится состав
  return { status: 200, user, link: { ...row, guest_user_id: user.id }, device_key: key, expires_at: row.expires_at };
}

async function sys(chatId, text, kind) {
  try { await require('./announcements').sendSystemMessage(chatId, text, kind); }
  catch (e) { console.warn('[Гость] системное сообщение:', e.message); }
}

// Закрыть доступ гостя: снять членство и сессию, написать «отключился», разорвать соединения.
// revoke — отзыв вручную, иначе истёк срок. Закрытая ссылка не нужна: запись о ней удаляется сразу, в базе ничего не остаётся
async function end(row, revoke) {
  const t = now();
  if (row.ended_at || row.revoked_at) return false;
  const claim = await dal.run('UPDATE guest_links SET ended_at = ? WHERE id = ? AND ended_at IS NULL', t, row.id);
  if (!claim.changes) return false;          // другой вызов уже закрывает эту ссылку
  if (!row.guest_user_id) { await dal.run('DELETE FROM guest_links WHERE id = ?', row.id); return true; }
  const uid = row.guest_user_id;
  await dal.run('DELETE FROM chat_members WHERE user_id = ?', uid);
  active.delete(uid);
  const ws = require('./ws');
  ws.sendTo(uid, { type: 'guest_ended', reason: revoke ? 'revoked' : 'expired' });
  ws.kick(uid);
  if (!(await hasTopics(row.chat_id))) await sys(row.chat_id, `${row.guest_name || 'Гость'} отключился(ась)`, 'guest_leave');
  // Учётная запись гостя удаляется целиком; у его сообщений остаются имя и метка (sender_id обнуляется, как у удалённого аккаунта)
  const u = await dal.get('SELECT display_name FROM users WHERE id = ?', uid);
  await dal.tx(async () => {
    await dal.run('UPDATE messages SET guest_name = ?, guest_tag = ?, sender_id = NULL WHERE sender_id = ?', u?.display_name || row.guest_name || 'Гость', TAG, uid);
    await dal.run('DELETE FROM chat_read_state WHERE user_id = ?', uid);
    await dal.run('DELETE FROM users WHERE id = ?', uid);
    await dal.run('DELETE FROM guest_links WHERE id = ?', row.id);
  });
  try { require('./ws').broadcast(row.chat_id, { type: 'reload_chats' }); } catch {}
  return true;
}

async function revoke(linkId, chatId) {
  const row = await dal.get('SELECT * FROM guest_links WHERE id = ? AND chat_id = ?', linkId, chatId);
  if (!row) return false;
  if (row.revoked_at || row.ended_at) { await dal.run('DELETE FROM guest_links WHERE id = ?', row.id); return true; }
  await end(row, true);
  return true;
}
// Продлить действующую ссылку: срок считается от текущего конца (не больше 30 суток от сегодня). Гость узнаёт сразу
async function extend(linkId, chatId, addSec) {
  const add = Math.floor(Number(addSec));
  if (!(add >= MIN_TTL && add <= MAX_TTL)) return { error: 'Продление от 10 минут до 30 суток' };
  const row = await dal.get('SELECT * FROM guest_links WHERE id = ? AND chat_id = ?', linkId, chatId);
  if (!row) return { error: 'Ссылка не найдена', status: 404 };
  const t = now();
  if (row.revoked_at || row.ended_at || row.expires_at <= t) return { error: 'Ссылка уже закрыта: создайте новую' };
  const exp = Math.min(row.expires_at + add, t + MAX_TTL);
  await dal.run('UPDATE guest_links SET expires_at = ? WHERE id = ? AND ended_at IS NULL', exp, row.id);
  if (row.guest_user_id) { try { require('./ws').sendTo(row.guest_user_id, { type: 'guest_extended', expires_at: exp }); } catch {} }
  return { expires_at: exp };
}
// Разрешить вход с нового устройства: следующий, кто откроет ссылку, станет её владельцем
async function resetDevice(linkId, chatId) {
  const r = await dal.run('UPDATE guest_links SET device_hash = NULL WHERE id = ? AND chat_id = ? AND guest_user_id IS NOT NULL AND ended_at IS NULL AND revoked_at IS NULL', linkId, chatId);
  return r.changes > 0;
}

// Закрыть всё, у чего вышел срок. Раз в полминуты и при старте (в том числе то, что истекло, пока сервер не работал)
async function expireDue() {
  await dal.run('DELETE FROM guest_links WHERE ended_at IS NOT NULL OR revoked_at IS NOT NULL');   // закрытые прежними версиями
  const rows = await dal.all('SELECT * FROM guest_links WHERE ended_at IS NULL AND revoked_at IS NULL AND expires_at <= ?', now());
  for (const r of rows) { try { await end(r, false); } catch (e) { console.warn('[Гость] закрытие ссылки:', e.message); } }
}
let timer = null;
function startScheduler() {
  load().then(expireDue).catch(e => console.warn('[Гость] запуск:', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => expireDue().catch(e => console.warn('[Гость] срок:', e.message)), Number(process.env.GUEST_TICK_MS) || 30_000);
  timer.unref();
}

// Что гость может вызывать по HTTP: всё остальное закрыто (запрет по умолчанию)
const ALLOW = [
  ['GET', /^\/api\/guest\/(me|chat)$/],
  ['GET', /^\/api\/chats\/\d+\/topics$/],
  ['GET', /^\/api\/messages\/chat\/\d+$/],
  ['GET', /^\/api\/messages\/\d+\/reactions$/],
  ['GET', /^\/api\/upload\/settings$/],
  ['POST', /^\/api\/upload\/?$/],
  ['DELETE', /^\/api\/upload\/?$/],
];
const httpAllowed = req => { const p = req.originalUrl.split('?')[0]; return ALLOW.some(([m, re]) => m === req.method && re.test(p)); };
// Что гость может присылать по WebSocket
const WS_ALLOW = new Set(['message', 'edit_message', 'delete_message', 'react', 'typing', 'read', 'delivered', 'ping', 'set_status', 'client_info']);

module.exports = { hasTopics, IS_GUEST, TOKEN_TTL, load, isGuest, floorOf, chatOf, forRecipient, sanitizeRows, hideQuote, checkChat, create, list, peek, open, revoke, extend, resetDevice, end, expireDue, startScheduler, httpAllowed, WS_ALLOW, cleanName };
