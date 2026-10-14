// /beta — экранная клавиатура iOS. Страница не должна прыгать, а поле ввода — уходить под клавиатуру,
// поэтому высоту клавиатуры берём из visualViewport и отдаём CSS переменной --kb (на сколько поднять нижнюю панель),
// а сдвиг видимой области — переменной --vvt (iOS прокручивает её, чтобы показать поле).
B.kbd = {
  h: 0,
  last: 300,                                   // последняя известная высота клавиатуры: такой же высоты панель смайлов
  init: function () {
    var root = document.documentElement, app = document.getElementById('app'), vv = window.visualViewport;
    try { var s = parseInt(localStorage.getItem('beta_kbh'), 10); if (s >= 220 && s <= 420) B.kbd.last = s; } catch (e) {}
    root.style.setProperty('--pnl', B.kbd.last + 'px');
    var update = function () {
      if (!vv) return;
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), top = Math.max(0, Math.round(vv.offsetTop));
      if (kb < 80) kb = 0;                       // небольшие расхождения (адресная строка, округление) клавиатурой не считаем
      root.style.setProperty('--kb', kb + 'px'); root.style.setProperty('--vvt', top + 'px');
      if (kb > 120 && kb !== B.kbd.last) { B.kbd.last = kb; root.style.setProperty('--pnl', kb + 'px'); try { localStorage.setItem('beta_kbh', String(kb)); } catch (e) {} }
      if (kb !== B.kbd.h) { B.kbd.h = kb; app.classList.toggle('kb', kb > 0); B.bus.emit('kbd:changed', { h: kb }); }
    };
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update); }
    // Документ прокручивать нечем — возвращаем на место то, что iOS сдвинул сам
    window.addEventListener('scroll', function () { if (window.scrollY) window.scrollTo(0, 0); });
    update();
  },
  // Убрать клавиатуру: снять фокус с поля ввода
  hide: function () { var a = document.activeElement; if (a && a !== document.body && a.matches && a.matches('input,textarea')) a.blur(); }
};
