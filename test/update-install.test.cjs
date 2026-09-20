const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const {downloadAsset, validateArchivePaths, installedBundle, supportsArchitecture} = require('../viewer/update-install.cjs');
const {runInstall, acknowledgeUpdate} = require('../viewer/update-helper.cjs');
const {repository} = require('../viewer/updates.cjs');
const payload = Buffer.from('verified app archive');
const asset = {url:`https://github.com/${repository}/releases/download/v0.4.0/client.zip`,size:payload.length,sha256:createHash('sha256').update(payload).digest('hex')};
test('architecture validation supports Apple Silicon, Intel and universal binaries without developer tools',()=>{
  const thin=Buffer.alloc(32);thin.writeUInt32LE(0xfeedfacf);thin.writeUInt32LE(0x0100000c,4);
  assert.equal(supportsArchitecture(thin,'arm64'),true);assert.equal(supportsArchitecture(thin,'x64'),false);
  const fat=Buffer.alloc(48);fat.writeUInt32BE(0xcafebabe);fat.writeUInt32BE(2,4);fat.writeUInt32BE(0x01000007,8);fat.writeUInt32BE(0x0100000c,28);
  assert.equal(supportsArchitecture(fat,'arm64'),true);assert.equal(supportsArchitecture(fat,'x64'),true);
  assert.equal(supportsArchitecture(fat.subarray(0,10),'arm64'),false);assert.equal(supportsArchitecture(Buffer.from('not executable'),'arm64'),false);
});
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(),'viewer-update-test-')); t.after(()=>fs.rm(directory,{recursive:true,force:true})); return directory; }
test('download verifies byte count and SHA256 before retaining an archive',async t=>{
  const directory=await temporary(t), file=path.join(directory,'update.zip'); let progress=0;
  await downloadAsset(asset,file,{fetchImpl:async()=>new Response(payload),onProgress:value=>progress=value});
  assert.deepEqual(await fs.readFile(file),payload); assert.equal(progress,1);
  for(const bad of [{...asset,sha256:'0'.repeat(64)},{...asset,size:1},{...asset,size:100}]){
    await fs.rm(file);
    await assert.rejects(downloadAsset(bad,file,{fetchImpl:async()=>new Response(payload)}));
    await assert.rejects(fs.access(file));
    await fs.writeFile(file,'reset');
  }
});
test('downloads reject off-host redirects and clean partial files on cancellation',async t=>{
  const directory=await temporary(t),file=path.join(directory,'update.zip');
  await assert.rejects(downloadAsset(asset,file,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://example.test/evil'}})}),/outside GitHub/);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(downloadAsset(asset,file,{signal:controller.signal,fetchImpl:async()=>new Response(payload)}),/abort/i);
  await assert.rejects(fs.access(file));
});
test('a refused download never deletes an existing destination',async t=>{
  const directory=await temporary(t),file=path.join(directory,'update.zip');
  await fs.writeFile(file,'existing archive');
  await assert.rejects(downloadAsset(asset,file,{fetchImpl:async()=>new Response(payload)}),{code:'EEXIST'});
  assert.equal(await fs.readFile(file,'utf8'),'existing archive');
});
test('archive and install paths cannot escape the application bundle',()=>{
  validateArchivePaths('Codex SSH Desktop.app/Contents/MacOS/Electron\n__MACOSX/._Codex SSH Desktop.app\n');
  for(const invalid of ['../elsewhere','/Applications/other.app','Codex SSH Desktop.app/../elsewhere','another.app/file','Codex SSH Desktop.app/\tfile'])
    assert.throws(()=>validateArchivePaths(invalid));
  assert.equal(installedBundle('/Applications/Codex SSH Desktop.app/Contents/MacOS/Electron'),'/Applications/Codex SSH Desktop.app');
  assert.throws(()=>installedBundle('/usr/local/bin/electron'));
});
async function fixture(t){
  const directory=await temporary(t),target=path.join(directory,'Codex SSH Desktop.app'),jobDirectory=path.join(directory,'.codex-ssh-update-test'),userData=path.join(directory,'user-data');
  const staged=path.join(jobDirectory,'extracted/Codex SSH Desktop.app');
  await fs.mkdir(target,{recursive:true});await fs.mkdir(staged,{recursive:true});await fs.mkdir(userData);
  await fs.writeFile(path.join(target,'version'),'old');await fs.writeFile(path.join(staged,'version'),'new');
  const job={target,jobDirectory,staged,userData,backup:path.join(jobDirectory,'previous.app'),parentPid:99999999,token:randomUUID(),version:'0.4.0',previousVersion:'0.3.0'};
  await fs.writeFile(path.join(userData,'pending-update.json'),JSON.stringify(job));
  return job;
}
test('installation preserves a backup, relaunches once, and waits for matching startup acknowledgement',async t=>{
  const job=await fixture(t);let launches=0;
  await runInstall(job,{isAlive:()=>false,wait:async()=>{},startApp:async target=>{
    launches++;assert.equal(await fs.readFile(path.join(target,'version'),'utf8'),'new');
    await acknowledgeUpdate({userData:job.userData,version:'0.4.0',target,pid:42});
    return {pid:42,stop:()=>assert.fail('healthy app stopped')};
  }});
  assert.equal(launches,1);assert.equal(await fs.readFile(path.join(job.backup,'version'),'utf8'),'old');
  assert.equal(JSON.parse(await fs.readFile(path.join(job.userData,'last-update.json'))).status,'installed');
  await assert.rejects(fs.access(path.join(job.userData,'pending-update.json')));
});
test('failed replacement restores the previous app before relaunching it',async t=>{
  const job=await fixture(t);let launches=0;
  await runInstall(job,{isAlive:()=>false,wait:async()=>{},rename:async(from,to)=>{
    if(from===job.staged)throw Error('simulated disk failure');return fs.rename(from,to);
  },startApp:async target=>{launches++;assert.equal(await fs.readFile(path.join(target,'version'),'utf8'),'old');return{pid:42};}});
  assert.equal(launches,1);assert.equal(JSON.parse(await fs.readFile(path.join(job.userData,'last-update.json'))).status,'failed');
});
test('failed startup rolls back, while a viewer that will not quit is left untouched',async t=>{
  const job=await fixture(t);let launches=0;
  await runInstall(job,{isAlive:()=>false,wait:async()=>{},attempts:1,startApp:async()=>({pid:42+launches++,stop:()=>{}})});
  assert.equal(launches,2);assert.equal(await fs.readFile(path.join(job.target,'version'),'utf8'),'old');
  const other=await fixture(t);
  await runInstall(other,{isAlive:()=>true,wait:async()=>{},attempts:1,startApp:()=>assert.fail('should not relaunch')});
  assert.equal(await fs.readFile(path.join(other.target,'version'),'utf8'),'old');await assert.rejects(fs.access(other.backup));
});
