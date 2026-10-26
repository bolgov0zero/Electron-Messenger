// Ключ устройства для браузера и телефона (/chat и /m). Общий для обеих страниц: они делят хранилище адреса, так что это одно устройство.
// Вход по паролю выдаёт ключ (server/src/devices.js), он лежит в хранилище страницы. Токен не принят — страница входит по ключу сама,
// пароль нигде не хранится. Ключ гаснет через 90 дней без использования, отозвать его можно в админке («Пользователи → Устройства»).
// У гостя (/g) ключей нет.
(function () {
  if (window.DeviceKey) return;
  var IDK = 'electron_device_id', KEYK = 'electron_devkey';
  var guest = !!window.__GUEST__;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function rand() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  // «Chrome · Windows», «Safari · iPhone»: по строке браузера, чтобы устройство можно было узнать в списке
  function label() {
    var u = navigator.userAgent || '', b = 'Браузер', o = '';
    if (/Edg\//.test(u)) b = 'Edge'; else if (/OPR\/|Opera/.test(u)) b = 'Opera'; else if (/YaBrowser/.test(u)) b = 'Яндекс Браузер';
    else if (/Firefox\/|FxiOS/.test(u)) b = 'Firefox'; else if (/CriOS|Chrome\//.test(u)) b = 'Chrome'; else if (/Safari\//.test(u)) b = 'Safari';
    if (/iPhone/.test(u)) o = 'iPhone'; else if (/iPad/.test(u)) o = 'iPad'; else if (/Android/.test(u)) o = 'Android';
    else if (/Windows/.test(u)) o = 'Windows'; else if (/Mac OS X|Macintosh/.test(u)) o = 'macOS'; else if (/Linux|X11/.test(u)) o = 'Linux';
    return o ? b + ' · ' + o : b;
  }
  function info() {
    var id = get(IDK);
    if (!id || !/^[\w-]{8,64}$/.test(id)) { id = rand(); put(IDK, id); }
    return { id: id, name: label(), platform: /^\/m(\/|$)/.test(location.pathname) ? 'mobile' : 'web' };
  }
  function http(server) { return (/:\d+$/.test(server) ? 'http' : 'https') + '://' + server + '/api'; }
  async function post(server, path, body, token) {
    try {
      var res = await fetch(http(server) + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) });
      var data = {}; try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data: data };
    } catch (e) { return { ok: false, status: 0, data: {} }; }
  }
  function load() { try { return JSON.parse(get(KEYK) || 'null'); } catch (e) { return null; } }

  var inflight = null;
  function rotate(server) {
    if (guest) return Promise.resolve(null);
    if (inflight) return inflight;
    var run = async function () {
      var k = load();
      if (!k || !k.key || k.server !== server) return null;
      var r = await post(server, '/auth/device-login', { key: k.key, device: info() });
      if (r.ok && r.data.token) { window.DeviceKey.store(server, r.data); return r.data; }
      if (r.status === 401) del(KEYK);   // отозван, не найден, истёк срок или использован повторно
      return null;
    };
    var p = (navigator.locks && navigator.locks.request) ? navigator.locks.request('electron-devkey', run) : run();
    inflight = p.then(function (v) { inflight = null; return v; }, function (e) { inflight = null; throw e; });
    return inflight;
  }

  window.DeviceKey = {
    // Сведения об устройстве для запроса входа
    payload: function () { return guest ? null : info(); },
    // После входа по паролю или выдачи ключей: запомнить ключ
    store: function (server, data) { if (!guest && data && data.device_key) put(KEYK, JSON.stringify({ server: server, key: data.device_key })); },
    // Обмен ключа на новый (ротация, server/src/devices.js): токен не принят или суточное обновление. Возвращает ответ сервера
    // (token, user) или null. Параллельные обмены (две вкладки, два запроса) идут по очереди: иначе в хранилище остался бы не тот
    // ключ, и сервер принял бы это за копию
    login: function (server) { return rotate(server); },
    refresh: function (server) { return rotate(server); },
    // Вошли раньше, чем появились ключи: выдать по действующему токену. Возвращает новый токен или null
    ensure: async function (server, token) {
      if (guest || !token) return null;
      var k = load();
      if (k && k.key && k.server === server) return null;
      var r = await post(server, '/auth/device-keys', { device: info() }, token);
      if (!r.ok) return null;
      this.store(server, r.data);
      return r.data.token || null;
    },
    // Выход: ключ удаляется на сервере и здесь
    logout: function (server) {
      var k = load(); del(KEYK);
      if (!guest && k && k.key && k.server === server) post(server, '/auth/device-logout', { key: k.key });
    }
  };
})();
