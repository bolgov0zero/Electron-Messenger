const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

// Секрет: env → settings → генерируем и сохраняем при первом старте.
// Захардкоженный дефолт позволял любому, кто видел исходники, подделать токен админа.
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', secret);
  console.log('[Auth] Сгенерирован новый JWT-секрет (сохранён в settings). Все существующие сессии сброшены.');
  return secret;
}

const SECRET = getSecret();
const EXPIRES_IN = '60d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Сверяем пользователя с БД на каждый запрос: удалённый пользователь или
// разжалованный админ теряет доступ сразу, а не когда истечёт 7-дневный токен.
// Заодно display_name/is_admin всегда актуальны, а не заморожены в токене.
// Причина отказа нужна клиенту: по временной ошибке связи он не должен
// разлогинивать пользователя, а по отзыву или блокировке — обязан.
class AuthError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function resolveUser(token) {
  const payload = verifyToken(token);
  const user = db.prepare('SELECT id, username, display_name, is_admin, banned, must_change_password, sessions_valid_from FROM users WHERE id = ?').get(payload.id);
  if (!user) throw new AuthError('user_not_found');
  if (user.banned) throw new AuthError('banned');
  // iat в секундах, как и отметка. Сравнение нестрогое: токен, выданный в ту же
  // секунду, что и отзыв, тоже считаем отозванным — иначе он проскочит
  if (user.sessions_valid_from && payload.iat <= user.sessions_valid_from) throw new AuthError('revoked');
  return { ...user, is_admin: !!user.is_admin, must_change_password: !!user.must_change_password };
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token', code: 'no_token' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = resolveUser(token);
    next();
  } catch (e) {
    // code разделяет «сессия больше не действует» и «срок истёк»: по первому
    // клиент выходит, по второму сначала пробует продлить токен
    const code = e.code || (e.name === 'TokenExpiredError' ? 'expired' : 'invalid');
    res.status(401).json({ error: e.message, code });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function wsAuth(token) {
  const user = resolveUser(token);
  if (!user) throw new Error('User not found');
  return user;
}

module.exports = { signToken, verifyToken, authMiddleware, adminMiddleware, wsAuth, AuthError };
