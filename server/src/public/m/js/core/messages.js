// /m — ядро: сообщения открытого чата (загрузка, подгрузка истории, отправка, правка, удаление, реакции,
// обновления по WebSocket). Вёрстки здесь нет: экран переписки слушает события 'msgs:*'.
//   msgs:opened {chatId, aroundId}  — чат открыт, B.msgs.cache заполнен
//   msgs:changed {mode}             — состав или вид сообщений изменился ('smart' — не дёргать прокрутку)
//   msgs:older                      — подгружена более ранняя страница
//   msgs:new {message, mine}        — пришло новое сообщение
//   msgs:preview {chatId}           — до ответа сервера в B.msgs.cache положен кэшированный хвост переписки (лёгкая первая отрисовка)
B.msgs = {
  PAGE: 100,
  chatId: null, cache: [], unreadAtOpen: 0, hasMoreOlder: false, loadingOlder: false, _applied: {},

  // Хвост переписки (последние сообщения) по чатам: чат открывается сразу с сообщениями, а не с пустой страницей,
  // пока идёт запрос. Живёт в sessionStorage вкладки и стирается при выходе. Скрытые чаты не храним: их ещё надо расшифровать
  TAIL_N: 30, PREV_N: 15, _tail: null, _tailT: 0,
  tail: function (id) {
    var M = B.msgs;
    if (!M._tail) { try { M._tail = JSON.parse(sessionStorage.getItem('m.tail') || '{}'); } catch (e) { M._tail = {}; } }
    return id == null ? M._tail : M._tail[id];
  },
  saveTail: function () {
    var M = B.msgs, id = M.chatId; if (id == null || M._preview || B.S.secretChatIds.has(id)) return;   // пока показан хвост из кэша, его не пересохраняем
    var t = M.tail(), real = M.cache.filter(function (m) { return !m._optimistic && m.id > 0; }).slice(-M.TAIL_N);
    if (!real.length) return;
    t[id] = { t: Date.now(), m: real };
    var ids = Object.keys(t).sort(function (a, b) { return t[b].t - t[a].t; });
    ids.slice(12).forEach(function (k) { delete t[k]; });   // помним только последние 12 чатов
    clearTimeout(M._tailT);
    M._tailT = setTimeout(function () { try { sessionStorage.setItem('m.tail', JSON.stringify(t)); } catch (e) { try { sessionStorage.removeItem('m.tail'); } catch (e2) {} } }, 800);
  },
  find: function (id) { return B.msgs.cache.find(function (m) { return m.id === id; }); },
  chat: function () { return B.find(B.msgs.chatId); },

  // Открыть чат: окно последних сообщений либо окно вокруг aroundId (переход из поиска или цитаты)
  open: async function (chatId, aroundId) {
    var M = B.msgs, S = B.S;
    M.chatId = chatId; S.activeChatId = chatId; M.cache = []; M.hasMoreOlder = false; M._applied = {};
    var chat = B.find(chatId); if (!chat) return;
    // Приглашение в группу с другого сервера: сообщений до вступления нет, историю не запрашиваем
    if (chat.invite) { M.cache = []; M._preview = false; M.watch(chat); B.bus.emit('msgs:opened', { chatId: chatId }); return; }
    M.watch(chat);
    // Есть хвост этой переписки: показываем его сразу, до ответа сервера
    var tl = !aroundId && !B.S.secretChatIds.has(chatId) && M.tail(chatId);
    if (tl && tl.m && tl.m.length) { M.cache = tl.m.slice(-M.PREV_N); M._preview = true; B.bus.emit('msgs:preview', { chatId: chatId }); } else M._preview = false;
    var data = await B.api('GET', '/messages/chat/' + chatId + '?limit=' + M.PAGE + (aroundId ? '&around=' + aroundId : ''));
    if (!data || M.chatId !== chatId) return;
    M.cache = data.messages || []; M.hasMoreOlder = !!data.hasMore; M._preview = false;
    M.unreadAtOpen = chat.unread || 0;
    chat.unread = 0; chat.unread_mentions = 0;
    if (chat.parent_id) {
      var topic = (S.topics[chat.parent_id] || []).find(function (t) { return t.id === chatId; });
      if (topic) { topic.unread = 0; topic.unread_mentions = 0; }
      B.chats.syncRoomUnread(chat.parent_id);
    }
    B.chats.onChanged();
    B.ws.send({ type: 'read', chat_id: chatId });
    // Отметка применяется на сервере после отправки по WS — подтверждаем агрегат комнаты уже после неё
    if (chat.parent_id) setTimeout(B.chats.refresh, 400);
    B.bus.emit('msgs:opened', { chatId: chatId, aroundId: aroundId });
  },
  // Сообщаем серверу, какой чат открыт: он присылает и обновляет «в сети N из M»
  watch: function (chat) {
    var on = chat && (chat.type === 'group' || chat.type === 'room') && !chat.invite && !chat.has_topics;
    B.ws.send(on ? { type: 'watch_chat', chat_id: chat.id } : { type: 'unwatch_chat' });
  },
  close: function () { var M = B.msgs; B.ws.send({ type: 'unwatch_chat' }); M.chatId = null; B.S.activeChatId = null; M.cache = []; M.hasMoreOlder = false; M.loadingOlder = false; },

  loadOlder: async function () {
    var M = B.msgs, chatId = M.chatId, oldest = M.cache[0];
    if (!chatId || !M.hasMoreOlder || M.loadingOlder || !oldest) return;
    M.loadingOlder = true;
    var data = await B.api('GET', '/messages/chat/' + chatId + '?limit=' + M.PAGE + '&before=' + oldest.id);
    M.loadingOlder = false;
    if (!data || M.chatId !== chatId) return;
    M.hasMoreOlder = !!data.hasMore;
    if (!data.messages || !data.messages.length) return;
    M.cache = data.messages.concat(M.cache);
    B.bus.emit('msgs:older');
  },

  // Новые сообщения открытого чата, пришедшие, пока приложение было свёрнуто или без связи (события по WebSocket пропущены)
  catchUp: async function () {
    var M = B.msgs, id = M.chatId; if (!id || !M.cache.length) return;
    var real = M.cache.filter(function (x) { return x.id > 0; }), last = real[real.length - 1]; if (!last) return;
    var data = await B.api('GET', '/messages/chat/' + id + '?after=' + last.id + '&limit=50');
    if (!data || !data.messages || M.chatId !== id) return;
    var fresh = data.messages.filter(function (m) { return !M.find(m.id); }).sort(function (a, b) { return a.id - b.id; });
    if (!fresh.length) return;
    fresh.forEach(function (m) {
      var mine = m.sender_id === B.S.user.id;
      if (mine) M.cache = M.cache.filter(function (x) { return !x._optimistic; });
      M.cache.push(m);
      B.bus.emit('msgs:new', { message: m, mine: mine });
      if (!mine) B.ws.send({ type: 'delivered', message_id: m.id });
    });
    B.bus.emit('msgs:changed', { mode: 'smart' });
    B.ws.send({ type: 'read', chat_id: id });
  },

  // Пока связи не было, сообщения могли удалить или исправить, а события телефон пропустил
  resync: async function () {
    var M = B.msgs, id = M.chatId; if (!id || !M.cache.length) return;
    var data = await B.api('GET', '/messages/chat/' + id + '?limit=200');
    if (!data || !data.messages || M.chatId !== id) return;
    var changed = false;
    data.messages.forEach(function (fm) {
      var m = M.find(fm.id); if (!m) return;
      if (fm.deleted && !m.deleted) { m.deleted = 1; m.text = ''; m.attachment = null; changed = true; }
      else if (fm.edited_at && fm.edited_at !== m.edited_at) { m.text = fm.text; m.edited_at = fm.edited_at; m.link_preview = fm.link_preview || null; changed = true; }
    });
    if (changed) B.bus.emit('msgs:changed', { mode: 'smart' });
  },

  // ── ограничения отправки ──
  isReadOnly: function (chat) {
    if (!chat) return false;
    if (chat.read_only) return true;
    if (chat.parent_id) { var p = B.find(chat.parent_id); return !!(p && p.read_only); }
    return false;
  },
  // «Сообщений без ответа» (люди из разных пространств): сервер отдаёт dm_limit = { used, max }
  dmLocked: function (chat) { return !!(chat && chat.dm_limit && chat.dm_limit.used >= chat.dm_limit.max); },
  // Группа с другого сервера (зеркало): без связи с сервером писать в неё нельзя
  fedOffline: function (chat) { return !!(chat && chat.fed_mirror && !chat.invite && chat.fed_online === false); },
  locked: function (chat) { return B.msgs.isReadOnly(chat) || B.msgs.dmLocked(chat) || !!(chat && chat.invite) || B.msgs.fedOffline(chat) || (!!chat && B.secret.locked(chat.id)); },
  note: function (chat) {
    if (B.msgs.isReadOnly(chat)) return { text: 'Доступно только для чтения', soft: false };
    if (B.msgs.dmLocked(chat)) return { text: 'Больше писать нельзя: собеседник не ответил и не добавил вас в контакты', soft: false };
    if (B.msgs.fedOffline(chat)) return { text: 'Группа на другом сервере, связи с ним нет. Писать пока нельзя', soft: false };
    var l = chat && chat.dm_limit;
    if (l && l.used > 0) return { text: 'Без ответа: ' + l.used + ' из ' + l.max + '. Дальше нужно дождаться ответа или добавления в контакты', soft: true };
    return null;
  },

  // ── отправка и действия ──
  // o = { text, reply: {id, senderName, text}, attachment, forward } — возвращает Promise<true>, если ушло в сеть
  send: async function (o) {
    var M = B.msgs, S = B.S, chat = M.chat();
    if (!chat || B.msgs.locked(chat)) return false;
    var text = (o.text || '').trim();
    if (!text && !o.attachment && !o.forward) return false;
    if (!B.ws.isOpen()) { B.toast.show('Нет связи с сервером'); return false; }
    var payload = { type: 'message', chat_id: chat.id, text: text };
    var temp = { id: -Date.now(), chat_id: chat.id, sender_id: S.user.id, text: text, sent_at: Math.floor(Date.now() / 1000), deleted: 0, status: { delivered: 0, read: 0, total: 1 }, _optimistic: true };
    if (o.reply) { payload.reply_to_id = temp.reply_to_id = o.reply.id; temp.reply_sender_name = o.reply.senderName; temp.reply_text = o.reply.text; temp.reply_sender_id = o.reply.senderId; temp.reply_sender_tag = o.reply.senderTag; }
    if (o.attachment) { payload.attachment = temp.attachment = o.attachment; }
    if (o.forward) { payload.forward_data = temp.forward_data = o.forward; }
    if (o.linkPreview && !S.secretChatIds.has(chat.id)) { payload.link_preview = temp.link_preview = o.linkPreview; }
    if (S.secretChatIds.has(chat.id) && !(await B.secret.seal(chat.id, payload, temp, text))) return false;
    M.cache.push(temp);
    B.bus.emit('msgs:changed', { mode: 'bottom' });
    B.ws.send(payload);
    return true;
  },
  edit: function (id, text, lp) { B.ws.send({ type: 'edit_message', message_id: id, text: text, link_preview: lp || null }); },
  remove: function (id) { B.ws.send({ type: 'delete_message', message_id: id }); },
  react: function (id, reaction) { B.ws.send({ type: 'react', message_id: id, reaction: reaction }); },
  typing: function () { B.presence.sendTyping(B.msgs.chatId); }
};

// ── обновления по WebSocket для открытого чата ──
(function () {
  var M = B.msgs, bus = B.bus;
  bus.on('ws:connected', function () { M.resync(); M.catchUp(); });
  bus.on('ws:message', function (d) {
    var m = d.message; if (m.chat_id !== M.chatId) return;
    var mine = m.sender_id === B.S.user.id;
    if (mine) M.cache = M.cache.filter(function (x) { return !x._optimistic; });
    M.cache.push(m);
    bus.emit('msgs:new', { message: m, mine: mine });
    bus.emit('msgs:changed', { mode: 'smart' });
    B.ws.send({ type: 'read', chat_id: m.chat_id });
    if (!mine) B.ws.send({ type: 'delivered', message_id: m.id });
  });
  bus.on('ws:message_edited', function (d) {
    var m = d.message, i = M.cache.findIndex(function (x) { return x.id === m.id; });
    if (i >= 0) { M.cache[i] = m; bus.emit('msgs:changed', { mode: 'smart' }); }
  });
  bus.on('ws:message_deleted', function (d) {
    var m = M.find(d.message_id);
    if (m) { m.deleted = 1; m.text = ''; m.attachment = null; bus.emit('msgs:changed', { mode: 'smart' }); }
  });
  bus.on('ws:status_update', function (d) {
    var m = M.find(d.message && d.message.id);
    if (m && d.message.status) { m.status = Object.assign({}, d.message.status); bus.emit('msgs:changed', { mode: 'smart' }); }
  });
  bus.on('ws:status_range', function (d) {
    if (d.chat_id !== M.chatId) return;
    var changed = false;
    M.cache.forEach(function (m) {
      if (m.sender_id !== B.S.user.id || !m.status || m.id < d.min_id || m.id > d.max_id) return;
      var key = m.id + ':' + d.kind + ':' + d.reader_id;
      if (M._applied[key]) return; M._applied[key] = true;
      if (d.kind === 'read') { m.status.read = Math.min(m.status.total, m.status.read + 1); m.status.delivered = Math.max(m.status.delivered, m.status.read); }
      else m.status.delivered = Math.min(m.status.total, m.status.delivered + 1);
      changed = true;
    });
    if (changed) bus.emit('msgs:changed', { mode: 'smart' });
  });
  bus.on('ws:reaction_update', function (d) {
    var m = M.find(d.message_id);
    if (m) { m.reactions = d.counts; bus.emit('msgs:changed', { mode: 'smart' }); }
  });
})();

// Хвост переписки обновляем, когда чат открыт, пришло новое или изменилось; при выходе стираем
['msgs:opened', 'msgs:new', 'msgs:changed'].forEach(function (ev) { B.bus.on(ev, function () { B.msgs.saveTail(); }); });
B.bus.on('auth:logout', function () { B.msgs._tail = {}; try { sessionStorage.removeItem('m.tail'); } catch (e) {} });
