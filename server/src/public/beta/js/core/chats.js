// /beta — ядро: список чатов, темы комнат, бейдж приложения (логика из /m/app.js без разметки)
B.find = function (id) { return B.S.chats.find(function (c) { return c.id === id; }); };

B.chatName = function (chat) {
  if (!chat) return '';
  if (chat.type === 'group') return chat.name || 'Группа';
  if (chat.type === 'room') return chat.name || 'Комната';
  var other = (chat.members || []).find(function (m) { return m.id !== B.S.user.id; });
  return (other && other.display_name) || 'Чат';
};
B.peerId = function (chat) {
  if (chat.type !== 'direct') return null;
  var other = (chat.members || []).find(function (m) { return m.id !== B.S.user.id; });
  return other ? other.id : null;
};

B.chats = {
  // Скрытые на этом устройстве секретные чаты в список не попадают (см. core/secret.js)
  visible: function (list) {
    if (!list) return null;
    if (window.SC) return B.secret.visible(list);
    B.S.secretChatIds = new Set(list.filter(function (x) { return x.is_secret; }).map(function (x) { return x.id; }));
    return list.filter(function (x) { return !x.is_secret; });
  },
  load: async function () {
    await B.secret.boot();
    var list = B.chats.visible(await B.api('GET', '/chats'));
    if (!list) return;
    B.S.chats = list;
    B.chats.onChanged();
  },
  // Как load(), но не теряет уже подгруженные темы: /chats отдаёт только чаты верхнего уровня,
  // а темы подмешивает loadTopics(). Использовать везде, где список обновляется при открытом списке тем.
  refresh: async function () {
    await B.secret.boot();
    var fresh = B.chats.visible(await B.api('GET', '/chats'));
    if (!fresh) return;
    var topics = B.S.chats.filter(function (c) { return c.parent_id; });
    B.S.chats = fresh.concat(topics);
    B.chats.onChanged();
  },
  loadTopics: async function (roomId) {
    var subs = await B.api('GET', '/chats/' + roomId + '/topics');
    if (!subs) return;
    B.S.topics[roomId] = subs;
    var room = B.find(roomId);
    subs.forEach(function (t) {
      var ex = B.find(t.id);
      if (ex) { ex.name = t.name; ex.last_message = t.last_message; ex.unread = t.unread; ex.unread_mentions = t.unread_mentions; }
      else B.S.chats.push({ id: t.id, type: t.type || 'room', name: t.name, parent_id: roomId, members: room ? room.members : [], last_message: t.last_message, unread: t.unread, unread_mentions: t.unread_mentions, muted: false });
    });
    B.chats.onChanged();
  },
  // Бейдж комнаты — сумма непрочитанного её тем. Считаем локально, сразу после изменения темы:
  // серверный агрегат сразу после «прочитано» ещё старый
  syncRoomUnread: function (roomId) {
    var room = B.find(roomId); if (!room) return;
    var topics = B.S.chats.filter(function (c) { return c.parent_id === roomId; });
    room.unread = topics.reduce(function (s, t) { return s + (t.unread || 0); }, 0);
    room.unread_mentions = topics.reduce(function (s, t) { return s + (t.unread_mentions || 0); }, 0);
  },
  totalUnread: function () {
    return B.S.chats.filter(function (c) { return !c.parent_id; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
  },
  syncBadge: function () {
    var total = B.chats.totalUnread();
    try { if (total > 0) navigator.setAppBadge && navigator.setAppBadge(total); else navigator.clearAppBadge && navigator.clearAppBadge(); } catch (e) {}
  },
  onChanged: function () { B.chats.syncBadge(); B.bus.emit('chats:changed'); },
  // Имя или тег человека изменены на сервере: правим данные на месте
  applyUserUpdate: function (u) {
    var fix = function (o) { if (!o || o.id !== u.user_id) return; if (u.display_name) o.display_name = u.display_name; if (u.tag !== undefined) o.tag = u.tag; };
    B.S.chats.forEach(function (c) { (c.members || []).forEach(fix); });
    if (B.S.user && B.S.user.id === u.user_id) fix(B.S.user);
    B.bus.emit('user:updated', u);
    B.chats.onChanged();
  },
  // Данные сервера о себе (название сервера, пространства) — как mRefreshServerInfo в /m
  refreshServerInfo: async function () {
    var r = await B.api('GET', '/auth/me'), S = B.S;
    if (!r || !S.user || r.id !== S.user.id) return;
    var same = JSON.stringify(r.workspaces || []) === JSON.stringify(S.user.workspaces || []);
    if ((r.server_name || '') === (S.user.server_name || '') && (r.server_id || '') === (S.user.server_id || '') && same) return;
    S.user.server_name = r.server_name || ''; S.user.server_id = r.server_id || '';
    S.user.workspaces = r.workspaces || []; S.user.workspace_id = r.workspace_id; S.user.workspace_name = r.workspace_name;
    B.session.save();
  }
};

// ── Список чатов: порядок, превью, действия (логика из /m/app.js) ──
// Комнаты — первой группой по алфавиту, затем закреплённые, затем остальные по времени последнего сообщения.
// Темы комнат (parent_id) в верхний список не входят.
B.chats.groups = function (q) {
  q = (q || '').trim().toLowerCase();
  var list = B.S.chats.filter(function (c) { return !c.parent_id && (!q || B.chatName(c).toLowerCase().indexOf(q) >= 0); });
  var byTime = function (a, b) { return ((b.last_message && b.last_message.sent_at) || 0) - ((a.last_message && a.last_message.sent_at) || 0); };
  return {
    rooms: list.filter(function (c) { return c.type === 'room'; }).sort(function (a, b) { return B.chatName(a).localeCompare(B.chatName(b), 'ru', { numeric: true }); }),
    pinned: list.filter(function (c) { return c.type !== 'room' && c.pinned; }).sort(byTime),
    rest: list.filter(function (c) { return c.type !== 'room' && !c.pinned; }).sort(byTime),
    total: list.length
  };
};
B.chats.preview = function (c) {
  var lm = c.last_message;
  if (!lm) return 'Нет сообщений';
  if (lm.deleted) return 'Сообщение удалено';
  if (lm.text) return lm.text.replace(/<[^>]*>/g, '');
  if (lm.forward_data && !lm.text) return 'Пересланное сообщение';
  if (lm.attachment) {
    var a = lm.attachment, mime = a.mime || '';
    return a.gif ? '🖼 GIF' : mime.indexOf('image/') === 0 ? '🖼 Изображение' : mime.indexOf('video/') === 0 ? '🎬 Видео' : '📎 ' + (a.name || 'Файл');
  }
  return '';
};
B.chats.pin = async function (id) {
  var c = B.find(id); if (!c) return;
  var res = await B.api('POST', '/chats/' + id + '/pin');
  if (res && res.ok) { c.pinned = res.pinned; B.chats.onChanged(); }
};
B.chats.mute = async function (id) {
  var c = B.find(id); if (!c) return;
  var res = await B.api(c.muted ? 'DELETE' : 'POST', '/chats/' + id + '/mute');
  if (res && res.ok) { c.muted = !c.muted; B.chats.onChanged(); }
};
B.chats.leave = async function (id) {
  var res = await B.api('POST', '/chats/' + id + '/leave');
  if (res && res.ok) { B.S.chats = B.S.chats.filter(function (c) { return c.id !== id; }); B.chats.onChanged(); B.bus.emit('chat:deleted', { chatId: id }); }
  return !!(res && res.ok);
};
// Поиск по тексту сообщений во всех чатах; в сниппете \x01…\x02 обрамляют найденное слово
B.chats.searchMessages = async function (q) {
  var data = await B.api('GET', '/messages/search?q=' + encodeURIComponent(q));
  return (data && data.results) || [];
};
