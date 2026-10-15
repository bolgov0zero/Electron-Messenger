// Превью ссылки для поля ввода: клиент спрашивает адрес, сервер сам ходит на сайт (см. linkprev.js)
const router = require('express').Router();
const { authMiddleware } = require('../auth');
const { fetchPreview } = require('../linkprev');

router.use(authMiddleware);

// Не больше 40 запросов в минуту на человека
const tries = new Map();
function tooMany(id) {
  const now = Date.now(), list = (tries.get(id) || []).filter(t => now - t < 60000);
  list.push(now); tries.set(id, list);
  return list.length > 40;
}

router.get('/', async (req, res) => {
  if (tooMany(req.user.id)) return res.status(429).json({ error: 'Слишком много запросов' });
  const url = String(req.query.url || '').slice(0, 600);
  if (!/^https?:\/\//i.test(url)) return res.json({ preview: null });
  try { res.json({ preview: await fetchPreview(url) }); }
  catch { res.json({ preview: null }); }
});

module.exports = router;
