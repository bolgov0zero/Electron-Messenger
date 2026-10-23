// Остановка всплытия для миниатюр (как stopPropagation в инлайн-атрибуте)
function thumbGo(ev, i) { ev.stopPropagation(); go(i); }
  const params = new URLSearchParams(location.search);
  let mediaUrl = params.get('url') || '';
  let filename = params.get('filename') || 'file';
  let type = params.get('type') || 'image';
  let items = null, idx = 0;
  try { const raw = params.get('items'); if (raw) { items = JSON.parse(raw); idx = Number(params.get('index')) || 0; } } catch {}

  const img = document.getElementById('img');
  const vid = document.getElementById('vid');
  function show() {
    document.body.classList.toggle('video', type === 'video');
    if (type === 'video') { img.removeAttribute('src'); vid.src = mediaUrl; vid.play().catch(() => {}); }
    else { vid.pause(); vid.removeAttribute('src'); img.src = mediaUrl; }
    if (items && items.length > 1) {
      document.body.classList.add('gallery');
      document.getElementById('count').textContent = (idx + 1) + ' из ' + items.length;
      document.getElementById('prev').style.visibility = idx > 0 ? '' : 'hidden';
      document.getElementById('next').style.visibility = idx < items.length - 1 ? '' : 'hidden';
    }
    paintMeta();
  }
  function when(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000), n = new Date(), hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === n.toDateString() ? 'сегодня, ' + hm : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) }) + ', ' + hm;
  }
  function esc(t) { return String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // Кто и когда, подпись, миниатюры и кнопки под текущий кадр
  function paintMeta() {
    const it = items && items[idx], n = items ? items.length : 0;
    const info = document.getElementById('info');
    info.style.display = it && (it.sender || it.at) ? 'flex' : 'none';
    info.innerHTML = it ? '<b>' + esc(it.sender) + '</b><span>' + esc(when(it.at)) + '</span>' : '';
    const cap = document.getElementById('cap'); cap.textContent = it ? it.caption || '' : ''; cap.style.display = it && it.caption ? '' : 'none';
    const th = document.getElementById('thumbs');
    if (n > 1) {
      const from = Math.max(0, Math.min(idx - 10, n - 21)), to = Math.min(n, from + 21);
      th.innerHTML = items.slice(from, to).map((x, k) => '<i class="' + (from + k === idx ? 'on' : '') + '" style="background-image:url(\'' + esc(x.thumb || x.url) + '\')" data-on-click="thumbGo" data-a="[&quot;__event&quot;, ' + (from + k) + ']"></i>').join('');
      th.style.display = '';
    } else th.style.display = 'none';
    document.getElementById('bottom').style.display = it && (it.caption || n > 1) ? 'flex' : 'none';
    document.getElementById('fw').style.display = it && it.mid ? 'flex' : 'none';
    document.getElementById('rm').style.display = it && it.mid && it.mine ? 'flex' : 'none';
  }
  function go(i) { if (items && i >= 0 && i < items.length) step(i - idx); }
  function act(type) { if (items && items[idx]) window.electron?.lightboxAction({ type, item: items[idx] }); }
  function step(dir) {
    if (!items) return;
    const n = idx + dir;
    if (n < 0 || n >= items.length) return;
    idx = n; mediaUrl = items[n].url; filename = items[n].filename || 'file'; type = items[n].type;
    resetZoom(); show();
  }
  show();

  document.body.addEventListener('animationend', e => {
    if (e.animationName === 'mediaIn') document.body.classList.add('opened');
  });

  // Зум/перетаскивание — только у фото
  let scale = 1, tx = 0, ty = 0, drag = null, didDrag = false;
  const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 0.5;
  function applyTransform() {
    img.style.transform = scale === 1 ? '' : `translate(${tx}px,${ty}px) scale(${scale})`;
    document.body.classList.toggle('zoomed', scale > 1);
  }
  function zoomBy(dir) {
    scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(scale + dir * ZOOM_STEP).toFixed(2)));
    if (scale === ZOOM_MIN) { tx = 0; ty = 0; }
    applyTransform();
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  img.addEventListener('mousedown', e => {
    if (scale <= 1) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx, ty };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    tx = drag.tx + dx; ty = drag.ty + dy;
    applyTransform();
  });
  document.addEventListener('mouseup', () => { drag = null; });

  function closeLightbox() {
    if (document.body.classList.contains('closing')) return;
    document.body.classList.add('closing');
    vid.pause();
    setTimeout(() => window.close(), 150);
  }
  document.body.addEventListener('click', e => {
    if (e.target === document.body && !didDrag) closeLightbox();
    didDrag = false;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); });

  function downloadCurrent() { window.electron?.downloadFile({ url: mediaUrl, filename }); }
