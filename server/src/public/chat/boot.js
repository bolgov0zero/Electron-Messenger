// Применяем масштаб интерфейса ДО первого layout — без вспышки и без overflow
(function(){try{var s=JSON.parse(localStorage.getItem('electron_v2')||'{}');var z=(s.settings&&s.settings.uiScale)||100;var r=z/100;var d=document.documentElement;if(r!==1){d.style.zoom=z+'%';d.style.setProperty('--vh100','calc(100dvh / '+r+')');}}catch(e){}})();
// /chat — десктопная веб-версия, под телефон не адаптирована (для этого есть
// отдельный /m). До первого layout показываем заглушку со ссылкой на /m,
// чтобы десктопный интерфейс не мелькал на маленьком экране.
(function(){
  var mq = matchMedia('(max-width: 767px), (pointer: coarse)');
  function sync(){ document.documentElement.classList.toggle('chat-phone', mq.matches); }
  sync(); mq.addEventListener('change', sync);
})();
// Плоский дизайн B: выделение в списках скользит без пружины (shared/slidesel.js читает флаг; админка его не ставит)
window.SLIDESEL_FLAT = true;
// Тема до первой отрисовки, без вспышки (как m/boot-theme.js). Остались «Система» / «Светлая» / «Тёмно-синяя»: прежнее «dark» читается как «system»,
// «system» следует prefers-color-scheme (тёмная → navy, светлая → light). Класс dark означает «любая тёмная» (= тёмно-синяя). Окончательно тему ставит app.js applySettings().
(function(){try{
  var s=JSON.parse(localStorage.getItem('electron_v2')||'{}'),p=(s.settings&&s.settings.theme)||'system';
  if(p!=='light'&&p!=='navy')p='system';
  var sysDark=false;try{sysDark=matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){}
  var t=p==='system'?(sysDark?'navy':'light'):p,c=document.documentElement.classList;
  c.toggle('dark',t==='navy');c.toggle('navy',t==='navy');
}catch(e){}})();
