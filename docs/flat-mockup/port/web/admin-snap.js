// Снимки админки на стенде: node admin-snap.js <папка> [темы через запятую light,dark] [ширины 1440,390] [акцент teal]
const L = require('./lib.js');
const fs = require('fs'), path = require('path');
const BASE = process.env.STAND_URL || 'http://localhost:3991';
const SCR = process.env.SCRATCH || '/private/tmp/claude-501/-Users-bolgov-Documents-My-Projects-Chat/a2e5f42b-e051-4254-8352-1798dc48a51c/scratchpad';
const STATE = path.join(SCR, 'admin-session.json');
async function getSession() {
  try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); const r = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + s.token } }); if (r.ok) return s; } catch (e) {}
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mivanova', password: 'stand-Flat-2026', context: 'admin' }) });
  const j = await r.json(); if (!j.token) throw new Error('вход не удался (лимит? ~65 с): ' + JSON.stringify(j).slice(0, 200));
  const s = { token: j.token, user: j.user }; fs.writeFileSync(STATE, JSON.stringify(s)); return s;
}
async function open(page, s, theme, accent, pageId, rail) {
  await page.addInitScript(([sess, th, ac, pg, rl]) => {
    localStorage.setItem('admin_token', sess.token); localStorage.setItem('admin_user', JSON.stringify(sess.user));
    localStorage.setItem('electron-admin.theme', th); localStorage.setItem('electron-admin.accent', ac);
    localStorage.setItem('admin-page', pg); localStorage.setItem('admin-sb-rail', rl ? '1' : '0');
  }, [s, theme, accent, pageId, rail]);
  await page.goto(BASE + '/admin/', { waitUntil: 'load' });
  await page.waitForSelector('#app', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2500);
}
module.exports = { L, getSession, open, BASE };
if (require.main === module) (async () => {
  const dir = process.argv[2] || path.join(SCR, 'admin-shots');
  const themes = (process.argv[3] || 'light,dark').split(','), widths = (process.argv[4] || '1440,390').split(',').map(Number), accent = process.argv[5] || 'teal';
  fs.mkdirSync(dir, { recursive: true });
  const s = await getSession();
  for (const w of widths) for (const th of themes) {
    const { browser, page } = await L.launch({ width: w, height: w > 600 ? 900 : 844 });
    for (const [name, pg, rail, modal] of [['home', 'dashboard', false, false], ['users', 'users', false, false], ['modal', 'users', false, true], ['rail', 'dashboard', true, false]]) {
      if (w < 600 && name === 'rail') continue;
      const ctxPage = page;
      await open(ctxPage, s, th, accent, pg, rail);
      if (modal) { await ctxPage.evaluate(() => openCreateUser()); await ctxPage.waitForTimeout(700); }
      await L.shot(ctxPage, path.join(dir, `${name}-${th}-${w}.png`));
    }
    const er = page.errors.filter(e => !/avatar|Failed to load resource/.test(e)); console.log(w, th, 'ошибки (без 404 аватарок):', JSON.stringify(er));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
