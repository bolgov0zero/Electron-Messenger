// Снимки окон звонков Электрона (client/src/call.html и callin.html) настоящим Electron без main.js и сервера. Запуск из папки client:
//   cd client && npx electron ../docs/flat-mockup/port/shot-callwin.js <папка-снимков> [светлая|navy] [имя-сценария]
// Окно подменяет preload на callwin-stub-preload.js (данные, фальшивый LiveKit, силуэты вместо видео). callin снимается в прозрачном окне (hasShadow:false),
// PNG с прозрачностью; поверх серого фона их складывает composite-callin.py. Ошибки и предупреждения консоли печатаются как CONSOLE.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.argv[2], onlyTheme = process.argv[3], onlySc = process.argv[4];
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const PROFILE = fs.mkdtempSync(path.join(require('os').tmpdir(), 'shot-cw-'));
app.setPath('userData', PROFILE);
const SCDIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'shot-cw-sc-'));
app.on('quit', () => { try { fs.rmSync(SCDIR, { recursive: true, force: true }); } catch (e) {} try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });
const SRC = path.resolve(__dirname, '../../../client/src');
const ACC = { light: '#1da88c', navy: '#29d6b8' };
const R = (id, name, cam, mic, extra) => ({ id, name, cam, mic, ...extra });
const GR = [R('u12', 'Борис Кузнецов', 1, 1), R('u13', 'Мария Орлова', 1, 1), R('u14', 'Дмитрий Волков', 1, 0), R('u15', 'Елена Смирнова', 0, 1), R('u16', 'Игорь Попов', 1, 0)];
const thumb = c => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${c}"/><rect x="20" y="20" width="120" height="70" rx="6" fill="#fff" opacity=".5"/></svg>`);
const base = (th, o) => ({ url: 'ws://x', token: 'x', video: false, outgoing: false, group: false, canAdd: true, tcp: false, link: false, owner: false, quality: 'high', waiting: [], devices: {}, peer: { id: 5, name: 'Алиса Иванова' }, theme: { dark: th === 'navy', accent: ACC[th] }, platform: 'darwin', ...o });
// kind: call | callin; w/h — размер окна (call: как в main.js 1040x700)
const SC = th => ({
  'call-audio': { kind: 'call', w: 1040, h: 700, init: base(th, {}), remote: [R('u5', 'Алиса Иванова', 0, 1)], quality: 'excellent', skew: 134000 },
  'call-video': { kind: 'call', w: 1040, h: 700, init: base(th, { video: true }), remote: [R('u5', 'Алиса Иванова', 1, 0)], selfCam: 1, quality: 'good', skew: 134000 },
  'call-group': { kind: 'call', w: 1100, h: 720, init: base(th, { group: true, peer: { id: 0, name: 'Проект Атлас' } }), remote: GR, selfCam: 1, speaking: ['u12'], skew: 134000 },
  'call-link': { kind: 'call', w: 1100, h: 720, init: base(th, { group: true, link: true, owner: true, waiting: [{ id: 7, name: 'Пётр Гость' }, { id: 8, name: 'Анна Гость' }], peer: { id: 0, name: 'Созвон по ссылке' } }),
    remote: [R('u12', 'Борис Кузнецов', 1, 1), R('g9', 'Олег Гость', 1, 0), R('g10', 'Ксения Гость', 0, 1)], selfCam: 1, speaking: ['g9'], skew: 61000 },
  'call-pick': { kind: 'call', w: 1040, h: 700, init: base(th, { video: true }), remote: [R('u5', 'Алиса Иванова', 1, 1)], selfCam: 1, skew: 134000,
    pick: [{ id: 's1', name: 'Основной дисплей', screen: true, thumb: thumb('#3b5b7a') }, { id: 's2', name: 'Safari', thumb: thumb('#7a5b3b') }, { id: 's3', name: 'Заметки', thumb: thumb('#5b7a3b') }] },
  'call-add': { kind: 'call', w: 1040, h: 700, init: base(th, { video: true }), remote: [R('u5', 'Алиса Иванова', 1, 1)], selfCam: 1, skew: 134000,
    js: `__cmd({cmd:'pick',list:[{id:21,name:'Борис Кузнецов'},{id:22,name:'Мария Орлова'},{id:23,name:'Дмитрий Волков'},{id:24,name:'Елена Смирнова'}]})` },
  'callin-audio': { kind: 'callin', w: 372, h: 138, init: base(th, { name: 'Алиса Иванова', sub: '', bg: 'linear-gradient(135deg,hsl(210 62% 52%),hsl(238 68% 40%))', camera: false }) },
  'callin-video': { kind: 'callin', w: 372, h: 196, init: base(th, { video: true, name: 'Алиса Иванова', bg: 'linear-gradient(135deg,hsl(210 62% 52%),hsl(238 68% 40%))', camera: false }) },
  'callin-video-cam': { kind: 'callin', w: 372, h: 322, init: base(th, { video: true, name: 'Алиса Иванова', bg: 'linear-gradient(135deg,hsl(210 62% 52%),hsl(238 68% 40%))', camera: true }) },
  'callin-group': { kind: 'callin', w: 372, h: 206, init: base(th, { video: true, group: true, name: 'Проект Атлас', by: 'Борис Кузнецов', count: 5, bg: 'linear-gradient(135deg,hsl(160 62% 52%),hsl(188 68% 40%))', camera: false }) },
  'callin-group-audio': { kind: 'callin', w: 372, h: 148, init: base(th, { group: true, name: 'Проект Атлас', by: 'Борис Кузнецов', count: 5, bg: 'linear-gradient(135deg,hsl(160 62% 52%),hsl(188 68% 40%))', camera: false }) },
});
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const th of ['light', 'navy'].filter(t => !onlyTheme || onlyTheme === t)) {
    for (const [name, sc] of Object.entries(SC(th))) {
      if (onlySc && !name.startsWith(onlySc)) continue;
      const f = path.join(SCDIR, 'sc.json'); fs.writeFileSync(f, JSON.stringify(sc)); process.env.SHOT_CALL = f;
      const ses = session.fromPartition('p' + Date.now() + name);
      ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /livekit-client/.test(d.url) }));
      const callin = sc.kind === 'callin';
      const w = new BrowserWindow({ show: false, useContentSize: true, width: sc.w, height: callin ? 400 : sc.h, frame: !callin ? true : false, transparent: callin, hasShadow: false,
        backgroundColor: callin ? undefined : (th === 'navy' ? '#18202a' : '#fdfcfa'),
        webPreferences: { session: ses, preload: path.join(__dirname, 'callwin-stub-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
      w.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2 || /^(ACTION|STATE)/.test(msg)) console.log('CONSOLE', name, th, level, msg.slice(0, 240), (src || '').split('/').pop() + ':' + line); });
      await w.loadFile(path.join(SRC, callin ? 'callin.html' : 'call.html'));
      await sleep(callin ? 900 : 2300);
      if (callin) {   // высота окна, которой хватает карточке (поля body: сверху 8, снизу 18); main.js задаёт свою — сравните
        const need = await w.webContents.executeJavaScript(`Math.ceil(document.getElementById('card').getBoundingClientRect().bottom + 18)`);
        console.log('NEED_H', name, th, need, '(в main.js сейчас', sc.h + ')'); w.setContentSize(sc.w, need); await sleep(300);
      }
      if (sc.js) { await w.webContents.executeJavaScript(sc.js); await sleep(400); }
      if (!callin) await w.webContents.executeJavaScript(`(()=>{const t=document.createElement('div');t.style.cssText='position:fixed;left:16px;top:20px;display:flex;gap:8px;z-index:99;-webkit-app-region:no-drag';t.innerHTML='<i style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840"></i>';document.body.appendChild(t)})()`);
      const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(out, `${name}-${th}.png`), img.toPNG());
      w.destroy();
    }
  }
  app.quit();
});
