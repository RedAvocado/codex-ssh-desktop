import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Exercise the copied coordinator with synthetic messages only. No app views,
// real task queues, shared state files, or running engines are modified.
const assets=path.resolve(import.meta.dirname,'../scratch/asar/webview/assets');
const file=fs.readdirSync(assets).find(f=>/^app-initial-.*\.js$/.test(f));
const source=fs.readFileSync(path.join(assets,file),'utf8');
const start=source.indexOf('Sfn=class extends Rx');
const end=source.indexOf('));function wfn(',start);
assert.ok(start>=0&&end>start,'Exact copied queue coordinator located');
const code=source.slice(start+'Sfn='.length,end-1);
const Coordinator=new Function('Rx','xfn','bfn','Fg',`return (${code})`)(class{},[],()=>{},x=>x);
const makeMessage=id=>({id,text:'Synthetic queue test',context:{},createdAt:0});
const ids=c=>c.read('test-thread').messages.map(m=>m.id);

async function scenario({follower=false,fail=false}={}){
  let state={'test-thread':[makeMessage('a'),makeMessage('b')]};
  let broadcasts;
  const role=follower?{role:'follower',ownerClientId:'test-owner'}:{role:'owner'};
  const base={submissionHost:{},canSend:()=>false,logger:{warning(){}},
    storage:{read:()=>({isLoading:false,value:state}),load:async()=>state,
      update:async fn=>{if(fail)throw Error('Synthetic storage failure');state=fn(state)}}};
  const owner=new Coordinator({...base,getStreamRole:()=>({role:'owner'}),
    coordination:{registerBroadcastHandler:()=>()=>{},broadcast:async params=>{broadcasts?.({sourceClientId:'test-owner',params})}}});
  let followerRequests=0;
  const coordinator=new Coordinator({...base,getStreamRole:()=>role,
    coordination:{registerBroadcastHandler:fn=>{broadcasts=fn;return()=>{broadcasts=null}},broadcast:async()=>{}},
    requestFollower:async(_id,next,ownerId)=>{
      assert.equal(ownerId,'test-owner');followerRequests++;
      if(fail)return{resultType:'error',error:'Synthetic owner failure'};
      await owner.acceptFromFollower('test-thread',next['test-thread']);
      return{resultType:'success',result:{ok:true}};
    }});
  try{
    if(fail){await assert.rejects(coordinator.removeQueuedMessage('test-thread','a'),/Synthetic/);assert.deepEqual(ids(coordinator),['a','b']);return;}
    const token=await coordinator.removeQueuedMessage('test-thread','a');
    assert.equal(token.message.id,'a');assert.deepEqual(ids(coordinator),['b']);
    assert.deepEqual(state['test-thread'].map(m=>m.id),['b']);
    await coordinator.restoreQueuedMessage('test-thread',token);
    assert.deepEqual(ids(coordinator),['a','b']);
    await coordinator.removeQueuedMessage('test-thread','a');
    await coordinator.removeQueuedMessage('test-thread','b');
    assert.deepEqual(ids(coordinator),[]);assert.equal(state['test-thread'],undefined);
    assert.equal(await coordinator.removeQueuedMessage('test-thread','missing'),null);
    assert.equal(followerRequests>0,follower);
  }finally{coordinator.dispose();owner.dispose();}
}
await scenario();await scenario({follower:true});await scenario({fail:true});await scenario({follower:true,fail:true});
console.log('Queue deletion checks passed: owner, follower forwarding, empty queue, undo, missing item, and failure rollback.');
