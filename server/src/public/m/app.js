'use strict';

// ── STATE ──
const S = {
  server: '', token: null, user: null,
  chats: [], activeChatId: null,
  ws: null, wsRetry: 0,
  unread: {}, unreadMentions: {},
  settings: { theme: 'dark', fontSize: 'medium' },
  ctx: { messageId: null, canEdit: false, isMine: false },
  editingMessageId: null,
  replyTo: null,
  presence: {},
  lastSeen: {},
  reactions: {},
  msgStatus: {},
  statusApplied: {},
  chatHasMore: false, chatOldestId: null,
  chatHasMoreAfter: false, chatNewestId: null,
  subrooms: {},
  activeSubroomId: null,
  activeRoomId: null,
  editLimit: 120,
  avatarTs: 0,
  drafts: (()=>{ try { return JSON.parse(localStorage.getItem('m_drafts'))||{}; } catch { return {}; } })(),
};

const SESSION_KEY = 'electron_v2';
const M_SESSION_KEY = 'm_settings_v1';
let _loadingMore = false;
let _loadingChatId = null;
const _avatarCache = new Map();
let _fetchController = new AbortController();
let _chatFromSubrooms = false; // пришли ли в чат через подкомнаты
const _chatRowCache = new Map();

// ── UTILS ──
function saveDrafts() { try { localStorage.setItem('m_drafts', JSON.stringify(S.drafts)); } catch {} }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function mdLite(escaped) {
  return escaped
    .replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<i>$1</i>');
}
function linkifyText(text) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRe).map((part, i) => {
    if (i % 2 !== 1) return mdLite(esc(part).replace(/@([\w.-]+)/g, '<span class="mention">@$1</span>'));
    return `<a class="msg-link" href="${esc(part)}" target="_blank" rel="noopener noreferrer">${esc(part)}</a>`;
  }).join('');
}
function initials(n) { return (n||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase(); }
function fmtTime(ts) { return new Date(ts*1000).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}); }
function fmtChatListTime(ts) {
  const d = new Date(ts*1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ts);
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7) return ['вс','пн','вт','ср','чт','пт','сб'][d.getDay()];
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}.${mm}.${String(d.getFullYear()).slice(-2)}`;
}
function fmtDate(ts) {
  const d = new Date(ts*1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate()-1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru',{day:'numeric',month:'long'});
}
function avatarColor(id) { return ['av-0','av-1','av-2','av-3'][id%4]; }

// ── PROTOCOL ──
function httpProto() { return /:\d+$/.test(S.server) ? 'http' : 'https'; }
function wsProto()   { return /:\d+$/.test(S.server) ? 'ws'   : 'wss';   }

// ── API ──
async function api(method, path, body) {
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api${path}`, {
      method,
      headers: { 'Content-Type':'application/json', ...(S.token?{Authorization:'Bearer '+S.token}:{}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: _fetchController.signal,
    });
    if (res.status === 401) { logout(); return null; }
    return res.json();
  } catch(e) {
    if (e?.name === 'AbortError') return null;
    return null;
  }
}

// ── SESSION ──
function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ server:S.server, token:S.token, user:S.user, settings:S.settings }));
  try { localStorage.setItem(M_SESSION_KEY, JSON.stringify({ theme: S.settings.theme, fontSize: S.settings.fontSize })); } catch {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function loadMobileSettings() {
  try { return JSON.parse(localStorage.getItem(M_SESSION_KEY)); } catch { return null; }
}

// ── TOAST ──
let _toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── AVATAR ──
function tryLoadAvatar(el, url, fallbackText) {
  const cached = _avatarCache.get(url);
  if (cached === true) {
    el.style.backgroundImage = `url('${url}')`;
    el.textContent = '';
    return;
  }
  if (cached === false) {
    el.style.backgroundImage = '';
    el.textContent = fallbackText;
    return;
  }
  const img = new Image();
  img.onload = () => {
    _avatarCache.set(url, true);
    el.style.backgroundImage = `url('${url}')`;
    el.textContent = '';
  };
  img.onerror = () => {
    _avatarCache.set(url, false);
    el.style.backgroundImage = '';
    el.textContent = fallbackText;
  };
  img.src = url;
}

// ── SETTINGS ──
function applySettings() {
  const isDark = S.settings.theme === 'dark';
  document.documentElement.classList.toggle('light', !isDark);
  document.documentElement.className = document.documentElement.className.replace(/\bfont-\w+\b/g, '').trim();
  document.documentElement.classList.add('font-' + (S.settings.fontSize || 'medium'));
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = isDark ? '#17212b' : '#ffffff';
  document.querySelectorAll('#theme-seg .seg-btn').forEach(b => {
    b.classList.toggle('active', (b.textContent.trim() === 'Тёмная') === isDark);
  });
  document.querySelectorAll('#font-seg .seg-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === (S.settings.fontSize||'medium')[0].toUpperCase());
  });
}
function setTheme(t) { S.settings.theme = t; applySettings(); saveSession(); }
function setFontSize(f) { S.settings.fontSize = f; applySettings(); saveSession(); }

// ── NAVIGATION ──
function setNavVisible(v) {
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = v ? '' : 'none';
}

function switchTab(tab) {
  const isChats = tab === 'chats';
  document.getElementById('layer-list').style.display = isChats ? '' : 'none';
  const ls = document.getElementById('layer-settings');
  if (ls) ls.style.display = isChats ? 'none' : '';
  document.getElementById('nav-chats').classList.toggle('active', isChats);
  document.getElementById('nav-settings').classList.toggle('active', !isChats);
  if (!isChats && S.user) renderSettingsProfile();
}

function renderSettingsProfile() {
  const sec = document.getElementById('profile-section');
  if (!sec || !S.user) return;
  const u = S.user;
  const color = avatarColor(u.id);
  const avUrl = `${httpProto()}://${S.server}/api/users/${u.id}/avatar?t=${S.avatarTs}`;
  sec.innerHTML = `
    <div class="profile-av ${color}" id="settings-av">${initials(u.display_name)}</div>
    <div class="profile-info">
      <div class="profile-name">${esc(u.display_name)}</div>
      <div class="profile-username">@${esc(u.username)}</div>
    </div>`;
  const avEl = document.getElementById('settings-av');
  if (avEl) tryLoadAvatar(avEl, avUrl, initials(u.display_name));
  const verEl = document.getElementById('settings-version');
  if (verEl) {
    fetch('/version.json').then(r=>r.json()).then(v=>{ verEl.textContent = v.client || '—'; }).catch(()=>{});
  }
}

function openSearch() {
  const bar = document.getElementById('search-bar');
  if (bar) bar.style.display = '';
  document.getElementById('search-input')?.focus();
}
function closeSearch() {
  const bar = document.getElementById('search-bar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('search-input');
  if (inp) { inp.value = ''; }
  renderChatList('');
}
function onSearch(q) { renderChatList(q); }

// ── LOGIN ──
async function doLogin() {
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const err = document.getElementById('l-err');
  const btn = document.getElementById('l-btn');
  if (!username||!password) { err.textContent='Заполните все поля'; return; }
  btn.disabled = true; btn.textContent = 'Подключение...'; err.textContent = '';
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.token) {
      Object.assign(S, { token: data.token, user: data.user });
      saveSession(); enterApp();
    } else { err.textContent = data.error || 'Неверный логин или пароль'; }
  } catch { err.textContent = 'Не удалось подключиться к серверу'; }
  finally { btn.disabled = false; btn.textContent = 'Войти'; }
}

function logout() {
  _fetchController.abort();
  _fetchController = new AbortController();
  if (S.ws) { try { S.ws.close(); } catch {} }
  Object.assign(S, { token:null, user:null, chats:[], activeChatId:null, ws:null, unread:{}, activeRoomId:null, activeSubroomId:null });
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-login').style.display = '';
  // Reset layers
  document.getElementById('layer-chat')?.classList.remove('open');
  document.getElementById('layer-subrooms')?.classList.remove('open');
  setNavVisible(true);
}

function enterApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-main').style.display = '';
  switchTab('chats');
  setNavVisible(true);
  loadChats();
  loadPresence();
  connectWS();
}

// ── OPEN / CLOSE CHAT ──
async function openChat(chatId) {
  const chat = findChat(chatId);
  if (chat?.has_subrooms) {
    await pushSubrooms(chatId);
    return;
  }
  if (S.editingMessageId) cancelEdit();
  S.activeChatId = chatId;
  _loadingChatId = chatId;
  S.chatHasMore = false; S.chatOldestId = null;
  S.chatHasMoreAfter = false; S.chatNewestId = null;
  S.statusApplied = {};
  _loadingMore = false;
  const unreadAtOpen = S.unread[chatId] || 0;
  S.unread[chatId] = 0;
  S.unreadMentions[chatId] = 0;
  updateUnreadTotal();
  renderChatList();

  // Build topbar
  const name = chatName(chat);
  const hdr = document.getElementById('chat-hdr');
  if (hdr) {
    const peerId = getPeerUserId(chat);
    const isOnline = peerId && (S.presence[peerId] === 'online');
    const avColor = chatAvatarColor(chat);
    const avLetter = chatIcon(chat);
    const isSq = chat?.type !== 'direct';
    hdr.innerHTML = `
      <div class="tb-av ${avColor}${isSq?' sq':''}" id="chat-hdr-av"><span class="tb-av-text">${avLetter}</span>${isOnline?'<div class="online-dot"></div>':''}</div>
      <div class="tb-info">
        <div class="tb-name">${esc(name)}</div>
        <div class="tb-sub" id="chat-hdr-sub">${chatSubtitle(chat)}</div>
      </div>`;
    const avEl = document.getElementById('chat-hdr-av');
    if (avEl) {
      const avUrl = peerId
        ? `${httpProto()}://${S.server}/api/users/${peerId}/avatar?t=${S.avatarTs}`
        : `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${S.avatarTs}`;
      tryLoadAvatar(avEl, avUrl, avLetter);
    }
  }

  // Show layer
  const layer = document.getElementById('layer-chat');
  layer.classList.add('open');
  setNavVisible(false);

  // WS read
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type:'read', chat_id: chatId }));

  // Restore draft
  const input = document.getElementById('msg-input');
  if (input) {
    input.value = S.drafts[chatId] || '';
    autoResize(input);
    updateSendBtn();
  }

  // Load messages
  const msgs = document.getElementById('messages');
  if (msgs) msgs.innerHTML = '<div class="date-pill">Загрузка…</div>';

  const data = await api('GET', `/messages/chat/${chatId}?limit=50`);
  if (_loadingChatId !== chatId) return;
  _loadingChatId = null;
  if (!data) return;
  S.chatHasMore = data.hasMore;
  S.chatOldestId = data.messages[0]?.id ?? null;
  S.chatNewestId = data.messages[data.messages.length - 1]?.id ?? null;
  renderMessages(data.messages, true);
  insertUnreadDivider(data.messages, unreadAtOpen);
  const msgsEl = document.getElementById('messages');
  if (msgsEl) {
    msgsEl.addEventListener('scroll', onMessagesScroll, { passive: true });
    addMsgGestures(msgsEl);
  }
}

function closeChat() {
  if (S.editingMessageId) cancelEdit();
  if (S.activeChatId && !S.editingMessageId) {
    const input = document.getElementById('msg-input');
    const val = input?.value?.trim();
    if (val) S.drafts[S.activeChatId] = val;
    else delete S.drafts[S.activeChatId];
    saveDrafts();
  }
  S.activeChatId = null;
  const layer = document.getElementById('layer-chat');
  layer.classList.remove('open');
  if (_chatFromSubrooms) {
    // Back to subrooms, nav stays hidden
    setNavVisible(false);
  } else {
    setNavVisible(true);
    S.activeSubroomId = null;
    S.activeRoomId = null;
  }
  hideReplyBar();
  hideCtxMenu();
  updateUnreadTotal();
  renderChatList();
}

// ── SUBROOMS ──
async function pushSubrooms(roomId) {
  S.activeRoomId = roomId;
  S.activeSubroomId = null;
  _chatFromSubrooms = false;

  const room = S.chats.find(c => c.id === roomId);
  const hdr = document.getElementById('subrooms-hdr');
  if (hdr) {
    const avColor = chatAvatarColor(room);
    hdr.innerHTML = `
      <div class="tb-av ${avColor} sq">${chatIcon(room)}</div>
      <div class="tb-info">
        <div class="tb-name">${esc(chatName(room))}</div>
        <div class="tb-sub">Подкомнаты</div>
      </div>`;
  }

  const layer = document.getElementById('layer-subrooms');
  layer.classList.add('open');
  setNavVisible(false);

  let subs = S.subrooms[roomId];
  if (!subs) {
    await loadSubrooms(roomId);
    subs = S.subrooms[roomId] || [];
  }
  renderSubroomsList(roomId, subs);
}

function closeSubrooms() {
  const layer = document.getElementById('layer-subrooms');
  layer.classList.remove('open');
  S.activeRoomId = null;
  S.activeSubroomId = null;
  _chatFromSubrooms = false;
  setNavVisible(true);
  renderChatList();
}

async function loadSubrooms(roomId) {
  const subs = await api('GET', `/chats/${roomId}/subrooms`);
  if (!subs) return;
  S.subrooms[roomId] = subs;
  subs.forEach(s => {
    S.unread[s.id] = s.unread || 0;
    S.unreadMentions[s.id] = s.unread_mentions || 0;
  });
}

function renderSubroomsList(roomId, subs) {
  const list = document.getElementById('subrooms-list');
  if (!list) return;
  if (!subs.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">Нет подкомнат</div>'; return; }
  list.innerHTML = subs.map(s => {
    const unread = S.unread[s.id] || 0;
    const badge = unread ? `<div class="sr-badge">${unread > 99 ? '99+' : unread}</div>` : '';
    const color = avatarColor(s.id);
    return `<div class="subroom-row" onclick="openSubroom(${s.id})">
      <div class="sr-av ${color}">${(s.name||'?')[0].toUpperCase()}</div>
      <div class="sr-body">
        <div class="sr-name">${esc(s.name)}</div>
        <div class="sr-sub"># подкомната</div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

async function openSubroom(subroomId) {
  S.activeSubroomId = subroomId;
  _chatFromSubrooms = true;
  await openChat(subroomId);
}

// ── CHAT LIST HELPERS ──
function findChat(chatId) {
  let c = S.chats.find(c => c.id === chatId);
  if (c) return c;
  for (const subs of Object.values(S.subrooms)) {
    const s = subs.find(s => s.id === chatId);
    if (s) return { id: chatId, type: 'room', name: s.name, parent_id: s.parent_id, members: [] };
  }
  return null;
}

function chatName(chat) {
  if (!chat) return 'Чат';
  if (chat.type === 'group') return chat.name || 'Группа';
  if (chat.type === 'room') return chat.name || 'Комната';
  const other = chat.members?.find(m => m.id !== S.user?.id);
  return other?.display_name || 'Чат';
}

function chatIcon(chat) {
  if (!chat) return '?';
  if (chat.type === 'room') return '🏠';
  return initials(chatName(chat));
}

function chatAvatarColor(chat) {
  if (!chat) return 'av-0';
  if (chat.type === 'room') return 'av-2';
  if (chat.type === 'group') return 'av-1';
  return avatarColor(getPeerUserId(chat) || chat.id);
}

function chatSubtitle(chat) {
  if (!chat) return '';
  if (chat.type === 'room' && chat.parent_id) return '# подкомната';
  if (chat.type === 'room') return `🏠 Комната · ${chat.members?.length||0} участников`;
  if (chat.type === 'group') return `${chat.members?.length||0} участников`;
  const peerId = getPeerUserId(chat);
  if (peerId) return peerStatusText(peerId);
  return 'Личный чат';
}

function getPeerUserId(chat) {
  if (chat?.type !== 'direct') return null;
  return chat.members?.find(m => m.id !== S.user?.id)?.id || null;
}

// ── LOAD CHATS ──
async function loadChats() {
  const chats = await api('GET', '/chats');
  if (!chats) return;
  S.chats = chats;
  chats.forEach(c => {
    S.unread[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread || 0);
    S.unreadMentions[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread_mentions || 0);
  });
  await Promise.all(chats.filter(c => c.has_subrooms).map(c => loadSubrooms(c.id)));
  updateUnreadTotal();
  renderChatList();
}

// ── RENDER CHAT LIST ──
function renderChatList(searchQ = '') {
  const q = searchQ.toLowerCase();
  const list = document.getElementById('chat-list');
  if (!list) return;
  const spinner = document.getElementById('chat-list-spinner');
  if (spinner) spinner.style.display = 'none';

  const filtered = S.chats.filter(c => chatName(c).toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.type === 'room' && b.type !== 'room') return -1;
      if (a.type !== 'room' && b.type === 'room') return 1;
      if (a.type === 'room' && b.type === 'room') return chatName(a).localeCompare(chatName(b), 'ru');
      const ta = a.last_message?.sent_at || 0, tb = b.last_message?.sent_at || 0;
      return tb - ta;
    });

  const pinned = filtered.filter(c => c.pinned || c.type === 'room');
  const rest   = filtered.filter(c => !c.pinned && c.type !== 'room');

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted)">Нет чатов</div>';
    _chatRowCache.clear();
    return;
  }

  const items = [];
  if (pinned.length) {
    items.push({ key:'label-pin', html:'<div class="section-label">Закреплённые</div>' });
    pinned.forEach(c => items.push({ key:'chat-'+c.id, html: buildChatRow(c) }));
  }
  if (pinned.length && rest.length) {
    items.push({ key:'label-all', html:'<div class="section-label">Все чаты</div>' });
  }
  rest.forEach(c => items.push({ key:'chat-'+c.id, html: buildChatRow(c) }));

  syncChatList(list, items);
  // Apply avatars after sync
  list.querySelectorAll('[data-av-chat]').forEach(el => {
    const chatId = parseInt(el.dataset.avChat);
    const chat = findChat(chatId);
    if (!chat) return;
    const peerId = getPeerUserId(chat);
    const url = peerId
      ? `${httpProto()}://${S.server}/api/users/${peerId}/avatar?t=${S.avatarTs}`
      : `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${S.avatarTs}`;
    tryLoadAvatar(el, url, chatIcon(chat));
  });
}

function buildChatRow(c) {
  const name = chatName(c);
  const unread = c.has_subrooms
    ? (S.subrooms[c.id]||[]).reduce((s,r) => s + (S.unread[r.id]||0), 0)
    : S.unread[c.id] || 0;
  const mentions = c.has_subrooms
    ? (S.subrooms[c.id]||[]).reduce((s,r) => s + (S.unreadMentions[r.id]||0), 0)
    : S.unreadMentions[c.id] || 0;
  const lm = c.last_message;
  let preview = lm
    ? (lm.deleted ? 'Сообщение удалено' : (lm.text ? lm.text.replace(/<[^>]*>/g,'').slice(0,50) : (lm.attachment ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Фото' : '📎 ' + (lm.attachment.name||'Файл')) : '')))
    : 'Нет сообщений';
  if (preview.length > 50) preview = preview.slice(0,50) + '…';
  const draft = (c.id !== S.activeChatId) ? S.drafts[c.id] : null;
  const previewHtml = draft
    ? `<span class="cr-draft">Черновик:</span> ${esc(draft.slice(0,40))}`
    : esc(preview);
  const time = lm ? fmtChatListTime(lm.sent_at) : '';
  const color = chatAvatarColor(c);
  const icon  = chatIcon(c);
  const isSq  = c.type !== 'direct';
  const peerId = getPeerUserId(c);
  const isOnline = peerId && S.presence[peerId] === 'online';
  const pinIcon = c.pinned ? `<svg class="cr-pin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>` : '';
  const badgeHtml = mentions > 0
    ? `<div class="cr-mention">@</div><div class="cr-badge">${unread > 99 ? '99+' : unread}</div>`
    : unread > 0 ? `<div class="cr-badge">${unread > 99 ? '99+' : unread}</div>` : '';

  const rowHtml = `<div class="chat-row" data-chat-id="${c.id}" onclick="openChat(${c.id})">
    <div class="cr-av ${color}${isSq?' sq':''}" data-av-chat="${c.id}"><span class="cr-av-text">${icon}</span>${isOnline?'<div class="online-dot"></div>':''}</div>
    <div class="cr-body">
      <div class="cr-top">
        <div class="cr-name">${esc(name)}</div>
        ${pinIcon}
        <div class="cr-time">${esc(time)}</div>
      </div>
      <div class="cr-bot">
        <div class="cr-preview">${previewHtml}</div>
        ${badgeHtml}
      </div>
    </div>
  </div>
  <div class="chat-row-actions">
    <button class="cra-btn cra-pin" onclick="pinChat(${c.id},event)">
      <span class="cra-btn-icon">${c.pinned?'📌':'📌'}</span>${c.pinned ? 'Открепить' : 'Закрепить'}
    </button>
    <button class="cra-btn cra-delete" onclick="deleteChatConfirm(${c.id},event)">
      <span class="cra-btn-icon">🗑</span>Удалить
    </button>
  </div>`;

  return `<div class="chat-row-wrap" data-key="chat-${c.id}">${rowHtml}</div>`;
}

function syncChatList(list, items) {
  const seen = new Set();
  let prev = null;
  items.forEach(it => {
    seen.add(it.key);
    let el = list.querySelector(`[data-key="${CSS.escape(it.key)}"]`);
    if (el && _chatRowCache.get(it.key) !== it.html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = it.html;
      const fresh = tmp.firstElementChild;
      if (fresh) { fresh.dataset.key = it.key; el.replaceWith(fresh); el = fresh; }
    } else if (!el) {
      const tmp = document.createElement('div');
      tmp.innerHTML = it.html;
      el = tmp.firstElementChild;
      if (el) { el.dataset.key = it.key; list.appendChild(el); }
    }
    if (el) {
      _chatRowCache.set(it.key, it.html);
      if (prev) { if (prev.nextElementSibling !== el) list.insertBefore(el, prev.nextElementSibling); }
      else if (list.firstElementChild !== el) list.insertBefore(el, list.firstElementChild);
      prev = el;
      // Attach swipe if needed
      if (el.classList.contains('chat-row-wrap') && !el._swipeInit) {
        initChatRowSwipe(el);
        el._swipeInit = true;
      }
    }
  });
  [...list.children].forEach(ch => {
    if (!ch.dataset.key || !seen.has(ch.dataset.key)) {
      if (ch.dataset.key) _chatRowCache.delete(ch.dataset.key);
      ch.remove();
    }
  });
}

// ── CHAT ROW SWIPE ──
const SWIPE_OPEN = -152; // px: total reveal (76 pin + 76 delete)
let _openWrap = null;

function initChatRowSwipe(wrap) {
  const row = wrap.querySelector('.chat-row');
  if (!row) return;
  let startX = 0, startY = 0, dirLocked = false, isSwipe = false;

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dirLocked = false;
    isSwipe = false;
    if (_openWrap && _openWrap !== wrap) { snapRow(_openWrap, 0); _openWrap = null; }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 6) return;
      isSwipe = true;
      dirLocked = true;
    }
    if (!isSwipe) return;
    if (dx > 0 && !_openWrap) return; // right drag on closed row → ignore
    e.preventDefault();
    const cur = parseFloat(row.style.transform.replace('translateX(','') || '0');
    const target = Math.max(SWIPE_OPEN, Math.min(0, cur + dx * 0.75 - (dirLocked ? 0 : 0)));
    const clamped = Math.max(SWIPE_OPEN, Math.min(0, parseFloat(row.dataset.baseX || '0') + dx));
    row.style.transform = `translateX(${clamped}px)`;
    row.style.transition = 'none';
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (!isSwipe) return;
    const dx = e.changedTouches[0].clientX - startX;
    const cur = parseFloat(row.style.transform.replace(/[^-0-9.]/g,'') || '0');
    if (cur < SWIPE_OPEN / 2) {
      snapRow(wrap, SWIPE_OPEN);
      _openWrap = wrap;
    } else {
      snapRow(wrap, 0);
      _openWrap = null;
    }
    row.dataset.baseX = '';
  }, { passive: true });

  // Store current X when touch starts on an already-open row
  wrap.addEventListener('touchstart', e => {
    row.dataset.baseX = parseFloat(row.style.transform.replace(/[^-0-9.]/g,'') || '0');
  }, { passive: true });
}

function snapRow(wrap, toX) {
  const row = wrap.querySelector('.chat-row');
  if (!row) return;
  row.style.transition = 'transform .25s cubic-bezier(.32,.72,0,1)';
  row.style.transform = toX === 0 ? '' : `translateX(${toX}px)`;
}

function closeAllRows() {
  if (_openWrap) { snapRow(_openWrap, 0); _openWrap = null; }
}

async function pinChat(chatId, e) {
  e?.stopPropagation();
  closeAllRows();
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat) return;
  const res = await api('PATCH', `/chats/${chatId}`, { pinned: !chat.pinned });
  if (res?.ok !== false) {
    chat.pinned = !chat.pinned;
    _chatRowCache.clear();
    renderChatList();
  }
}

async function deleteChatConfirm(chatId, e) {
  e?.stopPropagation();
  closeAllRows();
  showSheet([
    { label: 'Удалить чат', danger: true, action: () => doDeleteChat(chatId) },
  ]);
}

async function doDeleteChat(chatId) {
  await api('DELETE', `/chats/${chatId}`);
  S.chats = S.chats.filter(c => c.id !== chatId);
  if (S.activeChatId === chatId) { S.activeChatId = null; closeChat(); }
  _chatRowCache.clear();
  renderChatList();
}

// ── ACTION SHEET ──
const _sheetActions = [];
function showSheet(actions) {
  _sheetActions.length = 0;
  actions.forEach((a, i) => { _sheetActions[i] = a.action; });
  const overlay = document.getElementById('sheet-overlay');
  const sheet   = document.getElementById('sheet');
  overlay.style.display = '';
  sheet.innerHTML = actions.map((a, i) =>
    `<div class="sheet-item${a.danger?' danger':''}" onclick="_sheetActions[${i}]&&(_sheetActions[${i}](),closeSheet())">${esc(a.label)}</div>`
  ).join('') + `<div class="sheet-cancel" onclick="closeSheet()">Отмена</div>`;
}
function closeSheet() {
  const overlay = document.getElementById('sheet-overlay');
  setTimeout(() => { overlay.style.display = 'none'; }, 200);
}

function showNewChat() { showToast('Для создания чатов используйте десктоп-клиент'); }

// ── OPEN CHAT MENU ──
function openChatMenu(e) {
  e?.stopPropagation();
  const chatId = S.activeChatId;
  if (!chatId) return;
  showSheet([
    { label: 'Удалить чат', danger: true, action: () => doDeleteChat(chatId) },
  ]);
}

// ── MESSAGES ──
function sameTimeGroup(a, b) {
  if (!a || !b || a.sender_id !== b.sender_id) return false;
  const ta = new Date(a.sent_at * 1000), tb = new Date(b.sent_at * 1000);
  return ta.getHours() === tb.getHours() && ta.getMinutes() === tb.getMinutes() && ta.toDateString() === tb.toDateString();
}

function renderMessages(msgs, stick = true) {
  const container = document.getElementById('messages');
  if (!container) return;
  msgs.forEach(m => { if (m.reactions?.length) S.reactions[m.id] = m.reactions; });
  let html = '', lastDate = '', lastSenderId = null, lastSentAt = 0;
  msgs.forEach((m, i) => {
    const dateStr = fmtDate(m.sent_at);
    if (dateStr !== lastDate) {
      if (lastDate) html += '</div>';
      html += `<div class="day-group"><div class="date-pill">${dateStr}</div>`;
      lastDate = dateStr; lastSenderId = null;
    }
    const grouped = m.sender_id === lastSenderId && (m.sent_at - lastSentAt) < 300 && dateStr === lastDate;
    html += renderMsgIRC(m, grouped);
    lastSenderId = m.sender_id; lastSentAt = m.sent_at;
  });
  if (lastDate) html += '</div>';
  container.innerHTML = html;
  if (stick) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function insertUnreadDivider(msgs, unreadCount) {
  if (!unreadCount) return;
  const others = msgs.filter(m => m.sender_id !== S.user?.id && !m.deleted);
  const count = Math.min(unreadCount, others.length);
  const firstUnread = others[others.length - count];
  if (!firstUnread) return;
  const el = document.querySelector(`[data-msg-id="${firstUnread.id}"]`);
  const container = document.getElementById('messages');
  if (!el || !container) return;
  const div = document.createElement('div');
  div.className = 'unread-divider';
  div.textContent = 'Непрочитанные сообщения';
  el.parentNode.insertBefore(div, el);
  requestAnimationFrame(() => { container.scrollTop = Math.max(div.offsetTop - 60, 0); });
}

function appendMsg(m) {
  const container = document.getElementById('messages');
  if (!container) return;
  if (m.id > 0 && container.querySelector(`[data-msg-id="${m.id}"]`)) return;
  const allMsgs = [...container.querySelectorAll('[data-msg-id]')];
  const lastEl = allMsgs[allMsgs.length - 1];
  let grouped = false;
  if (lastEl) {
    const ps = parseInt(lastEl.dataset.senderId || '0');
    const pt = parseInt(lastEl.dataset.sentAt || '0');
    grouped = sameTimeGroup({ sender_id: ps, sent_at: pt }, m) && fmtDate(pt) === fmtDate(m.sent_at);
  }
  const msgHtml = renderMsgIRC(m, grouped);
  const msgDate = fmtDate(m.sent_at);
  const groups = container.querySelectorAll(':scope > .day-group');
  const lastGroup = groups[groups.length - 1];
  const lastGroupDate = lastGroup?.querySelector('.date-pill')?.textContent;
  if (lastGroup && lastGroupDate === msgDate) {
    lastGroup.insertAdjacentHTML('beforeend', msgHtml);
  } else {
    container.insertAdjacentHTML('beforeend',
      `<div class="day-group"><div class="date-pill">${msgDate}</div>${msgHtml}</div>`);
  }
  const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (m._optimistic || dist < 200) container.scrollTop = container.scrollHeight;
  if (!m._optimistic) {
    const newEl = container.querySelectorAll('[data-msg-id]');
    newEl[newEl.length - 1]?.classList.add('msg-new');
  }
}

function updateMsgInDOM(m) {
  const el = document.querySelector(`[data-msg-id="${m.id}"]`);
  if (!el) return;
  const grouped = el.classList.contains('irc-grouped');
  el.outerHTML = renderMsgIRC(m, grouped);
}

function prependMessages(msgs) {
  const container = document.getElementById('messages');
  if (!container) return;
  msgs.forEach(m => { if (m.reactions?.length) S.reactions[m.id] = m.reactions; });
  let html = '', lastDate = '', lastSenderId = null, lastSentAt = 0;
  msgs.forEach((m, i) => {
    const dateStr = fmtDate(m.sent_at);
    if (dateStr !== lastDate) {
      if (lastDate) html += '</div>';
      html += `<div class="day-group"><div class="date-pill">${dateStr}</div>`;
      lastDate = dateStr; lastSenderId = null;
    }
    const grouped = m.sender_id === lastSenderId && (m.sent_at - lastSentAt) < 300;
    html += renderMsgIRC(m, grouped);
    lastSenderId = m.sender_id; lastSentAt = m.sent_at;
  });
  if (lastDate) html += '</div>';
  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;
  container.insertAdjacentHTML('afterbegin', html);
  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
}

function onMessagesScroll() {
  const container = document.getElementById('messages');
  if (!container) return;
  if (S.chatHasMore && !_loadingMore && container.scrollTop < 80) loadMoreMessages();
}

async function loadMoreMessages() {
  if (_loadingMore || !S.chatHasMore || !S.activeChatId || !S.chatOldestId) return;
  _loadingMore = true;
  const chatId = S.activeChatId;
  const data = await api('GET', `/messages/chat/${chatId}?before=${S.chatOldestId}&limit=50`);
  _loadingMore = false;
  if (!data || S.activeChatId !== chatId) return;
  S.chatHasMore = data.hasMore;
  if (data.messages.length) {
    S.chatOldestId = data.messages[0].id;
    prependMessages(data.messages);
  }
}

// ── RENDER IRC MESSAGE ──
function renderReactions(msgId) {
  const counts = S.reactions[msgId] || [];
  if (!counts.length) return '';
  return `<div class="msg-reactions">${counts.map(r =>
    `<button class="msg-reaction" onclick="sendReaction(${msgId},'${r.reaction}')">${r.reaction} <span>${r.count}</span></button>`
  ).join('')}</div>`;
}

function renderStatus(status) {
  if (!status) return '';
  const { delivered, read, total } = status;
  if (!total) return '';
  let cls, title;
  if (read >= total)       { cls = 'status-read';       title = 'Прочитано'; }
  else if (read > 0)       { cls = 'status-partial';    title = `Прочитано ${read} из ${total}`; }
  else if (delivered > 0)  { cls = 'status-delivered';  title = 'Доставлено'; }
  else                     { cls = 'status-sent';        title = 'Отправлено'; }
  const dbl = delivered > 0 || read > 0;
  return `<span class="msg-status ${cls}" title="${title}">
    <svg width="13" height="9" viewBox="0 0 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${dbl ? '<polyline points="1,5.5 3.5,8 9,1"/><polyline points="7,5.5 9.5,8 15,1"/>' : '<polyline points="7,5.5 9.5,8 15,1"/>'}
    </svg>
  </span>`;
}

function renderMsgIRC(m, grouped = false) {
  if (m.status && m.id > 0) S.msgStatus[m.id] = { ...m.status };
  const mine    = m.sender_id === S.user?.id;
  const time    = fmtTime(m.sent_at);
  const deleted = m.deleted;
  const bodyText = deleted
    ? '<em class="irc-deleted">Сообщение удалено</em>'
    : linkifyText(m.text || '') + (m.edited_at ? ' <span class="edited-tag">изм.</span>' : '');
  const statusHtml = mine && !deleted ? renderStatus(m.status) : '';
  const reactHtml  = deleted ? '' : renderReactions(m.id);
  const senderName = esc(m.sender_name || '');
  const avColor    = avatarColor(m.sender_id);
  const avLetter   = initials(m.sender_name || '?').slice(0, 1);
  const avUrl      = `${httpProto()}://${S.server}/api/users/${m.sender_id}/avatar`;

  const replyHtml = m.reply_to_id ? `
    <div class="irc-reply" onclick="scrollToMsg(${m.reply_to_id})">
      <div class="irc-reply-body">
        <div class="irc-reply-name">↳ ${esc(m.reply_sender_name || '')}</div>
        <div class="irc-reply-text">${esc((m.reply_deleted ? 'Сообщение удалено' : (m.reply_text || '')).slice(0, 80))}</div>
      </div>
    </div>` : '';

  const att = m.attachment;
  let attachHtml = '';
  if (!deleted && att?.url && !att.expired) {
    const attUrl = `${httpProto()}://${S.server}${att.url}`;
    if (att.mime?.startsWith('image/')) {
      attachHtml = `<div class="bubble-image"><img src="${httpProto()}://${S.server}${att.thumb || att.url}" loading="lazy" onclick="openLightbox('${attUrl}')"></div>`;
    } else {
      const sizeFmt = att.size > 1048576 ? (att.size/1048576).toFixed(1)+' МБ' : Math.round(att.size/1024)+' КБ';
      attachHtml = `<div class="bubble-file" onclick="downloadFile('${attUrl}','${esc(att.name||'file')}')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="bubble-file-info"><div class="bubble-file-name">${esc(att.name||'Файл')}</div><div class="bubble-file-size">${sizeFmt}</div></div>
      </div>`;
    }
  }

  const avCol = grouped
    ? `<div style="width:32px;flex-shrink:0"></div>`
    : `<div class="irc-av av-round ${avColor}" style="position:relative;flex-shrink:0;background-size:cover;background-position:center">${avLetter}<img src="${avUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none'"></div>`;

  const header = grouped
    ? `<div class="irc-header irc-header-grouped"><span class="status-wrap">${statusHtml}</span><span class="irc-time">${time}</span></div>`
    : `<div class="irc-header">
        <span class="irc-name${mine?' mine':''}">${senderName}</span>
        <div class="irc-meta"><span class="status-wrap">${statusHtml}</span><span class="irc-time">${time}</span></div>
       </div>`;

  return `<div class="irc-msg${grouped?' irc-grouped':''}${m._optimistic?' msg-optimistic':''}" data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}">
    ${avCol}
    <div class="irc-content">
      ${header}
      ${replyHtml}
      ${attachHtml}
      ${m.text || deleted ? `<div class="irc-text${deleted?' irc-deleted':''}">${bodyText}</div>` : ''}
      ${reactHtml}
    </div>
  </div>`;
}

function scrollToMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const msgs = document.getElementById('messages');
  if (msgs) {
    const offset = el.offsetTop - msgs.clientHeight / 2 + el.offsetHeight / 2;
    msgs.scrollTo({ top: offset, behavior: 'smooth' });
  }
  el.classList.add('msg-highlight');
  setTimeout(() => el.classList.remove('msg-highlight'), 1500);
}

// ── LIGHTBOX ──
function openLightbox(url) {
  let lb = document.getElementById('lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lb';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;align-items:center;justify-content:center';
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }
  lb.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px">`;
}

function downloadFile(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener'; a.click();
}

// ── SEND / EDIT ──
let _pendingAttachment = null;

function updateSendBtn() {
  const input = document.getElementById('msg-input');
  const btn   = document.getElementById('send-btn');
  if (!btn) return;
  const hasText = (input?.value?.trim().length > 0) || !!_pendingAttachment;
  btn.disabled = !hasText;
}

function autoResize(el) {
  el.style.overflow = 'hidden';
  el.style.height = '20px';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  if (el.scrollHeight > 120) el.style.overflow = 'auto';
}

function onMsgInput(el) {
  autoResize(el);
  updateSendBtn();
  if (S.activeChatId && !S.editingMessageId) {
    if (el.value) S.drafts[S.activeChatId] = el.value;
    else delete S.drafts[S.activeChatId];
    saveDrafts();
  }
  if (S.activeChatId && S.ws?.readyState === 1) {
    if (!_typingSendTimer) {
      S.ws.send(JSON.stringify({ type: 'typing', chat_id: S.activeChatId }));
    }
    clearTimeout(_typingSendTimer);
    _typingSendTimer = setTimeout(() => { _typingSendTimer = null; }, 1000);
  }
}

let _typingSendTimer = null;

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrEdit(); }
}

function sendOrEdit() {
  if (S.editingMessageId) { submitEdit(); return; }
  const input = document.getElementById('msg-input');
  const text  = input?.value.trim();
  if (!text && !_pendingAttachment) return;
  if (!S.ws || S.ws.readyState !== 1) return;
  const payload = { type: 'message', chat_id: S.activeChatId, text: text || '' };
  if (S.replyTo) payload.reply_to_id = S.replyTo.id;
  if (_pendingAttachment) payload.attachment = _pendingAttachment;
  const tempMsg = {
    id: -(Date.now()),
    chat_id: S.activeChatId,
    sender_id: S.user.id,
    sender_name: S.user.display_name,
    text: text || '',
    sent_at: Math.floor(Date.now() / 1000),
    edited_at: null, deleted: 0,
    reply_to_id: S.replyTo?.id || null,
    reply_text: S.replyTo?.text || null,
    reply_sender_name: S.replyTo?.senderName || null,
    attachment: _pendingAttachment || null,
    status: { delivered: 0, read: 0, total: 1 },
    reactions: [],
    _optimistic: true,
  };
  appendMsg(tempMsg);
  S.ws.send(JSON.stringify(payload));
  hideReplyBar();
  _pendingAttachment = null;
  delete S.drafts[S.activeChatId]; saveDrafts();
  if (input) { input.value = ''; input.style.height = '20px'; }
  updateSendBtn();
}

function submitEdit() {
  const input = document.getElementById('msg-input');
  const text  = input?.value.trim();
  if (!text) { cancelEdit(); return; }
  S.ws.send(JSON.stringify({ type: 'edit_message', message_id: S.editingMessageId, text }));
  cancelEdit();
}

function cancelEdit() {
  S.editingMessageId = null;
  document.getElementById('edit-bar').style.display = 'none';
  const input = document.getElementById('msg-input');
  if (input) { input.value = ''; input.style.height = '20px'; }
  updateSendBtn();
}

// ── FILE ATTACH ──
function pickFile() { document.getElementById('file-input')?.click(); }
async function onFilePicked(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  await uploadFile(file);
}

async function uploadFile(file) {
  const isImage = file.type.startsWith('image/');
  const maxMb = isImage ? 10 : 50;
  if (file.size > maxMb * 1024 * 1024) { showToast(`Файл слишком большой (макс. ${maxMb} МБ)`); return; }
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + S.token },
      body: formData,
    });
    if (!res.ok) { showToast('Ошибка загрузки'); return; }
    _pendingAttachment = await res.json();
    showToast('Файл прикреплён — нажмите Отправить');
    updateSendBtn();
  } catch { showToast('Ошибка загрузки'); }
}

// ── REPLY / EDIT BARS ──
function showReplyBar() {
  const bar = document.getElementById('reply-bar');
  if (!bar || !S.replyTo) return;
  document.getElementById('rb-name').textContent = S.replyTo.senderName || '';
  document.getElementById('rb-text').textContent = S.replyTo.text || '';
  bar.style.display = '';
}

function hideReplyBar() {
  S.replyTo = null;
  const bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
}

// ── CONTEXT MENU ──
function showCtxMenu(e, msgId, sentAt, isMine) {
  e.preventDefault();
  S.ctx.messageId = msgId;
  S.ctx.isMine    = isMine;
  S.ctx.canEdit   = isMine && (Date.now() / 1000 - sentAt) < (S.editLimit || 120);
  const editBtn   = document.getElementById('ctx-edit-btn');
  const delBtn    = document.getElementById('ctx-delete-btn');
  if (editBtn) editBtn.style.display = S.ctx.canEdit ? '' : 'none';
  if (delBtn)  delBtn.style.display  = isMine ? '' : 'none';
  // Mark chosen reactions
  const chosen = S.reactions[msgId] || [];
  document.querySelectorAll('.ctx-react-btn').forEach(b => {
    const emoji = b.dataset.emoji;
    b.classList.toggle('chosen', chosen.some(r => r.reaction === emoji && r.mine));
  });
  const overlay = document.getElementById('ctx-overlay');
  if (overlay) overlay.classList.add('open');
}

function closeCtxMenu() {
  S.ctx.messageId = null;
  const overlay = document.getElementById('ctx-overlay');
  if (overlay) overlay.classList.remove('open');
}

function hideCtxMenu() { closeCtxMenu(); }

function ctxReply() {
  closeCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const textEl  = document.querySelector(`[data-msg-id="${msgId}"] .irc-text`);
  const msgEl   = document.querySelector(`[data-msg-id="${msgId}"]`);
  const text    = textEl?.innerText || '';
  const senderId = parseInt(msgEl?.dataset.senderId || '0');
  const senderName = senderId === S.user?.id ? S.user.display_name : (msgEl?.querySelector('.irc-name')?.textContent || '');
  S.replyTo = { id: msgId, text: text.slice(0, 100), senderName };
  showReplyBar();
  document.getElementById('msg-input')?.focus();
}

function ctxCopy() {
  closeCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const el = document.querySelector(`[data-msg-id="${msgId}"] .irc-text`);
  if (el) navigator.clipboard?.writeText(el.innerText).catch(() => {});
}

function ctxEdit() {
  closeCtxMenu();
  if (!S.ctx.canEdit) return;
  const el   = document.querySelector(`[data-msg-id="${S.ctx.messageId}"] .irc-text`);
  const text = el?.textContent?.replace(/ изм\.$/, '').trim() || '';
  S.editingMessageId = S.ctx.messageId;
  document.getElementById('edit-bar').style.display = 'flex';
  const input = document.getElementById('msg-input');
  if (input) { input.value = text; input.focus(); autoResize(input); }
  updateSendBtn();
}

function ctxDelete() {
  closeCtxMenu();
  if (!S.ctx.messageId || !S.ws) return;
  S.ws.send(JSON.stringify({ type: 'delete_message', message_id: S.ctx.messageId }));
}

function ctxReact(emoji) {
  closeCtxMenu();
  if (S.ctx.messageId) sendReaction(S.ctx.messageId, emoji);
}

// ── REACTIONS ──
function sendReaction(messageId, reaction) {
  if (S.ws?.readyState === 1) {
    S.ws.send(JSON.stringify({ type: 'react', message_id: messageId, reaction }));
  }
}

// ── TYPING ──
const _typingTimers = {};
function showTyping(chatId, senderName) {
  clearTimeout(_typingTimers[chatId]);
  if (chatId === S.activeChatId) {
    const el = document.getElementById('typing-indicator');
    if (el) { el.style.display = 'flex'; document.getElementById('typing-name').textContent = senderName; }
  }
  _typingTimers[chatId] = setTimeout(() => clearTyping(chatId), 5000);
}
function clearTyping(chatId) {
  delete _typingTimers[chatId];
  if (chatId === S.activeChatId) {
    const el = document.getElementById('typing-indicator');
    if (el) el.style.display = 'none';
  }
}

// ── PRESENCE ──
async function loadPresence() {
  const data = await api('GET', '/users/presence');
  if (!data) return;
  S.presence = {}; S.lastSeen = {};
  for (const [id, v] of Object.entries(data)) {
    if (v && typeof v === 'object') { S.presence[id] = v.status; if (v.last_seen) S.lastSeen[id] = v.last_seen; }
    else S.presence[id] = v;
  }
  renderChatList();
}

function formatLastSeen(ts) {
  if (!ts) return 'не в сети';
  const diffSec = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diffSec < 60) return 'только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `был(а) ${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `был(а) ${diffH} ч. назад`;
  return `был(а) ${new Date(ts*1000).toLocaleDateString('ru',{day:'numeric',month:'short'})}`;
}

function peerStatusText(userId) {
  const st = S.presence[userId] || 'offline';
  return st === 'online' ? 'в сети' : formatLastSeen(S.lastSeen[userId]);
}

// ── UNREAD TOTAL ──
function updateUnreadTotal() {
  const total = Object.values(S.unread).reduce((a,b) => a + b, 0);
  document.title = total > 0 ? `(${total}) Electron` : 'Electron';
  try {
    if (total > 0) navigator.setAppBadge?.(total);
    else navigator.clearAppBadge?.();
  } catch {}
}

// ── GESTURES (messages) ──
const EDGE_BACK_ZONE = 30;

function addMsgGestures(container) {
  let startX = 0, startY = 0, swipeEl = null, dirLocked = false, backMode = false;

  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    backMode  = startX < EDGE_BACK_ZONE;
    swipeEl   = backMode ? null : e.target.closest('[data-msg-id]');
    dirLocked = false;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      dirLocked = true;
    }

    if (backMode) {
      if (dx <= 0) return;
      e.preventDefault();
      const layer = document.getElementById('layer-chat');
      if (layer) { layer.style.transform = `translateX(${Math.min(dx, window.innerWidth)}px)`; layer.style.transition = 'none'; }
      return;
    }

    if (!swipeEl) return;
    if (dx >= 0) { swipeEl.style.transform = ''; swipeEl.style.transition = '.2s'; swipeEl = null; return; } // right-swipe on msg → ignore
    e.preventDefault();
    // left swipe → reply indicator
    const shift = Math.max(dx * 0.4, -48);
    swipeEl.style.transform = `translateX(${shift}px)`;
    swipeEl.style.transition = 'none';
  }, { passive: false });

  container.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;

    if (backMode) {
      const layer = document.getElementById('layer-chat');
      if (layer) layer.style.transition = 'transform .32s cubic-bezier(.32,.72,0,1)';
      if (dx > window.innerWidth * 0.35) {
        if (layer) layer.style.transform = `translateX(${window.innerWidth}px)`;
        setTimeout(() => closeChat(), 320);
      } else {
        if (layer) layer.style.transform = '';
        layer?.addEventListener('transitionend', () => { if (layer) { layer.style.transform = ''; layer.style.transition = ''; } }, { once: true });
      }
      backMode = false;
      return;
    }

    if (!swipeEl) return;
    swipeEl.style.transform = '';
    swipeEl.style.transition = 'transform .25s ease';
    if (dx < -40) {
      const msgId = parseInt(swipeEl.dataset.msgId);
      S.ctx.messageId = msgId;
      ctxReply();
    }
    swipeEl = null;
  }, { passive: true });
}

// Long press for context menu
let _longPressTimer = null;
document.addEventListener('touchstart', e => {
  const msgEl = e.target.closest('[data-msg-id]');
  if (msgEl && !e.target.closest('[onclick]')) {
    const touch = e.touches[0];
    _longPressTimer = setTimeout(() => {
      const msgId  = parseInt(msgEl.dataset.msgId);
      const sentAt = parseInt(msgEl.dataset.sentAt || '0');
      const isMine = parseInt(msgEl.dataset.senderId) === S.user?.id;
      showCtxMenu({ preventDefault: () => {} }, msgId, sentAt, isMine);
    }, 500);
  }
}, { passive: true });
document.addEventListener('touchmove', () => { clearTimeout(_longPressTimer); _longPressTimer = null; }, { passive: true });
document.addEventListener('touchend',  () => { clearTimeout(_longPressTimer); _longPressTimer = null; }, { passive: true });

// ── WEBSOCKET ──
function connectWS() {
  const ws = new WebSocket(`${wsProto()}://${S.server}/ws?token=${S.token}`);
  S.ws = ws;

  ws.onopen = () => {
    S.wsRetry = 0;
    loadChats();
    ws._pongOk = true;
    clearInterval(ws._hb);
    ws._hb = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!ws._pongOk) { try { ws.close(); } catch {} return; }
      ws._pongOk = false;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 20000);
    setTimeout(() => {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'set_status', status: document.hidden ? 'offline' : 'online' }));
      ws.send(JSON.stringify({ type: 'client_info', hostname: 'Mobile Web', clientVersion: 'web-m', osPlatform: navigator.platform || 'web', osRelease: /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'Web', installScope: 'web' }));
    }, 300);
  };

  ws.onmessage = async e => {
    if (ws !== S.ws) return;
    let data; try { data = JSON.parse(e.data); } catch { return; }

    if (data.type === 'pong') { ws._pongOk = true; return; }
    if (data.type === 'connected') { S.editLimit = data.edit_time_limit || 120; return; }

    if (data.type === 'message') {
      const msg = data.message;
      const chatId = msg.chat_id;
      const chat = S.chats.find(c => c.id === chatId);
      if (chat) chat.last_message = msg;
      if (S.activeChatId === chatId && !S.chatHasMoreAfter && _loadingChatId !== chatId) {
        if (msg.sender_id === S.user?.id) {
          document.querySelector('[data-optimistic="1"]')?.remove();
        }
        appendMsg(msg);
        S.chatNewestId = msg.id;
        if (S.ws?.readyState === 1) {
          S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId }));
          S.ws.send(JSON.stringify({ type: 'delivered', message_id: msg.id }));
        }
      } else if (msg.sender_id !== S.user?.id) {
        S.unread[chatId] = (S.unread[chatId] || 0) + 1;
        if (msg.mentions?.includes(S.user?.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId] || 0) + 1;
        if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'delivered', message_id: msg.id }));
      }
      updateUnreadTotal();
      renderChatList();
      if (!chat) loadChats();
      // Refresh subrooms unread
      if (S.activeRoomId) {
        const parentId = msg.parent_id;
        if (parentId === S.activeRoomId) {
          await loadSubrooms(S.activeRoomId);
          renderSubroomsList(S.activeRoomId, S.subrooms[S.activeRoomId] || []);
        }
      }
    }

    if (data.type === 'message_edited') {
      const m = data.message;
      if (m.reactions?.length) S.reactions[m.id] = m.reactions;
      const chat = S.chats.find(c => c.id === m.chat_id);
      if (chat?.last_message?.id === m.id) chat.last_message = m;
      if (S.activeChatId === m.chat_id) updateMsgInDOM(m);
      renderChatList();
    }

    if (data.type === 'message_deleted') {
      const { message_id, chat_id } = data;
      const chat = S.chats.find(c => c.id === chat_id);
      if (chat?.last_message?.id === message_id) chat.last_message = { ...chat.last_message, deleted: 1, text: '', attachment: null };
      if (S.activeChatId === chat_id) {
        const el = document.querySelector(`[data-msg-id="${message_id}"]`);
        if (el) {
          const fakeMsg = { id: message_id, deleted: 1, text: '', attachment: null, sender_id: Number(el.dataset.senderId), sender_name: '', sent_at: Number(el.dataset.sentAt), reply_to_id: null, edited_at: null, status: null, reactions: [] };
          el.outerHTML = renderMsgIRC(fakeMsg, el.classList.contains('irc-grouped'));
        }
      }
      renderChatList();
    }

    if (data.type === 'reload_chats') loadChats();

    if (data.type === 'chat_deleted') {
      S.chats = S.chats.filter(c => c.id !== data.chat_id);
      if (S.activeChatId === data.chat_id) closeChat();
      _chatRowCache.clear();
      renderChatList();
    }

    if (data.type === 'chat_read') {
      S.unread[data.chat_id] = 0;
      S.unreadMentions[data.chat_id] = 0;
      updateUnreadTotal(); renderChatList();
    }

    if (data.type === 'chat_cleared') {
      const chat = S.chats.find(c => c.id === data.chat_id);
      if (chat) { chat.last_message = null; renderChatList(); }
      if (S.activeChatId === data.chat_id) {
        S.chatHasMore = false; S.chatOldestId = null;
        const container = document.getElementById('messages');
        if (container) container.innerHTML = '';
      }
    }

    if (data.type === 'reaction_update') {
      const { message_id, counts } = data;
      S.reactions[message_id] = counts;
      if (S.activeChatId) {
        const msgEl = document.querySelector(`[data-msg-id="${message_id}"]`);
        if (msgEl) {
          const container = document.getElementById('messages');
          const atBottom = container && (container.scrollHeight - container.scrollTop - container.clientHeight < 10);
          const existing = msgEl.querySelector('.msg-reactions');
          const reactHtml = renderReactions(message_id);
          if (existing) { existing.outerHTML = reactHtml || ''; }
          else if (reactHtml) { msgEl.querySelector('.irc-content')?.insertAdjacentHTML('beforeend', reactHtml); }
          if (atBottom && container) container.scrollTop = container.scrollHeight;
        }
      }
    }

    if (data.type === 'typing') showTyping(data.chat_id, data.sender_name);

    if (data.type === 'presence') {
      S.presence[data.user_id] = data.status;
      if (data.last_seen) S.lastSeen[data.user_id] = data.last_seen;
      const activeChat = S.chats.find(c => c.id === S.activeChatId);
      if (activeChat?.type === 'direct' && getPeerUserId(activeChat) === data.user_id) {
        const sub = document.getElementById('chat-hdr-sub');
        if (sub) sub.textContent = peerStatusText(data.user_id);
      }
    }

    if (data.type === 'status_update') {
      const m = data.message;
      if (m.status) S.msgStatus[m.id] = { ...m.status };
      if (S.activeChatId === m.chat_id && m.sender_id === S.user?.id) {
        const wrap = document.querySelector(`[data-msg-id="${m.id}"] .status-wrap`);
        if (wrap) wrap.innerHTML = renderStatus(m.status);
      }
    }

    if (data.type === 'status_range') {
      if (data.chat_id === S.activeChatId) {
        const key = `${data.kind}:${data.reader_id}`;
        document.querySelectorAll('[data-msg-id]').forEach(el => {
          const id = parseInt(el.dataset.msgId);
          if (!(id >= data.min_id && id <= data.max_id)) return;
          if (parseInt(el.dataset.senderId) !== S.user?.id) return;
          const st = S.msgStatus[id]; if (!st) return;
          if (!S.statusApplied[id]) S.statusApplied[id] = new Set();
          if (S.statusApplied[id].has(key)) return;
          S.statusApplied[id].add(key);
          if (data.kind === 'read') { st.read = Math.min(st.total, st.read + 1); st.delivered = Math.max(st.delivered, st.read); }
          else { st.delivered = Math.min(st.total, st.delivered + 1); }
          const wrap = el.querySelector('.status-wrap');
          if (wrap) wrap.innerHTML = renderStatus(st);
        });
      }
    }

    if (data.type === 'chat_updated') {
      const idx = S.chats.findIndex(c => c.id === data.chat.id);
      if (idx >= 0) S.chats[idx] = data.chat; else S.chats.push(data.chat);
      _chatRowCache.delete(`chat-${data.chat.id}`);
      renderChatList();
    }

    if (data.type === 'edit_rejected') {
      if (S.editingMessageId === data.message_id) cancelEdit();
      showToast('Редактирование: вышло время');
    }

    if (data.type === 'avatar_updated') {
      S.avatarTs = Date.now();
      _avatarCache.clear();
      renderChatList();
    }

    if (data.type === 'force_logout') logout();
  };

  ws.onclose = event => {
    clearInterval(ws._hb);
    if (event.code === 1008) { logout(); return; }
    S.wsRetry++;
    if (S.token) setTimeout(connectWS, Math.min(1000 * S.wsRetry, 10000));
  };

  ws.onerror = () => ws.close();
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  S.server = window.location.host;
  const session = loadSession();
  const mobileSettings = loadMobileSettings();
  if (mobileSettings) Object.assign(S.settings, mobileSettings);
  applySettings();

  if (session?.token) {
    Object.assign(S, { token: session.token, user: session.user });
    if (session.settings) Object.assign(S.settings, session.settings);
    if (mobileSettings) Object.assign(S.settings, mobileSettings);
    applySettings();
    const ok = await Promise.race([
      api('GET', '/users/presence'),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
    if (S.token && ok !== null) enterApp();
  }

  document.getElementById('l-password')?.addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  document.getElementById('l-username')?.addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('l-password')?.focus());

  document.addEventListener('visibilitychange', () => {
    if (!S.ws || !S.token) return;
    if (!document.hidden && S.ws.readyState >= 2) connectWS();
    if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'set_status', status: document.hidden ? 'offline' : 'online' }));
    if (!document.hidden && S.activeChatId && S.ws?.readyState === 1) {
      S.ws.send(JSON.stringify({ type: 'read', chat_id: S.activeChatId }));
    }
  });
});
