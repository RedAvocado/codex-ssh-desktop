// The copied desktop inherits the native app's Remote setting. The private
// viewer uses its own app-server over Tailscale, so keep OpenAI Remote disabled
// in this auxiliary process even when it is enabled in the native desktop.
export function patchPrivateRemoteControl(source) {
  const replacements = [
    [
      'let t=n.ut();t!=null&&this.sharedObjectRepository.set(`local_remote_control_enabled`,t)',
      'let t=!1;this.sharedObjectRepository.set(`local_remote_control_enabled`,t)',
      'initial Remote state',
    ],
    [
      '"set-local-remote-control-enabled":async({enabled:e})=>{let t=n.dt({enabled:e});return this.sharedObjectRepository?.set(`local_remote_control_enabled`,t),{enabled:t}}',
      '"set-local-remote-control-enabled":async()=>{this.sharedObjectRepository?.set(`local_remote_control_enabled`,!1);return{enabled:!1}}',
      'Remote setting handler',
    ],
    [
      't.remoteControlEnabled&&await e.sendAppServerRequest(`remoteControl/enable`,null),',
      '',
      'app-server restart Remote re-enable',
    ],
  ];
  for (const [original, replacement, label] of replacements) {
    const count = source.split(original).length - 1;
    if (count !== 1) throw Error(`Private Remote patch expected one ${label}, found ${count}`);
    source = source.replace(original, replacement);
  }
  return source;
}
