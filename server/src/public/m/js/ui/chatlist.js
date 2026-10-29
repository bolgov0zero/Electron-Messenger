// /m — вкладка «Чаты» по макету: большой заголовок, поиск, чипы пространства и папок, список карточками, меню по долгому нажатию.
// Данные и действия — B.chats (core/chats.js).
B.ui = B.ui || {};
B.ui.chatlist = (function () {
  var v, scroller, dyn, bar, input;
  var q = '', results = null, searchT = 0, renderT = 0;

  function tagInk(t) {   // цвет тега человека: тот же хэш, что в веб клиенте, пять оттенков из токенов
    t = (t || '').trim().toLowerCase(); if (!t) return '';
    var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 'color:rgb(var(--tag-' + (h % 5 + 1) + '))';
  }
  B.tagInk = tagInk;

  function tick(lm) {
    if (!lm.status || !lm.status.total) return '';
    var all = lm.status.read >= lm.status.total;
    var part = !all && lm.status.read > 0;   // прочитали не все: первая галочка синяя
    return '<span class="st' + (all ? ' rd' : part ? ' part' : '') + '">' + I(all || part || lm.status.delivered ? 'checks' : 'check') + '</span>';
  }
  function chatRow(c, pin) {
    var lm = c.last_message, mine = lm && lm.sender_id === B.S.user.id, u = c.unread || 0, men = c.unread_mentions || 0, ty = B.typing.names(c.id), dm = c.type === 'direct';
    var pv;
    if (ty.length) pv = '<i>' + B.esc(B.typing.label(ty, true)) + '</i>';
    else if (c.invite) pv = '<i>Приглашение в ' + B.msgs.fedKind(c) + '</i>';
    else if (c.is_secret) pv = '<i>Скрытый чат</i>';
    else pv = (!dm && lm && !mine && !lm.deleted && lm.sender_name ? '<i>' + B.esc(String(lm.sender_name).split(' ')[0]) + ': </i>' : '') + B.esc(((mine ? 'Вы: ' : '') + B.chats.preview(c)).slice(0, 220));
    var bd = men ? '<span class="bd at' + (c.muted ? ' mute' : '') + '">@</span>' : u ? '<span class="bd' + (c.muted ? ' mute' : '') + '">' + (u > 99 ? '99+' : u) + '</span>' : '';
    return '<button class="row' + (pin ? ' pinned' : '') + '" data-id="' + c.id + '">' + B.avatar.chat(c) + '<div class="rt"><div class="r1"><b>' + (c.is_secret ? I('lock') + ' ' : '') + B.esc(B.chatName(c)) + '</b>' + (mine && lm ? tick(lm) : '') +
      '<span class="tm' + (u && !c.muted ? ' new' : '') + '">' + (lm ? B.fmt.chatListTime(lm.sent_at) : '') + '</span></div>' +
      '<div class="r2"><span class="pv">' + pv + '</span>' + (c.muted ? '<span class="st">' + I('bellOff') + '</span>' : '') + (c.pinned && !u && !men ? '<span class="st">' + I('pin') + '</span>' : '') + bd + '</div></div></button>';
  }
  function msgRow(r) {
    var c = B.find(r.chat_id), title = c ? B.chatName(c) : (r.sender_name || '');
    var snip = B.esc(r.snippet || '').replace(/\x01/g, '<mark>').replace(/\x02/g, '</mark>');
    return '<button class="row" data-id="' + r.chat_id + '" data-msg="' + r.id + '">' + B.avatar.user(r.sender_id || 0, r.sender_name || '?', 0, true) + '<div class="rt"><div class="r1"><b>' + B.esc(title) + '</b><span class="tm">' + B.fmt.chatListTime(r.sent_at) + '</span></div>' +
      '<div class="r2"><span class="pv"><i>' + B.esc(r.sender_name || '') + ': </i>' + snip + '</span></div></div></button>';
  }
  function listHtml() {
    var g = B.chats.groups(q), h = '';
    var rows = g.pinned.concat(g.rest);
    h += g.rooms.length ? '<div class="gl">Комнаты</div><div class="grp glass">' + g.rooms.map(function (c) { return chatRow(c); }).join('') + '</div>' : '';
    h += rows.length ? '<div class="gl">' + (q ? 'Чаты' : B.folders.label()) + '</div><div class="grp glass">' + g.pinned.map(function (c) { return chatRow(c, 1); }).join('') + g.rest.map(function (c) { return chatRow(c); }).join('') + '</div>' : '';
    if (q && results && results.length) h += '<div class="gl">Сообщения</div><div class="grp glass">' + results.map(msgRow).join('') + '</div>';
    if (!g.rooms.length && !rows.length && !(results && results.length)) {
      h += '<div class="empty"><span class="ei glass">' + I('search') + '</span><b>' + (B.S.chats.length ? 'Ничего не найдено' : 'Чатов пока нет') + '</b><span>' + (B.S.chats.length ? 'Измените запрос или папку' : 'Начните разговор кнопкой в углу') + '</span></div>';
    }
    return h;
  }
  // Пока пользователь листает/печатает, шапка (чипы, баннеры) собирается отдельно от списка
  function barHtml() {
    var h = '';
    if (B.conn && B.conn.state === 'offline') h += '<div class="nbanner glass">' + I('bellOff') + '<span><b>Нет связи с сервером.</b> Показаны сохранённые чаты.</span></div>';
    if (B.push.shouldAsk() && !q) h += '<div class="nbanner glass">' + I('bell') + '<span>Разрешите уведомления, чтобы получать сообщения в фоне. <b data-act="allow">Разрешить</b></span><button class="ibtn" data-act="hidepush" aria-label="Закрыть">' + I('x') + '</button></div>';
    if (B.spaces.shown() && !q) h += '<div class="chips"><button class="chip on" data-act="space">' + I('grid') + B.esc(B.spaces.label()) + I('chevDown') + '</button></div>';
    if (!q) h += B.ui.folders.barHtml();
    return h;
  }
  function render() {
    if (!dyn) return;
    var tl = bar.querySelector('.fin'), l = tl ? tl.scrollLeft : 0, pt = B.ui.folders.thumbOf(bar);
    bar.innerHTML = barHtml(); dyn.innerHTML = listHtml();
    B.avatar.apply(dyn); badge();
    var fo = bar.querySelector('.fin'); if (fo) { fo.scrollLeft = l; B.ui.folders.settle(bar, pt); B.ui.folders.watchEdges(bar); }
    var fb = bar.querySelector('.fbar'); if (fb) stuck();
  }
  function schedule() { if (renderT) return; renderT = setTimeout(function () { renderT = 0; render(); }, 30); }
  // Панель папок липнет под бейджем раздела
  function stuck() {
    var fb = bar.querySelector('.fbar'); if (!fb) return;
    var pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    fb.classList.toggle('stuck', rel(fb).y - rel(scroller).y <= pad + 51);
  }
  function badge() {
    var b = $('#chbd'); if (!b) return;
    var n = B.S.chats.filter(function (c) { return !c.parent_id && !c.muted; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    b.textContent = n > 99 ? '99+' : n; b.style.display = n ? '' : 'none';
  }

  // Меню чата: размытый фон, строка поднята, меню рядом
  function chatMenu(row) {
    var c = B.find(+row.dataset.id); if (!c || row.dataset.msg) return;
    var canDel = c.type !== 'room' || !!c.fed_mirror;
    var items = [
      { l: c.pinned ? 'Открепить' : 'Закрепить', i: 'pin', f: function () { B.chats.pin(c.id); } },
      { l: c.muted ? 'Включить звук' : 'Без звука', i: c.muted ? 'bell' : 'bellOff', f: function () { B.chats.mute(c.id); } },
      { l: 'В папку…', i: 'folder', f: function () { if (B.folders.list.length) B.ui.folders.chatSheet(c.id); else B.ui.folders.editor(null, { chatId: c.id }); } }
    ];
    if (canDel) {
      items.push({ sp: 1 });
      items.push({ l: 'Удалить', i: 'trash', d: 1, f: function () { askDelete(c); } });
    }
    try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
    B.menu.open(row, items);
  }
  function askDelete(c) {
    if (c.type === 'room' && !c.fed_mirror) { B.toast.show('Комнатами управляют администраторы', 'info'); return; }
    B.actions.confirm('Удалить чат?', c.is_secret ? '' : 'Переписка исчезнет из списка.', 'Удалить', async function () {
      if (c.is_secret) { await B.secret.remove(c.id); return; }
      if (!(await B.chats.leave(c.id))) B.toast.show('Не удалось удалить', 'x');
      else B.toast.show('Чат удалён', 'trash');
    });
  }
  function spaceSheet() {
    var SP = B.spaces, item = function (id, name, sub, on, n) {
      return '<button class="cell" data-sp="' + id + '"><span class="cl">' + B.esc(name) + (sub ? '<br><small style="color:var(--text2);font-weight:400">' + B.esc(sub) + '</small>' : '') + '</span>' + (n ? '<span class="bd">' + (n > 99 ? '99+' : n) + '</span>' : '') + (on ? '<span class="ch" style="color:var(--accent-ink)">' + I('check') + '</span>' : '') + '</button>';
    };
    var S = B.sheet.open({ title: 'Пространство', sub: 'Останутся люди и чаты из выбранного пространства', body: '<div class="grp glass">' + item('all', 'Общий вид', 'Все чаты и контакты', SP.filter === 'all', SP.unread('all')) +
      SP.list.map(function (s) { return item(s.id, s.name, s.shared ? 'Общее · ' + s.servers + ' серв.' : s.people + ' чел.', SP.filter === s.id, SP.unread(s.id)); }).join('') + '</div>' });
    S.el.addEventListener('click', function (e) { var b = e.target.closest('[data-sp]'); if (!b) return; SP.select(b.dataset.sp === 'all' ? 'all' : +b.dataset.sp); B.sheet.close(); });
  }

  function onInput() {
    q = input.value.trim().toLowerCase(); results = null; clearTimeout(searchT);
    dyn.innerHTML = listHtml(); bar.innerHTML = barHtml(); B.avatar.apply(dyn);
    if (q.length < 2) return;
    var t = input.value.trim();
    searchT = setTimeout(async function () {
      var r = await B.chats.searchMessages(t); if (input.value.trim() !== t) return;
      results = r; dyn.innerHTML = listHtml(); B.avatar.apply(dyn);
    }, 300);
  }

  function mount(el) {
    v = el;
    v.innerHTML = '<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Чаты</span></div><div class="nr"><button class="nb glass gi" data-act="compose" aria-label="Новый чат">' + I('edit') + '</button></div></div>' +
      '<div class="scroll"><h1 class="lt">Чаты</h1><label class="srch glass">' + I('search') + '<input id="cq" placeholder="Поиск" autocomplete="off" autocapitalize="none" enterkeyhint="search"></label><div id="cbar"></div><div id="clist"></div></div>';
    scroller = $('.scroll', v); dyn = $('#clist', v); bar = $('#cbar', v); input = $('#cq', v);
    B.nav.watch(v); scroller.addEventListener('scroll', stuck, { passive: true });
    input.addEventListener('input', onInput); input.addEventListener('focus', function () { showKb(); }); input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    v.addEventListener('click', function (e) {
      var fo = e.target.closest('[data-fo]');
      if (fo) { B.ui.folders.center = true; B.folders.select(fo.dataset.fo === 'all' ? 'all' : +fo.dataset.fo); return; }
      var a = e.target.closest('[data-act]');
      if (a) {
        var k = a.dataset.act;
        if (k === 'compose') B.ui.groups.newChat(); else if (k === 'space') spaceSheet();
        else if (k === 'allow') B.push.request().then(render); else if (k === 'hidepush') { B.push.dismissAsk(); render(); }
        return;
      }
      var r = e.target.closest('.row'); if (r) { hideKb(); B.openChat(+r.dataset.id, r.dataset.msg ? +r.dataset.msg : undefined); }
    });
    longPress(v, '.row', chatMenu);
    render();
  }
  ['chats:changed', 'folders:changed', 'spaces:changed', 'presence:changed', 'typing:changed', 'conn:changed'].forEach(function (ev) { B.bus.on(ev, schedule); });
  B.bus.on('avatar:updated', function () { B.avatar.clearCache(); schedule(); });
  B.bus.on('app:ready', function () { if (dyn) render(); });
  B.bus.on('auth:logout', function () { if (dyn) { dyn.innerHTML = ''; bar.innerHTML = ''; } });
  return { mount: mount, render: render };
})();
