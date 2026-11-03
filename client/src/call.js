// Окно звонка: подключение к комнате LiveKit, микрофон, камера и видео собеседника.
// Окно приложения управляет им командами (callApi.onCmd) и получает состояние (callApi.state). См. «ЗВОНКИ» в main.js.
(async function () {
  'use strict';
  const { Room, RoomEvent, Track } = window.LivekitClient;
  const $ = id => document.getElementById(id);
  const LV = $('lv');   // своё видео: в групповом звонке переезжает в плитку, поэтому ссылку держим сами
  const ICON = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
    cam: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    camOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
    screen: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    userPlus: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  };
  const svg = n => `<svg class="i" viewBox="0 0 24 24">${ICON[n]}</svg>`;
  const init = await window.callApi.init();
  if (!init) return;
  // «Через TCP»: только TURN по TLS и запрет прямых путей (если у сервера нет TURN по TLS, идём как обычно)
  if (init.tcp && window.RTCPeerConnection) {
    const O = window.RTCPeerConnection;
    const N = function (cfg, c) {
      if (cfg?.iceServers) {
        // LiveKit объявляет TURN по TLS на порту 443, а у нас он слушает 5349: пробуем оба адреса
        const srv = cfg.iceServers.map(s => { const u = [].concat(s.urls || []).filter(x => /^turns:|transport=tcp/i.test(x)), more = []; u.forEach(x => { const m = /^turns:([^:/?]+):443(\?.*)?$/i.exec(x); if (m) more.push('turns:' + m[1] + ':5349' + (m[2] || '?transport=tcp')); }); return { ...s, urls: [...u, ...more] }; }).filter(s => s.urls.length);
        if (srv.length) cfg = { ...cfg, iceTransportPolicy: 'relay', iceServers: srv };
      }
      return c !== undefined ? new O(cfg, c) : new O(cfg);
    };
    N.prototype = O.prototype; if (O.generateCertificate) N.generateCertificate = O.generateCertificate.bind(O);
    window.RTCPeerConnection = N;
  }

  document.documentElement.classList.toggle('dark', init.theme.dark);
  document.body.classList.add(init.platform === 'darwin' ? 'mac' : 'other');
  if (init.theme.accent) {
    document.documentElement.style.setProperty('--accent', init.theme.accent);
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(init.theme.accent);
    if (m) document.documentElement.style.setProperty('--accent-rgb', [1, 2, 3].map(i => parseInt(m[i], 16)).join(','));
  }
  const hue = (init.peer.id * 47) % 360;
  document.documentElement.style.setProperty('--h', String(hue));
  const initials = String(init.peer.name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('');
  $('peer').textContent = init.peer.name || 'Звонок';
  $('rn').textContent = init.peer.name || '';
  $('rav').textContent = initials;
  document.title = init.peer.name || 'Звонок';
  $('b-end').innerHTML = svg('phone') + 'Завершить';
  $('b-add').innerHTML = svg('userPlus');

  // ── состояние ──
  const st = { phase: 'connecting', mic: true, cam: false, screen: false, remoteScreen: false, remoteCam: false, remoteMic: true, quality: '', since: 0 };
  let room = null, ended = false, timer = null, hadPeer = false;
  const send = extra => window.callApi.state({ ...st, ...extra });
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = s => { const m = Math.floor(s / 60), h = Math.floor(m / 60); return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
  const note = t => { const n = $('note'); n.textContent = t || ''; n.hidden = !t; };
  const sub = t => { $('tm').textContent = t; };
  function tick() { if (st.since) sub(fmt(Math.floor((Date.now() - st.since) / 1000))); }
  // Плитки группового звонка: свой и все, кто в комнате; видео каждого — постоянный элемент, его переносим при перерисовке
  const tvids = {}; let speaking = {}, pendingList = [];
  const tvid = id => (tvids[id] = tvids[id] || Object.assign(document.createElement('video'), { autoplay: true, playsInline: true }));
  function renderGrid() {
    if (!init.group || !room) return;
    const T = Track, list = [room.localParticipant, ...room.remoteParticipants.values()], g = $('grid');
    const nScr = list.filter(p => p !== room.localParticipant && p.getTrackPublication(T.Source.ScreenShare)?.track).length;
    g.className = 'grid n' + Math.min(list.length + nScr + pendingList.length, 12);
    g.textContent = '';
    for (const p of list) {
      const self = p === room.localParticipant, cam = p.getTrackPublication(T.Source.Camera), mic = p.getTrackPublication(T.Source.Microphone);
      const camOn = !!cam && !cam.isMuted && !!cam.track, micOn = !!mic && !mic.isMuted, uid = +String(p.identity).replace(/^\D+/, '') || 0, name = self ? 'Вы' : (p.name || 'Участник');
      const t = document.createElement('div'); t.className = 'tile' + (speaking[p.identity] ? ' sp' : '') + (self ? ' self' : ''); t.dataset.id = p.identity; t.style.setProperty('--h', (uid * 47) % 360);
      t.innerHTML = `<div class="ph" ${camOn ? 'hidden' : ''}><div class="av">${esc(name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('')).toUpperCase()}</div></div><div class="nchip vg">${micOn ? '' : `<span class="mb">${svg('micOff')}</span>`}${esc(name)}</div>`;
      const v = self ? LV : tvid(p.identity); v.style.display = camOn ? '' : 'none'; v.classList.toggle('mirror', self);
      if (camOn) cam.track.attach(v);
      t.insertBefore(v, t.firstChild); g.appendChild(t);
      const scr = !self && p.getTrackPublication(T.Source.ScreenShare);
      if (scr?.track) {
        const t2 = document.createElement('div'); t2.className = 'tile scr'; t2.dataset.id = p.identity + '#s';
        const sv = tvid(p.identity + '#s'); sv.style.display = ''; scr.track.attach(sv);
        t2.innerHTML = `<div class="nchip vg">${esc(name)} · экран</div>`; t2.insertBefore(sv, t2.firstChild); g.appendChild(t2);
      }
    }
    for (const u of pendingList) {
      const t = document.createElement('div'); t.className = 'tile'; t.style.opacity = '.78'; t.style.setProperty('--h', (u.id * 47) % 360);
      t.innerHTML = `<div class="ph"><div class="av">${esc(String(u.name).split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase())}</div></div><div class="nchip vg">${esc(u.name)} · звоним…</div>`;
      g.appendChild(t);
    }
    $('peer').textContent = (init.peer.name || 'Группа') + ' · ' + list.length;
  }
  function render() {
    $('b-mic').innerHTML = svg(st.mic ? 'mic' : 'micOff'); $('b-mic').classList.toggle('off', !st.mic);
    $('b-cam').innerHTML = svg(st.cam ? 'cam' : 'camOff'); $('b-cam').classList.toggle('off', !st.cam);
    $('b-scr').innerHTML = svg('screen'); $('b-scr').classList.toggle('ac', st.screen);
    $('b-add').hidden = !(init.canAdd && st.phase === 'live');
    if (init.group) { $('remote').hidden = true; $('pip').hidden = true; $('grid').hidden = false; renderGrid(); } else {
    $('rv').style.display = st.remoteCam ? '' : 'none';
    $('rph').hidden = st.remoteCam;
    $('rmic').hidden = st.remoteMic; $('rmic').innerHTML = svg('micOff');
    LV.style.display = st.cam ? '' : 'none';
    $('lph').hidden = st.cam;
    $('pip').hidden = !st.cam; }
    const q = $('q');
    q.hidden = !st.quality || st.phase !== 'live';
    q.className = 'qchip' + ({ excellent: ' q4', good: ' q3', poor: ' q2', lost: ' q1' }[st.quality] || '');
    $('qt').textContent = { excellent: 'Отлично', good: 'Хорошо', poor: 'Слабая связь', lost: 'Связь потеряна' }[st.quality] || '';
  }
  function setPhase(p, extra) {
    st.phase = p;
    if (p === 'live' && !st.since) { st.since = Date.now(); clearInterval(timer); timer = setInterval(tick, 1000); tick(); }
    if (p === 'connecting') sub('Соединение…');
    if (p === 'waiting') sub(init.outgoing ? 'Вызов…' : 'Подключение…');
    if (p === 'reconnecting') sub('Восстановление связи…');
    render(); send(extra);
  }
  const fail = (msg, phase = 'error') => { if (ended) return; note(msg); send({ phase, error: msg }); };

  // ── камера и микрофон ──
  // Выбранные в настройках устройства: по идентификатору, а если у этого окна он другой — по названию
  const DK = { audioin: 'audioinput', audioout: 'audiooutput', videoin: 'videoinput' };
  async function devId(k) {
    const want = init.devices?.[k]; if (!want) return '';
    let list = []; try { list = await navigator.mediaDevices.enumerateDevices(); } catch {}
    const m = list.find(d => d.kind === DK[k] && d.deviceId === want.id) || (want.label && list.find(d => d.kind === DK[k] && d.label === want.label));
    return m ? m.deviceId : '';
  }
  async function setMic(on) {
    if (!room) return;
    try {
      if (on && !(await window.callApi.mediaAccess('microphone'))) throw new Error('mic_denied');
      const mid = on ? await devId('audioin') : '';
      await room.localParticipant.setMicrophoneEnabled(on, on && mid ? { deviceId: { ideal: mid } } : undefined);
      st.mic = on;
    } catch (e) { fail(on ? 'Нет доступа к микрофону. Разрешите его в настройках системы' : 'Не удалось выключить микрофон', 'warn'); }
    render(); send();
  }
  // Показ экрана: источник выбирает человек (окно со списком), остановить можно той же кнопкой
  async function setScreen(on) {
    if (!room) return;
    screenQuiet = false;
    try { await room.localParticipant.setScreenShareEnabled(on, { audio: false }); st.screen = on; }
    catch (e) { st.screen = false; if (!screenQuiet && e?.name !== 'NotAllowedError') note('Не удалось показать экран'); }
    render(); send();
  }
  window.callApi.onPickScreen(list => {
    const grid = $('pgrid'); grid.textContent = '';
    list.forEach(s => { const b = document.createElement('button'); b.className = 'pitem'; b.innerHTML = `<img alt="" src="${s.thumb}"><span>${esc(s.screen ? 'Экран · ' + s.name : s.name)}</span>`; b.onclick = () => { $('picker').hidden = true; window.callApi.screenChosen(s.id); }; grid.appendChild(b); });
    $('picker').hidden = false;
  });
  let screenQuiet = false;   // сообщение уже показано (нет разрешения) или человек отменил выбор
  window.callApi.onScreenDenied(() => { screenQuiet = true; note('Нет разрешения на запись экрана. Включите его в настройках системы: Конфиденциальность → Запись экрана'); });
  $('pcancel').onclick = () => { screenQuiet = true; $('picker').hidden = true; window.callApi.screenChosen(null); };
  async function setCam(on) {
    if (!room) return;
    try {
      if (on && !(await window.callApi.mediaAccess('camera'))) throw new Error('cam_denied');
      const cid = on ? await devId('videoin') : '';
      const pub = await room.localParticipant.setCameraEnabled(on, on && cid ? { deviceId: { ideal: cid } } : undefined);
      st.cam = on;
      const tr = pub?.track;
      if (on && tr) tr.attach(LV); else LV.srcObject = null;
      // Видео одного из двоих — повод показать окно; прячет его только закрытие
      if (on) send({ window: 'show' });
    } catch (e) { st.cam = false; fail(on ? 'Нет доступа к камере. Разрешите её в настройках системы или проверьте, что она подключена' : 'Не удалось выключить камеру', 'warn'); }
    render(); send();
  }

  function onRemoteState() {
    if (init.group) { renderGrid(); return; }
    const p = [...room.remoteParticipants.values()][0];
    if (!p) return;
    const cam = p.getTrackPublication(Track.Source.Camera), mic = p.getTrackPublication(Track.Source.Microphone);
    st.remoteCam = !!cam && !cam.isMuted && !!cam.track;
    st.remoteMic = !!mic && !mic.isMuted;
    const scr = p.getTrackPublication(Track.Source.ScreenShare);
    st.remoteScreen = !!scr && !!scr.track;
    if (st.remoteScreen) { st.remoteCam = true; scr.track.attach($('rv')); }
    else if (st.remoteCam) cam.track.attach($('rv'));
    $('rv').classList.toggle('screen', st.remoteScreen);
    if (st.remoteCam) send({ window: 'show' });
    render(); send();
  }

  async function connect() {
    render(); send();
    try {
      // Нет микрофона или доступа к нему — не повод бросать звонок: человек подключается как слушатель и видит собеседника
      const micOk = await window.callApi.mediaAccess('microphone');
      room = new Room({
        adaptiveStream: true, dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 30 } },
      });
      room
        .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
          if (track.kind === Track.Kind.Audio) { const el = track.attach(); el.dataset.sid = pub.trackSid; $('audio').appendChild(el); }
          onRemoteState();
        })
        // Видео живёт в постоянных элементах окна: убираем только звук, который создала сама библиотека
        .on(RoomEvent.TrackUnsubscribed, (track, pub) => { const els = track.detach(); if (track.kind === Track.Kind.Audio) els.forEach(el => el.remove()); onRemoteState(); })
        .on(RoomEvent.TrackUnpublished, () => setTimeout(onRemoteState, 0))
        .on(RoomEvent.TrackMuted, onRemoteState).on(RoomEvent.TrackUnmuted, onRemoteState)
        .on(RoomEvent.ParticipantConnected, () => { hadPeer = true; setPhase('live'); onRemoteState(); })
        .on(RoomEvent.ParticipantDisconnected, () => { if (init.group) { render(); return; } if (!ended) { hadPeer = true; setPhase('live', { phase: 'peer_left' }); } })
        .on(RoomEvent.LocalTrackUnpublished, pub => { if (pub.source === Track.Source.ScreenShare) { st.screen = false; render(); send(); } })
        .on(RoomEvent.ActiveSpeakersChanged, list => { speaking = {}; list.forEach(p => { speaking[p.identity] = true; }); document.querySelectorAll('.tile').forEach(t => t.classList.toggle('sp', !!speaking[t.dataset.id])); })
        .on(RoomEvent.ConnectionQualityChanged, (q, p) => { if (p !== room.localParticipant) { st.quality = q; render(); send(); } })
        .on(RoomEvent.Reconnecting, () => setPhase('reconnecting'))
        .on(RoomEvent.Reconnected, () => setPhase(room.remoteParticipants.size ? 'live' : 'waiting'))
        .on(RoomEvent.Disconnected, () => { if (!ended) fail('Соединение разорвано', 'dropped'); });
      await room.connect(init.url, init.token);
      st.mic = false;
      if (micOk) {
        try { const mid = await devId('audioin'); await room.localParticipant.setMicrophoneEnabled(true, mid ? { deviceId: { ideal: mid } } : undefined); st.mic = true; }
        catch { note('Микрофон не найден: вы только слушаете'); }
      } else note('Нет доступа к микрофону: вы только слушаете. Разрешите его в настройках системы, чтобы говорить');
      { const oid = await devId('audioout'); if (oid) { try { await room.switchActiveDevice('audiooutput', oid); } catch {} } }
      if (init.group || room.remoteParticipants.size) { hadPeer = true; setPhase('live'); onRemoteState(); } else setPhase('waiting');
      if (init.video) await setCam(true);
    } catch (e) {
      const m = String(e?.message || e);
      fail(/mic|Permission|NotAllowed|NotFound/i.test(m) ? 'Нет доступа к микрофону. Разрешите его в настройках системы' : 'Не удалось подключиться к серверу звонков');
    }
  }

  async function end() {
    if (ended) return; ended = true; clearInterval(timer);
    try { await room?.disconnect(); } catch {}
    send({ phase: 'ended' });
  }

  window.callApi.onCmd(c => {
    if (c.cmd === 'mic') setMic(c.on !== undefined ? !!c.on : !st.mic);
    else if (c.cmd === 'cam') setCam(c.on !== undefined ? !!c.on : !st.cam);
    else if (c.cmd === 'end') end();
    else if (c.cmd === 'note') note(c.text);
    else if (c.cmd === 'ungroup') { init.group = false; init.peer = { id: c.id || 0, name: c.name || '' }; pendingList = []; document.title = init.peer.name || 'Звонок'; $('peer').textContent = init.peer.name || 'Звонок'; $('rn').textContent = init.peer.name || ''; $('grid').hidden = true; $('remote').hidden = false; onRemoteState(); render(); }
    else if (c.cmd === 'pending') { pendingList = c.list || []; if (init.group) renderGrid(); }
    else if (c.cmd === 'pick') showPick(c.list || []);
    else if (c.cmd === 'group') { init.group = true; init.peer = { id: 0, name: c.name || 'Групповой звонок' }; document.title = init.peer.name; setPhase('live'); renderGrid(); }
    else if (c.cmd === 'window-closed') { if (st.cam) setCam(false); }
  });
  $('b-mic').onclick = () => setMic(!st.mic);
  $('b-cam').onclick = () => setCam(!st.cam);
  $('b-scr').onclick = () => setScreen(!st.screen);
  $('b-end').onclick = () => { send({ phase: 'end_request' }); };
  // Позвать ещё человека: список людей даёт окно приложения, выбор возвращается ему
  $('b-add').onclick = () => send({ phase: 'add_request' });
  let pickList = [];
  function fillPick() {
    const q = $('aq').value.trim().toLowerCase(), inRoom = new Set(room ? [...room.remoteParticipants.values()].map(p => p.identity) : []);
    const items = pickList.filter(u => !inRoom.has('u' + u.id) && (!q || u.name.toLowerCase().includes(q))).slice(0, 80);
    $('alist').innerHTML = items.map(u => `<button class="aitem" data-id="${u.id}" data-nm="${esc(u.name)}" style="--h:${(u.id * 47) % 360}"><span class="av">${esc(u.name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase())}</span>${esc(u.name)}</button>`).join('') || '<div class="aempty">Никого не нашли</div>';
  }
  function showPick(list) { pickList = list; $('aq').value = ''; fillPick(); $('addpick').hidden = false; $('aq').focus(); }
  $('aq').oninput = fillPick;
  $('acancel').onclick = () => { $('addpick').hidden = true; };
  $('addpick').onclick = e => { if (e.target === $('addpick')) $('addpick').hidden = true; };
  $('alist').onclick = e => { const b = e.target.closest('.aitem'); if (!b) return; $('addpick').hidden = true; send({ phase: 'add_pick', id: +b.dataset.id, name: b.dataset.nm }); };
  window.addEventListener('beforeunload', () => { try { room?.disconnect(); } catch {} });
  connect();
})();
