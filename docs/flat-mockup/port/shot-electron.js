// Снимки ОСНОВНОГО окна Электрона (client/src/index.html) настоящим Electron на стенде serve.sh. Запуск из папки client:
//   cd client && npx electron ../docs/flat-mockup/port/shot-electron.js <config.json> [тема]
// (или shot-electron.sh <config.json> [темы…]: все темы по очереди). Главный процесс (main.js) не запускается: вместо preload.js
// подставляется electron-stub-preload.js, он отдаёт приложению сессию, общие настройки и список учётных записей из конфига.
// config: { base:"http://localhost:3997", user, pass, outdir, width:1500, height:960, platform:"darwin", load:2500, login:true|false,
//           accounts:[{name,userId?,unread?,status?}] (необязательно), runs:[ { theme:"light|navy|system", accent:"teal", shots:[ { name, js, wait, log } ] } ] }
// Сообщения консоли уровня warning/error печатаются как CONSOLE. login:false — без сессии (экран входа).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();
const PROFILE = fs.mkdtempSync(path.join(require('os').tmpdir(), 'shot-e-profile-'));
app.setPath('userData', PROFILE);
app.on('quit', () => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });
const SRC = path.resolve(__dirname, '../../../client/src/index.html');
app.whenReady().then(async () => {
  const host = new URL(cfg.base).host;
  const lr = await (await fetch(cfg.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: cfg.user, password: cfg.pass }) })).json();
  fs.mkdirSync(cfg.outdir, { recursive: true });
  for (const run of cfg.runs.filter(r => !only || r.theme === only)) {
    const accounts = cfg.accounts ? {
      accounts: cfg.accounts.map((a, i) => ({ id: 'a' + i, unread: a.unread || 0, status: a.status || 'online',
        meta: { server: a.server || host, userId: a.userId || lr.user.id, name: a.name, tag: a.tag ?? null, serverName: a.serverName || '' } })),
      activeId: 'a0', selfId: 'a0', active: true } : null;
    const stub = path.join(PROFILE, 'stub.json');
    fs.writeFileSync(stub, JSON.stringify({
      platform: cfg.platform || 'darwin', version: cfg.version,
      session: cfg.login === false ? null : { server: host, token: lr.token, user: lr.user, settings: { theme: run.theme } },
      shared: { theme: run.theme, accent: run.accent || 'teal', ...(run.shared || {}) }, accounts }));
    process.env.SHOT_STUB = stub;
    const w = new BrowserWindow({ show: false, useContentSize: true, width: cfg.width || 1500, height: cfg.height || 960,
      webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'electron-stub-preload.js'), partition: 'run' + Date.now(), contextIsolation: true, sandbox: false } });
    w.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 2) console.log('CONSOLE', level, msg.slice(0, 240), (src || '').split('/').pop() + ':' + line); });
    await w.loadFile(SRC);
    await sleep(cfg.load || 2500);
    if (cfg.login !== false) await w.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=setInterval(()=>{if((window.S&&S.chats&&S.chats.length)||++n>80){clearInterval(t);r()}},100)})`);
    for (const s of run.shots) {
      if (s.js) { try { const r = await w.webContents.executeJavaScript(s.js); if (r !== undefined && s.log) console.log(s.name || '', JSON.stringify(r)); } catch (e) { console.log('ERR', s.name, e.message); } }
      await sleep(s.wait || 700);
      if (s.name) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(cfg.outdir, `${s.name}-${run.theme}${run.tag || ''}.png`), img.toPNG()); }
    }
    w.destroy();
  }
  app.quit();
});
