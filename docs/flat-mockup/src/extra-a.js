/* ═══ extra-a.js: состояния чата, секретные чаты, федерация, черновики ═══
   Разметка и тексты — из настоящего клиента (server/src/public/chat/app.js): composerNote, readOnlyBannerHtml, inviteBarHtml,
   fedDotRaw, groupSubHtml, scRenderBanner, scOpenDevices, renderChatRow. Весь код в функции, чтобы не пересекаться с extra-b. */
(function () {
const GLOBE = '<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
IC.monitor = '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>';
const FDOT = `<span class="fed-dot" title="С другого сервера">${GLOBE}</span>`;
const FCHIP = `<span class="ws-chip ws-fed" title="С другого сервера">${GLOBE}</span>`;

/* ---------- люди с других серверов: не попадают в Object.keys(PPL), поэтому их нет в «Новом чате» и «Добавить контакт» ---------- */
const addPerson = (k, o) => Object.defineProperty(PPL, k, { value: o, enumerable: false, configurable: true, writable: true });
addPerson('orlov', { n: 'Игорь Орлов', bg: '#d9a21a,#a06c06', ini: 'ИО', c: 'var(--tag-2)', login: 'iorlov', addr: '@north:iorlov', on: 1, fed: 1, ws: 'Сервер north' });
addPerson('vasina', { n: 'Вера Васина', bg: '#3b8fb8,#215a80', ini: 'ВВ', c: 'var(--tag-4)', login: 'vvasina', addr: '@north:vvasina', st: 'был(а) час назад', fed: 1, ws: 'Сервер north' });
addPerson('kuzmin', { n: 'Тимур Кузьмин', bg: '#8f6fe0,#5a3cb0', ini: 'ТК', c: 'var(--tag-1)', login: 'tkuzmin', addr: '@south:tkuzmin', on: 1, fed: 1, ws: 'Сервер south' });
S.contacts.add('orlov'); S.contacts.add('vasina');
MEMBERS.fedA = ['dmitry', 'petr', 'orlov', 'vasina', 'kuzmin'];
MEMBERS.fedB = ['kuzmin', 'vasina'];
MEMBERS.inv = ['orlov', 'kuzmin', 'dmitry'];

/* ---------- чаты: один раз при загрузке ---------- */
const NEWCH = {
  ann: { id: 'ann', k: 'room', n: 'Анонсы', bg: '#e8571f,#b83a0d', ico: 'bell', sq: 1, p: 'Администратор: Версия 2.4 выпущена', t: '10:40', u: 1, sub: 'Комната · в сети 4 из 12', f: 'work', ro: 1 },
  sec1: { id: 'sec1', k: 'dm', n: 'Анна Лебедева', bg: '#ff9a5a,#e8571f', ini: 'АЛ', on: 1, p: '<span class="sc-tag">Скрытый чат</span>', t: '10:15', sub: 'в сети', peer: 'anna', f: 'people', secret: 1, key: true },
  fedA: { id: 'fedA', k: 'group', n: 'Логистика: Север–Юг', bg: '#d9a21a,#a06c06', ini: 'ЛС', fed: 1, p: 'Игорь: Состав партии', t: '10:03', u: 2, sub: 'в сети 3 из 7', f: 'work' },
  fedB: { id: 'fedB', k: 'group', n: 'Поставщики', bg: '#8f6fe0,#5a3cb0', ini: 'П', fed: 1, fedOff: 1, p: 'Тимур: Следующая поставка в среду', t: 'вчера', sub: 'Группа на другом сервере · нет связи', f: 'work' },
  sec2: { id: 'sec2', k: 'dm', n: 'Алексей Крылов', bg: '#3b8fb8,#215a80', ini: 'АК', p: '<span class="sc-tag">Скрытый чат</span>', t: '08:48', sub: 'был(а) 12 минут назад', peer: 'akrylov', f: 'people', secret: 1, key: false, scMode: 'closed' },
  inv: { id: 'inv', k: 'group', n: 'Закупки: Север–Юг', bg: '#34a1a0,#1f6f78', ini: 'ЗС', fed: 1, invite: { from: 'Игорь Орлов' }, p: '<span style="color:var(--accent-ink)">Приглашение в группу</span>', t: '08:40', sub: 'Приглашение в группу', f: 'work' }
};
const after = (id, ...cs) => { const i = CHATS.findIndex(c => c.id === id); CHATS.splice(i + 1, 0, ...cs) };
after('room', NEWCH.ann);
after('marat', NEWCH.sec1);
after('dev', NEWCH.fedA);
after('team', NEWCH.fedB);
after('olga', NEWCH.sec2);
after('elena', NEWCH.inv);

Object.assign(CONVO, {
  fedA: [{ a: 'orlov', t: 'Коллеги, партия №14 вышла со склада, ожидаем у вас завтра к обеду', tm: '09:58' },
    { a: 'me', t: 'Приняли. Ячейки под новую партию уже готовы', tm: '10:00' },
    { a: 'vasina', t: 'Накладные приложу к вечеру', tm: '10:01' },
    { a: 'dmitry', t: 'Подключу вас к общему графику', tm: '10:02', re: ['👍 2'] },
    { a: 'orlov', file: ['Партия_14.xlsx', '48 КБ'], t: 'Состав партии', tm: '10:03' }],
  fedB: [{ a: 'kuzmin', t: 'Накладные отправили, проверьте почту', tm: 'вчера' }, { a: 'me', t: 'Получили, спасибо!', tm: 'вчера' }, { a: 'kuzmin', t: 'Следующая поставка в среду', tm: 'вчера' }],
  inv: [{ a: 'orlov', t: 'Добро пожаловать в группу!', tm: '08:40' }],
  sec1: [{ a: 'anna', t: 'Ключ у тебя уже на этом устройстве?', tm: '10:08' }, { a: 'me', t: 'Да, расшифровалось. Видишь сообщения?', tm: '10:10' },
    { a: 'anna', t: 'Вижу. Отправляю реквизиты, в секретном чате файлы по одному', tm: '10:12' },
    { a: 'anna', file: ['Реквизиты.pdf', '212 КБ'], t: 'Для договора', tm: '10:13' },
    { a: 'anna', pend: 1, t: 'Это сообщение ещё не расшифровано на этом устройстве, поэтому вместо текста полоски', tm: '10:15' }],
  sec2: [{ a: 'akrylov', t: 'Пароль от тестового стенда отправил отдельно', tm: '08:30' }, { a: 'me', t: 'Принято, зайду сегодня', tm: '08:34' }, { a: 'akrylov', t: 'И не пересылай эти сообщения никому', tm: '08:35' }],
  'a-rel': [{ a: 'admin', t: 'Версия 2.4 выпущена. Что нового: плоский вид интерфейса, гостевые ссылки на видеозвонок, исправлена отправка нескольких вложений', tm: '10:40', re: ['🎉 12', '👍 7|mine'] },
    { a: 'admin', file: ['Release_notes_2.4.pdf', '96 КБ'], t: 'Подробности в файле', tm: '10:41', re: ['👍 4'] }],
  'a-tech': [{ a: 'admin', t: 'Сегодня в 22:00 сервис будет недоступен около 10 минут', tm: 'вчера', re: ['👀 3'] }, { a: 'admin', t: 'Работы завершены, всё работает штатно', tm: 'вчера', re: ['✅ 5'] }],
  'a-news': [{ a: 'admin', t: 'С понедельника офис работает по новому графику: с 9:00 до 18:00', tm: 'пн', re: ['👍 9', '❤️ 2'] }]
});
const ANN_TOPICS = [
  { id: 'a-rel', n: 'Релизы', bg: '#4b8df0,#2a55c4', who: 'Админ', p: 'Версия 2.4 выпущена', t: '10:40', u: 1 },
  { id: 'a-tech', n: 'Технические работы', bg: '#ff9a5a,#e8571f', who: 'Админ', p: 'Работы завершены, всё работает', t: 'вчера' },
  { id: 'a-news', n: 'Новости компании', bg: '#19b394,#0b7e6c', who: 'Админ', p: 'С понедельника новый график', t: 'пн' }
];
const MAIN_TOPICS = TOPICS.slice();
const useTopics = arr => { TOPICS.length = 0; arr.forEach(t => TOPICS.push(t)) };

/* ---------- комнаты: вторая комната со своими темами ---------- */
function enterRoomX(id) {
  const c = CHATS.find(x => x.id === id);
  useTopics(id === 'ann' ? ANN_TOPICS : MAIN_TOPICS);
  col.classList.add('room'); S.chat = id; S.topic = null;
  $('#rtn').textContent = c.n; $('#rts').textContent = TOPICS.length + ' тем';
  renderList(); renderTopics(); setEmpty('hash', 'Выберите тему', 'Комната «' + c.n + '» · ' + TOPICS.length + ' тем');
}
enterRoom = function () { enterRoomX('room') };

/* ---------- счётчики: у каждой комнаты свои темы ---------- */
roomUnread = function () { return MAIN_TOPICS.reduce((s, t) => s + (t.u || 0), 0) };
const _renderList = renderList;
renderList = function () { NEWCH.ann.u = ANN_TOPICS.reduce((s, t) => s + (t.u || 0), 0); _renderList() };

/* ---------- черновики ---------- */
let DR = {};
const _openChat = openChat;
openChat = function (id) {
  const c = CHATS.find(x => x.id === id);
  if (S.cur && S.cur !== id && !S.edit && CHATS.some(x => x.id === S.cur && !x.secret && !x.invite)) {
    const v = inp.value.trim();
    if (v) { DR[S.cur] = v; inp.value = ''; upd() }
  }
  if (c && c.k === 'room') { enterRoomX(id); return }
  _openChat(id);
  if (DR[id]) { inp.value = DR[id]; delete DR[id]; upd(); renderList() }
};

/* ---------- список: значок «с другого сервера», черновик ---------- */
const _rowHtml = rowHtml;
rowHtml = function (c) {
  const saved = c.p, draft = DR[c.id] && S.chat !== c.id && !c.secret && !c.invite;
  if (draft) c.p = `<span class="dr">Черновик:</span> ${esc(DR[c.id].slice(0, 34))}`;
  let h; try { h = _rowHtml(c) } finally { c.p = saved }
  if (c.fed) h = h.replace('</span><span class="rt">', FDOT + '</span><span class="rt">');
  return h;
};
const _renderContacts = renderContacts;
renderContacts = function () {
  _renderContacts();
  $$('.pp-row', contactsEl).forEach(r => {
    const p = PPL[r.dataset.k]; if (!p || !p.fed) return;
    const av = $('.av', r); $('.dot', av)?.remove(); av.insertAdjacentHTML('beforeend', FDOT);
    const sub = $('.pp-sub', r); if (sub) sub.textContent = p.addr + ' · ' + (p.on ? 'в сети' : p.st);
    r.insertAdjacentHTML('beforeend', FCHIP);
  });
};
renderContacts();

/* ---------- шапка чата ---------- */
const _setHead = setHead;
setHead = function (o) {
  _setHead(o);
  if (o.fed) $('#hav').insertAdjacentHTML('beforeend', FDOT);
  if (o.fedOff) { const s = $('#cs'); s.classList.remove('on'); s.innerHTML = `<span class="fed-off">${GLOBE}Группа на другом сервере · нет связи</span>` }
};

/* ---------- плашка вместо поля ввода, подсказка-счётчик, приглашение, секретный чат ---------- */
$('#comp').insertAdjacentHTML('beforeend', '<div class="xbar" id="xbar"></div>');
const LOCK = I('lock');
const curInfo = () => {
  if (!S.cur) return null;
  if (TOPICS.some(x => x.id === S.cur)) { const r = CHATS.find(c => c.id === S.chat); return r ? { c: r, topic: true, ro: !!r.ro } : null }
  const c = CHATS.find(x => x.id === S.cur); return c ? { c, ro: !!c.ro } : null;
};
/* как composerNote в клиенте */
function note() {
  const i = curInfo(); if (!i) return null; const c = i.c;
  if (i.ro) return { t: 'Доступно только для чтения' };
  if (c.lim && c.lim.used >= c.lim.max) return { t: 'Больше писать нельзя: собеседник не ответил и не добавил вас в контакты' };
  if (c.fedOff) return { t: 'Группа на другом сервере, связи с ним нет. Писать пока нельзя' };
  if (c.lim && c.lim.used > 0) return { t: `Без ответа: ${c.lim.used} из ${c.lim.max}. Дальше нужно дождаться ответа или добавления в контакты`, soft: 1 };
  return null;
}
const invBar = c => `<div class="inv-bar"><div class="inv-txt">${c.invite.from ? `<b>${esc(c.invite.from)}</b> приглашает вас в группу` : 'Вас приглашают в группу'}. Пока вы не вступили, участников и сообщений не видно.</div><div class="inv-btns"><button class="btn" data-inv="no">Отклонить</button><button class="btn pri" data-inv="yes">Вступить</button></div></div>`;
function scBanner(c) {
  const m = c.scMode || 'closed'; let inner;
  if (m === 'closed') inner = '<div class="sc-b-txt"><div class="sc-b-t">Чат зашифрован</div><div class="sc-b-s">Сообщения видны после расшифровки</div></div><button class="sc-btn" data-sc="open">Расшифровать</button>';
  else if (m === 'open') inner = `<div class="sc-b-txt"><div class="sc-b-t">Введите код</div><div class="sc-b-s">Код назвал собеседник</div></div><input id="sc-code" class="sc-b-inp" placeholder="КОД" maxlength="12" autocomplete="off" aria-label="Код"><button class="sc-btn" data-sc="redeem">Подтвердить</button><button class="sc-b-x" data-sc="close" aria-label="Свернуть">${I('x')}</button>`;
  else inner = '<div class="sc-b-txt"><div class="sc-b-t">Код принят</div><div class="sc-b-s"><span class="sc-dot"></span>Ждём подтверждения собеседника</div></div><button class="sc-btn ghost" data-sc="cancel">Отменить</button>';
  return `<div class="sc-locked-banner sc-${m}"><div class="sc-lock">${LOCK}</div>${inner}</div>`;
}
function xSync() {
  const i = curInfo(), c = i && i.c; let h = '';
  if (c && !i.topic && c.invite) h = invBar(c);
  else if (c && !i.topic && c.secret && !c.key) h = scBanner(c);
  else { const n = note(); if (n && !n.soft) h = `<div class="ro-banner">${LOCK}<span>${n.t}</span></div>` }
  const bar = $('#xbar'); if (bar.innerHTML !== h) { bar.innerHTML = h; if (c && c.scMode === 'open') setTimeout(() => $('#sc-code')?.focus(), 30) }
  chatEl.classList.toggle('xlock', !!h);
  chatEl.classList.toggle('xsec', !!(c && !i.topic && c.secret));
  chatEl.classList.toggle('xinv', !!(c && !i.topic && c.invite));
  slotSync();
}
/* мягкая подсказка о счётчике — плашка внутри поля ввода (dm-bar), как панель форматирования */
const _slotSync = slotSync;
slotSync = function () {
  _slotSync();
  const n = note(); if (!n || !n.soft) return;
  $('#slotin').insertAdjacentHTML('afterbegin', `<div class="dm-bar">${LOCK}<span>${n.t}</span></div>`);
  $('#slot').classList.add('open'); chatEl.classList.add('hasbar');
};
const _showConvo = showConvo;
showConvo = function (id, dm) {
  _showConvo(id, dm);
  const c = CHATS.find(x => x.id === id), cv = $('#cv-' + id);
  if (c && c.invite && cv) { cv.dataset.inv = '1'; cv.innerHTML = `<div class="inv-empty"><div class="eic">${GLOBE.replace('width="12" height="12"', 'width="34" height="34"')}</div><p>Вас пригласили в группу «${esc(c.n)}».<br>Сообщения появятся после вступления.</p></div>` }
  xSync();
};
const _setEmpty = setEmpty;
setEmpty = function (...a) { _setEmpty(...a); xSync() };

/* сообщения секретного чата: недорасшифрованное показывается полосками (SC.skeletonHtml в клиенте) */
const _msgHtml = msgHtml;
msgHtml = function (cid, m, prev, dm, next) {
  let h = _msgHtml(cid, m, prev, dm, next);
  const ch = CHATS.find(c => c.id === cid);
  if (!ch || !ch.secret || !(m.pend || !ch.key) || m.big) return h;
  const n = Math.round(((m.t || '').replace(/<[^>]+>/g, '').length) * 1.4 + 24);
  const w1 = Math.min(Math.max(Math.round(n * .5), 90), 220), w2 = Math.min(Math.max(Math.round(n * .3), 50), 140);
  const sk = `<span class="sc-skel" style="width:${w1}px"></span>` + (n > 120 ? `<span class="sc-skel" style="width:${w2}px"></span>` : '');
  h = h.replace(/<div class="irc-text">.*?<\/div>/s, `<div class="irc-text sc-locked">${sk}</div>`);
  return h.replace('<div class="irc-msg', '<div data-sc="1" class="irc-msg');
};
let scT = 0, invGone = null;
function scUnlock(c) {
  c.key = true; c.scMode = null;
  $$(`#cv-${c.id} [data-sc]`).forEach(el => { const m = MSG[el.dataset.m], tx = $('.irc-text', el); if (m && !m.pend && tx) { tx.classList.remove('sc-locked'); tx.innerHTML = m.t; el.removeAttribute('data-sc') } });
  if (S.cur === c.id) xSync();
  toast('Секретный чат расшифрован на этом устройстве');
}
$('#xbar').addEventListener('click', e => {
  const c = CHATS.find(x => x.id === S.cur); if (!c) return;
  const sc = e.target.closest('[data-sc]'), iv = e.target.closest('[data-inv]');
  if (sc) {
    const a = sc.dataset.sc;
    if (a === 'open') c.scMode = 'open';
    else if (a === 'close' || a === 'cancel') { c.scMode = 'closed'; clearTimeout(scT) }
    else if (a === 'redeem') { if (!$('#sc-code').value.trim()) { $('#sc-code').focus(); return } c.scMode = 'wait'; clearTimeout(scT); scT = setTimeout(() => { if (c.scMode === 'wait') scUnlock(c) }, 3800) }
    xSync();
  }
  if (iv) {
    if (iv.dataset.inv === 'yes') { c.invite = null; c.p = 'Игорь: Добро пожаловать в группу!'; c.sub = 'в сети 3 из 4'; c.u = 0; $('#cv-' + c.id)?.remove(); renderList(); openChat(c.id); toast('Вы вступили в группу') }
    else { const i = CHATS.indexOf(c); CHATS.splice(i, 1); invGone = { c, i }; setEmpty('chat', 'Electron', 'Выберите чат или создайте новый'); S.chat = null; renderList(); toast('Приглашение отклонено') }
  }
});

/* ---------- устройства секретного чата (окно modal-secret-sync) и пункт меню ---------- */
function secDevices() {
  const rows = [['Electron · Windows', 'Мария Иванова', 1], ['Мобильный клиент · iPhone', 'Мария Иванова'], ['Chrome · macOS', 'Анна Лебедева']];
  openModal('w500', `<div class="modal-hdr"><span class="grow">Устройства секретного чата</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
    <div class="sc-sync-body"><p class="sc-sync-hint">Здесь видно, на каких устройствах открыт доступ к чату. Ключ не переносится сам: новое устройство подключается только с подтверждения собеседника.</p>
    ${rows.map(([d, n, me]) => `<div class="sc-sync-device">${d} · ${n}${me ? ' — это устройство' : ''}</div>`).join('')}</div>
    <div class="modal-footer"><button class="btn" data-a="close">Закрыть</button></div>`);
}
const _chatMenu = chatMenu;
chatMenu = function (cid, x, y) {
  const c = CHATS.find(z => z.id === cid);
  if (!c || !c.secret) return _chatMenu(cid, x, y);
  const _om = openMenu;
  openMenu = function (items, px, py, o) {
    openMenu = _om;
    const i = items.findIndex(it => it.i === 'ban'); items.splice(i < 0 ? items.length : i, 0, { i: 'monitor', t: 'Устройства чата', fn: secDevices });
    const tr = items.find(it => it.i === 'trash'); if (tr) tr.fn = () => delChat(cid, 'Удалить секретный чат на этом устройстве? Ключ будет стёрт — чтобы вернуть доступ, понадобится подтверждение собеседника.', 'Удалить');
    return _om(items, px, py, o);
  };
  try { _chatMenu(cid, x, y) } finally { openMenu = _om }
};

/* ---------- профиль группы с другого сервера (зеркало) ---------- */
function openFedGroup(cid) {
  const c = CHATS.find(x => x.id === cid), ids = MEMBERS[cid] || [];
  const loc = ['me', ...ids.filter(k => !PPL[k].fed)], fed = ids.filter(k => PPL[k].fed);
  const row = k => {
    const p = k === 'me' ? { n: 'Мария Иванова (вы)', bg: '#f6a35a,#e0507a', ini: 'АБ', on: 1, login: 'admin' } : PPL[k];
    const av = avHtml({ ...p, on: p.fed ? 0 : p.on }, 'sm').replace(/<\/span>$/, (p.fed ? FDOT : '') + '</span>');
    return `<button class="gm-row" data-k="${k}">${av}<span class="gm-nm"><b>${p.n}</b><span>${p.fed ? p.addr : '@' + p.login}</span></span>${p.fed ? FCHIP : ''}<span style="font-size:12px;color:var(--text2)">${p.on ? 'в сети' : p.st || 'давно'}</span></button>`;
  };
  const bg = openModal('gm-modal', `<div class="modal-hdr"><span class="grow">Группа</span><button class="ibtn" data-a="close" aria-label="Закрыть">${I('x')}</button></div>
   <div class="mscroll"><div class="gm-hero"><span class="av xl" style="background:linear-gradient(135deg,${c.bg})">${c.ini}<span class="gm-fedbig">${GLOBE.replace('width="12" height="12"', 'width="13" height="13"')}</span></span><div class="name">${c.n}</div><div class="sub">${ids.length + 1} участников · в сети 3</div></div>
   <div class="gm-tiles"><button class="gm-tile" data-a="search">${I('search')}Поиск</button><button class="gm-tile" data-a="media">${I('image')}Медиа</button><button class="gm-tile" data-a="mute">${I(S.muted.has(cid) ? 'bell' : 'bellOff')}${S.muted.has(cid) ? 'Включить' : 'Без звука'}</button><button class="gm-tile d" data-a="leave">${I('logout')}Выйти</button></div>
   <div class="fx-note">${I('info')}<span><b>Группа на другом сервере.</b> Название, состав и аватарку меняет только её владелец. Писать и ставить реакции можно, а также выйти.</span></div>
   <div class="gm-sec"><span>На этом сервере</span><span>${loc.length}</span></div><div class="gm-box">${loc.map(row).join('')}</div>
   <div class="gm-sec"><span>С других серверов</span><span>${fed.length}</span></div><div class="gm-box">${fed.map(row).join('')}</div></div>`);
  bg.addEventListener('click', e => {
    const r = e.target.closest('.gm-row'), a = e.target.closest('[data-a]');
    if (r && r.dataset.k !== 'me') { closeModal(bg); openProfile(r.dataset.k); return }
    if (!a) return;
    if (a.dataset.a === 'media') openMedia(cid); else if (a.dataset.a === 'search') { closeModal(bg); searchOpen() }
    else if (a.dataset.a === 'mute') { S.muted.has(cid) ? S.muted.delete(cid) : S.muted.add(cid); closeModal(bg); renderList(); toast('Готово') }
    else if (a.dataset.a === 'leave') { closeModal(bg); delChat(cid, 'Выйти из группы «' + c.n + '»?', 'Выйти') }
  });
}
const _openGroup = openGroup;
openGroup = function (cid) { const c = CHATS.find(x => x.id === cid); if (c && c.invite) return; return c && c.fed ? openFedGroup(cid) : _openGroup(cid) };

/* ---------- откат состояния между сценами ---------- */
RESETS.push(() => {
  clearTimeout(scT);
  CHATS.find(c => c.id === 'marat').lim = null;
  DR = {}; if (inp.value && !S.edit) { inp.value = ''; upd() }
  const s2 = NEWCH.sec2; s2.key = false; s2.scMode = 'closed';
  if (invGone) { CHATS.splice(invGone.i, 0, invGone.c); invGone = null }
  const iv = NEWCH.inv; iv.invite = { from: 'Игорь Орлов' }; iv.sub = 'Приглашение в группу'; iv.p = '<span style="color:var(--accent-ink)">Приглашение в группу</span>';
  ['sec2', 'inv'].forEach(id => $('#cv-' + id)?.remove());
  if (col.classList.contains('room')) { col.classList.remove('room'); S.chat = null; S.topic = null; setEmpty('chat', 'Electron', 'Выберите чат или создайте новый') }
  else if (S.cur === 'sec2' || S.cur === 'inv') { const id = S.cur; S.cur = null; openChat('team') }
  ANN_TOPICS[0].u = 1; ANN_TOPICS.forEach(t => { t.at = 0 });
  renderList();
});

/* ---------- сцены ---------- */
const reveal = id => { const r = $('#list [data-id="' + id + '"]'); if (r && (r.offsetTop < list.scrollTop || r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight)) list.scrollTop = Math.max(0, r.offsetTop - 200) };
const show = async id => { if (col.classList.contains('room')) { col.classList.remove('room') } openChat(id); reveal(id) };
addScene('ro', 'Только чтение', async () => { openChat('ann'); await sleep(1300); openTopic('a-rel') });
addScene('locked', 'Нельзя писать', async () => { CHATS.find(c => c.id === 'marat').lim = { used: 3, max: 3 }; await show('marat') });
addScene('fedoff', 'Нет связи с группой', async () => { await show('fedB') });
addScene('noans', 'Счётчик без ответа', async () => { CHATS.find(c => c.id === 'marat').lim = { used: 2, max: 3 }; await show('marat') });
addScene('invite', 'Приглашение', async () => { await show('inv') });
addScene('fed', 'Федерация', async () => { await show('fedA'); await sleep(450); openGroup('fedA') });
addScene('secret', 'Секретный чат', async () => { await show('sec1') });
addScene('seckey', 'Секретный чат: ключ', async () => { await show('sec2') });
addScene('secdev', 'Секретный чат: устройства', async () => { await show('sec1'); await sleep(350); secDevices() });
addScene('draft', 'Черновик', async () => {
  await show('olga'); await sleep(300);
  inp.value = 'Подписала график, отправлю на почту'; upd(); await sleep(500);
  await show('team'); reveal('olga');
});
})();
