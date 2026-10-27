// /m — внешний вид: акцент, фон и узор переписки, размер текста. Ключи хранилища общие с /chat и /m,
// поэтому выбор человека одинаков во всех клиентах: 'accent', 'chatBg', 'chatPattern', 'chatPatternLevel', settings.fontSize.
B.appearance = {
  ACCENTS: {
    blue:   { name: 'Синий',      light: [51, 144, 236], dark: [76, 160, 244] },
    teal:   { name: 'Бирюзовый',  light: [29, 168, 140], dark: [41, 214, 184] },
    indigo: { name: 'Индиго',     light: [92, 96, 205],  dark: [143, 148, 245] },
    plum:   { name: 'Сливовый',   light: [146, 84, 190], dark: [196, 146, 240] },
    amber:  { name: 'Янтарный',   light: [186, 120, 38], dark: [236, 176, 92] }
  },
  PATTERNS: [
    { id: '', name: 'Без узора' }, { id: 'pets', name: 'Питомцы' }, { id: 'doodles', name: 'Каракули' },
    { id: 'summer', name: 'Лето' }, { id: 'daily', name: 'Будни' }, { id: 'steampunk', name: 'Стимпанк' }
  ],
  ALPHA: { light: [0.045, 0.07, 0.105], dark: [0.055, 0.085, 0.13] },
  FONTS: { small: '14px', medium: '16px', large: '18px' },
  _ls: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  _set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  settings: function () { try { return (JSON.parse(localStorage.getItem(B.SESSION_KEY)) || {}).settings || {}; } catch (e) { return {}; } },
  saveSetting: function (key, value) {
    var prev = {}; try { prev = JSON.parse(localStorage.getItem(B.SESSION_KEY)) || {}; } catch (e) {}
    prev.settings = Object.assign({}, prev.settings, (function (o) { o[key] = value; return o; })({}));
    B.appearance._set(B.SESSION_KEY, JSON.stringify(prev));
  },
  accent: function () { var v = B.appearance._ls('accent'); return B.appearance.ACCENTS[v] ? v : 'blue'; },
  pattern: function () { var v = B.appearance._ls('chatPattern'); return B.appearance.PATTERNS.some(function (p) { return p.id === v && v; }) ? v : ''; },
  patternLevel: function () { var n = Number(B.appearance._ls('chatPatternLevel')); return n === 1 || n === 3 ? n : 2; },
  chatBg: function () { return B.appearance._ls('chatBg') === 'split' ? 'split' : 'plain'; },
  fontSize: function () { var f = B.appearance.settings().fontSize; return B.appearance.FONTS[f] ? f : 'medium'; },
  isDark: function () { return document.documentElement.classList.contains('dark'); },
  rgb: function (key) { var a = B.appearance.ACCENTS[key]; return B.appearance.isDark() ? a.dark : a.light; },

  apply: function () {
    var A = B.appearance, s = document.documentElement.style, dark = A.isDark();
    var id = A.pattern();
    if (!id) { ['--pat', '--pat-ink', '--pat-a'].forEach(function (k) { s.removeProperty(k); }); }
    else { s.setProperty('--pat', 'url("/chat/assets/patterns/' + id + '.png")'); s.setProperty('--pat-ink', dark ? '#ffffff' : '#111318'); s.setProperty('--pat-a', String(A.ALPHA[dark ? 'dark' : 'light'][A.patternLevel() - 1])); }
    document.documentElement.classList.toggle('wall-flat', A.chatBg() === 'split');
    s.setProperty('--mfs', A.FONTS[A.fontSize()]);
  },
  setAccent: function (k) { if (!B.appearance.ACCENTS[k]) return; B.appearance._set('accent', k); B.appearance.apply(); },
  setPattern: function (id) { B.appearance._set('chatPattern', id || ''); B.appearance.apply(); },
  setPatternLevel: function (n) { B.appearance._set('chatPatternLevel', String(n)); B.appearance.apply(); },
  setChatBg: function (m) { B.appearance._set('chatBg', m === 'split' ? 'split' : 'plain'); B.appearance.apply(); },
  setFontSize: function (f) { B.appearance.saveSetting('fontSize', f); B.appearance.apply(); }
};
B.appearance.apply();
