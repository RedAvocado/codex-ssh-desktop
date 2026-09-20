// AppKit icon rendering dispatches synchronously to the macOS main queue.
// This host runs Node, not NSApplication, so those jobs never complete and
// eventually exhaust libuv's filesystem/DNS worker pool. Icons are optional;
// keep the actual Computer Use service and browser methods on the native addon.
const adapted = new WeakMap<object, object>();
export function adaptNativeAddon(request: string, addon: unknown): unknown {
  if (!/(?:^|\/)sky\.node$/.test(request) || !addon || typeof addon !== 'object') return addon;
  let result = adapted.get(addon);
  if (!result) {
    result = {...addon, iconSmallForAppPath: async () => null, iconMediumForAppPath: async () => null};
    adapted.set(addon, result);
  }
  return result;
}
