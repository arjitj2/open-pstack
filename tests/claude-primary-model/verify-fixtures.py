import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--runner', type=Path, required=True)
parser.add_argument('--parent', choices=['codex', 'claude'], required=True)
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=False)
model = 'claude-haiku-4-5-20251001'
other = 'claude-opus-5-5'
private = 'PRIVATE_TRANSCRIPT_MUST_NOT_APPEAR_IN_RECEIPT'
mock = args.evidence / 'bin'
mock.mkdir()
cli = mock / 'claude'
cli.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\nsys.stdout.write(Path(os.environ["PSTACK_STREAM_FIXTURE"]).read_text())\n')
cli.chmod(0o755)
prompt = args.evidence / 'prompt.txt'
prompt.write_text('Synthetic provider fixture. No inference occurs.')


def assistant(reported, owner=None):
    return {'type': 'assistant', 'session_id': 'fixture-session',
            'parent_tool_use_id': owner,
            'message': {'role': 'assistant', 'model': reported,
                        'content': [{'type': 'text', 'text': private}]}}


result = {'type': 'result', 'subtype': 'success', 'is_error': False,
          'session_id': 'fixture-session', 'result': 'FIXTURE_OK',
          'usage': {'input_tokens': 5, 'output_tokens': 2},
          'total_cost_usd': 0.01,
          'modelUsage': {model: {'outputTokens': 1}, other: {'outputTokens': 100}}}
cases = {
    'primary-with-helper': ([assistant(model), assistant(other, 'helper-tool'), result], 'complete'),
    'requested-only-helper': ([assistant(other), assistant(model, 'helper-tool'), result], 'malformed-output'),
    'usage-only': ([result], 'malformed-output'),
    'conflicting-primary': ([assistant(model), assistant(other), result], 'malformed-output'),
}
summary = []
for name, (events, status) in cases.items():
    stream = args.evidence / (name + '.jsonl')
    stream.write_text(''.join(json.dumps(event) + '\n' for event in events))
    receipt = args.evidence / (name + '.receipt.json')
    output = args.evidence / (name + '.output.txt')
    env = dict(os.environ)
    env['PATH'] = str(mock.resolve()) + os.pathsep + env['PATH']
    env['PSTACK_STREAM_FIXTURE'] = str(stream.resolve())
    command = ['bun', str(args.runner.resolve()), '--parent', args.parent,
               '--provider', 'claude', '--model', model, '--effort', 'low',
               '--mode', 'read-only', '--prompt', str(prompt.resolve()),
               '--cwd', str(args.evidence.resolve()), '--output', str(output.resolve()),
               '--receipt', str(receipt.resolve()), '--api-spend', 'deny']
    run = subprocess.run(command, env=env, text=True, capture_output=True)
    (args.evidence / (name + '.command.json')).write_text(json.dumps(command))
    (args.evidence / (name + '.stdout')).write_text(run.stdout)
    (args.evidence / (name + '.stderr')).write_text(run.stderr)
    actual = json.loads(receipt.read_text())
    assert actual['status'] == status, (name, actual)
    assert private not in receipt.read_text(), name
    assert '--verbose' in actual['argv'] and 'stream-json' in actual['argv'], name
    if status == 'complete':
        assert run.returncode == 0 and actual['modelVerified'] is True
        assert actual['reportedModel'] == model and output.read_text() == 'FIXTURE_OK'
        assert actual['usage']['inputTokens'] == 5 and actual['costUsd'] == 0.01
    else:
        assert run.returncode != 0 and not output.exists() and actual['modelVerified'] is False
        assert actual['terminalSuccess'] is True, name
    summary.append({'case': name, 'status': actual['status'], 'exitCode': run.returncode,
                    'modelVerified': actual['modelVerified'], 'transcriptPrivate': True})
(args.evidence / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({'fixture': 'synthetic provider boundary; no inference', 'parent': args.parent, 'cases': summary}, indent=2))
