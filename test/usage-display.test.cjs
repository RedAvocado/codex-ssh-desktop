const {test} = require('node:test');
const assert = require('node:assert/strict');
const {usageDisplay} = require('../viewer/usage-display.js');
const {publicUsage} = require('../viewer/accounts.cjs');
const {accountRows} = require('../viewer/account-rows.js');
const now = Date.UTC(2026, 8, 14, 20, 0);
const usage = {status: 'available', observedAt: now / 1000 - 120, source: 'local', windows: [
  {limitSeconds: 604800, remainingPercent: 8, resetsAt: now / 1000 + 3600},
]};

test('usage shows percent remaining and the reset date in the requested local zone', () => {
  const display = usageDisplay(usage, now, 'en-US', 'America/Los_Angeles');
  assert.equal(display.windows[0].remaining, '8% left');
  assert.equal(display.windows[0].label, 'Weekly');
  assert.match(display.windows[0].reset, /Sep 14/);
  assert.match(display.windows[0].reset, /2:00 PM/);
  assert.match(display.windows[0].reset, /PDT/);
  assert.match(display.provenance, /2m ago/);
});

test('a passed reset keeps the last reading instead of fabricating a replenished balance', () => {
  const display = usageDisplay(usage, now + 2 * 3600000, 'en-US', 'UTC');
  assert.equal(display.windows[0].remaining, '8% at last check');
  assert.match(display.windows[0].reset, /Reset time passed/);
  assert.equal(display.stale, true);
});

test('missing readings and error snapshots are unavailable, never zero percent', () => {
  for (const item of [undefined, {status: 'error', windows: []}]) {
    const display = usageDisplay(item, now);
    assert.deepEqual(display.windows, []);
    assert.ok(display.message);
  }
});

test('public usage data excludes arbitrary fields and handles zero percent', () => {
  const sanitized = publicUsage({...usage, token: 'synthetic-secret', windows: [{...usage.windows[0], remainingPercent: 0, token: 'synthetic-secret'}]});
  assert.equal(sanitized.windows[0].remainingPercent, 0);
  assert.ok(!JSON.stringify(sanitized).includes('synthetic-secret'));
});

test('one account uses the newest successful Vitals snapshot from either Mac', () => {
  const profile = {id: 'one', email: 'person@example.test', name: 'Personal', accountId: 'workspace'};
  const catalog = {local: {accounts: [{...profile, usage}]}, remote: {accounts: [{...profile,
    usage: {...usage, observedAt: usage.observedAt + 60, windows: [{...usage.windows[0], remainingPercent: 7}]}}]}};
  const row = accountRows(catalog)[0];
  assert.equal(row.usage.source, 'remote');
  assert.equal(row.usage.windows[0].remainingPercent, 7);
  catalog.remote.accounts[0].usage = {status: 'error', observedAt: usage.observedAt + 60, windows: []};
  assert.equal(accountRows(catalog)[0].usage.source, 'local');
});
