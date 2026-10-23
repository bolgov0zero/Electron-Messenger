// Обработчики событий без инлайн-кода (CSP без 'unsafe-inline').
// В HTML: data-on-<событие>="имя" (функция) и data-a="[аргументы]" (JSON).
// Токены в аргументах: __this — элемент, __event — событие, __value — el.value, __checked — el.checked.
// Имена __hN — тела обработчиков из actions.js: вызываются как fn(el, ev, a).
(function () {
  var BUBBLE = ['click', 'input', 'change', 'keydown', 'submit', 'mousemove', 'dragstart', 'dragover', 'dragleave', 'drop'];
  var NO_BUBBLE = ['error', 'blur'];

  function token(t, el, ev) {
    if (t === '__this') return el;
    if (t === '__event') return ev;
    if (t === '__value') return el.value;
    if (t === '__checked') return el.checked;
    return t;
  }

  function run(el, type, ev) {
    var name = el.getAttribute('data-on-' + type);
    var raw = el.getAttribute('data-a-' + type) || el.getAttribute('data-a');
    var args = [];
    if (raw) {
      try { args = JSON.parse(raw); } catch (e) { console.error('[act] неверные данные', raw); return; }
    }
    var fn = window[name];
    if (typeof fn !== 'function') { console.error('[act] нет обработчика', name); return; }
    if (name.indexOf('__h') === 0) return fn.call(el, el, ev, args);
    return fn.apply(el, args.map(function (t) { return token(t, el, ev); }));
  }

  BUBBLE.forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var el = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement);
      while (el && el !== document.body.parentElement) {
        if (el.hasAttribute('data-on-' + type)) {
          run(el, type, ev);
          if (ev.cancelBubble) break;
        }
        el = el.parentElement;
      }
      // Обработчик остановил всплытие (как stopPropagation в инлайн-атрибуте): остальные слушатели document не должны сработать
      if (ev.cancelBubble) ev.stopImmediatePropagation();
    });
  });

  // Эти события не всплывают: обработчик на самом элементе, слушаем на фазе перехвата
  NO_BUBBLE.forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var el = ev.target;
      if (el && el.nodeType === 1 && el.hasAttribute('data-on-' + type)) run(el, type, ev);
    }, true);
  });
})();
