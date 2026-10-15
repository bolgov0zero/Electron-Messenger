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
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      // Скрытое приложение — «отошёл» через 5 секунд; в фоне соединение могло оборваться
      B.presence.setViewing(!document.hidden);
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (B.S.token) {
        // iOS замораживает свёрнутое PWA: сокет может остаться «открытым», но мёртвым, а события за это время потеряны.
        // Поэтому после заметной паузы соединение всегда открываем заново, а список чатов и открытый чат подтягиваем сами
        var away = hiddenAt ? Date.now() - hiddenAt : 0;
        if (!B.S.ws || B.S.ws.readyState >= 2 || away > 15000) B.ws.connect();
        B.app.resume();
      }
      B.app.checkForUpdate();
    });
    // Возврат из кэша страницы и появление сети после обрыва — то же самое
    window.addEventListener('pageshow', function (e) { if (e.persisted && B.S.token) { B.ws.connect(); B.app.resume(); } });
    window.addEventListener('online', function () { if (B.S.token) { B.ws.connect(); B.app.resume(); } });
    setTimeout(B.app.checkForUpdate, 3000);
  },
  // Догнать всё, что пропустили в фоне: список чатов (новые сообщения, счётчики), присутствие, открытый чат
  _resumeAt: 0,
  resume: function () {
    var now = Date.now(); if (now - B.app._resumeAt < 1500) return; B.app._resumeAt = now;
    B.chats.refresh();
    B.presence.load();
    if (B.msgs.chatId) { B.msgs.catchUp(); B.msgs.resync(); }
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
    B.folders.load();
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
