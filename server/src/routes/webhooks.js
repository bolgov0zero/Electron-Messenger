const router = require('express').Router();
const db = require('../db');
const { broadcast, getMessageWithStatus } = require('../ws');

// Rate limit: 30 messages per minute per token
const _rateLimits = new Map();
function checkRateLimit(token) {
  const now = Date.now();
  const times = (_rateLimits.get(token) || []).filter(t => now - t < 60_000);
  if (times.length >= 30) return false;
  times.push(now);
  _rateLimits.set(token, times);
  return true;
}

// Whitelist sanitizer: allows only b, i, u, blockquote, br
function sanitizeHtml(input) {
  const allowed = new Set(['b', 'i', 'u', 'blockquote', 'br']);
  return String(input || '').slice(0, 4096)
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (_, slash, tag) => {
      const t = tag.toLowerCase();
      if (!allowed.has(t)) return '';
      if (t === 'br') return '<br>';
      return slash ? `</${t}>` : `<${t}>`;
    });
}

async function handleWebhook(req, res) {
  const { token } = req.params;
  const rawText = req.method === 'GET' ? req.query.text : req.body?.text;
  if (!rawText) return res.status(400).json({ ok: false, error: 'missing text' });

  const wh = db.prepare(`
    SELECT w.id, w.user_id, w.chat_id FROM webhooks w WHERE w.token = ?
  `).get(token);
  if (!wh) return res.status(404).json({ ok: false, error: 'invalid token' });

  const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(wh.chat_id);
  if (!chat) return res.status(410).json({ ok: false, error: 'chat not found' });

  if (!checkRateLimit(token)) return res.status(429).json({ ok: false, error: 'rate limit exceeded' });

  const text = sanitizeHtml(rawText);
  if (!text.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ ok: false, error: 'empty text after sanitization' });

  const result = db.prepare('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)').run(wh.chat_id, wh.user_id, text);
  const msg = getMessageWithStatus(result.lastInsertRowid, null);
  broadcast(wh.chat_id, { type: 'message', message: msg });

  // Push notifications
  try {
    const { sendPushToUser } = require('./push');
    const chatRow = db.prepare('SELECT type, name FROM chats WHERE id = ?').get(wh.chat_id);
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').all(wh.chat_id, wh.user_id);
    const stmtUnread = db.prepare(`
      SELECT COUNT(*) AS c FROM messages m
      JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
      LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
      WHERE m.sender_id IS NOT ? AND m.deleted = 0 AND ms.read_at IS NULL
    `);
    members.forEach(({ user_id }) => {
      const unread = stmtUnread.get(user_id, user_id, user_id).c;
      sendPushToUser(user_id, {
        title: chatRow?.name || msg.sender_name,
        body: msg.text.replace(/<[^>]*>/g, '') || '',
        chatId: wh.chat_id,
        unread,
      });
    });
  } catch {}

  res.json({ ok: true, message_id: Number(result.lastInsertRowid) });
}

router.post('/:token', handleWebhook);
router.get('/:token', handleWebhook);

module.exports = router;
