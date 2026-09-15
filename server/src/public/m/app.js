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
      <div class="row" onclick="rowTapOpen(${c.id}, this)">
        <div class="av${sq} ${chatAvatarColorClass(c)}" data-av-chat="${c.id}">${esc(chatIcon(c))}</div>
        <div class="row-body">
          <div class="row-top"><div class="row-name">${esc(chatName(c))}</div><div class="row-time${unread ? ' unread' : ''}">${time}</div></div>
          <div class="row-bottom">
            <div class="row-msg">${esc(who)}${esc(preview)}</div>
            ${mentions ? `<div class="badge at">@</div>` : unread ? `<div class="badge">${unread > 99 ? '99+' : unread}</div>` : ''}
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
function rowTapOpen(chatId, rowEl) {
  const wrap = rowEl.closest('.row-swipe-wrap');
  if (wrap === _openRowWrap) { closeOpenRow(); return; }
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
function openThemeSheet() {
  const isDark = document.documentElement.classList.contains('dark');
  openSheet(`
    <div class="sheet-title">Внешний вид</div>
    <div class="settings-row" onclick="setTheme('light')" style="cursor:pointer">
      <div class="settings-label">Светлая</div>${!isDark ? _checkIcon : ''}
    </div>
    <div class="settings-row" onclick="setTheme('dark')" style="cursor:pointer">
      <div class="settings-label">Тёмная</div>${isDark ? _checkIcon : ''}
    </div>
  `);
}
function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch {}
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, settings: { ...(prev.settings || {}), theme } }));
  closeSheet();
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
function bubbleHtml(m, chat) {
  const mine = m.sender_id === S.user.id;
  if (m.deleted) return `<div class="bubble ${mine ? 'out' : 'in'}" data-msg-id="${m.id}" data-mine="${mine ? 1 : 0}"><span class="bubble-deleted">Сообщение удалено</span></div>`;
  const isGroupish = chat && (chat.type === 'group' || chat.type === 'room');
  const showSender = isGroupish && !mine;
  const text = m.text ? highlightMentions(esc(m.text)) : '';
  const quote = m.reply_to_id ? `<div class="bubble-quote">
    <div class="bubble-quote-name">${esc(m.reply_sender_name || '')}</div>
    <div class="bubble-quote-text">${m.reply_deleted ? 'Сообщение удалено' : esc(m.reply_text || '')}</div>
  </div>` : '';
  const tappable = mine ? ' tappable' : '';
  const senderLine = showSender ? `<div class="bubble-sender ${userAvatarColor(m.sender_id, m.sender_tag).replace(/^av-/, 'mtag-')}" data-sender-id="${m.sender_id}" data-sender-name="${esc(m.sender_name || '')}" onclick="event.stopPropagation();mentionUserInComposer(Number(this.dataset.senderId),this.dataset.senderName)">${esc(m.sender_name || '')}</div>` : '';
  const bubble = `<div class="bubble ${mine ? 'out' + tappable : 'in'}" data-msg-id="${m.id}" data-mine="${mine ? 1 : 0}">
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

function renderMessages() {
  const container = document.getElementById('messages');
  const chat = S.chats.find(c => c.id === S.activeChatId);
  let html = '', lastDay = '';
  for (const m of _msgCache) {
    const day = new Date(m.sent_at * 1000).toDateString();
    if (day !== lastDay) { html += `<div class="day-sep">${new Date(m.sent_at * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>`; lastDay = day; }
    html += bubbleHtml(m, chat);
  }
  container.innerHTML = html || '<div class="stub-note">Сообщений пока нет</div>';
  container.scrollTop = container.scrollHeight;
  applyAvatars();
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
  const el = document.getElementById('chat-screen');
  el.classList.remove('open');
  el.style.transform = ''; el.style.transition = ''; // сброс инлайна после свайпа-назад
  _msgCache = [];
  hideReplyBar();
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
function showReplyBar() {
  if (!S.replyTo) return;
  document.getElementById('reply-bar-name').textContent = S.replyTo.senderName;
  document.getElementById('reply-bar-text').textContent = S.replyTo.text;
  document.getElementById('reply-bar').style.display = '';
  document.getElementById('msg-input').focus();
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

// ── РЕАКЦИИ ──
const REACTION_SET = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
function sendReaction(msgId, reaction) {
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'react', message_id: msgId, reaction }));
}
function openReactionPicker(msgId) {
  openSheet(`<div class="sheet-title">Реакция</div>
    <div class="reaction-picker-row">${REACTION_SET.map(r => `<span onclick="closeSheet();sendReaction(${msgId},'${r}')">${r}</span>`).join('')}</div>`);
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
  let lpTimer = null, lpFired = false, tappedInteractive = false;

  screenEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dirLocked = false; mode = null; replyArmed = false; lpFired = false;
    tappedInteractive = !!e.target.closest('.bubble-media, .bubble-video-wrap, .bubble-file, .reaction-pill');
    msgEl = e.target.closest('[data-msg-id]');
    if (msgEl) {
      lpTimer = setTimeout(() => {
        lpFired = true; haptic(12);
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
    } else if (!mode && !lpFired && !tappedInteractive && msgEl?.dataset.mine === '1') {
      // Обычный тап по своему сообщению (без сдвига и без долгого нажатия) — «Прочитано»
      openReadSheet(parseInt(msgEl.dataset.msgId));
    }
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
  addChatGestures();
});
