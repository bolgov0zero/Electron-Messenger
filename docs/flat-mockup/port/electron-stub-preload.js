// Заглушка preload.js для снимков основного окна Электрона без main.js (см. shot-electron.js).
// Данные берёт из файла, путь к которому в переменной SHOT_STUB: { platform, session, shared, accounts, version }.
const { contextBridge } = require('electron');
const fs = require('fs');
const C = JSON.parse(fs.readFileSync(process.env.SHOT_STUB, 'utf8'));
const none = () => Promise.resolve(null);
const noop = () => {};
contextBridge.exposeInMainWorld('electron', {
  notify: noop, setUnread: noop, setAccountStatus: noop, getPlatform: () => Promise.resolve(C.platform || 'darwin'),
  onTitlebar: noop, onDeepLinkCall: noop, tbDrag: noop, tbZoom: noop,
  sessionSave: none, sessionLoad: () => Promise.resolve(C.session ? JSON.stringify(C.session) : null), sessionClear: none,
  secretDeviceId: () => Promise.resolve('stub-device'), secretKeysLoad: none, secretKeysSave: none,
  getPresetServer: () => Promise.resolve(C.preset || null),
  getVersion: () => Promise.resolve(C.version || '3.36.0'), checkUpdate: () => Promise.resolve({ upToDate: true }), installUpdate: none,
  onUpdateProgress: noop, onUpdateRestarting: noop, onWindowFocus: noop, onOpenChat: noop,
  appSettingsGet: () => Promise.resolve(C.shared || {}), appSettingsSet: noop, onAppSettingsChanged: noop, onPresenceAway: noop,
  diag: noop, diagRead: () => Promise.resolve(''), updateUiShow: noop, onUpdateUi: noop, onUpdateUiHide: noop,
  accountsGet: () => Promise.resolve(C.accounts || null), onAccountsChanged: noop,
  accountSwitch: noop, accountAdd: noop, accountCancelAdd: noop, accountLoggedIn: noop, accountLogout: none,
  getHostname: () => Promise.resolve('stand'), getOS: () => Promise.resolve('macOS'),
  getAutostart: () => Promise.resolve(false), setAutostart: none, downloadFile: none, restartApp: none,
  fileExists: () => Promise.resolve(false), openFile: none, resizeWindow: none,
  openLightboxWindow: none, lightboxAction: none, onLightboxAction: noop,
  callOpen: none, callStatus: none, callMediaStatus: none, callMediaAsk: none, callCmd: noop, onCallState: noop,
  callIncomingShow: none, callIncomingHide: noop, onCallIncomingAction: noop,
  deviceInfo: none, devkeyLoad: none, devkeySave: none, devkeyClear: none,
  haProfileLoad: none, haProfileSave: none, haProfileClear: none, haLegacyLoad: none, haLegacyCleanup: none,
  listDrives: () => Promise.resolve([{ letter: 'D', label: 'Данные', free: '120 ГБ' }]), getHAConfig: none, setHAConfig: none, clearHAConfig: none,
});
