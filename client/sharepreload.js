// Мост плашки показа экрана: название и кнопка «Остановить»
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shareApi', {
  stop: () => ipcRenderer.send('share-stop'),
  onInfo: cb => ipcRenderer.on('share-info', (_, i) => cb(i)),
});
