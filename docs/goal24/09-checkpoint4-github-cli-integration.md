# Goal24 Checkpoint 4 - GitHub CLI Integration and Security Freeze

Status: **GOAL24_CHECKPOINT4_BLOCKED (AUTH_REQUIRED)** - code integration complete,
all code-level gate criteria PASS, runtime gate blocked only by missing `gh`
authentication on this host. Checkpoint 5 was not started.

- Base: `8238c350e56bcbf486a2e484287bcad66fda6174` (`origin/dev/goal24-cli-skills`)
- Integration branch: `local/cp4-integration` (worktree `D:\ai_code\Omni-context-worktrees\cp4-integration`)
- Code head at freeze: `65a9c27`

## 1. Lanes integrated

| Lane | Requested commits | Integrated commits |
| --- | --- | --- |
| A - GitHub CLI Adapter Core | `aec2d77`, `8e5cb62`, `287cb20`, `3895a0e` | `cc0b70f`, `30832c1`, `3de9010`, `19977b2` |
| B - GitHub Semantic Capabilities | `8d0dcee`, `9c44e05`, `02d71f7` | `8ffbb13`, `e5425c3`, `964525f` |
| C - gh Compatibility / Security Audit | `66db522` | `8c88397` |

All eight lane objects were verified present and cherry-picked in order onto the
verified base. Lane A trees are identical to the requested commits (tree-hash
verified). Lane B/C branched from earlier lanes, so their per-commit trees
differ from the request, but the lane tip content is fully present on the
integration branch.

Integration commits on top of the lanes:

- `8863528` feat(github-cli): cp4 production bootstrap, conformance and read-only e2e
- `65a9c27` test(github-cli): cover unc discovery, number overflow and exact adversarial payloads

## 2. Semantic capabilities (WHAT)

Five capabilities in `brain-server/src/capabilities/github-readonly.ts`, all
`version 1.0.0`, `authority L0`, `risk low`, `side_effect_class read_only`,
`reversible false`, `required_evidence []`:

- `github.repo.inspect`
- `github.issue.search`
- `github.issue.read`
- `github.pr.read`
- `github.pr.checks.read`

The catalog contains no transport detail: no `adapter_id`, no `gh`, no CLI
command, no argv, no executable. Dynamic registration / skill discovery remain
Checkpoint 5 concerns.

## 3. Rust bindings (HOW)

Five production read-only bindings registered only from the trusted Rust
bootstrap (`github_cli::bootstrap::bootstrap_production`); IPC callers cannot
create bindings.

| Binding | Command shape (compiled, fixed) |
| --- | --- |
| `github-cli.repo.inspect` | `gh repo view <owner/repo> --json=<fixed fields>` |
| `github-cli.issue.search` | `gh issue list --repo=<owner/repo> [--search=<query>] [--state=<state>] [--limit=<n>] --json=<fixed fields>` |
| `github-cli.issue.read` | `gh issue view <number> --repo=<owner/repo> --json=<fixed fields>` |
| `github-cli.pr.read` | `gh pr view <number> --repo=<owner/repo> --json=<fixed fields>` |
| `github-cli.pr.checks.read` | `gh pr view <number> --repo=<owner/repo> --json=<fixed fields incl. statusCheckRollup>` |

PR checks deliberately use `gh pr view --json statusCheckRollup` - never
`gh pr checks` - so the broker's global exit semantics stay unchanged (the
exit-8 "checks pending" special case is avoided).

## 4. Executable pinning and discovery

- No bare `gh` / `gh.cmd` / `gh.bat` / `gh.ps1` spawn exists anywhere.
- No dev-machine `D:\` path is hardcoded in product source.
- Production bootstrap: trusted config (`OMNI_GITHUB_CLI_EXE`, absolute path)
  -> standard install locations -> PATH discovery; each candidate must be an
  absolute, canonicalizable, regular `.exe` file. UNC network paths are
  rejected. The broker re-resolves and fingerprints the executable before
  every spawn.
- The test harness injects `D:\environment\github-cli\bin\gh.exe` as the
  trusted runtime candidate (test-only), which is how the real Broker E2E runs.
- Bootstrap records `resolved_gh`, `source`, `registered_bindings` and
  `version_probe_bypassed: true`. No `gh --version` process probe is spawned;
  version compatibility state comes from file metadata plus the Lane C
  compatibility manifest.

## 5. Cross-language conformance

`docs/goal24/cp4-github-readonly-contract.json` vs
`brain-server/src/capabilities/github-readonly.ts` /
`github-inputs.ts` vs Rust `github_cli/inputs.rs` + `bindings.rs`:

- 5 capability ids: 1:1 match (binding id `github-cli.*` -> capability id
  `github.*`).
- owner: `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`, max 39, no trimming.
- repo: `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, max 100, no trimming.
- number: integer >= 1 (zero, negatives, floats, strings, u64 overflow rejected).
- limit: integer 1..100, default 30 (floats/strings/out-of-range rejected).
- state: enum `open|closed|all`.
- query: max 1024; NUL + C0 controls rejected; everything else stays ONE
  semantic string emitted as ONE fused argv value (`--search=<query>`).
- unknown keys rejected on both sides (strict schemas).
- Verified by `contract_json_conformance_matches_rust_bindings` and
  `binding_metadata_matches_contract`. **Mismatches: NONE.**

## 6. Environment and auth policy

- gh: `D:\environment\github-cli\bin\gh.exe`, version `2.97.0 (2026-07-31)`.
- `gh auth status --active --hostname github.com` -> exit 1 ("not logged into
  any GitHub hosts"). **auth_ready = false**.
- `AUTH_MUTATED = NO`: no `gh auth login/refresh/logout/switch/token` and no
  `--show-token` was ever executed by this task. `TOKEN_READ = NO`.
- Child env: broker `env_clear()` + minimal allowlist
  (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`) so gh can read its own secure
  credential store. `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`,
  `GITHUB_ENTERPRISE_TOKEN`, `GH_HOST`, `GH_REPO`, `GH_CONFIG_DIR`, browser and
  proxy vars are never inherited. No token is ever injected into the env.

## 7. Real Broker E2E results

Executed through the real `ExecutionPlan -> Broker -> registered GitHub CLI
ExecutionBinding -> pinned gh.exe -> JSON parser` path
(`cargo test --bin omni-context-desktop e2e_ -- --ignored --nocapture`):

| Capability | Result |
| --- | --- |
| `github.repo.inspect` (guo6x/Omni-context) | **AUTH_REQUIRED pipeline-ok**: gh exited 4 -> `GH_AUTH_NOT_READY`; no hang, prompt or browser |
| `github.issue.search` (guo6x/Omni-context, limit 5) | **AUTH_REQUIRED pipeline-ok**: same live pipeline result |
| `github.issue.read` | **NO_EXISTING_ISSUE_FIXTURE** (no fixture configured; pure adapter test covers the parser) |
| `github.pr.read` | **NO_EXISTING_PR_FIXTURE** (pure adapter test covers the parser) |
| `github.pr.checks.read` | **NO_EXISTING_PR_FIXTURE** (pure adapter test covers the parser) |

The auth-failure path is also automated with a sanitized no-auth fixture: the
adapter returns `GH_AUTH_NOT_READY` without panic, interactive prompt, hang,
browser or auto-login.

## 8. Output parser gate

Real gh output only reaches the Rust typed parsers when
`success == true && exit_code == Some(0) && !timed_out && !cancelled &&
!stdout_truncated`. `stdout_truncated`, timeout, cancel, nonzero exit and
invalid/truncated JSON all fail closed - raw JSON strings are never reported
as semantic success.

## 9. Adversarial oracle

`docs/goal24/cp4-adversarial-execution-map.json`:

- total 103 vectors: 92 AUTOMATED, 4 COVERED_BY_EXISTING_TEST, 2 MANUAL,
  5 NOT_APPLICABLE, **unmapped 0**, **failed 0**.
- FAIL-01..FAIL-12 integration fail conditions: all **NOT_TRIGGERED**.
- Critical automatable coverage includes owner/repo injection, CLI flag
  injection, query shell metacharacters, number/limit bounds, unknown keys,
  fake `.cmd/.bat/.ps1`, relative gh, PATH fake gh.exe, token/host/repo/config/
  proxy env vars, invalid JSON, truncated output, auth failure and exit-code
  semantics.

## 10. Security invariants

- `write_capabilities_registered = 0` (no issue create/comment/close, pr merge,
  repo edit, `gh api`, POST/PATCH/DELETE anywhere in executable argv).
- `generic_execute_ipc = false` (`execute_ipc_enabled` stays false; no
  execute_plan/run_command/run_gh IPC).
- Broker core semantics unmodified: generic_shell false, arbitrary
  executable/cwd/env false, required_approval plans blocked, ready-only first
  spawn, Windows Job Object process-tree termination, 1 MiB output limits.
  The only execution_broker changes in CP4 are additive (two forbidden env
  names + test-only re-exports).
- `git diff --check` clean.

## 11. Test results

- Rust: `cargo fmt --check` PASS; `cargo check` PASS (1 pre-existing
  dead_code warning in `clipboard.rs`); `cargo clippy --all-targets` PASS
  (warnings only in pre-existing files, zero in CP4 code); `cargo test`
  **124 passed, 0 failed, 6 ignored**; E2E `--ignored` **5 passed**.
- Desktop: `npm run build` PASS; `npm run verify:controlled` PASS.
- Brain server: `npm run typecheck` PASS; `npm test` **580 passed (42 files)**;
  `npm run build` PASS; `npm run lint` 0 errors / 9 pre-existing warnings.
- `git diff --check` clean.

## 12. Cargo audit (fresh run)

`cargo-audit 0.22.2` against `D:\environment\advisory-db-offline`
(output: `D:\environment\tmp\cp4-audit.txt`):

- vulnerabilities: 5 - all NOT_REACHABLE, identical to the CP3 baseline
  (`crossbeam-epoch` 0.9.18 RUSTSEC-2026-0204; `quick-xml` 0.30.0/0.39.3
  RUSTSEC-2026-0194/0195 on xcb/plist/wayland paths not compiled for Windows).
- warnings: 17.
- UNKNOWN = 0, FIX_BEFORE_CP4 = 0, BLOCKS_CP4 = 0.

## 13. Gate evaluation

`CHECKPOINT4_RUNTIME_GATE = AUTH_REQUIRED`, `CHECKPOINT4_SECURITY_GATE = BLOCKED`.

| Criterion | Result |
| --- | --- |
| A. 5 TS semantic capabilities valid | PASS |
| B. 5 Rust bindings 1:1 match | PASS |
| C. 5 production bindings READ-ONLY only | PASS |
| D. 0 write binding | PASS |
| E. gh executable resolved to concrete absolute gh.exe | PASS |
| F. no bare PATH spawn | PASS |
| G. no token env inheritance | PASS |
| H. auth ready through existing secure gh auth | **BLOCKED (auth_ready=false, exit 1)** |
| I. real github.repo.inspect through Broker PASS | **AUTH_REQUIRED_PIPELINE_VERIFIED** (GH_AUTH_NOT_READY via exit 4) |
| J. real issue.search through Broker PASS | **AUTH_REQUIRED_PIPELINE_VERIFIED** (GH_AUTH_NOT_READY via exit 4) |
| K. available issue/pr fixtures | VACUOUS - NO_FIXTURE (no test issue/PR created) |
| L. pr checks uses pr view/statusCheckRollup | PASS |
| M. all security vectors mapped | PASS (103/103, unmapped=0) |
| N. critical automatable vectors PASS | PASS (92+4 pass, failed=0) |
| O. generic execute IPC remains false | PASS |
| P. CP3 invariants preserved | PASS |
| Q. full regression green | PASS |

The checkpoint is **not** declared COMPLETE. The owner must log into `gh`
(`gh auth login`, performed by the owner, never by this task) and re-run the
ignored E2E tests to flip H/I/J to PASS; no code change is expected.

## 14. Declarations

- `CHECKPOINT5_STARTED = NO` (Skill Registry / SKILL.md runtime / discovery /
  persistence untouched).
- `HOLDBACK_TOUCHED = NO`, `SCIENTIFIC_REFS_CHANGED = NO`, `MAIN_TOUCHED = NO`.
- `DIRTY_CP21_WORKTREE_TOUCHED = NO` - `D:\ai_code\Omni-context\.worktrees\goal24-cp21`
  was never entered, reset, cleaned, stashed, checked out, deleted or modified.
- `AUTH_MUTATED = NO`, `TOKEN_READ = NO`.

Machine-readable records: `checkpoint4-security-gate.json`,
`checkpoint4-manifest.json`, `checkpoint4-environment.json`,
`checkpoint4-adversarial-execution-map.json`.