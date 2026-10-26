const router = require('express').Router();
const bcrypt = require('bcryptjs');
const dal = require('../dal');
// Пространство человека: клиент сравнивает его с пространством остальных, чтобы делить список на «своих» и «из других»
// Имя системы (задаётся в админке, раздел «Федерации») клиент показывает в подсказке бара учётных записей
const serverName = async () => (await dal.get("SELECT value FROM settings WHERE key = 'fed_name'"))?.value || '';
// Идентификатор сервера (если настроена федерация): из него клиент собирает внешнюю ссылку на профиль «@сервер:логин»
const serverId = async () => (await dal.get("SELECT value FROM settings WHERE key = 'fed_id'"))?.value || '';
// workspace_id / workspace_name — основное пространство (их читают старые клиенты); workspaces — все пространства человека
const wsInfo = async id => ({
  ...((await dal.get('SELECT u.workspace_id, w.name AS workspace_name FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = ?', id)) || {}),
  workspaces: (await dal.all('SELECT w.id, w.name FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.id', id)),
  server_name: (await serverName()), server_id: (await serverId()),
});
const { signToken, authMiddleware, signChallengeToken, verifyChallengeToken } = require('../auth');
const totp = require('../totp');
const { logAudit } = require('../audit');
const devices = require('../devices');

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

router.post('/login', async (req, res) => {
  // Проверяем rate limit перед обработкой запроса
  if (!checkRateLimit(req)) {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = await dal.get('SELECT * FROM users WHERE username = ?', username);
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

  // Клиент приложения присылает сведения об устройстве: выдаём ему ключ для входа без пароля (см. devices.js).
  // Пока пароль по умолчанию не сменён, ключ не нужен: после смены все ключи всё равно сбрасываются
  let keys = null;
  const dev = req.body.context === 'admin' || user.must_change_password ? null : devices.parseDevice(req.body.device);
  if (dev) {
    try {
      const d = await devices.issueDevice(user.id, dev);
      const p = req.body.device.ha ? await devices.issueProfile(user.id, dev.os_user) : null;
      keys = { device_key: d.key, ...(p ? { profile_key: p.key } : {}), dk: d.id };
    } catch (e) { console.warn('[Ключи устройств] выдача:', e.message); }
  }
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, ...(keys ? { dk: keys.dk } : {}) });
  const reply = await sessionReply(user, token);
  if (keys) { reply.device_key = keys.device_key; if (keys.profile_key) reply.profile_key = keys.profile_key; }
  res.json(reply);
});

// Ответ о начатой сессии: токен и сведения о человеке (одинаковы для входа по паролю и по ключу устройства)
async function sessionReply(user, token) {
  return { token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password, can_announce: !!user.can_announce, ...(await wsInfo(user.id)) } };
}

// ── ВХОД ПО КЛЮЧУ УСТРОЙСТВА ──
// Ключи длинные и случайные, подбор бессмыслен; лимит считает только неудачи, чтобы утренний запуск многих клиентов за одним адресом не упирался в него
const keyFails = new Map();
const keyBlocked = req => { const f = keyFails.get(req.ip); return !!f && f.n >= 40 && Date.now() - f.t < 60_000; };
const keyFail = req => { const f = keyFails.get(req.ip); keyFails.set(req.ip, f && Date.now() - f.t < 60_000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };
setInterval(() => { const t = Date.now(); for (const [k, v] of keyFails) if (t - v.t > 60_000) keyFails.delete(k); }, 5 * 60_000).unref();
const KEY_TEXT = { device_unknown: 'Ключ устройства не найден', device_revoked: 'Устройство отозвано администратором', device_expired: 'Срок действия ключа истёк, войдите по паролю', device_reuse: 'Ключ использован повторно: устройство отозвано, войдите по паролю', profile_revoked: 'Регистрация новых устройств запрещена администратором' };

async function keyUser(res, req, row) {
  const user = await dal.get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || user.is_bot) { keyFail(req); res.status(401).json({ code: 'device_unknown', error: KEY_TEXT.device_unknown }); return null; }
  if (user.banned) { res.status(403).json({ code: 'banned', error: 'Учётная запись заблокирована' }); return null; }
  if (user.must_change_password) { res.status(401).json({ code: 'device_unknown', error: KEY_TEXT.device_unknown }); return null; }
  return user;
}

// Токен не принят (или суточное обновление) — клиент обменивает ключ своего устройства на новый и получает токен. Ключ привязан к устройству:
// номер установки должен совпасть. Подробности ротации — в devices.js
router.post('/device-login', async (req, res) => {
  if (keyBlocked(req)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const dev = devices.parseDevice(req.body?.device);
  let user = null;
  const c = await devices.consumeDevice(req.body?.key, async row => {
    if (!dev || row.device_id !== dev.id) return { code: 'device_unknown' };
    const u = await dal.get('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!u || u.is_bot || u.must_change_password) return { code: 'device_unknown' };
    if (u.banned) return { code: 'banned', status: 403, error: 'Учётная запись заблокирована' };
    user = u;
    return null;
  });
  if (c.code) {
    if (c.status !== 403) keyFail(req);
    return res.status(c.status || 401).json({ code: c.code, error: c.error || KEY_TEXT[c.code] || 'Ключ не принят' });
  }
  await dal.run('UPDATE device_keys SET name = ?, os_user = ? WHERE id = ?', dev.name, dev.os_user, c.row.id);
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, dk: c.row.id });
  res.json({ ...(await sessionReply(user, token)), device_key: c.key });
});

// Новый компьютер в режиме HA: по ключу профиля с сетевого диска регистрирует своё устройство и входит
router.post('/device-register', async (req, res) => {
  if (keyBlocked(req)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const dev = devices.parseDevice(req.body?.device);
  const f = await devices.find(req.body?.profile_key, 'profile');
  if (f.code || !dev) { keyFail(req); const code = f.code || 'device_unknown'; return res.status(401).json({ code, error: KEY_TEXT[code] }); }
  const user = await keyUser(res, req, f.row); if (!user) return;
  // Отозванное устройство не регистрируется заново само: вернуться оно может только по паролю
  if (await dal.get("SELECT 1 FROM device_keys WHERE user_id = ? AND kind = 'device' AND device_id = ? AND revoked_at IS NOT NULL", user.id, dev.id)) {
    return res.status(401).json({ code: 'device_revoked', error: KEY_TEXT.device_revoked });
  }
  const d = await devices.issueDevice(user.id, dev, f.row.id);
  await devices.touch(f.row.id);
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, dk: d.id });
  res.json({ ...(await sessionReply(user, token)), device_key: d.key });
});

// Ключи по действующей сессии: клиенту, который вошёл раньше, чем появились ключи (после обновления, при переносе старой HA-установки,
// при включении HA, после смены пароля). device_key: false — ключ устройства уже есть, менять его не нужно; profile: true — нужен ключ профиля (HA)
router.post('/device-keys', authMiddleware, async (req, res) => {
  const dev = devices.parseDevice(req.body?.device);
  if (!dev || req.user.is_guest) return res.status(400).json({ error: 'Нет сведений об устройстве' });
  const out = {};
  let dk = req.user.dk || null;
  if (req.body.device_key !== false) { const d = await devices.issueDevice(req.user.id, dev); out.device_key = d.key; dk = d.id; }
  if (req.body.profile && req.body.device.ha) { const p = await devices.issueProfile(req.user.id, dev.os_user); if (p) out.profile_key = p.key; }
  if (out.device_key) out.token = signToken({ id: req.user.id, username: req.user.username, display_name: req.user.display_name, is_admin: req.user.is_admin, dk });
  res.json(out);
});

// Явный выход из приложения: ключ этого устройства удаляется, дальше войти можно только паролем
router.post('/device-logout', async (req, res) => {
  const f = await devices.lookupDevice(req.body?.key);   // и действующий, и прежний ключ (после ротации)
  if (f.row) await devices.forget(f.row);
  res.json({ ok: true });
});

// ── 2FA (только вход в админ-панель) ──

// Шаг 1 настройки: выдаём ещё не подтверждённый секрет (повторный вызов с тем
// же challenge_token отдаёт тот же секрет, а не новый — иначе открытые
// одновременно вкладка с QR и форма ввода кода разъехались бы по разным ключам)
router.post('/totp/setup', async (req, res) => {
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_setup'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = await dal.get('SELECT id, username, totp_pending_secret FROM users WHERE id = ?', payload.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  let secret = user.totp_pending_secret;
  if (!secret) {
    secret = totp.generateSecret();
    await dal.run('UPDATE users SET totp_pending_secret = ? WHERE id = ?', secret, user.id);
  }
  res.json({ secret, otpauth_url: totp.otpauthUrl(secret, user.username) });
});

// Шаг 2 настройки: код подтверждён — секрет становится постоянным, сразу выдаём сессию
router.post('/totp/confirm', async (req, res) => {
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_setup'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = await dal.get('SELECT * FROM users WHERE id = ?', payload.id);
  if (!user || !user.totp_pending_secret) return res.status(400).json({ error: 'Сначала запросите секрет' });
  if (!totp.verifyTotp(user.totp_pending_secret, req.body.code))
    return res.status(401).json({ error: 'Неверный код' });
  await dal.run('UPDATE users SET totp_secret = ?, totp_pending_secret = NULL WHERE id = ?', user.totp_pending_secret, user.id);
  logAudit({ user: { id: user.id }, ip: req.ip }, 'security', 'Настройка 2FA', user.display_name);
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password, can_announce: !!user.can_announce, ...(await wsInfo(user.id)) } });
});

// Обычный вход при уже настроенной 2FA — просто проверка кода
router.post('/totp/verify', async (req, res) => {
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many attempts, try again later' });
  let payload;
  try { payload = verifyChallengeToken(req.body.challenge_token, 'totp_verify'); }
  catch { return res.status(401).json({ error: 'Истёк или недействителен, войдите заново' }); }
  const user = await dal.get('SELECT * FROM users WHERE id = ?', payload.id);
  if (!user || !user.totp_secret) return res.status(400).json({ error: '2FA не настроена' });
  if (!totp.verifyTotp(user.totp_secret, req.body.code))
    return res.status(401).json({ error: 'Неверный код' });
  const token = signToken({ id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin, tag: user.tag || null, must_change_password: !!user.must_change_password, can_announce: !!user.can_announce, ...(await wsInfo(user.id)) } });
});

router.get('/refresh', authMiddleware, (req, res) => {
  const token = signToken({ id: req.user.id, username: req.user.username, display_name: req.user.display_name, is_admin: req.user.is_admin, ...(req.user.dk ? { dk: req.user.dk } : {}) });
  res.json({ token, must_change_password: !!req.user.must_change_password });
});

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    const { verifyToken } = require('../auth');
    const payload = verifyToken(auth);
    const user = await dal.get('SELECT id, username, display_name, is_admin, tag, must_change_password, can_announce, is_bot FROM users WHERE id = ?', payload.id);
    if (!user || user.is_bot === 3) return res.status(401).json({ error: 'User not found' });   // гость входит только через /api/guest
    res.json({ ...user, is_admin: !!user.is_admin, must_change_password: !!user.must_change_password, can_announce: !!user.can_announce, ...(await wsInfo(user.id)) });
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

module.exports = router;
