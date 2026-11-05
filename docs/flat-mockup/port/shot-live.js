// Снимки ЖИВОГО /m настоящим Electron (стенд serve.sh). Запуск из папки client:
//   cd client && npx electron ../docs/flat-mockup/port/shot-live.js <config.json> [тема]   (или live.sh из этой папки: все темы по очереди)
// config: { base:"http://localhost:3999", user, pass, outdir, safe:{top:59,bottom:34}, load:2500,
//           runs:[ { theme:"light|dark|navy", accent:"teal", shots:[ { name, js, wait } ] } ] }
// В каждом прогоне — чистая сессия в памяти: вход по API, тема/акцент в localStorage до загрузки, безопасные зоны iPhone (в Electron
// env(safe-area-*) = 0) подставляются в переменные .phone: --sat0 = верх, --sat = верх + 24, --sab = низ (при ширине 393 --sc = 1).
// Сообщения консоли уровня warning/error печатаются как CONSOLE.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();
// чистый профиль на каждый запуск: хранилище, кэш и сервис-воркеры прошлых запусков не влияют на снимок
const PROFILE = fs.mkdtempSync(path.join(require('os').tmpdir(), 'shot-profile-'));
app.setPath('userData', PROFILE);
app.on('quit', () => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });
app.whenReady().then(async () => {
  const lr = await (await fetch(cfg.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: cfg.user, password: cfg.pass }) })).json();
  const safe = cfg.safe || { top: 59, bottom: 34 };
  fs.mkdirSync(cfg.outdir, { recursive: true });
  // одно окно на все прогоны (второе окно с той же страницей в Electron не грузится): между прогонами хранилище и сервис-воркер сбрасываются
  const w = new BrowserWindow({ show: false, useContentSize: true, width: cfg.width || 393, height: cfg.height || 852, webPreferences: { backgroundThrottling: false } });
  w.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2) console.log('CONSOLE', level, msg.slice(0, 240), (src || '').split('/').pop() + ':' + line); });
  const only = process.argv[3];   // один прогон за запуск надёжнее: повторная навигация окна Electron на тот же адрес иногда виснет
  for (const run of cfg.runs.filter(r => !only || r.theme === only)) {
    await w.loadURL(cfg.base + '/m/boot-version.js');
    await w.webContents.executeJavaScript(`(async()=>{localStorage.clear();
      try{await Promise.race([(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k)})(),new Promise(r=>setTimeout(r,1500))])}catch(e){}
      localStorage.setItem('electron_v2',JSON.stringify({server:location.host,token:${JSON.stringify(lr.token)},user:${JSON.stringify(lr.user)},settings:{theme:${JSON.stringify(run.theme === 'light' ? 'light' : 'dark')}}}));
      localStorage.setItem('beta_theme',${JSON.stringify(run.theme || 'dark')});localStorage.setItem('accent',${JSON.stringify(run.accent || 'teal')});
      ${(run.storage || []).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')} })()`);
    await w.loadURL(cfg.base + '/m/');
    await sleep(cfg.load || 2500);
    await w.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=setInterval(()=>{if((window.B&&B.S&&B.S.chats&&B.S.chats.length)||++n>80){clearInterval(t);r()}},100)})`);
    await w.webContents.executeJavaScript(`(()=>{const p=document.getElementById('app');p.style.setProperty('--sat0','${safe.top}px');p.style.setProperty('--sat','${safe.top + 24}px');p.style.setProperty('--sab','${safe.bottom}px');})()`);
    for (const s of run.shots) {
      if (s.js) { try { const r = await w.webContents.executeJavaScript(s.js); if (r !== undefined && s.log) console.log(s.name || '', JSON.stringify(r)); } catch (e) { console.log('ERR', s.name, e.message); } }
      await sleep(s.wait || 700);
      if (s.name) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(cfg.outdir, `${s.name}-${run.theme}${run.tag || ''}.png`), img.toPNG()); }
    }
  }
  app.quit();
});
