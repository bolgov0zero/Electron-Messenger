// /beta — стеклянная подложка поля ввода сложной формы. Нижний ряд: кнопка «+», поле, кнопка отправки. Дополнительные панели
// (форматирование, вложения, ответ, правка, пересылка, превью) лежат в .xtra на всю ширину над рядом и огибают кнопки:
// внутренний угол — дуга, концентричная кнопке (радиус кнопки + зазор), поэтому расстояние до кнопки везде одинаково.
// Форма строится одной кривой для кромки; стекло обрезается маской из градиентов той же геометрии. Тени у подложки нет: тень по вырезу формы
// выглядела тёмной «подложкой» вокруг панели.
// Элемент comp: grid из .xtra (строка 1, на всю ширину) и ряда .cbtn / .cfield / .sendb (строка 2).
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var COL = 46, GAP = 8, RF = 23, RC = COL / 2 + GAP;   // кнопка 46, зазор 8, пилюля поля 23, вогнутая дуга вокруг кнопки 31
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rrect(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) + 'V' + (y + h - r) +
      'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) +
      'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
  }
  // W — ширина, yT — высота верхней части (панели) без зазора, H — полная высота, L/R — ширина колонок кнопок вместе с зазором
  function shape(W, yT, H, L, R) {
    var xl = L, xr = W - R;
    // Пока панель низкая, подложка — просто пилюля поля, растущая вверх; затем крылья панели расходятся в стороны до полной ширины
    var s = clamp((yT - 24) / 20, 0, 1);
    if (s <= 0) return rrect(xl, 0, xr - xl, H, RF);
    var rT = 23 + s, rB = 16 * s, rf = RC * s, xa = L * (1 - s), xb = W - R * (1 - s);
    return 'M' + (xa + rT) + ' 0H' + (xb - rT) + 'A' + rT + ' ' + rT + ' 0 0 1 ' + xb + ' ' + rT + 'V' + (yT - rB) +
      'A' + rB + ' ' + rB + ' 0 0 1 ' + (xb - rB) + ' ' + yT + 'H' + (xr + rf) +
      'A' + rf + ' ' + rf + ' 0 0 0 ' + xr + ' ' + (yT + rf) + 'V' + (H - RF) +
      'A' + RF + ' ' + RF + ' 0 0 1 ' + (xr - RF) + ' ' + H + 'H' + (xl + RF) +
      'A' + RF + ' ' + RF + ' 0 0 1 ' + xl + ' ' + (H - RF) + 'V' + (yT + rf) +
      'A' + rf + ' ' + rf + ' 0 0 0 ' + (xl - rf) + ' ' + yT + 'H' + (xa + rB) +
      'A' + rB + ' ' + rB + ' 0 0 1 ' + xa + ' ' + (yT - rB) + 'V' + rT +
      'A' + rT + ' ' + rT + ' 0 0 1 ' + (xa + rT) + ' 0Z';
  }

  // Маска из градиентов вместо картинки: SVG в data-URI заново декодировался на каждом кадре (тормоза), а Safari показывал прежнюю маску, пока
  // не загрузится новая (подложка отставала от содержимого). Градиенты разбираются стилем сразу и без декодирования. Слои складываются (union).
  // Каждый слой: [x, y, w, h, картинка]; соседние слои перекрываются на 0.5 px, чтобы между ними не было шва.
  var O = 0.5, SOL = 'linear-gradient(#000,#000)';
  function corner(at, r) { return 'radial-gradient(circle at ' + at + ', #000 ' + (r - O) + 'px, transparent ' + (r + O) + 'px)'; }
  function rr(out, x, y, w, h, rt, rb) {
    rt = Math.min(rt, h / 2, w / 2); rb = Math.min(rb, h / 2, w / 2);
    if (rt + rb > h) { var k = h / (rt + rb); rt *= k; rb *= k; }
    if (w > 2 * rt + 1 && rt > 0) out.push([x + rt - O, y, w - 2 * rt + 2 * O, rt, SOL]);
    if (w > 2 * rb + 1 && rb > 0) out.push([x + rb - O, y + h - rb, w - 2 * rb + 2 * O, rb, SOL]);
    out.push([x, y + rt - O, w, h - rt - rb + 2 * O, SOL]);
    if (rt > 0) { out.push([x, y, rt, rt, corner('100% 100%', rt)]); out.push([x + w - rt, y, rt, rt, corner('0 100%', rt)]); }
    if (rb > 0) { out.push([x, y + h - rb, rb, rb, corner('100% 0', rb)]); out.push([x + w - rb, y + h - rb, rb, rb, corner('0 0', rb)]); }
  }
  // Те же числа, что у shape(): одна геометрия для маски и для кромки
  function layers(W, yT, H, L, R) {
    var xl = L, xr = W - R, s = clamp((yT - 24) / 20, 0, 1), out = [];
    rr(out, xl, 0, xr - xl, H, RF, RF);
    if (s > 0) {
      var rT = 23 + s, rB = 16 * s, rf = RC * s, xa = L * (1 - s), xb = W - R * (1 - s);
      rr(out, xa, 0, xb - xa, yT, rT, rB);
      out.push([xr - O, yT - O, rf + O, rf + O, 'radial-gradient(circle at 100% 100%, transparent ' + (rf - O) + 'px, #000 ' + (rf + O) + 'px)']);
      out.push([xl - rf, yT - O, rf + O, rf + O, 'radial-gradient(circle at 0 100%, transparent ' + (rf - O) + 'px, #000 ' + (rf + O) + 'px)']);
    }
    return out;
  }
  function px(v) { return Math.round(v * 100) / 100 + 'px'; }

  function attach(comp) {
    if (comp._cs) return comp._cs;
    var xtra = comp.querySelector('.xtra');
    var gl = document.createElement('div'); gl.className = 'cs-gl';
    var ed = document.createElementNS(NS, 'svg'); ed.setAttribute('class', 'cs-ed');
    var edp = document.createElementNS(NS, 'path'); edp.setAttribute('class', 'cs-edp'); edp.setAttribute('fill', 'none'); ed.appendChild(edp);
    comp.insertBefore(ed, comp.firstChild); comp.insertBefore(gl, ed);
    comp.classList.add('cs');
    var last = '';
    function draw() {
      var W = comp.clientWidth, H = comp.clientHeight; if (!W || !H) return;
      var xt = xtra ? xtra.offsetHeight : 0, yT = xt > 0 ? Math.max(0, xt - GAP) : 0;
      var L = COL + GAP, R = COL + GAP;
      if (comp.classList.contains('lk')) { L = 0; R = 0; }   // плашка вместо поля: без кнопок по бокам
      var key = W + '|' + H + '|' + yT + '|' + L; if (key === last) return; last = key;
      var d = shape(W, yT, H, L, R);
      // Обрезка маской, а не clip-path: Safari не обрезает по clip-path размытие под стеклом (оставался виден прямоугольник подложки), а маску учитывает
      var ls = layers(W, yT, H, L, R), im = [], ps = [], sz = [];
      ls.forEach(function (l) { if (l[2] > 0 && l[3] > 0) { ps.push(px(l[0]) + ' ' + px(l[1])); sz.push(px(l[2]) + ' ' + px(l[3])); im.push(l[4]); } });
      var st = gl.style; im = im.join(','); ps = ps.join(','); sz = sz.join(',');
      st.webkitMaskImage = im; st.maskImage = im; st.webkitMaskPosition = ps; st.maskPosition = ps; st.webkitMaskSize = sz; st.maskSize = sz;
      edp.setAttribute('d', d);
      // содержимое панели появляется, когда крылья уже расправились
      if (xtra) xtra.style.opacity = String(clamp((yT - 20) / 26, 0, 1));
    }
    var ro = new ResizeObserver(draw); ro.observe(comp); if (xtra) ro.observe(xtra);
    // ResizeObserver не видит изменения отступов и срабатывает не на каждом кадре перехода: пока панель раскрывается, клавиатура выезжает
    // или страница двигается, форма перерисовывается каждый кадр, иначе она отставала от содержимого
    var until = 0, run = false;
    function burst(ms) {
      until = Math.max(until, performance.now() + (ms || 700));
      if (run) return; run = true;
      (function step() { draw(); if (performance.now() < until && comp.isConnected) requestAnimationFrame(step); else { run = false; draw(); } })();
    }
    ['transitionrun', 'transitionend', 'focusin', 'focusout', 'input'].forEach(function (ev) { comp.addEventListener(ev, function () { burst(); }); });
    if (window.visualViewport) visualViewport.addEventListener('resize', function () { burst(900); });
    draw();
    comp._cs = { draw: draw, ro: ro, burst: burst };
    return comp._cs;
  }
  window.CShape = { attach: attach, shape: shape, layers: layers };
})();
