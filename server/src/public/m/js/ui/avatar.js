// /m — аватарки: цветной кружок с инициалами, поверх которого подгружается фото (если оно есть на сервере)
B.avatar = {
  PAL: [['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'], ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed']],
  _cache: new Map(),
  GLOBE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  // o = { id (для цвета), chat | user (что грузить), text (запасные буквы), dot (id пользователя для значка «в сети») }
  html: function (o, size) {
    var c = B.avatar.PAL[(o.id || 0) % B.avatar.PAL.length], attr = '';
    if (o.chat) attr = ' data-av-chat="' + o.chat + '"'; else if (o.user) attr = ' data-av-user="' + o.user + '" data-av-fb="' + B.esc(o.text || '') + '"';
    var st = o.dot ? (B.S.presence[o.dot] || 'offline') : 'offline';
    return '<div class="avw" style="--s:' + size + 'px"><div class="av"' + attr + ' style="--c1:' + c[0] + ';--c2:' + c[1] + '">' + B.esc(o.text || '') + '</div>' +
      (o.fb || '') + (o.dot && st !== 'offline' ? '<i class="pr' + (st === 'away' ? ' away' : '') + (st === 'online' && B.S.presenceMobile && B.S.presenceMobile[o.dot] ? ' mob' : '') + '"></i>' : '') + (o.fed ? '<i class="fedb" title="С другого сервера">' + B.avatar.GLOBE + '</i>' : '') + '</div>';
  },
  // badge — значок папки в левом верхнем углу (в списке чатов)
  chat: function (c, size, badge) {
    var peer = B.peerId(c), fb = badge && B.folders ? B.folders.badge(c, size) : '';
    if (c.type === 'direct') return B.avatar.html({ id: peer || c.id, chat: c.id, text: B.fmt.initials(B.chatName(c)), dot: B.isSys(c) ? 0 : peer, fb: fb }, size);
    var root = c.parent_id ? B.find(c.parent_id) || c : c;   // у темы значок комнаты
    return B.avatar.html({ id: c.id, chat: c.id, text: c.type === 'room' ? '#' : B.fmt.initials(B.chatName(c)), fb: fb, fed: !!root.fed_mirror }, size);
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
  _load: function (el, url, fb) {
    var cache = B.avatar._cache, cached = cache.get(url);
    var set = function () { el.style.backgroundImage = "url('" + url + "')"; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; };
    if (cached === true) { set(); return; }
    if (cached === false || B.avatar._missing(url)) return;
    var img = new Image();
    img.onload = function () { cache.set(url, true); set(); };
    img.onerror = function () { cache.set(url, false); };
    img.src = url;
  },
  // Подгружает фото для всех аватарок внутри root
  apply: function (root) {
    var S = B.S, base = B.http() + '://' + S.server + '/api';
    root.querySelectorAll('[data-av-chat]').forEach(function (el) {
      var id = parseInt(el.dataset.avChat, 10), c = B.find(id); if (!c) return;
      var peer = B.peerId(c);
      if (c.type === 'direct') { if (peer) B.avatar._load(el, base + '/users/' + peer + '/avatar?t=' + S.avatarTs); }
      else B.avatar._load(el, base + '/chats/' + id + '/avatar?t=' + S.avatarTs);
    });
    root.querySelectorAll('[data-av-user]').forEach(function (el) {
      B.avatar._load(el, base + '/users/' + parseInt(el.dataset.avUser, 10) + '/avatar?t=' + S.avatarTs);
    });
  },
  clearCache: function () { B.avatar._cache.clear(); }
};
B.ticks = function (status) {
  if (!status || !status.total) return '';
  // Первая галочка закрашена, когда сообщение прочитал хотя бы один получатель, вторая — когда прочитали все
  // (у личного чата это одно и то же). Класс off у «непрочитанной» галочки: на синем пузыре она бледнее
  var all = status.read >= status.total, part = status.read > 0 && !all, dbl = status.delivered > 0 || status.read > 0;
  var on1 = all || part, on2 = all;
  var tk = function (pts, on) { return '<polyline class="' + (on ? 'on' : 'off') + '" stroke="' + (on ? 'var(--accent)' : 'var(--fg2)') + '" points="' + pts + '"/>'; };
  return '<svg class="tk" width="16" height="11" viewBox="0 0 18 9" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (dbl ? tk('1,5.5 3.5,8 9,1', on1) : '') + tk('7,5.5 9.5,8 15,1', on2) + '</svg>';
};
