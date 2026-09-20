import http from 'node:http';
import net from 'node:net';
import {pipeline} from 'node:stream';
import {tokenMatches} from './access';

export async function startOutboundProxy(token:string, port=18315):Promise<http.Server>{
 const expected=`Basic ${Buffer.from(`remote:${token}`).toString('base64')}`;
 const authenticate=(header:string|undefined)=>tokenMatches(header,expected);
 const proxy=http.createServer((req,res)=>{
   if(!authenticate(req.headers['proxy-authorization'])){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="Codex SSH Desktop"'});res.end();return;}
   let url:URL;try{url=new URL(req.url??'');if(url.protocol!=='http:')throw Error();}catch{res.writeHead(400);res.end();return;}
   const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
   const failed=()=>{if(res.destroyed||res.writableEnded)return;if(res.headersSent)res.destroy();else{res.writeHead(502);res.end();}};
   const upstream=http.request(url,{method:req.method,headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);pipeline(reply,res,()=>{});});
   upstream.on('error',failed);upstream.setTimeout(60_000,()=>{failed();upstream.destroy();});
   res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});
   req.on('error',()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
 });
 proxy.on('connect',(req,client,head)=>{
   let upstream:net.Socket|undefined;
   client.on('error',()=>upstream?.destroy());client.on('close',()=>upstream?.destroy());
   if(!authenticate(req.headers['proxy-authorization'])){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Codex SSH Desktop"\r\nConnection: close\r\n\r\n');return;}
   let url:URL;try{url=new URL(`https://${req.url}`);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();}catch{client.destroy();return;}
   const port=Number(url.port||443);
   if(!Number.isInteger(port)||port<1||port>65535){client.destroy();return;}
   const remote=upstream=net.connect({host:url.hostname.replace(/^\[|\]$/g,''),port},()=>{
     remote.setTimeout(0);
     if(client.destroyed){remote.destroy();return;}
     client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
     if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);
   });
   remote.setTimeout(15_000,()=>remote.destroy());
   remote.on('error',()=>client.destroy());remote.on('close',()=>client.destroy());
 });
 await new Promise<void>((resolve,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',()=>{proxy.off('error',reject);resolve();});});
 return proxy;
}
