#!/usr/bin/env python3
"""Serialize runtime start/stop with private account changes on this Mac."""
import importlib.util
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('account_helper', Path(__file__).resolve().parents[1] / 'viewer/account-helper.py')
accounts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(accounts)


def run_locked(arguments, store=None, execute=subprocess.run):
    accounts.require(len(arguments) == 3 and arguments[2] in ('ensure', 'stop'), 'Invalid runtime lock request.')
    # The wrapper remains alive, holding flock until control finishes. A second
    # ensure cannot race startup, and maintenance cannot start during a switch.
    with (store or accounts.Store()).lock():
        return execute([*arguments, '--account-operation-lock-held']).returncode


if __name__ == '__main__':
    try:
        sys.exit(run_locked(sys.argv[1:]))
    except accounts.AccountError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
