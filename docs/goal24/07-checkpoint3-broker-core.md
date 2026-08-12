# Goal24 Checkpoint 3 — Tauri Local Execution Broker Core (Lane A)

Date: 2026-08-13
Status: LANE_A_COMPLETE
Base: `93d9cf53c91e56d4c7b13e85d6197014d0a879c7` (`origin/dev/goal24-cli-skills`, verified exact after `git fetch --all --tags --prune`; `main` is an ancestor)
Branch: `local/cp3-broker-core` (local-only worktree `D:\ai_code\Omni-context-worktrees\cp3-broker-core`; no push)

This checkpoint adds the **Tauri Local Execution Broker** — the only component
in this iteration that performs real process execution. It is a *restricted
execution primitive*: it runs an approved semantic `ExecutionPlan`
(`state=ready`, `required_approval=false` in CP3) through a trusted compiled
`ExecutionBinding`. It never accepts an executable, argv, cwd or env from a
plan or from an IPC caller.

## 1. Scope

Implemented:

- Strict Rust wire mirror of the `ExecutionPlan` contract
  (`#[serde(deny_unknown_fields)]`), re-validated by the broker gate before any
  spawn — the broker never trusts TypeScript-side validation.
- Broker core: plan gate, trusted-binding registry (compiled code only),
  execution engine, active-execution registry, cancellation by `execution_id`.
- Executable resolution policy: concrete `.exe` only, canonicalized regular
  file, metadata fingerprint (path + size + mtime) re-verified immediately
  before spawn.
- Process containment: Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
  applied via `CREATE_SUSPENDED` → assign → resume; unix process-group
  fallback.
- Bounded output capture (default 1 MiB per stream, clamped, drain continues
  after the cap so the child can never deadlock on a full pipe).
- Read-only broker status Tauri IPC (`get_broker_status`). No generic
  execute IPC is exposed (`execute_ipc_enabled=false`).

Not implemented (later checkpoints, per the CP3 scope freeze):

- GitHub CLI Adapter (Checkpoint 4) — no production bindings are registered.
- Skill Registry / Capability Registry runtime.
- Evidence retrieval / Guard runtime.
- Approval Engine cryptography (Checkpoint 7) — `required_approval=true`
  plans are **blocked** with `APPROVAL_ENFORCEMENT_NOT_AVAILABLE` even when an
  `ApprovalReference` is structurally present.
- Outcome read-back verification, desktop Approval UI.

## 2. Module structure

`desktop-daemon/src-tauri/src/execution_broker/`

| File | Responsibility |
| --- | --- |
| `mod.rs` | `Broker` gate + status surface, binding registry, `global_broker()`, `BrokerStatus` IPC view |
| `types.rs` | Strict wire mirrors (`ExecutionPlanWire`, risk/evidence/approval/verification/rollback mirrors), `ErrorCode`, `BrokerError`, `BrokerExecutionResult`, identifier validators |
| `policy.rs` | `ExecutionBinding` trait, env policy (base + allowlist, forbidden secrets), cwd containment policy, `OutputLimits` |
| `resolver.rs` | Candidate resolution: absolute path, `.exe`-only, canonicalize, regular-file check, fingerprint capture/verify |
| `runner.rs` | Execution engine: argv → resolve → cwd → env → contained spawn → bounded readers → timeout/cancel wait loop → structured result |
| `output.rs` | Bounded per-stream capture threads with truncation metadata |
| `process_tree.rs` | Windows Job Object containment (`KILL_ON_JOB_CLOSE`, suspended spawn), unix process-group fallback, tree termination |
| `tests.rs` | A–G security/lifecycle suites using the test binary itself as child (`std::env::current_exe()`), `#[cfg(test)]`-only |

Wiring (minimal, read-only):

- `src/main.rs`: `mod execution_broker;` + `commands::get_broker_status` handler registration.
- `src/commands.rs`: `#[tauri::command] get_broker_status()` returning `BrokerStatus`.
- `Cargo.toml`: windows crate features `Win32_System_JobObjects`, `Win32_System_Diagnostics_ToolHelp`, `Win32_Security`; unix-only `libc` dep for the process-group fallback.

## 3. Public API (CP3)

Tauri IPC (read-only):

- `get_broker_status() -> BrokerStatus` — `broker_version`, `execute_ipc_enabled`
  (always `false` in CP3), `registered_bindings`, `active_executions`,
  `output_limits`, `approvals_enforced` (always `false` until CP7).

Crate-internal API (not reachable from IPC in CP3):

- `Broker::execute(plan, binding_id)` — `pub(crate)`; opened to production IPC
  in CP4 together with the GitHub adapter.
- `Broker::cancel_execution(execution_id)`, `Broker::register_binding(Box<dyn ExecutionBinding>)`.
- `ExecutionBinding` trait: `binding_id`, `adapter_id`, `capability_id`,
  `executable_candidates`, `build_argv`, `allowed_cwd_roots`, `derive_cwd`,
  `env_allowlist`, `output_limits`.
- `ErrorCode` set: `INVALID_PLAN`, `PLAN_NOT_READY`, `PLAN_EXPIRED`,
  `APPROVAL_ENFORCEMENT_NOT_AVAILABLE`, `UNKNOWN_BINDING`,
  `CAPABILITY_BINDING_MISMATCH`, `ADAPTER_BINDING_MISMATCH`,
  `EXECUTABLE_NOT_ALLOWED`, `EXECUTABLE_NOT_FOUND`, `EXECUTABLE_CHANGED`,
  `CWD_NOT_ALLOWED`, `INVALID_ARGUMENTS`, `SPAWN_FAILED`, `TIMEOUT`,
  `CANCELLED`, `OUTPUT_LIMIT`, `PROCESS_TREE_FAILURE`, `UNKNOWN_EXECUTION`,
  `INTERNAL_ERROR`.

## 4. Security invariants

- **Approved semantic plan only** — no arbitrary command execution.
- **No shell execution** — shell strings, `cmd /C`, `powershell -Command`,
  `sh -c`, `bash -c` and shell associations are permanently excluded; spawns
  are direct `CreateProcess`-style execs of a resolved `.exe`.
- **No LLM/IPC-supplied executable, argv, cwd or env** — all come from trusted
  compiled `ExecutionBinding` code; `normalized_inputs` reserved keys
  (`shell`, `command`, `exec`, `bash`, `powershell`, `cmd`, `cmdline`,
  `script`) are rejected by the gate.
- **Replay guard** — only `state=ready` is accepted at the first-spawn entry;
  `state=executing` is rejected (`PLAN_NOT_READY`) so a replayed plan can never
  trigger a second spawn.
- **Approval boundary** — `required_approval=true` is blocked in CP3
  (`APPROVAL_ENFORCEMENT_NOT_AVAILABLE`) until Checkpoint 7 provides real
  token verification; structural presence of `approval` is not treated as
  validation.
- **Bindings are compiled-only** — IPC callers cannot create or mutate a
  binding; CP3 registers no production bindings. Test bindings exist only
  under `#[cfg(test)]`.
- **Expiry and timeout bounds** — `expires_at` enforced (unparseable = expired,
  fail-closed); `timeout_ms` must be within `[100, 86_400_000]`.
- **Identity verification** — plan ids/capability ids/adapter ids/semver
  re-validated against the contract patterns in Rust.

## 5. Executable resolution and TOCTOU

- Broker accepts only trusted binding candidates; a plan cannot supply a path.
- Windows: extension must be `.exe`; `.cmd`/`.bat`/`.ps1` rejected by default;
  no PATH search at spawn time (the resolved path is concrete and absolute).
- Resolve = canonicalize + regular-file check; records `canonical_path`, size
  and mtime; identity is re-verified immediately before spawn
  (`EXECUTABLE_CHANGED` on mismatch).
- Full-binary hashing is deliberately not forced in CP3 (large binaries);
  the residual TOCTOU window between verify and `CreateProcess` is documented
  as a known residual risk.

## 6. Process containment

- Windows (primary): every broker spawn uses `CREATE_SUSPENDED`, the suspended
  child is assigned to a fresh Job Object configured with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then the primary thread is resumed.
  Timeout, cancellation and broker teardown terminate the entire job, so
  grandchildren cannot survive. `taskkill /T` is intentionally not used.
- Non-Windows fallback: dedicated process group per child; termination sends
  `SIGKILL` to the whole group.

## 7. Environment policy

- `env_clear()` first: the child inherits **nothing** from the parent.
- Only the minimal base set (`SystemRoot`, `TEMP`, `TMP` on Windows) plus the
  binding's explicit allowlist are restored.
- Fail-safe stripping: `GH_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY`,
  `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `NPM_TOKEN` and any `AWS_`/`AZURE_`/
  `GOOGLE_`/`SSH_`-prefixed variable are never inherited, even if allowlisted.
- `PATH` is not inherited on Windows (the executable is a resolved absolute
  path; the child has no parent search-path surface).

## 8. Cwd policy

- The binding derives a candidate cwd from inputs; the broker canonicalizes it
  and requires the result to be equal to or a descendant of an allowlisted
  root. `..` escapes, symlinks and junctions fail canonicalization checks
  (`CWD_NOT_ALLOWED`).

## 9. Output limits

- Default cap: 1 MiB stdout, 1 MiB stderr (`DEFAULT_OUTPUT_MAX_BYTES`).
- Binding limits are clamped into `[1, 1 MiB]` — the broker never lets a
  binding raise the cap.
- Reader threads keep draining after the cap so the child never blocks on a
  full pipe (no deadlock); the result reports `truncated` flags and total
  bytes seen per stream.

## 10. Tests

Suite A — plan gate: ready accepted; draft/awaiting_approval/executing/
succeeded/failed/blocked/cancelled rejected; executing replay guard; expired
rejected; `required_approval=true` blocked in CP3; unknown binding; binding
mismatches; forbidden input keys; invalid identity; timeout bounds; serde
`deny_unknown_fields`.

Suite B — executable: arbitrary plan-supplied executable impossible; `.cmd`/
`.bat`/`.ps1`/missing rejected; concrete resolved path required; fingerprint
change detected by the pre-spawn identity check.

Suite C — argv: spaces preserved; shell metacharacters stay literal; newline
and tab round-trip; flag-like values stay single elements (unit level — libtest
consumes leading `--flag` args in the child harness, a documented limitation);
NUL rejected.

Suite D — cwd: allowed root works; `..` escape rejected; symlink/junction
escape rejected where testable (skips when Developer Mode/privileges are
unavailable).

Suite E — env: parent secrets (`GH_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY`,
`AWS_*`) absent from the child; allowlisted var present; `SystemRoot` base var
present.

Suite F — lifecycle: success exit; nonzero exit; stdout; stderr; timeout;
cancellation by `execution_id`; large-output truncation with no deadlock.

Suite G — process tree: grandchild killed on cancel; grandchild killed on
timeout (Job Object termination verified via PID liveness).

Test harness: the broker spawns the test binary itself
(`std::env::current_exe()`) with a `#[cfg(test)]`-only child protocol selected
through the env allowlist — no `cmd.exe`, `powershell.exe`, `sh` or `bash`
fixtures. A `CHILD_TEST_LOCK` serializes child-spawning tests; the lock
recovers from poison so one failing test cannot cascade.

## 11. Verification (all on `local/cp3-broker-core`, no push)

- `cargo fmt --check` — clean.
- `cargo check` — clean (only the pre-existing `clipboard.rs`
  `has_clipboard_content` dead-code warning from the base).
- `cargo clippy --all-targets` — clean for the broker; remaining warnings are
  pre-existing base warnings (`clipboard.rs`, `brain_server.rs`, `commands.rs`,
  `mcp_helper.rs`, `main.rs`, `udp_listener.rs`) untouched by this checkpoint.
- `cargo test` — **42 passed, 0 failed, 1 ignored** (the ignored test is the
  child-protocol entry spawned explicitly by parent tests), including all
  pre-existing base tests.
- `cargo audit` (advisory-db `D:\environment\advisory-db`, `--no-fetch`) —
  **5 vulnerabilities / 17 allowed warnings, identical to the base lock**
  (verified by auditing the base `Cargo.lock`); no new crates were added
  beyond `libc` (unix-only) and already-locked windows 0.52 features.
  `UNKNOWN=0`, `BLOCKS_CP3=0`.
- `npm run verify:controlled` — OK; snapshot regenerated for the 4 expected
  entries (`Cargo.toml`, `Cargo.lock`, `commands.rs`, `main.rs`) and committed.
- `git diff --check` — clean.

## 12. Known residual risks

- TOCTOU window between the pre-spawn fingerprint check and `CreateProcess`
  (metadata fingerprint, not full hash — deliberate for CP3; revisit with
  binary hashing in a later checkpoint if the threat model requires it).
- The child test harness (`libtest`) consumes leading `--flag`-style payload
  args; argv preservation for such values is verified at the `build_argv`
  unit level and is documented here rather than end-to-end.
- Windows Job Objects are the containment guarantee target; the unix fallback
  is process-group based and is not exercised on this Windows host.
- Secret stripping applies to the broker child environment only; other
  same-user surfaces (clipboard, existing daemon code) are out of CP3 scope.
- `get_broker_status` is the only IPC surface; production `execute` IPC opens
  in CP4 with the GitHub adapter.

## 13. Commits

See `docs/goal24/checkpoint3-lane-a-manifest.json` for the commit SHAs and the
full file list.