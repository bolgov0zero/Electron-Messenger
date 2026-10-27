// /m — ядро: WebSocket. Здесь обновляются данные списка чатов и присутствие; всё, что относится
// к содержимому открытого чата (сообщения, статусы, реакции), экран переписки получает событиями
// шины «ws:<тип>» и разбирает сам (этап 5).
// Состояние связи с сервером: ok — сокет открыт; connecting — ещё соединяемся (первые попытки); offline — не получилось несколько раз подряд
B.conn = {
  state: 'ok', _t: null,
  update: function () {
    var S = B.S, w = S.ws, st = (w && w.readyState === 1) ? 'ok' : ((S.wsFails || 0) >= 2 || navigator.onLine === false) ? 'offline' : 'connecting';
    clearTimeout(B.conn._t);
    var set = function () { if (st !== B.conn.state) { B.conn.state = st; B.bus.emit('conn:changed', { state: st }); } };
    // Короткое переподключение плашкой не показываем: «Подключение…» появляется, если соединения нет дольше секунды
    if (st === 'connecting') B.conn._t = setTimeout(set, 1200); else set();
  }
};
window.addEventListener('online', function () { B.conn.update(); });
window.addEventListener('offline', function () { B.conn.update(); });
B.ws = {
  send: function (obj) {
    var w = B.S.ws;
    if (w && w.readyState === 1) { w.send(JSON.stringify(obj)); return true; }
    return false;
  },
  isOpen: function () { return !!(B.S.ws && B.S.ws.readyState === 1); },

  connect: function () {
    var S = B.S; if (!S.token) return;
    var prev = S.ws;
    if (prev && prev.readyState <= 1) { try { prev.close(); } catch (e) {} }
    var ws = new WebSocket(B.wsProto() + '://' + S.server + '/ws?token=' + S.token);
    S.ws = ws;
    ws.onopen = function () { S.wsFails = 0; B.conn.update(); B.bus.emit('ws:state'); if (B.msgs && B.msgs.chatId) B.msgs.watch(B.find(B.msgs.chatId)); };
    ws.onmessage = function (e) {
      if (ws !== S.ws) return;
      var data; try { data = JSON.parse(e.data); } catch (err) { return; }
      B.ws.handle(data);
    };
    ws.onclose = function () {
      S.wsFails = (S.wsFails || 0) + 1; B.conn.update();
      B.bus.emit('ws:state');
      if (S.ws === ws) setTimeout(function () { if (S.token) B.ws.connect(); }, 2000);
    };
    B.conn.update();
    B.bus.emit('ws:state');
  },

  handle: function (data) {
    var S = B.S, chat;
    // Администратор восстановил чаты из копии: данные на экране устарели
    if (data.type === 'data_restored') { location.reload(); return; }
    B.bus.emit('ws:' + data.type, data);

    switch (data.type) {
      case 'connected': {
        S.editLimit = data.edit_time_limit || 120; S.readUpTo = !!data.read_up_to;
        if (B.emoji && B.emoji.sync) B.emoji.sync();
        // Админка показывает устройство клиента — сообщаем, что это PWA или обычная вкладка
        var isPwa = B.pwa.standalone, ua = navigator.userAgent;
        B.ws.send({
          type: 'client_info', hostname: isPwa ? 'PWA' : 'Web', clientVersion: 'web', mobile: true, osPlatform: navigator.platform || 'web',
          osRelease: /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Mac/i.test(ua) ? 'macOS' : 'Web',
          installScope: isPwa ? 'pwa' : 'web'
        });
        break;
      }
      case 'modules_changed': B.bus.emit('modules:reload'); break;
      case 'message': {
        var m = data.message; chat = B.find(m.chat_id);
        if (chat) chat.last_message = m;
        var tpar = m.parent_id || (chat && chat.parent_id);
        if (tpar) { var tp = (S.topics[tpar] || []).find(function (t) { return t.id === m.chat_id; }); if (tp) tp.last_message = m; }   // строка в списке тем: по ней идёт сортировка
        if (S.activeChatId === m.chat_id) {
          // Открытый чат: «прочитано» и «доставлено» отправит экран переписки; счётчик уточнит ответ сервера на «прочитано»
          if (m.sender_id !== S.user.id && chat) {
            chat.unread = (chat.unread || 0) + 1;
            if (m.mentions && m.mentions.indexOf(S.user.id) >= 0) chat.unread_mentions = (chat.unread_mentions || 0) + 1;
          }
          if (chat && chat.parent_id) setTimeout(B.chats.refresh, 400);
        } else if (m.sender_id !== S.user.id && chat) {
          chat.unread = (chat.unread || 0) + 1;
          if (m.mentions && m.mentions.indexOf(S.user.id) >= 0) chat.unread_mentions = (chat.unread_mentions || 0) + 1;
          B.ws.send({ type: 'delivered', message_id: m.id });
        }
        if (chat && chat.parent_id) B.chats.refresh();   // агрегат комнаты считает сервер
        else if (!chat) B.chats.refresh();
        else B.chats.onChanged();
        break;
      }
      case 'message_edited': {
        var em = data.message; chat = B.find(em.chat_id);
        if (chat && chat.last_message && chat.last_message.id === em.id) chat.last_message = em;
        B.chats.onChanged();
        break;
      }
      case 'message_deleted': {
        chat = B.find(data.chat_id);
        if (chat && chat.last_message && chat.last_message.id === data.message_id) chat.last_message = Object.assign({}, chat.last_message, { deleted: 1, text: '', attachment: null });
        B.chats.onChanged();
        break;
      }
      case 'status_update': {
        var sm = data.message; if (!sm.status) break;
        chat = B.find(sm.chat_id);
        if (chat && chat.last_message && chat.last_message.id === sm.id) { chat.last_message.status = Object.assign({}, sm.status); B.chats.onChanged(); }
        break;
      }
      case 'emoji_freq': if (B.emoji && B.emoji.merge) B.emoji.merge(data.freq); break;
      case 'status_range': {
        // Для открытого чата галочки пересчитывает экран переписки; здесь — только последнее сообщение в списке
        if (data.chat_id === S.activeChatId) break;
        chat = B.find(data.chat_id);
        var lm = chat && chat.last_message;
        if (lm && lm.sender_id === S.user.id && lm.status && lm.id >= data.min_id && lm.id <= data.max_id) {
          if (data.kind === 'read') { lm.status.read = Math.min(lm.status.total, lm.status.read + 1); lm.status.delivered = Math.max(lm.status.delivered, lm.status.read); }
          else lm.status.delivered = Math.min(lm.status.total, lm.status.delivered + 1);
          B.chats.onChanged();
        }
        break;
      }
      case 'presence':
        S.presence[data.user_id] = data.status;
        (S.presenceMobile = S.presenceMobile || {})[data.user_id] = !!data.mobile && data.status === 'online';
        if (data.last_seen) S.lastSeen[data.user_id] = data.last_seen;
        B.bus.emit('presence:changed', { userId: data.user_id });
        break;
      case 'typing': B.bus.emit('typing', { chatId: data.chat_id, senderName: data.sender_name }); break;
      case 'reload_chats': B.chats.refresh(); B.bus.emit('topics:reload'); break;
      // Счётчик «в сети N из M» открытой группы или комнаты
      case 'chat_online': (S.chatOnline = S.chatOnline || {})[data.chat_id] = { online: data.online, total: data.total }; B.bus.emit('chat:online', { chatId: data.chat_id }); break;
      // Связь с другим сервером появилась или пропала: у групп оттуда меняется шапка и поле ввода
      case 'fed_link': B.chats.refresh(); break;
      case 'user_updated': B.chats.applyUserUpdate(data); break;
      case 'chat_updated': {
        // Полный объект (закрепление) или только изменённые поля (переименование, «только чтение»)
        var chatId = data.chat ? data.chat.id : data.chat_id;
        if (data.chat) {
          var idx = S.chats.findIndex(function (c) { return c.id === data.chat.id; });
          if (idx >= 0) S.chats[idx] = data.chat; else S.chats.push(data.chat);
        } else {
          var c = B.find(chatId);
          if (c) {
            if (data.name !== undefined) c.name = data.name;
            if (data.read_only !== undefined) c.read_only = data.read_only ? 1 : 0;
            if (data.topics_manual !== undefined) { c.topics_manual = data.topics_manual ? 1 : 0; B.bus.emit('topics:reload'); }
          }
        }
        B.chats.onChanged(); B.bus.emit('chat:updated', { chatId: chatId });
        break;
      }
      case 'chat_read':
        chat = B.find(data.chat_id);
        if (chat) {
          // Прочитано частично (up_to): сервер присылает остаток; без него чат прочитан целиком
          chat.unread = typeof data.unread === 'number' ? data.unread : 0;
          chat.unread_mentions = typeof data.unread_mentions === 'number' ? data.unread_mentions : 0;
          if (chat.parent_id) { var tpc = (S.topics[chat.parent_id] || []).find(function (t) { return t.id === chat.id; }); if (tpc) { tpc.unread = chat.unread; tpc.unread_mentions = chat.unread_mentions; } B.chats.syncRoomUnread(chat.parent_id); }
          B.chats.onChanged();
        }
        break;
      case 'chat_deleted':
        S.chats = S.chats.filter(function (c) { return c.id !== data.chat_id; });
        B.chats.onChanged(); B.bus.emit('chat:deleted', { chatId: data.chat_id });
        break;
      case 'avatar_updated': B.avatar.loadIndex().then(function () { S.avatarTs = Date.now(); B.bus.emit('avatar:updated'); B.chats.onChanged(); }); break;
      case 'user_created': B.bus.emit('contacts:reload'); break;
      case 'contacts_changed': case 'directory_changed': case 'presence_refresh':
        if (data.type !== 'presence_refresh') B.chats.refreshServerInfo().then(function () { B.bus.emit('contacts:reload'); });
        B.presence.load();
        break;
      case 'blocks_changed': B.bus.emit('blocks:reload'); break;
      case 'chat_limit':
        chat = B.find(data.chat_id);
        if (chat) { chat.dm_limit = data.dm_limit; B.bus.emit('chat:updated', { chatId: data.chat_id }); }
        break;
      case 'send_rejected':
        if (data.reason === 'limit') { chat = B.find(data.chat_id); if (chat) { chat.dm_limit = data.dm_limit || chat.dm_limit; B.bus.emit('chat:updated', { chatId: data.chat_id }); } }
        if (data.reason === 'fed_offline') B.toast.show('Нет связи с сервером этой группы. Писать пока нельзя');
        B.bus.emit('send:rejected', { chatId: data.chat_id, reason: data.reason });
        break;
      case 'edit_rejected': B.bus.emit('edit:rejected'); break;
    }
  }
};
