/* ── STATE ── */
let token = null, currentUser = null, currentPage = 'dashboard';
let membersForChatId = null, membersForChatType = null;
let allUsers = [], allRooms = [], allChats = [], allUsersCache = [];
let createRoomSelectedIds = new Set(), selectedAddMembers = new Set();
let chatFilter = '';

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

/* ── THEME ── */
const THEME_KEY = 'electron-admin.theme';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const icon = document.getElementById('theme-icon');
  if (icon) {
    if (t === 'dark') {
      icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
    } else {
      icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
    }
  }
}
// Плавная смена темы, как в клиенте: переход цветов включаем только на время переключения,
// иначе постоянный transition на всех элементах бил бы по отзывчивости
let _themeAnimTimer = null;
function animateThemeSwitch() {
  const html = document.documentElement;
  html.classList.add('theme-anim');
  clearTimeout(_themeAnimTimer);
  _themeAnimTimer = setTimeout(() => html.classList.remove('theme-anim'), 260);
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, t);
  animateThemeSwitch();
  applyTheme(t);
}

applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

/* ── API ── */
let _sessionExpired = false;
const api = async (method, path, body) => {
  const url = method === 'GET' ? `${path}${path.includes('?')?'&':'?'}_t=${Date.now()}` : path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {'Content-Type':'application/json','Cache-Control':'no-cache', ...(token?{Authorization:'Bearer '+token}:{})},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    // Сеть недоступна — не роняем страницу необработанным исключением
    if (token) toast('Нет связи с сервером', 'error');
    throw e;
  }
  // Токен истёк/невалиден — возвращаем на экран логина (один раз)
  if (res.status === 401 && token) {
    if (!_sessionExpired) {
      _sessionExpired = true;
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      token = null;
      toast('Сессия истекла, войдите снова', 'error');
      setTimeout(() => location.reload(), 800);
    }
    return new Promise(() => {}); // останавливаем дальнейшую обработку — идёт перезагрузка
  }
  return res.json();
};

/* ── HELPERS ── */
// Цвета аватарок — из палитры макета главной
const AVcolors = ['#d8456c','#2b8be8','#6a5be0','#e0a02b','#2fa36b','#0f9e8e','#c2478a','#e0562b'];
function avColor(name) { let h=0; for(let c of (name||'')) h=(h*31+c.charCodeAt(0))&0xffff; return AVcolors[h%AVcolors.length]; }
function initials(name) { return (name||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Безопасная вставка строки в JS-аргумент внутри inline onclick (двойной слой: HTML-атрибут + JS-строка).
// HTML-сущности здесь не годятся — парсер их декодирует до того, как строку увидит JS.
function jesc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function fmtDate(ts) { return ts ? new Date(ts*1000).toLocaleDateString('ru',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'; }

function fmtUptime(sec) {
  if (!sec && sec !== 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

function fmtBytes(b) {
  if (b < 1024) return b + ' Б';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' КБ';
  return (b / 1024 / 1024).toFixed(1) + ' МБ';
}

function fmtOS(platform, release, installScope) {
  if (!platform || platform === '—') return `<span style="color:var(--c-muted)">—</span>`;
  const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const icons = {
    win32: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="color:#0078d4;flex-shrink:0"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>`,
    darwin: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="color:var(--c-text2);flex-shrink:0"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
    linux: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="color:var(--c-text2);flex-shrink:0"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.831-.401 1.681-.401 2.463 0 .225.011.443.033.652a4.966 4.966 0 0 0-.336.643c-.238.532-.487.88-.865 1.148-.375.291-.94.482-1.7.654-.482.122-.774.476-.88.892-.107.402.076.812.375 1.082.302.278.734.481 1.216.729.481.246 1.011.622 1.532 1.031.526.415 1.038.848 1.717 1.023.226.048.457.076.702.076.478 0 1.031-.129 1.633-.427.353-.171.679-.269 1.024-.279a4.098 4.098 0 0 0 .946-.135c.354-.107.716-.298 1.11-.615.394.317.756.508 1.11.615.301.09.62.132.945.135.345.01.671.108 1.024.279.602.298 1.155.427 1.633.427.245 0 .476-.028.702-.076.679-.175 1.191-.608 1.717-1.023.521-.409 1.05-.785 1.532-1.031.482-.248.914-.451 1.216-.729.299-.27.482-.68.375-1.082-.106-.416-.398-.77-.88-.892-.76-.172-1.325-.363-1.7-.654-.378-.268-.627-.616-.865-1.148a5.033 5.033 0 0 0-.336-.643 5.63 5.63 0 0 0 .033-.652c0-.782-.123-1.632-.4-2.463-.59-1.771-1.832-3.47-2.717-4.521-.75-1.067-.974-1.928-1.05-3.02-.065-1.491 1.056-5.965-3.17-6.298A6.319 6.319 0 0 0 12.504 0zm.216 5.184c.397 0 .719.322.719.719a.719.719 0 0 1-1.438 0c0-.397.322-.719.719-.719zm-1.416.135c.397 0 .719.322.719.719a.719.719 0 0 1-1.438 0c0-.397.322-.719.719-.719z"/></svg>`
  };
  const name = names[platform] || platform;
  const icon = icons[platform] || '';
  const ver = release && release !== '—' ? `<span style="color:var(--c-muted);font-size:10px;font-family:var(--f-mono);margin-left:4px">${esc(release)}</span>` : '';
  return `<div style="display:flex;align-items:center;gap:5px">${icon}<span style="font-size:12px">${name}</span>${ver}</div>`;
}

function avHtml(name, size=32, radius=8, userId=null, connected=false, _hasAvatar=false, chatId=null) {
  const bg = avColor(name);
  const fs = Math.round(size * 0.38);
  const dotSz = Math.round(size * 0.28);
  // connected: true — в сети (зелёная), 'away' — отошёл (оранжевая), false — без точки
  const dotHtml = connected
    ? `<div class="status-dot ${connected === 'away' ? 'away' : 'connected'}" style="width:${dotSz}px;height:${dotSz}px"></div>` : '';
  const src = userId ? `/api/users/${userId}/avatar` : (chatId ? `/api/chats/${chatId}/avatar` : null);
  if (src) {
    // Инициалы видны сразу (не мерцают), картинка накрывает их когда догрузится.
    // При ошибке — прячем img, инициалы остаются на месте.
    const inits = `<span>${initials(name)}</span>`;
    const img   = `<img src="${src}" loading="eager"
      style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:${radius}px;background:${bg}"
      data-on-error="__h13">`;
    return `<div class="av-wrap"><div class="av" style="width:${size}px;height:${size}px;border-radius:${radius}px;font-size:${fs}px;background:${bg}">${inits}${img}</div>${dotHtml}</div>`;
  }
  return `<div class="av-wrap"><div class="av" style="width:${size}px;height:${size}px;border-radius:${radius}px;font-size:${fs}px;background:${bg}">${initials(name)}</div>${dotHtml}</div>`;
}

function toast(msg, type='') {
  const el = document.createElement('div');
  el.className = 'toast'+(type?' '+type:'');
  const icon = type==='success'?'✓':type==='error'?'✕':'ℹ';
  el.innerHTML = `<span style="font-size:13px">${icon}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300); // fallback
  }, 3000);
}

/* ── AUTH ── */
document.getElementById('l-pass').addEventListener('keydown', e => e.key==='Enter' && doLogin());

function enterApp(user) {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  sbInit(user);
  startBgClientsPolling();
  startBgDashPolling();
  startBgListsPolling();
  // Бейджи сайдбара (пользователи/комнаты/чаты) обновляем сразу, независимо от того
  // на какой вкладке восстановились — раньше их считал только renderDashboard.
  updateNavBadges();
  let savedPage = 'dashboard';
  try { const p = localStorage.getItem('admin-page'); if (p && pageRenders[p]) savedPage = p; } catch {}
  nav(savedPage);
  // Оба пути входа (логин и восстановленная сессия) приносят актуальный флаг
  maybeForcePasswordChange();
}

function startBgClientsPolling() {
  if (window._bgClientsInterval) clearInterval(window._bgClientsInterval);
  window._bgClientsInterval = setInterval(() => { if (token) loadClients(); }, 5000);
}

// Фоновый опрос раз в 10 секунд: на главной обновляем сводку (чат, служба, хранилище).
// Графики живут своим опросом раз в 2 секунды — см. hmStartMonitor.
async function refreshDashboardData() {
  if (!token || currentPage !== 'dashboard') return;
  try { await hmLoadOverview(); } catch {}
}

// Статусы, сообщения и состав меняются без действий админа: пока открыт раздел «Пользователи»
// или «Чаты и группы», его список обновляем раз в 5 секунд. Пока открыто окно — не трогаем
function startBgListsPolling() {
  if (window._bgListsInterval) clearInterval(window._bgListsInterval);
  window._bgListsInterval = setInterval(() => {
    if (!token || document.querySelector('.modal-bg.open')) return;
    if (currentPage === 'users') renderUsers().catch(() => {});
    else if (currentPage === 'chats') renderChats().catch(() => {});
    else if (currentPage === 'rooms') renderRooms().catch(() => {});
  }, 5000);
}

function startBgDashPolling() {
  if (window._bgDashInterval) clearInterval(window._bgDashInterval);
  window._bgDashInterval = setInterval(() => {
    refreshDashboardData();
    // Бейджи сайдбара — обновляем независимо от активной страницы
    if (token) updateNavBadges();
  }, 10000);
}

let _rememberMe = localStorage.getItem('admin_remember') === '1';

function finishLogin(data, username) {
  if (!data.user.is_admin) { document.getElementById('l-err').textContent = 'Нет прав администратора'; return; }
  token = data.token; currentUser = data.user;
  localStorage.setItem('admin_last_user', username);
  if (_rememberMe) {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(currentUser));
  }
  enterApp(currentUser);
}

async function doLogin() {
  document.getElementById('l-err').textContent = '';
  const username = document.getElementById('l-user').value;
  // context:'admin' — только по этому признаку сервер вообще проверяет 2FA;
  // обычный вход в чат-клиент (без него) её не требует, даже для того же аккаунта
  const data = await api('POST','/api/auth/login',{ username, password: document.getElementById('l-pass').value, context: 'admin' });
  if (data.token) {
    finishLogin(data, username);
  } else if (data.needs_totp_setup || data.needs_totp) {
    showTotpScreen(data, username);
  } else {
    document.getElementById('l-err').textContent = data.error || 'Ошибка входа';
  }
}

/* ── 2FA при входе в админ-панель ── */
let _totpChallenge = null, _totpUsername = null;
function showTotpScreen(data, username) {
  _totpChallenge = data.challenge_token;
  _totpUsername = username;
  document.getElementById('login').style.display = 'none';
  document.getElementById('login-totp').style.display = '';
  document.getElementById('totp-err').textContent = '';
  document.getElementById('totp-code').value = '';
  const setupBlock = document.getElementById('totp-setup-block');
  if (data.needs_totp_setup) {
    setupBlock.style.display = '';
    document.getElementById('totp-secret').value = 'Загрузка…';
    api('POST', '/api/auth/totp/setup', { challenge_token: _totpChallenge }).then(res => {
      if (res?.secret) document.getElementById('totp-secret').value = res.secret;
    });
  } else {
    setupBlock.style.display = 'none';
  }
  setTimeout(() => document.getElementById('totp-code')?.focus(), 100);
}
function cancelTotp() {
  _totpChallenge = null; _totpUsername = null;
  document.getElementById('login-totp').style.display = 'none';
  document.getElementById('login').style.display = '';
  document.getElementById('l-pass').value = '';
}
function copyTotpSecret() {
  const el = document.getElementById('totp-secret');
  el.select();
  const btn = document.getElementById('totp-copy-btn');
  const done = () => { const old = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = old, 1500); };
  navigator.clipboard?.writeText(el.value).then(done).catch(done);
}
async function submitTotp() {
  const code = document.getElementById('totp-code').value.trim();
  const errEl = document.getElementById('totp-err');
  errEl.textContent = '';
  if (!/^\d{6}$/.test(code)) { errEl.textContent = 'Введите 6-значный код'; return; }
  const isSetup = document.getElementById('totp-setup-block').style.display !== 'none';
  const data = await api('POST', isSetup ? '/api/auth/totp/confirm' : '/api/auth/totp/verify', { challenge_token: _totpChallenge, code });
  if (data?.token) {
    document.getElementById('login-totp').style.display = 'none';
    finishLogin(data, _totpUsername);
  } else {
    errEl.textContent = data?.error || 'Ошибка проверки';
  }
}

/* ── ОБЯЗАТЕЛЬНАЯ СМЕНА ПАРОЛЯ ── */
// Показывается, пока у учётки стоит флаг must_change_password (дефолтный admin).
// Модалку нельзя закрыть: ни крестика, ни отмены, ни Escape.
function maybeForcePasswordChange() {
  if (!currentUser?.must_change_password) return;
  ['fp-old','fp-new','fp-new2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('fp-err');
  if (err) err.textContent = '';
  openModal('modal-force-pass');
  setTimeout(() => document.getElementById('fp-old')?.focus(), 150);
}

async function submitForcePassword() {
  const err = document.getElementById('fp-err');
  const oldP = document.getElementById('fp-old').value;
  const newP = document.getElementById('fp-new').value;
  const newP2 = document.getElementById('fp-new2').value;
  err.textContent = '';
  if (!oldP || !newP || !newP2) { err.textContent = 'Заполните все поля'; return; }
  if (newP !== newP2) { err.textContent = 'Новый пароль и подтверждение не совпадают'; return; }

  const btn = document.getElementById('fp-save-btn');
  btn.disabled = true; btn.textContent = 'Сохранение…';
  try {
    const r = await api('POST', '/api/users/me/password', { old_password: oldP, new_password: newP });
    if (r?.error) { err.textContent = r.error; return; }
    currentUser.must_change_password = false;
    if (localStorage.getItem('admin_user')) localStorage.setItem('admin_user', JSON.stringify(currentUser));
    closeModal('modal-force-pass');
    toast('Пароль изменён', 'success');
  } finally {
    btn.disabled = false; btn.textContent = 'Сохранить';
  }
}

function logout() {
  token=null; currentUser=null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  if (window._bgClientsInterval) clearInterval(window._bgClientsInterval);
  if (window._bgDashInterval) clearInterval(window._bgDashInterval);
  location.reload();
}

(async () => {
  // Восстановить переключатель и последний логин
  const lrCb = document.getElementById('l-remember');
  if (lrCb) lrCb.checked = _rememberMe;
  const lastUser = localStorage.getItem('admin_last_user');
  if (lastUser) document.getElementById('l-user').value = lastUser;

  const saved = localStorage.getItem('admin_token');
  if (saved) {
    token=saved;
    try {
      const me = await api('GET','/api/auth/me');
      if (me?.id && me.is_admin) { currentUser=me; enterApp(me); return; }
    } catch {}
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    token=null;
  }
})();

/* ── САЙДБАР ── */
// Свёрнутый вид (rail), блок состояния сервера над профилем, меню профиля (тема, 2FA, выход)
// и быстрый переход по Ctrl K. Данные те же, что у главной: сводка /api/admin/overview и
// проверка версии /api/admin/server/version. Состояние: идёт обновление, проблема
// (диск от 90% или служба не активна), доступна новая версия, всё в порядке.
const SB = { rail: false, menu: false, upd: null, totp: null, attn: 0, timers: [], pal: { q: '', sel: 0, items: [] } };
try { SB.rail = localStorage.getItem('admin-sb-rail') === '1'; } catch {}
document.documentElement.classList.toggle('sb-rail', SB.rail);
const sbSvg = (p, n = 15) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const SB_I = {
  collapse: sbSvg('<path d="m15 18-6-6 6-6"/>', 14), expand: sbSvg('<path d="m9 18 6-6-6-6"/>', 14),
  out: sbSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  key: sbSvg('<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>'),
  go: sbSvg('<path d="m9 18 6-6-6-6"/>'), plus: sbSvg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
};
const sbUptime = sec => { const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return d ? `${d} дн` : h ? `${h} ч` : `${Math.max(m, 1)} мин`; };

function sbInit(u) {
  document.getElementById('sb-name').textContent = u.display_name;
  document.getElementById('sb-email').textContent = u.username ? '@' + u.username : '';
  document.getElementById('sb-av').innerHTML = avHtml(u.display_name, 32, 10, u.id, false, true) + '<i></i>';
  document.getElementById('sb-me').dataset.tip = u.display_name;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform), kbd = document.querySelector('.sb-jump kbd');
  if (kbd) kbd.textContent = mac ? '⌘ K' : 'Ctrl K';
  document.querySelector('.sb-jump').dataset.tip = 'Быстрый переход · ' + (mac ? '⌘ K' : 'Ctrl K');
  sbRailBtn();
  sbRender();
  SB.timers.forEach(clearInterval);
  SB.timers = [
    setInterval(() => { if (token && currentPage !== 'dashboard') sbLoad(); }, 15000),   // на главной сводку обновляет она сама
    setInterval(() => { if (token) sbAttn(); }, 60000),
    setInterval(() => { if (token) sbCheckUpdate(); }, 30 * 60000),
  ];
  sbLoad(); sbAttn();
  setTimeout(sbCheckUpdate, 2500);
}

function sbRailBtn() {
  const b = document.getElementById('sb-col');
  if (!b) return;
  const t = SB.rail ? 'Развернуть панель' : 'Свернуть панель';
  b.innerHTML = SB.rail ? SB_I.expand : SB_I.collapse;
  b.title = t; b.setAttribute('aria-label', t);
}
function sbToggleRail() {
  SB.rail = !SB.rail;
  try { localStorage.setItem('admin-sb-rail', SB.rail ? '1' : '0'); } catch {}
  document.documentElement.classList.toggle('sb-rail', SB.rail);
  sbMenuClose(); sbTipHide(); sbRailBtn(); sbRender();
}

async function sbLoad() {
  if (!token || HM.upd.busy) return;
  const o = await hmGet('/api/admin/overview');
  if (o) HM.overview = o;
  sbRender();
}
async function sbCheckUpdate() {
  if (!token || HM.upd.busy) return;
  const v = await hmGet('/api/admin/server/version');
  if (v?.latest) { SB.upd = v; sbRender(); }
}
// Счётчик у «Настроек»: что требует внимания (токен GitHub, давние копии)
async function sbAttn() {
  const [s, b] = await Promise.all([hmGet('/api/admin/settings'), hmGet('/api/admin/backups')]);
  if (!s || s.error) return;
  const last = Array.isArray(b) && b.length ? Math.max(...b.map(x => x.created_at)) : 0;
  SB.attn = (s.github_token_set ? 0 : 1) + (!last || Date.now() / 1000 - last > 7 * 86400 ? 1 : 0);
  sbBadges();
}
function sbBadges() {
  const nb = document.getElementById('nb-settings');
  if (!nb) return;
  nb.textContent = SB.attn;
  nb.style.display = SB.attn ? '' : 'none';
}

// Что показать в блоке: идёт обновление › проблема › есть новая версия › всё хорошо
function sbSrvInfo() {
  const o = HM.overview, u = HM.upd, up = SB.upd, svc = o?.service, disk = o?.storage?.disk;
  const ver = o?.version || up?.current || '';
  const dp = disk ? Math.round((disk.total - disk.free) / disk.total * 100) : 0;
  const online = o?.online ? o.online.length : null;
  const onl = online == null ? '' : `<span class="end">${online} в сети</span>`;
  const run = o ? sbUptime(o.uptime) : '';
  if (u.busy) {
    const pct = u.pct || 0;
    return { st: 'installing', cls: '', dot: 'warn', t: `<span class="sb-spn"></span>Обновляется до ${esc(u.target || '')}…`, r: pct + '%', l2: `<div class="sb-bar2"><i style="width:${pct}%"></i></div>`, tip: `Идёт обновление до ${u.target || ''}: ${pct}%` };
  }
  const bad = svc && svc.state && svc.state !== 'active' ? `Служба: ${esc(svc.state)}` : dp >= 90 ? `Диск занят на ${dp}%` : '';
  if (bad) return { st: 'problem', cls: 'bad', dot: 'bad', t: 'Нужно внимание', r: '', l2: `<span class="sb-pill">${esc(ver)}</span><span class="sb-bad">${bad}</span>`, tip: 'Нужно внимание: ' + bad.replace(/&[a-z]+;/g, '') };
  const name = 'Сервер работает';
  if (up?.hasUpdate) return { st: 'available', cls: '', dot: '', t: name, r: run, l2: `<span class="sb-pill">${esc(ver)}</span><button type="button" class="sb-pill up" data-on-click="sbUpdClick" data-a-click='["__event"]' title="Показать обновление на главной">↑ ${esc(up.latest)}</button>${onl}`, tip: `Сервер работает${run ? ' ' + run : ''} · ${ver} · доступна ${up.latest}${online != null ? ` · ${online} в сети` : ''}`, ar: true };
  const fresh = up && up.hasUpdate === false;
  return { st: 'latest', cls: '', dot: '', t: name, r: run, l2: `<span class="sb-pill ${fresh ? 'ok' : ''}" ${fresh ? 'title="Установлена последняя версия"' : ''}>${esc(ver)}${fresh ? ' ✓' : ''}</span>${onl}`, tip: `Сервер работает${run ? ' ' + run : ''} · ${ver}${fresh ? ' (последняя)' : ''}${online != null ? ` · ${online} в сети` : ''}` };
}
function sbRender() {
  const w = document.getElementById('sb-srv-wrap');
  if (!w) return;
  const i = sbSrvInfo(), act = i.st === 'available' ? ['sbUpdClick', ['__event']] : ['sbGoHome', []];
  const html = `<div class="sb-srv ${i.cls}" data-on-click="sbGoHome"><div class="sb-l1">${i.st === 'installing' ? '' : `<i class="sb-sd ${i.dot}"></i>`}${i.t}<span class="r">${i.r}</span></div><div class="sb-l2">${i.l2}</div></div>`
    + `<button type="button" class="sb-srvb" data-on-click="${act[0]}" data-a-click="${esc(JSON.stringify(act[1]))}" data-tip="${esc(i.tip)}" aria-label="${esc(i.tip)}">${i.st === 'installing' ? '<span class="sb-spn"></span>' : `<i class="sb-sd ${i.dot}"></i>`}${i.ar ? '<span class="ar">↑</span>' : ''}</button>`;
  if (w._h !== html) { w._h = html; w.innerHTML = html; }
  sbBadges();
}
function sbGoHome() { if (currentPage !== 'dashboard') nav('dashboard'); }
// «↑ версия»: открываем главную сразу с предложением обновиться (там шаги и установка)
function sbUpdClick(e) {
  e?.stopPropagation();
  if (!SB.upd?.hasUpdate || HM.upd.busy) return sbGoHome();
  HM.upd.check = SB.upd;
  HM.upd.checkedAt = HM.upd.checkedAt || Date.now();
  if (currentPage === 'dashboard') hmUpdIdle(); else nav('dashboard');
}

/* меню профиля */
function sbMenuToggle(e) { e?.stopPropagation(); SB.menu ? sbMenuClose() : sbMenuOpen(); }
function sbMenuOpen() {
  SB.menu = true; sbTipHide();
  document.getElementById('sb-me').setAttribute('aria-expanded', 'true');
  const m = document.getElementById('sb-menu');
  popShow(m); m.hidden = false;
  sbMenuRender(); sbMenuPos();
  hmGet('/api/admin/users').then(us => {
    const me = Array.isArray(us) && us.find(x => x.id === currentUser?.id);
    if (me) { SB.totp = me; if (SB.menu) sbMenuRender(); }
  });
}
function sbMenuClose() {
  if (!SB.menu) return;
  SB.menu = false;
  const m = document.getElementById('sb-menu');
  popHide(m, () => { m.hidden = true; });
  document.getElementById('sb-me').setAttribute('aria-expanded', 'false');
}
function sbMenuPos() {
  const m = document.getElementById('sb-menu'), r = document.querySelector('.sb-bottom').getBoundingClientRect();
  m.style.width = '244px';
  if (SB.rail) { m.style.left = (r.right + 6) + 'px'; m.style.bottom = (innerHeight - r.bottom + 8) + 'px'; }
  else { m.style.left = (r.left + 10) + 'px'; m.style.bottom = (innerHeight - r.top - 6) + 'px'; }
}
function sbMenuRender() {
  const u = currentUser || {}, dark = document.documentElement.dataset.theme !== 'light', t = SB.totp;
  const st = !t ? '' : t.totp_required ? (t.totp_configured ? 'вкл' : 'ждёт настройки') : 'выкл';
  document.getElementById('sb-menu').innerHTML = `<div class="sb-who"><span class="sb-av">${avHtml(u.display_name || '?', 32, 10, u.id, false, true)}<i></i></span><div><b>${esc(u.display_name || '')}</b><small>${u.username ? '@' + esc(u.username) + ' · ' : ''}в сети</small></div></div>
    <div class="sb-th" role="group" aria-label="Тема"><button type="button" data-on-click="sbTheme" data-a-click='["dark"]' aria-pressed="${dark}">Тёмная</button><button type="button" data-on-click="sbTheme" data-a-click='["light"]' aria-pressed="${!dark}">Светлая</button></div>
    <button type="button" class="sb-mi" role="menuitem" data-on-click="sb2fa">${SB_I.key}Двухфакторная защита<small>${st}</small></button>
    <button type="button" class="sb-mi bad" role="menuitem" data-on-click="logout">${SB_I.out}Выйти</button>`;
}
function sbTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  animateThemeSwitch();
  applyTheme(t);
  sbMenuRender();
}
// 2FA настраивается в окне пользователя (переключатель «требовать») — открываем своё
async function sb2fa() {
  sbMenuClose();
  const us = await api('GET', '/api/admin/users');
  if (Array.isArray(us)) allUsers = us;
  if (currentUser?.id) openEditUser(currentUser.id);
}

/* подсказки свёрнутой панели: fixed, иначе их обрежет сайдбар */
function sbTipHide() { document.getElementById('sb-tip')?.remove(); }
function sbTipShow(el, text) {
  if (!text) return sbTipHide();
  let t = document.getElementById('sb-tip');
  if (!t) { t = document.createElement('div'); t.id = 'sb-tip'; t.className = 'sb-tip'; document.body.appendChild(t); }
  t.textContent = text;
  const r = el.getBoundingClientRect();
  t.style.left = (r.right + 8) + 'px'; t.style.top = (r.top + r.height / 2) + 'px';
}
document.addEventListener('mouseover', e => {
  if (!SB.rail || SB.menu) return sbTipHide();
  const el = e.target.closest?.('.sidebar .nav-item, .sidebar [data-tip]');
  if (!el) return sbTipHide();
  let text = el.dataset.tip || '';
  if (el.classList.contains('nav-item')) {
    const b = el.querySelector('.nav-badge'), n = b && b.style.display !== 'none' ? b.textContent.trim() : '';
    text = el.querySelector('.lb').textContent + (n && n !== '—' ? ' · ' + n : '');
  }
  sbTipShow(el, text);
});
document.addEventListener('mouseout', e => { if (!e.relatedTarget?.closest?.('.sidebar')) sbTipHide(); });
document.addEventListener('click', e => { if (SB.menu && !e.target.closest('#sb-menu, #sb-me')) sbMenuClose(); });

/* быстрый переход */
const SB_SETS = [['messages', 'Сообщения', 'редактирование удаление лимит время правки'], ['attachments', 'Вложения', 'файлы фото видео размер расширения форматы загрузка'], ['backups', 'Резервные копии', 'бэкап копия восстановление расписание'],
  ['database', 'База данных', 'postgres postgresql sqlite бд перенос миграция установка размер'], ['github', 'GitHub', 'токен релизы обновления лимит'], ['history', 'История', 'журнал изменений настроек']];
// Слова, по которым страницу можно найти кроме названия (поиск по приставке слова, см. sbPalGroups)
const SB_KW = { dashboard: 'главная нагрузка процессор память сервер графики', workspaces: 'общее пространство рабочие', federation: 'сервер партнёр ключ подключение карта связь', users: 'люди сотрудники пароль тег блокировка',
  rooms: 'темы подкомнаты комната гостевая ссылка гость', chats: 'группы личные переписка гостевая ссылка гость', clients: 'версии приложение устройства', push: 'уведомления подписки', files: 'вложения хранилище диск', announcements: 'баннер оповещение',
  webhooks: 'бот интеграция', modules: 'gif klipy гиф модуль', settings: 'параметры конфигурация', audit: 'журнал действий безопасность', releases: 'версии обновление история изменений' };
async function sbCheckFromPal() {
  sbGoHome();
  for (let i = 0; i < 50 && !document.getElementById('hm-upd-panel'); i++) await new Promise(r => setTimeout(r, 100));
  hmUpdCheck();
}
// Закладка страницы «Федерации»: подключения или карта
function sbFed(tab) { FD.tab = tab; if (currentPage === 'federation') fdTab(tab); else nav('federation'); }
function sbPalGroups() {
  // Каждое слово запроса ищется по приставке (без последней буквы, чтобы падеж не мешал), слова могут идти в любом порядке
  const q = SB.pal.q.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean).map(w => w.slice(0, Math.max(3, w.length - 1)));
  const to = k => () => nav(k), act = (k, fn) => () => { nav(k); fn(); };
  const pg = !!(typeof HM !== 'undefined' && HM.pgService);   // служба postgresql есть только на PostgreSQL
  return [
    ['Страницы', Object.keys(pageTitles).filter(k => k !== 'more').map(k => ({ t: pageTitles[k], k: SB_KW[k], go: to(k) }))
      .concat([{ t: 'Федерации → Карта', k: 'карта серверов пространств связи схема', go: () => sbFed('map') }, { t: 'Федерации → Подключения', k: 'серверы правила приёма лимиты ключ', go: () => sbFed('list') }])],
    ['Разделы настроек', SB_SETS.map(([k, n, kw]) => ({ t: 'Настройки → ' + n, k: kw, go: () => openSettingsModal(k) }))],
    ['Действия', [
      { t: 'Создать пользователя', h: 'Пользователи', go: act('users', openCreateUser) },
      { t: 'Создать комнату', h: 'Комнаты', go: act('rooms', openCreateRoom) },
      { t: 'Создать пространство', h: 'Пространства', go: act('workspaces', wsOpen) },
      { t: 'Подключить сервер федерации', h: 'Федерации', k: 'ключ приглашение партнёр', go: act('federation', fdChoose) },
      { t: 'Новое объявление', h: 'Объявления', go: act('announcements', openAnnouncementModal) },
      { t: 'Создать вебхук', h: 'Вебхуки', go: act('webhooks', whOpen) },
      { t: 'Гостевая ссылка для комнаты', h: 'Комнаты → меню комнаты', k: 'гость приглашение временный доступ', go: to('rooms') },
      { t: 'Создать резервную копию', h: 'Настройки', go: () => openSettingsModal('backups') },
      { t: 'Перенести базу на PostgreSQL', h: 'Настройки → База данных', k: 'миграция sqlite postgres', go: () => openSettingsModal('database') },
      { t: 'Установить PostgreSQL на этом сервере', h: 'Настройки → База данных', k: 'установка postgres', go: () => openSettingsModal('database') },
      { t: 'Проверить обновления', h: 'Главная', go: sbCheckFromPal },
      { t: 'Перезапустить сервер', h: 'Главная', k: 'рестарт electron служба', go: () => { sbGoHome(); setTimeout(() => restartService(), 150); } },
    ].concat(pg ? [{ t: 'Перезапустить PostgreSQL', h: 'Главная', k: 'рестарт база служба', go: () => { sbGoHome(); setTimeout(() => restartPostgres(), 150); } }] : [])],
  ].map(([g, l]) => [g, l.filter(x => { const hay = (x.t + ' ' + (x.k || '')).toLowerCase(); return words.every(w => hay.includes(w)); })]).filter(x => x[1].length);
}
function sbPalList() {
  const groups = sbPalGroups();
  SB.pal.items = groups.flatMap(g => g[1]);
  SB.pal.sel = Math.min(SB.pal.sel, Math.max(0, SB.pal.items.length - 1));
  let i = 0;
  document.getElementById('sb-pl').innerHTML = groups.map(([g, l]) => `<div class="sb-pg">${g}</div>${l.map(x => { const n = i++; return `<button type="button" class="sb-pi" aria-selected="${n === SB.pal.sel}" data-on-mousemove="sbPalSel" data-a-mousemove="${esc(JSON.stringify([n]))}" data-on-click="sbPalPick" data-a-click="${esc(JSON.stringify([n]))}">${g === 'Действия' ? SB_I.plus : SB_I.go}${esc(x.t)}${x.h ? `<small>${esc(x.h)}</small>` : ''}</button>`; }).join('')}`).join('') || '<div class="sb-pe">Ничего не нашли</div>';
}
function sbPalOpen() {
  if (document.getElementById('sb-pal')) return;
  sbMenuClose(); sbTipHide();
  SB.pal = { q: '', sel: 0, items: [] };
  const d = document.createElement('div');
  d.id = 'sb-pal'; d.className = 'sb-pal-bg';
  d.innerHTML = `<div class="sb-pal" role="dialog" aria-label="Быстрый переход"><input id="sb-pq" placeholder="Куда перейти или что сделать?" autocomplete="off" spellcheck="false"><div class="sb-pl" id="sb-pl"></div></div>`;
  d.addEventListener('mousedown', e => { if (e.target === d) sbPalClose(); });
  document.body.appendChild(d);
  const inp = document.getElementById('sb-pq');
  inp.addEventListener('input', () => { SB.pal.q = inp.value; SB.pal.sel = 0; sbPalList(); });
  inp.addEventListener('keydown', e => {
    const n = SB.pal.items.length;
    if (e.key === 'Escape') { e.preventDefault(); sbPalClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sbPalSel(Math.min(n - 1, SB.pal.sel + 1), true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sbPalSel(Math.max(0, SB.pal.sel - 1), true); }
    else if (e.key === 'Enter') { e.preventDefault(); sbPalPick(SB.pal.sel); }
  });
  sbPalList();
  inp.focus();
}
function sbPalSel(n, scroll) {
  SB.pal.sel = n;
  document.querySelectorAll('#sb-pl .sb-pi').forEach((b, i) => { b.setAttribute('aria-selected', String(i === n)); if (scroll && i === n) b.scrollIntoView({ block: 'nearest' }); });
}
function sbPalClose() {
  const d = document.getElementById('sb-pal');
  if (!d) return;
  // id снимаем сразу: за 120 мс анимации палитру могут открыть заново
  d.removeAttribute('id'); d.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  d.classList.add('out');
  setTimeout(() => d.remove(), 130);
}
function sbPalPick(n) { const it = SB.pal.items[n]; sbPalClose(); if (it) it.go(); }
document.addEventListener('keydown', e => {
  if (document.getElementById('app')?.style.display !== 'block') return;
  if (e.code === 'KeyK' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); sbPalOpen(); return; }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable && !document.querySelector('.modal-bg.open')) { e.preventDefault(); sbPalOpen(); return; }
  if (e.key === 'Escape' && SB.menu) sbMenuClose();
});
window.addEventListener('resize', () => { if (SB.menu) sbMenuPos(); });

/* ── СВОДНЫЕ БЛОКИ В ТЕЛЕФОННОМ ВИДЕ ── */
// Четыре плитки сверху разделов на телефоне собираются в один сворачиваемый блок: в свёрнутом виде одна-две строки
// с главными числами, в раскрытом все плитки сеткой (без горизонтальной прокрутки). Плитка «Обновление» на «Клиентах»
// выносится из блока и стоит над ним отдельным заметным блоком. Страницы по-прежнему рисуют плитки как раньше:
// блок собирается поверх них, а при перерисовке плиток (клиенты обновляются на лету) пересобирается сам.
const CX = { open: {}, mq: matchMedia('(max-width: 820px)'), pend: false };
const CX_LBL = { 'Всего': 'всего', 'В сети': 'в сети', 'Сейчас в сети': 'в сети', 'Отошли': 'отошли', 'Администраторы': ['админ', 'админа', 'админов'],
  'Комнат': ['комната', 'комнаты', 'комнат'], 'Тем': ['тема', 'темы', 'тем'], 'Сообщений за неделю': 'за неделю', 'Личных чатов': 'личных',
  'Групп': ['группа', 'группы', 'групп'], 'Подписок': ['подписка', 'подписки', 'подписок'], 'Уведомления включены': 'включены', 'Не включили': 'не включили',
  'Вебхуков': ['вебхук', 'вебхука', 'вебхуков'], 'Молчат': 'молчат', 'Событий за сутки': 'за сутки', 'Безопасность': 'безопасность',
  'Подключено': 'подключено', 'Версии Electron': 'последняя' };
const CX_NUM = /^[\d\s .,]+(\s?(Б|КБ|МБ|ГБ|ТБ|%))?$|^\d+(\.\d+){1,3}$/;
function cxPills(t) {
  const out = [];
  for (const tile of t.children) {
    // плитки с кнопками действий и «Обновление» в сводку не идут: они только в раскрытом виде
    if (tile.classList.contains('ub-upd') || tile.querySelector('button')) continue;
    const big = tile.querySelector('.ub-big'); if (!big) continue;
    const first = big.firstChild, val = (first && first.nodeType === 3 ? first.textContent : big.textContent).trim();
    if (!CX_NUM.test(val)) continue;
    const lbl = (tile.querySelector('.ub-lbl')?.textContent || '').trim(), n = parseInt(val.replace(/\D/g, ''), 10) || 0;
    if (lbl === 'Платформы') continue;   // там число — самой частой платформы, в одну строку оно не складывается
    const m = CX_LBL[lbl], word = Array.isArray(m) ? uxPlural(n, ...m) : (m || lbl.toLowerCase());
    const tone = /^(В сети|Сейчас в сети|Уведомления включены)$/.test(lbl) ? 'ok' : /^(Отошли|Не включили|Молчат)$/.test(lbl) ? (n ? 'warn' : '') : lbl === 'Безопасность' ? (n ? 'bad' : '') : '';
    out.push(`<span class="p ${tone}"><b>${esc(val)}</b><span>${esc(word)}</span></span>`);
    if (out.length === 4) break;
  }
  return out.join('');
}
function cxSync(t) {
  const cx = t.closest('.cx'); if (!cx) return;
  // «Обновление» — отдельным блоком над сводкой; прежний (если был) заменяется
  const u = t.querySelector(':scope > .ub-upd');
  if (u) { const old = cx.previousElementSibling; if (old && old.classList.contains('ub-upd')) old.remove(); cx.before(u); }
  const h = cx.querySelector('.cx-h');
  h.innerHTML = (cxPills(t) || '<span class="p"><span>Сводка</span></span>') + '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
}
function cxWrap(t) {
  t.dataset.cx = '1';
  const cx = document.createElement('div');
  cx.className = 'cx'; cx.dataset.key = currentPage; cx.dataset.open = CX.open[currentPage] ? 'true' : 'false';
  cx.innerHTML = '<button type="button" class="cx-h" aria-expanded="' + !!CX.open[currentPage] + '" title="Показать подробности"></button><div class="cx-b"></div>';
  t.before(cx); cx.querySelector('.cx-b').appendChild(t);
  cx.querySelector('.cx-h').onclick = e => {
    const o = cx.dataset.open !== 'true';
    cx.dataset.open = String(o); CX.open[cx.dataset.key] = o; e.currentTarget.setAttribute('aria-expanded', String(o));
  };
  cxSync(t);
  let tm = 0;
  new MutationObserver(() => { clearTimeout(tm); tm = setTimeout(() => cxSync(t), 0); }).observe(t, { childList: true, subtree: true, characterData: true });
}
function cxScan() {
  CX.pend = false;
  if (!CX.mq.matches) return;
  document.querySelectorAll('#page-body .ub-tiles:not([data-cx]):not(.sp-tiles)').forEach(cxWrap);
}
new MutationObserver(() => { if (!CX.pend) { CX.pend = true; setTimeout(cxScan, 0); } }).observe(document.getElementById('page-body'), { childList: true, subtree: true });
// Поворот телефона или изменение ширины окна: страница перерисовывается заново в нужном виде
CX.mq.addEventListener('change', () => { if (typeof currentPage === 'string' && document.querySelector('#page-body .ub-tiles, #page-body .ub-sort, #page-body .ux-chips')) nav(currentPage); });

/* ── ФИЛЬТРЫ ОДНИМ БЛОКОМ (телефонный вид) ── */
// Ряды кнопок-фильтров на телефоне не помещались и переносили подписи. Теперь на странице один блок «Фильтры»:
// в нём виден текущий выбор (по умолчанию первый фильтр, например «Все»), по нажатию открывается панель со всеми
// группами (пространство, фильтр, сортировка), у каждой свой список. Настоящие кнопки остаются на странице
// скрытыми: выбор в панели нажимает нужную из них, поэтому обработчики и перерисовка страниц прежние.
const FS = { pend: false, el: null, host: null, page: null };
function fsClose() {
  if (FS.el) { const el = FS.el; FS.el = null; popHide(el, () => el.remove()); }
  if (FS.host) { FS.host.setAttribute('aria-expanded', 'false'); FS.host = null; }
}
const fsCur = btns => btns.findIndex(b => b.getAttribute('aria-pressed') === 'true');
// Панель стоит под кнопкой «Фильтры» (или над ней, если снизу мало места) и следует за ней при прокрутке страницы
function fsPlace() {
  if (!FS.el) return;
  if (!FS.host || !FS.host.isConnected) { fsClose(); return; }
  const r = FS.host.getBoundingClientRect(), h = FS.el.offsetHeight, below = innerHeight - r.bottom - 8;
  FS.el.style.left = r.left + 'px'; FS.el.style.width = r.width + 'px';
  FS.el.style.top = (below >= Math.min(h, 240) ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
}
function fsShow(btn, groups, top) {
  fsClose();
  const pop = document.createElement('div');
  pop.className = 'fsm-p'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Фильтры');
  pop.innerHTML = groups.map((g, gi) => {
    const cur = fsCur(g.btns);
    return `<div class="fsm-g">${esc(g.label)}</div>` + g.btns.map((b, i) => `<button type="button" aria-pressed="${i === cur}" class="fsm-o${i === cur ? ' on' : ''}" data-g="${gi}" data-i="${i}">${b.innerHTML}</button>`).join('');
  }).join('');
  pop.onclick = e => { const o = e.target.closest('.fsm-o'); if (!o) return; const b = groups[Number(o.dataset.g)].btns[Number(o.dataset.i)]; fsClose(); b.click(); };
  document.body.appendChild(pop);
  btn.setAttribute('aria-expanded', 'true');
  FS.el = pop; FS.host = btn; FS.page = currentPage;
  fsPlace();
  if (top) pop.scrollTop = top;
}
function fsScan() {
  FS.pend = false;
  if (!CX.mq.matches) { fsClose(); return; }
  const pb = document.getElementById('page-body');
  const all = [...pb.querySelectorAll('.ub-sort, .ux-chips')];
  if (!all.length) { fsClose(); return; }
  if (all.every(g => g.dataset.fs)) return;
  // Страница перерисовалась. Если панель была открыта на этой же странице (данные обновились в фоне),
  // остаётся открытой: пересобираем её под новые кнопки на том же месте, с той же прокруткой
  const reopen = !!FS.el && FS.page === currentPage, top = FS.el ? FS.el.scrollTop : 0;
  if (!reopen) fsClose();
  pb.querySelectorAll('.fsm').forEach(e => e.remove());
  const groups = all.map(g => ({ g, label: g.getAttribute('aria-label') || 'Фильтр', btns: [...g.querySelectorAll(':scope > button')] })).filter(x => x.btns.length);
  groups.forEach(x => { x.g.dataset.fs = '1'; });
  if (!groups.length) return;
  // Что показываем в закрытом виде: первый фильтр (текущий) и всё, что отличается от выбора по умолчанию
  const parts = groups.map((x, i) => ({ i, cur: fsCur(x.btns) })).filter(x => x.i === 0 || x.cur > 0)
    .map(x => (groups[x.i].btns[Math.max(0, x.cur)]).innerHTML);
  const el = document.createElement('div');
  el.className = 'fsm';
  el.innerHTML = `<button type="button" class="fsm-b" aria-haspopup="dialog" aria-expanded="false"><span class="k">Фильтры</span><span class="v">${parts.join('<i>·</i>')}</span><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>`;
  const head = pb.querySelector('.ub-head');
  if (head) head.appendChild(el); else groups[0].g.before(el);
  const b = el.querySelector('.fsm-b');
  b.onclick = e => { e.stopPropagation(); if (FS.host === b) fsClose(); else fsShow(b, groups); };
  if (reopen) fsShow(b, groups, top);
}
document.addEventListener('click', e => { if (FS.el && !e.target.closest('.fsm-p')) fsClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fsClose(); });
// Прокрутка страницы двигает панель вместе с кнопкой, а не закрывает её; прокрутка самой панели её не трогает
addEventListener('scroll', e => { if (FS.el && !FS.el.contains(e.target)) fsPlace(); }, true);
addEventListener('resize', fsPlace);
new MutationObserver(() => { if (!FS.pend) { FS.pend = true; setTimeout(fsScan, 0); } }).observe(document.getElementById('page-body'), { childList: true, subtree: true });

/* ── NAV ── */
const pageTitles = {dashboard:'Главная',workspaces:'Пространства',federation:'Федерации',users:'Пользователи',rooms:'Комнаты',chats:'Чаты и группы',clients:'Клиенты',push:'Уведомления',files:'Файлы',announcements:'Объявления',webhooks:'Вебхуки',modules:'Модули',settings:'Настройки',audit:'Аудит-лог',releases:'Релизы',more:'Ещё'};
const pageRenders = {dashboard:renderDashboard,users:renderUsers,workspaces:renderWorkspaces,federation:renderFederation,rooms:renderRooms,chats:renderChats,files:renderFiles,clients:renderClients,push:renderPush,webhooks:renderWebhooks,announcements:renderAnnouncements,releases:renderReleases,modules:renderModules,audit:renderAudit,settings:renderSettings,more:renderMore};

// Телефонный вид без масштабирования: страница уже собрана под экран, а случайный щипок сдвигал раскладку.
// В iOS Safari атрибуты viewport игнорируются, поэтому щипок гасим отменой жестов; на компьютере эти события не приходят
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => { if (matchMedia('(max-width: 820px)').matches) e.preventDefault(); }, { passive: false }));
// Разделы, вынесенные на нижнюю панель телефонного вида; всё остальное открывается из «Ещё»
const MTABS = ['dashboard', 'users', 'clients', 'settings', 'more'];
function nav(page) {
  currentPage=page;
  document.querySelectorAll('#mnav button').forEach(b => b.classList.toggle('on', b.dataset.page === (MTABS.includes(page) ? page : 'more')));
  document.documentElement.dataset.msub = MTABS.includes(page) ? '0' : '1';
  try { localStorage.setItem('admin-page', page); } catch {}
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  document.getElementById('page-title').textContent=pageTitles[page];

  // Сбросить extra кнопки
  const extraEl = document.getElementById('topbar-extra');
  if (extraEl) { extraEl.innerHTML = ''; extraEl.style.display = 'none'; }

  // topbar-add-btn
  const addBtn = document.getElementById('topbar-add-btn');
  const addLabel = document.getElementById('topbar-add-label');
  if (addBtn) {
    const addMap = {
      users: {label:'Создать пользователя', fn: () => openCreateUser()},
      workspaces: {label:'Создать пространство', fn: () => wsOpen()},
      federation: {label:'Подключить сервер', fn: () => fdChoose()},
      rooms: {label:'Создать комнату', fn: () => openCreateRoom()},
      announcements: {label:'Создать объявление', fn: () => openAnnouncementModal()},
      webhooks: {label:'Создать вебхук', fn: () => whOpen()}
    };
    if (addMap[page]) {
      if (addLabel) addLabel.textContent = addMap[page].label;
      addBtn.onclick = addMap[page].fn;
      addBtn.classList.remove('hidden');
    } else {
      addBtn.classList.add('hidden');
    }
  }

  // Очищаем контент сразу — анимация играет на пустом контейнере, не на старой странице
  const pb = document.getElementById('page-body');
  pb.innerHTML = '';
  pb.classList.remove('page-enter');
  void pb.offsetWidth; // force reflow
  pb.classList.add('page-enter');

  pageRenders[page]();
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('closing');
  el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('closing');
  const cleanup = () => { el.classList.remove('open', 'closing'); };
  el.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 300); // fallback если animationend не сработает
}

function confirm(title, text, onOk) {
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-text').innerHTML=text.replace(/\n/g,'<br>');
  document.getElementById('confirm-ok').onclick=()=>{ closeModal('modal-confirm'); onOk(); };
  openModal('modal-confirm');
}

/* ── «ЕЩЁ» (телефонный вид) ── */
// Разделы, которых нет на нижней панели, тема и выход. Значки берём из боковой панели: там они уже нарисованы
function renderMore() {
  setTopbarActions('');
  const rows = [['federation', 'Федерации'], ['workspaces', 'Пространства'], ['rooms', 'Комнаты'], ['chats', 'Чаты и группы'], ['push', 'Уведомления'], ['files', 'Файлы'], ['announcements', 'Объявления'], ['webhooks', 'Вебхуки'], ['modules', 'Модули'], ['audit', 'Аудит-лог'], ['releases', 'Релизы']];
  const me = currentUser?.display_name || currentUser?.username || '';
  document.getElementById('page-body').innerHTML = `<div class="mm">
    <div class="mm-list">${rows.map(([k, n]) => {
      const ico = document.querySelector(`.nav-item[data-page="${k}"] svg`)?.outerHTML || '', b = document.getElementById('nb-' + k)?.textContent;
      return `<button type="button" class="mm-row" data-on-click="nav" data-a-click="${esc(JSON.stringify([`${k}`]))}"><span class="mm-ic">${ico}</span><span class="mm-t">${n}</span>${b && b !== '—' && b !== '0' ? `<span class="mm-n">${esc(b)}</span>` : ''}<svg class="mm-ch" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>`;
    }).join('')}</div>
    <div class="mm-card">
      <div class="mm-set"><span class="mm-t">Тёмная тема</span><button type="button" class="mm-tg" role="switch" aria-checked="${document.documentElement.dataset.theme === 'dark'}" data-on-click="__h14"></button></div>
      <div class="mm-set"><span class="mm-t">${esc(me)}<small>учётная запись администратора</small></span><button type="button" class="btn btn-danger btn-sm" data-on-click="logout">Выйти</button></div>
    </div></div>`;
}

/* ── UPDATE NAV BADGES ── */
async function updateNavBadges() {
  try {
    const s = await api('GET','/api/admin/stats');
    const setB = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    setB('nb-users', s.users||0);
    setB('nb-rooms', s.rooms||0);
    setB('nb-chats', (s.chats||0)+(s.groups||0));
    setB('nb-push',  s.pushSubscriptions||0);
    setB('nb-files', s.filesCount||0);
    try { const whs=await api('GET','/api/admin/webhooks'); setB('nb-webhooks',whs.length||0); } catch {}
    try { const anns=await api('GET','/api/admin/announcements'); setB('nb-announcements',anns.length||0); } catch {}
    try { const wss=await wsLoad(); setB('nb-workspaces',wss.length||0); } catch {}
    try { const fd=await api('GET','/api/admin/federation'); setB('nb-federation',(fd.peers||[]).length); } catch {}
  } catch {}
}

/* ── DASHBOARD ── */
// Главная: сервер и его обновление, чат, живые графики нагрузки, служба и хранилище.
// Сводка приходит из /api/admin/overview (фоновый опрос раз в 10 с), точки графиков —
// из /api/admin/monitor раз в 2 с, пока открыта главная.

const HM = {
  overview: null,
  samples: [], events: [], live: {}, ws: null, cores: 1, lastT: 0,
  down: false, hour: null, dot: null,
  audit: [], disk: null,
  timer: null, ro: null,
  upd: { busy: false, target: null, check: null },
};
const $hm = id => document.getElementById(id);
const hmFmt = (v, d = 0) => v == null || !isFinite(v) ? '—'
  : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
function hmBytes(b, d) {
  if (b == null || !isFinite(b)) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return hmFmt(b, d ?? (i >= 2 && b < 100 ? 1 : 0)) + ' ' + units[i];
}
const hmPad = n => String(n).padStart(2, '0');
const hmClock = (ts, sec) => { const d = new Date(ts); return hmPad(d.getHours()) + ':' + hmPad(d.getMinutes()) + (sec ? ':' + hmPad(d.getSeconds()) : ''); };
function hmPlural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
function hmDuration(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d} дн ${h} ч` : h ? `${h} ч ${m} мин` : m ? `${m} мин` : `${Math.floor(sec)} с`;
}
const HM_LEVEL = { ok: 'Норма', warn: 'Внимание', crit: 'Критично', muted: 'Нет данных' };
const hmLevel = (v, warn, crit) => v == null ? 'muted' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
function hmSetPill(id, lv, text) {
  const p = $hm(id);
  if (p) { p.className = 'hm-pill ' + lv; p.textContent = text || HM_LEVEL[lv]; }
  return lv;
}
// innerHTML меняем только когда разметка другая: иначе аватары и подсказки мигали бы
// на каждом опросе. Сравниваем с тем, что записали сами, — браузер свою разметку
// нормализует, и сравнение с el.innerHTML не совпало бы никогда.
function hmHtml(id, html) {
  const el = $hm(id);
  if (el && el._hm !== html) { el._hm = html; el.innerHTML = html; }
}
const hmText = (id, text) => { const el = $hm(id); if (el && el.textContent !== text) el.textContent = text; };

// Запрос без всплывающего «Нет связи»: пока сервер перезапускается, это нормально
async function hmGet(path) {
  try {
    const res = await fetch(`${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
      headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' },
    });
    if (res.status === 401) { api('GET', '/api/admin/stats'); return null; }   // api() уведёт на вход
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const HM_ICON = {
  server: '<svg width="16" height="16" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
  cpu: '<svg stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
  mem: '<svg stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/></svg>',
  disk: '<svg stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
  lag: '<svg stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>',
  refresh: '<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  up: '<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
  tick: '<svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  cross: '<svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  pause: '<svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  user: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  room: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  ann: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/></svg>',
  restart: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  compact: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/></svg>',
  expand: '<svg width="11" height="11" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>',
  envelope: '<svg width="12" height="12" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
};

// Плитка показателя: подпись, крупное значение, пояснение и мини-график (или аватарки)


async function hmLoadOverview() {
  // Сводка и последние действия (для хроники) — вместе; число сообщений за сутки — отдельным запросом
  const [o, au] = await Promise.all([hmGet('/api/admin/overview'), hmGet('/api/admin/audit-log?limit=12')]);
  if (!o || currentPage !== 'dashboard' || !$hm('hm')) return;
  HM.overview = o;
  HM.audit = Array.isArray(au) ? au : HM.audit;
  hmRenderOverview();
  hmLoadHour();
  swLoadLag();
  if (XP.open) xpRefresh();
}

// «Сейчас в сети»: число, сравнение с началом накопленного периода и мини-график по точкам монитора
function hmRenderOnlineTile() {
  const o = HM.overview;
  if (!o || !$hm('dv-v-online')) return;
  const cur = o.online.length;
  hmHtml('dv-v-online', `${cur}<small>из ${hmFmt(o.chat.users)}</small>`);
  const pts = HM.samples.filter(r => r[8] != null);
  const spanMin = pts.length > 1 ? (pts[pts.length - 1][0] - pts[0][0]) / 60000 : 0;
  if (spanMin >= 10) {
    const d = cur - pts[0][8], ago = spanMin >= 55 ? 'час' : `${Math.round(spanMin)} мин`;
    hmHtml('dv-s-online', d === 0 ? `как и ${ago} назад` : `на <b>${Math.abs(d)}</b> ${d > 0 ? 'больше' : 'меньше'}, чем ${ago} назад`);
  } else hmHtml('dv-s-online', `подключений: <b>${hmFmt(HM.ws ?? 0)}</b>`);
  hmHtml('dv-g-online', hmSpark(hmDown(pts.map(r => r[8]), 90, 'avg'), 'var(--dv-c1)'));
}

// Мини-график: линия с заливкой по последним значениям; растягивается на всю плитку

// Хроника: действия администраторов, запуск и перезапуски службы, обновления, резервные копии
function hmRenderChron() {
  const el = $hm('dv-chron');
  if (!el) return;
  const o = HM.overview, items = [];
  const day = ts => new Date(ts).toDateString();
  const mon = (HM.events || []).filter(e => e.type === 'update' || e.type === 'restart');
  // Обновление и перезапуск записываются и в аудит, и в историю монитора — одну пару не показываем дважды
  const dup = a => /обновлен|перезапуск/i.test(a.action) && mon.some(e => Math.abs(e.t0 - a.created_at * 1000) < 5 * 60e3);
  (HM.audit || []).filter(a => !dup(a)).forEach(a => items.push({ t: a.created_at * 1000, kind: a.category === 'security' ? 'warn' : 'info', ic: a.category === 'security' ? '!' : '●',
    text: esc(a.action), sub: esc([a.actor_name, a.target].filter(Boolean).join(' · ')) }));
  mon.forEach(e => items.push({
    t: e.t0, kind: '', ic: e.type === 'update' ? '↻' : '▲', text: e.type === 'update' ? 'Обновление сервера' : 'Перезапуск службы', sub: '' }));
  // Без systemd времени запуска службы нет — берём время работы процесса
  const startedAt = o?.service?.since || (o?.uptime != null ? Date.now() - o.uptime * 1000 : null);
  if (startedAt) items.push({ t: startedAt, kind: '', ic: '▲', text: o?.service ? `Служба ${esc(o.service.unit || 'electron.service')} запущена` : 'Сервер запущен', sub: '' });
  const bk = o?.storage?.backups;
  if (bk?.latest) items.push({ t: bk.latest, kind: 'info', ic: '◼', text: 'Резервная копия создана', sub: `${hmBytes(bk.size)} · копий: ${bk.count}` });
  (HM.localEv || []).filter(e => day(e.t) === new Date().toDateString()).forEach(e => items.push({ t: e.t, kind: e.kind === 'warn' ? 'warn' : 'info', ic: e.kind === 'warn' ? '!' : '↻', text: esc(e.text), sub: '' }));
  items.sort((a, b) => b.t - a.t);
  // одно и то же событие мониторинга и запись о запуске службы не дублируем
  const seen = [], out = [];
  for (const it of items) { if (seen.some(t => Math.abs(t - it.t) < 90e3 && it.ic === '▲')) continue; if (it.ic === '▲') seen.push(it.t); out.push(it); }
  const label = ts => day(ts) === new Date().toDateString() ? hmClock(ts) : hmPad(new Date(ts).getDate()) + '.' + hmPad(new Date(ts).getMonth() + 1);
  el.innerHTML = out.slice(0, 7).map(it => `<div class="dv-ev"><span class="dv-ev-t">${label(it.t)}</span><span class="dv-ev-i ${it.kind}">${it.ic}</span><span class="dv-ev-x">${it.text}${it.sub ? `<small>${it.sub}</small>` : ''}</span></div>`).join('')
    || '<div class="dv-empty">Событий пока нет</div>';
}

// Сообщения за выбранный период. Подсчёт кэширует сервер, поэтому опрашивать вместе
// со сводкой не накладно


// ── PostgreSQL: блок «Службы» (две службы) и блок базы ──
// Нижний ряд главной на PostgreSQL: «Службы» вместо «Служба electron» и четвёртая карточка про базу.
// Структура лежит в шаблоне главной, здесь только данные; число меняется — оно коротко подсвечивается.
function pgTick(id, text) {
  const el = $hm(id); if (!el || el.textContent === text) return;
  const had = el.dataset.set === '1';
  el.textContent = text; el.dataset.set = '1';
  if (had) { el.classList.remove('dv-tick'); void el.offsetWidth; el.classList.add('dv-tick'); }
}
const pgSince = ts => (ts ? `${new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${hmClock(ts)}` : '—');
function hmRenderPg() {
  const o = HM.overview, pg = o?.pg;
  const one = $hm('hm-svc-one'), many = $hm('hm-svc-many'), card = $hm('dv-db');
  if (!one || !many || !card) return;
  const on = !!pg;
  if (many.hidden === on) {                      // режим сменился: показываем нужные блоки с появлением
    one.hidden = on; many.hidden = !on; card.hidden = !on;
    $hm('dv-bottom')?.classList.toggle('four', on);
    if (on) for (const el of [many, card]) { el.classList.remove('dv-in'); void el.offsetWidth; el.classList.add('dv-in'); }
  }
  if (!on) return;

  // Службы
  // Нагрузка службы базы приходит вместе с точками electron (раз в 2 секунды); снимок из обзора — запасной
  const s = HM.samples[HM.samples.length - 1], live = HM.live || {}, svc = pg.service ? { ...pg.service, ...(HM.pgService || {}) } : null, el = o.service;
  const dot = (id, lv) => { const d = $hm(id); if (d) d.className = 'dv-dot' + (lv && lv !== 'ok' ? ' ' + lv : ''); };
  dot('hm-m-el-dot', el && el.state !== 'active' ? 'crit' : 'ok');
  // у electron значения обновляются каждые 2 секунды: без подсветки, иначе мерцало бы постоянно
  hmText('hm-m-el-cpu', s?.[2] == null ? '—' : `${hmFmt(s[2], 1)}%`);
  hmText('hm-m-el-mem', s?.[4] == null ? '—' : hmBytes(s[4]));
  const load = pg.conn / pg.maxConn, hot = load > .8 || (pg.cache != null && pg.cache < 95);
  dot('hm-m-pg-dot', svc ? (svc.state !== 'active' ? 'crit' : hot ? 'warn' : 'ok') : (hot ? 'warn' : pg.local ? 'off' : 'ok'));
  hmText('hm-m-pg-cpu', svc?.cpu == null ? '—' : `${hmFmt(svc.cpu, 1)}%`);
  hmText('hm-m-pg-mem', svc?.mem == null ? '—' : hmBytes(svc.mem));
  for (const id of ['hm-m-pg-cpu', 'hm-m-pg-mem']) $hm(id)?.classList.toggle('w', !!svc && hot);
  const pb = $hm('hm-m-pg-btn');
  if (pb) { pb.disabled = !svc || PGR.busy; pb.title = svc ? 'Перезапустить postgresql' : 'PostgreSQL на другом сервере: перезапуск отсюда недоступен'; }
  // Подробности двумя колонками (electron, postgresql): так в узкой карточке строки не переносятся
  const short = ts => (ts ? `${new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${hmClock(ts)}` : '—');
  const row = (l, a, b) => `<span>${l}</span><b>${esc(String(a))}</b><b>${esc(String(b))}</b>`;
  let grid = `<div class="dv-m-grid"><i></i><em>electron</em><em>postgresql</em>`
    + row('Задач', live.tasks ?? '—', svc?.tasks ?? '—')
    + row('Запущена', short(el?.since), short(svc?.since || pg.started))
    + (el?.restarts != null || svc?.restarts != null ? row('Сбоев', el?.restarts ?? '—', svc ? (svc.restarts ?? '—') : '—') : '')
    + '</div>';
  if (!pg.local) grid += `<div class="dv-sub" style="margin-top:6px">PostgreSQL на другом сервере · связь ${esc(String(pg.latency))} мс</div>`;
  hmHtml('hm-m-sub', grid);

  // Блок базы
  hmText('dv-db-ver', pg.version || '');
  const lv = svc && svc.state !== 'active' ? 'crit' : hot ? 'warn' : 'ok';
  hmSetPill('dv-db-state', lv, lv === 'crit' ? 'Остановлена' : lv === 'warn' ? 'Нагрузка' : 'Работает');
  hmHtml('dv-db-line', `${hmBytes(pg.size)} · кэш ${pg.cache == null ? '—' : `<b${pg.cache < 95 ? ' style="color:var(--dv-warn)"' : ''}>${hmFmt(pg.cache, 1)}%</b>`} · ${pg.tps == null ? '—' : hmFmt(pg.tps, 0)} запросов/с`);
  pgTick('dv-db-conn', String(pg.conn));
  const big = $hm('dv-db-conn')?.parentElement; if (big) big.style.color = load > .8 ? 'var(--dv-warn)' : '';
  hmText('dv-db-max', `соединений из ${pg.maxConn}`);
  const sp = $hm('dv-db-spark');
  if (sp) {
    hmHtml('dv-db-spark', hmSpark(pg.series.map(r => r[1]), load > .8 ? 'var(--dv-warn)' : 'var(--dv-accent)', { smooth: true, ...(Math.max(...pg.series.map(r => r[1])) > pg.maxConn * .5 ? { lim: pg.maxConn * .8 } : {}) }));
    if (pg.series.length > 1) requestAnimationFrame(() => sp.classList.add('on'));
  }
  const P = pg.parts, vals = [P.status, P.messages, P.search, P.other];
  vals.forEach((v, i) => { const b = $hm('dv-db-p' + i); if (b) b.style.flexGrow = String(Math.max(v, 1)); pgTick('dv-db-v' + i, hmBytes(v)); });
}
const PGR = { busy: false };
function restartPostgres() {
  if (PGR.busy) return;
  confirm('Перезапустить PostgreSQL?',
    'База на несколько секунд оборвёт все соединения: сообщения в этот момент не отправятся, сервер переподключится сам.',
    async () => {
      const r = await api('POST', '/api/admin/system/restart-postgres');
      if (!r?.ok) { toast(r?.error || 'Не удалось перезапустить PostgreSQL', 'error'); return; }
      PGR.busy = true;
      const btn = $hm('hm-m-pg-btn'); if (btn) { btn.classList.add('busy'); btn.disabled = true; }
      toast('PostgreSQL перезапускается…');
      await new Promise(r2 => setTimeout(r2, 3000));
      const t0 = Date.now();
      for (;;) {
        try {
          const res = await fetch('/api/admin/stats', { headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' } });
          if (res.ok) { toast('PostgreSQL перезапущен', 'success'); break; }
        } catch {}
        if (Date.now() - t0 > 40000) { toast('PostgreSQL не ответил за 40 секунд', 'error'); break; }
        await new Promise(r2 => setTimeout(r2, 1500));
      }
      PGR.busy = false;
      const b2 = $hm('hm-m-pg-btn'); if (b2) b2.classList.remove('busy');
      hmLoadOverview();
    });
}

function hmRenderOverview() {
  const o = HM.overview;
  if (!o) return;
  hmRenderEvTile();
  const disk = o.storage.disk;
  const S = o.storage;
  // База на другом сервере не занимает место на этом диске
  const chatData = (S.dbLocal === false ? 0 : S.db + S.wal) + S.files.size + S.backups.size + S.avatars.size;
  HM.disk = disk;

  // Сервер
  hmText('hm-hostname', o.host.hostname);
  hmText('hm-spec', hmSpecText(o));
  hmText('hm-uptime', hmDuration(o.uptime));
  if (!HM.upd.busy) hmText('hm-version', o.version);

  hmRenderOnlineTile();

  // Служба
  const svc = o.service;
  hmText('hm-unit', svc?.unit || 'electron.service');
  if (svc) hmSetPill('hm-svc-state', svc.state === 'active' ? 'ok' : 'warn', svc.state === 'active' ? 'Работает' : svc.state);
  else hmSetPill('hm-svc-state', 'muted', 'без systemd');
  hmText('hm-svc-since', svc?.since
    ? `Запущена ${new Date(svc.since).toLocaleDateString('ru-RU')} в ${hmClock(svc.since)}${svc.restarts != null ? ` · перезапусков после сбоя: ${svc.restarts}` : ''}`
    : `Процесс запущен ${hmDuration(o.uptime)} назад`);

  // Хранилище: как в макете — полоса и список «цвет, название, размер»; пояснения — в подсказке
  const sizeOf = v => hmBytes(v);
  if (disk) {
    const used = disk.total - disk.free;
    const sys = Math.max(0, used - chatData);
    const pct = v => Math.max(0, v / disk.total * 100).toFixed(2) + '%';
    hmText('hm-store-total', hmBytes(disk.total, 0));
    hmHtml('hm-store-sub', `Занято <b>${hmBytes(used)}</b> · свободно <b>${hmBytes(disk.free)}</b>`);
    hmHtml('hm-store', `<div class="dv-store-bar" role="img" aria-label="Занято ${hmBytes(used)} из ${hmBytes(disk.total)}">
        <span style="width:${pct(S.db + S.wal)};background:var(--dv-c1)" title="База данных — ${hmBytes(S.db + S.wal)}"></span>
        <span style="width:${pct(S.files.size + S.avatars.size)};background:var(--dv-c2)" title="Файлы и аватары — ${hmBytes(S.files.size + S.avatars.size)}"></span>
        <span style="width:${pct(S.backups.size)};background:var(--dv-c3)" title="Резервные копии — ${hmBytes(S.backups.size)}"></span>
        <span style="flex:1;background:var(--dv-c4);opacity:.55" title="Система и прочее — ${hmBytes(sys)}"></span>
        <span style="width:${pct(disk.free)};background:var(--dv-surface2);box-shadow:inset 0 0 0 1px var(--dv-border)" title="Свободно — ${hmBytes(disk.free)}"></span>
      </div>`);
  }
  const days = S.backups.latest ? Math.floor((Date.now() - S.backups.latest) / 86400000) : null;
  const backup = !S.backups.count
    ? 'Копий пока нет'
    : `${S.backups.count} ${hmPlural(S.backups.count, 'копия', 'копии', 'копий')} · последняя `
        + (days === 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} ${hmPlural(days, 'день', 'дня', 'дней')} назад`);
  const leg = (color, name, note, value) => `<div class="dv-leg" title="${esc(note)}"><i style="background:${color}"></i>${name}<span class="v">${value}</span></div>`;
  hmHtml('hm-store-list',
    leg('var(--dv-c1)', 'База данных', S.engine === 'postgresql' ? `PostgreSQL${S.dbLocal === false ? ' на другом сервере' : ''}: ${hmBytes(S.db)}` : `chat.db ${hmBytes(S.db)} + журнал WAL ${hmBytes(S.wal)}`, sizeOf(S.db + S.wal))
    + leg('var(--dv-c2)', 'Файлы чата', `${hmFmt(S.files.count)} ${hmPlural(S.files.count, 'файл', 'файла', 'файлов')} · аватары ${hmBytes(S.avatars.size)}`, sizeOf(S.files.size + S.avatars.size))
    + leg('var(--dv-c3)', 'Резервные копии', backup, sizeOf(S.backups.size))
    + (disk ? leg('var(--dv-c4)', 'Система и прочее', 'Debian, Node.js, журналы', sizeOf(Math.max(0, disk.total - disk.free - chatData))) : ''));

  hmRenderPg();
  hmRenderChron();
  hmRenderHeadlines();
  swRender();
  sbRender();
}

// ── Сообщения за период: подсказка при наведении, касании и стрелками ──


// Подпись в подсказке: час, день или месяц

// Подпись под осью. Отсчёт от последнего столбика — текущий период подписан всегда


// ── Живые графики ──
const HM_GIB = 1073741824, HM_MIB = 1048576;
const hmMemTotal = () => HM.live.mem?.total || HM.overview?.host.memTotal || HM_GIB;

function hmRenderHeadlines() {
  const s = HM.samples[HM.samples.length - 1], live = HM.live || {}, o = HM.overview;
  if (!$hm('hm') || !s) return;
  const memTotal = hmMemTotal();

  // Плитки «Процессор» и «Отклик» с мини-графиком по накопленным точкам
  hmHtml('dv-v-cpu', `${hmFmt(s[1], 1)}<small>%</small>`);
  hmHtml('dv-s-cpu', live.load ? `Load average <b>${live.load.map(v => hmFmt(v, 2)).join(' · ')}</b> на ${HM.cores} ${hmPlural(HM.cores, 'ядро', 'ядра', 'ядер')}` : '&nbsp;');
  hmHtml('dv-g-cpu', hmSpark(hmDown(HM.samples.map(r => r[1]), 90, 'avg'), 'var(--dv-c3)', { smooth: true }));
  hmHtml('dv-v-lag', `${hmFmt(s[7])}<small>мс</small>`);
  const lagVals = HM.samples.map(r => r[7]).filter(v => v != null), lagPeak = Math.max(0, ...lagVals), lagOver = lagVals.filter(v => v > LAG_LIM).length;
  hmHtml('dv-s-lag', lagOver ? `<b style="color:var(--dv-bad)">выше нормы ${hmDurText(lagOver * 2000)}</b> · макс ${hmFmt(lagPeak)} мс за час` : (lagVals.length ? `в норме (до ${LAG_LIM} мс), макс <b>${hmFmt(lagPeak)} мс</b> за час` : '&nbsp;'));
  hmHtml('dv-g-lag', hmSpark(hmDown(HM.samples.map(r => r[7]), 90, 'max'), 'var(--dv-c5)', { smooth: true, lim: LAG_LIM }));

  hmRenderOnlineTile();

  // Ресурсы: память, диск, подкачка полосами с порогами
  const available = live.mem?.available ?? memTotal - s[3];
  const memPct = s[3] / memTotal * 100;
  const disk = HM.disk, diskPct = disk ? (disk.total - disk.free) / disk.total * 100 : null;
  const swapT = live.mem?.swapTotal, swapPct = swapT ? (swapT - live.mem.swapFree) / swapT * 100 : null;
  const res = (name, note, pct, warn, crit) => {
    const lv = pct == null ? 'ok' : pct >= crit ? 'crit' : pct >= warn ? 'warn' : '';
    return `<div class="dv-res-row"><div class="dv-res-top"><b>${name}</b><span>${note}</span></div><div class="dv-meter"><i class="${lv}" style="width:${Math.min(100, pct || 0).toFixed(1)}%"></i></div></div>`;
  };
  hmHtml('dv-res', res('Память', `${hmBytes(available)} свободно из ${hmBytes(memTotal, 0)}`, memPct, 80, 90)
    + (disk ? res('Диск', `${hmBytes(disk.free)} свободно из ${hmBytes(disk.total, 0)}`, diskPct, 80, 90) : '')
    + (swapT ? res('Подкачка', `${hmBytes(swapT - live.mem.swapFree)} из ${hmBytes(swapT)}`, swapPct, 50, 80) : ''));

  // Общий статус сервера — по худшему из показателей
  const levels = [hmLevel(s[1], 70, 90), hmLevel(memPct, 80, 90), hmLevel(s[7], 50, 200),
    diskPct == null ? 'ok' : hmLevel(diskPct, 80, 90)];
  const worst = levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'ok';
  HM.dot = HM.down ? { lv: 'warn', text: 'Нет связи с сервером' } : { lv: worst, text: { ok: 'Всё в порядке', warn: 'Есть предупреждения', crit: 'Нужно внимание' }[worst] };
  hmSetDot();

  // Служба и её процессы
  hmText('hm-k-cpu', s[2] == null ? '—' : `${hmFmt(s[2], 1)}%`);
  hmText('hm-k-mem', s[4] == null ? '—' : hmBytes(s[4]));
  hmText('hm-k-tasks', live.tasks == null ? '—' : hmFmt(live.tasks));
  hmText('hm-ws', hmFmt(HM.ws));
  if (o?.pg) hmRenderPg();
}

// ── Опрос графиков ──
async function hmLoadMonitor(full) {
  if (HM.inflight) return;
  HM.inflight = true;
  const m = await hmGet('/api/admin/monitor' + (full || !HM.lastT ? '' : '?since=' + HM.lastT));
  HM.inflight = false;
  if (currentPage !== 'dashboard' || !$hm('hm')) return;
  const wasDown = HM.down;
  HM.down = !m;
  // Связь вернулась после перезапуска — берём историю целиком: в ней отметка перезапуска
  if (m && wasDown && !full) { HM.down = false; return hmLoadMonitor(true); }
  if (m) {
    if (full || !HM.lastT) HM.samples = m.samples;
    else HM.samples.push(...m.samples);
    if (HM.samples.length > 1800) HM.samples.splice(0, HM.samples.length - 1800);
    HM.events = m.events || [];
    HM.live = m.live || {};
    HM.cores = m.cores || 1;
    HM.ws = m.ws;
    HM.pgService = m.pgService || null;
    HM.lastT = HM.samples.length ? HM.samples[HM.samples.length - 1][0] : m.now;
  }
  hmRenderHeadlines();
  if (full) hmRenderChron();
}

function hmStartMonitor() {
  hmStopMonitor();
  HM.timer = setInterval(() => {
    if (currentPage !== 'dashboard' || !$hm('hm')) { hmStopMonitor(); HM.ro?.disconnect(); return; }
    if (document.hidden) return;   // вкладка в фоне — сервер зря не опрашиваем
    hmLoadMonitor(false);
  }, 2000);
}
function hmStopMonitor() { clearInterval(HM.timer); HM.timer = null; }

// Плашка активного пункта — двигаем transform'ом между реальными координатами кнопок
// (а не CSS-переключением фона), с отскоком, как в таб-баре мобильного клиента.
function hmSyncSegHl(seg, hl, animate = true) {
  if (!seg || !hl) return;
  const btn = seg.querySelector('button[aria-pressed="true"]');
  if (!btn) return;
  const segRect = seg.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  if (!btnRect.width) return;
  if (!animate) hl.style.transition = 'none';
  hl.style.width = btnRect.width + 'px';
  hl.style.transform = `translateX(${(btnRect.left - segRect.left).toFixed(2)}px)`;
  if (!animate) { void hl.offsetWidth; hl.style.transition = ''; }
}

/* ── ГЛАВНАЯ: ТАЙМЛАЙН СОБЫТИЙ, РАСКРЫТИЕ ПЛИТОК ── */
// Плитка «События за час» заменила «Сообщения за 24 часа»: столбики сообщений по пять минут и значки событий
// (обновления и перезапуски сервера, системные сообщения). Любая из четырёх плиток раскрывается на всю ширину:
// период (24 часа, неделя, месяц, год), подсказки при наведении, список событий периода.
// События берутся из /api/admin/timeline, ряды нагрузки из /api/admin/metrics (пятиминутки в базе),
// сообщения из /api/admin/activity.

const LAG_LIM = 50;   // граница нормального отклика, мс
const XT = {
  msg: { n: 'Сообщения', c: 'var(--dv-c2)' },
  upd: { n: 'Обновления и перезапуски', c: 'var(--dv-ok)' },
  sys: { n: 'Системные сообщения', c: 'var(--dv-bad)' },
};
const XI = {
  upd: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  sys: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  ex: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  srv: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  chk: '<polyline class="xh-tk" points="20 6 9 17 4 12"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
const xi = (k, s = 12, col = '#fff', sw = 2.6, cls = '') => `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${XI[k]}</svg>`;

const XTABS = {
  online: { n: 'Сейчас в сети', short: 'В сети', c: 'var(--dv-c1)', key: 'online', col: 8, fmt: v => hmFmt(v) },
  ev: { n: 'События', short: 'События', c: 'var(--dv-c2)' },
  cpu: { n: 'Процессор', short: 'Процессор', c: 'var(--dv-c3)', key: 'cpu', col: 1, smooth: true, fmt: v => hmFmt(v, 1) + ' %' },
  lag: { n: 'Отклик сервера', short: 'Отклик', c: 'var(--dv-c5)', key: 'lag', col: 7, smooth: true, lim: LAG_LIM, fmt: v => hmFmt(v) + ' мс' },
};
const XP = { open: false, tab: 'ev', range: '24h', types: { msg: true, upd: true, sys: true }, hover: null, all: false, g: null, events: [], req: 0, ox: 0 };
try { const r = localStorage.getItem('hm-msg-range'); if (['24h', '7d', '30d', '1y'].includes(r)) XP.range = r; } catch {}
const XRANGE = { '24h': 'Сутки', '7d': 'Неделя', '30d': 'Месяц', '1y': 'Год' };
const XSPAN = { '24h': 25 * 3600e3, '7d': 8 * 86400e3, '30d': 31 * 86400e3, '1y': 400 * 86400e3 };
const xTz = () => -new Date().getTimezoneOffset();
const xWhen = (t, withDate) => withDate || Date.now() - t > 86400e3 ? `${hmPad(new Date(t).getDate())}.${hmPad(new Date(t).getMonth() + 1)} ${hmClock(t)}` : hmClock(t);

// ── Плавная кривая (монотонный кубический сплайн): не «перелетает» через пики, поэтому выход за границу
// нормы на графике виден ровно там, где он был в данных ──
function hmPathD(pts, smooth) {
  const n = pts.length, f = v => v.toFixed(1);
  if (!smooth || n < 3) return pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${f(pts[i][0] + h)} ${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)} ${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`; }
  return d;
}
// Мини-график: линия с заливкой; o.smooth — плавная линия, o.lim — граница нормы (выше неё красным)
function hmSpark(vals, color, o = {}) {
  const v = vals.filter(x => x != null).slice(-90);
  if (v.length < 2) return '';
  const w = 200, h = 46, mx = Math.max(...v, o.lim ? o.lim * 1.2 : 1e-9), mn = Math.min(...v, 0), n = v.length;
  const x = i => (i / (n - 1)) * w, y = x2 => h - 3 - ((x2 - mn) / (mx - mn || 1)) * (h - 6);
  const d = hmPathD(v.map((q, i) => [x(i), y(q)]), o.smooth), area = `${d} L${w} ${h} L0 ${h} Z`;
  const id = 'sp' + Math.random().toString(36).slice(2, 7);
  let over = '', endC = color;
  if (o.lim) {
    const ly = y(o.lim).toFixed(1);
    over = `<clipPath id="c${id}"><rect x="0" y="0" width="${w}" height="${ly}"/></clipPath><line x1="0" x2="${w}" y1="${ly}" y2="${ly}" stroke="var(--dv-bad)" stroke-dasharray="3 3" opacity=".7" vector-effect="non-scaling-stroke"/>`
      + `<path d="${area}" fill="var(--dv-bad)" opacity=".3" clip-path="url(#c${id})"/><path d="${d}" fill="none" stroke="var(--dv-bad)" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" clip-path="url(#c${id})"/>`;
    if (v[n - 1] > o.lim) endC = 'var(--dv-bad)';
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${over}<circle cx="${x(n - 1)}" cy="${y(v[n - 1])}" r="3" fill="${endC}"/></svg>`;
}
// Выходы отклика за границу нормы: непрерывные участки точек выше неё
function hmOverRuns(vals, lim) {
  const runs = []; let a = -1;
  vals.forEach((v, i) => { if (v != null && v > lim) { if (a < 0) a = i; } else if (a >= 0) { runs.push([a, i - 1]); a = -1; } });
  if (a >= 0) runs.push([a, vals.length - 1]);
  return runs;
}
function hmDurText(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' мин' : m < 48 * 60 ? hmFmt(m / 60, m % 60 ? 1 : 0) + ' ч' : Math.round(m / 1440) + ' сут'; }

// Ряд из тысяч замеров сжимаем до n точек (среднее или максимум по группе) — для мини-графика за час
function hmDown(vals, n, mode) {
  const v = vals.filter(x => x != null);
  if (v.length <= n) return v;
  const out = [], k = v.length / n;
  for (let i = 0; i < n; i++) {
    const g = v.slice(Math.floor(i * k), Math.max(Math.floor(i * k) + 1, Math.floor((i + 1) * k)));
    out.push(mode === 'max' ? Math.max(...g) : g.reduce((s, x) => s + x, 0) / g.length);
  }
  return out;
}

// ── Плитки ──
// Плитка показателя: подпись, крупное значение, пояснение и мини-график. Нажатие раскрывает её на всю ширину
function dvTile(id, label) {
  return `<section class="hm-panel dv-kpi xk" role="button" tabindex="0" data-xk="${id}" aria-labelledby="dv-l-${id}" aria-label="${label}: открыть подробный график">
    <span class="xk-ex" aria-hidden="true">${xi('ex', 12, 'currentColor', 2.2)}</span>
    <div class="dv-lbl" id="dv-l-${id}">${label}</div>
    <div class="dv-big" id="dv-v-${id}">—</div>
    <div class="dv-sub" id="dv-s-${id}">&nbsp;</div>
    <div class="dv-spark" id="dv-g-${id}"></div>
  </section>`;
}
const dvTilesHtml = () => `<div class="dv-kpis">${dvTile('online', 'Сейчас в сети')}${dvTile('ev', 'События за час')}${dvTile('cpu', 'Процессор')}${dvTile('lag', 'Отклик сервера')}</div>`;

async function hmLoadHour() {
  const to = Date.now();
  const [a, ev] = await Promise.all([hmGet('/api/admin/activity?range=1h'), hmGet(`/api/admin/timeline?from=${to - 3600e3}&to=${to}`)]);
  if (!a || currentPage !== 'dashboard' || !$hm('hm')) return;
  HM.hour = { buckets: a.buckets, events: Array.isArray(ev) ? ev : [], at: to };
  hmRenderEvTile();
}
function hmRenderEvTile() {
  const h = HM.hour;
  if (!h || !$hm('dv-v-ev')) return;
  const cnt = h.buckets.map(b => b.n), total = cnt.reduce((s, x) => s + x, 0), mx = Math.max(...cnt, 1);
  const t1 = h.at, t0 = t1 - 3600e3, evs = h.events.filter(e => e.t > t0 && e.t <= t1);
  const nu = evs.filter(e => e.type === 'upd').length, ns = evs.filter(e => e.type === 'sys').length;
  // Справа от числа за час — сколько сообщений всего (без удалённых), из той же сводки, что и остальные плитки
  const all = HM.overview?.chat?.messages;
  hmHtml('dv-v-ev', `${hmFmt(total)}<small>${hmPlural(total, 'сообщение', 'сообщения', 'сообщений')}</small>${all == null ? '' : `<small style="margin-left:6px">(<b style="color:var(--dv-text);font-weight:700">${hmFmt(all)}</b> всего)</small>`}`);
  hmHtml('dv-s-ev', [nu ? `${nu} ${hmPlural(nu, 'обновление', 'обновления', 'обновлений')}` : '', ns ? `${ns} ${hmPlural(ns, 'системное сообщение', 'системных сообщения', 'системных сообщений')}` : ''].filter(Boolean).join(' · ') || 'событий не было');
  hmHtml('dv-g-ev', `<div class="xk-tlw"><div class="xk-tlb">${cnt.map(c => `<i style="height:${Math.max(8, c / mx * 100)}%"></i>`).join('')}</div>${
    evs.map(e => `<span class="xk-tlm" data-xev="${esc(JSON.stringify([e.type, e.title, e.text, e.meta, e.t]))}" style="left:${((e.t - t0) / 3600e3 * 100).toFixed(2)}%;background:${XT[e.type].c};color:${XT[e.type].c}">${xi(e.type, 11)}</span>`).join('')
  }</div>`);
}
// Подсказка над значком события на плитке
function xEvTip(list) {
  return list.map(e => `<div class="xp-te"><span class="xp-tei" style="background:${XT[e.type].c}">${xi(e.type, 10)}</span><div><b>${esc(e.title)}</b><span class="tm">${xWhen(e.t)}</span>${e.text ? `<div>${esc(e.text)}</div>` : ''}${e.meta ? `<small>${esc(e.meta)}</small>` : ''}</div></div>`).join('');
}

// ── Раскрытая панель ──
function dvMount() {
  const kz = $hm('dv-kz');
  if (!kz) return;
  kz.innerHTML = XP.open ? xpPanelHtml() : dvTilesHtml();
  if (XP.open) xpLoad(); else { hmRenderOnlineTile(); hmRenderHeadlines(); hmRenderEvTile(); }
}
// Раскрытие и сворачивание — одна и та же анимация в обе стороны: старое содержимое гаснет, высота блока плавно
// переходит к новой (всё, что ниже, сдвигается вместе с ней), новое содержимое проявляется
const kzReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let kzBusy = false;
function kzTo(open, tab) {
  const kz = $hm('dv-kz');
  const apply = () => { Object.assign(XP, { open, hover: null, all: false, g: null, events: [] }); if (tab) XP.tab = tab; dvMount(); };
  if (!kz || !kz.firstElementChild || kzReduced()) return apply();
  if (kzBusy) return;
  kzBusy = true;
  const h0 = kz.getBoundingClientRect().height;
  kz._a?.cancel();
  kz.style.overflow = 'clip'; kz.style.overflowClipMargin = '16px';
  XP.req++;                                   // ответы для старого содержимого больше не нужны
  const out = kz.firstElementChild.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 150, easing: 'ease-in', fill: 'forwards' });
  // Подстраховка по таймеру: в фоновой вкладке анимации стоят, и без неё блок навсегда остался бы «занят»
  let fired = false;
  const next = () => {
    if (fired) return; fired = true;
    apply();
    const h1 = kz.getBoundingClientRect().height, ease = 'cubic-bezier(.2,.8,.2,1)';
    kz.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60, easing: ease, fill: 'backwards' });
    const a = kz._a = kz.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 340, easing: ease });
    const end = () => { kzBusy = false; if (kz._a === a) { kz._a = null; kz.style.overflow = ''; kz.style.overflowClipMargin = ''; } };
    a.onfinish = end; a.oncancel = end;
    setTimeout(() => { kzBusy = false; if (kz._a === a) { a.cancel(); } }, 700);
  };
  out.onfinish = next;
  setTimeout(next, 260);
}
// Любое изменение высоты содержимого (пришли данные, переключили период, раскрыли список) — тоже плавно
function kzMorph(change) {
  const kz = $hm('dv-kz');
  if (!kz) return change();
  const h0 = kz.getBoundingClientRect().height;
  kz._a?.cancel();
  change();
  const h1 = kz.getBoundingClientRect().height;
  if (kzReduced() || Math.abs(h1 - h0) < 2) return;
  kz.style.overflow = 'clip'; kz.style.overflowClipMargin = '16px';
  const a = kz._a = kz.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const end = () => { if (kz._a === a) { kz._a = null; kz.style.overflow = ''; kz.style.overflowClipMargin = ''; } };
  a.onfinish = end; a.oncancel = end;
  setTimeout(() => { if (kz._a === a) a.cancel(); }, 600);
}
const xpOpen = tab => { if (!XP.open) kzTo(true, tab); };
const xpClose = () => { if (XP.open) kzTo(false); };
function xpTabValue(k) {
  const live = HM.samples[HM.samples.length - 1], o = HM.overview;
  if (k === 'online') return o ? hmFmt(o.online.length) : '—';
  if (k === 'ev') return HM.hour ? hmFmt(HM.hour.buckets.reduce((s, b) => s + b.n, 0)) : '—';
  if (k === 'cpu') return live ? hmFmt(live[1], 1) + ' %' : '—';
  return live ? hmFmt(live[7]) + ' мс' : '—';
}
function xpPanelHtml() {
  return `<section class="hm-panel xp" style="--ox:${XP.ox}px" aria-label="Подробный график">
    <div class="xp-head">
      <div class="xp-tabs" role="tablist">${['online', 'ev', 'cpu', 'lag'].map(k => `<button type="button" class="xp-tab" role="tab" aria-selected="${XP.tab === k}" data-xtab="${k}">${XTABS[k].short}<b>${xpTabValue(k)}</b></button>`).join('')}</div>
      <div class="xp-seg" role="group" aria-label="Период">${Object.entries(XRANGE).map(([k, n]) => `<button type="button" aria-pressed="${XP.range === k}" data-xrange="${k}">${n}</button>`).join('')}</div>
      <button type="button" class="xp-close" data-xclose aria-label="Свернуть">${xi('x', 14, 'currentColor', 2.2)}</button>
    </div>
    <div class="xp-sum" id="xp-sum"></div>
    <div class="xp-chart" id="xp-chart"><div id="xp-svg"></div><div class="xp-tip" id="xp-tip" hidden></div></div>
    <div class="xp-list" id="xp-list"></div>
  </section>`;
}
// Загрузка рядов и событий выбранного периода. Ответы старого периода или вкладки отбрасываем
async function xpLoad(keep) {
  const req = ++XP.req, tab = XP.tab, range = XP.range, now = Date.now();
  const [d, ev] = await Promise.all([
    tab === 'ev' ? hmGet(`/api/admin/activity?range=${range}&tz=${xTz()}`) : hmGet(`/api/admin/metrics?range=${range}`),
    hmGet(`/api/admin/timeline?from=${now - XSPAN[range]}&to=${now}`),
  ]);
  if (req !== XP.req || !XP.open || !$hm('xp-chart')) return;
  if (!d) { $hm('xp-sum').innerHTML = '<div class="dv-empty">Не удалось загрузить данные</div>'; return; }
  XP.events = Array.isArray(ev) ? ev : [];
  XP.now = now;
  if (tab === 'ev') {
    const b = d.buckets, edges = b.map(x => x.t), last = new Date(b[b.length - 1].t), off = xTz() * 60000;
    const nextMs = d.unit === 'hour' ? 3600e3 : d.unit === 'day' ? 86400e3 : null;
    const end = nextMs ? b[b.length - 1].t + nextMs : (() => { const l = new Date(b[b.length - 1].t + off); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1) - off; })();
    edges.push(end);
    XP.g = { line: false, unit: d.unit, n: b.length, edges, start: edges[0], end, vals: b.map(x => x.n) };
  } else {
    const k = XTABS[tab].key;
    XP.g = { line: true, n: d.n, start: d.start, end: d.end, step: d.step, vals: d[k].map(v => v == null ? null : v) };
  }
  if (!keep) XP.hover = null;
  kzMorph(xpRender);
}
const xpRefresh = () => { if (XP.open) xpLoad(true); };
function xpRender() { xpSum(); xpDraw(); xpList(); }

const xEvIdx = e => {
  const g = XP.g;
  if (g.line) return Math.max(0, Math.min(g.n - 1, Math.floor((e.t - g.start) / g.step)));
  let i = 0; while (i < g.n - 1 && g.edges[i + 1] <= e.t) i++;
  return i;
};
const xEvIn = (idx, filter = true) => XP.events.filter(e => (!filter || XP.types[e.type]) && e.t >= XP.g.start && e.t <= XP.now && xEvIdx(e) === idx);

function xpSum() {
  const g = XP.g; if (!g) return;
  const live = g.vals.filter(v => v != null), T = XTABS[XP.tab];
  const inR = XP.events.filter(e => e.t >= g.start && e.t <= XP.now), nu = inR.filter(e => e.type === 'upd').length, ns = inR.filter(e => e.type === 'sys').length;
  let head;
  if (XP.tab === 'ev') {
    const tot = live.reduce((s, x) => s + x, 0);
    head = `<div><div class="dv-lbl">Сообщений за ${{ '24h': 'сутки', '7d': 'неделю', '30d': 'месяц', '1y': 'год' }[XP.range]}</div><div class="dv-big">${hmFmt(tot)}</div></div><div class="dv-sub">пик: <b>${hmFmt(Math.max(...live, 0))}</b> ${g.unit === 'hour' ? 'в час' : g.unit === 'day' ? 'в день' : 'в месяц'}</div>`;
  } else if (!live.length) head = `<div class="dv-sub">За этот период данных ещё нет: история копится с момента обновления сервера</div>`;
  else {
    const mn = Math.min(...live), mx = Math.max(...live), av = live.reduce((s, x) => s + x, 0) / live.length, d = XP.tab === 'cpu' ? 1 : 0;
    head = `<div><div class="dv-lbl">${T.n} сейчас</div><div class="dv-big">${T.fmt(live[live.length - 1])}</div></div><div class="dv-sub">за период: мин <b class="hm-mono">${hmFmt(mn, d)}</b> · среднее <b class="hm-mono">${hmFmt(av, d)}</b> · макс <b class="hm-mono">${hmFmt(mx, d)}</b></div>`;
    const first = g.vals.findIndex(v => v != null);
    if (first > g.n * .04) head += `<span class="dv-sub">история копится с ${xWhen(g.start + first * g.step, true)}</span>`;
    if (T.lim) {
      const runs = hmOverRuns(g.vals, T.lim), tot = runs.reduce((s, [a, b]) => s + (b - a + 1) * g.step, 0);
      head += runs.length
        ? `<span class="hm-pill crit">Выше нормы ${T.lim} мс: ${runs.length} ${hmPlural(runs.length, 'раз', 'раза', 'раз')}, около ${hmDurText(tot)}</span>`
        : `<span class="hm-pill ok">В норме весь период (до ${T.lim} мс)</span>`;
    }
  }
  const tg = (k, n) => `<button type="button" class="xp-tg" aria-pressed="${XP.types[k]}" data-xtype="${k}"><i style="background:${XT[k].c}"></i>${XT[k].n}<span class="hm-mono">${n}</span></button>`;
  $hm('xp-sum').innerHTML = head + `<div class="xp-tgs">${XP.tab === 'ev' ? tg('msg', hmFmt(live.reduce((s, x) => s + x, 0))) : ''}${tg('upd', nu)}${tg('sys', ns)}</div>`;
}

// На телефоне график ниже, чтобы поместиться на экране вместе с подписями
const XH = innerWidth <= 820 ? 230 : 300, XPL = innerWidth <= 820 ? 34 : 44, XPR = 12, XPT = 36, XPB = 24;
function xNiceMax(v) { const q = Math.max(v, 1) / 4, p = Math.pow(10, Math.floor(Math.log10(q))), f = q / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p * 4; }
function xTicks(g) {
  const out = [], r = XP.range, md = t => `${hmPad(new Date(t).getDate())}.${hmPad(new Date(t).getMonth() + 1)}`;
  const day0 = new Date(g.start); day0.setHours(0, 0, 0, 0);
  if (r === '24h') { for (let t = Math.ceil(g.start / (3 * 3600e3)) * 3 * 3600e3; t < g.end; t += 3 * 3600e3) out.push([t, hmClock(t)]); }
  else if (r === '7d') { for (let i = 0; i < 9; i++) { const t = day0.getTime() + i * 86400e3; if (t >= g.start && t < g.end) out.push([t, new Date(t).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })]); } }
  else if (r === '30d') { for (let i = 0; i < 32; i += 5) { const t = day0.getTime() + i * 86400e3; if (t >= g.start && t < g.end) out.push([t, md(t)]); } }
  else { for (let m = 0; m < 14; m++) { const d = new Date(new Date(g.start).getFullYear(), new Date(g.start).getMonth() + m, 1); if (d.getTime() >= g.start && d.getTime() < g.end) out.push([d.getTime(), d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')]); } }
  return out;
}
function xpSvg(w) {
  const g = XP.g, T = XTABS[XP.tab], line = g.line, vals = g.vals;
  const pw = w - XPL - XPR, ph = XH - XPT - XPB, span = g.end - g.start, X = t => XPL + (t - g.start) / span * pw;
  const mx = xNiceMax(Math.max(...vals.filter(v => v != null), 1, T.lim ? T.lim * 1.3 : 0) * 1.08), Y = v => XPT + ph - v / mx * ph;
  const unit = pw / g.n, hv = XP.hover, step4 = mx / 4;
  let s = `<svg width="${w}" height="${XH}" viewBox="0 0 ${w} ${XH}" role="img" aria-label="${esc(T.n)}">`;
  for (let i = 0; i <= 4; i++) { const v = step4 * i, y = Y(v); s += `<line x1="${XPL}" x2="${w - XPR}" y1="${y}" y2="${y}" stroke="var(--dv-border)" ${i ? 'stroke-dasharray="3 5"' : ''}/><text x="${XPL - 8}" y="${y + 3.5}" text-anchor="end">${hmFmt(v, step4 % 1 ? 1 : 0)}</text>`; }
  // Пока история не накопилась, левая часть периода пустая: закрашиваем её и подписываем, а не оставляем «голую» сетку
  if (line) {
    const first = vals.findIndex(v => v != null), fw = (first < 0 ? g.n : first) / g.n * pw;
    if (fw > 4) s += `<rect x="${XPL}" y="${XPT}" width="${fw}" height="${ph}" fill="var(--dv-surface2)" opacity=".55"/>${fw > 150 ? `<text class="nodata" x="${XPL + fw / 2}" y="${XPT + ph / 2}" text-anchor="middle">${first < 0 ? 'данных за этот период пока нет' : 'история копится, раньше данных нет'}</text>` : ''}`;
  }
  if (line) xTicks(g).forEach(([t, l]) => { const x = X(t); s += `<line x1="${x}" x2="${x}" y1="${XPT + ph}" y2="${XPT + ph + 4}" stroke="var(--dv-border)"/><text x="${x}" y="${XH - 6}" text-anchor="middle">${l}</text>`; });
  else {
    const stride = XP.range === '24h' ? 3 : XP.range === '30d' ? 5 : 1;
    g.edges.slice(0, g.n).forEach((t, i) => {
      if ((g.n - 1 - i) % stride) return;
      const d = new Date(t), lab = g.unit === 'hour' ? hmPad(d.getHours()) + ':00' : g.unit === 'day' ? (XP.range === '7d' ? d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }) : `${hmPad(d.getDate())}.${hmPad(d.getMonth() + 1)}`) : d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
      s += `<text x="${XPL + (i + .5) * unit}" y="${XH - 6}" text-anchor="middle">${lab}</text>`;
    });
  }
  if (!line) {
    const gap = unit > 9 ? 2 : 1;
    vals.forEach((v, i) => {
      const x = XPL + i * unit, h = v / mx * ph;
      if (i === hv) s += `<rect x="${x}" y="${XPT}" width="${unit}" height="${ph}" fill="var(--dv-surface2)"/>`;
      if (v > 0 && XP.types.msg) s += `<rect x="${x + gap / 2}" y="${Y(v)}" width="${Math.max(1, unit - gap)}" height="${h}" rx="${unit > 6 ? 3 : 1}" fill="var(--dv-c2)" opacity="${i === hv ? 1 : .78}"/>`;
    });
  } else {
    const pts = vals.map((v, k) => v == null ? null : [XPL + k / g.n * pw, Y(v)]).filter(Boolean);
    if (pts.length === 1) s += `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4" fill="${T.c}"/>`;
    if (pts.length > 1) {
      const id = 'xa' + XP.tab, d = hmPathD(pts, T.smooth), area = `${d} L${pts[pts.length - 1][0]} ${XPT + ph} L${pts[0][0]} ${XPT + ph} Z`;
      s += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.c}" stop-opacity=".32"/><stop offset="1" stop-color="${T.c}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${T.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      let endC = T.c;
      if (T.lim) {
        const ly = Y(T.lim), runs = hmOverRuns(vals, T.lim);
        s += `<clipPath id="xclim"><rect x="${XPL}" y="${XPT}" width="${pw}" height="${Math.max(0, ly - XPT)}"/></clipPath>
          <path d="${area}" fill="var(--dv-bad)" opacity=".3" clip-path="url(#xclim)"/><path d="${d}" fill="none" stroke="var(--dv-bad)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#xclim)"/>
          <line x1="${XPL}" x2="${w - XPR}" y1="${ly}" y2="${ly}" stroke="var(--dv-bad)" stroke-dasharray="5 4" opacity=".85"/>
          <text class="lim" x="${w - XPR - 4}" y="${ly - 6}" text-anchor="end">норма до ${T.lim} мс</text>`;
        runs.forEach(([a, b]) => { const x0 = Math.max(XPL, XPL + (a - .5) / g.n * pw), x1 = XPL + (b + .5) / g.n * pw; s += `<rect x="${x0}" y="${XPT + ph - 4}" width="${Math.max(4, x1 - x0)}" height="4" rx="2" fill="var(--dv-bad)"/>`; });
        if (pts.length && vals[vals.map(v => v != null).lastIndexOf(true)] > T.lim) endC = 'var(--dv-bad)';
      }
      const lp = pts[pts.length - 1]; s += `<circle cx="${lp[0]}" cy="${lp[1]}" r="3.5" fill="${endC}"/>`;
      if (hv != null && vals[hv] != null) { const x = XPL + hv / g.n * pw; s += `<line x1="${x}" x2="${x}" y1="${XPT}" y2="${XPT + ph}" stroke="var(--dv-muted)" opacity=".6"/><circle cx="${x}" cy="${Y(vals[hv])}" r="5" fill="var(--dv-surface)" stroke="${T.c}" stroke-width="2.4"/>`; }
    }
  }
  // события: значки в верхней полосе; у наведённого места ещё и линия вниз
  const groups = new Map();
  XP.events.filter(e => XP.types[e.type] && e.t >= g.start && e.t <= XP.now).forEach(e => { const i = xEvIdx(e), k = i + '|' + e.type; (groups.get(k) || groups.set(k, { i, type: e.type, n: 0 }).get(k)).n++; });
  const r = Math.max(4.5, Math.min(8.5, unit * .42));
  groups.forEach(gr => {
    const both = groups.has(gr.i + '|' + (gr.type === 'upd' ? 'sys' : 'upd')), off = both ? (gr.type === 'upd' ? -r : r) * .9 : 0;
    const cx = (line ? XPL + gr.i / g.n * pw : XPL + (gr.i + .5) * unit) + off, cy = 14, on = gr.i === hv;
    if (on) s += `<line x1="${cx}" x2="${cx}" y1="${cy + r}" y2="${XPT + ph}" stroke="${XT[gr.type].c}" stroke-dasharray="2 3" opacity=".6"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${on ? r + 1.5 : r}" fill="${XT[gr.type].c}" stroke="var(--dv-surface)" stroke-width="2"/>`;
    if (r >= 6.5) s += `<g transform="translate(${cx - r * .6} ${cy - r * .6}) scale(${r * 1.2 / 24})" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${XI[gr.type]}</g>`;
    if (gr.n > 1) s += `<text class="cnt" x="${cx + r + 3}" y="${cy + 3.5}" fill="${XT[gr.type].c}">${gr.n}</text>`;
  });
  return s + '</svg>';
}
function xpDraw() {
  const box = $hm('xp-chart');
  if (!box || !XP.g) return;
  $hm('xp-svg').innerHTML = xpSvg(Math.max(320, box.clientWidth));
}
function xBucketLabel(i) {
  const g = XP.g, line = g.line;
  if (!line) {
    const t0 = g.edges[i], t1 = g.edges[i + 1], d = new Date(t0);
    if (g.unit === 'hour') return `${hmClock(t0)}–${hmClock(t1)}`;
    if (g.unit === 'day') return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
  }
  const t0 = g.start + i * g.step, d = new Date(t0);
  return XP.range === '1y' ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : `${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}, ${hmClock(t0)}`;
}
function xpTip(i, x) {
  const tip = $hm('xp-tip'), g = XP.g;
  if (!tip || !g) return;
  const T = XTABS[XP.tab], v = i == null ? null : g.vals[i];
  if (i == null || v == null) { tip.hidden = true; return; }
  const evs = xEvIn(i);
  const val = g.line ? `<div class="xp-tv"><i class="dot" style="color:${T.c}"></i>${T.n}<b>${T.fmt(v)}</b></div>` : `<div class="xp-tv"><i class="dot" style="color:var(--dv-c2)"></i>Сообщений<b>${hmFmt(v)}</b></div>`;
  const over = T.lim && v > T.lim ? `<div class="xp-over">выше нормы на ${hmFmt(v - T.lim)} мс</div>` : '';
  tip.innerHTML = `<div class="xp-th">${xBucketLabel(i)}</div>${val}${over}${evs.length ? xEvTip(evs.slice(0, 3)) : ''}${evs.length > 3 ? `<div class="dv-sub" style="margin-top:6px">и ещё ${evs.length - 3}</div>` : ''}`;
  tip.hidden = false;
  const bw = $hm('xp-chart').clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.max(0, Math.min(bw - tw, x + 16 + tw > bw ? x - 16 - tw : x + 16)) + 'px';
}
function xIndexAt(x) {
  const g = XP.g, w = $hm('xp-chart').clientWidth, pw = w - XPL - XPR;
  if (!g || x < XPL - 4 || x > XPL + pw + 4) return null;
  const i = g.line ? Math.round((x - XPL) / pw * g.n) : Math.floor((x - XPL) / (pw / g.n)), ii = Math.max(0, Math.min(g.n - 1, i));
  return g.vals[ii] == null ? null : ii;
}
function xSetHover(i, x, fromList) {
  if (XP.hover === i && !fromList) { if (i != null) xpTip(i, x); return; }
  XP.hover = i; xpDraw();
  document.querySelectorAll('.xp-ev').forEach(el => el.classList.toggle('on', i != null && +el.dataset.idx === i));
  if (fromList) { const g = XP.g, pw = $hm('xp-chart').clientWidth - XPL - XPR; xpTip(i, i == null ? 0 : (g.line ? XPL + i / g.n * pw : XPL + (i + .5) * pw / g.n)); }
  else xpTip(i, x);
}
function xpList() {
  const g = XP.g, el = $hm('xp-list'); if (!g || !el) return;
  const list = XP.events.filter(e => XP.types[e.type] && e.t >= g.start && e.t <= XP.now).sort((a, b) => b.t - a.t), shown = XP.all ? list : list.slice(0, 6);
  el.innerHTML = `<h4>События за период · ${list.length}${list.length > 6 ? `<button type="button" data-xall>${XP.all ? 'Свернуть' : 'Показать все'}</button>` : ''}</h4>`
    + (list.length ? `<div class="xp-grid">${shown.map(e => `<div class="xp-ev" data-idx="${xEvIdx(e)}"><span class="tm">${xWhen(e.t, true)}</span><span class="xp-tei" style="background:${XT[e.type].c}">${xi(e.type, 10)}</span><div><b>${esc(e.title)}</b> <span class="tx">${esc(e.text)}</span>${e.meta ? `<small>${esc(e.meta)}</small>` : ''}</div></div>`).join('')}</div>`
      : '<div class="dv-empty">В этом периоде событий нет или они скрыты выше</div>');
}

// События мыши и клавиатуры главной (одни обработчики на документ; работают только пока открыта главная)
document.addEventListener('click', e => {
  if (currentPage !== 'dashboard') return;
  const t = e.target.closest?.('[data-xk],[data-xtab],[data-xrange],[data-xclose],[data-xtype],[data-xall]');
  if (!t) return;
  const d = t.dataset;
  if (d.xk) return xpOpen(d.xk);
  if (d.xtab) { XP.tab = d.xtab; XP.hover = null; XP.g = null; document.querySelectorAll('.xp-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.xtab === XP.tab))); xpClear(); return xpLoad(); }
  if (d.xrange) { XP.range = d.xrange; XP.hover = null; XP.g = null; XP.all = false; try { localStorage.setItem('hm-msg-range', XP.range); } catch {} document.querySelectorAll('[data-xrange]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.xrange === XP.range))); xpClear(); return xpLoad(); }
  if ('xclose' in d) return xpClose();
  if (d.xtype) { XP.types[d.xtype] = !XP.types[d.xtype]; XP.hover = null; return xpRender(); }
  if ('xall' in d) { XP.all = !XP.all; return kzMorph(xpList); }
});
// пока грузится другой период, старый график не показываем
function xpClear() { const tp = $hm('xp-tip'); if (tp) tp.hidden = true; const s = $hm('xp-svg'); if (s) s.style.opacity = '.35'; setTimeout(() => { const s2 = $hm('xp-svg'); if (s2) s2.style.opacity = ''; }, 260); }
document.addEventListener('keydown', e => {
  if (currentPage !== 'dashboard') return;
  if (e.key === 'Escape' && XP.open && !document.querySelector('.modal-bg.open')) xpClose();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-xk]')) { e.preventDefault(); xpOpen(e.target.dataset.xk, e.target); }
});
document.addEventListener('mousemove', e => {
  if (currentPage !== 'dashboard') return;
  const box = $hm('xp-chart');
  if (XP.open && box && XP.g) {
    const r = box.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { const x = e.clientX - r.left; xSetHover(xIndexAt(x), x); }
    else if (XP.hover != null && !e.target.closest?.('.xp-ev')) xSetHover(null, 0);
    const ev = e.target.closest?.('.xp-ev');
    if (ev) { const i = +ev.dataset.idx; if (XP.hover !== i) xSetHover(i, 0, true); }
  }
  const m = e.target.closest?.('.xk-tlm'); let tip = $hm('xk-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'xk-tip'; tip.className = 'xp-tip fixed'; document.body.appendChild(tip); }
  if (m) {
    let a = []; try { a = JSON.parse(m.dataset.xev); } catch {}
    tip.innerHTML = xEvTip([{ type: a[0], title: a[1], text: a[2], meta: a[3], t: a[4] }]); tip.style.display = 'block';
    const b = m.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, b.left + b.width / 2 - tip.offsetWidth / 2)) + 'px'; tip.style.top = (b.bottom + 10) + 'px';
  } else tip.style.display = 'none';
});


async function renderDashboard() {
  hmStopMonitor();
  const I = HM_ICON;
  setTopbarActions(`
    <button class="btn btn-ghost btn-sm" data-on-click="openCreateUser">${I.user}Создать пользователя</button>
    <button class="btn btn-ghost btn-sm" data-on-click="openCreateRoom">${I.room}Создать комнату</button>
    <button class="btn btn-ghost btn-sm" data-on-click="openAnnouncementModal">${I.ann}Объявление</button>
  `);
  document.getElementById('page-body').innerHTML = `
  <div class="hm dv" id="hm">
    <section class="hm-panel xh" id="hm-upd-panel" aria-label="Сервер" aria-live="polite"></section>

    <div id="dv-kz"></div>

    <section class="hm-panel dv-card fdv" id="dv-fed" aria-label="Федерация" hidden></section>

    <div class="dv-main">
      <section class="hm-panel dv-card xs" id="dv-swap" aria-live="polite"></section>
      <section class="hm-panel dv-card" aria-labelledby="dv-h-chron">
        <h3 id="dv-h-chron">Хроника</h3>
        <div class="dv-chron" id="dv-chron"><div class="dv-empty">Загрузка…</div></div>
      </section>
    </div>

    <div class="dv-bottom" id="dv-bottom">
      <section class="hm-panel dv-card" aria-labelledby="dv-h-res">
        <h3 id="dv-h-res">Ресурсы</h3>
        <div id="dv-res"></div>
      </section>
      <section class="hm-panel dv-card" aria-labelledby="hm-h-svc" id="hm-svc-card">
        <div id="hm-svc-one">
        <h3 id="hm-h-svc"><span>Служба <span id="hm-unit">electron.service</span></span><span class="hm-pill muted" id="hm-svc-state">—</span></h3>
        <div class="dv-chips" style="margin:10px 0">
          <span class="dv-chip">Процессор<b id="hm-k-cpu">—</b></span>
          <span class="dv-chip">Память<b id="hm-k-mem">—</b></span>
          <span class="dv-chip">Задач<b id="hm-k-tasks">—</b></span>
        </div>
        <div class="dv-sub dv-svc-since" id="hm-svc-since">&nbsp;</div>
        <div style="margin-top:12px"><button class="btn btn-danger btn-sm" data-on-click="restartService">Перезапустить</button></div>
        </div>
        <div id="hm-svc-many" hidden>
          <h3 id="hm-h-svcs">Службы</h3>
          <table class="dv-tbl"><thead><tr><th>Служба</th><th>Проц.</th><th>Память</th><th><span class="dv-vh">Перезапуск</span></th></tr></thead><tbody>
            <tr><td><span class="dv-dot" id="hm-m-el-dot"></span>electron</td><td class="hm-mono" id="hm-m-el-cpu">—</td><td class="hm-mono" id="hm-m-el-mem">—</td>
              <td><button type="button" class="dv-ib" id="hm-m-el-btn" data-on-click="restartService" title="Перезапустить electron" aria-label="Перезапустить electron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg></button></td></tr>
            <tr><td><span class="dv-dot" id="hm-m-pg-dot"></span>postgresql</td><td class="hm-mono" id="hm-m-pg-cpu">—</td><td class="hm-mono" id="hm-m-pg-mem">—</td>
              <td><button type="button" class="dv-ib" id="hm-m-pg-btn" data-on-click="restartPostgres" title="Перезапустить postgresql" aria-label="Перезапустить postgresql"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg></button></td></tr>
          </tbody></table>
          <div class="dv-sub dv-m-sub" id="hm-m-sub">&nbsp;</div>
        </div>
      </section>
      <section class="hm-panel dv-card" aria-labelledby="hm-h-store">
        <h3 id="hm-h-store">Хранилище <span class="dv-sub" style="margin-left:auto;font-weight:500" id="hm-store-total"></span></h3>
        <div class="dv-sub" id="hm-store-sub" style="margin:2px 0 10px">&nbsp;</div>
        <div id="hm-store"></div>
        <div id="hm-store-list" style="margin-top:8px"></div>
      </section>
      <section class="hm-panel dv-card dv-db" id="dv-db" aria-labelledby="dv-h-db" hidden>
        <h3 id="dv-h-db"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--dv-accent);flex:none"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg><span>PostgreSQL <span class="dv-sub" id="dv-db-ver"></span></span><span class="hm-pill muted" id="dv-db-state" style="margin-left:auto">—</span></h3>
        <div class="dv-sub" id="dv-db-line">&nbsp;</div>
        <div class="dv-db-big"><b class="hm-mono" id="dv-db-conn">—</b><small id="dv-db-max">соединений</small></div>
        <div class="dv-db-spark" id="dv-db-spark"></div>
        <div class="dv-store-bar dv-db-bar"><span id="dv-db-p0" style="background:var(--dv-c1)"></span><span id="dv-db-p1" style="background:var(--dv-c2)"></span><span id="dv-db-p2" style="background:var(--dv-c3)"></span><span id="dv-db-p3" style="background:var(--dv-c4)"></span></div>
        <div class="dv-leg2">
          <div><i style="background:var(--dv-c1)"></i><span>Статусы</span><b class="hm-mono" id="dv-db-v0">—</b></div>
          <div><i style="background:var(--dv-c2)"></i><span>Сообщения</span><b class="hm-mono" id="dv-db-v1">—</b></div>
          <div><i style="background:var(--dv-c3)"></i><span>Поиск</span><b class="hm-mono" id="dv-db-v2">—</b></div>
          <div><i style="background:var(--dv-c4)"></i><span>Прочее</span><b class="hm-mono" id="dv-db-v3">—</b></div>
        </div>
      </section>
    </div>
  </div>`;

  XP.open = false; XP.g = null; clearTimeout(HOST.hideT); HOST.st = 'idle';
  hmUpdIdle(true);
  dvMount();
  fdvStart();
  swRender();
  if (SW.tab === 'heat') swLoadHeat();
  HM.ro?.disconnect();
  HM.ro = new ResizeObserver(() => { if (XP.open) xpDraw(); });
  HM.ro.observe($hm('hm'));
  updateNavBadges();
  if (!CL.clients?.length) loadClients();
  swLoadLag();
  await Promise.all([hmLoadOverview(), hmLoadMonitor(true)]);
  hmStartMonitor();
}

// ── Обновление сервера ──
// Проверка: /server/version. Установка: /server/update запускает update.sh отдельной
// службой, тот пишет шаги в файл, мы читаем их через /server/update-status. Успех —
// когда сервер вернулся и сам сообщает, что работает новая версия.
// Всё это происходит внутри верхней панели сервера, её высота не меняется: содержимое лежит слоями,
// при смене состояния старый слой уходит вверх и гаснет, новый поднимается снизу. Ход установки
// обновляет только полосу, проценты и подпись.
const HM_STEPS = [['fetch', 'Загрузка с GitHub'], ['deps', 'Установка зависимостей'], ['build', 'Сборка'], ['restart', 'Перезапуск службы'], ['verify', 'Проверка версии']];
const HOST = { st: 'idle', msg: '', sub: '', pct: 0, hideT: null };

function hmSpecText(o) {
  const disk = o.storage?.disk;
  return [o.host.os, `${o.host.cores} ${hmPlural(o.host.cores, 'ядро', 'ядра', 'ядер')}`, `${hmBytes(o.host.memTotal, 0)} ОЗУ`, disk ? `диск ${hmBytes(disk.total, 0)}` : null].filter(Boolean).join(' · ');
}
function xhState() {
  const st = HOST.st, u = HM.upd, v = u.check, o = HM.overview;
  const btn = (act, txt, cls = '') => `<button type="button" class="xh-btn ${cls}" data-xh="${act}">${txt}</button>`;
  switch (st) {
    case 'checking': return { t: 'Проверяю обновления…', s: 'Связываюсь с GitHub', tone: 'busy', ico: xi('upd', 22, 'currentColor', 2.2, 'xh-spin'), btn: '' };
    case 'uptodate': return { t: 'Установлена последняя версия', s: `${esc(v?.current || '')} · проверено в ${hmClock(u.checkedAt || Date.now())}`, tone: 'ok', ico: xi('chk', 22, 'currentColor', 2.6), btn: '' };
    case 'checkfail': return { t: 'Не удалось проверить', s: 'GitHub не ответил, попробуйте ещё раз', tone: 'wait', ico: xi('warn', 22, 'currentColor', 2.2), btn: btn('close', 'Закрыть') };
    case 'available': return { t: `Доступно обновление ${esc(v?.latest || '')}`, s: `Установлена ${esc(v?.current || '')} · связь пропадёт на 10–20 с`, tone: 'wait', ico: xi('up', 22, 'currentColor', 2.4), tip: v?.notes, btn: btn('later', 'Позже') + btn('install', `Обновить до ${esc(v?.latest || '')}`, 'pri') };
    case 'installing': return { t: `Обновление до ${esc(u.target || '')}`, s: HOST.sub, tone: 'busy', ico: xi('upd', 22, 'currentColor', 2.2, 'xh-spin'), btn: '' };
    case 'done': return { t: `Сервер обновлён до ${esc(u.target || '')}`, s: esc(HOST.msg), tone: 'ok', ico: xi('chk', 22, 'currentColor', 2.6), btn: '' };
    case 'failed': return { t: 'Обновление не удалось', s: esc(HOST.msg), tone: 'bad', ico: xi('warn', 22, 'currentColor', 2.2), btn: btn('close', 'Закрыть') };
    default: return { t: esc(o?.host.hostname || '—'), s: o ? esc(hmSpecText(o)) : '&nbsp;', tone: 'ok', ico: xi('srv', 22, 'currentColor', 2), btn: btn('check', 'Проверить обновления') };
  }
}
function xhHtml() {
  const T = xhState(), st = HOST.st, idle = st === 'idle', o = HM.overview, dot = HM.dot || { lv: 'muted', text: '' };
  const stat = (l, id, v, fl) => `<div class="xh-stat"><small>${l}</small><b class="hm-mono ${fl ? 'xh-flash' : ''}" id="${id}">${v}</b></div>`;
  const mid = idle ? `<div class="xh-stats">${stat('Работает', 'hm-uptime', o ? hmDuration(o.uptime) : '—')}${stat('Версия', 'hm-version', o ? esc(o.version) : '—', HM.upd.flash)}${stat('Подключений', 'hm-ws', hmFmt(HM.ws))}</div>`
    : st === 'installing' ? `<div class="xh-pw"><div class="xh-bar"><i id="xh-bar" style="width:${HOST.pct}%"></i></div><span class="hm-mono xh-pct" id="xh-pct">${HOST.pct}%</span></div>`
    : st === 'checking' ? '<div class="xh-pw"><div class="xh-bar ind"><i></i></div></div>' : '';
  return `<div class="xh-row"><span class="xh-ico ${T.tone}">${T.ico}</span><div class="xh-main"><div class="xh-t" ${T.tip ? `title="${esc(T.tip)}"` : ''}>${idle ? `<span id="hm-hostname">${T.t}</span><i class="xh-dot ${dot.lv}" id="hm-dot" title="${esc(dot.text)}"></i>` : T.t}</div><div class="xh-s" id="${idle ? 'hm-spec' : 'xh-sub'}">${T.s}</div></div>${mid}<div class="xh-act">${T.btn}</div></div>`;
}
function hostRender(first) {
  const hc = $hm('hm-upd-panel'); if (!hc) return;
  if (first) hc.innerHTML = '';
  [...hc.querySelectorAll(':scope > .xh-lay:not(.out)')].forEach(o => { o.classList.add('out'); setTimeout(() => o.remove(), 300); });
  const n = document.createElement('div'); n.className = 'xh-lay' + (first ? '' : ' in'); n.innerHTML = xhHtml();
  hc.appendChild(n);
}
function hostSet(st, msg) { clearTimeout(HOST.hideT); HOST.st = st; if (msg !== undefined) HOST.msg = msg; hostRender(); }
// Ход установки: меняем только значения, чтобы полоса ехала плавно и ничего не мигало
function hostProg() {
  const bar = $hm('xh-bar'); if (bar) bar.style.width = HOST.pct + '%';
  hmText('xh-pct', HOST.pct + '%');
  hmText('xh-sub', HOST.sub);
}
function hmSetDot() { const d = $hm('hm-dot'), x = HM.dot; if (d && x) { d.className = 'xh-dot ' + x.lv; d.title = x.text; } }

// События «найдено» и «начато» сразу попадают в хронику; завершение в ней и так есть (запуск службы)
function hmLocalEv(text, kind) {
  (HM.localEv ||= []).unshift({ t: Date.now(), text, kind });
  HM.localEv.length = Math.min(HM.localEv.length, 5);
  hmRenderChron();
}
function hmUpdDismiss() {
  if (HM.upd.busy) return;
  HM.upd.check = null;
  hostSet('idle');
}
// Вызывается при открытии главной и из меню (кнопка «↑ версия»): показывает ход, предложение или обычный вид
function hmUpdIdle(first) {
  if (!$hm('hm-upd-panel')) return;
  clearTimeout(HOST.hideT);
  HOST.st = HM.upd.busy ? 'installing' : HM.upd.check?.hasUpdate ? 'available' : 'idle';
  hostRender(first === true);
  if (HM.upd.busy) hmUpdRenderSteps();
}

async function hmUpdCheck() {
  if (HM.upd.busy || HOST.st === 'checking') return;
  HM.upd.done = false;
  hostSet('checking');
  const t0 = Date.now();
  const v = await hmGet('/api/admin/server/version');
  // Состояние «проверяю» не должно мелькать: показываем его не меньше секунды
  if (Date.now() - t0 < 1000) await new Promise(r => setTimeout(r, 1000 - (Date.now() - t0)));
  if (!$hm('hm') || HM.upd.busy) return;
  HM.upd.check = v;
  HM.upd.checkedAt = Date.now();
  if (v?.latest) { SB.upd = v; sbRender(); }
  if (!v?.latest) {
    hostSet('checkfail');
    HOST.hideT = setTimeout(() => { if (HOST.st === 'checkfail') hostSet('idle'); }, 7000);
    return;
  }
  if (!v.hasUpdate) {
    hostSet('uptodate');
    HOST.hideT = setTimeout(() => { if (HOST.st === 'uptodate') hostSet('idle'); }, 3000);
    return;
  }
  hmLocalEv('Найдено обновление сервера ' + v.latest, 'warn');
  hmUpdOffer(v);
}
function hmUpdOffer(v) { HM.upd.check = v; hostSet('available'); }

async function hmUpdInstall() {
  const target = HM.upd.check?.latest;
  if (HM.upd.busy || !target) return;
  Object.assign(HM.upd, { busy: true, target, from: HM.overview?.version || HM.upd.check.current, startedAt: Date.now(), status: null, down: false });
  hmLocalEv('Начато обновление сервера до ' + target, '');
  HOST.pct = 0; HOST.sub = 'Начинаю…';
  hostSet('installing');
  hmUpdRenderSteps();
  let r = null;
  try {
    const res = await fetch('/api/admin/server/update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ target }) });
    r = await res.json().catch(() => ({}));
  } catch { /* соединение оборвалось — сервер уже перезапускается, дальше опрос */ }
  if (r?.error) return hmUpdFinish(false, r.error);
  hmUpdPoll();
}

async function hmUpdPoll() {
  const u = HM.upd;
  while (u.busy) {
    await new Promise(res => setTimeout(res, 1500));
    if (Date.now() - u.startedAt > 5 * 60e3) {
      return hmUpdFinish(false, 'Обновление не подтвердилось за 5 минут. Журнал на сервере: journalctl -u electron-update');
    }
    const st = await hmGet('/api/admin/server/update-status');
    u.down = !st;
    if (st) u.status = st;
    hmUpdRenderSteps();
    if (!st) continue;
    if (st.result === 'failed') return hmUpdFinish(false, st.error || 'Обновление не удалось');
    if (st.result === 'uptodate') return hmUpdFinish(true, 'Обновлять нечего — сервер уже на последней версии');
    // running — версия самого процесса, а не файла: файл меняется ещё до перезапуска
    if (st.running === u.target) return hmUpdFinish(true);
  }
}

function hmUpdRenderSteps() {
  const u = HM.upd;
  const steps = { ...(u.status?.steps || {}) };
  const reported = !!u.status?.startedAt;
  if (u.status?.running === u.target) {
    // Сервер уже работает на новой версии — значит, загрузка и перезапуск точно прошли.
    // update.sh отмечает «перезапуск готов» только через пару секунд после старта службы,
    // и без этого шаг так и крутился бы рядом с галочкой проверки версии.
    for (const [k] of HM_STEPS) {
      if (steps[k]?.state === 'active' || (!steps[k] && (k === 'fetch' || k === 'restart'))) steps[k] = { state: 'done' };
    }
    steps.verify = { state: 'done' };
  } else if (steps.restart?.state === 'done' || (u.down && steps.fetch?.state === 'done')) steps.verify = { state: 'active' };

  let finished = 0, cur = null;
  for (const [k] of HM_STEPS) {
    const st = steps[k]?.state || '';
    if (st === 'done' || st === 'skipped') finished++;
    else if (!cur && (st === 'active' || st === 'failed')) cur = k;
  }
  if (!cur) cur = (HM_STEPS.find(([k]) => !['done', 'skipped'].includes(steps[k]?.state)) || HM_STEPS[HM_STEPS.length - 1])[0];
  const pct = Math.round(finished / HM_STEPS.length * 100);
  const name = HM_STEPS.find(([k]) => k === cur)[1];
  const note = u.down ? 'Сервер перезапускается, страница подключится сама'
    : !reported && Date.now() - u.startedAt > 6000 ? 'Сервер не сообщает шаги установки, ждём его возвращения с новой версией' : '';
  u.pct = pct;
  HOST.pct = pct; HOST.sub = note || `${name} · ${pct}%`;
  if (HOST.st !== 'installing') hostSet('installing'); else hostProg();
  sbRender();
}

function hmUpdFinish(ok, message) {
  const u = HM.upd;
  u.busy = false;
  u.done = ok;
  u.check = ok ? { current: u.target, latest: u.target, hasUpdate: false } : null;
  u.checkedAt = Date.now();
  if (ok) SB.upd = u.check;
  sbLoad();
  if (ok) {
    hostSet('done', message || 'Служба перезапущена, подключения восстановлены');
    toast(esc(message || 'Сервер обновлён и перезапущен'), 'success');
    hmLoadOverview();
    // Итог держится несколько секунд, потом панель плавно возвращается к обычному виду, уже с новой версией
    HOST.hideT = setTimeout(() => {
      if (HOST.st !== 'done') return;
      u.flash = true; hostSet('idle');
      setTimeout(() => { u.flash = false; }, 3200);
    }, 3800);
  } else {
    hostSet('failed', message);
    toast(esc(message), 'error');
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-xh]');
  if (!b || !b.closest('#hm-upd-panel')) return;
  const a = b.dataset.xh;
  if (a === 'check') hmUpdCheck();
  else if (a === 'install') hmUpdInstall();
  else hmUpdDismiss();
});


/* ── ГЛАВНАЯ: БЛОК РЯДОМ С ХРОНИКОЙ ── */
// Четыре вида на выбор (вкладки в шапке блока), выбранный запоминается в браузере:
//   Внимание — что стоит проверить, по важности и с кнопкой действия;
//   В сети — кто сейчас в сети и на какой версии клиента;
//   Клиенты — версии и платформы подключённых клиентов;
//   Активность — тепловая карта «когда пишут» по дням недели и часам.
const SWK = 'adm-home-block', SWT = { att: 'Внимание', who: 'В сети', ver: 'Клиенты', heat: 'Активность' };
const SW = { tab: 'att', all: false, lag: null, lagAt: 0, heat: null, heatAt: 0, busy: false };
try { const s = localStorage.getItem(SWK); if (SWT[s]) SW.tab = s; } catch {}

async function swLoadLag() {
  if (Date.now() - SW.lagAt < 60e3) return;
  SW.lagAt = Date.now();
  const m = await hmGet('/api/admin/metrics?range=24h');
  if (m) { SW.lag = m; swRender(); }
}
async function swLoadHeat() {
  if (SW.heat && Date.now() - SW.heatAt < 5 * 60e3) return;
  SW.heatAt = Date.now();
  const h = await hmGet(`/api/admin/heatmap?tz=${xTz()}`);
  if (h) { SW.heat = h; swRender(); }
}

// Что требует внимания: считаем из того, что уже знает главная
function swAttention() {
  const o = HM.overview, items = [], ok = [];
  const s = HM.samples[HM.samples.length - 1], svc = o?.service, disk = o?.storage?.disk, memTotal = hmMemTotal();
  if (svc && svc.state && svc.state !== 'active') items.push({ s: 'bad', t: `Служба ${esc(svc.unit || 'electron')}: ${esc(svc.state)}`, d: 'Служба сервера не работает в обычном режиме', b: 'Перезапустить', go: () => restartService() });
  else if (svc) ok.push('Служба работает');
  if (disk) {
    const p = Math.round((disk.total - disk.free) / disk.total * 100);
    if (p >= 80) items.push({ s: p >= 90 ? 'bad' : 'warn', t: `Диск заполнен на ${p}%`, d: `Свободно ${hmBytes(disk.free)} из ${hmBytes(disk.total, 0)}`, b: 'Файлы', go: () => nav('files') });
    else ok.push(`Диск ${p}%`);
  }
  if (s) {
    const mp = Math.round(s[3] / memTotal * 100);
    if (mp >= 80) items.push({ s: mp >= 90 ? 'bad' : 'warn', t: `Память занята на ${mp}%`, d: `Свободно ${hmBytes(Math.max(0, memTotal - s[3]))} из ${hmBytes(memTotal, 0)}` });
    else ok.push(`Память ${mp}%`);
    if (s[1] >= 85) items.push({ s: s[1] >= 95 ? 'bad' : 'warn', t: `Процессор загружен на ${hmFmt(s[1])}%`, d: 'Высокая нагрузка держится прямо сейчас', b: 'Показать график', go: () => xpOpen('cpu') });
    else ok.push('Процессор в норме');
  }
  if (SW.lag) {
    const v = SW.lag.lag, runs = hmOverRuns(v, LAG_LIM);
    if (runs.length) {
      const tot = runs.reduce((a, [x, y]) => a + (y - x + 1) * SW.lag.step, 0), lastEnd = SW.lag.start + (runs[runs.length - 1][1] + 1) * SW.lag.step;
      const recent = v.slice(-8).some(x => x != null && x > LAG_LIM);
      items.push({ s: recent ? 'bad' : 'warn', t: 'Отклик сервера выходил за норму', d: `${runs.length} ${hmPlural(runs.length, 'раз', 'раза', 'раз')} за сутки, около ${hmDurText(tot)}, последний раз в ${hmClock(Math.min(lastEnd, Date.now()))}`, b: 'Показать график', go: () => { XP.range = '24h'; xpOpen('lag'); } });
    } else ok.push('Отклик в норме');
  }
  const ver = swVersions();
  if (ver.old.length) items.push({ s: 'warn', t: `Клиенты на старой версии: ${ver.old.length} из ${ver.electron}`, d: `Актуальная ${esc(CL.latest)}. Обновление ставится по подтверждению`, b: 'Обновить', go: () => clUpdate(ver.old.map(c => c.connId)) });
  else if (ver.electron) ok.push('Клиенты обновлены');
  const bk = o?.storage?.backups;
  if (bk) {
    const days = bk.latest ? Math.floor((Date.now() - bk.latest) / 86400e3) : null;
    if (!bk.count) items.push({ s: 'warn', t: 'Резервных копий нет', d: 'Сделайте первую копию, чтобы было откуда восстановиться', b: 'Создать сейчас', go: swBackup });
    else if (days >= 7) items.push({ s: 'warn', t: 'Давно не было резервной копии', d: `Последняя ${days} ${hmPlural(days, 'день', 'дня', 'дней')} назад`, b: 'Создать сейчас', go: swBackup });
    else ok.push('Копии свежие');
  }
  if (SB.upd?.hasUpdate && !HM.upd.busy) items.push({ s: 'info', t: `Доступно обновление сервера ${esc(SB.upd.latest)}`, d: `Установлена ${esc(SB.upd.current)}`, b: 'Обновить сервер', go: () => { HM.upd.check = SB.upd; hmUpdIdle(); document.getElementById('page-body')?.scrollTo({ top: 0, behavior: 'smooth' }); } });
  const rank = { bad: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.s] - rank[b.s]);
  return { items, ok };
}
// Версии клиентов Electron и устаревшие среди них (список клиентов обновляется отдельным опросом)
function swVersions() {
  const all = CL.clients || [], electron = all.filter(c => !clIsWeb(c) && clVerOk(c.clientVersion));
  return { all, electron: electron.length, old: CL.latest ? electron.filter(clOutdated) : [], web: all.filter(clIsWeb).length };
}
async function swBackup() {
  if (SW.busy) return;
  SW.busy = true; toast('Создаю резервную копию…', 'info');
  const r = await api('POST', '/api/admin/backups');
  SW.busy = false;
  if (r?.error) return toast(esc(r.error), 'error');
  toast('Резервная копия создана', 'success');
  hmLoadOverview();
}

const SW_SEV = { bad: 'var(--dv-bad)', warn: 'var(--dv-warn)', info: 'var(--dv-c2)' };
const SW_SYM = { bad: '!', warn: '!', info: 'i' };
function swBody(att) {
  if (SW.tab === 'att') {
    const { items, ok } = att, shown = SW.all ? items : items.slice(0, 4);
    const list = items.length
      ? `<div class="xs-att">${shown.map((i, k) => `<div class="xs-ar"><span class="xs-ai" style="background:${SW_SEV[i.s]}">${SW_SYM[i.s]}</span><div class="xs-m"><b>${i.t}</b><div class="dv-sub">${i.d}</div></div>${i.b ? `<button type="button" class="btn" data-sw-go="${k}">${i.b}</button>` : ''}</div>`).join('')}</div>${items.length > 4 ? `<button type="button" class="xs-lnk" data-sw-all>${SW.all ? 'Свернуть' : 'Ещё ' + (items.length - 4)}</button>` : ''}`
      : `<div class="xs-calm"><span class="xs-ai" style="background:var(--dv-ok)">✓</span><div><b>Всё в порядке</b><div class="dv-sub">Клиенты обновлены, копии свежие, отклик в норме</div></div></div>`;
    return list + `<div class="dv-chips xs-bt">${ok.map(x => `<span class="dv-chip"><span style="color:var(--dv-ok)">✓</span> ${esc(x)}</span>`).join('')}</div>`;
  }
  if (SW.tab === 'who') {
    const o = HM.overview?.online || [];
    if (!o.length) return '<div class="dv-empty">Сейчас в сети никого нет</div>';
    const rows = o.slice(0, 12).map(p => {
      const c = p.clients[0] || {}, web = !c.version || c.version === 'web' || /^(Web|PWA)$/i.test(c.hostname || ''), more = p.clients.length - 1;
      const old = !web && CL.latest && clGt(CL.latest, c.version);
      const plat = web ? 'Веб-клиент' : `${uxOsName(c.platform) || '—'} · ${esc(c.version || '')}`;
      return `<div class="xs-pr">${avHtml(p.name, 30, 15, p.id, false, p.has_avatar)}<div class="xs-m"><b>${esc(p.name)}</b><div class="dv-sub">${plat}${more > 0 ? ` +${more}` : ''}</div></div>${old ? '<span class="xs-badge">есть новее</span>' : `<span class="hm-mono dv-sub">с ${hmClock(p.since)}</span>`}</div>`;
    }).join('');
    return `<div class="xs-pgrid">${rows}</div><div class="xs-foot"><span class="dv-sub">${o.length > 12 ? `и ещё ${o.length - 12} ${hmPlural(o.length - 12, 'человек', 'человека', 'человек')}` : ''}</span><button type="button" class="xs-lnk" data-sw-nav="users">Все пользователи →</button></div>`;
  }
  if (SW.tab === 'ver') {
    const v = swVersions();
    if (!v.all.length) return '<div class="dv-empty">Клиентов сейчас нет в сети</div>';
    const byV = new Map(); v.all.filter(c => !clIsWeb(c) && clVerOk(c.clientVersion)).forEach(c => byV.set(c.clientVersion, (byV.get(c.clientVersion) || 0) + 1));
    const rows = [...byV.entries()].sort((a, b) => clGt(a[0], b[0]) ? -1 : 1).map(([ver, n]) => [ver, n, ver === CL.latest ? 'var(--dv-ok)' : 'var(--dv-warn)', ver === CL.latest ? 'актуальная' : '']);
    if (v.web) rows.push(['Веб', v.web, 'var(--dv-c4)', '']);
    const mx = Math.max(...rows.map(r => r[1]), 1);
    const plat = new Map(); v.all.forEach(c => plat.set(clPlatName(c), (plat.get(clPlatName(c)) || 0) + 1));
    const pl = [...plat.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="xs-vers">${rows.slice(0, 6).map(r => `<div class="xs-vb"><span class="hm-mono">${esc(r[0])}</span><div class="dv-meter"><i style="width:${r[1] / mx * 100}%;background:${r[2]}"></i></div><b class="hm-mono">${r[1]}</b><span class="dv-sub">${r[3]}</span></div>`).join('')}</div>
      <div class="dv-lbl" style="margin:14px 0 8px">Платформы</div><div class="dv-store-bar">${pl.map(([n, c]) => `<span style="flex:${c};background:${CL_PLAT_COLOR[n] || 'var(--dv-c4)'}" title="${esc(n)}: ${c}"></span>`).join('')}</div>
      <div class="dv-chips">${pl.map(([n, c]) => `<span class="dv-chip"><i class="xs-sq" style="background:${CL_PLAT_COLOR[n] || 'var(--dv-c4)'}"></i>${esc(n)}<b>${c}</b></span>`).join('')}</div>
      ${v.old.length ? `<div class="xs-bt"><button type="button" class="btn" data-sw-upd>Обновить устаревшие (${v.old.length})</button></div>` : ''}`;
  }
  const h = SW.heat;
  if (!h) return '<div class="dv-empty">Загрузка…</div>';
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const best = (() => { let b = [0, 0, 0]; h.matrix.forEach((r, d) => r.forEach((v, hh) => { if (v > b[2]) b = [d, hh, v]; })); return b; })();
  return `<div class="xs-heat"><span></span>${Array.from({ length: 24 }, (_, i) => `<span style="text-align:center">${i % 3 === 0 ? hmPad(i) : ''}</span>`).join('')}${
    h.matrix.map((r, d) => `<span>${days[d]}</span>${r.map((v, i) => `<i title="${days[d]}, ${hmPad(i)}:00 — ${hmFmt(v, 1)} в час в среднем" style="opacity:${(.07 + v / h.max * .93).toFixed(2)}"></i>`).join('')}`).join('')}</div>
    <div class="dv-sub" style="margin-top:8px">${best[2] ? `Самое оживлённое время: ${['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'][best[0]]}, ${hmPad(best[1])}:00–${hmPad((best[1] + 1) % 24)}:00. ` : ''}Среднее число сообщений в час за ${h.days} дней.</div>`;
}
function swRender() {
  const el = $hm('dv-swap'); if (!el) return;
  const att = swAttention(); SW.items = att.items;
  const nAtt = att.items.filter(i => i.s !== 'info').length;
  // счётчик на «Главной» в нижней панели телефонного вида: сколько всего требует внимания
  const mb = document.getElementById('mn-b-dash'); if (mb) { mb.textContent = nAtt; mb.hidden = !nAtt; }
  const titles = { att: 'Требует внимания', who: 'Сейчас в сети', ver: 'Версии клиентов', heat: 'Когда пишут' };
  const body = swBody(att);
  const html = `<div class="xs-head"><h3>${titles[SW.tab]}</h3><div class="xp-seg xs-seg" role="tablist" aria-label="Что показывать в этом блоке">${Object.entries(SWT).map(([k, n]) => `<button type="button" role="tab" aria-selected="${SW.tab === k}" aria-pressed="${SW.tab === k}" data-sw="${k}">${n}${k === 'att' && nAtt ? `<i class="xs-cnt">${nAtt}</i>` : ''}</button>`).join('')}</div></div><div class="xs-body ${SW.tab === 'att' && SW.all ? 'open' : ''}">${body}</div>`;
  if (el._h !== html) { el._h = html; el.innerHTML = html; }
}
document.addEventListener('click', e => {
  if (currentPage !== 'dashboard') return;
  const b = e.target.closest?.('[data-sw],[data-sw-go],[data-sw-all],[data-sw-nav],[data-sw-upd]');
  if (!b || !b.closest('#dv-swap')) return;
  const d = b.dataset;
  if (d.sw) { SW.tab = d.sw; try { localStorage.setItem(SWK, SW.tab); } catch {} if (SW.tab === 'heat') swLoadHeat(); return swRender(); }
  if (d.swGo != null) return SW.items?.[+d.swGo]?.go?.();
  if ('swAll' in d) { SW.all = !SW.all; return swRender(); }
  if (d.swNav) return nav(d.swNav);
  if ('swUpd' in d) return clUpdate(swVersions().old.map(c => c.connId));
});

/* ── ROOMS ── */
// Раздел «Комнаты»: сводка, фильтры, таблица. Окно комнаты — вкладки «Основное · Темы ·
// Участники»; всё применяется по «Сохранить», чтобы можно было передумать до записи.

const RM = { filter: 'all', q: '', sort: 'name', open: new Set(), fresh: null, sel: new Set(), form: null, dragFrom: null };
const rmSvg = p => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const RM_I = {
  plus: rmSvg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  users: rmSvg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  topics: rmSvg('<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>'),
  img: rmSvg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  x: rmSvg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  clear: rmSvg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
};
const rmFmt = n => Number(n || 0).toLocaleString('ru-RU');
const rmMsgs = n => `${rmFmt(n)} ${uxPlural(n, 'сообщение', 'сообщения', 'сообщений')}`;
const rmLast = ts => ts ? uaSeen(ts) : 'сообщений нет';
// Участники — с настоящими фото: avHtml показывает фото, а под ним буквы на случай, если его нет
const rmStack = (members, max = 4) => members.length
  ? `<span class="rm-stack">${members.slice(0, max).map(m => avHtml(m.name, 24, 7, m.id, false, m.has_avatar)).join('')}${members.length > max ? `<span class="more">+${members.length - max}</span>` : `<span class="more">${members.length}</span>`}</span>`
  : '<span class="rm-sub">никого</span>';
const rmSpark = w => `<span class="rm-spark" title="Сообщения по дням за неделю: ${w.join(', ')}">${w.map(n => `<i style="height:${Math.max(1, Math.round(n / Math.max(1, ...w) * 16))}px"></i>`).join('')}</span>`;
const rmWeek = r => r.week.reduce((a, b) => a + b, 0);

async function renderRooms() {
  const [chats, users] = await Promise.all([api('GET', '/api/admin/chats'), api('GET', '/api/admin/users'), wsLoad()]);
  allUsersCache = users;
  // У комнаты считаем и её темы: сообщения, последнее сообщение, активность за неделю
  const topics = chats.filter(c => c.type === 'room' && c.parent_id);
  allRooms = chats.filter(c => c.type === 'room' && !c.parent_id).map(r => {
    const own = topics.filter(t => t.parent_id === r.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    const all = [r, ...own];
    return { ...r, topics: own, msgs: all.reduce((s, c) => s + c.message_count, 0),
      last: Math.max(0, ...all.map(c => c.last_at || 0)) || null,
      week: [0, 1, 2, 3, 4, 5, 6].map(i => all.reduce((s, c) => s + (c.week?.[i] || 0), 0)) };
  });
  const ids = new Set(allRooms.map(r => r.id));
  RM.sel.forEach(id => { if (!ids.has(id)) RM.sel.delete(id); });
  rmRender();
}

// Присутствие участников комнаты: по статусам пользователей (в сети, отошёл, не в сети) и блокировкам
const rbShort = n => String(n || '').replace(/^Кабинет №\d+ /, '');
const rbDays = () => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function rbPresence(r, U) {
  const names = [], away = [], banned = [];
  (r.members || []).forEach(m => {
    const u = U.get(m.id);
    if (!u) return;
    if (u.banned) banned.push(m.name);
    else if (u.status === 'online') names.push(m.name);
    else if (u.status === 'away') away.push(m.name);
  });
  const n = (r.members || []).length, off = n - names.length - away.length - banned.length;
  return { on: names, away, banned, off, n };
}
function rbPresHtml(p) {
  const shown = p.on.slice(0, 2).map(rbShort), more = p.on.length - shown.length;
  const tip = [p.on.length ? `В сети: ${p.on.join(', ')}` : '', p.away.length ? `Отошли: ${p.away.join(', ')}` : '', p.banned.length ? `Заблокированы: ${p.banned.join(', ')}` : ''].filter(Boolean).join('\n') || 'Никого в сети';
  const text = p.on.length ? `<b>${p.on.length}</b> из ${p.n} · ${shown.map(esc).join(', ')}${more > 0 ? ` +${more}` : ''}` : `<span>${p.away.length ? '' : 'никого в сети'}</span>`;
  return `<div class="rb-pres" title="${esc(tip)}"><div class="rb-pb">${p.on.length ? `<i style="flex:${p.on.length};background:var(--c-green)"></i>` : ''}${p.away.length ? `<i style="flex:${p.away.length};background:var(--c-orange)"></i>` : ''}${p.off ? `<i style="flex:${p.off};background:var(--c-muted);opacity:.45"></i>` : ''}${p.banned.length ? `<i style="flex:${p.banned.length};background:var(--c-red)"></i>` : ''}</div>
    <div class="rb-pt">${text}${p.away.length ? ` <span style="color:var(--c-orange-text)">· ${p.away.length} отошёл</span>` : ''}${p.banned.length ? ` <span class="bl">· ${p.banned.length} заблок.</span>` : ''}</div></div>`;
}
const rbWk = w => { const mx = Math.max(1, ...w); return `<span class="rb-wk" title="Сообщения по дням за неделю: ${w.join(', ')}">${w.map(n => `<i class="${n ? '' : 'z'}" style="height:${Math.max(2, Math.round(n / mx * 22))}px"></i>`).join('')}</span>`; };

function rmRender() {
  if (currentPage !== 'rooms') return;
  const page = document.getElementById('page-body');
  const U = new Map((allUsersCache || []).map(u => [u.id, u]));
  const q = RM.q.trim().toLowerCase();
  const quiet = r => rmWeek(r) === 0;
  const rows = allRooms
    .filter(r => RM.filter === 'all' || (RM.filter === 'topics' && r.topics.length) || (RM.filter === 'plain' && !r.topics.length) || (RM.filter === 'quiet' && quiet(r)))
    .filter(r => !q || (r.name || '').toLowerCase().includes(q) || r.topics.some(t => (t.name || '').toLowerCase().includes(q)))
    // По имени, с учётом чисел: «Кабинет 2» раньше «Кабинет 21»
    .sort((a, b) => (RM.sort === 'act' ? rmWeek(b) - rmWeek(a) : 0) || (a.name || '').localeCompare(b.name || '', 'ru', { numeric: true }));
  const n = { all: allRooms.length, topics: allRooms.filter(r => r.topics.length).length, plain: allRooms.filter(r => !r.topics.length).length, quiet: allRooms.filter(quiet).length };
  const topicsTotal = allRooms.reduce((s, r) => s + r.topics.length, 0);
  const people = new Set(allRooms.flatMap(r => (r.members || []).map(m => m.id)));
  const online = [...people].filter(id => U.get(id)?.status === 'online' && !U.get(id)?.banned).length;
  const wt = [0, 1, 2, 3, 4, 5, 6].map(i => allRooms.reduce((s, r) => s + (r.week[i] || 0), 0)), wmax = Math.max(1, ...wt), wsum = wt.reduce((a, b) => a + b, 0);
  const today = new Date().getDay(), dn = rbDays();
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, count]) => `<button type="button" aria-pressed="${RM.filter === k}" data-on-click="rmFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${count}</span></button>`;
  const sortBtn = (k, label) => `<button type="button" aria-pressed="${RM.sort === k}" data-on-click="rmSort" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}</button>`;
  uxKeepFocus(() => {
    uxSet(page, `<div class="ub" id="rm-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Комнат</div><div class="ub-big">${n.all}<small>${n.topics ? `${n.topics} с темами` : 'без тем'}</small></div><div class="ub-sub">${n.plain} без тем · ${n.quiet} тихих</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Сейчас в сети</div><div class="ub-big">${online}<small>из ${people.size}</small></div><div class="ub-sub">участников комнат</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Тем</div><div class="ub-big">${topicsTotal}<small>в ${n.topics} ${uxPlural(n.topics, 'комнате', 'комнатах', 'комнатах')}</small></div><div class="ub-sub">${topicsTotal ? 'разговоры внутри комнат' : 'тем пока нет'}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Сообщений за неделю</div><div class="ub-big">${rmFmt(wsum)}<small>в комнатах</small></div>
          <div class="rb-bars">${wt.map((v, i) => `<div title="${dn[(today - 6 + i + 14) % 7]}: ${v}"><i class="${i === 6 ? 'cur' : ''}" style="height:${Math.max(2, Math.round(v / wmax * 26))}px"></i><span>${dn[(today - 6 + i + 14) % 7]}</span></div>`).join('')}</div></div>
      </div>
      <div class="ub-head"><h3>Комнаты <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', n.all], ['topics', 'С темами', n.topics], ['plain', 'Без тем', n.plain], ['quiet', 'Тихие', n.quiet]].map(flt).join('')}</div>
        <div class="ub-sort" role="group" aria-label="Сортировка">${sortBtn('name', 'По имени')}${sortBtn('act', 'По активности')}</div>
        ${uxSearch('rm-q', RM.q, 'Комната или тема', 'rmSearch')}</div>
      <div class="ub-rows">${rows.map(r => {
        const open = RM.open.has(r.id), p = rbPresence(r, U), mx = Math.max(1, ...r.topics.map(t => t.message_count || 0));
        return `<div class="rb-row" data-k="${r.id}"><div class="rb-top" data-on-click="rmTog" data-a-click="${esc(JSON.stringify(["__event", r.id]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть: ${esc(r.name)}">${UX_I.chev || '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'}</button>
          <div class="rb-name">${avHtml(r.name || '?', 38, 11, null, p.on.length ? true : false, r.has_avatar, r.id)}<div style="min-width:0"><div class="rb-nl"><b>${esc(r.name || '—')}</b>${r.topics.length ? `<span class="rb-chip">${r.topics.length} ${uxPlural(r.topics.length, 'тема', 'темы', 'тем')}</span>` : ''}${quiet(r) ? '<span class="rb-chip q">тихая</span>' : ''}${r.read_only ? '<span class="rb-chip ro">только чтение</span>' : ''}</div>
            <div class="rb-meta">${r.topics.length ? esc(r.topics.map(t => t.name).join(' · ')) : 'Без тем'}</div></div></div>
          ${rbPresHtml(p)}
          <div class="rb-act">${rbWk(r.week)}<div class="t"><b>${rmWeek(r)}</b> за неделю<small>${r.last ? 'последнее ' + esc(rmLast(r.last)) : 'сообщений нет'}</small></div></div>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" data-on-click="__h15" data-a-click="${esc(JSON.stringify([r.id]))}">${UX_I.edit}Изменить</button>
            <button class="ux-ibtn" aria-label="Ещё действия: ${esc(r.name)}" aria-haspopup="menu" aria-expanded="false" data-on-click="__h16" data-a-click="${esc(JSON.stringify([r.id]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="rb-exp${RM.fresh === r.id ? ' fresh' : ''}">
          <div><h4>Участники <span>${(r.members || []).length}</span></h4><div class="rb-pl">${(r.members || []).map(m => { const u = U.get(m.id), st = m.guest ? (m.status === 'online' ? ['в сети', 'on'] : m.status === 'away' ? ['отошёл', 'aw'] : m.online ? ['в сети', 'on'] : ['не в сети', '']) : u?.banned ? ['заблокирован', 'bn'] : u?.status === 'online' ? ['в сети', 'on'] : u?.status === 'away' ? ['отошёл', 'aw'] : ['не в сети', ''];
            return `<div class="rb-p">${avHtml(m.name, 24, 7, m.id, false, m.has_avatar)}<span class="nm">${esc(m.name)}</span>${u?.is_admin ? '<span class="adm">админ</span>' : ''}${m.guest ? '<span class="adm guest" title="Гость по ссылке: доступ закончится вместе со ссылкой">гость</span>' : ''}<span class="s ${st[1]}">${st[0]}</span></div>`; }).join('') || '<span class="rm-sub">никого</span>'}</div></div>
          <div><h4>Темы <span>${r.topics.length}</span></h4>${r.topics.map(t => `<div class="rb-tp"><span class="nm">${esc(t.name)}</span><div class="meter"><i style="width:${Math.round((t.message_count || 0) / mx * 100)}%"></i></div><span class="num">${rmFmt(t.message_count || 0)}</span></div>`).join('') || '<div class="rm-sub">Тем нет: комната работает как один общий чат</div>'}</div>
          <div><h4>Сводка</h4><div class="rb-kv"><div><span>Создана</span><b>${fmtDate(r.created_at)}</b></div><div><span>Сообщений всего</span><b>${rmFmt(r.msgs)}</b></div><div><span>Последнее</span><b>${esc(rmLast(r.last))}</b></div><div><span>Режим</span><b>${r.read_only ? 'только чтение' : 'можно писать всем'}</b></div></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px"><button class="btn btn-ghost btn-sm" data-on-click="rmOpen" data-a-click="${esc(JSON.stringify([r.id, "members"]))}">${RM_I.users}Участники</button><button class="btn btn-ghost btn-sm" data-on-click="rmOpen" data-a-click="${esc(JSON.stringify([r.id, "topics"]))}">${RM_I.topics}Темы</button><button class="btn btn-danger btn-sm" data-on-click="rmClear" data-a-click="${esc(JSON.stringify([r.id]))}">${RM_I.clear}Очистить</button></div></div></div>` : ''}</div>`; }).join('') || `<div class="ub-empty">${allRooms.length ? 'Ничего не нашли. Проверьте запрос или фильтр.' : 'Комнат пока нет, создайте первую'}</div>`}</div></div>`);
  });
  RM.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function rmTog(e, id) {
  if (e.target.closest('.ux-actions')) return;
  if (RM.open.has(id)) { expCollapse(rowExp(e), () => { RM.open.delete(id); rmRender(); }); return; }
  RM.open.add(id); RM.fresh = id;
  rmRender();
}
function rmSort(k) { RM.sort = k; rmRender(); }

function rmFilter(k) { RM.filter = k; RM.sel.clear(); rmRender(); }
function rmSearch(v) { RM.q = v; rmRender(); }
function rmToggle(id) { RM.sel.has(id) ? RM.sel.delete(id) : RM.sel.add(id); rmRender(); }
function rmSelAll(on) { document.querySelectorAll('#page-body tbody input[type=checkbox]').forEach(() => {}); allRooms.forEach(r => on ? RM.sel.add(r.id) : RM.sel.delete(r.id)); rmRender(); }
// Гостевая ссылка комнаты или группы: окно из shared/guestlinks.js, запросы идут с токеном админа
function glOpen(chatId, name) {
  if (typeof GuestLinks === 'undefined') return;
  GuestLinks.open({ chatId, chatName: name, request: async (method, path, body) => {
    try {
      const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
      let data = null; try { data = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, data: data || {} };
    } catch { return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } }; }
  } });
}
const GL_I = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
function rmMenu(e, id) {
  uxOpenMenu(e, 'rm' + id, `
    <button role="menuitem" data-on-click="__h17" data-a-click="${esc(JSON.stringify([id]))}">${RM_I.topics}Темы</button>
    <button role="menuitem" data-on-click="__h18" data-a-click="${esc(JSON.stringify([id]))}">${RM_I.users}Участники</button>
    <button role="menuitem" data-on-click="__h19" data-a-click="${esc(JSON.stringify([id, id]))}">${GL_I}Гостевая ссылка</button>
    <button role="menuitem" data-on-click="__h20" data-a-click="${esc(JSON.stringify([id]))}">${RM_I.clear}Очистить историю</button>
    <hr><button role="menuitem" class="danger" data-on-click="__h21" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить комнату</button>`);
}

function rmDelete(ids) {
  const list = allRooms.filter(r => ids.includes(r.id));
  if (!list.length) return;
  confirm(list.length > 1 ? `Удалить комнаты · ${list.length}` : 'Удалить комнату?',
    `${esc(list.map(r => r.name).join(', '))} — вместе со всеми темами и перепиской. У участников комната исчезнет сразу. Отменить нельзя.`,
    async () => {
      await Promise.all(list.map(r => api('DELETE', '/api/chats/admin/' + r.id)));
      toast(list.length > 1 ? `Удалено комнат: ${list.length}` : 'Комната удалена', 'success');
      RM.sel.clear();
      renderRooms();
      updateNavBadges();
    });
}
function rmClear(id) {
  const r = allRooms.find(x => x.id === id);
  confirm('Очистить историю?', `Все сообщения комнаты «${esc(r?.name || '')}» будут удалены безвозвратно.`, async () => {
    await api('DELETE', '/api/chats/admin/' + id + '/messages');
    toast('История очищена', 'success');
    renderRooms();
  });
}

// ── Окно комнаты ──
function openCreateRoom() { rmOpen(null); }

async function rmOpen(id, tab = 'main') {
  uxCloseMenu();
  if (!allUsersCache.length) allUsersCache = await api('GET', '/api/admin/users');
  const r = id ? allRooms.find(x => x.id === id) : null;
  const members = r ? (await api('GET', `/api/admin/chats/${r.id}/members`)) || [] : [];
  RM.form = {
    id: r?.id || null, tab, name: r?.name || '', avatar: null, hasAvatar: !!r?.has_avatar, readOnly: !!r?.read_only,
    manual: !!r?.topics_manual, initialManual: !!r?.topics_manual,   // у новой комнаты — по последнему сообщению
    topics: (r?.topics || []).map(t => ({ id: t.id, name: t.name, msgs: t.message_count, avatar: null, hasAvatar: !!t.has_avatar, removed: false })),
    initialTopics: new Map((r?.topics || []).map(t => [t.id, t.name])),
    members: new Set(members.map(m => m.id)), initialMembers: new Set(members.map(m => m.id)),
    fed: members.filter(m => m.federated),   // люди с других серверов: состав у них меняется приглашением и согласием, а не выбором в списке
    pending: r ? ((await api('GET', `/api/admin/chats/${r.id}/pending`)) || []) : [],
    mq: '', mf: 'all', mg: '', mlimit: 60, menu: false, renaming: null, busy: false, err: '',
  };
  PK.ctx = null;
  rmRenderForm(tab === 'topics' ? 'rm-nt' : tab === 'members' ? 'rm-mq' : 'rm-name');
  openModal('modal-room');
}

function rmAv(name, size, base64, chatId, hasAvatar) {
  const radius = Math.round(size * .28);
  if (base64) return `<span class="av" style="width:${size}px;height:${size}px;border-radius:${radius}px;background:url('data:image/jpeg;base64,${base64}') center/cover"></span>`;
  if (chatId && hasAvatar) return avHtml(name || '?', size, radius, null, false, true, chatId);
  return uaAv(name, size);
}

// Окно комнаты: вкладки «Основное», «Темы», «Участники». На экране всегда одна группа полей;
// удаление и очистка истории — в меню «⋯» в шапке.
const RM_I2 = {
  dots: rmSvg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  globe: rmSvg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
};
const rmSwitch = (checked, onchange, label) => `<label class="toggle-switch" aria-label="${label}"><input type="checkbox" ${checked ? 'checked' : ''} data-on-change="${onchange}" data-a-change='["__this"]'><div class="toggle-track"><div class="toggle-thumb"></div></div></label>`;

function rmMainHtml(f) {
  return `<div class="rm-id"><label class="rm-avb" title="${f.avatar || f.hasAvatar ? 'Заменить аватар' : 'Загрузить аватар'}"><span id="rm-av-big">${rmAv(f.name, 64, f.avatar, f.id, f.hasAvatar)}</span><span class="rm-cam">${RM_I.img}</span><input type="file" accept="image/*" hidden data-on-change="rmPickAvatar" data-a-change='["__this"]'></label>
      <div class="ua-field" style="flex:1"><label for="rm-name">Название</label>
        <div class="ua-inp"><input id="rm-name" value="${esc(f.name)}" placeholder="Например, Общая" autocomplete="off" data-on-input="__h22" data-on-keydown="__h23"></div></div></div>
    <div class="rm-card"><div class="rm-row"><span class="rm-rt"><b>Только чтение</b><span>Писать в комнату и её темы сможет только вебхук. Реакции остаются.</span></span>${rmSwitch(f.readOnly, 'rmSetReadOnly', 'Только чтение')}</div></div>
    ${f.id ? '' : '<p class="rm-hint">Темы и участников можно добавить на соседних вкладках сейчас или позже.</p>'}`;
}

function rmTopicsHtml(f) {
  return `<div class="rm-card"><div class="rm-row"><span class="rm-rt"><b>Ручной порядок</b><span>${f.manual ? 'Темы идут так, как вы их расставили. Перетащите строку за ⋮⋮.' : 'Темы сами встают по последнему сообщению: где писали недавно, та выше.'}</span></span>${rmSwitch(f.manual, 'rmSetManual', 'Ручной порядок')}</div></div>
      <div class="rm-list">${f.topics.map((t, i) => t.removed
        ? `<div class="rm-li rm-removed"><span class="rm-handle"></span>${rmAv(t.name, 28, t.avatar, t.id, t.hasAvatar)}<div style="flex:1;min-width:0"><div class="ux-name">${esc(t.name)}</div>
            <div class="rm-sub">Удалится при сохранении${t.msgs ? ` вместе с ${rmFmt(t.msgs)} ${uxPlural(t.msgs, 'сообщением', 'сообщениями', 'сообщениями')}` : ''}</div></div>
            <button type="button" class="btn btn-ghost btn-sm" data-on-click="rmTopic" data-a-click="${esc(JSON.stringify(["restore", i]))}">Вернуть</button></div>`
        : `<div class="rm-li"${f.manual ? ` draggable="true" data-on-dragstart="rmDrag" data-a-dragstart="${esc(JSON.stringify(["__event", i]))}" data-on-dragover="__h24" data-on-dragleave="this.classList.remove" data-a-dragleave='["drop"]' data-on-drop="rmDrop" data-a-drop="${esc(JSON.stringify(["__event", i]))}"` : ''}>
            ${f.manual ? '<span class="rm-handle" title="Перетащите, чтобы поменять порядок">⋮⋮</span>' : ''}${rmAv(t.name, 28, t.avatar, t.id, t.hasAvatar)}
            <div style="flex:1;min-width:0">${f.renaming === i
              ? `<input class="rm-rename" id="rm-rn" value="${esc(t.name)}" data-on-keydown="__h25" data-a-keydown="${esc(JSON.stringify([i, i]))}" data-on-blur="rmTopic" data-a-blur="${esc(JSON.stringify(["rename", i, "__value"]))}">`
              : `<div class="ux-name">${esc(t.name)}</div><div class="rm-sub">${t.id ? (t.msgs ? rmMsgs(t.msgs) : 'сообщений пока нет') : 'новая — появится после сохранения'}</div>`}</div>
            <span class="rm-acts"><label class="ux-ibtn" title="Аватар темы" style="cursor:pointer">${RM_I.img}<input type="file" accept="image/*" hidden data-on-change="rmTopicAvatar" data-a-change="${esc(JSON.stringify([i, "__this"]))}"></label>
            <button type="button" class="ux-ibtn" aria-label="Переименовать" data-on-click="rmTopic" data-a-click="${esc(JSON.stringify(["edit", i]))}">${UX_I.edit}</button>
            <button type="button" class="ux-ibtn" aria-label="Удалить тему" data-on-click="rmTopic" data-a-click="${esc(JSON.stringify(["remove", i]))}">${UX_I.trash}</button></span></div>`).join('')
        || '<div class="rm-empty-l">Тем нет: вся переписка идёт в одной ленте. Добавьте тему, если разговоры нужно разделить.</div>'}</div>
      <div class="rm-add"><div class="ua-inp" style="flex:1"><input id="rm-nt" placeholder="Название новой темы" autocomplete="off" data-on-keydown="__h26"></div>
        <button type="button" class="btn btn-primary" data-on-click="rmTopic" data-a-click='["add"]'>${RM_I.plus}Добавить</button></div>`;
}

// Участники: выбор своих людей прямо во вкладке, ниже люди с других серверов
function rmPeople(f) {
  const q = f.mq.trim().toLowerCase();
  return pkUsers().filter(p => (!q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q))
    && (!f.mg || (p.tag || 'Без тега') === f.mg) && (f.mf === 'all' || f.members.has(p.id)));
}
function rmMembersHtml(f, r) {
  const all = pkUsers(), found = rmPeople(f), shown = found.slice(0, f.mlimit);
  const sel = all.filter(p => f.members.has(p.id)).length;
  const gm = new Map(); all.forEach(p => { const g = p.tag || 'Без тега'; gm.set(g, (gm.get(g) || 0) + 1); });
  const groups = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const others = allRooms.filter(x => x.id !== f.id);
  const allIn = found.length > 0 && found.every(p => f.members.has(p.id));
  return `<label class="ux-search" style="min-width:0">${UX_I.search}<input id="rm-mq" value="${esc(f.mq)}" placeholder="Имя, логин или тег" autocomplete="off" data-on-input="rmMem" data-a-input='["q", "__value"]' aria-label="Поиск людей"></label>
    <div class="rm-mtools"><div class="fm-grp" role="group" aria-label="Показать"><button type="button" data-on-click="rmMem" data-a-click='["f", "all"]' aria-pressed="${f.mf === 'all'}">Все<small>${all.length}</small></button><button type="button" data-on-click="rmMem" data-a-click='["f", "sel"]' aria-pressed="${f.mf === 'sel'}">Выбранные<small>${sel}</small></button></div>
      ${groups.length > 1 ? `<select aria-label="Группа" data-on-change="rmMem" data-a-change='["g", "__value"]'><option value="">Все группы</option>${groups.map(g => `<option value="${esc(g[0])}" ${f.mg === g[0] ? 'selected' : ''}>${esc(g[0])} · ${g[1]}</option>`).join('')}</select>` : ''}
      ${others.length ? `<select aria-label="Добавить участников другой комнаты" data-on-change="__h27"><option value="">Из комнаты…</option>${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : ''}
      <span style="flex:1"></span><button type="button" class="rm-link" data-on-click="rmMem" data-a-click='["all"]' ${found.length && !allIn ? '' : 'disabled'}>Выбрать найденных (${found.length})</button><button type="button" class="rm-link" data-on-click="rmMem" data-a-click='["none"]' ${found.some(p => f.members.has(p.id)) ? '' : 'disabled'}>Снять</button></div>
    <div class="rm-ml">${shown.map(p => `<button type="button" class="fm-li" aria-pressed="${f.members.has(p.id)}" data-on-click="rmMem" data-a-click="${esc(JSON.stringify(["tog", p.id]))}">${p.av}<span class="n">${esc(p.name)}<small>${esc(p.sub)}</small></span>${p.tag ? `<span class="tg2">${esc(p.tag)}</span>` : ''}<span class="ck">${f.members.has(p.id) ? '✓' : ''}</span></button>`).join('') || '<div class="fm-empty">Никого не нашли. Измените запрос или фильтр</div>'}
      ${found.length > shown.length ? `<button type="button" class="btn btn-ghost btn-sm" style="align-self:center;margin:4px 0" data-on-click="rmMem" data-a-click='["more"]'>Показать ещё ${Math.min(60, found.length - shown.length)} из ${found.length - shown.length}</button>` : ''}</div>
    <p class="rm-hint">Новые участники сразу видят все темы комнаты.</p>${rmRemoteHtml(f, r)}`;
}
async function rmMem(act, v) {
  const f = RM.form; if (!f) return;
  if (act === 'q') { f.mq = v; f.mlimit = 60; return rmRenderForm('rm-mq'); }
  if (act === 'f') { f.mf = v; f.mlimit = 60; }
  else if (act === 'g') { f.mg = v; f.mlimit = 60; }
  else if (act === 'tog') { f.members.has(v) ? f.members.delete(v) : f.members.add(v); }
  else if (act === 'all') rmPeople(f).forEach(p => f.members.add(p.id));
  else if (act === 'none') rmPeople(f).forEach(p => f.members.delete(p.id));
  else if (act === 'more') f.mlimit += 60;
  else if (act === 'copy') {
    const id = Number(v); if (!id) return;
    const list = (await api('GET', `/api/admin/chats/${id}/members`)) || [];
    list.filter(m => !m.federated).forEach(m => f.members.add(m.id));
    toast(`Добавлены участники комнаты «${esc(allRooms.find(x => x.id === id)?.name || '')}»`, 'success');
  }
  rmRenderForm();
}

const rmSetTab = t => { RM.form.tab = t; RM.form.menu = false; rmRenderForm(t === 'topics' ? 'rm-nt' : t === 'members' ? 'rm-mq' : null); };
const rmMenuToggle = () => { RM.form.menu = !RM.form.menu; rmRenderForm(); };
function rmMenuHtml(f, r) {
  if (!r || !f.menu) return '';
  return `<div class="rm-scrim" data-on-click="rmMenuToggle"></div><div class="rm-menu" role="menu">
    <button type="button" role="menuitem" data-on-click="__h28" data-a-click="${esc(JSON.stringify([r.id, r.id]))}">${GL_I}Гостевая ссылка…</button>
    <button type="button" role="menuitem" data-on-click="__h29" data-a-click="${esc(JSON.stringify([r.id]))}">${RM_I.clear}Очистить историю…</button>
    <button type="button" role="menuitem" class="d" data-on-click="__h30" data-a-click="${esc(JSON.stringify([r.id]))}">${UX_I.trash}Удалить комнату…</button></div>`;
}
const rmMore = id => { rmSetTab(id === 't' ? 'topics' : id === 'm' ? 'members' : 'main'); };
function rmFootSync() {
  const f = RM.form; if (!f) return;
  const miss = f.name.trim() ? [] : ['название'], n = document.getElementById('rm-note'), b = document.getElementById('rm-go');
  if (n) { n.innerHTML = fmNote(miss); n.classList.toggle('ok', !miss.length); }
  if (b) b.disabled = !!f.busy || !!miss.length;
}
function rmSetManual(el) { RM.form.manual = el.checked; rmRenderForm(); }
function rmSetReadOnly(el) { RM.form.readOnly = el.checked; }
function rmRenderForm(focusId) {
  const f = RM.form, el = document.getElementById('rm-form');
  if (!f || !el) return;
  const r = f.id ? allRooms.find(x => x.id === f.id) : null;
  const live = f.topics.filter(t => !t.removed).length, miss = f.name.trim() ? [] : ['название'];
  const tabs = [['main', 'Основное', ''], ['topics', 'Темы', live], ['members', 'Участники', f.members.size]];
  const body = f.tab === 'topics' ? rmTopicsHtml(f) : f.tab === 'members' ? rmMembersHtml(f, r) : rmMainHtml(f);
  const prev = el.querySelector('.rm-body'), keep = prev && prev.dataset.tab === f.tab ? prev.scrollTop : 0;
  uaRestoreFocus(() => {
    el.innerHTML = `
      <div class="ua-head"><span id="rm-head-av">${rmAv(f.name, 38, f.avatar, f.id, f.hasAvatar)}</span>
        <div><div class="ua-title">${r ? esc(r.name) : 'Новая комната'}</div><div class="ua-sub">${r ? `Создана ${fmtDate(r.created_at)} · ${rmMsgs(r.msgs)}` : 'Название, остальное можно позже'}</div></div>
        <span style="flex:1"></span>${r ? `<button type="button" class="ux-ibtn" aria-label="Ещё" aria-haspopup="menu" aria-expanded="${!!f.menu}" data-on-click="rmMenuToggle">${RM_I2.dots}</button>` : ''}
        <button type="button" class="modal-close" style="margin-left:0" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-room"]'>✕</button></div>
      <div class="rm-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${f.tab === t[0]}" data-on-click="rmSetTab" data-a-click="${esc(JSON.stringify([`${t[0]}`]))}">${t[1]}${t[2] !== '' ? `<small>${t[2]}</small>` : ''}</button>`).join('')}</div>
      <div class="ua-body rm-body" data-tab="${f.tab}">${body}</div>
      <div class="ua-foot">${f.err ? `<span class="ua-err">${esc(f.err)}</span>` : ''}<span class="fm-note ${miss.length ? '' : 'ok'}" id="rm-note">${fmNote(miss)}</span>
        <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-room"]'>Отмена</button>
        <button type="button" class="btn ux-solid" id="rm-go" ${f.busy || miss.length ? 'disabled' : ''} data-on-click="rmSave">${f.busy ? 'Сохраняю…' : r ? 'Сохранить' : 'Создать'}</button></div>${rmMenuHtml(f, r)}`;
  }, focusId);
  const nb = el.querySelector('.rm-body'); if (nb && keep) nb.scrollTop = keep;
}

// Люди с других серверов: приглашение по адресу, ответ они дают сами
function rmRemoteHtml(f, r) {
  const row = (m, fn, tip, sub, pill) => `<div class="rm-li">${avHtml(m.display_name, 30, 8, m.id, false, true)}
    <div style="flex:1;min-width:0"><div class="ux-name">${esc(m.display_name)}${pill || ''}</div><div class="rm-sub rm-addr">${sub}</div></div>
    <button type="button" class="ux-ibtn" aria-label="${tip}: ${esc(m.display_name)}" data-on-click="${esc(fn)}" data-a-click="${esc(JSON.stringify([m.id]))}">${RM_I.x}</button></div>`;
  const head = `<div class="rm-sect"><span class="rm-glb">${RM_I2.globe}</span>С других серверов<span style="flex:1"></span>${r ? `<small>${f.fed.length + f.pending.length}</small>` : ''}</div>`;
  if (!r) return `<div>${head}<p class="rm-hint" style="margin-top:6px">Приглашать людей с других серверов можно после создания комнаты.</p></div>`;
  const rows = f.fed.map(m => row(m, 'rmRemoteKick', 'Убрать из комнаты', esc('@' + m.username))).join('')
    + f.pending.map(m => row(m, 'rmRemoteCancel', 'Отменить приглашение', esc('@' + m.username), ' <span class="rm-wait">ждёт ответа</span>')).join('');
  return `<div>${head}
    ${rows ? `<div class="rm-list" style="margin-top:8px">${rows}</div>` : ''}
    <div class="rm-add" style="margin-top:8px"><div class="ua-inp" style="flex:1"><input id="rm-addr" placeholder="@сервер:логин" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Адрес человека с другого сервера" data-on-keydown="__h31"></div><button type="button" class="btn btn-primary" data-on-click="rmInviteAddr">Пригласить</button></div>
    <p class="rm-hint" style="margin-top:6px">Человек получит приглашение и сам решит, вступать ли: до согласия он не виден участникам. Нужно соединение с его сервером (раздел «Федерации»).</p></div>`;
}
async function rmInviteAddr() {
  const f = RM.form, v = (document.getElementById('rm-addr')?.value || '').trim();
  if (!f?.id) return;
  if (!v) { toast('Введите адрес вида @сервер:логин', 'error'); return; }
  const r = await api('POST', `/api/admin/chats/${f.id}/invite`, { address: v });
  if (!r || r.error) { toast(r?.error || 'Не удалось пригласить', 'error'); return; }
  toast(r.member ? `«${esc(r.name)}» уже в комнате` : `Приглашение отправлено: «${esc(r.name)}»`, 'success');
  f.pending = (await api('GET', `/api/admin/chats/${f.id}/pending`)) || [];
  rmRenderForm('rm-addr');
}
async function rmRemoteKick(userId) {
  const f = RM.form;
  await api('DELETE', `/api/admin/chats/${f.id}/members/${userId}`);
  f.fed = f.fed.filter(m => m.id !== userId); f.members.delete(userId); f.initialMembers.delete(userId);
  toast('Человек убран из комнаты', 'success'); rmRenderForm();
}
async function rmRemoteCancel(userId) {
  const f = RM.form;
  await api('DELETE', `/api/admin/chats/${f.id}/members/${userId}`);
  f.pending = f.pending.filter(m => m.id !== userId);
  toast('Приглашение отменено', 'success'); rmRenderForm();
}

function rmLiveAv() {
  const f = RM.form;
  if (f.avatar || (f.id && f.hasAvatar)) return;
  const h = document.getElementById('rm-head-av'); if (h) h.innerHTML = uaAv(f.name, 38);
  const b = document.getElementById('rm-av-big'); if (b) b.innerHTML = uaAv(f.name, 56);
}
function rmPickAvatar(input) {
  const file = input.files?.[0];
  if (file) resizeAvatarFile(file).then(b64 => { RM.form.avatar = b64; rmRenderForm(); });
}
function rmTopicAvatar(i, input) {
  const file = input.files?.[0];
  if (file) resizeAvatarFile(file).then(b64 => { RM.form.topics[i].avatar = b64; rmRenderForm(); });
}
function rmTopic(action, i, value) {
  const f = RM.form, t = f.topics[i];
  if (action === 'add') {
    const input = document.getElementById('rm-nt'), name = input?.value.trim();
    if (!name) return;
    f.topics.push({ id: null, name, msgs: 0, avatar: null, hasAvatar: false, removed: false });
    return rmRenderForm('rm-nt');
  }
  if (action === 'edit') { f.renaming = i; rmRenderForm('rm-rn'); document.getElementById('rm-rn')?.select(); return; }
  if (action === 'rename') {
    if (f.renaming !== i) return;          // blur после Enter — уже сохранено
    if (value?.trim()) t.name = value.trim();
    f.renaming = null;
    return rmRenderForm();
  }
  if (action === 'remove') { if (t.id) t.removed = true; else f.topics.splice(i, 1); return rmRenderForm(); }
  if (action === 'restore') { t.removed = false; return rmRenderForm(); }
}
function rmDrag(e, i) {
  RM.dragFrom = i;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(i)); } catch {}
}
function rmDrop(e, i) {
  e.preventDefault();
  const from = RM.dragFrom;
  RM.dragFrom = null;
  if (from == null || from === i) return rmRenderForm();
  const arr = RM.form.topics;
  const [moved] = arr.splice(from, 1);
  arr.splice(i, 0, moved);
  rmRenderForm();
}

async function rmSave() {
  const f = RM.form;
  if (!f || f.busy) return;
  const name = f.name.trim();
  if (!name) { f.err = 'Укажите название комнаты'; return rmRenderForm('rm-name'); }
  f.busy = true;
  f.err = '';
  rmRenderForm();
  try {
    let id = f.id;
    if (!id) {
      const r = await api('POST', '/api/admin/rooms', { name, member_ids: [...f.members], read_only: f.readOnly });
      if (!r?.id) throw new Error(r?.error || 'Не удалось создать комнату');
      id = r.id;
      if (f.manual) await api('PATCH', `/api/admin/rooms/${id}`, { topics_manual: true });   // у новой комнаты по умолчанию автоматическая
    } else {
      const cur = allRooms.find(x => x.id === id);
      if (name !== cur?.name || !!f.readOnly !== !!cur?.read_only || f.manual !== f.initialManual) {
        const r = await api('PATCH', `/api/admin/rooms/${id}`, { name, read_only: !!f.readOnly, topics_manual: f.manual });
        if (!r?.ok) throw new Error(r?.error || 'Не удалось переименовать');
      }
      const add = [...f.members].filter(u => !f.initialMembers.has(u));
      const del = [...f.initialMembers].filter(u => !f.members.has(u));
      await Promise.all([...add.map(u => api('POST', `/api/admin/chats/${id}/members`, { user_id: u })),
        ...del.map(u => api('DELETE', `/api/admin/chats/${id}/members/${u}`))]);
    }
    if (f.avatar) await api('POST', `/api/admin/chats/${id}/avatar`, { data: f.avatar });
    // Темы: сначала удалённые, потом переименованные и новые — по порядку, затем сам порядок
    for (const t of f.topics.filter(t => t.removed && t.id)) await api('DELETE', `/api/admin/topics/${t.id}`);
    for (const t of f.topics.filter(t => !t.removed)) {
      if (!t.id) { const r = await api('POST', '/api/admin/topics', { name: t.name, room_id: id }); if (r?.id) t.id = r.id; }
      else if (f.initialTopics.get(t.id) !== t.name) await api('PATCH', `/api/admin/topics/${t.id}`, { name: t.name });
      if (t.avatar && t.id) await api('POST', `/api/admin/topics/${t.id}/avatar`, { data: t.avatar });
    }
    const order = f.topics.filter(t => !t.removed && t.id).map(t => t.id);
    if (order.length > 1 && f.manual) await api('POST', '/api/admin/topics/reorder', { ids: order });
    f.busy = false;
    closeModal('modal-room');
    toast(f.id ? 'Комната сохранена' : 'Комната создана', 'success');
    if (currentPage === 'rooms') renderRooms();
    updateNavBadges();
  } catch (e) {
    f.busy = false;
    f.err = e.message || 'Не удалось сохранить';
    rmRenderForm();
  }
}

/* ── USERS ── */
// Раздел «Пользователи»: таблица с фильтрами, сортировкой и выбором нескольких строк.
// Частое действие — «Изменить» — на виду, остальные спрятаны в меню «⋯».
// Окно добавления и изменения: «Профиль» и «Доступ».

// ── Общие части списков: «Пользователи» и «Клиенты» ──
const uxSvg = (p, sw = 2, fill = false) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const UX_I = {
  search: uxSvg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  edit: uxSvg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  key: uxSvg('<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>'),
  logout: uxSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  ban: uxSvg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  unban: uxSvg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  trash: uxSvg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
  more: uxSvg('<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>', 2.4),
  eye: uxSvg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: uxSvg('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),
  wand: uxSvg('<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>'),
  copy: uxSvg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  shield: uxSvg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  check: uxSvg('<path d="M20 6 9 17l-5-5"/>', 2.5),
  chev: uxSvg('<path d="m9 18 6-6-6-6"/>', 2.5),
  up: uxSvg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 2.5),
  refresh: uxSvg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>', 2.5),
  restart: uxSvg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  win32: uxSvg('<path d="M3 5.5l7.5-1v7H3zM11.5 4.4L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z"/>', 0, true),
  darwin: uxSvg('<path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.9C7 7.3 5.6 8.2 4.8 9.6c-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.5 1.3-2.6 0 0-2.5-1-2.6-3.7zM14.2 5.8c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.3z"/>', 0, true),
  linux: uxSvg('<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>'),
  phone: uxSvg('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>'),
  web: uxSvg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
};
const uxPlural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const uxHash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h; };
const uxTag = t => t ? `<span class="ux-tag ux-t${uxHash(t) % 4}">${esc(t)}</span>` : '';
const uxClock = ms => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function uxChips(items, current, handler, label = 'Фильтр') {
  return `<div class="ux-chips" role="group" aria-label="${label}">${items.map(([key, label, count, warn]) =>
    `<button class="ux-chip${warn && count ? ' warn' : ''}" aria-pressed="${current === key}" data-on-click="${esc(handler)}" data-a-click="${esc(JSON.stringify([`${key}`]))}">${label}<b>${count}</b></button>`).join('')}</div>`;
}
const uxSearch = (id, value, placeholder, handler) =>
  `<label class="ux-search">${UX_I.search}<input id="${id}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off" data-on-input="${esc(handler)}" data-a-input="${esc(JSON.stringify(["__value"]))}"></label>`;

// Поиск перерисовывает страницу — возвращаем фокус и курсор туда, где они были
// Тихая перерисовка списков. Новая разметка не заменяет старую целиком, а сверяется с ней: нетронутые строки и блоки остаются как были
// (не мигают аватарки, не сбрасываются прокрутка, фокус и наведение), меняется только то, что изменилось. Новые строки плавно появляются,
// остальные плавно уезжают на новое место. Если разметка не менялась вовсе, страница не трогается.
function uxSet(el, html) {
  const mk = currentPage;
  if (el._mk !== mk || !el.firstElementChild || el._root !== el.firstElementChild) {
    el.innerHTML = html; el._mk = mk; el._root = el.firstElementChild; el._html = html; return true;
  }
  if (el._html === html) return false;
  el._html = html;
  const t = document.createElement('template'); t.innerHTML = html;
  uxMorphKids(el, t.content);
  el._root = el.firstElementChild;
  return true;
}
function uxMorphAttrs(x, y) {
  for (const a of [...x.attributes]) if (!y.hasAttribute(a.name)) { if (!(a.name === 'style' && x.tagName === 'IMG')) x.removeAttribute(a.name); }
  for (const a of y.attributes) { if (a.name === 'style' && x.tagName === 'IMG') continue; if (x.getAttribute(a.name) !== a.value) x.setAttribute(a.name, a.value); }
}
function uxMorphNode(x, y) {
  if (x.nodeType !== y.nodeType || (x.nodeType === 1 && x.tagName !== y.tagName)) { x.replaceWith(y); return; }
  if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
  uxMorphAttrs(x, y);
  const tg = x.tagName;
  if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') {
    if (x.type === 'checkbox' || x.type === 'radio') x.checked = y.hasAttribute('checked');
    else if (x !== document.activeElement && x.value !== y.getAttribute('value')) x.value = y.getAttribute('value') ?? '';
    if (tg === 'SELECT') uxMorphKids(x, y);
    return;
  }
  uxMorphKids(x, y);
}
function uxMorphKids(a, b) {
  const nk = [...b.childNodes];
  if (nk.length && nk.every(n => n.nodeType === 1 && n.dataset.k != null)) return uxMorphKeyed(a, nk);
  const ok = [...a.childNodes], n = Math.max(ok.length, nk.length);
  for (let i = 0; i < n; i++) { const x = ok[i], y = nk[i]; if (!y) x.remove(); else if (!x) a.appendChild(y); else uxMorphNode(x, y); }
}
function uxMorphKeyed(a, nk) {
  const old = new Map();
  [...a.childNodes].forEach(n => { if (n.nodeType === 1 && n.dataset.k != null) old.set(n.dataset.k, n); else n.remove(); });
  const top = new Map(); old.forEach((e, k) => top.set(k, e.getBoundingClientRect().top));
  const seen = new Set(); let prev = null;
  nk.forEach(y => {
    const k = y.dataset.k; seen.add(k);
    let x = old.get(k);
    if (x) uxMorphNode(x, y); else { x = y; x.classList.add('ux-new'); }
    const want = prev ? prev.nextSibling : a.firstChild;
    if (x !== want) a.insertBefore(x, want);
    prev = x;
  });
  old.forEach((e, k) => { if (!seen.has(k)) e.remove(); });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  old.forEach((e, k) => {
    if (!seen.has(k) || !e.isConnected) return;
    const dy = top.get(k) - e.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
  });
}
function uxKeepFocus(fn) {
  const a = document.activeElement, id = a?.id, caret = a?.selectionStart;
  fn();
  const el = id && document.getElementById(id);
  if (el && el !== a) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} }
}

// Мягкое закрытие всплывающих окон: та же анимация, что при открытии, в обратную сторону.
// finish() делает настоящее скрытие; popShow(el) отменяет закрытие, если окно открыли снова.
function popHide(el, finish) {
  if (!el || el._popOut || getComputedStyle(el).display === 'none') return;
  el._popOut = true;
  el.classList.add('pop-out');
  el._popT = setTimeout(() => { if (!el._popOut) return; el._popOut = false; el.classList.remove('pop-out'); finish(); }, 120);
}
function popShow(el) {
  if (!el || !el._popOut) return;
  clearTimeout(el._popT); el._popOut = false; el.classList.remove('pop-out');
}
// Сворачивание раскрытого блока строки: плавно уходит, потом вызывается done (перерисовка страницы)
function expCollapse(x, done) {
  if (!x || x.dataset.out) { if (!x) done(); return; }
  x.dataset.out = '1';
  const st = x.style;
  st.height = x.offsetHeight + 'px'; st.overflow = 'hidden';
  st.transition = 'height .2s ease, padding .2s ease, opacity .16s ease';
  void x.offsetHeight;
  st.height = '0'; st.paddingTop = '0'; st.paddingBottom = '0'; st.opacity = '0';
  setTimeout(done, 210);
}
const rowExp = e => e.currentTarget?.parentElement?.querySelector(':scope > [class*="-exp"]');

// Меню «⋯»: fixed, чтобы не обрезалось прокруткой таблицы; у нижнего края открывается вверх
let uxMenuState = null;
function uxOpenMenu(e, key, html) {
  e.stopPropagation();
  const same = uxMenuState?.key === key;
  uxCloseMenu();
  if (same) return;
  const btn = e.currentTarget, r = btn.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'ux-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = html;
  document.body.appendChild(el);
  el.style.left = Math.max(8, r.right - el.offsetWidth) + 'px';
  el.style.top = (r.bottom + 6 + el.offsetHeight > innerHeight ? r.top - el.offsetHeight - 6 : r.bottom + 6) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  uxMenuState = { key, el, btn };
  el.querySelector('button:not([disabled])')?.focus();
}
function uxCloseMenu() {
  if (!uxMenuState) return;
  const el = uxMenuState.el;
  popHide(el, () => el.remove());
  uxMenuState.btn.setAttribute('aria-expanded', 'false');
  uxMenuState = null;
}
document.addEventListener('click', e => { if (!e.target.closest?.('.ux-menu')) uxCloseMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') uxCloseMenu(); });
document.getElementById('page-body')?.addEventListener('scroll', uxCloseMenu);

function uxOsName(platform) {
  const p = String(platform || '');
  if (p === 'win32' || /^win/i.test(p)) return 'Windows';
  if (p === 'darwin' || /mac/i.test(p)) return 'macOS';
  if (/iphone|ipad|ipod/i.test(p)) return 'iOS';
  if (/android|arm|aarch/i.test(p)) return 'Android';
  if (/linux/i.test(p)) return 'Linux';
  return '';
}

// ── Пользователи ──
const UA = { ws: null, filter: 'all', q: '', sort: { key: 'name', dir: 1 }, sel: new Set(), form: null, editId: null, passId: null };

async function renderUsers() {
  const [users] = await Promise.all([api('GET', '/api/admin/users'), wsLoad()]);
  allUsers = users;
  const ids = new Set(allUsers.map(u => u.id));
  UA.sel.forEach(id => { if (!ids.has(id)) UA.sel.delete(id); });
  uaRender();
}

const uaOnline = u => !u.banned && u.status === 'online';
const uaAway = u => !u.banned && u.status === 'away';
// Точка аватара: зелёная — в сети, оранжевая — отошёл, без точки — не в сети
const uaDot = u => uaOnline(u) ? true : uaAway(u) ? 'away' : false;
function uaDevices(u) {
  const name = c => c.version === 'web' ? (c.scope === 'pwa' || c.hostname === 'PWA' ? 'PWA' : 'Веб')
    : c.version && c.version !== '—' ? `Electron ${c.version}` : 'Клиент';
  return [...new Set((u.clients || []).map(c => [name(c), uxOsName(c.platform)].filter(Boolean).join(' · ')))].join(', ');
}
function uaSeen(ts) {
  if (!ts) return 'входов не было';
  const d = new Date(ts * 1000), now = new Date();
  const time = uxClock(d.getTime());
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `сегодня в ${time}`;
  if (diff === 1) return `вчера в ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ` в ${time}`;
}
// Значок 2FA рядом с ролью — только для админов: заполненный ключ, если уже
// настроена, пунктирный — если включили требование, а сам ещё не настроил
// при следующем входе в админ-панель
const uaTotpBadge = u => !u.is_admin ? '' : u.totp_configured
  ? `<span class="ua-totp-badge on" title="2FA настроена">${UX_I.key}</span>`
  : u.totp_required
  ? `<span class="ua-totp-badge pending" title="2FA включена, но ещё не настроена пользователем">${UX_I.key}</span>`
  : '';
const uaRole = u => u.is_admin ? `<span class="ua-role admin">${UX_I.shield}Администратор</span>${uaTotpBadge(u)}` : `<span class="ua-role">Пользователь</span>${u.can_announce ? '<span class="ua-totp-badge on" title="Может отправлять объявления"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>' : ''}`;

function uaRows() {
  const q = UA.q.trim().toLowerCase();
  const rank = u => u.banned ? 3 : uaOnline(u) ? 0 : uaAway(u) ? 1 : 2;
  const byName = (a, b) => a.display_name.localeCompare(b.display_name, 'ru', { numeric: true });
  // Дата статуса — то, что написано в колонке статуса: у тех, кто в сети или отошёл, это «сейчас», у остальных «был …»
  const nowS = Date.now() / 1000;
  const seen = u => (uaOnline(u) || uaAway(u)) ? nowS : (u.last_seen_at || 0);
  return allUsers
    .filter(u => UA.filter === 'all' || (UA.filter === 'online' && uaOnline(u)) || (UA.filter === 'away' && uaAway(u)) || (UA.filter === 'admins' && u.is_admin) || (UA.filter === 'banned' && u.banned))
    .filter(u => UA.ws == null || uaInWs(u, UA.ws))
    .filter(u => !q || [u.display_name, u.username, u.tag || ''].some(x => x.toLowerCase().includes(q)))
    .sort((a, b) => {
      const d = UA.sort.key === 'status' ? rank(a) - rank(b) : UA.sort.key === 'seen' ? seen(a) - seen(b) : byName(a, b);
      return (d || byName(a, b)) * UA.sort.dir;
    });
}

function uaRender() {
  if (currentPage !== 'users') return;
  const rows = uaRows();
  const n = { all: allUsers.length, online: allUsers.filter(uaOnline).length, away: allUsers.filter(uaAway).length, admins: allUsers.filter(u => u.is_admin).length, banned: allUsers.filter(u => u.banned).length };
  const title = { all: 'Все', online: 'В сети', away: 'Отошли', admins: 'Администраторы', banned: 'Заблокированы' }[UA.filter];
  const tile = (key, label, num, unit, color) => `<button type="button" class="ub-tile" aria-pressed="${UA.filter === key}" data-on-click="uaFilter" data-a-click="${esc(JSON.stringify([`${key}`]))}">
    <div class="ub-lbl">${label}</div><div class="ub-big">${num}<small>${unit}</small></div>
    <div class="ub-meter"><i style="width:${n.all ? Math.round(num / n.all * 100) : 0}%;background:${color}"></i></div></button>`;
  const sortBtn = (key, label) => `<button type="button" aria-pressed="${UA.sort.key === key}" data-on-click="uaSortBy" data-a-click="${esc(JSON.stringify([`${key}`]))}">${label}${UA.sort.key === key ? (UA.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>`;
  // Прокрутка списка не должна сбрасываться при обновлении данных раз в несколько секунд
  const keepTop = document.querySelector('.ub-rows')?.scrollTop || 0;
  uxKeepFocus(() => {
    uxSet(document.getElementById('page-body'), `<div class="ub">
      <div class="ub-tiles">
        ${tile('all', 'Всего', n.all, 'человек', 'var(--dv-c2)')}${tile('online', 'В сети', n.online, 'сейчас', 'var(--c-green)')}
        ${tile('away', 'Отошли', n.away, 'из них', 'var(--c-orange)')}${tile('admins', 'Администраторы', n.admins, 'чел.', 'var(--c-primary)')}
      </div>
      ${WS.list.length > 1 ? uxChips([['all', 'Все пространства', allUsers.length], ...WS.list.map(w => ['w' + w.id, w.name, allUsers.filter(u => uaInWs(u, w.id)).length])], UA.ws == null ? 'all' : 'w' + UA.ws, 'uaWsFilter', 'Пространство') : ''}
      <div class="ub-head"><h3>${title} <span>${rows.length}</span></h3>
        ${n.banned || UA.filter === 'banned' ? uxChips([['banned', 'Заблокированы', n.banned, true]], UA.filter, 'uaFilter') : ''}
        <div class="ub-sort" role="group" aria-label="Сортировка">${sortBtn('name', 'По имени')}${sortBtn('status', 'По статусу')}${sortBtn('seen', 'По дате')}</div>
        ${uxSearch('ua-q', UA.q, 'Имя, логин или тег', 'uaSearch')}${UA.sel.size ? `<div class="ux-bulk"><b>Выбрано: ${UA.sel.size}</b>
        <button class="btn btn-ghost btn-sm" data-on-click="__h32">${UX_I.logout}Завершить сеансы</button>
        <button class="btn btn-ghost btn-sm" data-on-click="__h33">${UX_I.ban}Заблокировать</button>
        <span class="ux-grow"></span><button class="btn btn-ghost btn-sm" data-on-click="__h34">Снять выделение</button></div>` : ''}</div>
      <div class="ub-rows">${rows.map(u => `<div class="ub-row${UA.sel.has(u.id) ? ' sel' : ''}${u.banned ? ' ua-banned' : ''}" data-k="${u.id}">
        <input type="checkbox" aria-label="Выбрать: ${esc(u.display_name)}" ${UA.sel.has(u.id) ? 'checked' : ''} data-on-change="uaToggle" data-a-change="${esc(JSON.stringify([u.id]))}">
        <div class="ux-cell">${avHtml(u.display_name, 38, 11, u.id, uaDot(u), u.has_avatar)}
          <div style="min-width:0"><div class="ux-name">${esc(u.display_name)}${uxTag(u.tag)}</div><div class="ux-login">@${esc(u.username)}${WS.list.length > 1 ? ' ' + uaWsPills(u) : ''}</div></div></div>
        <div class="ub-role">${uaRole(u)}<small>создан ${fmtDate(u.created_at)}</small></div>
        <div class="ub-st">${uaStatusPill(u)}</div>
        <div class="ux-actions">
          <button class="btn btn-ghost btn-sm" data-on-click="openEditUser" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.edit}Изменить</button>
          <button class="ux-ibtn" aria-label="Ещё действия: ${esc(u.display_name)}" aria-haspopup="menu" aria-expanded="false" data-on-click="uaMenu" data-a-click="${esc(JSON.stringify(["__event", u.id]))}">${UX_I.more}</button>
        </div></div>`).join('') || '<div class="ub-empty">Никого не нашли. Проверьте запрос или фильтр.</div>'}</div>
    </div>`);
  });
  const list = document.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
// Плашка статуса и под ней устройство или время последнего входа
function uaStatusPill(u) {
  if (u.banned) return '<span class="ub-pill banned">Заблокирован</span>';
  if (uaOnline(u)) return `<span class="ub-pill online">Онлайн</span><small>${esc(uaDevices(u))}</small>`;
  if (uaAway(u)) return `<span class="ub-pill away">Отошёл</span><small>${esc(uaDevices(u))}</small>`;
  return `<span class="ub-pill">Не в сети</span><small>был ${esc(uaSeen(u.last_seen_at))}</small>`;
}

function uaWsFilter(k) { UA.ws = k === 'all' ? null : Number(k.slice(1)); UA.sel.clear(); uaRender(); }
function uaFilter(k) { UA.filter = k; UA.sel.clear(); uaRender(); }
function uaSearch(v) { UA.q = v; uaRender(); }
// По дате сначала самые свежие: первое нажатие даёт убывание
function uaSortBy(key) { UA.sort = UA.sort.key === key ? { key, dir: -UA.sort.dir } : { key, dir: key === 'seen' ? -1 : 1 }; uaRender(); }
function uaToggle(id) { UA.sel.has(id) ? UA.sel.delete(id) : UA.sel.add(id); uaRender(); }
function uaSelAll(on) { uaRows().forEach(u => on ? UA.sel.add(u.id) : UA.sel.delete(u.id)); uaRender(); }

// Пункт меню пользователя «Заблокировать» / «Разблокировать»: закрываем меню и меняем статус
function uaBanMenu(id, banned) { uxCloseMenu(); banned ? uaUnban(id) : uaBan([id]); }
// То же из окна пользователя: закрываем окно и меняем статус
function uaBanModal(id, banned) { closeModal('modal-user'); banned ? uaUnban(id) : uaBan([id]); }
function uaMenu(e, id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  const self = currentUser?.id === id, devices = (u.clients || []).length;
  uxOpenMenu(e, 'ua' + id, `
    <button role="menuitem" data-on-click="__h35" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.key}Сменить пароль</button>
    <button role="menuitem" ${devices ? '' : 'disabled'} data-on-click="__h36" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.logout}Завершить сеансы${devices ? `<small>${devices}</small>` : ''}</button>
    <button role="menuitem" ${self ? 'disabled' : ''} data-on-click="uaBanMenu" data-a-click="${esc(JSON.stringify([id, !!u.banned]))}">${u.banned ? UX_I.unban + 'Разблокировать' : UX_I.ban + 'Заблокировать'}</button>
    <hr><button role="menuitem" class="danger" ${self ? 'disabled' : ''} data-on-click="__h38" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить</button>`);
}

// ── Действия ──
const uaNames = ids => ids.map(id => allUsers.find(u => u.id === id)?.display_name).filter(Boolean);
function uaLogout(ids) {
  if (!ids.length) return;
  const names = uaNames(ids);
  confirm(ids.length > 1 ? `Завершить сеансы · ${ids.length}` : 'Завершить сеансы?',
    `${esc(names.join(', '))} — выход на всех устройствах. Войти снова можно будет.`,
    async () => {
      await Promise.all(ids.map(id => api('POST', `/api/admin/users/${id}/logout`)));
      toast(ids.length > 1 ? `Сеансы завершены: ${ids.length}` : 'Сеансы завершены', 'success');
      UA.sel.clear();
      renderUsers();
    });
}
function uaBan(ids) {
  ids = ids.filter(id => id !== currentUser?.id && !allUsers.find(u => u.id === id)?.banned);
  if (!ids.length) { toast('Выбранные уже заблокированы или это ваша учётная запись'); return; }
  const names = uaNames(ids);
  confirm(ids.length > 1 ? `Заблокировать · ${ids.length}` : 'Заблокировать?',
    `${esc(names.join(', '))} не ${ids.length > 1 ? 'смогут' : 'сможет'} войти, пока вы не разблокируете. Все сеансы завершатся сразу.`,
    async () => {
      await Promise.all(ids.map(id => api('POST', `/api/admin/users/${id}/ban`)));
      toast(ids.length > 1 ? `Заблокировано: ${ids.length}` : 'Пользователь заблокирован', 'success');
      UA.sel.clear();
      renderUsers();
    });
}
async function uaUnban(id) {
  await api('POST', `/api/admin/users/${id}/unban`);
  toast(`«${esc(uaNames([id])[0] || '')}» разблокирован`, 'success');
  renderUsers();
}
function uaDelete(id) {
  const name = uaNames([id])[0] || '';
  confirm('Удалить пользователя?',
    `«${esc(name)}» будет удалён навсегда.\nСообщения в чатах останутся, отправитель будет подписан «Удалённый аккаунт».`,
    async () => {
      const r = await api('DELETE', '/api/users/' + id);
      if (r?.error) { toast(esc(r.error), 'error'); return; }
      toast('Пользователь удалён', 'success');
      UA.sel.delete(id);
      renderUsers();
      updateNavBadges();
    });
}

/* ── Быстрые окна: общие части ── */
// В окне только главное, остальное под «Дополнительно»: краткий перечень, по клику раскрывается.
// Выбор людей и чатов в больших списках — отдельным листом поверх окна: поиск, фильтры, группы, массовые действия.
const fmNote = miss => miss.length ? `Осталось: <b>${miss.join(', ')}</b>` : '<b>Всё готово</b>';
function fmMoreHtml(prefix, open, toggleFn, secs) {
  if (!secs.length) return '';
  const n = secs.length;
  return `<div class="fm-more ${open ? 'open' : ''}"><button type="button" data-on-click="${esc(toggleFn)}" aria-expanded="${open}"><span>Дополнительно</span><span class="ua-hint">${n} ${uxPlural(n, 'раздел', 'раздела', 'разделов')}</span><span class="ch">›</span></button>
    ${open ? `<div class="fm-mb">${secs.map(s => `<section class="ua-sec" id="${prefix}-sec-${s.id}"><div class="ua-sec-title">${s.t}</div>${s.body}</section>`).join('')}</div>`
      : `<div class="fm-chips">${secs.map(s => `<button type="button" class="fm-chip" data-on-click="${esc(toggleFn)}" data-a-click="${esc(JSON.stringify([`${s.id}`]))}">${s.t}: <b>${esc(s.su)}</b></button>`).join('')}</div>`}</div>`;
}
const fmScroll = id => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);

const PK = { ctx: null, host: null, q: '', f: 'all', g: '', limit: 40, groups: [] };
const pkUsers = () => allUsersCache.filter(u => !u.banned).map(u => ({ id: u.id, name: u.display_name || u.username, sub: '@' + u.username + (WS.list.length > 1 && u.workspace_name ? ' · ' + (u.workspaces || [{ name: u.workspace_name }]).map(w => w.name).join(', ') : ''), tag: u.tag || '',
  av: avHtml(u.display_name || u.username, 26, 8, u.id, false, u.has_avatar) }));
const pkChats = () => AN.chats.map(c => ({ id: c.id, name: chName(c), sub: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа',
  tag: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа', av: chAv(c, 26) }));
function pkCfg(ctx) {
  if (ctx === 'room') return { title: 'Участники комнаты', people: true, items: pkUsers, sel: () => RM.form.members, rerender: f => rmRenderForm(f) };
  const chat = AN.form?.kind === 'chat';
  return { title: chat ? 'Куда отправить' : 'Кому отправить', people: !chat, items: chat ? pkChats : pkUsers, sel: () => AN.form.who, rerender: f => anRenderForm(f) };
}
const pkNoun = (c, n) => c.people ? uxPlural(n, 'человек', 'человека', 'человек') : uxPlural(n, 'чат', 'чата', 'чатов');
function pkFound() {
  const c = pkCfg(PK.ctx), sel = c.sel(), q = PK.q.trim().toLowerCase();
  return c.items().filter(p => (!q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q))
    && (!PK.g || (p.tag || 'Без тега') === PK.g) && (PK.f === 'all' || (PK.f === 'sel') === sel.has(p.id)));
}
function pkSummary(ctx, label) {
  const c = pkCfg(ctx), items = c.items(), sel = c.sel(), chosen = items.filter(p => sel.has(p.id));
  const short = n => n.length > 22 ? n.slice(0, 21) + '…' : n;
  const chips = chosen.slice(0, 5).map(p => `<span class="fm-chip static">${esc(short(p.name))}<button type="button" aria-label="Убрать" data-on-click="pkRm" data-a-click="${esc(JSON.stringify([`${ctx}`, p.id]))}">×</button></span>`).join('')
    + (chosen.length > 5 ? `<button type="button" class="fm-chip cnt" data-on-click="pkOpen" data-a-click="${esc(JSON.stringify([`${ctx}`]))}">+${chosen.length - 5}</button>` : '');
  return `<div class="fm-pick"><div class="fm-pickhead"><span class="fm-pill ${chosen.length ? 'on' : ''}">${chosen.length ? `${chosen.length} ${pkNoun(c, chosen.length)}` : 'никого'}</span><span class="ua-hint">из ${items.length}</span></div>
    ${chips ? `<div class="fm-chips2">${chips}</div>` : ''}
    <div class="fm-pickacts"><button type="button" class="btn ux-solid btn-sm" data-on-click="pkOpen" data-a-click="${esc(JSON.stringify([`${ctx}`]))}">${label}</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="pkAll" data-a-click="${esc(JSON.stringify([`${ctx}`]))}">Добавить всех (${items.length})</button>${chosen.length ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="pkClear" data-a-click="${esc(JSON.stringify([`${ctx}`]))}">Очистить</button>` : ''}</div></div>`;
}
function pkSheet() {
  if (!PK.ctx) return '';
  const c = pkCfg(PK.ctx), items = c.items(), sel = c.sel();
  const gm = new Map(); items.forEach(p => { const g = p.tag || 'Без тега'; gm.set(g, (gm.get(g) || 0) + 1); });
  const groups = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  PK.groups = groups.map(g => g[0]);
  if (PK.g && !PK.groups.includes(PK.g)) PK.g = '';
  const found = pkFound(), shown = found.slice(0, PK.limit), allSel = found.length > 0 && found.every(p => sel.has(p.id));
  const roomsCopy = PK.ctx === 'room' ? allRooms.filter(r => !RM.form.id || r.id !== RM.form.id) : [];
  return `<div class="fm-sheet"><div class="fm-sh"><button type="button" class="modal-close" data-on-click="pkClose" aria-label="Назад">‹</button>
    <div><div class="t">${c.title}</div><div class="s">${items.length} ${c.people ? 'людей' : 'чатов'}: найдите, отметьте, нажмите «Готово»</div></div><span class="fm-pill on" style="margin-left:auto">${sel.size}</span></div>
    <div class="fm-tools"><label class="ux-search" style="min-width:0">${UX_I.search}<input id="pk-q" value="${esc(PK.q)}" placeholder="Имя, логин или тег" autocomplete="off" data-on-input="pkSearch" data-a-input='["__value"]'></label>
      <div class="fm-grp" role="group" aria-label="Показать">${[['all', 'Все', items.length], ['sel', 'Выбранные', sel.size], ['unsel', 'Не выбранные', items.length - sel.size]].map(([v, l, n]) => `<button type="button" data-on-click="pkFilter" data-a-click="${esc(JSON.stringify([`${v}`]))}" aria-pressed="${PK.f === v}">${l}<small>${n}</small></button>`).join('')}</div>
      ${groups.length > 1 ? `<div class="fm-grp" role="group" aria-label="Группа"><button type="button" data-on-click="pkGroup" data-a-click='[-1]' aria-pressed="${!PK.g}">Все группы</button>${groups.map((g, i) => `<button type="button" data-on-click="pkGroup" data-a-click="${esc(JSON.stringify([i]))}" aria-pressed="${PK.g === g[0]}">${esc(g[0])}<small>${g[1]}</small></button>`).join('')}</div>` : ''}
      <div class="fm-acts"><button type="button" class="btn btn-ghost btn-sm" data-on-click="pkSelFound" ${found.length && !allSel ? '' : 'disabled'}>Выбрать найденных (${found.length})</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="pkUnselFound" ${found.some(p => sel.has(p.id)) ? '' : 'disabled'}>Снять</button>
        ${roomsCopy.length ? `<select aria-label="Добавить участников другой комнаты" title="Добавить участников другой комнаты" data-on-change="pkCopy" data-a-change='["__this"]'><option value="">Из комнаты…</option>${roomsCopy.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>` : ''}</div></div>
    <div class="fm-list">${shown.map(p => `<button type="button" class="fm-li" aria-pressed="${sel.has(p.id)}" data-on-click="pkToggle" data-a-click="${esc(JSON.stringify([p.id]))}">${p.av}<span class="n">${esc(p.name)}<small>${esc(p.sub)}</small></span>${p.tag ? `<span class="tg2">${esc(p.tag)}</span>` : ''}<span class="ck">${sel.has(p.id) ? '✓' : ''}</span></button>`).join('') || '<div class="fm-empty">Ничего не найдено. Измените запрос или фильтр</div>'}
      ${found.length > shown.length ? `<button type="button" class="btn btn-ghost btn-sm" style="align-self:center;margin:4px 0" data-on-click="pkMore">Показать ещё ${Math.min(40, found.length - shown.length)} из ${found.length - shown.length}</button>` : ''}</div>
    <div class="fm-sf"><span class="fm-note">Выбрано <b>${sel.size}</b> из ${items.length}</span><button type="button" class="btn ux-solid" data-on-click="pkClose">Готово</button></div></div>`;
}
function pkRender(focusId, keep) {
  const sc = keep ? document.querySelector('.fm-sheet .fm-list')?.scrollTop : 0;
  pkCfg(PK.host).rerender(focusId);
  if (keep && sc) { const l = document.querySelector('.fm-sheet .fm-list'); if (l) l.scrollTop = sc; }
}
function pkOpen(ctx) { Object.assign(PK, { ctx, host: ctx, q: '', f: 'all', g: '', limit: 40 }); pkRender('pk-q'); }
function pkClose() {
  const sh = document.querySelector('.fm-sheet');
  if (!sh) { PK.ctx = null; pkRender(); return; }
  if (sh.classList.contains('out')) return;
  sh.classList.add('out');
  setTimeout(() => { PK.ctx = null; pkRender(); }, 150);
}
function pkSearch(v) { PK.q = v; PK.limit = 40; pkRender('pk-q'); }
function pkFilter(v) { PK.f = v; PK.limit = 40; pkRender(); }
function pkGroup(i) { PK.g = i < 0 ? '' : PK.groups[i]; PK.limit = 40; pkRender(); }
function pkToggle(id) { const sel = pkCfg(PK.ctx).sel(); sel.has(id) ? sel.delete(id) : sel.add(id); pkRender(null, true); }
function pkSelFound() { const sel = pkCfg(PK.ctx).sel(); pkFound().forEach(p => sel.add(p.id)); pkRender(null, true); }
function pkUnselFound() { const sel = pkCfg(PK.ctx).sel(); pkFound().forEach(p => sel.delete(p.id)); pkRender(null, true); }
function pkMore() { PK.limit += 40; pkRender(null, true); }
function pkAll(ctx) { const c = pkCfg(ctx), sel = c.sel(); c.items().forEach(p => sel.add(p.id)); PK.host = ctx; c.rerender(); }
function pkClear(ctx) { const c = pkCfg(ctx); c.sel().clear(); PK.host = ctx; c.rerender(); }
function pkRm(ctx, id) { const c = pkCfg(ctx); c.sel().delete(id); PK.host = ctx; c.rerender(); }
async function pkCopy(el) {
  const id = Number(el.value); el.value = '';
  if (!id) return;
  const members = (await api('GET', `/api/admin/chats/${id}/members`)) || [], sel = pkCfg(PK.ctx).sel();
  members.forEach(m => sel.add(m.id));
  toast(`Добавлены участники комнаты «${esc(allRooms.find(r => r.id === id)?.name || '')}»`, 'success');
  pkRender(null, true);
}
// Escape закрывает лист выбора, а не всё окно
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PK.ctx) { e.preventDefault(); e.stopImmediatePropagation(); pkClose(); } }, true);

// ── Окно: добавление и изменение ──
// Пространства человека (номера): у нового основное, у существующего его членства
const uaUserWs = u => u ? ((u.workspaces || []).map(w => w.id).length ? u.workspaces.map(w => w.id) : [u.workspace_id || 1]) : [1];
// Состоит ли человек в пространстве; чипы его пространств (два и «+N»)
const uaInWs = (u, id) => (u.workspaces || [{ id: u.workspace_id }]).some(w => w.id === id);
function uaWsPills(u) {
  const list = u.workspaces?.length ? u.workspaces : [{ name: u.workspace_name }];
  const shown = list.slice(0, 2), rest = list.length - shown.length;
  return shown.map(w => `<span class="ws-pill">${esc(w.name)}</span>`).join(' ') + (rest > 0 ? ` <span class="ws-pill more" title="${esc(list.slice(2).map(w => w.name).join(', '))}">+${rest}</span>` : '');
}
const uaBlank = u => ({ name: u?.display_name || '', login: u?.username || '', tag: u?.tag || '', admin: !!u?.is_admin,
  totpRequired: !!u?.totp_required, canAnnounce: !!u?.can_announce, wss: uaUserWs(u), wsOpen: false, wsErr: false,
  password: '', show: false, pwOpen: false, generated: false, closeSessions: true, errors: {}, busy: false, more: false });
const uaAv = (name, size) => `<span class="av" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * .26)}px;font-size:${Math.round(size * .36)}px;background:${avColor(name || '?')}">${esc(initials(name))}</span>`;

function openCreateUser() {
  UA.editId = null;
  UA.form = uaBlank();
  uaMakePw(UA.form);   // пароль придумывается сам: его видно в окне, при желании меняется в «Дополнительно»
  document.getElementById('ua-pass-form').innerHTML = '';
  uaRenderForm();
  openModal('modal-user');
  setTimeout(() => document.getElementById('ua-name')?.focus(), 60);
}
function openEditUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  UA.editId = id;
  UA.form = uaBlank(u);
  document.getElementById('ua-pass-form').innerHTML = '';
  uaRenderForm();
  openModal('modal-user');
  setTimeout(() => document.getElementById('ua-name')?.focus(), 60);
}

function uaProfileSection(f) {
  const err = k => f.errors[k] ? `<span class="ua-err">${f.errors[k]}</span>` : '';
  return `<div class="ua-sec">
    <div class="ua-sec-title">Профиль</div>
    <div class="ua-field"><label for="ua-name">Имя и фамилия</label>
      <div class="ua-inp${f.errors.name ? ' bad' : ''}"><input id="ua-name" value="${esc(f.name)}" placeholder="Анна Смирнова" autocomplete="off" aria-invalid="${!!f.errors.name}" data-on-input="uaSet" data-a-input='["name", "__value"]'></div>${err('name')}</div>
    <div class="ua-row2">
      <div class="ua-field"><label for="ua-login">Логин</label>
        <div class="ua-inp${f.errors.login ? ' bad' : ''}"><span class="pre">@</span><input id="ua-login" value="${esc(f.login)}" placeholder="a.smirnova" autocomplete="off" spellcheck="false" aria-invalid="${!!f.errors.login}"
          data-on-input="__h39"></div>
        ${err('login') || '<span class="ua-hint">Латиница, цифры, точка</span>'}</div>
      <div class="ua-field"><label for="ua-tag">Тег <span class="opt">· необязательно</span></label>
        <div class="ua-inp"><input id="ua-tag" value="${esc(f.tag)}" maxlength="20" placeholder="HR, Dev, Склад" autocomplete="off" data-on-input="uaSet" data-a-input='["tag", "__value"]'></div>
        <span class="ua-hint">Виден рядом с именем в чате</span></div>
    </div>
    <div class="ua-preview" aria-hidden="true"><span id="ua-pv-av">${uaAv(f.name, 32)}</span>
      <div><div class="ua-pv-name" id="ua-pv-name">${f.name ? esc(f.name) : '<span class="ph">Имя появится здесь</span>'}${uxTag(f.tag)}</div><div class="ua-pv-bubble">Так человека увидят в чате</div></div></div>
  </div>`;
}
function uaAccessSection(f, editing, u) {
  return `<div class="ua-sec">
    <div class="ua-sec-title">Доступ</div>
    <div class="ua-roles" role="radiogroup" aria-label="Роль">
      <button type="button" role="radio" class="ua-role-opt" aria-checked="${!f.admin}" data-on-click="uaSet" data-a-click='["admin", false, true]'><b>Пользователь</b><span>Чаты, комнаты и файлы</span></button>
      <button type="button" role="radio" class="ua-role-opt" aria-checked="${f.admin}" data-on-click="uaSet" data-a-click='["admin", true, true]'><b>${UX_I.shield}Администратор</b><span>И управление в этой панели</span></button>
    </div>
    ${f.admin ? uaTotpSection(f, editing, u) : uaAnnSection(f)}
    ${editing && !f.pwOpen
      ? `<div class="ua-pw-closed"><div><b>Пароль</b><span>Остаётся прежним</span></div><button type="button" class="btn btn-ghost btn-sm" data-on-click="uaSet" data-a-click='["pwOpen", true, true, "ua-pass"]'>${UX_I.key}Сменить пароль</button></div>`
      : uaPasswordField(f, editing)}
  </div>`;
}
// Право отправлять объявления из клиента: кнопка с колокольчиком у человека в шапке, окно как в этой панели.
// Админам не нужно: у них это есть в панели.
function uaAnnSection(f) {
  return `<div class="ua-totp-box" style="margin-top:10px">
    <div class="ua-totp-row">
      <div><b>Отправлять объявления</b><span>В клиенте появится кнопка с колокольчиком: всплывающее, полоса и сообщение в чаты, как у администратора. Объявление уходит от имени системы, автор виден только здесь, в журнале</span></div>
      <label class="toggle-switch" style="gap:0">
        <input type="checkbox" ${f.canAnnounce ? 'checked' : ''} data-on-change="uaSet" data-a-change='["canAnnounce", "__checked"]'>
        <div class="toggle-track"><div class="toggle-thumb"></div></div>
      </label>
    </div>
  </div>`;
}
// 2FA защищает только вход в САМУ админ-панель (не обычный чат-клиент — там
// как был логин/пароль, так и остаётся). Настраивает её сам администратор при
// следующем входе — здесь только требование и аварийный сброс.
function uaTotpSection(f, editing, u) {
  const configured = !!u?.totp_configured;
  return `<div class="ua-totp-box" style="margin-top:10px">
    <div class="ua-totp-row">
      <div><b>Требовать 2FA</b><span>При входе в админ-панель запросит код из приложения-аутентификатора${configured ? '' : ' (настроит при первом входе)'}</span></div>
      <label class="toggle-switch" style="gap:0">
        <input type="checkbox" ${f.totpRequired ? 'checked' : ''} data-on-change="uaSet" data-a-change='["totpRequired", "__checked"]'>
        <div class="toggle-track"><div class="toggle-thumb"></div></div>
      </label>
    </div>
    ${editing && configured ? `<div class="ua-totp-row">
      <div><b>Сбросить 2FA</b><span>Если потерян доступ к приложению-аутентификатору</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-on-click="__h40" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.key}Сбросить</button>
    </div>` : ''}
  </div>`;
}
function uaResetTotp(id) {
  const name = uaNames([id])[0] || '';
  confirm('Сбросить 2FA?',
    `«${esc(name)}» настроит её заново при следующем входе в админ-панель.`,
    async () => {
      const r = await api('POST', `/api/admin/users/${id}/totp/reset`);
      if (r?.error) { toast(esc(r.error), 'error'); return; }
      toast('2FA сброшена', 'success');
      if (currentPage === 'users') renderUsers();
      uaRerender();
    });
}
function uaPasswordField(f, editing) {
  const s = uaStrength(f.password);
  return `<div class="ua-field"><label for="ua-pass">${editing ? 'Новый пароль' : 'Пароль'}</label>
    <div class="ua-inp${f.errors.password ? ' bad' : ''}"><input id="ua-pass" type="${f.show ? 'text' : 'password'}" value="${esc(f.password)}" placeholder="Не короче 6 символов" autocomplete="new-password" aria-invalid="${!!f.errors.password}" data-on-input="uaSet" data-a-input='["password", "__value"]'>
      <button type="button" class="ua-sfx" aria-label="${f.show ? 'Скрыть пароль' : 'Показать пароль'}" data-on-click="__h41">${f.show ? UX_I.eyeOff : UX_I.eye}</button>
      <button type="button" class="ua-sfx" data-on-click="uaGenerate">${UX_I.wand}Придумать</button></div>
    <div class="ua-strength${s.good ? ' good' : ''}" id="ua-strength">${s.html}</div>
    ${f.errors.password ? `<span class="ua-err">${f.errors.password}</span>` : ''}
    <div id="ua-creds">${uaCreds(f)}</div>
  </div>`;
}
const uaCreds = f => f.generated && f.password
  ? `<div class="ua-creds"><div><span>Данные для входа</span><code>@${esc(f.login || 'логин')} · ${esc(f.password)}</code></div><button type="button" class="btn btn-ghost btn-sm" data-on-click="uaCopy">${UX_I.copy}Скопировать</button></div>`
  : '';
function uaStrength(p) {
  const score = !p ? 0 : [p.length >= 6, p.length >= 10, /\d/.test(p) && /[a-zа-яё]/i.test(p), /[^a-zа-яё0-9]/i.test(p) || /[A-ZА-ЯЁ]/.test(p)].filter(Boolean).length;
  const label = !p ? '' : p.length < 6 ? 'Короткий' : score <= 2 ? 'Простой' : score === 3 ? 'Хороший' : 'Надёжный';
  return { good: score >= 3 && p.length >= 6, html: [0, 1, 2, 3].map(i => `<i class="${i < score ? 'on' : ''}"></i>`).join('') + `<span>${label}</span>` };
}
function uaDangerZone(u) {
  const devices = (u.clients || []).length;
  return `<details class="ua-dz"><summary>${UX_I.chev}Действия с учётной записью</summary>
    <div class="ua-dz-row"><div><b>Завершить все сеансы</b><span>Выход на всех устройствах; войти снова можно</span></div>
      <button type="button" class="btn btn-ghost btn-sm" ${devices ? '' : 'disabled'} data-on-click="__h42" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.logout}Завершить</button></div>
    <div class="ua-dz-row"><div><b>${u.banned ? 'Разблокировать' : 'Заблокировать'}</b><span>${u.banned ? 'Снова сможет входить' : 'Не сможет войти, пока не разблокируете'}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-on-click="uaBanModal" data-a-click="${esc(JSON.stringify([u.id, !!u.banned]))}">${u.banned ? UX_I.unban + 'Разблокировать' : UX_I.ban + 'Заблокировать'}</button></div>
    <div class="ua-dz-row"><div><b>Удалить пользователя</b><span>Навсегда; сообщения в чатах останутся</span></div>
      <button type="button" class="btn btn-danger btn-sm" data-on-click="__h44" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.trash}Удалить</button></div>
  </details>`;
}

function uaRestoreFocus(fn, focusId) {
  const a = document.activeElement, id = focusId || a?.id, caret = focusId ? null : a?.selectionStart;
  fn();
  const el = id && document.getElementById(id);
  if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch {} }
}
const uaMissing = (f, editing) => {
  const m = [];
  if (!f.name.trim()) m.push('имя');
  if (!f.login.trim()) m.push('логин');
  if ((!editing || f.pwOpen) && f.password.length < 6) m.push('пароль');
  return m;
};
function uaMakePw(f) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  f.password = [...crypto.getRandomValues(new Uint32Array(12))].map(n => abc[n % abc.length]).join('').replace(/^(.{4})(.{4})/, '$1-$2-');
  f.show = true; f.generated = true;
}
const uaMore = id => { UA.form.more = id ? true : !UA.form.more; uaRenderForm(); if (id) fmScroll('ua-sec-' + id); };
function uaFootSync() {
  const f = UA.form; if (!f) return;
  const miss = uaMissing(f, !!UA.editId), n = document.getElementById('ua-note'), b = document.getElementById('ua-go'), ap = document.getElementById('ua-auto-pw');
  if (n) { n.innerHTML = fmNote(miss); n.classList.toggle('ok', !miss.length); }
  if (b) b.disabled = !!f.busy || !!miss.length;
  if (ap) ap.textContent = f.password;
}
// Выбор пространств: выпадающий список с галочками. Выбранные — чипами в поле, оставить нужно хотя бы одно
const UA_CHEV = '<svg class="chev" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const UA_TICK = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
function uaWsField(f, u) {
  const sel = f.wss, name = id => WS.list.find(w => w.id === id)?.name || '—';
  const removed = u ? uaUserWs(u).filter(id => !sel.includes(id)) : [];
  const warn = removed.length ? `<div class="ws-warn"><b>!</b><div>Человек перестанет видеть людей из ${removed.length > 1 ? 'пространств' : 'пространства'} «${removed.map(id => esc(name(id))).join('», «')}» и пропадёт у них в списках. Чаты, группы и комнаты сохранятся.</div></div>` : '';
  return `<div class="ua-field"><label id="ua-ws-l">Пространства</label>
    <div class="uaws" id="ua-ws"><button type="button" class="uaws-btn" aria-haspopup="listbox" aria-labelledby="ua-ws-l" aria-expanded="${f.wsOpen}" data-on-click="uaWsOpen" data-a-click='["__event"]'>
      ${sel.map(id => `<span class="ws-pill">${esc(name(id))}</span>`).join('')}${UA_CHEV}</button>
      <div class="uaws-pop" role="listbox" aria-multiselectable="true" ${f.wsOpen ? '' : 'hidden'}>
        ${WS.list.map(w => `<button type="button" role="option" class="uaws-opt" aria-checked="${sel.includes(w.id)}" data-on-click="uaWsToggle" data-a-click="${esc(JSON.stringify([w.id]))}"><span class="uaws-ck">${UA_TICK}</span><span class="n">${esc(w.name)}</span>${w.id === 1 ? '<span class="m">по умолчанию</span>' : ''}</button>`).join('')}
        <div class="uaws-foot">Выберите одно или несколько</div></div></div>
    <span class="${f.wsErr ? 'ua-err' : 'ua-hint'}">${f.wsErr ? 'Нужно оставить хотя бы одно пространство' : 'Человек виден в выбранных пространствах и видит людей из них'}</span>${warn}</div>`;
}
function uaWsOpen(e) { e.stopPropagation(); const f = UA.form; if (!f) return; f.wsOpen = !f.wsOpen; uaRerender(); }
function uaWsToggle(id) {
  const f = UA.form; if (!f) return;
  if (f.wss.includes(id)) {
    if (f.wss.length === 1) { f.wsErr = true; return uaRerender(); }
    f.wss = f.wss.filter(x => x !== id);
  } else f.wss = [...f.wss, id].sort((a, b) => a - b);
  f.wsErr = false; uaRerender();
}
// Список закрывается по нажатию вне него
document.addEventListener('click', e => { const f = UA.form; if (f && f.wsOpen && !e.target.closest('#ua-ws')) { f.wsOpen = false; uaRerender(); } });
function uaRenderForm(focusId) {
  const f = UA.form, u = UA.editId ? allUsers.find(x => x.id === UA.editId) : null;
  const form = document.getElementById('ua-form');
  if (!form || !f) return;
  const editing = !!u, miss = uaMissing(f, editing);
  const err = k => f.errors[k] ? `<span class="ua-err">${f.errors[k]}</span>` : '';
  const wsPick = WS.list.length > 1 || (u && !(uaUserWs(u).length === 1 && uaUserWs(u)[0] === 1)) ? uaWsField(f, u) : '';
  const quick = `<div class="ua-sec">
      <div class="ua-field"><label for="ua-name">Имя и фамилия</label>
        <div class="ua-inp${f.errors.name ? ' bad' : ''}"><input id="ua-name" value="${esc(f.name)}" placeholder="Анна Смирнова" autocomplete="off" aria-invalid="${!!f.errors.name}" data-on-input="uaSet" data-a-input='["name", "__value"]'></div>${err('name')}</div>
      <div class="ua-row2">
        <div class="ua-field"><label for="ua-login">Логин</label>
          <div class="ua-inp${f.errors.login ? ' bad' : ''}"><span class="pre">@</span><input id="ua-login" value="${esc(f.login)}" placeholder="a.smirnova" autocomplete="off" spellcheck="false" aria-invalid="${!!f.errors.login}"
            data-on-input="__h39"></div>
          ${err('login') || '<span class="ua-hint">Латиница, цифры, точка</span>'}</div>
        <div class="ua-field"><label for="ua-tag">Тег <span class="opt">· необязательно</span></label>
          <div class="ua-inp"><input id="ua-tag" value="${esc(f.tag)}" maxlength="20" placeholder="HR, Dev, Склад" autocomplete="off" data-on-input="uaSet" data-a-input='["tag", "__value"]'></div>
          <span class="ua-hint">Виден рядом с именем в чате</span></div>
      </div></div>
    ${wsPick}
    ${!editing ? `<div class="fm-pw">${UX_I.key}<span>${f.generated ? 'Пароль придуман:' : 'Пароль:'}</span><code id="ua-auto-pw">${esc(f.password)}</code>
        <button type="button" class="btn btn-ghost btn-sm" data-on-click="uaCopy" title="Скопировать логин и пароль" aria-label="Скопировать логин и пароль">${UX_I.copy}</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="uaGenerate">Другой</button></div>${err('password')}` : ''}`;
  const accessSu = f.admin ? 'Администратор' + (f.totpRequired ? ' · 2FA' : '') : 'Пользователь' + (f.canAnnounce ? ' · объявления' : '');
  const pwSu = editing ? (f.pwOpen ? 'Будет изменён' : 'Остаётся прежним') : (f.generated ? 'Придуман автоматически' : f.password ? 'Задан вручную' : 'Не задан');
  const secs = [
    { id: 'a', t: 'Доступ', su: accessSu, body: `<div class="ua-roles" role="radiogroup" aria-label="Роль">
        <button type="button" role="radio" class="ua-role-opt" aria-checked="${!f.admin}" data-on-click="uaSet" data-a-click='["admin", false, true]'><b>Пользователь</b><span>Чаты, комнаты и файлы</span></button>
        <button type="button" role="radio" class="ua-role-opt" aria-checked="${f.admin}" data-on-click="uaSet" data-a-click='["admin", true, true]'><b>${UX_I.shield}Администратор</b><span>И управление в этой панели</span></button></div>
      ${f.admin ? uaTotpSection(f, editing, u) : uaAnnSection(f)}` },
    { id: 'w', t: 'Пароль', su: pwSu, body: editing && !f.pwOpen
        ? `<div class="ua-pw-closed"><div><b>Пароль</b><span>Остаётся прежним</span></div><button type="button" class="btn btn-ghost btn-sm" data-on-click="uaSet" data-a-click='["pwOpen", true, true, "ua-pass"]'>${UX_I.key}Сменить пароль</button></div>`
        : uaPasswordField(f, editing) },
    ...(u && u.id !== currentUser?.id ? [{ id: 'z', t: 'Действия с учётной записью', su: 'Сеансы, блокировка, удаление', body: uaDangerRows(u) }] : []),
  ];
  uaRestoreFocus(() => {
    form.innerHTML = `
      <div class="ua-head"><span id="ua-head-av">${uaAv(f.name, 38)}</span>
        <div><div class="ua-title">${u ? esc(u.display_name) : 'Новый пользователь'}</div>
          <div class="ua-sub">${u ? `@${esc(u.username)} · создан ${fmtDate(u.created_at)}` : 'Имя и логин, остальное можно позже'}</div></div>
        <button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-user"]'>✕</button></div>
      <div class="ua-body">${quick}${fmMoreHtml('ua', f.more, 'uaMore', secs)}</div>
      <div class="ua-foot">${f.errors.form ? `<span class="ua-err">${esc(f.errors.form)}</span>` : ''}<span class="fm-note ${miss.length ? '' : 'ok'}" id="ua-note">${fmNote(miss)}</span>
        <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-user"]'>Отмена</button>
        <button class="btn ux-solid" id="ua-go" ${f.busy || miss.length ? 'disabled' : ''}>${f.busy ? 'Сохраняю…' : u ? 'Сохранить' : 'Создать'}</button></div>`;
  }, focusId);
}
function uaDangerRows(u) {
  const devices = (u.clients || []).length;
  return `<div class="ua-dz-row"><div><b>Завершить все сеансы</b><span>Выход на всех устройствах; войти снова можно</span></div>
      <button type="button" class="btn btn-ghost btn-sm" ${devices ? '' : 'disabled'} data-on-click="__h42" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.logout}Завершить</button></div>
    <div class="ua-dz-row"><div><b>${u.banned ? 'Разблокировать' : 'Заблокировать'}</b><span>${u.banned ? 'Снова сможет входить' : 'Не сможет войти, пока не разблокируете'}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-on-click="uaBanModal" data-a-click="${esc(JSON.stringify([u.id, !!u.banned]))}">${u.banned ? UX_I.unban + 'Разблокировать' : UX_I.ban + 'Заблокировать'}</button></div>
    <div class="ua-dz-row"><div><b>Удалить пользователя</b><span>Навсегда; сообщения в чатах останутся</span></div>
      <button type="button" class="btn btn-danger btn-sm" data-on-click="__h44" data-a-click="${esc(JSON.stringify([u.id]))}">${UX_I.trash}Удалить</button></div>`;
}
function uaRenderPassword(focusId) {
  const f = UA.form, u = allUsers.find(x => x.id === UA.passId);
  const form = document.getElementById('ua-pass-form');
  if (!form || !f || !u) return;
  uaRestoreFocus(() => {
    form.innerHTML = `
      <div class="ua-head">${avHtml(u.display_name, 34, 9, u.id, false, u.has_avatar)}
        <div><div class="ua-title">Новый пароль</div><div class="ua-sub">${esc(u.display_name)} · @${esc(u.username)}</div></div>
        <button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-user-pass"]'>✕</button></div>
      <div class="ua-body">${uaPasswordField(f, true)}
        <label class="ua-check"><input type="checkbox" ${f.closeSessions ? 'checked' : ''} data-on-change="__h45">Завершить сеансы на всех устройствах</label></div>
      <div class="ua-foot">${f.errors.form ? `<span class="ua-err">${esc(f.errors.form)}</span>` : ''}<span class="ux-grow"></span>
        <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-user-pass"]'>Отмена</button>
        <button class="btn ux-solid" ${f.busy ? 'disabled' : ''}>${f.busy ? 'Сохраняю…' : 'Сохранить пароль'}</button></div>`;
  }, focusId);
}
const uaRerender = focusId => UA.passId ? uaRenderPassword(focusId) : uaRenderForm(focusId);

function uaSet(key, value, rerender, focusId) {
  const f = UA.form;
  if (!f) return;
  f[key] = value;
  if (key === 'password') f.generated = false;
  if (f.errors[key]) { delete f.errors[key]; rerender = true; }
  if (rerender) return uaRerender(focusId);
  // Превью обновляем точечно, без перерисовки формы — чтобы не терять курсор
  if (key === 'name' || key === 'tag') {
    const pv = document.getElementById('ua-pv-av'); if (pv) pv.innerHTML = uaAv(f.name, 32);
    const hv = document.getElementById('ua-head-av'); if (hv) hv.innerHTML = uaAv(f.name, 38);
    const pn = document.getElementById('ua-pv-name'); if (pn) pn.innerHTML = (f.name ? esc(f.name) : '<span class="ph">Имя появится здесь</span>') + uxTag(f.tag);
  }
  if (key === 'password') {
    const s = uaStrength(f.password), el = document.getElementById('ua-strength');
    if (el) { el.className = 'ua-strength' + (s.good ? ' good' : ''); el.innerHTML = s.html; }
  }
  if (key === 'login' || key === 'password') { const c = document.getElementById('ua-creds'); if (c) c.innerHTML = uaCreds(f); }
  if (key === 'name' || key === 'login' || key === 'password') uaFootSync();
}
function uaGenerate() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const p = [...crypto.getRandomValues(new Uint32Array(12))].map(n => abc[n % abc.length]).join('').replace(/^(.{4})(.{4})/, '$1-$2-');
  Object.assign(UA.form, { password: p, show: true, generated: true });
  delete UA.form.errors.password;
  uaRerender(UA.form.more || UA.passId ? 'ua-pass' : null);
}
async function uaCopy() {
  const f = UA.form;
  try { await navigator.clipboard.writeText(`Логин: ${f.login}\nПароль: ${f.password}`); toast('Данные для входа скопированы', 'success'); }
  catch { toast('Не удалось скопировать — выделите текст вручную', 'error'); }
}

async function uaSave() {
  const f = UA.form, u = UA.editId ? allUsers.find(x => x.id === UA.editId) : null;
  if (!f || f.busy) return;
  const e = {};
  if (!f.name.trim()) e.name = 'Укажите имя';
  if (!f.login.trim()) e.login = 'Укажите логин';
  if ((!u || f.pwOpen) && f.password.length < 6) e.password = u ? 'Не короче 6 символов — или обновите окно, чтобы оставить прежний' : 'Не короче 6 символов';
  f.errors = e;
  if (e.password && !(e.name || e.login)) f.more = true;
  if (Object.keys(e).length) return uaRenderForm(e.name ? 'ua-name' : e.login ? 'ua-login' : 'ua-pass');

  f.busy = true;
  uaRenderForm();
  const body = { username: f.login.trim(), display_name: f.name.trim(), is_admin: f.admin, tag: f.tag.trim() || null, workspace_ids: f.wss };
  let r;
  if (u) {
    r = await api('PATCH', '/api/users/' + u.id, body);
    if (r?.ok && f.pwOpen) {
      const p = await api('PATCH', `/api/users/${u.id}/password`, { password: f.password });
      if (!p?.ok) r = { error: p?.error || 'Пароль не сохранён' };
    }
  } else {
    r = await api('POST', '/api/users', { ...body, password: f.password });
  }
  if ((r?.ok || r?.id) && f.admin) {
    const userId = u ? u.id : r.id;
    await api('PATCH', `/api/admin/users/${userId}/totp`, { required: f.totpRequired });
  }
  if ((r?.ok || r?.id) && !f.admin && f.canAnnounce !== !!u?.can_announce) {
    await api('PATCH', `/api/admin/users/${u ? u.id : r.id}/announce`, { allowed: f.canAnnounce });
  }
  f.busy = false;
  if (r?.ok || r?.id) {
    closeModal('modal-user');
    toast(u ? (f.pwOpen ? 'Сохранено, пароль изменён' : 'Сохранено') : 'Пользователь добавлен', 'success');
    if (currentPage === 'users') renderUsers();
    updateNavBadges();
    return;
  }
  if (/exists/i.test(r?.error || '')) f.errors.login = 'Такой логин уже есть';
  else f.errors.form = r?.error || 'Не удалось сохранить';
  uaRenderForm(f.errors.login ? 'ua-login' : null);
}

function uaOpenPassword(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  UA.passId = id;
  UA.form = { ...uaBlank(u), pwOpen: true };
  document.getElementById('ua-form').innerHTML = '';
  uaRenderPassword();
  openModal('modal-user-pass');
  setTimeout(() => document.getElementById('ua-pass')?.focus(), 60);
}
async function uaSavePassword() {
  const f = UA.form, id = UA.passId;
  if (!f || f.busy) return;
  if (f.password.length < 6) { f.errors.password = 'Не короче 6 символов'; return uaRenderPassword('ua-pass'); }
  f.busy = true;
  uaRenderPassword();
  const r = await api('PATCH', `/api/users/${id}/password`, { password: f.password });
  if (r?.ok && f.closeSessions) await api('POST', `/api/admin/users/${id}/logout`);
  f.busy = false;
  if (!r?.ok) { f.errors.form = r?.error || 'Не удалось сменить пароль'; return uaRenderPassword(); }
  closeModal('modal-user-pass');
  UA.passId = null;
  toast(f.closeSessions ? 'Пароль изменён, сеансы завершены' : 'Пароль изменён', 'success');
  if (currentPage === 'users') renderUsers();
}
// Окно пароля закрыли без сохранения — следующая перерисовка формы идёт в окно пользователя
document.getElementById('modal-user-pass')?.addEventListener('animationend', e => {
  if (e.currentTarget.classList.contains('closing')) UA.passId = null;
});

/* ── CHATS ── */
// Раздел «Чаты и группы»: сводка, фильтры, таблица. У личного чата — оба собеседника,
// у группы — стопка участников. Пустые чаты вынесены в фильтр и удаляются разом.

const CH = { filter: 'all', q: '', sort: 'last', open: new Set(), fresh: null, sel: new Set(), openId: null, members: [] };
const chName = c => c.type === 'direct' ? ((c.member_names || []).join(' → ') || 'Личный чат') : (c.name || 'Группа');
const chAv = (c, size) => c.type === 'direct'
  ? `<span class="rm-pair">${(c.members || []).slice(0, 2).map(m => avHtml(m.name, 26, 8, m.id, false, m.has_avatar)).join('')}</span>`
  : avHtml(c.name || '?', size, 9, null, false, c.has_avatar, c.id);

async function renderChats() {
  const [raw, users] = await Promise.all([api('GET', '/api/admin/chats'), api('GET', '/api/admin/users')]);
  if (Array.isArray(users)) allUsersCache = users;
  allChats = raw.filter(c => c.type !== 'room');
  const ids = new Set(allChats.map(c => c.id));
  CH.sel.forEach(id => { if (!ids.has(id)) CH.sel.delete(id); });
  chRender();
}

// У личного чата первым идёт тот, кто его начал: «кто → кому»
const chPair = c => {
  const m = c.members || [];
  const from = m.find(x => x.id === c.created_by) || m[0], to = m.find(x => x !== from) || m[1];
  return [from, to];
};
const chTitle = c => c.type === 'direct' ? (() => { const [a, b] = chPair(c); return a && b ? `${esc(a.name)} <span class="arr" style="color:var(--c-muted);font-weight:500">→</span> ${esc(b.name)}` : esc(chName(c)); })() : esc(chName(c));

function chRender() {
  if (currentPage !== 'chats') return;
  const page = document.getElementById('page-body');
  const U = new Map((allUsersCache || []).map(u => [u.id, u]));
  const q = CH.q.trim().toLowerCase();
  const rows = allChats
    .filter(c => CH.filter === 'all' || (CH.filter === 'group' && c.type === 'group') || (CH.filter === 'direct' && c.type === 'direct') || (CH.filter === 'empty' && !c.message_count))
    .filter(c => !q || chName(c).toLowerCase().includes(q) || (c.member_names || []).some(n => n.toLowerCase().includes(q)))
    // По времени: сначала те, где писали недавно, чаты без сообщений в конце
    .sort((a, b) => CH.sort === 'act' ? rmWeek(b) - rmWeek(a) || (b.message_count || 0) - (a.message_count || 0)
      : CH.sort === 'name' ? chName(a).localeCompare(chName(b), 'ru', { numeric: true }) : (b.last_at || 0) - (a.last_at || 0));
  const groups = allChats.filter(c => c.type === 'group').length;
  const empty = allChats.filter(c => !c.message_count);
  const per = {};
  allChats.forEach(c => (c.members || []).forEach(m => { per[m.name] = (per[m.name] || 0) + 1; }));
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  const seats = allChats.filter(c => c.type === 'group').reduce((s, c) => s + (c.member_count || 0), 0);
  const wt = [0, 1, 2, 3, 4, 5, 6].map(i => allChats.reduce((s, c) => s + ((c.week || [])[i] || 0), 0)), wmax = Math.max(1, ...wt);
  const today = new Date().getDay(), dn = rbDays(), total = allChats.reduce((s, c) => s + c.message_count, 0);
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, count]) => `<button type="button" aria-pressed="${CH.filter === k}" data-on-click="chFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${count}</span></button>`;
  const sortBtn = (k, label) => `<button type="button" aria-pressed="${CH.sort === k}" data-on-click="chSort" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}</button>`;
  uxKeepFocus(() => {
    uxSet(page, `<div class="ub" id="ch-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Личных чатов</div><div class="ub-big">${allChats.length - groups}<small>переписок двоих</small></div><div class="ub-sub">${allChats.filter(c => c.type !== 'group' && !c.message_count).length} пустых</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Групп</div><div class="ub-big">${groups}<small>${groups ? 'с участниками' : ''}</small></div><div class="ub-sub">${groups ? `${seats} ${uxPlural(seats, 'место', 'места', 'мест')} в группах` : 'групп пока нет'}</div></div>
        ${top ? `<button type="button" class="ub-tile" data-on-click="chPerson" data-a-click="${esc(JSON.stringify([top[0]]))}" title="Показать его чаты"><div class="ub-lbl">Больше всех переписок</div><div class="ub-big" style="font-size:18px;line-height:1.3;margin-top:8px;font-family:var(--f-mono)">${esc(top[0])}</div><div class="ub-sub">${top[1]} ${uxPlural(top[1], 'чат', 'чата', 'чатов')} · нажмите, чтобы показать</div></button>`
          : '<div class="ub-tile static"><div class="ub-lbl">Больше всех переписок</div><div class="ub-sub" style="margin-top:8px">пока нет</div></div>'}
        <div class="ub-tile static"><div class="ub-lbl">Сообщений за неделю</div><div class="ub-big">${rmFmt(wt.reduce((a, b) => a + b, 0))}<small>${rmFmt(total)} всего</small></div>
          <div class="rb-bars">${wt.map((v, i) => `<div title="${dn[(today - 6 + i + 14) % 7]}: ${v}"><i class="${i === 6 ? 'cur' : ''}" style="height:${Math.max(2, Math.round(v / wmax * 26))}px"></i><span>${dn[(today - 6 + i + 14) % 7]}</span></div>`).join('')}</div></div>
      </div>
      <div class="ub-head"><h3>Чаты и группы <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', allChats.length], ['group', 'Группы', groups], ['direct', 'Личные', allChats.length - groups], ['empty', 'Пустые', empty.length]].map(flt).join('')}</div>
        <div class="ub-sort" role="group" aria-label="Сортировка">${sortBtn('last', 'По времени')}${sortBtn('act', 'По активности')}${sortBtn('name', 'По имени')}</div>
        ${empty.length ? `<button class="btn btn-ghost btn-sm" data-on-click="chDelete" data-a-click="${esc(JSON.stringify([JSON.stringify(empty.map(c => c.id))]))}">${UX_I.trash}Удалить пустые · ${empty.length}</button>` : ''}
        ${uxSearch('ch-q', CH.q, 'Название или участник', 'chSearch')}</div>
      <div class="ub-rows">${rows.map(c => {
        const open = CH.open.has(c.id), p = rbPresence(c, U), [from, to] = c.type === 'direct' ? chPair(c) : [];
        const dot = u => { const x = u && U.get(u.id); return x && !x.banned ? (x.status === 'online' ? true : x.status === 'away' ? 'away' : false) : false; };
        const lead = c.type === 'direct' && from && to
          ? `<div class="cb-bw">${avHtml(to.name, 38, 11, to.id, dot(to), to.has_avatar)}<span class="bd">${avHtml(from.name, 20, 6, from.id, false, from.has_avatar)}</span></div>`
          : `<div class="cb-gav">${avHtml(c.name || '?', 38, 11, null, p.on.length ? true : false, c.has_avatar, c.id)}</div>`;
        const chip = c.is_secret ? '<span class="rb-chip sec">секретный</span>' : c.type === 'direct' ? '<span class="rb-chip dir">личный</span>' : '<span class="rb-chip grp">группа</span>';
        return `<div class="rb-row" data-k="${c.id}"><div class="rb-top" data-on-click="chTog" data-a-click="${esc(JSON.stringify(["__event", c.id]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть: ${esc(chName(c))}">${UX_I.chev}</button>
          <div class="rb-name">${lead}<div style="min-width:0"><div class="rb-nl"><b>${chTitle(c)}</b>${chip}${c.message_count ? '' : '<span class="rb-chip q">пустой</span>'}</div>
            <div class="rb-meta">${c.type === 'direct' ? 'Переписка двоих' : `${c.member_count} ${uxPlural(c.member_count, 'участник', 'участника', 'участников')}`}</div></div></div>
          ${rbPresHtml(p)}
          <div class="rb-act">${rbWk(c.week || [0, 0, 0, 0, 0, 0, 0])}<div class="t"><b>${rmFmt(c.message_count)}</b> сообщ.<small>${c.last_at ? 'последнее ' + esc(rmLast(c.last_at)) : 'сообщений нет'}</small></div></div>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" data-on-click="__h46" data-a-click="${esc(JSON.stringify([c.id]))}">${RM_I.users}Участники</button>
            <button class="ux-ibtn" aria-label="Ещё действия: ${esc(chName(c))}" aria-haspopup="menu" aria-expanded="false" data-on-click="__h47" data-a-click="${esc(JSON.stringify([c.id]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="rb-exp${CH.fresh === c.id ? ' fresh' : ''}">
          <div><h4>Участники <span>${(c.members || []).length}</span></h4><div class="rb-pl">${(c.members || []).map(m => { const u = U.get(m.id), st = m.guest ? (m.status === 'online' ? ['в сети', 'on'] : m.status === 'away' ? ['отошёл', 'aw'] : m.online ? ['в сети', 'on'] : ['не в сети', '']) : u?.banned ? ['заблокирован', 'bn'] : u?.status === 'online' ? ['в сети', 'on'] : u?.status === 'away' ? ['отошёл', 'aw'] : ['не в сети', ''];
            return `<div class="rb-p">${avHtml(m.name, 24, 7, m.id, false, m.has_avatar)}<span class="nm">${esc(m.name)}</span>${c.type === 'direct' && from && m.id === from.id ? '<span class="adm start">начал(а)</span>' : ''}${u?.is_admin ? '<span class="adm">админ</span>' : ''}${m.guest ? '<span class="adm guest" title="Гость по ссылке: доступ закончится вместе со ссылкой">гость</span>' : ''}<span class="s ${st[1]}">${st[0]}</span></div>`; }).join('') || '<span class="rm-sub">никого</span>'}</div></div>
          <div><h4>Сводка</h4><div class="rb-kv"><div><span>Создан</span><b>${fmtDate(c.created_at)}</b></div><div><span>Сообщений</span><b>${rmFmt(c.message_count)}</b></div><div><span>Последнее</span><b>${esc(rmLast(c.last_at))}</b></div><div><span>Тип</span><b>${c.is_secret ? 'секретный чат' : c.type === 'direct' ? 'личный чат' : 'группа'}</b></div></div></div>
          <div><h4>Действия</h4><div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn btn-ghost btn-sm" data-on-click="chMembers" data-a-click="${esc(JSON.stringify([c.id]))}">${RM_I.users}Участники</button><button class="btn btn-danger btn-sm" data-on-click="chClear" data-a-click="${esc(JSON.stringify([c.id]))}">${RM_I.clear}Очистить историю</button><button class="btn btn-danger btn-sm" data-on-click="chDelete" data-a-click="${esc(JSON.stringify([[c.id]]))}">${UX_I.trash}Удалить чат</button></div>
            <div class="rm-sub" style="margin-top:10px">Содержимое переписки в админке не показывается: только состав и сводка.</div></div></div>` : ''}</div>`; }).join('') || `<div class="ub-empty">${allChats.length ? 'Ничего не нашли. Проверьте запрос или фильтр.' : 'Чатов пока нет'}</div>`}</div></div>`);
  });
  CH.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function chTog(e, id) {
  if (e.target.closest('.ux-actions')) return;
  if (CH.open.has(id)) { expCollapse(rowExp(e), () => { CH.open.delete(id); chRender(); }); return; }
  CH.open.add(id); CH.fresh = id;
  chRender();
}
function chSort(k) { CH.sort = k; chRender(); }
function chPerson(name) { CH.q = name; CH.filter = 'all'; chRender(); }

function chFilter(k) { CH.filter = k; CH.sel.clear(); chRender(); }
function chSearch(v) { CH.q = v; chRender(); }
function chToggle(id) { CH.sel.has(id) ? CH.sel.delete(id) : CH.sel.add(id); chRender(); }
function chSelAll(on) { allChats.forEach(c => on ? CH.sel.add(c.id) : CH.sel.delete(c.id)); chRender(); }
function chMenu(e, id) {
  const c = allChats.find(x => x.id === id), guestOk = c && c.type === 'group' && !c.fed_instance;
  uxOpenMenu(e, 'ch' + id, `
    <button role="menuitem" data-on-click="__h48" data-a-click="${esc(JSON.stringify([id]))}">${RM_I.users}Участники</button>
    ${guestOk ? `<button role="menuitem" data-on-click="__h49" data-a-click="${esc(JSON.stringify([id, id]))}">${GL_I}Гостевая ссылка</button>` : ''}
    <button role="menuitem" data-on-click="__h50" data-a-click="${esc(JSON.stringify([id]))}">${RM_I.clear}Очистить историю</button>
    <hr><button role="menuitem" class="danger" data-on-click="__h51" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить чат</button>`);
}

function chDelete(ids) {
  const list = allChats.filter(c => ids.includes(c.id));
  if (!list.length) return;
  confirm(list.length > 1 ? `Удалить чаты · ${list.length}` : 'Удалить чат?',
    `${esc(list.map(chName).join(', '))} — переписка удалится у всех участников. Отменить нельзя.`,
    async () => {
      await Promise.all(list.map(c => api('DELETE', '/api/chats/admin/' + c.id)));
      toast(list.length > 1 ? `Удалено чатов: ${list.length}` : 'Чат удалён', 'success');
      if (list.some(c => c.id === CH.openId)) closeModal('modal-chat-members');
      CH.sel.clear();
      renderChats();
      updateNavBadges();
    });
}
function chClear(id) {
  const c = allChats.find(x => x.id === id);
  confirm('Очистить историю?', `Все сообщения чата «${esc(c ? chName(c) : '')}» будут удалены безвозвратно.`, async () => {
    await api('DELETE', '/api/chats/admin/' + id + '/messages');
    toast('История очищена', 'success');
    renderChats();
  });
}

// ── Окно участников ──
async function chMembers(id) {
  uxCloseMenu();
  const c = allChats.find(x => x.id === id);
  if (!c) return;
  CH.openId = id;
  CH.members = (await api('GET', `/api/admin/chats/${id}/members`)) || [];
  CH.pending = c.type === 'direct' ? [] : (await api('GET', `/api/admin/chats/${id}/pending`)) || [];
  chRenderMembers();
  openModal('modal-chat-members');
}
function chRenderMembers() {
  const c = allChats.find(x => x.id === CH.openId), el = document.getElementById('cm-form');
  if (!c || !el) return;
  const direct = c.type === 'direct';
  el.innerHTML = `
    <div class="ua-head">${chAv(c, 36)}<div><div class="ua-title">${esc(chName(c))}</div>
      <div class="ua-sub">${direct ? 'Личный чат' : `Группа · ${CH.members.length} ${uxPlural(CH.members.length, 'участник', 'участника', 'участников')}`}</div></div>
      <button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-chat-members"]'>✕</button></div>
    <div class="ua-body">
      <div class="rm-list rm-scroll" style="max-height:360px">${CH.members.map(m => `<div class="rm-li">${avHtml(m.display_name, 30, 8, m.id, false, true)}
        <div style="flex:1;min-width:0"><div class="ux-name">${esc(m.display_name)}</div><div class="rm-sub">${m.guest ? 'гость по ссылке' : '@' + esc(m.username)}</div></div>
        ${direct ? '' : `<button type="button" class="ux-ibtn" aria-label="Убрать из группы: ${esc(m.display_name)}" data-on-click="chKick" data-a-click="${esc(JSON.stringify([m.id]))}">${RM_I.x}</button>`}</div>`).join('')
        || '<div class="rm-li"><span class="rm-sub">Участников нет</span></div>'}</div>
      ${(CH.pending || []).length ? `<div class="rm-hint" style="margin-top:12px">Ожидают ответа (приглашены с другого сервера)</div><div class="rm-list">${CH.pending.map(m => `<div class="rm-li">${avHtml(m.display_name, 30, 8, m.id, false, true)}
        <div style="flex:1;min-width:0"><div class="ux-name">${esc(m.display_name)}</div><div class="rm-sub">@${esc(m.username)}</div></div>
        <button type="button" class="ux-ibtn" aria-label="Отменить приглашение: ${esc(m.display_name)}" data-on-click="chCancelInvite" data-a-click="${esc(JSON.stringify([m.id]))}">${RM_I.x}</button></div>`).join('')}</div>` : ''}
      ${direct ? '' : `<div class="rm-hint" style="margin-top:14px">Пригласить человека с другого сервера</div>
        <div class="fd-inl"><div class="ua-inp"><input id="cm-addr" placeholder="@сервер:логин" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Адрес человека с другого сервера" data-on-keydown="__h52"></div><button class="btn btn-ghost btn-sm" data-on-click="chInviteAddr">Пригласить</button></div>
        <p class="rm-hint">Человек получит приглашение и сам решит, вступать ли: до согласия он не виден участникам и не получает сообщений. Нужно подключённое соединение с его сервером.</p>`}
      ${direct ? '<p class="rm-hint">В личном чате участников не меняют. Если переписка больше не нужна — удалите чат.</p>' : ''}
    </div>
    <div class="ua-foot"><button type="button" class="btn btn-danger btn-sm" data-on-click="chDelete" data-a-click="${esc(JSON.stringify([[c.id]]))}">${UX_I.trash}Удалить чат</button><span class="ux-grow"></span>
      <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-chat-members"]'>Готово</button></div>`;
}
async function chInviteAddr() {
  const inp = document.getElementById('cm-addr'), v = (inp?.value || '').trim();
  if (!v) { toast('Введите адрес вида @сервер:логин', 'error'); return; }
  const r = await api('POST', `/api/admin/chats/${CH.openId}/invite`, { address: v });
  if (!r || r.error) { toast(r?.error || 'Не удалось пригласить', 'error'); return; }
  toast(r.member ? `«${esc(r.name)}» уже в чате` : `Приглашение отправлено: «${esc(r.name)}»`, 'success');
  CH.pending = (await api('GET', `/api/admin/chats/${CH.openId}/pending`)) || [];
  chRenderMembers();
}
async function chCancelInvite(userId) {
  await api('DELETE', `/api/admin/chats/${CH.openId}/members/${userId}`);
  CH.pending = (CH.pending || []).filter(x => x.id !== userId);
  chRenderMembers();
  toast('Приглашение отменено', 'success');
}
async function chKick(userId) {
  const m = CH.members.find(x => x.id === userId);
  await api('DELETE', `/api/admin/chats/${CH.openId}/members/${userId}`);
  CH.members = CH.members.filter(x => x.id !== userId);
  chRenderMembers();
  toast(`«${esc(m?.display_name || '')}» больше не в группе`, 'success');
  renderChats();
}

/* ── CLIENTS ── */
// Раздел «Клиенты»: сверху сводка — сколько подключено, какие версии Electron и кому нужно
// обновление, ниже таблица подключений. Ход обновления идёт прямо в колонке «Версия» —
// отдельное окно больше не нужно.

const CL = { filter: 'all', q: '', sel: new Set(), clients: [], latest: null, checkedAt: null, checking: false, prog: [], progTimer: null, key: '' };
const CL_SCOPE = {
  system: ['системная', 'Установлен для всех пользователей компьютера'],
  profile: ['в профиле', 'Установлен только для этого пользователя компьютера'],
  pwa: ['PWA', 'Установлен как приложение из браузера'],
  web: ['веб', 'Открыт во вкладке браузера'],
};
const CL_STAGE = { pending: ['Ожидает', 'var(--c-muted)'], downloading: ['Загрузка', 'var(--c-blue)'], installing: ['Установка', 'var(--c-orange)'], restarting: ['Перезапуск', 'var(--c-purple)'] };

async function renderClients() {
  setTopbarActions('');
  CL.key = '';
  document.getElementById('page-body').innerHTML = '<div class="ux-page" id="cl-page"><div class="ux-empty">Загрузка…</div></div>';
  await loadClients();
  clPollProgress();   // обновление могло начаться раньше, на другой вкладке
}

// Вызывается и фоновым опросом раз в 5 секунд — ради счётчика в меню
async function loadClients(force = false) {
  let r;
  try { r = await api('GET', `/api/admin/clients${force ? '?force=true' : ''}`); } catch { return; }
  if (!r) return;
  const name = c => c.displayName || c.username || '';
  // numeric: числа внутри имени сравниваются как числа (2 раньше 21)
  CL.clients = (r.clients || []).slice().sort((a, b) => name(a).localeCompare(name(b), 'ru', { numeric: true }) || a.connectedAt - b.connectedAt);
  CL.latest = r.latestVersion || null;
  if (force || !CL.checkedAt) CL.checkedAt = Date.now();
  const nb = document.getElementById('nb-clients');
  if (nb) nb.textContent = CL.clients.length;
  const ids = new Set(CL.clients.map(c => c.connId));
  CL.sel.forEach(id => { if (!ids.has(id)) CL.sel.delete(id); });
  if (currentPage === 'clients') clRender();
  else if (currentPage === 'dashboard' && typeof swRender === 'function') swRender();
}

const clIsWeb = c => c.clientVersion === 'web' || c.installScope === 'web' || c.installScope === 'pwa';
const clVerOk = v => /^\d+\.\d+\.\d+/.test(v || '');
function clGt(a, b) {
  if (!clVerOk(a) || !clVerOk(b)) return false;
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const clOutdated = c => !clIsWeb(c) && clGt(CL.latest, c.clientVersion);
// Запись о ходе обновления — по соединению. После перезапуска клиент приходит новым
// соединением, поэтому «обновлён» узнаём по тому же человеку и компьютеру.
const clProg = c => CL.prog.find(p => p.connId === c.connId)
  || CL.prog.find(p => p.status === 'restarted' && p.username === c.username && p.hostname === c.hostname && Date.now() - p.startedAt < 10 * 60e3);
const clBusy = c => !!CL_STAGE[clProg(c)?.status];
const clName = c => c.displayName || c.username || '?';
const clHost = c => c.hostname === 'Web' ? 'Браузер' : c.hostname === 'PWA' ? 'Приложение из браузера' : (c.hostname || '—');
function clDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}
function clPlatform(c) {
  const os = uxOsName(c.osPlatform);
  const icon = os === 'iOS' || os === 'Android' ? UX_I.phone : clIsWeb(c) ? UX_I.web
    : os === 'Windows' ? UX_I.win32 : os === 'macOS' ? UX_I.darwin : os === 'Linux' ? UX_I.linux : UX_I.web;
  const release = !clIsWeb(c) && c.osRelease && c.osRelease !== '—' ? `<small>${esc(c.osRelease)}</small>` : '';
  const scope = CL_SCOPE[c.installScope];
  return `<span class="cl-plat">${icon}<span>${os || '—'}</span>${release}</span>${scope ? `<span class="cl-scope cl-sc-${c.installScope}" title="${scope[1]}">${scope[0]}</span>` : ''}`;
}

function clVersion(c) {
  const p = clProg(c);
  if (p?.status === 'error' && p.connId === c.connId) {
    return `<div class="cl-prog error"><div class="cl-prog-line"><span>Не обновился</span><span class="cl-ip">${esc(c.clientVersion)}</span></div>
      <div class="cl-prog-err">${esc(p.error || 'Клиент сообщил об ошибке')} <button data-on-click="clUpdate" data-a-click="${esc(JSON.stringify([[c.connId], true]))}">Повторить</button></div></div>`;
  }
  if (p && CL_STAGE[p.status]) {
    const [stage, color] = CL_STAGE[p.status];
    const pct = Math.max(0, Math.min(100, p.pct || 0));
    const width = p.status === 'pending' ? 4 : p.status === 'downloading' ? pct * .8 : p.status === 'installing' ? 88 : 96;
    return `<div class="cl-prog" role="status"><div class="cl-prog-line" style="color:${color}"><span>${stage}${p.status === 'downloading' ? ` ${Math.round(pct)}%` : p.status === 'restarting' ? '…' : ''}</span>
      <span class="cl-ip">${esc(c.clientVersion)} → ${esc(CL.latest || '')}</span></div>
      <div class="cl-prog-bar"><span style="width:${width}%;background:${color}"></span></div></div>`;
  }
  if (clIsWeb(c)) return '<span class="cl-ver web" title="Веб и PWA загружают свежую версию сами при открытии">обновляется сам</span>';
  if (!clVerOk(c.clientVersion)) return '<span class="cl-ver web">—</span>';
  if (clOutdated(c)) return `<span class="cl-ver old" title="Доступна ${esc(CL.latest)}">${UX_I.up}${esc(c.clientVersion)} <span class="to">→ ${esc(CL.latest)}</span></span>`;
  return `<span class="cl-ver ok">${UX_I.check}${esc(c.clientVersion)}${p?.status === 'restarted' && c.clientVersion === CL.latest ? ' <span class="note">· только что обновлён</span>' : ''}</span>`;
}
function clActions(c) {
  const update = clOutdated(c) && !clBusy(c) ? `<button class="btn btn-primary btn-sm" data-on-click="clUpdate" data-a-click="${esc(JSON.stringify([[c.connId]]))}">${UX_I.up}Обновить</button>` : '';
  return `<div class="ux-actions">${update}<button class="ux-ibtn" aria-label="Действия: ${esc(clHost(c))}" aria-haspopup="menu" aria-expanded="false" data-on-click="clMenu" data-a-click="${esc(JSON.stringify(["__event", c.connId]))}">${UX_I.more}</button></div>`;
}

// Адрес из локальной сети: частные диапазоны. Остальные считаем удалёнными
const clIsLocal = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|fe80:|f[cd])/i.test(String(ip || '').replace(/^::ffff:/i, ''));
const clPlatName = c => clIsWeb(c) ? 'Браузер' : (uxOsName(c.osPlatform) || 'Другое');
const CL_PLAT_COLOR = { Windows: 'var(--dv-c2)', macOS: 'var(--dv-c4)', Linux: 'var(--dv-c3)', 'Браузер': 'var(--dv-c1)' };

// Четыре плитки: подключено, версии Electron, платформы, обновление. Версии по порядку:
// актуальная зелёная, ближайшая устаревшая жёлтая, дальше остальные цвета палитры
function clTiles() {
  const all = CL.clients;
  const electron = all.filter(c => !clIsWeb(c) && clVerOk(c.clientVersion));
  const people = new Set(all.map(c => c.userId)).size;
  const versions = Object.entries(electron.reduce((m, c) => (m[c.clientVersion] = (m[c.clientVersion] || 0) + 1, m), {}))
    .sort((a, b) => clGt(a[0], b[0]) ? -1 : 1);
  const palette = ['var(--c-orange)', 'var(--dv-c2)', 'var(--dv-c5)', 'var(--dv-c4)'];
  let oldIdx = 0;
  const color = v => !CL.latest ? 'var(--c-primary)' : (v === CL.latest || clGt(v, CL.latest)) ? 'var(--c-green)' : palette[oldIdx++ % palette.length];
  const vcol = versions.map(([v]) => color(v));
  const waiting = all.filter(c => clOutdated(c) && !clBusy(c));
  const busy = all.filter(c => clBusy(c)).length;
  const restarting = CL.prog.filter(p => p.status === 'restarting' && !all.some(c => c.connId === p.connId));
  const withIp = all.filter(c => c.clientIp && c.clientIp !== '—');
  const local = withIp.filter(c => clIsLocal(c.clientIp)).length, remote = withIp.length - local;
  const plats = Object.entries(all.reduce((m, c) => (m[clPlatName(c)] = (m[clPlatName(c)] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
  const curN = electron.filter(c => !clOutdated(c)).length;
  const check = CL.checking
    ? `<button class="btn btn-ghost btn-sm" disabled aria-label="Проверяю">${UX_I.refresh.replace('<svg', '<svg class="ux-spin"')}</button>`
    : `<button class="btn btn-ghost btn-sm" data-on-click="clCheck" title="Проверить обновления${CL.checkedAt ? ` · проверено в ${uxClock(CL.checkedAt)}` : ''}" aria-label="Проверить обновления">${UX_I.refresh}</button>`;
  const devUnit = people === all.length ? uxPlural(people, 'человек', 'человека', 'человек')
    : `${uxPlural(all.length, 'устройство', 'устройства', 'устройств')} у ${people} ${uxPlural(people, 'человека', 'человек', 'человек')}`;
  return `
    <div class="ub-tile static"><div class="ub-lbl">Подключено</div><div class="ub-big">${all.length}<small>${devUnit}</small></div>
      <div class="ub-sub">${withIp.length ? `${local} в локальной сети · ${remote} удалённо` : 'адреса не определены'}</div>
      ${withIp.length ? `<div class="ub-stack"><i style="flex:${local};background:var(--c-green)"></i><i style="flex:${remote};background:var(--dv-c4)"></i></div>` : ''}</div>
    <button type="button" class="ub-tile" data-on-click="clFilter" data-a-click='["old"]' title="Показать тех, кому нужно обновление"><div class="ub-lbl">Версии Electron</div>
      <div class="ub-big">${CL.latest ? esc(CL.latest) : '—'}<small>${electron.length ? `актуальная у ${curN}` : 'нет компьютеров'}</small></div>
      ${electron.length ? `<div class="ub-sub">${versions.length} ${uxPlural(versions.length, 'версия', 'версии', 'версий')} на ${electron.length} ${uxPlural(electron.length, 'компьютере', 'компьютерах', 'компьютерах')}</div>
        <div class="ub-stack">${versions.map(([v, n], i) => `<i style="flex:${n};background:${vcol[i]}" title="${esc(v)}: ${n}"></i>`).join('')}</div>
        <div class="ub-leg">${versions.map(([v, n], i) => `<span><i style="background:${vcol[i]}"></i>${esc(v)} <b>${n}</b></span>`).join('')}</div>` : '<div class="ub-sub" style="margin-top:6px">Сейчас нет подключённых компьютеров с Electron</div>'}
      ${restarting.length ? `<div class="ub-sub" style="color:var(--c-purple-text);margin-top:6px">Перезапускаются: ${esc(restarting.map(p => p.displayName || p.username).join(', '))}</div>` : ''}</button>
    <div class="ub-tile static"><div class="ub-lbl">Платформы</div>
      <div class="ub-big">${plats[0] ? plats[0][1] : 0}<small>${plats[0] ? esc(plats[0][0]) : ''}</small></div>
      <div class="ub-sub">${plats.length > 1 ? plats.slice(1).map(([n, k]) => `${k} ${esc(n)}`).join(' · ') : plats.length ? 'других платформ нет' : '—'}</div>
      ${plats.length ? `<div class="ub-stack">${plats.map(([n, k]) => `<i style="flex:${k};background:${CL_PLAT_COLOR[n] || 'var(--dv-c5)'}" title="${esc(n)}: ${k}"></i>`).join('')}</div>` : ''}</div>
    <div class="ub-tile static ub-upd"><div class="ub-lbl">Обновление</div>
      <div class="ub-big">${busy || waiting.length}<small>${busy ? 'в процессе' : 'устарели'}</small></div>
      <div class="ub-sub">Последняя ${CL.latest ? esc(CL.latest) : 'неизвестна'}${CL.checkedAt ? ` · проверено в ${uxClock(CL.checkedAt)}` : ''}</div>
      <div class="row ub-acts" style="margin-top:10px;gap:8px;display:flex;align-items:center">
        ${waiting.length ? `<button class="btn ux-solid btn-sm" data-on-click="clUpdate" data-a-click="${esc(JSON.stringify([JSON.stringify(waiting.map(c => c.connId))]))}">${UX_I.up}Обновить устаревшие · ${waiting.length}</button>`
          : electron.length && CL.latest && !busy ? `<span class="cl-ver ok">${UX_I.check}Все на последней версии</span>` : ''}${check}</div></div>`;
}

function clRows() {
  const q = CL.q.trim().toLowerCase();
  return CL.clients
    .filter(c => CL.filter === 'all' || (CL.filter === 'old' && clOutdated(c)) || (CL.filter === 'electron' && !clIsWeb(c)) || (CL.filter === 'web' && clIsWeb(c)))
    .filter(c => !q || [clName(c), c.username, c.hostname, c.clientIp].some(x => String(x || '').toLowerCase().includes(q)));
}

// Время в сети: число и полоска относительно самого долгого подключения
function clDurHtml(c) {
  const now = Date.now(), max = Math.max(60000, ...CL.clients.map(x => now - x.connectedAt));
  return `${clDuration(now - c.connectedAt)}<i style="width:${Math.max(4, Math.round((now - c.connectedAt) / max * 100))}%"></i>`;
}

function clRender() {
  const page = document.getElementById('cl-page');
  if (!page) return;
  const rows = clRows();
  // Фоновый опрос раз в 5 секунд и ход обновления не пересобирают список: иначе
  // аватарки перерисовывались бы и мигали. Меняются только плитки, версия, кнопки и время.
  const key = JSON.stringify([CL.filter, CL.q, [...CL.sel], CL.latest, rows.map(c => [c.connId, c.clientVersion, c.hostname, c.osPlatform, c.osRelease, c.installScope, c.clientIp, c.displayName])]);
  if (key === CL.key && page.querySelector('.ub-rows')) return clPatch();
  CL.key = key;
  const n = { all: CL.clients.length, old: CL.clients.filter(clOutdated).length, electron: CL.clients.filter(c => !clIsWeb(c)).length, web: CL.clients.filter(clIsWeb).length };
  const sel = CL.clients.filter(c => CL.sel.has(c.connId));
  const selOld = sel.filter(c => clOutdated(c) && !clBusy(c)), selElectron = sel.filter(c => !clIsWeb(c));
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, count, warn]) => `<button type="button" class="${warn && count ? 'warn' : ''}" aria-pressed="${CL.filter === k}" data-on-click="clFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${count}</span></button>`;
  page.className = 'ub';
  uxKeepFocus(() => {
    uxSet(page, `
      <div class="ub-tiles" id="cl-tiles">${clTiles()}</div>
      <div class="ub-head"><h3>Клиенты <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', n.all], ['old', 'Нужно обновить', n.old, true], ['electron', 'Electron', n.electron], ['web', 'Веб и PWA', n.web]].map(flt).join('')}</div>
        ${uxSearch('cl-q', CL.q, 'Человек, компьютер или IP', 'clSearch')}${CL.sel.size ? `<div class="ux-bulk"><b>Выбрано: ${CL.sel.size}</b>
        <button class="btn btn-ghost btn-sm" ${selOld.length ? '' : 'disabled'} data-on-click="clUpdate" data-a-click="${esc(JSON.stringify([JSON.stringify(selOld.map(c => c.connId))]))}">${UX_I.up}Обновить · ${selOld.length}</button>
        <button class="btn btn-ghost btn-sm" ${selElectron.length ? '' : 'disabled'} data-on-click="clRestart" data-a-click="${esc(JSON.stringify([JSON.stringify(selElectron.map(c => c.connId))]))}">${UX_I.restart}Перезапустить</button>
        <button class="btn btn-ghost btn-sm" data-on-click="__h53">${UX_I.logout}Завершить сеансы</button>
        <span class="ux-grow"></span><button class="btn btn-ghost btn-sm" data-on-click="__h54">Снять выделение</button></div>` : ''}</div>
      <div class="ub-rows">${rows.map(c => `<div class="cb-row${CL.sel.has(c.connId) ? ' sel' : ''}" data-k="${c.connId}">
        <input type="checkbox" aria-label="Выбрать: ${esc(clHost(c))}" ${CL.sel.has(c.connId) ? 'checked' : ''} data-on-change="clToggle" data-a-change="${esc(JSON.stringify([c.connId]))}">
        <div class="ux-cell">${avHtml(clName(c), 36, 10, c.userId, null, false)}<div style="min-width:0"><div class="ux-name">${esc(clName(c))}</div><div class="ux-login">@${esc(c.username)}</div></div></div>
        <div class="cb-dev"><div class="cl-host">${esc(clHost(c))}</div>${c.clientIp && c.clientIp !== '—' ? `<div class="cl-ip">${esc(c.clientIp)}</div>` : ''}</div>
        <div class="cb-pl">${clPlatform(c)}</div>
        <div data-cl-ver="${c.connId}">${clVersion(c)}</div>
        <div class="cb-du cb-dur" data-cl-dur="${c.connId}">${clDurHtml(c)}</div>
        <div data-cl-act="${c.connId}">${clActions(c)}</div>
      </div>`).join('') || `<div class="ub-empty">${CL.clients.length ? 'Никого не нашли. Проверьте запрос или фильтр.' : 'Сейчас никто не подключён'}</div>`}</div>`);
  });
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function clPatch() {
  const set = (el, html) => { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };
  set(document.getElementById('cl-tiles'), clTiles());
  CL.clients.forEach(c => {
    set(document.querySelector(`[data-cl-ver="${c.connId}"]`), clVersion(c));
    set(document.querySelector(`[data-cl-act="${c.connId}"]`), clActions(c));
    set(document.querySelector(`[data-cl-dur="${c.connId}"]`), clDurHtml(c));
  });
}

function clFilter(k) { CL.filter = k; CL.sel.clear(); clRender(); }
function clSearch(v) { CL.q = v; clRender(); }
function clToggle(id) { CL.sel.has(id) ? CL.sel.delete(id) : CL.sel.add(id); clRender(); }
function clSelAll(on) { clRows().forEach(c => on ? CL.sel.add(c.connId) : CL.sel.delete(c.connId)); clRender(); }

function clMenu(e, connId) {
  const c = CL.clients.find(x => x.connId === connId);
  if (!c) return;
  const logout = `<button role="menuitem" class="danger" data-on-click="__h55" data-a-click="${esc(JSON.stringify([connId]))}">${UX_I.logout}Завершить сеанс</button>`;
  uxOpenMenu(e, 'cl' + connId, clIsWeb(c)
    ? `<div class="note">Веб и PWA обновляются сами — достаточно обновить страницу в браузере</div><hr>${logout}`
    : `<button role="menuitem" ${clOutdated(c) && !clBusy(c) ? '' : 'disabled'} data-on-click="__h56" data-a-click="${esc(JSON.stringify([connId]))}">${UX_I.up}Обновить${CL.latest ? ' до ' + esc(CL.latest) : ''}</button>
       <button role="menuitem" ${clBusy(c) ? 'disabled' : ''} data-on-click="__h57" data-a-click="${esc(JSON.stringify([connId]))}">${UX_I.restart}Перезапустить клиент</button>
       <hr>${logout}`);
}

async function clCheck() {
  CL.checking = true;
  clPatch();
  await loadClients(true);
  CL.checking = false;
  clPatch();
  toast(CL.latest ? `Последняя версия клиента — ${esc(CL.latest)}` : 'Не удалось узнать последнюю версию', CL.latest ? 'success' : 'error');
}

const clFind = ids => ids.map(id => CL.clients.find(c => c.connId === id)).filter(Boolean);
const clLines = list => esc(list.map(c => `${clName(c)} — ${clHost(c)}`).join('\n'));

function clUpdate(ids, retry) {
  const list = clFind(ids);
  if (!list.length || !CL.latest) return;
  const run = async () => {
    await Promise.all(list.map(c => api('POST', `/api/admin/clients/${c.connId}/force-update`)));
    CL.sel.clear();
    clPollProgress(true);
  };
  if (retry) return run();
  confirm(list.length > 1 ? `Обновить до ${CL.latest} · ${list.length}` : `Обновить до ${CL.latest}`,
    `${esc(list.map(c => `${clName(c)} — ${clHost(c)}: ${c.clientVersion}`).join('\n'))}\n\nКлиент скачает новую версию, установит её и перезапустится сам — это займёт около минуты.`,
    run);
}
function clRestart(ids) {
  const list = clFind(ids).filter(c => !clIsWeb(c));
  if (!list.length) return;
  confirm(list.length > 1 ? `Перезапустить клиенты · ${list.length}` : 'Перезапустить клиент?',
    `${clLines(list)}\n\nПриложение закроется и сразу откроется снова — на пару секунд человек пропадёт из сети.`,
    async () => {
      await Promise.all(list.map(c => api('POST', `/api/admin/clients/${c.connId}/force-restart`)));
      toast(list.length > 1 ? `Команда перезапуска отправлена: ${list.length}` : 'Команда перезапуска отправлена', 'success');
      CL.sel.clear();
      setTimeout(loadClients, 3000);
    });
}
function clLogout(ids) {
  const list = clFind(ids);
  if (!list.length) return;
  confirm(list.length > 1 ? `Завершить сеансы · ${list.length}` : 'Завершить сеанс?',
    `${clLines(list)}\n\nНа этом устройстве придётся войти заново. Остальные устройства человека останутся в сети.`,
    async () => {
      await Promise.all(list.map(c => api('POST', `/api/admin/clients/${c.connId}/force-logout`)));
      toast(list.length > 1 ? `Сеансы завершены: ${list.length}` : 'Сеанс завершён', 'success');
      CL.sel.clear();
      setTimeout(loadClients, 1500);
    });
}

// Ход обновления: опрашиваем, пока кто-то обновляется. Перезапустившийся клиент
// приходит новым соединением — тогда сразу подтягиваем список, не ждём фонового опроса.
async function clPollProgress(started) {
  clearTimeout(CL.progTimer);
  let items = null;
  try { items = await api('GET', '/api/admin/updates/progress'); } catch {}
  if (Array.isArray(items)) {
    const restartedBefore = new Set(CL.prog.filter(p => p.status === 'restarted').map(p => p.connId));
    CL.prog = items;
    if (items.some(p => p.status === 'restarted' && !restartedBefore.has(p.connId))) loadClients();
  }
  if (currentPage !== 'clients') return;
  clRender();
  if (started || CL.prog.some(p => CL_STAGE[p.status])) CL.progTimer = setTimeout(() => clPollProgress(), 800);
}

/* ── PUSH SUBSCRIPTIONS ── */
// Раздел «Уведомления»: push-подписки. Видно, у кого уведомления не включены вовсе.
// «Проверить» шлёт тестовое уведомление на все устройства человека — одному или выбранным разом.

const PS = { filter: 'all', q: '', open: new Set(), fresh: null, sel: new Set(), subs: [] };
const PS_SVC = { google: ['Google', 'rm-direct'], apple: ['Apple', 'rm-empty'], mozilla: ['Mozilla', 'rm-quiet'], microsoft: ['Microsoft', 'rm-group'], other: ['Другой', 'rm-empty'] };
const PS_BELL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
function psService(endpoint) {
  let host = '';
  try { host = new URL(endpoint).hostname; } catch {}
  const svc = /googleapis|google\.com/.test(host) ? 'google' : /apple\.com/.test(host) ? 'apple'
    : /mozilla/.test(host) ? 'mozilla' : /windows\.com|microsoft/.test(host) ? 'microsoft' : 'other';
  return { svc, host };
}

async function renderPush() {
  setTopbarActions('');
  const [subs, users] = await Promise.all([api('GET', '/api/push/subscriptions'), api('GET', '/api/admin/users')]);
  PS.subs = (Array.isArray(subs) ? subs : []).map(s => ({ ...s, ...psService(s.endpoint) }));
  if (Array.isArray(users)) allUsersCache = users;
  const nb = document.getElementById('nb-push');
  if (nb) nb.textContent = PS.subs.length;
  const ids = new Set(PS.subs.map(s => s.id));
  PS.sel.forEach(id => { if (!ids.has(id)) PS.sel.delete(id); });
  psRender();
}

const PS_SC = { google: 'var(--dv-c2)', apple: 'var(--dv-c4)', mozilla: 'var(--dv-c3)', microsoft: 'var(--dv-c1)', other: 'var(--dv-c5)' };
const psChip = k => `<span class="pg-mini" style="background:color-mix(in srgb,${PS_SC[k]} 16%,transparent);color:${PS_SC[k]}">${PS_SVC[k][0]}</span>`;
// Одна запись на человека: у него может быть несколько устройств
function psPeople() {
  const m = new Map();
  PS.subs.forEach(s => {
    const e = m.get(s.user_id) || { user_id: s.user_id, name: s.display_name || s.username || '?', username: s.username || '', subs: [] };
    e.subs.push(s); m.set(s.user_id, e);
  });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
}
function psRender() {
  if (currentPage !== 'push') return;
  const page = document.getElementById('page-body');
  const q = PS.q.trim().toLowerCase();
  const ppl = psPeople();
  const rows = ppl.filter(p => PS.filter === 'all' || p.subs.some(s => s.svc === PS.filter))
    .filter(p => !q || [p.name, p.username, ...p.subs.map(s => s.host)].some(x => (x || '').toLowerCase().includes(q)));
  const people = allUsersCache.filter(u => !u.banned);
  const withPush = new Set(PS.subs.map(s => s.user_id));
  const without = people.filter(u => !withPush.has(u.id));
  const services = Object.keys(PS_SVC).filter(k => PS.subs.some(s => s.svc === k));
  const cover = people.length ? Math.round(people.filter(u => withPush.has(u.id)).length / people.length * 100) : 0;
  const shown = without.slice(0, 3).map(u => u.display_name).join(', ') + (without.length > 3 ? ` и ещё ${without.length - 3}` : '');
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, n]) => `<button type="button" aria-pressed="${PS.filter === k}" data-on-click="psFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${n}</span></button>`;
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="ps-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Подписок</div><div class="ub-big">${PS.subs.length}<small>${uxPlural(PS.subs.length, 'устройство', 'устройства', 'устройств')}</small></div>
          ${services.length ? `<div class="ub-stack">${services.map(k => `<i style="flex:${PS.subs.filter(s => s.svc === k).length};background:${PS_SC[k]}"></i>`).join('')}</div><div class="ub-leg">${services.map(k => `<span><i style="background:${PS_SC[k]}"></i>${PS_SVC[k][0]} <b>${PS.subs.filter(s => s.svc === k).length}</b></span>`).join('')}</div>` : '<div class="ub-sub" style="margin-top:6px">подписок пока нет</div>'}</div>
        <div class="ub-tile static"><div class="ub-lbl">Уведомления включены</div><div class="ub-big">${withPush.size}<small>из ${people.length}</small></div><div class="ub-sub">охват ${cover}%</div><div class="ub-meter"><i style="width:${cover}%;background:var(--c-primary)"></i></div></div>
        <div class="ub-tile static"><div class="ub-lbl">Не включили</div><div class="ub-big">${without.length}<small>${uxPlural(without.length, 'человек', 'человека', 'человек')}</small></div><div class="ub-sub" style="white-space:normal">${without.length ? `${esc(shown)}. Они узнают о сообщениях, только открыв чат.` : 'Уведомления включили все'}</div></div>
        <div class="ub-tile static" style="display:flex;flex-direction:column;justify-content:space-between"><div><div class="ub-lbl">Проверка доставки</div><div class="ub-sub" style="margin-top:6px">Тестовое уведомление уйдёт на все устройства. Видно, куда дошло, а куда нет.</div></div>
          <button class="btn ux-solid btn-sm" style="align-self:flex-start;margin-top:10px" ${PS.subs.length ? '' : 'disabled'} data-on-click="psTest" data-a-click="${esc(JSON.stringify([JSON.stringify(PS.subs.map(s => s.id))]))}">${PS_BELL}Проверить всех</button></div>
      </div>
      <div class="ub-head"><h3>Подписки <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', ppl.length], ...services.map(k => [k, PS_SVC[k][0], ppl.filter(p => p.subs.some(s => s.svc === k)).length])].map(flt).join('')}</div>
        ${uxSearch('ps-q', PS.q, 'Человек или сервис', 'psSearch')}</div>
      <div class="ub-rows">${rows.map(p => {
        const open = PS.open.has(p.user_id), svcs = [...new Set(p.subs.map(s => s.svc))], since = Math.min(...p.subs.map(s => s.created_at || 0)), ids = p.subs.map(s => s.id);
        return `<div class="rb-row"><div class="pg-top" style="grid-template-columns:22px minmax(0,1.5fr) minmax(0,1.3fr) minmax(0,.8fr) 150px" data-on-click="psTog" data-a-click="${esc(JSON.stringify(["__event", p.user_id]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть: ${esc(p.name)}">${UX_I.chev}</button>
          <div class="rb-name">${avHtml(p.name, 36, 10, p.user_id, false, true)}<div style="min-width:0"><div class="rb-nl"><b>${esc(p.name)}</b></div><div class="ux-login">@${esc(p.username)}</div></div></div>
          <div class="pg-h2" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="rb-meta" style="margin-right:2px">${p.subs.length} ${uxPlural(p.subs.length, 'устройство', 'устройства', 'устройств')}</span>${svcs.map(psChip).join('')}</div>
          <div class="pg-h1 rb-meta">с ${esc(uaSeen(since))}</div>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" title="Тестовое уведомление на все устройства человека" data-on-click="__h58" data-a-click="${esc(JSON.stringify([JSON.stringify(ids)]))}">${PS_BELL}Проверить</button>
            <button class="ux-ibtn" aria-label="Ещё действия: ${esc(p.name)}" aria-haspopup="menu" aria-expanded="false" data-on-click="__h59" data-a-click="${esc(JSON.stringify([p.user_id]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="pg-exp${PS.fresh === p.user_id ? ' fresh' : ''}" style="grid-template-columns:minmax(0,1fr)"><div><h4>Устройства</h4><div style="display:flex;flex-direction:column;gap:8px">${p.subs.map(s => `<div class="pg-dev">${psChip(s.svc)}<span class="h">${esc(s.host || '—')}</span><span class="rb-meta">подписан ${esc(uaSeen(s.created_at))}</span>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" data-on-click="psTest" data-a-click="${esc(JSON.stringify([[s.id]]))}">${PS_BELL}Проверить</button><button class="ux-ibtn" aria-label="Удалить подписку" title="Удалить подписку" data-on-click="psDelete" data-a-click="${esc(JSON.stringify([[s.id]]))}">${UX_I.trash}</button></div></div>`).join('')}</div></div></div>` : ''}</div>`;
      }).join('') || `<div class="ub-empty">${PS.subs.length ? 'Ничего не нашли. Проверьте запрос или фильтр.' : 'Подписок пока нет'}</div>`}</div></div>`;
  });
  PS.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function psTog(e, uid) {
  if (e.target.closest('.ux-actions')) return;
  if (PS.open.has(uid)) { expCollapse(rowExp(e), () => { PS.open.delete(uid); psRender(); }); return; }
  PS.open.add(uid); PS.fresh = uid;
  psRender();
}
function psPMenu(e, uid) {
  const ids = PS.subs.filter(s => s.user_id === uid).map(s => s.id);
  uxOpenMenu(e, 'psp' + uid, `
    <button role="menuitem" data-on-click="__h60" data-a-click="${esc(JSON.stringify([JSON.stringify(ids)]))}">${PS_BELL}Проверить все устройства</button>
    <hr><button role="menuitem" class="danger" data-on-click="__h61" data-a-click="${esc(JSON.stringify([JSON.stringify(ids)]))}">${UX_I.trash}Удалить подписки</button>`);
}

function psFilter(k) { PS.filter = k; PS.sel.clear(); psRender(); }
function psSearch(v) { PS.q = v; psRender(); }
function psToggle(id) { PS.sel.has(id) ? PS.sel.delete(id) : PS.sel.add(id); psRender(); }
function psSelAll(on) { PS.subs.forEach(s => on ? PS.sel.add(s.id) : PS.sel.delete(s.id)); psRender(); }
function psMenu(e, id) {
  uxOpenMenu(e, 'ps' + id, `
    <button role="menuitem" data-on-click="__h62" data-a-click="${esc(JSON.stringify([id]))}">${PS_BELL}Проверить</button>
    <hr><button role="menuitem" class="danger" data-on-click="__h63" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить подписку</button>`);
}

// Тест уходит человеку целиком — на все его подписки, поэтому выбранные строки сводим к людям
async function psTest(ids) {
  const users = [...new Set(PS.subs.filter(s => ids.includes(s.id)).map(s => s.user_id))];
  if (!users.length) return;
  let failed = [];
  for (const uid of users) {
    try {
      const res = await api('POST', `/api/push/test/${uid}`);
      (res?.results || []).filter(r => !r.ok).forEach(r => failed.push(`${r.service}: ${r.code || ''} ${r.error || ''}`.trim()));
      if (!res?.results) failed.push('нет ответа');
    } catch { failed.push('ошибка запроса'); }
  }
  if (failed.length) toast(esc(`Не дошло: ${failed[0]}${failed.length > 1 ? ` и ещё ${failed.length - 1}` : ''}`), 'error');
  else toast(users.length > 1 ? `Тестовые уведомления отправлены: ${users.length} ${uxPlural(users.length, 'человеку', 'людям', 'людям')}` : 'Тестовое уведомление отправлено', 'success');
}
function psDelete(ids) {
  const list = PS.subs.filter(s => ids.includes(s.id));
  if (!list.length) return;
  confirm(list.length > 1 ? `Удалить подписки · ${list.length}` : 'Удалить подписку?',
    `${esc([...new Set(list.map(s => s.display_name || s.username))].join(', '))}\n\nНа эти устройства перестанут приходить уведомления, пока человек не включит их снова.`,
    async () => {
      await Promise.all(list.map(s => api('DELETE', `/api/push/subscriptions/${s.id}`)));
      toast(list.length > 1 ? `Удалено подписок: ${list.length}` : 'Подписка удалена', 'success');
      PS.sel.clear();
      renderPush();
      updateNavBadges();
    });
}

/* ── WEBHOOKS ── */
// Раздел «Вебхуки»: боты, которые пишут в чат по запросу извне. По активности за неделю
// видно, какой бот замолчал — обычно это значит, что у внешней системы сменился адрес.

const WH = { filter: 'all', q: '', open: new Set(), fresh: null, sel: new Set(), hooks: [], form: null, opts: [] };
const whSvg = p => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const WH_I = {
  copy: whSvg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  img: whSvg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  key: whSvg('<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>'),
  book: whSvg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
};
const whUrl = token => `${location.origin}/api/webhooks/${token}`;
const whActive = h => (h.week || []).some(Boolean);
const whWeek = h => (h.week || []).reduce((a, b) => a + b, 0);

async function renderWebhooks() {
  setTopbarActions('');
  const hooks = await api('GET', '/api/admin/webhooks');
  WH.hooks = Array.isArray(hooks) ? hooks : [];
  const nb = document.getElementById('nb-webhooks');
  if (nb) nb.textContent = WH.hooks.length;
  const ids = new Set(WH.hooks.map(h => h.id));
  WH.sel.forEach(id => { if (!ids.has(id)) WH.sel.delete(id); });
  whRender();
}

const WH_DAYS = () => { const d = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], t = new Date().getDay(); return [0, 1, 2, 3, 4, 5, 6].map(i => d[(t - 6 + i + 14) % 7]); };
const whWk = w => { const m = Math.max(1, ...w); return `<span class="rb-wk" title="Сообщения по дням за неделю: ${w.join(', ')}">${w.map(n => `<i class="${n ? '' : 'z'}" style="height:${Math.max(2, Math.round(n / m * 22))}px"></i>`).join('')}</span>`; };
const whCurl = h => `curl -X POST ${whUrl(h.token)} \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "Сервер перезагружен"}'`;
function whCopyExample(id) { const h = WH.hooks.find(x => x.id === id); if (h) navigator.clipboard.writeText(whCurl(h).replace(/\\\n/g, '\n')).then(() => toast('Пример скопирован', 'success')).catch(() => toast('Не удалось скопировать', 'error')); }
async function whTest(id) {
  const h = WH.hooks.find(x => x.id === id);
  if (!h) return;
  try {
    const r = await fetch(whUrl(h.token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Тестовое сообщение из админки' }) });
    toast(r.ok ? `Тест отправлен в «${esc(h.chat_name || '')}»` : 'Не удалось отправить тест', r.ok ? 'success' : 'error');
    if (r.ok) renderWebhooks();
  } catch { toast('Не удалось отправить тест', 'error'); }
}

function whRender() {
  if (currentPage !== 'webhooks') return;
  const page = document.getElementById('page-body');
  const q = WH.q.trim().toLowerCase();
  const silent = WH.hooks.filter(h => !whActive(h));
  const rows = WH.hooks.filter(h => WH.filter === 'all' || (WH.filter === 'active' ? whActive(h) : !whActive(h)))
    .filter(h => !q || [h.name, h.tag, h.chat_name].some(x => (x || '').toLowerCase().includes(q)));
  const wt = [0, 1, 2, 3, 4, 5, 6].map(i => WH.hooks.reduce((s, h) => s + ((h.week || [])[i] || 0), 0)), wmax = Math.max(1, ...wt), dn = WH_DAYS();
  const silentNames = silent.slice(0, 3).map(h => h.name).join(', ') + (silent.length > 3 ? ` и ещё ${silent.length - 3}` : '');
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, n]) => `<button type="button" aria-pressed="${WH.filter === k}" data-on-click="whFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${n}</span></button>`;
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="wh-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Вебхуков</div><div class="ub-big">${WH.hooks.length}<small>${uxPlural(WH.hooks.length, 'бот', 'бота', 'ботов')}</small></div><div class="ub-sub">${WH.hooks.length - silent.length} пишут · ${silent.length} молчит</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Сообщений за неделю</div><div class="ub-big">${rmFmt(wt.reduce((a, b) => a + b, 0))}<small>от ботов</small></div>
          <div class="rb-bars">${wt.map((v, i) => `<div title="${dn[i]}: ${v}"><i class="${i === 6 ? 'cur' : ''}" style="height:${Math.max(2, Math.round(v / wmax * 26))}px"></i><span>${dn[i]}</span></div>`).join('')}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Молчат</div><div class="ub-big" style="color:${silent.length ? 'var(--c-orange-text)' : 'var(--c-green-text)'}">${silent.length}</div><div class="ub-sub" style="white-space:normal">${!WH.hooks.length ? 'Вебхуков пока нет' : silent.length ? `Неделю не писали: ${esc(silentNames)}. Проверьте адрес у внешней системы.` : 'Все боты писали за последнюю неделю'}</div></div>
        <div class="ub-tile static" style="display:flex;flex-direction:column;justify-content:space-between"><div><div class="ub-lbl">Новый вебхук</div><div class="ub-sub" style="margin-top:6px">Адрес для внешней системы: она пишет в выбранный чат от имени бота.</div></div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn ux-solid btn-sm" data-on-click="whOpen">${RM_I.plus}Создать</button><button class="btn btn-ghost btn-sm" data-on-click="openModal" data-a-click='["modal-webhook-help"]'>${WH_I.book}Инструкция</button></div></div>
      </div>
      <div class="ub-head"><h3>Вебхуки <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', WH.hooks.length], ['active', 'Пишут', WH.hooks.length - silent.length], ['silent', 'Молчат', silent.length]].map(flt).join('')}</div>
        ${uxSearch('wh-q', WH.q, 'Бот или чат', 'whSearch')}</div>
      <div class="ub-rows">${rows.map(h => {
        const open = WH.open.has(h.id), on = whWeek(h);
        return `<div class="rb-row"><div class="pg-top" style="grid-template-columns:22px minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,.9fr) 150px" data-on-click="whTog" data-a-click="${esc(JSON.stringify(["__event", h.id]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть: ${esc(h.name)}">${UX_I.chev}</button>
          <div class="rb-name">${avHtml(h.name, 38, 11, h.user_id, false, h.has_avatar)}<div style="min-width:0"><div class="rb-nl"><b>${esc(h.name)}</b>${h.tag ? `<span class="rb-chip dir">${esc(h.tag)}</span>` : ''}${whActive(h) ? '' : '<span class="rb-chip q">молчит</span>'}</div><div class="rb-meta">бот · вебхук</div></div></div>
          <div class="pg-h2" style="min-width:0"><div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.chat_name || '—')}</div><span class="rb-meta">${h.chat_type === 'group' ? 'группа' : 'комната'}</span></div>
          <div class="pg-h1 pg-act">${whWk(h.week || [0, 0, 0, 0, 0, 0, 0])}<div class="t"><b>${on}</b> за неделю<small>${rmFmt(h.message_count)} всего</small></div></div>
          <div class="pg-h1 pg-url"><code>…/webhooks/${esc(String(h.token).slice(0, 3))}•••••</code></div>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" data-on-click="__h64" data-a-click="${esc(JSON.stringify([h.id]))}">${WH_I.copy}Скопировать</button>
            <button class="ux-ibtn" aria-label="Ещё действия: ${esc(h.name)}" aria-haspopup="menu" aria-expanded="false" data-on-click="__h65" data-a-click="${esc(JSON.stringify([h.id]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="pg-exp${WH.fresh === h.id ? ' fresh' : ''}" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)"><div><h4>Как отправить сообщение</h4><div class="pg-code">${esc(whCurl(h))}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-on-click="whCopyExample" data-a-click="${esc(JSON.stringify([h.id]))}">${WH_I.copy}Скопировать пример</button><button class="btn btn-ghost btn-sm" data-on-click="whTest" data-a-click="${esc(JSON.stringify([h.id]))}">Отправить тест</button></div></div>
          <div><h4>Детали</h4><div class="pg-kv"><div><span>Пишет в</span><b>${esc(h.chat_name || '—')}</b></div><div><span>Создан</span><b>${esc(fmtDate(h.created_at))}</b></div><div><span>Сообщений всего</span><b>${rmFmt(h.message_count)}</b></div><div><span>За неделю</span><b>${on}</b></div></div>
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-on-click="whAvatar" data-a-click="${esc(JSON.stringify([h.id]))}">${WH_I.img}Аватар</button><button class="btn btn-ghost btn-sm" data-on-click="whRegen" data-a-click="${esc(JSON.stringify([h.id]))}">${WH_I.key}Новый адрес</button><button class="btn btn-danger btn-sm" data-on-click="whDelete" data-a-click="${esc(JSON.stringify([[h.id]]))}">${UX_I.trash}Удалить</button></div></div></div>` : ''}</div>`;
      }).join('') || `<div class="ub-empty">${WH.hooks.length ? 'Ничего не нашли. Проверьте запрос или фильтр.' : 'Вебхуков пока нет'}</div>`}</div></div>`;
  });
  WH.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function whTog(e, id) {
  if (e.target.closest('.ux-actions')) return;
  if (WH.open.has(id)) { expCollapse(rowExp(e), () => { WH.open.delete(id); whRender(); }); return; }
  WH.open.add(id); WH.fresh = id;
  whRender();
}

function whFilter(k) { WH.filter = k; WH.sel.clear(); whRender(); }
function whSearch(v) { WH.q = v; whRender(); }
function whToggle(id) { WH.sel.has(id) ? WH.sel.delete(id) : WH.sel.add(id); whRender(); }
function whSelAll(on) { WH.hooks.forEach(h => on ? WH.sel.add(h.id) : WH.sel.delete(h.id)); whRender(); }
function whMenu(e, id) {
  uxOpenMenu(e, 'wh' + id, `
    <button role="menuitem" data-on-click="__h66" data-a-click="${esc(JSON.stringify([id]))}">${WH_I.copy}Скопировать адрес</button>
    <button role="menuitem" data-on-click="__h67" data-a-click="${esc(JSON.stringify([id]))}">${WH_I.img}Сменить аватар</button>
    <button role="menuitem" data-on-click="__h68" data-a-click="${esc(JSON.stringify([id]))}">${WH_I.key}Выдать новый адрес</button>
    <hr><button role="menuitem" class="danger" data-on-click="__h69" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить вебхук</button>`);
}

function whCopyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Адрес скопирован', 'success')).catch(() => toast('Не удалось скопировать', 'error'));
}
function whCopy(id) {
  const h = WH.hooks.find(x => x.id === id);
  if (h) whCopyText(whUrl(h.token));
}

// Поле выбора файла создаём на лету: в меню его держать нельзя — меню закрывается раньше, чем выбран файл
function whPickFile(onPick) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => { if (input.files[0]) onPick(input.files[0]); };
  input.click();
}
function whAvatar(id) {
  whPickFile(async file => {
    const data = await api('POST', `/api/admin/webhooks/${id}/avatar`, { data: await resizeAvatarFile(file) });
    if (data?.ok) { toast('Аватар обновлён', 'success'); renderWebhooks(); }
    else toast(esc(data?.error || 'Не удалось обновить аватар'), 'error');
  });
}

function whRegen(id) {
  const h = WH.hooks.find(x => x.id === id);
  if (!h) return;
  confirm('Выдать новый адрес?', `Старый адрес «${esc(h.name)}» перестанет работать сразу. Новый нужно будет вписать во внешнюю систему.`, async () => {
    const data = await api('POST', `/api/admin/webhooks/${id}/regen-token`);
    if (data?.ok) { toast('Новый адрес выдан — скопируйте его в строке бота', 'success'); renderWebhooks(); }
    else toast(esc(data?.error || 'Не удалось выдать адрес'), 'error');
  });
}

function whDelete(ids) {
  const list = WH.hooks.filter(h => ids.includes(h.id));
  if (!list.length) return;
  confirm(list.length > 1 ? `Удалить вебхуки · ${list.length}` : 'Удалить вебхук?',
    `${esc(list.map(h => h.name).join(', '))}\n\nВнешние системы больше не смогут писать через эти адреса. Сообщения в чатах останутся.`,
    async () => {
      const results = await Promise.all(list.map(h => api('DELETE', `/api/admin/webhooks/${h.id}`)));
      const failed = results.filter(r => !r?.ok).length;
      toast(failed ? `Не удалось удалить: ${failed}` : list.length > 1 ? `Удалено вебхуков: ${list.length}` : 'Вебхук удалён', failed ? 'error' : 'success');
      WH.sel.clear();
      renderWebhooks();
      updateNavBadges();
    });
}

/* ── Создание ── */
async function whOpen() {
  uxCloseMenu();
  const chats = ((await api('GET', '/api/admin/chats')) || []).filter(c => (c.type === 'group' || c.type === 'room') && !c.parent_id);
  // Комнату с темами выбирают по теме: бот пишет в конкретную ленту
  WH.opts = await Promise.all(chats.map(async c => {
    if (c.type === 'group') return { id: c.id, label: `${c.name || '—'} (группа)` };
    const topics = (await api('GET', '/api/admin/topics/' + c.id)) || [];
    return topics.length ? { group: `${c.name || '—'} (комната)`, items: topics.map(t => ({ id: t.id, label: t.name })) } : { id: c.id, label: `${c.name || '—'} (комната)` };
  }));
  WH.form = { name: '', tag: '', chat_id: '', avatar: null, err: '', busy: false, created: null };
  whRenderForm('wh-name');
  openModal('modal-webhook');
}

const whMissing = f => { const m = []; if (!f.name.trim()) m.push('имя бота'); if (!f.chat_id) m.push('куда писать'); return m; };
function whFootSync() {
  const f = WH.form; if (!f) return;
  const miss = whMissing(f), n = document.getElementById('wh-note'), b = document.getElementById('wh-go');
  if (n) { n.innerHTML = fmNote(miss); n.classList.toggle('ok', !miss.length); }
  if (b) b.disabled = !!f.busy || !!miss.length;
}
function whHeadAv() {
  const f = WH.form;
  return f.avatar ? `<span class="av" style="width:38px;height:38px;border-radius:10px;background:url('data:image/jpeg;base64,${f.avatar}') center/cover"></span>` : uaAv(f.name || '?', 38);
}

function whRenderForm(focusId) {
  const f = WH.form, el = document.getElementById('wh-form');
  if (!f || !el) return;
  const close = `<button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-webhook"]'>✕</button>`;
  if (f.created) {
    const url = whUrl(f.created);
    el.innerHTML = `
      <div class="ua-head">${whHeadAv()}<div><div class="ua-title">Вебхук создан</div><div class="ua-sub">${esc(f.name)}</div></div>${close}</div>
      <div class="ua-body">
        <div class="wh-ok"><div><span>Адрес вебхука</span><code>${esc(url)}</code></div>
          <button type="button" class="btn btn-ghost btn-sm" data-url="${esc(url)}" data-on-click="__h70">${WH_I.copy}Скопировать</button></div>
        <div class="ua-field"><label>Пример запроса</label><pre class="wh-code">${esc(`curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "Сборка прошла успешно"}'`)}</pre></div>
        <p class="ua-hint">Адрес — это и есть ключ: кто его знает, тот может писать от имени бота. Если он утёк, выдайте новый в меню «⋯».</p>
      </div>
      <div class="ua-foot"><span class="ux-grow"></span><button type="button" class="btn ux-solid" data-on-click="closeModal" data-a-click='["modal-webhook"]'>Готово</button></div>`;
    return;
  }
  const opt = o => `<option value="${o.id}" ${String(f.chat_id) === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`;
  uaRestoreFocus(() => {
    el.innerHTML = `
      <div class="ua-head"><span id="wh-head-av">${whHeadAv()}</span><div><div class="ua-title">Новый вебхук</div><div class="ua-sub">Бот, который пишет в чат по запросу извне</div></div>${close}</div>
      <div class="ua-body">
        <div class="ua-row2">
          <div class="ua-field"><label for="wh-name">Имя бота</label>
            <div class="ua-inp"><input id="wh-name" value="${esc(f.name)}" placeholder="Например, Мониторинг" maxlength="40" data-on-input="__h71"></div></div>
          <div class="ua-field"><label for="wh-tag">Тег <span class="opt">· необязательно</span></label>
            <div class="ua-inp"><input id="wh-tag" value="${esc(f.tag)}" placeholder="бот, CRM" maxlength="20" data-on-input="__h72"></div></div>
        </div>
        <div class="ua-field"><label for="wh-chat">Куда писать</label>
          <div class="ua-inp"><select id="wh-chat" class="wh-select" data-on-change="__h73">
            <option value="" ${f.chat_id ? '' : 'selected'} disabled>Выберите группу, комнату или тему</option>
            ${WH.opts.map(o => o.group ? `<optgroup label="${esc(o.group)}">${o.items.map(opt).join('')}</optgroup>` : opt(o)).join('')}
          </select></div>
          <span class="ua-hint">${WH.opts.length ? 'У комнаты с темами бот пишет в выбранную тему' : 'Сначала создайте группу или комнату'}</span></div>
        <div class="ua-field"><label>Аватар <span class="opt">· необязательно</span></label>
          <div style="display:flex;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-on-click="__h74">${WH_I.img}${f.avatar ? 'Заменить картинку' : 'Загрузить картинку'}</button>
            ${f.avatar ? '<button type="button" class="btn btn-ghost btn-sm" data-on-click="__h75">Убрать</button>' : ''}</div></div>
      </div>
      <div class="ua-foot">${f.err ? `<span class="ua-err">${esc(f.err)}</span>` : ''}
        <button type="button" class="btn btn-ghost" data-on-click="openModal" data-a-click='["modal-webhook-help"]'>${WH_I.book}Инструкция</button>
        <span class="fm-note ${whMissing(f).length ? '' : 'ok'}" id="wh-note" style="margin-left:auto">${fmNote(whMissing(f))}</span>
        <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-webhook"]'>Отмена</button>
        <button type="button" class="btn ux-solid" id="wh-go" ${f.busy || whMissing(f).length ? 'disabled' : ''} data-on-click="saveWebhook">${f.busy ? 'Создаю…' : 'Создать'}</button></div>`;
  }, focusId);
}

async function whFormAvatar(file) {
  WH.form.avatar = await resizeAvatarFile(file);
  whRenderForm();
}

async function saveWebhook() {
  const f = WH.form;
  if (!f || f.busy) return;
  const name = f.name.trim(), chat_id = Number(f.chat_id);
  f.err = !name ? 'Укажите имя бота' : !chat_id ? 'Выберите, куда бот будет писать' : '';
  if (f.err) return whRenderForm(!name ? 'wh-name' : 'wh-chat');
  f.busy = true;
  whRenderForm();
  const data = await api('POST', '/api/admin/webhooks', { name, tag: f.tag.trim() || null, chat_id });
  f.busy = false;
  if (!data?.id) { f.err = data?.error || 'Не удалось создать вебхук'; return whRenderForm(); }
  if (f.avatar) await api('POST', `/api/admin/webhooks/${data.id}/avatar`, { data: f.avatar });
  await renderWebhooks();
  const hooks = currentPage === 'webhooks' ? WH.hooks : ((await api('GET', '/api/admin/webhooks')) || []);
  f.name = name;
  f.created = hooks.find(h => h.id === data.id)?.token || data.token || null;
  if (!f.created) { closeModal('modal-webhook'); toast('Вебхук создан', 'success'); return; }
  whRenderForm();
  updateNavBadges();
}

/* ── SETTINGS MODAL ── */
// Окно настроек: слева разделы с их главным значением, справа строки настроек.
// Правки «Сообщений» и «Вложений» копятся в черновике и сохраняются одной кнопкой в подвале —
// переход между разделами их не теряет. Токен, копии и обновление действуют сразу.

const ST = {
  sec: 'messages', saved: null, draft: null, editCustom: false, editUnit: 60, lifeCustom: false, tokErr: {},
  confirmClose: false, saving: false, stats: null, backups: [], bkBusy: false, bkNew: false,
  gh: { set: false, show: false, err: '', busy: false }, upd: { state: 'idle', v: null },
};
const stSvg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ST_I = {
  msg: stSvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  clip: stSvg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  db: stSvg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>'),
  gh: stSvg('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>'),
  upd: stSvg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  x: stSvg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: stSvg('<path d="M20 6 9 17l-5-5"/>'),
  warn: stSvg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  clock: stSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  down: stSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  plus: stSvg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  img: stSvg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  file: stSvg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  box: stSvg('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'),
  eye: stSvg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: stSvg('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),
  key: stSvg('<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>'),
  server: stSvg('<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>'),
};
const ST_EDIT = [[60, '1 мин'], [120, '2 мин'], [900, '15 мин'], [3600, '1 час'], [172800, '48 часов']];
const ST_STATUS = [[0, 'Не хранить'], [1, '1 день'], [3, '3 дня'], [7, '7 дней'], [14, '14 дней'], [30, '30 дней']];
const ST_LIFE = [[0, 'Всегда'], [30, '30 дней'], [90, '90 дней'], [365, '1 год']];
const ST_FORM = { messages: ['edit', 'statusDays'], attachments: ['imgMax', 'imgExt', 'videoMax', 'videoExt', 'fileMax', 'fileExt', 'life'], backups: ['backupDays', 'backupTime', 'backupRetention'] };
const ST_IN = { messages: 'в «Сообщениях»', attachments: 'во «Вложениях»', backups: 'в «Резервных копиях»' };
const ST_QUICK = { 'Документы': ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'], 'Архивы': ['zip', 'rar', '7z'] };
const ST_KEYS = {
  edit: ['edit_time_limit', String], statusDays: ['status_window_days', String], imgMax: ['upload_image_max_size', String], imgExt: ['upload_image_extensions', v => v.join(',')],
  videoMax: ['upload_video_max_size', String], videoExt: ['upload_video_extensions', v => v.join(',')],
  fileMax: ['upload_file_max_size', String], fileExt: ['upload_file_extensions', v => v.join(',')], life: ['upload_file_lifetime', String],
  backupDays: ['backup_schedule_days', v => v.join(',')], backupTime: ['backup_schedule_time', String],
  backupRetention: ['backup_retention_days', v => (v == null || Number.isNaN(v)) ? '' : String(v)],
};
// Порядок для интерфейса — с понедельника; значение — как у Date.getDay() (0=вс)
const ST_DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
const stPad = n => String(n).padStart(2, '0');
const stClock = d => `${stPad(d.getHours())}:${stPad(d.getMinutes())}`;
const stClone = o => JSON.parse(JSON.stringify(o));
function stDur(sec) {
  if (sec >= 3600 && sec % 3600 === 0) { const h = sec / 3600; return `${h} ${uxPlural(h, 'час', 'часа', 'часов')}`; }
  if (sec >= 60 && sec % 60 === 0) { const m = sec / 60; return `${m} ${uxPlural(m, 'минута', 'минуты', 'минут')}`; }
  return `${sec} ${uxPlural(sec, 'секунда', 'секунды', 'секунд')}`;
}
function stUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return `${d} ${uxPlural(d, 'день', 'дня', 'дней')}${h ? ` ${h} ч` : ''}`;
  if (h) return `${h} ч ${m} мин`;
  return `${Math.max(1, m)} мин`;
}

function stFromSettings(s) {
  const list = v => String(v || '').split(',').map(x => x.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);
  ST.saved = {
    edit: Number(s.edit_time_limit) || 120,
    statusDays: s.status_window_days === undefined || s.status_window_days === '' || !(Number(s.status_window_days) >= 0) ? 7 : Number(s.status_window_days),
    imgMax: Number(s.upload_image_max_size) || 10,
    imgExt: s.upload_image_extensions ? list(s.upload_image_extensions) : ['jpeg', 'jpg', 'png', 'gif', 'webp'],
    videoMax: Number(s.upload_video_max_size) || 50,
    videoExt: s.upload_video_extensions ? list(s.upload_video_extensions) : ['mp4', 'mov', 'webm'],
    fileMax: Number(s.upload_file_max_size) || 50,
    fileExt: list(s.upload_file_extensions),
    life: Number(s.upload_file_lifetime) || 0,
    backupDays: s.backup_schedule_days ? list(s.backup_schedule_days).map(Number) : [],
    backupTime: s.backup_schedule_time || '03:00',
    backupRetention: s.backup_retention_days ? Number(s.backup_retention_days) : NaN,
  };
  ST.draft = stClone(ST.saved);
  ST.gh.set = !!s.github_token_set;
}

// Прежнее имя: «Файлы» открывают окно сразу на «Вложениях»
function showSettingsSection(section) { openSettingsModal(section); }

const stChanged = () => ST.draft ? Object.entries(ST_FORM).flatMap(([sec, keys]) =>
  keys.filter(k => JSON.stringify(ST.draft[k]) !== JSON.stringify(ST.saved[k])).map(k => ({ sec, k }))) : [];
function stErrors() {
  const d = ST.draft, e = {};
  if (!(d.edit >= 10)) e.edit = 'Срок правки — не меньше 10 секунд';
  if (!(Number.isInteger(d.imgMax) && d.imgMax >= 1 && d.imgMax <= 500)) e.imgMax = 'Размер картинок — от 1 до 500 МБ';
  if (!(Number.isInteger(d.videoMax) && d.videoMax >= 1 && d.videoMax <= 500)) e.videoMax = 'Размер видео — от 1 до 500 МБ';
  if (!(Number.isInteger(d.fileMax) && d.fileMax >= 1 && d.fileMax <= 500)) e.fileMax = 'Размер файлов — от 1 до 500 МБ';
  if (!d.imgExt.length) e.imgExt = 'Нужен хотя бы один формат картинок, иначе их нельзя будет отправить';
  if (!d.videoExt.length) e.videoExt = 'Нужен хотя бы один формат видео, иначе его нельзя будет отправить';
  if (!(Number.isInteger(d.life) && d.life >= 0 && d.life <= 3650)) e.life = 'Срок хранения — от 1 до 3650 дней';
  if (d.backupDays.length && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.backupTime)) e.backupTime = 'Укажите время в формате ЧЧ:ММ';
  // Пусто (NaN/null — в т.ч. после JSON-клонирования драфта) — валидное значение:
  // хранить копии всегда, без ограничения по сроку
  if (!(d.backupRetention == null || Number.isNaN(d.backupRetention) || (Number.isInteger(d.backupRetention) && d.backupRetention >= 1 && d.backupRetention <= 3650)))
    e.backupRetention = 'Срок хранения копий — от 1 до 3650 дней, либо оставьте пустым';
  return e;
}
const stLastBackup = () => ST.backups[0];
const stBackupOld = () => !ST.backups.length || Date.now() / 1000 - stLastBackup().created_at > 7 * 86400;
function stNextBackupLabel() {
  const days = ST.draft.backupDays, m = /^(\d{2}):(\d{2})$/.exec(ST.draft.backupTime);
  if (!days.length || !m) return '';
  const [h, mi] = [Number(m[1]), Number(m[2])];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const cand = new Date(now);
    cand.setDate(now.getDate() + i);
    cand.setHours(h, mi, 0, 0);
    if (cand <= now || !days.includes(cand.getDay())) continue;
    const dayLabel = i === 0 ? 'сегодня' : i === 1 ? 'завтра' : cand.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return `${dayLabel} в ${stPad(h)}:${stPad(mi)}`;
  }
  return '';
}
const stVersion = () => ST.stats?.serverVersion || '—';

const ST_SECTIONS = [
  { k: 'messages', label: 'Сообщения', icon: ST_I.msg, desc: 'Что можно делать с уже отправленными сообщениями', meta: () => `${stDur(ST.saved.edit)} на правку` },
  { k: 'attachments', label: 'Вложения', icon: ST_I.clip, desc: 'Размер, форматы и срок хранения медиа и файлов', meta: () => `до ${ST.saved.imgMax} и ${ST.saved.fileMax} МБ${ST.saved.life ? ` · ${ST.saved.life} дн.` : ''}` },
  { k: 'backups', label: 'Резервные копии', icon: ST_I.db, desc: 'Снимки базы: сообщения, пользователи, чаты и настройки', meta: () => (ST.saved.backupDays?.length ? 'по расписанию · ' : '') + (ST.backups.length ? `последняя ${uaSeen(stLastBackup().created_at)}` : 'копий нет'), dot: () => stBackupOld() ? 'warn' : '' },
  { k: 'github', label: 'GitHub', icon: ST_I.gh, desc: 'Доступ к репозиторию для проверки обновлений', meta: () => ST.gh.set ? 'токен задан' : 'без токена', dot: () => ST.gh.set ? 'ok' : 'warn' },
  { k: 'update', label: 'Обновление', icon: ST_I.upd, title: 'Обновление сервера', desc: 'Версия сервера и установка новых релизов', meta: () => ST.upd.state === 'available' ? `есть версия ${ST.upd.v.latest}` : `версия ${stVersion()}`, dot: () => ST.upd.state === 'available' ? 'warn' : '' },
];

function stNavHtml() {
  const dirty = new Set(stChanged().map(c => c.sec));
  return ST_SECTIONS.map(s => {
    const dot = dirty.has(s.k) ? '<i class="st-dot edit" title="Есть несохранённые изменения"></i>' : s.dot?.() ? `<i class="st-dot ${s.dot()}"></i>` : '';
    return `<button type="button" class="st-sn" aria-current="${ST.sec === s.k ? 'page' : 'false'}" data-on-click="stGo" data-a-click="${esc(JSON.stringify([`${s.k}`]))}"><span class="st-sn-ic">${s.icon}</span>
      <span class="st-sn-tx"><b>${s.label}</b><small>${esc(s.meta())}</small></span>${dot}</button>`;
  }).join('');
}

// ── Сообщения ──
function stEditExample() {
  const sec = ST.draft.edit;
  if (!(sec >= 10)) return `${ST_I.clock}<span>Укажите срок — не меньше 10 секунд</span>`;
  const now = new Date(), until = new Date(now.getTime() + sec * 1000);
  const t = d => stClock(d) + (sec % 60 ? ':' + stPad(d.getSeconds()) : '');
  const when = until.toDateString() === now.toDateString() ? t(until) : `${until.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}, ${t(until)}`;
  return `${ST_I.clock}<span>Отправленное сейчас, в <b>${t(now)}</b>, можно исправить до <b>${when}</b></span>`;
}
function stPaneMessages() {
  const d = ST.draft, custom = ST.editCustom || !ST_EDIT.some(([v]) => v === d.edit);
  const n = d.edit / ST.editUnit;
  return `<div class="st-gt">${ST_I.msg}Редактирование</div>
    <div class="st-g"><div class="st-r stack">
      <div class="st-l"><b>Сколько можно править своё сообщение</b><span>Когда срок выйдет, пункт «Изменить» пропадёт из меню сообщения.</span></div>
      <div class="st-ctl"><div class="st-seg" role="group" aria-label="Срок правки">${ST_EDIT.map(([v, l]) => `<button type="button" aria-pressed="${!custom && d.edit === v}" data-on-click="stEditPreset" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}
        <button type="button" aria-pressed="${custom}" data-on-click="stEditPreset" data-a-click='["custom"]'>Своё</button></div>
        ${custom ? `<div class="st-inp st-num ${stErrors().edit ? 'bad' : ''}" id="st-box-edit"><input id="st-edit-n" type="number" min="1" value="${Number.isInteger(n) ? n : ''}" aria-label="Срок правки" data-on-input="stEditN" data-a-input='["__value"]'></div>
          <div class="st-inp" style="width:auto"><select aria-label="Единицы" data-on-change="__h76">${[[1, 'секунд'], [60, 'минут'], [3600, 'часов']].map(([u, l]) => `<option value="${u}" ${ST.editUnit === u ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      </div>
      <div class="st-ex" id="st-edit-example">${stEditExample()}</div>
      <div class="st-cmp"><span>Для сравнения:</span><span>WhatsApp — <b>15 минут</b></span><span>Telegram — <b>48 часов</b></span></div>
    </div></div>
    <div class="st-gt">${ST_I.clock}Статусы</div>
    <div class="st-g"><div class="st-r stack">
      <div class="st-l"><b>Окно времени статуса</b><span>Сколько хранится точное время доставки и прочтения. Позже остаётся только факт «прочитано» без времени. Работает в чатах до 100 участников.</span></div>
      <div class="st-ctl"><div class="st-seg" role="group" aria-label="Окно времени статуса">${ST_STATUS.map(([v, l]) => `<button type="button" aria-pressed="${d.statusDays === v}" data-on-click="stStatusPreset" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}</div></div>
    </div></div>
    <p class="st-hint">Новый срок действует сразу после сохранения; приложения узнают о нём при переподключении.</p>`;
}

// ── Вложения ──
function stStepHtml(k) {
  return `<div class="st-step ${stErrors()[k] ? 'bad' : ''}" id="st-box-${k}"><button type="button" aria-label="Меньше" data-on-click="stStep" data-a-click="${esc(JSON.stringify([`${k}`, -1]))}">−</button>
    <input id="st-n-${k}" type="number" min="1" max="500" value="${Number.isFinite(ST.draft[k]) ? ST.draft[k] : ''}" aria-label="Размер в мегабайтах" data-on-input="stNum" data-a-input="${esc(JSON.stringify([`${k}`, "__value"]))}"><button type="button" aria-label="Больше" data-on-click="stStep" data-a-click="${esc(JSON.stringify([`${k}`, 1]))}">+</button><span>МБ</span></div>`;
}
function stTokHtml(k, anyText) {
  const list = ST.draft[k];
  return `<div class="st-tok ${stErrors()[k] || ST.tokErr[k] ? 'bad' : ''}" data-on-click="__h77" data-a-click="${esc(JSON.stringify([k]))}">
      ${list.map(x => `<span class="st-tk">${esc(x)}<button type="button" aria-label="Убрать ${esc(x)}" data-on-click="stTokDel" data-a-click="${esc(JSON.stringify([`${k}`, `${esc(x)}`]))}">×</button></span>`).join('')}
      ${!list.length && anyText ? `<span class="st-any">${ST_I.check}${anyText}</span>` : ''}
      <input id="st-tok-${k}" placeholder="${list.length ? 'ещё формат…' : 'например, pdf'}" aria-label="Добавить формат" autocomplete="off" spellcheck="false"
        data-on-keydown="stTokKey" data-a-keydown="${esc(JSON.stringify(["__event", `${k}`]))}" data-on-input="__h78" data-a-input="${esc(JSON.stringify([k]))}">
    </div>
    ${ST.tokErr[k] ? `<div class="st-err">${esc(ST.tokErr[k])}</div>` : ''}`;
}
function stPaneAttachments() {
  const d = ST.draft, s = ST.stats, lifeCustom = ST.lifeCustom || !ST_LIFE.some(([v]) => v === d.life);
  return `<div class="st-gt">${ST_I.img}Медиа</div>
    <div class="st-g">
      <div class="st-r"><div class="st-l"><b>Наибольший размер картинок</b><span>Картинку тяжелее загрузить не получится</span></div>${stStepHtml('imgMax')}</div>
      <div class="st-r stack"><div class="st-l"><b>Форматы картинок</b><span>Только эти расширения отправляются как картинка с превью. Enter или запятая — добавить.</span></div>${stTokHtml('imgExt')}</div>
      <div class="st-r"><div class="st-l"><b>Наибольший размер видео</b><span>Видео тяжелее загрузить не получится</span></div>${stStepHtml('videoMax')}</div>
      <div class="st-r stack"><div class="st-l"><b>Форматы видео</b><span>Только эти расширения отправляются как видео с превью и проигрыванием. Enter или запятая — добавить.</span></div>${stTokHtml('videoExt')}</div>
    </div>
    <div class="st-gt">${ST_I.file}Файлы</div>
    <div class="st-g">
      <div class="st-r"><div class="st-l"><b>Наибольший размер</b><span>Касается документов, архивов и всего, что не картинка</span></div>${stStepHtml('fileMax')}</div>
      <div class="st-r stack"><div class="st-l"><b>Форматы</b><span>Разрешено только то, что в списке. Пустой список: файлы отправлять нельзя</span></div>${stTokHtml('fileExt', 'Форматы не разрешены')}
        <div class="st-quick"><span class="st-hint">Добавить набор:</span>${Object.keys(ST_QUICK).map(n => `<button type="button" class="btn btn-ghost btn-sm" data-on-click="stQuick" data-a-click="${esc(JSON.stringify([`${n}`]))}">${ST_I.plus}${n}</button>`).join('')}
          ${d.fileExt.length ? '<button type="button" class="btn btn-ghost btn-sm" data-on-click="stTokClear">Очистить список</button>' : ''}</div></div>
    </div>
    <div class="st-gt">${ST_I.box}Хранение</div>
    <div class="st-g"><div class="st-r stack">
      <div class="st-l"><b>Сколько хранить файлы</b><span>Старые файлы удаляются сами — проверка раз в 6 часов. В переписке на их месте остаётся «Файл удалён».</span></div>
      <div class="st-ctl"><div class="st-seg" role="group" aria-label="Срок хранения">${ST_LIFE.map(([v, l]) => `<button type="button" aria-pressed="${!lifeCustom && d.life === v}" data-on-click="stLifePreset" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}
        <button type="button" aria-pressed="${lifeCustom}" data-on-click="stLifePreset" data-a-click='["custom"]'>Своё</button></div>
        ${lifeCustom ? `<div class="st-inp st-num ${stErrors().life ? 'bad' : ''}" id="st-box-life" style="width:130px"><input id="st-n-life" type="number" min="1" max="3650" value="${d.life || ''}" aria-label="Срок хранения в днях" data-on-input="stNum" data-a-input='["life", "__value"]'><span class="st-u">дней</span></div>` : ''}
      </div>
      ${s ? `<div class="st-ex">${ST_I.box}<span>Сейчас на сервере <b>${rmFmt(s.filesCount)}</b> ${uxPlural(s.filesCount || 0, 'файл', 'файла', 'файлов')}, <b>${hmBytes(s.filesBytes || 0)}</b></span><span class="ux-grow"></span>
        <button type="button" class="st-link" data-on-click="stToFiles">Открыть «Файлы»</button></div>` : ''}
    </div></div>`;
}

// ── Резервные копии ──
function stPaneBackups() {
  const d = ST.draft, last = stLastBackup(), old = stBackupOld(), err = stErrors();
  return `<div class="st-stat ${old ? 'warn' : 'ok'}"><span class="st-ring">${old ? ST_I.warn : ST_I.db}</span>
      <div class="st-stat-t"><b>${last ? `Последняя копия — ${uaSeen(last.created_at)}` : 'Копий пока нет'}</b>
        <span>${old ? 'Больше недели без копии — сделайте свежую перед обновлением или крупными правками.' : `${hmBytes(last.size)} · всего копий: ${ST.backups.length}`}</span></div>
      <div class="st-stat-acts"><button type="button" class="btn btn-ghost" data-on-click="rsPick">${RS_I ? rsIc('upload', 14) : ''}Восстановить из файла…</button>
      <button type="button" class="btn ux-solid" ${ST.bkBusy ? 'disabled' : ''} data-on-click="stBackup">${ST.bkBusy ? '<span class="st-spin light"></span>Создаю…' : `${ST_I.plus}Создать копию`}</button></div></div>
    <p class="st-hint">Снимок делается на живой базе и не мешает людям работать. Файлы копий лежат на сервере в <code class="st-code">chat_db/backups</code>.</p>
    <div class="st-gt">${ST_I.clock}Расписание</div>
    <div class="st-g"><div class="st-r stack">
      <div class="st-l"><b>Дни недели</b><span>Автокопия по этим дням. Пусто — только по кнопке.</span></div>
      <div class="st-seg" role="group" aria-label="Дни автокопирования">${ST_DAYS.map(([v, l]) => `<button type="button" aria-pressed="${d.backupDays.includes(v)}" data-on-click="stBackupDay" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}</div>
    </div>
    ${d.backupDays.length ? `<div class="st-r"><div class="st-l"><b>Время</b><span>По времени сервера</span></div>
      <div class="st-inp st-num ${err.backupTime ? 'bad' : ''}" style="width:130px"><input type="time" value="${esc(d.backupTime)}" aria-label="Время автокопирования" data-on-input="stBackupTime" data-a-input='["__value"]'></div></div>
      <div class="st-r stack">${err.backupTime ? `<div class="st-err">${esc(err.backupTime)}</div>` : `<p class="st-hint" style="margin:0">Ближайшая копия — ${esc(stNextBackupLabel())}.</p>`}</div>` : ''}
    </div>
    <div class="st-gt">Хранение</div>
    <div class="st-g"><div class="st-r">
      <div class="st-l"><b>Срок хранения</b><span>Копии старше срока удаляются автоматически. Пусто — хранить всегда.</span></div>
      <div class="st-inp st-num ${err.backupRetention ? 'bad' : ''}" id="st-box-backupRetention" style="width:130px"><input type="number" min="1" max="3650" value="${d.backupRetention == null || Number.isNaN(d.backupRetention) ? '' : d.backupRetention}" aria-label="Срок хранения копий в днях" data-on-input="stNum" data-a-input='["backupRetention", "__value"]'><span class="st-u">дней</span></div></div>
      ${err.backupRetention ? `<div class="st-r stack"><div class="st-err">${esc(err.backupRetention)}</div></div>` : ''}
    </div>
    ${ST.backups.length ? `<div class="st-gt">${ST_I.db}Копии · ${ST.backups.length}</div>
    <div class="st-g">${ST.backups.map((b, i) => `<div class="st-bk ${i === 0 && ST.bkNew ? 'new' : ''}">
        <div><b>${esc(uaSeen(b.created_at))} ${i === 0 && ST.bkNew ? '<span class="st-chip new">новая</span>' : ''}${b.kind === 'pre' ? '<span class="st-chip warn">До восстановления</span>' : b.kind === 'man' ? '<span class="st-chip">Вручную</span>' : b.kind === 'auto' ? '<span class="st-chip">Авто</span>' : ''}</b><small>${esc(new Date(b.created_at * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</small></div>
        <span class="st-sz">${hmBytes(b.size)}</span>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn btn-primary btn-sm" data-on-click="rsFromBackup" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`]))}">${rsIc('restore', 13)}Восстановить</button>
          <button type="button" class="btn btn-ghost btn-sm" data-on-click="stDownload" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`, "__this"]))}">${ST_I.down}Скачать</button>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Удалить копию ${esc(b.name)}" data-on-click="stDeleteBackup" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`]))}">${UX_I.trash}</button>
        </div></div>`).join('')}</div>` : ''}`;
}

// ── GitHub ──
function stPaneGithub() {
  const g = ST.gh;
  return `<div class="st-stat ${g.set ? 'ok' : 'warn'}"><span class="st-ring">${g.set ? ST_I.check : ST_I.warn}</span>
      <div class="st-stat-t"><b>${g.set ? 'Токен задан' : 'Токен не задан'}</b>
        <span>${g.set ? 'Запросы к GitHub идут с токеном — до 5000 в час.' : 'Анонимный доступ — до 60 запросов в час. При частых проверках обновлений лимит заканчивается.'}</span></div>
      <span class="st-chip ${g.set ? 'ok' : 'warn'}">${g.set ? '5000' : '60'} / час</span></div>
    <div class="st-gt">${ST_I.key}Personal Access Token</div>
    <div class="st-g"><div class="st-r stack">
      <div class="st-l"><b>${g.set ? 'Заменить токен' : 'Вставьте токен'}</b><span>Токен хранится только на сервере и в браузер не возвращается — даже администратору.</span></div>
      <div class="st-ctl">
        <div class="st-inp ${g.err ? 'bad' : ''}" style="flex:1;min-width:220px"><input id="st-gh" type="${g.show ? 'text' : 'password'}" placeholder="${g.set ? '•••••••••••••••••••• (задан)' : 'ghp_… или github_pat_…'}" autocomplete="off" spellcheck="false" class="st-mono" data-on-keydown="__h79">
          <button type="button" class="st-eye" aria-label="${g.show ? 'Скрыть токен' : 'Показать токен'}" data-on-click="stGhShow">${g.show ? ST_I.eyeOff : ST_I.eye}</button></div>
        <button type="button" class="btn ux-solid" ${g.busy ? 'disabled' : ''} data-on-click="stGhSave">Сохранить</button>
        ${g.set ? `<button type="button" class="btn btn-danger" ${g.busy ? 'disabled' : ''} data-on-click="stGhDel">Удалить</button>` : ''}
      </div>
      ${g.err ? `<div class="st-err">${esc(g.err)}</div>` : ''}
      <p class="st-hint">Создать токен: <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Electron+Admin" target="_blank" rel="noopener">github.com/settings/tokens</a> — достаточно права <code class="st-code">public_repo</code>.</p>
    </div></div>
    <div class="st-gt">Для чего нужен</div>
    <div class="st-g">
      <div class="st-use">${ST_I.server}<div><b>Проверка обновлений сервера</b><span>Версия и описание релиза для блока обновления на главной</span></div></div>
      <div class="st-use">${ST_I.upd}<div><b>Версии клиентов</b><span>Последний релиз для сравнения на странице «Клиенты»; ответ кэшируется на 15 минут</span></div></div>
      <div class="st-use">${ST_I.down}<div><b>Принудительное обновление</b><span>Ссылка на установщик под систему конкретного устройства</span></div></div>
    </div>`;
}

// ── Обновление ──
function stPaneUpdate() {
  const u = ST.upd, busy = typeof HM !== 'undefined' && HM.upd?.busy;
  const chip = busy ? `<span class="st-chip new">идёт установка</span>`
    : u.state === 'checking' ? '<span class="st-state"><span class="st-spin"></span>Проверяю…</span>'
    : u.state === 'latest' ? '<span class="st-chip ok">последняя версия</span>'
    : u.state === 'available' ? `<span class="st-chip warn">доступна ${esc(u.v.latest)}</span>`
    : u.state === 'error' ? '<span class="st-chip warn">не удалось проверить</span>' : '';
  const up = ST.stats?.uptimeSeconds;
  return `<div class="st-stat plain"><span class="st-ring">${ST_I.server}</span>
      <div class="st-stat-t"><span>Установлена версия</span><b class="st-ver">${esc(stVersion())}</b><span>${up ? `Запущена ${stUptime(up)} назад · ` : ''}служба <code class="st-code">electron</code></span></div>
      ${chip}
      <button type="button" class="btn btn-ghost" ${u.state === 'checking' || busy ? 'disabled' : ''} data-on-click="stCheck">${ST_I.upd}Проверить</button></div>
    ${busy ? `<div class="st-g"><div class="st-r"><div class="st-l"><b>Устанавливается ${esc(HM.upd.target || '')}</b><span>Ход установки по шагам виден в блоке обновления на главной странице.</span></div>
        <button type="button" class="btn btn-ghost" data-on-click="__h80">Открыть главную</button></div></div>`
    : u.state === 'available' ? `<div class="st-g">
      <div class="st-r"><div class="st-l"><b>Версия ${esc(u.v.latest)}</b><span>Служба перезапустится — у людей пропадёт связь примерно на 10–20 секунд, потом приложения переподключатся сами.</span></div>
        <button type="button" class="btn ux-solid" data-on-click="stInstall">${ST_I.down}Установить</button></div>
      ${u.v.notes ? `<div class="st-notes"><b>Что нового.</b> ${esc(u.v.notes)}</div>` : ''}
    </div>`
    : u.state === 'latest' ? '<p class="st-hint">Обновлений нет. Проверка обращается к GitHub — без токена это расходует анонимный лимит.</p>'
    : u.state === 'error' ? '<p class="st-hint">GitHub не ответил. Проверьте доступ сервера в интернет или токен в разделе «GitHub» и попробуйте ещё раз.</p>'
    : '<p class="st-hint">Ход установки показывается по шагам в блоке обновления на главной странице.</p>'}`;
}
const ST_PANES = { messages: stPaneMessages, attachments: stPaneAttachments, backups: stPaneBackups, github: stPaneGithub, update: stPaneUpdate };

function stFootRender() {
  const f = document.getElementById('st-foot');
  if (!f) return;
  const ch = stChanged(), errs = Object.values(stErrors());
  f.classList.toggle('ask', ST.confirmClose);
  if (!ch.length && !ST_FORM[ST.sec]) { f.hidden = true; return; }
  f.hidden = false;
  const busy = ST.saving ? 'disabled' : '';
  if (ST.confirmClose) {
    f.innerHTML = `<span class="st-state warn">${ST_I.warn}<span><b>Закрыть без сохранения?</b> Изменения пропадут.</span></span><span class="ux-grow"></span>
      <button type="button" class="btn btn-ghost" ${busy} data-on-click="stDiscard" data-a-click='[true]'>Не сохранять</button>
      <button type="button" class="btn ux-solid" id="st-foot-save" ${errs.length || ST.saving ? 'disabled' : ''} data-on-click="stSave" data-a-click='[true]'>${ST.saving ? 'Сохраняю…' : 'Сохранить и закрыть'}</button>`;
    return;
  }
  const secs = [...new Set(ch.map(c => c.sec))];
  const where = secs.length === 1 && secs[0] !== ST.sec ? ` ${ST_IN[secs[0]]}` : secs.length > 1 ? ' в двух разделах' : '';
  const state = ch.length && errs.length ? `<span class="st-state bad">${ST_I.warn}${esc(errs[0])}</span>`
    : ch.length ? `<span class="st-state warn"><i class="st-dot edit"></i><span>Не сохранено: <b>${ch.length} ${uxPlural(ch.length, 'изменение', 'изменения', 'изменений')}</b>${where}</span></span>`
    : `<span class="st-state ok">${ST_I.check}Все изменения сохранены</span>`;
  f.innerHTML = `${state}<span class="ux-grow"></span>
    <button type="button" class="btn btn-ghost" ${ch.length && !ST.saving ? '' : 'disabled'} data-on-click="stDiscard">Отменить</button>
    <button type="button" class="btn ux-solid" ${!ch.length || errs.length || ST.saving ? 'disabled' : ''} data-on-click="stSave">${ST.saving ? 'Сохраняю…' : 'Сохранить'}</button>`;
}
// Лёгкая перерисовка при вводе: навигация, подвал и подсветка ошибок — без пересоздания полей
function stChrome() {
  const nav = document.getElementById('st-nav');
  if (nav) nav.innerHTML = stNavHtml();
  stFootRender();
  const e = stErrors();
  ['imgMax', 'fileMax', 'life', 'edit', 'backupRetention'].forEach(k => document.getElementById('st-box-' + k)?.classList.toggle('bad', !!e[k]));
  const ex = document.getElementById('st-edit-example');
  if (ex) ex.innerHTML = stEditExample();
}
function stRender(focusId) {
  if (currentPage === 'settings') return spRender(focusId);
  const el = document.getElementById('st-form');
  if (!el || !ST.draft) return;
  const a = document.activeElement, keep = focusId || (a?.id && el.contains(a) ? a.id : null);
  let caret = null;
  try { caret = a?.selectionStart; } catch {}
  const body = document.getElementById('st-body'), scroll = body?.scrollTop || 0;
  const s = ST_SECTIONS.find(x => x.k === ST.sec);
  el.innerHTML = `
    <nav class="st-nav" aria-label="Разделы настроек">
      <div class="st-nav-h"><h2 id="st-title">Настройки</h2><p>Сервер · версия <b>${esc(stVersion())}</b></p></div>
      <div id="st-nav" class="st-nav-list">${stNavHtml()}</div>
    </nav>
    <section class="st-pane">
      <header class="st-head"><div><h3>${s.title || s.label}</h3><p>${s.desc}</p></div>
        <button type="button" class="modal-close" aria-label="Закрыть настройки" data-on-click="stClose">✕</button></header>
      <div class="st-body" id="st-body">${ST_PANES[ST.sec]()}</div>
      <footer class="st-foot" id="st-foot" hidden></footer>
    </section>`;
  stFootRender();
  const nb = document.getElementById('st-body');
  if (nb && !focusId) nb.scrollTop = scroll;
  const f = keep && document.getElementById(keep);
  if (f) { f.focus(); if (!focusId && caret != null) { try { f.setSelectionRange(caret, caret); } catch {} } }
}

function stGo(k) { ST.sec = k; ST.confirmClose = false; ST.bkNew = false; stRender(); const b = document.getElementById('st-body'); if (b) b.scrollTop = 0; }
function stStatusPreset(v) { ST.draft.statusDays = v; stRender(); }
function stEditPreset(v) {
  if (v === 'custom') { ST.editCustom = true; ST.editUnit = ST.draft.edit % 3600 === 0 ? 3600 : ST.draft.edit % 60 === 0 ? 60 : 1; return stRender('st-edit-n'); }
  ST.editCustom = false; ST.draft.edit = v; stRender();
}
function stEditN(v) { ST.draft.edit = v === '' ? NaN : Math.round(Number(v) * ST.editUnit); stChrome(); }
function stEditUnit(u) { const n = ST.draft.edit / ST.editUnit; ST.editUnit = u; if (Number.isFinite(n)) ST.draft.edit = Math.round(n * u); stRender(); }
function stNum(k, v) { ST.draft[k] = v === '' ? NaN : Number(v); stChrome(); }
function stStep(k, delta) {
  const cur = Number.isFinite(ST.draft[k]) ? Math.round(ST.draft[k]) : 0;
  ST.draft[k] = Math.max(1, Math.min(500, cur + delta));
  const inp = document.getElementById('st-n-' + k);
  if (inp) inp.value = ST.draft[k];
  stChrome();
}
function stLifePreset(v) {
  if (v === 'custom') { ST.lifeCustom = true; if (!ST.draft.life) ST.draft.life = 180; return stRender('st-n-life'); }
  ST.lifeCustom = false; ST.draft.life = v; stRender();
}
function stTokKey(e, k) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); stTokAdd(k, e.target.value); }
  else if (e.key === 'Backspace' && !e.target.value && ST.draft[k].length) { ST.draft[k] = ST.draft[k].slice(0, -1); stRender('st-tok-' + k); }
}
function stTokAdd(k, raw) {
  const items = String(raw).toLowerCase().split(/[\s,;]+/).map(x => x.replace(/^\.+/, '')).filter(Boolean);
  const ok = x => /^[a-z0-9]{1,10}$/.test(x);
  const bad = items.find(x => !ok(x));
  ST.draft[k] = [...new Set([...ST.draft[k], ...items.filter(ok)])];
  ST.tokErr[k] = bad ? `«${bad}» не похоже на расширение — только латиница и цифры, без точки` : '';
  stRender('st-tok-' + k);
}
function stTokDel(k, x) { ST.draft[k] = ST.draft[k].filter(y => y !== x); stRender('st-tok-' + k); }
function stTokClear() { ST.draft.fileExt = []; stRender(); }
function stQuick(name) { ST.draft.fileExt = [...new Set([...ST.draft.fileExt, ...ST_QUICK[name]])]; stRender(); }
function stBackupDay(d) {
  const set = new Set(ST.draft.backupDays);
  set.has(d) ? set.delete(d) : set.add(d);
  ST.draft.backupDays = [...set].sort();
  stRender();
}
function stBackupTime(v) { ST.draft.backupTime = v; stChrome(); }
function stToFiles() {
  if (stChanged().length) return stClose();
  closeModal('modal-settings');
  nav('files');
}

async function stSave(andClose) {
  const ch = stChanged();
  if (!ch.length || Object.keys(stErrors()).length || ST.saving) return;
  // Дни и время расписания копий сохраняются только вместе: иначе, включив дни
  // впервые при времени по умолчанию (совпадает с ST.saved), время не попадёт
  // в изменения и на сервере останется пустым — расписание не сработает
  if (ch.some(c => c.k === 'backupDays' || c.k === 'backupTime')) {
    for (const k of ['backupDays', 'backupTime']) if (!ch.some(c => c.k === k)) ch.push({ sec: 'backups', k });
  }
  ST.saving = true;
  stFootRender();
  const body = Object.fromEntries(ch.map(({ k }) => [ST_KEYS[k][0], ST_KEYS[k][1](ST.draft[k])]));
  const r = await api('PUT', '/api/admin/settings', body);
  ST.saving = false;
  if (!r?.ok) { toast(esc(r?.error || 'Не удалось сохранить настройки'), 'error'); return stFootRender(); }
  ST.saved = stClone(ST.draft);
  ST.confirmClose = false;
  toast(`Настройки сохранены: ${ch.length} ${uxPlural(ch.length, 'изменение', 'изменения', 'изменений')}`, 'success');
  if (currentPage === 'files' && ch.some(c => c.k === 'life')) renderFiles();
  if (andClose) return closeModal('modal-settings');
  stRender();
}
function stDiscard(andClose) {
  ST.draft = stClone(ST.saved);
  Object.assign(ST, { editCustom: false, lifeCustom: false, tokErr: {}, confirmClose: false });
  if (andClose) return closeModal('modal-settings');
  stRender();
}
function stClose() {
  if (stChanged().length) {
    if (!ST.confirmClose) { ST.confirmClose = true; stFootRender(); document.getElementById('st-foot-save')?.focus(); }
    return;
  }
  closeModal('modal-settings');
}

/* ── ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ ── */
// Окно открывается из списка копий («Восстановить») или кнопкой «Восстановить из файла…». Три переключателя:
// пользователи, чаты, настройки. Администраторы сохраняются всегда. Сервер сравнивает базу с копией
// (/backups/restore/inspect), перед началом делает копию «до восстановления» (/safety), потом применяет (/apply).
const RS = { step: 'closed', src: null, info: null, sw: { users: true, chats: true, settings: false }, word: '', k: 0, err: '', up: 0, name: '', result: null };
const RS_I = {
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chk: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
};
const rsIc = (k, s = 16, sw = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RS_I[k]}</svg>`;
const rsN = n => Number(n || 0).toLocaleString('ru-RU');
const rsWhen = t => t ? new Date(t * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

function rsOpen() { openModal('modal-restore'); rsRender(); }
function rsClose() {
  if (RS.step === 'run' || RS.step === 'upload') return;
  RS.step = 'closed'; closeModal('modal-restore');
}
// из списка копий
async function rsFromBackup(name) {
  RS.src = { name }; RS.name = name; RS.info = null; RS.err = ''; RS.word = '';
  RS.sw = { users: true, chats: true, settings: false };
  RS.step = 'loading'; rsOpen();
  await rsInspect();
}
async function rsInspect() {
  const r = await api('POST', '/api/admin/backups/restore/inspect', RS.src);
  if (!r?.ok) { RS.err = r?.error || 'Не удалось проверить копию'; RS.step = 'error'; return rsRender(); }
  RS.info = r; RS.step = 'confirm'; rsRender();
}
// из файла
function rsPick() {
  Object.assign(RS, { step: 'pick', src: null, info: null, err: '', up: 0, word: '', sw: { users: true, chats: false, settings: false } });
  rsOpen();
}
function rsChoose() { document.getElementById('rs-file')?.click(); }
function rsUpload(file) {
  if (!file) return;
  if (!/\.(db|sqlite|sqlite3)$/i.test(file.name)) { RS.err = 'Нужен файл копии с расширением .db'; RS.step = 'pick'; return rsRender(); }
  RS.name = file.name; RS.up = 0; RS.err = ''; RS.step = 'upload'; rsRender();
  const x = new XMLHttpRequest();
  x.open('POST', '/api/admin/backups/restore/upload');
  x.setRequestHeader('Authorization', 'Bearer ' + token);
  x.setRequestHeader('Content-Type', 'application/octet-stream');
  x.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  x.upload.onprogress = e => { if (e.lengthComputable) { RS.up = Math.round(e.loaded / e.total * 100); const b = document.getElementById('rs-upbar'); if (b) b.style.width = RS.up + '%'; const t = document.getElementById('rs-uppct'); if (t) t.textContent = RS.up + '%'; } };
  x.onerror = () => { RS.err = 'Не удалось загрузить файл'; RS.step = 'pick'; rsRender(); };
  x.onload = async () => {
    let r = null; try { r = JSON.parse(x.responseText); } catch {}
    if (!r?.ok) { RS.err = r?.error || 'Не удалось загрузить файл'; RS.step = 'pick'; return rsRender(); }
    RS.src = { upload_id: r.id, file_name: r.name }; RS.step = 'check'; rsRender();
    await rsInspect();
  };
  x.send(file);
}
function rsSw(k) {
  const sw = RS.sw; sw[k] = !sw[k];
  if (k === 'chats' && sw.chats) sw.users = true;
  rsRender(true);
}
function rsWordInput(v) {
  RS.word = v;
  const ok = rsReady(), b = document.getElementById('rs-go'), n = document.getElementById('rs-note'), inp = document.getElementById('rs-word');
  if (b) b.disabled = !ok; if (inp) inp.classList.toggle('ok', ok);
  if (n) { n.className = 'rs-note' + (ok ? ' ok' : ''); n.innerHTML = rsNote(); }
}
const rsAny = () => RS.sw.users || RS.sw.chats || RS.sw.settings;
const rsReady = () => RS.word.trim().toLowerCase() === 'восстановить' && rsAny();
const rsNote = () => rsReady() ? '<b>Всё готово</b>' : `Осталось: <b>${rsAny() ? 'ввести слово' : 'выбрать, что восстановить'}</b>`;

async function rsGo() {
  if (!rsReady() || RS.step !== 'confirm') return;
  RS.step = 'run'; RS.k = 0; RS.err = ''; rsRender();
  const s = await api('POST', '/api/admin/backups/restore/safety');
  if (!s?.ok) { RS.err = s?.error || 'Не удалось создать копию перед восстановлением'; RS.step = 'confirm'; rsRender(); return toast(esc(RS.err), 'error'); }
  RS.k = 1; rsRender();
  const r = await api('POST', '/api/admin/backups/restore/apply', { ...RS.src, safety: s.name, ...RS.sw });
  if (!r?.ok) { RS.err = r?.error || 'Восстановление не удалось'; RS.step = 'confirm'; rsRender(); return toast(esc(RS.err), 'error'); }
  RS.k = 5; RS.result = r.result; RS.step = 'done'; rsRender();
  if (r.backups && typeof ST !== 'undefined') { ST.backups = r.backups; ST.bkNew = true; }
  rsRefreshLists();
  // чаты заменены — сводка на главной и счётчики в меню устарели
  try { updateNavBadges(); } catch {}
}
function rsRefreshLists() {
  try { if (document.getElementById('modal-settings')?.classList.contains('open')) stRender(); else if (currentPage === 'settings') spRender(); } catch {}
}

function rsEff() {
  const i = RS.info, sw = RS.sw, n = i.now, c = i.copy, E = {};
  E.users = sw.users ? n.users + i.uNew : n.users;
  const ch = k => sw.chats ? c[k] : n[k];
  E.rooms = ch('rooms'); E.groups = ch('groups'); E.direct = ch('direct'); E.msgs = ch('msgs'); E.last = sw.chats ? c.last : n.last;
  return E;
}
function rsRender(keepScroll) {
  const box = document.getElementById('rs-box'); if (!box) return;
  const sc = keepScroll ? box.querySelector('.rs-b')?.scrollTop : 0;
  const head = (title, sub, close = true) => `<div class="rs-h"><span class="rs-ic">${rsIc('restore', 20)}</span><div class="rs-t"><h3>${title}</h3><div class="rs-sub">${sub}</div></div>${close ? `<button type="button" class="ux-ibtn" aria-label="Закрыть" data-on-click="rsClose">${rsIc('x', 14)}</button>` : ''}</div>`;
  const stepsHtml = (list) => `<div class="rs-steps">${list.map(([t, st]) => `<div class="rs-st ${st}"><span class="rs-dot">${st === 'done' ? rsIc('chk', 12, 3) : ''}</span>${t}</div>`).join('')}</div>`;
  let html = '';
  if (RS.step === 'loading' || RS.step === 'check') {
    html = head('Восстановление', RS.step === 'check' ? esc(RS.name) : 'Проверяю копию…') + `<div class="rs-b">${stepsHtml(RS.step === 'check' ? [['Файл загружен', 'done'], ['Проверяю: база SQLite, целостность, схема', 'on']] : [['Проверяю копию: целостность, схема, содержимое', 'on']])}</div>`;
  } else if (RS.step === 'pick') {
    html = head('Восстановить из файла', 'Выберите файл резервной копии (.db)') + `<div class="rs-b"><div class="rs-drop" id="rs-drop"><span class="rs-ic2">${rsIc('upload', 24)}</span><b>Перетащите файл сюда</b><span class="rs-sub">или выберите на компьютере. Подойдёт копия, скачанная из этого или другого сервера</span><button type="button" class="btn btn-primary" data-on-click="rsChoose">Выбрать файл…</button></div>${RS.err ? `<div class="rs-err">${esc(RS.err)}</div>` : ''}</div>`;
  } else if (RS.step === 'upload') {
    html = head('Загрузка файла', esc(RS.name), false) + `<div class="rs-b"><div class="rs-upl"><div class="rs-bar"><i id="rs-upbar" style="width:${RS.up}%"></i></div><span class="hm-mono" id="rs-uppct">${RS.up}%</span></div><div class="rs-sub">Не закрывайте страницу. Большой файл может грузиться несколько минут</div></div>`;
  } else if (RS.step === 'error') {
    html = head('Восстановление', 'Не удалось проверить копию') + `<div class="rs-b"><div class="rs-err">${esc(RS.err)}</div></div><div class="rs-f"><span class="rs-note"></span><button type="button" class="btn btn-ghost" data-on-click="rsClose">Закрыть</button></div>`;
  } else if (RS.step === 'run' || RS.step === 'done') {
    const sw = RS.sw, r = RS.result, done = RS.step === 'done';
    const st = (i, on) => !on ? 'skip' : RS.k > i ? 'done' : RS.k === i ? 'on' : '';
    html = head(done ? 'Восстановление завершено' : 'Идёт восстановление', esc(RS.src?.name || RS.name) + (done ? '' : ' · не закрывайте страницу'), false) + `<div class="rs-b">
      ${done ? `<div class="rs-ok"><span class="rs-ck">${rsIc('chk', 30, 3)}</span><b>Готово</b><span class="rs-sub">${[r.users ? `людей добавлено ${rsN(r.users.added)}, обновлено ${rsN(r.users.updated)}` : '', r.chats ? `чатов: ${rsN(r.chats.rooms + r.chats.groups + r.chats.direct)}, сообщений: ${rsN(r.chats.msgs)}` : '', sw.settings ? 'настройки из копии' : ''].filter(Boolean).join(' · ')}</span></div>` : ''}
      ${stepsHtml([['Копия «до восстановления»', st(0, true)], ['Пользователи', st(1, sw.users)], ['Чаты, переписки, вебхуки', st(1, sw.chats)], ['Настройки', st(1, sw.settings)]].map(([t, s], i) => [t, done && s !== 'skip' ? 'done' : s]))}
      ${done ? `<div class="rs-adm">${rsIc('shield', 18)}<div>Администраторы сохранены: <b>${(RS.info.admins || []).map(esc).join(', ')}</b>. Копия «До восстановления» лежит в списке: если что-то пошло не так, из неё можно вернуться.${r.chats ? ' Клиенты перезапускаются сами.' : ''}</div></div>` : ''}</div>${done ? `<div class="rs-f"><span class="rs-note">Копия «До восстановления» создана</span><button type="button" class="btn btn-primary" data-on-click="rsClose">Закрыть</button></div>` : ''}`;
  } else if (RS.step === 'confirm') {
    const i = RS.info, sw = RS.sw, E = rsEff(), n = i.now, c = i.copy, name = RS.src?.upload_id ? esc(RS.src.file_name) : esc(rsWhen(i.source.created_at)) + ' · ' + esc(i.source.name);
    const cell = (cur, nw) => `<td class="${nw > cur ? 'up' : nw < cur ? 'dn' : 'eq'}">${rsN(nw)}${nw !== cur ? `<small>${nw > cur ? '+' : '−'}${rsN(Math.abs(nw - cur))}</small>` : ''}</td>`;
    const swRow = (k, title, desc, eff, lock) => `<div class="rs-sw ${sw[k] ? 'on' : ''}"><button type="button" class="rs-tg" role="switch" aria-checked="${sw[k]}" data-on-click="rsSw" data-a-click="${esc(JSON.stringify([`${k}`]))}" ${lock ? 'disabled title="Включено, потому что чаты ссылаются на людей"' : ''}></button><div><b>${title}${lock ? ' ' + rsIc('lock', 13) : ''}</b><div class="rs-d">${desc}</div></div>${sw[k] && eff ? `<div class="rs-eff">${eff}</div>` : ''}</div>`;
    const warns = [];
    if (!rsAny()) warns.push(['warn', '<b>Ничего не выбрано.</b> Включите хотя бы один переключатель']);
    if (sw.chats) warns.push(['warn', '<b>Клиенты перезапустятся сами</b>: у людей в сети это 1–2 секунды']);
    if (sw.users && i.pw) warns.push(['warn', `<b>${rsN(i.pw)} ${hmPlural(i.pw, 'человек войдёт', 'человека войдут', 'человек войдут')} заново</b>: у них поменяется пароль`]);
    if (sw.chats) warns.push(['warn', '<b>Вложения не восстанавливаются</b>: в копии только база, файлы лежат отдельно']);
    warns.push(['ok', 'Перед началом сервер сделает копию «До восстановления», при ошибке всё откатится']);
    const parts = [sw.users ? 'пользователи' : '', sw.chats ? 'чаты' : '', sw.settings ? 'настройки' : ''].filter(Boolean);
    html = head('Восстановление из копии', `${name} · ${hmBytes(i.source.size)}${RS.src?.upload_id ? ' · из файла' : ''}`) + `<div class="rs-b">
      ${swRow('users', 'Восстановить пользователей', (sw.chats ? 'Включено: чаты ссылаются на людей. ' : '') + 'Добавит недостающих, обновит данные существующих. Никого не удаляет', `<span class="g">+${rsN(i.uNew)} новых</span><span class="m">обновится ${rsN(i.uUpd)}</span>${i.pw ? `<span class="m">${rsN(i.pw)} войдут заново</span>` : ''}`, sw.chats)}
      ${swRow('chats', 'Восстановить чаты', 'Комнаты, группы и личные переписки заменятся теми, что в копии', i.lost > 0 ? `<span class="w">пропадёт ${rsN(i.lost)} ${hmPlural(i.lost, 'сообщение', 'сообщения', 'сообщений')} после ${esc(rsWhen(c.last))}</span>` : `<span class="g">${c.msgs > n.msgs ? `вернётся ${rsN(c.msgs - n.msgs)} сообщений` : 'новых сообщений после копии нет'}</span>`)}
      ${swRow('settings', 'Восстановить настройки', 'Токен GitHub, расписание копий, лимиты файлов. Технические ключи входа и уведомлений не трогаются', (i.settings || []).length ? i.settings.map(r => `<span class="m">${esc(r[0])}: ${esc(r[1])} → <b>${esc(r[2])}</b></span>`).join('') : '<span class="m">настройки в копии совпадают с текущими</span>')}
      <div><div class="rs-lbl">Что станет</div><table class="rs-cmp"><thead><tr><th></th><th>Сейчас</th><th>В копии</th><th>Станет</th></tr></thead><tbody>
        <tr><td>Пользователей</td><td class="now">${rsN(n.users)}</td><td class="now">${rsN(c.users)}</td>${cell(n.users, E.users)}</tr>
        <tr><td>Комнат</td><td class="now">${rsN(n.rooms)}</td><td class="now">${rsN(c.rooms)}</td>${cell(n.rooms, E.rooms)}</tr>
        <tr><td>Групп</td><td class="now">${rsN(n.groups)}</td><td class="now">${rsN(c.groups)}</td>${cell(n.groups, E.groups)}</tr>
        <tr><td>Личных переписок</td><td class="now">${rsN(n.direct)}</td><td class="now">${rsN(c.direct)}</td>${cell(n.direct, E.direct)}</tr>
        <tr><td>Сообщений</td><td class="now">${rsN(n.msgs)}</td><td class="now">${rsN(c.msgs)}</td>${cell(n.msgs, E.msgs)}</tr>
        <tr><td>Последнее сообщение</td><td class="now t">${esc(rsWhen(n.last))}</td><td class="now t">${esc(rsWhen(c.last))}</td><td class="eq t">${esc(rsWhen(E.last))}</td></tr></tbody></table></div>
      <div class="rs-adm">${rsIc('shield', 18)}<div><b>Администраторы сохранятся всегда:</b> ${(i.admins || []).map(a => `<span class="rs-pill">${esc(a)}</span>`).join(' ')}<div class="rs-sub" style="margin-top:3px">Останутся с текущими паролем, правами и 2FA, ваша сессия не прервётся</div></div></div>
      <div class="rs-warns">${warns.map(([k, t]) => `<div class="${k}">${rsIc(k === 'ok' ? 'shield' : 'warn', 14)}<span>${t}</span></div>`).join('')}</div>
      ${RS.err ? `<div class="rs-err">${esc(RS.err)}</div>` : ''}
      <div class="rs-word"><label class="rs-lbl" for="rs-word">Введите слово ВОССТАНОВИТЬ, чтобы продолжить</label><input id="rs-word" autocomplete="off" spellcheck="false" placeholder="ВОССТАНОВИТЬ" value="${esc(RS.word)}" class="${rsReady() ? 'ok' : ''}" data-on-input="rsWordInput" data-a-input='["__value"]' data-on-keydown="__h81"></div></div>
    <div class="rs-f"><span class="rs-note ${rsReady() ? 'ok' : ''}" id="rs-note">${rsNote()}</span><button type="button" class="btn btn-ghost" data-on-click="rsClose">Отмена</button><button type="button" class="btn btn-danger" id="rs-go" data-on-click="rsGo" ${rsReady() ? '' : 'disabled'}>Восстановить${parts.length ? ': ' + parts.join(', ') : ''}</button></div>`;
  }
  box.innerHTML = html;
  const b = box.querySelector('.rs-b'); if (b && sc) b.scrollTop = sc;
  const dz = document.getElementById('rs-drop');
  if (dz) {
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); rsUpload(e.dataTransfer.files?.[0]); };
  }
  if (keepScroll) { const w = document.getElementById('rs-word'); if (w && RS.word) { w.focus(); w.setSelectionRange(w.value.length, w.value.length); } }
}

async function stBackup() {
  if (ST.bkBusy) return;
  ST.bkBusy = true;
  stRender();
  const r = await api('POST', '/api/admin/backups');
  ST.bkBusy = false;
  if (r?.error || !r) { toast(esc(r?.error || 'Не удалось создать копию'), 'error'); return stRender(); }
  ST.backups = r.backups || ST.backups;
  ST.bkNew = true;
  stRender();
  toast('Копия создана', 'success');
}
// Скачивание через токен в заголовке: ссылкой не обойтись, авторизация в Bearer
async function stDownload(name, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(name)}/download`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { toast('Не удалось скачать копию', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch { toast('Не удалось скачать копию', 'error'); }
  finally { if (btn) btn.disabled = false; }
}
function stDeleteBackup(name) {
  confirm('Удалить копию?', `Файл ${name} будет удалён без возможности восстановления.`, async () => {
    const r = await api('DELETE', `/api/admin/backups/${encodeURIComponent(name)}`);
    if (!r?.ok) { toast(esc(r?.error || 'Не удалось удалить копию'), 'error'); return; }
    ST.backups = r.backups || ST.backups.filter(b => b.name !== name);
    toast('Копия удалена', 'success');
    stRender();
  });
}

function stGhShow() {
  const v = document.getElementById('st-gh')?.value || '';
  ST.gh.show = !ST.gh.show;
  stRender();
  const inp = document.getElementById('st-gh');
  if (inp) { inp.value = v; inp.focus(); }
}
async function stGhSave() {
  const g = ST.gh, v = (document.getElementById('st-gh')?.value || '').trim();
  g.err = !v ? 'Вставьте токен в поле'
    : !/^(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|[0-9a-f]{40})$/.test(v) ? 'Не похоже на токен GitHub — обычно он начинается с ghp_ или github_pat_' : '';
  if (g.err) { stRender('st-gh'); document.getElementById('st-gh').value = v; return; }
  g.busy = true;
  stRender();
  const r = await api('PUT', '/api/admin/settings', { github_token: v });
  const s = r?.ok ? await api('GET', '/api/admin/settings') : null;
  g.busy = false;
  if (!s) { toast('Не удалось сохранить токен', 'error'); return stRender(); }
  g.set = !!s.github_token_set; g.show = false;
  stRender();
  toast('Токен сохранён', 'success');
  spLoadRate();
}
function stGhDel() {
  confirm('Удалить токен GitHub?', 'Проверки обновлений пойдут анонимно — не больше 60 запросов в час.', async () => {
    ST.gh.busy = true;
    stRender();
    const r = await api('PUT', '/api/admin/settings', { github_token: '' });
    ST.gh.busy = false;
    if (r?.ok) { ST.gh.set = false; ST.gh.err = ''; toast('Токен удалён', 'success'); spLoadRate(); }
    else toast('Не удалось удалить токен', 'error');
    stRender();
  });
}

async function stCheck() {
  ST.upd = { state: 'checking', v: null };
  stRender();
  const v = await api('GET', '/api/admin/server/version');
  ST.upd = !v?.latest ? { state: 'error', v: null } : { state: v.hasUpdate ? 'available' : 'latest', v };
  // Та же проверка нужна главной: там кнопка сразу покажет результат, а установка возьмёт версию отсюда
  if (v?.latest && typeof HM !== 'undefined') { HM.upd.check = v; HM.upd.checkedAt = Date.now(); }
  if (currentPage === 'settings') spRender();
  else if (document.getElementById('modal-settings')?.classList.contains('open')) stRender();
}
// Установка идёт с главной: там шаги, опрос состояния и проверка версии после перезапуска
async function stInstall() {
  const v = ST.upd.v;
  if (!v?.hasUpdate) return;
  closeModal('modal-settings');
  HM.upd.check = v;
  HM.upd.checkedAt = Date.now();
  nav('dashboard');
  for (let i = 0; i < 50 && !document.getElementById('hm-upd-panel'); i++) await new Promise(r => setTimeout(r, 100));
  hmUpdInstall();
}

function restartService() {
  confirm('Перезапустить службу?',
    'Сервер будет перезапущен через systemd.\nАдминка переподключится автоматически (~5–10 сек).',
    async () => {
      const data = await api('POST', '/api/admin/system/restart');
      if (!data.ok) { toast(data.error || 'Ошибка перезапуска', 'error'); return; }
      toast('Служба перезапускается…');

      // Polling до восстановления сервера
      const startedAt = Date.now();
      const MAX_WAIT = 30000;
      const poll = setInterval(async () => {
        if (Date.now() - startedAt > MAX_WAIT) {
          clearInterval(poll);
          toast('Сервер не ответил за 30 сек', 'error');
          return;
        }
        try {
          const res = await fetch('/api/admin/stats', {
            headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' }
          });
          if (res.ok) {
            clearInterval(poll);
            toast('Служба запущена', 'success');
          }
        } catch {}
      }, 1500);
    }
  );
}

/* ── НАСТРОЙКИ: страница ── */
// Раздел «Настройки»: разделы раскрываются по клику, правка применяется сразу и отменяется кнопкой
// в уведомлении. Опасное (удаление файлов и копий) просит подтверждения в самой строке. Логика
// копий и токена — та же, что у прежнего окна (ST, stBackup, stGhSave). Обновление сервера
// здесь не настраивается: статус и кнопка «↑ версия» живут в сайдбаре, установка — на главной.

const SP = { open: new Set(), rate: null, disk: null, q: '', files: [], audit: [], online: 0, pend: null, loaded: false, editCustom: false, editUnit: 60, lifeCustom: false, showBk: false, showLog: false,
  db: { info: null, form: { host: '127.0.0.1', port: 5432, database: 'electron', user: 'electron', password: '', ssl: '' }, test: null, testing: false, confirm: false, job: null, down: false, t: null } };
const SP_KEYS = { messages: ['edit', 'statusDays'], attachments: ['imgMax', 'imgExt', 'videoMax', 'videoExt', 'fileMax', 'fileExt', 'life'], backups: ['backupDays', 'backupTime', 'backupRetention'] };
const SP_DEF = { edit: 120, statusDays: 7, imgMax: 10, imgExt: ['jpeg', 'jpg', 'png', 'gif', 'webp'], videoMax: 50, videoExt: ['mp4', 'mov', 'webm'], fileMax: 50, fileExt: [], life: 0, backupDays: [], backupTime: '03:00', backupRetention: NaN };
const SP_AUDIT_KEY = { messages: 'edit_time_limit', attachments: 'upload_', backups: 'backup_', github: 'github_token' };
const spShortDur = s => s >= 3600 && s % 3600 === 0 ? `${s / 3600} ч` : s >= 60 && s % 60 === 0 ? `${s / 60} мин` : `${s} с`;
const SP_LABEL = {
  edit: ['Время на правку', spShortDur], statusDays: ['Окно времени статуса', v => v ? v + ' дн' : 'не хранить'], imgMax: ['Размер картинок', v => v + ' МБ'], imgExt: ['Форматы картинок', v => v.join(', ')], videoMax: ['Размер видео', v => v + ' МБ'],
  videoExt: ['Форматы видео', v => v.join(', ')], fileMax: ['Размер файлов', v => v + ' МБ'], fileExt: ['Форматы файлов', v => v.length ? v.join(', ') : 'не разрешены'],
  life: ['Хранение файлов', v => v ? v + ' дн' : 'всегда'], backupDays: ['Дни копий', v => v.length ? ST_DAYS.filter(d => v.includes(d[0])).map(d => d[1]).join(', ') : 'вручную'],
  backupTime: ['Время копий', v => v], backupRetention: ['Хранение копий', v => v ? v + ' дн' : 'всегда'],
};
const spSv = k => ST.saved[k];
const spFileTs = f => f.sent_at || Math.floor((f.mtime || 0) / 1000);
const spFileAgeDays = f => (Date.now() / 1000 - spFileTs(f)) / 86400;
const spBkAgeDays = b => (Date.now() / 1000 - b.created_at) / 86400;
const spQ = () => SP.q.trim().toLowerCase();
const spHit = (...parts) => { const q = spQ(); if (!q) return true; const stem = q.slice(0, Math.max(3, q.length - 1)); return parts.join(' ').toLowerCase().includes(stem); };
function spToast(html, undo) {
  document.querySelectorAll('.sp-toast').forEach(e => e.remove());
  const e = document.createElement('div');
  e.className = 'sp-toast'; e.innerHTML = `<span>${html}</span>${undo ? '<button type="button">Отменить</button>' : ''}`;
  document.body.appendChild(e);
  if (undo) e.querySelector('button').onclick = () => { spToastOut(e); undo(); };
  setTimeout(() => spToastOut(e), undo ? 7000 : 2200);
}
function spToastOut(e) {
  if (!e.isConnected || e.classList.contains('out')) return;
  e.classList.add('out');
  setTimeout(() => e.remove(), 200);
}

async function renderSettings() {
  setTopbarActions('');
  document.getElementById('page-body').innerHTML = '<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>';
  const [settings, stats, backups, files, users, audit, overview, dbInfo] = await Promise.all([
    api('GET', '/api/admin/settings'), api('GET', '/api/admin/stats'), api('GET', '/api/admin/backups'),
    api('GET', '/api/admin/files'), api('GET', '/api/admin/users'), api('GET', '/api/admin/audit-log?limit=200'),
    hmGet('/api/admin/overview'), api('GET', '/api/admin/database'),
  ]);
  if (currentPage !== 'settings') return;
  if (!settings || settings.error) { document.getElementById('page-body').innerHTML = '<div class="ux-page"><div class="ux-empty">Не удалось загрузить настройки</div></div>'; return; }
  stFromSettings(settings);
  Object.assign(ST, { stats, backups: Array.isArray(backups) ? backups : [], bkNew: false });
  ST.gh.show = false; ST.gh.err = '';
  SP.files = Array.isArray(files) ? files : [];
  SP.disk = overview?.storage?.disk || null;
  if (Array.isArray(users)) { allUsersCache = users; SP.online = users.filter(u => u.status === 'online' && !u.banned).length; }
  SP.audit = Array.isArray(audit) ? audit.filter(a => a.category === 'server') : [];
  SP.db.info = dbInfo && !dbInfo.error ? dbInfo : null; SP.db.job = SP.db.info?.job || null;
  if (SP.db.job && (SP.db.job.state === 'running' || SP.db.job.state === 'restarting')) { SP.open.add('database'); spDbPoll(); }
  if (SP.db.info?.install && SP.db.info.install.state === 'running') { SP.open.add('database'); pgiResume(SP.db.info.install); }
  SP.loaded = true; SP.pend = null;
  spLoadRate();
  clearInterval(SP.rateTimer);
  SP.rateTimer = setInterval(() => { if (currentPage === 'settings') spLoadRate(); else clearInterval(SP.rateTimer); }, 60000);
  if (ST.goSec) { SP.open.add(ST.goSec); }
  spRender();
  if (ST.goSec) { const k = ST.goSec; ST.goSec = null; spScroll(k); }
}
// Прежнее окно настроек заменено страницей: старые вызовы ведут сюда
function openSettingsModal(section = 'messages') {
  ST.goSec = section;
  if (currentPage === 'settings') { SP.open.add(section); spRender(); ST.goSec = null; spScroll(section); }
  else nav('settings');
}
function spScroll(k) { setTimeout(() => document.getElementById('sp-acc-' + k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }

// Применение: проверка, запись на сервер, уведомление с отменой
async function spSet(map, silent) {
  const keys = Object.keys(map).filter(k => JSON.stringify(ST.saved[k]) !== JSON.stringify(map[k]));
  if (!keys.length) return spRender();
  const keep = ST.draft;
  ST.draft = { ...stClone(ST.saved), ...stClone(map) };
  const errs = stErrors();
  ST.draft = keep;
  const bad = keys.find(k => errs[k]);
  if (bad) { toast(esc(errs[bad]), 'error'); return spRender(); }
  const all = new Set(keys);
  // Дни и время расписания копий сохраняются только вместе
  if (all.has('backupDays') || all.has('backupTime')) { all.add('backupDays'); all.add('backupTime'); }
  const body = Object.fromEntries([...all].map(k => [ST_KEYS[k][0], ST_KEYS[k][1](k in map ? map[k] : ST.saved[k])]));
  const r = await api('PUT', '/api/admin/settings', body);
  if (!r?.ok) { toast(esc(r?.error || 'Не удалось сохранить настройку'), 'error'); return spRender(); }
  const prev = Object.fromEntries(keys.map(k => [k, stClone(ST.saved[k])]));
  const lines = keys.map(k => `${SP_LABEL[k][0]}: <s>${esc(SP_LABEL[k][1](prev[k]))}</s> → <b>${esc(SP_LABEL[k][1](map[k]))}</b>`);
  keys.forEach(k => { ST.saved[k] = stClone(map[k]); });
  ST.draft = stClone(ST.saved);
  api('GET', '/api/admin/audit-log?limit=200').then(a => { if (Array.isArray(a)) { SP.audit = a.filter(x => x.category === 'server'); if (currentPage === 'settings') spRender(); } });
  spRender();
  if (!silent) spToast(keys.length > 1 ? `Изменено настроек: ${keys.length}` : lines[0], () => spSet(prev, true));
}
const spDeb = {};
const spLater = (key, fn) => { clearTimeout(spDeb[key]); spDeb[key] = setTimeout(fn, 700); };

// ── Сообщения ──
function spEditPreset(v) {
  if (v === 'custom') { SP.editCustom = true; SP.editUnit = spSv('edit') % 3600 === 0 ? 3600 : spSv('edit') % 60 === 0 ? 60 : 1; return spRender('sp-edit-n'); }
  SP.editCustom = false; spSet({ edit: v });
}
function spEditN(v) { spLater('edit', () => { const n = parseFloat(v); if (n > 0) spSet({ edit: Math.round(n * SP.editUnit) }); }); }
function spEditUnit(u) { const n = spSv('edit') / SP.editUnit; SP.editUnit = u; if (Number.isFinite(n)) spSet({ edit: Math.round(n * u) }); else spRender(); }
// ── Вложения ──
function spStep(k, d) { spSet({ [k]: Math.max(1, Math.min(500, Math.round(spSv(k)) + d)) }); }
function spNum(k, v) { spLater(k, () => { const n = parseInt(v); if (Number.isFinite(n)) spSet({ [k]: Math.max(1, Math.min(500, n)) }); }); }
function spTokAdd(k, raw) {
  const items = String(raw).toLowerCase().split(/[\s,;]+/).map(x => x.replace(/^\.+/, '')).filter(Boolean);
  const good = items.filter(x => /^[a-z0-9]{1,10}$/.test(x)), bad = items.find(x => !/^[a-z0-9]{1,10}$/.test(x));
  if (bad) toast(esc(`«${bad}» не похоже на расширение: только латиница и цифры, без точки`), 'error');
  const next = [...new Set([...spSv(k), ...good])];
  if (next.length !== spSv(k).length) spSet({ [k]: next }); else spRender('sp-tok-' + k);
}
function spTokKey(e, k) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); spTokAdd(k, e.target.value); }
  else if (e.key === 'Backspace' && !e.target.value && spSv(k).length) spSet({ [k]: spSv(k).slice(0, -1) });
}
function spTokDel(k, x) { spSet({ [k]: spSv(k).filter(y => y !== x) }); }
function spQuick(name) { spSet({ fileExt: [...new Set([...spSv('fileExt'), ...ST_QUICK[name]])] }); }
function spLife(v) {
  if (v === 'custom') { SP.lifeCustom = true; return spRender('sp-life-n'); }
  SP.lifeCustom = false;
  const old = v ? SP.files.filter(f => spFileAgeDays(f) > v).length : 0;
  if (old) { SP.pend = { key: 'life', val: v }; spRender(); } else { SP.pend = null; spSet({ life: v }); }
}
function spLifeN(v) { spLater('life', () => { const n = parseInt(v); if (n > 0) spLife(n); }); }
// ── Копии ──
function spDay(d) { const set = new Set(spSv('backupDays')); set.has(d) ? set.delete(d) : set.add(d); spSet({ backupDays: [...set].sort() }); }
function spTime(v) { spLater('time', () => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) spSet({ backupTime: v }); }); }
function spRet(v) {
  spLater('ret', () => {
    const n = parseInt(v), val = Number.isFinite(n) && n > 0 ? n : NaN, old = val ? ST.backups.filter(b => spBkAgeDays(b) > val).length : 0;
    if (old) { SP.pend = { key: 'backupRetention', val }; spRender(); } else { SP.pend = null; spSet({ backupRetention: val }); }
  });
}
function spPendOk() { const p = SP.pend; SP.pend = null; if (p) spSet({ [p.key]: p.val }); }
function spPendNo() { SP.pend = null; SP.lifeCustom = false; spRender(); }
function spSug(kind) {
  if (kind === 'life') return spLife(90);
  if (kind === 'days') return spSet({ backupDays: [1, 2, 3, 4, 5], backupTime: '03:00' });
  if (kind === 'gh') { SP.open.add('github'); spRender(); spScroll('github'); setTimeout(() => document.getElementById('st-gh')?.focus(), 400); }
}
function spResetSec(k) { const m = {}; SP_KEYS[k].forEach(x => { m[x] = stClone(SP_DEF[x]); }); spSet(m); }
function spTog(k) {
  if (SP.open.has(k) && !spQ()) { expCollapse(document.querySelector(`#sp-acc-${k} .sp-ab`), () => { SP.open.delete(k); spRender(); }); return; }
  SP.open.add(k); spRender();
}
function spExpand(all) { if (all) SP_ORDER.forEach(k => SP.open.add(k)); else SP.open.clear(); spRender(); }
function spSearch(v) { SP.q = v; spRender('sp-q'); }

// ── Разметка ──
// ── Верхние плитки ──
// Остаток лимита GitHub спрашиваем у самого GitHub (сервер вызывает /rate_limit, он в лимит не
// засчитывается), поэтому «потрачено» точное, включая запросы не только этой админки
async function spLoadRate() {
  let r;
  try {
    const res = await fetch('/api/admin/github/rate?_t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' } });
    const j = await res.json().catch(() => ({}));
    r = res.ok && j.limit != null ? j : { error: j.error || 'Не удалось узнать остаток' };
  } catch { r = { error: 'Нет связи с сервером' }; }
  SP.rate = r;
  if (currentPage !== 'settings' || !SP.loaded) return;
  const t = document.getElementById('sp-t-gh');
  if (t) t.innerHTML = spGhTile(); else spRender();
}
function spGhTileClick() { if (SP.rate?.error) spLoadRate(); else spOpen('github'); }
function spGhTile() {
  const r = SP.rate, lb = '<div class="ub-lbl">Лимит GitHub</div>';
  if (!r) return `${lb}<div class="ub-big">…</div><div class="ub-sub">Узнаю остаток у GitHub</div>`;
  if (r.error) return `${lb}<div class="ub-big">—</div><div class="ub-sub">${esc(r.error)}. Нажмите, чтобы повторить</div>`;
  const pct = r.limit ? Math.round(r.used / r.limit * 100) : 0, col = pct >= 90 ? 'var(--c-red)' : pct >= 70 ? 'var(--c-orange)' : 'var(--c-green)';
  const mins = Math.max(1, Math.ceil((r.reset * 1000 - Date.now()) / 60000));
  return `${lb}<div class="ub-big">${rmFmt(r.used)}<small>из ${rmFmt(r.limit)} потрачено</small></div><div class="ub-meter"><i style="width:${Math.max(pct, r.used ? 2 : 0)}%;background:${col}"></i></div>
    <div class="ub-sub">Осталось ${rmFmt(r.remaining)} · сброс через ${mins} мин, в ${hmClock(r.reset * 1000)}</div><div class="ub-sub">Сервер сделал за последний час: <b style="color:var(--c-text)">${rmFmt(r.own || 0)}</b></div><div class="ub-sub">${r.authenticated ? 'Запросы идут с токеном' : '<span style="color:var(--c-orange)">Токен не задан</span>: лимит всего 60 в час'}</div>`;
}
function spChanges() { const from = Date.now() / 1000 - 7 * 86400; return SP.audit.filter(a => /настрой|копи|обнов|перезапуск/i.test(a.action) && a.created_at >= from); }
function spOpen(k) { SP.q = ''; SP.open.add(k); spRender(); spScroll(k); }
function spTiles() {
  const k = spKindSizes(), total = Object.values(k).reduce((a, b) => a + b, 0), nf = SP.files.length, free = SP.disk ? SP.disk.free : null;
  const last = ST.backups.length ? ST.backups.reduce((a, b) => b.created_at > a.created_at ? b : a) : null, old = stBackupOld();
  const days = Array.from({ length: 14 }, (_, i) => 13 - i);
  const dots = days.map(i => { const d = new Date(); d.setDate(d.getDate() - i); return `<i class="${ST.backups.some(b => new Date(b.created_at * 1000).toDateString() === d.toDateString()) ? 'have' : ''}"></i>`; }).join('');
  const ch = spChanges(), now = Date.now() / 1000;
  const per = Array.from({ length: 7 }, (_, i) => ch.filter(a => Math.floor((now - a.created_at) / 86400) === 6 - i).length), mx = Math.max(1, ...per);
  const lc = ch[0];
  const small = 'font-size:18px;line-height:1.3;margin-top:8px;font-family:var(--f-ui)';
  return `<div class="ub-tiles sp-tiles">
    <button type="button" class="ub-tile" data-on-click="spOpen" data-a-click='["attachments"]'><div class="ub-lbl">Вложения</div><div class="ub-big">${hmBytes(total)}</div><span class="sp-ms big">${Object.keys(k).map(x => `<i style="flex:${Math.max(k[x], 1)};background:${SP_KC[x]}"></i>`).join('')}</span><div class="ub-sub">${rmFmt(nf)} ${uxPlural(nf, 'файл', 'файла', 'файлов')}${free != null ? ` · на диске свободно ${hmBytes(free)}` : ''}</div></button>
    <button type="button" class="ub-tile" data-on-click="spOpen" data-a-click='["backups"]'><div class="ub-lbl">Резервные копии</div><div class="ub-big" style="${small}${old ? ';color:var(--c-orange)' : ''}">${last ? esc(uaSeen(last.created_at)) : 'копий нет'}</div><span class="sp-md" style="margin-top:8px">${dots}</span><div class="ub-sub">Всего ${ST.backups.length} · следующая: ${esc(stNextBackupLabel() || 'только вручную')}</div></button>
    <button type="button" class="ub-tile" id="sp-t-gh" data-on-click="spGhTileClick">${spGhTile()}</button>
    <button type="button" class="ub-tile" data-on-click="spOpen" data-a-click='["history"]'><div class="ub-lbl">Изменения за 7 дней</div><div class="ub-big">${ch.length}</div><div class="sp-sk">${per.map(n => `<i style="height:${Math.max(2, Math.round(n / mx * 22))}px"></i>`).join('')}</div><div class="ub-sub">${lc ? `Последнее: ${esc(uaSeen(lc.created_at))}${lc.actor_name ? ', ' + esc(lc.actor_name) : ''}` : 'За неделю изменений не было'}</div></button>
  </div>`;
}

const SP_ORDER = ['messages', 'attachments', 'backups', 'database', 'github', 'history'];
const spAttn = k => k === 'github' ? !ST.gh.set : k === 'backups' ? stBackupOld() : k === 'database' ? SP.db.job?.state === 'failed' : false;
const spRow = (title, desc, ctl, extra = '', cls = '', kw = '') => spHit(title, desc, kw) ? `<div class="sp-r ${cls}"><div class="sp-l"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}${extra}</div><div class="sp-c">${ctl}</div></div>` : '';
const spStepH = k => `<div class="sp-step"><button type="button" aria-label="Меньше" data-on-click="spStep" data-a-click="${esc(JSON.stringify([`${k}`, -1]))}">−</button><input id="sp-n-${k}" type="number" min="1" max="500" value="${spSv(k)}" aria-label="Размер в мегабайтах" data-on-input="spNum" data-a-input="${esc(JSON.stringify([`${k}`, "__value"]))}"><button type="button" aria-label="Больше" data-on-click="spStep" data-a-click="${esc(JSON.stringify([`${k}`, 1]))}">+</button><span class="u">МБ</span></div>`;
const spTokH = (k, any) => `<div class="sp-tok">${spSv(k).map(x => `<span class="sp-tk">${esc(x)}<button type="button" aria-label="Убрать ${esc(x)}" data-on-click="spTokDel" data-a-click="${esc(JSON.stringify([`${k}`, `${esc(x)}`]))}">×</button></span>`).join('')}${!spSv(k).length && any ? `<span class="any">${any}</span>` : ''}<input id="sp-tok-${k}" placeholder="${spSv(k).length ? 'ещё…' : 'например, pdf'}" aria-label="Добавить формат" autocomplete="off" spellcheck="false" data-on-keydown="spTokKey" data-a-keydown="${esc(JSON.stringify(["__event", `${k}`]))}" data-on-input="__h82" data-a-input="${esc(JSON.stringify([k]))}"></div>`;
function spKindSizes() {
  const m = { image: 0, video: 0, doc: 0, other: 0 };
  SP.files.forEach(f => { const k = flKind(f); m[k === 'encrypted' ? 'other' : k] += f.size || 0; });
  return m;
}
const SP_KC = { image: 'var(--dv-c1)', video: 'var(--dv-c5)', doc: 'var(--dv-c2)', other: 'var(--dv-c3)' }, SP_KN = { image: 'картинки', video: 'видео', doc: 'документы', other: 'прочее' };

function spMessages() {
  const custom = SP.editCustom || !ST_EDIT.some(([v]) => v === spSv('edit')), n = spSv('edit') / SP.editUnit;
  return spRow('Время на правку сообщения', 'Когда срок выйдет, пункт «Изменить» пропадёт из меню сообщения',
    `<div class="sp-seg">${ST_EDIT.map(([v, l]) => `<button type="button" aria-pressed="${!custom && spSv('edit') === v}" data-on-click="spEditPreset" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}<button type="button" aria-pressed="${custom}" data-on-click="spEditPreset" data-a-click='["custom"]'>Своё</button></div>
    ${custom ? `<div class="sp-inp"><input id="sp-edit-n" type="number" min="1" value="${Number.isInteger(n) ? n : ''}" aria-label="Срок правки" data-on-input="spEditN" data-a-input='["__value"]'><select aria-label="Единицы" data-on-change="__h83">${[[1, 'секунд'], [60, 'минут'], [3600, 'часов']].map(([u, l]) => `<option value="${u}" ${SP.editUnit === u ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}`,
    '', 'wide', 'срок правка редактирование изменить')
    + spRow('Окно времени статуса', 'Сколько хранится точное время доставки и прочтения. Позже остаётся только факт «прочитано» без времени. Работает в чатах до 100 участников',
    `<div class="sp-seg">${ST_STATUS.map(([v, l]) => `<button type="button" aria-pressed="${spSv('statusDays') === v}" data-on-click="spSet" data-a-click="${esc(JSON.stringify([{ statusDays: v }]))}">${l}</button>`).join('')}</div>`,
    '', 'wide', 'статус доставка прочтение время окно хранить');
}
function spAttachments() {
  const life = SP.pend?.key === 'life' ? SP.pend.val : spSv('life'), lifeCustom = SP.lifeCustom || !ST_LIFE.some(([v]) => v === life);
  const old = life ? SP.files.filter(f => spFileAgeDays(f) > life) : [], oldSize = old.reduce((s, f) => s + (f.size || 0), 0);
  const big = (kind, lim) => SP.files.filter(f => flKind(f) === kind && (f.size || 0) > lim * 1048576).length;
  const conf = SP.pend?.key === 'life' ? `<div class="sp-conf">${ST_I.warn}<span>При сроке <b>${SP.pend.val} ${uxPlural(SP.pend.val, 'день', 'дня', 'дней')}</b> при ближайшей проверке удалится <b>${old.length} ${uxPlural(old.length, 'файл', 'файла', 'файлов')}, ${hmBytes(oldSize)}</b>. Отменить это нельзя.</span><button type="button" class="btn ux-solid btn-sm" data-on-click="spPendOk">Применить</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="spPendNo">Не менять</button></div>` : '';
  const warn = (n, w) => n ? `<em class="w">Уже загружено крупнее лимита: ${n}</em>` : '';
  const total = SP.files.reduce((s, f) => s + (f.size || 0), 0);
  return spRow('Картинки: наибольший размер', 'Картинку тяжелее загрузить не получится', spStepH('imgMax'), warn(big('image', spSv('imgMax'))), '', 'вложения размер')
    + spRow('Картинки: форматы', 'Только эти расширения отправляются как картинка с превью. Enter или запятая добавляют формат', spTokH('imgExt'), '', 'wide', 'расширения')
    + spRow('Видео: наибольший размер', 'Видео тяжелее загрузить не получится', spStepH('videoMax'), warn(big('video', spSv('videoMax'))), '', 'вложения размер')
    + spRow('Видео: форматы', 'Только эти расширения отправляются как видео с проигрыванием', spTokH('videoExt'), '', 'wide', 'расширения')
    + spRow('Файлы: наибольший размер', 'Документы, архивы и всё, что не картинка и не видео', spStepH('fileMax'), '', '', 'вложения размер')
    + spRow('Файлы: форматы', 'Разрешено только то, что в списке. Пустой список: файлы отправлять нельзя', `${spTokH('fileExt', 'Форматы не разрешены')}<div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">${Object.keys(ST_QUICK).map(n => `<button type="button" class="btn btn-ghost btn-sm" data-on-click="spQuick" data-a-click="${esc(JSON.stringify([`${n}`]))}">${ST_I.plus}${n}</button>`).join('')}${spSv('fileExt').length ? '<button type="button" class="btn btn-ghost btn-sm" data-on-click="spQ2">Очистить список</button>' : ''}</div>`, '', 'wide', 'расширения')
    + (spHit('Хранение файлов', 'срок хранить удаляются') ? `<div class="sp-r wide"><div class="sp-l"><b>Хранение файлов</b><span>Старые файлы удаляются сами, проверка раз в 6 часов. В переписке на их месте «Файл удалён»</span><em>Сейчас на сервере ${SP.files.length} ${uxPlural(SP.files.length, 'файл', 'файла', 'файлов')}, ${hmBytes(total)} · <button type="button" class="sp-link" data-on-click="nav" data-a-click='["files"]'>открыть «Файлы»</button></em></div>
      <div class="sp-c"><div class="sp-seg">${ST_LIFE.map(([v, l]) => `<button type="button" aria-pressed="${!lifeCustom && life === v}" data-on-click="spLife" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}<button type="button" aria-pressed="${lifeCustom}" data-on-click="spLife" data-a-click='["custom"]'>Своё</button></div>${lifeCustom ? `<div class="sp-inp" style="width:130px"><input id="sp-life-n" type="number" min="1" max="3650" value="${life || ''}" aria-label="Дней" data-on-input="spLifeN" data-a-input='["__value"]'><span class="u">дней</span></div>` : ''}</div>${conf}</div>` : '');
}
const spQ2 = () => spSet({ fileExt: [] });
function spBackups() {
  const last = ST.backups[0], pend = SP.pend?.key === 'backupRetention' ? SP.pend : null, ret = pend ? pend.val : spSv('backupRetention'), retVal = Number.isFinite(ret) && ret > 0 ? ret : '';
  const oldN = retVal ? ST.backups.filter(b => spBkAgeDays(b) > retVal).length : 0;
  return spRow('Создать копию сейчас', last ? `Последняя: ${esc(uaSeen(last.created_at))}, ${hmBytes(last.size)}. Следующая: ${esc(stNextBackupLabel() || 'только вручную')}` : 'Копий пока нет', `<button type="button" class="btn btn-ghost" data-on-click="rsPick">${rsIc('upload', 14)}Восстановить из файла…</button><button type="button" class="btn ux-solid" ${ST.bkBusy ? 'disabled' : ''} data-on-click="stBackup">${ST.bkBusy ? '<span class="st-spin light"></span>Создаю…' : ST_I.plus + 'Создать копию'}</button>`, '', '', 'резервные бэкап восстановить')
    + spRow('Дни автокопий', 'Пусто: копии только по кнопке', `<div class="sp-seg">${ST_DAYS.map(([v, l]) => `<button type="button" aria-pressed="${spSv('backupDays').includes(v)}" data-on-click="spDay" data-a-click="${esc(JSON.stringify([v]))}">${l}</button>`).join('')}</div>`, '', 'wide', 'расписание')
    + (spSv('backupDays').length ? spRow('Время копии', 'По времени сервера', `<div class="sp-inp"><input type="time" value="${esc(spSv('backupTime'))}" aria-label="Время автокопирования" style="width:96px" data-on-input="spTime" data-a-input='["__value"]'></div>`, '', '', 'расписание') : '')
    + (spHit('Срок хранения копий', 'удаляются') ? `<div class="sp-r"><div class="sp-l"><b>Срок хранения копий</b><span>Копии старше срока удаляются автоматически. Пусто: хранить всегда</span></div><div class="sp-c"><div class="sp-inp"><input type="number" min="1" max="3650" value="${retVal}" placeholder="всегда" aria-label="Дней" data-on-input="spRet" data-a-input='["__value"]'><span class="u">дней</span></div></div>${pend ? `<div class="sp-conf">${ST_I.warn}<span>При сроке <b>${pend.val} дн</b> удалится <b>${oldN} ${uxPlural(oldN, 'копия', 'копии', 'копий')}</b>. Отменить это нельзя.</span><button type="button" class="btn ux-solid btn-sm" data-on-click="spPendOk">Применить</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="spPendNo">Не менять</button></div>` : ''}</div>` : '')
    + (spHit('Копии', 'список скачать восстановить') ? `<div class="sp-r wide"><div class="sp-l"><b>Копии · ${ST.backups.length}</b><span><button type="button" class="sp-link" data-on-click="__h84">${SP.showBk ? 'Скрыть список' : 'Показать список'}</button></span></div>${SP.showBk ? `<div style="grid-column:1/-1">${ST.backups.map(b => `<div class="sp-bk"><span class="n">${esc(uaSeen(b.created_at))}${b.kind === 'pre' ? ' <span class="st-chip warn">До восстановления</span>' : b.kind === 'man' ? ' <span class="st-chip">Вручную</span>' : b.kind === 'auto' ? ' <span class="st-chip">Авто</span>' : ''}</span><span class="z">${hmBytes(b.size)}</span><button type="button" class="btn btn-primary btn-sm" data-on-click="rsFromBackup" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`]))}">${rsIc('restore', 13)}Восстановить</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="stDownload" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`, "__this"]))}">${ST_I.down}Скачать</button><button type="button" class="btn btn-ghost btn-sm" aria-label="Удалить копию" data-on-click="stDeleteBackup" data-a-click="${esc(JSON.stringify([`${jesc(b.name)}`]))}">${UX_I.trash}</button></div>`).join('')}</div>` : ''}</div>` : '');
}
// ── База данных ──
const spDbPct = j => (j && j.total ? Math.min(99, Math.round(j.done / j.total * 100)) : null);
function spDbF(k, v) { SP.db.form[k] = v; if (SP.db.test || SP.db.confirm) { SP.db.test = null; SP.db.confirm = false; spRender('sp-db-' + k); } }
async function spDbTest() {
  SP.db.testing = true; SP.db.test = null; SP.db.confirm = false; spRender();
  const r = await api('POST', '/api/admin/database/test', SP.db.form);
  SP.db.testing = false; SP.db.test = r || { ok: false, error: 'Нет ответа от сервера' }; spRender();
}
function spDbAsk() { SP.db.confirm = true; spRender(); }
function spDbNo() { SP.db.confirm = false; spRender(); }
async function spDbGo() {
  SP.db.confirm = false;
  const r = await api('POST', '/api/admin/database/migrate', { ...SP.db.form, confirm: true });
  if (r?.ok) { SP.db.job = r.job; spDbPoll(); } else toast(esc(r?.error || 'Не удалось начать перенос'), 'error');
  spRender();
}
function spDbDelLegacy() {
  const lg = SP.db.info?.legacy; if (!lg) return;
  confirm('Удалить старый файл SQLite?', `Будет удалён файл ${lg.path} (${hmBytes(lg.size)}). Сервер им не пользуется. Копия «до переноса» в резервных копиях останется.`, async () => {
    const r = await api('POST', '/api/admin/database/delete-legacy', { confirm: true });
    if (!r?.ok) { toast(esc(r?.error || 'Не удалось удалить файл'), 'error'); return; }
    toast(`Файл удалён, освобождено ${hmBytes(r.freed)}`, 'success');
    const info = await api('GET', '/api/admin/database'); if (info && !info.error) SP.db.info = info;
    spRender();
  });
}
function spDbClose() { SP.db.job = null; spRender(); }
function spDbPoll() {
  clearInterval(SP.db.t);
  SP.db.t = setInterval(async () => {
    try {
      const res = await fetch('/api/admin/database?_t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error('down');
      const j = await res.json();
      SP.db.info = j; SP.db.job = j.job; SP.db.down = false;
      if (j.engine === 'postgresql') { clearInterval(SP.db.t); toast('Сервер работает на PostgreSQL'); if (currentPage === 'settings') renderSettings(); return; }
      if (!j.job || (j.job.state !== 'running' && j.job.state !== 'restarting')) clearInterval(SP.db.t);
    } catch { SP.db.down = SP.db.job?.state === 'restarting'; }
    if (currentPage === 'settings') spRender();
  }, 1200);
}
// ── Установка PostgreSQL на этом сервере (модалка) ──
const PGI = { step: 'confirm', pw: '', err: '', busy: false, job: null, t: null };
const PGI_STAGES = ['Проверка системы', 'Подготовка репозитория', 'Установка пакетов', 'Запуск службы', 'Настройка доступа', 'Создание роли и базы', 'Проверка подключения'];
function pgiOpen() { Object.assign(PGI, { step: 'confirm', pw: '', err: '', busy: false, job: null }); pgiRender(); openModal('modal-pginst'); setTimeout(() => document.getElementById('pgi-pw')?.focus(), 200); }
function pgiClose() {
  clearInterval(PGI.t);
  const j = PGI.job;
  closeModal('modal-pginst');
  if (PGI.step === 'done' && j?.result) {
    // Данные подключения подставляются в форму переноса, остаётся проверить и перенести
    Object.assign(SP.db.form, { host: j.result.host, port: j.result.port, database: j.result.database, user: j.result.user, password: j.result.password, ssl: '' });
    SP.db.test = null; SP.db.confirm = false; SP.open.add('database');
    if (SP.db.info) SP.db.info.install = null;
    if (currentPage === 'settings') { spRender(); spScroll('database'); }
    toast('Данные подключения подставлены в форму. Проверьте соединение', 'success');
  }
}
function pgiRender() {
  const box = document.getElementById('pginst-box'); if (!box) return;
  const j = PGI.job;
  if (PGI.step === 'confirm') {
    box.innerHTML = `<div class="modal-head"><h3>Установить PostgreSQL</h3><button class="modal-close" aria-label="Закрыть" data-on-click="pgiClose">✕</button></div>
      <div class="modal-body">
        <p style="font-size:12.5px;color:var(--c-text2);line-height:1.7;margin:0 0 12px">На этом сервере будет установлен и настроен PostgreSQL: из репозиториев системы поставится пакет, создадутся пользователь и пустая база, доступ откроется только с этого сервера. Данные подключения подставятся в форму переноса. Сам сервер продолжит работать на SQLite.</p>
        <p style="font-size:12.5px;color:var(--c-text2);line-height:1.7;margin:0 0 14px">Установка занимает несколько минут и требует доступа сервера в интернет. Действие необратимо, поэтому подтвердите его своим паролем.</p>
        <div class="fg"><label>Ваш пароль</label><input id="pgi-pw" type="password" autocomplete="current-password" placeholder="••••••••" value="${esc(PGI.pw)}" data-on-input="__h85" data-on-keydown="__h86"></div>
        <div class="err" id="pgi-err">${esc(PGI.err)}</div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-on-click="pgiClose">Отмена</button><button class="btn btn-primary" id="pgi-go" ${PGI.busy ? 'disabled' : ''} data-on-click="pgiStart">${PGI.busy ? 'Проверка…' : 'Установить'}</button></div>`;
    return;
  }
  const st = j?.stage || 1, pct = Math.round(j?.pct || 0);
  if (PGI.step === 'run') {
    box.innerHTML = `<div class="modal-head"><h3>Установка PostgreSQL</h3></div>
      <div class="modal-body">
        <div class="pgi-pc"><b>${pct}%</b><span>${esc(j?.text || '')}</span></div>
        <div class="sp-pg"><i style="width:${pct}%"></i></div>
        <div class="pgi-st">${PGI_STAGES.map((n, i) => `<div class="${i + 1 < st ? 'dn' : i + 1 === st ? 'cur' : ''}"><i>${i + 1 < st ? '✓' : i + 1 === st ? '…' : ''}</i>${n}</div>`).join('')}</div>
        <p class="rb-meta" style="margin:12px 0 0;white-space:normal">Не закрывайте страницу и не выключайте сервер до конца установки.</p>
      </div>`;
    return;
  }
  if (PGI.step === 'done') {
    box.innerHTML = `<div class="modal-head"><h3>PostgreSQL установлен</h3></div>
      <div class="modal-body">
        <div class="pgi-pc"><b>100%</b><span>Готово</span></div><div class="sp-pg"><i style="width:100%"></i></div>
        <div class="pgi-st">${PGI_STAGES.map(n => `<div class="dn"><i>✓</i>${n}</div>`).join('')}</div>
        <p style="font-size:12.5px;color:var(--c-text2);line-height:1.7;margin:14px 0 0">Данные подключения подставятся в форму: останется проверить соединение и перенести данные. Копия данных подключения сохранена на сервере в <code class="st-code">/etc/electron/postgres.txt</code> (доступ только у администратора сервера).</p>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-on-click="pgiClose">Закрыть</button></div>`;
    return;
  }
  box.innerHTML = `<div class="modal-head"><h3>Установка не удалась</h3></div>
    <div class="modal-body">
      <p style="font-size:12.5px;color:var(--c-red-text);line-height:1.7;margin:0">${esc(j?.error || 'Неизвестная ошибка')}</p>
      <p style="font-size:12.5px;color:var(--c-text2);line-height:1.7;margin:10px 0 0">Сервер продолжает работать на SQLite, данные не затронуты. Установку можно повторить: уже сделанные шаги пропустятся.</p>
      ${(j?.log || []).length ? `<div class="pgi-log">${esc(j.log.slice(-12).join('\n'))}</div>` : ''}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" data-on-click="pgiClose">Закрыть</button></div>`;
}
async function pgiStart() {
  if (PGI.busy) return;
  if (!PGI.pw) { PGI.err = 'Введите пароль'; return pgiRender(); }
  PGI.busy = true; PGI.err = ''; pgiRender();
  const r = await api('POST', '/api/admin/database/install-pg', { password: PGI.pw });
  PGI.busy = false; PGI.pw = '';
  if (!r?.ok) { PGI.err = r?.error || 'Не удалось начать установку'; return pgiRender(); }
  PGI.job = r.job; PGI.step = 'run'; pgiRender(); pgiPoll();
}
function pgiPoll() {
  clearInterval(PGI.t);
  PGI.t = setInterval(async () => {
    try {
      const res = await fetch('/api/admin/database/install-pg?_t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const { job } = await res.json();
      if (!job) return;
      PGI.job = job;
      if (job.state === 'done') { PGI.step = 'done'; clearInterval(PGI.t); }
      else if (job.state === 'failed') { PGI.step = 'fail'; clearInterval(PGI.t); }
      pgiRender();
    } catch {}
  }, 1000);
}
// Страницу обновили во время установки: возвращаемся в окно
function pgiResume(job) { PGI.job = job; PGI.step = job.state === 'running' ? 'run' : job.state === 'done' ? 'done' : 'fail'; pgiRender(); openModal('modal-pginst'); if (job.state === 'running') pgiPoll(); }
function spDatabase() {
  const d = SP.db, i = d.info, job = d.job;
  if (!i) return '<div class="rb-meta" style="padding:14px 4px">Не удалось получить сведения о базе</div>';
  const pg = i.engine === 'postgresql';
  let out = spRow('Сейчас используется', pg ? `Подключено к ${esc(i.target || 'PostgreSQL')}` : 'Файл рядом с данными сервера: ничего настраивать не нужно',
    `<span class="sp-stat ok">${pg ? 'PostgreSQL' : 'SQLite'} ${esc(i.version || '')}</span>`, i.size ? `<span style="margin-top:1px">Размер ${hmBytes(i.size)}${i.messages != null ? ` · сообщений ${rmFmt(i.messages)}` : ''}</span>` : '', '', 'база данных sqlite postgres');
  if (job && (job.state === 'running' || job.state === 'restarting' || job.state === 'done')) {
    const pct = spDbPct(job), busy = job.state !== 'done';
    out += `<div class="sp-r wide"><div class="sp-l"><b>${busy ? 'Идёт перенос на PostgreSQL' : 'Перенос завершён'}</b><span>${esc(job.text || '')}${pct != null && job.state === 'running' && job.phase === 'copy' ? ` · ${pct}%` : ''}${d.down ? ' · сервер перезапускается, подождите' : ''}</span></div>
      <div class="sp-c" style="width:100%"><div class="sp-pg ${pct == null || job.state === 'restarting' ? 'ind' : ''}"><i style="${pct != null && job.state === 'running' ? `width:${pct}%` : ''}"></i></div></div>
      ${busy ? '<em class="w" style="grid-column:1/-1">Пока идёт перенос, сообщения и другие изменения не сохраняются. Не закрывайте страницу и не выключайте сервер.</em>' : ''}</div>`;
    return out;
  }
  if (job && job.state === 'failed') {
    out += `<div class="sp-r wide"><div class="sp-l"><b>Перенос не удался</b><span>${esc(job.error || '')}</span><em class="w">Сервер продолжает работать на SQLite, данные не затронуты. PostgreSQL очищен.</em></div>
      <div class="sp-c"><button type="button" class="btn btn-ghost btn-sm" data-on-click="spDbClose">Понятно</button></div></div>`;
    return out;
  }
  if (pg) return out + (i.legacy ? spRow('Старый файл SQLite', `${esc(i.legacy.path)}: сервер им больше не пользуется. Копия «до переноса» лежит в резервных копиях и остаётся`, `<span class="mono" style="font-size:12.5px;color:var(--c-muted)">${hmBytes(i.legacy.size)}</span><button type="button" class="btn btn-ghost btn-sm" style="color:var(--c-red-text)" data-on-click="spDbDelLegacy">Удалить</button>`, '', '', 'старый файл sqlite удалить') : '') + spRow('Резервные копии', 'Создаются и восстанавливаются в разделе «Резервные копии» так же, как раньше. Копия — файл формата SQLite: её можно восстановить на любом движке, в том числе копию, сделанную до переноса', '<button type="button" class="btn btn-ghost btn-sm" data-on-click="__h87">Открыть</button>', '', '', 'копия');
  if (!i.canMigrate) return out;
  const f = d.form, t = d.test, ok = !!(t && t.ok);
  const inp = (k, label, type = 'text', w = '') => `<label>${label}<span class="sp-inp"><input id="sp-db-${k}" type="${type}" value="${esc(String(f[k]))}" autocomplete="off" spellcheck="false" data-on-input="spDbF" data-a-input="${esc(JSON.stringify([`${k}`, "__value"]))}" ${w}></span></label>`;
  out += spRow('PostgreSQL на этом сервере', 'Нет своего PostgreSQL? Сервер установит его и подставит данные подключения в форму ниже', '<button type="button" class="btn btn-ghost btn-sm" data-on-click="pgiOpen">Установить PostgreSQL</button>', '', '', 'установить postgres');
  out += !spHit('перенос на postgresql миграция sqlite проверить соединение адрес порт имя базы пользователь пароль шифрование') ? '' : `<div class="sp-r wide"><div class="sp-l"><b>Перенос на PostgreSQL</b><span>PostgreSQL 14 или новее на этом же сервере. База должна быть пустой и создана в UTF-8 (скрипт установки создаёт её сам). Текущая база останется как резервная копия</span></div>
    <div class="sp-dbf">${inp('host', 'Адрес сервера')}${inp('port', 'Порт', 'number')}${inp('database', 'Имя базы')}${inp('user', 'Пользователь')}${inp('password', 'Пароль', 'password')}
      <label>Шифрование<span class="sp-inp"><select id="sp-db-ssl" data-on-change="spDbF" data-a-change='["ssl", "__value"]'><option value="" ${f.ssl === '' ? 'selected' : ''}>Без шифрования (тот же сервер)</option><option value="require" ${f.ssl === 'require' ? 'selected' : ''}>Шифровать</option><option value="verify-full" ${f.ssl === 'verify-full' ? 'selected' : ''}>Шифровать и проверять сертификат</option></select></span></label></div>
    ${t ? `<div style="width:100%">${t.error ? `<div class="sp-ck bad"><i>!</i><span>${esc(t.error)}</span></div>` : ''}${(t.checks || []).map(c => `<div class="sp-ck ${!c.ok ? 'bad' : c.warn ? 'warn' : 'ok'}"><i>${c.ok && !c.warn ? '✓' : '!'}</i><span>${esc(c.text)}</span></div>`).join('')}</div>` : ''}
    ${d.confirm ? `<div class="sp-conf" style="width:100%">${ST_I.warn}<span>Запись остановится на время переноса${i.messages > 200000 ? ' (при таком объёме это может занять несколько минут)' : ' (обычно это секунды или минуты)'}: сообщения не отправятся. Копия текущей базы сохранится в «Резервных копиях». После переноса сервер перезапустится сам.</span>
        <button type="button" class="btn btn-primary btn-sm" data-on-click="spDbGo">Начать перенос</button><button type="button" class="btn btn-ghost btn-sm" data-on-click="spDbNo">Отмена</button></div>` : `
      <div class="sp-c" style="width:100%;justify-content:flex-start"><button type="button" class="btn btn-ghost btn-sm" ${d.testing ? 'disabled' : ''} data-on-click="spDbTest">${d.testing ? '<span class="st-spin"></span>' : ''}Проверить соединение</button>
        <button type="button" class="btn btn-primary btn-sm" ${ok ? '' : 'disabled'} data-on-click="spDbAsk">Перенести</button></div>`}</div>`;
  return out;
}
function spDbSide() {
  const i = SP.db.info; if (!i) return '';
  if (i.engine === 'postgresql') return `<h5>PostgreSQL</h5><p class="sp-sd">Поиск по сообщениям понимает русские окончания: «отчёты» находятся по запросу «отчет». Размер базы и число соединений видны на главной.</p>`;
  return `<h5>Как проходит перенос</h5><p class="sp-sd"><b>1.</b> Проверка PostgreSQL.<br><b>2.</b> Запись останавливается, снимается копия.<br><b>3.</b> Таблицы переносятся в одной транзакции, затем сверяется число строк.<br><b>4.</b> Сервер перезапускается на PostgreSQL.</p>
    <p class="sp-sd">Любая ошибка отменяет перенос: сервер продолжает работать на SQLite, как раньше. Обратно на SQLite данные не переносятся.</p>`;
}
function spGithub() {
  const g = ST.gh;
  return spRow('Токен доступа', g.set ? 'Токен задан: запросы к GitHub идут с токеном, до 5000 в час' : 'Без токена до 60 запросов в час: при частых проверках обновлений лимит кончится',
    `<span class="sp-stat ${g.set ? 'ok' : 'warn'}">${g.set ? 'задан' : 'не задан'}</span><div class="sp-inp ${g.err ? 'bad' : ''}" style="${g.err ? 'border-color:var(--c-red)' : ''}"><input id="st-gh" type="${g.show ? 'text' : 'password'}" placeholder="${g.set ? '•••••••• (задан)' : 'ghp_…'}" style="width:170px;font-weight:500" autocomplete="off" data-on-keydown="__h79"><button type="button" class="btn btn-ghost btn-sm" style="border:0;background:none;padding:4px 6px" aria-label="${g.show ? 'Скрыть токен' : 'Показать токен'}" data-on-click="stGhShow">${g.show ? ST_I.eyeOff : ST_I.eye}</button></div><button type="button" class="btn ux-solid" ${g.busy ? 'disabled' : ''} data-on-click="stGhSave">Сохранить</button>${g.set ? `<button type="button" class="btn btn-danger" ${g.busy ? 'disabled' : ''} data-on-click="stGhDel">Удалить</button>` : ''}`,
    g.err ? `<em class="w">${esc(g.err)}</em>` : '<span style="margin-top:1px">Достаточно прав public_repo. Токен хранится только на сервере и в браузер не возвращается</span>', 'wide', 'github токен лимит');
}
function spHistory() {
  const rows = SP.audit.filter(a => /настрой|копи|обнов|перезапуск/i.test(a.action)), list = SP.showLog ? rows : rows.slice(0, 5);
  if (!rows.length) return spHit('история изменений журнал') ? '<div class="rb-meta" style="padding:14px 4px">Изменений пока не было</div>' : '';
  return `${list.map(a => `<div class="sp-log"><span class="tm">${esc(uaSeen(a.created_at))}</span><span>${esc(a.action)}${a.target ? `: <span class="rb-meta">${esc(a.target)}</span>` : ''}</span><span class="rb-meta">${esc(a.actor_name || '')}</span></div>`).join('')}${rows.length > 5 ? `<div style="padding:10px 4px"><button type="button" class="sp-link" data-on-click="__h88">${SP.showLog ? 'Свернуть' : 'Показать всё · ' + rows.length}</button></div>` : ''}`;
}
const SP_BODY = { messages: spMessages, attachments: spAttachments, backups: spBackups, database: spDatabase, github: spGithub, history: spHistory };
function spSug2(text, btn, fn, arg) { return `<div class="sp-sg"><span>${text}</span><button type="button" class="btn btn-ghost btn-sm" data-on-click="${fn}" data-a-click="${esc(JSON.stringify([arg]))}" style="color:var(--c-primary)">${btn}</button></div>`; }
const SP_SIDE = {
  messages: () => `<h5>Как это работает</h5><div class="st-ex" style="margin:0">${stEditExample()}</div><div class="st-cmp" style="margin-top:12px"><span>Для сравнения:</span><span>WhatsApp: <b>15 минут</b></span><span>Telegram: <b>48 часов</b></span></div>`,
  attachments: () => {
    const k = spKindSizes(), total = Object.values(k).reduce((a, b) => a + b, 0), top = [...SP.files].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 3);
    const r90 = spSv('life') ? [] : SP.files.filter(f => spFileAgeDays(f) > 90), r90size = r90.reduce((s, f) => s + (f.size || 0), 0);
    return `<h5>Что занимает место · ${hmBytes(total)}</h5><div class="sp-ms big">${Object.keys(k).map(x => `<i style="flex:${Math.max(k[x], 1)};background:${SP_KC[x]}"></i>`).join('')}</div><div class="sp-lg">${Object.keys(k).map(x => `<span><i style="background:${SP_KC[x]}"></i>${SP_KN[x]} <b>${hmBytes(k[x])}</b></span>`).join('')}</div>
      ${top.length ? `<h5 style="margin-top:14px">Самые большие</h5>${top.map(f => `<div class="sp-tf"><span>${esc(flShort(flName(f)))}</span><b>${hmBytes(f.size || 0)}</b></div>`).join('')}` : ''}
      ${r90.length ? spSug2(`Хранение 90 дней освободит ${hmBytes(r90size)} (${r90.length} ${uxPlural(r90.length, 'файл', 'файла', 'файлов')})`, 'Выбрать 90 дней', 'spSug', 'life') : ''}`;
  },
  backups: () => {
    const days = Array.from({ length: 14 }, (_, i) => 13 - i), now = new Date();
    return `<h5>Последние 14 дней</h5><div class="sp-cal">${days.map(i => { const d = new Date(now); d.setDate(now.getDate() - i); const have = ST.backups.some(b => new Date(b.created_at * 1000).toDateString() === d.toDateString()), pl = spSv('backupDays').includes(d.getDay()); return `<div title="${d.toLocaleDateString('ru-RU')}"><i class="${have ? 'have' : pl ? (i === 0 ? 'plan' : 'miss') : ''}">${have ? '✓' : pl ? (i === 0 ? '•' : '!') : ''}</i><span>${i === 0 ? 'сег' : d.getDate()}</span></div>`; }).join('')}</div>
      <p class="sp-sd">✓ копия есть, ! по расписанию нужна, но её нет. Ближайшая: <b>${esc(stNextBackupLabel() || 'только вручную')}</b>.</p>
      ${!spSv('backupDays').length ? spSug2('Автокопий нет: при сбое можно потерять день работы', 'Включить по будням в 03:00', 'spSug', 'days') : ''}`;
  },
  github: () => `<h5>Лимит запросов в час</h5><div class="sp-lim"><div><span>без токена</span><i style="width:${ST.gh.set ? 2 : 100}%;background:${ST.gh.set ? 'var(--c-muted)' : 'var(--c-orange)'}"></i><b>60</b></div><div><span>с токеном</span><i style="width:100%;background:${ST.gh.set ? 'var(--c-green)' : 'var(--c-muted)'}"></i><b>5000</b></div></div><p class="sp-sd">Сейчас: <b>${ST.gh.set ? 'с токеном' : 'без токена'}</b>.${SP.rate && !SP.rate.error ? ` Потрачено <b>${SP.rate.used} из ${SP.rate.limit}</b>, остаток обнулится в ${hmClock(SP.rate.reset * 1000)}.` : ''} Проверка обновлений делает несколько запросов.</p>${ST.gh.set ? '' : spSug2('Задайте токен: лимит вырастет в 80 раз', 'К полю токена', 'spSug', 'gh')}`,
  database: () => spDbSide(),
  history: () => '',
};
function spQuickBtn(k) {
  if (k === 'backups') return `<button type="button" class="btn btn-ghost btn-sm" ${ST.bkBusy ? 'disabled' : ''} data-on-click="stBackup">${ST.bkBusy ? '<span class="st-spin"></span>' : ST_I.plus}Создать копию</button>`;
  if (k === 'github') return ST.gh.set ? '' : `<button type="button" class="btn btn-ghost btn-sm" style="color:var(--c-primary)" data-on-click="spSug" data-a-click='["gh"]'>Задать токен</button>`;
  return '';
}
function spSummary(k) {
  const last = ST.backups[0];
  if (k === 'messages') return `${stDur(spSv('edit'))} на правку`;
  if (k === 'attachments') return `картинки до ${spSv('imgMax')} МБ · видео до ${spSv('videoMax')} МБ · файлы до ${spSv('fileMax')} МБ · хранение ${spSv('life') ? spSv('life') + ' дн' : 'всегда'}`;
  if (k === 'backups') return `${spSv('backupDays').length ? ST_DAYS.filter(d => spSv('backupDays').includes(d[0])).map(d => d[1]).join(', ') + ' в ' + spSv('backupTime') : 'только вручную'} · последняя ${last ? uaSeen(last.created_at) : 'нет'}`;
  if (k === 'github') return ST.gh.set ? 'токен задан · 5000 запросов в час' : 'токен не задан · 60 запросов в час';
  if (k === 'database') { const i = SP.db.info; return i ? `${i.engine === 'postgresql' ? 'PostgreSQL' : 'SQLite'} ${i.version || ''}${i.size ? ' · ' + hmBytes(i.size) : ''}` : '…'; }
  return `${SP.audit.filter(a => /настрой|копи|обнов|перезапуск/i.test(a.action)).length} записей`;
}
function spMini(k) {
  if (k === 'attachments') { const m = spKindSizes(); return `<span class="sp-ms" title="Что занимает место">${Object.keys(m).map(x => `<i style="flex:${Math.max(m[x], 1)};background:${SP_KC[x]}"></i>`).join('')}</span>`; }
  if (k === 'backups') return `<span class="sp-md" title="Копии за 14 дней">${Array.from({ length: 14 }, (_, i) => 13 - i).map(i => { const d = new Date(); d.setDate(d.getDate() - i); return `<i class="${ST.backups.some(b => new Date(b.created_at * 1000).toDateString() === d.toDateString()) ? 'have' : ''}"></i>`; }).join('')}</span>`;
  return '';
}
const SP_META = { messages: ['Сообщения', ST_I.msg], attachments: ['Вложения', ST_I.clip], backups: ['Резервные копии', ST_I.db], database: ['База данных', ST_I.db], github: ['GitHub', ST_I.gh], history: ['История', ST_I.clock] };
function spLastChange(k) {
  const key = SP_AUDIT_KEY[k]; if (!key) return null;
  return SP.audit.find(a => a.action === 'Изменение настроек' && String(a.target || '').includes(key));
}

function spRender(focusId) {
  if (currentPage !== 'settings' || !SP.loaded) return;
  const page = document.getElementById('page-body'), a = document.activeElement, keep = focusId || (a?.id && page.contains(a) ? a.id : null);
  let caret = null; try { caret = a?.selectionStart; } catch {}
  const scroll = page.querySelector('.sp-scroll')?.scrollTop || 0, q = spQ();
  const bodies = Object.fromEntries(SP_ORDER.map(k => [k, SP_BODY[k]()]));
  const list = SP_ORDER.filter(k => bodies[k]).sort((x, y) => (spAttn(y) ? 1 : 0) - (spAttn(x) ? 1 : 0));
  const need = list.filter(spAttn), rest = list.filter(k => !spAttn(k));
  const one = k => {
    const open = q ? true : SP.open.has(k), w = spAttn(k), lc = spLastChange(k), keys = SP_KEYS[k], quick = spQuickBtn(k), side = SP_SIDE[k]();
    const changed = keys && keys.some(x => JSON.stringify(spSv(x)) !== JSON.stringify(SP_DEF[x]));
    return `<section class="sp-acc ${open ? 'open' : ''}" id="sp-acc-${k}"><div class="sp-ah"><button type="button" class="sp-ahm" data-on-click="spTog" data-a-click="${esc(JSON.stringify([`${k}`]))}" aria-expanded="${open}"><span class="sp-ai">${SP_META[k][1]}</span><b>${SP_META[k][0]}</b><span class="sp-as ${w ? 'w' : ''}">${esc(spSummary(k))}</span>${spMini(k)}${w ? '<i class="sp-wd"></i>' : ''}</button>${quick ? `<div class="sp-aq">${quick}</div>` : ''}<button type="button" class="sp-ahc" data-on-click="spTog" data-a-click="${esc(JSON.stringify([`${k}`]))}" aria-expanded="${open}" aria-label="${open ? 'Свернуть' : 'Развернуть'}: ${SP_META[k][0]}"><span class="sp-chv">›</span></button></div>
      ${open ? `<div class="sp-ab"><div class="sp-abg"><div class="sp-rows">${bodies[k]}</div>${side ? `<aside class="sp-side">${side}</aside>` : ''}</div>${k !== 'history' ? `<div class="sp-af"><span>${lc ? `Последнее изменение: ${esc(uaSeen(lc.created_at))}, ${esc(lc.actor_name || '')}` : 'Не менялось'}</span>${changed ? `<button type="button" class="sp-link" data-on-click="spResetSec" data-a-click="${esc(JSON.stringify([`${k}`]))}">Сбросить раздел к умолчаниям</button>` : ''}</div>` : ''}</div>` : ''}</section>`;
  };
  const allOpen = list.length && list.every(k => SP.open.has(k));
  uxKeepFocus(() => {
    page.innerHTML = `<div class="sp"><div class="sp-tb">${uxSearch('sp-q', SP.q, 'Найти настройку: копия, размер, токен…', 'spSearch')}<button type="button" class="btn btn-ghost btn-sm" data-on-click="spExpand" data-a-click="${esc(JSON.stringify([allOpen ? 'false' : 'true']))}">${allOpen ? 'Свернуть всё' : 'Развернуть всё'}</button></div>
      <div class="sp-scroll">${q ? '' : spTiles()}${need.length ? `<div class="sp-gl"><i class="sp-wd"></i>Требует внимания · ${need.length}</div>${need.map(one).join('')}${rest.length ? '<div class="sp-gl">Остальное</div>' : ''}` : ''}${rest.map(one).join('')}${!list.length ? '<div class="ub-empty">Ничего не нашли. Попробуйте «копия», «токен» или «размер».</div>' : ''}</div></div>`;
  });
  const sc = page.querySelector('.sp-scroll'); if (sc) sc.scrollTop = scroll;
  const f = keep && document.getElementById(keep);
  if (f && f !== document.activeElement) { f.focus(); try { if (caret != null) f.setSelectionRange(caret, caret); } catch {} }
  SB.attn = SP_ORDER.filter(spAttn).length;
  sbBadges();
}

/* ── TOPBAR HELPER ── */
function setTopbarActions(html) {
  const extra = document.getElementById('topbar-extra');
  if (extra) { extra.innerHTML = html || ''; extra.style.display = html ? 'flex' : 'none'; }
}

/* ── ПРОСТРАНСТВА ── */
// Пространство только объединяет людей: люди с общим пространством друг друга видят (человек может состоять в нескольких),
// без общего не видят (связать их можно контактами, группами и комнатами). Комнаты к пространству не привязаны.
const WS = { list: [], editId: null, offers: [], filter: 'all', sel: null };
async function wsLoad() {
  const [r, o] = await Promise.all([api('GET', '/api/admin/workspaces'), api('GET', '/api/admin/workspaces/fed/offers')]);
  if (Array.isArray(r)) WS.list = r;
  WS.offers = Array.isArray(o) ? o : [];
  const nb = document.getElementById('nb-workspaces');
  if (nb && Array.isArray(r)) nb.textContent = r.length;
  return WS.list;
}
async function renderWorkspaces() {
  setTopbarActions('');
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>`;
  await wsLoad();
  if (currentPage !== 'workspaces') return;
  wsRender();
  clearInterval(WS.timer);
  WS.timer = setInterval(async () => {
    if (currentPage !== 'workspaces') { clearInterval(WS.timer); return; }
    if (document.querySelector('#modal-fed.open, #modal-ws.open, .ux-selp') || document.activeElement?.closest?.('#page-body input, #page-body select')) return;
    await wsLoad(); if (currentPage === 'workspaces') wsRender();
  }, 10000);
}
function wsFedBadge(w) {
  if (!w.fed?.shared) return '';
  const act = w.fed.servers.filter(s => s.state === 'active').length;
  return `<span class="badge badge-blue" title="${w.fed.is_host ? 'Вы хозяин пространства' : 'Хозяин: ' + esc(w.fed.servers.find(s => s.host)?.name || w.fed.host)}">Общее · ${act} ${uxPlural(act, 'сервер', 'сервера', 'серверов')}</span>`;
}
// Свой выпадающий список вместо системного: значение хранится в WS_SEL по id, переживает перерисовку страницы
const WS_SEL = {};
function uxSelHtml(id, opts, def, ph) {
  const cur = WS_SEL[id];
  if (!cur || !opts.some(o => o.v === cur.v && !o.dis)) WS_SEL[id] = { opts, v: def !== undefined ? def : (opts.find(o => !o.dis)?.v ?? '') };
  else cur.opts = opts;
  return `<div class="ux-sel" id="${id}"><button type="button" class="ux-sel-b" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(ph || '')}" data-on-click="uxSelOpen" data-a-click="${esc(JSON.stringify([`${id}`]))}"></button></div>`.replace('</button>', uxSelLabel(id) + '</button>');
}
function uxSelLabel(id) {
  const st = WS_SEL[id], o = st?.opts.find(x => x.v === st.v);
  return `<span class="t${o ? '' : ' ph'}">${o ? esc(o.t) : 'Выберите'}</span><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
}
const uxSelVal = id => WS_SEL[id]?.v ?? '';
function uxSelClose() { document.querySelectorAll('.ux-selp').forEach(e => e.remove()); document.querySelectorAll('.ux-sel-b[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function uxSelOpen(id) {
  const host = document.getElementById(id), st = WS_SEL[id]; if (!host || !st) return;
  const btn = host.querySelector('.ux-sel-b'), was = btn.getAttribute('aria-expanded') === 'true';
  uxSelClose(); if (was) return;
  const pop = document.createElement('div'); pop.className = 'ux-selp'; pop.setAttribute('role', 'listbox'); pop.tabIndex = -1;
  pop.innerHTML = st.opts.map((o, i) => `<div role="option" data-i="${i}" aria-selected="${o.v === st.v}" ${o.dis ? 'aria-disabled="true"' : ''}><span class="o-t"><b>${esc(o.t)}</b>${o.s ? `<small>${esc(o.s)}</small>` : ''}</span><svg class="ck" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`).join('');
  const pick = i => { const o = st.opts[i]; if (!o || o.dis) return; st.v = o.v; uxSelClose(); btn.innerHTML = uxSelLabel(id); btn.focus(); };
  pop.onclick = e => { const o = e.target.closest('[role=option]'); if (o) pick(+o.dataset.i); };
  pop.onkeydown = e => {
    const items = [...pop.querySelectorAll('[role=option]:not([aria-disabled])')], cur = items.indexOf(document.activeElement.closest?.('[role=option]') || pop.querySelector('.act'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pop.querySelectorAll('.act').forEach(x => x.classList.remove('act')); const n = items[(cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; n?.classList.add('act'); n?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); const n = pop.querySelector('.act'); if (n) pick(+n.dataset.i); }
    else if (e.key === 'Escape') { e.preventDefault(); uxSelClose(); btn.focus(); }
  };
  document.body.appendChild(pop);
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), h = pop.offsetHeight, up = innerHeight - r.bottom < h + 12 && r.top > h + 12;
  pop.style.left = r.left + 'px'; pop.style.minWidth = r.width + 'px'; pop.style.maxWidth = Math.min(420, innerWidth - r.left - 12) + 'px';
  pop.style.top = (up ? r.top - h - 4 : r.bottom + 4) + 'px';
  pop.querySelector('[aria-selected="true"]')?.classList.add('act');
  pop.focus();
}
document.addEventListener('mousedown', e => { if (!e.target.closest('.ux-selp, .ux-sel')) uxSelClose(); });
addEventListener('resize', uxSelClose);
addEventListener('scroll', e => { if (!e.target.closest?.('.ux-selp')) uxSelClose(); }, true);

const WSF = { filter: 'all', sel: null };
function wsPick(id) { WS.sel = id; uxSelClose(); wsRender(); }
function wsFilter(f) { WS.filter = f; wsRender(); }
function wsAvatar(w, small) {
  const col = FM_COL[Math.max(0, WS.list.indexOf(w)) % FM_COL.length];
  return `<span class="ws-av${small ? ' sm' : ''}" style="--col:${col}">${esc(initials(w.name))}</span>`;
}
// Дерево серверов пространства: хозяин сверху, дальше подключённые через него
function wsTree(w) {
  const f = w.fed, mine = f.is_host, list = f.servers, byId = Object.fromEntries(list.map(x => [x.id, x]));
  const roots = list.filter(x => !x.parent || !byId[x.parent]).sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0));
  const kids = id => list.filter(x => x.parent === id);
  const word = x => x.state === 'offered' ? '<span class="badge badge-gray">приглашён</span>' : x.state === 'asked' ? '<span class="badge badge-gray">ждёт одобрения хозяина</span>' : '';
  const node = (x, d) => `<div class="ws-tn"><span class="ws-ind" style="padding-left:${d * 18}px">${d ? '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v9a3 3 0 0 0 3 3h10"/></svg>' : ''}</span><span class="fd-dot ${x.state !== 'active' ? 'off' : x.online ? '' : 'warn'}"></span>
    <span class="ws-tnm"><b>${esc(x.name)}</b>${x.host ? '<span class="badge badge-blue">хозяин</span>' : ''}${x.self ? '<span class="badge badge-green">вы</span>' : ''}${word(x)}<code>${esc(x.id)}</code>${x.ver ? `<span class="fd-ver">v${esc(x.ver)}</span>` : ''}</span>
    <span class="ws-tm">${x.state === 'active' ? `${x.people} ${fdPlural(x.people)}${x.online ? '' : ' · нет связи'}` : x.state === 'offered' ? 'ждём ответа' : ''}</span>
    ${mine && !x.self ? `<button class="btn btn-ghost btn-sm ws-dg" data-on-click="wsRemove" data-a-click="${esc(JSON.stringify([w.id, `${esc(x.id)}`]))}">Убрать</button>` : ''}</div>` + kids(x.id).map(k => node(k, d + 1)).join('');
  return `<div class="ws-tree">${roots.map(r => node(r, 0)).join('')}</div>`;
}
function wsRender() {
  if (currentPage !== 'workspaces') return;
  const L = WS.list, fedN = L.filter(w => w.fed?.shared).length, cnt = { all: L.length, shared: fedN, local: L.length - fedN };
  const vis = L.filter(w => WS.filter === 'all' || (WS.filter === 'shared') === !!w.fed?.shared);
  let w = L.find(x => x.id === WS.sel); if (!w || !vis.includes(w)) w = vis[0] || null;
  WS.sel = w ? w.id : null;
  const nm = (x, id) => x.fed.servers.find(s => s.id === id)?.name || id;
  const pend = x => (x.fed?.asks || []).filter(a => !a.approved).length;
  let det = '<div class="card"><div class="fd-empty"><div><b>Нет пространств</b><span>Измените фильтр или создайте пространство.</span></div></div></div>';
  if (w) {
    const mirror = w.fed?.shared && !w.fed.is_host, fedOn = !!w.fed?.shared, hostName = fedOn ? (w.fed.servers.find(s => s.host)?.name || w.fed.host) : '';
    const act = fedOn ? w.fed.servers.filter(s => s.state === 'active').length : 0;
    const cands = w.candidates || [];
    det = `<div class="card ws-det"><div class="ws-dh">${wsAvatar(w)}<div class="ws-dn"><h3>${esc(w.name)}</h3><div class="ws-bd">${w.is_default ? '<span class="badge badge-green">по умолчанию</span>' : w.users ? '' : '<span class="badge badge-gray">пустое</span>'}${wsFedBadge(w)}${fedOn && w.fed.is_host ? '<span class="badge badge-green">вы хозяин</span>' : ''}</div></div>
        <button class="btn btn-ghost btn-sm" ${mirror ? 'disabled title="Название общего пространства задаёт его хозяин"' : ''} data-on-click="wsOpen" data-a-click="${esc(JSON.stringify([w.id]))}">${WS_I.pen}Переименовать</button>
        ${mirror ? `<button class="btn btn-ghost btn-sm" title="Выйти из общего пространства: у вас оно останется обычным" data-on-click="wsLeave" data-a-click="${esc(JSON.stringify([w.id]))}">${WS_I.out}Выйти</button>` : ''}
        <button class="btn btn-ghost btn-sm ws-dg" ${w.is_default ? 'disabled' : ''} title="${w.is_default ? 'Основное пространство удалить нельзя' : fedOn ? (mirror ? 'Выйти из общего пространства и удалить его' : 'Выключить «Общее» и удалить пространство') : ''}" data-on-click="wsDelete" data-a-click="${esc(JSON.stringify([w.id]))}">${WS_I.trash}Удалить</button></div>
      <div class="ws-ds"><div><span>Людей у вас</span><b>${w.users}</b></div><div><span>Создано</span><b>${fmtDate(w.created_at)}</b></div><div><span>${fedOn ? 'Серверов' : 'Видят'}</span><b>${fedOn ? act : 'только вы'}</b></div></div>
      ${w.is_default && !fedOn ? `<div class="ws-sec"><h4>Пространство по умолчанию</h4><p>Сюда попадают новые люди и те, у кого не осталось других пространств. Общим его сделать нельзя.</p></div>`
        : `<div class="ws-sec"><div class="ws-shr"><div><h4>Общее пространство</h4><p>${mirror ? `Пространство ведёт «${esc(hostName)}»: название задаёт хозяин. Состав у каждого сервера свой, вы добавляете только своих людей в их профилях.` : 'Люди нескольких серверов федерации видят друг друга. Состав у каждого сервера свой: вы добавляете только своих людей в их профилях.'}</p></div>
          ${mirror ? '' : `<label class="toggle-switch" title="Общее пространство"><input type="checkbox" ${fedOn ? 'checked' : ''} data-on-change="wsShared" data-a-change="${esc(JSON.stringify([w.id, "__checked"]))}" aria-label="Общее пространство"><div class="toggle-track"><div class="toggle-thumb"></div></div></label>`}</div></div>`}
      ${fedOn ? `<div class="ws-sec"><h4>Серверы пространства</h4><p>Подключение идёт деревом: каждый сервер связан с тем, через кого вошёл.</p>${wsTree(w)}
        ${(w.fed.asks || []).map(a => `<div class="wsf-ask ws-ask"><span>Сервер «${esc(nm(w, a.proposer))}» просит добавить в пространство сервер «${esc(a.target_name)}»${a.approved ? ' (одобрено, ждём ответа)' : ''}</span>${a.approved ? '' : `<button class="btn btn-ghost btn-sm" data-on-click="wsAsk" data-a-click="${esc(JSON.stringify([a.id, false]))}">Отклонить</button><button class="btn ux-solid btn-sm" data-on-click="wsAsk" data-a-click="${esc(JSON.stringify([a.id, true]))}">Одобрить</button>`}</div>`).join('')}
        <div class="ws-lab">${w.fed.is_host ? 'Пригласить сервер' : 'Попросить хозяина добавить сервер'}</div>
        ${cands.length ? `<div class="wsf-inv">${uxSelHtml('wsf-cand-' + w.id, cands.map(c => ({ v: c.id, t: `${c.name}`, s: c.ok ? c.id : `${c.id} · нужно обновить сервер`, dis: !c.ok })), undefined, 'Сервер')}<button class="btn ux-solid btn-sm" data-on-click="wsInvite" data-a-click="${esc(JSON.stringify([w.id]))}">${w.fed.is_host ? 'Пригласить' : 'Попросить'}</button></div>
          <div class="fd-hint" style="margin-top:6px">Нужно прямое подключение к серверу в разделе «Федерации».${w.fed.is_host ? '' : ' Расширять пространство дальше можно только с согласия хозяина.'}</div>`
          : '<div class="fd-hint">Нет серверов, которых можно добавить: подключите ещё сервер в разделе «Федерации».</div>'}</div>` : ''}</div>`;
  }
  document.getElementById('page-body').innerHTML = `<div class="ux-page">
    <div><div style="font-size:17px;font-weight:700">Пространства</div><div style="margin-top:2px;font-size:12.5px;color:var(--c-text2)">Люди видят друг друга, если у них есть общее пространство. Человек может состоять в нескольких. Если общего нет, связать их можно через контакты, группы и комнаты. Пространства человека выбираются в его профиле. Пространство можно сделать общим для нескольких серверов федерации: люди всех серверов в нём видят друг друга.</div></div>
    ${WS.offers.map((o, i) => `<div class="card wsf-offer"><div class="wsf-ot"><b>«${esc(o.from_name)}» предлагает общее пространство «${esc(o.name)}»</b><span>Хозяин: ${esc(o.host_name)}. Серверы в пространстве: ${o.servers.map(esc).join(', ')}. Ваши люди увидят людей этих серверов, а они ваших, но только тех, кого вы сами добавите в это пространство. Название пространства задаёт хозяин.</span>
      <span class="wsf-att">${uxSelHtml('wsf-att-' + i, [{ v: '', t: 'Создать новое пространство' }, ...(o.local || []).map(l => ({ v: String(l.id), t: `Объединить с моим «${l.name}»`, s: `${l.users} ${uxPlural(l.users, 'человек', 'человека', 'человек')}` }))], o.same ? String(o.same) : '', 'Что сделать с пространством')}</span>
      ${o.same ? '<span>У вас уже есть пространство с таким названием: при объединении оно станет общим, его люди сразу попадут в общее пространство.</span>' : ''}</div>
      <button class="btn btn-ghost btn-sm" data-on-click="wsOffer" data-a-click="${esc(JSON.stringify([`${esc(o.uid)}`, false]))}">Отклонить</button><button class="btn ux-solid btn-sm" data-on-click="wsOffer" data-a-click="${esc(JSON.stringify([`${esc(o.uid)}`, true, i]))}">Принять</button></div>`).join('')}
    <div class="ws-ms"><div class="card ws-ml"><div class="ws-fl">${[['all', 'Все'], ['shared', 'Общие'], ['local', 'Только у вас']].map(([k, l]) => `<button type="button" aria-pressed="${WS.filter === k}" data-on-click="wsFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${l}<span>${cnt[k]}</span></button>`).join('')}</div>
      ${vis.map(x => `<button type="button" class="ws-it" aria-current="${x.id === WS.sel}" data-on-click="wsPick" data-a-click="${esc(JSON.stringify([x.id]))}">${wsAvatar(x, true)}<span class="ws-in"><b>${esc(x.name)}</b><small>${x.users} ${uxPlural(x.users, 'человек', 'человека', 'человек')}${x.fed?.shared ? ' · общее' : ''}</small></span>${pend(x) ? `<span class="ws-cnt" title="Просьбы серверов">${pend(x)}</span>` : ''}</button>`).join('') || '<div class="fd-empty"><div><span>Здесь пока пусто</span></div></div>'}</div>
      ${det}</div></div>`;
}
const WS_I = {
  pen: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  out: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
};
async function wsOffer(uid, accept, i) {
  const attach = accept ? Number(uxSelVal('wsf-att-' + i)) || null : null;
  const r = await api('POST', `/api/admin/workspaces/fed/offers/${encodeURIComponent(uid)}/${accept ? 'accept' : 'decline'}`, attach ? { attach } : undefined);
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
  toast(accept ? (r.attached ? 'Пространство объединено с вашим: его люди теперь в общем пространстве.' : 'Пространство принято. Добавьте в него своих людей в их профилях.') : 'Предложение отклонено', 'success');
  await wsLoad(); if (currentPage === 'workspaces') wsRender();
}
async function wsAsk(id, ok) {
  const r = await api('POST', `/api/admin/workspaces/fed/asks/${id}/${ok ? 'approve' : 'decline'}`);
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
  toast(ok ? 'Одобрено: сервер получит приглашение' : 'Отклонено', 'success');
  await wsLoad(); if (currentPage === 'workspaces') wsRender();
}
function wsShared(id, on) {
  const w = WS.list.find(x => x.id === id); if (!w) return;
  const go = async () => {
    const r = await api('POST', `/api/admin/workspaces/${id}/shared`, { on });
    if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); }
    else toast(on ? 'Пространство стало общим. Теперь пригласите серверы кнопкой «Серверы».' : 'Пространство больше не общее', 'success');
    await wsLoad(); if (currentPage === 'workspaces') wsRender();
  };
  if (on) go();
  else confirm('Выключить «Общее»?', `Люди других серверов покинут пространство «${esc(w.name)}», у них оно перестанет быть общим. У вас оно останется обычным, ваши люди в нём сохранятся.`, go);
  if (!on) wsRender();
}
async function wsInvite(id) {
  const inst = uxSelVal('wsf-cand-' + id); if (!inst) return;
  const r = await api('POST', `/api/admin/workspaces/${id}/servers`, { instance: inst });
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
  toast(r.asked ? 'Просьба отправлена хозяину пространства' : 'Приглашение отправлено', 'success');
  await wsLoad(); if (currentPage === 'workspaces') wsRender();
}
function wsRemove(id, inst) {
  const w = WS.list.find(x => x.id === id); const s = w?.fed?.servers.find(x => x.id === inst); if (!s) return;
  confirm('Убрать сервер из пространства?', `«${esc(s.name)}» и все серверы, подключённые через него, покинут пространство «${esc(w.name)}». Их люди перестанут быть здесь видны, переписки сохранятся.`, async () => {
    const r = await api('DELETE', `/api/admin/workspaces/${id}/servers/${encodeURIComponent(inst)}`);
    if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
    toast('Сервер убран', 'success');
    await wsLoad(); if (currentPage === 'workspaces') wsRender();
  });
}
function wsLeave(id) {
  const w = WS.list.find(x => x.id === id); if (!w) return;
  confirm('Выйти из общего пространства?', `Люди других серверов перестанут быть видны в «${esc(w.name)}», а ваши люди перестанут быть видны им. У вас пространство останется обычным.`, async () => {
    const me = FD.me?.id || (await api('GET', '/api/admin/federation'))?.me?.id;
    const r = await api('DELETE', `/api/admin/workspaces/${id}/servers/${encodeURIComponent(me)}`);
    if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
    closeModal('modal-fed'); toast('Вы вышли из пространства', 'success');
    await wsLoad(); if (currentPage === 'workspaces') wsRender();
  });
}
function wsOpen(id) {
  WS.editId = id || null;
  const w = id ? WS.list.find(x => x.id === id) : null;
  document.getElementById('ws-title').textContent = w ? 'Переименовать пространство' : 'Новое пространство';
  document.getElementById('ws-go').textContent = w ? 'Сохранить' : 'Создать';
  document.getElementById('ws-name').value = w ? w.name : '';
  document.getElementById('ws-err').textContent = '';
  openModal('modal-ws');
  setTimeout(() => document.getElementById('ws-name')?.focus(), 60);
}
async function wsSave() {
  const name = document.getElementById('ws-name').value.trim(), err = document.getElementById('ws-err');
  if (!name) { err.textContent = 'Введите название'; return; }
  const r = WS.editId ? await api('PATCH', '/api/admin/workspaces/' + WS.editId, { name }) : await api('POST', '/api/admin/workspaces', { name });
  if (r?.error || !r) { err.textContent = r?.error || 'Не удалось сохранить'; return; }
  closeModal('modal-ws');
  toast(WS.editId ? 'Сохранено' : 'Пространство создано', 'success');
  await wsLoad();
  if (currentPage === 'workspaces') wsRender();
}
// Удалить можно пустое пространство, не основное. Общее перед удалением выключается (хозяин) или покидается (зеркало): всё в одном подтверждении
function wsDelete(id) {
  const w = WS.list.find(x => x.id === id); if (!w) return;
  if (w.is_default) { toast('Основное пространство удалить нельзя: оно используется по умолчанию', 'error'); return; }
  const shared = !!w.fed?.shared, host = !!w.fed?.is_host;
  const people = w.users ? ` Оно будет убрано у ${w.users} ${uxPlural(w.users, 'человека', 'людей', 'людей')}${w.only_here ? `, из них ${w.only_here} ${uxPlural(w.only_here, 'перейдёт', 'перейдут', 'перейдут')} в «Основное» (у них нет других пространств)` : ''}.` : '';
  const text = !shared ? `Пространство «${esc(w.name)}» будет удалено.${people}`
    : host ? `Пространство «${esc(w.name)}» общее. Сначала «Общее» будет выключено: люди других серверов покинут пространство, у них оно станет обычным. Затем пространство удалится у вас.${people}`
    : `Пространство «${esc(w.name)}» общее, его ведёт другой сервер. Вы выйдете из него (ваши люди перестанут быть видны другим серверам), затем оно удалится у вас.${people}`;
  confirm(shared ? (host ? 'Выключить «Общее» и удалить?' : 'Выйти и удалить пространство?') : 'Удалить пространство?', text, async () => {
    if (shared) {
      const me = FD.me?.id || (await api('GET', '/api/admin/federation'))?.me?.id;
      const r0 = host ? await api('POST', `/api/admin/workspaces/${id}/shared`, { on: false }) : await api('DELETE', `/api/admin/workspaces/${id}/servers/${encodeURIComponent(me)}`);
      if (!r0 || r0.error) { toast(esc(r0?.error || 'Не удалось выключить общий доступ'), 'error'); await wsLoad(); if (currentPage === 'workspaces') wsRender(); return; }
    }
    const r = await api('DELETE', '/api/admin/workspaces/' + id);
    if (r?.error) { toast(esc(r.error), 'error'); await wsLoad(); if (currentPage === 'workspaces') wsRender(); return; }
    toast('Пространство удалено', 'success');
    await wsLoad();
    if (currentPage === 'workspaces') wsRender();
  });
}

/* ── Блок «Федерация» на главной ── */
// Виден только когда есть подключённые серверы. Свёрнут: итоги за сутки. Раскрыт: график и список серверов.
const FDV = { data: null, open: false, period: 'day', metric: 'msg', timer: null };
try { FDV.open = localStorage.getItem('fdv-open') === '1'; FDV.period = localStorage.getItem('fdv-period') || 'day'; } catch {}
function fdvBytes(b) {
  if (!b) return '0';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1).replace('.', ',')) + ' ' + u[i];
}
function fdvStart() {
  clearInterval(FDV.timer);
  fdvLoad();
  FDV.timer = setInterval(() => { if (currentPage !== 'dashboard') { clearInterval(FDV.timer); return; } if (!document.hidden) fdvLoad(); }, 30000);
}
async function fdvLoad() {
  const r = await api('GET', '/api/admin/federation/stats?period=' + FDV.period);
  if (!r || r.error) return;
  FDV.data = r; fdvRender();
}
function fdvNice(mx) {
  if (mx <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(mx))), f = mx / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function fdvChart(up, dn, labelsT, fmt) {
  const W = 640, H = 170, pad = 30, n = up.length, mid = H / 2 - 6, top = fdvNice(Math.max(1, ...up, ...dn)), bw = (W - pad) / n;
  let s = '';
  [-1, 0, 1].forEach(g => { const y = mid + g * (mid - 8); s += `<line class="${g === 0 ? 'ax' : 'gl'}" x1="${pad}" x2="${W}" y1="${y}" y2="${y}"/>`; });
  s += `<text x="0" y="14">${fmt(top)}</text><text x="0" y="${H - 18}">${fmt(top)}</text><text x="0" y="${mid + 3}">0</text>`;
  for (let i = 0; i < n; i++) {
    const x = pad + i * bw + bw * 0.18, w = bw * 0.64, hu = up[i] / top * (mid - 8), hd = dn[i] / top * (mid - 8);
    s += `<rect x="${x}" y="${mid - hu}" width="${w}" height="${Math.max(hu, up[i] ? 1.5 : 0)}" rx="2" fill="var(--c-primary)"><title>отправлено: ${fmt(up[i])}</title></rect>`;
    s += `<rect x="${x}" y="${mid}" width="${w}" height="${Math.max(hd, dn[i] ? 1.5 : 0)}" rx="2" fill="var(--dv-c2,#7c8cff)"><title>получено: ${fmt(dn[i])}</title></rect>`;
  }
  const tl = t => { const d = new Date(t * 1000); return FDV.period === 'day' ? String(d.getHours()).padStart(2, '0') + ':00' : FDV.period === 'week' ? ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()] : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
  const ticks = FDV.period === 'day' ? [0, 6, 12, 18, n - 1] : FDV.period === 'week' ? [...Array(n).keys()] : [0, 7, 14, 21, n - 1];
  ticks.forEach((i, j) => { const xx = pad + (i + 0.5) * bw; s += `<text x="${xx}" y="${H - 3}" text-anchor="${j === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${i === n - 1 && FDV.period !== 'week' ? (FDV.period === 'day' ? 'сейчас' : 'сегодня') : tl(labelsT[i])}</text>`; });
  return `<svg class="fdv-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="График обмена">${s}</svg>`;
}
function fdvRender() {
  const box = document.getElementById('dv-fed'), d = FDV.data;
  if (!box) return;
  if (!d || !d.peers?.length) { box.hidden = true; box.innerHTML = ''; return; }
  const t = d.totals, bad = t.active < t.all, sp = FDV.period;
  const periodLabel = { day: 'за сутки', week: 'за неделю', month: 'за месяц' }[sp];
  const rejLine = t.rej.total ? `<b>Отклонено за сутки: ${t.rej.total}</b> (${[t.rej.limit ? 'правило двух сообщений: ' + t.rej.limit : '', t.rej.rate ? 'лимит новых переписок: ' + t.rej.rate : '', t.rej.blocked ? 'блокировка: ' + t.rej.blocked : '', t.rej.file ? 'вложение не принято: ' + t.rej.file : ''].filter(Boolean).join(', ')}).` : 'Отклонённых сообщений и вложений за сутки нет.';
  const stat = (lab, a, b) => `<span class="fdv-st">${lab}<span class="vv"><b class="fdv-up">↑${a}</b><b class="fdv-dn">↓${b}</b></span></span>`;
  let h = `<div class="fdv-h"><div class="fdv-ttl"><span class="fdv-dot ${bad ? 'warn' : ''}"></span><b>Федерация</b><span class="dv-sub">${t.active} из ${t.all} активно</span></div>
    <div class="fdv-stats">${stat('сообщения', t.msgOut, t.msgIn)}${stat('файлы', t.fOut, t.fIn)}${stat('объём', fdvBytes(t.bOut), fdvBytes(t.bIn))}${(t.queue || t.rej.total) ? `<span class="fdv-chips">${t.queue ? `<span class="fdv-chip">очередь ${t.queue}</span>` : ''}${t.rej.total ? `<span class="fdv-chip">отклонено ${t.rej.total}</span>` : ''}</span>` : ''}</div>
    <button type="button" class="fdv-tg" aria-expanded="${FDV.open}" aria-label="${FDV.open ? 'Свернуть' : 'Развернуть'}" data-on-click="fdvToggle"><svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button></div>`;
  {
    const m = FDV.metric, S = d.series;
    const cfg = { msg: ['Сообщения', S.map(x => x.msgOut), S.map(x => x.msgIn), v => v], file: ['Файлы', S.map(x => x.fOut), S.map(x => x.fIn), v => v], vol: ['Объём', S.map(x => x.bOut), S.map(x => x.bIn), fdvBytes] }[m];
    const young = Date.now() / 1000 - d.newest_peer_at < 86400;
    const tabs = (attr, items, cur, fn) => `<div class="fdv-tabs">${items.map(x => `<button type="button" aria-pressed="${cur === x[0]}" data-on-click="${esc(fn)}" data-a-click="${esc(JSON.stringify([`${x[0]}`]))}">${x[1]}</button>`).join('')}</div>`;
    h += `<div class="fdv-w${FDV.open ? ' open' : ''}"${FDV.open ? '' : ' inert'}><div class="fdv-in"><div class="fdv-b"><div><div class="fdv-top"><span class="fdv-lab">${cfg[0]}</span>${tabs('m', [['msg', 'Сообщения'], ['file', 'Файлы'], ['vol', 'Объём']], m, 'fdvMetric')}${tabs('p', [['day', 'Сутки'], ['week', 'Неделя'], ['month', 'Месяц']], sp, 'fdvPeriod')}</div>
      ${young ? '<div class="fdv-note">Соединение подключено недавно. График наполнится по мере обмена, объём считается с момента подключения.</div>' : ''}
      ${fdvChart(cfg[1], cfg[2], S.map(x => x.t), cfg[3])}
      <div class="fdv-leg"><span><i style="background:var(--c-primary)"></i>отправлено</span><span><i style="background:var(--dv-c2,#7c8cff)"></i>получено</span></div></div>
      <div><div class="fdv-lab" style="margin-bottom:6px">Серверы · ${periodLabel}</div><div class="fdv-sl">${d.peers.map(p => `<div class="fdv-sr"><span class="fdv-dot ${p.status === 'paused' ? 'off' : p.online ? '' : 'warn'}"></span><div><b>${esc(p.name)}</b><div class="cap">${p.status === 'paused' ? '<span class="w">приостановлено</span> · ' : !p.online ? '<span class="w">нет связи</span> · ' : ''}${p.last_contact_at ? 'обмен ' + esc(uaSeen(p.last_contact_at)) : 'обмена не было'}${p.queue ? ` · <span class="w">очередь ${p.queue}</span>` : ''}</div></div>
        <div class="m"><span class="fdv-up">↑ ${p.msgOut}</span><span class="fdv-dn">↓ ${p.msgIn}</span><span>${fdvBytes(p.bytes)}</span></div></div>`).join('')}</div>
      <div class="fdv-rej">${rejLine}</div></div></div></div></div>`;
  }
  box.innerHTML = h; box.hidden = false;
}
// Раскрытие без перерисовки блока: переключаем класс у уже стоящего тела, и оно плавно
// раскрывается через высоту строки сетки. Перерисовка (innerHTML) убивала и анимацию, и поворот стрелки
function fdvToggle() {
  FDV.open = !FDV.open;
  try { localStorage.setItem('fdv-open', FDV.open ? '1' : '0'); } catch {}
  const box = document.getElementById('dv-fed'), w = box?.querySelector('.fdv-w'), tg = box?.querySelector('.fdv-tg');
  if (!w || !tg) { fdvRender(); return; }
  w.classList.toggle('open', FDV.open);
  w.inert = !FDV.open;
  tg.setAttribute('aria-expanded', String(FDV.open));
  tg.setAttribute('aria-label', FDV.open ? 'Свернуть' : 'Развернуть');
}
function fdvMetric(m) { FDV.metric = m; fdvRender(); }
function fdvPeriod(p) { FDV.period = p; try { localStorage.setItem('fdv-period', p); } catch {} fdvLoad(); }

/* ── ФЕДЕРАЦИИ ── */
// Соединения с другими серверами: люди оттуда появляются в «Контактах» и пишут в личные чаты. Через соединение
// нельзя управлять чужим сервером: ни пользователями, ни настройками, ни обновлениями.
const FD = { me: null, peers: [], rules: { new_per_hour: 20, invites_per_hour: 20, groups_in: true }, menu: null, edit: null, timer: null, tab: 'list' };
const fdPlural = (n) => uxPlural(n, 'человек', 'человека', 'человек');
async function fdLoad() {
  const r = await api('GET', '/api/admin/federation');
  if (r && !r.error && r.me) { FD.me = r.me; FD.peers = r.peers || []; FD.rules = r.rules || FD.rules; }
  const nb = document.getElementById('nb-federation');
  if (nb) nb.textContent = FD.peers.length;
  return r;
}
async function renderFederation() {
  setTopbarActions('');
  clearInterval(FM.timer);
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>`;
  await fdLoad();
  if (currentPage !== 'federation') return;
  if (FD.tab === 'map') { renderMap(); return; }
  fdRender();
  clearInterval(FD.timer);
  FD.timer = setInterval(async () => {
    if (currentPage !== 'federation') { clearInterval(FD.timer); return; }
    if (FD.tab === 'map') return;
    const busy = document.querySelector('#modal-fed.open') || FD.menu !== null || document.activeElement?.closest?.('#page-body input');
    if (busy) return;
    await fdLoad(); if (currentPage === 'federation') fdRender();
  }, 10000);
}
function fdRender() {
  if (currentPage !== 'federation') return;
  const me = FD.me || {}, ok = me.configured, I = FD_I;
  const tip = t => `<span class="fd-tip" tabindex="0" data-t="${esc(t)}">${I.info}</span>`;
  const lab = (t, tp) => `<span class="fd-lab">${t}${tp ? tip(tp) : ''}</span>`;
  // значение с правкой по карандашу: в режиме правки поле и кнопки «сохранить» / «отмена»
  const field = (key, val, ph, save) => FD.edit === key
    ? `<div class="fd-ed wide"><input id="fd-${key}" maxlength="${key === 'name' ? 60 : 200}" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off" aria-label="${key === 'name' ? 'Имя системы' : 'Адрес для соединений'}" data-on-keydown="__h89" data-a-keydown="${esc(JSON.stringify([save]))}"><button type="button" class="fd-ib ok" aria-label="Сохранить" data-on-click="${esc(save)}">${I.check}</button><button type="button" class="fd-ib" aria-label="Отмена" data-on-click="fdEdit" data-a-click='[null]'>${I.x}</button></div>`
    : `<div class="fd-ed"><span class="v${key === 'url' ? ' fd-mono' : ''}${val ? '' : ' none'}">${val ? esc(key === 'url' ? val.replace(/^https?:\/\//, '') : val) : 'не задан'}</span><button type="button" class="fd-ib" aria-label="Изменить" data-on-click="fdEdit" data-a-click="${esc(JSON.stringify([`${key}`]))}">${I.pen}</button></div>`;
  const side = ok
    ? `<div class="fd-me"><div class="fd-top"><span class="fd-gl">${I.globe}</span><div class="fd-tn">${FD.edit === 'name' ? field('name', me.name || '', 'Например, Склад-Логистика', 'fdSaveName') : `<div class="fd-ed fd-big"><span class="v">${esc(me.name || me.id)}</span><button type="button" class="fd-ib" aria-label="Изменить имя" data-on-click="fdEdit" data-a-click='["name"]'>${I.pen}</button></div>`}<span class="fd-sm">Этот сервер${tip('Имя видят администраторы подключённых серверов в списке соединений. Обычным людям название не показывается.')}</span></div></div>
      <div class="fd-kv">
        ${lab('ID', 'Не меняется. Входит в адрес ваших людей для партнёров: @' + me.id + ':логин.')}<div class="fd-ed"><code class="v">${esc(me.id)}</code><button type="button" class="fd-ib" aria-label="Копировать идентификатор" data-on-click="fdCopy" data-a-click="${esc(JSON.stringify([`${esc(me.id)}`, "Идентификатор скопирован"]))}">${I.copy}</button></div>
        ${lab('Адрес', 'По нему партнёры подключаются к вам. Если у сервера нет белого IP или не проброшены порты, оставьте пустым: тогда подключаться будете вы, введя ключ партнёра.')}${field('url', me.url || '', 'https://chat.example.ru (необязательно)', 'fdSaveUrl')}
        ${lab('Отпечаток', 'Отпечаток вашего ключа. Администратор партнёра сверяет его с вашим по телефону или лично при подключении.')}<div class="fd-ed wide"><span class="v fd-fpv">${esc(me.fp)}</span><button type="button" class="fd-ib" aria-label="Копировать отпечаток" data-on-click="fdCopy" data-a-click="${esc(JSON.stringify([`${esc(me.fp)}`, "Отпечаток скопирован"]))}">${I.copy}</button></div>
      </div></div>`
    : `<div class="fd-me"><div class="fd-top"><span class="fd-gl">${I.globe}</span><div class="fd-tn"><div class="fd-big"><span class="v">Этот сервер</span></div><span class="fd-sm">Сначала задайте идентификатор</span></div></div>
      <div class="fd-setup">
        <div><b>Имя системы</b><span class="d">Видят администраторы подключённых серверов. Обычным людям название не показывается.</span><div class="fd-inl"><div class="ua-inp"><input id="fd-name" maxlength="60" value="${esc(me.name || '')}" placeholder="Например, Склад-Логистика" autocomplete="off" aria-label="Имя системы" data-on-keydown="__h90"></div><button class="btn btn-ghost btn-sm" data-on-click="fdSaveName">Сохранить</button></div></div>
        <div><b>Уникальный идентификатор</b><span class="d">Задаётся один раз и потом не меняется. Латиница, цифры, точка, дефис, подчёркивание; 2–32 символа. Выберите коротко и понятно.</span><div class="fd-inl"><div class="ua-inp"><input class="fd-mono" id="fd-id" maxlength="32" placeholder="например, logist" autocomplete="off" aria-label="Идентификатор" data-on-keydown="__h91"></div><button class="btn ux-solid btn-sm" data-on-click="fdSaveId">Задать</button></div></div>
        <div><b>Адрес для соединений</b><span class="d">По нему партнёры подключаются к вам. Без белого IP оставьте пустым: тогда подключаться будете вы, введя ключ партнёра.</span><div class="fd-inl"><div class="ua-inp"><input class="fd-mono" id="fd-url" value="${esc(me.url || '')}" placeholder="https://chat.example.ru (необязательно)" autocomplete="off" aria-label="Адрес для соединений" data-on-keydown="__h92"></div><button class="btn btn-ghost btn-sm" data-on-click="fdSaveUrl">Сохранить</button></div></div>
      </div></div>`;
  const q = FD.peers.reduce((a, p) => a + p.queue, 0);
  document.getElementById('page-body').innerHTML = `<div class="ux-page">
    <div><div style="font-size:17px;font-weight:700">Федерации</div><div style="margin-top:2px;font-size:12.5px;color:var(--c-text2)">Соединения с другими серверами. Люди оттуда добавляются в контакты по адресу «@сервер:логин» и пишут в личные чаты. Пространство можно сделать общим для нескольких серверов: на странице «Пространства».</div></div>
    ${fdTabs()}
    <div class="fd-cols">
      <div class="card fd-card"><div class="fd-head">Соединения <span class="fd-n">${FD.peers.length}</span>${q ? `<span class="fd-qh">в очереди: ${q}</span>` : ''}</div>${fdPeers()}</div>
      <div class="fd-side">
        <div class="card fd-card">${side}<div class="fd-safe">${I.shield}<span>Соединение даёт только обмен сообщениями между людьми. Управлять другим сервером через него нельзя: ни пользователями, ни настройками, ни обновлениями.</span></div></div>
        <div class="card"><div class="fd-head">Правила приёма</div><div class="fd-lim">
          <div class="r"><span class="t">Новых переписок в час<small>с одного чужого сервера, сверх лимита отклоняются</small></span><div class="fd-stp"><button type="button" data-on-click="fdRule" data-a-click='[-5]' aria-label="Меньше">−</button><span>${FD.rules.new_per_hour}</span><button type="button" data-on-click="fdRule" data-a-click='[5]' aria-label="Больше">+</button></div></div>
          <div class="r"><span class="t">Приглашений в группы в час<small>с одного чужого сервера, сверх лимита молча отклоняются</small></span><div class="fd-stp"><button type="button" data-on-click="fdRule" data-a-click='[-5, "invites_per_hour"]' aria-label="Меньше">−</button><span>${FD.rules.invites_per_hour || 20}</span><button type="button" data-on-click="fdRule" data-a-click='[5, "invites_per_hour"]' aria-label="Больше">+</button></div></div>
          <div class="r"><span class="t">Принимать приглашения в группы<small>от людей с других серверов, иначе молча отклоняются</small></span><label class="toggle-switch"><input type="checkbox" ${FD.rules.groups_in !== false ? 'checked' : ''} data-on-change="fdGroupsIn" data-a-change='["__checked"]'><div class="toggle-track"><div class="toggle-thumb"></div></div></label></div>
        </div></div>
      </div>
    </div></div>`;
}
function fdEdit(k) { FD.edit = k; fdRender(); if (k) { const el = document.getElementById('fd-' + k); if (el) { el.focus(); el.select(); } } }
const FD_I = {
  ins: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17"/><path d="M17 17H7V7"/></svg>',
  outs: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
  key: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  pen: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  globe: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  shield: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
};
function fdPeers() {
  if (!FD.peers.length) return `<div class="fd-empty"><div><b>Соединений пока нет</b><span>Подключите сервер партнёра ключом активации, и его люди появятся у вас в контактах.</span></div><button class="btn ux-solid btn-sm" ${FD.me?.configured ? '' : 'disabled title="Сначала задайте идентификатор"'} data-on-click="fdChoose">+ Подключить сервер</button></div>`;
  return FD.peers.map((p, i) => {
    const st = p.status === 'paused' ? 'off' : !p.online ? 'warn' : '';
    const word = p.status === 'paused' ? '<span class="fd-w">приостановлено</span>' : !p.online ? '<span class="fd-w warn">нет связи</span>' : '';
    const paused = p.status === 'paused';
    return `<div class="fd-r"><span class="fd-dot ${st}"></span><div class="fd-bd"><div class="fd-nm"><b>${esc(p.name)}</b><code>${esc(p.instance_id)}</code>${p.ver ? `<span class="fd-ver" title="${p.online ? 'Версия сервера' : 'Последняя известная версия сервера'}">v${esc(p.ver)}</span>` : ''}${word}</div>
      <div class="fd-meta"><span class="fd-dir" title="${p.role === 'in' ? 'Они подключаются к нам сами' : 'Мы подключаемся к ним'}">${p.role === 'in' ? FD_I.ins + 'они к нам' : FD_I.outs + 'мы к ним'}</span><span>${p.last_contact_at ? esc(uaSeen(p.last_contact_at)) : 'обмена не было'}</span><span>${p.people} ${fdPlural(p.people)}</span>${p.queue ? `<span class="q">очередь ${p.queue}</span>` : ''}</div></div>
      <div class="fd-ac"><button class="fd-kb" type="button" aria-label="Действия" data-on-click="__h93" data-a-click="${esc(JSON.stringify([i]))}"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>${FD.menu === i ? `<div class="fd-menu"><button type="button" data-on-click="fdFp" data-a-click="${esc(JSON.stringify([i]))}">${FD_I.key}Отпечаток ключа</button><button type="button" data-on-click="fdPause" data-a-click="${esc(JSON.stringify([i]))}">${paused ? FD_I.play + 'Возобновить' : FD_I.pause + 'Приостановить'}</button><hr><button type="button" class="dg" data-on-click="fdDelete" data-a-click="${esc(JSON.stringify([i]))}">${FD_I.trash}Удалить соединение</button></div>` : ''}</div></div>`;
  }).join('');
}
function fdMenu(i) { FD.menu = FD.menu === i ? null : i; fdRender(); }
document.addEventListener('click', e => { if (FD.menu !== null && !e.target.closest('.fd-ac')) { FD.menu = null; if (currentPage === 'federation') fdRender(); } });
async function fdCopy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg || 'Скопировано', 'success'); } catch { toast('Не удалось скопировать: выделите и скопируйте вручную', 'error'); } }
async function fdPut(body, okMsg) {
  const r = await api('PUT', '/api/admin/federation/identity', body);
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось сохранить'), 'error'); return false; }
  FD.me = r.me; FD.peers = r.peers || FD.peers; FD.edit = null; toast(okMsg, 'success'); fdRender(); return true;
}
function fdSaveName() { fdPut({ name: document.getElementById('fd-name').value }, 'Имя системы сохранено'); }
function fdSaveUrl() { fdPut({ url: document.getElementById('fd-url').value }, 'Адрес сохранён'); }
function fdSaveId() {
  const v = document.getElementById('fd-id').value.trim().toLowerCase();
  if (!v) { toast('Введите идентификатор', 'error'); return; }
  confirm('Задать идентификатор?', `Идентификатор «${esc(v)}» после сохранения изменить нельзя: он входит в адреса ваших людей у партнёров.`, () => fdPut({ id: v }, 'Идентификатор задан'));
}
async function fdRule(d, key = 'new_per_hour') {
  const r = await api('PUT', '/api/admin/federation/rules', { [key]: Math.max(1, Math.min(500, (FD.rules[key] || 20) + d)) });
  if (r && !r.error && r.rules) { FD.rules = r.rules; fdRender(); }
}
async function fdGroupsIn(on) {
  const r = await api('PUT', '/api/admin/federation/rules', { groups_in: !!on });
  if (r && !r.error && r.rules) { FD.rules = r.rules; fdRender(); }
}
// Окно: заголовок, тело, кнопки в подвале
function fdModal(title, body, foot) {
  document.getElementById('fd-title').textContent = title;
  document.getElementById('fd-body').innerHTML = body;
  document.getElementById('fd-foot').innerHTML = foot;
  openModal('modal-fed');
}
const fdCancel = '<button class="btn btn-ghost" data-on-click="__h94">Отмена</button>';
function fdChoose() {
  if (!FD.me?.configured) { toast('Сначала задайте идентификатор сервера', 'error'); return; }
  fdModal('Подключить сервер', `<button class="fd-opt" type="button" data-on-click="fdMake"><div style="font-size:20px">🔑</div><div><b>Создать ключ активации</b><span>Вы передаёте ключ администратору другого сервера. Подходит, если ваш сервер доступен снаружи.</span></div></button>
    <button class="fd-opt" type="button" data-on-click="fdEnter"><div style="font-size:20px">📥</div><div><b>У меня есть ключ</b><span>Вставьте ключ, полученный от партнёра. Подключаться будете вы, поэтому открытый адрес у вас не нужен.</span></div></button>`, fdCancel);
}
async function fdMake() {
  const r = await api('POST', '/api/admin/federation/invites');
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось создать ключ'), 'error'); return; }
  FD.key = r.key;
  const until = new Date(r.expires_at * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  fdModal('Ключ активации', `<div class="fd-hint">Передайте ключ администратору второго сервера любым защищённым способом. Ключ одноразовый и действует 24 часа.</div>
    <div class="fd-key" id="fd-keybox">${esc(r.key)}</div>
    <div class="fd-kv"><span>Действует до</span><b>${esc(until)}</b><span>Адрес</span><b>${esc(r.url)}</b><span>Ваш отпечаток</span><b>${esc(FD.me.fp)}</b></div>
    <div class="fd-note"><span><b>!</b></span><div>Сообщите партнёру ваш отпечаток по телефону или лично: он сверит его при подключении.</div></div>`,
    `<button class="btn btn-ghost" data-on-click="__h95">Копировать ключ</button><button class="btn ux-solid" data-on-click="__h96">Готово</button>`);
}
function fdEnter(err) {
  fdModal('Ввести ключ', `<textarea class="fd-ta" id="fd-key" placeholder="FED-…" aria-label="Ключ активации" spellcheck="false"></textarea><div class="ua-err" id="fd-err">${esc(err || '')}</div>`,
    `${fdCancel}<button class="btn ux-solid" data-on-click="fdPreview">Проверить ключ</button>`);
  setTimeout(() => document.getElementById('fd-key')?.focus(), 60);
}
async function fdPreview() {
  const key = document.getElementById('fd-key').value.trim();
  if (!key) { document.getElementById('fd-err').textContent = 'Вставьте ключ'; return; }
  const r = await api('POST', '/api/admin/federation/key/preview', { key });
  if (!r || r.error) { document.getElementById('fd-err').textContent = r?.error || 'Не удалось проверить ключ'; return; }
  FD.key = key;
  fdModal('Проверьте партнёра', `<div class="fd-kv"><span>Имя системы</span><b>${esc(r.name)}</b><span>Идентификатор</span><b class="fd-mono">${esc(r.id)}</b><span>Адрес</span><b class="fd-mono">${esc(r.url)}</b></div>
    <div class="fd-hint">Отпечаток ключа. Сверьте его с тем, что видит администратор партнёра, по телефону или лично.</div><div class="fd-fp">${esc(r.fp)}</div>
    <label class="fd-chk"><input type="checkbox" id="fd-sure" data-on-change="__h97"> Отпечаток совпал, и я знаю этого партнёра</label>
    <div class="ua-err" id="fd-err"></div>`,
    `${fdCancel}<button class="btn ux-solid" id="fd-go" disabled data-on-click="fdConnect">Подключить</button>`);
}
async function fdConnect() {
  const go = document.getElementById('fd-go'); go.disabled = true; go.textContent = 'Подключаем…';
  const r = await api('POST', '/api/admin/federation/connect', { key: FD.key });
  if (!r || r.error) { go.disabled = false; go.textContent = 'Подключить'; document.getElementById('fd-err').textContent = r?.error || 'Не удалось подключиться'; return; }
  FD.me = r.me; FD.peers = r.peers || []; FD.key = '';
  closeModal('modal-fed'); toast('Соединение установлено', 'success'); fdRender();
  const nb = document.getElementById('nb-federation'); if (nb) nb.textContent = FD.peers.length;
}
function fdFp(i) {
  const p = FD.peers[i]; FD.menu = null; fdRender(); if (!p) return;
  fdModal('Отпечаток ключа', `<div class="fd-kv"><span>Партнёр</span><b>${esc(p.name)}</b></div><div class="fd-fp">${esc(p.fp)}</div><div class="fd-hint">Сверяйте при подключении и после смены ключа. Если отпечаток изменился без вашего ведома, приостановите соединение.</div>`,
    `<button class="btn ux-solid" data-on-click="closeModal" data-a-click='["modal-fed"]'>Закрыть</button>`);
}
async function fdPause(i) {
  const p = FD.peers[i]; FD.menu = null; if (!p) return;
  const r = await api('POST', `/api/admin/federation/peers/${p.id}/${p.status === 'paused' ? 'resume' : 'pause'}`);
  if (r && !r.error) { FD.peers = r.peers || FD.peers; toast(p.status === 'paused' ? 'Соединение возобновлено' : 'Соединение приостановлено: сообщения копятся в очереди', 'success'); }
  fdRender();
}
function fdDelete(i) {
  const p = FD.peers[i]; FD.menu = null; fdRender(); if (!p) return;
  confirm('Удалить соединение?', `Переписки с людьми из «${esc(p.name)}» останутся в чатах, но писать им будет нельзя, пока соединение не будет создано заново. Очередь недоставленных сообщений (${p.queue}) будет очищена.`, async () => {
    const r = await api('DELETE', `/api/admin/federation/peers/${p.id}`);
    if (r && !r.error) { FD.peers = r.peers || []; toast('Соединение удалено', 'success'); }
    fdRender();
    const nb = document.getElementById('nb-federation'); if (nb) nb.textContent = FD.peers.length;
  });
}

/* ── Карта федерации ── */
// Серверы-узлы и соединения-линии: прямые подключения и общие пространства. Узлы можно двигать (раскладка запоминается в браузере),
// колесом мыши масштабировать, фон тянуть. Карта у всех серверов пространства одна: хозяин собирает дерево и рассылает его.
const FM = { data: null, pos: {}, sel: null, selLink: null, space: 'all', k: 1, tx: 20, ty: 20, timer: null, drag: null, fitted: false };
try { FM.pos = JSON.parse(localStorage.getItem('fm-pos') || '{}') || {}; } catch {}
const FM_W = 188, FM_H = 64;
const FM_COL = ['var(--dv-c1)', 'var(--dv-c2)', 'var(--dv-c3)', 'var(--dv-c5)', 'var(--dv-c4)', '#12a672'];
const FM_SRV = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>';
function fdTabs() {
  return `<div class="fm-tabs" role="tablist"><button type="button" aria-pressed="${FD.tab !== 'map'}" data-on-click="fdTab" data-a-click='["list"]'>Подключения</button><button type="button" aria-pressed="${FD.tab === 'map'}" data-on-click="fdTab" data-a-click='["map"]'>Карта</button></div>`;
}
function fdTab(t) {
  FD.tab = t; FD.menu = null;
  clearInterval(FM.timer);
  if (t === 'map') { renderMap(); } else fdRender();
}
async function renderMap() {
  if (currentPage !== 'federation') return;
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div><div style="font-size:17px;font-weight:700">Федерации</div><div style="margin-top:2px;font-size:12.5px;color:var(--c-text2)">Карта подключений и общих пространств. Серверы можно двигать, колесо мыши меняет масштаб, фон двигается перетаскиванием.</div></div>${fdTabs()}<div class="ux-empty">Загрузка…</div></div>`;
  await fmLoad();
  if (currentPage !== 'federation' || FD.tab !== 'map') return;
  fmPage();
  clearInterval(FM.timer);
  FM.timer = setInterval(async () => {
    if (currentPage !== 'federation' || FD.tab !== 'map') { clearInterval(FM.timer); return; }
    if (FM.drag || document.hidden || document.querySelector('#modal-fed.open')) return;
    const before = JSON.stringify(FM.data); await fmLoad();
    if (JSON.stringify(FM.data) !== before) fmDraw();   // без изменений не трогаем разметку: анимация линий идёт без рывков
  }, 5000);
}
async function fmLoad() {
  const r = await api('GET', '/api/admin/federation/map');
  if (r && !r.error) { FM.data = r; if (!FM.sel || !r.nodes.some(n => n.id === FM.sel)) FM.sel = r.me; }
}
// Начальная раскладка: слои по удалённости от нашего сервера
function fmDefaultPos(d) {
  const adj = {}; d.nodes.forEach(n => { adj[n.id] = []; });
  d.edges.forEach(e => { adj[e.a]?.push(e.b); adj[e.b]?.push(e.a); });
  const depth = { [d.me]: 0 }, q = [d.me];
  while (q.length) { const u = q.shift(); (adj[u] || []).forEach(v => { if (!(v in depth)) { depth[v] = depth[u] + 1; q.push(v); } }); }
  const layers = {};
  d.nodes.forEach(n => { const dp = n.id in depth ? depth[n.id] : 0; (layers[dp] = layers[dp] || []).push(n.id); });
  const out = {};
  Object.keys(layers).forEach(k => layers[k].forEach((id, i) => { out[id] = { x: 30 + k * 340, y: 40 + i * 110 + (k % 2) * 30 }; }));
  return out;
}
const fmP = id => FM.pos[id] || FM._def?.[id] || { x: 0, y: 0 };
function fmRoute(d) {
  const adj = {}; d.nodes.forEach(n => { adj[n.id] = []; });
  d.edges.forEach(e => { adj[e.a]?.push({ to: e.b, e }); adj[e.b]?.push({ to: e.a, e }); });
  const prev = { [d.me]: null }, q = [d.me];
  while (q.length) { const u = q.shift(); (adj[u] || []).forEach(x => { if (!(x.to in prev)) { prev[x.to] = { from: u, e: x.e }; q.push(x.to); } }); }
  const ids = [], edges = new Set();
  if (FM.sel && FM.sel !== d.me && FM.sel in prev) { let c = FM.sel; while (c !== d.me) { ids.unshift(c); edges.add(prev[c].e); c = prev[c].from; } ids.unshift(d.me); }
  return { ids, edges };
}
function fmPage() {
  const d = FM.data;
  if (!d?.configured) {
    document.getElementById('page-body').innerHTML = `<div class="ux-page"><div><div style="font-size:17px;font-weight:700">Федерации</div></div>${fdTabs()}<div class="card"><div class="fd-empty"><div><b>Федерация не настроена</b><span>Задайте идентификатор сервера на вкладке «Подключения».</span></div></div></div></div>`;
    return;
  }
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div><div style="font-size:17px;font-weight:700">Федерации</div><div style="margin-top:2px;font-size:12.5px;color:var(--c-text2)">Карта подключений и общих пространств. Серверы можно двигать, колесо мыши меняет масштаб, фон двигается перетаскиванием.</div></div>${fdTabs()}
    <div class="fm-map"><div class="card fm-main"><div class="fm-tb" id="fm-tb"></div><div class="fm-stage" id="fm-stage"><div class="fm-world" id="fm-world"></div><div class="fm-lg"><span><i style="background:repeating-linear-gradient(90deg,var(--c-primary) 0 8px,transparent 8px 17px)"></i>подключение идёт от одного сервера к другому</span><span><i style="background:repeating-linear-gradient(90deg,var(--c-muted) 0 7px,transparent 7px 13px)"></i>нет связи</span><span><i style="height:5px;background:var(--c-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--c-primary) 20%,transparent)"></i>маршрут до выбранного</span></div></div></div>
    <aside class="fm-side" id="fm-side"></aside></div></div>`;
  const st = document.getElementById('fm-stage');
  st.addEventListener('pointerdown', fmDown);
  st.addEventListener('pointermove', fmMove);
  st.addEventListener('pointerup', fmUp);
  st.addEventListener('pointercancel', fmUp);
  st.addEventListener('wheel', fmWheel, { passive: false });
  FM.fitted = false;
  fmDraw();
  fmFit();
}
// Кривая Безье между серверами: от середины стороны к середине стороны, касательные идут вдоль связи (плавная S-образная линия).
// Путь всегда от подключающегося сервера к принимающему, чтобы пунктир бежал в нужную сторону
function fmEdgeGeom(e) {
  const src = e.from === e.b ? e.b : e.a, dst = src === e.a ? e.b : e.a;
  const A = fmP(src), B = fmP(dst), ac = { x: A.x + FM_W / 2, y: A.y + FM_H / 2 }, bc = { x: B.x + FM_W / 2, y: B.y + FM_H / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y, horiz = Math.abs(dx) * 0.62 >= Math.abs(dy);
  let p0, p3, c1, c2;
  if (horiz) { const sx = dx >= 0 ? 1 : -1; p0 = { x: ac.x + sx * FM_W / 2, y: ac.y }; p3 = { x: bc.x - sx * FM_W / 2, y: bc.y }; const h = (p3.x - p0.x) / 2; c1 = { x: p0.x + h, y: p0.y }; c2 = { x: p3.x - h, y: p3.y }; }
  else { const sy = dy >= 0 ? 1 : -1; p0 = { x: ac.x, y: ac.y + sy * FM_H / 2 }; p3 = { x: bc.x, y: bc.y - sy * FM_H / 2 }; const v = (p3.y - p0.y) / 2; c1 = { x: p0.x, y: p0.y + v }; c2 = { x: p3.x, y: p3.y - v }; }
  const pt = t => { const u = 1 - t; return { x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y }; };
  const dv = t => { const u = 1 - t; return { x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x), y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y) }; };
  const m = pt(0.5), q = pt(0.3), v = dv(0.3);
  return { d: `M${p0.x} ${p0.y}C${c1.x} ${c1.y},${c2.x} ${c2.y},${p3.x} ${p3.y}`, mid: m, ch: { x: q.x, y: q.y, ang: Math.atan2(v.y, v.x) * 180 / Math.PI } };
}
// Двигаем уже нарисованное (узлы, линии, подписи), ничего не пересобирая: иначе анимация пунктира сбрасывалась бы на каждом кадре
function fmReposition() {
  const d = FM.data, world = document.getElementById('fm-world'); if (!d || !world) return;
  world.querySelectorAll('.fm-n').forEach(el => { const p = fmP(el.dataset.id); el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; });
  d.edges.forEach((e, i) => {
    const g = fmEdgeGeom(e), grp = world.querySelector(`.fm-e[data-i="${i}"]`); if (!grp) return;
    grp.querySelectorAll('path:not(.fm-ch)').forEach(p => p.setAttribute('d', g.d));
    const ch = grp.querySelector('.fm-ch'); if (ch) ch.setAttribute('transform', `translate(${g.ch.x} ${g.ch.y}) rotate(${g.ch.ang})`);
    const lb = world.querySelector(`.fm-el[data-i="${i}"]`); if (lb) { lb.style.left = (g.mid.x - 50) + 'px'; lb.style.top = (g.mid.y - 10) + 'px'; }
  });
}
function fmDraw() {
  const d = FM.data, world = document.getElementById('fm-world');
  if (!d || !world) return;
  FM._def = fmDefaultPos(d);
  const route = fmRoute(d);
  const spIdx = {}; d.spaces.forEach((s, i) => { spIdx[s.uid] = i; });
  const inSp = (uids) => FM.space === 'all' || uids.includes(FM.space);
  // линии: плавные кривые от стороны к стороне, пунктир бежит от подключающегося сервера к принимающему
  let svg = '', labels = '';
  d.edges.forEach((e, i) => {
    const g = fmEdgeGeom(e);
    const on = route.edges.has(e), vis = FM.space === 'all' || e.spaces.includes(FM.space) || (!e.spaces.length && FM.space === 'all');
    const cols = e.spaces.length ? (FM.space === 'all' ? e.spaces : [FM.space]).map(u => FM_COL[spIdx[u] % FM_COL.length]) : ['var(--c-primary)'];
    const w = on ? 5 : 3, op = vis ? (route.ids.length && !on ? 0.6 : 1) : 0.2;
    const off = e.on === false, known = !!e.from, multi = cols.length > 1 && !off;
    svg += `<g class="fm-e" data-i="${i}">${on ? `<path class="fm-halo" d="${g.d}"/>` : ''}`;
    (multi ? cols.slice(0, 2) : [cols[0]]).forEach((c, j) => {
      svg += `<path class="fm-ln${off ? ' off' : known ? ' flow' : ''}${multi ? ' multi' : ''}" d="${g.d}" style="stroke:${off ? 'var(--c-muted)' : c};stroke-width:${w};opacity:${op};--o0:${-j * 17}px;${multi ? `stroke-dashoffset:${-j * 17}px` : ''}"/>`;
    });
    if (known) svg += `<path class="fm-ch" d="M-5 -5L3 0L-5 5" transform="translate(${g.ch.x} ${g.ch.y}) rotate(${g.ch.ang})" style="opacity:${off ? 0 : op}"/>`;
    svg += `<path class="fm-hit" data-i="${i}" d="${g.d}"/></g>`;
    const lab = e.on === false ? 'нет связи' : e.on === null ? 'нет данных' : (e.spaces.length ? e.spaces.length + ' ' + uxPlural(e.spaces.length, 'пространство', 'пространства', 'пространств') : 'прямое');
    labels += `<div class="fm-el${e.on === false ? ' bad' : ''}" data-i="${i}" style="left:${g.mid.x - 50}px;top:${g.mid.y - 10}px;opacity:${op}">${lab}</div>`;
  });
  // узлы
  const nodes = d.nodes.map(n => {
    const p = fmP(n.id), sel = n.id === FM.sel, dim = FM.space !== 'all' && !n.spaces.some(s => s.uid === FM.space);
    const cls = 'fm-n' + (sel ? ' sel' : '') + (dim ? ' dim' : '') + (n.online === false ? ' off' : n.online === null ? ' unk' : '') + (FM.drag?.id === n.id ? ' drag' : '');
    const sp = FM.space === 'all' ? n.spaces.map(s => `<i style="background:${FM_COL[spIdx[s.uid] % FM_COL.length]}"></i>`).join('') : '';
    const sub = n.online === false ? 'нет связи' : n.online === null ? 'нет данных' : (FM.space !== 'all' ? (n.spaces.find(s => s.uid === FM.space)?.people ?? 0) + ' в пространстве' : n.people ? n.people + ' ' + fdPlural(n.people) : (n.spaces.length ? 'людей пока нет' : 'без пространств'));
    return `<div class="${cls}" data-id="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px"><span class="fm-ni">${FM_SRV}<span class="fm-nd"></span></span><span class="fm-nt"><b>${esc(n.name)}</b><span>${esc(sub)}${sp}</span></span>${n.ver ? `<span class="fm-vt" title="Версия сервера">v${esc(n.ver)}</span>` : ''}${n.self ? '<span class="fm-me">ВЫ</span>' : ''}</div>`;
  }).join('');
  world.style.transform = `translate(${FM.tx}px,${FM.ty}px) scale(${FM.k})`;
  world.innerHTML = `<svg class="fm-svg" width="1" height="1">${svg}</svg>${labels}${nodes}`;
  // панель инструментов
  const tb = document.getElementById('fm-tb');
  if (tb && !tb.dataset.k) {
    tb.dataset.k = '1';
  }
  if (tb) tb.innerHTML = `<b>Карта подключений</b>${d.spaces.length ? `<button type="button" class="fm-pill" aria-pressed="${FM.space === 'all'}" data-on-click="fmSpace" data-a-click='["all"]'>Все</button>${d.spaces.map((s, i) => `<button type="button" class="fm-pill" aria-pressed="${FM.space === s.uid}" data-on-click="fmSpace" data-a-click="${esc(JSON.stringify([`${esc(s.uid)}`]))}"><i style="background:${FM_COL[i % FM_COL.length]}"></i>${esc(s.name)}</button>`).join('')}` : ''}
    <div class="fm-zoom"><button type="button" aria-label="Уменьшить" data-on-click="__h98">−</button><button type="button" aria-label="Увеличить" data-on-click="fmZoom" data-a-click='[1.25]'>+</button><button type="button" style="padding:0 10px;font-size:12.5px" data-on-click="fmReset">Сбросить раскладку</button><button type="button" style="padding:0 10px;font-size:12.5px" data-on-click="fmFit">Вместить</button></div>`;
  fmSide(d, route);
}
function fmSide(d, route) {
  const box = document.getElementById('fm-side'); if (!box) return;
  const le = FM.selLink != null ? d.edges[FM.selLink] : null;
  if (le) {
    const nm = id => d.nodes.find(x => x.id === id)?.name || id, src = le.from || le.a, dst = src === le.a ? le.b : le.a;
    const spIdx2 = {}; d.spaces.forEach((s, i) => { spIdx2[s.uid] = i; });
    const st = le.on === false ? '<span class="bad">нет связи</span>' : le.on === null ? '<span class="warn">нет данных</span>' : '<span class="ok">в сети</span>';
    box.innerHTML = `<div class="card"><div class="fm-sh"><b>${esc(nm(src))} ${le.from ? '→' : '—'} ${esc(nm(dst))}</b><code>${le.from ? 'подключается ' + esc(nm(src)) : 'направление неизвестно'}</code></div>
      ${le.from ? `<div class="fm-f"><span>Подключается</span><span>${esc(nm(src))}</span></div><div class="fm-f"><span>Принимает</span><span>${esc(nm(dst))}</span></div>` : ''}
      <div class="fm-f"><span>Состояние</span><span>${st}</span></div>
      <div class="fm-f"><span>Тип</span><span>${le.direct ? 'прямое подключение к вам' : 'между другими серверами'}</span></div>
      ${le.spaces.length ? `<div class="fm-sp"><span>Общие пространства</span>${le.spaces.map(u => { const sp = d.spaces.find(x => x.uid === u); return `<div><i style="background:${FM_COL[spIdx2[u] % FM_COL.length]}"></i><b>${esc(sp?.name || u)}</b></div>`; }).join('')}</div>` : ''}</div>
      <div class="fd-hint" style="padding:0 4px">Подключается тот сервер, где вводили ключ активации: он сам открывает соединение (поэтому ему не нужен открытый адрес), и все события идут по нему в обе стороны.${le.from ? '' : ' Сервер на другом конце ещё не обновлён и направление не сообщает.'}</div>`;
    return;
  }
  const n = d.nodes.find(x => x.id === FM.sel) || d.nodes[0]; if (!n) { box.innerHTML = ''; return; }
  const spIdx = {}; d.spaces.forEach((s, i) => { spIdx[s.uid] = i; });
  const status = n.self ? 'это ваш сервер' : n.paused ? 'приостановлено' : n.online === true ? 'в сети' : n.online === false ? 'нет связи' : 'нет данных';
  const stc = n.self ? '' : n.online === true ? 'ok' : n.online === false ? 'bad' : 'warn';
  const names = route.ids.map(id => d.nodes.find(x => x.id === id)?.name || id);
  const f = [`<div class="fm-f"><span>Статус</span><span class="${stc}">${status}</span></div>`, `<div class="fm-f"><span>Людей в общих пространствах</span><span>${n.people}</span></div>`];
  if (n.ver) f.push(`<div class="fm-f"><span>Версия сервера</span><span class="fd-mono">${esc(n.ver)}</span></div>`);
  if (!n.self) {
    f.push(`<div class="fm-f"><span>Канал</span><span>${n.direct ? 'напрямую' : route.ids.length ? 'через ' + (route.ids.length - 2) + ' ' + uxPlural(route.ids.length - 2, 'сервер', 'сервера', 'серверов') + ', шифруется сквозным' : '—'}</span></div>`);
    if (route.ids.length && !n.direct) f.push(`<div class="fm-f"><span>Маршрут</span><span>${names.map(esc).join(' → ')}</span></div>`);
    f.push(`<div class="fm-f"><span>Ключ</span><span class="${n.verified ? 'ok' : 'warn'}">${n.direct ? 'проверен при подключении' : n.verified ? 'проверен вами' : 'не проверен'}</span></div>`);
  }
  const memb = n.spaces.length ? `<div class="fm-sp"><span>В общих пространствах</span>${n.spaces.map(s => { const sp = d.spaces.find(x => x.uid === s.uid); return `<div><i style="background:${FM_COL[spIdx[s.uid] % FM_COL.length]}"></i><b>${esc(sp?.name || s.uid)}</b><span style="color:var(--c-text2)">${sp && sp.host === n.id ? 'хозяин · ' : ''}${s.people} ${fdPlural(s.people)}</span></div>`; }).join('')}</div>` : '';
  box.innerHTML = `<div class="card"><div class="fm-sh"><b>${esc(n.name)}</b><code>${esc(n.id)}</code></div>${f.join('')}${memb}${n.fp ? `<div class="fm-f"><span>Отпечаток</span><span class="fd-mono" style="font-size:11.5px">${esc(n.fp)}</span></div>` : ''}
    ${!n.self && !n.verified ? `<div class="fm-ac"><button class="btn btn-ghost btn-sm" data-on-click="fmVerify" data-a-click="${esc(JSON.stringify([`${esc(n.id)}`]))}">Сверить отпечаток</button></div>` : ''}</div>
    ${!n.self && !n.direct && !n.verified ? '<div class="fd-hint" style="padding:0 4px">Ключ получен через хозяина пространства. Сверьте отпечаток с администратором этого сервера по телефону или лично: тогда промежуточные серверы не смогут подменить ключ.</div>' : ''}`;
}
function fmVerify(id) {
  const n = FM.data?.nodes.find(x => x.id === id); if (!n) return;
  fdModal('Сверка отпечатка', `<div class="fd-kv"><span>Сервер</span><b>${esc(n.name)}</b></div><div class="fd-fp">${esc(n.fp)}</div><div class="fd-hint">Попросите администратора этого сервера показать отпечаток его ключа (раздел «Федерации», вкладка «Подключения») и сверьте с этим по телефону или лично.</div>
    <label class="fd-chk"><input type="checkbox" id="fm-sure" data-on-change="__h99"> Отпечаток совпал</label>`,
    `${fdCancel}<button class="btn ux-solid" id="fm-go" disabled data-on-click="fmVerifyDo" data-a-click="${esc(JSON.stringify([`${esc(id)}`]))}">Отметить проверенным</button>`);
}
async function fmVerifyDo(id) {
  const r = await api('POST', '/api/admin/federation/verify', { instance: id });
  closeModal('modal-fed');
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось'), 'error'); return; }
  toast('Ключ отмечен как проверенный', 'success');
  await fmLoad(); fmDraw();
}
function fmSpace(u) { FM.space = u; fmDraw(); }
function fmReset() { FM.pos = {}; try { localStorage.removeItem('fm-pos'); } catch {} fmDraw(); fmFit(); }
function fmFit() {
  const d = FM.data, st = document.getElementById('fm-stage'); if (!d || !st || !d.nodes.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  d.nodes.forEach(n => { const p = fmP(n.id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + FM_W); y1 = Math.max(y1, p.y + FM_H); });
  const w = st.clientWidth, h = st.clientHeight, pad = 70;
  const k = Math.max(0.3, Math.min(0.75, (w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2 - 40) / Math.max(1, y1 - y0)));
  FM.k = k; FM.tx = (w - (x1 - x0) * k) / 2 - x0 * k; FM.ty = (h - 40 - (y1 - y0) * k) / 2 - y0 * k + 6;
  const world = document.getElementById('fm-world'); if (world) world.style.transform = `translate(${FM.tx}px,${FM.ty}px) scale(${FM.k})`;
}
function fmZoom(f, cx, cy) {
  const st = document.getElementById('fm-stage'); if (!st) return;
  const r = st.getBoundingClientRect();
  cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const k = Math.max(0.25, Math.min(2.5, FM.k * f)), real = k / FM.k;
  FM.tx = cx - (cx - FM.tx) * real; FM.ty = cy - (cy - FM.ty) * real; FM.k = k;
  const world = document.getElementById('fm-world'); if (world) world.style.transform = `translate(${FM.tx}px,${FM.ty}px) scale(${FM.k})`;
}
function fmWheel(e) {
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  fmZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
}
function fmDown(e) {
  if (e.button !== 0) return;
  const st = e.currentTarget, nodeEl = e.target.closest('.fm-n');
  try { st.setPointerCapture(e.pointerId); } catch {}
  if (nodeEl) {
    const id = nodeEl.dataset.id, p = fmP(id), r = st.getBoundingClientRect();
    FM.drag = { id, ox: (e.clientX - r.left - FM.tx) / FM.k - p.x, oy: (e.clientY - r.top - FM.ty) / FM.k - p.y, sx: e.clientX, sy: e.clientY, moved: false };
  } else {
    FM.drag = { pan: true, sx: e.clientX, sy: e.clientY, tx: FM.tx, ty: FM.ty, moved: false };
    st.classList.add('pan');
  }
}
function fmMove(e) {
  const dr = FM.drag; if (!dr) return;
  if (Math.abs(e.clientX - dr.sx) + Math.abs(e.clientY - dr.sy) > 4) dr.moved = true;
  if (!dr.moved) return;
  const st = e.currentTarget;
  if (dr.pan) {
    FM.tx = dr.tx + e.clientX - dr.sx; FM.ty = dr.ty + e.clientY - dr.sy;
    const world = document.getElementById('fm-world'); if (world) world.style.transform = `translate(${FM.tx}px,${FM.ty}px) scale(${FM.k})`;
    return;
  }
  const r = st.getBoundingClientRect();
  FM.pos[dr.id] = { x: Math.round((e.clientX - r.left - FM.tx) / FM.k - dr.ox), y: Math.round((e.clientY - r.top - FM.ty) / FM.k - dr.oy) };
  if (!FM._raf) FM._raf = requestAnimationFrame(() => { FM._raf = 0; fmReposition(); });
}
function fmUp(e) {
  const dr = FM.drag; if (!dr) return;
  e.currentTarget.classList.remove('pan');
  FM.drag = null;
  if (dr.pan) {
    // нажатие по линии (без сдвига) выбирает связь
    if (!dr.moved) { const t = document.elementFromPoint(e.clientX, e.clientY), hit = t && t.closest && t.closest('.fm-hit'); if (hit) { FM.selLink = +hit.dataset.i; fmDraw(); } }
    return;
  }
  if (dr.moved) { try { localStorage.setItem('fm-pos', JSON.stringify(FM.pos)); } catch {} }
  else { FM.sel = dr.id; FM.selLink = null; }
  fmDraw();
}

/* ── МОДУЛИ ── */
// Необязательные возможности клиента. Включённый здесь модуль становится доступен пользователям в настройках
// клиента (у кого выключен — модуля нет вовсе), остальное решает сам пользователь на каждом устройстве.
// Журнал: кто и когда включил, выключил, начал загрузку или получил ошибку; хранится год.
const MOD = { list: [], draft: '', show: false, editing: false, checking: false, check: null, busy: false };
const mdNum = n => Number(n || 0).toLocaleString('ru-RU');
const mdBytes = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.round(b / 1024) + ' КБ';
async function renderModules() {
  setTopbarActions('');
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>`;
  const data = await api('GET', '/api/admin/modules');
  if (currentPage !== 'modules') return;
  MOD.list = Array.isArray(data) ? data : [];
  mdRender();
}
function mdRender() {
  if (currentPage !== 'modules') return;
  document.getElementById('page-body').innerHTML = `<div class="ux-page">
    <div><div style="font-size:17px;font-weight:700">Модули</div><div style="margin-top:2px;font-size:12.5px;color:var(--c-text2)">Дополнительные возможности. Включённый модуль становится доступен пользователям в настройках клиента, и каждый включает его у себя сам.</div></div>
    ${MOD.list.map(m => { const st = m.stats || {}, bc = st.byClient || {};
      return `<div class="card"><div class="mdl-card"><div class="mdl-ico${/^[A-Za-z]/.test(m.icon || '') ? ' t' : ''}">${esc(m.icon || '🧩')}</div>
        <div class="mdl-tx"><b>${esc(m.title)}</b><span>${esc(m.description)}${m.needsDownload ? ` Набор: ${mdNum(m.count)} файлов, около ${mdBytes(m.bytes)}, лежит на сервере.` : ''}</span></div>
        <span class="badge ${m.enabled ? 'badge-green' : 'badge-gray'}">${m.enabled ? 'Включён' : 'Выключен'}</span>
        <button class="btn btn-ghost btn-sm" data-on-click="mlOpen" data-a-click="${esc(JSON.stringify([`${m.key}`]))}">Журнал</button>
        <label class="toggle-switch" title="${m.config && !m.config.hasKey ? 'Сначала сохраните API-ключ' : 'Модуль на сервере'}"><input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.config && !m.config.hasKey ? 'disabled' : ''} data-on-change="mdToggle" data-a-change="${esc(JSON.stringify([`${m.key}`, "__checked"]))}" aria-label="Модуль включён на сервере"><span class="toggle-track"><span class="toggle-thumb"></span></span></label></div>
        ${m.config ? mdKeyBlock(m) : ''}
        <div class="mdl-stats"><div><b>${mdNum(st.users)} из ${mdNum(st.total)}</b><span>пользователей включили у себя</span></div>
          <div><b>${mdNum(bc.electron)} · ${mdNum(bc.web)} · ${mdNum(bc.mobile)}</b><span>Electron · веб · мобильный</span></div>
          ${m.needsDownload ? `<div><b>${mdNum(m.version)}</b><span>версия набора, устройств на старой: ${mdNum(st.outdated)}</span></div>
          <div><b>${mdNum(st.errors30d)}</b><span>ошибок загрузки за 30 дней</span></div>` : ''}</div></div>`; }).join('')}
    <div class="card"><div class="mdl-empty">${MOD.list.length ? 'Других модулей пока нет' : 'Модулей пока нет'}</div></div></div>`;
}
// ── Ключ API сервиса (модуль «GIF» от Klipy) ──
const MD_EYE = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const MD_EYE_OFF = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
function mdKeyBlock(m) {
  const c = m.config, name = esc(m.provider || 'сервиса');
  const body = c.hasKey && !MOD.editing
    ? `<div class="mdk-row"><div class="mdk-inp" style="max-width:340px"><input value="••••••••••••••••${esc(c.tail)}" readonly aria-label="Сохранённый ключ"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-on-click="mdKeyReplace">Заменить</button>
        <button type="button" class="btn btn-ghost btn-sm" ${MOD.checking ? 'disabled' : ''} data-on-click="mdKeyCheck">${MOD.checking ? 'Проверяем…' : 'Проверить ключ'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-on-click="mdKeyDelete">Удалить</button></div>
        <div class="mdk-kv"><span>Сохранён, виден только конец: <code>…${esc(c.tail)}</code></span>${MOD.check === 'ok' ? '<span class="mdk-ok">Ключ работает</span>' : MOD.check === 'limit' ? '<span class="mdk-ok">Ключ верный, но лимит запросов исчерпан</span>' : MOD.check === 'bad' ? `<span class="mdk-bad">${name} не принял ключ</span>` : MOD.check === 'net' ? '<span class="mdk-bad">Нет связи с сервисом</span>' : ''}</div>`
    : `<div class="mdk-row"><div class="mdk-inp"><input id="md-key" type="${MOD.show ? 'text' : 'password'}" value="${esc(MOD.draft)}" placeholder="Вставьте ключ из кабинета ${name}" autocomplete="off" spellcheck="false" aria-label="API-ключ ${name}" data-on-input="mdKeyInput" data-a-input='["__value"]' data-on-keydown="__h100">
        <button type="button" class="mdk-eye" aria-label="${MOD.show ? 'Скрыть' : 'Показать'}" data-on-click="mdKeyEye">${MOD.show ? MD_EYE_OFF : MD_EYE}</button></div>
        <button type="button" class="btn btn-primary btn-sm" id="md-key-save" ${MOD.draft.trim().length < 8 || MOD.busy ? 'disabled' : ''} data-on-click="mdKeySave">Сохранить</button>${c.hasKey ? '<button type="button" class="btn btn-ghost btn-sm" data-on-click="mdKeyCancel">Отмена</button>' : ''}</div>
        <div class="mdk-kv"><span>Ключ создаётся в разделе API Keys кабинета ${name}. <a class="mdk-lnk" href="https://partner.klipy.com/" target="_blank" rel="noopener">Открыть кабинет</a></span></div>`;
  return `<div class="mdk"><div class="mdk-h"><b>API-ключ ${name} <button type="button" class="mdk-i" data-on-click="openModal" data-a-click='["modal-klipy"]' aria-label="Как получить ключ" title="Как получить ключ">i</button></b><span>Сервер хранит ключ и выдаёт его клиентам при включении модуля.</span></div>
      <div>${body}
        <div class="mdk-note"><b>!</b><div>Тестовый ключ ограничен <strong>100 запросами в час</strong> на всех пользователей сразу. Для команды запросите Production в кабинете ${name}: раздел API Keys, затем «Request production».</div></div></div></div>
    <div class="mdk"><div class="mdk-h"><b>Условия ${name}</b><span>Действуют независимо от настроек чата.</span></div>
      <div class="mdk-facts"><div>Поиск и картинки идут напрямую между устройством и ${name}, через сервер чата не проходят</div>
        <div>Присланные GIF видны всем, а искать и отправлять могут те, кто включил модуль у себя</div>
        <div>Фильтр запрещённых слов и тем настраивается в кабинете ${name}, не здесь</div>
        <div>В секретных чатах модуль не работает</div></div></div>`;
}
function mdKeyInput(v) { MOD.draft = v; const b = document.getElementById('md-key-save'); if (b) b.disabled = v.trim().length < 8 || MOD.busy; }
function mdKeyEye() { MOD.show = !MOD.show; mdRender(); document.getElementById('md-key')?.focus(); }
function mdKeyReplace() { MOD.editing = true; MOD.draft = ''; MOD.show = false; mdRender(); document.getElementById('md-key')?.focus(); }
function mdKeyCancel() { MOD.editing = false; MOD.draft = ''; mdRender(); }
async function mdKeySave() {
  const v = MOD.draft.trim();
  if (v.length < 8 || MOD.busy) return;
  MOD.busy = true;
  let r; try { r = await api('PUT', '/api/admin/modules/gif/key', { key: v }); } catch { r = null; }
  MOD.busy = false;
  if (!r || r.error) { toast(esc(r?.error || 'Не удалось сохранить ключ'), 'error'); mdRender(); return; }
  MOD.draft = ''; MOD.show = false; MOD.editing = false; MOD.check = null;
  toast('Ключ сохранён', 'success'); renderModules();
}
function mdKeyDelete() {
  confirm('Удалить ключ?', 'Модуль будет выключен: без ключа искать и отправлять GIF нельзя. Присланные GIF останутся видны.', async () => {
    const r = await api('DELETE', '/api/admin/modules/gif/key');
    if (r?.error) { toast(esc(r.error), 'error'); return; }
    MOD.check = null; toast('Ключ удалён, модуль выключен', 'success'); renderModules();
  });
}
// Проверка с устройства администратора: по условиям Klipy запросы идут не через наш сервер
async function mdKeyCheck() {
  if (MOD.checking) return;
  MOD.checking = true; MOD.check = null; mdRender();
  try {
    const k = await api('GET', '/api/admin/modules/gif/key');
    const r = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(k.key || '')}/gifs/trending?per_page=8&customer_id=admin-check`);
    MOD.check = r.ok ? 'ok' : r.status === 429 ? 'limit' : 'bad';
  } catch { MOD.check = 'net'; }
  MOD.checking = false; mdRender();
}
async function mdToggle(key, on) {
  try {
    const r = await api('PUT', '/api/admin/modules/' + key, { enabled: on });
    if (r && r.error) toast(r.error, 'error'); else toast(on ? 'Модуль включён' : 'Модуль выключен', 'success');
  } catch { toast('Не удалось изменить модуль', 'error'); }
  renderModules();
}
const ML = { key: null, event: 'all', client: 'all', days: '30', q: '', rows: [], total: 0, timer: null };
const ML_EV = { admin_on: ['Модуль включён', 'badge-blue'], admin_off: ['Модуль выключен', 'badge-gray'], user_on: ['Включил у себя', 'badge-green'], user_off: ['Выключил у себя', 'badge-gray'], download_start: ['Загрузка начата', 'badge-orange'], download_error: ['Ошибка загрузки', 'badge-red'], update_start: ['Обновление начато', 'badge-orange'], update_error: ['Ошибка обновления', 'badge-red'] };
const ML_CL = { electron: 'Electron', web: 'Веб', mobile: 'Мобильный', admin: 'Админка' };
function mlOpen(key) {
  ML.key = key; ML.event = 'all'; ML.client = 'all'; ML.days = '30'; ML.q = '';
  document.getElementById('ml-event').value = 'all'; document.getElementById('ml-client').value = 'all'; document.getElementById('ml-days').value = '30'; document.getElementById('ml-q').value = '';
  document.getElementById('modlog-title').textContent = 'Журнал: ' + (MOD.list.find(m => m.key === key)?.title || key);
  openModal('modal-modlog'); mlLoad(true);
}
function mlSet(k, v) { ML[k] = v; mlLoad(true); }
function mlSearch(v) { ML.q = v; clearTimeout(ML.timer); ML.timer = setTimeout(() => mlLoad(true), 250); }
function mlMore() { mlLoad(false); }
async function mlLoad(reset) {
  if (reset) { ML.rows = []; ML.total = 0; }
  const qs = new URLSearchParams({ event: ML.event, client: ML.client, days: ML.days, q: ML.q, offset: ML.rows.length, limit: 50 });
  let r; try { r = await api('GET', `/api/admin/modules/${ML.key}/log?${qs}`); } catch { r = null; }
  if (!r || r.error) { document.getElementById('modlog-body').innerHTML = '<div class="mdl-empty">Не удалось загрузить журнал</div>'; return; }
  ML.rows = ML.rows.concat(r.rows || []); ML.total = r.total || 0;
  const fmt = ts => new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('modlog-body').innerHTML = ML.rows.length
    ? `<table><thead><tr><th>Время</th><th>Пользователь</th><th>Клиент</th><th>Событие</th></tr></thead><tbody>${ML.rows.map(x => { const ev = ML_EV[x.event] || [x.event, 'badge-gray'];
        return `<tr><td class="tm">${fmt(x.created_at)}</td><td>${esc(x.display_name || x.username || '—')}</td><td>${esc((ML_CL[x.client] || x.client || '—') + (x.version ? ' ' + x.version : ''))}</td><td><span class="badge ${ev[1]}">${esc(ev[0])}</span>${x.detail ? ` <span style="color:var(--c-muted);font-size:11.5px">${esc(x.detail)}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>`
    : '<div class="mdl-empty">Нет записей по фильтру</div>';
  document.getElementById('modlog-count').textContent = `${ML.rows.length} из ${ML.total} записей, журнал хранится ${(MOD.list.find(m => m.key === ML.key)?.keepDays || 365) >= 365 ? '12 месяцев' : ''}`;
  document.getElementById('modlog-more').style.display = ML.rows.length < ML.total ? '' : 'none';
}


/* ── FILES ── */
// Раздел «Файлы»: сводка по месту и сроку хранения, фильтры по типу; отправитель и чат —
// выпадающими списками. Картинку можно открыть прямо здесь, удалить — по одному или разом.

const FL = { filter: 'all', q: '', who: '', chat: '', sort: 'date', open: new Set(), fresh: null, sel: new Set(), files: [], lifetime: 0 };
const flSvg = p => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const FL_I = {
  eye: flSvg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  down: flSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
};
const FL_PLAY = '<span class="fl-play"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg></span>';
const FL_EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  doc: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'md'],
};
const FL_KIND = { image: ['Картинка', '#0f9e8e'], doc: ['Документ', '#5b6cf0'], video: ['Видео', '#c2478a'], other: ['Файл', '#d98a0b'], encrypted: ['Зашифровано', '#8a97a8'] };
const FL_BIG = 20 * 1048576;
const flExt = f => (String(f.filename).includes('.') ? String(f.filename).split('.').pop() : '').toLowerCase();
function flKind(f) {
  if (f.encrypted) return 'encrypted';
  const mime = f.mime || '', ext = flExt(f);
  if (mime.startsWith('image/') || FL_EXT.image.includes(ext)) return 'image';
  if (mime.startsWith('video/') || FL_EXT.video.includes(ext)) return 'video';
  if (FL_EXT.doc.includes(ext)) return 'doc';
  return 'other';
}
const flUrl = name => '/files/' + encodeURIComponent(name);
const flShort = name => name.length > 42 ? name.slice(0, 40) + '…' : name;
// Имя на диске — служебное (метка времени + случайный суффикс), человеку показываем
// то, что он реально загрузил; у файлов без сообщения оригинала не сохранилось
const flName = f => f.encrypted ? 'Зашифрованный файл' : (f.name || f.filename);
const flChatChip = type => type === 'direct' ? '<span class="rm-chip rm-direct">личный</span>'
  : type === 'group' ? '<span class="rm-chip rm-group">группа</span>' : type === 'room' ? '<span class="rm-chip rm-topics">комната</span>' : '';

// ── АУДИТ-ЛОГ ──
// Один запрос, дальше фильтр по категории и поиск — на клиенте (как у «Файлов»).
const AL = { all: [], category: 'all', q: '', open: new Set(), fresh: null };
const RE = { f: 'all', q: '', open: new Set(), fresh: null, list: [], first: true };
function alFilter(cat) { AL.category = cat; alRender(); }
function alSearch(q) { AL.q = q; alRender(); }
function alTimeLabel(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const label = diff === 0 ? 'сегодня' : diff === 1 ? 'вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${time}<small>${label}</small>`;
}
async function renderAudit() {
  setTopbarActions('');
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>`;
  const data = await api('GET', '/api/admin/audit-log');
  if (currentPage !== 'audit') return;
  AL.all = Array.isArray(data) ? data : [];
  alRender();
}
const AL_CAT = { moderation: 'Модерация', rooms: 'Комнаты и чаты', server: 'Сервер', security: 'Безопасность' };
const alClock = ts => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function alDayLabel(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? 'Сегодня' : diff === 1 ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function alRender() {
  if (currentPage !== 'audit') return;
  const page = document.getElementById('page-body');
  const q = AL.q.trim().toLowerCase();
  const rows = AL.all
    .filter(r => AL.category === 'all' || r.category === AL.category)
    .filter(r => !q || [r.actor_name, r.action, r.target].some(x => (x || '').toLowerCase().includes(q)));
  const count = cat => AL.all.filter(r => cat === 'all' || r.category === cat).length;
  const nowS = Math.floor(Date.now() / 1000), day = AL.all.filter(r => r.created_at >= nowS - 86400);
  const sec = day.filter(r => r.category === 'security');
  const per = {}; day.forEach(r => { if (r.actor_name) per[r.actor_name] = (per[r.actor_name] || 0) + 1; });
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  const hrs = Array.from({ length: 12 }, (_, i) => day.filter(r => Math.floor((nowS - r.created_at) / 7200) === 11 - i).length), hmax = Math.max(1, ...hrs);
  const last = AL.all[0];
  const cats = ['all', ...Object.keys(AL_CAT)];
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = k => `<button type="button" aria-pressed="${AL.category === k}" data-on-click="alFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${k === 'all' ? 'Все' : AL_CAT[k]}<span class="n">${count(k)}</span></button>`;
  let prev = '';
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="al-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Событий за сутки</div><div class="ub-big">${day.length}</div>
          <div class="rb-bars">${hrs.map((v, i) => `<div title="${v}"><i class="${i === 11 ? 'cur' : ''}" style="height:${Math.max(2, Math.round(v / hmax * 26))}px"></i><span>${i % 3 === 0 ? (12 - i) * 2 + 'ч' : ''}</span></div>`).join('')}</div></div>
        <button type="button" class="ub-tile" data-on-click="alFilter" data-a-click='["security"]' title="Показать события безопасности"><div class="ub-lbl">Безопасность</div><div class="ub-big" style="color:${sec.length ? 'var(--c-red-text)' : 'var(--c-green-text)'}">${sec.length}</div><div class="ub-sub">за сутки: входы, неудачные попытки, завершение сеансов</div></button>
        <div class="ub-tile static"><div class="ub-lbl">Самый активный</div>${top ? `<div class="ub-big" style="font-size:17px;line-height:1.3;margin-top:8px;font-family:var(--f-ui)">${esc(top[0])}</div><div class="ub-sub">${top[1]} ${uxPlural(top[1], 'действие', 'действия', 'действий')} за сутки</div>` : '<div class="ub-sub" style="margin-top:8px">за сутки действий не было</div>'}</div>
        <div class="ub-tile static"><div class="ub-lbl">Последнее</div>${last ? `<div class="ub-big" style="font-size:15px;line-height:1.3;margin-top:8px;font-family:var(--f-ui)">${esc(last.action)}</div><div class="ub-sub">${alClock(last.created_at)} · ${esc(last.actor_name || '—')}</div>` : '<div class="ub-sub" style="margin-top:8px">пока пусто</div>'}</div>
      </div>
      <div class="ub-head"><h3>Журнал <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Категория">${cats.map(flt).join('')}</div>
        ${uxSearch('al-q', AL.q, 'Кто, что, кого…', 'alSearch')}</div>
      <div class="ub-rows">${rows.map(r => {
        const open = AL.open.has(r.id ?? r.created_at + r.action), key = r.id ?? (r.created_at + r.action), d = alDayLabel(r.created_at), sep = d !== prev ? `<div class="al-day2">${esc(d)}</div>` : ''; prev = d;
        const cat = r.category || '';
        return `${sep}<div class="rb-row"><div class="pg-top" style="grid-template-columns:22px 60px minmax(0,1.2fr) minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,.8fr)" data-on-click="alTog" data-a-click="${esc(JSON.stringify([`${esc(String(key))}`]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть">${UX_I.chev}</button>
          <div class="al-tm2">${alClock(r.created_at)}</div>
          <div style="display:flex;align-items:center;gap:9px;min-width:0">${avHtml(r.actor_name || '?', 26, 8, r.actor_id, false, r.actor_has_avatar)}<span style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.actor_name || '—')}</span></div>
          <div style="min-width:0"><span class="al-t2 ${cat}">${esc(r.action)}</span></div>
          <div class="pg-h2 rb-meta" style="color:var(--c-text);font-size:12.5px">${esc(r.target || '—')}</div>
          <div class="pg-h1 rb-meta" style="font-family:var(--f-mono)">${esc(r.ip || '—')}</div></div>
        ${open ? `<div class="pg-exp" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div><h4>Кто</h4><b>${esc(r.actor_name || '—')}</b></div><div><h4>Над чем</h4><b>${esc(r.target || '—')}</b></div><div><h4>Откуда</h4><span style="font-family:var(--f-mono)">${esc(r.ip || '—')}</span> <span class="rb-meta">${/^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(r.ip || '') ? 'локальная сеть' : r.ip ? 'внешний адрес' : ''}</span></div><div><h4>Категория</h4><span class="al-t2 ${cat}">${esc(AL_CAT[cat] || cat || '—')}</span></div></div>` : ''}</div>`;
      }).join('') || `<div class="ub-empty">${AL.all.length ? 'Ничего не нашли' : 'Пока пусто'}</div>`}</div></div>`;
  });
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function alTog(key) {
  const rec = AL.all.find(r => String(r.id ?? (r.created_at + r.action)) === key);
  const k = rec ? (rec.id ?? (rec.created_at + rec.action)) : key;
  AL.open.has(k) ? AL.open.delete(k) : AL.open.add(k);
  alRender();
}

// ── РЕЛИЗЫ ──
// История версий из RELEASE_HISTORY.md (см. /api/admin/release-notes): сервер и клиент одним потоком,
// новые сверху, у каждой версии счётчики «Добавлено / Исправлено / Изменено». Только просмотр.
const RE_SEC = { 'Добавлено': ['add', 'var(--c-green)'], 'Исправлено': ['fix', 'var(--c-orange)'], 'Изменено': ['chg', 'var(--dv-c2)'] };
async function renderReleases() {
  setTopbarActions('');
  document.getElementById('page-body').innerHTML = `<div class="ux-page"><div class="ux-empty">Загрузка…</div></div>`;
  const data = await api('GET', '/api/admin/release-notes');
  if (currentPage !== 'releases') return;
  const mk = (list, k) => (Array.isArray(list) ? list : []).map(r => ({ ...r, k }));
  RE.list = [...mk(data?.server, 'server'), ...mk(data?.client, 'client')];
  if (RE.first) { RE.first = false; const f = RE.list[0]; if (f) RE.open.add(f.k + f.version); }
  reRender();
}
function reRender() {
  if (currentPage !== 'releases') return;
  const page = document.getElementById('page-body');
  const q = RE.q.trim().toLowerCase();
  const cnt = k => RE.list.filter(r => r.k === k).length;
  const rows = RE.list.filter(r => RE.f === 'all' || r.k === RE.f)
    .filter(r => !q || (r.version + ' ' + (r.sections || []).map(s => (s.items || []).join(' ')).join(' ')).toLowerCase().includes(q));
  const srv = RE.list.find(r => r.k === 'server'), cli = RE.list.find(r => r.k === 'client');
  const n = lab => RE.list.reduce((a, r) => a + (r.sections || []).filter(s => s.label === lab).reduce((x, s) => x + s.items.length, 0), 0);
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, c]) => `<button type="button" aria-pressed="${RE.f === k}" data-on-click="reFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${c}</span></button>`;
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="re-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Сервер</div><div class="ub-big">${srv ? esc(String(srv.version).replace(/^s/, '')) : '—'}</div><div class="ub-sub">${srv ? esc(srv.dateLabel) : 'релизов нет'}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Клиент (Electron)</div><div class="ub-big">${cli ? esc(String(cli.version).replace(/^c/, '')) : '—'}</div><div class="ub-sub">${cli ? esc(cli.dateLabel) : 'релизов нет'}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Релизов в истории</div><div class="ub-big">${RE.list.length}<small>${cnt('server')} сервера · ${cnt('client')} клиента</small></div>
          <div class="ub-stack">${Object.entries(RE_SEC).map(([l, c]) => `<i style="flex:${Math.max(1, n(l))};background:${c[1]}"></i>`).join('')}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Что менялось</div><div class="ub-leg" style="flex-direction:column;gap:6px;margin-top:10px">${Object.entries(RE_SEC).map(([l, c]) => `<span><i style="background:${c[1]}"></i>${l} <b style="margin-left:auto">${n(l)}</b></span>`).join('')}</div></div>
      </div>
      <div class="ub-head"><h3>История <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', RE.list.length], ['server', 'Сервер', cnt('server')], ['client', 'Клиент', cnt('client')]].map(flt).join('')}</div>
        ${uxSearch('re-q', RE.q, 'Версия или текст', 'reSearch')}</div>
      <div class="ub-rows">${rows.map(r => {
        const key = r.k + r.version, open = RE.open.has(key), secs = r.sections || [];
        return `<div class="rl"><div class="rl-h" data-on-click="reTog" data-a-click="${esc(JSON.stringify([`${esc(key)}`]))}"><button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть">${UX_I.chev}</button>
          <span class="rl-v ${r.k}">${esc(r.version)}</span><span class="rb-meta">${esc(r.dateLabel)}</span><span style="flex:1"></span>
          ${secs.map(s => { const c = (RE_SEC[s.label] || ['', 'var(--c-muted)'])[1]; return `<span class="pg-mini" style="background:color-mix(in srgb,${c} 16%,transparent);color:${c}">${esc(s.label)} ${s.items.length}</span>`; }).join('')}</div>
          ${open ? secs.map(s => `<div><div class="rl-sl ${(RE_SEC[s.label] || [''])[0]}">${esc(s.label)}</div><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') : `<div class="rl-pre">${esc(secs[0]?.items[0] || '')}</div>`}</div>`;
      }).join('') || `<div class="ub-empty">${RE.list.length ? 'Ничего не нашли.' : 'Пока пусто'}</div>`}</div></div>`;
  });
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function reTog(key) { RE.open.has(key) ? RE.open.delete(key) : RE.open.add(key); reRender(); }
function reFilter(k) { RE.f = k; reRender(); }
function reSearch(v) { RE.q = v; reRender(); }

async function renderFiles() {
  setTopbarActions('');
  const [files, settings] = await Promise.all([api('GET', '/api/admin/files'), api('GET', '/api/admin/settings')]);
  FL.files = Array.isArray(files) ? files : [];
  FL.lifetime = Number(settings?.upload_file_lifetime || 0);
  const nb = document.getElementById('nb-files');
  if (nb) nb.textContent = FL.files.length;
  const names = new Set(FL.files.map(f => f.filename));
  FL.sel.forEach(n => { if (!names.has(n)) FL.sel.delete(n); });
  flRender();
}

const flTs = f => f.sent_at || Math.floor((f.mtime || 0) / 1000);
// Сколько дней осталось до автоудаления; null — автоудаление выключено
const flLeftDays = f => FL.lifetime ? Math.max(0, Math.ceil((flTs(f) + FL.lifetime * 86400 - Date.now() / 1000) / 86400)) : null;
const FL_KIND_COLOR = { image: 'var(--dv-c1)', doc: 'var(--dv-c2)', video: 'var(--dv-c5)', other: 'var(--dv-c3)', encrypted: 'var(--dv-c4)' };

function flThumbHtml(f, kind) {
  const imgSrc = kind === 'image' ? flUrl(f.filename) : kind === 'video' ? f.thumb : null;
  return `<span class="fl-thumb" style="background:${FL_KIND[kind][1]}">${esc((flExt(f) || '?').slice(0, 4).toUpperCase())}${imgSrc ? `<img src="${esc(imgSrc)}" loading="lazy" alt="" data-on-error="this.remove">` : ''}${kind === 'video' ? FL_PLAY : ''}</span>`;
}

function flRender() {
  if (currentPage !== 'files') return;
  const page = document.getElementById('page-body');
  const q = FL.q.trim().toLowerCase();
  const rows = FL.files
    .filter(f => FL.filter === 'all' || (FL.filter === 'big' ? f.size > FL_BIG : flKind(f) === FL.filter))
    .filter(f => (!FL.who || f.sender_name === FL.who) && (!FL.chat || f.chat_name === FL.chat))
    .filter(f => !q || [flName(f), f.sender_name, f.chat_name].some(x => (x || '').toLowerCase().includes(q)))
    .sort((a, b) => FL.sort === 'size' ? (b.size || 0) - (a.size || 0) : FL.sort === 'name' ? flName(a).localeCompare(flName(b), 'ru', { numeric: true }) : flTs(b) - flTs(a));
  const total = FL.files.reduce((s, f) => s + (f.size || 0), 0);
  const bySender = {};
  FL.files.forEach(f => { if (f.sender_name) bySender[f.sender_name] = (bySender[f.sender_name] || 0) + (f.size || 0); });
  const top = Object.entries(bySender).sort((a, b) => b[1] - a[1])[0];
  const max = Math.max(1, ...FL.files.map(f => f.size || 0));
  const uniq = key => [...new Set(FL.files.map(f => f[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const count = k => FL.files.filter(f => k === 'big' ? f.size > FL_BIG : flKind(f) === k).length;
  const kinds = ['image', 'doc', 'video', 'other', 'encrypted'].map(k => [k, FL.files.filter(f => flKind(f) === k).length]).filter(x => x[1]);
  const biggest = FL.files.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  const soon = FL.lifetime ? FL.files.filter(f => flLeftDays(f) <= 3) : [], soonSize = soon.reduce((s, f) => s + (f.size || 0), 0);
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label]) => `<button type="button" aria-pressed="${FL.filter === k}" data-on-click="flFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${count2(k)}</span></button>`;
  const count2 = k => k === 'all' ? FL.files.length : count(k);
  const sortBtn = (k, label) => `<button type="button" aria-pressed="${FL.sort === k}" data-on-click="flSort" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}</button>`;
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="fl-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Файлов</div><div class="ub-big">${rmFmt(FL.files.length)}<small>во всех чатах</small></div>
          ${kinds.length ? `<div class="ub-stack">${kinds.map(k => `<i style="flex:${k[1]};background:${FL_KIND_COLOR[k[0]]}"></i>`).join('')}</div><div class="ub-leg">${kinds.map(k => `<span><i style="background:${FL_KIND_COLOR[k[0]]}"></i>${FL_KIND[k[0]][0]} <b>${k[1]}</b></span>`).join('')}</div>` : '<div class="ub-sub" style="margin-top:6px">файлов пока нет</div>'}</div>
        <div class="ub-tile static"><div class="ub-lbl">Занимают</div><div class="ub-big">${hmBytes(total)}</div><div class="ub-sub">${biggest ? `самый большой: ${esc(flShort(flName(biggest)))}, ${hmBytes(biggest.size || 0)}` : '—'}</div></div>
        <div class="ub-tile static"><div class="ub-lbl">Хранятся</div><div class="ub-big">${FL.lifetime ? `${FL.lifetime}<small>${uxPlural(FL.lifetime, 'день', 'дня', 'дней')}</small>` : 'всегда'}</div>
          <div class="ub-sub">${FL.lifetime ? (soon.length ? `скоро удалятся: ${soon.length} ${uxPlural(soon.length, 'файл', 'файла', 'файлов')}, ${hmBytes(soonSize)}` : 'в ближайшие 3 дня ничего не удалится') : 'автоудаление выключено'}</div>
          <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-on-click="flSettings">Настройки хранения</button></div></div>
        ${top ? `<button type="button" class="ub-tile" data-on-click="flWho" data-a-click="${esc(JSON.stringify([top[0]]))}" title="Показать его файлы"><div class="ub-lbl">Больше всего места</div><div class="ub-big" style="font-size:17px;line-height:1.3;margin-top:8px;font-family:var(--f-ui)">${esc(top[0])}</div><div class="ub-sub">${hmBytes(top[1])} · ${total ? Math.round(top[1] / total * 100) : 0}% всех файлов</div><div class="ub-meter"><i style="width:${total ? Math.round(top[1] / total * 100) : 0}%;background:var(--dv-c5)"></i></div></button>`
          : '<div class="ub-tile static"><div class="ub-lbl">Больше всего места</div><div class="ub-sub" style="margin-top:8px">пока нет</div></div>'}
      </div>
      <div class="ub-head"><h3>Файлы <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все'], ['image', 'Картинки'], ['doc', 'Документы'], ['video', 'Видео'], ['big', 'Больше 20 МБ']].map(flt).join('')}</div>
        <div class="ub-sort" role="group" aria-label="Сортировка">${sortBtn('date', 'По дате')}${sortBtn('size', 'По размеру')}${sortBtn('name', 'По имени')}</div>
        ${fselHtml('fl-who', 'Все отправители', uniq('sender_name'), FL.who, 'flWho')}
        ${fselHtml('fl-chat', 'Все чаты', uniq('chat_name'), FL.chat, 'flChat')}
        ${uxSearch('fl-q', FL.q, 'Имя файла', 'flSearch')}</div>
      <div class="ub-rows">${rows.map(f => {
        const kind = flKind(f), name = jesc(f.filename), open = FL.open.has(f.filename), openable = kind === 'image' || kind === 'video', ld = flLeftDays(f);
        const act = kind === 'encrypted' ? '<button class="btn btn-ghost btn-sm" disabled title="Вложение секретного чата — открыть нельзя">Зашифровано</button>'
          : `<button class="btn btn-ghost btn-sm" data-on-click="__h101" data-a-click="${esc(JSON.stringify([name]))}">${openable ? FL_I.eye + 'Открыть' : FL_I.down + 'Скачать'}</button>`;
        return `<div class="rb-row"><div class="fb-top" data-on-click="flTog" data-a-click="${esc(JSON.stringify(["__event", `${name}`]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть: ${esc(flName(f))}">${UX_I.chev}</button>
          <div class="fb-name">${flThumbHtml(f, kind)}<div style="min-width:0"><b title="${esc(flName(f))}">${esc(flShort(flName(f)))}</b><span class="rb-meta">${FL_KIND[kind][0]}</span></div></div>
          <div class="fb-sz">${hmBytes(f.size || 0)}<div class="meter"><i style="width:${Math.max(4, (f.size || 0) / max * 100)}%;background:${FL_KIND_COLOR[kind]}"></i></div></div>
          <div class="fb-sd">${f.sender_name ? `${avHtml(f.sender_name, 26, 8, f.sender_id, false, true)}<div style="min-width:0"><div class="l1">${esc(f.sender_name)}</div><div class="l2">${esc(f.chat_name || '—')}</div></div>` : `<div><div class="l1" style="font-weight:500;color:var(--c-muted)">без сообщения</div><div class="l2">${esc(f.chat_name || '—')}</div></div>`}</div>
          <div class="fb-when">${esc(uaSeen(flTs(f)))}${ld != null ? `<small class="${ld <= 3 ? 'w' : ''}">удалится через ${ld} ${uxPlural(ld, 'день', 'дня', 'дней')}</small>` : ''}</div>
          <div class="ux-actions">${act}<button class="ux-ibtn" aria-label="Ещё действия: ${esc(flName(f))}" aria-haspopup="menu" aria-expanded="false" data-on-click="__h102" data-a-click="${esc(JSON.stringify([name]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="fb-exp${FL.fresh === f.filename ? ' fresh' : ''}"><div><div class="fb-big" style="background:${FL_KIND[kind][1]}">${esc((flExt(f) || '?').toUpperCase())}${kind === 'image' ? `<img src="${esc(flUrl(f.filename))}" alt="" data-on-error="this.remove">` : kind === 'video' && f.thumb ? `<img src="${esc(f.thumb)}" alt="" data-on-error="this.remove">` : ''}</div></div>
          <div><h4>О файле</h4><div class="rb-kv"><div><span>Тип</span><b>${FL_KIND[kind][0]}${flExt(f) ? ', .' + esc(flExt(f)) : ''}</b></div><div><span>Размер</span><b>${hmBytes(f.size || 0)}</b></div><div><span>Отправил</span><b>${esc(f.sender_name || '—')}</b></div><div><span>Чат</span><b>${esc(f.chat_name || '—')}${flChatChip(f.chat_type)}</b></div><div><span>Когда</span><b>${esc(uaSeen(flTs(f)))}</b></div><div><span>Удалится</span><b>${ld != null ? `через ${ld} ${uxPlural(ld, 'день', 'дня', 'дней')}` : 'не удаляется'}</b></div></div></div>
          <div><h4>Действия</h4><div style="display:flex;flex-wrap:wrap;gap:8px">${kind === 'encrypted' ? '' : `${openable ? `<button class="btn btn-ghost btn-sm" data-on-click="flOpen" data-a-click="${esc(JSON.stringify([`${name}`]))}">${FL_I.eye}Открыть</button>` : ''}<button class="btn btn-ghost btn-sm" data-on-click="flDownload" data-a-click="${esc(JSON.stringify([`${name}`]))}">${FL_I.down}Скачать</button>`}${f.sender_name ? `<button class="btn btn-ghost btn-sm" data-on-click="flWho" data-a-click="${esc(JSON.stringify([f.sender_name]))}">Все файлы ${esc(f.sender_name.split(' ')[0])}</button>` : ''}<button class="btn btn-danger btn-sm" data-on-click="flDelete" data-a-click="${esc(JSON.stringify([['name']]))}">${UX_I.trash}Удалить</button></div>
            <div class="rm-sub" style="margin-top:10px">После удаления в чате на месте файла останется «Файл удалён».</div></div></div>` : ''}</div>`;
      }).join('') || `<div class="ub-empty">${FL.files.length ? 'Ничего не нашли. Проверьте запрос или фильтры.' : 'Файлов пока нет'}</div>`}</div></div>`;
  });
  FL.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
}
function flTog(e, name) {
  if (e.target.closest('.ux-actions')) return;
  if (FL.open.has(name)) { expCollapse(rowExp(e), () => { FL.open.delete(name); flRender(); }); return; }
  FL.open.add(name); FL.fresh = name;
  flRender();
}
function flSort(k) { FL.sort = k; flRender(); }

function flFilter(k) { FL.filter = k; FL.sel.clear(); flRender(); }
function flSearch(v) { FL.q = v; flRender(); }
function flWho(v) { FL.who = v || ''; FL.sel.clear(); flRender(); }
function flChat(v) { FL.chat = v || ''; FL.sel.clear(); flRender(); }
function flToggle(name) { FL.sel.has(name) ? FL.sel.delete(name) : FL.sel.add(name); flRender(); }
function flSelAll(on) { FL.files.forEach(f => on ? FL.sel.add(f.filename) : FL.sel.delete(f.filename)); flRender(); }
function flSettings() { openSettingsModal('attachments'); }

function flOpen(name) {
  const f = FL.files.find(x => x.filename === name);
  const kind = f && flKind(f);
  if (kind === 'encrypted') return;
  if (kind === 'image' || kind === 'video') openFilePreview(name);
  else flDownload(name);
}
function flDownload(name) {
  const f = FL.files.find(x => x.filename === name);
  if (f?.encrypted) return;
  const a = document.createElement('a');
  a.href = flUrl(name);
  a.download = f ? flName(f) : name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function flMenu(e, name) {
  const n = jesc(name);
  const f = FL.files.find(x => x.filename === name);
  const kind = f && flKind(f);
  const openItem = (kind === 'image' || kind === 'video')
    ? `<button role="menuitem" data-on-click="__h103" data-a-click="${esc(JSON.stringify([n]))}">${FL_I.eye}Открыть</button>` : '';
  const dlItem = kind === 'encrypted' ? '' : `<button role="menuitem" data-on-click="__h104" data-a-click="${esc(JSON.stringify([n]))}">${FL_I.down}Скачать</button>`;
  uxOpenMenu(e, 'fl' + name, `
    ${openItem}
    ${dlItem}
    <hr><button role="menuitem" class="danger" data-on-click="__h105" data-a-click="${esc(JSON.stringify([n]))}">${UX_I.trash}Удалить файл</button>`);
}
function flDelete(names) {
  if (!names.length) return;
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` и ещё ${names.length - 5}` : '');
  confirm(names.length > 1 ? `Удалить файлы · ${names.length}` : 'Удалить файл?',
    `${esc(shown)}\n\nФайлы исчезнут из чатов — на их месте останется «Файл удалён».`,
    async () => {
      const results = await Promise.all(names.map(n => api('DELETE', `/api/admin/files/${encodeURIComponent(n)}`)));
      const failed = results.filter(r => !r?.ok).length;
      toast(failed ? `Не удалось удалить: ${failed}` : names.length > 1 ? `Удалено файлов: ${names.length}` : 'Файл удалён', failed ? 'error' : 'success');
      FL.sel.clear();
      renderFiles();
      updateNavBadges();
    });
}

/* ── ВЫПАДАЮЩИЙ СПИСОК ФИЛЬТРА ── */
function fselHtml(id, placeholder, options, current, handler) {
  const opt = (value, label, active) =>
    `<button class="fsel-opt${active ? ' active' : ''}" data-value="${esc(value)}"` +
    ` data-on-click="fselPick" data-a-click="${esc(JSON.stringify([`${id}`, `${handler}`, `${value}`]))}">${esc(label)}</button>`;
  return `<div class="fsel" id="${id}" data-placeholder="${esc(placeholder)}">
    <button class="fsel-btn${current ? ' on' : ''}" data-on-click="fselToggle" data-a-click="${esc(JSON.stringify(["__event", `${id}`]))}">
      <span>${esc(current || placeholder)}</span>
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="fsel-pop" hidden>
      ${opt('', placeholder, !current)}
      ${options.map(o => opt(o, o, o === current)).join('')}
    </div>
  </div>`;
}

function fselToggle(e, id) {
  e.stopPropagation();
  const pop = document.querySelector(`#${id} .fsel-pop`);
  const open = pop.hidden;
  document.querySelectorAll('.fsel-pop').forEach(p => p.hidden = true);
  pop.hidden = !open;
}

function fselPick(id, handler, value) {
  const box = document.getElementById(id);
  const btn = box.querySelector('.fsel-btn');
  btn.querySelector('span').textContent = value || box.dataset.placeholder;
  btn.classList.toggle('on', !!value);
  box.querySelectorAll('.fsel-opt').forEach(o => o.classList.toggle('active', o.dataset.value === value));
  box.querySelector('.fsel-pop').hidden = true;
  window[handler]?.(value);
}

// Клик мимо закрывает открытый список
document.addEventListener('click', e => {
  if (!e.target.closest('.fsel')) document.querySelectorAll('.fsel-pop').forEach(p => p.hidden = true);
});

/* Вид чата рядом с названием: у личных своего имени нет, там имена собеседников */
function chatKindBadge(type) {
  if (type === 'direct') return ' <span class="badge badge-gray" style="margin-left:4px">личный</span>';
  if (type === 'group')  return ' <span class="badge badge-purple" style="margin-left:4px">группа</span>';
  if (type === 'room')   return ' <span class="badge badge-blue" style="margin-left:4px">комната</span>';
  return '';
}

/* ── ПРОСМОТР КАРТИНКИ И ВИДЕО ── */
function openFilePreview(name) {
  const f = FL.files.find(x => x.filename === name);
  const kind = f ? flKind(f) : 'image';
  const box = document.getElementById('file-lightbox');
  const img = document.getElementById('fl-img'), vid = document.getElementById('fl-vid');
  box.classList.remove('closing');
  box.classList.toggle('video', kind === 'video');
  if (kind === 'video') {
    img.src = '';
    vid.src = flUrl(name);
    vid.play().catch(() => {});
  } else {
    vid.pause(); vid.src = '';
    img.src = flUrl(name);
  }
  document.getElementById('fl-cap').textContent = f ? flName(f) : name;
  box.classList.add('open');
  // CSS-анимация появления объявлена статично на #file-lightbox (не через класс),
  // поэтому смена display:none→flex перезапускает её только один раз за всю жизнь
  // страницы — при повторных открытиях декларация animation не меняется, и браузер
  // её не перезапускает. Сбрасываем в none и форсим reflow, чтобы включалась каждый раз.
  [box, img, vid].forEach(el => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
}
function closeFilePreview() {
  const box = document.getElementById('file-lightbox');
  if (!box || !box.classList.contains('open') || box.classList.contains('closing')) return;
  box.classList.add('closing');
  document.getElementById('fl-vid')?.pause();
  setTimeout(() => {
    box.classList.remove('open', 'closing', 'video');
    document.getElementById('fl-img').src = '';
    const vid = document.getElementById('fl-vid');
    if (vid) vid.src = '';
  }, 150);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('file-lightbox')?.classList.contains('open')) closeFilePreview();
});

/* ── ANNOUNCEMENTS ── */
// Раздел «Объявления»: журнал с состоянием каждой записи — показывается, запланировано, прошло.
// Окно создания показывает, как объявление увидят люди: полоса, карточка или строка в ленте.

const ANN_KINDS = {
  chat:   { label: 'В чаты',      chip: 'rm-direct' },
  popup:  { label: 'Всплывающее', chip: 'rm-group' },
  banner: { label: 'Полоса',      chip: 'an-red' },
};
const ANN_HINTS = {
  chat:   'Строка от системы в группах и комнатах — останется в переписке',
  popup:  'Карточка поверх окна у тех, кто в сети в момент отправки',
  banner: 'Тонкая полоса сверху, держится заданное время и догоняет тех, кого не было в сети',
};
const AN = { filter: 'all', q: '', open: new Set(), fresh: null, sel: new Set(), list: [], form: null, chats: [] };
let annStartAt = null;   // unix-секунды или null = «сейчас»; его же меняет календарь
let _annTick = null;
const anSvg = p => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const AN_I = {
  bell: anSvg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  stop: anSvg('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
  eye: anSvg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
  x: anSvg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
};

function fmtDateTime(ts) {
  return ts ? new Date(ts*1000).toLocaleString('ru',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
}

// Остаток до конца показа: ч:мм:сс, а короче часа — мм:сс
function fmtLeft(sec) {
  const s = Math.max(0, sec);
  const p = n => String(n).padStart(2,'0');
  return s >= 3600 ? `${Math.floor(s/3600)}:${p(Math.floor(s%3600/60))}:${p(s%60)}` : `${p(Math.floor(s/60))}:${p(s%60)}`;
}

const anNow = () => Math.floor(Date.now() / 1000);
function anState(a) {
  if (!a.sent_at) return 'scheduled';
  return a.kind === 'banner' && a.expires_at > anNow() ? 'active' : 'past';
}
function anIn(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `через ${m} ${uxPlural(m, 'минуту', 'минуты', 'минут')}`;
  const h = Math.round(m / 60);
  if (h < 24) return `через ${h} ${uxPlural(h, 'час', 'часа', 'часов')}`;
  const d = Math.round(h / 24);
  return `через ${d} ${uxPlural(d, 'день', 'дня', 'дней')}`;
}
function anTargets(a) {
  if (a.target === 'all') return a.kind === 'chat' ? 'Все группы и комнаты' : 'Все';
  const names = a.target_names || [];
  if (a.target === 'spaces') return 'Пространства: ' + names.join(', ');
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` и ещё ${names.length - 3}` : '') || '—';
}

async function renderAnnouncements() {
  setTopbarActions('');
  const list = await api('GET', '/api/admin/announcements');
  AN.list = Array.isArray(list) ? list : [];
  const nb = document.getElementById('nb-announcements');
  if (nb) nb.textContent = AN.list.length;
  const ids = new Set(AN.list.map(a => a.id));
  AN.sel.forEach(id => { if (!ids.has(id)) AN.sel.delete(id); });
  anRender();
}

const AN_KI = {
  banner: '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  popup: '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
};
const AN_KCOLOR = { banner: 'var(--c-orange)', popup: 'var(--dv-c2)', chat: 'var(--dv-c1)' };
function anStatusHtml(a, now) {
  const st = anState(a);
  if (st === 'active') return `<div class="an-st"><span class="an-pill live">показывается</span>${anLeftHtml(a, now)}</div>`;
  if (st === 'scheduled') return `<div class="an-st"><span class="an-pill plan">запланировано</span><span class="rb-meta">${esc(fmtDateTime(a.start_at))} · ${anIn(a.start_at - now)}</span></div>`;
  return `<div class="an-st"><span class="an-pill done">отправлено</span><span class="rb-meta">${esc(fmtDateTime(a.sent_at))}</span></div>`;
}

function anRender() {
  if (currentPage !== 'announcements') return;
  const page = document.getElementById('page-body');
  const now = anNow(), q = AN.q.trim().toLowerCase();
  const by = s => AN.list.filter(a => anState(a) === s);
  const active = by('active'), sched = by('scheduled').sort((a, b) => a.start_at - b.start_at);
  const monthList = by('past').filter(a => a.sent_at >= now - 30 * 86400);
  const kinds = list => Object.keys(ANN_KINDS).map(k => [k, list.filter(a => a.kind === k).length]).filter(x => x[1]);
  const rows = AN.list.filter(a => AN.filter === 'all' || anState(a) === AN.filter)
    .filter(a => !q || (a.text || '').toLowerCase().includes(q) || (a.author_name || '').toLowerCase().includes(q));
  const first = active[0];
  const keepTop = page.querySelector('.ub-rows')?.scrollTop || 0;
  const flt = ([k, label, n]) => `<button type="button" aria-pressed="${AN.filter === k}" data-on-click="anFilter" data-a-click="${esc(JSON.stringify([`${k}`]))}">${label}<span class="n">${n}</span></button>`;
  const stackOf = list => { const k = kinds(list); return k.length ? `<div class="ub-stack">${k.map(x => `<i style="flex:${x[1]};background:${AN_KCOLOR[x[0]]}"></i>`).join('')}</div><div class="ub-leg">${k.map(x => `<span><i style="background:${AN_KCOLOR[x[0]]}"></i>${ANN_KINDS[x[0]].label} <b>${x[1]}</b></span>`).join('')}</div>` : ''; };
  uxKeepFocus(() => {
    page.innerHTML = `<div class="ub" id="an-page">
      <div class="ub-tiles">
        <div class="ub-tile static"><div class="ub-lbl">Активно сейчас</div><div class="ub-big">${active.length}<small>${active.length ? uxPlural(active.length, 'полоса', 'полосы', 'полос') : ''}</small></div>
          ${first ? `${anLeftHtml(first, now)}<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-on-click="anStop" data-a-click="${esc(JSON.stringify([first.id]))}">${AN_I.stop}Снять полосу</button></div>` : '<div class="ub-sub">сейчас ничего не показывается</div>'}</div>
        <div class="ub-tile static"><div class="ub-lbl">Запланировано</div><div class="ub-big">${sched.length}</div><div class="ub-sub">${sched[0] ? `ближайшее ${esc(fmtDateTime(sched[0].start_at))}, ${anIn(sched[0].start_at - now)}` : 'ничего не запланировано'}</div>${stackOf(sched)}</div>
        <div class="ub-tile static"><div class="ub-lbl">Отправлено за месяц</div><div class="ub-big">${monthList.length}<small>${uxPlural(monthList.length, 'объявление', 'объявления', 'объявлений')}</small></div>${stackOf(monthList) || '<div class="ub-sub">пока ничего</div>'}</div>
        <div class="ub-tile static" style="display:flex;flex-direction:column;justify-content:space-between"><div><div class="ub-lbl">Новое объявление</div><div class="ub-sub" style="margin-top:6px">Полоса сверху, карточка по центру или строка в чате. Можно запланировать на время.</div></div>
          <button class="btn ux-solid btn-sm" style="align-self:flex-start;margin-top:10px" data-on-click="openAnnouncementModal">${RM_I.plus}Создать</button></div>
      </div>
      <div class="ub-head"><h3>Объявления <span>${rows.length}</span></h3>
        <div class="ub-sort" role="group" aria-label="Фильтр">${[['all', 'Все', AN.list.length], ['active', 'Активные', active.length], ['scheduled', 'Запланированные', sched.length], ['past', 'Прошедшие', by('past').length]].map(flt).join('')}</div>
        ${uxSearch('an-q', AN.q, 'Текст или автор', 'anSearch')}</div>
      <div class="ub-rows">${rows.map(a => {
        const st = anState(a), k = ANN_KINDS[a.kind] || { label: a.kind }, open = AN.open.has(a.id);
        const meta = [[a.kind === 'chat' ? 'Куда' : 'Кому', anTargets(a)], [a.sent_at ? 'Отправлено' : 'Запланировано', fmtDateTime(a.sent_at || a.start_at)], ['Автор', a.author_name || '—']];
        if (a.kind === 'banner') { meta.push(['Показ', `${a.duration_min || 0} мин${st === 'active' ? `, осталось ${fmtLeft(a.expires_at - now)}` : st === 'past' ? ', завершён' : ''}`]); meta.push(['Закрыли', String(a.dismissed_count || 0)]); }
        return `<div class="rb-row"><div class="an-top" data-on-click="anTog" data-a-click="${esc(JSON.stringify(["__event", a.id]))}">
          <button class="rb-cv" aria-expanded="${open}" aria-label="Развернуть">${UX_I.chev}</button>
          <div class="fb-name"><div class="kt ${a.kind}">${AN_KI[a.kind] || ''}</div><div style="min-width:0"><div class="an-snip2">${esc(a.text || '')}</div><span class="rb-meta">${k.label}</span></div></div>
          <div class="an-to rb-meta" style="color:var(--c-text);font-size:12.5px" title="${esc((a.target_names || []).join(', '))}">${esc(anTargets(a))}</div>
          <div>${anStatusHtml(a, now)}</div>
          <div class="an-by fb-sd">${a.author_name ? `${avHtml(a.author_name, 24, 7, a.author_id, false, true)}<div class="l1">${esc(a.author_name.split(' ')[0])}</div>` : '<span class="rm-sub">—</span>'}</div>
          <div class="ux-actions"><button class="btn btn-ghost btn-sm" data-on-click="__h106" data-a-click="${esc(JSON.stringify([a.id]))}">${AN_I.eye}Открыть</button>
            <button class="ux-ibtn" aria-label="Ещё действия" aria-haspopup="menu" aria-expanded="false" data-on-click="__h107" data-a-click="${esc(JSON.stringify([a.id]))}">${UX_I.more}</button></div></div>
        ${open ? `<div class="an-exp${AN.fresh === a.id ? ' fresh' : ''}"><div><h4>Как это выглядит</h4>${anPreview(a.kind, a.text || '')}</div>
          <div><h4>Подробности</h4><div class="rb-kv">${meta.map(([n, v]) => `<div><span>${n}</span><b>${esc(v)}</b></div>`).join('')}</div></div>
          <div><h4>Действия</h4><div style="display:flex;flex-wrap:wrap;gap:8px">${st === 'active' ? `<button class="btn btn-ghost btn-sm" data-on-click="anStop" data-a-click="${esc(JSON.stringify([a.id]))}">${AN_I.stop}Снять полосу</button>` : ''}${st === 'scheduled' ? `<button class="btn btn-ghost btn-sm" data-on-click="anDelete" data-a-click="${esc(JSON.stringify([[a.id]]))}">${AN_I.x}Отменить отправку</button>` : ''}<button class="btn btn-ghost btn-sm" data-on-click="anResend" data-a-click="${esc(JSON.stringify([a.id]))}">${UX_I.refresh}Отправить снова</button><button class="btn btn-danger btn-sm" data-on-click="anDelete" data-a-click="${esc(JSON.stringify([[a.id]]))}">${UX_I.trash}Удалить</button></div>
            <div class="rm-sub" style="margin-top:10px">«Отправить снова» открывает новое объявление с тем же текстом${a.target === 'select' ? '; получателей нужно выбрать заново' : ''}.</div></div></div>` : ''}</div>`;
      }).join('') || `<div class="ub-empty">${AN.list.length ? 'Ничего не нашли. Проверьте запрос или фильтр.' : 'Объявлений пока не было'}</div>`}</div></div>`;
  });
  AN.fresh = null;
  const list = page.querySelector('.ub-rows');
  if (list && keepTop) list.scrollTop = keepTop;
  startAnnCountdown();
}
function anTog(e, id) {
  if (e.target.closest('.ux-actions')) return;
  if (AN.open.has(id)) { expCollapse(rowExp(e), () => { AN.open.delete(id); anRender(); }); return; }
  AN.open.add(id); AN.fresh = id;
  anRender();
}
// Новое объявление с теми же типом, текстом и длительностью; получателей из выборочного списка выбирают заново
async function anResend(id) {
  const a = AN.list.find(x => x.id === id);
  if (!a) return;
  await openAnnouncementModal();
  if (!AN.form) return;
  Object.assign(AN.form, { kind: a.kind, text: a.text || '', duration: a.duration_min || 60, pick: a.target === 'select' });
  anRenderForm('an-text');
}

function anLeftHtml(a, now) {
  const total = Math.max(1, (a.duration_min || 0) * 60), left = a.expires_at - now;
  return `<div class="an-left" data-until="${a.expires_at}" data-total="${total}"><span>ещё <b>${fmtLeft(left)}</b> из ${a.duration_min} мин</span>
    <div class="an-bar"><i style="width:${Math.min(100, left / total * 100)}%"></i></div></div>`;
}

// Обратный отсчёт у активных полос. Интервал гасит себя сам при уходе со страницы.
function startAnnCountdown() {
  clearInterval(_annTick);
  if (!AN.list.some(a => anState(a) === 'active')) return;
  _annTick = setInterval(() => {
    if (currentPage !== 'announcements') { clearInterval(_annTick); _annTick = null; return; }
    const now = anNow();
    let ended = false;
    document.querySelectorAll('.an-left, .an-sum-left').forEach(el => {
      const left = Number(el.dataset.until) - now;
      if (left <= 0) { ended = true; return; }
      const b = el.classList.contains('an-sum-left') ? el : el.querySelector('b');
      b.textContent = fmtLeft(left);
      const bar = el.querySelector('.an-bar i');
      if (bar) bar.style.width = Math.min(100, left / Number(el.dataset.total) * 100) + '%';
    });
    // Отсчёт кончился — перечитываем журнал, чтобы строка сменила состояние
    if (ended) renderAnnouncements();
  }, 1000);
}

function anFilter(k) { AN.filter = k; AN.sel.clear(); anRender(); }
function anSearch(v) { AN.q = v; anRender(); }
function anToggle(id) { AN.sel.has(id) ? AN.sel.delete(id) : AN.sel.add(id); anRender(); }
function anSelAll(on) { AN.list.forEach(a => on ? AN.sel.add(a.id) : AN.sel.delete(a.id)); anRender(); }
function anMenu(e, id) {
  const a = AN.list.find(x => x.id === id);
  if (!a) return;
  const st = anState(a);
  uxOpenMenu(e, 'an' + id, `
    <button role="menuitem" data-on-click="__h108" data-a-click="${esc(JSON.stringify([id]))}">${AN_I.eye}Открыть</button>
    ${st === 'active' ? `<button role="menuitem" data-on-click="__h109" data-a-click="${esc(JSON.stringify([id]))}">${AN_I.stop}Снять полосу</button>` : ''}
    ${st === 'scheduled' ? `<button role="menuitem" data-on-click="__h110" data-a-click="${esc(JSON.stringify([id]))}">${AN_I.x}Отменить отправку</button>` : ''}
    <hr><button role="menuitem" class="danger" data-on-click="__h110" data-a-click="${esc(JSON.stringify([id]))}">${UX_I.trash}Удалить</button>`);
}

// Превью по стилям веб-клиента: полоса, карточка поверх затемнённого окна, строка в ленте
function anPreview(kind, text) {
  const t = text ? esc(text) : '<span class="an-pv-ph">Текст появится здесь</span>';
  if (kind === 'banner') return `<div class="an-pv"><div class="an-pv-app"><i style="top:52px;width:46%"></i><i style="top:70px;width:62%"></i><i style="top:88px;width:38%"></i>
      <div class="an-pv-banner">${AN_I.bell}<span>${t}</span><b aria-hidden="true">×</b></div></div>
      <span class="ua-hint">Тонкая полоса сверху поверх окна — пока не истечёт время или человек её не закроет</span></div>`;
  if (kind === 'popup') return `<div class="an-pv"><div class="an-pv-app an-pv-dim"><i style="top:18px;width:40%"></i><i style="top:36px;width:58%"></i><i style="top:54px;width:34%"></i>
      <div class="an-pv-card"><div class="an-pv-title"><span class="an-pv-ring">${AN_I.bell}</span>Системное объявление</div><div class="an-pv-text">${t}</div><span class="an-pv-ok">OK</span></div></div>
      <span class="ua-hint">Карточка по центру поверх затемнённого окна — у тех, кто сейчас в сети; закрывается кнопкой OK</span></div>`;
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return `<div class="an-pv"><div class="an-pv-feed"><i style="width:44%"></i><div class="an-pv-sys">${AN_I.bell}<span>${t}</span><small>${time}</small></div><i style="width:30%;margin-left:auto"></i></div>
    <span class="ua-hint">Строка по центру ленты в выбранных группах и комнатах — остаётся в переписке</span></div>`;
}

/* ── Просмотр ── */
function anView(id) {
  const a = AN.list.find(x => x.id === id);
  if (!a) return;
  const st = anState(a), k = ANN_KINDS[a.kind] || { label: a.kind }, now = anNow();
  const meta = [[a.kind === 'chat' ? 'Куда' : 'Кому', a.target === 'all' ? anTargets(a) : (a.target_names || []).join(', ') || '—']];
  meta.push([a.sent_at ? 'Отправлено' : 'Запланировано', fmtDateTime(a.sent_at || a.start_at)]);
  if (a.kind === 'banner') {
    meta.push(['Показ', `${a.duration_min || 0} мин${st === 'active' ? `, осталось ${fmtLeft(a.expires_at - now)}` : st === 'past' ? ', завершён' : ''}`]);
    meta.push(['Закрыли', String(a.dismissed_count || 0)]);
  }
  document.getElementById('an-view-form').innerHTML = `
    <div class="ua-head">${avHtml(a.author_name || '?', 38, 10, a.author_id, false, true)}
      <div><div class="ua-title">Объявление · ${k.label}</div><div class="ua-sub">${esc(a.author_name || '—')} · ${esc(fmtDateTime(a.sent_at || a.start_at))}</div></div>
      <button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-ann-view"]'>✕</button></div>
    <div class="ua-body">${anPreview(a.kind, a.text)}
      <dl class="an-meta">${meta.map(([n, v]) => `<dt>${n}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    <div class="ua-foot"><button type="button" class="btn btn-danger btn-sm" data-on-click="__h111" data-a-click="${esc(JSON.stringify([a.id]))}">${UX_I.trash}Удалить</button><span class="ux-grow"></span>
      ${st === 'active' ? `<button type="button" class="btn btn-ghost" data-on-click="__h112" data-a-click="${esc(JSON.stringify([a.id]))}">${AN_I.stop}Снять полосу</button>` : ''}
      <button type="button" class="btn ux-solid" data-on-click="closeModal" data-a-click='["modal-ann-view"]'>Закрыть</button></div>`;
  openModal('modal-ann-view');
}

function anStop(id) {
  confirm('Снять полосу?', 'Полоса сразу исчезнет у всех, кто её видит. Запись останется в журнале.', async () => {
    const data = await api('POST', `/api/admin/announcements/${id}/stop`);
    if (data?.ok) { toast('Полоса снята', 'success'); renderAnnouncements(); }
    else toast(esc(data?.error || 'Не удалось снять полосу'), 'error');
  });
}

function anDelete(ids) {
  const list = AN.list.filter(a => ids.includes(a.id));
  if (!list.length) return;
  const st = list.map(anState);
  const hint = st.includes('active') ? 'Активная полоса сразу исчезнет у всех.'
    : st.every(s => s === 'scheduled') ? 'Запланированное не будет отправлено.'
    : 'Запись исчезнет из журнала. Уже отправленное у людей останется.';
  confirm(list.length > 1 ? `Удалить объявления · ${list.length}` : 'Удалить объявление?', hint, async () => {
    const results = await Promise.all(list.map(a => api('DELETE', `/api/admin/announcements/${a.id}`)));
    const failed = results.filter(r => !r?.ok).length;
    toast(failed ? `Не удалось удалить: ${failed}` : list.length > 1 ? `Удалено объявлений: ${list.length}` : 'Объявление удалено', failed ? 'error' : 'success');
    AN.sel.clear();
    renderAnnouncements();
  });
}

/* ── Создание ── */
async function openAnnouncementModal() {
  uxCloseMenu();
  const [chats, users] = await Promise.all([api('GET', '/api/admin/chats'), allUsersCache.length ? allUsersCache : api('GET', '/api/admin/users'), wsLoad()]);
  // Группы, комнаты и личные чаты; без тем и без секретных (их тексты зашифрованы)
  AN.chats = (Array.isArray(chats) ? chats : []).filter(c => !c.parent_id && !c.is_secret);
  if (Array.isArray(users)) allUsersCache = users;
  annStartAt = null;
  AN.form = { kind: 'chat', text: '', pick: false, sp: false, spSel: new Set(), who: new Set(), q: '', duration: 60, err: '', busy: false, more: false };
  PK.ctx = null;
  anRenderForm('an-text');
  openModal('modal-announcement');
}

const anMissing = f => {
  const m = [];
  if (!f.text.trim()) m.push('текст');
  if (f.pick && !f.who.size) m.push(f.kind === 'chat' ? 'чаты' : 'получателей');
  if (f.sp && !f.spSel.size) m.push('пространства');
  if (f.kind === 'banner' && !(Number(f.duration) > 0)) m.push('время показа');
  return m;
};
const anVerb = () => annStartAt ? 'Запланировать' : 'Отправить';
const anMore = id => { AN.form.more = id ? true : !AN.form.more; anRenderForm(); if (id) fmScroll('an-sec-' + id); };
// Подвал и превью обновляются на лету, без перерисовки формы: иначе пропадёт курсор в тексте
function anFootSync() {
  const f = AN.form; if (!f) return;
  const miss = anMissing(f), n = document.getElementById('an-note'), b = document.getElementById('an-go');
  if (n) { n.innerHTML = fmNote(miss); n.classList.toggle('ok', !miss.length); }
  if (b) { b.disabled = !!f.busy || !!miss.length; b.textContent = f.busy ? 'Отправляю…' : anVerb(); }
}
function anRenderForm(focusId) {
  const f = AN.form, el = document.getElementById('an-form');
  if (!f || !el) return;
  const chat = f.kind === 'chat', miss = anMissing(f);
  const quick = `<div class="ua-sec">
      <div class="an-kinds ua-roles" role="radiogroup" aria-label="Тип объявления">${Object.entries(ANN_KINDS).map(([k, v]) =>
        `<button type="button" class="ua-role-opt" role="radio" aria-checked="${f.kind === k}" data-on-click="anSet" data-a-click="${esc(JSON.stringify(["kind", `${k}`]))}"><b>${v.label}</b><span>${ANN_HINTS[k]}</span></button>`).join('')}</div>
      <div class="ua-field"><label for="an-text">Текст</label>
        <div class="ua-inp an-area"><textarea id="an-text" placeholder="Что сказать людям" data-on-input="__h113">${esc(f.text)}</textarea></div></div>
      <div class="ua-field fm-pv"><label>Так увидят</label><div id="an-pv">${anPreview(f.kind, f.text.trim())}</div></div></div>`;
  const whenSu = (annStartAt ? fmtDateTime(annStartAt) : 'Сейчас') + (f.kind === 'banner' ? ` · показывать ${f.duration} мин` : '');
  const audSu = f.sp ? (f.spSel.size ? `Пространства: ${f.spSel.size}` : 'Выберите пространства') : !f.pick ? (chat ? 'Во все группы и комнаты' : 'Всем') : f.who.size ? `Выбрано: ${f.who.size}` : (chat ? 'Выберите чаты' : 'Выберите получателей');
  const secs = [
    { id: 'w', t: 'Когда', su: whenSu, body: `<div class="ua-row2">
        <div class="ua-field"><label>Когда</label>
          <div class="dtp">
            <button type="button" class="dtp-field" data-on-click="dtpToggle" data-a-click='["__event"]'>
              <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
              <span class="dtp-val" id="dtp-val">${annStartAt ? esc(fmtDateTime(annStartAt)) : 'Сейчас'}</span>
              <span class="dtp-reset" id="dtp-reset" style="${annStartAt ? '' : 'display:none'}" data-on-click="__h114">✕</span>
            </button>
            <div class="dtp-pop" id="dtp-pop" hidden>
              <div class="dtp-head">
                <button type="button" class="dtp-nav" aria-label="Предыдущий месяц" data-on-click="dtpShiftMonth" data-a-click='[-1]'>‹</button>
                <div class="dtp-head-title" id="dtp-title"></div>
                <button type="button" class="dtp-nav" aria-label="Следующий месяц" data-on-click="dtpShiftMonth" data-a-click='[1]'>›</button>
              </div>
              <div class="dtp-grid" id="dtp-grid"></div>
              <div class="dtp-foot">
                <div class="dtp-time">
                  <input id="dtp-h" maxlength="2" inputmode="numeric" aria-label="Часы" data-on-input="dtpFixTime">:<input id="dtp-m" maxlength="2" inputmode="numeric" aria-label="Минуты" data-on-input="dtpFixTime">
                </div>
                <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-on-click="dtpReset">Сейчас</button>
                <button type="button" class="btn btn-primary btn-sm" data-on-click="dtpApply">Готово</button>
              </div>
            </div>
          </div></div>
        ${f.kind === 'banner' ? `<div class="ua-field"><label for="an-dur">Показывать, мин</label>
          <div class="ua-inp"><input id="an-dur" type="number" min="1" max="10080" value="${f.duration}" data-on-input="__h115"></div>
          <span class="ua-hint">Потом полоса исчезнет сама</span></div>` : '<div></div>'}</div>` },
    { id: 'a', t: chat ? 'Куда' : 'Кому', su: audSu, body: `<div class="an-seg"><button type="button" aria-pressed="${!f.pick && !f.sp}" data-on-click="anMode" data-a-click='["all"]'>${chat ? 'Во все группы и комнаты' : 'Всем'}</button>
        ${WS.list.length > 1 ? `<button type="button" aria-pressed="${f.sp}" data-on-click="anMode" data-a-click='["spaces"]'>По пространствам</button>` : ''}
        <button type="button" aria-pressed="${f.pick}" data-on-click="anMode" data-a-click='["pick"]'>${chat ? 'Выбрать чаты' : 'Выбрать людей'}</button></div>
      ${f.sp ? `<div class="ws-checks">${WS.list.map(w => `<label class="ua-check"><input type="checkbox" ${f.spSel.has(w.id) ? 'checked' : ''} data-on-change="anSp" data-a-change="${esc(JSON.stringify([w.id, "__checked"]))}">${esc(w.name)}<span>${w.users} ${uxPlural(w.users, 'человек', 'человека', 'человек')}</span></label>`).join('')}</div>
        <span class="ua-hint">${chat ? 'Строка появится в группах и комнатах, где есть люди из отмеченных пространств' : 'Объявление получат люди из отмеченных пространств'}</span>` : ''}
      ${f.pick ? pkSummary('ann', chat ? 'Выбрать чаты…' : 'Выбрать людей…') : ''}
      ${f.kind === 'popup' ? '<span class="ua-hint">Всплывающее увидят только те, кто сейчас в сети</span>' : ''}` },
  ];
  uaRestoreFocus(() => {
    el.innerHTML = `
      <div class="ua-head"><div><div class="ua-title">Новое объявление</div><div class="ua-sub">Тип, текст и куда отправить</div></div>
        <button type="button" class="modal-close" aria-label="Закрыть" data-on-click="closeModal" data-a-click='["modal-announcement"]'>✕</button></div>
      <div class="ua-body">${quick}${fmMoreHtml('an', f.more, 'anMore', secs)}</div>
      <div class="ua-foot">${f.err ? `<span class="ua-err">${esc(f.err)}</span>` : ''}<span class="fm-note ${miss.length ? '' : 'ok'}" id="an-note">${fmNote(miss)}</span>
        <button type="button" class="btn btn-ghost" data-on-click="closeModal" data-a-click='["modal-announcement"]'>Отмена</button>
        <button type="button" class="btn ux-solid" id="an-go" ${f.busy || miss.length ? 'disabled' : ''} data-on-click="sendAnnouncement">${f.busy ? 'Отправляю…' : anVerb()}</button></div>${pkSheet()}`;
  }, focusId);
}

function anMode(m) { const f = AN.form; f.pick = m === 'pick'; f.sp = m === 'spaces'; if (f.pick || f.sp) f.more = true; f.err = ''; anRenderForm(); }
function anSp(id, on) { const f = AN.form; on ? f.spSel.add(id) : f.spSel.delete(id); f.err = ''; anRenderForm(); }
function anSet(key, value) {
  const f = AN.form;
  f[key] = value;
  if (key === 'kind') { f.who = new Set(); f.q = ''; }
  if (key === 'pick' && value) f.more = true;
  f.err = '';
  anRenderForm();
}


async function sendAnnouncement() {
  const f = AN.form;
  if (!f || f.busy) return;
  const text = f.text.trim(), duration = Number(f.duration);
  f.err = !text ? 'Напишите текст объявления'
    : f.pick && !f.who.size ? (f.kind === 'chat' ? 'Выберите хотя бы один чат' : 'Выберите получателей')
    : f.sp && !f.spSel.size ? 'Выберите пространства'
    : f.kind === 'banner' && !(duration > 0) ? 'Укажите, сколько минут показывать полосу' : '';
  if (f.err) return anRenderForm(!text ? 'an-text' : null);
  f.busy = true;
  anRenderForm();
  const data = await api('POST', '/api/admin/announcement', {
    kind: f.kind, text, target: f.sp ? 'spaces' : f.pick ? 'select' : 'all', targets: f.sp ? [...f.spSel] : [...f.who],
    start_at: annStartAt || 0, duration_min: f.kind === 'banner' ? duration : 0,
  });
  f.busy = false;
  if (!data?.ok) { f.err = data?.error || 'Не удалось отправить'; return anRenderForm(); }
  closeModal('modal-announcement');
  toast(data.scheduled ? `Запланировано на ${fmtDateTime(annStartAt)}` : 'Объявление отправлено', 'success');
  if (currentPage === 'announcements') renderAnnouncements();
  updateNavBadges();
}

/* ── DATE-TIME PICKER ── */
// Свой пикер: системный datetime-local не поддаётся оформлению и выглядит
// чужеродно. Значение хранится в annStartAt, null = отправить сразу.
let _dtpView = new Date();   // месяц, который сейчас нарисован
let _dtpDay = null;          // выбранная дата без времени

function dtpToggle(e) {
  e?.stopPropagation();
  const pop = document.getElementById('dtp-pop');
  if (!pop.hidden) { pop.hidden = true; return; }
  const base = annStartAt ? new Date(annStartAt*1000) : new Date(Date.now() + 3600e3);
  _dtpView = new Date(base.getFullYear(), base.getMonth(), 1);
  _dtpDay = annStartAt ? new Date(base.getFullYear(), base.getMonth(), base.getDate()) : null;
  document.getElementById('dtp-h').value = String(base.getHours()).padStart(2,'0');
  document.getElementById('dtp-m').value = String(base.getMinutes()).padStart(2,'0');
  dtpRender();
  dtpPlace();
}

// Попап висит на fixed-координатах, поэтому его не режут границы модалки.
// Снизу места нет — раскрываем вверх; по горизонтали прижимаем к экрану.
function dtpPlace() {
  const pop = document.getElementById('dtp-pop');
  const field = pop.closest('.dtp').querySelector('.dtp-field');
  pop.style.visibility = 'hidden';
  pop.hidden = false;

  // Модалка размывает фон (backdrop-filter) и тем самым становится точкой отсчёта
  // для fixed-потомков, так что экранные координаты сюда подставлять нельзя.
  // Ставим ноль, смотрим, куда он попал, и правим на эту разницу.
  pop.style.left = '0px';
  pop.style.top = '0px';
  const zero = pop.getBoundingClientRect();

  const r = field.getBoundingClientRect();
  // Размер берём из того же rect: offsetHeight не учитывает масштабирование
  // страницы и оказывается на десяток пикселей больше видимого
  const h = zero.height, w = zero.width;
  // Нижняя граница — край модалки, а не экрана: иначе календарь свисает с карточки
  const box = field.closest('.modal');
  const limit = Math.min(box ? box.getBoundingClientRect().bottom - 8 : Infinity, window.innerHeight - 8);
  let top = r.bottom + 4 + h <= limit ? r.bottom + 4 : Math.max(8, r.top - h - 4);
  top = Math.min(top, window.innerHeight - h - 8);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));

  pop.style.top = (top - zero.top) + 'px';
  pop.style.left = (left - zero.left) + 'px';
  pop.style.visibility = '';
}

function dtpShiftMonth(delta) {
  _dtpView = new Date(_dtpView.getFullYear(), _dtpView.getMonth() + delta, 1);
  dtpRender();
}

function dtpRender() {
  const y = _dtpView.getFullYear(), m = _dtpView.getMonth();
  document.getElementById('dtp-title').textContent =
    _dtpView.toLocaleDateString('ru', { month: 'long', year: 'numeric' });

  // Неделя с понедельника; дни прошедших суток выключены
  const first = new Date(y, m, 1);
  const shift = (first.getDay() + 6) % 7;
  const today = new Date(); today.setHours(0,0,0,0);
  const cells = ['пн','вт','ср','чт','пт','сб','вс'].map(d => `<div class="dtp-dow">${d}</div>`);
  for (let i = 0; i < shift; i++) cells.push('<div></div>');

  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const past = date < today;
    const cls = ['dtp-day'];
    if (+date === +today) cls.push('today');
    if (_dtpDay && +date === +_dtpDay) cls.push('sel');
    cells.push(`<button type="button" class="${cls.join(' ')}" ${past?'disabled':''} data-on-click="dtpPick" data-a-click="${esc(JSON.stringify([y, m, d]))}">${d}</button>`);
  }
  document.getElementById('dtp-grid').innerHTML = cells.join('');
  // В месяце может стать на строку больше — при раскрытии вверх пересчитываем
  const pop = document.getElementById('dtp-pop');
  if (pop && !pop.hidden) dtpPlace();
}

function dtpPick(y, m, d) {
  _dtpDay = new Date(y, m, d);
  dtpRender();
}

function dtpFixTime() {
  const clamp = (el, max) => {
    let v = el.value.replace(/\D/g, '').slice(0, 2);
    if (v !== '' && Number(v) > max) v = String(max);
    el.value = v;
  };
  clamp(document.getElementById('dtp-h'), 23);
  clamp(document.getElementById('dtp-m'), 59);
}

function dtpApply() {
  const h = Number(document.getElementById('dtp-h').value || 0);
  const mi = Number(document.getElementById('dtp-m').value || 0);
  const day = _dtpDay || new Date();
  const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0);
  // Прошедшее время смысла не имеет: такое объявление уйдёт сразу же
  if (when.getTime() <= Date.now()) { dtpReset(); return; }
  annStartAt = Math.floor(when.getTime() / 1000);
  document.getElementById('dtp-val').textContent = fmtDateTime(annStartAt);
  document.getElementById('dtp-reset').style.display = '';
  document.getElementById('dtp-pop').hidden = true;
  if (typeof anFootSync === 'function') anFootSync();
}

function dtpReset() {
  annStartAt = null;
  _dtpDay = null;
  const val = document.getElementById('dtp-val');
  if (val) val.textContent = 'Сейчас';
  const reset = document.getElementById('dtp-reset');
  if (reset) reset.style.display = 'none';
  const pop = document.getElementById('dtp-pop');
  if (pop) pop.hidden = true;
  if (typeof anFootSync === 'function') anFootSync();
}

// Клик мимо пикера закрывает его. Перехват (capture), а не всплытие: выбор дня
// перерисовывает сетку, и к моменту всплытия нажатая кнопка уже удалена из
// документа — closest вернул бы null, и пикер закрывался бы сам от своего же клика.
document.addEventListener('click', e => {
  const pop = document.getElementById('dtp-pop');
  if (pop && !pop.hidden && !e.target.closest('.dtp')) pop.hidden = true;
}, true);

// Прокрутка тела модалки или смена размеров окна уводят поле из-под попапа
['scroll', 'resize'].forEach(ev => window.addEventListener(ev, () => {
  const pop = document.getElementById('dtp-pop');
  if (pop && !pop.hidden) pop.hidden = true;
}, true));

// Функции из const-объявлений: обработчики из HTML (act.js) находят их по имени в window
window.$hm = $hm;
window.WH_DAYS = WH_DAYS;
window.alClock = alClock;
window.anMissing = anMissing;
window.anMore = anMore;
window.anNow = anNow;
window.anSvg = anSvg;
window.anVerb = anVerb;
window.chAv = chAv;
window.chName = chName;
window.chPair = chPair;
window.chTitle = chTitle;
window.clBusy = clBusy;
window.clFind = clFind;
window.clHost = clHost;
window.clIsLocal = clIsLocal;
window.clIsWeb = clIsWeb;
window.clLines = clLines;
window.clName = clName;
window.clOutdated = clOutdated;
window.clPlatName = clPlatName;
window.clProg = clProg;
window.clVerOk = clVerOk;
window.dvTilesHtml = dvTilesHtml;
window.fdPlural = fdPlural;
window.flChatChip = flChatChip;
window.flExt = flExt;
window.flLeftDays = flLeftDays;
window.flName = flName;
window.flShort = flShort;
window.flSvg = flSvg;
window.flTs = flTs;
window.flUrl = flUrl;
window.fmNote = fmNote;
window.fmP = fmP;
window.fmScroll = fmScroll;
window.fsCur = fsCur;
window.hmClock = hmClock;
window.hmFmt = hmFmt;
window.hmLevel = hmLevel;
window.hmMemTotal = hmMemTotal;
window.hmPad = hmPad;
window.hmText = hmText;
window.kzReduced = kzReduced;
window.mdBytes = mdBytes;
window.mdNum = mdNum;
window.pgSince = pgSince;
window.pkChats = pkChats;
window.pkNoun = pkNoun;
window.pkUsers = pkUsers;
window.psChip = psChip;
window.rbDays = rbDays;
window.rbShort = rbShort;
window.rbWk = rbWk;
window.rmFmt = rmFmt;
window.rmLast = rmLast;
window.rmMenuToggle = rmMenuToggle;
window.rmMore = rmMore;
window.rmMsgs = rmMsgs;
window.rmSetTab = rmSetTab;
window.rmSpark = rmSpark;
window.rmStack = rmStack;
window.rmSvg = rmSvg;
window.rmSwitch = rmSwitch;
window.rmWeek = rmWeek;
window.rowExp = rowExp;
window.rsAny = rsAny;
window.rsIc = rsIc;
window.rsN = rsN;
window.rsNote = rsNote;
window.rsReady = rsReady;
window.rsWhen = rsWhen;
window.sbSvg = sbSvg;
window.sbUptime = sbUptime;
window.spAttn = spAttn;
window.spBkAgeDays = spBkAgeDays;
window.spDbPct = spDbPct;
window.spFileAgeDays = spFileAgeDays;
window.spFileTs = spFileTs;
window.spHit = spHit;
window.spLater = spLater;
window.spQ = spQ;
window.spQ2 = spQ2;
window.spRow = spRow;
window.spShortDur = spShortDur;
window.spStepH = spStepH;
window.spSv = spSv;
window.spTokH = spTokH;
window.stBackupOld = stBackupOld;
window.stChanged = stChanged;
window.stClock = stClock;
window.stClone = stClone;
window.stLastBackup = stLastBackup;
window.stPad = stPad;
window.stSvg = stSvg;
window.stVersion = stVersion;
window.uaAv = uaAv;
window.uaAway = uaAway;
window.uaBlank = uaBlank;
window.uaCreds = uaCreds;
window.uaDot = uaDot;
window.uaInWs = uaInWs;
window.uaMissing = uaMissing;
window.uaMore = uaMore;
window.uaNames = uaNames;
window.uaOnline = uaOnline;
window.uaRerender = uaRerender;
window.uaRole = uaRole;
window.uaTotpBadge = uaTotpBadge;
window.uaUserWs = uaUserWs;
window.uxClock = uxClock;
window.uxHash = uxHash;
window.uxPlural = uxPlural;
window.uxSearch = uxSearch;
window.uxSelVal = uxSelVal;
window.uxSvg = uxSvg;
window.uxTag = uxTag;
window.whActive = whActive;
window.whCurl = whCurl;
window.whMissing = whMissing;
window.whSvg = whSvg;
window.whUrl = whUrl;
window.whWeek = whWeek;
window.whWk = whWk;
window.xEvIdx = xEvIdx;
window.xEvIn = xEvIn;
window.xTz = xTz;
window.xWhen = xWhen;
window.xi = xi;
window.xpClose = xpClose;
window.xpOpen = xpOpen;
window.xpRefresh = xpRefresh;
