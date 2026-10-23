// Галочки доставки и прочтения. Считаются «как в Telegram»: прочитал более позднее сообщение чата — значит, прочитал и все
// предыдущие. Поэтому у соседних сообщений не бывает разного статуса. Получатели — нынешние участники чата, кроме автора;
// гость в получатели сообщений до его входа не входит (их он не видел)
const dal = require('./dal');

// До какого сообщения чата каждый участник доставил (d) и прочитал (r): отметки из chat_read_state
// (см. statusmarks.js). Прочитанное считается и доставленным
async function marks(chatId) {
  return dal.all(`
    SELECT cm.user_id, u.is_bot, COALESCE(s.last_read_id, 0) AS r,
      MAX(COALESCE(s.delivered_id, 0), COALESCE(s.last_read_id, 0)) AS d
    FROM chat_members cm JOIN users u ON u.id = cm.user_id
    LEFT JOIN chat_read_state s ON s.user_id = cm.user_id AND s.chat_id = cm.chat_id
    WHERE cm.chat_id = ?`, chatId);
}

// msgs: [{ id, sender_id }] → Map(id → { delivered, read, total })
async function statuses(chatId, msgs) {
  const guest = require('./guest');
  const rows = (await marks(chatId)).map(r => ({ ...r, floor: r.is_bot === guest.IS_GUEST ? guest.floorOf(r.user_id) : 0 }));
  const out = new Map();
  for (const m of msgs) {
    let delivered = 0, read = 0, total = 0;
    for (const u of rows) {
      if (u.user_id === m.sender_id || u.floor >= m.id) continue;
      total++;
      if ((u.r || 0) >= m.id) { read++; delivered++; } else if ((u.d || 0) >= m.id) delivered++;
    }
    out.set(m.id, { delivered, read, total });
  }
  return out;
}

async function statusOf(chatId, msg) { return (await statuses(chatId, [msg])).get(msg.id); }

module.exports = { statuses, statusOf, marks };
