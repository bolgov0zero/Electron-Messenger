// /beta — ядро: загрузка вложений (проверка размера и расширения, подготовка видео на устройстве,
// отправка с процентами, удаление уже загруженного, но не отправленного файла). Логика из /m/app.js.
B.upload = {
  cfg: {
    image: { maxSizeMb: 10, extensions: ['jpeg', 'jpg', 'png', 'gif', 'webp'] },
    video: { maxSizeMb: 50, extensions: ['mp4', 'mov', 'webm'] },
    file: { maxSizeMb: 50, extensions: [] }
  },
  _xhr: null, _prep: null, _tok: 0, _vp: null,
  load: async function () { var r = await B.api('GET', '/upload/settings'); if (r && !r.error) B.upload.cfg = r; },
  // Подготовка видео (HEVC → H.264, shared/video-prep.js): модуль тяжёлый, грузим только когда выбрали видео
  _loadPrep: function () {
    if (window.VideoPrep) return Promise.resolve(window.VideoPrep);
    if (!B.upload._vp) B.upload._vp = new Promise(function (res) {
      var s = document.createElement('script'); s.src = '/shared/video-prep.js?v=1';
      s.onload = function () { res(window.VideoPrep || null); }; s.onerror = function () { B.upload._vp = null; res(null); };
      document.head.appendChild(s);
    });
    return B.upload._vp;
  },
  // cb: onStart(title), onPrepare(pct), onProgress(pct), onProcessing(), onDone(attachment), onError(text)
  pick: async function (file, cb, opts) {
    var U = B.upload, isImage = file.type.indexOf('image/') === 0, isVideo = file.type.indexOf('video/') === 0;
    var cfg = isImage ? U.cfg.image : isVideo ? U.cfg.video : U.cfg.file, ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!isVideo && file.size > cfg.maxSizeMb * 1048576) { cb.onError('Файл слишком большой (макс. ' + cfg.maxSizeMb + ' МБ)'); return; }
    if (cfg.extensions.length > 0 && cfg.extensions.indexOf(ext) < 0) { cb.onError('Расширение .' + ext + ' не разрешено'); return; }
    if (U._xhr) U._xhr.abort();
    var tok = ++U._tok; cb.onStart(isImage ? 'Фото' : isVideo ? 'Видео' : 'Файл');
    if (isVideo && /\.(mov|mp4|m4v)$/i.test(file.name)) {
      var VP = await U._loadPrep(); if (tok !== U._tok) return;
      if (VP && VP.supported()) {
        var ac = U._prep = new AbortController();
        file = await VP.prepare(file, { signal: ac.signal, onProgress: cb.onPrepare });
        if (U._prep === ac) U._prep = null; if (tok !== U._tok) return;
      }
    }
    if (file.size > cfg.maxSizeMb * 1048576) { cb.onError('Файл слишком большой (макс. ' + cfg.maxSizeMb + ' МБ)'); return; }
    var fd = new FormData(), endpoint = '/api/upload', secretMeta = null;
    var chatId = opts && opts.chatId;
    if (chatId && B.S.secretChatIds.has(chatId)) {
      // Скрытый чат: файл шифруется на устройстве, на сервер уходит шифртекст
      var key = window.SC && SC.keyOf(chatId);
      if (!key) { cb.onError('Чат не расшифрован на этом устройстве'); return; }
      var enc = await SC.encryptFile(file, key); if (tok !== U._tok) return;
      fd.append('file', enc.blob, 'enc.bin'); endpoint = '/api/upload?enc=1';
      secretMeta = { fiv: enc.fiv, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
    } else fd.append('file', file);
    var xhr = new XMLHttpRequest(); U._xhr = xhr;
    xhr.open('POST', B.http() + '://' + B.S.server + endpoint);
    xhr.setRequestHeader('Authorization', 'Bearer ' + B.S.token);
    // Пока тело запроса идёт — честный процент; после отправки, пока сервер обрабатывает (например, транскод видео), — «Обработка…»
    xhr.upload.onprogress = function (e) { if (tok === U._tok && e.lengthComputable) cb.onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.upload.onload = function () { if (tok === U._tok) cb.onProcessing(); };
    xhr.onload = function () {
      U._xhr = null; if (tok !== U._tok) return;
      if (xhr.status < 200 || xhr.status >= 300) { var err = {}; try { err = JSON.parse(xhr.responseText); } catch (e) {} cb.onError(err.error || 'Ошибка загрузки'); return; }
      try { var resp = JSON.parse(xhr.responseText); cb.onDone(secretMeta ? Object.assign({}, resp, { enc: 1 }, secretMeta) : resp); } catch (e) { cb.onError('Ошибка загрузки'); }
    };
    xhr.onerror = function () { U._xhr = null; if (tok === U._tok) cb.onError('Ошибка загрузки'); };
    xhr.send(fd);
  },
  // Отмена: прерывает загрузку или удаляет уже загруженный, но не отправленный файл с сервера
  cancel: function (att) {
    var U = B.upload; U._tok++;
    if (U._prep) { U._prep.abort(); U._prep = null; }
    if (U._xhr) { U._xhr.abort(); U._xhr = null; }
    else if (att && att.url) B.api('DELETE', '/upload', { url: att.url, thumb: att.thumb });
  }
};
// Модули (GIF и др.): менеджер из /shared/modules.js, настройки и список приходят с сервера
B.modules = {
  init: function () {
    if (!window.Modules || B.modules._done) return; B.modules._done = true;
    Modules.init({ client: 'mobile', version: function () { return 'mobile'; }, base: function () { return B.http() + '://' + B.S.server; }, token: function () { return B.S.token; } });
    Modules.subscribe(function () { B.bus.emit('modules:changed'); });
  },
  refresh: function () { if (window.Modules) Modules.refresh(); }
};
B.bus.on('modules:reload', function () { B.modules.refresh(); });
