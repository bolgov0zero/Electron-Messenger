// Страница видеозвонка по ссылке: /k/<ссылка>. Гость вводит имя и ждёт, пока администратор его впустит; сотрудник со своей сессией
// в этом браузере входит как сотрудник. Окно звонка — общее с клиентами (shared/calls.js), здесь только вход, ожидание и итоговые экраны.
// Устройство гостя запоминается ключом в браузере: отклонённого и исключённого на нём больше не впускают (см. calllinks.js).
(function () {
  'use strict';
  // Оформление как в веб клиенте: тема, акцент, плотность стекла и размер шрифта берутся из настроек этого браузера, а без них — по системной теме
  (function look() {
    var s = null; try { s = JSON.parse(localStorage.getItem('electron_v2') || 'null'); } catch (e) {}
    var set = (s && s.settings) || {}, h = document.documentElement;
    var t = set.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var dark = t === 'dark' || t === 'navy';
    if (dark) h.classList.add('dark'); if (t === 'navy') h.classList.add('navy'); h.classList.add('font-' + (set.fontSize || 'medium'));
    h.style.colorScheme = dark ? 'dark' : 'light';
    var AC = { teal: [[29, 168, 140], [41, 214, 184]], indigo: [[92, 96, 205], [143, 148, 245]], plum: [[146, 84, 190], [196, 146, 240]], amber: [[186, 120, 38], [236, 176, 92]] };
    var key = 'teal'; try { var v = localStorage.getItem('accent'); if (AC[v]) key = v; } catch (e) {}
    var c = AC[key][dark ? 1 : 0], hex = '#' + c.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''), rgba = function (a) { return 'rgba(' + c.join(',') + ',' + a + ')'; };
    var st = h.style; st.setProperty('--accent', hex); st.setProperty('--accent-rgb', c.join(',')); st.setProperty('--primary', hex); st.setProperty('--accent-soft', rgba(.12)); st.setProperty('--primary-light', rgba(.10));
    st.setProperty('--accent-border', rgba(.28)); st.setProperty('--accent-shadow', rgba(.22)); st.setProperty('--blob1', rgba(.12));
    h.classList.toggle('gl-noimg', set.glassImage === false);
    st.setProperty('--gl-k', Math.max(.15, 1.9 - .018 * (set.glassTransparency == null ? 50 : Math.min(100, Math.max(0, +set.glassTransparency)))).toFixed(3));
  })();
  var token = decodeURIComponent(location.pathname.split('/')[2] || '');
  var KEY = 'ck_dk:' + token.slice(0, 16), CK = 'ckd_' + token.slice(0, 16);
  var G = '/api/calllink-guest', U = '/api/calllinks';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  var st = { myName: '', dk: '', emp: null, mode: '', linkId: 0, inCall: false, pollT: null, admT: null, beatT: null, name: '' };

  // ── Хранение ключа устройства: localStorage и cookie на случай очистки одного из них ──
  function loadDk() {
    var v = ''; try { v = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (!v) { var m = document.cookie.match(new RegExp('(?:^|; )' + CK + '=([^;]+)')); if (m) v = m[1]; }
    return v;
  }
  function saveDk(v) {
    st.dk = v; try { localStorage.setItem(KEY, v); } catch (e) {}
    document.cookie = CK + '=' + v + '; path=/k; max-age=' + 8 * 86400 + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }

  // ── Запросы ──
  async function req(method, url, body, auth) {
    var h = { 'Content-Type': 'application/json' }; if (auth) h.Authorization = 'Bearer ' + auth;
    var r; try { r = await fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }); } catch (e) { return { ok: false, status: 0, j: { error: 'Нет связи с сервером' } }; }
    var j = null; try { j = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, j: j || {} };
  }
  var gpost = function (path, body) { return req('POST', G + path, Object.assign({ token: token, device_key: st.dk }, body || {})); };

  // ── Экраны ──
  var ICON = {
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    off: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" x2="2" y1="2" y2="22"/>',
  };
  var ico = function (n) { return '<div class="k-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg></div>'; };
  function logo() { return '<div class="login-icon"><div class="login-logo"><img src="/chat/icons/icon-192.png" width="64" height="64" alt=""></div></div><h1 class="login-wordmark"><span>ELECTRON</span><span>MESSENGER</span></h1>'; }
  function gate(html) { $('k-gate').innerHTML = '<div class="login-wrap">' + logo() + html + '</div>'; }
  function closeGate() { $('k-gate').innerHTML = ''; }
  // «Открыть в приложении»: адрес electron-messenger:// запускает установленный клиент (Electron). На телефонах кнопки нет: там просто новая сессия в браузере.
  // Браузер не сообщает, есть ли приложение: если после нажатия окно не потеряло фокус и не скрылось — считаем, что клиент не установлен, и продолжаем в браузере
  function appBlock() { return mobile ? '' : '<button type="button" class="k-app" id="k-app">Открыть в приложении</button><p class="k-appnote" id="k-appn" hidden></p>'; }
  function bindApp() {
    var b = $('k-app'); if (!b) return;
    b.onclick = function () {
      var n = $('k-appn'), left = false, mark = function () { left = true; };
      n.hidden = true; n.textContent = '';
      window.addEventListener('blur', mark, { once: true }); document.addEventListener('visibilitychange', mark, { once: true });
      location.href = 'electron-messenger://call?u=' + encodeURIComponent(location.origin + '/k/' + token);
      setTimeout(function () {
        window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', mark);
        if (!left && !document.hidden) { n.textContent = 'Клиент не установлен или не отвечает. Продолжайте в браузере.'; n.hidden = false; }
      }, 2200);
    };
  }
  // Короткое сообщение — тот же #action-toast, что в веб клиенте
  var toastT = null;
  function toast(t) {
    var el = $('action-toast'); if (!el) { el = document.createElement('div'); el.id = 'action-toast'; document.body.appendChild(el); }
    el.textContent = t; el.classList.add('visible'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('visible'); }, 2500);
  }
  function final(icon, title, text, btn) {
    stopPoll(); stopAdmin();
    gate(ico(icon) + '<div class="k-title">' + esc(title) + '</div><p class="k-note">' + esc(text) + '</p>' + (btn ? '<button class="btn-login" id="k-btn" style="width:100%">' + esc(btn.label) + '</button>' : ''));
    if (btn) $('k-btn').onclick = btn.fn;
  }
  var END = {
    not_found: ['off', 'Ссылка не найдена', 'Проверьте адрес или попросите прислать ссылку заново.'],
    expired: ['clock', 'Срок ссылки закончился', 'Попросите организатора прислать новую ссылку.'],
    rejected: ['ban', 'Вас не впустили', 'Администратор отклонил запрос на вход в звонок.'],
    kicked: ['ban', 'Вас исключили из звонка', 'Вернуться по этой ссылке с этого устройства нельзя.'],
    ended: ['off', 'Звонок завершён', 'Если встреча продолжается, попросите администратора впустить вас снова.'],
    busy: ['clock', 'Слишком много ожидающих', 'Попробуйте открыть ссылку позже.'],
  };
  function ending(kind, btn) { var t = END[kind] || END.expired; final(t[0], t[1], t[2], btn); }

  // ── Окно звонка: общее с клиентами ──
  function initCalls(linkLeave) {
    Calls.init({
      mobile: mobile, toast: toast, sound: function () { return true; }, notify: function () {}, chatInfo: function () { return null; },
      // Плитка администратора исключает участника запросом со своей сессией; гостю запросы клиента не нужны
      api: function (m, p, b) { return st.mode === 'emp' && st.emp ? req(m, '/api' + p, b, st.emp.token).then(function (r) { return r.j; }) : Promise.resolve(null); },
      avatar: function (id, name, size) {
        if (name === 'Вы' && st.myName) name = st.myName;
        var h = (String(name || '?').split('').reduce(function (a, c) { return a + c.charCodeAt(0); }, 0) * 47) % 360, s = Math.min(size || 80, 120);
        return '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;display:grid;place-items:center;background:hsl(' + h + ',42%,44%);color:#fff;font-weight:700;font-size:' + Math.round(s * .4) + 'px">' + esc(String(name || '?').trim().charAt(0).toUpperCase()) + '</div>';
      },
      linkLeave: linkLeave,
    });
  }
  // Вышли из звонка (кнопкой, обрывом связи или исключением): страница проверяет, что дальше
  function watchCall(after) {
    st.inCall = true;
    var t = setInterval(function () { if (st.inCall && !(Calls.state && Calls.state.call)) { clearInterval(t); st.inCall = false; after(); } }, 800);
  }
  window.addEventListener('pagehide', function () {
    if (!st.inCall) return;
    try {
      if (st.mode === 'guest') navigator.sendBeacon(G + '/leave', new Blob([JSON.stringify({ token: token, device_key: st.dk })], { type: 'application/json' }));
      else if (st.emp) fetch(U + '/leave', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + st.emp.token }, body: '{}' });
    } catch (e) {}
  });

  // ── Сотрудник со своей сессией ──
  async function session() {
    var s = null; try { s = JSON.parse(localStorage.getItem('electron_v2') || 'null'); } catch (e) {}
    if (!s || !s.token) return null;
    var r = await req('GET', '/api/auth/me', null, s.token);
    return r.ok && r.j && r.j.id && !r.j.is_guest ? { token: s.token, user: r.j } : null;
  }
  async function joinEmployee() {
    st.mode = 'emp';
    await Calls.ensureMedia(true);
    var r = await req('POST', U + '/join', { token: token, page: true }, st.emp.token);
    if (!r.ok) return final('off', r.j.code === 'kicked' ? 'Вас исключили из звонка' : 'Не удалось войти', r.j.error || 'Попробуйте ещё раз.', { label: 'Повторить', fn: joinEmployee });
    closeGate();
    st.linkId = r.j.link_id; st.myName = st.emp.user.display_name;
    clearInterval(st.beatT); st.beatT = setInterval(function () { req('POST', U + '/beat', {}, st.emp.token); }, 10000);
    Calls.joinLink(r.j, { title: st.title || 'Видеозвонок' });
    watchCall(function () { clearInterval(st.beatT); final('off', 'Вы вышли из звонка', 'Можно вернуться, пока ссылка действует.', { label: 'Войти снова', fn: joinEmployee }); });
    if (r.j.owner) startAdmin();
  }

  // ── Администратор звонка: ожидающие ──
  // Панель «Ожидают входа» и кнопки «Исключить» на плитках рисует общее окно звонка (shared/calls.js), как в клиентах. У страницы нет
  // соединения с сервером чата, поэтому состояние ожидающих она опрашивает и передаёт окну тем же событием, что приходит в клиентах
  function startAdmin() {
    var tick = async function () {
      var r = await req('GET', U + '/' + st.linkId + '/state', null, st.emp.token); if (!r.ok) return;
      Calls.onWs({ type: 'call_link', event: 'update', link_id: st.linkId, waiting: r.j.waiting || [] });
    };
    clearInterval(st.admT); tick(); st.admT = setInterval(tick, 2500);
  }
  function stopAdmin() { clearInterval(st.admT); st.admT = null; }

  // ── Гость ──
  function nameForm(owner, err) {
    gate((st.title ? '<div class="k-title">' + esc(st.title) + '</div>' : '') + '<p class="login-sub">Вас пригласили на видеозвонок' + (owner ? ': ' + esc(owner) : '') + '</p>' +
      '<form id="k-form"><div class="field"><label>Ваше имя</label><input id="k-name" placeholder="Иванов Иван" maxlength="60" autocomplete="name"></div>' +
      '<p class="k-note">Имя увидят участники звонка. Администратор должен вас впустить.</p>' +
      '<button class="btn-login" id="k-go" type="submit" style="width:100%">Присоединиться</button><div class="k-err" id="k-err">' + esc(err || '') + '</div></form>' + appBlock());
    bindApp(); $('k-name').focus();
    $('k-form').addEventListener('submit', async function (e) {
      e.preventDefault(); var name = $('k-name').value.trim();
      if (name.length < 2) { $('k-err').textContent = 'Введите имя (от 2 до 60 символов)'; return; }
      $('k-go').disabled = true;
      var r = await req('POST', G + '/join', { token: token, name: name });
      if (!r.ok) { if (END[r.j.code]) return ending(r.j.code); $('k-go').disabled = false; $('k-err').textContent = r.j.error || 'Не удалось подключиться'; return; }
      saveDk(r.j.device_key); st.name = r.j.name; startGuestPoll();
    });
  }
  function stopPoll() { clearInterval(st.pollT); st.pollT = null; }
  function fmtLeft(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  // Опрос состояния: ждёт — впущен — отклонён — исключён. В звонке тот же опрос сообщает серверу, что гость на месте
  function startGuestPoll() {
    stopPoll(); st.mode = 'guest';
    var tick = async function () {
      var r = await gpost('/status'); if (!r.ok) return; var s = r.j;
      if (st.inCall) { if (s.state !== 'in') { Calls.hangup(); } return; }
      if (s.state === 'unknown') { stopPoll(); return nameForm(); }
      if (s.state === 'wait') {
        var left = s.until ? s.until - Math.floor(Date.now() / 1000) : 0;
        gate('<div class="k-icon"><span class="k-wait-dot" style="margin:0"></span></div><div class="k-title">Ожидайте подтверждения</div>' +
          '<p class="k-note">' + (s.admin_in ? 'Администратор получил ваш запрос и скоро вас впустит.' : 'Администратор ещё не подключился к звонку. Как только он зайдёт, вас впустят.') + '</p><p class="k-note">' + esc(st.name) + (left ? ' · ' + fmtLeft(left) : '') + '</p>');
      } else if (s.state === 'timeout') {
        stopPoll(); final('clock', 'Администратор не подключился', 'Вас так и не впустили. Можно попросить впустить ещё раз.', { label: 'Попросить снова', fn: function () { rejoin(); } });
      } else if (s.state === 'in') {
        stopPoll();
        gate(ico('video') + '<div class="k-title">Вас впустили</div><p class="k-note">Камера и микрофон включатся при входе, их можно выключить в звонке.</p><button class="btn-login" id="k-enter" style="width:100%">Войти в звонок</button>');
        $('k-enter').onclick = enterGuest;
      } else if (s.state === 'rejected' || s.state === 'kicked' || s.state === 'expired') { stopPoll(); ending(s.state); }
      else if (s.state === 'ended') { stopPoll(); ending('ended', { label: 'Попросить впустить снова', fn: function () { rejoin(); } }); }
    };
    tick(); st.pollT = setInterval(tick, 2000);
  }
  async function rejoin() {
    var r = await req('POST', G + '/join', { token: token, name: st.name || undefined, device_key: st.dk });
    if (!r.ok) { if (END[r.j.code]) return ending(r.j.code); return nameForm(); }
    if (r.j.state === 'rejected' || r.j.state === 'kicked') return ending(r.j.state);
    st.name = r.j.name || st.name; startGuestPoll();
  }
  async function enterGuest() {
    $('k-enter').disabled = true;
    await Calls.ensureMedia(true);
    var r = await gpost('/enter');
    if (!r.ok) { if (r.j.code === 'not_admitted') return startGuestPoll(); if (r.j.code === 'ended') return ending('ended', { label: 'Попросить впустить снова', fn: rejoin }); return final('off', 'Не удалось войти', r.j.error || 'Попробуйте ещё раз.', { label: 'Повторить', fn: startGuestPoll }); }
    closeGate(); st.myName = st.name;
    Calls.joinLink(r.j, { guest: true, title: st.title || 'Видеозвонок' });
    watchCall(function () { post_leave(); startGuestPoll(); });
    stopPoll(); st.pollT = setInterval(async function () { var s = await gpost('/status'); if (s.ok && st.inCall && s.j.state !== 'in') Calls.hangup(); }, 4000);
  }
  function post_leave() { gpost('/leave'); }

  // ── Старт ──
  async function start() {
    gate('<p class="k-note">Загрузка…</p>');
    var r = await req('GET', G + '/link/' + encodeURIComponent(token));
    if (!r.ok) return ending(END[r.j.code] ? r.j.code : 'not_found');
    var owner = r.j.owner;
    st.title = r.j.title || '';
    if (st.title) document.title = st.title;
    st.emp = await session();
    initCalls(function () { return st.mode === 'emp' ? req('POST', U + '/leave', {}, st.emp.token) : gpost('/leave'); });
    st.dk = loadDk();
    if (st.emp) {
      gate(ico('video') + '<div class="k-title">' + (st.title ? esc(st.title) : 'Видеозвонок' + (owner ? ': ' + esc(owner) : '')) + '</div><p class="k-note">Вы вошли как ' + esc(st.emp.user.display_name) + '.</p>' +
        '<button class="btn-login" id="k-emp" style="width:100%">Присоединиться</button><button class="k-sub" id="k-asg">Войти как гость</button>' + appBlock());
      bindApp(); $('k-emp').onclick = joinEmployee;
      $('k-asg').onclick = function () { st.emp = null; guestStart(owner); };
      return;
    }
    guestStart(owner);
  }
  async function guestStart(owner) {
    if (st.dk) {
      var r = await req('POST', G + '/join', { token: token, device_key: st.dk });
      if (r.ok) { st.name = r.j.name || ''; if (r.j.state === 'rejected' || r.j.state === 'kicked') return ending(r.j.state); return startGuestPoll(); }
      if (END[r.j.code]) return ending(r.j.code);
    }
    nameForm(owner);
  }
  start();
})();
