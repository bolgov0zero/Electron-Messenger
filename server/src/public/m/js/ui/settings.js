// /m — вкладка «Настройки»: аккаунт, внешний вид, уведомления, модули, блокировки, диагностика отступов, выход.
// Подстраницы: профиль, «Внешний вид», «Модули», «Блокировки», «Диагностика».
B.ui = B.ui || {};
B.ui.settings = (function () {
  var esc = B.esc, ic = B.ic, S = B.S, box = null;

  function icon(name, bg) { return '<span class="ci" style="background:' + bg + '">' + ic(name, 17, 2) + '</span>'; }
  function cell(o) {
    return '<button class="cell tap hasi" data-s="' + o.act + '">' + (o.ic ? icon(o.ic, o.bg) : '') + '<span class="cl' + (o.red ? ' red' : '') + '">' + o.label + '</span>' +
      (o.val ? '<span class="cv">' + esc(o.val) + '</span>' : '') + (o.chev === false ? '' : '<span class="chev">' + ic('chev', 16, 2.4) + '</span>') + '</button>';
  }
  function notifText() { var p = B.push.permission(); return !B.push.supported() ? 'Не поддерживаются' : p === 'granted' ? 'Включены' : p === 'denied' ? 'Запрещены' : 'Выключены'; }

  function render() {
    if (!box) return;
    var u = S.user || {}, mods = window.Modules ? Modules.list().filter(function (m) { return m.on; }).length : 0;
    var upd = B.app.newVersion ? '<div class="updc">' + ic('refresh', 22, 2) + '<div class="t"><b>Вышла новая версия</b><span>Обновление применится после перезагрузки</span></div><button class="pill" data-s="reload">Обновить</button></div>' : '';
    box.innerHTML = '<div style="height:14px"></div>' + upd +
      '<div class="grp"><button class="prof tap" data-s="me">' + (u.id ? B.avatar.user(u.id, u.display_name || '', 62, true) : '') +
        '<div style="flex:1;min-width:0"><div class="nm">' + esc(u.display_name || '') + '</div><div class="sb">@' + esc(u.username || '') + '</div></div><span class="chev" style="color:var(--fg3);display:flex">' + ic('chev', 16, 2.4) + '</span></button></div>' +
      '<div class="grp">' + cell({ act: 'appearance', ic: 'palette', bg: '#af52de', label: 'Внешний вид' }) +
        cell({ act: 'notif', ic: 'bell', bg: '#ff3b30', label: 'Уведомления', val: notifText() }) +
        cell({ act: 'modules', ic: 'puzzle', bg: '#34c759', label: 'Модули', val: mods ? String(mods) : '' }) +
        cell({ act: 'folders', ic: 'folder', bg: '#ff9500', label: 'Папки', val: B.folders.list.length ? String(B.folders.list.length) : '' }) + '</div>' +
      '<div class="grp"><div class="cell"><span class="cl">Отображать пространства</span><button class="tg" data-s="spaces" role="switch" aria-checked="' + B.spaces.on() + '"><i></i></button></div></div>' +
      '<div class="gf" style="margin-top:-16px">Включите, чтобы выбирать пространство над списком чатов и свайпом вправо: останутся люди из него и чаты с ними.</div>' +
      '<div class="grp">' + cell({ act: 'blocks', ic: 'block', bg: '#8e8e93', label: 'Блокировки', val: S.blocked.length ? String(S.blocked.length) : '' }) +
        cell({ act: 'diag', ic: 'gear', bg: '#5e6ad2', label: 'Диагностика' }) + '</div>' +
      '<div class="grp">' + cell({ act: 'logout', ic: 'out', bg: '#ff3b30', label: 'Выйти', red: 1, chev: false }) + '</div>' +
      '<div class="gf" style="text-align:center;margin-top:-8px">Версия ' + esc((window.APP_VERSION || '').replace('?v=', '') || '—') + '</div>' +
      '<div class="mcopy">w/ <span class="cp-h">❤️</span> by bolgov0zero</div>';
    if (u.id) B.avatar.apply(box);
  }
  function mount(el) {
    box = el; render();
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-s]'); if (!b) return; var a = b.dataset.s;
      if (a === 'me') openMe(); else if (a === 'appearance') openAppearance(); else if (a === 'modules') openModules(); else if (a === 'folders') B.ui.folders.openPage(); else if (a === 'spaces') { B.spaces.setOn(!B.spaces.on()); render(); }
      else if (a === 'blocks') openBlocks(); else if (a === 'diag') B.ui.diag.open();
      else if (a === 'logout') B.actions.confirm('Выйти из аккаунта?', '', 'Выйти', function () { B.auth.logout(); });
      else if (a === 'reload') location.reload();
      else if (a === 'notif') openNotif();
    });
  }

  // ── уведомления: разрешение, показ текста, тихие часы ──
  function mm(v) { return v == null ? '' : ('0' + Math.floor(v / 60)).slice(-2) + ':' + ('0' + v % 60).slice(-2); }
  function toMin(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function openNotif() {
    var p = B.push.permission(), ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), needInstall = !B.push.supported() || (ios && !B.pwa.standalone);
    var prefs = { show_text: true, quiet_from: null, quiet_to: null };
    var el = B.nav.page({ title: 'Уведомления', back: 'Настройки', gray: true, body: '' });
    function paint() {
      var quiet = prefs.quiet_from != null && prefs.quiet_to != null, h = '<div style="height:14px"></div>';
      if (needInstall) h += '<div class="how"><b>Чтобы приходили уведомления, добавьте приложение на экран «Домой»</b><ol><li>Нажмите <u>' + ic('share', 14, 2) + ' Поделиться</u> в Safari</li><li>Выберите «На экран “Домой”»</li><li>Откройте «Electron» с экрана «Домой» и разрешите уведомления</li></ol></div>';
      h += '<div class="grp"><div class="cell"><span class="cl">Уведомления</span><span class="cv">' + esc(notifText()) + '</span></div>' +
        (p === 'default' && B.push.supported() ? '<button class="cell tap" data-n="allow"><span class="cl" style="color:var(--accent)">Разрешить уведомления</span></button>' : '') + '</div>';
      if (p === 'denied') h += '<div class="gf" style="margin-top:-16px">Уведомления запрещены. Включить их можно в настройках телефона: Electron → Уведомления.</div>';
      h += '<div class="grp"><div class="cell"><span class="cl">Показывать текст сообщения</span><button class="tg" data-n="text" role="switch" aria-checked="' + !!prefs.show_text + '"><i></i></button></div></div>' +
        '<div class="gf" style="margin-top:-16px">Выключите показ текста, если телефон лежит на виду: в уведомлении будет только «Новое сообщение».</div>' +
        '<div class="grp"><div class="cell"><span class="cl">Тихие часы</span><button class="tg" data-n="quiet" role="switch" aria-checked="' + quiet + '"><i></i></button></div>' +
        (quiet ? '<div class="cell"><span class="cl">С</span><input class="tm" type="time" data-n="qf" value="' + mm(prefs.quiet_from) + '"></div><div class="cell"><span class="cl">До</span><input class="tm" type="time" data-n="qt" value="' + mm(prefs.quiet_to) + '"></div>' : '') + '</div>' +
        '<div class="gf" style="margin-top:-16px">В тихие часы уведомления на этом и других ваших устройствах не приходят. Сообщения никуда не пропадают.</div>';
      el.querySelector('.scroll').innerHTML = h;
    }
    async function save(part) {
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      var r = await B.api('PUT', '/push/prefs', Object.assign({ tz: tz }, part));
      if (r && !r.error) prefs = r; else B.toast.show('Не удалось сохранить');
      paint();
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-n]'); if (!b || b.tagName === 'INPUT') return; var a = b.dataset.n;
      if (a === 'allow') B.push.request().then(function () { p = B.push.permission(); render(); paint(); });
      else if (a === 'text') save({ show_text: !prefs.show_text });
      else if (a === 'quiet') { if (prefs.quiet_from != null) save({ quiet_from: null, quiet_to: null }); else save({ quiet_from: 22 * 60, quiet_to: 8 * 60 }); }
    });
    el.addEventListener('change', function (e) {
      var b = e.target.closest('input[data-n]'); if (!b) return; var v = toMin(b.value); if (v == null) return;
      save(b.dataset.n === 'qf' ? { quiet_from: v } : { quiet_to: v });
    });
    B.nav.push(el, 'Уведомления'); paint();
    B.api('GET', '/push/prefs').then(function (r) { if (r && !r.error) { prefs = r; paint(); } });
  }

  // ── профиль ──
  function resize(file) {
    return new Promise(function (resolve) {
      var rd = new FileReader();
      rd.onload = function (e) { var img = new Image(); img.onload = function () { var size = 256, cv = document.createElement('canvas'); cv.width = cv.height = size; var s = Math.min(img.width, img.height); cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); resolve(cv.toDataURL('image/jpeg', 0.88).split(',')[1]); }; img.src = e.target.result; };
      rd.readAsDataURL(file);
    });
  }
  function links() { var u = S.user, l = [['Внутренняя', '@' + u.username]]; if (u.server_id) l.push(['Внешняя', '@' + u.server_id + ':' + u.username]); return l; }
  function meHtml() {
    var u = S.user;
    return '<div class="big"><button class="avbig" data-m="photo" aria-label="Изменить фото">' + B.avatar.user(u.id, u.display_name, 96, true) + '</button><button class="link" data-m="photo">Изменить фото</button><input type="file" accept="image/*" hidden id="me-file"></div>' +
      '<div class="gh">Имя</div><div class="grp"><div class="cell"><input class="fld" id="me-name" value="' + esc(u.display_name) + '" maxlength="40" autocomplete="off"></div></div>' +
      '<button class="btn" data-m="save">Сохранить</button>' +
      '<div class="gh">Ссылка на профиль</div><div class="grp links">' + links().map(function (l, i) { return '<button class="cell tap" data-m="copy" data-i="' + i + '"><span class="cl">' + l[0] + '<small>' + esc(l[1]) + '</small></span><span class="pl">' + ic('copy', 18, 2) + '</span></button>'; }).join('') + '</div>' +
      '<div class="gf">' + (u.server_id ? 'Внутреннюю называйте коллегам на вашем сервере, внешнюю людям с других серверов.' : 'Внешняя ссылка появится, когда администратор задаст адрес сервера.') + '</div>';
  }
  function openMe() {
    var el = B.nav.page({ title: 'Профиль', back: 'Настройки', gray: true, body: meHtml() });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return; var a = b.dataset.m;
      if (a === 'photo') el.querySelector('#me-file').click();
      else if (a === 'copy') { var l = links()[+b.dataset.i]; try { await navigator.clipboard.writeText(l[1]); B.toast.show('Скопировано: ' + l[1]); } catch (err) { B.toast.show('Не удалось скопировать'); } }
      else if (a === 'save') {
        var name = el.querySelector('#me-name').value.trim();
        if (!name) { B.toast.show('Введите имя'); return; }
        if (name === S.user.display_name) { B.nav.pop(); return; }
        var res = await B.api('PATCH', '/users/me', { display_name: name });
        if (res && res.ok) { S.user.display_name = name; B.session.save(); render(); B.nav.pop(); B.toast.show('Имя обновлено'); } else B.toast.show('Не удалось сохранить');
      }
    });
    el.querySelector('#me-file').addEventListener('change', async function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      var res = await B.api('POST', '/users/me/avatar', { data: await resize(f) });
      if (res && res.ok) { S.avatarTs = Date.now(); B.avatar.clearCache(); B.bus.emit('avatar:updated'); B.avatar.apply(el); render(); B.toast.show('Фото обновлено'); } else B.toast.show('Не удалось загрузить фото');
    });
    B.nav.push(el, 'Профиль'); B.avatar.apply(el);
  }

  // ── внешний вид ──
  function seg(items, cur, key) { return '<div class="seg2" data-seg="' + key + '">' + items.map(function (i) { return '<button data-a="' + key + '" data-v="' + i[0] + '" class="' + (String(cur) === String(i[0]) ? 'on' : '') + '"' + (i[2] ? ' style="font-size:' + i[2] + 'px"' : '') + '>' + i[1] + '</button>'; }).join('') + '</div>'; }
  function appearanceHtml() {
    var A = B.appearance, theme = B.theme.get(), acc = A.accent(), pat = A.pattern();
    return '<div class="prev"><div class="msgs" style="padding:0"><div class="mrow in first last"><div class="mcol"><div class="bub"><div class="txt">Привет! Так выглядят сообщения<span class="meta">09:41</span></div></div></div></div>' +
      '<div class="mrow out first last"><div class="mcol"><div class="bub"><div class="txt">С выбранным акцентом и фоном<span class="meta">09:42 ' + B.ticks({ total: 1, delivered: 1, read: 1 }) + '</span></div></div></div></div></div></div>' +
      '<div class="gh">Тема</div><div class="grp">' + seg([['light', 'Светлая'], ['dark', 'Тёмная']], theme, 'theme') + '</div>' +
      '<div class="gh">Цветовой акцент</div><div class="grp"><div class="sws">' + Object.keys(A.ACCENTS).map(function (k) { return '<button class="sw' + (k === acc ? ' on' : '') + '" data-a="accent" data-v="' + k + '" style="--c:' + A.rgb(k).join(',') + '" aria-label="' + A.ACCENTS[k].name + '"></button>'; }).join('') + '</div></div>' +
      '<div class="gh">Фон переписки</div><div class="grp">' + seg([['plain', 'Градиент'], ['split', 'Однотонный']], A.chatBg(), 'bg') + '</div>' +
      '<div class="gh">Узор фона</div><div class="grp"><div class="pats">' + A.PATTERNS.map(function (p) { return '<button class="pat' + (p.id === pat ? ' on' : '') + '" data-a="pattern" data-v="' + p.id + '" aria-label="' + p.name + '">' + (p.id ? '<i data-pat="' + p.id + '"></i>' : 'Нет') + '</button>'; }).join('') + '</div>' +
        (pat ? seg([[1, 'Слабо'], [2, 'Средне'], [3, 'Сильно']], A.patternLevel(), 'level') : '') + '</div>' +
      '<div class="gh">Размер текста сообщений</div><div class="grp">' + seg([['small', 'A', 13], ['medium', 'A', 16], ['large', 'A', 19]], A.fontSize(), 'font') + '</div>';
  }
  function paintPats(root) { root.querySelectorAll('[data-pat]').forEach(function (i) { var u = 'url("/chat/assets/patterns/' + i.dataset.pat + '.png")'; i.style.webkitMaskImage = u; i.style.maskImage = u; }); }
  function openAppearance() {
    var el = B.nav.page({ title: 'Внешний вид', back: 'Настройки', gray: true, body: appearanceHtml() }), A = B.appearance;
    var redraw = function () { var sc = el.querySelector('.scroll'), y = sc.scrollTop; sc.innerHTML = appearanceHtml(); sc.scrollTop = y; paintPats(sc); };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; var a = b.dataset.a, v = b.dataset.v;
      if (a === 'theme') B.theme.set(v); else if (a === 'accent') A.setAccent(v); else if (a === 'bg') A.setChatBg(v);
      else if (a === 'pattern') A.setPattern(v); else if (a === 'level') A.setPatternLevel(+v); else if (a === 'font') A.setFontSize(v);
      redraw();
    });
    B.nav.push(el, 'Внешний вид'); paintPats(el);
  }

  // ── модули ──
  function modulesHtml() {
    var list = window.Modules ? Modules.list() : [];
    if (!list.length) return '<div class="empty"><b>Нет доступных модулей</b>Администратор пока не включил дополнительные возможности. Когда они появятся, их можно будет включить здесь.</div>';
    return '<div style="height:14px"></div>' + list.map(function (m) {
      return '<div class="grp"><div class="cell" style="min-height:64px"><span class="cl"><b style="font-weight:600">' + esc(m.title) + '</b>' + (m.provider ? ' <span class="chip">' + esc(m.provider) + '</span>' : '') + '<small>' + esc(m.description) + '</small></span>' +
        '<button class="tg" role="switch" aria-checked="' + !!m.on + '" aria-label="' + esc(m.title) + '" data-mod="' + m.key + '"><i></i></button></div>' +
        (m.on && m.needsDownload ? '<div class="cell"><span class="cl"></span><button class="pill" data-redo="' + m.key + '">Перекачать</button></div>' : '') + '</div>' +
        (m.note && (m.on || m.provider) ? '<div class="gf">' + esc(m.note) + '</div>' : '');
    }).join('');
  }
  function openModules() {
    var el = B.nav.page({ title: 'Модули', back: 'Настройки', gray: true, body: modulesHtml() });
    el.dataset.mods = 1;
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-mod]'), r = e.target.closest('[data-redo]');
      if (t) { var m = Modules.get(t.dataset.mod); if (m) Modules.setOn(t.dataset.mod, !m.on); }
      if (r) Modules.reinstall(r.dataset.redo).then(function () { B.toast.show('Кэш модуля очищен, файлы загрузятся заново'); });
    });
    B.nav.push(el, 'Модули');
  }
  B.bus.on('modules:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.mods; });
    if (p) p.querySelector('.scroll').innerHTML = modulesHtml(); render();
  });

  // ── блокировки ──
  function blocksHtml() {
    if (!S.blocked.length) return '<div class="empty"><b>Заблокированных нет</b>Если кто-то пишет вам лишнее, заблокируйте его в профиле этого человека.</div>';
    return '<div style="height:14px"></div><div class="grp">' + S.blocked.map(function (b) {
      return '<div class="cell" style="min-height:60px">' + B.avatar.user(b.id, b.display_name, 40, true) + '<span class="cl"><b style="font-weight:600">' + esc(b.display_name) + '</b><small>' + (b.federated ? esc(B.contacts.fedAddr(b)) + ' · другой сервер' : '@' + esc(b.username) + (b.workspace_name ? ' · ' + esc(b.workspace_name) : '')) + '</small></span><button class="pill" data-unb="' + b.id + '">Разблокировать</button></div>';
    }).join('') + '</div><div class="gf">Заблокированный не может писать вам в личные сообщения. Общие группы и комнаты остаются.</div>';
  }
  function openBlocks() {
    var el = B.nav.page({ title: 'Блокировки', back: 'Настройки', gray: true, body: blocksHtml() }); el.dataset.blocks = 1;
    el.addEventListener('click', async function (e) { var b = e.target.closest('[data-unb]'); if (b) { await B.api('DELETE', '/blocks/' + b.dataset.unb); B.contacts.loadBlocks(); } });
    B.nav.push(el, 'Блокировки'); B.avatar.apply(el);
  }
  B.bus.on('blocks:changed', function () {
    var p = B.nav.stack.map(function (s) { return s.el; }).find(function (e) { return e.dataset.blocks; });
    if (p) { p.querySelector('.scroll').innerHTML = blocksHtml(); B.avatar.apply(p); } render();
  });
  B.bus.on('app:ready', render); B.bus.on('chats:changed', function () {});
  B.bus.on('avatar:updated', render);
  B.bus.on('folders:changed', render);
  B.bus.on('app:update', function () { render(); });
  return { mount: mount, render: render };
})();
