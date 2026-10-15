// Папки чатов для клиента Electron и веб-клиента (одна копия на оба: client/src и server/src/public/shared правятся вместе).
// Папки личные, лежат на сервере и общие для всех устройств человека. Панель папок стоит в баре слева от списка,
// чат добавляется в папку из его меню, управление — в «Настройки → Папки». Нужны глобальные S, api, esc, openModal,
// closeModal, showConfirm, showActionToast, renderChatList, placeCtxMenu.
const FOLDER_COLORS = ['#3390ec', '#8e6cf0', '#30b46c', '#f0a030', '#ec5b8f', '#2fb8c4', '#e8604c', '#8a97a8'];
const FOLDER_ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  heart: '<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 4.5 5"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21a2 2 0 0 0 4 0"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6"/>',
  book: '<path d="M3 5a2 2 0 0 1 2-2h6v17H5a2 2 0 0 0-2 2zM21 5a2 2 0 0 0-2-2h-6v17h6a2 2 0 0 1 2 2z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10 3 7.5 4.5 9 8 12 8zm0 0s2-5 4.5-3.5S15 8 12 8z"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2M15 3v2"/>',
  rocket: '<path d="M12 3c4 1 7 5 7 9l-4 4H9l-2-2c0-4 2-9 5-11zM9 15l-4 1 1-4M15 17l-1 4"/><circle cx="13" cy="10" r="1.5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 3H6l3-3z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M10 17h4"/>',
};
const FOLDER_ICON_KEYS = Object.keys(FOLDER_ICONS);
const folderSvg = (name, size) => `<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${size || 20}" height="${size || 20}">${FOLDER_ICONS[name] || FOLDER_ICONS.folder}</svg>`;
const fsvg = (p, size) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${size || 16}" height="${size || 16}">${p}</svg>`;
const FI_X = '<path d="M6 6l12 12M18 6L6 18"/>', FI_EDIT = '<path d="M4 20l1-4L16 5l3 3L8 19z"/>', FI_TRASH = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
const FI_UP = '<path d="M6 15l6-6 6 6"/>', FI_DOWN = '<path d="M6 9l6 6 6-6"/>', FI_PLUS = '<path d="M12 5v14M5 12h14"/>', FI_CHECK = '<path d="M5 12.5l4.5 4.5L19 7"/>';

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
    return `<button type="button" class="acc-btn fld-btn${on ? ' active' : ''}" data-fid="${typeof id === 'number' ? id : 'all'}" style="--fc:${color || 'var(--accent)'}" onclick="folderSelect(${typeof id === 'number' ? id : `'all'`})"${typeof id === 'number' ? ` oncontextmenu="folderItemMenu(event,${id})"` : ''} aria-label="${esc(name)}" aria-pressed="${on}">
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
function foldersRailFit() {
  const box = document.getElementById('rail-folders');
  if (!box) return;
  box.classList.remove('scroll');
  box.querySelectorAll('.fld-btn').forEach(b => b.removeAttribute('title'));
  const rail = box.parentElement;
  if (rail.scrollHeight > rail.clientHeight + 1) {
    box.classList.add('scroll');
    box.querySelectorAll('.fld-btn').forEach(b => b.title = b.getAttribute('aria-label'));
  }
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
      <div class="ac-fld"><input id="fe-name" maxlength="30" placeholder="Название папки" autocomplete="off" value="${esc(name)}" oninput="feName(this.value)" onkeydown="if(event.key==='Enter')feSave()"></div></div>
    ${nameOnly ? '' : `<div class="fe-l">Цвет</div>
    <div class="fe-cols">${FOLDER_COLORS.map(c => `<button type="button" style="--fc:${c}" class="${c === st.color ? 'on' : ''}" onclick="feColor('${c}')" aria-label="Цвет"></button>`).join('')}</div>
    <div class="fe-l">Значок</div>
    <div class="fe-icons">${FOLDER_ICON_KEYS.map(n => `<button type="button" class="${n === st.icon ? 'on' : ''}" onclick="feIcon('${n}')" style="--fc:${st.color}">${folderSvg(n, 20)}</button>`).join('')}</div>`}
    <div class="ac-foot"><button class="modal-btn-ghost" onclick="closeModal('modal-folder')">Отмена</button><button class="modal-btn-primary" id="fe-go" onclick="feSave()" ${st.name.trim() ? '' : 'disabled'}>${f ? 'Сохранить' : 'Создать'}</button></div>`;
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

// ── Раздел «Папки» в настройках ──
function csPaneFolders() {
  const n = S.folders.length;
  const rows = S.folders.map((f, i) => `<div class="fp-row" draggable="true" data-fid="${f.id}">
      <span class="fp-grip" title="Перетащите, чтобы изменить порядок">${fsvg('<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" stroke-width="3"/>', 16)}</span>
      <span class="fp-ic" style="--fc:${f.color}">${folderSvg(f.icon, 20)}</span>
      <span class="fp-tx"><b>${esc(f.name)}</b><small>${f.chat_ids.length} ${folderPlural(f.chat_ids.length)}</small></span>
      <span class="fp-acts">
        <button type="button" title="Выше" aria-label="Выше" onclick="moveFolder(${f.id},-1)" ${i === 0 ? 'disabled' : ''}>${fsvg(FI_UP, 16)}</button>
        <button type="button" title="Ниже" aria-label="Ниже" onclick="moveFolder(${f.id},1)" ${i === n - 1 ? 'disabled' : ''}>${fsvg(FI_DOWN, 16)}</button>
        <button type="button" title="Изменить" aria-label="Изменить" onclick="openFolderEditor(folderById(${f.id}))">${fsvg(FI_EDIT, 16)}</button>
        <button type="button" class="danger" title="Удалить" aria-label="Удалить" onclick="deleteFolder(${f.id})">${fsvg(FI_TRASH, 16)}</button>
      </span></div>`).join('');
  return `<div class="fp-lead">Папки помогают разбирать чаты по темам. Чат добавляется в папку из его меню: правый клик по чату → «В папку».</div>
    <div class="fp-list" id="fp-list">${rows || '<div class="fp-empty">Папок пока нет</div>'}</div>
    <button type="button" class="fp-new" onclick="openFolderEditor(null)" ${n >= FOLDER_MAX ? 'disabled' : ''}>${fsvg(FI_PLUS, 16)}<span>Новая папка</span></button>`;
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
