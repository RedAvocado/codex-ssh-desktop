const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {quoteShell, validateConfig} = require('./config.cjs');

const limit = 2 * 1024 * 1024;
const helper = path.join(__dirname, 'account-helper.py');
const keyPattern = /^[a-f0-9]{64}$/;

// This transport also carries credentials. Never use execFile's error.message:
// it can contain captured output. No credential goes into argv or the renderer.
function privateCommand(file, args, input, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = [];
    let size = 0, finished = false;
    const finish = (error, output) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      error ? reject(error) : resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill(); finish(Error('The account connection timed out. Check SSH and refresh the account status.'));
    }, timeout);
    child.stdout.on('data', data => {
      size += data.length;
      if (size > limit) { child.kill(); finish(Error('The account response exceeded its size limit.')); }
      else chunks.push(data);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish(Error('Could not start the account helper. Python 3 and SSH are required.')));
    child.on('close', code => finish(code === 0 ? null : Error('The account helper could not finish. Check SSH, Python 3, and remote file permissions.'), Buffer.concat(chunks).toString('utf8')));
    child.stdin.end(input);
  });
}

function parseResponse(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw Error('The account helper returned an invalid response.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid account response.');
  if (typeof value.error === 'string') throw Error(value.error);
  return value;
}

function publicCatalog(value) {
  if (!Array.isArray(value.accounts)) throw Error('Invalid account catalog.');
  return {
    accounts: value.accounts.map(item => {
      if (!keyPattern.test(item.id)) throw Error('Invalid account identity.');
      const string = key => typeof item[key] === 'string' ? item[key].slice(0, 250) : '';
      return {id: item.id, name: string('name'), email: string('email'), accountId: string('accountId'),
        active: item.active === true, needsActivation: item.needsActivation === true,
        expiresAt: Number.isFinite(item.expiresAt) ? item.expiresAt : 0,
        usage: publicUsage(item.usage),
        sources: Array.isArray(item.sources) ? item.sources.filter(v => typeof v === 'string').map(v => v.slice(0, 80)) : []};
    }),
    skipped: Number.isInteger(value.skipped) ? value.skipped : 0,
    vitalsInstalled: value.vitalsInstalled === true,
  };
}

function publicUsage(usage) {
  const observedAt = Number.isFinite(usage?.observedAt) && usage.observedAt > 0 ? usage.observedAt : null;
  const windows = Array.isArray(usage?.windows) ? usage.windows.filter(window =>
    Number.isFinite(window.limitSeconds) && window.limitSeconds > 0 && window.limitSeconds <= 366 * 86400
    && Number.isFinite(window.remainingPercent)).map(window => ({
      limitSeconds: window.limitSeconds,
      remainingPercent: Math.min(100, Math.max(0, window.remainingPercent)),
      resetsAt: Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null,
    })) : [];
  return {status: usage?.status === 'error' ? 'error' : usage?.status === 'available' && observedAt && windows.length ? 'available' : 'unavailable',
    observedAt, windows: usage?.status === 'available' ? windows : []};
}

class AccountsClient {
  constructor(config, userData, run = privateCommand) {
    this.config = validateConfig(config);
    this.userData = userData;
    this.run = run;
    this.installed = null;
    this.pendingFile = path.join(userData, 'pending-account-switch.json');
  }
  async local(request) {
    return parseResponse(await this.run('/usr/bin/python3', [helper], JSON.stringify(request)));
  }
  async ssh(command, input) {
    return this.run('/usr/bin/ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3', this.config.sshHost, command], input);
  }
  async installHelper() {
    if (this.installed) return this.installed;
    const source = fs.readFileSync(helper);
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    const relative = `.local/share/codex-ssh-desktop/accounts/helper-${hash}.py`;
    const installer = [
      'import hashlib,os,pathlib,sys,tempfile',
      `data=sys.stdin.buffer.read(262145)`,
      `assert len(data)<=262144 and hashlib.sha256(data).hexdigest()==${JSON.stringify(hash)}`,
      `p=pathlib.Path.home()/${JSON.stringify(relative)}`,
      'assert not any(x.is_symlink() for x in [p,*p.parents])',
      'p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)',
      'os.chmod(p.parent,0o700)',
      'fd,tmp=tempfile.mkstemp(dir=str(p.parent),prefix=".helper-")',
      'with os.fdopen(fd,"wb") as f: f.write(data); f.flush(); os.fsync(f.fileno())',
      'os.chmod(tmp,0o600)',
      'os.replace(tmp,p)',
    ].join('\n');
    await this.ssh(`/usr/bin/python3 -c ${quoteShell(installer)}`, source);
    this.installed = relative;
    return relative;
  }
  async remote(request) {
    const remoteHelper = await this.installHelper();
    return parseResponse(await this.ssh(`/usr/bin/python3 ${quoteShell(remoteHelper)}`, JSON.stringify(request)));
  }
  async list() {
    const [local, remote] = await Promise.allSettled([this.local({action: 'list'}), this.remote({action: 'list'})]);
    const result = {host: this.config.sshHost};
    for (const [key, item] of [['local', local], ['remote', remote]]) {
      if (item.status === 'fulfilled') result[key] = publicCatalog(item.value);
      else result[key] = {accounts: [], error: item.reason.message};
    }
    return result;
  }
  async copy(id) {
    if (!keyPattern.test(id)) throw Error('Invalid account selection.');
    const exported = await this.local({action: 'export', id});
    if (exported.id !== id || !exported.auth) throw Error('The local account changed. Refresh and try again.');
    const result = await this.remote({action: 'import', id, name: exported.name, auth: exported.auth});
    if (result.copied !== true || result.activated !== false) throw Error('Could not verify the remote credential copy.');
    return {copied: true};
  }
  pending() {
    if (!fs.existsSync(this.pendingFile)) return null;
    const value = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8'));
    if (!/^[a-f0-9]{32}$/.test(value.job)) throw Error('Invalid pending account operation.');
    return value;
  }
  async startSwitch(id) {
    if (!keyPattern.test(id)) throw Error('Invalid account selection.');
    if (this.pending()) throw Error('An account switch is awaiting a status check.');
    const job = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(this.userData, {recursive: true, mode: 0o700});
    const data = {job, config: this.config};
    fs.writeFileSync(this.pendingFile + '.next', JSON.stringify(data), {mode: 0o600});
    fs.renameSync(this.pendingFile + '.next', this.pendingFile);
    // Persist before dispatch so a lost reply cannot lose track of a switch.
    return this.remote({action: 'start-switch', job, id, confirmed: true, config: this.config});
  }
  async switchStatus() {
    const pending = this.pending();
    if (!pending) return null;
    if (JSON.stringify(pending.config) !== JSON.stringify(this.config)) throw Error('Reconnect to the original host to check its account switch.');
    const result = await this.remote({action: 'job', job: pending.job});
    if (!['running', 'complete', 'failed', 'missing'].includes(result.state)) throw Error('Invalid switch status.');
    if (result.state !== 'running' && !result.recoveryRequired) fs.rmSync(this.pendingFile, {force: true});
    return {state: result.state, phase: result.phase, message: result.message, recoveryRequired: result.recoveryRequired === true};
  }
  async acknowledgeRecovery() {
    const pending = this.pending();
    if (!pending || JSON.stringify(pending.config) !== JSON.stringify(this.config)) throw Error('No recovery is pending for this host.');
    const result = await this.remote({action: 'acknowledge-recovery', job: pending.job, confirmed: true});
    if (result.acknowledged !== true) throw Error('The remote recovery could not be acknowledged.');
    fs.rmSync(this.pendingFile, {force: true});
  }
}

module.exports = {AccountsClient, privateCommand, publicCatalog, publicUsage, parseResponse};
