const {app,BrowserWindow,Menu,session,dialog,shell,ipcMain}=require('electron');
const {spawn,execFile}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const {defaults,readConfig,saveConfig,remoteCommand}=require('./config.cjs');
const {repository,releasesUrl}=require('./updates.cjs');
const {createUpdateControls}=require('./update-window.cjs');
const {acknowledgeUpdate}=require('./update-helper.cjs');
const {installedBundle}=require('./update-install.cjs');
const {createAccountControls}=require('./account-window.cjs');
const version=require('./package.json').version;

app.setName('Codex SSH Desktop');
app.setPath('userData',path.join(os.homedir(),'Library/Application Support/Codex SSH Desktop'));
app.commandLine.appendSwitch('disable-background-networking');
if(!app.requestSingleInstanceLock()){app.quit();return;}
let window,settingsWindow,tunnel,token,viewerSession,config,accountControls,updateControls,connecting=false,quitting=false,retryTimer;
let statusPageUrl=null,reconnectAvailable=false;
const origin='http://127.0.0.1:18214';
function log(message){
  const directory=app.getPath('userData');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.appendFileSync(path.join(directory,'viewer.log'),`${new Date().toISOString()} ${message}\n`,{mode:0o600});
}
function status(title,detail,{reconnect=false}={}){
  if(!window||window.isDestroyed())return Promise.resolve();
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  reconnectAvailable=reconnect;
  statusPageUrl='data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Codex SSH Desktop</title><style>body{margin:0;background:#15191b;color:#eef2ef;font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh}.card{max-width:480px;padding:40px}.label{color:#9be6c4;font-size:11px;letter-spacing:2px}h1{font-size:28px}p{line-height:1.6;color:#b0bbb6}button{margin-top:12px;padding:11px 20px;border:0;border-radius:8px;background:#9be6c4;color:#15231c;font:600 15px -apple-system,sans-serif;cursor:pointer}button:hover{background:#b6f0d6}button:focus-visible{outline:2px solid #eef2ef;outline-offset:4px}button:disabled{opacity:.6;cursor:wait}</style></head><body><div class="card"><div class="label">CODEX SSH DESKTOP</div><h1>${escape(title)}</h1><p>${escape(detail)}</p>${reconnect?'<button id="reconnect" type="button">Reconnect</button>':''}</div></body></html>`);
  return window.loadURL(statusPageUrl);
}
function execCommand(file,args,timeout=65000){return new Promise((resolve,reject)=>execFile(file,args,{timeout,maxBuffer:128*1024},(error,stdout,stderr)=>error?reject(Error(stderr.trim()||error.message)):resolve(stdout)));}
function execSSH(args){return execCommand('/usr/bin/ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',...args]);}
function portOpen(){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:18214});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));});}
function stopTunnel(){if(tunnel){tunnel.removeAllListeners('exit');tunnel.kill();tunnel=null;}}
async function connect(){
  if(connecting||quitting||accountControls?.blocksConnection())return;connecting=true;clearTimeout(retryTimer);
  try{
    config=readConfig(app.getPath('userData'));
    if(!config){await status('Choose your remote computer','Open Connection → Settings to configure an SSH host.');showSettings();return;}
    await status(`Connecting to ${config.sshHost}`,'Establishing an SSH connection. Your Codex login stays on the remote computer.');
    const info=JSON.parse(await execSSH([config.sshHost,remoteCommand(config)]));
    if(!info.ready||!/^[a-f0-9]{64}$/.test(info.token)||info.port!==18314)throw Error('The remote host returned an invalid connection response.');
    token=info.token;stopTunnel();
    if(await portOpen())throw Error('Local port 18214 is in use. Close another SSH desktop viewer, then reconnect.');
    tunnel=spawn('/usr/bin/ssh',['-NT','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-L','127.0.0.1:18214:127.0.0.1:18314','-L','127.0.0.1:18215:127.0.0.1:18315',config.sshHost],{stdio:['ignore','ignore','pipe']});
    let tunnelError='';tunnel.stderr.on('data',data=>{tunnelError=(tunnelError+data.toString()).slice(-2000)});
    tunnel.on('error',error=>log(`SSH could not start: ${error.message}`));
    tunnel.once('exit',()=>{tunnel=null;if(!quitting){log('SSH disconnected');void status('Reconnecting','Reconnecting to the remote host…');retryTimer=setTimeout(()=>void connect(),2000)}});
    for(let i=0;i<80;i++){if(await portOpen())break;if(!tunnel)throw Error(tunnelError.trim()||'SSH tunnel closed.');await new Promise(resolve=>setTimeout(resolve,100));}
    if(!await portOpen())throw Error('SSH forwarding did not become ready.');
    await viewerSession.setProxy({proxyRules:'http=127.0.0.1:18215;https=127.0.0.1:18215',proxyBypassRules:'<-loopback>;127.0.0.1:18214'});
    if(await viewerSession.resolveProxy(origin)!=='DIRECT'||!(await viewerSession.resolveProxy('https://example.com')).includes('127.0.0.1:18215'))throw Error('SSH traffic routing could not be verified.');
    await viewerSession.cookies.set({url:origin,name:config.sessionCookie,value:token,httpOnly:true,sameSite:'strict',path:'/'});
    await window.loadURL(origin);
    log(`Connected; viewer ${version}; remote desktop ${info.version}; remote runtime PID ${info.pid}`);
  }catch(error){log(`Connection failed: ${error.message}`);await status('Connection needs attention',`${error.message} Try reconnecting, or open Connection → Settings to check your SSH host.`,{reconnect:true});}
  finally{connecting=false;}
}
async function openRemote(url){
  if(!token||!config)return;
  try{
    const target=new URL(url);if(!['http:','https:'].includes(target.protocol))return;
    const result=await fetch(origin+'/__external',{method:'POST',headers:{'Content-Type':'application/json',Cookie:`${config.sessionCookie}=${token}`,Origin:origin},body:JSON.stringify({url:target.href}),signal:AbortSignal.timeout(15000)});
    if(!result.ok)throw Error(`Remote browser returned HTTP ${result.status}`);
  }catch(error){log(`Could not open remote link: ${error.message}`);}
}
function showSettings(){
  if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.focus();return;}
  settingsWindow=new BrowserWindow({width:550,height:665,resizable:true,minWidth:500,minHeight:570,title:'Connection settings',backgroundColor:'#15191b',webPreferences:{preload:path.join(__dirname,'settings-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  settingsWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  settingsWindow.webContents.on('will-navigate',event=>event.preventDefault());
  settingsWindow.on('closed',()=>{settingsWindow=null});
  void settingsWindow.loadFile(path.join(__dirname,'settings.html'));
}
function requireSettingsSender(event){if(!settingsWindow||event.sender!==settingsWindow.webContents)throw Error('Settings are only available from the connection window.');}
ipcMain.on('connection-status:reconnect',event=>{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!reconnectAvailable||window.webContents.getURL()!==statusPageUrl)
    return;
  void connect();
});
ipcMain.handle('connection-settings:read',event=>{requireSettingsSender(event);try{return readConfig(app.getPath('userData'))??{...defaults}}catch{return{...defaults}}});
ipcMain.handle('connection-settings:save',async(event,input)=>{
  requireSettingsSender(event);
  if(connecting||accountControls?.blocksConnection())return{error:'A connection or account operation is in progress. Try again shortly.'};
  try{
    config=saveConfig(app.getPath('userData'),input);settingsWindow.close();
    clearTimeout(retryTimer);stopTunnel();await new Promise(resolve=>setTimeout(resolve,300));void connect();
    return{saved:true};
  }catch(error){return{error:error.message};}
});
app.on('login',(event,_contents,_details,authInfo,callback)=>{if(authInfo.isProxy&&authInfo.host==='127.0.0.1'&&authInfo.port===18215&&config){event.preventDefault();callback(config.proxyUsername,token||'')}});
app.on('second-instance',(_event,argv)=>{if(argv.includes('--accounts'))accountControls?.show();else{window?.show();window?.focus()}});
app.on('before-quit',()=>{quitting=true;clearTimeout(retryTimer);stopTunnel();updateControls?.beforeQuit()});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  app.setAboutPanelOptions({applicationName:'Codex SSH Desktop',applicationVersion:version,credits:'Independent community project. Not affiliated with OpenAI.'});
  viewerSession=session.fromPartition('codex-ssh-desktop-memory');
  viewerSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window=new BrowserWindow({width:1380,height:950,minWidth:820,minHeight:600,title:'Codex SSH Desktop',backgroundColor:'#15191b',titleBarStyle:'hiddenInset',webPreferences:{preload:path.join(__dirname,'status-preload.cjs'),session:viewerSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{void openRemote(url);return{action:'deny'}});
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')&&url!==origin&&!url.startsWith('data:')){event.preventDefault();void openRemote(url)}});
  window.webContents.on('page-title-updated',event=>{event.preventDefault();window.setTitle('Codex SSH Desktop')});
  window.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame)log(`Page load failed ${code}: ${description}`)});
  window.webContents.on('render-process-gone',(_event,details)=>log(`Viewer renderer exited: ${details.reason}`));
  window.webContents.on('did-finish-load',()=>log('Viewer page finished loading'));
  accountControls=createAccountControls({userData:app.getPath('userData'),
    getConfig:()=>readConfig(app.getPath('userData')),isConnecting:()=>connecting,operationsBlocked:()=>updateControls?.blocksAccounts(),
    pauseConnection:()=>{clearTimeout(retryTimer);stopTunnel();void status('Switching the remote account','The remote operation continues over SSH. Open Accounts to follow its progress.');},
    resumeConnection:()=>{setTimeout(()=>void connect(),0);},onMenuChanged:buildMenu});
  updateControls=createUpdateControls({version,userData:app.getPath('userData'),blocksInstall:()=>accountControls.blocksConnection(),
    readPrivateRelease:async()=>{
      const gh=['/opt/homebrew/bin/gh','/usr/local/bin/gh'].find(file=>fs.existsSync(file));
      if(!gh)throw Error('GitHub CLI is unavailable');
      return JSON.parse(await execCommand(gh,['api',`repos/${repository}/releases/latest`],12000));
    }});
  function buildMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Codex SSH Desktop',submenu:[{role:'about'},{label:'Check for Updates…',click:()=>updateControls.show()},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'Connection',submenu:[{label:'Settings…',accelerator:'CmdOrCtrl+,',click:showSettings},{label:'Reconnect',accelerator:'CmdOrCtrl+Shift+R',click:()=>void connect()},{label:'Reload view',accelerator:'CmdOrCtrl+R',click:()=>window.reload()}]},
    {label:'Accounts',submenu:accountControls.menu()},
    {label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]},
    {label:'Help',submenu:[{label:'Setup guide',click:()=>void shell.openExternal(`https://github.com/${repository}#readme`)},{label:'Releases',click:()=>void shell.openExternal(releasesUrl)}]},
  ]));}
  buildMenu();
  // The bundle retains Electron's executable name; determine its location directly.
  try{await acknowledgeUpdate({userData:app.getPath('userData'),version,target:installedBundle()});}catch(error){log(`Update recovery: ${error.message}`);}
  if(process.argv.includes('--accounts'))accountControls.show();
  await accountControls.restorePending();
  await connect();
});
