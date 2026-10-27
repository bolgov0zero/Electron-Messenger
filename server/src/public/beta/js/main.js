// /m — сборка приложения: оболочка с тремя вкладками (панели одинаковой высоты), экран входа, навигация, шторки.
(function () {
  var ic = B.ic, app = document.getElementById('app'), shell = null;
  B.nav.init(document.getElementById('stack'));
  B.kbd.init();
  var tabs = [['chats', 'Чаты', 'tabchats'], ['contacts', 'Контакты', 'person'], ['settings', 'Настройки', 'gear']];

  function nav(title, right) { return '<div class="nav fix lg"><div class="nav-in"><div class="nl"></div><div class="nt">' + title + '</div><div class="nr">' + (right || '') + '</div></div></div>'; }
  function mountShell() {
    if (shell) return;
    shell = document.createElement('div');
    shell.className = 'page'; shell.hidden = true;
    shell.innerHTML =
      '<div class="tabview on" data-tab="chats">' + nav('Чаты', '<button class="nb" data-act="newChat" aria-label="Новый чат">' + ic('compose', 24) + '</button>') + '<div class="scroll" id="chats-scroll"></div></div>' +
      '<div class="tabview" data-tab="contacts">' + nav('Контакты', '<button class="nb" data-act="addContact" aria-label="Добавить контакт">' + ic('userplus', 24, 1.8) + '</button>') + '<div class="scroll" id="contacts-scroll"></div></div>' +
      '<div class="tabview" data-tab="settings">' + nav('Настройки') + '<div class="scroll" style="background:var(--bg2)" id="settings-scroll"></div></div>' +
      '<div class="bottom tabbar" id="tabbar"><i class="thumb"></i>' + tabs.map(function (t, i) {
        return '<button class="tb' + (i === 0 ? ' on' : '') + '" data-tab="' + t[0] + '">' + ic(t[2], 24, 1.7) + '<span>' + t[1] + '</span>' + (t[0] === 'chats' ? '<b class="bd" hidden></b>' : '') + '</button>';
      }).join('') + '</div>';
    B.nav.setRoot(shell);
    B.ui.chatlist.mount(document.getElementById('chats-scroll'));
    B.ui.contacts.mount(document.getElementById('contacts-scroll'));
    B.ui.settings.mount(document.getElementById('settings-scroll'));
    B.ptr(document.getElementById('chats-scroll'), function () { return Promise.all([B.chats.refresh(), B.presence.load()]); });
    B.ptr(document.getElementById('contacts-scroll'), function () { return B.contacts.load(); });
    shell.addEventListener('click', function (e) { var tb = e.target.closest('.tb'); if (tb) setTab(tb.dataset.tab); });
    // Кнопки в верхней панели вкладок
    document.getElementById('stack').addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'newChat') B.ui.groups.newChat(); else if (a.dataset.act === 'addContact') B.ui.groups.addContact();
    });
  }
  // Вкладки снизу: новая вкладка въезжает со стороны своего места в панели и проявляется, прежняя уезжает в обратную
  var TABS = ['chats', 'contacts', 'settings'], curTab = 'chats', tabAnims = [];
  function setTab(name) {
    var prev = curTab;
    tabAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); tabAnims = [];
    shell.querySelectorAll('.tabview').forEach(function (v) { v.style.visibility = ''; v.style.zIndex = ''; });
    shell.querySelectorAll('.tabview').forEach(function (v) { v.classList.toggle('on', v.dataset.tab === name); });
    shell.querySelectorAll('.tb').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    curTab = name;
    moveThumb();
    var from = shell.querySelector('.tabview[data-tab="' + prev + '"]'), to = shell.querySelector('.tabview[data-tab="' + name + '"]');
    if (prev === name || !from || !to || !from.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var dir = TABS.indexOf(name) > TABS.indexOf(prev) ? 1 : -1, d = 32, ease = 'cubic-bezier(.32,.72,0,1)';
    from.style.visibility = 'visible'; from.style.zIndex = '1'; to.style.zIndex = '2';
    var a1 = from.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + (-dir * d * 0.6) + 'px)' }], { duration: 240, easing: ease, fill: 'forwards' });
    var a2 = to.animate([{ opacity: 0, transform: 'translateX(' + (dir * d) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: ease });
    tabAnims = [a1, a2];
    var done = function () { from.style.visibility = ''; from.style.zIndex = ''; to.style.zIndex = ''; try { a1.cancel(); } catch (e) {} };
    a1.onfinish = done;
    setTimeout(function () { if (tabAnims[0] === a1) done(); }, 450);   // страховка: в свёрнутом окне кадры не рисуются
  }
  // Плашка выбора под активной вкладкой: едет пружиной, как в макете
  function moveThumb() {
    var th = shell && shell.querySelector('.tabbar .thumb'), b = shell && shell.querySelector('.tb.on'); if (!th || !b || !b.offsetWidth) return;
    th.style.left = b.offsetLeft + 'px'; th.style.width = b.offsetWidth + 'px';
  }
  addEventListener('resize', function () { moveThumb(); });
  // У верхней панели появляется затемнение под ней, когда лента прокручена
  document.addEventListener('scroll', function (e) {
    var s = e.target; if (!s || !s.classList || !s.classList.contains('scroll')) return;
    var host = s.parentElement, n = host && host.querySelector(':scope > .nav'); if (n) n.classList.toggle('sc', s.scrollTop > (n.classList.contains('lg') ? 34 : 6));
  }, true);
  B.setTab = function (name) { if (shell) setTab(name); };
  function showShell() { mountShell(); B.ui.login.hide(); shell.hidden = false; B.ui.chatlist.render(); B.ui.settings.render(); requestAnimationFrame(moveThumb); setTimeout(moveThumb, 300); }
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
