// /m — «Новый чат», создание группы, «Добавить контакт», участники, устройства скрытого чата и список тем комнаты.
B.ui = B.ui || {};
B.ui.groups = (function () {
  var esc = B.esc, ic = B.ic;
  var grp = { name: '', sel: [], avatar: null, q: '' };

  // ── новый чат: шторка со списком контактов и строкой «Новая группа» ──
  var step = 'list';
  function ncList(q) {
    q = (q || '').trim().toLowerCase();
    var list = B.S.contacts.filter(function (u) { return !q || u.display_name.toLowerCase().indexOf(q) >= 0 || (u.username || '').toLowerCase().indexOf(q) >= 0; });
    return list.map(function (u) {
      return '<button class="crow2" data-g="peer" data-id="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 40) + '<div class="t"><b>' + esc(u.display_name) + '</b><span>' + esc(B.presence.statusText(u.id)) + '</span></div></button>';
    }).join('') || '<div class="cell"><span class="cl" style="color:var(--fg2)">Никого не нашли</span></div>';
  }
  function listStep() {
    step = 'list';
    B.sheet.set({ title: 'Новый чат', left: '<button class="nb" data-sheet="close">Отмена</button>', right: '',
      body: '<div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="nc-q" placeholder="Кому" autocomplete="off" autocapitalize="none"></div></div>' +
        '<div class="grp" style="margin-top:4px"><button class="cell tap hasi" data-g="group"><span class="ci" style="background:var(--accent)">' + ic('users', 17, 2) + '</span><span class="cl">Новая группа</span><span class="chev">' + ic('chev', 16, 2.4) + '</span></button></div>' +
        '<div class="hdr-s" style="padding-top:0">Контакты</div><div class="grp plist" id="nc-list">' + ncList('') + '</div>' });
    var b = B.sheet.body(), list = b.querySelector('#nc-list');
    B.avatar.apply(list);
    b.querySelector('#nc-q').addEventListener('input', function (e) { list.innerHTML = ncList(e.target.value); B.avatar.apply(list); });
  }
  function newChat() {
    if (!B.S.contacts.length) B.contacts.load();
    B.sheet.open({ size: 'large', title: 'Новый чат', body: '' });
    document.querySelector('.sh').addEventListener('click', onSheetClick);
    listStep();
  }
  async function onSheetClick(e) {
    var t = e.target.closest('[data-g]'); if (!t) return; var a = t.dataset.g;
    if (a === 'group') groupStep();
    else if (a === 'back') listStep();
    else if (a === 'peer') {
      var chat = await B.contacts.openDirect(+t.dataset.id); B.sheet.close();
      if (chat) setTimeout(function () { B.openChat(chat.id); }, 260); else B.toast.show('Не удалось открыть чат');
    }
    else if (a === 'create') submitGroup();
    else if (a === 'avatar') { var f = B.sheet.body().querySelector('#g-file'); if (f) f.click(); }
    else if (a === 'toggle') {
      var id = +t.dataset.id, i = grp.sel.indexOf(id); if (i >= 0) grp.sel.splice(i, 1); else grp.sel.push(id);
      var list = B.sheet.body().querySelector('#g-list'); list.innerHTML = pickHtml(); B.avatar.apply(list);
    }
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
  function pickHtml() {
    var s = grp.q.trim().toLowerCase();
    var list = B.S.contacts.filter(function (u) { return !s || u.display_name.toLowerCase().indexOf(s) >= 0; });
    return list.map(function (u) {
      var on = grp.sel.indexOf(u.id) >= 0;
      return '<button class="crow2" data-g="toggle" data-id="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 40, true) + '<div class="t"><b>' + esc(u.display_name) + '</b></div><span class="pick' + (on ? ' on' : '') + '">' + (on ? ic('check', 15, 3) : '') + '</span></button>';
    }).join('') || '<div class="cell"><span class="cl" style="color:var(--fg2)">Никого не нашли</span></div>';
  }
  function groupStep() {
    step = 'group'; grp = { name: '', sel: [], avatar: null, q: '' };
    B.sheet.set({ title: 'Новая группа', left: '<button class="nb" data-g="back">Назад</button>', right: '<button class="nb" data-g="create" style="font-weight:600">Создать</button>',
      body: '<button class="gav" data-g="avatar" id="g-av" aria-label="Фото группы">' + ic('cam', 30, 1.6) + '</button><input type="file" accept="image/*" hidden id="g-file">' +
        '<div class="grp" style="margin-top:16px"><div class="cell"><input class="fld" id="g-name" placeholder="Название группы" maxlength="60" autocomplete="off"></div></div>' +
        '<div class="srch" style="padding-top:0"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="g-q" placeholder="Поиск участников" autocomplete="off"></div></div>' +
        '<div class="gh">Участники</div><div class="grp plist" id="g-list">' + pickHtml() + '</div>' });
    var b = B.sheet.body(), list = b.querySelector('#g-list'), av = b.querySelector('#g-av'), file = b.querySelector('#g-file');
    B.avatar.apply(list);
    b.querySelector('#g-name').addEventListener('input', function (e) { grp.name = e.target.value; });
    b.querySelector('#g-q').addEventListener('input', function (e) { grp.q = e.target.value; list.innerHTML = pickHtml(); B.avatar.apply(list); });
    file.addEventListener('change', async function () {
      var f = file.files[0]; file.value = ''; if (!f) return;
      grp.avatar = await resizeAvatar(f); av.innerHTML = ''; av.style.backgroundImage = 'url(data:image/jpeg;base64,' + grp.avatar + ')'; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center';
    });
  }
  function createGroup() { newChat(); groupStep(); }
  async function submitGroup() {
    var name = grp.name.trim();
    if (!name) { B.toast.show('Введите название группы'); return; }
    if (!grp.sel.length) { B.toast.show('Выберите хотя бы одного участника'); return; }
    var chat = await B.api('POST', '/chats/group', { name: name, member_ids: grp.sel });
    if (!chat || chat.error) { B.toast.show('Не удалось создать группу'); return; }
    if (grp.avatar) await B.api('POST', '/chats/' + chat.id + '/avatar', { data: grp.avatar });
    B.S.chats.push(chat); B.chats.onChanged(); B.sheet.close();
    setTimeout(function () { B.openChat(chat.id); }, 260);
  }

  // ── добавить контакт ──
  function addContact() {
    B.sheet.open({ size: 'large', title: 'Добавить контакт', left: '<button class="nb" data-sheet="close">Отмена</button>',
      body: '<div style="height:14px"></div><div class="grp"><div class="cell"><input class="fld" id="ac-login" placeholder="Логин или сервер:логин" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done"></div></div>' +
        '<div class="hint" id="ac-hint">Введите логин человека точно. Если он на другом сервере, укажите адрес: @сервер:логин. Он не узнает, что вы его добавили.</div><button class="btn" id="ac-go">Добавить</button>' });
    var b = B.sheet.body(), inp = b.querySelector('#ac-login'), go = b.querySelector('#ac-go'), hint = b.querySelector('#ac-hint');
    var submit = async function () {
      var login = inp.value.trim().replace(/^@/, ''); if (!login) { inp.focus(); return; }
      go.disabled = true; var r = await B.api('POST', '/contacts', { username: login }); go.disabled = false;
      if (r && r.ok) { B.sheet.close(); B.toast.show(((r.user && r.user.display_name) || login) + ' добавлен в контакты'); B.contacts.load(); return; }
      hint.textContent = (r && r.error) || 'Не удалось добавить. Проверьте соединение.'; hint.className = 'hint err';
    };
    inp.addEventListener('input', function () { if (/^\s*@/.test(inp.value)) inp.value = inp.value.replace(/^\s*@+/, ''); if (hint.classList.contains('err')) { hint.className = 'hint'; hint.textContent = 'Логин можно узнать у самого человека.'; } });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); go.addEventListener('click', submit);
    setTimeout(function () { inp.focus(); }, 350);
  }

  // ── участники группы или комнаты ──
  function members(cid) {
    var chat = B.find(cid); if (!chat || chat.invite) return;
    var list = [{ id: B.S.user.id, display_name: B.S.user.display_name, me: 1 }].concat((chat.members || []).filter(function (m) { return m.id !== B.S.user.id; }));
    B.sheet.open({ size: 'med', title: esc(B.chatName(chat)), right: '<button class="nb" data-sheet="close">Готово</button>',
      body: '<div class="gh" style="margin-top:12px">' + list.length + ' участников</div><div class="grp plist">' + list.map(function (m) {
        return '<button class="crow2" data-m="' + m.id + '">' + B.avatar.user(m.id, m.display_name, 40, false, m.federated) + '<div class="t"><b>' + esc(m.display_name) + (m.me ? ' (вы)' : '') + (m.federated ? ' ' + B.contacts.wsTag(m) : '') + '</b><span>' + (m.me ? 'Онлайн' : esc(B.presence.statusText(m.id))) + '</span></div></button>';
      }).join('') + '</div>' });
    var b = B.sheet.body(); B.avatar.apply(b);
    b.addEventListener('click', function (e) { var t = e.target.closest('[data-m]'); if (!t || +t.dataset.m === B.S.user.id) return; B.sheet.close(); setTimeout(function () { B.openProfile(+t.dataset.m); }, 260); });
  }
  B.openMembers = members;

  // ── устройства скрытого чата ──
  async function devices(chatId) {
    var rows = await B.secret.devices(chatId);
    if (!Array.isArray(rows)) { B.toast.show((rows && rows.error) || 'Не удалось загрузить устройства'); return; }
    var mine = SC.deviceId(), chat = B.find(chatId), names = {};
    ((chat && chat.members) || []).forEach(function (u) { names[u.id] = u.display_name; });
    B.sheet.open({ size: 'med', title: 'Устройства чата', right: '<button class="nb" data-sheet="close">Закрыть</button>',
      body: '<div class="gh" style="margin-top:12px">Устройства</div><div class="grp">' + rows.map(function (r) {
        return '<div class="cell"><span class="cl">' + esc(r.device_label || 'Устройство') + ' · ' + esc(names[r.user_id] || 'Пользователь') + (r.device_id === mine ? ' — это устройство' : '') + '</span></div>';
      }).join('') + '</div><div class="gf">Ключ не переносится сам: новое устройство подключается только с подтверждения собеседника.</div>' });
  }

  // ── темы комнаты ──
  var topicsRoom = null;
  function topicRow(t) {
    var lm = t.last_message, u = t.unread || 0, men = t.unread_mentions || 0, mine = lm && !lm.deleted && lm.sender_id === B.S.user.id;
    var pv = lm ? esc(((mine ? 'Вы: ' : '') + B.chats.preview({ last_message: lm })).slice(0, 160)) : 'Нет сообщений';
    return '<div class="swrow" data-id="' + t.id + '"><div class="swf" data-topic="' + t.id + '"><div class="row">' + B.avatar.html({ id: t.id, chat: t.id, text: '#' }, 48) +
      '<div class="rb"><div class="r1"><span class="rn"><span class="nm">' + esc(t.name) + '</span></span><span class="rt">' + (lm ? B.fmt.chatListTime(lm.sent_at) : '') + '</span></div>' +
      '<div class="r2"><div class="rm">' + pv + '</div>' + (men ? '<div class="rbd">@</div>' : u ? '<div class="rbd">' + (u > 99 ? '99+' : u) + '</div>' : '') + '</div></div></div></div></div>';
  }
  function renderTopics() {
    var pg = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.room; }); if (!pg) return;
    var subs = B.chats.topicsOf(+pg.dataset.room), box = pg.querySelector('.scroll');
    box.innerHTML = subs.length ? subs.map(topicRow).join('') : '<div class="empty"><b>Тем пока нет</b></div>';
    B.avatar.apply(box);
  }
  async function openRoom(roomId) {
    var room = B.find(roomId); if (!room) return;
    var el = B.nav.page({ title: esc(B.chatName(room)), back: 'Чаты', body: '<div class="stub-note">Загрузка…</div>' }); el.dataset.room = roomId;
    el.addEventListener('click', function (e) { var t = e.target.closest('[data-topic]'); if (t) B.ui.chat.open(+t.dataset.topic); });
    B.nav.push(el, B.chatName(room)); topicsRoom = roomId;
    await B.chats.loadTopics(roomId); renderTopics();
  }
  B.ui.topics = { open: openRoom };
  B.bus.on('chats:changed', function () { if (B.nav.stack.some(function (s) { return s.el.dataset.room; })) renderTopics(); });
  B.bus.on('topics:reload', function () { var s = B.nav.stack.find(function (x) { return x.el.dataset.room; }); if (s) B.chats.loadTopics(+s.el.dataset.room).then(renderTopics); });

  return { newChat: newChat, createGroup: createGroup, addContact: addContact, members: members, devices: devices };
})();
