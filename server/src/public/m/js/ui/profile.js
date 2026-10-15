// /m — профиль человека: имя, статус, «Написать», «В контакты», «Заблокировать», общие группы.
// Открывается нажатием на аватарку или имя в личном чате, на аватарку в контактах и пунктом «Профиль».
B.ui = B.ui || {};
B.ui.profile = (function () {
  var esc = B.esc, ic = B.ic;
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
    var rows = [fed ? ['Адрес', B.contacts.fedAddr(u)] : ['Логин', '@' + u.username]];
    if (fed) rows.push(['Сервер', 'Другой сервер']);
    else if (other) rows.push(['Пространство', u.workspace_name]);
    else if (u.rel === 'ws' && my > 1 && u.shared_workspaces && u.shared_workspaces.length) rows.push([u.shared_workspaces.length > 1 ? 'Пространства' : 'Пространство', u.shared_workspaces.join(' · ')]);
    if (canContact) rows.push(['В ваших контактах', u.contact ? 'Да' : 'Нет']);
    var groups = B.S.chats.filter(function (c) { return (c.type === 'group' || c.type === 'room') && !c.parent_id && !c.is_secret && (c.members || []).some(function (m) { return m.id === id; }); });
    var h = '<div class="big">' + B.avatar.user(id, u.display_name, 96) + '<h2>' + esc(u.display_name) + (u.tag ? '<span class="ct-tag">' + esc(u.tag) + '</span>' : '') + '</h2><p class="' + (on ? 'on' : '') + '">' + esc(st) + '</p></div>' +
      '<div class="acts"><button data-p="write">' + ic('chats', 24, 1.8) + 'Написать</button>' +
      (canContact ? '<button data-p="contact">' + ic(u.contact ? 'userplus' : 'userplus', 24, 1.8) + (u.contact ? 'Из контактов' : 'В контакты') + '</button>' : '') +
      '<button class="' + (blocked ? '' : 'red') + '" data-p="block">' + ic('block', 24, 1.8) + (blocked ? 'Разблокировать' : 'Заблокировать') + '</button></div>';
    if (blocked) h += '<div class="note">Вы заблокировали этого человека: он не может писать вам в личные сообщения. Общие группы и комнаты остаются.</div>';
    h += '<div class="grp">' + rows.map(function (r) { return '<div class="cell"><span class="cl">' + r[0] + '</span><span class="cv l">' + esc(r[1]) + '</span></div>'; }).join('') + '</div>';
    h += '<div class="gh">Общие группы · ' + groups.length + '</div><div class="grp">' + (groups.length
      ? groups.map(function (c) { return '<button class="crow2" data-p="chat" data-id="' + c.id + '">' + B.avatar.chat(c, 40) + '<div class="t"><b>' + esc(B.chatName(c)) + '</b><span>' + (c.type === 'room' ? 'Комната' : 'Группа') + ' · ' + (c.members || []).length + ' участн.</span></div></button>'; }).join('')
      : '<div class="cell"><span class="cl" style="color:var(--fg2)">Общих групп и комнат нет</span></div>') + '</div>';
    return h;
  }
  function open(id) {
    if (!id || id === B.S.user.id) return;
    var top = B.nav.top(); if (top && top.el.dataset.uid == id) return;
    var el = B.nav.page({ title: '', gray: true, body: html(id) }); el.dataset.uid = id;
    el.addEventListener('click', function (e) { act(id, e); });
    B.nav.push(el, ''); B.avatar.apply(el);
  }
  function refresh() {
    B.nav.stack.forEach(function (s) {
      var id = s.el.dataset.uid; if (!id) return;
      var sc = s.el.querySelector('.scroll'), y = sc.scrollTop; sc.innerHTML = html(+id); sc.scrollTop = y; B.avatar.apply(sc);
    });
  }
  async function toggleContact(id) {
    var u = user(id); if (!u) return;
    if (u.contact) { await B.api('DELETE', '/contacts/' + id); B.toast.show('Удалён из контактов'); }
    else {
      var r = await B.api('POST', '/contacts', { username: u.username });
      if (!(r && (r.ok || r.code === 'already'))) { B.toast.show((r && r.error) || 'Не удалось добавить контакт'); return; }
      B.toast.show(u.display_name + ' добавлен в контакты');
    }
    await B.contacts.load(); refresh();
  }
  function block(id) {
    var u = user(id); if (!u) return;
    if (B.contacts.isBlocked(id)) { B.api('DELETE', '/blocks/' + id).then(function () { return B.contacts.loadBlocks(); }).then(function () { B.toast.show('Разблокирован'); refresh(); }); return; }
    B.actions.confirm('Заблокировать «' + u.display_name + '»?', 'Он не сможет писать вам в личные сообщения. Общие группы и комнаты останутся. Разблокировать можно в настройках.', 'Заблокировать', async function () {
      var r = await B.api('POST', '/blocks', { user_id: id });
      if (!(r && r.ok)) B.toast.show((r && r.error) || 'Не удалось заблокировать'); else { await B.contacts.loadBlocks(); B.toast.show('Заблокирован'); }
      refresh();
    });
  }
  async function write(id) {
    var chat = await B.contacts.openDirect(id); if (!chat) { B.toast.show('Не удалось открыть чат'); return; }
    var under = B.nav.stack[B.nav.stack.length - 2];
    if (under && under.el.dataset.cid == chat.id) B.nav.pop(); else B.openChat(chat.id);
  }
  function act(id, e) {
    var b = e.target.closest('[data-p]'); if (!b) return; var p = b.dataset.p;
    if (p === 'write') write(id); else if (p === 'contact') toggleContact(id); else if (p === 'block') block(id);
    else if (p === 'chat') B.openChat(+b.dataset.id);
  }
  function removeContact(id) {
    var u = user(id); if (!u) return;
    B.actions.confirm('Удалить «' + u.display_name + '» из контактов?', '', 'Удалить', async function () { await B.api('DELETE', '/contacts/' + id); B.toast.show('Удалён из контактов'); B.contacts.load(); });
  }
  B.bus.on('contacts:changed', refresh); B.bus.on('blocks:changed', refresh); B.bus.on('presence:changed', refresh);
  B.openProfile = open;
  // «Добавить в контакты» из шапки переписки
  B.openAddFromChat = async function (id) {
    var u = user(id); if (!u || !u.username) return;
    var r = await B.api('POST', '/contacts', { username: u.username });
    if (r && (r.ok || r.code === 'already')) { B.toast.show(u.display_name + ' добавлен в контакты'); B.contacts.load(); } else B.toast.show((r && r.error) || 'Не удалось добавить контакт');
  };
  return { open: open, refresh: refresh, removeContact: removeContact, toggleContact: toggleContact };
})();
