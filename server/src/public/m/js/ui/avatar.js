// /m — аватарки в разметке макета: цветной круг с инициалами (.av), поверх которого подгружается фото, если оно есть на сервере.
// Значки: точка «в сети» (.dot), группа (.type), другой сервер (глобус). Инициалы лежат в <b class="ini">, чтобы фото их заменяло, а значки оставались.
B.avatar = {
  _cache: new Map(),
  // o = { id (для цвета), chat | user (что подгружать), text (инициалы), dot (id для точки «в сети»), type, sq, fed }
  html: function (o, size) {
    var c = AVC[(o.id || 0) % AVC.length], attr = '';
    if (o.chat) attr = ' data-av-chat="' + o.chat + '"'; else if (o.user) attr = ' data-av-user="' + o.user + '"';
    var st = o.dot ? (B.S.presence[o.dot] || 'offline') : 'offline';
    var sz = size ? ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.34) + 'px' : '';
    return '<span class="av' + (o.sq ? ' sq' : '') + (o.cls ? ' ' + o.cls : '') + '"' + attr + ' style="background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')' + sz + '"><span class="ini">' + B.esc(o.text || '') + '</span>' +
      (o.dot && st !== 'offline' ? '<i class="dot' + (st === 'away' ? ' away' : '') + (st === 'online' && B.S.presenceMobile && B.S.presenceMobile[o.dot] ? ' mob' : '') + '"></i>' : '') +
      (o.folder ? '<i class="type fb" style="--fc:' + B.esc(o.folder.color) + '">' + I(o.folder.icon || 'folder') + '</i>' : o.type ? '<i class="type">' + I('users') + '</i>' : '') + (o.fed ? '<i class="type">' + I('globe') + '</i>' : '') + '</span>';
  },
  // Аватар чата: личный — по собеседнику, группа — значок группы, комната — квадрат с «#»
  chat: function (c, size, nobadge) {
    var peer = B.peerId(c), fo = !nobadge && B.folders && B.folders.filter === 'all' ? B.folders.of(c) : null;   // значок папки (как в веб клиенте): у чата в папке
    if (c.type === 'direct') return B.avatar.html({ id: peer || c.id, chat: c.id, text: B.fmt.initials(B.chatName(c)), dot: B.isSys(c) ? 0 : peer, folder: fo }, size);
    var root_ = c.parent_id ? B.find(c.parent_id) || c : c;
    return B.avatar.html({ id: c.id, chat: c.id, text: c.type === 'room' ? '#' : B.fmt.initials(B.chatName(c)), sq: c.type === 'room', type: c.type === 'group' && !nobadge, folder: fo, fed: !!root_.fed_mirror }, size);
  },
  user: function (id, name, size, nodot, fed) { return B.avatar.html({ id: id, user: id, text: B.fmt.initials(name), dot: nodot ? 0 : id, fed: !!fed }, size); },
  // Список id с аватарками на сервере: файл запрашиваем только для них (иначе 404 в консоли на каждого без фото)
  idx: null,
  loadIndex: async function () {
    var r = await B.api('GET', '/users/avatars/index');
    B.avatar.idx = r && Array.isArray(r.u) && Array.isArray(r.c) ? new Set(r.u.map(function (i) { return 'u' + i; }).concat(r.c.map(function (i) { return 'c' + i; }))) : null;
  },
  _missing: function (url) {
    if (!B.avatar.idx) return false;
    var m = /\/api\/(users|chats)\/(\d+)\/avatar/.exec(url);
    return !!m && !B.avatar.idx.has((m[1] === 'users' ? 'u' : 'c') + m[2]);
  },
  _load: function (el, url) {
    var cache = B.avatar._cache, cached = cache.get(url);
    var set = function () { el.style.backgroundImage = "url('" + url + "')"; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; var t = el.querySelector('.ini'); if (t) t.remove(); };
    if (cached === true) { set(); return; }
    if (cached === false || B.avatar._missing(url)) return;
    var img = new Image();
    img.onload = function () { cache.set(url, true); set(); };
    img.onerror = function () { cache.set(url, false); };
    img.src = url;
  },
  // Подгружает фото для всех аватарок внутри root_
  apply: function (root_) {
    if (!root_) return;
    var S = B.S, base = B.http() + '://' + S.server + '/api';
    root_.querySelectorAll('[data-av-chat]').forEach(function (el) {
      var id = parseInt(el.dataset.avChat, 10), c = B.find(id); if (!c) return;
      var peer = B.peerId(c);
      if (c.type === 'direct') { if (peer) B.avatar._load(el, base + '/users/' + peer + '/avatar?t=' + S.avatarTs); }
      else B.avatar._load(el, base + '/chats/' + id + '/avatar?t=' + S.avatarTs);
    });
    root_.querySelectorAll('[data-av-user]').forEach(function (el) { B.avatar._load(el, base + '/users/' + parseInt(el.dataset.avUser, 10) + '/avatar?t=' + S.avatarTs); });
  },
  clearCache: function () { B.avatar._cache.clear(); }
};
// Галочки доставки/прочтения в пузыре: одна — отправлено, две серые — доставлено, первая синяя — прочитали не все,
// две синие — прочитано всеми
B.ticks = function (status) {
  if (!status || !status.total) return '';
  var all = status.read >= status.total;
  return all ? I('checks') : status.read > 0 ? '<span class="dv part">' + I('checks') + '</span>' : status.delivered > 0 ? '<span class="dv">' + I('checks') + '</span>' : '<span class="dv">' + I('check') + '</span>';
};
