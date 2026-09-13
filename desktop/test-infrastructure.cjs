const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const tls=require('node:tls');
const assert=require('node:assert/strict');
const token=fs.readFileSync(path.join(__dirname,'../runtime/viewer-token'),'utf8').trim();
(async()=>{
 let r=await fetch('http://127.0.0.1:18314/');assert.equal(r.status,401);
 r=await fetch('http://127.0.0.1:18314/__health',{headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,200);const h=await r.json();assert.equal(h.ready,true);
 r=await fetch('http://127.0.0.1:18314/',{headers:{Cookie:`remote_session=${token}`,Origin:'https://example.org'}});assert.equal(r.status,401);
 r=await fetch('http://127.0.0.1:18314/',{headers:{Cookie:`remote_session=${token}`}});assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('Content-Security-Policy'));assert.ok(html.includes('ws://127.0.0.1:18214'));
 const proxyRequest=auth=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:18315,path:'http://example.com/',method:'HEAD',headers:auth?{'Proxy-Authorization':`Basic ${Buffer.from(`remote:${token}`).toString('base64')}`}:{},timeout:20000},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Proxy timed out')));req.end();
 });
 assert.equal(await proxyRequest(false),407,'Proxy rejects missing credentials');
 const upstreamStatus=await proxyRequest(true);
 assert.ok(upstreamStatus>=200&&upstreamStatus<500&&upstreamStatus!==407,`Expected upstream response, received ${upstreamStatus}`);
 const httpsStatus=await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:18315,method:'CONNECT',path:'example.com:443',headers:{'Proxy-Authorization':`Basic ${Buffer.from(`remote:${token}`).toString('base64')}`},timeout:20000});
  req.on('connect',(res,socket,head)=>{
   if(res.statusCode!==200){socket.destroy();reject(Error(`CONNECT returned ${res.statusCode}`));return;}
   if(head.length)socket.unshift(head);
   const secure=tls.connect({socket,servername:'example.com',rejectUnauthorized:true},()=>secure.write('HEAD / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n'));
   let response='';secure.setTimeout(20000,()=>secure.destroy(Error('HTTPS timed out')));
   secure.on('data',chunk=>{response+=chunk.toString();if(response.includes('\r\n')){const status=Number(response.split(' ')[1]);secure.destroy();resolve(status);}});
   secure.on('error',reject);
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('CONNECT timed out')));req.end();
 });
 assert.equal(httpsStatus,200,'HTTPS request through remote proxy with validated certificate');
 console.log(JSON.stringify({ready:true,host:h.host,version:h.version,upstreamStatus,httpsStatus,tests:['unauthenticated request rejected','cross-origin request rejected','original UI and CSP served','unauthenticated proxy rejected','authenticated proxy reached upstream','HTTPS CONNECT and certificate verified']}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
