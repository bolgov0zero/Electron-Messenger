// /beta — экран входа в стиле макета. Логику входа делает B.auth.login, здесь только вид и ввод.
B.ui = B.ui || {};
B.ui.login = {
  el: null,
  mount: function (host) {
    var el = this.el = document.createElement('div');
    el.className = 'login'; el.hidden = true;
    el.innerHTML = B.nav.amb +
      '<div class="login-in"><div class="lg glass">' + I('chat') + '</div><h1>Electron</h1><p class="sub">Корпоративный мессенджер</p>' +
      '<label class="fld m glass-inset">' + I('user') + '<input id="l-user" type="text" placeholder="Логин" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>' +
      '<label class="fld m glass-inset">' + I('lock') + '<input id="l-pass" type="password" placeholder="Пароль" autocomplete="current-password" enterkeyhint="go"></label>' +
      '<div class="err" id="l-err" role="alert"></div><button class="abtn pri" id="l-btn" type="button">Войти</button></div>';
    host.appendChild(el);
    var user = $('#l-user', el), pass = $('#l-pass', el), btn = $('#l-btn', el), err = $('#l-err', el);
    var submit = async function () {
      var u = user.value.trim(), p = pass.value;
      btn.disabled = true; btn.textContent = 'Подключение…'; err.textContent = '';
      var r = await B.auth.login(u, p);
      if (r.ok) { pass.value = ''; hideKb(); await B.app.enter(); } else err.textContent = r.error;
      btn.disabled = false; btn.textContent = 'Войти';
    };
    btn.addEventListener('click', submit);
    [user, pass].forEach(function (i) { i.addEventListener('focus', function () { showKb(); }); });
    user.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } });
    pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  },
  show: function () { this.el.hidden = false; },
  hide: function () { this.el.hidden = true; }
};
