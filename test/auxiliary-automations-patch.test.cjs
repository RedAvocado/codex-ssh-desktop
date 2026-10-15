const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');

const prepared=path.join(__dirname,'../scratch/asar');
const mainAsset='main-DS3FMq4P.js';
const rendererAsset='app-initial-b21bd554b363.js';
const version='26.911.61220';
const digest=value=>createHash('sha256').update(value).digest('hex');

test('auxiliary automation patch accepts only the reviewed prepared desktop',async t=>{
  const {patchAuxiliaryAutomationScheduler,patchAuxiliaryAutomationRenderer}=await import('../desktop/auxiliary-automations-patch.mjs');
  const {patchPrivateRemoteControl}=await import('../desktop/private-remote-control-patch.mjs');
  if(!fs.existsSync(path.join(prepared,'.vite/build',mainAsset)) || !fs.existsSync(path.join(prepared,'webview/assets',rendererAsset))){
    t.skip('prepared 26.911 desktop extraction is not present');return;
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(prepared,'package.json'),'utf8')).version,version);
  const main=patchPrivateRemoteControl(fs.readFileSync(path.join(prepared,'.vite/build',mainAsset),'utf8'));
  const renderer=fs.readFileSync(path.join(prepared,'webview/assets',rendererAsset),'utf8');
  const optsMain={preparedVersion:version,asset:mainAsset};
  const optsRenderer={preparedVersion:version,asset:rendererAsset};
  const stopped=patchAuxiliaryAutomationScheduler(main,optsMain);
  const suppressed=patchAuxiliaryAutomationRenderer(renderer,optsRenderer);
  const originalSelector='function tcs(e){return e==null?[]:Array.from(new Set(e.flatMap(e=>!Vm(e)||e.status!==`ACTIVE`||!rot(e.targetThreadId)?[]:[Xm(e.targetThreadId)])))}';
  assert.equal(main.split('start:()=>{if(!(g||h))').length-1,1);
  assert.equal(stopped.split('start:()=>{},dispose:()=>').length-1,1);
  assert.equal(suppressed.split('function tcs(e){return []}').length-1,1);
  assert.equal(suppressed.replace('function tcs(e){return []}',originalSelector),renderer,'only the reviewed target selector changes');
  assert.equal(suppressed.split('function ncs(){let e=').length-1,1,'component and automation UI remain mounted');
  assert.equal(suppressed.split('heartbeat_automation_resume_failed').length-1,1,'resume code remains, but it has no background targets');
  const selector={};vm.runInNewContext('function tcs(e){return []};result=tcs([{status:"ACTIVE",targetThreadId:"any"}])',selector);
  assert.deepEqual(Array.from(selector.result),[]);
  assert.equal(digest(stopped),'accbb81ebd93a2c78ef38e564972d3266ed02987240ac0a7d80f9d4a75a992f1');
  assert.equal(digest(suppressed),'dda6b5ed008d5c7d3b5e27fa93b40eb6214b1ca113b249569b5dd8a4207f1d7d');
  assert.doesNotThrow(()=>new vm.Script(stopped));
  const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:suppressed,encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(syntax.status,0,syntax.stderr.slice(0,1000));
  assert.throws(()=>patchAuxiliaryAutomationScheduler(main,{preparedVersion:'26.1007.71326',asset:mainAsset}),/supports only/);
  assert.throws(()=>patchAuxiliaryAutomationRenderer(renderer,{preparedVersion:version,asset:'different.js'}),/supports only/);
  assert.throws(()=>patchAuxiliaryAutomationScheduler(main+' ',optsMain),/SHA-256 mismatch/);
  assert.throws(()=>patchAuxiliaryAutomationRenderer(renderer+' ',optsRenderer),/SHA-256 mismatch/);
});
