// Opt-in, credential-free tests against a real Codex CLI. Both engines use the
// same disposable CODEX_HOME; a loopback provider supplies the only model reply.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),readline=require('node:readline');
const {ViewerThreadRelease}=require('../src/server/viewer-thread-release.js');
const cli=process.env.CODEX_TEST_CLI;

async function setup(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-ownership-integration-'));
  const engines=[];
  t.after(async()=>{
    for(const engine of engines)engine.stop();
    await Promise.all(engines.map(engine=>engine.exited));
    fs.rmSync(home,{recursive:true,force:true});
  });
  function engine(){
    const process=spawn(cli,['app-server','-c','thread_unload_delay_secs=0'],{
      env:{PATH:global.process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:os.tmpdir()},stdio:['pipe','pipe','pipe'],
    });
    let sequence=0,stderr='';const pending=new Map(),listeners=new Set();
    process.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000)});
    const exited=once(process,'exit');
    readline.createInterface({input:process.stdout}).on('line',line=>{
      const message=JSON.parse(line),request=pending.get(message.id);
      if(request){pending.delete(message.id);clearTimeout(request.timer);
        message.error?request.reject(Error(message.error.message)):request.resolve(message.result);
      }else if(message.method)for(const listener of listeners)listener(message);
    });
    function request(method,params){return new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out: ${stderr}`))},20000);
      pending.set(id,{resolve,reject,timer});process.stdin.write(JSON.stringify({id,method,params})+'\n');
    })}
    const result={request,exited,
      async init(){await request('initialize',{clientInfo:{name:'codex_ssh_handoff_test',version:'1.0.0'},capabilities:{experimentalApi:true}});process.stdin.write('{"method":"initialized"}\n')},
      getPendingRequestCount:()=>pending.size,
      sendAppServerRequest:async(method,params,guard)=>{guard?.();return request(method,params)},
      readThread:async id=>(await request('thread/read',{threadId:id,includeTurns:false})).thread,
      registerInternalNotificationHandler:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
      stop(){process.stdin.end();process.kill('SIGTERM');for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Test engine stopped'))}pending.clear()},
    };engines.push(result);return result;
  }
  return {home,engine};
}

const config={'features.apps':false,'features.plugins':false};
async function waitUntil(check){for(let attempt=0;attempt<100;attempt++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}assert.fail('Condition did not become true within ten seconds')}

test('idle phone writer is actually unloaded and a second engine resumes the same history',{skip:!cli},async t=>{
  const {home,engine}=await setup(t),a=engine();await a.init();const b=engine();await b.init();
  const {thread}=await a.request('thread/start',{cwd:home,model:'gpt-6',approvalPolicy:'never',sandbox:'read-only',config,persistExtendedHistory:true});
  await a.request('thread/inject_items',{threadId:thread.id,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Isolated writer handoff test; no model turn requested.'}]}]});
  await assert.rejects(b.request('thread/resume',{threadId:thread.id}),/active writer/);
  let views=[{connected:true,parked:true}];const cleanup=new ViewerThreadRelease(()=>views,()=>{views=[]});t.after(()=>cleanup.dispose());cleanup.attach(a);
  await cleanup.sweep();await waitUntil(async()=>!(await a.request('thread/loaded/list',{})).data.includes(thread.id));
  assert.equal((await b.request('thread/resume',{threadId:thread.id})).thread.id,thread.id);
  assert.ok(fs.existsSync(thread.path),'The original persisted history remains');
});

test('a real active turn survives leaving the viewer and releases only after completion',{skip:!cli},async t=>{
  const {home,engine}=await setup(t);let respond,requests=0;
  const provider=http.createServer((req,res)=>{
    requests++;req.resume();
    if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end();return}
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    send('response.created',{response:{id:'handoff-response',object:'response',status:'in_progress',output:[]}});
    respond=()=>{
      const item={id:'handoff-message',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'Ownership test complete.',annotations:[]}]};
      send('response.output_item.done',{output_index:0,item});
      send('response.completed',{response:{id:'handoff-response',object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
    };
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');t.after(()=>{provider.closeAllConnections();provider.close()});
  const a=engine();await a.init();const b=engine();await b.init();
  const mockConfig={...config,'model_providers.handoff_test':{name:'Local handoff fixture',base_url:`http://127.0.0.1:${provider.address().port}/v1`,wire_api:'responses',requires_openai_auth:false}};
  const {thread}=await a.request('thread/start',{cwd:home,model:'gpt-6',modelProvider:'handoff_test',approvalPolicy:'never',sandbox:'read-only',config:mockConfig});
  const {turn}=await a.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Reply with the fixture response.'}]});
  await waitUntil(()=>!!respond);assert.equal((await a.readThread(thread.id)).status.type,'active');
  let views=[{connected:true,parked:true}];const cleanup=new ViewerThreadRelease(()=>views,()=>{views=[]});t.after(()=>cleanup.dispose());cleanup.attach(a);
  await cleanup.sweep();assert.equal(cleanup.snapshot().released,0);assert.equal(views.length,1);
  await assert.rejects(b.request('thread/resume',{threadId:thread.id,modelProvider:'handoff_test',config:mockConfig}),/active writer/);
  respond();await waitUntil(async()=>(await a.readThread(thread.id)).status.type!=='active');
  const completed=await a.request('thread/read',{threadId:thread.id,includeTurns:true});
  assert.equal(completed.thread.turns.find(item=>item.id===turn.id)?.status,'completed','Leaving the viewer must not interrupt the active turn');
  await cleanup.sweep();await waitUntil(async()=>!(await a.request('thread/loaded/list',{})).data.includes(thread.id));
  assert.equal((await b.request('thread/resume',{threadId:thread.id,modelProvider:'handoff_test',config:mockConfig})).thread.id,thread.id);
  assert.equal(requests,1,'Only the loopback fixture served a model request');
});
