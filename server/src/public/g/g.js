// Страница гостя: вход по ссылке /g/<токен> в одну группу или комнату.
// Оформление и разметка сообщений те же, что в веб-клиенте (/chat/style.css); логики здесь только то, что нужно гостю:
// имя при первом входе, лента, отправка, ответ, реакции, правка и удаление своих, вложения. Профилей, списка чатов и поиска нет.
(function () {
  'use strict';
  var token = decodeURIComponent(location.pathname.split('/')[2] || '');
  var app = document.getElementById('app');
  var KEY = 'electron_guest:' + token.slice(0, 24);
  var CK = 'gdk_' + token.slice(0, 16);
  var GROUP_WINDOW = 60;

  var S = { jwt: null, dk: null, user: null, chat: null, members: [], msgs: [], expires: 0, skew: 0, ws: null, wsTry: 0, hasMore: false,
    replyTo: null, editing: null, att: null, upload: null, settings: null, editLimit: 0, typingUntil: {}, ended: false, stick: true };

  // ── Мелочи ──
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var fmtTime = function (ts) { return new Date(ts * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); };
  function fmtDate(ts) {
    var d = new Date(ts * 1000), now = new Date(), y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
  }
  var initials = function (n) { return (n || '?').split(' ').map(function (w) { return (w.match(/[\p{L}\p{N}]/u) || [''])[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'; };
  function tagClass(tag) {
    var t = (tag || '').trim().toLowerCase(); if (!t) return 'default';
    var h = 2166136261; for (var ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return 'tag-' + (h % 14 + 1);
  }
  var avColor = function (id, tag) { var c = tagClass(tag); return c === 'default' ? ['av-blue', 'av-green', 'av-purple', 'av-orange'][id % 4] : 'av-' + c; };
  function mdLite(s) { return s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<i>$1</i>'); }
  function linkify(text) {
    return String(text || '').split(/(https?:\/\/[^\s]+)/g).map(function (p, i) {
      return i % 2 ? '<a class="msg-link" href="' + esc(p) + '" target="_blank" rel="noopener noreferrer">' + esc(p) + '</a>' : mdLite(esc(p));
    }).join('');
  }
  var ICO = {
    clip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    send: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    lock: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>'
  };

  // ── Оформление: тема по системе, размер шрифта средний ──
  var root = document.documentElement;
  if (matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
  root.classList.add('font-medium');
  root.style.setProperty('--vh100', '100dvh'); root.style.setProperty('--vw100', '100vw');

  // ── Хранение: ключ устройства живёт в браузере (localStorage и cookie на случай очистки одного из них) ──
  function loadSaved() {
    var v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!v || !v.dk) { var m = document.cookie.match(new RegExp('(?:^|; )' + CK + '=([^;]+)')); if (m) v = { dk: m[1] }; }
    return v || {};
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ dk: S.dk, jwt: S.jwt })); } catch (e) {}
    var age = Math.max(60, S.expires - Math.floor(Date.now() / 1000));
    document.cookie = CK + '=' + S.dk + '; path=/g; max-age=' + age + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    document.cookie = CK + '=; path=/g; max-age=0';
  }

  async function api(method, path, body) {
    var res = await fetch(path, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, S.jwt ? { Authorization: 'Bearer ' + S.jwt } : {}), body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await res.json(); } catch (e) {}
    if (res.status === 401 && j && j.code === 'expired' && S.dk && !S.reopening) {
      S.reopening = true;
      var rr = await fetch('/api/guest/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, device_key: S.dk }) });
      var rj = null; try { rj = await rr.json(); } catch (e) {}
      S.reopening = false;
      if (rr.ok && rj && rj.token) { S.jwt = rj.token; save(); return api(method, path, body); }
      end(rj && END[rj.code] ? rj.code : 'expired');
    }
    if (res.status === 401 && j && j.code === 'guest_expired') { end('expired'); }
    return { status: res.status, data: j || {} };
  }

  // ── Экраны ──
  function screen(html) { app.innerHTML = '<div class="g-screen">' + html + '</div>'; }
  function logo() { return '<div class="login-icon"><div class="login-logo"><img src="/chat/icons/icon-192.png" width="64" height="64" alt=""></div></div><h1 class="login-wordmark"><span>ELECTRON</span><span>MESSENGER</span></h1>'; }
  var END = {
    expired: ['Доступ закончился', 'Срок действия ссылки истёк. Нужен новый доступ — попросите прислать ссылку заново.'],
    revoked: ['Ссылка отозвана', 'Организатор закрыл эту ссылку. Если доступ нужен, попросите новую.'],
    other_device: ['Ссылка уже открыта на другом устройстве', 'Её можно использовать только с устройства, где она была открыта первой. Попросите прислать новую ссылку.'],
    not_found: ['Ссылка не найдена', 'Проверьте адрес или попросите прислать ссылку заново.'],
    busy: ['Слишком много попыток', 'Подождите несколько минут и откройте ссылку снова.']
  };
  function end(kind) {
    if (S.ended) return; S.ended = true;
    if (S.ws) { try { S.ws.onclose = null; S.ws.close(); } catch (e) {} }
    if (kind === 'expired' || kind === 'revoked' || kind === 'not_found') forget();
    var t = END[kind] || END.expired;
    screen('<div class="login-wrap">' + logo() + '<div class="g-end-icon">' + ICO.lock + '</div><div class="login-sub" style="font-weight:700;color:var(--text)">' + esc(t[0]) + '</div><p class="g-note">' + esc(t[1]) + '</p></div>');
  }
  function nameForm(chatName, err) {
    screen('<div class="login-wrap">' + logo() + '<p class="login-sub">Вас пригласили в чат «' + esc(chatName) + '»</p>' +
      '<form id="g-name-form"><div class="field"><label>Ваше имя</label><input id="g-name" placeholder="Иванов Иван" maxlength="60" autocomplete="name" autofocus></div>' +
      '<div class="g-warn"><b>Ссылка одноразовая</b>После входа она будет работать только на этом устройстве, с другого открыть её уже не получится. Входом считается нажатие «Войти в чат» после ввода имени: до этого ссылку можно открыть и на другом устройстве.</div>' +
      '<p class="g-note">Имя увидят участники чата. Сообщения, написанные до вашего входа, вам не показываются.</p>' +
      '<button class="btn-login" id="g-go" type="submit" style="width:100%">Войти в чат</button><div class="g-err" id="g-err">' + esc(err || '') + '</div></form></div>');
    var f = $('g-name-form'); $('g-name').focus();
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); var name = $('g-name').value.trim();
      if (name.length < 2) { $('g-err').textContent = 'Введите имя (от 2 до 60 символов)'; return; }
      $('g-go').disabled = true;
      var r = await open(name, null);
      if (!r.ok) { $('g-go').disabled = false; $('g-err').textContent = r.error || 'Не удалось войти'; }
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
    screen('<div class="login-wrap">' + logo() + '<p class="g-note">Подключаюсь…</p></div>');
    var saved = loadSaved();
    if (saved.dk) { var r = await open(null, saved.dk); if (r.ok || S.ended) return; }
    var p = await fetch('/api/guest/link/' + encodeURIComponent(token)); var j = {}; try { j = await p.json(); } catch (e) {}
    if (p.status === 429) return end('busy');
    if (!p.ok) return end(END[j.code] ? j.code : 'not_found');
    if (j.claimed) return end('other_device');
    nameForm(j.chat_name);
  }

  async function enter(d) {
    S.jwt = d.token; S.dk = d.device_key; S.user = d.user; S.expires = d.expires_at; S.chat = d.chat; save();
    var info = await api('GET', '/api/guest/chat'); if (S.ended) return;
    if (info.status === 200) { S.chat = info.data.chat; S.members = info.data.members; }
    var st = await api('GET', '/api/upload/settings'); if (st.status === 200) S.settings = st.data;
    var h = await api('GET', '/api/messages/chat/' + S.chat.id + '?limit=100'); if (S.ended) return;
    S.msgs = (h.data.messages || []); S.hasMore = !!h.data.hasMore;
    drawMain(); syncExpiry(); renderAll(true); connect(); tick(); setInterval(tick, 5000); setInterval(syncExpiry, 60000);
  }

  // ── Каркас чата ──
  function drawMain() {
    var c = S.chat;
    app.innerHTML = '<div id="g-main">' +
      '<div class="g-head"><div class="av av-round ' + avColor(c.id, '') + '">' + esc(initials(c.name)) + '</div><div style="min-width:0;flex:1"><div class="g-title">' + esc(c.name || 'Чат') + '</div><div class="g-sub" id="g-sub"></div></div><div class="g-left" id="g-left" title="Сколько ещё действует ссылка"><span>Осталось</span><b id="g-left-t">--:--</b></div></div>' +
      '<div class="g-msgs" id="messages"></div>' +
      '<div class="g-bar" id="g-reply" hidden></div><div class="g-bar" id="g-att" hidden></div>' +
      '<form class="g-comp" id="g-form"><button type="button" class="g-ib" id="g-attach" title="Прикрепить файл">' + ICO.clip + '</button><input type="file" id="g-file" hidden>' +
      '<div class="g-field"><textarea id="g-input" rows="1" placeholder="Написать сообщение…"></textarea></div>' +
      '<button type="submit" class="g-ib send" id="g-send" title="Отправить">' + ICO.send + '</button></form></div>';
    var box = $('messages');
    box.addEventListener('scroll', function () {
      S.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      if (S.hasMore && box.scrollTop < 60) loadMore();
    });
    box.addEventListener('click', onMsgClick);
    box.addEventListener('contextmenu', function (e) { var el = e.target.closest('.irc-msg[data-msg-id]'); if (el) { e.preventDefault(); openMenu(el, e.clientX, e.clientY); } });
    var inp = $('g-input');
    inp.addEventListener('input', function () { inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; typing(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') cancelCompose(); });
    $('g-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    $('g-attach').addEventListener('click', function () { $('g-file').click(); });
    $('g-file').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) upload(f); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.g-menu')) closeMenu(); }, true);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') markRead(); });
    window.addEventListener('focus', markRead);
  }
  function tick() {
    var left = S.expires - Math.floor((Date.now() + S.skew) / 1000);
    if (left <= 0) return end('expired');
    var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), hm = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var t = $('g-left-t'), box = $('g-left'), el = $('g-sub');
    if (t) t.textContent = hm;
    if (box) box.classList.toggle('low', left < 900);   // меньше 15 минут: плашка краснеет
    var typers = Object.keys(S.typingUntil).filter(function (k) { return S.typingUntil[k] > Date.now(); });
    if (el) el.textContent = typers.length ? typers.join(', ') + ' печатает…' : 'Вы гость · доступ до ' + fmtTime(S.expires);
  }

  async function syncExpiry() {   // запасной путь, если событие о продлении не дошло
    var r = await api('GET', '/api/guest/me');
    if (r.status === 200 && r.data.expires_at) { S.expires = r.data.expires_at; S.skew = r.data.now ? r.data.now * 1000 - Date.now() : 0; tick(); }
  }

  // ── Лента ──
  function byId(id) { return S.msgs.find(function (m) { return m.id === id; }); }
  function renderAll(toBottom) {
    var box = $('messages'); if (!box) return;
    var prevH = box.scrollHeight, prevTop = box.scrollTop, stick = S.stick || toBottom;
    var html = '', last = '', day = false, prev = null;
    S.msgs.forEach(function (m, i) {
      var d = fmtDate(m.sent_at);
      if (d !== last) { if (day) html += '</div>'; html += '<div class="day-group"><div class="date-divider"><span>' + esc(d) + '</span></div>'; last = d; day = true; prev = null; }
      var next = S.msgs[i + 1];
      var same = function (o) { return o && o.sender_id === m.sender_id && Math.abs(o.sent_at - m.sent_at) < GROUP_WINDOW && fmtDate(o.sent_at) === d && o.sender_username !== '__system__'; };
      html += msgHtml(m, !same(prev), !same(next));
      prev = m;
    });
    if (day) html += '</div>';
    box.innerHTML = (S.hasMore ? '<div class="g-load">Загрузка…</div>' : '') + html;
    if (stick) box.scrollTop = box.scrollHeight; else box.scrollTop = prevTop + (box.scrollHeight - prevH);
  }
  function msgHtml(m, first, tail) {
    var mine = m.sender_id === S.user.id, time = fmtTime(m.sent_at);
    if (m.sender_username === '__system__' && !m.deleted) {
      return '<div class="irc-msg" data-msg-id="' + m.id + '" data-sender-id="' + m.sender_id + '" data-sent-at="' + m.sent_at + '" style="padding:2px 0"><div style="width:100%;display:flex;justify-content:center;padding:0 20px;box-sizing:border-box"><div style="background:var(--card-bg);border:1px solid var(--border);border-radius:14px;padding:5px 14px;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:6px;max-width:80%"><span style="word-break:break-word">' + esc(m.text) + '</span><span style="font-size:10px;opacity:.4;flex-shrink:0;margin-left:2px">' + time + '</span></div></div></div>';
    }
    var del = !!m.deleted, att = m.attachment, rc = tagClass(m.sender_tag);
    var body = del ? '<em class="irc-deleted">Сообщение удалено</em>' : linkify(m.text) + (m.edited_at ? ' <span class="edited-tag">изм.</span>' : '');
    var reply = '';
    if (m.reply_to_id && !del) {
      var rname = m.reply_hidden ? '' : esc(m.reply_sender_name || ''), rtext = m.reply_hidden ? 'Сообщение до вашего входа' : (m.reply_deleted ? 'Сообщение удалено' : (m.reply_text ? mdLite(esc(m.reply_text)) : (m.reply_attachment ? '📎 Вложение' : '')));
      reply = '<div class="irc-reply ' + (m.reply_sender_id === S.user.id ? 'reply-mine' : 'reply-' + (tagClass(m.reply_sender_tag) === 'default' ? 'plain' : tagClass(m.reply_sender_tag))) + '"' + (m.reply_hidden ? '' : ' data-jump="' + m.reply_to_id + '"') + '><div class="irc-reply-body"><div class="irc-reply-name">' + rname + '</div><div class="irc-reply-text">' + rtext + '</div></div></div>';
    }
    var attHtml = '';
    if (att && att.url && !del) {
      if (att.expired) attHtml = '<div class="irc-text irc-deleted"><em>Файл удалён</em></div>';
      else if (att.gif !== undefined) attHtml = '<div class="irc-text"><em>GIF</em></div>';
      else if ((att.mime || '').indexOf('image/') === 0) attHtml = '<div class="bubble-image"><a href="' + esc(att.url) + '" target="_blank" rel="noopener"><img src="' + esc(att.thumb || att.url) + '" loading="lazy"></a></div>';
      else if ((att.mime || '').indexOf('video/') === 0) attHtml = '<div class="bubble-image bubble-video"><video src="' + esc(att.url) + '" controls preload="metadata"' + (att.thumb ? ' poster="' + esc(att.thumb) + '"' : '') + '></video></div>';
      else { var sz = att.size ? (att.size > 1048576 ? (att.size / 1048576).toFixed(1) + ' МБ' : Math.round(att.size / 1024) + ' КБ') : ''; attHtml = '<a class="bubble-file" href="' + esc(att.url) + '" download="' + esc(att.name || 'file') + '" style="text-decoration:none;color:inherit">' + ICO.file + '<div class="bubble-file-info"><div class="bubble-file-name">' + esc(att.name || 'Файл') + '</div>' + (sz ? '<div class="bubble-file-size">' + sz + '</div>' : '') + '</div></a>'; }
    }
    var reacts = '';
    if (!del && (m.reactions || []).length) reacts = '<div class="reactions">' + m.reactions.map(function (r) {
      var meMine = String(r.user_ids || '').split(',').indexOf(String(S.user.id)) >= 0;
      return '<button class="reaction-btn' + (meMine ? ' mine' : '') + '" data-react="' + esc(r.reaction) + '" data-mid="' + m.id + '"><span class="ra-emoji">' + esc(r.reaction) + '</span><span class="ra-count">' + r.count + '</span></button>';
    }).join('') + '</div>';
    var tagPill = m.sender_tag ? '<span class="role-pill ' + tagClass(m.sender_tag) + '">' + esc(m.sender_tag) + '</span>' : '';
    var cls = 'irc-msg' + (first ? ' irc-first' : '') + (tail ? ' irc-tail' : '') + (m._optimistic ? ' msg-optimistic' : '');
    return '<div class="' + cls + '"' + (mine ? ' data-mine="1"' : '') + ' data-msg-id="' + m.id + '" data-sender-id="' + m.sender_id + '" data-sent-at="' + m.sent_at + '"><div class="irc-content">' +
      '<div class="irc-header"><span class="irc-name msg-sender-name ' + rc + (mine ? ' mine' : '') + '">' + esc(m.sender_name) + '</span>' + tagPill + '</div>' +
      '<div class="bubble-row"><div class="irc-av av av-round ' + avColor(m.sender_id, m.sender_tag) + '" style="position:relative;flex-shrink:0">' + esc(initials(m.sender_name)) +
      '<img src="/api/users/' + m.sender_id + '/avatar" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display=\'none\'"></div>' +
      '<div class="msg-bubble">' + reply + attHtml + (m.text || del ? '<div class="irc-text' + (del ? ' irc-deleted' : '') + '">' + body + '</div>' : '') +
      '<div class="irc-meta"><span class="status-wrap"></span><span class="irc-time">' + time + '</span></div></div></div>' + reacts + '</div></div>';
  }
  async function loadMore() {
    if (!S.hasMore || S.loadingMore) return; S.loadingMore = true;
    var first = S.msgs.find(function (m) { return m.id > 0; });
    var r = await api('GET', '/api/messages/chat/' + S.chat.id + '?limit=100&before=' + (first ? first.id : 0));
    S.loadingMore = false;
    if (r.status !== 200) return;
    var older = r.data.messages || []; S.hasMore = !!r.data.hasMore;
    S.msgs = older.concat(S.msgs); S.stick = false; renderAll(false);
  }

  // ── Действия с сообщениями ──
  function onMsgClick(e) {
    var rb = e.target.closest('.reaction-btn'); if (rb) { react(Number(rb.dataset.mid), rb.dataset.react); return; }
    var jump = e.target.closest('[data-jump]'); if (jump) { var t = document.querySelector('.irc-msg[data-msg-id="' + jump.dataset.jump + '"]'); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (e.target.closest('a, video, button')) return;
    var el = e.target.closest('.irc-msg[data-msg-id]'); if (!el || !e.target.closest('.msg-bubble')) return;
    if (window.getSelection && String(window.getSelection())) return;
    openMenu(el, e.clientX, e.clientY);
  }
  function closeMenu() { var m = document.querySelector('.g-menu'); if (m) m.remove(); }
  function openMenu(el, x, y) {
    closeMenu();
    var id = Number(el.dataset.msgId), m = byId(id); if (!m || m.deleted || id <= 0 || m.sender_username === '__system__') return;
    var mine = m.sender_id === S.user.id, canEdit = mine && m.text && (!S.editLimit || Date.now() / 1000 - m.sent_at < S.editLimit);
    var menu = document.createElement('div'); menu.className = 'g-menu';
    menu.innerHTML = '<div class="g-react">' + ['👍', '❤️', '😂', '🔥', '👏', '🙏'].map(function (r) { return '<button data-r="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<button class="g-item" data-a="reply">Ответить</button>' + (canEdit ? '<button class="g-item" data-a="edit">Изменить</button>' : '') + (mine ? '<button class="g-item danger" data-a="del">Удалить</button>' : '');
    document.body.appendChild(menu);
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; closeMenu();
      if (b.dataset.r) react(id, b.dataset.r);
      else if (b.dataset.a === 'reply') { S.editing = null; S.replyTo = m; drawBars(); $('g-input').focus(); }
      else if (b.dataset.a === 'edit') { S.replyTo = null; S.editing = m; $('g-input').value = m.text; $('g-input').dispatchEvent(new Event('input')); drawBars(); $('g-input').focus(); }
      else if (b.dataset.a === 'del') wsSend({ type: 'delete_message', message_id: id });
    });
  }
  function react(id, r) { wsSend({ type: 'react', message_id: id, reaction: r }); }

  // ── Поле ввода ──
  function drawBars() {
    var rb = $('g-reply'), ab = $('g-att');
    var ctx = S.editing ? { n: 'Изменение сообщения', t: S.editing.text } : S.replyTo ? { n: S.replyTo.sender_name, t: S.replyTo.text || (S.replyTo.attachment ? '📎 Вложение' : '') } : null;
    rb.hidden = !ctx;
    if (ctx) { rb.innerHTML = '<div class="g-bar-body"><div class="g-bar-name">' + esc(ctx.n) + '</div><div class="g-bar-text">' + esc(ctx.t) + '</div></div><button type="button" id="g-reply-x">' + ICO.x + '</button>'; $('g-reply-x').onclick = cancelCompose; }
    ab.hidden = !S.upload && !S.att;
    if (S.upload) ab.innerHTML = '<div class="g-bar-body"><div class="g-bar-text">' + esc(S.upload.name) + '</div><div class="g-prog"><i style="width:' + S.upload.pct + '%"></i></div></div><button type="button" id="g-att-x">' + ICO.x + '</button>';
    else if (S.att) ab.innerHTML = '<div class="g-bar-body"><div class="g-bar-name">Вложение</div><div class="g-bar-text">' + esc(S.att.name || 'файл') + '</div></div><button type="button" id="g-att-x">' + ICO.x + '</button>';
    var x = $('g-att-x'); if (x) x.onclick = function () { if (S.upload && S.upload.xhr) S.upload.xhr.abort(); S.upload = null; S.att = null; drawBars(); };
  }
  function cancelCompose() { S.replyTo = null; if (S.editing) { S.editing = null; $('g-input').value = ''; $('g-input').style.height = 'auto'; } drawBars(); }
  function toast(t) { var d = document.createElement('div'); d.className = 'g-toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 3500); }
  var lastTyping = 0;
  function typing() { if (Date.now() - lastTyping > 3000) { lastTyping = Date.now(); wsSend({ type: 'typing', chat_id: S.chat.id }); } }

  function submit() {
    var inp = $('g-input'), text = inp.value.trim();
    if (S.upload) { toast('Дождитесь загрузки файла'); return; }
    if (S.editing) {
      if (text && text !== S.editing.text) wsSend({ type: 'edit_message', message_id: S.editing.id, text: text });
      cancelCompose(); inp.value = ''; inp.style.height = 'auto'; return;
    }
    if (!text && !S.att) return;
    if (!S.ws || S.ws.readyState !== 1) { toast('Нет соединения, сообщение не отправлено'); return; }
    var cid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    wsSend({ type: 'message', chat_id: S.chat.id, text: text, reply_to_id: S.replyTo ? S.replyTo.id : undefined, attachment: S.att || undefined, client_id: cid });
    inp.value = ''; inp.style.height = 'auto'; S.replyTo = null; S.att = null; S.stick = true; drawBars();
  }

  // ── Вложения: ограничения берутся из настроек сервера ──
  function upload(file) {
    var cfg = S.settings || {}, isImg = file.type.indexOf('image/') === 0, isVid = file.type.indexOf('video/') === 0, c = (isImg ? cfg.image : isVid ? cfg.video : cfg.file) || { maxSizeMb: 20, extensions: [] };
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!isVid && file.size > c.maxSizeMb * 1048576) return toast('Файл слишком большой (макс. ' + c.maxSizeMb + ' МБ)');
    if (c.extensions && c.extensions.length && c.extensions.indexOf(ext) < 0) return toast('Расширение .' + ext + ' не разрешено');
    var fd = new FormData(); fd.append('file', file);
    var xhr = new XMLHttpRequest(); S.upload = { name: file.name, pct: 0, xhr: xhr }; S.att = null; drawBars();
    xhr.open('POST', '/api/upload'); xhr.setRequestHeader('Authorization', 'Bearer ' + S.jwt);
    xhr.upload.onprogress = function (e) { if (e.lengthComputable && S.upload) { S.upload.pct = Math.round(e.loaded / e.total * 100); var i = document.querySelector('#g-att .g-prog i'); if (i) i.style.width = S.upload.pct + '%'; } };
    xhr.onload = function () {
      S.upload = null;
      if (xhr.status < 200 || xhr.status >= 300) { var er = {}; try { er = JSON.parse(xhr.responseText); } catch (e) {} toast(er.error || 'Ошибка загрузки'); drawBars(); return; }
      try { S.att = JSON.parse(xhr.responseText); } catch (e) { toast('Ошибка загрузки'); }
      drawBars();
    };
    xhr.onerror = function () { S.upload = null; toast('Ошибка загрузки'); drawBars(); };
    xhr.onabort = function () { S.upload = null; drawBars(); };
    xhr.send(fd);
  }

  // ── Соединение ──
  function wsSend(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
  function connect() {
    if (S.ended) return;
    var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + encodeURIComponent(S.jwt));
    S.ws = ws;
    ws.onopen = function () { S.wsTry = 0; markRead(); };
    ws.onmessage = function (e) { var d; try { d = JSON.parse(e.data); } catch (x) { return; } onEvent(d); };
    ws.onclose = function (e) {
      if (S.ended) return;
      if (e.code === 4001 || e.code === 1008) { end('expired'); return; }
      setTimeout(function () { if (!S.ended) { S.wsTry++; resync().then(connect); } }, Math.min(10000, 1000 * Math.pow(2, S.wsTry)));
    };
  }
  async function resync() { // после обрыва связи подтягиваем то, что пришло, пока нас не было
    var r = await api('GET', '/api/messages/chat/' + S.chat.id + '?limit=100'); if (r.status !== 200 || S.ended) return;
    S.msgs = r.data.messages || []; S.hasMore = !!r.data.hasMore; renderAll(false);
  }
  function markRead() { if (document.visibilityState === 'visible') wsSend({ type: 'read', chat_id: S.chat.id }); }
  function upsert(m) {
    var i = S.msgs.findIndex(function (x) { return x.id === m.id || (m.client_id && x.client_id === m.client_id); });
    if (i >= 0) S.msgs[i] = m; else S.msgs.push(m);
    S.msgs.sort(function (a, b) { return a.id - b.id; });
  }
  function onEvent(d) {
    if (d.type === 'connected') { S.editLimit = d.edit_time_limit || 0; }
    else if (d.type === 'message' && d.message.chat_id === S.chat.id) { upsert(d.message); renderAll(false); if (d.message.sender_id !== S.user.id) { wsSend({ type: 'delivered', message_id: d.message.id }); markRead(); } }
    else if (d.type === 'message_edited' && d.message) { upsert(d.message); renderAll(false); }
    else if (d.type === 'message_deleted') { var m = byId(d.message_id); if (m) { m.deleted = 1; m.text = ''; m.attachment = null; renderAll(false); } }
    else if (d.type === 'reaction_update') { var r = byId(d.message_id); if (r) { r.reactions = d.counts || []; renderAll(false); } }
    else if (d.type === 'typing' && d.chat_id === S.chat.id && d.user_id !== S.user.id) { S.typingUntil[d.sender_name || 'Кто-то'] = Date.now() + 4000; tick(); setTimeout(tick, 4200); }
    else if (d.type === 'send_rejected') toast(d.reason === 'read_only' ? 'В этом чате писать нельзя' : 'Сообщение не отправлено');
    else if (d.type === 'edit_rejected') toast('Время на правку вышло');
    else if (d.type === 'guest_ended') end(d.reason === 'revoked' ? 'revoked' : 'expired');
    else if (d.type === 'guest_extended') { S.expires = d.expires_at; save(); tick(); }
  }

  if (!token) end('not_found'); else boot();
})();
