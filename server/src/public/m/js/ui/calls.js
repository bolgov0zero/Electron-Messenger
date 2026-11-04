// /m — звонки: общий модуль /shared/calls.js рисует и ведёт разговор, здесь только связка с ядром приложения:
// запросы, события сервера, кнопки в шапке переписки (chat.js вызывает B.ui.calls.btns и B.ui.calls.start).
B.ui = B.ui || {};
B.ui.calls = (function () {
  var up = false;
  function init() {
    if (up || !window.Calls) return; up = true;
    Calls.init({
      mobile: true,
      api: function (m, p, b) { return B.api(m, p, b); },
      toast: function (t) { B.toast.show(t); },
      avatar: function (id, name, size) { return B.avatar.user(id, name, size, true); },
      decorate: function (el) { try { B.avatar.apply(el); } catch (e) {} },
      openChat: function (id) { B.openChat(id); },
      chatInfo: function (id) { var c = B.find(id); return c ? { type: c.type, name: B.chatName(c) } : null; },
      onConfig: function () {
        rehead(); B.bus.emit('chats:changed'); if (B.ui.settings && B.ui.settings.render) B.ui.settings.render();
        // Звонки выключили на сервере, а открыта страница их настроек: закрываем её
        var p = B.nav.top && B.nav.top(); if (p && p.el && p.el.dataset.calls && !Calls.available()) B.nav.pop();
      },
      contacts: function () { return B.S.contacts.filter(function (u) { return u.id !== B.S.user.id && !u.is_bot; }).map(function (u) { return { id: u.id, name: (u.display_name || u.username) + (u.federated ? ' · ' + (u.server_name || u.server_id || 'другой сервер') : '') }; }); },
      pendingCall: function () { var c = B.S.pendingCall; B.S.pendingCall = null; return c; },
      sound: function () { return true; }
    });
  }
  // Кнопки звонка в шапке переписки: два значка слева от аватарки
  function btns(chat) {
    var peer = chat.type === 'direct' && !B.isSys(chat) ? B.peerId(chat) : null;
    if (!window.Calls || !Calls.canCall(chat, peer)) return '';
    var g = chat.type === 'group' && Calls.state.groups[chat.id];
    // Круглая кнопка того же размера, что и остальные: трубка и число участников друг под другом
    if (g) return '<button class="glass gi cl-mjoin" data-c="gjoin" aria-label="Присоединиться к звонку, участников: ' + g.participants.length + '" style="color:#fff;background:linear-gradient(140deg,#3fd573,#1f9f4c);display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:0;font-weight:800;font-size:11px;line-height:1"><span style="display:grid;place-items:center;font-size:15px;line-height:0">' + I('phone') + '</span><span style="margin-top:2px">' + g.participants.length + '</span></button>';
    // Кнопка есть, только если этот вид звонка доступен: аудио включает администратор, а человек может отключить любой вид у себя
    var p = Calls.prefs();
    return (p.audio ? '<button class="glass gi" data-c="call" aria-label="Аудиозвонок">' + I('phone') + '</button>' : '') + (p.video ? '<button class="glass gi" data-c="vcall" aria-label="Видеозвонок">' + I('video') + '</button>' : '');
  }
  // Настройка пришла уже после отрисовки переписки: кнопки звонка вставляются в готовые шапки
  function rehead() {
    document.querySelectorAll('.page.chat[data-cid]').forEach(function (el) {
      var nr = el.querySelector('.nr'); if (!nr) return;
      nr.querySelectorAll('[data-c="call"],[data-c="vcall"],[data-c="gjoin"]').forEach(function (b) { b.remove(); });
      var chat = B.find(+el.dataset.cid), h = chat ? btns(chat) : '';
      if (h) nr.insertAdjacentHTML('afterbegin', h);
    });
  }
  B.bus.on('ws:connected', function () { init(); Calls.load().then(rehead); });
  // Нажали на уведомление, когда приложение уже открыто в фоне
  B.onOpenCall = function (callId) { init(); B.S.pendingCall = callId || null; if (window.Calls) Calls.load().then(rehead); };
  ['incoming', 'accepted', 'answered', 'ended', 'group', 'prefs', 'config', 'conf', 'audio', 'link', 'quality'].forEach(function (t) { B.bus.on('ws:call_' + t, function (d) { if (window.Calls) Calls.onWs(d); }); });
  // Ссылка на видеозвонок этого сервера (/k/<токен>): в мобильном клиенте открывается как обычный звонок, человек входит как сотрудник
  function linkToken(href) {
    try { var u = new URL(href, location.href); var m = u.origin === location.origin && /^\/k\/([\w-]{16,100})\/?$/.exec(u.pathname); return m ? m[1] : null; } catch (e) { return null; }
  }
  async function joinLink(token) {
    init(); if (!window.Calls) return;
    if (Calls.state.call) { B.toast.show('Вы уже в звонке'); return; }
    await Calls.ensureMedia(true);
    var r = await B.api('POST', '/calllinks/join', { token: token });
    if (!r || r.error) { B.toast.show((r && r.error) || 'Не удалось войти в звонок'); return; }
    Calls.joinLink(r, { title: 'Видеозвонок по ссылке' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var t = linkToken(a.getAttribute('href')); if (!t) return;
    e.preventDefault(); e.stopPropagation(); joinLink(t);
  }, true);
  return { joinLink: joinLink, linkToken: linkToken, init: init, btns: btns, start: function (cid, video) { if (window.Calls) Calls.start(cid, video); } };
})();
