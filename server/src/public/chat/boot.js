// Применяем масштаб интерфейса ДО первого layout — без вспышки и без overflow
(function(){try{var s=JSON.parse(localStorage.getItem('electron_v2')||'{}');var z=(s.settings&&s.settings.uiScale)||100;var r=z/100;var d=document.documentElement;if(r!==1){d.style.zoom=z+'%';d.style.setProperty('--vh100','calc(100dvh / '+r+')');d.style.setProperty('--vw100','calc(100vw / '+r+')');}}catch(e){}})();
// /chat — десктопная веб-версия, под телефон не адаптирована (для этого есть
// отдельный /m). До первого layout показываем заглушку со ссылкой на /m,
// чтобы десктопный интерфейс не мелькал на маленьком экране.
(function(){
  var mq = matchMedia('(max-width: 767px), (pointer: coarse)');
  function sync(){ document.documentElement.classList.toggle('chat-phone', mq.matches); }
  sync(); mq.addEventListener('change', sync);
})();
