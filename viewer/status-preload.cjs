const {ipcRenderer}=require('electron');

// Report bridge failures without ever inspecting task content or successful responses.
// This catches the otherwise opaque 432 error that leaves an empty task pane.
const reported=new Set();
window.addEventListener('message',event=>{
  if(location.origin!=='http://127.0.0.1:18214'||event.source&&event.source!==window)return;
  const value=event.data;
  if(value?.type!=='fetch-response'||value.responseType!=='error'||![432,500].includes(value.status)||typeof value.error!=='string')return;
  const message=value.error.slice(0,1000);
  if(reported.has(message)||reported.size>=10)return;
  reported.add(message);ipcRenderer.send('viewer:diagnostic',message);
});
window.addEventListener('error',event=>{
  if(location.origin==='http://127.0.0.1:18214'&&typeof event.message==='string')ipcRenderer.send('viewer:diagnostic',event.message);
});

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
