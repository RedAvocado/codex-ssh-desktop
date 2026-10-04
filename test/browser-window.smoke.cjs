// Isolated browser integration: a SOCKS endpoint maps remote localhost to a
// different local server, proving that Chromium does not bypass the tunnel.
const {app,BrowserWindow,webContents,session}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WebSocketServer}=require('ws');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ssh-browser-test-'));
app.setPath('userData',directory);app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const connections=new Set(),targets=[];let cookies=[],directRequests=0;
const server=http.createServer((req,res)=>{
 cookies.push(req.headers.cookie||'');
 if(req.url==='/direct-canary')directRequests++;
 if(req.url==='/redirect'){res.writeHead(302,{Location:'http://localhost:30123/final?q=kept'});res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<h1 id="result">Remote fixture</h1><a href="http://example.test:30123/next" target="_blank" id="popup">Next</a><script>const s=new WebSocket("ws://localhost:30123/socket");s.onopen=()=>s.send("echo");s.onmessage=e=>document.body.dataset.socket=e.data;</script>');
});
const ws=new WebSocketServer({server});ws.on('connection',s=>s.on('message',data=>s.send(data.toString())));
const socks=net.createServer(socket=>{
 connections.add(socket);socket.on('close',()=>connections.delete(socket));socket.on('error',()=>{});
 let buffer=Buffer.alloc(0),phase=0;
 const read=chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  if(phase===0){if(buffer.length<2||buffer.length<2+buffer[1])return;buffer=buffer.subarray(2+buffer[1]);socket.write(Buffer.from([5,0]));phase=1;}
  if(buffer.length<5)return;
  let host,end;
  if(buffer[3]===3){end=5+buffer[4];if(buffer.length<end+2)return;host=buffer.subarray(5,end).toString();}
  else if(buffer[3]===1){end=8;if(buffer.length<10)return;host=[...buffer.subarray(4,8)].join('.');}
  else if(buffer[3]===4){end=20;if(buffer.length<22)return;host='::1';}else{socket.destroy();return;}
  const port=buffer.readUInt16BE(end);targets.push({host,port});
  if(port!==30123){socket.destroy();return;}
  socket.removeListener('data',read);
  const remote=net.connect(server.address().port,'127.0.0.1',()=>{
   socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(buffer.length>end+2)remote.write(buffer.subarray(end+2));socket.pipe(remote);remote.pipe(socket);
  });remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());
 };socket.on('data',read);
});
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 // Never seize a real viewer's port; use a free one and override only this fixture.
 await new Promise(r=>socks.listen(0,'127.0.0.1',r));
 const policy=require('../viewer/browser-policy.cjs');
 require.cache[require.resolve('../viewer/browser-policy.cjs')].exports={...policy,browserProxy:{...policy.browserProxy,proxyRules:`socks5://127.0.0.1:${socks.address().port}`}};
 // Production additionally checks the configured fixed port. Keep that check meaningful here.
 const original=session.fromPartition;
 session.fromPartition=(...args)=>{const s=original.apply(session,args),resolve=s.resolveProxy.bind(s);s.resolveProxy=async url=>(await resolve(url)).replace(String(socks.address().port),'18216');return s;};
 const {createBrowserControls}=require('../viewer/browser-window.cjs');
 await original.call(session,'codex-ssh-desktop-memory').cookies.set({url:'http://localhost',name:'viewer-secret',value:'must-not-leak'});
 let connectGate;
 const controls=createBrowserControls({getHost:()=> 'fixture',ensureConnection:async()=>{await connectGate;}});
 await controls.open('http://localhost:30123/redirect');
 const view=webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://localhost:30123'));
 assert.ok(view,'Website opened within the Electron app');
 assert.match(view.getURL(),/\/final\?q=kept$/);
 for(let i=0;i<100&&!(await view.executeJavaScript('document.body.dataset.socket'));i++)await wait(30);
 assert.equal(await view.executeJavaScript('document.body.dataset.socket'),'echo');
 assert.equal(await view.executeJavaScript('typeof require+":"+typeof websiteBrowser'),'undefined:undefined');
 assert.ok(cookies.every(x=>!x.includes('must-not-leak')));
 assert.ok(targets.some(x=>x.port===30123));
 await view.executeJavaScript('document.querySelector("#popup").click()');
 for(let i=0;i<100&&!view.getURL().includes('example.test');i++)await wait(30);
 for(let i=0;i<100&&view.isLoading();i++)await wait(30);
 assert.match(view.getURL(),/example\.test:30123\/next/);
 assert.equal(BrowserWindow.getAllWindows().length,1,'Popup stays in the in-app browser');
 await assert.rejects(controls.open('file:///etc/passwd'));
 await Promise.all([controls.open('http://localhost:30123/first'),controls.open('http://localhost:30123/last')]);
 assert.match(view.getURL(),/\/last$/,JSON.stringify(await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.websiteBrowser.read()')));
 const socksPort=socks.address().port;
 for(const c of connections)c.destroy();await new Promise(r=>socks.close(r));
 await controls.connectionChanged(false);
 await controls.open(`http://127.0.0.1:${server.address().port}/direct-canary`);
 assert.equal(directRequests,0,'lost SSH never falls back to a server on the local computer');
 const toolbar=BrowserWindow.getAllWindows()[0].webContents;
 assert.ok((await toolbar.executeJavaScript('window.websiteBrowser.read()')).error,'proxy failure is visible');
 await new Promise(r=>socks.listen(socksPort,'127.0.0.1',r));
 await controls.open('http://localhost:30123/recovered');assert.match(view.getURL(),/\/recovered$/);
 let release;connectGate=new Promise(r=>release=r);
 const closing=controls.open('http://localhost:30123/closed');await wait(30);
 const closed=new Promise(r=>BrowserWindow.getAllWindows()[0].once('closed',r));controls.dispose();release();await closing;await closed;
 assert.equal(BrowserWindow.getAllWindows().length,0,'closing during connection cannot recreate a hidden browser');
 controls.dispose();
 for(const c of connections)c.destroy();ws.close();socks.close();server.close();
 console.log('Browser checks passed: remote loopback, redirect/query, WebSocket, popup, isolated cookies, sandbox, concurrent links, tunnel failure/recovery and window cleanup.');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('Browser integration timed out');app.exit(1);},20000).unref();
