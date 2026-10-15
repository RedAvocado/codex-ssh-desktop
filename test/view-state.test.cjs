const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {restorePage,rememberPage}=require('../viewer/view-state.cjs');
test('the last chat is restored per host without retaining external addresses or query secrets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'viewer-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(restorePage(dir,'one'),'/');
 rememberPage(dir,'one','http://127.0.0.1:18214/thread/test-id?token=private');
 rememberPage(dir,'two','http://127.0.0.1:18214/thread/another');
 rememberPage(dir,'one','https://example.com/thread/wrong');
 assert.equal(restorePage(dir,'one'),'/thread/test-id');assert.equal(restorePage(dir,'two'),'/thread/another');
 assert.ok(!fs.readFileSync(path.join(dir,'last-pages.json'),'utf8').includes('private'));
 fs.writeFileSync(path.join(dir,'last-pages.json'),'null');assert.equal(restorePage(dir,'one'),'/','corrupt saved state cannot block a connection');
});
