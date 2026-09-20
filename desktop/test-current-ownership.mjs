import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {extractFile} from '@electron/asar';
import {patchOwnership,patchOwnerFollowing,patchConflictRecovery} from './ownership-patch.mjs';
import {followExistingOwner} from '../src/browser/owner-follow.ts';

const probe=path.resolve(import.meta.dirname,'../scratch/compatibility/renderer.js');
const app=fs.existsSync(path.resolve(import.meta.dirname,'build-info.json'))?JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'build-info.json'),'utf8')).app:null;
// Accept an explicit unpatched fixture for the prepared runtime: the installed
// application can auto-update independently while that runtime stays pinned.
const source=process.argv[2]?fs.readFileSync(path.resolve(process.argv[2]),'utf8'):app?extractFile(path.join(app,'Contents/Resources/app.asar'),'webview/assets/app-initial-b21bd554b363.js').toString():fs.readFileSync(probe,'utf8');
const patched=patchConflictRecovery(patchOwnerFollowing(patchOwnership(source)));
assert.throws(()=>patchOwnership(patched),/expected one/,'Refuse unrecognized/already-patched code');
const start=patched.indexOf('async function Sxn(');
const end=patched.indexOf('function ',start+20);
assert.ok(start>=0 && end>start,'Exact shipped resume function located');
const body=patched.slice(start,end).replace(/var \w+=.*$/s,'');

async function scenario({conflict=false,cancel=false,follower=false,original=false,attach=false,lateOwner=false}={}) {
  const events=[];
  let role=follower?{role:'follower',ownerClientId:'native-owner'}:null;
  let current=true;
  const callbacks=new Set();
  const state={id:'thread',cwd:'/tmp',rolloutPath:'/tmp/test',resumeState:'needs_resume',turns:[],shellEnvironmentPolicy:{},requests:[],workspaceKind:'project'};
  const permissions={approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},runtimeWorkspaceRoots:['/tmp']};
  const thread={id:'thread',path:'/tmp/test',cwd:'/tmp',historyMode:'legacy',name:'',turns:[],status:{type:'idle'},sessionId:'session'};
  const response={thread,cwd:'/tmp',model:'test-model',sandbox:permissions.sandboxPolicy,approvalPolicy:permissions.approvalPolicy,runtimeWorkspaceRoots:['/tmp']};
  const logger={info(){},warning(){},debug(){}};
  const manager={
    logger,getConversation:()=>state,getHostId:()=> 'local',getWindowActivity:()=>({canAcquireThreadStream:true}),readShellEnvironmentPolicy:async()=>({}),
    getStreamRole:()=>role,isConversationStreaming:()=>!!role,useTailHydration:()=>false,
    getThreadWorkspaceState:()=>({applied:{cwd:'/tmp',runtimeWorkspaceRoots:['/tmp']}}),
    updateConversationState:(_id,update)=>update(state),readThread:async()=>({thread}),
    ensureRecentConversationId(){},acceptConversationHistory(){},broadcastConversationSnapshot(){events.push('snapshot')},
    setConversationStreamRole:(_id,value)=>{role=value;events.push(value?.role??'released')},
    addStreamRoleStateCallback:callback=>{callbacks.add(callback);return()=>callbacks.delete(callback)},
    streamState:{setConversationFollowing(){}},
    ipcBridge:{
      findThreadOwner:async()=>attach?'native-owner':null,
      threadStreamFollowingChanged:async params=>{
        assert.deepEqual(params.targetClientIds,['native-owner']);
        events.push('received-owner-snapshot');role={role:'follower',ownerClientId:'native-owner'};
        state.resumeState='resumed';
        for(const callback of callbacks)callback('thread');
      },
    },
    sendRequest:async(method)=>{assert.equal(method,'thread/goal/get');return{goal:null}},
  };
  const product={workspace:{projectlessPathSentinel:'projectless',getCwd:({cwd})=>cwd,getSandboxPolicy:({sandboxPolicy})=>sandboxPolicy},
    getRequestOptions:()=>({}),getThreadStartKind:()=>null,history:{mapResumeResponse:()=>[]},
    prepare:async()=>({start:{cwd:'/tmp',runtimeWorkspaceRoots:['/tmp']},preserveServerPermissions:true,
      completeRequest:value=>value,requestOptions:{},getResult:async()=>({model:'test-model'})}),
  };
  const globals={
    Axn:{default:isDeepStrictEqual},
    window:{__ELECTRON_SHIM__:{followExistingOwner}},
    vbn:()=>['/tmp'],Kv:120000,og:'cloud',Gy:()=>({params:{},permissionParamsSource:'inferred'}),Dxn:async()=>[],Txn:()=>'/tmp',Vy:s=>s.turns,
    jb:()=>({createdAt:0,updatedAt:0,recencyAt:0}),Rm:()=>permissions,Lm:()=>permissions,$b:(a,b)=>[...a,...b],
    gbn:value=>value,Exn:()=>['/tmp'],B_n:()=>null,tx:()=>permissions,Zbn:()=>'/tmp',Nb:()=>({}),pb:()=>null,Mb:()=>0,wdn:()=>({}),Fb(){},Cdn:()=>({}),Vhn:()=>false,wxn:()=>['/tmp'],Oxn:()=>'',kxn:()=>'',Ly:(a,b)=>[...a,...b],
    Zy:(s,turns)=>{s.turns=turns},MC:()=>0,PC(){},ben:()=>({}),xen:()=>({}),Lun:()=>'',Run:()=>({}),
    vxn:error=>error.message.includes('active writer'),Tg:error=>error.message,
    bxn:async()=>{
      events.push('backend-resume');
      if(conflict){if(lateOwner){role={role:'follower',ownerClientId:'native-owner'};events.push('late-owner-snapshot');}throw Error('thread already has an active writer');}
      events.push('backend-accepted');
      if(cancel)current=false;
      return response;
    },
  };
  const code=original?source.slice(source.indexOf('async function Sxn('),source.indexOf('function ',source.indexOf('async function Sxn(')+20)):body;
  const resume=new Function(...Object.keys(globals),`${code};return Sxn`)(...Object.values(globals));
  const action=resume({manager,workspace:{load:async()=>false},params:{conversationId:'thread',workspaceRoots:['/tmp'],showThreadGoalResumeConfirmation:true},
    product,historyPolicy:{turnMergePolicy:{}},canAcquireOwnership:()=>true,isCurrentResumeAttempt:()=>current,setHydrationCleanup(){},schedule(){}});
  if(conflict&&!lateOwner){await assert.rejects(action,/active writer/);return{events,role};}
  return{result:await action,events,role};
}

const before=await scenario({conflict:true,original:true});
assert.ok(before.events.indexOf('owner')<before.events.indexOf('backend-resume'),'Reproduced premature ownership in the shipped implementation');
const failure=await scenario({conflict:true});
assert.ok(!failure.events.includes('owner'),'A writer conflict must never publish ownership');
assert.equal(failure.role,null);
const success=await scenario();
assert.equal(success.result.status,'ready');
assert.ok(success.events.indexOf('owner')>success.events.indexOf('backend-accepted'),'Only publish after backend acceptance');
const cancelled=await scenario({cancel:true});
assert.equal(cancelled.result.status,'not-ready');
assert.ok(!cancelled.events.includes('owner'),'A cancelled resume must not claim ownership');
const following=await scenario({follower:true});
assert.equal(following.role.ownerClientId,'native-owner');
assert.ok(!following.events.includes('backend-resume'),'Followers never resume through a second backend');
const attached=await scenario({attach:true});
assert.equal(attached.role.ownerClientId,'native-owner');
assert.equal(attached.result.status,'ready');
assert.ok(!attached.events.includes('backend-resume'),'A discovered owner is attached before a second backend is tried');
const recovered=await scenario({conflict:true,lateOwner:true});
assert.equal(recovered.result.status,'ready','A verified owner snapshot wins over an in-flight second-backend conflict');
assert.equal(recovered.role.ownerClientId,'native-owner');
assert.ok(!recovered.events.includes('owner'));
let removed=false;
await assert.rejects(followExistingOwner({getHostId:()=> 'local',getStreamRole:()=>null,
  addStreamRoleStateCallback:()=>()=>{removed=true},streamState:{setConversationFollowing(){}},
  ipcBridge:{findThreadOwner:async()=> 'native-owner',threadStreamFollowingChanged:async()=>{}},logger:{warning(){}}
},'thread',()=>true,1),/state has not arrived/,'Discovery without a snapshot must not fabricate a follower');
assert.ok(removed,'Timeout removes its listener');
console.log('Ownership checks passed: original race reproduced; conflict, successful resume, cancellation, follower, snapshot attachment, missing snapshot, and patch drift guards.');
