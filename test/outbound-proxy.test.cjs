const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),net=require('node:net'),{once}=require('node:events');
const {startOutboundProxy}=require('../src/server/outbound-proxy.js');
const authorization='Basic '+Buffer.from('remote:fixture-token').toString('base64');
async function fixture(t){
 const proxy=await startOutboundProxy('fixture-token',0);
 t.after(()=>{proxy.closeAllConnections();proxy.close()});
 return proxy.address().port;
}
test('outbound HTTP still requires authentication and aborted upstream bodies terminate promptly',async t=>{
 const port=await fixture(t),backend=http.createServer((_req,res)=>{
  res.writeHead(200,{'content-length':1000});res.write('partial');setImmediate(()=>res.destroy());
 });backend.listen(0,'127.0.0.1');await once(backend,'listening');
 t.after(()=>{backend.closeAllConnections();backend.close()});
 const request=authenticated=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:`http://127.0.0.1:${backend.address().port}/`,timeout:1000,headers:authenticated?{'proxy-authorization':authorization}:{}},res=>{
   res.on('error',reject);res.resume();res.on('end',()=>resolve(res.statusCode));
  });req.on('timeout',()=>req.destroy(Error('fixture timed out')));req.on('error',reject);req.end();
 });
 assert.equal(await request(false),407);
 await assert.rejects(request(true),error=>error.message!=='fixture timed out');
 assert.equal(await request(false),407);
});
test('authenticated CONNECT forwards bytes and releases the upstream when its client leaves',async t=>{
 const port=await fixture(t),echo=net.createServer(socket=>socket.pipe(socket));
 echo.listen(0,'127.0.0.1');await once(echo,'listening');t.after(()=>echo.close());
 const accepted=once(echo,'connection'),client=net.connect(port,'127.0.0.1');t.after(()=>client.destroy());await once(client,'connect');
 client.write(`CONNECT 127.0.0.1:${echo.address().port} HTTP/1.1\r\nHost: fixture\r\nProxy-Authorization: ${authorization}\r\n\r\n`);
 const [remote]=await accepted,closed=once(remote,'close');t.after(()=>remote.destroy());
 assert.match(String((await once(client,'data'))[0]),/200 Connection Established/);
 client.write('echo');assert.equal(String((await once(client,'data'))[0]),'echo');
 client.destroy();await closed;
});
