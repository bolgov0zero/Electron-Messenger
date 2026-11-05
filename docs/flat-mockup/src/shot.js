// Снимки макета через Electron: electron shot.js <steps.json>
// steps.json: {"url":..., "width":1500, "height":960, "steps":[{"js":"...","wait":400,"out":"/path/a.png"}]}
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: cfg.width || 1500, height: cfg.height || 960, webPreferences: { offscreen: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) console.log('CONSOLE', level, msg, src + ':' + line); });
  w.webContents.on('render-process-gone', () => console.log('RENDERER GONE'));
  await w.loadURL(cfg.url);
  await sleep(cfg.load || 1800);
  for (const s of cfg.steps) {
    if (s.js) { try { const r = await w.webContents.executeJavaScript(s.js); if (r !== undefined && s.log) console.log(JSON.stringify(r)); } catch (e) { console.log('ERR', e.message); } }
    await sleep(s.wait || 500);
    if (s.out) { const img = await w.webContents.capturePage(); fs.writeFileSync(s.out, img.toPNG()); }
  }
  app.quit();
});
