const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const dal = require('./dal');

// Секрет: env → settings → генерируем и сохраняем при первом старте.
// Захардкоженный дефолт позволял любому, кто видел исходники, подделать токен админа.
async function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = await dal.get("SELECT value FROM settings WHERE key = 'jwt_secret'");
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  await dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'jwt_secret', secret);
  console.log('[Auth] Сгенерирован новый JWT-секрет (сохранён в settings). Все существующие сессии сброшены.');
  return secret;
}

// Секрет читается из базы асинхронно, поэтому index.js вызывает init() до старта
let SECRET = null;
async function init() { SECRET = await getSecret(); }
const EXPIRES_IN = '60d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Короткоживущий токен для промежуточного шага 2FA при входе в админ-панель
// (настройка/проверка кода) — НЕ полноценная сессия. purpose обязателен и
// проверяется в resolveUser(), чтобы этот токен нельзя было подсунуть как
// обычный Bearer-токен и обойти 2FA.
function signChallengeToken(userId, purpose) {
  return jwt.sign({ id: userId, purpose }, SECRET, { expiresIn: '10m' });
}

function verifyChallengeToken(token, expectedPurpose) {
  const payload = jwt.verify(token, SECRET);
  if (payload.purpose !== expectedPurpose) throw new Error('Wrong challenge purpose');
  return payload;
}

// Сверяем пользователя с БД на каждый запрос: удалённый пользователь или
// разжалованный админ теряет доступ сразу, а не когда истечёт 7-дневный токен.
// Заодно display_name/is_admin всегда актуальны, а не заморожены в токене.
// Причина отказа нужна клиенту: по временной ошибке связи он не должен
// разлогинивать пользователя, а по отзыву или блокировке — обязан.
class AuthError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function resolveUser(token) {
  const payload = verifyToken(token);
  // Токен-вызов 2FA (purpose: totp_setup/totp_verify) — не настоящая сессия,
  // иначе его можно было бы подсунуть сюда как Bearer-токен и обойти 2FA целиком
  if (payload.purpose) throw new AuthError('invalid');
  const user = await dal.get('SELECT id, username, display_name, is_admin, banned, must_change_password, sessions_valid_from, is_bot FROM users WHERE id = ?', payload.id);
  if (!user) throw new AuthError(payload.guest ? 'guest_expired' : 'user_not_found');   // гостя по окончании срока удаляют целиком
  // Гость (is_bot = 3): доступ только пока действует его ссылка; о закрытии клиент узнаёт по коду guest_expired
  if (user.is_bot === 3) {
    const g = await dal.get('SELECT chat_id, expires_at, revoked_at, ended_at FROM guest_links WHERE guest_user_id = ?', user.id);
    if (!g || g.revoked_at || g.ended_at || g.expires_at <= Math.floor(Date.now() / 1000)) throw new AuthError('guest_expired');
    return { ...user, is_admin: false, must_change_password: false, is_guest: true, guest_chat_id: g.chat_id };
  }
  if (user.banned) throw new AuthError('banned');
  // iat в секундах, как и отметка. Сравнение нестрогое: токен, выданный в ту же
  // секунду, что и отзыв, тоже считаем отозванным — иначе он проскочит
  if (user.sessions_valid_from && payload.iat <= user.sessions_valid_from) throw new AuthError('revoked');
  return { ...user, is_admin: !!user.is_admin, must_change_password: !!user.must_change_password };
}

// Пока пароль по умолчанию не сменён, токен даёт доступ только к смене пароля и обновлению токена
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/refresh', '/api/users/me/password']);

async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token', code: 'no_token' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = await resolveUser(token);
    if (req.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.baseUrl + req.path)) {
      return res.status(403).json({ error: 'Сначала смените пароль', code: 'must_change_password' });
    }
  } catch (e) {
    // code разделяет «сессия больше не действует» и «срок истёк»: по первому
    // клиент выходит, по второму сначала пробует продлить токен
    const code = e.code || (e.name === 'TokenExpiredError' ? 'expired' : 'invalid');
    return res.status(401).json({ error: e.message, code });
  }
  // Гостю открыт только короткий список запросов (см. guest.js): остальное закрыто по умолчанию
  if (req.user.is_guest && !require('./guest').httpAllowed(req)) return res.status(403).json({ error: 'Недоступно гостю', code: 'guest_forbidden' });
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

async function wsAuth(token) {
  const user = await resolveUser(token);
  if (!user) throw new Error('User not found');
  return user;
}

// Токен гостя действует ровно до конца ссылки
function signGuestToken(payload, ttlSec) { return jwt.sign(payload, SECRET, { expiresIn: Math.max(1, Math.floor(ttlSec)) }); }

module.exports = { init, signToken, signGuestToken, verifyToken, signChallengeToken, verifyChallengeToken, authMiddleware, adminMiddleware, wsAuth, AuthError };
