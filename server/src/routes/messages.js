const attach = require('../attach');
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const dal = require('../dal');
const unreadCounts = require('../unread');
const { authMiddleware } = require('../auth');
const { getPins } = require('../ws');
const guestLib = require('../guest');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');

// Общий SELECT сообщения с данными отправителя и цитаты
const MSG_SELECT = `
  SELECT m.id, m.chat_id, m.text, m.iv, m.sent_at, m.edited_at, m.deleted, m.attachment, m.mentions, m.forward_data, m.link_preview, m.system_kind, (SELECT COUNT(*) FROM messages fx WHERE fx.fwd_src = m.id AND fx.deleted = 0) AS forward_count,
    u.id as sender_id, u.username as sender_username, COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, COALESCE(u.tag, m.guest_tag) as sender_tag, (u.is_bot = 1) as sender_is_bot,
    m.reply_to_id,
    rm.text as reply_text, rm.deleted as reply_deleted, rm.attachment as reply_attachment,
    COALESCE(ru.display_name, rm.guest_name, 'Удалённый аккаунт') as reply_sender_name, (ru.is_bot = 1) as reply_sender_is_bot,
      ru.id as reply_sender_id, COALESCE(ru.tag, rm.guest_tag) as reply_sender_tag
  FROM messages m LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = rm.sender_id
`;

// Полнотекстовый поиск по чатам пользователя (FTS5). Маркеры выделения — \x01/\x02,
// клиент экранирует текст и заменяет их на <b>/</b>.
router.get('/search', authMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const terms = q.split(/\s+/).slice(0, 8).map(t => t.replace(dal.pg ? /[^\p{L}\p{N}_]/gu : /["]/g, '')).filter(Boolean);
  if (!terms.length) return res.json({ results: [] });
  // SQLite: FTS5, префиксный поиск по каждому слову. PostgreSQL: tsvector с русской
  // морфологией (колонка messages.tsv), каждое слово — префикс основы.
  const ftsQuery = dal.pg ? terms.map(t => t + ':*').join(' & ') : terms.map(t => '"' + t + '"*').join(' ');
  // chat_id — поиск внутри одного чата (строка поиска в чате): вся история, без
  // ограничения по числу чатов; членство проверяется тем же join, что и в общем поиске
  const chatId = Number.isInteger(Number(req.query.chat_id)) && Number(req.query.chat_id) > 0 ? Number(req.query.chat_id) : null;
  let rows = [];
  try {
    const limit = chatId ? 1000 : 30;
    if (dal.pg) {
      // Подсветка только у отобранных строк: ts_headline дорогая
      rows = await dal.all(`
        SELECT t.id, t.chat_id, t.sent_at, t.sender_id, t.sender_name, t.sender_is_bot,
          ts_headline('russian', t.text, to_tsquery('russian', ?), ?) AS snippet
        FROM (
          SELECT m.id, m.chat_id, m.sent_at, m.text, u.id AS sender_id,
            COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') AS sender_name, (u.is_bot = 1) AS sender_is_bot
          FROM messages m
          JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ? AND cm.hidden_at IS NULL
          JOIN chats c ON c.id = m.chat_id AND c.is_secret = 0
          LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.tsv @@ to_tsquery('russian', ?) AND m.deleted = 0 ${chatId ? 'AND m.chat_id = ?' : ''}
          ORDER BY m.sent_at DESC, m.id DESC LIMIT ${limit}
        ) t ORDER BY t.sent_at DESC, t.id DESC
      `, ftsQuery, `StartSel=${String.fromCharCode(1)}, StopSel=${String.fromCharCode(2)}, MaxWords=14, MinWords=6, ShortWord=1, MaxFragments=1`,
        ...(chatId ? [req.user.id, ftsQuery, chatId] : [req.user.id, ftsQuery]));
    } else {
      rows = await dal.all(`
        SELECT m.id, m.chat_id, m.sent_at, u.id as sender_id,
          COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') as sender_name, (u.is_bot = 1) as sender_is_bot,
          snippet(messages_fts, 0, char(1), char(2), '…', 10) as snippet
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ? AND cm.hidden_at IS NULL
        JOIN chats c ON c.id = m.chat_id AND c.is_secret = 0
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE messages_fts MATCH ? AND m.deleted = 0 ${chatId ? 'AND m.chat_id = ?' : ''}
        ORDER BY m.sent_at DESC, m.id DESC LIMIT ${limit}
      `, ...(chatId ? [req.user.id, ftsQuery, chatId] : [req.user.id, ftsQuery]));
    }
  } catch (e) { console.error('[FTS] search error:', e.message); }
  // У сообщений ботов в тексте настоящий HTML (<b>, <i>...), который клиент не
  // экранирует (как и в самом пузыре). snippet() режет текст по токенам, и
  // многоточие-обрезание может попасть прямо внутрь тега (напр. «<b…» без «>»
  // или «…b>» без «<») — целый тег убрать легко, а такой огрызок на границе
  // среза нужно чистить отдельно, иначе буква имени тега (b/i/u...) остаётся
  // текстом, а необработанный «<»/«>» ломает HTML соседних строк списка.
  rows.forEach(r => {
    if (!r.sender_is_bot) return;
    r.snippet = r.snippet
      .replace(/^(…?)\/?[a-z]*>/i, '$1')          // обрубленное начало тега (< срезано слева)
      .replace(/<\/?[a-z]*(…?)$/i, '$1')          // обрубленный конец тега (> срезано справа)
      .replace(/<\/?(?:b|i|u|blockquote|br)\s*>/gi, '') // целые теги внутри сниппета
      .replace(/[<>]/g, '');                       // подстраховка от прочих огрызков
  });
  res.json({ results: rows });
});

// «Медиа чата»: вложения и ссылки одним списком, без переписки вокруг.
// type: media (фото и видео), files (остальные файлы), links (сообщения со ссылками); before — id сообщения, с которого читать вниз
router.get('/chat/:chatId/media', authMiddleware, async (req, res) => {
  const chatId = Number(req.params.chatId), type = String(req.query.type || 'media');
  if (!['media', 'files', 'links'].includes(type)) return res.status(400).json({ error: 'Некорректный тип' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, req.user.id)))
    return res.status(403).json({ error: 'Not a member' });
  // Секретный чат: сервер не знает ни типов, ни ссылок, всё зашифровано
  if ((await dal.get('SELECT is_secret FROM chats WHERE id = ?', chatId))?.is_secret) return res.json({ items: [], more: false, cursor: null });
  const limit = Math.min(parseInt(req.query.limit) || 60, 120);
  let cursor = req.query.before ? parseInt(req.query.before) : Number.MAX_SAFE_INTEGER;
  const where = type === 'links' ? "(m.text LIKE '%http://%' OR m.text LIKE '%https://%')" : "m.attachment LIKE '%\"url\"%'";
  const stmt = `SELECT m.id, m.sent_at, m.text, m.attachment, m.link_preview, COALESCE(u.display_name, m.guest_name, 'Удалённый аккаунт') AS sender_name, u.id AS sender_id
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.chat_id = ? AND m.deleted = 0 AND m.id < ? AND ${where} ORDER BY m.id DESC LIMIT 200`;
  const isMedia = a => /^(image|video)\//.test(a.mime || '');
  const items = []; let more = false;
  outer: for (;;) {
    const rows = await dal.all(stmt, chatId, cursor);
    for (const m of rows) {
      cursor = m.id;
      const base = { message_id: m.id, sent_at: m.sent_at, sender_id: m.sender_id, sender_name: m.sender_name };
      if (type === 'links') {
        const urls = [...new Set((m.text.match(/https?:\/\/[^\s<>"')]+/g) || []).map(u => u.replace(/[.,;:!?]+$/, '')))].slice(0, 5);
        if (!urls.length) continue;
        let lp = null; try { lp = m.link_preview ? JSON.parse(m.link_preview) : null; } catch {}
        items.push({ ...base, urls, title: lp?.title || null, site: lp?.site || null, image: lp?.image || null, text: m.text.slice(0, 200) });
      } else {
        let att; try { att = JSON.parse(m.attachment); } catch { continue; }
        if (!att?.url || att.enc) continue;
        attach.list(attach.markExpired(att)).forEach((a, idx) => {
          if (a.expired || !a.url || (type === 'media') !== isMedia(a)) return;
          items.push({ ...base, idx, att: { url: a.url, thumb: a.thumb || null, name: a.name || null, mime: a.mime || '', size: a.size || 0, width: a.width || null, height: a.height || null }, caption: idx === 0 ? (m.text || '').slice(0, 200) : '' });
        });
      }
      if (items.length >= limit) { more = true; break outer; }
    }
    if (rows.length < 200) break;
  }
  res.json({ items, more, cursor: more ? cursor : null });
});

// Получить сообщения чата с пагинацией (query: before | after | around, limit)
router.get('/chat/:chatId', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, req.user.id)))
    return res.status(403).json({ error: 'Not a member' });

  // Гость видит только сообщения после своего подключения: порог — номер сообщения, в SQL он вставляется числом
  const gfloor = guestLib.floorOf(req.user.id);
  const FL = gfloor ? ` AND m.id > ${Number(gfloor)}` : '';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? parseInt(req.query.before) : null;
  const after  = req.query.after  ? parseInt(req.query.after)  : null;
  const around = req.query.around ? parseInt(req.query.around) : null;

  // Первое непрочитанное считаем на сервере: у клиента счётчик мог разойтись,
  // часть могла быть прочитана с другого устройства, а при большом числе новых
  // сообщений нужного просто нет в последней странице.
  let firstUnreadId = await unreadCounts.firstUnreadId(req.user.id, chatId);
  if (gfloor && firstUnreadId && firstUnreadId <= gfloor) firstUnreadId = null;

  let messages, hasMore = false, hasMoreAfter = false;

  if (req.query.anchor === 'unread' && firstUnreadId) {
    // Окно, открывающееся на первом непрочитанном: немного переписки выше для
    // контекста, остальное место отдаём новым сообщениям
    const ctx = Math.min(20, limit);
    const beforeRows = await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id < ? ORDER BY m.id DESC LIMIT ?`, chatId, firstUnreadId, ctx);
    const afterRows = await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id >= ? ORDER BY m.id ASC LIMIT ?`, chatId, firstUnreadId, limit + 1);
    hasMore = beforeRows.length === ctx;
    hasMoreAfter = afterRows.length === limit + 1;
    if (hasMoreAfter) afterRows.pop();
    messages = beforeRows.reverse().concat(afterRows);
  } else if (around) {
    // Окно вокруг сообщения: для перехода из поиска или к цитате
    const half = Math.floor(limit / 2);
    const beforeRows = await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id < ? ORDER BY m.id DESC LIMIT ?`, chatId, around, half);
    const afterRows = await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id >= ? ORDER BY m.id ASC LIMIT ?`, chatId, around, half + 2);
    hasMore = beforeRows.length === half;
    hasMoreAfter = afterRows.length === half + 2;
    if (hasMoreAfter) afterRows.pop();
    messages = beforeRows.reverse().concat(afterRows);
  } else if (after) {
    // Догрузка вниз (после перехода вглубь истории)
    const rows = await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id > ? ORDER BY m.id ASC LIMIT ?`, chatId, after, limit);
    hasMoreAfter = rows.length === limit;
    messages = rows;
  } else {
    // Обычная загрузка: последние limit или страница выше before
    const rows = before
      ? (await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} AND m.id < ? ORDER BY m.id DESC LIMIT ?`, chatId, before, limit))
      : (await dal.all(`${MSG_SELECT} WHERE m.chat_id = ?${FL} ORDER BY m.id DESC LIMIT ?`, chatId, limit));
    hasMore = rows.length === limit;
    messages = rows.reverse();
  }

  // Получателей считаем по каждому автору отдельно: сам автор не получатель, а в группах люди с других серверов не учитываются
  const totals = new Map();
  const totalFor = async senderId => { if (!totals.has(senderId)) totals.set(senderId, (await require('../spaces').recipientCount(chatId, senderId))); return totals.get(senderId); };

  // Статусы и реакции — тремя запросами на всю страницу вместо трёх на каждое сообщение
  const ids = messages.map(m => m.id);
  const ph = ids.map(() => '?').join(',');
  const deliveredMap = new Map(), readMap = new Map(), reactionsMap = new Map();
  if (ids.length) {
    (await dal.all(`SELECT message_id, COUNT(delivered_at) as d, COUNT(read_at) as r FROM message_status WHERE message_id IN (${ph}) GROUP BY message_id`, ...ids)).forEach(row => { deliveredMap.set(row.message_id, row.d); readMap.set(row.message_id, row.r); });
    (await dal.all(`SELECT message_id, reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id IN (${ph}) GROUP BY message_id, reaction`, ...ids)).forEach(row => {
        if (!reactionsMap.has(row.message_id)) reactionsMap.set(row.message_id, []);
        // user_ids — чтобы клиент показал аватарки поставивших рядом со смайликом
        reactionsMap.get(row.message_id).push({ reaction: row.reaction, count: row.count, user_ids: row.user_ids });
      });
  }

  const result = (await Promise.all(messages.map(async m => {
    let attachment = null;
    if (m.attachment) { try { attachment = JSON.parse(m.attachment); } catch {} }
    if (attachment?.url) attachment = attach.markExpired(attachment);
    let mentions = null;
    if (m.mentions) { try { mentions = JSON.parse(m.mentions); } catch {} }
    let reply_attachment = null;
    if (m.reply_attachment) { try { reply_attachment = JSON.parse(m.reply_attachment); } catch {} }
    let forward_data = null;
    if (m.forward_data) { try { forward_data = JSON.parse(m.forward_data); } catch {} }
    let link_preview = null;
    if (m.link_preview) { try { link_preview = JSON.parse(m.link_preview); } catch {} }
    return {
      ...m, attachment, mentions, reply_attachment, forward_data, link_preview,
      status: { delivered: deliveredMap.get(m.id) || 0, read: readMap.get(m.id) || 0, total: (await totalFor(m.sender_id)) },
      reactions: reactionsMap.get(m.id) || [],
    };
  })));

  // Закреплённые отдаём вместе с историей — отдельный запрос при каждом
  // открытии чата не нужен
  res.json({ messages: guestLib.sanitizeRows(req.user.id, result), hasMore, hasMoreAfter, pins: (await getPins(chatId, gfloor)), first_unread_id: firstUnreadId });
});

// Кто поставил реакции на сообщение — для тултипа при наведении.
// Отдельным запросом по наведению, а не в каждом сообщении: имена нужны редко,
// а в выдаче истории они раздували бы каждый ответ.
router.get('/:messageId/reactions', authMiddleware, async (req, res) => {
  const msg = await dal.get('SELECT chat_id FROM messages WHERE id = ?', req.params.messageId);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', msg.chat_id, req.user.id)))
    return res.status(403).json({ error: 'Forbidden' });
  if (Number(req.params.messageId) <= guestLib.floorOf(req.user.id)) return res.status(404).json({ error: 'Not found' });

  const rows = await dal.all(`
    SELECT r.reaction, r.user_id, COALESCE(u.display_name, 'Удалённый аккаунт') AS display_name
    FROM reactions r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.message_id = ?
    ORDER BY r.rowid ASC
  `, req.params.messageId);

  const byReaction = {};
  rows.forEach(r => {
    if (!byReaction[r.reaction]) byReaction[r.reaction] = [];
    byReaction[r.reaction].push({ user_id: r.user_id, display_name: r.display_name });
  });
  res.json(byReaction);
});

// Получить детальную информацию о доставке/прочтении одного сообщения
router.get('/:messageId/info', authMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const msg = await dal.get('SELECT m.*, c.type as chat_type FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = ?', messageId);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', msg.chat_id, req.user.id)))
    return res.status(403).json({ error: 'Forbidden' });

  const statuses = await dal.all(`
    SELECT u.id as user_id, u.display_name, ms.delivered_at, ms.read_at
    FROM message_status ms JOIN users u ON u.id = ms.user_id
    WHERE ms.message_id = ? ORDER BY ms.read_at ASC NULLS FIRST, ms.delivered_at ASC NULLS FIRST
  `, messageId);

  res.json({ chat_type: msg.chat_type, sent_at: msg.sent_at, statuses });
});

module.exports = router;
