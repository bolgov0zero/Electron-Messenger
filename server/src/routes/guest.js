'use strict';
// Гостевые ссылки: создание и отзыв (хозяин группы, администратор), вход гостя и сведения для его страницы.
// Правила и устройство — в guest.js.
const router = require('express').Router();
const dal = require('../dal');
const guest = require('../guest');
const { authMiddleware, signGuestToken } = require('../auth');
const { logAudit } = require('../audit');

// Перебор токенов бесполезен (192 бита), но лишние попытки всё равно режем: по адресу, считаем только неудачи
const fails = new Map();
const tooMany = req => { const f = fails.get(req.ip); return !!f && f.n >= 30 && Date.now() - f.t < 10 * 60e3; };
const fail = req => { const f = fails.get(req.ip); fails.set(req.ip, { n: (f && Date.now() - f.t < 10 * 60e3 ? f.n : 0) + 1, t: f && Date.now() - f.t < 10 * 60e3 ? f.t : Date.now() }); };
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (t - v.t > 10 * 60e3) fails.delete(k); }, 5 * 60e3).unref();

const TEXT = {
  not_found: 'Ссылка не найдена',
  expired: 'Доступ закончился',
  revoked: 'Ссылка отозвана',
  other_device: 'Эта ссылка уже открыта на другом устройстве',
  name_required: 'Введите имя (от 2 до 60 символов)',
};
const reply = (res, r) => res.status(r.status).json({ code: r.code, error: TEXT[r.code] || 'Ошибка' });

// Страница гостя спрашивает, чья это ссылка и нужно ли имя (без входа)
router.get('/link/:token', async (req, res) => {
  if (tooMany(req)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const r = await guest.peek(req.params.token);
  if (r.status !== 200) { fail(req); return reply(res, r); }
  res.json({ chat_name: r.chat_name, expires_at: r.expires_at, claimed: r.claimed });
});

// Вход по ссылке: первый раз с именем, потом по ключу устройства
router.post('/open', async (req, res) => {
  if (tooMany(req)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const { token, name, device_key } = req.body || {};
  if (typeof token !== 'string' || !token || token.length > 100) return res.status(400).json({ code: 'not_found', error: TEXT.not_found });
  const r = await guest.open(token, name, device_key);
  if (r.status !== 200) { if (r.code !== 'name_required') fail(req); return reply(res, r); }
  const jwt = signGuestToken({ id: r.user.id, username: r.user.username, display_name: r.user.display_name, is_admin: false, guest: true }, guest.TOKEN_TTL);
  const chat = await dal.get('SELECT id, name, type FROM chats WHERE id = ?', r.link.chat_id);
  res.json({ token: jwt, device_key: r.device_key, expires_at: r.expires_at, user: { id: r.user.id, display_name: r.user.display_name, tag: r.user.tag, is_guest: true }, chat });
});

// Диагностика страницы гостя: если живое сообщение не показалось само, страница присылает состояние клиента. Пишем в журнал сервера
const diagSeen = new Map();
router.post('/diag', (req, res) => {
  const f = diagSeen.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 60e3) { f.n = 0; f.t = Date.now(); }
  if (++f.n > 5) return res.json({ ok: true });
  diagSeen.set(req.ip, f);
  console.warn('[Гость] страница не показала живое сообщение:', JSON.stringify(req.body || {}).slice(0, 1500), '| UA:', String(req.headers['user-agent'] || '').slice(0, 160));
  res.json({ ok: true });
});

// ── Для самого гостя ──
const onlyGuest = (req, res, next) => (req.user.is_guest ? next() : res.status(403).json({ error: 'Только для гостя' }));

router.get('/me', authMiddleware, onlyGuest, async (req, res) => {
  const g = await dal.get('SELECT expires_at FROM guest_links WHERE guest_user_id = ?', req.user.id);
  res.json({ user: { id: req.user.id, display_name: req.user.display_name, tag: 'Гость', is_guest: true }, expires_at: g?.expires_at || 0, now: Math.floor(Date.now() / 1000) });
});

// Чат гостя и его участники. Логины и профили не отдаются: только имя, метка и номер для аватарки
router.get('/chat', authMiddleware, onlyGuest, async (req, res) => {
  const chat = await dal.get('SELECT id, name, type, read_only FROM chats WHERE id = ?', req.user.guest_chat_id);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  const members = await dal.all(`
    SELECT u.id, u.display_name, u.tag FROM chat_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ? AND COALESCE(u.banned, 0) = 0 AND COALESCE(u.is_bot, 0) != 1 ORDER BY u.display_name`, chat.id);
  res.json({ chat: { ...chat, read_only: !!chat.read_only }, members });
});

// ── Для хозяина группы и администратора ──
async function manageable(req, res, chatId) {
  if (req.user.is_guest) { res.status(403).json({ error: 'Forbidden' }); return null; }
  const chk = await guest.checkChat(Number(chatId));
  if (chk.error) { res.status(400).json({ error: chk.error }); return null; }
  const c = await dal.get('SELECT created_by FROM chats WHERE id = ?', chk.chat.id);
  // Как и состав: группой управляет её создатель или администратор, комнатой администратор
  const ok = chk.chat.type === 'room' ? req.user.is_admin : (req.user.is_admin || c.created_by === req.user.id);
  if (!ok) { res.status(403).json({ error: 'Ссылку создаёт хозяин группы или администратор (для комнаты администратор)' }); return null; }
  return chk.chat;
}
const origin = req => `${(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()}://${req.headers['x-forwarded-host'] || req.headers.host}`;

router.post('/links', authMiddleware, async (req, res) => {
  const chat = await manageable(req, res, req.body?.chat_id);
  if (!chat) return;
  let l;
  try { l = await guest.create(chat, req.user.id, req.body?.ttl_sec); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  await logAudit(req, 'rooms', 'Создана гостевая ссылка', `${chat.name || 'чат'} #${chat.id}, до ${new Date(l.expires_at * 1000).toLocaleString('ru-RU')}`);
  res.json({ id: l.id, expires_at: l.expires_at, token: l.token, url: `${origin(req)}/g/${l.token}` });
});

router.get('/links', authMiddleware, async (req, res) => {
  const chat = await manageable(req, res, req.query.chat_id);
  if (!chat) return;
  res.json({ links: await guest.list(chat.id), now: Math.floor(Date.now() / 1000) });
});

const ownLink = async (req, res) => {
  const row = await dal.get('SELECT id, chat_id FROM guest_links WHERE id = ?', Number(req.params.id));
  if (!row) { res.status(404).json({ error: 'Ссылка не найдена' }); return null; }
  return (await manageable(req, res, row.chat_id)) ? row : null;
};

router.delete('/links/:id', authMiddleware, async (req, res) => {
  const row = await ownLink(req, res);
  if (!row) return;
  await guest.revoke(row.id, row.chat_id);
  await logAudit(req, 'rooms', 'Гостевая ссылка отозвана', `чат #${row.chat_id}, ссылка #${row.id}`);
  res.json({ ok: true });
});

router.post('/links/:id/extend', authMiddleware, async (req, res) => {
  const row = await ownLink(req, res);
  if (!row) return;
  const r = await guest.extend(row.id, row.chat_id, req.body?.add_sec);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  await logAudit(req, 'rooms', 'Гостевая ссылка продлена', `чат #${row.chat_id}, ссылка #${row.id}, до ${new Date(r.expires_at * 1000).toLocaleString('ru-RU')}`);
  res.json({ ok: true, expires_at: r.expires_at });
});

router.post('/links/:id/reset-device', authMiddleware, async (req, res) => {
  const row = await ownLink(req, res);
  if (!row) return;
  if (!(await guest.resetDevice(row.id, row.chat_id))) return res.status(400).json({ error: 'Сбрасывать нечего: гость не входил или ссылка закрыта' });
  await logAudit(req, 'rooms', 'Гостевая ссылка: привязка к устройству сброшена', `чат #${row.chat_id}, ссылка #${row.id}`);
  res.json({ ok: true });
});

module.exports = router;
