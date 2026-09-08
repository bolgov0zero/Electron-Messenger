const router = require('express').Router();
const { authMiddleware } = require('../auth');
const { activeBannersFor, dismiss } = require('../announcements');

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

module.exports = router;
