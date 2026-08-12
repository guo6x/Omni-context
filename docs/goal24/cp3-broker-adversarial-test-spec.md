# Goal24 Checkpoint 3 — Lane B: Independent Broker Adversarial Test Specification

Status: **DESIGN ONLY — oracle specification, no broker implementation.**

Date: 2026-08-13

Lane: **B — ADVERSARIAL SPEC**

Base SHA: `93d9cf53c91e56d4c7b13e85d6197014d0a879c7`

## 1. Purpose

This lane independently defines the **adversarial test oracle** that the
Checkpoint 3 Integration lane must run against Lane A's broker
implementation before any plan execution is enabled. It is an attack-style
acceptance specification: 104 machine-readable adversarial vectors across 23
categories, each with a deterministic expected outcome and a hard
`must_not_happen` boundary. The oracle is designed **independently of Lane
A's implementation** (Lane A worktree was not read) and derives its
expectations only from:

- `docs/goal24/cp3-execution-broker-threat-model.md` (threats T01-T26, Windows rules W1-W7, Lane C gate policy)
- `docs/goal24/01-cli-skill-desktop-integration-plan.md` (broker responsibility split)
- `brain-server/src/execution/contracts.ts` (`ExecutionPlanSchema`, `ApprovalReferenceSchema`, `EXECUTABLE_PLAN_STATES`, `FORBIDDEN_INPUT_KEYS`, `isExecutionPlanExpired`, `validateExecutionPlanAgainstCapabilities`, `timeout_ms` bounds)
- `brain-server/src/capabilities/contracts.ts` (`CAPABILITY_ID_PATTERN`, `RESERVED_TRANSPORT_PREFIXES`, authority/risk/side-effect model)
- `desktop-daemon/src-tauri/src/{main.rs,brain_server.rs,mcp_helper.rs,commands.rs}` (pre-existing process surface, section 4)

## 2. Deliverables

| File | Content |
| --- | --- |
| `docs/goal24/cp3-broker-adversarial-test-spec.md` | This specification (oracle definition, vector format, execution rules) |
| `docs/goal24/cp3-broker-adversarial-vectors.json` | 104 machine-readable adversarial vectors + oracle gate + threat registry + plan templates + fixture contract |
| `docs/goal24/checkpoint3-lane-b-manifest.json` | Lane B manifest: coverage counts, required-example checks, declarations |

No Rust/TS implementation is added or modified by this lane.

## 3. Broker under test (assumed interface)

The oracle targets the future Tauri Local Execution Broker as specified by
the threat model. The broker's observable contract is assumed to be:

1. **Input**: an `ExecutionPlan` JSON (strict schema per `ExecutionPlanSchema`) delivered over local IPC, plus broker-internal spawn parameters (program/cwd/env) that only the adapter may set.
2. **Gate**: parse with strict schema; reject unknown fields; check `state in EXECUTABLE_PLAN_STATES`; call `isExecutionPlanExpired(plan, now)`; verify approval binding and single-use consumption; run `validateExecutionPlanAgainstCapabilities`; bind `adapter_id`; then adapter-only argv construction.
3. **Spawn**: single program + argv primitive; pinned absolute executable; allowlisted canonical cwd; scrubbed env; job object / process group; watchdog on `timeout_ms`.
4. **Output**: bounded, streaming, redacting capture.
5. **Observables for the harness**: spawn events (program, argv, cwd, env snapshot), process-tree membership, state transitions, audit records (incl. resolved executable + hash), persisted output.

Vectors that cannot reach plan parsing (e.g., executable-extension and cwd
boundary tests) are expressed at the **broker request level** (`request` in
`input_shape`) and assert the spawn-boundary controls directly.

## 4. Pre-existing process surface distinction (normative)

`desktop-daemon/src-tauri/src/brain_server.rs` contains **pre-existing**
process management that predates the broker and is **not** part of the
Checkpoint 3 security-ready claim:

- Brain Server lifecycle: `Command::new(&node_exe)` + explicit args + `CREATE_NO_WINDOW`, `/health` readiness polling.
- Termination helpers: `taskkill` / `kill -9` against a stored PID; PID-file zombie cleanup.
- Folder opening: `explorer` / `open` / `xdg-open` for data/log/config folders (also in `mcp_helper.rs`).
- MCP client config install (`mcp_helper.rs`) writes `command`/`args` JSON for external MCP clients.

Consequences for the Integration gate:

1. **Old spawns are not broker passes.** A test may observe the desktop-daemon
   spawning `node.exe` (Brain Server lifecycle) or `explorer` (folder open)
   during a vector run; those observations do **not** satisfy or fail any
   broker vector. Only the broker's plan-driven spawn path is scored.
2. **Old lifecycle is not rewritten here.** This lane does not require
   hardening or replacing the pre-existing Brain Server lifecycle; that is
   tracked separately from the CP3 broker claim (consistent with threat-model
   section 7).
3. **No cross-contamination.** The broker must not reuse `brain_server.rs`
   command-string patterns for plan execution; the oracle includes vectors
   that would fail if a plan-derived string were passed to a `cmd`/shell-style
   launch (F02) or if plan execution were routed through the Brain Server
   lifecycle helper.

## 5. Checkpoint 3 Integration Gate (security oracle)

A plan-execution build is **not security-ready** while any of the following
is observable during the vector suite. Each condition maps to
`oracle.fail_conditions` in the vectors JSON (F01-F13).

| ID | FAIL condition | Example vector |
| --- | --- | --- |
| F01 | Generic command execution (a plan input/field causes execution of a generic command, not a capability-bound executable) | V006, V007, V009 |
| F02 | Shell invocation (sh/bash/cmd/powershell with constructed string) | V022-V027 |
| F03 | Caller-selected executable (plan/IPC selects the program path) | V006, V007, V009, V011 |
| F04 | Caller-selected cwd (working directory outside adapter allowlist) | V032-V035, V092, V094-V097 |
| F05 | Parent credential inheritance (non-allowlisted parent env reaches child) | V040, V042-V045, V049 |
| F06 | `required_approval=true` plan executes without valid approval | V005, V080-V084 |
| F07 | Expired/replayed plan executes | V001-V004, V085-V087 |
| F08 | Process tree survives timeout/cancel/broker death | V058, V066-V070 |
| F09 | Unbounded stdout/stderr (no byte cap; deadlock or OOM) | V050-V054 |
| F10 | Unknown JSON fields silently accepted | V088-V091, V009, V006, V027, V048 |
| F11 | `.cmd`/`.bat`/`.ps1` executable accepted by default | V028-V031, V013 |
| F12 | PATH-selected fake binary executed instead of pinned binary | V010-V013 |
| F13 | Output/credential fully persisted unredacted | V046, V047, V055-V057, V099 |

Gate rule: **one F01-F13 observation = integration FAIL**. The set is
conservative: a vector may pass while its `must_not_happen` boundary still
records a FAIL condition — the two checks are independent.

## 6. Vector format

Every vector in `cp3-broker-adversarial-vectors.json` carries exactly:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | `V001`..`V104` |
| `threat_id` | string | Threat-model id (T01-T26) or this spec's extension (T27-T33) |
| `category` | string | One of the 23 categories (section 7) |
| `severity` | string | `high` / `medium` / `low` |
| `platform` | string | `windows` / `windows+posix` / `posix` |
| `input_shape` | object | Machine-readable attack payload (section 6.1) |
| `attack_goal` | string | What the attacker is trying to achieve |
| `expected_broker_result` | string | Enum: `REJECTED_BEFORE_SPAWN`, `EXECUTED_SAFE`, `OUTPUT_TRUNCATED`, `KILLED_TIMEOUT`, `KILLED_CANCELLED`, `TREE_TERMINATED`, `EXECUTED_WITH_REDACTION`, `BLOCKED_RESOLUTION` |
| `expected_error_code` | string | Enum: `NONE`, `PLAN_REJECTED_INVALID`, `PLAN_REJECTED_STATE`, `PLAN_REJECTED_EXPIRED`, `PLAN_REJECTED_APPROVAL`, `PLAN_REJECTED_CAPABILITY`, `PLAN_REJECTED_ADAPTER`, `PLAN_REJECTED_SINGLE_USE`, `BROKER_BLOCKED_EXECUTABLE`, `BROKER_BLOCKED_EXTENSION`, `BROKER_BLOCKED_CWD`, `BROKER_BLOCKED_PATH`, `BROKER_BLOCKED_ARGV`, `BROKER_BLOCKED_ENV`, `BROKER_TIMEOUT`, `BROKER_CANCELLED`, `BROKER_OUTPUT_LIMIT`, `BROKER_CRASH` |
| `must_not_happen` | string[] | Hard FAIL boundaries; **any** element observed = vector FAIL regardless of result/error match |

### 6.1 `input_shape` semantics

`input_shape` is a JSON object with these keys:

- `template` (optional): `tpl_read` or `tpl_write` — the canonical valid plan from `plan_templates`. `tpl_read` = `github.repo.inspect` (read-only, L0, no approval). `tpl_write` = `github.issue.close` (reversible write, L2, `required_approval=true`, valid `ApprovalReference`, verification + rollback bound).
- `mutations` (optional): JSON-Patch-style operations applied to the template before delivery: `{op: "replace"|"add", path: "/state"|"/normalized_inputs/reason"|... , value: ...}`. Paths are relative to the plan root. This is the machine-readable way to express attack payloads (e.g., `"; calc.exe"`, `"--repo evil"`, `..\..\Windows\System32`, NUL, homoglyphs).
- `request` (optional): broker-internal spawn request `{program, argv, cwd, env}` used for spawn-boundary vectors that do not pass through plan parsing. `env: "__INHERIT__"` means "simulate wholesale parent inheritance".
- `environment` (optional): map of env vars the harness must place in the broker's parent environment (e.g., `GH_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `NPM_TOKEN`).
- `path_fixtures` (optional): filesystem artifacts the harness must create (planted fake `gh.exe`, shims, junctions, symlink cycles, swap/flip sync points). Marker-file contracts are defined in `fixture_contract`.
- `child_behavior` (optional): probe-executable behavior to select (`fixture_contract.behaviors`).
- `cancel_at_ms` / `timeout_ms_override` / `broker_crash_at_ms` (optional): timing controls.
- `race_iterations` (optional): for race vectors, number of repetitions required (default 1; race vectors set 50).

## 7. Categories and threat mapping

All 23 required categories are covered (vector counts in parentheses):

| Category | Count | Threat ids |
| --- | --- | --- |
| PLAN STATE / REPLAY | 5 | T16, T18, T27 |
| EXECUTABLE SELECTION | 4 | T01, T29 |
| PATH HIJACK | 4 | T06, T11, T12 |
| ARGV INJECTION | 8 | T02, T30, T31 |
| SHELL ESCAPE | 6 | T03 |
| WINDOWS FILE TYPES | 4 | T06 |
| CWD ESCAPE | 8 | T07, T30 |
| SYMLINK/JUNCTION | 4 | T08, T13 |
| ENV LEAKAGE | 6 | T09, T31 |
| CREDENTIAL LEAKAGE | 4 | T10, T20, T28 |
| OUTPUT FLOOD | 5 | T19, T25 |
| SECRET OUTPUT | 3 | T33 |
| TIMEOUT | 4 | T21 |
| CANCELLATION | 4 | T22 |
| PROCESS TREE | 5 | T23, T24 |
| TOCTOU | 3 | T13 |
| ADAPTER MISMATCH | 3 | T15 |
| CAPABILITY MISMATCH | 3 | T15 |
| APPROVAL BYPASS | 5 | T18, T28 |
| EXPIRY | 3 | T16, T17 |
| SERDE UNKNOWN FIELDS | 4 | T29 |
| UNICODE/PATH NORMALIZATION | 5 | T30 |
| NUL/CONTROL CHARACTERS | 4 | T31, T02 |

Threat extensions added by this spec (T27-T33) are listed in
`threat_registry` in the vectors JSON; T01-T26 are reproduced from the threat
model.

## 8. Required example coverage (normative checklist)

The following attack examples are embedded in the vector set (id shown):

- Plan state `executing` replay: V001
- `required_approval=true` with fake `ApprovalReference`: V080-V084
- Normalized-input values: `"; calc.exe"` V022, `"| whoami"` V023, `"&& ..."` V024, ``"`...`"`` V025, `"$(...)"` V026, `"--help"` V014 (leading dash), `"--repo evil"` V015, `"-R"` V016, newline V017, CRLF V018/V100, NUL V019/V098, Unicode homoglyph dash V021/V092, fullwidth slash V093
- Paths: `..\..\Windows\System32` V032, junction escape V036, UNC `\\server\share` V101, verbatim `\\?\` path V102, alternate data stream V103, 8.3 short name V104, trailing dot/space V094-V095, case differences V096, fullwidth separator confusion V093
- Executables: `gh.cmd` V028, `gh.bat` V029, `gh.ps1` V030, fake `gh.exe` earlier in PATH V010
- Env: `GH_TOKEN` V041, `GITHUB_TOKEN` V049, `OPENAI_API_KEY` V042, `DEEPSEEK_API_KEY` V043, `NPM_TOKEN` V044
- Output: 10MB stdout V050, 10MB stderr V051, never-closes pipe V052, binary output V053, invalid UTF-8 V054, secret-like output V055-V057
- Process: child creates grandchild V066, grandchild sleeps forever V067, child exits first V068, timeout race V061, cancel race V064

## 9. Execution requirements

1. **Harness isolation.** Vectors run in a clean user profile with a
   disposable PATH; no real tokens are used (all values are fake
   `ghp_...`/`sk-...` strings).
2. **Probe executable.** The harness registers a configurable probe as the
   pinned `github-cli` executable. The probe records its argv/cwd/env to a
   log file and implements `fixture_contract.behaviors`.
3. **Marker contract.** Planted binaries write a marker file on execution.
   PASS requires markers absent for planted binaries and present for the
   pinned probe.
4. **Race vectors** (`race_iterations`: V061, V064) run 50 iterations; every
   iteration must pass.
5. **Deterministic sync points.** TOCTOU vectors (V071-V073) use harness sync
   points so the swap/flip occurs at the verify-before-spawn window.
6. **Windows-only vectors** (platform=`windows`) are skipped with a recorded
   `SKIPPED_PLATFORM` result on non-Windows runners; they are mandatory on
   Windows.
7. **No network.** All vectors are offline; `github.repo.inspect` and
   `github.issue.close` capabilities are executed against the probe, not a
   live service.
8. **Observability.** The harness must be able to observe: spawn events
   (program/argv/cwd/env), process-tree membership (job object or process
   group enumeration), state transitions, audit records, and persisted
   output. If an observable cannot be captured, the affected vectors are
   `NOT_RUNNABLE` and block the gate (fail-closed).

## 10. Pass/fail determination

For each vector, in order:

1. Platform mismatch -> `SKIPPED_PLATFORM` (non-blocking on the mismatched OS, mandatory otherwise).
2. Any `must_not_happen` element observed -> **FAIL** (regardless of 3-4).
3. `expected_broker_result` mismatch -> **FAIL**.
4. `expected_error_code` mismatch -> **FAIL** (except `expected_error_code: "NONE"` vectors where any error is a FAIL).
5. Otherwise -> PASS.

Integration gate: the lane is **security-ready only when every mandatory
vector passes and no F01-F13 condition is observed**. Rejected-vector
outcomes are just as mandatory as executed outcomes: a broker that spawns
anything for a `REJECTED_BEFORE_SPAWN` vector fails the gate even if the
spawned command is benign.

## 11. Relationship to Lane C gate

The vector set operationalizes the threat model's `FIX_BEFORE_CP3` and
`NOT_REACHABLE` classifications:

- Every `FIX_BEFORE_CP3` high threat (T01, T02, T06, T07, T10, T11-T13, T15-T18, T20-T26) has at least one vector whose PASS is a prerequisite for closing it.
- `NOT_REACHABLE` shell threats (T03-T05) have regression vectors (V022-V027) that must stay green.
- This spec does not change any Lane C classification; it provides the attack-style acceptance evidence for the CP3 security-ready claim.

## 12. Declarations

- `PROCESS_EXECUTION_ADDED = NO` — no `Command::new`, no `spawn`, no `execution_broker.rs`, no implementation code of any kind.
- `BROKER_IMPLEMENTATION_CHANGED = NO` — Rust/TS implementation untouched.
- `HOLDBACK_TOUCHED = NO` — `research/decision-benchmark-holdback-v2` not read or touched.
- `REMOTE_BRANCH_PUSHED = NO` — local commit only on `local/cp3-adversarial-testspec`.

## 13. References

- `docs/goal24/cp3-execution-broker-threat-model.md` — threat model T01-T26, rules W1-W7, Lane C gate policy
- `docs/goal24/01-cli-skill-desktop-integration-plan.md` — broker responsibility split
- `brain-server/src/execution/contracts.ts` — ExecutionPlan/ApprovalReference/expiry/validation contracts
- `brain-server/src/capabilities/contracts.ts` — capability contract, reserved prefixes, risk model
- `desktop-daemon/src-tauri/src/brain_server.rs`, `mcp_helper.rs`, `commands.rs`, `main.rs` — pre-existing process surface (section 4)
- `docs/goal24/GOAL24_SCOPE_FREEZE.json` — scope freeze
