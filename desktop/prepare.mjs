import fs from 'node:fs';
import path from 'node:path';
import {extractAll,extractFile} from '@electron/asar';
import {patchGoalResume} from './goal-resume-patch.mjs';
import {patchOwnership,patchOwnerFollowing,patchConflictRecovery} from './ownership-patch.mjs';

const root = path.resolve(import.meta.dirname, '..');
const app = process.argv[2] || ['/Applications/ChatGPT.app','/Applications/Codex.app'].find(p=>fs.existsSync(path.join(p,'Contents/Resources/app.asar')));
if(!app)throw Error('Pass the installed macOS Codex application path.');
const archive=path.join(app,'Contents/Resources/app.asar');
const installed=JSON.parse(extractFile(archive,'package.json').toString());
if(installed.version!=='26.903.61454')throw Error(`Desktop ${installed.version} is not yet supported by these patches. Expected 26.903.61454. No installed app or existing runtime files were changed.`);
const pidFile=path.join(root,'runtime/server.pid');
if(fs.existsSync(pidFile)){
 const pid=Number(fs.readFileSync(pidFile,'utf8'));
 try{process.kill(pid,0);throw Error('The auxiliary runtime is running. Finish its work and stop it explicitly before preparing a new build.');}catch(error){if(error.code!=='ESRCH')throw error;}
}
const finalOut=path.join(root,'scratch/asar');
if(fs.existsSync(finalOut)&&!fs.existsSync(path.join(finalOut,'.remote-extracted')))throw Error('Refusing to replace an unowned extraction');
const out=path.join(root,`scratch/prepare-${process.pid}`);
fs.mkdirSync(path.dirname(out), {recursive:true});
extractAll(archive,out);
fs.writeFileSync(path.join(out,'.remote-extracted'),app);
const build = path.join(out,'.vite/build');
const mainFile = fs.readdirSync(build).filter(f=>/^main-.*\.js$/.test(f));
if(mainFile.length!==1) throw Error('Expected one desktop main bundle');
const mainPath=path.join(build,mainFile[0]);
let main=fs.readFileSync(mainPath,'utf8');
function replaceOne(text,pattern,replacement,label) {
  const hits=[...text.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
  if(hits.length!==1)throw Error(`${label}: expected 1 match, found ${hits.length}`);
  return text.replace(pattern,replacement);
}
main=replaceOne(main,/setWindowContext:(\w+)=>\{(\w+)=\1;for\(let (\w+) of (\w+)\.BrowserWindow\.getAllWindows\(\)\)\3\.isDestroyed\(\)\|\|!(\w+)\.isAppServiceWindow\(\3\)\|\|\1\.registerWindow\(\3\)\}/,
  (_,arg,context,item,electron,manager)=>`setWindowContext:${arg}=>{${context}=${arg};globalThis.__codexElectronIpcBridge?.setRendererWindowFactory(()=>${manager}.createPrimaryWindow({show:!1}));for(let ${item} of ${electron}.BrowserWindow.getAllWindows())${item}.isDestroyed()||!${manager}.isAppServiceWindow(${item})||${arg}.registerWindow(${item})}`,'register browser views');
main=replaceOne(main,/async whenReady\(\)\{if\(this\.startupReady!=null\)\{.*?throw new DOMException\(`Primary renderer was replaced`,`AbortError`\)\}/,
  'async whenReady(){if(this.startupReady!=null){let e=Promise.withResolvers(),t=()=>e.reject(new DOMException(`Renderer was destroyed`,`AbortError`));this.origin.once(`destroyed`,t);try{await Promise.race([this.startupReady,e.promise])}finally{this.origin.off(`destroyed`,t)}}if(this.isDisposed||this.origin.isDestroyed())throw new DOMException(`Renderer was destroyed`,`AbortError`)}','independent view lifecycle');
main=replaceOne(main,/encodingLevel=`structuredClonable`/,'encodingLevel=`jsonCompatible`','host port encoding');
fs.writeFileSync(mainPath,main);

const htmlPath=path.join(out,'webview/index.html');
let html=fs.readFileSync(htmlPath,'utf8');
html=replaceOne(html,/<!-- PROD_BASE_TAG_HERE -->/,'<base href="/" />','base URL');
html=replaceOne(html,/<!-- PROD_CSP_TAG_HERE -->/,'<script type="module" src="./assets/preload.js"></script>','browser preload');
// Preserve the shipped CSP; permit only the loopback viewer WebSocket.
html=replaceOne(html,/connect-src &#39;self&#39;/,'connect-src &#39;self&#39; ws://127.0.0.1:18214','SSH websocket CSP');
html=html.replace('<title>ChatGPT</title>','<title>Codex SSH Desktop</title>');
fs.writeFileSync(htmlPath,html);
let patchedRenderer=0;
for(const file of fs.readdirSync(path.join(out,'webview/assets'))){
 if(!/^app-initial-.*\.js$/.test(file))continue;
 const filePath=path.join(out,'webview/assets',file);
 let text=fs.readFileSync(filePath,'utf8');
 if(!text.includes('encodingLevel=`structuredClonable`'))continue;
 text=replaceOne(text,/encodingLevel=`structuredClonable`/,'encodingLevel=`jsonCompatible`','viewer port encoding');
 text=replaceOne(text,/(\w+)\.current\?\?=(\w+)\(\{initialEntries:(\w+),initialIndex:(\w+),v5Compat:!0\}\)/,
  (_,ref,create,entries,index)=>`${ref}.current??=${create}({initialEntries:${entries}??[window.__ELECTRON_SHIM__.initialRoute],initialIndex:${index},v5Compat:!0})`,'restore viewer route');
 text=replaceOne(text,/(\w+\.current\?\?=\w+\(\{initialEntries:[^}]+,v5Compat:!0\}\);.{0,250}\.useCallback\()(\w+)=>\{/,
  (_,prefix,event)=>`${prefix}${event}=>{window.__ELECTRON_SHIM__.onMemoryNavigationChanged?.(${event});`,'remember viewer navigation');
 const filePrefix=text.match(/(\w+)=`app:\/\/fs`/);
 if(!filePrefix)throw Error('Desktop file preview prefix not found');
 const fileReturn=new RegExp('return`\\$\\{'+filePrefix[1]+'\\}\\$\\{(\\w+)\\((\\w+)\\)\\}`');
 text=replaceOne(text,fileReturn,(_,fn,arg)=>`return ${fn}(${arg})`,'remote file previews');
 text=patchGoalResume(text);
 text=patchOwnership(text);
 text=patchOwnerFollowing(text);
 text=patchConflictRecovery(text);
 fs.writeFileSync(filePath,text);patchedRenderer++;
}
if(patchedRenderer!==1)throw Error(`Expected one renderer; found ${patchedRenderer}`);
// Native SQLite must match this independent Node runtime.
fs.rmSync(path.join(out,'node_modules/better-sqlite3'),{recursive:true,force:true});
const version=JSON.parse(fs.readFileSync(path.join(out,'package.json'),'utf8')).version;
const backup=path.join(root,`scratch/previous-${process.pid}`);
if(fs.existsSync(finalOut))fs.renameSync(finalOut,backup);
try{fs.renameSync(out,finalOut)}catch(error){if(fs.existsSync(backup))fs.renameSync(backup,finalOut);throw error;}
fs.writeFileSync(path.join(root,'desktop/build-info.json'),JSON.stringify({app,version,main:mainFile[0],preparedAt:new Date().toISOString()},null,2));
if(fs.existsSync(backup))fs.rmSync(backup,{recursive:true});
console.log(`Prepared desktop ${version} from ${app}; authentication and platform checks preserved.`);
