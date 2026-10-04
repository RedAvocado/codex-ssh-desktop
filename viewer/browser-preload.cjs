const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('websiteBrowser',{
  read:()=>ipcRenderer.invoke('browser:read'),
  action:(action,value)=>ipcRenderer.invoke('browser:action',action,value),
  onState:callback=>ipcRenderer.on('browser:state',(_event,value)=>callback(value)),
  onFocus:callback=>ipcRenderer.on('browser:focus',()=>callback()),
});
