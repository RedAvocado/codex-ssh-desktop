const {test}=require('node:test');
const assert=require('node:assert/strict');
const {findCodexCli}=require('../desktop/engine-path.cjs');

function fixture(files, behavior={}) {
  const calls=[];
  const result=findCodexCli('/Applications/ChatGPT.app/Contents/Resources',{
    exists:path=>files.includes(path),executable:path=>!behavior.nonExecutable?.includes(path),
    run:(path,args)=>{
      calls.push([path,args.join(' ')]);
      if (behavior.badVersion?.includes(path) && args[0]==='--version') return 'unrelated-cli 1.0.0';
      if (behavior.noAppServer?.includes(path) && args[0]==='app-server') return 'Not supported';
      return args[0]==='--version'?'codex-cli 0.155.1':'Usage: codex app-server';
    },
  });
  return {result,calls};
}

test('prefers the current bundled CLI and supports the older bundled path',()=>{
  const current='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const older='/Applications/ChatGPT.app/Contents/Resources/codex';
  assert.equal(fixture([current,older,'/opt/homebrew/bin/codex']).result,current);
  assert.equal(fixture([older,'/opt/homebrew/bin/codex']).result,older);
});
test('uses a verified installed CLI after the desktop app removes its bundled copy',()=>{
  const f=fixture(['/opt/homebrew/bin/codex']);
  assert.equal(f.result,'/opt/homebrew/bin/codex');
  assert.deepEqual(f.calls.map(call=>call[1]),['--version','app-server --help']);
});
test('rejects missing, unrelated, non-executable, and unsupported CLIs',()=>{
  assert.throws(()=>fixture([]),/No working Codex CLI/);
  assert.throws(()=>fixture(['/opt/homebrew/bin/codex'],{nonExecutable:['/opt/homebrew/bin/codex']}),/No working Codex CLI/);
  assert.throws(()=>fixture(['/opt/homebrew/bin/codex'],{badVersion:['/opt/homebrew/bin/codex']}),/No working Codex CLI/);
  assert.throws(()=>fixture(['/opt/homebrew/bin/codex'],{noAppServer:['/opt/homebrew/bin/codex']}),/No working Codex CLI/);
});
