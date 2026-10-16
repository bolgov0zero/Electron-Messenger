// Форматирование сообщений: поле ввода с оформлением прямо в поле, блоки кода, превью ссылок.
// Общий для Electron-клиента, веб-клиента и мобильной версии (копии лежат в client/src, server/src/public/shared
// и server/src/public/m/js — правятся вместе). Разметка сообщения: **жирный**, __курсив__, `код`, блок кода в ```.
// Поле ввода — contenteditable: сообщение хранится строкой разметки, поле показывает её уже оформленной.
(function (g) {
  const ZW = '​';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Разбор текста сообщения ──
  // Блок кода — строки между ``` и ```. Возвращает части в порядке следования: { k: 't' | 'c', v }
  function parts(text) {
    text = String(text || '');
    const out = []; let last = 0, m; const re = /```\n?([\s\S]*?)\n?```/g;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ k: 't', v: text.slice(last, m.index) });
      out.push({ k: 'c', v: m[1] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ k: 't', v: text.slice(last) });
    // Пустые куски текста вокруг блоков не нужны; у остальных обрезаем переводы строк по краям
    return out.filter(p => p.k === 'c' || p.v.trim()).map(p => p.k === 'c' ? p : { k: 't', v: p.v.replace(/^\n+|\n+$/g, '') });
  }
  const hasCode = text => /```[\s\S]*?```/.test(String(text || ''));
  // Для коротких подписей (список чатов, цитата): блок кода заменяется словом, секрет — точками
  const noCode = text => String(text || '').replace(/```[\s\S]*?```/g, '[код]').replace(/\|\|(?! )([^|\n]*[^|\n ])\|\|/g, '•••');

  // Для списка чатов: без блоков кода и без знаков разметки
  const plain = text => noCode(text).replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/`([^`\n]+)`/g, '$1');

  // Первая ссылка в тексте, кроме тех, что внутри блока кода
  function firstUrl(text) {
    const m = /https?:\/\/[^\s<>"]+/.exec(String(text || '').replace(/```[\s\S]*?```/g, ' '));
    return m ? m[0].replace(/[.,;:!?)\]»”']+$/, '') : null;
  }

  // Блок кода в сообщении: шапка с кнопкой «Копировать» и сам код. Копирует только кнопка, клик по коду ничего не делает
  const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  // foot — нижняя полоса блока: когда он замыкает пузырь, в ней стоят время и галочки (true — пустая, строка — её содержимое)
  function codeBlock(code, foot) {
    return `<div class="cblk" data-code="${esc(code)}"><div class="cbh"><span>Код</span><button type="button" class="cblk-cp" data-fmt-copy>${COPY_SVG}<i>Копировать</i></button></div><pre>${esc(code)}</pre>${foot ? '<div class="cbf">' + (foot === true ? '' : foot) + '</div>' : ''}</div>`;
  }
  // Нажатие на «Копировать»: el — сама кнопка. Возвращает true, если это была она
  function copyClick(e) {
    const btn = e.target.closest && e.target.closest('[data-fmt-copy]');
    if (!btn) return false;
    const blk = btn.closest('.cblk'), txt = blk ? blk.dataset.code || '' : '';
    const done = () => {
      blk.classList.add('done');
      const l = btn.querySelector('i'); if (l) l.textContent = 'Скопировано';
      setTimeout(() => { blk.classList.remove('done'); if (l) l.textContent = 'Копировать'; }, 1500);
    };
    const fallback = () => {
      const t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
    return true;
  }

  // Карточка превью ссылки в сообщении: картинка сверху, под ней заголовок и сайт. base — адрес сервера для картинки
  function previewCard(lp, base) {
    if (!lp || !lp.url) return '';
    let host = lp.site || '';
    if (!host) { try { host = new URL(lp.url).hostname.replace(/^www\./, ''); } catch {} }
    const img = lp.image ? `<div class="lc-im"><img src="${esc((base || '') + lp.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : '';
    return `<div class="lcard" data-fmt-url="${esc(lp.url)}" role="link" tabindex="0">${img}<div class="lc-b">${lp.title ? `<div class="lc-t">${esc(lp.title)}</div>` : ''}<div class="lc-d">${esc(host)}</div></div></div>`;
  }

  // ── Поле ввода ──
  const inline = s => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<i>$1</i>').replace(/\|\|(?! )([^|\n]*[^|\n ])\|\|/g, '<span class="spl-e">$1</span>').replace(/\n/g, '<br>');

  // Разметка сообщения → HTML поля ввода
  function toEditor(text) {
    const ps = [];
    let last = 0, m; const re = /```\n?([\s\S]*?)\n?```/g;
    text = String(text || '');
    while ((m = re.exec(text))) { if (m.index > last) ps.push(['t', text.slice(last, m.index)]); ps.push(['c', m[1]]); last = re.lastIndex; }
    if (last < text.length) ps.push(['t', text.slice(last)]);
    let html = ps.map(([k, v]) => k === 'c' ? `<pre class="cb">${esc(v)}</pre>` : `<div>${inline(v.replace(/^\n+|\n+$/g, ''))}</div>`).join('');
    if (ps.length && ps[ps.length - 1][0] === 'c') html += '<div><br></div>';   // после блока должна остаться строка, куда можно встать
    return html;
  }

  // Текст блока кода в поле: <br> — перенос строки, служебный <br class="ph"> (держит пустую строку) не в счёт
  function preText(pre) {
    let t = '';
    pre.childNodes.forEach(n => {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeName === 'BR') { if (!n.classList.contains('ph')) t += '\n'; }
      else t += n.textContent;
    });
    return t.replace(/​/g, '');
  }

  // HTML поля ввода → разметка сообщения
  function serialize(ce) {
    // Строки поля — то голый текст, то блоки div: блок всегда начинается с новой строки, иначе «а» + Enter + «б» слиплись бы в «аб»
    const join = nodes => {
      let acc = '';
      for (const c of nodes) {
        const block = c.nodeType === 1 && (c.nodeName === 'DIV' || c.nodeName === 'P');
        const piece = walk(c);
        if (block && acc && !acc.endsWith('\n')) acc += '\n';
        acc += piece;
      }
      return acc;
    };
    const walk = n => {
      if (n.nodeType === 3) return n.textContent.replace(/\u200b/g, '');
      if (n.nodeType !== 1) return '';
      const tag = n.nodeName;
      if (tag === 'BR') return '\n';
      if (tag === 'PRE') return '\n```\n' + preText(n).replace(/\n$/, '') + '\n```\n';
      const inner = join(n.childNodes);
      const st = n.style || {};
      const bold = tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || +st.fontWeight >= 600;
      const ital = tag === 'I' || tag === 'EM' || st.fontStyle === 'italic';
      let r = inner;
      if (tag === 'CODE') return inner.trim() ? '`' + inner + '`' : inner;
      if (tag === 'SPAN' && n.classList.contains('spl-e')) return inner.trim() ? '||' + inner + '||' : inner;
      if (bold && r.trim()) r = '**' + r + '**';
      if (ital && r.trim()) r = '__' + r + '__';
      if (tag === 'DIV' || tag === 'P') return r + '\n';
      return r;
    };
    return join(ce.childNodes).replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  const sel = () => (g.getSelection ? g.getSelection() : null);
  const inCe = (ce, node) => !!node && ce.contains(node);
  function up(ce, tag) {   // ближайший предок с таким тегом внутри поля
    const s = sel(); if (!s || !s.rangeCount || !inCe(ce, s.anchorNode)) return null;
    let n = s.anchorNode;
    while (n && n !== ce) { if (n.nodeName === tag) return n; n = n.parentNode; }
    return null;
  }
  function putCaret(node, offset, collapseToStart) {
    const s = sel(), r = document.createRange();
    r.setStart(node, offset); r.collapse(true);
    s.removeAllRanges(); s.addRange(r);
  }
  function focusEnd(ce) {
    ce.focus();
    const s = sel(), r = document.createRange();
    r.selectNodeContents(ce); r.collapse(false);
    s.removeAllRanges(); s.addRange(r);
  }

  function setValue(ce, text) {
    ce.innerHTML = text ? toEditor(text) : '';
  }

  // Подготовка поля: свойство value (как у textarea — остальной код клиента им пользуется), вставка только текстом,
  // пустое поле остаётся по-настоящему пустым (иначе не работает подсказка «Сообщение…»)
  function init(ce) {
    if (ce._fmt) return ce;
    ce._fmt = true;
    // Последнее выделение внутри поля: панель смайлов вставляет по нему, не возвращая фокус (иначе всплывает клавиатура)
    const track = () => {
      if (!ce.isConnected) { document.removeEventListener('selectionchange', track); return; }
      const s = sel(); if (s && s.rangeCount && ce.contains(s.anchorNode)) ce._rng = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', track);
    Object.defineProperty(ce, 'value', { get() { return serialize(ce); }, set(v) { setValue(ce, v); }, configurable: true });
    ce.addEventListener('paste', e => {
      e.preventDefault();
      const t = (e.clipboardData || g.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });
    ce.addEventListener('input', () => { if (!ce.textContent && !ce.querySelector('pre,img')) ce.innerHTML = ''; });
    return ce;
  }

  // Блок кода: строка, на которой стоит курсор (или выделение), становится блоком
  function insertBlock(ce) {
    ce.focus();
    const s = sel(); if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0), txt = r.toString();
    if (up(ce, 'PRE')) return;
    r.deleteContents();
    let line = r.startContainer;
    while (line && line.parentNode !== ce && line !== ce) line = line.parentNode;
    const pre = document.createElement('pre'); pre.className = 'cb';
    if (txt) pre.textContent = txt; else pre.innerHTML = '<br class="ph">';
    if (!line || line === ce) ce.appendChild(pre);
    else if (line.nodeName === 'PRE') line.after(pre);
    else if (!line.textContent.replace(/​/g, '').trim() && line.nodeName !== 'CODE') line.replaceWith(pre);
    else line.after(pre);
    if (!pre.nextSibling) { const d = document.createElement('div'); d.innerHTML = '<br>'; pre.after(d); }
    const nr = document.createRange();
    if (txt) { nr.selectNodeContents(pre); nr.collapse(false); } else { nr.setStart(pre, 0); nr.collapse(true); }
    s.removeAllRanges(); s.addRange(nr);
  }

  function toggleCode(ce) {
    ce.focus();
    const s = sel(); if (!s || !s.rangeCount) return;
    const ex = up(ce, 'CODE');
    if (ex) {
      const t = document.createTextNode(ex.textContent); ex.replaceWith(t);
      const r = document.createRange(); r.selectNodeContents(t); s.removeAllRanges(); s.addRange(r);
      return;
    }
    const txt = s.getRangeAt(0).toString();
    document.execCommand('insertHTML', false, '<code>' + (txt ? esc(txt) : ZW) + '</code>');
  }

  function upCls(ce, cls) {
    const s = sel(); if (!s || !s.rangeCount || !inCe(ce, s.anchorNode)) return null;
    let n = s.anchorNode;
    while (n && n !== ce) { if (n.nodeType === 1 && n.classList.contains(cls)) return n; n = n.parentNode; }
    return null;
  }
  // Секрет: выделенное прячется за облачком
  function toggleSecret(ce) {
    ce.focus();
    const s = sel(); if (!s || !s.rangeCount) return;
    const ex = upCls(ce, 'spl-e');
    if (ex) {
      if (s.getRangeAt(0).collapsed && ex.textContent.replace(/\u200b/g, '')) {
        // Курсор внутри секрета без выделения: выходим из него, дальше набирается обычный текст
        const z = document.createTextNode(ZW); ex.after(z);
        const r = document.createRange(); r.setStart(z, 1); r.collapse(true); s.removeAllRanges(); s.addRange(r);
        return;
      }
      const t = document.createTextNode(ex.textContent); ex.replaceWith(t);
      const r = document.createRange(); r.selectNodeContents(t); s.removeAllRanges(); s.addRange(r);
      return;
    }
    const txt = s.getRangeAt(0).toString();
    document.execCommand('insertHTML', false, '<span class="spl-e">' + (txt ? esc(txt) : ZW) + '</span>');
  }

  // Команда панели: 'b' | 'i' | 'c' | 'blk' | 's'
  function cmd(ce, k) {
    ce.focus();
    if (k === 'b') document.execCommand('bold');
    else if (k === 'i') document.execCommand('italic');
    else if (k === 'c') toggleCode(ce);
    else if (k === 'blk') insertBlock(ce);
    else if (k === 's') toggleSecret(ce);
  }
  // Что включено под курсором — для подсветки кнопок панели
  function state(ce) {
    const s = sel(), inside = !!s && s.rangeCount && inCe(ce, s.anchorNode);
    let b = false, i = false;
    if (inside) { try { b = document.queryCommandState('bold'); i = document.queryCommandState('italic'); } catch {} }
    return { b, i, c: !!up(ce, 'CODE'), blk: !!up(ce, 'PRE'), s: !!upCls(ce, 'spl-e') };
  }

  // Нажатие клавиши в поле. true — обработано здесь, дальше ничего делать не нужно:
  // Enter в блоке кода — перенос строки (на пустой последней строке — выход из блока), Ctrl/Cmd+B/I/E — оформление
  function keydown(e, ce) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); cmd(ce, 's'); ce.dispatchEvent(new Event('input', { bubbles: true })); return true; }
    if (mod && !e.altKey && ['b', 'i', 'e'].includes(e.key.toLowerCase())) {
      e.preventDefault(); cmd(ce, { b: 'b', i: 'i', e: 'c' }[e.key.toLowerCase()]); ce.dispatchEvent(new Event('input', { bubbles: true })); return true;
    }
    if (e.key !== 'Enter' || mod) return false;
    const pre = up(ce, 'PRE'); if (!pre) return false;
    e.preventDefault();
    const s = sel(), r = s.getRangeAt(0); r.deleteContents();
    const rest = document.createRange(); rest.selectNodeContents(pre); rest.setStart(r.endContainer, r.endOffset);
    const atEnd = rest.toString().replace(/​/g, '') === '';
    if (atEnd && preText(pre).endsWith('\n')) {
      const last = [...pre.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.endsWith('\n'));
      if (last) last.textContent = last.textContent.replace(/\n$/, '');
      pre.querySelectorAll('br.ph').forEach(b => b.remove());
      if (!pre.firstChild) pre.innerHTML = '<br class="ph">';
      let nx = pre.nextSibling;
      if (!nx || nx.nodeName === 'PRE') { const d = document.createElement('div'); d.innerHTML = '<br>'; pre.after(d); nx = d; }
      putCaret(nx, 0);
    } else {
      const tn = document.createTextNode('\n'); r.insertNode(tn);
      if (atEnd && !pre.querySelector('br.ph')) { const ph = document.createElement('br'); ph.className = 'ph'; pre.appendChild(ph); }
      const nr = document.createRange(); nr.setStartAfter(tn); nr.collapse(true); s.removeAllRanges(); s.addRange(nr);
    }
    ce.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ── Курсор и вставка (для смайлов и упоминаний) ──
  function insertText(ce, text) {
    ce.focus();
    const s = sel();
    if (!s || !s.rangeCount || !inCe(ce, s.anchorNode)) focusEnd(ce);
    document.execCommand('insertText', false, text);
  }
  // Текст перед курсором (без оформления): для разбора «@имя»
  function textBeforeCaret(ce) {
    const s = sel(); if (!s || !s.rangeCount || !inCe(ce, s.anchorNode)) return ce.textContent.replace(/​/g, '');
    const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
    const pre = document.createRange(); pre.selectNodeContents(ce); pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString().replace(/​/g, '');
  }
  // Заменить n символов перед курсором текстом
  function replaceBefore(ce, n, text) {
    ce.focus();
    const s = sel(); if (!s || !s.rangeCount) return;
    for (let i = 0; i < n; i++) s.modify('extend', 'backward', 'character');
    document.execCommand('insertText', false, text);
  }

  // Вставка и удаление символа без фокуса в поле (панель смайлов на телефоне)
  function savedRange(ce) {
    let r = ce._rng;
    if (!r || !ce.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(ce); r.collapse(false); }
    return r;
  }
  function putRange(ce, r) {
    ce._rng = r;
    if (document.activeElement === ce) { const s = sel(); s.removeAllRanges(); s.addRange(r); }
    ce.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function insertQuiet(ce, text) {
    const r = savedRange(ce);
    if (!r.collapsed) r.deleteContents();
    const tn = document.createTextNode(text); r.insertNode(tn);
    r.setStartAfter(tn); r.collapse(true); putRange(ce, r);
  }
  function backspaceQuiet(ce) {
    const r = savedRange(ce);
    if (!r.collapsed) { r.deleteContents(); putRange(ce, r); return; }
    // Предыдущий текстовый узел перед курсором
    let n = r.startContainer, o = r.startOffset;
    if (n.nodeType !== 3 || o === 0) {
      const w = document.createTreeWalker(ce, NodeFilter.SHOW_TEXT);
      let prev = null, cur;
      while ((cur = w.nextNode())) {
        const rr = document.createRange(); rr.selectNodeContents(cur); rr.collapse(false);
        if (r.compareBoundaryPoints(Range.START_TO_START, rr) < 0) break;
        if (cur.textContent) prev = cur;
      }
      if (n.nodeType === 3 && o === 0) { /* курсор в начале узла: берём предыдущий */ }
      if (!prev || prev === n) return;
      n = prev; o = prev.textContent.length;
    }
    const chars = Array.from(n.textContent.slice(0, o)); chars.pop();
    const head = chars.join('');
    n.textContent = head + n.textContent.slice(o);
    r.setStart(n, head.length); r.collapse(true); putRange(ce, r);
  }

  // Панель форматирования: разметка. Кнопки: data-f = b | i | c | blk | prev | close
  function barHtml() {
    return '<button type="button" data-f="b" title="Жирный (Ctrl+B)" aria-label="Жирный"><b>B</b></button>' +
      '<button type="button" data-f="i" title="Курсив (Ctrl+I)" aria-label="Курсив"><i style="font-family:Georgia,serif">I</i></button>' +
      '<button type="button" data-f="c" title="Код в строке (Ctrl+E)" aria-label="Код в строке"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg></button>' +
      '<button type="button" data-f="blk" title="Блок кода" aria-label="Блок кода"><span style="font:700 12px ui-monospace,monospace">{ }</span></button>' +
      '<button type="button" data-f="s" title="Секрет (Ctrl+Shift+S)" aria-label="Секрет"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12.5L20 4M17 7l3 3M14 10l2 2"/></svg></button>' +
      '<span class="fmt-sep"></span>' +
      '<button type="button" data-f="prev" title="Показать превью" aria-label="Превью"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>' +
      '<span class="fmt-grow"></span>' +
      '<button type="button" data-f="close" title="Закрыть панель форматирования" aria-label="Закрыть"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  }

  // ── Превью ссылки в поле ввода ──
  // Следит за текстом: пока в нём есть ссылка, спрашивает превью (через сервер) и сообщает onChange(превью | null).
  // Закрытая крестиком ссылка больше не предлагается, пока она в тексте та же
  function linkWatch(o) {
    let last = null, dismissed = '', cur = null, timer = null, seq = 0;
    const api = {
      check() {
        const text = o.getText(), url = firstUrl(text);
        if (url === last) return;
        last = url; seq++; clearTimeout(timer);
        if (cur) { cur = null; o.onChange(null); }
        if (!url || url === dismissed) return;
        // Адрес ещё набирается: «https://git», «https://github.c» не спрашиваем. Нужен домен с зоной, а если после адреса нет пробела —
        // ещё и пауза подольше (набор по буквам слал бы по запросу на каждую букву и упирался в лимит)
        if (!/^https?:\/\/[^\s\/?#]+\.[^\s\/?#.]{2,}/.test(url)) return;
        const at = text.indexOf(url) + url.length, closed = at >= text.length ? false : /\s/.test(text[at]);
        const my = seq;
        timer = setTimeout(async () => {
          let p = null; try { p = await o.fetchPreview(url); } catch {}
          if (my !== seq || !p) return;
          cur = p; o.onChange(p);
        }, closed ? 350 : 800);
      },
      dismiss() { dismissed = last || ''; seq++; clearTimeout(timer); if (cur) { cur = null; o.onChange(null); } },
      // Редактирование: у сообщения уже есть превью — показываем его, не спрашивая заново
      load(p, text) { seq++; clearTimeout(timer); dismissed = ''; last = firstUrl(text); cur = p || null; o.onChange(cur); },
      reset() { seq++; clearTimeout(timer); last = null; dismissed = ''; if (cur) { cur = null; o.onChange(null); } },
      current() { return cur; },
    };
    return api;
  }

  // ── Секрет в сообщении: текст закрыт облачком из частиц, нажатие открывает и закрывает ──
  // Разметка в сообщении: ||текст||. Клиенты превращают её в <span class="spl">; частицы рисует один общий цикл
  const spl = e => e.replace(/\|\|(?! )([^|\n]*[^|\n ])\|\|/g, '<span class="spl">$1</span>');
  const SP = new Set(), opened = new Set();
  let spRaf = 0, spLast = 0;
  function spKey(sp) {
    const m = sp.closest('[data-msg-id],[data-mid]'); if (!m) return null;
    const id = m.getAttribute('data-msg-id') || m.getAttribute('data-mid');
    return id + ':' + [...m.querySelectorAll('.spl')].indexOf(sp);
  }
  function spInit(sp) {
    sp.setAttribute('data-sp', '1');
    const host = sp.closest('.irc-text,.txt,.fpb') || sp.parentElement; if (!host) return;
    host.classList.add('spl-host');
    const cv = document.createElement('canvas'); cv.className = 'spl-cv'; host.appendChild(cv);
    const o = { sp, host, cv, g: cv.getContext('2d'), boxes: [], W: 0, H: 0, k: 1, col: '#fff', n: 0, key: spKey(sp) };
    const place = () => {
      const hr = host.getBoundingClientRect(), k = host.offsetWidth ? hr.width / host.offsetWidth : 1;   // учёт масштаба интерфейса (zoom)
      o.k = k || 1; o.W = host.offsetWidth; o.H = host.offsetHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = o.W * dpr; cv.height = o.H * dpr; cv.style.width = o.W + 'px'; cv.style.height = o.H + 'px'; o.dpr = dpr;
      o.boxes = [...sp.getClientRects()].filter(r => r.width > 2).map(r => {
        const b = { x: (r.left - hr.left) / o.k, y: (r.top - hr.top) / o.k, w: r.width / o.k, h: r.height / o.k };
        b.p = Array.from({ length: Math.round(b.w * b.h / 6.5) }, () => { const p = {}; spawn(b, p, true); return p; });
        return b;
      });
    };
    o.place = place;
    try { new ResizeObserver(place).observe(host); } catch {}
    place();
    if (o.key && opened.has(o.key)) { sp.classList.add('open'); cv.style.opacity = '0'; }
    sp.addEventListener('click', () => {
      const on = sp.classList.toggle('open'); cv.style.opacity = on ? '0' : '';
      if (o.key) { if (on) opened.add(o.key); else opened.delete(o.key); }
    });
    SP.add(o);
    if (!spRaf) spRaf = requestAnimationFrame(spLoop);
  }
  function spawn(b, p, fresh) {
    p.x = Math.random() * b.w; p.y = Math.random() * b.h; p.a = Math.random() * 6.28; p.s = .1 + Math.random() * .32;
    p.life = fresh ? Math.random() : 0; p.span = .5 + Math.random(); p.r = .45 + Math.random() * .9;
  }
  function spLoop(t) {
    const dt = Math.min(50, t - spLast || 16); spLast = t;
    for (const o of SP) {
      if (!o.sp.isConnected) { SP.delete(o); continue; }
      if (o.sp.classList.contains('open') || document.hidden) continue;
      if (!(++o.n % 90)) o.col = getComputedStyle(o.host).color;    // цвет текста мог смениться вместе с темой
      const g = o.g; g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); g.clearRect(0, 0, o.W, o.H); g.fillStyle = o.col;
      for (const b of o.boxes) {
        const cx = b.w / 2 || 1, cy = b.h / 2 || 1;
        for (const p of b.p) {
          p.life += dt / 1000 / p.span; if (p.life >= 1) { spawn(b, p, false); continue; }
          // частицы медленно разлетаются от центра строки и бледнеют: у облака нет чёткой границы
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
          p.a += (Math.random() - .5) * .6;
          p.x += Math.cos(p.a) * p.s + dx / d * .06 * dt / 16 * Math.min(1, Math.abs(dx) / cx + .2); p.y += Math.sin(p.a) * p.s + dy / d * .03 * dt / 16;
          g.globalAlpha = Math.sin(Math.PI * p.life) * .9; g.beginPath(); g.arc(b.x + p.x, b.y + p.y, p.r, 0, 6.28); g.fill();
        }
      }
    }
    spRaf = SP.size ? requestAnimationFrame(spLoop) : 0;
  }
  // Новые секреты в разметке подхватываются сами, откуда бы сообщение ни появилось
  let spScan = 0;
  function spScanNow() { spScan = 0; document.querySelectorAll('.spl:not([data-sp])').forEach(spInit); }
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const start = () => new MutationObserver(() => { if (!spScan) spScan = requestAnimationFrame(spScanNow); }).observe(document.body, { childList: true, subtree: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  g.Fmt = { spl, esc, parts, hasCode, noCode, plain, firstUrl, codeBlock, copyClick, previewCard, toEditor, serialize, setValue, init, cmd, state, keydown,
    insertText, insertQuiet, backspaceQuiet, textBeforeCaret, replaceBefore, focusEnd, barHtml, linkWatch, inline };
})(typeof window !== 'undefined' ? window : globalThis);
