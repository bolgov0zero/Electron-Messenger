// Шаг 2. Рисует каждый глиф из work/tasks.json в PNG 160×150 при кегле 128 px
// (2048 единиц на em, база на 119 px от верха, спуск 31 px, ширина 2560 единиц).
// Документы у Google большие (в одном до двух тысяч глифов), поэтому для каждого глифа
// собираем маленький SVG: его блок и только те определения (градиенты, контуры), на которые он ссылается.
// Запуск: Electron из client/node_modules (см. build.sh).
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const WORK = process.env.WORK;
const PAGE = `
window.prep = (src) => {
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  window.__byId = new Map(); doc.querySelectorAll('[id]').forEach(e => window.__byId.set(e.getAttribute('id'), e));
  window.__ser = new XMLSerializer();
};
const refs = (el, acc) => {
  const take = v => { for (const m of v.matchAll(/#([^\\s)"']+)/g)) acc.add(m[1]); };
  const walk = e => { for (const a of e.attributes) take(a.value); for (const c of e.children) walk(c); };
  walk(el);
};
window.one = async (id) => {
  const g = window.__byId.get('glyph' + id); if (!g) return null;
  const need = new Set(), seen = new Set(); refs(g, need);
  const queue = [...need]; const defs = [];
  while (queue.length) {
    const k = queue.pop(); if (seen.has(k)) continue; seen.add(k);
    const e = window.__byId.get(k); if (!e || e === g) continue;
    defs.push(e); const more = new Set(); refs(e, more); more.forEach(x => queue.push(x));
  }
  const body = defs.map(e => window.__ser.serializeToString(e)).join('') ;
  const s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="160" height="150" viewBox="0 -1904 2560 2400"><defs>' + body + '</defs>' + window.__ser.serializeToString(g) + '</svg>';
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('svg ' + id)); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); });
  const c = document.createElement('canvas'); c.width = 160; c.height = 150;
  c.getContext('2d').drawImage(img, 0, 0, 160, 150);
  return c.toDataURL('image/png');
};
0;`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 300, height: 200 });
  await w.loadURL('data:text/html,<meta charset=utf-8>');
  await w.webContents.executeJavaScript(PAGE);
  const { tasks } = JSON.parse(fs.readFileSync(path.join(WORK, 'tasks.json'), 'utf8'));
  fs.mkdirSync(path.join(WORK, 'png'), { recursive: true });
  const byDoc = {};
  tasks.forEach(t => { (byDoc[t[0] + '_' + t[1]] = byDoc[t[0] + '_' + t[1]] || []).push(t); });
  let done = 0, empty = 0;
  for (const [doc, list] of Object.entries(byDoc)) {
    if (list.every(t => fs.existsSync(path.join(WORK, 'png', `${t[0]}_${t[2]}.png`)))) { done += list.length; continue; }
    await w.webContents.executeJavaScript('prep(' + JSON.stringify(fs.readFileSync(path.join(WORK, 'docs', doc + '.svg'), 'utf8')) + ')');
    for (let i = 0; i < list.length; i += 50) {
      const part = list.slice(i, i + 50);
      const res = await w.webContents.executeJavaScript('Promise.all(' + JSON.stringify(part.map(t => t[2])) + '.map(id => one(id)))');
      part.forEach((t, j) => { if (!res[j]) { empty++; return; } fs.writeFileSync(path.join(WORK, 'png', `${t[0]}_${t[2]}.png`), Buffer.from(res[j].split(',')[1], 'base64')); });
      done += part.length; process.stdout.write(`\r${done} / ${tasks.length}`);
    }
  }
  console.log(`\nготово, без блока: ${empty}`);
  app.quit();
});
