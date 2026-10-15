// /m — тема. Две темы: светлая и тёмно-синяя. Настройка общая с /chat и /m (electron_v2 → settings.theme);
// «light» — светлая, любое другое значение (dark, night) — тёмно-синяя.
B.theme = {
  SESSION_KEY: 'electron_v2',
  get: function () { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; },
  set: function (t) {
    var dark = t !== 'light';
    document.documentElement.classList.toggle('dark', dark);
    var meta = document.getElementById('theme-color-meta');
    if (meta) meta.content = dark ? '#1c2835' : '#f6f6f7';
    if (B.appearance) B.appearance.apply();   // оттенок акцента и узора зависит от темы
    // Манифест читается один раз при запуске PWA, поэтому цвет системной полосы сменится при следующем запуске
    var link = document.getElementById('manifest-link');
    if (link) link.href = dark ? '/m/manifest.json' : '/m/manifest-light.json';
    try {
      var s = JSON.parse(localStorage.getItem(this.SESSION_KEY) || '{}');
      s.settings = s.settings || {};
      // «night» остаётся «night»: для /m это та же тёмная тема, а /m и /chat не теряют свой выбор
      if (dark) { if (s.settings.theme === 'light' || !s.settings.theme) s.settings.theme = 'dark'; } else s.settings.theme = 'light';
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(s));
    } catch (e) {}
  }
};
