// ── ОБЪЯВЛЕНИЯ ИЗ КЛИЕНТА ──
// Кнопка с колокольчиком в шапке сайдбара видна администраторам и тем, кому админ включил право «Отправлять объявления».
// Окно устроено как быстрое окно в админке: тип, текст и предпросмотр на виду, время и получатели под «Дополнительно».
// Людей и чаты в больших списках выбирают отдельным листом поверх окна: поиск, фильтры, группы, массовые действия.
// Объявление уходит от имени системы, получатели автора не видят. Подключается после app.js и пользуется его
// S, api, esc, openModal/closeModal. Тот же файл лежит в веб-клиенте (server/src/public/chat/announce.js): правьте оба вместе.

const AN = { kind: 'chat', text: '', pick: false, who: new Set(), duration: 60, when: null, err: '', busy: false, more: false,
  chats: [], users: [], picker: false, vm: new Date(), day: null, hh: '', mm: '', pk: null };
const AN_KINDS = {
  chat:   ['В чаты',      'Строка от системы в группах и комнатах — останется в переписке'],
  popup:  ['Всплывающее', 'Карточка поверх окна у тех, кто в сети в момент отправки'],
  banner: ['Полоса',      'Тонкая полоса сверху, держится заданное время и догоняет тех, кого не было в сети'],
};
const AN_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
const AN_SEARCH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

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
  Object.assign(AN, { kind: 'chat', text: '', pick: false, who: new Set(), duration: 60, when: null, err: '', busy: false, more: false, picker: false, day: null, pk: null });
  annRender('ann-text');
  openModal('modal-announce');
  const t = await api('GET', '/announcements/targets');
  if (t?.chats) { AN.chats = t.chats; AN.users = t.users || []; annRender(); }
  else if (t?.error) { AN.err = t.error; annRender(); }
}

const annChName = c => c.type === 'direct' ? ((c.member_names || []).join(' → ') || 'Личный чат') : (c.name || 'Группа');
const annInit = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const annPlural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;

function annPreview() {
  const t = AN.text.trim() ? esc(AN.text.trim()) : '<span class="anx-ph">Текст появится здесь</span>';
  if (AN.kind === 'banner') return `<div class="anx-pv"><div class="anx-app"><i style="top:48px;width:46%"></i><i style="top:64px;width:62%"></i><i style="top:80px;width:38%"></i>
    <div class="anx-banner">${AN_BELL}<span>${t}</span><b aria-hidden="true">×</b></div></div>
    <span class="anx-hint">Тонкая полоса сверху поверх окна: пока не истечёт время или человек её не закроет</span></div>`;
  if (AN.kind === 'popup') return `<div class="anx-pv"><div class="anx-app anx-dim"><i style="top:16px;width:40%"></i><i style="top:32px;width:58%"></i><i style="top:48px;width:34%"></i>
    <div class="anx-card"><div class="anx-ct"><span class="anx-ring">${AN_BELL}</span>Системное объявление</div><div class="anx-cx">${t}</div><span class="anx-ok">OK</span></div></div>
    <span class="anx-hint">Карточка по центру поверх затемнённого окна у тех, кто сейчас в сети; закрывается кнопкой OK</span></div>`;
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return `<div class="anx-pv"><div class="anx-feed"><i style="width:44%"></i><div class="anx-sys">${AN_BELL}<span>${t}</span><small>${time}</small></div><i style="width:30%;margin-left:auto"></i></div>
    <span class="anx-hint">Строка по центру ленты в выбранных группах и комнатах: остаётся в переписке</span></div>`;
}

const annWhenText = () => AN.when ? new Date(AN.when * 1000).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Сейчас';
const annVerb = () => AN.when ? 'Запланировать' : 'Отправить';
function annMissing() {
  const m = [];
  if (!AN.text.trim()) m.push('текст');
  if (AN.pick && !AN.who.size) m.push(AN.kind === 'chat' ? 'чаты' : 'получателей');
  if (AN.kind === 'banner' && !(Number(AN.duration) > 0)) m.push('время показа');
  return m;
}
const annNote = miss => miss.length ? `Осталось: <b>${miss.join(', ')}</b>` : '<b>Всё готово</b>';
// Подвал и предпросмотр обновляются на лету, без перерисовки: иначе пропадёт курсор в тексте
function annFootSync() {
  const miss = annMissing(), n = document.getElementById('ann-note'), b = document.getElementById('ann-go');
  if (n) { n.innerHTML = annNote(miss); n.classList.toggle('ok', !miss.length); }
  if (b) { b.disabled = AN.busy || !!miss.length; b.textContent = AN.busy ? 'Отправляю…' : annVerb(); }
}
function annTextInput(v) { AN.text = v; document.getElementById('ann-pv').innerHTML = annPreview(); annFootSync(); }

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
      <button type="button" class="anx-btn" style="margin-left:auto" onclick="annNow()">Сейчас</button><button type="button" class="anx-btn anx-solid" onclick="annApply()">Готово</button></div></div>`;
}

/* получатели */
const annItems = () => AN.kind === 'chat'
  ? AN.chats.map(c => ({ id: c.id, name: annChName(c), sub: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа', tag: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа' }))
  : AN.users.map(u => ({ id: u.id, name: u.display_name || u.username, sub: '@' + u.username, tag: u.tag || '' }));
const annNoun = n => AN.kind === 'chat' ? annPlural(n, 'чат', 'чата', 'чатов') : annPlural(n, 'человек', 'человека', 'человек');
function annFound() {
  const k = AN.pk, q = k.q.trim().toLowerCase();
  return annItems().filter(p => (!q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q))
    && (!k.g || (p.tag || 'Без тега') === k.g) && (k.f === 'all' || (k.f === 'sel') === AN.who.has(p.id)));
}
function annSummary() {
  const items = annItems(), chosen = items.filter(p => AN.who.has(p.id)), chat = AN.kind === 'chat';
  const short = n => n.length > 22 ? n.slice(0, 21) + '…' : n;
  const chips = chosen.slice(0, 5).map(p => `<span class="anx-chip static">${esc(short(p.name))}<button type="button" aria-label="Убрать" onclick="annRm(${p.id})">×</button></span>`).join('')
    + (chosen.length > 5 ? `<button type="button" class="anx-chip cnt" onclick="annPkOpen()">+${chosen.length - 5}</button>` : '');
  return `<div class="anx-pickrow"><div class="anx-pickhead"><span class="anx-pill ${chosen.length ? 'on' : ''}">${chosen.length ? `${chosen.length} ${annNoun(chosen.length)}` : 'никого'}</span><span class="anx-hint">из ${items.length}</span></div>
    ${chips ? `<div class="anx-chips2">${chips}</div>` : ''}
    <div class="anx-pickacts"><button type="button" class="anx-btn anx-solid sm" onclick="annPkOpen()">${chat ? 'Выбрать чаты…' : 'Выбрать людей…'}</button><button type="button" class="anx-btn sm" onclick="annAll()">Добавить всех (${items.length})</button>${chosen.length ? '<button type="button" class="anx-btn sm" onclick="annClear()">Очистить</button>' : ''}</div></div>`;
}
function annSheet() {
  const k = AN.pk; if (!k) return '';
  const items = annItems(), chat = AN.kind === 'chat';
  const gm = new Map(); items.forEach(p => { const g = p.tag || 'Без тега'; gm.set(g, (gm.get(g) || 0) + 1); });
  const groups = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  k.groups = groups.map(g => g[0]);
  if (k.g && !k.groups.includes(k.g)) k.g = '';
  const found = annFound(), shown = found.slice(0, k.limit), allSel = found.length > 0 && found.every(p => AN.who.has(p.id));
  return `<div class="anx-sheet"><div class="anx-sh"><button type="button" class="icon-btn" onclick="annPkClose()" aria-label="Назад" style="width:28px;height:28px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
      <div><div class="anx-title">${chat ? 'Куда отправить' : 'Кому отправить'}</div><div class="anx-sub">${items.length} ${chat ? 'чатов' : 'людей'}: найдите, отметьте, нажмите «Готово»</div></div><span class="anx-pill on" style="margin-left:auto">${AN.who.size}</span></div>
    <div class="anx-tools"><label class="anx-search">${AN_SEARCH}<input id="ann-pq" value="${esc(k.q)}" placeholder="Имя, логин или тег" autocomplete="off" oninput="annPkSearch(this.value)"></label>
      <div class="anx-grp" role="group" aria-label="Показать">${[['all', 'Все', items.length], ['sel', 'Выбранные', AN.who.size], ['unsel', 'Не выбранные', items.length - AN.who.size]].map(([v, l, n]) => `<button type="button" onclick="annPkFilter('${v}')" aria-pressed="${k.f === v}">${l}<small>${n}</small></button>`).join('')}</div>
      ${groups.length > 1 ? `<div class="anx-grp" role="group" aria-label="Группа"><button type="button" onclick="annPkGroup(-1)" aria-pressed="${!k.g}">Все группы</button>${groups.map((g, i) => `<button type="button" onclick="annPkGroup(${i})" aria-pressed="${k.g === g[0]}">${esc(g[0])}<small>${g[1]}</small></button>`).join('')}</div>` : ''}
      <div class="anx-acts"><button type="button" class="anx-btn sm" onclick="annSelFound()" ${found.length && !allSel ? '' : 'disabled'}>Выбрать найденных (${found.length})</button><button type="button" class="anx-btn sm" onclick="annUnselFound()" ${found.some(p => AN.who.has(p.id)) ? '' : 'disabled'}>Снять</button></div></div>
    <div class="anx-list">${shown.map(p => `<button type="button" class="anx-li" aria-pressed="${AN.who.has(p.id)}" onclick="annPick(${p.id})"><span class="anx-av">${esc(annInit(p.name))}</span><span class="anx-lt"><b>${esc(p.name)}</b><span>${esc(p.sub)}</span></span>${p.tag ? `<span class="anx-tg2">${esc(p.tag)}</span>` : ''}<span class="anx-chk" aria-hidden="true">${AN.who.has(p.id) ? '✓' : ''}</span></button>`).join('') || `<div class="anx-empty">${items.length ? 'Ничего не найдено. Измените запрос или фильтр' : 'Загружаю…'}</div>`}
      ${found.length > shown.length ? `<button type="button" class="anx-btn sm" style="align-self:center;margin:4px 0" onclick="annPkMore()">Показать ещё ${Math.min(40, found.length - shown.length)} из ${found.length - shown.length}</button>` : ''}</div>
    <div class="anx-sf"><span class="anx-note">Выбрано <b>${AN.who.size}</b> из ${items.length}</span><button type="button" class="anx-btn anx-solid" onclick="annPkClose()">Готово</button></div></div>`;
}

function annRender(focusId, keepScroll) {
  const el = document.getElementById('ann-box');
  if (!el) return;
  const a = document.activeElement, keep = focusId || (a?.id && el.contains(a) ? a.id : null);
  let caret = null; try { caret = a?.selectionStart; } catch {}
  const sc = keepScroll ? el.querySelector('.anx-list')?.scrollTop : 0;
  const chat = AN.kind === 'chat', miss = annMissing();
  const whenSu = annWhenText() + (AN.kind === 'banner' ? ` · показывать ${AN.duration} мин` : '');
  const audSu = !AN.pick ? (chat ? 'Во все группы и комнаты' : 'Всем') : AN.who.size ? `Выбрано: ${AN.who.size}` : (chat ? 'Выберите чаты' : 'Выберите получателей');
  const secs = [
    { id: 'w', t: 'Когда', su: whenSu, body: `<div class="anx-row2"><div class="anx-f"><label>Отправить</label><button type="button" class="anx-when" onclick="annPicker()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/></svg><span>${esc(annWhenText())}</span></button>${AN.picker ? annPickerHtml() : ''}</div>
        ${AN.kind === 'banner' ? `<div class="anx-f"><label for="ann-dur">Показывать, мин</label><input id="ann-dur" class="anx-in" type="number" min="1" max="10080" value="${esc(AN.duration)}" oninput="AN.duration=this.value;annFootSync()"><span class="anx-hint">Потом полоса исчезнет сама</span></div>` : '<div></div>'}</div>` },
    { id: 'a', t: chat ? 'Куда' : 'Кому', su: audSu, body: `<div class="anx-seg"><button type="button" aria-pressed="${!AN.pick}" onclick="annSet('pick',false)">${chat ? 'Во все группы и комнаты' : 'Всем'}</button><button type="button" aria-pressed="${AN.pick}" onclick="annSet('pick',true)">${chat ? 'Выбрать чаты' : 'Выбрать людей'}</button></div>
      ${AN.pick ? annSummary() : ''}${AN.kind === 'popup' ? '<span class="anx-hint">Всплывающее увидят только те, кто сейчас в сети</span>' : ''}` },
  ];
  const more = `<div class="anx-more ${AN.more ? 'open' : ''}"><button type="button" onclick="annMore()" aria-expanded="${AN.more}"><span>Дополнительно</span><span class="anx-hint">2 раздела</span><span class="ch">›</span></button>
    ${AN.more ? `<div class="anx-mb">${secs.map(s => `<section class="anx-sec" id="ann-sec-${s.id}"><h4>${s.t}</h4>${s.body}</section>`).join('')}</div>`
      : `<div class="anx-chips">${secs.map(s => `<button type="button" class="anx-chip" onclick="annMore('${s.id}')">${s.t}: <b>${esc(s.su)}</b></button>`).join('')}</div>`}</div>`;
  el.innerHTML = `<div class="modal-hdr anx-hdr"><div><div class="anx-title">Новое объявление</div><div class="anx-sub">Тип, текст и куда отправить</div></div>
      <button class="icon-btn" aria-label="Закрыть" onclick="closeModal('modal-announce')" style="width:28px;height:28px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="anx-body">
      <div class="anx-kinds" role="radiogroup" aria-label="Тип объявления">${Object.entries(AN_KINDS).map(([k, v]) =>
        `<button type="button" role="radio" class="anx-kind" aria-checked="${AN.kind === k}" onclick="annSet('kind','${k}')"><b>${v[0]}</b><span>${v[1]}</span></button>`).join('')}</div>
      <div class="anx-f"><label for="ann-text">Текст</label><textarea id="ann-text" class="anx-ta" placeholder="Что сказать людям" oninput="annTextInput(this.value)">${esc(AN.text)}</textarea></div>
      <div class="anx-f"><label>Так увидят</label><div id="ann-pv">${annPreview()}</div></div>
      ${more}</div>
    <div class="anx-foot">${AN.err ? `<span class="anx-err">${esc(AN.err)}</span>` : ''}<span class="anx-note ${miss.length ? '' : 'ok'}" id="ann-note">${annNote(miss)}</span>
      <button type="button" class="anx-btn" onclick="closeModal('modal-announce')">Отмена</button>
      <button type="button" class="anx-btn anx-solid" id="ann-go" ${AN.busy || miss.length ? 'disabled' : ''} onclick="annSend()">${AN.busy ? 'Отправляю…' : annVerb()}</button></div>${annSheet()}`;
  const f = keep && document.getElementById(keep);
  if (f) { f.focus(); try { if (caret != null) f.setSelectionRange(caret, caret); } catch {} }
  if (keepScroll && sc) { const l = el.querySelector('.anx-list'); if (l) l.scrollTop = sc; }
}
function annMore(id) { AN.more = id ? true : !AN.more; annRender(); if (id) setTimeout(() => document.getElementById('ann-sec-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40); }
function annSet(key, value) {
  AN[key] = value;
  if (key === 'kind') AN.who = new Set();
  if (key === 'pick' && value) AN.more = true;
  AN.err = '';
  annRender();
}
function annPkOpen() { AN.pk = { q: '', f: 'all', g: '', limit: 40, groups: [] }; annRender('ann-pq'); }
function annPkClose() { AN.pk = null; annRender(); }
function annPkSearch(v) { AN.pk.q = v; AN.pk.limit = 40; annRender('ann-pq'); }
function annPkFilter(v) { AN.pk.f = v; AN.pk.limit = 40; annRender(); }
function annPkGroup(i) { AN.pk.g = i < 0 ? '' : AN.pk.groups[i]; AN.pk.limit = 40; annRender(); }
function annPkMore() { AN.pk.limit += 40; annRender(null, true); }
function annPick(id) { AN.who.has(id) ? AN.who.delete(id) : AN.who.add(id); annRender(null, true); }
function annSelFound() { annFound().forEach(p => AN.who.add(p.id)); annRender(null, true); }
function annUnselFound() { annFound().forEach(p => AN.who.delete(p.id)); annRender(null, true); }
function annAll() { annItems().forEach(p => AN.who.add(p.id)); annRender(); }
function annClear() { AN.who.clear(); annRender(); }
function annRm(id) { AN.who.delete(id); annRender(); }
// Escape закрывает лист выбора, а не всё окно
document.addEventListener('keydown', e => { if (e.key === 'Escape' && AN.pk && document.getElementById('modal-announce')?.classList.contains('open')) { e.preventDefault(); e.stopImmediatePropagation(); annPkClose(); } }, true);

/* время отправки */
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
function annNow() { AN.when = null; AN.picker = false; AN.err = ''; annRender(); }
function annApply() {
  if (!AN.day) { AN.err = 'Выберите день'; return annRender(); }
  const h = Math.min(23, Number(AN.hh) || 0), m = Math.min(59, Number(AN.mm) || 0);
  const at = new Date(AN.day.getFullYear(), AN.day.getMonth(), AN.day.getDate(), h, m).getTime() / 1000;
  if (at <= Date.now() / 1000) { AN.err = 'Время должно быть в будущем'; return annRender(); }
  AN.when = Math.floor(at); AN.picker = false; AN.err = ''; annRender();
}

async function annSend() {
  if (AN.busy) return;
  const text = AN.text.trim(), dur = Number(AN.duration);
  AN.err = !text ? 'Напишите текст объявления'
    : AN.pick && !AN.who.size ? (AN.kind === 'chat' ? 'Выберите хотя бы один чат' : 'Выберите получателей')
    : AN.kind === 'banner' && !(dur > 0) ? 'Укажите, сколько минут показывать полосу' : '';
  if (AN.err) return annRender(!text ? 'ann-text' : null);
  AN.busy = true; annRender();
  const r = await api('POST', '/announcements', {
    kind: AN.kind, text, target: AN.pick ? 'select' : 'all', targets: [...AN.who],
    start_at: AN.when || 0, duration_min: AN.kind === 'banner' ? dur : 0,
  });
  AN.busy = false;
  if (!r?.ok) { AN.err = r?.error || 'Не удалось отправить'; return annRender(); }
  closeModal('modal-announce');
  showActionToast(r.scheduled ? `Запланировано на ${annWhenText()}` : 'Объявление отправлено');
}
