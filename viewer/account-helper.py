#!/usr/bin/env python3
"""Private, stdin-only account operations. No network requests or token refreshes.

The Vitals store is read-only: its lock is process-local, not an interprocess
contract. Imports and saved outgoing credentials belong to our separate vault.
"""
import base64
import contextlib
import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid

LIMIT = 2 * 1024 * 1024


class AccountError(Exception):
    def __init__(self, message, recovery_required=False):
        super().__init__(message)
        self.recovery_required = recovery_required


def require(condition, message):
    if not condition:
        raise AccountError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def read_json(file):
    with Path(file).open('rb') as stream:
        data = stream.read(LIMIT + 1)
    require(len(data) <= LIMIT, 'Account file is too large.')
    value = json.loads(data)
    require(isinstance(value, dict), 'Invalid account file.')
    return value


def private_directory(directory):
    directory = Path(directory)
    require(not any(p.is_symlink() for p in [directory, *directory.parents]),
            'An account directory is a symbolic link. Use a regular private directory.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)


def atomic_json(file, value):
    file = Path(file)
    private_directory(file.parent)
    require(not file.is_symlink(), 'Refusing to replace a symbolic link.')
    fd, temporary = tempfile.mkstemp(prefix='.account-', dir=str(file.parent))
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
        directory = os.open(str(file.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def claims(token):
    require(isinstance(token, str) and 0 < len(token) < 100000, 'Missing or invalid OAuth token.')
    try:
        payload = token.split('.')[1]
        value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        require(isinstance(value, dict), 'Invalid token metadata.')
        return value
    except (ValueError, IndexError, UnicodeError):
        raise AccountError('Could not read OAuth identity metadata. Capture the account in Codex Vitals again.')


def identity(auth):
    require(isinstance(auth, dict) and isinstance(auth.get('tokens'), dict), 'A desktop OAuth profile is required.')
    tokens = auth['tokens']
    id_claims = claims(tokens.get('id_token'))
    access_claims = claims(tokens.get('access_token'))
    require(isinstance(tokens.get('refresh_token'), str) and 0 < len(tokens['refresh_token']) < 100000,
            'The account has no refresh token.')
    require(auth.get('auth_mode') in (None, 'chatgpt') and not auth.get('OPENAI_API_KEY'),
            'Only ChatGPT OAuth accounts are supported.')
    email = str(id_claims.get('email', '')).strip().lower()
    subject = str(id_claims.get('sub', '')).strip()
    namespace = 'https://api.openai.com/auth'
    id_account = id_claims.get(namespace, {}).get('chatgpt_account_id', '')
    access_account = access_claims.get(namespace, {}).get('chatgpt_account_id', '')
    account = tokens.get('account_id') or id_account or access_account
    require(email and subject and isinstance(account, str) and account.strip(),
            'The profile is missing its email, subject, or workspace identity.')
    require(all(not a or a == account for a in [id_account, access_account]),
            'The profile contains mismatched workspace credentials.')
    access_email = access_claims.get('https://api.openai.com/profile', {}).get('email')
    require(not access_email or str(access_email).lower() == email, 'The profile contains mismatched account credentials.')
    return {'id': digest([subject, account]), 'email': email, 'accountId': account,
            'subject': subject, 'expiresAt': access_claims.get('exp', 0),
            'issuedAt': access_claims.get('iat', 0)}


def freshness(auth):
    item = identity(auth)
    refreshed = 0
    try:
        refreshed = datetime.datetime.fromisoformat(auth.get('last_refresh', '').replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        pass
    return (float(item['issuedAt'] or 0), refreshed, float(item['expiresAt'] or 0))


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def usage_snapshot(snapshot):
    """Read only Vitals' reported windows; never invent a missing 5-hour quota.

    resetAfterSeconds is relative to when Vitals fetched the snapshot, not when
    this viewer reads it. An elapsed reset is not evidence of replenished quota.
    """
    observed = snapshot.get('lastRefreshEpoch')
    if not number(observed) or observed <= 0 or observed > time.time() + 300:
        return {}
    results = {}
    accounts = snapshot.get('accounts', [])
    if not isinstance(accounts, list):
        return results
    for account in accounts:
        if not isinstance(account, dict):
            continue
        email, separator, workspace = str(account.get('id', '')).partition('|')
        email = email.strip().lower()
        if not separator or not workspace or email != str(account.get('email', '')).strip().lower():
            continue
        result = {'status': 'error' if account.get('hasError') is True else 'unavailable',
                  'observedAt': observed, 'windows': []}
        if not account.get('hasError'):
            raw_windows = account.get('quotaWindows')
            if raw_windows is None:
                raw_windows = [
                    {'limitSeconds': seconds, 'remainingPercent': account.get(percent),
                     'resetAfterSeconds': account.get(reset)}
                    for seconds, percent, reset in [(18000, 'sessionFree', 'sessionResetSeconds'),
                                                    (604800, 'weeklyFree', 'weeklyResetSeconds')]]
            if isinstance(raw_windows, list):
                windows = {}
                for window in raw_windows:
                    if not isinstance(window, dict):
                        continue
                    duration, remaining, reset = (window.get(k) for k in ('limitSeconds', 'remainingPercent', 'resetAfterSeconds'))
                    if not number(duration) or not 0 < duration <= 366 * 86400 or not number(remaining):
                        continue
                    resets = observed + reset if number(reset) and 0 < reset <= 366 * 86400 else None
                    windows[duration] = {'limitSeconds': duration, 'remainingPercent': min(100, max(0, remaining)),
                                         'resetsAt': resets}
                result['windows'] = [windows[key] for key in sorted(windows)]
                if result['windows']:
                    result['status'] = 'available'
        results[(email, workspace)] = result
    return results


class Store:
    def __init__(self, home=None):
        self.home = Path(home or Path.home())
        self.root = self.home / '.local/share/codex-ssh-desktop/accounts'
        self.vitals = self.home / 'Library/Application Support/CodexVitals'
        self.live = self.home / '.codex/auth.json'

    @contextlib.contextmanager
    def lock(self):
        private_directory(self.root)
        file = self.root / 'operation.lock'
        require(not file.is_symlink(), 'Invalid account lock.')
        fd = os.open(str(file), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise AccountError('Another account operation is running on this Mac. Try again when it finishes.')
            yield fd
        finally:
            os.close(fd)

    def candidates(self):
        found = []
        skipped = 0
        profiles = {}
        try:
            profiles = read_json(self.vitals / 'accounts.json').get('profiles', {})
        except (OSError, ValueError, AccountError):
            pass
        if not isinstance(profiles, dict):
            profiles = {}
        files = [(p, 'Codex Vitals') for p in sorted((self.vitals / 'profiles').glob('*/auth.json'))]
        files += [(p, 'Copied / saved') for p in sorted((self.root / 'vault').glob('*/auth.json'))]
        if self.live.exists():
            files.append((self.live, 'Active Codex'))
        for file, source in files:
            try:
                auth = read_json(file)
                item = identity(auth)
                meta = {}
                if source != 'Active Codex':
                    try:
                        meta = read_json(file.with_name('meta.json'))
                    except (OSError, ValueError, AccountError):
                        pass
                entry = profiles.get(meta.get('source_profile_key'), {})
                if not isinstance(entry, dict):
                    entry = {}
                alias = entry.get('alias') or meta.get('alias') or item['email']
                # Vitals may refresh accounts.json before its desktop snapshot.
                # Reuse the captured id token only for the exact same identity.
                if (source == 'Codex Vitals' and entry.get('access') and entry.get('refresh')
                        and str(entry.get('email', '')).lower() == item['email']
                        and entry.get('accountId') == item['accountId']):
                    newer = json.loads(json.dumps(auth))
                    newer['tokens'].update(access_token=entry['access'], refresh_token=entry['refresh'])
                    if entry.get('idToken'):
                        newer['tokens']['id_token'] = entry['idToken']
                    try:
                        if identity(newer)['id'] == item['id'] and freshness(newer) > freshness(auth):
                            auth = newer
                    except (ValueError, TypeError, AccountError):
                        pass
                item = identity(auth)
                found.append({**item, 'name': str(alias)[:180], 'source': source, 'auth': auth})
            except (OSError, ValueError, TypeError, AttributeError, AccountError):
                skipped += 1
        return found, skipped

    def catalog(self):
        found, skipped = self.candidates()
        active = None
        active_revision = None
        selected = {}
        labels = {}
        sources = {}
        for item in found:
            key = item['id']
            sources.setdefault(key, set()).add(item['source'])
            if item['source'] != 'Active Codex':
                labels[key] = item['name']
            else:
                active = key
                active_revision = digest(item['auth'])
            old = selected.get(key)
            if old is None or freshness(item['auth']) >= freshness(old['auth']):
                selected[key] = item
        for key, item in selected.items():
            item['name'] = labels.get(key, item['name'])
            item['active'] = key == active
            item['needsActivation'] = item['active'] and digest(item['auth']) != active_revision
            item['sources'] = sorted(sources[key])
        return selected, skipped

    def list(self):
        catalog, skipped = self.catalog()
        fields = ('id', 'name', 'email', 'accountId', 'expiresAt', 'active', 'needsActivation', 'sources')
        usage = {}
        try:
            usage = usage_snapshot(read_json(self.vitals / 'accounts-snapshot.json'))
        except (OSError, ValueError, AccountError):
            pass
        return {'accounts': [{**{k: item[k] for k in fields},
                              'usage': usage.get((item['email'], item['accountId']),
                                                 {'status': 'unavailable', 'observedAt': None, 'windows': []})}
                             for item in catalog.values()],
                'skipped': skipped, 'vitalsInstalled': self.vitals.exists()}

    def selected(self, key):
        require(isinstance(key, str) and re.fullmatch(r'[a-f0-9]{64}', key), 'Invalid account selection.')
        catalog, _ = self.catalog()
        require(key in catalog, 'The selected account is no longer available. Refresh the accounts list.')
        return catalog[key]

    def save(self, auth, alias, source='copy'):
        item = identity(auth)
        directory = self.root / 'vault' / item['id']
        if source == 'outgoing account' and (directory / 'auth.json').exists():
            stored = read_json(directory / 'auth.json')
            if freshness(stored) > freshness(auth):
                return item['id']
        atomic_json(directory / 'auth.json', auth)
        require(digest(read_json(directory / 'auth.json')) == digest(auth), 'Credential copy verification failed.')
        atomic_json(directory / 'meta.json', {'alias': str(alias)[:180], 'source': source,
                                            'copiedAt': time.time(), 'account_id': item['accountId'],
                                            'email': item['email']})
        return item['id']

    def import_account(self, request):
        auth = request.get('auth')
        item = identity(auth)
        require(item['id'] == request.get('id'), 'The copied account does not match the selected account.')
        with self.lock():
            catalog, _ = self.catalog()
            existing = catalog.get(item['id'])
            if existing:
                require(freshness(auth) >= freshness(existing['auth']),
                        'The remote Mac has newer credentials for this account. Copy was cancelled.')
                atomic_json(self.root / 'backups' / (uuid.uuid4().hex + '.json'), existing['auth'])
            self.save(auth, request.get('name') or item['email'])
        return {'copied': True, 'activated': False}


def run_command(args, timeout=20):
    # Process output can include the auxiliary host's private connection token.
    # Never put it in an exception, job status, or diagnostic log.
    try:
        return subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise AccountError('A remote process command failed or timed out.')


class MacProcesses:
    def __init__(self, store, config):
        self.store = store
        require(sys.platform == 'darwin', 'Remote account switching requires macOS.')
        root = Path(config.get('remoteDirectory', ''))
        self.root = (root if root.is_absolute() else store.home / root).resolve()
        control = Path(config.get('remoteControlPath', ''))
        self.control = (control if control.is_absolute() else self.root / control).resolve()
        node = config.get('remoteNode', '')
        require(isinstance(node, str) and node and '\x00' not in node, 'Invalid remote Node executable.')
        if not node.startswith('/'):
            import shutil
            node = shutil.which(node, path='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
        require(node and Path(node).is_file() and self.control.is_file(), 'The remote runtime configuration is unavailable.')
        self.node = node
        build = read_json(self.control.parent / 'build-info.json')
        self.app = Path(build.get('app', ''))
        require(self.app.is_absolute() and self.app.is_dir(), 'The installed remote Codex app was not found.')
        import plistlib
        with (self.app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        require(info.get('CFBundleIdentifier') == 'com.openai.codex', 'The configured application is not Codex.')
        self.executable = self.app / 'Contents/MacOS' / info['CFBundleExecutable']
        self.engine = self.app / 'Contents/Resources/codex'
        require(self.engine.is_file() and self.executable.is_file(), 'The Codex executables are missing.')
        require(os.access(str(store.live.parent), os.W_OK), 'The remote credential directory is not writable.')
        require(not store.live.is_symlink(), 'The active credential file is a symbolic link.')
        self.runtime_pid = self.runtime()
        self.runtime_was_running = self.runtime_pid is not None

    def snapshot(self):
        result = run_command(['/bin/ps', '-axo', 'pid=,ppid=,uid=,lstart=,comm='])
        require(result.returncode == 0, 'Could not inspect remote processes.')
        rows = {}
        for line in result.stdout.decode(errors='replace').splitlines():
            parts = line.strip().split(None, 8)
            if len(parts) != 9 or not all(s.isdigit() for s in parts[:3]):
                continue
            pid, parent, uid = map(int, parts[:3])
            if uid == os.getuid() and pid != os.getpid():
                rows[pid] = {'parent': parent, 'start': ' '.join(parts[3:8]), 'exe': parts[8]}
        return rows

    def runtime(self):
        file = self.root / 'runtime/server.pid'
        if not file.exists():
            return None
        try:
            pid = int(file.read_text().strip())
        except ValueError:
            raise AccountError('The runtime PID file is invalid.')
        rows = self.snapshot()
        if pid not in rows:
            return None
        result = run_command(['/bin/ps', '-p', str(pid), '-o', 'command='])
        command = result.stdout.decode(errors='replace')
        require(re.search(r'(?:^|\s)' + re.escape(str(self.root / 'src/server/main.js')) + r'(?:\s|$)', command)
                and Path(rows[pid]['exe']).name == 'node',
                'The recorded runtime PID belongs to another process. Account switching was cancelled.')
        return pid

    def consumers(self, rows):
        roots = {pid for pid, item in rows.items() if (
            item['exe'].startswith(str(self.app) + '/')
            or Path(item['exe']).name in ('codex', 'codex-code-mode-host', 'codex-node-repl')
            or pid == self.runtime_pid)}
        changed = True
        while changed:
            children = {pid for pid, item in rows.items() if item['parent'] in roots}
            changed = not children.issubset(roots)
            roots |= children
        return {pid: rows[pid] for pid in roots}

    def signal_same(self, targets, sig):
        current = self.snapshot()
        for pid, item in targets.items():
            now = current.get(pid)
            if now and now['start'] == item['start'] and now['exe'] == item['exe']:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass

    def stop(self):
        initial = self.consumers(self.snapshot())
        # Shut down controllers first so they cannot respawn an engine mid-swap.
        controllers = {pid: row for pid, row in initial.items()
                       if pid == self.runtime_pid or row['exe'] == str(self.executable)}
        self.signal_same(controllers, signal.SIGTERM)
        time.sleep(2)
        self.signal_same(initial, signal.SIGTERM)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            remaining = self.consumers(self.snapshot())
            if not remaining:
                break
            time.sleep(.25)
        for _ in range(3):
            remaining = {**initial, **self.consumers(self.snapshot())}
            self.signal_same(remaining, signal.SIGKILL)
            time.sleep(.5)
        self.assert_stopped()
        pid_file = self.root / 'runtime/server.pid'
        if pid_file.exists() and self.runtime_pid is not None:
            require(pid_file.read_text().strip() == str(self.runtime_pid), 'The auxiliary runtime restarted during the switch.')
            pid_file.unlink()

    def assert_stopped(self):
        require(not self.consumers(self.snapshot()),
                'A remote Codex process is still running or restarted. Credentials were not changed.')

    def launch(self):
        result = run_command(['/usr/bin/open', '-n', str(self.app)])
        require(result.returncode == 0, 'macOS could not relaunch the remote Codex app.')
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if any(row['exe'] == str(self.executable) for row in self.snapshot().values()):
                return
            time.sleep(.5)
        raise AccountError('The remote Codex app did not appear after relaunch.')

    def reconnect_runtime(self):
        if not self.runtime_was_running:
            return
        result = run_command([self.node, str(self.control), 'ensure'], timeout=65)
        require(result.returncode == 0, 'Codex relaunched, but the auxiliary runtime needs a reconnect.')


def switch_account(store, key, processes, report=lambda phase: None):
    target = store.selected(key)
    if target['active'] and not target['needsActivation']:
        return {'switched': False, 'message': 'This is already the active remote account.'}
    # All validation and a recoverable backup precede the first process signal.
    original = read_json(store.live)
    identity(original)
    backup = store.root / 'backups' / (uuid.uuid4().hex + '.json')
    atomic_json(backup, original)
    changed = False
    stopped = False
    try:
        report('Stopping remote Codex tasks')
        stopped = True
        processes.stop()
        # Capture token rotations that occurred during graceful shutdown.
        original = read_json(store.live)
        previous = identity(original)
        atomic_json(backup, original)
        store.save(original, previous['email'], 'outgoing account')
        target = store.selected(key)
        processes.assert_stopped()
        report('Installing the selected credentials')
        changed = True
        atomic_json(store.live, target['auth'])
        require(digest(read_json(store.live)) == digest(target['auth']), 'Active credential verification failed.')
        report('Relaunching remote Codex')
        processes.launch()
        require(identity(read_json(store.live))['id'] == key, 'The active account changed unexpectedly after relaunch.')
    except Exception:
        if changed:
            report('Restoring the previous account')
            try:
                processes.stop()
                processes.assert_stopped()
                atomic_json(store.live, original)
                processes.launch()
                processes.reconnect_runtime()
            except Exception:
                raise AccountError('The switch failed and automatic recovery needs attention. A private auth backup is in ~/.local/share/codex-ssh-desktop/accounts/backups. Do not repeat the switch until remote Codex is checked.', recovery_required=True)
            raise AccountError('The switch failed. The previous account was restored and Codex was relaunched. Stopped tasks need to be resumed.')
        if stopped:
            try:
                processes.launch()
                processes.reconnect_runtime()
            except Exception:
                raise AccountError('Credentials were not changed. Remote Codex may need to be reopened manually; stopped tasks need to be resumed.', recovery_required=True)
        raise
    report('Reconnecting the remote viewer')
    try:
        processes.reconnect_runtime()
    except AccountError:
        return {'switched': True, 'reconnectRequired': True,
                'message': 'The account changed and Codex relaunched. Use Connection → Reconnect to restore the viewer. Stopped tasks must be resumed manually.'}
    return {'switched': True, 'message': 'The account changed and remote Codex relaunched. Stopped tasks must be resumed manually.'}


def job_file(store, job):
    require(isinstance(job, str) and re.fullmatch(r'[a-f0-9]{32}', job), 'Invalid account operation ID.')
    return store.root / 'jobs' / (job + '.json')


def start_switch(store, request):
    require(request.get('confirmed') is True, 'Switching requires confirmation that all remote Codex tasks will stop.')
    job = request.get('job')
    file = job_file(store, job)
    if file.exists():
        previous = read_json(file)
        require(previous.get('targetId') == request.get('id'), 'The operation ID belongs to another account.')
        return previous
    with store.lock():
        if file.exists():
            previous = read_json(file)
            require(previous.get('targetId') == request.get('id'), 'The operation ID belongs to another account.')
            return previous
        target = store.selected(request.get('id'))
        processes = MacProcesses(store, request.get('config', {}))
        state = {'job': job, 'targetId': target['id'], 'state': 'running', 'phase': 'Preparing account switch', 'startedAt': time.time()}
        atomic_json(file, state)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        try:
            child = os.fork()
        except OSError:
            state.update(state='failed', message='Could not start the remote account worker. No processes or credentials were changed.')
            atomic_json(file, state)
            return state
        if child:
            return state
        # The child inherits the operation lock and survives a dropped SSH link.
        try:
            os.setsid()
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
            with open(os.devnull, 'r+b', buffering=0) as null:
                for fd in (0, 1, 2):
                    os.dup2(null.fileno(), fd)
            state['pid'] = os.getpid()
            def report(phase):
                state['phase'] = phase
                atomic_json(file, state)
            report('Preparing account switch')
            result = switch_account(store, target['id'], processes, report)
            state.update(result, state='complete', finishedAt=time.time())
        except Exception as error:
            state.update(state='failed', finishedAt=time.time(),
                         recoveryRequired=getattr(error, 'recovery_required', False),
                         message=str(error) if isinstance(error, AccountError) else 'The remote account operation failed. Inspect remote Codex before retrying.')
        try:
            atomic_json(file, state)
        finally:
            os._exit(0)


def handle(store, request):
    require(isinstance(request, dict), 'Invalid account request.')
    action = request.get('action')
    if action == 'list':
        return store.list()
    if action == 'preflight':
        processes = MacProcesses(store, request.get('config', {}))
        return {'ready': True, 'runtimeRunning': processes.runtime_was_running,
                'codexProcessCount': len(processes.consumers(processes.snapshot()))}
    if action == 'export':
        item = store.selected(request.get('id'))
        return {key: item[key] for key in ('id', 'name', 'auth')}
    if action == 'import':
        return store.import_account(request)
    if action == 'start-switch':
        return start_switch(store, request)
    if action == 'job':
        file = job_file(store, request.get('job'))
        if not file.exists():
            return {'state': 'missing'}
        state = read_json(file)
        if state.get('state') == 'running' and time.time() - state.get('startedAt', 0) > 300:
            return {**state, 'state': 'failed', 'recoveryRequired': True,
                    'message': 'The remote switch did not finish within five minutes. Inspect remote Codex and the private backup before reconnecting.'}
        return state
    if action == 'acknowledge-recovery':
        require(request.get('confirmed') is True, 'Recovery must be acknowledged explicitly.')
        with store.lock():
            state = handle(store, {'action': 'job', 'job': request.get('job')})
            require(state.get('state') == 'failed', 'The account worker has not finished. Check its status again.')
            state.update(recoveryRequired=False, recoveryAcknowledgedAt=time.time())
            atomic_json(job_file(store, request['job']), state)
        return {'acknowledged': True}
    raise AccountError('Unknown account operation.')


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        require(len(raw) <= LIMIT, 'Account request is too large.')
        response = handle(Store(), json.loads(raw))
    except Exception as error:
        response = {'error': str(error) if isinstance(error, AccountError)
                    else 'Could not read or update account data. Check the account files and remote configuration.'}
    print(json.dumps(response))
