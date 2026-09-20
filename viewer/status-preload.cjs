const {ipcRenderer}=require('electron');

// The remote interface gets no new API. Only the local status page has this button.
window.addEventListener('DOMContentLoaded',()=>{
  if(window.location.protocol!=='data:')return;
  const button=document.querySelector('#reconnect');
  if(!button)return;
  button.addEventListener('click',()=>{
    button.disabled=true;
    button.textContent='Reconnecting…';
    ipcRenderer.send('connection-status:reconnect');
  });
});
