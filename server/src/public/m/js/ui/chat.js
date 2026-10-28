// /m — экран переписки по макету: шапка со «стеклянной» капсулой собеседника, лента сообщений по дням, пузыри, вложения, реакции,
// панель закрепа, кнопка «вниз». Данные и сеть — в B.msgs (core/messages.js); поле ввода — B.ui.composer, меню сообщения — B.ui.msgmenu.
B.ui = B.ui || {};
B.ui.chat = (function () {
  var S = B.S, esc = B.esc;
  var GROUP_WINDOW = 60;
  var away = {}, around = null, jumping = null, pinIdx = {}, readSent = {};

  // ── вспомогательное ──
  // Цвет имени: пять оттенков из токенов темы (--tag-1…5), выбор — по тегу человека или его id
  function nameColor(id, tag) {
    var t = (tag || '').trim().toLowerCase(), n;
    if (!t) n = id % 5; else { var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } n = h % 5; }
    return 'rgb(var(--tag-' + (n + 1) + '))';
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
  // Обложки видео держатся в памяти (до 80 штук; они маленькие, 320 px): страница чата при повторном открытии строится заново, и без этого обложка, уже лежавшая в кэше,
  // снова проходила путь «пусто → загрузка → показ». Объект Image с тем же адресом оставляет декодированную картинку в памяти браузера
  var kept = new Map();
  function keep(u) {
    if (!u) return u;
    if (kept.has(u)) { var i0 = kept.get(u); kept.delete(u); kept.set(u, i0); return u; }
    var i = new Image(); i.decoding = 'async'; i.src = u; kept.set(u, i);
    if (kept.size > 80) kept.delete(kept.keys().next().value);
    return u;
  }

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
  // ── вложения ──
  function fileCard(icon, name, sub, extra) {
    return '<div class="file"' + (extra || '') + '><span class="fi">' + icon + '</span><span><b>' + name + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></div>';
  }
  // mid и i — сообщение и номер вложения в нём: по ним просмотр собирает ленту фото и видео чата
  function attachment(att, mid, i) {
    if (!att) return '';
    if (att.enc) {
      if (att._locked) return fileCard(I('lock'), 'Вложение');
      if ((att.mime || '').indexOf('image/') === 0) { var blob = B.S.scAttBlob.get(att._msgId); if (blob && B.secret.hasKey(att._chat)) return '<img class="att-img" src="' + esc(blob) + '" loading="lazy" data-c="lb" data-url="' + esc(blob) + '" data-type="image" alt="">'; return fileCard(I('image'), 'Изображение'); }
      return fileCard(I('file'), esc(att.name || 'Файл'), fmtSize(att.size), ' data-c="scsave" data-id="' + att._msgId + '"');
    }
    if (att.unavailable) return fileCard(I('x'), att.unavailable === 'policy' ? 'Вложение недоступно: не соответствует настройкам сервера' : 'Вложение не удалось получить');
    if (att.gif) return window.GifKlipy ? GifKlipy.messageHtml(att) : fileCard('GIF', 'GIF');
    if (att.expired) return fileCard(I('x'), 'Файл удалён');
    var box = imgBox(att), mime = att.mime || '';
    var ref = mid ? ' data-mid="' + mid + '" data-i="' + i + '"' : '';
    if (mime.indexOf('image/') === 0) return '<img class="att-img" src="' + esc(url(feedSrc(att))) + '" style="' + box.st + '" loading="lazy" decoding="async" data-c="lb" data-url="' + esc(att.url) + '" data-type="image"' + box.ns + ref + ' alt="">';
    if (mime.indexOf('video/') === 0) {
      // Размер задаёт сама обёртка (ширина и пропорции), а обложка лежит в ней поверх: высота пузыря не зависит от того, загрузилась ли картинка
      // (ленивая картинка в Safari давала высоте «скакать»), и не больше 300 px — вертикальное видео не занимает пол-экрана
      var poster = att.thumb ? '<img class="att-img vimg" src="' + esc(keep(url(att.thumb))) + '" style="position:absolute;inset:0;width:100%;height:100%;max-width:none;min-width:0;max-height:none;margin:0;border-radius:0" decoding="sync" data-url="' + esc(att.thumb) + '"' + box.ns + ' alt="">' : '<div class="vph" style="width:' + IMGW + '"></div>';
      return '<div class="vwrap" style="' + (att.thumb ? box.st : '') + '" data-c="lb" data-url="' + esc(att.url) + '" data-type="video"' + ref + '>' + poster + '<div class="vplay">' + I('play') + '</div></div>';
    }
    return fileCard(I('file'), esc(att.name || 'Файл'), fmtSize(att.size), ' data-c="' + (mid ? 'file' : 'dl') + '" data-url="' + esc(att.url) + '" data-name="' + esc(att.name || 'file') + '"' + ref);
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
      return '<div class="agt" data-c="lb"' + (mid ? ' data-mid="' + mid + '" data-i="' + x[1] + '"' : '') + ' data-url="' + esc(a.url) + '" data-type="' + (v ? 'video' : 'image') + '">' + (src ? '<img src="' + esc(url(src)) + '" loading="lazy" alt="">' : '<div class="vph"></div>') + (v ? '<div class="vplay">' + I('play') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    files.forEach(function (x) { h += attachment(x[0], mid, x[1]); });
    return h;
  }
  function reactions(m) {
    if (!m.reactions || !m.reactions.length) return '';
    return '<div class="react">' + m.reactions.map(function (r) {
      var mine = String(r.user_ids || '').split(',').map(Number).indexOf(B.S.user.id) >= 0;
      return '<button class="' + (mine ? 'mine' : '') + '" data-c="react" data-id="' + m.id + '" data-e="' + esc(r.reaction) + '">' + esc(r.reaction) + ' ' + r.count + '</button>';
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

  // Кнопки в сообщении (actions): «Заблокировать» в уведомлении «Electron» о входе с нового устройства
  function msgActions(m) {
    if (!Array.isArray(m.actions) || !m.actions.length) return '';
    var fin = m.actions.filter(function (a) { return a.state === 'done' || a.state === 'blocked' || a.state === 'confirmed'; })[0];
    if (fin) return '<div class="bacts"><span class="bbtn done">' + (fin.state === 'confirmed' ? 'Подтверждено' : 'Заблокировано') + '</span></div>';
    return '<div class="bacts">' + m.actions.map(function (a) {
      return '<button type="button" class="bbtn' + (a.id === 'confirm_device' ? ' ok' : '') + '" data-c="act" data-id="' + m.id + '" data-act="' + esc(a.id) + '" data-dev="' + Number(a.device) + '">' + esc(a.label || 'Действие') + '</button>';
    }).join('') + '</div>';
  }
  async function runAction(t) {
    var path = t.dataset.act === 'block_device' ? 'block' : t.dataset.act === 'confirm_device' ? 'confirm' : null;
    if (!path) return;
    var btns = t.parentNode ? Array.prototype.slice.call(t.parentNode.querySelectorAll('.bbtn')) : [t];
    btns.forEach(function (b) { b.disabled = true; });
    var r = await B.api('POST', '/users/me/devices/' + Number(t.dataset.dev) + '/' + path);
    if (!r || r.error) { btns.forEach(function (b) { b.disabled = false; }); B.toast.show((r && r.error) || 'Не удалось выполнить действие'); return; }
    B.toast.show(path === 'block' ? 'Устройство заблокировано' : 'Спасибо, устройство подтверждено');   // надпись у всех устройств сменится по событию message_edited
  }

  // ── сообщение: [имя] + строка + реакции, всё внутри обёртки .mg (одна единица для сверки ленты) ──
  function bubble(m, chat, pos) {
    if (B.S.secretChatIds.has(m.chat_id)) m = B.secret.display(m);
    var mine = m.sender_id === B.S.user.id;
    if (m.sender_username === '__system__' && !m.deleted) return '<div class="sys" data-mid="' + m.id + '"><span class="glass">' + esc(m.text) + ' · ' + B.fmt.time(m.sent_at) + '</span></div>';
    var groupish = chat && (chat.type === 'group' || chat.type === 'room');
    var h = '<div class="mg" data-mid="' + m.id + '">';
    if (groupish && !mine && pos.first) h += '<div class="who-n" style="color:' + nameColor(m.sender_id, m.sender_tag) + '" data-c="who" data-id="' + m.sender_id + '" data-name="' + esc(m.sender_name || '') + '">' + esc(m.sender_name || '') + '</div>';
    h += '<div class="mrow ' + (mine ? 'out' : 'in') + (pos.first ? ' first' : '') + (pos.last ? ' last' : '') + '" data-mid="' + m.id + '">';
    if (m.deleted) return h + '<div class="bub dl"><span class="txt">Сообщение удалено</span></div></div></div>';
    var att = m.attachment, eo = !att && !m.reply_to_id && !m.forward_data && emojiOnly(m.text);
    if (eo) return h + '<span class="big" data-big>' + esc(m.text.trim()) + '</span>' + (mine ? '<span class="swi">' + I('reply') + '</span>' : '<span class="swi">' + I('reply') + '</span>') + '</div>' + reactions(m) + '</div>';
    var bare = !m.text && !m.reply_to_id && !m.forward_data && att && (att.gif || (att.url && !att.expired && (att.enc ? /^(image|video)\//.test(att.mime || '') : B.media.listOf(att).every(B.media.isMedia))));
    var fail = !!m._optimistic && m._state === 'failed';
    var fwn = Number(m.forward_count) || 0;
    var meta = '<span class="t meta">' + (fwn > 0 ? '<span class="fwd" data-c="fwd" data-n="' + fwn + '">' + I('fwd') + fwn + '</span>' : '') + (m.edited_at ? 'изм. ' : '') + B.fmt.time(m.sent_at) +
      (mine ? (fail ? '<i class="er">!</i>' : m._optimistic ? '<span class="dv">' + I('check') + '</span>' : B.ticks(m.status)) : '') + '</span>';
    var comp = compOf(m);
    h += '<div class="bub' + (bare ? ' media' : '') + (bare && att.gif ? ' gifm' : '') + (comp ? ' bcomp' + (!comp.lp && comp.ps.length === 1 ? ' conly' : '') : '') + (fail ? ' fail' : '') + '"' + (fail ? ' data-c="retry" data-cid="' + m._cid + '"' : '') + '>';
    var qStart = h.length;
    if (m.reply_to_id) {
      h += '<div class="quote"' + (m.reply_deleted ? '' : ' data-c="jump" data-id="' + m.reply_to_id + '"') + '><b>' + esc(m.reply_sender_name || '') + '</b><span>' + (m.reply_deleted ? 'Сообщение удалено' : esc(Fmt.noCode(m.reply_text || ''))) + '</span></div>';
    }
    var fd = m.forward_data;
    if (fd) h += '<div class="quote"><b>Переслано от ' + esc(fd.name || '') + '</b>' + (fd.text ? '<span>' + esc(fd.text) + '</span>' : '') + '</div>';
    if (comp) { var qs = h.slice(qStart); h = h.slice(0, qStart) + (comp.lp ? Fmt.previewCard(comp.lp, B.http() + '://' + B.S.server) : '') + (qs ? '<div class="cpad">' + qs + '</div>' : ''); }
    if (fd && fd.attachment) h += attachments({ attachment: fd.attachment, id: 0 });
    h += attachments(m);
    if (comp) h += compParts(comp.ps, chat, meta);
    else if (m._skel) h += '<div class="txt">' + m._skel + meta + '</div>';
    else if (m.text) h += '<div class="txt">' + (m.sender_is_bot ? m.text : formatText(m.text, chat || {})) + (bare ? '' : meta) + '</div>';
    else if (!bare) h += '<div class="txt" style="min-height:4px">' + meta + '</div>';
    h += msgActions(m);
    if (bare) h += meta;
    h += '</div><span class="swi">' + I('reply') + '</span></div>' + reactions(m) + (fail ? '<div class="failnote" data-c="retry" data-cid="' + m._cid + '">Не отправлено · <b>Повторить</b></div>' : '') + '</div>';
    return h;
  }

  // Лента как список дней, в каждом — разметка элементов с ключами: по ключу и тексту разметки DOM сверяется с прошлым состоянием
  function feedGroups(chat, cache) {
    var M = B.msgs, groups = [], cur = null, divIdx = M.unreadFromId ? cache.findIndex(function (x) { return x.id === M.unreadFromId; }) : -1;
    if (!cache.length) return null;
    cache.forEach(function (m, i) {
      var day = new Date(m.sent_at * 1000).toDateString();
      if (!cur || cur.day !== day) { cur = { day: day, items: [{ key: 'd', html: '<div class="day"><span class="glass">' + B.fmt.daySep(m.sent_at) + '</span></div>' }] }; groups.push(cur); }
      var same = function (o) { return !!o && o.sender_id === m.sender_id && Math.abs(o.sent_at - m.sent_at) < GROUP_WINDOW && new Date(o.sent_at * 1000).toDateString() === day && !(o.sender_username === '__system__') && !(m.sender_username === '__system__'); };
      if (i === divIdx) cur.items.push({ key: 'u', html: '<div class="unrd" id="unrd"><span class="glass">Новые сообщения</span></div>' });
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
  function othersUnread(cid) { return B.S.chats.filter(function (c) { return !c.parent_id && !c.muted && c.id !== cid; }).reduce(function (s, c) { return s + (c.unread || 0); }, 0); }
  function statusOf(chat) {
    var ty = B.typing.names(chat.id);
    if (chat.type === 'direct') {
      if (B.isSys(chat)) return { t: 'Служебные уведомления' };
      if (ty.length) return { t: B.typing.label(ty, false), live: 1 };
      var p = B.peerId(chat), st = B.S.presence[p];
      return { t: p ? B.contacts.peerSub(p) : 'Личный чат', live: st === 'online' };
    }
    if (ty.length) return { t: B.typing.label(ty, true), live: 1 };
    if (chat.invite) return { t: 'Приглашение в ' + B.msgs.fedKind(chat) };
    if (B.msgs.fedOffline(chat)) return { t: 'Федеративная группа · нет связи' };
    var o = (B.S.chatOnline || {})[chat.id], cnt = o ? 'в сети ' + o.online + ' из ' + o.total : (chat.members ? chat.members.length : 0) + ' участников';
    return { t: chat.parent_id ? '# тема · ' + cnt : chat.type === 'room' ? 'Комната' + (o ? ' · ' + cnt : '') : cnt, live: false };
  }
  // Заглушки-пузыри вместо пустой страницы, пока сообщения чата ещё не загружены
  function skeleton() { return '<div class="sk"><i class="l w1"></i><i class="l w2"></i><i class="r w3"></i><i class="l w4"></i><i class="r w5"></i><i class="l w2"></i></div>'; }
  // Аватарка собеседника (кнопка справа в шапке) и подпись по центру: имя и статус
  function headAvatar(chat) {
    var peer = chat.type === 'direct' ? B.peerId(chat) : 0;
    return chat.type === 'direct' ? B.avatar.html({ id: peer || chat.id, chat: chat.id, text: B.fmt.initials(B.chatName(chat)) }) : B.avatar.html({ id: chat.id, chat: chat.id, text: chat.type === 'room' || chat.parent_id ? '#' : B.fmt.initials(B.chatName(chat)), sq: !!chat.parent_id });
  }
  function whoHtml(chat) {
    var st = statusOf(chat);
    return '<span style="min-width:0"><b>' + esc(B.chatName(chat)) + '</b><small class="' + (st.live ? 'on' : '') + '">' + esc(st.t) + '</small></span>';
  }
  function build(cid) {
    var chat = B.find(cid), el = document.createElement('div');
    el.className = 'page chat'; el.dataset.cid = cid; el._title = B.chatName(chat); el._inv = !!chat.invite;
    var n = othersUnread(cid);
    el.innerHTML = B.nav.amb +
      '<div class="nav cn"><button class="nb glass gi" data-back aria-label="Назад">' + I('chevLeft') + '<span class="cnt">' + (n ? (n > 99 ? '99+' : n) : '') + '</span></button>' +
        '<button class="who glass gi" data-c="info">' + whoHtml(chat) + '</button>' +
        '<div class="nr"><button class="glass gi" data-c="addc" aria-label="Добавить в контакты" hidden>' + I('userPlus') + '</button><button class="navav glass gi" data-c="info" aria-label="Профиль">' + headAvatar(chat) + '</button></div></div>' +
      '<div class="cnbar glass" hidden></div>' +
      '<div class="scroll"><div class="msgs">' + (B.msgs.tail(cid) && !B.S.secretChatIds.has(cid) ? '' : skeleton()) + '</div></div>' +
      '<button class="pinbar glass gi" data-c="pin" hidden></button>' +
      '<button class="jump glass gi" data-c="down" aria-label="К последним сообщениям">' + I('down') + '<b class="bd" style="display:none"></b><span class="mnt glass gi" data-c="mention" role="button" aria-label="К упоминанию">@</span></button><div class="comp"></div>';
    B.avatar.apply(el);
    B.ui.composer.mount(el, chat);
    var scr = $('.scroll', el);
    scr.addEventListener('scroll', function () { el._sa = performance.now(); onScroll(el); }, { passive: true });
    scr.addEventListener('touchstart', function () { el._touch = 1; el._stickUntil = 0; }, { passive: true });
    ['touchend', 'touchcancel'].forEach(function (t) { scr.addEventListener(t, function () { el._touch = 0; el._sa = performance.now(); }, { passive: true }); });
    el.addEventListener('click', function (e) { onClick(el, e); });
    bindGestures(el);
    // Нижний отступ ленты = положение поля ввода + его высота + зазор 24: последнее сообщение всегда на одном расстоянии над полем.
    // Высота поля меняется (ответ, несколько строк): лента остаётся внизу, если там и была и её не листают
    var comp = $('.comp', el), roStick = null, roT = 0;
    try { new ResizeObserver(function () {
      if (roStick === null) roStick = nearBottom(scr, 140);
      el.style.setProperty('--ch', comp.offsetHeight + 'px');
      clearTimeout(roT); roT = setTimeout(function () { var st = roStick; roStick = null; if (st && !busy(el)) scr.scrollTop = scr.scrollHeight; }, 60);
    }).observe(comp); } catch (e) {}
    // Картинки подгружаются уже после открытия: пока чат только открыт и его не листают, лента остаётся у низа
    $('.msgs', el).addEventListener('load', function (e) { if (e.target.tagName === 'IMG' && performance.now() < (el._stickUntil || 0) && !el._touch) scr.scrollTop = scr.scrollHeight; }, true);
    // Пока чат только открыт, любой рост ленты (картинка или видео получили размер, подъехал композер) сразу, до отрисовки, возвращает её к низу:
    // иначе последнее сообщение на кадр-другой оказывалось под композером. Касание ленты это прекращает
    try { new ResizeObserver(function () { if (performance.now() < (el._stickUntil || 0) && !el._touch) { scr.scrollTop = scr.scrollHeight; settle(el); } }).observe($('.msgs', el)); } catch (e) {}
    renderPin(el);
    return el;
  }
  // Последнее сообщение должно стоять над полем ввода: меряем по настоящему положению пузыря и композера, а не по scrollHeight (в Safari
  // с видео в конце ленты он оказывался меньше нужного, и сообщение уходило под композер). Возвращает true, если пришлось подвинуть
  function settle(el) {
    var sc = $('.scroll', el), comp = $('.comp', el), rows = sc && sc.querySelectorAll('.mrow'), last = rows && rows[rows.length - 1];
    if (!last || !comp) return false;
    var k = sc.clientHeight ? sc.getBoundingClientRect().height / sc.clientHeight : 1;
    var need = (last.getBoundingClientRect().bottom - (comp.getBoundingClientRect().top - 12)) / (k || 1);
    if (need > 1) { sc.scrollTop += need; return true; }
    return false;
  }
  // Пока чат только открыт и его не листают, каждый кадр проверяем положение ленты (картинки, видео, шрифты и композер подъезжают по очереди)
  function holdBottom(el) {
    var until = performance.now() + 4000;
    (function step() {
      if (!el.isConnected || performance.now() > until || el._touch || performance.now() > (el._stickUntil || 0)) return;
      var sc = $('.scroll', el); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight > 1) sc.scrollTop = sc.scrollHeight;
      settle(el); requestAnimationFrame(step);
    })();
  }
  function updateHeader(el) {
    var chat = B.find(+el.dataset.cid); if (!chat) return;
    var st = statusOf(chat), s = $('.who small', el);
    if (s) { s.textContent = st.t; s.classList.toggle('on', !!st.live); }
    var b = $('.who span b', el); if (b) b.textContent = B.chatName(chat);
    var n = othersUnread(chat.id), c = $('.nb .cnt', el); if (c) c.textContent = n ? (n > 99 ? '99+' : n) : '';
    // Точка «в сети» на аватаре в шапке: перерисовываем, когда статус собеседника изменился
    var pid0 = chat.type === 'direct' && !B.isSys(chat) ? B.peerId(chat) : 0, sig = pid0 ? (B.S.presence[pid0] || 'offline') : '';
    if (pid0 && el._pSig !== sig) { if (el._pSig !== undefined) { var w = $('.navav', el); w.firstElementChild.outerHTML = B.avatar.html({ id: pid0, chat: chat.id, text: B.fmt.initials(B.chatName(chat)), dot: pid0 }); B.avatar.apply(w); } el._pSig = sig; }
    var cb = $('.cnbar', el), cst = B.conn.state;
    if (cb) { cb.hidden = cst === 'ok'; cb.className = 'cnbar glass ' + cst; cb.innerHTML = cst === 'offline' ? I('bellOff') + 'Нет связи с сервером' : '<i class="cspin"></i>Подключение…'; }
    var ab = $('[data-c="addc"]', el), pid = chat.type === 'direct' && !B.isSys(chat) ? B.peerId(chat) : null; if (ab) ab.hidden = !(pid && B.contacts.needsContact(pid));
  }
  // Панель закрепа: показывает одно закреплённое сообщение, нажатие переходит к нему и листает к следующему, крестик открепляет
  function pinText(p) { return (p.sender_name || '') + ': ' + (Fmt.plain(p.text || '').replace(/<[^>]*>/g, '') || (p.attachment ? '📎 Вложение' : 'Сообщение')); }
  function renderPin(el) {
    var bar = $('.pinbar', el), pins = (el.dataset.cid == B.msgs.chatId ? B.msgs.pins : []) || [], cid = +el.dataset.cid;
    if (!bar) return;
    el.classList.toggle('pinned', pins.length > 0);
    if (!pins.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    var i = (pinIdx[cid] || 0) % pins.length, p = pins[i];
    bar.hidden = false;
    bar.innerHTML = '<i class="tk"></i><span class="pt"><b>' + (pins.length > 1 ? 'Закреплённое · ' + (i + 1) + ' из ' + pins.length : 'Закреплённое сообщение') + '</b><span>' + esc(pinText(p)) + '</span></span><span class="ibtn" data-c="unpin" data-id="' + p.message_id + '" style="width:32px;height:32px" aria-label="Открепить">' + I('x') + '</span>';
  }

  // ── прокрутка ──
  // Пока палец на экране или идёт инерция (события прокрутки ещё приходят), ленту не трогаем: запись scrollTop в этот момент
  // обрывает инерцию и даёт рывок. Фоновые обновления (галочки, реакции, правки, чужие сообщения) ждут конца прокрутки
  function busy(el) { return !!el._touch || performance.now() - (el._sa || 0) < 150; }
  function nearBottom(sc, px) { return sc.scrollHeight - sc.scrollTop - sc.clientHeight < px; }
  // Расстояние до ближайшего края ленты; страницы истории подгружаются заранее, когда до края меньше двух экранов (как в Telegram)
  var EDGE_NEAR = 500;
  function edgeGap(sc) { return Math.min(sc.scrollTop, sc.scrollHeight - sc.scrollTop - sc.clientHeight); }
  function edgeLoad(sc) { return Math.max(1400, sc.clientHeight * 2); }
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
      if (busy(el) && !(el._rq === 'keep' && edgeGap($('.scroll', el)) <= EDGE_NEAR)) { el._rqT = setTimeout(run, 120); return; }
      el._rqT = 0; var m = el._rq; el._rq = null; render(el, m);
    }, 150);
  }
  function render(el, mode) {
    var sc = el.querySelector('.scroll'), box = el.querySelector('.msgs'), chat = B.find(+el.dataset.cid); if (!chat) return;
    if (mode === 'smart' && busy(el)) { renderLater(el, mode); return; }
    // Страница старых или новых сообщений приходит, пока лента летит по инерции: запись scrollTop обрывает инерцию (Safari),
    // поэтому вставляем после остановки. Если до края уже близко, ждать нельзя: упрёмся в стену — вставляем сразу
    if (mode === 'keep' && busy(el) && edgeGap(sc) > EDGE_NEAR) { renderLater(el, mode); return; }
    var stick = mode === 'smart' && nearBottom(sc, 120), anc = (mode === 'smart' || mode === 'keep') && !stick ? anchorGet(sc) : null;
    var groups = feedGroups(chat, B.msgs.cache);
    if (!groups) { box.innerHTML = '<div class="stub-note">Сообщений пока нет</div>'; } else reconcile(box, groups);
    if (mode === 'smart' || mode === 'keep') { if (stick) sc.scrollTop = sc.scrollHeight; else anchorSet(sc, anc); }
    else if (mode !== 'none') sc.scrollTop = sc.scrollHeight;
    trackImages(sc); onScroll(el);
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
        var vw = img.parentNode && img.parentNode.classList.contains('vwrap') ? img.parentNode : null;   // у видео размер держит обёртка и запоминается он под адресом видео
        szRemember(vw ? vw.getAttribute('data-url') : (img.getAttribute('data-url') || img.getAttribute('src')), r);
        (vw || img).style.aspectRatio = r; img.removeAttribute('data-ns');
        var d = img.offsetHeight - h0; if (!d) return;
        var wasBottom = sc.scrollHeight - d - sc.scrollTop - sc.clientHeight < 6;
        if (wasBottom) sc.scrollTop = sc.scrollHeight;
        else if (img.getBoundingClientRect().bottom - d <= sc.getBoundingClientRect().top + 1) sc.scrollTop += d;
      };
      if (img.complete) done(); else img.addEventListener('load', done, { once: true });
    });
  }
  // Лента не должна расти без конца: оставляем окно вокруг того, что читают, а дальние сообщения выпадают из него с обеих сторон
  // (они подгрузятся снова: вверх через loadOlder, вниз через loadNewer)
  function trim(el) {
    var M = B.msgs, sc = el.querySelector('.scroll');
    if (M.cache.length <= 400 || busy(el) || jumping || M.loadingOlder || M.loadingNewer) return;
    var a = anchorGet(sc); if (!a) return;
    var mid = +a.el.dataset.mid, ai = M.cache.findIndex(function (m) { return m.id === mid; }), n = M.cache.length;
    if (ai < 0) return;
    var lo = Math.max(0, ai - 200), hi = Math.min(n, ai + 200);
    // Неотправленные сообщения из хвоста не убираем: они живут в очереди и должны оставаться в ленте
    if (hi < n && M.cache.slice(hi).some(function (m) { return m._optimistic; })) hi = n;
    if (lo + (n - hi) < 50) return;
    M.cache = M.cache.slice(lo, hi);
    if (lo > 0) M.hasMoreOlder = true;
    if (hi < n) M.hasMoreNewer = true;
    render(el, 'smart');
  }
  // Края ленты: до верха или низа осталось меньше двух экранов — подгружаем следующую страницу
  function checkEdges(el) {
    var M = B.msgs, sc = el.querySelector('.scroll'); if (!sc || jumping || el._edgeOff || +el.dataset.cid !== M.chatId || M._preview) return;
    var lim = edgeLoad(sc);
    if (M.hasMoreOlder && sc.scrollTop < lim) M.loadOlder();
    if (M.hasMoreNewer && sc.scrollHeight - sc.scrollTop - sc.clientHeight < lim) M.loadNewer();
  }
  // «Прочитано» уходит по мере показа: до последнего сообщения, которое видно над полем ввода, а не всё сразу при открытии чата
  function lastSeen(el) {
    var sc = $('.scroll', el), comp = $('.comp', el), rows = sc && sc.querySelectorAll('.mrow[data-mid], .sys[data-mid]');   // служебные сообщения тоже считаются увиденными
    if (!rows || !rows.length || !comp) return 0;
    var edge = comp.getBoundingClientRect().top - 12, lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (rows[mid].getBoundingClientRect().top < edge) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    while (ans >= 0 && +rows[ans].dataset.mid <= 0) ans--;   // неотправленные (отрицательные номера) пропускаем
    return ans < 0 ? 0 : +rows[ans].dataset.mid;
  }
  function markVisible(el) {
    var cid = +el.dataset.cid, M = B.msgs;
    if (!el.isConnected || document.hidden || M.chatId !== cid || M._preview || !B.ws.isOpen()) return;
    var id = lastSeen(el); if (!id || id <= (readSent[cid] || 0)) return;
    // Сервер старой версии не умеет «прочитано до сообщения»: отмечает весь чат и не присылает остаток — обнуляем счётчик сами
    if (!B.S.readUpTo) {
      if (B.ws.send({ type: 'read', chat_id: cid })) { readSent[cid] = id; var ch = B.find(cid); if (ch) { ch.unread = 0; ch.unread_mentions = 0; B.chats.onChanged(); } }
      return;
    }
    if (B.ws.send({ type: 'read', chat_id: cid, up_to: id })) readSent[cid] = id;
  }
  function scheduleRead(el) { clearTimeout(el._rdT); el._rdT = setTimeout(function () { markVisible(el); }, 250); }
  document.addEventListener('visibilitychange', function () { var el = activePage(); if (el && !document.hidden) scheduleRead(el); });
  B.bus.on('ws:connected', function () { var el = activePage(); if (el) scheduleRead(el); });
  function onScroll(el) {
    var sc = el.querySelector('.scroll'), btn = el.querySelector('.jump'), cid = +el.dataset.cid;
    clearTimeout(el._idleT); el._idleT = setTimeout(function () { if (el.isConnected) trim(el); }, 400);
    var off = sc.scrollHeight - sc.scrollTop - sc.clientHeight > 200 || B.msgs.hasMoreNewer;
    btn.classList.toggle('on', off);
    checkEdges(el); scheduleRead(el);
    if (!off && away[cid]) away[cid] = 0;
    badge(el);
  }
  // На кнопке «вниз» число непрочитанных (его ведёт сервер: уменьшается по мере чтения), а над ней «@», пока есть непрочитанные упоминания
  function badge(el) {
    var chat = B.find(+el.dataset.cid), b = el.querySelector('.jump .bd'), m = el.querySelector('.jump .mnt');
    var n = (chat && chat.unread) || 0;
    b.textContent = n > 99 ? '99+' : n || ''; b.style.display = n > 0 ? '' : 'none';
    if (m) m.classList.toggle('on', !!(chat && chat.unread_mentions > 0));
  }
  async function toMention(el) {
    var cid = +el.dataset.cid, r = await B.api('GET', '/messages/chat/' + cid + '/next-mention');
    if (r && r.id && el.isConnected) jump(el, r.id);
  }
  // Своя анимация вместо scrollTo smooth: любая посторонняя запись в scrollTop обрывает родную, а здесь цель пересчитывается на каждом кадре
  function toBottom(el) {
    var sc = el.querySelector('.scroll'); away[+el.dataset.cid] = 0; badge(el);
    // Последние сообщения не загружены (ушли вглубь истории): открываем чат заново на конце переписки
    if (B.msgs.hasMoreNewer) { B.msgs.open(+el.dataset.cid, undefined, { bottom: true }); return; }
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
    row.classList.remove('hl'); void row.offsetWidth; row.classList.add('hl');
    clearTimeout(row._flashT); row._flashT = setTimeout(function () { row.classList.remove('hl'); }, 1900);
  }
  function jump(el, id) {
    var row = el.querySelector('.mrow[data-mid="' + id + '"]');
    if (!row) { B.msgs.open(+el.dataset.cid, id); return; }   // сообщение глубоко в истории: открываем окно вокруг него
    row.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(row);
  }


  // ── жесты по сообщению: долгое нажатие — меню, свайп влево — ответ ──
  function bindGestures(el) {
    var box = $('.msgs', el), G = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var row = e.target.closest('.mrow'); if (!row || e.target.closest('input,textarea,[contenteditable],.agt,.vwrap,.file,a')) return;
      if ((e.clientX - phone.getBoundingClientRect().left) / sc < 24) return;   // у левого края — свайп «назад»
      var bub = e.target.closest('.bub') || e.target.closest('[data-big]');
      G = { id: e.pointerId, x: e.clientX, y: e.clientY, row: row, mode: null, tx: 0 };
      if (bub) G.lp = setTimeout(function () { if (G && !G.mode) { G.mode = 'lp'; B.ui.msgmenu.open(el, row, bub); } }, 430);
    });
    box.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = (e.clientX - G.x) / sc, dy = (e.clientY - G.y) / sc;
      if (!G.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; clearTimeout(G.lp);
        if (dx < 0 && Math.abs(dx) > Math.abs(dy) && G.row.querySelector('.swi')) { G.mode = 'swipe'; G.row.classList.add('dg'); try { box.setPointerCapture(e.pointerId); } catch (_) {} hideKb(); }
        else { G = null; return; }
      }
      if (G.mode !== 'swipe') return;
      G.tx = Math.max(dx, -90); G.row.style.transform = 'translateX(' + G.tx + 'px)';
      var i = $('.swi', G.row), armed = G.tx <= -60;
      i.style.opacity = Math.min(1, Math.abs(G.tx) / 55); i.classList.toggle('arm', armed);
      if (armed && !G.armed) { try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} } G.armed = armed;
    });
    var end = function (e, cancelled) {
      if (!G || e.pointerId !== G.id) return; clearTimeout(G.lp); var g = G; G = null;
      if (g.mode !== 'swipe') return;
      var i = $('.swi', g.row); g.row.classList.remove('dg'); g.row.style.transform = ''; i.style.opacity = 0; i.classList.remove('arm');
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
    var t = e.target.closest('[data-c]'); if (!t) { if (!e.target.closest('.comp,.epanel')) hideKb(); return; }
    var c = t.dataset.c;
    if (c === 'lb') { if (t.dataset.mid) B.media.openMsg(+t.dataset.mid, +t.dataset.i); else B.lightbox.open(t.dataset.url, t.dataset.type); }
    else if (c === 'file') B.media.openFile(+t.dataset.mid, +t.dataset.i);
    else if (c === 'retry') { var cid = t.dataset.cid; B.actions.show({ title: 'Сообщение не отправлено', msg: 'Оно останется в очереди и уйдёт само, когда появится связь.', items: [{ l: 'Повторить отправку', f: function () { B.msgs.retry(cid); } }, { l: 'Удалить', d: 1, f: function () { B.msgs.discard(cid); } }] }); }
    else if (c === 'dl') download(t.dataset.url, t.dataset.name);
    else if (c === 'jump') jump(el, +t.dataset.id);
    else if (c === 'react') B.msgs.react(+t.dataset.id, t.dataset.e);
    else if (c === 'fwd') { var n = +t.dataset.n, a = n % 10, b = n % 100; B.toast.show('Сообщение переслали ' + n + (a === 1 && b !== 11 ? ' раз' : (a >= 2 && a <= 4 && (b < 12 || b > 14) ? ' раза' : ' раз')), 'fwd'); }
    else if (c === 'mention') { e.stopPropagation(); toMention(el); }
    else if (c === 'down') toBottom(el);
    else if (c === 'scsave') B.secret.saveAtt(+t.dataset.id);
    else if (c === 'addc') { var pid = B.peerId(B.find(+el.dataset.cid)); if (pid && B.openAddFromChat) B.openAddFromChat(pid); }
    else if (c === 'who') { if (B.ui.composer.mention) B.ui.composer.mention(el, +t.dataset.id, t.dataset.name); }
    else if (c === 'info') info(+el.dataset.cid);
    else if (c === 'act') runAction(t);
    else if (c === 'unpin') { e.stopPropagation(); B.pins.unpin(+t.dataset.id); }
    else if (c === 'pin') {
      var pins = B.msgs.pins || []; if (!pins.length) return;
      var cid2 = +el.dataset.cid, i = (pinIdx[cid2] || 0) % pins.length;
      jump(el, pins[i].message_id); pinIdx[cid2] = (i + 1) % pins.length; renderPin(el);
    }
  }
  function download(path, name) {
    var a = document.createElement('a'); a.href = url(path); a.download = name; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function info(cid) {
    var chat = B.find(cid); if (!chat || B.isSys(chat)) return;
    if (chat.type === 'direct' && B.openProfile) B.openProfile(B.peerId(chat));
    else if (B.openGroupProfile) B.openGroupProfile(chat.parent_id || cid);
    else if (B.openMembers) B.openMembers(cid);
  }

  function opened(el, d) {
    var hadPreview = el._preview; el._preview = false;
    el._edgeOff = true;   // пока лента не поставлена на место, края не проверяем: scrollTop ещё 0 и это вызвало бы лишнюю подгрузку
    render(el, 'none');
    var scr = $('.scroll', el);
    if (d.aroundId) {
      var row = $('.mrow[data-mid="' + d.aroundId + '"]', el);
      if (row) { row.scrollIntoView({ block: 'center' }); setTimeout(function () { flash(row); }, 320); } else scr.scrollTop = scr.scrollHeight;
    } else {
      var u = d.bottom ? null : $('#unrd', el);
      if (u) scr.scrollTop = Math.max(0, u.getBoundingClientRect().top / sc - scr.getBoundingClientRect().top / sc + scr.scrollTop - $('.nav', el).offsetHeight - 8);
      else { scr.scrollTop = scr.scrollHeight; el._stickUntil = performance.now() + 4000; settle(el); holdBottom(el); }
    }
    el._edgeOff = false;
    updateHeader(el); onScroll(el); renderPin(el);
    if (B.ui.composer.sync) B.ui.composer.sync(el);
    readSent[+el.dataset.cid] = 0; scheduleRead(el);
    if (el._t0 && !hadPreview && !d.bottom) $('.msgs', el).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  }
  B.bus.on('msgs:preview', function (d) { var el = pageFor(d.chatId); if (!el) return; el._preview = true; render(el, 'bottom'); updateHeader(el); });
  B.bus.on('msgs:opened', function (d) {
    var el = pageFor(d.chatId); if (!el) return;
    var wait = el._t0 ? 460 - (performance.now() - el._t0) : 0;   // пока страница выезжает, сотни пузырей не рисуем
    if (wait > 40) { setTimeout(function () { if (el.isConnected) opened(el, d); }, wait); return; }
    opened(el, d);
  });
  B.bus.on('msgs:older', function () { var el = activePage(); if (el) render(el, 'keep'); });
  B.bus.on('msgs:newer', function () { var el = activePage(); if (el) render(el, 'keep'); });
  B.bus.on('msgs:changed', function (d) { var el = activePage(); if (el && +el.dataset.cid === B.msgs.chatId) render(el, d && d.mode === 'bottom' ? undefined : (d && d.mode) || 'smart'); });
  B.bus.on('pins:changed', function () { var el = activePage(); if (el) renderPin(el); });
  B.bus.on('msgs:new', function (d) {
    var el = activePage(); if (!el || d.mine) return;
    var scr = $('.scroll', el);
    if (d.detached || scr.scrollHeight - scr.scrollTop - scr.clientHeight > 200) { var cid = +el.dataset.cid; away[cid] = (away[cid] || 0) + 1; badge(el); }
  });
  function refreshTyping(cid) { var el = pageFor(cid); if (el) updateHeader(el); }
  B.bus.on('typing:changed', function (d) { refreshTyping(d.chatId); });
  // Клавиатура или панель смайлов сдвинули поле ввода: держим ленту у низа, если она там и была
  B.bus.on('kbd:changed', function () { var el = activePage(); if (!el) return; var scr = $('.scroll', el); if (scr && scr.scrollHeight - scr.scrollTop - scr.clientHeight < 400) { scr.scrollTop = scr.scrollHeight; setTimeout(function () { scr.scrollTop = scr.scrollHeight; }, 60); } });
  B.bus.on('presence:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('conn:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('chats:changed', function () {
    var el = activePage(); if (!el) return;
    updateHeader(el); badge(el);
    var chat = B.find(+el.dataset.cid);
    if (chat && el._inv && !chat.invite) { el._inv = false; B.msgs.open(chat.id); }   // приглашение приняли: открываем историю
    if (chat && B.ui.composer.sync) B.ui.composer.sync(el);
  });
  B.bus.on('chat:online', function (d) { var el = pageFor(d.chatId); if (el) updateHeader(el); });
  B.bus.on('contacts:changed', function () { var el = activePage(); if (el) updateHeader(el); });
  B.bus.on('chat:updated', function (d) { var el = pageFor(d.chatId); if (el) { updateHeader(el); if (B.ui.composer.sync) B.ui.composer.sync(el); } });
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
    B.toast.banner(B.avatar.chat(chat, 0, true) + '<div class="tt"><b>' + esc(B.chatName(chat)) + '</b><span>' + esc(txt.slice(0, 80)) + '</span></div>', function () { B.openChat(chat.id); });
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

// Открытие чата из списка, баннера и поиска: комнаты с темами — отдельный список
B.openChat = function (id, msgId) {
  var c = B.find(id); if (!c) return;
  if (c.has_topics) { B.ui.topics.open(id); return; }
  B.ui.chat.open(id, msgId);
};
