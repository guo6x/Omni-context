# Goal24 Checkpoint 3 - Integration and Security Freeze

Date: 2026-08-13
Status: CHECKPOINT3_COMPLETE / CHECKPOINT3_SECURITY_GATE_PASS
Base: `93d9cf53c91e56d4c7b13e85d6197014d0a879c7` (`origin/dev/goal24-cli-skills`, verified exact after `git fetch --all --tags --prune`)
Integration branch: `local/cp3-integration` (worktree `D:\ai_code\Omni-context-worktrees\cp3-integration`)
Integration head before freeze documents: `627c8f7`

## 1. Integrated lanes

### Lane A - Broker Core

| Requested SHA | Integrated SHA | Subject |
| --- | --- | --- |
| `551b663` | `26a1c1c095ae816b5c4d23a167a77b78bb9a9df4` | feat(tauri): add restricted execution broker core |
| `6d10b0e` | `27225c4d73dde30c74678ec955a8727ea0bda0a4` | test(tauri): add broker security and lifecycle tests |
| `87af788` | `4f0970dce0ed61ed0c987f822348a92c8f46b467` | docs(goal24): record checkpoint 3 broker core |
| `db32dd07fff49e1fdd456b5ee3a2ed22b2f17d8c` | `646b76a080faa36e40516769b0b9ac9813332490` | docs(goal24): add checkpoint 3 lane A manifest |

All requested commits verified present and content-identical to the integrated
commits (cherry-picked onto `93d9cf53` in order, no squash, no security
weakening during conflict resolution; there were no conflicts).

### Lane B - Adversarial Oracle

| Requested SHA | Integrated SHA | Subject |
| --- | --- | --- |
| `33bf48ecbacf3f5eb85312a582a82849b00ff769` | `91f9d76702cee5e9c8f12df0272953e363cf49af` | test/docs(goal24): define broker adversarial security oracle |

Lane B adds 104 machine-readable adversarial vectors on top of the frozen
threat model `T01-T26`. The additions `T27-T33` are explicitly marked
`ADVERSARIAL_EXTENSION`; the original threat model was not rewritten.

### Lane C - Existing Surface Audit

| Requested SHA | Integrated SHA | Subject |
| --- | --- | --- |
| `0dbd0402465118507eb93acc7984ed12ed40fe88` | `a2fdb8757a8d4b28408abffb984b06ec0836c149` | security/docs(goal24): audit existing local process surfaces |
| `832c4cd` | `eddfd295fcc0075b0ec8bb369b5e3c74101f4552` | docs(goal24): add cp3 lane C audit manifest |

## 2. Integration commits

| SHA | Subject |
| --- | --- |
| `2d5cdba` | security(desktop): close generic shell-open bypass |
| `627c8f7` | security(execution-broker): cp3 hardening and adversarial oracle |

## 3. Broker public surface

- Tauri IPC exposes exactly one broker command: read-only
  `get_broker_status() -> BrokerStatus`. `execute_ipc_enabled` is `false` and
  there are zero production registered bindings.
- `Broker::execute(plan, binding_id)` is `pub(crate)`. Executable, argv, cwd
  and env are always built from the compiled trusted `ExecutionBinding`; the
  plan and the IPC caller cannot supply any of them.
- Generic execute IPC: **NO**. Test-only binding in production: **NO**.
  Production adapter: **NO** (the GitHub CLI adapter is the CP4 boundary).
- The pre-merge security review found no `execute_command(command: String)`,
  `run_shell(...)`, `run_program(program_from_user, ...)`, caller-supplied
  executable/argv/cwd/env, or `cmd /C` / `powershell -Command` / `sh -c` /
  `bash -c` paths anywhere in the broker.

## 4. Shell-open closure

- Before: `tauri.conf.json` `shell.open = true`; the frontend imported
  `@tauri-apps/api/shell` and used `open()` plus a `window.open` fallback.
- After: `"shell": { "open": false }`; the `shell-open` cargo feature was
  removed; the frontend no longer imports `@tauri-apps/api/shell` and no
  longer calls `window.open` for links.
- Replacement: `open_trusted_external_url(target_id: String)` in
  `commands.rs`. `target_id` is a semantic enum value, not a URL or path; Rust
  maps it through a hardcoded HTTPS-only table and dispatches with
  `ShellExecuteW`. The frontend cannot supply a URL, path, scheme or argument.
- Generic frontend shell-open after closure: **NO**.

## 5. CP3 hardening (integration)

- Oracle error-code taxonomy: `PlanRejected*` / `BrokerBlocked*` /
  `BrokerTimeout` / `Cancelled` / `OutputLimit` / `Crash`.
- Cwd validation: NUL, absolute, UNC, verbatim `\\?\`, ADS and canonical
  containment checks; `..`, symlink and junction escapes fail closed.
- Executable resolution: `.exe` only, canonical identity, regular-file check,
  metadata fingerprint (path + size + mtime) re-verified before spawn;
  symlink/junction candidates fail closed.
- Output redaction: tokens, bearer, URL userinfo and control characters are
  redacted; results carry an `output_redacted` flag.
- Process-tree drain on child exit via `QueryInformationJobObject`
  `ActiveProcesses` before the job handle closes.
- Approval reference consistency is validated before the `required_approval`
  gate.
- Single-use plan ledger blocks plan replay across executions.
- `GITHUB_TOKEN` (and other forbidden secret names/prefixes) fail closed in
  the child environment.
- T16 default plan TTL: `runner::DEFAULT_PLAN_TTL_MS = 86_400_000` (24 hours
  from `created_at` when `expires_at` is absent); `plan_is_stale()` enforces
  it. Adversarial test: `stale_plan_default_ttl_rejected`.

## 6. Adversarial oracle (104 vectors)

Sources: `docs/goal24/cp3-broker-adversarial-vectors.json` (vector set),
`docs/goal24/checkpoint3-adversarial-execution-map.json` (execution map),
test module `desktop-daemon/src-tauri/src/execution_broker/adversarial.rs`.

| Bucket | Count |
| --- | --- |
| AUTOMATED | 41 |
| COVERED_BY_EXISTING_TEST | 46 |
| MANUAL | 11 |
| NOT_APPLICABLE | 6 (V006, V011, V065, V076, V077, V079) |
| UNMAPPED | 0 |
| FAILED | 0 |

- `T27-T33` are `ADVERSARIAL_EXTENSION` (added by Lane B on top of the frozen
  `T01-T26`; the original threat model was not rewritten).
- No `F01-F13` oracle failure was observed.

## 7. Process tree, approval and environment validation

- Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; the child is
  created `CREATE_SUSPENDED`, assigned to the job, then resumed
  (assign-before-resume closes the escape window). On child exit the broker
  drains the tree via `QueryInformationJobObject ActiveProcesses`.
- Breakaway attempts are blocked; a broker crash kills the job.
- Verified tests: `process_tree_grandchild_killed_on_cancel`,
  `process_tree_grandchild_killed_on_timeout`, `tree_drain_child_exit_first`,
  `breakaway_attempt_blocked`, `broker_crash_job_kill`.
- Approval fail-closed: `required_approval=true` plans cannot execute in CP3
  (`APPROVAL_ENFORCEMENT_NOT_AVAILABLE`) even when an `ApprovalReference` is
  structurally present; approval reference consistency is checked before the
  gate. Tests: `gate_required_approval_blocked_in_cp3`,
  `approval_reference_consistency_rejected`.
- Environment: `build_child_env` restores base variables plus the binding
  allowlist only; `FORBIDDEN_ENV_NAMES` and forbidden prefixes are stripped;
  `GITHUB_TOKEN` in the broker environment fails closed. Tests:
  `env_secrets_not_inherited_and_allowlist_present`, `github_token_env_blocked`.
- Output limits: `DEFAULT_OUTPUT_MAX_BYTES = 1048576` (1 MiB) for stdout and
  1 MiB for stderr; binding-supplied limits are clamped into `[1, 1 MiB]`.
  Reader threads keep draining past the cap so the child can never deadlock
  on a full pipe. Tests: `output_limit_error_code_reported`,
  `lifecycle_large_output_truncated_no_deadlock`,
  `persistent_secret_leak_test` PASS.

## 8. Verification results (all green)

- Rust: `cargo fmt --check`, `cargo check`, `cargo clippy --all-targets`
  clean; remaining clippy items are pre-existing base warnings.
- `cargo test`: **64 passed, 0 failed, 1 ignored** (the ignored entry is the
  child-protocol harness spawned explicitly by parent tests).
- `cargo test execution_broker`: **54 passed, 1 ignored** (adversarial 21 +
  Lane A 33).
- Frontend: `npm run snapshot:controlled` then `npm run verify:controlled`
  OK; `npm run build` OK.
- Brain server: `typecheck` OK; `vitest` **479 passed (41 files)**; `build`
  OK; `eslint` 0 errors (9 warnings).
- Not run: 11 MANUAL adversarial vectors plus the 1 ignored child harness.

## 9. Cargo audit

- Tool: `cargo-audit 0.22.x`; database `D:\environment\advisory-db-offline`
  (RustSec, 1216 advisories, HEAD `69f93e1`); output archived at
  `D:\environment\tmp\cp3-audit.txt`.
- Vulnerabilities: **5**, all classified NOT_REACHABLE for the Windows target:
  - `crossbeam-epoch` 0.9.18 `RUSTSEC-2026-0204` (format impls never
    exercised).
  - `quick-xml` 0.30.0 / 0.39.3 `RUSTSEC-2026-0194` / `RUSTSEC-2026-0195`
    (xcb build-dependency; plist / wayland-scanner paths not compiled on
    Windows).
- Warnings: **17** (informational unmaintained / yanked categories).
- `UNKNOWN = 0`, `FIX_BEFORE_CP3 = 0`, `BLOCKS_CP3 = 0`.
- Note: yanked-status registry checks timed out in the offline environment;
  the advisory-database scan itself completed and is the basis of the
  classification above.

## 10. Remaining legacy risks

- S2 `kill_zombie_by_pid_file()` PID-file `taskkill` (LEGACY_RISK; local
  attacker only - the webview cannot write the pid file).
- S8 `register_global_shortcuts()` (LEGACY_RISK).
- S9 `process_dropped_paths()` (OUT_OF_SCOPE filesystem surface).
- S10 broad `fs.readFile **` / `path-all` / `clipboard-all` / `window-all`
  (OUT_OF_SCOPE permission surface).
- Residual TOCTOU between the pre-spawn metadata fingerprint check and
  `CreateProcess` (metadata fingerprint; revisit with binary hashing in a
  later checkpoint if the threat model requires it).
- Unix process-group containment fallback is not exercised on this Windows
  host.

## 11. Environment policy

- `D:` first, `C:` only for existing tooling, never install new tooling to
  `C:`; new installs go to `D:\environment`.
- `CARGO_TARGET_DIR = D:\environment\cargo-target\cp3-integration`; npm cache
  `D:\environment\npm-cache`; advisory DB `D:\environment\advisory-db`.
- Integration performed in worktree
  `D:\ai_code\Omni-context-worktrees\cp3-integration`; the main repository at
  `D:\ai_code\Omni-context` was not modified and its pre-existing dirty state
  on `research/decision-benchmark-holdback-v2` was left untouched.

## 12. Security gate (A-O, all PASS)

| Id | Criterion | Result |
| --- | --- | --- |
| A | Broker has no generic shell interface | PASS - resolved absolute `.exe` candidates only; no `cmd.exe` / `powershell` / `sh` / `bash`; `taskkill` deliberately not used |
| B | No arbitrary executable / argv / cwd / env from caller | PASS - built from compiled `ExecutionBinding`; forbidden input keys rejected |
| C | `required_approval=true` cannot execute | PASS - `PlanRejectedApproval` gate before any spawn |
| D | Only ready plans can first-spawn | PASS - non-ready states rejected; executing is a replay guard |
| E | Expired / replay rejected | PASS - `plan_is_expired` + 24h default TTL + single-use ledger |
| F | Windows Job Object process-tree termination verified | PASS - `KILL_ON_JOB_CLOSE`, assign-before-resume, tree drain |
| G | stdout / stderr bounded | PASS - 1 MiB caps, clamped, drain past cap without deadlock |
| H | Parent credentials not inherited | PASS - base vars + allowlist only; forbidden names stripped; `GITHUB_TOKEN` fail-closed |
| I | Test-only binding absent from production | PASS - `#[cfg(test)]` only; zero production `register_binding` calls |
| J | Frontend generic shell.open removed / disabled | PASS - `shell.open=false`, feature removed, `open_trusted_external_url` replacement |
| K | All 104 adversarial vectors mapped | PASS - unmapped = 0 |
| L | All automatable critical vectors PASS | PASS - 41 AUTOMATED + 46 COVERED_BY_EXISTING_TEST all green |
| M | No F01-F13 oracle failure | PASS - failed = 0 |
| N | cargo audit UNKNOWN=0 FIX_BEFORE_CP3=0 BLOCKS_CP3=0 | PASS - 5 NOT_REACHABLE + 17 warnings |
| O | Full regression green | PASS - cargo / frontend / brain-server suites green |

Gate result: `CHECKPOINT3_SECURITY_GATE = PASS`.
See `docs/goal24/checkpoint3-security-gate.json` for the machine-readable
record.

## 13. CP4 boundary

`CHECKPOINT4_STARTED = NO`. Per the CP3 scope freeze, none of the following
was implemented: GitHub CLI adapter, `gh.exe` binding, capability registry,
issue create, PR merge. Work stops after this checkpoint.

## 14. Freeze documents

- `docs/goal24/08-checkpoint3-integration-and-security-gate.md` (this file)
- `docs/goal24/checkpoint3-security-gate.json`
- `docs/goal24/checkpoint3-adversarial-execution-map.json`
- `docs/goal24/checkpoint3-manifest.json`

Declarations: `CHECKPOINT4_STARTED=NO`, `HOLDBACK_TOUCHED=NO`,
`SCIENTIFIC_REFS_CHANGED=NO`, `MAIN_TOUCHED=NO`, `GENERIC_EXECUTE_IPC=NO`,
`PRODUCTION_ADAPTER_REGISTERED=NO`.

Push and cleanup: a normal fast-forward push of `dev/goal24-cli-skills` to
`origin` (no force) is executed immediately after this commit; the
confirmation is recorded in a follow-up commit in the manifest and in the
final checkpoint response. After the push the temporary worktrees
`cp3-broker-core`, `cp3-adversarial-testspec`, `cp3-process-surface-audit`
and `cp3-integration` and their local branches are removed.