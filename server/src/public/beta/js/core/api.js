// /m — ядро: обращения к серверу и сессия (перенесено из /beta/app.js без изменения протокола)
B.http = function () { return /:\d+$/.test(B.S.server) ? 'http' : 'https'; };
B.wsProto = function () { return /:\d+$/.test(B.S.server) ? 'ws' : 'wss'; };

// Сессия общая с /chat и /m: сохраняем только server/token/user, остальные настройки не трогаем
B.session = {
  save: function () {
    var prev = {};
    try { prev = JSON.parse(localStorage.getItem(B.SESSION_KEY)) || {}; } catch (e) {}
    localStorage.setItem(B.SESSION_KEY, JSON.stringify(Object.assign({}, prev, { server: B.S.server, token: B.S.token, user: B.S.user })));
  },
  load: function () { try { return JSON.parse(localStorage.getItem(B.SESSION_KEY)); } catch (e) { return null; } },
  // При выходе стираем только вход, а настройки (тема, размер текста) остаются — они общие с /chat и /m
  clear: function () {
    var prev = {};
    try { prev = JSON.parse(localStorage.getItem(B.SESSION_KEY)) || {}; } catch (e) {}
    localStorage.setItem(B.SESSION_KEY, JSON.stringify(prev.settings ? { settings: prev.settings } : {}));
  }
};

// Запрос к REST API. При 401: отозванная/заблокированная сессия — выход; просроченный токен — обновление и повтор.
// Возвращает разобранный JSON либо null при ошибке сети или выходе.
B.api = async function (method, path, body) {
  var S = B.S;
  try {
    var res = await fetch(B.http() + '://' + S.server + '/api' + path, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      var info = await res.json().catch(function () { return {}; });
      if (['revoked', 'banned', 'user_not_found'].indexOf(info.code) >= 0) { B.auth.logout(); return null; }
      if (info.code === 'expired' && path !== '/auth/refresh') {
        if (await B.auth.refresh()) return B.api(method, path, body);
        if (await B.auth.keyLogin()) return B.api(method, path, body);
        B.auth.logout();
      }
      return null;
    }
    return res.json();
  } catch (e) { B.S._netFail = true; return null; }
};

B.auth = {
  _timer: null,
  refresh: async function () {
    var S = B.S;
    if (!S.token || !S.server) return false;
    // С ключом устройства суточное обновление меняет и токен, и ключ: копия ключа обнаруживается в течение суток
    try {
      var d = window.DeviceKey && await DeviceKey.refresh(S.server);
      if (d && d.token) { S.token = d.token; B.session.save(); return true; }
    } catch (e) {}
    try {
      var res = await fetch(B.http() + '://' + S.server + '/api/auth/refresh', { headers: { Authorization: 'Bearer ' + S.token } });
      if (!res.ok) return false;
      var data = await res.json();
      if (!data || !data.token) return false;
      S.token = data.token; B.session.save();
      return true;
    } catch (e) { return false; }
  },
  // Токен не принят: входим по ключу устройства (shared/devicekey.js). Пароль не хранится, форма входа остаётся для случая, когда ключа нет
  keyLogin: async function () {
    var d = window.DeviceKey && await DeviceKey.login(B.S.server);
    if (!d || !d.token) return false;
    B.S.token = d.token; B.S.user = d.user; B.session.save();
    return true;
  },
  startRefresh: function () { clearInterval(this._timer); this._timer = setInterval(function () { B.auth.refresh(); }, 24 * 60 * 60 * 1000); },

  // Вход по логину и паролю. Возвращает { ok: true } или { error: 'текст для экрана' }
  login: async function (username, password) {
    if (!username || !password) return { error: 'Заполните все поля' };
    try {
      var res = await fetch(B.http() + '://' + B.S.server + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username, password: password, device: window.DeviceKey ? DeviceKey.payload() || undefined : undefined })
      });
      var data = await res.json();
      if (!data.token) return { error: data.error || 'Неверный логин или пароль' };
      B.S.token = data.token; B.S.user = data.user; B.session.save();
      if (window.DeviceKey) DeviceKey.store(B.S.server, data);
      return { ok: true };
    } catch (e) { return { error: 'Не удалось подключиться к серверу' }; }
  },

  // Восстановление сессии при запуске: токен из хранилища + проверка, что сервер его принимает (не дольше 5 секунд)
  restore: async function () {
    var s = B.session.load();
    if (!s || !s.token) return await B.auth.keyLogin();   // сессии нет, но может быть ключ устройства
    B.S.token = s.token; B.S.user = s.user;
    // Сервер ответил отказом (токен недействителен) — на вход. Не ответил совсем (нет связи, таймаут) — входим по сохранённой
    // сессии: список чатов берётся из памяти устройства
    B.S._netFail = false;
    var ok = await Promise.race([B.api('GET', '/users/presence'), new Promise(function (r) { setTimeout(function () { r('timeout'); }, 5000); })]);
    if (!B.S.token) return false;
    if (ok !== null || B.S._netFail || ok === 'timeout') return true;
    return await B.auth.keyLogin();
  },

  logout: function () {
    if (window.DeviceKey) DeviceKey.logout(B.S.server);   // ключ этого устройства удаляется здесь и на сервере
    clearInterval(this._timer);
    if (B.S.ws) { try { B.S.ws.close(); } catch (e) {} }
    Object.assign(B.S, { token: null, user: null, chats: [], activeChatId: null, ws: null, topics: {}, users: [], contacts: [], blocked: [], presence: {}, presenceReady: false, lastSeen: {} });
    B.session.clear();
    B.bus.emit('auth:logout');
  }
};
