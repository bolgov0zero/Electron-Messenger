// /m — вкладка «Контакты»: люди из своего пространства, добавленные контакты (в том числе с других серверов), поиск,
// «Добавить контакт». Нажатие на строку открывает личный чат, на аватарку — профиль, «⋯» — меню контакта.
B.ui = B.ui || {};
B.ui.contacts = (function () {
  var esc = B.esc, ic = B.ic, dyn, input, xbtn, q = '';
  var GROUPS = [[0, 'Онлайн'], [1, 'Отошёл'], [2, 'Не в сети']];

  function rank(u) { var r = { online: 0, away: 1 }[B.S.presence[u.id]]; return r === undefined ? 2 : r; }
  function row(u) {
    var sub = u.federated ? B.contacts.fedAddr(u) : '@' + (u.username || '');
    return '<button class="crow2" data-c="chat" data-id="' + u.id + '"><span class="pwrap" data-c="prof" data-id="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 44) + '</span>' +
      '<div class="t"><b>' + esc(u.display_name) + (u.tag ? '<span class="ct-tag">' + esc(u.tag) + '</span>' : '') + '</b><span class="sub"><i>' + esc(sub) + '</i>' + B.contacts.wsTag(u) + '</span></div>' +
      '<span class="more" data-c="more" data-id="' + u.id + '" role="button" aria-label="Действия">' + ic('more', 22, 1.8) + '</span></button>';
  }
  function render() {
    if (!dyn) return;
    var s = q.trim().toLowerCase(), all = B.S.contacts, list = all.filter(function (u) { return !s || u.display_name.toLowerCase().indexOf(s) >= 0; });
    var byName = function (a, b) { return a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }); };
    list.sort(function (a, b) { return rank(a) - rank(b) || byName(a, b); });
    if (!list.length) {
      dyn.innerHTML = all.length ? '<div class="empty"><b>Никого не нашли</b>Проверьте написание имени.</div>'
        : '<div class="empty"><b>Контактов пока нет</b>В вашем пространстве больше никого нет. Человека из другого пространства можно добавить по логину.<br><button class="link" data-c="add">Добавить контакт</button></div>';
      return;
    }
    dyn.innerHTML = '<div class="plist">' + GROUPS.map(function (g) {
      var items = list.filter(function (u) { return rank(u) === g[0]; });
      return items.length ? '<div class="hdr-s">' + g[1] + '</div>' + items.map(row).join('') : '';
    }).join('') + '</div>';
    B.avatar.apply(dyn);
  }
  function openMenu(id) {
    var u = B.contacts.byId(id); if (!u) return;
    var items = [{ l: 'Профиль', f: function () { B.openProfile(id); } }];
    if (u.contact) items.push({ l: 'Удалить из контактов', d: 1, f: function () { B.ui.profile.removeContact(id); } });
    B.actions.show({ title: u.display_name, items: items });
  }
  function mount(scrollEl) {
    scrollEl.innerHTML = '<div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input type="search" placeholder="Поиск" autocomplete="off" autocapitalize="none"><button class="x" data-c="clear" aria-label="Очистить">' + ic('x', 14, 2.6) + '</button></div></div><div data-dyn="contacts"></div>';
    dyn = scrollEl.querySelector('[data-dyn]'); input = scrollEl.querySelector('input'); xbtn = scrollEl.querySelector('.x');
    input.addEventListener('input', function () { q = input.value; xbtn.classList.toggle('on', !!q); render(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    scrollEl.addEventListener('click', async function (e) {
      var t = e.target.closest('[data-c]'); if (!t) return; var c = t.dataset.c, id = +t.dataset.id;
      if (c === 'clear') { input.value = ''; q = ''; xbtn.classList.remove('on'); render(); }
      else if (c === 'add') B.ui.groups.addContact();
      else if (c === 'more') { e.stopPropagation(); openMenu(id); }
      else if (c === 'prof') { e.stopPropagation(); B.openProfile(id); }
      else if (c === 'chat') { var chat = await B.contacts.openDirect(id); if (chat) B.openChat(chat.id); else B.toast.show('Не удалось открыть чат'); }
    });
    render();
  }
  B.bus.on('contacts:changed', render); B.bus.on('presence:changed', function () { render(); });
  B.bus.on('avatar:updated', render); B.bus.on('app:ready', render);
  return { mount: mount, render: render };
})();
