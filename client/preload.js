const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  notify: (title, body, chatId) => ipcRenderer.send('notify', { title, body, chatId }),
  setUnread: (count) => ipcRenderer.send('unread', count),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  sessionSave: (json) => ipcRenderer.invoke('session-save', json),
  sessionLoad: () => ipcRenderer.invoke('session-load'),
  sessionClear: () => ipcRenderer.invoke('session-clear'),
  secretDeviceId: () => ipcRenderer.invoke('secret-device-id'),
  secretKeysLoad: () => ipcRenderer.invoke('secret-keys-load'),
  secretKeysSave: (json) => ipcRenderer.invoke('secret-keys-save', json),
  getPresetServer: () => ipcRenderer.invoke('get-preset-server'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: (url) => ipcRenderer.invoke('install-update', url),
  onUpdateProgress: (cb) => {
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.on('update-progress', (_, p) => cb(p));
  },
  onUpdateRestarting: (cb) => {
    ipcRenderer.removeAllListeners('update-restarting');
    ipcRenderer.once('update-restarting', cb);
  },
  onWindowFocus: (cb) => ipcRenderer.on('window-focus', (_, focused) => cb(focused)),
  onOpenChat: (cb) => ipcRenderer.on('open-chat', (_, chatId) => cb(chatId)),
  // Учётные записи: список с бейджами приходит из главного процесса, переключение — туда же
  appSettingsGet: () => ipcRenderer.invoke('app-settings-get'),
  appSettingsSet: (patch) => ipcRenderer.send('app-settings-set', patch),
  onAppSettingsChanged: (cb) => ipcRenderer.on('app-settings-changed', (_, d) => cb(d)),
  onPresenceAway: (cb) => ipcRenderer.on('presence-away', () => cb()),
  accountsGet: () => ipcRenderer.invoke('accounts-get'),
  onAccountsChanged: (cb) => ipcRenderer.on('accounts-changed', (_, d) => cb(d)),
  accountSwitch: (id) => ipcRenderer.send('account-switch', id),
  accountAdd: () => ipcRenderer.send('account-add'),
  accountCancelAdd: () => ipcRenderer.send('account-cancel-add'),
  accountLoggedIn: (meta) => ipcRenderer.send('account-logged-in', meta),
  accountLogout: () => ipcRenderer.invoke('account-logout'),
  getHostname: () => ipcRenderer.invoke('get-hostname'),
  getOS: () => ipcRenderer.invoke('get-os'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  downloadFile: (opts) => ipcRenderer.invoke('download-file', opts),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  resizeWindow: (delta) => ipcRenderer.invoke('resize-window', delta),
  openLightboxWindow: (payload) => ipcRenderer.invoke('lightbox-open', payload),
  // High Availability
  listDrives: () => ipcRenderer.invoke('ha-list-drives'),
  getHAConfig: () => ipcRenderer.invoke('ha-get-config'),
  setHAConfig: (drive) => ipcRenderer.invoke('ha-set-config', drive),
  clearHAConfig: () => ipcRenderer.invoke('ha-clear-config'),
});
