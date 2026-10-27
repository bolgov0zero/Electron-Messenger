// /beta — стеклянная подложка поля ввода сложной формы. Нижний ряд: кнопка «+», поле, кнопка отправки. Дополнительные панели
// (форматирование, вложения, ответ, правка, пересылка, превью) лежат в .xtra на всю ширину над рядом и огибают кнопки:
// внутренний угол — дуга, концентричная кнопке (радиус кнопки + зазор), поэтому расстояние до кнопки везде одинаково.
// Форма строится одной кривой: стекло обрезается по ней (clip-path), поверх рисуется кромка. Тени у подложки нет: тень по вырезу формы
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
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><path d="' + d + '"/></svg>';
      var url = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
      gl.style.webkitMaskImage = url; gl.style.maskImage = url;
      edp.setAttribute('d', d);
      // содержимое панели появляется, когда крылья уже расправились
      if (xtra) xtra.style.opacity = String(clamp((yT - 20) / 26, 0, 1));
    }
    var ro = new ResizeObserver(draw); ro.observe(comp); if (xtra) ro.observe(xtra);
    draw();
    comp._cs = { draw: draw, ro: ro };
    return comp._cs;
  }
  window.CShape = { attach: attach, shape: shape };
})();
