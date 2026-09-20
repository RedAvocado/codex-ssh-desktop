import base64
import importlib.util
import json
import os
from pathlib import Path
import signal
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('account_helper', Path(__file__).parents[1] / 'viewer/account-helper.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def jwt(payload):
    return 'test.' + base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=') + '.signature'


def auth(email='first@example.test', account='workspace-a', issued=100, refresh='synthetic-refresh-a'):
    payload = {'sub': email, 'email': email, 'iat': issued, 'exp': issued + 3600,
               'https://api.openai.com/auth': {'chatgpt_account_id': account}}
    return {'auth_mode': 'chatgpt', 'OPENAI_API_KEY': None, 'last_refresh': '2026-01-01T00:00:00Z',
            'tokens': {'id_token': jwt(payload), 'access_token': jwt(payload), 'account_id': account, 'refresh_token': refresh}}


class FakeProcesses:
    def __init__(self, store=None, config=None):
        self.events = []
        self.store = store
        self.launch_failures = 0
        self.stop_error = False
        self.rotate = None

    def stop(self):
        self.events.append('stop')
        if self.stop_error:
            raise helper.AccountError('A process remains running.')
        if self.rotate:
            helper.atomic_json(self.store.live, self.rotate)
            self.rotate = None

    def assert_stopped(self):
        self.events.append('verify stopped')

    def launch(self):
        self.events.append('launch')
        if self.launch_failures:
            self.launch_failures -= 1
            raise helper.AccountError('Launch failed.')

    def reconnect_runtime(self):
        self.events.append('reconnect')


class AccountsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        # macOS /var resolves to /private/var; the vault rejects symlink parents.
        self.store = helper.Store(Path(self.temp.name).resolve())
        self.original = auth()
        helper.atomic_json(self.store.live, self.original)
        self.target = auth('second@example.test', 'workspace-b', refresh='synthetic-refresh-b')
        self.target_id = self.store.save(self.target, 'Second account')

    def tearDown(self):
        self.temp.cleanup()

    def capture(self, value, alias='Vitals account'):
        folder = self.store.vitals / 'profiles' / helper.identity(value)['id']
        helper.atomic_json(folder / 'auth.json', value)
        helper.atomic_json(folder / 'meta.json', {'source_profile_key': 'profile-key'})
        helper.atomic_json(self.store.vitals / 'accounts.json', {'version': 1, 'profiles': {'profile-key': {
            'alias': alias, 'email': helper.identity(value)['email'], 'accountId': helper.identity(value)['accountId']}}})

    def test_catalog_only_exposes_metadata_and_keeps_workspaces_separate(self):
        self.capture(auth(account='workspace-c'))
        result = self.store.list()
        self.assertEqual(len(result['accounts']), 3)
        self.assertEqual(sum(a['active'] for a in result['accounts']), 1)
        serialized = json.dumps(result)
        for secret in ['access_token', 'refresh_token', 'id_token', 'synthetic-refresh', 'signature']:
            self.assertNotIn(secret, serialized)

    def test_usage_uses_snapshot_time_and_exact_reported_windows(self):
        observed = 1789400000
        snapshot = {'lastRefreshEpoch': observed, 'accounts': [{
            'id': 'first@example.test|workspace-a', 'email': 'first@example.test', 'hasError': False,
            'sessionFree': 100, 'sessionResetSeconds': 0,
            'quotaWindows': [{'limitSeconds': 604800, 'remainingPercent': 8, 'resetAfterSeconds': 3600}]}]}
        helper.atomic_json(self.store.vitals / 'accounts-snapshot.json', snapshot)
        listed = self.store.list()['accounts']
        reading = next(a['usage'] for a in listed if a['email'] == 'first@example.test')
        self.assertEqual(reading['status'], 'available')
        self.assertEqual(reading['observedAt'], observed)
        self.assertEqual(reading['windows'], [{'limitSeconds': 604800, 'remainingPercent': 8, 'resetsAt': observed + 3600}])
        self.assertEqual(next(a['usage']['status'] for a in listed if a['email'] == 'second@example.test'), 'unavailable')

    def test_usage_cannot_match_another_workspace_with_the_same_email(self):
        snapshot = {'lastRefreshEpoch': 1789400000, 'accounts': [{
            'id': 'first@example.test|another-workspace', 'email': 'first@example.test', 'hasError': False,
            'quotaWindows': [{'limitSeconds': 604800, 'remainingPercent': 8, 'resetAfterSeconds': 3600}]}]}
        helper.atomic_json(self.store.vitals / 'accounts-snapshot.json', snapshot)
        self.assertTrue(all(a['usage']['status'] == 'unavailable' for a in self.store.list()['accounts']))

    def test_usage_errors_and_missing_windows_do_not_become_zero_or_full_quota(self):
        entry = {'id': 'first@example.test|workspace-a', 'email': 'first@example.test', 'hasError': True,
                 'sessionFree': 0, 'weeklyFree': 0, 'sessionResetSeconds': 0, 'weeklyResetSeconds': 0}
        snapshot = {'lastRefreshEpoch': 1789400000, 'accounts': [entry]}
        reading = helper.usage_snapshot(snapshot)[('first@example.test', 'workspace-a')]
        self.assertEqual(reading['status'], 'error')
        self.assertEqual(reading['windows'], [])
        entry.update(hasError=False, quotaWindows=[])
        self.assertEqual(helper.usage_snapshot(snapshot)[('first@example.test', 'workspace-a')]['windows'], [])
        snapshot['lastRefreshEpoch'] = None
        self.assertEqual(helper.usage_snapshot(snapshot), {})

    def test_legacy_usage_preserves_real_zero_percent_and_unknown_reset(self):
        snapshot = {'lastRefreshEpoch': 1789400000, 'accounts': [{
            'id': 'first@example.test|workspace-a', 'email': 'first@example.test', 'hasError': False,
            'sessionFree': 0, 'weeklyFree': 54, 'sessionResetSeconds': 0, 'weeklyResetSeconds': 3600}]}
        windows = helper.usage_snapshot(snapshot)[('first@example.test', 'workspace-a')]['windows']
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0]['remainingPercent'], 0)
        self.assertIsNone(windows[0]['resetsAt'])

    def test_import_is_atomic_private_and_does_not_activate_or_edit_vitals(self):
        self.capture(self.target)
        vitals_before = (self.store.vitals / 'accounts.json').read_bytes()
        updated = auth('second@example.test', 'workspace-b', 200, 'synthetic-new-refresh')
        self.assertEqual(self.store.import_account({'id': self.target_id, 'auth': updated, 'name': 'Updated'}),
                         {'copied': True, 'activated': False})
        self.assertEqual(helper.read_json(self.store.live), self.original)
        self.assertEqual((self.store.vitals / 'accounts.json').read_bytes(), vitals_before)
        self.assertEqual(self.store.selected(self.target_id)['auth'], updated)
        self.assertEqual(len(list((self.store.root / 'backups').glob('*.json'))), 1)
        for file in self.store.root.rglob('*.json'):
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_old_or_wrong_identity_import_is_refused(self):
        for value, key in [(auth('second@example.test', 'workspace-b', 50), self.target_id),
                           (self.target, helper.identity(self.original)['id'])]:
            with self.assertRaises(helper.AccountError):
                self.store.import_account({'id': key, 'auth': value})
        self.assertEqual(helper.read_json(self.store.live), self.original)

    def test_mixed_workspace_credentials_are_rejected(self):
        wrong = auth(account='other-workspace')
        wrong['tokens']['account_id'] = 'workspace-a'
        with self.assertRaises(helper.AccountError):
            helper.identity(wrong)

    def test_corrupt_token_timestamps_are_skipped_without_breaking_other_accounts(self):
        self.capture(self.original)
        for bad in ['invalid', [], True, None, -1, float('inf'), 10 ** 400]:
            value = auth()
            payload = helper.claims(value['tokens']['access_token'])
            payload['iat'] = bad
            value['tokens']['access_token'] = jwt(payload)
            helper.atomic_json(self.store.live, value)
            result = self.store.list()
            self.assertEqual(len(result['accounts']), 2)
            self.assertTrue(any(item['id'] == self.target_id for item in result['accounts']))
            with self.assertRaises(helper.AccountError):
                helper.identity(value)

    def test_vitals_newer_token_pair_is_exported_without_modifying_vitals(self):
        self.capture(self.target)
        file = self.store.vitals / 'accounts.json'
        root = helper.read_json(file)
        newer = auth('second@example.test', 'workspace-b', 200, 'rotated-refresh')
        root['profiles']['profile-key'].update(access=newer['tokens']['access_token'], refresh='rotated-refresh')
        helper.atomic_json(file, root)
        before = file.read_bytes()
        exported = self.store.selected(self.target_id)['auth']
        self.assertEqual(exported['tokens']['access_token'], newer['tokens']['access_token'])
        self.assertEqual(exported['tokens']['refresh_token'], 'rotated-refresh')
        self.assertEqual(file.read_bytes(), before)

    def test_symlink_destination_and_concurrent_operation_are_refused(self):
        destination = self.store.root / 'link.json'
        destination.symlink_to(self.store.live)
        with self.assertRaises(helper.AccountError):
            helper.atomic_json(destination, self.target)
        with self.store.lock():
            with self.assertRaises(helper.AccountError):
                self.store.import_account({'id': self.target_id, 'auth': self.target})

    def test_switch_preserves_rotation_during_shutdown_and_relaunches(self):
        processes = FakeProcesses(self.store)
        latest = auth(issued=300, refresh='latest-outgoing-refresh')
        processes.rotate = latest
        result = helper.switch_account(self.store, self.target_id, processes)
        self.assertTrue(result['switched'])
        self.assertEqual(helper.read_json(self.store.live), self.target)
        self.assertEqual(self.store.selected(helper.identity(latest)['id'])['auth'], latest)
        self.assertEqual(processes.events, ['stop', 'verify stopped', 'launch', 'reconnect'])

    def test_launch_failure_rolls_back_credentials(self):
        processes = FakeProcesses(self.store)
        processes.launch_failures = 1
        with self.assertRaisesRegex(helper.AccountError, 'previous account was restored'):
            helper.switch_account(self.store, self.target_id, processes)
        self.assertEqual(helper.read_json(self.store.live), self.original)
        self.assertEqual(processes.events.count('stop'), 2)
        self.assertEqual(processes.events.count('launch'), 2)

    def test_saving_outgoing_account_keeps_a_newer_previously_copied_pair(self):
        newer = auth(issued=400, refresh='newer-copied-refresh')
        outgoing_id = self.store.save(newer, 'Fresh copy')
        helper.switch_account(self.store, self.target_id, FakeProcesses(self.store))
        self.assertEqual(self.store.selected(outgoing_id)['auth'], newer)

    def test_new_credentials_can_be_applied_to_the_already_active_account(self):
        newer = auth(issued=400, refresh='newer-active-refresh')
        key = self.store.save(newer, 'Fresh login')
        self.assertTrue(self.store.selected(key)['needsActivation'])
        result = helper.switch_account(self.store, key, FakeProcesses(self.store))
        self.assertTrue(result['switched'])
        self.assertEqual(helper.read_json(self.store.live), newer)
        self.assertFalse(self.store.selected(key)['needsActivation'])

    def test_recovery_failure_is_reported_and_cannot_be_mistaken_for_success(self):
        processes = FakeProcesses(self.store)
        processes.launch_failures = 2
        with self.assertRaises(helper.AccountError) as raised:
            helper.switch_account(self.store, self.target_id, processes)
        self.assertTrue(raised.exception.recovery_required)
        self.assertTrue(list((self.store.root / 'backups').glob('*.json')))

    def test_remaining_processes_prevent_credential_write(self):
        processes = FakeProcesses(self.store)
        processes.stop_error = True
        with self.assertRaises(helper.AccountError):
            helper.switch_account(self.store, self.target_id, processes)
        self.assertEqual(helper.read_json(self.store.live), self.original)

    def test_missing_target_fails_before_stopping_and_active_is_noop(self):
        processes = FakeProcesses(self.store)
        with self.assertRaises(helper.AccountError):
            helper.switch_account(self.store, '0' * 64, processes)
        result = helper.switch_account(self.store, helper.identity(self.original)['id'], processes)
        self.assertFalse(result['switched'])
        self.assertEqual(processes.events, [])

    def test_confirmation_required_and_durable_job_is_idempotent(self):
        request = {'id': self.target_id, 'job': 'a' * 32, 'config': {}}
        with self.assertRaises(helper.AccountError):
            helper.start_switch(self.store, request)
        request['confirmed'] = True
        with patch.object(helper, 'MacProcesses', FakeProcesses):
            state = helper.start_switch(self.store, request)
            self.assertEqual(state['state'], 'running')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = helper.handle(self.store, {'action': 'job', 'job': request['job']})
                if state['state'] != 'running':
                    break
                time.sleep(.05)
            self.assertEqual(state['state'], 'complete')
            self.assertEqual(helper.start_switch(self.store, request), state)
        self.assertEqual(helper.read_json(self.store.live), self.target)

    def test_detached_worker_survives_ssh_hangup_and_holds_lock(self):
        class SlowProcesses(FakeProcesses):
            def stop(self):
                time.sleep(.4)
                super().stop()
        request = {'id': self.target_id, 'job': 'b' * 32, 'config': {}, 'confirmed': True}
        with patch.object(helper, 'MacProcesses', SlowProcesses):
            helper.start_switch(self.store, request)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = helper.handle(self.store, {'action': 'job', 'job': request['job']})
                if state.get('pid'):
                    break
                time.sleep(.01)
            self.assertIn('pid', state)
            with self.assertRaises(helper.AccountError):
                self.store.import_account({'id': self.target_id, 'auth': self.target})
            os.kill(state['pid'], signal.SIGHUP)
            while time.monotonic() < deadline:
                state = helper.handle(self.store, {'action': 'job', 'job': request['job']})
                if state['state'] != 'running':
                    break
                time.sleep(.05)
            self.assertEqual(state['state'], 'complete')

    def test_process_scope_includes_descendants_but_excludes_unrelated_apps(self):
        processes = object.__new__(helper.MacProcesses)
        processes.app = Path('/Applications/Codex.app')
        processes.runtime_pid = 10
        rows = {10: {'exe': '/usr/local/bin/node', 'parent': 1},
                11: {'exe': '/Applications/Codex.app/Contents/MacOS/Codex', 'parent': 1},
                12: {'exe': '/usr/bin/python3', 'parent': 11},
                13: {'exe': '/usr/bin/git', 'parent': 12},
                14: {'exe': '/Applications/Chrome.app/Contents/MacOS/Chrome', 'parent': 1},
                15: {'exe': '/usr/local/bin/node', 'parent': 1}}
        self.assertEqual(set(processes.consumers(rows)), {10, 11, 12, 13})

    def test_recovery_hold_needs_explicit_acknowledgement_after_worker_finishes(self):
        job = 'c' * 32
        file = helper.job_file(self.store, job)
        helper.atomic_json(file, {'job': job, 'state': 'failed', 'recoveryRequired': True})
        request = {'action': 'acknowledge-recovery', 'job': job}
        with self.assertRaises(helper.AccountError):
            helper.handle(self.store, request)
        request['confirmed'] = True
        with self.store.lock():
            with self.assertRaises(helper.AccountError):
                helper.handle(self.store, request)
        self.assertTrue(helper.handle(self.store, request)['acknowledged'])
        self.assertFalse(helper.read_json(file)['recoveryRequired'])

    def test_pid_reuse_is_not_signalled(self):
        processes = object.__new__(helper.MacProcesses)
        previous = {42: {'exe': '/usr/bin/codex', 'start': 'yesterday'}}
        processes.snapshot = lambda: {42: {'exe': '/usr/bin/codex', 'start': 'today'}}
        with patch.object(os, 'kill') as kill:
            processes.signal_same(previous, signal.SIGKILL)
            kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
