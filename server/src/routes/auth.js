const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authMiddleware, signChallengeToken, verifyChallengeToken } = require('../auth');
const totp = require('../totp');
const { logAudit } = require('../audit');

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

  // 2FA защищает только вход в админ-панель (req.body.context === 'admin'),
  // обычный чат-клиент как был на логине/пароле, так и остаётся — см. [[feedback]]
  // про осознанный выбор защищать именно админ-поверхность, а не аккаунт целиком.
  if (req.body.context === 'admin' && user.is_admin && user.totp_required) {
    if (!user.totp_secret) {
      const challenge_token = signChallengeToken(user.id, 'totp_setup');
      return res.json({ needs_totp_setup: true, challenge_token });
    }
    const challenge_token = signChallengeToken(user.id, 'totp_verify');
    return res.json({ needs_totp: true, challenge_token });
  }

  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password } });
});

// ── 2FA (только вход в админ-панель) ──

// Шаг 1 настройки: выдаём ещё не подтверждённый секрет (повторный вызов с тем
// же challenge_token отдаёт тот же секрет, а не новый — иначе открытые
// одновременно вкладка с QR и форма ввода кода разъехались бы по разным ключам)
router.post('/totp/setup', (req, res) => {
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_setup'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = db.prepare('SELECT id, username, totp_pending_secret FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  let secret = user.totp_pending_secret;
  if (!secret) {
    secret = totp.generateSecret();
    db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(secret, user.id);
  }
  res.json({ secret, otpauth_url: totp.otpauthUrl(secret, user.username) });
});

// Шаг 2 настройки: код подтверждён — секрет становится постоянным, сразу выдаём сессию
router.post('/totp/confirm', (req, res) => {
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_setup'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.totp_pending_secret) return res.status(400).json({ error: 'Сначала запросите секрет' });
  if (!totp.verifyTotp(user.totp_pending_secret, req.body.code))
    return res.status(401).json({ error: 'Неверный код' });
  db.prepare('UPDATE users SET totp_secret = ?, totp_pending_secret = NULL WHERE id = ?').run(user.totp_pending_secret, user.id);
  logAudit({ user: { id: user.id }, ip: req.ip }, 'security', 'Настройка 2FA', user.display_name);
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password } });
});

// Обычный вход при уже настроенной 2FA — просто проверка кода
router.post('/totp/verify', (req, res) => {
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_verify'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.totp_secret) return res.status(400).json({ error: '2FA не настроена' });
  if (!totp.verifyTotp(user.totp_secret, req.body.code))
    return res.status(401).json({ error: 'Неверный код' });
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
