const fs=require('node:fs');
const path=require('node:path');

const defaults=Object.freeze({
  sshHost:'',
  remoteDirectory:'.local/share/codex-ssh-desktop',
  remoteNode:'node',
  remoteControlPath:'desktop/control.cjs',
  sessionCookie:'remote_session',
  proxyUsername:'remote',
});

function validateConfig(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Connection settings must be an object.');
  const config={...defaults};
  for(const key of Object.keys(defaults))if(input[key]!==undefined)config[key]=input[key];
  if(typeof config.sshHost!=='string'||!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(config.sshHost))throw Error('Enter an SSH alias or user@hostname. Configure ports and keys in ~/.ssh/config.');
  for(const key of ['remoteDirectory','remoteNode','remoteControlPath']){
    if(typeof config[key]!=='string'||!config[key].trim()||/[\x00-\x1f\x7f]/.test(config[key]))throw Error(`Invalid ${key}.`);
  }
  if(config.remoteDirectory.startsWith('~'))throw Error('Use a path relative to the remote home directory, or an absolute path.');
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.sessionCookie))throw Error('Invalid session cookie name.');
  if(!/^[A-Za-z0-9_-]+$/.test(config.proxyUsername))throw Error('Invalid proxy username.');
  return config;
}
function quoteShell(value){return "'"+String(value).replaceAll("'","'\\''")+"'";}
function remoteCommand(config,action='ensure'){
  if(!['ensure','status'].includes(action))throw Error('Invalid remote action.');
  const c=validateConfig(config);
  // Relative paths resolve from the SSH login's home directory. Every value is
  // quoted; connection settings are data, never arbitrary shell fragments.
  return `export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; cd ${quoteShell(c.remoteDirectory)} && exec ${quoteShell(c.remoteNode)} ${quoteShell(c.remoteControlPath)} ${action}`;
}
function readConfig(directory){
  const file=path.join(directory,'connection.json');
  if(!fs.existsSync(file))return null;
  return validateConfig(JSON.parse(fs.readFileSync(file,'utf8')));
}
function saveConfig(directory,input){
  const config=validateConfig(input);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'connection.json');
  fs.writeFileSync(file+'.next',JSON.stringify(config,null,2)+'\n',{mode:0o600});
  fs.renameSync(file+'.next',file);
  return config;
}
module.exports={defaults,validateConfig,quoteShell,remoteCommand,readConfig,saveConfig};
