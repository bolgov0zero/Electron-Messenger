// /m — «Новый чат», «Новая группа», «Добавить контакт», участники, устройства скрытого чата и комната с темами. Страницы и листы — как в макете.
B.ui = B.ui || {};
B.ui.groups = (function () {
  var grp = { name: '', sel: [], avatar: null };

  // ── новый чат: страница со строками «Новая группа», «Добавить контакт» и списком людей ──
  function personRow(u, attrs) {
    return '<button class="mini" data-k="' + u.id + '"' + (attrs || '') + '>' + B.avatar.user(u.id, u.display_name, 0, true, u.federated) + '<span class="rt"><b>' + B.esc(u.display_name) + '</b><small>' + B.esc(B.presence.statusText(u.id)) + '</small></span></button>';
  }
  function peopleHtml(q, pickable) {
    q = (q || '').trim().toLowerCase();
    var list = B.S.contacts.filter(function (u) { return (!pickable || !u.federated || u.rel === 'ws') && (!q || u.display_name.toLowerCase().indexOf(q) >= 0 || (u.username || '').toLowerCase().indexOf(q) >= 0); });
    return list.length ? list : null;
  }
  function newChat() {
    if (!B.S.contacts.length) B.contacts.load();
    var el = B.nav.page({ title: 'Новый чат', body: '<label class="srch glass">' + I('search') + '<input id="nq" placeholder="Кому" autocomplete="off" autocapitalize="none"></label>' +
      '<div class="grp glass"><button class="cell" data-g="group"><span class="ci" style="background:var(--accent)">' + I('users') + '</span><span class="cl">Новая группа</span><span class="ch">' + I('chevRight') + '</span></button>' +
      '<button class="cell" data-g="add"><span class="ci" style="background:#5b8def">' + I('userPlus') + '</span><span class="cl">Добавить контакт</span><span class="ch">' + I('chevRight') + '</span></button></div>' +
      '<div class="gl">Люди</div><div id="nlist"></div>' });
    var list = $('#nlist', el), paint = function (q) {
      var l = peopleHtml(q); list.innerHTML = l ? '<div class="grp glass">' + l.map(function (u) { return personRow(u); }).join('') + '</div>' : '<div class="empty" style="padding:30px"><b>Никого не нашли</b></div>'; B.avatar.apply(list);
    };
    paint('');
    $('#nq', el).addEventListener('input', function (e) { paint(e.target.value); });
    $('#nq', el).addEventListener('focus', function () { showKb(); });
    el.addEventListener('click', async function (e) {
      var g = e.target.closest('[data-g]'), k = e.target.closest('[data-k]');
      if (g) { if (g.dataset.g === 'group') newGroup(); else addContact(); return; }
      if (k) {
        var chat = await B.contacts.openDirect(+k.dataset.k); if (!chat) { B.toast.show('Не удалось открыть чат', 'x'); return; }
        B.nav.popToRoot(); setTimeout(function () { B.openChat(chat.id); }, 480);
      }
    });
    B.nav.push(el);
  }

  // ── группа ──
  function resizeAvatar(file) {
    return new Promise(function (resolve) {
      var rd = new FileReader();
      rd.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var size = 256, cv = document.createElement('canvas'); cv.width = cv.height = size;
          var s = Math.min(img.width, img.height); cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(cv.toDataURL('image/jpeg', 0.88).split(',')[1]);
        };
        img.src = e.target.result;
      };
      rd.readAsDataURL(file);
    });
  }
  function newGroup() {
    grp = { name: '', sel: [], avatar: null };
    var el = B.nav.page({ title: 'Новая группа', right: '<button class="nb glass gi t" data-mk disabled style="opacity:.5">Создать</button>',
      body: '<div style="display:flex;justify-content:center;margin-bottom:6px"><button class="av xl glass gi" data-pick style="background:var(--gl);color:var(--text2);font-size:30px" aria-label="Фото группы">' + I('image') + '</button><input type="file" accept="image/*" hidden id="gfile"></div>' +
        '<label class="fld m glass-inset">' + I('users') + '<input id="gn" placeholder="Название группы" maxlength="60" autocomplete="off"></label>' +
        '<div class="gl" style="margin-top:10px">Участники</div><div id="glist"></div>' });
    var list = $('#glist', el), mk = $('[data-mk]', el);
    var paint = function () {
      var l = peopleHtml('', true);
      list.innerHTML = l ? '<div class="grp glass">' + l.map(function (u) { return '<button class="mini' + (grp.sel.indexOf(u.id) >= 0 ? ' on' : '') + '" data-k="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 0, true) + '<span class="rt"><b>' + B.esc(u.display_name) + '</b><small>' + B.esc(B.presence.statusText(u.id)) + '</small></span><span class="ck">' + I('check') + '</span></button>'; }).join('') + '</div>' : '<div class="empty" style="padding:30px"><b>Некого добавить</b></div>';
      B.avatar.apply(list);
    };
    paint();
    var chk = function () { var ok = grp.name.trim() && grp.sel.length; mk.disabled = !ok; mk.style.opacity = ok ? 1 : .5; };
    el.addEventListener('input', function (e) { if (e.target.id === 'gn') { grp.name = e.target.value; chk(); } });
    $('#gn', el).addEventListener('focus', function () { showKb(); });
    $('#gfile', el).addEventListener('change', async function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      grp.avatar = await resizeAvatar(f); var b = $('[data-pick]', el); b.innerHTML = ''; b.style.backgroundImage = 'url(data:image/jpeg;base64,' + grp.avatar + ')'; b.style.backgroundSize = 'cover';
    });
    el.addEventListener('click', async function (e) {
      if (e.target.closest('[data-pick]')) { $('#gfile', el).click(); return; }
      var r = e.target.closest('.mini[data-k]');
      if (r) { var id = +r.dataset.k, i = grp.sel.indexOf(id); if (i >= 0) grp.sel.splice(i, 1); else grp.sel.push(id); r.classList.toggle('on'); chk(); return; }
      if (e.target.closest('[data-mk]') && !mk.disabled) {
        mk.disabled = true;
        var chat = await B.api('POST', '/chats/group', { name: grp.name.trim(), member_ids: grp.sel });
        if (!chat || chat.error) { B.toast.show('Не удалось создать группу', 'x'); mk.disabled = false; return; }
        if (grp.avatar) await B.api('POST', '/chats/' + chat.id + '/avatar', { data: grp.avatar });
        B.S.chats.push(chat); B.chats.onChanged(); B.nav.popToRoot(); B.toast.show('Группа создана', 'users'); setTimeout(function () { B.openChat(chat.id); }, 520);
      }
    });
    B.nav.push(el);
  }
  function createGroup() { newGroup(); }

  // ── добавить контакт ──
  function addContact() {
    var S = B.sheet.open({ title: 'Добавить контакт', sub: 'Логин человека на вашем сервере или адрес с другого: @сервер:логин',
      body: '<label class="fld m glass-inset">' + I('user') + '<input id="ac" placeholder="Логин" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done"></label><div class="hint" id="achint"></div><button class="abtn pri" data-go disabled>Добавить</button>' });
    var inp = $('#ac', S.el), go = $('[data-go]', S.el), hint = $('#achint', S.el);
    var submit = async function () {
      var login = inp.value.trim().replace(/^@/, ''); if (!login) { inp.focus(); return; }
      go.disabled = true; var r = await B.api('POST', '/contacts', { username: login }); go.disabled = false;
      if (r && r.ok) { B.sheet.close(); B.toast.show(((r.user && r.user.display_name) || login) + ' добавлен в контакты', 'userPlus'); B.contacts.load(); return; }
      hint.textContent = (r && r.error) || 'Не удалось добавить. Проверьте соединение.'; hint.className = 'hint err';
    };
    inp.addEventListener('input', function () { if (/^\s*@/.test(inp.value)) inp.value = inp.value.replace(/^\s*@+/, ''); go.disabled = !inp.value.trim(); hint.textContent = ''; hint.className = 'hint'; });
    inp.addEventListener('focus', function () { showKb(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); go.addEventListener('click', submit);
    setTimeout(function () { inp.focus(); }, 520);
  }

  // ── участники группы или комнаты (быстрый список) ──
  function members(cid) {
    var chat = B.find(cid); if (!chat || chat.invite) return;
    var list = [{ id: B.S.user.id, display_name: B.S.user.display_name, me: 1 }].concat((chat.members || []).filter(function (m) { return m.id !== B.S.user.id; }));
    var S = B.sheet.open({ title: B.esc(B.chatName(chat)), sub: list.length + ' участников', body: '<div class="grp glass">' + list.map(function (m) {
      return '<button class="mini" data-m="' + m.id + '">' + B.avatar.user(m.id, m.display_name, 0, false, m.federated) + '<span class="rt"><b>' + B.esc(m.display_name) + (m.me ? ' (вы)' : '') + '</b><small>' + (m.me ? 'в сети' : B.esc(B.presence.statusText(m.id))) + '</small></span></button>';
    }).join('') + '</div>' });
    B.avatar.apply(S.el);
    S.el.addEventListener('click', function (e) { var t = e.target.closest('[data-m]'); if (!t || +t.dataset.m === B.S.user.id) return; B.sheet.close(); setTimeout(function () { B.openProfile(+t.dataset.m); }, 440); });
  }
  B.openMembers = members;

  // ── устройства скрытого чата ──
  async function devices(chatId) {
    var rows = await B.secret.devices(chatId);
    if (!Array.isArray(rows)) { B.toast.show((rows && rows.error) || 'Не удалось загрузить устройства', 'x'); return; }
    var mine = SC.deviceId(), chat = B.find(chatId), names = {};
    ((chat && chat.members) || []).forEach(function (u) { names[u.id] = u.display_name; });
    B.sheet.open({ title: 'Устройства чата', sub: 'Ключ не переносится сам: новое устройство подключается только с подтверждения собеседника.', body: '<div class="grp glass">' + rows.map(function (r) {
      return '<div class="cell"><span class="cl">' + B.esc(r.device_label || 'Устройство') + ' · ' + B.esc(names[r.user_id] || 'Пользователь') + (r.device_id === mine ? ' — это устройство' : '') + '</span></div>';
    }).join('') + '</div><button class="abtn" data-close>Закрыть</button>' });
  }

  // ── комната с темами ──
  function topicRow(t) {
    var lm = t.last_message, u = t.unread || 0, men = t.unread_mentions || 0, mine = lm && !lm.deleted && lm.sender_id === B.S.user.id;
    var pv = lm ? B.esc(((mine ? 'Вы: ' : '') + B.chats.preview({ last_message: lm })).slice(0, 160)) : 'Нет сообщений';
    return '<button class="row" data-topic="' + t.id + '">' + B.avatar.html({ id: t.id, chat: t.id, text: '#', sq: true }) + '<div class="rt"><div class="r1"><b>' + B.esc(t.name) + '</b><span class="tm' + (u ? ' new' : '') + '">' + (lm ? B.fmt.chatListTime(lm.sent_at) : '') + '</span></div>' +
      '<div class="r2"><span class="pv">' + pv + '</span>' + (men ? '<span class="bd at">@</span>' : u ? '<span class="bd">' + (u > 99 ? '99+' : u) + '</span>' : '') + '</div></div></button>';
  }
  function renderTopics() {
    var pg = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.room; }); if (!pg) return;
    var subs = B.chats.topicsOf(+pg.dataset.room), box = $('#tlist', pg);
    box.innerHTML = subs.length ? '<div class="gl">Темы</div><div class="grp glass">' + subs.map(topicRow).join('') + '</div>' : '<div class="empty"><b>Тем пока нет</b></div>';
    var p = $('.hero p', pg), room = B.find(+pg.dataset.room); if (p && room) p.textContent = 'Комната · ' + subs.length + ' тем';
    B.avatar.apply(pg);
  }
  async function openRoom(roomId) {
    var room = B.find(roomId); if (!room) return;
    var el = B.nav.page({ title: B.esc(B.chatName(room)), cap: 1, right: '<button data-i aria-label="О комнате">' + I('info') + '</button>',
      body: '<div class="hero" style="padding-bottom:10px">' + B.avatar.chat(room) + '<p>Комната</p></div><div id="tlist"><div class="empty" style="padding:30px">Загрузка…</div></div>' });
    el.dataset.room = roomId;
    $('.hero .av', el).style.cssText += ';width:84px;height:84px;font-size:30px';
    el.addEventListener('click', function (e) {
      var r = e.target.closest('[data-topic]'); if (r) { B.ui.chat.open(+r.dataset.topic); return; }
      if (e.target.closest('[data-i]') && B.openGroupProfile) B.openGroupProfile(roomId);
    });
    longPress(el, '[data-topic]', function (row) { var t = B.find(+row.dataset.topic); if (t) B.toast.show('Тема: ' + t.name, 'hash'); });
    B.nav.push(el, B.chatName(room));
    await B.chats.loadTopics(roomId); renderTopics();
  }
  B.ui.topics = { open: openRoom };
  B.bus.on('chats:changed', function () { renderTopics(); });
  return { newChat: newChat, createGroup: createGroup, addContact: addContact, members: members, devices: devices, resizeAvatar: resizeAvatar };
})();
