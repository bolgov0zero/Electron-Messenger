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

const dal = require('./dal');

const SQL = {
  inChat: `
    SELECT COUNT(*) AS c FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)`,

  mentionsInChat: `
    SELECT COUNT(*) AS c FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)
      AND m.mentions IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?)`,

  firstUnread: `
    SELECT MIN(m.id) AS id FROM messages m
    WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0
      AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state
        WHERE user_id = ? AND chat_id = ?), 0)`,

  // Чаты человека — итог собираем суммой по ним
  myChats: `SELECT chat_id FROM chat_members WHERE user_id = ? AND hidden_at IS NULL`,

  // Прочитано всё, что сейчас есть в чате
  mark: `
    INSERT INTO chat_read_state (user_id, chat_id, last_read_id)
    VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM messages WHERE chat_id = ?))
    ON CONFLICT(user_id, chat_id) DO UPDATE SET
      last_read_id = MAX(last_read_id, excluded.last_read_id)`,
};

/** Непрочитанных в чате */
async function inChat(userId, chatId) {
  return (await dal.get(SQL.inChat, chatId, userId, userId, chatId)).c;
}

/** Непрочитанных упоминаний в чате */
async function mentionsInChat(userId, chatId) {
  return (await dal.get(SQL.mentionsInChat, chatId, userId, userId, chatId, userId)).c;
}

/** Сумма по нескольким чатам — комната считает своими темами */
async function inChats(userId, chatIds) {
  let sum = 0;
  for (const id of chatIds) sum += await inChat(userId, id);
  return sum;
}

/** Сумма упоминаний по нескольким чатам */
async function mentionsInChats(userId, chatIds) {
  let sum = 0;
  for (const id of chatIds) sum += await mentionsInChat(userId, id);
  return sum;
}

/** Первое непрочитанное сообщение чата — на нём открывается лента */
async function firstUnreadId(userId, chatId) {
  return (await dal.get(SQL.firstUnread, chatId, userId, userId, chatId)).id || null;
}

/** Непрочитанных во всех чатах — число на значке приложения.
 *  Считаем суммой по чатам, а не одним запросом со связыванием: один чат теперь
 *  стоит доли микросекунды (упор в индекс по хвосту), а общий запрос вынужден
 *  просматривать все сообщения — на 60 000 он занимал 18 мс против 0,06 суммой. */
async function total(userId) {
  let sum = 0;
  for (const r of await dal.all(SQL.myChats, userId)) sum += await inChat(userId, r.chat_id);
  return sum;
}

/** Отметить чат прочитанным до последнего сообщения */
async function markRead(userId, chatId) {
  await dal.run(SQL.mark, userId, chatId, chatId);
}

module.exports = {
  inChat, mentionsInChat, inChats, mentionsInChats,
  firstUnreadId, total, markRead,
};
