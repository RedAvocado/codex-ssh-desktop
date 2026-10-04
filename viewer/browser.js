const address=document.querySelector('#address'),status=document.querySelector('#status');
function render(state){
  if(document.activeElement!==address)address.value=state.url;
  document.querySelector('#back').disabled=!state.canGoBack;
  document.querySelector('#forward').disabled=!state.canGoForward;
  status.classList.toggle('error',Boolean(state.error));
  status.textContent=state.error||(state.loading?'Loading… · ':state.online?'Connected · ':'Reconnecting… · ')+`Websites use ${state.host} over SSH. Localhost is on the remote Mac.`;
}
window.websiteBrowser.onState(render);
window.websiteBrowser.onFocus(()=>{address.focus();address.select();});
window.websiteBrowser.read().then(render);
document.querySelector('#navigation').addEventListener('submit',event=>{
  event.preventDefault();let url=address.value.trim();if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(url))url=(/^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|\[::\]|0\.0\.0\.0)(:|\/|$)/i.test(url)?'http://':'https://')+url;
  address.blur();window.websiteBrowser.action('open',url).then(render);
});
for(const action of ['back','forward','reload'])document.querySelector('#'+action).addEventListener('click',()=>window.websiteBrowser.action(action).then(render));
