const {BrowserWindow, ipcMain, app, shell} = require('electron');
const path = require('node:path');
const {checkForUpdates, releasesUrl} = require('./updates.cjs');
const {installedBundle, prepareUpdate, discardUpdate, startInstaller} = require('./update-install.cjs');

function createUpdateControls({version, userData, readPrivateRelease, blocksInstall = () => false,
  check = checkForUpdates, prepare = prepareUpdate, install = startInstaller, discard = discardUpdate,
  getTarget = installedBundle, quit = () => app.quit()}) {
  let window, release, prepared, abort, busy = false, installing = false;
  let state = {phase: 'checking', currentVersion: version};
  function publish(next) {
    state = {...state, ...next};
    if (window && !window.isDestroyed()) {
      window.webContents.send('updates:state', state);
      window.setProgressBar(state.phase === 'downloading' ? state.progress || 0.01 : -1);
    }
  }
  async function refresh() {
    if (busy || prepared) return;
    busy = true; publish({phase: 'checking', error: ''});
    try {
      release = await check(version, {readPrivateRelease});
      let reason = '';
      try { if (process.platform !== 'darwin') throw Error('In-app installation is available on macOS.'); getTarget(); }
      catch (error) { reason = error.message; }
      if (!release.asset) reason ||= 'This release has no verified download for this Mac. You can open its release page.';
      publish({phase: release.status, nextVersion: release.version, canDownload: !!release.asset && !reason, reason});
    } catch (error) { publish({phase: 'error', error: error.message}); }
    finally { busy = false; }
  }
  function show() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({width: 500, height: 370, resizable: false, title: 'Updates · Codex SSH Desktop', backgroundColor: '#15191b',
      webPreferences: {preload: path.join(__dirname, 'updates-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true}});
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { window = null; if (!installing) abort?.abort(); });
    void window.loadFile(path.join(__dirname, 'updates.html'));
    if (!prepared && !busy) void refresh();
  }
  function sender(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw Error('Updates are only available from the local Updates window.');
  }
  async function action(kind) {
    if (kind === 'cancel') { if (!installing) { abort?.abort(); window?.close(); } return; }
    if (kind === 'releases') { await shell.openExternal(release?.url || releasesUrl); return; }
    if (busy || installing) return;
    if (kind === 'check') return refresh();
    if (kind !== 'download' && kind !== 'install') throw Error('Unknown update action.');
    if (blocksInstall()) { publish({error: 'Wait for the current account operation to finish, then try again.'}); return; }
    busy = true;
    try {
      if (kind === 'download') {
        if (state.phase !== 'available' || !state.canDownload || prepared) return;
        abort = new AbortController(); publish({phase: 'downloading', progress: 0, error: ''});
        prepared = await prepare(release, {target: getTarget(), currentVersion: version, signal: abort.signal,
          onProgress: progress => publish({progress})});
        publish({phase: 'ready'});
      } else {
        if (!prepared || state.phase !== 'ready') return;
        installing = true; publish({phase: 'installing', error: ''});
        await install(prepared, {userData});
        quit();
      }
    } catch (error) {
      installing = false;
      publish({phase: prepared ? 'ready' : 'error', error: error.name === 'AbortError' ? 'Download cancelled.' : error.message});
    } finally { busy = false; }
  }
  ipcMain.handle('updates:read', event => { sender(event); return state; });
  ipcMain.handle('updates:action', async (event, kind) => { sender(event); await action(kind); return state; });
  return {show, blocksAccounts: () => installing,
    beforeQuit: () => { if (!installing) { abort?.abort(); void discard(prepared); } }};
}
module.exports = {createUpdateControls};
