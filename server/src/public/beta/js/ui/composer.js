// /beta — поле ввода переписки по макету: «+», стеклянное поле со смайлами, отправка. Текст, ответ, пересылка, правка,
// вложения с загрузкой, форматирование (Fmt), смайлы и GIF. Состояние каждого открытого чата хранится на его странице (el._cs), черновики — в B.drafts.
B.ui = B.ui || {};
B.drafts = B.drafts || {};
B.ui.composer = (function () {
  var MAX_ATT = 10;
  function cs(el) { return el._cs; }
  function ta(el) { return $('.comp .ce', el); }
  function comp(el) { return $('.comp', el); }
  function chatOf(el) { return B.find(+el.dataset.cid); }

  var FMT = [['bold', 'b', 'Жирный'], ['italic', 'i', 'Курсив'], ['code', 'c', 'Код в строке'], ['braces', 'blk', 'Блок кода'], ['eyeOff', 's', 'Секрет']];
  function mount(el, chat) {
    var c = comp(el); el._cs = { reply: null, fwd: null, edit: null, atts: [], mode: 'emoji', fmt: false, prev: false, lw: null };
    // Дополнительные панели (.xtra) лежат над рядом на всю ширину и огибают кнопки; подложку рисует CShape по их высоте
    c.innerHTML =
      '<div class="xtra"><div class="rnote" hidden></div><div class="ctx"></div><div class="lpv" hidden></div><div class="fpv" hidden><div class="fpl">Превью — так увидят получатели</div><div class="fpb"></div></div>' +
        '<div class="fmtbar" hidden>' + FMT.map(function (x) { return '<button data-f="' + x[1] + '" aria-label="' + x[2] + '" title="' + x[2] + '">' + I(x[0]) + '</button>'; }).join('') + '<span class="fsep"></span><button data-f="prev" aria-label="Превью" title="Показать превью">' + I('eye') + '</button><span class="fgrow"></span><button data-f="close" aria-label="Закрыть" title="Закрыть панель форматирования">' + I('x') + '</button></div></div>' +
      '<button class="cbtn glass gi" data-k="up" aria-label="Вложение" aria-haspopup="menu">' + I('plus') + '</button>' +
      '<div class="cfield"><div class="cin"><span class="ph">Сообщение</span><div class="ce fmt-ce" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Сообщение" enterkeyhint="return" autocapitalize="sentences" spellcheck="true"></div><button class="em" data-k="emo" aria-label="Смайлы">' + I('smile') + '</button></div></div>' +
      '<button class="sendb glass gi" data-k="send" aria-label="Отправить">' + I('send', 's') + '</button>' +
      '<div class="lkb" hidden></div><input type="file" multiple style="display:none">';
    CShape.attach(c);
    var t = ta(el), file = $('input[type=file]', c), cst = cs(el);
    Fmt.init(t);
    cst.lw = Fmt.linkWatch({
      getText: function () { return t.value; },
      fetchPreview: async function (u) { if (B.S.secretChatIds.has(+el.dataset.cid)) return null; var r = await B.api('GET', '/preview?url=' + encodeURIComponent(u)); return r && r.preview || null; },
      onChange: function () { paintFmt(el); }
    });
    t.value = B.drafts[chat.id] || ''; autosize(t); syncHas(el); cst.lw.check();
    file.addEventListener('change', function () { var fs = Array.prototype.slice.call(file.files); file.value = ''; if (fs.length) attachMany(el, fs); });
    t.addEventListener('input', function () { B.drafts[chat.id] = t.value; autosize(t); syncHas(el); cs(el).lw.check(); if (cs(el).fmt) { fmtState(el); paintPrev(el); } if (!cs(el).edit) B.msgs.typing(); });
    t.addEventListener('focus', function () { showKb(); });
    t.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (Fmt.keydown(e, t)) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!e.shiftKey && matchMedia('(pointer:fine)').matches && !real()))) { e.preventDefault(); send(el); }
    });
    document.addEventListener('selectionchange', function () { if (!t.isConnected) return; if (cs(el).fmt && document.activeElement === t) fmtState(el); });
    c.addEventListener('mousedown', function (e) { if (e.target.closest('input')) return; if (e.target.closest('.cbtn,.sendb,.fmtbar,.lpv,.em')) e.preventDefault(); });   // кнопки не должны убирать клавиатуру
    c.addEventListener('click', function (e) { onClick(el, e); });
    renderCtx(el); sync(el);
  }
  function autosize(t) { var f = t.closest('.cfield'); if (f) f.classList.toggle('filled', !!(t.textContent || t.querySelector('pre'))); }

  // Плавно раскрывает и сворачивает блок над полем (высота, отступы, прозрачность); done — когда блок свернулся
  function slide(box, show, done) {
    show = !!show;
    var open = box._open !== undefined ? box._open : (!box.hidden && box.offsetHeight > 0);
    if (open === show) return;
    box._open = show; clearTimeout(box._slT);
    var cc = box.closest('.comp'); if (cc && cc._cs) cc._cs.burst(800);
    var st = box.style, reset = function () { st.height = st.paddingTop = st.paddingBottom = st.opacity = st.overflow = st.transition = ''; };
    reset();
    if (show) {
      box.hidden = false; var h = box.offsetHeight;
      st.overflow = 'hidden'; st.height = '0'; st.paddingTop = '0'; st.paddingBottom = '0'; st.opacity = '0'; void box.offsetHeight;
      st.transition = 'height .26s var(--ease), padding .26s var(--ease), opacity .2s'; st.height = h + 'px'; st.paddingTop = ''; st.paddingBottom = ''; st.opacity = '';
      box._slT = setTimeout(reset, 320);
    } else {
      st.overflow = 'hidden'; st.height = box.offsetHeight + 'px'; void box.offsetHeight;
      st.transition = 'height .26s var(--ease), padding .26s var(--ease), opacity .2s'; st.height = '0'; st.paddingTop = '0'; st.paddingBottom = '0'; st.opacity = '0';
      box._slT = setTimeout(function () { reset(); box.hidden = true; if (done) done(); }, 300);
    }
  }

  // ── форматирование и превью ──
  function paintFmt(el) { paintLp(el); paintPrev(el); }
  function paintLp(el) {
    var s = cs(el), box = $('.lpv', comp(el)), p = s.lw && s.lw.current();
    if (!p) { slide(box, false); return; }
    box.innerHTML = '<span class="lth">' + (p.image ? '<img src="' + B.esc(B.http() + '://' + B.S.server + p.image) + '" alt="">' : I('link')) + '</span><div class="lpt"><b>' + B.esc(p.title || p.site || p.url) + '</b><span>' + B.esc(p.site || '') + '</span></div><button class="ibtn" data-k="lpx" aria-label="Не показывать превью">' + I('x') + '</button>';
    slide(box, true);
  }
  function paintPrev(el) {
    var s = cs(el), box = $('.fpv', comp(el)), t = ta(el);
    if (!(s.fmt && s.prev)) { slide(box, false); return; }
    var text = t.value, b = $('.fpb', box);
    if (!text.trim()) b.innerHTML = '<span class="fe">Здесь появится оформленный текст</span>';
    else { var pb = B.ui.chat.previewBody(text, s.lw && s.lw.current(), chatOf(el)); b.innerHTML = '<div class="bub' + pb.cls + '">' + pb.html + '</div>'; }
    slide(box, true);
  }
  function fmtState(el) {
    var bar = $('.fmtbar', comp(el)), st = Fmt.state(ta(el));
    ['b', 'i', 'c', 'blk', 's'].forEach(function (k) { var b = $('[data-f="' + k + '"]', bar); if (b) b.classList.toggle('on', !!st[k]); });
  }
  function syncFmt(el) {
    var s = cs(el), c = comp(el);
    slide($('.fmtbar', c), s.fmt);
    $('[data-f="prev"]', c).classList.toggle('on', s.prev);
    if (s.fmt) fmtState(el);
    paintPrev(el);
  }
  function closeFmt(el) { var s = cs(el); if (!s.fmt && !s.prev) return; s.fmt = false; s.prev = false; syncFmt(el); }
  function fmtClick(el, k) {
    var s = cs(el), t = ta(el);
    if (k === 'close') { s.fmt = false; s.prev = false; syncFmt(el); return; }
    if (k === 'prev') { s.prev = !s.prev; syncFmt(el); return; }
    Fmt.cmd(t, k); t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function syncHas(el) {
    var s = cs(el), t = ta(el); if (!t) return;
    $('.sendb', comp(el)).classList.toggle('ready', !!(t.value.trim() || s.atts.some(function (a) { return a.done; }) || s.fwd || s.edit));
  }

  // Только чтение, лимит «без ответа», приглашение, скрытый чат без ключа: вместо поля — плашка
  function sync(el) {
    var chat = chatOf(el); if (!chat) return;
    var c = comp(el), n = B.msgs.note(chat), note = $('.rnote', c), lk = $('.lkb', c), state = null, h = '';
    note.classList.toggle('soft', !!(n && n.soft));
    if (n && n.soft) { note.textContent = n.text; slide(note, true); } else slide(note, false);
    if (chat.invite) {
      var from = chat.invite.from_name; state = 'invite';
      h = '<div class="it">' + (from ? '<b>' + B.esc(from) + '</b> приглашает вас в ' + B.msgs.fedKind(chat) : 'Вас приглашают в ' + B.msgs.fedKind(chat)) + '. Пока вы не вступили, участников и сообщений не видно.</div><div class="ib"><button class="btn" data-k="invdecl">Отклонить</button><button class="btn pri" data-k="invjoin">Вступить</button></div>';
    } else if (B.secret.locked(chat.id)) {
      var secure = window.isSecureContext && !!(window.crypto && crypto.subtle), pending = window.SC && SC.pendingOf(chat.id), open = B.secret.bannerOpen === chat.id; state = 'secret';
      if (!secure) h = '<span class="lk">' + I('lock') + '</span><div class="tx"><b>Скрытые чаты работают только по HTTPS</b></div>';
      else if (pending) h = '<span class="lk">' + I('lock') + '</span><div class="tx"><b>Код принят</b><span>Ждём подтверждения собеседника</span></div><button class="btn sm" data-k="sccancel">Отменить</button>';
      else if (open) h = '<span class="lk">' + I('lock') + '</span><div class="tx"><b>Введите код</b><span>Код назвал собеседник</span></div><input id="sc-code" placeholder="КОД" maxlength="12" autocomplete="off" autocapitalize="characters"><button class="btn pri sm" data-k="scredeem">Ок</button>';
      else h = '<span class="lk">' + I('lock') + '</span><div class="tx"><b>Чат зашифрован</b><span>Сообщения видны после расшифровки</span></div><button class="btn pri sm" data-k="scopen">Расшифровать</button>';
    } else if (B.msgs.locked(chat)) { state = 'ro'; h = '<div class="it">' + B.esc((n && n.text) || 'Писать сюда нельзя') + '</div>'; }
    c.classList.toggle('lk', !!state);
    if (state) { if (lk._h !== h) { lk.innerHTML = h; lk._h = h; } lk.hidden = false; closePanel(el); } else { lk.hidden = true; lk.innerHTML = ''; lk._h = ''; }
  }

  // ── полосы над полем: ответ, пересылка, правка, вложения ──
  function renderCtx(el) {
    var s = cs(el), box = $('.ctx', comp(el)), h = '';
    var bar = function (title, text, k) { return '<div class="cbar"><i class="tk"></i><div class="ct"><b>' + B.esc(title) + '</b><span>' + B.esc(text) + '</span></div><button class="ibtn" data-k="clr" data-w="' + k + '" aria-label="Убрать">' + I('x') + '</button></div>'; };
    if (s.reply) h += bar('Ответ: ' + s.reply.senderName, s.reply.text, 'reply');
    if (s.fwd) h += bar('Переслано от ' + (s.fwd.name || ''), Fmt.plain(s.fwd.text || '') || (s.fwd.attachment ? '📎 Вложение' : ''), 'fwd');
    if (s.edit) h += '<div class="cbar"><i class="tk"></i><div class="ct"><b>Редактирование</b></div><button class="ibtn" data-k="clr" data-w="edit" aria-label="Отменить">' + I('x') + '</button></div>';
    if (s.atts.length) h += attsHtml(el, s);
    if (h) { box.innerHTML = h; slide(box, true); } else slide(box, false, function () { box.innerHTML = ''; });
    syncHas(el);
    var ph = $('.ph', comp(el)); if (ph) ph.textContent = s.edit ? 'Изменить сообщение' : (B.S.secretChatIds.has(+el.dataset.cid) ? 'Скрытое сообщение' : 'Сообщение');
  }
  function clear(el, what, id) {
    var s = cs(el), t = ta(el);
    if (what === 'att') { dropAtt(el, +id); return; }
    if (what === 'edit') { s.edit = null; t.value = ''; B.drafts[+el.dataset.cid] = ''; autosize(t); s.lw.reset(); } else s[what] = null;
    renderCtx(el);
  }

  // ── вложения (до 10 за раз; в скрытом чате — одно) ──
  var attSeq = 0;
  function attsHtml(el, s) {
    var n = s.atts.length, imgs = s.atts.every(function (a) { return a.kind === 'Фото'; });
    var title = n === 1 ? s.atts[0].kind : imgs ? n + ' фото' : 'Вложений: ' + n;
    var items = s.atts.map(function (a) {
      var inner;
      if (a.prev) inner = '<img src="' + B.esc(a.prev) + '" alt="">';
      else if (a.done && a.data && !a.data.enc && a.data.thumb) inner = '<img src="' + B.esc(B.http() + '://' + B.S.server + a.data.thumb) + '" alt="">';
      else inner = '<span class="axf">' + I(a.kind === 'Видео' ? 'play' : 'file') + '<small>' + B.esc((a.name || '').slice(-14)) + '</small></span>';
      return '<div class="ax' + (a.done ? '' : ' up') + '" data-id="' + a.id + '">' + inner + (a.done ? '' : '<div class="axp"><i style="width:' + a.pct + '%"></i><span>' + (a.proc ? '…' : a.pct + '%') + '</span></div>') + '<button class="rm" data-k="clr" data-w="att" data-i="' + a.id + '" aria-label="Убрать">' + I('x') + '</button></div>';
    }).join('');
    return '<div class="axs"><div class="axh"><b>' + title + '</b></div><div class="axl">' + items + (n < MAX_ATT && !B.S.secretChatIds.has(+el.dataset.cid) ? '<button class="ax add" data-k="addatt" aria-label="Добавить ещё">' + I('plus') + '</button>' : '') + '</div></div>';
  }
  function paintProg(el) {
    var s = cs(el), box = $('.ctx', comp(el));
    s.atts.forEach(function (a) { var t = $('.ax[data-id="' + a.id + '"] .axp', box); if (!t) return; t.firstChild.style.width = a.pct + '%'; t.lastChild.textContent = a.proc ? '…' : a.pct + '%'; });
  }
  function dropAtt(el, id) {
    var s = cs(el), i = s.atts.findIndex(function (a) { return a.id === id; }); if (i < 0) return;
    var a = s.atts[i]; s.atts.splice(i, 1); B.upload.cancel(a.done ? a.data : null, a.ctl); if (a.prev) URL.revokeObjectURL(a.prev); renderCtx(el);
  }
  function clearAtts(el, keepFiles) {
    var s = cs(el);
    s.atts.forEach(function (a) { if (!keepFiles) B.upload.cancel(a.done ? a.data : null, a.ctl); if (a.prev) URL.revokeObjectURL(a.prev); });
    s.atts = [];
  }
  function attachMany(el, files) {
    var s = cs(el), secret = B.S.secretChatIds.has(+el.dataset.cid);
    if (secret && (s.atts.length || files.length > 1)) { B.toast.show('В скрытом чате прикрепляется по одному файлу', 'lock'); files = files.slice(0, s.atts.length ? 0 : 1); }
    var room = MAX_ATT - s.atts.length;
    if (files.length > room) { B.toast.show('Можно прикрепить не больше ' + MAX_ATT + ' файлов', 'clip'); files = files.slice(0, room); }
    files.forEach(function (f) { attach(el, f); });
  }
  function attach(el, file) {
    var s = cs(el), a = { id: ++attSeq, kind: file.type.indexOf('image/') === 0 ? 'Фото' : file.type.indexOf('video/') === 0 ? 'Видео' : 'Файл', name: file.name, pct: 0, done: false, proc: false, data: null, ctl: null, prev: file.type.indexOf('image/') === 0 && !B.S.secretChatIds.has(+el.dataset.cid) ? URL.createObjectURL(file) : '' };
    s.atts.push(a); renderCtx(el);
    var drop = function () { var i = s.atts.indexOf(a); if (i >= 0) { s.atts.splice(i, 1); if (a.prev) URL.revokeObjectURL(a.prev); renderCtx(el); } };
    B.upload.pick(file, {
      onStart: function (k) { a.kind = k; }, onPrepare: function (p) { a.pct = p; paintProg(el); }, onProgress: function (p) { a.pct = p; paintProg(el); },
      onProcessing: function () { a.proc = true; paintProg(el); }, onDone: function (resp) { a.done = true; a.data = resp; renderCtx(el); }, onError: function (msg) { drop(); B.toast.show(msg, 'x'); }
    }, { chatId: +el.dataset.cid }).then(function (ctl) { a.ctl = ctl; if (!s.atts.includes(a)) B.upload.cancel(null, ctl); });
  }

  // ── действия ──
  function reply(el, m) {
    if (!m || m.deleted) return; var s = cs(el), mine = m.sender_id === B.S.user.id;
    s.edit = null;
    s.reply = { id: m.id, senderId: m.sender_id, senderTag: m.sender_tag, senderName: mine ? B.S.user.display_name : (m.sender_name || ''), text: (Fmt.noCode(m.text || '') || (m.attachment ? '📎 ' + (m.attachment.name || 'Вложение') : '')).slice(0, 100) };
    renderCtx(el); ta(el).focus();
  }
  function forward(el, fwd) { var s = cs(el); s.fwd = fwd; renderCtx(el); ta(el).focus(); }
  function startEdit(el, m) {
    if (!m || m.deleted) return;
    if (Date.now() / 1000 - m.sent_at > (B.S.editLimit || 120)) { B.toast.show('Время редактирования истекло', 'x'); return; }
    var s = cs(el), t = ta(el); s.edit = m.id; s.reply = null; if (s.atts.length) { clearAtts(el); renderCtx(el); }
    t.value = m.text || ''; autosize(t); renderCtx(el); Fmt.focusEnd(t); s.lw.load(m.link_preview || null, m.text || '');
  }
  function mention(el, id, name) {
    var t = ta(el); if (!t || !name || comp(el).classList.contains('lk')) return;
    if (id === B.S.user.id) name = B.S.user.display_name;
    var before = Fmt.textBeforeCaret(t);
    Fmt.insertText(t, (before && !/\s$/.test(before) ? ' ' : '') + '@' + name + ' ');
  }
  function send(el) {
    var s = cs(el), t = ta(el), chat = chatOf(el), text = t.value.trim();
    if (s.edit) {
      if (text) B.msgs.edit(s.edit, text, s.lw.current());
      s.edit = null; t.value = ''; B.drafts[chat.id] = ''; autosize(t); renderCtx(el); s.lw.reset(); closeFmt(el); return;
    }
    if (s.atts.some(function (a) { return !a.done; })) { B.toast.show('Дождитесь окончания загрузки', 'upd'); return; }
    var att = null;
    if (s.atts.length) { att = s.atts[0].data; if (s.atts.length > 1) att = Object.assign({}, att, { more: s.atts.slice(1).map(function (a) { return a.data; }) }); }
    B.msgs.send({ text: text, reply: s.reply, attachment: att, forward: s.fwd, linkPreview: s.lw.current() }).then(function (ok) {
      if (!ok) return;
      clearAtts(el, true); s.reply = s.fwd = null; t.value = ''; B.drafts[chat.id] = ''; autosize(t); renderCtx(el); closePanel(el); s.lw.reset(); closeFmt(el);
    });
  }
  function sendGif(el, att) {
    var s = cs(el); if (!att || !att.gif || s.edit) return;
    var t = ta(el), text = t.value.trim();
    B.msgs.send({ text: text, reply: s.reply, attachment: att }).then(function (ok) { if (ok) { s.reply = null; t.value = ''; B.drafts[+el.dataset.cid] = ''; autosize(t); renderCtx(el); closePanel(el); } });
  }

  // ── меню «+»: прикрепить файл и форматирование ──
  function closeUp() { var w = $('.upw', layer); if (!w) return; var m = $('.upm', w); m.classList.remove('in'); setTimeout(function () { w.remove(); }, 200); }
  function upMenu(btn, el) {
    closeUp(); var r = rel(btn), H = phone.offsetHeight, w = document.createElement('div'); w.className = 'upw';
    w.innerHTML = '<div class="upm glass-pop" role="menu" style="left:' + Math.max(10, r.x) + 'px;bottom:' + (H - r.y + 8) + 'px"><button role="menuitem" data-u="attach">' + I('clip') + '<span>Прикрепить файл</span></button><button role="menuitem" data-u="fmt">' + I('pen') + '<span>Форматирование</span></button></div>';
    layer.append(w); void w.offsetWidth; $('.upm', w).classList.add('in');
    w.onclick = function (e) {
      var u = e.target.closest('[data-u]'); closeUp(); if (!u) return;
      setTimeout(function () {
        var s = cs(el);
        if (u.dataset.u === 'attach') $('input[type=file]', comp(el)).click();
        else { s.fmt = !s.fmt; if (!s.fmt) s.prev = false; syncFmt(el); if (s.fmt) ta(el).focus(); }
      }, 120);
    };
  }

  // ── панель смайлов и GIF (под полем вместо клавиатуры) ──
  var epMode = 'emoji', epEl = null;
  function gifOn(el) { return !!(window.GifKlipy && GifKlipy.on()) && !cs(el).edit && !B.S.secretChatIds.has(+el.dataset.cid); }
  var BK = '<svg class="i" viewBox="0 0 24 24"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><line x1="18" x2="12" y1="9" y2="15"/><line x1="12" x2="18" y1="9" y2="15"/></svg>';
  function epPanel() {
    var p = $('.epanel', phone);
    if (!p) {
      p = document.createElement('div'); p.className = 'epanel'; phone.append(p);
      p.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
      p.addEventListener('click', function (e) {
        var m = e.target.closest('[data-m]'); if (m) { epMode = m.dataset.m; epRender(); return; }
        if (!epEl) return;
        if (e.target.closest('[data-del]')) { Fmt.backspaceQuiet(ta(epEl)); return; }
      });
    }
    return p;
  }
  function epRender() {
    var el = epEl, p = epPanel(), gif = epMode === 'gif' && gifOn(el), secs = B.emoji.sections();
    p.innerHTML = (gif ? '' : '<div class="ep-top"><label class="ep-s">' + I('search') + '<input class="ep-q" type="search" placeholder="Поиск смайла" autocomplete="off" autocapitalize="none"></label><div class="ep-tabs">' + B.emoji.tabsHtml(secs) + '</div></div>') +
      '<div class="ep-body' + (gif ? ' ep-gifb' : '') + '">' + (gif ? '<div class="ep-gif"></div>' : B.emoji.gridHtml(secs, 'data-k="em"')) + '</div>' +
      '<div class="ep-dock">' + (gifOn(el) ? '<div class="ep-sw"><button data-m="emoji" aria-pressed="' + !gif + '">Смайлы</button><button data-m="gif" aria-pressed="' + gif + '">GIF</button></div>' : '<span></span>') +
      '<div class="ep-r">' + (gif ? '<span class="ep-pw"><span>Powered by</span> ' + GifKlipy.mark + '</span>' : '') + '<button class="ep-del" data-del aria-label="Удалить символ">' + BK + '</button></div></div>';
    if (!gif) {
      var eg = $('.ep-body', p), tabs = $('.ep-tabs', p), q = $('.ep-q', p), all = eg.innerHTML;
      B.emoji.bindTabs(eg, tabs, 0);
      eg.addEventListener('click', function (e) { var b = e.target.closest('[data-e]'); if (b && epEl) { B.emoji.track(b.dataset.e); Fmt.insertQuiet(ta(epEl), b.dataset.e); } });
      q.addEventListener('input', function () { var v = q.value.trim(); tabs.hidden = !!v; if (!v) { eg.innerHTML = all; eg.scrollTop = 0; eg.dispatchEvent(new Event('scroll')); return; } eg.innerHTML = B.emoji.resultsHtml(v, 'data-k="em"'); eg.scrollTop = 0; });
      q.addEventListener('focus', function () { showKb(); phone.classList.add('ep'); });
    } else { GifKlipy.setUser(B.S.server + ':' + B.S.user.id, 'ru'); GifKlipy.mount($('.ep-gif', p), { onPick: function (att) { sendGif(el, att); } }); }
  }
  function openPanel(el) {
    if (!el._cs || phone.classList.contains('ep')) return;
    epEl = el; var sc_ = $('.scroll', el), near = sc_.scrollHeight - sc_.scrollTop - sc_.clientHeight < 400;
    ta(el).blur(); phone.classList.remove('kbr'); epRender(); phone.classList.add('kb', 'ep'); $('.em', comp(el)).classList.add('on');
    B.bus.emit('kbd:changed', {}); if (near) { sc_.scrollTop = 1e6; setTimeout(function () { sc_.scrollTop = 1e6; }, 360); }
  }
  function closePanel(el) {
    if (!phone.classList.contains('ep')) return;
    phone.classList.remove('ep'); if (!phone.classList.contains('kbr')) phone.classList.remove('kb');
    if (el && comp(el)) $('.em', comp(el)).classList.remove('on');
    B.bus.emit('kbd:changed', {});
  }

  function onClick(el, e) {
    var fb = e.target.closest('.fmtbar [data-f]'); if (fb) { fmtClick(el, fb.dataset.f); return; }
    var b = e.target.closest('[data-k]'); if (!b) return; var k = b.dataset.k, s = cs(el);
    if (k === 'send') send(el);
    else if (k === 'invjoin') B.chats.acceptInvite(+el.dataset.cid, b);
    else if (k === 'invdecl') B.chats.declineInvite(+el.dataset.cid);
    else if (k === 'scopen') { B.secret.bannerOpen = +el.dataset.cid; sync(el); var ci = $('#sc-code', comp(el)); if (ci) ci.focus(); }
    else if (k === 'scredeem') { var code = ($('#sc-code', comp(el)).value || '').trim(); if (code) B.secret.redeem(+el.dataset.cid, code).then(function () { sync(el); }); }
    else if (k === 'sccancel') { B.secret.cancelSync(+el.dataset.cid); sync(el); }
    else if (k === 'up') { if (!B.msgs.locked(chatOf(el))) upMenu(b, el); }
    else if (k === 'lpx') s.lw.dismiss();
    else if (k === 'emo') { if (phone.classList.contains('ep')) { closePanel(el); phone.classList.remove('kb'); ta(el).focus(); } else openPanel(el); }
    else if (k === 'clr') clear(el, b.dataset.w, b.dataset.i);
    else if (k === 'addatt') $('input[type=file]', comp(el)).click();
  }

  // Вставка файла (скриншот и т.п.) из буфера обмена
  document.addEventListener('paste', function (e) {
    var el = B.ui.chat && B.ui.chat.activePage(); if (!el || !el._cs) return;
    var fl = Array.prototype.map.call((e.clipboardData && e.clipboardData.items) || [], function (i) { return i.kind === 'file' ? i.getAsFile() : null; }).filter(Boolean);
    if (fl.length && !B.msgs.locked(chatOf(el))) { e.preventDefault(); attachMany(el, fl); }
  });
  B.bus.on('modules:changed', function () { var el = B.ui.chat && B.ui.chat.activePage(); if (el && el._cs && phone.classList.contains('ep')) { epEl = el; epRender(); } });
  B.bus.on('nav:changed', function () { var t = B.nav.top(); if (!(t && t.el._cs)) closePanel(null); });
  B.bus.on('auth:logout', function () { B.drafts = {}; });
  B.bus.on('secret:ready', function (d) { var el = B.ui.chat && B.ui.chat.pageFor(d.chatId); if (el && el._cs) { sync(el); if (B.msgs.chatId === d.chatId) B.msgs.open(d.chatId); } });

  return { mount: mount, sync: sync, mention: mention, reply: reply, forward: forward, edit: startEdit, send: send, closePanel: closePanel };
})();
