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
  // Пружина для списков чатов (стеклянный вид веб клиента); остальные группы едут без перелёта
  var SPRING = 'cubic-bezier(.34,1.56,.64,1)';
  var A = '[aria-pressed="true"]';
  var G = [
    // клиент и веб
    { b: '.seg', i: 'button', o: '.active' },
    { b: '.cs-seg', i: 'button', o: A },
    { b: '.sidebar-tabbar', i: '.sb-tab', o: '.on' },   // нижняя панель сайдбара веб клиента
    { b: '.ep-sw', i: 'button', o: A },
    { b: '.anx-sg', i: 'button', o: A },
    { b: '.anx-types', i: 'button', o: '[aria-checked="true"]', above: true },
    { b: '.gp-chips', i: '.gp-chip', o: A },
    { b: '.ep-tabs', i: '.ep-tab', o: '[aria-selected="true"]' },   // группы смайлов
    { b: '.cs-nav-list', i: '.cs-sn', o: '[aria-current="page"],[aria-current="true"]', ease: SPRING, dur: 500 },
    // списки чатов и тем: выделение — псевдоэлемент строки, плашка едет под текстом строк
    { b: '.chats-list', i: '.chat-item', o: '.active', p: '::after', below: true, ease: SPRING, dur: 500 },
    { b: '.topics-panel', i: '.chat-item', o: '.active', p: '::after', below: true, ease: SPRING, dur: 500 },
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
    { b: '.fdv-tabs', i: 'button', o: A },
    { b: '.ua-roles', i: '.ua-role-opt', o: '[aria-checked="true"]', above: true },
    { b: '.ub-tiles', i: '.ub-tile', o: A, above: true },
    { b: 'nav', i: '.nav-item', o: '.active' }
  ];
  var ALL = G.map(function (g) { return g.b; }).join(',');
  G.forEach(function (g) { g.q = g.o.split(',').map(function (s) { return g.i + s.trim(); }).join(','); });

  // Без «пружины»: с перелётом плашка в узкой колонке (папки слева) выскакивала за крайний пункт
  var EASE = 'cubic-bezier(.32,.72,0,1)', DUR = 300;
  var state = {}, lastInt = 0, lastTarget = null, sw = null, pend = null, forceUntil = 0;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');

  var css = document.createElement('style');
  css.textContent =
    '.ss-mute{background:transparent!important;box-shadow:none!important;border-color:transparent!important}' +
    '.ss-mute-a::after{opacity:0!important}.ss-mute-b::before{opacity:0!important}' +
    '.ss-ghost{position:absolute;left:0;top:0;margin:0;padding:0;pointer-events:none}';
  (document.head || document.documentElement).appendChild(css);

  // Перед нажатием фиксируем нынешнее положение выделения: так плавно уже с первого раза, даже если группа
  // была скрыта (свёрнутый блок, окно) или сдвинулась после загрузки шрифтов
  ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (ev) {
    addEventListener(ev, function (e) {
      lastInt = Date.now(); lastTarget = e.target;
      var b = e.type !== 'click' && e.target.closest ? e.target.closest(ALL) : null;
      if (b) { update(b); pend = snap(b, e.target); }
      var t = e.target.closest && e.target.closest('[role="switch"]');
      if (t && e.type !== 'click') sw = { el: t, k: swKey(t), on: t.getAttribute('aria-checked'), t: Date.now() };
    }, true);
  });

  // Тумблеры (role=switch): ползунок едет сам, пока элемент тот же. Но страницы настроек после нажатия
  // перерисовываются заново, и новый тумблер сразу рождается во включённом виде. Возвращаем ему прежнее
  // состояние и в следующем кадре ставим новое, тогда переход проигрывается
  function swKey(el) { return Array.prototype.indexOf.call(document.querySelectorAll('[role="switch"]'), el) + '|' + (el.getAttribute('aria-label') || ''); }
  function swFix() {
    if (!sw || Date.now() - sw.t > 800) { sw = null; return; }
    if (sw.el.isConnected) return;   // тот же элемент: он анимируется сам
    var all = document.querySelectorAll('[role="switch"]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], now = el.getAttribute('aria-checked');
      if (el._ssSw || swKey(el) !== sw.k || now === sw.on) continue;
      el._ssSw = 1; sw = null;
      if (reduce.matches || document.hidden) return;
      el.setAttribute('aria-checked', sw0(el, now));
      void el.offsetWidth;
      setTimeout(function () { el.setAttribute('aria-checked', now); }, 16);   // не rAF: в свёрнутом окне он не вызывается, и тумблер остался бы в старом виде
      return;
    }
  }
  function sw0(el, now) { return now === 'true' ? 'false' : 'true'; }
  // Цвета текста нажатого и прежнего выбранного пунктов до нажатия: на время полёта плашки текст держим прежним,
  // иначе пункт сразу «одевается» в цвет выбранного (например, белый на светлом фоне), а плашка ещё в пути
  function snap(box, target) {
    var gi = groupOf(box); if (gi < 0) return null;
    var g = G[gi], items = box.querySelectorAll(g.i), it = target.closest(g.i), sel = box.querySelector(g.q);
    if (!it || !box.contains(it)) return null;
    var at = Array.prototype.indexOf;
    return { gi: gi, t: Date.now(), ti: at.call(items, it), tc: getComputedStyle(it).color, si: sel ? at.call(items, sel) : -1, sc: sel ? getComputedStyle(sel).color : null };
  }
  function hold(box, el, c, ms) {
    el.style.color = c;
    (box._ssHold = box._ssHold || []).push(el);
    setTimeout(function () { if (el.style.color === c) el.style.color = ''; }, ms);
  }
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
  // Где плашка сейчас, если выбор сменили на лету: по прогрессу её анимации, так считается и после перерисовки страницы
  function flightGeom(box) {
    var f = box._ss, p = 1;
    try { var pr = f.anim.effect.getComputedTiming().progress; if (pr != null) p = pr; } catch (e) {}
    var lerp = function (a, b) { return a + (b - a) * p; };
    return { x: lerp(f.from.x, f.to.x), y: lerp(f.from.y, f.to.y), w: lerp(f.from.w, f.to.w), h: lerp(f.from.h, f.to.h) };
  }
  // У невыбранных пунктов свой непрозрачный фон (вкладки, карточки)? Тогда плашка снизу была бы не видна под ними
  function opaqueItems(box, g, cur) {
    var its = box.querySelectorAll(g.i), res = false;
    for (var k = 0; k < its.length && !res; k++) {
      if (its[k] === cur) continue;
      // Переходы на время чтения выключаем: у только что снятого пункта фон ещё «от выбранного»
      var t0 = ntOn(its[k]);
      var m = getComputedStyle(its[k]).backgroundColor.match(/rgba?\(([^)]+)\)/);
      ntOff(its[k], t0);
      if (!m) continue;
      var p = m[1].split(/[ ,\/]+/).filter(Boolean);
      res = (p.length > 3 ? +p[3] : 1) > 0.05;
    }
    return res;
  }
  // Переходы на время замера выключаем с !important: иначе их перебьёт правило плавной смены темы (theme-anim)
  function ntOn(el) { var o = [el.style.getPropertyValue('transition'), el.style.getPropertyPriority('transition')]; el.style.setProperty('transition', 'none', 'important'); return o; }
  function ntOff(el, o) { if (o[0]) el.style.setProperty('transition', o[0], o[1]); else el.style.removeProperty('transition'); }
  function tr(p) { return 'translate(' + p.x + 'px,' + p.y + 'px)'; }

  function finish(box) {
    var s = box._ss; if (!s) return;
    box._ss = null;
    s.anim.onfinish = null;
    var t1 = ntOn(s.cur);
    s.cur.classList.remove('ss-mute', 'ss-mute-a', 'ss-mute-b');
    s.gh.remove();
    (box._ssHold || []).forEach(function (h) { h.style.color = ''; });
    box._ssHold = [];
    setTimeout(function () { ntOff(s.cur, t1); }, 60);   // не rAF: в свёрнутом окне он не вызывается
  }

  function start(box, g, cur, from, now, gi) {
    var gh = document.createElement('i');
    gh.className = 'ss-ghost';
    // Внешний вид читаем до того, как приглушим сам пункт. Переходы выключаем на время чтения:
    // иначе у только что выбранного пункта фон ещё «прозрачный», как в начале перехода
    var tr0 = ntOn(cur);
    var el = g.p ? getComputedStyle(cur, g.p) : getComputedStyle(cur);
    gh.style.backgroundColor = el.backgroundColor;
    gh.style.backgroundImage = el.backgroundImage;
    gh.style.boxShadow = el.boxShadow;
    gh.style.borderRadius = el.borderRadius;
    gh.style.border = el.borderTopWidth + ' ' + el.borderTopStyle + ' ' + el.borderTopColor;
    gh.style.boxSizing = g.p ? el.boxSizing : 'border-box';
    gh.style.width = from.w + 'px'; gh.style.height = from.h + 'px';
    gh.style.transform = tr(from);
    var above = g.below ? false : (g.above || g.p || opaqueItems(box, g, cur));
    gh.style.zIndex = above ? '1' : '-1';
    if (!above) box.style.isolation = 'isolate';
    box.appendChild(gh);
    cur.classList.add(g.p === '::after' ? 'ss-mute-a' : g.p === '::before' ? 'ss-mute-b' : 'ss-mute');
    // Приглушаем фон мгновенно: пока переходы выключены, считаем стиль уже с приглушением, и только потом возвращаем их.
    // Иначе выбранный пункт успевал бы показать своё оформление и плавно гаснуть, а плашка ещё догоняла бы его
    var held = [];
    if (pend && pend.gi === gi && Date.now() - pend.t < 800) {
      var items = box.querySelectorAll(g.i), at = Array.prototype.indexOf;
      if (at.call(items, cur) === pend.ti) held.push([cur, pend.tc, DUR * 0.5]);
      var old = pend.si >= 0 ? items[pend.si] : null;
      if (old && old !== cur && pend.sc) held.push([old, pend.sc, DUR * 0.3]);
    }
    // Цвет подставляем при выключенных переходах, чтобы он не «перетекал» от нового к прежнему
    held.forEach(function (h) { h.push(ntOn(h[0])); hold(box, h[0], h[1], h[2]); });
    void (g.p ? getComputedStyle(cur, g.p) : getComputedStyle(cur)).opacity;
    held.forEach(function (h) { void getComputedStyle(h[0]).color; ntOff(h[0], h[3]); });
    ntOff(cur, tr0);
    var anim = gh.animate(
      [{ transform: tr(from), width: from.w + 'px', height: from.h + 'px' }, { transform: tr(now), width: now.w + 'px', height: now.h + 'px' }],
      { duration: g.dur || DUR, easing: g.ease || EASE, fill: 'forwards' }
    );
    var s = box._ss = { gh: gh, cur: cur, anim: anim, from: from, to: now };
    anim.onfinish = function () { finish(box); };
    // Страховка: в фоновой вкладке кадры не рисуются и onfinish может не прийти, а пункт остался бы без фона
    setTimeout(function () { if (box._ss === s) finish(box); }, (g.dur || DUR) + 250);
  }

  function update(box) {
    var gi = groupOf(box);
    if (gi < 0 || !box.isConnected) return;
    var g = G[gi], sel = box.querySelectorAll(g.q);
    // Координаты пунктов считаем от самой группы, поэтому она должна быть «опорной» до первого замера;
    // иначе offsetLeft отсчитывается от дальнего предка и плашка улетает в сторону
    if (!box._ssPos) { box._ssPos = 1; if (getComputedStyle(box).position === 'static') box.style.position = 'relative'; }
    var key = gi + ':' + Array.prototype.indexOf.call(document.querySelectorAll(g.b), box);
    if (sel.length !== 1 || !sel[0].offsetWidth) { delete state[key]; return; }   // выбор не один: это не переключатель
    var cur = sel[0], now = geom(cur, g), s = sig(box, g), prev = state[key];
    state[key] = { box: box, el: cur, geom: now, sig: s };
    if (!prev || prev.el === cur || prev.sig !== s) return;
    // Страницу перерисовали целиком: анимируем только если сразу перед этим нажали пункт именно этой группы.
    // Иначе при переходе на другую страницу плашка «летела» бы от места такой же группы на прошлой
    var forced = Date.now() < forceUntil;   // выбор сменили не здесь (переключение записи в другом окне клиента), нажатия в этом окне не было
    if (prev.box !== box && !forced && (Date.now() - lastInt > 500 || !lastTarget || !prev.box.contains(lastTarget))) return;
    if (reduce.matches || (document.hidden && !forced)) return;
    var from = prev.geom, fb = prev.box._ss ? prev.box : box._ss ? box : null;
    if (fb) { from = flightGeom(fb); finish(fb); }
    if (from.x === now.x && from.y === now.y && from.w === now.w && from.h === now.h) return;
    start(box, g, cur, from, now, gi);
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
    swFix();
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
    // Ближайшую смену выбора анимировать, даже если нажатия в этом окне не было
    allowNext: function (ms) { forceUntil = Date.now() + (ms || 400); },
    pop: function (el) { if (ok(el)) el.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' }); },
    bump: function (el) { if (ok(el)) el.animate([{ transform: 'none' }, { transform: 'scale(1.28)', offset: .4 }, { transform: 'none' }], { duration: 300, easing: 'ease' }); },
    out: function (el, done) {
      if (!ok(el)) { done(); return; }
      var a = el.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = function () { a.cancel(); done(); };
    }
  };
})();
