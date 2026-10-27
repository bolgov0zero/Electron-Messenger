// /m — меню сообщения по макету: долгое нажатие поднимает пузырь над размытым фоном, сверху быстрые реакции, снизу действия.
// Здесь же листы «Реакция», «Информация» (кто прочитал) и «Переслать».
B.ui = B.ui || {};
B.ui.msgmenu = (function () {
  var QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  // Быстрые реакции — самые частые смайлы человека (общий список на всех устройствах), недостающее добирается из стандартных
  function quickList() {
    var f = B.emoji.freq(), list = Object.keys(f).sort(function (a, b) { return f[b] - f[a]; }).slice(0, QUICK.length);
    QUICK.forEach(function (e) { if (list.length < QUICK.length && list.indexOf(e) < 0) list.push(e); });
    return list;
  }
  function open(el, row, bub) {
    var chat = B.find(+el.dataset.cid), m = B.msgs.find(+row.dataset.mid);
    if (!chat || !m || m.deleted || m._optimistic) return;
    hideKb();
    var mine = m.sender_id === B.S.user.id, secret = B.S.secretChatIds.has(chat.id);
    var canEdit = !secret && mine && m.text && (Date.now() / 1000 - m.sent_at) < (B.S.editLimit || 120);
    var locked = B.msgs.locked(chat);
    var pinnable = !secret && !chat.parent_id && B.pins && B.pins.can(chat);
    var items = [
      !locked && { l: 'Ответить', i: 'reply', f: function () { B.ui.composer.reply(el, m); } },
      !secret && { l: 'Переслать', i: 'fwd', f: function () { forwardSheet(m); } },
      m.text && { l: 'Копировать', i: 'copy', f: function () { copy(m.text); } },
      canEdit && !locked && { l: 'Изменить', i: 'pen', f: function () { B.ui.composer.edit(el, m); } },
      pinnable && { l: B.pins.isPinned(chat, m) ? 'Открепить' : 'Закрепить', i: 'pin', f: function () { B.pins.toggle(chat, m); } },
      mine && { l: 'Информация', i: 'eye', f: function () { readSheet(m); } },
      { sp: 1 },
      mine && { l: 'Удалить', i: 'trash', d: 1, f: function () { B.actions.confirm('Удалить сообщение?', '', 'Удалить', function () { B.msgs.remove(m.id); B.toast.show('Сообщение удалено', 'trash'); }); } }
    ].filter(Boolean);
    if (items[items.length - 1].sp) items.pop();
    try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
    B.menu.open(bub, items, { rx: quickList(), mine: mine, onReact: function (e) { B.emoji.track(e); B.msgs.react(m.id, e); } });
  }
  function copy(text) {
    var ok = function () { B.toast.show('Скопировано', 'copy'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(Fmt.plain(text).replace(/<[^>]*>/g, '')).then(ok, function () { fallbackCopy(text); ok(); });
    else { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) { var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); }

  // ── лист «Реакция»: все смайлы, группы вкладками и поиск ──
  function reactSheet(fn) {
    var secs = B.emoji.sections(), all = B.emoji.gridHtml(secs, 'data-r="1"');
    var S = B.sheet.open({ title: 'Реакция', body: '<div class="ep-sheet"><div class="ep-top"><label class="ep-s">' + I('search') + '<input class="ep-q" placeholder="Поиск смайла" autocomplete="off"></label><div class="ep-tabs">' + B.emoji.tabsHtml(secs) + '</div></div><div class="ep-body">' + all + '</div></div>' });
    var box = $('.ep-body', S.el), tabs = $('.ep-tabs', S.el), q = $('.ep-q', S.el);
    B.emoji.bindTabs(box, tabs, 0);
    S.el.addEventListener('click', function (e) { var b = e.target.closest('button[data-r]'); if (b) { B.sheet.close(); fn && fn(b.dataset.e); } });
    q.addEventListener('focus', function () { showKb(); });
    q.addEventListener('input', function () { var v = q.value.trim(); tabs.hidden = !!v; if (!v) { box.innerHTML = all; box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); return; } box.innerHTML = B.emoji.resultsHtml(v, 'data-r="1"'); box.scrollTop = 0; });
  }
  B.ui.reactSheet = reactSheet;

  // ── лист «Информация» ──
  function rdTime(ts) { var d = new Date(ts * 1000), hm = B.fmt.time(ts); return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm; }
  function rdLabel(direct, read, delivered, readAt, total) {
    delivered = Math.max(delivered, read); total = Math.max(total || 0, delivered);
    if (delivered === 0) return 'Не доставлено';
    if (direct) return read ? 'Прочитано' + (readAt ? ' · ' + rdTime(readAt) : '') : 'Не прочитано';
    return (read > 0 && read >= total ? 'Прочитали все' : 'Прочитано') + ' · ' + read + ' из ' + delivered;
  }
  async function readSheet(m) {
    var st = m.status || {}, chat = B.find(m.chat_id), direct = chat && chat.type === 'direct';
    var S = B.sheet.open({ title: 'Информация', sub: 'Сообщение отправлено в ' + B.fmt.time(m.sent_at), body: '<div class="grp glass"><div class="cell"><span class="cl" id="rd-l">' + rdLabel(direct, st.read || 0, st.delivered || 0, null, st.total) + '</span></div></div><div id="rd-list"></div><button class="abtn" data-close>Закрыть</button>' });
    var data = await B.api('GET', '/messages/' + m.id + '/info');
    var list = $('#rd-list', S.el); if (!list || !data || data.error) return;
    var rd = data.statuses.filter(function (s) { return s.read || s.read_at; }), dlv = data.statuses.filter(function (s) { return s.delivered || s.delivered_at || s.read_at; }).length, dr = data.chat_type === 'direct';
    $('#rd-l', S.el).textContent = rdLabel(dr, rd.length, dlv, rd[0] && rd[0].read_at, (m.status && m.status.total) || data.statuses.length);
    list.innerHTML = rd.length ? '<div class="gl">Прочитали</div><div class="grp glass">' + rd.map(function (s) {
      return '<div class="mini">' + B.avatar.user(s.user_id, s.display_name, 0, true) + '<span class="rt"><b>' + B.esc(s.display_name) + '</b>' + (s.read_at ? '<small>Прочитано в ' + rdTime(s.read_at) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>' : '<div class="gf" style="margin-top:0">' + (dr ? 'Собеседник ещё не открыл сообщение.' : dlv ? 'Пока никто не прочитал. Сообщение получили ' + dlv + '.' : 'Сообщение пока никому не доставлено.') + '</div>';
    B.avatar.apply(list);
  }

  // ── лист «Переслать» ──
  function forwardSheet(m) {
    var mine = m.sender_id === B.S.user.id;
    var data = m.forward_data ? Object.assign({}, m.forward_data) : { user_id: m.sender_id, name: mine ? B.S.user.display_name : (m.sender_name || ''), text: (m.text || '').slice(0, 200), attachment: m.attachment || null, is_bot: !!m.sender_is_bot };
    data.src = m.id;   // по нему сервер считает отметку «переслали N раз»
    var S = B.sheet.open({ title: 'Переслать', body: '<label class="srch glass" style="height:40px">' + I('search') + '<input id="fw-q" placeholder="Поиск" autocomplete="off"></label><div id="fw-list"></div>' });
    var q = $('#fw-q', S.el), list = $('#fw-list', S.el);
    q.addEventListener('focus', function () { showKb(); });
    var paint = function () {
      var s = q.value.trim().toLowerCase();
      var chats = B.S.chats.filter(function (c) { return !c.parent_id && !c.has_topics && !B.msgs.locked(c) && (!s || B.chatName(c).toLowerCase().indexOf(s) >= 0); });
      var peers = new Set(B.S.chats.filter(function (c) { return c.type === 'direct'; }).map(B.peerId).filter(Boolean));
      var users = B.S.contacts.filter(function (u) { return !peers.has(u.id) && (!s || u.display_name.toLowerCase().indexOf(s) >= 0 || (u.username || '').toLowerCase().indexOf(s) >= 0); });
      var h = '';
      if (chats.length) h += '<div class="gl">Чаты</div><div class="grp glass">' + chats.map(function (c) { return '<button class="mini" data-chat="' + c.id + '">' + B.avatar.chat(c, 0, true) + '<span class="rt"><b>' + B.esc(B.chatName(c)) + '</b></span></button>'; }).join('') + '</div>';
      if (users.length) h += '<div class="gl">Контакты</div><div class="grp glass">' + users.map(function (u) { return '<button class="mini" data-user="' + u.id + '">' + B.avatar.user(u.id, u.display_name, 0, true) + '<span class="rt"><b>' + B.esc(u.display_name) + '</b></span></button>'; }).join('') + '</div>';
      list.innerHTML = h || '<div class="empty" style="padding:30px">Ничего не нашли</div>'; B.avatar.apply(list);
    };
    q.addEventListener('input', paint); paint();
    list.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var chat = b.dataset.chat ? B.find(+b.dataset.chat) : null;
      B.sheet.close();
      if (!chat) { chat = await B.contacts.openDirect(+b.dataset.user); if (!chat) { B.toast.show('Не удалось открыть чат', 'x'); return; } }
      toChat(chat.id, data);
    });
  }
  // Открыть чат назначения и положить пересылаемое в поле ввода
  function toChat(cid, data) {
    var top = B.nav.top(), delay = 0;
    var put = function () { var el = B.ui.chat.pageFor(cid); if (el) B.ui.composer.forward(el, data); };
    if (top.el.dataset.cid == cid) { put(); return; }
    if (B.nav.depth() > 1) { B.nav.popToRoot(); delay = 480; }
    setTimeout(function () { B.openChat(cid); setTimeout(put, 60); }, delay);
  }
  B.bus.on('chat:deleted', function () { B.menu.close(); });
  return { open: open, forward: forwardSheet };
})();
