import {createHash} from 'node:crypto';

export function patchViewerBackgroundOwner(source, {preparedVersion, asset}) {
  if (preparedVersion !== '26.911.61220' || asset !== 'main-DS3FMq4P.js')
    throw Error('Background ownership supports only prepared desktop 26.911.61220');
  if (createHash('sha256').update(source).digest('hex') !== 'cafd6ffabd77d87dd0bdb4a2c403b79c825176eb366f8c57512a6af1e39fcc5e')
    throw Error('Background ownership input SHA-256 mismatch');
  const hook = 'f=m,e.threadExecution!=null&&(u?.bind(m),d.bind(m)),p=';
  if (source.split(hook).length !== 2) throw Error('Background ownership hook drifted');
  return source.replace(hook, 'f=m,e.hostId===`local`&&u!=null&&globalThis.__codexElectronIpcBridge?.registerViewerBackgroundOwner?.({manager:m,client:t,bindOwner:()=>{u.bind(m);return()=>{u.removeThreadOwner?.();u.removeThreadOwner=null}}}),e.threadExecution!=null&&(u?.bind(m),d.bind(m)),p=');
}
