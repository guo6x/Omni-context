# Goal24 Checkpoint 7 — Lane B: Tauri Native Approval Authority + Durable Replay / Risk Enforcement

- Lane: `B — NATIVE APPROVAL`
- Base SHA: `dfc666ac32c23df34ade0e612aec4e925e9f6d00` (`origin/dev/goal24-cli-skills`)
- Status: `LANE_B_COMPLETE`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp7-native-approval`
- Local branch: `local/cp7-native-approval` (no push)

## Scope

This is the only lane allowed to modify the Tauri Broker approval gate. It
delivers:

- a native Approval Authority (execution-authority owner, not the Decision
  Kernel),
- a persistent approval grant store,
- a durable plan replay ledger,
- Broker-independent native risk validation,
- approval verify + atomic consume,
- restart replay protection.

Out of scope: Brain approval policy, Approval UI (CP9), GitHub write bindings,
Outcome verification.

## Files owned by this lane

- `desktop-daemon/src-tauri/src/execution_broker/mod.rs`
- `desktop-daemon/src-tauri/src/execution_broker/policy.rs`
- `desktop-daemon/src-tauri/src/execution_broker/types.rs`
- `desktop-daemon/src-tauri/src/execution_broker/approval/{mod,types,authority,store,ledger,digest,tests}.rs`
- `desktop-daemon/src-tauri/src/execution_broker/tests.rs` (updated expectations)
- `desktop-daemon/src-tauri/src/execution_broker/adversarial.rs` (updated expectations)
- `desktop-daemon/src-tauri/src/github_cli/bindings.rs` (native risk metadata only)
- `docs/goal24/cp7-lane-b-native-approval.md`
- `docs/goal24/checkpoint7-lane-b-manifest.json`

`brain-server/**` is untouched. No GitHub write binding was added; the five
production bindings remain read-only.

## Native risk mirror

`ExecutionBinding` now carries compiled trusted metadata:

- `capability_version()`
- `risk_policy() -> ExecutionRiskPolicy` where
  `ExecutionRiskPolicy { risk_level, side_effect_class, reversible,
  required_authority }`

The five GitHub read bindings compile to `1.0.0`, `low`, `read_only`,
`reversible=false`, `required_authority=L0`.

The broker compares `plan.capability_version`,
`plan.risk_snapshot.capability_version` and the binding version, then compares
risk level, side-effect class, reversibility and authority against the
compiled binding. Any mismatch is `PlanRejectedRiskPolicy` and execution is
refused. A plan can never downgrade (or upgrade) binding risk metadata.

## Native minimum approval rule (V1)

The broker computes the minimum independently:

```
side_effect != read_only || risk != low || required_authority != L0
    -> native_minimum_approval_required = true
```

A plan may be stricter (e.g. `required_approval=true` on a read-only plan is
allowed and still requires a real grant). A plan may never be looser:
`required_approval=false` on a binding whose compiled policy requires
approval fails closed with `PlanRejectedApprovalPolicy`. The fake-low-risk
plan attack (plan claims `low/L0/read_only` against a compiled
`medium/L2/reversible_write` binding) is blocked natively by a dedicated
test-only write binding; it never depends on Brain-side validation.

## Approval Authority

`ApprovalAuthority` is the native execution-authority owner. Approval records
are native/server-owned; callers can only carry `ApprovalReferenceWire`
strings. The structural presence of a reference is never proof.

Grant states: `pending`, `granted`, `denied`, `revoked`, `consumed`,
`expired`. Only `granted`, not expired, not consumed, not revoked verifies.

An approval record stores: `approval_id`, `approval_request_id`, `plan_id`,
`approval_binding_digest`, `capability_id`, `capability_version`, a frozen
risk policy snapshot, `actor_id`, `actor_kind`, `actor_authority`,
`policy_version`, `granted_at`, `expires_at`, `token_reference`,
`token_digest`, `status`, `consumed_at`, `execution_id`. Real GitHub tokens or
API keys are never stored.

### Token material

- `token_reference`: native-generated from the OS CSPRNG via `getrandom`
  (`grant_` + 32 random hex). Never an incrementing integer, timestamp or
  plan id. Never caller-supplied.
- `token_digest`: SHA-256 over secure random grant material + the approval
  binding digest + the token reference, computed by the authority. A caller
  supplied `token_digest` is never accepted into the store.
- Equality checks are constant-time.

The source of authority is always the trusted native `ApprovalStore` lookup:
a copied/forged string pair with no store record is rejected
(`ApprovalRecordNotFound`).

### Approval binding digest

Canonical SHA-256 (`cp7-approval-binding-v1` prefix) binding:

- `plan_id`, `decision_id`
- capability id + version, adapter id
- normalized inputs
- risk snapshot, evidence coverage snapshot
- timeout, verification plan, rollback plan
- `created_at`, `expires_at`
- policy version

JSON objects are canonicalized by sorting keys byte-wise; the digest never
depends on `serde_json` map iteration order. This is the Rust mirror of Lane
A's `ApprovalBindingPayload` for the later TS/Rust 1:1 conformance check.
Mutating any bound field after grant changes the digest and the approval is
rejected. Approval for plan A can never be replayed onto plan B even when
capability and inputs are identical, because `plan_id` is part of the
binding.

### Actor authority

`L0 < L1 < L2 < L3`. A grant requires
`actor_authority >= binding.required_authority`, otherwise
`ApprovalActorAuthorityInsufficient`. Allowed actor kinds are `owner` and
`admin` only; `model`, `skill`, `provider` and `system` cannot grant a write
approval.

### Expiry

- `expires_at > granted_at` strictly.
- `expires_at <= plan.expires_at` when the plan has one.
- Grant lifetime <= trusted maximum: 15 minutes (CP7 V1). Approvals are never
  unlimited.
- Future `granted_at` or malformed timestamps fail closed; the trusted native
  clock is used.

## Approval store

Persistent JSON store at a trusted injected path (`Broker::with_persistence`
or `ApprovalAuthority::persistent`); callers can never submit a store path.
Writes are atomic: temp file -> flush -> fsync -> rename. A corrupt store is
retained as a degraded state (`BROKER_APPROVAL_STORE_CORRUPT`); it is never
deleted and never treated as an empty database. Every `execute` fails closed
while degraded.

## Durable plan replay ledger

The CP3 memory-only `executed_plans` HashSet is replaced by a durable
`PlanLedger`. Every plan id accepted into the spawn phase - read-only plans
included - is persisted before any spawn. After restart the same plan id is
still rejected with `PlanRejectedSingleUse`.

## Consume-before-spawn ordering

```
static validation
-> binding / risk / expiry checks
-> approval verify (native store)
-> atomic persist: approval consumed + plan id reserved
-> spawn
```

A crash between persist and spawn leaves the approval consumed: the user must
approve a new plan. That is the correct fail-closed behavior; duplicate
external effects are worse than a lost spawn.

`consume_if_granted` is an atomic compare-and-consume under the store mutex:
exactly one concurrent caller transitions `granted -> consumed`; the other is
rejected. Denied/revoked-before-consume grants never execute. Revoking an
already-consumed grant is audit-only; an executed effect can never be rolled
back.

## BrokerStatus

- `approvals_enforced=true` only while both the approval store and the
  durable plan ledger are initialized and healthy; otherwise it reports
  `false` and execute fails closed.
- `execute_ipc_enabled=false` remains: no generic execute IPC.
- No public `approvePlan` / `grantApproval` Tauri command exists. Grant, deny
  and revoke are crate-internal; CP9 Approval UI wires the owner/admin
  surface later.

## Restart replay protection

Tests destroy the broker and recreate it over the same persistent store +
ledger: the same plan / approval is rejected after restart. Corrupt approval
store and corrupt plan ledger both produce zero executions (fail closed).

## Validation

- `cargo fmt --check`: PASS
- `cargo check`: PASS (one pre-existing `dead_code` warning in
  `src/clipboard.rs`, unrelated)
- `cargo clippy --all-targets`: PASS - no warnings in lane files; remaining
  warnings are pre-existing in `commands.rs`, `main.rs`, `mcp_helper.rs`,
  `udp_listener.rs`, `brain_server.rs`, `clipboard.rs`
- `cargo test`: PASS - 149 passed, 0 failed, 6 ignored (approval module: 27
  tests)
- `cargo audit` (offline RustSec db `D:\environment\advisory-db-offline`):
  5 findings, all pre-existing transitive advisories, none introduced by this
  lane (`Cargo.toml` / `Cargo.lock` unchanged):
  - `crossbeam-epoch 0.9.18` RUSTSEC-2026-0204 (via
    `crossbeam-deque` <- `ignore` <- `tauri` / `tauri-plugin-autostart`)
  - `quick-xml 0.30.0` RUSTSEC-2026-0194 / RUSTSEC-2026-0195 (Linux build
    dependency via `xcb` <- `screenshots`)
  - `quick-xml 0.39.3` RUSTSEC-2026-0194 / RUSTSEC-2026-0195 (via
    `plist` <- `tauri` / `tauri-codegen` and `wayland-scanner`)
  - plus 17 allowed warnings (gtk-rs/atk unmaintained, fxhash, instant,
    proc-macro-error, rustls-pemfile, anyhow, glib, rand) - all pre-existing
- desktop `npm run verify:controlled`: PASS (controlled files unchanged)
- `git diff --check`: PASS

## Compatibility note

CP7 keeps `ApprovalReferenceWire` fields (`approval_id`, `plan_id`,
`granted_by`, `granted_at`, `policy_version`, `token_reference`,
`token_digest`) wire-compatible, but their real authority comes exclusively
from the native store record, never from the strings themselves.