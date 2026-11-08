// Тема — до первой отрисовки, без вспышки. Настройка общая с /chat и /m (electron_v2 → settings.theme):
// «light» — светлая, любое другое значение — тёмно-синяя (единственная тёмная тема).
(function () {
  // Выбор темы: system (следует за системной), light или navy. Прежнее «dark» читается как «система»
  var pref = 'system';
  try {
    var s0 = JSON.parse(localStorage.getItem('electron_v2') || '{}');
    if (s0.settings && s0.settings.theme === 'light') pref = 'light';
  } catch (e) {}
  try { var bt = localStorage.getItem('beta_theme'); if (bt === 'light' || bt === 'navy' || bt === 'system') pref = bt; else if (bt === 'dark') pref = 'system'; } catch (e) {}
  var sysDark = false;
  try { sysDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
  var t = pref === 'system' ? (sysDark ? 'navy' : 'light') : pref;
  var dark = t !== 'light';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('navy', t === 'navy');
  // Отступы-запасы, подобранные на телефоне (экран диагностики)
  try {
    var hs = document.documentElement.style;
    var a = localStorage.getItem('beta_sat_extra'), b = localStorage.getItem('beta_sab_extra');
    if (a !== null) hs.setProperty('--sat-extra', parseInt(a, 10) + 'px');
    if (b !== null) hs.setProperty('--sab-extra', parseInt(b, 10) + 'px');
  } catch (e) {}
  // У standalone-PWA системную полосу красит именно манифест, а не <meta theme-color>, а читается он один раз
  // при запуске — поэтому <link rel="manifest"> ставим сами, сразу под нужную тему
  var link = document.createElement('link');
  link.rel = 'manifest'; link.id = 'manifest-link';
  link.href = dark ? '/m/manifest-navy.json' : '/m/manifest-light.json';
  document.head.appendChild(link);
  var meta = document.createElement('meta');
  meta.name = 'theme-color'; meta.id = 'theme-color-meta'; meta.content = dark ? '#10161d' : '#ece9e4';
  document.head.appendChild(meta);
})();
