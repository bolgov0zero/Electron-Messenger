#!/usr/bin/env node
// Собирает список смайлов для панели: состав, порядок и разделы берём из
// emoji-test.txt (Unicode), русские названия и слова для поиска — из аннотаций
// CLDR. Раньше список был написан руками и урезан до тех, что рисовались в
// Windows; теперь шрифт возим с собой, и ограничение снято — можно брать весь
// набор.
//
// Исходники не храним в проекте (полтора мегабайта разметки, нужной раз в год) —
// скрипт скачивает их сам. В репозиторий попадает только готовый emoji-data.js.
//
// Запуск: node scripts/build-emoji.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = [
  path.join(ROOT, 'client', 'src', 'emoji-data.js'),
  path.join(ROOT, 'server', 'src', 'public', 'chat', 'emoji-data.js'),
];

const SRC = {
  test: 'https://unicode.org/Public/emoji/latest/emoji-test.txt',
  ru: 'https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotations/ru.xml',
  ruDerived: 'https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotationsDerived/ru.xml',
};

// Google Fonts не отдаёт этот символ ни в одном куске шрифта: устаревшая
// «семья», вместо неё в наборе есть последовательности 👨‍👩‍👦 и другие.
// Оставить — значит показать в панели пустой квадрат.
const UNSUPPORTED = new Set(['\u{1F46A}']);

const SKIN = /[\u{1F3FB}-\u{1F3FF}]/u;  // модификаторы цвета кожи
const HAIR = /[\u{1F9B0}-\u{1F9B3}]/u;  // варианты волос

// Раздел «Жесты» существовал и раньше — Unicode кладёт руки внутрь «People & Body»,
// поэтому вытаскиваем их по подгруппам, чтобы вкладки остались привычными
const HAND_SUBS = new Set(['hand-fingers-open', 'hand-fingers-partial', 'hand-single-finger',
  'hand-fingers-closed', 'hands', 'hand-prop', 'body-parts']);

const TABS = [
  { key: 'smile',  icon: '😀',  name: 'Смайлы',             match: g => g === 'Smileys & Emotion' },
  { key: 'hands',  icon: '👍',  name: 'Жесты',              match: (g, s) => g === 'People & Body' && HAND_SUBS.has(s) },
  { key: 'people', icon: '🧑',  name: 'Люди',               match: (g, s) => g === 'People & Body' && !HAND_SUBS.has(s) },
  { key: 'nature', icon: '🐶',  name: 'Животные и природа', match: g => g === 'Animals & Nature' },
  { key: 'food',   icon: '🍕',  name: 'Еда и напитки',      match: g => g === 'Food & Drink' },
  { key: 'travel', icon: '✈️', name: 'Путешествия',        match: g => g === 'Travel & Places' },
  { key: 'act',    icon: '⚽',  name: 'Занятия',            match: g => g === 'Activities' },
  { key: 'obj',    icon: '💡',  name: 'Предметы',           match: g => g === 'Objects' },
  { key: 'sym',    icon: '❤️', name: 'Символы',            match: g => g === 'Symbols' },
  { key: 'flag',   icon: '🚩',  name: 'Флаги',              match: g => g === 'Flags' },
];

const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

(async () => {
  const get = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.text();
  };
  const [test, ru1, ru2] = await Promise.all([get(SRC.test), get(SRC.ru), get(SRC.ruDerived)]);

  // ── русские описания ──
  const ru = {};
  for (const xml of [ru1, ru2]) {
    for (const m of xml.matchAll(/<annotation cp="([^"]*)"(\s+type="tts")?\s*>([^<]*)<\/annotation>/g)) {
      const cp = unesc(m[1]), text = unesc(m[3]);
      ru[cp] = ru[cp] || {};
      if (m[2]) ru[cp].name = text.trim();
      else ru[cp].kw = text.split('|').map(s => s.trim()).filter(Boolean);
    }
  }

  // ── состав и порядок ──
  let group = null, sub = null;
  const tabs = TABS.map(t => ({ key: t.key, icon: t.icon, name: t.name, items: [] }));
  const words = {};
  let total = 0, noRu = 0;

  for (const line of test.split('\n')) {
    const g = line.match(/^# group: (.+)$/);    if (g) { group = g[1].trim(); continue; }
    const s = line.match(/^# subgroup: (.+)$/); if (s) { sub = s[1].trim(); continue; }
    if (!line.trim() || line.startsWith('#')) continue;
    const m = line.match(/^([0-9A-F ]+);\s*(\S+)\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/);
    if (!m || m[2] !== 'fully-qualified') continue;
    const ch = m[3];
    if (SKIN.test(ch) || HAIR.test(ch) || UNSUPPORTED.has(ch)) continue;

    const i = TABS.findIndex(t => t.match(group, sub));
    if (i < 0) continue;
    tabs[i].items.push(ch);
    total++;

    // Строка для поиска: название плюс синонимы, без повторов и служебных слов
    const a = ru[ch] || ru[ch.replace(/️/g, '')] || {};
    if (!a.name && !a.kw) noRu++;
    const set = [];
    for (const part of [a.name || '', ...(a.kw || [])]) {
      for (const w of part.toLowerCase().replace(/[^\wа-яё\s-]/gi, ' ').split(/[\s-]+/)) {
        if (w.length > 1 && !set.includes(w)) set.push(w);
      }
    }
    words[ch] = set.slice(0, 14).join(' ');
  }

  const body = `// СГЕНЕРИРОВАНО scripts/build-emoji.js — руками не правим.
// Состав и порядок: Unicode emoji-test.txt. Названия и слова для поиска: CLDR (ru).
const EMOJI_GROUPS = ${JSON.stringify(tabs)};
const EMOJI_KEYWORDS = ${JSON.stringify(words)};
`;
  for (const p of OUT) fs.writeFileSync(p, body);
  console.log(`смайлов: ${total} | без русского описания: ${noRu} | размер: ${Math.round(body.length / 1024)} КБ`);
  tabs.forEach(t => console.log(`  ${t.name}: ${t.items.length}`));
})();
