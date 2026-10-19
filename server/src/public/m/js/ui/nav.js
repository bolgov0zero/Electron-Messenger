// /m — навигация: стек страниц со свайпом назад от левого края (как в iOS).
// Страница — это .page внутри #stack: верхняя панель, область прокрутки и, при необходимости, нижняя панель.
B.nav = {
  stack: [], el: null,
  init: function (stackEl) {
    this.el = stackEl;
    stackEl.addEventListener('click', function (e) { if (e.target.closest('[data-nav="back"]')) B.nav.pop(); });
    this._gesture(stackEl);
  },
  // Корневая страница (вкладки): всегда внизу стека
  setRoot: function (el) { el.classList.add('base'); this.el.appendChild(el); this.stack = [{ el: el, title: '' }]; },
  depth: function () { return this.stack.length; },
  top: function () { return this.stack[this.stack.length - 1]; },

  // Собирает стандартную страницу: o = { title, back (подпись), right, body, bottom, gray, cls }
  page: function (o) {
    var el = document.createElement('div');
    el.className = 'page' + (o.gray ? ' gray' : '') + (o.bottom ? '' : ' nobot') + (o.cls ? ' ' + o.cls : '');
    var prev = this.top(), back = o.back !== undefined ? o.back : (prev && prev.title) || 'Назад';
    el.innerHTML =
      '<div class="nav fix"><div class="nav-in">' +
        '<div class="nl"><button class="nb back" data-nav="back" aria-label="Назад">' + B.ic('back', 28, 2.4) + '<span class="cnt">' + B.esc(back) + '</span></button></div>' +
        '<div class="nt">' + (o.title || '') + '</div><div class="nr">' + (o.right || '') + '</div></div></div>' +
      '<div class="scroll">' + (o.body || '') + '</div>' + (o.bottom ? '<div class="bottom">' + o.bottom + '</div>' : '');
    el._title = o.title || '';
    return el;
  },
  push: function (el, title) {
    var prev = this.top(); if (!prev) return;
    B.kbd && B.kbd.hide && B.kbd.hide();
    el.classList.add('enter'); this.el.appendChild(el);
    this.stack.push({ el: el, title: title !== undefined ? title : el._title || '' });
    void el.offsetWidth;                       // принудительный пересчёт: следующая смена класса запустит переход
    el._t0 = performance.now();                // когда началось выезжание: тяжёлую отрисовку содержимого откладываем до его конца
    el.classList.remove('enter'); prev.el.classList.add('under');
    B.bus.emit('nav:changed');
  },
  pop: function () {
    if (this.stack.length < 2) return;
    var top = this.stack.pop(), under = this.top().el;
    top.el.classList.remove('drag'); under.classList.remove('drag'); void top.el.offsetWidth;
    top.el.style.transform = 'translateX(100%)'; under.style.transform = ''; under.classList.remove('under');
    setTimeout(function () { top.el.remove(); }, 420);
    B.bus.emit('nav:changed', { popped: top.el });
  },
  popToRoot: function () { while (this.stack.length > 1) this.pop(); },

  // Свайп назад: тянем верхнюю страницу за левый край, нижняя едет следом с параллаксом
  _gesture: function (host) {
    var G = null, N = this;
    host.addEventListener('pointerdown', function (e) {
      if (N.stack.length < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('input,textarea,[contenteditable]')) return;
      var r = host.getBoundingClientRect();
      if (e.clientX - r.left > 22) return;
      G = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: null, w: r.width };
    });
    host.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = e.clientX - G.x, dy = e.clientY - G.y;
      if (!G.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (!(dx > 0 && Math.abs(dx) > Math.abs(dy))) { G = null; return; }
        G.mode = 'back'; G.top = N.top().el; G.und = N.stack[N.stack.length - 2].el;
        G.top.classList.add('drag'); G.und.classList.add('drag');
        try { host.setPointerCapture(e.pointerId); } catch (_) {}
      }
      var x = Math.max(0, dx);
      G.top.style.transform = 'translateX(' + x + 'px)';
      G.und.style.transform = 'translateX(' + (-30 * (1 - Math.min(1, x / G.w))) + '%)';
    });
    function end(e, cancel) {
      if (!G || e.pointerId !== G.id) return;
      var g = G; G = null; if (!g.mode) return;
      var dx = e.clientX - g.x, dt = performance.now() - g.t;
      if (!cancel && (dx > g.w * 0.33 || dx / dt > 0.6)) { N.pop(); return; }  // pop сам доведёт страницу до края из текущего положения
      g.top.classList.remove('drag'); g.und.classList.remove('drag'); g.top.style.transform = ''; g.und.style.transform = '';
    }
    host.addEventListener('pointerup', function (e) { end(e, false); });
    host.addEventListener('pointercancel', function (e) { end(e, true); });
  }
};
