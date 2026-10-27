// /beta — сборка приложения по макету: оболочка с тремя вкладками и плавающей панелью, экран входа, навигация.
(function () {
  B.nav.init(stack);
  B.theme.init(); fit(); requestAnimationFrame(fit); setTimeout(fit, 300);
  var TABS = [['chats', 'Чаты', 'chat'], ['contacts', 'Контакты', 'users'], ['settings', 'Настройки', 'gear']], shell = null, curTab = 'chats';

  function mountShell() {
    if (shell) return;
    shell = document.createElement('div'); shell.className = 'page base'; shell.hidden = true;
    shell.innerHTML = B.nav.amb + TABS.map(function (t) { return '<div class="tabview' + (t[0] === 'chats' ? ' on' : '') + '" data-tab="' + t[0] + '"></div>'; }).join('') +
      '<div class="tabbar glass" id="tabbar"><i class="thumb"></i>' + TABS.map(function (t, i) { return '<button class="tb' + (i ? '' : ' on') + '" data-tab="' + t[0] + '" aria-label="' + t[1] + '">' + I(t[2]) + '<span>' + t[1] + '</span>' + (t[0] === 'chats' ? '<b class="bd" id="chbd" style="display:none"></b>' : '') + '</button>'; }).join('') + '</div>';
    B.nav.setRoot(shell);
    B.ui.chatlist.mount($('.tabview[data-tab="chats"]', shell)); B.ui.contacts.mount($('.tabview[data-tab="contacts"]', shell)); B.ui.settings.mount($('.tabview[data-tab="settings"]', shell));
    shell.addEventListener('click', function (e) { var b = e.target.closest('.tb'); if (b) setTab(b.dataset.tab); });
  }
  function setTab(t) {
    if (!shell) return; var prev = curTab; curTab = t;
    $$('.tb', shell).forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    moveThumb();
    $$('.tabview', shell).forEach(function (v) { var on = v.dataset.tab === t; v.classList.toggle('on', on); v.classList.toggle('out', !on && TABS.findIndex(function (x) { return x[0] === v.dataset.tab; }) < TABS.findIndex(function (x) { return x[0] === t; })); });
    if (prev !== t) hideKb();
  }
  function moveThumb() { var th = shell && $('#tabbar .thumb', shell), b = shell && $('.tb.on', shell); if (!th || !b || !b.offsetWidth) return; th.style.left = b.offsetLeft + 'px'; th.style.width = b.offsetWidth + 'px'; }
  B.setTab = setTab;
  function showShell() { mountShell(); B.ui.login.hide(); shell.hidden = false; B.ui.chatlist.render(); B.ui.settings.render(); requestAnimationFrame(moveThumb); setTimeout(moveThumb, 300); }
  function showLogin() { if (shell) { shell.hidden = true; B.nav.popToRoot(); } B.ui.login.show(); }
  addEventListener('resize', function () { moveThumb(); });

  B.lightbox.init(phone);
  B.ui.login.mount(phone);
  B.bus.on('app:login', showLogin);
  B.bus.on('auth:logout', showLogin);
  B.bus.on('app:ready', showShell);
  // Нажатие на push-уведомление открывает нужный чат
  B.onOpenChat = function (id) { if (B.find(id)) B.openChat(id); };
  B.bus.on('app:ready', function () { if (B.S.pendingOpenChatId) { var id = B.S.pendingOpenChatId; B.S.pendingOpenChatId = null; if (B.find(id)) B.openChat(id); } });
  B.app.start();
})();
