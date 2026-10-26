'use strict';
// ── УВЕДОМЛЕНИЯ «ELECTRON» ──
//
// У каждого человека есть служебный чат с системой «Electron» (скрытый пользователь с логотипом проекта). Это личный чат только для
// чтения (chats.read_only), в админке он не виден (chats.system_kind). Сюда приходят уведомления; пока одно: вход с нового устройства,
// с кнопкой «Заблокировать». Если человек удалил чат, он скрыт только у него: следующее уведомление вернёт его (так же, как возвращается
// любой скрытый личный чат). Хранятся последние KEEP уведомлений.

const fs = require('fs');
const path = require('path');
const dal = require('./dal');

const BOT_USERNAME = '__electron__';
const KIND = 'electron';
const KEEP = 50;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const AVATAR_DIR = path.join(path.dirname(DB_PATH), 'avatar');
const LOGO = path.join(__dirname, 'public', 'chat', 'icons', 'icon-512.png');

let botCache = null;
// Пользователь «Electron»: скрытый (is_bot = 1, как у системного пользователя объявлений); логотип лежит как его аватарка
async function botId() {
  if (botCache) return botCache;
  let u = await dal.get('SELECT id FROM users WHERE username = ?', BOT_USERNAME);
  if (!u) {
    await dal.run("INSERT INTO users (username, password_hash, display_name, is_bot) VALUES (?, '', 'Electron', 1)", BOT_USERNAME);
    u = await dal.get('SELECT id FROM users WHERE username = ?', BOT_USERNAME);
  }
  try {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const file = path.join(AVATAR_DIR, `${u.id}.jpg`);
    if (!fs.existsSync(file) && fs.existsSync(LOGO)) fs.copyFileSync(LOGO, file);
  } catch (e) { console.warn('[Electron] логотип:', e.message); }
  botCache = u.id;
  return botCache;
}

// Служебный чат человека: находим или создаём; скрытый возвращаем в список
async function chatOf(userId) {
  const bot = await botId();
  let c = await dal.get("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.system_kind = ?", userId, KIND);
  if (!c) {
    const id = await dal.tx(async () => {
      await dal.lock('electron-chat:' + userId);
      const again = await dal.get("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.system_kind = ?", userId, KIND);
      if (again) return again.id;
      const r = await dal.run("INSERT INTO chats (type, created_by, read_only, system_kind) VALUES ('direct', ?, 1, ?)", bot, KIND);
      await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', r.lastInsertRowid, userId);
      await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', r.lastInsertRowid, bot);
      return r.lastInsertRowid;
    });
    c = { id };
  }
  const hidden = await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ? AND hidden_at IS NOT NULL', c.id, userId);
  if (hidden) {
    await dal.run('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND user_id = ?', c.id, userId);
    try { require('./ws').sendTo(userId, { type: 'reload_chats' }); } catch {}
  }
  return c.id;
}

// Сообщение от «Electron» в служебный чат человека: рассылка по соединениям и push, как у любого сообщения
async function post(userId, text, actions) {
  const bot = await botId(), chatId = await chatOf(userId);
  const r = await dal.run('INSERT INTO messages (chat_id, sender_id, text, actions) VALUES (?, ?, ?, ?)', chatId, bot, text, actions ? JSON.stringify(actions) : null);
  await dal.run('DELETE FROM messages WHERE chat_id = ? AND id NOT IN (SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?)', chatId, chatId, KEEP);
  await require('./ws').finishMessage(r.lastInsertRowid, chatId, bot, null);
  return r.lastInsertRowid;
}

// Вход с нового устройства: уведомление тем устройствам, где человек уже вошёл. У человека одно устройство (только что вошедшее) — ничего не пишем
async function newDevice(userId, dev, ip) {
  const others = await dal.get("SELECT 1 FROM device_keys WHERE user_id = ? AND kind = 'device' AND id != ? AND revoked_at IS NULL LIMIT 1", userId, dev.id);
  if (!others) return;
  const text = `Вход с нового устройства\nУстройство: ${dev.name}\nIP-адрес: ${ip || 'неизвестен'}\nЕсли это были не вы, заблокируйте устройство.`;
  await post(userId, text, [{ id: 'block_device', label: 'Заблокировать', device: dev.id, state: 'new' }]);
}

// Устройство заблокировано: кнопка в его уведомлениях меняется на «Заблокировано», у всех устройств человека сразу
async function markBlocked(userId, deviceId) {
  const bot = await botId();
  const chat = await dal.get("SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.system_kind = ?", userId, KIND);
  if (!chat) return;
  const ws = require('./ws');
  for (const m of await dal.all('SELECT id, actions FROM messages WHERE chat_id = ? AND sender_id = ? AND actions IS NOT NULL', chat.id, bot)) {
    let a; try { a = JSON.parse(m.actions); } catch { continue; }
    if (!Array.isArray(a) || !a.some(x => x.device === deviceId && x.state !== 'done')) continue;
    a.forEach(x => { if (x.device === deviceId) x.state = 'done'; });
    await dal.run('UPDATE messages SET actions = ? WHERE id = ?', JSON.stringify(a), m.id);
    const updated = await ws.getMessageWithStatus(m.id, null);
    if (updated) await ws.broadcast(chat.id, { type: 'message_edited', message: updated });
  }
}

// Копия ключа обнаружена, устройство отозвано (devices.js): человеку сообщение без кнопки
async function deviceReuse(userId, name) {
  await post(userId, `Устройство «${name}» заблокировано: его ключ входа был использован повторно, возможно, у кого-то есть копия. Войти с него можно только по паролю. Если это не вы пытались войти, смените пароль.`, null);
}

module.exports = { botId, chatOf, post, newDevice, markBlocked, deviceReuse, KIND };
