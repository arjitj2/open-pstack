#!/usr/bin/env python3
"""Exercise Claude auth with fabricated credentials and no system Keychain access."""

import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import uuid


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--claude', required=True, type=Path)
    parser.add_argument('--runner', type=Path, help='Candidate pstack-runner entry point')
    parser.add_argument('--bun', type=Path, help='Explicit Bun executable for --runner')
    parser.add_argument('--delay', type=float, default=0.5)
    parser.add_argument('--expires-in', type=int, default=-60)
    parser.add_argument('--store', choices=['valid', 'empty', 'zeroed', 'absent'], default='valid')
    parser.add_argument('--route', choices=['subscription', 'api'], default='subscription')
    parser.add_argument('--print-control', action='store_true')
    parser.add_argument('--cold-config', action='store_true')
    parser.add_argument('--offline-preflight', action='store_true')
    parser.add_argument('--follow-print', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('This fixture requires the macOS sandbox-exec boundary.')
    if not 0 <= args.delay <= 3:
        parser.error('--delay must be between 0 and 3 seconds.')
    if args.runner:
        if not args.bun or args.offline_preflight or args.follow_print or args.print_control:
            parser.error('--runner requires --bun and cannot combine with other execution modes')
        args.runner = args.runner.resolve(strict=True)
        args.bun = args.bun.resolve(strict=True)
    args.claude = args.claude.resolve(strict=True)
    return args


def sandbox_profile(binary, root, port):
    return '\n'.join([
        '(version 1)',
        '(allow default)',
        '(deny process-exec (literal "/usr/bin/security"))',
        '(deny mach-lookup)',
        f'(deny file-read* file-write* (subpath {json.dumps(str(Path.home()))}))',
        f'(allow file-read* (literal {json.dumps(str(binary))}))',
        f'(allow file-read* file-write* (subpath {json.dumps(str(root))}))',
        '(deny file-read* file-write* (regex #"(^|/)Keychains(/|$)"))',
        '(deny network-outbound)',
        f'(allow network-outbound (remote ip "localhost:{port}"))',
    ])


def main():
    args = arguments()
    root = Path(tempfile.mkdtemp(prefix='pstack-mock-oauth-')).resolve()
    config = root / 'config'
    config.mkdir()
    mockbin = root / 'bin'
    mockbin.mkdir()
    source = Path(__file__).resolve().parent
    shutil.copyfile(source / 'security', mockbin / 'security')
    (mockbin / 'security').chmod(0o700)
    shutil.copyfile(source / 'mock-security.py', root / 'mock-security.py')
    account = 'pstack-fixture-' + uuid.uuid4().hex
    service = 'Claude Code-credentials-' + hashlib.sha256(str(config).encode()).hexdigest()[:8]
    oauth = {
        'accessToken': 'fixture-access-old',
        'refreshToken': 'fixture-refresh-old',
        'expiresAt': int((time.time() + args.expires_in) * 1000),
        'scopes': ['user:inference', 'user:profile'],
        'subscriptionType': 'pro',
        'rateLimitTier': 'default_claude_pro',
    }
    credential = json.dumps({'claudeAiOauth': oauth})
    (config / '.credentials.json').write_text(credential)
    (config / '.credentials.json').chmod(0o600)
    store = root / 'mock-credential.json'
    if args.store == 'valid':
        store.write_text(credential)
    elif args.store == 'empty':
        store.write_text('')
    elif args.store == 'zeroed':
        store.write_text(json.dumps({'claudeAiOauth': {
            **oauth, 'accessToken': '', 'refreshToken': '', 'expiresAt': 0,
        }}))
    (config / '.claude.json').write_text(json.dumps({
        'hasCompletedOnboarding': True,
        'migrationVersion': 0 if args.cold_config else 14,
        **({'fixturePadding': 'x' * 1024 * 1024} if args.cold_config else {}),
        'oauthAccount': {
            'accountUuid': '00000000-0000-4000-8000-000000000001',
            'organizationUuid': '00000000-0000-4000-8000-000000000002',
            'emailAddress': 'fixture@example.invalid',
            'organizationName': 'fixture',
            'billingType': 'stripe_subscription',
            'accountCreatedAt': '2026-01-01T00:00:00Z',
            'subscriptionCreatedAt': '2026-01-01T00:00:00Z',
            'ccOnboardingFlags': {},
            'profileFetchedAt': int(time.time() * 1000),
        },
    }))
    (root / 'cert.cnf').write_text(
        '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n'
        '[dn]\nCN=platform.claude.com\n[v3]\n'
        'subjectAltName=DNS:platform.claude.com,DNS:api.anthropic.com\n'
        'basicConstraints=critical,CA:TRUE\n'
        'keyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n'
    )
    subprocess.run([
        shutil.which('openssl'), 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', str(root / 'key.pem'), '-out', str(root / 'cert.pem'),
        '-days', '1', '-config', str(root / 'cert.cnf'),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(root / 'cert.pem', root / 'key.pem')
    events = []
    consumed = threading.Event()
    refresh_lock = threading.Lock()
    started = time.monotonic()

    def event(name, **data):
        events.append({'event': name, 'seconds': round(time.monotonic() - started, 4), **data})

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()

        def do_CONNECT(self):
            self.destination = self.path
            if self.destination not in ['platform.claude.com:443', 'api.anthropic.com:443']:
                event('blocked_connect', host=self.path)
                self.send_error(403)
                return
            self.send_response(200)
            self.end_headers()
            try:
                self.connection = context.wrap_socket(self.connection, server_side=True)
                self.rfile = self.connection.makefile('rb')
                self.wfile = self.connection.makefile('wb')
                self.close_connection = False
                self.handle_one_request()
            except OSError:
                event('connection_closed')

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            if getattr(self, 'destination', '') != 'platform.claude.com:443' or self.path != '/v1/oauth/token':
                event('mock_request_rejected', path=self.path)
                self.respond(400, {'type': 'error', 'error': {
                    'type': 'invalid_request_error', 'message': 'Mock fixture refuses inference',
                }})
                return
            data = json.loads(body)
            if data.get('grant_type') != 'refresh_token' or data.get('refresh_token') != 'fixture-refresh-old':
                self.send_error(400)
                return
            with refresh_lock:
                if consumed.is_set():
                    event('spent_refresh_rejected')
                    self.respond(400, {'error': 'invalid_grant'})
                    return
                consumed.set()
                event('refresh_consumed')
            time.sleep(args.delay)
            try:
                self.respond(200, {
                    'access_token': 'fixture-access-new', 'refresh_token': 'fixture-refresh-new',
                    'expires_in': 28800, 'token_type': 'Bearer', 'scope': 'user:inference user:profile',
                })
                event('refresh_replied')
            except OSError:
                event('reply_abandoned')

        def do_GET(self):
            self.send_error(403)

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    proxy = f'http://127.0.0.1:{server.server_port}'
    env = {
        'PATH': f'{mockbin}:/usr/bin:/bin:/usr/sbin:/sbin',
        'HOME': str(root), 'USER': account, 'LOGNAME': account, 'TMPDIR': str(root),
        'PSTACK_MOCK_ROOT': str(root), 'PSTACK_MOCK_SERVICE': service,
        'CLAUDE_CONFIG_DIR': str(config), 'CLAUDE_SECURESTORAGE_CONFIG_DIR': str(config),
        'HTTPS_PROXY': proxy, 'HTTP_PROXY': proxy, 'ALL_PROXY': proxy, 'NO_PROXY': '',
        'NODE_EXTRA_CA_CERTS': str(root / 'cert.pem'), 'CLAUDE_CODE_CERT_STORE': 'bundled',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1',
    }
    if args.route == 'api':
        env['ANTHROPIC_API_KEY'] = 'fixture-api-key'
    profile = sandbox_profile(args.claude, root, server.server_port)
    if args.runner:
        profile += '\n' + f'(allow file-read* (literal {json.dumps(str(args.bun))}))'
    (root / 'sandbox.sb').write_text(profile)
    command = [str(args.claude), '--debug-file', str(root / 'debug.log'), '--setting-sources', '']
    command += (['-p', '--max-turns', '1', '--tools', '', '--strict-mcp-config', 'fixture local-only test']
                if args.print_control else ['auth', 'status', '--json'])
    if args.runner:
        shutil.copytree(args.runner.parent, root / 'runner', ignore=shutil.ignore_patterns('*.test.ts'))
        (mockbin / 'claude').symlink_to(args.claude)
        (root / 'prompt.txt').write_text('fixture local-only test')
        command = [str(args.bun), str(root / 'runner' / args.runner.name),
                   '--parent', 'codex', '--provider', 'claude', '--model', 'opus',
                   '--effort', 'high', '--mode', 'read-only', '--api-spend', 'deny',
                   '--prompt', str(root / 'prompt.txt'), '--cwd', str(root),
                   '--output', str(root / 'output.txt'), '--receipt', str(root / 'receipt.json')]
    preflight_profile = '\n'.join(
        line for line in profile.splitlines()
        if not (args.offline_preflight and line.startswith('(allow network-outbound'))
    )
    process = None
    try:
        canary = root / 'Keychains' / 'canary'
        canary.parent.mkdir()
        canary.write_text('fixture canary')
        readable = root / 'readable-canary'
        readable.write_text('readable fixture')
        allowed = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, '/bin/cat', str(readable)],
                                 env=env, cwd=root, capture_output=True)
        if allowed.returncode != 0 or allowed.stdout != b'readable fixture':
            raise RuntimeError('Sandbox positive control failed')
        probe = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, '/bin/cat', str(canary)],
                               env=env, cwd=root, capture_output=True)
        if probe.returncode == 0 or b'fixture canary' in probe.stdout:
            raise RuntimeError('Sandbox failed to deny the fixture Keychains canary')
        process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p', preflight_profile, *command],
                                   env=env, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate()
        event('process_exit', code=process.returncode)
        after_preflight = json.loads(store.read_text() or '{}') if store.exists() else {}
        after_preflight = after_preflight.get('claudeAiOauth', {})
        preflight_preserved_tokens = (after_preflight.get('accessToken') == 'fixture-access-old'
                                      and after_preflight.get('refreshToken') == 'fixture-refresh-old')
        continuation = None
        if args.follow_print:
            event('follow_print_start')
            following = subprocess.run(
                ['/usr/bin/sandbox-exec', '-p', profile, str(args.claude),
                 '--debug-file', str(root / 'follow-debug.log'), '--setting-sources', '',
                 '-p', '--strict-mcp-config', '--tools', '', '--no-session-persistence',
                 'fixture local-only test'], env=env, cwd=root, capture_output=True, text=True)
            event('follow_print_exit', code=following.returncode)
            final_store = json.loads(store.read_text() or '{}') if store.exists() else {}
            final_store = final_store.get('claudeAiOauth', {})
            fallback = config / '.credentials.json'
            final_fallback = json.loads(fallback.read_text() or '{}') if fallback.exists() else {}
            final_fallback = final_fallback.get('claudeAiOauth', {})
            check = subprocess.run(
                ['/usr/bin/sandbox-exec', '-p', preflight_profile, str(args.claude),
                 '--setting-sources', '', 'auth', 'status', '--json'],
                env=env, cwd=root, capture_output=True, text=True)
            event('status_after_task', code=check.returncode)
            continuation = {'primaryPresent': store.exists(),
                            'fallbackAccessPresent': bool(final_fallback.get('accessToken')),
                            'fallbackRefreshPresent': bool(final_fallback.get('refreshToken')),
                            'accessPresent': bool(final_store.get('accessToken')),
                            'refreshPresent': bool(final_store.get('refreshToken')),
                            'auth': json.loads(check.stdout)}
        saved_in = []
        for name, path in [('mock', store), ('fallback', config / '.credentials.json')]:
            stored = json.loads(path.read_text() or '{}') if path.exists() else {}
            if stored.get('claudeAiOauth', {}).get('refreshToken') == 'fixture-refresh-new':
                saved_in.append(name)
        time.sleep(args.delay + 0.1)
        report = {
            'binary': str(args.claude), 'binarySha256': hashlib.sha256(args.claude.read_bytes()).hexdigest(),
            'delay': args.delay, 'expiresIn': args.expires_in, 'storeState': args.store,
            'route': args.route, 'printControl': args.print_control, 'fixtureRoot': str(root),
            'coldConfig': args.cold_config, 'configPaddingBytes': 1024 * 1024 if args.cold_config else 0,
            'offlinePreflight': args.offline_preflight, 'preflightPreservedTokens': preflight_preserved_tokens,
            'continuation': continuation,
            'runnerReceipt': json.loads((root / 'receipt.json').read_text()) if args.runner else None,
            'storage': 'mock-file', 'keychainCanaryDenied': True, 'newSaved': bool(saved_in), 'savedIn': saved_in,
            'events': events, 'stdout': stdout, 'stderr': stderr,
            'storageEvents': (root / 'storage-events.jsonl').read_text()
            if (root / 'storage-events.jsonl').exists() else '',
        }
        print(json.dumps(report, indent=2))
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.communicate()
        server.shutdown()


if __name__ == '__main__':
    main()
