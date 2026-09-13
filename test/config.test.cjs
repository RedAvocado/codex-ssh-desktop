const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {validateConfig,readConfig,saveConfig,quoteShell,remoteCommand}=require('../viewer/config.cjs');
test('SSH aliases are accepted; command options and shell fragments are rejected',()=>{
  assert.equal(validateConfig({sshHost:'user@studio.local'}).remoteNode,'node');
  for(const sshHost of ['-oProxyCommand=bad','studio; touch anything','studio\nother',''])assert.throws(()=>validateConfig({sshHost}));
});
test('shell quoting preserves literal metacharacters without executing them',()=>{
  const value="folder with 'quotes' and $(exit 42) `exit 42`";
  const result=execFileSync('/bin/sh',['-c',`printf '%s' ${quoteShell(value)}`],{encoding:'utf8'});
  assert.equal(result,value);
  assert.ok(remoteCommand({sshHost:'studio',remoteDirectory:value}).includes(quoteShell(value)));
});
test('private connection settings round trip with restrictive permissions',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'remote-config-test-'));
  try{
    assert.equal(readConfig(directory),null);
    saveConfig(directory,{sshHost:'studio',remoteDirectory:'.local/share/codex-ssh-desktop'});
    assert.equal(readConfig(directory).sshHost,'studio');
    assert.equal(fs.statSync(path.join(directory,'connection.json')).mode&0o777,0o600);
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
