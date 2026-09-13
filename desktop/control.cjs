const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const state=path.join(root,'runtime');
const tokenPath=path.join(state,'viewer-token');
const pidFile=path.join(state,'server.pid');
const command=process.argv[2]||'status';
async function health(){
  if(!fs.existsSync(tokenPath))return null;
  const token=fs.readFileSync(tokenPath,'utf8').trim();
  try{const r=await fetch('http://127.0.0.1:18314/__health',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});return r.ok?await r.json():null;}catch{return null;}
}
async function run(){
  if(!['status','ensure','stop'].includes(command))throw Error('Usage: node desktop/control.cjs status|ensure|stop');
  if(command==='status'){console.log(JSON.stringify(await health()??{ready:false}));return;}
  if(command==='stop'){
    if(!fs.existsSync(pidFile))return;
    const pid=Number(fs.readFileSync(pidFile,'utf8'));
    const actual=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();
    if(!actual.includes(path.join(root,'src/server/main.js')))throw Error('PID no longer belongs to this runtime; refusing to stop it.');
    process.kill(pid,'SIGTERM');fs.unlinkSync(pidFile);console.log('Stopped only this auxiliary runtime.');return;
  }
  fs.mkdirSync(state,{recursive:true,mode:0o700});
  if(!fs.existsSync(tokenPath))fs.writeFileSync(tokenPath,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
  let h=await health();
  if(!h){
    if(fs.existsSync(pidFile)){
      const pid=Number(fs.readFileSync(pidFile,'utf8'));
      try{process.kill(pid,0);throw Error(`Auxiliary process ${pid} exists but is unhealthy. Inspect runtime/server.log before restarting.`);}catch(error){if(error.code!=='ESRCH')throw error;}
    }
    const build=JSON.parse(fs.readFileSync(path.join(__dirname,'build-info.json'),'utf8'));
    const resources=path.join(build.app,'Contents/Resources');
    if(!fs.existsSync(path.join(resources,'codex')))throw Error('The installed desktop engine could not be found.');
    const profile=path.join(state,'electron-profile');fs.mkdirSync(profile,{recursive:true,mode:0o700});
    const globalState=path.join(os.homedir(),'.codex/.codex-global-state.json'),backup=path.join(state,'global-state-before-viewer.json');
    if(fs.existsSync(globalState)&&!fs.existsSync(backup)){fs.copyFileSync(globalState,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600)}
    const log=fs.openSync(path.join(state,'server.log'),'a',0o600);
    const child=spawn(process.execPath,[path.join(root,'src/server/main.js'),'--host','127.0.0.1','--port','18314'],{
      cwd:root,detached:true,stdio:['ignore',log,log],env:{...process.env,
        CODEX_HOME:path.join(os.homedir(),'.codex'),CODEX_CLI_PATH:path.join(resources,'codex'),
        CODEX_ELECTRON_USER_DATA_PATH:profile,CODEX_ELECTRON_RESOURCES_PATH:resources,
        CODEX_ELECTRON_START_IN_BACKGROUND:'1',CODEX_APP_SERVER_FORCE_CLI:'1',
        CODEX_REMOTE_DESKTOP_RESOURCES:resources,CODEX_REMOTE_VIEWER_TOKEN_FILE:tokenPath,
      },
    });
    fs.writeFileSync(pidFile,String(child.pid),{mode:0o600});child.unref();fs.closeSync(log);
  }
  for(let attempt=0;attempt<90;attempt++){
    h=await health();
    if(h?.ready){console.log(JSON.stringify({...h,port:18314,token:fs.readFileSync(tokenPath,'utf8').trim()}));return;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Auxiliary startup did not complete. Inspect runtime/server.log.');
}
run().catch(error=>{console.error(error.message);process.exitCode=1});
