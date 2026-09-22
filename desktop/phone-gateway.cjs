// HTTPS binds only the Tailscale interface. Access uses the actual socket peer,
// never client-supplied forwarding headers. TLS keys stay in the private runtime.
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validPhoneRequest,staticAsset,phoneConfiguration,acceptsGzip}=require('./phone-policy.cjs');
const {computerConfiguration,computerDirectory}=require('./phone-computers.cjs');
const {createGzip,gzip}=require('node:zlib');
const {pipeline}=require('node:stream');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'runtime');
const settings=JSON.parse(fs.readFileSync(path.join(runtime,'phone-config.json'),'utf8'));
const {origin,allowed}=phoneConfiguration(settings);
const {computers,frameAncestors}=computerConfiguration(settings);
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
 const h={...req.headers,host:'127.0.0.1:18314',origin:'http://127.0.0.1:18214',cookie:`${settings.backendSessionCookie||'remote_session'}=${token}`};
 delete h.authorization;delete h['proxy-authorization'];delete h['accept-encoding'];
 return h;
}
async function localReady(){
 try {
  const response=await fetch('http://127.0.0.1:18314/__health',{headers:headers({headers:{}}),signal:AbortSignal.timeout(1500)});
  return response.ok&&(await response.json()).ready===true;
 }catch{return false;}
}
const directory=computerDirectory(computers,origin.origin,localReady);
const shellFiles=new Map([['/__phone/shell.js',['phone-shell.js','text/javascript']],['/__phone/shell.css',['phone-shell.css','text/css']]]);
function privateResponse(res,type,body,head=false,extra={}){
 if(res.destroyed||res.writableEnded)return;
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra});res.end(head?undefined:body);
}
// The legacy host continues serving its exact prepared renderer. Only the
// matching extraction's mobile preload is supplied by this sidecar gateway.
const legacyPreload=settings.legacyBackend?fs.readFileSync(path.join(root,'scratch/asar/webview/assets/preload.js')):null;
const legacyEtag=legacyPreload?'W/"'+crypto.createHash('sha256').update(legacyPreload).digest('hex')+'"':null;
const legacyBridge=settings.legacyBackend?require('./phone-legacy-bridge.cjs').createLegacyPhoneBridge({
 url:'ws://127.0.0.1:18314/__backend/ipc',headers:()=>headers({headers:{}}),
}):null;
function unavailable(res){
 if(res.destroyed||res.writableEnded)return;
 if(res.headersSent){res.destroy();return;}
 res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});
 res.end('Remote viewer is starting. Reload in a few seconds.');
}
const server=https.createServer({cert:fs.readFileSync(path.join(runtime,'phone.crt')),key:fs.readFileSync(path.join(runtime,'phone.key'))},(req,res)=>{
 if(!valid(req)){console.warn('Phone request denied',JSON.stringify({peer:req.socket.remoteAddress,hostMatches:req.headers.host===origin.host,originMatches:!req.headers.origin||req.headers.origin===origin.origin,fetchSite:req.headers['sec-fetch-site'],tls:!!req.socket.encrypted}));res.writeHead(403,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('This viewer is restricted to your configured Tailscale devices.');return;}
 if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.startsWith('/__session')){res.writeHead(403);res.end();return;}
 const pathname=req.url.split('?')[0];
 if(['GET','HEAD'].includes(req.method)){
  if(pathname==='/__phone/health'){
   localReady().then(ready=>privateResponse(res,'application/json',JSON.stringify({ready}),req.method==='HEAD'));return;
  }
  if(pathname==='/__phone/computers'){
   directory().then(list=>privateResponse(res,'application/json',JSON.stringify({computers:list}),req.method==='HEAD'));return;
  }
  if(shellFiles.has(pathname)){
   const [file,type]=shellFiles.get(pathname);privateResponse(res,type,fs.readFileSync(path.join(__dirname,file)),req.method==='HEAD');return;
  }
  if(computers.length && !/^\/(?:__|assets\/|@fs\/)/.test(pathname) && (pathname==='/'||String(req.headers.accept).includes('text/html'))){
   privateResponse(res,'text/html',fs.readFileSync(path.join(__dirname,'phone-shell.html')),req.method==='HEAD',{
    'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src ${computers.map(c=>c.origin).join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'X-Frame-Options':'DENY',
   });return;
  }
 }
 if(req.url==='/__backend/transcribe'&&req.method==='POST'){
  transcriptionReady.then(()=>transcriptionApp.routing(req,res)).catch(()=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Local dictation is unavailable.'}));});return;
 }
 let upstreamHeaders;
 try{upstreamHeaders=headers(req);}catch{unavailable(res);return;}
 if(legacyPreload&&req.url.split('?')[0]==='/assets/preload.js'&&['GET','HEAD'].includes(req.method)){
  const h={'Content-Type':'text/javascript','Cache-Control':'private, max-age=0, must-revalidate','Vary':'Accept-Encoding','ETag':legacyEtag,'X-Content-Type-Options':'nosniff'};
  if(req.headers['if-none-match']===legacyEtag){res.writeHead(304,h);res.end();return;}
  if(req.method==='HEAD'){res.writeHead(200,h);res.end();return;}
  if(acceptsGzip(req.headers['accept-encoding']))gzip(legacyPreload,(error,body)=>{if(error){unavailable(res);return;}if(res.destroyed||res.writableEnded)return;res.writeHead(200,{...h,'Content-Encoding':'gzip'});res.end(body)});
  else{res.writeHead(200,h);res.end(legacyPreload)}
  return;
 }
 const upstream=http.request({host:'127.0.0.1',port:18314,path:pathname==='/__phone/viewer'?'/':req.url,method:req.method,headers:upstreamHeaders},reply=>{
  reply.on('error',()=>unavailable(res));
  reply.once('aborted',()=>unavailable(res));
  const h={...reply.headers,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY'};
  delete h['set-cookie'];
  const compress=acceptsGzip(req.headers['accept-encoding']) && !req.headers.range && req.method!=='HEAD' && reply.statusCode===200;
  const asset=staticAsset(req.url,h['content-type']) || (reply.statusCode===304 && staticAsset(req.url,'text/javascript'));
  if(asset){h['cache-control']='private, max-age=0, must-revalidate';h.vary='Accept-Encoding';}

  if(String(h['content-type']).includes('text/html')){
   // Only explicitly configured private gateways can embed a viewer. Keep
   // cross-origin mutation checks unchanged inside each independent origin.
   delete h['x-frame-options'];
   h['content-security-policy']=`frame-ancestors ${frameAncestors.join(' ')}`;
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
 if(legacyBridge){clearTimeout(deadline);legacyBridge.upgrade(req,client,head);return;}
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
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{legacyBridge?.close();server.close(()=>process.exit(0))});
