// /m — папки чатов: полоса вкладок над списком, значок на аватарке, листы «В папку» и правки папки, раздел «Настройки → Папки».
B.ui = B.ui || {};
B.ui.folders = (function () {
  var esc = B.esc, ic = B.ic, F = B.folders;
  var ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  heart: '<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 4.5 5"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21a2 2 0 0 0 4 0"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6"/>',
  book: '<path d="M3 5a2 2 0 0 1 2-2h6v17H5a2 2 0 0 0-2 2zM21 5a2 2 0 0 0-2-2h-6v17h6a2 2 0 0 1 2 2z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10 3 7.5 4.5 9 8 12 8zm0 0s2-5 4.5-3.5S15 8 12 8z"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2M15 3v2"/>',
  rocket: '<path d="M12 3c4 1 7 5 7 9l-4 4H9l-2-2c0-4 2-9 5-11zM9 15l-4 1 1-4M15 17l-1 4"/><circle cx="13" cy="10" r="1.5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 3H6l3-3z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M10 17h4"/>',
};
  var KEYS = Object.keys(ICONS), COLORS = ['#3390ec', '#8e6cf0', '#30b46c', '#f0a030', '#ec5b8f', '#2fb8c4', '#e8604c', '#8a97a8'];
  function fic(name, size, sw) {
    return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.9) + '" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.folder) + '</svg>';
  }
  function plural(n) { return n % 10 === 1 && n % 100 !== 11 ? 'чат' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'чата' : 'чатов'; }

  // Значок папки на аватарке: левый верхний угол, по диагонали от точки «в сети»
  F.badge = function (c, size) {
    if (F.filter !== 'all') return '';
    var f = F.of(c); if (!f) return '';
    var d = Math.round(size * .42);
    return '<span class="fbd" style="--fc:' + f.color + ';width:' + d + 'px;height:' + d + 'px">' + fic(f.icon, Math.round(d * .62), 2.4) + '</span>';
  };

  // Полоса вкладок над списком чатов: «Все» и папки, прокручивается вбок и остаётся на месте при прокрутке списка
  function tabsHtml() {
    if (!F.list.length) return '';
    var all = F.list.reduce(function (s, f) { return s + F.unread(f); }, 0);
    var tab = function (id, name, n) {
      return '<button class="mtab' + (F.filter === id ? ' on' : '') + '" data-ft="' + id + '">' + esc(name) + (n ? '<b>' + (n > 99 ? '99+' : n) + '</b>' : '') + '</button>';
    };
    return '<div class="mtabs"><div class="mtabs-in">' + tab('all', 'Все', all) + F.list.map(function (f) { return tab(f.id, f.name, F.unread(f)); }).join('') + '</div></div>';
  }

  // ── правка папки (лист) ──
  function editor(folder, nameOnly, done) {
    if (!folder && F.list.length >= F.MAX) { B.toast.show('Не больше ' + F.MAX + ' папок'); return; }
    var st = folder ? { name: folder.name, color: folder.color, icon: folder.icon } : { name: '', color: COLORS[0], icon: 'folder' };
    function body() {
      return '<div class="fe-top"><span class="fe-big" style="--fc:' + st.color + '">' + fic(st.icon, 28) + '</span><div class="fe-in"><input id="fe-name" maxlength="30" placeholder="Название папки" autocomplete="off" value="' + esc(st.name) + '"></div></div>' +
        (nameOnly ? '' : '<div class="gh" style="margin-top:14px">Цвет</div><div class="fe-cols">' + COLORS.map(function (c) { return '<button style="--fc:' + c + '" class="' + (c === st.color ? 'on' : '') + '" data-fe-c="' + c + '" aria-label="Цвет"></button>'; }).join('') + '</div>' +
          '<div class="gh">Значок</div><div class="fe-icons">' + KEYS.map(function (n) { return '<button class="' + (n === st.icon ? 'on' : '') + '" data-fe-i="' + n + '" style="--fc:' + st.color + '">' + fic(n, 24) + '</button>'; }).join('') + '</div>');
    }
    var title = folder ? (nameOnly ? 'Переименовать' : 'Изменить папку') : 'Новая папка';
    B.sheet.open({ size: 'large', title: title, left: '<button class="nb" data-sheet="close">Отмена</button>', right: '<button class="nb fe-go" data-fe="save"' + (st.name.trim() ? '' : ' disabled') + '>' + (folder ? 'Готово' : 'Создать') + '</button>', body: '<div class="fe">' + body() + '</div>' });
    var sh = B.sheet.el.querySelector('.sh'), box = sh.querySelector('.fe'), go = sh.querySelector('.fe-go');
    function name() { return (box.querySelector('#fe-name') || {}).value || ''; }
    function repaint() { st.name = name(); box.innerHTML = body(); }
    sh.addEventListener('input', function (e) { if (e.target.id === 'fe-name') { st.name = e.target.value; go.disabled = !st.name.trim(); } });
    sh.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'fe-name') { e.preventDefault(); e.target.blur(); } });
    sh.addEventListener('click', function (e) {
      var c = e.target.closest('[data-fe-c]'), i = e.target.closest('[data-fe-i]');
      if (c) { st.color = c.dataset.feC; repaint(); }
      else if (i) { st.icon = i.dataset.feI; repaint(); }
      else if (e.target.closest('[data-fe="save"]')) {
        st.name = name().trim(); if (!st.name) return;
        B.sheet.close();
        if (folder) F.update(folder.id, { name: st.name, color: st.color, icon: st.icon });
        else F.create({ name: st.name, color: st.color, icon: st.icon }, done && done.chatId).then(function (id) { if (done && done.fn) done.fn(id); });
      }
    });
    if (!folder) setTimeout(function () { var i = box.querySelector('#fe-name'); if (i) i.focus(); }, 380);
  }

  // ── «В папку»: лист с галочками по папкам ──
  function chatSheet(chatId) {
    var c = B.find(chatId); if (!c) return;
    function body() {
      return '<div class="grp" style="margin-top:14px">' + F.list.map(function (f) {
        var on = f.chat_ids.indexOf(chatId) >= 0;
        return '<div class="cell tap fcell" data-fc="' + f.id + '"><span class="fcell-ic" style="--fc:' + f.color + '">' + fic(f.icon, 20) + '</span><span class="cl">' + esc(f.name) + '</span>' + (on ? '<span class="fck">' + ic('check', 20, 2.6) + '</span>' : '') + '</div>';
      }).join('') + '<div class="cell tap fcell" data-fc="new"><span class="fcell-ic plus">' + ic('plus', 20, 2.2) + '</span><span class="cl" style="color:var(--accent)">Новая папка…</span></div></div>';
    }
    B.sheet.open({ size: 'med', title: 'В папку', right: '<button class="nb" data-sheet="close">Готово</button>', body: body() });
    var sh = B.sheet.el.querySelector('.sh');
    sh.addEventListener('click', function (e) {
      var r = e.target.closest('[data-fc]'); if (!r) return;
      if (r.dataset.fc === 'new') { B.sheet.close(); setTimeout(function () { editor(null, false, { chatId: chatId }); }, 380); return; }
      F.toggleChat(chatId, +r.dataset.fc);
      B.sheet.body().innerHTML = body();
    });
  }

  // Долгое нажатие по чату в списке
  function chatMenu(chatId) {
    var c = B.find(chatId); if (!c) return;
    var items = [
      { l: c.pinned ? 'Открепить' : 'Закрепить', f: function () { B.chats.pin(chatId); } },
      { l: c.muted ? 'Включить звук' : 'Без звука', f: function () { B.chats.mute(chatId); } },
      { l: 'Добавить в папку', f: function () { chatSheet(chatId); } }
    ];
    B.actions.show({ title: B.chatName(c), items: items });
  }

  // ── Настройки → Папки ──
  function rowsHtml() {
    var n = F.list.length;
    return '<div style="height:14px"></div>' + (n ? '<div class="grp">' + F.list.map(function (f, i) {
      return '<div class="cell fprow" data-fid="' + f.id + '"><span class="fcell-ic" style="--fc:' + f.color + '">' + fic(f.icon, 20) + '</span><span class="cl"><b style="font-weight:600">' + esc(f.name) + '</b><small>' + f.chat_ids.length + ' ' + plural(f.chat_ids.length) + '</small></span>' +
        '<span class="fpa"><button data-fp="up" aria-label="Выше"' + (i === 0 ? ' disabled' : '') + '>' + ic('chevup', 20, 2.2) + '</button><button data-fp="down" aria-label="Ниже"' + (i === n - 1 ? ' disabled' : '') + '><span style="display:flex;transform:rotate(180deg)">' + ic('chevup', 20, 2.2) + '</span></button><button data-fp="edit" aria-label="Изменить">' + ic('pencil', 19, 2) + '</button><button data-fp="del" class="d" aria-label="Удалить">' + ic('trash', 19, 2) + '</button></span></div>';
    }).join('') + '</div>' : '<div class="empty"><b>Папок пока нет</b>Папки помогают разобрать чаты по темам.</div>') +
      '<div class="grp"><button class="cell tap" data-fp="new"' + (n >= F.MAX ? ' disabled' : '') + '><span class="fcell-ic plus">' + ic('plus', 20, 2.2) + '</span><span class="cl" style="color:var(--accent)">Новая папка</span></button></div>' +
      '<div class="gf">Чат добавляется в папку долгим нажатием на него в списке: «Добавить в папку».</div>';
  }
  function openPage() {
    var el = B.nav.page({ title: 'Папки', back: 'Настройки', gray: true, body: rowsHtml() }); el.dataset.fldpg = 1;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fp]'); if (!b || b.disabled) return;
      var a = b.dataset.fp, row = b.closest('.fprow'), id = row ? +row.dataset.fid : 0, f = F.byId(id);
      if (a === 'new') editor(null, false);
      else if (a === 'up') F.move(id, -1);
      else if (a === 'down') F.move(id, 1);
      else if (a === 'edit') editor(f, false);
      else if (a === 'del') B.actions.confirm('Удалить папку «' + (f ? f.name : '') + '»?', 'Чаты из неё не удаляются, они останутся в списке.', 'Удалить', function () { F.remove(id); B.toast.show('Папка удалена'); });
    });
    B.nav.push(el, 'Папки');
  }
  B.bus.on('folders:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.fldpg; });
    if (p) { var sc = p.querySelector('.scroll'), y = sc.scrollTop; sc.innerHTML = rowsHtml(); sc.scrollTop = y; }
  });
  return { tabsHtml: tabsHtml, chatMenu: chatMenu, chatSheet: chatSheet, editor: editor, openPage: openPage };
})();
