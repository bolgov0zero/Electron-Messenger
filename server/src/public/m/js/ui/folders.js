// /m — папки чатов по макету: чипы над списком, лист «В папку», лист правки папки, «Настройки → Папки».
// Данные и сеть — B.folders (core/folders.js).
B.ui = B.ui || {};
B.ui.folders = (function () {
  var F = B.folders;
  var COLORS = ['#4b8df0', '#19b394', '#d0566a', '#e8571f', '#7bc04a', '#b06af0', '#f0a030', '#8a97a8'];
  var KEYS = Object.keys(B.FI);
  function plural(n) { return n % 10 === 1 && n % 100 !== 11 ? 'чат' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'чата' : 'чатов'; }

  // Чипы над списком: «Все чаты» и папки (капсула с прокруткой вбок, липнет под бейджем раздела)
  function barHtml() {
    if (!F.list.length) return '';
    var chip = function (id, ic, name, n) {
      return '<button class="chip' + (F.filter === id ? ' on' : '') + '" data-fo="' + id + '">' + I(ic) + B.esc(name) + (n ? '<b class="cb">' + (n > 99 ? '99+' : n) + '</b>' : '') + '</button>';
    };
    var all = F.list.reduce(function (s, f) { return s + F.unread(f); }, 0);
    return '<div class="fbar"><div class="chips fo"><div class="fgrp glass"><i class="thumb"></i>' + chip('all', 'chat', 'Все чаты', all) + F.list.map(function (f) { return chip(f.id, f.icon || 'folder', f.name, F.unread(f)); }).join('') + '</div></div></div>';
  }

  // Бегунок под активным чипом (как у нижней панели): панель при смене папки строится заново, поэтому новый бегунок
  // стартует с места прежнего и плавно едет к активному чипу. prev — {l, w} прежнего бегунка
  function settle(bar, prev) {
    var g = bar && bar.querySelector('.fgrp'), th = g && g.querySelector('.thumb'), b = g && g.querySelector('.chip.on');
    if (!th || !b || !b.offsetWidth) { if (g) g.classList.add('nt'); return; }   // панель не отрисована (вкладка скрыта): пока подсвечиваем сам чип
    g.classList.remove('nt');
    if (prev && prev.w) { th.style.transition = 'none'; th.style.left = prev.l; th.style.width = prev.w; void th.offsetWidth; th.style.transition = ''; }
    th.style.left = b.offsetLeft + 'px'; th.style.width = b.offsetWidth + 'px';
    // Выбранная папка плавно встаёт посередине экрана; у первой и последней прокрутка упирается в край, и они остаются у своего края
    if (B.ui.folders.center) {
      B.ui.folders.center = false;
      var fo = bar.querySelector('.chips.fo');
      if (fo) { var fr = fo.getBoundingClientRect(), br = b.getBoundingClientRect(); fo.scrollTo({ left: fo.scrollLeft + (br.left + br.width / 2) - (fr.left + fr.width / 2), behavior: 'smooth' }); }
    }
  }
  function thumbOf(bar) { var th = bar && bar.querySelector('.fgrp .thumb'); return th && th.style.width ? { l: th.style.left, w: th.style.width } : null; }

  // «В папку»: лист с галочками (чат может лежать в нескольких папках)
  function chatSheet(chatId) {
    var c = B.find(chatId); if (!c) return;
    var body = function () {
      return '<div class="grp glass">' + F.list.map(function (f) {
        var on = f.chat_ids.indexOf(chatId) >= 0;
        return '<button class="cell" data-fc="' + f.id + '"><span class="ci" style="background:' + f.color + '">' + I(f.icon || 'folder') + '</span><span class="cl">' + B.esc(f.name) + '</span>' + (on ? '<span class="ch" style="color:var(--accent-ink)">' + I('check') + '</span>' : '') + '</button>';
      }).join('') + '<button class="cell" data-fc="new"><span class="ci" style="background:var(--accent)">' + I('plus') + '</span><span class="cl" style="color:var(--accent-ink)">Новая папка…</span></button></div><button class="abtn pri" data-close>Готово</button>';
    };
    var S = B.sheet.open({ title: 'В папку', sub: '«' + B.esc(B.chatName(c)) + '»', body: body() });
    S.el.addEventListener('click', function (e) {
      var r = e.target.closest('[data-fc]'); if (!r) return;
      if (r.dataset.fc === 'new') { B.sheet.close(); setTimeout(function () { editor(null, { chatId: chatId }); }, 460); return; }
      F.toggleChat(chatId, +r.dataset.fc); B.sheet.body().innerHTML = body();
    });
  }

  // Лист правки папки: название, цвет, значок; у существующей — порядок и удаление
  function editor(folder, done) {
    if (!folder && F.list.length >= F.MAX) { B.toast.show('Не больше ' + F.MAX + ' папок', 'folder'); return; }
    var st = folder ? { name: folder.name, color: folder.color, icon: folder.icon || 'folder' } : { name: '', color: COLORS[0], icon: 'folder' };
    var body = function () {
      return '<div class="fedit"><span class="fic" style="--fc:' + st.color + '">' + I(st.icon) + '</span><label class="fld glass-inset" style="flex:1"><input id="fn" placeholder="Название папки" value="' + B.esc(st.name) + '" maxlength="30" autocomplete="off" enterkeyhint="done"></label></div>' +
        '<div class="fcols">' + COLORS.map(function (c) { return '<button style="--fc:' + c + '" class="' + (c === st.color ? 'on' : '') + '" data-c="' + c + '" aria-label="Цвет"></button>'; }).join('') + '</div>' +
        '<div class="ficons">' + KEYS.map(function (n) { return '<button class="' + (n === st.icon ? 'on' : '') + '" data-ic="' + n + '" style="--fc:' + st.color + '" aria-label="' + n + '">' + I(n) + '</button>'; }).join('') + '</div>' +
        '<button class="abtn pri" data-ok' + (st.name.trim() ? '' : ' disabled') + '>' + (folder ? 'Сохранить' : 'Создать') + '</button>' +
        (folder ? '<div class="ab2"><button class="abtn" data-mv="-1"' + (F.list[0] === folder ? ' disabled' : '') + '>' + I('up') + 'Выше</button><button class="abtn" data-mv="1"' + (F.list[F.list.length - 1] === folder ? ' disabled' : '') + '><span style="display:flex;transform:rotate(180deg)">' + I('up') + '</span>Ниже</button></div><button class="abtn d" data-del>Удалить папку</button>' : '');
    };
    var S = B.sheet.open({ title: folder ? 'Изменить папку' : 'Новая папка', body: body() }), box = S.el;
    var repaint = function () { st.name = ($('#fn', box) || {}).value || st.name; B.sheet.body().innerHTML = body(); };
    box.addEventListener('input', function (e) { if (e.target.id === 'fn') { st.name = e.target.value; $('[data-ok]', box).disabled = !st.name.trim(); } });
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'fn') { e.preventDefault(); e.target.blur(); } });
    box.addEventListener('click', function (e) {
      var c = e.target.closest('[data-c]'), i = e.target.closest('[data-ic]'), mv = e.target.closest('[data-mv]');
      if (c) { st.color = c.dataset.c; repaint(); }
      else if (i) { st.icon = i.dataset.ic; repaint(); }
      else if (mv && folder) { F.move(folder.id, +mv.dataset.mv); setTimeout(repaint, 60); }
      else if (e.target.closest('[data-ok]')) {
        var name = (($('#fn', box) || {}).value || '').trim(); if (!name) return;
        B.sheet.close();
        if (folder) F.update(folder.id, { name: name, color: st.color, icon: st.icon });
        else F.create({ name: name, color: st.color, icon: st.icon }, done && done.chatId).then(function (id) { if (done && done.fn) done.fn(id); });
      } else if (e.target.closest('[data-del]')) {
        B.sheet.close();
        setTimeout(function () { B.actions.confirm('Удалить папку «' + folder.name + '»?', 'Чаты из неё не удаляются, они останутся в списке.', 'Удалить', function () { F.remove(folder.id); B.toast.show('Папка удалена', 'trash'); }); }, 460);
      }
    });
    if (!folder) setTimeout(function () { var i = $('#fn', box); if (i) i.focus(); }, 520);
  }

  // «Настройки → Папки»
  function rowsHtml() {
    return '<div class="grp glass">' + (F.list.length ? F.list.map(function (f) {
      return '<button class="cell" data-f="' + f.id + '"><span class="fic" style="--fc:' + f.color + ';width:36px;height:36px;border-radius:12px;font-size:19px">' + I(f.icon || 'folder') + '</span><span class="cl">' + B.esc(f.name) + '</span><span class="cv">' + f.chat_ids.length + '</span><span class="ch">' + I('chevRight') + '</span></button>';
    }).join('') : '<div class="empty" style="padding:24px 20px"><b>Папок пока нет</b><span>Папки помогают разобрать чаты по темам.</span></div>') + '</div>' +
      '<button class="abtn pri" data-new' + (F.list.length >= F.MAX ? ' disabled' : '') + '>' + I('plus') + 'Новая папка</button><div class="gf" style="margin-top:12px">Папки показываются чипами над списком чатов. Чат попадает в папку долгим нажатием на него в списке: «В папку».</div>';
  }
  function openPage() {
    var el = B.ui.setPage('Папки', rowsHtml()); el.dataset.fldpg = 1;
    el.addEventListener('click', function (e) {
      var f = e.target.closest('[data-f]'), n = e.target.closest('[data-new]');
      if (f) editor(F.byId(+f.dataset.f)); else if (n && !n.disabled) editor(null);
    });
  }
  B.bus.on('folders:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.fldpg; });
    if (p) { var sc_ = $('.scroll', p), y = sc_.scrollTop; sc_.innerHTML = rowsHtml(); sc_.scrollTop = y; }
  });
  return { barHtml: barHtml, settle: settle, thumbOf: thumbOf, chatSheet: chatSheet, editor: editor, openPage: openPage };
})();
