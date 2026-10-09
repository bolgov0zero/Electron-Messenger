// Модуль «Анимированные смайлы»: обработчик для менеджера модулей (modules.js).
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
// Состояние модуля (доступен ли, включён ли, версии, загрузка файлов) хранит и ведёт Modules.
(function () {
  'use strict';
  const KEY = 'animoji';
  const MAX_PLAYING = 4;
  const FRESH_SEC = 90;                       // «новое» сообщение: отправлено не больше полутора минут назад
  const EMOJI_RE = /[‼-㊙\u{1F000}-\u{1FAFF}]/u;

  const S = { cfg: null, lottie: null, playing: 0, queue: [], pending: new Set(), io: null, mo: null, root: null };

  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const keyOf = s => { let k = []; for (const c of s) { const n = c.codePointAt(0); if (n !== 0xfe0f) k.push(n.toString(16)); } return k.join('_'); };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const active = () => !!(window.Modules && Modules.isActive(KEY));
  const manifest = () => (window.Modules && Modules.manifest(KEY)) || null;

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
    const items = manifest().items;
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
    if (!S.cfg || !active()) return;
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
    const host = root.closest?.('[data-msg-id]'); if (host) host.dataset.amSeen = '1';
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
  // Размер и положение анимации — целые пиксели. Через translate(-50%) выходили дробные смещения,
  // и векторная картинка ложилась между пикселями экрана: анимация была заметно мягче статичного смайла
  function fitBox(sp, box) {
    const fs = parseFloat(getComputedStyle(sp).fontSize) || 16;
    const size = Math.max(8, Math.round(fs * 1.18));
    const w = sp.offsetWidth, h = sp.offsetHeight;
    box.style.width = box.style.height = size + 'px';
    box.style.left = Math.round((w - size) / 2) + 'px';
    box.style.top = Math.round((h - size) / 2) + 'px';
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
      const [lottie, data] = await Promise.all([loadLottie(), Modules.fetchJson(KEY, `lottie/${sp.dataset.k}.json`)]);
      if (!sp.isConnected) return finish();
      box = document.createElement('i'); box.className = 'am-box'; sp.appendChild(box);
      fitBox(sp, box);
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

  const api = {
    // cfg: { lottieSrc } — адрес библиотеки Lottie
    init(cfg) {
      if (S.cfg) return;
      S.cfg = cfg;
      addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
      document.addEventListener('click', onClick, true); document.addEventListener('mouseover', onOver, true);
      Modules.register(KEY, {
        onActive() { if (S.root) scan(S.root); },
        onInactive() { unwrapAll(S.root); S.queue.length = 0; },
        onChange() { if (S.root) scan(S.root); },
      });
    },
    // Короткое состояние для полосы в панели смайлов
    state() { const m = window.Modules && Modules.get(KEY); return { available: !!m, on: !!(m && m.on), info: m }; },
    setOn(on) { Modules.setOn(KEY, on); },
    attach, detach,
    rescan() { if (S.root) scan(S.root); },
  };
  window.Animoji = api;
})();
