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
        rehead(); if (B.ui.settings && B.ui.settings.render) B.ui.settings.render();
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
    if (g) return '<button class="glass gi cl-mjoin" data-c="gjoin" aria-label="Присоединиться к звонку" style="width:auto;padding:0 14px;color:#fff;background:linear-gradient(140deg,#3fd573,#1f9f4c);font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">' + I('phone') + g.participants.length + '</button>';
    return '<button class="glass gi" data-c="call" aria-label="Аудиозвонок">' + I('phone') + '</button><button class="glass gi" data-c="vcall" aria-label="Видеозвонок">' + I('video') + '</button>';
  }
  // Настройка пришла уже после отрисовки переписки: кнопки звонка вставляются в готовые шапки
  function rehead() {
    document.querySelectorAll('.page.chat[data-cid]').forEach(function (el) {
      var nr = el.querySelector('.nr'); if (!nr) return;
      nr.querySelectorAll('[data-c="call"],[data-c="vcall"]').forEach(function (b) { b.remove(); });
      var chat = B.find(+el.dataset.cid), h = chat ? btns(chat) : '';
      if (h) nr.insertAdjacentHTML('afterbegin', h);
    });
  }
  B.bus.on('ws:connected', function () { init(); Calls.load().then(rehead); });
  // Нажали на уведомление, когда приложение уже открыто в фоне
  B.onOpenCall = function (callId) { init(); B.S.pendingCall = callId || null; if (window.Calls) Calls.load().then(rehead); };
  ['incoming', 'accepted', 'answered', 'ended', 'group', 'prefs', 'config', 'conf'].forEach(function (t) { B.bus.on('ws:call_' + t, function (d) { if (window.Calls) Calls.onWs(d); }); });
  return { init: init, btns: btns, start: function (cid, video) { if (window.Calls) Calls.start(cid, video); } };
})();
