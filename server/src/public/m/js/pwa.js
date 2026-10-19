// /m — установка как PWA: service worker (push), признак «запущено как приложение»
B.pwa = {
  standalone: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true,
  sw: 'нет'
};
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' }).then(function (reg) {
      B.pwa.sw = reg.active ? 'активен' : 'устанавливается';
      try { reg.update(); } catch (e) {}   // iOS проверяет новую версию service worker редко: просим при каждом запуске
      if (B.onPwaChange) B.onPwaChange();
    }).catch(function () { B.pwa.sw = 'ошибка'; if (B.onPwaChange) B.onPwaChange(); });
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'open-chat' && B.onOpenChat) B.onOpenChat(e.data.chatId);
    });
  });
}
