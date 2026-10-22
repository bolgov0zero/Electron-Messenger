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
    '--gl-hv:var(--hover-row,var(--fill,rgba(127,127,127,.14)));--gl-ok:var(--c-green,var(--green,#2e9e5b));--gl-bad:var(--c-red,var(--red,#d23737));--gl-wn:var(--orange,#c98a12);' +
    'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:inherit;color:var(--gl-tx)}' +
    '.gl{background:var(--gl-bg);color:var(--gl-tx);border:1px solid var(--gl-bd);border-radius:16px;width:100%;max-width:520px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden}' +
    '.gl *{box-sizing:border-box}.gl-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--gl-bd)}.gl-h .tt{flex:1;min-width:0}.gl-h b{display:block;font-size:15px}' +
    '.gl-h small{display:block;font-size:12px;color:var(--gl-mt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-x{background:none;border:0;color:var(--gl-mt);cursor:pointer;font-size:18px;line-height:1;padding:6px 9px;border-radius:8px}.gl-x:hover{background:var(--gl-hv);color:var(--gl-tx)}' +
    '.gl-b{padding:16px 18px 18px;overflow:auto;display:flex;flex-direction:column;gap:14px}.gl-note{font-size:12.5px;line-height:1.5;color:var(--gl-mt);margin:0}' +
    '.gl-sec{display:flex;flex-direction:column;gap:8px}.gl-lb{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gl-mt)}' +
    '.gl select,.gl input{font:inherit;font-size:13.5px;height:38px;color:var(--gl-tx);background:var(--gl-bg2);border:1px solid var(--gl-bd);border-radius:10px;padding:0 12px;outline:0;min-width:0;width:100%}' +
    '.gl select:focus,.gl input:focus{border-color:var(--gl-ac)}.gl option{color:#111;background:#fff}' +
    '.gl-grid{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}.gl-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.gl button.gl-btn{font:inherit;font-size:13px;font-weight:600;height:38px;border-radius:10px;padding:0 16px;cursor:pointer;white-space:nowrap;border:1px solid var(--gl-ac);background:var(--gl-acs);color:var(--gl-ac);width:100%}' +
    '.gl button.gl-btn:hover:not(:disabled){filter:brightness(1.12)}.gl button.gl-btn:disabled{opacity:.5;cursor:default}' +
    '.gl button.gl-btn.sub{border-color:var(--gl-bd);background:transparent;color:var(--gl-tx)}.gl button.gl-btn.sub:hover:not(:disabled){background:var(--gl-hv);filter:none}' +
    '.gl button.gl-btn.dng{border-color:color-mix(in srgb,var(--gl-bad) 50%,transparent);background:transparent;color:var(--gl-bad)}.gl button.gl-btn.dng:hover:not(:disabled){background:color-mix(in srgb,var(--gl-bad) 12%,transparent);filter:none}' +
    '.gl-new{border:1px solid var(--gl-ac);background:var(--gl-acs);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px}' +
    '.gl-list{display:flex;flex-direction:column;gap:10px}.gl-it{border:1px solid var(--gl-bd);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--gl-bg2)}' +
    '.gl-it .t{display:flex;gap:8px;align-items:center;font-size:14px}.gl-it .t b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-it .m{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;font-size:12px;color:var(--gl-mt);line-height:1.4}.gl-it .m div{min-width:0}' +
    '.gl-left{display:flex;flex-direction:column;align-items:flex-end;flex:none;line-height:1.1}.gl-left span{font-size:10px;text-transform:uppercase;letter-spacing:.05em}.gl-left b{font-size:22px;font-variant-numeric:tabular-nums;color:var(--gl-ac);font-weight:700}' +
    '.gl-chip{font-size:11px;font-weight:600;border-radius:20px;padding:2px 10px;border:1px solid var(--gl-bd);color:var(--gl-mt);white-space:nowrap}.gl-chip.ok{color:var(--gl-ok);border-color:color-mix(in srgb,var(--gl-ok) 45%,transparent)}.gl-chip.warn{color:var(--gl-wn);border-color:color-mix(in srgb,var(--gl-wn) 45%,transparent)}' +
    '.gl-err{color:var(--gl-bad);font-size:12.5px;min-height:0}.gl-err:empty{display:none}.gl-none{font-size:13px;color:var(--gl-mt);text-align:center;padding:10px 0}' +
    '@media (max-width:440px){.gl-grid,.gl-grid2{grid-template-columns:1fr}.gl-it .m{flex-direction:column;align-items:flex-start}.gl-left{align-items:flex-start;flex-direction:row;gap:8px;align-items:baseline}}';

  var skew = 0;   // поправка на разницу часов компьютера и сервера
  function fmtHM(ts) {
    var s = Math.max(0, ts - Math.floor((Date.now() + skew) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  var fmtAt = function (ts) { return new Date(ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var opts = function (list, sel) { return list.map(function (t, i) { return '<option value="' + t[1] + '"' + (i === sel ? ' selected' : '') + '>' + t[0] + '</option>'; }).join(''); };

  function open(o) {
    if (document.querySelector('.gl-bg')) return;
    if (!document.getElementById('gl-css')) { var st = document.createElement('style'); st.id = 'gl-css'; st.textContent = CSS; document.head.appendChild(st); }
    var bg = document.createElement('div'); bg.className = 'gl-bg';
    bg.innerHTML = '<div class="gl" role="dialog" aria-label="Гостевая ссылка"><div class="gl-h"><div class="tt"><b>Гостевая ссылка</b><small>' + esc(o.chatName || 'чат') + '</small></div><button class="gl-x" aria-label="Закрыть">✕</button></div>' +
      '<div class="gl-b"><p class="gl-note">Человек без учётной записи входит по ссылке в этот чат на время: пишет и отвечает, но не видит прошлой переписки и профилей. Одна ссылка — один гость, и работает она только с его устройства.</p>' +
      '<div class="gl-sec"><div class="gl-lb">Новая ссылка</div><div class="gl-grid"><select id="gl-ttl" aria-label="Срок ссылки">' + opts(TTLS, 2) + '</select><button class="gl-btn" id="gl-make">Создать</button></div><div class="gl-err" id="gl-err"></div></div>' +
      '<div id="gl-new"></div><div class="gl-sec"><div class="gl-lb">Ссылки</div><div class="gl-list" id="gl-list"></div></div></div></div>';
    document.body.appendChild(bg);
    var $ = function (s) { return bg.querySelector(s); };
    var close = function () { bg.remove(); document.removeEventListener('keydown', onKey, true); };
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    $('.gl-x').onclick = close;

    async function load() {
      var r = await o.request('GET', '/guest/links?chat_id=' + o.chatId);
      var box = $('#gl-list'); if (!box) return;
      if (!r.ok) { box.innerHTML = '<div class="gl-err">' + esc((r.data && r.data.error) || 'Не удалось загрузить список') + '</div>'; return; }
      var links = r.data.links || [];
      skew = r.data.now ? r.data.now * 1000 - Date.now() : 0;
      box.innerHTML = links.length ? links.map(function (l) {
        var s = STATE[l.state] || STATE.expired, live = l.state === 'pending' || l.state === 'active';
        return '<div class="gl-it"><div class="t"><b>' + esc(l.guest_name || 'Гость ещё не входил') + '</b><span class="gl-chip ' + s[1] + '">' + s[0] + '</span></div>' +
          '<div class="m"><div>Создал ' + esc(l.created_by_name || '—') + '<br>до ' + fmtAt(l.expires_at) + '</div>' +
          (live ? '<div class="gl-left"><span>Осталось</span><b class="gl-tm" data-exp="' + l.expires_at + '">' + fmtHM(l.expires_at) + '</b></div>' : '') + '</div>' +
          (live ? '<div class="gl-grid"><select data-ext-sel="' + l.id + '" aria-label="На сколько продлить">' + opts(EXT, 1) + '</select><button class="gl-btn" data-extend="' + l.id + '">Продлить</button></div>' +
            '<div class="' + (l.state === 'active' && l.bound ? 'gl-grid2' : '') + '">' + (l.state === 'active' && l.bound ? '<button class="gl-btn sub" data-reset="' + l.id + '" title="Разрешить вход с нового устройства">Сбросить устройство</button>' : '') +
            '<button class="gl-btn dng" data-revoke="' + l.id + '">Отозвать</button></div>' : '') + '</div>';
      }).join('') : '<div class="gl-none">Ссылок пока нет</div>';
    }
    $('#gl-make').onclick = async function () {
      var b = this; b.disabled = true; $('#gl-err').textContent = '';
      var r = await o.request('POST', '/guest/links', { chat_id: o.chatId, ttl_sec: Number($('#gl-ttl').value) });
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
      if (ex) { var sel = bg.querySelector('[data-ext-sel="' + ex.dataset.extend + '"]'); ex.disabled = true; var er = await o.request('POST', '/guest/links/' + ex.dataset.extend + '/extend', { add_sec: Number(sel.value) });
        if (!er.ok) { ex.disabled = false; $('#gl-err').textContent = (er.data && er.data.error) || 'Не удалось продлить'; } else { $('#gl-err').textContent = ''; load(); } return; }
      var rv = e.target.closest('[data-revoke]'), rs = e.target.closest('[data-reset]');
      if (rv) { if (rv.dataset.sure !== '1') { rv.dataset.sure = '1'; rv.textContent = 'Точно отозвать?'; setTimeout(function () { if (rv.isConnected) { rv.dataset.sure = ''; rv.textContent = 'Отозвать'; } }, 3000); return; }
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
