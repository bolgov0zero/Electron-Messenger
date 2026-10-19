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
  }
};
