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
  for (const side of ['remote', 'local']) {
    const container = $(`#${side}`), data = state.catalog?.[side];
    container.replaceChildren();
    if (!data) { container.append(text('p', 'Loading accounts…', 'empty')); continue; }
    if (data.error) container.append(text('p', data.error, 'empty'));
    if (!data.error && !data.accounts.length) container.append(text('p', side === 'local'
      ? 'No desktop OAuth profiles found. Capture an account in Codex Vitals, then refresh.'
      : 'No saved accounts found. Copy one from this Mac to get started.', 'empty'));
    for (const account of data.accounts) {
      const card = text('article', '', 'account');
      card.append(text('p', account.name, 'name'), text('p', account.email, 'email'),
        text('p', `Workspace ${account.accountId}`, 'workspace'));
      const actions = text('div', '', 'account-actions');
      const expired = account.expiresAt > 0 && account.expiresAt * 1000 < Date.now();
      actions.append(text('span', expired ? 'Access token expired' : account.active ? side === 'remote' ? 'Active remotely' : 'Active locally' : 'Saved account', `expiry${expired ? ' expired' : ''}`));
      const button = text('button', side === 'local' ? 'Copy to remote' : account.needsActivation ? 'Apply login' : account.active ? 'Active' : 'Switch');
      button.disabled = disabled || (side === 'remote' && account.active && !account.needsActivation);
      button.addEventListener('click', () => perform(() => side === 'local' ? window.accounts.copy(account.id) : window.accounts.switch(account.id)));
      actions.append(button); card.append(actions); container.append(card);
    }
    if (data.skipped) container.append(text('p', `${data.skipped} incomplete or unsupported profile(s) were skipped. Capture them again in Codex Vitals.`, 'empty'));
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
