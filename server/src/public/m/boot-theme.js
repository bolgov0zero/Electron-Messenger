// Тема — до первой отрисовки, без вспышки. Настройка общая с /chat и /m (electron_v2 → settings.theme):
// «light» — светлая, любое другое значение (dark, night) — тёмно-синяя.
(function () {
  var t = 'dark';
  try {
    var s = JSON.parse(localStorage.getItem('electron_v2') || '{}');
    t = (s.settings && s.settings.theme) || 'dark';
  } catch (e) {}
  // Своя настройка беты («тёмно-синяя» хранится только здесь): light, dark или navy
  try { var bt = localStorage.getItem('beta_theme'); if (bt === 'light' || bt === 'dark' || bt === 'navy') t = bt; } catch (e) {}
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
  link.href = dark ? '/m/manifest.json' : '/m/manifest-light.json';
  document.head.appendChild(link);
  var meta = document.createElement('meta');
  meta.name = 'theme-color'; meta.id = 'theme-color-meta'; meta.content = t === 'navy' ? '#0f1b27' : dark ? '#12171d' : '#e3f0ef';
  document.head.appendChild(meta);
})();
