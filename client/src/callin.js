// Карточка входящего звонка в отдельном окне. Нажатия уходят окну приложения (см. «Входящий звонок» в main.js).
(async function () {
  'use strict';
  const init = await window.callInApi.init();
  if (!init) return;
  const P = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>';
  const V = '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>';
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const svg = (p, c = '') => `<svg class="${c}" viewBox="0 0 24 24">${p}</svg>`;
  const $ = id => document.getElementById(id);
  document.documentElement.classList.toggle('dark', init.theme.dark);
  if (init.theme.accent) {
    document.documentElement.style.setProperty('--accent', init.theme.accent);
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(init.theme.accent);
    if (m) document.documentElement.style.setProperty('--accent-rgb', [1, 2, 3].map(i => parseInt(m[i], 16)).join(','));
  }
  $('nm').textContent = init.name;
  $('sub').innerHTML = init.group ? (init.video ? 'Групповой видеозвонок' : 'Групповой аудиозвонок') + '<br>' + esc(init.by) + ' начал звонок · в нём ' + init.count : init.conf ? 'Зовёт в разговор · ' + (init.video ? 'видео' : 'аудио') + '…' : 'Входящий ' + (init.video ? 'видеозвонок' : 'аудиозвонок') + '…';
  const av = $('av'); av.textContent = init.name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('');
  if (init.bg) av.style.background = init.bg;
  const act = a => window.callInApi.action(a);
  const yes = init.group ? 'Присоединиться' : 'Принять', no = init.group ? 'Не сейчас' : 'Отклонить', noIc = init.group ? '' : svg(P, 'hang');
  $('acts').innerHTML = init.video
    ? `<button class="b ok big" data-a="accept-video">${svg(V)}${init.group ? 'Присоединиться с видео' : 'Принять с видео'}</button><div class="row"><button class="b" data-a="accept-audio">${svg(P)}Только звук</button><button class="b ${init.group ? '' : 'no'}" data-a="decline">${noIc}${no}</button></div>`
    : `<div class="row"><button class="b ${init.group ? '' : 'no'}" data-a="decline">${noIc}${no}</button><button class="b ok" data-a="accept-audio">${svg(P)}${yes}</button></div>`;
  $('acts').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
  $('card').hidden = false;
  // Камеру показываем, только если доступ к ней уже выдан: окно звонка не должно само вызывать запрос разрешения
  if (init.video && init.camera && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      $('pv').srcObject = stream; $('prev').hidden = false;
      window.addEventListener('beforeunload', () => stream.getTracks().forEach(t => t.stop()));
    }).catch(() => {});
  }
})();
