import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {extractFile} from '@electron/asar';
import {resumeFollowerGoal} from '../src/browser/goal-resume.ts';
import {patchGoalResume} from './goal-resume-patch.mjs';

const assets=path.resolve(import.meta.dirname,'../scratch/asar/webview/assets');
const file=fs.readdirSync(assets).find(f=>/^app-initial-.*\.js$/.test(f));
assert.ok(file);
const app=JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'build-info.json'),'utf8')).app;
const source=extractFile(path.join(app,'Contents/Resources/app.asar'),`webview/assets/${file}`).toString();
const patched=patchGoalResume(source);
const goalMatch=patched.match(/async function (\w+)\((\w+),(\w+),\{status:(\w+),threadSettings:(\w+)\}\)\{.*?await window\.__ELECTRON_SHIM__\.resumeFollowerGoal\(.*?\);return \w+\}/);
assert.ok(goalMatch,'Patched goal handler is present');
const setStatus=new Function('window',`${goalMatch[0]};return ${goalMatch[1]}`)({__ELECTRON_SHIM__:{resumeFollowerGoal}});
const emptyMatch=source.match(/async function (\w+)\(\{conversationId:\w+,manager:\w+,options:\w+,resumeConversation:\w+,startTurn:\w+,turnMergePolicy:\w+\}\)\{.*?input:\w+\.continuationInput\?\?\[\],additionalContext:\w+\.additionalContext\}\}\)\}/);
assert.ok(emptyMatch,'Native guarded empty-turn helper is present');
const emptyTurn=new Function('RC','qun','BS',`${emptyMatch[0]};return ${emptyMatch[1]}`)(Error,{default:(items,predicate)=>items.findLast(predicate)},state=>state.turns);

async function scenario({role='follower',runtime='idle',turn='completed',status='active',fail=false,settings}={}) {
 const events=[];
 const state={threadRuntimeStatus:{type:runtime},turns:[{turnId:'existing',status:turn}]};
 const manager={
  getStreamRole:()=>({role}),getConversation:()=>state,getConversationCwd:()=>'/tmp',
  waitForPendingThreadSettingsUpdate:async()=>events.push('wait-settings'),
  updateThreadSettingsForNextTurn:async(_id,s)=>{assert.equal(s,settings);events.push('apply-settings')},
  sendRequest:async(method,params)=>{assert.equal(method,'thread/goal/set');assert.equal(params.status,status);events.push('save-goal');return{goal:{status}}},
  updateConversationState:(_id,update)=>{update(state);events.push('publish-goal')},
  startEmptyTurn:async(id,options)=>{
   if(fail)throw Error('Owner unreachable');
   await emptyTurn({conversationId:id,manager,options,resumeConversation:async()=>({status:'ready'}),startTurn:async operation=>{assert.deepEqual(operation.request.input,[]);assert.equal(operation.request.threadId,'test-thread');events.push('start-owner-turn')},turnMergePolicy:{}});
  },
 };
 const action=setStatus(manager,'test-thread',{status,threadSettings:settings});
 if(fail){await assert.rejects(action,/Owner unreachable/);return events;}
 const goal=await action;assert.equal(goal.status,status);return events;
}

assert.deepEqual(await scenario(),['wait-settings','save-goal','publish-goal','start-owner-turn']);
assert.ok(!(await scenario({runtime:'active',turn:'inProgress'})).includes('start-owner-turn'),'Running work is not duplicated');
assert.ok(!(await scenario({runtime:'unknown',turn:'inProgress'})).includes('start-owner-turn'),'An in-progress turn blocks another start');
assert.ok(!(await scenario({role:'owner'})).includes('start-owner-turn'),'The local scheduler remains responsible for owned goals');
assert.ok(!(await scenario({status:'paused'})).includes('start-owner-turn'),'Pausing never starts a turn');
assert.equal((await scenario({settings:{model:'preserved'}}))[0],'apply-settings');
await scenario({fail:true});
console.log('Goal resume checks passed: idle follower, active task guard, pending task guard, owned goal, pause, settings, and owner failure.');
