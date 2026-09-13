import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The copied desktop optimistically publishes ownership before thread/resume.
// With a second backend this can make the real writer follow a client whose
// resume subsequently fails. Keep the existing post-resume ownership claim.
export function patchOwnership(text) {
  const pattern=/if\((\w+)=(\w+)\.getStreamRole\((\w+)\)==null,\1&&\2\.setConversationStreamRole\(\3,\{role:`owner`\}\),!(\w+)\(\)\)/g;
  const matches=[...text.matchAll(pattern)];
  if(matches.length!==1)throw Error(`Ownership patch expected one optimistic claim, found ${matches.length}`);
  return text.replace(pattern,(_match,acquired,manager,thread,current)=>
    `if(${acquired}=${manager}.getStreamRole(${thread})==null,!${current}())`);
}

export function patchOwnerFollowing(text) {
  const bridge=/ipcBridge:(\w+)=\{setThreadOwnership:(\w+)=>(\w+)\.clientCoordination/;
  const resume=/let (\w+)=(\w+);US\(\2\);let (\w+)=(\w+)\.useTailHydration\(\)/;
  if([...text.matchAll(new RegExp(bridge.source,'g'))].length!==1 || [...text.matchAll(new RegExp(resume.source,'g'))].length!==1)throw Error('Owner attachment patch does not match this desktop build');
  text=text.replace(bridge,(_match,bridgeName,arg,host)=>`ipcBridge:${bridgeName}={findThreadOwner:params=>${host}.clientCoordination.findThreadOwner(params),setThreadOwnership:${arg}=>${host}.clientCoordination`);
  // The exact-build function uses c for conversationId and a for its generation guard.
  return text.replace(resume,(_match,initial,state,tail,manager)=>`await window.__ELECTRON_SHIM__.followExistingOwner(${manager},c,a);if(!a())return{status:\`not-ready\`,reason:\`canceled\`};let ${initial}=${state};US(${state});let ${tail}=${manager}.useTailHydration()`);
}

export function patchConflictRecovery(text) {
  if(text.includes('try{await window.__ELECTRON_SHIM__.followExistingOwner(e,c,a)}catch{}'))throw Error('Writer conflict recovery is already patched');
  const catchStart='}catch(t){if(!a()||(H&&e.getStreamRole(c)?.role===`owner`&&e.setConversationStreamRole(c,null),!a())';
  if(text.split(catchStart).length!==2)throw Error('Writer conflict recovery does not match this desktop build');
  return text.replace(catchStart,'}catch(t){if(Dun(t)&&a()){try{await window.__ELECTRON_SHIM__.followExistingOwner(e,c,a)}catch{}if(a()&&e.getStreamRole(c)?.role===`follower`){O&&e.releaseResumeNotificationBuffer(c);e.updateConversationState(c,s=>{s.resumeState=`resumed`});k?.finish();return{status:`ready`}}}if(!a()||(H&&e.getStreamRole(c)?.role===`owner`&&e.setConversationStreamRole(c,null),!a())');
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const assets=path.resolve(import.meta.dirname,'../scratch/asar/webview/assets');
  const files=fs.readdirSync(assets).filter(f=>/^app-initial-.*\.js$/.test(f));
  if(files.length!==1)throw Error('Expected one current renderer bundle');
  const file=path.join(assets,files[0]);
  const source=fs.readFileSync(file,'utf8');
  const updated=process.argv.includes('--recovery-only')?patchConflictRecovery(source):process.argv.includes('--following-only')?patchConflictRecovery(patchOwnerFollowing(source)):patchConflictRecovery(patchOwnerFollowing(patchOwnership(source)));
  fs.writeFileSync(file+'.remote-next',updated);
  fs.renameSync(file+'.remote-next',file);
  console.log('Deferred viewer ownership until successful resume; native app unchanged.');
}
