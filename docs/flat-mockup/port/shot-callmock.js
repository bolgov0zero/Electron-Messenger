// Эталонные снимки макета docs/flat-mockup/calls.html (ячейка «Клиент») для сравнения с окнами звонков. Запуск из client:
//   cd client && npx electron ../docs/flat-mockup/port/shot-callmock.js <папка> [светлая|navy]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const out = process.argv[2], only = process.argv[3];
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ show: false, useContentSize: true, width: 1500, height: 1000, webPreferences: { backgroundThrottling: false } });
  await w.loadFile(path.resolve(__dirname, '../calls.html'));
  const names = ['in-audio', 'audio', 'in-video', 'video', 'in-group', 'group'];
  for (const dark of [0, 1]) {
    const th = dark ? 'navy' : 'light'; if (only && only !== th) continue;
    for (let i = 0; i < names.length; i++) {
      await w.webContents.executeJavaScript(`st.sc=${i};st.pf=1;st.dark=${!!dark};render()`);
      await new Promise(r => setTimeout(r, 600));
      fs.writeFileSync(path.join(out, `mock-${names[i]}-${th}.png`), (await w.webContents.capturePage()).toPNG());
    }
  }
  app.quit();
});
