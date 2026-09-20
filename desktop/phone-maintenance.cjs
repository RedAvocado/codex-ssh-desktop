const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs'),path=require('node:path'),{X509Certificate}=require('node:crypto');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),runtime=path.join(root,'runtime');
(async()=>{
 // Certificate renewal must still run while an account operation holds the
 // startup lock or the backend needs attention.
 let runtimeFailed=false;
 try{
  const {stdout}=await run(process.execPath,[path.join(__dirname,'control.cjs'),'ensure'],{timeout:70000,maxBuffer:128*1024,cwd:root});
  runtimeFailed=!JSON.parse(stdout).ready;
 }catch{runtimeFailed=true;}
 const cert=new X509Certificate(fs.readFileSync(path.join(runtime,'phone.crt')));
 if(new Date(cert.validTo).getTime()-Date.now()<30*86400000){
  const config=JSON.parse(fs.readFileSync(path.join(runtime,'phone-config.json'),'utf8'));
  await run('/Applications/Tailscale.app/Contents/MacOS/Tailscale',['cert','--cert-file',path.join(runtime,'phone.crt'),'--key-file',path.join(runtime,'phone.key'),new URL(config.origin).hostname],{timeout:60000});
 }
 if(runtimeFailed)throw Error('Runtime is not ready');
})().catch(()=>{console.error('Private viewer maintenance needs attention; inspect runtime health.');process.exitCode=1;});
