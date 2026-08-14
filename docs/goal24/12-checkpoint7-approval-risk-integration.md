# Goal24 Checkpoint 7 - Cross-Language Approval Binding Conformance and Durable Replay / Risk Enforcement Freeze

Status: **GOAL24_CHECKPOINT7_COMPLETE** - all A-AM gate criteria PASS.

Checkpoint 8 was not started: no Outcome read-back verification, no
post-execution verification, no rollback orchestration, no Outcome lifecycle.
No Approval UI and no public approval IPC were added.

- Base: `dfc666ac32c23df34ade0e612aec4e925e9f6d00` (`origin/dev/goal24-cli-skills`, verified exact)
- Integration branch: `local/cp7-integration` (worktree `D:\ai_code\Omni-context-worktrees\cp7-integration`)
- Policy literal: `goal24-approval-policy-v1` (shared TS/Rust, machine-checked)
- FINAL_HEAD_SHA: recorded in the completion response (docs commit)

## 1. Lanes integrated

All lane objects were verified present and cherry-picked in order onto the
verified base. Lane C adds docs and fixtures only (runtime diff = 0).

| Lane | Requested commits | Integrated commits |
| --- | --- | --- |
| A - Brain Approval Policy | `56f5dc7`, `7bf8437`, `0e9adc9`, `2af4f942` | `f01e329`, `d85575c`, `6f08412`, `cc1aeb7` |
| B - Native Approval Authority | `d1e71c0`, `89d11d6`, `f3f24d7`, `5ce3669f` | `c71e59b`, `384dad0`, `9851ef4`, `4b20fab` |
| C - Approval Security Oracle | `1a83e06f` | `1b75ba1` |

Lane A adds the fail-closed risk policy, the server-owned plan authorization
lifecycle (pending -> awaiting_approval -> ready via a verified native grant)
and the immutable approval binding digest. Lane B adds the native approval
authority: persistent approval store, durable plan ledger, actor authority,
single-use grants and replay/mutation resistance. Lane C defines the
280-vector / 36-category adversarial corpus, the 17-surface bypass audit
(1 `POTENTIAL_APPROVAL_BYPASS`, 0 `BLOCKS_CP7`), the binding-contract draft and
the threat model; it modifies no runtime.

## 2. Cross-language contract decision (evidence lineage)

Lane A's binding report carried `evidence_guard_run_id`; Lane B's did not.
The integration froze the minimal, compatible design:

- **Bound:** `evidence_coverage_digest` (the authoritative coverage snapshot
  carried by the server-owned ExecutionPlan).
- **Not bound:** `evidence_guard_run_id`. No ExecutionPlan wire-contract
  migration (TS schema + Rust wire + fixtures + tests) was executed, and the
  Rust side never silently ignores a field the TS side hashes.

Authority boundaries (documented in
`cp7-approval-binding-contract.json` `integration_authority`):

- **Brain owns evidence qualification** - only `EvidenceEligibilityService`
  output from CP6 Guard-run lineage can materialize coverage; callers cannot
  pass coverage, a guard fake, `guard_run_id` or required evidence.
- **Native owns approval/execution** - the Broker does NOT re-prove CP6
  `GuardRunStore` lineage. It independently validates the compiled capability
  risk, the approval grant record, the exact plan semantics digest (which
  includes `evidence_coverage_digest`), expiry and single-use ledger state.

`docs/goal24/cp7-approval-binding-contract.json` is the single canonical
authority; its Lane C draft sections are preserved and superseded where they
conflict by the frozen `integration_authority` section.

## 3. Canonical binding V1

14 fields, identical in TS and Rust:
`plan_id`, `decision_id`, `capability_id`, `capability_version`, `adapter_id`,
`normalized_inputs_digest`, `risk_snapshot_digest`,
`evidence_coverage_digest`, `timeout_ms`, `verification_plan_digest`,
`rollback_plan_digest`, `created_at`, `expires_at`, `policy_version`.

Excluded (lifecycle/opaque-reference fields, rejected strictly by the TS
payload schema): `state`, `approval`, `required_approval`,
`token_reference`, `token_digest`, `evidence_guard_run_id`.

Canonical JSON rules (shared spec, both sides test against one fixture):

- keys sorted by UTF-16 code-unit order; arrays ordered
- JS `JSON.stringify`-compatible string escaping (incl. U+2028/U+2029)
- **no Unicode normalization** (combining/precomposed forms digest differently)
- number domain: finite, `|value| <= Number.MAX_SAFE_INTEGER`, no exponent
  notation, at most 6 fractional digits, fixed-point; `-0` -> `0`; `1.0` ->
  `1`; NaN/Infinity rejected fail-closed
- absent optional values encode as explicit JSON null (one encoding)
- timestamps bound verbatim (RFC3339 strings, no normalization)
- unknown fields rejected (`strictObject` / `deny_unknown_fields`)

Golden vectors: `docs/goal24/fixtures/cp7-approval/binding-golden-vectors.json`
(31 vectors, one baseline + per-field mutation matrix; baseline digest
`aca32e8f...f5d5f6d`). TS reads it (15 tests), Rust reads the same file
(5 tests): 0 digest mismatches. Risk policy: shared 48-row native-minimum
matrix + authority order/satisfies pairs: 0 mismatches. Policy literal
`goal24-approval-policy-v1` shared: 0 mismatches.

## 4. Risk policy and mutation resistance

- Only `read_only + low + L0` is approval-free; every other combination
  requires approval (TS policy and Rust native minimum use the same matrix).
- A plan `required_approval=true` on a read/low/L0 binding is an allowed
  stricter policy - the native authority then requires a real grant.
- Native minimum cannot be bypassed: plan risk/authority/side-effect/reversibility
  understatements vs the compiled binding are rejected (`PlanRejectedApprovalPolicy`).
- Every bound field mutation invalidates the binding digest; the broker
  re-computes it from the current plan and rejects post-grant mutation.

## 5. Durable replay and crash safety

Model: write-ahead fail-closed ordered reservation under an exclusive OS file
lock (`LockFileEx`/`flock`):

1. accept (validate store record + recompute binding digest)
2. durably reserve `plan_id` (Reserved phase)
3. durably consume the approval
4. spawn

Fault points tested: `BeforePlanReserve`, `AfterPlanReserve`,
`BeforeApprovalConsume`, `AfterApprovalConsume`, `BeforeSpawn`. For every
fault point, recreating the Broker from the same store and resubmitting the
same plan is rejected after restart (replayable_after_restart = 0). Spawn
failure never unconsumes the approval and never unreserves the plan; retry
requires a new plan and a new approval.

Concurrency: 8/16/32 concurrent attempts on one plan/approval => exactly one
accepted. A second Broker instance on the same store opens degraded via the
OS lock. The cross-process guarantee is the fail-closed lock plus the
single-instance authority assumption - documented, not overclaimed.

Store corruption (malformed/truncated/unknown schema/duplicate/impossible
state/invalid digest/invalid lifetime) fails closed; a corrupt ledger is
never reset empty.

## 6. TTL, actors and token semantics

- Max grant TTL 15 minutes; exactly 15m allowed, 15m+1ms rejected; boundary
  `now >= expires_at` is expired; approval expiry cannot exceed plan expiry.
- Actor ordering L0 < L1 < L2 < L3 shared by both languages; only
  owner/admin actors with `source trusted_local` can grant. model/skill/
  provider/system can never grant; `granted_by` spoofing is rejected.
- `token_reference`/`token_digest` are opaque store-reference/integrity
  material, never bearer capabilities, never on the wire as raw secrets;
  comparisons use constant-time equality.

## 7. Bypass closure

`docs/goal24/checkpoint7-bypass-closure.json`: 17 surfaces disposed,
`potential_before = 1`, `blocks_before = 0`, `potential_after = 0`,
`blocks_after = 0`. The single potential (`CP7A-014`, forged coverage
snapshot / forged ApprovalReference at plan construction) is CLOSED by the
authority boundary: server-owned evidence eligibility, server-owned
required_approval/risk/state, verifier-required real native grant, reference
is not authority (store record validation), and no public approval or generic
execute IPC. The Lane C audit file itself is not rewritten.

## 8. Adversarial oracle

`docs/goal24/checkpoint7-adversarial-execution-map.json`: all 280 vectors /
36 categories mapped - 216 AUTOMATED, 61 COVERED_BY_EXISTING_TEST,
1 MANUAL (log PII inspection), 2 NOT_APPLICABLE (Approval UI does not exist
until CP9). unmapped = 0, failed = 0. Every `test_name` comes from
machine-extracted real test-run output (vitest JSON report, 540 goal24 tests
PASS; `cargo test -- --list`, 174 tests) and is frozen in the map's
`test_registry`; the Rust map oracle
(`approval::oracle_tests::adversarial_execution_map_is_complete_and_honest`)
re-validates structure and registry referential integrity on every test run.
All 14 fail-oracle items are mapped to covered categories (the production
write-binding item is closed by static audit: production write bindings = 0).

## 9. Execution surface

- `execute_ipc_enabled = false`; no `executePlan`/`run`/generic shell command
  is exposed to WebView.
- Public approval mutation IPC = 0 (no approve/grant/revoke/deny command or
  REST route). The only broker IPC remains the read-only status snapshot.
- Production GitHub bindings remain the five CP4 read-only bindings;
  production write bindings = 0. Test-only write bindings are
  `#[cfg(test)]` / synthetic test capability only.

## 10. Brain restart semantics (documented limitation)

Lane A's `AuthorizationStore` is memory-only: a Brain restart invalidates its
pending/ready authorization state. Unused native grants remain in the durable
store until expiry/revoke/consume; because generic execute IPC is false and no
public plan-submission path exists in CP7, they cannot be used externally.
CP7 does not claim that Brain restart auto-revokes native grants.

CP9 bridge requirement (recorded, not implemented): the trusted Brain<->Tauri
bridge must submit the server-owned current ExecutionPlan/approval lifecycle
object, never an arbitrary WebView-constructed plan.

## 11. Regressions and security audits

- Brain: typecheck, build, lint (0 errors, 10 pre-existing warnings) - all
  exit 0; full vitest at freeze time: 57 test files, 1059 passed, 0 failed;
  `npm audit --omit=dev --audit-level=critical` exit 1: 16 findings
  (3 low, 8 moderate, 4 high, 1 critical), all classified
  NOT_APPROVAL_EVIDENCE_RUNTIME_REACHABLE (approval/evidence import graph is
  node:crypto + zod + internal modules only); Node approval/evidence runtime
  UNKNOWN=0, FIX_BEFORE_CP7=0, BLOCKS_CP7=0.
- Desktop/Rust: `npm run build` PASS, `verify:controlled` PASS (controlled
  manifest re-snapshot for the intentional Cargo.lock audit bumps),
  `cargo fmt --check`,
  `cargo check`, `cargo clippy --all-targets`, `cargo test` (168 passed,
  0 failed, 6 ignored = 174 listed, re-run at freeze time), `cargo audit`
  (offline advisory DB) - re-run at freeze time: 5 advisories reported;
  1 runtime-reachable vuln fixed (crossbeam-epoch 0.9.18->0.9.20),
  1 unsound warning fixed (anyhow 1.0.102->1.0.103), 4 quick-xml
  advisories classified NOT_RUNTIME_REACHABLE_ON_WINDOWS (`cargo tree
  --target x86_64-pc-windows-msvc -i quick-xml@0.30.0/@0.39.3` => empty;
  Linux/macOS-only transitive paths xcb/wayland-scanner/plist).
- `git diff --check` clean.
- Reachability classification: approval/evidence runtime reachable
  advisories: UNKNOWN=0, FIX_BEFORE_CP7=0, BLOCKS_CP7=0; the remaining 4
  quick-xml advisories are lockfile entries never compiled into the Windows
  product (see `docs/goal24/checkpoint7-security-gate.json` audits section).

## 12. CP3/CP4/CP5/CP6 invariants

- Broker containment (Job Object, scrubbed env, output limits, ready-only
  first spawn): preserved - Rust broker/adversarial suites green.
- GitHub read adapter (5 read-only bindings, pinned gh.exe, no bare spawn):
  preserved - github_cli suite green.
- Skill Registry / importer: preserved - skill suites green.
- Evidence Surface Guard / eligibility: preserved - evidence suites green.
- generic execute IPC: NO. production write bindings: 0.

## 13. Security gate

`docs/goal24/checkpoint7-security-gate.json`: criteria A-AM all PASS.

## 14. Checkpoint 8 not started

No Outcome read-back verification, no post-execution verification, no rollback
orchestration, no Outcome lifecycle. Work stops at CP7.

## 15. Firewall

`research/decision-benchmark-holdback-v2`, `science/*`, Gold/formal/paper
references were not read or modified. The dirty legacy worktree
`D:\ai_code\Omni-context\.worktrees\goal24-cp21` was not touched.