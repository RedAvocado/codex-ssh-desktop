const {test} = require('node:test');
const assert = require('node:assert/strict');
const {accountRows} = require('../viewer/account-rows.js');
const account = (id, email = 'person@example.test', name = email) => ({id, email, name, accountId: `workspace-${id}`});

test('the same identity on both Macs produces one row with both action targets', () => {
  const remote = {...account('one'), active: true};
  const local = {...account('one', 'person@example.test', 'Personal'), active: false};
  const rows = accountRows({local: {accounts: [local]}, remote: {accounts: [remote]}});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Personal');
  assert.equal(rows[0].local, local);
  assert.equal(rows[0].remote, remote);
  assert.equal(rows[0].remote.active, true);
  assert.equal(rows[0].local.active, false);
});

test('email fallback is not repeated as a second label', () => {
  const rows = accountRows({remote: {accounts: [account('one', 'person@example.test', ' PERSON@example.test ')]}});
  assert.equal(rows[0].name, 'person@example.test');
  assert.equal(rows[0].hasAlias, false);
});

test('distinct workspace identities with the same email remain separate and identifiable', () => {
  const first = account('one'), second = account('two');
  const rows = accountRows({remote: {accounts: [first]}, local: {accounts: [first, second]}});
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.showWorkspace));
  assert.equal(rows[1].remote, undefined);
  assert.equal(rows[1].local.id, 'two');
});

test('accounts available on only one Mac remain visible, including during a remote failure', () => {
  const local = account('one');
  assert.equal(accountRows({local: {accounts: [local]}, remote: {error: 'Offline', accounts: []}})[0].local, local);
  assert.deepEqual(accountRows(undefined), []);
});
