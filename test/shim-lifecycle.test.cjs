const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture(){
 const exports={},sent=[];let failed,received;
 const dependencies={
  './mobile':{installMobileLayout(){}},'./mobile-viewport':{MOBILE_QUERY:'mobile'},
  './connection':{connectRenderer(deliver,onFailure){received=deliver;failed=onFailure;return message=>sent.push(message)}},
  './transcription':{},'./diagnostic-log':{prepareIpcArgs:args=>args},
  './routes':{mapBrowserPathToInitialRoute:()=>({memoryPath:'/'}),createBrowserNavigationSync:()=>()=>false},
  './goal-resume':{},'./owner-follow':{},'./capabilities':{},
  './files':{isLocalFilePickerMessage:()=>false},
  './workspace-root-dialog':{openSelectWorkspaceRootDialog:({listDirectory})=>listDirectory(null)},
 };
 const window={location:{pathname:'/',search:'',hash:''},history:{pushState(){}}};
 class Port extends EventTarget{closed=false;start(){}close(){this.closed=true}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/browser/shim.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name]},window,crypto:{randomUUID:()=> 'fixture'},matchMedia:()=>({matches:false}),MessagePort:Port,console});
 return {ipc:exports.ipcRenderer,emit:exports.emitRendererEvent,sent,Port,fail:()=>failed('session reset'),receive:message=>received(message)};
}
test('terminal disconnect rejects pending and future calls and closes transferred ports',async()=>{
 const f=fixture(),port=new f.Port();
 const invoke=f.ipc.invoke('fixture'),directory=f.ipc.invoke('codex_desktop:message-from-view',{type:'electron-pick-workspace-root-option'});
 const first=assert.rejects(invoke,/session ended/i),second=assert.rejects(directory,/session ended/i);
 f.ipc.postMessage('fixture',{},[port]);f.fail();await Promise.all([first,second]);
 assert.equal(port.closed,true);
 const count=f.sent.length;await assert.rejects(f.ipc.invoke('fixture'),/session ended/i);assert.equal(f.sent.length,count);
});
test('normal pending calls still resolve through the bridge',async()=>{
 const f=fixture(),call=f.ipc.invoke('fixture');
 f.receive({type:'ipc-renderer-invoke-result',requestId:f.sent[0].requestId,ok:true,result:'ready'});
 assert.equal(await call,'ready');
});
test('browser IPC once removal and listener dispatch match the desktop contract',()=>{
 const f=fixture(),events=[];
 const removed=()=>events.push('removed');f.ipc.once('event',removed);f.ipc.off('event',removed);
 f.ipc.on('event',()=>{events.push('first');f.ipc.on('event',()=>events.push('late'))});
 f.emit('event',[]);assert.deepEqual(events,['first']);
 f.emit('event',[]);assert.deepEqual(events,['first','first','late']);
});
