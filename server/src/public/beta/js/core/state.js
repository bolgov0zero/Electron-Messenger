// /m — ядро: общее состояние, шина событий и форматирование. Логика перенесена из /beta/app.js,
// но без привязки к разметке: экраны подписываются на события шины и сами перерисовываются.
window.B = window.B || {};

B.SESSION_KEY = 'electron_v2'; // тот же ключ и та же форма объекта, что у /chat и /m — сессия общая

B.S = {
  server: location.host, token: null, user: null,
  chats: [], ws: null,
  activeChatId: null,       // открытый сейчас чат (ставит экран переписки)
  presence: {}, presenceReady: false, lastSeen: {},
  editLimit: 120,           // секунд на правку сообщения (приходит с сервера)
  avatarTs: 1,              // метка для обхода кэша аватарок
  topics: {},               // roomId -> список тем комнаты
  secretChatIds: new Set()
};

// Шина событий: on(событие, fn) возвращает функцию отписки
B.bus = (function () {
  var h = {};
  return {
    on: function (ev, fn) { (h[ev] = h[ev] || []).push(fn); return function () { B.bus.off(ev, fn); }; },
    off: function (ev, fn) { h[ev] = (h[ev] || []).filter(function (f) { return f !== fn; }); },
    emit: function (ev, data) {
      (h[ev] || []).slice().forEach(function (f) { try { f(data); } catch (e) { console.error('bus', ev, e); } });
    }
  };
})();

B.fmt = {
  time: function (ts) { return new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); },
  dateTime: function (ts) {
    var d = new Date(ts * 1000);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  },
  // Время в списке чатов: сегодня — часы, вчера — «вчера», последняя неделя — день недели, дальше — дата
  chatListTime: function (ts) {
    var d = new Date(ts * 1000), now = new Date();
    if (d.toDateString() === now.toDateString()) return B.fmt.time(ts);
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера';
    if ((now - d) / 86400000 < 6) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  },
  daySep: function (ts) {
    var d = new Date(ts * 1000), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  },
  initials: function (n) { return (n || '?').split(' ').slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
};
