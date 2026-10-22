// Гостевые ссылки группы или комнаты: окно создания, список, отзыв и сброс привязки к устройству.
// Общий файл: подключается в /chat, /m и клиент (копия лежит в client/src/). Окно рисуется само и берёт цвета у страницы.
//   GuestLinks.open({ chatId, chatName, request(method, path, body) → Promise<{ ok, status, data }> })
(function () {
  'use strict';
  var TTLS = [['2 часа', 7200], ['8 часов', 28800], ['Сутки', 86400], ['3 суток', 259200], ['Неделя', 604800]];
  var STATE = { pending: ['Ждёт входа', 'warn'], active: ['Активна', 'ok'], expired: ['Закончилась', 'off'], revoked: ['Отозвана', 'off'] };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var CSS = '.gl-bg{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:inherit}' +
    '.gl{background:var(--modal-bg,var(--card-bg,#fff));color:var(--text,#111);border:1px solid var(--border,rgba(127,127,127,.25));border-radius:16px;width:100%;max-width:480px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}' +
    '.gl-h{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border,rgba(127,127,127,.25))}.gl-h b{flex:1;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gl-x{background:none;border:0;color:var(--muted,#888);cursor:pointer;font-size:20px;line-height:1;padding:2px 8px;border-radius:6px}.gl-x:hover{background:var(--hover-row,rgba(127,127,127,.15))}' +
    '.gl-b{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}.gl-note{font-size:12.5px;line-height:1.5;color:var(--muted,#888)}' +
    '.gl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.gl select,.gl input{font:inherit;font-size:13.5px;color:var(--text,#111);background:var(--search-bg,rgba(127,127,127,.12));border:1px solid var(--border,rgba(127,127,127,.25));border-radius:9px;padding:8px 10px;outline:0}' +
    '.gl input{flex:1;min-width:0}.gl button.gl-btn{font:inherit;font-size:13px;font-weight:600;border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid var(--accent-border,var(--accent,#3a8));background:var(--accent-soft,rgba(60,160,140,.15));color:var(--accent,#3a8)}' +
    '.gl button.gl-btn:disabled{opacity:.5;cursor:default}.gl button.gl-btn.sub{border-color:var(--border,rgba(127,127,127,.3));background:none;color:var(--text,#111)}.gl button.gl-btn.dng{border-color:rgba(210,55,55,.4);background:none;color:#d23737}' +
    '.gl-new{border:1px solid var(--accent-border,var(--accent,#3a8));background:var(--accent-soft,rgba(60,160,140,.12));border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.gl-list{display:flex;flex-direction:column;gap:8px}.gl-it{border:1px solid var(--border,rgba(127,127,127,.25));border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}' +
    '.gl-it .t{display:flex;gap:8px;align-items:center;font-size:13.5px}.gl-it .t b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gl-it .m{font-size:12px;color:var(--muted,#888)}' +
    '.gl-chip{font-size:11px;font-weight:600;border-radius:20px;padding:2px 9px;border:1px solid var(--border,rgba(127,127,127,.3));color:var(--muted,#888)}.gl-chip.ok{color:#2e9e5b;border-color:rgba(46,158,91,.4)}.gl-chip.warn{color:#c98a12;border-color:rgba(201,138,18,.4)}' +
    '.gl-err{color:#d23737;font-size:12.5px}';

  var skew = 0;   // поправка на разницу часов компьютера и сервера
  function fmtHM(ts) {
    var s = Math.max(0, ts - Math.floor((Date.now() + skew) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  var EXT = [['1 час', 3600], ['2 часа', 7200], ['8 часов', 28800], ['Сутки', 86400], ['3 суток', 259200]];
  var fmtAt = function (ts) { return new Date(ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  function open(o) {
    if (document.querySelector('.gl-bg')) return;
    if (!document.getElementById('gl-css')) { var st = document.createElement('style'); st.id = 'gl-css'; st.textContent = CSS; document.head.appendChild(st); }
    var bg = document.createElement('div'); bg.className = 'gl-bg';
    bg.innerHTML = '<div class="gl" role="dialog" aria-label="Гостевая ссылка"><div class="gl-h"><b>Гостевая ссылка · ' + esc(o.chatName || 'чат') + '</b><button class="gl-x" aria-label="Закрыть">✕</button></div>' +
      '<div class="gl-b"><div class="gl-note">Человек без учётной записи входит по ссылке в этот чат на ограниченное время. Он пишет и отвечает, но не видит сообщений до своего входа и не может смотреть профили. Одна ссылка рассчитана на одного гостя и работает только с его устройства.</div>' +
      '<div class="gl-row"><select id="gl-ttl">' + TTLS.map(function (t, i) { return '<option value="' + t[1] + '"' + (i === 2 ? ' selected' : '') + '>' + t[0] + '</option>'; }).join('') + '</select><button class="gl-btn" id="gl-make">Создать ссылку</button><span class="gl-err" id="gl-err"></span></div>' +
      '<div id="gl-new"></div><div class="gl-list" id="gl-list"></div></div></div>';
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
          '<div class="m">Создал ' + esc(l.created_by_name || '—') + ' · до ' + fmtAt(l.expires_at) + (live ? ' · осталось <b class="gl-left" data-exp="' + l.expires_at + '">' + fmtHM(l.expires_at) + '</b>' : '') + '</div>' +
          (live ? '<div class="gl-row"><select data-ext-sel="' + l.id + '" aria-label="На сколько продлить">' + EXT.map(function (e, i) { return '<option value="' + e[1] + '"' + (i === 1 ? ' selected' : '') + '>' + e[0] + '</option>'; }).join('') + '</select><button class="gl-btn sub" data-extend="' + l.id + '">Продлить</button>' +
            (l.state === 'active' && l.bound ? '<button class="gl-btn sub" data-reset="' + l.id + '" title="Разрешить вход с нового устройства">Сбросить устройство</button>' : '') + '<button class="gl-btn dng" data-revoke="' + l.id + '">Отозвать</button></div>' : '') + '</div>';
      }).join('') : '<div class="gl-note">Ссылок пока нет.</div>';
    }
    $('#gl-make').onclick = async function () {
      var b = this; b.disabled = true; $('#gl-err').textContent = '';
      var r = await o.request('POST', '/guest/links', { chat_id: o.chatId, ttl_sec: Number($('#gl-ttl').value) });
      b.disabled = false;
      if (!r.ok) { $('#gl-err').textContent = (r.data && r.data.error) || 'Не удалось создать ссылку'; return; }
      $('#gl-new').innerHTML = '<div class="gl-new"><div class="gl-note" style="color:inherit">Ссылка создана. Скопируйте её сейчас: потом она не показывается, останется только отозвать и создать новую.</div><div class="gl-row"><input id="gl-url" readonly value="' + esc(r.data.url) + '"><button class="gl-btn" id="gl-copy">Копировать</button></div></div>';
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
      bg.querySelectorAll('.gl-left').forEach(function (el) { el.textContent = fmtHM(Number(el.dataset.exp)); });
    }, 5000);
    load();
  }
  window.GuestLinks = { open: open };
})();
