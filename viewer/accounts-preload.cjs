const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('accounts', {
  read: () => ipcRenderer.invoke('accounts:read'),
  copy: id => ipcRenderer.invoke('accounts:operate', 'copy', id),
  switch: id => ipcRenderer.invoke('accounts:operate', 'switch', id),
  checkSwitch: () => ipcRenderer.invoke('accounts:check-switch'),
  acknowledgeRecovery: () => ipcRenderer.invoke('accounts:acknowledge-recovery'),
  onState: callback => ipcRenderer.on('accounts:state', (_event, state) => callback(state)),
});
