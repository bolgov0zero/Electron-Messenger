// Папки чатов: личные для каждого пользователя, общие для всех его клиентов (Electron, веб, мобильный)
const router = require('express').Router();
const dal = require('../dal');
const { authMiddleware } = require('../auth');
const { sendTo } = require('../ws');

router.use(authMiddleware);

const MAX_FOLDERS = 20;
const changed = userId => sendTo(userId, { type: 'folders_changed' });

async function list(userId) {
  const folders = await dal.all('SELECT id, name, color, icon, position FROM chat_folders WHERE user_id = ? ORDER BY position, id', userId);
  const items = await dal.all('SELECT i.folder_id, i.chat_id FROM chat_folder_items i JOIN chat_folders f ON f.id = i.folder_id WHERE f.user_id = ?', userId);
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

const own = async (id, userId) => (await dal.get('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?', id, userId));

router.get('/', async (req, res) => res.json((await list(req.user.id))));

router.post('/', async (req, res) => {
  const f = fields(req.body || {}, false);
  if (!f) return res.status(400).json({ error: 'Некорректные данные папки' });
  if ((await dal.get('SELECT COUNT(*) c FROM chat_folders WHERE user_id = ?', req.user.id)).c >= MAX_FOLDERS)
    return res.status(400).json({ error: `Не больше ${MAX_FOLDERS} папок` });
  const pos = ((await dal.get('SELECT MAX(position) m FROM chat_folders WHERE user_id = ?', req.user.id)).m ?? -1) + 1;
  const id = (await dal.run('INSERT INTO chat_folders (user_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)', req.user.id, f.name, f.color, f.icon, pos)).lastInsertRowid;
  changed(req.user.id);
  res.json({ id: Number(id) });
});

// Порядок папок: полный список id
router.put('/order', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const mine = (await dal.all('SELECT id FROM chat_folders WHERE user_id = ?', req.user.id)).map(r => r.id);
  if (ids.length !== mine.length || !ids.every(i => mine.includes(i))) return res.status(400).json({ error: 'Некорректный порядок' });
  const upd = 'UPDATE chat_folders SET position = ? WHERE id = ?';
  await dal.tx(async () => { for (const [i, id] of ids.entries()) await dal.run(upd, i, id); });
  changed(req.user.id);
  res.json({ ok: true });
});

// В каких папках лежит чат: полный список id папок
router.put('/chat/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, req.user.id)))
    return res.status(404).json({ error: 'Чат не найден' });
  const want = Array.isArray(req.body?.folder_ids) ? req.body.folder_ids.map(Number) : [];
  const mine = (await dal.all('SELECT id FROM chat_folders WHERE user_id = ?', req.user.id)).map(r => r.id);
  if (!want.every(i => mine.includes(i))) return res.status(400).json({ error: 'Некорректный список папок' });
  await dal.tx(() => (async () => {
    await dal.run(`DELETE FROM chat_folder_items WHERE chat_id = ? AND folder_id IN (SELECT id FROM chat_folders WHERE user_id = ?)`, chatId, req.user.id);
    const ins = 'INSERT OR IGNORE INTO chat_folder_items (folder_id, chat_id) VALUES (?, ?)';
    for (const fid of want) (await dal.run(ins, fid, chatId)) ;
  })());
  changed(req.user.id);
  res.json({ ok: true });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await own(id, req.user.id))) return res.status(404).json({ error: 'Папка не найдена' });
  const f = fields(req.body || {}, true);
  if (!f || !Object.keys(f).length) return res.status(400).json({ error: 'Некорректные данные папки' });
  const keys = Object.keys(f);
  await dal.run(`UPDATE chat_folders SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map(k => f[k]), id);
  changed(req.user.id);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await own(id, req.user.id))) return res.status(404).json({ error: 'Папка не найдена' });
  await dal.run('DELETE FROM chat_folders WHERE id = ?', id);
  changed(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
