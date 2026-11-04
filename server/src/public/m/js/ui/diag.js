// /m — «Диагностика»: что реально отдаёт телефон (режим запуска, размеры, safe-area), связь с сервером.
B.ui = B.ui || {};
B.ui.diag = (function () {
  var el = null, taps = [];
  // Что система считает нажатым: если кнопки перестали нажиматься, здесь видно, какой слой их перекрывает
  function desc(e) { if (!e || !e.tagName) return '—'; var c = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + c; }
  document.addEventListener('pointerdown', function (ev) {
    try {
      var vv = window.visualViewport, st = document.elementsFromPoint(ev.clientX, ev.clientY).slice(0, 3).map(desc).join(' › ');
      taps.unshift({ at: Math.round(ev.clientX) + ', ' + Math.round(ev.clientY), v: st + (vv && (vv.offsetTop || vv.pageTop) ? ' · смещение окна ' + Math.round(vv.offsetTop) + '/' + Math.round(vv.pageTop) : '') + (window.scrollY ? ' · прокрутка ' + Math.round(scrollY) : '') });
      if (taps.length > 6) taps.length = 6;
    } catch (e) {}
  }, true);
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
      '<div class="gl">Последние нажатия (что система считает нажатым)</div><div class="grp glass">' + (taps.length ? taps.map(function (t) { return cell(t.at, t.v); }).join('') : cell('—', 'нажмите на экран и вернитесь сюда')) + '</div>' +
      '<div class="gl">Звонки</div><div class="grp glass"><div class="cell"><span class="cl">Данные о соединении в звонке</span><button class="tg" data-tg="diag" role="switch" aria-checked="' + !!(window.Calls && Calls.local.get('diag')) + '"></button></div></div><div class="gf">Поверх звонка показываются скорость, потери, задержка и путь связи. Пригодится, если видео или звук идут плохо.</div>' +
      '<button class="abtn" data-r>' + I('upd') + 'Перезагрузить приложение</button>';
  }
  function open() {
    el = B.ui.setPage('Диагностика', html());
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-r]')) location.reload();
      var t = e.target.closest('[data-tg="diag"]'); if (t && window.Calls) { Calls.local.set('diag', !Calls.local.get('diag')); t.setAttribute('aria-checked', String(!!Calls.local.get('diag'))); }
    });
  }
  function refresh() { if (el && el.isConnected) { var s = $('.scroll', el), y = s.scrollTop; s.innerHTML = html(); s.scrollTop = y; } }
  B.bus.on('ws:state', refresh); window.addEventListener('resize', refresh); B.onPwaChange = refresh;
  return { open: open };
})();
