#!/usr/bin/env python3
"""Run the isolated auth matrix and retain observations without assuming a diagnosis."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--claude', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--refresh-loss', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
cases = []
for expiry in [-60, 120, 3600]:
    for delay in [0, 0.5, 3]:
        for trial in range(2):
            cases.append((f'status-{expiry}-{delay}-{trial}', [
                '--expires-in', str(expiry), '--delay', str(delay),
            ]))
for delay in [0, 0.5, 3]:
    cases.append((f'control-{delay}', ['--print-control', '--delay', str(delay)]))
for store in ['zeroed', 'empty', 'absent']:
    cases.append((f'store-{store}', ['--store', store, '--expires-in', '3600']))
cases.append(('api-route', ['--route', 'api', '--expires-in', '3600']))
if args.refresh_loss:
    cases = []
    for delay in [0, 0.5, 3]:
        for offline in [False, True]:
            cases.append((f'refresh-{delay}-offline-{offline}', [
                '--cold-config', '--follow-print', '--delay', str(delay),
                *(['--offline-preflight'] if offline else []),
            ]))
results = []
for name, options in cases:
    command = [sys.executable, str(Path(__file__).with_name('reproduce.py')),
               '--claude', str(args.claude), *options]
    run = subprocess.run(command, capture_output=True, text=True)
    (args.output / f'{name}.stdout').write_text(run.stdout)
    (args.output / f'{name}.stderr').write_text(run.stderr)
    if run.returncode != 0:
        raise SystemExit(f'{name}: fixture failed; inspect {args.output}')
    report = json.loads(run.stdout)
    result = {key: report[key] for key in [
        'binarySha256', 'expiresIn', 'delay', 'storeState', 'route', 'printControl',
        'newSaved', 'savedIn', 'keychainCanaryDenied', 'events',
        'coldConfig', 'configPaddingBytes', 'offlinePreflight', 'preflightPreservedTokens',
    ]}
    result['case'] = name
    if report['printControl']:
        result['output'] = report['stdout']
        if not report['newSaved']:
            raise SystemExit(f'{name}: refresh control did not persist; matrix is inconclusive')
    else:
        auth = json.loads(report['stdout'])
        result['auth'] = {key: auth[key] for key in [
            'loggedIn', 'authMethod', 'apiProvider', 'apiKeySource',
        ] if key in auth}
    continuation = report['continuation']
    if continuation is not None:
        result['afterTask'] = {key: continuation[key] for key in ['accessPresent', 'refreshPresent']}
        result['afterTask']['auth'] = {key: continuation['auth'][key]
                                      for key in ['loggedIn', 'authMethod', 'apiProvider']}
    if report['offlinePreflight']:
        preflight_exit = next(event['seconds'] for event in report['events'] if event['event'] == 'process_exit')
        if (any(event['event'] == 'refresh_consumed' and event['seconds'] < preflight_exit
                for event in report['events']) or not report['preflightPreservedTokens']
                or not report['newSaved'] or not continuation['auth']['loggedIn']):
            raise SystemExit(f'{name}: offline preflight did not preserve subsequent authentication')
    results.append(result)
    (args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, result.get('auth', {}), 'saved', report['savedIn'], flush=True)
