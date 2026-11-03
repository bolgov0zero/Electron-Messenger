'use strict';
// Голосовые сообщения: запись удержанием кнопки (как в макете docs/glass-mockup/voice.html, вариант A), плеер в ленте, отправка файла.
// Модуль общий для клиента, веб клиента и /m: разметка плеера и строка записи одинаковы, различается только то, как клиент встраивает кнопку
// и отправляет готовое вложение. Копия лежит в client/src/voice.js — править только shared/voice.js и копировать.
(function () {
  const MAX_SEC = 600, MIN_SEC = 0.8, HOLD_MIN_MS = 500, WAVE_BARS = 48;
  const CANCEL_DX = 110, LOCK_DY = 80;

  // ── значки (Lucide) ──
  const svg = p => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  const I = {
    mic: svg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
    play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    pause: svg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
    lock: svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    left: svg('<path d="m15 18-6-6 6-6"/>'),
    up: svg('<path d="m18 15-6-6-6 6"/>'),
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // ── запись ──
  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function pickMime() {
    for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return '';
  }
  // Огибающая громкости → до 48 столбиков 0..31 (самый громкий момент = 31)
  function makeWave(samples) {
    const n = WAVE_BARS;
    if (!samples.length) return Array(n).fill(4);
    const peak = Math.max(0.15, ...samples), out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * samples.length / n), b = Math.max(a + 1, Math.floor((i + 1) * samples.length / n));
      let m = 0; for (let j = a; j < b && j < samples.length; j++) m = Math.max(m, samples[j]);
      out.push(Math.max(2, Math.round(Math.min(1, m / peak) * 31)));
    }
    return out;
  }
  // Битрейт низкий намеренно: речь в Opus 16 кбит/с звучит нормально, а минута занимает около 120 КБ
  async function createRecorder(o) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const mime = pickMime(), bps = /mp4/.test(mime) ? 24000 : 16000;
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: bps } : { audioBitsPerSecond: bps }); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, an = null, buf = null;
    try {
      ctx = new AC(); const src = ctx.createMediaStreamSource(stream);
      an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); buf = new Uint8Array(an.fftSize);
    } catch { ctx = null; }
    const samples = [];
    let lvl = 0, t0 = 0, timer = 0, lastS = 0, done = false;
    function tick() {
      const now = performance.now(), el = (now - t0) / 1000;
      let target = 0.2;
      if (an) {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      }
      lvl += (target - lvl) * 0.4;
      if (now - lastS >= 80) { lastS = now; samples.push(lvl); }
      if (o && o.onLevel) o.onLevel(lvl, el, samples);
      if (el >= MAX_SEC && !done && o && o.onLimit) { done = true; o.onLimit(); }
    }
    function cleanup() {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      if (ctx) { try { ctx.close(); } catch {} }
    }
    return {
      start() { t0 = performance.now(); rec.start(500); timer = setInterval(tick, 50); },
      elapsed() { return (performance.now() - t0) / 1000; },
      stop() {
        return new Promise(resolve => {
          const dur = Math.min(MAX_SEC, (performance.now() - t0) / 1000);
          rec.onstop = () => {
            cleanup();
            const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
            resolve({ blob: new Blob(chunks, { type }), mime: type, dur, wave: makeWave(samples) });
          };
          try { rec.stop(); } catch { cleanup(); resolve(null); }
        });
      },
      cancel() { rec.onstop = null; try { if (rec.state !== 'inactive') rec.stop(); } catch {} cleanup(); },
    };
  }

  // Загрузка записи; base — «https://сервер», token — токен пользователя. Возвращает готовое вложение сообщения
  async function upload(base, token, r) {
    const dur = Math.max(1, Math.round(r.dur));
    const fd = new FormData();
    fd.append('file', r.blob, 'voice.' + (r.mime === 'audio/ogg' ? 'ogg' : r.mime === 'audio/mp4' ? 'm4a' : 'webm'));
    const res = await fetch(base + '/api/upload?voice=1&dur=' + dur, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.url) throw new Error(j.error || 'Не удалось отправить голосовое');
    return { url: j.url, name: 'voice', size: j.size, mime: j.mime, voice: { dur: j.voice && j.voice.dur ? j.voice.dur : dur, wave: r.wave } };
  }

  // ── плеер в ленте ──
  // Разметка пузыря. att — вложение с полем voice, src — полный адрес файла,
  // o: { own — своё сообщение, small — компактный вид, bars — число столбиков, meta — HTML справа (время и статус), unread — показывать точку «не прослушано», id }
  function html(att, src, o) {
    o = o || {};
    const v = att.voice || {}, dur = Math.max(1, v.dur || 1), n = o.bars || 34;
    const w = Array.isArray(v.wave) && v.wave.length ? v.wave : Array(WAVE_BARS).fill(8);
    let bars = '';
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * w.length / n), b = Math.max(a + 1, Math.floor((i + 1) * w.length / n));
      let m = 0; for (let j = a; j < b && j < w.length; j++) m = Math.max(m, w[j]);
      bars += '<i style="height:' + Math.round(5 + Math.min(1, m / 28) * 22) + 'px"></i>';
    }
    const unread = o.unread && o.id && !heard.has(String(o.id));
    return '<div class="vm ' + (o.own ? 'vm-out' : 'vm-in') + (o.small ? ' vm-sm' : '') + '" data-vsrc="' + esc(src) + '" data-vdur="' + dur + '"' + (o.id ? ' data-vid="' + esc(o.id) + '"' : '') + '>' +
      '<button class="pl" type="button" aria-label="Воспроизвести">' + I.play.replace('class="i"', 'class="i p1"') + I.pause.replace('class="i"', 'class="i p2"') + '</button>' +
      '<div class="vb"><div class="wv">' + bars + '</div>' +
      '<div class="mt"><span class="du">' + fmt(dur) + '</span>' + (unread ? '<i class="ud"></i>' : '') + '<button class="spd" type="button">' + speedLabel() + '</button>' +
      (o.meta ? '<span class="tm">' + o.meta + '</span>' : '') + '</div></div></div>';
  }
  const heard = new Set((lsGet('voice_heard', '') || '').split(',').filter(Boolean));
  const markHeard = id => {
    if (!id || heard.has(String(id))) return; heard.add(String(id));
    lsSet('voice_heard', [...heard].slice(-500).join(','));
  };
  const SPEEDS = [1, 1.5, 2];
  let speed = Math.max(1, Number(lsGet('voice_speed', '1')) || 1);
  const speedLabel = () => (speed === 1.5 ? '1,5' : speed) + '×';

  let audio = null, cur = null; // cur: { src, dur }
  const findEl = src => { for (const e of document.querySelectorAll('.vm[data-vsrc]')) if (e.dataset.vsrc === src) return e; return null; };
  function paint(el, pos, playing) {
    if (!el) return;
    const dur = Number(el.dataset.vdur) || 1, bars = el.querySelectorAll('.wv i'), k = Math.floor(Math.min(1, pos / dur) * bars.length);
    bars.forEach((b, i) => { b.classList.toggle('d', i < k); b.classList.toggle('cur', playing && i === k); });
    el.classList.toggle('playing', playing);
    if (playing || pos > 0) el.classList.add('act'); else el.classList.remove('act');
    const du = el.querySelector('.du'); if (du) du.textContent = playing || pos > 0 ? fmt(pos) : fmt(dur);
    const s = el.querySelector('.spd'); if (s) s.textContent = speedLabel();
  }
  function stopCur() {
    if (!audio || !cur) return;
    audio.pause(); paint(findEl(cur.src), 0, false); cur = null;
  }
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(); audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => { if (cur) paint(findEl(cur.src), audio.currentTime, !audio.paused); });
    audio.addEventListener('ended', () => { const el = cur && findEl(cur.src); cur = null; paint(el, 0, false); });
    audio.addEventListener('pause', () => { if (cur && !audio.ended) paint(findEl(cur.src), audio.currentTime, false); });
    return audio;
  }
  function play(el, from) {
    const a = ensureAudio(), src = el.dataset.vsrc;
    if (cur && cur.src !== src) stopCur();
    if (!cur) { cur = { src }; a.src = src; }
    if (from != null) {
      const t = Math.max(0, from);
      // У записей без заголовка длительности перемотка работает только после того, как браузер узнал длину
      const go = () => { try { a.currentTime = t; } catch {} };
      if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
    }
    a.playbackRate = speed;
    a.play().catch(() => {});
    const id = el.dataset.vid; if (id) { markHeard(id); const u = el.querySelector('.ud'); if (u) { u.classList.add('gone'); setTimeout(() => u.remove(), 300); } }
  }
  function onClick(e) {
    const el = e.target.closest && e.target.closest('.vm[data-vsrc]');
    if (!el) return;
    const pl = e.target.closest('.pl'), wv = e.target.closest('.wv'), sp = e.target.closest('.spd');
    if (!pl && !wv && !sp) return;
    e.stopPropagation();
    if (sp) {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; lsSet('voice_speed', String(speed));
      document.querySelectorAll('.vm .spd').forEach(b => { b.textContent = speedLabel(); });
      if (audio) audio.playbackRate = speed;
      return;
    }
    const src = el.dataset.vsrc, active = cur && cur.src === src;
    if (wv) {
      const r = wv.getBoundingClientRect(), f = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
      play(el, f * (Number(el.dataset.vdur) || 1));
    } else if (active && audio && !audio.paused) audio.pause();
    else play(el, null);
  }
  document.addEventListener('click', onClick, true);

  // ── кнопка записи в поле ввода ──
  // o: { btn — кнопка отправки/микрофона (с классом ready, когда в поле есть текст или вложения), field — поле (position:relative; overflow:hidden),
  //      row — содержимое поля, которое прячется на время записи, host — общий контейнер композера (position:relative),
  //      side — [элементы], которые гаснут на время записи (например, скрепка),
  //      canRecord() — можно ли записывать сейчас, onSend(result) — запись готова, onState(on) — началась/закончилась запись }
  let activeAbort = null; // отмена идущей записи: чат переключили, пока шла запись
  function mount(o) {
    if (!o.btn || o.btn._voice) return;
    o.btn._voice = true;
    const { btn, field, host } = o;
    btn.classList.add('vr-btn');
    field.classList.add('vr-field');
    if (o.row) o.row.classList.add('vr-row');
    (o.side || []).forEach(el => el && el.classList.add('vr-side'));
    btn.insertAdjacentHTML('beforeend', I.mic.replace('class="i"', 'class="i vr-mic"'));
    const bar = document.createElement('div');
    bar.className = 'vr-bar';
    bar.innerHTML = '<button type="button" class="vr-trash" aria-label="Удалить запись">' + I.trash + '</button><i class="vr-dot"></i><span class="vr-time">0:00</span>' +
      '<canvas class="vr-wave"></canvas><div class="vr-hint">' + I.left + '<span>Влево — отмена</span></div>';
    const fx = document.createElement('div'); fx.className = 'vr-fx'; fx.innerHTML = I.trash;
    field.appendChild(bar); field.appendChild(fx);
    const lock = document.createElement('div'); lock.className = 'vr-lock'; lock.innerHTML = I.lock + I.up.replace('class="i"', 'class="i u"');
    const toast = document.createElement('div'); toast.className = 'vr-toast';
    host.appendChild(lock); host.appendChild(toast);
    const q = s => bar.querySelector(s);
    const hint = q('.vr-hint'), hintTx = hint.querySelector('span'), time = q('.vr-time'), wave = q('.vr-wave');

    const abort = () => { if (st === 'rec') { btn.classList.remove('ready'); finish(false); } };
    let st = 'idle', recorder = null, hold = false, locked = false, will = false, sx = 0, sy = 0, t0 = 0, lastUp = 0, released = false, starting = false;
    const say = t => { toast.textContent = t; toast.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('on'), 2300); };
    const setCls = (c, on) => { host.classList.toggle(c, on); };

    function placeLock() {
      const hr = host.getBoundingClientRect(), br = btn.getBoundingClientRect();
      lock.style.right = (hr.right - br.right + (br.width - 44) / 2) + 'px';
      lock.style.bottom = (hr.bottom - br.top + 20) + 'px';
      toast.style.bottom = (hr.bottom - br.top + 16) + 'px';
    }
    function drawLive(samples) {
      const dpr = window.devicePixelRatio || 1, w = wave.clientWidth, h = wave.clientHeight;
      if (!w) return;
      if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) { wave.width = Math.round(w * dpr); wave.height = Math.round(h * dpr); }
      const x = wave.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      const bw = 3, gap = 3, n = Math.floor((w + gap) / (bw + gap)), vals = samples.slice(-n);
      while (vals.length < n) vals.unshift(null);
      x.fillStyle = getComputedStyle(wave).color;
      const off = w - (n * (bw + gap) - gap);
      for (let i = 0; i < n; i++) {
        const v = vals[i]; let bh, al;
        if (v == null) { bh = 3; al = 0.25; } else { bh = Math.max(4, Math.min(1, v * 1.15) * h * 0.95); al = 1; }
        x.globalAlpha = al; x.beginPath(); x.roundRect ? x.roundRect(off + i * (bw + gap), (h - bh) / 2, bw, bh, 1.5) : x.rect(off + i * (bw + gap), (h - bh) / 2, bw, bh); x.fill();
      }
      x.globalAlpha = 1;
    }
    function reset() {
      st = 'idle'; hold = false; locked = false; will = false; recorder = null; starting = false; if (activeAbort === abort) activeAbort = null;
      ['vr-rec', 'vr-hold', 'vr-lockd', 'vr-will'].forEach(c => setCls(c, false));
      host.style.setProperty('--vlvl', 0); host.style.setProperty('--vlk', 0);
      btn.style.transform = ''; hint.style.transform = ''; hint.style.opacity = ''; hint.classList.remove('cx'); hintTx.textContent = 'Влево — отмена';
      lock.classList.remove('full'); time.textContent = '0:00';
      if (o.onState) o.onState(false);
    }
    async function begin() {
      st = 'rec'; activeAbort = abort; setCls('vr-rec', true); setCls('vr-hold', true); placeLock();
      if (o.onState) o.onState(true);
      try {
        starting = true;
        const r = await createRecorder({
          onLevel(l, el, smp) {
            host.style.setProperty('--vlvl', Math.min(1, l).toFixed(3));
            time.textContent = fmt(el);
            if (locked) drawLive(smp);
          },
          onLimit() { finish(true); },
        });
        starting = false;
        if (st !== 'rec' || (released && !locked)) { r.cancel(); if (st === 'rec') { reset(); say('Удерживайте микрофон, чтобы записать голосовое'); } return; }
        recorder = r; r.start();
      } catch (e) {
        starting = false; reset();
        say(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Нет доступа к микрофону — разрешите его в настройках' : e && e.name === 'NotFoundError' ? 'Микрофон не найден' : 'Не удалось начать запись');
      }
    }
    function cancel(msg) {
      if (recorder) recorder.cancel();
      fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
      reset(); if (msg) say(msg);
    }
    async function finish(send) {
      if (st !== 'rec') return;
      if (!recorder) { cancel(); return; }
      const r = recorder; recorder = null;
      if (!send) { r.cancel(); recorder = null; cancel(); return; }
      if (r.elapsed() < MIN_SEC) { r.cancel(); cancel('Слишком короткое — запись не отправлена'); return; }
      const res = await r.stop(); reset();
      if (res && res.blob && res.blob.size) o.onSend(res);
    }

    btn.addEventListener('pointerdown', e => {
      if (st !== 'idle' || btn.classList.contains('ready') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (o.canRecord && !o.canRecord()) return;
      if (!supported()) { say('Запись голоса не поддерживается в этом браузере'); return; }
      try { btn.setPointerCapture(e.pointerId); } catch {}
      sx = e.clientX; sy = e.clientY; t0 = performance.now(); hold = true; released = false; locked = false; will = false;
      e.preventDefault(); begin();
    });
    btn.addEventListener('pointermove', e => {
      if (!hold || locked) return;
      const dx = Math.min(0, e.clientX - sx), dy = Math.min(0, e.clientY - sy), cx = dx < -CANCEL_DX, lk = Math.min(1, -dy / LOCK_DY);
      btn.style.transform = 'translate(' + dx * 0.5 + 'px,' + dy * 0.5 + 'px) scale(1.32)';
      hint.style.transform = 'translateX(' + dx * 0.55 + 'px)'; hint.style.opacity = Math.max(0.2, 1 + dx / 150);
      hint.classList.toggle('cx', cx); hintTx.textContent = cx ? 'Отпустите для отмены' : 'Влево — отмена';
      will = cx; setCls('vr-will', cx); host.style.setProperty('--vlk', lk); lock.classList.toggle('full', lk >= 1);
      if (lk >= 1 && !cx) { locked = true; setCls('vr-lockd', true); btn.style.transform = ''; btn.classList.add('ready'); say('Запись зафиксирована — можно отпустить'); }
    });
    const up = e => {
      if (!hold) return;
      lastUp = performance.now(); released = true;
      if (locked) { hold = false; setCls('vr-hold', false); btn.style.transform = ''; return; }
      hold = false;
      const cancelled = e.type === 'pointercancel' || will, short = performance.now() - t0 < HOLD_MIN_MS;
      if (starting && !recorder) return; // запись ещё запрашивает микрофон: begin() сам отменит её, увидев released
      if (cancelled) cancel(); else if (short) cancel('Удерживайте микрофон, чтобы записать голосовое'); else finish(true);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    // Нажатие на закреплённую запись: кнопка стала «Отправить»
    btn.addEventListener('click', e => {
      if (performance.now() - lastUp < 160) { e.stopImmediatePropagation(); return; }
      if (st === 'rec' && locked) { e.stopImmediatePropagation(); btn.classList.remove('ready'); finish(true); }
    }, true);
    q('.vr-trash').addEventListener('click', () => { if (st === 'rec') { btn.classList.remove('ready'); finish(false); } });
    btn.addEventListener('contextmenu', e => { if (st !== 'idle') e.preventDefault(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st === 'rec') { btn.classList.remove('ready'); finish(false); } });
    window.addEventListener('blur', () => { if (st === 'rec' && hold && !locked) { hold = false; cancel(); } });
  }

  window.Voice = { supported, mount, html, upload, fmt, stopPlayback: stopCur, cancelActive: () => { if (activeAbort) activeAbort(); }, MAX_SEC };
})();
