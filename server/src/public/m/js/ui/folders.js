// /m — папки чатов: полоса вкладок над списком, значок на аватарке, листы «В папку» и правки папки, раздел «Настройки → Папки».
B.ui = B.ui || {};
B.ui.folders = (function () {
  var esc = B.esc, ic = B.ic, F = B.folders;
  // Значки — набор Lucide (лицензия ISC), контурные, 24×24
  var ICONS = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  cog: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
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
