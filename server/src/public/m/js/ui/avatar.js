// /m — аватарки: цветной кружок с инициалами, поверх которого подгружается фото (если оно есть на сервере)
B.avatar = {
  PAL: [['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'], ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed']],
  _cache: new Map(),
  // o = { id (для цвета), chat | user (что грузить), text (запасные буквы), dot (id пользователя для значка «в сети») }
  html: function (o, size) {
    var c = B.avatar.PAL[(o.id || 0) % B.avatar.PAL.length], attr = '';
    if (o.chat) attr = ' data-av-chat="' + o.chat + '"'; else if (o.user) attr = ' data-av-user="' + o.user + '" data-av-fb="' + B.esc(o.text || '') + '"';
    var st = o.dot ? (B.S.presence[o.dot] || 'offline') : 'offline';
    return '<div class="avw" style="--s:' + size + 'px"><div class="av"' + attr + ' style="--c1:' + c[0] + ';--c2:' + c[1] + '">' + B.esc(o.text || '') + '</div>' +
      (o.dot && st !== 'offline' ? '<i class="pr' + (st === 'away' ? ' away' : '') + '"></i>' : '') + '</div>';
  },
  chat: function (c, size) {
    var peer = B.peerId(c);
    if (c.type === 'direct') return B.avatar.html({ id: peer || c.id, chat: c.id, text: B.fmt.initials(B.chatName(c)), dot: peer }, size);
    return B.avatar.html({ id: c.id, chat: c.id, text: c.type === 'room' ? '#' : B.fmt.initials(B.chatName(c)) }, size);
  },
  user: function (id, name, size, nodot) { return B.avatar.html({ id: id, user: id, text: B.fmt.initials(name), dot: nodot ? 0 : id }, size); },
  _load: function (el, url, fb) {
    var cache = B.avatar._cache, cached = cache.get(url);
    var set = function () { el.style.backgroundImage = "url('" + url + "')"; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; };
    if (cached === true) { set(); return; }
    if (cached === false) return;
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
