// /m — ядро: push-уведомления (тот же сервер и тот же /api/push, что у /chat и /m)
B.push = {
  supported: function () { return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window; },
  permission: function () { return 'Notification' in window ? Notification.permission : 'denied'; },
  // Показывать ли приглашение «включить уведомления»: ещё не спрашивали и не отклоняли
  shouldAsk: function () {
    return 'Notification' in window && Notification.permission === 'default' && !localStorage.getItem('notifBannerDismissed');
  },
  dismissAsk: function () { localStorage.setItem('notifBannerDismissed', '1'); },
  request: async function () {
    if (!('Notification' in window)) return 'denied';
    var perm = await Notification.requestPermission();
    if (perm === 'granted') await B.push.subscribe();
    if (perm !== 'default') B.push.dismissAsk();
    return perm;
  },
  _key: function (b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  },
  _b64: function (buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); },
  subscribe: async function () {
    if (!B.push.supported()) return;
    try {
      var reg = await navigator.serviceWorker.ready;
      var data = await fetch(B.http() + '://' + B.S.server + '/api/push/vapid-public-key').then(function (r) { return r.json(); });
      if (!data || !data.key) return;
      var appKey = B.push._key(data.key), existing = await reg.pushManager.getSubscription();
      if (existing) {
        var ek = existing.options && existing.options.applicationServerKey;
        if (!ek || B.push._b64(ek) !== B.push._b64(appKey)) { await existing.unsubscribe(); existing = null; }
      }
      var sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      await B.api('POST', '/push/subscribe', { app_url: location.origin + '/beta/', endpoint: sub.endpoint, keys: { p256dh: B.push._b64(sub.getKey('p256dh')), auth: B.push._b64(sub.getKey('auth')) } });
    } catch (e) { console.warn('Push subscribe failed:', e); }
  }
};
