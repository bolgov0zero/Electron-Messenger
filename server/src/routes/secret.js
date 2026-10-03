// Обмен ключами для секретных (E2E) чатов. Сервер здесь никогда не видит ни
// приватный ключ, ни сам ключ чата в открытом виде — только публичные эфемерные
// ключи и уже зашифрованный «wrapped_secret». Код подтверждения, который
// связывает запрос с одобрением, передаётся собеседнику ВНЕ системы (голосом,
// лично, в другом мессенджере) — специально, чтобы даже скомпрометированный
// сервер не мог сам подделать согласие на новое устройство (см. обсуждение
// дизайна секретных чатов, [[project_secretchat_baseline]]).
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { authMiddleware } = require('../auth');
const { sendTo } = require('../ws');
const { logAudit } = require('../audit');

const CODE_TTL_SEC = 600; // 10 минут — как у challenge-токенов 2FA

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}
function genCode() {
  // 8 символов из алфавита без визуально похожих друг на друга знаков —
  // код диктуют голосом/лично, важно не путать 0/O, 1/I
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function requireSecretMember(req, res, next) {
  const chatId = Number(req.params.chatId);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat || !chat.is_secret) return res.status(404).json({ error: 'Not found' });
  if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id))
    return res.status(403).json({ error: 'Not a member' });
  req.secretChat = chat;
  next();
}

// Расшифрованное устройство создаёт код доступа для собеседника
router.post('/:chatId/grants', authMiddleware, requireSecretMember, (req, res) => {
  const chatId = Number(req.params.chatId);
  const { device_id, platform } = req.body;
  if (!device_id) return res.status(400).json({ error: 'Missing device_id' });
  if (platform !== 'electron') return res.status(403).json({ error: 'Only the desktop app can grant access' });
  const hasOwnDevice = db.prepare('SELECT 1 FROM secret_chat_devices WHERE chat_id = ? AND user_id = ? AND device_id = ?')
    .get(chatId, req.user.id, device_id);
  if (!hasOwnDevice) return res.status(403).json({ error: 'This device has no access to grant from' });
  db.prepare('DELETE FROM secret_grants WHERE chat_id = ? AND expires_at < unixepoch()').run(chatId);
  db.prepare("DELETE FROM secret_grants WHERE chat_id = ? AND granter_user_id = ? AND status = 'open'").run(chatId, req.user.id);
  const code = genCode();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL_SEC;
  const result = db.prepare(`INSERT INTO secret_grants (chat_id, granter_user_id, granter_device_id, code_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(chatId, req.user.id, device_id, hashCode(code), expiresAt);
  res.json({ grant_id: result.lastInsertRowid, code, expires_in: CODE_TTL_SEC });
});

// Собеседник вводит код на своём устройстве и передаёт свой публичный ключ.
// Дальше запрос подтверждает владелец ключа: он видит устройство и сам передаёт ключ.
router.post('/:chatId/grants/redeem', authMiddleware, requireSecretMember, (req, res) => {
  const chatId = Number(req.params.chatId);
  const { code, device_id, device_label, platform, ephemeral_pubkey } = req.body;
  if (!code || !device_id || !ephemeral_pubkey) return res.status(400).json({ error: 'Missing fields' });
  const grant = db.prepare(`SELECT * FROM secret_grants
    WHERE chat_id = ? AND code_hash = ? AND status = 'open' AND expires_at > unixepoch()`).get(chatId, hashCode(code));
  if (!grant) return res.status(404).json({ error: 'Код не найден или истёк' });
  if (grant.granter_user_id === req.user.id) return res.status(403).json({ error: 'Нельзя ввести собственный код' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;
  const requestId = db.transaction(() => {
    const r = db.prepare(`INSERT INTO secret_key_requests
      (chat_id, requester_user_id, requester_device_id, requester_device_label, requester_platform, ephemeral_pubkey, code_hash, expires_at, requester_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chatId, req.user.id, device_id, device_label || null,
      platform === 'electron' ? 'electron' : 'web', ephemeral_pubkey, grant.code_hash, grant.expires_at, ip);
    db.prepare("UPDATE secret_grants SET status = 'redeemed', request_id = ? WHERE id = ?").run(r.lastInsertRowid, grant.id);
    return r.lastInsertRowid;
  })();
  sendTo(grant.granter_user_id, {
    type: 'secret_grant_redeemed', chat_id: chatId, request_id: requestId,
    device_label: device_label || null, platform: platform === 'electron' ? 'electron' : 'web',
    ephemeral_pubkey, ip,
  });
  res.json({ request_id: requestId });
});

// Подтверждение: собеседник шлёт ключ чата, зашифрованный для эфемерного ключа
// нового устройства. Веб/мобильный клиент не может быть одобряющей стороной —
// это проверяется и на сервере, не только в интерфейсе.
router.post('/:chatId/requests/:requestId/approve', authMiddleware, requireSecretMember, (req, res) => {
  const chatId = Number(req.params.chatId);
  const requestId = Number(req.params.requestId);
  const { code, approver_device_id, approver_ephemeral_pubkey, wrapped_secret, platform } = req.body;
  if (platform !== 'electron') return res.status(403).json({ error: 'Only the desktop app can approve a new device' });
  if (!code || !approver_device_id || !approver_ephemeral_pubkey || !wrapped_secret) return res.status(400).json({ error: 'Missing fields' });
  const hasOwnDevice = db.prepare('SELECT 1 FROM secret_chat_devices WHERE chat_id = ? AND user_id = ? AND device_id = ?')
    .get(chatId, req.user.id, approver_device_id);
  if (!hasOwnDevice) return res.status(403).json({ error: 'This device has no access to grant from' });
  const reqRow = db.prepare(`
    SELECT * FROM secret_key_requests WHERE id = ? AND chat_id = ? AND code_hash = ? AND status = 'pending' AND expires_at > unixepoch()
  `).get(requestId, chatId, hashCode(code));
  if (!reqRow) return res.status(404).json({ error: 'Код не найден или истёк' });
  if (reqRow.requester_user_id === req.user.id) return res.status(403).json({ error: 'Нельзя подтвердить собственный запрос' });
  db.prepare(`
    UPDATE secret_key_requests SET status = 'approved', wrapped_secret = ?, approver_ephemeral_pubkey = ?, approver_user_id = ?
    WHERE id = ?
  `).run(wrapped_secret, approver_ephemeral_pubkey, req.user.id, requestId);
  sendTo(reqRow.requester_user_id, { type: 'secret_key_ready', chat_id: chatId, request_id: requestId });
  res.json({ ok: true });
});

// Устройство-запросчик забирает результат одобрения
router.get('/:chatId/requests/:requestId', authMiddleware, requireSecretMember, (req, res) => {
  const reqRow = db.prepare('SELECT * FROM secret_key_requests WHERE id = ? AND chat_id = ?')
    .get(Number(req.params.requestId), Number(req.params.chatId));
  if (!reqRow || reqRow.requester_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (reqRow.status !== 'approved') return res.json({ status: 'pending' });
  res.json({ status: 'approved', wrapped_secret: reqRow.wrapped_secret, approver_ephemeral_pubkey: reqRow.approver_ephemeral_pubkey });
});

// Устройство-запросчик подтверждает, что ключ успешно расшифрован и сохранён
// локально — только теперь оно считается «одобренным устройством».
router.post('/:chatId/requests/:requestId/complete', authMiddleware, requireSecretMember, (req, res) => {
  const chatId = Number(req.params.chatId);
  const reqRow = db.prepare('SELECT * FROM secret_key_requests WHERE id = ? AND chat_id = ?')
    .get(Number(req.params.requestId), chatId);
  if (!reqRow || reqRow.requester_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (reqRow.status !== 'approved') return res.status(409).json({ error: 'Not approved yet' });
  db.prepare(`
    INSERT OR REPLACE INTO secret_chat_devices (chat_id, user_id, device_id, device_label, platform)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, req.user.id, reqRow.requester_device_id, reqRow.requester_device_label, reqRow.requester_platform);
  db.prepare('DELETE FROM secret_key_requests WHERE id = ?').run(reqRow.id);
  sendTo(req.user.id, { type: 'reload_chats' });
  res.json({ ok: true });
});

// Список одобренных устройств этого секретного чата (для экрана управления устройствами)
router.get('/:chatId/devices', authMiddleware, requireSecretMember, (req, res) => {
  const rows = db.prepare('SELECT user_id, device_id, device_label, platform, approved_at FROM secret_chat_devices WHERE chat_id = ? ORDER BY approved_at')
    .all(Number(req.params.chatId));
  res.json(rows);
});

module.exports = router;
