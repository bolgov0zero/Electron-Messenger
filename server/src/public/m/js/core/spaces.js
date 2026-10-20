// /m — ядро: общие пространства (между серверами). Если в настройках включено «Отображать общие пространства», список чатов
// и контактов можно ограничить одним из них: остаются люди пространства и чаты с ними. «Общий вид» показывает всё.
//   spaces:changed — список пространств, выбранное или настройка изменились
B.spaces = (function () {
  var list = [], filter = 'all';
  var ON_KEY = 'm_spaces_rail';
  function key() { return 'chat_space_filter_' + ((B.S.user && B.S.user.id) || 0) + '_' + B.S.server; }
  function on() { try { return localStorage.getItem(ON_KEY) === '1'; } catch (e) { return false; } }
  function shown() { return on() && list.length > 0; }
  function active() { return shown() && filter !== 'all' ? filter : null; }
  function byId(id) { return list.find(function (s) { return s.id === id; }); }
  function userIn(u, id) { return !!u && (u.ws_ids || []).indexOf(id) >= 0; }
  function chatIn(c, id) {
    var me = B.S.user && B.S.user.id;
    return (c.members || []).some(function (m) { return m.id !== me && userIn(B.contacts.byId(m.id), id); });
  }
  var SP = {
    get list() { return list; },
    get filter() { return filter; },
    on: on, shown: shown, active: active, byId: byId,
    label: function () { var s = active() === null ? null : byId(filter); return s ? s.name : 'Общий вид'; },
    pass: function (c) { var id = active(); return id === null || chatIn(c, id); },
    userPass: function (u) { var id = active(); return id === null || userIn(u, id); },
    // Непрочитанное в пространстве (id или 'all'): без заглушённых чатов
    unread: function (id) {
      return B.S.chats.filter(function (c) { return !c.parent_id && !c.muted && !c.invite && (id === 'all' || chatIn(c, id)); }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    },
    setOn: function (v) {
      try { localStorage.setItem(ON_KEY, v ? '1' : '0'); } catch (e) {}
      if (!v) filter = 'all';
      B.bus.emit('spaces:changed');
    },
    select: function (id) {
      filter = id;
      try { localStorage.setItem(key(), String(id)); } catch (e) {}
      B.bus.emit('spaces:changed');
    },
    load: async function () {
      var r = await B.api('GET', '/contacts/spaces'); if (!Array.isArray(r)) return;
      var same = JSON.stringify(r) === JSON.stringify(list);
      list = r;
      try { var v = localStorage.getItem(key()); if (v && v !== 'all' && byId(+v)) filter = +v; } catch (e) {}
      if (filter !== 'all' && !byId(filter)) filter = 'all';
      if (!same) B.bus.emit('spaces:changed');
    }
  };
  B.bus.on('contacts:reload', function () { SP.load(); });
  B.bus.on('contacts:changed', function () { if (active() !== null) B.bus.emit('spaces:changed'); });
  B.bus.on('auth:logout', function () { list = []; filter = 'all'; });
  return SP;
})();
