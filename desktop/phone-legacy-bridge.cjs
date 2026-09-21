// Adapt the original unsequenced viewer without restarting its task engine.
// One backend view survives each phone session's temporary disconnections.
const {WebSocket,WebSocketServer}=require('ws');
const {resumableBridge}=require('../src/server/resumable-bridge.js');
const limit=32*1024*1024;

function createLegacyPhoneBridge({url,headers,ttl}){
 const server=new WebSocketServer({noServer:true,maxPayload:limit,perMessageDeflate:{serverNoContextTakeover:true,clientNoContextTakeover:true}});
 const diagnostics=resumableBridge(server,(send,fail)=>{
  const upstream=new WebSocket(url,{headers:headers(),handshakeTimeout:15000,maxPayload:limit});
  let disposed=false,alive=true,queuedBytes=0,queue=[];
  const stop=reason=>{if(!disposed)fail(reason)};
  const write=wire=>{
   if(upstream.bufferedAmount+Buffer.byteLength(wire)>limit){stop('Backend queue capacity');return;}
   upstream.send(wire,error=>{if(error)stop('Backend write failed')});
  };
  upstream.on('open',()=>{for(const wire of queue){if(disposed)break;write(wire)}queue=[];queuedBytes=0});
  upstream.on('message',raw=>{
   if(disposed)return;
   try{send(JSON.parse(String(raw)))}catch{stop('Invalid backend message')}
  });
  upstream.on('error',()=>stop('Backend connection failed'));
  upstream.on('close',()=>stop('Backend connection ended'));
  upstream.on('pong',()=>{alive=true});
  const heartbeat=setInterval(()=>{
   if(upstream.readyState!==WebSocket.OPEN)return;
   if(!alive){stop('Backend connection timed out');return;}
   alive=false;upstream.ping();
  },25000);
  heartbeat.unref();
  return {
   receive(message){
    if(disposed)return;
    const wire=JSON.stringify(message);
    if(upstream.readyState===WebSocket.OPEN){write(wire);return;}
    queuedBytes+=Buffer.byteLength(wire);
    if(upstream.readyState!==WebSocket.CONNECTING||queuedBytes>limit||queue.length>=4096){stop('Backend startup queue unavailable');return;}
    queue.push(wire);
   },
   dispose(){disposed=true;clearInterval(heartbeat);queue=[];queuedBytes=0;upstream.terminate()},
  };
 },ttl);
 return {
  upgrade(req,socket,head){server.handleUpgrade(req,socket,head,client=>server.emit('connection',client,req))},
  close(){for(const client of server.clients)client.terminate();server.close()},
  diagnostics,
 };
}
module.exports={createLegacyPhoneBridge};
