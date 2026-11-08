// /m — панель пространств: список чатов сдвигается вправо до середины окна и открывает слева выбор пространства.
// Открывается свайпом вправо по списку (за пальцем), закрывается свайпом влево, нажатием на сдвинутый список или выбором.
// Работает при включённом «Отображать пространства» (Настройки), только на корневом экране вкладки «Чаты».
B.ui = B.ui || {};
B.ui.spaces = (function () {
  var SP = B.spaces, esc = B.esc;
  var COLORS = ['#30b46c', '#8e6cf0', '#f0a030', '#ec5b8f', '#2fb8c4', '#e8604c'];
  var tv = null, drawer = null, W = 0, isOpen = false, G = null, closeT = null, noClickUntil = 0;
  function ini(n) { var w = String(n || '?').trim().split(/\s+/); return ((w[0] || '?')[0] + (w.length > 1 ? w[1][0] : (w[0][1] || ''))).toUpperCase(); }
  function plural(n) { return n === 1 ? 'сервер' : n < 5 ? 'сервера' : 'серверов'; }
  function ppl(n) { var a = n % 10, b = n % 100; return n + ' ' + (a === 1 && b !== 11 ? 'человек' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'человека' : 'человек'); }

  function item(id, icon, name, sub, color, on, n) {
    return '<button class="spi' + (on ? ' on' : '') + '" data-sp-id="' + id + '" style="--fc:' + color + '"><span class="spi-ic">' + icon + '</span><span class="spi-t"><b>' + esc(name) + '</b><small>' + esc(sub) + '</small></span>' +
      (n ? '<span class="bd">' + (n > 99 ? '99+' : n) + '</span>' : '') + '</button>';
  }
  function paint() {
    if (!drawer) return;
    drawer.innerHTML = '<div class="gh">Пространства</div><div class="grp glass">' +
      item('all', B.ic('grid', 20, 2), 'Общий вид', 'Все чаты и контакты', '#3390ec', SP.filter === 'all', SP.unread('all')) +
      SP.list.map(function (s, i) { return item(s.id, '<b>' + esc(ini(s.name)) + '</b>', s.name, s.shared ? 'Общее · ' + s.servers + ' ' + plural(s.servers) : ppl(s.people), COLORS[i % COLORS.length], SP.filter === s.id, SP.unread(s.id)); }).join('') +
      '</div><div class="gf">Выбранное пространство оставляет в чатах и контактах только людей из него и чаты с ними.</div>';
  }
  function ensure() {
    if (drawer) return true;
    tv = document.querySelector('.tabview[data-tab="chats"]'); if (!tv) return false;
    drawer = document.createElement('div'); drawer.className = 'spdr'; tv.parentNode.insertBefore(drawer, tv);
    drawer.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sp-id]'); if (!b) return;
      SP.select(b.dataset.spId === 'all' ? 'all' : +b.dataset.spId);
      setTimeout(close, 120);
    });
    // Пока список сдвинут, любое нажатие по нему закрывает панель; после жеста случайное нажатие не открывает чат
    tv.addEventListener('click', function (e) {
      if (isOpen || performance.now() < noClickUntil) { e.stopPropagation(); e.preventDefault(); if (isOpen) close(); }
    }, true);
    return true;
  }
  function setX(x, anim) {
    tv.style.transition = anim ? 'transform .34s cubic-bezier(.32,.72,0,1), box-shadow .34s' : 'none';
    tv.style.transform = x ? 'translateX(' + x + 'px)' : '';
    tv.style.boxShadow = x ? '-10px 0 28px rgba(0,0,0,' + (.28 * Math.min(1, x / Math.max(1, W))).toFixed(2) + ')' : '';
  }
  function width() { return Math.round((tv.offsetWidth || window.innerWidth) / 2); }
  function open() {
    if (!SP.shown() || !ensure() || B.nav.depth() > 1) return;
    clearTimeout(closeT); W = width(); paint();
    drawer.style.visibility = 'visible'; tv.classList.add('spslide', 'sp-open'); isOpen = true;
    void tv.offsetWidth; setX(W, true);
  }
  function close() {
    if (!tv || (!isOpen && !tv.classList.contains('spslide'))) return;
    isOpen = false; tv.classList.remove('sp-open'); setX(0, true);
    clearTimeout(closeT);
    closeT = setTimeout(function () { if (!isOpen) { tv.classList.remove('spslide'); tv.style.transition = ''; tv.style.boxShadow = ''; drawer.style.visibility = 'hidden'; } }, 380);
  }

  // Жест: правее 10 px и заметно горизонтальный — список следует за пальцем до середины окна
  function attach(view) {
    if (!view) return;
    view.addEventListener('pointerdown', function (e) {
      if ((e.pointerType === 'mouse' && e.button !== 0) || !SP.shown() || B.nav.depth() > 1) return;
      if (e.target.closest('input,textarea')) return;
      var fin = e.target.closest('.fin'); if (fin && fin.scrollLeft > 0 && !isOpen) return;   // папки листаются сами
      if (!ensure()) return;
      G = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: isOpen ? 'wait-close' : 'wait', base: isOpen ? width() : 0, lx: e.clientX, lt: performance.now(), v: 0, cur: 0 };
    }, true);
    view.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = e.clientX - G.x, dy = e.clientY - G.y;
      if (G.mode === 'wait' || G.mode === 'wait-close') {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { G = null; return; }
        var right = G.mode === 'wait' && dx > 10 && dx > Math.abs(dy) * 1.3, left = G.mode === 'wait-close' && dx < -10 && -dx > Math.abs(dy) * 1.3;
        if (!right && !left) return;
        G.mode = 'drag'; W = width(); paint(); drawer.style.visibility = 'visible'; tv.classList.add('spslide');
        try { view.setPointerCapture(e.pointerId); } catch (_) {}
        G.x = e.clientX; dx = 0;
      }
      if (G.mode !== 'drag') return;
      e.stopPropagation();
      var x = Math.max(0, Math.min(W, G.base + dx)), now = performance.now();
      G.v = (e.clientX - G.lx) / Math.max(1, now - G.lt); G.lx = e.clientX; G.lt = now; G.cur = x;
      setX(x, false);
    }, true);
    var up = function (e, cancelled) {
      if (!G || e.pointerId !== G.id) return;
      var g = G; G = null;
      if (g.mode !== 'drag') return;
      noClickUntil = performance.now() + 400;
      var openIt = !cancelled && (g.cur > W * 0.4 || g.v > 0.5) && g.v > -0.5;
      if (openIt) { isOpen = true; tv.classList.add('sp-open'); setX(W, true); } else { isOpen = true; close(); }
    };
    view.addEventListener('pointerup', function (e) { up(e, false); }, true);
    view.addEventListener('pointercancel', function (e) { up(e, true); }, true);
  }
  B.bus.on('spaces:changed', function () { if (isOpen) { if (!SP.shown()) close(); else paint(); } });
  B.bus.on('nav:changed', function () { if (isOpen && B.nav.depth() > 1) close(); });
  return { open: open, close: close, attach: attach };
})();
