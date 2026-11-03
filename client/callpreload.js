// Мост окна звонка (call.html): только то, что ему нужно для разговора.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callApi', {
  init: () => ipcRenderer.invoke('call-init'),
  mediaAccess: kind => ipcRenderer.invoke('call-media-access', kind),
  state: st => ipcRenderer.send('call-state', st),
  onCmd: cb => ipcRenderer.on('call-cmd', (_, c) => cb(c)),
  // Показ экрана: список источников приходит из главного процесса, выбор уходит обратно
  onPickScreen: cb => ipcRenderer.on('call-pick-screen', (_, l) => cb(l)),
  onScreenDenied: cb => ipcRenderer.on('call-screen-denied', () => cb()),
  screenChosen: id => ipcRenderer.send('call-screen-chosen', id),
});
