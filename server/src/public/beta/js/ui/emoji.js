// /beta — общее для панели смайлов в поле ввода и шторки «Реакция»: разделы (часто используемые + группы),
// сетка, вкладки групп и подсветка активной вкладки при прокрутке (как syncEmojiTabs в /m).
B.emoji = {
  DEFAULT_FREQ: ['👍', '❤️', '😂', '🔥', '🙏', '😊', '🎉', '👏', '😮', '😢', '🤔', '👌', '😍', '😎', '✅', '💯', '🙌', '😁', '🤝', '😅', '👀'],
  groups: function () { return typeof EMOJI_GROUPS !== 'undefined' ? EMOJI_GROUPS : []; },
  keywords: function () { return typeof EMOJI_KEYWORDS !== 'undefined' ? EMOJI_KEYWORDS : {}; },
  freq: function () { try { return JSON.parse(localStorage.getItem('emoji_freq') || '{}'); } catch (e) { return {}; } },
  track: function (em) { var f = B.emoji.freq(); f[em] = (f[em] || 0) + 1; try { localStorage.setItem('emoji_freq', JSON.stringify(f)); } catch (e) {} },
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
  // Связывает вкладки с прокруткой: нажатие на вкладку прокручивает к группе, прокрутка подсвечивает вкладку текущей группы.
  // offset — высота закреплённой шапки внутри области прокрутки (она закрывает верх списка).
  bindTabs: function (scroll, tabs, offset) {
    if (!scroll || !tabs) return;
    var sync = function () {
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
    tabs.addEventListener('click', function (e) {
      var t = e.target.closest('.ep-tab'); if (!t) return;
      var row = scroll.querySelector('[data-row="' + t.dataset.key + '"]'), head = scroll.querySelector('[data-head="' + t.dataset.key + '"]'); if (!row) return;
      scroll.scrollTo({ top: scroll.scrollTop + row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (offset || 0) - (head ? head.offsetHeight : 0), behavior: 'smooth' });
    });
    sync();
  }
};
