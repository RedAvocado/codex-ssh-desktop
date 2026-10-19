const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ViewerBackgroundOwner}=require('../src/server/viewer-background-owner.js');
const {ViewerThreadRelease}=require('../src/server/viewer-thread-release.js');

function fixture(t){
  const roles=new Map(),states=new Map(),calls=[];
  let events,followers=false,fail=false;
  const manager={
    threadExecution:null,sendAppServerResponse(){},
    getStreamRole:id=>roles.get(id),getConversation:id=>states.get(id),
    setConversationStreamRole:(id,role)=>roles.set(id,role),
    updateConversationState:(id,fn)=>fn(states.get(id)),
    streamState:{attached:false,attach(){this.attached=true},dispose(){},hasFollowersOrPendingFollowerReconnect:()=>followers},
    registerWindowActivity:()=>({[Symbol.dispose](){calls.push('activity-disposed')}}),
    async readThread(){return {thread:{cwd:'/tmp'}}},
    async resumeConversation({conversationId:id}){
      calls.push('resume');roles.set(id,{role:'owner'});states.set(id,{resumeState:'resumed'});
      if(fail)throw Error('resume failed');
      return {status:'ready'};
    },
    onNotification:(method)=>calls.push(method),onRequest:request=>calls.push(request.method),
    markAllConversationsNeedResumeAfterReconnect:()=>calls.push('reconnect'),
  };
  const client={
    registerHostEventHandler:handlers=>{events=handlers;return()=>{events=undefined}},
    async handleClientResponse(response,guard){if(guard())calls.push(response)},
  };
  const owner=new ViewerBackgroundOwner();owner.attach({manager,client,bindOwner:()=>{calls.push('bind-owner')}});
  t.after(()=>owner.dispose());
  return {owner,manager,calls,events:()=>events,followers:v=>followers=v,fail:v=>fail=v};
}

test('abandoned active chat gets one durable owner without creating or interrupting a turn',async t=>{
  const f=fixture(t);await f.owner.adopt('active',()=>true);await f.owner.adopt('active',()=>true);
  assert.deepEqual(f.calls,['bind-owner','resume']);
  f.events().onNotification({method:'turn/completed',params:{threadId:'unrelated'}});
  assert.equal(f.calls.length,2);
  f.events().onNotification({method:'turn/completed',params:{threadId:'active'}});
  assert.equal(f.calls.at(-1),'turn/completed');
});
test('approvals remain explicit and responses are dispatched once through the original engine',async t=>{
  const f=fixture(t);await f.owner.adopt('active',()=>true);
  const request={id:1,method:'item/commandExecution/requestApproval',params:{threadId:'active'}};
  assert.equal(f.events().onRequest({...request,params:{threadId:'unrelated'}}),false);
  assert.equal(f.events().onRequest(request),true);f.events().onRequest(request);
  assert.equal(f.calls.filter(c=>c===request.method).length,1);
  const response={id:1,result:{decision:'decline'}};
  await f.manager.sendAppServerResponse(request.method,response);
  await f.manager.sendAppServerResponse(request.method,response);
  assert.equal(f.calls.filter(c=>c===response).length,1);
});
test('failed adoption clears its ownership claim and is retried',async t=>{
  const f=fixture(t);f.fail(true);await assert.rejects(f.owner.adopt('active',()=>true),/resume failed/);
  assert.equal(f.manager.getStreamRole('active'),null);
  f.fail(false);await f.owner.adopt('active',()=>true);assert.equal(f.manager.getStreamRole('active').role,'owner');
});
test('returning before adoption prevents acquiring ownership',async t=>{
  const f=fixture(t);await f.owner.adopt('active',()=>false);assert.deepEqual(f.calls,[]);
});
test('native follower protects an idle chat and leaving it releases ownership',async t=>{
  const f=fixture(t);await f.owner.adopt('active',()=>true);f.followers(true);
  const sends=[];
  const client={getPendingRequestCount:()=>0,registerInternalNotificationHandler:()=>()=>{},
    sendAppServerRequest:async(method)=>{sends.push(method);return{data:['active']}},
    readThread:async()=>({status:{type:'idle'}})};
  const reaper=new ViewerThreadRelease(()=>[],()=>{},f.owner);reaper.attach(client);t.after(()=>reaper.dispose());
  await reaper.sweep();assert.deepEqual(sends,['thread/loaded/list']);
  f.followers(false);await reaper.sweep();assert.equal(sends.at(-1),'thread/unsubscribe');
  assert.equal(f.manager.getStreamRole('active'),null);
});
test('active cleanup adopts the running chat after retiring the browser',async t=>{
  const order=[];
  const reaper=new ViewerThreadRelease(()=>[],()=>order.push('retire'),{
    adopt:async()=>order.push('adopt'),hasFollowers:()=>false,release:()=>order.push('release')});
  t.after(()=>reaper.dispose());reaper.attach({getPendingRequestCount:()=>0,
    registerInternalNotificationHandler:()=>()=>{},
    sendAppServerRequest:async(method)=>{assert.equal(method,'thread/loaded/list');return{data:['active']}},
    readThread:async()=>({status:{type:'active'}})});
  await reaper.sweep();assert.deepEqual(order,['retire','adopt']);
});

test('cold execution settings leave the engine alone and adoption retries when ready',async t=>{
  const f=fixture(t),resume=f.manager.resumeConversation;
  f.manager.resumeConversation=async()=>({status:'not-ready',reason:'execution-config-loading'});
  await assert.rejects(f.owner.adopt('active',()=>true),/ownership was not established/);
  assert.equal(f.manager.getStreamRole('active'),undefined);
  f.manager.resumeConversation=resume;await f.owner.adopt('active',()=>true);
  assert.equal(f.manager.getStreamRole('active').role,'owner');
  assert.equal(f.calls.filter(c=>c==='bind-owner').length,1);
});

test('disposing a background owner removes event listeners and restores manager hooks',async t=>{
  const f=fixture(t),response=f.manager.sendAppServerResponse;
  await f.owner.adopt('active',()=>true);assert.equal(f.manager.streamState.attached,true);
  f.owner.dispose();assert.equal(f.events(),undefined);assert.equal(f.manager.threadExecution,null);
  assert.equal(f.manager.sendAppServerResponse,response);assert.equal(f.manager.streamState.attached,false);
});
