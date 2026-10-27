// /m — «потянуть для обновления»: тянем список вниз от самого верха, значок крутится, пока идёт запрос
B.ptr = function (scroller, refresh) {
  var host = scroller.parentNode, ind = document.createElement('div'), TH = 70, y0 = null, dy = 0, busy = false;
  ind.className = 'ptri'; ind.innerHTML = B.ic('refresh', 22, 2.2); host.appendChild(ind);
  function paint(p, spin) {
    ind.style.opacity = spin ? 1 : Math.min(1, p / TH);
    ind.style.transform = 'translate(-50%,' + (spin ? 10 : Math.min(p, TH * 1.4) * 0.45 - 8) + 'px) rotate(' + (spin ? 0 : p * 3) + 'deg)';
    ind.classList.toggle('spin', !!spin);
  }
  function settle() { scroller.style.transition = 'transform .25s var(--ease)'; scroller.style.transform = ''; ind.style.transition = 'opacity .2s, transform .25s var(--ease)'; paint(0, false); setTimeout(function () { scroller.style.transition = ''; ind.style.transition = ''; }, 280); }
  scroller.addEventListener('touchstart', function (e) { if (busy || scroller.scrollTop > 0 || e.touches.length !== 1) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  scroller.addEventListener('touchmove', function (e) {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || scroller.scrollTop > 0) { if (dy <= 0) { y0 = null; scroller.style.transform = ''; paint(0, false); } return; }
    if (e.cancelable) e.preventDefault();
    scroller.style.transition = 'none'; scroller.style.transform = 'translateY(' + Math.min(dy, TH * 1.6) * 0.45 + 'px)'; paint(dy, false);
  }, { passive: false });
  function end() {
    if (y0 == null) return; var go = dy > TH; y0 = null;
    if (!go) { settle(); return; }
    busy = true; scroller.style.transition = 'transform .2s var(--ease)'; scroller.style.transform = 'translateY(40px)'; paint(0, true);
    var t0 = Date.now();
    Promise.resolve(refresh()).catch(function () {}).then(function () {
      var wait = Math.max(0, 600 - (Date.now() - t0));   // значок успевает показаться, даже если ответ пришёл мгновенно
      setTimeout(function () { busy = false; settle(); B.toast.show(B.conn.state === 'offline' ? 'Нет связи с сервером' : 'Обновлено'); }, wait);
    });
  }
  scroller.addEventListener('touchend', end, { passive: true }); scroller.addEventListener('touchcancel', end, { passive: true });
};
