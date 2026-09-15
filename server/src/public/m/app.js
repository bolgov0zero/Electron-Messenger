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
  avatarTs: 0, currentTab: 'chats', replyTo: null, editingMessageId: null, editLimit: 120,
  topics: {}, activeRoomId: null, // подкомнаты: roomId -> список тем; открытая комната с темами
  hasMoreOlder: false, // есть ли более старые сообщения, чем в _msgCache, для подгрузки при скролле вверх
};

function haptic(ms = 10) { try { navigator.vibrate?.(ms); } catch {} }

// ── МЕЛКИЕ ХЕЛПЕРЫ (те же, что в /chat/app.js) ──
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Для строк, которые подставляются внутрь JS-строкового литерала в onclick="...('...')" —
// иначе кавычка или бэкслэш в имени файла ломают атрибут (и потенциально исполняют JS).
// \' — это JS-экранирование (не HTML-сущность): браузер сперва раскодирует HTML-атрибут,
// и только потом то, что получилось, разбирает как код обработчика
const jesc = s => esc(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
  // Классы цвета аватарки (.av-N) красят фон через шорткод `background:`, а он
  // сбрасывает background-size/position на auto/0 0 — картинка вставала в
  // натуральную величину от левого верхнего угла вместо масштаба под рамку.
  // Выставляем оба свойства инлайном (сильнее шорткода), как в /chat/app.js.
  const cached = _avatarCache.get(url);
  if (cached === true) { el.style.backgroundImage = `url('${url}')`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; return; }
  if (cached === false) { el.style.backgroundImage = ''; el.textContent = fallbackText; return; }
  const img = new Image();
  img.onload = () => { _avatarCache.set(url, true); el.style.backgroundImage = `url('${url}')`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; };
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
  Object.assign(S, { token: null, user: null, chats: [], activeChatId: null, ws: null, topics: {}, activeRoomId: null });
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  closeChat(); closeSheet(); closeTopicsScreen();
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
  loadContacts();
  loadUploadSettings();
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
    .filter(c => !c.parent_id && chatName(c).toLowerCase().includes(q)) // темы комнат не входят в верхний список
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
    return `<div class="row-swipe-wrap" data-chat-id="${c.id}">
      <div class="row-actions">
        <div class="row-action mute" onclick="toggleMuteChat(${c.id})">${c.muted
          ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
          : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}
        </div>
        <div class="row-action delete" onclick="deleteChatConfirm(${c.id})">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </div>
      </div>
      <div class="row" onclick="rowTapOpen(${c.id}, this, ${c.has_topics ? 1 : 0})">
        <div class="av${sq} ${chatAvatarColorClass(c)}" data-av-chat="${c.id}">${esc(chatIcon(c))}</div>
        <div class="row-body">
          <div class="row-top"><div class="row-name">${esc(chatName(c))}</div><div class="row-time${unread ? ' unread' : ''}">${time}</div></div>
          <div class="row-bottom">
            <div class="row-msg">${esc(who)}${esc(preview)}</div>
            ${mentions ? `<div class="badge at">@</div>` : unread ? `<div class="badge">${unread > 99 ? '99+' : unread}</div>` : ''}
            ${c.has_topics ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  applyAvatars();
}

// ── СВАЙП-ДЕЙСТВИЯ НА СТРОКЕ ЧАТА ──
const ROW_ACTIONS_W = 128;
let _openRowWrap = null;
function closeOpenRow() {
  if (!_openRowWrap) return;
  const row = _openRowWrap.querySelector('.row');
  row.style.transition = 'transform .2s ease';
  row.style.transform = '';
  _openRowWrap = null;
}
function rowTapOpen(chatId, rowEl, hasTopics) {
  const wrap = rowEl.closest('.row-swipe-wrap');
  if (wrap === _openRowWrap) { closeOpenRow(); return; }
  if (hasTopics) { openRoomTopics(chatId); return; }
  openChat(chatId);
}
async function toggleMuteChat(chatId) {
  closeOpenRow();
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat) return;
  const res = await api(chat.muted ? 'DELETE' : 'POST', `/chats/${chatId}/mute`);
  if (res?.ok) { chat.muted = !chat.muted; renderChats(); }
}
function deleteChatConfirm(chatId) {
  closeOpenRow();
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat) return;
  if (chat.type === 'room') { toast('Комнатами управляют администраторы'); return; }
  openSheet(`<div class="sheet-title">Удалить чат «${esc(chatName(chat))}»?</div>
    <div class="msg-action-row danger" onclick="closeSheet();confirmDeleteChat(${chatId})">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Удалить
    </div>
    <div class="msg-action-row" onclick="closeSheet()">Отмена</div>`);
}
async function confirmDeleteChat(chatId) {
  const res = await api('POST', `/chats/${chatId}/leave`);
  if (res?.ok) { S.chats = S.chats.filter(c => c.id !== chatId); if (S.activeChatId === chatId) closeChat(); renderChats(); }
}
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('chat-list');
    let startX = 0, startY = 0, wrap = null, row = null, dirLocked = false, isSwipe = false, base = 0;
    list.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      wrap = e.target.closest('.row-swipe-wrap');
      if (!wrap) return;
      row = wrap.querySelector('.row');
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      dirLocked = false; isSwipe = false;
      base = wrap === _openRowWrap ? -ROW_ACTIONS_W : 0;
    }, { passive: true });
    list.addEventListener('touchmove', e => {
      if (!wrap) return;
      const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
      if (!dirLocked) {
        if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
        dirLocked = true; isSwipe = true;
        if (_openRowWrap && _openRowWrap !== wrap) closeOpenRow();
      }
      if (!isSwipe) return;
      e.preventDefault();
      const shift = Math.max(-ROW_ACTIONS_W, Math.min(0, base + dx));
      row.style.transition = 'none';
      row.style.transform = `translateX(${shift}px)`;
    }, { passive: false });
    list.addEventListener('touchend', e => {
      if (!wrap || !isSwipe) { wrap = null; return; }
      const dx = e.changedTouches[0].clientX - startX;
      const shift = Math.max(-ROW_ACTIONS_W, Math.min(0, base + dx));
      const open = shift < -ROW_ACTIONS_W / 2;
      row.style.transition = 'transform .2s ease';
      row.style.transform = open ? `translateX(-${ROW_ACTIONS_W}px)` : '';
      _openRowWrap = open ? wrap : null;
      wrap = null;
    }, { passive: true });
  });
})();

// ── ПОДКОМНАТЫ (темы внутри комнаты) ──
// Тема — обычный чат (свой id, свои сообщения), просто со скрытым parent_id.
// Список тем открывается вместо переписки при тапе по комнате с has_topics;
// сами темы заводятся только из админ-панели, здесь только просмотр/навигация.
// Найденные темы подмешиваются в S.chats той же формы, что и обычные чаты —
// тогда openChat/bubbleHtml/упоминания работают для них без переделок.
async function loadTopics(roomId) {
  const subs = await api('GET', `/chats/${roomId}/topics`);
  if (!subs) return;
  S.topics[roomId] = subs;
  const room = S.chats.find(c => c.id === roomId);
  subs.forEach(t => {
    const existing = S.chats.find(c => c.id === t.id);
    if (existing) {
      existing.name = t.name; existing.last_message = t.last_message;
      existing.unread = t.unread; existing.unread_mentions = t.unread_mentions;
    } else {
      S.chats.push({
        id: t.id, type: t.type || 'room', name: t.name, parent_id: roomId,
        members: room?.members || [], last_message: t.last_message,
        unread: t.unread, unread_mentions: t.unread_mentions, muted: false,
      });
    }
  });
}
async function openRoomTopics(roomId) {
  S.activeRoomId = roomId;
  const room = S.chats.find(c => c.id === roomId);
  document.getElementById('topics-name').textContent = chatName(room);
  document.getElementById('topics-list').innerHTML = '<div class="stub-note">Загрузка…</div>';
  document.getElementById('topics-screen').classList.add('open');
  await loadTopics(roomId);
  renderTopicsList();
}
function renderTopicsList() {
  const roomId = S.activeRoomId;
  const subs = S.topics[roomId] || [];
  const list = document.getElementById('topics-list');
  if (!subs.length) { list.innerHTML = '<div class="stub-note">Тем пока нет</div>'; return; }
  list.innerHTML = subs.map(s => {
    const lm = s.last_message;
    const unread = s.unread || 0;
    const mentions = s.unread_mentions || 0;
    const mine = lm && !lm.deleted && lm.sender_id === S.user.id;
    const who = mine ? 'Вы: ' : '';
    let preview = lm
      ? (lm.deleted ? 'Сообщение удалено' : (lm.text ? lm.text.replace(/<[^>]*>/g, '') : (lm.attachment
          ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл'))
          : '')))
      : 'Нет сообщений';
    if (preview.length > 40) preview = preview.slice(0, 40) + '…';
    const time = lm ? fmtChatListTime(lm.sent_at) : '';
    return `<div class="row" onclick="openChat(${s.id})">
      <div class="av sq av-3" data-av-chat="${s.id}">#</div>
      <div class="row-body">
        <div class="row-top"><div class="row-name">${esc(s.name)}</div><div class="row-time${unread ? ' unread' : ''}">${time}</div></div>
        <div class="row-bottom">
          <div class="row-msg">${esc(who)}${esc(preview)}</div>
          ${mentions ? `<div class="badge at">@</div>` : unread ? `<div class="badge">${unread > 99 ? '99+' : unread}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  applyAvatars();
}
function closeTopicsScreen() {
  document.getElementById('topics-screen').classList.remove('open');
  S.activeRoomId = null;
}
// Свайп-назад с экрана — упрощённая версия жеста из addChatGestures (только закрытие)
function addBackSwipeGesture(el, closeFn) {
  let startX = 0, startY = 0, dirLocked = false, active = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dirLocked = false; active = false;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      dirLocked = true; active = dx > 0;
    }
    if (!active) return;
    e.preventDefault();
    el.style.transition = 'none';
    el.style.transform = `translateX(${Math.min(dx, window.innerWidth)}px)`;
  }, { passive: false });
  el.addEventListener('touchend', e => {
    if (!active) return;
    const dx = e.changedTouches[0].clientX - startX;
    el.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
    if (dx > window.innerWidth * 0.35) {
      el.style.transform = `translateX(${window.innerWidth}px)`;
      setTimeout(() => { closeFn(); el.style.transform = ''; el.style.transition = ''; }, 260);
    } else {
      el.style.transform = '';
    }
    active = false;
  }, { passive: true });
}

// ── НАВИГАЦИЯ ПО ВКЛАДКАМ ──
function setTab(name) {
  S.currentTab = name;
  ['chats', 'contacts', 'settings'].forEach(t => {
    document.getElementById('tab-' + t).hidden = t !== name;
    document.querySelector(`.tab[data-tab="${t}"]`).classList.toggle('on', t === name);
  });
  if (name === 'contacts') { if (_contactsAll.length) renderContacts(); else loadContacts(); }
}

// ── КОНТАКТЫ ──
let _contactsAll = [];
async function loadContacts() {
  const users = await api('GET', '/users');
  if (!users) return;
  _contactsAll = users;
  if (S.currentTab === 'contacts') renderContacts();
}
function renderContacts() {
  const q = (document.getElementById('contact-search').value || '').trim().toLowerCase();
  const list = document.getElementById('contact-list');
  const filtered = _contactsAll.filter(u => u.display_name.toLowerCase().includes(q));
  if (!filtered.length) { list.innerHTML = `<div class="stub-note">${_contactsAll.length ? 'Никого не нашли' : 'В организации больше никого нет'}</div>`; return; }
  list.innerHTML = filtered.map(u => `
    <div class="row" onclick="openContactChat(${u.id})">
      <div class="av ${userAvatarColor(u.id, u.tag)}" data-av-user="${u.id}" data-av-fallback="${esc(initials(u.display_name))}">${esc(initials(u.display_name))}</div>
      <div class="row-body">
        <div class="row-top"><div class="row-name">${esc(u.display_name)}</div></div>
        <div class="row-bottom"><div class="row-msg">@${esc(u.username)}</div></div>
      </div>
    </div>`).join('');
  applyAvatars();
}
async function openContactChat(userId) {
  const chat = await api('POST', '/chats/direct', { user_id: userId });
  if (!chat || chat.error) { toast('Не удалось открыть чат'); return; }
  if (!S.chats.find(c => c.id === chat.id)) S.chats.push(chat);
  setTab('chats');
  renderChats();
  openChat(chat.id);
}

// ── СОЗДАНИЕ ГРУППЫ ──
let _groupSelected = new Set();
let _groupAvatarBase64 = null;
async function openCreateGroupSheet() {
  _groupSelected = new Set();
  _groupAvatarBase64 = null;
  if (!_contactsAll.length) await loadContacts();
  openSheet(`
    <div class="sheet-title">Новая группа</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div class="av av-default sq" id="group-av-preview" style="width:52px;height:52px;font-size:18px;cursor:pointer;flex-shrink:0" onclick="document.getElementById('group-avatar-input').click()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </div>
      <div style="font-size:12.5px;color:var(--accent);cursor:pointer" onclick="document.getElementById('group-avatar-input').click()">Фото группы</div>
      <input type="file" id="group-avatar-input" accept="image/*" style="display:none" onchange="onGroupAvatarPicked(this)">
    </div>
    <input class="sheet-input" id="group-name" placeholder="Название группы" maxlength="60">
    <input class="sheet-input" id="group-search" placeholder="Поиск участников" oninput="renderGroupPickList(this.value)">
    <div class="pick-list" id="pick-list"></div>
    <button class="l-btn" style="width:100%;margin-top:6px" onclick="submitCreateGroup()">Создать</button>
  `);
  renderGroupPickList('');
}
async function onGroupAvatarPicked(input) {
  const file = input.files[0];
  if (!file) return;
  _groupAvatarBase64 = await resizeAvatarFile(file);
  const prev = document.getElementById('group-av-preview');
  prev.innerHTML = '';
  prev.style.backgroundImage = `url(data:image/jpeg;base64,${_groupAvatarBase64})`;
  prev.style.backgroundSize = 'cover';
  prev.style.backgroundPosition = 'center';
}
function renderGroupPickList(q) {
  const filtered = _contactsAll.filter(u => u.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  document.getElementById('pick-list').innerHTML = filtered.map(u => `
    <div class="pick-row" onclick="toggleGroupMember(${u.id})">
      <div class="av ${userAvatarColor(u.id, u.tag)}" data-av-user="${u.id}" data-av-fallback="${esc(initials(u.display_name))}">${esc(initials(u.display_name))}</div>
      <div class="pick-name">${esc(u.display_name)}</div>
      <div class="pick-check${_groupSelected.has(u.id) ? ' on' : ''}"></div>
    </div>`).join('') || '<div class="stub-note">Никого не нашли</div>';
  applyAvatars();
}
function toggleGroupMember(id) {
  if (_groupSelected.has(id)) _groupSelected.delete(id); else _groupSelected.add(id);
  renderGroupPickList(document.getElementById('group-search').value);
}
async function submitCreateGroup() {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { toast('Введите название группы'); return; }
  if (_groupSelected.size === 0) { toast('Выберите хотя бы одного участника'); return; }
  const chat = await api('POST', '/chats/group', { name, member_ids: [..._groupSelected] });
  if (!chat || chat.error) { toast('Не удалось создать группу'); return; }
  if (_groupAvatarBase64) await api('POST', `/chats/${chat.id}/avatar`, { data: _groupAvatarBase64 });
  S.chats.push(chat);
  closeSheet();
  setTab('chats');
  renderChats();
  openChat(chat.id);
}

// ── ПРОФИЛЬ / ВНЕШНИЙ ВИД ──
function openProfileSheet() {
  openSheet(`
    <div class="sheet-title">Профиль</div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:16px">
      <div class="av" id="profile-av-big" style="width:84px;height:84px;font-size:28px;cursor:pointer" onclick="document.getElementById('avatar-file-input').click()"></div>
      <div style="font-size:12.5px;color:var(--accent);cursor:pointer" onclick="document.getElementById('avatar-file-input').click()">Изменить фото</div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="onAvatarPicked(this)">
    </div>
    <input class="sheet-input" id="profile-name-input" value="${esc(S.user.display_name)}" maxlength="40">
    <button class="l-btn" style="width:100%;margin-top:6px" onclick="saveProfileName()">Сохранить</button>
  `);
  const bigAv = document.getElementById('profile-av-big');
  bigAv.className = 'av ' + userAvatarColor(S.user.id, S.user.tag);
  bigAv.dataset.avUser = S.user.id;
  bigAv.dataset.avFallback = initials(S.user.display_name);
  bigAv.textContent = initials(S.user.display_name);
  applyAvatars();
}
async function saveProfileName() {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) { toast('Введите имя'); return; }
  if (name === S.user.display_name) { closeSheet(); return; }
  const res = await api('PATCH', '/users/me', { display_name: name });
  if (res?.ok) {
    S.user.display_name = name;
    saveSession();
    document.getElementById('me-name').textContent = name;
    closeSheet();
    toast('Имя обновлено');
  } else toast('Не удалось сохранить');
}
function resizeAvatarFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
async function onAvatarPicked(input) {
  const file = input.files[0];
  if (!file) return;
  const base64 = await resizeAvatarFile(file);
  const res = await api('POST', '/users/me/avatar', { data: base64 });
  if (res?.ok) {
    S.avatarTs = Date.now();
    _avatarCache.clear();
    applyAvatars();
    toast('Фото обновлено');
  } else toast('Не удалось загрузить фото');
}
const _checkIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// Настройки внешнего вида, которые живут на устройстве (не в аккаунте):
// тема и через общий ключ SESSION_KEY.settings — как раньше; акцент и узор/фон
// переписки — через отдельные ключи localStorage, ТЕ ЖЕ, что у /chat, поэтому
// выбор синхронен между /chat и /m на одном браузере.
function saveLocalSetting(key, value) {
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch {}
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, settings: { ...(prev.settings || {}), [key]: value } }));
}
function loadLocalSettings() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY))?.settings || {}; } catch { return {}; }
}

// ── ЦВЕТОВОЙ АКЦЕНТ (общий с /chat — ключ localStorage 'accent') ──
const ACCENTS = {
  teal:   { name: 'Бирюзовый', light: [29, 168, 140], dark: [41, 214, 184] },
  blue:   { name: 'Синий',     light: [37, 118, 199], dark: [96, 170, 245] },
  indigo: { name: 'Индиго',    light: [92, 96, 205],  dark: [143, 148, 245] },
  plum:   { name: 'Сливовый',  light: [146, 84, 190], dark: [196, 146, 240] },
  amber:  { name: 'Янтарный',  light: [186, 120, 38], dark: [236, 176, 92] },
};
function currentAccent() {
  try { const v = localStorage.getItem('accent'); if (ACCENTS[v]) return v; } catch {}
  return 'teal';
}
function accentRgb(a) { return document.documentElement.classList.contains('dark') ? a.dark : a.light; }
function applyAccent() {
  const c = accentRgb(ACCENTS[currentAccent()]);
  const hex = arr => '#' + arr.map(v => v.toString(16).padStart(2, '0')).join('');
  const s = document.documentElement.style;
  s.setProperty('--accent', hex(c));
  s.setProperty('--accent-rgb', c.join(','));
  s.setProperty('--accent-soft', `rgba(${c.join(',')},0.10)`);
}
function setAccent(key) {
  if (!ACCENTS[key]) return;
  try { localStorage.setItem('accent', key); } catch {}
  applyAccent();
  document.querySelectorAll('.accent-dot').forEach(b => b.classList.toggle('active', b.dataset.accent === key));
}
function accentDotsHtml() {
  const cur = currentAccent();
  return Object.entries(ACCENTS).map(([k, a]) =>
    `<button class="accent-dot${k === cur ? ' active' : ''}" data-accent="${k}" title="${esc(a.name)}" aria-label="${esc(a.name)}" style="--dot:rgb(${accentRgb(a).join(',')})" onclick="setAccent('${k}')"></button>`).join('');
}

// ── УЗОР ФОНА ПЕРЕПИСКИ (общий с /chat — те же файлы assets/patterns и ключи localStorage) ──
const PATTERNS = [
  { id: '',          name: 'Без узора' },
  { id: 'pets',      name: 'Питомцы' },
  { id: 'doodles',   name: 'Каракули' },
  { id: 'summer',    name: 'Лето' },
  { id: 'daily',     name: 'Будни' },
  { id: 'steampunk', name: 'Стимпанк' },
];
const PATTERN_TILE = 680;
const PATTERN_ALPHA = { light: [0.045, 0.07, 0.105], dark: [0.055, 0.085, 0.13] };
function currentPattern() {
  try { const v = localStorage.getItem('chatPattern'); if (PATTERNS.some(p => p.id === v && v)) return v; } catch {}
  return '';
}
function currentPatternLevel() {
  const n = Number(localStorage.getItem('chatPatternLevel'));
  return n === 1 || n === 3 ? n : 2;
}
function patternUrl(id) { return id ? `url("/chat/assets/patterns/${id}.png")` : ''; }
function applyChatPattern() {
  const id = currentPattern();
  const s = document.documentElement.style;
  if (!id) {
    s.removeProperty('--chat-pattern'); s.removeProperty('--chat-pattern-size');
    s.removeProperty('--chat-pattern-ink'); s.removeProperty('--chat-pattern-alpha');
    return;
  }
  const dark = document.documentElement.classList.contains('dark');
  s.setProperty('--chat-pattern', patternUrl(id));
  s.setProperty('--chat-pattern-size', PATTERN_TILE + 'px');
  s.setProperty('--chat-pattern-ink', dark ? '#ffffff' : '#111318');
  s.setProperty('--chat-pattern-alpha', String(PATTERN_ALPHA[dark ? 'dark' : 'light'][currentPatternLevel() - 1]));
}
function setChatPattern(id) {
  try { localStorage.setItem('chatPattern', id || ''); } catch {}
  applyChatPattern();
  refreshAppearanceSheet();
}
function setPatternLevel(n) {
  try { localStorage.setItem('chatPatternLevel', String(n)); } catch {}
  applyChatPattern();
  refreshAppearanceSheet();
}
function chatPatternCardsHtml() {
  const cur = currentPattern();
  return `<div class="pat-cards" id="pattern-cards">${PATTERNS.map(p =>
    `<button class="pat-card${p.id === cur ? ' active' : ''}" data-pattern="${p.id}" onclick="setChatPattern('${p.id}')">
      <span class="pat-swatch"></span><span class="pat-cap">${esc(p.name)}</span>
    </button>`).join('')}</div>`;
}
function paintPatternSwatches() {
  document.querySelectorAll('#pattern-cards .pat-card').forEach(card => {
    const el = card.querySelector('.pat-swatch');
    const url = patternUrl(card.dataset.pattern) || 'none';
    el.style.webkitMaskImage = url; el.style.maskImage = url;
  });
}

// ── ФОН ПЕРЕПИСКИ (общий с /chat — ключ localStorage 'chatBg') ──
function currentChatBg() {
  try { return localStorage.getItem('chatBg') === 'split' ? 'split' : 'plain'; } catch { return 'plain'; }
}
function setChatBg(mode) {
  try { localStorage.setItem('chatBg', mode === 'split' ? 'split' : 'plain'); } catch {}
  applyChatBg();
  document.querySelectorAll('#chatbg-cards .bg-card').forEach(c => c.classList.toggle('active', c.dataset.bg === currentChatBg()));
}
function applyChatBg() {
  const s = document.documentElement.style;
  if (currentChatBg() === 'split') s.setProperty('--chat-bg', 'var(--chat-split)');
  else s.removeProperty('--chat-bg');
}
function chatBgCardsHtml() {
  const cur = currentChatBg();
  const skel = split => `<span class="bg-skel${split ? ' split' : ''}"><i class="a"></i><i class="b"></i><i class="c"></i></span>`;
  const card = (mode, title) => `<button class="bg-card${cur === mode ? ' active' : ''}" data-bg="${mode}" onclick="setChatBg('${mode}')">
      ${skel(mode === 'split')}<span class="bg-cap">${title}</span>
    </button>`;
  return `<div class="bg-cards" id="chatbg-cards">${card('plain', 'Как обычно')}${card('split', 'С разделением')}</div>`;
}

// ── РАЗМЕР ТЕКСТА СООБЩЕНИЙ (общая сессия — SESSION_KEY.settings.fontSize) ──
function applyFontSize() {
  const f = loadLocalSettings().fontSize || 'medium';
  document.documentElement.classList.remove('font-small', 'font-medium', 'font-large');
  document.documentElement.classList.add('font-' + f);
}
function setFontSize(f) {
  saveLocalSetting('fontSize', f);
  applyFontSize();
  refreshAppearanceSheet();
}

// ── МАСШТАБ ИНТЕРФЕЙСА (общая сессия — SESSION_KEY.settings.uiScale) ──
function applyUiScale() {
  const scale = loadLocalSettings().uiScale || 100;
  const ratio = scale / 100;
  const s = document.documentElement.style;
  s.setProperty('--ui-scale', ratio);
  s.setProperty('--vh100', ratio === 1 ? '100dvh' : `calc(100dvh / ${ratio})`);
  s.setProperty('--vw100', ratio === 1 ? '100vw' : `calc(100vw / ${ratio})`);
  // transform ставим инлайном и только когда масштаб реально не 100% — иначе на
  // подавляющем большинстве телефонов (масштаб не трогали) body всегда сидел бы
  // в лишнем composited-слое, слегка размывая текст (transform:scale(1) — не noop
  // для рендерера, а полноценная GPU-прослойка)
  document.body.style.transform = ratio === 1 ? '' : `scale(${ratio})`;
}
function setUiScale(scale) {
  saveLocalSetting('uiScale', scale);
  applyUiScale();
  refreshAppearanceSheet();
}
function applyAppearance() { applyAccent(); applyChatPattern(); applyChatBg(); applyFontSize(); applyUiScale(); }

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  saveLocalSetting('theme', theme);
  applyAppearance(); // акцент и узор зависят от темы (свои оттенки на тёмной/светлой)
  applyThemeColorMeta();
  refreshAppearanceSheet();
}
// Цвет системной навигационной панели/статус-бара — как у таб-бара и шторок
// (--modal-bg), а не у фона экранов, иначе виден шов другого оттенка у края
function applyThemeColorMeta() {
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = document.documentElement.classList.contains('dark') ? '#181c20' : '#ffffff';
}

function appearanceSheetHtml() {
  const isDark = document.documentElement.classList.contains('dark');
  const f = loadLocalSettings().fontSize || 'medium';
  const scale = loadLocalSettings().uiScale || 100;
  const fontSeg = [['small', 'A'], ['medium', 'A'], ['large', 'A']];
  const scaleSeg = [80, 90, 100, 110];
  return `
    <div class="sheet-title">Внешний вид</div>
    <div class="settings-row" onclick="setTheme('light')" style="cursor:pointer">
      <div class="settings-label">Светлая тема</div>${!isDark ? _checkIcon : ''}
    </div>
    <div class="settings-row" onclick="setTheme('dark')" style="cursor:pointer">
      <div class="settings-label">Тёмная тема</div>${isDark ? _checkIcon : ''}
    </div>
    <div class="set-block">
      <div class="set-block-title">Цветовой акцент</div>
      <div class="accent-row">${accentDotsHtml()}</div>
    </div>
    <div class="set-block">
      <div class="set-block-title">Фон переписки</div>
      ${chatBgCardsHtml()}
    </div>
    <div class="set-block">
      <div class="set-block-title">Узор переписки</div>
      ${chatPatternCardsHtml()}
      ${currentPattern() ? `<div class="set-seg" style="margin-top:6px">${[[1, 'Слабая'], [2, 'Средняя'], [3, 'Сильная']].map(([n, label]) =>
        `<button class="${currentPatternLevel() === n ? 'active' : ''}" onclick="setPatternLevel(${n})">${label}</button>`).join('')}</div>` : ''}
    </div>
    <div class="set-block">
      <div class="set-block-title">Размер текста сообщений</div>
      <div class="set-seg">${fontSeg.map(([v, label], i) =>
        `<button class="${f === v ? 'active' : ''}" style="font-size:${13 + i * 3}px" onclick="setFontSize('${v}')">${label}</button>`).join('')}</div>
    </div>
    <div class="set-block">
      <div class="set-block-title">Масштаб интерфейса</div>
      <div class="set-seg">${scaleSeg.map(v =>
        `<button class="${scale === v ? 'active' : ''}" onclick="setUiScale(${v})">${v}%</button>`).join('')}</div>
    </div>
  `;
}
function openAppearanceSheet() {
  openSheet(appearanceSheetHtml());
  paintPatternSwatches();
}
function refreshAppearanceSheet() {
  if (!document.getElementById('sheet-bg').classList.contains('open')) return;
  openSheet(appearanceSheetHtml());
  paintPatternSwatches();
}

// ── ПЕРЕПИСКА ──
let _msgCache = []; // сообщения открытого чата, в порядке отображения

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}
function attachmentHtml(att) {
  if (!att) return '';
  const url = `${httpProto()}://${S.server}${att.url}`;
  if (att.expired) return `<div class="bubble-file"><div class="bubble-file-ico">✕</div><div><div class="bubble-file-name">Файл удалён</div></div></div>`;
  if (att.mime?.startsWith('image/')) {
    return `<img class="bubble-media" src="${url}" loading="lazy" onclick="event.stopPropagation();openLightbox('${esc(att.url)}','image')">`;
  }
  if (att.mime?.startsWith('video/')) {
    const poster = att.thumb ? `${httpProto()}://${S.server}${att.thumb}` : '';
    return `<div class="bubble-video-wrap" onclick="event.stopPropagation();openLightbox('${esc(att.url)}','video')">
      ${poster ? `<img class="bubble-media" src="${poster}" loading="lazy">` : `<div class="bubble-media" style="width:180px;height:120px;background:var(--search-bg)"></div>`}
      <div class="bubble-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
    </div>`;
  }
  return `<div class="bubble-file" onclick="event.stopPropagation();downloadAttachment('${jesc(att.url)}','${jesc(att.name || 'file')}')">
    <div class="bubble-file-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
    <div><div class="bubble-file-name">${esc(att.name || 'Файл')}</div><div class="bubble-file-size">${fmtSize(att.size)}</div></div>
  </div>`;
}
function reactionsHtml(m) {
  if (!m.reactions?.length) return '';
  return `<div class="bubble-reactions">${m.reactions.map(r => {
    const mine = String(r.user_ids || '').split(',').map(Number).includes(S.user.id);
    return `<div class="reaction-pill${mine ? ' mine' : ''}" onclick="event.stopPropagation();sendReaction(${m.id},'${r.reaction}')">${r.reaction}<b>${r.count}</b></div>`;
  }).join('')}</div>`;
}
// Сообщение из одних смайликов — крупнее и без пузыря, как в /chat и в клиенте
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s)+$/u;
function isEmojiOnly(text) {
  const t = (text || '').trim();
  if (!t) return false;
  try { return EMOJI_ONLY_RE.test(t) && /\p{Extended_Pictographic}/u.test(t); } catch { return false; }
}
function bubbleHtml(m, chat) {
  const mine = m.sender_id === S.user.id;
  if (m.deleted) return `<div class="bubble ${mine ? 'out' : 'in'}" data-msg-id="${m.id}" data-mine="${mine ? 1 : 0}"><span class="bubble-deleted">Сообщение удалено</span></div>`;
  const isGroupish = chat && (chat.type === 'group' || chat.type === 'room');
  const showSender = isGroupish && !mine;
  const emojiOnly = !m.attachment && !m.reply_to_id && isEmojiOnly(m.text);
  const text = m.text ? `<span class="bubble-text${emojiOnly ? ' emoji-only' : ''}">${highlightMentions(esc(m.text))}</span>` : '';
  const quote = m.reply_to_id ? `<div class="bubble-quote">
    <div class="bubble-quote-name">${esc(m.reply_sender_name || '')}</div>
    <div class="bubble-quote-text">${m.reply_deleted ? 'Сообщение удалено' : esc(m.reply_text || '')}</div>
  </div>` : '';
  const senderLine = showSender ? `<div class="bubble-sender ${userAvatarColor(m.sender_id, m.sender_tag).replace(/^av-/, 'mtag-')}" data-sender-id="${m.sender_id}" data-sender-name="${esc(m.sender_name || '')}" onclick="event.stopPropagation();mentionUserInComposer(Number(this.dataset.senderId),this.dataset.senderName)">${esc(m.sender_name || '')}</div>` : '';
  const bubble = `<div class="bubble ${mine ? 'out' : 'in'}${emojiOnly ? ' emoji-msg' : ''}" data-msg-id="${m.id}" data-mine="${mine ? 1 : 0}">
    ${senderLine}${quote}${attachmentHtml(m.attachment)}${text}
    <div class="bubble-meta">${m.edited_at ? 'изм. ' : ''}${fmtTime(m.sent_at)}${mine ? renderTicks(m.status) : ''}</div>
    ${reactionsHtml(m)}
  </div>`;
  if (!showSender) return bubble;
  return `<div class="msg-row">
    <div class="av msg-av ${userAvatarColor(m.sender_id, m.sender_tag)}" data-av-user="${m.sender_id}" data-av-fallback="${esc(initials(m.sender_name || ''))}">${esc(initials(m.sender_name || ''))}</div>
    ${bubble}
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

function renderMessages(keepScroll) {
  const container = document.getElementById('messages');
  const chat = S.chats.find(c => c.id === S.activeChatId);
  let html = '', lastDay = '';
  for (const m of _msgCache) {
    const day = new Date(m.sent_at * 1000).toDateString();
    if (day !== lastDay) { html += `<div class="day-sep">${new Date(m.sent_at * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>`; lastDay = day; }
    html += bubbleHtml(m, chat);
  }
  // При подгрузке старых сообщений сохраняем то же место в ленте (иначе вставка
  // сверху выталкивает видимую часть вниз или наверх — контент под пальцем прыгает)
  const prevHeight = keepScroll ? container.scrollHeight : 0;
  const prevTop = keepScroll ? container.scrollTop : 0;
  container.innerHTML = html || '<div class="stub-note">Сообщений пока нет</div>';
  container.scrollTop = keepScroll ? prevTop + (container.scrollHeight - prevHeight) : container.scrollHeight;
  applyAvatars();
  stickAfterMedia(container);
}
// ── ПОДГРУЗКА СТАРЫХ СООБЩЕНИЙ ПРИ СКРОЛЛЕ ВВЕРХ ──
let _loadingOlder = false;
async function maybeLoadOlderMessages() {
  const container = document.getElementById('messages');
  if (!container || !S.activeChatId || !S.hasMoreOlder || _loadingOlder) return;
  if (container.scrollTop > 60) return;
  const chatId = S.activeChatId;
  const oldest = _msgCache[0];
  if (!oldest) return;
  _loadingOlder = true;
  const data = await api('GET', `/messages/chat/${chatId}?limit=50&before=${oldest.id}`);
  _loadingOlder = false;
  if (!data || S.activeChatId !== chatId) return;
  S.hasMoreOlder = !!data.hasMore;
  if (!data.messages?.length) return;
  _msgCache = [...data.messages, ..._msgCache];
  renderMessages(true);
}
// Картинка/видео в последнем сообщении получает реальную высоту уже ПОСЛЕ layout —
// scrollTop=scrollHeight, выставленный до этого, не учитывает выросшую высоту, и
// сообщение с вложением частично уезжает за композер. Докручиваем ещё раз, когда
// вложение действительно загрузится (или откажет).
function stickAfterMedia(container) {
  const onLoad = () => { container.scrollTop = container.scrollHeight; };
  container.querySelectorAll('img, video').forEach(el => {
    if (el.tagName === 'IMG' && el.complete) return;
    el.addEventListener('load', onLoad, { once: true });
    el.addEventListener('loadedmetadata', onLoad, { once: true });
    el.addEventListener('error', onLoad, { once: true });
  });
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
  S.hasMoreOlder = !!data.hasMore;
  renderMessages();
  applyAvatars();
  chat.unread = 0; chat.unread_mentions = 0;
  if (chat.parent_id) {
    // Тема живёт ещё и в S.topics[roomId] — отдельном массиве для списка тем
    const topic = S.topics[chat.parent_id]?.find(t => t.id === chatId);
    if (topic) { topic.unread = 0; topic.unread_mentions = 0; }
    if (S.activeRoomId === chat.parent_id) renderTopicsList();
  }
  renderChats();
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId }));
}

function closeChat() {
  S.activeChatId = null;
  const el = document.getElementById('chat-screen');
  el.classList.remove('open');
  el.style.transform = ''; el.style.transition = ''; // сброс инлайна после свайпа-назад
  _msgCache = [];
  S.hasMoreOlder = false;
  hideReplyBar();
  const panel = document.getElementById('emoji-panel');
  if (panel) panel.style.display = 'none';
}

// ── ОТВЕТ НА СООБЩЕНИЕ ──
function findMsg(id) { return _msgCache.find(m => m.id === id); }

// ── УПОМИНАНИЯ (@Имя) ──
function _mentionMembers(includeSelf = false) {
  const chat = S.chats.find(c => c.id === S.activeChatId);
  if (!['group', 'room', 'direct'].includes(chat?.type)) return null;
  const members = chat.members || [];
  return includeSelf ? members : members.filter(m => m.id !== S.user.id);
}
function highlightMentions(escapedText) {
  const members = _mentionMembers(true);
  if (!members?.length) return escapedText;
  const byName = new Map();
  for (const m of members) {
    const dn = esc(m.display_name || '');
    if (dn && !byName.has(dn)) byName.set(dn, m);
    const un = esc(m.username || '');
    if (un && !byName.has(un)) byName.set(un, m);
  }
  if (!byName.size) return escapedText;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp('@(' + names.join('|') + ')(?![\\wа-яёА-ЯЁ])', 'g');
  return escapedText.replace(re, (match, name) => {
    const m = byName.get(name);
    const cls = userAvatarColor(m.id, m.tag).replace(/^av-/, 'mtag-');
    return `<span class="mention ${cls}">@${name}</span>`;
  });
}
function mentionUserInComposer(senderId, senderName) {
  const el = document.getElementById('msg-input');
  const name = senderId === S.user.id ? S.user.display_name : senderName;
  if (!el || !name) return;
  const cursor = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, cursor);
  const after = el.value.slice(cursor);
  const needsSpace = before && !/\s$/.test(before);
  const insertion = (needsSpace ? ' ' : '') + '@' + name + ' ';
  el.value = before + insertion + after;
  const newPos = before.length + insertion.length;
  el.selectionStart = el.selectionEnd = newPos;
  el.focus();
}

function setReply(msgId) {
  const m = findMsg(msgId);
  if (!m || m.deleted) return;
  const mine = m.sender_id === S.user.id;
  const text = m.text || (m.attachment ? '📎 ' + (m.attachment.name || 'Вложение') : '');
  S.replyTo = { id: msgId, text: text.slice(0, 100), senderName: mine ? S.user.display_name : (m.sender_name || '') };
  showReplyBar();
}
// Полоса ответа/вложения/редактирования растёт над композером и отъедает
// высоту у списка сообщений (флекс-колонка) — без пересчёта scrollTop последнее
// сообщение оказывалось за композером, будто исчезало (тот же баг чинили
// в /chat и в клиенте: sticky scroll при появлении preview-bar вложения)
function stickMessagesToBottom() {
  const el = document.getElementById('messages');
  if (el) el.scrollTop = el.scrollHeight;
}
function showReplyBar() {
  if (!S.replyTo) return;
  document.getElementById('reply-bar-name').textContent = S.replyTo.senderName;
  document.getElementById('reply-bar-text').textContent = S.replyTo.text;
  document.getElementById('reply-bar').style.display = '';
  document.getElementById('msg-input').focus();
  stickMessagesToBottom();
}
function hideReplyBar() {
  S.replyTo = null;
  const bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
}

// ── ВЛОЖЕНИЯ ──
let _pendingAttachment = null;
let _uploadSettings = {
  image: { maxSizeMb: 10, extensions: ['jpeg', 'jpg', 'png', 'gif', 'webp'] },
  video: { maxSizeMb: 50, extensions: ['mp4', 'mov', 'webm'] },
  file: { maxSizeMb: 50, extensions: [] },
};
async function loadUploadSettings() {
  const res = await api('GET', '/upload/settings');
  if (res && !res.error) _uploadSettings = res;
}
async function onFilePicked(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const cfg = isImage ? _uploadSettings.image : isVideo ? _uploadSettings.video : _uploadSettings.file;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.size > cfg.maxSizeMb * 1024 * 1024) { toast(`Файл слишком большой (макс. ${cfg.maxSizeMb} МБ)`); return; }
  if (cfg.extensions.length > 0 && !cfg.extensions.includes(ext)) { toast(`Расширение .${ext} не разрешено`); return; }
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${S.token}` }, body: formData,
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); toast(err.error || 'Ошибка загрузки'); return; }
    _pendingAttachment = await res.json();
    showAttachBar();
  } catch { toast('Ошибка загрузки'); }
}
function showAttachBar() {
  if (!_pendingAttachment) return;
  const att = _pendingAttachment;
  const bar = document.getElementById('attach-bar');
  const thumb = document.getElementById('attach-thumb');
  const fileIco = document.getElementById('attach-file-ico');
  if (att.mime?.startsWith('image/')) {
    thumb.src = `${httpProto()}://${S.server}${att.url}`; thumb.style.display = '';
    fileIco.style.display = 'none';
  } else if (att.mime?.startsWith('video/') && att.thumb) {
    thumb.src = `${httpProto()}://${S.server}${att.thumb}`; thumb.style.display = '';
    fileIco.style.display = 'none';
  } else {
    thumb.style.display = 'none'; fileIco.style.display = '';
  }
  document.getElementById('attach-name').textContent = att.name || 'Файл';
  bar.style.display = '';
  stickMessagesToBottom();
}
function clearAttachment() {
  _pendingAttachment = null;
  const bar = document.getElementById('attach-bar');
  if (bar) bar.style.display = 'none';
}
function downloadAttachment(url, name) {
  const a = document.createElement('a');
  a.href = `${httpProto()}://${S.server}${url}`;
  a.download = name;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── ПРОСМОТР ФОТО/ВИДЕО ──
function openLightbox(url, type) {
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const vid = document.getElementById('lightbox-vid');
  box.classList.toggle('video', type === 'video');
  if (type === 'video') {
    img.src = ''; vid.src = `${httpProto()}://${S.server}${url}`;
    vid.play().catch(() => {});
  } else {
    vid.pause(); vid.src = '';
    img.src = `${httpProto()}://${S.server}${url}`;
  }
  box.classList.add('open');
}
function closeLightbox() {
  const box = document.getElementById('lightbox');
  box.classList.remove('open', 'video');
  document.getElementById('lightbox-vid').pause();
  document.getElementById('lightbox-img').src = '';
  document.getElementById('lightbox-vid').src = '';
}

// ── ЭМОДЗИ (панель по разделам — общая для композера и выбора реакции) ──
// EMOJI_GROUPS/EMOJI_KEYWORDS грузятся из общего статического /chat/emoji-data.js
// (та же таблица, что у /chat, без дублирования ~190КБ данных).
const EP_COLS = 7;
const EMOJIS_DEFAULT_FREQ = ['👍', '❤️', '😂', '🔥', '😎', '🎉', '😭', '🤔'];
function getEmojiFreq() { try { return JSON.parse(localStorage.getItem('emoji_freq') || '{}'); } catch { return {}; } }
function trackEmojiUse(em) { const f = getEmojiFreq(); f[em] = (f[em] || 0) + 1; try { localStorage.setItem('emoji_freq', JSON.stringify(f)); } catch {} }
function getFreqEmojis(n) {
  const f = getEmojiFreq();
  const sorted = Object.entries(f).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  for (const em of EMOJIS_DEFAULT_FREQ) { if (sorted.length >= n) break; if (!sorted.includes(em)) sorted.push(em); }
  return sorted.slice(0, n);
}
function emojiSections() {
  return [{ key: 'freq', icon: '🕘', name: 'Часто используемые', items: getFreqEmojis(21) }, ...EMOJI_GROUPS];
}
function emojiSectionHtml(g, pickFn) {
  const h = Math.ceil(g.items.length / EP_COLS) * 42;
  return `<div class="ep-head" data-head="${g.key}">${esc(g.name)}</div>
    <div class="ep-row" data-row="${g.key}" style="contain-intrinsic-size:auto ${h}px">
      ${g.items.map(em => `<button class="emoji-item" data-em="${em}" onclick="${pickFn}('${em}')">${em}</button>`).join('')}
    </div>`;
}
let _epStatic = null;
function emojiPickerCached(pickFn) {
  if (_epStatic === null) _epStatic = EMOJI_GROUPS.map(g => emojiSectionHtml(g, pickFn)).join('');
  return emojiSectionHtml(emojiSections()[0], pickFn) + _epStatic;
}
function emojiTabsHtml(pickFn, scrollId) {
  return emojiSections().map((g, i) => `<button class="ep-tab" data-tab="${g.key}" title="${esc(g.name)}" aria-selected="${i === 0}" onclick="emojiTabTo('${g.key}','${scrollId}')">${g.icon}</button>`).join('');
}
function emojiTabTo(key, scrollId) {
  const scroll = document.getElementById(scrollId);
  const row = scroll?.querySelector(`[data-row="${key}"]`);
  const head = scroll?.querySelector(`[data-head="${key}"]`);
  if (!row) return;
  const delta = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (head?.offsetHeight || 0);
  scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'smooth' });
}
function syncEmojiTabs(scrollId, tabsId) {
  const scroll = document.getElementById(scrollId);
  if (!scroll) return;
  const top = scroll.getBoundingClientRect().top;
  let cur = null, first = null, last = null;
  scroll.querySelectorAll('[data-row]').forEach(row => {
    if (row.hidden) return;
    if (!first) first = row.dataset.row;
    last = row.dataset.row;
    if (row.getBoundingClientRect().top - top <= 30) cur = row.dataset.row;
  });
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4) cur = last;
  cur = cur || first;
  document.querySelectorAll('#' + tabsId + ' .ep-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === cur)));
}
function filterEmoji(q, scrollId, tabsId, pickFn) {
  const scroll = document.getElementById(scrollId);
  if (!scroll) return;
  const query = (q || '').trim().toLowerCase();
  if (!query) {
    scroll.innerHTML = emojiPickerCached(pickFn);
    scroll.dataset.freq = emojiSections()[0].items.join('');
    scroll.scrollTop = 0;
    syncEmojiTabs(scrollId, tabsId);
    return;
  }
  const seen = new Set(), hits = [];
  EMOJI_GROUPS.forEach(g => {
    const groupHit = g.name.toLowerCase().includes(query);
    g.items.forEach(em => {
      if (seen.has(em)) return;
      const words = (EMOJI_KEYWORDS[em] || '').split(' ');
      let score = 0;
      if (words.includes(query)) score = 3;
      else if (words.some(w => w.startsWith(query))) score = 2;
      else if (groupHit) score = 1.5;
      else if (words.some(w => w.includes(query))) score = 1;
      if (score) { seen.add(em); hits.push({ em, score }); }
    });
  });
  hits.sort((a, b) => b.score - a.score);
  delete scroll.dataset.freq;
  scroll.innerHTML = hits.length
    ? `<div class="ep-head">Найдено: ${hits.length}</div><div class="ep-row">${hits.map(h => `<button class="emoji-item" data-em="${h.em}" onclick="${pickFn}('${h.em}')">${h.em}</button>`).join('')}</div>`
    : `<div class="ep-miss">Ничего не нашлось</div>`;
  scroll.scrollTop = 0;
  document.querySelectorAll('#' + tabsId + ' .ep-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
}

// Панель в композере — вставка смайла в поле ввода, без закрытия панели
let _emojiInserting = false;
function insertEmoji(em) {
  trackEmojiUse(em);
  const input = document.getElementById('msg-input');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + em + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + em.length;
  _emojiInserting = true;
  input.focus();
  _emojiInserting = false;
}
function toggleEmojiPanel() {
  const panel = document.getElementById('emoji-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { closeEmojiPanel(); return; }
  const tabs = document.getElementById('ep-tabs');
  const scroll = document.getElementById('ep-scroll');
  if (tabs && !tabs.firstChild) tabs.innerHTML = emojiTabsHtml('insertEmoji', 'ep-scroll');
  if (scroll) {
    const freq = emojiSections()[0].items.join('');
    if (!scroll.firstChild || scroll.dataset.freq !== freq) {
      scroll.innerHTML = emojiPickerCached('insertEmoji');
      scroll.dataset.freq = freq;
    }
    scroll.scrollTop = 0;
  }
  const input = document.getElementById('ep-search-input');
  if (input) input.value = '';
  panel.style.display = '';
  stickMessagesToBottom();
}
function closeEmojiPanel() {
  if (_emojiInserting) return; // фокус вернули после вставки смайла — панель не закрываем
  const panel = document.getElementById('emoji-panel');
  if (panel) panel.style.display = 'none';
}

// ── РЕАКЦИИ ──
function sendReaction(msgId, reaction) {
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'react', message_id: msgId, reaction }));
}
// Панель реакций — та же разметка/логика (табы, поиск), что у панели композера,
// только выбор сразу отправляет реакцию и закрывает шторку
let _reactMsgId = null;
function pickerReact(em) {
  if (_reactMsgId == null) return;
  sendReaction(_reactMsgId, em);
  closeSheet();
}
function openReactionPicker(msgId) {
  _reactMsgId = msgId;
  openSheet(`<div class="sheet-title">Реакция</div>
    <div class="ep-search">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input placeholder="Поиск смайла" oninput="filterEmoji(this.value,'rp-scroll','rp-tabs','pickerReact')">
    </div>
    <div class="ep-tabs" id="rp-tabs">${emojiTabsHtml('pickerReact', 'rp-scroll')}</div>
    <div class="ep-scroll" id="rp-scroll" onscroll="syncEmojiTabs('rp-scroll','rp-tabs')"></div>`);
  const scroll = document.getElementById('rp-scroll');
  scroll.innerHTML = emojiPickerCached('pickerReact');
  scroll.dataset.freq = emojiSections()[0].items.join('');
}

// ── РЕДАКТИРОВАНИЕ / УДАЛЕНИЕ ──
function startEdit(msgId) {
  const m = findMsg(msgId);
  if (!m || m.deleted) return;
  if (Date.now() / 1000 - m.sent_at > (S.editLimit || 120)) { toast('Время редактирования истекло'); return; }
  S.editingMessageId = msgId;
  const input = document.getElementById('msg-input');
  input.value = m.text || '';
  input.focus();
  hideReplyBar();
  clearAttachment();
  document.getElementById('edit-bar').style.display = '';
  stickMessagesToBottom();
}
function cancelEdit() {
  S.editingMessageId = null;
  document.getElementById('msg-input').value = '';
  document.getElementById('edit-bar').style.display = 'none';
}
function submitEdit() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) { cancelEdit(); return; }
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'edit_message', message_id: S.editingMessageId, text }));
  cancelEdit();
}
function deleteMessageConfirm(msgId) {
  openSheet(`<div class="sheet-title">Удалить сообщение?</div>
    <div class="msg-action-row danger" onclick="closeSheet();confirmDeleteMessage(${msgId})">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Удалить
    </div>
    <div class="msg-action-row" onclick="closeSheet()">Отмена</div>`);
}
function confirmDeleteMessage(msgId) {
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'delete_message', message_id: msgId }));
}

// ── МИНИ-МЕНЮ ДОЛГОГО НАЖАТИЯ ──
function openMsgActions(msgId) {
  const m = findMsg(msgId);
  if (!m || m.deleted) return;
  const mine = m.sender_id === S.user.id;
  const canEdit = mine && m.text && (Date.now() / 1000 - m.sent_at) < (S.editLimit || 120);
  const rowReact = `<div class="msg-action-row" onclick="closeSheet();openReactionPicker(${msgId})">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>Реакция</div>`;
  const rowReply = `<div class="msg-action-row" onclick="closeSheet();setReply(${msgId})">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>Ответить</div>`;
  const rowEdit = canEdit ? `<div class="msg-action-row" onclick="closeSheet();startEdit(${msgId})">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>Изменить</div>` : '';
  const rowInfo = mine ? `<div class="msg-action-row" onclick="closeSheet();openReadSheet(${msgId})">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>Информация</div>` : '';
  const rowDelete = mine ? `<div class="msg-action-row danger" onclick="closeSheet();deleteMessageConfirm(${msgId})">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Удалить</div>` : '';
  openSheet(`<div class="sheet-title">Сообщение</div>${rowReact}${rowReply}${rowEdit}${rowInfo}${rowDelete}`);
}

// ── ЖЕСТЫ: свайп-назад из чата, свайп-ответ, лонгпресс ──
const LONG_PRESS_MS = 500, LONG_PRESS_SLOP = 10;
function addChatGestures() {
  const screenEl = document.getElementById('chat-screen');
  let startX = 0, startY = 0, dirLocked = false, mode = null, msgEl = null, replyArmed = false;
  let lpTimer = null;

  screenEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dirLocked = false; mode = null; replyArmed = false;
    msgEl = e.target.closest('[data-msg-id]');
    if (msgEl) {
      lpTimer = setTimeout(() => {
        haptic(12);
        openMsgActions(parseInt(msgEl.dataset.msgId));
      }, LONG_PRESS_MS);
    }
  }, { passive: true });

  screenEl.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) {
        if (Math.abs(dx) > LONG_PRESS_SLOP || Math.abs(dy) > LONG_PRESS_SLOP) { clearTimeout(lpTimer); lpTimer = null; }
        return;
      }
      dirLocked = true;
      clearTimeout(lpTimer); lpTimer = null;
      mode = dx > 0 ? 'back' : (msgEl ? 'reply' : null);
    }
    if (mode === 'back') {
      e.preventDefault();
      screenEl.style.transition = 'none';
      screenEl.style.transform = `translateX(${Math.min(dx, window.innerWidth)}px)`;
    } else if (mode === 'reply' && msgEl) {
      if (dx >= 0) return;
      e.preventDefault();
      const shift = Math.max(dx * 0.45, -50);
      msgEl.style.transition = 'none';
      msgEl.style.transform = `translateX(${shift}px)`;
      if (!replyArmed && dx < -50) { replyArmed = true; haptic(8); }
      else if (replyArmed && dx >= -50) replyArmed = false;
    }
  }, { passive: false });

  screenEl.addEventListener('touchend', e => {
    clearTimeout(lpTimer); lpTimer = null;
    const dx = e.changedTouches[0].clientX - startX;
    if (mode === 'back') {
      screenEl.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
      if (dx > window.innerWidth * 0.35) {
        screenEl.style.transform = `translateX(${window.innerWidth}px)`;
        setTimeout(closeChat, 260);
      } else {
        screenEl.style.transform = '';
      }
    } else if (mode === 'reply' && msgEl) {
      msgEl.style.transition = 'transform .25s ease';
      msgEl.style.transform = '';
      if (dx < -50) setReply(parseInt(msgEl.dataset.msgId));
    }
    // Короткий тап по сообщению теперь ничего не делает — «Прочитано» открывается
    // только из меню долгого нажатия (пункт «Информация»)
    mode = null; msgEl = null;
  }, { passive: true });
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
  if (S.editingMessageId) { submitEdit(); return; }
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text && !_pendingAttachment) return;
  if (!S.activeChatId) return;
  if (!S.ws || S.ws.readyState !== 1) { toast('Нет связи с сервером'); return; }
  const chatId = S.activeChatId;
  const payload = { type: 'message', chat_id: chatId, text };
  const temp = {
    id: -(Date.now()), chat_id: chatId, sender_id: S.user.id, text, sent_at: Math.floor(Date.now() / 1000),
    deleted: 0, status: { delivered: 0, read: 0, total: 1 }, _optimistic: true,
  };
  if (S.replyTo) {
    payload.reply_to_id = S.replyTo.id;
    temp.reply_to_id = S.replyTo.id;
    temp.reply_sender_name = S.replyTo.senderName;
    temp.reply_text = S.replyTo.text;
  }
  if (_pendingAttachment) {
    payload.attachment = _pendingAttachment;
    temp.attachment = _pendingAttachment;
  }
  _msgCache.push(temp);
  renderMessages();
  S.ws.send(JSON.stringify(payload));
  input.value = '';
  hideReplyBar();
  clearAttachment();
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

    if (data.type === 'connected') { S.editLimit = data.edit_time_limit || 120; return; }
    if (data.type === 'edit_rejected') { toast('Время редактирования истекло'); return; }

    if (data.type === 'reaction_update') {
      const m = findMsg(data.message_id);
      if (m) { m.reactions = data.counts; renderMessages(); }
      return;
    }

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
      if (chat?.parent_id) {
        // Сообщение в теме комнаты: агрегат комнаты в верхнем списке сервер
        // считает сам — перезапрашиваем список чатов; если открыт список тем
        // этой комнаты, обновляем и его
        loadChats();
        if (S.activeRoomId === chat.parent_id) loadTopics(chat.parent_id).then(renderTopicsList);
      } else if (!chat) loadChats(); else renderChats();
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
    if (data.type === 'reload_chats') {
      loadChats();
      if (S.activeRoomId) loadTopics(S.activeRoomId).then(renderTopicsList);
    }
    if (data.type === 'chat_read') { const c = S.chats.find(x => x.id === data.chat_id); if (c) { c.unread = 0; renderChats(); } }
    if (data.type === 'chat_deleted') {
      S.chats = S.chats.filter(c => c.id !== data.chat_id);
      if (S.activeChatId === data.chat_id) closeChat();
      renderChats();
    }
    if (data.type === 'avatar_updated') { S.avatarTs = Date.now(); _avatarCache.clear(); renderChats(); if (S.currentTab === 'contacts') renderContacts(); }
    if (data.type === 'user_created') loadContacts();
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
    let startY = 0, dy = 0, dragging = false, canDrag = false;
    sheet.addEventListener('pointerdown', e => {
      // Тянуть шторку вниз разрешаем, только если её содержимое прокручено к
      // самому верху — иначе перетаскивание перехватывало бы обычный вертикальный
      // скролл длинных шторок (например, «Внешний вид» с кучей разделов), и
      // шторка не закрывалась бы свайпом и мешала бы скроллу одновременно
      canDrag = sheet.scrollTop <= 0;
      startY = e.clientY; dy = 0; dragging = false;
    });
    window.addEventListener('pointermove', e => {
      if (!canDrag) return;
      const delta = e.clientY - startY;
      if (!dragging && delta <= 0) return; // тянут вверх — это обычный скролл, не наше дело
      dragging = true;
      dy = Math.max(0, delta);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dy}px)`;
    });
    window.addEventListener('pointerup', () => {
      if (dragging) {
        sheet.style.transition = '';
        if (dy > 90) closeSheet();
        sheet.style.transform = '';
      }
      dragging = false; canDrag = false; dy = 0;
    });
  });
})();

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  S.server = window.location.host;
  applyAppearance();
  const session = loadSession();
  if (session?.token) {
    Object.assign(S, { token: session.token, user: session.user });
    const ok = await Promise.race([api('GET', '/users/presence'), new Promise(r => setTimeout(() => r(null), 5000))]);
    if (S.token && ok !== null) enterApp();
  }
  document.getElementById('l-password').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  document.getElementById('l-username').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('l-password').focus());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (S.token && (!S.ws || S.ws.readyState >= 2)) connectWS();
      checkForUpdate();
    }
  });
  addChatGestures();
  addBackSwipeGesture(document.getElementById('topics-screen'), closeTopicsScreen);
  document.getElementById('messages').addEventListener('scroll', maybeLoadOlderMessages, { passive: true });
  setTimeout(checkForUpdate, 3000);
});

// ── ПРОВЕРКА ВЕРСИИ (актуально для PWA: у установленного приложения нет
// кнопки «обновить страницу», и без явной проверки старые css/js могли жить
// в нём сколько угодно после релиза, даже когда сам HTML не кэшируется) ──
// Свежий HTML запрашиваем напрямую, в обход кэша, и сверяем ту же подстановку
// ?v=, что уже стоит на style.css/app.js — если сервер обновился, перезагружаем
// страницу: она заново запросит все ресурсы с новым ?v= и получит свежие файлы.
let _checkingUpdate = false;
async function checkForUpdate() {
  if (_checkingUpdate) return;
  _checkingUpdate = true;
  try {
    const res = await fetch('/m/?_=' + Date.now(), { cache: 'no-store' });
    const html = await res.text();
    const m = html.match(/\?v=([\w.\-]+)/);
    const current = (window.APP_VERSION || '').replace('?v=', '');
    if (m && m[1] && current && m[1] !== current) location.reload();
  } catch {} finally { _checkingUpdate = false; }
}
