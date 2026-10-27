// /beta — профиль человека по макету: аватар, имя, статус, плитки «Написать / Контакт / Блок», сведения, общие группы.
B.ui = B.ui || {};
B.ui.profile = (function () {
  function user(id) {
    var u = B.contacts.byId(id); if (u) return u;
    var m = B.S.chats.reduce(function (a, c) { return a.concat(c.members || []); }, []).find(function (x) { return x.id === id; });
    return m ? Object.assign({}, m, { rel: 'chat' }) : null;
  }
  function html(id) {
    var u = user(id); if (!u) return '<div class="empty"><b>Профиль недоступен</b></div>';
    var fed = !!u.federated, other = !fed && u.rel !== 'ws' && !!u.workspace_name, canContact = fed || other;
    var blocked = B.contacts.isBlocked(id), st = B.presence.statusText(id), on = B.S.presence[id] === 'online';
    var my = (B.S.user.workspaces && B.S.user.workspaces.length) || 1;
    var loginTxt = fed ? B.contacts.fedAddr(u) : '@' + u.username, rows = [];
    if (fed) rows.push(['Сервер', 'Другой сервер']);
    else if (other) rows.push(['Пространство', u.workspace_name]);
    else if (u.rel === 'ws' && my > 1 && u.shared_workspaces && u.shared_workspaces.length) rows.push([u.shared_workspaces.length > 1 ? 'Пространства' : 'Пространство', u.shared_workspaces.join(' · ')]);
    if (canContact) rows.push(['В ваших контактах', u.contact ? 'Да' : 'Нет']);
    var groups = B.S.chats.filter(function (c) { return (c.type === 'group' || c.type === 'room') && !c.parent_id && !c.is_secret && (c.members || []).some(function (m) { return m.id === id; }); });
    var dm = B.S.chats.find(function (c) { return c.type === 'direct' && !c.is_secret && B.peerId(c) === id; });
    var h = '<div class="hero">' + B.avatar.user(id, u.display_name, 0, false, fed) + '<h2>' + B.esc(u.display_name) + '</h2><p class="' + (on ? 'on' : '') + '">' + B.esc(st) + '</p>' +
      (u.tag ? '<span class="pill-tag" style="margin-top:6px;' + B.tagInk(u.tag) + '">' + B.esc(u.tag) + '</span>' : '') + '</div>' +
      '<div class="tiles"><button class="tile glass gi" data-p="write">' + I('chat') + 'Написать</button>' +
      (canContact ? '<button class="tile glass gi" data-p="contact">' + I(u.contact ? 'userMinus' : 'userPlus') + (u.contact ? 'Из контактов' : 'В контакты') + '</button>' : '<button class="tile glass gi" data-p="media"' + (dm ? ' data-id="' + dm.id + '"' : ' disabled') + '>' + I('image') + 'Медиа</button>') +
      '<button class="tile glass gi' + (blocked ? '' : ' d') + '" data-p="block">' + I(blocked ? 'unban' : 'ban') + (blocked ? 'Разблокировать' : 'Блок') + '</button></div>';
    if (blocked) h += '<div class="nbanner glass" style="margin:0 0 16px">' + I('ban') + '<span>Вы заблокировали этого человека: он не может писать вам в личные сообщения. Общие группы остаются.</span></div>';
    if (dm && canContact) h += '<button class="cell glass" style="border-radius:var(--r-card);margin-bottom:16px" data-p="media" data-id="' + dm.id + '"><span class="ci" style="background:#5b8def">' + I('image') + '</span><span class="cl">Медиа, файлы и ссылки</span><span class="ch">' + I('chevRight') + '</span></button>';
    h += '<div class="grp glass"><button class="cell" data-p="copy" data-v="' + B.esc(loginTxt) + '"><span class="cl">Логин</span><span class="cv">' + B.esc(loginTxt) + '</span><span class="ch">' + I('copy') + '</span></button>' +
      rows.map(function (r) { return '<div class="cell"><span class="cl">' + r[0] + '</span><span class="cv">' + B.esc(r[1]) + '</span></div>'; }).join('') + '</div>';
    if (groups.length) h += '<div class="gl">Общие группы · ' + groups.length + '</div><div class="grp glass">' + groups.map(function (c) {
      return '<button class="mini" data-p="chat" data-id="' + c.id + '">' + B.avatar.chat(c, 0, true) + '<span class="rt"><b>' + B.esc(B.chatName(c)) + '</b><small>' + (c.type === 'room' ? 'Комната' : 'Группа') + ' · ' + (c.members || []).length + ' уч.</small></span><span class="ch">' + I('chevRight') + '</span></button>';
    }).join('') + '</div>';
    return h;
  }
  function open(id) {
    if (!id || id === B.S.user.id) return;
    var top = B.nav.top(); if (top && top.el.dataset.uid == id) return;
    var u = user(id), el = B.nav.page({ title: B.esc(u ? u.display_name : 'Профиль'), body: html(id) }); el.dataset.uid = id;
    el.addEventListener('click', function (e) { act(id, e); });
    B.nav.push(el); B.avatar.apply(el);
  }
  function refresh() {
    B.nav.stack.forEach(function (s) {
      var id = s.el.dataset.uid; if (!id) return;
      var sc_ = $('.scroll', s.el), y = sc_.scrollTop; sc_.innerHTML = html(+id); sc_.scrollTop = y; B.avatar.apply(sc_);
    });
  }
  async function toggleContact(id) {
    var u = user(id); if (!u) return;
    if (u.contact) { await B.api('DELETE', '/contacts/' + id); B.toast.show('Удалён из контактов', 'userMinus'); }
    else {
      var r = await B.api('POST', '/contacts', { username: u.username });
      if (!(r && (r.ok || r.code === 'already'))) { B.toast.show((r && r.error) || 'Не удалось добавить контакт', 'x'); return; }
      B.toast.show(u.display_name + ' добавлен в контакты', 'userPlus');
    }
    await B.contacts.load(); refresh();
  }
  function block(id) {
    var u = user(id); if (!u) return;
    if (B.contacts.isBlocked(id)) { B.api('DELETE', '/blocks/' + id).then(function () { return B.contacts.loadBlocks(); }).then(function () { B.toast.show('Разблокирован', 'unban'); refresh(); }); return; }
    B.actions.confirm('Заблокировать ' + u.display_name.split(' ')[0] + '?', 'Человек не сможет писать вам в личные сообщения. Общие группы и комнаты останутся. Разблокировать можно в настройках.', 'Заблокировать', async function () {
      var r = await B.api('POST', '/blocks', { user_id: id });
      if (!(r && r.ok)) B.toast.show((r && r.error) || 'Не удалось заблокировать', 'x'); else { await B.contacts.loadBlocks(); B.toast.show('Заблокирован', 'ban'); }
      refresh();
    });
  }
  async function write(id) {
    var chat = await B.contacts.openDirect(id); if (!chat) { B.toast.show('Не удалось открыть чат', 'x'); return; }
    var under = B.nav.stack[B.nav.stack.length - 2];
    if (under && under.el.dataset.cid == chat.id) B.nav.pop(); else B.openChat(chat.id);
  }
  function act(id, e) {
    var b = e.target.closest('[data-p]'); if (!b || b.disabled) return; var p = b.dataset.p;
    if (p === 'write') write(id); else if (p === 'contact') toggleContact(id); else if (p === 'block') block(id);
    else if (p === 'chat') B.openChat(+b.dataset.id);
    else if (p === 'media') B.media.openChatMedia(+b.dataset.id);
    else if (p === 'copy') { var t = b.dataset.v; navigator.clipboard.writeText(t).then(function () { B.toast.show('Скопировано: ' + t, 'copy'); }, function () { B.toast.show('Не удалось скопировать', 'x'); }); }
  }
  function removeContact(id) {
    var u = user(id); if (!u) return;
    B.actions.confirm('Удалить «' + u.display_name + '» из контактов?', '', 'Удалить', async function () { await B.api('DELETE', '/contacts/' + id); B.toast.show('Удалён из контактов', 'userMinus'); B.contacts.load(); });
  }
  B.bus.on('contacts:changed', refresh); B.bus.on('blocks:changed', refresh); B.bus.on('presence:changed', refresh);
  B.openProfile = open;
  // «Добавить в контакты» из шапки переписки
  B.openAddFromChat = async function (id) {
    var u = user(id); if (!u || !u.username) return;
    var r = await B.api('POST', '/contacts', { username: u.username });
    if (r && (r.ok || r.code === 'already')) { B.toast.show(u.display_name + ' добавлен в контакты', 'userPlus'); B.contacts.load(); } else B.toast.show((r && r.error) || 'Не удалось добавить контакт', 'x');
  };
  return { open: open, refresh: refresh, removeContact: removeContact, toggleContact: toggleContact };
})();
