// /beta — сервис-воркер макетов: оболочка доступна без сети.
// Страницы и скрипты: сначала сеть (макет часто правится), при обрыве — из кэша. Шрифты и значки: сначала кэш.
const CACHE = 'beta-shell-2';
const cmatch = (r, o) => caches.open(CACHE).then(c => c.match(r, o));   // только свой кэш: в общем поиске всплывали бы чужие копии
const SHELL = ['/beta/', '/beta/index.html', '/beta/m.js', '/beta/desktop.html', '/beta/desktop.js', '/beta/manifest.json',
  '/beta/icons/icon-192.png', '/beta/icons/apple-touch-icon.png', '/shared/fonts/inter.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('beta-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const mine = u.pathname.startsWith('/beta/') || u.pathname === '/beta', shared = u.pathname.startsWith('/shared/fonts/');
  if (!mine && !shared) return;
  if (shared || /\.(png|woff2?)$/.test(u.pathname)) {
    e.respondWith(cmatch(r).then(c => c || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(x => x.put(r, cp)); } return res; })));
    return;
  }
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(x => x.put(r, cp)); } return res; })
    .catch(() => cmatch(r, { ignoreSearch: true }).then(c => c || (r.mode === 'navigate' ? cmatch('/beta/index.html') : Response.error()))));
});
