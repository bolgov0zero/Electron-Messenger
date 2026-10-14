// /beta — ядро: люди (контакты, знакомые по общему чату, люди из других пространств и серверов) и блокировки.
// Логика из /m/app.js без разметки; экраны слушают 'contacts:changed' и 'blocks:changed'.
B.S.users = []; B.S.contacts = []; B.S.blocked = [];
B.contacts = {
  // Те, кого человек выбирает как собеседников: всё, кроме знакомых только по общему чату (rel === 'chat')
  pick: function (u) { return u.rel !== 'chat'; },
  load: async function () {
    var users = await B.api('GET', '/users');
    if (!users || users.error) return;
    B.S.users = users; B.S.contacts = users.filter(B.contacts.pick);
    // Аватарка человека с другого сервера может приехать позже первого показа: прошлые неудачи не помним
    B.avatar && B.avatar._cache.forEach(function (v, k) { if (v === false) B.avatar._cache.delete(k); });
    B.bus.emit('contacts:changed');
  },
  loadBlocks: async function () {
    var r = await B.api('GET', '/blocks');
    if (Array.isArray(r)) { B.S.blocked = r; B.bus.emit('blocks:changed'); }
  },
  byId: function (id) { return B.S.users.find(function (u) { return u.id === id; }) || null; },
  isBlocked: function (id) { return B.S.blocked.some(function (b) { return b.id === id; }); },
  // Собеседник знаком только по общему чату: в контакты его ещё не добавили
  needsContact: function (id) { var u = B.contacts.byId(id); return !!u && u.rel === 'chat'; },
  peerSub: function (id) {
    var u = B.contacts.byId(id);
    return u && u.rel === 'chat' ? (u.workspace_name ? u.workspace_name + ' · ' : '') + 'не в ваших контактах' : B.presence.statusText(id);
  },
  // Адрес человека с другого сервера «@сервер:логин»; у старого сервера разбираем служебное имя («сервер@логин»)
  fedAddr: function (u) {
    var s = u.server_id, l = u.login;
    if (!s || !l) { var m = /^([^:@]+)[:@](.*)$/.exec(u.username || ''); if (m) { s = s || m[1]; l = l || m[2]; } }
    return '@' + (s ? s + ':' : '') + (l || u.username);
  },
  // Значок под именем: общие пространства, чужое пространство или «глобус» для другого сервера
  wsTag: function (u) {
    var G = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 4 6 4 9.5s-1.4 6.7-4 9.5c-2.6-2.8-4-6-4-9.5s1.4-6.7 4-9.5z"/></svg>';
    var chip = function (t) { return '<span class="chip">' + B.esc(t) + '</span>'; };
    if (u.federated) return '<span class="chip fed" title="С другого сервера">' + G + '</span>';
    var my = (B.S.user && B.S.user.workspaces && B.S.user.workspaces.length) || 1;
    if (u.rel === 'ws') {
      var n = u.shared_workspaces || [];
      if (my > 1 && n.length) { var full = n.join(' · '); return chip(n.length === 1 ? n[0] : full.length <= 22 ? full : n[0] + ' +' + (n.length - 1)); }
      return '';
    }
    return (u.rel === 'other' || u.rel === 'chat') && u.workspace_name ? chip(u.workspace_name) : '';
  },
  // Личный чат с человеком (создаётся, если ещё не было)
  openDirect: async function (userId) {
    var chat = B.S.chats.find(function (c) { return c.type === 'direct' && B.peerId(c) === userId; });
    if (chat) return chat;
    chat = await B.api('POST', '/chats/direct', { user_id: userId });
    if (!chat || chat.error) return null;
    if (!B.find(chat.id)) B.S.chats.push(chat);
    B.chats.onChanged();
    return chat;
  }
};
B.bus.on('contacts:reload', function () { B.contacts.load(); });
B.bus.on('blocks:reload', function () { B.contacts.loadBlocks(); });
