export function browserCapabilities(key: string, api: unknown): unknown {
  if (key !== 'electronBridge' || !api || typeof api !== 'object') return api;
  // Codex provides its own accessible menu when the native API is absent.
  // Advertising the headless host's no-op Menu.popup leaves its promise pending
  // forever, preventing pin, rename, section, and plugin menu actions.
  const {showContextMenu: _nativeMenu, ...supported} = api as Record<string, unknown>;
  return supported;
}
