const {test}=require('node:test'),assert=require('node:assert/strict');
const {ReliableChannel}=require('../src/shared/reliable-channel.js');
test('replays a lost response and never repeats an accepted action',()=>{
 const actions=[],results=[];let up=[],down=[];
 const client=new ReliableChannel(p=>results.push(p),()=>assert.fail('client reset'));
 const server=new ReliableChannel(p=>{actions.push(p);server.send('reply')},()=>assert.fail('server reset'));
 client.attach(w=>up.push(JSON.parse(w)),0);server.attach(w=>down.push(JSON.parse(w)),0);
 client.send('send task');server.receive(up.shift());
 // Drop the response AND acknowledgement. The sender cannot tell whether the
 // request reached the server. A reconnect must not submit the task twice.
 client.detach();server.detach();up=[];down=[];
 server.attach(w=>down.push(JSON.parse(w)),client.received);
 client.attach(w=>up.push(JSON.parse(w)),server.received);
 down.forEach(f=>client.receive(f));up.forEach(f=>server.receive(f));
 assert.deepEqual(actions,['send task']);assert.deepEqual(results,['reply']);
});
test('buffers offline messages and delivers each exactly once in order',()=>{
 const received=[],wire=[];const a=new ReliableChannel(()=>{},()=>assert.fail());
 const b=new ReliableChannel(p=>received.push(p),()=>assert.fail());
 a.send(1);a.send(2);a.attach(w=>wire.push(JSON.parse(w)),0);
 wire.forEach(f=>b.receive(f));wire.forEach(f=>b.receive(f));assert.deepEqual(received,[1,2]);
});
test('rejects missing sequence, impossible acknowledgements and bounded-buffer overflow',()=>{
 for(const frame of [{type:'bridge-data',seq:2,ack:0,payload:1},{type:'bridge-ack',ack:999},{type:'bridge-data',seq:0,ack:0}]){
  let resets=0;const c=new ReliableChannel(()=>assert.fail(),()=>resets++);c.receive(frame);assert.equal(resets,1);
 }
 let resets=0;const c=new ReliableChannel(()=>{},()=>resets++,10);c.send('too big');c.send('again');assert.equal(resets,1);
});
test('reentrant sends during replay remain ordered and keep their own sequence numbers',()=>{
 const wires=[];const a=new ReliableChannel(()=>{},()=>assert.fail());
 a.send('first');a.send('second');
 a.attach(w=>{const f=JSON.parse(w);wires.push(f);if(f.seq===1)a.send('third')},0);
 assert.deepEqual(wires.map(f=>f.seq),[1,2,3]);
 const b=new ReliableChannel(()=>{},()=>assert.fail());const out=[];
 const payload={toJSON(){b.send('nested');return 'outer'}};
 b.send(payload);b.attach(w=>out.push(JSON.parse(w)),0);
 assert.deepEqual(out.map(f=>f.seq),[1,2]);
 assert.deepEqual(out.map(f=>f.payload),['outer','nested']);
});
test('serialization failure ends the session instead of leaving a permanent sequence hole',()=>{
 const reasons=[],out=[];const channel=new ReliableChannel(()=>{},r=>reasons.push(r));
 channel.attach(w=>out.push(w),0);const circular={};circular.self=circular;
 channel.send(circular);channel.send('later');
 assert.deepEqual(reasons,['message could not be serialized']);assert.deepEqual(out,[]);
});
