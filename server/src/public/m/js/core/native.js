// /m — переход из PWA в нативное приложение (Swift). Нужен, когда у нативного приложения нет своих push-уведомлений
// (бесплатный аккаунт разработчика): уведомления приходят в PWA, а по нажатию чат открывается в приложении.
//
// Цепочка: нажатие на уведомление → открылось PWA → оно сразу переходит по адресу <схема>://chat/<id>?server=<сервер>.
// iOS может спросить подтверждение. Если страница после перехода осталась на экране (приложения нет, переход заблокирован
// или пользователь отказал), чат открывается здесь же, в PWA.
B.native = {
  DEFAULT: 'electron',
  scheme: function () { try { return localStorage.getItem('m.nativeScheme') || ''; } catch (e) { return ''; } },
  enabled: function () { return !!B.native.scheme(); },
  setEnabled: function (on) { try { if (on) localStorage.setItem('m.nativeScheme', B.native.scheme() || B.native.DEFAULT); else localStorage.removeItem('m.nativeScheme'); } catch (e) {} },
  url: function (chatId) { return B.native.scheme() + '://chat/' + chatId + '?server=' + encodeURIComponent(B.S.server || ''); },
  // fallback — открыть чат внутри PWA
  openFromPush: function (chatId, fallback) {
    if (!B.native.enabled()) { fallback(); return; }
    var done = false, timer = null;
    var left = function () { if (document.hidden) finish(true); };
    function finish(opened) {
      if (done) return; done = true; clearTimeout(timer);
      document.removeEventListener('visibilitychange', left); window.removeEventListener('pagehide', gone);
      if (!opened) fallback();
    }
    function gone() { finish(true); }
    document.addEventListener('visibilitychange', left); window.addEventListener('pagehide', gone);
    timer = setTimeout(function () { finish(false); }, 2400);
    try { location.href = B.native.url(chatId); } catch (e) { finish(false); }
  },
  last: null,   // последнее нажатие на уведомление: откуда пришло, чат, что сделали (для «Диагностики»)
  // Единая точка входа: нажатие на уведомление пришло сообщением от service worker, адресом или записью в кэше.
  // Один и тот же чат за короткое время открываем один раз
  fromNotification: function (id, via) {
    id = +id; if (!id) return;
    var now = Date.now(), p = B.native._p;
    if (p && p.id === id && now - p.t < 4000) return;
    B.native._p = { id: id, t: now };
    B.native.last = { via: via, id: id, t: now, step: B.native.enabled() ? 'переход в приложение' : 'открытие в PWA' };
    B.native.onOpen(id);
  },
  // Запись о нажатии, оставленная service worker'ом (iOS не всегда отдаёт PWA адрес или сообщение)
  checkPending: function () {
    if (!B.S.token) return;
    fetch('/m/__open', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.chatId && Date.now() - d.t < 120000) B.native.fromNotification(d.chatId, 'запись service worker');
    }).catch(function () {});
  },
  // Открыть чат внутри PWA; если чаты ещё не подгрузились, подождать
  openHere: function (id) {
    var n = 0;
    (function go() {
      if (B.find(id)) { B.openChat(id); if (B.native.last && B.native.last.id === id) B.native.last.step += ' → чат открыт'; return; }
      if (n === 0 && B.chats && B.chats.refresh) { try { B.chats.refresh(); } catch (e) {} }
      if (++n < 8) setTimeout(go, 500); else if (B.native.last) B.native.last.step += ' → чат не найден';
    })();
  },
  // Что сейчас знает service worker: его версия и последнее нажатие на уведомление (для «Диагностики»)
  swInfo: function () {
    return new Promise(function (resolve) {
      var out = { sw: null, click: null, log: [] }, n = 0, fin = function () { if (++n === 3) resolve(out); };
      fetch('/m/__log', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d)) out.log = d; }).catch(function () {}).then(fin);
      fetch('/m/__last', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.t) out.click = d; }).catch(function () {}).then(fin);
      var done = false, off = function (v) { if (done) return; done = true; out.sw = v; fin(); };
      try {
        var ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!ctl) { off(null); return; }
        navigator.serviceWorker.addEventListener('message', function h(e) { if (e.data && e.data.type === 'sw-info') { navigator.serviceWorker.removeEventListener('message', h); off(e.data.cache); } });
        ctl.postMessage('sw-info'); setTimeout(function () { off('нет ответа (старая версия)'); }, 1500);
      } catch (e) { off(null); }
    });
  },
  // Запасной путь, если iOS не доставила нажатие на уведомление service worker'у: если недавно показали пуш и приложение
  // открыли в течение минуты, открываем чат этого пуша. Можно выключить в настройках
  pushJump: function () { try { return localStorage.getItem('m.pushJump') !== '0'; } catch (e) { return true; } },
  setPushJump: function (on) { try { localStorage.setItem('m.pushJump', on ? '1' : '0'); } catch (e) {} },
  checkPush: function () {
    if (!B.S.token || !B.native.pushJump()) return;
    fetch('/m/__push', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.chatId || !d.shown || Date.now() - d.t > 60000 || B.native._pushT === d.t) return;
      B.native._pushT = d.t;
      fetch('/m/__push?clear=1', { cache: 'no-store' }).catch(function () {});
      B.native.fromNotification(d.chatId, 'недавний пуш (нажатие до service worker не дошло)');
    }).catch(function () {});
  }
};
