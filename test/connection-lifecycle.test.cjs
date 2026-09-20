const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');

function connection(){
 const sockets=[],window=new EventTarget(),document=new EventTarget(),timers=new Map();let timerId=0;
 class Socket extends EventTarget {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;sent=[];
  constructor(){super();sockets.push(this)}
  send(value){assert.equal(this.readyState,Socket.OPEN);this.sent.push(JSON.parse(value))}
  open(){this.readyState=Socket.OPEN;this.dispatchEvent(new Event('open'))}
  receive(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}))}
  close(){this.readyState=Socket.CLOSED;this.dispatchEvent(new Event('close'))}
 }
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(require.resolve('../src/browser/connection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:()=>require('../src/shared/reliable-channel.js'),window,document,WebSocket:Socket,console,
  crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},location:{protocol:'https:',host:'private.test'},
  setTimeout:callback=>{timers.set(++timerId,callback);return timerId},clearTimeout:id=>timers.delete(id)});
 const failures=[],send=exports.connectRenderer(()=>{},reason=>failures.push(reason)),socket=sockets[0];socket.open();
 const pagehide=persisted=>{const event=new Event('pagehide');Object.defineProperty(event,'persisted',{value:persisted});window.dispatchEvent(event)};
 return {socket,sockets,send,pagehide,timers,document,failures};
}

test('a real page unload releases the bridge and cancels connection work',()=>{
 const {socket,send,pagehide,timers}=connection();
 socket.receive({type:'bridge-welcome',ack:0});send('pending action');pagehide(false);
 assert.deepEqual(socket.sent.map(f=>f.type),['bridge-hello','bridge-data','bridge-release']);
 assert.equal(socket.readyState,3);assert.equal(timers.size,0);
});

test('BFCache pagehide retains the connection and sequence state',()=>{
 const {socket,send,pagehide}=connection();socket.receive({type:'bridge-welcome',ack:0});
 pagehide(true);send('after restoration');
 assert.equal(socket.readyState,1);assert.deepEqual(socket.sent.map(f=>f.type),['bridge-hello','bridge-data']);
 assert.equal(socket.sent[1].seq,1);
 pagehide(false);
});

test('unloading before welcome still releases an already sent hello',()=>{
 const {socket,pagehide,timers}=connection();pagehide(false);
 assert.deepEqual(socket.sent.map(f=>f.type),['bridge-hello','bridge-release']);assert.equal(timers.size,0);
});
test('a queued early reconnect notice is discarded after a successful connection',()=>{
 const f=connection();f.socket.close();
 for(const callback of [...f.timers.values()])callback();
 const next=f.sockets.at(-1);next.open();next.receive({type:'bridge-welcome',ack:0});
 // A stale notice would try to create DOM nodes in this deliberately minimal document.
 assert.doesNotThrow(()=>f.document.dispatchEvent(new Event('DOMContentLoaded')));f.pagehide(false);
});
test('a terminal reset notifies pending callers once',()=>{
 const f=connection();f.socket.receive({type:'bridge-reset'});f.socket.receive({type:'bridge-reset'});
 assert.equal(f.failures.length,1);assert.equal(f.socket.readyState,3);assert.equal(f.timers.size,0);
});
