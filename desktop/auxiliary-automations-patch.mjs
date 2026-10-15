import {createHash} from 'node:crypto';

// This viewer copies a desktop renderer, but it is not the user's scheduler.
// Running its own scheduler and selecting heartbeat thread targets causes
// duplicate scheduled work and eager thread hydration on a home-page visit.
const version='26.911.61220';
const mainAsset='main-DS3FMq4P.js';
const rendererAsset='app-initial-b21bd554b363.js';
const mainInputHash='15d79f5668ee2725249298cc51b33ba631ee1e5acb5e54bb9266f182d08ff85c';
const rendererInputHash='bb7b3bef237220212ec657aad1cbfb150f51a04b9902042cac5c7c1a02983d8e';

const schedulerStart='start:()=>{if(!(g||h)){g=!0;try{n.ii()&&t.getConnection(c.hostConfig.id).notifyAutomationRunsUpdated()}catch(e){ks().warning(`Failed to settle interrupted automation runs`,{safe:{},sensitive:{error:e}})}n.Or(Date.now()),E(),y=setInterval(E,p),y.unref()}},';
const schedulerStopped='start:()=>{},';
const heartbeatTargets='function tcs(e){return e==null?[]:Array.from(new Set(e.flatMap(e=>!Vm(e)||e.status!==`ACTIVE`||!rot(e.targetThreadId)?[]:[Xm(e.targetThreadId)])))}';
const noHeartbeatTargets='function tcs(e){return []}';

function exactReplace(source,{preparedVersion,asset,expectedAsset,expectedHash,original,replacement,label}) {
  if(preparedVersion!==version || asset!==expectedAsset)
    throw Error(`${label} supports only prepared desktop ${version} asset ${expectedAsset}`);
  const digest=createHash('sha256').update(source).digest('hex');
  if(digest!==expectedHash)throw Error(`${label} input SHA-256 mismatch; refusing to patch an unreviewed bundle`);
  const count=source.split(original).length-1;
  if(count!==1)throw Error(`${label} expected one exact hook, found ${count}`);
  return source.replace(original,replacement);
}

export function patchAuxiliaryAutomationScheduler(source,{preparedVersion,asset}) {
  return exactReplace(source,{preparedVersion,asset,expectedAsset:mainAsset,expectedHash:mainInputHash,
    original:schedulerStart,replacement:schedulerStopped,label:'Auxiliary automation scheduler'});
}

export function patchAuxiliaryAutomationRenderer(source,{preparedVersion,asset}) {
  return exactReplace(source,{preparedVersion,asset,expectedAsset:rendererAsset,expectedHash:rendererInputHash,
    original:heartbeatTargets,replacement:noHeartbeatTargets,label:'Auxiliary heartbeat resume'});
}
