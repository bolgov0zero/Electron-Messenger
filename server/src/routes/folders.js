// Папки чатов: личные для каждого пользователя, общие для всех его клиентов (Electron, веб, мобильный)
const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../auth');
const { sendTo } = require('../ws');

router.use(authMiddleware);

const MAX_FOLDERS = 20;
const changed = userId => sendTo(userId, { type: 'folders_changed' });

function list(userId) {
  const folders = db.prepare('SELECT id, name, color, icon, position FROM chat_folders WHERE user_id = ? ORDER BY position, id').all(userId);
  const items = db.prepare('SELECT i.folder_id, i.chat_id FROM chat_folder_items i JOIN chat_folders f ON f.id = i.folder_id WHERE f.user_id = ?').all(userId);
  const byFolder = new Map();
  items.forEach(r => { if (!byFolder.has(r.folder_id)) byFolder.set(r.folder_id, []); byFolder.get(r.folder_id).push(r.chat_id); });
  return folders.map(f => ({ ...f, chat_ids: byFolder.get(f.id) || [] }));
}

// Поля папки из запроса; null, если что-то некорректно
function fields(b, partial) {
  const out = {};
  if (b.name !== undefined || !partial) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
    if (!name) return null;
    out.name = name;
  }
  if (b.color !== undefined || !partial) {
    if (typeof b.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b.color)) return null;
    out.color = b.color.toLowerCase();
  }
  if (b.icon !== undefined || !partial) {
    if (typeof b.icon !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(b.icon)) return null;
    out.icon = b.icon;
  }
  return out;
}

const own = (id, userId) => db.prepare('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?').get(id, userId);

router.get('/', (req, res) => res.json(list(req.user.id)));

router.post('/', (req, res) => {
  const f = fields(req.body || {}, false);
  if (!f) return res.status(400).json({ error: 'Некорректные данные папки' });
  if (db.prepare('SELECT COUNT(*) c FROM chat_folders WHERE user_id = ?').get(req.user.id).c >= MAX_FOLDERS)
    return res.status(400).json({ error: `Не больше ${MAX_FOLDERS} папок` });
  const pos = (db.prepare('SELECT MAX(position) m FROM chat_folders WHERE user_id = ?').get(req.user.id).m ?? -1) + 1;
  const id = db.prepare('INSERT INTO chat_folders (user_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, f.name, f.color, f.icon, pos).lastInsertRowid;
  changed(req.user.id);
  res.json({ id: Number(id) });
});

// Порядок папок: полный список id
router.put('/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const mine = db.prepare('SELECT id FROM chat_folders WHERE user_id = ?').all(req.user.id).map(r => r.id);
  if (ids.length !== mine.length || !ids.every(i => mine.includes(i))) return res.status(400).json({ error: 'Некорректный порядок' });
  const upd = db.prepare('UPDATE chat_folders SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
  changed(req.user.id);
  res.json({ ok: true });
});

// В каких папках лежит чат: полный список id папок
router.put('/chat/:chatId', (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id))
    return res.status(404).json({ error: 'Чат не найден' });
  const want = Array.isArray(req.body?.folder_ids) ? req.body.folder_ids.map(Number) : [];
  const mine = db.prepare('SELECT id FROM chat_folders WHERE user_id = ?').all(req.user.id).map(r => r.id);
  if (!want.every(i => mine.includes(i))) return res.status(400).json({ error: 'Некорректный список папок' });
  db.transaction(() => {
    db.prepare(`DELETE FROM chat_folder_items WHERE chat_id = ? AND folder_id IN (SELECT id FROM chat_folders WHERE user_id = ?)`).run(chatId, req.user.id);
    const ins = db.prepare('INSERT OR IGNORE INTO chat_folder_items (folder_id, chat_id) VALUES (?, ?)');
    want.forEach(fid => ins.run(fid, chatId));
  })();
  changed(req.user.id);
  res.json({ ok: true });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!own(id, req.user.id)) return res.status(404).json({ error: 'Папка не найдена' });
  const f = fields(req.body || {}, true);
  if (!f || !Object.keys(f).length) return res.status(400).json({ error: 'Некорректные данные папки' });
  const keys = Object.keys(f);
  db.prepare(`UPDATE chat_folders SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map(k => f[k]), id);
  changed(req.user.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!own(id, req.user.id)) return res.status(404).json({ error: 'Папка не найдена' });
  db.prepare('DELETE FROM chat_folders WHERE id = ?').run(id);
  changed(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
