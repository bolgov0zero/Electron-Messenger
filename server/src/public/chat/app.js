'use strict';

// ── SERVICE WORKER REGISTRATION ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/chat/sw.js', { scope: '/chat/' }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'open-chat') {
        const chat = S.chats.find(c => c.id === e.data.chatId);
        if (chat) openChat(e.data.chatId);
      }
    });
  });
}

// ── STATE ──
const S = {
  server: '', token: null, user: null,
  chats: [], activeChatId: null,
  ws: null, wsRetry: 0,
  unread: {}, unreadMentions: {}, allUsers: [], drafts: (()=>{ try { return JSON.parse(localStorage.getItem('chat_drafts'))||{}; } catch { return {}; } })(),
  settings: { theme: 'dark', fontSize: 'medium', uiScale: window.matchMedia('(max-width: 767px),(pointer:coarse)').matches ? 110 : 100 },
  ctx: { messageId: null, canEdit: false, isMine: false, replyText: '', replySenderName: '' },
  editingMessageId: null,
  replyTo: null,
  giChatId: null, giRemovedIds: new Set(), giAddIds: new Set(), giAvatarBase64: null,
  newGroupAvatarBase64: null,
  presence: {},
  lastSeen: {}, // userId -> unix ts последнего онлайна
  reactions: {},
  msgStatus: {},      // messageId -> {delivered, read, total} для событий status_range
  statusApplied: {},  // messageId -> Set<'read:userId'|'delivered:userId'> для дедупликации
  chatHasMore: false,
  chatOldestId: null,
  chatHasMoreAfter: false,
  chatNewestId: null,
  searchResults: null,
  subrooms: {},
  activeSubroomId: null,
  activeRoomId: null,
  mutedChats: new Set(),
  forwardMsg: null,
  msgData: new Map(),
};

const SESSION_KEY = 'electron_v2';
const CRED_KEY = 'electron_creds';
function saveCredentials(u, p) { try { localStorage.setItem(CRED_KEY, JSON.stringify({ u, p })); } catch {} }
function clearCredentials() { try { localStorage.removeItem(CRED_KEY); } catch {} }
function fillLoginFromCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(CRED_KEY));
    if (!c) return;
    const un = document.getElementById('l-username'); if (un && c.u) un.value = c.u;
    const pw = document.getElementById('l-password'); if (pw && c.p) pw.value = c.p;
  } catch {}
}
let _loadingMore = false;
let _loadingChatId = null;
let _mobilePanel = 1;
let _mobileFromSubrooms = false;
const _avatarCache = new Map();
let _fetchController = new AbortController();

// ── UTILS ──
function saveDrafts() { try { localStorage.setItem('chat_drafts', JSON.stringify(S.drafts)); } catch {} }
// Склонение существительного при числе: 1 участник / 2 участника / 5 участников
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const nMembers = n => n + ' ' + plural(n, 'участник', 'участника', 'участников');

// ── СМЕНА СОБСТВЕННОГО ПАРОЛЯ ──
// Раньше пароль мог поменять только администратор, пользователю идти было некуда
function togglePasswordForm() {
  const form = document.getElementById('pw-form');
  const btn = document.getElementById('pw-toggle');
  if (!form) return;
  const open = form.style.display !== 'none';
  form.style.display = open ? 'none' : 'flex';
  if (btn) btn.textContent = open ? 'Сменить пароль' : 'Отмена';
  if (!open) setTimeout(() => document.getElementById('pw-old')?.focus(), 50);
  else ['pw-old','pw-new','pw-new2'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
}

async function submitOwnPassword() {
  const msg = document.getElementById('pw-msg');
  const oldP = document.getElementById('pw-old').value;
  const newP = document.getElementById('pw-new').value;
  const newP2 = document.getElementById('pw-new2').value;
  const fail = t => { msg.style.color = 'var(--danger, #e5484d)'; msg.textContent = t; };
  if (!oldP || !newP || !newP2) return fail('Заполните все поля');
  if (newP !== newP2) return fail('Новый пароль и подтверждение не совпадают');
  const r = await api('POST', '/users/me/password', { old_password: oldP, new_password: newP });
  if (r?.error) return fail(r.error);
  msg.style.color = 'var(--accent)';
  msg.textContent = 'Пароль изменён';
  ['pw-old','pw-new','pw-new2'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  setTimeout(() => {
    const form = document.getElementById('pw-form'), btn = document.getElementById('pw-toggle');
    if (form) form.style.display = 'none';
    if (btn) btn.textContent = 'Сменить пароль';
    if (msg) msg.textContent = '';
  }, 1600);
}

// Текст превью последнего сообщения — общий для списка чатов и подкомнат
function previewText(lm, limit = 40) {
  let t = lm
    ? (lm.deleted ? 'Сообщение удалено'
      : (lm.text ? lm.text.replace(/<[^>]*>/g, '')
        : (lm.attachment ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : '📎 ' + (lm.attachment.name || 'Файл')) : '')))
    : 'Нет сообщений';
  if (t.length > limit) t = t.slice(0, limit) + '…';
  return t;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Markdown-lite: **жирный**, __курсив__, `код` — применяется к уже экранированному тексту
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
    return `<a class="msg-link" href="#" onclick="openExternalLink(event,this)" data-url="${esc(part)}">${esc(part)}</a>`;
  }).join('');
}

function openExternalLink(e, el) {
  e.preventDefault();
  document.getElementById('modal-link').dataset.url = el.dataset.url;
  document.getElementById('link-modal-url').textContent = el.dataset.url;
  openModal('modal-link');
}

function confirmLink() {
  const url = document.getElementById('modal-link').dataset.url;
  closeModal('modal-link');
  window.open(url, '_blank', 'noopener,noreferrer');
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
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}
function fmtDate(ts) {
  const d = new Date(ts*1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate()-1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru',{day:'numeric',month:'long'});
}
function avatarColor(id) { return ['av-blue','av-green','av-purple','av-orange'][id%4]; }

// Тег пользователя: у себя берём из профиля, у остальных — из списка людей.
// Нужен там, где на руках только идентификатор (реакции, упоминания, поиск).
function tagOfUser(id) {
  if (S.user && id === S.user.id) return S.user.tag;
  return S.allUsers.find(u => u.id === id)?.tag || null;
}

// Аватарка красится в цвет тега — тогда человек узнаётся одинаково и в переписке,
// и в реакциях, и в списках. Без тега остаётся прежний цвет по идентификатору.
// Только для людей: у чатов и комнат идентификаторы из того же диапазона, и
// подстановка тега покрасила бы группу в цвет случайного сотрудника.
function userAvatarColor(id, tag) {
  const cls = senderNameClass(tag === undefined || tag === null ? tagOfUser(id) : tag);
  return cls === 'default' ? avatarColor(id) : 'av-' + cls;
}
function formatEditLimit(sec) {
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  return `${Math.round(min / 60)} ч`;
}

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
    if (res.status === 401) {
      // Выходим только когда сессия действительно недействительна. Истёкший токен
      // сначала пробуем продлить, а на прочие отказы (сервер поднимается, база
      // недоступна) вход не сбрасываем — иначе разлогинивает на ровном месте.
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
  } catch(e) {
    if (e?.name === 'AbortError') return null;
    return null;
  }
}

// Продление токена: срок 60 дней, но продлеваем раз в сутки при работающем
// клиенте — тогда он не подходит к концу незаметно.
let _refreshTimer = null;
async function refreshToken() {
  if (!S.token || !S.server) return false;
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/refresh`, {
      headers: { Authorization: 'Bearer ' + S.token },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.token) return false;
    S.token = data.token;
    saveSession();
    return true;
  } catch { return false; }
}
function startTokenRefresh() {
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(refreshToken, 24 * 60 * 60 * 1000);
}
// ── SESSION ──
function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ server:S.server, token:S.token, user:S.user, settings:S.settings }));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// ── WEB NOTIFICATIONS ──
// Чат заглушён, если замьючен он сам или его родительская комната —
// тот же критерий, что и на сервере при отправке push
function isChatMuted(chatId, parentId) {
  return S.mutedChats.has(chatId) || (!!parentId && S.mutedChats.has(parentId));
}

function webNotify(title, body, chatId) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    tag: chatId ? `chat-${chatId}` : 'msg',
    renotify: true,
  });
  n.onclick = () => {
    window.focus();
    const chat = S.chats.find(c => c.id === chatId);
    if (chat) openChat(chatId);
    n.close();
  };
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    dismissNotifBanner();
    await subscribePush();
  } else if (perm === 'denied') {
    dismissNotifBanner();
  }
}

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const data = await fetch(`${httpProto()}://${S.server}/api/push/vapid-public-key`).then(r => r.json());
    if (!data?.key) return;
    const appServerKey = urlBase64ToUint8Array(data.key);

    // Если уже есть подписка — проверяем что ключ совпадает, иначе переподписываемся
    let existing = await reg.pushManager.getSubscription();
    if (existing) {
      const existingKey = existing.options?.applicationServerKey;
      const existingKeyB64 = existingKey
        ? btoa(String.fromCharCode(...new Uint8Array(existingKey)))
        : null;
      const newKeyB64 = btoa(String.fromCharCode(...appServerKey));
      if (existingKeyB64 !== newKeyB64) {
        await existing.unsubscribe();
        existing = null;
      }
    }

    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
    await api('POST', '/push/subscribe', {
      endpoint: sub.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth:   btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
      },
    });
  } catch(e) { console.warn('Push subscribe failed:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function dismissNotifBanner() {
  const b = document.getElementById('notif-banner');
  if (b) b.style.display = 'none';
  localStorage.setItem('notifBannerDismissed', '1');
}

function maybeShowNotifBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') return;
  if (localStorage.getItem('notifBannerDismissed')) return;
  const b = document.getElementById('notif-banner');
  if (b) b.style.display = 'flex';
}

// ── MOBILE NAVIGATION ──
const _CHAT_EASE = 'transform .32s cubic-bezier(.32,.72,0,1)';

const _isMobile = () => window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;

function mobileSlideTo(panel, title = '', sub = '') {
  _mobilePanel = panel;
  const track = document.getElementById('mobile-track');
  if (track) {
    track.classList.remove('mp-2', 'mp-3');
    if (panel === 2) track.classList.add('mp-2');
    else if (panel === 3) track.classList.add('mp-3');
  }
  const backBtn = document.getElementById('mtb-back');
  const account = document.getElementById('mtb-account');
  const titleWrap = document.getElementById('mtb-title-wrap');
  const titleEl = document.getElementById('mtb-title');
  const subEl = document.getElementById('mtb-sub');
  const actions = document.querySelector('.mtb-actions');
  const chatActions = document.getElementById('mtb-chat-actions');
  // Переход на другой экран — снимаем обработчик прошлого чата, иначе он
  // останется висеть на шапке списка подкомнат и откроет чужой состав
  if (titleWrap) { titleWrap.onclick = null; titleWrap.style.cursor = ''; }
  if (panel === 1) {
    if (backBtn) backBtn.style.display = 'none';
    if (account) account.style.display = '';
    if (titleWrap) titleWrap.style.display = 'none';
    if (actions) actions.style.display = '';
    if (chatActions) chatActions.style.display = 'none';
  } else {
    if (backBtn) backBtn.style.display = 'flex';
    if (account) account.style.display = 'none';
    if (titleWrap) titleWrap.style.display = title ? 'flex' : 'none';
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub;
    if (actions) actions.style.display = 'none';
    if (chatActions) chatActions.style.display = (panel === 3 && S.activeChatId) ? 'flex' : 'none';
  }
}

function mobileSlideBack() {
  if (_mobilePanel === 3) {
    S.activeChatId = null;
    S.activeSubroomId = null;
    if (_mobileFromSubrooms) {
      const room = S.chats.find(c => c.id === S.activeRoomId);
      mobileSlideTo(2, room ? chatName(room) : '', room ? nMembers(room.members?.length || 0) : '');
    } else {
      S.activeRoomId = null;
      mobileSlideTo(1);
    }
  } else if (_mobilePanel === 2) {
    S.activeRoomId = null;
    S.activeSubroomId = null;
    mobileSlideTo(1);
    const mp = document.getElementById('mobile-subrooms');
    setTimeout(() => { if (mp) mp.innerHTML = ''; }, 340);
  }
}

function mobileBack(animated) {
  if (_isMobile()) { mobileSlideBack(); return; }
  const cm = document.getElementById('chat-main');
  const sb = document.querySelector('.sidebar');
  S.activeChatId = null;
  if (animated === false) {
    cm?.classList.remove('mobile-open');
    if (cm) { cm.style.transform = ''; cm.style.transition = ''; }
    return;
  }
  if (cm) { cm.style.transition = _CHAT_EASE; cm.style.transform = 'translateX(100%)'; }
  sb?.classList.remove('mobile-hidden');
  const done = () => {
    cm?.classList.remove('mobile-open');
    if (cm) { cm.style.transform = ''; cm.style.transition = ''; }
  };
  if (cm) cm.addEventListener('transitionend', done, { once: true });
  else done();
}

function openMobileChat() {
  const cm = document.getElementById('chat-main');
  const sb = document.querySelector('.sidebar');
  if (!cm) return;
  cm.classList.add('mobile-open');
  if (!_isMobile()) { sb?.classList.add('mobile-hidden'); return; }
  // На мобильном слайдер управляется через mobileSlideTo
}

// ── VIEWPORT / KEYBOARD (нативное поведение на мобильных) ──
// Высота всего экрана = высоте visual viewport. Клавиатура уменьшает
// viewport → CSS-флексбокс сам сжимает список сообщений, поле ввода
// остаётся над клавиатурой. Никакого ручного позиционирования.
// _maxVH — максимальная высота viewport, используется для вычисления высоты клавиатуры.
// Инициализируем через screen.height / dpr, чтобы получить физическую высоту экрана
// в CSS-пикселях независимо от адресной строки Safari или открытой клавиатуры.
let _maxVH = (() => {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  if (window.screen && window.devicePixelRatio) {
    return Math.max(h, Math.round(screen.height / devicePixelRatio));
  }
  return h;
})();
let _stickBottom = true; // был ли пользователь у нижнего края списка

function updateAppHeight() {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  _maxVH = Math.max(_maxVH, h);
  const kbOpen = (_maxVH - h) > 80;
  const root = document.documentElement.style;
  // +50 вместо +5: iOS не включает панель QuickType (~44px) в уменьшение visualViewport
  const kbHeight = kbOpen ? (_maxVH - h + 50) : 0;
  root.setProperty('--kb-height', kbHeight + 'px');
  root.setProperty('--app-top', (vv ? vv.offsetTop : 0) + 'px');
  root.setProperty('--input-safe-bottom', kbOpen ? '0px' : '5px');
  if (window.scrollY !== 0) window.scrollTo(0, 0);
  if (_stickBottom) pinMessagesToBottom();
}

function pinMessagesToBottom() {
  const msgs = document.getElementById('messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// Совместимость со старым вызовом из openChat
function syncInputBarHeight() { updateAppHeight(); }

// «Пользователь реально смотрит в чат»: вкладка видима И окно в фокусе.
// На сенсорных устройствах фокус окна ненадёжен (клавиатура шлёт blur) —
// там достаточно видимости вкладки.
const _hasHover = window.matchMedia('(hover: hover)').matches;
function isViewing() {
  if (document.hidden) return false;
  if (_hasHover && typeof document.hasFocus === 'function') return document.hasFocus();
  return true;
}

// Единая реакция на смену активности (видимость/фокус): синхронизация, прочтение, статус.
function refreshActivity() {
  const viewing = isViewing();
  if (viewing) {
    // Соединение в фоне могло «умереть»: мёртвое — реконнект (onopen подтянет loadChats),
    // живое — досинхронизируем список на случай пропущенных сообщений.
    if (S.token) {
      if (!S.ws || S.ws.readyState >= 2) connectWS();
      else loadChats();
    }
    if (S.activeChatId && S.ws?.readyState===1) {
      S.ws.send(JSON.stringify({type:'read', chat_id: S.activeChatId}));
      S.unread[S.activeChatId] = 0;
      S.unreadMentions[S.activeChatId] = 0;
      updateUnreadTotal();
      renderChatList();
    }
  }
  if (S.ws?.readyState===1) S.ws.send(JSON.stringify({type:'set_status', status: viewing ? 'online' : 'offline'}));
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateAppHeight);
  window.visualViewport.addEventListener('scroll', updateAppHeight);
}
window.addEventListener('resize', updateAppHeight);
updateAppHeight();

// При смене форм-фактора (мобильный ↔ десктоп) перестраиваем механизм масштаба
try {
  window.matchMedia('(max-width: 767px), (pointer: coarse)').addEventListener('change', () => {
    if (typeof applySettings === 'function') applySettings();
  });
} catch (e) {}

document.addEventListener('focusin', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
    // При появлении клавиатуры держим список внизу
    _stickBottom = true;
    setTimeout(updateAppHeight, 50);
    setTimeout(() => { updateAppHeight(); pinMessagesToBottom(); }, 350);
  }
});
document.addEventListener('focusout', () => setTimeout(updateAppHeight, 100));

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  S.server = window.location.host;
  const session = loadSession();
  if (session?.token) {
    Object.assign(S, { server: S.server, token:session.token, user:session.user, settings:session.settings||S.settings });
    applySettings();
    const ok = await Promise.race([
      api('GET', '/users/presence'),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
    if (S.token && ok !== null) enterApp();
    else fillLoginFromCreds();
  } else {
    applySettings();
    fillLoginFromCreds();
  }

  document.getElementById('l-password').addEventListener('keydown', e => e.key==='Enter' && doLogin());
  document.getElementById('l-username').addEventListener('keydown', e => e.key==='Enter' && document.getElementById('l-password').focus());

  document.addEventListener('click', e => {
    hideCtxMenu();
    document.getElementById('ctx-chat-menu').style.display = 'none';
    if (!e.target.closest('#mention-popup')) hideMentionPopup();
    if (!e.target.closest('.composer-pill')) closeEmojiPicker();
    if (!e.target.closest('#reaction-picker')) hideReactionPicker();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const anyOpen = document.getElementById('ctx-menu')?.classList.contains('open') ||
      document.getElementById('reaction-picker')?.classList.contains('open') ||
      document.getElementById('ep-grid')?.classList.contains('open') ||
      document.querySelector('[id^="modal-"].open') ||
      S.editingMessageId;
    hideCtxMenu(); hideReactionPicker(); closeSettings();
    document.getElementById('ep-grid')?.classList.remove('open');
    if (S.editingMessageId) { cancelEdit(); return; }
    if (anyOpen) return;
    // Escape разбирает открытое по одному уровню за нажатие:
    // сначала чат, следующим нажатием — список подкомнат
    if (S.activeChatId) { closeActiveChat(); return; }
    if (S.activeRoomId) { closeSubroomsPanel(true); return; }
  });

  document.addEventListener('visibilitychange', refreshActivity);
  // На десктопе окно может быть видимым, но не в фокусе (за другим окном) — тогда
  // пользователь не смотрит в чат. На сенсорных устройствах окно либо на переднем
  // плане, либо скрыто, а blur прилетает при открытии клавиатуры — поэтому там не вешаем.
  if (_hasHover) {
    window.addEventListener('focus', refreshActivity);
    window.addEventListener('blur', refreshActivity);
  }

  // Drag-and-drop
  document.addEventListener('dragover', e => {
    if (!S.activeChatId) return;
    e.preventDefault();
    document.getElementById('drag-overlay')?.classList.add('visible');
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget && document.body.contains(e.relatedTarget)) return;
    document.getElementById('drag-overlay')?.classList.remove('visible');
  });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    document.getElementById('drag-overlay')?.classList.remove('visible');
    if (!S.activeChatId) return;
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  });

  // Paste image from clipboard
  document.addEventListener('paste', async e => {
    if (!S.activeChatId) return;
    const file = Array.from(e.clipboardData.items)
      .find(i => i.kind === 'file')?.getAsFile();
    if (file) { e.preventDefault(); await uploadFile(file); }
  });

  // Open chat from URL param (SW notification click)
  const urlParams = new URLSearchParams(location.search);
  const chatIdParam = urlParams.get('chatId');
  if (chatIdParam && session?.token) {
    S._pendingOpenChatId = parseInt(chatIdParam);
    // Убираем параметр из URL чтобы при следующем открытии PWA чат не открывался автоматически
    history.replaceState(null, '', location.pathname);
  }
});

// ── LOGIN ──
async function doLogin() {
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const err = document.getElementById('l-err');
  const btn = document.getElementById('l-btn');
  if (!username||!password) { err.textContent='Заполните все поля'; return; }
  btn.disabled=true; btn.textContent='Подключение...'; err.textContent='';
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const data = await res.json();
    if (data.token) {
      Object.assign(S, { token:data.token, user:data.user });
      saveCredentials(username, password);
      saveSession(); enterApp();
    } else { err.textContent = data.error||'Неверный логин или пароль'; }
  } catch { err.textContent='Не удалось подключиться к серверу'; }
  finally { btn.disabled=false; btn.textContent='Войти'; }
}

function logout(intentional = false) {
  clearInterval(_refreshTimer);
  _fetchController.abort();
  _fetchController = new AbortController();
  closeSettings();
  if (S.ws) S.ws.close();
  if (intentional) clearCredentials();
  Object.assign(S, { token:null, user:null, chats:[], activeChatId:null, ws:null, unread:{}, allUsers:[] });
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('screen-main').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  // Reset mobile state
  _mobilePanel = 1;
  _mobileFromSubrooms = false;
  document.getElementById('mobile-track')?.classList.remove('mp-2', 'mp-3');
  const mtbBack = document.getElementById('mtb-back');
  const mtbAcc = document.getElementById('mtb-account');
  const mtbAct = document.querySelector('.mtb-actions');
  const mtbTitWrap = document.getElementById('mtb-title-wrap');
  if (mtbBack) mtbBack.style.display = 'none';
  if (mtbAcc) mtbAcc.style.display = '';
  if (mtbAct) mtbAct.style.display = '';
  if (mtbTitWrap) mtbTitWrap.style.display = 'none';
  document.getElementById('chat-main')?.classList.remove('mobile-open');
  document.querySelector('.sidebar')?.classList.remove('mobile-hidden');
  if (!intentional) fillLoginFromCreds();
}

// ── ENTER APP ──
function enterApp() {
  startTokenRefresh();
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  initPullGestures();
  initChatRowSwipe();
  loadChats().then(() => {
    if (S._pendingOpenChatId) {
      const c = S.chats.find(c => c.id === S._pendingOpenChatId);
      if (c) openChat(S._pendingOpenChatId);
      S._pendingOpenChatId = null;
    }
  });
  loadUsers();
  loadUploadSettings();
  connectWS();
  loadPresence();
  // Show notification permission banner or re-subscribe if already granted
  if (Notification.permission === 'granted') {
    subscribePush();
  } else {
    setTimeout(maybeShowNotifBanner, 800);
  }
  // Sidebar account bar
  const acAv = document.getElementById('sb-account-av');
  const acName = document.getElementById('sb-account-name');
  if (acAv && S.user) {
    acAv.className = `av sa-av ${userAvatarColor(S.user.id, S.user.tag)}`;
    acAv.style.backgroundImage = '';
    acAv.textContent = initials(S.user.display_name);
    const acUrl = `${httpProto()}://${S.server}/api/users/${S.user.id}/avatar?t=${Date.now()}`;
    tryLoadAvatar(acAv, acUrl, initials(S.user.display_name));
  }
  if (acName && S.user) acName.textContent = S.user.display_name;
  // Mobile topbar account
  const mtbAv = document.getElementById('mtb-av');
  const mtbName = document.getElementById('mtb-name');
  if (mtbAv && S.user) {
    mtbAv.className = `av mtb-av ${avatarColor(S.user.id)}`;
    mtbAv.style.backgroundImage = '';
    mtbAv.textContent = initials(S.user.display_name);
    const mtbUrl = `${httpProto()}://${S.server}/api/users/${S.user.id}/avatar?t=${Date.now()}`;
    tryLoadAvatar(mtbAv, mtbUrl, initials(S.user.display_name));
  }
  if (mtbName && S.user) mtbName.textContent = S.user.display_name;
}


function updateSidebarThemeIcon() {
  const isDark = S.settings.theme === 'dark';
  ['sidebar-theme-sun', 'sb-theme-sun', 'mtb-theme-sun'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isDark ? '' : 'none';
  });
  ['sidebar-theme-moon', 'sb-theme-moon', 'mtb-theme-moon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isDark ? 'none' : '';
  });
}


// ── SETTINGS ──
function applySettings() {
  const isDark = S.settings.theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.className = document.documentElement.className.replace(/font-\w+/,'');
  document.documentElement.classList.add('font-'+S.settings.fontSize);
  document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===(S.settings.theme==='light'?'Светлая':'Тёмная')));
  document.querySelectorAll('#font-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===S.settings.fontSize[0].toUpperCase()));
  const _scale = S.settings.uiScale || 100;
  const _ratio = _scale / 100;
  document.documentElement.style.minHeight = '';
  document.body.style.height = '';
  const htmlStyle = document.documentElement.style;
  // На iOS Safari CSS zoom ненадёжен для текста (часть элементов не масштабируется),
  // на мобильных используем transform: scale на body (через CSS-переменную --ui-scale).
  // На десктопе оставляем zoom — там он реализован корректно и лучше рендерит текст.
  const isMobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  if (isMobile) {
    htmlStyle.zoom = '';
    htmlStyle.setProperty('--ui-scale', _ratio);
  } else {
    htmlStyle.setProperty('--ui-scale', '1');
    htmlStyle.zoom = _scale === 100 ? '' : (_scale + '%');
  }
  if (_ratio === 1) {
    htmlStyle.setProperty('--vh100', '100dvh');
    htmlStyle.setProperty('--vw100', '100vw');
  } else {
    htmlStyle.setProperty('--vh100', `calc(100dvh / ${_ratio})`);
    htmlStyle.setProperty('--vw100', `calc(100vw / ${_ratio})`);
  }
  document.querySelectorAll('#scale-seg button').forEach(b => b.classList.toggle('active', parseInt(b.textContent) === _scale));
  updateAppHeight();
  updateSidebarThemeIcon();
  // Цвет системного UI (статус-бар, клавиатура) следует теме
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) themeColorMeta.content = isDark ? '#0b0d14' : '#f7f7fb';
}
// Плавная смена темы: включаем переход цветов только на время переключения,
// иначе постоянный transition на всех элементах бил бы по отзывчивости.
let _themeAnimTimer = null;
function animateThemeSwitch() {
  const html = document.documentElement;
  html.classList.add('theme-anim');
  clearTimeout(_themeAnimTimer);
  _themeAnimTimer = setTimeout(() => html.classList.remove('theme-anim'), 260);
}
function setTheme(t) { animateThemeSwitch(); S.settings.theme=t; applySettings(); saveSession(); }
function toggleTheme() { setTheme(S.settings.theme === 'dark' ? 'light' : 'dark'); }
function setFontSize(f) { S.settings.fontSize=f; applySettings(); saveSession(); }
function setUiScale(v) { S.settings.uiScale = v; applySettings(); saveSession(); }
async function openSettings() {
  openModal('modal-settings');
  showSettingsTab('profile');
}

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-nav-item').forEach(el => {
    el.classList.toggle('active', el.id === 'snav-' + tab);
  });
  const content = document.getElementById('settings-content');
  if (!content) return;

  if (tab === 'profile') {
    const u = S.user;
    const avColor = userAvatarColor(u.id, u.tag);
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:24px">
        <div style="position:relative">
          <div class="av" id="settings-av" style="width:72px;height:72px;font-size:22px;font-weight:700;cursor:pointer" onclick="triggerAvatarUpload()"></div>
          <div style="position:absolute;bottom:-4px;right:-4px;width:24px;height:24px;border-radius:7px;background:var(--accent);border:2px solid var(--modal-bg);display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="triggerAvatarUpload()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </div>
        </div>
        <div style="font-size:13px;color:var(--text2)">@${esc(u.username)}</div>
      </div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="onAvatarFileChange(this)">
      <div style="margin-bottom:24px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Имя пользователя</div>
        <div style="display:flex;gap:8px">
          <input id="settings-display-name" class="settings-name-input" value="${esc(u.display_name)}" style="flex:1;background:var(--search-bg);border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;color:var(--text);font-family:inherit;outline:none;pointer-events:auto;border-color:transparent" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
          <button onclick="saveDisplayName()" class="settings-save-btn">Сохранить</button>
        </div>
      </div>
      <div style="margin-bottom:24px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Пароль</div>
        <button id="pw-toggle" class="settings-save-btn" style="width:100%;justify-content:center" onclick="togglePasswordForm()">Сменить пароль</button>
        <div id="pw-form" style="display:none;flex-direction:column;gap:8px;margin-top:10px">
          <input id="pw-old" type="password" placeholder="Текущий пароль" autocomplete="current-password" class="settings-name-input" style="background:var(--search-bg);border:1px solid transparent;border-radius:9px;padding:9px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
          <input id="pw-new" type="password" placeholder="Новый пароль (от 6 символов)" autocomplete="new-password" class="settings-name-input" style="background:var(--search-bg);border:1px solid transparent;border-radius:9px;padding:9px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
          <input id="pw-new2" type="password" placeholder="Повторите новый пароль" autocomplete="new-password" class="settings-name-input" style="background:var(--search-bg);border:1px solid transparent;border-radius:9px;padding:9px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'" onkeydown="if(event.key==='Enter')submitOwnPassword()">
          <div id="pw-msg" style="font-size:12px;min-height:16px"></div>
          <button class="settings-save-btn" style="width:100%;justify-content:center" onclick="submitOwnPassword()">Сохранить пароль</button>
        </div>
      </div>
      <button class="setting-logout" onclick="logout(true)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Выйти из аккаунта
      </button>`;
    const avEl = document.getElementById('settings-av');
    if (avEl) {
      avEl.className = `av ${avColor}`;
      avEl.textContent = initials(u.display_name);
      updateSettingsAvatar();
    }

  } else if (tab === 'general') {
    content.innerHTML = `
      <div style="font-size:11px;letter-spacing:1px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:10px">Система</div>
      <div class="setting-row" style="border:none">
        <span>Звук сообщений</span>
        <label class="toggle"><input type="checkbox" id="sound-chk" onchange="S.settings.soundEnabled=this.checked;saveSession()" ${S.settings.soundEnabled!==false?'checked':''}><span class="toggle-slider"></span></label>
      </div>
      <div style="font-size:11px;letter-spacing:1px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:10px;margin-top:16px">Внешний вид</div>
      <div class="setting-row" style="border:none">
        <span>Тема</span>
        <div class="seg" id="theme-seg">
          <button onclick="setTheme('light')">Светлая</button>
          <button onclick="setTheme('dark')">Тёмная</button>
        </div>
      </div>
      <div class="setting-row">
        <span>Размер текста</span>
        <div class="seg" id="font-seg">
          <button onclick="setFontSize('small')">S</button>
          <button onclick="setFontSize('medium')">M</button>
          <button onclick="setFontSize('large')">L</button>
        </div>
      </div>
      <div class="setting-row" style="border:none">
        <span>Масштаб интерфейса</span>
        <div class="seg" id="scale-seg">
          <button onclick="setUiScale(80)">80%</button>
          <button onclick="setUiScale(90)">90%</button>
          <button onclick="setUiScale(100)">100%</button>
          <button onclick="setUiScale(110)">110%</button>
        </div>
      </div>`;
    applySettings();

  }
}
function closeSettings() { closeModal('modal-settings'); }
function openNameEdit() {
  const input = document.getElementById('settings-display-name');
  const btn = document.getElementById('settings-edit-btn');
  if (!input) return;
  if (input.readOnly) {
    input.readOnly = false;
    input.classList.add('editing');
    input.focus();
    input.select();
    if (btn) btn.textContent = 'Сохранить';
  } else {
    saveDisplayName();
  }
}
async function saveDisplayName() {
  const input = document.getElementById('settings-display-name');
  const btn = document.getElementById('settings-edit-btn');
  const name = input?.value?.trim();
  if (name) {
    const res = await api('PATCH', '/users/me', { display_name: name });
    if (res?.ok) {
      S.user.display_name = name;
      saveSession();
    }
  }
  if (input) { input.readOnly = true; input.classList.remove('editing'); }
  if (btn) btn.textContent = 'Изменить';
}

function updateSettingsAvatar() {
  const el = document.getElementById('settings-av');
  if (!el) return;
  el.className = `av av-lg ${userAvatarColor(S.user.id, S.user.tag)}`;
  const url = `${httpProto()}://${S.server}/api/users/${S.user.id}/avatar?t=${Date.now()}`;
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url('${url}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  };
  img.onerror = () => {
    el.style.backgroundImage = '';
    el.textContent = initials(S.user.display_name);
  };
  img.src = url;
}

function triggerAvatarUpload() {
  document.getElementById('avatar-file-input').click();
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

async function onAvatarFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  const base64 = await resizeAvatarFile(file);
  const res = await api('POST', '/users/me/avatar', { data: base64 });
  if (res?.ok) updateSettingsAvatar();
}

// ── NOTIFICATION SOUND ──
let _audioCtx = null;
function playNotificationSound() {
  if (S.settings.soundEnabled === false) return;
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.3);
    osc.start(_audioCtx.currentTime);
    osc.stop(_audioCtx.currentTime + 0.3);
  } catch(e) {}
}

// ── CHAT LIST ──
async function loadChats() {
  const chats = await api('GET','/chats');
  if (!chats) return;
  S.chats = chats;
  S.mutedChats = new Set(chats.filter(c => c.muted).map(c => c.id));
  chats.forEach(c => {
    S.unread[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread || 0);
    S.unreadMentions[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread_mentions || 0);
  });
  await Promise.all(chats.filter(c=>c.has_subrooms).map(c=>loadSubrooms(c.id)));
  updateUnreadTotal();
  renderChatList();
}

// ── SUB-ROOMS ──
async function loadSubrooms(roomId, { render = false } = {}) {
  const subs = await api('GET', `/chats/${roomId}/subrooms`);
  if (!subs) return;
  S.subrooms[roomId] = subs;
  S.unread[roomId] = 0;
  S.unreadMentions[roomId] = 0;
  subs.forEach(s => {
    S.unread[s.id] = s.unread || 0;
    S.unreadMentions[s.id] = s.unread_mentions || 0;
  });
  if (render) renderSubroomsPanel(roomId);
}

function renderSubroomsPanel(roomId) {
  const subs = S.subrooms[roomId] || [];
  if (!subs.length) { closeSubroomsPanel(); return; }
  const roomName = S.chats.find(c=>c.id===roomId)?.name || 'Комната';

  if (_isMobile()) {
    // На мобильном — рендерим в панель 2 слайдера
    const mp = document.getElementById('mobile-subrooms');
    if (!mp) return;
    const items = subs.map(s => {
      const unread = S.unread[s.id] || 0;
      const badge = unread ? `<div class="unread-badge">${unread > 99 ? '99+' : unread}</div>` : '';
      const bg = avatarColor(s.id);
      // Как у комнат в списке чатов: эмодзи, если своя картинка не задана
      const letter = '🏠';
      // avatarColor отдаёт ИМЯ КЛАССА, а не цвет: раньше он подставлялся
      // в style="background:..." и фон получался прозрачным
      const avEl = `<div class="av av-md av-sq av-orange" ${s.has_avatar?`style="background-image:url('/api/chats/${s.id}/avatar');background-size:cover;background-position:center"`:''}>${s.has_avatar?'':letter}</div>`;
      return `<div class="chat-item${S.activeSubroomId===s.id?' active':''}" onclick="openSubroom(${s.id})">
        <div class="av-wrap">${avEl}</div>
        <div class="info">
          <div class="ci-name" style="display:flex;align-items:center;gap:5px">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
            ${badge}
          </div>
          <div style="margin-top:2px"><span class="ci-preview">${esc(previewText(s.last_message))}</span></div>
        </div>
      </div>`;
    }).join('');
    // Название комнаты — в шапку (см. mobileSlideTo ниже), в теле оно дублировалось
    mp.innerHTML = items;
    if (!mp._swipeInit) {
      mp._swipeInit = true;
      let _sx = 0, _sy = 0;
      mp.addEventListener('touchstart', e => { _sx = e.touches[0].clientX; _sy = e.touches[0].clientY; }, { passive: true });
      mp.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _sx;
        const dy = e.changedTouches[0].clientY - _sy;
        if (dx > 60 && Math.abs(dy) < Math.abs(dx)) mobileSlideBack();
      }, { passive: true });
    }
    // Название комнаты — в шапку: раньше она пустовала, а название дублировалось в теле
    mobileSlideTo(2, roomName, nMembers((S.chats.find(c => c.id === roomId)?.members?.length) || 0));
  } else {
    // На десктопе — боковая панель между sidebar и чатом
    const panel = document.getElementById('subrooms-panel');
    panel.classList.add('open');
    const items = subs.map(s => {
      const unread = S.unread[s.id] || 0;
      const badge = unread ? `<span class="subroom-unread">${unread > 99 ? '99+' : unread}</span>` : '';
      const bg = avatarColor(s.id);
      // Как у комнат в списке чатов: эмодзи, если своя картинка не задана
      const letter = '🏠';
      // avatarColor отдаёт имя класса — как цвет он не работал, фон был прозрачным
      const avStyle = s.has_avatar
        ? `style="background-image:url('/api/chats/${s.id}/avatar');background-size:cover;background-position:center"`
        : '';
      return `<div class="subroom-item${S.activeSubroomId===s.id?' active':''}" onclick="openSubroom(${s.id})">
        <div class="sr-av av-orange" ${avStyle}>${s.has_avatar?'':letter}</div>
        <span class="sr-name">${esc(s.name)}</span>
        ${badge}
      </div>`;
    }).join('');
    panel.innerHTML = `<div class="subrooms-panel-header">${esc(roomName)}</div>${items}`;
  }
}

function closeSubroomsPanel(goBack) {
  if (_isMobile()) {
    const mp = document.getElementById('mobile-subrooms');
    if (mp) mp.innerHTML = '';
    if (goBack) {
      S.activeRoomId = null;
      S.activeSubroomId = null;
      mobileSlideTo(1);
    }
    return;
  }
  const panel = document.getElementById('subrooms-panel');
  panel.classList.remove('open');
  panel.innerHTML = '';
  if (goBack) {
    S.activeRoomId = null;
    S.activeSubroomId = null;
    renderChatList();
  }
}

async function openSubroom(subroomId) {
  S.activeSubroomId = subroomId;
  const parentId = S.activeRoomId;
  if (parentId && !_isMobile()) renderSubroomsPanel(parentId);
  await openChat(subroomId);
}

function chatName(chat) {
  if (chat.type==='group') return chat.name||'Группа';
  if (chat.type==='room') return chat.name||'Комната';
  const other = chat.members?.find(m=>m.id!==S.user.id);
  return other?.display_name||'Чат';
}

function chatAvatarClass(chat) {
  if (chat.type==='room') return 'av-orange';
  if (chat.type==='group') return 'av-green';
  const peer = getPeerUserId(chat);
  return peer ? userAvatarColor(peer) : avatarColor(chat.id);
}

function chatIcon(chat) {
  if (chat.type==='room') return '🏠';
  return initials(chatName(chat));
}

function tryLoadAvatar(el, url, fallbackText) {
  const cached = _avatarCache.get(url);
  if (cached === true) {
    el.style.backgroundImage = `url('${url}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
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
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  };
  img.onerror = () => {
    _avatarCache.set(url, false);
    el.style.backgroundImage = '';
    el.textContent = fallbackText;
  };
  img.src = url;
}

function applyAvatars() {
  document.querySelectorAll('[data-av-chat]').forEach(el => {
    const chatId = parseInt(el.dataset.avChat);
    const chat = S.chats.find(c => c.id === chatId)
      || Object.values(S.subrooms).flat().find(s => s.id === chatId);
    if (!chat) return;
    if (chat.type === 'direct') {
      const peerId = getPeerUserId(chat);
      if (!peerId) return;
      const url = `${httpProto()}://${S.server}/api/users/${peerId}/avatar?t=${S.avatarTs||0}`;
      tryLoadAvatar(el, url, initials(chatName(chat)));
    } else {
      const url = `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${S.avatarTs||0}`;
      tryLoadAvatar(el, url, chatIcon(chat));
    }
  });
  document.querySelectorAll('[data-av-user]').forEach(el => {
    const uid = parseInt(el.dataset.avUser);
    const user = S.allUsers.find(u => u.id === uid) || (uid === S.user.id ? S.user : null);
    if (!user) return;
    const url = `${httpProto()}://${S.server}/api/users/${uid}/avatar?t=${S.avatarTs||0}`;
    tryLoadAvatar(el, url, initials(user.display_name));
  });
}

const _chatRowCache = new Map(); // key -> html последней отрисовки
function syncChatListKeyed(list, items) {
  const seen = new Set();
  let prev = null;
  items.forEach(it => {
    seen.add(it.key);
    let el = list.querySelector(`[data-key="${CSS.escape(it.key)}"]`);
    if (el && _chatRowCache.get(it.key) !== it.html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = it.html;
      const fresh = tmp.firstElementChild;
      fresh.dataset.key = it.key;
      el.replaceWith(fresh);
      el = fresh;
    } else if (!el) {
      const tmp = document.createElement('div');
      tmp.innerHTML = it.html;
      el = tmp.firstElementChild;
      el.dataset.key = it.key;
      list.appendChild(el);
    }
    _chatRowCache.set(it.key, it.html);
    // Порядок: элемент должен стоять сразу после предыдущего
    if (prev) {
      if (prev.nextElementSibling !== el) list.insertBefore(el, prev.nextElementSibling);
    } else if (list.firstElementChild !== el) {
      list.insertBefore(el, list.firstElementChild);
    }
    prev = el;
  });
  // Удаляем строки, которых больше нет
  [...list.children].forEach(ch => {
    if (!ch.dataset.key || !seen.has(ch.dataset.key)) {
      if (ch.dataset.key) _chatRowCache.delete(ch.dataset.key);
      ch.remove();
    }
  });
}

function renderChatList() {
  const q = document.getElementById('search').value.toLowerCase();
  const list = document.getElementById('chats-list');
  const filtered = S.chats
    .filter(c=>chatName(c).toLowerCase().includes(q))
    .sort((a,b) => {
      if (a.type==='room' && b.type!=='room') return -1;
      if (a.type!=='room' && b.type==='room') return 1;
      // Комнаты — статичный порядок по имени, не двигаются от новых сообщений
      if (a.type==='room' && b.type==='room') return chatName(a).localeCompare(chatName(b), 'ru');
      const ta = a.last_message?.sent_at||0, tb = b.last_message?.sent_at||0;
      return tb-ta;
    });
  // Комнаты и закреплённое — разные вещи: раньше комнаты попадали в секцию
  // «Закреплённые», хотя пользователь их не закреплял
  const rooms  = filtered.filter(c => c.type === 'room');
  const pinned = filtered.filter(c => c.pinned && c.type !== 'room');
  const rest   = filtered.filter(c => !c.pinned && c.type !== 'room');

  // Режим поиска — редкий путь, полная перерисовка
  if (q || S.searchResults) {
    let html = '';
    if (!filtered.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Нет чатов</div>';
    } else {
      if (rooms.length) {
        html += `<div class="chat-list-section-label">Комнаты</div>`;
        html += rooms.map(c => renderChatRow(c)).join('');
      }
      if (pinned.length) {
        html += `<div class="chat-list-section-label" style="${rooms.length?'padding-top:12px':''}">Закреплённые</div>`;
        html += pinned.map(c => renderChatRow(c)).join('');
      }
      html += `<div class="chat-list-section-label" style="${(rooms.length||pinned.length)?'padding-top:12px':''}">Все чаты</div>`;
      html += rest.map(c => renderChatRow(c)).join('');
    }
    if (S.searchResults) {
      html += `<div class="chat-list-section-label" style="padding-top:12px">Сообщения</div>`;
      html += S.searchResults.length
        ? S.searchResults.map(r => renderSearchRow(r)).join('')
        : '<div style="padding:12px 20px;color:var(--muted);font-size:13px">Ничего не найдено</div>';
    }
    list.innerHTML = html;
    _chatRowCache.clear();
    applyAvatars();
    return;
  }

  // Обычный режим: keyed-обновление — меняются только реально изменившиеся строки,
  // остальные DOM-узлы (и их аватары) не трогаются — нет мигания при каждом событии
  const items = [];
  if (!filtered.length) {
    items.push({ key: 'empty', html: '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Нет чатов</div>' });
  } else {
    if (rooms.length) {
      items.push({ key: 'label-rooms', html: '<div class="chat-list-section-label">Комнаты</div>' });
      rooms.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
    }
    if (pinned.length) {
      items.push({ key: 'label-pinned', html: `<div class="chat-list-section-label" style="${rooms.length?'padding-top:12px':''}">Закреплённые</div>` });
      pinned.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
    }
    items.push({ key: 'label-all', html: `<div class="chat-list-section-label" style="${(rooms.length||pinned.length)?'padding-top:12px':''}">Все чаты</div>` });
    rest.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
  }
  syncChatListKeyed(list, items);
  applyAvatars();
}

// Галочка в списке чатов относится к последнему сообщению — обновляем её,
// когда приходит статус по нему. Иначе она оставалась бы прежней до перезагрузки.
function applyStatusToChatList(chatId, msgId, kind, readerId) {
  const chat = S.chats.find(c => c.id === chatId)
    || S.chats.find(c => (S.subrooms[c.id] || []).some(s => s.id === chatId));
  const lm = chat?.last_message;
  if (!lm || !lm.status || lm.id !== msgId || lm.sender_id !== S.user?.id) return;
  const key = 'list:' + kind + ':' + readerId;
  if (!S.statusApplied[msgId]) S.statusApplied[msgId] = new Set();
  if (S.statusApplied[msgId].has(key)) return;
  S.statusApplied[msgId].add(key);
  if (kind === 'read') {
    lm.status.read = Math.min(lm.status.total, lm.status.read + 1);
    lm.status.delivered = Math.max(lm.status.delivered, lm.status.read);
  } else {
    lm.status.delivered = Math.min(lm.status.total, lm.status.delivered + 1);
  }
  renderChatList();
}

// ── ВЫДВИЖНАЯ ЧАСТЬ ПОЛЯ ВВОДА ──
// Ответ, пересылка, вложение и правка живут внутри композера. Высота задаётся
// в пикселях по измеренному содержимому, а не через max-height: при коротком
// содержимом фиксированный max-height смазывает кривую ускорения.
function syncComposerSlot() {
  const slot = document.getElementById('composer-slot');
  const inner = slot?.firstElementChild;
  if (!slot || !inner) return;
  const open = [...inner.children].some(el => el.style.display !== 'none');
  slot.classList.toggle('open', open);
  slot.style.height = (open ? inner.offsetHeight : 0) + 'px';
}

// Плашки показываются и прячутся из разных мест — вместо правки каждого
// вызова следим за их видимостью наблюдателем.
function initComposerSlot() {
  const slot = document.getElementById('composer-slot');
  const inner = slot?.firstElementChild;
  if (!slot || !inner) return;
  slot._obs?.disconnect();
  slot._obs = new MutationObserver(syncComposerSlot);
  slot._obs.observe(inner, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
  syncComposerSlot();
}

function renderChatRow(c) {
  const name = chatName(c);
  const u = c.has_subrooms
    ? (S.subrooms[c.id]||[]).reduce((sum,s)=>sum+(S.unread[s.id]||0),0)
    : S.unread[c.id]||0;
  const m = c.has_subrooms
    ? (S.subrooms[c.id]||[]).reduce((sum,s)=>sum+(S.unreadMentions[s.id]||0),0)
    : S.unreadMentions[c.id]||0;
  const lm = c.last_message;
  let preview = lm ? (lm.deleted ? 'Сообщение удалено' : (lm.text ? lm.text.replace(/<[^>]*>/g, '') : (lm.attachment ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : '📎 ' + (lm.attachment.name || 'Файл')) : ''))) : 'Нет сообщений';
  if (preview.length>40) preview = preview.slice(0,40)+'…';
  // Черновик приоритетнее последнего сообщения (как в Telegram)
  const draft = (c.id !== S.activeChatId) ? S.drafts[c.id] : null;
  // Своё последнее сообщение помечаем «Вы:» — у удалённого пометки нет,
  // там и так стоит «Сообщение удалено»
  const minePreview = lm && !lm.deleted && lm.sender_id === S.user?.id;
  const previewHtml = draft
    ? `<span style="color:var(--danger)">Черновик:</span> ${esc(draft.slice(0,34))}`
    : (minePreview ? `<span style="color:var(--text2)">Вы:</span> ${esc(preview)}` : esc(preview));
  const time = lm ? fmtChatListTime(lm.sent_at) : '';
  const peerId = getPeerUserId(c);
  const dot = peerId ? presenceDot(peerId) : '';
  const pinIcon = c.pinned ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);opacity:.7"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>` : '';
  const muteIcon = S.mutedChats.has(c.id) ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);opacity:.7"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>` : '';
  // Галочки доставки/прочтения — только если последнее сообщение моё
  const myStatus = (lm && lm.sender_id === S.user?.id && !lm.deleted && lm.status)
    ? renderStatus(lm.status) : '';
  const isActive = c.id===S.activeChatId || c.id===S.activeRoomId;
  return `<div class="chat-item${isActive?' active':''}" data-chat-id="${c.id}" onclick="openChat(${c.id})" oncontextmenu="showChatCtx(event,${c.id})">
    <div class="av-wrap">
      <div class="av av-md ${chatAvatarClass(c)}${c.type==='direct'?' av-round':' av-sq'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
      ${dot}
    </div>
    <div class="info">
      <div class="ci-name" style="display:flex;align-items:center;gap:5px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        ${pinIcon}${muteIcon}${myStatus}
        <span class="ci-time">${time}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
        <span class="ci-preview ci-last" style="flex:1">${previewHtml}</span>
        ${m>0?`<div class="unread-badge" style="background:var(--accent)" title="Вас упомянули">@</div>`:''}
        ${u>0?`<div class="unread-badge">${u}</div>`:''}
      </div>
    </div>
  </div>`;
}

let _searchTimer = null;
function clearSearch() {
  const inp = document.getElementById('search');
  if (inp) { inp.value = ''; inp.focus(); }
  const btn = document.getElementById('search-clear');
  if (btn) btn.style.display = 'none';
  filterChats();
}
function filterChats() {
  renderChatList();
  const q = document.getElementById('search').value.trim();
  const btn = document.getElementById('search-clear');
  if (btn) btn.style.display = q ? '' : 'none';
  clearTimeout(_searchTimer);
  if (q.length < 2) {
    if (S.searchResults) { S.searchResults = null; renderChatList(); }
    return;
  }
  _searchTimer = setTimeout(async () => {
    const data = await api('GET', `/messages/search?q=${encodeURIComponent(q)}`);
    if (document.getElementById('search')?.value.trim() !== q) return; // запрос устарел
    S.searchResults = data?.results || [];
    renderChatList();
  }, 300);
}

function renderSearchRow(r) {
  const chat = S.chats.find(c => c.id === r.chat_id);
  const title = chat ? chatName(chat) : (r.sender_name || '');
  const snip = esc(r.snippet || '').replaceAll('\u0001', '<b>').replaceAll('\u0002', '</b>');
  return `<div class="chat-item" onclick="openSearchResult(${r.chat_id},${r.id})">
    <div class="av av-md ${userAvatarColor(r.sender_id || 0)} av-round">${initials(r.sender_name || '?')}</div>
    <div class="info">
      <div class="ci-name" style="display:flex;align-items:center;gap:5px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
        <span class="ci-time">${fmtTime(r.sent_at)}</span>
      </div>
      <div class="ci-preview" style="margin-top:2px">${esc(r.sender_name || '')}: ${snip}</div>
    </div>
  </div>`;
}

function openSearchResult(chatId, msgId) {
  const input = document.getElementById('search');
  if (input) input.value = '';
  S.searchResults = null;
  renderChatList();
  openChat(chatId, msgId);
}

// Заменяет содержимое chat-main, сохраняя #chat-input-bar (он внутри chat-main,
// поэтому при innerHTML = ... будет уничтожен — сначала извлекаем, потом возвращаем).
function setChatMainContent(html) {
  const main = document.getElementById('chat-main');
  const ib = document.getElementById('chat-input-bar');
  if (ib && ib.parentNode === main) main.removeChild(ib);
  main.innerHTML = html;
  if (ib) { ib.style.display = 'none'; main.appendChild(ib); }
}

// Полоса ввода лежит поверх ленты, поэтому её высота нужна ленте как нижний отступ.
// Высота меняется от ответа, вложения и многострочного текста — следим наблюдателем.
let _composerRO = null;
function watchComposerHeight() {
  const bar = document.getElementById('chat-input-bar') || document.getElementById('input-wrap');
  const main = document.getElementById('chat-main');
  if (!bar || !main) return;
  const apply = () => main.style.setProperty('--composer-h', bar.offsetHeight + 'px');
  apply();
  if (_composerRO) _composerRO.disconnect();
  try {
    _composerRO = new ResizeObserver(apply);
    _composerRO.observe(bar);
  } catch { _composerRO = null; }
}
// ── OPEN CHAT ──
// forceBottom — открыть заведомо у последнего сообщения, минуя якорь на первом
// непрочитанном: так возвращаются из глубины истории и после отправки сообщения
async function openChat(chatId, aroundId = null, forceBottom = false) {
  S.msgData.clear();
  let chat = S.chats.find(c=>c.id===chatId);
  if (!chat) {
    for (const [pid, subs] of Object.entries(S.subrooms)) {
      const sub = subs.find(s=>s.id===chatId);
      if (sub) { chat = { id: chatId, type: 'room', name: sub.name, parent_id: Number(pid), members: [] }; break; }
    }
  }
  if (chat?.has_subrooms) {
    S.activeChatId = null;
    S.activeRoomId = chatId;
    S.activeSubroomId = null;
    renderChatList();
    await loadSubrooms(chatId, { render: true });
    return;
  }
  if (!chat?.parent_id && !Object.values(S.subrooms).some(arr=>arr.some(s=>s.id===chatId))) {
    closeSubroomsPanel();
    S.activeRoomId = null;
    S.activeSubroomId = null;
  }
  if (S.editingMessageId) cancelEdit();
  S.activeChatId = chatId;
  _loadingChatId = chatId;
  S.chatHasMore = false;
  S.chatOldestId = null;
  S.chatHasMoreAfter = false;
  S.chatNewestId = null;
  S.statusApplied = {};
  _loadingMore = false;
  releaseAnchor(); // удержание от прошлого чата не должно мешать новому
  S.unread[chatId] = 0;
  S.unreadMentions[chatId] = 0;
  updateUnreadTotal();
  renderChatList();
  if (chat?.parent_id && !_isMobile()) renderSubroomsPanel(chat.parent_id);
  const name = chatName(chat);
  const isGroup = chat.type==='group';
  const isRoom = chat.type==='room';
  const isSubroom = !!chat?.parent_id;
  const isCreator = chat.created_by === S.user.id;
  const memberCount = chat.members?.length||0;
  const peerId = getPeerUserId(chat);
  const peerDot = peerId ? presenceDot(peerId) : '';
  const sub = isSubroom ? `# подкомната` : isRoom ? `🏠 Комната · ${nMembers(memberCount)}` : isGroup ? `${nMembers(memberCount)}` : (peerId ? peerStatusText(peerId) : 'Личный чат');
  const nameClickable = (isGroup || (isRoom && !isSubroom)) ? `style="cursor:pointer" onclick="openGroupInfo(${chatId})"` : '';

  const main = document.getElementById('chat-main');
  setChatMainContent(`
    <div class="chat-header">
      <button class="icon-btn mobile-back-btn" onclick="mobileBack()" title="Назад" style="flex-shrink:0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="av-wrap">
        <div class="av av-md ${chatAvatarClass(chat)}${chat.type==='direct'?' av-round':' av-sq'}" data-av-chat="${chat.id}">${chatIcon(chat)}</div>
        ${peerDot}
      </div>
      <div class="chat-header-info" ${nameClickable}>
        <div class="ch-name">${esc(name)}</div>
        <div class="ch-sub">${sub}</div>
      </div>
    </div>
    <div id="pin-bar" class="pin-bar" style="display:none"></div>
    <div class="messages-wrap">
      <div class="messages" id="messages"></div>
      <button id="scroll-bottom-btn" class="scroll-bottom-btn" onclick="scrollMessagesToBottom()" aria-label="К последним сообщениям">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
`);

  const inputBar = document.getElementById('chat-input-bar');
  inputBar.style.display = '';
  inputBar.innerHTML = `
    <div class="chat-input-wrap" id="input-wrap">
      <div class="composer-inner">
        <div id="typing-indicator" class="typing-indicator" style="display:none">
          <span class="typing-pill">
            <span class="typing-dots"><span></span><span></span><span></span></span>
            <span class="typing-name"></span><span class="typing-label"> печатает…</span>
          </span>
        </div>
        <div class="composer-pill" id="composer-pill">
          <div class="ep-grid" id="ep-grid">
            <div class="ep-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input id="ep-search-input" placeholder="Поиск смайла" autocomplete="off" oninput="filterEmoji(this.value)">
            </div>
            <div class="ep-tabs" id="ep-tabs"></div>
            <div class="ep-scroll" id="ep-scroll" onscroll="syncEmojiTabs()"></div>
          </div>
          <div class="composer-slot" id="composer-slot"><div class="composer-slot-inner">
          <div id="image-preview-bar" style="display:none" class="input-reply-bar">
            <img class="img-preview-thumb" src="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">
            <div class="attach-preview-icon" style="display:none;width:40px;height:40px;border-radius:6px;flex-shrink:0;background:var(--surface2);display:none;align-items:center;justify-content:center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="reply-bar-content">
              <div class="reply-bar-name">Вложение</div>
              <div class="reply-bar-text img-preview-name"></div>
            </div>
            <button onclick="clearImagePreview()" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div id="reply-bar" style="display:none" class="input-reply-bar">
            <img id="reply-bar-thumb" class="reply-bar-thumb" style="display:none" alt="">
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="reply-bar-name"></div>
              <div class="reply-bar-text" id="reply-bar-text"></div>
            </div>
            <button onclick="hideReplyBar()" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div id="forward-bar" style="display:none" class="input-reply-bar">
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="forward-bar-name"></div>
              <div class="reply-bar-text" id="forward-bar-text"></div>
            </div>
            <button onclick="hideForwardBar()" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div id="edit-bar" style="display:none" class="input-edit-bar">
            <span>Редактирование</span>
            <button onclick="cancelEdit()" class="icon-btn" style="width:24px;height:24px;color:var(--accent)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          </div></div>
          <div class="composer-main">
            <button class="composer-icon-btn" title="Эмодзи" onclick="toggleEmojiPicker(event)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 3 4 3 4-3 4-3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
            </button>
            <button class="composer-icon-btn" title="Прикрепить файл" onclick="pickFile()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <input type="file" id="file-input" accept="*" style="display:none" onchange="onFilePicked(this)">
            <textarea id="msg-input" rows="1" placeholder="Сообщение…" onkeydown="handleKey(event)" oninput="onMsgInput(this)"></textarea>
            <button class="send-btn" id="send-btn" onmousedown="event.preventDefault()" onclick="sendOrEdit()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  requestAnimationFrame(syncInputBarHeight);
  initComposerSlot();
  applyAvatars();
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='transparent'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none'; }
  // Отметку о прочтении отправляем после загрузки: иначе сервер успевает снять
  // read_at раньше, чем посчитает первое непрочитанное, и разделитель пропадает

  const msgsEl = document.getElementById('messages');
  if (msgsEl) {
    msgsEl.innerHTML = `<div class="skeleton-wrap">${[200,280,160,240,120].map((w,i) =>
      `<div class="skeleton-msg ${i%2===0?'theirs':'mine'}">
        <div class="skeleton-av"></div>
        <div class="skeleton-bubble" style="width:${w}px"></div>
      </div>`).join('')}</div>`;
  }
  const data = await api('GET', aroundId
    ? `/messages/chat/${chatId}?around=${aroundId}&limit=50`
    : `/messages/chat/${chatId}?limit=50${forceBottom ? '' : '&anchor=unread'}`);
  if (data && S.activeChatId === chatId) {
    S.chatHasMore = data.hasMore;
    S.chatHasMoreAfter = !!data.hasMoreAfter;
    S.chatOldestId = data.messages[0]?.id ?? null;
    S.chatNewestId = data.messages[data.messages.length - 1]?.id ?? null;
    renderMessages(data.messages);
    // Резерв под полосу ввода выставляем до постановки якоря, иначе он считается
    // по ещё не зарезервированной высоте
    watchComposerHeight();
    if (aroundId) {
      requestAnimationFrame(() => scrollToMsg(aroundId, true));
    } else {
      // Закреплённые приходят вместе с историей
      S.pins = data.pins || [];
      _pinIdx = 0;
      renderPinBar();
      const divider = insertUnreadDivider(data.first_unread_id);
      setAnchor(divider && !forceBottom
        ? { mode: 'el', id: data.first_unread_id, offset: 8 }
        : { mode: 'bottom' });
    }
    if (S.ws && isViewing()) S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId }));
    const msgsEl2 = document.getElementById('messages');
    if (msgsEl2) {
      msgsEl2.addEventListener('scroll', onMessagesScroll, { passive: true });
      // Прокрутка к якорю прошла до подписки — состояние кнопки «вниз» считаем сами
      onMessagesScroll();
      // Touch swipe-right on messages = reply (web only)
      addSwipeReply(msgsEl2);
    }
  }
  _loadingChatId = null;
  if (S.activeChatId !== chatId) return;

  // Показываем панель чата
  if (_isMobile()) {
    let _slideTitle = '';
    const _directChat = S.chats.find(c=>c.id===chatId);
    if (_directChat) {
      _slideTitle = chatName(_directChat);
    } else {
      for (const subs of Object.values(S.subrooms)) {
        const s = subs.find(s=>s.id===chatId);
        if (s) { _slideTitle = s.name || ''; break; }
      }
    }
    _mobileFromSubrooms = _mobilePanel === 2;
    const _slidePeerId = _directChat ? getPeerUserId(_directChat) : null;
    // Подпись та же, что и на десктопе: раньше на мобильном её не было вовсе,
    // и из открытой группы нельзя было узнать даже число участников
    const _slideSub = _slidePeerId ? peerStatusText(_slidePeerId) : sub;
    mobileSlideTo(3, _slideTitle, _slideSub);
    // Шапка ведёт в состав группы/комнаты — как кликабельная шапка на десктопе
    const _tw = document.getElementById('mtb-title-wrap');
    if (_tw) {
      const canOpenInfo = isGroup || (isRoom && !isSubroom);
      _tw.onclick = canOpenInfo ? () => openGroupInfo(chatId) : null;
      _tw.style.cursor = canOpenInfo ? 'pointer' : '';
    }
  } else {
    openMobileChat();
  }

  const inputEl = document.getElementById('msg-input');
  if (inputEl) {
    inputEl.value = S.drafts[chatId] || '';
    autoResize(inputEl);
    onMsgInput(inputEl, true);
  }
  if (!_isMobile()) inputEl?.focus();
}

// ── СВАЙП ПО СТРОКЕ ЧАТА (мобильный) ──
// Влево — заглушить/включить звук, вправо — закрепить/открепить.
// Раньше эти действия жили только за долгим нажатием, о котором не догадаться.
function initChatRowSwipe() {
  const list = document.getElementById('chats-list');
  if (!list || list._rowSwipeInit) return;
  list._rowSwipeInit = true;

  const ACT_AT = 64;      // порог срабатывания
  const MAX = 88;         // дальше строка не едет
  let row = null, x0 = 0, y0 = 0, locked = false, armed = false, dir = 0;

  const reset = (animate = true) => {
    if (!row) return;
    row.style.transition = animate ? 'transform .22s ease' : 'none';
    row.style.transform = '';
    const hint = row._hint;
    if (hint) { hint.remove(); row._hint = null; }
    row = null; locked = false; armed = false; dir = 0;
  };

  const showHint = (r, isMute) => {
    if (r._hint) return;
    const h = document.createElement('div');
    h.className = 'row-swipe-hint ' + (isMute ? 'left' : 'right');
    h.textContent = isMute
      ? (S.mutedChats.has(parseInt(r.dataset.chatId)) ? '🔔' : '🔕')
      : '📌';
    r.appendChild(h);
    r._hint = h;
  };

  list.addEventListener('touchstart', e => {
    if (!_isMobile() || e.touches.length !== 1) return;
    reset(false);
    row = e.target.closest('[data-chat-id]');
    if (!row) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    locked = false; armed = false; dir = 0;
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    if (!row) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (!locked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 10) {
        if (Math.abs(dy) > 10) { reset(false); }   // это прокрутка — не мешаем
        return;
      }
      locked = true;
      dir = dx > 0 ? 1 : -1;
      row.style.position = 'relative';
      showHint(row, dir < 0);
    }
    const shift = Math.max(-MAX, Math.min(MAX, dx * 0.6));
    row.style.transform = `translateX(${shift}px)`;
    row.style.transition = 'none';
    if (!armed && Math.abs(shift) >= ACT_AT * 0.6) { armed = true; haptic(8); row._hint?.classList.add('armed'); }
    else if (armed && Math.abs(shift) < ACT_AT * 0.6) { armed = false; row._hint?.classList.remove('armed'); }
  }, { passive: true });

  list.addEventListener('touchend', () => {
    if (!row || !locked) { reset(false); return; }
    const fire = armed;
    const chatId = parseInt(row.dataset.chatId);
    const wasDir = dir;
    reset(true);
    if (!fire) return;
    haptic(12);
    S.ctxChatId = chatId;
    if (wasDir < 0) sheetMuteChat(); else sheetPinChat();
  }, { passive: true });
}

// ── ПОТЯНУТЬ ВНИЗ: показать поиск и обновить список (мобильный) ──
// Поиск больше не занимает место постоянно, а список можно освежить жестом.
function initPullGestures() {
  const list = document.getElementById('chats-list');
  const search = document.querySelector('.sidebar-search');
  if (!list || !search || list._pullInit) return;
  list._pullInit = true;

  // Стартуем со свёрнутым поиском — на десктопе класс не действует (см. media)
  if (_isMobile()) search.classList.add('search-collapsed');

  const spinner = document.createElement('div');
  spinner.className = 'ptr-spinner';
  list.parentElement.style.position = list.parentElement.style.position || 'relative';
  list.parentElement.appendChild(spinner);

  const SEARCH_AT = 60;   // потянули на столько — раскрываем поиск
  const REFRESH_AT = 110; // и ещё дальше — обновляем список
  let y0 = 0, pulling = false, armedSearch = false, armedRefresh = false;

  list.addEventListener('touchstart', e => {
    if (!_isMobile() || e.touches.length !== 1) return;
    pulling = list.scrollTop <= 0;   // тянуть можно только с самого верха
    y0 = e.touches[0].clientY;
    armedSearch = armedRefresh = false;
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0) { pulling = false; spinner.classList.remove('visible'); return; }
    if (dy > SEARCH_AT && !armedSearch) {
      armedSearch = true; haptic(8);
      search.classList.remove('search-collapsed');
    }
    if (dy > REFRESH_AT && !armedRefresh) { armedRefresh = true; haptic(8); spinner.classList.add('visible'); }
    if (dy <= REFRESH_AT && armedRefresh) { armedRefresh = false; spinner.classList.remove('visible'); }
  }, { passive: true });

  list.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (armedRefresh) {
      spinner.classList.add('spinning');
      try { await loadChats(); } catch {}
      spinner.classList.remove('spinning', 'visible');
    }
  }, { passive: true });

  // Прокрутили список вниз — поиск снова прячется, если в нём ничего не набрано
  list.addEventListener('scroll', () => {
    if (!_isMobile()) return;
    const inp = document.getElementById('search');
    if (list.scrollTop > 40 && !inp?.value && document.activeElement !== inp) {
      search.classList.add('search-collapsed');
    }
  }, { passive: true });
}

// ── ТАКТИЛЬНЫЙ ОТКЛИК ──
// Короткий щелчок подтверждает жест раньше, чем глаз успеет заметить изменение
function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch {}
}

// ── SWIPE: назад (вправо) и ответ (влево) ──
const EDGE_BACK_ZONE = 30; // px от левого края — зона жеста «назад» (десктоп)

function addSwipeReply(container) {
  let startX = 0, startY = 0, swipeEl = null, dirLocked = false, backMode = false;
  let trackBase = 0, backLive = false, replyArmed = false;
  const chatMain = () => document.getElementById('chat-main');
  const track = () => document.getElementById('mobile-track');

  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    // На мобильном направление решает всё: вправо — назад, влево — ответ.
    // Раньше «назад» работал только из 30-пиксельной полоски у края.
    backMode = _isMobile() ? false : startX < EDGE_BACK_ZONE;
    swipeEl = backMode ? null : e.target.closest('[data-msg-id]');
    dirLocked = false; backLive = false; replyArmed = false;
    trackBase = -(Math.max(1, _mobilePanel) - 1) * window.innerWidth;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Десктоп: прежнее поведение от края экрана
    if (backMode) {
      if (!dirLocked) {
        if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
        dirLocked = true;
      }
      if (dx <= 0) return;
      e.preventDefault();
      const cm = chatMain();
      const shift = `translateX(${Math.min(dx, window.innerWidth)}px)`;
      if (cm) { cm.style.transform = shift; cm.style.transition = 'none'; }
      return;
    }

    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      dirLocked = true;
      // Вправо на мобильном — уходим назад, экран поедет за пальцем
      if (_isMobile() && dx > 0 && _mobilePanel > 1) { backLive = true; swipeEl = null; }
    }

    if (backLive) {
      e.preventDefault();
      const t = track();
      if (!t) return;
      // Сопротивление за порогом, чтобы жест ощущался «упругим»
      const w = window.innerWidth;
      const raw = Math.max(0, dx);
      const x = raw > w * 0.6 ? w * 0.6 + (raw - w * 0.6) * 0.25 : raw;
      t.style.transition = 'none';
      t.style.transform = `translateX(${trackBase + x}px)`;
      if (!replyArmed && raw > w * 0.35) { replyArmed = true; haptic(8); } // порог пройден
      else if (replyArmed && raw <= w * 0.35) replyArmed = false;
      return;
    }

    if (!swipeEl) return;
    if (dx >= 0) { // ответ — только свайп влево
      swipeEl.style.transform = ''; swipeEl.style.transition = 'transform .2s';
      swipeEl = null; return;
    }
    e.preventDefault();
    const shift = Math.max(dx * 0.45, -50);
    swipeEl.style.transform = `translateX(${shift}px)`;
    swipeEl.style.transition = 'none';
    if (!replyArmed && dx < -50) { replyArmed = true; haptic(8); }
    else if (replyArmed && dx >= -50) replyArmed = false;
  }, { passive: false });

  container.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;

    // Живой возврат на мобильном: доводим анимацию до конца или откатываем
    if (backLive) {
      const t = track();
      backLive = false;
      if (!t) return;
      t.style.transition = '';   // вернуть переход из CSS
      t.style.transform = '';    // снять инлайн — дальше работает класс панели
      if (dx > window.innerWidth * 0.35) mobileSlideBack();
      return;
    }

    if (backMode) {
      const cm = chatMain();
      if (cm) cm.style.transition = _CHAT_EASE;
      if (dx > window.innerWidth * 0.35) {
        if (cm) cm.style.transform = `translateX(${window.innerWidth}px)`;
        document.querySelector('.sidebar')?.classList.remove('mobile-hidden');
        setTimeout(() => mobileBack(false), 320);
      } else {
        if (cm) cm.style.transform = '';
        cm?.addEventListener('transitionend', () => {
          if (cm) { cm.style.transform = ''; cm.style.transition = ''; }
        }, { once: true });
      }
      backMode = false;
      return;
    }

    if (!swipeEl) return;
    swipeEl.style.transform = '';
    swipeEl.style.transition = 'transform .25s ease';
    if (dx < -50) {
      const msgId = parseInt(swipeEl.dataset.msgId);
      S.ctx.messageId = msgId;
      ctxReply();
    }
    swipeEl = null;
  }, { passive: true });
}

// ── LONG PRESS → CONTEXT MENU (touch) ──
let _longPressTimer = null;
let _lpX = 0, _lpY = 0;
const LONG_PRESS_MS = 500;   // 600 мс ощущались вязко
const LONG_PRESS_SLOP = 10;  // палец всегда дрожит: раньше отменяло даже 2px
document.addEventListener('touchstart', e => {
  const touch = e.touches[0];
  _lpX = touch.clientX; _lpY = touch.clientY;
  const msgEl = e.target.closest('[data-msg-id]');
  if (msgEl) {
    _longPressTimer = setTimeout(() => {
      const msgId = parseInt(msgEl.dataset.msgId);
      const sentAt = parseInt(msgEl.dataset.sentAt || '0');
      const isMine = parseInt(msgEl.dataset.senderId) === S.user?.id;
      haptic(12);
      showCtxMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: ()=>{} }, msgId, sentAt, isMine);
    }, LONG_PRESS_MS);
    return;
  }
  // Long-press по элементу списка чатов — выезжающий снизу блок с удалением
  const chatEl = e.target.closest('[data-chat-id]');
  if (chatEl) {
    _longPressTimer = setTimeout(() => {
      const chatId = parseInt(chatEl.dataset.chatId);
      haptic(12);
      openChatSheet(chatId);
    }, LONG_PRESS_MS);
  }
}, { passive: true });
document.addEventListener('touchend', () => { clearTimeout(_longPressTimer); _longPressTimer = null; }, { passive: true });
document.addEventListener('touchmove', e => {
  if (!_longPressTimer) return;
  const t = e.touches[0];
  // Отменяем только при осмысленном движении, а не при микродрожании пальца
  if (Math.abs(t.clientX - _lpX) > LONG_PRESS_SLOP || Math.abs(t.clientY - _lpY) > LONG_PRESS_SLOP) {
    clearTimeout(_longPressTimer); _longPressTimer = null;
  }
}, { passive: true });

// ── СМАЙЛЫ ──
// Разложены по разделам: панель открывается вкладками и липкими заголовками, как
// в телеграме, — плоскую ленту из четырёх сотен смайлов приходилось крутить наугад.
// Состав списка не менялся: только те, что рисуются и в Windows.
const EMOJI_GROUPS = [
  { key: 'smile', icon: '😀', name: 'Смайлы', items: [
    '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
    '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
    '😋','😛','😜','🤪','😝','🤭','🤫','🤔',
    '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
    '😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮',
    '🤧','🥵','🥶','🥴','😵','🤯','🤠','😎','🤓','🧐',
    '😕','😟','😯','😦','😧','😮','😲','😫','😩','😭',
    '😤','😠','😡','🤬','😈','👿','💀','☠️','🤡','👹',
    '👺','💩'] },
  { key: 'hands', icon: '👍', name: 'Жесты', items: [
    '👍','👎','👏','🙌','👐','🤲','🤝','🙏','✊','👊',
    '🤛','🤜','🤞','🤟','🤘','🤙','👈','👉','👆','👇',
    '☝️','✌️','🖖','🖐️','✋','🤚','👋','👌','💪','🖕',
    '💅','🤳'] },
  { key: 'people', icon: '🧑', name: 'Люди', items: [
    '👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓',
    '👴','👵','💂','👮','🕵️','👷','💃','🕺','👸','🤴',
    '🤰','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧜','🧝',
    '🧛','🧟','🧎','🧍','🚶','🏃','🤦','🤷'] },
  { key: 'nature', icon: '🐶', name: 'Животные и природа', items: [
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
    '🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅',
    '🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐢','🐍',
    '🌵','🌲','🌳','🌴','🌱','🌿','🍀','🌸','🌺','🌻',
    '🌹','🌷','🍁','🍂','🍃','🌾','🌊','🌙','☀️','🌈'] },
  { key: 'food', icon: '🍕', name: 'Еда и напитки', items: [
    '🍎','🍊','🍋','🍇','🍓','🍒','🍑','🥭','🍍','🥥',
    '🥝','🍅','🍆','🥑','🥕','🌽','🥦','🍕','🍔','🌮',
    '🍜','🍣','🍩','🎂','🍦','☕','🍺','🥂','🍾'] },
  { key: 'travel', icon: '✈️', name: 'Путешествия', items: [
    '🌍','🌎','🌏','✈️','🚀','🚂','🚗','🛸','⛵','🏔️'] },
  { key: 'obj', icon: '💡', name: 'Предметы', items: [
    '📱','💻','🖥️','📷','🎥','💡','🔦','💰','💎','🔑',
    '📚','📝','🎸','🎮','🎲','🏆','🎯','🎉','🎊','🎈'] },
  { key: 'sym', icon: '❤️', name: 'Символы', items: [
    '❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💕',
    '💞','💓','💗','💖','💘','💝','🔥','✨','💫','💯',
    '✅','❌','⭐','🌟','🔔','⏰','⌛','🚩'] },
];

// Плоский список — им пользуется панель реакций
const EMOJIS = EMOJI_GROUPS.flatMap(g => g.items);

// Слова для поиска. Пишем по-русски и коротко: ищем подстрокой, поэтому «смех»
// находится и по «сме». Название раздела тоже участвует в поиске.
const EMOJI_KEYWORDS = {
  '😀':'улыбка радость','😃':'улыбка радость','😄':'улыбка смех','😁':'улыбка зубы','😆':'смех жмурится',
  '😅':'смех пот неловко','🤣':'ржу смех катаюсь','😂':'смех слёзы плачу','🙂':'улыбка спокойно','🙃':'вверх ногами ирония',
  '😉':'подмигивает','😊':'улыбка смущение','😇':'ангел нимб','🥰':'влюблён сердечки','😍':'влюблён глаза сердца',
  '🤩':'восторг звёзды','😘':'поцелуй чмок','😗':'поцелуй','😚':'поцелуй','😙':'поцелуй',
  '😋':'вкусно язык','😛':'язык дразнит','😜':'язык подмигивает','🤪':'дурачится безумие','😝':'язык жмурится',
  '🤦':'фейспалм рука лицо','🤷':'пожимает плечами не знаю','🤭':'ой рука рот','🤫':'тихо тсс молчи','🤔':'думает размышляет вопрос',
  '🤐':'молчит рот на замок','🤨':'бровь недоверие','😐':'нейтрально','😑':'без эмоций','😶':'без рта молчание',
  '😏':'ухмылка','😒':'недовольство скука','🙄':'закатывает глаза','😬':'неловко зубы','🤥':'врёт нос',
  '😌':'облегчение спокойствие','😔':'грусть уныние','😪':'сонный устал','🤤':'слюни хочу','😴':'спит сон',
  '😷':'маска болезнь','🤒':'температура болеет','🤕':'травма бинт','🤢':'тошнит','🤮':'рвота',
  '🤧':'чихает насморк','🥵':'жарко жара','🥶':'холодно мороз','🥴':'пьяный кружится','😵':'без сознания',
  '🤯':'взрыв мозга шок','🤠':'ковбой','😎':'очки крутой','🤓':'ботаник очки','🧐':'монокль изучает',
  '😕':'растерян','😟':'беспокойство','😯':'удивление','😦':'испуг','😧':'страх',
  '😮':'удивление ого','😲':'шок изумление','😫':'устал измучен','😩':'страдание','😭':'плачет слёзы рыдает',
  '😤':'злость пар','😠':'сердится','😡':'ярость злой','🤬':'ругань мат','😈':'чертёнок хитрый',
  '👿':'демон злой','💀':'череп смерть','☠️':'череп кости опасность','🤡':'клоун','👹':'монстр',
  '👺':'гоблин','💩':'какашка',
  '👍':'палец вверх лайк класс','👎':'палец вниз дизлайк','👏':'аплодисменты хлопки браво','🙌':'руки вверх ура','👐':'ладони',
  '🤲':'ладони просьба','🤝':'рукопожатие договор','🙏':'спасибо мольба пожалуйста','✊':'кулак','👊':'кулак удар',
  '🤛':'кулак влево','🤜':'кулак вправо','🤞':'скрещенные пальцы удача','🤟':'люблю жест','🤘':'коза рок',
  '🤙':'позвони','👈':'палец влево','👉':'палец вправо','👆':'палец вверх','👇':'палец вниз',
  '☝️':'палец вверх внимание','✌️':'мир виктория два','🖖':'вулкан привет','🖐️':'ладонь пять','✋':'стоп ладонь',
  '🤚':'ладонь тыльная','👋':'привет пока машет','👌':'окей отлично','💪':'сила бицепс','🖕':'средний палец',
  '💅':'маникюр ногти','🤳':'селфи',
  '👶':'малыш ребёнок','🧒':'ребёнок','👦':'мальчик','👧':'девочка','🧑':'человек',
  '👱':'блондин','👨':'мужчина','🧔':'борода мужчина','👩':'женщина','🧓':'пожилой',
  '👴':'дедушка','👵':'бабушка','💂':'гвардеец','👮':'полицейский','🕵️':'детектив шпион',
  '👷':'строитель рабочий','💃':'танцует девушка','🕺':'танцует парень','👸':'принцесса','🤴':'принц',
  '🤰':'беременная','👼':'ангел','🎅':'дед мороз санта','🤶':'снегурочка миссис клаус','🦸':'супергерой',
  '🦹':'суперзлодей','🧙':'волшебник маг','🧚':'фея','🧜':'русалка','🧝':'эльф',
  '🧛':'вампир','🧟':'зомби','🧎':'на коленях','🧍':'стоит','🚶':'идёт пешеход','🏃':'бежит спешит',
  '🐶':'собака пёс щенок','🐱':'кот кошка','🐭':'мышь','🐹':'хомяк','🐰':'заяц кролик',
  '🦊':'лиса','🐻':'медведь','🐼':'панда','🐨':'коала','🐯':'тигр',
  '🦁':'лев','🐮':'корова','🐷':'свинья','🐸':'лягушка','🐵':'обезьяна',
  '🐔':'курица','🐧':'пингвин','🐦':'птица','🦆':'утка','🦅':'орёл',
  '🦉':'сова','🦇':'летучая мышь','🐺':'волк','🐗':'кабан','🐴':'лошадь конь',
  '🦄':'единорог','🐝':'пчела','🦋':'бабочка','🐢':'черепаха','🐍':'змея',
  '🌵':'кактус','🌲':'ёлка дерево','🌳':'дерево','🌴':'пальма','🌱':'росток',
  '🌿':'ветка зелень','🍀':'клевер удача','🌸':'цветок сакура','🌺':'цветок','🌻':'подсолнух',
  '🌹':'роза цветок','🌷':'тюльпан','🍁':'клён осень','🍂':'листья осень','🍃':'листья ветер',
  '🌾':'колосья','🌊':'волна море','🌙':'луна ночь','☀️':'солнце','🌈':'радуга',
  '🍎':'яблоко','🍊':'апельсин мандарин','🍋':'лимон','🍇':'виноград','🍓':'клубника',
  '🍒':'вишня черешня','🍑':'персик','🥭':'манго','🍍':'ананас','🥥':'кокос',
  '🥝':'киви','🍅':'помидор','🍆':'баклажан','🥑':'авокадо','🥕':'морковь',
  '🌽':'кукуруза','🥦':'брокколи','🍕':'пицца','🍔':'бургер','🌮':'тако',
  '🍜':'лапша суп','🍣':'суши','🍩':'пончик','🎂':'торт день рождения','🍦':'мороженое',
  '☕':'кофе чай','🍺':'пиво','🥂':'бокалы праздник','🍾':'шампанское',
  '🌍':'земля планета','🌎':'земля планета','🌏':'земля планета','✈️':'самолёт полёт','🚀':'ракета запуск',
  '🚂':'поезд','🚗':'машина авто','🛸':'нло тарелка','⛵':'парусник лодка','🏔️':'горы',
  '📱':'телефон смартфон','💻':'ноутбук','🖥️':'компьютер монитор','📷':'фотоаппарат фото','🎥':'камера видео',
  '💡':'лампочка идея','🔦':'фонарик','💰':'деньги мешок','💎':'алмаз бриллиант','🔑':'ключ',
  '📚':'книги','📝':'заметка запись','🎸':'гитара','🎮':'игра джойстик','🎲':'кубик игра',
  '🏆':'кубок победа','🎯':'мишень цель','🎉':'праздник хлопушка','🎊':'конфетти','🎈':'шарик',
  '❤️':'сердце любовь','🧡':'сердце оранжевое','💛':'сердце жёлтое','💚':'сердце зелёное','💙':'сердце синее',
  '💜':'сердце фиолетовое','🖤':'сердце чёрное','💔':'разбитое сердце','❣️':'сердце восклицание','💕':'два сердца',
  '💞':'сердца','💓':'сердце бьётся','💗':'сердце растёт','💖':'сердце блестит','💘':'сердце стрела',
  '💝':'сердце подарок','🔥':'огонь пожар круто','✨':'блёстки искры','💫':'звёзды кружится','💯':'сто отлично',
  '✅':'галочка готово да','❌':'крестик нет отмена','⭐':'звезда','🌟':'звезда блестит','🔔':'колокольчик уведомление',
  '⏰':'будильник время','⌛':'песочные часы ожидание','🚩':'флажок отметка',
};

const EMOJIS_DEFAULT_FREQ = ['👍','❤️','😂','🔥','😎','🎉','😭','🤔'];
function getEmojiFreq() { try { return JSON.parse(localStorage.getItem('emoji_freq')||'{}'); } catch { return {}; } }
function trackEmojiUse(em) { const f=getEmojiFreq(); f[em]=(f[em]||0)+1; try { localStorage.setItem('emoji_freq',JSON.stringify(f)); } catch {} }
function getFreqEmojis(n) {
  const f=getEmojiFreq();
  const sorted=Object.entries(f).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  for (const em of EMOJIS_DEFAULT_FREQ) { if (sorted.length>=n) break; if (!sorted.includes(em)) sorted.push(em); }
  return sorted.slice(0,n);
}

// Разделы панели: часто используемые собираются заново при каждом открытии
function emojiSections() {
  return [{ key: 'freq', icon: '🕘', name: 'Часто используемые', items: getFreqEmojis(16) }, ...EMOJI_GROUPS];
}

function emojiPickerHtml(sections) {
  return sections.map(g =>
    '<div class="ep-head" data-head="' + g.key + '">' + g.name + '</div>' +
    '<div class="ep-row" data-row="' + g.key + '">' +
      g.items.map(em => '<button class="emoji-item" data-em="' + em + '" onclick="insertEmoji(\'' + em + '\')">' + em + '</button>').join('') +
    '</div>').join('');
}

function closeEmojiPicker() {
  document.getElementById('ep-grid')?.classList.remove('open');
}

function toggleEmojiPicker(e) {
  e.stopPropagation();
  const panel = document.getElementById('ep-grid');
  if (!panel) return;
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }

  const sections = emojiSections();
  const tabs = document.getElementById('ep-tabs');
  const scroll = document.getElementById('ep-scroll');
  if (tabs) tabs.innerHTML = sections.map((g, i) =>
    '<button class="ep-tab" data-tab="' + g.key + '" title="' + g.name + '" aria-selected="' + (i === 0) + '" onclick="emojiTabTo(\'' + g.key + '\')">' + g.icon + '</button>').join('');
  if (scroll) { scroll.innerHTML = emojiPickerHtml(sections); scroll.scrollTop = 0; }
  const input = document.getElementById('ep-search-input');
  if (input) input.value = '';
  panel.classList.add('open');
  input?.focus();
}

// Считаем по рядам, а не по заголовкам: заголовки липкие, и их offsetTop/rect
// в прилипшем состоянии показывают не место раздела, а верх ленты
function emojiTabTo(key) {
  const scroll = document.getElementById('ep-scroll');
  const row = scroll?.querySelector('[data-row="' + key + '"]');
  const head = scroll?.querySelector('[data-head="' + key + '"]');
  if (!row) return;
  const delta = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (head?.offsetHeight || 0);
  scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'smooth' });
}

// Активная вкладка следует за прокруткой — как в телеграме
function syncEmojiTabs() {
  const scroll = document.getElementById('ep-scroll');
  if (!scroll) return;
  const top = scroll.getBoundingClientRect().top;
  let cur = null, first = null, last = null;
  scroll.querySelectorAll('[data-row]').forEach(row => {
    if (row.hidden) return;
    if (!first) first = row.dataset.row;
    last = row.dataset.row;
    if (row.getBoundingClientRect().top - top <= 30) cur = row.dataset.row;
  });
  // У дна последний раздел уже не может подняться к верху — подсвечиваем его сами
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4) cur = last;
  cur = cur || first;
  document.querySelectorAll('#ep-tabs .ep-tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.tab === cur)));
}

// Поиск: показываем одну ленту найденного, отсортированную по близости совпадения,
// и возвращаемся к её началу. Раньше совпадения оставались на своих местах в
// разделах — по запросу «сердце» лента внешне не менялась, и найденное приходилось
// искать прокруткой у самого низа.
function filterEmoji(q) {
  const scroll = document.getElementById('ep-scroll');
  if (!scroll) return;
  const query = (q || '').trim().toLowerCase();

  if (!query) {
    scroll.innerHTML = emojiPickerHtml(emojiSections());
    scroll.scrollTop = 0;
    syncEmojiTabs();
    return;
  }

  const seen = new Set();
  const hits = [];
  EMOJI_GROUPS.forEach(g => {
    const groupHit = g.name.toLowerCase().includes(query);
    g.items.forEach(em => {
      if (seen.has(em)) return;
      const words = (EMOJI_KEYWORDS[em] || '').split(' ');
      let score = 0;
      if (words.includes(query)) score = 3;                      // слово целиком
      else if (words.some(w => w.startsWith(query))) score = 2;  // начало слова
      else if (groupHit) score = 1.5;                            // совпало название раздела
      else if (words.some(w => w.includes(query))) score = 1;    // где-то внутри слова
      if (score) { seen.add(em); hits.push({ em, score }); }
    });
  });
  hits.sort((a, b) => b.score - a.score);

  scroll.innerHTML = hits.length
    ? '<div class="ep-head" data-head="found">Найдено: ' + hits.length + '</div>' +
      '<div class="ep-row" data-row="found">' + hits.map(h =>
        '<button class="emoji-item" data-em="' + h.em + '" onclick="insertEmoji(\'' + h.em + '\')">' + h.em + '</button>').join('') +
      '</div>'
    : '<div class="ep-miss">Ничего не нашлось</div>';
  scroll.scrollTop = 0;
  document.querySelectorAll('#ep-tabs .ep-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
}

function insertEmoji(em) {
  trackEmojiUse(em);
  const input = document.getElementById('msg-input');
  if (!input) return;
  const start = input.selectionStart, end = input.selectionEnd;
  input.value = input.value.slice(0, start) + em + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + em.length;
  input.focus();
  autoResize(input);
  closeEmojiPicker();
}

// ── RENDER MESSAGES ──
// Окно группировки: сообщения одного автора в пределах минуты идут одной серией —
// без повторного имени, со временем у каждого и галочкой только у последнего
const GROUP_WINDOW_SEC = 60;

function sameTimeGroup(a, b) {
  if (!a || !b) return false;
  if (a.sender_id !== b.sender_id) return false;
  const ta = new Date(a.sent_at * 1000), tb = new Date(b.sent_at * 1000);
  return ta.getHours() === tb.getHours() && ta.getMinutes() === tb.getMinutes() && ta.toDateString() === tb.toDateString();
}

// Разделитель «Непрочитанные сообщения» перед первым новым (как в Telegram).
// Идентификатор приходит с сервера — считать его на клиенте нельзя: счётчик
// расходится, часть могла быть прочитана с другого устройства.
function insertUnreadDivider(firstUnreadId) {
  if (!firstUnreadId) return null;
  const el = document.querySelector(`[data-msg-id="${firstUnreadId}"]`);
  if (!el) return null;
  const div = document.createElement('div');
  div.className = 'date-divider unread-divider';
  div.dataset.anchor = '1';
  div.innerHTML = '<span>Непрочитанные сообщения</span>';
  el.parentNode.insertBefore(div, el);
  return div;
}

// ── ЯКОРЬ ЛЕНТЫ ──
// Одной прокрутки при открытии чата недостаточно: после неё лента продолжает
// менять высоту — грузятся картинки, шрифты и вложения, появляется панель
// закреплённого, восстановленный черновик растит поле ввода. Поэтому держим
// якорь: до первого движения пользователя любое изменение возвращает ленту на
// место. Как только человек тронул прокрутку сам — отпускаем и больше не лезем,
// иначе получается тот самый «отскок» при догрузке.
let _anchor = null;          // { mode: 'bottom' } | { mode: 'el', id, offset }
let _anchorMO = null, _anchorRO = null, _anchorTimer = null;

function applyAnchor() {
  const c = document.getElementById('messages');
  if (!c || !_anchor) return;
  if (_anchor.mode === 'el') {
    const el = c.querySelector('[data-anchor="1"]') || c.querySelector(`[data-msg-id="${_anchor.id}"]`);
    // Элемент мог не доехать (сообщение удалили) — тогда обычное дно.
    // Считаем по rect, а не по offsetTop: у сообщения свой offsetParent (группа дня),
    // и offsetTop дал бы смещение относительно неё, а не относительно ленты
    if (el) {
      const shift = el.getBoundingClientRect().top - c.getBoundingClientRect().top - (_anchor.offset || 0);
      c.scrollTop = Math.max(0, c.scrollTop + shift);
      return;
    }
  }
  c.scrollTop = c.scrollHeight;
}

function releaseAnchor() {
  clearTimeout(_anchorTimer);
  _anchorTimer = null;
  _anchor = null;
  _anchorMO?.disconnect(); _anchorMO = null;
  _anchorRO?.disconnect(); _anchorRO = null;
  window.visualViewport?.removeEventListener('resize', applyAnchor);
  const c = document.getElementById('messages');
  c?.removeEventListener('load', applyAnchor, true);
  c?.removeEventListener('error', applyAnchor, true);
  c?.removeEventListener('wheel', releaseAnchor);
  c?.removeEventListener('touchmove', releaseAnchor);
  window.removeEventListener('keydown', _anchorKey);
}

const SCROLL_KEYS = ['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '];
function _anchorKey(e) { if (SCROLL_KEYS.includes(e.key)) releaseAnchor(); }

function setAnchor(anchor, ms = 2500) {
  releaseAnchor();
  const c = document.getElementById('messages');
  if (!c) return;
  _anchor = anchor;
  // Автопрокрутка к новым сообщениям — только если открылись у дна
  _stickBottom = anchor.mode === 'bottom';
  applyAnchor();

  // Что именно поменяло высоту — неважно: наблюдаем и за содержимым, и за
  // размерами ленты и полосы ввода
  try {
    _anchorMO = new MutationObserver(applyAnchor);
    _anchorMO.observe(c, { childList: true, subtree: true, characterData: true });
    _anchorRO = new ResizeObserver(applyAnchor);
    _anchorRO.observe(c);
    const bar = document.getElementById('chat-input-bar');
    if (bar) _anchorRO.observe(bar);
  } catch {}

  // Картинки без известных размеров сдвигают ленту в момент загрузки. Слушаем на
  // перехвате: load не всплывает, зато так ловятся и те картинки, что появятся
  // позже, — перебирать их по одной пришлось бы после каждой вставки
  c.addEventListener('load', applyAnchor, true);
  c.addEventListener('error', applyAnchor, true);
  document.fonts?.ready?.then(() => applyAnchor()).catch(() => {});
  window.visualViewport?.addEventListener('resize', applyAnchor);

  // Прокрутка руками отменяет удержание
  c.addEventListener('wheel', releaseAnchor, { passive: true });
  c.addEventListener('touchmove', releaseAnchor, { passive: true });
  window.addEventListener('keydown', _anchorKey);
  _anchorTimer = setTimeout(releaseAnchor, ms);
}

// Объединяет соседние .day-group с одинаковой датой (после prepend/append на стыке).
function mergeDayGroups(container) {
  const groups = Array.from(container.querySelectorAll(':scope > .day-group'));
  for (let i = 0; i < groups.length - 1; ) {
    const cur = groups[i];
    const next = groups[i + 1];
    const curDate = cur.querySelector('.date-divider span')?.textContent;
    const nextDate = next.querySelector('.date-divider span')?.textContent;
    if (curDate && curDate === nextDate) {
      next.querySelector('.date-divider')?.remove();
      while (next.firstChild) cur.appendChild(next.firstChild);
      next.remove();
      groups.splice(i + 1, 1);
    } else {
      i++;
    }
  }
}

// Прокруткой после отрисовки занимается якорь (setAnchor) — здесь только разметка
function renderMessages(msgs) {
  const container = document.getElementById('messages');
  if (!container) return;
  const chat = S.chats.find(c=>c.id===S.activeChatId);
  const isChatGroup = chat?.type==='group' || chat?.type==='room';
  msgs.forEach(m => { if (m.reactions?.length) S.reactions[m.id] = m.reactions; });
  let html = '';
  let lastDate = '';
  let lastSenderId = null;
  let lastSentAt = 0;
  msgs.forEach((m, i) => {
    const dateStr = fmtDate(m.sent_at);
    const dayChanged = dateStr !== lastDate;
    if (dayChanged) {
      if (lastDate !== '') html += `</div>`;
      html += `<div class="day-group"><div class="date-divider"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
      lastSenderId = null;
    }
    const grouped = !dayChanged && m.sender_id === lastSenderId && (m.sent_at - lastSentAt) < GROUP_WINDOW_SEC;
    const next = msgs[i + 1];
    const hideTime = !m.deleted && next && sameTimeGroup(m, next) && fmtDate(m.sent_at) === fmtDate(next.sent_at);
    const nextDayChanged = next ? fmtDate(next.sent_at) !== dateStr : true;
    const isLast = !next || nextDayChanged || next.sender_id !== m.sender_id || (next.sent_at - m.sent_at) >= GROUP_WINDOW_SEC;
    html += renderMsg(m, isChatGroup, hideTime, grouped, isLast);
    lastSenderId = m.sender_id;
    lastSentAt = m.sent_at;
  });
  if (lastDate !== '') html += `</div>`;
  container.innerHTML = html;
  reflowSeries();
}

function onMessagesScroll() {
  const container = document.getElementById('messages');
  if (!container) return;
  // Отслеживаем, находится ли пользователь у нижнего края (для авто-прокрутки)
  const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
  _stickBottom = dist < 80 && !S.chatHasMoreAfter;
  if (S.chatHasMore && !_loadingMore && container.scrollTop < 80) loadMoreMessages();
  if (S.chatHasMoreAfter && !_loadingMore && dist < 80) loadMoreAfter();
  const btn = document.getElementById('scroll-bottom-btn');
  if (btn) btn.classList.toggle('visible', dist > 300 || !!S.chatHasMoreAfter);
}

function scrollMessagesToBottom() {
  // Если пользователь загружал более старую позицию — перезагружаем чат с самых свежих
  if (S.chatHasMoreAfter && S.activeChatId) { openChat(S.activeChatId, null, true); return; }
  const container = document.getElementById('messages');
  if (!container) return;
  _stickBottom = true;
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

async function loadMoreMessages() {
  if (_loadingMore || !S.chatHasMore || !S.activeChatId || !S.chatOldestId) return;
  _loadingMore = true;
  const chatId = S.activeChatId;
  const data = await api('GET', `/messages/chat/${chatId}?before=${S.chatOldestId}&limit=50`);
  _loadingMore = false;
  if (!data || S.activeChatId !== chatId) return;
  const { messages, hasMore } = data;
  if (!messages.length) { S.chatHasMore = false; return; }
  S.chatHasMore = hasMore;
  S.chatOldestId = messages[0].id;
  prependMessages(messages, chatId);
}

// Догрузка вниз — после перехода вглубь истории (поиск / цитата)
async function loadMoreAfter() {
  if (_loadingMore || !S.chatHasMoreAfter || !S.activeChatId || !S.chatNewestId) return;
  _loadingMore = true;
  const chatId = S.activeChatId;
  const data = await api('GET', `/messages/chat/${chatId}?after=${S.chatNewestId}&limit=50`);
  _loadingMore = false;
  if (!data || S.activeChatId !== chatId) return;
  S.chatHasMoreAfter = !!data.hasMoreAfter;
  if (!data.messages.length) return;
  S.chatNewestId = data.messages[data.messages.length - 1].id;
  appendMessagesAfter(data.messages, chatId);
}

function appendMessagesAfter(msgs, chatId) {
  const container = document.getElementById('messages');
  if (!container) return;
  // Отбрасываем уже отрисованные: догрузка после реконнекта может пересечься
  // с сообщением, которое успело прийти по WS (как в appendMsg)
  msgs = msgs.filter(m => !(m.id > 0 && container.querySelector(`[data-msg-id="${m.id}"]`)));
  if (!msgs.length) return;
  const chat = S.chats.find(c => c.id === chatId);
  const isChatGroup = chat?.type === 'group' || chat?.type === 'room';
  msgs.forEach(m => { if (m.reactions?.length) S.reactions[m.id] = m.reactions; });
  // Продолжаем группировку от последнего отрендеренного сообщения
  const rendered = container.querySelectorAll('[data-msg-id]');
  const lastEl = rendered[rendered.length - 1];
  let lastSenderId = null, lastSentAt = 0;
  if (lastEl) {
    lastSentAt = parseInt(lastEl.dataset.sentAt) || 0;
    lastSenderId = parseInt(lastEl.dataset.senderId) || null;
  }
  let html = '';
  let lastDate = '';
  msgs.forEach((m, i) => {
    const dateStr = fmtDate(m.sent_at);
    const dayChanged = dateStr !== lastDate;
    if (dayChanged) {
      if (lastDate !== '') html += `</div>`;
      html += `<div class="day-group"><div class="date-divider"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
      lastSenderId = null;
    }
    const grouped = !dayChanged && m.sender_id === lastSenderId && (m.sent_at - lastSentAt) < GROUP_WINDOW_SEC;
    const next = msgs[i + 1];
    const hideTime = !m.deleted && next && sameTimeGroup(m, next) && fmtDate(m.sent_at) === fmtDate(next.sent_at);
    const nextDayChanged = next ? fmtDate(next.sent_at) !== dateStr : true;
    const isLast = !next || nextDayChanged || next.sender_id !== m.sender_id || (next.sent_at - m.sent_at) >= GROUP_WINDOW_SEC;
    html += renderMsg(m, isChatGroup, hideTime, grouped, isLast);
    lastSenderId = m.sender_id; lastSentAt = m.sent_at;
  });
  if (lastDate !== '') html += `</div>`;
  container.insertAdjacentHTML('beforeend', html);
  reflowSeries();
  mergeDayGroups(container);
}

function prependMessages(msgs, chatId) {
  const container = document.getElementById('messages');
  if (!container) return;
  const chat = S.chats.find(c => c.id === chatId);
  const isChatGroup = chat?.type === 'group' || chat?.type === 'room';
  msgs.forEach(m => { if (m.reactions?.length) S.reactions[m.id] = m.reactions; });

  let html = '';
  let lastDate = '';
  let lastSenderId = null;
  let lastSentAt = 0;
  msgs.forEach((m, i) => {
    const dateStr = fmtDate(m.sent_at);
    const dayChanged = dateStr !== lastDate;
    if (dayChanged) {
      if (lastDate !== '') html += `</div>`;
      html += `<div class="day-group"><div class="date-divider"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
      lastSenderId = null;
    }
    const grouped = !dayChanged && m.sender_id === lastSenderId && (m.sent_at - lastSentAt) < GROUP_WINDOW_SEC;
    const next = msgs[i + 1];
    const nextDayChanged = next ? fmtDate(next.sent_at) !== dateStr : true;
    const isLast = !next || nextDayChanged || next.sender_id !== m.sender_id || (next.sent_at - m.sent_at) >= GROUP_WINDOW_SEC;
    html += renderMsg(m, isChatGroup, false, grouped, isLast);
    lastSenderId = m.sender_id;
    lastSentAt = m.sent_at;
  });
  if (lastDate !== '') html += `</div>`;

  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;
  container.insertAdjacentHTML('afterbegin', html);
  reflowSeries();
  mergeDayGroups(container);
  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
}

// Сколько аватарок помещается в чип реакции. Числа рядом нет, полный список
// виден в подсказке при наведении.
const REACTION_AVATARS_MAX = 4;

// Аватарки поставивших складываются стопкой: первый сверху, каждый следующий
// уходит под него и выступает на треть. Обводка цветом фона отделяет соседние
// кружки — без неё при нахлёсте они сливаются.
function reactionAvatars(userIds) {
  const ids = String(userIds || '').split(',').filter(Boolean).map(Number);
  if (!ids.length) return '';
  const shown = ids.slice(0, REACTION_AVATARS_MAX);
  return `<span class="ra-stack">${shown.map((uid, k) => {
    const u = S.allUsers.find(x => x.id === uid) || (uid === S.user?.id ? S.user : null);
    const name = u?.display_name || '';
    const url = `${httpProto()}://${S.server}/api/users/${uid}/avatar?t=${S.avatarTs || 0}`;
    return `<span class="ra ${userAvatarColor(uid)}" style="z-index:${20 - k}" title="${esc(name)}">` +
      `${esc(initials(name) || '?')}` +
      `<img src="${url}" alt="" onerror="this.style.display='none'">` +
      `</span>`;
  }).join('')}</span>`;
}


// ── ЗАКРЕПЛЁННЫЕ СООБЩЕНИЯ ──
// Плашка под шапкой чата показывает ОДНО закрепление — самое свежее. Нажатие
// переносит к нему и сменяет плашку на следующее (более старое), по кругу.
// Рисок слева больше десяти не рисуем: они становятся неразличимы, остаётся счётчик.
const PIN_TICKS_MAX = 10;
let _pinIdx = 0;

function pinPreviewText(p) {
  if (!p) return '';
  const t = p.text ? p.text.replace(/<[^>]*>/g, '')
    : (p.attachment ? (p.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : '📎 ' + (p.attachment.name || 'Файл')) : '');
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}

function renderPinBar() {
  const bar = document.getElementById('pin-bar');
  if (!bar) return;
  const pins = S.pins || [];
  if (!pins.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  if (_pinIdx >= pins.length) _pinIdx = 0;
  const p = pins[_pinIdx];
  const many = pins.length > 1;
  const ticks = (many && pins.length <= PIN_TICKS_MAX)
    ? `<span class="pin-ticks">${pins.map((_, i) => `<span class="pin-tick${i === _pinIdx ? ' on' : ''}"></span>`).join('')}</span>`
    : '';
  const label = many
    ? `Закреплённое · ${_pinIdx + 1} из ${pins.length}`
    : 'Закреплённое сообщение';
  bar.style.display = 'flex';
  bar.innerHTML = `${ticks}
    <span class="pin-body" onclick="pinBarClick()">
      <span class="pin-slide" id="pin-slide">
        <span class="pin-label">${esc(label)}</span>
        <span class="pin-text">${esc(p.sender_name)}: ${esc(pinPreviewText(p))}</span>
      </span>
    </span>
    <button class="icon-btn pin-unpin" title="Открепить" onclick="unpinMessage(${p.message_id})">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
}

// Переход к закреплённому и смена плашки на следующее
function pinBarClick() {
  const pins = S.pins || [];
  if (!pins.length) return;
  const target = pins[_pinIdx];
  scrollToMsg(target.message_id, true);
  if (pins.length < 2) return;
  const slide = document.getElementById('pin-slide');
  if (!slide) { _pinIdx = (_pinIdx + 1) % pins.length; renderPinBar(); return; }
  slide.classList.add('out');
  setTimeout(() => {
    _pinIdx = (_pinIdx + 1) % pins.length;
    renderPinBar();
    const s2 = document.getElementById('pin-slide');
    if (!s2) return;
    s2.classList.add('in');
    s2.offsetHeight;
    s2.classList.remove('in');
  }, 240);
}

function pinMessage(id)   { S.ws?.send(JSON.stringify({ type: 'pin_message', message_id: id })); }
function unpinMessage(id) { S.ws?.send(JSON.stringify({ type: 'unpin_message', message_id: id })); }

function ctxTogglePin() {
  const id = S.ctx.messageId;
  hideCtxMenu();
  if (!id) return;
  (S.pins || []).some(p => p.message_id === id) ? unpinMessage(id) : pinMessage(id);
}

function renderReactions(msgId) {
  const counts = S.reactions[msgId] || [];
  if (!counts.length) return '';
  return `<div class="reactions">${counts.map(r => {
    const mine = String(r.user_ids || '').split(',').includes(String(S.user?.id));
    return `<button class="reaction-btn${mine ? ' mine' : ''}" data-msg-id="${msgId}" data-reaction="${esc(r.reaction)}" onclick="sendReaction(${msgId},'${r.reaction}')">` +
      `<span class="ra-emoji">${r.reaction}</span>${reactionAvatars(r.user_ids)}</button>`;
  }).join('')}</div>`;
}

// ── ТУЛТИП РЕАКЦИИ: кто поставил ──
// Имена тянем по наведению (в сообщениях их нет — раздували бы каждый ответ),
// секундной задержки хватает, чтобы запрос успел вернуться к показу.
const _REACTION_TIP_DELAY = 1000;
let _rtTimer = null, _rtEl = null, _rtBtn = null;
const _rtCache = new Map(); // msgId -> { reaction: [{user_id, display_name}] }

function _rtInvalidate(msgId) { _rtCache.delete(Number(msgId)); }

function _rtEnsureEl() {
  if (_rtEl && document.body.contains(_rtEl)) return _rtEl;
  _rtEl = document.createElement('div');
  _rtEl.className = 'reaction-tip';
  document.body.appendChild(_rtEl);
  return _rtEl;
}

function _rtHide() {
  clearTimeout(_rtTimer); _rtTimer = null; _rtBtn = null;
  if (_rtEl) _rtEl.classList.remove('visible');
}

async function _rtLoad(msgId) {
  const key = Number(msgId);
  if (_rtCache.has(key)) return _rtCache.get(key);
  const data = await api('GET', `/messages/${key}/reactions`);
  if (!data || data.error) return null;
  _rtCache.set(key, data);
  return data;
}

function _rtRender(btn, reaction, users) {
  const el = _rtEnsureEl();
  // Смайлик не показываем: подсказка привязана к конкретному чипу, он и так виден.
  // Предел выше прежних восьми — в чипе теперь только четыре аватарки, и подсказка
  // осталась единственным местом, где видно остальных. Совсем без предела нельзя:
  // подсказка не прокручивается (pointer-events: none), длинный список уедет за экран.
  const MAX = 15;
  const shown = users.slice(0, MAX);
  const rest = users.length - shown.length;
  el.innerHTML =
    shown.map(u => {
      const url = `${httpProto()}://${S.server}/api/users/${u.user_id}/avatar?t=${S.avatarTs || 0}`;
      return `<span class="rt-row">` +
        `<span class="rt-av ${userAvatarColor(u.user_id)}">${esc(initials(u.display_name) || '?')}` +
        `<img src="${url}" alt="" onerror="this.style.display='none'"></span>` +
        `<span class="rt-name">${esc(u.display_name)}</span></span>`;
    }).join('') +
    (rest > 0 ? `<span class="rt-row rt-more">и ещё ${rest}</span>` : '');

  // Интерфейс масштабируется через zoom (настройка размера), поэтому
  // getBoundingClientRect отдаёт визуальные пиксели, а style.left/top задаются в
  // CSS-пикселях. Коэффициент берём из самого элемента — не важно, где задан zoom.
  // offsetWidth/offsetHeight вдобавок не зависят от анимации transform.
  el.style.left = '0px'; el.style.top = '0px';
  const z = el.offsetWidth ? (el.getBoundingClientRect().width / el.offsetWidth) : 1;
  const tw = el.offsetWidth * z, th = el.offsetHeight * z;
  const r = btn.getBoundingClientRect();
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  // Показываем над бейджем; если сверху не помещается — под ним
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;
  el.style.left = Math.round(left / z) + 'px';
  el.style.top = Math.round(top / z) + 'px';
  el.classList.add('visible');
}

document.addEventListener('mouseover', e => {
  const btn = e.target.closest?.('.reaction-btn');
  if (!btn || btn === _rtBtn) return;
  _rtHide();
  _rtBtn = btn;
  const msgId = btn.dataset.msgId, reaction = btn.dataset.reaction;
  if (!msgId || !reaction) return;
  _rtTimer = setTimeout(async () => {
    try {
      const data = await _rtLoad(msgId);
      // За время запроса курсор мог уйти на другой бейдж
      if (_rtBtn !== btn || !data) return;
      const users = data[reaction];
      if (!users || !users.length) return;
      _rtRender(btn, reaction, users);
    } catch {}
  }, _REACTION_TIP_DELAY);
});

document.addEventListener('mouseout', e => {
  const btn = e.target.closest?.('.reaction-btn');
  if (btn && btn === _rtBtn && !btn.contains(e.relatedTarget)) _rtHide();
});

// Прокрутка/уход со страницы — прячем, иначе тултип «повиснет» в стороне
document.addEventListener('scroll', _rtHide, true);
window.addEventListener('blur', _rtHide);

function renderMsg(m, isChatGroup, hideTime = false, grouped = false, isLast = true) {
  return renderMsgIRC(m, !grouped, isLast);
}

// Пересчитывает границы серий по DOM: у первого сообщения серии выводится имя,
// у последнего — аватарка и срезанный угол. Проще держать это одной функцией,
// чем править классы соседей при каждой вставке, удалении и догрузке истории.
function reflowSeries() {
  const container = document.getElementById('messages');
  if (!container) return;
  const msgs = [...container.querySelectorAll('.irc-msg[data-msg-id]')]
    .filter(el => el.querySelector('.msg-bubble'));
  msgs.forEach((el, i) => {
    const sid = el.dataset.senderId, at = Number(el.dataset.sentAt);
    const day = el.closest('.day-group');
    const sameSeries = (other) => !!other && other.dataset.senderId === sid
      && Math.abs(Number(other.dataset.sentAt) - at) < GROUP_WINDOW_SEC
      && other.closest('.day-group') === day;
    el.classList.toggle('irc-first', !sameSeries(msgs[i - 1]));
    el.classList.toggle('irc-tail', !sameSeries(msgs[i + 1]));
  });
}

function rolePillHtml(tag) {
  if (!tag) return '';
  return `<span class="role-pill ${senderNameClass(tag)}">${esc(tag)}</span>`;
}

// Сообщение без текста кроме смайликов показываем крупно и без пузыря
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
function isEmojiOnly(text) {
  const t = (text || '').trim();
  if (!t || t.length > 12) return false;
  try { return EMOJI_ONLY_RE.test(t) && /\p{Extended_Pictographic}/u.test(t); } catch { return false; }
}

// Цвет тега считается из его текста: одна и та же надпись всегда даёт один цвет,
// и латиница с кириллицей тут равноправны — хеш идёт по кодам символов. Раньше
// цветными были только developer и tester, всё остальное серым.
const TAG_COLORS = 8;
function senderNameClass(tag) {
  const t = (tag || '').trim().toLowerCase();
  if (!t) return 'default';
  // FNV-1a: простое умножение на 31 давало перекос — коды кириллицы идут подряд,
  // и половина тегов попадала в один цвет
  let h = 2166136261;
  for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'tag-' + (h % TAG_COLORS + 1);
}

function renderMsgIRC(m, isFirst = true, isTail = true) {
  if (m.status && m.id > 0) S.msgStatus[m.id] = { ...m.status };
  const isSystem = m.sender_username === '__system__';
  if (m.id > 0 && !isSystem) S.msgData.set(m.id, { forwardData: m.forward_data || null, senderId: m.sender_id, senderName: m.sender_name, senderIsBot: !!m.sender_is_bot, text: m.text, attachment: m.attachment });
  const mine = m.sender_id===S.user.id;
  const time = fmtTime(m.sent_at);
  const isDeleted = m.deleted;

  if (isSystem && !isDeleted) {
    return `<div class="irc-msg" data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}" oncontextmenu="event.preventDefault()" style="padding:2px 0">
      <div style="width:100%;display:flex;justify-content:center;padding:0 20px;box-sizing:border-box">
        <div style="background:rgba(210,55,55,.08);border:1px solid rgba(210,55,55,.2);border-radius:14px;padding:5px 14px;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:6px;max-width:80%">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.55"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span style="word-break:break-word">${esc(m.text)}</span>
          <span style="font-size:10px;opacity:.4;flex-shrink:0;margin-left:2px">${time}</span>
        </div>
      </div>
    </div>`;
  }

  const bodyText = isDeleted ? '<em class="irc-deleted">Сообщение удалено</em>' : m.sender_is_bot ? m.text + (m.edited_at ? ' <span class="edited-tag">изм.</span>' : '') : linkifyText(m.text) + (m.edited_at?` <span class="edited-tag">изм.</span>`:'');
  const statusIcon = mine && !isDeleted ? renderStatus(m.status) : '';
  const reactionsHtml = isDeleted ? '' : renderReactions(m.id);
  const senderName = esc(m.sender_name);
  const avColor = userAvatarColor(m.sender_id, m.sender_tag);
  // аватарка 32px вмещает обе буквы; обрезка до одной осталась от прежних 28px
  const avLetter = initials(m.sender_name);
  const avImg = `<img src="${httpProto()}://${S.server}/api/users/${m.sender_id}/avatar" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none'">`;
  const rAtt = m.reply_attachment;
  const rIsImg = rAtt?.mime?.startsWith('image/');
  const rThumbHtml = rAtt && !m.reply_deleted ? (rIsImg
    ? `<img src="${httpProto()}://${S.server}${rAtt.thumb || rAtt.url}" class="irc-reply-thumb" onerror="this.style.display='none'">`
    : `<div class="irc-reply-thumb irc-reply-file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`
  ) : '';
  const rTextRaw = m.reply_deleted
    ? 'Сообщение удалено'
    : (m.reply_text || (rAtt ? (rIsImg ? '📷 Фото' : ('📎 ' + (rAtt.name || 'Файл'))) : ''));
  // цвет цитаты берём у автора цитируемого: своё — цветом своего пузыря,
  // чужое — цветом его тега. Стрелка не нужна: полоса слева и так читается.
  const _replyTagCls = senderNameClass(m.reply_sender_tag);
  const replyCls = m.reply_sender_id === S.user.id
    ? 'reply-mine'
    : 'reply-' + (_replyTagCls === 'default' ? 'plain' : _replyTagCls);
  const replyHtml = m.reply_to_id ? `
    <div class="irc-reply ${replyCls}" onclick="scrollToMsg(${m.reply_to_id})">
      ${rThumbHtml}
      <div class="irc-reply-body">
        <div class="irc-reply-name">${esc(m.reply_sender_name || '')}</div>
        <div class="irc-reply-text">${m.reply_sender_is_bot ? (rTextRaw || '') : mdLite(esc(rTextRaw || ''))}</div>
      </div>
    </div>` : '';

  const fd = m.forward_data;
  const forwardHtml = (!isDeleted && fd) ? (() => {
    const fdIsImg = fd.attachment?.mime?.startsWith('image/');
    const fdThumb = fd.attachment?.url ? (fdIsImg
      ? `<img src="${httpProto()}://${S.server}${fd.attachment.thumb || fd.attachment.url}" class="irc-reply-thumb" onerror="this.style.display='none'">`
      : `<div class="irc-reply-thumb irc-reply-file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`) : '';
    const fdText = fd.text || (fd.attachment ? (fdIsImg ? '📷 Фото' : '📎 ' + (fd.attachment.name || 'Файл')) : '');
    return `<div class="irc-reply irc-forward-block">${fdThumb}<div class="irc-reply-body"><div class="irc-reply-name">Переслано от ${esc(fd.name || '')}</div><div class="irc-reply-text">${fd.is_bot ? fdText : mdLite(esc(fdText))}</div></div></div>`;
  })() : '';

  const actionsHtml = '';

  // аватарка есть у каждого сообщения — CSS показывает её только у последнего в серии
  const avCol = `<div class="irc-av av av-round ${avColor}" style="position:relative;flex-shrink:0">${avLetter}${avImg}</div>`;

  const ircTagHtml = m.sender_tag ? rolePillHtml(m.sender_tag) : '';
  const senderCls = senderNameClass(m.sender_tag);
  // имя и тег стоят над пузырём; у своих и внутри серии их скрывает CSS
  const header = `<div class="irc-header">
      <span class="irc-name msg-sender-name ${senderCls}${mine?' mine':''}">${senderName}</span>${ircTagHtml}
    </div>`;
  const metaHtml = `<div class="irc-meta"><span class="status-wrap">${statusIcon}</span><span class="irc-time">${time}</span></div>`;

  const att = m.attachment;
  let attachHtml = '';
  if (!isDeleted && att?.url) {
    if (att.expired) {
      const isImg = att.mime?.startsWith('image/');
      attachHtml = isImg
        ? `<div class="bubble-image bubble-expired"><span>Файл удалён</span></div>`
        : `<div class="bubble-file bubble-expired">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div class="bubble-file-info"><div class="bubble-file-name" style="opacity:.4">${att.name||'Файл'}</div><div class="bubble-file-size">Файл удалён</div></div>
          </div>`;
    } else {
      const attUrl = `${httpProto()}://${S.server}${att.url}`;
      if (att.mime?.startsWith('image/')) {
        attachHtml = `<div class="bubble-image" onclick="openLightbox('${attUrl}','${(att.name||'image').replace(/'/g,"\\'")}')"><img src="${httpProto()}://${S.server}${att.thumb || att.url}" loading="lazy"></div>`;
      } else {
        const sizeFmt = att.size ? (att.size > 1048576 ? (att.size/1048576).toFixed(1)+' МБ' : Math.round(att.size/1024)+' КБ') : '';
        attachHtml = `<div class="bubble-file" onclick="downloadAttachment('${attUrl}','${(att.name||'file').replace(/'/g,"\\'")}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div class="bubble-file-info"><div class="bubble-file-name">${att.name||'Файл'}</div>${sizeFmt?`<div class="bubble-file-size">${sizeFmt}</div>`:''}</div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>`;
      }
    }
  }

  const attDataAttrs = att?.url ? ` data-msg-att-url="${esc(att.url)}" data-msg-att-thumb="${esc(att.thumb||'')}" data-msg-att-mime="${esc(att.mime||'')}" data-msg-att-name="${esc(att.name||'')}"` : '';
  // пузырь, в котором нет ничего кроме картинки: кадр занимает его целиком, а время
  // и реакции ложатся поверх. С подписью, цитатой или пересылкой — обычное поведение
  const bareImage = !isDeleted && !m.text && !m.reply_to_id && !m.forward_data
    && !!att?.url && !att.expired && !!att.mime?.startsWith('image/');
  // сообщение из одного смайлика показываем без пузыря — он проступает по наведению
  const emojiOnly = !isDeleted && !m.attachment && !m.reply_to_id && !m.forward_data && isEmojiOnly(m.text);
  const posCls = (isFirst ? ' irc-first' : '') + (isTail ? ' irc-tail' : '') + (emojiOnly ? ' emoji-msg' : '');

  return `<div class="irc-msg${posCls}${m._optimistic?' msg-optimistic':''}"${mine?` data-mine="1"`:``} data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}"${attDataAttrs}${m._optimistic?' data-optimistic="1"':''}
    oncontextmenu="${!isDeleted?`showCtxMenu(event,${m.id},${m.sent_at},${mine})`:'event.preventDefault()'}">
    ${avCol}
    <div class="irc-content" ondblclick="${!isDeleted?`dblReply(${m.id})`:''}">
      ${header}
      <div class="msg-bubble${bareImage ? ' bubble-photo' : ''}">
        ${replyHtml}
        ${forwardHtml}
        ${attachHtml}
        ${m.text || isDeleted ? `<div class="irc-text${isDeleted?' irc-deleted':''}${emojiOnly?' emoji-only':''}">${bodyText}</div>` : ''}
        ${metaHtml}
        ${reactionsHtml}
      </div>
    </div>
    ${actionsHtml}
  </div>`;
}

function renderStatus(status) {
  if (!status) return '';
  const { delivered, read, total } = status;
  if (total === 0) return '';
  let cls, title;
  // «Прочитано» (синие галочки) — только когда прочитали ВСЕ получатели.
  // В группе при частичном прочтении показываем «Прочитано N из total».
  if (read >= total)      { cls = 'status-read';       title = 'Прочитано'; }
  else if (read > 0)      { cls = 'status-delivered';  title = `Прочитано ${read} из ${total}`; }
  else if (delivered > 0) { cls = 'status-delivered';  title = 'Доставлено'; }
  else                    { cls = 'status-sent';        title = 'Отправлено'; }
  const double = delivered > 0 || read > 0;
  return `<span class="msg-status ${cls}" title="${title}">
    <svg width="13" height="9" viewBox="0 0 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${double
        ? '<polyline points="1,5.5 3.5,8 9,1"/><polyline points="7,5.5 9.5,8 15,1"/>'
        : '<polyline points="7,5.5 9.5,8 15,1"/>'}
    </svg>
  </span>`;
}

// Умный скролл к низу после появления сообщения: своё — всегда, чужое — если пользователь
// у дна. Учитывает асинхронную догрузку картинок и вложений (scrollHeight после загрузки
// вырастет), повторно вызывая прокрутку при `load`/`error` на каждом img.
function stickToBottom(container, newEl, m, distBefore) {
  // Отступ от низа берём ДО вставки сообщения: иначе высокое вложение (картинка)
  // само же выталкивает dist за порог, и автопрокрутка не срабатывает —
  // сообщение остаётся под полем ввода.
  const dist = distBefore !== undefined ? distBefore
    : container.scrollHeight - container.scrollTop - container.clientHeight;
  if (!(m._optimistic || dist < 120)) return;
  _stickBottom = true;
  const behavior = m._optimistic ? 'instant' : 'smooth';
  const scrollDown = () => container.scrollTo({ top: container.scrollHeight, behavior });
  // Повторные вызовы приходят по загрузке картинок: к этому моменту пользователь
  // мог уйти вверх, и дёргать ленту обратно нельзя.
  const toBottom = () => {
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 200) scrollDown();
  };
  requestAnimationFrame(scrollDown);
  newEl?.querySelectorAll('img').forEach(img => {
    if (img.complete) return;
    img.addEventListener('load',  toBottom, { once: true });
    img.addEventListener('error', toBottom, { once: true });
  });
}

function appendMsg(m) {
  const container = document.getElementById('messages');
  if (!container) return;
  if (m.id > 0 && container.querySelector(`[data-msg-id="${m.id}"]`)) return;
  const distBefore = container.scrollHeight - container.scrollTop - container.clientHeight;
  const chat = S.chats.find(c=>c.id===S.activeChatId);
  const allMsgs = [...container.querySelectorAll('[data-msg-id]')];
  const lastEl = allMsgs[allMsgs.length - 1];
  let grouped = false;
  if (lastEl && !m.deleted) {
    const prevSenderId = parseInt(lastEl.dataset.senderId || '0');
    const prevTime = parseInt(lastEl.dataset.sentAt || '0');
    // Группировка не работает через границу дней
    const prevDate = fmtDate(prevTime);
    if (prevDate === fmtDate(m.sent_at)) {
      grouped = sameTimeGroup({ sender_id: prevSenderId, sent_at: prevTime }, m);
    }
  }
  const isChatGroupAppend = chat?.type==='group' || chat?.type==='room';
  const msgHtml = renderMsg(m, isChatGroupAppend, false, grouped, true);
  const msgDate = fmtDate(m.sent_at);
  // Ищем последний .day-group; если его дата совпадает — дописываем сообщение туда, иначе создаём новый
  const groups = container.querySelectorAll(':scope > .day-group');
  const lastGroup = groups[groups.length - 1];
  const lastGroupDate = lastGroup?.querySelector('.date-divider span')?.textContent;
  if (lastGroup && lastGroupDate === msgDate) {
    lastGroup.insertAdjacentHTML('beforeend', msgHtml);
  } else {
    container.insertAdjacentHTML('beforeend',
      `<div class="day-group"><div class="date-divider"><span>${msgDate}</span></div>${msgHtml}</div>`);
  }
  const allNewMsgs = container.querySelectorAll('[data-msg-id]');
  const newEl = allNewMsgs[allNewMsgs.length - 1];
  if (newEl && !m._optimistic) newEl.classList.add('msg-new');
  reflowSeries();
  stickToBottom(container, newEl, m, distBefore);
}

function updateMsgInDOM(m) {
  const el = document.querySelector(`[data-msg-id="${m.id}"]`);
  if (!el) return;
  const chat = S.chats.find(c=>c.id===S.activeChatId);
  el.outerHTML = renderMsg(m, chat?.type==='group' || chat?.type==='room',
    false, !el.classList.contains('irc-first'), el.classList.contains('irc-tail'));
  reflowSeries();
}

// ── REACTIONS ──
function sendReaction(messageId, reaction) {
  if (S.ws?.readyState === 1) {
    S.ws.send(JSON.stringify({ type: 'react', message_id: messageId, reaction }));
  }
}
function ctxReact(reaction) {
  trackEmojiUse(reaction);
  hideCtxMenu();
  sendReaction(S.ctx.messageId, reaction);
}

function showReactionPicker(e) {
  e.stopPropagation();
  const menu = document.getElementById('ctx-menu');
  const x = parseInt(menu.style.left);
  const y = parseInt(menu.style.top);
  menu.classList.remove('open');
  const picker = document.getElementById('reaction-picker');
  const _rpFreq = getFreqEmojis(7);
  picker.innerHTML =
    `<div class="rp-freq">${_rpFreq.map(em=>`<button class="rp-btn" onclick="pickerReact('${em}')">${em}</button>`).join('')}</div>` +
    `<div class="rp-sep"></div>` +
    `<div class="rp-scroll"><div class="rp-grid">${EMOJIS.map(em=>`<button class="rp-btn" onclick="pickerReact('${em}')">${em}</button>`).join('')}</div></div>`;
  picker.style.left = '-9999px'; picker.style.top = '-9999px';
  picker.classList.add('open');
  const pw = picker.offsetWidth, ph = picker.offsetHeight;
  const margin = 6;
  const _z = (S.settings.uiScale || 100) / 100;
  // Вьюпорт переводим в те же единицы, что и style.left/top: при масштабе интерфейса
  // они не совпадают с window.innerWidth, и меню у края экрана уезжало за границу
  const vw = window.innerWidth / _z, vh = window.innerHeight / _z;
  let px = x, py = y;
  if (px + pw + margin > vw) px = vw - pw - margin;
  if (py + ph + margin > vh) py = y - ph;
  if (py < margin) py = margin;
  if (px < margin) px = margin;
  picker.style.left = px + 'px';
  picker.style.top = py + 'px';
}

function pickerReact(reaction) {
  trackEmojiUse(reaction);
  document.getElementById('reaction-picker').classList.remove('open');
  sendReaction(S.ctx.messageId, reaction);
}

function hideReactionPicker() {
  document.getElementById('reaction-picker').classList.remove('open');
}

// ── SEND / EDIT ──
// ── @MENTION AUTOCOMPLETE ──
let _mentionIdx = -1;

function _getMentionQuery(el) {
  const m = el.value.slice(0, el.selectionStart).match(/@(\S*)$/);
  return m ? m[1] : null;
}
function _mentionMembers() {
  const chat = S.chats.find(c => c.id === S.activeChatId);
  if (chat?.type !== 'group' && chat?.type !== 'room') return null;
  return (chat.members || []).filter(m => m.id !== S.user.id);
}
function _updateMentionPopup(el) {
  const query = _getMentionQuery(el);
  const all = _mentionMembers();
  if (query === null || !all) { hideMentionPopup(); return; }
  const q = query.toLowerCase();
  const filtered = q
    ? all.filter(m => (m.display_name||'').toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
    : all;
  if (!filtered.length) { hideMentionPopup(); return; }
  const popup = document.getElementById('mention-popup');
  _mentionIdx = -1;
  popup.innerHTML = filtered.map(m =>
    `<div class="mention-item" data-name="${esc(m.display_name||m.username)}" onclick="insertMention('${esc(m.display_name||m.username)}')">
      <div class="av av-sm av-round ${userAvatarColor(m.id, m.tag)}" data-av-user="${m.id}">${initials(m.display_name)}</div>
      <div><div class="mn-name">${esc(m.display_name||m.username)}</div><div class="mn-login">@${esc(m.username)}</div></div>
    </div>`
  ).join('');
  applyAvatars();
  const pill = document.getElementById('composer-pill');
  if (pill) {
    const rect = pill.getBoundingClientRect();
    popup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    popup.style.left = rect.left + 'px';
    popup.style.width = Math.min(rect.width, 280) + 'px';
    popup.style.display = 'block';
  }
}
function hideMentionPopup() {
  const p = document.getElementById('mention-popup');
  if (p) { p.style.display = 'none'; p.innerHTML = ''; }
  _mentionIdx = -1;
}
function _mentionMove(dir) {
  const popup = document.getElementById('mention-popup');
  const items = popup?.querySelectorAll('.mention-item');
  if (!items?.length) return;
  items[_mentionIdx]?.classList.remove('mn-active');
  _mentionIdx = (_mentionIdx + dir + items.length) % items.length;
  items[_mentionIdx].classList.add('mn-active');
  items[_mentionIdx].scrollIntoView({ block: 'nearest' });
}
function insertMention(name) {
  const el = document.getElementById('msg-input');
  if (!el) return;
  const cursor = el.selectionStart;
  const before = el.value.slice(0, cursor);
  const m = before.match(/@(\S*)$/);
  if (!m) return;
  const newBefore = before.slice(0, before.length - m[0].length) + '@' + name + ' ';
  el.value = newBefore + el.value.slice(cursor);
  el.selectionStart = el.selectionEnd = newBefore.length;
  el.focus();
  autoResize(el);
  hideMentionPopup();
}

function handleKey(e) {
  const popup = document.getElementById('mention-popup');
  if (popup?.style.display !== 'none' && popup?.innerHTML) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _mentionMove(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _mentionMove(-1); return; }
    if (e.key === 'Escape')    { hideMentionPopup(); e.stopPropagation(); return; }
    if (e.key === 'Enter' && _mentionIdx >= 0) {
      e.preventDefault();
      popup.querySelectorAll('.mention-item')[_mentionIdx]?.click();
      return;
    }
  }
  if (e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendOrEdit(); }
}

const typingTimers = {};
let typingSendTimer = null;

function _updateSendBtn(el) {
  const sendBtn = document.getElementById('send-btn');
  if (!sendBtn) return;
  const hasDraft = el.value.trim().length > 0;
  sendBtn.style.background = hasDraft ? 'var(--accent)' : 'transparent';
  sendBtn.style.color = hasDraft ? '#0c0e10' : 'var(--muted)';
  sendBtn.style.boxShadow = 'none';
}

// silent=true — восстановление черновика при открытии чата: не шлём typing собеседнику
function onMsgInput(el, silent = false) {
  autoResize(el);
  _updateMentionPopup(el);
  // Сохраняем черновик для текущего чата, чтобы он не терялся при переключении
  if (S.activeChatId && !S.editingMessageId) {
    if (el.value) S.drafts[S.activeChatId] = el.value;
    else delete S.drafts[S.activeChatId];
    saveDrafts();
  }
  _updateSendBtn(el);
  if (silent || !S.activeChatId || S.ws?.readyState !== 1) return;
  if (!typingSendTimer) {
    S.ws.send(JSON.stringify({ type: 'typing', chat_id: S.activeChatId }));
  }
  clearTimeout(typingSendTimer);
  typingSendTimer = setTimeout(() => { typingSendTimer = null; }, 1000);
}

// Стоим ли у нижнего края ленты — считаем на месте, событие scroll могло не прийти
function atMessagesBottom() {
  const m = document.getElementById('messages');
  return !!m && m.scrollHeight - m.scrollTop - m.clientHeight < 40;
}
function pinMessagesBottom() {
  const m = document.getElementById('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

function showTyping(chatId, senderName) {
  if (typingTimers[chatId]) clearTimeout(typingTimers[chatId]);
  if (chatId === S.activeChatId) {
    const el = document.getElementById('typing-indicator');
    // На телефоне подсказка в потоке и уменьшает ленту — если стояли у дна,
    // возвращаемся туда же, иначе последнее сообщение уезжает под полосу ввода
    const stick = atMessagesBottom();
    if (el) { el.style.display = 'flex'; el.querySelector('.typing-name').textContent = senderName; }
    if (stick) pinMessagesBottom();
  }
  const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .ci-last`);
  if (item) { item.dataset.origText = item.dataset.origText || item.textContent; item.textContent = `${senderName} печатает…`; item.classList.add('typing-preview'); }
  typingTimers[chatId] = setTimeout(() => { clearTyping(chatId); }, 5000);
}

function clearTyping(chatId) {
  delete typingTimers[chatId];
  if (chatId === S.activeChatId) {
    const el = document.getElementById('typing-indicator');
    const stick = atMessagesBottom();
    if (el) el.style.display = 'none';
    if (stick) pinMessagesBottom();
  }
  const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .ci-last`);
  if (item && item.dataset.origText !== undefined) {
    item.textContent = item.dataset.origText;
    delete item.dataset.origText;
    item.classList.remove('typing-preview');
  }
}

function autoResize(el) {
  el.style.overflow = 'hidden';
  el.style.height = '20px';
  const sh = el.scrollHeight;
  el.style.height = Math.max(20, Math.min(sh, 120)) + 'px';
  if (sh > 120) el.style.overflow = 'auto';
}

function sendOrEdit() {
  if (S.editingMessageId) { submitEdit(); return; }
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text && !_pendingAttachment && !S.forwardMsg) return;
  // Нет соединения — сообщаем и не теряем набранное молча
  if (!S.ws||S.ws.readyState!==1) {
    showActionToast('Нет связи с сервером — сообщение не отправлено');
    if (S.ws && S.ws.readyState >= 2 && S.token) connectWS();
    return;
  }
  const payload = { type:'message', chat_id:S.activeChatId, text: text || '' };
  if (S.replyTo) payload.reply_to_id = S.replyTo.id;
  if (_pendingAttachment) payload.attachment = _pendingAttachment;
  if (S.forwardMsg) payload.forward_data = S.forwardMsg;

  const tempMsg = {
    id: -(Date.now()),
    chat_id: S.activeChatId,
    sender_id: S.user.id,
    sender_name: S.user.display_name,
    sender_tag: S.user.tag || null,
    text: text || '',
    sent_at: Math.floor(Date.now() / 1000),
    edited_at: null,
    deleted: 0,
    reply_to_id: S.replyTo?.id || null,
    reply_text: S.replyTo?.text || null,
    reply_sender_name: S.replyTo?.senderName || null,
    reply_attachment: S.replyTo?.attachment || null,
    reply_deleted: false,
    forward_data: S.forwardMsg || null,
    attachment: _pendingAttachment || null,
    status: { delivered: 0, read: 0, total: 1 },
    reactions: [],
    _optimistic: true,
  };
  if (!S.chatHasMoreAfter) appendMsg(tempMsg);

  S.ws.send(JSON.stringify(payload));
  if (S.chatHasMoreAfter) openChat(S.activeChatId, null, true); // мы были вглуби истории — к последним
  hideReplyBar();
  hideForwardBar();
  clearImagePreview();
  delete S.drafts[S.activeChatId]; saveDrafts(); // черновик отправлен — очищаем
  input.value=''; input.style.height='20px'; input.style.overflow='hidden';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='transparent'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none'; }
}

function submitEdit() {
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text) { cancelEdit(); return; }
  S.ws.send(JSON.stringify({type:'edit_message', message_id:S.editingMessageId, text}));
  cancelEdit();
}

function cancelEdit() {
  S.editingMessageId = null;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='none';
  hideReplyBar();
  const input = document.getElementById('msg-input');
  if (input) { input.value=''; input.style.height='auto'; }
}

// ── CONTEXT MENU ──
function showCtxMenu(e, msgId, sentAt, isMine) {
  // «Закрепить» или «Открепить» — по текущему состоянию сообщения
  const _pinLbl = document.getElementById('ctx-pin-label');
  if (_pinLbl) _pinLbl.textContent = (S.pins || []).some(p => p.message_id === msgId) ? 'Открепить' : 'Закрепить';
  e.preventDefault(); e.stopPropagation?.();
  S.ctx.messageId = msgId;
  S.ctx.canEdit = isMine && (Date.now()/1000 - sentAt) < (S.editLimit || 120);
  S.ctx.isMine = isMine;
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-reply-btn').style.display = '';
  document.getElementById('ctx-forward-btn').style.display = '';
  document.getElementById('ctx-copy-btn').style.display = '';
  document.getElementById('ctx-edit-btn').style.display = (isMine && S.ctx.canEdit) ? '' : 'none';
  document.getElementById('ctx-delete-btn').style.display = isMine ? '' : 'none';
  document.getElementById('ctx-info-btn').style.display = isMine ? '' : 'none';
  const ctxReactEl = menu.querySelector('.ctx-reactions');
  if (ctxReactEl) {
    const _freq = getFreqEmojis(7);
    ctxReactEl.innerHTML = _freq.map(em=>`<button class="ctx-reaction-btn" onclick="ctxReact('${em}')">${em}</button>`).join('')+`<button class="ctx-reaction-btn ctx-reaction-more" onclick="showReactionPicker(event)">→</button>`;
  }
  menu.style.top = '-9999px'; menu.style.left = '-9999px';
  menu.classList.add('open');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const margin = 8;
  const _z = (S.settings.uiScale || 100) / 100;
  const cx = e.clientX / _z, cy = e.clientY / _z;
  // По центру над точкой тапа
  let x = cx - mw / 2;
  let y = cy - mh - margin;
  // Вьюпорт переводим в те же единицы, что и style.left/top: при масштабе интерфейса
  // они не совпадают с window.innerWidth, и меню у края экрана уезжало за границу
  const vw = window.innerWidth / _z, vh = window.innerHeight / _z;
  if (x + mw + margin > vw) x = vw - mw - margin;
  if (x < margin) x = margin;
  // Если над пальцем не влезает — показываем под ним
  if (y < margin) y = cy + margin;
  if (y + mh + margin > vh) y = vh - mh - margin;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function dblReply(msgId) {
  S.ctx.messageId = msgId;
  ctxReply();
}

function ctxCopy() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const el = document.querySelector(`[data-msg-id="${msgId}"] .irc-text`);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).catch(() => {});
}

function ctxReply() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const textEl = document.querySelector(`[data-msg-id="${msgId}"] .irc-text`);
  const text = textEl?.innerText || '';
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  const senderIdAttr = parseInt(msgEl?.dataset.senderId || '0');
  let senderName;
  if (senderIdAttr === S.user.id) {
    senderName = S.user.display_name;
  } else {
    const u = S.allUsers.find(u => u.id === senderIdAttr);
    senderName = u?.display_name || '';
  }
  const att = msgEl?.dataset.msgAttUrl ? {
    url: msgEl.dataset.msgAttUrl,
    thumb: msgEl.dataset.msgAttThumb || null,
    mime: msgEl.dataset.msgAttMime || '',
    name: msgEl.dataset.msgAttName || '',
  } : null;
  // Если у цитируемого сообщения только вложение (без текста) — используем имя файла как «текст»
  const displayText = text.trim() || (att ? (att.mime.startsWith('image/') ? '📷 Фото' : ('📎 ' + (att.name || 'Файл'))) : '');
  S.replyTo = { id: msgId, text: displayText.slice(0, 100), senderName, attachment: att };
  showReplyBar();
}

function showReplyBar() {
  const bar = document.getElementById('reply-bar');
  if (!bar || !S.replyTo) return;
  document.getElementById('reply-bar-name').textContent = S.replyTo.senderName;
  document.getElementById('reply-bar-text').textContent = S.replyTo.text;
  const thumb = document.getElementById('reply-bar-thumb');
  if (thumb) {
    const att = S.replyTo.attachment;
    if (att?.url && att.mime?.startsWith('image/')) {
      thumb.src = `${httpProto()}://${S.server}${att.thumb || att.url}`;
      thumb.style.display = '';
    } else {
      thumb.style.display = 'none';
      thumb.removeAttribute('src');
    }
  }
  bar.style.display = '';
  document.getElementById('composer-pill')?.classList.add('has-reply');
  document.getElementById('msg-input')?.focus();
}

function hideReplyBar() {
  S.replyTo = null;
  const bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
  document.getElementById('composer-pill')?.classList.remove('has-reply');
}

// ── FILE / IMAGE ATTACH ──
let _pendingAttachment = null;
let _uploadSettings = {
  image: { maxSizeMb: 10, extensions: ['jpeg','jpg','png','gif','webp'] },
  file:  { maxSizeMb: 50, extensions: [] },
};

async function loadUploadSettings() {
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/upload/settings`, {
      headers: { 'Authorization': `Bearer ${S.token}` },
    });
    if (res.ok) _uploadSettings = await res.json();
  } catch {}
}

function pickImage() {
  document.getElementById('img-file-input')?.click();
}

function pickFile() {
  document.getElementById('file-input')?.click();
}

async function onImagePicked(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  await uploadFile(file);
}

async function onFilePicked(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  await uploadFile(file);
}

async function uploadFile(file) {
  if (!file) return;
  const isImage = file.type.startsWith('image/');
  const cfg = isImage ? _uploadSettings.image : _uploadSettings.file;
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (file.size > cfg.maxSizeMb * 1024 * 1024) {
    showActionToast(`Файл слишком большой (макс. ${cfg.maxSizeMb} МБ)`);
    return;
  }
  if (cfg.extensions.length > 0 && !cfg.extensions.includes(ext)) {
    showActionToast(`Расширение .${ext} не разрешено`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='var(--accent)'; sendBtn.style.color='#fff'; sendBtn.style.boxShadow='0 6px 16px var(--accent-shadow)'; }
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${S.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showActionToast(err.error || 'Ошибка загрузки');
      if (sendBtn && !document.getElementById('msg-input')?.value.trim()) {
        sendBtn.style.background='transparent'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none';
      }
      return;
    }
    _pendingAttachment = await res.json();
    showAttachmentPreviewBar();
  } catch {
    if (sendBtn && !document.getElementById('msg-input')?.value.trim()) {
      sendBtn.style.background='transparent'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none';
    }
  }
}

// Keep alias for backward-compat callers (drag-drop, paste)
async function uploadImageFile(file) { return uploadFile(file); }

function showAttachmentPreviewBar() {
  const bar = document.getElementById('image-preview-bar');
  if (!bar) return;
  const att = _pendingAttachment;
  if (!att) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const isImage = att.mime?.startsWith('image/');
  const thumb = bar.querySelector('.img-preview-thumb');
  if (thumb) { thumb.src = isImage ? `${httpProto()}://${S.server}${att.url}` : ''; thumb.style.display = isImage ? '' : 'none'; }
  const icon = bar.querySelector('.attach-preview-icon');
  if (icon) icon.style.display = isImage ? 'none' : '';
  bar.querySelector('.img-preview-name').textContent = att.name || (isImage ? 'Изображение' : 'Файл');
}

function showImagePreviewBar() { showAttachmentPreviewBar(); }

function clearImagePreview() {
  _pendingAttachment = null;
  const bar = document.getElementById('image-preview-bar');
  if (bar) bar.style.display = 'none';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn && !document.getElementById('msg-input')?.value.trim()) {
    sendBtn.style.background='transparent'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none';
  }
}

function showSystemAnnouncement(text) {
  let modal = document.getElementById('announcement-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'announcement-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center';
    modal.innerHTML = `<div id="announcement-card" style="background-color:var(--modal-bg);background-image:linear-gradient(rgba(210,55,55,.14),rgba(210,55,55,.14));border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3);border:1px solid rgba(210,55,55,.22)">
      <div class="announcement-title">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--danger-bg);border:1px solid var(--danger-border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        Системное объявление
      </div>
      <div id="announcement-text" style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap"></div>
      <button onclick="closeSystemAnnouncement()" style="margin-top:16px;width:100%;padding:9px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">OK</button>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('announcement-text').textContent = text || '';
  const card = document.getElementById('announcement-card');
  modal.style.opacity = '0';
  modal.style.transition = 'none';
  if (card) { card.style.transition = 'none'; card.style.transform = 'scale(.93) translateY(12px)'; card.style.opacity = '0'; }
  modal.style.display = 'flex';
  modal.offsetHeight; // force reflow
  modal.style.transition = 'opacity .2s ease';
  modal.style.opacity = '1';
  if (card) {
    card.style.transition = 'transform .25s cubic-bezier(.34,1.56,.64,1),opacity .2s ease';
    card.style.transform = 'scale(1) translateY(0)';
    card.style.opacity = '1';
  }
}

function closeSystemAnnouncement() {
  const modal = document.getElementById('announcement-modal');
  const card = document.getElementById('announcement-card');
  if (!modal) return;
  modal.style.transition = 'opacity .2s ease';
  modal.style.opacity = '0';
  if (card) {
    card.style.transition = 'transform .2s ease,opacity .2s ease';
    card.style.transform = 'scale(.93) translateY(12px)';
    card.style.opacity = '0';
  }
  setTimeout(() => { if (modal) modal.style.display = 'none'; }, 220);
}

// ── ПОЛОСА ОБЪЯВЛЕНИЯ ──
// Второй вид объявления: висит заданное администратором время поверх любого
// экрана — чата, группы, настроек. Активные запрашиваем при каждом подключении,
// поэтому объявление доходит и до тех, кого не было в сети в момент отправки.
// Крестик закрывает её у пользователя навсегда, отметка хранится на сервере.
const _banners = new Map(); // id -> таймер автоскрытия

function bannerHost() {
  let host = document.getElementById('ann-banners');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ann-banners';
    document.body.appendChild(host);
  }
  return host;
}

// Полоса и плашка «нет соединения» занимают одно место, поэтому вторую сдвигаем
// вниз ровно на высоту полос.
function syncBannerOffset() {
  const host = document.getElementById('ann-banners');
  const h = host && host.children.length ? host.offsetHeight + 8 : 0;
  document.documentElement.style.setProperty('--ann-h', h + 'px');
}

function showBanner(a) {
  if (!a?.id || _banners.has(a.id)) return;
  const left = (a.expires_at || 0) * 1000 - Date.now();
  if (left <= 0) return;

  const el = document.createElement('div');
  el.className = 'ann-banner';
  el.dataset.id = a.id;
  el.innerHTML = `
    <svg class="ann-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    <span class="ann-banner-text"></span>
    <button class="ann-banner-close" title="Скрыть">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  el.querySelector('.ann-banner-text').textContent = a.text || '';
  el.querySelector('.ann-banner-close').onclick = () => dismissBanner(a.id);
  bannerHost().appendChild(el);
  syncBannerOffset();
  // Не rAF: в свёрнутом окне кадры не идут, и полоса осталась бы прозрачной
  setTimeout(() => el.classList.add('visible'), 10);

  _banners.set(a.id, setTimeout(() => hideBanner(a.id), left));
}

function hideBanner(id) {
  clearTimeout(_banners.get(id));
  _banners.delete(id);
  const el = document.querySelector(`.ann-banner[data-id="${id}"]`);
  if (!el) return;
  el.classList.remove('visible');
  setTimeout(() => { el.remove(); syncBannerOffset(); }, 300);
}

function dismissBanner(id) {
  hideBanner(id);
  api('POST', `/announcements/${id}/dismiss`);
}

async function loadBanners() {
  const list = await api('GET', '/announcements/active');
  if (!Array.isArray(list)) return;
  const alive = new Set(list.map(a => a.id));
  [..._banners.keys()].forEach(id => { if (!alive.has(id)) hideBanner(id); });
  list.forEach(showBanner);
}

function openLightbox(url, filename) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.onclick = () => closeLightbox();
    lb.innerHTML = `<img id="lightbox-img">
      <button id="lightbox-download" title="Скачать" onclick="event.stopPropagation();downloadAttachment(document.getElementById('lightbox').dataset.url, document.getElementById('lightbox').dataset.filename)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>`;
    document.body.appendChild(lb);
  }
  document.getElementById('lightbox-img').src = url;
  lb.dataset.url = url;
  lb.dataset.filename = filename || 'image';
  lb.classList.remove('lb-closing');
  lb.classList.add('lb-open');
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb || lb.classList.contains('lb-closing')) return;
  lb.classList.remove('lb-open');
  lb.classList.add('lb-closing');
  const onEnd = e => {
    if (e.target !== lb) return;
    lb.classList.remove('lb-closing');
    lb.removeEventListener('animationend', onEnd);
  };
  lb.addEventListener('animationend', onEnd);
}

function downloadAttachment(url, filename) {
  if (window.electron?.downloadFile) {
    window.electron.downloadFile({ url, filename });
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
}

function scrollToMsg(msgId, force = false) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  // Сообщения нет в DOM (глубоко в истории) — перезагружаем чат окном вокруг него
  if (!el) { if (S.activeChatId) openChat(S.activeChatId, msgId); return; }
  const msgs = document.getElementById('messages');
  const rect = el.getBoundingClientRect();
  const containerRect = msgs ? msgs.getBoundingClientRect() : null;
  const isVisible = containerRect
    ? rect.top >= containerRect.top && rect.bottom <= containerRect.bottom
    : false;
  if ((force || !isVisible) && msgs && containerRect) {
    const offset = rect.top - containerRect.top - msgs.clientHeight / 2 + el.offsetHeight / 2;
    // force: мгновенный скролл; smooth-прокрутка триггерит onMessagesScroll на промежуточных
    // scrollTop<80 и вызывает loadMoreMessages, что уводит позицию.
    if (force) msgs.scrollTop = msgs.scrollTop + offset;
    else msgs.scrollBy({ top: offset, behavior: 'smooth' });
  }
  el.classList.add('msg-highlight');
  setTimeout(() => el.classList.remove('msg-highlight'), 1500);
}
function hideCtxMenu() {
  document.getElementById('ctx-menu').classList.remove('open');
}

function ctxEdit() {
  hideCtxMenu();
  if (!S.ctx.canEdit) return;
  const el = document.querySelector(`[data-msg-id="${S.ctx.messageId}"] .irc-text`);
  const text = el?.textContent?.replace(' изм.','').trim()||'';
  S.editingMessageId = S.ctx.messageId;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='flex';
  const input = document.getElementById('msg-input');
  if (input) { input.value=text; input.focus(); autoResize(input); }
}

function ctxDelete() {
  hideCtxMenu();
  if (!S.ctx.messageId||!S.ws) return;
  S.ws.send(JSON.stringify({type:'delete_message', message_id:S.ctx.messageId}));
}

async function ctxInfo() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const data = await api('GET', `/messages/${msgId}/info`);
  if (!data || data.error) return;

  function fmtDt(ts) {
    if (!ts) return null;
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  }

  document.querySelector('#modal-msg-info .mi-title').textContent = data.chat_type === 'direct' ? 'Информация' : 'Прочитано';

  let body;

  if (data.chat_type === 'direct') {
    const s = data.statuses[0];
    const sentDone  = !!data.sent_at;
    const delivDone = !!s?.delivered_at;
    const readDone  = !!s?.read_at;

    const icoSingleTeal = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#29d6b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const icoDblTeal    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#29d6b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>`;
    const icoDblGray    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6169" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>`;

    function tlStep(label, sub, done, ico, showConn) {
      const dc = done ? 'mi-done' : 'mi-pending';
      const pc = done ? '' : ' mi-pending';
      const conn = showConn ? `<div class="mi-connector ${dc}"></div>` : '';
      return `<div class="mi-step">
        <div class="mi-step-left"><div class="mi-icon ${dc}">${ico}</div>${conn}</div>
        <div class="mi-step-right">
          <div class="mi-step-name${pc}">${label}</div>
          <div class="mi-step-sub${pc}">${sub}</div>
        </div>
      </div>`;
    }

    body = `<div class="mi-timeline">
      ${tlStep('Отправлено', fmtDt(data.sent_at) || '—', sentDone, icoSingleTeal, true)}
      ${tlStep('Доставлено', delivDone ? fmtDt(s?.delivered_at) : 'пока не доставлено', delivDone, delivDone ? icoDblTeal : icoDblGray, true)}
      ${tlStep('Прочитано', readDone ? fmtDt(s?.read_at) : 'пока не прочитано', readDone, readDone ? icoDblTeal : icoDblGray, false)}
    </div>`;

  } else {
    const total = data.statuses.length;
    const readUsers = data.statuses.filter(s => s.read_at);
    if (readUsers.length === 0) {
      body = `<div class="mi-group-count">0 из ${nMembers(total)}</div><div class="mi-empty">Пока никто не прочитал</div>`;
    } else {
      body = `<div class="mi-group-count">${readUsers.length} из ${nMembers(total)}</div>`;
      body += readUsers.map(s => `<div class="mi-user-row">
        <div class="av mi-av ${userAvatarColor(s.user_id)}" data-av-user="${s.user_id}">${initials(s.display_name)}</div>
        <div class="mi-user-name">${esc(s.display_name)}</div>
        <div class="mi-user-time">${fmtDt(s.read_at)}</div>
      </div>`).join('');
    }
  }

  document.getElementById('msg-info-body').innerHTML = body;
  if (data.chat_type !== 'direct') applyAvatars();
  openModal('modal-msg-info');
}

// ── CUSTOM CONFIRM ──
let _confirmCallback = null;
function showConfirm(text, okLabel = 'Удалить') {
  return new Promise(resolve => {
    _confirmCallback = resolve;
    document.getElementById('confirm-body').textContent = text;
    document.getElementById('confirm-ok').textContent = okLabel;
    document.getElementById('modal-confirm').classList.add('open');
  });
}
function _confirmResolve() {
  document.getElementById('modal-confirm').classList.remove('open');
  if (_confirmCallback) { _confirmCallback(true); _confirmCallback = null; }
}
function _confirmReject() {
  document.getElementById('modal-confirm').classList.remove('open');
  if (_confirmCallback) { _confirmCallback(false); _confirmCallback = null; }
}

// ── DELETE CHAT ──
async function deleteChat(chatId) {
  const ok = await showConfirm('Удалить чат? Для вас он исчезнет из списка.');
  if (!ok) return;
  await api('DELETE', `/chats/${chatId}`);
  removeChatLocally(chatId);
}

function closeActiveChat() {
  S.activeChatId = null;
  setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
  if (_isMobile()) mobileSlideTo(1);
  else { document.getElementById('chat-main').classList.remove('mobile-open'); document.querySelector('.sidebar')?.classList.remove('mobile-hidden'); }
  renderChatList();
}

function removeChatLocally(chatId) {
  S.chats = S.chats.filter(c=>c.id!==chatId);
  if (S.activeChatId === chatId) {
    S.activeChatId = null;
    setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
    if (_isMobile()) mobileSlideTo(1);
    else { document.getElementById('chat-main').classList.remove('mobile-open'); document.querySelector('.sidebar')?.classList.remove('mobile-hidden'); }
  }
  renderChatList();
}

async function leaveGroup(chatId) {
  const ok = await showConfirm('Выйти из группы?', 'Выйти');
  if (!ok) return;
  await api('POST', `/chats/${chatId}/leave`);
  S.activeChatId = null;
  setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
  if (_isMobile()) mobileSlideTo(1);
  else { document.getElementById('chat-main').classList.remove('mobile-open'); document.querySelector('.sidebar')?.classList.remove('mobile-hidden'); }
  loadChats();
}

// ── WEBSOCKET ──
function connectWS() {
  // Реконнект по фокусу мог разойтись с отложенным реконнектом из onclose —
  // гасим прежний живой сокет, иначе он останется сиротой: сервер будет считать
  // его активным, а set_status уходит только в текущий → вечный «в сети»
  const prev = S.ws;
  if (prev && prev.readyState <= 1) { try { prev.close(); } catch {} }
  const ws = new WebSocket(`${wsProto()}://${S.server}/ws?token=${S.token}`);
  S.ws = ws;

  ws.onmessage = async e => {
    if (ws !== S.ws) return;
    let data; try { data=JSON.parse(e.data); } catch { return; }

    if (data.type==='pong') { ws._pongOk = true; return; }

    if (data.type==='connected') { S.editLimit = data.edit_time_limit || 120; return; }

    if (data.type==='message') {
      const { message } = data;
      const chatId = message.chat_id;
      const parentId = message.parent_id || null;
      if (parentId) {
        const parentChat = S.chats.find(c=>c.id===parentId);
        if (parentChat) parentChat.last_message = message;
      }
      const chat = S.chats.find(c=>c.id===chatId) || (parentId ? S.chats.find(c=>c.id===parentId) : null);
      if (!parentId && chat) chat.last_message = message;
      // Если мы вглуби истории (низ не догружен) — не аппендим, придёт при догрузке
      if (S.activeChatId===chatId && !S.chatHasMoreAfter && _loadingChatId !== chatId) {
        if (message.sender_id === S.user.id) {
          document.querySelector('[data-optimistic="1"]')?.remove();
        }
        appendMsg(message);
        S.chatNewestId = message.id;
        if (isViewing() && S.ws?.readyState===1) {
          S.ws.send(JSON.stringify({type:'read', chat_id:chatId}));
          S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
        } else if (!isViewing() && message.sender_id !== S.user.id) {
          S.unread[chatId] = (S.unread[chatId]||0)+1;
          if (message.mentions?.includes(S.user.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId]||0)+1;
          if (!isChatMuted(chatId, parentId)) {
            const title = chatName(chat) || 'Electron';
            const body = `${message.sender_name}: ${message.text || (message.attachment ? (message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
            webNotify(title, body, chatId);
            playNotificationSound();
          }
          if (S.ws?.readyState===1) S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
        }
      } else if (message.sender_id === S.user.id) {
        // Своё сообщение, отправленное с другого устройства — чат прочитан мной
        S.unread[chatId] = 0;
      } else {
        S.unread[chatId] = (S.unread[chatId]||0)+1;
        if (message.mentions?.includes(S.user.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId]||0)+1;
        if (!isChatMuted(chatId, parentId)) {
          // Подкомнаты нет в S.chats — берём её имя из S.subrooms, иначе имя
          // родительской комнаты (chat уже содержит этот фолбэк). Раньше здесь
          // был chatName(undefined) → TypeError, и обработчик обрывался.
          const _srObj = parentId ? (S.subrooms[parentId]||[]).find(s=>s.id===chatId) : null;
          const title = _srObj?.name || chatName(chat) || 'Electron';
          const body = `${message.sender_name}: ${message.text || (message.attachment ? (message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
          webNotify(title, body, chatId);
          playNotificationSound();
        }
        if (S.ws?.readyState===1) S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
      }
      updateUnreadTotal();
      renderChatList();
      if (parentId && S.activeRoomId === parentId) renderSubroomsPanel(parentId);
      if (!chat) loadChats();
    }

    if (data.type==='message_edited') {
      const m = data.message;
      const chat = S.chats.find(c=>c.id===m.chat_id);
      if (chat?.last_message?.id===m.id) chat.last_message = m;
      if (S.activeChatId===m.chat_id) updateMsgInDOM(m);
      renderChatList();
    }

    if (data.type==='message_deleted') {
      const { message_id, chat_id } = data;
      const chat = S.chats.find(c=>c.id===chat_id);
      if (chat?.last_message?.id===message_id) chat.last_message = {...chat.last_message, deleted:1, text:'', attachment:null};
      if (S.activeChatId===chat_id) {
        const el = document.querySelector(`[data-msg-id="${message_id}"]`);
        if (el) {
          const isChatGroup = chat?.type==='group' || chat?.type==='room';
          const grouped = !el.classList.contains('irc-first');
          const fakeMsg = { id:message_id, deleted:1, text:'', attachment:null,
            sender_id:Number(el.dataset.senderId), sender_name:'', sent_at:Number(el.dataset.sentAt),
            reply_to_id:null, edited_at:null, status:{delivered:0,read:0,total:0}, reactions:[] };
          const isLastDeleted = el.classList.contains('irc-tail');
          el.outerHTML = renderMsg(fakeMsg, isChatGroup, false, grouped, isLastDeleted);
          reflowSeries();
        }
      }
      renderChatList();
    }

    if (data.type==='reload_chats') { loadChats(); }
    if (data.type==='chat_deleted') { removeChatLocally(data.chat_id); }

    if (data.type==='chat_read') {
      // Чат прочитан на другом устройстве этого пользователя
      S.unread[data.chat_id] = 0;
      S.unreadMentions[data.chat_id] = 0;
      updateUnreadTotal();
      renderChatList();
    }

    if (data.type==='chat_cleared') {
      const chat = S.chats.find(c => c.id === data.chat_id);
      if (chat) { chat.last_message = null; renderChatList(); }
      if (S.activeChatId === data.chat_id) {
        S.chatHasMore = false; S.chatOldestId = null;
        const container = document.getElementById('messages');
        if (container) container.innerHTML = '';
      }
    }

    if (data.type==='pins_updated') {
      if (data.chat_id === S.activeChatId) {
        const wasId = (S.pins || [])[_pinIdx]?.message_id;
        const wasTop = (S.pins || [])[0]?.message_id;
        S.pins = data.pins || [];
        const newTop = S.pins[0]?.message_id;
        // Появилось новое закрепление — показываем его: плашка всегда открывается
        // на самом свежем. При откреплении, наоборот, держим текущее сообщение,
        // чтобы плашка не прыгала, пока её листает кто-то другой.
        if (newTop !== undefined && newTop !== wasTop) {
          _pinIdx = 0;
        } else {
          const keep = S.pins.findIndex(p => p.message_id === wasId);
          _pinIdx = keep >= 0 ? keep : 0;
        }
        renderPinBar();
      }
    }

    if (data.type==='reaction_update') {
      const { message_id, counts } = data;
      S.reactions[message_id] = counts;
      _rtInvalidate(message_id); // состав изменился — тултип перезапросит имена
      if (S.activeChatId) {
        const msgEl = document.querySelector(`[data-msg-id="${message_id}"]`);
        if (msgEl) {
          const container = document.getElementById('messages');
          const isAtBottom = container && (container.scrollHeight - container.scrollTop - container.clientHeight < 10);
          const prevScrollHeight = container?.scrollHeight || 0;
          const existing = msgEl.querySelector('.reactions');
          const reactionsHtml = renderReactions(message_id);
          if (existing) {
            existing.outerHTML = reactionsHtml || '';
          } else if (reactionsHtml) {
            const target = msgEl.querySelector('.irc-content');
            if (target) target.insertAdjacentHTML('beforeend', reactionsHtml);
          }
          if (container) {
            const delta = container.scrollHeight - prevScrollHeight;
            if (isAtBottom) container.scrollTop = container.scrollHeight;
            else if (delta > 0) container.scrollTop += delta;
          }
        }
      }
    }

    if (data.type==='typing') { showTyping(data.chat_id, data.sender_name); }

    if (data.type==='presence') {
      S.presence[data.user_id] = data.status;
      if (data.last_seen) S.lastSeen[data.user_id] = data.last_seen;
      // Обновляем подпись в шапке открытого личного чата («в сети» / «был(а) в …»)
      const activeChat = S.chats.find(c=>c.id===S.activeChatId);
      if (activeChat?.type === 'direct' && getPeerUserId(activeChat) === data.user_id) {
        const subEl = document.querySelector('.ch-sub');
        if (subEl) subEl.textContent = peerStatusText(data.user_id);
        const mtbSub = document.getElementById('mtb-sub');
        if (mtbSub) mtbSub.textContent = peerStatusText(data.user_id);
      }
      const isOnline = data.status === 'online';
      document.querySelectorAll(`.presence-dot[data-user-id="${data.user_id}"]`).forEach(dot => {
        dot.style.display = isOnline ? '' : 'none';
      });
    }

    if (data.type==='status_update') {
      const m = data.message;
      if (m.status) S.msgStatus[m.id] = { ...m.status };
      // Точный статус с сервера — кладём его в список чатов как есть
      const _c = S.chats.find(c => c.id === m.chat_id)
        || S.chats.find(c => (S.subrooms[c.id] || []).some(s => s.id === m.chat_id));
      if (_c?.last_message && _c.last_message.id === m.id && m.status) {
        _c.last_message.status = { ...m.status };
        renderChatList();
      }
      if (S.activeChatId===m.chat_id && m.sender_id===S.user.id) {
        const wrap = document.querySelector(`[data-msg-id="${m.id}"] .status-wrap`);
        if (wrap) wrap.innerHTML = renderStatus(m.status);
      }
    }

    if (data.type==='status_range') {
      // Диапазон мог захватить последнее сообщение чата — обновим галочку в списке
      const _lm = (S.chats.find(c => c.id === data.chat_id)
        || S.chats.find(c => (S.subrooms[c.id] || []).some(s => s.id === data.chat_id)))?.last_message;
      if (_lm && _lm.id >= data.min_id && _lm.id <= data.max_id) {
        applyStatusToChatList(data.chat_id, _lm.id, data.kind, data.reader_id);
      }
      if (data.chat_id === S.activeChatId) {
        const eventKey = `${data.kind}:${data.reader_id}`;
        document.querySelectorAll('[data-msg-id]').forEach(el => {
          const id = parseInt(el.dataset.msgId);
          if (!(id >= data.min_id && id <= data.max_id)) return;
          if (parseInt(el.dataset.senderId) !== S.user.id) return;
          const st = S.msgStatus[id];
          if (!st) return;
          if (!S.statusApplied[id]) S.statusApplied[id] = new Set();
          if (S.statusApplied[id].has(eventKey)) return;
          S.statusApplied[id].add(eventKey);
          if (data.kind === 'read') {
            st.read = Math.min(st.total, st.read + 1);
            st.delivered = Math.max(st.delivered, st.read);
          } else {
            st.delivered = Math.min(st.total, st.delivered + 1);
          }
          const wrap = el.querySelector('.status-wrap');
          if (wrap) wrap.innerHTML = renderStatus(st);
        });
      }
    }

    if (data.type==='chat_updated') {
      // Точечное обновление чата без refetch всего списка
      const idx = S.chats.findIndex(c => c.id === data.chat.id);
      if (idx >= 0) S.chats[idx] = data.chat; else S.chats.push(data.chat);
      renderChatList();
      if (S.activeChatId === data.chat.id) {
        const nameEl = document.querySelector('.ch-name');
        if (nameEl) nameEl.textContent = chatName(data.chat);
      }
    }

    if (data.type==='edit_rejected') {
      // Сервер отклонил редактирование (вышло время) — сообщаем и закрываем режим правки
      if (S.editingMessageId === data.message_id) cancelEdit();
      showActionToast(data.reason === 'time'
        ? `Редактировать можно только в течение ${formatEditLimit(S.editLimit || 120)}`
        : 'Не удалось отредактировать сообщение');
    }

    if (data.type==='avatar_updated') {
      S.avatarTs = Date.now();
      _avatarCache.clear();
      renderChatList();
    }

    if (data.type === 'force_logout') { logout(true); }
    if (data.type === 'announcement') {
      showSystemAnnouncement(data.text);
      // Окно свёрнуто или не в фокусе — модалку человек не увидит, поэтому
      // предупреждаем так же, как о новом сообщении. Мут чатов тут не при чём:
      // это объявление от администрации, а не переписка.
      if (!isViewing()) {
        const body = (data.text || '').replace(/\s+/g, ' ').slice(0, 120);
        webNotify('Системное объявление', body, null);
        playNotificationSound();
      }
    }

    if (data.type === 'banner') {
      showBanner(data.announcement);
      // Предупреждаем так же, как о всплывающем объявлении: окно может быть
      // свёрнуто, а полоса важна и висит ограниченное время. Мут чатов тут ни
      // при чём — это объявление от администрации, а не переписка.
      if (!isViewing()) {
        const body = (data.announcement?.text || '').replace(/\s+/g, ' ').slice(0, 120);
        webNotify('Системное объявление', body, null);
        playNotificationSound();
      }
    }
    if (data.type === 'banner_removed') hideBanner(data.id);
  };

  ws.onclose = (event) => {
    clearInterval(ws._hb);
    // Нас уже заменил более новый сокет — не реконнектим повторно
    if (ws !== S.ws) return;
    if (event.code === 1008) { logout(); return; }
    S.wsRetry++;
    const delay = Math.min(1000*S.wsRetry, 10000);
    if (S.token) {
      showServerToast();
      setTimeout(connectWS, delay);
    }
  };
  ws.onopen = () => {
    S.wsRetry = 0;
    hideServerToast();
    loadChats();
    loadBanners();
    api('GET', '/auth/refresh').then(d => { if (d?.token) { S.token = d.token; saveSession(); } });
    // Догружаем сообщения, пришедшие в открытый чат во время разрыва соединения
    const _ccId = S.activeChatId, _ccNewest = S.chatNewestId;
    if (_ccId && _ccNewest && !S.chatHasMoreAfter) {
      api('GET', `/messages/chat/${_ccId}?after=${_ccNewest}&limit=50`).then(data => {
        if (!data?.messages?.length || S.activeChatId !== _ccId) return;
        S.chatHasMoreAfter = !!data.hasMoreAfter;
        S.chatNewestId = data.messages[data.messages.length - 1].id;
        appendMessagesAfter(data.messages, _ccId);
        if (isViewing() && S.ws?.readyState === 1) {
          S.ws.send(JSON.stringify({type:'read', chat_id:_ccId}));
          S.unread[_ccId] = 0;
          S.unreadMentions[_ccId] = 0;
          updateUnreadTotal(); renderChatList();
        }
      });
    }
    // Heartbeat: держим соединение живым и ловим «зомби»-сокеты в фоне.
    // Если на ping не пришёл pong — соединение мёртвое, закрываем → реконнект.
    ws._pongOk = true;
    clearInterval(ws._hb);
    ws._hb = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!ws._pongOk) { try { ws.close(); } catch {} return; }
      ws._pongOk = false;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 20000);
    setTimeout(() => {
      const initStatus = document.hidden ? 'offline' : 'online';
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'set_status', status: initStatus }));
        const isPwa = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
        ws.send(JSON.stringify({
          type: 'client_info',
          hostname: isPwa ? 'PWA' : 'Web',
          clientVersion: 'web',
          osPlatform: navigator.platform || 'web',
          osRelease: navigator.userAgent.match(/iPhone|iPad|iPod/i) ? 'iOS'
            : navigator.userAgent.match(/Android/i) ? 'Android'
            : navigator.userAgent.match(/Mac/i) ? 'macOS'
            : 'Web',
          installScope: isPwa ? 'pwa' : 'web',
        }));
      }
    }, 300);
  };
  ws.onerror = () => ws.close();
}

function updateUnreadTotal() {
  const total = Object.values(S.unread).reduce((a,b)=>a+b,0);
  document.title = total > 0 ? `(${total}) Electron` : 'Electron';
  // Счётчик на иконке установленного PWA (iOS 16.4+, Chrome, Edge)
  try {
    if (total > 0) navigator.setAppBadge?.(total);
    else navigator.clearAppBadge?.();
  } catch {}
}

// ── USERS ──
async function loadUsers() {
  const users = await api('GET','/users');
  if (users) S.allUsers = users;
}

// ── PRESENCE ──
async function loadPresence() {
  const data = await api('GET', '/users/presence');
  if (data) {
    S.presence = {}; S.lastSeen = {};
    for (const [id, v] of Object.entries(data)) {
      if (v && typeof v === 'object') { S.presence[id] = v.status; if (v.last_seen) S.lastSeen[id] = v.last_seen; }
      else S.presence[id] = v; // совместимость со старым сервером
    }
    renderChatList();
  }
}

function formatLastSeen(ts) {
  if (!ts) return 'не в сети';
  const d = new Date(ts * 1000);
  const diffSec = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diffSec < 60) return 'только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `был(а) в сети ${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `был(а) в сети ${diffH} ч. назад`;
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay = new Date(d); msgDay.setHours(0,0,0,0);
  if (msgDay.getTime() === today.getTime()) return `был(а) в сети сегодня в ${time}`;
  if (msgDay.getTime() === yesterday.getTime()) return `был(а) в сети вчера в ${time}`;
  const diffDays = Math.floor((today - msgDay) / 86400000);
  if (diffDays < 7) {
    const days = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
    return `был(а) в сети в ${days[d.getDay()]} в ${time}`;
  }
  return `был(а) в сети ${d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function peerStatusText(userId) {
  const st = S.presence[userId] || 'offline';
  if (st === 'online') return 'в сети';
  return formatLastSeen(S.lastSeen[userId]);
}

// Периодически обновляем "был(а) в сети N мин. назад" в шапке открытого личного чата,
// иначе таймштамп замирает и остаётся "только что" сколько бы времени ни прошло.
setInterval(() => {
  if (!S.activeChatId) return;
  const chat = S.chats.find(c => c.id === S.activeChatId);
  if (!chat || chat.type !== 'direct') return;
  const peerId = getPeerUserId(chat);
  if (!peerId) return;
  const subEl = document.querySelector('.ch-sub');
  if (subEl) subEl.textContent = peerStatusText(peerId);
}, 30000);

function presenceDot(userId) {
  // Элемент рендерим всегда (скрытым если офлайн) — иначе WS-хендлеру presence
  // нечего показывать, когда пользователь появляется в сети.
  const online = (S.presence[userId] || 'offline') === 'online';
  return `<span class="presence-dot" data-user-id="${userId}"${online ? '' : ' style="display:none"'}></span>`;
}

function getPeerUserId(chat) {
  if (chat.type !== 'direct') return null;
  return chat.members?.find(m => m.id !== S.user.id)?.id || null;
}


function triggerGroupAvatarUpload() { document.getElementById('group-avatar-input').click(); }
async function onGroupAvatarChange(input) {
  const file = input.files[0]; if (!file) return;
  const base64 = await resizeAvatarFile(file);
  S.newGroupAvatarBase64 = base64;
  const el = document.getElementById('new-group-av');
  el.style.backgroundImage = `url('data:image/jpeg;base64,${base64}')`;
  el.style.backgroundSize = 'cover';
  el.textContent = '';
}

// ── NEW CHAT MODAL ──
// Мини-аватар для списков выбора: инициалы + фото поверх если есть
function ppAvHtml(u) {
  return `<div class="pp-av ${userAvatarColor(u.id, u.tag)}"><span>${initials(u.display_name)}</span><img src="${httpProto()}://${S.server}/api/users/${u.id}/avatar" loading="lazy" onerror="this.style.display='none'"></div>`;
}
const PP_CHECK = `<span class="pp-check"><svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="3.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;

function openNewChat() {
  S.ncSelected = new Set();
  S.newGroupAvatarBase64 = null;
  setChatMainContent(`
    <div class="gi-panel nc-panel">
      <div class="gi-top-bar">
        <button class="icon-btn" onclick="closeNewChat()" title="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="gi-top-title" id="nc-title">Новый чат</span>
      </div>
      <div class="nc-panel-body">
        <div class="nc-panel-tabs">
          <div class="nc-tabs">
            <button class="nc-tab active" id="nc-btn-direct" onclick="switchTab('direct')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Личный
            </button>
            <button class="nc-tab" id="nc-btn-group" onclick="switchTab('group')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 1-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Группа
            </button>
          </div>
        </div>
        <div id="nc-group-settings" style="display:none" class="nc-panel-group-settings">
          <div class="nc-group-top">
            <div class="av av-md av-sq av-green" id="new-group-av" style="cursor:pointer;flex-shrink:0" onclick="triggerGroupAvatarUpload()">G</div>
            <input id="group-name" class="nc-name-input" placeholder="Название группы">
          </div>
          <input type="file" id="group-avatar-input" accept="image/*" style="display:none" onchange="onGroupAvatarChange(this)">
        </div>
        <div class="nc-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="nc-search-input" placeholder="Поиск..." oninput="filterModalUsers(this.value,'tab-direct');filterModalUsers(this.value,'tab-group')">
        </div>
        <div class="nc-panel-lists">
          <div id="tab-direct" class="users-list nc-list"></div>
          <div id="tab-group" class="users-list nc-list" style="display:none"></div>
        </div>
      </div>
      <div id="nc-footer" style="display:none" class="gi-footer">
        <button class="modal-btn-ghost" onclick="closeNewChat()">Отмена</button>
        <button class="modal-btn-primary" onclick="createGroup()">Создать группу</button>
      </div>
    </div>`);
  renderModalUsers('tab-direct', false);
  renderModalUsers('tab-group', true);
  if (_isMobile()) mobileSlideTo(3, 'Новый чат');
  else openMobileChat();
}

function closeNewChat() {
  const go = () => {
    if (S.activeChatId) openChat(S.activeChatId);
    else if (_isMobile()) mobileSlideTo(1);
    else {
      setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Чат</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
    }
  };
  const panel = document.querySelector('.gi-panel');
  if (panel) { panel.classList.add('gi-closing'); setTimeout(go, 150); }
  else go();
}

function renderModalUsers(containerId, multi, filter='') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const list = S.allUsers.filter(u=>!filter||u.display_name.toLowerCase().includes(filter)||u.username.toLowerCase().includes(filter));
  container.innerHTML = list.map(u=>`
    <div class="pp-row${multi&&S.ncSelected?.has(u.id)?' on':''}" data-uid="${u.id}" onclick="${multi?`toggleModalUser(${u.id})`:`startDirect(${u.id})`}">
      ${ppAvHtml(u)}
      <span class="pp-name">${esc(u.display_name)}</span>
      ${u.tag?`<span class="pp-tag">${esc(u.tag)}</span>`:''}
      ${multi?PP_CHECK:''}
    </div>`).join('') || '<div class="pp-empty">Нет пользователей</div>';
}

function filterModalUsers(q, containerId) {
  const multi = containerId==='tab-group';
  const el = document.getElementById(containerId);
  if (el?.style.display==='none') return;
  renderModalUsers(containerId, multi, q.toLowerCase());
}

function toggleModalUser(id) {
  if (!S.ncSelected) S.ncSelected = new Set();
  if (S.ncSelected.has(id)) S.ncSelected.delete(id);
  else S.ncSelected.add(id);
  const q = (document.getElementById('nc-search-input')?.value || '').toLowerCase();
  renderModalUsers('tab-group', true, q);
}

async function startDirect(userId) {
  const data = await api('POST','/chats/direct',{user_id:userId});
  if (data?.id) { await loadChats(); openChat(data.id); }
}

async function createGroup() {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { document.getElementById('group-name').focus(); return; }
  const selected = [...(S.ncSelected || [])];
  const data = await api('POST','/chats/group',{name, member_ids:selected});
  if (data?.id) {
    if (S.newGroupAvatarBase64) {
      await api('POST', `/chats/${data.id}/avatar`, { data: S.newGroupAvatarBase64 });
      S.newGroupAvatarBase64 = null;
    }
    await loadChats(); openChat(data.id);
  }
}

function switchTab(tab) {
  document.querySelectorAll('.nc-type-btn,.nc-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`nc-btn-${tab}`)?.classList.add('active');
  document.getElementById('tab-direct').style.display = tab==='direct' ? 'flex' : 'none';
  document.getElementById('tab-group').style.display = tab==='group' ? 'flex' : 'none';
  document.getElementById('nc-group-settings').style.display = tab==='group' ? '' : 'none';
  document.getElementById('nc-footer').style.display = tab==='group' ? '' : 'none';
  document.getElementById('nc-title').textContent = tab==='direct' ? 'Новый чат' : 'Новая группа';
}

// ── GROUP INFO PANEL ──
async function openGroupInfo(chatId) {
  S.giChatId = chatId;
  S.giRemovedIds = new Set();
  S.giAddIds = new Set();
  S.giAvatarBase64 = null;
  const chat = S.chats.find(c => c.id === chatId);
  const isRoom = chat?.type === 'room';
  const canEdit = isRoom ? S.user.is_admin : (chat.created_by === S.user.id || S.user.is_admin);
  const canDelete = !isRoom && (chat.created_by === S.user.id || S.user.is_admin);
  const leaveBtn = !isRoom ? `<button class="gi-btn gi-btn-leave" onclick="giLeave()">Выйти</button>` : '';
  const deleteBtn = canDelete ? `<button class="gi-btn gi-btn-delete" onclick="giDelete()">Удалить</button>` : '';
  const addBtn = canEdit ? `<button class="gi-btn gi-btn-add" onclick="giShowAdd()">Добавить участника</button>` : '';
  setChatMainContent(`
    <div class="gi-panel">
      <div class="gi-top-bar">
        <button class="icon-btn" onclick="closeGroupInfo()" title="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="gi-top-title">${isRoom ? 'Комната' : 'Группа'}</span>
      </div>
      <div class="gi-body">
        <div class="gi-avatar-wrap">
          <div class="av av-sq ${avatarColor(chatId)}" id="gi-av" style="width:80px;height:80px;font-size:24px;font-weight:700;${canEdit?'cursor:pointer':''}" ${canEdit?'onclick="triggerGiAvatarUpload()"':''}>${initials(chat?.name||'G')}</div>
          ${canEdit?`<div class="gi-avatar-badge" onclick="triggerGiAvatarUpload()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>`:''}
        </div>
        <input type="file" id="gi-avatar-input" accept="image/*" style="display:none" onchange="onGiAvatarChange(this)">
        <div class="gi-name-wrap">
          <input id="gi-name" class="gi-name-input" value="${esc(chat?.name||'')}" placeholder="Название" ${canEdit?'':'readonly'}>
        </div>
        <div class="gi-actions">
          ${addBtn}
          ${leaveBtn}
          ${deleteBtn}
        </div>
        <div class="gi-section-title">Участники</div>
        <div class="gi-members-list" id="gi-members"></div>
      </div>
      ${canEdit?`<div class="gi-footer"><button class="modal-btn-ghost" onclick="closeGroupInfo()">Отмена</button><button class="modal-btn-primary" onclick="saveGroupEdit()">Сохранить</button></div>`:''}
    </div>`);
  const av = document.getElementById('gi-av');
  const avatarUrl = `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${Date.now()}`;
  const img = new Image();
  img.onload = () => { av.style.backgroundImage = `url('${avatarUrl}')`; av.style.backgroundSize = 'cover'; av.textContent = ''; };
  img.src = avatarUrl;
  giRenderMembers(chat?.members || [], canEdit);
}

function closeGroupInfo() {
  const panel = document.querySelector('.gi-panel');
  if (panel) { panel.classList.add('gi-closing'); setTimeout(() => openChat(S.giChatId), 150); }
  else openChat(S.giChatId);
}

function giRenderMembers(members, canEdit = false) {
  const container = document.getElementById('gi-members');
  if (!container) return;
  container.innerHTML = members
    .filter(m => m.id !== S.user.id && !S.giRemovedIds.has(m.id))
    .map(m => `
      <div class="member-remove-row" id="gim-${m.id}">
        <div class="av av-sm av-round ${userAvatarColor(m.id, m.tag)}" data-av-user="${m.id}">${initials(m.display_name)}</div>
        <div class="info"><div class="rname">${esc(m.display_name)}</div><div class="rlogin">@${esc(m.username)}</div></div>
        ${canEdit?`<button class="rm-btn" onclick="giRemoveMember(${m.id})">✕</button>`:''}
      </div>`).join('') || '<div style="font-size:13px;color:var(--muted)">Только вы</div>';
  applyAvatars();
}

async function giRemoveMember(id) {
  const ok = await showConfirm('Удалить участника из группы?', 'Удалить');
  if (!ok) return;
  S.giRemovedIds.add(id);
  document.getElementById(`gim-${id}`)?.remove();
}

async function giLeave() { await leaveGroup(S.giChatId); }
async function giDelete() { await deleteChat(S.giChatId); }

function giBackToInfo() {
  const panel = document.querySelector('.gi-panel');
  if (panel) { panel.classList.add('gi-closing'); setTimeout(() => openGroupInfo(S.giChatId), 150); }
  else openGroupInfo(S.giChatId);
}

async function giShowAdd() {
  const chat = S.chats.find(c => c.id === S.giChatId);
  const render = () => {
    setChatMainContent(`
    <div class="gi-panel">
      <div class="gi-top-bar">
        <button class="icon-btn" onclick="giBackToInfo()" title="Назад">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="gi-top-title">Добавить участника</span>
      </div>
      <div class="gi-body">
        <div class="gi-add-list" id="gi-add-list"></div>
      </div>
      <div class="gi-footer">
        <button class="modal-btn-ghost" onclick="giBackToInfo()">Отмена</button>
        <button class="modal-btn-primary" onclick="giConfirmAdd()">Добавить</button>
      </div>
    </div>`);
    giRenderAddList(chat?.members || []);
  };
  const panel = document.querySelector('.gi-panel');
  if (panel) { panel.classList.add('gi-closing'); setTimeout(render, 150); }
  else render();
}

function giRenderAddList(existingMembers) {
  const existingIds = new Set(existingMembers.map(m => m.id));
  const container = document.getElementById('gi-add-list');
  if (!container) return;
  const available = S.allUsers.filter(u => !existingIds.has(u.id) || S.giRemovedIds.has(u.id));
  container.innerHTML = available.map(u => `
    <div class="user-row${S.giAddIds.has(u.id) ? ' selected' : ''}" data-uid="${u.id}" onclick="giToggleAdd(this,${u.id})">
      <div class="av av-sm av-round ${userAvatarColor(u.id, u.tag)}" data-av-user="${u.id}">${initials(u.display_name)}</div>
      <div><div class="uname">${esc(u.display_name)}</div><div class="ulogin">@${esc(u.username)}</div></div>
    </div>`).join('') || '<div style="font-size:13px;color:var(--muted)">Нет доступных</div>';
  applyAvatars();
}

function giToggleAdd(el, id) {
  el.classList.toggle('selected');
  S.giAddIds.has(id) ? S.giAddIds.delete(id) : S.giAddIds.add(id);
}

async function giConfirmAdd() {
  const chatId = S.giChatId;
  await Promise.all([...S.giAddIds].map(uid => api('POST', `/chats/${chatId}/members`, {user_id: uid})));
  S.giAddIds = new Set();
  await loadChats();
  giBackToInfo();
}

function triggerGiAvatarUpload() { document.getElementById('gi-avatar-input').click(); }
function onGiAvatarChange(input) {
  const file = input.files[0]; if (!file) return;
  resizeAvatarFile(file).then(base64 => {
    S.giAvatarBase64 = base64;
    const el = document.getElementById('gi-av');
    el.style.backgroundImage = `url('data:image/jpeg;base64,${base64}')`;
    el.style.backgroundSize = 'cover'; el.textContent = '';
  });
}

async function saveGroupEdit() {
  const name = document.getElementById('gi-name').value.trim();
  const chatId = S.giChatId;
  const ops = [
    name && api('PATCH', `/chats/${chatId}`, {name}),
    ...[...S.giRemovedIds].map(uid => api('DELETE', `/chats/${chatId}/members/${uid}`)),
    ...[...S.giAddIds].map(uid => api('POST', `/chats/${chatId}/members`, {user_id: uid})),
  ];
  if (S.giAvatarBase64) ops.push(api('POST', `/chats/${chatId}/avatar`, {data: S.giAvatarBase64}));
  await Promise.all(ops);
  S.giAvatarBase64 = null;
  await loadChats();
  openChat(chatId);
}

// ── CHAT LIST CONTEXT MENU ──
function showChatCtx(e, chatId) {
  e.preventDefault();
  e.stopPropagation();
  const chat = S.chats.find(c => c.id === chatId);
  S.ctxChatId = chatId;
  const menu = document.getElementById('ctx-chat-menu');
  const isRoom = chat?.type === 'room';
  const isGroup = chat?.type === 'group';

  // pin/delete/leave скрыты для комнат (управляются через админку)
  const pinBtn = document.getElementById('ctx-chat-pin');
  const pinLabel = document.getElementById('ctx-chat-pin-label');
  if (pinBtn) pinBtn.style.display = isRoom ? 'none' : '';
  if (pinLabel) pinLabel.textContent = chat?.pinned ? 'Открепить' : 'Закрепить';
  const canDelete = !isGroup || chat.created_by === S.user.id || S.user.is_admin;
  const delBtn = document.getElementById('ctx-chat-delete');
  const leaveBtn = document.getElementById('ctx-chat-leave');
  if (delBtn) delBtn.style.display = (isRoom || (!isRoom && !canDelete)) ? 'none' : '';
  if (leaveBtn) leaveBtn.style.display = (isGroup && !canDelete) ? '' : 'none';

  const muteLabel = document.getElementById('ctx-chat-mute-label');
  if (muteLabel) muteLabel.textContent = S.mutedChats.has(chatId) ? 'Включить уведомления' : 'Выключить уведомления';
  menu.style.top = '-9999px'; menu.style.left = '-9999px';
  menu.style.display = 'block';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const margin = 6;
  const _z = (S.settings.uiScale || 100) / 100;
  // Вьюпорт переводим в те же единицы, что и style.left/top: при масштабе интерфейса
  // они не совпадают с window.innerWidth, и меню у края экрана уезжало за границу
  const vw = window.innerWidth / _z, vh = window.innerHeight / _z;
  let x = e.clientX / _z, y = e.clientY / _z;
  if (x + mw + margin > vw) x = vw - mw - margin;
  if (y + mh + margin > vh) y = e.clientY / _z - mh;
  if (y < margin) y = margin;
  if (x < margin) x = margin;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

async function ctxChatLeave() {
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!S.ctxChatId) return;
  await leaveGroup(S.ctxChatId);
}

async function ctxChatPin() {
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!S.ctxChatId) return;
  await api('POST', `/chats/${S.ctxChatId}/pin`);
  await loadChats();
}

async function ctxChatDelete() {
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!S.ctxChatId) return;
  await deleteChat(S.ctxChatId);
}

async function ctxChatMute() {
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!S.ctxChatId) return;
  if (S.mutedChats.has(S.ctxChatId)) {
    await api('DELETE', `/chats/${S.ctxChatId}/mute`);
    S.mutedChats.delete(S.ctxChatId);
  } else {
    await api('POST', `/chats/${S.ctxChatId}/mute`);
    S.mutedChats.add(S.ctxChatId);
  }
  renderChatList();
}

// ── CHAT ACTION SHEET (mobile bottom sheet) ──
function openChatSheet(chatId) {
  S.ctxChatId = chatId;
  const chat = S.chats.find(c => c.id === chatId);
  document.getElementById('chat-sheet-title').textContent = chat ? chatName(chat) : '';
  const isRoom = chat?.type === 'room';
  const pinLabel = document.getElementById('sheet-pin-label');
  if (pinLabel) pinLabel.textContent = chat?.pinned ? 'Открепить' : 'Закрепить';
  const pinBtn = document.getElementById('sheet-pin-btn');
  if (pinBtn) pinBtn.style.display = isRoom ? 'none' : '';
  const muteLabel = document.getElementById('sheet-mute-label');
  if (muteLabel) muteLabel.textContent = S.mutedChats.has(chatId) ? 'Включить уведомления' : 'Выключить уведомления';
  document.getElementById('chat-sheet-backdrop').classList.add('open');
  document.getElementById('chat-action-sheet').classList.add('open');
}
function closeChatSheet() {
  document.getElementById('chat-sheet-backdrop').classList.remove('open');
  document.getElementById('chat-action-sheet').classList.remove('open');
}
async function sheetPinChat() {
  closeChatSheet();
  if (!S.ctxChatId) return;
  await api('POST', `/chats/${S.ctxChatId}/pin`);
  await loadChats();
}

async function sheetDeleteChat() {
  closeChatSheet();
  if (!S.ctxChatId) return;
  await deleteChat(S.ctxChatId);
}

async function sheetMuteChat() {
  closeChatSheet();
  if (!S.ctxChatId) return;
  if (S.mutedChats.has(S.ctxChatId)) {
    await api('DELETE', `/chats/${S.ctxChatId}/mute`);
    S.mutedChats.delete(S.ctxChatId);
  } else {
    await api('POST', `/chats/${S.ctxChatId}/mute`);
    S.mutedChats.add(S.ctxChatId);
  }
  renderChatList();
}

// ── FORWARD ──
function ctxForward() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  const d = S.msgData.get(msgId);
  if (!d) return;
  S.forwardMsg = d.forwardData
    ? { ...d.forwardData }
    : { user_id: d.senderId, name: d.senderName, text: (d.text || '').slice(0, 200), attachment: d.attachment || null, is_bot: d.senderIsBot || false };
  openForwardModal();
}

function openForwardModal() {
  const inp = document.getElementById('forward-search');
  if (inp) inp.value = '';
  renderForwardList('');
  document.getElementById('modal-forward')?.classList.add('open');
}

function closeForwardModal() {
  document.getElementById('modal-forward')?.classList.remove('open');
  S.forwardMsg = null;
}

function renderForwardList(q = '') {
  const list = document.getElementById('forward-list');
  if (!list) return;
  const chats = S.chats.filter(c => !q || chatName(c).toLowerCase().includes(q));
  const directUserIds = new Set(
    S.chats.filter(c => c.type === 'direct')
      .map(c => c.members?.find(m => m.id !== S.user.id)?.id)
      .filter(Boolean)
  );
  const users = S.allUsers.filter(u =>
    u.id !== S.user.id && !directUserIds.has(u.id) &&
    (!q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
  );
  let html = '';
  if (chats.length) {
    html += `<div class="chat-list-section-label">Чаты</div>`;
    html += chats.map(c => `<div class="pp-row" onclick="selectForwardChat(${c.id})" style="cursor:pointer">
      <div class="av av-sm ${chatAvatarClass(c)}${c.type==='direct'?' av-round':' av-sq'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
      <span>${esc(chatName(c))}</span>
    </div>`).join('');
  }
  if (users.length) {
    html += `<div class="chat-list-section-label">Пользователи</div>`;
    html += users.map(u => `<div class="pp-row" onclick="selectForwardUser(${u.id})" style="cursor:pointer">
      <div class="av av-sm av-round av-blue" data-av-user="${u.id}">${esc((u.display_name||'?')[0].toUpperCase())}</div>
      <span>${esc(u.display_name)}</span>
    </div>`).join('');
  }
  if (!html) html = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Нет результатов</div>';
  list.innerHTML = html;
  applyAvatars();
}

async function selectForwardChat(chatId) {
  document.getElementById('modal-forward')?.classList.remove('open');
  await openChat(chatId);
  showForwardBar();
}

async function selectForwardUser(userId) {
  document.getElementById('modal-forward')?.classList.remove('open');
  const data = await api('POST', '/chats/direct', { user_id: userId });
  if (data?.id) { await loadChats(); await openChat(data.id); showForwardBar(); }
}

function showForwardBar() {
  const bar = document.getElementById('forward-bar');
  if (!bar || !S.forwardMsg) return;
  document.getElementById('forward-bar-name').textContent = 'Переслано от ' + (S.forwardMsg.name || '');
  const previewText = S.forwardMsg.text || (S.forwardMsg.attachment ? '📎 Вложение' : '');
  document.getElementById('forward-bar-text').textContent = previewText.slice(0, 80);
  bar.style.display = '';
  document.getElementById('composer-pill')?.classList.add('has-reply');
  document.getElementById('msg-input')?.focus();
}

function hideForwardBar() {
  S.forwardMsg = null;
  const bar = document.getElementById('forward-bar');
  if (bar) bar.style.display = 'none';
  document.getElementById('composer-pill')?.classList.remove('has-reply');
}

// ── MODAL HELPERS ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el || !el.classList.contains('open') || el.classList.contains('closing')) return;
  el.classList.add('closing');
  // Страховка по таймеру: если animationend не придёт (свёрнутое окно, фоновая
  // вкладка, отключённые анимации), модалка навсегда осталась бы с классом open —
  // а пока он висит, Escape считает, что что-то открыто, и перестаёт закрывать чат
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.remove('open', 'closing');
    el.removeEventListener('animationend', onEnd);
  };
  const onEnd = e => { if (e.target === el) finish(); };
  const timer = setTimeout(finish, 400);
  el.addEventListener('animationend', onEnd);
}

// ── SERVER TOAST ──
function showServerToast() {
  let el = document.getElementById('server-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'server-toast';
    el.innerHTML = `<div class="server-toast-spinner"></div><span>Нет соединения с сервером. Переподключение…</span>`;
    document.body.appendChild(el);
  }
  el.classList.add('visible');
}
function hideServerToast() {
  document.getElementById('server-toast')?.classList.remove('visible');
}

// Короткий информационный тост (напр. отказ редактирования). Автоскрытие через 2.5с.
let _actionToastTimer = null;
function showActionToast(text) {
  let el = document.getElementById('action-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'action-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(_actionToastTimer);
  _actionToastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}
