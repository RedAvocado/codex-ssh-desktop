const test=require('node:test');
const assert=require('node:assert/strict');
const {compareVersions,checkForUpdates,repository,validateRelease}=require('../viewer/updates.cjs');
const release=tag=>({tag_name:tag,draft:false,prerelease:false,html_url:'https://untrusted.example/download'});
const fetchRelease=tag=>async()=>({status:200,ok:true,json:async()=>release(tag)});
test('numeric version comparison handles multi-digit versions',()=>{
  assert.equal(compareVersions('v0.10.0','0.9.9'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);assert.equal(compareVersions('0.1.0','1.0.0'),-1);
  assert.throws(()=>compareVersions('latest','1.0.0'));
});
test('updates link to the configured repository, never API-provided links',async()=>{
  const result=await checkForUpdates('0.1.0',{fetchImpl:fetchRelease('v0.2.0')});
  assert.equal(result.status,'available');assert.equal(result.url,`https://github.com/${repository}/releases/tag/v0.2.0`);
});
test('equal and older published versions report current',async()=>{
  for(const tag of ['v0.1.0','v0.0.9'])assert.equal((await checkForUpdates('0.1.0',{fetchImpl:fetchRelease(tag)})).status,'current');
});
test('404 without a private fallback is unavailable, not current',async()=>{
  assert.equal((await checkForUpdates('0.1.0',{fetchImpl:async()=>({status:404})})).status,'unavailable');
});
test('private repositories can use authenticated gh without exposing credentials',async()=>{
  const result=await checkForUpdates('0.1.0',{fetchImpl:async()=>({status:404}),readPrivateRelease:async()=>release('v0.2.0')});
  assert.equal(result.status,'available');
});
test('network errors, rate limits, invalid JSON and unexpected tags fail honestly',async()=>{
  await assert.rejects(checkForUpdates('0.1.0',{fetchImpl:async()=>{throw Error('offline')}}),/Could not reach/);
  await assert.rejects(checkForUpdates('0.1.0',{fetchImpl:async()=>({status:403})}),/limited/);
  await assert.rejects(checkForUpdates('0.1.0',{fetchImpl:async()=>({status:200,ok:true,json:async()=>{throw Error()}})}),/unreadable/);
  for(const tag of ['v2.0.0-beta.1','latest','../../elsewhere'])await assert.rejects(checkForUpdates('0.1.0',{fetchImpl:fetchRelease(tag)}),/invalid/);
});
test('only a unique uploaded asset matching this Mac with a GitHub digest enables installation',()=>{
  const asset={name:'Codex-SSH-Desktop-0.4.0-macos-arm64.zip',state:'uploaded',size:123,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://untrusted.example/evil'};
  const raw={...release('v0.4.0'),assets:[asset]};
  assert.equal(validateRelease(raw,'arm64').asset.url,`https://github.com/${repository}/releases/download/v0.4.0/${asset.name}`);
  assert.equal(validateRelease(raw,'x64').asset,null);
  for(const bad of [{digest:null},{size:0},{size:1024**3+1},{state:'new'}])
    assert.equal(validateRelease({...raw,assets:[{...asset,...bad}]},'arm64').asset,null);
  assert.equal(validateRelease({...raw,assets:[asset,asset]},'arm64').asset,null);
});
