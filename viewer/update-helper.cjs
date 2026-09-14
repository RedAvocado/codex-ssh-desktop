// Runs with the existing Electron binary in Node mode. No SSH commands are used.
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function write(file, data) {
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(data), {mode: 0o600});
  await fs.rename(temporary, file);
}
async function launch(target) {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const child = spawn(path.join(target, 'Contents/MacOS/Electron'), [],
    {detached: true, stdio: 'ignore', cwd: path.dirname(target), env});
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return {pid: child.pid, stop: () => child.kill('SIGTERM')};
}
function validateJob(job) {
  if (!job || !path.isAbsolute(job.target || '') || path.basename(job.target) !== 'Codex SSH Desktop.app' ||
    path.dirname(job.jobDirectory || '') !== path.dirname(job.target) || !path.basename(job.jobDirectory).startsWith('.codex-ssh-update-') ||
    job.staged !== path.join(job.jobDirectory, 'extracted/Codex SSH Desktop.app') ||
    job.backup !== path.join(job.jobDirectory, 'previous.app') || !path.isAbsolute(job.userData || '') ||
    !Number.isSafeInteger(job.parentPid) || job.parentPid <= 1 || !/^[a-f0-9-]{36}$/.test(job.token || '') ||
    !/^\d+\.\d+\.\d+$/.test(job.version || '')) throw Error('Invalid update installation job.');
}
async function runInstall(job, {isAlive = alive, startApp = launch, wait = sleep, attempts = 120, rename = fs.rename} = {}) {
  validateJob(job);
  const journal = path.join(job.userData, 'pending-update.json');
  const resultFile = path.join(job.userData, 'last-update.json');
  const statusFile = path.join(job.jobDirectory, 'status.json');
  let movedOld = false, movedNew = false, launched;
  async function result(status, message) {
    const data = {status, message, version: job.version, backup: job.backup, token: job.token};
    await write(resultFile, data); await write(statusFile, {...data, helperPid: process.pid});
  }
  async function clearJournal() {
    try { if (JSON.parse(await fs.readFile(journal, 'utf8')).token === job.token) await fs.rm(journal); } catch {}
  }
  try {
    await write(statusFile, {status: 'waiting', helperPid: process.pid});
    process.send?.({ready: job.token});
    for (let n = 0; n < attempts && isAlive(job.parentPid); n++) await wait(250);
    if (isAlive(job.parentPid)) throw Error('The viewer did not close. The current app was kept.');
    if (await exists(job.backup)) throw Error('An update backup already exists.');
    await write(statusFile, {status: 'installing', helperPid: process.pid});
    await rename(job.target, job.backup); movedOld = true;
    await rename(job.staged, job.target); movedNew = true;
    launched = await startApp(job.target);
    for (let n = 0; n < attempts; n++) {
      try {
        const ready = JSON.parse(await fs.readFile(path.join(job.jobDirectory, 'ready.json'), 'utf8'));
        if (ready.token === job.token && ready.version === job.version && ready.pid === launched.pid) {
          await result('installed', `Updated to ${job.version}.`); await clearJournal(); return;
        }
      } catch {}
      if (!isAlive(launched.pid)) break;
      await wait(250);
    }
    throw Error('The updated viewer did not finish starting.');
  } catch (error) {
    if (launched && isAlive(launched.pid)) {
      launched.stop();
      for (let n = 0; n < 40 && isAlive(launched.pid); n++) await wait(250);
      if (isAlive(launched.pid)) {
        await result('attention', `${error.message} Close the local viewer before restoring its backup.`);
        return;
      }
    }
    try {
      if (movedNew) await rename(job.target, path.join(job.jobDirectory, 'failed.app'));
      if (movedOld) await rename(job.backup, job.target);
      await result('failed', `${error.message} The previous app was kept.`);
      await clearJournal();
      if (movedOld) await startApp(job.target);
    } catch (rollbackError) {
      await result('attention', `${error.message} Restore the app from ${job.backup}. ${rollbackError.message}`);
    }
  }
}
async function acknowledgeUpdate({userData, version, target, pid = process.pid}) {
  const journal = path.join(userData, 'pending-update.json');
  let job;
  try { job = JSON.parse(await fs.readFile(journal, 'utf8')); } catch { return; }
  validateJob(job);
  if (job.userData !== userData || job.target !== target || pid === job.parentPid) throw Error('Update startup identity did not match the pending installation.');
  // Recover a completed replacement after an interrupted helper (for example, a reboot).
  let status;
  try { status = JSON.parse(await fs.readFile(path.join(job.jobDirectory, 'status.json'), 'utf8')); } catch {}
  if (version === job.previousVersion && (!status?.helperPid || !alive(status.helperPid))) {
    await write(path.join(userData, 'last-update.json'), {status: 'failed', message: 'An interrupted update left the previous app in place. You can try again.', token: job.token});
    await fs.rm(journal, {force: true}); return;
  }
  if (job.version !== version) return;
  await write(path.join(job.jobDirectory, 'ready.json'), {token: job.token, version, pid});
  if (status?.helperPid && !alive(status.helperPid)) {
    await write(path.join(userData, 'last-update.json'), {status: 'installed', version, backup: job.backup, token: job.token});
    await fs.rm(journal, {force: true});
  }
}
module.exports = {runInstall, acknowledgeUpdate, validateJob};
if (require.main === module) {
  fs.readFile(process.argv[2], 'utf8').then(JSON.parse).then(job => runInstall(job)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
