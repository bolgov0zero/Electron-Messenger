// ── ОБЪЯВЛЕНИЯ ИЗ КЛИЕНТА ──
// Кнопка с колокольчиком в шапке сайдбара видна администраторам и тем, кому админ включил право «Отправлять объявления».
// Окно из двух половин: слева сообщение (предпросмотр, тип, текст, время), справа во всю высоту список получателей.
// В маленьком окне половины превращаются в две вкладки «Сообщение» и «Получатели» с общей кнопкой отправки.
// Объявление уходит от имени системы, получатели автора не видят. Подключается после app.js и пользуется его
// S, api, esc, openModal/closeModal. Тот же файл лежит в веб-клиенте (server/src/public/chat/announce.js): правьте оба вместе.

const AN = { kind: 'chat', text: '', pick: false, who: new Set(), duration: 60, wk: 'now', when: 0, err: '', busy: false,
  chats: [], users: [], picker: false, vm: new Date(), day: null, hh: '', mm: '', q: '', only: false, lim: 60, tab: 'msg', narrow: false };
const AN_KINDS = {
  chat:   ['В чаты',      'Строка от системы в группах и комнатах, остаётся в переписке'],
  popup:  ['Всплывающее', 'Карточка у тех, кто в сети в момент отправки'],
  banner: ['Полоса',      'Тонкая полоса сверху на заданное время, догоняет тех, кого не было в сети'],
};
const AN_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const AN_SEARCH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const AN_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const AN_DURS = [[15, '15 мин'], [60, '1 ч'], [180, '3 ч'], [1440, 'Сутки']];

// Администраторам кнопка доступна всегда; остальным её включает админ в карточке пользователя.
// Право узнаём при входе и сразу по сообщению сервера
const annCan = () => !!(S.user?.is_admin || S.user?.can_announce);
function annSetAllowed(v) {
  v = !!v;
  if (S.user && !!S.user.can_announce !== v) { S.user.can_announce = v; try { saveSession(); } catch {} }
  const b = document.getElementById('btn-announce');
  if (b) b.style.display = annCan() ? '' : 'none';
  if (!annCan()) closeModal('modal-announce');
}
async function annSync() {
  annSetAllowed(!!S.user?.can_announce);
  const me = await api('GET', '/auth/me');
  if (me?.id) {
    if (S.user && !!S.user.is_admin !== !!me.is_admin) { S.user.is_admin = !!me.is_admin; try { saveSession(); } catch {} }
    annSetAllowed(!!me.can_announce);
  }
}

async function openAnnounce() {
  if (!annCan()) return;
  let box = document.getElementById('modal-announce');
  if (!box) {
    box = document.createElement('div');
    box.className = 'modal-bg';
    box.id = 'modal-announce';
    box.onclick = e => { if (e.target === box) closeModal('modal-announce'); };
    box.innerHTML = '<div class="modal anx-modal" id="ann-box" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(box);
  }
  Object.assign(AN, { kind: 'chat', text: '', pick: false, who: new Set(), duration: 60, wk: 'now', when: 0, err: '', busy: false,
    picker: false, day: null, q: '', only: false, lim: 60, tab: 'msg', _items: null });
  annRender('ann-text', true);
  openModal('modal-announce');
  const t = await api('GET', '/announcements/targets');
  if (t?.chats) { AN.chats = t.chats; AN.users = t.users || []; AN._items = null; annRender(); }
  else if (t?.error) { AN.err = t.error; annRender(); }
}

const annChName = c => c.type === 'direct' ? ((c.member_names || []).join(' → ') || 'Личный чат') : (c.name || 'Группа');
const annInit = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const annPlural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;

// Маленьким считается окно уже 720 или ниже 600 пикселей (с учётом масштаба интерфейса)
function annNarrow() {
  let w = window.innerWidth, h = window.innerHeight;
  try { const m = zoomMetrics(); w = m.vw; h = m.vh; } catch {}
  return w < 720 || h < 600;
}

/* предпросмотр */
function annPreview() {
  const t = AN.text.trim() ? esc(AN.text.trim()) : '<span class="anx-ph">Текст появится здесь</span>';
  const hint = `<span class="anx-hint">${AN_KINDS[AN.kind][1]}</span>`;
  if (AN.kind === 'banner') return `<div class="anx-pv"><div class="anx-app"><i style="top:48px;width:46%"></i><i style="top:64px;width:62%"></i><i style="top:80px;width:38%"></i>
    <div class="anx-banner">${AN_BELL}<span>${t}</span><b aria-hidden="true">×</b></div></div>${hint}</div>`;
  if (AN.kind === 'popup') return `<div class="anx-pv"><div class="anx-app anx-dim"><i style="top:14px;width:40%"></i><i style="top:30px;width:58%"></i>
    <div class="anx-card"><div class="anx-ct"><span class="anx-ring">${AN_BELL}</span>Системное объявление</div><div class="anx-cx">${t}</div><span class="anx-ok">OK</span></div></div>${hint}</div>`;
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return `<div class="anx-pv"><div class="anx-feed"><i style="width:44%"></i><div class="anx-sys">${AN_BELL}<span>${t}</span><small>${time}</small></div><i style="width:30%;margin-left:auto"></i></div>${hint}</div>`;
}

/* время отправки */
function annTs() {
  const n = new Date(), at = (dd, h) => Math.floor(new Date(n.getFullYear(), n.getMonth(), n.getDate() + dd, h, 0).getTime() / 1000);
  switch (AN.wk) {
    case 'hour': return Math.floor(Date.now() / 1000) + 3600;
    case 'today': return at(0, 18);
    case 'tom': return at(1, 9);
    case 'custom': return AN.when;
    default: return 0;
  }
}
const annDate = ts => new Date(ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const annWhenText = () => AN.wk === 'now' ? 'Сейчас' : annDate(annTs());
const annVerb = () => AN.wk === 'now' ? 'Отправить' : 'Запланировать';
function annWhenChips() {
  const chips = [['now', 'Сейчас'], ['hour', 'Через час']];
  if (new Date().getHours() < 18) chips.push(['today', 'Сегодня 18:00']);
  chips.push(['tom', 'Завтра 09:00']);
  return chips;
}

/* получатели */
function annItems() {
  const key = AN.kind + ':' + AN.chats.length + ':' + AN.users.length;
  if (AN._items?.key === key) return AN._items.list;
  const chat = AN.kind === 'chat';
  const list = (chat
    ? AN.chats.map(c => ({ id: c.id, name: annChName(c), type: c.type, user: false, sub: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа', tag: '' }))
    : AN.users.map(u => ({ id: u.id, name: u.display_name || u.username, user: true, sub: '@' + u.username, tag: u.tag || '' })))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  AN._items = { key, list };
  return list;
}
// «Всем» для чатов — только группы и комнаты, личные переписки без выбора не затрагиваются
const annAllCount = () => AN.kind === 'chat' ? annItems().filter(p => p.type !== 'direct').length : annItems().length;
const annCount = () => AN.pick ? AN.who.size : annAllCount();
const annNoun = n => AN.kind === 'chat' ? annPlural(n, 'чат', 'чата', 'чатов') : annPlural(n, 'человек', 'человека', 'человек');
const annMatch = p => { const q = AN.q.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || (p.tag || '').toLowerCase().includes(q); };

function annAv(p) {
  const init = esc(annInit(p.name)), base = `${httpProto()}://${S.server}/api`;
  if (p.user) return `<span class="pp-av anx-av ${userAvatarColor(p.id, p.tag)}"><span>${init}</span><img src="${base}/users/${p.id}/avatar" loading="lazy" alt="" onerror="this.style.display='none'"></span>`;
  const cls = p.type === 'room' ? 'av-orange' : p.type === 'group' ? 'av-green' : 'av-blue';
  return `<span class="pp-av anx-av ${cls}"><span>${p.type === 'room' ? '🏠' : init}</span>${p.type === 'direct' ? '' : `<img src="${base}/chats/${p.id}/avatar" loading="lazy" alt="" onerror="this.style.display='none'">`}</span>`;
}
const annTag = p => p.user ? (p.tag ? `<span class="role-pill ${senderNameClass(p.tag)} anx-tg">${esc(p.tag)}</span>` : '') : `<span class="anx-tg2">${esc(p.sub)}</span>`;
function annRow(p) {
  return `<button type="button" class="anx-li" aria-pressed="${AN.who.has(p.id)}" onclick="annPick(${p.id})">${annAv(p)}<span class="anx-lt"><b>${esc(p.name)}</b>${p.user ? `<span>${esc(p.sub)}</span>` : ''}</span>${annTag(p)}</button>`;
}
function annList() {
  const f = annItems().filter(p => annMatch(p) && (!AN.only || AN.who.has(p.id))), shown = f.slice(0, AN.lim);
  if (!shown.length) return `<div class="anx-empty">${annItems().length ? 'Ничего не найдено. Измените запрос' : (AN.err ? '' : 'Загружаю…')}</div>`;
  let last = '';
  return shown.map(p => { const l = (p.name[0] || '?').toUpperCase(), h = l !== last ? `<div class="anx-letter">${esc(l)}</div>` : ''; last = l; return h + annRow(p); }).join('')
    + (f.length > shown.length ? `<button type="button" class="anx-btn sm" style="align-self:center;margin:6px 0;flex-shrink:0" onclick="annMore()">Показать ещё ${Math.min(60, f.length - shown.length)} из ${f.length - shown.length}</button>` : '');
}

/* половины окна */
function annLeft(head) {
  const miss = annMissing(), chips = annWhenChips();
  return `<div class="anx-half l">${head ? `<div class="modal-hdr anx-hdr"><div><div class="anx-title">Новое объявление</div><div class="anx-sub">Текст, тип и время</div></div></div>` : ''}
    <div class="anx-pvw" id="ann-pv">${annPreview()}</div>
    <div class="anx-lbd"><div class="anx-types" role="radiogroup" aria-label="Тип объявления">${Object.entries(AN_KINDS).map(([k, v]) =>
        `<button type="button" role="radio" aria-checked="${AN.kind === k}" onclick="annSet('kind','${k}')">${v[0]}</button>`).join('')}</div>
      <textarea id="ann-text" class="anx-ta" placeholder="Что сказать людям" aria-label="Текст объявления" oninput="annTextInput(this.value)">${esc(AN.text)}</textarea>
      <div class="anx-f"><label>Когда</label><div class="anx-chs">${chips.map(([k, l]) => `<button type="button" class="anx-ch" aria-pressed="${AN.wk === k}" onclick="annWhen('${k}')">${l}</button>`).join('')}<button type="button" class="anx-ch" aria-pressed="${AN.wk === 'custom'}" onclick="annPicker()">${AN.wk === 'custom' ? esc(annDate(AN.when)) : 'Другое…'}</button></div>${AN.picker ? annPickerHtml() : ''}</div>
      ${AN.kind === 'banner' ? `<div class="anx-f"><label>Показывать</label><div class="anx-chs">${AN_DURS.map(([d, l]) => `<button type="button" class="anx-ch" aria-pressed="${Number(AN.duration) === d}" onclick="annDur(${d})">${l}</button>`).join('')}</div></div>` : ''}</div>
    ${head ? `<div class="anx-foot"><span class="anx-note ${miss.length ? '' : 'ok'}" id="ann-note">${annNote(miss)}</span>
      <button type="button" class="anx-btn" onclick="closeModal('modal-announce')">Отмена</button>
      <button type="button" class="anx-btn anx-solid" id="ann-go" ${AN.busy || miss.length ? 'disabled' : ''} onclick="annSend()">${annGoText()}</button></div>` : ''}</div>`;
}
function annRight(head) {
  const chat = AN.kind === 'chat', items = annItems(), all = !AN.pick;
  const fq = items.filter(annMatch), q = AN.q.trim();
  const allPicked = fq.length > 0 && fq.every(p => AN.who.has(p.id));
  const bulk = `<div class="anx-bulk"><button type="button" class="anx-btn sm" onclick="annSelFound()" ${fq.length && !allPicked ? '' : 'disabled'}>${q ? 'Выбрать найденных' : 'Выбрать всех'} (${fq.length})</button><button type="button" class="anx-btn sm" onclick="annUnsel()" ${AN.who.size ? '' : 'disabled'}>Снять</button>
      <label class="anx-only"><input type="checkbox" ${AN.only ? 'checked' : ''} onchange="annOnly(this.checked)">Только выбранные</label></div>`;
  return `<div class="anx-half r">${head ? `<div class="modal-hdr anx-hdr"><div class="anx-title">${chat ? 'Куда отправить' : 'Кому отправить'}</div>
      <button class="icon-btn" aria-label="Закрыть" onclick="closeModal('modal-announce')" style="width:28px;height:28px">${AN_X}</button></div>` : ''}
    <div class="anx-rbar"><div class="anx-rhead"><span class="anx-t2">${all ? (chat ? 'Во все чаты' : 'Получат все') : 'Получатели'}</span>
        <div class="anx-sg"><button type="button" aria-pressed="${all}" onclick="annSet('pick',false)">${chat ? 'Все чаты' : 'Всем'}</button><button type="button" aria-pressed="${!all}" onclick="annSet('pick',true)">${chat ? 'Выбранные' : 'Выбранным'}</button></div></div>
      <label class="anx-search">${AN_SEARCH}<input id="ann-pq" value="${esc(AN.q)}" placeholder="${chat ? 'Название чата' : 'Имя, логин или тег'}" autocomplete="off" ${all ? 'disabled' : ''} oninput="annSearch(this.value)"></label>${all ? '' : bulk}</div>
    <div class="anx-rlist">${all ? `<div class="anx-lock"><b>${chat ? 'Во все группы и комнаты' : `Получат все ${annAllCount()}`}</b>${chat ? `Строка появится в ${annAllCount()} ${annPlural(annAllCount(), 'чате', 'чатах', 'чатах')}.` : 'Объявление уйдёт каждому.'} Нажмите «${chat ? 'Выбранные' : 'Выбранным'}», чтобы отметить ${chat ? 'чаты' : 'людей'}.</div>` : ''}${annList()}</div>
    <div class="anx-rfoot"><span>Выбрано <b>${all ? annAllCount() : AN.who.size}</b> из ${all && chat ? annAllCount() : items.length}</span>${!all && AN.who.size ? `<button type="button" class="anx-btn sm" style="margin-left:auto" onclick="annClear()">Очистить</button>` : ''}</div></div>`;
}

function annMissing() {
  const m = [];
  if (!AN.text.trim()) m.push('текст');
  if (AN.pick && !AN.who.size) m.push(AN.kind === 'chat' ? 'чаты' : 'получателей');
  if (AN.kind === 'banner' && !(Number(AN.duration) > 0)) m.push('время показа');
  return m;
}
const annNote = miss => AN.err ? `<span class="anx-err">${esc(AN.err)}</span>` : miss.length ? `Осталось: <b>${miss.join(', ')}</b>` : '<b>Всё готово</b>';
function annGoText() {
  if (AN.busy) return 'Отправляю…';
  const n = annCount();
  return n ? `${annVerb()} · ${n} ${annNoun(n)}` : annVerb();
}
// Подвал и предпросмотр обновляются на лету, без перерисовки: иначе пропадёт курсор в тексте
function annFootSync() {
  const miss = annMissing(), n = document.getElementById('ann-note'), b = document.getElementById('ann-go');
  if (n) { n.innerHTML = annNote(miss); n.classList.toggle('ok', !miss.length && !AN.err); }
  if (b) { b.disabled = AN.busy || !!miss.length; b.textContent = annGoText(); }
}
function annTextInput(v) { AN.text = v; AN.err = ''; document.getElementById('ann-pv').innerHTML = annPreview(); annFootSync(); }

function annRender(focusId, resetList) {
  const el = document.getElementById('ann-box');
  if (!el) return;
  const a = document.activeElement, keep = focusId || (a?.id && el.contains(a) ? a.id : null);
  let caret = null; try { caret = a?.selectionStart; } catch {}
  const sl = el.querySelector('.anx-lbd')?.scrollTop || 0, sr = resetList ? 0 : (el.querySelector('.anx-rlist')?.scrollTop || 0);
  AN.narrow = annNarrow();
  el.classList.toggle('anx-tabs', AN.narrow);
  const miss = annMissing();
  if (AN.narrow) {
    const pill = AN.pick ? AN.who.size : 'все';
    el.innerHTML = `<div class="modal-hdr anx-hdr"><div class="anx-title">Новое объявление</div>
        <button class="icon-btn" aria-label="Закрыть" onclick="closeModal('modal-announce')" style="width:28px;height:28px">${AN_X}</button></div>
      <div class="anx-tabsbar" role="tablist"><button type="button" role="tab" aria-selected="${AN.tab === 'msg'}" onclick="annTab('msg')">Сообщение</button>
        <button type="button" role="tab" aria-selected="${AN.tab === 'who'}" onclick="annTab('who')">Получатели<span class="anx-pill ${AN.pick && !AN.who.size ? '' : 'on'}">${pill}</span></button></div>
      ${AN.tab === 'msg' ? annLeft(false) : annRight(false)}
      <div class="anx-foot"><span class="anx-note ${miss.length ? '' : 'ok'}" id="ann-note">${annNote(miss)}</span>
        <button type="button" class="anx-btn anx-solid" id="ann-go" ${AN.busy || miss.length ? 'disabled' : ''} onclick="annSend()">${annGoText()}</button></div>`;
  } else el.innerHTML = annLeft(true) + annRight(true);
  const f = keep && document.getElementById(keep);
  if (f) { f.focus(); try { if (caret != null) f.setSelectionRange(caret, caret); } catch {} }
  const l = el.querySelector('.anx-lbd'), r = el.querySelector('.anx-rlist');
  if (l && sl) l.scrollTop = sl;
  if (r && sr) r.scrollTop = sr;
}
// При изменении размера окна половины сами превращаются во вкладки и обратно
window.addEventListener('resize', () => {
  if (!document.getElementById('modal-announce')?.classList.contains('open')) return;
  if (annNarrow() !== AN.narrow) annRender();
});

function annSet(key, value) {
  if (AN[key] === value) return;
  AN[key] = value;
  if (key === 'kind') { AN.who = new Set(); AN.q = ''; AN.only = false; AN.lim = 60; }
  AN.err = '';
  annRender(null, key === 'kind');
}
function annTab(t) { AN.tab = t; annRender(null, true); }
function annSearch(v) { AN.q = v; AN.lim = 60; annRender('ann-pq', true); }
function annOnly(v) { AN.only = v; AN.lim = 60; annRender(null, true); }
function annMore() { AN.lim += 60; annRender(); }
function annPick(id) { AN.who.has(id) ? AN.who.delete(id) : AN.who.add(id); AN.err = ''; annRender(); }
function annSelFound() { annItems().filter(annMatch).forEach(p => AN.who.add(p.id)); annRender(); }
function annUnsel() {
  if (AN.q.trim()) annItems().filter(annMatch).forEach(p => AN.who.delete(p.id)); else AN.who.clear();
  annRender();
}
function annClear() { AN.who.clear(); annRender(); }
function annDur(d) { AN.duration = d; annRender(); }

/* выбор времени */
function annWhen(k) { AN.wk = k; AN.picker = false; AN.err = ''; annRender(); }
function annPickerHtml() {
  const y = AN.vm.getFullYear(), m = AN.vm.getMonth(), today = new Date(); today.setHours(0, 0, 0, 0);
  const shift = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  const cells = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(d => `<div class="anx-dow">${d}</div>`);
  for (let i = 0; i < shift; i++) cells.push('<div></div>');
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d), cls = ['anx-day'];
    if (+date === +today) cls.push('today');
    if (AN.day && +date === +AN.day) cls.push('sel');
    cells.push(`<button type="button" class="${cls.join(' ')}" ${date < today ? 'disabled' : ''} onclick="annDay(${y},${m},${d})">${d}</button>`);
  }
  return `<div class="anx-pick"><div class="anx-ph2"><button type="button" onclick="annShift(-1)" aria-label="Предыдущий месяц">‹</button><b>${AN.vm.toLocaleDateString('ru', { month: 'long', year: 'numeric' })}</b><button type="button" onclick="annShift(1)" aria-label="Следующий месяц">›</button></div>
    <div class="anx-grid">${cells.join('')}</div>
    <div class="anx-pf"><span class="anx-time"><input id="ann-hh" maxlength="2" inputmode="numeric" value="${esc(AN.hh)}" aria-label="Часы" oninput="annTime()">:<input id="ann-mm" maxlength="2" inputmode="numeric" value="${esc(AN.mm)}" aria-label="Минуты" oninput="annTime()"></span>
      <button type="button" class="anx-btn" style="margin-left:auto" onclick="annWhen('now')">Сейчас</button><button type="button" class="anx-btn anx-solid" onclick="annApply()">Готово</button></div></div>`;
}
function annPicker() {
  AN.picker = !AN.picker;
  if (AN.picker) {
    const base = AN.when ? new Date(AN.when * 1000) : new Date(Date.now() + 3600e3);
    AN.vm = new Date(base.getFullYear(), base.getMonth(), 1);
    AN.day = AN.when ? new Date(base.getFullYear(), base.getMonth(), base.getDate()) : null;
    AN.hh = String(base.getHours()).padStart(2, '0'); AN.mm = String(base.getMinutes()).padStart(2, '0');
  }
  annRender();
  if (AN.picker) document.querySelector('.anx-pick')?.scrollIntoView({ block: 'nearest' });
}
function annShift(d) { AN.vm = new Date(AN.vm.getFullYear(), AN.vm.getMonth() + d, 1); annRender(); }
function annDay(y, m, d) { AN.day = new Date(y, m, d); annRender(); }
function annTime() {
  const h = document.getElementById('ann-hh'), m = document.getElementById('ann-mm');
  h.value = h.value.replace(/\D/g, '').slice(0, 2); m.value = m.value.replace(/\D/g, '').slice(0, 2);
  AN.hh = h.value; AN.mm = m.value;
}
function annApply() {
  if (!AN.day) { AN.err = 'Выберите день'; return annRender(); }
  const h = Math.min(23, Number(AN.hh) || 0), m = Math.min(59, Number(AN.mm) || 0);
  const at = new Date(AN.day.getFullYear(), AN.day.getMonth(), AN.day.getDate(), h, m).getTime() / 1000;
  if (at <= Date.now() / 1000) { AN.err = 'Время должно быть в будущем'; return annRender(); }
  AN.when = Math.floor(at); AN.wk = 'custom'; AN.picker = false; AN.err = ''; annRender();
}

async function annSend() {
  if (AN.busy) return;
  const text = AN.text.trim(), dur = Number(AN.duration), ts = annTs();
  AN.err = !text ? 'Напишите текст объявления'
    : AN.pick && !AN.who.size ? (AN.kind === 'chat' ? 'Выберите хотя бы один чат' : 'Выберите получателей')
    : AN.kind === 'banner' && !(dur > 0) ? 'Укажите, сколько показывать полосу'
    : AN.wk !== 'now' && ts <= Date.now() / 1000 ? 'Выбранное время уже прошло' : '';
  if (AN.err) { if (AN.narrow) AN.tab = text && AN.pick && !AN.who.size ? 'who' : 'msg'; return annRender(!text ? 'ann-text' : null); }
  AN.busy = true; annRender();
  const r = await api('POST', '/announcements', {
    kind: AN.kind, text, target: AN.pick ? 'select' : 'all', targets: [...AN.who],
    start_at: ts, duration_min: AN.kind === 'banner' ? dur : 0,
  });
  AN.busy = false;
  if (!r?.ok) { AN.err = r?.error || 'Не удалось отправить'; return annRender(); }
  closeModal('modal-announce');
  showActionToast(r.scheduled ? `Запланировано на ${annDate(ts)}` : 'Объявление отправлено');
}
