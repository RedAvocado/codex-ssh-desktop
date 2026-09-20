const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const Fastify=require('fastify'),multipart=require('@fastify/multipart');
const {createLocalTranscriber,registerLocalTranscription,MAX_AUDIO_BYTES}=require('../src/server/local-transcription.js');

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dictation-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config={whisper:path.join(root,'whisper'),ffmpeg:path.join(root,'ffmpeg'),model:path.join(root,'model')};
 for(const p of Object.values(config))await fs.writeFile(p,'fixture');
 await fs.writeFile(path.join(root,'transcription-config.json'),JSON.stringify(config));
 return {root,config,empty:async()=>assert.deepEqual(await fs.readdir(path.join(root,'transcription-tmp')),[])};
}
test('local transcription bounds conversion, returns text, and cleans private temporary audio',async t=>{
 const f=await fixture(t),calls=[];
 const transcribe=createLocalTranscriber(f.root,async(file,args)=>{
  calls.push({file,args});
  if(file===f.config.ffmpeg){
   const input=args[args.indexOf('-i')+1];assert.equal((await fs.stat(input)).mode&0o777,0o600);
   assert.equal((await fs.stat(path.dirname(input))).mode&0o777,0o700);
   await fs.writeFile(args.at(-1),Buffer.alloc(32000));
  }else await fs.writeFile(args[args.indexOf('-of')+1]+'.txt','  Test dictation.\n');
 });
 assert.deepEqual(await transcribe(Buffer.from('fixture'),'en-US',new AbortController().signal),{text:'Test dictation.'});
 assert.ok(calls[0].args.includes('file,pipe'));assert.ok(calls[0].args.includes('301'));
 assert.equal(calls[1].args[calls[1].args.indexOf('-l')+1],'en');await f.empty();
});
test('invalid input and unavailable local configuration fail without invoking a provider',async t=>{
 const f=await fixture(t);let calls=0;const transcribe=createLocalTranscriber(f.root,async()=>{calls++});
 await assert.rejects(transcribe(Buffer.alloc(0),'',new AbortController().signal));
 await assert.rejects(transcribe(Buffer.alloc(MAX_AUDIO_BYTES+1),'',new AbortController().signal));
 await assert.rejects(transcribe(Buffer.from('audio'),'--bad',new AbortController().signal));
 await fs.unlink(path.join(f.root,'transcription-config.json'));
 await assert.rejects(transcribe(Buffer.from('audio'),'en',new AbortController().signal),e=>e.status===503);
 assert.equal(calls,0);
});
test('overlong audio is rejected before inference and its files are removed',async t=>{
 const f=await fixture(t);let calls=0;
 const transcribe=createLocalTranscriber(f.root,async(file,args)=>{calls++;await fs.writeFile(args.at(-1),Buffer.alloc(301*32000));});
 await assert.rejects(transcribe(Buffer.from('audio'),'en',new AbortController().signal),/five minutes/);
 assert.equal(calls,1);await f.empty();
});
test('concurrency is bounded and cancellation frees the slot and temporary files',async t=>{
 const f=await fixture(t),controller=new AbortController();let started;const ready=new Promise(r=>started=r);
 const transcribe=createLocalTranscriber(f.root,async(file,args,signal)=>{started();await new Promise((r,j)=>signal.addEventListener('abort',()=>j(signal.reason),{once:true}));});
 const first=transcribe(Buffer.from('audio'),'en',controller.signal);await ready;
 await assert.rejects(transcribe(Buffer.from('audio'),'en',new AbortController().signal),e=>e.status===429);
 controller.abort();await assert.rejects(first);await f.empty();
 await assert.rejects(transcribe(Buffer.from('audio'),'en',AbortSignal.abort()),e=>e.name==='AbortError');
});
test('transcription upload requires same origin and a bounded audio part',async t=>{
 const f=await fixture(t),app=Fastify();t.after(()=>app.close());await app.register(multipart);registerLocalTranscription(app,f.root);
 assert.equal((await app.inject({method:'POST',url:'/__backend/transcribe'})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/__backend/transcribe',headers:{origin:'https://elsewhere.test'}})).statusCode,403);
 const headers={origin:'http://127.0.0.1:18214','content-type':'multipart/form-data; boundary=test'};
 const reply=await app.inject({method:'POST',url:'/__backend/transcribe',headers,payload:'--test\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--test--\r\n'});
 assert.equal(reply.statusCode,400);assert.equal(reply.headers['cache-control'],'no-store');
});
test('renderer patch routes batch audio locally and disables external streaming and cleanup',async()=>{
 const {patchLocalTranscription}=await import('../desktop/transcription-patch.mjs');
 const source='async function EPo(e,t={}){let n=t.contentType??"audio/webm";}function A5s(e){let t=(0,R.c)(88),{cleanupEnabled:n,onTranscribeError:h,streamingEnabled:b}=e;}';
 const patched=patchLocalTranscription(source);
 assert.match(patched,/transcribeAudio\(e,t\)/);assert.match(patched,/streamingEnabled:false,cleanupEnabled:false/);
 assert.equal(patchLocalTranscription(patched),patched);assert.throws(()=>patchLocalTranscription('unknown renderer'),/compatible match/);
});
