// Ссылки на видеозвонок для гостей: окно создания и списка (создать, скопировать, завершить звонок, удалить).
// Общий файл: подключается в /chat и клиенте (копия лежит в client/src/). Стили берёт у окна гостевых ссылок (shared/guestlinks.js).
//   CallLinks.open({ base, request(method, path, body) → Promise<{ ok, status, data }> })   base — адрес сервера, например https://chat.example.com
(function () {
  'use strict';
  var TTLS = [['2 часа', 7200], ['8 часов', 28800], ['Сутки', 86400], ['3 суток', 259200], ['Неделя', 604800]];
  var WARN = {
    not_public: 'Сервер звонков не отмечен как доступный из интернета: гости вне вашей сети не смогут подключиться (раздел «Звонки» в админке).',
    insecure: 'Адрес сервера звонков без wss://: браузер гостя не даст использовать камеру и микрофон.',
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmtAt = function (ts) { return new Date(ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var CSS = '.cll select{font:inherit;font-size:var(--gl-fs);height:var(--gl-h);color:var(--gl-tx);background:var(--gl-bg2);border:1px solid var(--gl-bd);border-radius:var(--gl-r);padding:0 8px;outline:0;min-width:0;cursor:pointer}' +
    '.cll .cll-it{display:flex;flex-direction:column;gap:8px;padding:10px 12px}.cll .cll-it+.cll-it{border-top:1px solid var(--gl-bd)}' +
    '.cll .cll-url{display:flex;gap:8px;align-items:center}.cll .cll-url input{flex:1}' +
    '.cll .cll-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:calc(var(--gl-fs) - 1px);color:var(--gl-mt)}.cll .cll-meta .sp{flex:1}' +
    '.cll .cll-ask{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:var(--gl-r);background:color-mix(in srgb,var(--gl-bad) 10%,transparent);border:1px solid color-mix(in srgb,var(--gl-bad) 30%,transparent);line-height:1.35}.cll .cll-ask .sp{flex:1}' +
    '.cll .cll-ask .q{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 220px}.cll .cll-ask .q b{font-size:var(--gl-fs)}.cll .cll-ask .q small{font-size:calc(var(--gl-fs) - 1.5px);color:var(--gl-mt)}' +
    /* в веб клиенте кнопки окон — «таблетки» со своим цветом (glass.css): перебиваем их по весу селектора */
    '.cll button.gl-btn.cll-no,.cll button.gl-btn.cll-act,.gl-bg:not(.gl-adm):not(.gl-m) .cll button.gl-btn.cll-no:not(.gl-ic),.gl-bg:not(.gl-adm):not(.gl-m) .cll button.gl-btn.cll-act:not(.gl-ic){border:1px solid var(--gl-bd);background:transparent;color:var(--gl-tx)}' +
    '.cll button.gl-btn.cll-no:hover:not(:disabled),.cll button.gl-btn.cll-act:hover:not(:disabled){background:var(--gl-hv);filter:none}' +
    '.cll button.gl-btn.cll-yes,.gl-bg:not(.gl-adm):not(.gl-m) .cll button.gl-btn.cll-yes:not(.gl-ic){border:1px solid var(--gl-bad);background:var(--gl-bad);color:#fff}' +
    '.cll .cll-nm{flex:1 1 200px;min-width:0}.cll .cll-tt{font-size:var(--gl-fs);font-weight:600;overflow-wrap:anywhere}' +
    '.cll .cll-warn{color:var(--gl-wn);font-size:calc(var(--gl-fs) - .5px);line-height:1.45;margin:0}';
  var IC_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  function open(o) {
    if (document.querySelector('.gl-bg')) return;
    if (window.GuestLinks && GuestLinks.ensureCss) GuestLinks.ensureCss();
    if (!document.getElementById('cll-css')) { var st = document.createElement('style'); st.id = 'cll-css'; st.textContent = CSS; document.head.appendChild(st); }
    var bg = document.createElement('div'); bg.className = 'gl-bg' + (/^\/m(\/|$)/.test(location.pathname) ? ' gl-m' : '');
    bg.innerHTML = '<div class="gl cll" role="dialog" aria-label="Ссылка на видеозвонок"><div class="gl-h"><div class="tt"><b>Ссылка на видеозвонок</b><small>Для гостей без учётной записи</small></div><button class="gl-x" aria-label="Закрыть">✕</button></div>' +
      '<div class="gl-top"><input class="cll-nm" id="cll-nm" maxlength="80" placeholder="Название звонка (необязательно)" aria-label="Название звонка" autocomplete="off"><select class="cll-ttl" aria-label="Срок ссылки">' + TTLS.map(function (t, i) { return '<option value="' + t[1] + '"' + (i === 2 ? ' selected' : '') + '>' + t[0] + '</option>'; }).join('') + '</select><button class="gl-btn" id="cll-make">Создать ссылку</button><span class="gl-sp"></span></div>' +
      '<div class="gl-b"><p class="gl-note">Тот, кто создал ссылку, ведёт звонок: гостей он впускает сам. Сотрудники входят без подтверждения. Если удалить ссылку, новые гости не войдут, а идущий звонок продолжится.</p>' +
      '<div id="cll-warn"></div><div class="gl-err" id="cll-err"></div><div class="gl-list" id="cll-list"></div></div></div>';
    document.body.appendChild(bg);
    var $ = function (s) { return bg.querySelector(s); };
    var closed = false, timer = null;
    var close = function () {
      if (closed) return; closed = true; clearInterval(timer); document.removeEventListener('keydown', onKey, true);
      bg.classList.add('closing'); var done = function () { bg.remove(); };
      bg.addEventListener('animationend', function (e) { if (e.target === bg) done(); }); setTimeout(done, 260);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    $('.gl-x').onclick = close;
    var urlOf = function (l) { return String(o.base || location.origin).replace(/\/+$/, '') + '/k/' + l.token; };

    // Подтверждение прямо в строке ссылки: вопрос и две кнопки, а не «Точно?» на месте значка
    var links = [], ask = null, askT = null;
    var setAsk = function (v) { ask = v; clearTimeout(askT); if (v) askT = setTimeout(function () { ask = null; paint(true); }, 8000); paint(true); };
    function paint(force) {
      var box = $('#cll-list'); if (!box) return;
      // Не перерисовываем, пока ничего не изменилось: иначе сбивается выделение ссылки
      var sig = JSON.stringify([links.map(function (l) { return [l.id, l.live, l.people, l.waiting, l.expires_at, l.title]; }), ask]);
      if (!force && box.dataset.sig === sig && box.children.length) return;
      box.dataset.sig = sig;
      box.innerHTML = links.length ? links.map(function (l) {
        var chip = l.live ? '<span class="gl-chip ok">Идёт звонок · ' + l.people + '</span>' : '<span class="gl-chip">Звонка нет</span>';
        var tail;
        if (ask && ask.id === l.id) {
          var end = ask.kind === 'end';
          tail = '<div class="cll-ask"><div class="q"><b>' + (end ? 'Завершить звонок?' : 'Удалить ссылку?') + '</b><small>' + (end ? 'Звонок закончится у всех участников.' : 'Новые гости не войдут, идущий звонок продолжится.') + '</small></div>' +
            '<button class="gl-btn cll-no" data-ask-no>Отмена</button><button class="gl-btn cll-yes" data-ask-yes="' + ask.kind + '" data-id="' + l.id + '">' + (end ? 'Завершить' : 'Удалить') + '</button></div>';
        } else {
          tail = '<div class="cll-meta">' + chip + (l.waiting ? '<span class="gl-chip warn">Ждут входа: ' + l.waiting + '</span>' : '') + '<span>до ' + fmtAt(l.expires_at) + '</span><span class="sp"></span>' +
            (o.join ? '<button class="gl-btn" data-join="' + l.id + '">' + (l.live ? 'Присоединиться' : 'Начать звонок') + '</button>' : '') +
            (l.live ? '<button class="gl-btn cll-act" data-end="' + l.id + '">Завершить звонок</button>' : '') +
            '<button class="gl-btn gl-ic dng" data-del="' + l.id + '" title="Удалить ссылку" aria-label="Удалить ссылку">' + IC_X + '</button></div>';
        }
        return '<div class="cll-it" data-id="' + l.id + '">' + (l.title ? '<div class="cll-tt">' + esc(l.title) + '</div>' : '') + '<div class="cll-url"><input readonly value="' + esc(urlOf(l)) + '" aria-label="Ссылка"><button class="gl-btn" data-copy="' + l.id + '">Копировать</button></div>' + tail + '</div>';
      }).join('') : '<div class="gl-none">Ссылок пока нет</div>';
    }
    async function load() {
      var r = await o.request('GET', '/calllinks');
      var box = $('#cll-list'); if (!box) return;
      if (!r.ok) { box.innerHTML = '<div class="gl-err">' + esc((r.data && r.data.error) || 'Не удалось загрузить список') + '</div>'; box.dataset.sig = ''; return; }
      links = r.data.links || [];
      $('#cll-warn').innerHTML = (r.data.warnings || []).map(function (w) { return WARN[w] ? '<p class="cll-warn">' + esc(WARN[w]) + '</p>' : ''; }).join('');
      paint();
    }
    $('#cll-make').onclick = async function () {
      var b = this; b.disabled = true; $('#cll-err').textContent = '';
      var r = await o.request('POST', '/calllinks', { ttl: Number($('.cll-ttl').value), title: $('#cll-nm').value.trim() });
      b.disabled = false;
      if (!r.ok) { $('#cll-err').textContent = (r.data && r.data.error) || 'Не удалось создать ссылку'; return; }
      $('#cll-nm').value = '';
      await load();
    };
    $('#cll-list').addEventListener('click', async function (e) {
      var cp = e.target.closest('[data-copy]');
      if (cp) {
        var l = links.filter(function (x) { return String(x.id) === cp.dataset.copy; })[0]; if (!l) return;
        var url = urlOf(l), inp = cp.parentNode.querySelector('input'), done = function () { cp.textContent = 'Скопировано'; setTimeout(function () { cp.textContent = 'Копировать'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { inp.select(); document.execCommand('copy'); done(); });
        else { inp.select(); document.execCommand('copy'); done(); }
        return;
      }
      var jn = e.target.closest('[data-join]');
      if (jn) {
        var jl = links.filter(function (x) { return String(x.id) === jn.dataset.join; })[0];
        if (jl && o.join) { close(); o.join(jl.token); }
        return;
      }
      var en = e.target.closest('[data-end]'), dl = e.target.closest('[data-del]');
      if (en) { setAsk({ id: Number(en.dataset.end), kind: 'end' }); return; }
      if (dl) { setAsk({ id: Number(dl.dataset.del), kind: 'del' }); return; }
      if (e.target.closest('[data-ask-no]')) { setAsk(null); return; }
      var yes = e.target.closest('[data-ask-yes]');
      if (yes) {
        yes.disabled = true;
        var id = yes.dataset.id, kind = yes.dataset.askYes;
        var r = kind === 'end' ? await o.request('POST', '/calllinks/' + id + '/end') : await o.request('DELETE', '/calllinks/' + id);
        $('#cll-err').textContent = r.ok ? '' : ((r.data && r.data.error) || (kind === 'end' ? 'Не удалось завершить' : 'Не удалось удалить'));
        setAsk(null); load();
      }
    });
    timer = setInterval(function () { if (!bg.isConnected) { clearInterval(timer); return; } load(); }, 4000);
    load();
  }
  window.CallLinks = { open: open };
})();
