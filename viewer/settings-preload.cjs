const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('connectionSettings',{
  read:()=>ipcRenderer.invoke('connection-settings:read'),
  save:settings=>ipcRenderer.invoke('connection-settings:save',settings),
});
