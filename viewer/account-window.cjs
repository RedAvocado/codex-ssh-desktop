const {BrowserWindow, dialog, ipcMain} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {AccountsClient} = require('./accounts.cjs');

function createAccountControls({userData, getConfig, isConnecting, pauseConnection, resumeConnection, onMenuChanged, operationsBlocked = () => false}) {
  let window, client, busy = false, blocked = fs.existsSync(path.join(userData, 'pending-account-switch.json'));
  let catalog, progress = '', lastError = '', recoveryRequired = false;
  function getClient() {
    const config = getConfig();
    if (!config) throw Error('Configure your SSH connection first.');
    if (!client || JSON.stringify(client.config) !== JSON.stringify(config)) client = new AccountsClient(config, userData);
    return client;
  }
  function publish() {
    if (window && !window.isDestroyed()) window.webContents.send('accounts:state', state());
    onMenuChanged();
  }
  function state() { return {catalog, busy, blocked, recoveryRequired, progress, error: lastError}; }
  async function refresh() {
    catalog = await getClient().list();
    publish();
    return state();
  }
  function show() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({width: 890, height: 940, minWidth: 690, minHeight: 560,
      title: 'Accounts · Codex SSH Desktop', backgroundColor: '#15191b',
      webPreferences: {preload: path.join(__dirname, 'accounts-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true}});
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => {window = null;});
    void window.loadFile(path.join(__dirname, 'accounts.html'));
  }
  function sender(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw Error('Accounts are only available in the local Accounts window.');
  }
  async function followSwitch() {
    const accountClient = getClient();
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const result = await accountClient.switchStatus();
      if (!result || result.state === 'missing') {
        blocked = false;
        progress = 'No account switch was started.';
        break;
      }
      if (result.state === 'running') {
        progress = result.phase || 'Switching the remote account…'; publish();
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      blocked = result.recoveryRequired;
      recoveryRequired = result.recoveryRequired;
      progress = result.state === 'complete' ? result.message : '';
      lastError = result.state === 'failed' ? result.message : '';
      break;
    }
    if (blocked && !lastError) lastError = 'The remote switch is still pending. Use Check switch status before reconnecting.';
    publish();
    if (!blocked) await refresh();
  }
  async function operate(kind, id) {
    if (busy || blocked || operationsBlocked() || (kind === 'switch' && isConnecting())) {
      lastError = 'Wait for the current connection or account operation to finish.';
      publish();
      throw Error(lastError);
    }
    busy = true; lastError = ''; progress = ''; publish();
    let paused = false;
    try {
      const accountClient = getClient();
      const latest = await accountClient.list();
      const side = kind === 'copy' ? latest.local : latest.remote;
      if (side.error) throw Error(side.error);
      const account = side.accounts.find(item => item.id === id);
      if (!account) throw Error('The account is no longer available. Refresh the accounts list.');
      if (kind === 'switch' && account.active && !account.needsActivation) { progress = 'This is already the active remote account.'; return; }
      const copy = kind === 'copy';
      const options = {type: 'warning', title: copy ? 'Copy account to remote Mac' : 'Stop tasks and switch account',
        message: `${copy ? 'Copy' : 'Switch to'} ${account.name} on ${latest.host}?`,
        detail: copy
          ? `This sends the current access token, refresh token, and desktop login for ${account.email} over SSH to this remote Mac. It saves the account without activating it or stopping tasks. Any existing saved copy is backed up before replacement.`
          : `This will stop ALL running Codex tasks for your user on ${latest.host}, including tasks started in the native app or other clients. Codex will close, load ${account.email} (${account.accountId}), and relaunch. Stopped tasks must be resumed manually.`,
        buttons: ['Cancel', copy ? 'Copy account' : 'Stop tasks and switch'], defaultId: 0, cancelId: 0};
      const choice = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (choice.response !== 1) return;
      if (copy) {
        progress = 'Copying credentials over SSH…'; publish();
        await accountClient.copy(id);
        progress = 'Account copied to the remote Mac. Its active account and running tasks were left in place.';
        await refresh();
      } else {
        blocked = true; paused = true; progress = 'Preparing account switch…'; pauseConnection(); publish();
        await accountClient.startSwitch(id);
        await followSwitch();
      }
    } catch (error) {
      lastError = error.message;
      // A lost SSH reply may conceal a running detached switch. Keep the viewer
      // disconnected until the durable remote status has been checked.
      if (kind === 'switch' && client?.pending()) blocked = true;
      throw error;
    } finally { busy = false; publish(); if (paused && !blocked) void resumeConnection(); }
  }
  async function checkPending() {
    if (busy) return state();
    busy = true; lastError = ''; publish();
    try { await followSwitch(); }
    catch (error) { lastError = error.message; }
    finally { busy = false; publish(); if (!blocked) void resumeConnection(); }
    return state();
  }
  ipcMain.handle('accounts:read', async event => {
    sender(event);
    try { return await refresh(); } catch (error) { lastError = error.message; return state(); }
  });
  ipcMain.handle('accounts:operate', async (event, kind, id) => {
    sender(event);
    if (!['copy', 'switch'].includes(kind) || typeof id !== 'string') throw Error('Invalid account action.');
    try { await operate(kind, id); } catch {} // Return only the explicit public state.
    return state();
  });
  ipcMain.handle('accounts:check-switch', event => { sender(event); return checkPending(); });
  ipcMain.handle('accounts:acknowledge-recovery', async event => {
    sender(event);
    if (busy || !recoveryRequired) return state();
    const {response} = await dialog.showMessageBox(window, {type: 'warning', title: 'Reconnect after recovery',
      message: 'Have you checked Codex on the remote Mac?',
      detail: 'Only continue after confirming the intended account is active on the remote Mac. This clears the recovery hold and reconnects the viewer. It does not restore credentials or resume stopped tasks.',
      buttons: ['Cancel', 'I checked the remote Mac — reconnect'], defaultId: 0, cancelId: 0});
    if (response !== 1) return state();
    busy = true; publish();
    try { await getClient().acknowledgeRecovery(); blocked = recoveryRequired = false; lastError = ''; progress = 'Recovery acknowledged. Reconnecting…'; }
    catch (error) { lastError = error.message; }
    finally { busy = false; publish(); if (!blocked) void resumeConnection(); }
    return state();
  });
  return {
    show, blocksConnection: () => blocked || busy,
    async restorePending() { if (blocked) {show(); await checkPending();} },
    menu() {
      return [
        {label: 'Manage Accounts…', accelerator: 'CmdOrCtrl+Shift+A', click: show},
        {label: 'Refresh accounts', enabled: !busy, click: () => { void refresh().catch(error => { lastError = error.message; show(); publish(); }); }},
        ...(blocked ? [{label: 'Check switch status…', click: () => {show(); void checkPending();}}] : []),
        {type: 'separator'},
        ...(catalog?.remote?.accounts?.length ? catalog.remote.accounts.map(account => ({
          label: `${account.needsActivation ? 'Apply saved login: ' : account.active ? '✓ ' : ''}${account.name} · ${account.accountId.slice(0, 8)}`,
          enabled: !busy && !blocked && (!account.active || account.needsActivation),
          click: () => { show(); void operate('switch', account.id).catch(() => {}); },
        })) : [{label: 'Open Manage Accounts to load remote accounts', enabled: false}]),
      ];
    },
  };
}

module.exports = {createAccountControls};
