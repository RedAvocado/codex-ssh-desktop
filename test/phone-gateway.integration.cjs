const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),https=require('node:https'),{once}=require('node:events'),{spawn,execFileSync}=require('node:child_process'),{gunzipSync}=require('node:zlib');
const {WebSocket,WebSocketServer}=require('ws'),{randomUUID}=require('node:crypto');
async function fixture(t,{legacy=false,computerMode=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'private-phone-gateway-'));fs.mkdirSync(path.join(root,'desktop'));fs.mkdirSync(path.join(root,'runtime'));
 for(const name of ['phone-gateway.cjs','phone-policy.cjs','phone-legacy-bridge.cjs','phone-computers.cjs','phone-shell.html','phone-shell.js','phone-shell.css'])fs.copyFileSync(path.join(__dirname,'../desktop',name),path.join(root,'desktop',name));
 fs.mkdirSync(path.join(root,'src/server'),{recursive:true});
 for(const name of ['local-transcription.js','access.js','resumable-bridge.js'])fs.copyFileSync(path.join(__dirname,'../src/server',name),path.join(root,'src/server',name));
 fs.mkdirSync(path.join(root,'src/shared'));fs.copyFileSync(path.join(__dirname,'../src/shared/reliable-channel.js'),path.join(root,'src/shared/reliable-channel.js'));
 fs.symlinkSync(path.resolve(__dirname,'../node_modules'),path.join(root,'node_modules'),'dir');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,'runtime/phone.key'),'-out',path.join(root,'runtime/phone.crt'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const origin='https://127.0.0.1:18443';fs.writeFileSync(path.join(root,'runtime/phone-config.json'),JSON.stringify({origin,allowedPeers:['127.0.0.1'],bindAddress:'127.0.0.1',legacyBackend:legacy,backendSessionCookie:legacy?'legacy_session':'remote_session'}));fs.writeFileSync(path.join(root,'runtime/viewer-token'),'a'.repeat(64));
 if(computerMode){const file=path.join(root,'runtime/phone-config.json'),config=JSON.parse(fs.readFileSync(file));config.computers=[{id:'studio',name:'Studio',origin}];config.frameAncestors=['https://laptop.example.ts.net:8443'];fs.writeFileSync(file,JSON.stringify(config));}
 fs.mkdirSync(path.join(root,'scratch/asar/webview/assets'),{recursive:true});fs.writeFileSync(path.join(root,'scratch/asar/webview/assets/preload.js'),'/* matching mobile preload */');
 const source='/* test code */\n'.repeat(10000);
 const backend=http.createServer((req,res)=>{
  assert.equal(req.headers.cookie,(legacy?'legacy_session=':'remote_session=')+'a'.repeat(64));
  if(req.url==='/broken-html'||req.url==='/broken-text'){
   res.writeHead(200,{'content-type':req.url.endsWith('html')?'text/html':'text/plain','content-length':1000});
   res.write('partial');setImmediate(()=>res.destroy());
  }else if(req.url==='/assets/test.js'){
   if(req.headers['if-none-match']==='"fixture"'){res.writeHead(304,{etag:'"fixture"'});res.end();return;}
   res.writeHead(200,{'content-type':'text/javascript',etag:'"fixture"','content-length':Buffer.byteLength(source)});res.end(source);
  }else if(req.url==='/__health'){res.setHeader('content-type','application/json');res.end('{"ready":true,"private":"must not escape health"}')}
  else if(req.url==='/api'){res.setHeader('content-type','application/json');res.end('{"private":"test"}')}
  else{res.setHeader('content-type','text/html');res.end('<html>ws://127.0.0.1:18214</html>')}
 });
 const upstreamSockets=new WebSocketServer({server:backend}),commands=[];let views=0;
 upstreamSockets.on('connection',(socket,request)=>{
  assert.equal(request.headers.cookie,(legacy?'legacy_session=':'remote_session=')+'a'.repeat(64));
  assert.equal(request.headers.origin,'http://127.0.0.1:18214');views++;
  socket.on('message',raw=>{const payload=JSON.parse(String(raw));commands.push(payload);socket.send(JSON.stringify({result:payload}))});
 });
 backend.listen(0,'127.0.0.1');await once(backend,'listening');
 // Isolate the fixture from a real viewer running on the same Mac. Only the
 // copied gateway's loopback destination port changes; its policy is unchanged.
 const gatewayFile=path.join(root,'desktop/phone-gateway.cjs');
 const gatewaySource=fs.readFileSync(gatewayFile,'utf8');
 assert.equal(gatewaySource.split('port:18314').length-1,2);
 fs.writeFileSync(gatewayFile,gatewaySource.replaceAll('port:18314',`port:${backend.address().port}`).replace('ws://127.0.0.1:18314/__backend/ipc',`ws://127.0.0.1:${backend.address().port}/__backend/ipc`).replace('http://127.0.0.1:18314/__health',`http://127.0.0.1:${backend.address().port}/__health`));
 const child=spawn(process.execPath,[path.join(root,'desktop/phone-gateway.cjs')],{stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit')}for(const socket of upstreamSockets.clients)socket.terminate();upstreamSockets.close();backend.closeAllConnections();await new Promise(resolve=>backend.close(resolve));fs.rmSync(root,{recursive:true,force:true})});
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Gateway exited')})]);
 const ca=fs.readFileSync(path.join(root,'runtime/phone.crt'));
 const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=https.request(origin+url,{ca,headers,method,timeout:2000},res=>{const chunks=[];res.on('error',reject);res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('fixture request timed out')));req.end();
 });
 return {request,root,source,origin,ca,commands,upstreamSockets,views:()=>views};
}
test('gateway enforces its boundary, compresses static code and keeps API responses uncached',async t=>{
 const {request,source,origin}=await fixture(t);
 const asset=await request('/assets/test.js',{'accept-encoding':'gzip'});assert.equal(asset.status,200);assert.equal(asset.headers['content-encoding'],'gzip');assert.equal(gunzipSync(asset.body).toString(),source);assert.ok(asset.body.length<source.length/10);assert.match(asset.headers['cache-control'],/^private/);assert.equal(asset.headers['set-cookie'],undefined);
 const cached=await request('/assets/test.js',{'if-none-match':'"fixture"'});assert.equal(cached.status,304);assert.match(cached.headers['cache-control'],/^private/);
 const api=await request('/api');assert.equal(api.headers['cache-control'],'no-store');assert.equal(api.headers['content-encoding'],undefined);
 const page=await request('/');assert.match(page.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);assert.match(page.body.toString(),/wss:\/\/127.0.0.1:18443/);
 assert.equal((await request('/',{origin:'https://untrusted.example'})).status,403);
 assert.equal((await request('/__session')).status,403);
 assert.equal((await request('/api',{},'POST')).status,403);
 assert.equal((await request('/__backend/transcribe',{},'POST')).status,403);
 const cookie=page.headers['set-cookie'][0].split(';')[0];
 const local=await request('/__backend/transcribe',{origin,cookie},'POST');
 assert.equal(local.status,400);assert.match(local.body.toString(),/Expected an audio/);
 assert.equal(local.headers['cache-control'],'no-store');
 console.log('Static transfer fixture:',source.length,'->',asset.body.length,'bytes; authenticated revalidation and API no-store passed');
});
test('a missing backend token returns a recoverable error and leaves the gateway alive',async t=>{
 const {request,root,origin}=await fixture(t),file=path.join(root,'runtime/viewer-token');
 const page=await request('/'),cookie=page.headers['set-cookie'][0].split(';')[0];
 fs.unlinkSync(file);assert.equal((await request('/api')).status,503);
 assert.equal((await request('/__backend/ipc',{origin,cookie,connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'Zml4dHVyZS1rZXktZm9yLXdz'})).status,503);
 fs.writeFileSync(file,'a'.repeat(64));assert.equal((await request('/api')).status,200);
});
test('an aborted upstream HTML response fails cleanly without crashing the gateway',async t=>{
 const {request}=await fixture(t);
 assert.equal((await request('/broken-html')).status,503);assert.equal((await request('/api')).status,200);
});
test('an aborted upstream download closes the response without crashing the gateway',async t=>{
 const {request}=await fixture(t);
 await assert.rejects(request('/broken-text'),error=>error.message!=='fixture request timed out');assert.equal((await request('/api')).status,200);
});
test('gzip explicitly refused by the browser is not selected',async t=>{
 const {request,source}=await fixture(t);
 const reply=await request('/assets/test.js',{'accept-encoding':'br, gzip;q=0'});
 assert.equal(reply.headers['content-encoding'],undefined);assert.equal(reply.body.toString(),source);
});
test('legacy sidecar serves the mobile preload and retains one backend view across phone reconnects',async t=>{
 const f=await fixture(t,{legacy:true});
 const preload=await f.request('/assets/preload.js',{'accept-encoding':'gzip'});
 assert.equal(gunzipSync(preload.body).toString(),'/* matching mobile preload */');
 assert.equal((await f.request('/assets/preload.js',{'if-none-match':preload.headers.etag})).status,304);
 assert.equal((await f.request('/assets/preload.js',{origin:'https://untrusted.example'})).status,403);
 const page=await f.request('/'),cookie=page.headers['set-cookie'][0].split(';')[0],sessionId=randomUUID();
 const connect=async(resume,headers={origin:f.origin,cookie})=>{
  const socket=new WebSocket(f.origin.replace('https:','wss:')+'/__backend/ipc',{ca:f.ca,headers});
  const frames=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
  await once(socket,'open');socket.send(JSON.stringify({type:'bridge-hello',sessionId,resume,ack:0}));
  await once(socket,'message');return {socket,frames};
 };
 await assert.rejects(connect(false,{origin:f.origin}),/403/);
 let client=await connect(false);assert.equal(client.frames[0].type,'bridge-welcome');
 const frame={type:'bridge-data',seq:1,ack:0,payload:{type:'ipc-renderer-invoke',requestId:'test',channel:'read',args:[]}};
 async function until(check){const deadline=Date.now()+1500;while(!check()){assert.ok(Date.now()<deadline,'Expected socket event');await new Promise(resolve=>setTimeout(resolve,10))}}
 client.socket.send(JSON.stringify(frame));await until(()=>client.frames.some(f=>f.type==='bridge-data'));
 client.socket.terminate();await once(client.socket,'close');
 client=await connect(true);await until(()=>client.frames.some(f=>f.type==='bridge-data'));
 client.socket.send(JSON.stringify(frame));await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(f.commands.length,1);assert.equal(f.views(),1);
 assert.deepEqual(client.frames.find(f=>f.type==='bridge-data').payload,{result:frame.payload});
 for(const socket of f.upstreamSockets.clients)socket.close();
 await until(()=>client.frames.some(f=>f.type==='bridge-reset'));
 client.socket.terminate();
});

test('computer shell stays available during backend failure and embeds only configured origins',async t=>{
 const {request,root,origin,ca}=await fixture(t,{computerMode:true});
 const page=await request('/thread/task-a',{accept:'text/html'});
 assert.match(page.body.toString(),/Switch computer/);
 assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
 const health=await request('/__phone/health');assert.deepEqual(JSON.parse(health.body),{ready:true});
 const {probeComputer}=require('../desktop/phone-computers.cjs');
 assert.equal(await probeComputer(origin,{address:'127.0.0.1',ca}),true);
 assert.equal(await probeComputer(origin.replace('127.0.0.1','wrong-host.invalid'),{address:'127.0.0.1',ca}),false,'a fixed probe address must not bypass TLS hostname validation');
 const list=await request('/__phone/computers');assert.deepEqual(JSON.parse(list.body).computers,[{id:'studio',name:'Studio',origin,online:true}]);
 assert.equal(list.headers['cache-control'],'no-store');
 const viewer=await request('/__phone/viewer?path=%2Fthread%2Ftask-a');
 assert.match(viewer.body.toString(),/wss:/);assert.match(viewer.headers['content-security-policy'],/https:\/\/laptop.example.ts.net:8443/);
 assert.equal(viewer.headers['x-frame-options'],undefined);
 assert.ok(viewer.headers['set-cookie'][0].includes('HttpOnly'));
 assert.equal((await request('/__phone/computers',{origin:'https://untrusted.example'})).status,403);
 assert.equal((await request('/__phone/shell.js')).headers['content-type'],'text/javascript');
 fs.unlinkSync(path.join(root,'runtime/viewer-token'));
 assert.match((await request('/')).body.toString(),/Switch computer/);
 assert.deepEqual(JSON.parse((await request('/__phone/health')).body),{ready:false});
 assert.equal((await request('/__phone/viewer')).status,503);
});
