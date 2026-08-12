# Goal24 Checkpoint 3 - Local Execution Broker Threat Model

Status: **DESIGN ONLY** - no runtime implementation (Checkpoint 3 design gate, Lane C).

Date: 2026-08-12

This document is a design-time threat model for the future Tauri **Local
Execution Broker** (Goal24 required layer: "desktop Tauri acting as a
restricted local execution broker"). It contains **no runtime
implementation**: no code, no `Command::new`, no `spawn`, and no
process-execution implementation of any kind. It defines the security
contract the future broker implementation must satisfy at Checkpoint 3
(Lane C: the design gate that must pass before process-execution code is
written).

Related artifacts (contract authority):

- docs/goal24/GOAL24_SCOPE_FREEZE.json
- docs/goal24/04-checkpoint2-contract-design.md
- docs/goal24/05-checkpoint2-1-contract-hardening.md
- brain-server/src/capabilities/contracts.ts
- brain-server/src/execution/contracts.ts

The `research/decision-benchmark-holdback-v2` directory is out of scope and
untouched by this checkpoint, consistent with the scope freeze.

---

## 1. Required security principle (read first)

> **The future Tauri Broker executes an approved semantic ExecutionPlan -
> NOT an arbitrary command.**

Future flow (mandatory, in this order):

1. **Capability ID** - the semantic action, `provider.resource.action` (3-5 lowercase dot-separated segments, never
  starting with a reserved transport prefix: `cli`, `mcp`, `api`, `http`, `transport`, `shell`, `exec`, `cmd`).
2. **Adapter binding** - `adapter_id` (implementation identity, e.g. `github-cli`) strictly separate from `capability_id`; the
  adapter is the only component allowed to translate capability + inputs into argv.
3. **Normalized inputs** - JSON-safe semantic parameters (`normalized_inputs`, `JsonObjectSchema`); never program names, never
  command strings.
4. **Approved ExecutionPlan** - a plan in an executable state (`ready`/`executing`), carrying `approval` (`ApprovalReference`) when
  `required_approval=true`, a frozen `risk_snapshot`, bounded `timeout_ms` (100..86400000), optional `expires_at`, and a `verification_plan` for every write plan.
5. **Validated argv** - built by the adapter from `capability_id` + `normalized_inputs` only, passed as argv (never as a
  command-line string).
6. **Restricted executable** - a concrete, allowlisted, resolved binary (future GitHub CLI:
  explicit `gh.exe` resolution), spawned with a restricted cwd, scrubbed environment, bounded
  output, and enforced timeout + process-tree kill.

Explicitly forbidden, in every layer of the future broker:

- LLM shell strings of any kind.
- `cmd /C <model output>`
- `powershell -Command <model output>`
- `sh -c <model output>`

The ExecutionPlan contract carries no machine-executable shell field:
`FORBIDDEN_INPUT_KEYS` (`shell`, `command`, `exec`, `bash`, `powershell`,
`cmd`, `cmdline`, `script`) are rejected at the top level of
`normalized_inputs`, and the strict Zod schemas reject unknown keys at
runtime. Semantic text that merely mentions commands (e.g., an issue body
saying "the command failed on Windows") is valid string data and is never
interpreted as an executable process specification.

The broker must call `isExecutionPlanExpired(plan, now)` before spawning
any process, must never execute a plan outside `EXECUTABLE_PLAN_STATES`
(`ready`, `executing`), and must never select, resolve, or construct
executables from plan inputs.

---

## 2. Purpose and scope

- **Purpose.** Enumerate the threats that the Checkpoint 3 broker design must address, bind each
  threat to concrete design controls (referencing contract fields where applicable), and
  classify each finding under the Lane C gate policy so the CP3 "security-ready" claim is
  machine-arguable.
- **Scope.** Broker-side execution of approved `ExecutionPlan`s, adapter argv construction, executable
  resolution, process lifecycle (spawn, timeout, cancel, tree kill), output handling, and the
  brain-server <-> broker handoff. Windows is the primary target; macOS / Linux notes are
  included where the design differs.
- **Out of scope.** Approval Engine runtime and token cryptography (Checkpoint 7),
  Skill/Capability Registry runtimes (Checkpoint 5), Evidence Surface Guard runtime (Checkpoint
  6), GitHub adapter implementation (Checkpoint 4), benchmark/holdback data, and the
  pre-existing baseline spawning in `desktop-daemon/src-tauri/src/brain_server.rs` (treated in section 7 as pre-existing surface, not
  broker design).

---

## 3. Trust boundaries, actors, and data flows

### 3.1 Actors

| Actor | Role | Trust posture |
|---|---|---|
| LLM / Codex client | Remote model/agent that converses with brain-server and requests semantic actions | Untrusted for execution decisions; may be prompt-injected; never trusted with raw process control |
| brain-server | Decision-control layer: evidence qualification, evidence coverage, Decision Kernel, approval policy, ExecutionPlan creation | Partially trusted local process; its compromise must not directly imply arbitrary process execution (broker re-validates) |
| Tauri broker | Restricted local execution broker inside the desktop-daemon | Most-trusted local component for execution; owns every spawn-side control |
| Adapter | Registered translator from `capability_id` + `normalized_inputs` to argv (e.g., `github-cli`) | Trusted only within its registered scope; never dynamically loaded from plan inputs |
| Local OS | Process creation, filesystem, credentials, network | Trusted for mechanism; hostile filesystem contents (repos, PATH entries, symlinks, junctions) are attack surface |
| User | Approves plans, owns the machine | Highest-priority authority; a user-equivalent attacker is out of scope (defense-in-depth may still apply) |

### 3.2 Trust boundaries

| ID | Boundary | Description | Direction |
|---|---|---|---|
| TB1 | LLM/Codex client <-> brain-server | Network ingress of semantic intent; must never carry executable strings | remote -> local |
| TB2 | brain-server <-> Tauri broker | IPC handoff of the ExecutionPlan JSON; approval references travel, raw tokens never travel | local loopback |
| TB3 | broker <-> adapter | Capability binding and argv construction; the only place argv is built | in-process |
| TB4 | adapter <-> OS process | Spawn boundary: executable resolution, argv, cwd, env, stdio, process tree, timeout | process boundary |
| TB5 | local OS <-> user | Filesystem, keyring, credentials, network egress; user-owned resources | host-local |

### 3.3 Data flows

1. **Intent (TB1).** The user and the LLM/Codex client exchange semantic intent with
  brain-server. No shell text enters the execution path; the capability layer expresses only
  `provider.resource.action` semantics.
2. **Decision (brain-server).** Evidence qualification -> evidence coverage assessment (`assessEvidenceCoverage`) ->
  Decision Kernel -> approval policy -> an `ExecutionPlan` is produced in `draft` or `awaiting_approval` state with a frozen
  `risk_snapshot` and `evidence_coverage_snapshot`.
3. **Approval (brain-server/user).** For `required_approval=true`, the user grants approval; an `ApprovalReference` (`approval_id`, `plan_id`, `granted_by`,
  `granted_at`, `policy_version`, `token_reference`, `token_digest`) is attached and the plan transitions to `ready`.
4. **Handoff (TB2).** brain-server sends the approved plan to the Tauri broker over local IPC.
  Only JSON-safe values travel; the raw approval token never travels on the wire.
5. **Broker gate (TB2->TB3).** The broker parses the plan with the strict schema, verifies `state`
  is in `EXECUTABLE_PLAN_STATES`, calls `isExecutionPlanExpired(plan, now)`, checks `approval.plan_id == plan.plan_id`, and runs `validateExecutionPlanAgainstCapabilities(plan, lookup)` (capability existence, version chain `risk_snapshot.capability_version == plan.capability_version == capability.version`,
  risk-snapshot equality, verification/rollback binding, mandatory evidence coverage).
6. **Adapter binding (TB3).** `adapter_id` resolves to a registered adapter; the adapter builds argv from
  `capability_id` + `normalized_inputs` only (no shell, no command strings).
7. **Spawn (TB4).** The broker resolves the allowlisted executable to a concrete path,
  canonicalizes and allowlists cwd, scrubs the environment, and spawns the process with the
  validated argv under a job object / process group.
8. **Run (TB4).** A watchdog enforces `timeout_ms`; output is streamed through bounded, redacting pipes;
  cancellation and timeout terminate the whole process tree.
9. **Outcome (TB4->TB2->brain-server).** Exit status, bounded output, and resolved-executable
  audit fields are recorded against `plan_id` / `correlation_id`; write plans run their declared `verification_plan` (read-back)
  and, if `risk_snapshot.reversible=true`, may use `rollback_plan`; outcomes feed evidence and the revisit loop.
---

## 4. Threat model summary

Risk rating scale used throughout:

- **Severity** - High: direct security impact if realized (arbitrary execution, credential
  exposure, unintended state change, broker unavailability). Medium: limited or indirect impact.
  Low: minor.
- **Likelihood** - how plausible realization is under the designed controls (not attacker
  skill).

| ID | Threat | Severity | Likelihood | Boundary | Lane C |
|---|---|---|---|---|---|
| T01 | Arbitrary executable selection | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T02 | argv injection | High | Medium | TB3/TB4 | FIX_BEFORE_CP3 |
| T03 | Shell invocation | High | Low | TB4 | NOT_REACHABLE |
| T04 | `cmd /C` | High | Low | TB4 | NOT_REACHABLE |
| T05 | PowerShell `-Command` | High | Low | TB4 | NOT_REACHABLE |
| T06 | `.cmd`/`.bat` implicit shell behavior | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T07 | cwd escape | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T08 | Symlink / path tricks | Medium | Medium | TB4 | FIX_BEFORE_CP3 |
| T09 | Environment leakage | Medium | Medium | TB4/TB5 | FIX_BEFORE_CP3 |
| T10 | Inherited credentials | High | Medium | TB4/TB5 | FIX_BEFORE_CP3 |
| T11 | PATH hijacking | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T12 | Malicious local executable named `gh` | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T13 | Executable replacement / TOCTOU | High | Low | TB4 | FIX_BEFORE_CP3 |
| T14 | Executable version drift | Medium | Low | TB3/TB4 | ACCEPTED_TEMPORARY_RISK |
| T15 | Adapter/capability mismatch | High | Low | TB2/TB3 | FIX_BEFORE_CP3 |
| T16 | Stale ExecutionPlan | High | Medium | TB2/TB3 | FIX_BEFORE_CP3 |
| T17 | Expired ExecutionPlan | High | Low | TB2/TB3 | FIX_BEFORE_CP3 |
| T18 | Approval replay | High | Medium | TB2/TB3 | FIX_BEFORE_CP3 |
| T19 | Output flooding | Medium | Medium | TB4/TB2 | FIX_BEFORE_CP3 |
| T20 | stdout/stderr secret leakage | High | Medium | TB4/TB2/TB5 | FIX_BEFORE_CP3 |
| T21 | Timeout | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T22 | Cancellation | Medium | Medium | TB4 | FIX_BEFORE_CP3 |
| T23 | Orphan processes | High | Medium | TB4/TB5 | FIX_BEFORE_CP3 |
| T24 | Child process tree termination | High | Medium | TB4 | FIX_BEFORE_CP3 |
| T25 | Huge output / memory pressure | High | Medium | TB4/broker | FIX_BEFORE_CP3 |
| T26 | Executable discovery ambiguity | High | Low | TB4 | FIX_BEFORE_CP3 |

Lane C policy labels are defined in section 8; any BLOCKS_CP3 or UNKNOWN
finding blocks the CP3 security-ready claim.

---

## 5. Threat register (T01-T26)

Each entry: description, attack scenario, affected trust boundary, design
mitigations/controls (referencing contract fields where applicable),
residual risk, and severity + likelihood rating with Lane C
classification.

### T01 - Arbitrary executable selection
- **Description.** The broker or an adapter chooses an executable that is not bound to the
  approved capability/adapter pair - e.g., any tool found on PATH, a path supplied in plan
  inputs, or a binary picked from the user's shell history.
- **Attack scenario.** A prompt-injected LLM/Codex client (TB1) or a tampered plan convinces an
  adapter to treat an input value (repo path, tool name) as the program to run; the broker
  spawns an attacker-planted binary instead of the capability's registered executable.
- **Trust boundary.** TB4 (spawn boundary).
- **Design mitigations.** Executable selection is adapter-registry-only: each registered `adapter_id`
  declares a fixed set of allowed program paths (e.g., `github-cli` -> allowlisted `gh.exe`). The
  ExecutionPlan schema has no executable field (strict Zod, unknown keys rejected), and `FORBIDDEN_INPUT_KEYS`
  blocks `command`/`exec`/`shell`-style keys in `normalized_inputs`. The broker rejects any argv[0] that is not the adapter's
  registered resolved executable. `input_schema` constrains what values `normalized_inputs` may carry.
- **Residual risk.** Registry tampering would re-enable this threat; for CP3 the adapter
  registry is code-shipped with the broker (built-in adapters only, no dynamic registration from
  plans).
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (executable
  binding must exist before any spawn; no dynamic program selection in CP3).

### T02 - argv injection
- **Description.** Attacker-controlled input reaches argv in a way that changes program
  behavior: option injection (values starting with `-`), extra positional arguments, or smuggled
  multi-value payloads (newlines, NULs, list separators).
- **Attack scenario.** An issue title such as `--force` or a repo value crafted as `--template owner/repo` is concatenated
  into argv without shape validation; `gh` interprets it as a flag or additional argument and
  performs a different action than the approved capability (`github.issue.create` vs. something more dangerous).
- **Trust boundary.** TB3/TB4 (argv construction and spawn).
- **Design mitigations.** argv is built only from `capability_id` + `normalized_inputs` by adapter-owned argv builders; `input_schema`
  constrains types/patterns (no free-form top-level values where gh takes flags); values are
  passed via argv APIs (`Command::arg`), never parsed as a command line; adapters validate leading-dash
  values for value positions and use the `--` terminator where the target CLI supports it; values
  must be JSON-safe (`JsonObjectSchema`), which excludes non-string/non-finite smuggling.
- **Residual risk.** Option-injection semantics depend on the target CLI's flag grammar;
  per-capability input review and negative tests are required, and `capability_version` must pin behavior.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (schema-driven
  normalization + negative argv tests).

### T03 - Shell invocation
- **Description.** Execution is routed through a shell (`sh -c`, `bash -c`, or any shell-string execution)
  so that metacharacters reinterpret the payload.
- **Attack scenario.** Model output or plan input is embedded into a shell string; `|`, `;`,
  `&&`, backticks, or `$()` cause additional commands to run with the user's privileges.
- **Trust boundary.** TB4.
- **Design mitigations.** Forbidden by construction: the contract carries no machine-executable
  shell field (`FORBIDDEN_INPUT_KEYS` rejects `shell`, `bash`, `script`, ...), capability IDs cannot start with `shell`/`exec`/`cmd`
  (`RESERVED_TRANSPORT_PREFIXES`), and the broker's spawn primitive accepts program + argv only. Contract tests pin the
  reserved-key rejection.
- **Residual risk.** Regression risk only (a future helper that builds shell strings); kept at
  zero in design review, with contract tests and a broker code-review checklist as guards.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **NOT_REACHABLE** by contract
  construction; guard tests are mandatory before CP3 closes.

### T04 - `cmd /C`
- **Description.** The broker or adapter invokes `cmd.exe` with `/C` and a concatenated string (`cmd /C <model output>`),
  granting cmd semantics: metacharacters, `%VAR%` expansion, batch behavior.
- **Attack scenario.** An adapter constructs `cmd /C <string>` from normalized inputs or model output; `&` or
  `|` in the string executes additional commands.
- **Trust boundary.** TB4.
- **Design mitigations.** The pattern is explicitly forbidden by the required security
  principle; the broker's program allowlist contains no shell executables (`cmd.exe`, `powershell.exe`, `pwsh.exe`, `sh`,
  `bash`) for plan execution; `FORBIDDEN_INPUT_KEYS` includes `cmd`; capability IDs cannot start with `cmd`.
- **Residual risk.** Only pre-existing baseline code paths (section 7) use `cmd`-adjacent
  launching; the broker must not reuse those paths.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **NOT_REACHABLE** (contract +
  spawn-boundary rule).

### T05 - PowerShell `-Command`
- **Description.** Execution through `powershell -Command <model output>` (or `-EncodedCommand`), turning model-derived text into PowerShell
  code.
- **Attack scenario.** Model output is passed to `powershell -Command`; PowerShell language features (invocation,
  .NET calls, COM, network) execute with user privileges.
- **Trust boundary.** TB4.
- **Design mitigations.** Explicitly forbidden pattern; PowerShell is not in the adapter program
  allowlist; the broker rejects `-Command`, `-EncodedCommand`, and `-File` forms at the spawn boundary for any adapter
  that might legitimately use PowerShell (none in CP3); no shell field exists in the plan
  contract.
- **Residual risk.** Same regression-only exposure as T03/T04.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **NOT_REACHABLE** (contract +
  allowlist).

### T06 - `.cmd`/`.bat` implicit shell behavior
- **Description.** Even without an explicit `cmd` invocation, launching a `.cmd`/`.bat` file (directly
  or via shell association) executes script content through `cmd.exe` semantics.
- **Attack scenario.** Executable resolution returns `gh.cmd` (an npm-style shim) or an
  attacker-planted `.bat`; the script body runs arbitrary commands with the inherited environment.
- **Trust boundary.** TB4.
- **Design mitigations.** Windows design rule (section 6): never accept `.bat`/`.cmd` as a default
  executable; the spawn boundary enforces an extension allowlist (`.exe` only for CP3, e.g., `gh.exe`);
  resolution fails closed when a path resolves to a script file (no fallback to shell
  association); the adapter registry is extension-checked at load.
- **Residual risk.** A malicious `.exe` is not stopped by this rule - layered with T12/T13
  controls.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (extension
  allowlist + Windows resolution tests).

### T07 - cwd escape
- **Description.** The child process runs with a working directory outside the intended
  allowlist, so relative paths, git operations, and hook-bearing repos resolve against
  unintended targets.
- **Attack scenario.** A plan input carries a repo path; the adapter uses it as `current_dir` without
  validation; `gh`/git operate on a user-profile directory or an untrusted repo containing
  malicious git hooks or a hostile `.git` config.
- **Trust boundary.** TB4.
- **Design mitigations.** cwd must pass an allowlist (per-adapter permitted roots: registered
  workspace roots and repo roots present in the plan) plus canonicalization (symlinks,
  junctions, 8.3 short names, case, `..`); cwd must exist and be a directory; cwd derived from
  free-form input is rejected; the canonical cwd is recorded in the execution audit record.
  Git-hook execution inside approved repos remains an explicitly reviewed residual (hooks run
  with user privileges by design of git).
- **Residual risk.** Untrusted-repo hooks: mitigated for CP3 by restricting approved repo roots
  and reviewing hook behavior per adapter; full hook sandboxing is out of scope.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (allowlist +
  canonicalization before any spawn).

### T08 - Symlink / path tricks
- **Description.** Symlinks, junctions, reparse points, short names, or `..` segments redirect a
  "known" path to an unexpected target.
- **Attack scenario.** An allowlisted repo directory contains a junction to the user profile; an
  executable's directory contains a symlink to an attacker binary; an input path uses `..\..\` to
  escape the workspace.
- **Trust boundary.** TB4.
- **Design mitigations.** All path inputs canonicalized (junction/symlink expansion) before
  allowlist comparison; `..` segments rejected when the canonical result leaves the allowlist;
  resolved executable path canonicalized and compared to the registered allowlist entry;
  point-in-time nature of canonicalization is explicitly tied to T13's TOCTOU control (re-verify
  immediately before spawn).
- **Residual risk.** TOCTOU on symlink swap between canonicalize and spawn - shared with T13;
  accepted only with the T13 re-check.
- **Rating / Lane C.** Severity: Medium * Likelihood: Medium - **FIX_BEFORE_CP3**
  (canonicalization + pre-spawn re-verification).

### T09 - Environment leakage
- **Description.** The child inherits more of the host environment than needed - tokens,
  secrets, or sensitive configuration - and may leak it through output, subprocesses, or logs.
- **Attack scenario.** The broker spawns `gh` with the full desktop environment; a secret in an
  env var is visible to `gh`, to its children (pagers, git, hooks), or is echoed into captured
  output and persisted to logs.
- **Trust boundary.** TB4/TB5.
- **Design mitigations.** Scrub the environment: build a minimal per-adapter allowlist of safe
  variables plus adapter-required variables; never inherit wholesale; raw tokens are not placed
  in env - approval material travels as `token_reference`/`token_digest` (no raw token on the wire); the environment
  policy is part of adapter registration; redaction applies to logs/output (T20).
- **Residual risk.** Allowlist review per adapter is manual; secrets present in the local user's
  environment that the adapter legitimately needs (e.g., keyring-backed `gh` auth) remain
  accessible to the spawned process - see T10.
- **Rating / Lane C.** Severity: Medium * Likelihood: Medium - **FIX_BEFORE_CP3** (env allowlist
  + per-adapter env policy).
### T10 - Inherited credentials
- **Description.** The spawned process (and its children) can access credentials stored for the
  local user - `gh` auth config, keyring, credential managers, SSH keys - and use them beyond the
  approved action.
- **Attack scenario.** An approved read plan is turned (via argv confusion T02, a malicious repo
  hook, or adapter bug) into `gh auth token`, `gh api` calls against other scopes, or pushes to other
  repositories; credential material is exfiltrated through output or logs.
- **Trust boundary.** TB4/TB5.
- **Design mitigations.** Least-privilege tokens: read capabilities get read-only-scope tokens;
  elevated use requires a new approved plan (`required_approval=true` + `ApprovalReference`); environment scrubbing (T09) prevents
  passing raw tokens; output redaction (T20) protects accidental disclosure; the audit trail
  records `plan_id`, `approval_id`, and `correlation_id` for every process; no CP3 adapter capability may print auth material
  (enforced by adapter tests); secrets never enter logs.
- **Residual risk.** A compromised broker/adapter process can use whatever credentials the local
  user has (e.g., default `gh` auth). Full per-capability credential isolation (separate `gh`
  config/scoped token per capability) is a documented follow-up; scope minimization + approval
  gating narrow the exposure for CP3.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (scope
  minimization, redaction, audit); full isolation residual is **ACCEPTED_TEMPORARY_RISK** with
  owner follow-up.

### T11 - PATH hijacking
- **Description.** Launching by bare name (`Command::new("gh")`) resolves through PATH; a user-writable PATH
  entry earlier than the intended install shadows the real binary.
- **Attack scenario.** A download directory or `node_modules/.bin` sits early in PATH with a planted `gh.exe`; the
  broker resolves it and runs attacker code.
- **Trust boundary.** TB4.
- **Design mitigations.** The broker never launches by bare name; the adapter registry stores
  absolute resolved paths (e.g., `C:\Program Files\GitHub CLI\gh.exe`); resolution happens once at registration/load time, and
  after any PATH lookup the resolved executable is recorded (Windows design rule W4) and
  compared canonically to the allowlist entry before spawn; mismatch -> block.
- **Residual risk.** Registry tampering or filesystem swap after verification (T13); both are
  separately controlled.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3**
  (absolute-path-only spawn).

### T12 - Malicious local executable named `gh`
- **Description.** A directory earlier in PATH, or the cwd itself, contains an attacker-planted
  `gh`/`gh.exe`/`gh.cmd` that intercepts intended GitHub CLI invocations.
- **Attack scenario.** The user opens an untrusted repo containing `gh.exe` (or a junction to one);
  the adapter resolves it instead of the installed GitHub CLI; the planted binary reads
  stdin/env, exfiltrates data, or runs arbitrary commands.
- **Trust boundary.** TB4.
- **Design mitigations.** Explicit `gh.exe` resolution (Windows design rule W3): never resolve by
  name, never search cwd, and exclude user-writable/unknown directories from resolution; the
  registry pins the absolute install path from a trusted install manifest; resolved path is
  canonicalized and hash/signature-verified (T13); extension allowlist excludes `.cmd`/`.bat` shims
  (T06).
- **Residual risk.** If the pinned install directory itself is user-writable, a user-equivalent
  attacker controls it - out of scope (user is a trusted actor); defense-in-depth keeps install
  dirs non-user-writable where possible.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (pinned absolute
  resolution + verification).

### T13 - Executable replacement / TOCTOU
- **Description.** Between resolution/verification and spawn, the file at the resolved path is
  replaced (or a symlink/junction is swapped), so the executed binary differs from the verified
  one.
- **Attack scenario.** A concurrent process (installer, npm, malicious download) replaces `gh.exe`
  after the hash check but before `CreateProcess`; or a junction is flipped between canonicalize and spawn.
- **Trust boundary.** TB4.
- **Design mitigations.** Windows design rule W5: resolve -> verify (hash/signature) -> execute
  with the smallest possible gap; open the file with restricted share mode (deny `FILE_SHARE_DELETE`/`WRITE` where
  the runtime allows) and re-stat (device, file index, hash) immediately before spawn; record
  the resolved executable path + hash in the execution audit record; prefer install directories
  not writable by non-admins. Rust `std` cannot execute by open handle, so CP3 uses
  open-with-restricted-share + immediate re-check + post-spawn re-stat; handle-based execution
  is a documented follow-up.
- **Residual risk.** A small TOCTOU window remains (milliseconds between re-check and process
  creation); accepted for CP3 only because the re-check + trusted-dir combination is in place.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **FIX_BEFORE_CP3** (mandatory
  pre-spawn re-verification); handle-based execution is a follow-up.

### T14 - Executable version drift
- **Description.** The installed binary's version changes (auto-update, manual install) while
  plans and adapters assume the version they were tested against; flags, output formats, and
  defaults shift.
- **Attack scenario.** `gh` auto-updates to a version whose `--json` output or flag semantics changed;
  the adapter's argv assumptions break, producing a different outcome than the approved plan, or
  verification read-back silently misreads.
- **Trust boundary.** TB3/TB4.
- **Design mitigations.** The adapter records the detected executable version (`gh --version`) at
  registration and per execution; the capability version chain (`risk_snapshot.capability_version == plan.capability_version == capability.version`) pins the semantic contract,
  while binary version is a separate adapter concern (documented in the contracts); each adapter
  declares a supported binary version range; mismatch -> `state=blocked`, no spawn; version is recorded in
  the execution audit record.
- **Residual risk.** Version detection itself runs the binary (benign `--version`); range policy
  requires per-adapter review and maintenance.
- **Rating / Lane C.** Severity: Medium * Likelihood: Low - **ACCEPTED_TEMPORARY_RISK** (with
  mandatory version recording and block-on-mismatch rule).

### T15 - Adapter/capability mismatch
- **Description.** The plan's `adapter_id` is bound to an adapter that does not actually implement the
  plan's `capability_id` (or implements it with different semantics), executing a different action than the
  one approved.
- **Attack scenario.** A bug or tampered binding maps `github.issue.create` to an adapter that interprets inputs
  differently (e.g., performing a destructive operation); or a plan references a capability the
  adapter does not support at all and the broker executes anyway.
- **Trust boundary.** TB2/TB3.
- **Design mitigations.** The broker runs `validateExecutionPlanAgainstCapabilities(plan, lookup)` before execution: capability existence, version
  chain, risk-snapshot equality, verification/rollback binding, mandatory evidence coverage for
  executable states. Adapter registration declares the exact set of supported `capability_id`s; the broker
  rejects any plan whose `adapter_id` does not declare the plan's capability. `adapter_id` (`ADAPTER_ID_PATTERN`) is strictly
  separate from `capability_id` (`provider.resource.action`), so identity confusion is structurally prevented.
- **Residual risk.** Registry integrity is an assumption (code-shipped registry in CP3);
  per-adapter mapping contract tests are required.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **FIX_BEFORE_CP3** (broker-side
  validation + adapter capability declarations).

### T16 - Stale ExecutionPlan
- **Description.** A plan created long ago and still in `ready` state is executed later, when the
  context/evidence it was based on no longer holds.
- **Attack scenario.** A plan approved for a pre-push state executes days later from a queue
  after a force-push or repo transfer; the `evidence_coverage_snapshot` no longer reflects reality, so the action targets
  the wrong state.
- **Trust boundary.** TB2/TB3.
- **Design mitigations.** Execution eligibility requires `state` is in `EXECUTABLE_PLAN_STATES` and an `approval` reference when
  `required_approval=true` (`APPROVAL_REQUIRED_STATES`); plans are single-use: the `ready -> executing` transition is consumed atomically and no plan
  executes twice; broker policy gives plans without `expires_at` a default TTL from `created_at`; re-validation
  against the registry happens at execution time; evidence freshness is capability-defined via
  `freshness_policy` and assessed through `evidence_coverage_snapshot` / `assessEvidenceCoverage`.
- **Residual risk.** The default-TTL policy is broker-side (not yet a contract field) - must be
  specified in the CP3 spec; live evidence re-check is a Checkpoint 6 concern.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (single-use
  consumption + default TTL).

### T17 - Expired ExecutionPlan
- **Description.** A plan past its `expires_at` is executed because the broker omits the expiry check;
  the approval is stale but still honored.
- **Attack scenario.** The user approves, delays, and the plan expires; a queued execution runs
  anyway; or clock skew between brain-server and broker defeats the check.
- **Trust boundary.** TB2/TB3.
- **Design mitigations.** The broker MUST call `isExecutionPlanExpired(plan, now)` before spawning any process (the contract's
  deterministic helper; `now` injected for testability); the schema already requires `expires_at` after
  `created_at`; an expired plan transitions to `cancelled`/`blocked` with an audit reason; the expiry gate is a single
  function used by every adapter (no bypass paths); expiry uses the broker's wall clock (same
  machine as brain-server, so skew is negligible).
- **Residual risk.** Local clock manipulation by the user is out of scope (user is trusted);
  process-local skew is not meaningful over IPC.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **FIX_BEFORE_CP3** (mandatory gate
  call + unit tests).

### T18 - Approval replay
- **Description.** The same approval is used to execute multiple plans, the same plan multiple
  times, or an approval for plan A is replayed for plan B (e.g., a read approval reused for a
  write).
- **Attack scenario.** A buggy queue or tampered IPC replays a `ready` plan JSON with its `approval`
  reference; the broker accepts the reference again; or an approved read plan is re-submitted
  with a write capability id.
- **Trust boundary.** TB2/TB3.
- **Design mitigations.** Binding: `approval.plan_id` must equal `plan.plan_id` (schema-enforced); single-use: plan state
  `ready -> executing -> succeeded/failed` is one-way and consumed once; the broker keeps a persistent seen-set of consumed
  `approval_id`s/`plan_id`s; scope binding: the approval captures `granted_at`, `policy_version`, and is tied to the plan's `capability_id`/`risk_snapshot` -
  a replayed plan with a different capability fails registry validation. Real token verification
  (`token_digest`) is a Checkpoint 7 concern; until then CP3 treats the reference as an auditable record
  and enforces single-use + seen-set.
- **Residual risk.** Until CP7 cryptography lands, replay resistance depends on broker state
  integrity (single-use + seen-set); the remaining gap is **ACCEPTED_TEMPORARY_RISK** with CP7
  as the closing checkpoint.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (single-use
  consumption + seen-set); CP7 closes the cryptographic gap.
### T19 - Output flooding
- **Description.** The child writes unbounded stdout/stderr; the IPC channel, UI, or log files
  fill up, stalling the broker or ballooning disk usage.
- **Attack scenario.** `gh api` returns a very large JSON dump; a misbehaving adapter logs
  continuously; the broker blocks on a full pipe while the process waits, deadlocking the
  execution.
- **Trust boundary.** TB4 -> TB2 (output channel).
- **Design mitigations.** Bounded pipes with per-execution byte and line caps; streaming readers
  with backpressure so the broker main loop never blocks; on cap -> truncate with an explicit
  marker and terminate if a hard cap is exceeded; logs are sized/rotated (the desktop-daemon
  already has a `log_writer` pattern); output is stored keyed by `plan_id` / `correlation_id` for audit.
- **Residual risk.** Truncated output may hide tail data; verification plans should therefore
  use targeted reads (e.g., `gh` queries with filters) rather than whole-stream dumps.
- **Rating / Lane C.** Severity: Medium * Likelihood: Medium - **FIX_BEFORE_CP3** (bounded
  streaming output).

### T20 - stdout/stderr secret leakage
- **Description.** Captured output or logs contain tokens, auth material, or private data (`gh auth token`,
  verbose API responses, secrets in URLs), leaking them into UI, logs, or support bundles.
- **Attack scenario.** A capability's stderr echoes a token; a support bundle ships logs
  containing `Authorization: Bearer ...`; verification output is persisted with secrets.
- **Trust boundary.** TB4/TB2/TB5.
- **Design mitigations.** A redaction pipeline scrubs known secret patterns (bearer tokens,
  `GITHUB_TOKEN`-style values, `token_digest`- shaped placeholders) before display/persistence; the adapter contract
  forbids capabilities from printing auth material (enforced by adapter tests); child output is
  treated as sensitive by default; approval records never contain raw tokens (`ApprovalReference` carries only
  `token_reference`/`token_digest`); logs are user-scoped and keyed by `correlation_id`.
- **Residual risk.** Unknown secret formats evade redaction lists; per-capability redaction
  review is required and monitored.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (redaction
  pipeline + no-auth-output adapter rule).

### T21 - Timeout
- **Description.** The child runs longer than `timeout_ms`; without a watchdog the plan hangs
  indefinitely, side effects continue, and resources are held.
- **Attack scenario.** `gh api` waits on a stalled network; an interactive prompt blocks forever; a
  plan mistakenly uses the 24 h maximum (`timeout_ms` bound is 100..86400000) for a quick read.
- **Trust boundary.** TB4.
- **Design mitigations.** `timeout_ms` is schema-bounded; the broker runs a per-execution watchdog on a
  monotonic clock; on timeout -> terminate the whole process tree (T24), set `state=failed` with
  reason=`timeout`, and record the audit entry; no child may extend the deadline without a new plan;
  timeout choice is part of the capability definition (reads short, writes bounded by the
  verification window).
- **Residual risk.** Kill failure (T24 residual); graceful vs. forced termination semantics must
  be defined per adapter.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (watchdog +
  mandatory tree kill).

### T22 - Cancellation
- **Description.** The user cancels a plan; the child keeps running, or the state machine marks
  `cancelled` while effects are still in flight, leaving inconsistent state and skipped verification.
- **Attack scenario.** The user cancels a `gh` push mid-flight; the broker marks the plan
  cancelled, but the push completes and `verification_plan` never runs; or the child keeps retrying after
  cancel.
- **Trust boundary.** TB4.
- **Design mitigations.** Two-phase cancel: request -> terminate process tree -> confirm
  termination -> then `state=cancelled`; if the process already exited, run `verification_plan` to record the actual outcome;
  cancellation does not bypass `rollback_plan` when `risk_snapshot.reversible=true`; audit trail records cancel reason and actor.
- **Residual risk.** Exactly-once semantics are impossible for external effects (`side_effect_class=external_effect`);
  verification/rollback narrow the gap but cannot eliminate it - documented.
- **Rating / Lane C.** Severity: Medium * Likelihood: Medium - **FIX_BEFORE_CP3** (two-phase
  cancel + post-cancel verification).

### T23 - Orphan processes
- **Description.** The broker/app crashes or is killed; spawned children (and their trees)
  continue running unmanaged, holding credentials and continuing side effects.
- **Attack scenario.** The Tauri app is killed during a long `gh` operation; the child keeps
  retrying uploads; zombies accumulate across restarts.
- **Trust boundary.** TB4/TB5.
- **Design mitigations.** Windows: every spawned process is assigned to a job object at creation
  with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so broker death kills the job. Non-Windows: process groups + parent-death signal
  where supported. The broker keeps an in-memory and persisted registry of spawned trees (`pid`,
  `plan_id`, job handle) for restart reconciliation: on restart, surviving trees are terminated or
  their plans marked `blocked` - never auto-resumed without a new approval.
- **Residual risk.** Hard OS death (power loss) leaves reaping to the OS; children survive only
  if the spawn path fails to create the job (enforced in the single spawn primitive).
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (job objects +
  restart reconciliation).

### T24 - Child process tree termination
- **Description.** Timeout/cancel kills only the direct child; children spawned by it (git, ssh,
  pagers, hooks) survive and continue side effects.
- **Attack scenario.** `gh push` spawns `git`, which spawns `ssh`; killing `gh` alone leaves `ssh` mid-write;
  or `gh` spawns a helper that holds a token.
- **Trust boundary.** TB4.
- **Design mitigations.** Windows: assign every spawned process to a job object at creation
  (suspend -> `AssignProcessToJobObject` -> resume) with `KILL_ON_JOB_CLOSE`; tree kill = `TerminateJobObject`; job restriction flags disable breakaway
  (`JOB_OBJECT_LIMIT_BREAKAWAY_OK` not set) so children cannot detach. Non-Windows: kill the process group (or cgroup where
  available); confirm tree exit (poll with timeout) before marking the plan terminated; adapters
  are contractually forbidden from daemonizing/detaching children.
- **Residual risk.** Processes created with explicit `CREATE_BREAKAWAY_FROM_JOB` cannot break away because the flag is
  disabled; residual low.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (job objects /
  process-tree kill required).

### T25 - Huge output / memory pressure
- **Description.** Capturing unbounded output into memory (`read_to_string`-style) exhausts broker/desktop
  memory, crashing the broker or unrelated UI components.
- **Attack scenario.** A `gh` command emits a multi-GB dump; the output capture accumulates in
  RAM; the Tauri main process is OOM-killed.
- **Trust boundary.** TB4 / broker process.
- **Design mitigations.** Never read-to-end into memory: streaming readers with hard byte caps
  (shared with T19); spill to a size-capped temp file above a threshold; capture runs off the
  main thread/async task so the broker loop stays responsive; caps are enforced in the same
  single output pipeline used by all adapters.
- **Residual risk.** OS-level memory pressure beyond broker control if the child allocates
  outside pipes; capped pipes bound the main exposure.
- **Rating / Lane C.** Severity: High * Likelihood: Medium - **FIX_BEFORE_CP3** (hard caps +
  streaming capture).

### T26 - Executable discovery ambiguity
- **Description.** Multiple candidates match executable resolution (several PATH entries, shims,
  versioned directories, both `gh` and `gh.exe`); silent pick-first resolves the wrong binary.
- **Attack scenario.** Two `gh.exe` copies exist (user install + admin install); `where gh` is ambiguous;
  resolution picks the first match, which is a shim or an outdated/planted binary.
- **Trust boundary.** TB4.
- **Design mitigations.** Resolution is explicit, not search-based: the adapter registry pins an
  absolute path; ambiguity is an error - the broker never silently picks a first match; after
  any PATH-based lookup (registration-time convenience only), the resolved executable is
  recorded (Windows design rule W4) and re-verified (extension, existence, canonical form,
  allowlist membership); expected vs. recorded mismatch -> block; a per-machine adapter health
  view surfaces the resolved binary to the user.
- **Residual risk.** A stale recorded path after reinstall is caught by version/reinstall
  detection (T14) and block-on-mismatch.
- **Rating / Lane C.** Severity: High * Likelihood: Low - **FIX_BEFORE_CP3** (explicit
  resolution + recorded resolved executable).
---

## 6. Windows-specific design rules (design only)

These rules are normative for the CP3 broker design on Windows. They are
design statements only - no implementation is performed by this document.
Each rule maps to the threats it closes.

| Rule | Requirement | Closes | Notes |
|---|---|---|---|
| W1 | Never accept `.bat`/`.cmd` as a default executable | T06, T12 | Extension allowlist (`.exe` only in CP3, e.g., `gh.exe`); resolution that yields a script path fails closed - no fallback, no shell-association launch |
| W2 | Never launch through shell association implicitly | T03, T04, T05, T06 | The broker spawns via a single program + argv primitive (`CreateProcess` semantics); it never uses `ShellExecute`-style association resolution or `cmd /c start` for plan execution |
| W3 | Executable path must resolve to a concrete trusted binary | T01, T11, T12, T26 | Future GitHub CLI: prefer explicit `gh.exe` resolution; the registry pins absolute install paths; bare names are never accepted at spawn time |
| W4 | After PATH lookup, record the resolved executable | T11, T13, T14, T26 | Resolution (registration-time convenience only) persists the resolved path, version, and hash; every spawn re-verifies against the recorded entry |
| W5 | Prevent binary replacement between resolution and execution | T13, T08 | Open with restricted share mode, re-stat/re-hash immediately before spawn, record file identity; handle-based execution documented as follow-up |
| W6 | cwd must pass allowlist + canonicalization | T07, T08 | Canonicalize (junctions, 8.3 names, case, `..`); compare against per-adapter allowed roots; cwd must exist and be a directory |
| W7 | Child process tree must be fully terminated after timeout | T21, T22, T23, T24 | Job objects at creation with `KILL_ON_JOB_CLOSE`; `TerminateJobObject` on timeout/cancel; breakaway disabled; confirm tree exit before state transition |

Cross-platform note: W3-W6 apply on macOS/Linux with the equivalent
canonicalization (`realpath`) and process-group/kill-tree mechanisms for
W7; `.bat`/`.cmd` and shell-association rules (W1/W2) are Windows-specific
but the spirit (no shell-mediated launch) applies everywhere.

---

## 7. Existing baseline note (pre-existing surface)

`desktop-daemon/src-tauri/src/brain_server.rs` already contains baseline
process spawning that **predates** the broker:

- Brain Server lifecycle: `Command::new(&node_exe)` with explicit args and `CREATE_NO_WINDOW` to launch `brain-server` and wait on `/health`.
- Termination helpers: `taskkill` (Windows) and `kill -9` (non-Windows) against a stored PID.
- Folder opening: `Command::new("explorer").arg(&path)`, `Command::new("open").arg(&path)`, and `Command::new("xdg-open").arg(&path)` for data/log folders.

This document treats that code as **pre-existing surface**, NOT the
approved broker design. Consequences for CP3:

- The broker must not reuse unvalidated command strings or copy those patterns; its spawn path
  is the new validated primitive described in sections 1, 5, and 6.
- Baseline paths remain outside the broker threat model's mitigations; they are recorded here so
  the boundary is explicit, and hardening them is tracked separately from the CP3 security-ready
  claim.
- The `explorer`/`open`/`xdg-open` calls open a directory with the user's default handler (shell-association-like
  behavior); that is acceptable for the pre-existing UI helper role but is exactly the behavior
  W2 forbids for plan execution.

---

## 8. Gate position - Lane C classification policy

Every threat in this document is classified under the Lane C policy. The
labels and their gate effect:

| Label | Meaning | Gate effect |
|---|---|---|
| BLOCKS_CP3 | Finding invalidates the broker design as specified; cannot proceed | **Blocks** the CP3 security-ready claim until resolved |
| FIX_BEFORE_CP3 | Required design control that must be implemented and tested within CP3 before any plan execution is enabled | Must be closed by CP3 completion |
| NOT_REACHABLE | Structurally eliminated by contract/design construction | No implementation work, but guard tests are still required |
| ACCEPTED_TEMPORARY_RISK | Accepted for CP3 with documented rationale, owner, and expiry (follow-up checkpoint) | Tracked, non-blocking |
| UNKNOWN | Cannot be assessed with current information | **Blocks** the CP3 security-ready claim until assessed |

**Gate rule (normative):** any finding classified **BLOCKS_CP3** or
**UNKNOWN** must block the CP3 security-ready claim. A claim may be made
only when no BLOCKS_CP3 or UNKNOWN finding is open.

### 8.1 High-threat classification (Lane C mapping)

| High threat | Lane C |
|---|---|
| T01 Arbitrary executable selection | FIX_BEFORE_CP3 |
| T02 argv injection | FIX_BEFORE_CP3 |
| T03 Shell invocation | NOT_REACHABLE |
| T04 `cmd /C` | NOT_REACHABLE |
| T05 PowerShell `-Command` | NOT_REACHABLE |
| T06 `.cmd`/`.bat` implicit shell | FIX_BEFORE_CP3 |
| T07 cwd escape | FIX_BEFORE_CP3 |
| T10 Inherited credentials | FIX_BEFORE_CP3 |
| T11 PATH hijacking | FIX_BEFORE_CP3 |
| T12 Malicious executable named `gh` | FIX_BEFORE_CP3 |
| T13 Executable replacement / TOCTOU | FIX_BEFORE_CP3 |
| T15 Adapter/capability mismatch | FIX_BEFORE_CP3 |
| T16 Stale ExecutionPlan | FIX_BEFORE_CP3 |
| T17 Expired ExecutionPlan | FIX_BEFORE_CP3 |
| T18 Approval replay | FIX_BEFORE_CP3 |
| T20 stdout/stderr secret leakage | FIX_BEFORE_CP3 |
| T21 Timeout | FIX_BEFORE_CP3 |
| T23 Orphan processes | FIX_BEFORE_CP3 |
| T24 Child process tree termination | FIX_BEFORE_CP3 |
| T25 Huge output / memory pressure | FIX_BEFORE_CP3 |
| T26 Executable discovery ambiguity | FIX_BEFORE_CP3 |

### 8.2 Gate outcome of this document

This revision contains **no BLOCKS_CP3 and no UNKNOWN findings**. The
majority of High threats are classified FIX_BEFORE_CP3: the design
requires their controls to be implemented and tested before the CP3
"security-ready" claim can be made. The shell-family threats
(T03-T05) are NOT_REACHABLE by contract construction, contingent on the
guard tests and the spawn-boundary rules being enforced. T14 is
ACCEPTED_TEMPORARY_RISK with version recording; T10's full credential
isolation and T18's cryptographic token verification are
ACCEPTED_TEMPORARY_RISK residuals with Checkpoint 7 as the closing
checkpoint.

If a CP3 review elevates any finding to BLOCKS_CP3 or UNKNOWN, the
security-ready claim is blocked until that finding is resolved - per the
gate rule above.

---

## 9. Assumptions and documented residuals

1. **Registry integrity.** The adapter/capability registry is code-shipped with the broker in
  CP3; no plan-controlled dynamic registration.
2. **Local user is trusted.** A user-equivalent attacker (who can install binaries, edit PATH,
  or approve plans) is out of scope; controls still provide defense-in-depth.
3. **No cryptography in CP3.** `token_digest` verification is Checkpoint 7; CP3 relies on single-use plan
  consumption + approval seen-set.
4. **Pre-existing baseline** (`brain_server.rs`) is tracked separately and does not contribute to the CP3
  security-ready claim.
5. **Git hooks.** `gh`/git may execute repo-local hooks in approved repos; cwd allowlisting
  limits exposure; full hook sandboxing is out of scope.
6. **TOCTOU.** A small resolution->spawn window remains (T13) despite re-verification;
  handle-based execution is a follow-up.

---

## 10. CP3 security-ready checklist (design gate)

Before the CP3 security-ready claim can be made, the following must exist
as implemented + tested controls (each traces to a threat):

- [ ] Adapter registry with pinned absolute executable paths (T01, T11, T12, T26)
- [ ] Single program + argv spawn primitive; no shell, no `cmd /C`, no `powershell -Command` (T03-T05)
- [ ] Executable extension allowlist; `.bat`/`.cmd` rejected (T06)
- [ ] cwd allowlist + canonicalization (T07, T08)
- [ ] Environment allowlist / scrubbing (T09, T10)
- [ ] Pre-spawn executable re-verification + resolved-executable recording (T13, T14, W4, W5)
- [ ] Broker gate: `isExecutionPlanExpired` + `EXECUTABLE_PLAN_STATES` + `validateExecutionPlanAgainstCapabilities` + approval binding + single-use consumption (T15-T18)
- [ ] Bounded, redacting output pipeline (T19, T20, T25)
- [ ] Watchdog on `timeout_ms` with job-object/process-tree kill (T21-T24)
- [ ] Two-phase cancellation + restart reconciliation (T22, T23)
- [ ] Contract + adapter negative tests for every FIX_BEFORE_CP3 control

---

## 11. References

- docs/goal24/GOAL24_SCOPE_FREEZE.json - scope freeze, forbidden designs, first vertical slice
  (`github-cli`)
- docs/goal24/04-checkpoint2-contract-design.md - Checkpoint 2 contract design (capability /
  skill / ExecutionPlan)
- docs/goal24/05-checkpoint2-1-contract-hardening.md - 2.1 hardening and `CHECKPOINT3_SECURITY_GATE`
- brain-server/src/capabilities/contracts.ts - `CapabilityDefinition`, `CAPABILITY_ID_PATTERN`, `RESERVED_TRANSPORT_PREFIXES`, authority L0-L3, risk levels,
  side-effect classes
- brain-server/src/execution/contracts.ts - `ExecutionPlan`, `FORBIDDEN_INPUT_KEYS`, `EXECUTABLE_PLAN_STATES`, `APPROVAL_REQUIRED_STATES`, `PRE_APPROVAL_STATES`, `ApprovalReference`, `RiskSnapshot`, `timeout_ms` bounds, `isExecutionPlanExpired`,
  `validateExecutionPlanAgainstCapabilities`
- desktop-daemon/src-tauri/src/brain_server.rs - pre-existing baseline spawning (section 7)
