// /m сделан под телефон (жесты, размер кнопок, нижняя панель). На широком экране с мышью вместо него показываем
// заглушку со ссылкой на /chat — до первого layout, чтобы мобильный интерфейс не мелькал на компьютере
(function () {
  var mq = matchMedia('(min-width: 768px) and (pointer: fine)');
  function sync() { document.documentElement.classList.toggle('m-desktop', mq.matches); }
  sync(); mq.addEventListener('change', sync);
})();
