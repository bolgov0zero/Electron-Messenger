const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../auth');
const announcements = require('../announcements');
const { activeBannersFor, dismiss } = announcements;
const { logAudit } = require('../audit');

// Отправлять может тот, кому админ включил право (или сам админ). Проверяем по базе, а не по токену:
// право отзывается сразу, не дожидаясь, пока истечёт сессия
function canSend(userId) {
  const u = db.prepare('SELECT is_admin, can_announce, banned FROM users WHERE id = ?').get(userId);
  return !!u && !u.banned && !!(u.is_admin || u.can_announce);
}
const needRight = (req, res, next) => canSend(req.user.id) ? next() : res.status(403).json({ error: 'Нет права отправлять объявления' });

// Полосы, которые должны висеть у этого пользователя прямо сейчас. Клиент
// запрашивает при входе и после каждого переподключения — так объявление
// доходит и до тех, кого не было в сети в момент отправки.
router.get('/active', authMiddleware, (req, res) => {
  res.json(activeBannersFor(req.user.id));
});

// Крестик на полосе. Отметка на пользователе: закрыл на одном устройстве —
// на других тоже не появится.
router.post('/:id/dismiss', authMiddleware, (req, res) => {
  dismiss(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// Кому и куда можно отправить: те же списки, что видит админ в окне объявления
router.get('/targets', authMiddleware, needRight, (req, res) => {
  const chats = db.prepare(`
    SELECT c.id, c.type, c.name,
      (SELECT GROUP_CONCAT(u.display_name, char(30)) FROM users u JOIN chat_members cm ON cm.user_id = u.id
       WHERE cm.chat_id = c.id) AS member_list
    FROM chats c WHERE c.parent_id IS NULL AND COALESCE(c.is_secret, 0) = 0
  `).all().map(c => ({ id: c.id, type: c.type, name: c.name, member_names: c.member_list ? c.member_list.split('\x1e') : [] }));
  const users = db.prepare(`SELECT id, username, display_name, tag FROM users
    WHERE COALESCE(banned, 0) = 0 AND COALESCE(is_bot, 0) = 0 ORDER BY display_name`).all();
  res.json({ chats, users });
});

// Отправка. Объявление уходит от имени системы, получатели автора не видят;
// автор остаётся в журнале объявлений и в аудит-логе
router.post('/', authMiddleware, needRight, (req, res) => {
  const p = announcements.parseRequest(req.body, req.user.id);
  if (p.error) return res.status(p.status || 400).json({ error: p.error });
  const r = announcements.create(p);
  const kinds = { popup: 'всплывающее', banner: 'полоса', chat: 'в чаты' };
  logAudit(req, 'server', r.scheduled ? 'Запланировано объявление из клиента' : 'Отправлено объявление из клиента', `${kinds[p.kind]}: ${p.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  res.json({ ok: true, ...r });
});

module.exports = router;
