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
  settings: { theme: 'dark', fontSize: 'medium', uiScale: 100 },
  ctx: { messageId: null, canEdit: false, isMine: false, replyText: '', replySenderName: '' },
  editingMessageId: null,
  replyTo: null,
  gm: null,
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
  topics: {},
  activeTopicId: null,
  activeRoomId: null,
  mutedChats: new Set(),
  mutedUntil: {},
  forwardMsg: null,
  msgData: new Map(),
};

const SESSION_KEY = 'electron_v2';
const CRED_KEY = 'electron_creds';
// Хранится только логин, чтобы он подставлялся в форму входа. Пароль не хранится: вместо него вход по ключу устройства (shared/devicekey.js)
function saveCredentials(u) { try { localStorage.setItem(CRED_KEY, JSON.stringify({ u })); } catch {} }
function clearCredentials() { try { localStorage.removeItem(CRED_KEY); } catch {} }
function fillLoginFromCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(CRED_KEY));
    if (!c) return;
    if (c.p !== undefined) { delete c.p; localStorage.setItem(CRED_KEY, JSON.stringify(c)); }   // пароль, сохранённый прежними версиями, стирается
    const un = document.getElementById('l-username'); if (un && c.u) un.value = c.u;
  } catch {}
}
let _loadingMore = false;
let _loadingChatId = null;
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
    if (i % 2 !== 1) return Fmt.spl(mdLite(highlightMentions(esc(part))));
    return `<a class="msg-link" href="#" data-on-click="openExternalLink" data-a-click='["__event", "__this"]' data-url="${esc(part)}">${esc(part)}</a>`;
  }).join('');
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Подсвечивает @упоминания цветом того же пользователя, что и его аватар/реакции —
// сопоставляем не по регэкспу вида «слово», а по реальным именам участников чата,
// потому что insertMention вставляет отображаемое имя целиком, вплоть до пробелов.
// Только участники текущего чата/группы/комнаты — не весь справочник людей
function highlightMentions(escapedText) {
  const members = _mentionMembers(true);
  if (!members || !members.length) return escapedText;
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
    // Не переиспользуем «av-*» классы аватарки как есть: у них уже есть свои
    // правила фона (для кружков аватарок), и мент получал бы фон вдобавок к тексту
    const cls = userAvatarColor(m.id, m.tag).replace(/^av-/, 'mtag-');
    return `<span class="mention ${cls}">@${name}</span>`;
  });
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
        if (await keyLogin()) return api(method, path, body);
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
  // С ключом устройства суточное обновление меняет и токен, и ключ: копия ключа обнаруживается в течение суток
  try {
    const d = window.DeviceKey && await DeviceKey.refresh(S.server);
    if (d && d.token) { S.token = d.token; saveSession(); return true; }
  } catch {}
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
      // На экране входа с сохранённой сессией (проверка на старте не успела) подключаемся не втихую,
      // а заново проверяем сессию и входим: иначе клиент в сети, а человек видит форму входа
      if (onLoginScreen()) { if (!_bootActive && !_bootManual) bootSession(); }
      else if (!S.ws || S.ws.readyState >= 2) connectWS();
      else loadChats();
    }
    if (S.activeChatId && S.ws?.readyState===1) {
    sendRead(S.activeChatId);
    }
  }
  sendPresence(viewing);
}

// Статус присутствия: в фокусе — «онлайн» сразу, без фокуса — «отошёл» через 5 секунд.
// Таймер не перезапускается при повторных сменах фокуса: отсчёт идёт от первой потери.
const AWAY_DELAY = 5000;
let _awayTimer = null;
function sendPresenceStatus(status) {
  if (S.ws?.readyState===1) S.ws.send(JSON.stringify({type:'set_status', status}));
}
function sendPresence(viewing) {
  if (viewing) {
    clearTimeout(_awayTimer); _awayTimer = null;
    sendPresenceStatus('online');
    return;
  }
  if (_awayTimer) return;
  _awayTimer = setTimeout(() => { _awayTimer = null; sendPresenceStatus('away'); }, AWAY_DELAY);
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

// ── МЕНЮ ШАПКИ САЙДБАРА ──
// В шапке остаётся «+», остальные кнопки (скрыть панель, тема, объявление) лежат в узком меню под стрелкой.
// Меню всегда открывается вниз от стрелки, по центру. Рисуется поверх всего (fixed) и при первом открытии
// переезжает в body: у сайдбара есть граница, которая его бы срезала. Подписи к иконкам видны при наведении.
// Масштаб интерфейса (zoom у html) учитываем так же, как у остальных всплывающих меню: считаем в пикселях
// rect, а в style пишем с поправкой на коэффициент zoomMetrics().k.
let _hmOpen = false;
function headMenuPlace() {
  const m = document.getElementById('head-menu'), b = document.getElementById('head-more');
  if (!m || !b) return;
  const k = zoomMetrics(), sb = document.querySelector('.sidebar');
  // В узком сайдбаре (шапка в столбец) подсказки идут вправо, на область чата, иначе влево
  m.classList.toggle('side', !!sb && sb.getBoundingClientRect().width / k.k <= 148);
  m.style.left = '0px'; m.style.top = '0px';
  const mr = m.getBoundingClientRect(), r = b.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - mr.width / 2, k.vw - mr.width - 8));
  const top = Math.max(8, Math.min(r.bottom + 6 * k.k, k.vh - mr.height - 8));
  m.style.left = Math.round(left / k.k) + 'px'; m.style.top = Math.round(top / k.k) + 'px';
}
function headMenuOpen() {
  const m = document.getElementById('head-menu');
  if (!m) return;
  if (m.parentElement !== document.body) document.body.appendChild(m);
  _hmOpen = true; popShow(m); m.hidden = false;
  document.getElementById('head-more')?.setAttribute('aria-expanded', 'true');
  headMenuPlace();
}
function headMenuClose(refocus) {
  if (!_hmOpen) return;
  _hmOpen = false;
  const m = document.getElementById('head-menu'); if (m) popHide(m, () => { m.hidden = true; });
  const b = document.getElementById('head-more');
  b?.setAttribute('aria-expanded', 'false');
  if (refocus) b?.focus();
}
function headMenuToggle(e) { e?.stopPropagation(); _hmOpen ? headMenuClose() : headMenuOpen(); }
document.addEventListener('click', e => { if (_hmOpen && !e.target.closest('#head-menu, #head-more')) headMenuClose(); });
// В фазе перехвата: Escape закрывает только меню и не доходит до общего обработчика (он закрыл бы чат)
document.addEventListener('keydown', e => {
  if (!_hmOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); headMenuClose(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = [...document.querySelectorAll('#head-menu .hm-i')].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement), d = e.key === 'ArrowDown' ? 1 : -1;
    items[(i + d + items.length) % items.length].focus();
  }
}, true);
window.addEventListener('resize', () => headMenuClose());

// ── ПРОВЕРКА СОХРАНЁННОЙ СЕССИИ ПРИ ЗАПУСКЕ ──
// Первый запрос окна к серверу сразу после запуска (особенно после обновления: установка, антивирус,
// определение прокси, сеть ещё поднимается) бывает медленным. Раньше ждали ответ 5 секунд и при
// неудаче показывали форму входа, хотя сессия была в порядке: помогал только перезапуск.
// Теперь проверяем сохранённый токен с повторами, а форму показываем лишь когда сервер сессию
// отклонил или не отвечает дольше BOOT_TOTAL_MS. Пароль в этих запросах не участвует.
const BOOT_TRY_MS = 15000, BOOT_TOTAL_MS = 120000;
let _bootRun = 0;          // номер текущей проверки: новая отменяет прежнюю
let _bootActive = false;   // проверка идёт
let _bootManual = false;   // человек выбрал «Войти вручную»: сами не возвращаем его к проверке
let _bootUiTimer = null;
const bootLog = t => window.electron?.diag?.(t);
function onLoginScreen() { return !!document.getElementById('screen-login')?.classList.contains('active'); }
function bootUi(on, text) {
  const el = document.getElementById('boot-overlay');
  if (!el) return;
  clearTimeout(_bootUiTimer);
  if (!on) { el.hidden = true; return; }
  const t = document.getElementById('boot-text');
  if (text && t) t.textContent = text;
  // Без мигания: если ответ приходит быстро, надпись так и не появится
  if (el.hidden) _bootUiTimer = setTimeout(() => { el.hidden = false; }, 400);
}
// Одна попытка: 'ok' — сервер принял токен, 'revoked' — сессию отозвали или пользователя заблокировали,
// 'invalid' — токен не принят, 'retry' — ответа нет или сервер ещё поднимается
// Токен не принят: входим по ключу устройства (shared/devicekey.js), форма входа остаётся для случая, когда ключа нет или он не принят
async function keyLogin() {
  const d = window.DeviceKey && await DeviceKey.login(S.server);
  if (!d || !d.token) return false;
  Object.assign(S, { token: d.token, user: d.user });
  saveSession();
  return true;
}
async function bootProbe() {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), BOOT_TRY_MS);
  try {
    const res = await fetch(`${httpProto()}://${S.server}/api/users/presence`, { headers: { Authorization: 'Bearer ' + S.token }, signal: ctl.signal });
    if (res.ok) return 'ok';
    if (res.status === 401) {
      const info = await res.json().catch(() => ({}));
      if (['revoked', 'banned', 'user_not_found'].includes(info.code)) return 'revoked';
      if (info.code === 'expired') return (await refreshToken()) ? 'ok' : 'expired';
      return 'invalid';
    }
    return 'retry';
  } catch { return 'retry'; }
  finally { clearTimeout(timer); }
}
async function bootSession() {
  if (!S.token || !S.server) { fillLoginFromCreds(); return; }
  const run = ++_bootRun, t0 = Date.now();
  let n = 0;
  _bootActive = true; _bootManual = false;
  bootUi(true, 'Подключаюсь к серверу…');
  while (run === _bootRun) {
    n++;
    const t1 = Date.now(), r = await bootProbe();
    if (run !== _bootRun) return;
    if (r === 'ok') {
      _bootActive = false; bootUi(false);
      bootLog(`проверка сессии: подтверждена за ${Date.now() - t1} мс (попытка ${n}, с запуска ${Math.round((Date.now() - t0) / 1000)} с)`);
      enterApp();
      return;
    }
    if (r === 'revoked') {
      _bootActive = false; bootUi(false);
      bootLog('проверка сессии: сервер отклонил сессию, выполняется выход');
      logout();
      return;
    }
    if (r === 'invalid' || r === 'expired') {
      bootUi(true, 'Вхожу…');
      if (await keyLogin()) { if (run !== _bootRun) return; _bootActive = false; bootUi(false); enterApp(); return; }
      if (run !== _bootRun) return;
      if (r === 'expired') { _bootActive = false; bootUi(false); bootLog('проверка сессии: токен истёк и обновить его не удалось, выполняется выход'); logout(); return; }
      bootLog('проверка сессии: сервер не принял токен, показан экран входа');
      break;
    }
    const spent = Math.round((Date.now() - t0) / 1000);
    bootLog(`проверка сессии: нет ответа от сервера (попытка ${n}, ${spent} с), пробую ещё раз`);
    if (Date.now() - t0 > BOOT_TOTAL_MS) { bootLog(`проверка сессии: сервер не ответил за ${spent} с, показан экран входа`); break; }
    bootUi(true, 'Сервер отвечает медленно, пробую ещё раз…');
    await new Promise(r => setTimeout(r, Math.min(2000 + n * 1000, 5000)));
  }
  if (run !== _bootRun) return;
  _bootActive = false; bootUi(false);
  fillLoginFromCreds();
}
function bootCancel() {
  _bootRun++; _bootActive = false; _bootManual = true;
  bootUi(false);
  fillLoginFromCreds();
}

// ── INIT ──

window.addEventListener('DOMContentLoaded', async () => {
  S.server = window.location.host;
  const session = loadSession();
  if (session?.token) {
    Object.assign(S, { server: S.server, token:session.token, user:session.user, settings:session.settings||S.settings });
    applySettings();
    // Не ждём: форма входа остаётся доступной, а проверка идёт с повторами (см. bootSession)
    bootSession();
  } else if (await keyLogin()) {
    // Сессии нет, но есть ключ устройства: входим сразу, без формы
    applySettings();
    enterApp();
  } else {
    applySettings();
    fillLoginFromCreds();
  }

  document.getElementById('l-password').addEventListener('keydown', e => e.key==='Enter' && doLogin());
  document.getElementById('l-username').addEventListener('keydown', e => e.key==='Enter' && document.getElementById('l-password').focus());

  document.addEventListener('click', e => {
    hideCtxMenu();
    hideChatCtx();
    const _cm = document.getElementById('ctx-contact-menu'); if (_cm) _cm.style.display = 'none';
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
      document.getElementById('lightbox')?.classList.contains('lb-open') ||   // просмотр фото и видео закрывается своим обработчиком, чат остаётся
      S.editingMessageId;
    hideCtxMenu(); hideReactionPicker(); closeSettings();
    document.getElementById('ep-grid')?.classList.remove('open');
    if (S.editingMessageId) { cancelEdit(); return; }
    if (anyOpen) return;
    // Escape разбирает открытое по одному уровню за нажатие:
    // сначала чат, следующим нажатием — список тем
    if (S.activeChatId) { closeActiveChat(); return; }
    if (S.activeRoomId) {
      closeTopicsPanel();
      S.activeRoomId = null;
      S.activeTopicId = null;
      renderChatList();
      return;
    }
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
    const files = [...e.dataTransfer.files];
    if (files.length) await uploadFiles(files);
  });

  // Paste image from clipboard
  document.addEventListener('paste', async e => {
    if (!S.activeChatId) return;
    const files = Array.from(e.clipboardData.items)
      .filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); await uploadFiles(files); }
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
    const device = window.DeviceKey ? DeviceKey.payload() : null;
    const res = await fetch(`${httpProto()}://${S.server}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,...(device ? { device } : {})})});
    const data = await res.json();
    if (data.token) {
      Object.assign(S, { token:data.token, user:data.user });
      saveCredentials(username);
      window.DeviceKey && DeviceKey.store(S.server, data);
      saveSession(); enterApp();
    } else { err.textContent = data.error||'Неверный логин или пароль'; }
  } catch { err.textContent='Не удалось подключиться к серверу'; }
  finally { btn.disabled=false; btn.textContent='Войти'; }
}

function logout(intentional = false) {
  window.DeviceKey && DeviceKey.logout(S.server);   // ключ этого устройства удаляется здесь и на сервере
  clearInterval(_refreshTimer);
  // Сохранённые для запуска без связи чаты, переписки и очередь неотправленного стираем: они принадлежат этому входу
  try { Object.keys(localStorage).filter(k => k.startsWith('cache_') || k.startsWith('outbox_')).forEach(k => localStorage.removeItem(k)); _outbox.length = 0; _outLoaded = false; _tailMem = null; clearTimeout(_tailT); } catch {}
  _fetchController.abort();
  _fetchController = new AbortController();
  closeSettings();
  if (S.ws) S.ws.close();
  if (intentional) clearCredentials();
  Object.assign(S, { token:null, user:null, chats:[], activeChatId:null, ws:null, unread:{}, allUsers:[] });
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('screen-main').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  if (!intentional) fillLoginFromCreds();
}

// ── ENTER APP ──
// Идентификатор сервера и его имя могли задать после входа: подтягиваем актуальные (нужны для внешней ссылки на профиль)
async function refreshServerInfo() {
  const r = await api('GET', '/auth/me');
  if (!r || !S.user || r.id !== S.user.id) return;
  const wsSame = JSON.stringify(r.workspaces || []) === JSON.stringify(S.user.workspaces || []);
  if ((r.server_name || '') === (S.user.server_name || '') && (r.server_id || '') === (S.user.server_id || '') && wsSame) return;
  S.user.server_name = r.server_name || ''; S.user.server_id = r.server_id || '';
  S.user.workspaces = r.workspaces || []; S.user.workspace_id = r.workspace_id; S.user.workspace_name = r.workspace_name;
  saveSession();
  if (typeof _sidebarTab !== 'undefined' && _sidebarTab === 'settings' && CS.sec === 'profile') csRefresh();
}
function enterApp() {
  startTokenRefresh();
  // Вошли раньше, чем появились ключи (после обновления): выдаём по действующему токену
  if (window.DeviceKey) DeviceKey.ensure(S.server, S.token).then(t => { if (t) { S.token = t; saveSession(); } });
  refreshServerInfo();
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  loadFolders();
  if (typeof loadSharedSpaces === 'function') loadSharedSpaces();
  loadChats().then(() => {
    if (S._pendingOpenChatId) {
      const c = S.chats.find(c => c.id === S._pendingOpenChatId);
      if (c) openChat(S._pendingOpenChatId);
      S._pendingOpenChatId = null;
    }
  });
  loadUsers();
  loadBlocks();
  annSync();
  loadUploadSettings();
  connectWS();
  loadPresence();
  // Show notification permission banner or re-subscribe if already granted
  if (Notification.permission === 'granted') {
    subscribePush();
  } else {
    setTimeout(maybeShowNotifBanner, 800);
  }
  _sidebarTab = 'chats';
}


function updateSidebarThemeIcon() {
  const isDark = S.settings.theme !== 'light';
  const sun = document.getElementById('sidebar-theme-sun');
  if (sun) sun.style.display = isDark ? '' : 'none';
  const moon = document.getElementById('sidebar-theme-moon');
  if (moon) moon.style.display = isDark ? 'none' : '';
}


// ── SETTINGS ──
// ── ЦВЕТОВОЙ АКЦЕНТ ──
// Живёт только на устройстве: отдельный ключ в localStorage, на сервер не уходит
// и в сессию не пишется — поэтому переживает выход из аккаунта, но на другом
// компьютере у того же человека может быть свой цвет.
const ACCENTS = {
  teal:   { name: 'Бирюзовый', light: [29, 168, 140], dark: [41, 214, 184] },
  indigo: { name: 'Индиго',    light: [92, 96, 205],  dark: [143, 148, 245] },
  plum:   { name: 'Сливовый',  light: [146, 84, 190], dark: [196, 146, 240] },
  amber:  { name: 'Янтарный',  light: [186, 120, 38], dark: [236, 176, 92] },
};

function currentAccent() {
  try { const v = localStorage.getItem('accent'); if (ACCENTS[v]) return v; } catch {}
  return 'teal';
}

function setAccent(key) {
  if (!ACCENTS[key]) return;
  try { localStorage.setItem('accent', key); } catch {}
  applyAccent();
  document.querySelectorAll('#accent-seg .accent-dot').forEach(b => {
    b.classList.toggle('active', b.dataset.accent === key);
    const a = ACCENTS[b.dataset.accent];
    b.style.setProperty('--dot', 'rgb(' + accentRgb(a).join(',') + ')');
  });
}

function accentRgb(a) {
  return document.documentElement.classList.contains('dark') ? a.dark : a.light;
}

// Переменные ставим инлайном на <html>: так они перебивают оба набора из таблицы
// стилей, поэтому пересчитываем при каждой смене темы.
function applyAccent() {
  const a = ACCENTS[currentAccent()];
  const dark = document.documentElement.classList.contains('dark');
  const c = dark ? a.dark : a.light;
  const rgba = (arr, alpha) => 'rgba(' + arr.join(',') + ',' + alpha + ')';
  const hex = arr => '#' + arr.map(v => v.toString(16).padStart(2, '0')).join('');
  const s = document.documentElement.style;
  s.setProperty('--accent', hex(c));
  s.setProperty('--accent-rgb', c.join(','));
  s.setProperty('--primary', hex(c));
  s.setProperty('--accent-soft', rgba(c, .12));
  s.setProperty('--primary-light', rgba(c, .10));
  s.setProperty('--accent-border', rgba(c, .28));
  s.setProperty('--accent-shadow', rgba(c, .22));
  s.setProperty('--reaction-mine', rgba(c, dark ? .15 : .13));
  s.setProperty('--reply-bg', rgba(c, .08));
  s.setProperty('--blob1', rgba(c, .12));
  s.setProperty('--role-teal-bg', rgba(c, dark ? .12 : .10));
  s.setProperty('--role-teal-border', rgba(c, dark ? .30 : .25));
  // Подсветку активного чата обе темы берут из светлого варианта — так было и
  // с бирюзовым, менять не стали
  s.setProperty('--active-row', rgba(a.dark, .10));
  s.setProperty('--active-row-border', rgba(a.dark, .25));
}

function accentDotsHtml() {
  const cur = currentAccent();
  return Object.entries(ACCENTS).map(([k, a]) =>
    '<button class="accent-dot' + (k === cur ? ' active' : '') + '" data-accent="' + k + '"' +
    ' title="' + a.name + '" aria-label="' + a.name + '"' +
    ' style="--dot:rgb(' + accentRgb(a).join(',') + ')" data-on-click="setAccent" data-a-click="' + esc(JSON.stringify([k])) + '"></button>').join('');
}


// ── УЗОР ФОНА ПЕРЕПИСКИ ──
// Узор лежит в assets/patterns отдельным слоем под сообщениями. В картинке нет
// цвета — только прозрачность обводки, а красит её тема: слой заливается цветом
// и обрезается картинкой-маской. Так один файл работает и в светлой теме, и в
// тёмной, и все три степени заметности — это просто прозрачность слоя.
// Плитки зеркальные (см. scripts/build-patterns.js), поэтому стыков не видно.
// Выбор и заметность хранятся на устройстве, как тема и акцент.
const PATTERNS = [
  { id: '',          name: 'Без узора' },
  { id: 'pets',      name: 'Питомцы' },
  { id: 'doodles',   name: 'Каракули' },
  { id: 'summer',    name: 'Лето' },
  { id: 'daily',     name: 'Будни' },
  { id: 'steampunk', name: 'Стимпанк' },
];
// Плитка содержит рисунок дважды по каждой оси (зеркало), поэтому её экранный
// размер вдвое больше того, каким виден сам рисунок
const PATTERN_TILE = 680;
// Три степени заметности; в тёмной теме светлый штрих читается слабее, поэтому базы разные
const PATTERN_ALPHA = { light: [0.045, 0.07, 0.105], dark: [0.055, 0.085, 0.13] };

function currentPattern() {
  try { const v = localStorage.getItem('chatPattern'); if (PATTERNS.some(p => p.id === v && v)) return v; } catch {}
  return '';
}
function currentPatternLevel() {
  const n = Number(localStorage.getItem('chatPatternLevel'));
  return n === 1 || n === 3 ? n : 2;
}

function setChatPattern(id) {
  try { localStorage.setItem('chatPattern', id || ''); } catch {}
  applyChatPattern();
  document.querySelectorAll('#pattern-cards .pat-card').forEach(c =>
    c.classList.toggle('active', c.dataset.pattern === currentPattern()));
  const line = document.getElementById('pattern-level-line');
  if (line) line.style.display = currentPattern() ? '' : 'none';
}

function setPatternLevel(n) {
  try { localStorage.setItem('chatPatternLevel', String(n)); } catch {}
  applyChatPattern();
  document.querySelectorAll('#pattern-seg button').forEach((b, i) =>
    b.classList.toggle('active', i + 1 === currentPatternLevel()));
}

function patternUrl(id) {
  return id ? 'url("assets/patterns/' + id + '.png")' : '';
}

function applyChatPattern() {
  const id = currentPattern();
  const s = document.documentElement.style;
  if (!id) {
    // Слой без маски залил бы всю переписку сплошным цветом — гасим прозрачностью
    s.removeProperty('--chat-pattern');
    s.removeProperty('--chat-pattern-size');
    s.removeProperty('--chat-pattern-ink');
    s.removeProperty('--chat-pattern-alpha');
    return;
  }
  const dark = document.documentElement.classList.contains('dark');
  s.setProperty('--chat-pattern', patternUrl(id));
  s.setProperty('--chat-pattern-size', PATTERN_TILE + 'px');
  s.setProperty('--chat-pattern-ink', dark ? '#ffffff' : '#111318');
  s.setProperty('--chat-pattern-alpha',
    String(PATTERN_ALPHA[dark ? 'dark' : 'light'][currentPatternLevel() - 1]));
}

// Карточки выбора в настройках: сам узор и служит образцом
function chatPatternCardsHtml() {
  const cur = currentPattern();
  return '<div class="pat-cards" id="pattern-cards">' + PATTERNS.map(p =>
    '<button class="pat-card' + (p.id === cur ? ' active' : '') + '" data-pattern="' + p.id + '"' +
    ' data-on-click="setChatPattern" data-a-click="' + esc(JSON.stringify([p.id])) + '">' +
      '<span class="pat-swatch"></span>' +
      '<span class="pat-cap">' + p.name + '</span>' +
    '</button>').join('') + '</div>';
}

// Маску образцов ставим из кода: в url() есть кавычки, в inline-атрибуте они рвут значение
function paintPatternSwatches() {
  document.querySelectorAll('#pattern-cards .pat-card').forEach(card => {
    const el = card.querySelector('.pat-swatch');
    const url = patternUrl(card.dataset.pattern) || 'none';
    el.style.webkitMaskImage = url;
    el.style.maskImage = url;
  });
}

// ── ФОН ПЕРЕПИСКИ ──
// «Как обычно» — сайдбар и переписка одного цвета; «с разделением» — переписка
// отделена оттенком: в тёмной теме светлее сайдбара, в светлой темнее.
// Значения на каждую тему заданы в стилях, здесь только переключаем ссылки.
// Хранится на устройстве, как и цвет акцента.
function currentChatBg() {
  try { return localStorage.getItem('chatBg') === 'split' ? 'split' : 'plain'; } catch { return 'plain'; }
}

function setChatBg(mode) {
  try { localStorage.setItem('chatBg', mode === 'split' ? 'split' : 'plain'); } catch {}
  applyChatBg();
  document.querySelectorAll('#chatbg-cards .bg-card').forEach(c =>
    c.classList.toggle('active', c.dataset.bg === currentChatBg()));
}

function applyChatBg() {
  const s = document.documentElement.style;
  if (currentChatBg() === 'split') {
    s.setProperty('--chat-bg', 'var(--chat-split)');
    s.setProperty('--bubble-bg', 'var(--bubble-split)');
  } else {
    s.removeProperty('--chat-bg');
    s.removeProperty('--bubble-bg');
  }
}

// Карточки выбора: скелетон окна — слева сайдбар, справа переписка
function chatBgCardsHtml() {
  const cur = currentChatBg();
  const skel = split => `<span class="bg-skel">
      <span class="bs-side"><i></i><i></i><i></i></span>
      <span class="bs-chat${split ? ' split' : ''}"><i class="a"></i><i class="b"></i><i class="c"></i></span>
    </span>`;
  const card = (mode, title, sub) => `<button class="bg-card${cur === mode ? ' active' : ''}" data-bg="${mode}" data-on-click="setChatBg" data-a-click="${esc(JSON.stringify([`${mode}`]))}">
      ${skel(mode === 'split')}
      <span class="bg-cap"><b>${title}</b>${sub}</span>
    </button>`;
  return `<div class="bg-cards" id="chatbg-cards">
    ${card('plain', 'Как обычно', 'Сайдбар и переписка одного цвета')}
    ${card('split', 'С разделением', 'Переписка отделена оттенком')}
  </div>`;
}

// Прозрачность стекла → множитель плотности --gl-k: 50% = 1, 0% = 1,9 (плотнее), 100% = 0,15 (почти прозрачное)
function glassK(t) { return Math.max(.15, 1.9 - .018 * (t == null ? 50 : Math.min(100, Math.max(0, +t)))); }
function applySettings() {
  headMenuClose();
  const isDark = S.settings.theme === 'dark' || S.settings.theme === 'navy';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('navy', S.settings.theme === 'navy');
  document.documentElement.className = document.documentElement.className.replace(/font-\w+/,'');
  document.documentElement.classList.add('font-'+S.settings.fontSize);
  document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===(S.settings.theme==='light'?'Светлая':'Тёмная')));
  document.querySelectorAll('#font-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===S.settings.fontSize[0].toUpperCase()));
  const _scale = S.settings.uiScale || 100;
  const _ratio = _scale / 100;
  // Сдвиг текста в пузыре (центровка по x-высоте): при масштабе меньше 100% размеры строки
  // округляются так, что текст и без сдвига стоит по центру; от 100% нужен сдвиг вверх
  document.documentElement.style.setProperty('--bubble-text-shift', _scale < 100 ? '0em' : '-0.107em');
  document.documentElement.style.minHeight = '';
  document.body.style.height = '';
  const htmlStyle = document.documentElement.style;
  htmlStyle.zoom = _scale === 100 ? '' : (_scale + '%');
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
  if (themeColorMeta) themeColorMeta.content = S.settings.theme === 'navy' ? '#1c2835' : isDark ? '#0b0d14' : '#f7f7fb';
  // Стекло: «Цветная картинка» (пятна под стеклом) и «Прозрачность» (0–100, 50 — стандартная плотность)
  document.documentElement.classList.toggle('gl-noimg', S.settings.glassImage === false);
  document.documentElement.style.setProperty('--gl-k', glassK(S.settings.glassTransparency).toFixed(3));
  applyAccent();
  applyChatBg();
  applyChatPattern();
  document.querySelectorAll('#pattern-seg button').forEach((b, i) =>
    b.classList.toggle('active', i + 1 === currentPatternLevel()));
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
// Кнопка в меню шапки листает темы по кругу: светлая, тёмная, тёмно-синяя
function toggleTheme() { setTheme({ light: 'dark', dark: 'navy', navy: 'light' }[S.settings.theme] || 'dark'); }
function setFontSize(f) { S.settings.fontSize=f; applySettings(); saveSession(); }
function setUiScale(v) { S.settings.uiScale = v; applySettings(); saveSession(); }
// ── НАСТРОЙКИ ──
// Окно рисует скрипт: слева карточка профиля и разделы с их главным значением, справа строки
// настроек группами. Всё, кроме имени и пароля, применяется сразу, как и раньше.
// Код общий для приложения и веб-клиента: «Обновление», автозапуск и сайдбар есть только
// в Electron, а на телефоне разделы открываются списком, как в системных настройках.
const CS = {
  sec: 'profile', nameDraft: '', nameBusy: false, nameMsg: '',
  pwOpen: false, pw: { old: '', a: '', b: '' }, pwShow: false, pwErr: '', pwBusy: false, pwDone: false,
  autostart: null, version: null, avatar: undefined,
};
const csIsApp = () => typeof window.electron !== 'undefined';
const csSvg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CS_I = {
  user: csSvg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  gear: csSvg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  palette: csSvg('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'),
  upd: csSvg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  x: csSvg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  pen: csSvg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  eye: csSvg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: csSvg('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),
  out: csSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  copy: csSvg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  folder: csSvg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  check: csSvg('<path d="M20 6 9 17l-5-5"/>'),
  sun: csSvg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: csSvg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  navy: csSvg('<path fill="currentColor" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  play: csSvg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  back: csSvg('<path d="m15 18-6-6 6-6"/>'),
  chev: csSvg('<path d="m9 18 6-6-6-6"/>'),
  down: csSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  bolt: csSvg('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
  search: csSvg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  ban: csSvg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  lock: csSvg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
};

// Настройки живут во вкладке сайдбара (см. setSidebarTab), а не в модалке —
// openSettings/closeSettings оставлены как обёртки над ней, чтобы не искать
// все старые вызовы по коду.
async function openSettings(section = 'profile') {
  Object.assign(CS, {
    sec: section, nameDraft: S.user?.display_name || '', nameBusy: false, nameMsg: '',
    pwOpen: false, pw: { old: '', a: '', b: '' }, pwShow: false, pwErr: '', pwBusy: false, pwDone: false, avatar: undefined,
  });
  setSidebarTab('settings');
  if (csIsApp()) {
    window.electron?.getAutostart?.().then(v => { CS.autostart = !!v; csRefresh(); });
    window.electron?.getVersion?.().then(v => { CS.version = v || null; csRefresh(); });
  }
}

function closeSettings() { if (_sidebarTab === 'settings') setSidebarTab('chats'); }

// ── ВКЛАДКИ САЙДБАРА (Чаты / Контакты / Настройки) ──
// Раньше внизу сайдбара была карточка «я» с шестерёнкой в модалку настроек.
// Теперь там три вкладки — «Чаты» по умолчанию, «Контакты» — список всех
// пользователей, «Настройки» рисуются прямо в сайдбаре и основной области
// (csRenderInline), без модалки.
let _sidebarTab = 'chats';

// Смена вкладки сайдбара как в макете: прежнее содержимое уходит вправо и гаснет, новое выезжает справа и проявляется
function sidebarGhost() {
  const list = document.getElementById('chats-list'), par = list && list.offsetParent;
  if (!par || !list.animate || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const g = list.cloneNode(true);
  g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  g.setAttribute('aria-hidden', 'true'); g.inert = true;
  Object.assign(g.style, { position: 'absolute', left: list.offsetLeft + 'px', top: list.offsetTop + 'px', width: list.offsetWidth + 'px', height: list.offsetHeight + 'px', margin: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
  par.appendChild(g); g.scrollTop = list.scrollTop;
  return g;
}
function sidebarSwap(g) {
  if (!g) return;
  const ease = 'cubic-bezier(.22,1,.36,1)', list = document.getElementById('chats-list');
  const out = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(8%)' }], { duration: 300, easing: ease, fill: 'forwards' });
  out.onfinish = () => g.remove();
  setTimeout(() => g.remove(), 700);   // не rAF: в свёрнутом окне onfinish может не прийти
  if (list) list.animate([{ opacity: 0, transform: 'translateX(8%)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: ease });
}

function setSidebarTab(tab) {
  if (tab === _sidebarTab) return;
  const prevTab = _sidebarTab;
  const _swap = sidebarGhost();
  // уходя со вкладки «Чаты» — выходим из открытой панели тем, чтобы не путать
  // сжатый в полосу сайдбар с контактами/настройками
  if (prevTab === 'chats' && S.activeRoomId) leaveRoom();
  _sidebarTab = tab;
  const _nb = document.querySelector('.btn-new-chat');
  if (_nb) {
    const c = tab === 'contacts';
    _nb.title = c ? 'Добавить контакт' : 'Новый чат';
    _nb.setAttribute('data-on-click', c ? 'openAddContact' : 'openNewChat');
    _nb.setAttribute('data-a-click', '[]');
    _nb.innerHTML = c ? NB_ICON_CONTACT : NB_ICON_CHAT;
  }
  document.querySelectorAll('.sb-tab').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  document.getElementById('chats-search-wrap').style.display = tab === 'chats' ? '' : 'none';
  document.getElementById('contacts-search-wrap').style.display = tab === 'contacts' ? '' : 'none';
  document.getElementById('sidebar-search').style.display = tab === 'settings' ? 'none' : '';
  const _cf = document.getElementById('chat-filter'); if (_cf) _cf.style.display = tab === 'chats' ? '' : 'none';
  const list = document.getElementById('chats-list');
  if (tab === 'chats') {
    list.className = 'chats-list';
    renderChatList();
    if (prevTab === 'settings') restoreChatMainArea();
  } else if (tab === 'contacts') {
    list.className = 'chats-list';
    const input = document.getElementById('contacts-search'); if (input) input.value = '';
    renderContactsList();
    if (prevTab === 'settings') restoreChatMainArea();
  } else if (tab === 'settings') {
    openSettingsInline();
  }
  sidebarSwap(_swap);
}

// Сброс формы настроек к разделу «Профиль» — то же самое, что раньше делал
// openSettings() перед открытием модалки.
function openSettingsInline(section) {
  Object.assign(CS, {
    sec: section || CS.sec || 'profile', nameDraft: S.user?.display_name || '', nameBusy: false, nameMsg: '',
    pwOpen: false, pw: { old: '', a: '', b: '' }, pwShow: false, pwErr: '', pwBusy: false, pwDone: false, avatar: undefined,
  });
  csRenderInline();
  if (csIsApp()) {
    window.electron?.getAutostart?.().then(v => { CS.autostart = !!v; csRefresh(); });
    window.electron?.getVersion?.().then(v => { CS.version = v || null; csRefresh(); });
  }
}

// Возвращает основную область к чату, открытому до входа в настройки
// (или к пустому состоянию, если чат не был открыт)
function restoreChatMainArea() {
  if (S.activeChatId) { openChat(S.activeChatId, null, true); return; }
  setChatMainContent(`<div class="empty-state">
    <div class="empty-icon">💬</div>
    <div class="empty-title">Electron</div>
    <div class="empty-sub">Выберите чат или создайте новый</div>
  </div>`);
}

// ── КОНТАКТЫ ──
// Список всех пользователей компании — та же аватарка и подложка тега, что и при
// выборе собеседника для нового чата (ppAvHtml), плюс индикатор «в сети».
function contactRowHtml(u) {
  return `<div class="pp-row" data-uid="${u.id}" data-on-click="openContactChat" data-a-click="${esc(JSON.stringify([u.id]))}" data-on-contextmenu="contactMenu" data-a-contextmenu="${esc(JSON.stringify(["__event", u.id]))}">
    <div class="av-wrap" title="Профиль" data-on-click="__h14" data-a-click="${esc(JSON.stringify([u.id]))}">${ppAvHtml(u)}${presenceDot(u.id)}</div>
    <div class="pp-col"><div class="pp-line"><span class="pp-name">${esc(u.display_name)}</span>${u.tag ? `<span class="pp-tag ${senderNameClass(u.tag)}">${esc(u.tag)}</span>` : ''}</div>${wsTag(u)}</div>
  </div>`;
}
// Группы контактов: онлайн, отошёл, не в сети — подписи как в списке чатов
const CONTACT_GROUPS = [[0, 'Онлайн'], [1, 'Отошёл'], [2, 'Не в сети']];
function contactGroupsHtml(users, rank, rowHtml) {
  let html = '', first = true;
  CONTACT_GROUPS.forEach(([r, label]) => {
    const items = users.filter(u => rank(u) === r);
    if (!items.length) return;
    html += `<div class="chat-list-section-label"${first ? '' : ' style="padding-top:12px"'}>${label}</div>` + items.map(rowHtml).join('');
    first = false;
  });
  return html;
}

function renderContactsList(filter = '') {
  const list = document.getElementById('chats-list');
  if (!list) return;
  const q = filter.trim().toLowerCase();
  const users = S.allUsers.filter(u => u.id !== S.user.id && isPickable(u) && (typeof spaceUserPass !== 'function' || spaceUserPass(u)) &&
    (!q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)));
  // Сначала те, кто в сети; внутри каждой группы — по имени
  const rank = u => ({ online: 0, away: 1 })[S.presence[u.id]] ?? 2;
  const byName = (a, b) => a.display_name.localeCompare(b.display_name, 'ru', { numeric: true });
  // Один общий список: свои, из других пространств и с других серверов вместе; «чужих» отличает значок под именем
  users.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  const html = users.length ? contactGroupsHtml(users, rank, contactRowHtml) : '';
  list.innerHTML = html || (q
    ? `<div class="cs-stub"><div class="cs-stub-i">${CS_I.search || CS_I.user}</div><b>Никого не нашлось</b><span>Проверьте написание имени или логина.</span></div>`
    : `<div class="cs-stub"><div class="cs-stub-i">${CS_I.user}</div><b>Контактов пока нет</b>
        <span>В вашем пространстве больше никого нет. Человека из другого пространства можно добавить по логину.</span>
        <button type="button" class="modal-btn-primary" style="margin-top:12px" data-on-click="openAddContact">Добавить контакт</button></div>`);
}
function filterContacts(q) { renderContactsList(q); }
async function openContactChat(userId) {
  await startDirect(userId);
  setSidebarTab('chats');
}

function csSections() {
  const s = S.settings;
  const list = [
    { k: 'profile', label: 'Профиль', icon: CS_I.user, desc: 'Фото, имя и пароль', meta: () => '@' + (S.user?.username || '') },
    { k: 'general', label: 'Основные', icon: CS_I.gear, desc: csIsApp() ? 'Звук и поведение приложения' : 'Звук сообщений',
      meta: () => [s.soundEnabled !== false ? 'звук включён' : 'без звука', csIsApp() && CS.autostart ? 'автозапуск' : ''].filter(Boolean).join(' · ') },
    { k: 'appearance', label: 'Внешний вид', icon: CS_I.palette, desc: 'Тема, цвет, фон переписки и размер текста',
      meta: () => `${s.theme === 'dark' ? 'Тёмная' : s.theme === 'navy' ? 'Тёмно-синяя' : 'Светлая'} · ${ACCENTS[currentAccent()].name.toLowerCase()}` },
  ];
  list.push({ k: 'blocks', label: 'Блокировки', icon: CS_I.ban, desc: 'Люди, которые не могут вам писать',
    meta: () => (S.blocked || []).length ? `заблокировано: ${S.blocked.length}` : 'никого нет' });
  list.push({ k: 'modules', label: 'Модули', icon: CS_I.puzzle, desc: 'Дополнительные возможности клиента',
    meta: () => { const l = window.Modules ? Modules.list() : []; if (!l.length) return 'нет доступных'; const n = l.filter(m => m.on).length; return n ? `включено: ${n}` : `${l.length} ${plural(l.length, 'модуль', 'модуля', 'модулей')} доступно`; } });
  list.push({ k: 'folders', label: 'Папки и пространства', icon: CS_I.folder, desc: 'Папки чатов и пространства в баре',
    meta: () => (S.folders || []).length ? `${S.folders.length} ${plural(S.folders.length, 'папка', 'папки', 'папок')}` : 'папок нет' });
  if (csIsApp()) list.push({ k: 'update', label: 'Обновление', icon: CS_I.upd, desc: 'Версия приложения и новые релизы',
    meta: () => _updateDownloadUrl && _updateVersion ? `есть версия ${_updateVersion}` : CS.version ? `версия ${CS.version}` : 'проверка обновлений',
    dot: () => !!_updateDownloadUrl });
  return list;
}

const csAv = size => `<span class="av cs-av-me ${userAvatarColor(S.user.id, S.user.tag)}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .34)}px">${esc(initials(S.user.display_name))}</span>`;
// Фото рисуем во всех аватарках окна сразу: в навигации и в карточке профиля.
// Адрес запоминаем, чтобы перерисовка окна не качала картинку заново.
function csPaintAvatars() {
  document.querySelectorAll('.cs-av-me').forEach(el => {
    if (CS.avatar) {
      el.style.backgroundImage = `url('${CS.avatar}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.textContent = initials(S.user.display_name);
    }
  });
}
function updateSettingsAvatar() {
  if (!S.user) return;
  const url = `${httpProto()}://${S.server}/api/users/${S.user.id}/avatar?t=${Date.now()}`;
  const img = new Image();
  img.onload = () => { CS.avatar = url; csPaintAvatars(); };
  img.onerror = () => { CS.avatar = null; csPaintAvatars(); };
  img.src = url;
}

// ── Профиль ──
function csPwStrength(p) {
  if (!p) return null;
  if (p.length < 6) return { n: 1, t: 'коротковат', c: 'var(--danger)' };
  let s = 1;
  if (p.length >= 10) s++;
  if (/[A-ZА-ЯЁ]/.test(p) && /[a-zа-яё]/.test(p)) s++;
  if (/\d/.test(p) && /[^\wА-Яа-яЁё]/.test(p)) s++;
  return [null, { n: 1, t: 'слабый', c: 'var(--danger)' }, { n: 2, t: 'средний', c: 'var(--cs-warn)' }, { n: 3, t: 'хороший', c: 'var(--cs-ok)' }, { n: 4, t: 'надёжный', c: 'var(--cs-ok)' }][s];
}
const csPwBar = st => `${[1, 2, 3, 4].map(i => `<i class="${st && i <= st.n ? 'on' : ''}" style="--c:${st?.c || 'transparent'}"></i>`).join('')}<span>${st ? `Пароль ${st.t}` : 'Надёжность'}</span>`;
const csPwReady = () => { const p = CS.pw; return !!p.old && p.a.length >= 6 && p.a === p.b && p.a !== p.old; };
function csPwMsg() {
  const p = CS.pw;
  if (CS.pwErr) return `<span class="cs-err">${esc(CS.pwErr)}</span>`;
  if (p.a && p.a.length < 6) { const n = 6 - p.a.length; return `<span class="cs-hint">Ещё ${n} ${plural(n, 'символ', 'символа', 'символов')} до минимума</span>`; }
  if (p.a && p.old && p.a === p.old) return '<span class="cs-err">Новый пароль совпадает с текущим</span>';
  if (p.b && p.a !== p.b) return '<span class="cs-err">Пароли не совпадают</span>';
  if (p.b && p.a === p.b) return '<span class="cs-okt">Пароли совпадают</span>';
  return '';
}
function csPaneProfile() {
  const u = S.user, draft = CS.nameDraft, ok = draft.trim().length > 0, changed = draft.trim() !== u.display_name;
  const type = CS.pwShow ? 'text' : 'password';
  const where = csIsApp() ? 'На этом компьютере' : 'В этом браузере';
  return `<div class="cs-hero">
      <button type="button" class="cs-av-edit" aria-label="Сменить фото" data-on-click="triggerAvatarUpload">${csAv(72)}<span class="cs-badge">${CS_I.pen}</span></button>
      <div class="cs-hero-t"><b>${esc(u.display_name)}</b><span>@${esc(u.username)}</span>
        ${u.tag ? `<div class="cs-chips"><span class="cs-chip">${esc(u.tag)}</span></div>` : ''}</div>
    </div>
    ${profileLinksHtml()}
    <div class="cs-gt">Имя</div>
    <div class="cs-g"><div class="cs-r stack">
      <div class="cs-l"><b>Как вас видят в чатах</b><span>Логин @${esc(u.username)} не меняется — его задаёт администратор.</span></div>
      <div class="cs-ctl">
        <div class="cs-inp ${ok ? '' : 'bad'}" style="flex:1;min-width:180px"><input id="cs-name" value="${esc(draft)}" maxlength="40" aria-label="Имя" autocomplete="off"
          data-on-input="csNameInput" data-a-input='["__value"]' data-on-keydown="__h15"><span class="cs-cnt" id="cs-cnt">${draft.length}/40</span></div>
        <button type="button" class="cs-btn solid" id="cs-name-save" ${ok && changed && !CS.nameBusy ? '' : 'disabled'} data-on-click="csSaveName">${CS.nameBusy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
      <div id="cs-name-msg">${!ok ? '<span class="cs-err">Имя не может быть пустым</span>' : CS.nameMsg === 'ok' ? '<span class="cs-okt">Имя сохранено — его увидят все собеседники</span>' : CS.nameMsg ? `<span class="cs-err">${esc(CS.nameMsg)}</span>` : ''}</div>
    </div></div>
    <div class="cs-gt">Безопасность</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Пароль</b>${CS.pwDone ? '<span class="cs-okt">Пароль изменён</span>' : `<span>${CS.pwOpen ? 'Введите текущий пароль и придумайте новый — от 6 символов' : 'Меняется здесь же, без администратора'}</span>`}</div>
        ${CS.pwOpen ? '' : `<button type="button" class="cs-btn ghost" data-on-click="csPwToggle">${CS_I.lock}Сменить пароль</button>`}</div>
      ${CS.pwOpen ? `<div class="cs-r stack">
        <div class="cs-inp"><input id="cs-pw0" type="${type}" placeholder="Текущий пароль" autocomplete="current-password" data-on-input="csPwInput" data-a-input='["old", "__value"]'>
          <button type="button" class="cs-eye" aria-label="${CS.pwShow ? 'Скрыть пароли' : 'Показать пароли'}" data-on-click="csPwEye">${CS.pwShow ? CS_I.eyeOff : CS_I.eye}</button></div>
        <div class="cs-inp"><input id="cs-pw1" type="${type}" placeholder="Новый пароль" autocomplete="new-password" data-on-input="csPwInput" data-a-input='["a", "__value"]'></div>
        <div class="cs-pwbar" id="cs-pwbar">${csPwBar(csPwStrength(CS.pw.a))}</div>
        <div class="cs-inp ${CS.pw.b && CS.pw.a !== CS.pw.b ? 'bad' : ''}" id="cs-pw2box"><input id="cs-pw2" type="${type}" placeholder="Повторите новый пароль" autocomplete="new-password" data-on-input="csPwInput" data-a-input='["b", "__value"]' data-on-keydown="__h16"></div>
        <div id="cs-pwmsg">${csPwMsg()}</div>
        <div class="cs-ctl"><span class="cs-grow"></span><button type="button" class="cs-btn ghost" data-on-click="csPwToggle">Отмена</button>
          <button type="button" class="cs-btn solid" id="cs-pwsave" ${csPwReady() && !CS.pwBusy ? '' : 'disabled'} data-on-click="submitOwnPassword">${CS.pwBusy ? 'Сохраняю…' : 'Сохранить пароль'}</button></div>
      </div>` : ''}
    </div>
    <div class="cs-logout"><div class="cs-l"><b>Выйти из аккаунта</b><span>${where} понадобится снова ввести логин и пароль</span></div>
      <button type="button" class="cs-btn danger" data-on-click="logout" data-a-click='[true]'>${CS_I.out}Выйти</button></div>`;
}
// ── Ссылка на профиль ──
// Внутренняя (@логин) для людей этого сервера, внешняя (@сервер:логин) для людей с других; внешняя есть, только если на сервере настроена федерация
function profileLinks() {
  const u = S.user, l = [['in', 'Внутренняя', '@' + u.username]];
  if (u.server_id) l.push(['ext', 'Внешняя', '@' + u.server_id + ':' + u.username]);
  return l;
}
function profileLinksHtml() {
  const u = S.user;
  return `<div class="cs-gt">Ссылка на профиль</div>
    <div class="cs-g"><div class="cs-r stack"><div class="pl-b">${profileLinks().map(([k, lab, v]) => `<button type="button" class="pl-f" data-pl="${k}" aria-label="Скопировать: ${esc(v)}" data-on-click="copyProfileLink" data-a-click="${esc(JSON.stringify([`${k}`]))}"><span class="pl-k">${lab}</span><span class="pl-v">${esc(v)}</span><span class="pl-i">${CS_I.copy}</span></button>`).join('')}</div>
    <p class="pl-n">${u.server_id ? 'Внутреннюю называйте коллегам на вашем сервере, внешнюю людям с других серверов.' : 'Внешняя ссылка появится, когда администратор настроит федерацию сервера.'}</p></div></div>`;
}
async function copyProfileLink(kind) {
  const l = profileLinks().find(x => x[0] === kind); if (!l) return;
  try { await navigator.clipboard.writeText(l[2]); } catch { showActionToast('Не удалось скопировать'); return; }
  showActionToast('Скопировано: ' + l[2]);
  const b = document.querySelector(`.pl-f[data-pl="${kind}"]`); if (!b) return;
  const ic = b.querySelector('.pl-i'), orig = ic.innerHTML;
  b.classList.add('done'); ic.innerHTML = CS_I.check;
  setTimeout(() => { b.classList.remove('done'); ic.innerHTML = orig; }, 1600);
}
function csNameInput(v) {
  CS.nameDraft = v;
  CS.nameMsg = '';
  const ok = v.trim().length > 0, changed = v.trim() !== S.user.display_name;
  const cnt = document.getElementById('cs-cnt'); if (cnt) cnt.textContent = `${v.length}/40`;
  const btn = document.getElementById('cs-name-save'); if (btn) btn.disabled = !(ok && changed) || CS.nameBusy;
  document.getElementById('cs-name')?.parentElement.classList.toggle('bad', !ok);
  const msg = document.getElementById('cs-name-msg'); if (msg) msg.innerHTML = ok ? '' : '<span class="cs-err">Имя не может быть пустым</span>';
}
async function csSaveName() {
  const name = CS.nameDraft.trim();
  if (!name || name === S.user.display_name || CS.nameBusy) return;
  CS.nameBusy = true;
  csRefresh();
  const res = await api('PATCH', '/users/me', { display_name: name });
  CS.nameBusy = false;
  if (res?.ok) { S.user.display_name = name; CS.nameDraft = name; CS.nameMsg = 'ok'; saveSession(); }
  else CS.nameMsg = res?.error || 'Не удалось сохранить имя';
  csRefresh();
}
function csPwToggle() {
  Object.assign(CS, { pwOpen: !CS.pwOpen, pw: { old: '', a: '', b: '' }, pwShow: false, pwErr: '', pwDone: false });
  csRefresh(CS.pwOpen ? 'cs-pw0' : null);
}
function csPwEye() { CS.pwShow = !CS.pwShow; csRefresh(); }
function csPwInput(k, v) {
  CS.pw[k] = v;
  CS.pwErr = '';
  const bar = document.getElementById('cs-pwbar'); if (bar) bar.innerHTML = csPwBar(csPwStrength(CS.pw.a));
  const msg = document.getElementById('cs-pwmsg'); if (msg) msg.innerHTML = csPwMsg();
  document.getElementById('cs-pw2box')?.classList.toggle('bad', !!CS.pw.b && CS.pw.a !== CS.pw.b);
  const btn = document.getElementById('cs-pwsave'); if (btn) btn.disabled = !csPwReady() || CS.pwBusy;
}
async function submitOwnPassword() {
  if (!csPwReady() || CS.pwBusy) return;
  CS.pwBusy = true;
  csRefresh();
  const r = await api('POST', '/users/me/password', { old_password: CS.pw.old, new_password: CS.pw.a });
  CS.pwBusy = false;
  if (!r || r.error) { CS.pwErr = r?.error || 'Не удалось сменить пароль'; return csRefresh('cs-pw0'); }
  Object.assign(CS, { pwOpen: false, pw: { old: '', a: '', b: '' }, pwShow: false, pwDone: true });
  csRefresh();
}

// ── Основные ──
const csTg = (on, fn, label, arg) => `<button type="button" class="cs-tg" role="switch" aria-checked="${on}" aria-label="${label}" data-on-click="${fn}" data-a-click="${esc(JSON.stringify(arg === undefined ? [] : [arg]))}"></button>`;
function csPaneGeneral() {
  const sound = S.settings.soundEnabled !== false;
  return `<div class="cs-gt">Уведомления</div>
    <div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Звук сообщений</b><span>Короткий сигнал, когда приходит новое сообщение</span></div>
      <div class="cs-ctl"><button type="button" class="cs-btn ghost sm" ${sound ? '' : 'disabled'} data-on-click="playNotificationSound">${CS_I.play}Прослушать</button>${csTg(sound, 'csSound', 'Звук сообщений')}</div></div>
      <div class="cs-r"><div class="cs-l"><b>Показывать текст сообщения</b><span>Выключите, если экран виден посторонним: в уведомлении будет только «Новое сообщение»</span></div>${csTg(_pushPrefs.show_text !== false, 'csPushText', 'Показывать текст сообщения')}</div>
      <div class="cs-r"><div class="cs-l"><b>Тихие часы</b><span>${_pushPrefs.quiet_from != null ? 'В это время уведомлений и звука нет, сообщения никуда не пропадают' : 'В выбранные часы уведомлений и звука нет'}</span></div>
        <div class="cs-ctl">${_pushPrefs.quiet_from != null ? `<input type="time" class="cs-time" value="${_hhmm(_pushPrefs.quiet_from)}" data-on-change="csQuietTime" data-a-change='["quiet_from", "__value"]' aria-label="С"><span class="cs-dash">–</span><input type="time" class="cs-time" value="${_hhmm(_pushPrefs.quiet_to)}" data-on-change="csQuietTime" data-a-change='["quiet_to", "__value"]' aria-label="До">` : ''}${csTg(_pushPrefs.quiet_from != null, 'csQuiet', 'Тихие часы')}</div></div>
    </div>
    ${csIsApp() ? `<div class="cs-gt">Приложение</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Автозапуск при старте</b><span>Приложение откроется само после входа в систему</span></div>${csTg(!!CS.autostart, 'csAutostart', 'Автозапуск')}</div>
      <div class="cs-r"><div class="cs-l"><b>Скрыть сайдбар</b><span>Список чатов прячется и выезжает при наведении на левый край окна</span></div>${csTg(document.body.classList.contains('sidebar-hidden'), 'csHideSidebar', 'Скрыть сайдбар')}</div>
    </div>` : `<p class="cs-hint">Разрешение на уведомления меняется в настройках сайта в самом браузере.</p>`}`;
}
function csGlassTr(v) {
  v = Math.min(100, Math.max(0, +v || 0));
  S.settings.glassTransparency = v; document.documentElement.style.setProperty('--gl-k', glassK(v).toFixed(3)); saveSession();
  const r = document.getElementById('cs-tr'), o = document.getElementById('cs-trval');
  if (r) r.style.setProperty('--v', v + '%');
  if (o) o.textContent = v + '%';
}
function csGlassImage() { S.settings.glassImage = S.settings.glassImage === false; applySettings(); saveSession(); csRefresh(); }
function csSound() { S.settings.soundEnabled = S.settings.soundEnabled === false; saveSession(); csRefresh(); }
async function csAutostart() { CS.autostart = !CS.autostart; csRefresh(); await setAutostart(CS.autostart); }
function csHideSidebar() { toggleSidebar(); csRefresh(); }

// ── Внешний вид ──
// Выбор в сегментированном переключателе: вызываем функцию по имени и обновляем панель
function csPick(name, v) { window[name](v); csRefresh(); }
function csPaneAppearance() {
  const s = S.settings, tr = s.glassTransparency == null ? 50 : s.glassTransparency, lvl = currentPatternLevel(), scales = csIsApp() ? [80, 90, 100] : [80, 90, 100, 110];
  const seg = (items, cur, fn, label) => `<div class="cs-seg" role="group" aria-label="${label}">${items.map(([v, t, title]) =>
    `<button type="button" aria-pressed="${cur === v}" ${title ? `aria-label="${title}" title="${title}"` : ''} data-on-click="csPick" data-a-click="${esc(JSON.stringify([fn, v]))}">${t}</button>`).join('')}</div>`;
  return `<div class="cs-pv" aria-hidden="true">
      <div class="cs-pv-side"><i></i><i class="on"></i><i></i><i></i><i></i></div>
      <div class="cs-pv-chat"><div class="cs-pv-pat"></div><span class="cs-pv-cap">Так будет выглядеть</span>
        <div class="cs-pv-msg in"><b>Мария</b>Созвон переносим на 15:30<small>14:18</small></div>
        <div class="cs-pv-msg out">Отлично, успеваю<small>14:19</small></div></div>
    </div>
    <div class="cs-gt">Тема и цвет</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Тема</b></div>${seg([['light', CS_I.sun + 'Светлая'], ['dark', CS_I.moon + 'Тёмная'], ['navy', CS_I.navy + 'Тёмно-синяя']], s.theme, 'setTheme', 'Тема')}</div>
      <div class="cs-r"><div class="cs-l"><b>Цвет акцента</b><span>Кнопки, свои сообщения, выделение</span></div>
        <div class="cs-ctl"><span class="cs-aname">${ACCENTS[currentAccent()].name}</span><div id="accent-seg" class="accent-seg" data-on-click="__h17">${accentDotsHtml()}</div></div></div>
      <div class="cs-r"><div class="cs-l"><b>Прозрачность</b><span>Стекло панелей, меню и окон: правее — прозрачнее, левее — плотнее</span></div>
        <div class="cs-ctl"><input id="cs-tr" class="rng" type="range" min="0" max="100" step="1" value="${tr}" style="--v:${tr}%" aria-label="Прозрачность стекла" data-on-input="csGlassTr" data-a-input='["__value"]'><span class="rng-val" id="cs-trval">${tr}%</span></div></div>
    </div>
    <div class="cs-gt">Фон переписки</div>
    <div data-on-click="__h18">${chatBgCardsHtml()}</div>
    <div class="cs-gt">Фон</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Цветная картинка</b><span>Размытые цветные пятна за стеклом. Выключите — фон станет ровным. С узором не связана.</span></div>${csTg(s.glassImage !== false, 'csGlassImage', 'Цветная картинка')}</div>
      <div class="cs-r stack"><div class="cs-l"><b>Узор</b><span>Рисунок поверх фона переписки</span></div>
      <div data-on-click="__h19">${chatPatternCardsHtml()}</div>
      ${currentPattern() ? `<div class="cs-ctl cs-between"><div class="cs-l"><b>Заметность узора</b></div>${seg([[1, 'Слабая'], [2, 'Средняя'], [3, 'Сильная']], lvl, 'setPatternLevel', 'Заметность узора')}</div>` : ''}
    </div></div>
    <div class="cs-gt">Текст</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Размер текста</b><span>Сообщения и список чатов</span></div>
        ${seg([['small', '<span class="cs-aa" style="font-size:11px">Aa</span>', 'Мелкий'], ['medium', '<span class="cs-aa" style="font-size:13px">Aa</span>', 'Обычный'], ['large', '<span class="cs-aa" style="font-size:16px">Aa</span>', 'Крупный']], s.fontSize, 'setFontSize', 'Размер текста')}</div>
      <div class="cs-r"><div class="cs-l"><b>Масштаб интерфейса</b><span>Всё окно целиком</span></div>
        ${seg(scales.map(v => [v, v + '%']), s.uiScale || 100, 'setUiScale', 'Масштаб интерфейса')}</div>
    </div>`;
}

// ── Обновление (только приложение) ──
function csPaneUpdate() {
  const has = !!_updateDownloadUrl;
  const date = _updatePublishedAt ? new Date(_updatePublishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  const ver = `<div class="cs-ver"><span class="cs-logo">${CS_I.bolt}</span>
      ${has ? `<div class="cs-ver-t"><span>Доступна новая версия${date ? ' · ' + date : ''}</span><b>${esc(_updateVersion || '—')}</b><span>Сейчас стоит ${esc(CS.version || '—')}</span></div>
        <button type="button" class="cs-btn solid" data-on-click="__h20">${CS_I.down}Установить</button>`
      : `<div class="cs-ver-t"><span>Установлена версия</span><b>${esc(CS.version || '—')}</b><span>Приложение для компьютера</span></div>
        <span class="cs-state" id="update-status-text"></span><button type="button" class="cs-btn ghost" id="update-check-btn" data-on-click="checkUpdate">Проверить</button>`}</div>`;
  return `${has ? `<div class="cs-g">${ver}${_updateNotes ? `<div class="cs-notes"><b>Что нового.</b> ${esc(_updateNotes)}</div>` : ''}</div>
      <p class="cs-hint">Загрузка и установка идут в отдельном окне с прогрессом.</p>`
      : `${ver}<p class="cs-hint">Приложение само проверяет обновления после запуска и дальше каждые два часа.</p>`}`;
}
// ── МОДУЛИ ──
// Состояние, версии и загрузка файлов — в modules.js (общий менеджер для всех клиентов); сами модули подключаются
// к нему обработчиками (Modules.register). Здесь оболочка: настройка «Модули» и окно загрузки в Electron. Модуль есть у пользователя, только пока его включил администратор; «включено у меня»
// хранится на устройстве. Электрон качает файлы заранее и сам обновляет их при выходе новой версии.
CS_I.puzzle = csSvg('<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>');
let _amVer = null;   // версия приложения (Electron) для журнала модуля
function modulesInit() {
  if (!window.Modules || modulesInit.done) return;
  modulesInit.done = true;
  if (csIsApp()) window.electron?.getVersion?.().then(v => { _amVer = v || null; }).catch(() => {});
  Modules.init({
    client: csIsApp() ? 'electron' : 'web',
    version: () => _amVer || CS.version || (csIsApp() ? 'electron' : 'web'),
    base: () => `${httpProto()}://${S.server}`,
    token: () => S.token,
  });
  Modules.subscribe(() => { if (_sidebarTab === 'settings' && CS.sec === 'modules') csRefresh(); });
}
function csModuleToggle(key) {
  const m = Modules.get(key); if (!m) return;
  if (m.on) { Modules.setOn(key, false); return; }
  if (csIsApp() && m.needsDownload) modDownload(key, 'download'); else Modules.setOn(key, true);
}
function csModuleRedo(key) {
  const m = Modules.get(key); if (!m || m.busy) return;
  if (csIsApp() && m.needsDownload) modDownload(key, 'redownload');
  else Modules.reinstall(key).then(() => showActionToast('Кэш модуля очищен, файлы загрузятся заново'));
}
function csModStatus(m) {
  if (m.busy && m.task) return `${m.task.kind === 'download' ? 'Загружаем' : 'Обновляем'} набор: ${m.task.done} из ${m.task.total}`;
  if (m.error) return `<span class="cs-err">Не удалось обновить набор (${esc(m.error)}). Попробуем ещё раз при следующем подключении.</span>`;
  if (csIsApp() && m.needsDownload && m.on) return m.outdated ? 'Доступна новая версия набора, обновляется…' : `Набор версии ${m.version} загружен`;
  return '';
}
function csPaneModules() {
  const list = window.Modules ? Modules.list() : [];
  if (!list.length) {
    return `<div class="cs-stub"><div class="cs-stub-i">${CS_I.puzzle}</div><b>Нет доступных модулей</b>
      <span>Администратор пока не включил дополнительные возможности. Когда они появятся, их можно будет включить здесь.</span></div>`;
  }
  return `<div class="cs-gt">Доступные модули</div><div class="cs-g">${list.map(m => {
    const mb = m.bytes ? Math.round(m.bytes / 1048576) : 0, st = csModStatus(m);
    return `<div class="cs-r"><div class="cs-l"><b>${esc(m.title)}${m.provider ? ` <span class="cs-pill">${esc(m.provider)}</span>` : ''}</b>
      <span>${esc(m.description)}${csIsApp() && m.needsDownload && !m.on && mb ? ` При включении загружается около ${mb} МБ.` : ''}</span>
      ${st ? `<span class="cs-mod-st">${st}</span>` : ''}</div>
      <div class="cs-ctl">${m.on && m.needsDownload ? `<button type="button" class="cs-btn ghost" ${m.busy ? 'disabled' : ''} data-on-click="csModuleRedo" data-a-click="${esc(JSON.stringify([`${m.key}`]))}">Перекачать</button>` : ''}${csTg(m.on, 'csModuleToggle', esc(m.title), m.key)}</div></div>`;
  }).join('')}</div>
    ${list.filter(m => m.note && (m.provider || (!csIsApp() && m.on))).map(m => `<p class="cs-hint">${esc(m.note)}</p>`).join('')}`;
}
// Окно загрузки набора (только Electron): прогресс, пояснение, после загрузки кнопка ОК.
// kind: 'download' — первое включение, 'redownload' — «Перекачать»
function modDownload(key, kind) {
  const m = Modules.get(key); if (!m) return;
  const total = m.count || 0, mbTotal = m.bytes ? (m.bytes / 1048576).toFixed(1).replace('.', ',') : '—';
  const ov = document.createElement('div'); ov.className = 'am-dlg-bg';
  const note = m.note ? `<p>${esc(m.note)}</p>` : '';
  const paint = (html) => { ov.innerHTML = `<div class="am-dlg" role="dialog" aria-label="${esc(m.title)}"><div class="am-dlg-ic">${esc(m.icon || '🧩')}</div><h4>${esc(m.title)}</h4>${html}</div>`; };
  const close = () => ov.remove();
  const run = async () => {
    paint(`<div class="am-dlg-st">Загружаем: 0 из ${total}</div><div class="am-prog"><i style="width:0%"></i></div><div class="am-pmeta"><span>0 из ${mbTotal} МБ</span><span>0%</span></div>${note}<div class="am-btns"><button class="am-btn" id="am-cancel">Отмена</button><button class="am-btn pri" disabled>ОК</button></div>`);
    ov.querySelector('#am-cancel').onclick = () => { Modules.cancel(key); };
    const r = await Modules.download(key, { kind, onProgress: p => {
      const pct = total ? Math.round(p.done / total * 100) : 0;
      const st = ov.querySelector('.am-dlg-st'); if (!st) return;
      st.textContent = `Загружаем: ${p.done} из ${p.total}`;
      ov.querySelector('.am-prog i').style.width = pct + '%';
      const meta = ov.querySelectorAll('.am-pmeta span'); meta[0].textContent = `${(p.bytes / 1048576).toFixed(1).replace('.', ',')} из ${mbTotal} МБ`; meta[1].textContent = pct + '%';
    } }).catch(e => ({ ok: false, failed: total, total, err: e.message }));
    if (r.cancelled) { close(); return; }
    if (r.ok) {
      paint(`<div class="am-ok">${CS_I.check || '✓'} Готово. Файлы загружены и работают без сети</div><div class="am-prog"><i style="width:100%"></i></div>${note}<div class="am-btns"><button class="am-btn pri" id="am-ok">ОК</button></div>`);
      ov.querySelector('#am-ok').onclick = () => { if (kind === 'download') Modules.setOn(key, true); close(); };
    } else {
      paint(`<div class="am-err">Не удалось загрузить файлы: нет соединения с сервером. Уже загруженное сохранено, остальное подгрузится по мере показа.</div><div class="am-btns"><button class="am-btn" id="am-close">Закрыть</button><button class="am-btn pri" id="am-retry">Повторить</button></div>`);
      ov.querySelector('#am-close').onclick = () => { if (kind === 'download') Modules.setOn(key, true); close(); };
      ov.querySelector('#am-retry').onclick = run;
    }
  };
  document.body.appendChild(ov);
  run();
}
const CS_PANES = { profile: csPaneProfile, general: csPaneGeneral, appearance: csPaneAppearance, blocks: csPaneBlocks, modules: csPaneModules, folders: () => csPaneFolders(), update: csPaneUpdate };

function csNavHtml() {
  return csSections().map(s => `<button type="button" class="cs-sn" aria-current="${CS.sec === s.k ? 'page' : 'false'}" data-on-click="csGo" data-a-click="${esc(JSON.stringify([`${s.k}`]))}">
    <span class="cs-sn-ic">${s.icon}</span><span class="cs-sn-tx"><b>${s.label}</b><small>${esc(s.meta())}</small></span>${s.dot?.() ? '<i class="cs-dot"></i>' : ''}</button>`).join('');
}
// Настройки рисуются на месте вкладки «Настройки» в сайдбаре: слева карточка
// профиля и разделы (csRenderInline пишет это в #chats-list), справа — строки
// настроек выбранного раздела (в #chat-main). Логика разделов не изменилась,
// поменялось только куда пишется разметка (раньше — модалка #cs-form).
function csRenderInline(focusId) {
  if (_sidebarTab !== 'settings') return;
  const nav = document.getElementById('chats-list');
  const main = document.getElementById('chat-main');
  if (!nav || !main || !S.user) return;
  const a = document.activeElement, keep = focusId || (a?.id?.startsWith('cs-') && (nav.contains(a) || main.contains(a)) ? a.id : null);
  let caret = null;
  try { caret = a?.selectionStart; } catch {}
  const scroll = document.getElementById('cs-body')?.scrollTop || 0;
  const secs = csSections();
  if (!secs.some(s => s.k === CS.sec)) CS.sec = 'profile';
  const s = secs.find(x => x.k === CS.sec);
  nav.className = 'cs-nav';
  nav.innerHTML = `<div class="cs-nav-list">${csNavHtml()}</div><div class="cs-copy">w/ <span class="cp-h">❤️</span> by bolgov0zero</div>`;
  setChatMainContent(`<section class="cs-pane">
      <header class="cs-head"><div><h3>${s.label}</h3><p>${s.desc}</p></div></header>
      <div class="cs-body" id="cs-body">${CS_PANES[s.k]()}</div>
    </section>`);
  if (CS.avatar === undefined) { CS.avatar = null; updateSettingsAvatar(); }
  csPaintAvatars();
  if (document.getElementById('pattern-cards')) paintPatternSwatches();
  // Пароли кладём в поля свойством, а не атрибутом разметки
  [['cs-pw0', 'old'], ['cs-pw1', 'a'], ['cs-pw2', 'b']].forEach(([id, k]) => { const i = document.getElementById(id); if (i) i.value = CS.pw[k]; });
  const body = document.getElementById('cs-body');
  if (body && !focusId) body.scrollTop = scroll;
  const f = keep && document.getElementById(keep);
  if (f) { f.focus(); if (!focusId && caret != null) { try { f.setSelectionRange(caret, caret); } catch {} } }
}
function csRefresh(focusId) { csRenderInline(focusId); }
function csGo(k) {
  if (k) CS.sec = k;
  csRenderInline();
  const b = document.getElementById('cs-body');
  if (b) b.scrollTop = 0;
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

// ── Настройки уведомлений: показ текста и тихие часы (общие с мобильной версией, хранятся на сервере) ──
let _pushPrefs = { show_text: true, quiet_from: null, quiet_to: null };
async function loadPushPrefs() {
  const r = await api('GET', '/push/prefs');
  if (r && !r.error) { _pushPrefs = r; if (typeof csRefresh === 'function' && _sidebarTab === 'settings') csRefresh(); }
}
const _hhmm = v => v == null ? '' : String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
function _quietNow() {
  const p = _pushPrefs;
  if (p.quiet_from == null || p.quiet_to == null || p.quiet_from === p.quiet_to) return false;
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  return p.quiet_from < p.quiet_to ? (m >= p.quiet_from && m < p.quiet_to) : (m >= p.quiet_from || m < p.quiet_to);
}
async function savePushPrefs(part) {
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const r = await api('PUT', '/push/prefs', { tz, ...part });
  if (r && !r.error) _pushPrefs = r; else showActionToast(r?.error || 'Не удалось сохранить');
  csRefresh();
}
function csPushText() { savePushPrefs({ show_text: !_pushPrefs.show_text }); }
function csQuiet() { savePushPrefs(_pushPrefs.quiet_from != null ? { quiet_from: null, quiet_to: null } : { quiet_from: 22 * 60, quiet_to: 8 * 60 }); }
function csQuietTime(which, val) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(val || ''); if (!m) return;
  savePushPrefs({ [which]: (+m[1]) * 60 + (+m[2]) });
}
// Уведомление о сообщении с учётом настроек: в тихие часы его нет, без показа текста — только «Новое сообщение»
function msgNotify(title, body, chatId) {
  if (_quietNow()) return;
  webNotify(title, _pushPrefs.show_text ? body : 'Новое сообщение', chatId);
}

function playNotificationSound() {
  if (S.settings.soundEnabled === false || _quietNow()) return;
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
// ── ПУСТЫЕ ЛИЧНЫЕ ЧАТЫ ──
// Выбрали человека, передумали писать — чат исчезает и у вас, и с сервера.
// Собеседник его и так не видел (он добавлен скрытым до первого сообщения),
// поэтому скрытие у себя оставляет чат скрытым у всех, а тогда сервер удаляет
// строку целиком. Начатый черновик считается началом разговора: с ним чат
// остаётся, и в списке он помечен как «Черновик».
async function dropEmptyDirect(chatId) {
  if (!chatId) return;
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat || chat.type !== 'direct') return;
  if (chat.last_message) return;
  if ((S.drafts[chatId] || '').trim()) return;
  let delRes; try { delRes = await api('DELETE', '/chats/' + chatId); } catch { return; }
  if (!delRes || delRes.error) return;   // api не бросает при сбое сети: без ответа чат остаётся в списке
  // Сервер пришлёт chat_deleted, но список чистим сразу: иначе пустая строка
  // мелькает до прихода события
  S.chats = S.chats.filter(c => c.id !== chatId);
  delete S.unread[chatId];
  delete S.unreadMentions[chatId];
  renderChatList();
}

// Приложение закрыли, не выходя из пустого чата, — момента «ухожу» не было.
// Убираем при следующем запуске по тому же правилу. Именно при запуске, один
// раз: loadChats вызывается и после создания чата, и на событие reload_chats,
// и уборка на каждый вызов сносила бы только что заведённый чат прямо из-под рук.
let _emptySwept = false;
function dropEmptyDirects() {
  if (_emptySwept) return;
  _emptySwept = true;
  S.chats
    // Открытый сейчас чат не трогаем: он пуст ровно потому, что в нём и сидят
    .filter(c => c.id !== S.activeChatId && c.type === 'direct'
      && !c.last_message && !(S.drafts[c.id] || '').trim())
    .forEach(c => dropEmptyDirect(c.id));
}

// ── Запуск без связи ──
// Последний список чатов и хвост каждой открытой переписки хранятся на устройстве: без связи приложение
// открывается с ними, а не с пустым экраном; когда связь вернётся, всё перечитывается с сервера.
const _cacheKey = k => `cache_${k}_${S.server}_${S.user?.id}`;
function cacheChats(list) {
  try { localStorage.setItem(_cacheKey('chats'), JSON.stringify({ t: Date.now(), list: list.filter(c => !c.is_secret && !c.parent_id) })); } catch {}
}
function chatsFromCache() {
  if (S.chats.length) return false;
  try {
    const o = JSON.parse(localStorage.getItem(_cacheKey('chats')) || 'null');
    if (!o || !Array.isArray(o.list) || !o.list.length) return false;
    S.chats = o.list;
    S.mutedChats = new Set(o.list.filter(c => c.muted).map(c => c.id));
    o.list.forEach(c => { S.unread[c.id] = c.unread || 0; S.unreadMentions[c.id] = c.unread_mentions || 0; });
    updateUnreadTotal();
    renderChatList();
    return true;
  } catch { return false; }
}
function tailSave(chatId, messages) {
  if (!S.user || S.secretChatIds.has(chatId) || !messages?.length) return;
  try {
    const key = _cacheKey('tails');
    const all = tailAll();
    all[chatId] = { t: Date.now(), m: messages.slice(-40) };
    Object.keys(all).sort((a, b) => all[b].t - all[a].t).slice(12).forEach(k => delete all[k]);   // помним последние 12 чатов
    _tailMem = all;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {}
}
let _tailMem = null, _tailT = null;
function tailAll() { if (!_tailMem) { try { _tailMem = JSON.parse(localStorage.getItem(_cacheKey('tails')) || '{}'); } catch { _tailMem = {}; } } return _tailMem; }
function tailPersist() {
  clearTimeout(_tailT);
  _tailT = setTimeout(() => { try { localStorage.setItem(_cacheKey('tails'), JSON.stringify(tailAll())); } catch {} }, 1500);
}
// Новое сообщение открытого чата попадает в сохранённый хвост: при следующем входе чат откроется сразу и с ним
function tailPush(chatId, m) {
  if (!S.user || S.secretChatIds.has(chatId) || S.chatHasMoreAfter) return;
  const all = tailAll(), t = all[chatId];
  if (!t || !t.m?.length || t.m.some(x => x.id === m.id)) return;
  t.m = t.m.concat(m).slice(-40); t.t = Date.now();
  tailPersist();
}
// Правка или удаление сообщения обновляют его же в хвосте
function tailPatch(m) {
  const t = tailAll()[m.chat_id];
  const i = t ? t.m.findIndex(x => x.id === m.id) : -1;
  if (i >= 0) { t.m[i] = { ...t.m[i], ...m }; tailPersist(); }
}
function tailLoad(chatId) {
  try {
    const t = tailAll()[chatId];
    return t?.m?.length ? { messages: t.m, hasMore: false, hasMoreAfter: false, pins: [], first_unread_id: null } : null;
  } catch { return null; }
}

let _loadChatsReq = 0;
async function loadChats() {
  await scBoot();
  await loadAvatarIndex();
  const loadReq = ++_loadChatsReq;
  const all = await api('GET','/chats');
  if (loadReq !== _loadChatsReq) return;   // пока шёл запрос, начался более новый: старый ответ не применяем
  if (!Array.isArray(all)) { chatsFromCache(); return; }
  S.secretChatIds = new Set(all.filter(c => c.is_secret).map(c => c.id));
  const chats = all.filter(c => !(c.is_secret && SC.isHidden(c.id)));
  S.chats = chats;
  cacheChats(chats);
  S.mutedChats = new Set(chats.filter(c => c.muted).map(c => c.id));
  S.mutedUntil = Object.fromEntries(chats.filter(c => c.muted).map(c => [c.id, c.muted_until || 0]));
  watchMutes();
  // В чат попал человек, которого ещё нет в списке людей (добавили в группу): подтянуть список
  if (chats.some(c => (c.members || []).some(m => m.id !== S.user.id && !S.allUsers.some(u => u.id === m.id)))) loadUsers();
  chats.forEach(c => {
    S.unread[c.id] = c.unread || 0;
    S.unreadMentions[c.id] = c.unread_mentions || 0;
  });
  // Открытый чат: сервер считает непрочитанное по отметке «прочитано», уточняем её по тому, что сейчас видно
  if (S.activeChatId) { _readSent[S.activeChatId] = 0; scheduleRead(); }
  await Promise.all(chats.filter(c=>c.has_topics).map(c=>loadTopics(c.id)));
  updateUnreadTotal();
  renderChatList();
  dropEmptyDirects();
  refreshActiveChatUi();
  if (gmIsOpen()) { if (gmChat()) renderGroupProfile(true); else closeModal('modal-group'); }   // профиль группы открыт: обновляем состав
}

// ── SUB-ROOMS ──
async function loadTopics(roomId, { render = false } = {}) {
  const subs = await api('GET', `/chats/${roomId}/topics`);
  if (!subs) return;
  S.topics[roomId] = subs;
  S.unread[roomId] = 0;
  S.unreadMentions[roomId] = 0;
  subs.forEach(s => {
    S.unread[s.id] = s.unread || 0;
    S.unreadMentions[s.id] = s.unread_mentions || 0;
  });
  if (render) renderTopicsPanel(roomId);
}

// ── СПИСОК ТЕМ ──
// Строка повторяет строку чата: иконка своего цвета, название, время, превью
// последнего сообщения и счётчики. Всё это сервер отдаёт вместе со списком —
// раньше показывалось только название и общий счётчик, и понять, где что
// происходит, можно было только зайдя внутрь.
function topicRow(s) {
  const unread = S.unread[s.id] || 0;
  const mentions = S.unreadMentions[s.id] || 0;
  const lm = s.last_message;
  let preview = lm
    ? (lm.deleted ? 'Сообщение удалено'
      : ((lm.text ? lm.text.replace(/<[^>]*>/g, '') : '')
        || (lm.attachment
          ? (lm.attachment.gif ? '🖼 GIF' : lm.attachment.more?.length ? '🖼 Вложений: ' + (lm.attachment.more.length + 1) : lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл'))
          : '')))
    : 'Нет сообщений';
  if (preview.length > 38) preview = preview.slice(0, 38) + '…';
  // Кто написал — как в списке чатов: своё помечаем «Вы»
  const mine = lm && !lm.deleted && lm.sender_id === S.user?.id;
  const who = mine ? 'Вы' : (lm && !lm.deleted ? (lm.sender_name || '').split(' ')[0] : '');
  const previewHtml = who
    ? '<span style="color:var(--text2)">' + esc(who) + ':</span> ' + esc(preview)
    : esc(preview);
  const time = lm ? fmtChatListTime(lm.sent_at) : '';
  // Цвет по названию — тот же расчёт, что у тегов и аватарок пользователей.
  // Раньше у всех тем был один оранжевый домик, и список не читался.
  const avCls = 'av-' + senderNameClass(s.name);
  const avStyle = s.has_avatar
    ? ' style="background-image:url(\'' + '/api/chats/' + s.id + '/avatar' + '\');background-size:cover;background-position:center"'
    : '';
  return '<div class="chat-item' + (S.activeTopicId === s.id ? ' active' : '') + '"' +
    ' data-topic-id="' + s.id + '" data-on-click="openTopic" data-a-click="' + esc(JSON.stringify([s.id])) + '">' +
    '<div class="av-wrap"><div class="av av-md av-round ' + avCls + '"' + avStyle + '>' +
      (s.has_avatar ? '' : '#') + '</div></div>' +
    '<div class="info">' +
      '<div class="ci-name" style="display:flex;align-items:center;gap:5px">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</span>' +
        '<span class="ci-time">' + time + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">' +
        '<span class="ci-preview" style="flex:1">' + previewHtml + '</span>' +
        (mentions > 0 ? '<div class="unread-badge" title="Вас упомянули">@</div>' : '') +
        (unread > 0 ? '<div class="unread-badge">' + (unread > 99 ? '99+' : unread) + '</div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

// Выход из комнаты: список тем уезжает вправо, возвращается строка поиска
function leaveRoom() {
  closeTopicsPanel();
  S.activeRoomId = null;
  S.activeTopicId = null;
  S.activeChatId = null;
  renderChatList();
  // Через setChatMainContent: полоса ввода лежит внутри chat-main, и прямая
  // запись innerHTML снесла бы её вместе с содержимым
  setChatMainContent('<div class="empty-state">' +
    '<div class="empty-icon">💬</div><div class="empty-title">Electron</div>' +
    '<div class="empty-sub">Выберите чат или создайте новый</div></div>');
}

// Порядок тем в списке: ручной (задаёт администратор, так приходит с сервера) или по последнему сообщению.
// Режим лежит в объекте комнаты (topics_manual); без сообщений тема остаётся внизу в порядке администратора
function orderedTopics(roomId) {
  const subs = S.topics[roomId] || [];
  const room = S.chats.find(c => c.id === roomId);
  if (!room || room.topics_manual) return subs;
  return subs.map((t, i) => [t, i]).sort((a, b) => ((b[0].last_message?.sent_at || 0) - (a[0].last_message?.sent_at || 0)) || a[1] - b[1]).map(x => x[0]);
}

function renderTopicsPanel(roomId) {
  const panel = document.getElementById('topics-panel');
  const subs = orderedTopics(roomId);
  if (!subs.length) { closeTopicsPanel(); return; }
  // Тот же класс и те же отступы, что у подписи «Комнаты» в списке чатов —
  // поэтому верх первой темы совпадает с верхом первой комнаты и въезд
  // списка тем выглядит бесшовным
  panel.innerHTML = '<div class="chat-list-section-label">Темы</div>' + subs.map(topicRow).join('');
  panel.classList.add('open');
  const room = S.chats.find(c => c.id === roomId);
  const n = subs.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'тема' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'темы' : 'тем';
  document.getElementById('room-title').innerHTML =
    `<span class="room-title-name">${esc(room?.name || 'Комната')}</span><span class="room-title-sub">${n} ${word}</span>`;
  document.getElementById('sidebar-search').classList.add('room-mode');
}

function closeTopicsPanel() {
  document.getElementById('topics-panel').classList.remove('open');
  document.getElementById('sidebar-search').classList.remove('room-mode');
}

async function openTopic(topicId) {
  S.activeTopicId = topicId;
  await openChat(topicId);
}

function chatName(chat) {
  // Чат может быть ещё не в списке: первое сообщение в новой переписке приходит
  // раньше, чем догрузится список, — тогда имени нет и его подставит вызывающий
  if (!chat) return '';
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

// Значок комнаты: дом из набора значков папок (Lucide). Без размера масштабируется шрифтом аватарки, с размером — фиксированный, для строки подписи
const roomIcon = size => `<svg class="room-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${size ? ` width="${size}" height="${size}"` : ''}>${FOLDER_ICONS.home}</svg>`;
function chatIcon(chat) {
  if (chat.type==='room') return roomIcon();
  return initials(chatName(chat));
}

async function loadAvatarIndex() {
  const r = await api('GET', '/users/avatars/index');
  S.avIdx = r && Array.isArray(r.u) && Array.isArray(r.c) ? new Set([...r.u.map(i => 'u' + i), ...r.c.map(i => 'c' + i)]) : null;
}
// Аватарки нет в списке сервера: файл не запрашиваем (иначе 404 в консоли на каждого без фото). Список ещё не загружен — запрашиваем как раньше
function avatarMissing(url) {
  if (!S.avIdx) return false;
  const m = /\/api\/(users|chats)\/(\d+)\/avatar/.exec(url);
  return !!m && !S.avIdx.has((m[1] === 'users' ? 'u' : 'c') + m[2]);
}

// Запасной вид аватарки: буквы текстом, значок комнаты (svg) разметкой
function setAvFallback(el, f) { if (typeof f === 'string' && f.startsWith('<svg')) el.innerHTML = f; else el.textContent = f; }
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
    setAvFallback(el, fallbackText);
    return;
  }
  if (avatarMissing(url)) { el.style.backgroundImage = ''; setAvFallback(el, fallbackText); return; }
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
    setAvFallback(el, fallbackText);
  };
  img.src = url;
}

function applyAvatars() {
  document.querySelectorAll('[data-av-chat]').forEach(el => {
    const chatId = parseInt(el.dataset.avChat);
    const chat = S.chats.find(c => c.id === chatId)
      || Object.values(S.topics).flat().find(s => s.id === chatId);
    if (!chat) return;
    if (chat.type === 'direct') {
      const peerId = getPeerUserId(chat);
      if (!peerId) return;
      const url = `${httpProto()}://${S.server}/api/users/${peerId}/avatar?t=${S.avatarTs||1}`;
      tryLoadAvatar(el, url, initials(chatName(chat)));
    } else {
      const url = `${httpProto()}://${S.server}/api/chats/${chatId}/avatar?t=${S.avatarTs||1}`;
      tryLoadAvatar(el, url, chatIcon(chat));
    }
  });
  document.querySelectorAll('[data-av-user]').forEach(el => {
    const uid = parseInt(el.dataset.avUser);
    const user = S.allUsers.find(u => u.id === uid) || (uid === S.user.id ? S.user : null);
    if (!user) return;
    const url = `${httpProto()}://${S.server}/api/users/${uid}/avatar?t=${S.avatarTs||1}`;
    tryLoadAvatar(el, url, initials(user.display_name));
  });
}

const _chatRowCache = new Map(); // key -> html последней отрисовки
const _ROW_EASE = 'cubic-bezier(.4,0,.2,1)';
// Строка списка плавно раскрывается (новая) или сворачивается (ушедшая): соседние сдвигаются вместе с ней
function rowAnim(el, show, done) {
  const cs = getComputedStyle(el);
  const full = { height: cs.height, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom, opacity: 1, overflow: 'hidden' };
  const zero = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px', opacity: 0, overflow: 'hidden' };
  const a = el.animate(show ? [zero, full] : [full, zero], { duration: 280, easing: _ROW_EASE, fill: show ? 'none' : 'forwards' });
  if (done) {
    // Страховка: в свёрнутом окне кадры не рисуются и onfinish может не прийти, а ушедшая строка осталась бы
    let ok = false;
    const fin = () => { if (!ok) { ok = true; done(); } };
    a.onfinish = fin;
    setTimeout(fin, 500);
  }
}
function syncChatListKeyed(list, items) {
  // Анимируем только изменения внутри того же вида списка: при смене папки, выходе из поиска
  // и первой отрисовке строки просто заменяются
  const view = String(S.folderFilter);
  const before = new Map();
  [...list.children].forEach(ch => { if (ch.dataset.key && !ch.dataset.leaving) before.set(ch.dataset.key, ch.getBoundingClientRect().top); });
  const anim = list._flipView === view && [...before.keys()].some(k => k.startsWith('chat-')) && items.length < 150
    && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  list._flipView = view;
  const added = [];
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
      // Значок непрочитанных: появился или сменил число — оживляем, остальное не трогаем
      if (anim && window.SlideSel) {
        const ob = el.querySelectorAll('.unread-badge');
        fresh.querySelectorAll('.unread-badge').forEach((b, i) => {
          if (!ob[i]) SlideSel.pop(b); else if (ob[i].textContent !== b.textContent) SlideSel.bump(b);
        });
      }
      el.replaceWith(fresh);
      el = fresh;
    } else if (!el) {
      const tmp = document.createElement('div');
      tmp.innerHTML = it.html;
      el = tmp.firstElementChild;
      el.dataset.key = it.key;
      list.appendChild(el);
      added.push(el);
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
    if (ch.dataset.leaving) return;
    if (!ch.dataset.key || !seen.has(ch.dataset.key)) {
      if (ch.dataset.key) _chatRowCache.delete(ch.dataset.key);
      if (anim && ch.dataset.key) { ch.dataset.leaving = '1'; delete ch.dataset.key; rowAnim(ch, false, () => ch.remove()); }
      else ch.remove();
    }
  });
  if (!anim) return;
  // Новые строки раскрываются, а прежние, у которых изменилось место (новое сообщение поднимает чат),
  // плавно переезжают со старой позиции на новую
  added.forEach(el => rowAnim(el, true));
  [...list.children].forEach(ch => {
    const k = ch.dataset.key;
    if (!k || ch.dataset.leaving || added.includes(ch) || !before.has(k)) return;
    const d = before.get(k) - ch.getBoundingClientRect().top;
    if (Math.abs(d) > 1) ch.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 280, easing: _ROW_EASE });
  });
}

// ── ФИЛЬТР СПИСКА ЧАТОВ: все / новые (непрочитанные) / личные / группы ──
// Выбор помнится на устройстве. Открытый сейчас чат остаётся в списке при любом фильтре:
// иначе в «Новых» он исчез бы из-под курсора в момент прочтения.
const CHAT_FILTERS = ['all', 'unread', 'direct', 'group'];
function chatFilterGet() {
  if (!S.chatFilter) {
    let v = 'all';
    try { v = localStorage.getItem('chatFilter') || 'all'; } catch {}
    S.chatFilter = CHAT_FILTERS.includes(v) ? v : 'all';
  }
  return S.chatFilter;
}
function chatUnreadTotal(c) {
  const ids = c.has_topics ? (S.topics[c.id] || []).map(s => s.id) : [c.id];
  return ids.reduce((sum, id) => sum + (S.unread[id] || 0) + (S.unreadMentions[id] || 0), 0);
}
function chatFilterPass(c) {
  const f = chatFilterGet();
  if (f === 'all' || c.id === S.activeChatId || c.id === S.activeRoomId) return true;
  if (f === 'unread') return chatUnreadTotal(c) > 0;
  if (f === 'direct') return c.type === 'direct';
  return c.type === 'group';
}
function setChatFilter(f) {
  if (!CHAT_FILTERS.includes(f) || f === chatFilterGet()) return;
  S.chatFilter = f;
  try { localStorage.setItem('chatFilter', f); } catch {}
  syncChatFilterUi();
  renderChatList();
}
function syncChatFilterUi() {
  const f = chatFilterGet();
  document.querySelectorAll('#chat-filter button').forEach(b => {
    const on = b.dataset.f === f;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
}

function renderChatList() {
  // Список чатов — общий контейнер с контактами и настройками (#chats-list).
  // Фоновые обновления (переподключение WS, ресинк после возврата фокуса и т.п.)
  // вызывают эту функцию когда угодно — если открыта другая вкладка, писать
  // сюда нельзя: затрёт контакты/настройки, а подсветка таб-бара не совпадёт.
  // S.chats к этому моменту уже обновлён — при возврате на «Чаты» отрисуется сам.
  if (_sidebarTab !== 'chats') return;
  if (!document.querySelector('#chat-filter button.active[data-f="' + chatFilterGet() + '"]')) syncChatFilterUi();
  const q = document.getElementById('search').value.toLowerCase();
  const list = document.getElementById('chats-list');
  const byFolder = !q && !S.searchResults;   // поиск идёт по всем чатам, а не только по выбранной папке
  const filtered = S.chats
    .filter(c=>chatName(c).toLowerCase().includes(q))
    .filter(c => !byFolder || typeof folderPass !== 'function' || folderPass(c))
    .filter(c => !byFolder || typeof spacePass !== 'function' || spacePass(c))
    .filter(c => !byFolder || chatFilterPass(c))
    .sort((a,b) => {
      // Приглашения в группы с других серверов — сверху: ответа ждут
      if (!!a.invite !== !!b.invite) return a.invite ? -1 : 1;
      if (a.type==='room' && b.type!=='room') return -1;
      if (a.type!=='room' && b.type==='room') return 1;
      // Комнаты — статичный порядок по имени, не двигаются от новых сообщений
      if (a.type==='room' && b.type==='room') return chatName(a).localeCompare(chatName(b), 'ru', { numeric: true });
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
    const emptyText = { unread: 'Нет новых сообщений', direct: 'Нет личных чатов', group: 'Нет групп' }[chatFilterGet()] || 'Нет чатов';
    items.push({ key: 'empty', html: `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">${emptyText}</div>` });
  } else {
    if (rooms.length) {
      items.push({ key: 'label-rooms', html: '<div class="chat-list-section-label">Комнаты</div>' });
      rooms.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
    }
    if (pinned.length) {
      items.push({ key: 'label-pinned', html: `<div class="chat-list-section-label" style="${rooms.length?'padding-top:12px':''}">Закреплённые</div>` });
      pinned.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
    }
    const allLabel = byFolder && S.folderFilter !== 'all' ? esc(folderById(S.folderFilter)?.name || 'Все чаты') : 'Все чаты';
    items.push({ key: 'label-all', html: `<div class="chat-list-section-label" style="${(rooms.length||pinned.length)?'padding-top:12px':''}">${allLabel}</div>` });
    rest.forEach(c => items.push({ key: 'chat-' + c.id, html: renderChatRow(c) }));
  }
  syncChatListKeyed(list, items);
  applyAvatars();
}

// Галочка в списке чатов относится к последнему сообщению — обновляем её,
// когда приходит статус по нему. Иначе она оставалась бы прежней до перезагрузки.
function applyStatusToChatList(chatId, msgId, kind, readerId) {
  const chat = S.chats.find(c => c.id === chatId)
    || S.chats.find(c => (S.topics[c.id] || []).some(s => s.id === chatId));
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
  const kids = [...inner.children].filter(el => !el.dataset.ghost);
  const open = kids.some(el => el.style.display !== 'none');
  const was = slot.classList.contains('open');
  if (open) {
    inner.querySelectorAll(':scope > [data-ghost]').forEach(g => g.remove());
    kids.forEach(el => { el._top = el.style.display !== 'none' ? el.offsetTop : null; });
  } else if (was) {
    // Плашка гаснет мгновенно (display:none), а слот ещё схлопывается: оставляем её копию,
    // пока он не закроется, иначе слот съезжает над пустым местом
    kids.forEach(el => {
      if (el._top == null) return;
      const g = el.cloneNode(true);
      g.removeAttribute('id');
      g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      g.dataset.ghost = '1';
      Object.assign(g.style, { display: '', position: 'absolute', top: el._top + 'px', left: '8px', right: '8px', pointerEvents: 'none' });
      inner.appendChild(g);
      el._top = null;
    });
    clearTimeout(slot._gt);
    slot._gt = setTimeout(() => inner.querySelectorAll(':scope > [data-ghost]').forEach(g => g.remove()), 320);
  }
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
  const u = c.has_topics
    ? (S.topics[c.id]||[]).reduce((sum,s)=>sum+(S.unread[s.id]||0),0)
    : S.unread[c.id]||0;
  const m = c.has_topics
    ? (S.topics[c.id]||[]).reduce((sum,s)=>sum+(S.unreadMentions[s.id]||0),0)
    : S.unreadMentions[c.id]||0;
  const lm = c.last_message;
  let preview = lm ? (lm.deleted ? 'Сообщение удалено' : (lm.text ? Fmt.plain(lm.text).replace(/<[^>]*>/g, '') : (lm.forward_data ? fwdPreview(lm.forward_data) : lm.attachment ? (lm.attachment.gif ? '🖼 GIF' : lm.attachment.more?.length ? '🖼 Вложений: ' + (lm.attachment.more.length + 1) : lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл')) : ''))) : 'Нет сообщений';
  if (preview.length>40) preview = preview.slice(0,40)+'…';
  // Черновик приоритетнее последнего сообщения (как в Telegram)
  const draft = (c.id !== S.activeChatId) ? S.drafts[c.id] : null;
  // Своё последнее сообщение помечаем «Вы:» — у удалённого пометки нет,
  // там и так стоит «Сообщение удалено»
  const minePreview = lm && !lm.deleted && lm.sender_id === S.user?.id;
  // Секретный чат: превью не показывается вовсе, чтобы не подсматривали
  let previewHtml = c.is_secret
    ? '<span class="sc-tag">Скрытый чат</span>'
    : draft
    ? `<span style="color:var(--danger)">Черновик:</span> ${esc(draft.slice(0,34))}`
    : (minePreview ? `<span style="color:var(--text2)">Вы:</span> ${esc(preview)}` : esc(preview));
  const time = lm ? fmtChatListTime(lm.sent_at) : '';
  const peerId = getPeerUserId(c);
  const dot = peerId && !isSysChat(c) ? presenceDot(peerId) : '';
  const pinIcon = c.pinned ? `<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--muted);opacity:.7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>` : '';
  const muteIcon = S.mutedChats.has(c.id) ? `<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--muted);opacity:.7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>` : '';
  // Галочки доставки/прочтения — только если последнее сообщение моё
  const myStatus = (lm && lm.sender_id === S.user?.id && !lm.deleted && lm.status)
    ? renderStatus(lm.status) : '';
  const isActive = c.id===S.activeChatId || c.id===S.activeRoomId;
  if (c.invite) previewHtml = `<span style="color:var(--accent)">Приглашение в ${fedKind(c)}</span>`;
  return `<div class="chat-item${isActive?' active':''}${c.invite?' invited':''}" data-chat-id="${c.id}" data-on-click="openChat" data-a-click="${esc(JSON.stringify([c.id]))}" data-on-contextmenu="showChatCtx" data-a-contextmenu="${esc(JSON.stringify(["__event", c.id]))}">
    <div class="av-wrap">
      <div class="av av-md ${chatAvatarClass(c)}${c.type==='room' && c.has_topics?' av-sq':' av-round'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
      ${typeof folderBadgeHtml === 'function' ? folderBadgeHtml(c) : ''}${dot}${fedDotHtml(c)}
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
  // Сообщения ботов хранят доверенный HTML (как и в самом пузыре, см. renderMsgIRC) —
  // экранировать их нельзя, иначе теги вроде <b> показываются как текст
  const snip = (r.sender_is_bot ? (r.snippet || '') : esc(r.snippet || '')).replaceAll('\u0001', '<b>').replaceAll('\u0002', '</b>');
  return `<div class="chat-item" data-on-click="openSearchResult" data-a-click="${esc(JSON.stringify([r.chat_id, r.id]))}">
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
let _topRO = null;
function watchComposerHeight() {
  const bar = document.getElementById('chat-input-bar') || document.getElementById('input-wrap');
  const main = document.getElementById('chat-main');
  if (!bar || !main) return;
  // Если стояли у дна, при смене высоты полосы (строка «печатает», ответ, многострочный текст) остаёмся у дна
  const apply = () => {
    const stick = atMessagesBottom();
    main.style.setProperty('--composer-h', bar.offsetHeight + 'px');
    if (stick) pinMessagesBottom();
  };
  apply();
  if (_composerRO) _composerRO.disconnect();
  try {
    _composerRO = new ResizeObserver(apply);
    _composerRO.observe(bar);
  } catch { _composerRO = null; }
}
let _topMO = null;
function watchTopHeight() {
  const main = document.getElementById('chat-main');
  const header = main?.querySelector('.chat-header');
  const pin = document.getElementById('pin-bar');
  const search = main?.querySelector('.chat-search');
  if (!main || !header) return;
  // Верхний отступ ленты (+8 в формуле CSS): первое сообщение на 110 px от верха окна, а когда под шапкой закреп или поиск — на 162
  // (в макете 98 и 150 от верха области чата, которая начинается на 12 px ниже). Шапка: 12 px от верха, высота 72, полосы 48
  const apply = () => {
    const strip = (pin && pin.style.display !== 'none') || search?.classList.contains('open');
    main.style.setProperty('--chat-top-h', (strip ? 154 : 102) + 'px');
  };
  window._topApply = apply;
  apply();
  if (_topRO) _topRO.disconnect();
  if (_topMO) _topMO.disconnect();
  try {
    _topRO = new ResizeObserver(apply);
    _topRO.observe(header);
    if (pin) _topRO.observe(pin);
    _topMO = new MutationObserver(apply);
    if (search) _topMO.observe(search, { attributes: true, attributeFilter: ['class'] });
    if (pin) _topMO.observe(pin, { attributes: true, attributeFilter: ['style'] });
  } catch { _topRO = null; }
}
const NB_ICON_CHAT = '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const NB_ICON_CONTACT = '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>';
// ── OPEN CHAT ──
// forceBottom — открыть заведомо у последнего сообщения, минуя якорь на первом
// непрочитанном: так возвращаются из глубины истории и после отправки сообщения
async function openChat(chatId, aroundId = null, forceBottom = false) {
  // Уходим из пустого личного чата — он больше не нужен ни здесь, ни на сервере
  if (S.activeChatId && S.activeChatId !== chatId) dropEmptyDirect(S.activeChatId);
  // Поиск относится к одному чату: в другом он не открывается
  if (S.chatSearch && S.chatSearch.chatId !== chatId) S.chatSearch = null;
  S.msgData.clear();
  let chat = S.chats.find(c=>c.id===chatId);
  if (!chat) {
    for (const [pid, subs] of Object.entries(S.topics)) {
      const sub = subs.find(s=>s.id===chatId);
      if (sub) { chat = { id: chatId, type: 'room', name: sub.name, parent_id: Number(pid), members: [] }; break; }
    }
  }
  if (chat?.has_topics) {
    S.activeChatId = null;
    S.activeRoomId = chatId;
    S.activeTopicId = null;
    renderChatList();
    await loadTopics(chatId, { render: true });
    // Переписка остаётся от прошлого чата, если её не очистить
    setChatMainContent('<div class="empty-state">' +
      '<div class="empty-icon ei-hash">📋</div><div class="empty-title">Выберите тему</div>' +
      '<div class="empty-sub">Слева список тем этой комнаты</div></div>');
    return;
  }
  if (!chat?.parent_id && !Object.values(S.topics).some(arr=>arr.some(s=>s.id===chatId))) {
    closeTopicsPanel();
    S.activeRoomId = null;
    S.activeTopicId = null;
  }
  if (S.editingMessageId) cancelEdit();
  if (S.activeChatId && S.activeChatId !== chatId) savePos(S.activeChatId);
  const _hadUnread = (S.unread[chatId] || 0) > 0;
  S.activeChatId = chatId;
  _loadingChatId = chatId;
  S.chatHasMore = false;
  S.chatOldestId = null;
  S.chatHasMoreAfter = false;
  S.chatNewestId = null;
  S.statusApplied = {};
  _loadingMore = false;
  releaseAnchor(); // удержание от прошлого чата не должно мешать новому
  releaseStick();
  // Счётчик не обнуляем: «прочитано» уходит по мере показа, остаток приходит от сервера
  _readSent[chatId] = 0;
  updateUnreadTotal();
  renderChatList();
  if (chat?.parent_id) renderTopicsPanel(chat.parent_id);
  const name = chatName(chat);
  const isGroup = chat.type==='group';
  const isRoom = chat.type==='room';
  const isTopic = !!chat?.parent_id;
  const isCreator = chat.created_by === S.user.id;
  const memberCount = chat.members?.length||0;
  const peerId = getPeerUserId(chat);
  const addContactBtn = peerId && !isSysChat(chat) && needsContact(peerId) ? `<button class="addc-btn" id="ch-add-contact" data-on-click="addContactFromChat" data-a-click="${esc(JSON.stringify([peerId]))}"><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg><span>Добавить контакт</span></button>` : '';
  const peerDot = peerId && !isSysChat(chat) ? presenceDot(peerId) : '';
  S.activeInvite = !!chat.invite;
  const sub = (isTopic || isRoom || isGroup) ? groupSubHtml(chat) : (isSysChat(chat) ? 'Служебные уведомления' : peerId ? peerSubText(peerId) : 'Личный чат');
  const nameClickable = (!chat.invite && (isGroup || (isRoom && !isTopic))) ? `style="cursor:pointer" data-on-click="openGroupInfo" data-a-click="${esc(JSON.stringify([chatId]))}"` : (peerId && !isSysChat(chat) ? `style="cursor:pointer" data-on-click="openProfile" data-a-click="${esc(JSON.stringify([peerId]))}"` : '');

  const main = document.getElementById('chat-main');
  setChatMainContent(`
    <div class="chat-header">
      <div class="chat-header-main">
        <div class="av-wrap"${peerId ? ` style="cursor:pointer" data-on-click="openProfile" data-a-click="${esc(JSON.stringify([peerId]))}"` : ''}>
          ${isTopic
            ? `<div class="av av-md av-round av-${senderNameClass(chat.name)}"${chat.has_avatar ? ` style="background-image:url('/api/chats/${chat.id}/avatar');background-size:cover;background-position:center"` : ''}>${chat.has_avatar ? '' : '#'}</div>`
            : `<div class="av av-md ${chatAvatarClass(chat)}${chat.type==='room' && chat.has_topics && !S.activeTopicId?' av-sq':' av-round'}" data-av-chat="${chat.id}">${chatIcon(chat)}</div>`}
          ${peerDot}${fedDotHtml(chat)}
        </div>
        <div class="chat-header-info" ${nameClickable}>
          <div class="ch-name">${esc(name)}</div>
          <div class="ch-subwrap"><div class="ch-sub">${sub}</div><div class="ch-typing"><span class="typing-dots"><span></span><span></span><span></span></span><span class="ch-typing-text"></span></div></div>
        </div>
      </div>
      <div class="chat-header-actions">
        ${addContactBtn}
        ${(chat.is_secret || chat.invite) ? '' : `<button class="icon-btn${S.chatSearch?.open ? ' active' : ''}" title="Поиск в чате" data-on-click="toggleChatSearch">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>`}
        ${(isRoom || chat.invite) ? '' : `<button class="icon-btn" title="Действия с чатом" data-on-click="showChatCtx" data-a-click="${esc(JSON.stringify(["__event", chatId]))}">
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>`}
      </div>
    </div>
    <div id="pin-bar" class="pin-bar" style="display:none"></div>
    ${chatSearchBarHtml(chatId, chat.is_secret)}
    <div class="messages-wrap">
      <div class="messages" id="messages"></div>
      <button id="mention-btn" class="scroll-bottom-btn mention-btn" data-on-click="scrollToNextMention" title="К упоминанию" aria-label="К упоминанию"><span>@</span></button>
      <button id="scroll-bottom-btn" class="scroll-bottom-btn" data-on-click="scrollMessagesToBottom" aria-label="К последним сообщениям">
        <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg><span id="sb-badge" class="sb-badge"></span>
      </button>
    </div>
`);

  const inputBar = document.getElementById('chat-input-bar');
  inputBar.style.display = '';
  inputBar.innerHTML = `
    <div class="chat-input-wrap" id="input-wrap">
      ${inviteBarHtml(chat)}
      ${readOnlyBannerHtml(chat)}
      <div class="composer-inner"${composerLocked(chat) ? ' hidden' : ''}>
        <div id="typing-indicator" class="typing-indicator">
          <span class="typing-pill">
            <span class="typing-dots"><span></span><span></span><span></span></span>
            <span class="typing-text"></span>
          </span>
        </div>
        <div class="composer-pill" id="composer-pill">
          <div class="ep-grid" id="ep-grid">
            <div class="ep-search">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input id="ep-search-input" placeholder="Поиск смайла" autocomplete="off" data-on-input="filterEmoji" data-a-input='["__value"]'>
            </div>
            <div class="ep-tabs" id="ep-tabs"></div>
            <div class="ep-scroll" id="ep-scroll" data-on-scroll="syncEmojiTabs"></div>
            <div class="ep-gif" id="ep-gif" hidden></div>
            <div class="ep-dock" id="ep-dock" hidden>
              <div class="ep-sw" role="group" aria-label="Смайлы или GIF">
                <button type="button" id="ep-sw-emoji" aria-pressed="true" data-on-click="epMode" data-a-click='["emoji"]'>Смайлы</button>
                <button type="button" id="ep-sw-gif" aria-pressed="false" data-on-click="epMode" data-a-click='["gif"]'>GIF</button>
              </div>
              <span class="ep-pw" id="ep-pw" hidden>Powered by <span class="gp-kl"><i></i>KLIPY</span></span>
            </div>
          </div>
          <div class="composer-main">
            <button class="composer-icon-btn composer-attach" id="up-btn" title="Прикрепить, форматирование" aria-haspopup="menu" aria-expanded="false" data-on-click="toggleUpMenu" data-a-click='["__event"]'>
              <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            </button>
            <div class="up-menu" id="up-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-on-click="upPickFile">
                <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                <span>Прикрепить файл</span>
              </button>
              <button type="button" role="menuitem" id="up-fmt" data-on-click="upToggleFmt">
                <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                <span>Форматирование</span>
              </button>
            </div>
            <input type="file" id="file-input" accept="*" multiple style="display:none" data-on-change="onFilePicked" data-a-change='["__this"]'>
            <div class="composer-field">
          <div class="composer-slot" id="composer-slot"><div class="composer-slot-inner">
          <div id="dm-bar" class="dm-bar" style="display:${composerNote(chat)?.soft ? '' : 'none'}"><svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span id="dm-text">${composerNote(chat)?.soft ? esc(composerNote(chat).text) : ''}</span></div>
          <div id="image-preview-bar" style="display:none" class="input-reply-bar att-bar">
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="attach-preview-title">Вложение</div>
              <div class="att-list" id="att-list"></div>
            </div>
            <button data-on-click="clearImagePreview" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div id="reply-bar" style="display:none" class="input-reply-bar">
            <img id="reply-bar-thumb" class="reply-bar-thumb" style="display:none" alt="">
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="reply-bar-name"></div>
              <div class="reply-bar-text" id="reply-bar-text"></div>
            </div>
            <button data-on-click="hideReplyBar" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div id="forward-bar" style="display:none" class="input-reply-bar">
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="forward-bar-name"></div>
              <div class="reply-bar-text" id="forward-bar-text"></div>
            </div>
            <button data-on-click="hideForwardBar" class="icon-btn" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div id="edit-bar" style="display:none" class="input-edit-bar">
            <span>Редактирование</span>
            <button data-on-click="cancelEdit" class="icon-btn" style="width:24px;height:24px;color:var(--accent)">
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div id="lprev-bar" style="display:none" class="lprev-bar">
            <div class="lprev-thumb" id="lprev-thumb"></div>
            <div class="reply-bar-content">
              <div class="lprev-title" id="lprev-title"></div>
              <div class="reply-bar-text" id="lprev-site"></div>
            </div>
            <button data-on-click="dismissLinkPreview" class="icon-btn" title="Не показывать превью" aria-label="Не показывать превью" style="width:24px;height:24px">
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div id="fmt-prev" style="display:none" class="fmt-prev">
            <div class="fmt-prev-l">Превью — так увидят получатели</div>
            <div class="fmt-prev-b" id="fmt-prev-b"></div>
          </div>
          <div id="fmt-bar" style="display:none" class="fmt-bar" data-on-mousedown="__h21" data-on-click="fmtBarClick" data-a-click='["__event"]'>${Fmt.barHtml()}</div>
          </div></div>
              <div class="composer-field-row">
              <div id="msg-input" class="fmt-ce" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Сообщение" data-ph="Сообщение…" spellcheck="true" data-on-keydown="handleKey" data-a-keydown='["__event"]' data-on-input="onMsgInput" data-a-input='["__this"]' data-on-focus="closeEmojiPicker" data-on-pointerdown="closeEmojiPicker"></div>
              <button class="composer-icon-btn" title="Эмодзи" data-on-click="toggleEmojiPicker" data-a-click='["__event"]'>
                <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/></svg>
              </button>
              </div>
            </div>
            <button class="send-btn" id="send-btn" data-on-mousedown="__h21" data-on-click="sendOrEdit">
              <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  requestAnimationFrame(syncInputBarHeight);
  initComposerSlot();
  initComposerFmt();
  scApplyComposerState(chatId);
  applyAvatars();
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.classList.remove('ready');
  // Отметку о прочтении отправляем после загрузки: иначе сервер успевает снять
  // read_at раньше, чем посчитает первое непрочитанное, и разделитель пропадает

  const msgsEl = document.getElementById('messages');
  // Вернулись в чат, из которого ушли с историей выше: открываем на том же месте
  const _pos = (!aroundId && !forceBottom && !_hadUnread) ? S.lastPos[chatId] : null;
  if (_pos) { aroundId = _pos.id; delete S.lastPos[chatId]; }
  // Чат без непрочитанного открывается сразу из сохранённого хвоста; настоящие сообщения заменят его, когда придёт ответ
  const _tl = (!aroundId && !forceBottom && !_hadUnread) ? tailLoad(chatId) : null;
  if (msgsEl && _tl) {
    S.activeChatId === chatId && renderMessages(_tl.messages);
    setAnchor({ mode: 'bottom' });
  } else if (msgsEl) {
    msgsEl.innerHTML = `<div class="skeleton-wrap">${[200,280,160,240,120].map((w,i) =>
      `<div class="skeleton-msg ${i%2===0?'theirs':'mine'}">
        <div class="skeleton-av"></div>
        <div class="skeleton-bubble" style="width:${w}px"></div>
      </div>`).join('')}</div>`;
  }
  watchChat(chat);
  if (chat.invite) {
    // Приглашение: сообщений и участников нет, история откроется после вступления
    if (msgsEl) msgsEl.innerHTML = `<div class="empty-state inv-empty"><div class="empty-icon">${FED_GLOBE.replace('width="12" height="12"', 'width="34" height="34"')}</div><p>Вас пригласили в ${fedKind(chat)} «${esc(name)}».<br>Сообщения появятся после вступления.</p></div>`;
    _loadingChatId = null;
    return;
  }
  let data = await api('GET', aroundId
    ? `/messages/chat/${chatId}?around=${aroundId}&limit=50`
    : `/messages/chat/${chatId}?limit=50${forceBottom ? '' : '&anchor=unread'}`);
  if (!data && !aroundId) data = tailLoad(chatId);                  // связи нет: показываем сохранённый хвост
  else if (data && !aroundId && !data.hasMoreAfter) tailSave(chatId, data.messages);
  if (data && S.activeChatId === chatId) {
    S.chatHasMore = data.hasMore;
    S.chatHasMoreAfter = !!data.hasMoreAfter;
    S.chatOldestId = data.messages[0]?.id ?? null;
    S.chatNewestId = data.messages[data.messages.length - 1]?.id ?? null;
    renderMessages(data.messages);
    outboxShowFor(chatId);
    // Резерв под полосу ввода выставляем до постановки якоря, иначе он считается
    // по ещё не зарезервированной высоте
    watchComposerHeight();
    watchTopHeight();
    renderTyping(chatId);
    // Закреплённые приходят вместе с историей
    S.pins = data.pins || [];
    _pinIdx = 0;
    renderPinBar();
    if (_pos && aroundId === _pos.id) {
      requestAnimationFrame(() => { if (!restorePos(_pos)) scrollToMsg(aroundId, true); });
    } else if (aroundId) {
      requestAnimationFrame(() => scrollToMsg(aroundId, true));
    } else {
      const divider = insertUnreadDivider(data.first_unread_id);
      setAnchor(divider && !forceBottom
        ? { mode: 'el', id: data.first_unread_id, offset: 8 }
        : { mode: 'bottom' });
    }
    setTimeout(() => sendRead(chatId), 350);
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

  const inputEl = document.getElementById('msg-input');
  if (inputEl) {
    inputEl.value = S.drafts[chatId] || '';
    autoResize(inputEl);
    onMsgInput(inputEl, true);
  }
  inputEl?.focus();
}

// ── ТАКТИЛЬНЫЙ ОТКЛИК ──
// Короткий щелчок подтверждает жест раньше, чем глаз успеет заметить изменение
function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch {}
}

// ── SWIPE: ответ на сообщение (влево, тач) ──
function addSwipeReply(container) {
  let startX = 0, startY = 0, swipeEl = null, dirLocked = false, replyArmed = false;

  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swipeEl = e.target.closest('[data-msg-id]');
    dirLocked = false; replyArmed = false;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!dirLocked) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      dirLocked = true;
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
  // Long-press по элементу списка чатов — то же контекстное меню, что и по клику правой кнопкой
  const chatEl = e.target.closest('[data-chat-id]');
  if (chatEl) {
    _longPressTimer = setTimeout(() => {
      const chatId = parseInt(chatEl.dataset.chatId);
      haptic(12);
      showChatCtx({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: ()=>{}, stopPropagation: ()=>{} }, chatId);
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
// в телеграме, — плоскую ленту из тысячи с лишним смайлов приходилось бы крутить
// наугад. Сам список (EMOJI_GROUPS и EMOJI_KEYWORDS) лежит в emoji-data.js и
// собирается скриптом scripts/build-emoji.js из данных Unicode и CLDR. Раньше он
// был написан руками и урезан до тех смайлов, что рисовались в Windows; теперь
// шрифт вшит в клиент, и ограничение снято — набор полный.

// Плоский список — им пользуется панель реакций
const EMOJIS = EMOJI_GROUPS.flatMap(g => g.items);

const EMOJIS_DEFAULT_FREQ = ['👍','❤️','😂','🔥','😎','🎉','😭','🤔'];
function getEmojiFreq() { try { return JSON.parse(localStorage.getItem('emoji_freq')||'{}'); } catch { return {}; } }
function trackEmojiUse(em) {
  const f=getEmojiFreq(); f[em]=(f[em]||0)+1; try { localStorage.setItem('emoji_freq',JSON.stringify(f)); } catch {}
  api('POST','/users/me/emoji',{ use: em }).catch(()=>{});
}
// Другое устройство выбрало смайл: счётчики только растут, поэтому берём большее значение
function mergeEmojiFreq(freq) {
  if (!freq) return;
  const f=getEmojiFreq();
  for (const [e,n] of Object.entries(freq)) if (n>(f[e]||0)) f[e]=n;
  try { localStorage.setItem('emoji_freq',JSON.stringify(f)); } catch {}
}
// Частые смайлы общие на всех устройствах: список берём с сервера (localStorage — кэш для мгновенного показа),
// а накопленное на этом устройстве до перехода на сервер отправляем один раз
async function syncEmojiFreq() {
  try {
    const local = getEmojiFreq(), first = !localStorage.getItem('emoji_freq_synced');
    const r = first && Object.keys(local).length ? await api('POST','/users/me/emoji',{ merge: local }) : await api('GET','/users/me/emoji');
    if (!r || !r.freq) return;
    localStorage.setItem('emoji_freq_synced','1');
    localStorage.setItem('emoji_freq',JSON.stringify(r.freq));
  } catch {}
}
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

// Смайлов почти две тысячи, и собирать столько кнопок заново на каждое открытие
// заметно дорого. Разделы, кроме «часто используемых», не меняются — держим их
// разметку готовой строкой. Плюс каждому разделу проставляем ожидаемую высоту:
// она нужна правилу content-visibility, чтобы браузер мог не размечать разделы
// вне видимой части и при этом знал, сколько места под них отвести.
// Панель одна на два места: композер и выбор реакции. Отличаются шириной,
// размером ячейки и тем, что делает нажатие; остальное — разделы, вкладки,
// липкие заголовки, поиск — общее. Раньше у реакций была своя плоская сетка
// без разделов и поиска, и полторы тысячи смайлов приходилось листать наугад.
const EP_KIND = {
  ep: { cols: 8, cell: 36, pick: 'insertEmoji' },   // композер
  rp: { cols: 7, cell: 30, pick: 'pickerReact' },   // реакции
};
const _epStatic = { ep: null, rp: null };

function emojiSectionHtml(g, kind) {
  const k = EP_KIND[kind];
  const h = Math.ceil(g.items.length / k.cols) * k.cell;
  return '<div class="ep-head" data-head="' + g.key + '">' + g.name + '</div>' +
    '<div class="ep-row" data-row="' + g.key + '" style="contain-intrinsic-size:auto ' + h + 'px">' +
      g.items.map(em => '<button class="emoji-item" data-em="' + em + '" data-on-click="' + k.pick + '" data-a-click="' + esc(JSON.stringify([em])) + '">' + em + '</button>').join('') +
    '</div>';
}


// Готовая разметка панели: постоянная часть из кэша, «часто используемые» заново
function emojiPickerCached(kind) {
  if (_epStatic[kind] === null) _epStatic[kind] = EMOJI_GROUPS.map(g => emojiSectionHtml(g, kind)).join('');
  return emojiSectionHtml(emojiSections()[0], kind) + _epStatic[kind];
}

function closeEmojiPicker() {
  if (_emojiInserting) return;   // фокус вернули после вставки смайла
  document.getElementById('ep-grid')?.classList.remove('open');
}

// ── GIF из Klipy в панели смайлов (модуль «GIF», см. shared/gif-klipy.js) ──
// Переключатель «Смайлы / GIF» стоит внизу панели и есть, только если модуль включён у этого человека и чат не секретный
let _epMode = 'emoji';
function epDockSync() {
  const dock = document.getElementById('ep-dock'); if (!dock) return;
  const can = !!(window.GifKlipy && GifKlipy.on()) && !S.secretChatIds.has(S.activeChatId) && !S.editingMessageId;
  dock.hidden = !can;
  if (!can && _epMode === 'gif') epMode('emoji');
}
function epMode(mode) {
  const panel = document.getElementById('ep-grid'); if (!panel) return;
  if (mode === 'gif' && !(window.GifKlipy && GifKlipy.on())) mode = 'emoji';
  _epMode = mode;
  const gif = mode === 'gif';
  panel.classList.toggle('gif-mode', gif);
  panel.querySelector('.ep-search').hidden = gif;
  document.getElementById('ep-tabs').hidden = gif;
  document.getElementById('ep-scroll').hidden = gif;
  const host = document.getElementById('ep-gif'); host.hidden = !gif;
  document.getElementById('ep-pw').hidden = !gif;
  document.getElementById('ep-sw-emoji').setAttribute('aria-pressed', String(!gif));
  document.getElementById('ep-sw-gif').setAttribute('aria-pressed', String(gif));
  // Признак на самом контейнере, а не общий флаг: панель создаётся заново при каждой смене чата, и в новую её нужно смонтировать снова
  if (gif && !host.dataset.mounted) {
    host.dataset.mounted = '1';
    GifKlipy.setUser(`${S.server}:${S.user?.id || 0}`, 'ru');
    host._gif = GifKlipy.mount(host, { onPick: pickGif });
  }
  // На телефоне фокус поднимает клавиатуру и закрывает панель, поэтому только там, где есть мышь
  if (gif && !window.matchMedia('(max-width: 767px), (pointer: coarse)').matches) host._gif?.focus();
}
// Выбранная GIF уходит сразу: если в поле есть текст, он станет подписью
function pickGif(att) {
  if (!att || !att.gif || S.editingMessageId) return;
  setPendingAttachment(att);
  sendOrEdit();
}

function toggleEmojiPicker(e) {
  e.stopPropagation();
  const panel = document.getElementById('ep-grid');
  if (!panel) return;
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }

  const sections = emojiSections();
  const tabs = document.getElementById('ep-tabs');
  const scroll = document.getElementById('ep-scroll');
  if (tabs && !tabs.firstChild) tabs.innerHTML = emojiTabsHtml('ep');
  // Разметка остаётся в DOM между открытиями: разобрать полторы тысячи кнопок
  // заново — это те же двадцать миллисекунд на каждый показ панели. Пересобираем,
  // только если её там нет (первый раз, после поиска) или поменялись «часто
  // используемые».
  if (scroll) {
    const freq = sections[0].items.join('');
    if (!scroll.firstChild || scroll.dataset.freq !== freq) {
      scroll.innerHTML = emojiPickerCached('ep');
      scroll.dataset.freq = freq;
    }
    scroll.scrollTop = 0;
  }
  const input = document.getElementById('ep-search-input');
  if (input) input.value = '';
  panel.classList.add('open');
  epDockSync();
  // На телефоне фокус в поиске поднимает клавиатуру, и она закрывает саму панель
  if (!window.matchMedia('(max-width: 767px), (pointer: coarse)').matches) {
    if (_epMode === 'gif') document.getElementById('ep-gif')?._gif?.focus(); else input?.focus();
  }
}

// Считаем по рядам, а не по заголовкам: заголовки липкие, и их offsetTop/rect
// в прилипшем состоянии показывают не место раздела, а верх ленты
// Ряд вкладок с иконками разделов — одинаковый для обеих панелей
function emojiTabsHtml(kind) {
  return emojiSections().map((g, i) =>
    '<button class="ep-tab" data-tab="' + g.key + '" title="' + g.name + '"' +
    ' aria-selected="' + (i === 0) + '" data-on-click="emojiTabTo" data-a-click="' + esc(JSON.stringify([g.key, kind])) + '">' +
    g.icon + '</button>').join('');
}

function emojiTabTo(key, kind = 'ep') {
  const scroll = document.getElementById(kind + '-scroll');
  const row = scroll?.querySelector('[data-row="' + key + '"]');
  const head = scroll?.querySelector('[data-head="' + key + '"]');
  if (!row) return;
  const delta = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (head?.offsetHeight || 0);
  scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'smooth' });
  // Выбранную вкладку ставим сразу и держим, пока человек сам не прокрутит: иначе подсветка бежала бы по группам
  // по пути, а у групп, которые не могут подняться к верху списка (самые последние), останавливалась на соседней
  scroll._tabLock = key;
  document.querySelectorAll('#' + kind + '-tabs .ep-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === key)));
  if (!scroll._lockBound) {
    scroll._lockBound = true;
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(ev => scroll.addEventListener(ev, () => { scroll._tabLock = null; }, { passive: true }));
  }
}

// Активная вкладка следует за прокруткой — как в телеграме
function syncEmojiTabs(kind = 'ep') {
  const scroll = document.getElementById(kind + '-scroll');
  if (!scroll || scroll._tabLock) return;
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
  document.querySelectorAll('#' + kind + '-tabs .ep-tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.tab === cur)));
}

// Поиск: показываем одну ленту найденного, отсортированную по близости совпадения,
// и возвращаемся к её началу. Раньше совпадения оставались на своих местах в
// разделах — по запросу «сердце» лента внешне не менялась, и найденное приходилось
// искать прокруткой у самого низа.
function filterEmoji(q, kind = 'ep') {
  const scroll = document.getElementById(kind + '-scroll');
  if (!scroll) return;
  scroll._tabLock = null;
  const query = (q || '').trim().toLowerCase();

  if (!query) {
    scroll.innerHTML = emojiPickerCached(kind);
    scroll.dataset.freq = emojiSections()[0].items.join('');
    scroll.scrollTop = 0;
    syncEmojiTabs(kind);
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

  // В ленте теперь найденное, а не разделы. Снимаем отметку «частых»: по ней
  // открытие панели решает, пересобирать ли ленту, и без этого после повторного
  // открытия поле поиска было пустым, а результаты прошлого поиска оставались
  delete scroll.dataset.freq;
  scroll.innerHTML = hits.length
    ? '<div class="ep-head" data-head="found">Найдено: ' + hits.length + '</div>' +
      '<div class="ep-row" data-row="found">' + hits.map(h =>
        '<button class="emoji-item" data-em="' + h.em + '" data-on-click="' + EP_KIND[kind].pick + '" data-a-click="' + esc(JSON.stringify([h.em])) + '">' + h.em + '</button>').join('') +
      '</div>'
    : '<div class="ep-miss">Ничего не нашлось</div>';
  scroll.scrollTop = 0;
  document.querySelectorAll('#' + kind + '-tabs .ep-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
}

// Панель после выбора остаётся открытой: обычно ставят не один смайл, а
// несколько подряд, и каждый раз открывать её заново утомительно. Закрыть —
// повторным нажатием на кнопку, кликом мимо композера, Escape или установкой
// курсора в поле ввода.
let _emojiInserting = false;
function insertEmoji(em) {
  trackEmojiUse(em);
  const input = document.getElementById('msg-input');
  if (!input) return;
  // Возвращаем курсор в поле, но это не то же самое, что поставить его туда
  // руками: там закрытие панели как раз нужно, поэтому помечаем свой вызов
  _emojiInserting = true;
  Fmt.insertText(input, em);   // фокус возвращается в поле, событие input обновит остальное
  _emojiInserting = false;
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
  c?.removeEventListener('loadedmetadata', applyAnchor, true);
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
  // позже, — перебирать их по одной пришлось бы после каждой вставки. У видео
  // аналог load — loadedmetadata: до него бабл считает высоту по умолчанию 2:1,
  // после — по реальным пропорциям ролика, и лента может сдвинуться так же
  c.addEventListener('load', applyAnchor, true);
  c.addEventListener('loadedmetadata', applyAnchor, true);
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


// ── ЛЕНТА КАК В TELEGRAM ──
// Подгрузка заранее (за два экрана до края), окно ограниченного размера, «прочитано» по мере показа,
// возврат на прежнее место в чате и счётчики на кнопках «вниз» и «@»
var FEED_MAX = 320, FEED_KEEP = 200;
var _trimT = null, _readT = null, _lastScroll = 0;
var _vTop = 0, _vAt = 0, _fastT = null;
var _readSent = {};
S.lastPos = S.lastPos || {};
function feedEdge(c) { return Math.max(1400, c.clientHeight * 2); }

// Первое сообщение, видимое у верхнего края ленты
function firstVisibleMsg(c) {
  const rows = c.querySelectorAll('[data-msg-id]');
  const top = c.getBoundingClientRect().top;
  let lo = 0, hi = rows.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].getBoundingClientRect().bottom > top + 1) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  return ans < 0 ? null : rows[ans];
}

// Лента не должна расти без конца: оставляем окно вокруг того, что читают, дальнее с обеих сторон выпадает
// (подгрузится снова через loadMoreMessages / loadMoreAfter)
function feedTrim() {
  const c = document.getElementById('messages');
  if (!c || _loadingMore || _anchor || _loadingChatId) return;
  const rows = [...c.querySelectorAll('[data-msg-id]')];
  const n = rows.length;
  // Пока лента летит, лишнее убираем только когда оно сильно перерасходовано: запись scrollTop на лету рвёт инерцию
  if (n <= FEED_MAX) return;
  if (performance.now() - _lastScroll < 150 && n <= FEED_MAX * 1.6) { _trimT = setTimeout(() => { _trimT = null; feedTrim(); }, 300); return; }
  const ref = firstVisibleMsg(c);
  const ai = ref ? rows.indexOf(ref) : -1;
  if (ai < 0) return;
  const lo = Math.max(0, ai - FEED_KEEP);
  let hi = Math.min(n, ai + FEED_KEEP);
  // Неотправленное из хвоста не убираем: оно живёт в очереди и должно оставаться в ленте
  if (hi < n && rows.slice(hi).some(r => r.dataset.optimistic || r.dataset.cid)) hi = n;
  if (lo + (n - hi) < 40) return;
  const y0 = ref.getBoundingClientRect().top;
  const drop = rows.slice(0, lo).concat(rows.slice(hi));
  drop.forEach(r => r.remove());
  c.querySelectorAll(':scope > .day-group').forEach(g => { if (!g.querySelector('[data-msg-id]')) g.remove(); });
  const left = [...c.querySelectorAll('[data-msg-id]')].filter(r => +r.dataset.msgId > 0);
  if (lo > 0) { S.chatHasMore = true; S.chatOldestId = +left[0]?.dataset.msgId || S.chatOldestId; }
  if (hi < n) { S.chatHasMoreAfter = true; S.chatNewestId = +left[left.length - 1]?.dataset.msgId || S.chatNewestId; }
  const d = ref.getBoundingClientRect().top - y0;
  if (Math.abs(d) > .5) c.scrollTop += d;
  onMessagesScroll();
}

// Последнее сообщение, которое видно над полем ввода
function lastSeenMsgId() {
  const c = document.getElementById('messages');
  if (!c) return 0;
  const bar = document.getElementById('chat-input-bar');
  const edge = (bar ? bar.getBoundingClientRect().top : c.getBoundingClientRect().bottom) - 8;
  const rows = c.querySelectorAll('[data-msg-id]');
  let lo = 0, hi = rows.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].getBoundingClientRect().top < edge) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  while (ans >= 0 && !(+rows[ans].dataset.msgId > 0)) ans--;
  return ans < 0 ? 0 : +rows[ans].dataset.msgId;
}
// «Прочитано» уходит по мере показа: до последнего видимого сообщения, а не всё сразу при открытии чата
function sendRead(chatId, upTo) {
  if (!chatId || S.activeChatId !== chatId || !S.ws || S.ws.readyState !== 1 || !isViewing()) return;
  const id = upTo || lastSeenMsgId();
  if (!id || id <= (_readSent[chatId] || 0)) return;
  _readSent[chatId] = id;
  if (!S.readUpTo) {
    // Сервер старой версии не умеет «прочитано до сообщения»: отмечает весь чат и не присылает остаток — обнуляем счётчик сами
    S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId }));
    S.unread[chatId] = 0; S.unreadMentions[chatId] = 0;
    updateUnreadTotal(); renderChatListSoon();
    return;
  }
  S.ws.send(JSON.stringify({ type: 'read', chat_id: chatId, up_to: id }));
}
// Перерисовка списка чатов после «прочитано»: пока выделение едет к выбранному чату (плашка-призрак в полёте),
// строку заменять нельзя — у новой нет приглушения, и выделение мигает. Ждём, пока плашка долетит
var _rclT = null;
function renderChatListSoon() {
  clearTimeout(_rclT);
  const go = () => { if (document.querySelector('.ss-ghost')) _rclT = setTimeout(go, 120); else renderChatList(); };
  go();
}
function scheduleRead() {
  clearTimeout(_readT);
  _readT = setTimeout(() => sendRead(S.activeChatId), 250);
}

// Место в ленте запоминается, когда человек уходит из чата, оставив историю выше: при возврате чат открывается там же
function savePos(chatId) {
  const c = document.getElementById('messages');
  if (!c || !chatId) return;
  const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
  if (dist < 300) { delete S.lastPos[chatId]; return; }
  const ref = firstVisibleMsg(c);
  const id = ref ? +ref.dataset.msgId : 0;
  if (id > 0) S.lastPos[chatId] = { id, off: ref.getBoundingClientRect().top - c.getBoundingClientRect().top };
}
function restorePos(pos) {
  const c = document.getElementById('messages');
  const el = c?.querySelector(`[data-msg-id="${pos.id}"]`);
  if (!c || !el) return false;
  c.scrollTop += el.getBoundingClientRect().top - c.getBoundingClientRect().top - pos.off;
  return true;
}

// Счётчики на кнопке «вниз» и кнопка «@» к ближайшему упоминанию
function updateDownBadge() {
  const id = S.activeChatId;
  const b = document.getElementById('sb-badge'), m = document.getElementById('mention-btn');
  const n = id ? (S.unread[id] || 0) : 0, mn = id ? (S.unreadMentions[id] || 0) : 0;
  if (b) { b.textContent = n > 99 ? '99+' : n || ''; b.classList.toggle('on', n > 0); }
  if (m) m.classList.toggle('visible', mn > 0);
}
async function scrollToNextMention() {
  const id = S.activeChatId;
  if (!id) return;
  const r = await api('GET', `/messages/chat/${id}/next-mention`);
  if (r?.id && S.activeChatId === id) scrollToMsg(r.id, true);
}

// Размеры вложений: место под фото и видео резервируется по пропорциям до загрузки кадра
var _szMap = null, _szT = null;
function szMap() { if (!_szMap) { try { _szMap = JSON.parse(localStorage.getItem('imgsz_v1') || '{}'); } catch { _szMap = {}; } } return _szMap; }
function szOf(att, key) { if (att.width > 0 && att.height > 0) return [att.width, att.height]; return szMap()[key] || null; }
function szAttrs(att, key) { const d = szOf(att, key); return d ? { cls: ' bubble-sized', st: ` style="--w:${d[0]};--h:${d[1]}"` } : { cls: '', st: '' }; }
document.addEventListener('load', e => {
  const i = e.target;
  if (i?.tagName !== 'IMG' || !i.naturalWidth) return;
  const b = i.closest?.('.bubble-image:not(.bubble-sized)');
  const u = b?.dataset.lbUrl;
  if (!u) return;
  const m = szMap(), k = Object.keys(m);
  if (m[u]) return;
  if (k.length > 600) k.slice(0, 200).forEach(x => delete m[x]);
  m[u] = [i.naturalWidth, i.naturalHeight];
  clearTimeout(_szT);
  _szT = setTimeout(() => { try { localStorage.setItem('imgsz_v1', JSON.stringify(m)); } catch {} }, 1500);
}, true);

function onMessagesScroll() {
  const container = document.getElementById('messages');
  if (!container) return;
  // Быстрая прокрутка: у каждого пузыря своё размытие фона (backdrop-filter), и при полёте ленты слои не успевают отрисоваться —
  // вместо сообщений мелькают замыленные прямоугольники. Пока лента летит, размытие снимаем, а после остановки возвращаем
  const _t = performance.now(), _v = Math.abs(container.scrollTop - _vTop) / Math.max(1, _t - _vAt);
  _vTop = container.scrollTop; _vAt = _t;
  if (_v > 1 && !_anchor) container.classList.add('fast-scroll');
  if (container.classList.contains('fast-scroll')) { clearTimeout(_fastT); _fastT = setTimeout(() => container.classList.remove('fast-scroll'), 160); }
  // Отслеживаем, находится ли пользователь у нижнего края (для авто-прокрутки)
  const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
  _stickBottom = dist < 80 && !S.chatHasMoreAfter;
  if (S.chatHasMore && !_loadingMore && container.scrollTop < feedEdge(container)) loadMoreMessages();
  if (S.chatHasMoreAfter && !_loadingMore && dist < feedEdge(container)) loadMoreAfter();
  const btn = document.getElementById('scroll-bottom-btn');
  if (btn) btn.classList.toggle('visible', dist > 300 || !!S.chatHasMoreAfter);
  _lastScroll = performance.now();
  if (!_trimT) _trimT = setTimeout(() => { _trimT = null; feedTrim(); }, 500);
  scheduleRead(); updateDownBadge();
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
  requestAnimationFrame(onMessagesScroll);
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
  requestAnimationFrame(onMessagesScroll);
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

  // Опорное сообщение: после вставки возвращаем его на то же место. Запись scrollTop только при расхождении:
  // там, где браузер уже сдвинул ленту сам (scroll anchoring), лишняя запись обрывала бы инерцию
  const ref = firstVisibleMsg(container), y0 = ref ? ref.getBoundingClientRect().top : 0;
  container.insertAdjacentHTML('afterbegin', html);
  reflowSeries();
  mergeDayGroups(container);
  if (ref?.isConnected) { const d = ref.getBoundingClientRect().top - y0; if (Math.abs(d) > .5) container.scrollTop += d; }
}

// Смайлик сидит в своём боксе не по центру: у эмодзи-шрифтов рисунок смещён
// относительно середины строки, и величина смещения зависит от системы — на macOS
// одна, на Windows другая. Меряем один раз на крупном кегле (на мелком метрики
// округляются до целых пикселей и врут) и держим поправку в переменной.
function calcEmojiInkShift() {
  try {
    const c = document.createElement('canvas').getContext('2d');
    // Меряем только вшитый шрифт: со списком запасных Chromium берёт метрики
    // строки у одного шрифта, а очертания глифа у другого, и поправка выходит нулевой
    c.font = '100px "Noto Color Emoji"';
    const m = c.measureText('👍');
    const ink = (-m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
    const box = (-m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 2;
    const shift = -(ink - box) / 100;
    if (Number.isFinite(shift) && Math.abs(shift) < 0.3) {
      document.documentElement.style.setProperty('--emoji-ink', shift.toFixed(4) + 'em');
    }
  } catch {}
}
document.fonts?.ready?.then(calcEmojiInkShift).catch(() => {});
calcEmojiInkShift();

// Проверка шрифта смайлов и выбор набора (COLRv1, sbix или системный) — в emoji-font.js
// Шрифт смайлов вшит и подгружается асинхронно: первый замер уходит по системному,
// поэтому повторяем его, когда шрифт готов, — иначе смайлик в плашке реакции
// встанет по чужим метрикам
try {
  document.fonts.load('100px "Noto Color Emoji"', '👍')
    .then(calcEmojiInkShift).catch(() => {});
} catch {}



// ── ЗАКРЕПЛЁННЫЕ СООБЩЕНИЯ ──
// Плашка под шапкой чата показывает ОДНО закрепление — самое свежее. Нажатие
// переносит к нему и сменяет плашку на следующее (более старое), по кругу.
// Рисок слева больше десяти не рисуем: они становятся неразличимы, остаётся счётчик.
const PIN_TICKS_MAX = 10;
let _pinIdx = 0;

function pinPreviewText(p) {
  if (!p) return '';
  const t = p.text ? Fmt.plain(p.text).replace(/<[^>]*>/g, '')
    : (p.attachment ? (p.attachment.gif ? '🖼 GIF' : p.attachment.more?.length ? '🖼 Вложений: ' + (p.attachment.more.length + 1) : p.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : p.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (p.attachment.name || 'Файл')) : '');
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}

// ── ТОЛЬКО ЧТЕНИЕ ──
// Комната «только для чтения»: писать может только вебхук. Флаг распространяется на темы.
// Реакции остаются доступны — баннер заменяет только поле ввода.
function isReadOnlyChat(chat) {
  if (!chat) return false;
  if (chat.read_only) return true;
  if (chat.parent_id) return !!S.chats.find(c => c.id === chat.parent_id)?.read_only;
  return false;
}
// Ограничение «сообщений без ответа» (люди из разных пространств): сервер отдаёт dm_limit = { used, max }
const dmLocked = chat => !!chat?.dm_limit && chat.dm_limit.used >= chat.dm_limit.max;
// Группа с другого сервера (зеркало): без связи с сервером писать в неё нельзя; приглашение — пока человек не вступил
// У темы состояние связи общее с комнатой, в которой она лежит
const fedRoot = chat => (chat?.parent_id ? S.chats.find(c => c.id === chat.parent_id) : null) || chat;
const fedOffline = chat => { const c = fedRoot(chat); return !!c?.fed_mirror && !c.invite && c.fed_online === false; };
const fedKind = chat => (chat?.type === 'room' ? 'комнату' : 'группу');
// Значок «группа с другого сервера» в углу аватарки, на месте статуса «в сети»
const fedDotHtml = chat => fedRoot(chat)?.fed_mirror ? fedDotRaw() : '';
const fedDotRaw = () => `<span class="fed-dot" title="С другого сервера">${FED_GLOBE}</span>`;
// Аватарка человека в списках группы: у человека с другого сервера в углу значок земного шара
const personAv = (u, cls = 'av-sm') => `<div class="av-wrap"><div class="av ${cls} av-round ${userAvatarColor(u.id, u.tag)}" data-av-user="${u.id}">${initials(u.display_name)}</div>${u.federated ? fedDotRaw() : ''}</div>`;
const composerLocked = chat => isReadOnlyChat(chat) || dmLocked(chat) || !!chat?.invite || fedOffline(chat);
// Что написать над полем ввода: «только чтение», «писать нельзя» или мягкая подсказка о счётчике
function composerNote(chat) {
  if (isReadOnlyChat(chat)) return { text: 'Доступно только для чтения', soft: false };
  if (dmLocked(chat)) return { text: 'Больше писать нельзя: собеседник не ответил и не добавил вас в контакты', soft: false };
  if (fedOffline(chat)) return { text: 'Группа на другом сервере, связи с ним нет. Писать пока нельзя', soft: false };
  const l = chat?.dm_limit;
  if (l && l.used > 0) return { text: `Без ответа: ${l.used} из ${l.max}. Дальше нужно дождаться ответа или добавления в контакты`, soft: true };
  return null;
}
function readOnlyBannerHtml(chat) {
  const n = composerNote(chat);
  const hard = n && !n.soft;     // мягкая подсказка о счётчике живёт в выдвижной части поля (см. dm-bar), отдельной плашки у неё нет
  return `<div class="ro-banner" id="ro-banner"${hard ? '' : ' hidden'}>
    <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span id="ro-text">${hard ? esc(n.text) : ''}</span>
  </div>`;
}
// ── ГРУППЫ С ДРУГИХ СЕРВЕРОВ И СЧЁТЧИК «В СЕТИ» ──
function findChatAny(id) {
  const c = S.chats.find(x => x.id === id);
  if (c) return c;
  for (const [pid, subs] of Object.entries(S.topics)) {
    const sub = subs.find(x => x.id === id);
    if (sub) return { id, type: 'room', name: sub.name, parent_id: Number(pid), members: [] };
  }
  return null;
}
// Подпись под названием группы и комнаты: «в сети 2 из 5», а у группы с другого сервера без связи — предупреждение
function groupSubHtml(chat) {
  if (chat.invite) return `Приглашение в ${fedKind(chat)}`;
  if (fedOffline(chat)) return `<span class="fed-off">${FED_GLOBE}Группа на другом сервере · нет связи</span>`;
  const o = (S.chatOnline || {})[chat.id];
  const cnt = o ? `в сети ${o.online} из ${o.total}` : nMembers(chat.members?.length || 0);
  const globe = '';
  if (chat.parent_id) return `# тема${o ? ' · ' + cnt : ''}`;
  return chat.type === 'room' ? `${globe}${roomIcon(14)}Комната · ${cnt}` : `${globe}${cnt}`;
}
function updateGroupSub() {
  const chat = findChatAny(S.activeChatId), el = document.querySelector('.ch-sub');
  if (chat && el && chat.type !== 'direct') el.innerHTML = groupSubHtml(chat);
}
// Сообщаем серверу, какой чат открыт: он присылает и обновляет «в сети N из M»
function watchChat(chat) {
  if (S.ws?.readyState !== 1) return;
  const on = chat && (chat.type === 'group' || chat.type === 'room') && !chat.invite && !chat.has_topics;
  S.ws.send(JSON.stringify(on ? { type: 'watch_chat', chat_id: chat.id } : { type: 'unwatch_chat' }));
}
// Список чатов обновился: подпись, поле ввода и приглашение открытого чата могли измениться
function refreshActiveChatUi() {
  const chat = findChatAny(S.activeChatId);
  if (!chat) return;
  if (S.activeInvite && !chat.invite) { openChat(chat.id); return; }   // приглашение приняли: открываем группу заново
  updateGroupSub();
  syncReadOnlyUi();
}
function inviteBarHtml(chat) {
  if (!chat?.invite) return '';
  const from = chat.invite.from_name;
  return `<div class="inv-bar" id="inv-bar">
    <div class="inv-txt">${from ? `<b>${esc(from)}</b> приглашает вас в ${fedKind(chat)}` : `Вас приглашают в ${fedKind(chat)}`}. Пока вы не вступили, участников и сообщений не видно.</div>
    <div class="inv-btns"><button class="modal-btn-ghost" data-on-click="declineInvite" data-a-click="${esc(JSON.stringify([chat.id]))}">Отклонить</button><button class="modal-btn-primary" id="inv-join" data-on-click="acceptInvite" data-a-click="${esc(JSON.stringify([chat.id]))}">Вступить</button></div>
  </div>`;
}
async function acceptInvite(id) {
  const b = document.getElementById('inv-join');
  if (b) { b.disabled = true; b.textContent = 'Вступаю…'; }
  const r = await api('POST', `/chats/${id}/invite/accept`);
  if (r?.error || !r) { showActionToast(r?.error || 'Не удалось вступить. Попробуйте позже.'); if (b) { b.disabled = false; b.textContent = 'Вступить'; } }
}
async function declineInvite(id) {
  await api('POST', `/chats/${id}/invite/decline`);
}
function syncReadOnlyUi() {
  const chat = findChatAny(S.activeChatId), n = composerNote(chat);
  const bn = document.getElementById('ro-banner'), hard = n && !n.soft;
  if (bn) { bn.toggleAttribute('hidden', !hard); const t = document.getElementById('ro-text'); if (t && hard) t.textContent = n.text; }
  // Счётчик «без ответа» — плашка внутри поля ввода, как панель форматирования
  const dm = document.getElementById('dm-bar');
  if (dm) { dm.style.display = n?.soft ? '' : 'none'; const t = document.getElementById('dm-text'); if (t && n?.soft) t.textContent = n.text; }
  document.querySelector('#input-wrap .composer-inner')?.toggleAttribute('hidden', composerLocked(chat));
}

// ── ПОИСК В ЧАТЕ ──
// Строка под закреплённым (поверх него). Совпадения — с сервера по всей истории чата
// (FTS); переход к найденному — через scrollToMsg, который подгружает окно вокруг
// сообщения. Подсветка — в DOM: наблюдатель на #chat-main переставляет её после
// каждой перерисовки ленты (openChat, новые сообщения, подгрузка истории).
const CHAT_SEARCH_DELAY = 250;
let _csTimer = null, _hlObs = null, _hlRaf = 0;
const HL_OBS_OPTS = { childList: true, subtree: true, characterData: true };

function chatSearchBarHtml(chatId, isSecret) {
  // В секретных чатах поиска на сервере нет: текст там не индексируется
  if (isSecret) return '';
  const st = S.chatSearch;
  const open = !!(st && st.open && st.chatId === chatId);
  return `<div id="chat-search" class="chat-search${open ? ' open' : ''}">
    <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="cs-input" type="text" placeholder="Поиск в чате" autocomplete="off" value="${esc(open ? st.q : '')}" data-on-input="onChatSearchInput" data-a-input='["__value"]' data-on-keydown="onChatSearchKey" data-a-keydown='["__event"]'>
    <span class="cs-count" id="cs-count">${open ? csCountText() : ''}</span>
    <button class="icon-btn" id="cs-up" title="Предыдущее" data-on-click="chatSearchStep" data-a-click='[-1]'>
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
    </button>
    <button class="icon-btn" id="cs-down" title="Следующее" data-on-click="chatSearchStep" data-a-click='[1]'>
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <button class="icon-btn" title="Закрыть поиск" data-on-click="closeChatSearch">
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  </div>`;
}

function csCountText() {
  const st = S.chatSearch;
  if (!st || st.q.trim().length < 2) return '';
  if (st.loading) return '…';
  if (!st.ids.length) return 'Нет совпадений';
  return `${st.idx + 1} из ${st.ids.length}`;
}

// Счётчик и доступность стрелок; вызывается после каждого изменения состояния
function chatSearchRefresh() {
  const st = S.chatSearch;
  const count = document.getElementById('cs-count');
  if (count) count.textContent = st ? csCountText() : '';
  const up = document.getElementById('cs-up');
  const down = document.getElementById('cs-down');
  // «Вверх» — к более старому совпадению, «вниз» — к более новому
  if (up) up.disabled = !st || st.idx <= 0;
  if (down) down.disabled = !st || st.idx >= st.ids.length - 1;
}

function toggleChatSearch() {
  if (S.chatSearch?.open) closeChatSearch(); else openChatSearch();
}

function openChatSearch() {
  const bar = document.getElementById('chat-search');
  if (!S.activeChatId || !bar) return;
  S.chatSearch = { open: true, chatId: S.activeChatId, q: '', ids: [], idx: -1, loading: false };
  bar.classList.add('open');
  const input = bar.querySelector('input');
  input.value = '';
  // Фокус сразу, без второго клика: можно печатать запрос
  input.focus();
  document.querySelector('.chat-header-actions .icon-btn[title="Поиск в чате"]')?.classList.add('active');
  watchChatSearchHl();
  chatSearchRefresh();
}

function closeChatSearch() {
  clearTimeout(_csTimer);
  S.chatSearch = null;
  if (_hlObs) _hlObs.disconnect();
  document.getElementById('chat-search')?.classList.remove('open');
  const input = document.getElementById('cs-input');
  if (input) input.value = '';
  document.querySelector('.chat-header-actions .icon-btn[title="Поиск в чате"]')?.classList.remove('active');
  applyChatSearchHl();
}

function onChatSearchInput(v) {
  const st = S.chatSearch;
  if (!st) return;
  st.q = v;
  clearTimeout(_csTimer);
  _csTimer = setTimeout(() => runChatSearch(st), CHAT_SEARCH_DELAY);
}

async function runChatSearch(st) {
  const term = st.q.trim();
  if (term.length < 2) {
    st.ids = []; st.idx = -1; st.loading = false;
    chatSearchRefresh(); applyChatSearchHl();
    return;
  }
  st.loading = true; chatSearchRefresh();
  let data = null;
  try { data = await api('GET', `/messages/search?chat_id=${st.chatId}&q=${encodeURIComponent(term)}`); } catch {}
  // Пока ждали ответ, пользователь мог изменить запрос или закрыть поиск
  if (S.chatSearch !== st || st.q.trim() !== term) return;
  st.ids = (data?.results || []).map(r => r.id).sort((a, b) => a - b);
  st.loading = false;
  st.idx = st.ids.length - 1; // начинаем с самого нового совпадения
  if (st.ids.length) chatSearchGoto(st.idx);
  else { chatSearchRefresh(); applyChatSearchHl(); }
}

function chatSearchStep(d) {
  const st = S.chatSearch;
  if (!st) return;
  const n = st.idx + d;
  if (n < 0 || n >= st.ids.length) return;
  chatSearchGoto(n);
}

function chatSearchGoto(i) {
  const st = S.chatSearch;
  st.idx = i;
  chatSearchRefresh();
  scrollToMsg(st.ids[i], true);
  applyChatSearchHl();
}

function onChatSearchKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeChatSearch(); return; }
  // Enter — к более старому, Shift+Enter — к более новому
  if (e.key === 'Enter') { e.preventDefault(); chatSearchStep(e.shiftKey ? 1 : -1); }
}

function watchChatSearchHl() {
  const main = document.getElementById('chat-main');
  if (!main) return;
  if (!_hlObs) {
    _hlObs = new MutationObserver(() => {
      if (_hlRaf) return;
      _hlRaf = requestAnimationFrame(() => { _hlRaf = 0; applyChatSearchHl(); });
    });
  }
  _hlObs.disconnect();
  _hlObs.observe(main, HL_OBS_OPTS);
}

// Снимает прежнюю подсветку и ставит новую по текущему запросу. Наблюдатель
// на время правок отключён, иначе собственные правки DOM запускали бы его снова
function applyChatSearchHl() {
  const main = document.getElementById('chat-main');
  if (!main) return;
  const st = S.chatSearch;
  if (_hlObs) _hlObs.disconnect();
  const old = main.querySelectorAll('mark.msg-search-hl');
  old.forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  if (old.length) main.querySelectorAll('.irc-text').forEach(t => t.normalize());
  const terms = st && st.open && st.q.trim().length >= 2
    ? st.q.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2) : [];
  if (terms.length) {
    const cur = st.idx >= 0 ? String(st.ids[st.idx]) : null;
    main.querySelectorAll('.irc-text').forEach(t => hlBubble(t, terms, t.closest('.irc-msg')?.dataset.msgId === cur));
  }
  if (_hlObs && st?.open) _hlObs.observe(main, HL_OBS_OPTS);
}

function hlBubble(text, terms, isCur) {
  const re = new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const text = node.nodeValue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mk = document.createElement('mark');
      mk.className = 'msg-search-hl' + (isCur ? ' cur' : '');
      mk.textContent = m[0];
      frag.appendChild(mk);
      last = m.index + m[0].length;
    }
    if (!last) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  });
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
    <span class="pin-body" data-on-click="pinBarClick">
      <span class="pin-slide" id="pin-slide">
        <span class="pin-label">${esc(label)}</span>
        <span class="pin-text">${esc(p.sender_name)}: ${esc(pinPreviewText(p))}</span>
      </span>
    </span>
    <button class="icon-btn pin-unpin" title="Открепить" data-on-click="unpinMessage" data-a-click="${esc(JSON.stringify([p.message_id]))}">
      <svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
    return `<button class="reaction-btn${mine ? ' mine' : ''}" data-msg-id="${msgId}" data-reaction="${esc(r.reaction)}" data-on-click="sendReaction" data-a-click="${esc(JSON.stringify([msgId, `${r.reaction}`]))}">` +
      `<span class="ra-emoji">${esc(r.reaction)}</span><span class="ra-count">${r.count}</span></button>`;
  }).join('')}</div>`;
}

// ── ТУЛТИП РЕАКЦИИ: кто поставил ──
// Имена тянем по наведению (в сообщениях их нет — раздували бы каждый ответ),
// секундной задержки хватает, чтобы запрос успел вернуться к показу.
const _REACTION_TIP_DELAY = 700;
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
    shown.map((u, i) => {
      const url = `${httpProto()}://${S.server}/api/users/${u.user_id}/avatar?t=${S.avatarTs || 1}`;
      return `<span class="rt-row" style="--i:${i}">` +
        `<span class="rt-av ${userAvatarColor(u.user_id)}">${esc(initials(u.display_name) || '?')}` +
        `<img src="${url}" alt="" data-on-error="__h22"></span>` +
        `<span class="rt-name">${esc(u.display_name)}</span></span>`;
    }).join('') +
    (rest > 0 ? `<span class="rt-row rt-more">и ещё ${rest}</span>` : '');

  // Интерфейс масштабируется через zoom (настройка размера), поэтому
  // getBoundingClientRect отдаёт визуальные пиксели, а style.left/top задаются в
  // CSS-пикселях. Коэффициент берём из самого элемента — не важно, где задан zoom.
  // offsetWidth/offsetHeight вдобавок не зависят от анимации transform.
  // Масштаб интерфейса: см. zoomMetrics — rect и style.left в одних пикселях, окно меряем пробой
  const zm = zoomMetrics();
  el.style.left = '0px'; el.style.top = '0px';
  // Меряем без анимации масштаба: в скрытом состоянии элемент уменьшен scale(.94)
  el.style.transition = 'none'; el.style.transform = 'none';
  const er = el.getBoundingClientRect();
  const tw = er.width, th = er.height;
  el.style.transition = ''; el.style.transform = '';
  const r = btn.getBoundingClientRect();
  // Сторона бейджа: у своих сообщений (справа) панель уходит влево от правого края
  const onRight = r.left + r.width / 2 > zm.vw / 2;
  let left = onRight ? r.right - tw : r.left;
  left = Math.max(8, Math.min(left, zm.vw - tw - 8));
  // Раскрываемся вверх, если над бейджем есть место; иначе вниз
  const above = r.top - th - 8 >= 8;
  const top = above ? r.top - th - 8 : r.bottom + 8;
  el.classList.toggle('above', above);
  el.classList.toggle('from-right', onRight);
  el.style.left = Math.round(left / zm.k) + 'px';
  el.style.top = Math.round(top / zm.k) + 'px';
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

// ── СЕКРЕТНЫЕ ЧАТЫ (E2E) ── создать чат в вебе нельзя; здесь получают доступ по коду,
// читают зашифрованные сообщения и отключают своё устройство. Криптография — shared/secret-core.js
let _scBooted = false;
const _scInflight = new Set();
Object.assign(S, { secretChatIds: new Set(), scDecrypted: new Map(), scAtt: new Map(), scAttBlob: new Map(), scMsgObjs: new Map() });

function scDeviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac, браузер';
  if (/Windows/.test(ua)) return 'Windows, браузер';
  return 'Браузер';
}

async function scBoot() {
  if (!_scBooted) {
    _scBooted = true;
    SC.init({ api: (m, p, b) => api(m, p, b), base: `${httpProto()}://${S.server}`, token: () => S.token, label: scDeviceLabel() });
  }
  await SC.load();
  for (const id of SC.pendingIds()) if (!SC.pendingOf(id).timer) SC.pendingOf(id).timer = setInterval(() => scTick(id), 4000);
}


const scEncryptFileForUpload = (f, k) => SC.encryptFile(f, k);

// Секретное сообщение, пока его не расшифровали, показываем пикселями; смотрим за
// лентой и расшифровываем то, что на экране
let _scT = null;
function scWatchMessages() {
  const el = document.getElementById('messages');
  if (!el || el._scObs) return;
  el._scObs = new MutationObserver(() => { clearTimeout(_scT); _scT = setTimeout(scDecryptVisible, 50); });
  el._scObs.observe(el, { childList: true, subtree: true });
}

async function scDecryptVisible() {
  const chatId = S.activeChatId;
  const key = chatId && SC.keyOf(chatId);
  if (!key || !S.secretChatIds.has(chatId)) return;
  const ids = [...document.querySelectorAll('#messages .irc-msg[data-msg-id]')]
    .map(el => Number(el.dataset.msgId)).filter(id => id > 0 && !_scInflight.has(id));
  for (const id of ids) {
    const m = S.scMsgObjs.get(id);
    if (!m) continue;
    const needText = !S.scDecrypted.has(id);
    const meta = S.scAtt.get(id);
    const needImg = !!m.attachment?.url && !m.attachment.expired && !S.scAttBlob.has(id)
      && (meta ? meta.m?.startsWith('image/') : needText);
    if (!needText && !needImg) continue;
    _scInflight.add(id);
    try {
      let changed = false;
      if (needText && m.iv && m.text) {
        const plain = await SC.decryptText(key, m.text, m.iv);
        if (plain !== null && S.activeChatId === chatId) {
          const p = SC.parsePayload(plain);
          S.scDecrypted.set(id, p.t);
          if (p.a) S.scAtt.set(id, p.a);
          changed = true;
        }
      }
      const curMeta = S.scAtt.get(id);
      if (curMeta?.m?.startsWith('image/') && m.attachment?.url && !S.scAttBlob.has(id) && S.activeChatId === chatId) {
        const buf = await SC.fetchFile(m.attachment.url, m.attachment.fiv, key);
        if (buf && S.activeChatId === chatId) {
          S.scAttBlob.set(id, URL.createObjectURL(new Blob([buf], { type: curMeta.m })));
          changed = true;
        }
      }
      if (changed && S.activeChatId === chatId) updateMsgInDOM(m);
    } finally { _scInflight.delete(id); }
  }
}

function scOpenImage(msgId) {
  const url = S.scAttBlob.get(msgId);
  if (url) openLightbox(url, S.scAtt.get(msgId)?.n || 'image', 'image');
}

async function scSaveAttachment(msgId) {
  const m = S.scMsgObjs.get(msgId);
  const meta = S.scAtt.get(msgId);
  const key = m && SC.keyOf(m.chat_id);
  if (!m?.attachment?.url || !meta || !key) { showActionToast('Вложение пока не расшифровано'); return; }
  const buf = await SC.fetchFile(m.attachment.url, m.attachment.fiv, key);
  if (!buf) { showActionToast('Не удалось расшифровать файл'); return; }
  const url = URL.createObjectURL(new Blob([buf], { type: meta.m || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = meta.n || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function scAttachHtml(m, att) {
  const meta = S.scAtt.get(m.id);
  if (!meta) return `<div class="bubble-file sc-att-locked"><div class="bubble-file-info"><div class="bubble-file-name">Вложение</div></div></div>`;
  const sizeFmt = meta.s ? (meta.s > 1048576 ? (meta.s / 1048576).toFixed(1) + ' МБ' : Math.round(meta.s / 1024) + ' КБ') : '';
  if (meta.m?.startsWith('image/')) {
    const blob = S.scAttBlob.get(m.id);
    if (blob && SC.hasKey(m.chat_id)) return `<div class="bubble-image" data-on-click="scOpenImage" data-a-click="${esc(JSON.stringify([m.id]))}"><img src="${esc(blob)}" loading="lazy"></div>`;
    return `<div class="bubble-file sc-att-locked"><div class="bubble-file-info"><div class="bubble-file-name">Изображение</div></div></div>`;
  }
  return `<div class="bubble-file" data-on-click="scSaveAttachment" data-a-click="${esc(JSON.stringify([m.id]))}">
    <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
    <div class="bubble-file-info"><div class="bubble-file-name">${esc(meta.n || 'Файл')}</div>${sizeFmt ? `<div class="bubble-file-size">${sizeFmt}</div>` : ''}</div>
    <svg class="dl-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
  </div>`;
}

const SC_LOCK_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function scApplyComposerState(chatId) {
  const pill = document.getElementById('composer-pill');
  const wrap = document.getElementById('input-wrap');
  scWatchMessages();
  if (!pill || !wrap) return;
  wrap.querySelector('.sc-locked-banner')?.remove();
  if (!S.secretChatIds.has(chatId)) { pill.style.display = ''; return; }
  if (!SC.hasKey(chatId)) { scRenderBanner(chatId); return; }
  pill.style.display = '';
  pill.querySelector('[title="Прикрепить файл"]')?.style.setProperty('display', 'none');
}

// Плашка вместо композера: закрыта, раскрыта (поле кода) или ожидание ответа собеседника
function scRenderBanner(chatId) {
  const pill = document.getElementById('composer-pill');
  const wrap = document.getElementById('input-wrap');
  if (!pill || !wrap) return;
  wrap.querySelector('.sc-locked-banner')?.remove();
  if (!S.secretChatIds.has(chatId) || SC.hasKey(chatId)) return;
  pill.style.display = 'none';
  const secure = window.isSecureContext && !!crypto.subtle;
  const mode = !secure ? 'https' : SC.pendingOf(chatId) ? 'waiting' : (S.scBannerOpen === chatId ? 'open' : 'closed');
  let inner;
  if (mode === 'https') {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Секретные чаты работают только по HTTPS</div></div>`;
  } else if (mode === 'closed') {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Чат зашифрован</div><div class="sc-b-s">Сообщения видны после расшифровки</div></div>
      <button class="sc-btn" data-on-click="scOpenBanner" data-a-click="${esc(JSON.stringify([chatId]))}">Расшифровать</button>`;
  } else if (mode === 'open') {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Введите код</div><div class="sc-b-s">Код назвал собеседник</div></div>
      <input id="sc-enter-code" class="sc-b-inp" placeholder="КОД" maxlength="12" autocomplete="off" data-on-keydown="__h23" data-a-keydown="${esc(JSON.stringify([chatId]))}">
      <button class="sc-btn" data-on-click="scRedeem" data-a-click="${esc(JSON.stringify([chatId]))}">Подтвердить</button>
      <button class="sc-b-x" aria-label="Свернуть" data-on-click="scCloseBanner" data-a-click="${esc(JSON.stringify([chatId]))}">×</button>`;
  } else {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Код принят</div><div class="sc-b-s"><span class="sc-dot"></span>Ждём подтверждения собеседника</div></div>
      <button class="sc-btn ghost" data-on-click="scCancelRequest" data-a-click="${esc(JSON.stringify([chatId]))}">Отменить</button>`;
  }
  wrap.insertAdjacentHTML('afterbegin', `<div class="sc-locked-banner sc-${mode}"><div class="sc-lock">${SC_LOCK_ICO}</div>${inner}</div>`);
  if (mode === 'open') setTimeout(() => document.getElementById('sc-enter-code')?.focus(), 30);
}
function scOpenBanner(chatId) { S.scBannerOpen = chatId; scRenderBanner(chatId); }
function scCloseBanner(chatId) { S.scBannerOpen = null; scRenderBanner(chatId); }

async function scRedeem(chatId) {
  const code = (document.getElementById('sc-enter-code')?.value || '').trim();
  if (!code) return;
  const r = await SC.redeemCode(chatId, code);
  if (r.error) { showActionToast(r.error); return; }
  S.scBannerOpen = null;
  SC.pendingOf(chatId).timer = setInterval(() => scTick(chatId), 4000);
  scRenderBanner(chatId);
}

function scCancelSyncModal() { closeModal('modal-secret-sync'); }

function scCancelRequest(chatId) {
  SC.cancelPending(chatId);
  scRenderBanner(chatId);
}

async function scTick(chatId) {
  if (!SC.pendingOf(chatId)) return;
  if (!(await SC.pollPending(chatId))) return;
  showActionToast('Секретный чат расшифрован на этом устройстве');
  await loadChats();
  if (S.activeChatId === chatId) { scApplyComposerState(chatId); scDecryptVisible(); }
}

// ── Устройства чата ──
function ctxChatDevices() {
  const chatId = S.ctxChatId;
  hideChatCtx();
  if (chatId) scOpenDevices(chatId);
}

async function scOpenDevices(chatId) {
  const rows = await SC.devices(chatId);
  if (!Array.isArray(rows)) { showActionToast(rows?.error || 'Не удалось загрузить устройства'); return; }
  const mine = SC.deviceId();
  const chat = S.chats.find(c => c.id === chatId);
  const names = Object.fromEntries((chat?.members || []).map(u => [u.id, u.display_name]));
  document.getElementById('sc-sync-title').textContent = 'Устройства секретного чата';
  document.getElementById('sc-sync-body').innerHTML = `
    <p class="sc-sync-hint">Здесь видно, на каких устройствах открыт доступ к чату. Ключ не переносится сам: новое устройство подключается только с подтверждения собеседника.</p>
    ${rows.map(r => `<div class="sc-sync-device">${esc(r.device_label || 'Устройство')} · ${esc(names[r.user_id] || 'Пользователь')}${r.device_id === mine ? ' — это устройство' : ''}</div>`).join('')}
    <div class="sc-sync-foot"><button class="modal-btn-ghost" data-on-click="scCancelSyncModal">Закрыть</button></div>`;
  openModal('modal-secret-sync');
}

// ── Удалить: отключаем только это устройство ──
// Расшифрованные текст, вложения и картинки чата уходят из памяти вместе с ключом
function scClearChatCache(chatId) {
  S.scMsgObjs.forEach((m, id) => {
    if (m.chat_id !== chatId) return;
    S.scDecrypted.delete(id);
    S.scAtt.delete(id);
    const url = S.scAttBlob.get(id);
    if (url) { URL.revokeObjectURL(url); S.scAttBlob.delete(id); }
  });
}

async function scDeleteSecret(chatId) {
  const ok = await showConfirm('Удалить секретный чат на этом устройстве? Ключ будет стёрт — чтобы вернуть доступ, понадобится подтверждение собеседника.');
  if (!ok) return;
  await api('DELETE', `/chats/${chatId}?device_id=${encodeURIComponent(SC.deviceId())}`);
  await SC.forget(chatId);
  await SC.hide(chatId);
  scClearChatCache(chatId);
  S.secretChatIds.delete(chatId);
  removeChatLocally(chatId);
}

function renderMsg(m, isChatGroup, hideTime = false, grouped = false, isLast = true) {
  return renderMsgIRC(m, !grouped, isLast, isChatGroup);
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
  // Реакция на не-последнем сообщении серии разрывает срезанный угол: он уходит
  // вниз у этого сообщения и повторяется сверху у следующего за ним.
  msgs.forEach(el => {
    el.classList.toggle('irc-reaction-split', !!el.querySelector('.reactions') && !el.classList.contains('irc-tail'));
  });
  msgs.forEach((el, i) => {
    el.classList.toggle('irc-reaction-split-next', !!msgs[i - 1]?.classList.contains('irc-reaction-split'));
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
  try { return EMOJI_ONLY_RE.test(t) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(t); } catch { return false; }
}

// Цвет тега считается из его текста: одна и та же надпись всегда даёт один цвет,
// и латиница с кириллицей тут равноправны — хеш идёт по кодам символов. Раньше
// цветными были только developer и tester, всё остальное серым.
const TAG_COLORS = 14;
function senderNameClass(tag) {
  const t = (tag || '').trim().toLowerCase();
  if (!t) return 'default';
  // FNV-1a: простое умножение на 31 давало перекос — коды кириллицы идут подряд,
  // и половина тегов попадала в один цвет
  let h = 2166136261;
  for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'tag-' + (h % TAG_COLORS + 1);
}

// Превью пересланного сообщения в списке чатов (когда своего текста нет): что именно переслали
function fwdPreview(fd) {
  const a = fd.attachment, t = fd.text ? Fmt.plain(fd.text).replace(/<[^>]*>/g, '') : '';
  const att = a ? (a.gif ? '🖼 GIF' : a.more?.length ? '🖼 Вложений: ' + (a.more.length + 1) : a.mime?.startsWith('image/') ? '🖼 Изображение' : a.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (a.name || 'Файл')) : '';
  return 'Переслано: ' + (t || att || 'сообщение');
}
// Отметка «сообщение пересылали»: стрелка и число слева от галок и времени
function fwdTimes(n) { const a = n % 10, b = n % 100; return n + (a === 1 && b !== 11 ? ' раз' : (a >= 2 && a <= 4 && (b < 12 || b > 14) ? ' раза' : ' раз')); }
// Сколько места под отметку: стрелка, цифры и отступы
const fwdReserve = n => 27 + 7 * (String(n).length - 1);
function fwdMarkHtml(m) {
  const n = Number(m.forward_count) || 0;
  return n > 0 && !m.deleted ? `<span class="fwd-mark" title="Сообщение переслали ${fwdTimes(n)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>${n}</span>` : '';
}
// Число пересылок изменилось (кто-то переслал сообщение или удалил копию): обновляем отметку на уже нарисованном сообщении
function applyForwardCount(id, count) {
  const meta = document.querySelector(`.irc-msg[data-msg-id="${id}"] .irc-meta`);
  if (!meta) return;
  meta.querySelector('.fwd-mark')?.remove();
  if (count > 0) meta.insertAdjacentHTML('afterbegin', fwdMarkHtml({ forward_count: count }));
  const bub = meta.parentElement;
  if (bub) { bub.classList.toggle('has-fwd', count > 0); if (count > 0) bub.style.setProperty('--fwd-w', fwdReserve(count) + 'px'); else bub.style.removeProperty('--fwd-w'); }
}
// Кнопки в сообщении (сообщение может нести actions, например «Заблокировать» в уведомлении «Electron» о входе с нового устройства)
function msgActionsHtml(m) {
  if (!Array.isArray(m.actions) || !m.actions.length) return '';
  return '<div class="msg-actions">' + m.actions.map(a => a.state === 'done'
    ? '<span class="msg-act done">Заблокировано</span>'
    : `<button type="button" class="msg-act" data-on-click="msgAction" data-a-click="${esc(JSON.stringify([m.id, a.id, a.device]))}">${esc(a.label || 'Действие')}</button>`).join('') + '</div>';
}
async function msgAction(msgId, id, device) {
  if (id !== 'block_device') return;
  const btn = document.querySelector(`[data-msg-id="${msgId}"] .msg-act`);
  if (btn) btn.disabled = true;
  const r = await api('POST', `/users/me/devices/${Number(device)}/block`);
  if (!r || r.error) { if (btn) btn.disabled = false; showActionToast(r?.error || 'Не удалось заблокировать устройство'); return; }
  showActionToast('Устройство заблокировано');   // кнопка у всех устройств сменится по событию message_edited
}
function renderMsgIRC(m, isFirst = true, isTail = true, isChatGroup = true) {
  if (m.status && m.id > 0) S.msgStatus[m.id] = { ...m.status };
  const isSystem = m.sender_username === '__system__';
  if (m.id > 0 && !isSystem) S.msgData.set(m.id, { forwardData: m.forward_data || null, senderId: m.sender_id, senderName: m.sender_name, senderIsBot: !!m.sender_is_bot, text: m.text, attachment: m.attachment, linkPreview: m.link_preview || null });
  if (m.id > 0 && S.secretChatIds.has(m.chat_id)) S.scMsgObjs.set(m.id, m);
  const mine = m.sender_id===S.user.id;
  const time = fmtTime(m.sent_at);
  const isDeleted = m.deleted;

  if (isSystem && !isDeleted) {
    // Изменение состава группы/комнаты — не объявление (без колокольчика):
    // своя пара иконка+цвет на добавление/удаление участника
    const isMemberAdd = m.system_kind === 'member_add';
    const isMemberRemove = m.system_kind === 'member_remove';
    const pillStyle = isMemberAdd
      ? 'background:linear-gradient(var(--accent-soft),var(--accent-soft)) var(--chat-bg);border:1px solid var(--role-teal-border);'
      : isMemberRemove
      ? 'background:var(--card-bg);border:1px solid var(--border);'
      : 'background:linear-gradient(rgba(210,55,55,.08),rgba(210,55,55,.08)) var(--chat-bg);border:1px solid rgba(210,55,55,.2);';
    const iconSvg = isMemberAdd
      ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>'
      : isMemberRemove
      ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/>'
      : '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
    return `<div class="irc-msg" data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}" data-on-contextmenu="__h21" style="padding:2px 0">
      <div style="width:100%;display:flex;justify-content:center;padding:0 20px;box-sizing:border-box">
        <div style="${pillStyle}border-radius:14px;padding:5px 14px;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:6px;max-width:80%">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.7">${iconSvg}</svg>
          <span style="word-break:break-word">${esc(m.text)}</span>
          <span style="font-size:10px;opacity:.4;flex-shrink:0;margin-left:2px">${time}</span>
        </div>
      </div>
    </div>`;
  }

  const isSecretChat = S.secretChatIds?.has(m.chat_id);
  const scDecryptedText = isSecretChat ? S.scDecrypted?.get(m.id) : undefined;
  const scLocked = isSecretChat && scDecryptedText === undefined && !isDeleted && !isSystem;
  const effectiveText = scLocked ? null : (isSecretChat ? (scDecryptedText ?? '') : m.text);
  // Блок кода или превью ссылки: пузырь собирается из частей (см. bubbleBody). Секретные чаты и боты — как обычно
  const lp = (!isDeleted && !isSecretChat && !m.sender_is_bot) ? (m.link_preview || null) : null;
  const comp = (!isDeleted && !isSecretChat && !m.sender_is_bot && typeof m.text === 'string' && (lp || Fmt.hasCode(m.text)))
    ? bubbleBody(m.text, lp, m.edited_at) : null;
  const bodyText0 = isDeleted ? '<em class="irc-deleted">Сообщение удалено</em>'
    : scLocked ? SC.skeletonHtml(m.text)
    : m.sender_is_bot ? effectiveText + (m.edited_at ? ' <span class="edited-tag">изм.</span>' : '') : linkifyText(effectiveText) + (m.edited_at?` <span class="edited-tag">изм.</span>`:'');
  const bodyText = bodyText0 + (isDeleted ? '' : msgActionsHtml(m));
  const statusIcon = mine && !isDeleted ? renderStatus(m.status) : '';
  const reactionsHtml = isDeleted ? '' : renderReactions(m.id);
  const senderName = esc(m.sender_name);
  const avColor = userAvatarColor(m.sender_id, m.sender_tag);
  // аватарка 32px вмещает обе буквы; обрезка до одной осталась от прежних 28px
  const avLetter = initials(m.sender_name);
  const avImg = `<img src="${httpProto()}://${S.server}/api/users/${m.sender_id}/avatar" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" data-on-error="__h22">`;
  const rAtt = m.reply_attachment;
  const rIsImg = rAtt?.mime?.startsWith('image/');
  const rIsVideo = rAtt?.mime?.startsWith('video/');
  const rThumbHtml = rAtt && !m.reply_deleted ? ((rIsImg || (rIsVideo && rAtt.thumb))
    ? `<img src="${httpProto()}://${S.server}${rAtt.thumb || rAtt.url}" class="irc-reply-thumb" data-on-error="__h22">`
    : `<div class="irc-reply-thumb irc-reply-file"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg></div>`
  ) : '';
  const rTextRaw = m.reply_deleted
    ? 'Сообщение удалено'
    : isSecretChat
    ? (S.scDecrypted.get(m.reply_to_id) ?? 'Зашифровано')
    : (m.reply_text || (rAtt ? (rIsImg ? '📷 Фото' : rIsVideo ? '🎬 Видео' : ('📎 ' + (rAtt.name || 'Файл'))) : ''));
  // цвет цитаты берём у автора цитируемого: своё — цветом своего пузыря,
  // чужое — цветом его тега. Стрелка не нужна: полоса слева и так читается.
  const _replyTagCls = senderNameClass(m.reply_sender_tag);
  const replyCls = m.reply_sender_id === S.user.id
    ? 'reply-mine'
    : 'reply-' + (_replyTagCls === 'default' ? 'plain' : _replyTagCls);
  const replyHtml = m.reply_to_id ? `
    <div class="irc-reply ${replyCls}" data-on-click="scrollToMsg" data-a-click="${esc(JSON.stringify([m.reply_to_id]))}">
      ${rThumbHtml}
      <div class="irc-reply-body">
        <div class="irc-reply-name">${esc(m.reply_sender_name || '')}</div>
        <div class="irc-reply-text">${m.reply_sender_is_bot ? (rTextRaw || '') : mdLite(esc(Fmt.noCode(rTextRaw || '')))}</div>
      </div>
    </div>` : '';

  const fd = m.forward_data;
  const forwardHtml = (!isDeleted && fd) ? (() => {
    // Пересланное вложение показывается превью, как обычное, под шапкой «Переслано от»
    const fa = fd.attachment, fdAtt = fa ? attachBlockHtml(fa) : '';
    const fdText = fd.text || (fa && !fdAtt ? '📎 ' + (fa.name || 'Файл') : '');
    return `<div class="irc-reply irc-forward-block"><div class="irc-reply-body"><div class="irc-reply-name">Переслано от ${esc(fd.name || '')}</div>${fdText ? `<div class="irc-reply-text">${fd.is_bot ? fdText : mdLite(esc(Fmt.noCode(fdText)))}</div>` : ''}</div></div>${fdAtt}`;
  })() : '';

  const actionsHtml = '';

  // аватарка есть у каждого сообщения — CSS показывает её только у последнего в серии
  const avCol = `<div class="irc-av av av-round ${avColor}" style="position:relative;flex-shrink:0">${avLetter}${avImg}</div>`;

  const ircTagHtml = m.sender_tag ? rolePillHtml(m.sender_tag) : '';
  const senderCls = senderNameClass(m.sender_tag);
  // имя и тег стоят над пузырём; у своих и внутри серии их скрывает CSS
  const header = `<div class="irc-header">
      <span class="irc-name msg-sender-name ${senderCls}${mine?' mine':''}" data-on-click="__h24" data-a-click="${esc(JSON.stringify([m.sender_id]))}">${senderName}</span>${ircTagHtml}
    </div>`;
  const fwdN = isDeleted ? 0 : (Number(m.forward_count) || 0);   // пересылали: в конце текста резервируется место под отметку
  const metaHtml = `<div class="irc-meta">${fwdMarkHtml(m)}<span class="status-wrap">${statusIcon}</span><span class="irc-time">${time}</span></div>`;

  const scAttMeta = isSecretChat ? S.scAtt.get(m.id) : null;
  const att = isSecretChat
    ? (m.attachment ? { url: m.attachment.url, enc: 1, expired: m.attachment.expired, fiv: m.attachment.fiv, size: scAttMeta?.s, name: scAttMeta?.n, mime: scAttMeta?.m } : null)
    : m.attachment;
  let attachHtml = '';
  if (!isDeleted && att?.enc && !att.expired) attachHtml = scAttachHtml(m, att);
  else if (!isDeleted) attachHtml = attachBlockHtml(att);

  const attDataAttrs = (att?.url && !att.enc) ? ` data-msg-att-url="${esc(att.url)}" data-msg-att-thumb="${esc(att.thumb||'')}" data-msg-att-mime="${esc(att.mime||'')}" data-msg-att-name="${esc(att.name||'')}"` : '';
  // пузырь, в котором нет ничего кроме картинки: кадр занимает его целиком, а время
  // и реакции ложатся поверх. С подписью, цитатой или пересылкой — обычное поведение
  const bareImage = !isDeleted && !m.text && !m.reply_to_id && !m.forward_data
    && ((!!att?.url && !att.expired && (att.more?.length ? attAllMedia(att) : !!(att.mime?.startsWith('image/') || att.mime?.startsWith('video/')))) || !!att?.gif);
  // сообщение из одного смайлика показываем без пузыря — он проступает по наведению
  // В секретном чате m.text — шифротекст, смотреть нужно на расшифрованное
  const emojiOnly = !isDeleted && !m.attachment && !m.reply_to_id && !m.forward_data && isEmojiOnly(isSecretChat ? scDecryptedText : m.text);
  // Фото с подписью: пузырь по ширине кадра (как в Telegram), а не всегда 280 px; кадр показывается целиком
  const _fitD = (!bareImage && !comp && att?.url && !att.expired && !att.enc && !att.gif && !att.more?.length && /^(image|video)\//.test(att.mime || '')) ? szOf(att, `${httpProto()}://${S.server}${att.url}`) : null;
  const _fitW = _fitD ? Math.max(180, Math.min(280, Math.round(360 * _fitD[0] / _fitD[1]))) : 0;
  const posCls = (isFirst ? ' irc-first' : '') + (isTail ? ' irc-tail' : '') + (emojiOnly ? ' emoji-msg' : '');

  return `<div class="irc-msg${posCls}${m._optimistic?' msg-optimistic':''}${m._state==='failed'?' msg-failed':''}"${m._cid?` data-cid="${m._cid}"`:''}${mine?` data-mine="1"`:``}${isChatGroup?'':' data-dm="1"'} data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}"${attDataAttrs}${m._optimistic?' data-optimistic="1"':''}
    data-on-contextmenu="${isDeleted ? 'ctxNoop' : 'showCtxMenu'}" data-a-contextmenu="${esc(JSON.stringify(isDeleted ? [] : ['__event', m.id, m.sent_at, mine]))}"
    data-on-dblclick="${isDeleted ? 'noop' : 'dblReply'}" data-a-dblclick="${esc(JSON.stringify(isDeleted ? [] : [m.id]))}">
    <div class="irc-content">
      ${header}
      <div class="bubble-row">
        ${avCol}
        <div class="msg-bubble${bareImage ? ' bubble-photo' : ''}${_fitW ? ' bubble-fit' : ''}${emojiOnly ? ' bubble-emoji' : ''}${comp ? comp.cls : ''}${fwdN ? ' has-fwd' : ''}"${(fwdN || _fitW) ? ` style="${fwdN ? `--fwd-w:${fwdReserve(fwdN)}px;` : ''}${_fitW ? `--bw:${_fitW}px` : ''}"` : ''}>
          ${comp ? `${comp.lpHtml}${(m.reply_to_id || fd) ? `<div class="ct-pad">${replyHtml}${forwardHtml}</div>` : ''}${attachHtml}${comp.html}` : `${replyHtml}
          ${forwardHtml}
          ${attachHtml}
          ${(isSecretChat ? (scLocked || scDecryptedText) : m.text) || isDeleted ? `<div class="irc-text${isDeleted?' irc-deleted':''}${emojiOnly?' emoji-only':''}${scLocked?' sc-locked':''}">${bodyText}</div>` : ''}`}
          ${metaHtml}
        </div>
      </div>
      ${reactionsHtml}
      ${m._state==='failed' ? failNoteHtml(m._cid) : ''}
    </div>
    ${actionsHtml}
  </div>`;
}

// Вложение сообщения (и пересланного): картинка, видео, файл, GIF, «файл удалён». Зашифрованные вложения секретных чатов здесь не рисуются
function attachBlockHtml(att) {
  let attachHtml = '';
  if (att?.url && !att.expired && !att.enc && !att.gif && Array.isArray(att.more) && att.more.length) {
    attachHtml = multiAttachHtml(att);
  } else if (att?.url && !att.expired && !att.enc) {
    const attUrl = `${httpProto()}://${S.server}${att.url}`;
    if (att.mime?.startsWith('image/')) {
      const _sz = szAttrs(att, attUrl);
      attachHtml = `<div class="bubble-image${_sz.cls}"${_sz.st} data-lb-url="${attUrl}" data-lb-name="${esc(att.name||'image')}" data-lb-type="image" data-on-click="openLightboxEl" data-a-click='["__this"]'><img src="${httpProto()}://${S.server}${imgPreviewPath(att)}" loading="lazy"></div>`;
    } else if (att.mime?.startsWith('video/')) {
      const posterUrl = att.thumb ? `${httpProto()}://${S.server}${att.thumb}` : '';
      const safeVName = (att.name||'video').replace(/'/g,"\\'");
      const _szv = szAttrs(att, attUrl);
      attachHtml = `<div class="bubble-image bubble-video${_szv.cls}"${_szv.st} data-lb-url="${attUrl}" data-lb-name="${esc(att.name||'video')}" data-lb-type="video" data-on-click="openLightboxEl" data-a-click='["__this"]'>
        ${posterUrl ? `<img src="${posterUrl}" loading="lazy">` : `<video src="${attUrl}" preload="metadata" muted></video>`}
        <div class="bubble-video-play"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg></div>
      </div>`;
    } else {
      const sizeFmt = att.size ? (att.size > 1048576 ? (att.size/1048576).toFixed(1)+' МБ' : Math.round(att.size/1024)+' КБ') : '';
      attachHtml = `<div class="bubble-file" data-on-click="downloadAttachment" data-a-click="${esc(JSON.stringify([attUrl, att.name||'file']))}">
        <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        <div class="bubble-file-info"><div class="bubble-file-name">${esc(att.name||'Файл')}</div>${sizeFmt?`<div class="bubble-file-size">${sizeFmt}</div>`:''}</div>
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      </div>`;
    }
  }
  if (att?.gif) attachHtml = GifKlipy.messageHtml(att);   // GIF из Klipy: ссылки на ролик, файла у нас нет
  if (att?.url && att.expired) attachHtml = `<div class="irc-text irc-deleted"><em>Файл удалён</em></div>`;
  // Вложение с другого сервера, которое у нас не приняли (размер или формат по настройкам этого сервера) или не удалось получить
  if (att?.unavailable) attachHtml = `<div class="irc-text irc-deleted"><em>${att.unavailable === 'policy' ? 'Вложение недоступно: не соответствует настройкам сервера' : 'Вложение не удалось получить'}</em></div>`;
  return attachHtml;
}

function renderStatus(status) {
  if (!status) return '';
  const { delivered, read, total } = status;
  if (total === 0) return '';
  let cls, title;
  // Обе галочки цветные — только когда прочитали ВСЕ получатели; если прочитал хотя бы один —
  // цветная одна (status-part, первая галочка); только доставлено — обе серые.
  if (read >= total)      { cls = 'status-read';       title = 'Прочитано'; }
  else if (read > 0)      { cls = 'status-part';       title = `Прочитано ${read} из ${total}`; }
  else if (delivered > 0) { cls = 'status-delivered';  title = 'Доставлено'; }
  else                    { cls = 'status-sent';        title = 'Отправлено'; }
  const double = delivered > 0 || read > 0;
  return `<span class="msg-status ${cls}" title="${title}">
    <svg width="13" height="9" viewBox="0 0 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${double
        ? '<polyline class="tk1" points="1,5.5 3.5,8 9,1"/><polyline points="7,5.5 9.5,8 15,1"/>'
        : '<polyline points="7,5.5 9.5,8 15,1"/>'}
    </svg>
  </span>`;
}

// Умный скролл к низу после появления сообщения: своё — всегда, чужое — если
// пользователь у дна.
//
// Одной прокрутки мало. Размеры картинки известны только после её загрузки, а
// плавная прокрутка целится в высоту ленты, снятую в момент вызова. Пока она
// летит, пузырь дорастает — и лента останавливается ровно на высоту картинки
// выше нужного: сообщение с фото остаётся под полем ввода, тогда как обычное
// встаёт на место всегда. Поэтому после прокрутки ещё пару секунд держим дно и
// возвращаемся туда на каждое изменение высоты — так же, как якорь держит ленту
// при открытии чата. Тронул прокрутку сам — отпускаем, иначе будет «отскок».
let _stickRO = null, _stickTimer = null, _stickBehavior = 'smooth';

function _stickDown() {
  const c = document.getElementById('messages');
  if (c) c.scrollTo({ top: c.scrollHeight, behavior: _stickBehavior });
}
function _stickKey(e) { if (SCROLL_KEYS.includes(e.key)) releaseStick(); }

function releaseStick() {
  clearTimeout(_stickTimer);
  _stickTimer = null;
  _stickRO?.disconnect(); _stickRO = null;
  const c = document.getElementById('messages');
  c?.removeEventListener('load', _stickDown, true);
  c?.removeEventListener('loadedmetadata', _stickDown, true);
  c?.removeEventListener('error', _stickDown, true);
  c?.removeEventListener('wheel', releaseStick);
  c?.removeEventListener('touchmove', releaseStick);
  window.removeEventListener('keydown', _stickKey);
}

function stickToBottom(container, newEl, m, distBefore) {
  // Отступ от низа берём ДО вставки сообщения: иначе высокое вложение (картинка)
  // само же выталкивает dist за порог, и автопрокрутка не срабатывает —
  // сообщение остаётся под полем ввода.
  const dist = distBefore !== undefined ? distBefore
    : container.scrollHeight - container.scrollTop - container.clientHeight;
  if (!(m._optimistic || dist < 120)) return;
  _stickBottom = true;
  releaseStick();
  _stickBehavior = m._optimistic ? 'instant' : 'smooth';
  // На телефоне высота ленты доводится после кадра (клавиатура, visualViewport)
  requestAnimationFrame(_stickDown);

  try {
    // Растёт само сообщение: картинка получила размеры, подтянулась цитата.
    // Первую выдачу наблюдателя пропускаем — высота ещё та же, а лишняя
    // прокрутка сбила бы уже идущую плавную.
    let h = newEl ? newEl.getBoundingClientRect().height : 0;
    _stickRO = new ResizeObserver(() => {
      const now = newEl.getBoundingClientRect().height;
      if (Math.abs(now - h) < 0.5) return;
      h = now;
      _stickDown();
    });
    if (newEl) _stickRO.observe(newEl);
  } catch {}

  // load не всплывает — слушаем на перехвате: так ловятся и вложенные картинки,
  // и аватарки, и те, что появятся позже. loadedmetadata — тот же случай для видео:
  // до него высота бабла по умолчанию 2:1, после — по реальным пропорциям ролика
  container.addEventListener('load', _stickDown, true);
  container.addEventListener('loadedmetadata', _stickDown, true);
  container.addEventListener('error', _stickDown, true);

  // Прокрутка руками отменяет удержание
  container.addEventListener('wheel', releaseStick, { passive: true });
  container.addEventListener('touchmove', releaseStick, { passive: true });
  window.addEventListener('keydown', _stickKey);
  _stickTimer = setTimeout(releaseStick, 2500);
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
  // Разметку строим один раз: полторы тысячи кнопок разбирать заново на каждый
  // показ — те же миллисекунды, что были у панели композера
  if (!picker.firstChild) {
    picker.innerHTML =
      '<div class="ep-search">' + "<svg viewBox=\"0 0 24 24\" stroke=\"currentColor\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"11\" cy=\"11\" r=\"8\"/><path d=\"m21 21-4.3-4.3\"/></svg>" +
        '<input id="rp-search-input" placeholder="Поиск смайла" autocomplete="off"' +
        ' data-on-input="__h25"></div>' +
      '<div class="ep-tabs" id="rp-tabs">' + emojiTabsHtml('rp') + '</div>' +
      '<div class="ep-scroll" id="rp-scroll" data-on-scroll="__h26"></div>';
  }
  // «Часто используемые» меняются от нажатий — сверяем и пересобираем при сдвиге
  const scroll = document.getElementById('rp-scroll');
  const freq = emojiSections()[0].items.join('');
  if (!scroll.firstChild || scroll.dataset.freq !== freq) {
    scroll.innerHTML = emojiPickerCached('rp');
    scroll.dataset.freq = freq;
  }
  const search = document.getElementById('rp-search-input');
  if (search) search.value = '';
  scroll.scrollTop = 0;
  picker.style.left = '-9999px'; picker.style.top = '-9999px';
  popShow(picker);
  picker.classList.add('open');
  // Выбранная вкладка считается по размерам прокрутки, поэтому только когда панель уже показана
  // (скрытая, она даёт нулевую высоту, и подсвечивался последний раздел)
  syncEmojiTabs('rp');
  // Размер панели переводим в те же единицы, что style.left/top
  const _pr = picker.getBoundingClientRect(), _mk = zoomMetrics().k;
  const pw = _pr.width / _mk, ph = _pr.height / _mk;
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
  hideReactionPicker();
  sendReaction(S.ctx.messageId, reaction);
}

function hideReactionPicker() {
  const p = document.getElementById('reaction-picker');
  popHide(p, () => p.classList.remove('open'));
}

// ── SEND / EDIT ──
// ── @MENTION AUTOCOMPLETE ──
let _mentionIdx = -1;

function _getMentionQuery(el) {
  const m = Fmt.textBeforeCaret(el).match(/@(\S*)$/);
  return m ? m[1] : null;
}
function _mentionMembers(includeSelf = false) {
  const chat = S.chats.find(c => c.id === S.activeChatId);
  if (!['group', 'room', 'direct'].includes(chat?.type)) return null;
  const members = chat.members || [];
  return includeSelf ? members : members.filter(m => m.id !== S.user.id);
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
  popShow(popup);
  _mentionIdx = -1;
  popup.innerHTML = filtered.map(m =>
    `<div class="mention-item" data-name="${esc(m.display_name||m.username)}" data-on-click="insertMention" data-a-click="${esc(JSON.stringify([`${esc(m.display_name||m.username)}`]))}">
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
  if (p) popHide(p, () => { p.style.display = 'none'; p.innerHTML = ''; });
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
// Клик по имени автора над сообщением — вставляет @Имя в поле ввода в текущей
// позиции курсора, независимо от того, что там уже набрано (в отличие от
// insertMention, которая довершает уже начатый ввод «@часть_имени» из поповера)
function mentionUserInComposer(senderId) {
  const el = document.getElementById('msg-input');
  const u = senderId === S.user.id ? S.user : S.allUsers.find(u => u.id === senderId);
  const name = u?.display_name || u?.username;
  if (!el || !name) return;
  const before = Fmt.textBeforeCaret(el);
  const needsSpace = before && !/\s$/.test(before);
  Fmt.insertText(el, (needsSpace ? ' ' : '') + '@' + name + ' ');
}

function insertMention(name) {
  const el = document.getElementById('msg-input');
  if (!el) return;
  const m = Fmt.textBeforeCaret(el).match(/@(\S*)$/);
  if (!m) return;
  Fmt.replaceBefore(el, m[0].length, '@' + name + ' ');
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
  // Блок кода и сочетания Ctrl/Cmd+B, I, E обрабатывает поле само
  if (Fmt.keydown(e, e.currentTarget || document.getElementById('msg-input'))) return;
  if (e.key==='Enter'&&(!e.shiftKey || e.ctrlKey || e.metaKey)){ e.preventDefault(); sendOrEdit(); }
}

// Бар папок (в веб-клиенте нет учётных записей, только папки)
function renderRail() {
  const rail = document.getElementById('acc-rail');
  if (!rail) return;
  const hasSp = typeof spacesRailShown === 'function' && spacesRailShown();
  const show = (S.folders || []).length > 0 || hasSp;
  rail.hidden = !show;
  // Внизу бара — свой аватар со статусом (как в макете); по нажатию открывается профиль
  const me = S.user ? `<button type="button" class="rail-me" title="Профиль" aria-label="Профиль" data-on-click="openProfile" data-a-click="${esc(JSON.stringify([S.user.id]))}"><span class="av-wrap"><span class="av av-round ${userAvatarColor(S.user.id, S.user.tag)}" data-av-user="${S.user.id}">${esc(initials(S.user.display_name || S.user.username || '?'))}</span><i class="presence-dot"></i></span></button>` : '';
  rail.innerHTML = show ? (hasSp ? spacesRailHtml(false) : '') + foldersRailHtml(hasSp) + me : '';
  if (show) { foldersRailFit(); applyAvatars(); }
}

// ── ФОРМАТИРОВАНИЕ И ПРЕВЬЮ ССЫЛКИ В ПОЛЕ ВВОДА ──
// Панель форматирования, превью набранного и превью ссылки — выдвижная часть поля (composer-slot).
// Стоят над самим полем, как ответ и вложение; открывать и закрывать их можно независимо
const CMP = { fmt: false, prev: false, lw: null };

function initComposerFmt() {
  const el = document.getElementById('msg-input');
  if (!el) return;
  CMP.fmt = false; CMP.prev = false;      // панель форматирования не переходит из чата в чат
  Fmt.init(el);
  CMP.lw = Fmt.linkWatch({
    getText: () => el.value,
    fetchPreview: async url => S.secretChatIds.has(S.activeChatId) ? null : ((await api('GET', '/preview?url=' + encodeURIComponent(url)))?.preview || null),
    onChange: p => paintLinkPreview(p),
  });
  syncFmt();
  document.addEventListener('selectionchange', fmtSelChange);
}
function fmtSelChange() {
  const el = document.getElementById('msg-input');
  if (!el) { document.removeEventListener('selectionchange', fmtSelChange); return; }
  if (CMP.fmt && document.activeElement === el) syncFmtState();
}
// Вызывается из onMsgInput: текст изменился
// Отступы поля ввода сверху и снизу — только когда в нём две строки и больше
function cmpMulti() {
  const el = document.getElementById('msg-input');
  el?.closest('.composer-field-row')?.classList.toggle('multi', !!el && el.offsetHeight > 24);
}
function cmpInput() {
  cmpMulti();
  CMP.lw?.check();
  if (CMP.fmt) { syncFmtState(); paintFmtPreview(); }
}
function toggleUpMenu(e) {
  e?.stopPropagation();
  const m = document.getElementById('up-menu');
  if (!m) return;
  if (m.hidden || m._popOut) { popShow(m); m.hidden = false; document.getElementById('up-btn')?.setAttribute('aria-expanded', 'true'); }
  else closeUpMenu();
  document.getElementById('up-fmt')?.classList.toggle('on', CMP.fmt);
}
function closeUpMenu() {
  const m = document.getElementById('up-menu');
  if (m && !m.hidden && !m._popOut) { popHide(m, () => { m.hidden = true; }); document.getElementById('up-btn')?.setAttribute('aria-expanded', 'false'); }
}
document.addEventListener('click', e => { if (!e.target.closest('#up-menu, #up-btn')) closeUpMenu(); });
function upPickFile() { closeUpMenu(); pickFile(); }
function upToggleFmt() {
  closeUpMenu();
  CMP.fmt = !CMP.fmt;
  syncFmt();
  if (CMP.fmt) document.getElementById('msg-input')?.focus();
}
function syncFmt() {
  cmpMulti();
  const bar = document.getElementById('fmt-bar'), prev = document.getElementById('fmt-prev');
  if (bar) bar.style.display = CMP.fmt ? '' : 'none';
  if (prev) prev.style.display = (CMP.fmt && CMP.prev) ? '' : 'none';
  bar?.querySelector('[data-f=prev]')?.classList.toggle('on', CMP.prev);
  if (CMP.fmt) { syncFmtState(); paintFmtPreview(); }
  document.getElementById('up-fmt')?.classList.toggle('on', CMP.fmt);
}
function syncFmtState() {
  const el = document.getElementById('msg-input'), bar = document.getElementById('fmt-bar');
  if (!el || !bar) return;
  const st = Fmt.state(el);
  for (const k of ['b', 'i', 'c', 'blk', 's']) bar.querySelector(`[data-f=${k}]`)?.classList.toggle('on', !!st[k]);
}
function fmtBarClick(e) {
  const b = e.target.closest('[data-f]'); if (!b) return;
  const el = document.getElementById('msg-input'), k = b.dataset.f;
  if (k === 'close') { CMP.fmt = false; syncFmt(); el?.focus(); return; }
  if (k === 'prev') { CMP.prev = !CMP.prev; syncFmt(); return; }
  Fmt.cmd(el, k);
  onMsgInput(el);
}
// Превью набранного сообщения: так его увидят получатели
function paintFmtPreview() {
  const box = document.getElementById('fmt-prev-b');
  if (!box || !CMP.prev) return;
  const el = document.getElementById('msg-input');
  const text = el ? el.value : '';
  if (!text.trim()) { box.innerHTML = '<span class="fmt-prev-empty">Набранный текст появится здесь</span>'; return; }
  const b = bubbleBody(text, CMP.lw?.current() || null, null);
  box.innerHTML = `<div class="msg-bubble fmt-prev-bubble${b.cls}">${b.lpHtml}${b.html}</div>`;
}
function paintLinkPreview(p) {
  const bar = document.getElementById('lprev-bar');
  if (!bar) return;
  if (p) {
    document.getElementById('lprev-title').textContent = p.title || p.site || p.url;
    document.getElementById('lprev-site').textContent = p.site || '';
    const th = document.getElementById('lprev-thumb');
    th.innerHTML = p.image ? `<img src="${httpProto()}://${S.server}${esc(p.image)}" alt="" data-on-error="__h27">` : '';
    th.style.display = p.image ? '' : 'none';
  }
  bar.style.display = p ? '' : 'none';
  paintFmtPreview();
}
function dismissLinkPreview() { CMP.lw?.dismiss(); document.getElementById('msg-input')?.focus(); }

// Тело пузыря из частей: превью ссылки, текст и блоки кода. cls — доп. классы пузыря
// Блок кода и превью занимают пузырь во всю ширину, поэтому такой пузырь собирается без внутренних отступов.
// Последним может быть и блок: тогда время и галочки встают в его нижней полосе
function bubbleBody(text, lp, edited) {
  const ps = Fmt.parts(text);
  const base = `${httpProto()}://${S.server}`;
  const out = [];
  const lpHtml = lp ? Fmt.previewCard(lp, base) : '';
  ps.forEach((p, i) => {
    const last = i === ps.length - 1;
    out.push(p.k === 'c' ? Fmt.codeBlock(p.v, last)
      : `<div class="irc-text ct${last ? ' ct-last' : ''}">${linkifyText(p.v)}${last && edited ? ' <span class="edited-tag">изм.</span>' : ''}</div>`);
  });
  const endsCode = ps.length && ps[ps.length - 1].k === 'c';
  return { lpHtml, html: out.join(''), cls: ' bubble-comp' + (lp ? ' has-lcard' : '') + (endsCode ? ' ends-code' : '') + (!lp && ps.length === 1 && ps[0].k === 'c' ? ' code-only' : ''), endsCode };
}
function openLinkUrl(url) {
  document.getElementById('modal-link').dataset.url = url;
  document.getElementById('link-modal-url').textContent = url;
  openModal('modal-link');
}
// Копирование кода и переход по карточке превью — по нажатию в любом месте окна
document.addEventListener('click', e => {
  if (Fmt.copyClick(e)) return;
  const c = e.target.closest('.lcard[data-fmt-url]');
  if (c) openLinkUrl(c.dataset.fmtUrl);
});

let typingSendTimer = null;

function _updateSendBtn(el) {
  const sendBtn = document.getElementById('send-btn');
  if (!sendBtn) return;
  const hasDraft = el.value.trim().length > 0;
  sendBtn.classList.toggle('ready', hasDraft);
}

// silent=true — восстановление черновика при открытии чата: не шлём typing собеседнику
function onMsgInput(el, silent = false) {
  _updateMentionPopup(el);
  cmpInput();
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

const typingNames = {}; // chatId -> Map(имя -> таймер сброса): в группе могут печатать несколько человек сразу

// «Имя печатает…», «Имя и Имя печатают…», «Имя и ещё N печатают…». withName=false — для шапки личного чата, там имя и так видно
function typingLabel(names, withName) {
  const n = names.length;
  if (n === 1) return withName ? `${names[0]} печатает…` : 'печатает…';
  if (n === 2) return `${names[0]} и ${names[1]} печатают…`;
  return `${names[0]} и ещё ${n - 1} печатают…`;
}
function typingList(chatId) { return [...(typingNames[chatId]?.keys() || [])]; }

// Пока полоса ввода растёт, держим ленту у дна (высота анимируется, лента следует за ней через --composer-h)
function pinMessagesBottomFor(ms) {
  const t0 = performance.now();
  (function step() { pinMessagesBottom(); if (performance.now() - t0 < ms) requestAnimationFrame(step); })();
}

// Подсказка живёт в двух местах: подпись в шапке (вместо «в сети» / «N участников») и строка над полем ввода.
// Лента её не перекрывает: строка входит в высоту полосы ввода, а лента отступает на эту высоту
function renderTyping(chatId) {
  if (chatId !== S.activeChatId) return;
  const names = typingList(chatId), on = names.length > 0;
  const chat = S.chats.find(c => c.id === chatId);
  const stick = atMessagesBottom();
  const head = document.querySelector('.chat-header-info');
  if (head) {
    head.classList.toggle('typing', on);
    const t = head.querySelector('.ch-typing-text');
    if (t && on) t.textContent = typingLabel(names, chat?.type !== 'direct');
  }
  const row = document.getElementById('typing-indicator');
  if (row) {
    row.classList.toggle('show', on);
    const t = row.querySelector('.typing-text');
    if (t && on) t.textContent = typingLabel(names, true);
  }
  if (stick) pinMessagesBottomFor(300);
}

// В списке чатов под названием вместо последнего сообщения
function renderTypingPreview(chatId) {
  const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .ci-last`);
  if (!item) return;
  const names = typingList(chatId);
  if (names.length) {
    if (item.dataset.origText === undefined) item.dataset.origText = item.textContent;
    item.textContent = typingLabel(names, true);
    item.classList.add('typing-preview');
  } else if (item.dataset.origText !== undefined) {
    item.textContent = item.dataset.origText;
    delete item.dataset.origText;
    item.classList.remove('typing-preview');
  }
}

function showTyping(chatId, senderName) {
  const m = typingNames[chatId] || (typingNames[chatId] = new Map());
  clearTimeout(m.get(senderName));
  m.set(senderName, setTimeout(() => clearTyping(chatId, senderName), 5000));
  renderTyping(chatId);
  renderTypingPreview(chatId);
}

// Без имени — сбросить всех (например, при выходе из чата)
function clearTyping(chatId, senderName) {
  const m = typingNames[chatId];
  if (m) {
    for (const [n, t] of [...m]) if (senderName === undefined || n === senderName) { clearTimeout(t); m.delete(n); }
    if (!m.size) delete typingNames[chatId];
  }
  renderTyping(chatId);
  renderTypingPreview(chatId);
}

// Поле ввода растёт само (contenteditable)
function autoResize() {}

// ── Очередь неотправленных сообщений ──
// Нет связи — сообщение остаётся в переписке с пометкой «Не отправлено» и уходит само, когда связь вернётся.
// Повторная отправка идёт с тем же client_id, поэтому сервер не создаёт дубль, если первое всё-таки дошло.
// Очередь хранится и на диске: закрыли приложение без связи — сообщения не пропали.
const _outbox = [];
let _outLoaded = false;
const _outKey = () => `outbox_${S.server}_${S.user?.id}`;
function _outSave() {
  try { localStorage.setItem(_outKey(), JSON.stringify(_outbox.map(({ cid, chatId, payload, temp }) => ({ cid, chatId, payload, temp })))); } catch {}
}
function outboxLoad() {
  if (_outLoaded || !S.user) return;
  _outLoaded = true;
  try {
    JSON.parse(localStorage.getItem(_outKey()) || '[]').forEach(x => { if (x?.cid && x.payload && x.temp) { x.temp._state = 'failed'; _outbox.push(x); } });
  } catch {}
}
const newClientId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const failNoteHtml = cid => `<div class="msg-failnote">Не отправлено · <button type="button" data-on-click="retryOutbox" data-a-click="${esc(JSON.stringify([`${cid}`]))}">Повторить</button> · <button type="button" data-on-click="discardOutbox" data-a-click="${esc(JSON.stringify([`${cid}`]))}">Удалить</button></div>`;
function queueSend(payload, temp) {
  outboxLoad();
  const it = { cid: payload.client_id, chatId: payload.chat_id, payload, temp };
  _outbox.push(it);
  _outSave();
  flushOne(it);
}
function flushOne(it) {
  clearTimeout(it.t);
  if (S.ws?.readyState === 1) {
    S.ws.send(JSON.stringify(it.payload));
    setOutState(it, 'sending');
    it.t = setTimeout(() => { if (_outbox.includes(it)) setOutState(it, 'failed'); }, 20000);
  } else setOutState(it, 'failed');
}
function setOutState(it, st) {
  it.temp._state = st;
  const el = document.querySelector(`.irc-msg[data-cid="${it.cid}"]`);
  if (!el) return;
  el.classList.toggle('msg-failed', st === 'failed');
  el.querySelector('.msg-failnote')?.remove();
  if (st === 'failed') el.querySelector('.irc-content')?.insertAdjacentHTML('beforeend', failNoteHtml(it.cid));
}
function retryOutbox(cid) {
  const it = _outbox.find(x => x.cid === cid);
  if (!it) return;
  if (S.ws?.readyState !== 1) { showActionToast('Нет связи с сервером'); return; }
  flushOne(it);
}
function retryAllOutbox() { outboxLoad(); _outbox.forEach(flushOne); }
function discardOutbox(cid) {
  const i = _outbox.findIndex(x => x.cid === cid);
  if (i < 0) return;
  const [it] = _outbox.splice(i, 1);
  clearTimeout(it.t); _outSave();
  document.querySelector(`.irc-msg[data-cid="${cid}"]`)?.remove();
  const a = it.payload.attachment;
  if (a?.url && !a.gif && !a.enc) [a, ...(a.more || [])].forEach(x => api('DELETE', '/upload', { url: x.url, thumb: x.thumb }));
}
// Сервер принял сообщение: убираем его из очереди и заглушку из переписки
function outboxConfirm(cid) {
  const i = _outbox.findIndex(x => x.cid === cid);
  if (i >= 0) { clearTimeout(_outbox[i].t); _outbox.splice(i, 1); _outSave(); }
  document.querySelector(`.irc-msg[data-cid="${cid}"]`)?.remove();
}
// Сервер отклонил отправку в чат (только чтение, блокировка): неотправленные уже не уйдут никогда
function outboxRejected(chatId) {
  _outbox.filter(x => x.chatId === chatId && x.temp._state === 'sending').forEach(x => discardOutbox(x.cid));
}
// При открытии чата возвращаем в него неотправленное
function outboxShowFor(chatId) {
  outboxLoad();
  _outbox.filter(x => x.chatId === chatId && !document.querySelector(`.irc-msg[data-cid="${x.cid}"]`)).forEach(it => { appendMsg(it.temp); setOutState(it, it.temp._state); });
}

async function sendOrEdit() {
  if (S.editingMessageId) { submitEdit(); return; }
  if (composerLocked(findChatAny(S.activeChatId))) return;
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  const isSecret = S.secretChatIds.has(S.activeChatId);
  if (!text && !_atts.length && !S.forwardMsg) return;
  // Нет соединения — сообщаем и не теряем набранное молча
  if (!S.ws||S.ws.readyState!==1) {
    // Связи нет: сообщение встанет в очередь («Не отправлено») и уйдёт само, когда она вернётся
    if (S.ws && S.ws.readyState >= 2 && S.token) connectWS();
  }
  if (_atts.some(a => a.state !== 'done')) { showActionToast('Дождитесь окончания загрузки'); return; }
  const pendAtt = pendingAttachment();
  let payload, secretAtt = null;
  const sendLp = isSecret ? null : (CMP.lw?.current() || null);
  if (isSecret) {
    S.forwardMsg = null;
    const key = SC.keyOf(S.activeChatId);
    if (!key) { showActionToast('Чат ещё не расшифрован на этом устройстве'); return; }
    secretAtt = pendAtt;
    const sendChatId = S.activeChatId;
    const enc = await SC.encryptText(key, SC.encodePayload(text || '', secretAtt ? { n: secretAtt.name, m: secretAtt.mime, s: secretAtt.size } : null));
    if (S.activeChatId !== sendChatId) { showActionToast('Чат переключён, сообщение не отправлено'); return; }   // ключ и текст относятся к прежнему чату
    payload = { type:'message', chat_id:S.activeChatId, text: enc.text, iv: enc.iv, client_id: newClientId() };
    if (secretAtt) payload.attachment = { url: secretAtt.url, enc: 1, fiv: secretAtt.fiv, size: secretAtt.size };
    if (S.replyTo) payload.reply_to_id = S.replyTo.id;
    _atts = [];   // файл уже уходит в сообщении: clearImagePreview ниже его не тронет
  } else {
    payload = { type:'message', chat_id:S.activeChatId, text: text || '', client_id: newClientId() };
    if (S.replyTo) payload.reply_to_id = S.replyTo.id;
    if (pendAtt) payload.attachment = pendAtt;
    if (S.forwardMsg) payload.forward_data = S.forwardMsg;
    if (sendLp) payload.link_preview = sendLp;
  }

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
    link_preview: sendLp,
    attachment: pendAtt || null,
    status: { delivered: 0, read: 0, total: 1 },
    reactions: [],
    _optimistic: true,
    _cid: payload.client_id,
    _state: 'sending',
  };
  if (isSecret) {
    S.scDecrypted.set(tempMsg.id, text || '');
    if (secretAtt) {
      tempMsg.attachment = { url: secretAtt.url, enc: 1, fiv: secretAtt.fiv, size: secretAtt.size };
      S.scAtt.set(tempMsg.id, { n: secretAtt.name, m: secretAtt.mime, s: secretAtt.size });
    }
  }
  if (!S.chatHasMoreAfter) appendMsg(tempMsg);

  queueSend(payload, tempMsg);
  if (S.chatHasMoreAfter) openChat(S.activeChatId, null, true); // мы были вглуби истории — к последним
  hideReplyBar();
  hideForwardBar();
  clearImagePreview(true);
  // Сообщение ушло — панель смайлов больше не нужна. Закрываем именно здесь, а
  // не в начале: при пустом поле или без связи отправки не было, и панель
  // должна остаться открытой.
  closeEmojiPicker();
  delete S.drafts[S.activeChatId]; saveDrafts(); // черновик отправлен — очищаем
  input.value='';
  CMP.lw?.reset();
  syncFmt();
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.classList.remove('ready');
}

function submitEdit() {
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text || S.secretChatIds.has(S.activeChatId)) { cancelEdit(); return; }
  S.ws.send(JSON.stringify({type:'edit_message', message_id:S.editingMessageId, text, link_preview: CMP.lw?.current() || null}));
  closeEmojiPicker();
  cancelEdit();
}

function cancelEdit() {
  S.editingMessageId = null;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='none';
  hideReplyBar();
  const input = document.getElementById('msg-input');
  if (input) input.value = '';
  CMP.lw?.reset();
  syncFmt();
}

// ── CONTEXT MENU ──
// Меню сообщения для удалённых не открывается: только отменяем системное меню браузера
function ctxNoop(ev) { ev.preventDefault(); }
function noop() {}
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
  document.getElementById('ctx-forward-btn').style.display = S.secretChatIds.has(S.activeChatId) ? 'none' : '';
  document.getElementById('ctx-copy-btn').style.display = '';
  document.getElementById('ctx-edit-btn').style.display = (isMine && S.ctx.canEdit && !S.secretChatIds.has(S.activeChatId)) ? '' : 'none';
  document.getElementById('ctx-delete-btn').style.display = isMine ? '' : 'none';
  const ctxReactEl = menu.querySelector('.ctx-reactions');
  if (ctxReactEl) {
    const _freq = getFreqEmojis(7);
    // Уже поставленная вами реакция подсвечена
    const _mine = new Set([...document.querySelectorAll(`.reaction-btn.mine[data-msg-id="${msgId}"]`)].map(b => b.dataset.reaction));
    ctxReactEl.innerHTML = _freq.map(em=>`<button class="ctx-reaction-btn${_mine.has(em) ? ' mine' : ''}" data-on-click="ctxReact" data-a-click="${esc(JSON.stringify([`${em}`]))}">${em}</button>`).join('')+`<button class="ctx-reaction-btn ctx-reaction-more" data-on-click="showReactionPicker" data-a-click='["__event"]'>→</button>`;
  }
  const _cap = document.getElementById('ctx-cap');
  if (_cap) {
    const _d = new Date(sentAt * 1000), _n = new Date(), _y = new Date(_n.getTime() - 86400000);
    const _day = _d.toDateString() === _n.toDateString() ? 'Сегодня' : _d.toDateString() === _y.toDateString() ? 'Вчера'
      : _d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(_d.getFullYear() !== _n.getFullYear() ? { year: 'numeric' } : {}) });
    const _edited = !!document.querySelector(`[data-msg-id="${msgId}"] .edited-tag`);
    _cap.textContent = `${_day}, ${_d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${_edited ? ' · изменено' : ''}`;
  }
  ctxReadSetup(msgId, isMine);
  popShow(menu);
  menu.classList.add('open');
  placeCtxMenu(menu, e.clientX, e.clientY);
}

function syncCtxSeparators(menu) {
  const kids = [...menu.children];
  // Строка со временем отправки разделителем не считается: у неё своя линия сверху
  const shown = el => el && !el.classList.contains('ctx-sep') && !el.classList.contains('ctx-cap') && el.style.display !== 'none';
  kids.forEach((el, i) => {
    if (!el.classList.contains('ctx-sep')) return;
    const before = kids.slice(0, i).reverse().find(k => shown(k));
    const after = kids.slice(i + 1).find(k => shown(k));
    el.style.display = before && after ? '' : 'none';
  });
}
// Масштаб интерфейса (CSS zoom на <html>) по-разному отражается в координатах: rect и style.left
// живут в одних пикселях, а clientX/clientY и innerWidth — в других. Соотношение зависит от
// версии движка, поэтому не предполагаем его, а меряем пробным fixed-элементом:
//   k — во сколько раз rect больше style (left:100px даёт rect.left = 100k);
//   vw, vh — размер окна в пикселях rect (правый и нижний край пробы при right:0, bottom:0);
//   f — переход из пикселей события (clientX, innerWidth) в пиксели rect.
function zoomMetrics() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:100px;top:100px;right:0;bottom:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(p);
  const r = p.getBoundingClientRect();
  p.remove();
  return { k: r.left / 100 || 1, vw: r.right, vh: r.bottom, f: r.right / window.innerWidth || 1 };
}

function placeCtxMenu(menu, clientX, clientY, anchor) {
  syncCtxSeparators(menu);
  menu.style.left = '-9999px'; menu.style.top = '-9999px';
  // На время замера гасим анимацию появления: во время неё rect уменьшен (scale .96)
  menu.style.animation = 'none';
  const m = zoomMetrics();
  const mr = menu.getBoundingClientRect();
  const w = mr.width, h = mr.height;
  const margin = 6;
  let x, y, fromRight = false, above = false;
  if (anchor) {
    // Меню рядом с кнопкой: правый край по правому краю кнопки, под ней; нет места — над ней
    x = anchor.right - w; fromRight = true;
    y = anchor.bottom + margin;
    if (y + h + margin > m.vh && anchor.top - h - margin >= margin) { y = anchor.top - h - margin; above = true; }
  } else {
    const cx = clientX * m.f, cy = clientY * m.f;
    x = cx; y = cy;
    if (x + w + margin > m.vw) { x = cx - w; fromRight = true; }
    if (y + h + margin > m.vh) { y = cy - h; above = true; }
  }
  // Не выходим за окно ни с одной стороны
  x = Math.max(margin, Math.min(x, m.vw - w - margin));
  y = Math.max(margin, Math.min(y, m.vh - h - margin));
  menu.style.transformOrigin = 'top left'; // положение считано по левому верхнему углу уменьшенного меню
  menu.style.left = (x / m.k) + 'px';
  menu.style.top = (y / m.k) + 'px';
  menu.style.animation = '';
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
  const md = S.msgData.get(msgId);
  // Сообщение с блоком кода копируем исходной разметкой: ограждения ``` сохраняют границы блока
  if (md && !md.senderIsBot && !S.secretChatIds.has(S.activeChatId) && Fmt.hasCode(md.text)) { navigator.clipboard.writeText(md.text).catch(() => {}); return; }
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).catch(() => {});
}

function ctxReply() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const textEl = document.querySelector(`[data-msg-id="${msgId}"] .irc-text`);
  const md = S.msgData.get(msgId);
  const text = (md && !md.senderIsBot && !S.secretChatIds.has(S.activeChatId)) ? Fmt.plain(md.text) : (textEl?.innerText || '');
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
  const displayText = text.trim() || (att ? (att.mime.startsWith('image/') ? '📷 Фото' : att.mime.startsWith('video/') ? '🎬 Видео' : ('📎 ' + (att.name || 'Файл'))) : '');
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
    if (att?.url && (att.mime?.startsWith('image/') || (att.mime?.startsWith('video/') && att.thumb))) {
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

// ── ВЛОЖЕНИЯ (до 10 за раз) ──
// Каждый выбранный файл грузится отдельно и показывается в полосе над полем ввода. В сообщение уходит одно вложение:
// первое файлом, остальные в массиве more (так старые клиенты видят хотя бы первое и ничего не ломается)
let _atts = [];       // { id, kind, name, pct, state ('up' | 'proc' | 'done'), data, xhr, prep, dead, prev }
let _attSeq = 0;
const MAX_ATTACH = 10;
let _uploadSettings = {
  image: { maxSizeMb: 10, extensions: ['jpeg','jpg','png','gif','webp'] },
  video: { maxSizeMb: 50, extensions: ['mp4','mov','webm'] },
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


function pickFile() {
  document.getElementById('file-input')?.click();
}

// Готовое к отправке вложение; null, если вложений нет или что-то ещё грузится
function pendingAttachment() {
  if (!_atts.length || _atts.some(a => a.state !== 'done')) return null;
  const first = _atts[0].data;
  return _atts.length > 1 ? { ...first, more: _atts.slice(1).map(a => a.data) } : first;
}
// Вложение, которое уже есть (GIF из панели): кладём как единственное
function setPendingAttachment(att) {
  _atts.forEach(a => killAtt(a));
  _atts = att ? [{ id: ++_attSeq, kind: '', name: '', pct: 100, state: 'done', data: att, dead: false, prev: '' }] : [];
  renderAttStrip();
}

async function onFilePicked(input) {
  const files = [...(input.files || [])];
  input.value = '';
  await uploadFiles(files);
}


// Подготовка видео на устройстве (HEVC → H.264, shared/video-prep.js): грузим модуль лениво,
// только когда выбрали видео, — это почти 400 КБ, на каждый запуск они ни к чему
let _videoPrepLoad = null;
function loadVideoPrep() {
  if (window.VideoPrep) return Promise.resolve(window.VideoPrep);
  if (!_videoPrepLoad) _videoPrepLoad = new Promise(res => {
    const s = document.createElement('script');
    s.src = '/shared/video-prep.js?v=1';
    s.onload = () => res(window.VideoPrep || null);
    s.onerror = () => { _videoPrepLoad = null; res(null); };
    document.head.appendChild(s);
  });
  return _videoPrepLoad;
}

async function uploadFiles(files) {
  files = (files || []).filter(Boolean);
  if (!files.length) return;
  const isSecret = S.secretChatIds.has(S.activeChatId);
  if (isSecret && (files.length > 1 || _atts.length)) {
    showActionToast('В секретном чате прикрепляется по одному файлу');
    files = _atts.length ? [] : files.slice(0, 1);
  }
  const room = MAX_ATTACH - _atts.length;
  if (files.length > room) { showActionToast(`Можно прикрепить не больше ${MAX_ATTACH} файлов`); files = files.slice(0, room); }
  files.forEach(f => uploadFile(f));
}

async function uploadFile(file) {
  if (!file) return;
  const isSecret = S.secretChatIds.has(S.activeChatId);
  const secretKey = isSecret ? SC.keyOf(S.activeChatId) : null;
  if (isSecret && !secretKey) { showActionToast('Чат ещё не расшифрован на этом устройстве'); return; }
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const cfg = isSecret ? { maxSizeMb: 50, extensions: [] }
    : isImage ? _uploadSettings.image : isVideo ? _uploadSettings.video : _uploadSettings.file;
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (!isVideo && file.size > cfg.maxSizeMb * 1024 * 1024) {
    showActionToast(`Файл слишком большой (макс. ${cfg.maxSizeMb} МБ)`);
    return;
  }
  if (!isSecret && !cfg.extensions.includes(ext)) {
    showActionToast(`Расширение .${ext} не разрешено`);
    return;
  }

  const a = { id: ++_attSeq, kind: isImage ? 'Изображение' : isVideo ? 'Видео' : 'Файл', name: file.name, pct: 0, state: 'up', data: null, xhr: null, prep: null, dead: false,
    prev: isImage && !isSecret ? URL.createObjectURL(file) : '' };
  _atts.push(a);
  renderAttStrip();
  const fail = msg => { if (msg) showActionToast(msg); removeAtt(a.id); };

  if (isVideo && /\.(mov|mp4|m4v)$/i.test(file.name)) {
    const VP = await loadVideoPrep();
    if (a.dead) return;
    if (VP && VP.supported()) {
      const ac = a.prep = new AbortController();
      file = await VP.prepare(file, { signal: ac.signal, onProgress: p => setAttProgress(a, p) });
      a.prep = null;
      if (a.dead) return;
    }
  }
  if (file.size > cfg.maxSizeMb * 1024 * 1024) { fail(`Файл слишком большой (макс. ${cfg.maxSizeMb} МБ)`); return; }

  let formData, endpoint, secretMeta = null;
  if (secretKey) {
    const enc = await scEncryptFileForUpload(file, secretKey);
    if (a.dead) return; // отменили, пока шифровали
    formData = new FormData();
    formData.append('file', enc.blob, 'enc.bin');
    endpoint = '/api/upload?enc=1';
    secretMeta = { fiv: enc.fiv, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
  } else {
    formData = new FormData();
    formData.append('file', file);
    endpoint = '/api/upload';
  }
  const xhr = new XMLHttpRequest();
  a.xhr = xhr;
  xhr.open('POST', `${httpProto()}://${S.server}${endpoint}`);
  xhr.setRequestHeader('Authorization', `Bearer ${S.token}`);
  // Пока тело запроса ещё идёт — честный процент; как только отправка закончилась, а ответа сервера
  // всё ещё нет (например, идёт транскод видео), — «Обработка…», иначе казалось бы, что всё зависло на 100%
  xhr.upload.onprogress = e => { if (e.lengthComputable && !a.dead) setAttProgress(a, Math.round(e.loaded / e.total * 100)); };
  xhr.upload.onload = () => { if (!a.dead) { a.state = 'proc'; paintAtt(a); } };
  xhr.onload = () => {
    a.xhr = null;
    if (a.dead) return;
    if (xhr.status < 200 || xhr.status >= 300) {
      let err = {}; try { err = JSON.parse(xhr.responseText); } catch {}
      fail(err.error || 'Ошибка загрузки');
      return;
    }
    let resp; try { resp = JSON.parse(xhr.responseText); } catch { fail('Ошибка загрузки'); return; }
    a.data = secretMeta ? { ...resp, enc: 1, ...secretMeta } : resp;
    a.state = 'done';
    renderAttStrip();
  };
  xhr.onerror = () => { a.xhr = null; if (!a.dead) fail('Ошибка загрузки'); };
  xhr.send(formData);
}

// Полоса вложений над полем: миниатюры с крестиками и полоской загрузки у каждой
function renderAttStrip() {
  const bar = document.getElementById('image-preview-bar');
  const list = document.getElementById('att-list');
  if (!bar || !list) return;
  const n = _atts.length;
  bar.style.display = n ? '' : 'none';
  const allImgs = _atts.every(a => a.kind === 'Изображение');
  const title = document.getElementById('attach-preview-title');
  if (title) title.textContent = n === 1 ? (_atts[0].kind === 'Изображение' ? 'Изображение' : _atts[0].kind || 'Вложение') : allImgs ? `${n} изображений` : `Вложений: ${n}`;
  const fileIco = '<svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';
  list.innerHTML = _atts.map(a => {
    const thumb = a.prev || (a.state === 'done' && a.data && !a.data.enc && a.data.thumb ? `${httpProto()}://${S.server}${a.data.thumb}` : '');
    return `<div class="att-item ${a.state}" data-att-id="${a.id}" title="${esc(a.name || '')}">${thumb ? `<img src="${esc(thumb)}" alt="">` : `<span class="att-file">${fileIco}<small>${esc((a.name || '').slice(-14))}</small></span>`}`
      + (a.state === 'done' ? '' : `<div class="att-prog"><i style="width:${a.pct}%"></i><span>${a.state === 'proc' ? '…' : a.pct + '%'}</span></div>`)
      + `<button type="button" class="att-x" data-on-click="removeAtt" data-a-click="${esc(JSON.stringify([a.id]))}" aria-label="Убрать"><svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>`;
  }).join('') + (n && n < MAX_ATTACH && !S.secretChatIds.has(S.activeChatId) ? '<button type="button" class="att-add" data-on-click="pickFile" title="Добавить ещё" aria-label="Добавить ещё"><svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>' : '');
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.classList.toggle('ready', n > 0 || !!document.getElementById('msg-input')?.value.trim());
  
}
function paintAtt(a) {
  const p = document.querySelector(`.att-item[data-att-id="${a.id}"] .att-prog`);
  if (!p) return;
  p.firstChild.style.width = a.pct + '%';
  p.lastChild.textContent = a.state === 'proc' ? '…' : a.pct + '%';
}
function setAttProgress(a, pct) { a.pct = pct; paintAtt(a); }

// Остановить загрузку; уже загруженный, но не отправленный файл удаляется и с сервера
function killAtt(a, keepServerFile) {
  a.dead = true;
  if (a.prep) { try { a.prep.abort(); } catch {} a.prep = null; }
  if (a.xhr) { try { a.xhr.abort(); } catch {} a.xhr = null; }
  else if (!keepServerFile && a.state === 'done' && a.data?.url && !a.data.gif) api('DELETE', '/upload', { url: a.data.url, thumb: a.data.thumb });
  if (a.prev) { URL.revokeObjectURL(a.prev); a.prev = ''; }
}
function removeAtt(id) {
  const i = _atts.findIndex(a => a.id === id);
  if (i < 0) return;
  const [a] = _atts.splice(i, 1);
  killAtt(a);
  renderAttStrip();
}
// keepServerFiles — после отправки: файлы уже принадлежат сообщению, с сервера их не трогаем
function clearImagePreview(keepServerFiles) {
  _atts.forEach(a => killAtt(a, keepServerFiles === true));
  _atts = [];
  renderAttStrip();
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn && !document.getElementById('msg-input')?.value.trim()) sendBtn.classList.remove('ready');
}

function showSystemAnnouncement(text) {
  let modal = document.getElementById('announcement-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'announcement-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center';
    modal.innerHTML = `<div id="announcement-card" style="background-color:var(--modal-bg);background-image:linear-gradient(rgba(210,55,55,.14),rgba(210,55,55,.14));border-radius:24px;padding:26px 24px 24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3);border:1px solid rgba(210,55,55,.22)">
      <div class="announcement-title">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--danger-bg);border:1px solid var(--danger-border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="var(--danger)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        </div>
        Системное объявление
      </div>
      <div id="announcement-text" style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap"></div>
      <button data-on-click="closeSystemAnnouncement" style="margin-top:16px;width:100%;height:36px;padding:0;background:var(--accent);color:#0c0e10;border:none;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer">OK</button>
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
    <svg class="ann-banner-icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
    <span class="ann-banner-text"></span>
    <button class="ann-banner-close" title="Скрыть">
      <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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

// ── ЛАЙТБОКС (фото и видео) ──
// Зум/перетаскивание — только у фото; масштаб сбрасывается при каждом открытии.
// _lbDidDrag гасит клик-закрытие сразу после перетаскивания (mouseup всё равно
// порождает click на том же элементе, где было mousedown).
let _lbScale = 1, _lbTx = 0, _lbTy = 0, _lbDrag = null, _lbDidDrag = false;
const LB_ZOOM_MIN = 1, LB_ZOOM_MAX = 4, LB_ZOOM_STEP = 0.5;


// ── Несколько фото и видео в одном сообщении ──
const _PLAY_SVG = '<div class="bubble-video-play"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg></div>';
// Фото в ленте — превью 720 px (/fp/имя), а не миниатюра 320 px (мягкая на экранах с высокой плотностью) и не оригинал в несколько МБ.
// Оригинал открывается только в просмотре. GIF и вложения без обычного имени файла остаются как были
function imgPreviewPath(att) {
  const m = /^\/files\/([\w.\-]+\.(?:jpe?g|png|webp))$/i.exec(att.url || '');
  return m && !/^enc_/.test(m[1]) && !(att.mime || '').includes('gif') ? '/fp/' + m[1] : (att.thumb || att.url);
}
const _isMediaAtt = a => !!a && !!a.url && !a.expired && !a.unavailable && !a.enc && !a.gif && /^(image|video)\//.test(a.mime || '');
function attAll(att) { const { more, ...first } = att; return [first, ...(Array.isArray(more) ? more : [])]; }
function attAllMedia(att) { return attAll(att).every(_isMediaAtt); }
function mediaTileHtml(a, cls) {
  const url = `${httpProto()}://${S.server}${a.url}`;
  const v = (a.mime || '').startsWith('video/');
  const poster = cls === 'bubble-image' && !v ? `${httpProto()}://${S.server}${imgPreviewPath(a)}` : a.thumb ? `${httpProto()}://${S.server}${a.thumb}` : (v ? '' : url);
  const _sz = cls === 'bubble-image' ? szAttrs(a, url) : { cls: '', st: '' };
  return `<div class="${cls}${_sz.cls}"${_sz.st} data-lb-url="${esc(url)}" data-lb-name="${esc(a.name || (v ? 'video' : 'image'))}" data-lb-type="${v ? 'video' : 'image'}" data-on-click="openLightboxEl" data-a-click='["__this"]'>`
    + (poster ? `<img src="${esc(poster)}" loading="lazy">` : `<video src="${esc(url)}" preload="metadata" muted></video>`) + (v ? _PLAY_SVG : '') + '</div>';
}
function fileRowHtml(att) {
  const attUrl = `${httpProto()}://${S.server}${att.url}`;
  if (att.expired) return '<div class="irc-text irc-deleted"><em>Файл удалён</em></div>';
  const sizeFmt = att.size ? (att.size > 1048576 ? (att.size/1048576).toFixed(1)+' МБ' : Math.round(att.size/1024)+' КБ') : '';
  const localPath = typeof _downloadedFiles !== 'undefined' ? _downloadedFiles[attUrl] : null;
  const isDone = !!(window.electron && localPath);
  const safeLocal = (localPath||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const safeUrl = attUrl.replace(/'/g,"\\'");
  const safeName = (att.name||'file').replace(/'/g,"\\'");
  const clickAction = isDone ? ['openDownloadedFile', [localPath]] : ['downloadAttachment', [attUrl, att.name || 'file']];
  const rightEl = isDone
    ? `<span class="bubble-file-open-label">Открыть</span>`
    : `<svg class="dl-icon" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
  return `<div class="bubble-file${isDone?' bubble-file-done':''}" data-att-url="${attUrl}" data-on-click="${clickAction[0]}" data-a-click="${esc(JSON.stringify(clickAction[1]))}">
    <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
    <div class="bubble-file-info"><div class="bubble-file-name">${esc(att.name||'Файл')}</div>${sizeFmt?`<div class="bubble-file-size">${sizeFmt}</div>`:''}</div>
    ${rightEl}
  </div>`;
}
// Сообщение с несколькими вложениями: фото и видео сеткой, остальные файлы строками под ней
function multiAttachHtml(att) {
  const all = attAll(att), media = all.filter(_isMediaAtt), files = all.filter(a => !_isMediaAtt(a));
  let h = '';
  if (media.length === 1) h += mediaTileHtml(media[0], 'bubble-image');
  else if (media.length) h += `<div class="bubble-grid n${Math.min(media.length, 7)}${media.length > 6 ? ' r' + (media.length % 3) : ''}">${media.map(a => mediaTileHtml(a, 'bubble-tile')).join('')}</div>`;
  files.forEach(a => { h += a.unavailable ? `<div class="irc-text irc-deleted"><em>Вложение не удалось получить</em></div>` : fileRowHtml(a); });
  return h;
}
// Просмотр: лента из всех фото и видео открытого чата в порядке показа; у каждого кадра — кто, когда, подпись
function openLightboxEl(el) {
  const root = document.getElementById('messages') || document;
  const els = [...root.querySelectorAll('[data-lb-url]')];
  const items = els.map(e => {
    const msg = e.closest('.irc-msg');
    return {
      url: e.dataset.lbUrl, filename: e.dataset.lbName, type: e.dataset.lbType,
      mid: msg ? +msg.dataset.msgId : 0, senderId: msg ? +msg.dataset.senderId : 0,
      sender: msg?.querySelector('.irc-name')?.textContent?.trim() || '', at: msg ? +msg.dataset.sentAt : 0,
      caption: (msg?.querySelector('.irc-text:not(.irc-deleted)')?.innerText || '').trim().slice(0, 300), mine: !!msg?.dataset.mine,
      total: msg ? msg.querySelectorAll('[data-lb-url]').length : 1, thumb: e.querySelector('img')?.src || '',
    };
  });
  const i = Math.max(0, els.indexOf(el));
  if (!items.length) return;
  openLightbox(items[i].url, items[i].filename, items[i].type, items, i);
}
// «Переслать» и «Удалить» из просмотра: целое сообщение, если оно загружено в чат, иначе только этот кадр
function lbForwardItem(it) {
  if (!it) return;
  const d = it.mid ? S.msgData.get(it.mid) : null;
  const rel = u => (u || '').replace(`${httpProto()}://${S.server}`, '');
  S.forwardMsg = d
    ? (d.forwardData ? { ...d.forwardData } : { user_id: d.senderId, name: d.senderName, text: (d.text || '').slice(0, 200), attachment: d.attachment || null, is_bot: d.senderIsBot || false })
    : { user_id: it.senderId || 0, name: it.sender || '', text: (it.caption || '').slice(0, 200), attachment: { url: rel(it.url), thumb: it.thumb ? rel(it.thumb) : null, name: it.filename || '', mime: it.mime || (it.type === 'video' ? 'video/mp4' : 'image/jpeg'), size: 0 }, is_bot: false };
  if (d && it.mid) S.forwardMsg.src = it.mid;
  openForwardModal();
}
async function lbDeleteItem(it) {
  if (!it || !it.mid || !S.ws) return false;
  const ok = await showConfirm(it.total > 1 ? `Удалить сообщение со всеми вложениями (${it.total})? Оно исчезнет у всех участников.` : 'Удалить сообщение? Оно исчезнет у всех участников.');
  if (!ok) return false;
  S.ws.send(JSON.stringify({ type: 'delete_message', message_id: it.mid }));
  return true;
}

function openLightbox(url, filename, type = 'image', items = null, index = 0) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.onclick = e => { if (e.target === lb && !_lbDidDrag) closeLightbox(); _lbDidDrag = false; };
    lb.innerHTML = `<button type="button" id="lightbox-prev" class="lb-nav lb-prev" title="Назад" data-on-click="__h28">‹</button><button type="button" id="lightbox-next" class="lb-nav lb-next" title="Дальше" data-on-click="__h29">›</button><div id="lightbox-count" class="lb-count"></div><img id="lightbox-img">
      <video id="lightbox-video" controls playsinline></video>
      <div class="lb-zoom">
        <button type="button" title="Уменьшить" data-on-click="__h30"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg></button>
        <button type="button" title="Сбросить масштаб" data-on-click="__h31"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></button>
        <button type="button" title="Увеличить" data-on-click="__h32"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg></button>
      </div>
      <button type="button" id="lightbox-close" title="Закрыть (Esc)" data-on-click="__h33"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      <button id="lightbox-download" title="Скачать" data-on-click="__h34">
        <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      </button>`;
    lb.insertAdjacentHTML('beforeend', `<div class="lb-info" id="lightbox-info"></div>
      <button type="button" id="lightbox-fwd" class="lb-act" title="Переслать" data-on-click="__h35"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></button>
      <button type="button" id="lightbox-del" class="lb-act" title="Удалить" data-on-click="__h36"><svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
      <div class="lb-bottom" id="lightbox-bottom"><div class="lb-cap" id="lightbox-cap"></div><div class="lb-thumbs" id="lightbox-thumbs"></div></div>`);
    document.body.appendChild(lb);
    const lbImg = document.getElementById('lightbox-img');
    lbImg.addEventListener('mousedown', e => {
      if (_lbScale <= 1) return;
      e.preventDefault();
      _lbDrag = { x: e.clientX, y: e.clientY, tx: _lbTx, ty: _lbTy };
    });
    document.addEventListener('mousemove', e => {
      if (!_lbDrag) return;
      const dx = e.clientX - _lbDrag.x, dy = e.clientY - _lbDrag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _lbDidDrag = true;
      _lbTx = _lbDrag.tx + dx; _lbTy = _lbDrag.ty + dy;
      lbApplyTransform();
    });
    document.addEventListener('mouseup', () => { _lbDrag = null; });
    // Пока идёт CSS-анимация появления (lbImgIn), она держит transform с более
    // высоким приоритетом, чем inline-стиль — зум через JS до её конца не сработает.
    // lb-opened гасит правило анимации в CSS сразу после её завершения
    lb.addEventListener('animationend', e => {
      if (e.animationName === 'lbImgIn') lb.classList.add('lb-opened');
    });
  }
  _lbItems = items && items.length ? items : null; _lbIdx = index || 0;
  lbShowNav(lb);
  const img = document.getElementById('lightbox-img');
  const video = document.getElementById('lightbox-video');
  lb.classList.toggle('lb-video', type === 'video');
  lbResetZoom();
  if (type === 'video') {
    img.removeAttribute('src');
    video.src = url;
    video.play().catch(() => {});
  } else {
    video.pause();
    video.removeAttribute('src');
    img.src = url;
  }
  lb.dataset.url = url;
  lb.dataset.filename = filename || (type === 'video' ? 'video' : 'image');
  lb.classList.remove('lb-closing', 'lb-opened');
  lb.classList.add('lb-open');
}

let _lbItems = null, _lbIdx = 0;

function lbWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000), n = new Date(), hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === n.toDateString() ? `сегодня, ${hm}` : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) }) + `, ${hm}`;
}
// Шапка, подпись, миниатюры и кнопки под текущий кадр
function lbPaintMeta() {
  const lb = document.getElementById('lightbox'), it = _lbItems && _lbItems[_lbIdx];
  if (!lb) return;
  const n = _lbItems ? _lbItems.length : 0;
  const info = document.getElementById('lightbox-info');
  if (info) info.innerHTML = it && (it.sender || it.at) ? `<b>${esc(it.sender || '')}</b><span>${esc(lbWhen(it.at))}</span>` : '';
  const cap = document.getElementById('lightbox-cap');
  if (cap) { cap.textContent = it?.caption || ''; cap.style.display = it?.caption ? '' : 'none'; }
  const th = document.getElementById('lightbox-thumbs');
  if (th) {
    if (n > 1) {
      const from = Math.max(0, Math.min(_lbIdx - 10, n - 21)), to = Math.min(n, from + 21);
      th.innerHTML = _lbItems.slice(from, to).map((x, k) => `<i class="${from + k === _lbIdx ? 'on' : ''}" style="background-image:url('${esc(x.thumb || x.url)}')" data-on-click="__h37" data-a-click="${esc(JSON.stringify([from + k]))}"></i>`).join('');
      th.style.display = '';
    } else th.style.display = 'none';
  }
  const canFwd = !!it && !!it.mid && !S.secretChatIds.has(S.activeChatId), canDel = !!it && !!it.mine && !!it.mid;
  const f = document.getElementById('lightbox-fwd'), d = document.getElementById('lightbox-del');
  if (f) f.style.display = canFwd ? '' : 'none';
  if (d) d.style.display = canDel ? '' : 'none';
  lb.classList.toggle('lb-meta', !!it && (!!it.sender || !!it.caption || n > 1));
}
function lbGo(i) { if (_lbItems && i >= 0 && i < _lbItems.length) lbNav(i - _lbIdx); }
async function lbAct(kind) {
  const it = _lbItems && _lbItems[_lbIdx];
  if (!it) return;
  if (kind === 'forward') { closeLightbox(); lbForwardItem(it); }
  else if (kind === 'delete') {
    if (!await lbDeleteItem(it)) return;
    _lbItems = _lbItems.filter(x => x.mid !== it.mid);
    if (!_lbItems.length) { closeLightbox(); return; }
    _lbIdx = Math.min(_lbIdx, _lbItems.length - 1);
    lbNav(0, true);
  }
}
function lbShowNav(lb) {
  lb = lb || document.getElementById('lightbox');
  const n = _lbItems ? _lbItems.length : 0;
  lb.classList.toggle('lb-gallery', n > 1);
  const c = document.getElementById('lightbox-count');
  if (c) c.textContent = n > 1 ? `${_lbIdx + 1} из ${n}` : '';
  const p = document.getElementById('lightbox-prev'), nx = document.getElementById('lightbox-next');
  if (p) p.style.visibility = _lbIdx > 0 ? '' : 'hidden';
  if (nx) nx.style.visibility = _lbIdx < n - 1 ? '' : 'hidden';
  lbPaintMeta();
}
function lbNav(dir, force) {
  if (!_lbItems) return;
  const n = _lbIdx + dir;
  if (n < 0 || n >= _lbItems.length || (!dir && !force)) return;
  _lbIdx = n;
  const it = _lbItems[n], lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img'), video = document.getElementById('lightbox-video');
  lbResetZoom();
  lb.classList.toggle('lb-video', it.type === 'video');
  if (it.type === 'video') { img.removeAttribute('src'); video.src = it.url; video.play().catch(() => {}); }
  else { video.pause(); video.removeAttribute('src'); img.src = it.url; }
  lb.dataset.url = it.url; lb.dataset.filename = it.filename || (it.type === 'video' ? 'video' : 'image');
  lbShowNav(lb);
}
document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (!lb || !lb.classList.contains('lb-open')) return;
  if (e.key === 'ArrowLeft') lbNav(-1);
  else if (e.key === 'ArrowRight') lbNav(1);
  // Escape в фазе перехвата и без передачи дальше: обработчик закрытия чата вешается позже и иначе видел бы уже закрытый просмотр
  else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeLightbox(); }
}, true);

function lbApplyTransform() {
  const img = document.getElementById('lightbox-img');
  if (img) img.style.transform = _lbScale === 1 ? '' : `translate(${_lbTx}px,${_lbTy}px) scale(${_lbScale})`;
  document.getElementById('lightbox')?.classList.toggle('lb-zoomed', _lbScale > 1);
}
function lbZoom(dir) {
  _lbScale = Math.min(LB_ZOOM_MAX, Math.max(LB_ZOOM_MIN, +(_lbScale + dir * LB_ZOOM_STEP).toFixed(2)));
  if (_lbScale === LB_ZOOM_MIN) { _lbTx = 0; _lbTy = 0; }
  lbApplyTransform();
}
function lbResetZoom() {
  _lbScale = 1; _lbTx = 0; _lbTy = 0;
  lbApplyTransform();
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb || lb.classList.contains('lb-closing')) return;
  lb.classList.remove('lb-open');
  lb.classList.add('lb-closing');
  document.getElementById('lightbox-video')?.pause();
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
  setTimeout(() => el.classList.remove('msg-highlight'), 1900);
}
function hideCtxMenu() {
  const m = document.getElementById('ctx-menu');
  popHide(m, () => m.classList.remove('open'));
}

function ctxEdit() {
  hideCtxMenu();
  if (!S.ctx.canEdit || S.secretChatIds.has(S.activeChatId)) return;
  const d = S.msgData.get(S.ctx.messageId);
  let text;
  if (d && !d.senderIsBot) text = d.text || '';    // исходная разметка: с ней в поле вернутся жирный, код и блоки
  else {
    const el = document.querySelector(`[data-msg-id="${S.ctx.messageId}"] .irc-text`);
    text = el?.textContent?.replace(' изм.','').trim()||'';
  }
  S.editingMessageId = S.ctx.messageId;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='flex';
  const input = document.getElementById('msg-input');
  if (input) { input.value = text; Fmt.focusEnd(input); CMP.lw?.load(d?.linkPreview || null, text); onMsgInput(input, true); }
}

async function ctxDelete() {
  hideCtxMenu();
  // id запоминаем до вопроса: пока висит окно, меню могут открыть на другом сообщении
  const id = S.ctx.messageId;
  if (!id) return;
  if (!await showConfirm('Удалить сообщение? Оно исчезнет у всех участников.')) return;
  if (!S.ws) return;
  S.ws.send(JSON.stringify({type:'delete_message', message_id:id}));
}

// ── «ПРОЧИТАНО» В КОНТЕКСТНОМ МЕНЮ ──
// Подпись и счётчик берутся из status сообщения (читали / доставлено), список читавших — из
// /messages/:id/info, он подгружается при открытии меню. Карточка со списком открывается наведением или нажатием.
function ctxReadTime(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}
function ctxReadLabel(direct, read, delivered, readAt, total) {
  const wrap = document.getElementById('ctx-read'), label = document.getElementById('ctx-read-label');
  if (!wrap || !label) return;
  delivered = Math.max(delivered, read);
  total = Math.max(total || 0, delivered);
  const hd = document.getElementById('ctx-read-h');
  if (hd) hd.textContent = direct ? 'Прочитал(а)' : `Прочитали ${read} из ${delivered}`;
  // Значок — те же галочки, что у сообщения: обе серые (только доставлено), одна цветная (прочитал хотя бы один),
  // обе цветные (прочитали все); не доставлено — одна серая
  const all = read > 0 && read >= total;
  wrap.classList.toggle('flat', delivered === 0);
  wrap.classList.toggle('rd-all', all);
  wrap.classList.toggle('rd-part', read > 0 && !all);
  if (delivered === 0) { label.textContent = 'Не доставлено'; return; }
  if (direct) { label.innerHTML = read ? 'Прочитано' + (readAt ? ` <span class="cnt"><b>${ctxReadTime(readAt)}</b></span>` : '') : 'Не прочитано'; return; }
  label.innerHTML = `${all ? 'Прочитали все' : 'Прочитано'} <span class="cnt"><b>${read}</b>/${delivered}</span>`;
}
function ctxReadSetup(msgId, isMine) {
  const wrap = document.getElementById('ctx-read');
  if (!wrap) return;
  S.ctxReadReq = (S.ctxReadReq || 0) + 1;
  const req = S.ctxReadReq;
  wrap.style.display = isMine ? '' : 'none';
  wrap.classList.remove('open', 'flat', 'rd-all', 'rd-part');
  document.getElementById('ctx-info-btn').setAttribute('aria-expanded', 'false');
  document.getElementById('ctx-read-list').innerHTML = '<div class="ctx-read-empty">Загрузка…</div>';
  if (!isMine) return;
  const chat = S.chats.find(c => c.id === S.activeChatId);
  const direct = chat?.type === 'direct';
  const st = S.msgStatus[msgId] || {};
  ctxReadLabel(direct, st.read || 0, st.delivered || 0, null, st.total);
  api('GET', `/messages/${msgId}/info`).then(data => {
    if (req !== S.ctxReadReq || !data || data.error) return;
    const list = document.getElementById('ctx-read-list');
    if (!list) return;
    // read/delivered — факт (хранится постоянно), read_at/delivered_at — время, есть только в «окне времени статуса»
    const rd = data.statuses.filter(s => s.read || s.read_at);
    const dlv = data.statuses.filter(s => s.delivered || s.delivered_at || s.read_at).length;
    ctxReadLabel(data.chat_type === 'direct', rd.length, dlv, rd[0]?.read_at, st.total || data.statuses.length);
    const direct2 = data.chat_type === 'direct';
    list.innerHTML = rd.length
      ? rd.map(s => `<div class="ctx-read-row"${s.read_at ? ` title="Прочитано ${new Date(s.read_at * 1000).toLocaleString('ru-RU')}"` : ''}>
          <div class="av av-round ${userAvatarColor(s.user_id)}" data-av-user="${s.user_id}">${esc(initials(s.display_name))}</div>
          <span class="ctx-read-name">${esc(s.display_name)}</span>${s.read_at ? `<span class="ctx-read-time">${ctxReadTime(s.read_at)}</span>` : ''}</div>`).join('')
      : `<div class="ctx-read-empty">${direct2 ? 'Собеседник ещё не открыл сообщение.' : dlv ? `Пока никто не прочитал. Сообщение получили ${dlv}.` : 'Сообщение пока никому не доставлено.'}</div>`;
    applyAvatars();
    if (wrap.classList.contains('open')) ctxReadPlace();
  });
}
// Карточка со списком: вправо от меню, а если до края окна не хватает места — влево. По высоте выровнена по
// пункту и не выходит за окно. Размеры берём в пикселях rect (с учётом масштаба интерфейса, см. zoomMetrics)
function ctxReadPlace() {
  const menu = document.getElementById('ctx-menu'), wrap = document.getElementById('ctx-read'), fly = document.getElementById('ctx-read-fly');
  if (!menu || !wrap || !fly) return;
  const m = zoomMetrics();
  const sc = parseFloat(getComputedStyle(menu).scale) || 1; // меню уменьшено, карточка внутри него — тоже
  const cr = menu.getBoundingClientRect(), rr = wrap.getBoundingClientRect();
  const fw = fly.offsetWidth * m.k * sc, fh = fly.offsetHeight * m.k * sc, margin = 6;
  const toRight = m.vw - cr.right >= fw + margin + 4 || cr.left < fw + margin + 4;
  fly.classList.toggle('l', !toRight);
  fly.style.left = toRight ? 'calc(100% - 2px)' : 'auto';
  fly.style.right = toRight ? 'auto' : 'calc(100% - 2px)';
  let top = rr.top - cr.top - 7 * m.k * sc;
  const over = cr.top + top + fh - (m.vh - margin);
  if (over > 0) top -= over;
  if (cr.top + top < margin) top = margin - cr.top;
  fly.style.top = (top / (m.k * sc)) + 'px';
}
function ctxReadSet(on) {
  const wrap = document.getElementById('ctx-read');
  if (!wrap || wrap.classList.contains('flat') || wrap.classList.contains('open') === on) return;
  if (on) ctxReadPlace();
  wrap.classList.toggle('open', on);
  document.getElementById('ctx-info-btn').setAttribute('aria-expanded', on);
}
function ctxReadHover(on) {
  clearTimeout(S.ctx.readT);
  if (on) ctxReadSet(true);
  else S.ctx.readT = setTimeout(() => ctxReadSet(false), 170);
}
function ctxReadToggle() {
  const wrap = document.getElementById('ctx-read');
  ctxReadSet(!wrap.classList.contains('open'));
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
  if (S.secretChatIds.has(chatId)) return scDeleteSecret(chatId);
  const ok = await showConfirm('Удалить чат? Для вас он исчезнет из списка.');
  if (!ok) return;
  await api('DELETE', `/chats/${chatId}`);
  removeChatLocally(chatId);
}

function closeActiveChat() {
  S.activeChatId = null;
  setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
  renderChatList();
}

function removeChatLocally(chatId) {
  if (S.gm?.id === chatId) { S.gm = null; closeModal('modal-group'); }
  S.chats = S.chats.filter(c=>c.id!==chatId);
  if (S.activeChatId === chatId) {
    S.activeChatId = null;
    setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
  }
  renderChatList();
}

async function leaveGroup(chatId) {
  const ok = await showConfirm(S.chats.find(c => c.id === chatId)?.type === 'room' ? 'Выйти из комнаты?' : 'Выйти из группы?', 'Выйти');
  if (!ok) return false;
  await api('POST', `/chats/${chatId}/leave`);
  S.activeChatId = null;
  setChatMainContent(`<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`);
  loadChats();
  return true;
}

// ── WEBSOCKET ──
// Имя или тег пользователя изменены на сервере: обновляем кэш, участников чатов и подписи
// на месте — без перезапуска. Сообщения в ленте подставят новое имя при следующем открытии
function applyUserUpdate(u) {
  const fix = o => {
    if (!o || o.id !== u.user_id) return;
    if (u.display_name) o.display_name = u.display_name;
    if (u.tag !== undefined) o.tag = u.tag;
  };
  (S.allUsers || []).forEach(fix);
  S.chats.forEach(c => (c.members || []).forEach(fix));
  if (S.user && S.user.id === u.user_id) fix(S.user);
  renderChatList();
  if (document.querySelector('#chats-list .pp-row')) renderContactsList(document.getElementById('search')?.value || '');
  const active = S.chats.find(c => c.id === S.activeChatId);
  const nameEl = document.querySelector('.ch-name');
  if (nameEl && active) nameEl.textContent = chatName(active);
}

// Сообщение удалено: на месте остаётся пометка «Сообщение удалено»
function markMessageDeleted(chatId, messageId) {
  const el = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!el) return;
  const chat = S.chats.find(c => c.id === chatId);
  const isChatGroup = chat?.type === 'group' || chat?.type === 'room';
  const grouped = !el.classList.contains('irc-first');
  const fakeMsg = { id: messageId, deleted: 1, text: '', attachment: null,
    sender_id: Number(el.dataset.senderId), sender_name: '', sent_at: Number(el.dataset.sentAt),
    reply_to_id: null, edited_at: null, status: { delivered: 0, read: 0, total: 0 }, reactions: [] };
  const isLastDeleted = el.classList.contains('irc-tail');
  el.outerHTML = renderMsg(fakeMsg, isChatGroup, false, grouped, isLastDeleted);
  // удалённое сообщение появляется плавно, а не подменяется рывком
  document.querySelector(`[data-msg-id="${messageId}"]`)?.classList.add('msg-new');
  reflowSeries();
}
// После переподключения сверяем открытый чат с сервером: пока связи не было, сообщения могли удалить или
// исправить, а события об этом устройство пропустило (догрузка идёт только по новым сообщениям)
async function resyncOpenChat() {
  const id = S.activeChatId;
  if (!id) return;
  const data = await api('GET', `/messages/chat/${id}?limit=200`);
  if (!data?.messages || S.activeChatId !== id) return;
  for (const m of data.messages) {
    const el = document.querySelector(`#messages [data-msg-id="${m.id}"]`);
    if (!el) continue;
    if (m.deleted) { if (!el.querySelector('.irc-deleted')) markMessageDeleted(id, m.id); }
    else if (m.edited_at && !el.querySelector('.edited-tag')) updateMsgInDOM(m);
  }
}

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

    if (data.type==='connected') { S.editLimit = data.edit_time_limit || 120; S.readUpTo = !!data.read_up_to; syncEmojiFreq(); return; }
    if (data.type==='emoji_freq') { mergeEmojiFreq(data.freq); return; }
    if (data.type==='modules_changed') { window.Modules?.refresh(); return; }
    if (data.type==='forward_count') { applyForwardCount(data.message_id, data.count); return; }
    if (data.type==='secret_key_ready') { scTick(data.chat_id); return; }

    if (data.type==='message') {
      const { message } = data;
      if (message.client_id && message.sender_id === S.user.id) outboxConfirm(message.client_id);
      const chatId = message.chat_id;
      const parentId = message.parent_id || null;
      if (SC.isHidden(chatId)) SC.unhide(chatId);
      if (parentId) {
        const parentChat = S.chats.find(c=>c.id===parentId);
        if (parentChat) parentChat.last_message = message;
        const _tp = (S.topics[parentId] || []).find(s => s.id === chatId);   // строка темы в списке тем (по ней идёт сортировка)
        if (_tp) _tp.last_message = message;
      }
      const chat = S.chats.find(c=>c.id===chatId) || (parentId ? S.chats.find(c=>c.id===parentId) : null);
      if (!parentId && chat) chat.last_message = message;
      // Если мы вглуби истории (низ не догружен) — не аппендим, придёт при догрузке
      if (S.activeChatId===chatId && !S.chatHasMoreAfter && _loadingChatId !== chatId) {
        if (message.sender_id === S.user.id && !message.client_id) {
          document.querySelector('[data-optimistic="1"]')?.remove();
        }
        const _mc = document.getElementById('messages');
        const _near = !_mc || (_mc.scrollHeight - _mc.scrollTop - _mc.clientHeight) < 120;
        appendMsg(message);
        S.chatNewestId = message.id;
        tailPush(chatId, message);
        if (message.sender_id !== S.user.id && isViewing()) {
          if (_near) sendRead(chatId, message.id);
          else {
            // Не видно (лента выше) — это непрочитанное: счётчик растёт, пока не долистают
            S.unread[chatId] = (S.unread[chatId] || 0) + 1;
            if (message.mentions?.includes(S.user.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId] || 0) + 1;
          }
        }
        if (isViewing() && S.ws?.readyState===1) {
          // Пользователь смотрит в чат — сообщение доставлено
          S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
        } else if (!isViewing() && message.sender_id !== S.user.id) {
          S.unread[chatId] = (S.unread[chatId]||0)+1;
          if (message.mentions?.includes(S.user.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId]||0)+1;
          if (!isChatMuted(chatId, parentId)) {
            const title = chatName(chat) || message.sender_name || 'Electron';
            const body = S.secretChatIds.has(chatId) ? 'Новое сообщение' : `${message.sender_name}: ${(message.text ? Fmt.plain(message.text) : '') || (message.attachment ? (message.attachment.gif ? '🖼 GIF' : message.attachment.more?.length ? '🖼 Вложений: ' + (message.attachment.more.length + 1) : message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : message.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
            msgNotify(title, body, chatId);
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
        // Читают историю в этом же чате: звук и уведомление ни к чему, сообщение придёт при догрузке вниз
        if (!isChatMuted(chatId, parentId) && !(S.activeChatId === chatId && isViewing())) {
          // Темы нет в S.chats — берём её имя из S.topics, иначе имя
          // родительской комнаты (chat уже содержит этот фолбэк). Раньше здесь
          // был chatName(undefined) → TypeError, и обработчик обрывался.
          const _srObj = parentId ? (S.topics[parentId]||[]).find(s=>s.id===chatId) : null;
          const title = _srObj?.name || chatName(chat) || message.sender_name || 'Electron';
          const body = S.secretChatIds.has(chatId) ? 'Новое сообщение' : `${message.sender_name}: ${(message.text ? Fmt.plain(message.text) : '') || (message.attachment ? (message.attachment.gif ? '🖼 GIF' : message.attachment.more?.length ? '🖼 Вложений: ' + (message.attachment.more.length + 1) : message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : message.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
          msgNotify(title, body, chatId);
          playNotificationSound();
        }
        if (S.ws?.readyState===1) S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
      }
      updateUnreadTotal();
      renderChatList();
      if (parentId && S.activeRoomId === parentId) renderTopicsPanel(parentId);
      if (!chat) loadChats();
    }

    if (data.type==='message_edited') {
      const m = data.message;
      const chat = S.chats.find(c=>c.id===m.chat_id);
      if (chat?.last_message?.id===m.id) chat.last_message = m;
      tailPatch(m);
      if (S.activeChatId===m.chat_id) updateMsgInDOM(m);
      renderChatList();
    }

    if (data.type==='message_deleted') {
      const { message_id, chat_id } = data;
      const chat = S.chats.find(c=>c.id===chat_id);
      if (chat?.last_message?.id===message_id) chat.last_message = {...chat.last_message, deleted:1, text:'', attachment:null};
      tailPatch({ id: message_id, chat_id, deleted: 1, text: '', attachment: null });
      if (S.activeChatId===chat_id) markMessageDeleted(chat_id, message_id);
      renderChatList();
    }

    if (data.type==='reload_chats') { loadChats(); }
    // Счётчик «в сети N из M» открытой группы или комнаты
    if (data.type==='chat_online') {
      (S.chatOnline ||= {})[data.chat_id] = { online: data.online, total: data.total };
      if (data.chat_id === S.activeChatId) updateGroupSub();
      if (gmIsOpen() && S.gm.id === data.chat_id) gmPaintSub();
    }
    // Связь с другим сервером появилась или пропала: у групп оттуда меняется шапка и поле ввода
    if (data.type==='fed_link') loadChats();
    if (data.type==='folders_changed') scheduleFoldersReload();
    if (data.type==='chat_deleted') { removeChatLocally(data.chat_id); }

    if (data.type==='chat_read') {
      // Чат прочитан на другом устройстве этого пользователя
      // Остаток приходит, когда прочитано не всё (up_to); без него чат прочитан целиком
      const _nu = typeof data.unread === 'number' ? data.unread : 0, _nm = typeof data.unread_mentions === 'number' ? data.unread_mentions : 0;
      // Ответ на «прочитано» часто ничего не меняет: тогда ни список, ни бар не трогаем
      if ((S.unread[data.chat_id] || 0) === _nu && (S.unreadMentions[data.chat_id] || 0) === _nm) return;
      S.unread[data.chat_id] = _nu;
      S.unreadMentions[data.chat_id] = _nm;
      updateUnreadTotal();
      renderChatListSoon();
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
          const _rf = container ? firstVisibleMsg(container) : null, _ry = _rf ? _rf.getBoundingClientRect().top : 0;
          const existing = msgEl.querySelector('.reactions');
          const reactionsHtml = renderReactions(message_id);
          if (existing) {
            existing.outerHTML = reactionsHtml || '';
          } else if (reactionsHtml) {
            // Сосед .bubble-row (аватар+пузырь) внутри .irc-content — как и при
            // полной отрисовке в renderMsgIRC. Не .msg-bubble: он теперь вложен
            // в .bubble-row, и вставка рядом с ним попала бы внутрь этой строки.
            const bubbleRow = msgEl.querySelector('.bubble-row');
            if (bubbleRow) bubbleRow.insertAdjacentHTML('afterend', reactionsHtml);
          }
          // Появление/исчезновение реакции может разорвать срезанный угол серии
          // (см. .irc-reaction-split в reflowSeries)
          reflowSeries();
          if (container) {
            if (isAtBottom) container.scrollTop = container.scrollHeight;
            else if (_rf?.isConnected) {
              // Возвращаем на место то, что читают: реакция выше экрана сдвигает ленту, реакция на видимом сообщении — нет
              const d = _rf.getBoundingClientRect().top - _ry;
              if (Math.abs(d) > .5) container.scrollTop += d;
            }
          }
        }
      }
    }

    if (data.type==='reaction_notify') {
      // Только нативное уведомление, без счётчиков непрочитанного —
      // как и для сообщений, не беспокоим, если окно сейчас видно и в фокусе
      if (!isViewing()) {
        if (!_quietNow()) webNotify(data.reactorName, `${data.reaction} на ваше сообщение`, data.chatId);
        playNotificationSound();
      }
    }

    if (data.type==='typing') { showTyping(data.chat_id, data.sender_name); }

    if (data.type==='presence') {
      S.presence[data.user_id] = data.status;
      (S.presenceMobile ||= {})[data.user_id] = !!data.mobile && data.status === 'online';
      if (gmIsOpen()) setTimeout(gmPaintStatus, 0);
      if (data.last_seen) S.lastSeen[data.user_id] = data.last_seen;
      // Обновляем подпись в шапке открытого личного чата («в сети» / «был(а) в …»)
      const activeChat = S.chats.find(c=>c.id===S.activeChatId);
      if (activeChat?.type === 'direct' && getPeerUserId(activeChat) === data.user_id) {
        const subEl = document.querySelector('.ch-sub');
        if (subEl) subEl.textContent = peerStatusText(data.user_id);
      }
      // Зелёный — онлайн, оранжевый — отошёл, точка скрыта — офлайн
      document.querySelectorAll(`.presence-dot[data-user-id="${data.user_id}"]`).forEach(dot => {
        dot.classList.toggle('away', data.status === 'away');
        dot.classList.toggle('mob', !!data.mobile && data.status === 'online');
        dot.style.display = data.status === 'offline' ? 'none' : '';
      });
      // Контакты отсортированы по статусу — при смене статуса перестраиваем список
      if (document.querySelector('#chats-list .pp-row')) renderContactsList(document.getElementById('search')?.value || '');
    }

    if (data.type==='status_update') {
      const m = data.message;
      if (m.status) S.msgStatus[m.id] = { ...m.status };
      // Точный статус с сервера — кладём его в список чатов как есть
      const _c = S.chats.find(c => c.id === m.chat_id)
        || S.chats.find(c => (S.topics[c.id] || []).some(s => s.id === m.chat_id));
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
        || S.chats.find(c => (S.topics[c.id] || []).some(s => s.id === data.chat_id)))?.last_message;
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
      // Точечное обновление чата без refetch всего списка: полный объект (закрепление)
      // или только изменённые поля (переименование и режим «только чтение» из админки)
      const chatId = data.chat ? data.chat.id : data.chat_id;
      if (data.chat) {
        const idx = S.chats.findIndex(c => c.id === data.chat.id);
        if (idx >= 0) S.chats[idx] = data.chat; else S.chats.push(data.chat);
      } else {
        const c = S.chats.find(x => x.id === chatId);
        if (c) {
          if (data.name !== undefined) c.name = data.name;
          if (data.read_only !== undefined) c.read_only = data.read_only ? 1 : 0;
          if (data.topics_manual !== undefined) { c.topics_manual = data.topics_manual ? 1 : 0; if (S.activeRoomId === chatId) loadTopics(chatId, { render: true }); }
        }
      }
      renderChatList();
      if (S.activeChatId === chatId) {
        const nameEl = document.querySelector('.ch-name');
        const c = S.chats.find(x => x.id === chatId);
        if (nameEl && c) nameEl.textContent = chatName(c);
        syncReadOnlyUi();
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
      loadAvatarIndex().finally(() => { S.avatarTs = Date.now(); _avatarCache.clear(); renderChatList(); });
    }

    if (data.type==='user_created') {
      loadUsers();
    }
    if (data.type==='contacts_changed' || data.type==='directory_changed' || data.type==='presence_refresh') refreshDirectory();
    if (data.type==='blocks_changed') loadBlocks();
    if (data.type==='chat_limit') {
      const c = S.chats.find(x => x.id === data.chat_id);
      if (c) { c.dm_limit = data.dm_limit; if (data.chat_id === S.activeChatId) syncReadOnlyUi(); }
    }
    if (data.type==='send_rejected' && data.reason === 'limit') {
      const c = S.chats.find(x => x.id === data.chat_id);
      if (c) { c.dm_limit = data.dm_limit || c.dm_limit; if (data.chat_id === S.activeChatId) syncReadOnlyUi(); }
    }
    if (data.type==='send_rejected') outboxRejected(data.chat_id);
    if (data.type==='send_rejected') showActionToast(data.reason === 'limit' ? 'Больше писать нельзя, пока собеседник не ответит или не добавит вас в контакты' : data.reason === 'you_blocked' ? 'Вы заблокировали этого человека. Разблокируйте его в настройках.' : data.reason === 'blocked' || data.reason === 'rate' ? 'Сообщение не доставлено' : data.reason === 'federation_off' ? 'Нет связи с сервером этого человека' : data.reason === 'fed_offline' ? 'Нет связи с сервером этой группы. Писать пока нельзя' : data.reason === 'gif_off' ? 'GIF сейчас недоступны' : 'Писать сюда нельзя');
    if (data.type==='user_updated') applyUserUpdate(data);
    if (data.type==='perms') annSetAllowed(data.can_announce);

    if (data.type === 'force_logout') { logout(true); }
    // Администратор восстановил чаты из копии: данные на экране устарели, берём заново
    if (data.type === 'data_restored') { location.reload(); return; }
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
    modulesInit(); window.Modules?.refresh();
    S.wsRetry = 0;
    retryAllOutbox();
    loadPushPrefs();
    hideServerToast();
    loadChats();
    watchChat(findChatAny(S.activeChatId));
    loadBanners();
    api('GET', '/auth/refresh').then(d => { if (d?.token) { S.token = d.token; saveSession(); } });
    resyncOpenChat();
    // Догружаем сообщения, пришедшие в открытый чат во время разрыва соединения
    const _ccId = S.activeChatId, _ccNewest = S.chatNewestId;
    if (_ccId && _ccNewest && !S.chatHasMoreAfter) {
      api('GET', `/messages/chat/${_ccId}?after=${_ccNewest}&limit=50`).then(data => {
        if (!data?.messages?.length || S.activeChatId !== _ccId) return;
        S.chatHasMoreAfter = !!data.hasMoreAfter;
        S.chatNewestId = data.messages[data.messages.length - 1].id;
        appendMessagesAfter(data.messages, _ccId);
        if (isViewing() && S.ws?.readyState === 1) {
          scheduleRead();
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
      const initStatus = isViewing() ? 'online' : 'away';
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
  updateDownBadge();
  const total = Object.values(S.unread).reduce((a,b)=>a+b,0);
  if (typeof updateFolderBadges === 'function' && S.folders?.length) updateFolderBadges();
  if (typeof updateSpaceBadges === 'function') updateSpaceBadges();
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
  if (users) { S.allUsers = users; if (typeof spaceActive === 'function' && spaceActive() !== null) renderChatList(); }
}

// ── ПРОСТРАНСТВА, КОНТАКТЫ, БЛОКИРОВКИ ──
// Сервер отдаёт людей с пометкой rel: ws — из моего пространства, other — из другого (добавлен в контакты),
// chat — знаем только по общему чату: в списки выбора такие не попадают, но имя и аватарка в переписке нужны.
// contact — добавлен вручную. У сервера без пространств пометок нет, тогда все считаются «своими».
const isPickable = u => u.rel !== 'chat';
// Человек с другого сервера: вместо названия пространства значок земного шара (название сервера не показываем)
// Адрес человека с другого сервера «@сервер:логин». Берём из полей сервера; у старого сервера разбираем служебное имя (раньше «сервер@логин»)
function fedAddr(u) {
  let s = u.server_id, l = u.login;
  if (!s || !l) { const m = /^([^:@]+)[:@](.*)$/.exec(u.username || ''); if (m) { s = s || m[1]; l = l || m[2]; } }
  return '@' + (s ? s + ':' : '') + (l || u.username);
}
const FED_GLOBE = '<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
// Значок пространства у человека. Вы в одном пространстве: значок только у людей из чужих (контакты, общие чаты).
// Вы в нескольких: у людей из общих пространств показываем общие (shared_workspaces), чтобы различать, кто откуда.
// Общих несколько: «Склад · Офис», а если не помещается — «Склад +1» с полным списком в подсказке.
const myWsCount = () => S.user?.workspaces?.length || 1;
function wsChips(names) {
  if (names.length === 1) return `<span class="ws-chip">${esc(names[0])}</span>`;
  const full = names.join(' · ');
  return `<span class="ws-chip" title="${esc(names.join(', '))}">${full.length <= 22 ? esc(full) : esc(names[0]) + ' +' + (names.length - 1)}</span>`;
}
const wsTag = u => u.federated ? `<span class="ws-chip ws-fed" title="С другого сервера">${FED_GLOBE}</span>`
  : u.rel === 'ws' ? (myWsCount() > 1 && u.shared_workspaces?.length ? wsChips(u.shared_workspaces) : '')
  : (u.rel === 'other' || u.rel === 'chat') && u.workspace_name ? `<span class="ws-chip">${esc(u.workspace_name)}</span>` : '';
// Кнопка «Добавить контакт» нужна, когда человек известен только по общему чату
const needsContact = id => { const u = (S.allUsers || []).find(x => x.id === id); return !!u && u.rel === 'chat'; };
const peerSubText = id => { const u = (S.allUsers || []).find(x => x.id === id); return u && u.rel === 'chat' ? `${u.workspace_name ? u.workspace_name + ' · ' : ''}не в ваших контактах` : peerStatusText(id); };
S.blocked = S.blocked || [];
const isBlockedId = id => (S.blocked || []).some(b => b.id === id);
async function loadBlocks() {
  const r = await api('GET', '/blocks');
  if (Array.isArray(r)) { S.blocked = r; if (_sidebarTab === 'settings' && CS.sec === 'blocks') csRefresh(); }
}
// Перечитать людей и присутствие после изменения контактов или пространства
async function refreshDirectory() {
  await refreshServerInfo();   // состав ваших пространств мог измениться: от него зависят значки
  await loadUsers();
  if (typeof loadSharedSpaces === 'function') await loadSharedSpaces();
  await loadPresence();
  // Аватарка человека с другого сервера может приехать позже первого показа: неудачи не помним, пробуем снова
  for (const [u, ok] of [..._avatarCache]) if (ok === false) _avatarCache.delete(u);
  applyAvatars();
  if (pfIsOpen()) renderProfile();
  if (_sidebarTab === 'contacts') renderContactsList(document.getElementById('contacts-search')?.value || '');
  const chat = S.chats.find(c => c.id === S.activeChatId);
  if (chat?.type === 'direct') {
    const pid = getPeerUserId(chat), sub = document.querySelector('.ch-sub');
    if (pid && sub) sub.textContent = peerSubText(pid);
    const btn = document.getElementById('ch-add-contact');
    if (btn && !needsContact(pid)) btn.remove();
  }
}

// Окно «Добавить контакт»: только логин и кнопка, без поиска и подсказок
function openAddContact() {
  document.getElementById('ac-body').innerHTML = `
    <p class="ac-lead">Введите логин человека точно. Если он на другом сервере, укажите адрес: @сервер:логин. Он не узнает, что вы его добавили.</p>
    <div class="ac-fld" id="ac-fld"><span>@</span><input id="ac-input" placeholder="логин или сервер:логин" autocomplete="off" autocapitalize="off" spellcheck="false" data-on-input="acClear" data-on-keydown="__h38"></div>
    <div class="ac-hint" id="ac-hint">Логин можно узнать у самого человека.</div>
    <div class="ac-foot"><button class="modal-btn-ghost" data-on-click="closeModal" data-a-click='["modal-addcontact"]'>Отмена</button><button class="modal-btn-primary" id="ac-go" data-on-click="submitAddContact">Добавить</button></div>`;
  openModal('modal-addcontact');
  setTimeout(() => document.getElementById('ac-input')?.focus(), 80);
}
function acClear() {
  // «@» нарисована перед полем: вставленную со ссылкой убираем, чтобы не двоилась
  const ai = document.getElementById('ac-input'); if (ai && /^\s*@/.test(ai.value)) ai.value = ai.value.replace(/^\s*@+/, '');
  document.getElementById('ac-fld')?.classList.remove('err');
  const h = document.getElementById('ac-hint');
  if (h && h.dataset.state) { h.textContent = 'Логин можно узнать у самого человека.'; h.className = 'ac-hint'; delete h.dataset.state; }
}
async function submitAddContact() {
  const inp = document.getElementById('ac-input'), go = document.getElementById('ac-go'), hint = document.getElementById('ac-hint');
  if (!inp || go.disabled) return;
  const login = inp.value.trim().replace(/^@/, '');
  if (!login) { inp.focus(); return; }
  go.disabled = true;
  const r = await api('POST', '/contacts', { username: login });
  go.disabled = false;
  if (r?.ok) {
    closeModal('modal-addcontact');
    showActionToast(`${r.user?.display_name || login} добавлен в контакты`);
    await refreshDirectory();
    return;
  }
  document.getElementById('ac-fld').classList.add('err');
  hint.textContent = r?.error || 'Не удалось добавить. Проверьте соединение.';
  hint.className = 'ac-hint err'; hint.dataset.state = 'err';
}
// Из шапки чата или списка участников группы
async function addContactFromChat(userId) {
  const u = S.allUsers.find(x => x.id === userId) || S.chats.flatMap(c => c.members || []).find(m => m.id === userId);
  if (!u?.username) return;
  const r = await api('POST', '/contacts', { username: u.username });
  if (r?.ok || r?.code === 'already') { showActionToast(`${u.display_name || u.username} добавлен в контакты`); await refreshDirectory(); document.querySelectorAll(`[data-addc="${userId}"]`).forEach(b => b.remove()); }
  else showActionToast(r?.error || 'Не удалось добавить контакт');
}
// Контекстное меню контакта из другого пространства: удалить из контактов
function contactMenu(e, userId) {
  const u = S.allUsers.find(x => x.id === userId);
  if (!u) return;
  e.preventDefault(); e.stopPropagation();
  S.ctxContactId = userId;
  const menu = document.getElementById('ctx-contact-menu');
  // «Удалить из контактов» только у тех, кого добавили вручную
  const rm = document.getElementById('ctx-contact-remove'); if (rm) rm.style.display = u.contact ? '' : 'none';
  menu.style.display = 'block';
  placeCtxMenu(menu, e.clientX, e.clientY, null);
}
function ctxContactProfile() {
  document.getElementById('ctx-contact-menu').style.display = 'none';
  openProfile(S.ctxContactId);
}
async function ctxContactRemove() {
  document.getElementById('ctx-contact-menu').style.display = 'none';
  const id = S.ctxContactId; if (!id) return;
  const u = S.allUsers.find(x => x.id === id);
  await api('DELETE', `/contacts/${id}`);
  showActionToast(`${u?.display_name || 'Контакт'} удалён из контактов`);
  await refreshDirectory();
}
// Заблокировать собеседника в личном чате (и снять блокировку)
async function ctxChatBlock() {
  hideChatCtx();
  const chat = S.chats.find(c => c.id === S.ctxChatId);
  const pid = chat && getPeerUserId(chat); if (!pid) return;
  const name = chat.members?.find(m => m.id === pid)?.display_name || 'собеседника';
  if (isBlockedId(pid)) {
    await api('DELETE', `/blocks/${pid}`); await loadBlocks(); showActionToast(`${name} разблокирован`);
    return;
  }
  const ok = await showConfirm(`Заблокировать ${name}? Он не сможет писать вам в личные сообщения. Общие группы и комнаты останутся. Разблокировать можно в настройках, в разделе «Блокировки».`, 'Заблокировать');
  if (!ok) return;
  const r = await api('POST', '/blocks', { user_id: pid });
  if (r?.ok) { await loadBlocks(); showActionToast(`${name} заблокирован`); } else showActionToast(r?.error || 'Не удалось заблокировать');
}
async function unblockUser(id) {
  await api('DELETE', `/blocks/${id}`);
  await loadBlocks();
}
function csPaneBlocks() {
  const list = S.blocked || [];
  if (!list.length) {
    return `<div class="cs-stub"><div class="cs-stub-i">${CS_I.ban}</div><b>Заблокированных нет</b>
      <span>Если кто-то пишет вам лишнее, заблокируйте его в меню «⋯» в чате с ним.</span></div>`;
  }
  return `<div class="cs-gt">Заблокированные</div><div class="cs-g">${list.map(b => `<div class="cs-r"><div class="cs-l"><b>${esc(b.display_name)}</b>
      <span>${b.federated ? esc(fedAddr(b)) + ' · другой сервер' : '@' + esc(b.username) + (b.workspace_name ? ' · ' + esc(b.workspace_name) : '')}</span></div>
      <div class="cs-ctl"><button type="button" class="cs-btn ghost sm" data-on-click="unblockUser" data-a-click="${esc(JSON.stringify([b.id]))}">Разблокировать</button></div></div>`).join('')}</div>
    <p class="cs-hint">Заблокированный не может писать вам в личные сообщения. Общие группы и комнаты остаются.</p>`;
}

// ── ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ──
// Окно открывается по клику на имя или аватарку в шапке личного чата и пунктом «Профиль» в меню контакта.
// Показывает только то, что клиент знает сам: логин, принадлежность (пространство или другой сервер) и общие группы.
const PF_I = {
  msg: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  add: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>',
  rem: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/></svg>',
  ban: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  unban: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  image: '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
};
// Цвет обложки — цвет тега, как у аватарки
function pfCoverColor(cls) {
  const m = /^av-tag-(\d+)$/.exec(cls);
  if (m) return `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--tag-' + m[1] + '-av').trim()})`;
  return { 'av-blue': '#4f46e5', 'av-green': '#059669', 'av-purple': '#7c3aed', 'av-orange': '#d97706' }[cls] || 'var(--accent)';
}
function pfUser(id) {
  const u = (S.allUsers || []).find(x => x.id === id);
  if (u) return u;
  const m = (S.chats || []).flatMap(c => c.members || []).find(x => x.id === id);
  return m ? { ...m, rel: 'chat' } : null;
}
// ── МЕДИА ЧАТА ──
// Окно «Медиа, файлы и ссылки»: открывается из профиля группы, комнаты и человека. Сервер отдаёт вложения и ссылки
// чата по типам и страницами; фото и видео открываются в просмотре с листанием по всей загруженной ленте.
const CM_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const CM_TABS = [['media', 'Фото и видео'], ['files', 'Файлы'], ['links', 'Ссылки']];
let _cm = null;
function cmAbs(p) { return `${httpProto()}://${S.server}${p}`; }
function cmSize(b) { return !b ? '' : b < 1024 ? b + ' Б' : b < 1048576 ? Math.round(b / 1024) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ'; }
function cmWhen(ts) {
  const d = new Date(ts * 1000), n = new Date(), hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === n.toDateString()) return 'сегодня, ' + hm;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) }) + ', ' + hm;
}
function openChatMedia(chatId) {
  const chat = findChatAny(chatId);
  if (!chat) return;
  _cm = { id: chatId, tab: 'media', data: {}, more: {}, cursor: {}, busy: false };
  renderChatMedia();
  openModal('modal-media');
  loadChatMedia();
}
function cmTab(t) {
  if (!_cm) return;
  _cm.tab = t;
  renderChatMedia();
  if (_cm.more[t] === undefined) loadChatMedia();
}
async function loadChatMedia() {
  const c = _cm; if (!c || c.busy) return;
  const tab = c.tab;
  if (c.more[tab] === false) return;
  c.busy = true;
  const r = await api('GET', `/messages/chat/${c.id}/media?type=${tab}${c.cursor[tab] ? '&before=' + c.cursor[tab] : ''}`);
  c.busy = false;
  if (_cm !== c) return;
  if (!r || r.error) { c.more[tab] = false; }
  else { c.data[tab] = (c.data[tab] || []).concat(r.items); c.more[tab] = !!r.more; c.cursor[tab] = r.cursor; }
  if (c.tab === tab) renderChatMedia(true);
}
function cmItems() {
  return (_cm.data.media || []).map(x => ({
    url: cmAbs(x.att.url), filename: x.att.name || (/^video\//.test(x.att.mime) ? 'video' : 'image'), type: /^video\//.test(x.att.mime) ? 'video' : 'image',
    mid: x.message_id, mime: x.att.mime, sender: x.sender_name, senderId: x.sender_id, at: x.sent_at, caption: x.caption || '', mine: x.sender_id === S.user.id, total: 1, thumb: x.att.thumb ? cmAbs(x.att.thumb) : '',
  }));
}
function cmOpen(k) {
  if (!_cm) return;
  if (_cm.tab === 'media') { const items = cmItems(); if (items[k]) openLightbox(items[k].url, items[k].filename, items[k].type, items, k); }
  else if (_cm.tab === 'files') { const x = _cm.data.files[k]; if (x) downloadAttachment(cmAbs(x.att.url), x.att.name || 'file'); }
}
function renderChatMedia(keep) {
  const c = _cm, box = document.getElementById('cm-modal');
  if (!c || !box) return;
  const chat = findChatAny(c.id), list = c.data[c.tab] || [];
  const prev = box.querySelector('.cm-scroll'), top = prev && keep ? prev.scrollTop : 0;
  let body = '';
  if (!list.length) body = `<div class="cm-empty">${c.more[c.tab] === undefined ? 'Загрузка…' : c.tab === 'media' ? 'Фото и видео пока нет' : c.tab === 'files' ? 'Файлов пока нет' : 'Ссылок пока нет'}</div>`;
  else {
    let last = '', open = false;
    list.forEach((x, k) => {
      const d = new Date(x.sent_at * 1000), mk = CM_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      if (mk !== last) { if (open) body += '</div>'; body += `<div class="cm-month">${mk}</div><div class="${c.tab === 'media' ? 'cm-grid' : 'cm-list'}">`; last = mk; open = true; }
      if (c.tab === 'media') {
        const v = /^video\//.test(x.att.mime);
        body += `<button type="button" class="cm-tile" data-on-click="cmOpen" data-a-click="${esc(JSON.stringify([k]))}" title="${esc(x.sender_name)}, ${cmWhen(x.sent_at)}"><img src="${esc(cmAbs(x.att.thumb || x.att.url))}" loading="lazy" alt="">${v ? `<span class="cm-play">${gmSvg('play', 12, 0)}</span>` : ''}</button>`;
      } else if (c.tab === 'files') {
        body += `<button type="button" class="cm-row" data-on-click="cmOpen" data-a-click="${esc(JSON.stringify([k]))}"><span class="cm-ic">${gmSvg('file', 20)}</span><span class="cm-tx"><b>${esc(x.att.name || 'Файл')}</b><span>${esc([cmSize(x.att.size), x.sender_name, cmWhen(x.sent_at)].filter(Boolean).join(' · '))}</span></span></button>`;
      } else {
        const u = x.urls[0];
        body += `<a class="cm-row" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span class="cm-ic">${gmSvg('link', 20)}</span><span class="cm-tx"><b>${esc(x.title || x.site || u)}</b><span>${esc(u.replace(/^https?:\/\//, '').slice(0, 70))} · ${esc(x.sender_name)} · ${cmWhen(x.sent_at)}</span></span></a>`;
      }
    });
    if (open) body += '</div>';
    if (c.more[c.tab]) body += '<div class="cm-empty">Загрузка…</div>';
  }
  box.innerHTML = `
    <div class="gm-top"><span class="t">Медиа · ${esc(chatName(chat))}</span><button class="icon-btn" data-on-click="closeModal" data-a-click='["modal-media"]' aria-label="Закрыть">${gmSvg('x', 16)}</button></div>
    <div class="cm-tabs" role="tablist">${CM_TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${c.tab === k}" class="${c.tab === k ? 'on' : ''}" data-on-click="cmTab" data-a-click="${esc(JSON.stringify([`${k}`]))}">${l}</button>`).join('')}</div>
    <div class="cm-scroll" data-on-scroll="cmScroll" data-a-scroll='["__this"]'>${body}</div>`;
  const sc = box.querySelector('.cm-scroll');
  if (sc) sc.scrollTop = top;
}
function cmScroll(el) {
  if (_cm && _cm.more[_cm.tab] && el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadChatMedia();
}
function pfMedia(chatId) { openChatMedia(chatId); }

function openProfile(userId) {
  if (!userId || userId === S.user?.id || !pfUser(userId)) return;
  S.profileId = userId;
  renderProfile();
  openModal('modal-profile');
}
function pfIsOpen() { return !!S.profileId && !!document.getElementById('modal-profile')?.classList.contains('open'); }
function renderProfile() {
  const id = S.profileId, u = pfUser(id), box = document.getElementById('pf-modal');
  if (!u || !box) return;
  const cls = userAvatarColor(u.id, u.tag), fed = !!u.federated;
  const otherSpace = !fed && u.rel !== 'ws' && !!u.workspace_name;
  const canContact = fed || otherSpace;          // у людей своего пространства контакты не нужны
  const blocked = isBlockedId(id);
  const st = peerStatusText(id), on = S.presence[id] === 'online';
  const loginTxt = fed ? fedAddr(u) : '@' + u.username;
  const cellRow = (l, v) => `<div class="cell"><span class="cl">${l}</span><span class="cv">${v}</span></div>`;
  const rows = [`<button type="button" class="cell" id="pf-login" aria-label="Скопировать логин: ${esc(loginTxt)}" data-on-click="pfCopyLogin"><span class="cl">Логин</span><span class="cv">${esc(loginTxt)}</span><span class="ch pf-ci">${CS_I.copy}</span></button>`];
  if (fed) rows.push(cellRow('Сервер', 'Другой сервер'));
  else if (otherSpace) rows.push(cellRow('Пространство', esc(u.workspace_name)));
  else if (!fed && u.rel === 'ws' && myWsCount() > 1 && u.shared_workspaces?.length) rows.push(cellRow(u.shared_workspaces.length > 1 ? 'Пространства' : 'Пространство', esc(u.shared_workspaces.join(' · '))));
  if (canContact) rows.push(cellRow('В ваших контактах', u.contact ? 'Да' : 'Нет'));
  const groups = (S.chats || []).filter(c => (c.type === 'group' || c.type === 'room') && !c.parent_id && !c.is_secret && c.members?.some(m => m.id === id));
  const dmChat = (S.chats || []).find(c => c.type === 'direct' && !c.is_secret && getPeerUserId(c) === id);
  const mediaAttr = dmChat ? `data-on-click="pfMedia" data-a-click="${esc(JSON.stringify([dmChat.id]))}"` : 'disabled';
  // Оформление перенесено из мобильного клиента (/m, профиль человека): шапка-капсула, аватарка, три плитки, сведения и общие группы стеклянными блоками
  const tiles = `<div class="tiles">
      <button type="button" class="tile glass gi" data-on-click="pfWrite">${PF_I.msg}Написать</button>
      ${canContact ? `<button type="button" class="tile glass gi" data-on-click="pfContact">${u.contact ? PF_I.rem : PF_I.add}${u.contact ? 'Из контактов' : 'В контакты'}</button>` : `<button type="button" class="tile glass gi" ${mediaAttr}>${PF_I.image}Медиа</button>`}
      <button type="button" class="tile glass gi${blocked ? '' : ' d'}" data-on-click="pfBlock">${blocked ? PF_I.unban : PF_I.ban}${blocked ? 'Разблокировать' : 'Блок'}</button></div>`;
  const mediaCell = dmChat && canContact ? `<button type="button" class="cell glass" style="border-radius:var(--r-card);margin-bottom:16px" ${mediaAttr}><span class="ci" style="background:#5b8def">${PF_I.image}</span><span class="cl">Медиа, файлы и ссылки</span><span class="ch">${gmSvg('chev', 16)}</span></button>` : '';
  const groupsHtml = groups.length
    ? `<div class="gl">Общие группы · ${groups.length}</div><div class="grp glass">${groups.map(c => `<button type="button" class="mini" data-on-click="pfOpenChat" data-a-click="${esc(JSON.stringify([c.id]))}">
        <div class="av av-sm ${chatAvatarClass(c)}${c.type === 'room' && c.has_topics ? ' av-sq' : ' av-round'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
        <span class="rt"><b>${esc(chatName(c))}</b><small>${c.type === 'room' ? 'Комната' : 'Группа'} · ${nMembers(c.members.length)}</small></span><span class="ch">${gmSvg('chev', 16)}</span></button>`).join('')}</div>`
    : '';
  box.innerHTML = `
    <div class="pm-scroll">
      <div class="pm-nav"><button class="icon-btn pm-xi" type="button" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-profile"]'>${gmSvg('x', 16)}</button></div>
      <div class="hero">
        <div class="pf-av ${cls}"><span>${esc(initials(u.display_name))}</span><img src="${httpProto()}://${S.server}/api/users/${u.id}/avatar" data-on-error="__h22">${presenceDot(id)}</div>
        <h2>${esc(u.display_name)}</h2><p class="${on ? 'on' : ''}">${esc(st)}</p>${u.tag ? `<span class="pp-tag ${senderNameClass(u.tag)}" style="margin-top:6px">${esc(u.tag)}</span>` : ''}
      </div>
      ${tiles}
      ${blocked ? `<div class="nbanner glass">${PF_I.ban}<span>Вы заблокировали этого человека: он не может писать вам в личные сообщения. Общие группы и комнаты остаются.</span></div>` : ''}
      ${mediaCell}
      <div class="grp glass">${rows.join('')}</div>
      ${groupsHtml}
    </div>`;
  applyAvatars();   // фото общих групп и комнат
}
// Логин (для людей с других серверов адрес @сервер:логин) копируется по нажатию, как ссылка в своём профиле
async function pfCopyLogin() {
  const u = pfUser(S.profileId); if (!u) return;
  const t = u.federated ? fedAddr(u) : '@' + u.username;
  try { await navigator.clipboard.writeText(t); } catch { showActionToast('Не удалось скопировать'); return; }
  showActionToast('Скопировано: ' + t);
  const b = document.getElementById('pf-login'); if (!b) return;
  const ic = b.querySelector('.pf-ci'), orig = ic.innerHTML;
  b.classList.add('done'); ic.innerHTML = CS_I.check;
  setTimeout(() => { b.classList.remove('done'); ic.innerHTML = orig; }, 1600);
}
function pfWrite() { const id = S.profileId; closeModal('modal-profile'); if (id) startDirect(id); }
function pfOpenChat(chatId) { closeModal('modal-profile'); openChat(chatId); }
async function pfContact() {
  const u = pfUser(S.profileId); if (!u) return;
  if (u.contact) {
    await api('DELETE', `/contacts/${u.id}`);
    showActionToast(`${u.display_name} удалён из контактов`);
  } else {
    const r = await api('POST', '/contacts', { username: u.username });
    if (!(r?.ok || r?.code === 'already')) { showActionToast(r?.error || 'Не удалось добавить контакт'); return; }
    showActionToast(`${u.display_name} добавлен в контакты`);
  }
  await refreshDirectory();
}
async function pfBlock() {
  const u = pfUser(S.profileId); if (!u) return;
  if (isBlockedId(u.id)) {
    await api('DELETE', `/blocks/${u.id}`); await loadBlocks(); showActionToast(`${u.display_name} разблокирован`);
  } else {
    const ok = await showConfirm(`Заблокировать ${u.display_name}? Он не сможет писать вам в личные сообщения. Общие группы и комнаты останутся. Разблокировать можно в настройках, в разделе «Блокировки».`, 'Заблокировать');
    if (!ok) return;
    const r = await api('POST', '/blocks', { user_id: u.id });
    if (!r?.ok) { showActionToast(r?.error || 'Не удалось заблокировать'); return; }
    await loadBlocks(); showActionToast(`${u.display_name} заблокирован`);
  }
  if (pfIsOpen()) renderProfile();
}

// ── PRESENCE ──
async function loadPresence() {
  const data = await api('GET', '/users/presence');
  if (data) {
    S.presenceReady = true;
    S.presence = {}; S.lastSeen = {}; S.presenceMobile = {};
    for (const [id, v] of Object.entries(data)) {
      if (v && typeof v === 'object') { S.presence[id] = v.status; S.presenceMobile[id] = !!v.mobile && v.status === 'online'; if (v.last_seen) S.lastSeen[id] = v.last_seen; }
      else S.presence[id] = v; // совместимость со старым сервером
    }
    renderChatList();
  }
}

function formatLastSeen(ts) {
  if (!ts) return 'Был в сети';
  const d = new Date(ts * 1000);
  const diffSec = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diffSec < 60) return 'Был в сети только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Был в сети ${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Был в сети ${diffH} ч. назад`;
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay = new Date(d); msgDay.setHours(0,0,0,0);
  if (msgDay.getTime() === today.getTime()) return `Был в сети сегодня в ${time}`;
  if (msgDay.getTime() === yesterday.getTime()) return `Был в сети вчера в ${time}`;
  const diffDays = Math.floor((today - msgDay) / 86400000);
  if (diffDays < 7) {
    const days = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
    return `Был в сети в ${days[d.getDay()]} в ${time}`;
  }
  return `Был в сети ${d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function peerStatusText(userId) {
  // Присутствие видно только своим из пространства и тем, с кем контакты добавлены с обеих сторон; у остальных заглушка
  if (S.presenceReady && S.presence[userId] === undefined) return 'Был давно';
  const st = S.presence[userId] || 'offline';
  if (st === 'online') return 'Онлайн';
  if (st === 'away') return 'Отошёл';
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
  const st = S.presence[userId] || 'offline';
  return `<span class="presence-dot${st === 'away' ? ' away' : ''}${st === 'online' && S.presenceMobile?.[userId] ? ' mob' : ''}" data-user-id="${userId}"${st === 'offline' ? ' style="display:none"' : ''}></span>`;
}

// Служебный чат с системой («Electron», chats.system_kind): только для чтения, у собеседника нет профиля, присутствия и контакта
const isSysChat = c => !!c?.system_kind;
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
  return `<div class="pp-av ${userAvatarColor(u.id, u.tag)}"><span>${initials(u.display_name)}</span><img src="${httpProto()}://${S.server}/api/users/${u.id}/avatar" loading="lazy" data-on-error="__h22"></div>`;
}

// ── НОВЫЙ ЧАТ ──
// Два шага: сначала выбор вида (личный или группа), потом список людей. Раньше
// на одном экране были вкладки «Личный/Группа», и тип приходилось выбирать до
// того, как понятно, кого добавляешь.
const NC_ICON = {
  person: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  group:  '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
};

function openNewChat() {
  S.ncSelected = new Set();
  S.ncKind = null;
  S.newGroupAvatarBase64 = null;
  ncStep1();
  openModal('modal-newchat');
}

function closeNewChat() { closeModal('modal-newchat'); }

function ncHead(title, step, back) {
  document.getElementById('nc-title').textContent = title;
  document.getElementById('nc-step').textContent = step;
  document.getElementById('nc-back').style.display = back ? '' : 'none';
}

function ncStep1() {
  S.ncKind = null;
  S.ncSelected = new Set();
  ncHead('Новый чат', '', false);
  document.getElementById('nc-body').innerHTML = `
    <div class="nc-kinds">
      <button class="nc-kind" data-on-click="ncPick" data-a-click='["direct"]'>
        <span class="nc-kind-ic">${NC_ICON.person}</span>
        <span class="nc-kind-txt"><b>Личный чат</b><span>Личная переписка с пользователем</span></span>
        <span class="nc-kind-go">›</span>
      </button>
      <button class="nc-kind" data-on-click="ncPick" data-a-click='["group"]'>
        <span class="nc-kind-ic">${NC_ICON.group}</span>
        <span class="nc-kind-txt"><b>Группа</b><span>Общая переписка с названием и участниками</span></span>
        <span class="nc-kind-go">›</span>
      </button>
    </div>`;
}

function ncPick(kind) {
  S.ncKind = kind;
  S.ncSelected = new Set();
  const group = kind === 'group';
  ncHead(group ? 'Новая группа' : 'Личный чат', 'Шаг 2 из 2', true);
  document.getElementById('nc-body').innerHTML = `
    ${group ? `<div class="nc-group-bar">
      <div class="av av-md av-round av-green" id="new-group-av" style="cursor:pointer;flex-shrink:0" data-on-click="triggerGroupAvatarUpload">Г</div>
      <input id="group-name" class="nc-name-input" placeholder="Название группы" autocomplete="off">
      <input type="file" id="group-avatar-input" accept="image/*" style="display:none" data-on-change="onGroupAvatarChange" data-a-change='["__this"]'>
    </div>` : ''}
    <div class="nc-search">
      ${NC_ICON.search}
      <input id="nc-search-input" placeholder="Поиск по имени или логину" autocomplete="off" data-on-input="filterModalUsers" data-a-input='["__value"]'>
    </div>
    <div id="nc-list" class="users-list nc-list"></div>
    ${group ? `<div class="nc-foot">
      <span class="nc-hint" id="nc-hint">Отметьте участников</span>
      <button class="modal-btn-ghost" data-on-click="ncBack">Назад</button>
      <button class="modal-btn-primary" data-on-click="createGroup">Создать группу</button>
    </div>` : `<div class="nc-foot"><span class="nc-hint">Нажмите на человека — откроется переписка</span></div>`}`;
  renderModalUsers('nc-list', group);
  document.getElementById(group ? 'group-name' : 'nc-search-input')?.focus();
}

function ncBack() { ncStep1(); }

function ncUpdateHint() {
  const el = document.getElementById('nc-hint');
  if (!el) return;
  const n = S.ncSelected?.size || 0;
  el.textContent = n ? `Выбрано: ${n}` : 'Отметьте участников';
}

function renderModalUsers(containerId, multi, filter='') {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Людей с других серверов нельзя добавить в группу и позвать в секретный чат: с ними только обычная личная переписка
  const list = S.allUsers.filter(u=>isPickable(u)&&!(u.federated&&((multi&&u.rel!=='ws')||S.ncKind==='secret'))&&(!filter||u.display_name.toLowerCase().includes(filter)||u.username.toLowerCase().includes(filter)));
  container.innerHTML = list.map(u=>`
    <div class="pp-row${multi&&S.ncSelected?.has(u.id)?' on':''}" data-uid="${u.id}" data-on-click="${multi ? 'toggleModalUser' : 'startDirect'}" data-a-click="${esc(JSON.stringify([u.id]))}">
      ${ppAvHtml(u)}
      <div class="pp-col"><div class="pp-line"><span class="pp-name">${esc(u.display_name)}</span>${u.tag?`<span class="pp-tag ${senderNameClass(u.tag)}">${esc(u.tag)}</span>`:''}</div>${wsTag(u)}</div>
      ${multi ? '<span class="pp-chk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' : ''}
    </div>`).join('') || '<div class="pp-empty">Нет пользователей</div>';
}

function filterModalUsers(q) {
  renderModalUsers('nc-list', S.ncKind === 'group', (q || '').toLowerCase());
}

function toggleModalUser(id) {
  if (!S.ncSelected) S.ncSelected = new Set();
  if (S.ncSelected.has(id)) S.ncSelected.delete(id);
  else S.ncSelected.add(id);
  const q = (document.getElementById('nc-search-input')?.value || '').toLowerCase();
  renderModalUsers('nc-list', true, q);
  ncUpdateHint();
}

async function startDirect(userId) {
  const data = await api('POST','/chats/direct',{user_id:userId});
  if (data?.id) {
    closeNewChat(); await loadChats();
    if (!S.chats.some(c => c.id === data.id)) { showActionToast('Не удалось открыть чат'); return; }
    openChat(data.id);
  } else showActionToast(data?.error || 'Не удалось открыть чат');
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
    closeNewChat();
    await loadChats(); openChat(data.id);
  }
}


// ── ПРОФИЛЬ ГРУППЫ И КОМНАТЫ ──
// Окно поверх переписки, как профиль человека. Шапка (аватарка, название, кнопки, поиск, чипы) стоит на месте,
// список участников прокручивается отдельно. Изменения применяются сразу, кнопки «Сохранить» нет.
const GM_I = {
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  plus: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  cam: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const gmSvg = (n, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GM_I[n]}</svg>`;
const gmIsOpen = () => !!S.gm && !!document.getElementById('modal-group')?.classList.contains('open');
const gmChat = () => S.chats.find(c => c.id === S.gm?.id);

function gmPerms(chat) {
  const room = chat.type === 'room', mirror = !!chat.fed_mirror, boss = chat.created_by === S.user.id || !!S.user.is_admin;
  return {
    mirror, room,
    canEdit: !mirror && (room ? !!S.user.is_admin : boss),       // состав и аватарка
    canRename: !mirror && !room && boss,                          // название комнаты меняется в админке
    canLeave: !room || mirror,                                    // из своей комнаты не выйти
    canDelete: !mirror && !room && boss,
  };
}
function openGroupInfo(chatId) {
  if (!S.chats.find(c => c.id === chatId)) return;
  S.gm = { id: chatId, f: 'all', q: '', view: 'main', add: new Set(), aq: '', rename: false, cmp: false };
  renderGroupProfile();
  openModal('modal-group');
}
function gmMembers(chat) {
  const list = (chat.members || []).slice();
  if (!list.some(m => m.id === S.user.id)) list.push({ id: S.user.id, display_name: S.user.display_name, username: S.user.username, tag: S.user.tag });
  return list;
}
function gmStatus(m) {
  if (m.id === S.user.id) return { t: 'в сети', cls: 'on' };
  const st = S.presence[m.id];
  if (st === 'online') return { t: 'в сети', cls: 'on' };
  if (st === 'away') return { t: 'отошёл', cls: '' };
  if (S.presenceReady && st === undefined) return { t: 'был(а) давно', cls: '' };
  const s = formatLastSeen(S.lastSeen[m.id]);
  return { t: s.charAt(0).toLowerCase() + s.slice(1), cls: '' };
}
function gmSorted(list, chat) {
  const rank = m => m.id === chat.created_by ? 0 : (m.id === S.user.id || S.presence[m.id] === 'online') ? 1 : S.presence[m.id] === 'away' ? 2 : 3;
  return list.slice().sort((a, b) => rank(a) - rank(b) || (a.display_name || '').localeCompare(b.display_name || '', 'ru'));
}
function gmOnlineCount(chat, members) {
  const o = (S.chatOnline || {})[chat.id];
  if (o) return { online: o.online, total: o.total };
  return { online: members.filter(m => m.id === S.user.id || S.presence[m.id] === 'online' || S.presence[m.id] === 'away').length, total: members.length };
}
function gmSubText(chat, members) {
  const c = gmOnlineCount(chat, members);
  return `${nMembers(c.total)} · ${c.online} в сети`;
}
function gmAv(m, size) {
  const z = size || 36;
  return `<div class="av-wrap"><div class="av av-round ${userAvatarColor(m.id, m.tag)}" style="width:${z}px;height:${z}px;font-size:${z > 38 ? 14 : 12}px" data-av-user="${m.id}">${initials(m.display_name || m.username || '?')}</div>${m.federated ? fedDotRaw() : presenceDot(m.id)}</div>`;
}
// Строка участника — как в мобильном клиенте (профиль группы): аватарка, имя, статус под ним, справа метка роли или тега
function gmRow(m, chat, perms, pending) {
  const self = m.id === S.user.id, st = gmStatus(m);
  const login = m.federated ? fedAddr(m) : '@' + (m.username || '');
  const pill = (t, cls, st_) => `<span class="pill-tag ${cls || ''}"${st_ ? ` style="${st_}"` : ''}>${esc(t)}</span>`;
  const right = pending ? pill('ждёт ответа', '', 'color:var(--accent-ink)')
    : m.id === chat.created_by && !perms.mirror ? pill('создатель', '', 'color:var(--accent-ink)')
    : (m.tag ? pill(m.tag, 'pp-tag ' + senderNameClass(m.tag)) : '');
  const contact = !pending && !self && needsContact(m.id) ? `<button class="gm-mini" data-on-click="__h39" data-a-click="${esc(JSON.stringify([m.id]))}">В контакты</button>` : '';
  const kick = (pending || (perms.canEdit && !self && m.id !== chat.created_by)) && perms.canEdit
    ? `<button class="gm-x" title="${pending ? 'Отменить приглашение' : 'Убрать из группы'}" aria-label="${pending ? 'Отменить приглашение' : 'Убрать из группы'}" data-on-click="__h40" data-a-click="${esc(JSON.stringify([m.id, !!pending]))}">${gmSvg('x', 15)}</button>` : '';
  return `<div class="mini${pending ? ' pend' : ''}" ${self || pending ? '' : `data-on-click="gmOpenMember" data-a-click="${esc(JSON.stringify([m.id]))}"`}>${gmAv(m, 40)}<span class="rt"><b>${esc(m.display_name || m.username || '')}${self ? ' (вы)' : ''}</b><small data-u="${m.id}" class="${pending ? '' : (st.cls ? 'on' : '')}">${esc(pending ? login : st.t)}</small></span>${right}${contact}${kick}</div>`;
}
function gmFilter(list, q) {
  q = q.trim().toLowerCase();
  return q ? list.filter(m => (m.display_name || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q) || (m.login || '').toLowerCase().includes(q)) : list;
}
function renderGroupProfile(keep) {
  const g = S.gm, chat = gmChat(), box = document.getElementById('gm-modal');
  if (!g || !chat || !box) return;
  if (g.view === 'add') { box.classList.remove('gmm'); return renderGroupAdd(keep); }
  box.classList.add('gmm');
  const perms = gmPerms(chat), all = gmMembers(chat);
  const local = gmSorted(all.filter(m => !m.federated), chat), fed = gmSorted(all.filter(m => m.federated), chat);
  const pend = (chat.pending || []);
  const showChips = fed.length > 0 || pend.length > 0;
  if (!showChips) g.f = 'all';
  if (g.f === 'pend' && !pend.length) g.f = 'all';
  const lf = gmFilter(local, g.q), ff = gmFilter(fed, g.q), pf = gmFilter(pend, g.q);
  const show = k => g.f === 'all' || g.f === k;
  const muted = S.mutedChats.has(chat.id);
  const kind = chat.type === 'room' ? 'Комната' : 'Группа';
  const q = g.q.trim();
  const none = '<div class="cell"><span class="cl" style="color:var(--text2)">Никого не нашли</span></div>';
  const chip = (k, label, n) => `<button type="button" class="chip${g.f === k ? ' on' : ''}" data-on-click="gmFilterSet" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label} ${n}</button>`;
  // Оформление перенесено из мобильного клиента (/m, профиль группы и комнаты): шапка-капсула, аватарка, плитки, поиск, переключатель фильтров как у папок и стеклянные списки
  let lists = '';
  if (show('local')) lists += `<div class="gl">${fed.length ? 'На этом сервере' : 'Участники'} · ${lf.length}${lf.length !== local.length ? ' из ' + local.length : ''}</div><div class="grp glass">${lf.map(m => gmRow(m, chat, perms)).join('') || none}${perms.canEdit && g.f !== 'pend' && !q ? `<button type="button" class="mini" data-on-click="gmAddView"><span class="ci" style="background:var(--accent)">${gmSvg('plus', 17)}</span><span class="rt"><b style="color:var(--accent-ink)">Добавить участников</b></span></button>` : ''}</div>`;
  if (fed.length && show('fed')) lists += `<div class="gl">С других серверов · ${ff.length}</div><div class="grp glass">${ff.map(m => gmRow(m, chat, perms)).join('') || none}</div>`;
  if (pend.length && show('pend')) lists += `<div class="gl">Ждут ответа · ${pf.length}</div><div class="grp glass">${pf.map(m => gmRow({ ...m, federated: true }, chat, perms, true)).join('') || none}</div>`;
  if (perms.canDelete && g.f === 'all' && !q) lists += `<div class="grp glass"><button type="button" class="cell" data-on-click="gmDelete"><span class="cl red">Удалить группу</span></button></div>`;
  const tiles = [
    perms.canEdit ? `<button type="button" class="tile glass gi" data-on-click="gmAddView">${gmSvg('plus', 22)}Добавить</button>` : '',
    perms.canEdit ? `<button type="button" class="tile glass gi" data-on-click="gmGuest">${gmSvg('link', 22)}Гость</button>` : '',
    `<button type="button" class="tile glass gi" data-on-click="gmMute" data-a-click='["__event"]'>${gmSvg(muted ? 'bell' : 'bellOff', 22)}${muted ? 'Звук' : 'Без звука'}</button>`,
    `<button type="button" class="tile glass gi" data-on-click="openChatMedia" data-a-click="${esc(JSON.stringify([chat.id]))}">${gmSvg('image', 22)}Медиа</button>`,
    perms.canLeave ? `<button type="button" class="tile glass gi d" data-on-click="gmLeave">${gmSvg('out', 22)}Выйти</button>` : '',
  ].filter(Boolean);
  const prev = box.querySelector('.pm-scroll'), top = prev ? prev.scrollTop : 0, qHad = document.activeElement?.id === 'gm-q';
  const pFin = box.querySelector('.fin'), pLeft = pFin ? pFin.scrollLeft : 0, pTh = pFin?.querySelector('.thumb'), pThumb = pTh && pTh.style.width ? { l: pTh.style.left, w: pTh.style.width } : null;
  box.innerHTML = `
    <div class="pm-scroll">
      <div class="pm-nav"><span class="pm-t glass">${kind}</span><button class="pm-x glass gi" type="button" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-group"]'>${gmSvg('x', 18)}</button></div>
      <div class="hero">
        <div class="pgav"><div class="av av-round ${chatAvatarClass(chat)}" id="gm-av" data-av-chat="${chat.id}">${chatIcon(chat)}</div>
          ${perms.canEdit ? `<label class="pgcam" title="Сменить аватарку">${gmSvg('cam', 15)}<input type="file" accept="image/*" hidden data-on-change="gmAvatar" data-a-change='["__this"]'></label>` : ''}${perms.mirror ? `<span class="gm-fedbig">${FED_GLOBE}</span>` : ''}</div>
        ${g.rename ? `<div class="gm-nm1"><input id="gm-name" value="${esc(chat.name || '')}" maxlength="60" data-on-keydown="__h42" data-on-blur="gmRenameSave" data-a-blur='["__value"]'></div>`
          : `<h2 class="gm-nm1"><span class="gm-name">${esc(chatName(chat))}</span>${perms.canRename ? `<button class="gm-pen" title="Переименовать" aria-label="Переименовать" data-on-click="gmRenameStart">${gmSvg('pen', 15)}</button>` : ''}</h2>`}
        <p id="gm-sub">${gmSubText(chat, all)}</p>
      </div>
      ${perms.mirror ? `<div class="nbanner glass" style="margin:0 0 16px">${gmSvg('info', 18)}<span><b>${kind} на другом сервере.</b> Название, состав и аватарку меняет только её владелец. Писать и ставить реакции можно, а также выйти.</span></div>` : ''}
      <div class="tiles${tiles.length > 3 ? ' sm' : ''}" style="grid-template-columns:repeat(${Math.min(tiles.length, 5)},1fr)">${tiles.join('')}</div>
      <label class="srch glass">${gmSvg('search', 18)}<input id="gm-q" value="${esc(g.q)}" placeholder="Найти участника" autocomplete="off" data-on-input="gmSearch" data-a-input='["__value"]'></label>
      ${showChips ? `<div class="fbar pgf"><div class="chips fo"><div class="fgrp glass"><div class="fin"><i class="thumb"></i>${chip('all', 'Все', all.length)}${chip('local', 'На этом сервере', local.length)}${fed.length ? chip('fed', 'С других серверов', fed.length) : ''}${pend.length ? chip('pend', 'Ждут ответа', pend.length) : ''}</div></div></div></div>` : ''}
      <div id="gm-lists">${lists}</div>
    </div>`;
  const sc = box.querySelector('.pm-scroll');
  sc.scrollTop = keep ? top : 0;
  gmChipsInit(box, pLeft, pThumb);
  applyAvatars();
  if (g.rename) { const i = document.getElementById('gm-name'); i?.focus(); i?.select(); }
  else if (qHad && keep) { const i = document.getElementById('gm-q'); if (i) { i.focus(); const l = i.value.length; try { i.setSelectionRange(l, l); } catch {} } }
}
// Переключатель фильтров, как у папок в мобильном клиенте: бегунок едет к выбранному чипу, выбранный встаёт по центру, у края, под который чипы уходят, текст гаснет
function gmChipsInit(box, left, prev) {
  const fin = box.querySelector('.fin'); if (!fin) return;
  const th = fin.querySelector('.thumb'), on = fin.querySelector('.chip.on'), grp = fin.parentNode;
  const edges = () => {
    const m = fin.scrollWidth - fin.clientWidth, x = fin.scrollLeft, l = x > 2, r = x < m - 2;
    fin.style.setProperty('--fl', l ? '22px' : '0px'); fin.style.setProperty('--fr', r ? '22px' : '0px');
    grp.style.setProperty('--bl', l ? 1 : 0); grp.style.setProperty('--br', r ? 1 : 0);
  };
  fin.addEventListener('scroll', edges, { passive: true });
  fin.scrollLeft = left || 0;
  if (th && on && on.offsetWidth) {
    if (prev && prev.w) { th.style.transition = 'none'; th.style.left = prev.l; th.style.width = prev.w; void th.offsetWidth; th.style.transition = ''; }
    th.style.left = on.offsetLeft + 'px'; th.style.width = on.offsetWidth + 'px';
    if (S.gm?.center) {
      S.gm.center = false;
      const fr = fin.getBoundingClientRect(), br = on.getBoundingClientRect();
      fin.scrollTo({ left: fin.scrollLeft + (br.left + br.width / 2) - (fr.left + fr.width / 2), behavior: 'smooth' });
    }
  }
  edges();
}
// Шапка сворачивается, только если списка хватает и после сворачивания: иначе она мигала бы
function gmOnScroll(e) {
  const sc = e.target, box = document.getElementById('gm-modal'), cmp = box.classList.contains('cmp'), st = sc.scrollTop, over = sc.scrollHeight - sc.clientHeight;
  if (!cmp && st > 40 && over > 330) { box.classList.add('cmp'); S.gm.cmp = true; }
  else if (cmp && st < 4) { box.classList.remove('cmp'); S.gm.cmp = false; }
}
function gmFilterSet(k) { S.gm.f = k; S.gm.center = true; renderGroupProfile(true); }
function gmSearch(v) { S.gm.q = v; renderGroupProfile(true); }
function gmPaintSub() {
  const chat = gmChat(), el = document.getElementById('gm-sub');
  if (chat && el && S.gm?.view === 'main') el.textContent = gmSubText(chat, gmMembers(chat));
}
function gmPaintStatus() {
  const chat = gmChat(); if (!chat || S.gm?.view !== 'main') return;
  document.querySelectorAll('#gm-modal small[data-u]').forEach(el => { const m = gmMembers(chat).find(x => x.id === +el.dataset.u); if (!m) return; if (el.closest('.pend')) return; const st = gmStatus(m); el.textContent = st.t; el.classList.toggle('on', !!st.cls); });
  gmPaintSub();
}
function gmOpenMember(id) { openProfile(id); }
// Гостевая ссылка: вход в группу или комнату без учётной записи на время (окно — shared/guestlinks.js)
function gmGuest() {
  const chat = gmChat(); if (!chat || typeof GuestLinks === 'undefined') return;
  GuestLinks.open({ chatId: chat.id, chatName: chatName(chat), request: async (method, path, body) => {
    try {
      const res = await fetch(`${httpProto()}://${S.server}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: body ? JSON.stringify(body) : undefined });
      let data = null; try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data: data || {} };
    } catch { return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } }; }
  } });
}
async function gmMute(ev) {
  const id = S.gm.id;
  if (S.mutedChats.has(id)) { await unmuteChat(id); return; }
  const r = ev?.currentTarget?.getBoundingClientRect?.();
  showMuteMenu(id, r ? r.left : 200, r ? r.bottom : 200, r || null);
}
function gmRenameStart() { S.gm.rename = true; renderGroupProfile(true); }
async function gmRenameSave(v) {
  const g = S.gm; if (!g || !g.rename) return;
  g.rename = false;
  const chat = gmChat(), name = (v || '').trim();
  if (chat && name && name !== chat.name) {
    const r = await api('PATCH', `/chats/${chat.id}`, { name });
    if (r?.error) showActionToast(r.error);
    await loadChats();
  }
  renderGroupProfile(true);
}
async function gmAvatar(input) {
  const file = input.files[0]; if (!file) return;
  const data = await resizeAvatarFile(file);
  const r = await api('POST', `/chats/${S.gm.id}/avatar`, { data });
  if (r?.error) { showActionToast(r.error); return; }
  await loadAvatarIndex();
  S.avatarTs = Date.now(); _avatarCache.clear();
  applyAvatars(); renderChatList();
}
async function gmKick(userId, pending) {
  const chat = gmChat(); if (!chat) return;
  const m = pending ? (chat.pending || []).find(x => x.id === userId) : (chat.members || []).find(x => x.id === userId);
  const ok = await showConfirm(pending ? `Отменить приглашение для ${m?.display_name || 'этого человека'}?` : `Убрать ${m?.display_name || 'участника'} из ${chat.type === 'room' ? 'комнаты' : 'группы'}?`, pending ? 'Отменить приглашение' : 'Убрать');
  if (!ok) return;
  const r = await api('DELETE', `/chats/${chat.id}/members/${userId}`);
  if (r?.error) { showActionToast(r.error); return; }
  await loadChats();
}
async function gmLeave() {
  const id = S.gm.id;
  if (await leaveGroup(id)) closeModal('modal-group');
}
async function gmDelete() {
  await deleteChat(S.gm.id);
}

// Добавление участников: тот же список выбора, внутри окна
function gmAvailable(chat) {
  const existing = new Set((chat.members || []).map(m => m.id)), pending = new Set((chat.pending || []).map(m => m.id));
  const isGroup = chat.type === 'group', q = S.gm.aq.trim().toLowerCase();
  return S.allUsers.filter(u => isPickable(u) && (!u.federated || (isGroup && (u.contact || u.rel === 'ws'))) && !pending.has(u.id) && !existing.has(u.id)
    && (!q || (u.display_name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)));
}
function gmAddView() { S.gm.view = 'add'; S.gm.add = new Set(); S.gm.aq = ''; renderGroupProfile(); }
function gmAddBack() { S.gm.view = 'main'; renderGroupProfile(); }
function renderGroupAdd(keep) {
  const g = S.gm, chat = gmChat(), box = document.getElementById('gm-modal');
  if (!chat) return;
  box.classList.remove('cmp');
  const list = gmAvailable(chat), n = g.add.size;
  const row = u => `<button type="button" class="gm-pick${g.add.has(u.id) ? ' on' : ''}" data-on-click="gmAddToggle" data-a-click="${esc(JSON.stringify([u.id]))}" role="checkbox" aria-checked="${g.add.has(u.id)}">
      <div class="av-wrap"><div class="av av-round ${userAvatarColor(u.id, u.tag)}" style="width:36px;height:36px;font-size:12px" data-av-user="${u.id}">${initials(u.display_name)}</div>${u.federated ? fedDotRaw() : ''}</div>
      <div class="gm-nm"><b>${esc(u.display_name)}</b><span class="gm-l">${u.federated ? esc(fedAddr(u)) + ' · после согласия' : '@' + esc(u.username)}</span></div>
      <span class="gm-chk">${gmSvg('check', 13, 3)}</span></button>`;
  const prev = box.querySelector('.gm-scroll'), top = prev && keep ? prev.scrollTop : 0;
  box.innerHTML = `
    <div class="gm-top"><button class="icon-btn" data-on-click="gmAddBack" aria-label="Назад">${gmSvg('back', 18)}</button><span class="t">Добавить участника</span><button class="icon-btn" data-on-click="closeModal" data-a-click='["modal-group"]' aria-label="Закрыть">${gmSvg('x', 16)}</button></div>
    <div class="gm-tools" style="padding-top:4px"><label class="gm-search">${gmSvg('search', 15)}<input id="gm-aq" value="${esc(g.aq)}" placeholder="Имя или логин" autocomplete="off" data-on-input="gmAddSearch" data-a-input='["__value"]'></label></div>
    <div class="gm-listwrap"><div class="gm-scroll">${list.map(row).join('') || '<div class="gm-none">Некого добавить</div>'}
      ${chat.type === 'group' ? '' : '<p class="gm-hint">Людей с других серверов в комнаты добавляет администратор в админке.</p>'}</div></div>
    <div class="gm-foot"><span class="gm-cnt">${n ? 'Выбрано: ' + n : 'Отметьте людей'}</span><button class="modal-btn-ghost" data-on-click="gmAddBack">Отмена</button><button class="modal-btn-primary" ${n ? '' : 'disabled'} data-on-click="gmAddConfirm">Добавить</button></div>`;
  box.querySelector('.gm-scroll').scrollTop = top;
  applyAvatars();
  if (document.activeElement === document.body && g.aq) { const i = document.getElementById('gm-aq'); i?.focus(); }
}
function gmAddToggle(id) { const a = S.gm.add; a.has(id) ? a.delete(id) : a.add(id); renderGroupAdd(true); }
function gmAddSearch(v) { S.gm.aq = v; renderGroupAdd(true); const i = document.getElementById('gm-aq'); if (i) { i.focus(); const l = i.value.length; try { i.setSelectionRange(l, l); } catch {} } }
async function gmAddConfirm() {
  const chat = gmChat(); if (!chat || !S.gm.add.size) return;
  const res = await Promise.all([...S.gm.add].map(uid => api('POST', `/chats/${chat.id}/members`, { user_id: uid })));
  const err = res.find(r => r?.error);
  if (err) showActionToast(err.error);
  else if (res.some(r => r?.pending)) showActionToast('Приглашение отправлено. Человек появится в группе после согласия');
  S.gm.view = 'main'; S.gm.add = new Set();
  await loadChats();
  renderGroupProfile();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('lightbox')?.classList.contains('lb-open')) return;   // Esc закрывает только просмотр фото и видео
  if (document.getElementById('modal-media')?.classList.contains('open')) { closeModal('modal-media'); return; }
  if (document.getElementById('modal-profile')?.classList.contains('open')) { closeModal('modal-profile'); return; }   // сначала закрывается профиль человека поверх
  if (gmIsOpen() && !S.gm.rename) { e.preventDefault(); if (S.gm.view === 'add') gmAddBack(); else closeModal('modal-group'); }
});

// ── CHAT LIST CONTEXT MENU ──
function showChatCtx(e, chatId) {
  e.preventDefault();
  e.stopPropagation();
  const chat = S.chats.find(c => c.id === chatId);
  if (chat?.invite) return;   // у приглашения нет действий: только «Вступить» и «Отклонить»
  S.ctxChatId = chatId;
  S.ctxChatPos = { x: e.clientX, y: e.clientY };
  document.getElementById('ctx-chat-folder')?.classList.remove('open');
  const menu = document.getElementById('ctx-chat-menu');
  const isRoom = chat?.type === 'room';
  const isGroup = chat?.type === 'group';

  // pin/delete/leave скрыты для комнат (управляются через админку)
  const pinBtn = document.getElementById('ctx-chat-pin');
  const pinLabel = document.getElementById('ctx-chat-pin-label');
  if (pinBtn) pinBtn.style.display = isRoom ? 'none' : '';
  if (pinLabel) pinLabel.textContent = chat?.pinned ? 'Открепить' : 'Закрепить';
  const canDelete = !isGroup || (!chat.fed_mirror && (chat.created_by === S.user.id || S.user.is_admin));
  const delBtn = document.getElementById('ctx-chat-delete');
  const leaveBtn = document.getElementById('ctx-chat-leave');
  if (delBtn) delBtn.style.display = (isRoom || (!isRoom && !canDelete)) ? 'none' : '';
  if (leaveBtn) leaveBtn.style.display = (isGroup && !canDelete) ? '' : 'none';

  const blockBtn = document.getElementById('ctx-chat-block');
  if (blockBtn) {
    const pid = chat?.type === 'direct' && !isSysChat(chat) ? getPeerUserId(chat) : null;
    blockBtn.style.display = pid ? '' : 'none';
    const bl = document.getElementById('ctx-chat-block-label'); if (bl && pid) bl.textContent = isBlockedId(pid) ? 'Разблокировать' : 'Заблокировать';
  }
  const devicesBtn = document.getElementById('ctx-chat-devices');
  if (devicesBtn) devicesBtn.style.display = chat?.is_secret ? '' : 'none';
  const _muted = S.mutedChats.has(chatId);
  const _um = document.getElementById('ctx-chat-unmute'), _ms = document.getElementById('ctx-chat-mute-sub');
  if (_um) _um.style.display = _muted ? '' : 'none';
  if (_ms) { _ms.style.display = _muted ? 'none' : ''; _ms.classList.remove('open'); }
  popShow(menu);
  menu.style.display = 'block';
  // Клик по кнопке «⋯» в шапке — привязываемся к кнопке; правый клик по чату в списке — к курсору
  const btn = e.type === 'click' ? e.currentTarget : null;
  placeCtxMenu(menu, e.clientX, e.clientY, btn ? btn.getBoundingClientRect() : null);
}

async function ctxChatLeave() {
  hideChatCtx();
  if (!S.ctxChatId) return;
  await leaveGroup(S.ctxChatId);
}

async function ctxChatPin() {
  hideChatCtx();
  if (!S.ctxChatId) return;
  await api('POST', `/chats/${S.ctxChatId}/pin`);
  await loadChats();
}

async function ctxChatDelete() {
  hideChatCtx();
  if (!S.ctxChatId) return;
  await deleteChat(S.ctxChatId);
}


// ── «Без звука» на время ──
// Включить звук — сразу; выключить — на 1 час, 8 часов, сутки или навсегда (меню у места нажатия)
const MUTE_OPTS = [['На 1 час', 3600], ['На 8 часов', 28800], ['На сутки', 86400], ['Навсегда', 0]];
// Колокольчик со сроком: на часы — одна «z», на сутки — две, навсегда — перечёркнутый (колокольчик Lucide, «z» дорисованы)
function muteIcon(secs) {
  const a = 'width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  if (!secs) return `<svg ${a}><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>`;
  const bell = '<g transform="translate(-.5 3.5) scale(.82)"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g>';
  const z = secs <= 28800 ? '<path d="M16 2.5h5.5L16 9h5.5" stroke-width="1.8"/>' : '<path d="M13.5 8h3.5l-3.5 4.2H17" stroke-width="1.6"/><path d="M18 2.5h4L18 7.7h4" stroke-width="1.6"/>';
  return `<svg ${a}>${bell}${z}</svg>`;
}
function hideMuteMenu() { const m = document.getElementById('mute-menu'); if (m) m.style.display = 'none'; }
function showMuteMenu(chatId, x, y, anchor) {
  let m = document.getElementById('mute-menu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mute-menu';
    m.className = 'ctx-menu';
    document.body.appendChild(m);
    document.addEventListener('mousedown', e => { if (!e.target.closest('#mute-menu')) hideMuteMenu(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMuteMenu(); });
  }
  const bell = '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';
  m.innerHTML = MUTE_OPTS.map(([l, s]) => `<button type="button" data-on-click="setChatMute" data-a-click="${esc(JSON.stringify([chatId, s]))}">${muteIcon(s)}<span>${l}</span></button>`).join('');
  m.style.display = 'block';
  m.classList.remove('pop-out'); m._popOut = false;
  placeCtxMenu(m, x, y, anchor || null);
}
async function setChatMute(chatId, secs) {
  hideMuteMenu();
  const r = await api('POST', `/chats/${chatId}/mute`, secs ? { seconds: secs } : {});
  if (r?.error) { showActionToast(r.error); return; }
  S.mutedChats.add(chatId);
  S.mutedUntil[chatId] = secs ? Math.floor(Date.now() / 1000) + secs : 0;
  watchMutes();
  renderChatList();
  if (typeof gmIsOpen === 'function' && gmIsOpen() && S.gm.id === chatId) renderGroupProfile(true);
}
async function unmuteChat(chatId) {
  await api('DELETE', `/chats/${chatId}/mute`);
  S.mutedChats.delete(chatId); delete S.mutedUntil[chatId];
  renderChatList();
  if (typeof gmIsOpen === 'function' && gmIsOpen() && S.gm.id === chatId) renderGroupProfile(true);
}
// Когда срок «без звука» истекает, список чатов перечитывается сам: звук и счётчики возвращаются
let _muteTimer = null;
function watchMutes() {
  clearTimeout(_muteTimer);
  const now = Math.floor(Date.now() / 1000);
  const next = Math.min(Infinity, ...Object.values(S.mutedUntil).filter(t => t && t > now));
  if (next < Infinity) _muteTimer = setTimeout(() => loadChats(), Math.min((next - now + 1) * 1000, 2147000000));
}

// «Выключить уведомления» в меню чата — подменю, как «В папку»: по наведению (или нажатию) справа раскрывается карточка с выбором срока
function ctxMuteFill() {
  const fly = document.getElementById('ctx-mute-fly'); if (!fly) return;
  const bell = '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>';
  fly.innerHTML = MUTE_OPTS.map(([l, s]) => `<button type="button" data-ms="${s}">${muteIcon(s)}<span>${l}</span></button>`).join('');
}
function ctxMutePlace() {
  const menu = document.getElementById('ctx-chat-menu'), wrap = document.getElementById('ctx-chat-mute-sub'), fly = document.getElementById('ctx-mute-fly');
  if (!menu || !wrap || !fly) return;
  const m = zoomMetrics();
  const sc = parseFloat(getComputedStyle(menu).scale) || 1;
  const cr = menu.getBoundingClientRect(), rr = wrap.getBoundingClientRect();
  const fw = fly.offsetWidth * m.k * sc, fh = fly.offsetHeight * m.k * sc, margin = 6;
  const toRight = m.vw - cr.right >= fw + margin + 4 || cr.left < fw + margin + 4;
  fly.classList.toggle('l', !toRight);
  fly.style.left = toRight ? 'calc(100% - 2px)' : 'auto';
  fly.style.right = toRight ? 'auto' : 'calc(100% - 2px)';
  let top = rr.top - cr.top - 7 * m.k * sc;
  const over = cr.top + top + fh - (m.vh - margin);
  if (over > 0) top -= over;
  if (cr.top + top < margin) top = margin - cr.top;
  fly.style.top = (top / (m.k * sc)) + 'px';
}
function ctxMuteSet(on) {
  const wrap = document.getElementById('ctx-chat-mute-sub');
  if (!wrap || wrap.classList.contains('open') === on) return;
  if (on) { ctxMuteFill(); ctxMutePlace(); }
  wrap.classList.toggle('open', on);
  wrap.querySelector('button')?.setAttribute('aria-expanded', on);
}
let _ctxMuteT = null;
function ctxMuteHover(on) {
  clearTimeout(_ctxMuteT);
  if (on) ctxMuteSet(true); else _ctxMuteT = setTimeout(() => ctxMuteSet(false), 170);
}
function ctxMuteToggle(e) {
  e && e.stopPropagation();
  ctxMuteSet(!document.getElementById('ctx-chat-mute-sub').classList.contains('open'));
}
function ctxMuteClick(e) {
  e.stopPropagation();
  const b = e.target.closest('button[data-ms]'); if (!b) return;
  const id = S.ctxChatId;
  hideChatCtx();
  if (id) setChatMute(id, +b.dataset.ms);
}

async function ctxChatMute() {
  const id = S.ctxChatId, pos = S.ctxChatPos || { x: 200, y: 200 };
  hideChatCtx();
  if (!id) return;
  if (S.mutedChats.has(id)) { await unmuteChat(id); return; }
  showMuteMenu(id, pos.x, pos.y);
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
  S.forwardMsg.src = msgId;   // какое сообщение переслали: по нему сервер считает отметку «переслали N раз»
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
    u.id !== S.user.id && isPickable(u) && !directUserIds.has(u.id) &&
    (!q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
  );
  let html = '';
  if (chats.length) {
    html += `<div class="chat-list-section-label">Чаты</div>`;
    html += chats.map(c => `<div class="pp-row" data-on-click="selectForwardChat" data-a-click="${esc(JSON.stringify([c.id]))}" style="cursor:pointer">
      <div class="av av-sm ${chatAvatarClass(c)}${c.type==='room' && c.has_topics?' av-sq':' av-round'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
      <span>${esc(chatName(c))}</span>
    </div>`).join('');
  }
  if (users.length) {
    html += `<div class="chat-list-section-label">Пользователи</div>`;
    html += users.map(u => `<div class="pp-row" data-on-click="selectForwardUser" data-a-click="${esc(JSON.stringify([u.id]))}" style="cursor:pointer">
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
  const previewText = Fmt.plain(S.forwardMsg.text || '') || (S.forwardMsg.attachment ? '📎 Вложение' : '');
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
// Мягкое закрытие всплывающих окон (меню, подсказки, выбор реакции): та же анимация, что при открытии, только в обратную сторону.
// finish() делает настоящее скрытие. Если окно открыли снова, пока оно закрывается, вызывается popShow(el).
function popHide(el, finish) {
  if (!el || el._popOut || getComputedStyle(el).display === 'none') return;
  el._popOut = true;
  el.classList.add('pop-out');
  el._popT = setTimeout(() => {
    if (!el._popOut) return;
    el._popOut = false;
    el.classList.remove('pop-out');
    finish();
  }, 120);
}
function popShow(el) {
  if (!el || !el._popOut) return;
  clearTimeout(el._popT);
  el._popOut = false;
  el.classList.remove('pop-out');
}
function hideChatCtx() {
  const m = document.getElementById('ctx-chat-menu');
  popHide(m, () => { m.style.display = 'none'; });
}

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

// ── Секции списка чатов — карточки ──
// У первой и последней строки группы свой угол и отступ (cg-first / cg-last), у подписи секции —
// число строк (data-n). Расставляется при любом изменении списка, чтобы не зависеть от того, кто его строит.
function markChatGroups(list) {
  if (!list) return;
  let grp = [], lbl = null;
  const flush = () => {
    grp.forEach((r, i) => { r.classList.toggle('cg-first', i === 0); r.classList.toggle('cg-last', i === grp.length - 1); });
    if (lbl && grp.length) lbl.dataset.n = grp.length;
    grp = []; lbl = null;
  };
  [...list.children].forEach(el => {
    if (el.classList.contains('chat-list-section-label')) { flush(); lbl = el; }
    else if (el.matches('.chat-item, .pp-row')) grp.push(el);
  });
  flush();
}
(function initChatGroups() {
  const run = () => { markChatGroups(document.getElementById('chats-list')); markChatGroups(document.getElementById('topics-panel')); };
  const obs = new MutationObserver(run);
  const start = () => { ['chats-list', 'topics-panel'].forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el, { childList: true }); }); run(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// Функции из const-объявлений: обработчики из HTML (act.js) находят их по имени в window
window._cacheKey = _cacheKey;
window._hhmm = _hhmm;
window._isMediaAtt = _isMediaAtt;
window._maxVH = _maxVH;
window._outKey = _outKey;
window.bootLog = bootLog;
window.composerLocked = composerLocked;
window.csAv = csAv;
window.csIsApp = csIsApp;
window.csPwBar = csPwBar;
window.csPwReady = csPwReady;
window.csSvg = csSvg;
window.csTg = csTg;
window.dmLocked = dmLocked;
window.failNoteHtml = failNoteHtml;
window.fedDotHtml = fedDotHtml;
window.fedDotRaw = fedDotRaw;
window.fedKind = fedKind;
window.fedOffline = fedOffline;
window.fedRoot = fedRoot;
window.fwdReserve = fwdReserve;
window.gmChat = gmChat;
window.gmIsOpen = gmIsOpen;
window.gmSvg = gmSvg;
window.isBlockedId = isBlockedId;
window.isPickable = isPickable;
window.myWsCount = myWsCount;
window.nMembers = nMembers;
window.needsContact = needsContact;
window.newClientId = newClientId;
window.peerSubText = peerSubText;
window.personAv = personAv;
window.scEncryptFileForUpload = scEncryptFileForUpload;
window.wsTag = wsTag;
