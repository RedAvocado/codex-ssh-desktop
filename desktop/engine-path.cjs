const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// Recent desktop releases moved Resources/codex into codex-cli/CodexCLI.app.
// A separately installed CLI is a fallback. Do not modify the signed app.
function findCodexCli(resources, {exists = fs.existsSync, executable = path => {
  try {fs.accessSync(path, fs.constants.X_OK); return true;} catch {return false;}
}, run = execFileSync} = {}) {
  const candidates = [
    path.join(resources, 'codex-cli/CodexCLI.app/Contents/MacOS/codex'),
    path.join(resources, 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ];
  for (const candidate of candidates) {
    if (!exists(candidate) || !executable(candidate)) continue;
    try {
      const version = String(run(candidate, ['--version'], {encoding:'utf8', timeout:5000, stdio:['ignore','pipe','ignore']})).trim();
      if (!/^codex-cli \d+\.\d+\.\d+/.test(version)) continue;
      const help = String(run(candidate, ['app-server','--help'], {encoding:'utf8', timeout:5000, stdio:['ignore','pipe','ignore']}));
      if (help.includes('Run the app server') || help.includes('Usage: codex app-server')) return candidate;
    } catch { /* Try the next installed CLI. */ }
  }
  throw Error('No working Codex CLI with app-server support was found. Install or repair the Codex CLI.');
}

module.exports = {findCodexCli};
