const {test}=require('node:test'),assert=require('node:assert/strict');
const {WebSocket,WebSocketServer}=require('ws');const {once}=require('node:events');const {randomUUID}=require('node:crypto');
const {resumableBridge}=require('../src/server/resumable-bridge.js');
function syntheticBridge(t,create){
 const {EventEmitter}=require('node:events');
 const server=new EventEmitter(),socket=new EventEmitter();socket.readyState=WebSocket.OPEN;socket.frames=[];
 socket.send=raw=>socket.frames.push(JSON.parse(raw));socket.ping=()=>{};
 socket.close=socket.terminate=()=>{if(socket.readyState===WebSocket.CLOSED)return;socket.readyState=WebSocket.CLOSED;socket.emit('close')};
 const health=resumableBridge(server,create);server.emit('connection',socket);
 t.after(()=>{socket.close();server.emit('close')});
 return {socket,health,hello(){socket.emit('message',JSON.stringify({type:'bridge-hello',sessionId:randomUUID(),resume:false,ack:0}))}};
}
test('renderer factory exceptions reset only that view without escaping the socket handler',t=>{
 const f=syntheticBridge(t,()=>{throw Error('fixture initialization failure')});
 assert.doesNotThrow(()=>f.hello());assert.deepEqual(f.socket.frames,[{type:'bridge-reset'}]);assert.equal(f.health().length,0);
});
test('startup queue overflow resets the connection and disposes the failed view once',t=>{
 let disposed=0;const f=syntheticBridge(t,send=>{for(let i=0;i<4100;i++)send(i);return{receive(){},dispose(){disposed++}}});
 f.hello();assert.deepEqual(f.socket.frames,[{type:'bridge-reset'}]);assert.equal(f.health().length,0);assert.equal(disposed,1);
});
test('asynchronous renderer initialization failure can terminate its welcomed session',t=>{
 let fail,disposed=0;const f=syntheticBridge(t,(_send,reject)=>{fail=reject;return{receive(){},dispose(){disposed++}}});
 f.hello();assert.equal(typeof fail,'function');fail('fixture initialization failure');fail('repeated failure');
 assert.deepEqual(f.socket.frames.map(frame=>frame.type),['bridge-welcome','bridge-reset']);assert.equal(f.health().length,0);assert.equal(disposed,1);
});
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

test('a fresh phone page retires only its disconnected predecessor and an idle probe preserves the view',async t=>{
 let created=0,disposed=0;
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const health=resumableBridge(wss,()=>{created++;return {receive(){},dispose:()=>disposed++}});
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`,clientId=randomUUID();
 async function connect(sessionId){
  const s=new WebSocket(url);await once(s,'open');
  const response=once(s,'message');
  s.send(JSON.stringify({type:'bridge-hello',sessionId,clientId,resume:false,ack:0}));
  const [raw]=await response;return {s,frame:JSON.parse(raw)};
 }
 const firstId=randomUUID(),first=await connect(firstId);
 assert.equal(first.frame.type,'bridge-welcome');
 const probe=once(first.s,'message');first.s.send(JSON.stringify({type:'bridge-probe'}));
 assert.deepEqual(JSON.parse((await probe)[0]),{type:'bridge-probe-ack'});
 assert.equal(health()[0].received,0,'a probe is not dispatched as a renderer message');
 const active=await connect(randomUUID());
 assert.equal(active.frame.type,'bridge-welcome');assert.equal(health().length,2,'an active view must not be retired');
 first.s.terminate();await once(first.s,'close');
 const fresh=await connect(randomUUID());
 assert.equal(fresh.frame.type,'bridge-welcome');
 assert.equal(created,3);assert.equal(disposed,1);assert.equal(health().length,2);
 assert.equal(health().filter(session=>session.connected).length,2);
 fresh.s.terminate();active.s.terminate();
});

test('a new authorized page evicts the oldest detached view at capacity but never an active view',async t=>{
 let disposed=0;
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const health=resumableBridge(wss,()=>({receive(){},dispose:()=>disposed++}));
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`;
 async function connect(sessionId,resume=false){
  const s=new WebSocket(url);await once(s,'open');
  const response=once(s,'message');s.send(JSON.stringify({type:'bridge-hello',sessionId,resume,ack:0}));
  const [raw]=await response;return {s,frame:JSON.parse(raw)};
 }
 const views=[];
 for(let i=0;i<16;i++){const id=randomUUID(),view=await connect(id);assert.equal(view.frame.type,'bridge-welcome');views.push({id,...view});}
 assert.equal(health().length,16);
 const full=await connect(randomUUID());assert.equal(full.frame.type,'bridge-reset');
 await once(full.s,'close');assert.equal(health().length,16);assert.equal(disposed,0);
 views[0].s.terminate();await once(views[0].s,'close');
 await new Promise(resolve=>setTimeout(resolve,5));
 views[1].s.terminate();await once(views[1].s,'close');
 const fresh=await connect(randomUUID());assert.equal(fresh.frame.type,'bridge-welcome');
 assert.equal(health().length,16);assert.equal(disposed,1);
 const oldest=await connect(views[0].id,true);assert.equal(oldest.frame.type,'bridge-reset');await once(oldest.s,'close');
 const newer=await connect(views[1].id,true);assert.equal(newer.frame.type,'bridge-welcome');
 assert.equal(health().length,16);assert.equal(disposed,1);
 fresh.s.terminate();newer.s.terminate();for(const view of views.slice(2))view.s.terminate();
});

test('a parked phone view expires even while its WebSocket remains open',async t=>{
 let disposed=0;
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const health=resumableBridge(wss,()=>({receive(){},dispose:()=>disposed++}),50);
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const s=new WebSocket(`ws://127.0.0.1:${wss.address().port}`);await once(s,'open');
 const welcome=once(s,'message');s.send(JSON.stringify({type:'bridge-hello',sessionId:randomUUID(),resume:false,ack:0}));
 assert.equal(JSON.parse((await welcome)[0]).type,'bridge-welcome');
 const probe=once(s,'message');s.send(JSON.stringify({type:'bridge-park'}));s.send(JSON.stringify({type:'bridge-probe'}));
 assert.deepEqual(JSON.parse((await probe)[0]),{type:'bridge-probe-ack'});
 assert.equal(health()[0].connected,true);assert.equal(health()[0].parked,true);
 const closed=once(s,'close');
 const timeout=setTimeout(()=>s.terminate(),500);
 try{await closed;}finally{clearTimeout(timeout)}
 assert.equal(health().length,0);assert.equal(disposed,1);
});

test('unparking or resuming before expiry preserves the same phone view',async t=>{
 let created=0,disposed=0;
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const health=resumableBridge(wss,()=>{created++;return {receive(){},dispose:()=>disposed++}},60);
 t.after(()=>{for(const s of wss.clients)s.terminate();wss.close()});
 const url=`ws://127.0.0.1:${wss.address().port}`,id=randomUUID();
 async function connect(resume){
  const s=new WebSocket(url);await once(s,'open');
  const welcome=once(s,'message');s.send(JSON.stringify({type:'bridge-hello',sessionId:id,resume,ack:0}));
  assert.equal(JSON.parse((await welcome)[0]).type,'bridge-welcome');return s;
 }
 let s=await connect(false);
 s.send(JSON.stringify({type:'bridge-park'}));s.send(JSON.stringify({type:'bridge-unpark'}));
 const probe=once(s,'message');s.send(JSON.stringify({type:'bridge-probe'}));await probe;
 assert.equal(health()[0].parked,false);
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(s.readyState,WebSocket.OPEN);assert.equal(health().length,1);assert.equal(disposed,0);
 s.send(JSON.stringify({type:'bridge-park'}));s.terminate();await once(s,'close');
 s=await connect(true);
 assert.equal(health()[0].parked,false);
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(s.readyState,WebSocket.OPEN);assert.equal(created,1);assert.equal(disposed,0);
 s.terminate();
});
