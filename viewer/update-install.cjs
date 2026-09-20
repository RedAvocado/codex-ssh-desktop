const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const {pipeline} = require('node:stream/promises');
const {Readable, Transform} = require('node:stream');
const {repository, compareVersions} = require('./updates.cjs');
const run = promisify(execFile);
const bundleName = 'Codex SSH Desktop.app';
const bundleId = 'com.dittodub.codex-ssh-desktop';
const journalName = 'pending-update.json';

function installedBundle(execPath = process.execPath) {
  const bundle = path.resolve(execPath, '../../..');
  if (path.basename(bundle) !== bundleName || path.relative(bundle, execPath) !== 'Contents/MacOS/Electron')
    throw Error('In-app installation is available from the installed macOS app.');
  return bundle;
}
function validateArchivePaths(listing) {
  const names = listing.trimEnd().split('\n');
  if (!names.length || names.some(name => !name || /[\x00-\x1f\x7f\\]/.test(name) ||
    name.startsWith('/') || name.split('/').includes('..') ||
    ![bundleName, '__MACOSX'].includes(name.split('/')[0])))
    throw Error('The update archive has unexpected paths.');
}
function supportsArchitecture(header, arch) {
  const cpu = {arm64: 0x0100000c, x64: 0x01000007}[arch];
  if (!cpu || header.length < 8) return false;
  const magic = header.readUInt32BE(0);
  const little = [0xcffaedfe, 0xbebafeca, 0xbfbafeca].includes(magic);
  const read = offset => little ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
  if ([0xfeedfacf, 0xcffaedfe].includes(magic)) return read(4) === cpu;
  if (![0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) return false;
  const count = read(4), stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20;
  if (!count || count > 64 || 8 + count * stride > header.length) return false;
  for (let index = 0; index < count; index++) if (read(8 + index * stride) === cpu) return true;
  return false;
}
async function validateBundle(bundle, version, arch = process.arch) {
  if (!(await fsp.lstat(bundle)).isDirectory()) throw Error('The update does not contain an app bundle.');
  const plist = path.join(bundle, 'Contents/Info.plist');
  const read = async key => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
  if (await read('CFBundleIdentifier') !== bundleId || await read('CFBundleShortVersionString') !== version ||
    await read('CFBundleExecutable') !== 'Electron') throw Error('The update app identity or version does not match the release.');
  const manifest = JSON.parse(await fsp.readFile(path.join(bundle, 'Contents/Resources/app/package.json'), 'utf8'));
  if (manifest.version !== version) throw Error('The update client version does not match its bundle.');
  const executable = await fsp.open(path.join(bundle, 'Contents/MacOS/Electron'), 'r');
  try {
    const header = Buffer.alloc(4096);
    const {bytesRead} = await executable.read(header, 0, header.length, 0);
    if (!supportsArchitecture(header.subarray(0, bytesRead), arch)) throw Error('The update was built for a different Mac architecture.');
  } finally { await executable.close(); }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {timeout: 60000});
  // All framework symlinks must remain within the extracted app.
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const real = await fsp.realpath(file);
        if (!real.startsWith(bundle + path.sep)) throw Error('The update contains an external symbolic link.');
      } else if (entry.isDirectory()) await walk(file);
    }
  }
  await walk(bundle);
}
async function downloadAsset(asset, output, {fetchImpl = fetch, signal, onProgress = () => {}} = {}) {
  const prefix = `https://github.com/${repository}/releases/download/`;
  if (!asset?.url?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
    !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1024**3) throw Error('No verified download is available for this Mac.');
  const abort = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(15 * 60 * 1000)]);
  let url = asset.url, response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetchImpl(url, {redirect: 'manual', signal: abort});
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw Error('The update download redirect is missing.');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || next.username || next.password || next.port ||
      !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname))
      throw Error('The update download redirected outside GitHub.');
    url = next.href;
  }
  if (!response?.ok || !response.body) throw Error('Could not download the update from GitHub. Open the release page or try again later.');
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > asset.size) return callback(Error('The update download is larger than expected.'));
    hash.update(chunk); onProgress(bytes / asset.size); callback(null, chunk);
  }});
  // Acquire exclusive ownership before entering the cleanup path. EEXIST must
  // never remove an archive this download did not create.
  let file;
  try { file = await fsp.open(output, 'wx', 0o600); }
  catch (error) { await response.body.cancel(); throw error; }
  try {
    await pipeline(Readable.fromWeb(response.body), meter, file.createWriteStream(), {signal: abort});
    if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw Error('The update checksum did not match GitHub. Nothing was installed.');
  } catch (error) { await file.close(); await fsp.rm(output, {force: true}); throw error; }
  finally { await file.close(); }
}
async function prepareUpdate(release, {target, currentVersion, signal, onProgress, fetchImpl} = {}) {
  if (process.platform !== 'darwin') throw Error('In-app installation is available on macOS.');
  target ||= installedBundle();
  if (compareVersions(release.version, currentVersion) <= 0) throw Error('The update must be newer than the installed version.');
  if (await fsp.realpath(target) !== target) throw Error('Install the app in Applications before updating.');
  await validateBundle(target, currentVersion);
  let jobDirectory;
  try { jobDirectory = await fsp.mkdtemp(path.join(path.dirname(target), '.codex-ssh-update-')); }
  catch { throw Error('This app location is not writable. Move Codex SSH Desktop to a writable Applications folder, then try again.'); }
  await fsp.chmod(jobDirectory, 0o700);
  try {
    const archive = path.join(jobDirectory, 'update.zip');
    await downloadAsset(release.asset, archive, {signal, onProgress, fetchImpl});
    signal?.throwIfAborted();
    const listing = await run('/usr/bin/tar', ['-tf', archive], {timeout: 30000, maxBuffer: 16 * 1024**2, signal});
    validateArchivePaths(listing.stdout);
    const extracted = path.join(jobDirectory, 'extracted');
    await fsp.mkdir(extracted, {mode: 0o700});
    // bsdtar's default extraction protections reject traversal and writes through symlinks.
    // Do not add -P: that disables these protections.
    await run('/usr/bin/tar', ['-xf', archive, '-C', extracted, '--no-same-owner'], {timeout: 120000, signal});
    const staged = path.join(extracted, bundleName);
    await validateBundle(staged, release.version);
    signal?.throwIfAborted();
    await fsp.rm(archive);
    return {target, staged, jobDirectory, backup: path.join(jobDirectory, 'previous.app'), version: release.version, previousVersion: currentVersion};
  } catch (error) { await fsp.rm(jobDirectory, {recursive: true, force: true}); throw error; }
}
async function discardUpdate(prepared) {
  if (prepared) await fsp.rm(prepared.jobDirectory, {recursive: true, force: true});
}
async function startInstaller(prepared, {userData, execPath = process.execPath, parentPid = process.pid} = {}) {
  // Revalidate after any time spent waiting at the Install and Restart button.
  await validateBundle(prepared.staged, prepared.version);
  const job = {...prepared, parentPid, token: randomUUID(), userData};
  const helper = path.join(job.jobDirectory, 'update-helper.cjs');
  const jobFile = path.join(job.jobDirectory, 'job.json');
  const journal = path.join(userData, journalName);
  await fsp.copyFile(path.join(__dirname, 'update-helper.cjs'), helper);
  await fsp.writeFile(jobFile, JSON.stringify(job), {mode: 0o600});
  await fsp.writeFile(journal, JSON.stringify(job), {mode: 0o600, flag: 'wx'});
  const log = fs.openSync(path.join(job.jobDirectory, 'install.log'), 'a', 0o600);
  const child = spawn(execPath, [helper, jobFile], {detached: true, stdio: ['ignore', log, log, 'ipc'],
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
  fs.closeSync(log);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('The update installer did not start.')), 10000);
      child.once('error', fail); child.once('exit', () => fail(Error('The update installer exited before it was ready.')));
      child.once('message', message => { if (message?.ready !== job.token) return fail(Error('Invalid update installer response.')); clearTimeout(timer); resolve(); });
      function fail(error) { clearTimeout(timer); reject(error); }
    });
    child.disconnect(); child.unref();
  } catch (error) { child.kill(); await fsp.rm(journal, {force: true}); throw error; }
  return job;
}
module.exports = {installedBundle, validateArchivePaths, supportsArchitecture, validateBundle, downloadAsset, prepareUpdate, discardUpdate, startInstaller, journalName};
