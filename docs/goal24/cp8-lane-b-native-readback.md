# Goal24 Checkpoint 8 — Lane B: Native Execution Receipt + Restricted Read-back Verification Runner

- Lane: `B — NATIVE READBACK`
- Base SHA: `01e1204d8d2a9b232b6745a96667a205841e6f60` (`origin/dev/goal24-cli-skills`)
- Status: `LANE_B_COMPLETE`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp8-native-readback`
- Local branch: `local/cp8-native-readback` (no push)

## Scope

This lane makes every broker execution durable and adds a restricted,
receipt-bound read-back runner so post-execution external state can be
observed even when the original process result is ambiguous (nonzero exit,
timeout, cancel, crash). It delivers:

- broker-owned persistent execution receipts,
- spawn lifecycle persistence (accepted -> spawn_started -> completed),
- a restricted read-back verification runner with compiled read-only bindings,
- verification binding trust (receipt linkage, capability/input digests),
- a structured read-back parsing envelope (no natural-language "Success!"),
- a single-use retry primitive with a hard native attempt bound,
- crash/restart receipt recovery (`unknown_after_crash` + read-back).

Out of scope: Brain semantic outcome comparison, `brain-server/src/outcome/**`,
GitHub production write capability, Approval policy, Decision Kernel, Outcome
UI, automatic rollback. The CP7 security chain (ApprovalStore, durable plan
ledger, consume-before-spawn, OS store lock, native risk mirror) is unchanged
and its tests keep passing.

## Files owned by this lane

- `desktop-daemon/src-tauri/src/execution_broker/readback/{mod,types,receipt,store,binding,runner,parser,tests,crash_tests}.rs` (new)
- `desktop-daemon/src-tauri/src/execution_broker/mod.rs` (receipt lifecycle wiring)
- `desktop-daemon/src-tauri/src/execution_broker/types.rs` (receipt error codes)
- `desktop-daemon/src-tauri/src/execution_broker/runner.rs` (spawn lifecycle observer)
- `desktop-daemon/src-tauri/src/execution_broker/approval/mod.rs` (pub(crate) digest/lock re-exports)
- `docs/goal24/cp8-lane-b-native-readback.md`
- `docs/goal24/checkpoint8-lane-b-manifest.json`

`brain-server/**` is untouched. No GitHub production write binding was added;
the five CP4 read bindings remain the only production bindings.

## Fundamental rule: exit 0 is not truth

`BrokerExecutionResult.success` only means "process-level result": the child
exited 0 within the timeout and was not cancelled. The native layer never
creates `outcome_verified=true` and never treats original write stdout
("created", "success", "merged", "url=...") as post-state verification. That
output is retained only as audit material (bounded stdout/stderr digests in
the receipt). Truth about the external world comes exclusively from a
restricted read-back observation against a trusted read-only binding.

## Execution receipt

- Native-owned, server-generated: `receipt_id = "rcpt_" + 32 random hex`. A
  caller can never submit an id or a `BrokerExecutionResult` JSON as
  execution authority; the runner resolves a receipt id against the trusted
  persistent store.
- Identity fields are immutable after creation: plan, decision, capability,
  version, adapter, binding id, normalized-inputs digest, verification-plan
  digest, verification capability + inputs (trusted copies from the approved
  plan), and a `receipt_digest` (SHA-256 over the canonical JSON of identity
  fields) validated on every load and read-back.
- Lifecycle fields (`execution_state`, timestamps, exit code, timeout/cancel
  flags, bounded output digests, truncation/redaction flags, resolved
  executable fingerprint) change only through the legal transition table.

### Lifecycle states and transitions

```text
accepted -> spawn_started -> completed
accepted -> spawn_failed
accepted -> unknown_after_crash    (restart recovery only)
spawn_started -> unknown_after_crash (restart recovery only)
```

History rewind is forbidden (`completed -> spawn_started` and every other
illegal transition is rejected with `ReceiptTransitionInvalid`).

### Persistence phases

- `accepted` is durably written after CP7 plan reservation + approval
  consumption, before process spawn.
- `spawn_started` (+ timestamp) is durably written immediately after the OS
  process is successfully created, before the broker waits for child exit.
- `completed` records exit code, timeout/cancel and bounded output digests
  after the lifecycle finishes.
- `spawn_failed` covers every pre-spawn gate failure (provably no process).
- On restart reopen, any mid-flight `accepted` / `spawn_started` receipt is
  migrated to `unknown_after_crash` before anything can read it.

## Crash semantics

- `accepted` with no `spawn_started` on restart: the process was not observed
  as started. Native classification migrates to `unknown_after_crash` anyway —
  the store never silently claims "no effect", and eligibility is decided by
  trusted lifecycle state, never by caller claims.
- `spawn_started` without `completed` on restart: `unknown_after_crash`. An
  external effect may exist. It is never auto-success or
  auto-failure-with-no-effect.
- `unknown_after_crash` receipts remain read-back eligible: observing the
  external post-state is the only honest way to close the ambiguity.
- Receipts that are provably `accepted`-without-spawn (same-process, no
  restart) are not read-back eligible; nothing was spawned to observe.

## Receipt store safety

- `FileExecutionReceiptStore` with a trusted/injected path (CP8 tests use temp
  directories; production wires Tauri app-data later). Callers cannot choose
  the path.
- Schema version (`RECEIPT_STORE_FILE_VERSION = 1`) + strict parse of every
  receipt (identity digest, attempt bounds, transition legality).
- Atomic writes: temp file -> flush -> fsync -> rename; serialized through the
  store mutex plus the same exclusive OS file lock used by the CP7 approval
  store (single-process instance guard).
- Corrupt store (malformed JSON, truncated, unknown version, duplicate receipt
  ids, invalid transition, digest mismatch): `BROKER_RECEIPT_STORE_CORRUPT`,
  fail closed. The store is never deleted or reset to empty, and
  `Broker::execute` fails closed before spawn while the store is degraded.

## Read-back runner

- Internal API only: `perform_readback({ receipt_id })`. There is no public
  Tauri command (`verifyPlan`, `runReadback`, `readbackCapability`); CP9 wires
  the bridge. `execute_ipc` remains disabled.
- The request accepts only a receipt id (and optionally a server-owned attempt
  id). Callers cannot override the verification capability, verification
  inputs, executable, argv, cwd, env, timeout or expected result.
- Verification linkage comes from the trusted stored receipt:
  `verification_capability_id` and `verification_inputs` are copied natively
  from the approved plan into the receipt at accept time. A mismatch between
  the registered binding and the receipt capability is
  `READBACK_CAPABILITY_MISMATCH`; the inputs are bound by the CP7
  verification-plan digest, so an approved old plan can never read back a
  different target.
- Compiled trusted registry only: the IPC caller, skills and the LLM can never
  register a read-back binding.

## Read-back binding trust

- `ReadbackBinding` must declare `risk_level=low`,
  `side_effect_class=read_only`, `required_authority=L0`. Any non-read-only
  binding is rejected at registration with `READBACK_BINDING_NOT_READ_ONLY`.
  The check reads the compiled risk policy of the binding; it is not a static
  default.
- Read-back requires no user approval (observing state is read-only), but it
  only exists as verification of an existing execution receipt; it can never
  become a generic arbitrary-query IPC.
- argv is built exclusively by the trusted binding from
  `plan.verification_inputs`; no shell string, no caller argv. CP3 spawn
  containment (trusted executable, cwd allowlist, env allowlist, output
  bounds, process-tree kill) is reused unchanged.

## Structured parser envelope

- The Brain layer never parses arbitrary CLI stdout. Each trusted binding
  converts bounded, redacted raw output into a JSON-safe payload via
  `parse_json_payload` (strict JSON) or `parse_marker_json` (marker-delimited
  strict JSON extraction used by the test-only libtest child).
- Parse failure -> `parser_status=malformed`. Truncated output (either stream
  hit the broker cap) upgrades the status to `truncated`; an incomplete
  payload is never reported as a complete parse.
- Critical read-back bindings prefer machine-readable CLI output. No regex
  over natural-language "Success!" text.
- `ReadbackObservationEnvelope` carries observation/attempt ids, origin plan
  and receipt ids, verification capability, canonical `subject_key` derived by
  the binding from trusted inputs, observed-at, payload + payload digest,
  parser status, truncation flag, source adapter/binding and process
  metadata. It contains **no** `verified` field: semantic comparison belongs
  to the Brain evaluator (Lane A / Integration).
- CP3 output redaction applies to the read-back child as well; token, cookie
  and Authorization material is never written into observation payloads.

## Retry primitive

- Each call performs exactly one attempt; the runner never loops.
- Attempt ids are single-use and persisted before spawn (write-ahead): the
  same id can never execute twice, across restarts.
- Hard native bound: `MAX_VERIFICATION_ATTEMPTS = 5` per receipt; exceeding it
  is rejected. Integration/Brain policy is expected to be stricter (3).
- Read-back eligibility: required after exit 0 (the normal verification flow),
  and still required after nonzero exit, timeout, cancel and
  `unknown_after_crash` — an external effect may exist even when the process
  failed.

## Crash / restart recovery

- The full broker can be destroyed and rebuilt on the same persistent stores;
  receipts are still looked up and read-back still works when the state allows
  it.
- The CP7 durable plan ledger keeps rejecting the same plan id after restart
  (`PlanRejectedSingleUse`), even with a freshly granted approval.
- Approval consumption happens before spawn; the receipt lifecycle adds
  receipt durability around the spawn without changing single-use semantics.

## CP7 regression

All CP7 behaviors remain covered and pass: ApprovalStore persistence, durable
plan replay ledger, consume-before-spawn ordering, exclusive OS store lock,
native risk mirror, fake-approval and mutation rejection. The full suite below
includes the CP7 approval/broker crash tests.

## Validation (run in this worktree)

- `cargo fmt --check`: PASS
- `cargo check --all-targets`: PASS (only pre-existing `has_clipboard_content` dead-code warning)
- `cargo clippy --all-targets -- --no-deps`: PASS for all CP8 files; the
  remaining warnings are in pre-existing files (brain_server, clipboard,
  commands, main, mcp_helper, udp_listener) and were not introduced here.
- `cargo test --bin omni-context-desktop -- --test-threads 1`:
  `199 passed; 0 failed; 7 ignored`
- `execution_broker::readback` module alone: `31 passed; 0 failed; 1 ignored`
  (the ignored test is the test-only child protocol entry spawned as a
  subprocess with `--ignored`).
- `npm run build` (desktop-daemon): PASS
- `npm run verify:controlled`: PASS
- `cargo audit --db D:\environment\advisory-db-offline`: see manifest;
  Cargo.toml / Cargo.lock content unchanged — no new dependency was added.
- `git diff --check`: PASS

## Test coverage highlights

- True positive: write mutates fixture, exit 0; read-back observes the new
  state and returns a structured observation (no `verified` claim).
- False positive: write exits 0 but fixture state is unchanged; read-back
  observes the old state, proving stdout/exit-0 cannot mask a mismatch.
- Partial effect: write mutates state then exits 1; read-back still observes
  the new state.
- Timeout / cancel with effect: child mutates state, then sleeps/waits until
  timeout/cancel; read-back still observes the effect.
- Restart: mid-flight receipts migrate to `unknown_after_crash` and remain
  read-back eligible; full broker restart blocks plan replay and preserves
  completed-receipt read-back.
- Corrupt store: truncated file, unknown schema, duplicate receipt ids and
  tampered receipt digest all fail closed and block broker execution.
- Registry and trust: unregistered verification capability -> mismatch;
  non-read-only binding -> rejected; attempt replay across restart -> rejected;
  6th attempt -> rejected; envelope never carries `verified`.

## Security boundaries (not bugs)

- Native never executes rollback, reverses an action or retries the original
  write.
- Native never turns "read-back after timeout/cancel/crash" into "assume no
  effect".
- A receipt is never an approval, an outcome verdict or a plan ready for
  re-execution.

## Scientific firewall

No Holdback, `science/*`, Gold, formal or paper material was read or modified.
The dirty `D:\ai_code\Omni-context\.worktrees\goal24-cp21` worktree was not
touched. Nothing was pushed to any remote.