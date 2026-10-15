const {test}=require('node:test'),assert=require('node:assert/strict');
const {computerConfiguration,computerDirectory,probeComputer}=require('../desktop/phone-computers.cjs');
const origin='https://studio.example.ts.net:8443';
const config={origin,computers:[{id:'studio',name:'Studio',origin},{id:'laptop',name:'Laptop',origin:'https://laptop.example.ts.net:8443'}]};
test('computer configuration rejects malformed, duplicate and untrusted destination forms',()=>{
 assert.equal(computerConfiguration(config).computers.length,2);
 for(const computer of [null,{id:'../route',name:'Mac',origin},{id:'mac',name:'',origin},{id:'mac',name:'Mac',origin:'http://example.com'},{id:'mac',name:'Mac',origin:origin+'/__session'},{id:'mac',name:'Mac',origin:'https://user:secret@example.com'}])assert.throws(()=>computerConfiguration({...config,computers:[computer]}));
 assert.throws(()=>computerConfiguration({...config,computers:[config.computers[0],config.computers[0]]}));
 assert.throws(()=>computerConfiguration({...config,computers:[config.computers[1]]}));
 assert.throws(()=>computerConfiguration({...config,frameAncestors:['*']}));
 assert.deepEqual(computerConfiguration({origin}).frameAncestors,[origin]);
});
test('availability tests each configured backend, deduplicates overlapping polls and fails closed',async()=>{
 let calls=0,release;
 const waiting=new Promise(resolve=>{release=resolve});
 const directory=computerDirectory(config.computers,origin,async()=>{calls++;await waiting;return true;},async()=>{calls++;throw Error('offline');});
 const first=directory(),second=directory();release();
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);
 assert.deepEqual(a.map(c=>c.online),[true,false]);assert.equal(calls,2);
 assert.deepEqual(await directory(),a);assert.equal(calls,2);
 assert.equal(JSON.stringify(a).includes('token'),false);
});
test('selected host status does not wait for another host and shares its probe with a full listing',async()=>{
 let localCalls=0,remoteCalls=0,finishRemote;
 const remoteReady=new Promise(resolve=>{finishRemote=resolve;});
 const directory=computerDirectory(config.computers,origin,async()=>{localCalls++;return true;},async()=>{remoteCalls++;await remoteReady;return true;});
 const full=directory();
 const selected=await directory('@self');
 assert.deepEqual(selected.map(c=>c.id),['studio']);
 assert.equal(selected[0].online,true);
 assert.equal(localCalls,1);assert.equal(remoteCalls,1);
 assert.deepEqual(await directory('missing'),[]);
 finishRemote();
 assert.deepEqual((await full).map(c=>c.id),['studio','laptop']);
 assert.equal(remoteCalls,1);
 assert.equal((await directory('laptop'))[0].online,true);
 assert.equal(remoteCalls,1);
});
test('unavailable TLS computer is offline within a bounded deadline',async()=>{
 const start=Date.now();assert.equal(await probeComputer('https://127.0.0.1:1',{timeout:50}),false);
 assert.ok(Date.now()-start<2000);
});
