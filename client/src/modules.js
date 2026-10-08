// Менеджер модулей клиента — общий для Electron, веб и мобильного клиентов.
//
// Модуль — необязательная возможность, которую включает администратор (сервер отдаёт список в /api/modules),
// а пользователь затем включает у себя на каждом устройстве. Менеджер ничего не знает о том, что делает
// конкретный модуль: он хранит состояние, версии, файлы и события, а сам модуль подключается обработчиком
// (Modules.register), который узнаёт, когда модуль стал активным и когда перестал.
//
// Файлы модуля лежат на сервере (/modules/<ключ>/…), список файлов с контрольными суммами — в manifest.json.
// Электрон качает их заранее в Cache Storage и сам обновляет, когда версия на сервере выросла: докачивает
// только изменившиеся файлы. Веб и мобильный подгружают по мере надобности и тоже кладут в кэш.
//
// Адрес файла содержит его контрольную сумму (?h=…): неизменившиеся файлы остаются в кэше при обновлении,
// изменившиеся получают новый адрес, а лишнее из кэша убирается.
(function () {
  'use strict';
  const S = { cfg: null, mods: new Map(), handlers: new Map(), listeners: new Set(), jsonMem: new Map(), refreshing: null };

  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const ver = () => { const v = S.cfg && S.cfg.version; return typeof v === 'function' ? v() : (v || ''); };
  const emit = () => S.listeners.forEach(f => { try { f(); } catch {} });
  const isElectron = () => S.cfg && S.cfg.client === 'electron';

  // Прежние ключи (до появления менеджера) переносим, чтобы выбор пользователя не потерялся
  function migrate() {
    if (lsGet('animoji_on') !== null && lsGet('mod_animoji_on') === null) lsSet('mod_animoji_on', lsGet('animoji_on'));
    if (lsGet('animoji_device') && !lsGet('mod_device')) lsSet('mod_device', lsGet('animoji_device'));
    try { caches.keys().then(ks => ks.filter(k => /^animoji-v/.test(k)).forEach(k => caches.delete(k))); } catch {}
  }
  function deviceId() {
    let id = lsGet('mod_device');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 32); lsSet('mod_device', id); }
    return id;
  }
  async function call(method, path, body) {
    const r = await fetch(S.cfg.base() + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.cfg.token() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  const cacheName = key => 'mod-' + key;
  const entry = key => S.mods.get(key);
  const available = m => !!(m && m.info);
  const filePath = (m, rel) => `${S.cfg.base()}${m.info.base}/${rel}`;
  function fileUrl(m, rel) {
    const f = m.manifest && m.manifest.files && m.manifest.files[rel];
    return filePath(m, rel) + '?' + (f ? 'h=' + f.h : 'v=' + m.info.version);
  }
  // Какую версию набора считаем установленной на этом устройстве
  const installedFor = m => (isElectron() ? m.installed : m.info.version);

  async function openCache(key) { try { return await caches.open(cacheName(key)); } catch { return null; } }
  async function pruneCache(m) {
    if (!m.manifest || !m.manifest.files) return;
    const cache = await openCache(m.info.key); if (!cache) return;
    const keep = new Set(Object.keys(m.manifest.files).map(r => fileUrl(m, r)));
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
  }

  function activeNow(m) { return !!(m && m.info && m.on && m.manifest); }
  function notifyHandler(key, was) {
    const m = entry(key), h = S.handlers.get(key); if (!h) return;
    const now = activeNow(m);
    if (now && !was && h.onActive) { try { h.onActive(m); } catch {} }
    if (!now && was && h.onInactive) { try { h.onInactive(m); } catch {} }
    if (now && was && h.onChange) { try { h.onChange(m); } catch {} }
  }

  function report(key) {
    const m = entry(key); if (!available(m)) return;
    call('POST', `/api/modules/${key}/device`, { device_id: deviceId(), client: S.cfg.client, version: ver(), enabled: m.on, pack: installedFor(m) }).catch(() => {});
  }
  function logEvent(key, event, detail) {
    call('POST', `/api/modules/${key}/event`, { device_id: deviceId(), client: S.cfg.client, version: ver(), event, detail }).catch(() => {});
  }

  // Электрон: сам обновляет набор, когда версия на сервере выросла
  function autoUpdate(key) {
    const m = entry(key);
    if (!isElectron() || !available(m) || !m.info.needsDownload || !m.on || m.task) return;
    if (m.installed === m.info.version) return;
    api.download(key, { kind: m.installed ? 'update' : 'download', silent: true });
  }

  const view = m => ({
    key: m.info.key, title: m.info.title, description: m.info.description, note: m.info.note, icon: m.info.icon,
    needsDownload: !!m.info.needsDownload, version: m.info.version, count: m.info.count, bytes: m.info.bytes,
    on: m.on, installed: m.installed, ready: !!m.manifest,
    outdated: isElectron() && !!m.info.needsDownload && m.on && m.installed !== m.info.version,
    busy: !!m.task, task: m.task ? { ...m.task } : null, error: m.error || '',
  });

  const api = {
    // cfg: { client: 'electron' | 'web' | 'mobile', version: строка или функция, base(), token() }
    init(cfg) {
      if (S.cfg) return;
      S.cfg = cfg; migrate();
    },
    // Обработчик модуля: { onActive(m), onInactive(m), onChange(m) }
    register(key, handler) { S.handlers.set(key, handler); },
    subscribe(f) { S.listeners.add(f); return () => S.listeners.delete(f); },
    list() { return [...S.mods.values()].filter(available).map(view); },
    get(key) { const m = entry(key); return available(m) ? view(m) : null; },
    isActive(key) { return activeNow(entry(key)); },
    manifest(key) { return entry(key)?.manifest || null; },

    // Спросить сервер, какие модули доступны, и подготовить их
    refresh() {
      if (S.refreshing) { S.again = true; return S.refreshing; }
      S.refreshing = (async () => {
        if (!S.cfg || !S.cfg.token()) return;
        let list = null;
        try { list = await call('GET', '/api/modules'); } catch { return; }
        if (!Array.isArray(list)) return;
        const seen = new Set();
        for (const info of list) {
          seen.add(info.key);
          let m = entry(info.key);
          const was = activeNow(m);
          if (!m) { m = { info, manifest: null, on: lsGet('mod_' + info.key + '_on') === '1', installed: parseInt(lsGet('mod_' + info.key + '_ver') || '0', 10) || 0, task: null, error: '' }; S.mods.set(info.key, m); }
          const verChanged = m.info && m.info.version !== info.version;
          m.info = info;
          if (!m.manifest || verChanged) {
            try { m.manifest = await (await fetch(`${S.cfg.base()}${info.base}/manifest.json?v=${info.version}`)).json(); } catch { m.manifest = null; }
          }
          if (m.manifest) pruneCache(m);
          // Веб и мобильный файлов заранее не качают: считаем, что версия всегда та, что на сервере
          if (!isElectron() && m.on) { m.installed = info.version; }
          if (m.on) report(info.key);
          notifyHandler(info.key, was);
          autoUpdate(info.key);
        }
        for (const [key, m] of [...S.mods]) {
          if (seen.has(key)) continue;
          const was = activeNow(m);
          m.info = null; m.manifest = null;
          notifyHandler(key, was);
        }
        emit();
      })().finally(() => { S.refreshing = null; if (S.again) { S.again = false; api.refresh(); } });
      return S.refreshing;
    },

    setOn(key, on) {
      const m = entry(key); if (!available(m)) return;
      const was = activeNow(m);
      m.on = !!on; lsSet('mod_' + key + '_on', m.on ? '1' : '0');
      if (m.on && !isElectron()) m.installed = m.info.version;
      report(key);
      notifyHandler(key, was);
      emit();
    },

    // Файл модуля (JSON) через кэш
    async fetchJson(key, rel) {
      const m = entry(key); if (!available(m)) throw new Error('Модуль недоступен');
      const url = fileUrl(m, rel);
      if (S.jsonMem.has(url)) return S.jsonMem.get(url);
      let res = null; const cache = await openCache(key);
      if (cache) { try { res = await cache.match(url); } catch {} }
      if (!res) {
        res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (cache) { try { await cache.put(url, res.clone()); } catch {} }
      }
      const data = await res.json();
      S.jsonMem.set(url, data);
      if (S.jsonMem.size > 80) S.jsonMem.delete(S.jsonMem.keys().next().value);
      return data;
    },

    // Скачать (или докачать) файлы модуля. kind: 'download' (первая загрузка), 'update' (новая версия) или 'redownload' (по кнопке)
    async download(key, { kind = 'download', onProgress, silent = false } = {}) {
      const m = entry(key);
      if (!available(m) || !m.manifest || !m.manifest.files) throw new Error('Набор недоступен');
      if (m.task) throw new Error('Загрузка уже идёт');
      const rels = Object.keys(m.manifest.files), total = rels.length;
      const task = m.task = { kind, done: 0, total, bytes: 0, failed: 0, cancel: false, silent };
      m.error = ''; emit();
      const startEv = kind === 'download' ? 'download_start' : 'update_start', errEv = kind === 'download' ? 'download_error' : 'update_error';
      logEvent(key, startEv);
      let cache = await openCache(key);
      if (kind === 'redownload' && cache) { await caches.delete(cacheName(key)); S.jsonMem.clear(); cache = await openCache(key); }
      let i = 0, firstErr = '';
      const worker = async () => {
        while (i < rels.length && !task.cancel) {
          const rel = rels[i++], url = fileUrl(m, rel);
          try {
            const hit = cache && await cache.match(url);
            if (!hit) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); if (cache) await cache.put(url, res.clone()); }
            task.bytes += m.manifest.files[rel].s;
          } catch (e) { task.failed++; firstErr = firstErr || (e && e.message) || 'ошибка'; }
          task.done++;
          if (onProgress) onProgress({ done: task.done, total, bytes: task.bytes, failed: task.failed });
          if (task.done % 8 === 0 || task.done === total) emit();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      const res = { ok: !task.failed && !task.cancel, failed: task.failed, total, cancelled: task.cancel };
      m.task = null;
      if (task.cancel) { emit(); return res; }
      if (task.failed) { m.error = `${task.failed} из ${total}: ${firstErr}`; logEvent(key, errEv, m.error); }
      else { m.installed = m.info.version; lsSet('mod_' + key + '_ver', String(m.info.version)); await pruneCache(m); report(key); }
      emit();
      return res;
    },
    cancel(key) { const m = entry(key); if (m && m.task) m.task.cancel = true; },

    // «Перекачать»: Электрон скачивает набор заново, веб и мобильный очищают кэш (файлы подгрузятся снова)
    async reinstall(key, opts = {}) {
      const m = entry(key); if (!available(m)) return { ok: false };
      if (isElectron() && m.info.needsDownload) return api.download(key, { ...opts, kind: 'redownload' });
      try { await caches.delete(cacheName(key)); } catch {}
      S.jsonMem.clear();
      if (m.on) { m.installed = m.info.version; report(key); }
      emit();
      return { ok: true };
    },
  };
  window.Modules = api;
})();
