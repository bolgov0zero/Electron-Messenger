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
  // Место под картинку резервируется сразу, до загрузки файла: ширина и пропорции известны заранее, поэтому кадр при загрузке
  // не меняет высоту и лента не дёргается. Если размера нет (старые вложения), ставим заглушку 4:3 и один раз уточняем после
  // загрузки, запоминая пропорции по адресу
  var IMGW = 'min(280px,calc(80vw - 24px))', _isz = null;
  function szMap() { if (!_isz) { try { _isz = JSON.parse(localStorage.getItem('m.imgsz') || '{}'); } catch (e) { _isz = {}; } } return _isz; }
  function szRemember(u, r) {
    var m = szMap(), k = Object.keys(m); if (m[u] === r) return;
    if (k.length > 600) k.slice(0, 200).forEach(function (x) { delete m[x]; });
    m[u] = r; clearTimeout(szRemember._t); szRemember._t = setTimeout(function () { try { localStorage.setItem('m.imgsz', JSON.stringify(m)); } catch (e) {} }, 1500);
  }
  // Для ленты берётся превью 720 px (/fp/имя), а не оригинал в несколько МБ: оригинал открывается только в просмотре. GIF остаются как есть
  function feedSrc(att) {
    if (att.preview) return att.preview;
    var m = /^\/files\/([\w.\-]+\.(?:jpe?g|png|webp))$/i.exec(att.url || '');
    return m && !/^enc_/.test(m[1]) && (att.mime || '').indexOf('image/gif') < 0 ? '/fp/' + m[1] : att.url;
  }
  function imgBox(att) {
    if (att.width && att.height) return { st: 'width:min(' + Math.min(280, att.width) + 'px,calc(80vw - 24px));aspect-ratio:' + att.width + '/' + att.height + ';min-width:0;', ns: '' };
    var c = szMap()[att.url];
    return c ? { st: 'width:' + IMGW + ';aspect-ratio:' + c + ';min-width:0;', ns: '' } : { st: 'width:' + IMGW + ';aspect-ratio:4/3;min-width:0;', ns: ' data-ns="1"' };
  }
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
    var box = imgBox(att), mime = att.mime || '';
    var ref = mid ? ' data-mid="' + mid + '" data-i="' + i + '"' : '';
    if (mime.indexOf('image/') === 0) return '<img class="att-img" src="' + esc(url(feedSrc(att))) + '" style="' + box.st + '" loading="lazy" decoding="async" data-c="lb" data-url="' + esc(att.url) + '" data-type="image"' + box.ns + ref + ' alt="">';
    if (mime.indexOf('video/') === 0) {
      var poster = att.thumb ? '<img class="att-img" src="' + esc(url(att.thumb)) + '" style="' + box.st + '" loading="lazy" decoding="async" data-url="' + esc(att.thumb) + '"' + box.ns + ' alt="">' : '<div class="vph" style="width:' + IMGW + '"></div>';
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
    // Сначала отметка «переслали N раз», затем галки прочтения, затем время (как в остальных клиентах)
    var fwn = Number(m.forward_count) || 0;
    var meta = '<span class="meta">' + (fwn > 0 ? '<span class="fwd" data-c="fwd" data-n="' + fwn + '">' + ic('fwd', 12, 2.4) + fwn + '</span>' : '') +
      (mine ? (fail ? '<i class="er">!</i>' : m._optimistic ? '<i class="clk">' + ic('clock', 12, 2) + '</i>' : B.ticks(m.status)) : '') + (m.edited_at ? 'изм. ' : '') + B.fmt.time(m.sent_at) + '</span>';
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
      var flb = fa && fa.url && !fa.expired && !fa.unavailable && ((fa.mime || '').indexOf('image/') === 0 || (fa.mime || '').indexOf('video/') === 0) ? ' data-c="lb" data-url="' + esc(fa.url) + '" data-type="' + ((fa.mime || '').indexOf('video/') === 0 ? 'video' : 'image') + '" style="cursor:pointer"' : '';
      h += '<div class="quote"' + flb + '><b>Переслано от ' + esc(fd.name || '') + '</b><span>' + ftxt + '</span></div>';
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
  // Лента как список дней, в каждом — разметка элементов с ключами: по ключу и тексту разметки DOM сверяется с прошлым состоянием
  function feedGroups(chat, cache) {
    var M = B.msgs, groups = [], cur = null, divIdx = M.unreadFromId ? cache.findIndex(function (x) { return x.id === M.unreadFromId; }) : -1;
    if (!cache.length) return null;
    cache.forEach(function (m, i) {
      var day = new Date(m.sent_at * 1000).toDateString();
      if (!cur || cur.day !== day) { cur = { day: day, items: [{ key: 'd', html: '<div class="day"><span>' + B.fmt.daySep(m.sent_at) + '</span></div>' }] }; groups.push(cur); }
      var same = function (o) { return !!o && o.sender_id === m.sender_id && Math.abs(o.sent_at - m.sent_at) < GROUP_WINDOW && new Date(o.sent_at * 1000).toDateString() === day && !(o.sender_username === '__system__') && !(m.sender_username === '__system__'); };
      if (i === divIdx) cur.items.push({ key: 'u', html: '<div class="unrd" id="unrd">Новые сообщения</div>' });
      var first = !same(cache[i - 1]) || i === divIdx, last = !same(cache[i + 1]) || (i + 1) === divIdx;
      cur.items.push({ key: 'm' + (m._cid || m.id), html: bubble(m, chat, { first: first, last: last }) });
    });
    return groups;
  }
  function make(html) { var t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; }
  function place(parent, el, prev) { var ref = prev ? prev.nextSibling : parent.firstChild; if (el !== ref) parent.insertBefore(el, ref); }
  // Не пересоздаёт то, что не изменилось: картинки остаются загруженными, ничего не мигает и не меняет высоту
  function syncItems(parent, items) {
    var have = {}, prev = null;
    Array.prototype.forEach.call(parent.children, function (c) { if (c._k) have[c._k] = c; });
    items.forEach(function (it) {
      var el = have[it.key]; delete have[it.key];
      if (!el || el._h !== it.html) {
        var n = make(it.html); n._k = it.key; n._h = it.html; B.avatar.apply(n);
        if (el) parent.replaceChild(n, el);
        el = n;
      }
      place(parent, el, prev); prev = el;
    });
    Object.keys(have).forEach(function (k) { have[k].remove(); });
  }
  function reconcile(box, groups) {
    var have = {}, prev = null;
    Array.prototype.slice.call(box.children).forEach(function (g) { if (g.dataset && g.dataset.day) have[g.dataset.day] = g; else g.remove(); });
    groups.forEach(function (g) {
      var el = have[g.day]; delete have[g.day];
      if (!el) { el = document.createElement('div'); el.className = 'day-group'; el.dataset.day = g.day; }
      place(box, el, prev); syncItems(el, g.items); prev = el;
    });
    Object.keys(have).forEach(function (k) { have[k].remove(); });
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
    var scr = el.querySelector('.scroll');
    scr.addEventListener('scroll', function () { el._sa = performance.now(); onScroll(el); }, { passive: true });
    scr.addEventListener('touchstart', function () { el._touch = 1; }, { passive: true });
    ['touchend', 'touchcancel'].forEach(function (t) { scr.addEventListener(t, function () { el._touch = 0; el._sa = performance.now(); }, { passive: true }); });
    el.addEventListener('click', function (e) { onClick(el, e); });
    bindGestures(el);
    var comp = el.querySelector('.comp');
    // Высота поля ввода меняется (строка «печатает», ответ, несколько строк): отступ ленты обновляется сразу, а у низа лента
    // остаётся внизу одной записью после того, как высота установилась, и только если её не листают
    var roStick = null, roT = 0;
    try { new ResizeObserver(function () {
      var sc = el.querySelector('.scroll'); if (roStick === null) roStick = nearBottom(sc, 140);
      el.style.setProperty('--compH', comp.offsetHeight + 'px');
      clearTimeout(roT); roT = setTimeout(function () { var st = roStick; roStick = null; if (st && !busy(el)) sc.scrollTop = sc.scrollHeight; }, 60);
    }).observe(comp); } catch (e) {}
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
    // Точка статуса на аватарке в шапке рисуется один раз при открытии: перерисовываем её, когда статус собеседника изменился
    var pid0 = chat.type === 'direct' ? B.peerId(chat) : 0, sig = pid0 ? (B.S.presence[pid0] || 'offline') + (B.S.presenceMobile && B.S.presenceMobile[pid0] ? 'm' : '') : '';
    if (pid0 && el._pSig !== sig) { if (el._pSig !== undefined) { var av = el.querySelector('.cn-av'); if (av) { av.innerHTML = B.avatar.chat(chat, 36); B.avatar.apply(av); } } el._pSig = sig; }
    var cb = el.querySelector('.cnbar'), cst = B.conn.state;
    if (cb) { cb.hidden = cst === 'ok'; cb.className = 'cnbar ' + cst; cb.innerHTML = cst === 'offline' ? ic('wifioff', 14, 2.2) + 'Нет связи с сервером' : '<i class="cspin"></i>Подключение…'; }
    var ab = el.querySelector('.addc'), pid = chat.type === 'direct' ? B.peerId(chat) : null; if (ab) ab.hidden = !(pid && B.contacts.needsContact(pid));
  }

  // ── прокрутка ──
  // Пока палец на экране или идёт инерция (события прокрутки ещё приходят), ленту не трогаем: запись scrollTop в этот момент
  // обрывает инерцию и даёт рывок. Фоновые обновления (галочки, реакции, правки, чужие сообщения) ждут конца прокрутки
  function busy(el) { return !!el._touch || performance.now() - (el._sa || 0) < 150; }
  function nearBottom(sc, px) { return sc.scrollHeight - sc.scrollTop - sc.clientHeight < px; }
  // Опорное сообщение: первое, что видно у верхнего края. После перестройки возвращаем его на то же место, а не держим scrollTop
  function anchorGet(sc) {
    var rows = sc.querySelectorAll('.mrow[data-mid]'), top = sc.getBoundingClientRect().top, lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (rows[mid].getBoundingClientRect().bottom > top + 1) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    return ans < 0 ? null : { el: rows[ans], y: rows[ans].getBoundingClientRect().top - top };
  }
  function anchorSet(sc, a) {
    if (!a || !a.el.isConnected) return;
    var d = a.el.getBoundingClientRect().top - sc.getBoundingClientRect().top - a.y;
    if (Math.abs(d) > 0.5) sc.scrollTop += d;
  }
  function renderLater(el, mode) {
    el._rq = el._rq === 'keep' ? 'keep' : mode;
    if (el._rqT) return;
    el._rqT = setTimeout(function run() {
      if (!el.isConnected) { el._rqT = 0; return; }
      if (busy(el)) { el._rqT = setTimeout(run, 120); return; }
      el._rqT = 0; var m = el._rq; el._rq = null; render(el, m);
    }, 150);
  }
  function render(el, mode) {
    var sc = el.querySelector('.scroll'), box = el.querySelector('.msgs'), chat = B.find(+el.dataset.cid); if (!chat) return;
    if (mode === 'smart' && busy(el)) { renderLater(el, mode); return; }
    var stick = mode === 'smart' && nearBottom(sc, 120), anc = (mode === 'smart' || mode === 'keep') && !stick ? anchorGet(sc) : null;
    var groups = feedGroups(chat, B.msgs.cache);
    if (!groups) { box.innerHTML = '<div class="stub-note">Сообщений пока нет</div>'; } else reconcile(box, groups);
    if (mode === 'smart' || mode === 'keep') { if (stick) sc.scrollTop = sc.scrollHeight; else anchorSet(sc, anc); }
    else if (mode !== 'none') sc.scrollTop = sc.scrollHeight;
    trackImages(sc); setupSentinel(el); onScroll(el);
    return stick;
  }
  // Картинка без известных размеров (старое вложение) получает пропорции после загрузки. Если она выше видимой области, держим то,
  // что читают; если стояли у самого низа, остаёмся внизу. Картинки с известным размером ничего не сдвигают
  function trackImages(sc) {
    Array.prototype.forEach.call(sc.querySelectorAll('img[data-ns]:not([data-tr])'), function (img) {
      img.setAttribute('data-tr', '1');
      var done = function () {
        if (!img.naturalWidth || !img.isConnected) return;
        var h0 = img.offsetHeight, r = img.naturalWidth + '/' + img.naturalHeight;
        szRemember(img.getAttribute('data-url') || img.getAttribute('src'), r);
        img.style.aspectRatio = r; img.removeAttribute('data-ns');
        var d = img.offsetHeight - h0; if (!d) return;
        var wasBottom = sc.scrollHeight - d - sc.scrollTop - sc.clientHeight < 6;
        if (wasBottom) sc.scrollTop = sc.scrollHeight;
        else if (img.getBoundingClientRect().bottom - d <= sc.getBoundingClientRect().top + 1) sc.scrollTop += d;
      };
      if (img.complete) done(); else img.addEventListener('load', done, { once: true });
    });
  }
  // Лента не должна расти без конца: если ушли далеко вниз и стоим у конца, давние сообщения выпадают из окна (они подгрузятся снова)
  function trim(el) {
    var M = B.msgs, sc = el.querySelector('.scroll');
    if (M.cache.length <= 400 || !nearBottom(sc, 500) || busy(el) || jumping) return;
    M.cache = M.cache.slice(-250); M.hasMoreOlder = true; render(el, 'smart');
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
    clearTimeout(el._idleT); el._idleT = setTimeout(function () { if (el.isConnected) trim(el); }, 400);
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
    else if (c === 'fwd') { var n = +t.dataset.n, a = n % 10, b = n % 100; B.toast.show('Сообщение переслали ' + n + (a === 1 && b !== 11 ? ' раз' : (a >= 2 && a <= 4 && (b < 12 || b > 14) ? ' раза' : ' раз'))); }
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
