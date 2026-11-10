// Заглушка callpreload.js / callinpreload.js и LiveKit для снимков окон звонков настоящим Electron без main.js (см. shot-callwin.js).
// Работает без contextIsolation: подставляет window.callApi / window.callInApi и window.LivekitClient (скрипт vendor/livekit-client.umd.js отменяет harness).
// Сценарий — JSON в переменной SHOT_CALL: { kind:'call'|'callin', init:{…как отдаёт main.js…}, remote:[{id,name,cam,mic,guest}], selfCam, speaking:[identity], quality, skew, pick }.
const fs = require('fs');
const C = JSON.parse(fs.readFileSync(process.env.SHOT_CALL, 'utf8'));
const noop = () => {};
if (C.kind === 'callin') {
  window.callInApi = { init: () => Promise.resolve(C.init), action: a => console.log('ACTION', a) };
} else {
  const cmd = { cb: null }, pick = { cb: null };
  window.callApi = {
    init: () => Promise.resolve(C.init), mediaAccess: () => Promise.resolve(true),
    state: st => { if (st.phase !== 'live' && st.phase !== 'connecting' && st.phase !== 'waiting') console.log('STATE', JSON.stringify(st)); },
    onCmd: cb => { cmd.cb = cb; }, onPickScreen: cb => { pick.cb = cb; }, onScreenDenied: noop, screenChosen: noop,
  };
  window.__cmd = c => cmd.cb && cmd.cb(c); window.__pick = l => pick.cb && pick.cb(l);
  // фальшивое «видео»: канвас с силуэтом человека нужного оттенка
  const streams = {};
  const stream = hue => streams[hue] || (streams[hue] = (() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 400; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, `hsl(${hue} 28% 42%)`); g.addColorStop(1, `hsl(${hue} 30% 24%)`);
    x.fillStyle = g; x.fillRect(0, 0, 640, 400);
    x.fillStyle = `hsla(${hue},34%,66%,.55)`; x.beginPath(); x.arc(320, 150, 62, 0, 7); x.fill();
    x.fillStyle = `hsla(${hue},34%,52%,.5)`; x.beginPath(); x.ellipse(320, 400, 150, 170, 0, 0, 7); x.fill();
    setInterval(() => { x.fillStyle = 'rgba(0,0,0,.004)'; x.fillRect(0, 0, 1, 1); }, 300);   // канвас без изменений не выдаёт кадры
    return c.captureStream(4);
  })());
  const pub = (on, hue) => ({ isMuted: !on, track: on ? { attach: v => { v.srcObject = stream(hue); v.play?.().catch(noop); return v; }, detach: () => [] } : null });
  const Source = { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' };
  const RoomEvent = {}; ['TrackSubscribed', 'TrackUnsubscribed', 'TrackUnpublished', 'TrackMuted', 'TrackUnmuted', 'ParticipantConnected', 'ParticipantDisconnected', 'LocalTrackUnpublished', 'ActiveSpeakersChanged', 'ConnectionQualityChanged', 'Reconnecting', 'Reconnected', 'Disconnected'].forEach(k => { RoomEvent[k] = k; });
  const person = (id, name, cam, mic, hue) => ({ identity: id, name, getTrackPublication: s => (s === Source.Camera ? pub(cam, hue) : s === Source.Microphone ? { isMuted: !mic } : null) });
  const hueOf = id => ((+String(id).replace(/^\D+/, '') || 0) * 47) % 360;
  class Room {
    constructor() {
      this.h = {};
      this.remoteParticipants = new Map(C.remote.map(r => [r.id, person(r.id, r.name, r.cam, r.mic, hueOf(r.id))]));
      this.localParticipant = Object.assign(person('u1', 'Вы', !!C.selfCam, true, 200), {
        setMicrophoneEnabled: () => Promise.resolve(), setScreenShareEnabled: () => Promise.resolve(),
        setCameraEnabled: on => Promise.resolve(on ? pub(true, 200) : null),
        getTrackPublication: s => (s === Source.Camera ? pub(!!C.selfCam, 200) : s === Source.Microphone ? { isMuted: false } : null),
      });
    }
    on(ev, fn) { this.h[ev] = fn; return this; }
    connect() { setTimeout(() => {
      if (C.speaking) this.h.ActiveSpeakersChanged?.(C.speaking.map(id => ({ identity: id })));
      if (C.quality) this.h.ConnectionQualityChanged?.(C.quality, [...this.remoteParticipants.values()][0]);
      window.__skew = C.skew || 0;
      if (C.pick) window.__pick(C.pick);
    }, 400); return Promise.resolve(); }
    disconnect() { return Promise.resolve(); } switchActiveDevice() { return Promise.resolve(); }
  }
  window.LivekitClient = { Room, RoomEvent, Track: { Source, Kind: { Audio: 'audio', Video: 'video' } } };
  const dn = Date.now.bind(Date); window.__skew = 0; Date.now = () => dn() + window.__skew;
}
