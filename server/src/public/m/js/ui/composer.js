// /m — поле ввода переписки: текст, ответ, пересылка, правка, вложение с загрузкой, смайлы и GIF.
// Состояние каждого открытого чата хранится на его странице (el._cs), черновики — в B.drafts.
B.ui = B.ui || {};
B.drafts = B.drafts || {};
B.ui.composer = (function () {
  var esc = B.esc, ic = B.ic;
  var COLS = 8;

  function cs(el) { return el._cs; }
  function ta(el) { return el.querySelector('.comp .ce'); }
  function comp(el) { return el.querySelector('.comp'); }
  function chatOf(el) { return B.find(+el.dataset.cid); }

  function mount(el, chat) {
    var c = comp(el); el._cs = { reply: null, fwd: null, edit: null, att: null, panel: null, mode: 'emoji', tab: 0, fmt: false, prev: false, lw: null };
    c.innerHTML =
      '<div class="ctx"></div><div class="scb" hidden></div><div class="ronote" hidden></div>' +
      '<div class="tpr"><span class="dots"><i></i><i></i><i></i></span><span class="tpt"></span></div>' +
      '<div class="fxs"><div class="lpv" hidden></div><div class="fpv" hidden><div class="fpl">Превью — так увидят получатели</div><div class="fpb"></div></div><div class="fbar" hidden>' + Fmt.barHtml() + '</div></div>' +
      '<div class="crow"><div class="cbtn att" role="button" data-k="up" aria-label="Прикрепить, форматирование" aria-haspopup="menu">' + ic('chevup', 26, 2.2) + '</div>' +
        '<div class="upmenu" role="menu"><div class="umi" role="menuitem" data-k="attach">' + ic('clip', 22, 1.8) + '<span>Прикрепить файл</span></div><div class="umi" role="menuitem" data-k="fmt">' + ic('pencil', 22, 1.8) + '<span>Форматирование</span></div></div>' +
        '<input type="file" style="display:none">' +
        '<div class="cfield">' +
          '<div class="frow"><span class="ph">Сообщение</span><div class="ce fmt-ce" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Сообщение" enterkeyhint="return" autocapitalize="sentences" spellcheck="true"></div>' +
          '<button class="cbtn cem" data-k="emo" aria-label="Смайлы">' + ic('smile', 24, 1.7) + '</button></div></div>' +
        '<button class="csend" data-k="send" aria-label="Отправить">' + ic('up', 20, 2.8) + '</button></div>' +
      '<div class="epanel"></div><div class="hb"></div>';
    var t = ta(el), file = c.querySelector('input[type=file]'), cst = cs(el);
    Fmt.init(t);
    cst.lw = Fmt.linkWatch({
      getText: function () { return t.value; },
      fetchPreview: async function (u) { if (B.S.secretChatIds.has(+el.dataset.cid)) return null; var r = await B.api('GET', '/preview?url=' + encodeURIComponent(u)); return r && r.preview || null; },
      onChange: function () { paintFmt(el); }
    });
    t.value = B.drafts[chat.id] || ''; autosize(t); syncHas(el); cst.lw.check();
    file.addEventListener('change', function () { var f = file.files[0]; file.value = ''; if (f) attach(el, f); });
    t.addEventListener('input', function () { B.drafts[chat.id] = t.value; autosize(t); syncHas(el); cs(el).lw.check(); if (cs(el).fmt) { fmtState(el); paintPrev(el); } if (!cs(el).edit) B.msgs.typing(); });
    t.addEventListener('focus', function () { closePanel(el); closeUp(el); });
    t.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (Fmt.keydown(e, t)) return;     // блок кода, Ctrl/Cmd+B, I, E
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!e.shiftKey && matchMedia('(pointer:fine)').matches))) { e.preventDefault(); send(el); }
    });
    document.addEventListener('selectionchange', function () { if (!t.isConnected) return; if (cs(el).fmt && document.activeElement === t) fmtState(el); });
    c.addEventListener('mousedown', function (e) { if (e.target.closest('input')) return; if (e.target.closest('.epanel,.cbtn,.csend,.fbar,.lpv,.umi[data-k="fmt"]')) e.preventDefault(); });   // нажатие на кнопки не должно убирать клавиатуру
    document.addEventListener('click', function (e) { if (!c.isConnected) return; if (!e.target.closest('.upmenu,.cbtn.att')) closeUp(el); });
    c.addEventListener('click', function (e) { onClick(el, e); });
    renderCtx(el); sync(el);
  }

  // Поле растёт само (contenteditable); здесь только скрываем подсказку «Сообщение», когда в поле что-то есть
  function autosize(t) {
    var f = t.closest('.cfield'); if (f) f.classList.toggle('filled', !!(t.textContent || t.querySelector('pre')));
  }
  // ── меню «↑», панель форматирования и превью ──
  function closeUp(el) { var c = comp(el); if (c) c.querySelector('.crow').classList.remove('up'); }
  function paintFmt(el) { paintLp(el); paintPrev(el); }
  function paintLp(el) {
    var s = cs(el), box = comp(el).querySelector('.lpv'), p = s.lw && s.lw.current();
    box.hidden = !p;
    if (p) box.innerHTML = '<span class="lth">' + (p.image ? '<img src="' + esc(B.http() + '://' + B.S.server + p.image) + '" alt="">' : ic('link', 18, 2)) + '</span><div class="lpt"><b>' + esc(p.title || p.site || p.url) + '</b><span>' + esc(p.site || '') + '</span></div><div class="lpx" role="button" data-k="lpx" aria-label="Не показывать превью">' + ic('x', 14, 2.6) + '</div>';
  }
  function paintPrev(el) {
    var s = cs(el), box = comp(el).querySelector('.fpv'), t = ta(el);
    box.hidden = !(s.fmt && s.prev); if (box.hidden) return;
    var text = t.value, b = box.querySelector('.fpb');
    if (!text.trim()) { b.innerHTML = '<span class="fpe">Набранный текст появится здесь</span>'; return; }
    var pb = B.ui.chat.previewBody(text, s.lw && s.lw.current(), chatOf(el));
    b.innerHTML = '<div class="bub' + pb.cls + '">' + pb.html + '</div>';
  }
  function fmtState(el) {
    var bar = comp(el).querySelector('.fbar'), st = Fmt.state(ta(el));
    ['b', 'i', 'c', 'blk', 's'].forEach(function (k) { var b = bar.querySelector('[data-f="' + k + '"]'); if (b) b.classList.toggle('on', !!st[k]); });
  }
  function syncFmt(el) {
    var s = cs(el), c = comp(el);
    c.querySelector('.fbar').hidden = !s.fmt;
    c.querySelector('.umi[data-k="fmt"]').classList.toggle('on', s.fmt);
    c.querySelector('.fbar [data-f="prev"]').classList.toggle('on', s.prev);
    if (s.fmt) fmtState(el);
    paintPrev(el);
  }
  // После отправки панель форматирования и её превью закрываются
  function closeFmt(el) { var s = cs(el); if (!s.fmt && !s.prev) return; s.fmt = false; s.prev = false; syncFmt(el); }
  function fmtClick(el, k) {
    var s = cs(el), t = ta(el);
    if (k === 'close') { s.fmt = false; syncFmt(el); return; }
    if (k === 'prev') { s.prev = !s.prev; syncFmt(el); return; }
    Fmt.cmd(t, k); t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function syncHas(el) {
    var s = cs(el), t = ta(el); if (!t) return;
    comp(el).classList.toggle('has', !!(t.value.trim() || (s.att && s.att.done) || s.fwd));
  }
  // Только чтение или лимит «без ответа»: вместо поля — пояснение
  function sync(el) {
    var chat = chatOf(el); if (!chat) return;
    var n = B.msgs.note(chat), box = comp(el).querySelector('.ronote'), row = comp(el).querySelector('.crow');
    box.hidden = !n; box.classList.toggle('soft', !!(n && n.soft)); if (n) box.textContent = n.text;
    row.classList.toggle('off', B.msgs.locked(chat));
    if (B.msgs.locked(chat)) closePanel(el);
    secretBanner(el, chat);
  }
  // Скрытый чат без ключа на этом устройстве: вместо поля — «Расшифровать» с вводом кода от собеседника
  function secretBanner(el, chat) {
    var box = comp(el).querySelector('.scb'), cid = chat.id;
    if (!box) return;
    if (!B.secret.locked(cid)) { box.hidden = true; box.innerHTML = ''; return; }
    var secure = window.isSecureContext && !!(window.crypto && crypto.subtle), pending = window.SC && SC.pendingOf(cid), open = B.secret.bannerOpen === cid, h;
    var lock = '<span class="lk">' + ic('lock', 18, 2) + '</span>';
    if (!secure) h = lock + '<div class="tx"><b>Скрытые чаты работают только по HTTPS</b></div>';
    else if (pending) h = lock + '<div class="tx"><b>Код принят</b><span>Ждём подтверждения собеседника</span></div><button class="gh2" data-k="sccancel">Отменить</button>';
    else if (open) h = lock + '<div class="tx"><b>Введите код</b><span>Код назвал собеседник</span></div><input id="sc-code" placeholder="КОД" maxlength="12" autocomplete="off" autocapitalize="characters"><button data-k="scredeem">Подтвердить</button>';
    else h = lock + '<div class="tx"><b>Чат зашифрован</b><span>Сообщения видны после расшифровки</span></div><button data-k="scopen">Расшифровать</button>';
    box.innerHTML = h; box.hidden = false;
  }

  // ── полосы над полем ──
  function renderCtx(el) {
    var s = cs(el), box = comp(el).querySelector('.ctx'), h = '';
    var bar = function (icon, title, text, k) {
      return '<div class="cbar"><span class="ci2">' + ic(icon, 20, 2) + '</span><div class="cb"><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div><button class="xb" data-k="clr" data-w="' + k + '" aria-label="Убрать">' + ic('x', 13, 2.6) + '</button></div>';
    };
    if (s.reply) h += bar('reply', 'Ответ: ' + s.reply.senderName, s.reply.text, 'reply');
    if (s.fwd) h += bar('fwd', 'Переслано от ' + (s.fwd.name || ''), s.fwd.text || (s.fwd.attachment ? '📎 Вложение' : ''), 'fwd');
    if (s.edit) h += '<div class="cbar"><span class="ci2">' + ic('pencil', 20, 2) + '</span><div class="cb"><b>Редактирование</b></div><button class="xb" data-k="clr" data-w="edit" aria-label="Отменить">' + ic('x', 13, 2.6) + '</button></div>';
    if (s.att) {
      var a = s.att, d = a.data, thumb = ic(a.kind === 'Фото' ? 'photo' : 'doc', 20, 2);
      if (a.done && d && !d.enc) { var src = d.mime && d.mime.indexOf('image/') === 0 ? d.url : d.thumb; if (src) thumb = '<img src="' + esc(B.http() + '://' + B.S.server + src) + '" alt="">'; }
      h += '<div class="cbar"><span class="th">' + thumb + '</span><div class="cb" style="border:0;padding-left:0"><b>' + esc(a.done ? 'Вложение' : a.kind) + '</b><span>' + esc(a.done ? (d.name || 'Файл') : a.text) + '</span>' +
        (a.done ? '' : '<div class="trk' + (a.proc ? ' ind' : '') + '"><i style="width:' + a.pct + '%"></i></div>') + '</div><button class="xb" data-k="clr" data-w="att" aria-label="Убрать вложение">' + ic('x', 13, 2.6) + '</button></div>';
    }
    box.innerHTML = h; syncHas(el);
    var ph = comp(el).querySelector('.ph'); if (ph) ph.textContent = s.edit ? 'Изменить сообщение' : (B.S.secretChatIds.has(+el.dataset.cid) ? 'Скрытое сообщение' : 'Сообщение');
  }
  function clear(el, what) {
    var s = cs(el), t = ta(el);
    if (what === 'att') { B.upload.cancel(s.att && s.att.done ? s.att.data : null); s.att = null; }
    else if (what === 'edit') { s.edit = null; t.value = ''; B.drafts[+el.dataset.cid] = ''; autosize(t); s.lw.reset(); }
    else s[what] = null;
    renderCtx(el);
  }

  // ── вложение ──
  function attach(el, file) {
    var s = cs(el), a = s.att = { kind: 'Файл', text: 'Загрузка… 0%', pct: 0, done: false, proc: false, data: null };
    s.reply = s.reply; renderCtx(el);
    B.upload.pick(file, {
      onStart: function (k) { a.kind = k; renderCtx(el); },
      onPrepare: function (p) { if (s.att !== a) return; a.pct = p; a.text = 'Подготовка видео… ' + p + '%'; renderCtx(el); },
      onProgress: function (p) { if (s.att !== a) return; a.pct = p; a.text = 'Загрузка… ' + p + '%'; renderCtx(el); },
      onProcessing: function () { if (s.att !== a) return; a.proc = true; a.text = 'Обработка…'; renderCtx(el); },
      onDone: function (resp) { if (s.att !== a) return; a.done = true; a.data = resp; renderCtx(el); },
      onError: function (msg) { if (s.att === a) s.att = null; renderCtx(el); B.toast.show(msg); }
    }, { chatId: +el.dataset.cid });
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
    if (Date.now() / 1000 - m.sent_at > (B.S.editLimit || 120)) { B.toast.show('Время редактирования истекло'); return; }
    var s = cs(el), t = ta(el); s.edit = m.id; s.reply = null; if (s.att) clear(el, 'att');
    t.value = m.text || ''; autosize(t); renderCtx(el); Fmt.focusEnd(t); s.lw.load(m.link_preview || null, m.text || '');
  }
  function mention(el, id, name) {
    var t = ta(el); if (!t || !name || comp(el).querySelector('.crow.off')) return;
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
    if (s.att && !s.att.done) { B.toast.show('Дождитесь окончания загрузки'); return; }
    B.msgs.send({ text: text, reply: s.reply, attachment: s.att ? s.att.data : null, forward: s.fwd, linkPreview: s.lw.current() }).then(function (ok) {
      if (!ok) return;
      s.reply = s.fwd = s.att = null; t.value = ''; B.drafts[chat.id] = ''; autosize(t); renderCtx(el); closePanel(el); s.lw.reset(); closeFmt(el);
    });
  }
  function sendGif(el, att) {
    var s = cs(el); if (!att || !att.gif || s.edit) return;
    var t = ta(el), text = t.value.trim();     // текст из поля становится подписью к GIF
    B.msgs.send({ text: text, reply: s.reply, attachment: att }).then(function (ok) {
      if (ok) { s.reply = null; t.value = ''; B.drafts[+el.dataset.cid] = ''; autosize(t); renderCtx(el); closePanel(el); }
    });
  }

  // ── смайлы и GIF (разделы, вкладки и частые смайлы — в ui/emoji.js) ──
  function gifOn(el) { return !!(window.GifKlipy && GifKlipy.on()) && !cs(el).edit && !B.S.secretChatIds.has(+el.dataset.cid); }
  function renderPanel(el) {
    var s = cs(el), p = comp(el).querySelector('.epanel'), gif = s.mode === 'gif' && gifOn(el);
    comp(el).classList.toggle('gif', gif);
    var secs = B.emoji.sections();
    var top = gif ? '' : '<div class="ep-top"><div class="srch"><div class="sfield">' + ic('search', 16, 2.2) + '<input id="ep-q" type="search" placeholder="Поиск смайла" autocomplete="off" autocapitalize="none"></div></div><div class="ep-tabs">' + B.emoji.tabsHtml(secs) + '</div></div>';
    var body = gif ? '<div class="ep-gif"></div>' : '<div class="eg">' + B.emoji.gridHtml(secs, 'data-k="em"') + '</div>';
    // Переключатель всегда у левого края, подпись «Powered by» справа от него: так он не сдвигается при смене режима
    p.innerHTML = top + '<div class="ep-body">' + body + '</div><div class="ep-dock">' +
      (gifOn(el) ? '<div class="ep-sw"><button data-k="mode" data-m="emoji" aria-pressed="' + !gif + '">Смайлы</button><button data-k="mode" data-m="gif" aria-pressed="' + gif + '">GIF</button></div>' : '<span></span>') +
      '<div class="ep-r">' + (gif ? '<span class="ep-pw"><span>Powered by</span>' + GifKlipy.mark + '</span>' : '') +
      '<button class="ep-del" data-k="del" aria-label="Удалить символ">' + ic('bk', 24, 1.8) + '</button></div></div>';
    if (!gif) bindSearch(el, p);
    if (gif) { GifKlipy.setUser(B.S.server + ':' + B.S.user.id, 'ru'); GifKlipy.mount(p.querySelector('.ep-gif'), { onPick: function (att) { sendGif(el, att); } }); }
  }
  // Поиск смайлов сверху панели: пока идёт поиск, вкладки скрыты, а при открытой клавиатуре панель ужимается (класс esearch)
  function bindSearch(el, p) {
    var q = p.querySelector('#ep-q'), eg = p.querySelector('.eg'), tabs = p.querySelector('.ep-tabs'), c = comp(el), all = eg.innerHTML;
    B.emoji.bindTabs(eg, tabs, 0);
    q.addEventListener('focus', function () { c.classList.add('esearch'); });
    q.addEventListener('blur', function () { setTimeout(function () { c.classList.remove('esearch'); }, 120); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') q.blur(); });
    q.addEventListener('input', function () {
      var v = q.value.trim(); tabs.hidden = !!v;
      if (!v) { eg.innerHTML = all; eg.scrollTop = 0; eg.dispatchEvent(new Event('scroll')); return; }
      eg.innerHTML = B.emoji.resultsHtml(v, 'data-k="em"'); eg.scrollTop = 0;
    });
  }
  function openPanel(el) {
    var c = comp(el), s = cs(el); if (c.classList.contains('pnl')) return;
    B.kbd.hide(); renderPanel(el); s.panel = true; c.classList.add('pnl');
    c.querySelector('[data-k="emo"]').classList.add('on'); B.bus.emit('kbd:changed', {});
  }
  function closePanel(el) {
    var c = comp(el), s = cs(el); if (!c || !c.classList.contains('pnl')) return;
    s.panel = false; c.classList.remove('pnl', 'gif', 'esearch'); c.querySelector('[data-k="emo"]').classList.remove('on');
    setTimeout(function () { if (!s.panel) c.querySelector('.epanel').innerHTML = ''; }, 320);
  }
  // Смайл и удаление символа — по сохранённому выделению, без фокуса в поле: иначе над панелью всплыла бы клавиатура
  function insert(el, em) { Fmt.insertQuiet(ta(el), em); }
  function del(el) { Fmt.backspaceQuiet(ta(el)); }

  // Выбор файла как в прежней версии /m: скрепка — обычный div (не button), поле скрыто через display:none, а нажатие на
  // скрепку не гасится в mousedown: от нажатой button или погашенного mousedown iOS на миг рисует белый квадрат
  function pickFile(el) { comp(el).querySelector('input[type=file]').click(); }

  function onClick(el, e) {
    var fb = e.target.closest('.fbar [data-f]'); if (fb) { fmtClick(el, fb.dataset.f); return; }
    var b = e.target.closest('[data-k]'); if (!b) return; var k = b.dataset.k, s = cs(el);
    if (k === 'send') send(el);
    else if (k === 'scopen') { B.secret.bannerOpen = +el.dataset.cid; sync(el); var ci = comp(el).querySelector('#sc-code'); if (ci) ci.focus(); }
    else if (k === 'scredeem') { var code = (comp(el).querySelector('#sc-code').value || '').trim(); if (code) B.secret.redeem(+el.dataset.cid, code).then(function () { sync(el); }); }
    else if (k === 'sccancel') { B.secret.cancelSync(+el.dataset.cid); sync(el); }
    else if (k === 'up') { if (!B.msgs.locked(chatOf(el))) { var r = comp(el).querySelector('.crow'); r.classList.toggle('up'); } }
    else if (k === 'attach') { closeUp(el); if (!B.msgs.locked(chatOf(el))) pickFile(el); }
    else if (k === 'fmt') { closeUp(el); s.fmt = !s.fmt; syncFmt(el); if (s.fmt) ta(el).focus(); }
    else if (k === 'lpx') { s.lw.dismiss(); }
    else if (k === 'emo') { if (comp(el).classList.contains('pnl')) { ta(el).focus(); } else openPanel(el); }
    else if (k === 'clr') clear(el, b.dataset.w);
    else if (k === 'em') { B.emoji.track(b.dataset.e); insert(el, b.dataset.e); }
    else if (k === 'del') del(el);
    else if (k === 'mode') { s.mode = b.dataset.m; renderPanel(el); }
  }

  // Вставка файла (скриншот и т.п.) из буфера обмена
  document.addEventListener('paste', function (e) {
    var el = B.ui.chat && B.ui.chat.activePage(); if (!el || !el._cs) return;
    var f = Array.prototype.map.call((e.clipboardData && e.clipboardData.items) || [], function (i) { return i.kind === 'file' ? i.getAsFile() : null; }).filter(Boolean)[0];
    if (f && !B.msgs.locked(chatOf(el))) { e.preventDefault(); attach(el, f); }
  });
  B.bus.on('modules:changed', function () { var el = B.ui.chat && B.ui.chat.activePage(); if (el && el._cs && comp(el).classList.contains('pnl')) renderPanel(el); });
  B.bus.on('auth:logout', function () { B.drafts = {}; });
  B.bus.on('secret:ready', function (d) { var el = B.ui.chat && B.ui.chat.pageFor(d.chatId); if (el && el._cs) { sync(el); if (B.msgs.chatId === d.chatId) B.msgs.open(d.chatId); } });

  return { mount: mount, sync: sync, mention: mention, reply: reply, forward: forward, edit: startEdit, send: send };
})();
