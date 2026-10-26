// Стеклянный вид веб клиента: подсветка под курсором у интерактивного стекла и зелёная точка у подписи «в сети».
// Только оформление: разметку и обработчики приложения не трогает. Стили — в glass.css.
(function () {
  // Цветные пятна под стеклом (настройка «Цветная картинка» гасит их классом gl-noimg на <html>)
  function amb() {
    if (document.querySelector('.gl-amb')) return;
    var d = document.createElement('div'); d.className = 'gl-amb'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.insertBefore(d, document.body.firstChild);
  }
  if (document.body) amb(); else document.addEventListener('DOMContentLoaded', amb);
  // Элементы, у которых за курсором ездит блик (в макете это .gi): кнопки у поля ввода и «вниз», реакции, «назад», выбранная вкладка,
  // левая часть шапки (аватар и название), если по ней можно нажать
  var SPOT = '.composer-main .composer-attach, .composer-main .send-btn, .scroll-bottom-btn, .reaction-btn, .strip-back, .sb-tab.on, .chat-header-main';
  document.addEventListener('pointermove', function (e) {
    var t = e.target;
    var g = t && t.closest ? t.closest(SPOT) : null;
    if (!g) return;
    var r = g.getBoundingClientRect();
    var k = r.width / (g.offsetWidth || r.width) || 1;   // у окна может быть масштаб интерфейса (zoom)
    g.style.setProperty('--mx', ((e.clientX - r.left) / k) + 'px');
    g.style.setProperty('--my', ((e.clientY - r.top) / k) + 'px');
  }, { passive: true });

  // Подпись в шапке («в сети 5 из 9», «в сети»): перед ней зелёная точка. Текст меняется из разных мест,
  // поэтому следим за изменениями, а не правим каждое
  var tm = 0;
  function mark() {
    tm = 0;
    var el = document.querySelector('.chat-header .ch-sub');
    if (el) el.classList.toggle('gl-online', /^\s*в сети/.test(el.textContent || ''));
  }
  // setTimeout, а не rAF: в свёрнутом окне кадры не рисуются и rAF не вызывается
  function schedule() { if (!tm) tm = setTimeout(mark, 30); }
  function init() {
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true });
    schedule();
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();

// После щелчка мышью фокус снимается у кнопок (рамка остаётся только при управлении с клавиатуры), как в макете
document.addEventListener('click', e => {
  if (e.detail > 0) { const b = e.target.closest('button,[role=button],[role=tab],[role=radio],.chat-item,.sb-tab,.cs-sn'); if (b) setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0); }
});
