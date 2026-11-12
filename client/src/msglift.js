// Подъём сообщения над затемнённой перепиской (как в мобильной версии /m).
// Правый клик по сообщению: область чата затемняется, копия сообщения остаётся над затемнением,
// а при нехватке места плавно сдвигается так, чтобы над ней поместилась капсула реакций, а под ней меню.
// Сама капсула и меню рисуются в app.js; здесь только затемнение и копия сообщения.
// Файл общий для веб клиента и Electron: server/src/public/shared/msglift.js и client/src/msglift.js — одинаковые копии.
(function () {
  'use strict';
  const EASE = 'cubic-bezier(.32,.72,0,1)';
  const MOVE = 380;     // подъём и возврат, мс
  let cur = null;       // открытый подъём
  let closing = null;   // закрывающийся

  function finish(c) {
    if (!c) return;
    clearTimeout(c.timer);
    document.querySelectorAll('.ml-src').forEach(r => r.classList.remove('ml-src'));
    c.layer.remove();
    if (closing === c) closing = null;
  }

  // Копия живёт отдельно от списка: событий и повторяющихся id у неё быть не должно
  function sanitize(clone, src) {
    clone.classList.remove('ml-src', 'msg-highlight');
    clone.removeAttribute('data-msg-id');
    [clone, ...clone.querySelectorAll('*')].forEach(el => {
      if (el.id) el.removeAttribute('id');
      for (const a of [...el.attributes]) if (a.name.startsWith('data-on-') || a.name.startsWith('data-a-')) el.removeAttribute(a.name);
    });
    // cloneNode не переносит содержимое холстов (пыль спойлера и т. п.)
    const from = src.querySelectorAll('canvas'), to = clone.querySelectorAll('canvas');
    from.forEach((cv, i) => { try { if (to[i] && cv.width && cv.height) to[i].getContext('2d').drawImage(cv, 0, 0); } catch (_) {} });
  }

  // Выделенный в сообщении фрагмент (смещения в тексте .irc-text) подсвечиваем и в копии: видно, что будет процитировано
  function paintSel(clone, sel) {
    const t = clone.querySelector('.irc-text');
    if (!t || !sel) return;
    const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT), r = document.createRange();
    let n, pos = 0, a = false, b = false;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      if (!a && sel.start < pos + len) { r.setStart(n, sel.start - pos); a = true; }
      if (a && sel.end <= pos + len) { r.setEnd(n, sel.end - pos); b = true; break; }
      pos += len;
    }
    if (!a || !b) return;
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  // o: { row — элемент .irc-msg, host — карточка чата (в ней лежит затемнение), area — прямоугольник, где должно уместиться всё,
  //      k — отношение rect к style (масштаб интерфейса), needTop / needBottom — сколько места нужно над сообщением и под ним (px rect),
  //      onDismiss — закрыть меню (правый клик по затемнению), selection — { start, end } выделенного фрагмента }
  // Возвращает { bubble: { left, right, top, bottom }, bottom } в px rect: положение пузыря после подъёма
  function show(o) {
    const row = o && o.row, host = o && o.host;
    if (!row || !host || !row.isConnected) return null;
    if (cur) hide(true);
    if (closing) finish(closing);
    const k = o.k || 1;
    const rr = row.getBoundingClientRect(), hr = host.getBoundingClientRect(), ar = (o.area || host).getBoundingClientRect();
    const M = 6;
    const minTop = ar.top + M + (o.needTop || 0), maxBottom = ar.bottom - M - (o.needBottom || 0);
    const showH = Math.min(rr.height, Math.max(maxBottom - minTop, 80));   // слишком высокое сообщение показываем обрезанным: меню ляжет под ним
    let top = rr.top;
    if (top + showH > maxBottom) top = maxBottom - showH;
    if (top < minTop) top = minTop;
    const shift = top - rr.top;   // px rect

    const layer = document.createElement('div');
    layer.className = 'ml-layer';
    layer.innerHTML = '<div class="ml-scrim"></div>';
    const clone = row.cloneNode(true);
    sanitize(clone, row);
    clone.classList.add('ml-clone');
    const clipped = showH < rr.height - 0.5;
    clone.style.cssText = `left:${(rr.left - hr.left) / k}px;top:${(top - hr.top) / k}px;width:${rr.width / k}px;` +
      (clipped ? `height:${showH / k}px;overflow:hidden;` : '');
    layer.appendChild(clone);
    layer.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (o.onDismiss) o.onDismiss(); });
    host.appendChild(layer);
    paintSel(clone, o.selection);
    row.classList.add('ml-src');

    const c = cur = { row, layer, clone, dy: -shift / k, timer: 0 };
    void layer.offsetWidth;
    layer.classList.add('on');
    if (shift && clone.animate) clone.animate([{ transform: `translateY(${-shift / k}px)` }, { transform: 'none' }], { duration: MOVE, easing: EASE });

    const bub = row.querySelector('.msg-bubble'), br = (bub || row).getBoundingClientRect();
    const bottom = Math.min(br.bottom + shift, top + showH);
    return { bubble: { left: br.left, right: br.right, top: br.top + shift, bottom }, bottom, cur: c };
  }

  function hide(now) {
    const c = cur; if (!c) return;
    cur = null;
    if (now || !c.layer.isConnected) { finish(c); return; }
    closing = c;
    c.layer.classList.add('off');
    const dur = c.dy && c.clone.animate ? MOVE : 0;
    if (dur) c.clone.animate([{ transform: 'none' }, { transform: `translateY(${c.dy}px)` }], { duration: dur, easing: EASE, fill: 'forwards' });
    c.timer = setTimeout(() => finish(c), Math.max(dur, 350) + 20);
  }

  window.MsgLift = { show, hide, isOpen: () => !!cur };
})();
