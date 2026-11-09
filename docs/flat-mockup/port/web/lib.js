// Инструменты снимков для переноса дизайна B в веб клиент /chat (Playwright, Chromium). См. README.md.
//   const L = require('./lib'); const { browser, page } = await L.launch();
//   await L.loginLive(page); await L.setThemeLive(page, 'light', 'teal'); await L.shot(page, 'live-light.png');
//   await L.openMock(page, 'navy', 'teal'); await L.shot(page, 'mock-navy.png');
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.STAND_URL || 'http://localhost:3999';
const USER = process.env.STAND_USER || 'mivanova';
const PASS = process.env.STAND_PASS || 'stand-Flat-2026';
const MOCK = path.resolve(__dirname, '../../index.html');
// Сессия входа (token + user) — рядом, вне репозитория (в scratchpad): вход ограничен по частоте, поэтому берём её повторно, пока токен жив
const STATE = process.env.STAND_STATE || path.join(
  '/private/tmp/claude-501/-Users-bolgov-Documents-My-Projects-Chat/a2e5f42b-e051-4254-8352-1798dc48a51c/scratchpad', 'web-session.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// theme: 'light' | 'dark' | 'navy' ('dark' и 'navy' в /chat — одна и та же тёмно-синяя); accent: teal | blue | indigo | plum | amber
const THEMES = ['light', 'dark', 'navy'];
const ACCENTS = ['teal', 'blue', 'indigo', 'plum', 'amber'];

// Запуск Chromium: окно 1440×900. Ошибки консоли собираются в page.errors
async function launch(opts = {}) {
  const browser = await chromium.launch({ headless: opts.headless !== false });
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 900 }, deviceScaleFactor: opts.scale || 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) page.errors.push('http ' + r.status() + ' ' + r.url().replace(BASE, '')); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + String(e).slice(0, 300)));
  return { browser, ctx, page };
}

async function getSession() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const r = await fetch(BASE + '/api/users/presence', { headers: { Authorization: 'Bearer ' + s.token } });
    if (r.ok) return s;
  } catch (e) {}
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  const j = await r.json();
  if (!j.token) throw new Error('вход не удался (лимит входов? подождите ~65 с): ' + JSON.stringify(j).slice(0, 200));
  const s = { token: j.token, user: j.user };
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s));
  return s;
}

// Вход в живой /chat: сессия кладётся в localStorage (electron_v2) до загрузки страницы, затем открывается /chat/ и ждётся список чатов
async function loginLive(page, opts = {}) {
  const s = await getSession();
  const settings = { theme: opts.theme || 'light', fontSize: 'medium', uiScale: 100 };
  await page.addInitScript(([sess, st]) => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('electron_v2', JSON.stringify({ server: location.host, token: sess.token, user: sess.user, settings: st }));
      localStorage.setItem('__seeded', '1');
    }
  }, [s, settings]);
  await page.goto(BASE + '/chat/', { waitUntil: 'load' });
  await page.waitForSelector('.chat-item', { timeout: 20000 }).catch(() => {});
  await sleep(700);
  return s;
}

// Тема и акцент в живом клиенте. Хранение: localStorage 'electron_v2' → JSON {server,token,user,settings:{theme,...}} (тема), 'accent' (ключ акцента).
// Применяется функциями app.js (S.settings.theme + applySettings/setAccent) и сохраняется через saveSession()
async function setThemeLive(page, theme = 'light', accent = 'teal') {
  if (!THEMES.includes(theme)) throw new Error('theme: ' + THEMES.join('|'));
  const t = theme === 'dark' ? 'navy' : theme;
  await page.evaluate(([t, a]) => {
    try { localStorage.setItem('accent', a); } catch (e) {}
    try {
      if (typeof S !== 'undefined' && typeof applySettings === 'function') {
        S.settings.theme = t; applySettings(); if (typeof saveSession === 'function') saveSession();
        if (typeof setAccent === 'function') setAccent(a);   // ключа может не быть в ACCENTS (например, blue) — тогда останется текущий акцент
        return;
      }
    } catch (e) {}
    const c = document.documentElement.classList; c.toggle('dark', t !== 'light'); c.toggle('navy', t === 'navy');
  }, [t, accent]);
  await sleep(450);
}

// Макет (file://): тема через setTheme() (то же, что кнопки #themeseg button[data-t]), акцент — S.acc + applyAccent() (то же, что клик по .accent-dot[data-acc] в «Настройках»).
// Панель сцен (.bar) скрывается, как в port/../shot.py. Для сцен: page.evaluate(`document.querySelector('#scenes2 [data-s=menu]').click()`)
async function openMock(page, theme = 'light', accent = 'teal') {
  await page.goto('file://' + MOCK.split('/').map(encodeURIComponent).join('/'));
  await sleep(900);
  await page.evaluate(([t, a]) => {
    const bar = document.querySelector('.bar'); if (bar) bar.style.display = 'none';
    dispatchEvent(new Event('resize'));
    setTheme(t); S.acc = a; applyAccent();
  }, [theme, accent]);
  await sleep(500);
}

// Открыть первый чат списка (если первой стоит комната — входит в неё и открывает первую тему)
async function openFirstChat(page) {
  for (let i = 0; i < 3 && !(await page.$('.messages-wrap .msg-bubble, .msg-bubble')); i++) {
    await page.evaluate(() => { const c = document.querySelector('.topics-panel:not([hidden]) .chat-item') || document.querySelector('.chat-item'); if (c) c.click(); });
    await sleep(1200);
  }
}

// Снимок: shot(page, 'out.png') или с областью shot(page, 'out.png', {x,y,width,height}); создаёт папку
async function shot(page, file, clip) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  return file;
}

module.exports = { BASE, USER, MOCK, STATE, THEMES, ACCENTS, launch, openFirstChat, loginLive, setThemeLive, openMock, shot, sleep };
