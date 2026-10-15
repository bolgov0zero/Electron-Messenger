// /m — ядро: папки чатов. Они личные, лежат на сервере и общие для всех устройств человека (клиент, веб, телефон).
// Состав папки — список id чатов; порядок и вид (название, цвет, значок) задаёт сам человек.
//   folders:changed — список или выбранная папка изменились
B.folders = (function () {
  var list = [], filter = 'all', MAX = 20, reloadT = null, busy = 0;
  function key() { return 'chat_folder_filter_' + ((B.S.user && B.S.user.id) || 0) + '_' + B.S.server; }
  function byId(id) { return list.find(function (f) { return f.id === id; }); }
  function pass(c) { if (filter === 'all') return true; var f = byId(filter); return !!f && f.chat_ids.indexOf(c.id) >= 0; }
  function of(c) { return list.find(function (f) { return f.chat_ids.indexOf(c.id) >= 0; }) || null; }
  // Непрочитанное в папке: без заглушённых чатов
  function unread(f) {
    return B.S.chats.filter(function (c) { return !c.parent_id && !c.muted && f.chat_ids.indexOf(c.id) >= 0; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
  }
  function changed() {
    if (filter !== 'all' && !byId(filter)) filter = 'all';
    if (!list.length) filter = 'all';
    B.bus.emit('folders:changed');
  }
  async function api(method, path, body) { busy++; try { return await B.api(method, path, body); } finally { busy--; } }
  var F = {
    MAX: MAX,
    get list() { return list; },
    get filter() { return filter; },
    byId: byId, pass: pass, of: of, unread: unread,
    load: async function () {
      var r = await B.api('GET', '/folders'); if (!Array.isArray(r)) return;
      list = r;
      try { var v = localStorage.getItem(key()); if (v && v !== 'all' && byId(+v)) filter = +v; } catch (e) {}
      changed();
    },
    // Сервер сообщает «папки изменились» и после наших правок: перезагружаем, когда всё стихло, чтобы не затереть только что сделанное
    schedule: function () { clearTimeout(reloadT); reloadT = setTimeout(function () { if (busy > 0) F.schedule(); else F.load(); }, 350); },
    select: function (id) { filter = id; try { localStorage.setItem(key(), String(id)); } catch (e) {} changed(); },
    label: function () { var f = filter === 'all' ? null : byId(filter); return f ? f.name : 'Все чаты'; },
    create: async function (o, chatId) {
      var r = await api('POST', '/folders', o);
      if (!r || !r.id) { B.toast.show((r && r.error) || 'Не удалось создать папку'); return null; }
      if (chatId) { var ids = list.filter(function (f) { return f.chat_ids.indexOf(chatId) >= 0; }).map(function (f) { return f.id; }).concat(r.id); await api('PUT', '/folders/chat/' + chatId, { folder_ids: ids }); }
      await F.load(); return r.id;
    },
    update: async function (id, o) { var f = byId(id); if (f) { Object.assign(f, o); changed(); } await api('PATCH', '/folders/' + id, o); },
    remove: async function (id) { list = list.filter(function (f) { return f.id !== id; }); changed(); await api('DELETE', '/folders/' + id); },
    move: async function (id, dir) {
      var i = list.findIndex(function (f) { return f.id === id; }), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      var f = list.splice(i, 1)[0]; list.splice(j, 0, f); changed();
      await api('PUT', '/folders/order', { ids: list.map(function (x) { return x.id; }) });
    },
    // Положить чат в папку или убрать из неё
    toggleChat: async function (chatId, folderId) {
      var f = byId(folderId); if (!f) return;
      var i = f.chat_ids.indexOf(chatId); if (i >= 0) f.chat_ids.splice(i, 1); else f.chat_ids.push(chatId);
      changed();
      await api('PUT', '/folders/chat/' + chatId, { folder_ids: list.filter(function (x) { return x.chat_ids.indexOf(chatId) >= 0; }).map(function (x) { return x.id; }) });
    }
  };
  B.bus.on('ws:folders_changed', F.schedule);
  B.bus.on('auth:logout', function () { list = []; filter = 'all'; });
  return F;
})();
