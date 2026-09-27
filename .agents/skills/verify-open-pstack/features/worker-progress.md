# Worker lifecycle progress

External workers publish a bounded private progress snapshot (`--progress`) that parents read through `pstack-runner status` before the terminal receipt exists.

## Sub-features

- `worker-progress-lifecycle`: derived phase, direct-child state, byte activity, and terminal marking across a real lane.
- `worker-progress-status`: the `status` consumer merges explicit progress/receipt pairs with a process-start probe per lane, in human and `--json` output.
- `worker-progress-interrupted`: a crashed or killed launcher reads as `interrupted` (or `unknown` where `ps -o lstart` is unavailable), never active.
- `worker-progress-boundaries`: progress never alters receipts, output, cancellation, or policy recovery; canary text never reaches the artifact or status output.

## How to get to it (user POV)

Parent workflows pass a unique `--progress` path when launching an external lane, then check lanes with `pstack-runner status` while they run. Users see a lane line only when its `changeKey` differs from the last reported value.

## Driving it with the Bun CLI

Preconditions: Launch and Doctor passed. The steps below exercise the real shipped runner against a stub provider executable — a labeled synthetic boundary, not a provider claim. `$VERIFY_SCRATCH` must be fresh.

```bash
mkdir -p "$VERIFY_SCRATCH/bin"
cat > "$VERIFY_SCRATCH/bin/codex" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
echo '{"type":"thread.started","thread_id":"t1"}'
echo "PROGRESS_CANARY_chunk" >&2
sleep 8
echo '{"type":"item.completed","item":{"type":"agent_message","text":"STUB_OK"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
STUB
chmod +x "$VERIFY_SCRATCH/bin/codex"
printf 'Return the marker PROGRESS_CANARY_prompt.\n' > "$VERIFY_SCRATCH/prompt.md"
mkdir -p "$VERIFY_SCRATCH/lane"
export PATH="$VERIFY_SCRATCH/bin:$PATH"
"$VERIFY_TOOLS/runner/pstack-runner" \
  --parent claude --provider codex --model gpt-5.6-sol --effort max \
  --mode read-only --prompt "$VERIFY_SCRATCH/prompt.md" --cwd "$VERIFY_SCRATCH" \
  --output "$VERIFY_SCRATCH/lane/out.md" --receipt "$VERIFY_SCRATCH/lane/receipt.json" \
  --progress "$VERIFY_SCRATCH/lane/progress.json" &
LANE_PID=$!
```

While the lane runs:

```bash
sleep 3
capture progress-live "$VERIFY_TOOLS/runner/pstack-runner" status \
  --progress "$VERIFY_SCRATCH/lane/progress.json" --receipt "$VERIFY_SCRATCH/lane/receipt.json"
capture progress-live-json "$VERIFY_TOOLS/runner/pstack-runner" status \
  --progress "$VERIFY_SCRATCH/lane/progress.json" --receipt "$VERIFY_SCRATCH/lane/receipt.json" --json
```

- **Inspect:** the human line reports `workload-running` (or `preflight` early), `runner present` or `launcher identity unverified`, and byte activity; the JSON lane has `kind: "active"` when launcher identity is verified, otherwise `unknown`, plus a `phase` and a `changeKey`. Neither output contains `PROGRESS_CANARY` text, a prompt or task string, an absolute input path, or receipt diagnostics.
- **Cancel:** `kill -TERM "$LANE_PID"`, wait, then re-run `status`. Expect `terminal cancelled (from receipt)`; the snapshot's final record shows `cancellation.requested`, a `childSettled` outcome, and `terminal.receiptWritten: true`. The receipt itself still drives `normalize`; progress changes nothing.

```bash
kill -TERM "$LANE_PID" 2>/dev/null || true
wait "$LANE_PID" 2>/dev/null || true
capture progress-terminal "$VERIFY_TOOLS/runner/pstack-runner" status \
  --progress "$VERIFY_SCRATCH/lane/progress.json" --receipt "$VERIFY_SCRATCH/lane/receipt.json"
python3 - "$VERIFY_SCRATCH/lane/receipt.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["status"] == "cancelled", r["status"]
print("PASS: cancelled receipt")
PY
capture progress-unit bun test --cwd "$VERIFY_TOOLS" runner/progress.test.ts
capture progress-integration bun test --cwd "$VERIFY_TOOLS" runner/run.test.ts -t "worker progress"
```

The two `bun test` drives cover the synthetic boundary matrix: quiet and active workers, parallel identities, drained-pipe distinction, cancellation during workload and drain, crashed launchers, ownership collisions, write failure, oversize/hostile snapshots, and receipt parity with and without `--progress`.

### Installed-parent steps

The live gate is the installed parent workflow in both harnesses; stub and unit coverage cannot replace it.

1. Install the exact candidate in isolated Codex and Claude Code profiles per [installation](installation.md). Record version and tree identity.
2. In each parent, dispatch a long-running external lane through the normal poteto-mode dispatch (for example a read-only `devin:*` or cross-provider lane) with a unique `--progress` path recorded in the parent step.
3. Before the lane finishes, invoke `pstack-runner status --progress … --receipt …` from the parent's own tool surface (Bash in Claude Code, exec in Codex). Expect a lifecycle line naming the phase, child state, launcher verdict, and activity counters — no receipt required yet.
4. After completion, run `status` again and confirm `terminal <status> (from receipt)`; confirm the receipt and output are byte-normal and `pstack-model-policy normalize` treats the attempt exactly as before.
5. In parallel dispatch, give each lane a distinct progress path and confirm `status` prints distinct lane identities.
6. Cancel one owned lane through the retained task handle. Expect `cancel requested` then `terminal cancelled`; nothing may claim provider descendants stopped.
7. Confirm the progress file is mode `0600` and bounded (a few hundred bytes), and that status output contains no prompt, transcript, path, model ID, or receipt diagnostic text.

## Gotchas

- `launcher identity unverified` means `ps -o lstart` gave no usable token on that host (including sandboxed shells); it is neither alive nor dead. `interrupted` is not a failure verdict — only the receipt authorizes an outcome.
- A finished progress marker without a readable receipt is `unknown`, never `active`; receipts written to a different inode than the reserved one are not trusted.
- Progress updates are advisory telemetry: a snapshot that stops updating mid-run is not evidence of a stall or a failure.
- Never tail provider transcripts, exports, or session databases to fill in status; byte counts are the only output signal.
