import fs from 'node:fs';
import path from 'node:path';

// The copied desktop UI can be older than the installed engine and plugins.
// Use the installed Browser plugin's manifest version, never the UI version,
// when configuring a new browser tool session after an app update.
export function resolveBrowserServicePath(expected: string, resources = process.env.CODEX_REMOTE_DESKTOP_RESOURCES ?? (process as NodeJS.Process & {resourcesPath?: string}).resourcesPath): string {
  if (!resources) return expected;
  const pluginRoot = path.dirname(path.dirname(path.dirname(expected)));
  if (path.basename(pluginRoot) !== 'browser' || path.basename(path.dirname(path.dirname(pluginRoot))) !== 'cache') return expected;
  const marketplace = path.basename(path.dirname(pluginRoot));
  const manifestPath = path.join(resources, 'plugins', marketplace, 'plugins', 'browser', '.codex-plugin', 'plugin.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return expected; }
  if (manifest.name !== 'browser' || typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){2,3}$/.test(manifest.version)) return expected;
  const current = path.join(pluginRoot, manifest.version, 'scripts', 'browser-service.mjs');
  if (!fs.existsSync(current)) throw new Error('The installed Browser plugin is missing its service. Reopen Codex Plugins to refresh the installed plugin.');
  return current;
}
