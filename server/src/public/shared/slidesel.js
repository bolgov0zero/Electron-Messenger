// Плавный переезд выделения в переключателях, вкладках, чипах и меню.
// Общий файл: лежит в client/src и server/src/public/shared, правится копиями (клиент, веб, /m и админка).
//
// Следим за DOM: когда у группы (сегмент, вкладки, список пунктов) выбранный пункт меняется,
// рисуем плавающую плашку с тем же фоном, рамкой и скруглением, которая переезжает от старого
// места к новому. Сам выбранный пункт на это время теряет фон, поэтому стили компонентов
// переписывать не нужно. Работает и когда выделение меняет класс, и когда страница
// перерисовывается целиком (тогда старое положение берём из запомненного).
(function () {
  if (window.SlideSel) return;

  // b — контейнер, i — пункт, o — признак выбранного, p — выделение рисуется псевдоэлементом,
  // above — у невыбранных пунктов свой фон, плашку рисуем поверх (иначе её не видно под ними)
  var A = '[aria-pressed="true"]';
  var G = [
    // клиент и веб
    { b: '.seg', i: 'button', o: '.active' },
    { b: '.cs-seg', i: 'button', o: A },
    { b: '.ep-sw', i: 'button', o: A },
    { b: '.anx-sg', i: 'button', o: A },
    { b: '.anx-types', i: 'button', o: '[aria-checked="true"]', above: true },
    { b: '.gp-chips', i: '.gp-chip', o: A },
    { b: '.cs-nav-list', i: '.cs-sn', o: '[aria-current="page"],[aria-current="true"]' },
    { b: '.rail-folders', i: '.fld-btn', o: '.active', p: '::before' },
    // мобильная версия
    { b: '.seg2', i: 'button', o: '.on' },
    { b: '.mtabs-in', i: '.mtab', o: '.on', p: '::after' },
    // админка
    { b: '.sb-th', i: 'button', o: A },
    { b: '.fm-grp', i: 'button', o: A, above: true },
    { b: '.an-seg', i: 'button', o: A },
    { b: '.st-seg', i: 'button', o: A },
    { b: '.xp-seg', i: 'button', o: A },
    { b: '.sp-seg', i: 'button', o: A },
    { b: '.ub-sort', i: 'button', o: A },
    { b: '.xp-tabs', i: '.xp-tab', o: '[aria-selected="true"]' },
    { b: '.ux-chips', i: '.ux-chip', o: A },
    { b: 'nav', i: '.nav-item', o: '.active' }
  ];
  var ALL = G.map(function (g) { return g.b; }).join(',');
  G.forEach(function (g) { g.q = g.o.split(',').map(function (s) { return g.i + s.trim(); }).join(','); });

  var EASE = 'cubic-bezier(.3,1.25,.5,1)', DUR = 300;
  var state = {}, lastInt = 0;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');

  var css = document.createElement('style');
  css.textContent =
    '.ss-mute{background:transparent!important;box-shadow:none!important;border-color:transparent!important}' +
    '.ss-mute-a::after{opacity:0!important}.ss-mute-b::before{opacity:0!important}' +
    '.ss-ghost{position:absolute;left:0;top:0;margin:0;padding:0;pointer-events:none}';
  (document.head || document.documentElement).appendChild(css);

  ['pointerdown', 'keydown', 'click'].forEach(function (ev) { addEventListener(ev, function () { lastInt = Date.now(); }, true); });

  function groupOf(box) { for (var k = 0; k < G.length; k++) if (box.matches(G[k].b)) return k; return -1; }
  // Подпись набора пунктов: по ней отличаем ту же группу после перерисовки от такой же на другой странице
  function sig(box, g) {
    return Array.prototype.map.call(box.querySelectorAll(g.i), function (e) { return e.textContent.replace(/[^\p{L}]+/gu, ''); }).join('|');
  }
  function geom(cur, g) {
    if (g.p) {
      var ps = getComputedStyle(cur, g.p);
      return { x: cur.offsetLeft + (parseFloat(ps.left) || 0), y: cur.offsetTop + (parseFloat(ps.top) || 0), w: parseFloat(ps.width) || 0, h: parseFloat(ps.height) || 0 };
    }
    return { x: cur.offsetLeft, y: cur.offsetTop, w: cur.offsetWidth, h: cur.offsetHeight };
  }
  function ghostGeom(box, gh) {
    var gr = gh.getBoundingClientRect(), br = box.getBoundingClientRect();
    return { x: gr.left - br.left + box.scrollLeft - box.clientLeft, y: gr.top - br.top + box.scrollTop - box.clientTop, w: gr.width, h: gr.height };
  }
  function tr(p) { return 'translate(' + p.x + 'px,' + p.y + 'px)'; }

  function finish(box) {
    var s = box._ss; if (!s) return;
    box._ss = null;
    s.anim.onfinish = null;
    s.cur.style.transition = 'none';
    s.cur.classList.remove('ss-mute', 'ss-mute-a', 'ss-mute-b');
    s.gh.remove();
    requestAnimationFrame(function () { s.cur.style.transition = ''; });
  }

  function start(box, g, cur, from, now) {
    var gh = document.createElement('i');
    gh.className = 'ss-ghost';
    // Внешний вид читаем до того, как приглушим сам пункт. Переходы выключаем на время чтения:
    // иначе у только что выбранного пункта фон ещё «прозрачный», как в начале перехода
    var tr0 = cur.style.transition;
    cur.style.transition = 'none';
    var el = g.p ? getComputedStyle(cur, g.p) : getComputedStyle(cur);
    gh.style.backgroundColor = el.backgroundColor;
    gh.style.backgroundImage = el.backgroundImage;
    gh.style.boxShadow = el.boxShadow;
    gh.style.borderRadius = el.borderRadius;
    gh.style.border = el.borderTopWidth + ' ' + el.borderTopStyle + ' ' + el.borderTopColor;
    gh.style.boxSizing = g.p ? el.boxSizing : 'border-box';
    cur.style.transition = tr0;
    gh.style.width = from.w + 'px'; gh.style.height = from.h + 'px';
    gh.style.transform = tr(from);
    gh.style.zIndex = g.above || g.p ? '1' : '-1';
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    if (!g.above && !g.p) box.style.isolation = 'isolate';
    box.appendChild(gh);
    cur.classList.add(g.p === '::after' ? 'ss-mute-a' : g.p === '::before' ? 'ss-mute-b' : 'ss-mute');
    var anim = gh.animate(
      [{ transform: tr(from), width: from.w + 'px', height: from.h + 'px' }, { transform: tr(now), width: now.w + 'px', height: now.h + 'px' }],
      { duration: DUR, easing: EASE, fill: 'forwards' }
    );
    var s = box._ss = { gh: gh, cur: cur, anim: anim };
    anim.onfinish = function () { finish(box); };
    // Страховка: в фоновой вкладке кадры не рисуются и onfinish может не прийти, а пункт остался бы без фона
    setTimeout(function () { if (box._ss === s) finish(box); }, DUR + 250);
  }

  function update(box) {
    var gi = groupOf(box);
    if (gi < 0 || !box.isConnected) return;
    var g = G[gi], sel = box.querySelectorAll(g.q);
    var key = gi + ':' + Array.prototype.indexOf.call(document.querySelectorAll(g.b), box);
    if (sel.length !== 1 || !sel[0].offsetWidth) { delete state[key]; return; }   // выбор не один: это не переключатель
    var cur = sel[0], now = geom(cur, g), s = sig(box, g), prev = state[key];
    state[key] = { box: box, el: cur, geom: now, sig: s };
    if (!prev || prev.el === cur || prev.sig !== s) return;
    // Страницу перерисовали целиком: анимируем только сразу после нажатия, а не от старых данных
    if (prev.box !== box && Date.now() - lastInt > 500) return;
    if (reduce.matches || document.hidden) return;
    var from = prev.geom;
    if (box._ss) { from = ghostGeom(box, box._ss.gh); finish(box); }
    if (from.x === now.x && from.y === now.y && from.w === now.w && from.h === now.h) return;
    start(box, g, cur, from, now);
  }

  var mo = new MutationObserver(function (recs) {
    var boxes = [];
    var add = function (b) { if (b && boxes.indexOf(b) < 0) boxes.push(b); };
    recs.forEach(function (r) {
      var t = r.target;
      if (t.nodeType === 1) add(t.closest(ALL));
      if (r.type !== 'childList') return;
      r.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1 || n.classList.contains('ss-ghost')) return;
        if (n.matches(ALL)) add(n);
        n.querySelectorAll(ALL).forEach(add);
      });
    });
    boxes.forEach(update);
  });
  function init() {
    document.querySelectorAll(ALL).forEach(update);
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // Счётчики: появление пружиной, подпрыгивание при смене числа, сжатие при исчезновении.
  // Вызываются из мест, где знают, что именно изменилось (списки чатов, значки вкладок)
  var ok = function (el) { return el && el.animate && !reduce.matches; };
  window.SlideSel = {
    pop: function (el) { if (ok(el)) el.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' }); },
    bump: function (el) { if (ok(el)) el.animate([{ transform: 'none' }, { transform: 'scale(1.28)', offset: .4 }, { transform: 'none' }], { duration: 300, easing: 'ease' }); },
    out: function (el, done) {
      if (!ok(el)) { done(); return; }
      var a = el.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = function () { a.cancel(); done(); };
    }
  };
})();
