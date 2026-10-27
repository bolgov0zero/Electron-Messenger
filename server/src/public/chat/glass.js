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

// Выделять текст можно только в полях ввода и внутри одного пузыря сообщения: протяжка через несколько пузырей
// (и «выделить всё» вне полей) обрезается краем пузыря, с которого она началась
(function () {
  let busy = false;
  const owner = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el || null; };
  const inField = n => !!(owner(n) && owner(n).closest('input,textarea,[contenteditable]'));
  document.addEventListener('selectionchange', () => {
    if (busy) return;
    const s = getSelection();
    if (!s || s.isCollapsed || !s.anchorNode || inField(s.anchorNode) || inField(s.focusNode)) return;
    const a = owner(s.anchorNode)?.closest('.msg-bubble'), f = owner(s.focusNode)?.closest('.msg-bubble');
    if (a === f && a) return;
    busy = true;
    try {
      if (!a) s.removeAllRanges();
      else {
        const after = !!(a.compareDocumentPosition(s.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(s.focusNode);
        s.setBaseAndExtent(s.anchorNode, s.anchorOffset, a, after ? a.childNodes.length : 0);
      }
    } finally { setTimeout(() => { busy = false; }, 0); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'ф' || e.key === 'A') && !inField(e.target)) e.preventDefault();
  }, true);
})();
