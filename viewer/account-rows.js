// Display grouping only. Keep the original local/remote records for actions;
// an email alone must never merge different workspace identities.
function accountRows(catalog) {
  const rows = new Map();
  for (const side of ['remote', 'local']) {
    for (const account of catalog?.[side]?.accounts || []) {
      if (!rows.has(account.id)) rows.set(account.id, {id: account.id});
      rows.get(account.id)[side] = account;
    }
  }
  const emails = new Map();
  for (const row of rows.values()) {
    const primary = row.remote || row.local;
    row.email = primary.email;
    row.accountId = primary.accountId;
    const alias = [row.remote, row.local].find(account => account?.name?.trim()
      && account.name.trim().toLowerCase() !== account.email.trim().toLowerCase());
    row.name = alias?.name || row.email;
    row.hasAlias = row.name.trim().toLowerCase() !== row.email.trim().toLowerCase();
    const snapshots = ['local', 'remote'].filter(side => row[side]?.usage)
      .map(side => ({...row[side].usage, source: side})).sort((a, b) => (b.observedAt || 0) - (a.observedAt || 0));
    row.usage = snapshots.find(snapshot => snapshot.status === 'available' && snapshot.windows?.length)
      || snapshots[0] || {status: 'unavailable', observedAt: null, windows: []};
    const key = row.email.trim().toLowerCase();
    emails.set(key, (emails.get(key) || 0) + 1);
  }
  return [...rows.values()].map(row => ({...row, showWorkspace: emails.get(row.email.trim().toLowerCase()) > 1}));
}

if (typeof module !== 'undefined') module.exports = {accountRows};
