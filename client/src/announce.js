// ── ОБЪЯВЛЕНИЯ ИЗ КЛИЕНТА ──
// Кнопка с колокольчиком в шапке сайдбара видна тем, кому админ включил право «Отправлять объявления».
// Окно устроено как в админке: тип, текст, время, получатели. Объявление уходит от имени системы,
// получатели автора не видят. Подключается после app.js и пользуется его S, api, esc, openModal/closeModal.
// Тот же файл лежит в веб-клиенте (server/src/public/chat/announce.js): правьте оба вместе.

const AN = { kind: 'chat', text: '', pick: false, who: new Set(), q: '', duration: 60, when: null, err: '', busy: false,
  chats: [], users: [], picker: false, vm: new Date(), day: null, hh: '', mm: '' };
const AN_KINDS = {
  chat:   ['В чаты',      'Строка от системы в группах и комнатах — останется в переписке'],
  popup:  ['Всплывающее', 'Карточка поверх окна у тех, кто в сети в момент отправки'],
  banner: ['Полоса',      'Тонкая полоса сверху, держится заданное время и догоняет тех, кого не было в сети'],
};
const AN_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

// Право включает и отзывает админ: узнаём при входе и сразу по сообщению сервера
function annSetAllowed(v) {
  v = !!v;
  if (S.user && S.user.can_announce !== v) { S.user.can_announce = v; try { saveSession(); } catch {} }
  const b = document.getElementById('btn-announce');
  if (b) b.style.display = v ? '' : 'none';
  if (!v) closeModal('modal-announce');
}
async function annSync() {
  annSetAllowed(!!S.user?.can_announce);
  const me = await api('GET', '/auth/me');
  if (me?.id) annSetAllowed(!!me.can_announce);
}

async function openAnnounce() {
  if (!S.user?.can_announce) return;
  let box = document.getElementById('modal-announce');
  if (!box) {
    box = document.createElement('div');
    box.className = 'modal-bg';
    box.id = 'modal-announce';
    box.onclick = e => { if (e.target === box) closeModal('modal-announce'); };
    box.innerHTML = '<div class="modal anx-modal" id="ann-box" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(box);
  }
  Object.assign(AN, { kind: 'chat', text: '', pick: false, who: new Set(), q: '', duration: 60, when: null, err: '', busy: false, picker: false, day: null });
  annRender('ann-text');
  openModal('modal-announce');
  const t = await api('GET', '/announcements/targets');
  if (t?.chats) { AN.chats = t.chats; AN.users = t.users || []; if (AN.pick) annList(); }
  else if (t?.error) { AN.err = t.error; annRender(); }
}

const annChName = c => c.type === 'direct' ? ((c.member_names || []).join(' → ') || 'Личный чат') : (c.name || 'Группа');
const annInit = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

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

function annRender(focusId) {
  const el = document.getElementById('ann-box');
  if (!el) return;
  const a = document.activeElement, keep = focusId || (a?.id && el.contains(a) ? a.id : null);
  let caret = null; try { caret = a?.selectionStart; } catch {}
  const chat = AN.kind === 'chat';
  el.innerHTML = `<div class="modal-hdr anx-hdr"><div><div class="anx-title">Новое объявление</div><div class="anx-sub">Тип, текст, время и получатели</div></div>
      <button class="icon-btn" aria-label="Закрыть" onclick="closeModal('modal-announce')" style="width:28px;height:28px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="anx-body">
      <div class="anx-left">
        <div class="anx-f"><label>Так увидят</label><div id="ann-pv">${annPreview()}</div></div>
        <div class="anx-kinds" role="radiogroup" aria-label="Тип объявления">${Object.entries(AN_KINDS).map(([k, v]) =>
          `<button type="button" role="radio" class="anx-kind" aria-checked="${AN.kind === k}" onclick="annSet('kind','${k}')"><b>${v[0]}</b><span>${v[1]}</span></button>`).join('')}</div>
        <div class="anx-f"><label for="ann-text">Текст</label><textarea id="ann-text" class="anx-ta" placeholder="Что сказать людям" oninput="AN.text=this.value;document.getElementById('ann-pv').innerHTML=annPreview()">${esc(AN.text)}</textarea></div>
        <div class="anx-row2">
          <div class="anx-f"><label>Когда</label><button type="button" class="anx-when" onclick="annPicker()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/></svg><span>${esc(annWhenText())}</span></button>${AN.picker ? annPickerHtml() : ''}</div>
          ${AN.kind === 'banner' ? `<div class="anx-f"><label for="ann-dur">Показывать, мин</label><input id="ann-dur" class="anx-in" type="number" min="1" max="10080" value="${esc(AN.duration)}" oninput="AN.duration=this.value"><span class="anx-hint">Потом полоса исчезнет сама</span></div>` : '<div></div>'}
        </div>
      </div>
      <div class="anx-right">
        <div class="anx-f"><label>${chat ? 'Куда' : 'Кому'}${AN.pick ? ` <span class="anx-opt">· выбрано ${AN.who.size}</span>` : ''}</label>
          <div class="anx-seg"><button type="button" aria-pressed="${!AN.pick}" onclick="annSet('pick',false)">${chat ? 'Во все группы и комнаты' : 'Всем'}</button><button type="button" aria-pressed="${AN.pick}" onclick="annSet('pick',true)">${chat ? 'Выбрать чаты' : 'Выбрать людей'}</button></div>
          ${AN.pick ? `<input id="ann-q" class="anx-in" style="margin-top:8px" value="${esc(AN.q)}" placeholder="${chat ? 'Поиск чатов' : 'Поиск людей'}" oninput="AN.q=this.value;annList()" autocomplete="off"><div class="anx-list" id="ann-list">${annListHtml()}</div>` : ''}
          ${AN.kind === 'popup' ? '<span class="anx-hint">Всплывающее увидят только те, кто сейчас в сети</span>' : ''}</div>
      </div></div>
    <div class="anx-foot">${AN.err ? `<span class="anx-err">${esc(AN.err)}</span>` : ''}<span style="flex:1"></span>
      <button type="button" class="anx-btn" onclick="closeModal('modal-announce')">Отмена</button>
      <button type="button" class="anx-btn anx-solid" ${AN.busy ? 'disabled' : ''} onclick="annSend()">${AN.busy ? 'Отправляю…' : AN.when ? 'Запланировать' : 'Отправить'}</button></div>`;
  const f = keep && document.getElementById(keep);
  if (f) { f.focus(); try { if (caret != null) f.setSelectionRange(caret, caret); } catch {} }
}

function annListHtml() {
  const lq = AN.q.trim().toLowerCase(), chat = AN.kind === 'chat';
  const items = chat
    ? AN.chats.filter(c => !lq || annChName(c).toLowerCase().includes(lq)).sort((a, b) => annChName(a).localeCompare(annChName(b), 'ru', { numeric: true }))
        .map(c => ({ id: c.id, name: annChName(c), sub: c.type === 'room' ? 'комната' : c.type === 'direct' ? 'личный чат' : 'группа' }))
    : AN.users.filter(u => !lq || (u.display_name || '').toLowerCase().includes(lq) || (u.username || '').toLowerCase().includes(lq))
        .map(u => ({ id: u.id, name: u.display_name || u.username, sub: '@' + u.username }));
  return items.map(i => `<button type="button" class="anx-li" aria-pressed="${AN.who.has(i.id)}" onclick="annPick(${i.id})"><span class="anx-av">${esc(annInit(i.name))}</span>
      <span class="anx-lt"><b>${esc(i.name)}</b><span>${esc(i.sub)}</span></span><span class="anx-chk" aria-hidden="true">${AN.who.has(i.id) ? '✓' : ''}</span></button>`).join('')
    || `<div class="anx-empty">${AN.chats.length || AN.users.length ? 'Ничего не найдено' : 'Загружаю…'}</div>`;
}
function annList() { const e = document.getElementById('ann-list'); if (e) e.innerHTML = annListHtml(); }
function annPick(id) {
  AN.who.has(id) ? AN.who.delete(id) : AN.who.add(id);
  const sc = document.getElementById('ann-list')?.scrollTop || 0;
  annRender();
  const e = document.getElementById('ann-list'); if (e) e.scrollTop = sc;
}
function annSet(key, value) {
  AN[key] = value;
  if (key === 'kind') { AN.who = new Set(); AN.q = ''; }
  AN.err = '';
  annRender(key === 'pick' && value ? 'ann-q' : null);
}

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
