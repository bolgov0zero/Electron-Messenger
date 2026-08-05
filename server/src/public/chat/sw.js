'use strict';

const CACHE = 'corp-chat-v57';
// index.html (/chat/) намеренно не прекэшируем — он всегда из сети,
// иначе закэшированная страница может рендериться без актуального viewport/вёрстки
const STATIC = ['/chat/app.js?v=1.2.105', '/chat/style.css?v=1.2.105', '/chat/manifest.json', '/chat/icons/icon.svg'];

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
  // Не перехватываем API, WebSocket и запросы к другим хостам
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (url.origin !== self.location.origin) return;

  // Навигация (index.html) — всегда из сети, без кэширования страницы
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r => {
        // Обновляем кэш свежим ответом
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

  // Входящий звонок — всегда показываем уведомление, добавляем кнопки действий
  if (data.type === 'call') {
    const options = {
      body: data.body || 'Входящий звонок',
      icon: '/chat/icons/icon.svg',
      badge: '/chat/icons/icon.svg',
      tag: 'call',
      renotify: true,
      requireInteraction: true,
      actions: [
        { action: 'accept', title: 'Принять' },
        { action: 'reject', title: 'Сбросить' },
      ],
      data: { type: 'call', callerId: data.callerId, callerName: data.callerName },
    };
    e.waitUntil(
      // Для звонков всегда показываем уведомление и уведомляем открытые вкладки
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        list.forEach(c => c.postMessage({ type: 'call_push_incoming', callerId: data.callerId, callerName: data.callerName }));
        return self.registration.showNotification(data.title || 'Входящий звонок', options);
      }).catch(() => {})
    );
    return;
  }

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
  const notifData = e.notification.data || {};
  const action = e.action;

  // Обработка кнопок уведомления о звонке
  if (notifData.type === 'call') {
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const msg = action === 'reject'
          ? { type: 'call_push_action', action: 'reject', callerId: notifData.callerId }
          : { type: 'call_push_action', action: 'accept', callerId: notifData.callerId, callerName: notifData.callerName };
        const existing = list.find(c => c.visibilityState === 'visible') || list[0];
        if (existing) {
          existing.focus();
          existing.postMessage(msg);
        } else {
          clients.openWindow('/chat/').then(w => { if (w) w.postMessage(msg); });
        }
      })
    );
    return;
  }

  const chatId = notifData.chatId;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.visibilityState === 'visible') || list[0];
      if (existing) {
        existing.focus();
        if (chatId) existing.postMessage({ type: 'open-chat', chatId });
      } else {
        clients.openWindow(chatId ? `/chat/?chatId=${chatId}` : '/chat/');
      }
    })
  );
});
