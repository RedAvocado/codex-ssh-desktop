// Isolated Electron integration test. Only our Accounts page and synthetic
// accounts are loaded; no Codex renderer, SSH connection, or real credentials.
const {app, BrowserWindow, dialog} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-ui-'));
app.setPath('userData', directory);
let copies = 0, switches = 0, paused = 0, resumed = 0, confirm = false;
let copiedId, switchedId;
const dialogs = [];
const fixture = Array.from({length: 4}, (_, index) => ({
  id: String(index + 1).repeat(64), name: ['Personal', 'account2@example.test', 'Research', '<img src=x>'][index],
  email: `account${index + 1}@example.test`, accountId: `workspace-${index + 1}`,
  active: index === 0, expiresAt: index === 3 ? 1 : 9999999999, sources: ['Codex Vitals'],
}));
class FakeClient {
  constructor(config) { this.config = config; }
  list() { return Promise.resolve({host: 'studio', local: {accounts: fixture}, remote: {accounts: fixture}}); }
  copy(id) { copies++; copiedId = id; return Promise.resolve({copied: true}); }
  startSwitch(id) { switches++; switchedId = id; return Promise.resolve({state: 'running'}); }
  switchStatus() { return Promise.resolve({state: 'complete', message: 'Synthetic account switched.'}); }
  pending() { return null; }
}
require('../viewer/accounts.cjs');
require.cache[require.resolve('../viewer/accounts.cjs')].exports.AccountsClient = FakeClient;
const {createAccountControls} = require('../viewer/account-window.cjs');
dialog.showMessageBox = async (...args) => { dialogs.push(args.at(-1)); return {response: confirm ? 1 : 0}; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(window, expression) {
  for (let n = 0; n < 100; n++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await sleep(30);
  }
  throw Error('Accounts UI did not reach the expected state.');
}
app.whenReady().then(async () => {
  const controls = createAccountControls({userData: directory, getConfig: () => ({sshHost: 'studio'}),
    isConnecting: () => false, pauseConnection: () => {paused++;}, resumeConnection: () => {resumed++;}, onMenuChanged: () => {}});
  controls.show();
  const window = BrowserWindow.getAllWindows()[0];
  await waitFor(window, 'document.querySelectorAll(".account").length === 4');
  assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".account")[1].textContent.split("account2@example.test").length - 1'), 1);
  await window.webContents.executeJavaScript('document.querySelector("#refresh").click()');
  await waitFor(window, '!document.querySelector("#refresh").disabled');
  assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".account").length'), 4);
  assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll("img").length'), 0);
  assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-action=switch]").disabled'), true);
  await window.webContents.executeJavaScript('document.querySelector("[data-action=copy]").click()');
  await waitFor(window, '!document.querySelector("#refresh").disabled');
  assert.equal(copies, 0);
  assert.equal(dialogs.at(-1).defaultId, 0);
  confirm = true;
  await window.webContents.executeJavaScript('document.querySelector("[data-action=copy]").click()');
  await waitFor(window, 'document.querySelector("#progress").textContent.includes("Account copied")');
  assert.equal(copies, 1); assert.equal(paused, 0);
  assert.equal(copiedId, fixture[0].id);
  await waitFor(window, '!document.querySelector("#refresh").disabled');
  await window.webContents.executeJavaScript('document.querySelectorAll("[data-action=switch]")[1].click()');
  await waitFor(window, 'document.querySelector("#progress").textContent.includes("Synthetic account switched") && !document.querySelector("#refresh").disabled');
  assert.equal(switches, 1); assert.equal(paused, 1); assert.equal(resumed, 1);
  assert.equal(switchedId, fixture[1].id);
  assert.match(dialogs.at(-1).detail, /stop ALL running Codex tasks/);
  assert.equal(controls.blocksConnection(), false);
  await sleep(500); // Allow the compositor to paint the verified DOM state.
  const image = await window.webContents.capturePage();
  const screenshot = path.join(__dirname, '../dist/accounts-window-test.png');
  fs.mkdirSync(path.dirname(screenshot), {recursive: true});
  fs.writeFileSync(screenshot, image.toPNG());
  console.log('Accounts window passed: unique rows and email labels, refresh, correct copy/switch targets, confirmation, reconnect, and text escaping.');
  window.destroy(); app.quit();
}).catch(error => {console.error(error); app.exit(1);});
app.on('will-quit', () => fs.rmSync(directory, {recursive: true, force: true}));
