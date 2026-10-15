// /m — ядро: запуск приложения, вход в сессию, жизненный цикл (видимость, проверка версии)
B.app = {
  _checking: false,
  // Запуск: восстановить сессию и войти, либо показать экран входа. Экраны слушают 'app:login' и 'app:ready'.
  start: async function () {
    var q = new URLSearchParams(location.search), chatId = q.get('chatId');
    var restored = await B.auth.restore();
    if (restored && chatId) {
      B.S.pendingOpenChatId = parseInt(chatId, 10);
      history.replaceState(null, '', location.pathname); // не открывать повторно при следующем запуске PWA
    }
    if (restored) await B.app.enter(); else { B.S.token = null; B.bus.emit('app:login'); }
    document.addEventListener('visibilitychange', function () {
      // Скрытое приложение — «отошёл» через 5 секунд; в фоне соединение могло оборваться
      B.presence.setViewing(!document.hidden);
      if (!document.hidden) {
        if (B.S.token && (!B.S.ws || B.S.ws.readyState >= 2)) B.ws.connect();
        B.app.checkForUpdate();
      }
    });
    setTimeout(B.app.checkForUpdate, 3000);
  },
  // Вход после успешной авторизации (по паролю или по сохранённой сессии)
  enter: async function () {
    B.auth.startRefresh();
    B.chats.refreshServerInfo();
    B.presence.load();
    B.upload.load();
    B.contacts.load();
    B.contacts.loadBlocks();
    B.modules.init();
    await B.chats.load();
    B.ws.connect();
    B.modules.refresh();
    if (B.push.permission() === 'granted') B.push.subscribe();
    B.bus.emit('app:ready');
  },
  // У установленного PWA нет кнопки «обновить страницу»: сверяем версию в свежем HTML и перезагружаемся
  checkForUpdate: async function () {
    if (B.app._checking) return;
    B.app._checking = true;
    try {
      var html = await (await fetch('/m/?_=' + Date.now(), { cache: 'no-store' })).text();
      var m = html.match(/\?v=([\w.\-]+)/), cur = (window.APP_VERSION || '').replace('?v=', '');
      if (m && m[1] && cur && m[1] !== cur) location.reload();
    } catch (e) {} finally { B.app._checking = false; }
  }
};
