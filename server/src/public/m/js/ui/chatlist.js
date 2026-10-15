// /m — вкладка «Чаты»: поиск, список со свайп-действиями, приглашение включить уведомления.
// Данные и действия — в B.chats (core/chats.js); здесь только вид и жесты.
B.ui = B.ui || {};
B.ui.chatlist = (function () {
  var esc = B.esc, ic = B.ic;
  var tabview, dyn, input, xbtn, scroller;
  var q = '', searching = false, results = null, searchTimer = null, renderTimer = null;
  var typing = {}, busy = false, dirty = false, G = null, suppressUntil = 0;

  // ── разметка ──
  function rowHtml(c) {
    var lm = c.last_message, S = B.S, mine = lm && lm.sender_id === S.user.id, u = c.unread || 0, men = c.unread_mentions || 0, ty = typing[c.id];
    var pv = ty ? '<span class="typ">' + esc(ty) + ' печатает…</span>' : c.is_secret ? '<span class="sct">Скрытый чат</span>' : esc(((mine ? 'Вы: ' : '') + B.chats.preview(c)).slice(0, 220));
    var badge = men ? '<div class="rbd">@</div>' : u ? '<div class="rbd' + (c.muted ? ' m' : '') + '">' + (u > 99 ? '99+' : u) + '</div>' : c.pinned ? '<span class="rpin">' + ic('pin', 16, 2) + '</span>' : '';
    var canDel = c.type !== 'room';
    return '<div class="swrow' + (c.pinned ? ' pinned' : '') + '" data-id="' + c.id + '">' +
      '<div class="swa lead"><button class="pin" data-sw="pin">' + ic(c.pinned ? 'unpin' : 'pin', 22, 2) + (c.pinned ? 'Открепить' : 'Закрепить') + '</button></div>' +
      '<div class="swa trail"><button class="mute" data-sw="mute">' + ic(c.muted ? 'bell' : 'bellOff', 22, 2) + (c.muted ? 'Звук' : 'Без звука') + '</button>' +
        (canDel ? '<button class="del" data-sw="del">' + ic('trash', 22, 2) + 'Удалить</button>' : '') + '</div>' +
      '<div class="swf" data-open="' + c.id + '"><div class="row">' + B.avatar.chat(c, 54) +
        '<div class="rb"><div class="r1"><span class="rn">' + (c.is_secret ? '<span class="lk">' + ic('lock', 14, 2.2) + '</span>' : '') + '<span class="nm">' + esc(B.chatName(c)) + '</span>' + (c.muted ? '<span class="mu">' + ic('bellOff', 13, 2) + '</span>' : '') + '</span>' +
          '<span class="rt">' + (mine && lm.status ? B.ticks(lm.status) : '') + (lm ? B.fmt.chatListTime(lm.sent_at) : '') + (c.has_topics ? '<span class="chv">' + ic('chev', 14, 2.4) + '</span>' : '') + '</span></div>' +
        '<div class="r2"><div class="rm">' + pv + '</div>' + badge + '</div></div></div></div></div>';
  }
  function messageRow(r) {
    var c = B.find(r.chat_id), title = c ? B.chatName(c) : (r.sender_name || '');
    var snip = esc(r.snippet || '').replace(/\x01/g, '<mark>').replace(/\x02/g, '</mark>');
    return '<div class="swrow" data-id="' + r.chat_id + '"><div class="swf" data-open="' + r.chat_id + '" data-msg="' + r.id + '"><div class="row">' + B.avatar.user(r.sender_id || 0, r.sender_name || '?', 54) +
      '<div class="rb"><div class="r1"><span class="rn"><span class="nm">' + esc(title) + '</span></span><span class="rt">' + B.fmt.chatListTime(r.sent_at) + '</span></div>' +
      '<div class="r2"><div class="rm"><b>' + esc(r.sender_name || '') + ':</b> ' + snip + '</div></div></div></div></div></div>';
  }
  function html() {
    var ql = q.trim().toLowerCase(), g;
    if (searching && ql) {
      g = B.chats.groups(ql);
      var chats = g.rooms.concat(g.pinned, g.rest), out = '';
      if (chats.length) out += '<div class="hdr-s">Чаты</div>' + chats.map(rowHtml).join('');
      if (results && results.length) out += '<div class="hdr-s">Сообщения</div>' + results.map(messageRow).join('');
      return out || '<div class="empty"><b>Ничего не найдено</b>Попробуйте другое слово.</div>';
    }
    var h = '';
    if (!searching && B.push.shouldAsk()) h += '<div class="nbanner">' + ic('bell', 20, 2) + '<span>Разрешите уведомления, чтобы получать сообщения в фоне. <b data-cl="allow">Разрешить</b></span><button class="xx" data-cl="hide" aria-label="Закрыть">' + ic('x', 16, 2.4) + '</button></div>';
    g = B.chats.groups('');
    if (!g.total) return h + '<div class="empty"><b>' + (B.S.chats.length ? 'Ничего не найдено' : 'Чатов пока нет') + '</b>' + (B.S.chats.length ? '' : 'Начните разговор кнопкой в углу экрана.') + '</div>';
    return h + g.rooms.concat(g.pinned, g.rest).map(rowHtml).join('');
  }
  function render() {
    if (!dyn) return;
    if (busy) { dirty = true; return; }
    dirty = false; dyn.innerHTML = html(); B.avatar.apply(dyn); updateBadge();
  }
  function schedule() { if (renderTimer) return; renderTimer = setTimeout(function () { renderTimer = null; render(); }, 30); }
  function updateBadge() {
    var b = document.querySelector('.tb[data-tab="chats"] .bd'); if (!b) return;
    var n = B.S.chats.filter(function (c) { return !c.parent_id && !c.muted; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
  }

  // ── поиск ──
  function startSearch() { if (searching) return; searching = true; tabview.classList.add('searching'); scroller.scrollTop = 0; render(); }
  function cancel() {
    searching = false; q = ''; results = null; clearTimeout(searchTimer);
    tabview.classList.remove('searching'); input.value = ''; input.blur(); xbtn.classList.remove('on'); render();
  }
  function onInput() {
    q = input.value; xbtn.classList.toggle('on', !!q); results = null; render();
    clearTimeout(searchTimer);
    var t = q.trim();
    if (t.length < 2) return;
    searchTimer = setTimeout(async function () {
      var r = await B.chats.searchMessages(t);
      if (q.trim() !== t) return;            // запрос устарел
      results = r; render();
    }, 300);
  }

  // ── действия ──
  function closeRows(except) { dyn.querySelectorAll('.swf').forEach(function (f) { if (f !== except && f._tx) { f._tx = 0; f.style.transform = ''; } }); }
  function togglePin(id) { closeRows(); B.chats.pin(id); }
  function toggleMute(id) { closeRows(); B.chats.mute(id); }
  function askDelete(id) {
    closeRows(); var c = B.find(id); if (!c) return;
    if (c.type === 'room') { B.toast.show('Комнатами управляют администраторы'); return; }
    var del = { l: 'Удалить', d: 1, f: async function () { if (c.is_secret) { await B.secret.remove(id); return; } if (!(await B.chats.leave(id))) B.toast.show('Не удалось удалить'); } };
    B.actions.show({ title: 'Удалить чат «' + B.chatName(c) + '»?', msg: c.is_secret ? '' : 'Переписка исчезнет из списка.', items: (c.is_secret && B.ui.groups ? [{ l: 'Устройства чата', f: function () { B.ui.groups.devices(id); } }] : []).concat([del]) });
  }
  function open(id, msgId) { if (searching) cancel(); closeRows(); B.openChat(id, msgId); }

  // ── жесты строки: влево — «Без звука» и «Удалить», вправо — «Закрепить» ──
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var f = e.target.closest('.swf'); if (!f || !f.parentElement.querySelector(':scope > .swa')) { G = null; return; }
    G = { id: e.pointerId, x: e.clientX, y: e.clientY, f: f, base: f._tx || 0, mode: null, tx: f._tx || 0 };
  }
  function onMove(e) {
    if (!G || e.pointerId !== G.id) return;
    var dx = e.clientX - G.x, dy = e.clientY - G.y;
    if (!G.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) { G = null; return; }
      G.mode = 'row'; busy = true; closeRows(G.f); G.f.classList.add('drag');
      try { dyn.setPointerCapture(e.pointerId); } catch (_) {}
    }
    var tx = G.base + dx; if (tx < -300) tx = -300 + (tx + 300) * .2; if (tx > 170) tx = 170 + (tx - 170) * .2;
    G.tx = tx; G.f.style.transform = 'translateX(' + tx + 'px)';
  }
  function onUp(e, cancelled) {
    if (!G || e.pointerId !== G.id) return;
    var g = G; G = null; if (g.mode !== 'row') return;
    suppressUntil = performance.now() + 350; busy = false;
    var f = g.f, tx = g.tx, row = f.closest('.swrow'), id = +row.dataset.id, w = row.querySelector('.swa.trail').offsetWidth, to = 0, c = B.find(id);
    f.classList.remove('drag');
    if (!cancelled) {
      if (tx < -(w + 110) && c && c.type !== 'room') { askDelete(id); }
      else if (tx < -w * 0.5) to = -w;
      else if (tx > 130) { togglePin(id); }
      else if (tx > 40) to = 74;
    }
    f._tx = to; f.style.transform = to ? 'translateX(' + to + 'px)' : '';
    if (dirty) render();
  }

  function mount(scrollEl) {
    scroller = scrollEl; tabview = scrollEl.closest('.tabview');
    scrollEl.innerHTML =
      '<div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="q-chats" type="search" placeholder="Поиск" autocomplete="off" autocapitalize="none" enterkeyhint="search"><button class="x" data-cl="clear" aria-label="Очистить">' + ic('x', 14, 2.6) + '</button></div><button class="scancel" data-cl="cancel">Отмена</button></div>' +
      '<div data-dyn="chats"></div>';
    dyn = scrollEl.querySelector('[data-dyn]'); input = scrollEl.querySelector('#q-chats'); xbtn = scrollEl.querySelector('.sfield .x');
    input.addEventListener('focus', startSearch); input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    scrollEl.addEventListener('click', function (e) {
      var cl = e.target.closest('[data-cl]');
      if (cl) {
        var a = cl.dataset.cl;
        if (a === 'cancel') cancel();
        if (a === 'clear') { input.value = ''; onInput(); input.focus(); }
        if (a === 'allow') B.push.request().then(render);
        if (a === 'hide') { B.push.dismissAsk(); render(); }
        return;
      }
      if (performance.now() < suppressUntil) return;
      var sw = e.target.closest('[data-sw]');
      if (sw) { var id = +sw.closest('.swrow').dataset.id; ({ pin: togglePin, mute: toggleMute, del: askDelete })[sw.dataset.sw](id); return; }
      var f = e.target.closest('.swf');
      if (f) { if (f._tx) { closeRows(); return; } open(+f.dataset.open, f.dataset.msg ? +f.dataset.msg : undefined); }
    });
    dyn.addEventListener('pointerdown', onDown); dyn.addEventListener('pointermove', onMove);
    dyn.addEventListener('pointerup', function (e) { onUp(e, false); }); dyn.addEventListener('pointercancel', function (e) { onUp(e, true); });
    scrollEl.addEventListener('scroll', function () { closeRows(); }, { passive: true });
    render();
  }

  B.bus.on('chats:changed', schedule);
  B.bus.on('presence:changed', schedule);
  B.bus.on('avatar:updated', function () { B.avatar.clearCache(); schedule(); });
  B.bus.on('app:ready', function () { if (dyn) render(); });
  B.bus.on('auth:logout', function () { typing = {}; if (dyn) { if (searching) cancel(); dyn.innerHTML = ''; } });
  B.bus.on('typing', function (d) {
    clearTimeout((typing[d.chatId + 't']) || 0);
    typing[d.chatId] = d.senderName || 'Кто-то';
    typing[d.chatId + 't'] = setTimeout(function () { delete typing[d.chatId]; delete typing[d.chatId + 't']; schedule(); }, 5000);
    schedule();
  });
  return { mount: mount, render: render, cancel: cancel };
})();
