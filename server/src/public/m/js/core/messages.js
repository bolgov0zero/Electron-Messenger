// /m — ядро: сообщения открытого чата (загрузка, подгрузка истории, отправка, правка, удаление, реакции,
// обновления по WebSocket). Вёрстки здесь нет: экран переписки слушает события 'msgs:*'.
//   msgs:opened {chatId, aroundId}  — чат открыт, B.msgs.cache заполнен
//   msgs:changed {mode}             — состав или вид сообщений изменился ('smart' — не дёргать прокрутку)
//   msgs:older                      — подгружена более ранняя страница
//   msgs:new {message, mine}        — пришло новое сообщение
//   msgs:preview {chatId}           — до ответа сервера в B.msgs.cache положен кэшированный хвост переписки (лёгкая первая отрисовка)
B.msgs = {
  PAGE: 100,
  chatId: null, cache: [], unreadAtOpen: 0, unreadFromId: null, hasMoreOlder: false, loadingOlder: false, _applied: {},

  // Хвост переписки (последние сообщения) по чатам: чат открывается сразу с сообщениями, а не с пустой страницей,
  // пока идёт запрос. Хранится на устройстве (localStorage), нужен и для открытия чата без связи; стирается при выходе. Скрытые чаты не храним: их ещё надо расшифровать
  TAIL_N: 30, PREV_N: 15, _tail: null, _tailT: 0,
  tail: function (id) {
    var M = B.msgs;
    if (!M._tail) { try { M._tail = JSON.parse(localStorage.getItem('m.tail') || '{}'); } catch (e) { M._tail = {}; } }
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
    // Запись и разбор JSON — в простое браузера, а не посреди прокрутки
    M._tailT = setTimeout(function () { (window.requestIdleCallback || function (f) { setTimeout(f, 50); })(function () { try { localStorage.setItem('m.tail', JSON.stringify(t)); } catch (e) { try { localStorage.removeItem('m.tail'); } catch (e2) {} } }); }, 800);
  },
  find: function (id) { return B.msgs.cache.find(function (m) { return m.id === id; }); },
  chat: function () { return B.find(B.msgs.chatId); },

  // Открыть чат: окно последних сообщений либо окно вокруг aroundId (переход из поиска или цитаты)
  open: async function (chatId, aroundId) {
    var M = B.msgs, S = B.S;
    M.chatId = chatId; S.activeChatId = chatId; M.cache = []; M.hasMoreOlder = false; M._applied = {}; M.unreadFromId = null; M.unreadAtOpen = 0;
    var chat = B.find(chatId); if (!chat) return;
    // Приглашение в группу с другого сервера: сообщений до вступления нет, историю не запрашиваем
    if (chat.invite) { M.cache = []; M._preview = false; M.watch(chat); B.bus.emit('msgs:opened', { chatId: chatId }); return; }
    M.watch(chat);
    // Есть хвост этой переписки: показываем его сразу, до ответа сервера
    var tl = !aroundId && !B.S.secretChatIds.has(chatId) && M.tail(chatId);
    if (tl && tl.m && tl.m.length) { M.cache = tl.m.slice(-M.PREV_N); M._preview = true; B.bus.emit('msgs:preview', { chatId: chatId }); } else M._preview = false;
    var data = await B.api('GET', '/messages/chat/' + chatId + '?limit=' + M.PAGE + (aroundId ? '&around=' + aroundId : ''));
    if (!data && M.chatId === chatId && tl && tl.m && tl.m.length) {
      // Связи нет: показываем сохранённый хвост переписки и неотправленное
      M.cache = tl.m.slice(); M._preview = false; M.hasMoreOlder = false; M.restoreOutbox(chatId);
      B.bus.emit('msgs:opened', { chatId: chatId }); return;
    }
    if (!data || M.chatId !== chatId) return;
    M.cache = data.messages || []; M.hasMoreOlder = !!data.hasMore; M._preview = false; M.restoreOutbox(chatId);
    M.unreadAtOpen = chat.unread || 0;
    // Плашка «Новые сообщения» привязана к конкретному сообщению: если считать от конца ленты, она ползла бы вниз
    // при каждом новом сообщении, в том числе при своём
    var fu = data.first_unread_id;
    M.unreadFromId = fu && M.cache.some(function (m) { return m.id === fu; }) ? fu : (M.unreadAtOpen > 0 && M.unreadAtOpen <= M.cache.length ? M.cache[M.cache.length - M.unreadAtOpen].id : null);
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
      if (mine && m.client_id) M._confirm(m.client_id);
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
  // У темы состояние связи общее с комнатой, в которой она лежит
  fedRoot: function (chat) { return (chat && chat.parent_id && B.find(chat.parent_id)) || chat; },
  fedOffline: function (chat) { var c = B.msgs.fedRoot(chat); return !!(c && c.fed_mirror && !c.invite && c.fed_online === false); },
  fedKind: function (chat) { return chat && chat.type === 'room' ? 'комнату' : 'группу'; },
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
  // o = { text, reply: {id, senderName, text}, attachment, forward } — возвращает Promise<true>, если сообщение принято в очередь.
  // Если связи нет, оно остаётся в очереди с пометкой «Не отправлено» и уходит само, когда связь вернётся
  send: async function (o) {
    var M = B.msgs, S = B.S, chat = M.chat();
    if (!chat || B.msgs.locked(chat)) return false;
    var text = (o.text || '').trim();
    if (!text && !o.attachment && !o.forward) return false;
    var cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    var payload = { type: 'message', chat_id: chat.id, text: text, client_id: cid };
    var temp = { id: -Date.now(), chat_id: chat.id, sender_id: S.user.id, text: text, sent_at: Math.floor(Date.now() / 1000), deleted: 0, status: { delivered: 0, read: 0, total: 1 }, _optimistic: true, _cid: cid, _state: 'sending' };
    if (o.reply) { payload.reply_to_id = temp.reply_to_id = o.reply.id; temp.reply_sender_name = o.reply.senderName; temp.reply_text = o.reply.text; temp.reply_sender_id = o.reply.senderId; temp.reply_sender_tag = o.reply.senderTag; }
    if (o.attachment) { payload.attachment = temp.attachment = o.attachment; }
    if (o.forward) { payload.forward_data = temp.forward_data = o.forward; }
    if (o.linkPreview && !S.secretChatIds.has(chat.id)) { payload.link_preview = temp.link_preview = o.linkPreview; }
    if (S.secretChatIds.has(chat.id) && !(await B.secret.seal(chat.id, payload, temp, text))) return false;
    M.cache.push(temp);
    M._enqueue({ cid: cid, chatId: chat.id, payload: payload, temp: temp });
    B.bus.emit('msgs:changed', { mode: 'bottom' });
    return true;
  },

  // ── очередь неотправленных ──
  // Живёт и в localStorage: если приложение закрыли без связи, сообщения не пропадают. Повторная отправка идёт с тем же client_id,
  // поэтому сервер не создаёт дубль, если первое сообщение всё-таки дошло
  outbox: [],
  _obSave: function () {
    try { localStorage.setItem('m.outbox', JSON.stringify(B.msgs.outbox.map(function (x) { return { cid: x.cid, chatId: x.chatId, payload: x.payload, temp: x.temp }; }))); } catch (e) {}
  },
  _obLoad: function () {
    try {
      var l = JSON.parse(localStorage.getItem('m.outbox') || '[]');
      B.msgs.outbox = l.filter(function (x) { return x && x.cid && x.payload && !B.S.secretChatIds.has(x.chatId); }).map(function (x) { x.temp._state = 'failed'; return x; });
    } catch (e) { B.msgs.outbox = []; }
  },
  _enqueue: function (it) {
    var M = B.msgs; M.outbox.push(it); M._obSave(); M._flush(it);
  },
  _flush: function (it) {
    var M = B.msgs;
    clearTimeout(it._t);
    if (B.ws.send(it.payload)) {
      it.temp._state = 'sending';
      it._t = setTimeout(function () { if (M.outbox.indexOf(it) >= 0 && it.temp._state === 'sending') { it.temp._state = 'failed'; B.bus.emit('msgs:changed', { mode: 'smart' }); } }, 20000);
    } else it.temp._state = 'failed';
  },
  // Отправить всё, что ждёт (связь вернулась или нажали «Повторить»)
  retryAll: function (chatId) {
    var M = B.msgs;
    M.outbox.forEach(function (it) { if (chatId == null || it.chatId === chatId) M._flush(it); });
    B.bus.emit('msgs:changed', { mode: 'smart' });
  },
  retry: function (cid) {
    var it = B.msgs.outbox.find(function (x) { return x.cid === cid; });
    if (!it) return;
    if (!B.ws.isOpen()) { B.toast.show('Нет связи с сервером'); return; }
    B.msgs._flush(it); B.bus.emit('msgs:changed', { mode: 'smart' });
  },
  // Убрать неотправленное (и его вложения с сервера, если они уже загружены)
  discard: function (cid) {
    var M = B.msgs, it = M.outbox.find(function (x) { return x.cid === cid; });
    M.outbox = M.outbox.filter(function (x) { return x.cid !== cid; }); M._obSave();
    M.cache = M.cache.filter(function (x) { return x._cid !== cid; });
    if (it && it.payload.attachment && it.payload.attachment.url && !it.payload.attachment.gif) {
      [it.payload.attachment].concat(it.payload.attachment.more || []).forEach(function (a) { B.api('DELETE', '/upload', { url: a.url, thumb: a.thumb }); });
    }
    B.bus.emit('msgs:changed', { mode: 'smart' });
  },
  // Сервер принял сообщение: убираем его из очереди и заменяем настоящим
  _confirm: function (cid) {
    var M = B.msgs, it = M.outbox.find(function (x) { return x.cid === cid; });
    if (it) { clearTimeout(it._t); M.outbox = M.outbox.filter(function (x) { return x !== it; }); M._obSave(); }
    M.cache = M.cache.filter(function (x) { return x._cid !== cid; });
  },
  // Сообщения очереди этого чата, которых ещё нет в загруженном окне (после повторного открытия чата)
  restoreOutbox: function (chatId) {
    var M = B.msgs;
    M.outbox.forEach(function (it) {
      if (it.chatId === chatId && !M.cache.some(function (x) { return x._cid === it.cid; })) M.cache.push(it.temp);
    });
  },
  edit: function (id, text, lp) { B.ws.send({ type: 'edit_message', message_id: id, text: text, link_preview: lp || null }); },
  remove: function (id) { B.ws.send({ type: 'delete_message', message_id: id }); },
  react: function (id, reaction) { B.ws.send({ type: 'react', message_id: id, reaction: reaction }); },
  typing: function () { B.presence.sendTyping(B.msgs.chatId); }
};

// ── обновления по WebSocket для открытого чата ──
(function () {
  var M = B.msgs, bus = B.bus;
  M._obLoad();
  // Сервер отклонил отправку в чат (только чтение, блокировка, нет связи с группой): неотправленные убираем, они не уйдут никогда
  bus.on('send:rejected', function (d) {
    M.outbox.filter(function (x) { return x.chatId === d.chatId && x.temp._state === 'sending'; }).forEach(function (x) { M.discard(x.cid); });
  });
  bus.on('ws:connected', function () { M.resync(); M.catchUp(); M.retryAll(); });
  bus.on('ws:message', function (d) { if (d.message.client_id && d.message.sender_id === B.S.user.id) M._confirm(d.message.client_id); });
  bus.on('ws:message', function (d) {
    var m = d.message; if (m.chat_id !== M.chatId) return;
    var mine = m.sender_id === B.S.user.id;
    if (mine && m.client_id) M._confirm(m.client_id);
    if (M.find(m.id)) return;   // повтор после обрыва связи
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
  // Число пересылок сообщения изменилось: отметка у времени обновляется
  bus.on('ws:forward_count', function (d) {
    var m = M.find(d.message_id);
    if (m) { m.forward_count = d.count; bus.emit('msgs:changed', { mode: 'smart' }); }
  });
  bus.on('ws:reaction_update', function (d) {
    var m = M.find(d.message_id);
    if (m) { m.reactions = d.counts; bus.emit('msgs:changed', { mode: 'smart' }); }
  });
})();

// Хвост переписки обновляем, когда чат открыт, пришло новое или изменилось; при выходе стираем
['msgs:opened', 'msgs:new', 'msgs:changed'].forEach(function (ev) { B.bus.on(ev, function () { B.msgs.saveTail(); }); });
B.bus.on('auth:logout', function () { B.msgs.outbox = []; try { localStorage.removeItem('m.outbox'); } catch (e) {} B.msgs._tail = {}; try { localStorage.removeItem('m.tail'); } catch (e) {} });
