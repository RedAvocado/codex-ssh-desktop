const {test}=require('node:test'),assert=require('node:assert/strict');
const {WebSocket,WebSocketServer}=require('ws');const {once}=require('node:events');const {randomUUID}=require('node:crypto');
const {resumableBridge}=require('../src/server/resumable-bridge.js');
test('real sockets preserve a view across disconnects, deduplicate requests, replay results and expire safely',async t=>{
 let created=0,disposed=0;const received=[];
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 resumableBridge(wss,send=>{created++;return {receive:p=>{received.push(p);send('result')},dispose:()=>disposed++}},80);
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`,id=randomUUID();
 async function connect(resume){const s=new WebSocket(url);const frames=[];s.on('message',raw=>frames.push(JSON.parse(raw)));await once(s,'open');s.send(JSON.stringify({type:'bridge-hello',sessionId:id,resume,ack:0}));await once(s,'message');return {s,frames}}
 let {s,frames}=await connect(false);assert.equal(frames[0].type,'bridge-welcome');
 s.send(JSON.stringify({type:'bridge-data',seq:1,ack:0,payload:'action'}));await once(s,'message');s.close();await once(s,'close');
 ({s,frames}=await connect(true));
 s.send(JSON.stringify({type:'bridge-data',seq:1,ack:0,payload:'action'}));await new Promise(r=>setTimeout(r,20));
 assert.equal(created,1);assert.deepEqual(received,['action']);assert.ok(frames.some(f=>f.type==='bridge-data'&&f.payload==='result'));
 s.close();await once(s,'close');await new Promise(r=>setTimeout(r,100));assert.equal(disposed,1);
 ({s,frames}=await connect(true));assert.equal(frames[0].type,'bridge-reset');s.close();assert.equal(created,1);
});

test('an initial hello can retry a lost welcome without replacing its view or losing queued results',async t=>{
 let created=0,disposed=0;const received=[];
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 resumableBridge(wss,send=>{created++;send('bootstrap');return {receive:p=>received.push(p),dispose:()=>disposed++}});
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`,id=randomUUID();
 async function connect(resume,ack=0){
  const s=new WebSocket(url),frames=[];s.on('message',raw=>frames.push(JSON.parse(raw)));
  await once(s,'open');s.send(JSON.stringify({type:'bridge-hello',sessionId:id,resume,ack}));
  await once(s,'message');return {s,frames};
 }
 let {s}=await connect(false);
 // Discard all received frames as though the welcome never reached the page.
 s.terminate();await once(s,'close');
 let retried=await connect(false);s=retried.s;
 await new Promise(r=>setTimeout(r,10));
 assert.equal(retried.frames[0].type,'bridge-welcome');
 assert.ok(retried.frames.some(f=>f.type==='bridge-data'&&f.seq===1&&f.payload==='bootstrap'));
 assert.equal(created,1);assert.equal(disposed,0);
 s.send(JSON.stringify({type:'bridge-data',seq:1,ack:1,payload:'action'}));await once(s,'message');
 assert.deepEqual(received,['action']);
 s.terminate();await once(s,'close');
 // Once data has been accepted, callers must resume its sequence state.
 retried=await connect(false);assert.equal(retried.frames[0].type,'bridge-reset');retried.s.terminate();
 assert.equal(created,1);
 retried=await connect(true,1);assert.equal(retried.frames[0].type,'bridge-welcome');retried.s.terminate();
});

test('explicit unload releases only the active view immediately and frees its session slot',async t=>{
 let created=0,disposed=0;
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const health=resumableBridge(wss,()=>{created++;return {receive(){},dispose:()=>disposed++}});
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`;
 async function connect(id,resume=false){const s=new WebSocket(url);await once(s,'open');s.send(JSON.stringify({type:'bridge-hello',sessionId:id,resume,ack:0}));const [raw]=await once(s,'message');return {s,frame:JSON.parse(raw)}};
 const retainedId=randomUUID();let retained=await connect(retainedId);
 retained.s.terminate();await once(retained.s,'close');
 // A network drop remains resumable while repeated explicit reloads do not
 // accumulate sixteen dead renderers and prevent new pages from opening.
 for(let i=0;i<20;i++){
  const {s,frame}=await connect(randomUUID());assert.equal(frame.type,'bridge-welcome');
  s.send(JSON.stringify({type:'bridge-release'}));await once(s,'close');
  assert.equal(health().length,1);assert.equal(disposed,i+1);
 }
 retained=await connect(retainedId,true);assert.equal(retained.frame.type,'bridge-welcome');
 assert.equal(created,21);assert.equal(disposed,20);
 retained.s.send(JSON.stringify({type:'bridge-release'}));await once(retained.s,'close');
 assert.equal(health().length,0);assert.equal(disposed,21);
 retained=await connect(retainedId,true);assert.equal(retained.frame.type,'bridge-reset');retained.s.terminate();
});
