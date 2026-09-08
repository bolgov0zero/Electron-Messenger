const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authMiddleware } = require('../auth');

// In-memory rate limiter для /login: ip -> { count, resetAt }
const loginAttempts = new Map();
const RATE_LIMIT = 10;       // максимум попыток
const RATE_WINDOW = 60_000; // окно сброса в мс (60 сек)

// Периодическая очистка истёкших записей — иначе Map растёт бесконечно
// (записи удалялись только при повторной попытке с того же ключа)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(key);
  }
}, 5 * 60_000).unref();

function getRateLimitKey(req) {
  // req.ip учитывает X-Forwarded-For только при включённом trust proxy (см. index.js),
  // самодельный разбор заголовка позволял подделать ключ и обойти лимит
  return req.ip || 'unknown';
}

function checkRateLimit(req) {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (entry && now > entry.resetAt) {
    // Окно истекло — сбрасываем счётчик
    loginAttempts.delete(key);
  }

  const current = loginAttempts.get(key);
  if (current && current.count >= RATE_LIMIT) return false;

  if (current) {
    current.count++;
  } else {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_WINDOW });
  }
  return true;
}

router.post('/login', (req, res) => {
  // Проверяем rate limit перед обработкой запроса
  if (!checkRateLimit(req)) {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  // Заблокированный отсекается здесь, а не позже: раньше вход «удавался»,
  // а дальше каждый запрос падал с 401 — человек видел сломанное приложение
  if (user.banned) return res.status(403).json({ error: 'Учётная запись заблокирована' });

  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password } });
});

router.get('/refresh', authMiddleware, (req, res) => {
  const token = signToken({ id: req.user.id, username: req.user.username, display_name: req.user.display_name, is_admin: req.user.is_admin });
  res.json({ token, must_change_password: !!req.user.must_change_password });
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    const { verifyToken } = require('../auth');
    const payload = verifyToken(auth);
    const user = db.prepare('SELECT id, username, display_name, is_admin, tag, must_change_password FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ ...user, is_admin: !!user.is_admin, must_change_password: !!user.must_change_password });
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

module.exports = router;
