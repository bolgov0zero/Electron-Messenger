// /test — тестовая страница ленты. Подставляет вместо сервера выдуманные данные: 200 сообщений (текст, картинки с размерами и без,
// сетки из нескольких вложений, видео, файлы, превью ссылок, цитаты, реакции), ответы API и WebSocket. Настоящий интерфейс /m
// работает поверх них как обычно. Адрес: /test?n=200&delay=500&nosize=0.3&seed=1&auto=1
// n — сообщений, delay — задержка картинок в мс (имитация сети), nosize — доля картинок без размеров (как старые вложения),
// seed — зерно случайных данных, auto=1 — сразу включить случайные события.
(function () {
  document.documentElement.classList.remove('m-desktop');
  var Q = new URLSearchParams(location.search);
  var N = Math.max(20, Math.min(1000, parseInt(Q.get('n') || '200', 10) || 200));
  var DELAY = parseInt(Q.get('delay') || '500', 10) || 0;
  var NOSIZE = Q.has('nosize') ? parseFloat(Q.get('nosize')) : 0.3;
  var SEED = parseInt(Q.get('seed') || '1', 10) || 1;

  // ── случайные данные ──
  var s0 = SEED >>> 0;
  function rnd() { s0 = (s0 + 0x6D2B79F5) >>> 0; var t = s0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  var WORDS = 'проект отчёт склад заявка сервер релиз тест клиент телефон сообщение файл договор встреча звонок задача срок доставка оплата счёт график план список папка ссылка картинка фото документ версия ошибка запуск проверка сеть доступ пароль почта адрес офис машина груз водитель маршрут накладная смена график перерыв обед'.split(' ');
  var START = ['Привет', 'Добрый день', 'Слушай', 'Коллеги', 'Смотрите', 'Короче', 'Ок', 'Да', 'Нет', 'Подскажите', 'Проверил', 'Сделал', 'Жду', 'Скинь', 'Глянь'];
  function sentence() { var n = ri(3, 9), w = []; for (var i = 0; i < n; i++) w.push(pick(WORDS)); var t = w.join(' '); return t.charAt(0).toUpperCase() + t.slice(1) + pick(['.', '.', '!', '?', '…']); }
  function text() {
    var r = rnd();
    if (r < 0.5) return pick(START) + (rnd() < 0.5 ? ', ' + sentence().toLowerCase() : '.');
    if (r < 0.8) return sentence() + (rnd() < 0.5 ? ' ' + sentence() : '');
    if (r < 0.93) { var n = ri(2, 5), a = []; for (var i = 0; i < n; i++) a.push(sentence()); return a.join(' '); }
    var l = ri(3, 6), b = []; for (var j = 0; j < l; j++) b.push(sentence()); return b.join('\n');
  }
  var EMO = ['👍', '😂', '🔥', '❤️', '😮', '👌', '🙏'];
  var USERS = [{ id: 1, display_name: 'Вы', username: 'me' }, { id: 2, display_name: 'Громов Дмитрий', username: 'gromov' }, { id: 3, display_name: 'Соколова Анна', username: 'sokolova' },
    { id: 4, display_name: 'Титов Павел', username: 'titov' }, { id: 5, display_name: 'Репин Никита', username: 'repin' }, { id: 6, display_name: 'Маслакова Ольга', username: 'maslakova' }];
  var SITES = [['Новая версия вышла', 'github.com', 'https://github.com/example/release'], ['Как мы ускорили склад на 30%', 'habr.com', 'https://habr.com/ru/articles/123456/'], ['Прогноз погоды на неделю', 'yandex.ru', 'https://yandex.ru/pogoda'], ['Расписание и маршруты', 'transport.example.com', 'https://transport.example.com/routes'], ['Документация API', 'docs.example.org', 'https://docs.example.org/api/v2']];
  var imgSeq = 0;
  function imgUrl(w, h) { imgSeq++; return '/test/img/' + imgSeq + '.jpg?w=' + w + '&h=' + h + '&delay=' + DELAY; }
  var SIZES = [[3024, 4032], [4032, 3024], [1600, 1200], [1200, 1600], [2048, 2048], [1920, 1080], [1080, 1920], [800, 600], [4000, 1000]];
  function image(name) {
    var sz = pick(SIZES), a = { url: imgUrl(sz[0], sz[1]), name: name || ('IMG_' + ri(1000, 9999) + '.jpg'), mime: 'image/jpeg', size: ri(300, 4000) * 1024 };
    if (rnd() >= NOSIZE) { a.width = sz[0]; a.height = sz[1]; }
    return a;
  }

  var msgs = [], now = Math.floor(Date.now() / 1000), t = now - ri(5, 6) * 86400, sender = 2, run = 0;
  for (var i = 0; i < N; i++) {
    if (run <= 0) { sender = pick(USERS).id; run = ri(1, 4); }
    run--;
    t += rnd() < 0.04 ? ri(6 * 3600, 20 * 3600) : rnd() < 0.2 ? ri(600, 2400) : ri(8, 70);
    if (t > now - 30) t = now - (N - i) * 3;
    var u = USERS[sender - 1], mine = sender === 1, r = rnd();
    var m = { id: i + 1, chat_id: 1, sender_id: sender, sender_name: u.display_name, sender_username: u.username, sender_tag: null, text: '', sent_at: t, edited_at: null, deleted: 0,
      status: mine ? { delivered: 5, read: ri(0, 5), total: 5 } : { delivered: 0, read: 0, total: 5 }, reactions: [] };
    if (r < 0.50) m.text = text();
    else if (r < 0.54) m.text = pick(['👍', '😂', '🔥', '❤️', '🙏']);
    else if (r < 0.66) { m.attachment = image(); if (rnd() < 0.4) m.text = text(); }
    else if (r < 0.71) { var k = ri(2, 6), a0 = image(), more = []; for (var q = 1; q < k; q++) more.push(image()); a0.more = more; m.attachment = a0; if (rnd() < 0.5) m.text = text(); }
    else if (r < 0.74) { var vs = pick(SIZES); m.attachment = { url: imgUrl(vs[0], vs[1]), thumb: imgUrl(Math.round(vs[0] / 6), Math.round(vs[1] / 6)), name: 'VID_' + ri(100, 999) + '.mp4', mime: 'video/mp4', size: ri(2, 40) * 1048576, width: vs[0], height: vs[1] }; }
    else if (r < 0.77) { m.attachment = { url: '/test/file.bin', name: pick(['Отчёт_октябрь.pdf', 'Накладная_17.xlsx', 'Договор.docx']), mime: 'application/pdf', size: ri(40, 4000) * 1024 }; if (rnd() < 0.3) m.text = text(); }
    else if (r < 0.86) { var si = pick(SITES); m.text = (rnd() < 0.6 ? text() + ' ' : '') + si[2]; m.link_preview = { url: si[2], title: si[0], site: si[1], image: rnd() < 0.8 ? imgUrl(1200, 630) : null }; }
    else if (r < 0.92 && msgs.length > 5) { var ref = msgs[msgs.length - ri(1, 5)]; m.text = text(); m.reply_to_id = ref.id; m.reply_text = (ref.text || 'Вложение').slice(0, 80); m.reply_sender_name = ref.sender_name; m.reply_sender_id = ref.sender_id; }
    else m.text = text();
    if (rnd() < 0.12) { var kk = ri(1, 3); for (var e = 0; e < kk; e++) m.reactions.push({ reaction: pick(EMO), count: ri(1, 4), user_ids: String(ri(2, 6)) }); }
    msgs.push(m);
  }
  var nextId = N + 1, UNREAD = 5;
  var chat = { id: 1, type: 'group', name: 'Тест ленты', created_by: 2, members: USERS.slice(), unread: UNREAD, unread_mentions: 0, muted: false, last_message: msgs[msgs.length - 1], dm_limit: null, pinned: false };

  // ── подмена сервера ──
  B.S.user = { id: 1, username: 'me', display_name: 'Вы', is_admin: false, workspace_id: 1, workspaces: [{ id: 1, name: 'Тест' }], server_name: 'Тест', server_id: 'test' };
  B.S.server = location.host; B.S.token = 'test';
  B.S.pendingOpenChatId = 1;
  B.auth.restore = async function () { B.S.token = 'test'; return true; };
  B.auth.startRefresh = function () {};
  B.pwa.sw = 'нет';
  B.modules = { init: function () {}, refresh: function () {} };
  if (B.push) { B.push.subscribe = function () {}; B.push.shouldAsk = function () { return false; }; }

  function qs(path) { var i = path.indexOf('?'), o = {}; if (i >= 0) path.slice(i + 1).split('&').forEach(function (p) { var kv = p.split('='); o[kv[0]] = decodeURIComponent(kv[1] || ''); }); return o; }
  function page(path) {
    var q = qs(path), limit = Math.min(200, parseInt(q.limit || '50', 10) || 50), list, hasMore, hasMoreAfter = false;
    if (q.before) { var b = msgs.findIndex(function (m) { return m.id >= +q.before; }); if (b < 0) b = msgs.length; list = msgs.slice(Math.max(0, b - limit), b); hasMore = b - limit > 0; }
    else if (q.after) { var a = msgs.findIndex(function (m) { return m.id > +q.after; }); list = a < 0 ? [] : msgs.slice(a, a + limit); hasMoreAfter = a >= 0 && a + limit < msgs.length; hasMore = false; }
    else { list = msgs.slice(-limit); hasMore = msgs.length > limit; }
    return { messages: JSON.parse(JSON.stringify(list)), hasMore: hasMore, hasMoreAfter: hasMoreAfter, pins: [], first_unread_id: msgs[msgs.length - UNREAD] ? msgs[msgs.length - UNREAD].id : null };
  }
  B.api = async function (method, path, body) {
    await new Promise(function (r) { setTimeout(r, 60); });   // сеть не мгновенная
    var p = path.split('?')[0];
    if (p === '/chats') return [JSON.parse(JSON.stringify(chat))];
    if (p === '/messages/chat/1') return page(path);
    if (p === '/users') return USERS.slice(1).map(function (u) { return Object.assign({ rel: 'ws', contact: true }, u); });
    if (p === '/users/presence') return { 2: { status: 'online' }, 3: { status: 'away' }, 4: { status: 'offline', last_seen: now - 3600 } };
    if (p === '/folders' || p === '/blocks' || p === '/contacts') return [];
    if (p === '/chats/1/topics') return [];
    if (p === '/upload/settings') return { image: { maxSizeMb: 10, extensions: [] }, video: { maxSizeMb: 50, extensions: [] }, file: { maxSizeMb: 50, extensions: [] } };
    if (p === '/push/prefs') return { show_text: true, quiet_from: null, quiet_to: null, tz: null };
    if (p === '/auth/me') return B.S.user;
    if (p === '/messages/search') return { results: [] };
    if (p === '/preview') return { preview: null };
    return { ok: true };
  };
  B.S.ws = { readyState: 1, close: function () {} };
  B.ws.isOpen = function () { return true; };
  B.ws.connect = function () { setTimeout(function () { B.conn.update(); B.bus.emit('ws:state'); B.bus.emit('ws:connected', {}); }, 50); };
  // «Сервер» принимает сообщение и возвращает его обратно с настоящим номером, как и настоящий
  B.ws.send = function (o) {
    if (o && o.type === 'message') {
      setTimeout(function () {
        var m = { id: nextId++, chat_id: 1, sender_id: 1, sender_name: 'Вы', sender_username: 'me', text: o.text || '', sent_at: Math.floor(Date.now() / 1000), deleted: 0, status: { delivered: 0, read: 0, total: 5 }, reactions: [], client_id: o.client_id };
        if (o.attachment) m.attachment = o.attachment; if (o.reply_to_id) m.reply_to_id = o.reply_to_id; if (o.link_preview) m.link_preview = o.link_preview;
        msgs.push(m); chat.last_message = m; B.ws.handle({ type: 'message', message: JSON.parse(JSON.stringify(m)) });
      }, 350);
    }
    return true;
  };

  // ── события, которые в жизни приходят во время прокрутки ──
  var EV = {
    'Входящее': function () {
      var u = pick(USERS.slice(1)), r = rnd(), m = { id: nextId++, chat_id: 1, sender_id: u.id, sender_name: u.display_name, sender_username: u.username, text: text(), sent_at: Math.floor(Date.now() / 1000), deleted: 0, status: { delivered: 0, read: 0, total: 5 }, reactions: [] };
      if (r < 0.25) { m.attachment = image(); m.text = ''; } else if (r < 0.35) { var si = pick(SITES); m.text = si[2]; m.link_preview = { url: si[2], title: si[0], site: si[1], image: imgUrl(1200, 630) }; }
      msgs.push(m); chat.last_message = m; B.ws.handle({ type: 'message', message: JSON.parse(JSON.stringify(m)) }); return 'входящее #' + m.id;
    },
    'Галочки': function () {
      var mine = msgs.filter(function (m) { return m.sender_id === 1; }), a = mine[Math.max(0, mine.length - ri(1, 12))], b = mine[mine.length - 1];
      if (!a) return 'нет своих'; B.ws.handle({ type: 'status_range', chat_id: 1, kind: 'read', min_id: a.id, max_id: b.id, reader_id: ri(2, 6) }); return 'галочки ' + a.id + '–' + b.id;
    },
    'Реакция': function () {
      var m = msgs[msgs.length - ri(1, 40)]; if (!m) return ''; var e = pick(EMO); m.reactions = [{ reaction: e, count: ri(1, 3), user_ids: String(ri(2, 6)) }];
      B.ws.handle({ type: 'reaction_update', message_id: m.id, counts: JSON.parse(JSON.stringify(m.reactions)) }); return 'реакция на #' + m.id;
    },
    'Правка': function () {
      var m = msgs.filter(function (x) { return x.text && !x.attachment; }).slice(-30)[ri(0, 5)]; if (!m) return ''; m.text += ' (изм.)'; m.edited_at = Math.floor(Date.now() / 1000);
      B.ws.handle({ type: 'message_edited', message: JSON.parse(JSON.stringify(m)) }); return 'правка #' + m.id;
    },
    'Печатает': function () { B.ws.handle({ type: 'typing', chat_id: 1, sender_name: pick(USERS.slice(1)).display_name }); return 'печатает'; }
  };

  // ── измерения ──
  var M = { _wd: 0, shiftBig: '', shiftLog: [], shifts: 0, shiftPx: 0, shiftMax: 0, writes: 0, writeLog: [], rebuilds: 0, longFrames: 0, frameMax: 0, events: 0, since: Date.now() };
  var proto = Element.prototype, desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
  if (desc && desc.set) {
    Object.defineProperty(proto, 'scrollTop', { configurable: true, enumerable: desc.enumerable, get: desc.get, set: function (v) {
      if (this.classList && this.classList.contains('scroll') && this.closest && this.closest('.page.chat')) {
        var d = Math.round(v - this.scrollTop); M.writes++; M._wd += d;
        var st = (new Error().stack || '').split('\n').slice(2, 5).map(function (l) { var m = l.match(/at (?:async )?([^\s(]+) \(/) || l.match(/^([\w.$<>]+)@/); return m ? m[1] : (l.match(/([\w.]+\.js:\d+)/) || [0, '?'])[1]; }).join(' < ');
        M.writeLog.unshift((d >= 0 ? '+' : '') + d + ' px  ' + st); if (M.writeLog.length > 8) M.writeLog.pop();
      }
      desc.set.call(this, v);
    } });
  }
  var obs = new MutationObserver(function (list) { list.forEach(function (r) { if (r.removedNodes.length > 0) M.rebuilds++; }); });
  var anchor = null, lastTop = 0, lastScroll = 0, lastT = performance.now();
  function tick(ts) {
    var d = ts - lastT; lastT = ts; if (d > 50) { M.longFrames++; } if (d > M.frameMax && d < 2000) M.frameMax = d;
    var sc = document.querySelector('.page.chat .scroll'), box = sc && sc.querySelector('.msgs');
    if (sc && box) {
      if (!box._obs) { box._obs = 1; obs.observe(box, { childList: true }); }
      var top = sc.scrollTop, cr = sc.getBoundingClientRect();
      // следим за первым целиком видимым сообщением: если оно сдвинулось не на столько, на сколько прокрутили, это рывок раскладки
      var cur = anchor && anchor.isConnected ? anchor : null;
      if (cur) {
        var userDelta = (top - lastScroll) - M._wd, y = cur.getBoundingClientRect().top - cr.top, expected = anchor._y - userDelta, diff = y - expected;
        if (Math.abs(diff) > 1.5) { M.shiftLog.unshift(Math.round(diff) + ' px у #' + anchor.dataset.mid + ' (scrollTop ' + Math.round(top) + ', было ' + Math.round(lastScroll) + ', сообщений ' + B.msgs.cache.length + ')'); if (M.shiftLog.length > 8) M.shiftLog.pop(); M.shifts++; M.shiftPx += Math.abs(diff); if (Math.abs(diff) > M.shiftMax) { M.shiftMax = Math.abs(diff); M.shiftBig = M.shiftLog[0]; } }
      }
      var rows = box.querySelectorAll('.mrow[data-mid]'), next = null;
      for (var i = 0; i < rows.length; i++) { var rr = rows[i].getBoundingClientRect(); if (rr.top - cr.top > 60 && rr.top < cr.bottom - 120) { next = rows[i]; break; } }
      anchor = next; if (anchor) anchor._y = anchor.getBoundingClientRect().top - cr.top; lastScroll = top; M._wd = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── автопрокрутка и случайные события ──
  var auto = { ev: null, scroll: null, dir: 0 };
  function autoEvents(on) { clearInterval(auto.ev); auto.ev = null; if (on) auto.ev = setInterval(function () { var k = Object.keys(EV); var n = pick(k); EV[n](); M.events++; }, 700); }
  function autoScroll(dir) {
    cancelAnimationFrame(auto.scroll); auto.dir = dir; if (!dir) return;
    var sc = document.querySelector('.page.chat .scroll'); if (!sc) return;
    var step = function () {
      if (!auto.dir) return;
      var before = sc.scrollTop; sc.scrollBy(0, auto.dir * 14);
      if (Math.abs(sc.scrollTop - before) < 1 && ((auto.dir > 0 && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 3) || (auto.dir < 0 && sc.scrollTop < 3))) { if (auto.dir < 0 && B.msgs.hasMoreOlder) { auto.scroll = requestAnimationFrame(step); return; } auto.dir = 0; paint(); return; }
      auto.scroll = requestAnimationFrame(step);
    };
    auto.scroll = requestAnimationFrame(step);
  }

  // ── панель ──
  var box = document.createElement('div'); box.id = 'tp';
  box.innerHTML = '<button id="tp-t" aria-label="Панель теста">Тест</button><div id="tp-b" hidden><pre id="tp-m"></pre><div id="tp-btns"></div></div>';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(box); wire(); });
  function wire() {
    var b = document.getElementById('tp-btns'), mk = function (label, fn, id) { var x = document.createElement('button'); x.textContent = label; if (id) x.id = id; x.addEventListener('click', function () { fn(x); paint(); }); b.appendChild(x); return x; };
    Object.keys(EV).forEach(function (k) { mk(k, function () { var r = EV[k](); M.events++; if (r) M.last = r; }); });
    mk('События: выкл', function (x) { var on = !auto.ev; autoEvents(on); x.textContent = 'События: ' + (on ? 'вкл' : 'выкл'); });
    mk('Вверх ▲', function () { autoScroll(-1); }); mk('Вниз ▼', function () { autoScroll(1); }); mk('Стоп', function () { autoScroll(0); });
    mk('Сбросить', function () { M.shifts = M.shiftPx = M.shiftMax = M.writes = M.rebuilds = M.longFrames = M.frameMax = M.events = 0; M.writeLog = []; M.shiftLog = []; M.since = Date.now(); });
    document.getElementById('tp-t').addEventListener('click', function () { var p = document.getElementById('tp-b'); p.hidden = !p.hidden; paint(); });
    if (Q.get('auto') === '1') { autoEvents(true); }
    setInterval(paint, 500);
  }
  function paint() {
    var p = document.getElementById('tp-b'); if (!p || p.hidden) return;
    var sc = document.querySelector('.page.chat .scroll');
    document.getElementById('tp-m').textContent =
      'сообщений в ленте: ' + B.msgs.cache.length + ' (всего ' + msgs.length + ')\n' +
      'рывков раскладки: ' + M.shifts + ', сумма ' + Math.round(M.shiftPx) + ' px, макс. ' + Math.round(M.shiftMax) + ' px\n' +
      'записей scrollTop: ' + M.writes + '   перестроек ленты: ' + M.rebuilds + '\n' +
      'долгих кадров (>50 мс): ' + M.longFrames + ', макс. ' + Math.round(M.frameMax) + ' мс\n' +
      'событий: ' + M.events + (M.last ? ' (' + M.last + ')' : '') + '   ' + Math.round((Date.now() - M.since) / 1000) + ' с\n' +
      (sc ? 'scrollTop ' + Math.round(sc.scrollTop) + ' из ' + Math.round(sc.scrollHeight - sc.clientHeight) + '\n' : '') +
      (M.shiftLog.length ? 'последние рывки:\n' + M.shiftLog.join('\n') + '\n' : '') + (M.writeLog.length ? 'последние записи scrollTop:\n' + M.writeLog.join('\n') : '');
  }
  window.TEST = { M: M, EV: EV, autoEvents: autoEvents, autoScroll: autoScroll, msgs: msgs, paint: paint };
})();
