// Эталонные снимки макета mobile.html в том же виде, что и живой /m (окно 393×852 включает в макете «настоящий телефон»:
// без рамки и статус-бара, см. real() в макете). Запуск из папки client:
//   cd client && npx electron ../docs/flat-mockup/port/shot-ref.js <config.json>
// config: { url:"file:///.../docs/flat-mockup/mobile.html", outdir, safe:{top:59,bottom:34}, load:1800,
//           runs:[ { theme, accent, shots:[ { name, scene:"chat"|js:"…", wait } ] } ] }
// scene — кнопка-сцена макета (data-s). Безопасные зоны ставятся теми же значениями, что и в shot-live.js.
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
  const safe = cfg.safe || { top: 59, bottom: 34 };
  fs.mkdirSync(cfg.outdir, { recursive: true });
  // одно окно на все прогоны: тема и акцент переключаются в самой странице (повторная загрузка file:// в новом окне Electron падает)
  const w = new BrowserWindow({ show: false, useContentSize: true, width: cfg.width || 393, height: cfg.height || 852, webPreferences: { backgroundThrottling: false } });
  w.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2) console.log('CONSOLE', level, msg.slice(0, 240), (src || '').split('/').pop() + ':' + line); });
  await w.loadURL(cfg.url);
  await sleep(cfg.load || 1800);
  await w.webContents.executeJavaScript(`(()=>{const p=document.getElementById('phone');p.style.setProperty('--sat0','${safe.top}px');p.style.setProperty('--sat','${safe.top + 24}px');p.style.setProperty('--sab','${safe.bottom}px');})()`);
  for (const run of cfg.runs) {
    await w.webContents.executeJavaScript(`(()=>{setTheme(${JSON.stringify(run.theme || 'dark')});S.acc=${JSON.stringify(run.accent || 'teal')};applyAccent();})()`);
    await sleep(400);
    for (const s of run.shots) {
      const js = s.js || (s.scene ? `document.querySelector('#scenes [data-s="${s.scene}"]').click()` : '');
      if (js) { try { await w.webContents.executeJavaScript(js); } catch (e) { console.log('ERR', s.name, e.message); } }
      await sleep(s.wait || 1400);
      if (s.name) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(cfg.outdir, `${s.name}-${run.theme}${run.tag || ''}.png`), img.toPNG()); }
    }
  }
  app.quit();
});
