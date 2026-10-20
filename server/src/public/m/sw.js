'use strict';

// Service worker /m — тот же механизм push-уведомлений, что у /m/sw.js, но со своим
// именем кэша и областью видимости (/m/): SW соседних клиентов её не покрывают.
const CACHE = 'm-v3';
// index.html (/m/) не прекэшируем: он берётся из сети, а удачная копия остаётся в кэше для запуска без связи.
const STATIC = ['/m/manifest.json', '/m/manifest-light.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (url.origin !== self.location.origin) return;

  // Первая загрузка идёт из сети; последняя удачная копия оболочки лежит в кэше: без связи (или если сеть отвечает дольше
  // нескольких секунд) приложение открывается из неё, а не пустым экраном браузера
  const slow = (p, fallback, ms) => Promise.race([p.catch(() => fallback), new Promise(res => setTimeout(() => res(fallback), ms))]);
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE), cached = await cache.match('/m/');
      const net = fetch(e.request).then(r => { if (r.ok && r.status === 200 && !r.redirected) cache.put('/m/', r.clone()); return r; });
      return cached ? slow(net, cached, 5000) : net;
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; });
    return cached ? slow(net, cached, 4000) : net;
  })());
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', e => {
  const data = e.data?.json?.() || {};
  const title = data.title || 'Новое сообщение';
  const options = {
    body: data.body || '',
    icon: '/chat/icons/icon.svg',
    badge: '/chat/icons/icon.svg',
    tag: data.chatId ? `chat-${data.chatId}` : 'msg',
    renotify: true,
    data: { chatId: data.chatId },
  };
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const visible = list.some(c => c.visibilityState === 'visible');
      const tasks = visible ? [] : [self.registration.showNotification(title, options)];
      if (self.navigator.setAppBadge) {
        if (typeof data.unread === 'number') {
          tasks.push(data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge());
        } else if (!visible) {
          tasks.push(self.navigator.setAppBadge());
        }
      }
      return Promise.all(tasks);
    }).catch(() => {})
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.visibilityState === 'visible') || list[0];
      if (existing) {
        existing.focus();
        if (chatId) existing.postMessage({ type: 'open-chat', chatId });
      } else {
        clients.openWindow(chatId ? `/m/?chatId=${chatId}` : '/m/');
      }
    })
  );
});
