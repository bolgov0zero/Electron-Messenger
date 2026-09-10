'use strict';
// ── СЧЁТЧИКИ НЕПРОЧИТАННОГО ──
//
// Раньше «сколько непрочитанного» считалось перебором всей переписки: для каждого
// сообщения проверялось, есть ли для него строка в message_status с отметкой о
// прочтении. Расход рос вместе с историей — на 60 000 сообщений один подсчёт по
// всем чатам занимал 15 мс, а он делается на каждое отправленное сообщение для
// каждого получателя.
//
// Теперь на каждую пару «человек — чат» хранится одна отметка: докуда прочитано.
// Непрочитанное — это сообщения новее её, то есть короткий хвост, а не вся
// история. Взяли именно отметку, а не изменяемый счётчик: счётчик пришлось бы
// править в десятке мест и он неизбежно разошёлся бы с действительностью, а
// отметка остаётся производной от данных и разойтись не может.
//
// Отметка корректна потому, что чат читается целиком: обработчик 'read'
// помечает все непрочитанные сообщения чата разом, поэтому непрочитанное всегда
// идёт непрерывным хвостом в конце.
//
// message_status остаётся как был — по нему рисуются галочки доставки и
// прочтения у отправителя, и это другая задача.

const db = require('./db');

const stmt = {
  inChat: db.prepare(`
    SELECT COUNT(*) AS c FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)`),

  mentionsInChat: db.prepare(`
    SELECT COUNT(*) AS c FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)
      AND m.mentions IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?)`),

  firstUnread: db.prepare(`
    SELECT MIN(m.id) AS id FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)`),

  // Чаты человека — итог собираем суммой по ним
  myChats: db.prepare(`SELECT chat_id FROM chat_members WHERE user_id = ? AND hidden_at IS NULL`),

  // Прочитано всё, что сейчас есть в чате
  mark: db.prepare(`
    INSERT INTO chat_read_state (user_id, chat_id, last_read_id)
    VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM messages WHERE chat_id = ?))
    ON CONFLICT(user_id, chat_id) DO UPDATE SET
      last_read_id = MAX(last_read_id, excluded.last_read_id)`),
};

/** Непрочитанных в чате */
function inChat(userId, chatId) {
  return stmt.inChat.get(chatId, userId, userId, chatId).c;
}

/** Непрочитанных упоминаний в чате */
function mentionsInChat(userId, chatId) {
  return stmt.mentionsInChat.get(chatId, userId, userId, chatId, userId).c;
}

/** Сумма по нескольким чатам — комната считает своими темами */
function inChats(userId, chatIds) {
  return chatIds.reduce((sum, id) => sum + inChat(userId, id), 0);
}

/** Сумма упоминаний по нескольким чатам */
function mentionsInChats(userId, chatIds) {
  return chatIds.reduce((sum, id) => sum + mentionsInChat(userId, id), 0);
}

/** Первое непрочитанное сообщение чата — на нём открывается лента */
function firstUnreadId(userId, chatId) {
  return stmt.firstUnread.get(chatId, userId, userId, chatId).id || null;
}

/** Непрочитанных во всех чатах — число на значке приложения.
 *  Считаем суммой по чатам, а не одним запросом со связыванием: один чат теперь
 *  стоит доли микросекунды (упор в индекс по хвосту), а общий запрос вынужден
 *  просматривать все сообщения — на 60 000 он занимал 18 мс против 0,06 суммой. */
function total(userId) {
  return stmt.myChats.all(userId).reduce((sum, r) => sum + inChat(userId, r.chat_id), 0);
}

/** Отметить чат прочитанным до последнего сообщения */
function markRead(userId, chatId) {
  stmt.mark.run(userId, chatId, chatId);
}

module.exports = {
  inChat, mentionsInChat, inChats, mentionsInChats,
  firstUnreadId, total, markRead,
};
