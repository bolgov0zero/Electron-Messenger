// /beta — вкладка «Настройки» по макету и её подстраницы: профиль, «Внешний вид», «Уведомления», «Модули», «Папки», «Блокировки», «Диагностика».
B.ui = B.ui || {};
B.ui.settings = (function () {
  var S = B.S, v, body;

  function cell(act, ic, bg, l, val, red) {
    return '<button class="cell" data-s="' + act + '"><span class="ci" style="background:' + bg + '">' + I(ic) + '</span><span class="cl' + (red ? ' red' : '') + '">' + l + '</span>' + (val ? '<span class="cv">' + B.esc(val) + '</span>' : '') + (red ? '' : '<span class="ch">' + I('chevRight') + '</span>') + '</button>';
  }
  function tg(k, on) { return '<button class="tg" data-tg="' + k + '" role="switch" aria-checked="' + !!on + '"></button>'; }
  function notifText() { var p = B.push.permission(); return !B.push.supported() ? 'Не поддерживаются' : p === 'granted' ? 'Включены' : p === 'denied' ? 'Запрещены' : 'Выключены'; }

  // Страница настроек: тот же каркас, что у остальных (шапка «назад» + название)
  function setPage(title, html, o) { var el = B.nav.page(Object.assign({ title: title, body: html }, o || {})); B.nav.push(el, title); return el; }
  B.ui.setPage = setPage;

  function render() {
    if (!body) return;
    var u = S.user || {}, mods = window.Modules ? Modules.list().filter(function (m) { return m.on; }).length : 0;
    var upd = B.app.newVersion ? '<div class="updc glass">' + I('upd') + '<div class="t"><b>Вышла новая версия</b><span>Применится после перезагрузки</span></div><button class="btn pri sm" data-s="reload">Обновить</button></div>' : '';
    body.innerHTML = upd + '<div class="grp glass"><button class="prow" data-s="me">' + (u.id ? B.avatar.user(u.id, u.display_name || '', 0, true) : '') + '<div style="flex:1;min-width:0"><b>' + B.esc(u.display_name || '') + '</b><span>@' + B.esc(u.username || '') + '</span></div><span class="ch" style="color:var(--muted)">' + I('chevRight') + '</span></button></div>' +
      '<div class="grp glass">' + cell('appearance', 'palette', '#af52de', 'Внешний вид', { light: 'Светлая', dark: 'Тёмная', navy: 'Тёмно-синяя' }[B.theme.get()]) + cell('notif', 'bell', '#ff3b30', 'Уведомления', notifText()) + cell('modules', 'puzzle', '#34c759', 'Модули', mods || '') + cell('folders', 'folder', '#ff9500', 'Папки', B.folders.list.length || '') + '</div>' +
      '<div class="grp glass"><div class="cell"><span class="cl">Отображать пространства</span>' + tg('spaces', B.spaces.on()) + '</div></div><div class="gf">Включите, чтобы выбирать пространство над списком чатов: останутся люди и чаты из него.</div>' +
      '<div class="grp glass">' + cell('blocks', 'ban', '#8e8e93', 'Блокировки', S.blocked.length || '') + cell('diag', 'gear', '#5e6ad2', 'Диагностика') + '</div>' +
      '<div class="grp glass">' + cell('logout', 'logout', '#ff3b30', 'Выйти', '', 1) + '</div><div class="gf" style="text-align:center;margin-top:-8px">Версия ' + B.esc((window.APP_VERSION || '').replace('?v=', '') || '—') + '</div><div class="mcopy">w/ <span style="color:var(--danger)">♥</span> by bolgov0zero</div>';
    if (u.id) B.avatar.apply(body);
  }
  function mount(el) {
    v = el;
    v.innerHTML = '<div class="nav lg"><div class="nb" style="visibility:hidden"></div><div class="nt"><span class="glass">Настройки</span></div><div class="nr"></div></div><div class="scroll"><h1 class="lt">Настройки</h1><div id="sbody"></div></div>';
    body = $('#sbody', v); B.nav.watch(v); render();
    v.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tg]');
      if (t && t.dataset.tg === 'spaces') { B.spaces.setOn(!B.spaces.on()); render(); return; }
      var b = e.target.closest('[data-s]'); if (!b) return; var a = b.dataset.s;
      if (a === 'me') openMe(); else if (a === 'appearance') openAppearance(); else if (a === 'notif') openNotif(); else if (a === 'modules') openModules();
      else if (a === 'folders') B.ui.folders.openPage(); else if (a === 'blocks') openBlocks(); else if (a === 'diag') B.ui.diag.open();
      else if (a === 'reload') location.reload();
      else if (a === 'logout') B.actions.confirm('Выйти из аккаунта?', '', 'Выйти', function () { B.auth.logout(); });
    });
  }

  // ── уведомления ──
  function mm(x) { return x == null ? '' : ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + x % 60).slice(-2); }
  function toMin(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function openNotif() {
    var p = B.push.permission(), ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), needInstall = !B.push.supported() || (ios && !B.pwa.standalone);
    var prefs = { show_text: true, quiet_from: null, quiet_to: null };
    var el = setPage('Уведомления', '');
    var paint = function () {
      var quiet = prefs.quiet_from != null && prefs.quiet_to != null, h = '';
      if (needInstall) h += '<div class="how glass"><b>Чтобы приходили уведомления, добавьте приложение на экран «Домой»</b><ol><li>Нажмите <u>' + I('up') + ' Поделиться</u> в Safari</li><li>Выберите «На экран “Домой”»</li><li>Откройте «Electron β» с экрана «Домой» и разрешите уведомления</li></ol></div>';
      h += '<div class="grp glass"><div class="cell"><span class="cl">Уведомления</span><span class="cv">' + B.esc(notifText()) + '</span></div>' + (p === 'default' && B.push.supported() ? '<button class="cell" data-n="allow"><span class="cl" style="color:var(--accent-ink)">Разрешить уведомления</span></button>' : '') + '</div>';
      if (p === 'denied') h += '<div class="gf">Уведомления запрещены. Включить их можно в настройках телефона: Electron β → Уведомления.</div>';
      h += '<div class="grp glass"><div class="cell"><span class="cl">Показывать текст сообщения</span>' + tg('text', prefs.show_text) + '</div></div><div class="gf">Выключите показ текста, если телефон лежит на виду: в уведомлении будет только «Новое сообщение».</div>' +
        '<div class="grp glass"><div class="cell"><span class="cl">Тихие часы</span>' + tg('quiet', quiet) + '</div>' + (quiet ? '<div class="cell"><span class="cl">С</span><input class="tm" type="time" data-n="qf" value="' + mm(prefs.quiet_from) + '"></div><div class="cell"><span class="cl">До</span><input class="tm" type="time" data-n="qt" value="' + mm(prefs.quiet_to) + '"></div>' : '') + '</div><div class="gf">В тихие часы уведомлений и звука нет, сообщения никуда не пропадают.</div>';
      $('.scroll', el).innerHTML = h;
    };
    var save = async function (part) {
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      var r = await B.api('PUT', '/push/prefs', Object.assign({ tz: tz }, part));
      if (r && !r.error) prefs = r; else B.toast.show('Не удалось сохранить', 'x');
      paint();
    };
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tg]'), b = e.target.closest('[data-n]');
      if (t) { if (t.dataset.tg === 'text') save({ show_text: !prefs.show_text }); else if (t.dataset.tg === 'quiet') save(prefs.quiet_from != null ? { quiet_from: null, quiet_to: null } : { quiet_from: 22 * 60, quiet_to: 8 * 60 }); return; }
      if (b && b.dataset.n === 'allow') B.push.request().then(function () { p = B.push.permission(); render(); paint(); });
    });
    el.addEventListener('change', function (e) { var b = e.target.closest('input[data-n]'); if (!b) return; var x = toMin(b.value); if (x == null) return; save(b.dataset.n === 'qf' ? { quiet_from: x } : { quiet_to: x }); });
    paint();
    B.api('GET', '/push/prefs').then(function (r) { if (r && !r.error) { prefs = r; paint(); } });
  }

  // ── профиль ──
  function links() { var u = S.user, l = [['Внутренняя', '@' + u.username]]; if (u.server_id) l.push(['Внешняя', '@' + u.server_id + ':' + u.username]); return l; }
  function openMe() {
    var u = S.user;
    var el = setPage('Профиль', '<div class="hero"><button data-m="photo" aria-label="Изменить фото" style="border-radius:50%">' + B.avatar.user(u.id, u.display_name, 0, true) + '</button><button class="btn sm" data-m="photo" style="margin-top:6px">Изменить фото</button><input type="file" accept="image/*" hidden id="mefile"></div>' +
      '<div class="gl">Ссылка на профиль</div>' + links().map(function (l, i) { return '<button class="pl" data-m="copy" data-i="' + i + '"><span class="k">' + l[0] + '</span><span class="v">' + B.esc(l[1]) + '</span><span class="ic">' + I('copy') + '</span></button>'; }).join('') +
      '<div class="gl" style="margin-top:12px">Имя</div><label class="fld m glass-inset"><input id="nm" value="' + B.esc(u.display_name) + '" maxlength="40" aria-label="Имя"><span class="cnt">' + u.display_name.length + '/40</span></label><button class="abtn pri" data-m="save" disabled style="margin-bottom:16px">Сохранить</button>');
    var inp = $('#nm', el), sv = $('[data-m="save"]', el);
    inp.addEventListener('focus', function () { showKb(); });
    inp.oninput = function () { sv.disabled = !inp.value.trim() || inp.value.trim() === S.user.display_name; $('.cnt', el).textContent = inp.value.length + '/40'; };
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return; var a = b.dataset.m;
      if (a === 'photo') $('#mefile', el).click();
      else if (a === 'copy') { var l = links()[+b.dataset.i]; try { await navigator.clipboard.writeText(l[1]); B.toast.show('Скопировано: ' + l[1], 'copy'); } catch (err) { B.toast.show('Не удалось скопировать', 'x'); } }
      else if (a === 'save' && !sv.disabled) {
        var name = inp.value.trim(); if (!name) return; sv.disabled = true;
        var res = await B.api('PATCH', '/users/me', { display_name: name });
        if (res && res.ok) { S.user.display_name = name; B.session.save(); render(); B.toast.show('Имя сохранено', 'check'); } else { B.toast.show('Не удалось сохранить', 'x'); sv.disabled = false; }
      }
    });
    $('#mefile', el).addEventListener('change', async function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      var res = await B.api('POST', '/users/me/avatar', { data: await B.ui.groups.resizeAvatar(f) });
      if (res && res.ok) { await B.avatar.loadIndex(); S.avatarTs = Date.now(); B.avatar.clearCache(); B.bus.emit('avatar:updated'); B.avatar.apply(el); render(); B.toast.show('Фото обновлено', 'check'); } else B.toast.show('Не удалось загрузить фото', 'x');
    });
    B.avatar.apply(el);
  }

  // ── внешний вид ──
  function appearanceHtml() {
    var A = B.appearance, th = B.theme, pat = A.pattern(), fs = th.fsKey(), t = th.get();
    return '<div class="pvw"><div class="m a">Созвон переносим на 15:30</div><div class="m b">Отлично, успеваю</div></div>' +
      '<div class="gl">Тема и цвет</div><div class="grp glass"><div class="cell" style="flex-direction:column;align-items:stretch"><div class="seg f" id="tseg" style="margin:0"><i class="thumb"></i>' +
        [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Синяя']].map(function (x) { return '<button class="' + (t === x[0] ? 'on' : '') + '" data-t="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="cell"><span class="cl">Цвет акцента</span><div class="dots">' + Object.keys(th.ACC).map(function (k) { var a = th.ACC[k]; return '<button class="dot2' + (th.accentKey() === k ? ' on' : '') + '" data-a="' + k + '" aria-label="' + a[0] + '" style="--dot:rgb(' + (root.classList.contains('dark') ? a[2] : a[1]) + ')"></button>'; }).join('') + '</div></div>' +
      '<div class="cell"><span class="cl">Прозрачность</span><input class="rng" type="range" min="0" max="100" value="' + th.glass() + '" style="--v:' + th.glass() + '%" aria-label="Прозрачность стекла"></div></div>' +
      '<div class="gl">Фон</div><div class="grp glass"><div class="cell"><span class="cl">Цветная картинка</span>' + tg('amb', th.amb()) + '</div>' +
      '<div class="pcards">' + A.PATTERNS.map(function (p) { return '<button class="pcard' + (p.id === pat ? ' on' : '') + '" data-p="' + p.id + '"><i' + (p.id ? ' data-pat="' + p.id + '"' : '') + '></i><span>' + p.name + '</span></button>'; }).join('') + '</div>' +
      (pat ? '<div class="cell" style="flex-direction:column;align-items:stretch"><div class="seg f" id="lseg" style="margin:0"><i class="thumb"></i>' + [[1, 'Слабо'], [2, 'Средне'], [3, 'Сильно']].map(function (x) { return '<button class="' + (A.patternLevel() === x[0] ? 'on' : '') + '" data-l="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' : '') + '</div>' +
      '<div class="gf">Узор рисуется поверх фона переписки и с цветной картинкой не связан.</div>' +
      '<div class="gl">Текст</div><div class="grp glass"><div class="cell" style="flex-direction:column;align-items:stretch"><div class="seg f" id="fsg" style="margin:0"><i class="thumb"></i>' + Object.keys(th.FS).map(function (k) { return '<button class="' + (fs === k ? 'on' : '') + '" data-fs="' + k + '">' + th.FS[k][1] + '</button>'; }).join('') + '</div></div></div>';
  }
  function paintPats(r) { $$('[data-pat]', r).forEach(function (i) { var u = 'url("/chat/assets/patterns/' + i.dataset.pat + '.png")'; i.style.webkitMaskImage = u; i.style.maskImage = u; i.style.background = 'var(--text)'; i.style.opacity = '.45'; i.style.webkitMaskSize = '130%'; i.style.maskSize = '130%'; }); }
  function openAppearance() {
    var el = setPage('Внешний вид', appearanceHtml()), A = B.appearance, th = B.theme;
    var redraw = function () { var s = $('.scroll', el), y = s.scrollTop; s.innerHTML = appearanceHtml(); s.scrollTop = y; paintPats(s); $$('.seg', s).forEach(segMove); };
    setTimeout(function () { $$('.seg', el).forEach(segMove); paintPats(el); }, 480);
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-t]'), a = e.target.closest('[data-a]'), p = e.target.closest('[data-p]'), l = e.target.closest('[data-l]'), f = e.target.closest('[data-fs]'), g = e.target.closest('[data-tg]');
      if (t) { $$('#tseg button', el).forEach(function (b) { b.classList.toggle('on', b === t); }); segMove($('#tseg', el)); th.set(t.dataset.t); render(); return; }
      if (a) { th.setAccent(a.dataset.a); $$('.dot2', el).forEach(function (d) { d.classList.toggle('on', d === a); }); return; }
      if (g && g.dataset.tg === 'amb') { var on = g.getAttribute('aria-checked') !== 'true'; g.setAttribute('aria-checked', on); th.setAmb(on); return; }
      if (p) { A.setPattern(p.dataset.p); redraw(); return; }
      if (l) { A.setPatternLevel(+l.dataset.l); $$('#lseg button', el).forEach(function (b) { b.classList.toggle('on', b === l); }); segMove($('#lseg', el)); return; }
      if (f) { th.setFs(f.dataset.fs); $$('#fsg button', el).forEach(function (b) { b.classList.toggle('on', b === f); }); segMove($('#fsg', el)); }
    });
    $('.rng', el).oninput = function (e) { var x = +e.target.value; e.target.style.setProperty('--v', x + '%'); th.setGlass(x, true); };
  }

  // ── модули ──
  function modulesHtml() {
    var list = window.Modules ? Modules.list() : [];
    if (!list.length) return '<div class="empty"><span class="ei glass">' + I('puzzle') + '</span><b>Нет доступных модулей</b><span>Администратор пока не включил дополнительные возможности. Когда они появятся, их можно будет включить здесь.</span></div>';
    return list.map(function (m) {
      return '<div class="grp glass"><div class="cell" style="min-height:64px"><span class="cl"><b style="font-weight:600">' + B.esc(m.title) + '</b><br><small style="color:var(--text2);font-weight:400">' + B.esc(m.description) + '</small></span><button class="tg" role="switch" aria-checked="' + !!m.on + '" aria-label="' + B.esc(m.title) + '" data-mod="' + m.key + '"></button></div>' +
        (m.on && m.needsDownload ? '<div class="cell"><span class="cl"></span><button class="btn sm" data-redo="' + m.key + '">Перекачать</button></div>' : '') + '</div>' + (m.note && (m.on || m.provider) ? '<div class="gf">' + B.esc(m.note) + '</div>' : '');
    }).join('');
  }
  function openModules() {
    var el = setPage('Модули', modulesHtml()); el.dataset.mods = 1;
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-mod]'), r = e.target.closest('[data-redo]');
      if (t) { var m = Modules.get(t.dataset.mod); if (m) Modules.setOn(t.dataset.mod, !m.on); }
      if (r) Modules.reinstall(r.dataset.redo).then(function () { B.toast.show('Кэш модуля очищен, файлы загрузятся заново', 'upd'); });
    });
  }
  B.bus.on('modules:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.mods; });
    if (p) $('.scroll', p).innerHTML = modulesHtml(); render();
  });

  // ── блокировки ──
  function blocksHtml() {
    if (!S.blocked.length) return '<div class="empty"><span class="ei glass">' + I('ban') + '</span><b>Заблокированных нет</b><span>Если кто-то пишет вам лишнее, заблокируйте его в профиле.</span></div>';
    return '<div class="grp glass">' + S.blocked.map(function (b) {
      return '<div class="mini">' + B.avatar.user(b.id, b.display_name, 0, true) + '<span class="rt"><b>' + B.esc(b.display_name) + '</b><small>' + (b.federated ? B.esc(B.contacts.fedAddr(b)) + ' · другой сервер' : '@' + B.esc(b.username) + (b.workspace_name ? ' · ' + B.esc(b.workspace_name) : '')) + '</small></span><button class="btn sm" data-unb="' + b.id + '">Разблокировать</button></div>';
    }).join('') + '</div><div class="gf">Заблокированный не может писать вам в личные сообщения. Общие группы и комнаты остаются.</div>';
  }
  function openBlocks() {
    var el = setPage('Блокировки', blocksHtml()); el.dataset.blocks = 1;
    el.addEventListener('click', async function (e) { var b = e.target.closest('[data-unb]'); if (b) { await B.api('DELETE', '/blocks/' + b.dataset.unb); B.contacts.loadBlocks(); B.toast.show('Разблокирован', 'unban'); } });
    B.avatar.apply(el);
  }
  B.bus.on('blocks:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.blocks; });
    if (p) { $('.scroll', p).innerHTML = blocksHtml(); B.avatar.apply(p); } render();
  });
  ['app:ready', 'avatar:updated', 'folders:changed', 'app:update', 'spaces:changed'].forEach(function (ev) { B.bus.on(ev, render); });
  return { mount: mount, render: render };
})();
