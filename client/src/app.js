'use strict';

// ── STATE ──
const S = {
  server: '', token: null, user: null,
  chats: [], activeChatId: null,
  ws: null, wsRetry: 0,
  unread: {}, unreadMentions: {}, allUsers: [], drafts: (()=>{ try { return JSON.parse(localStorage.getItem('chat_drafts'))||{}; } catch { return {}; } })(),
  settings: { theme: 'dark', fontSize: 'medium', uiScale: 100 },
  ctx: { messageId: null, canEdit: false, isMine: false, replyText: '', replySenderName: '' },
  editingMessageId: null,
  replyTo: null, // { id, text, senderName }
  giChatId: null, giRemovedIds: new Set(), giAddIds: new Set(), giAvatarBase64: null,
  newGroupAvatarBase64: null,
  presence: {},
  lastSeen: {}, // userId -> unix ts последнего онлайна // userId -> 'online'|'away'|'offline'
  reactions: {},
  msgStatus: {},      // messageId -> {delivered, read, total} для событий status_range
  statusApplied: {},  // messageId -> Set<'read:userId'|'delivered:userId'> для дедупликации
  chatHasMore: false,   // есть ли ещё сообщения выше
  chatOldestId: null,   // id самого старого загруженного сообщения
  chatHasMoreAfter: false, // есть ли сообщения ниже (после перехода вглубь истории)
  chatNewestId: null,      // id самого нового загруженного сообщения
  searchResults: null,     // результаты поиска по сообщениям
  topics: {},       // parentId -> [{id, name, unread, unread_mentions, has_avatar}]
  activeTopicId: null,  // id активной темы
  activeRoomId: null,     // id родительской комнаты с открытой панелью
  mutedChats: new Set(),  // set of muted chat IDs
  forwardMsg: null,       // {user_id, name, text, attachment} — сообщение для пересылки
  msgData: new Map(),     // msgId -> {forwardData, senderId, senderName, text, attachment}
  // ── Секретные чаты (E2E) ──
  secretChatIds: new Set(),  // id чатов с is_secret — быстрая проверка при рендере
  scKeys: {},                // chatId -> CryptoKey (AES-GCM, расшифрован локально)
  scDecrypted: new Map(),    // msgId -> расшифрованный текст (кэш, чтобы не дешифровать повторно)
  scAtt: new Map(),          // msgId -> {n, m, s} имя, тип, размер вложения секретного чата
  scAttBlob: new Map(),      // msgId -> blob-URL расшифрованной картинки
  scDeviceId: null,          // стабильный id этого устройства (из main-процесса)
  scRaw: {},                 // chatId -> base64 сырого ключа (то, что сохраняется на диск)
  scHidden: new Set(),       // секретные чаты, отключённые на этом устройстве (до нового сообщения)
  scMsgObjs: new Map(),      // msgId -> объект сообщения секретного чата (для перерисовки после расшифровки)
  scLoaded: false,           // ключи уже подняты из хранилища
  scPending: {},             // chatId -> {requestId, code, privateKey, timer} — активный запрос доступа
  scPendingSaved: {},        // chatId -> {requestId, code, pkcs8, expiresAt} — тот же запрос в файле ключей
  scSyncChatId: null,        // чат, для которого открыта модалка синхронизации
  scGrant: {},               // chatId -> {grantId, code} — код, который показано собеседнику
  scConfirm: null,           // данные запроса, ожидающего подтверждения этим устройством
  ctpUserId: null,           // контакт, для которого открыт выбор типа чата
};

const SESSION_KEY = 'electron_v2';
const CRED_KEY = 'electron_creds';
// Признак включённой «Высокой доступности» — выставляется один раз при старте
// (см. DOMContentLoaded ниже) и не меняется без перезапуска приложения.
let _haActive = false;
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

// Чат заглушён, если замьючен он сам или его родительская комната —
// тот же критерий, что и на сервере при отправке push
function isChatMuted(chatId, parentId) {
  return S.mutedChats.has(chatId) || (!!parentId && S.mutedChats.has(parentId));
}

// ── ACTIVITY (видит ли пользователь чат) ──
// Окно может быть видимым, но не в фокусе (за другим окном) — тогда сообщения
// не должны помечаться прочитанными, а статус должен быть «отошёл».
let _winFocused = true;
// «Смотрю» = окно в фокусе и открыта именно эта учётная запись: у остальных записей статус
// «отошёл», прочитанными сообщения не помечаются, уведомления приходят
let _accountActive = true;
function isViewing() { return !document.hidden && _winFocused && _accountActive; }

// Единая реакция на смену видимости/фокуса: прочтение активного чата + статус.
function refreshActivity() {
  const viewing = isViewing();
  if (viewing) {
    // Соединение могло умереть, пока окно было в фоне (сон, VPN, обрыв NAT):
    // мёртвое — переподключаемся, живое — досинхронизируем список чатов.
    if (S.token) {
      if (!S.ws || S.ws.readyState >= 2) connectWS();
      else loadChats();
    }
  }
  if (viewing && S.activeChatId && S.ws?.readyState===1) {
    S.ws.send(JSON.stringify({type:'read', chat_id: S.activeChatId}));
    S.unread[S.activeChatId] = 0;
    S.unreadMentions[S.activeChatId] = 0;
    updateUnreadTotal();
    renderChatList();
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

// ── PAGINATION ──
let _loadingMore = false; // флаг чтобы не делать двойной запрос
let _loadingChatId = null;

// ── AVATAR CACHE ──
const _avatarCache = new Map(); // url -> true (loaded) | false (error)

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
    if (i % 2 !== 1) return mdLite(highlightMentions(esc(part)));
    return `<a class="msg-link" href="#" onclick="openExternalLink(event,this)" data-url="${esc(part)}">${esc(part)}</a>`;
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
// Если в адресе есть порт — прямое подключение (http/ws), иначе через прокси (https/wss)
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
  const json = JSON.stringify({ server:S.server, token:S.token, user:S.user, settings:S.settings });
  localStorage.setItem(SESSION_KEY, json);
  // Запасная копия: хранилище движка теряется при переустановке с очисткой данных
  // и при порче профиля, а файл в папке пользователя переживает и то, и другое
  window.electron?.sessionSave?.(json);
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

// ── INIT ──
// Если хранилище движка пустое, поднимаем вход из запасной копии, а адрес сервера
// берём из имени установщика (Windows) — тогда сотруднику не нужно вводить его руками.
async function restoreFromDisk() {
  if (!window.electron) return;
  try {
    if (!localStorage.getItem(SESSION_KEY)) {
      const json = await window.electron.sessionLoad?.();
      if (json) localStorage.setItem(SESSION_KEY, json);
    }
    if (!localStorage.getItem('lastServer')) {
      const preset = await window.electron.getPresetServer?.();
      if (preset) localStorage.setItem('lastServer', preset);
    }
  } catch {}
}


window.addEventListener('DOMContentLoaded', async () => {
  await restoreFromDisk();
  // Версия — всегда, независимо от сессии
  if (window.electron?.getVersion) {
    window.electron.getVersion().then(v => {
      if (!v) return;
      const lv = document.getElementById('login-version');
      if (lv) lv.textContent = `v${v}`;
      const av = document.getElementById('app-version');
      if (av) av.textContent = `v${v}`;
    });
  }

  initAccounts();
  await initSharedSettings();
  const session = loadSession();
  if (session?.token) {
    // Общие настройки (если они уже есть) главнее сохранённых в сессии этой записи
    Object.assign(S, { server:session.server, token:session.token, user:session.user, settings:_sharedLoaded ? S.settings : (session.settings||S.settings) });
    applySettings();
    const ok = await Promise.race([
      api('GET', '/users/presence'),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
    if (S.token && ok !== null) enterApp();
    else fillLoginFromCreds();
  } else {
    applySettings();
    const lastServer = localStorage.getItem('lastServer');
    if (lastServer) document.getElementById('l-server').value = lastServer;
    fillLoginFromCreds();
  }

  // Show HA button on Windows only
  if (window.electron) {
    const platform = await window.electron.getPlatform();
    if (platform === 'win32') {
      const btn = document.getElementById('ha-toggle-btn');
      if (btn) {
        btn.style.display = 'flex';
        const cfg = await window.electron.getHAConfig();
        if (cfg?.drive) {
          _haActive = true;
          btn.classList.add('ha-active');
          document.getElementById('ha-toggle-label').textContent = `Высокая доступность: ${cfg.drive}:\\`;
        }
      }
    }
  }

  document.getElementById('l-password').addEventListener('keydown', e => e.key==='Enter' && doLogin());
  document.getElementById('l-server').addEventListener('keydown', e => e.key==='Enter' && document.getElementById('l-username').focus());
  document.getElementById('l-username').addEventListener('keydown', e => e.key==='Enter' && document.getElementById('l-password').focus());
  // Sidebar: restore hidden state, init peek
  if (localStorage.getItem('sidebarHidden')) {
    document.body.classList.add('sidebar-hidden', 'sidebar-overlay');
  }
  initSidebarPeek();

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
    // сначала чат, следующим нажатием — список тем
    if (S.activeChatId) { closeActiveChat(); return; }
    if (S.activeRoomId) {
      closeTopicsPanel();
      S.activeRoomId = null; S.activeTopicId = null;
      renderChatList();
      return;
    }
  });
  window.electron?.onOpenChat(chatId => { const chat = S.chats.find(c=>c.id===chatId); if(chat) openChat(chatId); });
  document.addEventListener('visibilitychange', refreshActivity);
  // Реальный фокус окна из main-процесса — авторитетный признак «пользователь смотрит».
  window.electron?.onWindowFocus?.(focused => { _winFocused = focused; refreshActivity(); });

  // ── Drag-and-drop изображений в окно чата ──
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

  // ── Вставка файла из буфера обмена ──
  document.addEventListener('paste', async e => {
    if (!S.activeChatId) return;
    const file = Array.from(e.clipboardData.items)
      .find(i => i.kind === 'file')?.getAsFile();
    if (file) { e.preventDefault(); await uploadFile(file); }
  });
});

// ── LOGIN ──
async function doLogin() {
  const server = document.getElementById('l-server').value.trim().replace(/^https?:\/\//,'');
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const err = document.getElementById('l-err');
  const btn = document.getElementById('l-btn');
  if (!server||!username||!password) { err.textContent='Заполните все поля'; return; }
  btn.disabled=true; btn.textContent='Подключение...'; err.textContent='';
  try {
    const proto = /:\d+$/.test(server) ? 'http' : 'https';
    const res = await fetch(`${proto}://${server}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const data = await res.json();
    if (data.token) {
      Object.assign(S, { server, token:data.token, user:data.user });
      saveCredentials(username, password);
      saveSession(); enterApp();
    } else { err.textContent = data.error||'Неверный логин или пароль'; }
  } catch { err.textContent='Не удалось подключиться к серверу'; }
  finally { btn.disabled=false; btn.textContent='Войти'; }
}

function logout(intentional = false) {
  clearInterval(_refreshTimer);
  window.electron?.sessionClear?.();
  _fetchController.abort();
  _fetchController = new AbortController();
  closeSettings();
  if (S.ws) S.ws.close();
  if (S.server) {
    localStorage.setItem('lastServer', S.server);
    const serverInput = document.getElementById('l-server');
    if (serverInput) serverInput.value = S.server;
  }
  // При включённой «Высокой доступности» логин/пароль оставляем: смысл HA —
  // зайти с любого компьютера в один клик, без повторного ввода данных.
  if (intentional && !_haActive) clearCredentials();
  Object.assign(S, { token:null, user:null, chats:[], activeChatId:null, ws:null, unread:{}, allUsers:[] });
  localStorage.removeItem(SESSION_KEY);
  updateUnreadTotal();
  // Есть другая учётная запись: эта удаляется из бара, сразу открывается оставшаяся — без окна входа
  if (intentional && window.electron?.accountLogout && S.acc.list.length > 1) {
    window.electron.accountLogout().then(switched => { if (!switched) showLoginScreen(intentional); });
    return;
  }
  showLoginScreen(intentional);
}
function showLoginScreen(intentional) {
  document.getElementById('screen-main').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  if (!intentional) fillLoginFromCreds();
}

// ── ОБЩИЕ НАСТРОЙКИ ПРИЛОЖЕНИЯ (Electron) ──
// Тема, размер текста, масштаб, акцент, узор и фон переписки одни на все учётные записи: хранит их
// главный процесс. Здесь — чтение при запуске, отправка при изменении и применение пришедшего
// из другой записи. _applyingShared гасит обратную отправку, пока применяем чужое.
let _sharedLoaded = false, _applyingShared = false;
function collectAppSettings() {
  return { theme: S.settings.theme, fontSize: S.settings.fontSize, uiScale: S.settings.uiScale || 100,
    accent: currentAccent(), chatPattern: currentPattern(), chatPatternLevel: currentPatternLevel(), chatBg: currentChatBg() };
}
function pushAppSettings() {
  if (_applyingShared || !window.electron?.appSettingsSet) return;
  window.electron.appSettingsSet(collectAppSettings());
}
function applyAppSettings(d) {
  if (!d) return;
  _applyingShared = true;
  try {
    if (d.theme) S.settings.theme = d.theme;
    if (d.fontSize) S.settings.fontSize = d.fontSize;
    if (d.uiScale) S.settings.uiScale = d.uiScale;
    applySettings();
    if (d.accent && ACCENTS[d.accent]) setAccent(d.accent);
    if (d.chatPattern !== undefined) setChatPattern(d.chatPattern);
    if (d.chatPatternLevel) setPatternLevel(d.chatPatternLevel);
    if (d.chatBg) setChatBg(d.chatBg);
    updateSidebarThemeIcon();
    if (S.token) saveSession();
  } finally { _applyingShared = false; }
}
async function initSharedSettings() {
  if (!window.electron?.appSettingsGet) return;
  let shared = null;
  try { shared = await window.electron.appSettingsGet(); } catch {}
  window.electron.onAppSettingsChanged(applyAppSettings);
  if (shared && Object.keys(shared).length) { _sharedLoaded = true; applyAppSettings(shared); }
}

// ── УЧЁТНЫЕ ЗАПИСИ (Electron) ──
// Состояние приходит из главного процесса: список записей, какая открыта, число непрочитанных у каждой.
S.acc = { list: [], activeId: null, selfId: null, pending: false };
function accHttp(server) { return /:\d+$/.test(server) ? 'http' : 'https'; }
function initAccounts() {
  if (!window.electron?.accountsGet) return;
  window.electron.accountsGet().then(applyAccounts).catch(() => {});
  window.electron.onAccountsChanged(applyAccounts);
}
function applyAccounts(d) {
  if (!d) return;
  const wasActive = _accountActive;
  S.acc = { list: d.accounts || [], activeId: d.activeId, selfId: d.selfId, pending: S.acc.pending || !!d.pending };
  if (d.pending === false) S.acc.pending = false;
  _accountActive = d.active !== false;
  const close = document.getElementById('login-close');
  if (close) close.hidden = !S.acc.pending;
  renderAccountRail();
  // Переключили запись — статус и прочитанность пересчитываются сразу
  if (wasActive !== _accountActive) refreshActivity();
}
// Что показать в баре об этой записи: имя, сервер и пользователь для аватарки
function reportAccount() {
  if (!window.electron?.accountLoggedIn || !S.user) return;
  S.acc.pending = false;
  window.electron.accountLoggedIn({ server: S.server, userId: S.user.id, name: S.user.display_name, tag: S.user.tag ?? null });
}
function renderAccountRail() {
  const rail = document.getElementById('acc-rail');
  if (!rail) return;
  const show = S.acc.list.length > 1;
  rail.hidden = !show;
  document.body.classList.toggle('has-rail', show);
  if (!show) { rail.innerHTML = ''; return; }
  rail.innerHTML = S.acc.list.map(a => {
    const m = a.meta;
    const cls = m ? userAvatarColor(m.userId, m.tag) : 'av-default';
    const img = m ? `<img src="${accHttp(m.server)}://${esc(m.server)}/api/users/${m.userId}/avatar" alt="" onerror="this.style.display='none'">` : '';
    const isActive = a.id === S.acc.activeId;
    const badge = !isActive && a.unread > 0 ? `<span class="acc-badge">${a.unread > 99 ? '99+' : a.unread}</span>` : '';
    const name = m ? esc(m.name) : 'Вход не выполнен', srv = m ? esc(m.server) : '';
    return `<button type="button" class="acc-btn${isActive ? ' active' : ''}" onclick="window.electron.accountSwitch('${esc(a.id)}')" aria-label="${name}${srv ? ', ' + srv : ''}">
      <span class="av av-round ${cls}">${esc(m ? initials(m.name) : '?')}${img}</span>${badge}
      <span class="acc-tip"><b>${name}</b><span>${srv}</span></span></button>`;
  }).join('');
}

// ── ENTER APP ──
function enterApp() {
  reportAccount();
  // Общего файла ещё нет (первый запуск после обновления) — настройки этой записи становятся общими
  if (!_sharedLoaded) { _sharedLoaded = true; pushAppSettings(); }
  startTokenRefresh();
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  loadDownloadedFiles();
  verifyDownloadedFiles();
  loadChats();
  loadUsers();
  loadUploadSettings();
  connectWS();
  loadPresence();
  _sidebarTab = 'chats';
}


function updateSidebarThemeIcon() {
  const isDark = S.settings.theme === 'dark';
  const sun = document.getElementById('sidebar-theme-sun');
  const moon = document.getElementById('sidebar-theme-moon');
  if (sun) sun.style.display = isDark ? '' : 'none';
  if (moon) moon.style.display = isDark ? 'none' : '';
}

// ── SETTINGS ──
// ── ЦВЕТОВОЙ АКЦЕНТ ──
// Живёт только на устройстве: отдельный ключ в localStorage, на сервер не уходит
// и в сессию не пишется — поэтому переживает выход из аккаунта, но на другом
// компьютере у того же человека может быть свой цвет.
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

function setAccent(key) {
  if (!ACCENTS[key]) return;
  try { localStorage.setItem('accent', key); } catch {}
  applyAccent();
  pushAppSettings();
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
  s.setProperty('--accent-soft', rgba(c, .10));
  s.setProperty('--primary-light', rgba(c, .10));
  s.setProperty('--accent-border', rgba(c, .25));
  s.setProperty('--accent-shadow', rgba(c, .20));
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
    ' style="--dot:rgb(' + accentRgb(a).join(',') + ')" onclick="setAccent(\'' + k + '\')"></button>').join('');
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
  pushAppSettings();
  document.querySelectorAll('#pattern-cards .pat-card').forEach(c =>
    c.classList.toggle('active', c.dataset.pattern === currentPattern()));
  const line = document.getElementById('pattern-level-line');
  if (line) line.style.display = currentPattern() ? '' : 'none';
}

function setPatternLevel(n) {
  try { localStorage.setItem('chatPatternLevel', String(n)); } catch {}
  applyChatPattern();
  pushAppSettings();
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
    ' onclick="setChatPattern(\'' + p.id + '\')">' +
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
  pushAppSettings();
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
  const card = (mode, title, sub) => `<button class="bg-card${cur === mode ? ' active' : ''}" data-bg="${mode}" onclick="setChatBg('${mode}')">
      ${skel(mode === 'split')}
      <span class="bg-cap"><b>${title}</b>${sub}</span>
    </button>`;
  return `<div class="bg-cards" id="chatbg-cards">
    ${card('plain', 'Как обычно', 'Сайдбар и переписка одного цвета')}
    ${card('split', 'С разделением', 'Переписка отделена оттенком')}
  </div>`;
}

function applySettings() {
  const isDark = S.settings.theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.className = document.documentElement.className.replace(/font-\w+/,'');
  document.documentElement.classList.add('font-'+S.settings.fontSize);
  document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===(S.settings.theme==='light'?'Светлая':'Тёмная')));
  document.querySelectorAll('#font-seg button').forEach(b => b.classList.toggle('active', b.textContent.trim()===S.settings.fontSize[0].toUpperCase()));
  const _scale = S.settings.uiScale || 100;
  document.documentElement.style.zoom = _scale !== 100 ? _scale + '%' : '';
  // Сдвиг текста в пузыре (центровка по x-высоте): при масштабе меньше 100% размеры строки
  // округляются так, что текст и без сдвига стоит по центру; от 100% нужен сдвиг вверх
  document.documentElement.style.setProperty('--bubble-text-shift', _scale < 100 ? '0em' : '-0.107em');
  document.documentElement.style.minHeight = '';
  document.body.style.height = '';
  document.documentElement.style.setProperty('--vh100', _scale !== 100 ? `calc(100vh / ${_scale / 100})` : '100vh');
  document.querySelectorAll('#scale-seg button').forEach(b => b.classList.toggle('active', parseInt(b.textContent) === _scale));
  applyAccent();
  applyChatBg();
  applyChatPattern();
  document.querySelectorAll('#pattern-seg button').forEach((b, i) =>
    b.classList.toggle('active', i + 1 === currentPatternLevel()));
  updateSidebarThemeIcon();
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
function setTheme(t) { animateThemeSwitch(); S.settings.theme=t; applySettings(); saveSession(); pushAppSettings(); }
function toggleTheme() { setTheme(S.settings.theme === 'dark' ? 'light' : 'dark'); }
function setFontSize(f) { S.settings.fontSize=f; applySettings(); saveSession(); pushAppSettings(); }
function setUiScale(v) { S.settings.uiScale=v; applySettings(); saveSession(); pushAppSettings(); }
let _sidebarPeekTimer = null;
function toggleSidebar() {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  document.body.classList.remove('sidebar-peeking');
  // Сайдбар сразу выходит из потока и уезжает сдвигом: он не превращается в плоскую
  // панель у края. Показ — сразу, чтобы колонка вернулась.
  document.body.classList.toggle('sidebar-overlay', hidden);
  localStorage.setItem('sidebarHidden', hidden ? '1' : '');
  window.electron?.resizeWindow(hidden ? -280 : 280);
}
function _scheduleHideSidebar() {
  if (!document.body.classList.contains('sidebar-hidden')) return;
  _sidebarPeekTimer = setTimeout(() => {
    document.body.classList.remove('sidebar-peeking');
  }, 120);
}
function initSidebarPeek() {
  const zone = document.getElementById('sidebar-peek-zone');
  const sidebar = document.querySelector('.sidebar');
  if (!zone || !sidebar) return;
  zone.addEventListener('mouseenter', () => {
    clearTimeout(_sidebarPeekTimer);
    document.body.classList.add('sidebar-peeking');
  });
  sidebar.addEventListener('mouseleave', _scheduleHideSidebar);
  sidebar.addEventListener('mouseenter', () => clearTimeout(_sidebarPeekTimer));
}
// ── ВКЛАДКИ САЙДБАРА (Чаты / Контакты / Настройки) ──
// Раньше внизу сайдбара была карточка «я» с шестерёнкой в модалку настроек.
// Теперь там три вкладки, как в мобильном клиенте (см. m/app.js: setTab/tab-hl) —
// «Чаты» по умолчанию, «Контакты» — список всех пользователей, «Настройки» рисуются
// прямо в сайдбаре и основной области (csRenderInline), без модалки.
let _sidebarTab = 'chats';

function setSidebarTab(tab) {
  if (tab === _sidebarTab) return;
  const prevTab = _sidebarTab;
  // уходя со вкладки «Чаты» — выходим из открытой панели тем, чтобы не путать
  // сжатый в полосу сайдбар с контактами/настройками
  if (prevTab === 'chats' && S.activeRoomId) leaveRoom();
  _sidebarTab = tab;
  document.querySelectorAll('.sb-tab').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  document.getElementById('chats-search-wrap').style.display = tab === 'chats' ? '' : 'none';
  document.getElementById('contacts-search-wrap').style.display = tab === 'contacts' ? '' : 'none';
  document.getElementById('sidebar-search').style.display = tab === 'settings' ? 'none' : '';
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
  document.getElementById('chat-main').innerHTML = `<div class="empty-state">
    <div class="empty-icon"><svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
    <div class="empty-title">Electron</div>
    <div class="empty-sub">Выберите чат или создайте новый</div>
  </div>`;
}

// ── КОНТАКТЫ ──
// Список всех пользователей компании — та же аватарка и подложка тега, что и при
// выборе собеседника для нового чата (ppAvHtml), плюс индикатор «в сети».
function contactRowHtml(u) {
  return `<div class="pp-row" data-uid="${u.id}" onclick="openContactChat(${u.id})">
    <div class="av-wrap">${ppAvHtml(u)}${presenceDot(u.id)}</div>
    <span class="pp-name">${esc(u.display_name)}</span>
    ${u.tag ? `<span class="pp-tag">${esc(u.tag)}</span>` : ''}
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
  const users = S.allUsers.filter(u => u.id !== S.user.id &&
    (!q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)));
  // Сначала те, кто в сети; внутри каждой группы — по имени
  const rank = u => ({ online: 0, away: 1 })[S.presence[u.id]] ?? 2;
  users.sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }));
  list.innerHTML = users.length ? contactGroupsHtml(users, rank, contactRowHtml) : '<div class="pp-empty">Никого не нашлось</div>';
}
function filterContacts(q) { renderContactsList(q); }
async function openContactChat(userId) {
  openChatTypePicker(userId);
}

// ── НАСТРОЙКИ ──
// Рисуются на месте вкладки «Настройки» в сайдбаре: слева карточка профиля и разделы
// с их главным значением (csRenderInline пишет это в #chats-list), справа — строки
// настроек выбранного раздела (в #chat-main). Всё, кроме имени и пароля, применяется сразу.
// «Обновление» и автозапуск — только в Electron (csIsApp).
const CS = {
  sec: 'profile', nameDraft: '', nameBusy: false, nameMsg: '',
  pwOpen: false, pw: { old: '', a: '', b: '' }, pwShow: false, pwErr: '', pwBusy: false, pwDone: false,
  autostart: null, version: null, avatar: undefined,
};
const csIsApp = () => typeof window.electron !== 'undefined';
const CS_PHONE_MQ = '(max-width: 767px), (pointer: coarse)';
const csIsPhone = () => !csIsApp() && window.matchMedia(CS_PHONE_MQ).matches;
const csSvg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CS_I = {
  user: csSvg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  gear: csSvg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  palette: csSvg('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6 0-4.9-4.5-8.6-10-8.6z"/>'),
  upd: csSvg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>'),
  x: csSvg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  pen: csSvg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  eye: csSvg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: csSvg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  out: csSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  check: csSvg('<polyline points="20 6 9 17 4 12"/>'),
  sun: csSvg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
  moon: csSvg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  play: csSvg('<polygon points="6 4 20 12 6 20 6 4"/>'),
  back: csSvg('<polyline points="15 18 9 12 15 6"/>'),
  chev: csSvg('<polyline points="9 18 15 12 9 6"/>'),
  down: csSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  bolt: csSvg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  lock: csSvg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  copy: csSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
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

function csSections() {
  const s = S.settings;
  const list = [
    { k: 'profile', label: 'Профиль', icon: CS_I.user, desc: 'Фото, имя и пароль', meta: () => '@' + (S.user?.username || '') },
    { k: 'general', label: 'Основные', icon: CS_I.gear, desc: csIsApp() ? 'Звук и поведение приложения' : 'Звук сообщений',
      meta: () => [s.soundEnabled !== false ? 'звук включён' : 'без звука', csIsApp() && CS.autostart ? 'автозапуск' : ''].filter(Boolean).join(' · ') },
    { k: 'appearance', label: 'Внешний вид', icon: CS_I.palette, desc: 'Тема, цвет, фон переписки и размер текста',
      meta: () => `${s.theme === 'dark' ? 'Тёмная' : 'Светлая'} · ${ACCENTS[currentAccent()].name.toLowerCase()}` },
  ];
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
  const where = csIsApp() ? 'На этом компьютере' : csIsPhone() ? 'На этом телефоне' : 'В этом браузере';
  return `<div class="cs-hero">
      <button type="button" class="cs-av-edit" aria-label="Сменить фото" onclick="triggerAvatarUpload()">${csAv(72)}<span class="cs-badge">${CS_I.pen}</span></button>
      <div class="cs-hero-t"><b>${esc(u.display_name)}</b><span>@${esc(u.username)}</span>
        ${u.tag ? `<div class="cs-chips"><span class="cs-chip">${esc(u.tag)}</span></div>` : ''}</div>
    </div>
    <div class="cs-gt">Имя</div>
    <div class="cs-g"><div class="cs-r stack">
      <div class="cs-l"><b>Как вас видят в чатах</b><span>Логин @${esc(u.username)} не меняется — его задаёт администратор.</span></div>
      <div class="cs-ctl">
        <div class="cs-inp ${ok ? '' : 'bad'}" style="flex:1;min-width:180px"><input id="cs-name" value="${esc(draft)}" maxlength="40" aria-label="Имя" autocomplete="off"
          oninput="csNameInput(this.value)" onkeydown="if(event.key==='Enter')csSaveName(); if(event.key==='Escape'){event.stopPropagation(); this.value=S.user.display_name; csNameInput(this.value)}"><span class="cs-cnt" id="cs-cnt">${draft.length}/40</span></div>
        <button type="button" class="cs-btn solid" id="cs-name-save" ${ok && changed && !CS.nameBusy ? '' : 'disabled'} onclick="csSaveName()">${CS.nameBusy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
      <div id="cs-name-msg">${!ok ? '<span class="cs-err">Имя не может быть пустым</span>' : CS.nameMsg === 'ok' ? '<span class="cs-okt">Имя сохранено — его увидят все собеседники</span>' : CS.nameMsg ? `<span class="cs-err">${esc(CS.nameMsg)}</span>` : ''}</div>
    </div></div>
    <div class="cs-gt">Безопасность</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Пароль</b>${CS.pwDone ? '<span class="cs-okt">Пароль изменён</span>' : `<span>${CS.pwOpen ? 'Введите текущий пароль и придумайте новый — от 6 символов' : 'Меняется здесь же, без администратора'}</span>`}</div>
        ${CS.pwOpen ? '' : `<button type="button" class="cs-btn ghost" onclick="csPwToggle()">${CS_I.lock}Сменить пароль</button>`}</div>
      ${CS.pwOpen ? `<div class="cs-r stack">
        <div class="cs-inp"><input id="cs-pw0" type="${type}" placeholder="Текущий пароль" autocomplete="current-password" oninput="csPwInput('old', this.value)">
          <button type="button" class="cs-eye" aria-label="${CS.pwShow ? 'Скрыть пароли' : 'Показать пароли'}" onclick="csPwEye()">${CS.pwShow ? CS_I.eyeOff : CS_I.eye}</button></div>
        <div class="cs-inp"><input id="cs-pw1" type="${type}" placeholder="Новый пароль" autocomplete="new-password" oninput="csPwInput('a', this.value)"></div>
        <div class="cs-pwbar" id="cs-pwbar">${csPwBar(csPwStrength(CS.pw.a))}</div>
        <div class="cs-inp ${CS.pw.b && CS.pw.a !== CS.pw.b ? 'bad' : ''}" id="cs-pw2box"><input id="cs-pw2" type="${type}" placeholder="Повторите новый пароль" autocomplete="new-password" oninput="csPwInput('b', this.value)" onkeydown="if(event.key==='Enter')submitOwnPassword()"></div>
        <div id="cs-pwmsg">${csPwMsg()}</div>
        <div class="cs-ctl"><span class="cs-grow"></span><button type="button" class="cs-btn ghost" onclick="csPwToggle()">Отмена</button>
          <button type="button" class="cs-btn solid" id="cs-pwsave" ${csPwReady() && !CS.pwBusy ? '' : 'disabled'} onclick="submitOwnPassword()">${CS.pwBusy ? 'Сохраняю…' : 'Сохранить пароль'}</button></div>
      </div>` : ''}
    </div>
    <div class="cs-gt">Сервер</div>
    <div class="cs-g"><div class="cs-r">
      <div class="cs-l"><b>Адрес сервера</b><span>${esc(S.server)}</span></div>
      <button type="button" class="cs-btn ghost" id="cs-server-copy" onclick="csCopyServer(this)">${CS_I.copy}Скопировать</button>
    </div></div>
    ${csIsApp() ? `<div class="cs-gt">Учётные записи</div>
    <div class="cs-g"><div class="cs-r">
      <div class="cs-l"><b>Добавить учётную запись</b><span>Вторая запись на этом или другом сервере — обе работают одновременно</span></div>
      <button type="button" class="cs-btn ghost" onclick="window.electron.accountAdd()">Добавить</button>
    </div></div>` : ''}
    <div class="cs-logout"><div class="cs-l"><b>Выйти из аккаунта</b><span>${where} понадобится снова ввести логин и пароль</span></div>
      <button type="button" class="cs-btn danger" onclick="logout(true)">${CS_I.out}Выйти</button></div>`;
}
function csCopyServer(btn) {
  navigator.clipboard.writeText(S.server).then(() => {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = `${CS_I.check}Скопировано`;
    btn.disabled = true;
    setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
  }).catch(() => {});
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
const csTg = (on, fn, label) => `<button type="button" class="cs-tg" role="switch" aria-checked="${on}" aria-label="${label}" onclick="${fn}"></button>`;
function csPaneGeneral() {
  const sound = S.settings.soundEnabled !== false;
  return `<div class="cs-gt">Уведомления</div>
    <div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Звук сообщений</b><span>Короткий сигнал, когда приходит новое сообщение</span></div>
      <div class="cs-ctl"><button type="button" class="cs-btn ghost" ${sound ? '' : 'disabled'} onclick="playNotificationSound()">${CS_I.play}Прослушать</button>${csTg(sound, 'csSound()', 'Звук сообщений')}</div></div></div>
    ${csIsApp() ? `<div class="cs-gt">Приложение</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Автозапуск при старте</b><span>Приложение откроется само после входа в систему</span></div>${csTg(!!CS.autostart, 'csAutostart()', 'Автозапуск')}</div>
      <div class="cs-r"><div class="cs-l"><b>Скрыть сайдбар</b><span>Список чатов прячется и выезжает при наведении на левый край окна</span></div>${csTg(document.body.classList.contains('sidebar-hidden'), 'csHideSidebar()', 'Скрыть сайдбар')}</div>
    </div>` : `<p class="cs-hint">Разрешение на уведомления меняется ${csIsPhone() ? 'в настройках телефона' : 'в настройках сайта в самом браузере'}.</p>`}`;
}
function csSound() { S.settings.soundEnabled = S.settings.soundEnabled === false; saveSession(); csRefresh(); }
async function csAutostart() { CS.autostart = !CS.autostart; csRefresh(); await setAutostart(CS.autostart); }
function csHideSidebar() { toggleSidebar(); csRefresh(); }

// ── Внешний вид ──
function csPaneAppearance() {
  const s = S.settings, lvl = currentPatternLevel(), scales = csIsApp() ? [80, 90, 100] : [80, 90, 100, 110];
  const seg = (items, cur, fn, label) => `<div class="cs-seg" role="group" aria-label="${label}">${items.map(([v, t, title]) =>
    `<button type="button" aria-pressed="${cur === v}" ${title ? `aria-label="${title}" title="${title}"` : ''} onclick="${fn}(${typeof v === 'string' ? `'${v}'` : v}); csRefresh()">${t}</button>`).join('')}</div>`;
  return `<div class="cs-pv" aria-hidden="true">
      <div class="cs-pv-side"><i></i><i class="on"></i><i></i><i></i><i></i></div>
      <div class="cs-pv-chat"><div class="cs-pv-pat"></div><span class="cs-pv-cap">Так будет выглядеть</span>
        <div class="cs-pv-msg in"><b>Мария</b>Созвон переносим на 15:30<small>14:18</small></div>
        <div class="cs-pv-msg out">Отлично, успеваю<small>14:19</small></div></div>
    </div>
    <div class="cs-gt">Тема и цвет</div>
    <div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Тема</b></div>${seg([['light', CS_I.sun + 'Светлая'], ['dark', CS_I.moon + 'Тёмная']], s.theme, 'setTheme', 'Тема')}</div>
      <div class="cs-r"><div class="cs-l"><b>Цвет акцента</b><span>Кнопки, свои сообщения, выделение</span></div>
        <div class="cs-ctl"><span class="cs-aname">${ACCENTS[currentAccent()].name}</span><div id="accent-seg" class="accent-seg" onclick="if(event.target.closest('.accent-dot'))csRefresh()">${accentDotsHtml()}</div></div></div>
    </div>
    <div class="cs-gt">Фон переписки</div>
    <div onclick="if(event.target.closest('.bg-card'))csRefresh()">${chatBgCardsHtml()}</div>
    <div class="cs-gt">Узор фона</div>
    <div class="cs-g"><div class="cs-r stack">
      <div onclick="if(event.target.closest('.pat-card'))csRefresh()">${chatPatternCardsHtml()}</div>
      ${currentPattern() ? `<div class="cs-ctl cs-between"><div class="cs-l"><b>Заметность</b></div>${seg([[1, 'Слабая'], [2, 'Средняя'], [3, 'Сильная']], lvl, 'setPatternLevel', 'Заметность узора')}</div>` : ''}
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
  return `<div class="cs-ver"><span class="cs-logo">${CS_I.bolt}</span>
      <div class="cs-ver-t"><span>Установлена версия</span><b>${esc(CS.version || '—')}</b><span>Приложение для компьютера</span></div>
      ${has ? `<span class="cs-state warn">${CS_I.bolt}Доступна ${esc(_updateVersion || '')}</span>`
        : `<span class="cs-state" id="update-status-text"></span><button type="button" class="cs-btn ghost" id="update-check-btn" onclick="checkUpdate()">Проверить</button>`}</div>
    ${has ? `<div class="cs-g">
      <div class="cs-r"><div class="cs-l"><b>Версия ${esc(_updateVersion || '')}${date ? ' · ' + date : ''}</b><span>Загрузка и установка идут в отдельном окне с прогрессом</span></div>
        <button type="button" class="cs-btn solid" onclick="closeSettings(); openModal('modal-update')">${CS_I.down}Установить</button></div>
      ${_updateNotes ? `<div class="cs-notes"><b>Что нового.</b> ${esc(_updateNotes)}</div>` : ''}
    </div>` : '<p class="cs-hint">Приложение само проверяет обновления после запуска и дальше каждые два часа.</p>'}
    <div class="cs-copy">2026 © bolgov0zero</div>`;
}
const CS_PANES = { profile: csPaneProfile, general: csPaneGeneral, appearance: csPaneAppearance, update: csPaneUpdate };

function csNavHtml(list) {
  return csSections().map(s => `<button type="button" class="cs-sn" ${list ? '' : `aria-current="${CS.sec === s.k ? 'page' : 'false'}"`} onclick="csGo('${s.k}')">
    <span class="cs-sn-ic">${s.icon}</span><span class="cs-sn-tx"><b>${s.label}</b><small>${esc(s.meta())}</small></span>${s.dot?.() ? '<i class="cs-dot"></i>' : ''}${list ? `<span class="cs-chev">${CS_I.chev}</span>` : ''}</button>`).join('');
}
// Настройки рисуются на месте — категории в сайдбаре (там, где обычно
// список чатов), содержимое раздела в основной области (там, где обычно
// переписка). Раньше то же самое делал csRender() внутри модалки; логика
// разделов (csSections/CS_PANES) не изменилась, поменялось только КУДА
// пишется разметка.
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
  nav.innerHTML = `<div class="cs-nav-list">${csNavHtml(false)}</div>`;
  main.innerHTML = `<section class="cs-pane">
      <header class="cs-head"><div><h3>${s.label}</h3><p>${s.desc}</p></div></header>
      <div class="cs-body" id="cs-body">${CS_PANES[s.k]()}</div>
    </section>`;
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


async function setAutostart(enabled) { await window.electron?.setAutostart(enabled); }



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
// ── ПУСТЫЕ ЛИЧНЫЕ ЧАТЫ ──
// Выбрали человека, передумали писать — чат исчезает и у вас, и с сервера.
// Собеседник его и так не видел (он добавлен скрытым до первого сообщения),
// поэтому скрытие у себя оставляет чат скрытым у всех, а тогда сервер удаляет
// строку целиком. Начатый черновик считается началом разговора: с ним чат
// остаётся, и в списке он помечен как «Черновик».
async function dropEmptyDirect(chatId) {
  if (!chatId) return;
  const chat = S.chats.find(c => c.id === chatId);
  if (!chat || chat.type !== 'direct' || chat.is_secret) return;
  if (chat.last_message) return;
  if ((S.drafts[chatId] || '').trim()) return;
  try { await api('DELETE', '/chats/' + chatId); } catch { return; }
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
    .filter(c => c.id !== S.activeChatId && c.type === 'direct' && !c.is_secret
      && !c.last_message && !(S.drafts[c.id] || '').trim())
    .forEach(c => dropEmptyDirect(c.id));
}

async function loadChats() {
  await scLoadKeys();
  const all = await api('GET','/chats');
  if (!all) return;
  S.secretChatIds = new Set(all.filter(c => c.is_secret).map(c => c.id));
  const chats = all.filter(c => !(c.is_secret && S.scHidden.has(c.id)));
  S.chats = chats;
  S.mutedChats = new Set(chats.filter(c => c.muted).map(c => c.id));
  chats.forEach(c => {
    S.unread[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread || 0);
    S.unreadMentions[c.id] = (c.id === S.activeChatId) ? 0 : (c.unread_mentions || 0);
  });
  // Подгружаем темы для всех комнат с has_topics
  await Promise.all(chats.filter(c=>c.has_topics).map(c => loadTopics(c.id)));
  updateUnreadTotal();
  renderChatList();
  dropEmptyDirects();
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

function chatIcon(chat) {
  if (chat.type==='room') return '🏠';
  return initials(chatName(chat));
}

// Try loading real photo into an .av element; fall back to initials if 404
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

// After rendering chat list / chat header — load real avatars where available
function applyAvatars() {
  // Chat list items: data-chat-id attribute
  document.querySelectorAll('[data-av-chat]').forEach(el => {
    const chatId = parseInt(el.dataset.avChat);
    const chat = S.chats.find(c => c.id === chatId)
      || Object.values(S.topics).flat().find(s => s.id === chatId);
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
  // User avatars in modals / member lists
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
  // Список чатов — общий контейнер с контактами и настройками (#chats-list).
  // Фоновые обновления (переподключение WS, ресинк после возврата фокуса и т.п.)
  // вызывают эту функцию когда угодно — если открыта другая вкладка, писать
  // сюда нельзя: затрёт контакты/настройки, а подсветка таб-бара не совпадёт.
  // S.chats к этому моменту уже обновлён — при возврате на «Чаты» отрисуется сам.
  if (_sidebarTab !== 'chats') return;
  const q = document.getElementById('search').value.toLowerCase();
  const list = document.getElementById('chats-list');
  const filtered = S.chats
    .filter(c=>chatName(c).toLowerCase().includes(q))
    .sort((a,b) => {
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
  const u = c.has_topics
    ? (S.topics[c.id]||[]).reduce((sum,s)=>sum+(S.unread[s.id]||0),0)
    : S.unread[c.id]||0;
  const m = c.has_topics
    ? (S.topics[c.id]||[]).reduce((sum,s)=>sum+(S.unreadMentions[s.id]||0),0)
    : S.unreadMentions[c.id]||0;
  const lm = c.last_message;
  let preview = lm ? (lm.deleted ? 'Сообщение удалено' : ((lm.text ? lm.text.replace(/<[^>]*>/g, '') : '') || (lm.forward_data ? 'Пересланное сообщение' : lm.attachment ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл')) : ''))) : 'Нет сообщений';
  if (preview.length>40) preview = preview.slice(0,40)+'…';
  // Черновик приоритетнее последнего сообщения (как в Telegram)
  const draft = (c.id !== S.activeChatId) ? S.drafts[c.id] : null;
  // Своё последнее сообщение помечаем «Вы:» — у удалённого пометки нет,
  // там и так стоит «Сообщение удалено»
  const minePreview = lm && !lm.deleted && lm.sender_id === S.user?.id;
  // Секретный чат: превью не показывается вовсе, чтобы не подсматривали
  const previewHtml = c.is_secret
    ? '<span class="sc-tag">Скрытый чат</span>'
    : draft
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
      <div class="av av-md ${chatAvatarClass(c)}${c.type==='room' && c.has_topics?' av-sq':' av-round'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
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
  // Сообщения ботов хранят доверенный HTML (как и в самом пузыре, см. renderMsgIRC) —
  // экранировать их нельзя, иначе теги вроде <b> показываются как текст
  const snip = (r.sender_is_bot ? (r.snippet || '') : esc(r.snippet || '')).replaceAll('\u0001', '<b>').replaceAll('\u0002', '</b>');
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
          ? (lm.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : lm.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (lm.attachment.name || 'Файл'))
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
    ? ' style="background-image:url(\'' + httpProto() + '://' + S.server + '/api/chats/' + s.id + '/avatar' + '\');background-size:cover;background-position:center"'
    : '';
  return '<div class="chat-item' + (S.activeTopicId === s.id ? ' active' : '') + '"' +
    ' data-topic-id="' + s.id + '" onclick="openTopic(' + s.id + ')">' +
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
  const main = document.getElementById('chat-main');
  if (main) main.innerHTML = '<div class="empty-state">' +
    '<div class="empty-icon" style="font-size:36px">💬</div><p>Выберите чат</p></div>';
}

function renderTopicsPanel(roomId) {
  const panel = document.getElementById('topics-panel');
  const subs = S.topics[roomId] || [];
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
  // Панель перерисует сам openChat — отдельный вызов только гонял бы её дважды
  await openChat(topicId);
}

// Полоса ввода лежит поверх ленты, поэтому её высота нужна ленте как нижний отступ.
// Высота меняется от ответа, вложения и многострочного текста — следим наблюдателем.
let _composerRO = null;
let _topRO = null;
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
function watchTopHeight() {
  const main = document.getElementById('chat-main');
  const header = main?.querySelector('.chat-header');
  const pin = document.getElementById('pin-bar');
  if (!main || !header) return;
  const apply = () => {
    const pinH = pin && pin.style.display !== 'none' ? pin.offsetHeight + 8 : 0;
    main.style.setProperty('--chat-top-h', (16 + header.offsetHeight + pinH) + 'px');
  };
  apply();
  if (_topRO) _topRO.disconnect();
  try {
    _topRO = new ResizeObserver(apply);
    _topRO.observe(header);
    if (pin) _topRO.observe(pin);
  } catch { _topRO = null; }
}
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
  // Тема не в S.chats — строим из S.topics
  if (!chat) {
    for (const [pid, subs] of Object.entries(S.topics)) {
      const sub = subs.find(s=>s.id===chatId);
      if (sub) { chat = { id: chatId, type: 'room', name: sub.name, parent_id: Number(pid), members: [] }; break; }
    }
  }
  if (chat?.has_topics) {
    // Комната с темами — показываем панель, не открываем чат напрямую
    S.activeChatId = null;
    S.activeRoomId = chatId;
    S.activeTopicId = null;
    renderChatList();
    await loadTopics(chatId, { render: true });
    document.getElementById('chat-main').innerHTML = `<div class="empty-state">
      <div class="empty-icon" style="font-size:36px">📋</div>
      <p>Выберите тему</p>
    </div>`;
    return;
  }
  // Если выбираем обычный чат — сбрасываем панель тем
  if (!chat?.parent_id && !Object.values(S.topics).some(arr=>arr.some(s=>s.id===chatId))) {
    closeTopicsPanel();
    S.activeRoomId = null;
    S.activeTopicId = null;
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
  releaseStick();
  S.unread[chatId] = 0;
  S.unreadMentions[chatId] = 0;
  updateUnreadTotal();
  renderChatList();
  if (chat?.parent_id) renderTopicsPanel(chat.parent_id);
  const name = chatName(chat);
  const isGroup = chat.type==='group';
  const isRoom = chat.type==='room';
  const isCreator = chat.created_by === S.user.id;
  const memberCount = chat.members?.length||0;
  const peerId = getPeerUserId(chat);
  const peerDot = peerId ? presenceDot(peerId) : '';
  const isTopic = !!chat?.parent_id;
  const sub = isTopic ? `# тема` : isRoom ? `🏠 Комната · ${nMembers(memberCount)}` : isGroup ? `${nMembers(memberCount)}` : (peerId ? peerStatusText(peerId) : 'Личный чат');
  const nameClickable = (isGroup || (isRoom && !isTopic)) ? `style="cursor:pointer" onclick="openGroupInfo(${chatId})"` : '';

  // Delete button: visible for direct chats and for group creator / admins
  const canDelete = chat.type === 'direct' || S.user.is_admin || isCreator;

  const main = document.getElementById('chat-main');
  main.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-main">
        <div class="av-wrap">
          <div class="av av-md ${chatAvatarClass(chat)}${chat.type==='room' && chat.has_topics && !S.activeTopicId?' av-sq':' av-round'}" data-av-chat="${chat.id}">${chatIcon(chat)}</div>
          ${peerDot}
        </div>
        <div class="chat-header-info" ${nameClickable}>
          <div class="ch-name">${esc(name)}</div>
          <div class="ch-sub">${sub}</div>
        </div>
      </div>
      <div class="chat-header-actions">
        ${chat.is_secret ? '' : `<button class="icon-btn${S.chatSearch?.open ? ' active' : ''}" title="Поиск в чате" onclick="toggleChatSearch()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>`}
        ${isRoom ? '' : `<button class="icon-btn" title="Действия с чатом" onclick="showChatCtx(event, ${chatId})">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>`}
      </div>
    </div>
    <div id="pin-bar" class="pin-bar" style="display:none"></div>
    ${chatSearchBarHtml(chatId, chat.is_secret)}
    <div class="messages-wrap">
    <div class="messages" id="messages"></div>
      <button id="scroll-bottom-btn" class="scroll-bottom-btn" onclick="scrollMessagesToBottom()" title="К последним сообщениям">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="chat-input-wrap" id="input-wrap">
      ${readOnlyBannerHtml(isReadOnlyChat(chat))}
      <div class="composer-inner"${isReadOnlyChat(chat) ? ' hidden' : ''}>
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
          <div class="composer-main">
            <button class="composer-icon-btn composer-attach" title="Прикрепить файл" onclick="pickFile()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <input type="file" id="file-input" accept="*" style="display:none" onchange="onFilePicked(this)">
            <div class="composer-field">
          <div class="composer-slot" id="composer-slot"><div class="composer-slot-inner">
          <div id="image-preview-bar" style="display:none" class="input-reply-bar">
            <div class="attach-thumb" id="attach-thumb-box">
              <img class="img-preview-thumb" src="" style="display:none">
              <svg class="attach-preview-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="reply-bar-content">
              <div class="reply-bar-name" id="attach-preview-title">Вложение</div>
              <div class="reply-bar-text img-preview-name"></div>
              <div class="attach-track" id="attach-track" style="display:none"><div class="attach-fill" id="attach-fill"></div></div>
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
              <div class="composer-field-row">
              <textarea id="msg-input" rows="1" placeholder="Сообщение…" onkeydown="handleKey(event)" oninput="onMsgInput(this)" onfocus="closeEmojiPicker()" onpointerdown="closeEmojiPicker()"></textarea>
              <button class="composer-icon-btn" title="Эмодзи" onclick="toggleEmojiPicker(event)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 3 4 3 4-3 4-3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
              </button>
              </div>
            </div>
            <button class="send-btn" id="send-btn" onclick="sendOrEdit()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  applyAvatars();
  initComposerSlot();
  scApplyComposerState(chatId);
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='var(--composer-bg)'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none'; }
  // Отметку о прочтении отправляем после загрузки: иначе сервер успевает снять
  // read_at раньше, чем посчитает первое непрочитанное, и разделитель пропадает
  // Показать скелетон пока грузятся сообщения
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
  // Игнорируем ответ если пока грузились — переключились на другой чат
  if (data && S.activeChatId === chatId) {
    S.chatHasMore = data.hasMore;
    S.chatHasMoreAfter = !!data.hasMoreAfter;
    S.chatOldestId = data.messages[0]?.id ?? null;
    S.chatNewestId = data.messages[data.messages.length - 1]?.id ?? null;
    renderMessages(data.messages);
    // Резерв под полосу ввода выставляем до постановки якоря, иначе он считается
    // по ещё не зарезервированной высоте
    watchComposerHeight();
    watchTopHeight();
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
    // Вешаем слушатель скролла для подгрузки старых сообщений
    const msgsEl = document.getElementById('messages');
    if (msgsEl) {
      msgsEl.addEventListener('scroll', onMessagesScroll, { passive: true });
      // Прокрутка к якорю прошла до подписки — состояние кнопки «вниз» считаем сами
      onMessagesScroll();
    }
  }
  _loadingChatId = null;
  // Восстанавливаем черновик (если не переключились на другой чат пока грузились)
  if (S.activeChatId !== chatId) return;
  const inputEl = document.getElementById('msg-input');
  if (inputEl) {
    inputEl.value = S.drafts[chatId] || '';
    autoResize(inputEl);
    onMsgInput(inputEl, true);
  }
  inputEl?.focus();
}

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
  ep: { cols: 8, cell: 40, pick: 'insertEmoji' },   // композер
  rp: { cols: 7, cell: 34, pick: 'pickerReact' },   // реакции
};
const _epStatic = { ep: null, rp: null };

function emojiSectionHtml(g, kind) {
  const k = EP_KIND[kind];
  const h = Math.ceil(g.items.length / k.cols) * k.cell;
  return '<div class="ep-head" data-head="' + g.key + '">' + g.name + '</div>' +
    '<div class="ep-row" data-row="' + g.key + '" style="contain-intrinsic-size:auto ' + h + 'px">' +
      g.items.map(em => '<button class="emoji-item" data-em="' + em + '" onclick="' +
        k.pick + '(\'' + em + '\')">' + em + '</button>').join('') +
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
  // На телефоне фокус в поиске поднимает клавиатуру, и она закрывает саму панель
  if (!window.matchMedia('(max-width: 767px), (pointer: coarse)').matches) input?.focus();
}

// Считаем по рядам, а не по заголовкам: заголовки липкие, и их offsetTop/rect
// в прилипшем состоянии показывают не место раздела, а верх ленты
// Ряд вкладок с иконками разделов — одинаковый для обеих панелей
function emojiTabsHtml(kind) {
  return emojiSections().map((g, i) =>
    '<button class="ep-tab" data-tab="' + g.key + '" title="' + g.name + '"' +
    ' aria-selected="' + (i === 0) + '" onclick="emojiTabTo(\'' + g.key + '\', \'' + kind + '\')">' +
    g.icon + '</button>').join('');
}

function emojiTabTo(key, kind = 'ep') {
  const scroll = document.getElementById(kind + '-scroll');
  const row = scroll?.querySelector('[data-row="' + key + '"]');
  const head = scroll?.querySelector('[data-head="' + key + '"]');
  if (!row) return;
  const delta = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (head?.offsetHeight || 0);
  scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'smooth' });
}

// Активная вкладка следует за прокруткой — как в телеграме
function syncEmojiTabs(kind = 'ep') {
  const scroll = document.getElementById(kind + '-scroll');
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
        '<button class="emoji-item" data-em="' + h.em + '" onclick="' + EP_KIND[kind].pick + '(\'' + h.em + '\')">' + h.em + '</button>').join('') +
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
  const start = input.selectionStart, end = input.selectionEnd;
  input.value = input.value.slice(0, start) + em + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + em.length;
  // Возвращаем курсор в поле, но это не то же самое, что поставить его туда
  // руками: там закрытие панели как раз нужно, поэтому помечаем свой вызов
  _emojiInserting = true;
  input.focus();
  _emojiInserting = false;
  onMsgInput(input);
}

// ── RENDER MESSAGES ──
// Two messages are in the same "time group" if same sender and same HH:MM
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
      lastSenderId = null; // reset grouping after day separator
    }
    // grouped = same sender as previous, within 5 minutes, no day break
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
  scDecryptVisible();
}

// ── PAGINATION: подгрузка старых сообщений ──
function onMessagesScroll() {
  const container = document.getElementById('messages');
  if (!container) return;
  const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (!_loadingMore) {
    if (S.chatHasMore && container.scrollTop < 80) loadMoreMessages();
    if (S.chatHasMoreAfter && dist < 80) loadMoreAfter();
  }
  const btn = document.getElementById('scroll-bottom-btn');
  if (btn) btn.classList.toggle('visible', dist > 300 || !!S.chatHasMoreAfter);
}

function scrollMessagesToBottom() {
  if (S.chatHasMoreAfter && S.activeChatId) { openChat(S.activeChatId, null, true); return; }
  const container = document.getElementById('messages');
  if (!container) return;
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
  scDecryptVisible();
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

  // Компенсируем скролл — чтобы экран не прыгал
  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;
  container.insertAdjacentHTML('afterbegin', html);
  reflowSeries();
  mergeDayGroups(container);
  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
  scDecryptVisible();
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

// Проверка, что вшитый шрифт смайлов вообще рисуется.
//
// Он в формате COLRv1, и не всякий браузер умеет его показывать (Safari — только
// с 16.4). Беда в том, что при неумении не происходит подмены на системный
// шрифт: браузер видит, что шрифт подошёл по коду символа, берёт его — и не
// рисует ничего. Вместо смайлов пустые места. Поэтому проверяем не по наличию
// шрифта, а по факту: рисуем смайл только этим шрифтом и смотрим, появились ли
// на холсте цветные точки. Не появились — снимаем шрифт со стека, и возвращаются
// системные смайлы. Они разные на разных системах, но это несравнимо лучше пустоты.
async function checkEmojiFont() {
  // Рисует ли браузер этот набор — проверяем на деле: кладём смайл на холст
  // только этим семейством и считаем цветные точки. У рабочего набора их около
  // 1800, у нерабочего ноль, так что порог можно ставить с большим запасом.
  const paints = async (family) => {
    try {
      await document.fonts.load('64px "' + family + '"', '\u{1F600}');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.font = '48px "' + family + '"';
      ctx.textBaseline = 'top';
      ctx.fillText('\u{1F600}', 0, 0);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 20) continue;
        if (Math.abs(d[i] - d[i + 1]) > 25 || Math.abs(d[i + 1] - d[i + 2]) > 25) colored++;
      }
      return colored >= 40;
    } catch { return false; }
  };
  // Основной набор — COLRv1, его понимает Chromium, а значит и наш Electron
  if (await paints('Noto Color Emoji')) return;
  // Не понял — пробуем OpenType-SVG, его понимает Safari
  document.documentElement.classList.add('emoji-svg');
  if (await paints('Noto Emoji SVG')) return;
  // Ни тот, ни другой — возвращаем системные смайлы
  document.documentElement.classList.remove('emoji-svg');
  document.documentElement.classList.add('no-emoji-font');
}
checkEmojiFont();
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
  const t = p.text ? p.text.replace(/<[^>]*>/g, '')
    : (p.attachment ? (p.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : p.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (p.attachment.name || 'Файл')) : '');
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
function readOnlyBannerHtml(ro) {
  return `<div class="ro-banner" id="ro-banner"${ro ? '' : ' hidden'}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    <span>Доступно только для чтения</span>
  </div>`;
}
function syncReadOnlyUi() {
  const ro = isReadOnlyChat(S.chats.find(c => c.id === S.activeChatId));
  document.getElementById('ro-banner')?.toggleAttribute('hidden', !ro);
  document.querySelector('#input-wrap .composer-inner')?.toggleAttribute('hidden', ro);
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="cs-input" type="text" placeholder="Поиск в чате" autocomplete="off" value="${esc(open ? st.q : '')}" oninput="onChatSearchInput(this.value)" onkeydown="onChatSearchKey(event)">
    <span class="cs-count" id="cs-count">${open ? csCountText() : ''}</span>
    <button class="icon-btn" id="cs-up" title="Предыдущее" onclick="chatSearchStep(-1)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>
    </button>
    <button class="icon-btn" id="cs-down" title="Следующее" onclick="chatSearchStep(1)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button class="icon-btn" title="Закрыть поиск" onclick="closeChatSearch()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
function csRefresh() {
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
  csRefresh();
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
    csRefresh(); applyChatSearchHl();
    return;
  }
  st.loading = true; csRefresh();
  let data = null;
  try { data = await api('GET', `/messages/search?chat_id=${st.chatId}&q=${encodeURIComponent(term)}`); } catch {}
  // Пока ждали ответ, пользователь мог изменить запрос или закрыть поиск
  if (S.chatSearch !== st || st.q.trim() !== term) return;
  st.ids = (data?.results || []).map(r => r.id).sort((a, b) => a - b);
  st.loading = false;
  st.idx = st.ids.length - 1; // начинаем с самого нового совпадения
  if (st.ids.length) chatSearchGoto(st.idx);
  else { csRefresh(); applyChatSearchHl(); }
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
  csRefresh();
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
      `<span class="ra-emoji">${r.reaction}</span><span class="ra-count">${r.count}</span></button>`;
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
      const url = `${httpProto()}://${S.server}/api/users/${u.user_id}/avatar?t=${S.avatarTs || 0}`;
      return `<span class="rt-row" style="--i:${i}">` +
        `<span class="rt-av ${userAvatarColor(u.user_id)}">${esc(initials(u.display_name) || '?')}` +
        `<img src="${url}" alt="" onerror="this.style.display='none'"></span>` +
        `<span class="rt-name">${esc(u.display_name)}</span></span>`;
    }).join('') +
    (rest > 0 ? `<span class="rt-row rt-more">и ещё ${rest}</span>` : '');

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
  try { return EMOJI_ONLY_RE.test(t) && /\p{Extended_Pictographic}/u.test(t); } catch { return false; }
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

function renderMsgIRC(m, isFirst = true, isTail = true, isChatGroup = true) {
  if (m.status && m.id > 0) S.msgStatus[m.id] = { ...m.status };
  const isSystem = m.sender_username === '__system__';
  if (m.id > 0 && !isSystem) S.msgData.set(m.id, { forwardData: m.forward_data || null, senderId: m.sender_id, senderName: m.sender_name, senderIsBot: !!m.sender_is_bot, text: m.text, attachment: m.attachment });
  if (m.id > 0 && S.secretChatIds?.has(m.chat_id)) S.scMsgObjs.set(m.id, m);
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
      ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'
      : isMemberRemove
      ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/>'
      : '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>';
    return `<div class="irc-msg" data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}" oncontextmenu="event.preventDefault()" style="padding:2px 0">
      <div style="width:100%;display:flex;justify-content:center;padding:0 20px;box-sizing:border-box">
        <div style="${pillStyle}border-radius:14px;padding:5px 14px;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:6px;max-width:80%">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.7">${iconSvg}</svg>
          <span style="word-break:break-word">${esc(m.text)}</span>
          <span style="font-size:10px;opacity:.4;flex-shrink:0;margin-left:2px">${time}</span>
        </div>
      </div>
    </div>`;
  }

  // Секретный чат: пока это устройство не расшифровало сообщение (нет ключа или
  // расшифровка ещё не выполнена), показываем пикселизированную заглушку вместо
  // текста — её размер зависит от длины реального шифротекста. Как только ключ
  // появляется, scDecryptVisible() подменяет содержимое на лету без перерисовки.
  const isSecretChat = S.secretChatIds?.has(m.chat_id);
  const scDecryptedText = isSecretChat ? S.scDecrypted?.get(m.id) : undefined;
  const scLocked = isSecretChat && scDecryptedText === undefined && !isDeleted && !isSystem;
  const effectiveText = scLocked ? null : (isSecretChat ? (scDecryptedText ?? '') : m.text);
  const bodyText = isDeleted ? '<em class="irc-deleted">Сообщение удалено</em>'
    : scLocked ? scSkelHtml(m.text)
    : m.sender_is_bot ? effectiveText + (m.edited_at ? ' <span class="edited-tag">изм.</span>' : '') : linkifyText(effectiveText) + (m.edited_at?` <span class="edited-tag">изм.</span>`:'');
  const statusIcon = mine && !isDeleted ? renderStatus(m.status) : '';
  const reactionsHtml = isDeleted ? '' : renderReactions(m.id);
  const senderName = esc(m.sender_name);
  const avColor = userAvatarColor(m.sender_id, m.sender_tag);
  // аватарка 32px вмещает обе буквы; обрезка до одной осталась от прежних 28px
  const avLetter = initials(m.sender_name);
  const avImg = `<img src="${httpProto()}://${S.server}/api/users/${m.sender_id}/avatar" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none'">`;
  const rAtt = m.reply_attachment;
  const rIsImg = rAtt?.mime?.startsWith('image/');
  const rIsVideo = rAtt?.mime?.startsWith('video/');
  const rThumbHtml = rAtt && !m.reply_deleted ? ((rIsImg || (rIsVideo && rAtt.thumb))
    ? `<img src="${httpProto()}://${S.server}${rAtt.thumb || rAtt.url}" class="irc-reply-thumb" onerror="this.style.display='none'">`
    : `<div class="irc-reply-thumb irc-reply-file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`
  ) : '';
  const rTextRaw = m.reply_deleted
    ? 'Сообщение удалено'
    : isSecretChat
    ? (S.scDecrypted?.get(m.reply_to_id) ?? 'Зашифровано')
    : (m.reply_text || (rAtt ? (rIsImg ? '📷 Фото' : rIsVideo ? '🎬 Видео' : ('📎 ' + (rAtt.name || 'Файл'))) : ''));
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
    const fdIsVideo = fd.attachment?.mime?.startsWith('video/');
    const fdThumb = fd.attachment?.url ? ((fdIsImg || (fdIsVideo && fd.attachment.thumb))
      ? `<img src="${httpProto()}://${S.server}${fd.attachment.thumb || fd.attachment.url}" class="irc-reply-thumb" onerror="this.style.display='none'">`
      : `<div class="irc-reply-thumb irc-reply-file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`) : '';
    const fdText = fd.text || (fd.attachment ? (fdIsImg ? '📷 Фото' : fdIsVideo ? '🎬 Видео' : '📎 ' + (fd.attachment.name || 'Файл')) : '');
    return `<div class="irc-reply irc-forward-block">
      ${fdThumb}
      <div class="irc-reply-body">
        <div class="irc-reply-name">Переслано от ${esc(fd.name || '')}</div>
        <div class="irc-reply-text">${fd.is_bot ? fdText : mdLite(esc(fdText))}</div>
      </div>
    </div>`;
  })() : '';

  const actionsHtml = '';

  // аватарка есть у каждого сообщения — CSS показывает её только у последнего в серии
  const avCol = `<div class="irc-av av av-round ${avColor}" style="position:relative;flex-shrink:0">${avLetter}${avImg}</div>`;

  const ircTagHtml = m.sender_tag ? rolePillHtml(m.sender_tag) : '';
  const senderCls = senderNameClass(m.sender_tag);
  // имя и тег стоят над пузырём; у своих и внутри серии их скрывает CSS
  const header = `<div class="irc-header">
      <span class="irc-name msg-sender-name ${senderCls}${mine?' mine':''}" onclick="event.stopPropagation();mentionUserInComposer(${m.sender_id})">${senderName}</span>${ircTagHtml}
    </div>`;
  const metaHtml = `<div class="irc-meta"><span class="status-wrap">${statusIcon}</span><span class="irc-time">${time}</span></div>`;

  const scAttMeta = isSecretChat ? S.scAtt.get(m.id) : null;
  const att = isSecretChat
    ? (m.attachment ? { url: m.attachment.url, enc: 1, expired: m.attachment.expired, fiv: m.attachment.fiv, size: scAttMeta?.s, name: scAttMeta?.n, mime: scAttMeta?.m } : null)
    : m.attachment;
  // Вложение, которого больше нет. Раньше на его месте оставалась подложка во всю
  // ширину пузыря, и время с галочками ложилось поверх неё. Теперь это обычная
  // строка — такая же, как «Сообщение удалено»: место под время она держит сама
  const attExpired = !isDeleted && !!att?.url && !!att.expired;
  let attachHtml = '';
  if (!isDeleted && att?.enc && !att.expired) {
    attachHtml = scAttachHtml(m, att);
  } else if (!isDeleted && att?.url && !att.expired && !att.enc) {
    const attUrl = `${httpProto()}://${S.server}${att.url}`;
    if (att.mime?.startsWith('image/')) {
      attachHtml = `<div class="bubble-image" onclick="openLightbox('${attUrl}','${(att.name||'image').replace(/'/g,"\\'")}')"><img src="${httpProto()}://${S.server}${att.thumb || att.url}" loading="lazy"></div>`;
    } else if (att.mime?.startsWith('video/')) {
      const posterUrl = att.thumb ? `${httpProto()}://${S.server}${att.thumb}` : '';
      const safeVName = (att.name||'video').replace(/'/g,"\\'");
      attachHtml = `<div class="bubble-image bubble-video" onclick="openLightbox('${attUrl}','${safeVName}','video')">
        ${posterUrl ? `<img src="${posterUrl}" loading="lazy">` : `<video src="${attUrl}" preload="metadata" muted></video>`}
        <div class="bubble-video-play"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
      </div>`;
    } else {
      const sizeFmt = att.size ? (att.size > 1048576 ? (att.size/1048576).toFixed(1)+' МБ' : Math.round(att.size/1024)+' КБ') : '';
      const localPath = _downloadedFiles[attUrl];
      const isDone = !!(window.electron && localPath);
      const safeLocal = (localPath||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const safeUrl = attUrl.replace(/'/g,"\\'");
      const safeName = (att.name||'file').replace(/'/g,"\\'");
      const clickAction = isDone ? `openDownloadedFile('${safeLocal}')` : `downloadAttachment('${safeUrl}','${safeName}')`;
      const rightEl = isDone
        ? `<span class="bubble-file-open-label">Открыть</span>`
        : `<svg class="dl-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      attachHtml = `<div class="bubble-file${isDone?' bubble-file-done':''}" data-att-url="${attUrl}" onclick="${clickAction}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="bubble-file-info"><div class="bubble-file-name">${att.name||'Файл'}</div>${sizeFmt?`<div class="bubble-file-size">${sizeFmt}</div>`:''}</div>
        ${rightEl}
      </div>`;
    }
  }
  if (attExpired) attachHtml = `<div class="irc-text irc-deleted"><em>Файл удалён</em></div>`;

  const attDataAttrs = (att?.url && !att.enc) ? ` data-msg-att-url="${esc(att.url)}" data-msg-att-thumb="${esc(att.thumb||'')}" data-msg-att-mime="${esc(att.mime||'')}" data-msg-att-name="${esc(att.name||'')}"` : '';
  // пузырь, в котором нет ничего кроме картинки: кадр занимает его целиком, а время
  // и реакции ложатся поверх. С подписью, цитатой или пересылкой — обычное поведение
  const bareImage = !isDeleted && !m.text && !m.reply_to_id && !m.forward_data
    && !!att?.url && !att.expired && !!(att.mime?.startsWith('image/') || att.mime?.startsWith('video/'));
  // сообщение из одного смайлика показываем без пузыря — он проступает по наведению
  const emojiOnly = !isDeleted && !m.attachment && !m.reply_to_id && !m.forward_data && isEmojiOnly(m.text);
  const posCls = (isFirst ? ' irc-first' : '') + (isTail ? ' irc-tail' : '') + (emojiOnly ? ' emoji-msg' : '');

  return `<div class="irc-msg${posCls}${m._optimistic?' msg-optimistic':''}"${mine?` data-mine="1"`:``}${isChatGroup?'':' data-dm="1"'} data-msg-id="${m.id}" data-sender-id="${m.sender_id}" data-sent-at="${m.sent_at}"${attDataAttrs}${m._optimistic?' data-optimistic="1"':''}
    oncontextmenu="${!isDeleted?`showCtxMenu(event,${m.id},${m.sent_at},${mine})`:'event.preventDefault()'}">
    <div class="irc-content" ondblclick="${!isDeleted?`dblReply(${m.id})`:''}">
      ${header}
      <div class="bubble-row">
        ${avCol}
        <div class="msg-bubble${bareImage ? ' bubble-photo' : ''}">
          ${replyHtml}
          ${forwardHtml}
          ${attachHtml}
          ${(isSecretChat ? (scLocked || scDecryptedText) : m.text) || isDeleted ? `<div class="irc-text${isDeleted?' irc-deleted':''}${emojiOnly?' emoji-only':''}${scLocked?' sc-locked':''}">${bodyText}</div>` : ''}
          ${metaHtml}
        </div>
      </div>
      ${reactionsHtml}
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
  releaseStick();
  _stickBehavior = m._optimistic ? 'instant' : 'smooth';
  _stickDown();

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
    if (fmtDate(prevTime) === fmtDate(m.sent_at)) {
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
  scDecryptVisible();
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

// ── SEND / EDIT ──
// ── @MENTION AUTOCOMPLETE ──
let _mentionIdx = -1;

function _getMentionQuery(el) {
  const m = el.value.slice(0, el.selectionStart).match(/@(\S*)$/);
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
// Клик по имени автора над сообщением — вставляет @Имя в поле ввода в текущей
// позиции курсора, независимо от того, что там уже набрано (в отличие от
// insertMention, которая довершает уже начатый ввод «@часть_имени» из поповера)
function mentionUserInComposer(senderId) {
  const el = document.getElementById('msg-input');
  const u = senderId === S.user.id ? S.user : S.allUsers.find(u => u.id === senderId);
  const name = u?.display_name || u?.username;
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
  autoResize(el);
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

// ── TYPING ──
const typingTimers = {}; // chatId -> clearTimeout handle
let typingSendTimer = null;

function _updateSendBtn(el) {
  const sendBtn = document.getElementById('send-btn');
  if (!sendBtn) return;
  const hasDraft = el.value.trim().length > 0;
  sendBtn.style.background = hasDraft ? 'var(--accent)' : 'var(--composer-bg)';
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
  // Show in chat list
  const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .ci-last`);
  if (item) { item.dataset.origText = item.dataset.origText || item.textContent; item.textContent = `${senderName} печатает…`; item.classList.add('typing-preview'); }

  typingTimers[chatId] = setTimeout(() => {
    clearTyping(chatId);
  }, 5000);
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
function _stickyBottom() {
  const msgs = document.getElementById('messages');
  if (msgs && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 30)
    msgs.scrollTop = msgs.scrollHeight;
}

function autoResize(el) {
  const msgs = document.getElementById('messages');
  const atBottom = msgs && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 30;
  el.style.overflow = 'hidden';
  el.style.height = '20px'; // min = одна строка
  // У скрытого композера scrollHeight = 0: без минимума поле остаётся нулевой высоты после показа
  el.style.height = Math.min(Math.max(el.scrollHeight, 20), 120) + 'px';
  if (el.scrollHeight > 120) el.style.overflow = 'auto';
  if (atBottom && msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function sendOrEdit() {
  if (S.editingMessageId) { submitEdit(); return; }
  if (isReadOnlyChat(S.chats.find(c => c.id === S.activeChatId))) return;
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  const isSecret = S.secretChatIds.has(S.activeChatId);
  if (!text && !_pendingAttachment && !S.forwardMsg) return;
  // Нет соединения — сообщаем и не теряем набранное молча
  if (!S.ws||S.ws.readyState!==1) {
    showActionToast('Нет связи с сервером — сообщение не отправлено');
    if (S.ws && S.ws.readyState >= 2 && S.token) connectWS();
    return;
  }
  let payload, secretAtt = null;
  if (isSecret) {
    // Пересылка в секретных чатах отключена; текст и имя/тип вложения уходят одним
    // зашифрованным блоком, на сервер попадает только ссылка на файл и его вектор
    S.forwardMsg = null;
    const key = S.scKeys[S.activeChatId];
    if (!key) { showActionToast('Чат ещё не расшифрован на этом устройстве'); return; }
    secretAtt = _pendingAttachment;
    const plain = JSON.stringify({ v: 2, t: text || '', a: secretAtt ? { n: secretAtt.name, m: secretAtt.mime, s: secretAtt.size } : null });
    const enc = await scEncryptText(key, plain);
    payload = { type:'message', chat_id:S.activeChatId, text: enc.text, iv: enc.iv };
    if (secretAtt) payload.attachment = { url: secretAtt.url, enc: 1, fiv: secretAtt.fiv, size: secretAtt.size };
    if (S.replyTo) payload.reply_to_id = S.replyTo.id;
    // Иначе clearImagePreview ниже удалит уже отправляемый файл
    _pendingAttachment = null;
  } else {
    payload = { type:'message', chat_id:S.activeChatId, text: text || '' };
    if (S.replyTo) payload.reply_to_id = S.replyTo.id;
    if (_pendingAttachment) payload.attachment = _pendingAttachment;
    if (S.forwardMsg) payload.forward_data = S.forwardMsg;
  }

  // Optimistic: показать сообщение сразу, не дожидаясь echo от сервера
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
  if (isSecret) {
    S.scDecrypted.set(tempMsg.id, text || '');
    if (secretAtt) {
      tempMsg.attachment = { url: secretAtt.url, enc: 1, fiv: secretAtt.fiv, size: secretAtt.size };
      S.scAtt.set(tempMsg.id, { n: secretAtt.name, m: secretAtt.mime, s: secretAtt.size });
      S.scAttBlob.delete(tempMsg.id);
    }
  }
  if (!S.chatHasMoreAfter) appendMsg(tempMsg);

  S.ws.send(JSON.stringify(payload));
  if (S.chatHasMoreAfter) openChat(S.activeChatId, null, true); // мы были вглуби истории — к последним
  hideReplyBar();
  hideForwardBar();
  clearImagePreview();
  // Сообщение ушло — панель смайлов больше не нужна. Закрываем именно здесь, а
  // не в начале: при пустом поле или без связи отправки не было, и панель
  // должна остаться открытой.
  closeEmojiPicker();
  delete S.drafts[S.activeChatId]; saveDrafts(); // черновик отправлен — очищаем
  input.value=''; input.style.height='20px'; input.style.overflow='hidden';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='var(--composer-bg)'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none'; }
}

function submitEdit() {
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text) { cancelEdit(); return; }
  if (S.secretChatIds.has(S.activeChatId)) { cancelEdit(); return; } // редактирование в секретных чатах не поддерживается
  S.ws.send(JSON.stringify({type:'edit_message', message_id:S.editingMessageId, text}));
  closeEmojiPicker();
  cancelEdit();
}

function cancelEdit() {
  S.editingMessageId = null;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='none';
  hideReplyBar();
  const input = document.getElementById('msg-input');
  if (input) { input.value=''; input.style.height='auto'; }
  _stickyBottom();
}

// ── CONTEXT MENU ──
function showCtxMenu(e, msgId, sentAt, isMine) {
  // «Закрепить» или «Открепить» — по текущему состоянию сообщения
  const _pinLbl = document.getElementById('ctx-pin-label');
  if (_pinLbl) _pinLbl.textContent = (S.pins || []).some(p => p.message_id === msgId) ? 'Открепить' : 'Закрепить';
  e.preventDefault(); e.stopPropagation();
  S.ctx.messageId = msgId;
  S.ctx.canEdit = isMine && (Date.now()/1000 - sentAt) < (S.editLimit || 120);
  S.ctx.isMine = isMine;
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-reply-btn').style.display = '';
  document.getElementById('ctx-forward-btn').style.display = S.secretChatIds.has(S.activeChatId) ? 'none' : '';
  document.getElementById('ctx-copy-btn').style.display = '';
  document.getElementById('ctx-edit-btn').style.display = (isMine && S.ctx.canEdit && !S.secretChatIds.has(S.activeChatId)) ? '' : 'none';
  document.getElementById('ctx-delete-btn').style.display = isMine ? '' : 'none';
  document.getElementById('ctx-info-btn').style.display = isMine ? '' : 'none';
  const ctxReactEl = menu.querySelector('.ctx-reactions');
  if (ctxReactEl) {
    const _freq = getFreqEmojis(7);
    ctxReactEl.innerHTML = _freq.map(em=>`<button class="ctx-reaction-btn" onclick="ctxReact('${em}')">${em}</button>`).join('')+`<button class="ctx-reaction-btn ctx-reaction-more" onclick="showReactionPicker(event)">→</button>`;
  }
  // Сначала показываем чтобы получить реальные размеры
  menu.classList.add('open');
  placeCtxMenu(menu, e.clientX, e.clientY);
}

function syncCtxSeparators(menu) {
  const kids = [...menu.children];
  const shown = el => el && !el.classList.contains('ctx-sep') && el.style.display !== 'none';
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
  menu.style.transformOrigin = `${above ? 'bottom' : 'top'} ${fromRight ? 'right' : 'left'}`;
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
  _stickyBottom();
}

function hideReplyBar() {
  S.replyTo = null;
  const bar = document.getElementById('reply-bar');
  if (bar) bar.style.display = 'none';
  document.getElementById('composer-pill')?.classList.remove('has-reply');
}

// ── IMAGE ATTACH ──
let _pendingAttachment = null;
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


async function onFilePicked(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  await uploadFile(file);
}

let _uploadXhr = null;
let _uploadToken = 0;
const SC_FILE_MAX_MB = 50;
async function uploadFile(file) {
  if (!file) return;
  const isSecret = S.secretChatIds.has(S.activeChatId);
  const secretKey = isSecret ? S.scKeys[S.activeChatId] : null;
  if (isSecret && !secretKey) { showActionToast('Чат не расшифрован на этом устройстве'); return; }
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const cfg = isSecret ? { maxSizeMb: SC_FILE_MAX_MB, extensions: [] }
    : isImage ? _uploadSettings.image : isVideo ? _uploadSettings.video : _uploadSettings.file;
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (file.size > cfg.maxSizeMb * 1024 * 1024) {
    showActionToast(`Файл слишком большой (макс. ${cfg.maxSizeMb} МБ)`);
    return;
  }
  if (cfg.extensions.length > 0 && !cfg.extensions.includes(ext)) {
    showActionToast(`Расширение .${ext} не разрешено`);
    return;
  }

  if (_uploadXhr) _uploadXhr.abort();
  _pendingAttachment = null;
  const token = ++_uploadToken;
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) { sendBtn.style.background='var(--accent)'; sendBtn.style.color='#fff'; sendBtn.style.boxShadow='0 6px 16px var(--accent-shadow)'; }
  showAttachUploading(isImage ? 'Изображение' : isVideo ? 'Видео' : 'Файл');

  let formData, endpoint, secretMeta = null;
  if (secretKey) {
    const enc = await scEncryptFileForUpload(file, secretKey);
    if (token !== _uploadToken) return; // отменили, пока шифровали
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
  _uploadXhr = xhr;
  xhr.open('POST', `${httpProto()}://${S.server}${endpoint}`);
  xhr.setRequestHeader('Authorization', `Bearer ${S.token}`);
  // Пока тело запроса ещё идёт — честный процент; как только отправка
  // закончилась, а ответа сервера всё ещё нет (например, идёт транскод
  // видео) — переключаемся на «Обработка…», иначе казалось бы, что всё
  // зависло на 100%
  xhr.upload.onprogress = e => { if (e.lengthComputable) setAttachProgress(Math.round(e.loaded / e.total * 100)); };
  xhr.upload.onload = () => setAttachProcessing();
  xhr.onload = () => {
    _uploadXhr = null;
    if (xhr.status < 200 || xhr.status >= 300) {
      let err = {}; try { err = JSON.parse(xhr.responseText); } catch {}
      showActionToast(err.error || 'Ошибка загрузки');
      clearImagePreview();
      return;
    }
    const resp = JSON.parse(xhr.responseText);
    _pendingAttachment = secretMeta ? { ...resp, enc: 1, ...secretMeta } : resp;
    showAttachmentPreviewBar();
  };
  xhr.onerror = () => { _uploadXhr = null; showActionToast('Ошибка загрузки'); clearImagePreview(); };
  xhr.send(formData);
}


function attachBarEls() {
  return {
    bar: document.getElementById('image-preview-bar'),
    box: document.getElementById('attach-thumb-box'),
    img: document.querySelector('#image-preview-bar .img-preview-thumb'),
    ico: document.querySelector('#image-preview-bar .attach-preview-icon'),
    title: document.getElementById('attach-preview-title'),
    name: document.querySelector('#image-preview-bar .img-preview-name'),
    track: document.getElementById('attach-track'),
    fill: document.getElementById('attach-fill'),
  };
}
function showAttachUploading(title) {
  const el = attachBarEls();
  el.box.className = 'attach-thumb uploading';
  el.img.style.display = 'none';
  el.ico.style.display = '';
  el.title.textContent = title;
  el.name.textContent = 'Загрузка… 0%';
  el.track.style.display = '';
  el.track.classList.remove('indeterminate');
  el.fill.style.width = '0%';
  el.bar.style.display = '';
  _stickyBottom();
}
function setAttachProgress(pct) {
  const el = attachBarEls();
  if (el.bar.style.display === 'none') return; // отменено, пока событие шло
  el.fill.style.width = pct + '%';
  el.name.textContent = `Загрузка… ${pct}%`;
}
function setAttachProcessing() {
  const el = attachBarEls();
  if (el.bar.style.display === 'none') return;
  el.box.className = 'attach-thumb processing';
  el.name.textContent = 'Обработка…';
  el.track.classList.add('indeterminate');
}
function showAttachmentPreviewBar() {
  const att = _pendingAttachment;
  if (!att) { clearImagePreview(); return; }
  const el = attachBarEls();
  el.box.className = 'attach-thumb';
  el.track.style.display = 'none';
  el.track.classList.remove('indeterminate');
  const isImage = att.mime?.startsWith('image/');
  const isVideo = att.mime?.startsWith('video/');
  const thumbUrl = (isImage && !att.enc) ? att.url : (isVideo && att.thumb) ? att.thumb : null;
  el.img.src = thumbUrl ? `${httpProto()}://${S.server}${thumbUrl}` : '';
  el.img.style.display = thumbUrl ? '' : 'none';
  el.ico.style.display = thumbUrl ? 'none' : '';
  el.title.textContent = 'Вложение';
  el.name.textContent = att.name || (isImage ? 'Изображение' : isVideo ? 'Видео' : 'Файл');
  el.bar.style.display = '';
  _stickyBottom();
}


function clearImagePreview() {
  _uploadToken++;
  if (_uploadXhr) { _uploadXhr.abort(); _uploadXhr = null; }
  else if (_pendingAttachment) {
    // Загрузка уже завершилась (файл лежит на сервере), просто ещё не
    // отправлена — крестик должен убрать файл и с сервера, а не только из плашки
    api('DELETE', '/upload', { url: _pendingAttachment.url, thumb: _pendingAttachment.thumb });
  }
  _pendingAttachment = null;
  const bar = document.getElementById('image-preview-bar');
  if (bar) bar.style.display = 'none';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn && !document.getElementById('msg-input')?.value.trim()) {
    sendBtn.style.background='var(--composer-bg)'; sendBtn.style.color='var(--muted)'; sendBtn.style.boxShadow='none';
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
  // сброс в начальное состояние без transition
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
  // Снятые администратором или истёкшие, пока клиент был без связи, убираем
  const alive = new Set(list.map(a => a.id));
  [..._banners.keys()].forEach(id => { if (!alive.has(id)) hideBanner(id); });
  list.forEach(showBanner);
}

// ── ЛАЙТБОКС (фото и видео) ──
// На весь монитор — как в Telegram, отдельным нативным окном без рамки поверх
// главного окна (см. main.js), а не растяжением div внутри окна приложения.
function openLightbox(url, filename, type = 'image') {
  window.electron.openLightboxWindow({ url, filename: filename || (type === 'video' ? 'video' : 'image'), type });
}

// ── DOWNLOADED FILES ──
let _downloadedFiles = {};

function loadDownloadedFiles() {
  try { _downloadedFiles = JSON.parse(localStorage.getItem('downloaded_files') || '{}'); } catch {}
}

function saveDownloadedFiles() {
  try { localStorage.setItem('downloaded_files', JSON.stringify(_downloadedFiles)); } catch {}
}

async function verifyDownloadedFiles() {
  if (!window.electron?.fileExists) return;
  const verified = {};
  for (const [url, localPath] of Object.entries(_downloadedFiles)) {
    if (await window.electron.fileExists(localPath)) verified[url] = localPath;
  }
  _downloadedFiles = verified;
  saveDownloadedFiles();
}

function openDownloadedFile(localPath) {
  window.electron?.openFile(localPath);
}

let _dlToastTimer = null;
function showDownloadSuccessToast() {
  let el = document.getElementById('download-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'download-toast';
    el.innerHTML = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline class="dt-check" points="20 6 9 17 4 12"/></svg>`;
    document.body.appendChild(el);
  }
  el.classList.remove('dt-show');
  void el.offsetWidth; // force reflow — перезапускает @keyframes
  clearTimeout(_dlToastTimer);
  el.classList.add('dt-show', 'dt-was-shown');
  _dlToastTimer = setTimeout(() => el.classList.remove('dt-show'), 2000);
}

function updateAttachmentButtons(url, localPath) {
  document.querySelectorAll(`.bubble-file[data-att-url="${CSS.escape(url)}"]`).forEach(el => {
    el.classList.add('bubble-file-done');
    el.setAttribute('onclick', `openDownloadedFile('${localPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')`);
    const icon = el.querySelector('.dl-icon');
    if (icon) icon.outerHTML = `<span class="bubble-file-open-label">Открыть</span>`;
  });
}

async function downloadAttachment(url, filename) {
  if (window.electron?.downloadFile) {
    try {
      const localPath = await window.electron.downloadFile({ url, filename });
      if (localPath) {
        _downloadedFiles[url] = localPath;
        saveDownloadedFiles();
        showDownloadSuccessToast();
        updateAttachmentButtons(url, localPath);
      }
    } catch { showActionToast('Ошибка скачивания'); }
  } else {
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'file'; a.target = '_blank'; a.rel = 'noopener';
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
  el.classList.remove('msg-highlight');
  void el.offsetWidth;
  el.classList.add('msg-highlight');
  el.addEventListener('animationend', () => el.classList.remove('msg-highlight'), { once: true });
}
function hideCtxMenu() {
  document.getElementById('ctx-menu').classList.remove('open');
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
      '<div class="ep-search">' + "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/></svg>" +
        '<input id="rp-search-input" placeholder="Поиск смайла" autocomplete="off"' +
        ' oninput="filterEmoji(this.value, \'rp\')"></div>' +
      '<div class="ep-tabs" id="rp-tabs">' + emojiTabsHtml('rp') + '</div>' +
      '<div class="ep-scroll" id="rp-scroll" onscroll="syncEmojiTabs(\'rp\')"></div>';
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
  syncEmojiTabs('rp');
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

function ctxEdit() {
  hideCtxMenu();
  if (!S.ctx.canEdit || S.secretChatIds.has(S.activeChatId)) return;
  const el = document.querySelector(`[data-msg-id="${S.ctx.messageId}"] .irc-text`);
  const text = el?.textContent?.replace(' изм.','').trim()||'';
  S.editingMessageId = S.ctx.messageId;
  const bar = document.getElementById('edit-bar');
  if (bar) bar.style.display='flex';
  const input = document.getElementById('msg-input');
  if (input) { input.value=text; input.focus(); autoResize(input); }
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

async function ctxInfo() {
  hideCtxMenu();
  const msgId = S.ctx.messageId;
  if (!msgId) return;
  const data = await api('GET', `/messages/${msgId}/info`);
  if (!data || data.error) return;

  function fmtDt(ts) {
    if (!ts) return null;
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
  }

  const icoSingleTeal = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const icoDblTeal    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 5 7 16 2 11"/><polyline points="22 5 13 16 8 11"/></svg>`;
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

  document.querySelector('#modal-msg-info .mi-title').textContent = data.chat_type === 'direct' ? 'Информация' : 'Прочитано';

  let body;
  if (data.chat_type === 'direct') {
    const s = data.statuses[0];
    const sentDone  = !!data.sent_at;
    const delivDone = !!s?.delivered_at;
    const readDone  = !!s?.read_at;
    body = `<div class="mi-timeline">
      ${tlStep('Отправлено', fmtDt(data.sent_at) || '—', sentDone, icoSingleTeal, true)}
      ${tlStep('Доставлено', delivDone ? fmtDt(s?.delivered_at) : 'пока не доставлено', delivDone, delivDone ? icoDblTeal : icoDblGray, true)}
      ${tlStep('Прочитано', readDone ? fmtDt(s?.read_at) : 'пока не прочитано', readDone, readDone ? icoDblTeal : icoDblGray, false)}
    </div>`;
  } else {
    const total = data.statuses.length;
    const readUsers = data.statuses.filter(s => s.read_at).sort((a, b) => b.read_at - a.read_at);
    const circ = 100.5; // 2*π*16, радиус кольца из CSS (.mi-ring, r=16)
    const frac = total ? readUsers.length / total : 0;
    const ring = `<div class="mi-ring">
        <svg viewBox="0 0 38 38">
          <circle cx="19" cy="19" r="16" fill="none" stroke="var(--border)" stroke-width="3.5"/>
          <circle cx="19" cy="19" r="16" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${(circ * (1 - frac)).toFixed(1)}"/>
        </svg>
        <b>${readUsers.length}/${total}</b>
      </div>`;
    body = `<div class="mi-progress">${ring}
      <div><div class="mi-progress-label">${readUsers.length === total ? 'Прочитали все' : 'Прочитано'}</div>
      <div class="mi-progress-sub">${readUsers.length} из ${nMembers(total)}</div></div></div>`;
    if (readUsers.length === 0) {
      body += `<div class="mi-empty">Пока никто не прочитал</div>`;
    } else {
      body += readUsers.map(s => {
        const [date, time] = fmtDt(s.read_at).split(' ');
        return `<div class="mi-row">
        <div class="av mi-av ${userAvatarColor(s.user_id)}" data-av-user="${s.user_id}">${initials(s.display_name)}</div>
        <div class="mi-name">${esc(s.display_name)}</div>
        <div class="mi-time-col">
          <div class="mi-tick-row">${icoDblTeal}${time}</div>
          <div class="mi-time-date">${date}</div>
        </div>
      </div>`;
      }).join('');
    }
  }
  document.getElementById('msg-info-body').innerHTML = body;
  if (data.chat_type !== 'direct') applyAvatars();
  openModal('modal-msg-info');
}

// ── CUSTOM CONFIRM (replaces native confirm to avoid Electron focus bug on Windows) ──
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

// ── DELETE CHAT / LEAVE GROUP ──
async function deleteChat(chatId) {
  if (S.secretChatIds.has(chatId)) {
    const ok = await showConfirm('Удалить секретный чат на этом устройстве? Ключ будет стёрт — чтобы вернуть доступ, понадобится подтверждение собеседника.');
    if (!ok) return;
    const deviceId = await scEnsureDeviceId();
    await api('DELETE', `/chats/${chatId}?device_id=${encodeURIComponent(deviceId || '')}`);
    await scForgetChatKey(chatId);
    S.scHidden.add(chatId);
    await scPersistKeys();
    removeChatLocally(chatId);
    return;
  }
  const ok = await showConfirm('Удалить чат? Для вас он исчезнет из списка.');
  if (!ok) return;
  await api('DELETE', `/chats/${chatId}`);
  removeChatLocally(chatId);
}

function closeActiveChat() {
  S.activeChatId = null;
  document.getElementById('chat-main').innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`;
  renderChatList();
}

function removeChatLocally(chatId) {
  S.chats = S.chats.filter(c=>c.id!==chatId);
  if (S.activeChatId === chatId) {
    S.activeChatId = null;
    document.getElementById('chat-main').innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`;
  }
  renderChatList();
}

async function leaveGroup(chatId) {
  const ok = await showConfirm('Выйти из группы?', 'Выйти');
  if (!ok) return;
  await api('POST', `/chats/${chatId}/leave`);
  S.activeChatId = null;
  document.getElementById('chat-main').innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Electron</div><div class="empty-sub">Выберите чат или создайте новый</div></div>`;
  loadChats();
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
  if (S.user && S.user.id === u.user_id) { fix(S.user); reportAccount(); }
  renderChatList();
  if (document.querySelector('#chats-list .pp-row')) renderContactsList(document.getElementById('search')?.value || '');
  const active = S.chats.find(c => c.id === S.activeChatId);
  const nameEl = document.querySelector('.ch-name');
  if (nameEl && active) nameEl.textContent = chatName(active);
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

    if (data.type==='connected') { S.editLimit = data.edit_time_limit || 120; return; }

    if (data.type==='secret_key_ready') { scPollPending(data.chat_id); return; }
    if (data.type==='secret_grant_redeemed') { scOnGrantRedeemed(data); return; }

    if (data.type==='message') {
      const { message } = data;
      const chatId = message.chat_id;
      const parentId = message.parent_id || null;
      // Новое сообщение возвращает секретный чат, отключённый на этом устройстве
      if (S.scHidden.has(chatId)) { S.scHidden.delete(chatId); scPersistKeys(); }
      // Обновляем last_message родительской комнаты если это тема
      if (parentId) {
        const parentChat = S.chats.find(c=>c.id===parentId);
        if (parentChat) parentChat.last_message = message;
      }
      const chat = S.chats.find(c=>c.id===chatId) || (parentId ? S.chats.find(c=>c.id===parentId) : null);
      if (!parentId && chat) chat.last_message = message;
      // Если мы вглуби истории (низ не догружен) — не аппендим, придёт при догрузке
      if (S.activeChatId===chatId && !S.chatHasMoreAfter && _loadingChatId !== chatId) {
        // Убираем optimistic-заглушку если она есть (только для своих сообщений)
        if (message.sender_id === S.user.id) {
          document.querySelector('[data-optimistic="1"]')?.remove();
        }
        appendMsg(message);
        S.chatNewestId = message.id;
        if (isViewing() && S.ws?.readyState===1) {
          // Пользователь смотрит в чат — отмечаем прочитанным
          S.ws.send(JSON.stringify({type:'read', chat_id:chatId}));
          S.ws.send(JSON.stringify({type:'delivered', message_id:message.id}));
        } else if (!isViewing() && message.sender_id !== S.user.id) {
          // Окно скрыто/свёрнуто — уведомляем, не отмечаем прочитанным
          S.unread[chatId] = (S.unread[chatId]||0)+1;
          if (message.mentions?.includes(S.user.id)) S.unreadMentions[chatId] = (S.unreadMentions[chatId]||0)+1;
          if (!isChatMuted(chatId, parentId)) {
            const _srObj = parentId ? (S.topics[parentId]||[]).find(s=>s.id===chatId) : null;
            const title = _srObj?.name || chatName(chat) || message.sender_name || 'Electron';
            const body = S.secretChatIds.has(chatId) ? 'Новое сообщение' : `${message.sender_name}: ${(message.text ? message.text.replace(/<[^>]*>/g, '') : '') || (message.attachment ? (message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : message.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
            window.electron?.notify(title, body, chatId);
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
          const _srObj = parentId ? (S.topics[parentId]||[]).find(s=>s.id===chatId) : null;
          const title = _srObj?.name || chatName(chat) || message.sender_name || 'Electron';
          const body = S.secretChatIds.has(chatId) ? 'Новое сообщение' : `${message.sender_name}: ${(message.text ? message.text.replace(/<[^>]*>/g, '') : '') || (message.attachment ? (message.attachment.mime?.startsWith('image/') ? '🖼 Изображение' : message.attachment.mime?.startsWith('video/') ? '🎬 Видео' : '📎 ' + (message.attachment.name || 'Файл')) : '')}`;
          window.electron?.notify(title, body, chatId);
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

    if (data.type==='reload_chats') {
      loadChats();
    }

    // Fix 1: handle chat_deleted WS event
    if (data.type==='chat_deleted') {
      removeChatLocally(data.chat_id);
    }

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
      // Если чат открыт — очищаем историю сообщений на экране
      if (S.activeChatId === data.chat_id) {
        S.messages = [];
        S.chatHasMore = false;
        S.chatOldestId = null;
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
          const prevScrollHeight = container?.scrollHeight || 0;
          const isAtBottom = container && (container.scrollHeight - container.scrollTop - container.clientHeight < 10);

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
            const delta = container.scrollHeight - prevScrollHeight;
            if (isAtBottom) {
              // Были у дна — остаёмся у дна
              container.scrollTop = container.scrollHeight;
            } else if (delta > 0) {
              // Компенсируем сдвиг: прокручиваем вверх на высоту добавленного элемента,
              // чтобы сообщения ниже реакции остались на месте
              container.scrollTop += delta;
            }
          }
        }
      }
    }

    if (data.type==='reaction_notify') {
      // Только нативное уведомление, без счётчиков непрочитанного —
      // как и для сообщений, не беспокоим, если окно сейчас видно и в фокусе
      if (!isViewing()) {
        window.electron?.notify(data.reactorName, `${data.reaction} на ваше сообщение`, data.chatId);
        playNotificationSound();
      }
    }

    if (data.type==='typing') {
      showTyping(data.chat_id, data.sender_name);
    }

    if (data.type==='presence') {
      S.presence[data.user_id] = data.status;
      if (data.last_seen) S.lastSeen[data.user_id] = data.last_seen;
      // Обновляем подпись в шапке открытого личного чата («в сети» / «был(а) в …»)
      const activeChat = S.chats.find(c=>c.id===S.activeChatId);
      if (activeChat?.type === 'direct' && getPeerUserId(activeChat) === data.user_id) {
        const subEl = document.querySelector('.ch-sub');
        if (subEl) subEl.textContent = peerStatusText(data.user_id);
      }
      // Точечно обновляем presence-dot: зелёный — онлайн, оранжевый — отошёл, скрыта — офлайн
      document.querySelectorAll(`.presence-dot[data-user-id="${data.user_id}"]`).forEach(dot => {
        dot.classList.toggle('away', data.status === 'away');
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
      S.avatarTs = Date.now();
      _avatarCache.clear();
      renderChatList();
    }

    if (data.type==='user_created') {
      loadUsers();
    }
    if (data.type==='user_updated') applyUserUpdate(data);

    if (data.type === 'force_update') {
      // Сервер присылает готовый downloadUrl для нашей платформы.
      // Если по какой-то причине не прислал — ищем сами через GitHub API.
      if (data.downloadUrl) {
        _updateDownloadUrl = data.downloadUrl;
        forceInstallUpdate();
      } else {
        checkUpdateForced().then(() => {
          if (_updateDownloadUrl) forceInstallUpdate();
          else showActionToast('Обновление недоступно: файл не найден в релизе');
        });
      }
    }

    if (data.type === 'force_logout') {
      logout(true);
    }

    if (data.type === 'announcement') {
      showSystemAnnouncement(data.text);
      // Окно свёрнуто или не в фокусе — модалку человек не увидит, поэтому
      // предупреждаем так же, как о новом сообщении. Мут чатов тут не при чём:
      // это объявление от администрации, а не переписка.
      if (!isViewing()) {
        const body = (data.text || '').replace(/\s+/g, ' ').slice(0, 120);
        window.electron?.notify('Системное объявление', body, null);
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
        window.electron?.notify('Системное объявление', body, null);
        playNotificationSound();
      }
    }
    if (data.type === 'banner_removed') hideBanner(data.id);

    if (data.type === 'force_restart') {
      // Только Electron: полный рестарт процесса. В веб-клиенте команда игнорируется.
      window.electron?.restartApp?.();
    }
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
  ws.onopen = async () => {
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
    // Heartbeat: ловим «зомби»-сокеты (сон системы, обрыв VPN/NAT), когда TCP
    // не закрылся и readyState остаётся 1. Нет pong на ping — соединение мёртвое,
    // закрываем принудительно → onclose поднимет реконнект.
    ws._pongOk = true;
    clearInterval(ws._hb);
    ws._hb = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!ws._pongOk) { try { ws.close(); } catch {} return; }
      ws._pongOk = false;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 20000);
    // Delay status send: at launch document.hidden may still be true while window is appearing
    setTimeout(() => {
      const initStatus = isViewing() ? 'online' : 'away';
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'set_status', status: initStatus }));
    }, 300);
    // Отправить метаданные клиента
    try {
      const version = await window.electron?.getVersion?.() || '';
      const hostname = await window.electron?.getHostname?.() || '';
      const osInfo = await window.electron?.getOS?.() || {};
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'client_info', clientVersion: version, hostname, osPlatform: osInfo.platform || '', osRelease: osInfo.release || '', installScope: osInfo.installScope || null }));
    } catch {}
  };
  ws.onerror = () => ws.close();
}

function updateUnreadTotal() {
  const total = Object.values(S.unread).reduce((a,b)=>a+b,0);
  window.electron?.setUnread(total);
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

// Текст статуса собеседника для шапки чата (как в Telegram)
function formatLastSeen(ts) {
  if (!ts) return 'Был в сети';
  const d = new Date(ts * 1000), now = new Date();
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
  return `<span class="presence-dot${st === 'away' ? ' away' : ''}" data-user-id="${userId}"${st === 'offline' ? ' style="display:none"' : ''}></span>`;
}

function getPeerUserId(chat) {
  if (chat.type !== 'direct') return null;
  return chat.members?.find(m => m.id !== S.user.id)?.id || null;
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

// ── НОВЫЙ ЧАТ ──
// Два шага: сначала выбор вида (личный или группа), потом список людей. Раньше
// на одном экране были вкладки «Личный/Группа», и тип приходилось выбирать до
// того, как понятно, кого добавляешь.
const NC_ICON = {
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  group:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  secret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
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
      <button class="nc-kind" onclick="ncPick('direct')">
        <span class="nc-kind-ic">${NC_ICON.person}</span>
        <span class="nc-kind-txt"><b>Личный чат</b><span>Личная переписка с пользователем</span></span>
        <span class="nc-kind-go">›</span>
      </button>
      <button class="nc-kind" onclick="ncPick('secret')">
        <span class="nc-kind-ic">${NC_ICON.secret}</span>
        <span class="nc-kind-txt"><b>Секретный чат</b><span>Сквозное шифрование, сообщения только на ваших устройствах</span></span>
        <span class="nc-kind-go">›</span>
      </button>
      <button class="nc-kind" onclick="ncPick('group')">
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
  ncHead(group ? 'Новая группа' : kind === 'secret' ? 'Секретный чат' : 'Личный чат', 'Шаг 2 из 2', true);
  document.getElementById('nc-body').innerHTML = `
    ${group ? `<div class="nc-group-bar">
      <div class="av av-md av-round av-green" id="new-group-av" style="cursor:pointer;flex-shrink:0" onclick="triggerGroupAvatarUpload()">Г</div>
      <input id="group-name" class="nc-name-input" placeholder="Название группы" autocomplete="off">
      <input type="file" id="group-avatar-input" accept="image/*" style="display:none" onchange="onGroupAvatarChange(this)">
    </div>` : ''}
    <div class="nc-search">
      ${NC_ICON.search}
      <input id="nc-search-input" placeholder="Поиск по имени или логину" autocomplete="off" oninput="filterModalUsers(this.value)">
    </div>
    <div id="nc-list" class="users-list nc-list"></div>
    ${group ? `<div class="nc-foot">
      <span class="nc-hint" id="nc-hint">Отметьте участников</span>
      <button class="modal-btn-ghost" onclick="ncBack()">Назад</button>
      <button class="modal-btn-primary" onclick="createGroup()">Создать группу</button>
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
  const list = S.allUsers.filter(u=>!filter||u.display_name.toLowerCase().includes(filter)||u.username.toLowerCase().includes(filter));
  container.innerHTML = list.map(u=>`
    <div class="pp-row${multi&&S.ncSelected?.has(u.id)?' on':''}" data-uid="${u.id}" onclick="${multi?`toggleModalUser(${u.id})`:S.ncKind==='secret'?`startSecret(${u.id})`:`startDirect(${u.id})`}">
      ${ppAvHtml(u)}
      <span class="pp-name">${esc(u.display_name)}</span>
      ${u.tag?`<span class="pp-tag">${esc(u.tag)}</span>`:''}
      ${multi?PP_CHECK:''}
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
  if (data?.id) { closeNewChat(); await loadChats(); openChat(data.id); }
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

// ── СЕКРЕТНЫЕ ЧАТЫ (E2E) ──
// Крипто — только через Web Crypto: в рендерере contextIsolation и без Node crypto.
// Ключ чата — AES-256-GCM. Одобрение нового устройства: новое устройство создаёт
// эфемерную пару ECDH P-256 и показывает код → собеседник вводит код на своём
// уже синхронизированном устройстве → оно шифрует ключ чата для эфемерного ключа
// нового устройства → новое устройство расшифровывает и сохраняет. Сервер видит
// только публичные ключи и уже зашифрованный blob.

const SC_ECDH = { name: 'ECDH', namedCurve: 'P-256' };

function scB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function scUnB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function scEnsureDeviceId() {
  if (!S.scDeviceId) S.scDeviceId = await window.electron?.secretDeviceId() || null;
  return S.scDeviceId;
}

async function scLoadKeys() {
  if (S.scLoaded) return;
  S.scLoaded = true;
  let blob = {};
  try { blob = JSON.parse((await window.electron?.secretKeysLoad()) || '{}'); } catch {}
  // Старый формат — голая карта chatId→ключ, без полей keys/hidden
  const legacy = !blob.keys && !blob.hidden && !blob.pending;
  S.scRaw = legacy ? blob : (blob.keys || {});
  S.scHidden = new Set(legacy ? [] : (blob.hidden || []).map(Number));
  for (const [chatId, b64] of Object.entries(S.scRaw)) {
    try { S.scKeys[chatId] = await scImportAesKey(b64); } catch {}
  }
  // Незавершённый запрос доступа переживает перезапуск приложения
  S.scPendingSaved = legacy ? {} : (blob.pending || {});
  for (const [chatId, p] of Object.entries(S.scPendingSaved)) {
    if (p.expiresAt < Date.now()) { delete S.scPendingSaved[chatId]; continue; }
    try {
      const privateKey = await crypto.subtle.importKey('pkcs8', scUnB64(p.pkcs8), SC_ECDH, true, ['deriveKey']);
      S.scPending[chatId] = { requestId: p.requestId, code: p.code, privateKey, timer: setInterval(() => scPollPending(Number(chatId)), 4000) };
    } catch { delete S.scPendingSaved[chatId]; }
  }
}

async function scPersistKeys() {
  await window.electron?.secretKeysSave(JSON.stringify({ keys: S.scRaw, hidden: [...S.scHidden], pending: S.scPendingSaved }));
}

function scImportAesKey(b64) {
  return crypto.subtle.importKey('raw', scUnB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function scSetChatKey(chatId, b64) {
  S.scRaw[chatId] = b64;
  S.scKeys[chatId] = await scImportAesKey(b64);
  await scPersistKeys();
}

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

async function scForgetChatKey(chatId) {
  delete S.scRaw[chatId];
  delete S.scKeys[chatId];
  scClearChatCache(chatId);
  await scPersistKeys();
}

async function scGenerateChatKeyB64() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return scB64(await crypto.subtle.exportKey('raw', key));
}

async function scEncryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { text: scB64(ct), iv: scB64(iv) };
}

async function scDecryptText(key, ctB64, ivB64) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: scUnB64(ivB64) }, key, scUnB64(ctB64));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

async function scGenEphemeral() {
  const kp = await crypto.subtle.generateKey(SC_ECDH, true, ['deriveKey']);
  return { privateKey: kp.privateKey, pubB64: scB64(await crypto.subtle.exportKey('spki', kp.publicKey)) };
}

async function scDeriveWrapKey(privateKey, peerPubB64) {
  const peer = await crypto.subtle.importKey('spki', scUnB64(peerPubB64), SC_ECDH, true, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function scWrapChatKey(wrapKey, chatKeyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, scUnB64(chatKeyB64));
  return `${scB64(iv)}.${scB64(ct)}`;
}

async function scUnwrapChatKey(wrapKey, packed) {
  const [ivB64, ctB64] = String(packed).split('.');
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: scUnB64(ivB64) }, wrapKey, scUnB64(ctB64));
  return scB64(raw);
}

// Заглушка вместо текста: серые полоски, длина зависит от шифротекста
function scSkelHtml(ct) {
  const n = (ct || '').length;
  const w1 = Math.min(Math.max(Math.round(n * 0.5), 90), 220);
  const w2 = Math.min(Math.max(Math.round(n * 0.3), 50), 140);
  return `<span class="sc-skel" style="width:${w1}px"></span>` + (n > 120 ? `<span class="sc-skel" style="width:${w2}px"></span>` : '');
}

// Текст секретного сообщения — зашифрованный JSON {v:2, t, a}; старые сообщения
// без обёртки — голый текст, его берём как есть
function scParsePayload(plain) {
  try {
    const o = JSON.parse(plain);
    if (o && o.v === 2) return { t: o.t || '', a: o.a || null };
  } catch {}
  return { t: plain, a: null };
}

const _scInflight = new Set();

// Расшифровывает видимые сообщения секретного чата и подменяет пиксели текстом
// (и картинки вложений) на месте — без перезагрузки чата
async function scDecryptVisible() {
  const chatId = S.activeChatId;
  const key = chatId && S.scKeys[chatId];
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
        const plain = await scDecryptText(key, m.text, m.iv);
        if (plain !== null && S.activeChatId === chatId) {
          const p = scParsePayload(plain);
          S.scDecrypted.set(id, p.t);
          if (p.a) S.scAtt.set(id, p.a);
          changed = true;
        }
      }
      const curMeta = S.scAtt.get(id);
      if (curMeta?.m?.startsWith('image/') && m.attachment?.url && !S.scAttBlob.has(id) && S.activeChatId === chatId) {
        const buf = await scFetchDecryptFile(m, key);
        if (buf && S.activeChatId === chatId) {
          S.scAttBlob.set(id, URL.createObjectURL(new Blob([buf], { type: curMeta.m })));
          changed = true;
        }
      }
      if (changed && S.activeChatId === chatId) updateMsgInDOM(m);
    } finally { _scInflight.delete(id); }
  }
}

async function scEncryptFileForUpload(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), fiv: scB64(iv) };
}

async function scFetchDecryptFile(m, key) {
  try {
    const res = await fetch(`${httpProto()}://${S.server}${m.attachment.url}`, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) return null;
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: scUnB64(m.attachment.fiv) }, key, await res.arrayBuffer());
  } catch { return null; }
}

// Картинка уходит в окно просмотра как data-URL: blob-ссылка другому окну недоступна
async function scOpenImage(msgId) {
  const url = S.scAttBlob.get(msgId);
  if (!url) return;
  const blob = await (await fetch(url)).blob();
  const reader = new FileReader();
  reader.onload = () => openLightbox(reader.result, S.scAtt.get(msgId)?.n || 'image', 'image');
  reader.readAsDataURL(blob);
}

async function scSaveAttachment(msgId) {
  const m = S.scMsgObjs.get(msgId);
  const meta = S.scAtt.get(msgId);
  const key = m && S.scKeys[m.chat_id];
  if (!m?.attachment?.url || !meta || !key) { showActionToast('Вложение пока не расшифровано'); return; }
  const buf = await scFetchDecryptFile(m, key);
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
    if (blob && S.scKeys[m.chat_id]) return `<div class="bubble-image" onclick="scOpenImage(${m.id})"><img src="${esc(blob)}" loading="lazy"></div>`;
    return `<div class="bubble-file sc-att-locked"><div class="bubble-file-info"><div class="bubble-file-name">Изображение</div></div></div>`;
  }
  return `<div class="bubble-file" onclick="scSaveAttachment(${m.id})">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    <div class="bubble-file-info"><div class="bubble-file-name">${esc(meta.n || 'Файл')}</div>${sizeFmt ? `<div class="bubble-file-size">${sizeFmt}</div>` : ''}</div>
    <svg class="dl-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  </div>`;
}

const SC_LOCK_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const SC_DEV_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const scFmtCode = c => c && c.length > 4 ? c.slice(0, 4) + ' ' + c.slice(4) : (c || '');

function scApplyComposerState(chatId) {
  const pill = document.getElementById('composer-pill');
  const wrap = document.getElementById('input-wrap');
  if (!pill || !wrap) return;
  wrap.querySelector('.sc-locked-banner')?.remove();
  if (!S.secretChatIds.has(chatId)) { pill.style.display = ''; return; }
  if (!S.scKeys[chatId]) { scRenderBanner(chatId); return; }
  pill.style.display = '';
  pill.querySelector('[title="Прикрепить файл"]')?.style.setProperty('display', 'none');
}

// Плашка вместо композера: закрыта (кнопка), раскрыта (поле кода), ожидание ответа собеседника
function scRenderBanner(chatId) {
  const wrap = document.getElementById('input-wrap');
  const pill = document.getElementById('composer-pill');
  if (!wrap || !pill) return;
  wrap.querySelector('.sc-locked-banner')?.remove();
  if (!S.secretChatIds.has(chatId) || S.scKeys[chatId]) return;
  pill.style.display = 'none';
  const mode = S.scPending[chatId] ? 'waiting' : (S.scBannerOpen === chatId ? 'open' : 'closed');
  let inner;
  if (mode === 'closed') {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Чат зашифрован</div><div class="sc-b-s">Сообщения видны после расшифровки</div></div>
      <button class="sc-btn" onclick="scOpenBanner(${chatId})">Расшифровать</button>`;
  } else if (mode === 'open') {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Введите код</div><div class="sc-b-s">Код назвал собеседник</div></div>
      <input id="sc-enter-code" class="sc-b-inp" placeholder="КОД" maxlength="12" autocomplete="off" onkeydown="if(event.key==='Enter')scRedeem(${chatId})">
      <button class="sc-btn" onclick="scRedeem(${chatId})">Подтвердить</button>
      <button class="sc-b-x" aria-label="Свернуть" onclick="scCloseBanner(${chatId})">×</button>`;
  } else {
    inner = `<div class="sc-b-txt"><div class="sc-b-t">Код принят</div><div class="sc-b-s"><span class="sc-dot"></span>Ждём подтверждения собеседника</div></div>
      <button class="sc-btn ghost" onclick="scCancelRequest(${chatId})">Отменить</button>`;
  }
  wrap.insertAdjacentHTML('afterbegin', `<div class="sc-locked-banner sc-${mode}"><div class="sc-lock">${SC_LOCK_ICO}</div>${inner}</div>`);
  if (mode === 'open') setTimeout(() => document.getElementById('sc-enter-code')?.focus(), 30);
}
function scOpenBanner(chatId) { S.scBannerOpen = chatId; scRenderBanner(chatId); }
function scCloseBanner(chatId) { S.scBannerOpen = null; scRenderBanner(chatId); }

// ── Создание ──
async function startSecret(userId) {
  const deviceId = await scEnsureDeviceId();
  if (!deviceId) { showActionToast('Не удалось определить устройство'); return; }
  await scLoadKeys();
  const data = await api('POST', '/chats/secret', {
    user_id: userId, device_id: deviceId, device_label: scDeviceLabel(), platform: 'electron',
  });
  if (!data?.id) { showActionToast('Не удалось создать секретный чат'); return; }
  S.secretChatIds.add(data.id);
  if (data.created) {
    try { await scSetChatKey(data.id, await scGenerateChatKeyB64()); }
    catch {
      await api('DELETE', `/chats/${data.id}?device_id=${encodeURIComponent(deviceId)}`);
      showActionToast('Не удалось сохранить ключ — чат не создан');
      return;
    }
  }
  closeNewChat();
  await loadChats();
  openChat(data.id);
}

function scDeviceLabel() {
  const p = navigator.platform || '';
  return p.toLowerCase().includes('mac') ? 'Mac' : p.toLowerCase().includes('win') ? 'Windows' : (p || 'Компьютер');
}

// ── Запрос доступа (новое или восстановленное устройство) ──

function scRenderSyncModal(mode, extra = {}) {
  const body = document.getElementById('sc-sync-body');
  if (!body) return;
  const chatId = S.scSyncChatId;
  if (mode === 'grant') {
    const g = S.scGrant[chatId];
    body.innerHTML = `<div class="sc-m">
      <p class="sc-m-hint">Продиктуйте собеседнику код. Он действует 10 минут.</p>
      <div class="sc-codebox"><span class="sc-code">${esc(scFmtCode(g.code))}</span><button class="sc-copy" onclick="scCopyCode('${esc(g.code)}')">Копировать</button></div>
      <div class="sc-wait"><span class="sc-dot"></span>Ждём, пока собеседник введёт код</div></div>`;
  } else if (mode === 'confirm') {
    S.scConfirm = extra;
    const dev = `${extra.label || 'Устройство'}, ${extra.platform === 'electron' ? 'приложение' : 'браузер'}`;
    body.innerHTML = `<div class="sc-m">
      <p class="sc-m-hint">Собеседник ввёл код и просит открыть чат:</p>
      <div class="sc-dev"><div class="sc-dev-ico">${SC_DEV_ICO}</div><div>
        <div class="sc-dev-n">${esc(dev)}</div>
        <div class="sc-dev-s">${extra.ip ? 'IP ' + esc(extra.ip) + ' · ' : ''}запрос только что</div></div></div>
      <p class="sc-meta">Подтверждайте, только если собеседник ввёл продиктованный вами код и сейчас с вами на связи.</p></div>
      <div class="sc-mfoot"><button class="sc-btn ghost" onclick="scRenderSyncModal('grant')">Назад</button><button class="sc-btn" onclick="scApproveRequest(${chatId})">Подтвердить</button></div>`;
  }
}

// Расшифрованное устройство создаёт код, собеседник вводит его на своём устройстве
async function ctxChatGrant() {
  const chatId = S.ctxChatId;
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!chatId) return;
  const deviceId = await scEnsureDeviceId();
  const data = await api('POST', `/secret/${chatId}/grants`, { device_id: deviceId, platform: 'electron' });
  if (!data?.code) { showActionToast(data?.error || 'Не удалось создать код'); return; }
  S.scGrant[chatId] = { grantId: data.grant_id, code: data.code };
  S.scSyncChatId = chatId;
  document.getElementById('sc-sync-title').textContent = 'Предоставить доступ';
  scRenderSyncModal('grant');
  openModal('modal-secret-sync');
}

// Собеседник ввёл код — показываем устройство и ждём подтверждения
function scOnGrantRedeemed(data) {
  const grant = S.scGrant[data.chat_id];
  if (!grant) { showActionToast('Собеседник ввёл код, но он создан в другом сеансе — создайте новый'); return; }
  S.scSyncChatId = data.chat_id;
  document.getElementById('sc-sync-title').textContent = 'Подтвердить устройство';
  scRenderSyncModal('confirm', {
    requestId: data.request_id, label: data.device_label, platform: data.platform,
    pubB64: data.ephemeral_pubkey, code: grant.code, ip: data.ip,
  });
  openModal('modal-secret-sync');
}

async function scRedeem(chatId) {
  const code = (document.getElementById('sc-enter-code')?.value || '').trim().toUpperCase();
  if (!code) return;
  const eph = await scGenEphemeral();
  const deviceId = await scEnsureDeviceId();
  const data = await api('POST', `/secret/${chatId}/grants/redeem`, {
    code, device_id: deviceId, device_label: scDeviceLabel(), platform: 'electron', ephemeral_pubkey: eph.pubB64,
  });
  if (!data?.request_id) { showActionToast(data?.error || 'Не удалось расшифровать чат'); return; }
  S.scPending[chatId] = { requestId: data.request_id, privateKey: eph.privateKey, timer: setInterval(() => scPollPending(chatId), 4000) };
  S.scPendingSaved[chatId] = {
    requestId: data.request_id,
    pkcs8: scB64(await crypto.subtle.exportKey('pkcs8', eph.privateKey)),
    expiresAt: Date.now() + 600 * 1000,
  };
  await scPersistKeys();
  S.scBannerOpen = null;
  scRenderBanner(chatId);
}

function scCancelSyncModal() { closeModal('modal-secret-sync'); }

async function scCopyCode(code) {
  try { await navigator.clipboard.writeText(code); }
  catch {
    const t = document.createElement('textarea');
    t.value = code;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  showActionToast('Код скопирован');
}

async function scCancelRequest(chatId) {
  const p = S.scPending[chatId];
  if (p) clearInterval(p.timer);
  delete S.scPending[chatId];
  if (S.scPendingSaved[chatId]) { delete S.scPendingSaved[chatId]; await scPersistKeys(); }
  scRenderBanner(chatId);
}

function ctxChatDevices() {
  const chatId = S.ctxChatId;
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (chatId) scOpenDevices(chatId);
}

async function scOpenDevices(chatId) {
  const rows = await api('GET', `/secret/${chatId}/devices`);
  if (!Array.isArray(rows)) { showActionToast(rows?.error || 'Не удалось загрузить устройства'); return; }
  const mine = await scEnsureDeviceId();
  const chat = S.chats.find(c => c.id === chatId);
  const names = Object.fromEntries((chat?.members || []).map(u => [u.id, u.display_name]));
  document.getElementById('sc-sync-title').textContent = 'Устройства секретного чата';
  document.getElementById('sc-sync-body').innerHTML = `
    <p class="sc-sync-hint">Здесь видно, на каких устройствах открыт доступ к чату. Ключ не переносится сам: новое устройство подключается только с подтверждения собеседника.</p>
    ${rows.map(r => `<div class="sc-sync-device">${esc(r.device_label || 'Устройство')} · ${esc(names[r.user_id] || 'Пользователь')}${r.device_id === mine ? ' — это устройство' : ''}</div>`).join('')}
    <div class="sc-sync-foot"><button class="modal-btn-ghost" onclick="scCancelSyncModal()">Закрыть</button></div>`;
  openModal('modal-secret-sync');
}

// Закрытие окна не отменяет ожидание: если собеседник подтвердит позже, ключ
// придёт сам (см. scPollPending), а пользователь увидит уведомление
async function scPollPending(chatId) {
  const p = S.scPending[chatId];
  if (!p || p.busy) return;
  p.busy = true;
  const data = await api('GET', `/secret/${chatId}/requests/${p.requestId}`);
  p.busy = false;
  if (!data) return;
  if (data.status !== 'approved') return;
  clearInterval(p.timer);
  try {
    const wrapKey = await scDeriveWrapKey(p.privateKey, data.approver_ephemeral_pubkey);
    const chatKeyB64 = await scUnwrapChatKey(wrapKey, data.wrapped_secret);
    await scSetChatKey(chatId, chatKeyB64);
    await api('POST', `/secret/${chatId}/requests/${p.requestId}/complete`);
    delete S.scPending[chatId];
    delete S.scPendingSaved[chatId];
    await scPersistKeys();
    closeModal('modal-secret-sync');
    showActionToast('Секретный чат расшифрован на этом устройстве');
    await loadChats();
    if (S.activeChatId === chatId) { scApplyComposerState(chatId); scDecryptVisible(); }
  } catch {
    delete S.scPending[chatId];
    delete S.scPendingSaved[chatId];
    await scPersistKeys();
    showActionToast('Не удалось расшифровать ключ — введите код заново');
    if (S.activeChatId === chatId) scRenderBanner(chatId);
  }
}

// ── Подтверждение запроса собеседника ──
async function scApproveRequest(chatId) {
  const c = S.scConfirm;
  const chatKeyB64 = S.scRaw[chatId];
  if (!c || !chatKeyB64) { showActionToast('Чат не расшифрован на этом устройстве'); return; }
  const deviceId = await scEnsureDeviceId();
  const eph = await scGenEphemeral();
  const wrapKey = await scDeriveWrapKey(eph.privateKey, c.pubB64);
  const wrapped = await scWrapChatKey(wrapKey, chatKeyB64);
  const data = await api('POST', `/secret/${chatId}/requests/${c.requestId}/approve`, {
    code: c.code, approver_device_id: deviceId, approver_ephemeral_pubkey: eph.pubB64, wrapped_secret: wrapped, platform: 'electron',
  });
  S.scConfirm = null;
  delete S.scGrant[chatId];
  if (!data?.ok) { showActionToast(data?.error || 'Не удалось подтвердить устройство'); return; }
  closeModal('modal-secret-sync');
  showActionToast('Устройство подтверждено');
}

// ── Выбор типа чата при клике на контакт ──
function openChatTypePicker(userId) {
  S.ctpUserId = userId;
  document.getElementById('ctp-body').innerHTML = `
    <div class="nc-kinds">
      <button class="nc-kind" onclick="ctpPick('direct')">
        <span class="nc-kind-ic">${NC_ICON.person}</span>
        <span class="nc-kind-txt"><b>Личный чат</b><span>Обычная переписка</span></span>
        <span class="nc-kind-go">›</span>
      </button>
      <button class="nc-kind" onclick="ctpPick('secret')">
        <span class="nc-kind-ic">${NC_ICON.secret}</span>
        <span class="nc-kind-txt"><b>Секретный чат</b><span>Сквозное шифрование, сообщения только на ваших устройствах</span></span>
        <span class="nc-kind-go">›</span>
      </button>
    </div>`;
  openModal('modal-chattype');
}

async function ctpPick(kind) {
  closeModal('modal-chattype');
  if (kind === 'secret') await startSecret(S.ctpUserId);
  else await startDirect(S.ctpUserId);
  setSidebarTab('chats');
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
  document.getElementById('chat-main').innerHTML = `
    <div class="gi-panel">
      <div class="gi-top-bar">
        <button class="icon-btn" onclick="closeGroupInfo()" title="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="gi-top-title">${isRoom ? 'Комната' : 'Группа'}</span>
      </div>
      <div class="gi-body">
        <div class="gi-avatar-wrap">
          <div class="av av-round ${avatarColor(chatId)}" id="gi-av" style="width:80px;height:80px;font-size:24px;font-weight:700;${canEdit?'cursor:pointer':''}" ${canEdit?'onclick="triggerGiAvatarUpload()"':''}>${initials(chat?.name||'G')}</div>
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
    </div>`;
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
    .filter(m => !S.giRemovedIds.has(m.id))
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
    document.getElementById('chat-main').innerHTML = `
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
    </div>`;
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

  const devicesBtn = document.getElementById('ctx-chat-devices');
  if (devicesBtn) devicesBtn.style.display = chat?.is_secret ? '' : 'none';
  const grantBtn = document.getElementById('ctx-chat-grant');
  if (grantBtn) grantBtn.style.display = (chat?.is_secret && S.scKeys[chatId]) ? '' : 'none';
  const muteLabel = document.getElementById('ctx-chat-mute-label');
  if (muteLabel) muteLabel.textContent = S.mutedChats.has(chatId) ? 'Включить уведомления' : 'Выключить уведомления';
  menu.style.display = 'block';
  // Клик по кнопке «⋯» в шапке — привязываемся к кнопке; правый клик по чату в списке — к курсору
  const btn = e.type === 'click' ? e.currentTarget : null;
  placeCtxMenu(menu, e.clientX, e.clientY, btn ? btn.getBoundingClientRect() : null);
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

async function ctxChatDelete() {
  document.getElementById('ctx-chat-menu').style.display = 'none';
  if (!S.ctxChatId) return;
  await deleteChat(S.ctxChatId);
}

// ── FORWARD ──
function ctxForward() {
  hideCtxMenu();
  if (S.secretChatIds.has(S.activeChatId)) { showActionToast('Из секретного чата нельзя пересылать сообщения'); return; }
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
      <div class="av av-sm ${chatAvatarClass(c)}${c.type==='room' && c.has_topics?' av-sq':' av-round'}" data-av-chat="${c.id}">${chatIcon(c)}</div>
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
  _stickyBottom();
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

// ── SERVER UNAVAILABLE TOAST ──
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

// ── HIGH AVAILABILITY ──
// Кастомный выбор диска вместо системного <select>: список — position:fixed,
// координаты считает JS (haPlaceDrivePop) — модалка обрезает содержимое
// (overflow:hidden), а backdrop-filter на подложке становится точкой отсчёта
// для fixed-потомков, так что обычным absolute список бы срезало по краю окна.
const HA_I = {
  net: csSvg('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>'),
  local: csSvg('<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>'),
  removable: csSvg('<circle cx="10" cy="7" r="1"/><circle cx="4" cy="20" r="2"/><path d="M10 7v11a2 2 0 0 1-2 2H6"/><path d="M4 15V9a2 2 0 0 1 2-2h10l4-4"/><path d="M17 5l2 2"/>'),
  other: csSvg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  check: csSvg('<polyline points="20 6 9 17 4 12"/>'),
};
const HA_DRIVE_ICON = { network: HA_I.net, local: HA_I.local, removable: HA_I.removable, optical: HA_I.other, other: HA_I.other };

let _haDrives = [];
let _haSelected = '';
let _haOpen = false;

async function openHAModal() {
  _haDrives = [];
  _haSelected = '';
  haCloseDrives();

  const activeInfo = document.getElementById('ha-active-info');
  const disableBtn = document.getElementById('ha-disable-btn');
  document.getElementById('ha-pick-ic').innerHTML = HA_I.other;
  document.getElementById('ha-pick-tx').innerHTML = '<b>Загрузка дисков…</b>';
  document.getElementById('ha-pick-btn').classList.add('ph');
  document.getElementById('ha-path-preview').textContent = '…\\Electron';
  openModal('modal-ha');

  const [drives, cfg] = await Promise.all([
    window.electron.listDrives(),
    window.electron.getHAConfig(),
  ]);
  _haDrives = drives || [];
  _haSelected = cfg?.drive || '';

  if (cfg?.drive) {
    activeInfo.style.display = 'block';
    document.getElementById('ha-active-path').textContent = `${cfg.drive}:\\Electron`;
    disableBtn.style.display = 'inline-flex';
  } else {
    activeInfo.style.display = 'none';
    disableBtn.style.display = 'none';
  }

  haRenderPickButton();
}

function haRenderPickButton() {
  const d = _haDrives.find(x => x.letter === _haSelected);
  document.getElementById('ha-pick-btn').classList.toggle('ph', !d);
  document.getElementById('ha-pick-ic').innerHTML = d ? (HA_DRIVE_ICON[d.type] || HA_I.other) : HA_I.other;
  document.getElementById('ha-pick-tx').innerHTML = d
    ? `<b>${esc(d.letter)}: — ${esc(d.volumeName || d.typeLabel)}</b><span>${esc(d.typeLabel)}</span>`
    : `<b>${_haDrives.length ? 'Выберите диск' : 'Дисков не найдено'}</b>`;
  document.getElementById('ha-path-preview').textContent = d ? `${d.letter}:\\Electron` : '…\\Electron';
}

function haToggleDrives(e) {
  e.stopPropagation();
  if (_haOpen) return haCloseDrives();
  _haOpen = true;
  const pick = document.getElementById('ha-pick');
  pick.classList.add('open');
  document.getElementById('ha-pick-btn').setAttribute('aria-expanded', 'true');

  const pop = document.createElement('div');
  pop.className = 'ha-pop';
  pop.id = 'ha-pop';
  pop.setAttribute('role', 'listbox');
  pop.setAttribute('aria-label', 'Диск для хранения данных');
  pop.innerHTML = _haDrives.length ? _haDrives.map(d => {
    const sel = d.letter === _haSelected;
    return `<button type="button" class="ha-opt${sel ? ' sel' : ''}" role="option" aria-selected="${sel}" onclick="haPickDrive('${d.letter}')">
        <span class="ha-opt-ic">${HA_DRIVE_ICON[d.type] || HA_I.other}</span>
        <span class="ha-opt-tx"><b>${esc(d.letter)}: — ${esc(d.volumeName || d.typeLabel)}</b><span>${esc(d.letter)}:\\Electron</span></span>
        <span class="ha-opt-tag${d.type === 'network' ? ' net' : ''}">${esc(d.typeLabel)}</span>
        ${sel ? `<span class="ha-opt-check">${HA_I.check}</span>` : ''}
      </button>`;
  }).join('') : '<div class="ha-pop-empty">Дисков не найдено</div>';
  pick.appendChild(pop);
  haPlaceDrivePop();
}

function haPickDrive(letter) {
  _haSelected = letter;
  haRenderPickButton();
  haCloseDrives();
}

function haCloseDrives() {
  _haOpen = false;
  document.getElementById('ha-pick')?.classList.remove('open');
  document.getElementById('ha-pick-btn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('ha-pop')?.remove();
}

// Список открывается в (0,0), затем координаты правятся по разнице между этой
// точкой и настоящим положением кнопки — тот же приём, что и в пикере даты
// админ-панели. Плюс поправка на масштаб интерфейса: getBoundingClientRect
// отдаёт визуальные пиксели, а style.left/top задаются в CSS-пикселях zoom-контекста.
function haPlaceDrivePop() {
  const btn = document.getElementById('ha-pick-btn');
  const pop = document.getElementById('ha-pop');
  if (!btn || !pop) return;
  pop.style.visibility = 'hidden';
  const r = btn.getBoundingClientRect();
  const z = btn.offsetWidth ? (r.width / btn.offsetWidth) : 1;
  pop.style.width = (r.width / z) + 'px';
  pop.style.left = '0px';
  pop.style.top = '0px';
  const zero = pop.getBoundingClientRect();
  const modal = btn.closest('.ha-modal');
  const mRect = modal?.getBoundingClientRect();
  const limitBottom = Math.min(mRect ? mRect.bottom - 8 : Infinity, window.innerHeight - 8);
  const limitTop = mRect ? mRect.top + 8 : 8;
  const top = (r.bottom + 6 + zero.height <= limitBottom) ? r.bottom + 6 : Math.max(limitTop, r.top - zero.height - 6);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - zero.width - 8));
  pop.style.left = ((left - zero.left) / z) + 'px';
  pop.style.top = ((top - zero.top) / z) + 'px';
  pop.style.visibility = '';
}

document.addEventListener('click', e => { if (_haOpen && !e.target.closest('.ha-pick')) haCloseDrives(); });
document.addEventListener('scroll', () => { if (_haOpen) haCloseDrives(); }, true);
window.addEventListener('resize', () => { if (_haOpen) haCloseDrives(); });

async function saveHA() {
  if (!_haSelected) return;
  await window.electron.setHAConfig(_haSelected);
  // app will relaunch automatically
}

async function disableHA() {
  closeModal('modal-ha');
  await window.electron.clearHAConfig();
  // app will relaunch automatically
}

// ── AUTO UPDATE ──
let _updateDownloadUrl = null;
let _updateNotes = null;
let _updateVersion = null;
let _updatePublishedAt = null;

function buildUpdateNotesHtml(version, publishedAt, notes) {
  const dateStr = publishedAt ? new Date(publishedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div style="border-top:1px solid var(--border);margin:14px 0 12px"></div>` +
    `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">v${esc(version)}${dateStr ? ' · ' + dateStr : ''}</div>` +
    `<div style="font-size:13px;color:var(--text2);line-height:1.6;white-space:pre-wrap">${esc(notes)}</div>`;
}

function setUpdateBadge(visible) {
  const badge = document.getElementById('update-badge');
  if (badge) badge.style.display = visible ? '' : 'none';
}

function skipUpdate() {
  if (_updateDownloadUrl) {
    const ver = document.getElementById('update-new-version').textContent.replace(/^v/, '');
    localStorage.setItem('skippedVersion', ver);
    setUpdateBadge(false);
  }
  closeModal('modal-update');
}

// Проверка обновления без учёта «пропущенной» версии — используется при force_update от сервера
async function checkUpdateForced() {
  if (!window.electron?.checkUpdate) return;
  const result = await window.electron.checkUpdate();
  if (result.error || result.upToDate) return;
  _updateDownloadUrl = result.downloadUrl || null;
}

async function checkUpdate(silent = false) {
  if (!window.electron?.checkUpdate) return;
  const btn = document.getElementById('update-check-btn');
  const status = document.getElementById('update-status-text');
  if (!silent) {
    btn.disabled = true;
    btn.textContent = 'Проверяю…';
    status.textContent = 'Проверяю…';
  }

  const result = await window.electron.checkUpdate();

  if (!silent) {
    btn.disabled = false;
    btn.textContent = 'Проверить';
  }

  if (result.error) { if (!silent) status.textContent = 'Ошибка проверки'; return; }
  if (result.upToDate) { if (!silent) status.textContent = 'Версия актуальна'; setUpdateBadge(false); return; }

  const skipped = localStorage.getItem('skippedVersion');
  if (silent && skipped === result.version) return;

  _updateDownloadUrl = result.downloadUrl;
  _updateNotes = result.notes || null;
  _updateVersion = result.version || null;
  _updatePublishedAt = result.publishedAt || null;
  setUpdateBadge(true);
  if (!silent) status.textContent = `Доступна v${result.version}`;
  const settingsNotes = document.getElementById('settings-update-notes');
  if (settingsNotes && _updateNotes) { settingsNotes.innerHTML = buildUpdateNotesHtml(_updateVersion, _updatePublishedAt, _updateNotes); settingsNotes.style.display = ''; }

  try {
    document.getElementById('update-new-version').textContent = `v${result.version}`;
    document.getElementById('update-notes').textContent = result.notes || 'Нет описания';
    document.getElementById('update-progress-wrap').style.display = 'none';
    document.getElementById('update-install-btn').disabled = false;
    document.getElementById('update-install-btn').style.opacity = '';
  } catch {}

  window.electron?.onUpdateProgress?.(p => {
    document.getElementById('update-progress-wrap').style.display = '';
    document.getElementById('update-progress-fill').style.width = p + '%';
    document.getElementById('update-progress-text').textContent = `Загрузка ${p}%`;
  });

  if (!silent) {
    closeSettings();
    const modal = document.getElementById('modal-update');
    if (modal && !modal.classList.contains('open')) openModal('modal-update');
  }
}

// Автопроверка обновлений раз в минуту
setTimeout(() => {
  checkUpdate(true);
  setInterval(() => checkUpdate(true), 2 * 60 * 60 * 1000);
}, 10 * 1000);

async function installUpdate() {
  if (!_updateDownloadUrl) return;
  const btn = document.getElementById('update-install-btn');
  const cancel = document.getElementById('update-cancel-btn');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  cancel.textContent = 'Закрыть';
  document.getElementById('update-progress-wrap').style.display = '';
  document.getElementById('update-progress-text').textContent = 'Загрузка…';
  const result = await window.electron.installUpdate(_updateDownloadUrl);
  if (result?.error) {
    document.getElementById('update-progress-text').textContent = 'Ошибка: ' + result.error;
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

function _wsSendUpdateProgress(pct, status, error) {
  try {
    if (S.ws?.readyState === 1) S.ws.send(JSON.stringify({ type: 'update_progress', pct, status, error: error || null }));
  } catch {}
}

async function forceInstallUpdate() {
  if (!_updateDownloadUrl) return;
  closeModal('modal-update');
  // Сбрасываем прогресс-бар при повторном запуске
  const fill = document.getElementById('force-update-fill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth; fill.style.transition = ''; }
  document.getElementById('force-update-pct').textContent = '0%';
  document.getElementById('force-update-sub').textContent = 'Загрузка обновления…';
  openModal('modal-force-update');

  _wsSendUpdateProgress(0, 'downloading');

  window.electron.onUpdateProgress(p => {
    document.getElementById('force-update-fill').style.width = p + '%';
    document.getElementById('force-update-pct').textContent = p + '%';
    if (p >= 100) {
      document.getElementById('force-update-sub').textContent = 'Установка…';
      _wsSendUpdateProgress(100, 'installing');
    } else {
      _wsSendUpdateProgress(p, 'downloading');
    }
  });

  window.electron.onUpdateRestarting(() => {
    document.getElementById('force-update-sub').textContent = 'Перезапуск…';
    _wsSendUpdateProgress(100, 'restarting');
  });

  const result = await window.electron.installUpdate(_updateDownloadUrl);
  if (result?.error) {
    document.getElementById('force-update-sub').textContent = 'Ошибка: ' + result.error;
    _wsSendUpdateProgress(0, 'error', result.error);
  }
}
