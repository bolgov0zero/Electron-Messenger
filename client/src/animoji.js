// Модуль «Анимированные смайлы» — общий движок для Electron, веб и мобильного клиентов.
//
// Эмодзи в тексте остаются обычными символами (поиск, копирование, цитаты работают как раньше).
// Когда модуль доступен и включён, смайл из набора оборачивается в <span class="am">, и поверх
// него по правилам ниже рисуется анимация Lottie. Пока она не играет, виден обычный глиф Noto.
//
// Правила проигрывания:
//   • новое сообщение (отправлено только что) играет один раз, когда оно видно на экране и окно в фокусе;
//     если окно не в фокусе, сообщение ждёт и играет, когда фокус вернулся;
//   • история (старые сообщения, подгрузка вверх) стоит на месте;
//   • клик по смайлу в сообщении проигрывает анимацию ещё раз;
//   • реакции играют, когда появились, и при наведении;
//   • одновременно играют не больше MAX_PLAYING, остальные в очереди; при «меньше движения» автозапуска нет.
//
// Состояние «включено у меня» хранится на устройстве (localStorage), на сервер уходит только для статистики.
(function () {
  'use strict';
  const MAX_PLAYING = 4;
  const LS_ON = 'animoji_on', LS_DEV = 'animoji_device';
  const FRESH_SEC = 90;                       // «новое» сообщение: отправлено не больше полутора минут назад
  const EMOJI_RE = /[‼-㊙\u{1F000}-\u{1FAFF}]/u;

  const S = {
    cfg: null,            // { client, version, base(), token(), lottieSrc }
    available: false,     // админ включил модуль на сервере
    info: null,           // { version, count, bytes, base }
    manifest: null,       // { items: { key: { r, s } } }
    on: false,            // включено у меня
    lottie: null,
    playing: 0, queue: [], jsonMem: new Map(), pending: new Set(),
    io: null, mo: null, root: null,
    downloading: false, cancel: false,
    listeners: new Set(),
  };

  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const keyOf = s => { let k = []; for (const c of s) { const n = c.codePointAt(0); if (n !== 0xfe0f) k.push(n.toString(16)); } return k.join('_'); };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const ver = () => { const v = S.cfg && S.cfg.version; return typeof v === 'function' ? v() : (v || ''); };
  const emit = () => S.listeners.forEach(f => { try { f(api.state()); } catch {} });
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function deviceId() {
    let id = lsGet(LS_DEV);
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 32); lsSet(LS_DEV, id); }
    return id;
  }
  async function call(method, path, body) {
    const r = await fetch(S.cfg.base() + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.cfg.token() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  // ── Файлы набора: кэш браузера (Cache Storage) + память ──
  const cacheName = () => 'animoji-v' + (S.info?.version || 0);
  const fileUrl = k => `${S.cfg.base()}${S.info.base}/lottie/${k}.json?v=${S.info.version}`;
  async function fetchJson(k) {
    if (S.jsonMem.has(k)) return S.jsonMem.get(k);
    const url = fileUrl(k);
    let res = null, cache = null;
    try { cache = await caches.open(cacheName()); res = await cache.match(url); } catch {}
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (cache) { try { await cache.put(url, res.clone()); } catch {} }
    }
    const data = await res.json();
    S.jsonMem.set(k, data);
    if (S.jsonMem.size > 60) S.jsonMem.delete(S.jsonMem.keys().next().value);
    return data;
  }
  async function dropOldCaches() {
    try { for (const n of await caches.keys()) if (n.startsWith('animoji-v') && n !== cacheName()) await caches.delete(n); } catch {}
  }
  function loadLottie() {
    if (S.lottie) return S.lottie;
    if (window.lottie) return (S.lottie = Promise.resolve(window.lottie));
    return (S.lottie = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = S.cfg.lottieSrc; s.onload = () => ok(window.lottie); s.onerror = () => { S.lottie = null; no(new Error('lottie')); };
      document.head.appendChild(s);
    }));
  }

  // ── Оборачивание смайлов в тексте ──
  const SKIP = 'script,style,textarea,input,.am,.am-box,pre,code,.md-code';
  function wrapText(node, fresh) {
    const text = node.nodeValue;
    if (!text || !EMOJI_RE.test(text)) return;
    const items = S.manifest.items;
    const parts = []; let hit = false, buf = '';
    const grapheme = seg ? [...seg.segment(text)].map(x => x.segment) : [...text];
    for (const g of grapheme) {
      const k = EMOJI_RE.test(g) ? keyOf(g) : '';
      if (k && items[k]) { if (buf) { parts.push(buf); buf = ''; } parts.push({ g, k }); hit = true; } else buf += g;
    }
    if (!hit) return;
    if (buf) parts.push(buf);
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (typeof p === 'string') { frag.appendChild(document.createTextNode(p)); continue; }
      const sp = document.createElement('span'); sp.className = 'am'; sp.dataset.k = p.k;
      const ch = document.createElement('span'); ch.className = 'am-ch'; ch.textContent = p.g; sp.appendChild(ch);
      if (fresh) { sp.dataset.fresh = '1'; watch(sp); }
      frag.appendChild(sp);
    }
    node.parentNode.replaceChild(frag, node);
  }
  function wrapIn(el, fresh) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; let n; while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach(t => wrapText(t, fresh));
  }
  function unwrapAll(root) {
    (root || document).querySelectorAll('.am').forEach(sp => { sp.replaceWith(document.createTextNode(sp.querySelector('.am-ch')?.textContent || '')); });
    (root || document).normalize?.();
  }

  // ── Что считается «новым» ──
  function msgFresh(msgEl) {
    const t = parseInt(msgEl.dataset.sentAt, 10);
    return !!t && Date.now() / 1000 - t < FRESH_SEC;
  }
  function scan(root) {
    if (!S.cfg || !S.available || !S.on || !S.manifest) return;
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('.irc-text, .bubble-text, .ra-emoji, .reaction-pill')] : [];
    for (const el of els) {
      if (!el.matches || !el.matches('.irc-text, .bubble-text, .ra-emoji, .reaction-pill')) continue;
      if (el.closest('.irc-deleted')) continue;
      const msg = el.closest('[data-msg-id]');
      const isReact = el.matches('.ra-emoji, .reaction-pill') || !!el.closest('.reactions, .reaction-btn, .msg-reactions');
      let fresh = false;
      if (msg) {
        if (isReact) fresh = msg.dataset.amSeen === '1';           // реакция добавилась к уже показанному сообщению
        else fresh = msgFresh(msg) && msg.dataset.amSeen !== '1';
      }
      wrapIn(el, fresh);
    }
    // Сообщение отмечаем увиденным после первого прохода: реакции, добавленные позже, считаются новыми
    root.querySelectorAll?.('[data-msg-id]').forEach(m => { m.dataset.amSeen = '1'; });
    if (root.dataset && root.dataset.msgId) root.dataset.amSeen = '1';
  }

  // ── Видимость и фокус ──
  const focused = () => document.hasFocus() && document.visibilityState === 'visible';
  function watch(sp) {
    if (reduced()) return;
    if (!S.io) S.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { S.io.unobserve(e.target); tryAuto(e.target); } }), { threshold: 0.6 });
    S.io.observe(sp);
  }
  function tryAuto(sp) {
    if (!sp.isConnected || sp.dataset.fresh !== '1') return;
    if (!focused()) { S.pending.add(sp); return; }
    delete sp.dataset.fresh; play(sp);
  }
  function onFocus() {
    if (!focused()) return;
    for (const sp of [...S.pending]) {
      S.pending.delete(sp);
      if (!sp.isConnected || sp.dataset.fresh !== '1') continue;
      const r = sp.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) { delete sp.dataset.fresh; play(sp); } else watch(sp);
    }
  }

  // ── Проигрывание ──
  function play(sp) {
    if (!sp || sp.classList.contains('playing') || sp.classList.contains('queued')) return;
    if (S.playing >= MAX_PLAYING) { sp.classList.add('queued'); S.queue.push(sp); return; }
    start(sp);
  }
  function next() {
    while (S.queue.length) { const nx = S.queue.shift(); nx.classList.remove('queued'); if (nx.isConnected) { start(nx); return; } }
  }
  async function start(sp) {
    S.playing++;
    sp.classList.remove('queued'); sp.classList.add('playing');
    let box = null, anim = null, ended = false;
    const finish = () => {
      if (ended) return; ended = true;
      S.playing = Math.max(0, S.playing - 1);
      sp.classList.remove('playing');
      if (box) box.remove();
      if (anim) { try { anim.destroy(); } catch {} }
      next();
    };
    try {
      const [lottie, data] = await Promise.all([loadLottie(), fetchJson(sp.dataset.k)]);
      if (!sp.isConnected) return finish();
      box = document.createElement('i'); box.className = 'am-box'; sp.appendChild(box);
      anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) });
      anim.addEventListener('complete', finish);
      anim.addEventListener('data_failed', finish);
    } catch { finish(); }
  }

  // ── Реакции при наведении и клик ──
  function onClick(e) {
    const sp = e.target.closest?.('.am'); if (!sp) return;
    if (sp.closest('.reaction-btn, .reaction-pill, .ra-emoji')) return;       // у реакций клик ставит или снимает реакцию
    const sel = window.getSelection?.(); if (sel && !sel.isCollapsed && sel.toString()) return;
    play(sp);
  }
  function onOver(e) {
    const b = e.target.closest?.('.reaction-btn, .reaction-pill'); if (!b || b._amHover) return;
    b._amHover = true; setTimeout(() => { b._amHover = false; }, 600);
    b.querySelectorAll('.am').forEach(play);
  }

  // ── Наблюдатель за появлением сообщений ──
  function attach(root) {
    if (!root) return;
    if (S.root === root && S.mo) return;      // уже следим за этим контейнером
    detach();
    S.root = root;
    const HOST = '.irc-text, .bubble-text, .ra-emoji, .reaction-pill';
    S.mo = new MutationObserver(recs => {
      const targets = new Set();
      for (const r of recs) for (const n of r.addedNodes) {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || el.classList.contains('am') || el.classList.contains('am-box') || el.classList.contains('am-ch')) continue;
        if (el.closest('.am')) continue;
        targets.add(el.closest(HOST) || el);
      }
      targets.forEach(t => { if (t.isConnected) scan(t); });
      S.mo.takeRecords();                      // собственные правки (обёртки) повторно не разбираем
    });
    S.mo.observe(root, { childList: true, subtree: true });
    scan(root);
  }
  function detach() { if (S.mo) { S.mo.disconnect(); S.mo = null; } S.root = null; }

  // ── Публичный интерфейс ──
  const api = {
    // cfg: { client: 'electron'|'web'|'mobile', version, base(), token(), lottieSrc }
    init(cfg) {
      S.cfg = cfg; S.on = lsGet(LS_ON) === '1';
      addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
      document.addEventListener('click', onClick, true); document.addEventListener('mouseover', onOver, true);
    },
    state() { return { available: S.available, on: S.on, active: S.available && S.on, info: S.info, downloading: S.downloading }; },
    subscribe(f) { S.listeners.add(f); return () => S.listeners.delete(f); },
    // Спросить сервер, какие модули доступны, и подготовить набор
    async refresh() {
      if (!S.cfg || !S.cfg.token()) return;
      let list = null;
      try { list = await call('GET', '/api/modules'); } catch { return; }
      const m = Array.isArray(list) ? list.find(x => x.key === 'animoji') : null;
      const was = S.available;
      S.available = !!m; S.info = m || null;
      if (m) {
        try { S.manifest = await (await fetch(`${S.cfg.base()}${m.base}/manifest.json?v=${m.version}`)).json(); }
        catch { S.manifest = null; }
        dropOldCaches();
        if (S.on) api.report();
      } else { S.manifest = null; }
      if (was && !S.available) { unwrapAll(S.root); S.queue.length = 0; }
      if (S.available && S.on && S.manifest && S.root) scan(S.root);
      emit();
    },
    report() {
      if (!S.available) return;
      call('POST', '/api/modules/animoji/device', { device_id: deviceId(), client: S.cfg.client, version: ver(), enabled: S.on }).catch(() => {});
    },
    setOn(on) {
      S.on = !!on; lsSet(LS_ON, S.on ? '1' : '0');
      api.report();
      if (S.on) { if (S.root && S.manifest) scan(S.root); } else { unwrapAll(S.root); S.queue.length = 0; }
      emit();
    },
    attach, detach,
    rescan() { if (S.root) scan(S.root); },
    // Электрон: скачать весь набор заранее. onProgress({ done, total, bytes })
    async download(onProgress) {
      if (!S.available || !S.info || !S.manifest) throw new Error('Набор недоступен');
      S.downloading = true; S.cancel = false; emit();
      const keys = Object.keys(S.manifest.items), total = keys.length;
      let done = 0, bytes = 0, failed = 0, firstErr = '';
      call('POST', '/api/modules/animoji/event', { device_id: deviceId(), client: S.cfg.client, version: ver(), event: 'download_start' }).catch(() => {});
      let cache = null; try { cache = await caches.open(cacheName()); } catch {}
      let i = 0;
      const worker = async () => {
        while (i < keys.length && !S.cancel) {
          const k = keys[i++], url = fileUrl(k);
          try {
            const hit = cache && await cache.match(url);
            if (!hit) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); if (cache) await cache.put(url, res.clone()); }
            bytes += S.manifest.items[k].s;
          } catch (e) { failed++; firstErr = firstErr || (e && e.message) || 'ошибка'; }
          done++; onProgress && onProgress({ done, total, bytes, failed });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      S.downloading = false; emit();
      if (S.cancel) return { ok: false, cancelled: true, failed, total };
      if (failed) call('POST', '/api/modules/animoji/event', { device_id: deviceId(), client: S.cfg.client, version: ver(), event: 'download_error', detail: `${failed} из ${total}: ${firstErr}` }).catch(() => {});
      return { ok: !failed, failed, total };
    },
    cancelDownload() { S.cancel = true; },
    async clearCache() { try { for (const n of await caches.keys()) if (n.startsWith('animoji-v')) await caches.delete(n); } catch {} S.jsonMem.clear(); },
  };
  window.Animoji = api;
})();
