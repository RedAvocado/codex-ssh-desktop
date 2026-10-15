const {BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {browserProxy,websiteURL}=require('./browser-policy.cjs');

function createBrowserControls({getHost,ensureConnection}) {
  let window,view,browserSession,sessionKey,online=false,pendingURL='',error='',loading=false;
  let generation=0,requestId=0,setupPromise,readyPromise;
  const controlsURL=require('node:url').pathToFileURL(path.join(__dirname,'browser.html')).href;
  const state=()=>({url:pendingURL||view?.webContents.getURL()||'',host:getHost()||'remote Mac',online,loading,error,
    canGoBack:view?.webContents.navigationHistory.canGoBack()??false,canGoForward:view?.webContents.navigationHistory.canGoForward()??false});
  function publish(){if(window&&!window.isDestroyed())window.webContents.send('browser:state',state());}
  function layout(){if(!window||!view)return;const [width,height]=window.getContentSize();view.setBounds({x:0,y:108,width,height:Math.max(0,height-108)});}
  function destroyView(){generation++;if(view){window?.contentView.removeChildView(view);view.webContents.close();view=null;}}
  function setupView(){
    if(setupPromise)return setupPromise;
    setupPromise=initializeView().finally(()=>{setupPromise=null;});return setupPromise;
  }
  async function initializeView(){
    const host=getHost();if(!host)throw Error('Configure the SSH connection first.');
    if(view&&sessionKey===host)return;
    destroyView();sessionKey=host;const owner=window,revision=generation;
    // An independent session: websites never receive the viewer's authentication cookie or preload.
    browserSession=session.fromPartition('ssh-websites-'+crypto.createHash('sha256').update(host).digest('hex'));
    browserSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    browserSession.setPermissionCheckHandler(()=>false);
    await browserSession.setProxy(browserProxy);
    for(const url of ['http://localhost:3000','https://example.com','http://[::1]:3000']){
      if(!(await browserSession.resolveProxy(url)).includes('127.0.0.1:18216'))throw Error('Website tunnel routing could not be verified.');
    }
    if(!window||window!==owner||generation!==revision)return;
    view=new WebContentsView({webPreferences:{session:browserSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    window.contentView.addChildView(view);layout();
    const contents=view.webContents;
    contents.setWindowOpenHandler(({url})=>{void navigate(url).catch(showError);return{action:'deny'};});
    const validate=(event,url)=>{try{websiteURL(url);}catch{event.preventDefault();showError(Error('This link is not an HTTP or HTTPS website.'));}};
    contents.on('will-navigate',validate);contents.on('will-redirect',validate);
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.on('did-start-loading',()=>{loading=true;error='';publish();});
    contents.on('did-stop-loading',()=>{loading=false;publish();});
    contents.on('did-navigate',(_event,url)=>{pendingURL=url;error='';publish();});
    contents.on('did-navigate-in-page',(_event,url,isMainFrame)=>{if(isMainFrame){pendingURL=url;publish();}});
    contents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{
      if(isMainFrame&&code!==-3){loading=false;error=`Could not load this page (${description}). Check the remote server, then retry.`;publish();}
    });
    contents.on('render-process-gone',()=>showError(Error('The website renderer stopped. Use Reload to reopen the page.')));
  }
  function showError(cause){error=cause.message;loading=false;publish();}
  async function show(){
    if(window&&!window.isDestroyed()){window.show();window.focus();await readyPromise;return;}
    window=new BrowserWindow({width:1100,height:820,minWidth:650,minHeight:400,title:'Browser · Codex SSH Desktop',backgroundColor:'#15191b',
      webPreferences:{preload:path.join(__dirname,'browser-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.on('resize',layout);
    window.on('close',()=>{requestId++;loading=false;destroyView();});
    window.on('closed',()=>{window=null;});
    readyPromise=window.loadFile(path.join(__dirname,'browser.html'));await readyPromise;publish();
  }
  async function navigate(input){
    const target=websiteURL(input),current=++requestId;await show();if(current!==requestId)return;
    pendingURL=target;error='';loading=true;publish();
    try{
      await ensureConnection();if(current!==requestId)return;await setupView();if(current!==requestId||!view)return;
      await view.webContents.loadURL(target);
      if(current===requestId){online=true;error='';publish();}
    }catch(cause){if(current===requestId)showError(cause);}
  }
  function authorize(event){
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==controlsURL)
      throw Error('Browser controls are only available from the local toolbar.');
  }
  ipcMain.handle('browser:read',event=>{authorize(event);return state();});
  ipcMain.handle('browser:action',async(event,action,value)=>{
    authorize(event);
    try{
      if(action==='open')await navigate(value);
      else if(action==='back'&&view?.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();
      else if(action==='forward'&&view?.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();
      else if(action==='reload'&&pendingURL)await navigate(pendingURL);
      else if(action==='focus')window.webContents.send('browser:focus');
    }catch(cause){showError(cause);}
    return state();
  });
  return {open:navigate,async show(){await show();window?.webContents.send('browser:focus');},
    reloadFocused(){if(!window?.isFocused())return false;if(pendingURL)void navigate(pendingURL);return true;},
    async connectionChanged(connected){online=connected;publish();
      if(!connected)return;
      if(sessionKey&&sessionKey!==getHost()){requestId++;destroyView();pendingURL='';error='Remote computer changed. Enter a website to open on this host.';publish();return;}
      await browserSession?.closeAllConnections();
      if(error&&pendingURL&&view)void navigate(pendingURL);
    },dispose(){window?.close();}};
}
module.exports={createBrowserControls};
