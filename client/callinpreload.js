// Мост окна входящего звонка (callin.html)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callInApi', {
  init: () => ipcRenderer.invoke('call-incoming-init'),
  action: a => ipcRenderer.send('call-incoming-action', a),
});
