const form=document.querySelector('form');
const error=document.querySelector('#error');
let existing={};
window.connectionSettings.read().then(config=>{
  existing=config;
  for(const key of ['sshHost','remoteDirectory','remoteNode'])form.elements[key].value=config[key]??'';
  form.elements.sshHost.focus();
}).catch(e=>{error.textContent=e.message;});
form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='';form.querySelector('button').disabled=true;
  try{
    const result=await window.connectionSettings.save({...existing,...Object.fromEntries(new FormData(form))});
    if(result?.error)throw Error(result.error);
  }catch(e){error.textContent=e.message;form.querySelector('button').disabled=false;}
});
