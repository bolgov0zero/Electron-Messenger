// Секретные чаты (E2E) для браузерных клиентов. Работает только в защищённом
// контексте (https или localhost): без него браузер не даёт crypto.subtle.
// Ключи чатов хранятся в localStorage в виде шифротекста; ключ обёртки —
// неэкспортируемый AES-ключ в IndexedDB, так что сам по себе blob из localStorage
// не расшифровать.
(function (global) {
  'use strict';

  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const C = { api: null, base: '', token: () => null, label: '' };
  const st = { keys: {}, raw: {}, hidden: new Set(), loaded: false, pending: {}, saved: {} };
  const keyObjs = {};

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── Хранилище ──
  function idbOpen() {
    return new Promise((res, rej) => {
      if (!global.indexedDB) return rej(new Error('no indexedDB'));
      const r = indexedDB.open('secret-chat', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbPut(k, v) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  let wrapP = null;
  function wrapKey() {
    if (!wrapP) wrapP = (async () => {
      let k = await idbGet('wrap').catch(() => null);
      if (!k) {
        k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await idbPut('wrap', k);
      }
      return k;
    })();
    return wrapP;
  }
  async function loadBlob() {
    const raw = localStorage.getItem('sc_v1');
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, await wrapKey(), unb64(o.ct));
      return JSON.parse(dec.decode(pt));
    } catch { return {}; }
  }
  async function saveBlob() {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(),
        enc.encode(JSON.stringify({ keys: st.raw, hidden: [...st.hidden], pending: st.saved })));
      localStorage.setItem('sc_v1', JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
    } catch {}
  }

  function deviceId() {
    let id = null;
    try { id = localStorage.getItem('sc_device_id'); } catch {}
    if (!id) {
      id = crypto.randomUUID();
      try { localStorage.setItem('sc_device_id', id); } catch {}
    }
    return id;
  }

  function importAes(b64s) {
    return crypto.subtle.importKey('raw', unb64(b64s), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  async function load() {
    if (st.loaded) return;
    st.loaded = true;
    const blob = await loadBlob();
    st.raw = blob.keys || {};
    st.hidden = new Set((blob.hidden || []).map(Number));
    for (const [id, k] of Object.entries(st.raw)) {
      try { keyObjs[id] = await importAes(k); } catch {}
    }
    // Незавершённый запрос доступа переживает перезапуск: приватный ключ хранится
    // в зашифрованном blob, истёкшие запросы просто выбрасываем
    st.saved = blob.pending || {};
    for (const [id, p] of Object.entries(st.saved)) {
      if (p.expiresAt < Date.now()) { delete st.saved[id]; continue; }
      try {
        const privateKey = await crypto.subtle.importKey('pkcs8', unb64(p.pkcs8), ECDH, true, ['deriveKey']);
        st.pending[id] = { requestId: p.requestId, code: p.code, privateKey, timer: null };
      } catch { delete st.saved[id]; }
    }
    await saveBlob();
  }

  async function setKey(chatId, b64s) {
    st.raw[chatId] = b64s;
    keyObjs[chatId] = await importAes(b64s);
    await saveBlob();
  }
  async function forget(chatId) {
    delete st.raw[chatId];
    delete keyObjs[chatId];
    await saveBlob();
  }
  async function hide(chatId) { st.hidden.add(Number(chatId)); await saveBlob(); }
  async function unhide(chatId) {
    if (!st.hidden.delete(Number(chatId))) return;
    await saveBlob();
  }
  const isHidden = chatId => st.hidden.has(Number(chatId));
  const hasKey = chatId => !!keyObjs[chatId];
  const keyOf = chatId => keyObjs[chatId] || null;
  const rawKeyOf = chatId => st.raw[chatId] || null;

  // ── Криптография сообщений и файлов ──
  async function createKey() {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    return b64(await crypto.subtle.exportKey('raw', k));
  }
  async function encryptText(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
    return { text: b64(ct), iv: b64(iv) };
  }
  async function decryptText(key, ctB64, ivB64) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
      return dec.decode(pt);
    } catch { return null; }
  }
  // Текст секретного сообщения — JSON {v:2,t,a}; старые сообщения — голый текст
  function parsePayload(plain) {
    try {
      const o = JSON.parse(plain);
      if (o && o.v === 2) return { t: o.t || '', a: o.a || null };
    } catch {}
    return { t: plain, a: null };
  }
  function encodePayload(t, a) {
    return JSON.stringify({ v: 2, t: t || '', a: a || null });
  }
  async function encryptFile(file, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
    return { blob: new Blob([ct], { type: 'application/octet-stream' }), fiv: b64(iv) };
  }
  async function fetchFile(url, fiv, key) {
    try {
      const res = await fetch(C.base + url, { headers: { Authorization: 'Bearer ' + C.token() } });
      if (!res.ok) return null;
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(fiv) }, key, await res.arrayBuffer());
    } catch { return null; }
  }
  // Заглушка вместо текста: серые полоски, длина зависит от шифротекста
  function skeletonHtml(ct) {
    const n = (ct || '').length;
    const w1 = Math.min(Math.max(Math.round(n * 0.5), 90), 220);
    const w2 = Math.min(Math.max(Math.round(n * 0.3), 50), 140);
    return `<span class="sc-skel" style="width:${w1}px"></span>` + (n > 120 ? `<span class="sc-skel" style="width:${w2}px"></span>` : '');
  }

  // ── Обмен ключом (сторона, которой нужен доступ) ──
  async function genEphemeral() {
    const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    return { privateKey: kp.privateKey, pubB64: b64(await crypto.subtle.exportKey('spki', kp.publicKey)) };
  }
  async function deriveWrapKey(privateKey, peerPubB64) {
    const peer = await crypto.subtle.importKey('spki', unb64(peerPubB64), ECDH, true, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrapChatKey(wk, chatKeyB64) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, unb64(chatKeyB64));
    return `${b64(iv)}.${b64(ct)}`;
  }
  async function unwrapChatKey(wk, packed) {
    const [ivB64, ctB64] = String(packed).split('.');
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, wk, unb64(ctB64));
    return b64(raw);
  }

  async function requestAccess(chatId) {
    const eph = await genEphemeral();
    const data = await C.api('POST', `/secret/${chatId}/requests`, {
      device_id: deviceId(), device_label: C.label, platform: 'web', ephemeral_pubkey: eph.pubB64,
    });
    if (!data?.request_id) return { error: data?.error || 'Не удалось создать запрос' };
    st.pending[chatId] = { requestId: data.request_id, code: data.code, privateKey: eph.privateKey, timer: null };
    st.saved[chatId] = {
      requestId: data.request_id, code: data.code,
      pkcs8: b64(await crypto.subtle.exportKey('pkcs8', eph.privateKey)),
      expiresAt: Date.now() + (data.expires_in || 600) * 1000,
    };
    await saveBlob();
    return { code: data.code };
  }
  function pendingOf(chatId) { return st.pending[chatId] || null; }
  function cancelPending(chatId) {
    const p = st.pending[chatId];
    if (p) clearInterval(p.timer);
    delete st.pending[chatId];
    if (st.saved[chatId]) { delete st.saved[chatId]; saveBlob(); }
  }
  const pendingIds = () => Object.keys(st.pending).map(Number);
  // true — ключ получен и сохранён
  async function pollPending(chatId) {
    const p = st.pending[chatId];
    if (!p || p.busy) return false;
    p.busy = true;
    const data = await C.api('GET', `/secret/${chatId}/requests/${p.requestId}`);
    p.busy = false;
    if (!data || data.status !== 'approved') return false;
    cancelPending(chatId);
    try {
      const wk = await deriveWrapKey(p.privateKey, data.approver_ephemeral_pubkey);
      const keyB64 = await unwrapChatKey(wk, data.wrapped_secret);
      await setKey(chatId, keyB64);
      await unhide(chatId);
      if (st.saved[chatId]) { delete st.saved[chatId]; await saveBlob(); }
      await C.api('POST', `/secret/${chatId}/requests/${p.requestId}/complete`);
      return true;
    } catch { return false; }
  }

  async function devices(chatId) { return C.api('GET', `/secret/${chatId}/devices`); }

  global.SC = {
    init(cfg) { Object.assign(C, cfg); },
    load, deviceId, setKey, forget, hide, unhide, isHidden, hasKey, keyOf, rawKeyOf,
    createKey, encryptText, decryptText, parsePayload, encodePayload, encryptFile, fetchFile, skeletonHtml,
    requestAccess, pendingOf, pendingIds, cancelPending, pollPending, devices,
    isLoaded: () => st.loaded,
  };
})(window);
