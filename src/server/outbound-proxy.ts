import http from 'node:http';
import net from 'node:net';
import {tokenMatches} from './access';

export async function startOutboundProxy(token:string):Promise<void>{
 const expected=`Basic ${Buffer.from(`remote:${token}`).toString('base64')}`;
 const authenticate=(header:string|undefined)=>tokenMatches(header,expected);
 const proxy=http.createServer((req,res)=>{
   if(!authenticate(req.headers['proxy-authorization'])){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="Codex SSH Desktop"'});res.end();return;}
   let url:URL;try{url=new URL(req.url??'');if(url.protocol!=='http:')throw Error();}catch{res.writeHead(400);res.end();return;}
   const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
   const upstream=http.request(url,{method:req.method,headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
   req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
 });
 proxy.on('connect',(req,client,head)=>{
   if(!authenticate(req.headers['proxy-authorization'])){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Codex SSH Desktop"\r\nConnection: close\r\n\r\n');return;}
   let url:URL;try{url=new URL(`https://${req.url}`);}catch{client.destroy();return;}
   const port=Number(url.port||443);
   if(!Number.isInteger(port)||port<1||port>65535){client.destroy();return;}
   const upstream=net.connect({host:url.hostname,port},()=>{
     client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
     if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);
   });
   upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
   client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
 });
 await new Promise<void>((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18315,'127.0.0.1',()=>{proxy.off('error',reject);resolve();});});
}
