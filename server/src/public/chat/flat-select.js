// Веб клиент и Электрон: кастомный выпадающий список вместо системного select в окне «Ссылка на видеозвонок» (срок ссылки).
// Общий код окна (shared/calllinks.js) рисует обычный <select class="cll-ttl">; здесь он прячется и вместо него
// строится тот же список, что в окне гостевой ссылки (.gl-sel / .gl-pop / .gl-opt, их стили — в flat.css и в shared/guestlinks.js).
// Значение по-прежнему читается из исходного select, поэтому общий код ничего не замечает. Мобильный /m и админка (gl-m, gl-adm) не затрагиваются.
(function () {
  'use strict';
  var CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pop = null, popFor = null, act = 0;

  function items(select) { return Array.prototype.map.call(select.options, function (o) { return [o.textContent, o.value]; }); }

  function closePop(now) {
    if (!pop) return;
    var p = pop, f = popFor; pop = null; popFor = null;
    if (f) { f.wrap.classList.remove('open'); f.btn.setAttribute('aria-expanded', 'false'); }
    if (now) p.remove(); else { p.classList.add('out'); setTimeout(function () { p.remove(); }, 100); }
  }
  function paintPop() {
    pop.querySelectorAll('.gl-opt').forEach(function (el, i) { el.classList.toggle('act', i === act); });
    var a = pop.querySelector('.gl-opt.act'); if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function pick(i) {
    var f = popFor, list = items(f.select);
    f.select.value = list[i][1];
    f.select.dispatchEvent(new Event('change', { bubbles: true }));
    f.text.textContent = list[i][0];
    closePop(); f.btn.focus();
  }
  function openPop(f) {
    if (popFor === f) { closePop(); return; }
    closePop(true);
    var list = items(f.select), cur = f.select.selectedIndex;
    act = cur < 0 ? 0 : cur;
    pop = document.createElement('div'); pop.className = 'gl-pop'; pop.setAttribute('role', 'listbox');
    pop.innerHTML = list.map(function (t, i) {
      return '<div class="gl-opt' + (i === cur ? ' sel' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === cur) + '"><span>' + esc(t[0]) + '</span>' + CHECK + '</div>';
    }).join('');
    f.bg.appendChild(pop); popFor = f; f.wrap.classList.add('open'); f.btn.setAttribute('aria-expanded', 'true');
    var r = f.wrap.getBoundingClientRect(), h = pop.offsetHeight, below = window.innerHeight - r.bottom - 12;
    pop.style.width = Math.max(r.width, 150) + 'px'; pop.style.left = r.left + 'px';
    pop.style.top = (below >= Math.min(h, 200) ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', function (e) { var o = e.target.closest('.gl-opt'); if (o) pick(Number(o.dataset.i)); });
    pop.addEventListener('mousemove', function (e) { var o = e.target.closest('.gl-opt'); if (o && Number(o.dataset.i) !== act) { act = Number(o.dataset.i); paintPop(); } });
    paintPop();
  }

  function enhance(select) {
    if (select.dataset.flatSel) return;
    var bg = select.closest('.gl-bg');
    if (!bg || bg.classList.contains('gl-m') || bg.classList.contains('gl-adm')) return;
    select.dataset.flatSel = '1';
    select.style.display = 'none';
    var wrap = document.createElement('div'); wrap.className = 'gl-sel cll-sel';
    wrap.innerHTML = '<button type="button" class="gl-sel-b" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(select.getAttribute('aria-label') || '') + '"><span class="gl-sel-t"></span>' + CHEV + '</button>';
    select.parentNode.insertBefore(wrap, select.nextSibling);
    var o = select.options[select.selectedIndex];
    var f = { select: select, wrap: wrap, btn: wrap.querySelector('.gl-sel-b'), text: wrap.querySelector('.gl-sel-t'), bg: bg };
    f.text.textContent = o ? o.textContent : '';
    f.btn.addEventListener('click', function () { openPop(f); });
    f.btn.addEventListener('keydown', function (e) {
      var n = select.options.length;
      if (!pop) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop(f); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % n; paintPop(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act + n - 1) % n; paintPop(); }
      else if (e.key === 'Home') { e.preventDefault(); act = 0; paintPop(); }
      else if (e.key === 'End') { e.preventDefault(); act = n - 1; paintPop(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(act); }
      else if (e.key === 'Tab') closePop();
    });
    bg.addEventListener('click', function (e) { if (pop && !e.target.closest('.gl-pop') && !e.target.closest('.cll-sel')) closePop(); });
  }

  // Esc при открытом списке закрывает только список, а не всё окно (stopImmediate: окно ссылки слушает Esc на том же узле)
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { e.stopImmediatePropagation(); e.preventDefault(); closePop(); } }, true);

  function scan(root) { (root.querySelectorAll ? root.querySelectorAll('.gl-bg select.cll-ttl') : []).forEach(enhance); }
  new MutationObserver(function (list) {
    list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n.matches && n.matches('select.cll-ttl') ? n.parentNode : n); }); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
