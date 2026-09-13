import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function patchGoalResume(text) {
  const pattern=/async function (\w+)\((\w+),(\w+),\{status:(\w+),threadSettings:(\w+)\}\)\{(.*?)return \2\.updateConversationState\(\3,(\w+)=>\{\7\.threadGoal=(\w+),\7\.threadGoalResumeConfirmation=null\}\),\8\}/g;
  const matches=[...text.matchAll(pattern)];
  if(matches.length!==1)throw Error(`Goal status patch expected one function, found ${matches.length}`);
  return text.replace(pattern,(_match,name,manager,thread,status,settings,body,state,goal)=>
    `async function ${name}(${manager},${thread},{status:${status},threadSettings:${settings}}){${body}${manager}.updateConversationState(${thread},${state}=>{${state}.threadGoal=${goal},${state}.threadGoalResumeConfirmation=null});await window.__ELECTRON_SHIM__.resumeFollowerGoal(${manager},${thread},${status});return ${goal}}`);
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const assets=path.resolve(import.meta.dirname,'../scratch/asar/webview/assets');
  const files=fs.readdirSync(assets).filter(f=>/^app-initial-.*\.js$/.test(f));
  if(files.length!==1)throw Error('Expected one current renderer bundle');
  const file=path.join(assets,files[0]);
  const source=fs.readFileSync(file,'utf8');
  const updated=patchGoalResume(source);
  fs.writeFileSync(file+'.remote-next',updated);
  fs.renameSync(file+'.remote-next',file);
  console.log('Patched only viewer goal-resume routing; native desktop unchanged.');
}
