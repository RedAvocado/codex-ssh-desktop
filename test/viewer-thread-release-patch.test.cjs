const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('reviewed auxiliary bundle exposes its local engine and scopes immediate unload to it',async t=>{
  const file=path.join(__dirname,'../scratch/asar/.vite/build/main-DS3FMq4P.js');
  if(!fs.existsSync(file)){t.skip('prepared 26.911 fixture unavailable');return}
  const {patchPrivateRemoteControl}=await import('../desktop/private-remote-control-patch.mjs');
  const {patchAuxiliaryAutomationScheduler}=await import('../desktop/auxiliary-automations-patch.mjs');
  const {patchViewerThreadRelease}=await import('../desktop/viewer-thread-release-patch.mjs');
  const options={preparedVersion:'26.911.61220',asset:'main-DS3FMq4P.js'};
  const before=patchAuxiliaryAutomationScheduler(patchPrivateRemoteControl(fs.readFileSync(file,'utf8')),options);
  const after=patchViewerThreadRelease(before,options);
  assert.doesNotThrow(()=>new vm.Script(after));
  assert.throws(()=>patchViewerThreadRelease(before+' ',options),/SHA-256/);
  assert.throws(()=>patchViewerThreadRelease(before,{...options,preparedVersion:'unknown'}),/supports only/);
  assert.throws(()=>patchViewerThreadRelease(after,options),/SHA-256/);
  const match=after.match(/getConfigOverrides:(async\(\)=>\[\.\.\.await wre\(e\),.*?\])\}/);
  assert.ok(match);
  for(const id of ['local','other']){
    const get=new Function('wre','e',`return (${match[1]})`)(async()=>['existing=true'],{hostConfig:{id}});
    assert.deepEqual(await get(),id==='local'?['existing=true','thread_unload_delay_secs=0']:['existing=true']);
  }
});
