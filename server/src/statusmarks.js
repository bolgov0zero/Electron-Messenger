'use strict';
// ── ДОСТАВКА И ПРОЧТЕНИЕ: ОТМЕТКИ И ЖУРНАЛ ВРЕМЕНИ ──
//
// Раньше на каждое сообщение и каждого получателя была строка в message_status: в группе из
// 200 человек одно сообщение давало 200 строк, и статусы по размеру обгоняли сами сообщения.
//
// Теперь на пару «человек — чат» хранятся две отметки в chat_read_state:
//   delivered_id — до какого сообщения доставлено,
//   last_read_id — до какого прочитано (её же использует unread.js).
// Галочки считаются по ним как в Telegram: прочитал более позднее — прочитал и раннее
// (msgstatus.js). Факт «доставлено/прочитано» хранится без срока.
//
// Точное время нужно только окну «кто и когда прочитал», и хранится оно отдельно — в журнале
// status_log за «окно времени статуса» (настройка status_window_days, по умолчанию 7 дней,
// 0 — не хранить). Запись журнала — это «человек U в чате C получил/прочитал до сообщения N
// в момент T», а не строка на сообщение; события одного вида за минуту сливаются в одну запись,
// поэтому время точно до минуты и никогда не раньше отправки. Время сообщения M — это самое
// раннее событие с upto_id >= M.
//
// Журнал ведётся только для чатов до MAX_LOG_CHAT участников (в больших список прочитавших
// и так бессмыслен), а время показывается лишь для сообщений новее границы полноты журнала:
// иначе после очистки подставилось бы время более позднего события.

const dal = require('./dal');

const MAX_LOG_CHAT = 100;
const DEFAULT_DAYS = 7;
const CHUNK = 400;   // строк в одном INSERT … VALUES

// Окно и граница полноты журнала читаются из настроек не чаще раза в полминуты
let cache = { t: 0, days: DEFAULT_DAYS, from: 0 };
async function config() {
  if (Date.now() - cache.t < 30000) return cache;
  const rows = await dal.all("SELECT key, value FROM settings WHERE key IN ('status_window_days', 'status_log_from')");
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const d = Number(m.status_window_days);
  cache = { t: Date.now(), days: m.status_window_days !== undefined && Number.isFinite(d) && d >= 0 ? Math.floor(d) : DEFAULT_DAYS, from: Number(m.status_log_from) || 0 };
  return cache;
}
const nowSec = () => Math.floor(Date.now() / 1000);

async function chatSize(chatId) {
  return (await dal.get('SELECT COUNT(*) AS c FROM chat_members WHERE chat_id = ?', chatId)).c;
}

// Писать ли журнал для этого чата (size — число участников, если уже известно)
async function logOn(chatId, size) {
  const c = await config();
  if (c.days <= 0) return false;
  return (size == null ? await chatSize(chatId) : size) <= MAX_LOG_CHAT;
}

async function upsertMarks(rows, col) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const params = part.flatMap(r => [r.user_id, r.chat_id, r.upto]);
    const ph = part.map(() => '(?, ?, ?)').join(', ');
    await dal.run(`INSERT INTO chat_read_state (user_id, chat_id, ${col}) VALUES ${ph}
      ON CONFLICT(user_id, chat_id) DO UPDATE SET ${col} = MAX(chat_read_state.${col}, excluded.${col})`, ...params);
  }
}

async function upsertLog(rows) {
  const now = nowSec(), bucket = Math.floor(now / 60);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const params = part.flatMap(r => [r.chat_id, r.user_id, r.kind, bucket, r.upto, now]);
    const ph = part.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    await dal.run(`INSERT INTO status_log (chat_id, user_id, kind, bucket, upto_id, ts) VALUES ${ph}
      ON CONFLICT(chat_id, user_id, kind, bucket) DO UPDATE SET upto_id = MAX(status_log.upto_id, excluded.upto_id), ts = excluded.ts`, ...params);
  }
}

/** Сообщения чата до upto доставлены этим людям. size — число участников чата, если уже известно */
async function delivered(chatId, userIds, upto, size) {
  if (!userIds.length || !upto) return;
  await upsertMarks(userIds.map(user_id => ({ user_id, chat_id: chatId, upto })), 'delivered_id');
  if (await logOn(chatId, size)) await upsertLog(userIds.map(user_id => ({ chat_id: chatId, user_id, kind: 'd', upto })));
}

/** Человек прочитал чат до сообщения upto (прочитанное считается и доставленным) */
async function read(userId, chatId, upto, size) {
  if (!upto) return;
  await upsertMarks([{ user_id: userId, chat_id: chatId, upto }], 'last_read_id');
  await upsertMarks([{ user_id: userId, chat_id: chatId, upto }], 'delivered_id');
  if (await logOn(chatId, size)) await upsertLog([{ chat_id: chatId, user_id: userId, kind: 'r', upto }, { chat_id: chatId, user_id: userId, kind: 'd', upto }]);
}

/** Отметки человека в чате: { r, d } (доставлено не меньше прочитанного) */
async function marksOf(userId, chatId) {
  const s = await dal.get('SELECT last_read_id AS r, delivered_id AS d FROM chat_read_state WHERE user_id = ? AND chat_id = ?', userId, chatId);
  const r = s?.r || 0;
  return { r, d: Math.max(s?.d || 0, r) };
}

/** Время доставки и прочтения сообщения: Map(user_id → { d, r }), пусто, если журнал сообщение не покрывает */
async function timesFor(chatId, msg) {
  const c = await config();
  const out = new Map();
  if (c.days <= 0 || msg.sent_at < Math.max(nowSec() - c.days * 86400, c.from)) return out;
  const rows = await dal.all('SELECT user_id, kind, MIN(ts) AS ts FROM status_log WHERE chat_id = ? AND upto_id >= ? GROUP BY user_id, kind', chatId, msg.id);
  for (const r of rows) {
    const o = out.get(r.user_id) || { d: null, r: null };
    o[r.kind] = r.ts;
    out.set(r.user_id, o);
  }
  return out;
}

/** Убрать записи старше окна и сдвинуть границу полноты журнала */
async function prune() {
  const c = await config();
  const cutoff = nowSec() - c.days * 86400;
  await dal.run('DELETE FROM status_log WHERE ts < ?', cutoff);
  if (cutoff > c.from) {
    await dal.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('status_log_from', ?)", String(cutoff));
    cache.t = 0;
  }
}

/** Окно поменяли в настройках. Пока журнал не писался (окно было или стало нулём), полным он быть не мог */
async function windowChanged(prevDays, nextDays) {
  if (prevDays === 0 || nextDays === 0) await dal.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('status_log_from', ?)", String(nowSec()));
  cache.t = 0;
  await prune();
}

function start() {
  prune().catch(e => console.error('[status] очистка журнала не удалась:', e.message));
  setInterval(() => prune().catch(e => console.error('[status] очистка журнала не удалась:', e.message)), 24 * 3600000).unref();
}

module.exports = { delivered, read, marksOf, timesFor, prune, windowChanged, start, DEFAULT_DAYS, MAX_LOG_CHAT };
