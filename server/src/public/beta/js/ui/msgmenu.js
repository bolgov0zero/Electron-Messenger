// /beta — меню сообщения: долгое нажатие на пузырь показывает его над размытым фоном, сверху реакции, снизу действия
// (ответить, переслать, копировать, изменить, «Прочитано», удалить). Здесь же шторки: «Переслать», «Прочитано», «Реакция».
B.ui = B.ui || {};
B.ui.msgmenu = (function () {
  var esc = B.esc, ic = B.ic, layer = null, cur = null, openedAt = 0;
  var QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  function init(root) {
    layer = document.createElement('div'); layer.className = 'cml'; root.appendChild(layer);
    layer.addEventListener('click', function (e) {
      if (performance.now() - openedAt < 350) return;          // отпускание пальца после долгого нажатия не закрывает меню
      var b = e.target.closest('[data-m]');
      if (!b) { close(); return; }
      var m = b.dataset.m, c = cur; close();
      if (!c) return;
      if (m === 'rx') B.msgs.react(c.msg.id, b.dataset.e);
      else if (m === 'more') setTimeout(function () { reactionSheet(c.msg); }, 160);
      else if (m === 'item') setTimeout(c.items[+b.dataset.i].f, 120);
    });
  }

  function open(el, row, bub) {
    var chat = B.find(+el.dataset.cid), m = B.msgs.find(+row.dataset.mid);
    if (!chat || !m || m.deleted || m._optimistic || !layer) return;
    B.kbd.hide();
    var mine = m.sender_id === B.S.user.id, secret = B.S.secretChatIds.has(chat.id);
    var canEdit = !secret && mine && m.text && (Date.now() / 1000 - m.sent_at) < (B.S.editLimit || 120);
    var locked = B.msgs.locked(chat);
    var items = [
      !locked && { l: 'Ответить', i: 'reply', f: function () { B.ui.composer.reply(el, m); } },
      !secret && { l: 'Переслать', i: 'fwd', f: function () { forwardSheet(m); } },
      m.text && { l: 'Копировать', i: 'copy', f: function () { copy(m.text); } },
      canEdit && !locked && { l: 'Изменить', i: 'pencil', f: function () { B.ui.composer.edit(el, m); } },
      mine && { l: 'Информация', i: 'eye', f: function () { readSheet(m); } },
      mine && { l: 'Удалить', i: 'trash', d: 1, f: function () { B.actions.confirm('Удалить сообщение?', '', 'Удалить', function () { B.msgs.remove(m.id); B.toast.show('Сообщение удалено'); }); } }
    ].filter(Boolean);
    cur = { msg: m, items: items };
    var app = document.getElementById('app'), ar = app.getBoundingClientRect(), br = bub.getBoundingClientRect();
    var r = { x: br.left - ar.left, y: br.top - ar.top, w: br.width, h: br.height }, W = ar.width, H = ar.height;
    layer.innerHTML = '<div class="cmb"></div>';
    var clone = document.createElement('div'); clone.className = 'mrow cmc ' + (mine ? 'out' : 'in');
    clone.innerHTML = '<div class="mcol">' + bub.outerHTML + '</div>';
    clone.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px';
    var rx = document.createElement('div'); rx.className = 'cmr';
    rx.innerHTML = QUICK.map(function (e) { return '<button data-m="rx" data-e="' + e + '">' + e + '</button>'; }).join('') + '<button class="more" data-m="more" aria-label="Другие реакции">' + ic('plus', 20, 2.4) + '</button>';
    var mn = document.createElement('div'); mn.className = 'cmm';
    mn.innerHTML = items.map(function (it, i) { return '<button class="' + (it.d ? 'd' : '') + '" data-m="item" data-i="' + i + '"><span>' + it.l + '</span>' + ic(it.i, 20, 1.8) + '</button>'; }).join('');
    layer.append(clone, rx, mn); layer.classList.add('on'); openedAt = performance.now();
    var rxH = 50, gap = 10, menuH = items.length * 44, chH = Math.min(clone.offsetHeight, 320);
    var topLimit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
    var minTop = Math.max(topLimit, 20) + 14 + rxH + gap, top = r.y;
    if (top < minTop) top = minTop;
    var bottomLimit = H - Math.max(20, parseFloat(getComputedStyle(el).getPropertyValue('--sab')) || 0) - 12;
    if (top + chH + gap + menuH > bottomLimit) top = bottomLimit - menuH - gap - chH;
    if (top < minTop) top = minTop;
    var rw = rx.offsetWidth, mw = 244;
    var rxL = mine ? W - 12 - rw : Math.min(Math.max(r.x, 12), W - 12 - rw), mnL = mine ? W - 12 - mw : Math.min(Math.max(r.x, 12), W - 12 - mw);
    rx.style.left = rxL + 'px'; rx.style.top = (top - rxH - gap + 4) + 'px'; rx.style.transformOrigin = (mine ? 'right' : 'left') + ' bottom';
    mn.style.left = mnL + 'px'; mn.style.top = (top + chH + gap) + 'px'; mn.style.transformOrigin = (mine ? 'right' : 'left') + ' top';
    clone.style.maxHeight = '320px'; clone.style.overflow = 'hidden';
    void clone.offsetWidth;
    // Само сообщение в ленте прячем на время меню: на экране двигается именно оно, а не его копия рядом с оригиналом
    cur.hidden = [bub].concat(Array.prototype.slice.call(row.querySelectorAll('.rx'))); cur.hidden.forEach(function (e) { e.style.visibility = 'hidden'; });
    cur.clone = clone; cur.rx = rx; cur.mn = mn; cur.y = r.y;      // нужны при закрытии: меню уходит так же плавно, как появилось
    clone.style.transition = 'top .38s var(--ease)'; clone.style.top = top + 'px'; rx.classList.add('in'); mn.classList.add('in');
    try { navigator.vibrate && navigator.vibrate(10); } catch (e) {}
  }
  function close() {
    if (!layer) return; var c = cur; layer.classList.remove('on'); cur = null;
    // Реакции и меню сжимаются обратно и гаснут, пузырь возвращается на своё место, фон светлеет
    if (c && c.rx) { c.rx.classList.remove('in'); c.mn.classList.remove('in'); c.clone.style.top = c.y + 'px'; }
    // Когда пузырь вернулся на место (переход .38 с), настоящее сообщение снова показываем и убираем копию
    setTimeout(function () { if (c && c.hidden) c.hidden.forEach(function (e) { e.style.visibility = ''; }); }, 380);
    setTimeout(function () { if (!layer.classList.contains('on')) layer.innerHTML = ''; }, 400);
  }
  function isOpen() { return !!(layer && layer.classList.contains('on')); }
  function copy(text) {
    var ok = function () { B.toast.show('Скопировано'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text); ok(); });
    else { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {} t.remove();
  }

  // ── шторка «Реакция»: все смайлы, группы вкладками и поиск ──
  function reactionSheet(m) {
    var secs = B.emoji.sections();
    var all = B.emoji.gridHtml(secs, 'data-r="1"');
    B.sheet.open({ size: 'med', title: 'Реакция', right: '<button class="nb" data-sheet="close">Готово</button>',
      body: '<div class="rp-hd"><div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="rp-q" placeholder="Поиск смайла" autocomplete="off"></div></div><div class="ep-tabs rp-tabs">' + B.emoji.tabsHtml(secs) + '</div></div><div class="rp-body">' + all + '</div>' });
    var body = B.sheet.body(), hd = body.querySelector('.rp-hd'), tabs = body.querySelector('.rp-tabs'), box = body.querySelector('.rp-body');
    B.emoji.bindTabs(body, tabs, hd.offsetHeight);
    body.addEventListener('click', function (e) { var b = e.target.closest('button[data-r]'); if (b) { B.emoji.track(b.dataset.e); B.sheet.close(); B.msgs.react(m.id, b.dataset.e); } });
    body.querySelector('#rp-q').addEventListener('input', function (e) {
      var q = e.target.value.trim();
      tabs.hidden = !!q;
      if (!q) { box.innerHTML = all; body.scrollTop = 0; body.dispatchEvent(new Event('scroll')); return; }
      box.innerHTML = B.emoji.resultsHtml(q, 'data-r="1"'); body.scrollTop = 0;
    });
  }

  // ── шторка «Прочитано» ──
  function rdTime(ts) {
    var d = new Date(ts * 1000), hm = B.fmt.time(ts);
    return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }
  function rdLabel(direct, read, delivered, readAt, total) {
    delivered = Math.max(delivered, read); total = Math.max(total || 0, delivered);
    if (delivered === 0) return 'Не доставлено';
    if (direct) return read ? 'Прочитано' + (readAt ? ' · ' + rdTime(readAt) : '') : 'Не прочитано';
    return (read > 0 && read >= total ? 'Прочитали все' : 'Прочитано') + ' · ' + read + ' из ' + delivered;
  }
  async function readSheet(m) {
    var st = m.status || {}, chat = B.find(m.chat_id), direct = chat && chat.type === 'direct';
    B.sheet.open({ size: 'med', title: 'Информация', right: '<button class="nb" data-sheet="close">Готово</button>',
      body: '<div style="height:12px"></div><div class="grp"><div class="cell"><span class="cl" id="rd-l">' + rdLabel(direct, st.read || 0, st.delivered || 0, null, st.total) + '</span></div></div><div id="rd-list"><div class="stub-note">Загрузка…</div></div>' });
    var data = await B.api('GET', '/messages/' + m.id + '/info');
    var list = document.getElementById('rd-list'); if (!list || !data || data.error) { if (list) list.innerHTML = ''; return; }
    var rd = data.statuses.filter(function (s) { return s.read_at; }), dlv = data.statuses.filter(function (s) { return s.delivered_at || s.read_at; }).length, dr = data.chat_type === 'direct';
    document.getElementById('rd-l').textContent = rdLabel(dr, rd.length, dlv, rd[0] && rd[0].read_at, (m.status && m.status.total) || data.statuses.length);
    list.innerHTML = rd.length
      ? '<div class="gh" style="margin-top:16px">Прочитали</div><div class="grp">' + rd.map(function (s) {
          return '<div class="cell" style="min-height:56px">' + B.avatar.user(s.user_id, s.display_name, 36, true) + '<span class="cl">' + esc(s.display_name) + '</span><span class="cv">' + rdTime(s.read_at) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="stub-note">' + (dr ? 'Собеседник ещё не открыл сообщение.' : dlv ? 'Пока никто не прочитал. Сообщение получили ' + dlv + '.' : 'Сообщение пока никому не доставлено.') + '</div>';
    B.avatar.apply(list);
  }

  // ── шторка «Переслать» ──
  function forwardSheet(m) {
    var mine = m.sender_id === B.S.user.id;
    var data = m.forward_data ? Object.assign({}, m.forward_data) : { user_id: m.sender_id, name: mine ? B.S.user.display_name : (m.sender_name || ''), text: (m.text || '').slice(0, 200), attachment: m.attachment || null, is_bot: !!m.sender_is_bot };
    B.sheet.open({ size: 'large', title: 'Переслать', left: '<button class="nb" data-sheet="close">Отмена</button>',
      body: '<div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="fw-q" placeholder="Поиск" autocomplete="off"></div></div><div id="fw-list"></div>' });
    var body = B.sheet.body(), q = body.querySelector('#fw-q'), list = body.querySelector('#fw-list');
    var render = function () {
      var s = q.value.trim().toLowerCase();
      var chats = B.S.chats.filter(function (c) { return !c.parent_id && !c.has_topics && !B.msgs.locked(c) && (!s || B.chatName(c).toLowerCase().indexOf(s) >= 0); });
      var peers = new Set(B.S.chats.filter(function (c) { return c.type === 'direct'; }).map(B.peerId).filter(Boolean));
      var users = B.S.contacts.filter(function (u) { return !peers.has(u.id) && (!s || u.display_name.toLowerCase().indexOf(s) >= 0 || (u.username || '').toLowerCase().indexOf(s) >= 0); });
      var row = function (av, name, attr) { return '<button class="crow2" ' + attr + '>' + av + '<div class="t"><b>' + esc(name) + '</b></div></button>'; };
      var h = '';
      if (chats.length) h += '<div class="hdr-s">Чаты</div>' + chats.map(function (c) { return row(B.avatar.chat(c, 40), B.chatName(c), 'data-chat="' + c.id + '"'); }).join('');
      if (users.length) h += '<div class="hdr-s">Контакты</div>' + users.map(function (u) { return row(B.avatar.user(u.id, u.display_name, 40, true), u.display_name, 'data-user="' + u.id + '"'); }).join('');
      list.innerHTML = h || '<div class="stub-note">Ничего не нашли</div>'; B.avatar.apply(list);
    };
    q.addEventListener('input', render); render();
    list.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var chat = b.dataset.chat ? B.find(+b.dataset.chat) : null;
      B.sheet.close();
      if (!chat) { chat = await B.contacts.openDirect(+b.dataset.user); if (!chat) { B.toast.show('Не удалось открыть чат'); return; } }
      toChat(chat.id, data);
    });
  }
  // Открыть чат назначения и положить пересылаемое в поле ввода
  function toChat(cid, data) {
    var top = B.nav.top(), delay = 0;
    if (!(top.el.dataset.cid == cid)) { if (B.nav.depth() > 1) { B.nav.popToRoot(); delay = 400; } setTimeout(function () { B.openChat(cid); put(); }, delay); } else put();
    function put() { var el = B.ui.chat.pageFor(cid); if (el) B.ui.composer.forward(el, data); }
  }

  B.bus.on('chat:deleted', function () { close(); });
  return { init: init, open: open, close: close, isOpen: isOpen };
})();
