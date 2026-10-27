// /m — «Диагностика»: что реально отдаёт телефон (режим запуска, размеры, safe-area), связь с сервером.
B.ui = B.ui || {};
B.ui.diag = (function () {
  var el = null;
  function inset(side) {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-' + side + ':env(safe-area-inset-' + side + ',0px)';
    document.body.appendChild(p);
    var x = parseFloat(getComputedStyle(p)['padding' + side[0].toUpperCase() + side.slice(1)]) || 0; p.remove(); return x;
  }
  function cell(l, x) { return '<div class="cell"><span class="cl">' + l + '</span><span class="cv">' + B.esc(x) + '</span></div>'; }
  function html() {
    var vv = window.visualViewport, S = B.S, ws = !S.ws ? 'нет' : ['подключение', 'открыто', 'закрывается', 'закрыто'][S.ws.readyState];
    return '<div class="gl">Связь</div><div class="grp glass">' + cell('Сервер', S.server) + cell('WebSocket', ws) + cell('Чатов загружено', S.chats.length) + cell('Непрочитанных', B.chats.totalUnread()) + '</div>' +
      '<div class="gl">Устройство</div><div class="grp glass">' + cell('Запуск', B.pwa.standalone ? 'как приложение (PWA)' : 'во вкладке браузера') + cell('Service worker', B.pwa.sw) + cell('Окно', innerWidth + ' × ' + innerHeight) +
        cell('Видимая область', vv ? Math.round(vv.width) + ' × ' + Math.round(vv.height) : '—') + cell('Экран', screen.width + ' × ' + screen.height + ' @' + devicePixelRatio) + cell('Масштаб оболочки', sc.toFixed(3)) + cell('safe-area сверху / снизу', inset('top') + ' / ' + inset('bottom')) + '</div>' +
      '<button class="abtn" data-r>' + I('upd') + 'Перезагрузить приложение</button>';
  }
  function open() {
    el = B.ui.setPage('Диагностика', html());
    el.addEventListener('click', function (e) { if (e.target.closest('[data-r]')) location.reload(); });
  }
  function refresh() { if (el && el.isConnected) { var s = $('.scroll', el), y = s.scrollTop; s.innerHTML = html(); s.scrollTop = y; } }
  B.bus.on('ws:state', refresh); window.addEventListener('resize', refresh); B.onPwaChange = refresh;
  return { open: open };
})();
