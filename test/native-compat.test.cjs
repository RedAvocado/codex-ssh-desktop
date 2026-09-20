const {test} = require('node:test');
const assert = require('node:assert/strict');
const {adaptNativeAddon} = require('../src/server/native-compat.js');

test('headless icon requests do not enter AppKit, while Computer Use stays available', async () => {
  let serviceCalls = 0;
  const addon = {
    iconSmallForAppPath() { throw Error('Would deadlock the worker pool'); },
    iconMediumForAppPath() { throw Error('Would deadlock the worker pool'); },
    spawnComputerUseService: () => ++serviceCalls,
    computerUseServiceProcessMatchesExecutablePath: () => true,
  };
  const safe = adaptNativeAddon('/Applications/ChatGPT.app/Contents/Resources/native/sky.node', addon);
  assert.deepEqual(await Promise.all(Array.from({length: 20}, () => safe.iconSmallForAppPath('/Applications/Google Chrome.app'))), Array(20).fill(null));
  assert.equal(await safe.iconMediumForAppPath('/Applications/Google Chrome.app'), null);
  assert.equal(safe.spawnComputerUseService(), 1);
  assert.equal(safe.computerUseServiceProcessMatchesExecutablePath(), true);
  assert.equal(adaptNativeAddon('/native/sky.node', addon), safe);
  assert.equal(adaptNativeAddon('/native/unrelated.node', addon), addon);
});

test('renderer uses the shipped web menus without dropping other plugin APIs', () => {
  const ts = require('typescript');
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/browser/capabilities.ts'), 'utf8');
  const module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: module.exports});
  const api = {showContextMenu() {}, sendMessageFromView() {}, getSharedObjectSnapshotValue() {}};
  const safe = module.exports.browserCapabilities('electronBridge', api);
  assert.equal(safe.showContextMenu, undefined);
  assert.equal(safe.sendMessageFromView, api.sendMessageFromView);
  assert.equal(safe.getSharedObjectSnapshotValue, api.getSharedObjectSnapshotValue);
  assert.equal(module.exports.browserCapabilities('other', api), api);
});
