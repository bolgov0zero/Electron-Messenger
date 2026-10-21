const router = require('express').Router();
const dal = require('../dal');
const { authMiddleware } = require('../auth');
const announcements = require('../announcements');
const spaces = require('../spaces');
const { activeBannersFor, dismiss } = announcements;
const { logAudit } = require('../audit');

// Отправлять может тот, кому админ включил право (или сам админ). Проверяем по базе, а не по токену:
// право отзывается сразу, не дожидаясь, пока истечёт сессия
async function canSend(userId) {
  const u = await dal.get('SELECT is_admin, can_announce, banned FROM users WHERE id = ?', userId);
  return !!u && !u.banned && !!(u.is_admin || u.can_announce);
}
const needRight = async (req, res, next) => (await canSend(req.user.id)) ? next() : res.status(403).json({ error: 'Нет права отправлять объявления' });

// Полосы, которые должны висеть у этого пользователя прямо сейчас. Клиент
// запрашивает при входе и после каждого переподключения — так объявление
// доходит и до тех, кого не было в сети в момент отправки.
router.get('/active', authMiddleware, async (req, res) => {
  res.json((await activeBannersFor(req.user.id)));
});

// Крестик на полосе. Отметка на пользователе: закрыл на одном устройстве —
// на других тоже не появится.
router.post('/:id/dismiss', authMiddleware, async (req, res) => {
  await dismiss(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// Кому и куда можно отправить: те же списки, что видит админ в окне объявления
router.get('/targets', authMiddleware, needRight, async (req, res) => {
  const me = await dal.get('SELECT is_admin, workspace_id FROM users WHERE id = ?', req.user.id);
  const admin = !!me?.is_admin;
  // Пользователь с правом видит только свои пространства и чаты, где все свои
  const myWs = await spaces.wsIdsOf(req.user.id), myWsIn = myWs.map(Number).join(',');
  const allowedChats = admin ? null : new Set((await announcements.chatsOfSpaces(myWs, true)));
  const chats = (await dal.all(`
    SELECT c.id, c.type, c.name,
      (SELECT GROUP_CONCAT(u.display_name, char(30)) FROM users u JOIN chat_members cm ON cm.user_id = u.id
       WHERE cm.chat_id = c.id) AS member_list
    FROM chats c WHERE c.parent_id IS NULL AND COALESCE(c.is_secret, 0) = 0
  `)).filter(c => !allowedChats || allowedChats.has(c.id))
    .map(c => ({ id: c.id, type: c.type, name: c.name, member_names: c.member_list ? c.member_list.split('\x1e') : [] }));
  const users = await dal.all(`SELECT id, username, display_name, tag, workspace_id FROM users
    WHERE COALESCE(banned, 0) = 0 AND COALESCE(is_bot, 0) = 0 ${admin ? '' : 'AND id IN (SELECT user_id FROM user_workspaces WHERE workspace_id IN (' + myWsIn + '))'} ORDER BY display_name`);
  const wsList = await dal.all(`SELECT w.id, w.name, (SELECT COUNT(*) FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0) AS users
    FROM workspaces w ${admin ? '' : 'WHERE w.id IN (' + myWsIn + ')'} ORDER BY w.id`);
  res.json({ chats, users, spaces: wsList, scoped: !admin });
});

// Отправка. Объявление уходит от имени системы, получатели автора не видят;
// автор остаётся в журнале объявлений и в аудит-логе
router.post('/', authMiddleware, needRight, async (req, res) => {
  const p = await announcements.parseRequest(req.body, req.user.id);
  if (p.error) return res.status(p.status || 400).json({ error: p.error });
  const r = await announcements.create(p);
  const kinds = { popup: 'всплывающее', banner: 'полоса', chat: 'в чаты' };
  logAudit(req, 'server', r.scheduled ? 'Запланировано объявление из клиента' : 'Отправлено объявление из клиента', `${kinds[p.kind]}: ${p.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  res.json({ ok: true, ...r });
});

module.exports = router;
