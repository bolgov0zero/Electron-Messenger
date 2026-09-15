// ══════════════════════════════════════════
// /m — мобильный клиент, редизайн в стиле Telegram. Этап 1: тот же логин/сессия,
// что и в /chat (общий localStorage 'electron_v2'), живой список чатов, один
// открытый чат с отправкой/приёмом через тот же WS-протокол, и шторка «Прочитано».
// Это не рефакторинг /chat/app.js, а отдельный, более простой фронт поверх того
// же REST/WS API — контакты, настройки, вложения, реакции и пр. — следующими этапами.
// ══════════════════════════════════════════

const SESSION_KEY = 'electron_v2'; // тот же ключ, что у /chat — сессия общая

const S = {
  server: '', token: null, user: null,
  chats: [], activeChatId: null, ws: null,
  presence: {}, lastSeen: {}, msgStatus: {}, statusApplied: {},
  avatarTs: 0, currentTab: 'chats',
};

// ── МЕЛКИЕ ХЕЛПЕРЫ (те же, что в /chat/app.js) ──
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = n => (n || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatarColor = id => ['av-default', 'av-2', 'av-6', 'av-3'][id % 4];
const TAG_COLORS = 14;
function senderNameClass(tag) {
  const t = (tag || '').trim().toLowerCase();
  if (!t) return 'default';
  let h = 2166136261;
  for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'tag-' + (h % TAG_COLORS + 1);
}
function userAvatarColor(id, tag) {
  const cls = senderNameClass(tag);
  return cls === 'default' ? avatarColor(id) : 'av-' + cls.replace('tag-', '');
}
function fmtTime(ts) { return new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function fmtDateTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function fmtChatListTime(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(ts);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'вчера';
  const diffDays = (now - d) / 86400000;
  if (diffDays < 6) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── PROTOCOL / API (то же, что в /chat/app.js) ──
function httpProto() { return /:\d+$/.test(S.server) ? 'http' : 'https'; }
function wsProto() { return /:\d+$/.test(S.server) ? 'ws' : 'wss'; }

async function api(method, path, body) {
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      const info = await res.json().catch(() => ({}));
      if (['revoked', 'banned', 'user_not_found'].includes(info.code)) { logout(); return null; }
      if (info.code === 'expired' && path !== '/auth/refresh') {
        const ok = await refreshToken();
        if (ok) return api(method, path, body);
        logout();
      }
      return null;
    }
    return res.json();
  } catch { return null; }
}

let _refreshTimer = null;
async function refreshToken() {
  if (!S.token || !S.server) return false;
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/refresh`, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.token) return false;
    S.token = data.token;
    saveSession();
    return true;
  } catch { return false; }
}
function startTokenRefresh() { clearInterval(_refreshTimer); _refreshTimer = setInterval(refreshToken, 24 * 60 * 60 * 1000); }

// ── SESSION (общая с /chat — тот же ключ и та же форма объекта) ──
function saveSession() {
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch {}
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, server: S.server, token: S.token, user: S.user }));
}
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }

// ── АВАТАРКИ (то же, что в /chat/app.js) ──
const _avatarCache = new Map();
function tryLoadAvatar(el, url, fallbackText) {
  const cached = _avatarCache.get(url);
  if (cached === true) { el.style.backgroundImage = `url('${url}')`; el.textContent = ''; return; }
  if (cached === false) { el.style.backgroundImage = ''; el.textContent = fallbackText; return; }
  const img = new Image();
  img.onload = () => { _avatarCache.set(url, true); el.style.backgroundImage = `url('${url}')`; el.textContent = ''; };
  img.onerror = () => { _avatarCache.set(url, false); el.style.backgroundImage = ''; el.textContent = fallbackText; };
  img.src = url;
}
function applyAvatars() {
  document.querySelectorAll('[data-av-chat]').forEach(el => {
    const chatId = parseInt(el.dataset.avChat);
    const chat = S.chats.find(c => c.id === chatId);
    if (!chat) return;
    if (chat.type === 'direct') {
      const peerId = getPeerUserId(chat);
      if (!peerId) return;
      tryLoadAvatar(el, `${httpProto()}://${S.server}/api/users/${peerId}/avatar?t=${S.avatarTs}`, initials(chatName(chat)));
    } else {
      tryLoadAvatar(el, `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${S.avatarTs}`, chatIcon(chat));
    }
  });
  document.querySelectorAll('[data-av-user]').forEach(el => {
    const uid = parseInt(el.dataset.avUser);
    tryLoadAvatar(el, `${httpProto()}://${S.server}/api/users/${uid}/avatar?t=${S.avatarTs}`, el.dataset.avFallback || '?');
  });
}

// ── ЧАТЫ: имя/иконка/цвет ──
function chatName(chat) {
  if (!chat) return '';
  if (chat.type === 'group') return chat.name || 'Группа';
  if (chat.type === 'room') return chat.name || 'Комната';
  const other = chat.members?.find(m => m.id !== S.user.id);
  return other?.display_name || 'Чат';
}
function getPeerUserId(chat) {
  if (chat.type !== 'direct') return null;
  return chat.members?.find(m => m.id !== S.user.id)?.id || null;
}
function chatAvatarColorClass(chat) {
  if (chat.type === 'room') return 'av-3';
  if (chat.type === 'group') return 'av-2';
  const peer = chat.members?.find(m => m.id !== S.user.id);
  return peer ? userAvatarColor(peer.id, peer.tag) : avatarColor(chat.id);
}
function chatIcon(chat) { return chat.type === 'room' ? '#' : initials(chatName(chat)); }

// ── ВХОД ──
async function doLogin() {
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const err = document.getElementById('l-err');
  const btn = document.getElementById('l-btn');
  if (!username || !password) { err.textContent = 'Заполните все поля'; return; }
  btn.disabled = true; btn.textContent = 'Подключение…'; err.textContent = '';
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.token) {
      Object.assign(S, { token: data.token, user: data.user });
      saveSession();
      enterApp();
    } else { err.textContent = data.error || 'Неверный логин или пароль'; }
  } catch { err.textContent = 'Не удалось подключиться к серверу'; }
  finally { btn.disabled = false; btn.textContent = 'Войти'; }
}

function logout() {
  clearInterval(_refreshTimer);
  if (S.ws) S.ws.close();
  Object.assign(S, { token: null, user: null, chats: [], activeChatId: null, ws: null });
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  closeChat(); closeSheet();
}

async function enterApp() {
  startTokenRefresh();
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  document.getElementById('me-name').textContent = S.user.display_name;
  document.getElementById('me-username').textContent = '@' + S.user.username;
  const meAv = document.getElementById('me-av');
  meAv.className = 'av ' + userAvatarColor(S.user.id, S.user.tag);
  meAv.dataset.avUser = S.user.id;
  meAv.dataset.avFallback = initials(S.user.display_name);
  meAv.textContent = initials(S.user.display_name);
  api('GET', '/users/presence').then(pres => {
    if (!pres) return;
    Object.entries(pres).forEach(([id, v]) => { S.presence[id] = v?.status; if (v?.last_seen) S.lastSeen[id] = v.last_seen; });
  });
  await loadChats();
  connectWS();
  applyAvatars();
}

// ── СПИСОК ЧАТОВ ──
async function loadChats() {
  const chats = await api('GET', '/chats');
  if (!chats) return;
  S.chats = chats;
  renderChats();
}

function chatPreview(c) {
  const lm = c.last_message;
  if (!lm) return 'Нет сообщений';
  if (lm.deleted) return 'Сообщение удалено';
  if (lm.text) return lm.text.replace(/<[^>]*>/g, '');
  if (lm.attachment) return lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл');
  return '';
}

function renderChats() {
  const q = (document.getElementById('chat-search').value || '').trim().toLowerCase();
  const list = document.getElementById('chat-list');
  const filtered = S.chats
    .filter(c => chatName(c).toLowerCase().includes(q))
    .sort((a, b) => (b.last_message?.sent_at || 0) - (a.last_message?.sent_at || 0));
  if (!filtered.length) {
    list.innerHTML = '<div class="stub-note">' + (S.chats.length ? 'Ничего не нашли' : 'Чатов пока нет') + '</div>';
    return;
  }
  list.innerHTML = filtered.map(c => {
    const lm = c.last_message;
    const unread = c.unread || 0;
    const mentions = c.unread_mentions || 0;
    const mine = lm && !lm.deleted && lm.sender_id === S.user.id;
    const who = mine ? 'Вы: ' : '';
    let preview = chatPreview(c);
    if (preview.length > 40) preview = preview.slice(0, 40) + '…';
    const time = lm ? fmtChatListTime(lm.sent_at) : '';
    const sq = (c.type === 'group' || c.type === 'room') ? ' sq' : '';
    return `<div class="row" onclick="openChat(${c.id})">
      <div class="av${sq} ${chatAvatarColorClass(c)}" data-av-chat="${c.id}">${esc(chatIcon(c))}</div>
      <div class="row-body">
        <div class="row-top"><div class="row-name">${esc(chatName(c))}</div><div class="row-time${unread ? ' unread' : ''}">${time}</div></div>
        <div class="row-bottom">
          <div class="row-msg">${esc(who)}${esc(preview)}</div>
          ${mentions ? `<div class="badge at">@</div>` : unread ? `<div class="badge">${unread > 99 ? '99+' : unread}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  applyAvatars();
}

// ── НАВИГАЦИЯ ПО ВКЛАДКАМ ──
function setTab(name) {
  S.currentTab = name;
  ['chats', 'contacts', 'settings'].forEach(t => {
    document.getElementById('tab-' + t).hidden = t !== name;
    document.querySelector(`.tab[data-tab="${t}"]`).classList.toggle('on', t === name);
  });
}

// ── ПЕРЕПИСКА ──
let _msgCache = []; // сообщения открытого чата, в порядке отображения

function bubbleHtml(m) {
  const mine = m.sender_id === S.user.id;
  if (m.deleted) return `<div class="bubble ${mine ? 'out' : 'in'}" data-msg-id="${m.id}"><span class="bubble-deleted">Сообщение удалено</span></div>`;
  const text = m.text ? esc(m.text) : (m.attachment ? '📎 ' + esc(m.attachment.name || 'Вложение') : '');
  const tappable = mine ? ' tappable' : '';
  const onclick = mine ? ` onclick="openReadSheet(${m.id})"` : '';
  return `<div class="bubble ${mine ? 'out' + tappable : 'in'}" data-msg-id="${m.id}"${onclick}>
    ${text}
    <div class="bubble-meta">${fmtTime(m.sent_at)}${mine ? renderTicks(m.status) : ''}</div>
  </div>`;
}
function renderTicks(status) {
  if (!status) return '';
  const { delivered, read, total } = status;
  if (total === 0) return '';
  const double = delivered > 0 || read > 0;
  const color = read >= total ? 'var(--accent)' : 'var(--muted)';
  return `<svg width="13" height="9" viewBox="0 0 18 9" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${double ? '<polyline points="1,5.5 3.5,8 9,1"/><polyline points="7,5.5 9.5,8 15,1"/>' : '<polyline points="7,5.5 9.5,8 15,1"/>'}
  </svg>`;
}

function renderMessages() {
  const container = document.getElementById('messages');
  let html = '', lastDay = '';
  for (const m of _msgCache) {
    const day = new Date(m.sent_at * 1000).toDateString();
    if (day !== lastDay) { html += `<div class="day-sep">${new Date(m.sent_at * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>`; lastDay = day; }
    html += bubbleHtml(m);
  }
  container.innerHTML = html || '<div class="stub-note">Сообщений пока нет</div>';
  container.scrollTop = container.scrollHeight;
}

async function openChat(chatId) {
  S.activeChatId = chatId;
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat) return;
  document.getElementById('chat-name').textContent = chatName(chat);
  const av = document.getElementById('chat-av');
  av.className = 'av ' + chatAvatarColorClass(chat) + ((chat.type === 'group' || chat.type === 'room') ? ' sq' : '');
  av.dataset.avChat = chatId;
  av.textContent = chatIcon(chat);
  const peerId = getPeerUserId(chat);
  document.getElementById('chat-sub').textContent = chat.type === 'room' ? 'Комната' : chat.type === 'group'
    ? `${chat.members?.length || 0} участников`
    : (peerId ? peerStatusText(peerId) : 'Личный чат');
  document.getElementById('chat-screen').classList.add('open');
  document.getElementById('messages').innerHTML = '<div class="stub-note">Загрузка…</div>';

  const data = await api('GET', `/messages/chat/${chatId}?limit=50`);
  if (!data || S.activeChatId !== chatId) return;
  _msgCache = data.messages;
  renderMessages();
  applyAvatars();
  chat.unread = 0; chat.unread_mentions = 0;
  renderChats();
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId }));
}

function closeChat() {
  S.activeChatId = null;
  document.getElementById('chat-screen').classList.remove('open');
  _msgCache = [];
}

function peerStatusText(userId) {
  const st = S.presence[userId] || 'offline';
  if (st === 'online') return 'в сети';
  const ts = S.lastSeen[userId];
  if (!ts) return 'не в сети';
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'был(а) в ' + fmtTime(ts);
  return 'был(а) недавно';
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !S.activeChatId) return;
  if (!S.ws || S.ws.readyState !== 1) { toast('Нет связи с сервером'); return; }
  const chatId = S.activeChatId;
  const temp = {
    id: -(Date.now()), chat_id: chatId, sender_id: S.user.id, text, sent_at: Math.floor(Date.now() / 1000),
    deleted: 0, status: { delivered: 0, read: 0, total: 1 }, _optimistic: true,
  };
  _msgCache.push(temp);
  renderMessages();
  S.ws.send(JSON.stringify({ type: 'message', chat_id: chatId, text }));
  input.value = '';
}

// ── WEBSOCKET ──
function connectWS() {
  if (!S.token) return;
  const prev = S.ws;
  if (prev && prev.readyState <= 1) { try { prev.close(); } catch {} }
  const ws = new WebSocket(`${wsProto()}://${S.server}/ws?token=${S.token}`);
  S.ws = ws;

  ws.onmessage = e => {
    if (ws !== S.ws) return;
    let data; try { data = JSON.parse(e.data); } catch { return; }

    if (data.type === 'message') {
      const m = data.message;
      const chat = S.chats.find(c => c.id === m.chat_id);
      if (chat) chat.last_message = m;
      if (S.activeChatId === m.chat_id) {
        if (m.sender_id === S.user.id) _msgCache = _msgCache.filter(x => !x._optimistic);
        _msgCache.push(m);
        renderMessages();
        if (S.ws?.readyState === 1) {
          S.ws.send(JSON.stringify({ type: 'read', chat_id: m.chat_id }));
          if (m.sender_id !== S.user.id) S.ws.send(JSON.stringify({ type: 'delivered', message_id: m.id }));
        }
      } else if (m.sender_id !== S.user.id && chat) {
        chat.unread = (chat.unread || 0) + 1;
        if (m.mentions?.includes(S.user.id)) chat.unread_mentions = (chat.unread_mentions || 0) + 1;
        if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'delivered', message_id: m.id }));
      }
      if (!chat) loadChats(); else renderChats();
    }

    if (data.type === 'message_edited') {
      const m = data.message;
      const chat = S.chats.find(c => c.id === m.chat_id);
      if (chat?.last_message?.id === m.id) chat.last_message = m;
      const idx = _msgCache.findIndex(x => x.id === m.id);
      if (idx >= 0) { _msgCache[idx] = m; if (S.activeChatId === m.chat_id) renderMessages(); }
      renderChats();
    }

    if (data.type === 'message_deleted') {
      const { message_id, chat_id } = data;
      const chat = S.chats.find(c => c.id === chat_id);
      if (chat?.last_message?.id === message_id) chat.last_message = { ...chat.last_message, deleted: 1, text: '', attachment: null };
      const idx = _msgCache.findIndex(x => x.id === message_id);
      if (idx >= 0) { _msgCache[idx].deleted = 1; if (S.activeChatId === chat_id) renderMessages(); }
      renderChats();
    }

    if (data.type === 'status_update') {
      const m = data.message;
      if (!m.status) return;
      const chat = S.chats.find(c => c.id === m.chat_id);
      if (chat?.last_message?.id === m.id) { chat.last_message.status = { ...m.status }; renderChats(); }
      const idx = _msgCache.findIndex(x => x.id === m.id);
      if (idx >= 0) { _msgCache[idx].status = { ...m.status }; if (S.activeChatId === m.chat_id) renderMessages(); }
    }

    if (data.type === 'status_range') {
      if (data.chat_id !== S.activeChatId) {
        const chat = S.chats.find(c => c.id === data.chat_id);
        const lm = chat?.last_message;
        if (lm && lm.sender_id === S.user.id && lm.status && lm.id >= data.min_id && lm.id <= data.max_id) {
          if (data.kind === 'read') { lm.status.read = Math.min(lm.status.total, lm.status.read + 1); lm.status.delivered = Math.max(lm.status.delivered, lm.status.read); }
          else lm.status.delivered = Math.min(lm.status.total, lm.status.delivered + 1);
          renderChats();
        }
        return;
      }
      let changed = false;
      _msgCache.forEach(m => {
        if (m.sender_id !== S.user.id || !m.status || m.id < data.min_id || m.id > data.max_id) return;
        const key = `${m.id}:${data.kind}:${data.reader_id}`;
        if (S.statusApplied[key]) return;
        S.statusApplied[key] = true;
        if (data.kind === 'read') { m.status.read = Math.min(m.status.total, m.status.read + 1); m.status.delivered = Math.max(m.status.delivered, m.status.read); }
        else m.status.delivered = Math.min(m.status.total, m.status.delivered + 1);
        changed = true;
      });
      if (changed) renderMessages();
    }

    if (data.type === 'presence') { S.presence[data.user_id] = data.status; }
    if (data.type === 'reload_chats') loadChats();
    if (data.type === 'chat_read') { const c = S.chats.find(x => x.id === data.chat_id); if (c) { c.unread = 0; renderChats(); } }
  };

  ws.onclose = () => { if (S.ws === ws) setTimeout(() => { if (S.token) connectWS(); }, 2000); };
}

// ── ШТОРКА «ПРОЧИТАНО» (тот же ring-дизайн, что в /chat, но как bottom sheet) ──
async function openReadSheet(msgId) {
  const data = await api('GET', `/messages/${msgId}/info`);
  if (!data || data.error) return;
  const icoDblTeal = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>`;
  const icoDblGray = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6169" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>`;
  const icoSingleTeal = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  function tlStep(label, sub, done, ico, showConn) {
    const dc = done ? 'mi-done' : 'mi-pending';
    const pc = done ? '' : ' mi-pending';
    const conn = showConn ? `<div class="mi-connector ${dc}"></div>` : '';
    return `<div class="mi-step"><div class="mi-step-left"><div class="mi-icon ${dc}">${ico}</div>${conn}</div>
      <div class="mi-step-right"><div class="mi-step-name${pc}">${label}</div><div class="mi-step-sub${pc}">${sub}</div></div></div>`;
  }
  let title, body;
  if (data.chat_type === 'direct') {
    title = 'Информация';
    const s = data.statuses[0];
    const sentDone = !!data.sent_at, delivDone = !!s?.delivered_at, readDone = !!s?.read_at;
    body = `<div class="mi-timeline">
      ${tlStep('Отправлено', fmtDateTime(data.sent_at) || '—', sentDone, icoSingleTeal, true)}
      ${tlStep('Доставлено', delivDone ? fmtDateTime(s?.delivered_at) : 'пока не доставлено', delivDone, delivDone ? icoDblTeal : icoDblGray, true)}
      ${tlStep('Прочитано', readDone ? fmtDateTime(s?.read_at) : 'пока не прочитано', readDone, readDone ? icoDblTeal : icoDblGray, false)}
    </div>`;
  } else {
    title = 'Прочитано';
    const total = data.statuses.length;
    const readUsers = data.statuses.filter(s => s.read_at).sort((a, b) => b.read_at - a.read_at);
    const circ = 100.5, frac = total ? readUsers.length / total : 0;
    body = `<div class="mi-progress">
      <div class="mi-ring"><svg viewBox="0 0 38 38">
        <circle cx="19" cy="19" r="16" fill="none" stroke="var(--border)" stroke-width="3.5"/>
        <circle cx="19" cy="19" r="16" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${(circ * (1 - frac)).toFixed(1)}"/>
      </svg><b>${readUsers.length}/${total}</b></div>
      <div><div class="mi-progress-label">${readUsers.length === total ? 'Прочитали все' : 'Прочитано'}</div>
      <div class="mi-progress-sub">${readUsers.length} из ${total} участников</div></div></div>`;
    body += readUsers.length === 0 ? `<div class="mi-empty">Пока никто не прочитал</div>` : readUsers.map(s => {
      const [date, time] = fmtDateTime(s.read_at).split(' ');
      return `<div class="mi-row"><div class="av ${userAvatarColor(s.user_id)}" data-av-user="${s.user_id}" data-av-fallback="${esc(initials(s.display_name))}">${esc(initials(s.display_name))}</div>
        <div class="mi-name">${esc(s.display_name)}</div>
        <div class="mi-time-col"><div class="mi-tick-row">${icoDblTeal}${time}</div><div class="mi-time-date">${date}</div></div></div>`;
    }).join('');
  }
  openSheet(`<div class="sheet-title">${title}</div>${body}`);
  applyAvatars();
}

// ── BOTTOM SHEET ──
function openSheet(html) {
  document.getElementById('sheet').innerHTML = `<div class="sheet-handle"></div>` + html;
  document.getElementById('sheet-bg').classList.add('open');
}
function closeSheet() { document.getElementById('sheet-bg').classList.remove('open'); }
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.getElementById('sheet');
    let startY = 0, dy = 0, dragging = false;
    sheet.addEventListener('pointerdown', e => { dragging = true; startY = e.clientY; sheet.style.transition = 'none'; });
    window.addEventListener('pointermove', e => { if (!dragging) return; dy = Math.max(0, e.clientY - startY); sheet.style.transform = `translateY(${dy}px)`; });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false; sheet.style.transition = '';
      if (dy > 90) closeSheet();
      sheet.style.transform = ''; dy = 0;
    });
  });
})();

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  S.server = window.location.host;
  const session = loadSession();
  if (session?.token) {
    Object.assign(S, { token: session.token, user: session.user });
    const ok = await Promise.race([api('GET', '/users/presence'), new Promise(r => setTimeout(() => r(null), 5000))]);
    if (S.token && ok !== null) enterApp();
  }
  document.getElementById('l-password').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  document.getElementById('l-username').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('l-password').focus());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.token && (!S.ws || S.ws.readyState >= 2)) connectWS();
  });
});
