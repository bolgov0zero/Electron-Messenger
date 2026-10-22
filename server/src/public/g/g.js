// Гостевой режим веб-клиента. Страница /g/<ссылка> — это тот же клиент, что /chat (app.js, стили, панели смайлов, форматирование,
// контекстные меню): здесь только вход по ссылке и то, что гостю закрыто. Подключается после app.js; её функции и состояние (S, api,
// connectWS…) общие, поэтому отдельные функции подменяются ниже. Хранилище браузера у гостя своё (см. index.js, GUEST_SHIM).
(function () {
  'use strict';
  var G = window.__GUEST__ || {}, token = G.token, real = G.ls || window.localStorage;
  var KEY = 'electron_guest:' + (token || '').slice(0, 24), CK = 'gdk_' + (token || '').slice(0, 16);
  var st = { jwt: null, dk: null, expires: 0, skew: 0, ended: false, reopening: false, chat: null, members: [] };

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };

  // ── Хранение ключа устройства: свой ключ в localStorage и cookie на случай очистки одного из них ──
  function loadSaved() {
    var v = null; try { v = JSON.parse(real.getItem(KEY) || 'null'); } catch (e) {}
    if (!v || !v.dk) { var m = document.cookie.match(new RegExp('(?:^|; )' + CK + '=([^;]+)')); if (m) v = { dk: m[1] }; }
    return v || {};
  }
  function save() {
    try { real.setItem(KEY, JSON.stringify({ dk: st.dk, jwt: st.jwt })); } catch (e) {}
    var age = Math.max(60, st.expires - Math.floor(Date.now() / 1000));
    document.cookie = CK + '=' + st.dk + '; path=/g; max-age=' + age + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function forget() { try { real.removeItem(KEY); } catch (e) {} document.cookie = CK + '=; path=/g; max-age=0'; }

  // ── Экраны входа и окончания доступа (поверх клиента) ──
  var LOCK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  var END = {
    expired: ['Доступ закончился', 'Срок действия ссылки истёк. Нужен новый доступ — попросите прислать ссылку заново.'],
    revoked: ['Ссылка отозвана', 'Организатор закрыл эту ссылку. Если доступ нужен, попросите новую.'],
    other_device: ['Ссылка уже открыта на другом устройстве', 'Её можно использовать только с устройства, где она была открыта первой. Попросите прислать новую ссылку.'],
    not_found: ['Ссылка не найдена', 'Проверьте адрес или попросите прислать ссылку заново.'],
    busy: ['Слишком много попыток', 'Подождите несколько минут и откройте ссылку снова.']
  };
  function logo() { return '<div class="login-icon"><div class="login-logo"><img src="/chat/icons/icon-192.png" width="64" height="64" alt=""></div></div><h1 class="login-wordmark"><span>ELECTRON</span><span>MESSENGER</span></h1>'; }
  function gate(html) {
    var g = $('g-gate'); if (!g) { g = document.createElement('div'); g.id = 'g-gate'; document.body.appendChild(g); }
    g.innerHTML = '<div class="login-wrap">' + logo() + html + '</div>';
  }
  function closeGate() { var g = $('g-gate'); if (g) g.remove(); }
  function end(kind) {
    if (st.ended) return; st.ended = true;
    try { if (S.ws) { S.ws.onclose = null; S.ws.close(); } } catch (e) {}
    S.token = null;
    if (kind === 'expired' || kind === 'revoked' || kind === 'not_found') forget();
    var t = END[kind] || END.expired;
    gate('<div class="g-end-icon">' + LOCK + '</div><div class="login-sub" style="font-weight:700;color:var(--text)">' + esc(t[0]) + '</div><p class="g-note">' + esc(t[1]) + '</p>');
  }
  function nameForm(chatName, err) {
    gate('<p class="login-sub">Вас пригласили в чат «' + esc(chatName) + '»</p>' +
      '<form id="g-name-form"><div class="field"><label>Ваше имя</label><input id="g-name" placeholder="Иванов Иван" maxlength="60" autocomplete="name"></div>' +
      '<div class="g-warn"><b>Ссылка одноразовая</b>После входа она будет работать только на этом устройстве, с другого открыть её уже не получится. Входом считается нажатие «Войти в чат» после ввода имени: до этого ссылку можно открыть и на другом устройстве.</div>' +
      '<p class="g-note">Имя увидят участники чата. Сообщения, написанные до вашего входа, вам не показываются.</p>' +
      '<button class="btn-login" id="g-go" type="submit" style="width:100%">Войти в чат</button><div class="g-err" id="g-err">' + esc(err || '') + '</div></form>');
    $('g-name').focus();
    $('g-name-form').addEventListener('submit', async function (e) {
      e.preventDefault(); var name = $('g-name').value.trim();
      if (name.length < 2) { $('g-err').textContent = 'Введите имя (от 2 до 60 символов)'; return; }
      $('g-go').disabled = true;
      var r = await open(name, null);
      if (!r.ok && !st.ended) { $('g-go').disabled = false; $('g-err').textContent = r.error || 'Не удалось войти'; }
    });
  }

  // ── Вход ──
  async function open(name, dk) {
    var res = await fetch('/api/guest/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, name: name || undefined, device_key: dk || undefined }) });
    var j = null; try { j = await res.json(); } catch (e) {}
    j = j || {};
    if (res.ok) { await enter(j); return { ok: true }; }
    if (res.status === 429) { end('busy'); return { ok: false }; }
    if (j.code === 'name_required') return { ok: false, code: j.code, error: j.error };
    if (END[j.code]) { end(j.code); return { ok: false, code: j.code }; }
    return { ok: false, error: j.error || 'Не удалось войти' };
  }
  async function boot() {
    gate('<p class="g-note">Подключаюсь…</p>');
    if (!token) return end('not_found');
    var saved = loadSaved();
    if (saved.dk) { var r = await open(null, saved.dk); if (r.ok || st.ended) return; }
    var p = await fetch('/api/guest/link/' + encodeURIComponent(token)); var j = {}; try { j = await p.json(); } catch (e) {}
    if (p.status === 429) return end('busy');
    if (!p.ok) return end(END[j.code] ? j.code : 'not_found');
    if (j.claimed) return end('other_device');
    nameForm(j.chat_name);
  }

  // ── Запуск клиента в чате гостя ──
  function toMembers(list) { return list.map(function (m) { return { id: m.id, username: '', display_name: m.display_name, tag: m.tag || null }; }); }
  function guestChat(info) {
    var c = info.chat;
    return { id: c.id, type: c.type, name: c.name, created_by: null, is_secret: 0, read_only: c.read_only ? 1 : 0, pinned: 0, has_topics: 0, muted: 0, unread: 0, unread_mentions: 0, last_message: null, members: toMembers(info.members) };
  }
  async function enter(d) {
    st.jwt = d.token; st.dk = d.device_key; st.expires = d.expires_at; save();
    S.token = d.token;
    S.user = { id: d.user.id, username: '', display_name: d.user.display_name, tag: 'Гость', is_admin: false, can_announce: false, must_change_password: false, workspaces: [], is_guest: true };
    var info = await rawApi('GET', '/guest/chat'); if (st.ended) return;
    if (!info || !info.chat) return end('expired');
    st.chat = info.chat; st.members = info.members;
    S.allUsers = toMembers(info.members);
    S.chats = [guestChat(info)];
    S.settings.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applySettings();
    document.title = (info.chat.name || 'Чат') + ' · Электрон';
    closeGate();
    $('screen-login').classList.remove('active'); $('screen-main').classList.add('active');
    drawPill(); syncExpiry(); setInterval(tick, 5000); setInterval(syncExpiry, 60000);
    loadUploadSettings();
    connectWS();
    openChat(info.chat.id);
  }

  // ── Сколько ещё действует ссылка: правый блок шапки (как блок кнопок в /chat); шапка перерисовывается при открытии чата, поэтому вставка следит за ней ──
  var CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  function drawPill() {
    var put = function () {
      var box = document.querySelector('.chat-header-actions');
      if (box && !box.querySelector('.g-timer')) { var d = document.createElement('div'); d.className = 'g-timer'; d.title = 'Сколько ещё действует ссылка'; d.innerHTML = CLOCK + '<span>Осталось</span><b class="g-timer-t">--:--</b>'; box.appendChild(d); tick(); }
    };
    put(); new MutationObserver(put).observe($('chat-main'), { childList: true, subtree: true });
  }
  function tick() {
    var left = st.expires - Math.floor((Date.now() + st.skew) / 1000);
    if (left <= 0) return end('expired');
    var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), hm = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    document.querySelectorAll('.g-timer').forEach(function (t) { t.classList.toggle('low', left < 900); var b = t.querySelector('.g-timer-t'); if (b) b.textContent = hm; });
  }
  async function syncExpiry() {   // запасной путь, если событие о продлении не дошло
    var r = await rawApi('GET', '/guest/me');
    if (r && r.expires_at) { st.expires = r.expires_at; st.skew = r.now ? r.now * 1000 - Date.now() : 0; tick(); }
  }

  // ── Запросы к серверу: гостю открыты немногие; остальное клиент просит впустую и получает «ничего» ──
  var ALLOW = [/^GET \/guest\/(me|chat)$/, /^GET \/messages\/chat\/\d+(\?.*)?$/, /^GET \/messages\/\d+\/reactions$/, /^GET \/upload\/settings$/, /^DELETE \/upload\/?$/];
  async function rawApi(method, path, body) {
    try {
      var res = await fetch('/api' + path, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, st.jwt ? { Authorization: 'Bearer ' + st.jwt } : {}), body: body ? JSON.stringify(body) : undefined });
      if (res.status === 401) {
        var j = await res.json().catch(function () { return {}; });
        if (j.code === 'expired' && st.dk && !st.reopening) {   // токен гостя живёт долго, но не вечно: входим заново с ключом устройства
          st.reopening = true;
          var rr = await fetch('/api/guest/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, device_key: st.dk }) });
          var rj = await rr.json().catch(function () { return {}; }); st.reopening = false;
          if (rr.ok && rj.token) { st.jwt = rj.token; S.token = rj.token; save(); return rawApi(method, path, body); }
          end(END[rj.code] ? rj.code : 'expired'); return null;
        }
        end(j.code === 'revoked' ? 'revoked' : 'expired'); return null;
      }
      if (res.status === 403) return null;
      return await res.json();
    } catch (e) { return null; }
  }
  window.api = function (method, path, body) {
    if (!ALLOW.some(function (re) { return re.test(method + ' ' + path); })) return Promise.resolve(null);
    return rawApi(method, path, body);
  };
  window.loadChats = async function () {
    var info = await rawApi('GET', '/guest/chat'); if (!info || !info.chat) return;
    S.allUsers = toMembers(info.members);
    var keep = S.chats[0] || {}, c = guestChat(info); c.last_message = keep.last_message || null; S.chats = [c];
    if (typeof refreshActiveChatUi === 'function') refreshActiveChatUi();
  };
  window.logout = function () { end('expired'); };
  window.refreshToken = function () { return Promise.resolve(false); };

  // Соединение: событие о закрытии доступа и продлении, свой код закрытия
  var origConnect = window.connectWS;
  window.connectWS = function () {
    origConnect();
    var ws = S.ws; if (!ws) return;
    var oc = ws.onclose;
    ws.onclose = function (e) { if (e.code === 4001 || e.code === 1008) { end('expired'); return; } if (oc) oc.call(ws, e); };
    ws.addEventListener('message', function (ev) {
      var d; try { d = JSON.parse(ev.data); } catch (x) { return; }
      if (d.type === 'guest_ended') end(d.reason === 'revoked' ? 'revoked' : 'expired');
      else if (d.type === 'guest_extended') { st.expires = d.expires_at; save(); tick(); }
    });
  };

  // Страховка от потерянных событий: соединение могло молча оборваться (телефон, прокси, спящая вкладка), поэтому
  // раз в несколько секунд и при возвращении на вкладку подтягиваем то, что пришло после последнего сообщения
  var catching = false;
  async function catchUp() {
    if (catching || st.ended || !S.token || !S.activeChatId || !S.chatNewestId || S.chatHasMoreAfter) return;
    catching = true;
    try {
      var cid = S.activeChatId, d = await rawApi('GET', '/messages/chat/' + cid + '?after=' + S.chatNewestId + '&limit=50');
      if (d && d.messages && d.messages.length && S.activeChatId === cid) {
        S.chatHasMoreAfter = !!d.hasMoreAfter;
        S.chatNewestId = d.messages[d.messages.length - 1].id;
        appendMessagesAfter(d.messages, cid);
        if (typeof isViewing === 'function' && isViewing() && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'read', chat_id: cid }));
      }
    } finally { catching = false; }
  }
  setInterval(function () { if (!document.hidden) catchUp(); }, 8000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) catchUp(); });
  window.addEventListener('focus', catchUp);

  // Что гостю недоступно: профили, сведения о группе, поиск по чату, переслать и закрепить
  var noop = function () {};
  ['openProfile', 'openGroupInfo', 'toggleChatSearch', 'showChatCtx', 'ctxForward', 'ctxTogglePin', 'ctxReadToggle', 'addContactFromChat', 'openChatMedia',
    'maybeShowNotifBanner', 'subscribePush', 'loadPushPrefs', 'loadBanners'].forEach(function (n) { if (typeof window[n] === 'function') window[n] = noop; });

  document.addEventListener('DOMContentLoaded', boot);
})();
