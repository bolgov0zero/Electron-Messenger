// /m — ядро: присутствие («в сети», «отошёл») и набор текста
B.presence = {
  AWAY_DELAY: 5000, _awayTimer: null, _typingTimer: null,
  // Присутствие видно только своим из пространства и тем, с кем контакты добавлены с обеих сторон; у остальных заглушка
  setMap: function (pres) {
    var S = B.S; S.presenceReady = true; S.presence = {}; S.lastSeen = {};
    Object.keys(pres).forEach(function (id) { var v = pres[id]; S.presence[id] = v && v.status; if (v && v.last_seen) S.lastSeen[id] = v.last_seen; });
    B.bus.emit('presence:changed');
  },
  load: async function () { var p = await B.api('GET', '/users/presence'); if (p) B.presence.setMap(p); },
  statusText: function (userId) {
    var S = B.S;
    if (S.presenceReady && S.presence[userId] === undefined) return 'Был давно';
    var st = S.presence[userId] || 'offline';
    if (st === 'online') return 'Онлайн';
    if (st === 'away') return 'Отошёл';
    var ts = S.lastSeen[userId];
    if (!ts) return 'Был в сети';
    return new Date(ts * 1000).toDateString() === new Date().toDateString() ? 'Был в сети в ' + B.fmt.time(ts) : 'Был в сети недавно';
  },
  // Приложение на переднем плане — «онлайн» сразу, в фоне — «отошёл» через 5 секунд. Таймер не перезапускается
  sendStatus: function (status) { B.ws.send({ type: 'set_status', status: status }); },
  setViewing: function (viewing) {
    var p = B.presence;
    if (viewing) { clearTimeout(p._awayTimer); p._awayTimer = null; p.sendStatus('online'); return; }
    if (p._awayTimer) return;
    p._awayTimer = setTimeout(function () { p._awayTimer = null; p.sendStatus('away'); }, p.AWAY_DELAY);
  },
  // «Печатает…»: не чаще раза в секунду
  sendTyping: function (chatId) {
    var p = B.presence;
    if (!chatId || p._typingTimer) return;
    B.ws.send({ type: 'typing', chat_id: chatId });
    p._typingTimer = setTimeout(function () { p._typingTimer = null; }, 1000);
  }
};

// Кто сейчас печатает в каком чате: имя → таймер сброса (5 с без новых событий). Об изменениях сообщает событие typing:changed
B.typing = {
  _m: {},
  names: function (cid) { return Object.keys(B.typing._m[cid] || {}); },
  // «Имя печатает…», «Имя и Имя печатают…», «Имя и ещё N печатают…»; withName=false — для шапки личного чата, там имя и так видно
  label: function (names, withName) {
    var n = names.length;
    if (n === 1) return withName ? names[0] + ' печатает…' : 'печатает…';
    if (n === 2) return names[0] + ' и ' + names[1] + ' печатают…';
    return names[0] + ' и ещё ' + (n - 1) + ' печатают…';
  },
  set: function (cid, name) {
    var m = B.typing._m[cid] || (B.typing._m[cid] = {});
    clearTimeout(m[name]);
    m[name] = setTimeout(function () { B.typing.drop(cid, name); }, 5000);
    B.bus.emit('typing:changed', { chatId: cid });
  },
  drop: function (cid, name) {
    var m = B.typing._m[cid]; if (!m) return;
    clearTimeout(m[name]); delete m[name];
    if (!Object.keys(m).length) delete B.typing._m[cid];
    B.bus.emit('typing:changed', { chatId: cid });
  }
};
B.bus.on('typing', function (d) { B.typing.set(d.chatId, d.senderName || 'Кто-то'); });
B.bus.on('auth:logout', function () { Object.keys(B.typing._m).forEach(function (cid) { Object.keys(B.typing._m[cid]).forEach(function (n) { clearTimeout(B.typing._m[cid][n]); }); }); B.typing._m = {}; });
