const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/browser/owner-follow.ts'),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports:exportsObject,setTimeout,clearTimeout});
const {followExistingOwner}=exportsObject;
function fixture(){
 let role=null;const callbacks=new Set(),following=[];
 const manager={getHostId:()=> 'local',getStreamRole:()=>role,
  addStreamRoleStateCallback:callback=>{callbacks.add(callback);return()=>callbacks.delete(callback)},
  streamState:{setConversationFollowing:(_id,value)=>following.push(value)},logger:{warning(){}},
  ipcBridge:{findThreadOwner:async()=> 'owner',threadStreamFollowingChanged:async()=>{}}};
 return {manager,callbacks,following,snapshot(){role={role:'follower'};for(const callback of callbacks)callback('task')}};
}
async function bounded(promise){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation never settled')),250)})]);}
 finally{clearTimeout(timer)}
}
test('owner discovery cannot hold task initialization forever',async()=>{
 const f=fixture();f.manager.ipcBridge.findThreadOwner=()=>new Promise(()=>{});
 await bounded(followExistingOwner(f.manager,'task',()=>true,15));
 assert.equal(f.callbacks.size,0);
});
test('a missing notification acknowledgement is bounded and releases following state',async()=>{
 const f=fixture();f.manager.ipcBridge.threadStreamFollowingChanged=()=>new Promise(()=>{});
 await assert.rejects(bounded(followExistingOwner(f.manager,'task',()=>true,15)),/state has not arrived/);
 assert.equal(f.callbacks.size,0);assert.equal(f.following.at(-1),false);
});
test('an actual owner snapshot completes attachment even if its notification acknowledgement hangs',async()=>{
 const f=fixture();f.manager.ipcBridge.threadStreamFollowingChanged=()=>{queueMicrotask(()=>f.snapshot());return new Promise(()=>{})};
 await bounded(followExistingOwner(f.manager,'task',()=>true,15));
 assert.equal(f.callbacks.size,0);assert.equal(f.following.at(-1),true);
});
