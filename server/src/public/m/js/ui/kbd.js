// /m — экранная клавиатура iOS. Когда она открыта, видимая область (visualViewport) ниже и может быть сдвинута вверх,
// а раскладка страницы этого не знает — поле ввода остаётся под клавиатурой. Поэтому на время клавиатуры приложению #app
// задаётся высота и сдвиг видимой области: нижняя панель сама оказывается над клавиатурой, а верхняя остаётся на месте.
// Полная высота запоминается как наибольшая виденная, так что работает и там, где браузер сам уменьшает окно, и там, где нет.
B.kbd = {
  h: 0,
  full: window.innerHeight,
  last: 300,                                   // последняя известная высота клавиатуры: такой же высоты панель смайлов
  init: function () {
    var root = document.documentElement, app = document.getElementById('app'), vv = window.visualViewport;
    try { var s = parseInt(localStorage.getItem('beta_kbh'), 10); if (s >= 220 && s <= 420) B.kbd.last = s; } catch (e) {}
    root.style.setProperty('--pnl', B.kbd.last + 'px');
    var update = function () {
      if (!vv) return;
      B.kbd.full = Math.max(B.kbd.full, window.innerHeight, Math.round(vv.height + vv.offsetTop));
      var top = Math.max(0, Math.round(vv.offsetTop)), kb = Math.round(B.kbd.full - vv.height - top);
      if (kb < 80) kb = 0;                       // небольшие расхождения (адресная строка, округление) клавиатурой не считаем
      if (kb > 0) { app.style.height = Math.round(vv.height) + 'px'; app.style.transform = 'translateY(' + top + 'px)'; }
      else { app.style.height = ''; app.style.transform = ''; }
      if (kb > 120 && kb !== B.kbd.last) { B.kbd.last = kb; root.style.setProperty('--pnl', kb + 'px'); try { localStorage.setItem('beta_kbh', String(kb)); } catch (e) {} }
      if (kb !== B.kbd.h) { B.kbd.h = kb; app.classList.toggle('kb', kb > 0); B.bus.emit('kbd:changed', { h: kb }); }
    };
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update); }
    window.addEventListener('resize', update);
    // Документ прокручивать нечем — возвращаем на место то, что iOS сдвинул сам
    window.addEventListener('scroll', function () { if (window.scrollY) window.scrollTo(0, 0); });
    // После поворота экрана полная высота другая
    window.addEventListener('orientationchange', function () { B.kbd.full = 0; setTimeout(update, 400); });
    update();
  },
  // Убрать клавиатуру: снять фокус с поля ввода
  hide: function () { var a = document.activeElement; if (a && a !== document.body && a.matches && a.matches('input,textarea')) a.blur(); }
};
