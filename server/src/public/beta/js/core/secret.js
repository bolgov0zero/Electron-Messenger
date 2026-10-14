// /beta — ядро: скрытые (секретные) чаты со сквозным шифрованием. Криптография — /shared/secret-core.js (глобальный SC),
// здесь только связка с чатами: какие чаты скрыты, расшифровка сообщений и вложений, код доступа, устройства, удаление.
// Создать скрытый чат на телефоне нельзя: его получают по коду от собеседника (см. баннер в переписке).
B.S.scDecrypted = new Map(); B.S.scAtt = new Map(); B.S.scAttBlob = new Map();
B.secret = {
  _booted: false, _busy: false, _again: false, _tok: 0, bannerOpen: null,
  available: function () { return !!window.SC; },
  deviceLabel: function () { var ua = navigator.userAgent || ''; return /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : 'Браузер'; },
  boot: async function () {
    if (!window.SC) return;
    if (!B.secret._booted) {
      B.secret._booted = true;
      SC.init({ api: function (m, p, b) { return B.api(m, p, b); }, base: B.http() + '://' + B.S.server, token: function () { return B.S.token; }, label: B.secret.deviceLabel() });
    }
    await SC.load();
    SC.pendingIds().forEach(function (id) { if (!SC.pendingOf(id).timer) SC.pendingOf(id).timer = setInterval(function () { B.secret.tick(id); }, 4000); });
  },
  // Список без чатов, скрытых на этом устройстве; заодно запоминаем, какие чаты секретные
  visible: function (list) {
    B.S.secretChatIds = new Set(list.filter(function (c) { return c.is_secret; }).map(function (c) { return c.id; }));
    return list.filter(function (c) { return !(c.is_secret && window.SC && SC.isHidden(c.id)); });
  },
  isSecret: function (id) { return B.S.secretChatIds.has(id); },
  hasKey: function (id) { return !!(window.SC && SC.hasKey(id)); },
  locked: function (id) { return B.secret.isSecret(id) && !B.secret.hasKey(id); },
  // Сообщение для показа: расшифрованное, пока не расшифровано — «пиксели»; вложение — со своими метаданными
  display: function (m) {
    if (m.deleted || m.sender_username === '__system__') return m;
    var dec = B.S.scDecrypted.get(m.id), meta = B.S.scAtt.get(m.id), copy = Object.assign({}, m);
    if (dec !== undefined) copy.text = dec; else { copy.text = ''; copy._skel = window.SC ? SC.skeletonHtml(m.text) : ''; }
    if (m.attachment && m.attachment.url) copy.attachment = { url: m.attachment.url, enc: 1, expired: m.attachment.expired, mime: meta && meta.m, name: meta && meta.n, size: meta && meta.s, _msgId: m.id, _chat: m.chat_id, _locked: !meta };
    return copy;
  },
  // Расшифровывает сообщения открытого чата и просит ленту перерисоваться без скачка
  decrypt: async function () {
    var X = B.secret; if (!window.SC) return;
    if (X._busy) { X._again = true; return; }
    X._busy = true;
    try {
      var changed = false;
      for (var i = 0; i < B.msgs.cache.length; i++) {
        var m = B.msgs.cache[i];
        if (!X.isSecret(m.chat_id) || !(m.id > 0) || m.deleted) continue;
        var key = SC.keyOf(m.chat_id); if (!key) continue;
        if (!B.S.scDecrypted.has(m.id) && m.iv && m.text) {
          var plain = await SC.decryptText(key, m.text, m.iv);
          if (plain !== null) { var p = SC.parsePayload(plain); B.S.scDecrypted.set(m.id, p.t); if (p.a) B.S.scAtt.set(m.id, p.a); changed = true; }
        }
        var meta = B.S.scAtt.get(m.id);
        if (meta && meta.m && meta.m.indexOf('image/') === 0 && m.attachment && m.attachment.url && !B.S.scAttBlob.has(m.id)) {
          var buf = await SC.fetchFile(m.attachment.url, m.attachment.fiv, key);
          if (buf) { B.S.scAttBlob.set(m.id, URL.createObjectURL(new Blob([buf], { type: meta.m }))); changed = true; }
        }
      }
      if (changed) B.bus.emit('msgs:changed', { mode: 'smart' });
    } finally { X._busy = false; if (X._again) { X._again = false; X.decrypt(); } }
  },
  // Шифрует отправляемое сообщение; возвращает true, если ключ есть
  seal: async function (chatId, payload, temp, text) {
    var key = window.SC && SC.keyOf(chatId);
    if (!key) { B.toast.show('Чат не расшифрован на этом устройстве'); return false; }
    var att = payload.attachment || null;
    var enc = await SC.encryptText(key, SC.encodePayload(text || '', att ? { n: att.name, m: att.mime, s: att.size } : null));
    payload.text = enc.text; payload.iv = enc.iv; delete payload.forward_data; temp.forward_data = null;
    B.S.scDecrypted.set(temp.id, text || '');
    if (att) {
      payload.attachment = { url: att.url, enc: 1, fiv: att.fiv, size: att.size };
      temp.attachment = { url: att.url, enc: 1, fiv: att.fiv, size: att.size };
      B.S.scAtt.set(temp.id, { n: att.name, m: att.mime, s: att.size });
    }
    return true;
  },
  redeem: async function (chatId, code) {
    var r = await SC.redeemCode(chatId, code);
    if (r.error) { B.toast.show(r.error); return false; }
    B.secret.bannerOpen = null; SC.pendingOf(chatId).timer = setInterval(function () { B.secret.tick(chatId); }, 4000);
    return true;
  },
  cancelSync: function (chatId) { SC.cancelPending(chatId); },
  tick: async function (chatId) {
    if (!SC.pendingOf(chatId)) return;
    if (!(await SC.pollPending(chatId))) return;
    B.toast.show('Скрытый чат расшифрован на этом устройстве');
    await B.chats.refresh(); B.bus.emit('secret:ready', { chatId: chatId });
  },
  devices: async function (chatId) { return SC.devices(chatId); },
  // Отключить это устройство и убрать чат из списка
  remove: async function (chatId) {
    await B.api('DELETE', '/chats/' + chatId + '?device_id=' + encodeURIComponent(SC.deviceId()));
    await SC.forget(chatId); await SC.hide(chatId);
    B.msgs.cache.forEach(function (m) {
      if (m.chat_id !== chatId) return; B.S.scDecrypted.delete(m.id); B.S.scAtt.delete(m.id);
      var u = B.S.scAttBlob.get(m.id); if (u) { URL.revokeObjectURL(u); B.S.scAttBlob.delete(m.id); }
    });
    B.S.secretChatIds.delete(chatId); B.S.chats = B.S.chats.filter(function (c) { return c.id !== chatId; });
    B.chats.onChanged(); B.bus.emit('chat:deleted', { chatId: chatId });
  },
  saveAtt: async function (msgId) {
    var m = B.msgs.find(msgId), meta = B.S.scAtt.get(msgId), key = m && SC.keyOf(m.chat_id);
    if (!m || !m.attachment || !m.attachment.url || !meta || !key) { B.toast.show('Вложение пока не расшифровано'); return; }
    var buf = await SC.fetchFile(m.attachment.url, m.attachment.fiv, key);
    if (!buf) { B.toast.show('Не удалось расшифровать файл'); return; }
    var url = URL.createObjectURL(new Blob([buf], { type: meta.m || 'application/octet-stream' })), a = document.createElement('a');
    a.href = url; a.download = meta.n || 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
};
// Пришло сообщение в скрытый чат, который был убран с этого устройства: возвращаем его в список
B.bus.on('ws:message', function (d) {
  var id = d.message.chat_id;
  if (window.SC && B.S.secretChatIds.has(id) && SC.isHidden(id)) { SC.unhide(id); B.chats.refresh(); }
});
B.bus.on('ws:secret_key_ready', function (d) { B.secret.tick(d.chat_id); });
B.bus.on('msgs:opened', function () { B.secret.decrypt(); });
B.bus.on('ws:message', function (d) { if (d.message.chat_id === B.msgs.chatId) setTimeout(B.secret.decrypt, 0); });
