// /beta — экран входа (по макету). Логику входа делает B.auth.login, здесь только вид и ввод.
B.ui = B.ui || {};
B.ui.login = {
  el: null,
  mount: function (root) {
    var el = this.el = document.createElement('div');
    el.className = 'login'; el.hidden = true;
    el.innerHTML =
      '<div class="login-in">' +
        '<div class="lg">' + B.ic('chats', 46, 1.7) + '</div>' +
        '<h1>Электрон</h1><p class="sub">Корпоративный мессенджер</p>' +
        '<div class="grp">' +
          '<div class="cell"><input id="l-user" type="text" placeholder="Логин" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next"></div>' +
          '<div class="cell"><input id="l-pass" type="password" placeholder="Пароль" autocomplete="current-password" enterkeyhint="go"></div>' +
        '</div>' +
        '<div class="err" id="l-err" role="alert"></div>' +
        '<button class="bt" id="l-btn" type="button">Войти</button>' +
      '</div>';
    root.appendChild(el);
    var user = el.querySelector('#l-user'), pass = el.querySelector('#l-pass'), btn = el.querySelector('#l-btn'), err = el.querySelector('#l-err');
    var submit = async function () {
      var u = user.value.trim(), p = pass.value;
      btn.disabled = true; btn.textContent = 'Подключение…'; err.textContent = '';
      var r = await B.auth.login(u, p);
      if (r.ok) { pass.value = ''; await B.app.enter(); }
      else err.textContent = r.error;
      btn.disabled = false; btn.textContent = 'Войти';
    };
    btn.addEventListener('click', submit);
    user.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } });
    pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  },
  show: function () { this.el.hidden = false; },
  hide: function () { this.el.hidden = true; }
};
