const router = require('express').Router();
const { someAsync, filterAsync } = require('../aiter.js');
const path2 = require('path');
const fs = require('fs');
const dal = require('../dal');
const { authMiddleware, adminMiddleware } = require('../auth');
const { sendTo } = require('../ws');
const unreadCounts = require('../unread');
const announcements = require('../announcements');
const { logAudit } = require('../audit');
const spaces = require('../spaces');
const fedgroups = require('../fedgroups');

async function nameOf(userId) {
  return (await dal.get('SELECT display_name FROM users WHERE id = ?', userId))?.display_name || '—';
}

// Папка данных всегда берётся из DB_PATH (как во всех остальных модулях): аватарки и файлы лежат рядом с базой
const DB_PATH = process.env.DB_PATH || path2.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const DB_DIR = path2.dirname(DB_PATH);
const AVATAR_DIR = path2.join(DB_DIR, 'avatar');
const FILES_DIR = path2.join(DB_DIR, 'files');

async function deleteChatFiles(chatId) {
  const rows = await dal.all("SELECT attachment FROM messages WHERE chat_id = ? AND attachment IS NOT NULL", chatId);
  rows.forEach(r => { try { require('../attach').purge(JSON.parse(r.attachment)); } catch {} });
}

async function enrichChat(chat, userId, dk = null) {
  const members = (await dal.all(`
    SELECT u.id, u.username, u.display_name, u.tag, u.is_bot, u.fed_login, u.fed_instance FROM users u
    JOIN chat_members cm ON cm.user_id = u.id WHERE cm.chat_id = ?
  `, chat.id)).map(({ is_bot, fed_login, fed_instance, ...m }) => is_bot === spaces.FED ? { ...m, federated: true, login: fed_login, server_id: fed_instance } : m);

  const topics = await dal.all('SELECT id FROM chats WHERE parent_id = ? ORDER BY position, id', chat.id);
  const hasTopics = topics.length > 0;

  let last, unread, unreadMentions;
  if (hasTopics) {
    const ids = topics.map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');
    last = await dal.get(`
      SELECT m.id, m.chat_id, m.text, m.iv, m.sent_at, m.edited_at, m.deleted, m.attachment, m.forward_data,
        COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, u.id as sender_id
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id IN (${placeholders}) ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
    `, ...ids);
    if (last?.attachment) try { last.attachment = JSON.parse(last.attachment); } catch { last.attachment = null; }
    if (last?.forward_data) try { last.forward_data = JSON.parse(last.forward_data); } catch { last.forward_data = null; }
    unread = await unreadCounts.inChats(userId, ids);
    unreadMentions = await unreadCounts.mentionsInChats(userId, ids);
  } else {
    last = await dal.get(`
      SELECT m.id, m.chat_id, m.text, m.iv, m.sent_at, m.edited_at, m.deleted, m.attachment, m.forward_data,
        COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, u.id as sender_id
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ? ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
    `, chat.id);
    if (last?.attachment) try { last.attachment = JSON.parse(last.attachment); } catch { last.attachment = null; }
    if (last?.forward_data) try { last.forward_data = JSON.parse(last.forward_data); } catch { last.forward_data = null; }
    unread = await unreadCounts.inChat(userId, chat.id);
    unreadMentions = await unreadCounts.mentionsInChat(userId, chat.id);
    // Служебный чат «Electron»: уведомление, скрытое от этого устройства (его же вход), не попадает ни в превью, ни в счётчик
    if (chat.system_kind && dk) {
      last = await dal.get(`
        SELECT m.id, m.chat_id, m.text, m.iv, m.sent_at, m.edited_at, m.deleted, m.attachment, m.forward_data,
          COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, u.id as sender_id
        FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ? AND (m.hide_dk IS NULL OR m.hide_dk != ?) ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
      `, chat.id, dk);
      unread = (await dal.get(`SELECT COUNT(*) AS c FROM messages m WHERE m.chat_id = ? AND m.sender_id IS NOT ? AND m.deleted = 0 AND (m.hide_dk IS NULL OR m.hide_dk != ?)
        AND m.id > COALESCE((SELECT last_read_id FROM chat_read_state WHERE user_id = ? AND chat_id = ?), 0)`, chat.id, userId, dk, userId, chat.id)).c;
      unreadMentions = 0;
    }
  }
  // Секретный чат: превью в списке никогда не показывает содержимое, даже
  // расшифрованное — защита от подглядывания через плечо. Факт «есть новое
  // сообщение» клиент показывает сам, текст сюда не подставляем вовсе.
  if (chat.is_secret && last) last = { ...last, text: '', iv: null, attachment: null };

  // Статус доставки последнего сообщения — только для своих: в списке чатов
  // рядом со временем показываются галочки. Чужие сообщения статуса не требуют,
  // поэтому лишние запросы для них не делаем.
  if (last && last.sender_id === userId) {
    last.status = await require('../msgstatus').statusOf(last.chat_id || chat.id, { id: last.id, sender_id: userId });
  }

  const mutedRow = await dal.get('SELECT until FROM muted_chats WHERE user_id = ? AND chat_id = ? AND (until IS NULL OR until > unixepoch())', userId, chat.id);
  const muted = !!mutedRow, muted_until = mutedRow?.until || null;
  // Личный чат с человеком из другого пространства: сколько сообщений без ответа ещё можно отправить
  let dm_limit = null;
  if (chat.type === 'direct') {
    const peer = members.find(m => m.id !== userId);
    if (peer) dm_limit = await spaces.limitFor(userId, peer.id);
  }
  // Группа в федерации: зеркало группы с другого сервера (связь, возможность писать) или ожидающие ответа приглашённые
  const { fed_instance, fed_chat_id, ...pub } = chat;
  const fedInfo = {};
  if (fed_instance) { fedInfo.fed_mirror = true; fedInfo.fed_online = await fedgroups.mirrorOnline(chat); }
  else if (chat.type === 'group' || chat.type === 'room') {
    const pend = await fedgroups.pendingFor(chat, userId, !!(await spaces.isAdminUser(userId)));
    if (pend.length) fedInfo.pending = pend;
  }
  return { ...pub, ...fedInfo, members, last_message: last || null, unread, unread_mentions: unreadMentions, has_topics: hasTopics, muted, muted_until, dm_limit };
}

// Приглашение в группу с другого сервера: человек видит только название и кто пригласил, ни участников, ни сообщений
async function inviteChat(chat, userId) {
  return {
    id: chat.id, type: chat.type, name: chat.name, created_at: chat.created_at, created_by: null, is_secret: 0, read_only: 0, pinned: null,
    members: [], last_message: null, unread: 0, unread_mentions: 0, has_topics: false, muted: false, dm_limit: null,
    fed_mirror: true, fed_online: (await fedgroups.mirrorOnline(chat)), invite: (await fedgroups.inviteInfo(chat.id, userId)),
  };
}

// Get my chats
router.get('/', authMiddleware, async (req, res) => {
  const chats = await dal.all(`
    SELECT c.id, c.type, c.name, c.created_at, c.created_by, c.is_secret, c.read_only, c.system_kind, c.fed_instance, c.fed_chat_id, cm.pinned_at as pinned
    FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
    WHERE cm.user_id = ? AND (cm.hidden_at IS NULL OR c.is_secret = 1) AND c.parent_id IS NULL
    ORDER BY (SELECT COALESCE(MAX(sent_at), 0) FROM messages WHERE chat_id = c.id) DESC, c.id DESC
  `, req.user.id);
  const invited = await Promise.all((await dal.all('SELECT c.* FROM chats c JOIN chat_invites i ON i.chat_id = c.id WHERE i.user_id = ? ORDER BY i.created_at DESC', req.user.id))
    .map(c => inviteChat(c, req.user.id)));
  // Служебный чат «Electron» не показывается устройству, от которого скрыты все его сообщения (оно только что вошло)
  const dk = req.user.dk || null;
  const shown = [];
  for (const c of chats) {
    if (c.system_kind && dk && !(await dal.get('SELECT 1 FROM messages WHERE chat_id = ? AND (hide_dk IS NULL OR hide_dk != ?) LIMIT 1', c.id, dk))) continue;
    shown.push(c);
  }
  res.json(invited.concat(await Promise.all(shown.map(c => enrichChat(c, req.user.id, dk)))));
});

// Список тем комнаты
router.get('/:id/topics', authMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, req.user.id)))
    return res.status(403).json({ error: 'Forbidden' });
  // type отдаём явно: без него клиент не опознаёт тему как комнату и
  // подставляет заглушку личного чата — отсюда была буква «Ч» вместо иконки
  const topics = await dal.all(`
    SELECT id, name, position, parent_id, type FROM chats WHERE parent_id = ? ORDER BY position, id
  `, chatId);
  const manual = !!(await dal.get('SELECT topics_manual FROM chats WHERE id = ?', chatId))?.topics_manual;
  const userId = req.user.id;
  const floor = require('../guest').floorOf(userId);   // гость не видит превью сообщений до своего подключения
  const result = await Promise.all(topics.map(async s => {
    const unread = await unreadCounts.inChat(userId, s.id);
    const unreadMentions = await unreadCounts.mentionsInChat(userId, s.id);
    const has_avatar = fs.existsSync(path2.join(AVATAR_DIR, `chat_${s.id}.jpg`));
    // Превью последнего сообщения — как в обычном списке чатов: иначе у всех
    // тем была одинаковая подпись «# тема» и не понять, что нового
    const last = await dal.get(`
      SELECT m.id, m.text, m.sent_at, m.deleted, m.attachment, m.forward_data,
        COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, u.id as sender_id
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = ? AND m.id > ? ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
    `, s.id, floor);
    if (last?.attachment) try { last.attachment = JSON.parse(last.attachment); } catch { last.attachment = null; }
    if (last?.forward_data) try { last.forward_data = JSON.parse(last.forward_data); } catch { last.forward_data = null; }
    return { ...s, unread, unread_mentions: unreadMentions, has_avatar, last_message: last || null };
  }));
  // Автоматическая сортировка: тема с самым свежим сообщением выше, без сообщений — внизу в порядке администратора
  if (!manual) result.sort((a, b) => ((b.last_message?.sent_at || 0) - (a.last_message?.sent_at || 0)));
  res.json(result);
});

const DM_FIND = `
  SELECT c.id FROM chats c
  JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
  JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
  WHERE c.type = 'direct' AND COALESCE(c.is_secret, 0) = 0 LIMIT 1`;

// Create direct chat
router.post('/direct', authMiddleware, async (req, res) => {
  const targetId = Number(req.body.user_id);
  if (!targetId) return res.status(400).json({ error: 'Missing user_id' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot create chat with yourself' });
  const targetUser = await dal.get('SELECT id, is_bot FROM users WHERE id = ?', targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  if (targetUser.is_bot && targetUser.is_bot !== spaces.FED) return res.status(400).json({ error: 'Cannot create direct chat with a bot' });
  // Check existing (including hidden)
  const existing = await dal.get(DM_FIND, req.user.id, targetId);
  if (existing) {
    // Unhide for requester if it was hidden
    await dal.run('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND user_id = ?', existing.id, req.user.id);
    const existingChat = await dal.get('SELECT * FROM chats WHERE id = ?', existing.id);
    return res.json(await enrichChat(existingChat, req.user.id));
  }
  // Новый личный чат можно начать только с тем, кого видишь (своё пространство, контакты)
  if (!(await spaces.canSee(req.user.id, targetId))) return res.status(403).json({ error: 'Этот человек вам недоступен' });
  // Чат и участники — в одной транзакции, чтобы при сбое не оставался чат без участников.
  // Собеседник добавляется скрытым: до первого сообщения у него в списке висела бы
  // пустая переписка, которую он не заводил. Скрытие снимет отправка первого
  // сообщения (ws.js) — тем же механизмом, что и после «удалить у себя».
  // Два одновременных запроса на один и тот же чат не должны создать два: уникального
  // ключа на пару у чата нет, поэтому замок на пару людей и повторная проверка под ним
  const chatId = await dal.tx(async () => {
    await dal.lock(`dm:${Math.min(req.user.id, targetId)}:${Math.max(req.user.id, targetId)}`);
    const again = await dal.get(DM_FIND, req.user.id, targetId);
    if (again) return again.id;
    const result = await dal.run("INSERT INTO chats (type, created_by) VALUES ('direct', ?)", req.user.id);
    const id = result.lastInsertRowid;
    await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', id, req.user.id);
    await dal.run('INSERT INTO chat_members (chat_id, user_id, hidden_at) VALUES (?, ?, unixepoch())', id, targetId);
    return id;
  });
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', chatId);
  res.json(await enrichChat(chat, req.user.id));
});

// Создать секретный (E2E) чат. Отдельная сущность от обычного личного чата с тем
// же собеседником — оба могут существовать одновременно, поэтому поиск уже
// существующего матчит и по is_secret. Создавать может только Electron: у
// веб/мобильного клиента нет надёжного постоянного хранилища для приватного
// ключа (см. обсуждение дизайна секретных чатов).
router.post('/secret', authMiddleware, async (req, res) => {
  const targetId = Number(req.body.user_id);
  const { device_id, device_label, platform } = req.body;
  if (platform !== 'electron') return res.status(403).json({ error: 'Secret chats can only be created from the desktop app' });
  if (!targetId) return res.status(400).json({ error: 'Missing user_id' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot create chat with yourself' });
  if (!device_id) return res.status(400).json({ error: 'Missing device_id' });
  const targetUser = await dal.get('SELECT id, is_bot FROM users WHERE id = ?', targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  if (targetUser.is_bot) return res.status(400).json({ error: targetUser.is_bot === spaces.FED ? 'Секретные чаты с людьми с других серверов недоступны' : 'Cannot create a secret chat with a bot' });
  const existing = await dal.get(`
    SELECT c.id FROM chats c
    JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
    JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct' AND c.is_secret = 1 LIMIT 1
  `, req.user.id, targetId);
  if (existing) {
    const existingChat = await dal.get('SELECT * FROM chats WHERE id = ?', existing.id);
    return res.json({ ...await enrichChat(existingChat, req.user.id), created: false });
  }
  if (!(await spaces.canSee(req.user.id, targetId))) return res.status(403).json({ error: 'Этот человек вам недоступен' });
  // Приглашение видно у собеседника на всех его устройствах сразу (в отличие от
  // обычного личного чата, который скрыт до первого сообщения) — секретный чат
  // никогда не использует hidden_at.
  const chatId = await dal.tx(() => (async () => {
    const result = await dal.run("INSERT INTO chats (type, created_by, is_secret) VALUES ('direct', ?, 1)", req.user.id);
    const id = result.lastInsertRowid;
    await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', id, req.user.id);
    await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', id, targetId);
    // Создатель — первое устройство, одобрять ключ некому: он просто становится
    // держателем ключа по праву первого (axiomatically trusted).
    await dal.run(`INSERT INTO secret_chat_devices (chat_id, user_id, device_id, device_label, platform)
      VALUES (?, ?, ?, ?, 'electron')`, id, req.user.id, device_id, device_label || null);
    return id;
  })());
  sendTo(targetId, { type: 'reload_chats' });
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', chatId);
  res.json({ ...await enrichChat(chat, req.user.id), created: true });
});

// Create group / room — Fix 2: notify all members except creator
router.post('/group', authMiddleware, async (req, res) => {
  const { name, member_ids } = req.body;
  if (!name?.trim() || !Array.isArray(member_ids)) return res.status(400).json({ error: 'Missing fields' });
  const allMembers = [...new Set([req.user.id, ...member_ids.map(Number)])];
  if ((await someAsync(allMembers, async uid => !(await spaces.canSee(req.user.id, uid))))) return res.status(403).json({ error: 'Среди участников есть недоступные вам люди' });
  // Человек из общего пространства с другого сервера — как свой: его можно выбрать при создании группы и он вступит без подтверждения.
  // Остальных людей с других серверов приглашают в уже созданную группу
  const fedIds = (await filterAsync(allMembers, async uid => (await spaces.isFed(uid))));
  if ((await someAsync(fedIds, async uid => !(await spaces.shares(req.user.id, uid))))) return res.status(400).json({ error: 'Людей с других серверов приглашают в уже созданную группу: создайте её и добавьте их участниками' });
  // Чат и участники — в одной транзакции (несуществующий user_id откатит всё, а не оставит пустой чат)
  const chatId = await dal.tx(() => (async () => {
    const result = await dal.run("INSERT INTO chats (type, name, created_by) VALUES ('group', ?, ?)", name.trim(), req.user.id);
    const ins = 'INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)';
    for (const uid of allMembers.filter(uid => !fedIds.includes(uid))) (await dal.run(ins, result.lastInsertRowid, uid)) ;
    return result.lastInsertRowid;
  })());
  // Notify all members except creator
  allMembers.filter(uid => uid !== req.user.id && !fedIds.includes(uid)).forEach(uid => sendTo(uid, { type: 'reload_chats' }));
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', chatId);
  // Люди общего пространства получают приглашение, их сервер принимает его сам
  for (const uid of fedIds) { try { await fedgroups.invite(chat, req.user.id, (await dal.get('SELECT * FROM users WHERE id = ?', uid))); } catch (e) { console.warn('[Fed] приглашение:', e.message); } } ;
  res.json(await enrichChat(chat, req.user.id));
});

// Edit group name
router.patch('/:id', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id);
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Not found' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', req.params.id, req.user.id)))
    return res.status(403).json({ error: 'Not a member' });
  // Название меняет только создатель группы или администратор; зеркало группы с другого сервера не меняет никто
  if (chat.fed_instance) return res.status(403).json({ error: 'Группа находится на другом сервере: её меняет только владелец' });
  if (!(req.user.is_admin || chat.created_by === req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const { name } = req.body;
  if (name?.trim()) {
    await dal.run('UPDATE chats SET name = ? WHERE id = ?', name.trim(), req.params.id);
    await fedgroups.afterRename((await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id)));
    // Точечное событие с готовым объектом чата — участники обновляют имя без refetch всего списка
    const updated = await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id);
    for (const { user_id, pinned_at } of (await dal.all('SELECT user_id, pinned_at FROM chat_members WHERE chat_id = ?', req.params.id)))
      sendTo(user_id, { type: 'chat_updated', chat: { ...await enrichChat(updated, user_id), pinned: pinned_at } });
  }
  res.json(await enrichChat((await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id)), req.user.id));
});

// Add member to group or room. В комнате это админское действие (как и сама
// кнопка в клиенте видна только админам для комнат) — комната управляется
// централизованно, а не её рядовыми участниками, в отличие от группы.
router.post('/:id/members', authMiddleware, async (req, res) => {
  const { user_id } = req.body;
  const chatId = Number(req.params.id);
  const userId = Number(user_id);
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', chatId);
  if (!chat || (chat.type !== 'group' && chat.type !== 'room')) return res.status(404).json({ error: 'Not found' });
  // Состав группы меняет её создатель или администратор, комнаты — администратор; зеркало с другого сервера не меняет никто
  if (chat.fed_instance) return res.status(403).json({ error: 'Группа находится на другом сервере: состав меняет её владелец' });
  if (chat.type === 'room' ? !req.user.is_admin : !(req.user.is_admin || chat.created_by === req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  // В группу добавляют только тех, кого видишь; в комнату любого добавляет администратор
  if (!(await spaces.canSee(req.user.id, userId))) return res.status(403).json({ error: 'Этот человек вам недоступен' });
  if ((await spaces.isFed(userId))) {
    // Человек с другого сервера: только приглашение, он сам решает, вступать ли
    if (chat.parent_id) return res.status(400).json({ error: 'Приглашают в комнату, а не в тему' });
    const r = await fedgroups.invite(chat, req.user.id, (await dal.get('SELECT * FROM users WHERE id = ?', userId)));
    if (r.error) return res.status(400).json({ error: r.error });
    sendTo(req.user.id, { type: 'reload_chats' });
    return res.json({ ok: true, pending: !!r.pending, member: !!r.member });
  }
  const ins = 'INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)';
  await dal.run(ins, chatId, userId);
  // Комната — добавление каскадом идёт и в её подкомнаты (как при добавлении из админки)
  if (chat.type === 'room') {
    for (const s of (await dal.all('SELECT id FROM chats WHERE parent_id = ?', chatId))) (await dal.run(ins, s.id, userId)) ;
  }
  // Notify all members (including newly added) to reload chats
  const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', chatId);
  members.forEach(({ user_id: uid }) => sendTo(uid, { type: 'reload_chats' }));
  await announcements.sendSystemMessage(chatId, `${(await nameOf(req.user.id))} добавил(а) ${(await nameOf(userId))}`, 'member_add');
  await fedgroups.sendState(chat);   // гости видят новый состав
  res.json({ ok: true });
});

// Remove member from group or room
router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id);
  if (!chat || (chat.type !== 'group' && chat.type !== 'room')) return res.status(404).json({ error: 'Not found' });
  // Убирает создатель группы или администратор (комнаты — администратор); зеркало с другого сервера не меняет никто
  if (chat.fed_instance) return res.status(403).json({ error: 'Группа находится на другом сервере: состав меняет её владелец' });
  if (chat.type === 'room' ? !req.user.is_admin : !(req.user.is_admin || chat.created_by === req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const kickedId = Number(req.params.userId);
  const chatId = Number(req.params.id);
  // Гостя «убирают» отзывом его ссылки: доступ закрывается полностью, в чате появляется «отключился»
  if (require('../guest').isGuest(kickedId)) {
    const gl = await dal.get('SELECT id FROM guest_links WHERE guest_user_id = ? AND chat_id = ?', kickedId, chatId);
    if (gl) { await require('../guest').revoke(gl.id, chatId); return res.json({ ok: true }); }
  }
  if ((await spaces.isFed(kickedId))) {
    // Участник с другого сервера или его ожидающее приглашение
    const sh = await dal.get('SELECT * FROM users WHERE id = ?', kickedId);
    const wasMember = !!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, kickedId));
    await fedgroups.removeRemote(chat, sh);
    if (wasMember) {
      await announcements.sendSystemMessage(chatId, `${(await nameOf(req.user.id))} удалил(а) ${(await nameOf(kickedId))}`, 'member_remove');
      (await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', chatId)).forEach(({ user_id: uid }) => sendTo(uid, { type: 'reload_chats' }));
    }
    sendTo(req.user.id, { type: 'reload_chats' });
    return res.json({ ok: true });
  }
  const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?', chatId, kickedId);
  const topics = await dal.all('SELECT id FROM chats WHERE parent_id = ?', chatId);
  const del = 'DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?';
  await dal.tx(() => (async () => {
    await dal.run(del, chatId, kickedId);
    for (const s of topics) (await dal.run(del, s.id, kickedId)) ;
  })());
  topics.forEach(s => sendTo(kickedId, { type: 'chat_deleted', chat_id: s.id }));
  members.forEach(({ user_id: uid }) => sendTo(uid, { type: 'reload_chats' }));
  sendTo(kickedId, { type: 'chat_deleted', chat_id: chatId });
  if (req.user.id !== kickedId) await announcements.sendSystemMessage(chatId, `${(await nameOf(req.user.id))} удалил(а) ${(await nameOf(kickedId))}`, 'member_remove');
  await fedgroups.sendState(chat);
  res.json({ ok: true });
});

// Leave group (not allowed for rooms)
router.post('/:id/leave', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  // Из своей комнаты выйти нельзя, а из комнаты с другого сервера можно: туда человек пришёл по приглашению
  if (chat.fed_instance) return await leaveMirror((await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id)), req, res);
  if (chat.type === 'room') return res.status(403).json({ error: 'Cannot leave a room' });
  await dal.run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', req.params.id, req.user.id);
  // Оставшиеся участники обновляют список, ушедший (все его устройства) убирает чат
  (await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', req.params.id))
    .forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  sendTo(req.user.id, { type: 'chat_deleted', chat_id: Number(req.params.id) });
  await announcements.sendSystemMessage(Number(req.params.id), `${(await nameOf(req.user.id))} покинул(а) группу`, 'member_remove');
  await fedgroups.sendState((await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id)) || { id: 0 });
  res.json({ ok: true });
});

// Выход из зеркала группы с другого сервера: хозяин узнаёт по очереди, у нас группа пропадает
async function leaveMirror(chat, req, res) {
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chat.id, req.user.id))) return res.status(403).json({ error: 'Not a member' });
  await fedgroups.leaveMirror(chat, req.user.id);
  for (const id of (await fedgroups.treeIds(chat.id))) {   // в комнате — и из её тем
    await dal.run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', id, req.user.id);
    sendTo(req.user.id, { type: 'chat_deleted', chat_id: id });
  } ;
  (await dal.all('SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND COALESCE(u.is_bot, 0) = 0', chat.id))
    .forEach(({ user_id }) => sendTo(user_id, { type: 'reload_chats' }));
  await fedgroups.dropMirrorIfEmpty(chat);
  await fedgroups.membersChanged(chat.id);
  res.json({ ok: true });
}

// Приглашение в группу с другого сервера: вступить или отклонить
router.post('/:id/invite/accept', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ? AND fed_instance IS NOT NULL', Number(req.params.id));
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const r = await fedgroups.accept(chat, req.user.id);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json({ ok: true });
});
router.post('/:id/invite/decline', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ? AND fed_instance IS NOT NULL', Number(req.params.id));
  if (!chat) return res.status(404).json({ error: 'Not found' });
  await fedgroups.decline(chat, req.user.id);
  res.json({ ok: true });
});

// Toggle pin (личная настройка — хранится в chat_members конкретного пользователя)
router.post('/:id/pin', authMiddleware, async (req, res) => {
  const row = await dal.get('SELECT pinned_at FROM chat_members WHERE chat_id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!row) return res.status(403).json({ error: 'Not a member' });
  const pinned = row.pinned_at ? null : Math.floor(Date.now() / 1000);
  await dal.run('UPDATE chat_members SET pinned_at = ? WHERE chat_id = ? AND user_id = ?', pinned, req.params.id, req.user.id);
  // Синхронизация на другие устройства пользователя
  sendTo(req.user.id, { type: 'reload_chats' });
  res.json({ ok: true, pinned: !!pinned });
});

// Mute / unmute chat (личная настройка — не получать push-уведомления из этого чата)
router.post('/:id/mute', authMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, req.user.id)))
    return res.status(403).json({ error: 'Forbidden' });
  // seconds — «без звука» на время (до года); без него — навсегда
  const secs = Math.floor(Number(req.body?.seconds));
  const until = secs > 0 ? Math.floor(Date.now() / 1000) + Math.min(secs, 366 * 86400) : null;
  await dal.run('INSERT INTO muted_chats (user_id, chat_id, until) VALUES (?, ?, ?) ON CONFLICT(user_id, chat_id) DO UPDATE SET until = excluded.until', req.user.id, chatId, until);
  // Синхронизация на другие устройства пользователя (как у pin) — без этого
  // статус мьюта на других открытых клиентах обновлялся только после
  // перезапуска/ручного обновления списка чатов
  sendTo(req.user.id, { type: 'reload_chats' });
  res.json({ ok: true });
});

router.delete('/:id/mute', authMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  await dal.run('DELETE FROM muted_chats WHERE user_id = ? AND chat_id = ?', req.user.id, chatId);
  sendTo(req.user.id, { type: 'reload_chats' });
  res.json({ ok: true });
});

// Upload group/chat avatar
router.post('/:id/avatar', authMiddleware, async (req, res) => {
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', req.params.id, req.user.id)))
    return res.status(403).json({ error: 'Forbidden' });
  // Аватарку меняет создатель группы или администратор; зеркало с другого сервера не меняет никто
  if (chat.fed_instance) return res.status(403).json({ error: 'Группа находится на другом сервере: её меняет только владелец' });
  if (chat.type === 'group' && !(req.user.is_admin || chat.created_by === req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });
  try {
    const buf = Buffer.from(data, 'base64');
    const { isImageBuffer } = require('./users');
    if (!isImageBuffer(buf)) return res.status(400).json({ error: 'Not an image' });
    fs.writeFileSync(path2.join(AVATAR_DIR, `chat_${chat.id}.jpg`), buf);
    await fedgroups.afterRename(chat);   // гости получают новую аватарку группы
    res.json({ ok: true, url: `/api/chats/${req.params.id}/avatar` });
  } catch (e) {
    console.error('chat avatar upload error:', e.stack || e);
    res.status(500).json({ error: 'Failed to save avatar' });
  }
});

// Serve group avatar
router.get('/:id/avatar', (req, res) => {
  // id — только целое число: иначе «../» в адресе уводит путь из папки аватарок
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
  const file = path2.join(AVATAR_DIR, `chat_${id}.jpg`);
  // См. пояснение в users.js: с ?t= (клиент версионирует URL при смене аватарки)
  // кэшируем надолго, без него (напр. админка) — коротко
  res.setHeader('Cache-Control', req.query.t ? 'private, max-age=31536000, immutable' : 'private, max-age=60');
  res.sendFile(file, err => { if (err) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); } });
});

// Delete own chat
router.delete('/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const chat = await dal.get('SELECT * FROM chats WHERE id = ?', id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', id, req.user.id)))
    return res.status(403).json({ error: 'Not a member' });
  if (chat.is_secret) {
    // «Удалить» в секретном чате по смыслу — отключение ИМЕННО ЭТОГО устройства
    // (не аккаунта целиком, см. device_id): другие устройства того же пользователя
    // ключ не теряют. hidden_at здесь не используется вовсе — секретный чат виден
    // в списке всегда, клиент сам решает, показывать пиксели или расшифрованное.
    // Учитываются только ОДОБРЕННЫЕ устройства — неодобренное (видевшее только
    // пиксели) ни на что не влияет и просто пропадёт вместе с чатом.
    const deviceId = req.query.device_id;
    if (!deviceId) return res.status(400).json({ error: 'Missing device_id' });
    await dal.run('DELETE FROM secret_chat_devices WHERE chat_id = ? AND user_id = ? AND device_id = ?', id, req.user.id, deviceId);
    const remaining = (await dal.get('SELECT COUNT(*) as c FROM secret_chat_devices WHERE chat_id = ?', id)).c;
    if (remaining === 0) {
      const allMembers = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', id);
      await dal.run('DELETE FROM chats WHERE id = ?', id);
      allMembers.forEach(({ user_id }) => sendTo(user_id, { type: 'chat_deleted', chat_id: id }));
      logAudit(req, 'security', 'Секретный чат удалён безвозвратно', `оба участника отключили все устройства, чат #${id}`);
    } else {
      sendTo(req.user.id, { type: 'reload_chats' });
    }
    return res.json({ ok: true });
  }
  if (chat.type === 'direct') {
    // Soft delete: hide only for this user, other side keeps the chat
    await dal.run('UPDATE chat_members SET hidden_at = unixepoch() WHERE chat_id = ? AND user_id = ?', id, req.user.id);
    // If all members have now hidden the chat — fully delete it
    const visibleCount = (await dal.get('SELECT COUNT(*) as c FROM chat_members WHERE chat_id = ? AND hidden_at IS NULL', id)).c;
    if (visibleCount === 0) {
      const allMembers = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', id);
      await deleteChatFiles(id);
      await dal.run('DELETE FROM chats WHERE id = ?', id);
      allMembers.forEach(({ user_id }) => sendTo(user_id, { type: 'chat_deleted', chat_id: id }));
    } else {
      sendTo(req.user.id, { type: 'chat_deleted', chat_id: id });
    }
  } else {
    // «Удалить» в зеркале группы с другого сервера — то же, что выйти
    if (chat.fed_instance) return await leaveMirror(chat, req, res);
    // Комнатами управляет только админ через админку (DELETE /api/chats/admin/:id)
    if (chat.type === 'room') return res.status(403).json({ error: 'Rooms are managed by admins only' });
    if (!req.user.is_admin && chat.created_by !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', id);
    await fedgroups.dropAll(chat);
    await deleteChatFiles(id);
    await dal.run('DELETE FROM chats WHERE id = ?', id);
    members.forEach(({ user_id }) => sendTo(user_id, { type: 'chat_deleted', chat_id: id }));
  }
  res.json({ ok: true });
});

// Admin: delete any chat — Fix 3: notify all members
router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const chat = await dal.get('SELECT name, type, is_secret FROM chats WHERE id = ?', id);
  const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', id);
  // Группа в федерации: хозяин сообщает гостям об удалении, у зеркала каждый наш участник «выходит» у хозяина
  const full = await dal.get('SELECT * FROM chats WHERE id = ?', id);
  if (full?.fed_instance) for (const r of (await dal.all('SELECT cm.user_id FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND COALESCE(u.is_bot, 0) = 0', id))) (await fedgroups.leaveMirror(full, r.user_id)) ;
  else await fedgroups.dropAll(full);
  // Удаляем вебхуки комнаты и её тем (нет ON DELETE CASCADE на webhooks.chat_id)
  const subIds = (await dal.all('SELECT id FROM chats WHERE parent_id = ?', id)).map(r => r.id);
  for (const cid of [id, ...subIds]) (await dal.run('DELETE FROM webhooks WHERE chat_id = ?', cid)) ;
  for (const cid of subIds) (await deleteChatFiles(cid)) ;
  await deleteChatFiles(id);
  // Безусловное немедленное удаление — не ждёт, пока отключатся все одобренные
  // устройства (secret_chat_devices чистится каскадом вместе с chats)
  await dal.run('DELETE FROM chats WHERE id = ?', id);
  members.forEach(({ user_id }) => sendTo(user_id, { type: 'chat_deleted', chat_id: id }));
  logAudit(req, chat?.is_secret ? 'security' : 'rooms',
    chat?.type === 'room' ? 'Удаление комнаты' : (chat?.is_secret ? 'Удаление секретного чата (админ)' : 'Удаление чата'),
    `«${chat?.name || '?'}»${subIds.length ? `, с ${subIds.length} подкомнатами` : ''}, участников: ${members.length}`);
  res.json({ ok: true });
});

// Admin: clear history
router.delete('/admin/:id/messages', authMiddleware, adminMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  await deleteChatFiles(chatId); // иначе вложения остаются на диске сиротами
  await dal.run('DELETE FROM messages WHERE chat_id = ?', chatId);
  // Уведомляем всех участников чата — очистить историю и обновить превью в списке
  const members = await dal.all('SELECT user_id FROM chat_members WHERE chat_id = ?', chatId);
  members.forEach(m => sendTo(m.user_id, { type: 'chat_cleared', chat_id: chatId }));
  res.json({ ok: true });
});

module.exports = router;
