const { app, BrowserWindow, BrowserView, Tray, Menu, nativeImage, nativeTheme, Notification, ipcMain, net, safeStorage, screen, session } = require('electron');

if (process.platform === 'linux') {
  // Полностью отключаем все подсистемы sandbox: на некоторых конфигурациях
  // (Ubuntu 24.04+, VM/proxmox с ужесточёнными namespace-политиками) без этого
  // renderer-процесс падает с ошибкой "No such process" при доступе к /dev/shm.
  // Приложение подключается только к своему серверу и локальным ресурсам —
  // sandbox-защита от недоверенного веб-контента здесь избыточна.
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.commandLine.appendSwitch('disable-namespace-sandbox');
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');

// ── AUTO UPDATE ──
const GITHUB_REPO = 'bolgov0zero/Electron-Messenger';

// Установщик скачивается и ЗАПУСКАЕТСЯ, а адрес приходит из окна приложения.
// Любая инъекция в рендерер иначе означала бы запуск произвольной программы,
// поэтому принимаем только ссылку на релиз своего репозитория по https.
function isTrustedUpdateUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'github.com') return false;
    return u.pathname.startsWith(`/${GITHUB_REPO}/releases/download/`);
  } catch { return false; }
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    req.setHeader('User-Agent', 'Electron');
    let data = '';
    req.on('response', res => {
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

let _activeUpdateReq = null;

function downloadFileOnce(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = net.request({ url, redirect: 'follow' });
    _activeUpdateReq = req;
    req.setHeader('User-Agent', 'Electron');
    let responded = false;
    req.on('response', res => {
      responded = true;
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total) onProgress?.(Math.round(received / total * 100));
      });
      res.on('end', () => file.end());
      res.on('error', err => { try { file.destroy(); } catch {} reject(err); });
      file.on('finish', resolve);
      file.on('error', err => { try { file.destroy(); } catch {} reject(err); });
    });
    req.on('error', err => { try { file.destroy(); } catch {} reject(err); });
    req.end();
  });
}

// Ретраи для transient-ошибок: GitHub CDN иногда сбрасывает соединение
// (ERR_CONNECTION_RESET, ETIMEDOUT) — раньше это сразу падало в UI.
async function downloadFile(url, dest, onProgress) {
  const maxAttempts = 3;
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      onProgress?.(0);
      return await downloadFileOnce(url, dest, onProgress);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const isTransient = /ECONNRESET|CONNECTION_RESET|ETIMEDOUT|ENETUNREACH|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(msg);
      if (!isTransient || i === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

function semverGt(a, b) {
  const n = v => v.split('.').map(Number);
  const [am, an, ap] = n(a), [bm, bn, bp] = n(b);
  return am !== bm ? am > bm : an !== bn ? an > bn : ap > bp;
}

function getAssetPattern() {
  if (process.platform === 'win32') return /\.exe$/i;
  if (process.platform === 'darwin') return /\.dmg$/i;
  return /\.deb$/i;
}

ipcMain.handle('check-update', async () => {
  try {
    const data = JSON.parse(await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`));
    if (data.status === '404' || data.message === 'Not Found') return { upToDate: true };
    if (data.message) return { error: data.message };
    const latest = data.tag_name.replace(/^[a-zA-Z]+/, '');
    const current = app.getVersion();
    if (!semverGt(latest, current)) return { upToDate: true, version: current };
    const asset = data.assets?.find(a => getAssetPattern().test(a.name));
    return { upToDate: false, version: latest, notes: data.body || '', publishedAt: data.published_at || null, downloadUrl: asset?.browser_download_url || null };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('install-update', async (e, downloadUrl) => {
  if (!isTrustedUpdateUrl(downloadUrl)) {
    console.error('[Update] Отклонён недоверенный адрес:', downloadUrl);
    return { error: 'Недоверенный адрес обновления' };
  }
  // Прерываем предыдущую загрузку, если она ещё идёт
  if (_activeUpdateReq) { try { _activeUpdateReq.abort(); } catch {} _activeUpdateReq = null; }
  const ext = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.deb';
  const tmpFile = path.join(os.tmpdir(), `electron-update${ext}`);
  try {
    await downloadFile(downloadUrl, tmpFile, p => e.sender.send('update-progress', p));

    e.sender.send('update-restarting');
    // Небольшая пауза чтобы рендерер успел отправить WS-сообщение 'restarting' серверу
    await new Promise(r => setTimeout(r, 300));

    if (process.platform === 'win32') {
      const { spawn } = require('child_process');
      // Антивирус может держать блокировку на только что скачанном файле — повторяем до 5 раз
      let launched = false;
      for (let i = 0; i < 5 && !launched; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        try { spawn(tmpFile, ['/S'], { detached: true, stdio: 'ignore' }).unref(); launched = true; }
        catch (e) { if (e.code !== 'EBUSY' || i === 4) throw e; }
      }
      app.isQuiting = true; app.quit();
    } else if (process.platform === 'linux') {
      // Ставим deb через apt (сам разрешит зависимости и заменит файлы в /opt).
      // pkexec покажет системный диалог PolicyKit с запросом пароля.
      const { spawn } = require('child_process');
      // Абсолютные пути: pkexec ищет apt-get в PATH вызывающего процесса, а после
      // перезапуска этот PATH может быть урезан — отсюда код 127 («команда не найдена»)
      const pkexecBin = fs.existsSync('/usr/bin/pkexec') ? '/usr/bin/pkexec' : 'pkexec';
      const aptBin = fs.existsSync('/usr/bin/apt-get') ? '/usr/bin/apt-get' : 'apt-get';
      const env = { ...process.env, PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH || ''}` };
      const proc = spawn(pkexecBin, [aptBin, 'install', '-y', tmpFile], { stdio: ['ignore', 'ignore', 'pipe'], env });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      const code = await new Promise((resolve, reject) => {
        proc.on('close', resolve);
        proc.on('error', reject);
      });
      if (code !== 0) {
        console.error(`[Update] pkexec/apt-get завершились с кодом ${code}:`, stderr.trim());
        throw new Error(`Установка отменена или не удалась (код ${code})`);
      }
      app.relaunch(); app.isQuiting = true; app.quit();
    } else if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      const out = execSync(`hdiutil attach "${tmpFile}" -nobrowse`, { encoding: 'utf8' });
      const mountPoint = out.split('\n').reduce((found, line) => {
        const m = line.match(/\t(\/Volumes\/.+)/); return m ? m[1].trim() : found;
      }, null);
      if (!mountPoint) throw new Error('Не удалось смонтировать DMG');
      const appFile = fs.readdirSync(mountPoint).find(f => f.endsWith('.app'));
      if (!appFile) throw new Error('Приложение не найдено в DMG');
      execSync(`ditto "${mountPoint}/${appFile}" "/Applications/${appFile}"`);
      execSync(`xattr -dr com.apple.quarantine "/Applications/${appFile}"`, { stdio: 'ignore' });
      try { execSync(`hdiutil detach "${mountPoint}" -quiet`); } catch {}
      const execPath = `/Applications/${appFile}/Contents/MacOS/${appFile.replace('.app', '')}`;
      app.relaunch({ execPath }); app.isQuiting = true; app.quit();
    }
    _activeUpdateReq = null;
    return { ok: true };
  } catch(e) { _activeUpdateReq = null; return { error: e.message }; }
});

// ── HIGH AVAILABILITY ──
// Config stored in ProgramData — one config per machine, shared across all Windows users.
// Each user mounts their own personal network drive (e.g. U:) so userData resolves
// to their personal roaming storage automatically.
const HA_CONFIG_PATH = process.platform === 'win32' && process.env.PROGRAMDATA
  ? path.join(process.env.PROGRAMDATA, 'Electron', 'ha-config.json')
  : null;

function readHAConfig() {
  if (!HA_CONFIG_PATH) return null;
  try { return JSON.parse(fs.readFileSync(HA_CONFIG_PATH, 'utf8')); } catch { return null; }
}

// Ключи секретных чатов обязаны жить СТРОГО на этой физической машине — если
// их хранить в userData, при включённой HA они разъедутся на сетевой диск и
// станут доступны с любого компьютера под этим пользователем, а это буквально
// ломает модель «новое устройство активируется только с одобрения собеседника»
// (тихая репликация = второе устройство без одобрения). Поэтому путь фиксируем
// ДО переопределения userData ниже и больше не трогаем.
const LOCAL_MACHINE_DIR = app.getPath('userData');

// Apply BEFORE app.ready so Electron uses the correct userData path
const haConfig = readHAConfig();
if (haConfig?.drive) {
  app.setPath('userData', path.join(haConfig.drive + ':\\Electron'));
}

let mainWindow = null;

// ── УЧЁТНЫЕ ЗАПИСИ ──
// Каждая запись — отдельный экземпляр клиента (BrowserView) со своим хранилищем. Все работают
// одновременно: у скрытых живёт своё WebSocket-соединение, поэтому приходят и уведомления, и счётчики.
// Первая запись ('main') живёт в обычном хранилище приложения — действующие входы не теряются;
// добавленные получают собственный раздел persist:acc-<id>.
const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
let accounts = [];                 // [{ id, partition, meta, unread, pending }]
let activeAccountId = 'main';
let prevActiveAccountId = 'main';  // куда вернуться, если добавление новой записи отменят
const accountViews = new Map();    // id -> BrowserView
const wcAccount = new Map();       // webContents.id -> id записи

function loadAccounts() {
  try {
    const d = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    accounts = (d.accounts || []).filter(a => a && a.id)
      .map(a => ({ id: a.id, partition: a.partition || null, meta: a.meta || null, unread: 0 }));
    activeAccountId = accounts.some(a => a.id === d.active) ? d.active : accounts[0]?.id;
  } catch {}
  if (!accounts.length) { accounts = [{ id: 'main', partition: null, meta: null, unread: 0 }]; activeAccountId = 'main'; }
  prevActiveAccountId = activeAccountId;
}
function saveAccounts() {
  try {
    const keep = accounts.filter(a => !a.pending);
    const active = accounts.find(a => a.id === activeAccountId && !a.pending) ? activeAccountId : prevActiveAccountId;
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: keep.map(({ id, partition, meta }) => ({ id, partition, meta })), active }));
  } catch {}
}
const accountIdOf = e => wcAccount.get(e.sender.id) || 'main';
// Файлы входа и ключей секретных чатов — свои у каждой записи (id чатов на разных серверах совпадают)
const accFile = (file, id) => id === 'main' ? file : file.replace(/\.bin$/, `.${id}.bin`);
const totalUnread = () => accounts.reduce((sum, a) => sum + (a.unread || 0), 0);

function accountsPayload() {
  return { activeId: activeAccountId,
    accounts: accounts.filter(a => !a.pending).map(a => ({ id: a.id, meta: a.meta, unread: a.unread || 0 })) };
}
function broadcastAccounts() {
  const base = accountsPayload();
  for (const [id, view] of accountViews) {
    if (view.webContents.isDestroyed()) continue;
    view.webContents.send('accounts-changed', { ...base, selfId: id, active: id === activeAccountId });
  }
}
function broadcastToViews(channel, ...args) {
  for (const view of accountViews.values()) {
    if (!view.webContents.isDestroyed()) view.webContents.send(channel, ...args);
  }
}

function attachInputMenu(wc) {
  // Стандартное меню «Вырезать / Копировать / Вставить» для полей ввода. Electron сам его
  // не показывает, если приложение не создало. Только для редактируемых полей: сообщения
  // и списки чатов открывают свои меню в рендерере
  wc.on('context-menu', (_, params) => {
    if (!params.isEditable) return;
    const flags = params.editFlags;
    Menu.buildFromTemplate([
      // Подписи заданы явно: роли без label берут язык из локали Electron, а она на Windows и
      // macOS оказывается английской даже при русской системе. Действия остаются от ролей
      { role: 'cut', label: 'Вырезать', enabled: flags.canCut },
      { role: 'copy', label: 'Копировать', enabled: flags.canCopy },
      { role: 'paste', label: 'Вставить', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Выделить всё', enabled: flags.canSelectAll },
    ]).popup({ window: mainWindow, x: params.x, y: params.y });
  });
}

function createAccountView(acc) {
  const view = new BrowserView({ webPreferences: {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
    partition: acc.partition || undefined,
    // Скрытые экземпляры должны жить как обычные: соединение и таймеры не засыпают
    backgroundThrottling: false,
    additionalArguments: [`--account-id=${acc.id}`],
  } });
  accountViews.set(acc.id, view);
  wcAccount.set(view.webContents.id, acc.id);
  attachInputMenu(view.webContents);
  view.webContents.loadFile(path.join(__dirname, 'src', 'index.html'));
  return view;
}

// Все экземпляры прикреплены к окну и одного размера: переключение лишь выводит нужный наверх.
// Снятый с окна BrowserView перестаёт отрисовываться, и после возврата вместо кадра оставался чёрный экран
function fitViews() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  for (const view of accountViews.values()) view.setBounds({ x: 0, y: 0, width, height });
}

// «Отошёл» у записи, с которой ушли переключением, через 5 секунд. Таймер здесь, а не в окне скрытой
// записи: Chromium сильно замедляет таймеры страниц, закрытых другими, и статус сменялся с большой задержкой
const AWAY_DELAY_MS = 5000;
const awayTimers = new Map();
function scheduleAway(id) {
  clearTimeout(awayTimers.get(id));
  awayTimers.set(id, setTimeout(() => {
    awayTimers.delete(id);
    const view = accountViews.get(id);
    if (id !== activeAccountId && view && !view.webContents.isDestroyed()) view.webContents.send('presence-away');
  }, AWAY_DELAY_MS));
}

function showAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc || !mainWindow) return;
  const leaving = activeAccountId;
  clearTimeout(awayTimers.get(id)); awayTimers.delete(id);
  const view = accountViews.get(id) || createAccountView(acc);
  if (activeAccountId !== id && !accounts.find(a => a.id === activeAccountId)?.pending) prevActiveAccountId = activeAccountId;
  activeAccountId = id;
  if (!mainWindow.getBrowserViews().includes(view)) mainWindow.addBrowserView(view);
  view.setAutoResize({ width: true, height: true });
  mainWindow.setTopBrowserView(view);
  fitViews();
  saveAccounts();
  broadcastAccounts();
  if (leaving !== id && accounts.some(a => a.id === leaving && !a.pending)) scheduleAway(leaving);
  view.webContents.focus();
}

function destroyAccount(id) {
  const acc = accounts.find(a => a.id === id);
  const view = accountViews.get(id);
  if (view) {
    try { mainWindow?.removeBrowserView(view); } catch {}
    wcAccount.delete(view.webContents.id);
    accountViews.delete(id);
    try { view.webContents.close({ waitForBeforeUnload: false }); } catch {}
  }
  accounts = accounts.filter(a => a.id !== id);
  for (const f of [SESSION_FILE, SECRET_KEYS_FILE]) { if (id !== 'main') { try { fs.unlinkSync(accFile(f, id)); } catch {} } }
  if (acc?.partition) { try { session.fromPartition(acc.partition).clearStorageData(); } catch {} }
  unreadCount = totalUnread();
  updateTray();
}

// ── Общие настройки приложения ──
// Тема, размер текста, масштаб, акцент, узор и фон переписки — одни на все записи. Хранятся здесь,
// а не в хранилище записи: у каждой записи оно своё. Изменение в одной записи сразу уходит в остальные.
const APP_SETTINGS_FILE = path.join(app.getPath('userData'), 'app-settings.json');
let appSettings = null;
try { appSettings = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8')); } catch {}
function cleanAppSettings(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  if (d.theme === 'dark' || d.theme === 'light') out.theme = d.theme;
  if (['small', 'medium', 'large'].includes(d.fontSize)) out.fontSize = d.fontSize;
  const z = Number(d.uiScale); if (Number.isFinite(z) && z >= 50 && z <= 200) out.uiScale = z;
  if (typeof d.accent === 'string' && /^[\w-]{1,24}$/.test(d.accent)) out.accent = d.accent;
  if (typeof d.chatPattern === 'string' && /^[\w-]{0,40}$/.test(d.chatPattern)) out.chatPattern = d.chatPattern;
  if ([1, 2, 3].includes(Number(d.chatPatternLevel))) out.chatPatternLevel = Number(d.chatPatternLevel);
  if (d.chatBg === 'plain' || d.chatBg === 'split') out.chatBg = d.chatBg;
  return out;
}
ipcMain.handle('app-settings-get', () => appSettings);
ipcMain.on('app-settings-set', (e, patch) => {
  const clean = cleanAppSettings(patch);
  if (!Object.keys(clean).length) return;
  appSettings = { ...(appSettings || {}), ...clean };
  try { fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify(appSettings)); } catch {}
  // Остальным записям — сразу; отправившая уже применила у себя
  for (const [, view] of accountViews) {
    if (view.webContents.isDestroyed() || view.webContents.id === e.sender.id) continue;
    view.webContents.send('app-settings-changed', appSettings);
  }
});

// Новая запись: окно входа в отдельном экземпляре; закрыть его можно — вернёмся к прежней записи
function addAccount() {
  if (accounts.some(a => a.pending)) { showAccount(accounts.find(a => a.pending).id); return; }
  const id = 'a' + Date.now().toString(36);
  accounts.push({ id, partition: `persist:acc-${id}`, meta: null, unread: 0, pending: true });
  showAccount(id);
}
function cancelAddAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc || !acc.pending) return;
  destroyAccount(id);
  const back = accounts.find(a => a.id === prevActiveAccountId) || accounts.find(a => !a.pending);
  if (back) showAccount(back.id);
}
// Выход из записи, когда есть другая: запись исчезает из бара, сразу открывается оставшаяся
function removeAccount(id) {
  const rest = accounts.filter(a => !a.pending && a.id !== id);
  if (!rest.length) return false;
  destroyAccount(id);
  showAccount((rest.find(a => a.id === prevActiveAccountId) || rest[0]).id);
  return true;
}
let tray = null;
let unreadCount = 0;
let blinkInterval = null;
let blinkState = false;

const _ASSETS = path.join(__dirname, 'src', 'assets');

// Белый квадрат-бейдж с конвертом внутри — рисуется поверх обычной иконки во
// время мигания при новом сообщении. Один и тот же на всех платформах и темах:
// он и так на короткое время нарушает обычный вид, чтобы привлечь внимание
function getBlinkImage() {
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, buffer: fs.readFileSync(path.join(_ASSETS, 'tray-message.png')) });
  img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(_ASSETS, 'tray-message-2x.png')) });
  return img;
}

// Windows: nativeTheme.shouldUseDarkColors соответствует AppsUseLightTheme, а таскбар
// управляется отдельным ключом SystemUsesLightTheme. При «App light + System dark»
// (частый сценарий) выбиралась чёрная иконка на чёрном таскбаре — не видно.
// Читаем реальный цвет таскбара из реестра и кэшируем результат.
let _winTaskbarDark = null;
function isWindowsTaskbarDark() {
  if (process.platform !== 'win32') return false;
  if (_winTaskbarDark !== null) return _winTaskbarDark;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme',
      { encoding: 'utf8', timeout: 2000, windowsHide: true }
    );
    const m = out.match(/SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    _winTaskbarDark = m ? parseInt(m[1], 16) === 0 : true;
  } catch { _winTaskbarDark = true; }
  return _winTaskbarDark;
}

function getNormalImage() {
  if (process.platform === 'darwin') {
    const img = nativeImage.createEmpty();
    img.addRepresentation({ scaleFactor: 1, buffer: fs.readFileSync(path.join(_ASSETS, 'trayTemplate.png')) });
    img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(_ASSETS, 'trayTemplate-2x.png')) });
    img.setTemplateImage(true);
    return img;
  }
  const dark = process.platform === 'win32' ? isWindowsTaskbarDark() : nativeTheme.shouldUseDarkColors;
  const name = dark ? 'tray-white-24.png' : 'tray-dark-24.png';
  return nativeImage.createFromPath(path.join(_ASSETS, name));
}

function startBlink() {
  if (blinkInterval) return;
  blinkInterval = setInterval(() => {
    blinkState = !blinkState;
    try { tray?.setImage(blinkState ? getBlinkImage() : getNormalImage()); } catch {}
  }, 600);
}

function stopBlink() {
  if (blinkInterval) { clearInterval(blinkInterval); blinkInterval = null; }
  try { tray?.setImage(getNormalImage()); } catch {}
}

function updateTray() {
  if (!tray) return;
  const label = unreadCount > 0 ? `Electron (${unreadCount})` : 'Electron';
  tray.setToolTip(label);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: 'Открыть', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => { app.isQuiting = true; app.quit(); } },
  ]));
  if (unreadCount > 0) startBlink();
  else stopBlink();
  // Кроссплатформенный счётчик: сам делает то же, что app.dock.setBadge на macOS,
  // и то же самое на Linux через Unity/DBus (Ubuntu и совместимые окружения —
  // без такой интеграции в окружении бейдж просто не появится, это его ограничение,
  // не наше). На Windows метод ничего не делает — там счётчик через оверлей ниже
  app.setBadgeCount(unreadCount);
  if (process.platform === 'win32' && mainWindow) {
    mainWindow.setOverlayIcon(getOverlayImage(unreadCount), unreadCount > 0 ? `Непрочитанных: ${unreadCount}` : '');
  }
}

// Оверлей поверх иконки в панели задач Windows — точные числа 1-99, дальше
// «99+» (тройная цифра уже не влезает читаемо на таком маленьком значке)
function getOverlayImage(count) {
  if (count <= 0) return null;
  const name = count > 99 ? 'overlay-more.png' : `overlay-${count}.png`;
  return nativeImage.createFromPath(path.join(_ASSETS, name));
}

const _winBoundsFile = path.join(app.getPath('userData'), 'window-bounds.json');
function _loadWinBounds() {
  try { return JSON.parse(fs.readFileSync(_winBoundsFile, 'utf8')); } catch { return null; }
}
function _saveWinBounds() {
  if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  try { fs.writeFileSync(_winBoundsFile, JSON.stringify(mainWindow.getBounds())); } catch {}
}

function createWindow() {
  const bounds = _loadWinBounds();
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1100, height: bounds?.height ?? 720,
    x: bounds?.x, y: bounds?.y,
    minWidth: 500, minHeight: 540,
    title: 'Electron',
    // Linux: без скруглённой тёмной подложки — только стрелка, как у значка в трее
    icon: path.join(_ASSETS, process.platform === 'linux' ? 'icon-arrow-512.png' : 'icon-512.png'),
    backgroundColor: '#12171d',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  mainWindow.setMenuBarVisibility(false);
  loadAccounts();
  // Экземпляры всех записей поднимаются сразу: у каждой своё соединение с сервером, иначе невыбранная
  // запись остаётся не в сети, пока на неё не нажмут
  for (const acc of accounts) {
    const view = accountViews.get(acc.id) || createAccountView(acc);
    mainWindow.addBrowserView(view);
    view.setAutoResize({ width: true, height: true });
  }
  showAccount(activeAccountId);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', () => { _saveWinBounds(); fitViews(); });
  mainWindow.on('move', _saveWinBounds);
  mainWindow.on('close', e => {
    _saveWinBounds();
    if (!app.isQuiting) {
      e.preventDefault();
      if (process.platform === 'win32') mainWindow.minimize();
      else mainWindow.hide();
    }
  });
  mainWindow.on('focus', () => {
    if (unreadCount === 0) stopBlink();
    if (process.platform === 'win32') mainWindow.flashFrame(false);
    broadcastToViews('window-focus', true);
  });
  mainWindow.on('blur', () => {
    broadcastToViews('window-focus', false);
  });
}

function createTray() {
  try { tray = new Tray(getNormalImage()); }
  catch { tray = new Tray(nativeImage.createEmpty()); }
  updateTray();
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  // Смена системной темы → обновляем иконку под новый цвет таскбара
  nativeTheme.on('updated', () => {
    _winTaskbarDark = null;
    try { tray?.setImage(blinkState ? getBlinkImage() : getNormalImage()); } catch {}
  });
}

// IPC
ipcMain.on('notify', (e, { title, body, chatId }) => {
  if (!Notification.isSupported()) return;
  const accId = accountIdOf(e);
  const n = new Notification({ title, body });
  n.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    // Уведомление может прийти от записи, которая сейчас не открыта — переключаемся на неё
    if (accounts.some(a => a.id === accId)) showAccount(accId);
    const view = accountViews.get(accId);
    if (chatId && view && !view.webContents.isDestroyed()) view.webContents.send('open-chat', chatId);
  });
  n.show();
});

ipcMain.on('unread', (e, count) => {
  const acc = accounts.find(a => a.id === accountIdOf(e));
  if (acc) acc.unread = count;
  const prev = unreadCount;
  unreadCount = totalUnread();   // трей и бейдж иконки — сумма по всем записям
  updateTray();
  broadcastAccounts();
  if (process.platform === 'win32' && count > prev && mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
  if (count === 0 && mainWindow) mainWindow.flashFrame(false);
});

// ── Запасная копия сессии ──
// Хранилище движка живёт в профиле приложения и теряется при переустановке с
// очисткой данных или порче профиля. Дублируем вход в отдельный файл и шифруем
// средствами системы: прочитать сможет только тот же пользователь на той же машине.
const SESSION_FILE = path.join(app.getPath('userData'), 'session.bin');

// DPAPI-шифрование (safeStorage) привязано к паре пользователь+машина — файл,
// зашифрованный так, не читается на другом компьютере. При включённой «Высокой
// доступности» файл специально лежит на сетевом диске, чтобы читаться с любой
// машины под этим пользователем, поэтому в этом режиме храним его как обычный JSON.
ipcMain.handle('session-save', (e, json) => {
  const SESSION_FILE_ = accFile(SESSION_FILE, accountIdOf(e));
  try {
    const isHA = !!haConfig?.drive;
    const data = (!isHA && safeStorage.isEncryptionAvailable())
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8');
    fs.writeFileSync(SESSION_FILE_, data);
    return true;
  } catch { return false; }
});

ipcMain.handle('session-load', (e) => {
  try {
    const file = accFile(SESSION_FILE, accountIdOf(e));
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    const isHA = !!haConfig?.drive;
    if (!isHA && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(buf); } catch { return null; }
    }
    return buf.toString('utf8');
  } catch { return null; }
});

ipcMain.handle('session-clear', (e) => {
  try { fs.unlinkSync(accFile(SESSION_FILE, accountIdOf(e))); } catch {}
  return true;
});

// ── Секретные чаты (E2E): локальный device_id и ключи чатов ──
// Всегда LOCAL_MACHINE_DIR (не app.getPath('userData') — см. пояснение выше про
// HA), всегда через safeStorage без HA-исключения: этот материал не предназначен
// для переноса на другую машину ни в каком режиме.
const SECRET_DEVICE_FILE = path.join(LOCAL_MACHINE_DIR, 'secret_device.bin');
const SECRET_KEYS_FILE = path.join(LOCAL_MACHINE_DIR, 'secret_keys.bin');

function secretFileWrite(file, str) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(str) : Buffer.from(str, 'utf8');
  fs.writeFileSync(file, data);
}
function secretFileRead(file) {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (safeStorage.isEncryptionAvailable()) { try { return safeStorage.decryptString(buf); } catch { return null; } }
  return buf.toString('utf8');
}

// Стабильный идентификатор этого устройства — генерируется один раз. На нём
// держится вся модель одобрения: сервер и собеседник ссылаются именно на него,
// не на пользователя.
ipcMain.handle('secret-device-id', () => {
  try {
    let id = secretFileRead(SECRET_DEVICE_FILE);
    if (!id) { id = crypto.randomUUID(); secretFileWrite(SECRET_DEVICE_FILE, id); }
    return id;
  } catch { return null; }
});

ipcMain.handle('secret-keys-load', (e) => {
  try { return secretFileRead(accFile(SECRET_KEYS_FILE, accountIdOf(e))); } catch { return null; }
});
ipcMain.handle('secret-keys-save', (e, json) => {
  try { secretFileWrite(accFile(SECRET_KEYS_FILE, accountIdOf(e)), json); return true; } catch { return false; }
});

// ── Учётные записи: общение с клиентом ──
ipcMain.handle('accounts-get', (e) => {
  const id = accountIdOf(e);
  return { ...accountsPayload(), selfId: id, active: id === activeAccountId, pending: !!accounts.find(a => a.id === id)?.pending };
});
ipcMain.on('account-switch', (_, id) => showAccount(id));
ipcMain.on('account-add', () => addAccount());
ipcMain.on('account-cancel-add', (e) => cancelAddAccount(accountIdOf(e)));
// Клиент вошёл: запись перестаёт быть «ожидающей», в бар попадают имя и адрес сервера для аватарки
ipcMain.on('account-logged-in', (e, meta) => {
  const acc = accounts.find(a => a.id === accountIdOf(e));
  if (!acc) return;
  acc.pending = false;
  if (meta && typeof meta === 'object') acc.meta = { server: String(meta.server || ''), userId: meta.userId, name: String(meta.name || ''), tag: meta.tag ?? null };
  saveAccounts();
  broadcastAccounts();
});
// Возвращает true, если запись удалена и открыта другая (тогда окно входа показывать не надо)
ipcMain.handle('account-logout', (e) => removeAccount(accountIdOf(e)));

// ── Адрес сервера из имени установщика (только Windows) ──
// Установщик Electron_s192.168.1.2-3000.exe кладёт рядом с приложением файл
// server.cfg, откуда адрес и берётся при первом запуске. Порт отделяется дефисом:
// двоеточие в именах файлов Windows недопустимо.
ipcMain.handle('get-preset-server', () => {
  if (process.platform !== 'win32') return null;
  try {
    const cfg = path.join(path.dirname(app.getPath('exe')), 'server.cfg');
    if (!fs.existsSync(cfg)) return null;
    const raw = fs.readFileSync(cfg, 'utf8').trim();
    if (!raw) return null;
    // host-port → host:port; без порта оставляем как есть
    const m = raw.match(/^(.+)-(\d{2,5})$/);
    return m ? `${m[1]}:${m[2]}` : raw;
  } catch { return null; }
});

ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-hostname', () => os.hostname());
ipcMain.handle('get-os', () => {
  const platform = os.platform();
  let release = os.release();
  if (platform === 'darwin') {
    try { release = require('child_process').execSync('sw_vers -productVersion', { encoding: 'utf8' }).trim(); } catch {}
  }
  let installScope = null;
  if (platform === 'win32') {
    const execPath = process.execPath.toLowerCase();
    const pf  = (process.env['PROGRAMFILES']       || 'c:\\program files').toLowerCase();
    const pf86= (process.env['PROGRAMFILES(X86)']  || 'c:\\program files (x86)').toLowerCase();
    installScope = (execPath.startsWith(pf) || execPath.startsWith(pf86)) ? 'system' : 'profile';
  }
  return { platform, release, installScope };
});

// ── HA IPC ──
// Тип диска отдаём отдельным полем — рендерер сам подбирает иконку и подпись
// в кастомном селекторе, а не готовую строку под системный <select>.
const HA_DRIVE_TYPES = { '2': ['removable', 'Съёмный'], '3': ['local', 'Локальный'], '4': ['network', 'Сетевой'], '5': ['optical', 'Оптический'] };
ipcMain.handle('ha-list-drives', async () => {
  if (process.platform !== 'win32') return [];
  try {
    const { execSync } = require('child_process');
    const out = execSync('wmic logicaldisk get caption,drivetype,volumename', { encoding: 'utf8', timeout: 5000 });
    const lines = out.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const caption = parts[0]; // e.g. C:
      const driveType = parts[1]; // 2=removable,3=local,4=network,5=optical
      const volumeName = parts.slice(2).join(' ') || '';
      if (!/^[A-Z]:$/.test(caption)) return null;
      const [type, typeLabel] = HA_DRIVE_TYPES[driveType] || ['other', 'Диск'];
      return { letter: caption[0], volumeName, type, typeLabel };
    }).filter(Boolean);
  } catch { return []; }
});

ipcMain.handle('ha-get-config', () => readHAConfig());

ipcMain.handle('ha-set-config', (_, drive) => {
  if (!HA_CONFIG_PATH || !drive) return false;
  try {
    fs.mkdirSync(path.dirname(HA_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(HA_CONFIG_PATH, JSON.stringify({ drive }), 'utf8');
    app.relaunch();
    app.quit();
    return true;
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('ha-clear-config', () => {
  if (!HA_CONFIG_PATH) return false;
  try {
    if (fs.existsSync(HA_CONFIG_PATH)) fs.unlinkSync(HA_CONFIG_PATH);
    app.relaunch();
    app.quit();
    return true;
  } catch { return false; }
});

ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
});

ipcMain.handle('set-autostart', (_, enabled) => {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
  }
});

ipcMain.handle('download-file', (e, { url, filename }) => {
  const dest = path.join(app.getPath('downloads'), filename || 'file');
  return new Promise((resolve, reject) => {
    e.sender.session.once('will-download', (event, item) => {
      item.setSavePath(dest);
      item.once('done', (__, state) => {
        if (state === 'completed') resolve(dest);
        else reject(new Error('Download failed: ' + state));
      });
    });
    e.sender.downloadURL(url);
  });
});

ipcMain.handle('file-exists', (_, filePath) => fs.existsSync(filePath));

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('open-file', (_, filePath) => {
  const { shell } = require('electron');
  return shell.openPath(filePath);
});

ipcMain.handle('resize-window', (_, delta) => {
  if (!mainWindow || mainWindow.isMaximized()) return;
  const [w, h] = mainWindow.getSize();
  mainWindow.setSize(Math.max(w + delta, 400), h);
});

// ── LIGHTBOX (просмотр фото/видео) ──
// Отдельное окно без рамки поверх всего, размером точно с монитор — как в Telegram.
// Не обычный <div> внутри окна приложения (тот физически ограничен его размером) и
// не Fullscreen API (разворачивает само окно приложения, что не нужно)
let lightboxWin = null;
function lightboxUrl(payload) {
  const u = pathToFileURL(path.join(__dirname, 'src', 'lightbox.html'));
  u.searchParams.set('url', payload.url || '');
  u.searchParams.set('filename', payload.filename || '');
  u.searchParams.set('type', payload.type || 'image');
  return u.toString();
}
ipcMain.handle('lightbox-open', (_, payload) => {
  // Каждый раз новое окно, а не переиспользование прежнего (loadURL в то же окно)
  if (lightboxWin && !lightboxWin.isDestroyed()) lightboxWin.close();

  const parentBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(parentBounds);
  // На macOS обычное (не полноэкранное) окно не может визуально занимать место под
  // строкой меню, даже если задать y:0 — система сама сдвигает содержимое вниз на
  // её высоту. simple fullscreen это обходит, но переключает скрытие Dock/строки
  // меню на уровне всего приложения — на практике режим не всегда снимался чисто
  // при закрытии, и Dock/меню оставались скрытыми. Поэтому вместо fullscreen на Mac
  // просто подстраиваем окно под workArea — площадь экрана без строки меню и Dock,
  // ту же, что macOS выделил бы окну и так. На Windows/Linux — весь монитор
  const area = process.platform === 'darwin' ? display.workArea : display.bounds;
  const win = new BrowserWindow({
    x: area.x, y: area.y,
    width: area.width, height: area.height,
    frame: false, resizable: false, movable: false,
    skipTaskbar: true, transparent: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  lightboxWin = win;
  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (lightboxWin === win) lightboxWin = null; });
  win.loadURL(lightboxUrl(payload));
});

// Detect if launched at login (should start hidden in tray)
function shouldStartHidden() {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAsHidden;
  }
  return process.argv.includes('--hidden');
}

if (process.platform === 'win32') app.setAppUserModelId('Electron');

// Одна копия приложения: повторный запуск (клик по иконке / вызов из терминала)
// не создаёт второй процесс, а фокусит уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (shouldStartHidden()) {
    // Windows: сворачиваем в taskbar (иконка остаётся), macOS/Linux: скрываем в трей
    if (process.platform === 'win32') mainWindow.minimize();
    else mainWindow.hide();
  }
});

app.on('window-all-closed', e => e.preventDefault());
app.on('activate', () => { mainWindow?.show(); mainWindow?.focus(); });
app.on('before-quit', () => { app.isQuiting = true; });
