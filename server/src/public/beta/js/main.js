// /beta — сборка приложения: оболочка с тремя вкладками (панели одинаковой высоты), экран входа, навигация, шторки.
(function () {
  var ic = B.ic, app = document.getElementById('app'), shell = null;
  B.nav.init(document.getElementById('stack'));
  B.kbd.init();
  var tabs = [['chats', 'Чаты', 'chats'], ['contacts', 'Контакты', 'person'], ['settings', 'Настройки', 'gear']];

  function nav(title, right) { return '<div class="nav fix"><div class="nav-in"><div class="nl"></div><div class="nt">' + title + '</div><div class="nr">' + (right || '') + '</div></div></div>'; }
  function mountShell() {
    if (shell) return;
    shell = document.createElement('div');
    shell.className = 'page'; shell.hidden = true;
    shell.innerHTML =
      '<div class="tabview on" data-tab="chats">' + nav('Чаты', '<button class="nb" data-act="newChat" aria-label="Новый чат">' + ic('compose', 24) + '</button>') + '<div class="scroll" id="chats-scroll"></div></div>' +
      '<div class="tabview" data-tab="contacts">' + nav('Контакты', '<button class="nb" data-act="addContact" aria-label="Добавить контакт">' + ic('userplus', 24, 1.8) + '</button>') + '<div class="scroll" id="contacts-scroll"></div></div>' +
      '<div class="tabview" data-tab="settings">' + nav('Настройки') + '<div class="scroll" style="background:var(--bg2)" id="settings-scroll"></div></div>' +
      '<div class="bottom tabbar" id="tabbar">' + tabs.map(function (t, i) {
        return '<button class="tb' + (i === 0 ? ' on' : '') + '" data-tab="' + t[0] + '">' + ic(t[2], 24, 1.7) + '<span>' + t[1] + '</span>' + (t[0] === 'chats' ? '<b class="bd" hidden></b>' : '') + '</button>';
      }).join('') + '</div>';
    B.nav.setRoot(shell);
    B.ui.chatlist.mount(document.getElementById('chats-scroll'));
    B.ui.contacts.mount(document.getElementById('contacts-scroll'));
    B.ui.settings.mount(document.getElementById('settings-scroll'));
    shell.addEventListener('click', function (e) { var tb = e.target.closest('.tb'); if (tb) setTab(tb.dataset.tab); });
    // Кнопки в верхней панели вкладок
    document.getElementById('stack').addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'newChat') B.ui.groups.newChat(); else if (a.dataset.act === 'addContact') B.ui.groups.addContact();
    });
  }
  function setTab(name) {
    shell.querySelectorAll('.tabview').forEach(function (v) { v.classList.toggle('on', v.dataset.tab === name); });
    shell.querySelectorAll('.tb').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
  }
  B.setTab = function (name) { if (shell) setTab(name); };
  function showShell() { mountShell(); B.ui.login.hide(); shell.hidden = false; B.ui.chatlist.render(); B.ui.settings.render(); }
  function showLogin() { if (shell) { shell.hidden = true; B.nav.popToRoot(); } B.ui.login.show(); }

  B.sheet.init(app); B.actions.init(app); B.toast.init(app); B.lightbox.init(app); B.ui.msgmenu.init(app);
  B.ui.login.mount(app);
  B.bus.on('app:login', showLogin);
  B.bus.on('auth:logout', showLogin);
  B.bus.on('app:ready', showShell);
  // Нажатие на push-уведомление открывает нужный чат
  B.onOpenChat = function (id) { if (B.find(id)) B.openChat(id); };
  B.bus.on('app:ready', function () { if (B.S.pendingOpenChatId) { var id = B.S.pendingOpenChatId; B.S.pendingOpenChatId = null; if (B.find(id)) B.openChat(id); } });
  B.app.start();
})();
