const fs=require('node:fs'),path=require('node:path');

function resolveCli(resources){
  const root=path.join(resources,'codex-cli');
  let entry;
  try{const manifest=JSON.parse(fs.readFileSync(path.join(root,'codex-package.json'),'utf8'));
    if(typeof manifest.entrypoint==='string'){
      const target=path.resolve(root,manifest.entrypoint);
      if(target.startsWith(root+path.sep))entry=target;
    }
  }catch{}
  for(const file of [entry,path.join(root,'bin/codex'),path.join(resources,'codex')].filter(Boolean)){
    try{if(fs.statSync(file).isFile()){fs.accessSync(file,fs.constants.X_OK);return file;}}catch{}
  }
  throw Error('The installed Codex command-line engine could not be found.');
}

// Keep an already-running legacy bridge usable after the app changes its
// bundled plugin version. Never overwrite an existing plugin or restart tasks.
function ensureBrowserCache(resources,codexHome){
  const source=path.join(resources,'plugins/openai-bundled/plugins/browser');
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(path.join(source,'.codex-plugin/plugin.json'),'utf8'));}catch{return;}
  if(manifest.name!=='browser'||!/^\d+(?:\.\d+){2,3}$/.test(manifest.version??''))return;
  if(!fs.existsSync(path.join(source,'scripts/browser-service.mjs')))return;
  const target=path.join(codexHome,'plugins/cache/openai-bundled/browser',manifest.version);
  if(fs.existsSync(target))return;
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const staging=fs.mkdtempSync(path.join(path.dirname(target),'.viewer-refresh-'));
  try{
    fs.cpSync(source,staging,{recursive:true});
    try{fs.renameSync(staging,target);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;}
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
module.exports={resolveCli,ensureBrowserCache};
