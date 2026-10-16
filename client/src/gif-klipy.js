// GIF из Klipy — общий для клиента, веб-клиента и мобильного клиента (копия лежит в client/src/).
//
// По условиям Klipy запросы к их API и загрузка картинок идут напрямую с устройства пользователя, без нашего сервера:
// ответы не переупорядочиваем и не фильтруем (фильтры настраиваются в кабинете Klipy), файлы не храним и не копируем.
// Сервер чата лишь хранит ключ и отдаёт его клиентам через менеджер модулей (Modules.get('gif').config.key).
// В сообщении лежат только ссылки Klipy и размеры (см. server/src/gif.js).
(function () {
  'use strict';
  const API = 'https://api.klipy.com/api/v1/';
  const PER_PAGE = 24;
  const cache = new Map();           // «запрос|страница» → ответ, чтобы не тратить лимит ключа на повторы
  const S = { customerId: '', locale: 'ru', cats: null, catsP: null };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mod = () => (window.Modules && Modules.get('gif')) || null;
  const key = () => mod()?.config?.key || '';
  // Доступно: админ включил модуль и ключ есть. Включён ли у этого человека на устройстве — отдельный вопрос (on)
  const available = () => !!(mod() && key());
  const on = () => !!(mod() && mod().on && key());

  // Анонимный постоянный идентификатор пользователя для Klipy: настоящих имён и номеров им не передаём
  function setUser(seed, locale) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    S.customerId = 'c' + (h >>> 0).toString(16);
    if (locale) S.locale = String(locale).slice(0, 2).toLowerCase();
  }

  class KlipyError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  async function call(method, path, params, body) {
    const k = key();
    if (!k) throw new KlipyError('nokey', 'Ключ Klipy не задан');
    const qs = new URLSearchParams(Object.assign({ customer_id: S.customerId, locale: S.locale }, params || {}));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    let r;
    try {
      r = await fetch(`${API}${encodeURIComponent(k)}/${path}${method === 'GET' ? '?' + qs : ''}`, {
        method, signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new KlipyError('net', 'Нет связи с Klipy'); } finally { clearTimeout(t); }
    if (r.status === 429) throw new KlipyError('limit', 'Лимит запросов Klipy исчерпан');
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new KlipyError('key', 'Klipy не принял ключ');
    if (!r.ok) throw new KlipyError('http', 'Klipy вернул ошибку ' + r.status);
    try { return await r.json(); } catch { throw new KlipyError('http', 'Klipy вернул непонятный ответ'); }
  }

  // Популярное (q пустой) или поиск. Возвращает { items, hasNext } в том порядке, что отдал Klipy
  async function list(q, page) {
    const ck = (q || '') + '|' + page;
    if (cache.has(ck)) return cache.get(ck);
    const params = { page, per_page: PER_PAGE, format_filter: 'mp4,webp,jpg' };
    if (q) params.q = q;
    const j = await call('GET', q ? 'gifs/search' : 'gifs/trending', params);
    const d = (j && j.data) || {};
    const items = (Array.isArray(d.data) ? d.data : []).filter(x => x && x.file && (!x.type || x.type === 'gif'));
    const out = { items, hasNext: !!d.has_next };
    cache.set(ck, out);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    return out;
  }

  // Темы для быстрого выбора. Формат ответа разбираем осторожно: ищем список объектов с названием и запросом
  function categories() {
    if (S.cats) return Promise.resolve(S.cats);
    if (!S.catsP) S.catsP = call('GET', 'gifs/categories', {}).then(j => {
      const pick = v => Array.isArray(v) && v.length && typeof v[0] === 'object' ? v : null;
      const d = j && j.data;
      const arr = pick(d) || pick(d && d.data) || pick(d && d.categories) || pick(d && d.data && d.data.categories) || [];
      S.cats = arr.map(c => ({ name: String(c.category || c.name || c.query || '').trim(), query: String(c.query || c.category || c.name || '').trim() }))
        .filter(c => c.name && c.query).slice(0, 14);
      return S.cats;
    }).catch(() => { S.catsP = null; return []; });
    return S.catsP;
  }

  // Сообщаем Klipy о выбранной гифке (их статистика поиска); сбой не важен
  function share(slug, q) { call('POST', `gifs/share/${encodeURIComponent(slug)}`, {}, { customer_id: S.customerId, q: q || '' }).catch(() => {}); }

  // Что кладём в сообщение: ссылки на средний размер, как их отдал Klipy, и размеры кадра
  function toAttachment(it) {
    const f = it.file || {}, m = f.md || f.sm || f.hd || f.xs || {};
    const pick = (o, t) => (o && o[t] && o[t].url) || '';
    const dims = (m.mp4 || m.webp || m.jpg || {});
    return {
      gif: {
        provider: 'klipy', slug: it.slug, title: it.title || '',
        w: dims.width || 320, h: dims.height || 240,
        mp4: pick(m, 'mp4'), webp: pick(m, 'webp'), jpg: pick(m, 'jpg'),
      },
    };
  }

  const MARK = '<span class="gp-kl"><i></i>KLIPY</span>';

  // ── Панель выбора ──
  // host — пустой контейнер; opts.onPick(attachment). Поле поиска по требованию Klipy подписано «Search KLIPY».
  function mount(host, opts) {
    const o = Object.assign({ onPick() {} }, opts);
    host.innerHTML = `<div class="gp">
      <label class="gp-search"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="gp-q" placeholder="Search KLIPY" autocomplete="off" aria-label="Search KLIPY"></label>
      <div class="gp-chips" role="group" aria-label="Темы"></div>
      <div class="gp-scroll"><div class="gp-cols"><div></div><div></div></div><div class="gp-state"></div></div></div>`;
    const q = host.querySelector('.gp-q'), chips = host.querySelector('.gp-chips'), scroll = host.querySelector('.gp-scroll');
    const cols = [...host.querySelectorAll('.gp-cols > div')], state = host.querySelector('.gp-state');
    const st = { q: '', page: 1, hasNext: false, loading: false, token: 0, heights: [0, 0], cur: 'Популярное' };

    const setState = (html) => { state.innerHTML = html || ''; };
    const addItems = items => {
      for (const it of items) {
        const m = (it.file.sm || it.file.md || it.file.hd || {}), img = m.webp || m.jpg || m.mp4;
        if (!img || !img.url) continue;
        const r = (img.width && img.height) ? img.height / img.width : 1;
        const i = st.heights[0] <= st.heights[1] ? 0 : 1;           // в более низкий столбец: порядок Klipy сохраняется по рядам
        st.heights[i] += r;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'gp-item'; b.title = it.title || '';
        b.style.aspectRatio = (img.width && img.height) ? `${img.width} / ${img.height}` : '1';
        if (it.blur_preview) b.style.backgroundImage = `url("${String(it.blur_preview).replace(/"/g, '')}")`;
        const im = document.createElement('img'); im.loading = 'lazy'; im.alt = it.title || 'GIF'; im.src = img.url;
        im.onerror = () => b.classList.add('bad');
        b.appendChild(im);
        b.onclick = () => { share(it.slug, st.q); o.onPick(toAttachment(it)); };
        cols[i].appendChild(b);
      }
    };
    const load = async (reset) => {
      if (st.loading && !reset) return;
      const token = ++st.token;
      if (reset) { st.page = 1; st.hasNext = false; st.heights = [0, 0]; cols.forEach(c => { c.innerHTML = ''; }); scroll.scrollTop = 0; }
      st.loading = true; setState('<div class="gp-note">Загрузка…</div>');
      try {
        const r = await list(st.q, st.page);
        if (token !== st.token) return;
        addItems(r.items); st.hasNext = r.hasNext; st.page++;
        setState(!cols[0].children.length && !cols[1].children.length
          ? `<div class="gp-note">Ничего не найдено по запросу «${esc(st.q)}».<br>Попробуйте другое слово.</div>` : '');
      } catch (e) {
        if (token !== st.token) return;
        setState(`<div class="gp-note">${esc(e.message)}.<br><button type="button" class="gp-retry">Повторить</button></div>`);
        const rb = state.querySelector('.gp-retry'); if (rb) rb.onclick = () => load(reset);
      } finally { if (token === st.token) st.loading = false; }
    };
    scroll.addEventListener('scroll', () => {
      if (st.hasNext && !st.loading && scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 160) load(false);
    }, { passive: true });

    let tm = 0;
    q.addEventListener('input', () => {
      clearTimeout(tm);
      tm = setTimeout(() => { st.q = q.value.trim(); markChips(); load(true); }, 400);
    });
    function markChips() { const typing = !!q.value.trim(); chips.querySelectorAll('.gp-chip').forEach(b => b.setAttribute('aria-pressed', String(!typing && b.dataset.q === st.q))); }
    const addChip = (name, query) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gp-chip'; b.textContent = name; b.dataset.q = query;
      b.setAttribute('aria-pressed', String(query === '' && !st.q));
      b.onclick = () => { q.value = ''; st.q = query; markChips(); load(true); };
      chips.appendChild(b);
    };
    addChip('Популярное', '');
    categories().then(cs => { cs.forEach(c => addChip(c.name, c.query)); });
    load(true);
    return { focus() { q.focus(); }, reset() { q.value = ''; st.q = ''; markChips(); load(true); } };
  }

  // ── GIF в переписке ──
  const BADGE = `<span class="gif-badge">GIF${MARK}</span>`;
  function messageHtml(att) {
    const g = att && att.gif;
    if (!g) return '';
    // Присланные GIF видны всем, даже если модуль не включён: ролик грузится по ссылке, ключ для этого не нужен.
    // От модуля зависит только поиск и отправка
    const w = g.w || 320, h = g.h || 240, maxW = Math.min(280, Math.max(160, w));
    const poster = g.jpg ? ` poster="${esc(g.jpg)}"` : '';
    const media = g.mp4
      ? `<video class="gif-v" src="${esc(g.mp4)}"${poster} muted loop playsinline preload="metadata" disablepictureinpicture onerror="GifKlipy.fail(this)"></video>`
      : `<img class="gif-v" src="${esc(g.webp)}" alt="${esc(g.title || 'GIF')}" loading="lazy" onerror="GifKlipy.fail(this)">`;
    return `<div class="gif-msg" style="aspect-ratio:${w} / ${h};width:${maxW}px">${media}${BADGE}</div>`;
  }
  // Ролик не загрузился (Klipy убрал или нет связи): заглушка вместо пустого места
  function fail(el) {
    const box = el.closest('.gif-msg'); if (!box) return;
    box.classList.add('gone'); box.style.aspectRatio = 'auto'; box.style.width = 'auto';
    box.innerHTML = '<div class="gif-off"><span class="gif-off-i">✕</span><span>GIF недоступна<br><small>Klipy больше её не отдаёт</small></span></div>';
  }
  // Крутим только то, что на экране: лента с десятком зацикленных роликов иначе нагружает процессор
  let io = null;
  function watch(root) {
    const vids = root.matches && root.matches('video.gif-v') ? [root] : [...root.querySelectorAll('video.gif-v')];
    if (!('IntersectionObserver' in window)) { vids.forEach(v => v.play().catch(() => {})); return; }
    if (!io) io = new IntersectionObserver(es => es.forEach(e => { const v = e.target; if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }), { threshold: 0.25 });
    vids.filter(v => !v.dataset.w).forEach(v => { v.dataset.w = '1'; io.observe(v); });
  }
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches?.('video.gif-v') || n.querySelector?.('video.gif-v'))) watch(n); });
    const start = () => mo.observe(document.body, { childList: true, subtree: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  window.GifKlipy = { available, on, setUser, mount, messageHtml, fail, label: 'GIF', mark: MARK, call };
})();
