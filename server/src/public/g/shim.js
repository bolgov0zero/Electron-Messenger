(function(){
  var seg = location.pathname.split('/')[2] || '', P = 'guest:' + seg.slice(0, 24) + ':', real = window.localStorage;
  var own = function () { var o = []; try { for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(P) === 0) o.push(k.slice(P.length)); } } catch (e) {} return o; };
  var api = { getItem: function (k) { return real.getItem(P + k); }, setItem: function (k, v) { real.setItem(P + k, String(v)); }, removeItem: function (k) { real.removeItem(P + k); },
    clear: function () { own().forEach(function (k) { real.removeItem(P + k); }); }, key: function (i) { var o = own(); return i < o.length ? o[i] : null; } };
  var shim = new Proxy({}, {
    get: function (t, p) { if (p === 'length') return own().length; if (typeof p === 'string' && api[p]) return api[p]; return typeof p === 'string' ? real.getItem(P + p) : undefined; },
    set: function (t, p, v) { if (typeof p === 'string') real.setItem(P + p, String(v)); return true; },
    deleteProperty: function (t, p) { if (typeof p === 'string') real.removeItem(P + p); return true; },
    has: function (t, p) { return typeof p === 'string' && (!!api[p] || real.getItem(P + p) !== null); },
    ownKeys: function () { return own(); },
    getOwnPropertyDescriptor: function (t, p) { return typeof p === 'string' && real.getItem(P + p) !== null ? { value: real.getItem(P + p), enumerable: true, configurable: true, writable: true } : undefined; }
  });
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  window.__GUEST__ = { token: decodeURIComponent(seg), ls: real };
})();
