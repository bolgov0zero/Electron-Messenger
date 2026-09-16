'use strict';

// Service worker /m — тот же механизм push-уведомлений, что у /chat/sw.js,
// но со своим именем кэша и путями (у SW своя область видимости — /chat/sw.js
// не покрывает /m/, поэтому нужен отдельный файл, а не общий).
const CACHE = 'm-v1';
// index.html (/m/) намеренно не прекэшируем — он всегда из сети, иначе
// закэшированная страница может рендериться без актуальной вёрстки.
const STATIC = ['/m/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
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
