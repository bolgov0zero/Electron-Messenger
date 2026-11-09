// Пример/быстрая проверка: node snap.js <outdir> [theme ...]  — живой /chat и макет в выбранных темах (по умолчанию light navy), открытая первая переписка
const L = require('./lib');
(async () => {
  const out = process.argv[2] || '.'; const themes = process.argv.slice(3).length ? process.argv.slice(3) : ['light', 'navy'];
  const { browser, page } = await L.launch();
  await L.loginLive(page);
  for (const t of themes) {
    await L.setThemeLive(page, t, 'teal');
    await L.openFirstChat(page);
    await L.sleep(1200);
    await L.shot(page, `${out}/live-${t}.png`);
  }
  console.log('ОШИБКИ КОНСОЛИ:', page.errors);
  await L.openMock(page, 'light', 'teal');
  for (const t of themes) { await L.openMock(page, t, 'teal'); await L.shot(page, `${out}/mock-${t}.png`); }
  await browser.close();
})();
