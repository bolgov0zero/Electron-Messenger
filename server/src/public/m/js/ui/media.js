// /m — просмотр вложений: фото и видео на весь экран (листание, щипок, двойное касание, смахивание вниз),
// карточка файла с системным листом «Поделиться» и страница «Медиа чата» (фото и видео, файлы, ссылки).
B.ui = B.ui || {};
B.media = (function () {
  var esc = B.esc, ic = B.ic;
  var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  function abs(p) { return p && (p.indexOf('blob:') === 0 || /^https?:/.test(p)) ? p : B.http() + '://' + B.S.server + p; }
  function isMedia(a) { return !!(a && a.url && !a.expired && !a.unavailable && !a.enc && !a.gif && /^(image|video)\//.test(a.mime || '')); }
  function listOf(att) { var f = Object.assign({}, att); delete f.more; return [f].concat(att.more || []); }
  function fmtSize(b) { return !b ? '' : b < 1024 ? b + ' Б' : b < 1048576 ? Math.round(b / 1024) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ'; }
  function when(ts) {
    var d = new Date(ts * 1000), now = new Date(), t = B.fmt.time(ts);
    if (d.toDateString() === now.toDateString()) return 'сегодня, ' + t;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера, ' + t;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + t;
  }

  // Фото и видео открытого чата по порядку: из них собирается лента просмотра
  function fromCache() {
    var items = [];
    B.msgs.cache.forEach(function (m) {
      if (m.deleted || !m.attachment || m._optimistic) return;
      listOf(m.attachment).forEach(function (a, i) {
        if (isMedia(a)) items.push({ mid: m.id, i: i, url: a.url, thumb: a.thumb, mime: a.mime, name: a.name, size: a.size, w: a.width, h: a.height, who: m.sender_name, at: m.sent_at, caption: i === 0 ? m.text : '', sid: m.sender_id, total: listOf(m.attachment).length, text: m.text || '' });
      });
    });
    return items;
  }
  function openMsg(mid, i) {
    var items = fromCache(), k = items.findIndex(function (x) { return x.mid === mid && x.i === i; });
    if (k < 0) return;
    B.lightbox.open(items, k);
  }

  // ── файл целиком (для «Поделиться» и «Сохранить») ──
  function fetchFile(it, onProgress) {
    if (it._file) return it._file;
    it._file = fetch(abs(it.url)).then(function (r) {
      if (!r.ok) throw new Error('http');
      var total = +r.headers.get('content-length') || it.size || 0;
      if (!r.body || !onProgress || !total) return r.blob();
      var rd = r.body.getReader(), parts = [], got = 0;
      return (function pump() { return rd.read().then(function (x) { if (x.done) return new Blob(parts, { type: it.mime || '' }); parts.push(x.value); got += x.value.length; onProgress(Math.min(99, Math.round(got / total * 100))); return pump(); }); })();
    }).then(function (b) { return new File([b], it.name || 'file', { type: it.mime || b.type }); }).catch(function (e) { it._file = null; throw e; });
    return it._file;
  }
  function download(it) {
    fetchFile(it).then(function (f) {
      var u = URL.createObjectURL(f), a = document.createElement('a'); a.href = u; a.download = it.name || 'file';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    }).catch(function () { B.toast.show('Не удалось скачать файл'); });
  }
  function canShare(f) { try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  // Системный лист: iOS предлагает «Сохранить изображение», «Файлы», почту и т.д. Без него — обычное скачивание
  function share(it, onProgress, save) {
    var ready = !!it._file && it._ok;
    if (!ready) B.toast.show('Готовлю файл…');
    return fetchFile(it, onProgress).then(function (f) {
      it._ok = true;
      if (!canShare(f)) { download(it); return; }
      return navigator.share({ files: [f] }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        if (!ready && e && e.name === 'NotAllowedError') B.toast.show('Файл готов, нажмите ещё раз');
        else if (save) download(it); else B.toast.show('Не удалось открыть лист «Поделиться»');
      });
    }).catch(function () { B.toast.show('Не удалось загрузить файл'); });
  }
  function forwardOf(it) {
    var m = B.msgs.find(it.mid);
    if (m && !(m.attachment && m.attachment.more && m.attachment.more.length)) return m;
    var one = { url: it.url, thumb: it.thumb, name: it.name, mime: it.mime, size: it.size, width: it.w, height: it.h };
    return { id: it.mid, sender_id: it.sid, sender_name: it.who, text: it.i === 0 ? it.text || '' : '', attachment: m && it.i === 0 ? m.attachment : one };
  }

  // ── полноэкранный просмотр ──
  var L = {
    el: null, items: [], i: 0, z: 1, px: 0, py: 0, chrome: true, vid: null, open_: false,
    init: function (root) {
      var el = L.el = document.createElement('div'); el.className = 'lbx';
      el.innerHTML = '<div class="lbt"><button class="lbi" data-l="close" aria-label="Закрыть">' + ic('x', 22, 2.2) + '</button><div class="lbh"><b></b><span></span></div><button class="lbi" data-l="more" aria-label="Ещё">' + ic('more', 22, 2) + '</button></div>' +
        '<div class="lbm"><div class="lbv"></div></div>' +
        '<div class="lbd"><div class="lbc"></div><div class="lbvc" hidden></div><div class="lbs"></div><div class="lbb">' +
        '<button data-l="share">' + ic('share', 22, 1.8) + '<span>Поделиться</span></button><button data-l="save">' + ic('dl', 22, 1.8) + '<span>Сохранить</span></button>' +
        '<button data-l="fwd">' + ic('fwd', 22, 1.8) + '<span>Переслать</span></button><button class="d" data-l="del">' + ic('trash', 22, 1.8) + '<span>Удалить</span></button></div></div>';
      root.appendChild(el);
      el.addEventListener('click', L.onClick); L.bindGestures(el.querySelector('.lbm'));
    },
    // Старый вызов: одно фото или видео по адресу (в том числе blob: скрытого чата)
    open: function (a, b) {
      if (typeof a === 'string') { L.items = [{ url: a, mime: b === 'video' ? 'video/mp4' : 'image/jpeg', name: '', blob: a.indexOf('blob:') === 0 }]; L.i = 0; }
      else { L.items = a; L.i = b || 0; }
      L.z = 1; L.px = L.py = 0; L.chrome = true; L.el.classList.remove('hc'); L.el.classList.add('on'); L.open_ = true;
      L.render();
    },
    close: function () {
      var el = L.el; L.stopVideo(); el.classList.remove('on'); L.open_ = false;
      setTimeout(function () { if (!L.open_) { el.querySelector('.lbv').innerHTML = ''; el.querySelector('.lbv').style.transform = ''; el.style.background = ''; el.querySelector('.lbm').style.transform = ''; } }, 320);
    },
    cur: function () { return L.items[L.i]; },
    // Три соседних кадра: прошлый, текущий, следующий
    slideHtml: function (it) {
      if (!it) return '';
      var src = abs(it.url), video = /^video\//.test(it.mime || '');
      if (video) return '<div class="lbz vz">' + (it.thumb ? '<img src="' + esc(abs(it.thumb)) + '" alt="" draggable="false">' : '') + '<button class="lbplay" data-l="play" aria-label="Воспроизвести">' + ic('play', 30, 0) + '</button></div>';
      return '<div class="lbz"><img src="' + esc(src) + '" alt="" draggable="false"></div>';
    },
    render: function () {
      var v = L.el.querySelector('.lbv'), n = L.items.length;
      L.stopVideo(); v.style.transition = 'none'; v.style.transform = '';
      v.innerHTML = [-1, 0, 1].map(function (k) { var it = L.items[L.i + k]; return '<div class="lbp" style="left:' + (k * 100) + '%">' + L.slideHtml(it) + '</div>'; }).join('');
      L.z = 1; L.px = L.py = 0;
      var it = L.cur(), t = L.el;
      t.querySelector('.lbh b').textContent = it.who || '';
      t.querySelector('.lbh span').textContent = (it.at ? when(it.at) : '') + (n > 1 ? (it.at ? ' · ' : '') + (L.i + 1) + ' из ' + n : '') + (/^video\//.test(it.mime || '') ? ' · видео' : '');
      var cap = t.querySelector('.lbc'); cap.textContent = it.caption || ''; cap.hidden = !it.caption;
      var strip = t.querySelector('.lbs'); strip.hidden = n < 2;
      if (n > 1) {
        var from = Math.max(0, L.i - 15), to = Math.min(n, from + 31); from = Math.max(0, to - 31);
        strip.innerHTML = L.items.slice(from, to).map(function (x, k) { return '<i class="th' + (from + k === L.i ? ' on' : '') + '" data-l="go" data-i="' + (from + k) + '" style="background-image:url(\'' + esc(abs(x.thumb || x.url)) + '\')"></i>'; }).join('');
        var on = strip.querySelector('.on'); if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + 17;
      }
      var mine = it.sid === B.S.user.id && it.mid, bar = t.querySelector('.lbb');
      bar.querySelector('[data-l="del"]').hidden = !mine; bar.querySelector('[data-l="fwd"]').hidden = !it.mid || B.S.secretChatIds.has(B.msgs.chatId);
    },
    go: function (k, animate) {
      var n = L.i + k; if (n < 0 || n >= L.items.length) return;
      var v = L.el.querySelector('.lbv'), w = L.el.querySelector('.lbm').clientWidth;
      if (!animate) { L.i = n; L.render(); return; }
      v.style.transition = 'transform .26s var(--ease)'; v.style.transform = 'translateX(' + (-k * w) + 'px)';
      setTimeout(function () { L.i = n; L.render(); }, 250);
    },
    toggleChrome: function () { L.chrome = !L.chrome; L.el.classList.toggle('hc', !L.chrome); },
    applyZoom: function (anim) {
      var z = L.el.querySelector('.lbp:nth-child(2) .lbz'); if (!z) return;
      z.style.transition = anim ? 'transform .22s var(--ease)' : 'none';
      z.style.transform = 'translate(' + L.px + 'px,' + L.py + 'px) scale(' + L.z + ')';
      L.el.classList.toggle('zoomed', L.z > 1.02);
    },
    clamp: function () {
      var m = L.el.querySelector('.lbm'), w = m.clientWidth, h = m.clientHeight, mx = Math.max(0, (w * L.z - w) / 2), my = Math.max(0, (h * L.z - h) / 2);
      L.px = Math.max(-mx, Math.min(mx, L.px)); L.py = Math.max(-my, Math.min(my, L.py));
    },
    bindGestures: function (box) {
      var P = new Map(), g = null, last = { t: 0, x: 0, y: 0 }, tapT = null;
      var dist = function () { var a = Array.from(P.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
      box.addEventListener('pointerdown', function (e) {
        if (e.target.closest('[data-l],.lbvc')) return;
        P.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { box.setPointerCapture(e.pointerId); } catch (_) {}
        if (P.size === 2) { g = { mode: 'pinch', d0: dist(), z0: L.z }; return; }
        g = { mode: null, x: e.clientX, y: e.clientY, t: performance.now(), px0: L.px, py0: L.py, dx: 0, dy: 0 };
      });
      box.addEventListener('pointermove', function (e) {
        if (!P.has(e.pointerId) || !g) return;
        P.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (g.mode === 'pinch' && P.size >= 2) { L.z = Math.max(1, Math.min(5, g.z0 * dist() / g.d0)); L.clamp(); L.applyZoom(false); return; }
        if (P.size !== 1) return;
        var dx = e.clientX - g.x, dy = e.clientY - g.y; g.dx = dx; g.dy = dy;
        if (!g.mode) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          g.mode = L.z > 1.02 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
        var v = L.el.querySelector('.lbv');
        if (g.mode === 'pan') { L.px = g.px0 + dx; L.py = g.py0 + dy; L.clamp(); L.applyZoom(false); }
        else if (g.mode === 'h') {
          var edge = (L.i === 0 && dx > 0) || (L.i === L.items.length - 1 && dx < 0);
          v.style.transition = 'none'; v.style.transform = 'translateX(' + (edge ? dx / 3 : dx) + 'px)';
        } else if (g.mode === 'v') {
          var m = L.el.querySelector('.lbm'); m.style.transform = 'translateY(' + dy + 'px)'; L.el.style.background = 'rgba(0,0,0,' + Math.max(0.15, 1 - Math.abs(dy) / 500) + ')';
        }
      });
      var end = function (e) {
        if (!P.has(e.pointerId)) return; P.delete(e.pointerId);
        if (!g) return;
        if (g.mode === 'pinch') { if (P.size < 2) { if (L.z < 1.05) { L.z = 1; L.px = L.py = 0; } L.applyZoom(true); g = null; } return; }
        var mode = g.mode, dx = g.dx, dy = g.dy, dt = performance.now() - g.t; g = null;
        var m = L.el.querySelector('.lbm'), w = m.clientWidth;
        if (mode === 'h') {
          if ((Math.abs(dx) > w * 0.2 || Math.abs(dx) / dt > 0.5) && ((dx < 0 && L.i < L.items.length - 1) || (dx > 0 && L.i > 0))) L.go(dx < 0 ? 1 : -1, true);
          else { var v = L.el.querySelector('.lbv'); v.style.transition = 'transform .22s var(--ease)'; v.style.transform = ''; }
        } else if (mode === 'v') {
          if (Math.abs(dy) > 110 || Math.abs(dy) / dt > 0.6) { m.style.transition = 'transform .22s'; m.style.transform = 'translateY(' + (dy > 0 ? 100 : -100) + '%)'; L.el.style.transition = 'opacity .22s'; L.el.style.opacity = '0'; setTimeout(function () { L.close(); m.style.transition = ''; L.el.style.transition = ''; L.el.style.opacity = ''; }, 230); }
          else { m.style.transition = 'transform .2s var(--ease)'; m.style.transform = ''; L.el.style.background = ''; setTimeout(function () { m.style.transition = ''; }, 220); }
        } else if (mode === 'pan') L.applyZoom(false);
        else if (!mode) {
          // нажатие без движения: двойное — увеличить, одинарное — спрятать или показать панели
          var now = performance.now(), isVid = /^video\//.test(L.cur().mime || '');
          if (!isVid && now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
            clearTimeout(tapT); last.t = 0;
            var r = m.getBoundingClientRect();
            if (L.z > 1.02) { L.z = 1; L.px = L.py = 0; } else { L.z = 2.6; L.px = (r.left + r.width / 2 - e.clientX) * (L.z - 1); L.py = (r.top + r.height / 2 - e.clientY) * (L.z - 1); L.clamp(); }
            L.applyZoom(true);
          } else { last = { t: now, x: e.clientX, y: e.clientY }; clearTimeout(tapT); tapT = setTimeout(L.toggleChrome, isVid ? 0 : 280); }
        }
      };
      box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    },
    // ── видео ──
    stopVideo: function () {
      if (L.vid) { try { L.vid.pause(); } catch (e) {} L.vid.removeAttribute('src'); L.vid.load && L.vid.load(); L.vid = null; }
      var c = L.el && L.el.querySelector('.lbvc'); if (c) { c.hidden = true; c.innerHTML = ''; }
    },
    play: function () {
      var it = L.cur(), z = L.el.querySelector('.lbp:nth-child(2) .lbz'); if (!z) return;
      L.stopVideo();
      var vd = document.createElement('video'); vd.playsInline = true; vd.setAttribute('playsinline', ''); vd.src = abs(it.url); vd.preload = 'auto';
      if (it.thumb) vd.poster = abs(it.thumb);
      z.innerHTML = ''; z.appendChild(vd); L.vid = vd;
      var c = L.el.querySelector('.lbvc'), pipOk = !!(document.pictureInPictureEnabled || vd.webkitSupportsPresentationMode);
      c.innerHTML = '<div class="vbar"><i></i><b></b></div><div class="vtm"><span class="cur">0:00</span><span class="rem">-0:00</span></div><div class="vbt"><button data-l="v10" aria-label="Назад на 10 секунд">' + ic('refresh', 22, 1.8) + '</button><button class="vp" data-l="vpp" aria-label="Пауза">' + ic('pause', 30, 0) + '</button><button class="vs" data-l="vsp">1×</button>' + (pipOk ? '<button data-l="vpip" aria-label="Картинка в картинке">' + ic('pip', 22, 1.8) + '</button>' : '<span></span>') + '</div>';
      c.hidden = false;
      var bar = c.querySelector('.vbar'), fill = bar.firstChild, knob = bar.lastChild, cur = c.querySelector('.cur'), rem = c.querySelector('.rem'), pp = c.querySelector('.vp');
      var fm = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
      vd.addEventListener('timeupdate', function () { var d = vd.duration || 0, p = d ? vd.currentTime / d * 100 : 0; fill.style.width = p + '%'; knob.style.left = p + '%'; cur.textContent = fm(vd.currentTime); rem.textContent = '-' + fm(d - vd.currentTime); });
      var icon = function () { pp.innerHTML = ic(vd.paused ? 'play' : 'pause', 30, 0); };
      vd.addEventListener('play', icon); vd.addEventListener('pause', icon); vd.addEventListener('ended', icon);
      var seek = function (e) { var r = bar.getBoundingClientRect(); vd.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (vd.duration || 0); };
      var drag = false; bar.addEventListener('pointerdown', function (e) { drag = true; try { bar.setPointerCapture(e.pointerId); } catch (_) {} seek(e); });
      bar.addEventListener('pointermove', function (e) { if (drag) seek(e); }); bar.addEventListener('pointerup', function () { drag = false; });
      vd.play().catch(function () {});
    },
    onClick: function (e) {
      var t = e.target.closest('[data-l]'); if (!t) return; var a = t.dataset.l, it = L.cur();
      if (a === 'close') L.close();
      else if (a === 'play') L.play();
      else if (a === 'go') { var n = +t.dataset.i; L.go(n - L.i, false); }
      else if (a === 'vpp') { if (L.vid) { if (L.vid.paused) L.vid.play(); else L.vid.pause(); } }
      else if (a === 'v10') { if (L.vid) L.vid.currentTime = Math.max(0, L.vid.currentTime - 10); }
      else if (a === 'vsp') { if (L.vid) { var sp = { 1: 1.5, 1.5: 2, 2: 1 }[L.vid.playbackRate] || 1; L.vid.playbackRate = sp; t.textContent = (sp === 1.5 ? '1,5' : sp) + '×'; } }
      else if (a === 'vpip') { try { if (document.pictureInPictureElement) document.exitPictureInPicture(); else if (L.vid.requestPictureInPicture) L.vid.requestPictureInPicture(); else if (L.vid.webkitSetPresentationMode) L.vid.webkitSetPresentationMode('picture-in-picture'); } catch (er) {} }
      else if (a === 'share') share(it);
      else if (a === 'save') share(it, null, true);
      else if (a === 'fwd') { var fm = forwardOf(it); L.close(); if (fm && B.ui.msgmenu.forward) setTimeout(function () { B.ui.msgmenu.forward(fm); }, 260); }
      else if (a === 'del') {
        var many = it.total > 1;
        B.actions.confirm(many ? 'Удалить сообщение со всеми вложениями (' + it.total + ')?' : 'Удалить сообщение?', '', 'Удалить', function () {
          B.msgs.remove(it.mid); B.toast.show('Сообщение удалено');
          L.items = L.items.filter(function (x) { return x.mid !== it.mid; });
          if (!L.items.length) L.close(); else { L.i = Math.min(L.i, L.items.length - 1); L.render(); }
        });
      }
      else if (a === 'more') {
        var items = [];
        if (it.mid && B.msgs.find(it.mid)) items.push({ l: 'Показать в чате', f: function () { L.close(); var el = B.ui.chat.activePage(); if (el) { while (B.nav.top().el !== el) B.nav.pop(); B.ui.chat.open(+el.dataset.cid, it.mid); } } });
        items.push({ l: 'Скачать', f: function () { download(it); } });
        B.actions.show({ title: it.name || '', items: items });
      }
    }
  };
  B.lightbox = L;

  // ── карточка файла ──
  function openFile(mid, i) {
    var m = B.msgs.find(mid); if (!m || !m.attachment) return;
    var a = listOf(m.attachment)[i]; if (!a) return;
    openFileItem({ mid: mid, i: i, url: a.url, name: a.name, mime: a.mime, size: a.size, who: m.sender_name, at: m.sent_at, sid: m.sender_id, total: listOf(m.attachment).length, text: m.text || '' });
  }
  function openFileItem(it) {
    var el = B.nav.page({ title: 'Файл', gray: true, back: 'Назад', body: '' });
    var ext = ((it.name || '').split('.').pop() || '').slice(0, 4).toUpperCase();
    el.querySelector('.scroll').innerHTML = '<div class="fcard"><div class="fci">' + ic('doc', 56, 1.4) + '<b>' + esc(ext) + '</b></div><div class="fcn">' + esc(it.name || 'Файл') + '</div>' +
      '<div class="fcm">' + esc([fmtSize(it.size), it.who, it.at ? when(it.at) : ''].filter(Boolean).join(' · ')) + '</div><div class="fcp" hidden><i></i></div><div class="fcs" hidden></div></div>' +
      '<div class="grp"><button class="cell tap hasi" data-f="share"><span class="ci" style="background:var(--accent)">' + ic('share', 17, 2) + '</span><span class="cl">Открыть в…</span></button>' +
      '<button class="cell tap hasi" data-f="save"><span class="ci" style="background:#34c759">' + ic('dl', 17, 2) + '</span><span class="cl">Сохранить</span></button>' +
      (it.mid && !B.S.secretChatIds.has(B.msgs.chatId) ? '<button class="cell tap hasi" data-f="fwd"><span class="ci" style="background:#5e6ad2">' + ic('fwd', 17, 2) + '</span><span class="cl">Переслать</span></button>' : '') + '</div>' +
      '<div class="gf">Файл открывается через системный лист «Поделиться»: так он попадёт в «Файлы», «Почту» или любое приложение.</div>';
    var prog = el.querySelector('.fcp'), st = el.querySelector('.fcs');
    var onP = function (p) { prog.hidden = false; st.hidden = false; prog.firstChild.style.width = p + '%'; st.textContent = 'Скачивание ' + p + '%'; };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]'); if (!b) return;
      if (b.dataset.f === 'share') share(it, onP).then(function () { prog.hidden = st.hidden = true; });
      else if (b.dataset.f === 'save') share(it, onP, true).then(function () { prog.hidden = st.hidden = true; });
      else if (b.dataset.f === 'fwd') { var fm = forwardOf(it); if (fm) B.ui.msgmenu.forward(fm); }
    });
    B.nav.push(el, 'Файл');
  }

  // ── «Медиа чата» ──
  var TABS = [['media', 'Медиа'], ['files', 'Файлы'], ['links', 'Ссылки']];
  function openChatMedia(cid) {
    var chat = B.find(cid); if (!chat) return;
    var st = { tab: 'media', data: {}, more: {}, cursor: {}, busy: false };
    var el = B.nav.page({ title: 'Медиа', gray: true, back: B.chatName(chat) || 'Назад', body: '' });
    el.classList.add('mpage');
    var sc = el.querySelector('.scroll');
    sc.innerHTML = '<div class="mseg seg2">' + TABS.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === 'media' ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="mbody"></div>';
    var body = sc.querySelector('.mbody');
    function monthKey(ts) { var d = new Date(ts * 1000); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
    function paint() {
      var list = st.data[st.tab] || [], h = '';
      if (!list.length) { body.innerHTML = st.more[st.tab] === undefined ? '<div class="stub-note">Загрузка…</div>' : '<div class="empty"><b>' + (st.tab === 'media' ? 'Фото и видео нет' : st.tab === 'files' ? 'Файлов нет' : 'Ссылок нет') + '</b></div>'; return; }
      var last = '';
      list.forEach(function (x, k) {
        var mk = monthKey(x.sent_at);
        if (mk !== last) { if (last) h += st.tab === 'media' ? '</div>' : '</div>'; h += '<div class="hdr-s">' + mk + '</div><div class="' + (st.tab === 'media' ? 'mgrid' : 'grp') + '">'; last = mk; }
        if (st.tab === 'media') h += '<button class="mt" data-k="' + k + '" style="background-image:url(\'' + esc(abs(x.att.thumb || x.att.url)) + '\')">' + (/^video\//.test(x.att.mime) ? '<span class="mv">' + ic('play', 14, 0) + '</span>' : '') + '</button>';
        else if (st.tab === 'files') h += '<button class="crow2" data-k="' + k + '"><span class="mfi">' + ic('doc', 22, 1.7) + '</span><div class="t"><b>' + esc(x.att.name || 'Файл') + '</b><span>' + esc([fmtSize(x.att.size), x.sender_name, when(x.sent_at)].join(' · ')) + '</span></div></button>';
        else h += '<a class="crow2" href="' + esc(x.urls[0]) + '" target="_blank" rel="noopener noreferrer"><span class="mfi">' + ic('link', 22, 1.7) + '</span><div class="t"><b>' + esc(x.title || x.site || x.urls[0]) + '</b><span>' + esc(x.urls[0].replace(/^https?:\/\//, '').slice(0, 60)) + ' · ' + esc(x.sender_name) + ' · ' + when(x.sent_at) + '</span></div></a>';
      });
      body.innerHTML = h + '</div>' + (st.more[st.tab] ? '<div class="stub-note">Загрузка…</div>' : '');
    }
    async function load() {
      var tab = st.tab; if (st.busy || st.more[tab] === false) return; st.busy = true;
      var r = await B.api('GET', '/messages/chat/' + cid + '/media?type=' + tab + (st.cursor[tab] ? '&before=' + st.cursor[tab] : ''));
      st.busy = false;
      if (!r || r.error) { st.more[tab] = false; if (tab === st.tab) paint(); return; }
      st.data[tab] = (st.data[tab] || []).concat(r.items.map(function (x) { x.sent_at = x.sent_at; return x; }));
      st.more[tab] = !!r.more; st.cursor[tab] = r.cursor;
      if (tab === st.tab) paint();
    }
    sc.addEventListener('scroll', function () { if (st.more[st.tab] && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 500) load(); }, { passive: true });
    el.addEventListener('click', function (e) {
      var tb = e.target.closest('.mseg [data-t]');
      if (tb) { st.tab = tb.dataset.t; el.querySelectorAll('.mseg button').forEach(function (b) { b.classList.toggle('on', b === tb); }); paint(); if (st.more[st.tab] === undefined) load(); return; }
      var k = e.target.closest('[data-k]'); if (!k) return;
      var list = st.data[st.tab], x = list[+k.dataset.k];
      if (st.tab === 'media') {
        var items = list.map(function (y) { return { mid: y.message_id, i: y.idx, url: y.att.url, thumb: y.att.thumb, mime: y.att.mime, name: y.att.name, size: y.att.size, w: y.att.width, h: y.att.height, who: y.sender_name, at: y.sent_at, caption: y.caption, sid: y.sender_id, total: 1, text: y.caption }; });
        L.open(items, +k.dataset.k);
      } else if (st.tab === 'files') openFileItem({ mid: x.message_id, i: x.idx, url: x.att.url, name: x.att.name, mime: x.att.mime, size: x.att.size, who: x.sender_name, at: x.sent_at, sid: x.sender_id, total: 1, text: x.caption });
    });
    B.nav.push(el, 'Медиа'); paint(); load();
  }

  return { openMsg: openMsg, openFile: openFile, openChatMedia: openChatMedia, isMedia: isMedia, listOf: listOf, fmtSize: fmtSize };
})();
