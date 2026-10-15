const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('auxiliary desktop cannot inherit or re-enable native OpenAI Remote',async()=>{
  const {patchPrivateRemoteControl}=await import('../desktop/private-remote-control-patch.mjs');
  const source='let t=n.ut();t!=null&&this.sharedObjectRepository.set(`local_remote_control_enabled`,t);'
    +'"set-local-remote-control-enabled":async({enabled:e})=>{let t=n.dt({enabled:e});return this.sharedObjectRepository?.set(`local_remote_control_enabled`,t),{enabled:t}};'
    +'t.remoteControlEnabled&&await e.sendAppServerRequest(`remoteControl/enable`,null),';
  const patched=patchPrivateRemoteControl(source);
  assert.doesNotMatch(patched,/n\.ut\(|n\.dt\(|remoteControl\/enable/);
  const init=patched.match(/let t=!1;this\.sharedObjectRepository\.set\(`local_remote_control_enabled`,t\)/)?.[0];
  assert.ok(init);
  const values=[];
  vm.runInNewContext(init.replace('this.','receiver.'),{receiver:{sharedObjectRepository:{set:(key,value)=>values.push([key,value])}}});
  assert.deepEqual(values,[['local_remote_control_enabled',false]]);
  const handler=patched.match(/"set-local-remote-control-enabled":async\(\)=>\{[^}]+return\{enabled:!1\}\}/)?.[0];
  assert.ok(handler);
  const receiver={sharedObjectRepository:{set:(key,value)=>values.push([key,value])}};
  const api=vm.runInNewContext(`({${handler.replace('this.','receiver.')}})`,{receiver});
  const result=await api['set-local-remote-control-enabled']({enabled:true});
  assert.equal(result.enabled,false);
  assert.deepEqual(values.at(-1),['local_remote_control_enabled',false]);
  assert.throws(()=>patchPrivateRemoteControl(source.replace('n.ut()','n.missing()')),/initial Remote state/);
  const prepared=path.join(__dirname,'../scratch/asar/.vite/build');
  if(fs.existsSync(prepared)){
    const files=fs.readdirSync(prepared).filter(file=>/^main-.*\.js$/.test(file));
    assert.equal(files.length,1);
    const actual=fs.readFileSync(path.join(prepared,files[0]),'utf8');
    assert.doesNotThrow(()=>patchPrivateRemoteControl(actual));
  }
});
