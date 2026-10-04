const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {resolveCli,ensureBrowserCache}=require('../desktop/runtime-resources.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function write(file,value,mode=0o600){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value,{mode});}
test('CLI discovery follows the installed manifest and supports both previous layouts',t=>{
 const r=fixture(t);assert.throws(()=>resolveCli(r),/could not be found/);
 write(path.join(r,'codex'),'old',0o700);assert.equal(resolveCli(r),path.join(r,'codex'));
 write(path.join(r,'codex-cli/bin/codex'),'current',0o700);assert.equal(resolveCli(r),path.join(r,'codex-cli/bin/codex'));
 write(path.join(r,'codex-cli/codex-package.json'),JSON.stringify({entrypoint:'custom/engine'}));
 write(path.join(r,'codex-cli/custom/engine'),'manifest',0o700);assert.equal(resolveCli(r),path.join(r,'codex-cli/custom/engine'));
 write(path.join(r,'codex-cli/codex-package.json'),JSON.stringify({entrypoint:'../codex'}));
 assert.equal(resolveCli(r),path.join(r,'codex-cli/bin/codex'),'manifest cannot escape its package');
});
test('a missing plugin cache is repaired from the matching bundled release without replacing existing files',t=>{
 const r=fixture(t),resources=path.join(r,'Resources'),home=path.join(r,'home');
 const bundle=path.join(resources,'plugins/openai-bundled/plugins/browser');
 const manifest=path.join(bundle,'.codex-plugin/plugin.json');
 write(manifest,JSON.stringify({name:'browser',version:'26.930.41038'}));
 write(path.join(bundle,'scripts/browser-service.mjs'),'current-service');
 ensureBrowserCache(resources,home);
 const cached=path.join(home,'plugins/cache/openai-bundled/browser/26.930.41038/scripts/browser-service.mjs');
 assert.equal(fs.readFileSync(cached,'utf8'),'current-service');
 fs.writeFileSync(cached,'existing');ensureBrowserCache(resources,home);assert.equal(fs.readFileSync(cached,'utf8'),'existing');
 write(manifest,JSON.stringify({name:'browser',version:'26.931.1'}));ensureBrowserCache(resources,home);
 assert.equal(fs.readFileSync(cached.replace('26.930.41038','26.931.1'),'utf8'),'current-service');
 write(manifest,JSON.stringify({name:'browser',version:'../../escape'}));ensureBrowserCache(resources,home);
 assert.equal(fs.existsSync(path.join(home,'plugins/cache/escape')),false);
});
