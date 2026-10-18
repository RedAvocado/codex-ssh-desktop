import {createHash} from 'node:crypto';

export function patchViewerThreadRelease(source, {preparedVersion, asset}) {
  if (preparedVersion !== '26.911.61220' || asset !== 'main-DS3FMq4P.js')
    throw Error('Viewer thread release supports only prepared desktop 26.911.61220');
  if (createHash('sha256').update(source).digest('hex') !== 'accbb81ebd93a2c78ef38e564972d3266ed02987240ac0a7d80f9d4a75a992f1')
    throw Error('Viewer thread release input SHA-256 mismatch');
  const hook = 'setWindowContext:e=>{z=e;globalThis.__codexElectronIpcBridge?.setRendererWindowFactory(()=>B.createPrimaryWindow({show:!1}));';
  const config = 'getConfigOverrides:async()=>[...await wre(e)]';
  if (source.split(hook).length !== 2 || source.split(config).length !== 2)
    throw Error('Viewer thread release exact hooks drifted');
  return source.replace(hook, hook + 'globalThis.__codexElectronIpcBridge?.setViewerThreadClient?.(e.getLocalAppServerClient());')
    // Only the auxiliary local engine: no user config or native app mutation.
    .replace(config, 'getConfigOverrides:async()=>[...await wre(e),...e.hostConfig.id===`local`?[`thread_unload_delay_secs=0`]:[]]');
}
