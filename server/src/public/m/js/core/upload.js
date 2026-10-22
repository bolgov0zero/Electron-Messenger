// /m — ядро: загрузка вложений (проверка размера и расширения, подготовка видео на устройстве,
// отправка с процентами, удаление уже загруженного, но не отправленного файла). Логика из /m/app.js.
B.upload = {
  cfg: {
    image: { maxSizeMb: 10, extensions: ['jpeg', 'jpg', 'png', 'gif', 'webp'] },
    video: { maxSizeMb: 50, extensions: ['mp4', 'mov', 'webm'] },
    file: { maxSizeMb: 50, extensions: [] }
  },
  _vp: null,
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
  // Загрузок может идти несколько сразу (несколько вложений). Возвращает управляющий объект для cancel().
  // cb: onStart(title), onPrepare(pct), onProgress(pct), onProcessing(), onDone(attachment), onError(text)
  pick: async function (file, cb, opts) {
    var U = B.upload, ctl = { dead: false, xhr: null, prep: null }, isImage = file.type.indexOf('image/') === 0, isVideo = file.type.indexOf('video/') === 0;
    var cfg = isImage ? U.cfg.image : isVideo ? U.cfg.video : U.cfg.file, ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!isVideo && file.size > cfg.maxSizeMb * 1048576) { cb.onError('Файл слишком большой (макс. ' + cfg.maxSizeMb + ' МБ)'); return ctl; }
    if (!(opts && opts.chatId && B.S.secretChatIds.has(opts.chatId)) && cfg.extensions.indexOf(ext) < 0) { cb.onError('Расширение .' + ext + ' не разрешено'); return ctl; }
    cb.onStart(isImage ? 'Фото' : isVideo ? 'Видео' : 'Файл');
    if (isVideo && /\.(mov|mp4|m4v)$/i.test(file.name)) {
      var VP = await U._loadPrep(); if (ctl.dead) return ctl;
      if (VP && VP.supported()) {
        var ac = ctl.prep = new AbortController();
        file = await VP.prepare(file, { signal: ac.signal, onProgress: cb.onPrepare });
        ctl.prep = null; if (ctl.dead) return ctl;
      }
    }
    if (file.size > cfg.maxSizeMb * 1048576) { cb.onError('Файл слишком большой (макс. ' + cfg.maxSizeMb + ' МБ)'); return ctl; }
    var fd = new FormData(), endpoint = '/api/upload', secretMeta = null;
    var chatId = opts && opts.chatId;
    if (chatId && B.S.secretChatIds.has(chatId)) {
      // Скрытый чат: файл шифруется на устройстве, на сервер уходит шифртекст
      var key = window.SC && SC.keyOf(chatId);
      if (!key) { cb.onError('Чат не расшифрован на этом устройстве'); return ctl; }
      var enc = await SC.encryptFile(file, key); if (ctl.dead) return ctl;
      fd.append('file', enc.blob, 'enc.bin'); endpoint = '/api/upload?enc=1';
      secretMeta = { fiv: enc.fiv, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
    } else fd.append('file', file);
    var xhr = new XMLHttpRequest(); ctl.xhr = xhr;
    xhr.open('POST', B.http() + '://' + B.S.server + endpoint);
    xhr.setRequestHeader('Authorization', 'Bearer ' + B.S.token);
    // Пока тело запроса идёт — честный процент; после отправки, пока сервер обрабатывает (например, транскод видео), — «Обработка…»
    xhr.upload.onprogress = function (e) { if (!ctl.dead && e.lengthComputable) cb.onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.upload.onload = function () { if (!ctl.dead) cb.onProcessing(); };
    xhr.onload = function () {
      ctl.xhr = null; if (ctl.dead) return;
      if (xhr.status < 200 || xhr.status >= 300) { var err = {}; try { err = JSON.parse(xhr.responseText); } catch (e) {} cb.onError(err.error || 'Ошибка загрузки'); return; }
      try { var resp = JSON.parse(xhr.responseText); cb.onDone(secretMeta ? Object.assign({}, resp, { enc: 1 }, secretMeta) : resp); } catch (e) { cb.onError('Ошибка загрузки'); }
    };
    xhr.onerror = function () { ctl.xhr = null; if (!ctl.dead) cb.onError('Ошибка загрузки'); };
    xhr.send(fd);
    return ctl;
  },
  // Отмена: прерывает загрузку или удаляет уже загруженный, но не отправленный файл с сервера
  cancel: function (att, ctl) {
    if (ctl) { ctl.dead = true; if (ctl.prep) { ctl.prep.abort(); ctl.prep = null; } if (ctl.xhr) { ctl.xhr.abort(); ctl.xhr = null; } }
    if (att && att.url) B.api('DELETE', '/upload', { url: att.url, thumb: att.thumb });
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
