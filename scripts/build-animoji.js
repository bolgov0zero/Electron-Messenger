#!/usr/bin/env node
// Собирает набор анимированных смайлов для модуля «Анимированные смайлы».
//
// Берём смайлы и жесты из нашего списка (emoji-data.js) и оставляем те, у которых
// у Noto есть анимация. Файлы Lottie скачиваем с серверов Google, сжимаем (убираем
// пробелы в JSON) и кладём на наш сервер: клиенты качают их у нас, а не у Google.
// Рядом пишем manifest.json: версия набора и для каждого смайла файл и кадр покоя.
//
// Анимации: Noto Emoji Animation (Google), CC BY 4.0.
// Запуск: node scripts/build-animoji.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EMOJI_DATA = path.join(ROOT, 'client', 'src', 'emoji-data.js');
const OUT = path.join(ROOT, 'server', 'src', 'public', 'modules', 'animoji');
const API = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
const FILE = cp => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json`;
const GROUPS = ['smile', 'hands'];   // какие группы нашей панели получают анимацию

// Ключ смайла: кодовые точки через «_» без селектора начертания fe0f
const keyOf = s => [...s].map(c => c.codePointAt(0).toString(16)).filter(x => x !== 'fe0f').join('_');

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r;
}

(async () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(EMOJI_DATA, 'utf8') + ';this.G = EMOJI_GROUPS', ctx);
  const ours = ctx.G.filter(g => GROUPS.includes(g.key)).flatMap(g => g.items);

  const api = (await (await get(API)).json()).icons;
  const byKey = new Map(api.map(i => [i.codepoint.split('_').filter(x => x !== 'fe0f').join('_'), i.codepoint]));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'lottie'), { recursive: true });

  const items = {};
  let bytes = 0;
  const todo = ours.map(e => ({ e, k: keyOf(e), file: byKey.get(keyOf(e)) })).filter(x => x.file);
  // Скачиваем пачками, чтобы не душить сервер Google
  for (let i = 0; i < todo.length; i += 12) {
    await Promise.all(todo.slice(i, i + 12).map(async ({ e, k, file }) => {
      const data = JSON.parse(await (await get(FILE(file))).text());
      const rest = (data.markers || []).find(m => m.cm === 'rest');
      const json = JSON.stringify(data);
      fs.writeFileSync(path.join(OUT, 'lottie', k + '.json'), json);
      bytes += Buffer.byteLength(json);
      items[k] = { r: rest ? rest.tm : 0, s: Buffer.byteLength(json) };
    }));
    process.stdout.write(`\r${Math.min(i + 12, todo.length)} / ${todo.length}`);
  }
  process.stdout.write('\n');

  const manifest = { version: 1, count: Object.keys(items).length, bytes, license: 'Noto Emoji Animation, Google, CC BY 4.0', items };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  console.log(`Готово: ${manifest.count} анимаций, ${(bytes / 1048576).toFixed(1)} МБ → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
