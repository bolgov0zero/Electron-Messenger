// Гостевые ссылки группы или комнаты: окно создания, список, продление, отзыв и сброс привязки к устройству.
// Общий файл: подключается в /chat, /m, админке и клиенте (копия лежит в client/src/). Окно рисуется само и берёт цвета у страницы:
// у веб-клиента, админки и мобильной версии переменные темы называются по-разному, поэтому ниже они сводятся к своим (--gl-*).
//   GuestLinks.open({ chatId, chatName, request(method, path, body) → Promise<{ ok, status, data }> })
(function () {
  'use strict';
  var TTLS = [['2 часа', 7200], ['8 часов', 28800], ['Сутки', 86400], ['3 суток', 259200], ['Неделя', 604800]];
  var EXT = [['1 час', 3600], ['2 часа', 7200], ['8 часов', 28800], ['Сутки', 86400], ['3 суток', 259200]];
  var STATE = { pending: ['Ждёт входа', 'warn'], active: ['Активна', 'ok'], expired: ['Закончилась', 'off'], revoked: ['Отозвана', 'off'] };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var CSS = '.gl-bg{--gl-bg:var(--modal-bg,var(--c-surface,var(--card,#fff)));--gl-bg2:var(--search-bg,var(--c-surface2,var(--fill,rgba(127,127,127,.12))));--gl-bd:var(--border,var(--c-border,var(--sep,rgba(127,127,127,.28))));' +
    '--gl-tx:var(--text,var(--c-text,var(--fg,#111)));--gl-mt:var(--muted,var(--c-text2,var(--fg2,#778)));--gl-ac:var(--accent,var(--c-primary,#1fa88f));--gl-acs:var(--accent-soft,var(--c-primary-dim,rgba(31,168,143,.14)));' +
    '--gl-hv:var(--hover-row,var(--fill,rgba(127,127,127,.14)));--gl-ok:var(--c-green,var(--green,#2e9e5b));--gl-bad:var(--c-red,var(--red,#d23737));--gl-wn:var(--orange,#c98a12);--gl-h:34px;--gl-fs:13px;--gl-r:9px;' +
    '.gl-bg.gl-adm{--gl-h:30px;--gl-fs:12px;--gl-r:8px}.gl-bg.gl-m{--gl-h:40px;--gl-fs:14px;--gl-r:11px}@media (pointer:coarse){.gl-bg{--gl-h:40px}}' +
    'position:fixed;inset:0;z-index:100000;background:rgba(8,10,18,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:inherit;color:var(--gl-tx);animation:gl-bg-in 180ms ease-out both}' +
    '.gl-bg.closing{animation:gl-bg-out 150ms ease-in forwards}.gl-bg .gl{animation:gl-in 220ms cubic-bezier(.34,1.56,.64,1) both}.gl-bg.closing .gl{animation:gl-out 150ms ease-in forwards}' +
    '@keyframes gl-bg-in{from{opacity:0}to{opacity:1}}@keyframes gl-bg-out{from{opacity:1}to{opacity:0}}' +
    '@keyframes gl-in{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:none}}@keyframes gl-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.94) translateY(6px)}}' +
    '@keyframes gl-pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}@keyframes gl-pop-out{to{opacity:0;transform:scale(.97)}}' +
    '.gl-sel{position:relative;min-width:0}.gl-sel-b{font:inherit;font-size:var(--gl-fs);height:var(--gl-h);width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;color:var(--gl-tx);background:var(--gl-bg2);border:1px solid var(--gl-bd);border-radius:var(--gl-r);padding:0 8px 0 10px;cursor:pointer;text-align:left;outline:0;transition:border-color .15s,background .15s}' +
    '.gl-sel-b:hover{border-color:color-mix(in srgb,var(--gl-ac) 45%,var(--gl-bd))}.gl-sel-b:focus-visible,.gl-sel.open .gl-sel-b{border-color:var(--gl-ac)}.gl-sel-b svg{flex:none;color:var(--gl-mt);transition:transform .18s}.gl-sel.open .gl-sel-b svg{transform:rotate(180deg)}' +
    '.gl-pop{position:fixed;z-index:100001;background:var(--gl-bg);border:1px solid var(--gl-bd);border-radius:10px;padding:4px;box-shadow:0 12px 32px rgba(0,0,0,.35);animation:gl-pop-in 130ms ease-out both;max-height:260px;overflow:auto}.gl-pop.out{animation:gl-pop-out 90ms ease-in forwards}' +
    '.gl-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:7px;font-size:var(--gl-fs);cursor:pointer;color:var(--gl-tx)}.gl-opt.act{background:var(--gl-hv)}.gl-opt.sel{color:var(--gl-ac);font-weight:600}.gl-opt svg{flex:none;opacity:0}.gl-opt.sel svg{opacity:1}' +
    '@media (prefers-reduced-motion:reduce){.gl-bg,.gl-bg .gl,.gl-pop{animation-duration:.01ms!important}}' +
    '.gl{background:var(--gl-bg);color:var(--gl-tx);border:1px solid var(--gl-bd);border-radius:14px;width:100%;max-width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden;font-size:var(--gl-fs)}' +
    '.gl *{box-sizing:border-box}.gl-h{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--gl-bd)}.gl-h .tt{flex:1;min-width:0}.gl-h b{display:block;font-size:calc(var(--gl-fs) + 2px)}' +
    '.gl-h small{display:block;font-size:calc(var(--gl-fs) - 1px);color:var(--gl-mt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-x{background:none;border:0;color:var(--gl-mt);cursor:pointer;font-size:16px;line-height:1;padding:6px 9px;border-radius:7px}.gl-x:hover{background:var(--gl-hv);color:var(--gl-tx)}' +
    '.gl-top{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--gl-bd);flex-wrap:wrap}.gl-top .gl-sel{width:150px}.gl-top .gl-sp{flex:1}' +
    '.gl-b{padding:12px 16px 16px;overflow:auto;display:flex;flex-direction:column;gap:12px}.gl-note{font-size:calc(var(--gl-fs) - .5px);line-height:1.5;color:var(--gl-mt);margin:0}' +
    '.gl input{font:inherit;font-size:var(--gl-fs);height:var(--gl-h);color:var(--gl-tx);background:var(--gl-bg2);border:1px solid var(--gl-bd);border-radius:var(--gl-r);padding:0 10px;outline:0;min-width:0;width:100%}.gl input:focus{border-color:var(--gl-ac)}' +
    '.gl-grid{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}' +
    '.gl button.gl-btn{font:inherit;font-size:var(--gl-fs);font-weight:600;height:var(--gl-h);border-radius:var(--gl-r);padding:0 14px;cursor:pointer;white-space:nowrap;border:1px solid var(--gl-ac);background:var(--gl-acs);color:var(--gl-ac);display:inline-flex;align-items:center;justify-content:center;gap:6px}' +
    '.gl button.gl-btn:hover:not(:disabled){filter:brightness(1.12)}.gl button.gl-btn:disabled{opacity:.5;cursor:default}' +
    '.gl button.gl-ic{width:var(--gl-h);padding:0;flex:none}.gl button.gl-ic.sub{border-color:var(--gl-bd);background:transparent;color:var(--gl-mt)}.gl button.gl-ic.sub:hover:not(:disabled){background:var(--gl-hv);color:var(--gl-tx);filter:none}' +
    '.gl button.gl-ic.dng{border-color:color-mix(in srgb,var(--gl-bad) 40%,transparent);background:transparent;color:var(--gl-bad)}.gl button.gl-ic.dng:hover:not(:disabled){background:color-mix(in srgb,var(--gl-bad) 12%,transparent);filter:none}' +
    '.gl button.gl-ic.ask{width:auto;padding:0 10px;border-color:var(--gl-bad);background:color-mix(in srgb,var(--gl-bad) 14%,transparent)}' +
    '.gl button.gl-ib{background:none;border:1px solid var(--gl-bd);color:var(--gl-mt);width:var(--gl-h);height:var(--gl-h);border-radius:var(--gl-r);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}.gl button.gl-ib:hover,.gl button.gl-ib[aria-expanded=true]{background:var(--gl-hv);color:var(--gl-tx)}' +
    '.gl-new{border:1px solid var(--gl-ac);background:var(--gl-acs);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}' +
    '.gl-list{border:1px solid var(--gl-bd);border-radius:10px;overflow:hidden;background:var(--gl-bg2)}' +
    '.gl-th,.gl-it{display:grid;grid-template-columns:minmax(0,1fr) 92px 58px calc(104px + 3 * var(--gl-h) + 18px);align-items:center;gap:12px;padding:8px 12px}' +
    '.gl-th{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gl-mt);padding-block:7px;border-bottom:1px solid var(--gl-bd)}' +
    '.gl-it+.gl-it{border-top:1px solid var(--gl-bd)}.gl-it .who{min-width:0;display:flex;flex-direction:column;gap:1px}.gl-it .who b{font-size:var(--gl-fs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-it .who small{font-size:calc(var(--gl-fs) - 1.5px);color:var(--gl-mt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-tm{font-variant-numeric:tabular-nums;font-weight:700;color:var(--gl-ac);font-size:calc(var(--gl-fs) + 1px)}.gl-tm.no{color:var(--gl-mt);font-weight:400}' +
    '.gl-acts{display:flex;align-items:center;gap:6px;justify-content:flex-start}.gl-acts .gl-sel{width:104px}' +
    '.gl-chip{font-size:10.5px;font-weight:600;border-radius:20px;padding:1px 8px;border:1px solid var(--gl-bd);color:var(--gl-mt);white-space:nowrap;justify-self:start}.gl-chip.ok{color:var(--gl-ok);border-color:color-mix(in srgb,var(--gl-ok) 45%,transparent)}.gl-chip.warn{color:var(--gl-wn);border-color:color-mix(in srgb,var(--gl-wn) 45%,transparent)}' +
    '.gl-err{color:var(--gl-bad);font-size:calc(var(--gl-fs) - .5px);min-height:0}.gl-err:empty{display:none}.gl-none{font-size:var(--gl-fs);color:var(--gl-mt);text-align:center;padding:14px 0}' +
    '@media (max-width:560px){.gl-th{display:none}.gl-it{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"who who chip" "tm acts acts";row-gap:8px}.gl-it .gl-acts{justify-content:flex-end}.gl-it .who{grid-area:who}.gl-it .gl-chip{grid-area:chip}.gl-it .gl-tm{grid-area:tm}.gl-it .gl-acts{grid-area:acts}.gl-top .gl-sel{flex:1;width:auto}.gl-top .gl-sp{display:none}}';

  var IC = {
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    ban: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>'
  };
  var skew = 0;   // поправка на разницу часов компьютера и сервера
  function fmtHM(ts) {
    var s = Math.max(0, ts - Math.floor((Date.now() + skew) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  var fmtAt = function (ts) { return new Date(ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  // Свой выпадающий список вместо системного: строка выбора и список вариантов, значение лежит в data-value
  var selHtml = function (key, list, sel, label) {
    return '<div class="gl-sel" data-sel="' + key + '" data-value="' + list[sel][1] + '" data-list="' + (list === EXT ? 'ext' : 'ttl') + '"><button type="button" class="gl-sel-b" aria-haspopup="listbox" aria-expanded="false" aria-label="' + label + '"><span class="gl-sel-t">' + list[sel][0] + '</span>' + CHEV + '</button></div>';
  };

  function open(o) {
    if (document.querySelector('.gl-bg')) return;
    if (!document.getElementById('gl-css')) { var st = document.createElement('style'); st.id = 'gl-css'; st.textContent = CSS; document.head.appendChild(st); }
    var bg = document.createElement('div'); bg.className = 'gl-bg';
    bg.className += /^\/admin/.test(location.pathname) ? ' gl-adm' : /^\/m(\/|$)/.test(location.pathname) ? ' gl-m' : '';
    bg.innerHTML = '<div class="gl" role="dialog" aria-label="Гостевая ссылка"><div class="gl-h"><div class="tt"><b>Гостевая ссылка</b><small>' + esc(o.chatName || 'чат') + '</small></div><button class="gl-x" aria-label="Закрыть">✕</button></div>' +
      '<div class="gl-top">' + selHtml('ttl', TTLS, 2, 'Срок ссылки') + '<button class="gl-btn" id="gl-make">Создать ссылку</button><span class="gl-sp"></span><button type="button" class="gl-ib" id="gl-info" aria-expanded="false" title="Как это работает">' + IC.info + '</button></div>' +
      '<div class="gl-b"><p class="gl-note" id="gl-note" hidden>Человек без учётной записи входит по ссылке в этот чат на время: пишет и отвечает, но не видит прошлой переписки и профилей. Одна ссылка — один гость, и работает она только с его устройства.</p><div class="gl-err" id="gl-err"></div>' +
      '<div id="gl-new"></div><div class="gl-list" id="gl-list"></div></div></div>';
    document.body.appendChild(bg);
    var $ = function (s) { return bg.querySelector(s); };
    var closed = false;
    var close = function () {
      if (closed) return; closed = true; closePop(true);
      document.removeEventListener('keydown', onKey, true);
      bg.classList.add('closing');
      var done = function () { bg.remove(); };
      bg.addEventListener('animationend', function (e) { if (e.target === bg) done(); });
      setTimeout(done, 260);   // страховка, если анимация не придёт (свёрнутое окно, отключённые анимации)
    };
    // ── выпадающий список ──
    var pop = null, popFor = null, act = 0;
    function closePop(now) {
      if (!pop) return;
      var p = pop, f = popFor; pop = null; popFor = null;
      if (f) { f.classList.remove('open'); f.querySelector('.gl-sel-b').setAttribute('aria-expanded', 'false'); }
      if (now) p.remove(); else { p.classList.add('out'); setTimeout(function () { p.remove(); }, 100); }
    }
    function paintPop() { pop.querySelectorAll('.gl-opt').forEach(function (el, i) { el.classList.toggle('act', i === act); }); var a = pop.querySelector('.gl-opt.act'); if (a) a.scrollIntoView({ block: 'nearest' }); }
    function pick(i) {
      var list = popFor.dataset.list === 'ext' ? EXT : TTLS, f = popFor;
      f.dataset.value = list[i][1]; f.querySelector('.gl-sel-t').textContent = list[i][0];
      closePop(); f.querySelector('.gl-sel-b').focus();
    }
    function openPop(f) {
      if (popFor === f) { closePop(); return; }
      closePop(true);
      var list = f.dataset.list === 'ext' ? EXT : TTLS, cur = list.findIndex(function (t) { return String(t[1]) === f.dataset.value; });
      act = cur < 0 ? 0 : cur;
      pop = document.createElement('div'); pop.className = 'gl-pop'; pop.setAttribute('role', 'listbox');
      pop.innerHTML = list.map(function (t, i) { return '<div class="gl-opt' + (i === cur ? ' sel' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === cur) + '"><span>' + t[0] + '</span>' + CHECK + '</div>'; }).join('');
      bg.appendChild(pop); popFor = f; f.classList.add('open'); f.querySelector('.gl-sel-b').setAttribute('aria-expanded', 'true');
      var r = f.getBoundingClientRect(), h = pop.offsetHeight, below = window.innerHeight - r.bottom - 12;
      pop.style.width = r.width + 'px'; pop.style.left = r.left + 'px';
      pop.style.top = (below >= Math.min(h, 200) ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
      pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
      pop.addEventListener('click', function (e) { var o2 = e.target.closest('.gl-opt'); if (o2) pick(Number(o2.dataset.i)); });
      pop.addEventListener('mousemove', function (e) { var o2 = e.target.closest('.gl-opt'); if (o2 && Number(o2.dataset.i) !== act) { act = Number(o2.dataset.i); paintPop(); } });
      paintPop();
    }
    bg.addEventListener('click', function (e) {
      var b = e.target.closest('.gl-sel-b'); if (b) { openPop(b.parentNode); return; }
      if (pop && !e.target.closest('.gl-pop')) closePop();
    });
    bg.addEventListener('keydown', function (e) {
      var b = e.target.closest && e.target.closest('.gl-sel-b'); if (!b) return;
      var f = b.parentNode, n = (f.dataset.list === 'ext' ? EXT : TTLS).length;
      if (!pop) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop(f); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % n; paintPop(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act + n - 1) % n; paintPop(); }
      else if (e.key === 'Home') { e.preventDefault(); act = 0; paintPop(); }
      else if (e.key === 'End') { e.preventDefault(); act = n - 1; paintPop(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(act); }
      else if (e.key === 'Tab') closePop();
    });
    bg.querySelector('.gl-b').addEventListener('scroll', function () { closePop(true); });
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); if (pop) closePop(); else close(); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    $('.gl-x').onclick = close;
    $('#gl-info').onclick = function () { var n = $('#gl-note'); n.hidden = !n.hidden; this.setAttribute('aria-expanded', String(!n.hidden)); };

    async function load() {
      var r = await o.request('GET', '/guest/links?chat_id=' + o.chatId);
      var box = $('#gl-list'); if (!box) return; closePop(true);
      if (!r.ok) { box.innerHTML = '<div class="gl-err">' + esc((r.data && r.data.error) || 'Не удалось загрузить список') + '</div>'; return; }
      var links = r.data.links || [];
      skew = r.data.now ? r.data.now * 1000 - Date.now() : 0;
      box.innerHTML = links.length ? '<div class="gl-th"><span>Гость</span><span>Статус</span><span>Осталось</span><span></span></div>' + links.map(function (l) {
        var s = STATE[l.state] || STATE.expired, live = l.state === 'pending' || l.state === 'active';
        return '<div class="gl-it"><div class="who"><b>' + esc(l.guest_name || 'Гость ещё не входил') + '</b><small title="Создал ' + esc(l.created_by_name || '—') + '">до ' + fmtAt(l.expires_at) + '</small></div><span class="gl-chip ' + s[1] + '">' + s[0] + '</span>' +
          (live ? '<b class="gl-tm" data-exp="' + l.expires_at + '" title="Осталось, ч:мин">' + fmtHM(l.expires_at) + '</b>' : '<span class="gl-tm no">—</span>') +
          '<div class="gl-acts">' + (live ? selHtml('ext' + l.id, EXT, 1, 'На сколько продлить') + '<button class="gl-btn gl-ic" data-extend="' + l.id + '" title="Продлить" aria-label="Продлить">' + IC.plus + '</button>' +
            (l.state === 'active' && l.bound ? '<button class="gl-btn gl-ic sub" data-reset="' + l.id + '" title="Сбросить устройство: разрешить вход с нового" aria-label="Сбросить устройство">' + IC.reset + '</button>' : '') +
            '<button class="gl-btn gl-ic dng" data-revoke="' + l.id + '" title="Отозвать ссылку" aria-label="Отозвать">' + IC.ban + '</button>' : '') + '</div></div>';
      }).join('') : '<div class="gl-none">Ссылок пока нет</div>';
    }
    $('#gl-make').onclick = async function () {
      var b = this; b.disabled = true; $('#gl-err').textContent = '';
      var r = await o.request('POST', '/guest/links', { chat_id: o.chatId, ttl_sec: Number($('[data-sel="ttl"]').dataset.value) });
      b.disabled = false;
      if (!r.ok) { $('#gl-err').textContent = (r.data && r.data.error) || 'Не удалось создать ссылку'; return; }
      $('#gl-new').innerHTML = '<div class="gl-new"><p class="gl-note" style="color:inherit">Ссылка создана. Скопируйте её сейчас: потом она не показывается, останется только отозвать и создать новую.</p><div class="gl-grid"><input id="gl-url" readonly value="' + esc(r.data.url) + '"><button class="gl-btn" id="gl-copy">Копировать</button></div></div>';
      var url = $('#gl-url'); url.focus(); url.select();
      $('#gl-copy').onclick = function () {
        var t = this, done = function () { t.textContent = 'Скопировано'; setTimeout(function () { t.textContent = 'Копировать'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.data.url).then(done, function () { url.select(); document.execCommand('copy'); done(); });
        else { url.select(); document.execCommand('copy'); done(); }
      };
      load();
    };
    $('#gl-list').addEventListener('click', async function (e) {
      var ex = e.target.closest('[data-extend]');
      if (ex) { var sel = bg.querySelector('[data-sel="ext' + ex.dataset.extend + '"]'); ex.disabled = true; var er = await o.request('POST', '/guest/links/' + ex.dataset.extend + '/extend', { add_sec: Number(sel.dataset.value) });
        if (!er.ok) { ex.disabled = false; $('#gl-err').textContent = (er.data && er.data.error) || 'Не удалось продлить'; } else { $('#gl-err').textContent = ''; load(); } return; }
      var rv = e.target.closest('[data-revoke]'), rs = e.target.closest('[data-reset]');
      if (rv) { if (rv.dataset.sure !== '1') { rv.dataset.sure = '1'; rv.classList.add('ask'); rv.textContent = 'Точно?'; setTimeout(function () { if (rv.isConnected) { rv.dataset.sure = ''; rv.classList.remove('ask'); rv.innerHTML = IC.ban; } }, 3000); return; }
        await o.request('DELETE', '/guest/links/' + rv.dataset.revoke); load(); }
      if (rs) { var r = await o.request('POST', '/guest/links/' + rs.dataset.reset + '/reset-device'); if (!r.ok) $('#gl-err').textContent = (r.data && r.data.error) || 'Не удалось сбросить'; else load(); }
    });
    var timer = setInterval(function () {
      if (!bg.isConnected) { clearInterval(timer); return; }
      bg.querySelectorAll('.gl-tm').forEach(function (el) { el.textContent = fmtHM(Number(el.dataset.exp)); });
    }, 5000);
    load();
  }
  window.GuestLinks = { open: open };
})();
