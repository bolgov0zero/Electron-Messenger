// Ранний сценарий основного окна (CSP не разрешает inline-скрипты). Подключается первым в <head>.
// Плоский дизайн B: выделение в списках скользит без пружины (slidesel.js читает флаг)
window.SLIDESEL_FLAT = true;
// Тема до первой отрисовки, без вспышки. В settings.theme: system | light | navy; прежнее «dark» читается как «system»,
// «system» следует prefers-color-scheme (тёмная → navy, светлая → light). Класс dark означает «любая тёмная» (= тёмно-синяя).
// Окончательно тему ставит app.js applySettings().
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('electron_v2') || '{}'), p = (s.settings && s.settings.theme) || 'system';
    if (p !== 'light' && p !== 'navy') p = 'system';
    var sysDark = false; try { sysDark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    var t = p === 'system' ? (sysDark ? 'navy' : 'light') : p, c = document.documentElement.classList;
    c.toggle('dark', t === 'navy'); c.toggle('navy', t === 'navy');
  } catch (e) {}
})();
