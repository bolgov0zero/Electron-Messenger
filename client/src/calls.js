// Звонки в окне приложения: кнопки в шапке личного чата, карточка входящего, панель идущего звонка внизу списка чатов.
// Сам разговор ведёт отдельное окно call.html (см. «ЗВОНКИ» в main.js); здесь — сигналы с сервера (/api/calls, события call_*)
// и управление окном. Только клиент Electron: веб и мобильный клиенты звонков пока не умеют.
// Вид — по макету docs/glass-mockup/calls.html.
(function () {
  'use strict';
  const IC = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  };
  IC.check = '<path d="M20 6 9 17l-5-5"/>'; IC.x = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
  const svg = (n, c = '') => `<svg class="i ${c}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = t => (typeof showActionToast === 'function' ? showActionToast(t) : console.log(t));
  const el = window.electron;
  const st = { enabled: false, call: null, incoming: null, groups: {}, prefs: { enabled: true, audio: true, video: true, fed: true } };
  let dockTimer = null, incTimer = null;

  const CSS = `
.call-btns{display:contents}
.call-card{position:fixed;right:20px;top:20px;width:340px;z-index:100000;border-radius:26px;padding:16px;display:flex;flex-direction:column;gap:14px;color:var(--text);
  background:radial-gradient(120% 80% at 0% 0%,var(--gl-spec,rgba(255,255,255,.3)),transparent 55%),var(--gl-pop);border:1px solid var(--gl-edge);
  -webkit-backdrop-filter:blur(32px) saturate(190%);backdrop-filter:blur(32px) saturate(190%);box-shadow:inset 0 1px 0 var(--gl-hi),inset 0 -1px 0 var(--gl-lo),0 24px 60px var(--gl-shadow);animation:call-in .35s cubic-bezier(.34,1.56,.64,1) both}
.call-card.out{animation:call-out .2s ease-in both}
@keyframes call-in{from{opacity:0;transform:translateY(-14px) scale(.95)}to{opacity:1;transform:none}}
@keyframes call-out{to{opacity:0;transform:translateY(-8px) scale(.96)}}
.call-card .top{display:flex;align-items:center;gap:14px;padding:2px 4px 0}
.call-card .t{min-width:0;flex:1}
.call-card .t b{display:block;font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.call-card .t small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px}
.call-ring{position:relative;display:grid;place-items:center;flex:none}
.call-ring::before,.call-ring::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:1.5px solid rgba(var(--accent-rgb),.42);animation:call-rg 2.6s ease-out infinite}
.call-ring::after{animation-delay:1.3s}
@keyframes call-rg{from{transform:scale(.9);opacity:.9}to{transform:scale(1.55);opacity:0}}
.call-row{display:flex;gap:8px}.call-row .cbtn{flex:1}
.call-col{display:flex;flex-direction:column;gap:8px}
.cbtn{height:38px;padding:0 18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;color:var(--text);
  background:var(--gl-card);border:1px solid var(--gl-edge);box-shadow:inset 0 1px 0 var(--gl-hi);transition:background .2s,transform .35s cubic-bezier(.34,1.56,.64,1),filter .2s}
.cbtn:hover{background:var(--gl-card2)}.cbtn:active{transform:scale(.95)}
.cbtn.big{height:44px;font-size:14px}
.cbtn.ok{background:linear-gradient(140deg,#3fd573,#1f9f4c);color:#fff;border-color:rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 18px rgba(31,159,76,.35)}
.cbtn.no{background:linear-gradient(140deg,#ee6060,#c42f2f);color:#fff;border-color:rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 6px 18px rgba(196,47,47,.32)}
.cbtn.ok:hover,.cbtn.no:hover{filter:brightness(1.1)}
.cbtn.no .i.hang{transform:rotate(135deg)}
.cbtn .i{font-size:16px}
#call-dock{position:absolute;left:10px;right:10px;bottom:76px;z-index:4;border-radius:20px;padding:10px 12px;display:flex;flex-direction:column;gap:10px;
  background:radial-gradient(120% 90% at 0% 0%,var(--gl-spec,rgba(255,255,255,.3)),transparent 55%),var(--gl);border:1px solid var(--gl-edge);
  -webkit-backdrop-filter:blur(26px) saturate(190%);backdrop-filter:blur(26px) saturate(190%);box-shadow:inset 0 1px 0 var(--gl-hi),0 8px 24px var(--gl-shadow)}
#call-dock .top{display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0}
#call-dock .ring{border-radius:50%;padding:2px;box-shadow:0 0 0 2px var(--accent);flex:none}
#call-dock .t{min-width:0;flex:1}
#call-dock .t b{display:block;font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#call-dock .t small{display:block;font-size:12px;font-weight:600;color:var(--accent-ink,var(--accent));font-variant-numeric:tabular-nums}
#call-dock .row{display:flex;gap:6px}
#call-dock .cbtn{height:34px;padding:0;width:40px;flex:none}
#call-dock .cbtn.off{background:var(--text);color:var(--side-bg,#fff);border-color:var(--text)}
#call-dock .cbtn.no{flex:1;width:auto;padding:0 12px}
.cl-sel{height:32px;max-width:220px;border-radius:10px;padding:0 10px;font:inherit;font-size:13px;color:var(--text);background:var(--gl-card,rgba(127,127,127,.14));border:1px solid var(--gl-edge,rgba(127,127,127,.3));outline:none}
.cl-acc{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer;border:1px solid transparent}
.cl-acc.ok{color:#1f9f4c;background:rgba(31,159,76,.14);border-color:rgba(31,159,76,.3)}.cl-acc.no{color:#d9534f;background:rgba(217,83,79,.14);border-color:rgba(217,83,79,.3)}.cl-acc .i{font-size:14px}.cl-acc[disabled]{opacity:.6}
@media (prefers-reduced-motion:reduce){.call-card,.call-ring::before,.call-ring::after{animation:none}}
`;
  function css() {
    if (document.getElementById('calls-css')) return;
    const s = document.createElement('style'); s.id = 'calls-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // ── звуки: без файлов, тоны рисуются в WebAudio ──
  let ac = null, ringTimer = null;
  function tone(freqs, dur, vol) {
    try {
      ac = ac || new AudioContext();
      freqs.forEach(f => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .03); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .05);
      });
    } catch {}
  }
  function ring(kind) {
    stopRing();
    if (typeof S !== 'undefined' && S.settings?.soundEnabled === false) return;
    const play = kind === 'in' ? () => { tone([880, 1175], .32, .07); setTimeout(() => tone([880, 1175], .32, .07), 420); } : () => tone([425], 1.0, .05);
    play(); ringTimer = setInterval(play, kind === 'in' ? 2400 : 3500);
  }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; }

  // ── вспомогательное ──
  const theme = () => ({ dark: document.documentElement.classList.contains('dark'), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() });
  // Цвет аватарки человека, как в списке чатов: берём у настоящей аватарки, чтобы окно звонка выглядело так же
  function avatarBg(id, name) {
    try {
      const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:-99px;top:-99px'; h.innerHTML = av(id, name, 'av-sm');
      document.body.appendChild(h);
      const a = h.querySelector('.av'), b = a ? getComputedStyle(a).background : '';
      h.remove(); return b;
    } catch { return ''; }
  }
  const av = (id, name, cls) => (typeof personAv === 'function' ? personAv({ id, display_name: name }, cls) : '');
  const fmt = s => { const m = Math.floor(s / 60), h = Math.floor(m / 60); return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
  const ERR = { disabled: 'Звонки не включены на сервере', offline: 'Собеседник не в сети', busy: 'Собеседник занят', in_call: 'Вы уже в звонке' };

  // ── кнопки в шапке чата ──
  function canCall(chat, peerId) {
    if (!st.enabled || !el?.callOpen || !chat || chat.is_secret) return false;
    if (!st.prefs.enabled || (!st.prefs.audio && !st.prefs.video)) return false;   // человек выключил звонки в настройках
    if (typeof isSysChat === 'function' && isSysChat(chat)) return false;
    if (chat.type === 'group') return true;
    if (chat.type === 'room') return !chat.has_topics;   // комната с подкомнатами — только «папка»: звонок идёт в самой подкомнате
    if (chat.type !== 'direct' || !peerId) return false;
    const u = (S.allUsers || []).find(x => x.id === peerId);
    return !!u && !u.is_bot;
  }
  function btnsHtml(chat, peerId) {
    if (!canCall(chat, peerId)) return '';
    // В группе уже идёт звонок: вместо двух кнопок одна «Присоединиться»
    const g = (chat.type === 'group' || chat.type === 'room') && st.groups[chat.id];
    if (g) return `<button class="icon-btn call-hd-btn call-join" title="Присоединиться к звонку" data-on-click="callStart" data-a-click="${E(JSON.stringify([chat.id, false]))}"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${IC.phone}</svg><span>Присоединиться · ${g.participants.length}</span></button>`;
    const mk = (v, t, ic) => `<button class="icon-btn call-hd-btn" title="${t}" data-on-click="callStart" data-a-click="${E(JSON.stringify([chat.id, v]))}"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${IC[ic]}</svg></button>`;
    return (st.prefs.audio ? mk(false, 'Аудиозвонок', 'phone') : '') + (st.prefs.video ? mk(true, 'Видеозвонок', 'video') : '');
  }
  // Настройка пришла уже после отрисовки шапки: кнопки вставляются в готовую шапку
  function rehead() {
    window.renderChatListSoon?.();   // отметка «идёт звонок» в списке чатов
    document.querySelectorAll('.call-hd-btn').forEach(b => b.remove());
    const box = document.querySelector('.chat-header-actions');
    if (!box || typeof S === 'undefined' || !S.activeChatId) return;
    const chat = S.chats.find(c => c.id === S.activeChatId);
    const peerId = typeof getPeerUserId === 'function' ? getPeerUserId(chat) : null;
    const h = btnsHtml(chat, peerId);
    if (h) box.insertAdjacentHTML('afterbegin', h);
  }

  // ── карточка входящего ──
  function renderIncoming() {
    document.getElementById('call-incoming')?.remove();
    clearTimeout(incTimer);
    const inc = st.incoming;
    if (!inc) return;
    // В приложении Electron карточка — отдельное окно поверх всех окон; запасной вариант — карточка внутри окна
    if (el?.callIncomingShow) {
      el.callIncomingShow({ video: !!inc.video, name: inc.group ? inc.name : inc.from.name, group: !!inc.group, conf: !!inc.conf, by: inc.from.name, count: Array.isArray(inc.participants) ? inc.participants.length : (+inc.participants || 0), bg: avatarBg(inc.from.id, inc.group ? inc.name : inc.from.name), timeout: inc.timeout || 60, theme: theme() });
      incTimer = setTimeout(() => dismissIncoming(), (inc.timeout || 45) * 1000 + 2000);
      return;
    }
    const card = document.createElement('div');
    card.id = 'call-incoming'; card.className = 'call-card';
    const acts = inc.video
      ? `<div class="call-col"><button class="cbtn ok big" data-on-click="callAccept" data-a-click="[true]">${svg('video')}Принять с видео</button><div class="call-row"><button class="cbtn" data-on-click="callAccept" data-a-click="[false]">${svg('phone')}Только звук</button><button class="cbtn no" data-on-click="callDecline">${svg('phone', 'hang')}Отклонить</button></div></div>`
      : `<div class="call-row"><button class="cbtn no" data-on-click="callDecline">${svg('phone', 'hang')}Отклонить</button><button class="cbtn ok" data-on-click="callAccept" data-a-click="[false]">${svg('phone')}Принять</button></div>`;
    card.innerHTML = `<div class="top"><div class="call-ring">${av(inc.from.id, inc.from.name, 'av-lg')}</div><div class="t"><b>${E(inc.from.name)}</b><small>Входящий ${inc.video ? 'видеозвонок' : 'аудиозвонок'}…</small></div></div>${acts}`;
    document.body.appendChild(card);
    incTimer = setTimeout(() => dismissIncoming(), (inc.timeout || 45) * 1000 + 2000);
  }
  function dismissIncoming() {
    const c = document.getElementById('call-incoming');
    st.incoming = null; clearTimeout(incTimer); stopRing();
    el?.callIncomingHide?.();
    if (!c) return;
    c.classList.add('out'); setTimeout(() => c.remove(), 220);
  }

  // ── панель идущего звонка ──
  function renderDock() {
    clearInterval(dockTimer);
    let d = document.getElementById('call-dock');
    const c = st.call;
    if (!c) { d?.remove(); return; }
    if (!d) {
      // Панель лежит над нижней панелью вкладок (она прижата к низу списка чатов)
      const side = document.querySelector('.sidebar');
      if (!side) return;
      d = document.createElement('div'); d.id = 'call-dock';
      side.appendChild(d);
    }
    const status = () => (c.phase === 'live' && c.since ? fmt(Math.max(0, Math.floor((Date.now() - c.since) / 1000))) : c.phase === 'ringing' ? 'Вызов…' : c.phase === 'reconnecting' ? 'Восстановление связи…' : 'Соединение…');
    d.innerHTML = `<div class="top" data-on-click="callOpenChat"><div class="ring">${av(c.peer.id, c.peer.name, 'av-sm')}</div><div class="t"><b>${E(c.peer.name)}</b><small id="call-dock-st">${status()}</small></div></div>
      <div class="row"><button class="cbtn ${c.mic ? '' : 'off'}" title="Микрофон" data-on-click="callToggle" data-a-click='["mic"]'>${svg(c.mic ? 'mic' : 'micOff')}</button>
      <button class="cbtn ${c.cam ? '' : 'off'}" title="Камера" data-on-click="callToggle" data-a-click='["cam"]'>${svg(c.cam ? 'video' : 'videoOff')}</button>
      <button class="cbtn no" data-on-click="callEnd">${svg('phone', 'hang')}Завершить</button></div>`;
    dockTimer = setInterval(() => { const s = document.getElementById('call-dock-st'); if (s) s.textContent = status(); }, 1000);
  }

  // ── действия ──
  // Групповой звонок: войти в идущий или начать новый
  async function joinGroup(chatId, video, name) {
    if (!st.enabled) return toast(ERR.disabled);
    if (st.call) return toast(ERR.in_call);
    const r = await api('POST', '/calls/group/join', { chat_id: chatId, video: !!video });
    if (!r || r.error) return toast({ full: 'В звонке уже много людей' }[r?.code] || r?.error || 'Не удалось присоединиться');
    const o = await el.callOpen({ devices: devAll(), tcp: localStorage.getItem('cl_udp') !== '1' && /^wss:/i.test(String(r.url)), url: r.url, certFp: r.cert_fp, token: r.token, video: !!video, group: true, outgoing: false, peer: { id: 0, name: name || 'Группа' }, theme: theme() });
    if (!o?.ok) { api('POST', `/calls/group/${r.call_id}/leave`); return toast(ERR.in_call); }
    st.call = { id: r.call_id, chatId, peer: { id: 0, name: name || 'Группа' }, group: true, video: !!video, outgoing: false, phase: 'connecting', mic: true, cam: !!video, since: 0 };
    dismissIncoming(); renderDock();
  }
  // Звонок по ссылке (/k/<токен>): сотрудник входит сразу, без подтверждения. Разговор ведёт то же окно звонка, плитка гостя с тегом
  async function joinLink(token) {
    if (!st.enabled) return toast(ERR.disabled);
    if (st.call) return toast(ERR.in_call);
    const r = await api('POST', '/calllinks/join', { token });
    if (!r || r.error) return toast(r?.error || 'Не удалось войти в звонок');
    const name = 'Видеозвонок по ссылке', video = !r.mic_only;
    const o = await el.callOpen({ devices: devAll(), tcp: localStorage.getItem('cl_udp') !== '1' && /^wss:/i.test(String(r.url)), url: r.url, certFp: r.cert_fp, token: r.token, video, group: true, outgoing: false, link: true, owner: !!r.owner, waiting: r.waiting || [], peer: { id: 0, name }, theme: theme() });
    if (!o?.ok) { api('POST', '/calllinks/leave', {}); return toast(ERR.in_call); }
    st.call = { id: r.call_id, linkId: r.link_id, link: true, owner: !!r.owner, waitN: (r.waiting || []).length, chatId: 0, peer: { id: 0, name }, group: true, video, outgoing: false, phase: 'connecting', mic: true, cam: video, since: 0 };
    dismissIncoming(); renderDock();
  }
  // Выход из звонка: у звонка по ссылке свой запрос
  const leaveReq = c => (c.link ? api('POST', '/calllinks/leave', {}) : api('POST', c.group ? `/calls/group/${c.id}/leave` : `/calls/${c.id}/end`));
  async function start(chatId, video) {
    const chat = (S.chats || []).find(c => c.id === chatId);
    if (chat?.type === 'group' || chat?.type === 'room') return joinGroup(chatId, video, chatName(chat));
    if (!st.enabled) return toast(ERR.disabled);
    if (st.call || st.incoming) return toast(ERR.in_call);
    const r = await api('POST', '/calls/start', { chat_id: chatId, video: !!video });
    if (!r || r.error) return toast(ERR[r?.code] || r?.error || 'Не удалось начать звонок');
    const o = await el.callOpen({ devices: devAll(), tcp: localStorage.getItem('cl_udp') !== '1' && /^wss:/i.test(String(r.url)), canAdd: true, url: r.url, certFp: r.cert_fp, token: r.token, video: !!video, outgoing: true, peer: r.peer, theme: theme() });
    if (!o?.ok) { api('POST', `/calls/${r.call_id}/end`); return toast(ERR.in_call); }
    st.call = { id: r.call_id, chatId, peer: r.peer, video: !!video, outgoing: true, phase: 'ringing', mic: true, cam: !!video, since: 0 };
    ring('out'); renderDock();
  }
  async function accept(withVideo) {
    const inc = st.incoming; if (!inc) return;
    if (inc.group) return joinGroup(inc.chat_id, withVideo, inc.name);
    stopRing();
    const r = await api('POST', `/calls/${inc.call_id}/accept`);
    dismissIncoming();
    if (!r || r.error) return toast('Звонок уже завершён');
    const cf = !!(r.group && r.conf), peer = cf ? { id: 0, name: 'Групповой звонок' } : inc.from;
    const o = await el.callOpen({ devices: devAll(), tcp: localStorage.getItem('cl_udp') !== '1' && /^wss:/i.test(String(r.url)), url: r.url, certFp: r.cert_fp, token: r.token, video: !!withVideo, outgoing: false, group: cf, canAdd: true, peer, theme: theme() });
    if (!o?.ok) { api('POST', `/calls/${inc.call_id}/end`); return toast(ERR.in_call); }
    st.call = { id: inc.call_id, chatId: inc.chat_id, peer, group: cf, conf: cf, video: !!withVideo, outgoing: false, phase: 'connecting', mic: true, cam: !!withVideo, since: 0 };
    renderDock();
  }
  function decline() {
    const inc = st.incoming; if (!inc) return;
    if (!inc.group) api('POST', `/calls/${inc.call_id}/decline`);
    dismissIncoming();
  }
  // Завершить: окно звонка отключается от комнаты, сервер сообщает собеседнику
  function finish(msg) {
    const c = st.call; if (!c) return;
    st.call = null; stopRing(); renderDock();
    el?.callCmd({ cmd: 'end' });
    setTimeout(() => el?.callCmd({ cmd: 'close' }), 150);
    if (msg) toast(msg);
  }
  function hangup() {
    const c = st.call; if (!c) return;
    leaveReq(c);
    finish();
  }
  function toggle(what) {
    const c = st.call; if (!c) return;
    el.callCmd({ cmd: what });   // состояние вернётся от окна звонка
    // Камера включается — окно с видео открывается само, как только пойдёт картинка
  }

  // ── события сервера ──
  function onWs(d) {
    if (d.type === 'call_incoming') {
      if (st.call || st.incoming) return;
      st.incoming = d;
      renderIncoming(); ring('in');
      if (!document.hasFocus() && el?.notify) el.notify('Входящий ' + (d.video ? 'видеозвонок' : 'аудиозвонок'), d.from.name, d.chat_id);
    } else if (d.type === 'call_config') {
      st.enabled = !!d.enabled;
      if (!st.enabled) { dismissIncoming(); if (st.call) finish('Звонки отключены на сервере'); st.groups = {}; rehead(); window.callsSettingsSync?.(); }
      else load().then(() => window.callsSettingsSync?.());
    } else if (d.type === 'call_link') {
      // Звонок по ссылке: ожидающие (администратору); событие waiting — гость ждёт, а администратора в звонке нет
      const c = st.call;
      if (d.event === 'waiting') { if (!c?.link) toast(`Гость «${d.guest?.name || ''}» ждёт входа в звонок по ссылке`); }
      else if (c?.link && c.linkId === d.link_id && Array.isArray(d.waiting)) {
        if (d.waiting.length > (c.waitN || 0)) tone([880, 1175], .25, .05);
        c.waitN = d.waiting.length; el.callCmd({ cmd: 'linkadm', waiting: d.waiting });
      }
    } else if (d.type === 'call_prefs') {
      st.prefs = d.prefs; rehead();
    } else if (d.type === 'call_audio') {
      load();   // администратор включил или выключил аудиозвонки: настройки и кнопки в шапке обновляются сразу
    } else if (d.type === 'call_group') {
      if (d.event === 'ended') { delete st.groups[d.chat_id]; if (st.incoming?.group && st.incoming.chat_id === d.chat_id) dismissIncoming(); }
      else {
        st.groups[d.chat_id] = { call_id: d.call_id, participants: d.participants, video: d.video, started_by: d.started_by };
        if (st.incoming?.group && st.incoming.chat_id === d.chat_id) st.incoming.participants = d.participants;
        if (d.event === 'started' && !st.call && !st.incoming) {
          const chat = (S.chats || []).find(c => c.id === d.chat_id), name = chat ? chatName(chat) : 'Группа';
          st.incoming = { ...d, group: true, name, timeout: 60 }; renderIncoming(); tone([880, 1175], .25, .05);
          if (!document.hasFocus() && el?.notify) el.notify('Групповой звонок', d.from.name + ' · ' + name, d.chat_id);
        }
      }
      rehead();
    } else if (d.type === 'call_conf') {
      const c = st.call; if (!c || c.id !== d.call_id) return;
      if (d.pending) { c.pending = d.pending; el.callCmd({ cmd: 'pending', list: c.pending }); }
      if (d.event === 'downgraded') { if (c.conf && c.peer0) { c.group = false; c.conf = false; c.pending = []; c.peer = c.peer0; el.callCmd({ cmd: 'ungroup', name: c.peer.name, id: c.peer.id }); renderDock(); } return; }
      if (d.event === 'upgraded' || (d.event === 'update' && !c.group)) { c.peer0 = c.peer; c.group = true; c.conf = true; c.peer = { id: 0, name: 'Групповой звонок' }; el.callCmd({ cmd: 'group', name: c.peer.name }); renderDock(); }
      else if (d.event === 'declined' || d.event === 'missed') {
        c.pending = (c.pending || []).filter(p => p.id !== d.user?.id); el.callCmd({ cmd: 'pending', list: c.pending });
        el.callCmd({ cmd: 'note', text: (d.user?.name || 'Человек') + (d.event === 'declined' ? ' отклонил(а) приглашение' : ' не ответил(а)') });
      }
      else if (d.event === 'ended') finish(d.reason === 'admin' ? 'Звонок завершён администратором' : '');
    } else if (d.type === 'call_accepted') {
      if (st.call?.id === d.call_id) { stopRing(); st.call.phase = 'connecting'; renderDock(); }
    } else if (d.type === 'call_answered') {
      if (st.incoming?.call_id === d.call_id) dismissIncoming();
    } else if (d.type === 'call_ended') {
      if (st.incoming?.call_id === d.call_id) {
        const n = st.incoming.from.name; dismissIncoming();
        if (d.reason === 'missed' || d.reason === 'cancelled') toast('Пропущенный звонок: ' + n);
      }
      if (st.call?.id === d.call_id) {
        const c = st.call;
        const why = { declined: 'Звонок отклонён', missed: 'Нет ответа', dropped: 'Связь прервана', disabled: 'Звонки отключены на сервере' }[d.reason];
        finish(d.reason === 'admin' ? 'Звонок завершён администратором' : d.reason === 'kicked' ? 'Вас исключили из звонка' : c.outgoing ? why : (d.reason === 'dropped' ? why : ''));
      }
    }
  }
  // Состояние от окна звонка
  function onState(s) {
    const c = st.call; if (!c || !s) return;
    // Показ экрана начался или закончился: отмечаем в журнале звонков
    if (typeof s.screen === 'boolean' && s.screen !== !!c.scr) { c.scr = s.screen; api('POST', `/calls/${c.id}/event`, { k: 'screen', on: s.screen }); }
    // Администратор звонка по ссылке: впустить, отклонить, исключить (запросы идут от его имени)
    if (s.phase === 'link_act') {
      if (c.link && c.owner && ['kick', 'admit', 'reject'].includes(s.path)) api('POST', `/calllinks/${c.linkId}/${s.path}`, s.body || {}).then(r => { if (r?.error) toast(r.error); });
      return;
    }
    if (s.phase === 'end_request' || s.phase === 'peer_left') return hangup();
    if (s.phase === 'closed') { leaveReq(c); st.call = null; stopRing(); renderDock(); return; }
    if (s.phase === 'error' || s.phase === 'dropped') { const m = s.error || 'Связь прервана'; leaveReq(c); return finish(m); }
    if (s.phase === 'add_request') {
      const list = (S.allUsers || []).filter(u => u.id !== S.user.id && !u.is_bot && !u.banned && u.rel !== 'chat').map(u => ({ id: u.id, name: (u.display_name || u.username) + (u.federated ? ' · ' + (u.server_name || u.server_id || 'другой сервер') : '') }));
      return el.callCmd({ cmd: 'pick', list });
    }
    if (s.phase === 'add_pick') {
      api('POST', `/calls/${c.id}/add`, { user_id: s.id }).then(r => el.callCmd({ cmd: 'note', text: !r || r.error ? (r?.error || 'Не удалось позвать') : 'Звоним: ' + (s.name || '') }));
      return;
    }
    if (s.phase === 'warn' && s.error) toast(s.error);
    if (typeof s.mic === 'boolean') c.mic = s.mic;
    if (typeof s.cam === 'boolean') c.cam = s.cam;
    if (s.phase === 'live' && c.phase !== 'live') { stopRing(); c.phase = 'live'; c.since = s.since || Date.now(); }
    else if (s.phase === 'reconnecting') c.phase = 'reconnecting';
    else if (s.phase === 'waiting' && c.phase === 'connecting') c.phase = c.outgoing ? 'ringing' : 'connecting';
    renderDock();
  }

  // ── Доступ к микрофону и камере (раздел «Звонки» в настройках) ──
  // Ответ даёт система (macOS и Windows; Linux доступ не ограничивает), наличие устройства смотрим по списку устройств
  const media = { audio: 'unknown', video: 'unknown', screen: 'granted', hasScreen: false, busy: {}, subs: [], devs: [] };
  // Выбор микрофона, динамика и камеры: хранится здесь, в окно звонка уходит вместе с id и названием (у окон идентификаторы могут отличаться)
  const DEVK = { audioin: ['audioinput', 'Микрофон'], audioout: ['audiooutput', 'Динамик'], videoin: ['videoinput', 'Камера'] };
  const devGet = k => { try { return JSON.parse(localStorage.getItem('cl_dev_' + k) || 'null'); } catch { return null; } };
  const devAll = () => { const o = {}; for (const k in DEVK) { const d = devGet(k); if (d?.id) o[k] = d; } return o; };
  function devSet(k, id) {
    try { if (!id) localStorage.removeItem('cl_dev_' + k); else { const d = media.devs.find(x => x.deviceId === id && x.kind === DEVK[k][0]); localStorage.setItem('cl_dev_' + k, JSON.stringify({ id, label: d?.label || '' })); } } catch {}
  }
  function devSelect(k) {
    const kind = DEVK[k][0], list = media.devs.filter(d => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications'), cur = devGet(k)?.id || '';
    return `<select class="cl-sel" data-cl-dev="${k}" aria-label="${DEVK[k][1]}"><option value="">По умолчанию</option>${list.map((d, i) => `<option value="${E(d.deviceId)}"${d.deviceId === cur ? ' selected' : ''}>${E(d.label || DEVK[k][1] + ' ' + (i + 1))}</option>`).join('')}</select>`;
  }
  document.addEventListener('change', e => { const t = e.target; if (t?.dataset?.clDev) { devSet(t.dataset.clDev, t.value); toast('Применится к следующему звонку'); } });
  const MEDIA_TXT = { granted: 'Доступ есть', denied: 'Доступ запрещён · нажмите', prompt: 'Не разрешён · нажмите', restricted: 'Ограничен системой', nodev: 'Устройство не найдено', unknown: 'Не проверено · нажмите' };
  const mediaTell = () => media.subs.forEach(f => { try { f(); } catch {} });
  async function mediaRefresh() {
    let os = null; try { os = await el?.callMediaStatus?.(); } catch {}
    let devs = []; try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
    const one = (osSt, devKind) => {
      if (devs.length && !devs.some(d => d.kind === devKind)) return 'nodev';
      return osSt === 'granted' ? 'granted' : osSt === 'denied' ? 'denied' : osSt === 'restricted' ? 'restricted' : osSt === 'not-determined' ? 'prompt' : 'unknown';
    };
    const sig = l => l.map(d => d.kind + d.deviceId + d.label).join('|');
    const a = one(os?.microphone, 'audioinput'), v = one(os?.camera, 'videoinput');
    const sc = os?.platform === 'darwin' ? (os.screen === 'granted' ? 'granted' : os.screen === 'denied' ? 'denied' : 'prompt') : 'granted';
    const changed = a !== media.audio || v !== media.video || sc !== media.screen || sig(devs) !== sig(media.devs);
    media.audio = a; media.video = v; media.screen = sc; media.hasScreen = os?.platform === 'darwin'; media.devs = devs; if (changed) mediaTell();
    return { audio: a, video: v };
  }
  async function mediaAsk(kind) {
    if (kind === 'screen') { media.busy.screen = true; mediaTell(); let r = null; try { r = await el?.callMediaAsk?.('screen'); } catch {} media.busy.screen = false; await mediaRefresh(); mediaTell(); if (r?.opened) toast('Открыл настройки системы: включите «Запись экрана» для приложения и перезапустите его'); return media.screen; }
    if (media[kind] === 'nodev') { toast(kind === 'video' ? 'Камера не найдена: подключите её' : 'Микрофон не найден: подключите его'); return; }
    media.busy[kind] = true; mediaTell();
    let r = null; try { r = await el?.callMediaAsk?.(kind === 'video' ? 'camera' : 'microphone'); } catch {}
    media.busy[kind] = false;
    await mediaRefresh(); mediaTell();
    if (r?.opened) toast('Открыл настройки системы: включите доступ для приложения и вернитесь сюда');
    return media[kind];
  }
  function mediaChip(kind) {
    if (kind === 'screen' && !media.hasScreen) return '';
    const s = media[kind], ok = s === 'granted', t = media.busy[kind] ? 'Запрашиваем…' : MEDIA_TXT[s] || MEDIA_TXT.unknown;
    return `<button type="button" class="cl-acc ${ok ? 'ok' : 'no'}" data-cl-media="${kind}" ${media.busy[kind] ? 'disabled ' : ''}aria-label="${kind === 'video' ? 'Камера' : kind === 'screen' ? 'Запись экрана' : 'Микрофон'}: ${t}">${svg(ok ? 'check' : 'x')}${t}</button>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest?.('[data-cl-media]'); if (b && !b.disabled) mediaAsk(b.dataset.clMedia); });
  window.addEventListener('focus', () => { if (document.querySelector('[data-cl-media]')) mediaRefresh(); });
  try { navigator.mediaDevices?.addEventListener?.('devicechange', () => mediaRefresh()); } catch {}

  // ── запуск ──
  async function load() {
    css();
    const r = await api('GET', '/calls/config');
    if (r?.prefs) st.prefs = r.prefs;
    st.groups = {}; (r?.groups || []).forEach(g => { st.groups[g.chat_id] = g; });
    st.enabled = !!r?.enabled;
    rehead(); window.callsSettingsSync?.(); mediaRefresh();
    if (!el?.callStatus) return;
    // Окно приложения могли перезагрузить посреди звонка: если звонок ещё идёт на сервере — возвращаем панель
    const cs = await el.callStatus();
    if (cs?.open && !st.call) {
      if (r?.current && !r.current.incoming) {
        st.call = { group: !!r.current.group, id: r.current.call_id, chatId: r.current.chat_id, peer: cs.peer || { id: 0, name: '' }, video: !!cs.video, outgoing: false, phase: r.current.state === 'active' ? 'live' : 'ringing', mic: cs.last?.mic !== false, cam: !!cs.last?.cam, since: cs.last?.since || Date.now() };
        renderDock();
      } else el.callCmd({ cmd: 'close' });
    }
  }
  function init() {
    if (!el?.callOpen) return;
    el.onCallState(onState);
    el.onCallIncomingAction?.(a => { if (a === 'decline') decline(); else accept(a === 'accept-video'); });
    load();
  }

  // Свои настройки звонков: enabled — все звонки, audio, video, fed — приём звонков с других серверов
  async function setPref(key, val) {
    const r = await api('PUT', '/calls/prefs', { [key]: !!val });
    if (r && !r.error) st.prefs = r;
    rehead();
    return st.prefs;
  }
  window.Calls = { joinLink, inCall: chatId => !!st.groups[chatId], available: () => st.enabled, prefs: () => st.prefs, setPref, init, load, onWs, btnsHtml, rehead, start, local: { get: k => { try { return localStorage.getItem('cl_' + k) === '1'; } catch { return false; } }, set: (k, v) => { try { v ? localStorage.setItem('cl_' + k, '1') : localStorage.removeItem('cl_' + k); } catch {} } }, devices: { select: devSelect }, media: { chip: mediaChip, refresh: mediaRefresh, ask: mediaAsk, get: () => ({ audio: media.audio, video: media.video }), hasScreen: () => media.hasScreen, onChange: f => media.subs.push(f) } };
  window.callStart = (chatId, video) => start(Number(chatId), !!video);
  window.callAccept = v => accept(!!v);
  window.callDecline = () => decline();
  window.callEnd = () => hangup();
  window.callToggle = what => toggle(what);
  window.callOpenChat = () => { const c = st.call; if (c && typeof openChat === 'function') openChat(c.chatId); };
})();
