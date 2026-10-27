// /beta — каркас интерфейса по макету Liquid Glass: оболочка-«телефон» 393 px (на телефоне масштабируется на всю ширину),
// стек страниц со свайпом назад, шторки, меню-оверлей, тосты, клавиатура. Разметка и классы — как в макете (mock.html).
// Данные и сеть — ядро (core/*); здесь только вид и жесты.
B.ui = B.ui || {};
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var esc = B.esc, root = document.documentElement;
var phone = document.getElementById('app'), stack = document.getElementById('stack'), layer = document.getElementById('layer');
var sc = 1;   // масштаб оболочки: 1 на iPhone 393 pt, меньше или больше на других ширинах

function real() { return window.innerWidth <= 520; }   // настоящий телефон: оболочка на весь экран
// Положение элемента внутри оболочки в её собственных (немасштабированных) пикселях
function rel(el) { var a = phone.getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: (r.left - a.left) / sc, y: (r.top - a.top) / sc, w: r.width / sc, h: r.height / sc }; }

// ── размер оболочки, клавиатура ──
B.kbd = { h: 0, hide: function () { hideKb(); } };
function fit() {
  var f = $('.fit');
  if (real()) {
    var full = f.clientHeight || innerHeight, vv = window.visualViewport, kb = vv && vv.height < full - 120;
    // С клавиатурой окно остаётся на всю высоту (фон виден и за полосой «назад / вперёд / готово»), поле ввода поднимается на высоту клавиатуры (--kbh)
    var top = kb ? vv.offsetTop : 0, H = full - top, kbh = kb ? Math.max(0, full - top - vv.height) : 0;
    sc = innerWidth / 393;
    phone.style.width = '393px'; phone.style.height = H / sc + 'px'; phone.style.transform = 'scale(' + sc + ')';
    phone.style.setProperty('--sc', sc); phone.style.setProperty('--kbh', kbh / sc + 'px'); phone.classList.toggle('kbo', kbh > 0);
    phone.style.left = '0'; phone.style.top = top + 'px';
    if ((kbh > 0 ? 1 : 0) !== (B.kbd._o || 0)) { B.kbd._o = kbh > 0 ? 1 : 0; B.kbd.h = kbh; B.bus.emit('kbd:changed', { h: kbh }); }
    return;
  }
  sc = Math.min(f.clientWidth / 453, f.clientHeight / 892, 1.2);
  phone.style.transform = 'scale(' + sc + ')'; phone.style.setProperty('--sc', 1);
  phone.style.left = (f.clientWidth - 393 * sc) / 2 + 'px'; phone.style.top = Math.max(14, (f.clientHeight - 852 * sc) / 2) + 'px';
}
addEventListener('resize', fit);
if (window.visualViewport) {
  visualViewport.addEventListener('scroll', function () { if (real()) fit(); });
  visualViewport.addEventListener('resize', function () { if (!real()) return; fit(); scrollTo(0, 0); B.bus.emit('kbd:changed', { h: B.kbd.h }); });
}
// Поле ввода получило фокус: настоящая клавиатура (телефон) или имитация (компьютер)
function showKb() { phone.classList.remove('ep'); phone.classList.add(real() ? 'kbr' : 'kb'); B.bus.emit('kbd:changed', {}); }
function hideKb() {
  var had = phone.classList.contains('kb') || phone.classList.contains('kbr') || phone.classList.contains('ep');
  phone.classList.remove('kb', 'kbr', 'ep');
  var a = document.activeElement; if (a && a.blur && a.matches && a.matches('input,textarea')) a.blur();
  if (had) B.bus.emit('kbd:changed', {});
}

// ── тема, акцент ──
// Тема: светлая / тёмная / тёмно-синяя. Общая с /chat и /m настройка (electron_v2.settings.theme) хранит только light или dark;
// «тёмно-синяя» запоминается отдельно (beta_navy)
B.theme = {
  TC: { light: '#e3f0ef', dark: '#12171d', navy: '#0f1b27' },
  get: function () { return root.classList.contains('navy') ? 'navy' : root.classList.contains('dark') ? 'dark' : 'light'; },
  set: function (t) {
    var m = document.getElementById('theme-color-meta'); if (m) m.setAttribute('content', B.theme.TC[t] || B.theme.TC.dark);
    root.classList.toggle('dark', t !== 'light'); root.classList.toggle('navy', t === 'navy');
    try {
      localStorage.setItem('beta_theme', t);
      var s = JSON.parse(localStorage.getItem(B.SESSION_KEY) || '{}'); s.settings = s.settings || {};
      if (t === 'light') s.settings.theme = 'light'; else if (!s.settings.theme || s.settings.theme === 'light') s.settings.theme = 'dark';
      localStorage.setItem(B.SESSION_KEY, JSON.stringify(s));
    } catch (e) {}
    var link = document.getElementById('manifest-link'); if (link) link.href = t === 'light' ? '/beta/manifest-light.json' : '/beta/manifest.json';
    B.theme.accent();
  },
  // Акцент макета: те же пять цветов, что у остальных клиентов, но свои оттенки
  ACC: { teal: ['Бирюзовый', [29, 168, 140], [41, 214, 184]], indigo: ['Индиго', [92, 96, 205], [143, 148, 245]], plum: ['Сливовый', [146, 84, 190], [196, 146, 240]], amber: ['Янтарный', [186, 120, 38], [236, 176, 92]] },
  accentKey: function () { var v = null; try { v = localStorage.getItem('accent'); } catch (e) {} return B.theme.ACC[v] ? v : 'teal'; },
  accent: function () {
    var a = B.theme.ACC[B.theme.accentKey()], c = root.classList.contains('dark') ? a[2] : a[1];
    root.style.setProperty('--accent', 'rgb(' + c + ')'); root.style.setProperty('--accent-rgb', c.join(','));
  },
  setAccent: function (k) { if (!B.theme.ACC[k]) return; try { localStorage.setItem('accent', k); } catch (e) {} B.theme.accent(); },
  // «Прозрачность стекла» 0..100 и размер текста
  glass: function () { var v = 50; try { var n = parseInt(localStorage.getItem('beta_glass'), 10); if (n >= 0 && n <= 100) v = n; } catch (e) {} return v; },
  setGlass: function (v, save) { root.style.setProperty('--gl-k', Math.max(0.15, 1.9 - 0.018 * v).toFixed(3)); if (save) try { localStorage.setItem('beta_glass', String(v)); } catch (e) {} },
  FS: { s: [0.9, 'Мелкий'], m: [1, 'Обычный'], l: [1.12, 'Крупный'] },
  fsKey: function () { var f = B.appearance && B.appearance.settings().fontSize; return f === 'small' ? 's' : f === 'large' ? 'l' : 'm'; },
  setFs: function (k) { phone.style.setProperty('--fs', B.theme.FS[k][0]); if (B.appearance) B.appearance.saveSetting('fontSize', k === 's' ? 'small' : k === 'l' ? 'large' : 'medium'); },
  amb: function () { try { return localStorage.getItem('beta_amb') !== '0'; } catch (e) { return true; } },
  setAmb: function (on) { phone.classList.toggle('noamb', !on); try { localStorage.setItem('beta_amb', on ? '1' : '0'); } catch (e) {} },
  init: function () {
    B.theme.accent(); B.theme.setGlass(B.theme.glass()); phone.style.setProperty('--fs', B.theme.FS[B.theme.fsKey()][0]); phone.classList.toggle('noamb', !B.theme.amb());
  }
};
// «Бегунок» сегмента (.seg > .thumb): ставится под активную кнопку
function segMove(seg) { var b = seg && $('button.on', seg), t = seg && $('.thumb', seg); if (!b || !t) return; t.style.left = b.offsetLeft + 'px'; t.style.width = b.offsetWidth + 'px'; }

// ── аватар в стиле макета ──
// o = { id, chat | user (что подгружать), text, dot (id для значка «в сети»), sq (квадрат), type (значок группы), fed, cls }
var AVC = [['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'], ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed']];
function av(o, cls) {
  var c = AVC[(o.id || 0) % AVC.length], attr = '';
  if (o.chat) attr = ' data-av-chat="' + o.chat + '"'; else if (o.user) attr = ' data-av-user="' + o.user + '"';
  var st = o.dot ? (B.S.presence[o.dot] || 'offline') : 'offline';
  return '<span class="av ' + (cls || '') + (o.sq ? ' sq' : '') + '"' + attr + ' style="background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')">' + esc(o.text || '') +
    (o.dot && st !== 'offline' ? '<i class="dot' + (st === 'away' ? ' away' : '') + '"></i>' : '') +
    (o.type ? '<i class="type">' + I('users') + '</i>' : '') + (o.fed ? '<i class="type">' + I('globe') + '</i>' : '') + '</span>';
}

// ── стек страниц ──
// o: { title, back (не выводится: кнопка — стрелка), right, cap (правые кнопки капсулой), lg (большой заголовок), body, cls, nav (своя шапка), bottom, nobot }
B.nav = {
  stack: [], el: null,
  init: function (stackEl) {
    this.el = stackEl;
    stackEl.addEventListener('click', function (e) { if (e.target.closest('[data-back],[data-nav="back"]')) B.nav.pop(); });
    this._gesture(stackEl);
  },
  setRoot: function (el) { el.classList.add('base'); this.el.appendChild(el); this.stack = [{ el: el, title: 'Чаты' }]; },
  depth: function () { return this.stack.length; },
  top: function () { return this.stack[this.stack.length - 1]; },
  amb: '<div class="amb"><i></i><i></i><i></i><i></i></div><i class="edge t"></i><i class="edge b"></i>',
  page: function (o) {
    var el = document.createElement('div'); el.className = 'page' + (o.cls ? ' ' + o.cls : '');
    var nav = o.nav || '<div class="nav' + (o.lg ? ' lg' : '') + '"><button class="nb glass gi" data-back aria-label="Назад">' + I('chevLeft') + '</button><div class="nt"><span class="glass">' + (o.title || '') + '</span></div>' +
      '<div class="nr' + (o.cap ? ' cap glass' : '') + '">' + (o.right || '') + '</div></div>';
    el.innerHTML = B.nav.amb + nav + '<div class="scroll' + (o.nobot === false ? '' : ' nobot') + '">' + (o.lg ? '<h1 class="lt">' + o.title + '</h1>' : '') + (o.body || '') + '</div>' + (o.bottom || '');
    el._title = o.title || ''; B.nav.watch(el);
    return el;
  },
  // У верхней панели появляется затемнение под ней, когда лента прокручена
  watch: function (el) {
    var s = $('.scroll', el), n = $('.nav', el); if (!s || !n) return;
    s.addEventListener('scroll', function () { n.classList.toggle('sc', s.scrollTop > (n.classList.contains('lg') ? 34 : 6)); }, { passive: true });
  },
  push: function (el, title) {
    var prev = this.top(); if (!prev) return;
    hideKb(); el.classList.add('enter'); this.el.appendChild(el);
    this.stack.push({ el: el, title: title !== undefined ? title : el._title || '' });
    void el.offsetWidth; el._t0 = performance.now();
    el.classList.remove('enter'); prev.el.classList.add('under');
    B.bus.emit('nav:changed');
  },
  pop: function () {
    if (this.stack.length < 2) return;
    hideKb();
    var top = this.stack.pop(), under = this.top().el;
    top.el.classList.remove('drag'); under.classList.remove('drag'); void top.el.offsetWidth;
    top.el.style.transform = 'translateX(100%)'; under.style.transform = ''; under.classList.remove('under');
    setTimeout(function () { top.el.remove(); }, 460);
    B.bus.emit('nav:changed', { popped: top.el });
  },
  popToRoot: function () { while (this.stack.length > 1) this.pop(); },
  // Свайп назад от левого края: верхняя страница едет за пальцем, нижняя — следом с параллаксом
  _gesture: function (host) {
    var G = null, N = this;
    host.addEventListener('pointerdown', function (e) {
      if (N.stack.length < 2 || e.target.closest('input,textarea') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var r = phone.getBoundingClientRect(); if ((e.clientX - r.left) / sc > 24) return;
      G = { x: e.clientX, y: e.clientY, id: e.pointerId, m: 0, t: performance.now() };
    });
    host.addEventListener('pointermove', function (e) {
      if (!G || e.pointerId !== G.id) return;
      var dx = (e.clientX - G.x) / sc, dy = (e.clientY - G.y) / sc;
      if (!G.m) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (!(dx > 0 && Math.abs(dx) > Math.abs(dy))) { G = null; return; }
        G.m = 1; G.top = N.top().el; G.und = N.stack[N.stack.length - 2].el; G.top.classList.add('drag'); G.und.classList.add('drag');
        try { host.setPointerCapture(e.pointerId); } catch (_) {}
      }
      var x = Math.max(0, dx); G.top.style.transform = 'translateX(' + x + 'px)'; G.und.style.transform = 'translateX(' + (-28 * (1 - Math.min(1, x / 393))) + '%)';
    });
    var end = function (e, c) {
      if (!G || e.pointerId !== G.id) return; var g = G; G = null; if (!g.m) return;
      var dx = (e.clientX - g.x) / sc, dt = performance.now() - g.t;
      if (!c && (dx > 130 || dx / dt * sc > 0.6)) { N.pop(); return; }
      g.top.classList.remove('drag'); g.und.classList.remove('drag'); g.top.style.transform = ''; g.und.style.transform = '';
    };
    host.addEventListener('pointerup', function (e) { end(e, 0); });
    host.addEventListener('pointercancel', function (e) { end(e, 1); });
  }
};

// ── долгое нажатие ──
function longPress(host, sel, fn) {
  var T = 0, s = null, fired = false;
  host.addEventListener('pointerdown', function (e) {
    var t = e.target.closest(sel); if (!t || e.button > 0) return;
    fired = false; s = { x: e.clientX, y: e.clientY }; clearTimeout(T);
    T = setTimeout(function () { fired = true; try { getSelection().removeAllRanges(); } catch (_) {} fn(t, e); }, 430);
  });
  host.addEventListener('pointermove', function (e) { if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 9) { clearTimeout(T); s = null; } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { host.addEventListener(ev, function () { clearTimeout(T); s = null; }); });
  host.addEventListener('contextmenu', function (e) { var t = e.target.closest(sel); if (t) { e.preventDefault(); clearTimeout(T); fired = true; fn(t, e); } });
  host.addEventListener('click', function (e) { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}

// ── тост и баннер ──
B.toast = {
  _t: 0, _b: 0,
  show: function (m, ic) {
    var t = $('.toast:not(.bn)', layer);
    if (!t) { t = document.createElement('div'); t.className = 'toast glass-pop'; layer.appendChild(t); }
    t.innerHTML = (ic === false ? '' : I(ic || 'check')) + esc(m); void t.offsetWidth; t.classList.add('on');
    clearTimeout(B.toast._t); B.toast._t = setTimeout(function () { t.classList.remove('on'); }, 2200);
  },
  // Баннер (новое сообщение в другом чате, новая версия): html — готовая разметка, tap — действие по нажатию
  banner: function (html, tap) {
    var b = $('.toast.bn', layer);
    if (!b) { b = document.createElement('div'); b.className = 'toast bn glass-pop'; layer.appendChild(b); b.addEventListener('click', function () { var f = b._tap; B.toast.hide(); if (f) f(); }); }
    b._tap = tap; b.innerHTML = html; void b.offsetWidth; b.classList.add('on');
    clearTimeout(B.toast._b); B.toast._b = setTimeout(function () { b.classList.remove('on'); }, 3600);
  },
  hide: function () { var b = $('.toast.bn', layer); if (b) b.classList.remove('on'); }
};

// ── шторки ──
// o: { title, sub, body, onClose }. Содержимое — внутри .sb (прокручивается), кнопки (.abtn) кладём в body
B.sheet = {
  cur: null,
  open: function (o) {
    B.sheet.closeNow();
    hideKb();
    var sc_ = document.createElement('div'); sc_.className = 'scrim';
    var el = document.createElement('div'); el.className = 'sheet glass-pop';
    el.innerHTML = '<div class="gr"></div>' + (o.title ? '<h3>' + o.title + '</h3>' : '') + (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '<div class="sb">' + (o.body || '') + '</div>';
    layer.append(sc_, el); void el.offsetWidth; sc_.classList.add('on'); el.classList.add('on');
    var S = { el: el, scrim: sc_, o: o, close: function () { B.sheet.close(); } };
    B.sheet.cur = S;
    sc_.onclick = function () { B.sheet.close(); };
    // свайп вниз за ручку
    var g = null, gr = $('.gr', el); gr.style.cssText += ';cursor:grab;padding:8px 0;margin-top:-6px;background-clip:content-box;touch-action:none';
    gr.onpointerdown = function (e) { g = { y: e.clientY }; gr.setPointerCapture(e.pointerId); el.style.transition = 'none'; };
    gr.onpointermove = function (e) { if (!g) return; el.style.transform = 'translateY(' + Math.max(0, (e.clientY - g.y) / sc) + 'px)'; };
    gr.onpointerup = function (e) { if (!g) return; var d = (e.clientY - g.y) / sc; g = null; el.style.transition = ''; el.style.transform = ''; if (d > 80) B.sheet.close(); };
    el.addEventListener('click', function (e) { if (e.target.closest('[data-close],[data-sheet="close"]')) B.sheet.close(); });
    return S;
  },
  body: function () { return B.sheet.cur ? $('.sb', B.sheet.cur.el) : null; },
  isOpen: function () { return !!B.sheet.cur; },
  // Заменить содержимое открытой шторки (шаги внутри одной шторки)
  set: function (o) {
    var S = B.sheet.cur; if (!S) return; var el = S.el;
    var h = $('h3', el), sub = $('.sub', el);
    if (o.title !== undefined) { if (h) h.innerHTML = o.title; }
    if (o.sub !== undefined && sub) sub.innerHTML = o.sub;
    if (o.body !== undefined) $('.sb', el).innerHTML = o.body;
  },
  close: function () {
    var S = B.sheet.cur; if (!S) return; B.sheet.cur = null;
    hideKb(); S.el.classList.remove('on'); S.scrim.classList.remove('on');
    setTimeout(function () { S.el.remove(); S.scrim.remove(); }, 420);
    if (S.o.onClose) S.o.onClose();
  },
  closeNow: function () { var S = B.sheet.cur; if (!S) return; B.sheet.cur = null; S.el.remove(); S.scrim.remove(); if (S.o.onClose) S.o.onClose(); }
};
// Лист действий: кнопки-капсулы в шторке. o = { title, msg, items: [{ l, d (опасное), f }] }
B.actions = {
  show: function (o) {
    var S = B.sheet.open({ title: o.title ? esc(o.title) : '', sub: o.msg ? esc(o.msg) : '', body: o.items.map(function (it, i) { return '<button class="abtn' + (it.d ? ' d' : '') + '" data-ai="' + i + '">' + (it.l || '') + '</button>'; }).join('') + '<button class="abtn" data-close>Отмена</button>' });
    S.el.addEventListener('click', function (e) { var b = e.target.closest('[data-ai]'); if (!b) return; var f = o.items[+b.dataset.ai].f; B.sheet.close(); if (f) setTimeout(f, 200); });
  },
  // Подтверждение: danger=false — главная кнопка акцентная
  confirm: function (title, msg, label, fn, danger) {
    var S = B.sheet.open({ title: esc(title), sub: msg ? esc(msg) : '', body: '<button class="abtn ' + (danger === false ? 'pri' : 'd') + '" data-ok>' + esc(label) + '</button><button class="abtn" data-close>Отмена</button>' });
    $('[data-ok]', S.el).onclick = function () { B.sheet.close(); setTimeout(fn, 200); };
  }
};

// ── меню-оверлей: размытый фон, копия элемента поднята над ним, рядом меню и (для сообщений) быстрые реакции ──
// items: [{ l, i (значок), d (опасное), f }, { sp: 1 }]; o: { rx: [эмодзи], mine, onReact, clone: true|false }
B.menu = {
  cur: null,
  open: function (elem, items, o) {
    o = o || {}; B.menu.close();
    var r = rel(elem), rx = o.rx, mine = o.mine, isRow = elem.classList.contains('row');
    var L = document.createElement('div'); L.className = 'cml'; L.innerHTML = '<div class="cmb"></div>';
    var clone = document.createElement('div'); clone.className = 'cmc' + (isRow ? ' glass grp' : ''); clone.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;' + (isRow ? 'border-radius:26px;overflow:hidden' : '');
    clone.innerHTML = elem.classList.contains('bub') ? '<div class="mrow ' + (mine ? 'out' : 'in') + '" style="margin:0">' + elem.outerHTML + '</div>' : elem.outerHTML;
    var inner = clone.firstElementChild; if (inner) inner.style.pointerEvents = 'none';
    var W = 393, H = phone.offsetHeight, menuW = 250, mh = items.reduce(function (s, i) { return s + (i.sp ? 9 : 46); }, 12), rxh = rx ? 52 : 0, gap = 10;
    var chH = Math.min(r.h, 320), top = r.y, minTop = 64 + rxh + gap, maxB = H - 34 - 12;
    if (top < minTop) top = minTop; if (top + chH + gap + mh > maxB) top = maxB - mh - gap - chH; if (top < minTop) top = minTop;
    clone.style.top = top + 'px';
    var mn = document.createElement('div'); mn.className = 'cmm glass-pop';
    mn.innerHTML = items.map(function (it, i) { return it.sp ? '<div class="sp"></div>' : '<button class="' + (it.d ? 'd' : '') + '" data-i="' + i + '"><span>' + it.l + '</span>' + I(it.i || 'dots') + '</button>'; }).join('');
    var mL = mine ? W - 12 - menuW : Math.min(Math.max(r.x, 12), W - 12 - menuW);
    mn.style.left = mL + 'px'; mn.style.top = (top + chH + 6) + 'px';   // зазор под пузырём такой же (6), как между панелью реакций и пузырём mn.style.transformOrigin = (mine ? 'right' : 'left') + ' top';
    L.append(clone); var rxe = null;
    if (rx) {
      rxe = document.createElement('div'); rxe.className = 'cmr glass-pop';
      rxe.innerHTML = rx.map(function (e) { return '<button data-e="' + e + '">' + e + '</button>'; }).join('') + '<button class="more" data-more>' + I('plus') + '</button>';
      rxe.style.top = (top - rxh - gap + 4) + 'px'; rxe.style[mine ? 'right' : 'left'] = (mine ? 12 : Math.max(12, r.x)) + 'px'; rxe.style.transformOrigin = (mine ? 'right' : 'left') + ' bottom'; L.append(rxe);
    }
    L.append(mn); layer.append(L);
    var M = { L: L, items: items, mn: mn, rxe: rxe, elem: elem, clone: clone, dy: r.y - top, o: o }; B.menu.cur = M;
    void L.offsetWidth; L.classList.add('on'); mn.classList.add('in'); rxe && rxe.classList.add('in');
    elem.style.visibility = 'hidden'; var t0 = performance.now();
    if (top !== r.y && clone.animate) clone.animate([{ transform: 'translateY(' + (r.y - top) + 'px)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)' });
    L.addEventListener('click', function (e) {
      if (performance.now() - t0 < 350) return;
      var it = e.target.closest('[data-i]'), em = e.target.closest('[data-e]'), m = B.menu.cur;
      if (it) { var f = m.items[+it.dataset.i].f; B.menu.close(); setTimeout(f, 140); }
      else if (em) { var fr = m.o.onReact; B.menu.close(); fr && fr(em.dataset.e); }
      else if (e.target.closest('[data-more]')) { var fm = m.o.onReact; B.menu.close(); setTimeout(function () { B.ui.reactSheet(fm); }, 160); }
      else B.menu.close();
    });
    return M;
  },
  close: function () {
    var o = B.menu.cur; if (!o) return; B.menu.cur = null;
    o.mn.classList.remove('in'); o.rxe && o.rxe.classList.remove('in'); o.L.classList.add('off');
    // Элемент плавно возвращается на место; оригинал показываем, когда копия села ровно на него
    var dur = o.dy && o.clone.animate ? 380 : 0;
    if (dur) o.clone.animate([{ transform: 'none' }, { transform: 'translateY(' + o.dy + 'px)' }], { duration: dur, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' });
    setTimeout(function () { o.elem.style.visibility = ''; o.L.remove(); }, dur + 20);
  }
};

// Блик за пальцем на интерактивном стекле; кнопка после нажатия мышью не остаётся в фокусе
document.addEventListener('pointerdown', function (e) {
  var g = e.target.closest('.gi'); if (g) { var r = g.getBoundingClientRect(); g.style.setProperty('--mx', (e.clientX - r.left) / sc + 'px'); g.style.setProperty('--my', (e.clientY - r.top) / sc + 'px'); }
});
document.addEventListener('click', function (e) {
  if (e.detail > 0) { var b = e.target.closest('button'); if (b && !b.matches('textarea,input')) setTimeout(function () { if (document.activeElement === b) b.blur(); }, 0); }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (B.menu.cur) B.menu.close(); else if (B.sheet.cur) B.sheet.close(); else B.nav.pop();
});

// ── выделение, как в веб клиенте: только в полях ввода и внутри одного пузыря ──
(function () {
  var busy = false;
  var owner = function (n) { return n && (n.nodeType === 1 ? n : n.parentElement) || null; };
  var inField = function (n) { var o = owner(n); return !!(o && o.closest('input,textarea,[contenteditable]')); };
  document.addEventListener('selectionchange', function () {
    if (busy) return; var sl = getSelection(); if (!sl || sl.isCollapsed || !sl.anchorNode) return;
    if (inField(sl.anchorNode) || inField(sl.focusNode)) return;
    var a = owner(sl.anchorNode) && owner(sl.anchorNode).closest('.bub'), f = owner(sl.focusNode) && owner(sl.focusNode).closest('.bub');
    if (a && a === f && !B.menu.cur && !owner(sl.anchorNode).closest('#layer')) return;
    busy = true;
    try {
      if (!a || B.menu.cur || owner(sl.anchorNode).closest('#layer')) sl.removeAllRanges();
      else { var after = !!(a.compareDocumentPosition(sl.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(sl.focusNode); sl.setBaseAndExtent(sl.anchorNode, sl.anchorOffset, a, after ? a.childNodes.length : 0); }
    } finally { setTimeout(function () { busy = false; }, 0); }
  });
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[aAфФ]$/.test(e.key) && !inField(e.target)) e.preventDefault(); }, true);
})();
