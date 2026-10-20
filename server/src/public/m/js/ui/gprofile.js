// /m — профиль группы и комнаты: страница поверх переписки. Шапка (аватарка, название, кнопки, поиск, чипы)
// и список участников, как в настольном клиенте. Права, «в сети N из M» и участники с других серверов — оттуда же.
// Открывается нажатием на заголовок или аватарку в шапке чата (B.openMembers).
B.ui = B.ui || {};
B.ui.gprofile = (function () {
  var esc = B.esc, ic = B.ic, SW = 84;

  function chatOf(el) { return B.find(+el.dataset.gid); }
  function perms(chat) {
    var room = chat.type === 'room', mirror = !!chat.fed_mirror, boss = chat.created_by === B.S.user.id || !!B.S.user.is_admin;
    return {
      mirror: mirror, room: room,
      canEdit: !mirror && (room ? !!B.S.user.is_admin : boss),     // состав и аватарка
      canRename: !mirror && !room && boss,                          // название комнаты меняется в админке
      canLeave: !room || mirror,                                    // из своей комнаты не выйти
      canDelete: !mirror && !room && boss
    };
  }
  function members(chat) {
    var list = (chat.members || []).slice(), me = B.S.user;
    if (!list.some(function (m) { return m.id === me.id; })) list.push({ id: me.id, display_name: me.display_name, username: me.username, tag: me.tag });
    return list;
  }
  function rank(m, chat) {
    var p = B.S.presence[m.id];
    return m.id === chat.created_by ? 0 : (m.id === B.S.user.id || p === 'online') ? 1 : p === 'away' ? 2 : 3;
  }
  function sorted(list, chat) {
    return list.slice().sort(function (a, b) { return rank(a, chat) - rank(b, chat) || (a.display_name || '').localeCompare(b.display_name || '', 'ru'); });
  }
  function statusOf(m) {
    var S = B.S;
    if (m.id === S.user.id) return { t: 'в сети', on: 1 };
    var st = S.presence[m.id];
    if (st === 'online') return { t: 'в сети', on: 1 };
    if (st === 'away') return { t: 'отошёл' };
    var t = B.presence.statusText(m.id); return { t: t.charAt(0).toLowerCase() + t.slice(1) };
  }
  function plural(n, a, b, c) { var m = n % 100, d = n % 10; return n + ' ' + (m > 10 && m < 15 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c); }
  function subText(chat, all) {
    var o = (B.S.chatOnline || {})[chat.id], total = o ? o.total : all.length;
    var online = o ? o.online : all.filter(function (m) { return m.id === B.S.user.id || B.S.presence[m.id] === 'online' || B.S.presence[m.id] === 'away'; }).length;
    return plural(total, 'участник', 'участника', 'участников') + ' · ' + online + ' в сети';
  }
  function login(m) { return m.federated ? B.contacts.fedAddr(m) : '@' + (m.username || ''); }
  function match(m, q) {
    return !q || (m.display_name || '').toLowerCase().indexOf(q) >= 0 || (m.username || '').toLowerCase().indexOf(q) >= 0 || (m.login || '').toLowerCase().indexOf(q) >= 0;
  }

  // ── разметка ──
  function row(m, chat, P, pending) {
    var self = m.id === B.S.user.id, st = statusOf(m), fed = !!m.federated || pending;
    var right = pending ? '<em class="wait">ждёт ответа</em>' : m.id === chat.created_by && !P.mirror ? '<em class="role">создатель</em>' : '<em class="' + (st.on ? 'on' : '') + '" data-u="' + m.id + '">' + esc(st.t) + '</em>';
    var removable = P.canEdit && !self && (pending || m.id !== chat.created_by);
    var inner = '<div class="crow2" data-r="' + (self ? 'self' : pending ? 'pend' : 'm') + '" data-id="' + m.id + '">' + B.avatar.user(m.id, m.display_name || m.username || '?', 40, pending, fed) +
      '<div class="t"><b>' + esc(m.display_name || m.username || '') + (self ? ' (вы)' : '') + '</b><span>' + esc(login(m)) + '</span></div><span class="pgst">' + right + '</span></div>';
    if (!removable) return '<div class="pgrow">' + inner + '</div>';
    return '<div class="pgrow pgsw" data-id="' + m.id + '" data-pend="' + (pending ? 1 : 0) + '"><div class="pgx"><button data-r="kick" data-id="' + m.id + '" data-pend="' + (pending ? 1 : 0) + '">' + ic('out', 20, 2) + '<span>' + (pending ? 'Отменить' : 'Убрать') + '</span></button></div><div class="pgf">' + inner + '</div></div>';
  }
  function head(el, chat, P, all, local, fed, pend) {
    var g = el._g, kind = P.room ? 'Комната' : 'Группа', muted = !!chat.muted;
    var cam = P.canEdit ? '<button class="pgcam" data-r="avatar" aria-label="Сменить аватарку">' + ic('cam', 15, 2) + '</button><input type="file" accept="image/*" hidden>' : '';
    var fb = P.mirror ? '<i class="pgfb">' + B.avatar.GLOBE + '</i>' : '';
    var av = '<div class="pgav' + (P.room ? ' room' : '') + '">' + B.avatar.chat(chat, 96) + cam + fb + '</div>';
    var nm = '<div class="pgn"><span>' + esc(B.chatName(chat)) + '</span>' + (P.canRename ? '<button class="pgpen" data-r="rename" aria-label="Переименовать">' + ic('pencil', 17, 2) + '</button>' : '') + '</div>';
    var tiles = [
      P.canEdit ? '<button data-r="add">' + ic('userplus', 22, 1.8) + '<span>Добавить</span></button>' : '',
      '<button data-r="find">' + ic('search', 22, 1.8) + '<span>Поиск</span></button>',
      '<button data-r="mute">' + ic(muted ? 'bell' : 'bellOff', 22, 1.8) + '<span>' + (muted ? 'Со звуком' : 'Без звука') + '</span></button>',
      P.canLeave ? '<button class="red" data-r="leave">' + ic('out', 22, 1.8) + '<span>Выйти</span></button>' : ''
    ].filter(Boolean);
    var ban = P.mirror ? '<div class="pgban">' + ic('info', 17, 2) + '<span><b>' + kind + ' на другом сервере.</b> Название, состав и аватарку меняет только её владелец. Писать, ставить реакции и выходить можно.</span></div>' : '';
    var showChips = fed.length > 0 || pend.length > 0;
    var chip = function (k, label, n) { return '<button class="' + (g.f === k ? 'on' : '') + '" data-r="chip" data-k="' + k + '">' + label + '<small>' + n + '</small></button>'; };
    var chips = showChips ? '<div class="pgchips">' + chip('all', 'Все', all.length) + chip('local', 'На этом сервере', local.length) + (fed.length ? chip('fed', 'С других серверов', fed.length) : '') + (pend.length ? chip('pend', 'Ждут ответа', pend.length) : '') + '</div>' : '';
    var topics = '';
    if (P.room) {
      var subs = B.chats.topicsOf(chat.id);
      if (subs.length) topics = '<div class="hdr-s pgh">Темы<span>' + subs.length + '</span></div><div class="grp">' + subs.map(function (t) {
        return '<button class="crow2" data-r="topic" data-id="' + t.id + '">' + B.avatar.html({ id: t.id, chat: t.id, text: '#' }, 40) + '<div class="t"><b>' + esc(t.name) + '</b><span>' + (t.last_message ? 'есть сообщения' : 'нет сообщений') + '</span></div><span class="chev">' + ic('chev', 16, 2.4) + '</span></button>';
      }).join('') + '</div><div class="gf pgnote">Названия и порядок тем, а также режим «только чтение» меняет администратор в админке.</div>';
    }
    return '<div class="pghero">' + av + nm + '<div class="pgsub" id="pg-sub">' + esc(subText(chat, all)) + '</div></div>' + ban +
      '<div class="pgtiles n' + tiles.length + '">' + tiles.join('') + '</div>' +
      '<div class="grp pgmedia"><button class="cell tap hasi" data-r="media"><span class="ci" style="background:#5e6ad2">' + ic('photo', 17, 2) + '</span><span class="cl">Медиа, файлы и ссылки</span><span class="chev">' + ic('chev', 16, 2.4) + '</span></button></div>' + topics +
      '<div class="srch pgs"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="pg-q" placeholder="Найти участника" autocomplete="off" autocapitalize="none" value="' + esc(g.q) + '"></div></div>' + chips;
  }
  function lists(el, chat, P, local, fed, pend) {
    var g = el._g, q = g.q.trim().toLowerCase();
    var lf = local.filter(function (m) { return match(m, q); }), ff = fed.filter(function (m) { return match(m, q); }), pf = pend.filter(function (m) { return match(m, q); });
    var show = function (k) { return g.f === 'all' || g.f === k; }, none = '<div class="cell"><span class="cl" style="color:var(--fg2)">Никого не нашли</span></div>';
    var h = '';
    if (show('local')) h += '<div class="hdr-s cnt">На этом сервере<span>' + lf.length + (lf.length !== local.length ? ' из ' + local.length : '') + '</span></div><div class="grp pglist">' + (lf.map(function (m) { return row(m, chat, P); }).join('') || none) + '</div>';
    if (fed.length && show('fed')) h += '<div class="hdr-s cnt pgfed">' + B.avatar.GLOBE.replace('<svg', '<svg width="13" height="13"') + '<i>С других серверов</i><span>' + ff.length + '</span></div><div class="grp pglist fed">' + (ff.map(function (m) { return row(m, chat, P); }).join('') || none) + '</div>';
    if (pend.length && show('pend')) h += '<div class="hdr-s cnt">Ждут ответа<span>' + pf.length + '</span></div><div class="grp pglist">' + (pf.map(function (m) { return row(Object.assign({}, m, { federated: true }), chat, P, true); }).join('') || none) + '</div>';
    if (P.canDelete && g.f === 'all' && !q) h += '<div class="pgfoot"><button data-r="delete">Удалить группу</button></div>';
    return h;
  }
  function split(chat) {
    var all = members(chat);
    return { all: all, local: sorted(all.filter(function (m) { return !m.federated; }), chat), fed: sorted(all.filter(function (m) { return m.federated; }), chat), pend: chat.pending || [] };
  }
  // Полная перерисовка; список, поиск и положение прокрутки сохраняются
  function paint(el) {
    var chat = chatOf(el); if (!chat) return;
    var g = el._g, P = perms(chat), d = split(chat);
    if (!(d.fed.length || d.pend.length)) g.f = 'all';
    if (g.f === 'pend' && !d.pend.length) g.f = 'all';
    var sc = el.querySelector('.scroll'), y = sc.scrollTop, had = document.activeElement && document.activeElement.id === 'pg-q';
    sc.innerHTML = head(el, chat, P, d.all, d.local, d.fed, d.pend) + '<div id="pg-lists">' + lists(el, chat, P, d.local, d.fed, d.pend) + '</div>';
    sc.scrollTop = y; B.avatar.apply(sc);
    el.querySelector('.nt').textContent = P.room ? 'Комната' : 'Группа';
    if (had) { var i = sc.querySelector('#pg-q'); i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} }
  }
  function paintLists(el) {
    var chat = chatOf(el), box = el.querySelector('#pg-lists'); if (!chat || !box) return;
    var P = perms(chat), d = split(chat); box.innerHTML = lists(el, chat, P, d.local, d.fed, d.pend); B.avatar.apply(box);
  }
  function paintLive(el) {
    var chat = chatOf(el); if (!chat) return;
    var d = split(chat), s = el.querySelector('#pg-sub'); if (s) s.textContent = subText(chat, d.all);
    el.querySelectorAll('.pgst em[data-u]').forEach(function (e) {
      var m = d.all.find(function (x) { return x.id === +e.dataset.u; }); if (!m) return; var st = statusOf(m); e.textContent = st.t; e.classList.toggle('on', !!st.on);
    });
  }

  // ── действия ──
  function memberSheet(el, id, pending) {
    var chat = chatOf(el), P = perms(chat), m = (pending ? chat.pending || [] : members(chat)).find(function (x) { return x.id === id; }); if (!m) return;
    var u = B.contacts.byId(id), items = [];
    if (!pending) {
      var canWrite = !(m.federated && !(u && u.contact));
      if (canWrite) items.push({ l: 'Написать', f: function () { B.contacts.openDirect(id).then(function (c) { if (c) B.openChat(c.id); else B.toast.show('Не удалось открыть чат'); }); } });
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
      if (r && r.error) { B.toast.show(r.error); return; }
      await B.chats.refresh(); paint(el);
    });
  }
  async function mute(el) { var c = chatOf(el); await B.chats.mute(c.id); paint(el); }
  function leave(el) {
    var chat = chatOf(el);
    B.actions.confirm('Выйти из ' + (chat.type === 'room' ? 'комнаты' : 'группы') + ' «' + B.chatName(chat) + '»?', 'Переписка исчезнет из списка.', 'Выйти', async function () {
      if (!(await B.chats.leave(chat.id))) { B.toast.show('Не удалось выйти'); return; }
      closeAll();
    });
  }
  function del(el) {
    var chat = chatOf(el);
    B.actions.confirm('Удалить группу «' + B.chatName(chat) + '»?', 'Группа и вся переписка исчезнут у всех участников.', 'Удалить', async function () {
      var r = await B.api('DELETE', '/chats/' + chat.id);
      if (r && r.error) { B.toast.show(r.error); return; }
      B.S.chats = B.S.chats.filter(function (c) { return c.id !== chat.id; }); B.chats.onChanged(); B.bus.emit('chat:deleted', { chatId: chat.id });
      closeAll();
    });
  }
  function closeAll() { while (B.nav.stack.some(function (s) { return s.el.dataset.gid; })) B.nav.pop(); }
  function rename(el) {
    var chat = chatOf(el);
    B.sheet.open({ size: 'med', title: 'Название', left: '<button class="nb" data-sheet="close">Отмена</button>', right: '<button class="nb" data-pg="save" style="font-weight:600">Готово</button>',
      body: '<div class="grp" style="margin-top:16px"><div class="cell"><input class="fld" id="pg-name" value="' + esc(chat.name || '') + '" maxlength="60" autocomplete="off" enterkeyhint="done"></div></div>' });
    var b = B.sheet.body(), inp = b.querySelector('#pg-name');
    var save = async function () {
      var name = inp.value.trim(); if (!name) return; B.sheet.close();
      if (name === chat.name) return;
      var r = await B.api('PATCH', '/chats/' + chat.id, { name: name });
      if (r && r.error) B.toast.show(r.error);
      await B.chats.refresh(); paint(el);
    };
    B.sheet.el.querySelector('[data-pg="save"]').addEventListener('click', save);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    setTimeout(function () { inp.focus(); inp.select(); }, 350);
  }
  async function avatar(el, file) {
    var data = await B.ui.groups.resizeAvatar(file), chat = chatOf(el);
    var r = await B.api('POST', '/chats/' + chat.id + '/avatar', { data: data });
    if (r && r.error) { B.toast.show(r.error); return; }
    B.S.avatarTs = Date.now(); B.avatar.clearCache(); paint(el); B.chats.onChanged();
  }

  // ── добавление участников ──
  function available(chat, q) {
    var ex = {}, pend = {}; (chat.members || []).forEach(function (m) { ex[m.id] = 1; }); (chat.pending || []).forEach(function (m) { pend[m.id] = 1; });
    var group = chat.type === 'group'; q = (q || '').trim().toLowerCase();
    return B.S.contacts.filter(function (u) {
      return !ex[u.id] && !pend[u.id] && (!u.federated || (group && (u.contact || u.rel === 'ws'))) && (!q || (u.display_name || '').toLowerCase().indexOf(q) >= 0 || (u.username || '').toLowerCase().indexOf(q) >= 0);
    });
  }
  function addSheet(el) {
    var chat = chatOf(el), sel = [], q = '';
    var list = function () {
      return available(chat, q).map(function (u) {
        var on = sel.indexOf(u.id) >= 0;
        return '<button class="crow2" data-a="toggle" data-id="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 40, true, !!u.federated) + '<div class="t"><b>' + esc(u.display_name) + '</b><span>' + esc(u.federated ? B.contacts.fedAddr(u) + (u.rel === 'ws' ? '' : ' · после согласия') : '@' + (u.username || '')) + '</span></div><span class="pick' + (on ? ' on' : '') + '">' + (on ? ic('check', 15, 3) : '') + '</span></button>';
      }).join('') || '<div class="cell"><span class="cl" style="color:var(--fg2)">Некого добавить</span></div>';
    };
    var right = function () { return '<button class="nb" data-a="go" style="font-weight:600"' + (sel.length ? '' : ' disabled') + '>' + (sel.length ? 'Добавить (' + sel.length + ')' : 'Добавить') + '</button>'; };
    B.sheet.open({ size: 'large', title: 'Участники', left: '<button class="nb" data-sheet="close">Отмена</button>', right: right(),
      body: '<div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="pg-aq" placeholder="Имя или логин" autocomplete="off" autocapitalize="none"></div></div><div class="pgchosen" id="pg-chosen"></div>' +
        '<div class="grp plist" id="pg-alist">' + list() + '</div>' + (chat.type === 'group' ? '<div class="gf">Людей с других серверов можно позвать только из своих контактов: они получат приглашение и сами решат, вступать ли.</div>' : '<div class="gf">Людей с других серверов в комнаты добавляет администратор в админке.</div>') });
    var root = B.sheet.el, b = B.sheet.body(), lst = b.querySelector('#pg-alist'), chosen = b.querySelector('#pg-chosen');
    var redraw = function () {
      lst.innerHTML = list(); B.avatar.apply(lst);
      chosen.innerHTML = sel.map(function (id) { var u = B.contacts.byId(id); return '<span class="c' + (u && u.federated ? ' g' : '') + '">' + esc(u ? u.display_name : '') + ' <u data-a="toggle" data-id="' + id + '">×</u></span>'; }).join('');
      root.querySelector('.sh-nav .r').innerHTML = right();
    };
    B.avatar.apply(lst);
    b.querySelector('#pg-aq').addEventListener('input', function (e) { q = e.target.value; lst.innerHTML = list(); B.avatar.apply(lst); });
    var onClick = async function (e) {
      var t = e.target.closest('[data-a]'); if (!t || !root.contains(t)) return;
      if (t.dataset.a === 'toggle') { var id = +t.dataset.id, i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); redraw(); }
      else if (t.dataset.a === 'go' && sel.length && !t.disabled) {
        t.disabled = true;
        var res = await Promise.all(sel.map(function (uid) { return B.api('POST', '/chats/' + chat.id + '/members', { user_id: uid }); }));
        B.sheet.close();
        var err = res.find(function (r) { return r && r.error; });
        if (err) B.toast.show(err.error); else if (res.some(function (r) { return r && r.pending; })) B.toast.show('Приглашение отправлено. Человек появится после согласия');
        await B.chats.refresh(); paint(el);
      }
    };
    root.addEventListener('click', onClick);
    var prev = B.sheet.cur.onClose; B.sheet.cur.onClose = function () { root.removeEventListener('click', onClick); if (prev) prev(); };
  }

  // ── жест «смахнуть влево — убрать» ──
  function bindSwipe(el) {
    var G = null;
    el.addEventListener('pointerdown', function (e) {
      var f = e.target.closest('.pgrow.pgsw .pgf'); if (!f || (e.pointerType === 'mouse' && e.button !== 0)) return;
      closeRows(el, f); G = { f: f, x: e.clientX, y: e.clientY, x0: f._tx || 0, mode: null, id: e.pointerId };
    });
    el.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = e.clientX - G.x, dy = e.clientY - G.y;
      if (!G.mode) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; if (Math.abs(dx) <= Math.abs(dy)) { G = null; return; } G.mode = 'h'; G.f.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch (_) {} }
      G.f._tx = Math.max(-SW, Math.min(0, G.x0 + dx)); G.f.style.transform = 'translateX(' + G.f._tx + 'px)'; G.f.parentNode.classList.add('open');
    });
    function end(e) {
      if (!G || e.pointerId !== G.id) return; var g = G; G = null; if (!g.mode) return;
      g.f.classList.remove('drag'); g.f._tx = g.f._tx < -SW / 2 ? -SW : 0; g.f.style.transform = g.f._tx ? 'translateX(' + g.f._tx + 'px)' : ''; g.f.parentNode.classList.toggle('open', !!g.f._tx); el._swiped = Date.now();
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function closeRows(el, except) { el.querySelectorAll('.pgf').forEach(function (f) { if (f !== except && f._tx) { f._tx = 0; f.style.transform = ''; f.parentNode.classList.remove('open'); } }); }

  function onClick(el, e) {
    if (el._swiped && Date.now() - el._swiped < 250) return;
    var t = e.target.closest('[data-r]'); if (!t) return; var r = t.dataset.r, id = +t.dataset.id;
    if (r === 'chip') { el._g.f = t.dataset.k; paint(el); }
    else if (r === 'add') addSheet(el);
    else if (r === 'find') { var i = el.querySelector('#pg-q'); if (i) { el.querySelector('.scroll').scrollTop = i.getBoundingClientRect().top - el.querySelector('.scroll').getBoundingClientRect().top + el.querySelector('.scroll').scrollTop - 12; i.focus(); } }
    else if (r === 'mute') mute(el);
    else if (r === 'leave') leave(el);
    else if (r === 'delete') del(el);
    else if (r === 'rename') rename(el);
    else if (r === 'avatar') { var f = el.querySelector('.pgav input[type=file]'); if (f) f.click(); }
    else if (r === 'kick') kick(el, id, t.dataset.pend === '1');
    else if (r === 'topic') B.ui.chat.open(id);
    else if (r === 'media') B.media.openChatMedia(+el.dataset.gid);
    else if (r === 'm') { var f2 = e.target.closest('.pgf'); if (f2 && f2._tx) { closeRows(el); return; } memberSheet(el, id, false); }
    else if (r === 'pend') memberSheet(el, id, true);
  }

  function open(cid) {
    var chat = B.find(cid); if (!chat || chat.invite) return;
    var top = B.nav.top(); if (top && top.el.dataset.gid == cid) return;
    var el = B.nav.page({ title: chat.type === 'room' ? 'Комната' : 'Группа', gray: true, back: B.chatName(chat), body: '' }); el.dataset.gid = cid;
    el._g = { f: 'all', q: '' };
    el.addEventListener('click', function (e) { onClick(el, e); });
    el.addEventListener('input', function (e) { if (e.target.id === 'pg-q') { el._g.q = e.target.value; paintLists(el); } });
    el.addEventListener('change', function (e) { var f = e.target; if (f.type === 'file' && f.files[0]) { var file = f.files[0]; f.value = ''; avatar(el, file); } });
    bindSwipe(el);
    B.nav.push(el, B.chatName(chat)); paint(el);
    if (chat.type === 'room' && !(B.S.topics[cid] || []).length) B.chats.loadTopics(cid);
  }
  function each(fn) { B.nav.stack.forEach(function (s) { if (s.el.dataset.gid) fn(s.el); }); }
  B.bus.on('chats:changed', function () {
    each(function (el) { if (!chatOf(el)) { if (B.nav.top() && B.nav.top().el === el) B.nav.pop(); return; } paint(el); });
  });
  B.bus.on('chat:online', function () { each(paintLive); });
  B.bus.on('presence:changed', function () { each(paintLive); });
  B.bus.on('contacts:changed', function () { each(paintLists); });
  B.openGroupProfile = open;
  return { open: open };
})();
