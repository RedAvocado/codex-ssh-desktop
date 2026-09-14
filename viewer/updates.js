const $ = id => document.getElementById(id);
let current;
function render(state) {
  current = state;
  const texts = {
    checking: ['Checking for updates…', `Installed version: ${state.currentVersion}`],
    available: [`Version ${state.nextVersion} is available`, state.canDownload ? `Download it here, then choose when to install. You have ${state.currentVersion}.` : state.reason],
    current: ['You’re up to date', `Codex SSH Desktop ${state.currentVersion} is installed.`],
    unavailable: ['No published release is available', `Installed version: ${state.currentVersion}`],
    downloading: ['Downloading update…', `${Math.round((state.progress || 0) * 100)}% downloaded${state.progress === 1 ? ' · Verifying the app…' : ''}`],
    ready: ['Ready to install', `Version ${state.nextVersion} has been downloaded and verified. Install now or close this window to keep working.`],
    installing: ['Installing update…', 'The local viewer will close and reopen automatically.'],
    error: ['Could not update', 'You can try again or open the release page.'],
  };
  const [title, detail] = texts[state.phase] || texts.error;
  $('title').textContent = title; $('detail').textContent = detail; $('error').textContent = state.error || '';
  $('progress').hidden = state.phase !== 'downloading'; $('progress').value = state.progress || 0;
  const primary = state.phase === 'available' && state.canDownload ? ['Download Update', 'download'] : state.phase === 'ready' ? ['Install and Restart', 'install'] : state.phase === 'error' ? ['Try Again', 'check'] : null;
  $('primary').hidden = !primary;
  if (primary) { $('primary').textContent = primary[0]; $('primary').dataset.action = primary[1]; }
  $('releases').hidden = ['checking', 'downloading', 'installing', 'current'].includes(state.phase);
  $('cancel').disabled = state.phase === 'installing'; $('cancel').textContent = state.phase === 'downloading' ? 'Cancel Download' : 'Close';
}
async function action(kind) { try { render(await window.updates.action(kind)); } catch (error) { render({...current, error: error.message}); } }
$('primary').onclick = () => action($('primary').dataset.action);
$('cancel').onclick = () => action('cancel');
$('releases').onclick = () => action('releases');
window.updates.onState(render);
window.updates.read().then(render);
