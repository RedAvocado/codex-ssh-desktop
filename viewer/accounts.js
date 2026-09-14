const $ = selector => document.querySelector(selector);
let lastState = {}, awaiting = false;
function text(tag, value, className) {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
}
function render(state) {
  lastState = state;
  const disabled = state.busy || state.blocked || awaiting;
  $('#refresh').disabled = state.busy || awaiting;
  $('#progress').textContent = state.progress || '';
  $('#error').textContent = state.error || '';
  $('#check').hidden = !state.blocked;
  $('#check').disabled = state.busy || awaiting;
  $('#recovery').hidden = !state.recoveryRequired;
  $('#recovery').disabled = state.busy || awaiting;
  $('#host').textContent = state.catalog?.host || 'SSH';
  const container = $('#accounts'), errors = $('#catalog-errors');
  container.replaceChildren(); errors.replaceChildren();
  const rows = accountRows(state.catalog);
  $('#count').textContent = state.catalog ? `(${rows.length})` : '';
  if (!state.catalog) { container.append(text('p', 'Loading accounts…', 'empty')); return; }
  for (const side of ['remote', 'local']) {
    const data = state.catalog[side], label = side === 'remote' ? 'Remote Mac' : 'This Mac';
    if (data?.error) errors.append(text('p', `${label}: ${data.error}`, 'empty'));
    if (data?.skipped) errors.append(text('p', `${label}: ${data.skipped} incomplete or unsupported profile(s) were skipped. Capture them again in Codex Vitals.`, 'empty'));
  }
  if (!rows.length) container.append(text('p', 'No desktop OAuth profiles found. Capture an account in Codex Vitals, then refresh.', 'empty'));
  for (const row of rows) {
    const card = text('article', '', 'account'); card.dataset.accountId = row.id;
    const details = text('div', '', 'account-details');
    details.append(text('p', row.name, 'name'));
    if (row.hasAlias) details.append(text('p', row.email, 'email'));
    if (row.showWorkspace) details.append(text('p', `Workspace ${row.accountId}`, 'workspace'));
    const availability = text('div', '', 'availability');
    const location = row.local && row.remote ? 'On both Macs' : row.remote
      ? state.catalog.local?.error ? 'On remote · local unavailable' : 'Remote only'
      : state.catalog.remote?.error ? 'On this Mac · remote unavailable' : 'This Mac only';
    availability.append(text('span', location, 'location'));
    const active = row.local?.active && row.remote?.active ? 'Active on both Macs'
      : row.remote?.active ? 'Active remotely' : row.local?.active ? 'Active locally' : '';
    if (active) availability.append(text('span', active, 'active-label'));
    details.append(availability);
    for (const side of ['remote', 'local']) {
      const account = row[side];
      if (account?.expiresAt > 0 && account.expiresAt * 1000 < Date.now())
        details.append(text('p', `${side === 'remote' ? 'Remote' : 'Local'} access token expired`, 'expiry expired'));
    }
    const actions = text('div', '', 'account-actions');
    if (row.local) {
      const copy = text('button', 'Copy to remote', 'secondary'); copy.dataset.action = 'copy';
      copy.disabled = disabled;
      copy.addEventListener('click', () => perform(() => window.accounts.copy(row.local.id)));
      actions.append(copy);
    }
    if (row.remote) {
      const account = row.remote;
      const button = text('button', account.needsActivation ? 'Apply login' : account.active ? 'Active' : 'Switch'); button.dataset.action = 'switch';
      button.disabled = disabled || (account.active && !account.needsActivation);
      button.addEventListener('click', () => perform(() => window.accounts.switch(account.id)));
      actions.append(button);
    }
    card.append(details, actions); container.append(card);
  }
}
async function perform(operation) {
  if (awaiting) return;
  awaiting = true; render(lastState);
  try { lastState = await operation(); }
  catch { lastState = {...lastState, error: 'Could not finish the account request. Refresh or check switch status.'}; }
  finally { awaiting = false; render(lastState); }
}
window.accounts.onState(render);
$('#refresh').addEventListener('click', () => perform(() => window.accounts.read()));
$('#check').addEventListener('click', () => perform(() => window.accounts.checkSwitch()));
$('#recovery').addEventListener('click', () => perform(() => window.accounts.acknowledgeRecovery()));
void perform(() => window.accounts.read());
