// /m — вкладка «Контакты» по макету: люди из своего пространства и добавленные контакты (в том числе с других серверов),
// сгруппированные по статусу, поиск, «Добавить контакт». Нажатие на строку открывает профиль, долгое — меню.
B.ui = B.ui || {};
B.ui.contacts = (function () {
  var v, dyn, input, q = '';
  function rank(u) { var r = { online: 0, away: 1 }[B.S.presence[u.id]]; return r === undefined ? 2 : r; }
  // Пространство человека: общее с вашими (если у вас их несколько), чужое пространство; у людей с других серверов — значок глобуса на аватаре
  function wsText(u) {
    if (u.federated) return '';
    var my = (B.S.user && B.S.user.workspaces && B.S.user.workspaces.length) || 1;
    if (u.rel === 'ws') { var n = u.shared_workspaces || []; if (my > 1 && n.length) { var full = n.join(' · '); return n.length === 1 ? n[0] : full.length <= 22 ? full : n[0] + ' +' + (n.length - 1); } return ''; }
    return (u.rel === 'other' || u.rel === 'chat') && u.workspace_name ? u.workspace_name : '';
  }
  function row(u) {
    var on = B.S.presence[u.id] === 'online', sub = u.federated ? B.contacts.fedAddr(u) : B.contacts.peerSub(u.id);
    return '<button class="row" data-k="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 0, false, u.federated) + '<div class="rt"><div class="r1"><b>' + B.esc(u.display_name) + '</b>' + (u.tag ? '<span class="pill-tag" style="' + B.tagInk(u.tag) + '">' + B.esc(u.tag) + '</span>' : '') + '</div>' +
      '<div class="r2"><span class="pv" style="' + (on ? 'color:var(--accent-ink)' : '') + '">' + B.esc(sub) + '</span>' + (wsText(u) ? '<span class="pill-tag wst">' + B.esc(wsText(u)) + '</span>' : '') + '</div></div></button>';
  }
  function render() {
    if (!dyn) return;
    var s = q.trim().toLowerCase(), all = B.S.contacts;
    var list = all.filter(function (u) { return B.spaces.userPass(u) && (!s || u.display_name.toLowerCase().indexOf(s) >= 0 || (u.username || '').toLowerCase().indexOf(s) >= 0); });
    list.sort(function (a, b) { return rank(a) - rank(b) || a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }); });
    if (!list.length) {
      dyn.innerHTML = '<div class="empty"><span class="ei glass">' + I('users') + '</span><b>' + (all.length ? 'Никого не нашли' : 'Контактов пока нет') + '</b>' + (all.length ? '' : '<span>Человека из другого пространства можно добавить по логину.</span>') + '</div>';
      return;
    }
    var on = list.filter(function (u) { return rank(u) < 2; }), off = list.filter(function (u) { return rank(u) === 2; });
    dyn.innerHTML = (on.length ? '<div class="gl">В сети · ' + on.length + '</div><div class="grp glass">' + on.map(row).join('') + '</div>' : '') + (off.length ? '<div class="gl">Не в сети · ' + off.length + '</div><div class="grp glass">' + off.map(row).join('') + '</div>' : '');
    B.avatar.apply(dyn);
  }
  function menu(row) {
    var u = B.contacts.byId(+row.dataset.k); if (!u) return;
    var items = [{ l: 'Профиль', i: 'user', f: function () { B.openProfile(u.id); } }, { l: 'Написать', i: 'chat', f: function () { write(u.id); } }];
    if (u.contact) { items.push({ sp: 1 }); items.push({ l: 'Удалить из контактов', i: 'userMinus', d: 1, f: function () { B.ui.profile.removeContact(u.id); } }); }
    B.menu.open(row, items);
  }
  async function write(id) { var chat = await B.contacts.openDirect(id); if (chat) B.openChat(chat.id); else B.toast.show('Не удалось открыть чат', 'x'); }
  function mount(el) {
    v = el;
    v.innerHTML = '<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Контакты</span></div><div class="nr"><button class="nb glass gi" data-act="add" aria-label="Добавить контакт">' + I('userPlus') + '</button></div></div>' +
      '<div class="scroll"><h1 class="lt">Контакты</h1><label class="srch glass">' + I('search') + '<input id="kq" placeholder="Поиск контактов" autocomplete="off" autocapitalize="none"></label><div id="klist"></div></div>';
    dyn = $('#klist', v); input = $('#kq', v); B.nav.watch(v);
    input.addEventListener('input', function () { q = input.value; render(); });
    input.addEventListener('focus', function () { showKb(); }); input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    v.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="add"]')) { B.ui.groups.addContact(); return; }
      var r = e.target.closest('.row'); if (r) { hideKb(); B.openProfile(+r.dataset.k); }
    });
    longPress(v, '.row', menu);
    render();
  }
  ['contacts:changed', 'spaces:changed', 'presence:changed', 'avatar:updated', 'app:ready'].forEach(function (ev) { B.bus.on(ev, render); });
  return { mount: mount, render: render };
})();
