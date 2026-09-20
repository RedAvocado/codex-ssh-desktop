const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 let connected=false,child,url='about:blank',fail=false;const loads=[],timers=[];
 const app={setName(){},setPath(){},getPath:()=>'/fixture',commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>new Promise(()=>{})};
 const dependencies={electron:{app,ipcMain:{on(){},handle(){}}},
  'node:child_process':{
   execFile(_file,_args,_options,callback){queueMicrotask(()=>callback(fail?Error('fixture SSH failure'):null,JSON.stringify({ready:true,token:'a'.repeat(64),port:18314,version:'test',pid:42}),''))},
   spawn(){connected=true;child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{connected=false};return child},
  },'node:path':path,'node:os':{homedir:()=>'/fixture'},'node:fs':{mkdirSync(){},appendFileSync(){}},
  'node:net':{connect(){const socket=new EventEmitter();socket.destroy=()=>{};queueMicrotask(()=>socket.emit(connected?'connect':'error'));return socket}},
  './config.cjs':{readConfig:()=>({sshHost:'fixture',sessionCookie:'remote_session'}),remoteCommand:()=> 'fixture'},
  './updates.cjs':{},'./update-window.cjs':{},'./update-helper.cjs':{},'./update-install.cjs':{},'./account-window.cjs':{},'./package.json':{version:'test'},
 };
 const module={exports:{}};
 const source=fs.readFileSync(require.resolve('../viewer/main.cjs'),'utf8')+'\nmodule.exports={connect,initialize(w,s){window=w;viewerSession=s}};';
 vm.runInNewContext('(function(){'+source+'})()',{module,require:name=>{assert.ok(name in dependencies,name);return dependencies[name]},__dirname:'/fixture',process:{argv:[]},URL,console,
  setTimeout:callback=>{timers.push(callback);return timers.length},clearTimeout(){}});
 const window={isDestroyed:()=>false,webContents:{getURL:()=>url},async loadURL(value){url=value;loads.push(value)}};
 const session={async setProxy(){},async resolveProxy(target){return target==='http://127.0.0.1:18214'?'DIRECT':'PROXY 127.0.0.1:18215'},cookies:{async set(){}}};
 module.exports.initialize(window,session);
 return {connect:module.exports.connect,loads,timers,get url(){return url},fail(){fail=true},navigate(){url='http://127.0.0.1:18214/thread/fixture'},disconnect(){connected=false;child.emit('exit')}};
}
test('SSH reconnect keeps the existing task document and its unsent draft',async()=>{
 const f=fixture();await f.connect();f.navigate();const count=f.loads.length;
 f.disconnect();assert.equal(f.loads.length,count);await f.connect();
 assert.equal(f.loads.length,count);assert.match(f.url,/thread\/fixture$/);
});
test('an unsuccessful background reconnect keeps the task visible and schedules another attempt',async()=>{
 const f=fixture();await f.connect();f.navigate();const count=f.loads.length;f.disconnect();f.fail();
 await f.connect();assert.equal(f.loads.length,count);assert.ok(f.timers.length>=2);
});
