import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const within = (root, path) => { const part = relative(root, path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };
function control(policy, name, action) {
  const expected = policy.controls[name];
  const fd = openSync(`${directory}/${name}`, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino) throw Error('Antigravity guard control ownership changed');
    return action(fd);
  } finally { closeSync(fd); }
}
function flag(policy, name, value) {
  return control(policy, name, fd => {
    const prior = readFileSync(fd, 'utf8');
    if (prior !== '0' && prior !== '1') throw Error('Malformed Antigravity guard flag');
    if (value !== undefined) writeSync(fd, value, 0, 'utf8');
    return prior;
  });
}
function respond(stage, decision) {
  return stage === 'start' || stage === 'post' ? {} : decision;
}
export function fingerprint(path) {
  for (let current = path;; current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw Error(`Antigravity policy ancestry must be real: ${current}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(current) === current) break;
  }
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isDirectory()) throw Error(`Unsupported policy source: ${path}`);
    return { kind: 'present', dev: stat.dev, ino: stat.ino, digest: digest(stat.isFile() ? readFileSync(path) : JSON.stringify(readdirSync(path).sort())) };
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
}
function canonical(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Error('Expected an absolute workspace path');
  try { return realpathSync(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      if (lstatSync(path).isSymbolicLink()) throw Error('Dangling Antigravity target symlink');
    } catch (entryError) { if (entryError.code !== 'ENOENT') throw entryError; }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonical(parent), relative(parent, path));
  }
}
export function decide(stage, input, policy, state) {
  const metadata = input;
  if (!object(metadata) || typeof metadata.conversationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.conversationId) ||
      metadata.modelName !== policy.model || !Array.isArray(metadata.workspacePaths) ||
      metadata.workspacePaths.length !== 1 || metadata.workspacePaths[0] !== policy.root) throw Error('Invalid Antigravity session provenance');
  if (stage === 'start') {
    if (state.conversationId !== null) throw Error('Antigravity session was already bound');
    state.conversationId = metadata.conversationId;
  } else if (state.conversationId !== metadata.conversationId) throw Error('Antigravity conversation mismatch');
  for (const source of policy.sources) {
    if (JSON.stringify(fingerprint(source.path)) !== JSON.stringify(source.identity)) throw Error(`Antigravity policy source changed: ${source.path}`);
  }
  if (stage === 'stop') {
    if (typeof input.fullyIdle !== 'boolean') throw Error('Missing Antigravity idle state');
    state.idle = input.fullyIdle;
    return input.fullyIdle ? {} : { decision: 'continue', reason: 'Wait for background task completion and collect its exit result' };
  }
  if (state.denial !== null) return { decision: 'deny', reason: state.denial };
  if (stage === 'start') return { decision: 'allow' };
  state.idle = false;
  const call = input.toolCall;
  if (!object(call) || !policy.tools.includes(call.name) || !object(call.args)) throw Error('Unknown Antigravity tool boundary');
  if (stage === 'post') return { decision: 'allow' };
  if (stage !== 'pre') throw Error('Unknown Antigravity hook stage');
  const args = call.args;
  const information = ['toolAction', 'toolSummary', 'waitForPreviousTools'];
  for (const key of ['toolAction', 'toolSummary']) if (key in args && typeof args[key] !== 'string') throw Error(`Invalid ${key}`);
  if ('waitForPreviousTools' in args && typeof args.waitForPreviousTools !== 'boolean') throw Error('Invalid waitForPreviousTools');
  if (call.name === 'run_command') {
    const fields = [...information, 'CommandLine', 'Cwd', 'WaitMsBeforeAsync', 'BypassSandbox', 'RunPersistent', 'RequestedTerminalID', 'IsDaemon'];
    for (const key of Object.keys(args)) if (!fields.includes(key)) throw Error(`Unknown command field: ${key}`);
    if (typeof args.CommandLine !== 'string' || !args.CommandLine.trim()) throw Error('Missing command');
    if ('BypassSandbox' in args && args.BypassSandbox !== false) throw Error('Sandbox bypass denied');
    for (const key of ['RunPersistent', 'IsDaemon']) if (key in args && typeof args[key] !== 'boolean') throw Error(`Invalid ${key}`);
    if ('WaitMsBeforeAsync' in args && (!Number.isSafeInteger(args.WaitMsBeforeAsync) || args.WaitMsBeforeAsync < 0)) throw Error('Invalid WaitMsBeforeAsync');
    if ('RequestedTerminalID' in args && args.RequestedTerminalID !== '') throw Error('External terminal boundary is unestablished');
    const cwd = canonical(args.Cwd);
    if (!lstatSync(cwd).isDirectory() || !within(policy.root, cwd)) throw Error('Command cwd outside assigned worktree');
    return { decision: 'auto_approve' };
  }
  if (call.name === 'manage_task') {
    for (const key of Object.keys(args)) if (![...information, 'Action', 'TaskId', 'Input'].includes(key)) throw Error(`Unknown task field: ${key}`);
    if (!['status', 'list', 'kill', 'send_input'].includes(args.Action)) throw Error('Unknown task action');
    if ('Input' in args && typeof args.Input !== 'string') throw Error('Invalid task input');
    if (args.Action !== 'list' || ('TaskId' in args && args.TaskId !== '')) {
      const id = args.TaskId;
      const prefix = `${state.conversationId}/`;
      if (typeof id !== 'string' || !/^task-[0-9]+$/.test(id.startsWith(prefix) ? id.slice(prefix.length) : id)) throw Error('Task selector is not bound to this conversation');
    }
    return { decision: 'auto_approve' };
  }
  if (policy.writeTools.includes(call.name)) {
    const target = args.TargetFile;
    const path = canonical(target);
    if (!within(policy.root, path) || policy.protected.some(file => path === file || within(path, file))) throw Error('File tool target alters the lane boundary');
  }
  return { decision: 'allow' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let policy;
  let input;
  try {
    policy = JSON.parse(readFileSync(`${directory}/policy.json`, 'utf8'));
    const binding = control(policy, 'state.json', fd => JSON.parse(readFileSync(fd, 'utf8')));
    if (!object(binding) || (binding.conversationId !== null && typeof binding.conversationId !== 'string')) throw Error('Malformed Antigravity session binding');
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      text += chunk;
      if (text.length > 4 * 1024 * 1024) throw Error('Antigravity hook input exceeds boundary limit');
    }
    input = JSON.parse(text);
    if (!object(input)) throw Error('Malformed Antigravity hook input');
    const stage = process.argv[2];
    if (stage === 'pre' || stage === 'post') flag(policy, 'idle', '0');
    const state = { conversationId: binding.conversationId, idle: false, denial: flag(policy, 'denied') === '1' ? 'Antigravity guard recorded a denial' : null };
    const decision = decide(stage, input, policy, state);
    if (stage === 'start') control(policy, 'state.json', fd => writeSync(fd, JSON.stringify({ conversationId: state.conversationId }), 0, 'utf8'));
    if (stage === 'stop') flag(policy, 'idle', state.idle ? '1' : '0');
    process.stdout.write(JSON.stringify(respond(stage, stage === 'pre' && flag(policy, 'denied') === '1' ? { decision: 'deny', reason: 'Antigravity guard recorded a denial' } : decision)));
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'Malformed Antigravity hook input or control state' : typeof error?.code === 'string' ? `Antigravity boundary unavailable (${error.code})` : error instanceof Error ? error.message : 'Antigravity guard failed';
    try { if (policy) flag(policy, 'denied', '1'); } catch {}
    const stop = process.argv[2] === 'stop';
    process.stdout.write(JSON.stringify(respond(process.argv[2], stop
      ? object(input) && input.fullyIdle === true ? {} : { decision: 'continue', reason }
      : { decision: 'deny', reason })));
  }
}
