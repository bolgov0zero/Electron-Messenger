// /m — профиль группы и комнаты по макету: аватар, название, плитки действий, медиа, темы, участники. Права, «в сети N из M»,
// участники и приглашённые с других серверов, гостевые ссылки — как в остальных клиентах. Открывается нажатием на капсулу в шапке чата.
B.ui = B.ui || {};
B.ui.gprofile = (function () {
  function chatOf(el) { return B.find(+el.dataset.gid); }
  function perms(chat) {
    var room = chat.type === 'room', mirror = !!chat.fed_mirror, boss = chat.created_by === B.S.user.id || !!B.S.user.is_admin;
    return { mirror: mirror, room: room,
      canEdit: !mirror && (room ? !!B.S.user.is_admin : boss),     // состав и аватарка
      canRename: !mirror && !room && boss,                          // название комнаты меняется в админке
      canLeave: !room || mirror,                                    // из своей комнаты не выйти
      canDelete: !mirror && !room && boss };
  }
  function members(chat) {
    var list = (chat.members || []).slice(), me = B.S.user;
    if (!list.some(function (m) { return m.id === me.id; })) list.push({ id: me.id, display_name: me.display_name, username: me.username, tag: me.tag });
    return list;
  }
  function rank(m, chat) { var p = B.S.presence[m.id]; return m.id === chat.created_by ? 0 : (m.id === B.S.user.id || p === 'online') ? 1 : p === 'away' ? 2 : 3; }
  function sorted(list, chat) { return list.slice().sort(function (a, b) { return rank(a, chat) - rank(b, chat) || (a.display_name || '').localeCompare(b.display_name || '', 'ru'); }); }
  function statusOf(m) {
    if (m.id === B.S.user.id) return { t: 'в сети', on: 1 };
    var st = B.S.presence[m.id];
    if (st === 'online') return { t: 'в сети', on: 1 };
    if (st === 'away') return { t: 'отошёл' };
    var t = B.presence.statusText(m.id); return { t: t.charAt(0).toLowerCase() + t.slice(1) };
  }
  function plural(n, a, b, c) { var m = n % 100, d = n % 10; return n + ' ' + (m > 10 && m < 15 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c); }
  function subText(chat, all) {
    var o = (B.S.chatOnline || {})[chat.id], total = o ? o.total : all.length;
    var online = o ? o.online : all.filter(function (m) { return m.id === B.S.user.id || B.S.presence[m.id] === 'online' || B.S.presence[m.id] === 'away'; }).length;
    return (chat.type === 'room' ? 'Комната' : 'Группа') + ' · ' + plural(total, 'участник', 'участника', 'участников') + ' · ' + online + ' в сети';
  }
  function login(m) { return m.federated ? B.contacts.fedAddr(m) : '@' + (m.username || ''); }
  function match(m, q) { return !q || (m.display_name || '').toLowerCase().indexOf(q) >= 0 || (m.username || '').toLowerCase().indexOf(q) >= 0 || (m.login || '').toLowerCase().indexOf(q) >= 0; }

  // ── разметка ──
  function row(m, chat, P, pending) {
    var self = m.id === B.S.user.id, st = statusOf(m), fed = !!m.federated || pending;
    var right = pending ? '<span class="pill-tag" style="color:var(--accent-ink)">ждёт ответа</span>' : m.id === chat.created_by && !P.mirror ? '<span class="pill-tag" style="color:var(--accent-ink)">создатель</span>' : (m.tag ? '<span class="pill-tag" style="' + B.tagInk(m.tag) + '">' + B.esc(m.tag) + '</span>' : '');
    return '<button class="mini" data-r="' + (self ? 'self' : pending ? 'pend' : 'm') + '" data-id="' + m.id + '">' + B.avatar.user(m.id, m.display_name || m.username || '?', 0, pending, fed) +
      '<span class="rt"><b>' + B.esc(m.display_name || m.username || '') + (self ? ' (вы)' : '') + '</b><small data-u="' + m.id + '" class="' + (st.on ? 'on' : '') + '">' + B.esc(pending ? login(m) : st.t) + '</small></span>' + right + '</button>';
  }
  function head(el, chat, P, all, local, fed, pend) {
    var g = el._g, muted = !!chat.muted;
    var tiles = [
      P.canEdit ? '<button class="tile glass gi" data-r="add">' + I('userPlus') + 'Добавить</button>' : '',
      P.canEdit ? '<button class="tile glass gi" data-r="guest">' + I('link') + 'Гость</button>' : '',
      '<button class="tile glass gi" data-r="mute">' + I(muted ? 'bell' : 'bellOff') + (muted ? 'Звук' : 'Без звука') + '</button>',
      '<button class="tile glass gi" data-r="media">' + I('image') + 'Медиа</button>',
      P.canLeave ? '<button class="tile glass gi d" data-r="leave">' + I('logout') + 'Выйти</button>' : ''
    ].filter(Boolean);
    var ban = P.mirror ? '<div class="nbanner glass" style="margin:0 0 16px">' + I('globe') + '<span><b>' + (P.room ? 'Комната' : 'Группа') + ' на другом сервере.</b> Название, состав и аватарку меняет только её владелец. Писать и ставить реакции можно.</span></div>' : '';
    var chip = function (k, label, n) { return '<button class="chip' + (g.f === k ? ' on' : '') + '" data-r="chip" data-k="' + k + '">' + label + ' ' + n + '</button>'; };
    var chips = (fed.length || pend.length) ? '<div class="fbar pgf"><div class="chips fo"><div class="fgrp glass"><div class="fin"><i class="thumb"></i>' + chip('all', 'Все', all.length) + chip('local', 'На этом сервере', local.length) + (fed.length ? chip('fed', 'С других серверов', fed.length) : '') + (pend.length ? chip('pend', 'Ждут ответа', pend.length) : '') + '</div></div></div></div>' : '';
    var topics = '';
    if (P.room) {
      var subs = B.chats.topicsOf(chat.id);
      if (subs.length) topics = '<div class="gl">Темы · ' + subs.length + '</div><div class="grp glass">' + subs.map(function (t) {
        return '<button class="mini" data-r="topic" data-id="' + t.id + '">' + B.avatar.html({ id: t.id, chat: t.id, text: '#', sq: true }) + '<span class="rt"><b>' + B.esc(t.name) + '</b><small>' + (t.last_message ? 'есть сообщения' : 'нет сообщений') + '</small></span><span class="ch">' + I('chevRight') + '</span></button>';
      }).join('') + '</div><div class="gf">Названия и порядок тем, а также режим «только чтение» меняет администратор в админке.</div>';
    }
    var cam = P.canEdit ? '<button class="pgcam" data-r="avatar" aria-label="Сменить аватарку">' + I('image') + '</button><input type="file" accept="image/*" hidden>' : '';
    return '<div class="hero"><div class="pgav">' + B.avatar.chat(chat, 0, true) + cam + '</div><h2>' + B.esc(B.chatName(chat)) + '</h2><p id="pg-sub">' + B.esc(subText(chat, all)) + '</p></div>' + ban +
      '<div class="tiles' + (tiles.length > 3 ? ' sm' : '') + '" style="grid-template-columns:repeat(' + Math.min(tiles.length, 5) + ',1fr)">' + tiles.join('') + '</div>' + topics +
      '<label class="srch glass">' + I('search') + '<input id="pg-q" placeholder="Найти участника" autocomplete="off" autocapitalize="none" value="' + B.esc(g.q) + '"></label>' + chips;
  }
  function lists(el, chat, P, local, fed, pend) {
    var g = el._g, q = g.q.trim().toLowerCase();
    var lf = local.filter(function (m) { return match(m, q); }), ff = fed.filter(function (m) { return match(m, q); }), pf = pend.filter(function (m) { return match(m, q); });
    var show = function (k) { return g.f === 'all' || g.f === k; }, none = '<div class="cell"><span class="cl" style="color:var(--text2)">Никого не нашли</span></div>';
    var h = '';
    if (show('local')) h += '<div class="gl">' + (fed.length ? 'На этом сервере' : 'Участники') + ' · ' + lf.length + (lf.length !== local.length ? ' из ' + local.length : '') + '</div><div class="grp glass">' + (lf.map(function (m) { return row(m, chat, P); }).join('') || none) + (P.canEdit && g.f !== 'pend' && !q ? '<button class="mini" data-r="add"><span class="ci" style="background:var(--accent)">' + I('userPlus') + '</span><span class="rt"><b style="color:var(--accent-ink)">Добавить участников</b></span></button>' : '') + '</div>';
    if (fed.length && show('fed')) h += '<div class="gl">С других серверов · ' + ff.length + '</div><div class="grp glass">' + (ff.map(function (m) { return row(m, chat, P); }).join('') || none) + '</div>';
    if (pend.length && show('pend')) h += '<div class="gl">Ждут ответа · ' + pf.length + '</div><div class="grp glass">' + (pf.map(function (m) { return row(Object.assign({}, m, { federated: true }), chat, P, true); }).join('') || none) + '</div>';
    if (P.canDelete && g.f === 'all' && !q) h += '<div class="grp glass"><button class="cell" data-r="delete"><span class="cl red">Удалить группу</span></button></div>';
    return h;
  }
  function split(chat) {
    var all = members(chat);
    return { all: all, local: sorted(all.filter(function (m) { return !m.federated; }), chat), fed: sorted(all.filter(function (m) { return m.federated; }), chat), pend: chat.pending || [] };
  }
  function paint(el) {
    var chat = chatOf(el); if (!chat) return;
    var g = el._g, P = perms(chat), d = split(chat);
    if (!(d.fed.length || d.pend.length)) g.f = 'all';
    if (g.f === 'pend' && !d.pend.length) g.f = 'all';
    var s = $('.scroll', el), y = s.scrollTop, had = document.activeElement && document.activeElement.id === 'pg-q';
    var oldFin = $('.fin', s), fl = oldFin ? oldFin.scrollLeft : 0, pt = B.ui.folders.thumbOf(s);
    s.innerHTML = head(el, chat, P, d.all, d.local, d.fed, d.pend) + '<div id="pg-lists">' + lists(el, chat, P, d.local, d.fed, d.pend) + '</div>';
    s.scrollTop = y; B.avatar.apply(s);
    var nf = $('.fin', s); if (nf) { nf.scrollLeft = fl; B.ui.folders.settle(s, pt); B.ui.folders.watchEdges(s); }
    $('.nt > span', el).textContent = P.room ? 'Комната' : 'Группа';
    if (had) { var i = $('#pg-q', s); i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} }
  }
  function paintLists(el) { var chat = chatOf(el), box = $('#pg-lists', el); if (!chat || !box) return; var P = perms(chat), d = split(chat); box.innerHTML = lists(el, chat, P, d.local, d.fed, d.pend); B.avatar.apply(box); }
  function paintLive(el) {
    var chat = chatOf(el); if (!chat) return;
    var d = split(chat), s = $('#pg-sub', el); if (s) s.textContent = subText(chat, d.all);
    $$('small[data-u]', el).forEach(function (e) { var m = d.all.find(function (x) { return x.id === +e.dataset.u; }); if (!m) return; var st = statusOf(m); e.textContent = st.t; e.classList.toggle('on', !!st.on); });
  }

  // ── действия ──
  function memberSheet(el, id, pending) {
    var chat = chatOf(el), P = perms(chat), m = (pending ? chat.pending || [] : members(chat)).find(function (x) { return x.id === id; }); if (!m) return;
    var u = B.contacts.byId(id), items = [];
    if (!pending) {
      var canWrite = !(m.federated && !(u && u.contact));
      if (canWrite) items.push({ l: 'Написать', f: function () { B.contacts.openDirect(id).then(function (c) { if (c) B.openChat(c.id); else B.toast.show('Не удалось открыть чат', 'x'); }); } });
      items.push({ l: 'Открыть профиль', f: function () { B.openProfile(id); } });
      if (u && (u.rel === 'chat' || (m.federated && !u.contact))) items.push({ l: 'Добавить в контакты', f: function () { B.openAddFromChat(id); } });
    }
    if (P.canEdit && id !== chat.created_by) items.push({ l: pending ? 'Отменить приглашение' : 'Убрать из ' + (P.room ? 'комнаты' : 'группы'), d: 1, f: function () { kick(el, id, pending); } });
    B.actions.show({ title: m.display_name || m.username || '', msg: login(m), items: items });
  }
  function kick(el, id, pending) {
    var chat = chatOf(el); if (!chat) return;
    var m = (pending ? chat.pending || [] : chat.members || []).find(function (x) { return x.id === id; }), nm = (m && m.display_name) || 'участника';
    B.actions.confirm(pending ? 'Отменить приглашение для «' + nm + '»?' : 'Убрать «' + nm + '» из ' + (chat.type === 'room' ? 'комнаты' : 'группы') + '?', '', pending ? 'Отменить приглашение' : 'Убрать', async function () {
      var r = await B.api('DELETE', '/chats/' + chat.id + '/members/' + id);
      if (r && r.error) { B.toast.show(r.error, 'x'); return; }
      await B.chats.refresh(); paint(el);
    });
  }
  async function mute(el) { var c = chatOf(el); await B.chats.mute(c.id); paint(el); }
  // Гостевая ссылка: окно из shared/guestlinks.js (вход в группу или комнату без учётной записи на время)
  function guest(el) {
    var c = chatOf(el); if (!c || !window.GuestLinks) return;
    window.GuestLinks.open({ chatId: c.id, chatName: B.chatName(c), request: async function (method, path, body) {
      try {
        var res = await fetch(B.http() + '://' + B.S.server + '/api' + path, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + B.S.token }, body: body ? JSON.stringify(body) : undefined });
        var data = null; try { data = await res.json(); } catch (e) {}
        return { ok: res.ok, status: res.status, data: data || {} };
      } catch (e) { return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } }; }
    } });
  }
  function closeAll() { while (B.nav.stack.some(function (s) { return s.el.dataset.gid; })) B.nav.pop(); }
  function leave(el) {
    var chat = chatOf(el);
    B.actions.confirm('Выйти из ' + (chat.type === 'room' ? 'комнаты' : 'группы') + ' «' + B.chatName(chat) + '»?', 'Переписка исчезнет из списка.', 'Выйти', async function () {
      if (!(await B.chats.leave(chat.id))) { B.toast.show('Не удалось выйти', 'x'); return; }
      closeAll();
    });
  }
  function del(el) {
    var chat = chatOf(el);
    B.actions.confirm('Удалить группу «' + B.chatName(chat) + '»?', 'Группа и вся переписка исчезнут у всех участников.', 'Удалить', async function () {
      var r = await B.api('DELETE', '/chats/' + chat.id);
      if (r && r.error) { B.toast.show(r.error, 'x'); return; }
      B.S.chats = B.S.chats.filter(function (c) { return c.id !== chat.id; }); B.chats.onChanged(); B.bus.emit('chat:deleted', { chatId: chat.id });
      closeAll();
    });
  }
  function rename(el) {
    var chat = chatOf(el);
    var S_ = B.sheet.open({ title: 'Название', body: '<label class="fld m glass-inset">' + I('users') + '<input id="pg-name" value="' + B.esc(chat.name || '') + '" maxlength="60" autocomplete="off" enterkeyhint="done"></label><button class="abtn pri" data-ok>Сохранить</button><button class="abtn" data-close>Отмена</button>' });
    var inp = $('#pg-name', S_.el);
    var save = async function () {
      var name = inp.value.trim(); if (!name) return; B.sheet.close();
      if (name === chat.name) return;
      var r = await B.api('PATCH', '/chats/' + chat.id, { name: name });
      if (r && r.error) B.toast.show(r.error, 'x');
      await B.chats.refresh(); paint(el);
    };
    $('[data-ok]', S_.el).onclick = save; inp.addEventListener('focus', function () { showKb(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    setTimeout(function () { inp.focus(); inp.select(); }, 520);
  }
  async function avatar(el, file) {
    var data = await B.ui.groups.resizeAvatar(file), chat = chatOf(el);
    var r = await B.api('POST', '/chats/' + chat.id + '/avatar', { data: data });
    if (r && r.error) { B.toast.show(r.error, 'x'); return; }
    await B.avatar.loadIndex(); B.S.avatarTs = Date.now(); B.avatar.clearCache(); paint(el); B.chats.onChanged();
  }

  // ── добавление участников ──
  function available(chat, q) {
    var ex = {}, pend = {}; (chat.members || []).forEach(function (m) { ex[m.id] = 1; }); (chat.pending || []).forEach(function (m) { pend[m.id] = 1; });
    var group = chat.type === 'group'; q = (q || '').trim().toLowerCase();
    return B.S.contacts.filter(function (u) { return !ex[u.id] && !pend[u.id] && (!u.federated || (group && (u.contact || u.rel === 'ws'))) && (!q || (u.display_name || '').toLowerCase().indexOf(q) >= 0 || (u.username || '').toLowerCase().indexOf(q) >= 0); });
  }
  function addSheet(el) {
    var chat = chatOf(el), sel = [], q = '';
    var list = function () {
      var l = available(chat, q);
      return l.length ? '<div class="grp glass">' + l.map(function (u) {
        return '<button class="mini' + (sel.indexOf(u.id) >= 0 ? ' on' : '') + '" data-a="toggle" data-id="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 0, true, !!u.federated) + '<span class="rt"><b>' + B.esc(u.display_name) + '</b><small>' + B.esc(u.federated ? B.contacts.fedAddr(u) + (u.rel === 'ws' ? '' : ' · после согласия') : '@' + (u.username || '')) + '</small></span><span class="ck">' + I('check') + '</span></button>';
      }).join('') + '</div>' : '<div class="empty" style="padding:24px">Некого добавить</div>';
    };
    var S_ = B.sheet.open({ title: 'Добавить участников', sub: chat.type === 'group' ? 'Людей с других серверов можно позвать только из своих контактов: они получат приглашение и сами решат, вступать ли.' : 'Людей с других серверов в комнаты добавляет администратор в админке.',
      body: '<label class="srch glass" style="height:40px">' + I('search') + '<input id="pg-aq" placeholder="Имя или логин" autocomplete="off" autocapitalize="none"></label><div id="pg-alist">' + list() + '</div><button class="abtn pri" data-a="go" disabled>Добавить</button>' });
    var lst = $('#pg-alist', S_.el), go = $('[data-a="go"]', S_.el);
    var redraw = function () { lst.innerHTML = list(); B.avatar.apply(lst); go.disabled = !sel.length; go.textContent = sel.length ? 'Добавить (' + sel.length + ')' : 'Добавить'; };
    B.avatar.apply(lst);
    $('#pg-aq', S_.el).addEventListener('input', function (e) { q = e.target.value; redraw(); });
    $('#pg-aq', S_.el).addEventListener('focus', function () { showKb(); });
    S_.el.addEventListener('click', async function (e) {
      var t = e.target.closest('[data-a]'); if (!t) return;
      if (t.dataset.a === 'toggle') { var id = +t.dataset.id, i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); redraw(); }
      else if (t.dataset.a === 'go' && sel.length && !t.disabled) {
        t.disabled = true;
        var res = await Promise.all(sel.map(function (uid) { return B.api('POST', '/chats/' + chat.id + '/members', { user_id: uid }); }));
        B.sheet.close();
        var err = res.find(function (r) { return r && r.error; });
        if (err) B.toast.show(err.error, 'x'); else if (res.some(function (r) { return r && r.pending; })) B.toast.show('Приглашение отправлено. Человек появится после согласия', 'userPlus');
        await B.chats.refresh(); paint(el);
      }
    });
  }

  function onClick(el, e) {
    var t = e.target.closest('[data-r]'); if (!t) return; var r = t.dataset.r, id = +t.dataset.id;
    if (r === 'chip') { B.ui.folders.center = true; el._g.f = t.dataset.k; paint(el); }
    else if (r === 'add') addSheet(el);
    else if (r === 'mute') mute(el);
    else if (r === 'guest') guest(el);
    else if (r === 'leave') leave(el);
    else if (r === 'delete') del(el);
    else if (r === 'rename') rename(el);
    else if (r === 'avatar') { var f = $('.pgav input[type=file]', el); if (f) f.click(); }
    else if (r === 'topic') B.ui.chat.open(id);
    else if (r === 'media') B.media.openChatMedia(+el.dataset.gid);
    else if (r === 'm') memberSheet(el, id, false);
    else if (r === 'pend') memberSheet(el, id, true);
  }

  function open(cid) {
    var chat = B.find(cid); if (!chat || chat.invite) return;
    var top = B.nav.top(); if (top && top.el.dataset.gid == cid) return;
    var P = perms(chat);
    var el = B.nav.page({ title: chat.type === 'room' ? 'Комната' : 'Группа', cap: !!P.canRename, right: P.canRename ? '<button data-r="rename" aria-label="Изменить название">' + I('pen') + '</button>' : '', body: '' }); el.dataset.gid = cid;
    el._g = { f: 'all', q: '' };
    el.addEventListener('click', function (e) { onClick(el, e); });
    el.addEventListener('input', function (e) { if (e.target.id === 'pg-q') { el._g.q = e.target.value; paintLists(el); } });
    el.addEventListener('focusin', function (e) { if (e.target.id === 'pg-q') showKb(); });
    el.addEventListener('change', function (e) { var f = e.target; if (f.type === 'file' && f.files[0]) { var file = f.files[0]; f.value = ''; avatar(el, file); } });
    B.nav.push(el, B.chatName(chat)); paint(el);
    if (chat.type === 'room' && !(B.S.topics[cid] || []).length) B.chats.loadTopics(cid);
  }
  function each(fn) { B.nav.stack.forEach(function (s) { if (s.el.dataset.gid) fn(s.el); }); }
  B.bus.on('chats:changed', function () { each(function (el) { if (!chatOf(el)) { if (B.nav.top() && B.nav.top().el === el) B.nav.pop(); return; } paint(el); }); });
  B.bus.on('chat:online', function () { each(paintLive); });
  B.bus.on('presence:changed', function () { each(paintLive); });
  B.bus.on('contacts:changed', function () { each(paintLists); });
  B.openGroupProfile = open;
  return { open: open };
})();
