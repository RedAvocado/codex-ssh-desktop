const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ViewerThreadRelease}=require('../src/server/viewer-thread-release.js');

function fixture(t,{states={idle:'idle',working:'active',unknown:undefined},views=[]}={}){
  const calls=[],listeners=[];let pending=0;
  const f={views,states,calls,retired:0,pending(value){pending=value}};
  const client={
    getPendingRequestCount:()=>pending,
    registerInternalNotificationHandler:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1)},
    async sendAppServerRequest(method,params,guard){
      if(method==='thread/loaded/list')return {data:Object.keys(states),nextCursor:null};
      assert.equal(method,'thread/unsubscribe');
      f.beforeDispatch?.();guard?.();calls.push(params.threadId);delete states[params.threadId];
      return {status:'unsubscribed'};
    },
    async readThread(id){await f.beforeRead?.(id);return {status:{type:states[id]}}},
  };
  const reaper=new ViewerThreadRelease(()=>f.views,()=>{f.retired++;f.views=[]});
  f.reaper=reaper;f.client=client;f.notify=()=>listeners.forEach(fn=>fn({method:'turn/completed'}));
  reaper.attach(client);t.after(()=>reaper.dispose());return f;
}

test('background view releases idle writers but preserves running and unknown threads',async t=>{
  const f=fixture(t,{views:[{connected:true,parked:true}]});
  await f.reaper.sweep();assert.deepEqual(f.calls,['idle']);assert.equal(f.retired,1);
  assert.deepEqual(f.reaper.snapshot(),{loaded:3,active:2,released:1,errors:0});
});
test('foreground views prevent cleanup, including while another view is parked',async t=>{
  const f=fixture(t,{views:[{connected:true,parked:false},{connected:true,parked:true}]});
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);assert.equal(f.retired,0);
});
test('returning during thread inspection cancels cleanup before the view is retired',async t=>{
  const f=fixture(t);f.beforeRead=()=>{f.views=[{connected:true,parked:false}]};
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);assert.equal(f.retired,0);
});
test('returning while engine readiness is awaited cancels unsubscribe at dispatch',async t=>{
  const f=fixture(t);f.beforeDispatch=()=>{f.views=[{connected:true,parked:false}]};
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);assert.equal(f.reaper.snapshot().errors,1);
});
test('an in-flight turn request prevents a stale idle read from releasing the writer',async t=>{
  const f=fixture(t);f.beforeRead=()=>f.pending(1);
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);assert.equal(f.retired,0);
});
test('a task completing after its view has expired is released by the backend',async t=>{
  const f=fixture(t,{states:{working:'active'}});
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);
  f.states.working='idle';f.notify();await f.reaper.sweep();assert.deepEqual(f.calls,['working']);
});
test('cleanup retries failure and overlapping sweeps never duplicate an unsubscribe',async t=>{
  const f=fixture(t,{states:{idle:'idle'}});let first=true;
  f.beforeDispatch=()=>{if(first){first=false;throw Error('transient')}};
  await f.reaper.sweep();assert.deepEqual(f.calls,[]);
  const a=f.reaper.sweep(),b=f.reaper.sweep();assert.equal(a,b);await a;
  assert.deepEqual(f.calls,['idle']);
});
test('reopened thread can be released again after its later viewer leaves',async t=>{
  const f=fixture(t,{states:{idle:'idle'}});
  await f.reaper.sweep();f.states.idle='idle';f.views=[{connected:true,parked:false}];f.reaper.changed();
  f.views=[];f.reaper.changed();await f.reaper.sweep();assert.deepEqual(f.calls,['idle','idle']);
});
test('explicit background and transient socket loss have different recovery grace',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t,{states:{idle:'idle'},views:[{connected:false,parked:false}]});
  t.mock.timers.tick(1000);assert.deepEqual(f.calls,[]);
  f.views[0]={connected:true,parked:true};f.reaper.changed();t.mock.timers.tick(999);assert.deepEqual(f.calls,[]);
  t.mock.timers.tick(1);await f.reaper.sweep();assert.deepEqual(f.calls,['idle']);
});
test('loaded-thread pagination releases every idle thread',async t=>{
  const f=fixture(t,{states:{one:'idle',two:'idle'}}),send=f.client.sendAppServerRequest;
  f.client.sendAppServerRequest=(method,params,guard)=>method==='thread/loaded/list'
    ?Promise.resolve(params.cursor?{data:['two'],nextCursor:null}:{data:['one'],nextCursor:'next'})
    :send(method,params,guard);
  await f.reaper.sweep();assert.deepEqual(f.calls,['one','two']);
});
