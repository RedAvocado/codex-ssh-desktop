// HTTPS binds only the Tailscale interface. Access uses the actual socket peer,
// never client-supplied forwarding headers. TLS keys stay in the private runtime.
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validPhoneRequest,staticAsset,phoneConfiguration,acceptsGzip}=require('./phone-policy.cjs');
const {createGzip,gzip}=require('node:zlib');
const {pipeline}=require('node:stream');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'runtime');
const settings=JSON.parse(fs.readFileSync(path.join(runtime,'phone-config.json'),'utf8'));
const {origin,allowed}=phoneConfiguration(settings);
// Keep local speech processing in the already-authorized gateway, without a
// second listener or restarting the task backend to update the phone feature.
const transcriptionApp=require('fastify')({logger:false});
transcriptionApp.register(require('@fastify/multipart'));
require('../src/server/local-transcription.js').registerLocalTranscription(transcriptionApp,runtime,origin.origin);
const transcriptionReady=transcriptionApp.ready();
const sessionPath=path.join(runtime,'phone-session');
if(!fs.existsSync(sessionPath))fs.writeFileSync(sessionPath,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
const csrf=fs.readFileSync(sessionPath,'utf8').trim();
if(!/^[a-f0-9]{64}$/.test(csrf))throw Error('Invalid private phone session');
function valid(req,upgrade=false){return validPhoneRequest(req,origin,allowed,csrf,upgrade);}
function headers(req){
 const token=fs.readFileSync(path.join(runtime,'viewer-token'),'utf8').trim();
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Backend session is unavailable');
 const h={...req.headers,host:'127.0.0.1:18314',origin:'http://127.0.0.1:18214',cookie:`remote_session=${token}`};
 delete h.authorization;delete h['proxy-authorization'];delete h['accept-encoding'];
 return h;
}
function unavailable(res){
 if(res.destroyed||res.writableEnded)return;
 if(res.headersSent){res.destroy();return;}
 res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});
 res.end('Remote viewer is starting. Reload in a few seconds.');
}
const server=https.createServer({cert:fs.readFileSync(path.join(runtime,'phone.crt')),key:fs.readFileSync(path.join(runtime,'phone.key'))},(req,res)=>{
 if(!valid(req)){console.warn('Phone request denied',JSON.stringify({peer:req.socket.remoteAddress,hostMatches:req.headers.host===origin.host,originMatches:!req.headers.origin||req.headers.origin===origin.origin,fetchSite:req.headers['sec-fetch-site'],tls:!!req.socket.encrypted}));res.writeHead(403,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('This viewer is restricted to your configured Tailscale devices.');return;}
 if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.startsWith('/__session')){res.writeHead(403);res.end();return;}
 if(req.url==='/__backend/transcribe'&&req.method==='POST'){
  transcriptionReady.then(()=>transcriptionApp.routing(req,res)).catch(()=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Local dictation is unavailable.'}));});return;
 }
 let upstreamHeaders;
 try{upstreamHeaders=headers(req);}catch{unavailable(res);return;}
 const upstream=http.request({host:'127.0.0.1',port:18314,path:req.url,method:req.method,headers:upstreamHeaders},reply=>{
  reply.on('error',()=>unavailable(res));
  reply.once('aborted',()=>unavailable(res));
  const h={...reply.headers,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};
  delete h['set-cookie'];
  const compress=acceptsGzip(req.headers['accept-encoding']) && !req.headers.range && req.method!=='HEAD' && reply.statusCode===200;
  const asset=staticAsset(req.url,h['content-type']) || (reply.statusCode===304 && staticAsset(req.url,'text/javascript'));
  if(asset){h['cache-control']='private, max-age=0, must-revalidate';h.vary='Accept-Encoding';}

  if(String(h['content-type']).includes('text/html')){
   const chunks=[];reply.on('data',chunk=>chunks.push(chunk));reply.on('end',()=>{
    if(res.destroyed||res.writableEnded)return;
    const body=Buffer.from(Buffer.concat(chunks).toString().replace('ws://127.0.0.1:18214',`ws://127.0.0.1:18214 wss://${origin.host}`));
    h['set-cookie']=`__Host-phone_session=${csrf}; Secure; HttpOnly; SameSite=Strict; Path=/`;
    delete h['content-length'];delete h['content-encoding'];
    if(compress){h['content-encoding']='gzip';h.vary='Accept-Encoding';gzip(body,(error,data)=>{if(error){unavailable(res);return;}if(res.destroyed||res.writableEnded)return;res.writeHead(reply.statusCode,h);res.end(data);});}
    else{res.writeHead(reply.statusCode,h);res.end(body);}
   });
  }else if(asset&&compress){
    delete h['content-length'];h['content-encoding']='gzip';res.writeHead(reply.statusCode,h);
    pipeline(reply,createGzip(),res,()=>{});
  }else{res.writeHead(reply.statusCode,h);pipeline(reply,res,()=>{});}
 });
 upstream.on('error',()=>unavailable(res));
 upstream.setTimeout(60_000,()=>{unavailable(res);upstream.destroy();});
 res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});
 req.on('error',()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
server.on('upgrade',(req,client,head)=>{
 let upstream,remote,deadline;
 const cleanup=()=>{clearTimeout(deadline);upstream?.destroy();remote?.destroy();};
 client.on('error',cleanup);client.on('close',cleanup);
 if(req.url!=='/__backend/ipc'||!valid(req,true)){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
 let upstreamHeaders;
 try{upstreamHeaders=headers(req);}catch{client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
 upstream=http.request({host:'127.0.0.1',port:18314,path:req.url,method:'GET',headers:upstreamHeaders});
 deadline=setTimeout(()=>{cleanup();client.destroy();},15_000);
 upstream.on('upgrade',(reply,socket,remoteHead)=>{
  clearTimeout(deadline);remote=socket;
  socket.on('error',()=>client.destroy());socket.on('close',()=>client.destroy());
  if(client.destroyed){socket.destroy();return;}
  client.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`+Object.entries(reply.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
  if(remoteHead.length)client.write(remoteHead);if(head.length)socket.write(head);
  client.pipe(socket);socket.pipe(client);
 });
 upstream.on('response',reply=>{reply.on('error',()=>{});reply.resume();clearTimeout(deadline);client.destroy();});upstream.on('error',()=>{clearTimeout(deadline);client.destroy();});upstream.end();
});
server.listen(Number(origin.port||443),settings.bindAddress,()=>console.log('Private phone gateway ready'));
fs.watchFile(path.join(runtime,'phone.crt'),{interval:60000},()=>{
 try{server.setSecureContext({cert:fs.readFileSync(path.join(runtime,'phone.crt')),key:fs.readFileSync(path.join(runtime,'phone.key'))});}catch{console.error('Certificate reload failed; retaining the previous certificate.');}
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
