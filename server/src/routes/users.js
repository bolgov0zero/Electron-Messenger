const router = require('express').Router();
const bcrypt = require('bcryptjs');
const path2 = require('path');
const fs = require('fs');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { getStatus, getMobile, sendTo, broadcastAll } = require('../ws');
const spaces = require('../spaces');
const { logAudit } = require('../audit');

// Папка данных всегда берётся из DB_PATH (как во всех остальных модулях): аватарки лежат рядом с базой
const DB_PATH = process.env.DB_PATH || path2.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const DB_DIR = path2.dirname(DB_PATH);
const AVATAR_DIR = path2.join(DB_DIR, 'avatar');

// Проверка магических байтов: принимаем только реальные изображения (JPEG/PNG/WebP/GIF),
// иначе на диск можно записать произвольный файл под видом аватара
function isImageBuffer(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return true; // WebP
  if (buf.slice(0, 4).toString() === 'GIF8') return true; // GIF
  return false;
}

// Люди, которых видит этот пользователь (свои из пространства, добавленные контакты, администратору все)
// и те, кого он знает по общим чатам. rel: ws — то же пространство, other — из другого, chat — только по
// общему чату (в списки выбора не попадает, нужен для имён и аватарок в переписке).
router.get('/', authMiddleware, (req, res) => {
  res.json(spaces.listFor(req.user.id));
});

// Статусы всех активных пользователей (контакты показывают точку присутствия у каждого)
router.get('/presence', authMiddleware, (req, res) => {
  // Присутствие — только у тех, кого человек видит: чужое пространство по статусу не отслеживается
  const visible = new Set(spaces.presenceIds(req.user.id));
  const peers = db.prepare(`
    SELECT id, last_seen_at FROM users
    WHERE id != ? AND COALESCE(banned, 0) = 0 AND COALESCE(is_bot, 0) IN (0, 2)
  `).all(req.user.id).filter(p => visible.has(p.id));
  const result = {};
  peers.forEach(({ id, last_seen_at }) => { result[id] = { status: getStatus(id), last_seen: last_seen_at, mobile: getMobile(id) || undefined }; });
  res.json(result);
});

// Update own display_name
router.patch('/me', authMiddleware, (req, res) => {
  const { display_name } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'Missing display_name' });
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.user.id);
  spaces.knownByOf(req.user.id).forEach(id => sendTo(id, { type: 'user_updated', user_id: req.user.id, display_name: display_name.trim() }));
  sendTo(req.user.id, { type: 'user_updated', user_id: req.user.id, display_name: display_name.trim() });
  require('../federation').onProfile(req.user.id);
  res.json({ ok: true });
});

// Upload own avatar (base64 JSON body: { data: "base64..." })
router.post('/me/avatar', authMiddleware, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });
  try {
    const buf = Buffer.from(data, 'base64');
    if (!isImageBuffer(buf)) return res.status(400).json({ error: 'Not an image' });
    fs.writeFileSync(path2.join(AVATAR_DIR, `${req.user.id}.jpg`), buf);
    const peers = db.prepare(`SELECT DISTINCT cm2.user_id FROM chat_members cm1 JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id AND cm2.user_id != cm1.user_id JOIN chats c ON c.id = cm1.chat_id WHERE cm1.user_id = ?`).all(req.user.id).map(r=>r.user_id);
    peers.forEach(uid => sendTo(uid, { type: 'avatar_updated', user_id: req.user.id }));
    sendTo(req.user.id, { type: 'avatar_updated', user_id: req.user.id });
    require('../federation').onProfile(req.user.id);
    res.json({ ok: true, url: `/api/users/${req.user.id}/avatar` });
  } catch (e) {
    console.error('avatar upload error:', e.stack || e);
    res.status(500).json({ error: 'Failed to save avatar' });
  }
});

// Serve user avatar
router.get('/:id/avatar', (req, res) => {
  const file = path2.join(AVATAR_DIR, `${req.params.id}.jpg`);
  // С ?t=... (клиенты /m и /chat сами версионируют URL при смене аватарки) файл под
  // этим URL больше не изменится — кэшируем надолго. Без ?t= (напр., таблица клиентов
  // в админке, она URL не версионирует) — короткий кэш, чтобы не мигало и не бомбило
  // сервер при частых опросах, но обновление было видно быстро.
  res.setHeader('Cache-Control', req.query.t ? 'private, max-age=31536000, immutable' : 'private, max-age=60');
  // Нет файла: ответ «не найдено» нельзя кэшировать. Иначе браузер на год запоминает отсутствие аватарки по адресу с ?t=
  // и не показывает её, даже когда файл появился (например, скачался с другого сервера позже первого запроса)
  res.sendFile(file, err => { if (err) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); } });
});

// Список пространств из тела запроса: workspace_ids (массив) или старый workspace_id. Нет полей — fallback.
// null — есть несуществующее пространство или список пуст.
function parseWsIds(body, fallback) {
  let raw = body.workspace_ids !== undefined ? body.workspace_ids : body.workspace_id !== undefined ? [body.workspace_id] : fallback;
  if (!Array.isArray(raw)) raw = [raw];
  const ids = [...new Set(raw.map(Number))].filter(Number.isFinite).sort((x, y) => x - y);
  if (!ids.length) return null;
  const have = new Set(db.prepare('SELECT id FROM workspaces').all().map(r => r.id));
  return ids.every(id => have.has(id)) ? ids : null;
}

// Admin: create user
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  const { username, password, display_name, is_admin, tag } = req.body;
  if (!username?.trim() || !password || !display_name?.trim()) return res.status(400).json({ error: 'Missing fields' });
  if (String(username).includes(':')) return res.status(400).json({ error: 'В логине нельзя использовать двоеточие' });
  // Пространства: список workspace_ids (старый одиночный workspace_id тоже принимается); по умолчанию — основное
  const wsIds = parseWsIds(req.body, [spaces.DEFAULT_WS]);
  if (!wsIds) return res.status(400).json({ error: 'Пространство не найдено' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.transaction(() => {
      const r = db.prepare('INSERT INTO users (username, password_hash, display_name, is_admin, tag, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username.trim(), hash, display_name.trim(), is_admin ? 1 : 0, tag?.trim() || null, wsIds[0]);
      spaces.setWorkspaces(r.lastInsertRowid, wsIds);
      return r;
    })();
    // Иначе новый человек не появляется в списках (упоминания, «написать») до
    // перезапуска клиента — список людей грузится один раз при входе
    broadcastAll({ type: 'user_created' });
    res.json({ id: result.lastInsertRowid, username, display_name, is_admin: !!is_admin, tag: tag?.trim() || null });
  } catch { res.status(409).json({ error: 'Username already exists' }); }
});

// Admin: edit user
router.patch('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { username, display_name, is_admin, tag } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (username !== undefined && String(username).includes(':') && String(username) !== user.username) return res.status(400).json({ error: 'В логине нельзя использовать двоеточие' });
  const newWs = (req.body.workspace_ids !== undefined || req.body.workspace_id !== undefined) ? parseWsIds(req.body, null) : undefined;
  if (newWs === null) return res.status(400).json({ error: 'Пространство не найдено' });
  try {
    db.prepare('UPDATE users SET username = ?, display_name = ?, is_admin = ?, tag = ? WHERE id = ?')
      .run(username?.trim() || user.username, display_name?.trim() || user.display_name, is_admin !== undefined ? (is_admin ? 1 : 0) : user.is_admin, tag !== undefined ? (tag?.trim() || null) : user.tag, req.params.id);
    // Люди других серверов в общих пространствах увидят новое имя и тег
    try { require('../federation').onProfile(Number(req.params.id)); require('../fedspaces').membersChanged(spaces.wsIdsOf(Number(req.params.id))); } catch {}
    // Клиенты обновляют имя и тег без перезапуска (отправляем и тогда, когда поменялся только тег)
    const updated = db.prepare('SELECT id, display_name, tag FROM users WHERE id = ?').get(req.params.id);
    const evt = { type: 'user_updated', user_id: updated.id, display_name: updated.display_name, tag: updated.tag };
    [updated.id, ...spaces.knownByOf(updated.id)].forEach(id => sendTo(id, evt));
    // Смена пространств: ручные контакты, ставшие «своими», убираем; все обновляют списки людей
    if (newWs) {
      const before = spaces.wsIdsOf(user.id);
      if (before.join() !== newWs.join()) {
        const names = ids => ids.map(id => db.prepare('SELECT name FROM workspaces WHERE id = ?').get(id)?.name || '—').map(n => `«${n}»`).join(', ');
        spaces.setWorkspaces(user.id, newWs);
        spaces.afterMove(user.id);
        logAudit(req, 'moderation', 'Изменены пространства пользователя', `${user.display_name}: ${names(before)} → ${names(newWs)}`);
        broadcastAll({ type: 'directory_changed' });
      }
    }
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Username already exists' }); }
});

// Admin: change password
router.patch('/:id/password', authMiddleware, adminMiddleware, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Missing password' });
  if (String(password).length < MIN_PASSWORD_LEN)
    return res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD_LEN} символов` });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ ok: true });
});

// Смена собственного пароля: старый → новый. Снимает требование смены.
// Используется модалкой в админке для дефолтного пароля admin.
const MIN_PASSWORD_LEN = 6;
router.post('/me/password', authMiddleware, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ error: 'Заполните все поля' });
  if (String(new_password).length < MIN_PASSWORD_LEN)
    return res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD_LEN} символов` });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!bcrypt.compareSync(old_password, row.password_hash))
    return res.status(400).json({ error: 'Текущий пароль неверен' });
  if (bcrypt.compareSync(new_password, row.password_hash))
    return res.status(400).json({ error: 'Новый пароль совпадает со старым' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

// Admin: delete user
// Сообщения и чаты сохраняются: sender_id/created_by обнуляются, отправитель
// отображается как «Удалённый аккаунт» (практика Telegram). Иначе DELETE падает
// по FK (messages.sender_id REFERENCES users), если пользователь что-то писал.
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const userId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'Not found' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  // Собеседники по общим чатам — им уйдёт reload_chats после удаления
  const peers = db.prepare(`
    SELECT DISTINCT user_id FROM chat_members
    WHERE chat_id IN (SELECT chat_id FROM chat_members WHERE user_id = ?) AND user_id != ?
  `).all(userId, userId).map(r => r.user_id);
  db.transaction(() => {
    db.prepare('UPDATE messages SET sender_id = NULL WHERE sender_id = ?').run(userId);
    db.prepare('UPDATE chats SET created_by = NULL WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();
  try { require('../fedspaces').membersChanged(); } catch {}   // люди других серверов уберут его из общих пространств
  sendTo(userId, { type: 'force_logout' });
  try { fs.unlinkSync(path2.join(AVATAR_DIR, `${userId}.jpg`)); } catch {}
  peers.forEach(uid => sendTo(uid, { type: 'reload_chats' }));
  broadcastAll({ type: 'directory_changed' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.isImageBuffer = isImageBuffer;
