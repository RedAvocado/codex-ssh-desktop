const {test}=require('node:test'),assert=require('node:assert/strict');
const {BrowserWindow,dialog}=require('../src/server/electron/index.js');
test('headless confirmations cannot silently select a destructive first button',async()=>{
 assert.equal((await dialog.showMessageBox({buttons:['Delete','Cancel'],cancelId:1})).response,1);
 await assert.rejects(dialog.showMessageBox({buttons:['Delete','Keep']}),/confirmation.*remote computer/i);
 await assert.rejects(dialog.showMessageBox({buttons:['Delete'],cancelId:4}),/confirmation.*remote computer/i);
});
test('window close respects cancellation and once listeners can be removed by their original function',t=>{
 const window=new BrowserWindow();t.after(()=>window.destroy());let removedCalls=0;
 const removed=()=>removedCalls++;window.webContents.once('destroyed',removed);window.webContents.off('destroyed',removed);
 const cancel=event=>event.preventDefault();window.on('close',cancel);window.close();assert.equal(window.isDestroyed(),false);
 window.off('close',cancel);window.close();assert.equal(window.isDestroyed(),true);assert.equal(removedCalls,0);
});
test('listeners added during dispatch start on the next event',t=>{
 const window=new BrowserWindow();t.after(()=>window.destroy());const events=[];
 window.webContents.on('fixture',()=>{events.push('first');window.webContents.on('fixture',()=>events.push('late'))});
 window.webContents.emit('fixture');assert.deepEqual(events,['first']);
 window.webContents.emit('fixture');assert.deepEqual(events,['first','first','late']);
});
