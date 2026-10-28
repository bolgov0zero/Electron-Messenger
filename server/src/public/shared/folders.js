// Папки чатов для клиента Electron и веб-клиента (одна копия на оба: client/src и server/src/public/shared правятся вместе).
// Папки личные, лежат на сервере и общие для всех устройств человека. Панель папок стоит в баре слева от списка,
// чат добавляется в папку из его меню, управление — в «Настройки → Папки и пространства». Нужны глобальные S, api, esc, openModal,
// closeModal, showConfirm, showActionToast, renderChatList, placeCtxMenu.
const FOLDER_COLORS = ['#3390ec', '#8e6cf0', '#30b46c', '#f0a030', '#ec5b8f', '#2fb8c4', '#e8604c', '#8a97a8'];
// Значки — набор Lucide (лицензия ISC), контурные, 24×24
const FOLDER_ICONS = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  cog: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
};
const FOLDER_ICON_KEYS = Object.keys(FOLDER_ICONS);
const folderSvg = (name, size) => `<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${size || 20}" height="${size || 20}">${FOLDER_ICONS[name] || FOLDER_ICONS.folder}</svg>`;
const fsvg = (p, size) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${size || 16}" height="${size || 16}">${p}</svg>`;
const FI_X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', FI_EDIT = '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>', FI_TRASH = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>';
const FI_UP = '<path d="m18 15-6-6-6 6"/>', FI_DOWN = '<path d="m6 9 6 6 6-6"/>', FI_PLUS = '<path d="M5 12h14"/><path d="M12 5v14"/>', FI_CHECK = '<path d="M20 6 9 17l-5-5"/>';

S.folders = [];
S.folderFilter = 'all';
const FOLDER_MAX = 20;
const folderPlural = n => n % 10 === 1 && n % 100 !== 11 ? 'чат' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'чата' : 'чатов';

function folderStoreKey() { return 'chat_folder_filter_' + (S.user?.id || 0) + '_' + (S.server || ''); }

async function loadFolders() {
  const r = await api('GET', '/folders');
  if (!Array.isArray(r)) return;
  S.folders = r;
  try { const v = localStorage.getItem(folderStoreKey()); if (v && v !== 'all' && S.folders.some(f => String(f.id) === v)) S.folderFilter = +v; } catch {}
  foldersChanged();
}
// Сообщение сервера «папки изменились» приходит и после наших собственных правок: перезагружаем только когда всё стихло,
// иначе запоздавший ответ затирал бы только что сделанное (быстрые нажатия «выше» подряд)
let _fReloadT = null, _fBusy = 0;
function scheduleFoldersReload() {
  clearTimeout(_fReloadT);
  _fReloadT = setTimeout(() => { if (_fBusy > 0) scheduleFoldersReload(); else loadFolders(); }, 350);
}
async function folderApi(method, path, body) {
  _fBusy++;
  try { return await api(method, path, body); } finally { _fBusy--; }
}
// Папки изменились (загрузка, правка здесь или на другом устройстве): всё, что их показывает, обновляется
function foldersChanged() {
  if (S.folderFilter !== 'all' && !S.folders.some(f => f.id === S.folderFilter)) S.folderFilter = 'all';
  if (!S.folders.length) S.folderFilter = 'all';
  if (typeof renderAccountRail === 'function') renderAccountRail();
  if (typeof renderRail === 'function') renderRail();
  renderChatList();
  if (typeof _sidebarTab !== 'undefined' && _sidebarTab === 'settings' && typeof CS !== 'undefined' && CS.sec === 'folders') csRefresh();
}

const folderById = id => S.folders.find(f => f.id === id);
const chatInFolder = (c, f) => !!f && f.chat_ids.includes(c.id);
// Чат виден при выбранном фильтре
function folderPass(c) { return S.folderFilter === 'all' || chatInFolder(c, folderById(S.folderFilter)); }
// Папка для значка на аватарке: первая по порядку из тех, в которых лежит чат
function folderOfChat(c) { return S.folders.find(f => f.chat_ids.includes(c.id)) || null; }
function folderBadgeHtml(c) {
  if (S.folderFilter !== 'all') return '';   // внутри папки значок лишний: и так понятно
  const f = folderOfChat(c);
  return f ? `<span class="fbd" style="--fc:${f.color}" title="Папка «${esc(f.name)}»">${folderSvg(f.icon, 11)}</span>` : '';
}
function folderUnread(f) {
  let n = 0;
  for (const c of S.chats) {
    if (!f.chat_ids.includes(c.id) || (S.mutedChats && S.mutedChats.has(c.id))) continue;
    n += c.has_topics ? (S.topics[c.id] || []).reduce((s, t) => s + (S.unread[t.id] || 0), 0) : (S.unread[c.id] || 0);
  }
  return n;
}
function folderSelect(id) {
  S.folderFilter = id;
  try { localStorage.setItem(folderStoreKey(), String(id)); } catch {}
  if (typeof renderAccountRail === 'function') renderAccountRail();
  if (typeof renderRail === 'function') renderRail();
  renderChatList();
}

// ── Панель папок (разметка; в клиенте Electron она часть бара учётных записей) ──
function foldersRailHtml(withSep) {
  if (!S.folders.length) return '';
  const unreadAll = S.folders.reduce((s, f) => s + folderUnread(f), 0);
  const btn = (id, ic, name, sub, cnt, color) => {
    const on = S.folderFilter === id;
    const badge = cnt > 0 ? `<span class="acc-badge">${cnt > 99 ? '99+' : cnt}</span>` : '';
    return `<button type="button" class="acc-btn fld-btn${on ? ' active' : ''}" data-fid="${typeof id === 'number' ? id : 'all'}" style="--fc:${color || 'var(--accent)'}" data-on-click="folderSelect" data-a-click="${esc(JSON.stringify([typeof id === 'number' ? id : 'all']))}"${typeof id === 'number' ? ` data-on-contextmenu="folderItemMenu" data-a-contextmenu="${esc(JSON.stringify(["__event", id]))}"` : ''} aria-label="${esc(name)}" aria-pressed="${on}">
      <span class="fld-ic">${ic}</span>${badge}<span class="acc-tip"><b>${esc(name)}</b><span>${esc(sub)}</span></span></button>`;
  };
  return (withSep ? '<span class="rail-sep"></span>' : '') + `<div class="rail-folders" id="rail-folders">` +
    btn('all', folderSvg('chat', 22), 'Все чаты', S.chats.length + ' ' + folderPlural(S.chats.length), unreadAll, '') +
    S.folders.map(f => btn(f.id, folderSvg(f.icon, 22), f.name, f.chat_ids.length + ' ' + folderPlural(f.chat_ids.length), folderUnread(f), f.color)).join('') + '</div>';
}
// Счётчики на кнопках папок: меняются часто, поэтому правим только их, не пересобирая бар
function updateFolderBadges() {
  const box = document.getElementById('rail-folders');
  if (!box) return;
  box.querySelectorAll('.fld-btn').forEach(b => {
    const id = b.dataset.fid;
    const n = id === 'all' ? S.folders.reduce((s, f) => s + folderUnread(f), 0) : folderUnread(folderById(+id) || { chat_ids: [] });
    let el = b.querySelector('.acc-badge');
    if (n > 0) { if (!el) { el = document.createElement('span'); el.className = 'acc-badge'; b.querySelector('.fld-ic').after(el); } el.textContent = n > 99 ? '99+' : n; }
    else if (el) el.remove();
  });
}
// Много папок не помещается в бар: тогда он прокручивается, а подсказки показывает системная
// Подсказки бара (название, сервер или адрес записи): одна на всё приложение, поверх остальных слоёв.
// Внутри самой кнопки их закрывал список чатов: бар лежит ниже него по порядку наложения
let _railTip = null;
function railTipsInit() {
  if (_railTip) return;
  const rail = document.getElementById('acc-rail');
  if (!rail) return;
  const tip = _railTip = document.createElement('div');
  tip.className = 'acc-tip rail-tip';
  document.body.appendChild(tip);
  const hide = () => tip.classList.remove('visible');
  rail.addEventListener('mouseover', e => {
    const b = e.target.closest?.('.acc-btn');
    const src = b && rail.contains(b) && b.querySelector('.acc-tip');
    if (!src) { hide(); return; }
    tip.innerHTML = src.innerHTML;
    // rect и style.left считаются в разных пикселях при масштабе окна: берём пробу (см. zoomMetrics)
    const m = typeof zoomMetrics === 'function' ? zoomMetrics() : { k: 1, vh: window.innerHeight };
    tip.style.left = '0px'; tip.style.top = '0px';
    const r = b.getBoundingClientRect(), th = tip.getBoundingClientRect().height;
    tip.style.left = Math.round((r.right + 14) / m.k) + 'px';
    tip.style.top = Math.round(Math.max(6, Math.min(m.vh - th - 6, r.top + r.height / 2 - th / 2)) / m.k) + 'px';
    tip.classList.add('visible');
  });
  rail.addEventListener('mouseleave', hide);
  rail.addEventListener('click', hide);
  rail.addEventListener('scroll', hide, true);
}
function foldersRailFit() {
  railTipsInit();
  const box = document.getElementById('rail-folders');
  if (!box) return;
  box.classList.remove('scroll');
  box.querySelectorAll('.fld-btn').forEach(b => b.removeAttribute('title'));   // свою подсказку рисует railTipsInit, встроенная была бы второй
  const rail = box.parentElement;
  if (rail.scrollHeight > rail.clientHeight + 1) box.classList.add('scroll');
}

// ── Небольшое меню у курсора (папка в баре, «В папку» у чата) ──
// items: { label, icon (путь svg) | html, danger, check, keep, fn } или { sep: true }
function folderMenu(e, items, at) {
  e.preventDefault(); e.stopPropagation();
  let m = document.getElementById('fld-menu');
  if (!m) { m = document.createElement('div'); m.className = 'ctx-menu fld-menu'; m.id = 'fld-menu'; document.body.appendChild(m); }
  const paint = () => {
    m.innerHTML = items.map((it, i) => it.sep ? '<div class="ctx-sep"></div>'
      : `<button type="button" data-i="${i}" class="${it.danger ? 'ctx-danger' : ''}">${it.html || fsvg(it.icon, 16)}<span>${esc(it.label)}</span>${it.check ? `<i class="fld-ck">${fsvg(FI_CHECK, 15)}</i>` : ''}</button>`).join('');
  };
  paint();
  m.onclick = ev => {
    const b = ev.target.closest('button[data-i]'); if (!b) return;
    ev.stopPropagation();
    const it = items[+b.dataset.i];
    if (!it.keep) { m.style.display = 'none'; const cm = document.getElementById('ctx-chat-menu'); if (cm) cm.style.display = 'none'; }
    it.fn(it, paint);
  };
  m.style.display = 'block';
  placeCtxMenu(m, at ? at.x : e.clientX, at ? at.y : e.clientY, !at && e.currentTarget && e.type === 'click' ? e.currentTarget.getBoundingClientRect() : null);
  m.classList.add('open');
}
function folderMenuClose() { const m = document.getElementById('fld-menu'); if (m) { m.style.display = 'none'; m.classList.remove('open'); } }
document.addEventListener('click', e => { if (!e.target.closest('#fld-menu')) folderMenuClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') folderMenuClose(); });

function folderItemMenu(e, id) {
  const f = folderById(id); if (!f) return;
  folderMenu(e, [
    { label: 'Переименовать', icon: FI_EDIT, fn: () => openFolderEditor(f, true) },
    { label: 'Значок и цвет', html: `<span class="fld-mini" style="--fc:${f.color}">${folderSvg(f.icon, 13)}</span>`, fn: () => openFolderEditor(f) },
    { sep: true },
    { label: 'Удалить папку', icon: FI_TRASH, danger: true, fn: () => deleteFolder(f.id) },
  ]);
}

// «В папку» в меню чата — подменю в самом меню, как «Прочитано» у сообщения: по наведению (или нажатию) рядом раскрывается карточка
// со списком папок. Нажатие на папку ставит или снимает галочку, меню остаётся открытым
function ctxSubFill() {
  const fly = document.getElementById('ctx-sub-fly'); if (!fly) return;
  const id = S.ctxChatId;
  fly.innerHTML = S.folders.map(f => `<button type="button" data-sf="${f.id}"><span class="fld-mini" style="--fc:${f.color}">${folderSvg(f.icon, 13)}</span><span>${esc(f.name)}</span>${f.chat_ids.includes(id) ? `<i class="fld-ck">${fsvg(FI_CHECK, 15)}</i>` : ''}</button>`).join('')
    + (S.folders.length ? '<div class="ctx-sep"></div>' : '')
    + `<button type="button" data-sf="new">${fsvg(FI_PLUS, 16)}<span>Новая папка…</span></button>`;
}
// Карточка: вправо от меню, а если до края окна не хватает места — влево; по высоте выровнена по пункту (как ctxReadPlace)
function ctxSubPlace() {
  const menu = document.getElementById('ctx-chat-menu'), wrap = document.getElementById('ctx-chat-folder'), fly = document.getElementById('ctx-sub-fly');
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
function ctxSubSet(on) {
  const wrap = document.getElementById('ctx-chat-folder');
  if (!wrap || wrap.classList.contains('open') === on) return;
  if (on) { ctxSubFill(); ctxSubPlace(); }
  wrap.classList.toggle('open', on);
  wrap.querySelector('button')?.setAttribute('aria-expanded', on);
}
function ctxSubHover(on) {
  clearTimeout(S.ctxSubT);
  if (on) ctxSubSet(true); else S.ctxSubT = setTimeout(() => ctxSubSet(false), 170);
}
function ctxSubToggle(e) {
  e && e.stopPropagation();
  ctxSubSet(!document.getElementById('ctx-chat-folder').classList.contains('open'));
}
// Нажатие внутри карточки: меню чата не закрывается
async function ctxSubClick(e) {
  e.stopPropagation();
  const b = e.target.closest('button[data-sf]'); if (!b) return;
  const id = S.ctxChatId;
  if (b.dataset.sf === 'new') {
    const cm = document.getElementById('ctx-chat-menu'); if (cm) cm.style.display = 'none';
    openFolderEditor(null, false, fid => { if (fid) folderApi('PUT', '/folders/chat/' + id, { folder_ids: [...S.folders.filter(x => x.chat_ids.includes(id)).map(x => x.id), fid] }); });
    return;
  }
  const f = folderById(+b.dataset.sf); if (!f) return;
  f.chat_ids = f.chat_ids.includes(id) ? f.chat_ids.filter(i => i !== id) : [...f.chat_ids, id];
  ctxSubFill(); foldersChanged();
  await folderApi('PUT', '/folders/chat/' + id, { folder_ids: S.folders.filter(x => x.chat_ids.includes(id)).map(x => x.id) });
}

// ── Создание и правка папки ──
let _fe = null;   // { f, st, nameOnly, done }
function openFolderEditor(folder, nameOnly, done) {
  if (!folder && S.folders.length >= FOLDER_MAX) { showActionToast(`Не больше ${FOLDER_MAX} папок`); return; }
  _fe = { f: folder, st: folder ? { name: folder.name, color: folder.color, icon: folder.icon } : { name: '', color: FOLDER_COLORS[0], icon: 'folder' }, nameOnly: !!nameOnly, done };
  paintFolderEditor();
  openModal('modal-folder');
  setTimeout(() => { const i = document.getElementById('fe-name'); if (i) { i.focus(); i.select(); } }, 80);
}
function paintFolderEditor() {
  const { f, st, nameOnly } = _fe;
  const name = document.getElementById('fe-name')?.value ?? st.name;
  st.name = name;
  document.getElementById('fe-title').textContent = f ? (nameOnly ? 'Переименовать папку' : 'Изменить папку') : 'Новая папка';
  document.getElementById('fe-body').innerHTML = `
    <div class="fe-top"><span class="fe-big" style="--fc:${st.color}">${folderSvg(st.icon, 26)}</span>
      <div class="ac-fld"><input id="fe-name" maxlength="30" placeholder="Название папки" autocomplete="off" value="${esc(name)}" data-on-input="feName" data-a-input='["__value"]' data-on-keydown="__h44"></div></div>
    ${nameOnly ? '' : `<div class="fe-l">Цвет</div>
    <div class="fe-cols">${FOLDER_COLORS.map(c => `<button type="button" style="--fc:${c}" class="${c === st.color ? 'on' : ''}" data-on-click="feColor" data-a-click="${esc(JSON.stringify([`${c}`]))}" aria-label="Цвет"></button>`).join('')}</div>
    <div class="fe-l">Значок</div>
    <div class="fe-icons">${FOLDER_ICON_KEYS.map(n => `<button type="button" class="${n === st.icon ? 'on' : ''}" data-on-click="feIcon" data-a-click="${esc(JSON.stringify([`${n}`]))}" style="--fc:${st.color}">${folderSvg(n, 20)}</button>`).join('')}</div>`}
    <div class="ac-foot"><button class="modal-btn-ghost" data-on-click="closeModal" data-a-click='["modal-folder"]'>Отмена</button><button class="modal-btn-primary" id="fe-go" data-on-click="feSave" ${st.name.trim() ? '' : 'disabled'}>${f ? 'Сохранить' : 'Создать'}</button></div>`;
}
function feName(v) { _fe.st.name = v; document.getElementById('fe-go').disabled = !v.trim(); }
function feColor(c) { _fe.st.color = c; const v = document.getElementById('fe-name').value; paintFolderEditor(); const i = document.getElementById('fe-name'); i.value = v; _fe.st.name = v; }
function feIcon(n) { _fe.st.icon = n; feColor(_fe.st.color); }
async function feSave() {
  const { f, st, done } = _fe;
  const name = document.getElementById('fe-name').value.trim();
  if (!name) return;
  closeModal('modal-folder');
  if (f) {
    Object.assign(f, { name, color: st.color, icon: st.icon });
    foldersChanged();
    await folderApi('PATCH', '/folders/' + f.id, { name, color: st.color, icon: st.icon });
  } else {
    const r = await folderApi('POST', '/folders', { name, color: st.color, icon: st.icon });
    if (r?.id) { if (done) await done(r.id); await loadFolders(); }
    else showActionToast(r?.error || 'Не удалось создать папку');
  }
}
async function deleteFolder(id) {
  const f = folderById(id); if (!f) return;
  if (!await showConfirm(`Удалить папку «${f.name}»? Чаты из неё не удаляются, они останутся в списке.`)) return;
  S.folders = S.folders.filter(x => x.id !== id);
  foldersChanged();
  await folderApi('DELETE', '/folders/' + id);
}
async function moveFolder(id, dir) {
  const i = S.folders.findIndex(f => f.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= S.folders.length) return;
  const [f] = S.folders.splice(i, 1); S.folders.splice(j, 0, f);
  foldersChanged();
  await folderApi('PUT', '/folders/order', { ids: S.folders.map(x => x.id) });
}

// ── Раздел «Папки и пространства» в настройках ──
function csPaneFolders() {
  const n = S.folders.length;
  const rows = S.folders.map((f, i) => `<div class="fp-row" draggable="true" data-fid="${f.id}">
      <span class="fp-grip" title="Перетащите, чтобы изменить порядок">${fsvg('<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>', 16)}</span>
      <span class="fp-ic" style="--fc:${f.color}">${folderSvg(f.icon, 20)}</span>
      <span class="fp-tx"><b>${esc(f.name)}</b><small>${f.chat_ids.length} ${folderPlural(f.chat_ids.length)}</small></span>
      <span class="fp-acts">
        <button type="button" title="Выше" aria-label="Выше" data-on-click="moveFolder" data-a-click="${esc(JSON.stringify([f.id, -1]))}" ${i === 0 ? 'disabled' : ''}>${fsvg(FI_UP, 16)}</button>
        <button type="button" title="Ниже" aria-label="Ниже" data-on-click="moveFolder" data-a-click="${esc(JSON.stringify([f.id, 1]))}" ${i === n - 1 ? 'disabled' : ''}>${fsvg(FI_DOWN, 16)}</button>
        <button type="button" title="Изменить" aria-label="Изменить" data-on-click="openFolderEditor" data-a-click="${esc(JSON.stringify([folderById(f.id)]))}">${fsvg(FI_EDIT, 16)}</button>
        <button type="button" class="danger" title="Удалить" aria-label="Удалить" data-on-click="deleteFolder" data-a-click="${esc(JSON.stringify([f.id]))}">${fsvg(FI_TRASH, 16)}</button>
      </span></div>`).join('');
  return (typeof csSpacesRows === 'function' ? csSpacesRows() : '') + `<div class="cs-gt">Папки</div><div class="fp-lead">Папки помогают разбирать чаты по темам. Чат добавляется в папку из его меню: правый клик по чату → «В папку».</div>
    <div class="fp-list" id="fp-list">${rows || '<div class="fp-empty">Папок пока нет</div>'}</div>
    <button type="button" class="fp-new" data-on-click="openFolderEditor" data-a-click='[null]' ${n >= FOLDER_MAX ? 'disabled' : ''}>${fsvg(FI_PLUS, 16)}<span>Новая папка</span></button>`;
}
// Перетаскивание строк в настройках
let _fpDrag = null;
document.addEventListener('dragstart', e => { const r = e.target.closest && e.target.closest('.fp-row'); if (!r) return; _fpDrag = +r.dataset.fid; r.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(_fpDrag)); } catch {} });
document.addEventListener('dragover', e => {
  const r = e.target.closest && e.target.closest('.fp-row'); if (!r || _fpDrag == null) return;
  e.preventDefault();
  document.querySelectorAll('.fp-row.over').forEach(x => x.classList.remove('over'));
  if (+r.dataset.fid !== _fpDrag) r.classList.add('over');
});
document.addEventListener('drop', async e => {
  const r = e.target.closest && e.target.closest('.fp-row'); if (!r || _fpDrag == null) return;
  e.preventDefault();
  const from = S.folders.findIndex(f => f.id === _fpDrag), to = S.folders.findIndex(f => f.id === +r.dataset.fid);
  _fpDrag = null;
  if (from < 0 || to < 0 || from === to) { foldersChanged(); return; }
  const [f] = S.folders.splice(from, 1); S.folders.splice(to, 0, f);
  foldersChanged();
  await folderApi('PUT', '/folders/order', { ids: S.folders.map(x => x.id) });
});
document.addEventListener('dragend', () => { _fpDrag = null; document.querySelectorAll('.fp-row.drag,.fp-row.over').forEach(x => x.classList.remove('drag', 'over')); });

// Функции из const-объявлений: обработчики из HTML (act.js) находят их по имени в window
window.chatInFolder = chatInFolder;
window.folderById = folderById;
window.folderPlural = folderPlural;
window.folderSvg = folderSvg;
window.fsvg = fsvg;
