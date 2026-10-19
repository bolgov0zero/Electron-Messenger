'use strict';

// Service worker /m — тот же механизм push-уведомлений, что у /m/sw.js, но со своим
// именем кэша и областью видимости (/m/): SW соседних клиентов её не покрывают.
const CACHE = 'm-v3';
// Нажатие на уведомление запоминаем здесь: iOS при открытии PWA может не передать ни адрес, ни сообщение, а страница заберёт запись сама
const PENDING = '/m/__open';
const LAST = '/m/__last';   // последнее нажатие на уведомление: не стирается, нужно «Диагностике»
const PUSHREC = '/m/__push';   // последний показанный пуш: если нажатие iOS не доставит, страница откроет этот чат сама
const LOG = '/m/__log';        // журнал событий service worker для «Диагностики»
const jsonRes = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
async function logEv(name, extra) {
  try {
    const c = await caches.open(CACHE), r = await c.match(LOG), arr = r ? await r.json() : [];
    arr.push(Object.assign({ e: name, t: Date.now() }, extra || {}));
    await c.put(LOG, jsonRes(arr.slice(-14)));
  } catch (err) {}
}
// index.html (/m/) намеренно не прекэшируем — он всегда из сети, иначе закэшированная
// страница может рендериться без актуальной вёрстки.
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
  if (url.pathname === LOG) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(LOG)) || jsonRes([])));
    return;
  }
  if (url.pathname === PUSHREC) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const r = await c.match(PUSHREC);
      if (url.searchParams.get('clear')) { await c.delete(PUSHREC); return jsonRes({}); }
      return r || jsonRes({});
    }));
    return;
  }
  if (url.pathname === LAST) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(LAST)) || new Response('{}', { headers: { 'content-type': 'application/json' } })));
    return;
  }
  if (url.pathname === PENDING) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const r = await c.match(PENDING);
      if (r) await c.delete(PENDING);
      return r || new Response('{}', { headers: { 'content-type': 'application/json' } });
    }));
    return;
  }

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
      tasks.push(logEv('push', { chatId: data.chatId || null, shown: !visible }));
      if (!visible && data.chatId) tasks.push(caches.open(CACHE).then(c => c.put(PUSHREC, jsonRes({ chatId: data.chatId, t: Date.now(), shown: true }))).catch(() => {}));
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

self.addEventListener('notificationclose', e => { e.waitUntil(logEv('close', { chatId: e.notification.data?.chatId || null })); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil(
    logEv('click', { chatId: chatId || null }).then(() => caches.open(CACHE)).then(c => {
      const rec = () => new Response(JSON.stringify({ chatId: chatId || null, t: Date.now() }), { headers: { 'content-type': 'application/json' } });
      return Promise.all([c.put(LAST, rec()), chatId ? c.put(PENDING, rec()) : null]);
    }).catch(() => {})
    .then(() => clients.matchAll({ type: 'window', includeUncontrolled: true })).then(list => {
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

// Страница спрашивает, какая версия service worker сейчас работает
self.addEventListener('message', e => {
  if (e.data === 'sw-info') e.source?.postMessage({ type: 'sw-info', cache: CACHE });
});
