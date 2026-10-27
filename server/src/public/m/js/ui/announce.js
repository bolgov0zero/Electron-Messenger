// /m — объявления от администрации: полоса сверху на заданное время и всплывающая карточка.
// Приходят по WebSocket (announcement, banner, banner_removed); активные полосы запрашиваем при каждом
// подключении и возвращении в приложение, поэтому они доходят и до тех, кого не было в сети в момент отправки.
// Крестик или свайп вверх закрывает полосу у человека навсегда (отметка хранится на сервере).
B.ui = B.ui || {};
B.ui.announce = (function () {
  var BELL = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  var X = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var timers = {}, host = null, queue = [], popup = null;

  function root() { return layer; }
  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div'); host.id = 'ann-banners'; root().appendChild(host); return host;
  }

  /* ── полоса ── */
  function show(a) {
    if (!a || !a.id || timers[a.id]) return;
    var left = (a.expires_at || 0) * 1000 - Date.now();
    if (left <= 0) return;
    var el = document.createElement('div');
    el.className = 'annb'; el.dataset.id = a.id;
    el.innerHTML = '<span class="annb-i">' + BELL + '</span><span class="annb-t"></span><button type="button" class="annb-x" aria-label="Скрыть">' + X + '</button>';
    el.querySelector('.annb-t').textContent = a.text || '';
    el.querySelector('.annb-x').addEventListener('click', function () { dismiss(a.id); });
    swipeUp(el, a.id);
    ensureHost().appendChild(el);
    // Не rAF: в свёрнутой вкладке кадры не идут, и полоса осталась бы прозрачной
    setTimeout(function () { el.classList.add('on'); }, 10);
    timers[a.id] = setTimeout(function () { hide(a.id); }, left);
  }
  function hide(id) {
    clearTimeout(timers[id]); delete timers[id];
    var el = host && host.querySelector('.annb[data-id="' + id + '"]');
    if (!el) return;
    el.classList.remove('on'); el.style.transform = '';
    setTimeout(function () { el.remove(); }, 380);
  }
  function dismiss(id) { hide(id); B.api('POST', '/announcements/' + id + '/dismiss'); }
  // Свайп вверх по полосе закрывает её, как уведомление в iOS
  function swipeUp(el, id) {
    var y0 = null, dy = 0;
    el.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; el.style.transition = 'none'; try { el.setPointerCapture(e.pointerId); } catch (_) {} });
    el.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.min(0, e.clientY - y0); el.style.transform = 'translateY(' + dy + 'px)'; });
    var end = function () {
      if (y0 == null) return; y0 = null; el.style.transition = '';
      if (dy < -36) dismiss(id); else el.style.transform = '';
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function load() {
    if (!B.S.token) return;
    B.api('GET', '/announcements/active').then(function (list) {
      if (!Array.isArray(list)) return;
      var alive = {}; list.forEach(function (a) { alive[a.id] = 1; });
      Object.keys(timers).forEach(function (id) { if (!alive[id]) hide(id); });
      list.forEach(show);
    });
  }

  /* ── всплывающая карточка ── */
  function popupShow(text) {
    if (popup) { queue.push(text); return; }
    var el = document.createElement('div');
    el.className = 'annp'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="annp-c"><div class="annp-h"><span class="annp-r">' + BELL + '</span>Системное объявление</div><div class="annp-t"></div><button type="button" class="annp-ok">OK</button></div>';
    el.querySelector('.annp-t').textContent = text || '';
    el.querySelector('.annp-ok').addEventListener('click', popupClose);
    root().appendChild(el); popup = el;
    void el.offsetWidth; el.classList.add('on');
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
  }
  function popupClose() {
    var el = popup; if (!el) return;
    el.classList.remove('on');
    setTimeout(function () { el.remove(); if (popup === el) popup = null; if (queue.length) popupShow(queue.shift()); }, 260);
  }

  B.bus.on('ws:announcement', function (d) { popupShow(d && d.text); });
  B.bus.on('ws:banner', function (d) { show(d && d.announcement); });
  B.bus.on('ws:banner_removed', function (d) { if (d) hide(d.id); });
  B.bus.on('ws:connected', load);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  return { load: load, show: show, hide: hide, popup: popupShow };
})();
