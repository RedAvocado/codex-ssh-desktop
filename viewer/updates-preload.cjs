const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('updates', {
  read: () => ipcRenderer.invoke('updates:read'),
  action: kind => ipcRenderer.invoke('updates:action', kind),
  onState: callback => ipcRenderer.on('updates:state', (_event, state) => callback(state)),
});
