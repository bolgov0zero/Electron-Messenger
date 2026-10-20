// /m — экран переписки по макету «Telegram»: шапка, лента сообщений, вложения, реакции, просмотр фото.
// Данные и сеть — в B.msgs (core/messages.js). Поле ввода (B.ui.composer) и меню сообщения (B.ui.msgmenu) подключаются отдельно.
B.ui = B.ui || {};
B.ui.chat = (function () {
  var esc = B.esc, ic = B.ic, S = B.S;
  var NC = ['#e17076', '#e8923c', '#8a6fe0', '#4fae3a', '#2fa8ab', '#3d8fd1', '#d9588f'];
  var GROUP_WINDOW = 60, SENTINEL_INDEX = 50;
  var away = {}, around = null, jumping = null, observer = null;

  // ── вспомогательное ──
  function nameColor(id, tag) {
    var t = (tag || '').trim().toLowerCase();
    if (!t) return NC[id % NC.length];
    var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return NC[h % NC.length];
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function mentions(escaped, chat) {
    var by = new Map();
    (chat.members || []).forEach(function (m) {
      var dn = esc(m.display_name || ''), un = esc(m.username || '');
      if (dn && !by.has(dn)) by.set(dn, m); if (un && !by.has(un)) by.set(un, m);
    });
    if (!by.size) return escaped;
    var names = Array.from(by.keys()).sort(function (a, b) { return b.length - a.length; }).map(escRe);
    return escaped.replace(new RegExp('@(' + names.join('|') + ')(?![\\wа-яёА-ЯЁ])', 'g'), '<span class="mn">@$1</span>');
  }
  function md(e) {   // `код`, **жирный**, __курсив__ — применяется к уже экранированному тексту
    return e.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<i>$1</i>');
  }
  function formatText(text, chat) {
    return text.split(/(https?:\/\/[^\s]+)/g).map(function (p, i) {
      return i % 2 === 1 ? '<a href="' + esc(p) + '" target="_blank" rel="noopener noreferrer">' + esc(p) + '</a>' : Fmt.spl(md(mentions(esc(p), chat)));
    }).join('');
  }
  B.fmt.msgText = formatText;
  var EMO_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s)+$/u;
  function emojiOnly(t) {
    t = (t || '').trim(); if (!t) return false;
    try { return EMO_RE.test(t) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(t); } catch (e) { return false; }
  }
  function fmtSize(b) { return !b ? '' : b < 1024 ? b + ' Б' : b < 1048576 ? Math.round(b / 1024) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ'; }
  function url(path) { return B.http() + '://' + B.S.server + path; }

  // ── вложения ──
  // mid и i — сообщение и номер вложения в нём: по ним просмотр собирает ленту фото и видео чата
  function attachment(att, mid, i) {
    if (!att) return '';
    var fileLine = function (icon, text) { return '<div class="file"><div class="fi">' + icon + '</div><div><b>' + text + '</b></div></div>'; };
    if (att.enc) {
      if (att._locked) return fileLine(ic('lock', 20, 2), 'Вложение');
      if ((att.mime || '').indexOf('image/') === 0) { var blob = B.S.scAttBlob.get(att._msgId); if (blob && B.secret.hasKey(att._chat)) return '<img class="att-img" src="' + esc(blob) + '" loading="lazy" data-c="lb" data-url="' + esc(blob) + '" data-type="image" alt="">'; return fileLine(ic('photo', 20, 2), 'Изображение'); }
      return '<div class="file" data-c="scsave" data-id="' + att._msgId + '"><div class="fi">' + ic('doc', 22, 1.8) + '</div><div><b>' + esc(att.name || 'Файл') + '</b><span>' + fmtSize(att.size) + '</span></div></div>';
    }
    if (att.unavailable) return fileLine(ic('x', 20, 2), att.unavailable === 'policy' ? 'Вложение недоступно: не соответствует настройкам сервера' : 'Вложение не удалось получить');
    if (att.gif) return window.GifKlipy ? GifKlipy.messageHtml(att) : '<div class="file"><div class="fi">GIF</div><div><b>GIF</b></div></div>';
    if (att.expired) return fileLine(ic('x', 20, 2), 'Файл удалён');
    var ratio = att.width && att.height ? 'aspect-ratio:' + att.width + '/' + att.height + ';' : '';
    var mime = att.mime || '';
    var ref = mid ? ' data-mid="' + mid + '" data-i="' + i + '"' : '';
    if (mime.indexOf('image/') === 0) return '<img class="att-img" src="' + esc(url(att.url)) + '" style="' + ratio + '" loading="lazy" data-c="lb" data-url="' + esc(att.url) + '" data-type="image"' + ref + ' alt="">';
    if (mime.indexOf('video/') === 0) {
      var poster = att.thumb ? '<img class="att-img" src="' + esc(url(att.thumb)) + '" style="' + ratio + '" loading="lazy" alt="">' : '<div class="vph"></div>';
      return '<div class="vwrap" data-c="lb" data-url="' + esc(att.url) + '" data-type="video"' + ref + '>' + poster + '<div class="vplay"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>';
    }
    return '<div class="file" data-c="' + (mid ? 'file' : 'dl') + '" data-url="' + esc(att.url) + '" data-name="' + esc(att.name || 'file') + '"' + ref + '><div class="fi">' + ic('doc', 22, 1.8) + '</div><div><b>' + esc(att.name || 'Файл') + '</b><span>' + fmtSize(att.size) + '</span></div></div>';
  }
  // Сообщение с несколькими вложениями: фото и видео сеткой, остальные файлы строками под ней
  function attachments(m) {
    var att = m.attachment; if (!att) return '';
    if (att.enc || att.gif || m._skel) return attachment(att, 0, 0);
    var all = B.media.listOf(att);
    if (all.length === 1) return attachment(att, m._optimistic ? 0 : m.id, 0);
    var media = [], files = [], mid = m._optimistic ? 0 : m.id;
    all.forEach(function (a, i) { (B.media.isMedia(a) ? media : files).push([a, i]); });
    var h = '';
    if (media.length === 1) h += attachment(media[0][0], mid, media[0][1]);
    else if (media.length) h += '<div class="agrid n' + Math.min(media.length, 7) + (media.length > 6 ? ' r' + (media.length % 3) : '') + '">' + media.map(function (x) {
      var a = x[0], v = /^video\//.test(a.mime || ''), src = a.thumb || (v ? '' : a.url);
      return '<div class="agt" data-c="lb"' + (mid ? ' data-mid="' + mid + '" data-i="' + x[1] + '"' : '') + ' data-url="' + esc(a.url) + '" data-type="' + (v ? 'video' : 'image') + '">' + (src ? '<img src="' + esc(url(src)) + '" loading="lazy" alt="">' : '<div class="vph"></div>') + (v ? '<div class="vplay"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' : '') + '</div>';
    }).join('') + '</div>';
    files.forEach(function (x) { h += attachment(x[0], mid, x[1]); });
    return h;
  }
  function reactions(m) {
    if (!m.reactions || !m.reactions.length) return '';
    return '<div class="rx">' + m.reactions.map(function (r) {
      var mine = String(r.user_ids || '').split(',').map(Number).indexOf(B.S.user.id) >= 0;
      return '<button class="' + (mine ? 'mine' : '') + '" data-c="react" data-id="' + m.id + '" data-e="' + esc(r.reaction) + '">' + esc(r.reaction) + '<b>' + r.count + '</b></button>';
    }).join('') + '</div>';
  }

  // ── сообщение из частей: превью ссылки, текст и блоки кода ──
  // Блок кода и карточка превью занимают пузырь во всю ширину; время и галочки стоят в конце последней части
  function compParts(ps, chat, meta) {
    if (!ps.length) return '<div class="txt ct">' + (meta || '') + '</div>';
    return ps.map(function (p, i) {
      var last = i === ps.length - 1;
      return p.k === 'c' ? Fmt.codeBlock(p.v, last ? (meta || true) : false) : '<div class="txt ct">' + formatText(p.v, chat || {}) + (last ? (meta || '') : '') + '</div>';
    }).join('');
  }
  function compOf(m) {
    var secret = B.S.secretChatIds.has(m.chat_id);
    var lp = (!secret && !m.sender_is_bot) ? (m.link_preview || null) : null;
    var ps = (!secret && !m._skel && !m.sender_is_bot && m.text) ? Fmt.parts(m.text) : [];
    var code = ps.some(function (p) { return p.k === 'c'; });
    return (lp || code) ? { lp: lp, ps: ps, code: code } : null;
  }
  // Для превью набранного в поле ввода: тот же пузырь без времени
  function previewBody(text, lp, chat) {
    var ps = Fmt.parts(text || '');
    return { cls: ' bcomp' + (ps.length === 1 && ps[0].k === 'c' && !lp ? ' conly' : ''), html: (lp ? Fmt.previewCard(lp, B.http() + '://' + B.S.server) : '') + compParts(ps, chat, '') };
  }

  // ── сообщение ──
  function bubble(m, chat, pos) {
    if (B.S.secretChatIds.has(m.chat_id)) m = B.secret.display(m);
    var mine = m.sender_id === B.S.user.id;
    if (m.sender_username === '__system__' && !m.deleted) return '<div class="sys" data-mid="' + m.id + '">' + esc(m.text) + '<i>' + B.fmt.time(m.sent_at) + '</i></div>';
    var groupish = chat && (chat.type === 'group' || chat.type === 'room');
    var wrapAv = groupish && !mine;
    var cls = 'mrow ' + (mine ? 'out' : 'in') + (pos.first ? ' first' : '') + (pos.last ? ' last' : '');
    var h = '<div class="' + cls + '" data-mid="' + m.id + '">';
    if (wrapAv) h += '<div class="mav">' + (pos.last ? B.avatar.user(m.sender_id, m.sender_name || '', 30, true) : '') + '</div>';
    h += '<div class="mcol">';
    if (m.deleted) return h + '<div class="bub dl"><span class="txt">Сообщение удалено</span></div></div></div>';
    var att = m.attachment, eo = !att && !m.reply_to_id && emojiOnly(m.text);
    var bare = !m.text && !m.reply_to_id && !m.forward_data && att && (att.gif || (att.url && !att.expired && (att.enc ? /^(image|video)\//.test(att.mime || '') : B.media.listOf(att).every(B.media.isMedia))));
    var fail = !!m._optimistic && m._state === 'failed';
    var meta = '<span class="meta">' + (m.edited_at ? 'изм. ' : '') + B.fmt.time(m.sent_at) + (mine ? (fail ? '<i class="er">!</i>' : m._optimistic ? '<i class="clk">' + ic('clock', 12, 2) + '</i>' : B.ticks(m.status)) : '') + '</span>';
    var comp = compOf(m);
    h += '<div class="bub' + (eo ? ' eo' : '') + (bare ? ' media' : '') + (bare && att.gif ? ' gifm' : '') + (comp ? ' bcomp' + (!comp.lp && comp.ps.length === 1 ? ' conly' : '') : '') + (fail ? ' fail' : '') + '" data-mid="' + m.id + '"' + (fail ? ' data-c="retry" data-cid="' + m._cid + '"' : '') + '>';
    if (wrapAv && pos.first) h += '<div class="who" style="color:' + nameColor(m.sender_id, m.sender_tag) + '" data-c="who" data-id="' + m.sender_id + '" data-name="' + esc(m.sender_name || '') + '">' + esc(m.sender_name || '') + '</div>';
    var qStart = h.length;
    if (m.reply_to_id) {
      // Цвет цитаты — по автору цитируемого сообщения (как в вебе и клиентах): своё — акцент, чужое — цвет этого человека
      var qc = m.reply_sender_id === B.S.user.id ? 'var(--accent)' : nameColor(m.reply_sender_id || 0, m.reply_sender_tag);
      h += '<div class="quote" style="--rc:' + qc + '"' + (m.reply_deleted ? '' : ' data-c="jump" data-id="' + m.reply_to_id + '"') + '><b>' + esc(m.reply_sender_name || '') + '</b><span>' + (m.reply_deleted ? 'Сообщение удалено' : esc(Fmt.noCode(m.reply_text || ''))) + '</span></div>';
    }
    var fd = m.forward_data;
    if (fd) {
      var fa = fd.attachment, ftxt = fd.text ? esc(fd.text) : fa ? ((fa.mime || '').indexOf('image/') === 0 ? '📷 Фото' : (fa.mime || '').indexOf('video/') === 0 ? '🎬 Видео' : '📎 ' + esc(fa.name || 'Файл')) : '';
      h += '<div class="quote"><b>Переслано от ' + esc(fd.name || '') + '</b><span>' + ftxt + '</span></div>';
    }
    if (comp) { var qs = h.slice(qStart); h = h.slice(0, qStart) + (comp.lp ? Fmt.previewCard(comp.lp, B.http() + '://' + B.S.server) : '') + (qs ? '<div class="cpad">' + qs + '</div>' : ''); }
    h += attachments(m);
    if (comp) h += compParts(comp.ps, chat, meta);
    else if (m._skel) h += '<div class="txt">' + m._skel + meta + '</div>';
    else if (m.text) h += '<div class="txt">' + (m.sender_is_bot ? m.text : formatText(m.text, chat || {})) + (bare ? '' : meta) + '</div>';
    else if (!bare) h += '<div class="txt" style="min-height:4px">' + meta + '</div>';
    if (bare) h += meta;
    h += '</div>' + reactions(m) + (fail ? '<div class="failnote" data-c="retry" data-cid="' + m._cid + '">Не отправлено · <b>Повторить</b></div>' : '') + '</div><span class="swi">' + ic('reply', 17, 2.2) + '</span></div>';
    return h;
  }
  function feed(chat, cache) {
    var M = B.msgs, h = '', lastDay = '', divIdx = M.unreadAtOpen > 0 && M.unreadAtOpen <= cache.length ? cache.length - M.unreadAtOpen : -1;
    if (!cache.length) return '<div class="stub-note">Сообщений пока нет</div>';
    cache.forEach(function (m, i) {
      var day = new Date(m.sent_at * 1000).toDateString();
      if (day !== lastDay) { if (lastDay) h += '</div>'; h += '<div class="day-group"><div class="day"><span>' + B.fmt.daySep(m.sent_at) + '</span></div>'; lastDay = day; }
      var same = function (o) { return !!o && o.sender_id === m.sender_id && Math.abs(o.sent_at - m.sent_at) < GROUP_WINDOW && new Date(o.sent_at * 1000).toDateString() === day && !(o.sender_username === '__system__') && !(m.sender_username === '__system__'); };
      if (i === divIdx) h += '<div class="unrd" id="unrd">Новые сообщения</div>';
      var first = !same(cache[i - 1]) || i === divIdx, last = !same(cache[i + 1]) || (i + 1) === divIdx;
      h += bubble(m, chat, { first: first, last: last });
    });
    if (lastDay) h += '</div>';
    return h;
  }

  // ── страница ──
  function pageFor(cid) { var s = B.nav.stack.find(function (x) { return x.el.dataset.cid == cid; }); return s && s.el; }
  function activePage() { var t = B.nav.top(); return t && t.el.dataset.cid ? t.el : null; }
  function othersUnread(cid) {
    return B.S.chats.filter(function (c) { return !c.parent_id && !c.muted && c.id !== cid; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0);
  }
  function statusOf(chat) {
    var ty = B.typing.names(chat.id);
    if (chat.type === 'direct') {
      if (ty.length) return { t: B.typing.label(ty, false), live: 1 };
      var p = B.peerId(chat), st = B.S.presence[p];
      return { t: p ? B.contacts.peerSub(p) : 'Личный чат', live: st === 'online' };
    }
    if (ty.length) return { t: B.typing.label(ty, true), live: 1 };
    if (chat.invite) return { t: 'Приглашение в ' + B.msgs.fedKind(chat) };
    if (B.msgs.fedOffline(chat)) return { t: 'Федеративная группа · нет связи', warn: 1 };
    var o = (B.S.chatOnline || {})[chat.id], cnt = o ? 'в сети ' + o.online + ' из ' + o.total : (chat.members ? chat.members.length : 0) + ' участников';
    return { t: chat.type === 'room' && !chat.parent_id ? 'Комната' + (o ? ' · ' + cnt : '') : cnt };
  }
  // Заглушки-пузыри вместо пустой страницы, пока сообщения чата ещё не загружены
  function skeleton() {
    return '<div class="sk"><i class="l w1"></i><i class="l w2"></i><i class="r w3"></i><i class="l w4"></i><i class="r w5"></i><i class="l w2"></i></div>';
  }
  function build(cid) {
    var chat = B.find(cid), el = document.createElement('div');
    el.className = 'page chat'; el.dataset.cid = cid; el._title = B.chatName(chat); el._inv = !!chat.invite;
    var n = othersUnread(cid), st = statusOf(chat);
    el.innerHTML =
      '<div class="wall"></div>' +
      '<div class="nav fix"><div class="nav-in">' +
        '<div class="nl"><button class="nb back" data-nav="back" aria-label="Назад">' + ic('back', 28, 2.4) + '<span class="cnt">' + (n ? (n > 99 ? '99+' : n) : '') + '</span></button></div>' +
        '<div class="nt"><div class="cn-b" data-c="info"><b>' + esc(B.chatName(chat)) + '</b><span class="st' + (st.live ? ' live' : '') + '">' + esc(st.t) + '</span></div></div>' +
        '<div class="nr"><button class="nb addc" data-c="addc" aria-label="Добавить в контакты" hidden>' + ic('userplus', 22, 1.9) + '</button><div class="cn-av" data-c="info">' + B.avatar.chat(chat, 36) + '</div></div></div></div>' +
      '<div class="cnbar" hidden></div>' +
      '<div class="scroll"><div class="msgs">' + (B.msgs.tail(cid) && !B.S.secretChatIds.has(cid) ? '' : skeleton()) + '</div></div>' +
      '<button class="sdbtn" data-c="down" aria-label="К последним сообщениям">' + ic('down', 20, 2.4) + '<b></b></button>' +
      '<div class="bottom comp"></div>';
    B.avatar.apply(el);
    if (B.ui.composer) B.ui.composer.mount(el, chat);
    el.querySelector('.scroll').addEventListener('scroll', function () { onScroll(el); }, { passive: true });
    el.addEventListener('click', function (e) { onClick(el, e); });
    bindGestures(el);
    var comp = el.querySelector('.comp');
    try { new ResizeObserver(function () { var sc = el.querySelector('.scroll'), stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140; el.style.setProperty('--compH', comp.offsetHeight + 'px'); if (stick) sc.scrollTop = sc.scrollHeight; }).observe(comp); } catch (e) {}
    return el;
  }
  function updateHeader(el) {
    var chat = B.find(+el.dataset.cid); if (!chat) return;
    var st = statusOf(chat), s = el.querySelector('.st');
    if (s) { s.textContent = st.t; s.classList.toggle('live', !!st.live); s.classList.toggle('warn', !!st.warn); }
    var tr = el.querySelector('.tpr'), names = B.typing.names(chat.id);
    if (tr) { tr.classList.toggle('show', names.length > 0); if (names.length) tr.querySelector('.tpt').textContent = B.typing.label(names, true); }
    var b = el.querySelector('.cn-b b'); if (b) b.textContent = B.chatName(chat);
    var n = othersUnread(chat.id), c = el.querySelector('.back .cnt'); if (c) c.textContent = n ? (n > 99 ? '99+' : n) : '';
    var cb = el.querySelector('.cnbar'), cst = B.conn.state;
    if (cb) { cb.hidden = cst === 'ok'; cb.className = 'cnbar ' + cst; cb.innerHTML = cst === 'offline' ? ic('wifioff', 14, 2.2) + 'Нет связи с сервером' : '<i class="cspin"></i>Подключение…'; }
    var ab = el.querySelector('.addc'), pid = chat.type === 'direct' ? B.peerId(chat) : null; if (ab) ab.hidden = !(pid && B.contacts.needsContact(pid));
  }

  // ── прокрутка ──
  function render(el, mode) {
    var sc = el.querySelector('.scroll'), box = el.querySelector('.msgs'), chat = B.find(+el.dataset.cid); if (!chat) return;
    var prevH = sc.scrollHeight, prevTop = sc.scrollTop, stick = mode === 'smart' && (prevH - prevTop - sc.clientHeight < 120);
    box.innerHTML = feed(chat, B.msgs.cache);
    if (mode === 'keep') {
      // Инерция iOS «дотягивает» список к нулю после нашего скачка — коротко отключаем прокрутку, чтобы подгрузка не сработала повторно
      sc.style.overflowY = 'hidden'; sc.scrollTop = prevTop + (sc.scrollHeight - prevH); void sc.offsetHeight; sc.style.overflowY = '';
    } else if (mode === 'smart') sc.scrollTop = stick ? sc.scrollHeight : prevTop;
    else if (mode !== 'none') sc.scrollTop = sc.scrollHeight;
    B.avatar.apply(box); stickAfterMedia(sc); setupSentinel(el); onScroll(el);
    return stick;
  }
  function stickAfterMedia(sc) {
    // Картинка получает высоту уже после раскладки: компенсируем именно сдвиг высоты, а не прыгаем в самый низ
    var pending = Array.prototype.filter.call(sc.querySelectorAll('img'), function (i) { return !i.complete; });
    if (!pending.length) return;
    var last = sc.scrollHeight;
    var onLoad = function () { setTimeout(function () { var now = sc.scrollHeight, d = now - last; if (d) sc.scrollTop += d; last = now; }, 0); };
    pending.forEach(function (i) { i.addEventListener('load', onLoad, { once: true }); i.addEventListener('error', onLoad, { once: true }); });
  }
  function setupSentinel(el) {
    if (observer) observer.disconnect();
    if (!B.msgs.hasMoreOlder) return;
    var m = B.msgs.cache[SENTINEL_INDEX]; if (!m) return;
    var t = el.querySelector('[data-mid="' + m.id + '"]'); if (!t) return;
    observer = new IntersectionObserver(function (en) { if (!jumping && en[0].isIntersecting) B.msgs.loadOlder(); }, { root: el.querySelector('.scroll') });
    observer.observe(t);
  }
  function onScroll(el) {
    var sc = el.querySelector('.scroll'), btn = el.querySelector('.sdbtn'), cid = +el.dataset.cid;
    var off = sc.scrollHeight - sc.scrollTop - sc.clientHeight > 200;
    btn.classList.toggle('on', off);
    if (!off && away[cid]) { away[cid] = 0; badge(el); }
  }
  function badge(el) { var b = el.querySelector('.sdbtn b'), n = away[+el.dataset.cid] || 0; b.textContent = n > 99 ? '99+' : n || ''; b.classList.toggle('on', n > 0); }
  // Своя анимация вместо scrollTo smooth: любая посторонняя запись в scrollTop обрывает родную, а здесь цель пересчитывается на каждом кадре
  function toBottom(el) {
    var sc = el.querySelector('.scroll'); away[+el.dataset.cid] = 0; badge(el);
    cancelAnimationFrame(jumping);
    var step = function () {
      var target = sc.scrollHeight - sc.clientHeight, dist = target - sc.scrollTop;
      if (dist <= 1) { sc.scrollTop = target; jumping = null; return; }
      sc.scrollTop += Math.max(dist * 0.22, 24); jumping = requestAnimationFrame(step);
    };
    jumping = requestAnimationFrame(step);
  }
  function flash(row) {
    var b = row && row.querySelector('.bub'); if (!b) return;
    b.classList.remove('bubble-flash'); void b.offsetWidth; b.classList.add('bubble-flash');
    clearTimeout(b._flashT); b._flashT = setTimeout(function () { b.classList.remove('bubble-flash'); }, 1900);
  }
  function jump(el, id) {
    var row = el.querySelector('.mrow[data-mid="' + id + '"]');
    if (!row) { B.msgs.open(+el.dataset.cid, id); return; }   // сообщение глубоко в истории: открываем окно вокруг него
    row.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(row);
  }


  // ── жесты по сообщению: долгое нажатие — меню, свайп влево — ответ ──
  function bindGestures(el) {
    var box = el.querySelector('.msgs'), G = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var row = e.target.closest('.mrow'); if (!row || e.target.closest('input,textarea,[contenteditable]')) return;
      if (e.clientX - el.getBoundingClientRect().left < 24) return;          // у левого края — свайп «назад»
      var bub = e.target.closest('.bub');
      G = { id: e.pointerId, x: e.clientX, y: e.clientY, row: row, mode: null, tx: 0 };
      if (bub) G.lp = setTimeout(function () { if (G && !G.mode) { G.mode = 'lp'; B.ui.msgmenu.open(el, row, bub); } }, 420);
    });
    box.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = e.clientX - G.x, dy = e.clientY - G.y;
      if (!G.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; clearTimeout(G.lp);
        if (dx < 0 && Math.abs(dx) > Math.abs(dy) && G.row.querySelector('.swi')) { G.mode = 'swipe'; G.row.classList.add('dg'); try { box.setPointerCapture(e.pointerId); } catch (_) {} if (B.kbd.h) B.kbd.hide(); }
        else { G = null; return; }
      }
      if (G.mode !== 'swipe') return;
      G.tx = Math.max(dx, -90); G.row.style.transform = 'translateX(' + G.tx + 'px)';
      var i = G.row.querySelector('.swi'), armed = G.tx <= -60;
      i.style.opacity = Math.min(1, Math.abs(G.tx) / 55); i.style.background = armed ? 'var(--accent)' : ''; i.style.color = armed ? '#fff' : '';
      if (armed && !G.armed) { try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} } G.armed = armed;
    });
    var end = function (e, cancelled) {
      if (!G || e.pointerId !== G.id) return; clearTimeout(G.lp); var g = G; G = null;
      if (g.mode !== 'swipe') return;
      var i = g.row.querySelector('.swi'); g.row.classList.remove('dg'); g.row.style.transform = ''; i.style.opacity = 0; i.style.background = ''; i.style.color = '';
      if (!cancelled && g.tx <= -60) { var m = B.msgs.find(+g.row.dataset.mid), chat = B.find(+el.dataset.cid); if (m && !m.deleted && !B.msgs.locked(chat)) B.ui.composer.reply(el, m); }
    };
    box.addEventListener('pointerup', function (e) { end(e, false); });
    box.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  // ── события ──
  function onClick(el, e) {
    if (Fmt.copyClick(e)) return;                               // «Копировать» в шапке блока кода
    var lc = e.target.closest('.lcard[data-fmt-url]');
    if (lc) { window.open(lc.dataset.fmtUrl, '_blank', 'noopener,noreferrer'); return; }
    var t = e.target.closest('[data-c]'); if (!t) return;
    var c = t.dataset.c;
    if (c === 'lb') { if (t.dataset.mid) B.media.openMsg(+t.dataset.mid, +t.dataset.i); else B.lightbox.open(t.dataset.url, t.dataset.type); }
    else if (c === 'file') B.media.openFile(+t.dataset.mid, +t.dataset.i);
    else if (c === 'retry') { var cid = t.dataset.cid; B.actions.show({ title: 'Сообщение не отправлено', msg: 'Оно останется в очереди и уйдёт само, когда появится связь.', items: [{ l: 'Повторить отправку', f: function () { B.msgs.retry(cid); } }, { l: 'Удалить', d: 1, f: function () { B.msgs.discard(cid); } }] }); }
    else if (c === 'dl') download(t.dataset.url, t.dataset.name);
    else if (c === 'jump') jump(el, +t.dataset.id);
    else if (c === 'react') B.msgs.react(+t.dataset.id, t.dataset.e);
    else if (c === 'down') toBottom(el);
    else if (c === 'scsave') B.secret.saveAtt(+t.dataset.id);
    else if (c === 'addc') { var pid = B.peerId(B.find(+el.dataset.cid)); if (pid && B.openAddFromChat) B.openAddFromChat(pid); }
    else if (c === 'who') { if (B.ui.composer && B.ui.composer.mention) B.ui.composer.mention(el, +t.dataset.id, t.dataset.name); }
    else if (c === 'info') info(+el.dataset.cid);
  }
  function download(path, name) {
    var a = document.createElement('a'); a.href = url(path); a.download = name; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function info(cid) {
    var chat = B.find(cid); if (!chat) return;
    if (chat.type === 'direct' && B.openProfile) B.openProfile(B.peerId(chat));
    else if (B.openGroupProfile) B.openGroupProfile(chat.parent_id || cid);
    else if (B.openMembers) B.openMembers(cid);
  }

  function opened(el, d) {
    var hadPreview = el._preview; el._preview = false;
    render(el, 'none');
    var sc = el.querySelector('.scroll');
    if (d.aroundId) {
      var row = el.querySelector('.mrow[data-mid="' + d.aroundId + '"]');
      if (row) { row.scrollIntoView({ block: 'center' }); setTimeout(function () { flash(row); }, 320); } else sc.scrollTop = sc.scrollHeight;
    } else {
      var u = el.querySelector('#unrd');
      if (u) sc.scrollTop = Math.max(0, u.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - el.querySelector('.nav').offsetHeight - 8);
      else sc.scrollTop = sc.scrollHeight;
    }
    updateHeader(el); onScroll(el);
    if (B.ui.composer && B.ui.composer.sync) B.ui.composer.sync(el);
    if (el._t0 && !hadPreview) el.querySelector('.msgs').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });   // сообщения проявляются, а не выпрыгивают
  }
  // Лёгкая первая отрисовка: последние сообщения из кэша показываются сразу, пока страница выезжает и идёт запрос
  B.bus.on('msgs:preview', function (d) {
    var el = pageFor(d.chatId); if (!el) return;
    el._preview = true;
    render(el, 'bottom');
    updateHeader(el);
  });
  B.bus.on('msgs:opened', function (d) {
    var el = pageFor(d.chatId); if (!el) return;
    // Страница ещё выезжает справа: сотни пузырей, отрисованные посреди выезда, рвут анимацию на телефоне.
    // Ждём конца выезда (около 0,4 с), пока на странице «Загрузка…»
    var wait = el._t0 ? 400 - (performance.now() - el._t0) : 0;
    if (wait > 40) { setTimeout(function () { if (el.isConnected) opened(el, d); }, wait); return; }
    opened(el, d);
  });
  B.bus.on('msgs:older', function () { var el = activePage(); if (el) render(el, 'keep'); });
  B.bus.on('msgs:changed', function (d) { var el = activePage(); if (el && +el.dataset.cid === B.msgs.chatId) render(el, d && d.mode === 'bottom' ? undefined : (d && d.mode) || 'smart'); });
  B.bus.on('msgs:new', function (d) {
    var el = activePage(); if (!el || d.mine) return;
    var sc = el.querySelector('.scroll');
    if (sc.scrollHeight - sc.scrollTop - sc.clientHeight > 200) { var cid = +el.dataset.cid; away[cid] = (away[cid] || 0) + 1; badge(el); }
  });
  // «Печатает»: подпись в шапке и строка над полем ввода. Строка входит в высоту полосы ввода, лента отступает на неё и сообщения не закрыты
  B.bus.on('typing:changed', function (d) { refreshTyping(d.chatId); });
  function refreshTyping(cid) {
    var el = pageFor(cid); if (!el) return;
    updateHeader(el);
  }
  // Клавиатура или панель смайлов сдвинули поле ввода: держим ленту у низа, если она там и была
  B.bus.on('kbd:changed', function () { var el = activePage(); if (!el) return; var sc = el.querySelector('.scroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 400) setTimeout(function () { sc.scrollTop = sc.scrollHeight; }, 60); });
  B.bus.on('presence:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('conn:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('chats:changed', function () {
    var el = activePage(); if (!el) return;
    updateHeader(el);
    var chat = B.find(+el.dataset.cid);
    // Приглашение приняли: открываем историю; связь с сервером группы появилась или пропала — меняется поле ввода
    if (chat && el._inv && !chat.invite) { el._inv = false; B.msgs.open(chat.id); }
    if (chat && B.ui.composer && B.ui.composer.sync) B.ui.composer.sync(el);
  });
  B.bus.on('chat:online', function (d) { var el = pageFor(d.chatId); if (el) updateHeader(el); });
  B.bus.on('contacts:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('chat:updated', function (d) { var el = pageFor(d.chatId); if (el) { updateHeader(el); if (B.ui.composer && B.ui.composer.sync) B.ui.composer.sync(el); } });
  B.bus.on('chat:deleted', function (d) { var el = pageFor(d.chatId); if (el && B.nav.top().el === el) B.nav.pop(); });
  // Страница чата ушла или вернулась на верх стека — переключаем активный чат ядра
  B.bus.on('nav:changed', function () {
    var t = B.nav.top(), cid = t && t.el.dataset.cid;
    if (cid) { if (B.msgs.chatId !== +cid) { var a = around; around = null; B.msgs.open(+cid, a || undefined); } }
    else if (B.msgs.chatId != null) B.msgs.close();
  });
  // Баннер о новом сообщении в другом чате, пока приложение открыто
  B.bus.on('ws:message', function (d) {
    var m = d.message, chat = B.find(m.chat_id);
    if (!chat || m.sender_id === B.S.user.id || chat.muted || m.chat_id === B.S.activeChatId || document.hidden || chat.parent_id) return;
    var txt = m.text ? Fmt.plain(m.text).replace(/<[^>]*>/g, '') : m.attachment ? '📎 Вложение' : '';
    B.toast.banner(B.avatar.chat(chat, 36) + '<div class="tt"><b>' + esc(B.chatName(chat)) + '</b><span>' + esc(txt.slice(0, 80)) + '</span></div>', function () { B.openChat(chat.id); });
  });

  function open(chatId, aroundId) {
    var chat = B.find(chatId); if (!chat) return;
    var top = B.nav.top();
    if (top && top.el.dataset.cid == chatId) { if (aroundId) B.msgs.open(chatId, aroundId); return; }
    around = aroundId || null;
    B.nav.push(build(chatId), B.chatName(chat));
  }
  return { open: open, render: render, activePage: activePage, pageFor: pageFor, nameColor: nameColor, toBottom: toBottom, previewBody: previewBody };
})();

// Открытие чата из списка, баннера и поиска: комнаты с темами — отдельный список (этап 8)
B.openChat = function (id, msgId) {
  var c = B.find(id); if (!c) return;
  if (c.has_topics) { if (B.ui.topics) B.ui.topics.open(id); else B.toast.show('Темы комнаты — на этапе 8'); return; }
  B.ui.chat.open(id, msgId);
};
