// /beta — шторки (page sheet), листы действий (action sheet) и уведомления. Вид — как системные в iOS.
B.sheet = {
  el: null, cur: null,
  init: function (root) {
    this.el = document.createElement('div'); this.el.className = 'shl'; root.appendChild(this.el);
    this.el.addEventListener('click', function (e) {
      if (e.target.closest('[data-sheet="close"]')) B.sheet.close();
    });
  },
  // o = { title, left, right, body, size: 'large' | 'med', onClose }
  open: function (o) {
    var l = this.el; B.kbd && B.kbd.hide && B.kbd.hide();
    l.innerHTML = '<div class="shb" data-sheet="close"></div><div class="sh ' + (o.size || 'large') + '"><div class="sh-nav"><div class="l">' + (o.left || '') + '</div><div class="t">' + (o.title || '') + '</div><div class="r">' + (o.right || '') + '</div></div><div class="sh-body">' + (o.body || '') + '</div></div>';
    this.cur = o; void l.offsetWidth; l.classList.add('on');
    if (o.size !== 'med') document.getElementById('app').classList.add('sheeted');
    this._drag(l.querySelector('.sh'));
  },
  // Заменяет содержимое открытой шторки (переход между шагами)
  set: function (o) {
    var sh = this.el.querySelector('.sh'); if (!sh) return;
    sh.querySelector('.sh-nav .l').innerHTML = o.left || ''; sh.querySelector('.sh-nav .t').innerHTML = o.title || '';
    sh.querySelector('.sh-nav .r').innerHTML = o.right || ''; sh.querySelector('.sh-body').innerHTML = o.body || '';
    this.cur = Object.assign({}, this.cur, o);
  },
  body: function () { return this.el.querySelector('.sh-body'); },
  isOpen: function () { return this.el.classList.contains('on'); },
  close: function () {
    var l = this.el, o = this.cur; l.classList.remove('on'); document.getElementById('app').classList.remove('sheeted');
    B.kbd && B.kbd.hide && B.kbd.hide();
    setTimeout(function () { if (!l.classList.contains('on')) { l.innerHTML = ''; B.sheet.cur = null; } }, 520);
    if (o && o.onClose) o.onClose();
  },
  // Свайп вниз за заголовок закрывает шторку
  _drag: function (sh) {
    var nv = sh.querySelector('.sh-nav'), y0 = null, dy = 0;
    nv.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      y0 = e.clientY; dy = 0; sh.style.transition = 'none'; try { nv.setPointerCapture(e.pointerId); } catch (_) {}
    });
    nv.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = 'translateY(' + dy + 'px)'; });
    var end = function () { if (y0 == null) return; y0 = null; sh.style.transition = ''; if (dy > 100) B.sheet.close(); else sh.style.transform = ''; };
    nv.addEventListener('pointerup', end); nv.addEventListener('pointercancel', end);
  }
};

B.actions = {
  el: null, cur: null,
  init: function (root) {
    this.el = document.createElement('div'); this.el.className = 'asl'; root.appendChild(this.el);
    this.el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-as]'); if (!b) return;
      var o = B.actions.cur, i = b.dataset.as;
      B.actions.close();
      if (i !== 'cancel' && o && o.items[+i] && o.items[+i].f) setTimeout(o.items[+i].f, 60);
    });
  },
  // o = { title, msg, items: [{ l, d (опасное), f (действие) }] }
  show: function (o) {
    this.cur = o; B.kbd && B.kbd.hide && B.kbd.hide();
    var esc = B.esc;
    this.el.innerHTML = '<div class="asb" data-as="cancel"></div><div class="as"><div class="asg">' +
      (o.title || o.msg ? '<div class="ash">' + esc(o.title || '') + (o.msg ? '<br><span>' + esc(o.msg) + '</span>' : '') + '</div>' : '') +
      o.items.map(function (it, i) { return '<button class="' + (it.d ? 'd' : '') + '" data-as="' + i + '">' + esc(it.l) + '</button>'; }).join('') +
      '</div><div class="asg solid"><button class="b" data-as="cancel">Отмена</button></div></div>';
    void this.el.offsetWidth; this.el.classList.add('on');
  },
  // Подтверждение опасного действия
  confirm: function (title, msg, label, fn) { this.show({ title: title, msg: msg, items: [{ l: label, d: 1, f: fn }] }); },
  close: function () { var l = this.el; l.classList.remove('on'); setTimeout(function () { if (!l.classList.contains('on')) l.innerHTML = ''; }, 440); }
};

B.toast = {
  el: null, _t: null,
  init: function (root) {
    this.el = document.createElement('div'); this.el.className = 'toast'; root.appendChild(this.el);
    this.el.addEventListener('click', function () { var f = B.toast._tap; if (f) { B.toast.hide(); f(); } });
  },
  show: function (msg) { this._put('toast', B.esc(msg), null, 1900); },
  // Баннер нового сообщения в приложении: html — готовая разметка (аватар, имя, текст), tap — действие по нажатию
  banner: function (html, tap) { this._put('toast pn', html, tap, 3400); },
  hide: function () { this.el.classList.remove('on'); },
  _put: function (cls, html, tap, ms) {
    var el = this.el; clearTimeout(this._t); this._tap = tap;
    el.className = cls; el.innerHTML = html; void el.offsetWidth; el.classList.add('on');
    this._t = setTimeout(function () { el.classList.remove('on'); }, ms);
  }
};
