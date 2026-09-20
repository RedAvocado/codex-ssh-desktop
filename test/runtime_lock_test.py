import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('runtime_lock', Path(__file__).parents[1] / 'desktop/runtime-lock.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeLockTests(unittest.TestCase):
    def test_maintenance_and_other_clients_cannot_restart_during_an_account_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = runtime.accounts.Store(Path(directory).resolve())
            calls = []
            def execute(command):
                calls.append(command)
                with self.assertRaises(runtime.accounts.AccountError):
                    with runtime.accounts.Store(store.home).lock():
                        self.fail('Another operation acquired the lock during startup')
                return SimpleNamespace(returncode=0)
            arguments = ['/fixture/node', '/fixture/control.cjs', 'ensure']
            with store.lock():
                with self.assertRaises(runtime.accounts.AccountError):
                    runtime.run_locked(arguments, store, execute)
                self.assertIsNotNone(store.operation_lock_fd)
            self.assertEqual(calls, [])
            self.assertEqual(runtime.run_locked(arguments, store, execute), 0)
            self.assertEqual(calls, [[*arguments, '--account-operation-lock-held']])
            self.assertIsNone(store.operation_lock_fd)
