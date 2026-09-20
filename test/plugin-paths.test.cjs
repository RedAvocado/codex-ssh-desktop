const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {resolveBrowserServicePath} = require('../src/server/plugin-paths.js');

test('Browser sessions follow the installed plugin after the desktop UI becomes stale', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-plugin-paths-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const resources = path.join(root,'Resources');
  const manifest = path.join(resources,'plugins/openai-bundled/plugins/browser/.codex-plugin/plugin.json');
  fs.mkdirSync(path.dirname(manifest),{recursive:true});
  fs.writeFileSync(manifest, JSON.stringify({name:'browser',version:'26.915.31945'}));
  const cache = path.join(root,'plugins/cache/openai-bundled/browser');
  const expected = path.join(cache,'26.903.61454/scripts/browser-service.mjs');
  const installed = path.join(cache,'26.915.31945/scripts/browser-service.mjs');
  assert.throws(() => resolveBrowserServicePath(expected, resources), /missing its service/);
  fs.mkdirSync(path.dirname(installed),{recursive:true});
  fs.writeFileSync(installed,'export {};');
  assert.equal(resolveBrowserServicePath(expected,resources),installed);
  assert.equal(resolveBrowserServicePath(installed,resources),installed);
  const previousResources = process.resourcesPath;
  const previousOverride = process.env.CODEX_REMOTE_DESKTOP_RESOURCES;
  try {
    process.resourcesPath = resources;
    delete process.env.CODEX_REMOTE_DESKTOP_RESOURCES;
    assert.equal(resolveBrowserServicePath(expected), installed, 'legacy hosts use their Electron resources path');
  } finally {
    if (previousResources === undefined) delete process.resourcesPath; else process.resourcesPath = previousResources;
    if (previousOverride === undefined) delete process.env.CODEX_REMOTE_DESKTOP_RESOURCES; else process.env.CODEX_REMOTE_DESKTOP_RESOURCES = previousOverride;
  }
  assert.equal(fs.existsSync(path.join(cache,'26.903.61454')),false,'does not fabricate an obsolete plugin version');
  assert.equal(resolveBrowserServicePath('/unrelated/scripts/browser-service.mjs',resources),'/unrelated/scripts/browser-service.mjs');
});

test('desktop patch targets only the Browser service configuration', async () => {
  const {patchBrowserServicePath}=await import('../desktop/plugin-path-patch.mjs');
  const expression='`${n.Xa({codexHome:t,localVersion:e,marketplaceName:r,pluginName:n.tc})}/scripts/browser-service.mjs`';
  const fixture=`const service=${expression};`;
  assert.equal(patchBrowserServicePath(fixture),`const service=globalThis.__codexResolveBrowserService(${expression});`);
  assert.throws(()=>patchBrowserServicePath('different bundle'),/expected one/);
  assert.throws(()=>patchBrowserServicePath(fixture+fixture),/expected one/);
});
