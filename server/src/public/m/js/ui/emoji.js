// /m — общее для панели смайлов в поле ввода и шторки «Реакция»: разделы (часто используемые + группы),
// сетка, вкладки групп и подсветка активной вкладки при прокрутке (как syncEmojiTabs в /m).
B.emoji = {
  DEFAULT_FREQ: ['👍', '❤️', '😂', '🔥', '🙏', '😊', '🎉', '👏', '😮', '😢', '🤔', '👌', '😍', '😎', '✅', '💯', '🙌', '😁', '🤝', '😅', '👀'],
  groups: function () { return typeof EMOJI_GROUPS !== 'undefined' ? EMOJI_GROUPS : []; },
  keywords: function () { return typeof EMOJI_KEYWORDS !== 'undefined' ? EMOJI_KEYWORDS : {}; },
  freq: function () { try { return JSON.parse(localStorage.getItem('emoji_freq') || '{}'); } catch (e) { return {}; } },
  track: function (em) {
    var f = B.emoji.freq(); f[em] = (f[em] || 0) + 1; try { localStorage.setItem('emoji_freq', JSON.stringify(f)); } catch (e) {}
    B.api('POST', '/users/me/emoji', { use: em }).catch(function () {});
  },
  // Частые смайлы общие на всех устройствах: список берём с сервера (localStorage — кэш для мгновенного показа),
  // а накопленное на этом устройстве до перехода на сервер отправляем один раз
  sync: async function () {
    try {
      var local = B.emoji.freq(), first = !localStorage.getItem('emoji_freq_synced');
      var r = first && Object.keys(local).length ? await B.api('POST', '/users/me/emoji', { merge: local }) : await B.api('GET', '/users/me/emoji');
      if (!r || !r.freq) return;
      localStorage.setItem('emoji_freq_synced', '1');
      localStorage.setItem('emoji_freq', JSON.stringify(r.freq));
    } catch (e) {}
  },
  freqList: function (n) {
    var f = B.emoji.freq(), sorted = Object.keys(f).sort(function (a, b) { return f[b] - f[a]; });
    B.emoji.DEFAULT_FREQ.forEach(function (e) { if (sorted.length < n && sorted.indexOf(e) < 0) sorted.push(e); });
    return sorted.slice(0, n);
  },
  sections: function () { return [{ key: 'freq', icon: '🕘', name: 'Часто используемые', items: B.emoji.freqList(21) }].concat(B.emoji.groups()); },
  // Сетка разделов; attr — атрибуты кнопки смайла (например data-k="em")
  gridHtml: function (secs, attr) {
    return secs.map(function (g) {
      return '<div class="ep-head" data-head="' + g.key + '">' + B.esc(g.name) + '</div><div class="ep-row" data-row="' + g.key + '">' +
        g.items.map(function (e) { return '<button ' + attr + ' data-e="' + B.esc(e) + '">' + e + '</button>'; }).join('') + '</div>';
    }).join('');
  },
  tabsHtml: function (secs) {
    return secs.map(function (g, i) { return '<button class="ep-tab" data-key="' + g.key + '" title="' + B.esc(g.name) + '" aria-selected="' + (i === 0) + '">' + g.icon + '</button>'; }).join('');
  },
  // Поиск по названию и словам (CLDR): точное слово выше, начало слова ниже, затем название группы и вхождения
  search: function (q) {
    q = (q || '').trim().toLowerCase(); var kw = B.emoji.keywords(), seen = {}, hits = [];
    B.emoji.groups().forEach(function (g) {
      var gh = g.name.toLowerCase().indexOf(q) >= 0;
      g.items.forEach(function (em) {
        if (seen[em]) return;
        var words = (kw[em] || '').split(' '), score = 0;
        if (words.indexOf(q) >= 0) score = 3; else if (words.some(function (w) { return w.indexOf(q) === 0; })) score = 2; else if (gh) score = 1.5; else if (words.some(function (w) { return w.indexOf(q) >= 0; })) score = 1;
        if (score) { seen[em] = 1; hits.push({ em: em, score: score }); }
      });
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.map(function (h) { return h.em; });
  },
  resultsHtml: function (q, attr) {
    var r = B.emoji.search(q);
    return r.length ? '<div class="ep-head">Найдено: ' + r.length + '</div><div class="ep-row">' + r.map(function (e) { return '<button ' + attr + ' data-e="' + B.esc(e) + '">' + e + '</button>'; }).join('') + '</div>' : '<div class="stub-note">Ничего не нашлось</div>';
  },
  // Связывает вкладки с прокруткой: нажатие на вкладку прокручивает к группе, прокрутка подсвечивает вкладку текущей группы.
  // offset — высота закреплённой шапки внутри области прокрутки (она закрывает верх списка).
  bindTabs: function (scroll, tabs, offset) {
    if (!scroll || !tabs) return;
    var lock = null;   // выбранная нажатием вкладка: держим, пока человек сам не прокрутит
    var sync = function () {
      if (lock) return;
      var top = scroll.getBoundingClientRect().top + (offset || 0), cur = null, first = null, last = null;
      scroll.querySelectorAll('[data-row]').forEach(function (row) {
        if (row.hidden) return; if (!first) first = row.dataset.row; last = row.dataset.row;
        if (row.getBoundingClientRect().top - top <= 34) cur = row.dataset.row;
      });
      if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4) cur = last;
      cur = cur || first;
      tabs.querySelectorAll('.ep-tab').forEach(function (t) {
        var on = t.dataset.key === cur;
        if (t.getAttribute('aria-selected') !== String(on)) {
          t.setAttribute('aria-selected', String(on));
          if (on) tabs.scrollTo({ left: t.offsetLeft - (tabs.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' });   // активная вкладка не уходит за край ленты вкладок
        }
      });
    };
    scroll.addEventListener('scroll', sync, { passive: true });
    ['touchstart', 'wheel', 'pointerdown'].forEach(function (ev) { scroll.addEventListener(ev, function () { lock = null; }, { passive: true }); });
    tabs.addEventListener('click', function (e) {
      var t = e.target.closest('.ep-tab'); if (!t) return;
      // Вкладку выбираем сразу: иначе при плавной прокрутке подсветка бежит по группам по пути, а у групп,
      // которые не могут подняться к верху списка (последние), останавливается на соседней
      lock = t.dataset.key;
      tabs.querySelectorAll('.ep-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      tabs.scrollTo({ left: t.offsetLeft - (tabs.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' });
      var row = scroll.querySelector('[data-row="' + t.dataset.key + '"]'), head = scroll.querySelector('[data-head="' + t.dataset.key + '"]'); if (!row) return;
      scroll.scrollTo({ top: scroll.scrollTop + row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (offset || 0) - (head ? head.offsetHeight : 0), behavior: 'smooth' });
    });
    sync();
  }
};
