#!/usr/bin/python3
"""Handle mock security writes through a fixture file, never the operating system."""

import json
import os
from pathlib import Path
import shlex
import sys
import time

root = Path(os.environ['PSTACK_MOCK_ROOT'])
args = sys.argv[1:]
if args == ['-i']:
    args = shlex.split(sys.stdin.read())


def value(flag):
    return args[args.index(flag) + 1] if flag in args else None


operation = args[0] if args else ''
with (root / 'storage-events.jsonl').open('a') as log:
    log.write(json.dumps({'operation': operation, 'time': time.time(), 'service': value('-s')}) + '\n')
if operation == 'show-keychain-info':
    sys.exit(0)
if value('-a') != os.environ['USER'] or value('-s') != os.environ['PSTACK_MOCK_SERVICE']:
    sys.exit(44)
store = root / 'mock-credential.json'
if operation == 'find-generic-password':
    if not store.exists():
        sys.exit(44)
    print(store.read_text())
    sys.exit(0)
if operation == 'add-generic-password':
    data = bytes.fromhex(value('-X')).decode() if '-X' in args else value('-w')
    json.loads(data)
    store.write_text(data)
    sys.exit(0)
if operation == 'delete-generic-password':
    store.unlink(missing_ok=True)
    sys.exit(0)
sys.exit(64)
