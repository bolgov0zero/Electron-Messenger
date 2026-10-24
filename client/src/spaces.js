// Пространства человека в баре клиента Electron и веб-клиента (одна копия на оба: client/src и server/src/public/shared).
// Если в настройках включено «Отображать пространства», в баре под папками (через разделитель) появляются
// «Общий вид» и все пространства, где состоит человек (в том числе общие для нескольких серверов). Выбранное пространство оставляет в списках только людей из него и чаты с ними;
// «Общий вид» показывает всё. Выбор можно сочетать с папкой. Нужны глобальные S, api, esc, renderChatList, renderContactsList.
S.sharedSpaces = [];
S.spaceFilter = 'all';
const SPACE_COLORS = ['#30b46c', '#8e6cf0', '#f0a030', '#ec5b8f', '#2fb8c4', '#e8604c'];
const SPACE_ICON_ALL = '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>';

const spacesOn = () => S.settings?.spacesRail === true;
const spacesRailShown = () => spacesOn() && S.sharedSpaces.length > 0;
const spaceActive = () => spacesRailShown() && S.spaceFilter !== 'all' ? S.spaceFilter : null;
function spaceStoreKey() { return 'chat_space_filter_' + (S.user?.id || 0) + '_' + (S.server || ''); }
const spaceInitials = n => { const w = String(n || '?').trim().split(/\s+/); return ((w[0] || '?')[0] + (w.length > 1 ? w[1][0] : (w[0][1] || ''))).toUpperCase(); };

async function loadSharedSpaces() {
  const r = await api('GET', '/contacts/spaces');
  if (!Array.isArray(r)) return;
  const same = JSON.stringify(r) === JSON.stringify(S.sharedSpaces);
  S.sharedSpaces = r;
  try { const v = localStorage.getItem(spaceStoreKey()); if (v && v !== 'all' && r.some(s => String(s.id) === v)) S.spaceFilter = +v; } catch {}
  if (S.spaceFilter !== 'all' && !r.some(s => s.id === S.spaceFilter)) S.spaceFilter = 'all';
  if (!same) spacesChanged();
}
function spacesChanged() {
  if (typeof renderAccountRail === 'function') renderAccountRail();
  if (typeof renderRail === 'function') renderRail();
  renderChatList();
  if (typeof _sidebarTab !== 'undefined' && _sidebarTab === 'contacts') renderContactsList(document.getElementById('contacts-search')?.value || '');
}
function spaceSelect(id) {
  S.spaceFilter = id;
  try { localStorage.setItem(spaceStoreKey(), String(id)); } catch {}
  spacesChanged();
}
// Человек из пространства id (id пространства — из общих с вами)
const spaceUserIn = (u, id) => !!u && (u.ws_ids || []).includes(id);
function spaceUserPass(u) { const id = spaceActive(); return id === null || spaceUserIn(u, id); }
// Чат виден при выбранном пространстве: в нём есть кто-то из этого пространства, кроме вас
function spacePass(c) {
  const id = spaceActive();
  if (id === null) return true;
  return (c.members || []).some(m => m.id !== S.user.id && spaceUserIn((S.allUsers || []).find(u => u.id === m.id), id));
}
function spaceUnread(id) {
  let n = 0;
  const only = id === 'all' ? null : id;
  for (const c of S.chats) {
    if ((S.mutedChats && S.mutedChats.has(c.id)) || c.invite) continue;
    if (only !== null && !(c.members || []).some(m => m.id !== S.user.id && spaceUserIn((S.allUsers || []).find(u => u.id === m.id), only))) continue;
    n += c.has_topics ? (S.topics[c.id] || []).reduce((s, t) => s + (S.unread[t.id] || 0), 0) : (S.unread[c.id] || 0);
  }
  return n;
}

// Разметка: отдельная группа бара (после записей и папок, через разделитель)
function spacesRailHtml(withSep) {
  if (!spacesRailShown()) return '';
  const btn = (id, ic, name, sub, cnt, color) => {
    const on = S.spaceFilter === id;
    const badge = cnt > 0 ? `<span class="acc-badge">${cnt > 99 ? '99+' : cnt}</span>` : '';
    return `<button type="button" class="acc-btn fld-btn spc-btn${on ? ' active' : ''}" data-sid="${id}" style="--fc:${color || 'var(--accent)'}" data-on-click="spaceSelect" data-a-click="${esc(JSON.stringify([typeof id === 'number' ? id : 'all']))}" aria-label="${esc(name)}" aria-pressed="${on}">
      <span class="fld-ic">${ic}</span>${badge}<span class="acc-tip"><b>${esc(name)}</b><span>${esc(sub)}</span></span></button>`;
  };
  const all = btn('all', `<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${SPACE_ICON_ALL}</svg>`, 'Общий вид', 'Все чаты и контакты', spaceUnread('all'), '');
  const items = S.sharedSpaces.map((s, i) => btn(s.id, `<span class="spc-ini">${esc(spaceInitials(s.name))}</span>`, s.name, s.shared ? `Общее пространство · ${s.servers} ${s.servers === 1 ? 'сервер' : s.servers < 5 ? 'сервера' : 'серверов'}` : `${s.people} ${s.people % 10 === 1 && s.people % 100 !== 11 ? 'человек' : (s.people % 10 >= 2 && s.people % 10 <= 4 && (s.people % 100 < 12 || s.people % 100 > 14)) ? 'человека' : 'человек'}`, spaceUnread(s.id), SPACE_COLORS[i % SPACE_COLORS.length])).join('');
  return (withSep ? '<span class="rail-sep"></span>' : '') + `<div class="rail-folders rail-spaces" id="rail-spaces">${all}${items}</div>`;
}
function updateSpaceBadges() {
  const box = document.getElementById('rail-spaces');
  if (!box) return;
  box.querySelectorAll('.spc-btn').forEach(b => {
    const id = b.dataset.sid, n = spaceUnread(id === 'all' ? 'all' : +id);
    let el = b.querySelector('.acc-badge');
    if (n > 0) { if (!el) { el = document.createElement('span'); el.className = 'acc-badge'; b.querySelector('.fld-ic').after(el); } el.textContent = n > 99 ? '99+' : n; }
    else if (el) el.remove();
  });
}

// Строка в «Настройки → Папки и пространства»
function csSpacesRows() {
  const on = spacesOn(), n = S.sharedSpaces.length;
  return `<div class="cs-gt">Пространства</div>
    <div class="cs-g"><div class="cs-r"><div class="cs-l"><b>Отображать пространства</b><span>${n ? 'Бар покажет «Общий вид» и все ваши пространства: выбор оставит в списках людей из него и чаты с ними' : 'Пространства объединяют людей. Сейчас вы ни в одном не состоите'}</span></div>${csTg(on, 'csSpacesRail', 'Отображать пространства')}</div></div>`;
}
function csSpacesRail() {
  S.settings.spacesRail = !spacesOn();
  if (!S.settings.spacesRail) S.spaceFilter = 'all';
  saveSession();
  spacesChanged();
  csRefresh();
}

// Функции из const-объявлений: обработчики из HTML (act.js) находят их по имени в window
window.spaceActive = spaceActive;
window.spaceInitials = spaceInitials;
window.spaceUserIn = spaceUserIn;
window.spacesOn = spacesOn;
window.spacesRailShown = spacesRailShown;
