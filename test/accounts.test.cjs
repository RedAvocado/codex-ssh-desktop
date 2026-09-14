const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {AccountsClient, privateCommand, publicCatalog, parseResponse} = require('../viewer/accounts.cjs');
const {defaults} = require('../viewer/config.cjs');
const config = {...defaults, sshHost: 'studio'};
const id = 'a'.repeat(64);

test('public account data is an allowlist, never a credential-bearing object', () => {
  const catalog = publicCatalog({accounts: [{id, name: 'Example', email: 'person@example.test', accountId: 'workspace',
    auth: {tokens: {refresh_token: 'secret'}}, refresh: 'secret', access: 'secret', active: true}]});
  assert.equal(catalog.accounts[0].active, true);
  assert.ok(!JSON.stringify(catalog).includes('secret'));
});

test('subprocess stderr and stdout cannot leak through failure diagnostics', async () => {
  await assert.rejects(privateCommand(process.execPath, ['-e', 'process.stdout.write("secret-one");process.stderr.write("secret-two");process.exit(1)'], ''),
    error => !error.message.includes('secret') && error.message.includes('account helper'));
  assert.throws(() => parseResponse('secret-invalid-json'), error => !error.message.includes('secret'));
});

test('credential copy uses SSH stdin, never argv, and does not switch', async () => {
  const calls = [];
  const run = async (file, args, input) => {
    calls.push({file, args, input});
    if (file === '/usr/bin/python3') return JSON.stringify({id, name: 'Example', auth: {tokens: {refresh_token: 'synthetic-secret'}}});
    if (args.at(-1).includes(' -c ')) return '';
    const request = JSON.parse(input);
    assert.equal(request.action, 'import');
    assert.equal(request.auth.tokens.refresh_token, 'synthetic-secret');
    return JSON.stringify({copied: true, activated: false});
  };
  const client = new AccountsClient(config, '/unused', run);
  assert.deepEqual(await client.copy(id), {copied: true});
  assert.ok(calls.every(call => !JSON.stringify(call.args).includes('synthetic-secret')));
  const requests = calls.filter(call => typeof call.input === 'string').map(call => JSON.parse(call.input));
  assert.ok(requests.every(request => request.action !== 'start-switch'));
});

test('lost switch response retains a pending operation until status is checked', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-'));
  let phase = 'start';
  const run = async (_file, args, input) => {
    if (args.at(-1).includes(' -c ')) return '';
    const request = JSON.parse(input);
    if (phase === 'start') { assert.equal(request.action, 'start-switch'); throw Error('Connection lost'); }
    return JSON.stringify({state: 'complete', message: 'Finished'});
  };
  try {
    const client = new AccountsClient(config, directory, run);
    await assert.rejects(client.startSwitch(id));
    assert.ok(client.pending());
    assert.equal(fs.statSync(client.pendingFile).mode & 0o777, 0o600);
    phase = 'status';
    const reloaded = new AccountsClient(config, directory, run);
    assert.equal((await reloaded.switchStatus()).state, 'complete');
    assert.equal(reloaded.pending(), null);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
