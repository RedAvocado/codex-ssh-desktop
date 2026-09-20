const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),https=require('node:https'),{once}=require('node:events'),{spawn,execFileSync}=require('node:child_process'),{gunzipSync}=require('node:zlib');
test('gateway enforces its boundary, compresses static code and keeps API responses uncached',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'private-phone-gateway-'));fs.mkdirSync(path.join(root,'desktop'));fs.mkdirSync(path.join(root,'runtime'));
 for(const name of ['phone-gateway.cjs','phone-policy.cjs'])fs.copyFileSync(path.join(__dirname,'../desktop',name),path.join(root,'desktop',name));
 fs.mkdirSync(path.join(root,'src/server'),{recursive:true});
 for(const name of ['local-transcription.js','access.js'])fs.copyFileSync(path.join(__dirname,'../src/server',name),path.join(root,'src/server',name));
 fs.symlinkSync(path.resolve(__dirname,'../node_modules'),path.join(root,'node_modules'),'dir');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,'runtime/phone.key'),'-out',path.join(root,'runtime/phone.crt'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const origin='https://127.0.0.1:18443';fs.writeFileSync(path.join(root,'runtime/phone-config.json'),JSON.stringify({origin,allowedPeers:['127.0.0.1'],bindAddress:'127.0.0.1'}));fs.writeFileSync(path.join(root,'runtime/viewer-token'),'a'.repeat(64));
 const source='/* test code */\n'.repeat(10000);
 const backend=http.createServer((req,res)=>{
  assert.equal(req.headers.cookie,'remote_session='+'a'.repeat(64));
  if(req.url==='/assets/test.js'){
   if(req.headers['if-none-match']==='"fixture"'){res.writeHead(304,{etag:'"fixture"'});res.end();return;}
   res.writeHead(200,{'content-type':'text/javascript',etag:'"fixture"','content-length':Buffer.byteLength(source)});res.end(source);
  }else if(req.url==='/api'){res.setHeader('content-type','application/json');res.end('{"private":"test"}')}
  else{res.setHeader('content-type','text/html');res.end('<html>ws://127.0.0.1:18214</html>')}
 });backend.listen(0,'127.0.0.1');await once(backend,'listening');
 // Isolate the fixture from a real viewer running on the same Mac. Only the
 // copied gateway's loopback destination port changes; its policy is unchanged.
 const gatewayFile=path.join(root,'desktop/phone-gateway.cjs');
 const gatewaySource=fs.readFileSync(gatewayFile,'utf8');
 assert.equal(gatewaySource.split('port:18314').length-1,2);
 fs.writeFileSync(gatewayFile,gatewaySource.replaceAll('port:18314',`port:${backend.address().port}`));
 const child=spawn(process.execPath,[path.join(root,'desktop/phone-gateway.cjs')],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{child.kill('SIGKILL');backend.closeAllConnections();backend.close();fs.rmSync(root,{recursive:true,force:true})});
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Gateway exited')})]);
 const ca=fs.readFileSync(path.join(root,'runtime/phone.crt'));
 const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=https.request(origin+url,{ca,headers,method},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))});req.on('error',reject);req.end();
 });
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
