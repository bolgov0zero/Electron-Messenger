// /m — «Диагностика»: что реально отдаёт телефон (режим запуска, размеры, safe-area) и ручной запас отступов сверху и снизу,
// если панели не совпадают с системными областями iPhone. Запас хранится на этом устройстве.
B.ui = B.ui || {};
B.ui.diag = (function () {
  var esc = B.esc, el = null;
  function inset(side) {
    var p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-' + side + ':env(safe-area-inset-' + side + ',0px)';
    document.body.appendChild(p);
    var v = parseFloat(getComputedStyle(p)['padding' + side[0].toUpperCase() + side.slice(1)]) || 0; p.remove(); return v;
  }
  function extra(name) { return parseInt(getComputedStyle(document.documentElement).getPropertyValue(name), 10) || 0; }
  function cell(l, v) { return '<div class="cell"><span class="cl">' + l + '</span><span class="cv">' + esc(v) + '</span></div>'; }
  function stepper(label, key) {
    return '<div class="cell"><span class="cl">' + label + '</span><span class="step"><button data-d="dec" data-k="' + key + '">−</button><span class="cv" style="min-width:36px">' + extra('--' + key.replace('_', '-')) + '</span><button data-d="inc" data-k="' + key + '">+</button></span></div>';
  }
  function html() {
    var vv = window.visualViewport, nv = document.querySelector('.nav'), tb = document.getElementById('tabbar'), S = B.S;
    var ws = !S.ws ? 'нет' : ['подключение', 'открыто', 'закрывается', 'закрыто'][S.ws.readyState];
    return '<div style="height:14px"></div><div class="gh">Связь</div><div class="grp">' + cell('Сервер', S.server) + cell('WebSocket', ws) + cell('Чатов загружено', S.chats.length) + cell('Непрочитанных', B.chats.totalUnread()) + '</div>' +
      '<div class="gh">Устройство</div><div class="grp">' + cell('Запуск', B.pwa.standalone ? 'как приложение (PWA)' : 'во вкладке браузера') + cell('Service worker', B.pwa.sw) +
        cell('Окно', innerWidth + ' × ' + innerHeight) + cell('Видимая область', vv ? Math.round(vv.width) + ' × ' + Math.round(vv.height) : '—') + cell('Экран', screen.width + ' × ' + screen.height + ' @' + devicePixelRatio) +
        cell('Низ окна от верха экрана', Math.round(document.documentElement.getBoundingClientRect().bottom) + ' из ' + screen.height) +
        cell('safe-area сверху / снизу', inset('top') + ' / ' + inset('bottom')) + cell('Верхняя панель', nv ? Math.round(nv.getBoundingClientRect().height) : '—') + cell('Нижняя панель', tb ? Math.round(tb.getBoundingClientRect().height) : '—') + '</div>' +
      '<div class="gh">Нажатие на уведомление</div><div class="grp">' + (function () {
        var l = B.native && B.native.last;
        return cell('Переход в приложение', B.native && B.native.enabled() ? 'включён, схема ' + B.native.scheme() : 'выключен') +
          cell('Последнее нажатие', l ? new Date(l.t).toLocaleTimeString() + ', чат ' + l.id : 'не было') + (l ? cell('Пришло через', l.via) + cell('Что сделано', l.step) : '') +
          '<div class="cell"><span class="cl">Service worker</span><span class="cv" id="dg-sw">проверяю…</span></div>' +
          '<div class="cell"><span class="cl">Нажатие дошло до service worker</span><span class="cv" id="dg-swc">проверяю…</span></div>' +
          '<div class="gf" id="dg-log" style="text-align:left;white-space:pre-line">Журнал service worker…</div>';
      })() + '</div>' +
      '<div class="gh">Запас отступов, px</div><div class="grp">' + stepper('Сверху', 'sat_extra') + stepper('Снизу', 'sab_extra') + '</div>' +
      '<div class="gf">Если верх или низ панелей не совпадают с системными областями iPhone, подберите запас. Значения сохраняются на этом телефоне.</div>';
  }
  function open() {
    el = B.nav.page({ title: 'Диагностика', back: 'Настройки', gray: true, body: html() });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]'); if (!b) return;
      var css = '--' + b.dataset.k.replace('_', '-'), v = extra(css) + (b.dataset.d === 'inc' ? 1 : -1);
      document.documentElement.style.setProperty(css, v + 'px');
      try { localStorage.setItem('beta_' + b.dataset.k, String(v)); } catch (err) {}
      refresh();
    });
    B.nav.push(el, 'Диагностика'); fillSw();
  }
  // Версия работающего service worker и последнее нажатие на уведомление, которое он получил
  function fillSw() {
    if (!(B.native && B.native.swInfo)) return;
    B.native.swInfo().then(function (i) {
      var a = document.getElementById('dg-sw'), b = document.getElementById('dg-swc');
      if (a) a.textContent = i.sw ? 'версия ' + i.sw : 'не управляет страницей';
      if (b) b.textContent = i.click ? new Date(i.click.t).toLocaleTimeString() + ', чат ' + (i.click.chatId || '—') : 'не было';
      var lg = document.getElementById('dg-log');
      if (lg) lg.textContent = (i.log && i.log.length ? i.log.slice(-6).map(function (x) { return new Date(x.t).toLocaleTimeString() + '  ' + ({ push: 'пуш получен' + (x.shown ? ' и показан' : ', окно было на экране'), click: 'нажатие на уведомление', close: 'уведомление закрыто' }[x.e] || x.e) + (x.chatId ? ', чат ' + x.chatId : ''); }).join('\n') : 'Журнал service worker пуст');
    });
  }
  function refresh() { if (el && el.isConnected) { var sc = el.querySelector('.scroll'), y = sc.scrollTop; sc.innerHTML = html(); sc.scrollTop = y; fillSw(); } }
  B.bus.on('ws:state', refresh); window.addEventListener('resize', refresh); B.onPwaChange = refresh;
  return { open: open };
})();
