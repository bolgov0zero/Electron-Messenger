// Панель смайлов и реакции (Electron и веб клиент).
// Общий файл: server/src/public/shared/emoji-panel.js, копия лежит в client/src, держать синхронно.
// Макет: docs/flat-mockup/emoji.html. Данные — EMOJI_GROUPS и EMOJI_KEYWORDS из emoji-data.js.
//
// Что здесь есть:
//  • один компонент «панель» (поиск, категории, сетка, предпросмотр, оттенки кожи, GIF, клавиатура);
//  • кнопка ☺ в поле ввода (#emoji-btn): наведение открывает поповер, клик — боковую панель;
//  • капсула реакций над сообщением, по «+» разворачивается в ту же панель.
// От приложения нужны только «крючки», их передаёт EmojiPanel.init(host).
(function () {
  'use strict';

  const H = {
    freq: n => [],                  // частые смайлы
    track: em => {},                // учесть использование
    insert: em => {},               // вставить в поле ввода
    canGif: () => false,            // показывать ли вкладку GIF
    mountGif: el => {},             // смонтировать GIF в контейнер
    focusGif: el => {},             // фокус в поиск GIF
    metrics: () => ({ k: 1, vw: innerWidth, vh: innerHeight, f: 1 }),   // масштаб интерфейса и размер окна
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const mk = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const touch = () => matchMedia('(max-width: 767px), (pointer: coarse)').matches;

  // Значки Lucide (ISC)
  const IC = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  };
  const I = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + IC[n] + '</svg>';
  const GICON = { smile: 'smile', hands: 'hand', people: 'users', nature: 'paw', food: 'utensils', travel: 'plane', act: 'trophy', obj: 'bulb', sym: 'heart', flag: 'flag' };

  // ── оттенок кожи ──
  const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
  const TONEC = ['#ffcc4d', '#f7dece', '#e0bb95', '#bf8f68', '#9b643d', '#594539'];
  const MB = /^\p{Emoji_Modifier_Base}/u;
  let tone = 0;
  try { tone = Math.max(0, Math.min(5, +localStorage.getItem('emoji_tone') || 0)); } catch {}
  // Оттенок получают только одиночные символы, к которым он применим; составные последовательности оставляем как есть
  const toned = e => {
    if (!tone) return e;
    const c = [...e.replace(/️/g, '')];
    return c.length === 1 && MB.test(c[0]) ? c[0] + TONES[tone] : e;
  };
  const nameOf = e => (EMOJI_KEYWORDS[e] || '').split(' ').slice(0, 4).join(' ');

  // ── поиск ──
  // Одна лента найденного по убыванию близости: слово целиком 3, начало слова 2, название раздела 1,5, внутри слова 1
  function search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return null;
    const seen = new Set(), out = [];
    for (const g of EMOJI_GROUPS) {
      const gn = g.name.toLowerCase().includes(q);
      for (const e of g.items) {
        if (seen.has(e)) continue;
        const ws = (EMOJI_KEYWORDS[e] || '').split(' ');
        let sc = 0;
        if (ws.includes(q)) sc = 3; else if (ws.some(w => w.startsWith(q))) sc = 2; else if (gn) sc = 1.5; else if (ws.some(w => w.includes(q))) sc = 1;
        if (sc) { seen.add(e); out.push([e, sc]); }
      }
    }
    return out.sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }

  const pickers = new Set();
  const _static = {};   // разметка неизменных разделов по числу колонок

  // ── общий компонент панели ──
  // o: cols, cell (ожидаемый размер ячейки, px), preview (подпись и оттенок), gif, rail (колонка категорий), dock (кнопка «сбоку»),
  //    onPick(em, raw), onDock()
  function makePicker(o) {
    const root = mk('div', 'pk' + (o.rail ? ' rail' : ''));
    const cols = o.cols || 8, cell = o.cell || 40;
    const secs = () => [{ key: 'freq', name: 'Часто используемые', icon: 'clock', items: H.freq(16) },
      ...EMOJI_GROUPS.map(g => ({ key: g.key, name: g.name, icon: GICON[g.key] || 'smile', items: g.items }))];
    const tabsHtml = secs().map((s, i) => `<button class="pk-tab" type="button" data-k="${s.key}" title="${s.name}" aria-selected="${i === 0}">${I(s.icon)}</button>`).join('');
    const top = `<div class="pk-top"><label class="pk-s">${I('search')}<input placeholder="Поиск смайла" autocomplete="off" spellcheck="false"><button class="pk-cl" type="button" hidden>${I('x')}</button></label>` +
      (o.dock ? `<button class="pk-dock" type="button" title="Открыть панелью сбоку">${I('panel')}</button>` : '') +
      (o.gif ? `<div class="pk-sw" hidden><button type="button" data-m="e" aria-pressed="true">Смайлы</button><button type="button" data-m="g" aria-pressed="false">GIF</button></div>` : '') + '</div>';
    const body = '<div class="pk-scroll"></div>' + (o.gif ? '<div class="pk-gif"></div><div class="pk-pw">Powered by <span class="gp-kl"><i></i>KLIPY</span></div>' : '');
    const foot = o.preview ? `<div class="pk-foot"><div class="pk-pv"><span class="hint">Наведите на смайл — здесь его название</span></div><button class="pk-tonebtn" type="button" title="Оттенок кожи">👋</button><div class="pk-tones">${TONEC.map((c, i) => `<button class="tn" type="button" data-i="${i}" style="--c:${c}" title="${i ? 'Оттенок ' + i : 'Без оттенка'}"></button>`).join('')}<span>Оттенок кожи</span></div></div>` : '';
    if (o.rail) root.innerHTML = `<div class="pk-rcol pk-tabs-host">${tabsHtml}</div><div class="pk-rmain">${top}${body}${foot}</div>`;
    else root.innerHTML = `${top}<div class="pk-tabs pk-tabs-host">${tabsHtml}</div>${body}${foot}`;

    const sc = $('.pk-scroll', root), inp = $('.pk-s input', root), cl = $('.pk-cl', root), tabs = $$('.pk-tab', root), gifEl = $('.pk-gif', root), sw = $('.pk-sw', root);
    let searching = false, built = false, lock = null;

    const secHtml = (s) => {
      const ih = Math.ceil(s.items.length / cols) * cell;
      return `<section class="pk-sec" data-k="${s.key}"><h4>${s.name}</h4><div class="pk-grid" style="--cols:${cols};--ih:${ih}px">${s.items.map(e => `<button class="pk-em" type="button" data-e="${e}" tabindex="-1">${toned(e)}</button>`).join('')}</div></section>`;
    };
    function renderAll() {
      const all = secs();
      sc.innerHTML = secHtml(all[0]) + all.slice(1).map(secHtml).join('');
      built = true;
    }
    function doSearch() {
      const q = inp.value, r = search(q);
      cl.hidden = !q;
      if (r === null) { if (searching) { searching = false; renderAll(); sc.classList.add('nosmooth'); sc.scrollTop = 0; sc.classList.remove('nosmooth'); spy(); } return; }
      searching = true;
      sc.innerHTML = r.length
        ? `<section class="pk-sec"><h4>Найдено: ${r.length}</h4><div class="pk-grid" style="--cols:${cols}">${r.slice(0, 300).map(e => `<button class="pk-em" type="button" data-e="${e}" tabindex="-1">${toned(e)}</button>`).join('')}</div></section>`
        : '<div class="pk-empty"><b>🔍</b>Ничего не нашлось</div>';
      sc.scrollTop = 0;
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
    }
    inp.addEventListener('input', doSearch);
    cl.addEventListener('click', () => { inp.value = ''; doSearch(); inp.focus(); });

    // Активная вкладка следует за прокруткой; после нажатия на вкладку держим выбранную, пока человек сам не прокрутит
    function spy() {
      if (searching || lock) return;
      const secsEl = $$('.pk-sec', sc);
      if (!secsEl.length) return;
      let cur = secsEl[0].dataset.k;
      const topY = sc.getBoundingClientRect().top;
      for (const s of secsEl) if (s.getBoundingClientRect().top - topY <= 30) cur = s.dataset.k;
      if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 4) cur = secsEl[secsEl.length - 1].dataset.k;
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.k === cur)));
    }
    sc.addEventListener('scroll', spy, { passive: true });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(ev => sc.addEventListener(ev, () => { lock = null; }, { passive: true }));
    tabs.forEach(t => t.addEventListener('click', () => {
      if (searching) { inp.value = ''; doSearch(); }
      const s = $(`.pk-sec[data-k="${t.dataset.k}"]`, sc); if (!s) return;
      const h = $('h4', s);
      sc.scrollTo({ top: sc.scrollTop + s.getBoundingClientRect().top - sc.getBoundingClientRect().top - (h ? h.offsetHeight : 0) });
      lock = t.dataset.k;
      tabs.forEach(x => x.setAttribute('aria-selected', String(x === t)));
    }));

    // Выбор и предпросмотр
    sc.addEventListener('click', e => {
      const b = e.target.closest('.pk-em'); if (!b) return;
      const raw = b.dataset.e;
      H.track(raw);
      o.onPick && o.onPick(o.preview ? toned(raw) : raw, raw);
    });
    const pv = $('.pk-pv', root);
    const showPv = b => {
      if (!pv) return;
      if (!b) { pv.innerHTML = '<span class="hint">Наведите на смайл — здесь его название</span>'; return; }
      const e = b.dataset.e, n = nameOf(e).split(' ');
      pv.innerHTML = `<span class="big">${toned(e)}</span><span class="nm"><b>${n[0] || ''}</b>${n.slice(1).join(' ')}</span>`;
    };
    sc.addEventListener('mouseover', e => { const b = e.target.closest('.pk-em'); if (b) showPv(b); });
    sc.addEventListener('focusin', e => { const b = e.target.closest('.pk-em'); if (b) showPv(b); });
    sc.addEventListener('mouseleave', () => showPv(null));

    // Оттенок кожи
    const tb = $('.pk-tonebtn', root), tn = $('.pk-tones', root);
    if (tb) {
      tb.addEventListener('click', () => tn.classList.toggle('open'));
      tn.addEventListener('click', e => {
        const b = e.target.closest('.tn'); if (!b) return;
        tone = +b.dataset.i;
        try { localStorage.setItem('emoji_tone', String(tone)); } catch {}
        tn.classList.remove('open');
        pickers.forEach(p => p.refresh());
      });
    }
    const dk = $('.pk-dock', root);
    if (dk) dk.addEventListener('click', () => o.onDock && o.onDock());

    // GIF (модуль «GIF»): переключатель виден, только если приложение разрешает
    function setMode(m) {
      const gif = m === 'g' && H.canGif();
      root.classList.toggle('gif', gif);
      $$('.pk-sw button', root).forEach(b => b.setAttribute('aria-pressed', String((b.dataset.m === 'g') === gif)));
      if (gif) { if (!gifEl.dataset.mounted) { gifEl.dataset.mounted = '1'; H.mountGif(gifEl); } if (!touch()) H.focusGif(gifEl); }
    }
    if (sw) $$('button', sw).forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
    function syncGif() {
      if (!sw) return;
      const can = H.canGif();
      sw.hidden = !can;
      if (!can && root.classList.contains('gif')) setMode('e');
    }

    // Клавиатура по сетке: стрелки двигают по ячейкам, Enter вставляет, печать уходит в поиск
    const ems = () => $$('.pk-em', sc).filter(b => b.offsetParent);
    function move(cur, dir) {
      const list = ems(), i = list.indexOf(cur);
      if (i < 0) return list[0];
      if (dir === 'l') return list[i - 1] || cur;
      if (dir === 'r') return list[i + 1] || cur;
      const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2;
      let best = null, bd = 1e9;
      for (const b of list) {
        const q = b.getBoundingClientRect(), dy = dir === 'd' ? q.top - r.top : r.top - q.top;
        if (dy < 4) continue;
        const d = dy * 1000 + Math.abs(q.left + q.width / 2 - cx);
        if (d < bd) { bd = d; best = b; }
      }
      return best || cur;
    }
    root.addEventListener('keydown', e => {
      const t = e.target, isEm = t.classList && t.classList.contains('pk-em'), dirs = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd' };
      if (t === inp && e.key === 'ArrowDown') { const f = ems()[0]; if (f) { e.preventDefault(); f.focus(); f.scrollIntoView({ block: 'nearest' }); } return; }
      if (isEm && dirs[e.key]) {
        e.preventDefault();
        if (e.key === 'ArrowUp' && move(t, 'u') === t) { inp.focus(); return; }
        const n = move(t, dirs[e.key]); n.focus(); n.scrollIntoView({ block: 'nearest' }); return;
      }
      if (isEm && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) inp.focus();
    });

    const api = {
      root,
      focus() { if (root.classList.contains('gif')) { if (!touch()) H.focusGif(gifEl); return; } if (touch()) return; inp.focus(); inp.select(); },
      reset() { inp.value = ''; if (searching) doSearch(); lock = null; if (root.classList.contains('gif')) setMode('e'); sc.classList.add('nosmooth'); sc.scrollTop = 0; sc.classList.remove('nosmooth'); },
      refresh() {
        if (!built) return;
        if (searching) { doSearch(); }
        else { const t = sc.scrollTop; renderAll(); sc.classList.add('nosmooth'); sc.scrollTop = t; sc.classList.remove('nosmooth'); }
        $$('.pk-tonebtn', root).forEach(b => { b.textContent = toned('👋'); });
        $$('.pk-tones .tn', root).forEach(b => b.classList.toggle('on', +b.dataset.i === tone));
      },
      // Разметку строим при первом показе, а «часто используемые» сверяем при каждом
      onShow() {
        if (!built) { renderAll(); $$('.pk-tonebtn', root).forEach(b => { b.textContent = toned('👋'); }); $$('.pk-tones .tn', root).forEach(b => b.classList.toggle('on', +b.dataset.i === tone)); }
        else if (!searching) {
          const f = H.freq(16).join(''), cur = $('.pk-sec[data-k="freq"]', sc);
          if (cur && cur.dataset.f !== f) { const t = sc.scrollTop; renderAll(); sc.classList.add('nosmooth'); sc.scrollTop = t; sc.classList.remove('nosmooth'); }
        }
        const fs = $('.pk-sec[data-k="freq"]', sc); if (fs) fs.dataset.f = H.freq(16).join('');
        syncGif(); spy();
      },
    };
    pickers.add(api);
    return api;
  }

  // ── поповер и боковая панель ──
  let pkA = null, pkB = null, hoverT = 0, closeT = 0, drawerEl = null;
  const btn = () => document.getElementById('emoji-btn');
  const pill = () => document.getElementById('composer-pill');
  const popEl = () => document.getElementById('pk-pop');
  const popOpen = () => !!popEl()?.classList.contains('show');
  const drawerOpen = () => !!drawerEl && drawerEl.classList.contains('open');

  function ensurePop() {
    const p = pill(); if (!p) return null;
    let el = popEl();
    if (el && el.parentNode !== p) { el.remove(); el = null; }
    if (!el) { el = mk('div', 'pk-pop'); el.id = 'pk-pop'; p.appendChild(el); }
    return el;
  }
  function openPop() {
    if (drawerOpen() || popOpen()) return;
    const b = btn(), p = pill(); if (!b || !p) return;
    const el = ensurePop(); if (!el) return;
    if (!pkA) pkA = makePicker({ cols: 8, cell: 43, preview: true, gif: true, dock: true, onPick: e => H.insert(e), onDock: openDrawer });
    if (pkA.root.parentNode !== el) el.appendChild(pkA.root);
    // Положение: над полем, правым краем по кнопке. Разница rect и style зависит от масштаба интерфейса
    const k = H.metrics().k || 1, br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
    el.style.right = Math.max(8, (pr.right - br.right) / k - 4) + 'px';
    el.style.bottom = 'calc(100% + 8px)';
    el.classList.add('show');
    pkA.onShow();
    pkA.focus();
  }
  function closePop() { clearTimeout(hoverT); clearTimeout(closeT); popEl()?.classList.remove('show'); }
  function ensureDrawer() {
    if (drawerEl && drawerEl.isConnected) return drawerEl;
    const main = document.getElementById('chat-main'); if (!main) return null;
    drawerEl = mk('aside', 'pk-drawer');
    drawerEl.id = 'pk-drawer';
    drawerEl.innerHTML = `<div class="in"><div class="pk-dh"><b>Смайлы</b><button type="button" title="Закрыть (Esc)">${I('x')}</button></div></div>`;
    $('.pk-dh button', drawerEl).addEventListener('click', closeDrawer);
    main.parentNode.insertBefore(drawerEl, main.nextSibling);
    return drawerEl;
  }
  function openDrawer() {
    const d = ensureDrawer(); if (!d) return;
    closePop();
    if (!pkB) pkB = makePicker({ cols: 7, cell: 40, preview: true, gif: true, rail: true, onPick: e => H.insert(e) });
    if (pkB.root.parentNode !== $('.in', d)) $('.in', d).appendChild(pkB.root);
    d.classList.add('open');
    document.body.classList.add('pk-drawer-open');
    pkB.onShow();
    setTimeout(() => { if (drawerOpen()) pkB.focus(); }, 300);
  }
  function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('open');
    document.body.classList.remove('pk-drawer-open');
  }

  // Поповер живёт, пока указатель над кнопкой или над ним, либо пока в его поиске стоит курсор
  const inZone = n => !!(n && n.closest && n.closest('#emoji-btn, #pk-pop'));
  const busy = () => { const a = document.activeElement; return !!(a && a.tagName === 'INPUT' && a.closest('#pk-pop')); };
  function schedClose() {
    clearTimeout(hoverT); clearTimeout(closeT);
    closeT = setTimeout(() => {
      const b = btn(), p = popEl();
      if ((b && b.matches(':hover')) || (p && p.matches(':hover')) || busy()) return;
      closePop();
    }, 300);
  }
  function bindControls() {
    document.addEventListener('mouseover', e => {
      if (!inZone(e.target)) return;
      clearTimeout(closeT);
      if (e.target.closest('#emoji-btn') && !inZone(e.relatedTarget) && !popOpen() && !drawerOpen()) { clearTimeout(hoverT); hoverT = setTimeout(openPop, 140); }
    });
    document.addEventListener('mouseout', e => {
      if (inZone(e.target) && !inZone(e.relatedTarget)) schedClose();
    });
    document.addEventListener('focusout', e => {
      if (e.target.closest && e.target.closest('#pk-pop')) setTimeout(() => { if (popOpen() && !busy()) schedClose(); }, 0);
    });
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('#emoji-btn')) { e.stopPropagation(); drawerOpen() ? closeDrawer() : openDrawer(); }
    }, true);
    document.addEventListener('mousedown', e => {
      if (popOpen() && !inZone(e.target)) closePop();
    });
  }

  // ── капсула реакций ──
  let capEl = null, pkR = null, capOpts = null;
  function ensureCap() {
    if (capEl && capEl.isConnected) return capEl;
    capEl = mk('div', 'rx-cap');
    capEl.id = 'rx-cap';
    capEl.innerHTML = '<div class="rx-q"></div><div class="rx-pick"></div>';
    capEl.addEventListener('click', e => {
      e.stopPropagation();
      const q = e.target.closest('.rx-q .q');
      if (q) { H.track(q.dataset.e); capOpts?.onPick(q.dataset.e); return; }
      if (e.target.closest('.rx-q .pl')) expandCap();
    });
    capEl.addEventListener('contextmenu', e => e.preventDefault());
    document.body.appendChild(capEl);
    return capEl;
  }
  // Показ: left/top — положение свёрнутой капсулы в единицах style.left/top, align — к какому краю прижата при разворачивании
  function showCapsule(o) {
    const el = ensureCap();
    capOpts = o;
    el.classList.remove('exp', 'pop-out');
    document.body.classList.remove('rx-exp');
    const mine = o.reacted || new Set();
    $('.rx-q', el).innerHTML = H.freq(7).map(e => `<button class="q${mine.has(e) ? ' mine' : ''}" type="button" data-e="${e}">${e}</button>`).join('') +
      `<button class="pl" type="button" title="Все реакции">${I('plus')}</button>`;
    el.style.left = '-9999px'; el.style.top = '-9999px';
    el.classList.add('show');
    // Ширина свёрнутой капсулы — по содержимому. На время замера гасим анимацию появления: во время неё rect уменьшен (scale)
    const rq = $('.rx-q', el);
    el.style.animation = 'none';
    const k = H.metrics().k || 1, cw = Math.round(rq.getBoundingClientRect().width / k);
    el.style.animation = '';
    el.style.setProperty('--cw', cw + 'px');
    const m = H.metrics(), vw = m.vw / k, vh = m.vh / k, M = 6;
    const fit = (l, w) => Math.max(M, Math.min(l, vw - M - w));
    const right = o.align === 'right';
    el._l0 = fit(right ? o.anchorX - cw : o.anchorX, cw);
    el._l1 = fit(right ? o.anchorX - 312 : o.anchorX, 312);
    el._t0 = o.top;
    el._t1 = Math.max(M, Math.min(o.top, vh - M - 352));
    el.style.transition = 'none';
    el.style.left = el._l0 + 'px'; el.style.top = el._t0 + 'px';
    void el.offsetWidth;
    el.style.transition = '';
    return { width: cw, height: 46 };
  }
  function expandCap() {
    const el = capEl; if (!el || !capOpts) return;
    if (!pkR) pkR = makePicker({ cols: 8, cell: 37, preview: false, onPick: e => capOpts?.onPick(e) });
    const host = $('.rx-pick', el);
    if (pkR.root.parentNode !== host) host.appendChild(pkR.root);
    el.classList.add('exp');   // сначала показываем: у скрытой панели нулевая высота, и подсветка вкладки уезжала бы на последний раздел
    document.body.classList.add('rx-exp');
    pkR.reset(); pkR.onShow();
    el.style.left = el._l1 + 'px'; el.style.top = el._t1 + 'px';
    setTimeout(() => { if (el.classList.contains('exp')) pkR.focus(); }, 240);
  }
  function hideCapsule() {
    const el = capEl; if (!el || !el.classList.contains('show')) return;
    el.classList.remove('show', 'exp');
    document.body.classList.remove('rx-exp');
    capOpts = null;
  }
  const capsuleOpen = () => !!capEl && capEl.classList.contains('show');

  let inited = false;
  window.EmojiPanel = {
    init(host) {
      Object.assign(H, host || {});
      if (inited) return; inited = true;
      bindControls();
    },
    showCapsule, hideCapsule, capsuleOpen,
    // Escape: закрывает по одному уровню — сначала поповер, потом боковую панель; true, если что-то закрыли
    escape() {
      if (popOpen()) { closePop(); return true; }
      if (drawerOpen()) { closeDrawer(); return true; }
      return false;
    },
    isOpen: () => popOpen() || drawerOpen(),
    closePop,
    closeDrawer,
  };
})();
