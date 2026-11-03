// Звонки в браузере: веб клиент (/chat) и мобильный клиент (/m). Разговор ведёт LiveKit прямо на странице;
// сервер (/api/calls, события call_*) сводит двоих и выдаёт токены. Общий файл: подключается в /chat и /m.
// Вид — по макету docs/glass-mockup/calls.html: веб клиент — карточка входящего в углу, панель звонка внизу списка чатов,
// видео в окне поверх страницы; мобильный клиент — полные экраны и зелёная полоса, когда звонок свёрнут.
//   Calls.init({ mobile, api(method, path, body) → Promise<json|null>, toast(text), avatar(id, name, size) → html,
//                openChat(chatId), sound() → bool, notify(title, body, chatId) })
//   Calls.load()  Calls.onWs(событие)  Calls.canCall(chat, peerId)  Calls.start(chatId, video)
// Браузер даёт микрофон и камеру только на https (или localhost), а страница по https не откроет ws://: нужен сервер звонков с wss://.
(function () {
  'use strict';
  var IC = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    min: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    screen: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    flip: '<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><circle cx="12" cy="12" r="3"/><path d="m18 22-3-3 3-3"/><path d="m6 2 3 3-3 3"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    userPlus: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
  };
  var svg = function (n, c) { return '<svg class="i ' + (c || '') + '" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + IC[n] + '</svg>'; };
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var H = null;
  var st = { enabled: false, secure: false, call: null, incoming: null, min: false, groups: {}, prefs: { enabled: true, audio: true, video: true, fed: true } };
  var speaking = {}, tvids = {};   // кто сейчас говорит (identity → true); видео участников группового звонка
  var room = null, LK = null, ended = false, tickT = null, incT = null, wake = null;
  var rv = null, lv = null;      // видео собеседника и своё: создаются один раз и переносятся между экранами
  var ERR = { disabled: 'Звонки не включены на сервере', offline: 'Собеседник не в сети', busy: 'Собеседник занят', in_call: 'Вы уже в звонке' };

  var CSS = '' +
    '.cl-card{position:fixed;right:20px;top:20px;width:340px;max-width:calc(100vw - 24px);z-index:100000;border-radius:26px;padding:16px;display:flex;flex-direction:column;gap:14px;color:var(--text);background:radial-gradient(120% 80% at 0% 0%,var(--gl-spec,rgba(255,255,255,.3)),transparent 55%),var(--gl-pop,var(--gl2,var(--modal-bg,#fff)));border:1px solid var(--gl-edge,rgba(255,255,255,.4));-webkit-backdrop-filter:blur(32px) saturate(190%);backdrop-filter:blur(32px) saturate(190%);box-shadow:inset 0 1px 0 var(--gl-hi,transparent),0 24px 60px var(--gl-shadow,rgba(0,0,0,.3));animation:cl-in .35s cubic-bezier(.34,1.56,.64,1) both}' +
    '.cl-card.out{animation:cl-out .2s ease-in both}@keyframes cl-in{from{opacity:0;transform:translateY(-14px) scale(.95)}to{opacity:1;transform:none}}@keyframes cl-out{to{opacity:0;transform:translateY(-8px) scale(.96)}}' +
    '.cl-top{display:flex;align-items:center;gap:14px;padding:2px 4px 0}.cl-t{min-width:0;flex:1}.cl-t b{display:block;font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cl-t small{display:block;font-size:12.5px;color:var(--text2);margin-top:3px}' +
    '.cl-ring{position:relative;display:grid;place-items:center;flex:none}.cl-ring::before,.cl-ring::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:1.5px solid rgba(var(--accent-rgb,31,168,140),.42);animation:cl-rg 2.6s ease-out infinite}.cl-ring::after{animation-delay:1.3s}.cl-ring.big::before,.cl-ring.big::after{inset:-18px}' +
    '@keyframes cl-rg{from{transform:scale(.9);opacity:.9}to{transform:scale(1.55);opacity:0}}' +
    '.cl-row{display:flex;gap:8px}.cl-row .cl-b{flex:1}.cl-col{display:flex;flex-direction:column;gap:8px}' +
    '.cl-b{height:38px;padding:0 18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;color:var(--text);background:var(--gl-card,rgba(127,127,127,.12));border:1px solid var(--gl-edge,rgba(255,255,255,.4));box-shadow:inset 0 1px 0 var(--gl-hi,transparent);transition:background .2s,transform .35s cubic-bezier(.34,1.56,.64,1),filter .2s}' +
    '.cl-b:hover{background:var(--gl-card2,rgba(127,127,127,.2))}.cl-b:active{transform:scale(.95)}.cl-b.big{height:44px;font-size:14px}' +
    '.cl-b.ok{background:linear-gradient(140deg,#3fd573,#1f9f4c);color:#fff;border-color:rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 18px rgba(31,159,76,.35)}' +
    '.cl-b.no{background:linear-gradient(140deg,#ee6060,#c42f2f);color:#fff;border-color:rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 6px 18px rgba(196,47,47,.32)}.cl-b.ok:hover,.cl-b.no:hover{filter:brightness(1.1)}' +
    '.cl-b .i{font-size:16px}.hang{transform:rotate(135deg)}' +
    // панель звонка внизу списка чатов (веб клиент)
    '#cl-dock{position:absolute;left:10px;right:10px;bottom:76px;z-index:4;border-radius:20px;padding:10px 12px;display:flex;flex-direction:column;gap:10px;background:radial-gradient(120% 90% at 0% 0%,var(--gl-spec,rgba(255,255,255,.3)),transparent 55%),var(--gl,var(--side-bg,#fff));border:1px solid var(--gl-edge,rgba(255,255,255,.4));-webkit-backdrop-filter:blur(26px) saturate(190%);backdrop-filter:blur(26px) saturate(190%);box-shadow:inset 0 1px 0 var(--gl-hi,transparent),0 8px 24px var(--gl-shadow,rgba(0,0,0,.2))}' +
    '#cl-dock .cl-top{gap:10px;cursor:pointer;padding:0}#cl-dock .ring{border-radius:50%;padding:2px;box-shadow:0 0 0 2px var(--accent);flex:none}#cl-dock .cl-t b{font-size:13.5px}#cl-dock .cl-t small{font-size:12px;font-weight:600;color:var(--accent-ink,var(--accent));margin-top:0;font-variant-numeric:tabular-nums}' +
    '#cl-dock .cl-b{height:34px;padding:0;width:40px;flex:none}#cl-dock .cl-b.off{background:var(--text);color:var(--side-bg,#fff);border-color:var(--text)}#cl-dock .cl-b.no{flex:1;width:auto;padding:0 12px}' +
    // видео: окно (веб) и экран (мобильный)
    '.cl-win{position:fixed;z-index:100001;display:flex;flex-direction:column;overflow:hidden;color:var(--text);background:var(--gl-pop,var(--gl2,var(--modal-bg,#1e252d)));border:1px solid var(--gl-edge,rgba(255,255,255,.3));-webkit-backdrop-filter:blur(32px) saturate(190%);backdrop-filter:blur(32px) saturate(190%)}' +
    '.cl-win.web{inset:12px;border-radius:30px;box-shadow:0 30px 80px rgba(0,0,0,.45)}.cl-win.mob{inset:0;border-radius:0;background:var(--gl-base,var(--bg,#12171d))}' +
    '.cl-dim{position:fixed;inset:0;z-index:100000;background:var(--scrim,rgba(0,0,0,.4));-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}' +
    '.cl-hd{height:48px;flex:none;display:grid;grid-template-columns:150px 1fr 150px;align-items:center;padding:0 14px}.cl-win.mob .cl-hd{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 22px);z-index:6;height:46px;grid-template-columns:48px 1fr 48px;padding:0 12px}' +
    '.cl-hd .c{text-align:center;min-width:0}.cl-hd b{font-size:13.5px;font-weight:700}.cl-hd small{font-size:12.5px;font-weight:600;margin-left:8px;color:var(--accent-ink,var(--accent));font-variant-numeric:tabular-nums}.cl-win.mob.v .cl-hd .c{color:#fff}.cl-win.mob.v .cl-hd small{color:#fff;opacity:.85}.cl-win.mob .cl-hd .c b,.cl-win.mob .cl-hd .c small{display:block;margin:0}' +
    '.cl-stage{position:absolute;left:12px;right:12px;top:48px;bottom:12px}.cl-win.mob .cl-stage{inset:0}' +
    '.cl-remote{position:absolute;inset:0;border-radius:22px;overflow:hidden;background:#0d1217;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}.cl-win.mob .cl-remote{border-radius:0}' +
    '.cl-remote video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}' +
    '.cl-ph{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(90% 80% at 50% 30%,hsl(var(--h,200) 22% 30%),hsl(var(--h,200) 24% 16%))}' +
    '.cl-ph[hidden]{display:none}' +
    '.cl-ph .av{width:min(30vmin,180px)!important;height:min(30vmin,180px)!important;font-size:min(10vmin,60px)!important}' +
    '.cl-pip{position:absolute;right:16px;bottom:96px;width:min(220px,28%);aspect-ratio:16/10;border-radius:16px;overflow:hidden;z-index:4;background:#0d1217;box-shadow:0 0 0 2px rgba(255,255,255,.4),0 12px 30px rgba(0,0,0,.4)}' +
    '.cl-win.mob .cl-pip{right:14px;top:calc(env(safe-area-inset-top,0px) + 80px);bottom:auto;width:100px;height:136px;aspect-ratio:auto;border-radius:20px}.cl-pip video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.cl-pip video.rear,.cl-tile video.mirror.rear{transform:none}' +
    '.cl-vg{background:rgba(14,20,26,.46);-webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);border:1px solid rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}' +
    '.cl-chip{position:absolute;left:12px;top:12px;height:28px;padding:0 12px;border-radius:999px;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#fff;z-index:3;white-space:nowrap}.cl-win.mob .cl-chip{display:none}' +
    '.cl-ctrls{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px;border-radius:999px;z-index:10}.cl-win.mob .cl-ctrls{bottom:calc(env(safe-area-inset-bottom,0px) + 24px)}' +
    '.cl-rb{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:22px;cursor:pointer;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);transition:transform .35s cubic-bezier(.34,1.56,.64,1),background .2s}.cl-rb:hover{background:rgba(255,255,255,.24)}.cl-rb:active{transform:scale(.92)}.cl-prev{position:relative;height:120px;border-radius:16px;overflow:hidden;background:#0d1217;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}.cl-prev video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.cl-rb.off{background:#fff;color:#18222b;border-color:#fff}.cl-rb.ac{background:rgba(var(--accent-rgb,31,168,140),.85);border-color:rgba(255,255,255,.3)}.cl-remote video.screen,.cl-tile.scr video{object-fit:contain!important;background:#000}' +
    '.cl-rb.end{display:inline-flex;align-items:center;justify-content:center;width:auto;padding:0 24px;gap:9px;font:inherit;font-size:14px;font-weight:700;border-radius:999px;border-color:rgba(255,255,255,.3);background:linear-gradient(140deg,#ee6060,#c42f2f);box-shadow:0 6px 18px rgba(196,47,47,.4)}.cl-rb.end .i{transform:rotate(135deg)}' +
    '.cl-hbtn{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:19px;cursor:pointer;color:var(--text);background:var(--gl-card,rgba(127,127,127,.14));border:1px solid var(--gl-edge,rgba(255,255,255,.3))}.cl-win.mob.v .cl-hbtn{color:#fff;background:rgba(14,20,26,.46);border-color:rgba(255,255,255,.2)}' +
    '.cl-win .cl-hbtn.l{justify-self:start}.cl-win .cl-hbtn.r{justify-self:end}' +
    // мобильный: экран входящего и аудиоразговора
    '.cl-full{position:fixed;inset:0;z-index:100002;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 56px) 24px calc(env(safe-area-inset-bottom,0px) + 40px);color:var(--text);background:var(--gl-base,var(--bg,#12171d));animation:cl-fade .25s ease;text-align:center}.cl-full.dark{color:#fff}' +
    '@keyframes cl-fade{from{opacity:0}to{opacity:1}}.cl-full .lbl{font-size:13.5px;font-weight:600;color:var(--text2)}.cl-full.dark .lbl{color:rgba(255,255,255,.8)}' +
    '.cl-full .nm{font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:34px}.cl-full .sub{font-size:15px;color:var(--text2);margin-top:6px;font-variant-numeric:tabular-nums}.cl-full.dark .sub{color:rgba(255,255,255,.78)}' +
    '.cl-acts{display:flex;justify-content:center;gap:34px;width:100%}.cl-win .cl-acts{gap:8px;padding:0 6px;box-sizing:border-box}.cl-win .cl-mb{flex:1 1 0;min-width:0;max-width:76px;font-size:11.5px;white-space:nowrap}.cl-win .cl-mb .rnd.sq{width:58px;height:58px;font-size:24px}.cl-mb{display:flex;flex-direction:column;align-items:center;gap:9px;font-size:12.5px;font-weight:600;color:var(--text2);cursor:pointer;background:none;border:0;font-family:inherit}.cl-full.dark .cl-mb{color:rgba(255,255,255,.85)}' +
    '.cl-mb .rnd{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;font-size:30px;color:#fff;border:1px solid rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 10px 24px rgba(0,0,0,.22)}.cl-mb .rnd.sq{width:64px;height:64px;font-size:26px}' +
    '.cl-mb .rnd.ok{background:linear-gradient(140deg,#3fd573,#1f9f4c)}.cl-mb .rnd.no{background:linear-gradient(140deg,#ee6060,#c42f2f)}.cl-mb .rnd.clg{background:var(--gl2,rgba(127,127,127,.2));color:var(--text);border-color:var(--gl-edge,rgba(255,255,255,.3))}.cl-full.dark .cl-mb .rnd.clg{background:rgba(255,255,255,.18);color:#fff}.cl-mb .rnd.off{background:var(--text);color:var(--gl-base,#fff)}' +
    '.cl-mid{display:flex;flex-direction:column;align-items:center}' +
    '#cl-bar{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 22px);height:42px;border-radius:21px;z-index:100003;display:flex;align-items:center;gap:10px;padding:0 6px 0 16px;color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;background:linear-gradient(140deg,#3fd573,#1f9f4c);box-shadow:0 8px 22px rgba(31,159,76,.4),inset 0 1px 0 rgba(255,255,255,.4)}' +
    '#cl-bar .i{font-size:16px}#cl-bar .tm{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700}#cl-bar .x{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.22)}#cl-bar .x .i{font-size:15px}' +
    '.cl-note{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);z-index:100010;max-width:86vw;padding:9px 16px;border-radius:999px;font-size:13px;font-weight:600;color:#fff;background:rgba(14,20,26,.78)}' +
    '.cl-grid{position:absolute;inset:0 0 84px 0;display:grid;gap:10px;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr}.cl-grid.n1{grid-template-columns:1fr}.cl-grid.n2,.cl-grid.n4{grid-template-columns:repeat(2,1fr)}.cl-grid.n5,.cl-grid.n6,.cl-grid.n9{grid-template-columns:repeat(3,1fr)}.cl-grid.n7,.cl-grid.n8,.cl-grid.n10,.cl-grid.n11,.cl-grid.n12{grid-template-columns:repeat(4,1fr)}' +
    '.cl-win.mob .cl-grid{inset:calc(env(safe-area-inset-top,0px) + 76px) 8px calc(env(safe-area-inset-bottom,0px) + 100px) 8px;gap:8px;grid-template-columns:repeat(2,1fr)}.cl-win.mob .cl-grid.n1{grid-template-columns:1fr}' +
    '.cl-tile{position:relative;min-height:0;min-width:0;border-radius:22px;overflow:hidden;background:#0d1217;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}.cl-tile video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.cl-tile video.mirror{transform:scaleX(-1)}' +
    '.cl-tile.sp{box-shadow:0 0 0 3px var(--accent),0 0 28px rgba(var(--accent-rgb,31,168,140),.55)}.cl-tile.self .cl-chip{background:rgba(var(--accent-rgb,31,168,140),.55)}.cl-tile .cl-chip{font-size:12px;height:26px;padding:0 10px 0 6px}.cl-tile .cl-chip:not(:has(.cl-mb2)){padding-left:10px}' +
    '.cl-mb2{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:#e04848;font-size:11px}.cl-tile .cl-ph .av,.cl-tile .cl-ph .cl-av{width:min(40%,110px)!important;height:auto!important;aspect-ratio:1;font-size:min(8vmin,34px)!important}' +
    '.cl-join{width:auto!important;padding:0 14px!important;gap:6px;border-radius:999px!important;color:#fff!important;background:linear-gradient(140deg,#3fd573,#1f9f4c)!important;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center}.cl-join span{white-space:nowrap}' +
    '#cl-pick{position:fixed;inset:0;z-index:100020;display:flex;align-items:center;justify-content:center;background:var(--scrim,rgba(0,0,0,.45));-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}' +
    '#cl-pick .pk{width:360px;max-width:calc(100vw - 24px);max-height:min(560px,80vh);display:flex;flex-direction:column;border-radius:26px;padding:16px;gap:10px;color:var(--text);background:var(--gl-pop,var(--gl2,var(--modal-bg,#1e252d)));border:1px solid var(--gl-edge,rgba(255,255,255,.3));box-shadow:0 30px 80px rgba(0,0,0,.45)}' +
    '#cl-pick.mob{align-items:flex-end}#cl-pick.mob .pk{width:100%;max-width:none;border-radius:26px 26px 0 0;max-height:78vh;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 16px)}' +
    '#cl-pick h4{margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:space-between}#cl-pick h4 button{width:32px;height:32px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer;color:var(--text);background:var(--gl-card,rgba(127,127,127,.16))}' +
    '#cl-pick input{height:40px;border-radius:999px;border:1px solid var(--gl-edge,rgba(255,255,255,.3));background:var(--gl-card,rgba(127,127,127,.12));color:var(--text);padding:0 16px;font:inherit;font-size:14px;outline:none}' +
    '#cl-pick .ls{overflow:auto;display:flex;flex-direction:column;gap:2px;min-height:60px}#cl-pick .it{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:16px;cursor:pointer;border:0;background:none;color:inherit;font:inherit;text-align:left}#cl-pick .it:hover{background:var(--gl-card,rgba(127,127,127,.16))}#cl-pick .it b{font-size:14px;font-weight:600}#cl-pick .em{padding:22px 8px;text-align:center;font-size:13px;color:var(--text2)}' +
    '#cl-diag{position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 104px);z-index:100030;background:rgba(0,0,0,.78);color:#fff;font:11.5px/1.55 ui-monospace,Menlo,monospace;padding:9px 11px;border-radius:12px;white-space:pre-wrap;pointer-events:none}' +
    '.cl-sel{height:32px;max-width:220px;border-radius:10px;padding:0 10px;font:inherit;font-size:13px;color:var(--text);background:var(--gl-card,rgba(127,127,127,.14));border:1px solid var(--gl-edge,rgba(127,127,127,.3));outline:none}' +
    '.cl-acc{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer;border:1px solid transparent}.cl-acc.ok{color:#1f9f4c;background:rgba(31,159,76,.14);border-color:rgba(31,159,76,.3)}.cl-acc.no{color:#d9534f;background:rgba(217,83,79,.14);border-color:rgba(217,83,79,.3)}.cl-acc .i{font-size:14px}.cl-acc[disabled]{opacity:.6}' +
    '@media (prefers-reduced-motion:reduce){.cl-card,.cl-full,.cl-ring::before,.cl-ring::after{animation:none}}';
  function css() { if (document.getElementById('cl-css')) return; var s = document.createElement('style'); s.id = 'cl-css'; s.textContent = CSS; document.head.appendChild(s); }

  // ── звуки ──
  var ac = null, ringT = null;
  function tone(freqs, dur, vol) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      freqs.forEach(function (f) {
        var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .03); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + .05);
      });
    } catch (e) {}
  }
  function ring(kind) {
    stopRing();
    if (H.sound && H.sound() === false) return;
    var play = kind === 'in' ? function () { tone([880, 1175], .32, .07); setTimeout(function () { tone([880, 1175], .32, .07); }, 420); } : function () { tone([425], 1.0, .05); };
    play(); ringT = setInterval(play, kind === 'in' ? 2400 : 3500);
  }
  // Звуки вызова играет WebAudio: после вызова контекст закрываем, иначе на iPhone он держит свой маршрут звука и голос собеседника идёт сразу в два динамика
  // Режим «Звук через Web Audio» (для iPhone и iPad, если голос идёт сразу из двух динамиков): удалённый звук играет не элементом audio, а через AudioContext.
  // Контекст создаём при нажатии (до запроса микрофона), как советуют разработчики в багах WebKit про маршрут звука
  var waCtx = null, waNodes = {}, waDst = null, waEl = null, twoClones = {};
  function waOn() { var v = null; try { v = localStorage.getItem('cl_wa'); } catch (e) {} return v === null ? (isIOS && canSink()) : v === '1'; }
  function waInit() { if (!waOn()) return; try { waCtx = waCtx || new (window.AudioContext || window.webkitAudioContext)(); if (waCtx.state === 'suspended') waCtx.resume(); } catch (e) {} }
  // Не напрямую в динамики, а через скрытый элемент audio: на iOS 26 ему можно выбрать «трубку» через setSinkId
  function waEnsureEl() {
    waInit(); if (!waCtx) return null;
    waDst = waDst || waCtx.createMediaStreamDestination();
    if (!waEl) { waEl = document.createElement('audio'); waEl.autoplay = true; waEl.setAttribute('playsinline', ''); waEl.dataset.cl = 'wa'; waEl.srcObject = waDst.stream; document.body.appendChild(waEl); }
    return waEl;
  }
  // Аудиозвонок на iPhone по умолчанию идёт в трубку: setSinkId разрешён только прямо в обработчике нажатия, поэтому вызываем его сразу при нажатии,
  // пока ничего не ждали. Номер трубки запоминается после первого выбора кнопкой «Трубка»
  var pendingSpk = null;
  function prepEarpiece() { pendingSpk = null; }
  var holdMic = null, sinkLog = [];
  function sinkNote(t) { sinkLog.push(t); if (sinkLog.length > 5) sinkLog.shift(); }
  // Микрофон, полученный при нажатии, держим включённым до тех пор, пока его не подхватит LiveKit: пока захват идёт, iOS остаётся в режиме звонка
  // и выбор трубки не сбрасывается (если отпустить микрофон сразу, режим меняется на «медиа», и громкая связь возвращается)
  function releaseMic() { if (holdMic) { try { holdMic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} holdMic = null; } }
  // Если номера трубки ещё нет (первый звонок): после разрешения микрофона список устройств с названиями уже виден, ищем трубку и пробуем выбрать её сразу,
  // пока нажатие «свежее». Не вышло — человек один раз нажмёт «Трубка» в звонке, и номер запомнится
  async function earpieceNow() {
    if (pendingSpk === 'receiver' || !isIOS || !canSink() || !waOn()) return;
    var id = ''; try { id = localStorage.getItem('cl_recv') || ''; } catch (e) {}
    if (!id) {
      await mediaRefresh();
      var r = (media.devs || []).filter(function (d) { return d.kind === 'audiooutput' && /receiver|earpiece|iphone|трубк|приём|приемн|разговор/i.test(d.label || ''); })[0];
      if (!r) { sinkNote('трубка в списке не найдена'); return; }
      id = r.deviceId; try { localStorage.setItem('cl_recv', id); } catch (e) {}
    }
    var el = waEnsureEl(); if (!el || !el.setSinkId) return;
    try { await el.setSinkId(id); pendingSpk = 'receiver'; sinkNote('при нажатии: трубка выбрана'); } catch (e) { pendingSpk = null; sinkNote('при нажатии: ' + (e && e.name || e)); }
  }
  // Когда голос собеседника уже пошёл и микрофон захвачен, подтверждаем выбор повторно (без переключения туда-сюда: если система не примет, остаётся как есть)
  var earDone = false;
  function reapplyEarpiece() {
    var c = st.call, id = ''; try { id = localStorage.getItem('cl_recv') || ''; } catch (e) {}
    if (earDone || !c || c.spk !== 'receiver' || !id || !waEl || !waEl.setSinkId) return;
    // Повторный выбор того же динамика система считает «ничего не изменилось» и маршрут не обновляет (поэтому помогало «громко → трубка»):
    // переключаем на системный и сразу обратно на трубку, когда голос уже идёт
    var el = waEl;
    el.setSinkId('').then(function () {
      return el.setSinkId(id).then(function () { earDone = true; sinkNote('переключение туда-обратно: ок'); }, function (e) { sinkNote('назад в трубку: ' + (e && e.name || e)); if (st.call) { st.call.spk = 'speaker'; render(); } });
    }, function (e) { sinkNote('на системный: ' + (e && e.name || e)); });
  }
  function waAttach(track) {
    try {
      waInit(); if (!waCtx) return false;
      var src = waCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])), g = waCtx.createGain();
      waEnsureEl();
      src.connect(g); g.connect(waDst); waNodes[track.sid] = [src, g]; var pl = waEl.play(); if (pl && pl.catch) pl.catch(function () {}); return true;
    } catch (e) { return false; }
  }
  function waDetach(sid) { var n = waNodes[sid]; if (n) { try { n[0].disconnect(); n[1].disconnect(); } catch (e) {} delete waNodes[sid]; } }
  function waClose() { Object.keys(waNodes).forEach(waDetach); try { if (waEl) waEl.remove(); } catch (e) {} waEl = null; waDst = null; try { if (waCtx) waCtx.close(); } catch (e) {} waCtx = null; Object.keys(twoClones).forEach(function (k) { try { twoClones[k].stop(); } catch (e) {} }); twoClones = {}; }
  function closeAc() { try { if (ac) ac.close(); } catch (e) {} ac = null; }
  // Забытые слои звонка (после сна страницы, после уведомления) перехватывают нажатия на весь экран: снимаем всё, чего уже нет в состоянии
  function sweep() {
    if (!st.call) ['cl-dock', 'cl-win', 'cl-dim', 'cl-bar', 'cl-full'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); });
    if (!st.incoming) document.querySelectorAll('#cl-incoming').forEach(function (e) { e.remove(); });
    document.querySelectorAll('.cl-note').forEach(function (n) { if (!n.dataset.t) n.dataset.t = Date.now(); else if (Date.now() - n.dataset.t > 6000) n.remove(); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sweep(); });
  window.addEventListener('pageshow', sweep); window.addEventListener('focus', sweep);
  setInterval(sweep, 2500);
  function stopRing() { clearInterval(ringT); ringT = null; closeAc(); }
  // Разрешение на микрофон (и камеру) просим сразу при нажатии «Позвонить» или «Принять», пока человек смотрит на экран: в Safari оно запрашивается
  // заново при каждой загрузке страницы, и запрос посреди соединения легко пропустить, тогда звонок так и не соединяется
  async function ensureMedia(video) {
    waInit(); prepEarpiece();
    if (!hasMedia()) return true;
    try { releaseMic(); holdMic = await navigator.mediaDevices.getUserMedia({ audio: true }); var hm = holdMic; setTimeout(function () { if (holdMic === hm) releaseMic(); }, 20000); }
    catch (e) {
      // Микрофона нет или доступ не дали: звонок всё равно идёт, человек видит и слышит собеседника
      H.toast(/NotAllowed|Security|Permission/i.test(e && e.name || '') ? (H.mobile ? 'Нет доступа к микрофону: вы только слушаете. Разрешите его в настройках телефона для этого сайта, чтобы говорить' : 'Нет доступа к микрофону: вы только слушаете. Нажмите на значок замка в адресной строке и разрешите его, чтобы говорить') : 'Микрофон не найден: вы только слушаете');
    }
    if (!video) { try { await earpieceNow(); } catch (e) {} }
    if (video) { try { var v = await navigator.mediaDevices.getUserMedia({ video: true }); v.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    return true;
  }

  var fmt = function (s) { var m = Math.floor(s / 60), h = Math.floor(m / 60); return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
  var hue = function (id) { return (id * 47) % 360; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function hasMedia() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function status() { var c = st.call; return !c ? '' : c.phase === 'live' && c.since ? fmt(Math.max(0, Math.floor((Date.now() - c.since) / 1000))) : c.phase === 'ringing' ? 'Вызов…' : c.phase === 'reconnecting' ? 'Восстановление связи…' : 'Соединение…'; }
  function note(t) { var n = document.createElement('div'); n.className = 'cl-note'; n.textContent = t; document.body.appendChild(n); setTimeout(function () { n.remove(); }, 4500); }

  // ── кнопки в шапке чата (веб клиент) ──
  function canCall(chat, peerId) {
    if (!st.enabled || !st.secure || !hasMedia() || !chat || chat.is_secret || chat.system_kind) return false;
    if (!st.prefs.enabled || (!st.prefs.audio && !st.prefs.video)) return false;   // человек выключил звонки в настройках
    if (chat.type === 'group') return true;
    if (chat.type === 'room') return !chat.has_topics;   // комната с подкомнатами — только «папка»: звонок идёт в самой подкомнате
    return chat.type === 'direct' && !!peerId;
  }
  function btns(chat, peerId) {
    if (!canCall(chat, peerId)) return '';
    // В группе уже идёт звонок: вместо двух кнопок одна «Присоединиться»
    var g = (chat.type === 'group' || chat.type === 'room') && st.groups[chat.id];
    if (g) return '<button class="icon-btn call-hd-btn cl-join" title="Присоединиться к звонку" data-on-click="callStart" data-a-click="' + E(JSON.stringify([chat.id, false])) + '"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">' + IC.phone + '</svg><span>Присоединиться · ' + g.participants.length + '</span></button>';
    var mk = function (v, t, ic) { return '<button class="icon-btn call-hd-btn" title="' + t + '" data-on-click="callStart" data-a-click="' + E(JSON.stringify([chat.id, v])) + '"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">' + IC[ic] + '</svg></button>'; };
    return (st.prefs.audio ? mk(false, 'Аудиозвонок', 'phone') : '') + (st.prefs.video ? mk(true, 'Видеозвонок', 'video') : '');
  }

  // ── карточка входящего ──
  function renderIncoming() {
    var old = document.getElementById('cl-incoming'); if (old) old.remove();
    clearTimeout(incT);
    var inc = st.incoming; if (!inc) return;
    var el = document.createElement('div'); el.id = 'cl-incoming';
    var vid = !!inc.video && st.prefs.video !== false, mob = H.mobile, grp = !!inc.group;
    var who = grp ? inc.name : inc.from.name;
    var lab = grp ? (vid ? 'Групповой видеозвонок' : 'Групповой аудиозвонок') : inc.conf ? 'Зовут в ' + (vid ? 'видеозвонок' : 'аудиозвонок') : 'Входящий ' + (vid ? 'видеозвонок' : 'аудиозвонок');
    var sub = grp ? E(inc.from.name) + ' начал звонок · в нём ' + inc.participants.length : inc.conf ? 'Уже говорят ' + inc.participants : '';
    var yes = grp ? 'Присоединиться' : 'Принять', no = grp ? 'Не сейчас' : 'Отклонить';
    if (mob) {
      el.className = 'cl-full' + (vid ? ' dark' : '');
      el.innerHTML = '<div class="lbl">' + lab + (grp ? '' : '') + '</div>' +
        '<div class="cl-mid"><div class="cl-ring big">' + H.avatar(inc.from.id, who, 140) + '</div><div class="nm">' + E(who) + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
        '<div class="cl-acts"><button class="cl-mb" data-cl="decline"><span class="rnd no">' + svg(grp ? 'x' : 'phone', grp ? '' : 'hang') + '</span>' + no + '</button>' +
        (vid ? '<button class="cl-mb" data-cl="audio"><span class="rnd clg">' + svg('phone') + '</span>Только звук</button>' : '') +
        '<button class="cl-mb" data-cl="' + (vid ? 'video' : 'audio') + '"><span class="rnd ok">' + svg(vid ? 'video' : 'phone') + '</span>' + yes + '</button></div>';
    } else {
      el.className = 'cl-card';
      el.innerHTML = '<div class="cl-top"><div class="cl-ring">' + H.avatar(inc.from.id, who, 56) + '</div><div class="cl-t"><b>' + E(who) + '</b><small>' + (grp ? lab + '<br>' + sub : lab + '…') + '</small></div></div>' +
        (vid ? '<div class="cl-col"><button class="cl-b ok big" data-cl="video">' + svg('video') + (grp ? 'Присоединиться с видео' : 'Принять с видео') + '</button><div class="cl-row"><button class="cl-b" data-cl="audio">' + svg('phone') + 'Только звук</button><button class="cl-b ' + (grp ? '' : 'no') + '" data-cl="decline">' + (grp ? '' : svg('phone', 'hang')) + no + '</button></div></div>'
          : '<div class="cl-row"><button class="cl-b ' + (grp ? '' : 'no') + '" data-cl="decline">' + (grp ? '' : svg('phone', 'hang')) + no + '</button><button class="cl-b ok" data-cl="audio">' + svg('phone') + yes + '</button></div>');
    }
    document.body.appendChild(el);
    if (H.decorate) H.decorate(el);
    if (vid && !mob) camPreview(el);
    incT = setTimeout(dismissIncoming, ((inc.timeout || (inc.group ? 60 : 45)) + 2) * 1000);
  }
  // Предпросмотр своей камеры в карточке видеозвонка: только если доступ уже разрешён, чтобы не вызывать запрос на ровном месте
  var prevStream = null;
  function stopPreview() { if (prevStream) { prevStream.getTracks().forEach(function (t) { t.stop(); }); prevStream = null; } }
  function camPreview(card) {
    if (!navigator.permissions || !hasMedia()) return;
    navigator.permissions.query({ name: 'camera' }).then(function (p) {
      if (p.state !== 'granted' || !document.body.contains(card)) return;
      return navigator.mediaDevices.getUserMedia({ video: true }).then(function (s) {
        if (!document.body.contains(card)) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        prevStream = s;
        var box = document.createElement('div'); box.className = 'cl-prev'; var v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = s; box.appendChild(v);
        card.insertBefore(box, card.querySelector('.cl-col, .cl-row'));
      });
    }).catch(function () {});
  }
  function dismissIncoming() {
    stopPreview();
    var c = document.getElementById('cl-incoming');
    st.incoming = null; clearTimeout(incT); stopRing();
    if (!c) return;
    if (H.mobile) c.remove(); else { c.classList.add('out'); setTimeout(function () { c.remove(); }, 220); }
  }

  // ── экран идущего звонка ──
  function ensureVideos() {
    if (rv) return;
    rv = document.createElement('video'); rv.autoplay = true; rv.playsInline = true; rv.setAttribute('playsinline', '');
    lv = document.createElement('video'); lv.autoplay = true; lv.muted = true; lv.playsInline = true; lv.setAttribute('playsinline', '');
  }
  // Плитки группового звонка: свой и все, кто в комнате. Видео каждого — один постоянный элемент, его переносим при перерисовке
  function tv(id) {
    if (!tvids[id]) { var v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', ''); tvids[id] = v; }
    return tvids[id];
  }
  var idOf = function (identity) { return +String(identity || '').replace(/^\D+/, '') || 0; };
  function fillGrid(grid) {
    if (!grid || !room || !LK) return;
    var T = LK.Track, list = [room.localParticipant].concat(Array.from(room.remoteParticipants.values())), n = list.length;
    list.forEach(function (p) { if (p !== room.localParticipant) { var sp = p.getTrackPublication(T.Source.ScreenShare); if (sp && sp.track) n++; } });
    var pend = (st.call && st.call.pending) || []; n += pend.length;
    grid.className = 'cl-grid n' + Math.min(n, 12);
    list.forEach(function (p) {
      var self = p === room.localParticipant, cam = p.getTrackPublication(T.Source.Camera), mic = p.getTrackPublication(T.Source.Microphone);
      var camOn = !!cam && !cam.isMuted && !!cam.track, micOn = !!mic && !mic.isMuted, uid = idOf(p.identity), name = self ? 'Вы' : (p.name || 'Участник');
      if (st.call && (st.call.fedGroup || st.call.mix || st.call.fed)) uid = 0;   // номера людей чужого сервера у нас означают других людей: аватарки и фото только по имени
      var t = document.createElement('div'); t.className = 'cl-tile' + (speaking[p.identity] ? ' sp' : '') + (self ? ' self' : ''); t.dataset.id = p.identity; t.style.setProperty('--h', hue(uid));
      t.innerHTML = '<div class="cl-ph" ' + (camOn ? 'hidden' : '') + '>' + H.avatar(uid, name, 120) + '</div><div class="cl-chip cl-vg" style="display:flex;left:10px;top:auto;bottom:10px">' + (micOn ? '' : '<span class="cl-mb2">' + svg('micOff') + '</span>') + E(name) + '</div>';
      var v = self ? lv : tv(p.identity); v.style.display = camOn ? '' : 'none'; v.classList.toggle('mirror', self);
      if (camOn) { try { cam.track.attach(v); } catch (e) {} }
      t.insertBefore(v, t.firstChild);
      grid.appendChild(t);
      // Показ экрана участника — отдельная плитка рядом с его камерой
      var scr = !self && p.getTrackPublication(T.Source.ScreenShare);
      if (scr && scr.track) {
        var st2 = document.createElement('div'); st2.className = 'cl-tile scr'; st2.dataset.id = p.identity + '#s';
        var sv = tv(p.identity + '#s'); sv.style.display = ''; try { scr.track.attach(sv); } catch (e) {}
        st2.innerHTML = '<div class="cl-chip cl-vg" style="display:flex;left:10px;top:auto;bottom:10px">' + E(name) + ' · экран</div>'; st2.insertBefore(sv, st2.firstChild); grid.appendChild(st2);
      }
    });
    pend.forEach(function (u) {
      var t = document.createElement('div'); t.className = 'cl-tile'; var pid = st.call && (st.call.mix || st.call.fed) ? 0 : u.id; t.style.setProperty('--h', hue(pid)); t.style.opacity = '.78';
      t.innerHTML = '<div class="cl-ph">' + H.avatar(pid, u.name, 120) + '</div><div class="cl-chip cl-vg" style="display:flex;left:10px;top:auto;bottom:10px">' + E(u.name) + ' · звоним…</div>';
      grid.appendChild(t);
    });
  }
  // Позвать ещё человека можно в разговоре двоих и в звонке, который уже стал общим; в группе чата люди входят сами, на чужом сервере не звонят
  function canAdd(c) { return !!(c && c.phase === 'live' && !c.fedGroup && (c.conf || !c.group) && H.contacts); }
  function canSpk() { return !!NA || (isIOS && canSink()); }
  function spkBtn(c) { return canSpk() ? '<button class="cl-rb ' + (c.spk === 'receiver' ? 'ac' : '') + '" data-cl="spk" aria-label="Трубка или громкая связь">' + svg('volume') + '</button>' : ''; }
  function ctrlsHtml(c) {
    return spkBtn(c) + '<button class="cl-rb ' + (c.mic ? '' : 'off') + '" data-cl="mic" aria-label="Микрофон">' + svg(c.mic ? 'mic' : 'micOff') + '</button>' +
      (c.micOnly ? '' : '<button class="cl-rb ' + (c.cam ? '' : 'off') + '" data-cl="cam" aria-label="Камера">' + svg(c.cam ? 'video' : 'videoOff') + '</button>') +
      (!H.mobile && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? '<button class="cl-rb ' + (c.screen ? 'ac' : '') + '" data-cl="screen" aria-label="Показать экран" title="Показать экран">' + svg('screen') + '</button>' : '') +
      (canAdd(c) ? '<button class="cl-rb" data-cl="add" aria-label="Добавить в звонок" title="Добавить в звонок">' + svg('userPlus') + '</button>' : '') +
      '<button class="cl-rb end" data-cl="end">' + svg('phone') + (H.mobile ? '' : 'Завершить') + '</button>';
  }
  // Список людей: выбрали — человеку приходит звонок, а разговор становится общим
  function closePick() { var p = document.getElementById('cl-pick'); if (p) p.remove(); }
  function pickList(q) {
    var c = st.call, ls = document.querySelector('#cl-pick .ls'); if (!c || !ls) return;
    var inRoom = {}; if (room) { inRoom['u' + (H.selfId ? H.selfId() : 0)] = 1; room.remoteParticipants.forEach(function (p) { inRoom[p.identity] = 1; }); }
    q = String(q || '').trim().toLowerCase();
    var list = (H.contacts() || []).filter(function (u) { return !inRoom['u' + u.id] && (!q || String(u.name).toLowerCase().indexOf(q) >= 0); }).slice(0, 80);
    ls.innerHTML = list.map(function (u) { return '<button class="it" data-cl="padd" data-id="' + u.id + '" data-nm="' + E(u.name) + '">' + H.avatar(u.id, u.name, 36) + '<b>' + E(u.name) + '</b></button>'; }).join('') || '<div class="em">Никого не нашли</div>';
    if (H.decorate) H.decorate(ls);
  }
  function openPick() {
    if (!canAdd(st.call) || document.getElementById('cl-pick')) return;
    var p = document.createElement('div'); p.id = 'cl-pick'; if (H.mobile) p.className = 'mob';
    p.innerHTML = '<div class="pk"><h4>Добавить в звонок<button data-cl="pclose" aria-label="Закрыть">' + svg('x') + '</button></h4><input type="search" placeholder="Найти человека" autocomplete="off"><div class="ls"></div></div>';
    p.addEventListener('click', function (e) { if (e.target === p) closePick(); });
    document.body.appendChild(p); pickList('');
    var inp = p.querySelector('input'); inp.addEventListener('input', function () { pickList(inp.value); }); if (!H.mobile) inp.focus();
  }
  async function addPerson(id, name) {
    var c = st.call; if (!c) return; closePick();
    var r = await H.api('POST', '/calls/' + c.id + '/add', { user_id: id });
    if (!r || r.error) return H.toast((r && r.error) || 'Не удалось позвать');
    H.toast('Звоним: ' + (name || r.user && r.user.name || ''));
  }
  // Звонок двоих стал общим: тот же разговор, экран меняется на сетку
  function dropPending(c, u) { if (c.pending && u) c.pending = c.pending.filter(function (p) { return p.id !== u.id; }); }
  function toConf(c, names) {
    if (c.group) return;
    c.peer0 = c.peer; c.group = true; c.conf = true; c.peer = { id: 0, name: 'Групповой звонок' };
    if (c.phase !== 'live') { c.phase = 'live'; c.since = c.since || Date.now(); }
    stopRing(); render();
  }
  function render() {
    clearInterval(tickT);
    var c = st.call, dock = document.getElementById('cl-dock'), win = document.getElementById('cl-win'), dim = document.getElementById('cl-dim'), bar = document.getElementById('cl-bar'), full = document.getElementById('cl-full');
    if (!c) { [dock, win, dim, bar, full].forEach(function (e) { e && e.remove(); }); releaseWake(); diagStop(); return; }
    var videoLayout = c.group || c.cam || c.remoteCam, mob = H.mobile;
    // веб клиент: панель звонка в списке чатов; окно с видео — когда есть видео и оно не свёрнуто
    if (!mob) {
      if (!dock) { var side = document.querySelector('.sidebar'); if (side) { dock = document.createElement('div'); dock.id = 'cl-dock'; side.appendChild(dock); } }
      if (dock) {
        dock.innerHTML = '<div class="cl-top" data-cl="restore"><div class="ring">' + H.avatar(c.peer.id, c.peer.name, 34) + '</div><div class="cl-t"><b>' + E(c.peer.name) + '</b><small class="cl-tm">' + status() + '</small></div></div>' +
          '<div class="cl-row"><button class="cl-b ' + (c.mic ? '' : 'off') + '" data-cl="mic" title="Микрофон">' + svg(c.mic ? 'mic' : 'micOff') + '</button><button class="cl-b ' + (c.cam ? '' : 'off') + '" data-cl="cam" title="Камера">' + svg(c.cam ? 'video' : 'videoOff') + '</button>' + (canAdd(c) ? '<button class="cl-b" data-cl="add" title="Добавить в звонок">' + svg('userPlus') + '</button>' : '') + '<button class="cl-b no" data-cl="end">' + svg('phone', 'hang') + 'Завершить</button></div>';
      }
    }
    var showWin = mob ? !st.min : (videoLayout && !st.min);   // группа — всегда окно
    if (!showWin) { [win, dim, full].forEach(function (e) { e && e.remove(); }); }
    else {
      ensureVideos();
      if (!win) { win = document.createElement('div'); win.id = 'cl-win'; if (!mob) { dim = document.createElement('div'); dim.id = 'cl-dim'; dim.className = 'cl-dim'; document.body.appendChild(dim); } document.body.appendChild(win); }
      win.className = 'cl-win ' + (mob ? 'mob' : 'web') + (videoLayout ? ' v' : '');
      var h = hue(c.peer.id);
      win.style.setProperty('--h', h);
      var hd = '<div class="cl-hd"><button class="cl-hbtn l" data-cl="min" aria-label="Свернуть">' + svg(mob ? 'down' : 'min') + '</button><div class="c"><b>' + E(c.peer.name) + (c.group ? ' · ' + (room ? room.remoteParticipants.size + 1 : 1) : '') + '</b><small class="cl-tm">' + status() + '</small></div>' + '<span style="justify-self:end;display:flex;gap:8px">' + (mob && c.cam ? '<button class="cl-hbtn" data-cl="flip" aria-label="Сменить камеру">' + svg('flip') + '</button>' : '') + '<button class="cl-hbtn" data-cl="diag" aria-label="Состояние соединения">' + svg('activity') + '</button></span></div>';
      if (c.group) {
        win.innerHTML = hd + '<div class="cl-stage"><div class="cl-grid" id="cl-grid"></div><div class="cl-ctrls cl-vg">' + ctrlsHtml(c) + '</div></div>';
        fillGrid($('#cl-grid', win));
      } else if (videoLayout) {
        win.innerHTML = hd + '<div class="cl-stage"><div class="cl-remote" id="cl-remote"><div class="cl-ph" ' + (c.remoteCam ? 'hidden' : '') + '>' + H.avatar(c.peer.id, c.peer.name, 160) + '</div><div class="cl-chip cl-vg">' + E(c.peer.name) + '</div></div>' +
          (c.cam ? '<div class="cl-pip" id="cl-pip"></div>' : '') + '<div class="cl-ctrls cl-vg">' + ctrlsHtml(c) + '</div></div>';
        $('#cl-remote', win).insertBefore(rv, $('#cl-remote', win).firstChild); rv.style.display = c.remoteCam ? '' : 'none';
        if (c.cam) $('#cl-pip', win).appendChild(lv);
      } else {
        // аудиоразговор на мобильном: экран с аватаркой и кнопками
        win.innerHTML = hd + '<div class="cl-full" id="cl-full-in" style="position:absolute;z-index:1;background:none;animation:none">' +
          '<span></span><div class="cl-mid"><div style="padding:14px;border-radius:50%;box-shadow:0 0 0 3px var(--accent),0 0 38px rgba(var(--accent-rgb,31,168,140),.45)">' + H.avatar(c.peer.id, c.peer.name, 140) + '</div><div class="nm">' + E(c.peer.name) + '</div><div class="sub cl-tm">' + status() + '</div></div>' +
          '<div class="cl-acts">' + (canSpk() ? '<button class="cl-mb" data-cl="spk"><span class="rnd sq ' + (c.spk === 'receiver' ? 'clg' : 'off') + '">' + svg('volume') + '</span>' + (c.spk === 'receiver' ? 'Трубка' : 'Громко') + '</button>' : '') + '<button class="cl-mb" data-cl="mic"><span class="rnd sq ' + (c.mic ? 'clg' : 'off') + '">' + svg(c.mic ? 'mic' : 'micOff') + '</span>Микрофон</button>' + (c.micOnly ? '' : '<button class="cl-mb" data-cl="cam"><span class="rnd sq clg">' + svg('video') + '</span>Видео</button>') + (canAdd(c) ? '<button class="cl-mb" data-cl="add"><span class="rnd sq clg">' + svg('userPlus') + '</span>Добавить</button>' : '') + '<button class="cl-mb" data-cl="end"><span class="rnd sq no">' + svg('phone', 'hang') + '</span>Завершить</button></div></div>';
      }
    }
    if (mob) {
      if (st.min && !bar) { bar = document.createElement('div'); bar.id = 'cl-bar'; document.body.appendChild(bar); }
      if (!st.min && bar) bar.remove();
      if (st.min && bar) bar.innerHTML = svg('phone') + '<span>' + (c.group ? 'Групповой звонок · ' : 'Звонок · ') + E(c.peer.name) + '</span><span class="tm cl-tm">' + status() + '</span><span class="x" data-cl="end">' + svg('phone', 'hang') + '</span>';
    }
    if (H.decorate) [dock, win, bar].forEach(function (e) { e && document.body.contains(e) && H.decorate(e); });
    tickT = setInterval(function () { var t = status(); document.querySelectorAll('.cl-tm').forEach(function (e) { e.textContent = t; }); }, 1000);
    if (c.phase === 'live') takeWake();
  }
  function takeWake() { try { if (!wake && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {}); } catch (e) {} }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-cl]'); if (!b) return;
    var a = b.dataset.cl;
    if (a === 'decline') decline();
    else if (a === 'audio') accept(false);
    else if (a === 'video') accept(true);
    else if (a === 'end') { e.stopPropagation(); hangup(); }
    else if (a === 'mic') setMic(!(st.call && st.call.mic));
    else if (a === 'cam') setCam(!(st.call && st.call.cam));
    else if (a === 'flip') flip();
    else if (a === 'diag') diagToggle();
    else if (a === 'spk') spkToggle();
    else if (a === 'screen') setScreen(!(st.call && st.call.screen));
    else if (a === 'add') openPick();
    else if (a === 'pclose') closePick();
    else if (a === 'padd') addPerson(+b.dataset.id, b.dataset.nm);
    else if (a === 'min') { st.min = true; render(); }
    else if (a === 'restore') { st.min = false; render(); }
  });
  // Свёрнутый звонок на мобильном разворачивается по нажатию на полосу
  document.addEventListener('click', function (e) { var bar = e.target.closest && e.target.closest('#cl-bar'); if (bar && !e.target.closest('[data-cl="end"]')) { st.min = false; render(); } });

  // ── Состояние соединения: что мешает видео (полоса, процессор), на какой картинке и по какому пути идёт связь ──
  var diagT = null, diagPrev = {};
  function diagToggle() {
    var d = document.getElementById('cl-diag');
    if (d) { d.remove(); clearInterval(diagT); diagT = null; return; }
    d = document.createElement('div'); d.id = 'cl-diag'; d.textContent = 'Собираю данные…'; document.body.appendChild(d); diagPrev = {};
    diagTick(); diagT = setInterval(diagTick, 1500);
  }
  // Трубка или громкая связь (iOS 26+: Speaker Selection API). Вызов setSinkId должен быть прямо в обработчике нажатия
  function outputs() { return (media.devs || []).filter(function (d) { return d.kind === 'audiooutput'; }); }
  function spkToggle() {
    var c = st.call; if (!c) return;
    // Оболочка Android: динамик переключает система
    if (NA) { c.spk = c.spk === 'speaker' ? 'receiver' : 'speaker'; try { NA.setSpeaker(c.spk === 'speaker'); } catch (e) {} H.toast(c.spk === 'receiver' ? 'Звук в трубку' : 'Громкая связь'); render(); return; }
    var outs = outputs(), want = c.spk === 'receiver' ? 'speaker' : 'receiver', id = '';
    if (want === 'receiver') {
      var r = outs.filter(function (d) { return /receiver|earpiece|iphone|трубк|приём|приемн|разговор/i.test(d.label || ''); })[0];
      if (!r) { H.toast(outs.length ? 'Трубка не найдена. Динамики: ' + outs.map(function (d) { return d.label || d.deviceId.slice(0, 6); }).join(', ') : 'Список динамиков пуст: разрешите микрофон'); return; }
      id = r.deviceId; try { localStorage.setItem('cl_recv', id); } catch (e) {}
    }
    var els = [].slice.call(document.querySelectorAll('audio[data-cl]'));
    if (!els.length) { H.toast('Нет звука для переключения'); return; }
    var n = 0;
    els.forEach(function (el) {
      if (!el.setSinkId) return;
      el.setSinkId(id).then(function () { if (++n === 1) { c.spk = want; H.toast(want === 'receiver' ? 'Звук в трубку' : 'Громкая связь'); render(); } }).catch(function (e) { H.toast('Не вышло переключить: ' + (e && e.name || e)); });
    });
  }
  function diagStop() { var d = document.getElementById('cl-diag'); if (d) d.remove(); clearInterval(diagT); diagT = null; }
  async function diagTick() {
    var d = document.getElementById('cl-diag'); if (!d) return;
    if (!room || !LK) { d.textContent = 'Нет соединения с сервером звонков'; return; }
    var L = [], T = LK.Track, now = Date.now();
    var kbps = function (key, bytes) { var p = diagPrev[key]; diagPrev[key] = { b: bytes, t: now }; return p && now > p.t ? Math.round((bytes - p.b) * 8 / (now - p.t)) : 0; };
    try {
      var pub = room.localParticipant.getTrackPublication(T.Source.Camera);
      if (pub && pub.track && pub.track.getSenderStats) {
        var ss = ((await pub.track.getSenderStats()) || []).filter(Boolean), top = ss.slice().sort(function (a, b) { return (b.frameWidth || 0) - (a.frameWidth || 0); })[0];
        if (top) L.push('Вы → сервер: ' + (top.frameWidth || '?') + '×' + (top.frameHeight || '?') + ', ' + Math.round(top.framesPerSecond || 0) + ' к/с, ' + kbps('s', ss.reduce(function (a, x) { return a + (x.bytesSent || 0); }, 0)) + ' кбит/с' + (ss.length > 1 ? ', слоёв ' + ss.length : '') + (top.qualityLimitationReason && top.qualityLimitationReason !== 'none' ? '\n  ограничение: ' + ({ bandwidth: 'не хватает канала', cpu: 'не хватает процессора', other: 'другое' }[top.qualityLimitationReason] || top.qualityLimitationReason) : ''));
      } else L.push('Вы → сервер: камера выключена');
      var rp = Array.from(room.remoteParticipants.values())[0], rpub = rp && rp.getTrackPublication(T.Source.Camera);
      if (rpub && rpub.track && rpub.track.getReceiverStats) {
        var rs = await rpub.track.getReceiverStats();
        if (rs) { var lost = rs.packetsLost || 0, got = rs.packetsReceived || 0, pl = lost + got ? Math.round(lost * 1000 / (lost + got)) / 10 : 0;
          L.push('Сервер → вы: ' + (rs.frameWidth || '?') + '×' + (rs.frameHeight || '?') + ', ' + Math.round(rs.framesPerSecond || 0) + ' к/с, ' + kbps('r', rs.bytesReceived || 0) + ' кбит/с\n  потеряно пакетов ' + pl + '%, дрожание ' + Math.round((rs.jitter || 0) * 1000) + ' мс' + (rs.framesDropped ? ', пропущено кадров ' + rs.framesDropped : '')); }
      } else L.push('Сервер → вы: видео собеседника нет');
    } catch (e) { L.push('Не удалось прочитать данные видео'); }
    try {
      var rep = await room.engine.pcManager.publisher.getStats(), pair = null, byId = {};
      rep.forEach(function (v) { byId[v.id] = v; if (v.type === 'candidate-pair' && (v.selected || (v.nominated && v.state === 'succeeded')) && (!pair || v.selected)) pair = v; });
      if (pair) { var lc = byId[pair.localCandidateId], rc = byId[pair.remoteCandidateId];
        L.push('Путь: ' + (lc && lc.relayProtocol ? 'до сервера связи ' + ({ tls: 'TLS (TCP)', tcp: 'TCP', udp: 'UDP' }[lc.relayProtocol] || lc.relayProtocol) : String((rc && rc.protocol) || (lc && lc.protocol) || '?').toUpperCase()) + ', ' + ({ host: 'напрямую', srflx: 'через NAT', prflx: 'через NAT', relay: 'через TURN' }[(lc && lc.candidateType)] || (lc && lc.candidateType) || '?') + ', задержка ' + Math.round((pair.currentRoundTripTime || 0) * 1000) + ' мс'); }
    } catch (e) {}
    L.push('Связь: ' + (tcpMode ? (tcpUsed ? 'через TCP (' + tcpUrls + ')' : 'у сервера нет TURN по TLS, идёт по UDP') : 'по UDP (выбрано в настройках или сервер без wss://)'));
    L.push('ICE: ' + (iceSeen.length ? iceSeen.join(' ; ') : 'соединения не создавались') + '  [' + CLV + ']');
    try {
      var vm = /Version\/([\d.]+)/.exec(navigator.userAgent), mt = room.localParticipant.getTrackPublication(T.Source.Microphone), mst = mt && mt.track && mt.track.mediaStreamTrack;
      L.push('Safari ' + (vm ? vm[1] : '?') + ', setSinkId: ' + (canSink() ? 'есть' : 'нет') + ', микрофон: ' + (mst ? mst.readyState + (mst.enabled ? '' : ', выкл') + (mst.muted ? ', muted' : '') : 'нет трека'));
      if (sinkLog.length) L.push('Выбор динамика: ' + sinkLog.join('; '));
      var ou = outputs(); if (ou.length) L.push('Динамики: ' + ou.map(function (d) { return d.label || d.deviceId.slice(0, 6); }).join(' | '));
    } catch (e) {}
    try { L.push('Звук: ' + (waOn() ? 'через Web Audio (' + (waCtx ? waCtx.state : 'нет контекста') + ')' : 'через элемент audio') + (navigator.audioSession ? ', сеанс «' + navigator.audioSession.type + '»' : '')); } catch (e) {}
    d.textContent = L.join('\n');
  }

  // ── LiveKit ──
  function loadLK() {
    return new Promise(function (res, rej) {
      if (window.LivekitClient) return res(window.LivekitClient);
      var s = document.createElement('script'); s.src = '/shared/livekit-client.umd.js?v=1';
      s.onload = function () { res(window.LivekitClient); }; s.onerror = function () { rej(new Error('lk')); };
      document.head.appendChild(s);
    });
  }
  async function join(c, url, token, withVideo) {
    if (location.protocol === 'https:' && /^ws:/i.test(url)) throw new Error('Сервер звонков работает без сертификата (ws://): в браузере звонки доступны только с wss://');
    LK = await loadLK(); ended = false;
    closeAc();
    if (pendingSpk) { c.spk = pendingSpk; pendingSpk = null; }
    if (NA) { if (!c.spk) c.spk = c.video ? 'speaker' : 'receiver'; try { NA.callMode(true, !!c.video, c.spk === 'speaker'); } catch (e) {} }
    earDone = false;
    // По умолчанию через TCP (TURN по TLS): на Wi-Fi с потерями UDP видео рассыпается. Только для wss:// (при ws:// TURN по TLS не бывает); отключается в настройках
    tcpMode = !lget('udp') && /^wss:/i.test(String(url)); tcpUsed = false; tcpUrls = ''; iceSeen = []; patchPc();
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
    ensureVideos();
    var R = LK.RoomEvent, T = LK.Track;
    // В звонке двоих без слоёв качества: приёмник всегда получает полную картинку, а передатчик не гоняет три кодировщика (на телефоне это тяжело, и картинка падала до 180×320 при 7 к/с). Слои нужны только в группе
    room = new LK.Room({ adaptiveStream: !!c.group, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: devOpt('audioin') }, videoCaptureDefaults: { resolution: H.mobile && c.group ? { width: 960, height: 540, frameRate: 24 } : { width: 1280, height: 720, frameRate: 30 }, deviceId: devOpt('videoin') }, publishDefaults: { simulcast: !!c.group, videoCodec: isIOS ? 'h264' : undefined, audioPreset: { maxBitrate: 40000 }, videoEncoding: !c.group ? { maxBitrate: 3000000, maxFramerate: 30 } : (H.mobile ? { maxBitrate: 1200000, maxFramerate: 24 } : undefined) } });
    room.on(R.TrackSubscribed, function (track) {
      if (track.kind === T.Kind.Audio && waOn() && waAttach(track)) { setTimeout(reapplyEarpiece, 800); setTimeout(reapplyEarpiece, 3500); remoteState(); return; }
      if (track.kind === T.Kind.Audio) { document.querySelectorAll('audio[data-sid="' + track.sid + '"]').forEach(function (o) { o.remove(); }); var el = track.attach(); el.dataset.cl = '1'; el.dataset.sid = track.sid; el.setAttribute('playsinline', ''); document.body.appendChild(el);
        // Обход ошибки WebKit 320087: на iOS setSinkId на элементе с одним удалённым треком ничего не меняет, а с двумя работает
        if (lget('two')) { try { var cl = track.mediaStreamTrack.clone(); cl.enabled = false; twoClones[track.sid] = cl; el.srcObject = new MediaStream([track.mediaStreamTrack, cl]); } catch (e) {} } try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {} el.play && el.play().catch(function () {}); }
      remoteState();
    }).on(R.TrackUnsubscribed, function (track) { waDetach(track.sid); var els = track.detach(); if (track.kind === T.Kind.Audio) els.forEach(function (el) { el.remove(); }); remoteState(); })
      .on(R.TrackMuted, remoteState).on(R.TrackUnmuted, remoteState).on(R.TrackUnpublished, function () { setTimeout(remoteState, 0); })
      .on(R.ParticipantConnected, function () { liveNow(); remoteState(); })
      .on(R.ParticipantDisconnected, function () { if (!ended && st.call) { if (st.call.group) render(); else hangup(); } })
      .on(R.ActiveSpeakersChanged, function (list) { speaking = {}; list.forEach(function (p) { speaking[p.identity] = true; }); document.querySelectorAll('.cl-tile').forEach(function (t) { t.classList.toggle('sp', !!speaking[t.dataset.id]); }); })
      .on(R.LocalTrackUnpublished, function (pub) { if (pub.source === T.Source.ScreenShare && st.call) { if (st.call.screen) H.api('POST', '/calls/' + st.call.id + '/event', { k: 'screen', on: false }); st.call.screen = false; render(); } })
      .on(R.ConnectionQualityChanged, function (q, p) { if (p !== room.localParticipant && st.call) st.call.quality = q; })
      .on(R.Reconnecting, function () { if (st.call) { st.call.phase = 'reconnecting'; render(); } })
      .on(R.Reconnected, function () { if (st.call) { st.call.phase = room.remoteParticipants.size ? 'live' : 'ringing'; render(); } })
      .on(R.Disconnected, function () { if (!ended && st.call) { H.toast('Соединение разорвано'); hangup(); } });
    await room.connect(url, token);
    var so = devGet('audioout'); if (so && so.id && canSink() && room.switchActiveDevice) { try { await room.switchActiveDevice('audiooutput', so.id); } catch (e) {} }
    try { await room.localParticipant.setMicrophoneEnabled(true); c.mic = true; } catch (e) { c.mic = false; }
    releaseMic(); mediaRefresh(); setTimeout(reapplyEarpiece, 2500);
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
    if (c.group) { c.since = Date.now(); liveNow(); }
    else if (room.remoteParticipants.size) { liveNow(); remoteState(); } else { c.phase = c.outgoing ? 'ringing' : 'connecting'; render(); }
    if (withVideo) await setCam(true);
  }
  function liveNow() { var c = st.call; if (!c) return; stopRing(); if (c.phase !== 'live') { c.phase = 'live'; c.since = c.since || Date.now(); } render(); }
  function remoteState() {
    var c = st.call; if (!c || !room) return;
    if (c.group) return render();
    var p = Array.from(room.remoteParticipants.values())[0]; if (!p) return;
    var T = LK.Track, cam = p.getTrackPublication(T.Source.Camera), mic = p.getTrackPublication(T.Source.Microphone);
    c.remoteCam = !!cam && !cam.isMuted && !!cam.track; c.remoteMic = !!mic && !mic.isMuted;
    var scr = p.getTrackPublication(T.Source.ScreenShare);
    c.remoteScreen = !!scr && !!scr.track;
    ensureVideos();
    if (c.remoteScreen) { scr.track.attach(rv); c.remoteCam = true; }
    else if (c.remoteCam) cam.track.attach(rv);
    rv.classList.toggle('screen', !!c.remoteScreen);
    render();
  }
  async function setMic(on) {
    var c = st.call; if (!c || !room) return;
    try { await room.localParticipant.setMicrophoneEnabled(on); c.mic = on; } catch (e) { H.toast('Нет доступа к микрофону. Разрешите его в настройках браузера'); }
    render();
  }
  async function setCam(on) {
    var c = st.call; if (!c || !room) return;
    try {
      var pub = await room.localParticipant.setCameraEnabled(on); c.cam = on;
      ensureVideos();
      if (on && pub && pub.track) pub.track.attach(lv); else lv.srcObject = null;
      if (on) st.min = false;
    } catch (e) { c.cam = false; H.toast('Нет доступа к камере. Разрешите её в настройках браузера'); }
    render();
  }
  // Телефон: передняя и задняя камеры
  async function flip() {
    var c = st.call; if (!c || !room || !c.cam || !LK) return;
    var pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera), tr = pub && pub.track;
    if (!tr || !tr.restartTrack) return;
    var cur = c.facing || (tr.mediaStreamTrack && tr.mediaStreamTrack.getSettings && tr.mediaStreamTrack.getSettings().facingMode) || 'user';
    var next = cur === 'environment' ? 'user' : 'environment';
    try { await tr.restartTrack({ facingMode: next, deviceId: undefined }); c.facing = next; lv.classList.toggle('rear', next === 'environment'); }
    catch (e) { H.toast('Не удалось переключить камеру'); }
  }
  // Показ своего экрана (в телефоне браузер этого не умеет)
  async function setScreen(on) {
    var c = st.call; if (!c || !room) return;
    try { await room.localParticipant.setScreenShareEnabled(on, { audio: false }); c.screen = on; H.api('POST', '/calls/' + c.id + '/event', { k: 'screen', on: !!on }); }
    catch (e) { c.screen = false; if (!e || e.name !== 'NotAllowedError') H.toast('Не удалось показать экран'); }
    render();
  }
  async function leave() {
    ended = true; releaseMic();
    try { if (room) await room.disconnect(); } catch (e) {}
    room = null; tvids = {}; speaking = {};
    document.querySelectorAll('audio[data-cl]').forEach(function (a) { a.remove(); });
    waClose();
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) {}
    if (lv) lv.srcObject = null; if (rv) rv.srcObject = null;
  }

  // ── действия ──
  async function start(chatId, video) {
    var info = H.chatInfo && H.chatInfo(chatId);
    if (info && (info.type === 'group' || info.type === 'room')) return joinGroup(chatId, video, info.name);
    if (!st.enabled) return H.toast(ERR.disabled);
    if (st.call || st.incoming) return H.toast(ERR.in_call);
    if (!hasMedia()) return H.toast('Браузер не даёт доступ к микрофону: откройте клиент по https');
    if (!(await ensureMedia(!!video))) return;
    var r = await H.api('POST', '/calls/start', { chat_id: chatId, video: !!video });
    // Сервер считает нас в звонке, а на экране его нет (завершение не дошло, страницу усыпила система): закрываем забытый звонок и пробуем ещё раз
    if (r && r.code === 'in_call' && !st.call) {
      var cur = await H.api('GET', '/calls/config');
      if (cur && cur.current && !cur.current.incoming) {
        await H.api('POST', cur.current.group ? '/calls/group/' + cur.current.call_id + '/leave' : '/calls/' + cur.current.call_id + '/end');
        r = await H.api('POST', '/calls/start', { chat_id: chatId, video: !!video });
      }
    }
    if (!r || r.error) return H.toast(ERR[r && r.code] || (r && r.error) || 'Не удалось начать звонок');
    var c = st.call = { id: r.call_id, chatId: chatId, peer: r.peer, fed: !!r.fed, video: !!video, outgoing: true, phase: 'ringing', mic: true, cam: false, remoteCam: false, remoteMic: true, since: 0 };
    st.min = false; ring('out'); render();
    try { await join(c, r.url, r.token, !!video); }
    catch (e) { fail(e); }
  }
  // Групповой звонок: войти в уже идущий или начать новый
  async function joinGroup(chatId, video, name) {
    if (!st.enabled) return H.toast(ERR.disabled);
    if (st.call) return H.toast(ERR.in_call);
    if (!hasMedia()) return H.toast('Браузер не даёт доступ к микрофону: откройте клиент по https');
    if (!(await ensureMedia(!!video))) return;
    var r = await H.api('POST', '/calls/group/join', { chat_id: chatId, video: !!video });
    if (!r || r.error) return H.toast({ full: 'В звонке уже много людей' }[r && r.code] || (r && r.error) || 'Не удалось присоединиться');
    var c = st.call = { id: r.call_id, chatId: chatId, fedGroup: !!r.fed_group, peer: { id: 0, name: name || 'Группа' }, group: true, video: !!video, outgoing: false, phase: 'connecting', mic: true, cam: false, remoteCam: false, remoteMic: true, since: 0 };
    // Видео в звонке на 12 человек, дальше только звук (звук без ограничений)
    if (r.mic_only) { c.micOnly = true; c.video = false; video = false; H.toast('В звонке уже 12 человек с видео: вы подключены только со звуком'); }
    st.min = false; dismissIncoming(); render();
    try { await join(c, r.url, r.token, !!video); }
    catch (e) { fail(e); }
  }
  async function accept(withVideo) {
    var inc = st.incoming; if (!inc) return;
    if (!inc.group && !(await ensureMedia(!!withVideo))) return;
    if (inc.group) { var gi = inc; dismissIncoming(); return joinGroup(gi.chat_id, withVideo, gi.name); }
    stopRing();
    var r = await H.api('POST', '/calls/' + inc.call_id + '/accept');
    dismissIncoming();
    if (!r || r.error) return H.toast('Звонок уже завершён');
    var cf = !!(r.group && r.conf);
    var c = st.call = { id: inc.call_id, chatId: inc.chat_id, fed: !!r.fed, mix: !!r.mix, peer: cf ? { id: 0, name: 'Групповой звонок' } : inc.from, group: cf, conf: cf, video: !!withVideo, outgoing: false, phase: 'connecting', mic: true, cam: false, remoteCam: false, remoteMic: true, since: 0 };
    st.min = false; render();
    try { await join(c, r.url, r.token, !!withVideo); }
    catch (e) { fail(e); }
  }
  function fail(e) {
    var m = String(e && e.message || e), c = st.call;
    var t = /NotAllowed|Permission|mic|микрофон/i.test(m) ? 'Нет доступа к микрофону. Разрешите его в настройках браузера' : /wss:\/\//.test(m) ? m : 'Не удалось подключиться к серверу звонков';
    if (c) H.api('POST', c.group ? '/calls/group/' + c.id + '/leave' : '/calls/' + c.id + '/end');
    finish(t);
  }
  function decline() { var inc = st.incoming; if (!inc) return; if (!inc.group) H.api('POST', '/calls/' + inc.call_id + '/decline'); dismissIncoming(); }
  function fixViewport() { try { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; window.dispatchEvent(new Event('resize')); } catch (e) {} }
  function finish(msg) {
    var c = st.call; if (!c) return;
    st.call = null; st.min = false; stopRing(); leave(); render();
    if (NA) { try { NA.callMode(false, false, false); } catch (e) {} }
    if (H.mobile) { setTimeout(fixViewport, 60); setTimeout(fixViewport, 600); }
    if (msg) H.toast(msg);
  }
  function hangup() { var c = st.call; if (!c) return; H.api('POST', c.group ? '/calls/group/' + c.id + '/leave' : '/calls/' + c.id + '/end'); finish(); }

  // ── события сервера ──
  function onWs(d) {
    if (d.type === 'call_incoming') {
      if (st.call || st.incoming) return;
      st.incoming = d; renderIncoming(); ring('in');
      if (document.hidden && H.notify) H.notify('Входящий ' + (d.video ? 'видеозвонок' : 'аудиозвонок'), d.from.name, d.chat_id);
    } else if (d.type === 'call_config') {
      st.enabled = !!d.enabled;
      if (!st.enabled) { dismissIncoming(); if (st.call) finish('Звонки отключены на сервере'); st.groups = {}; if (typeof H.onConfig === 'function') H.onConfig(st); }
      else load();
    } else if (d.type === 'call_prefs') {
      st.prefs = d.prefs; if (typeof H.onConfig === 'function') H.onConfig(st);
    } else if (d.type === 'call_group') {
      if (d.event === 'ended') { delete st.groups[d.chat_id]; if (st.incoming && st.incoming.group && st.incoming.chat_id === d.chat_id) dismissIncoming(); }
      else { st.groups[d.chat_id] = { call_id: d.call_id, participants: d.participants, video: d.video, started_by: d.started_by }; if (st.incoming && st.incoming.group && st.incoming.chat_id === d.chat_id) { st.incoming.participants = d.participants; } }
      if (d.event === 'started' && !st.call && !st.incoming) {
        var info = H.chatInfo && H.chatInfo(d.chat_id);
        st.incoming = Object.assign({ group: true, name: info ? info.name : 'Группа', timeout: 60 }, d); renderIncoming(); tone([880, 1175], .25, .05);
        if (document.hidden && H.notify) H.notify('Групповой звонок', d.from.name + ' · ' + (info ? info.name : 'группа'), d.chat_id);
      }
      if (typeof H.onConfig === 'function') H.onConfig(st);
    } else if (d.type === 'call_conf') {
      var cc = st.call; if (!cc || cc.id !== d.call_id) return;
      if (d.pending) cc.pending = d.pending;
      if (d.mix) cc.mix = true;
      if (d.event === 'downgraded') { if (cc.conf && cc.peer0) { cc.group = false; cc.conf = false; cc.mix = false; cc.pending = []; cc.peer = cc.peer0; closePick(); render(); } return; }
      if (d.event === 'upgraded') toConf(cc);
      else if (d.event === 'update') { if (!cc.group) toConf(cc); else render(); }
      else if (d.event === 'declined') { dropPending(cc, d.user); H.toast((d.user && d.user.name || 'Человек') + ' отклонил(а) приглашение'); render(); }
      else if (d.event === 'missed') { dropPending(cc, d.user); H.toast((d.user && d.user.name || 'Человек') + ' не ответил'); render(); }
      else if (d.event === 'ended') { closePick(); finish(d.reason === 'admin' ? 'Звонок завершён администратором' : ''); }
    } else if (d.type === 'call_accepted') {
      if (st.call && st.call.id === d.call_id) { stopRing(); if (st.call.phase === 'ringing') st.call.phase = 'connecting'; render(); }
    } else if (d.type === 'call_answered') {
      if (st.incoming && st.incoming.call_id === d.call_id) dismissIncoming();
    } else if (d.type === 'call_ended') {
      if (st.incoming && st.incoming.call_id === d.call_id) { var n = st.incoming.from.name; dismissIncoming(); if (d.reason === 'missed' || d.reason === 'cancelled') H.toast('Пропущенный звонок: ' + n); }
      if (st.call && st.call.id === d.call_id) {
        var c = st.call, why = { declined: 'Звонок отклонён', missed: 'Нет ответа', dropped: 'Связь прервана', disabled: 'Звонки отключены на сервере' }[d.reason];
        finish(d.reason === 'admin' ? 'Звонок завершён администратором' : c.outgoing ? why : (d.reason === 'dropped' ? why : ''));
      }
    }
  }

  async function load() {
    css();
    var r = await H.api('GET', '/calls/config');
    st.groups = {}; ((r && r.groups) || []).forEach(function (g) { st.groups[g.chat_id] = g; });
    if (r && r.prefs) st.prefs = r.prefs;
    st.enabled = !!(r && r.enabled); st.secure = !(location.protocol === 'https:' && r && r.scheme === 'ws');
    // Страницу перезагрузили посреди звонка: подключение пропало вместе с ней, сервер надо известить
    var cur = r && r.current;
    // Нажали на уведомление (или страницу открыли, пока звонок ещё звонит): показываем входящий сразу
    if (cur && cur.incoming && cur.state === 'ringing' && cur.from && !st.call && !st.incoming) {
      st.incoming = { call_id: cur.call_id, chat_id: cur.chat_id, video: cur.video, from: cur.from, timeout: cur.timeout };
      renderIncoming(); ring('in');
    }
    // «Ответить» в уведомлении приложения Android: входящий уже на экране (пришёл по соединению или из настроек), сразу принимаем
    var aa = H.autoAnswer && H.autoAnswer();
    if (aa && st.incoming && st.incoming.call_id === aa && !st.call) accept(!!st.incoming.video);
    var want = H.pendingCall && H.pendingCall();
    if (want && !st.call && !st.incoming) {
      var g = (r && r.groups || []).find(function (x) { return x.call_id === want; });
      if (g) { var gi = H.chatInfo && H.chatInfo(g.chat_id); st.incoming = Object.assign({ group: true, name: gi ? gi.name : 'Группа', timeout: 60 }, g); renderIncoming(); }
    }
    // Страницу перезагрузили посреди звонка: сервер сам завершит его, когда закроется последнее соединение человека. Здесь звонок
    // не завершаем: человек мог просто открыть второе устройство, пока говорит на первом
    if (typeof H.onConfig === 'function') H.onConfig(st);
    mediaRefresh();
  }
  // ── Доступ к микрофону и камере (раздел «Звонки» в настройках) ──
  // Состояния: granted (есть) | denied (запрещён) | prompt (ещё не спрашивали) | nodev (устройства нет) | nosecure (страница не по https) | unknown
  // Свои настройки этого устройства (не на сервере): через TCP
  function lget(k) { try { return localStorage.getItem('cl_' + k) === '1'; } catch (e) { return false; } }
  function lset(k, v) { try { if (v) localStorage.setItem('cl_' + k, '1'); else localStorage.removeItem('cl_' + k); } catch (e) {} }
  var tcpMode = false, tcpUsed = false, tcpUrls = '', pcPatched = false, iceSeen = [], CLV = 'snd-7';
  // Только TURN по TLS (TCP) и запрет прямых путей. LiveKit создаёт соединение раньше, чем получает от сервера список ICE-серверов, и
  // потом задаёт его через setConfiguration, поэтому подменяем и конструктор, и setConfiguration. Если у сервера нет TURN по TLS, идём как обычно
  function tcpize(cfg) {
    if (!tcpMode || !cfg) return cfg;
    var srv = (cfg.iceServers || []).map(function (s) {
      var u = [].concat(s.urls || []).filter(function (x) { return /^turns:|transport=tcp/i.test(x); }), more = [];
      // LiveKit объявляет TURN по TLS на порту 443 (за балансировщиком), а у нас он слушает 5349: пробуем оба адреса
      u.forEach(function (x) { var m = /^turns:([^:\/?]+):443(\?.*)?$/i.exec(x); if (m) more.push('turns:' + m[1] + ':5349' + (m[2] || '?transport=tcp')); });
      return Object.assign({}, s, { urls: u.concat(more) });
    }).filter(function (s) { return s.urls.length; });
    if (srv.length) { tcpUsed = true; tcpUrls = srv.map(function (s) { return s.urls.join(', '); }).join('; '); return Object.assign({}, cfg, { iceTransportPolicy: 'relay', iceServers: srv }); }
    return cfg.iceServers ? Object.assign({}, cfg, { iceTransportPolicy: 'all' }) : cfg;
  }
  function seen(tag, cfg) { try { iceSeen.push(tag + ': ' + (cfg && cfg.iceServers ? (cfg.iceServers.map(function (s) { return [].concat(s.urls || []).join(' '); }).join(' | ') || 'пусто') : 'без серверов')); if (iceSeen.length > 5) iceSeen.shift(); } catch (e) {} }
  function patchPc() {
    if (pcPatched || !window.RTCPeerConnection) return; pcPatched = true;
    var O = window.RTCPeerConnection;
    var N = function (cfg, c) {
      seen('создано', cfg);
      // серверов ещё нет (придут позже): сразу запрещаем прямой путь, ICE начнётся только после setConfiguration
      cfg = cfg && cfg.iceServers ? tcpize(cfg) : (tcpMode ? Object.assign({}, cfg || {}, { iceTransportPolicy: 'relay' }) : cfg);
      return c !== undefined ? new O(cfg, c) : new O(cfg);
    };
    N.prototype = O.prototype;
    if (O.generateCertificate) N.generateCertificate = O.generateCertificate.bind(O);
    var SC = O.prototype.setConfiguration;
    if (SC) O.prototype.setConfiguration = function (cfg) { seen('настройка', cfg); return SC.call(this, tcpize(cfg)); };
    window.RTCPeerConnection = N;
  }
  var NA = (window.AndroidApp && window.AndroidApp.callMode) ? window.AndroidApp : null;   // оболочка Android: звук и датчик приближения
  var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  var media = { audio: 'unknown', video: 'unknown', busy: {}, subs: [], devs: [] };
  // ── Выбор микрофона, динамика и камеры: хранится на этом устройстве (идентификаторы у каждого браузера свои), применяется к следующему звонку ──
  var DEVK = { audioin: ['audioinput', 'Микрофон'], audioout: ['audiooutput', 'Динамик'], videoin: ['videoinput', 'Камера'] };
  function devGet(k) { try { return JSON.parse(localStorage.getItem('cl_dev_' + k) || 'null'); } catch (e) { return null; } }
  function devOpt(k) { var d = devGet(k); return d && d.id ? { ideal: d.id } : undefined; }   // ideal: если устройства уже нет, берётся обычное
  function canSink() { return !!(window.HTMLMediaElement && 'setSinkId' in HTMLMediaElement.prototype); }   // iPhone и Safari выбирать динамик не дают
  function devSet(k, id) {
    try { if (!id) localStorage.removeItem('cl_dev_' + k); else { var d = media.devs.filter(function (x) { return x.deviceId === id && x.kind === DEVK[k][0]; })[0]; localStorage.setItem('cl_dev_' + k, JSON.stringify({ id: id, label: d ? d.label : '' })); } } catch (e) {}
  }
  function devSelect(k) {
    if (k === 'audioout' && !canSink()) return '';
    var kind = DEVK[k][0], list = media.devs.filter(function (d) { return d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications'; }), cur = (devGet(k) || {}).id || '';
    var opts = '<option value="">По умолчанию</option>' + list.map(function (d, i) { return '<option value="' + E(d.deviceId) + '"' + (d.deviceId === cur ? ' selected' : '') + '>' + E(d.label || DEVK[k][1] + ' ' + (i + 1)) + '</option>'; }).join('');
    return '<select class="cl-sel" data-cl-dev="' + k + '" aria-label="' + DEVK[k][1] + '">' + opts + '</select>';
  }
  document.addEventListener('change', function (e) { var t = e.target; if (t && t.dataset && t.dataset.clDev) { devSet(t.dataset.clDev, t.value); H.toast('Применится к следующему звонку'); } });
  try { navigator.mediaDevices.addEventListener('devicechange', function () { mediaRefresh(); }); } catch (e) {}
  var MEDIA_TXT = { granted: 'Доступ есть', denied: 'Доступ запрещён', prompt: 'Не разрешён · нажмите', nodev: 'Устройство не найдено', nosecure: 'Нужен https', unknown: 'Не проверено · нажмите' };
  async function mediaProbeOne(perm, devKind, devs) {
    if (devs.length && !devs.some(function (d) { return d.kind === devKind; })) return 'nodev';
    try { var p = await navigator.permissions.query({ name: perm }); return p.state === 'granted' ? 'granted' : p.state === 'denied' ? 'denied' : 'prompt'; }
    catch (e) { return devs.some(function (d) { return d.kind === devKind && d.label; }) ? 'granted' : 'prompt'; }   // Safari не отвечает на запрос: названия устройств видны только после разрешения
  }
  async function mediaRefresh() {
    var a, v, devs0 = [];
    if (!hasMedia()) { a = v = 'nosecure'; }
    else {
      var devs = []; try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
      devs0 = devs;
      a = await mediaProbeOne('microphone', 'audioinput', devs); v = await mediaProbeOne('camera', 'videoinput', devs);
    }
    var sig = function (l) { return l.map(function (d) { return d.kind + d.deviceId + d.label; }).join('|'); };
    var changed = a !== media.audio || v !== media.video || sig(devs0) !== sig(media.devs); media.audio = a; media.video = v; media.devs = devs0;
    if (changed) media.subs.forEach(function (f) { try { f(); } catch (e) {} });
    return { audio: a, video: v };
  }
  async function mediaAsk(kind) {
    if (!hasMedia()) return mediaRefresh();
    media.busy[kind] = true; media.subs.forEach(function (f) { try { f(); } catch (e) {} });
    var hint = '';
    try { var s = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { video: true } : { audio: true }); s.getTracks().forEach(function (t) { t.stop(); }); }
    catch (e) {
      if (/NotAllowed|Security|Permission/i.test(e && e.name || '')) hint = H.mobile ? 'Доступ запрещён. Включите его в настройках телефона для браузера или приложения' : 'Доступ запрещён. Нажмите на значок замка в адресной строке и разрешите ' + (kind === 'video' ? 'камеру' : 'микрофон');
    }
    media.busy[kind] = false;
    await mediaRefresh(); media.subs.forEach(function (f) { try { f(); } catch (e) {} });
    if (hint && media[kind] !== 'granted') H.toast(hint);
    return media[kind];
  }
  // Готовая кнопка-состояние для строки настроек: галочка, если доступ есть, крестик, если нет; по нажатию — системный запрос
  function mediaChip(kind) {
    var s = media[kind], ok = s === 'granted', t = media.busy[kind] ? 'Запрашиваем…' : MEDIA_TXT[s] || MEDIA_TXT.unknown;
    return '<button type="button" class="cl-acc ' + (ok ? 'ok' : 'no') + '" data-cl-media="' + kind + '" ' + (media.busy[kind] ? 'disabled ' : '') + 'aria-label="' + (kind === 'video' ? 'Камера' : 'Микрофон') + ': ' + t + '">' + svg(ok ? 'check' : 'x') + t + '</button>';
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-cl-media]'); if (b && !b.disabled) mediaAsk(b.dataset.clMedia); });
  window.addEventListener('focus', function () { if (document.querySelector('[data-cl-media]')) mediaRefresh(); });
  function init(host) {
    H = host; css();
    window.addEventListener('beforeunload', function () { if (st.call) { try { navigator.sendBeacon && 0; } catch (e) {} } });
  }
  // Свои настройки звонков: enabled — все звонки, audio, video, fed — приём звонков с других серверов
  async function setPref(key, val) {
    var r = await H.api('PUT', '/calls/prefs', JSON.parse('{"' + key + '":' + (val ? 'true' : 'false') + '}'));
    if (r && !r.error) st.prefs = r;
    if (typeof H.onConfig === 'function') H.onConfig(st);
    return st.prefs;
  }
  window.Calls = { available: function () { return st.enabled; }, prefs: function () { return st.prefs; }, setPref: setPref, init: init, load: load, onWs: onWs, canCall: canCall, btns: btns, start: start, state: st, inCall: function (chatId) { return !!st.groups[chatId]; }, local: { get: function (k) { return k === 'wa' ? waOn() : lget(k); }, set: function (k, v) { if (k === 'wa') { try { localStorage.setItem('cl_wa', v ? '1' : '0'); } catch (e) {} } else lset(k, v); } }, isIOS: function () { return isIOS; }, devices: { select: devSelect }, media: { chip: mediaChip, refresh: mediaRefresh, ask: mediaAsk, get: function () { return { audio: media.audio, video: media.video }; }, onChange: function (f) { media.subs.push(f); } } };
  window.callStart = function (chatId, video) { start(Number(chatId), !!video); };
})();
