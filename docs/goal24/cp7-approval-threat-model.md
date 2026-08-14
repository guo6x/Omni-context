# CP7 Approval + Risk Enforcement Threat Model (Lane C)

Goal24 Checkpoint 7, Lane C. Security oracle for the future Brain approval
runtime and Rust Approval Authority. Documentation-only: no runtime code
changed in this lane. Companions: `cp7-approval-adversarial-vectors.json`
(machine-readable oracle), `cp7-approval-bypass-audit.json` (surface audit),
`cp7-approval-binding-contract.json` (cross-language conformance spec),
`fixtures/cp7-approval/` (synthetic fixtures).

## 1. Current state (audited at base dfc666ac)

- `ApprovalReference` in `brain-server/src/execution/contracts.ts` and
  `ApprovalReferenceWire` in `desktop-daemon/.../execution_broker/types.rs`
  are schema-only. Neither side treats structural presence as validated
  approval.
- Broker rejects every plan with `required_approval=true`
  (`PlanRejectedApproval`); `approvals_enforced=false` in broker status.
- `executed_plans` is a memory-only `HashSet` — no durable ledger.
- Generic execute IPC remains disabled (`execute_ipc_enabled=false`); only
  read-only `get_broker_status` is exposed.
- Production GitHub write bindings: 0 (five read-only CP4 bindings).
- CP6 Evidence runtime exists: `evaluateForCapability` accepts only
  capability identity + inputs; `EvidenceEligibilityService` materializes
  authoritative coverage + lineage. It explicitly is NOT an approval token
  and never transitions plan state.
- No public approval mutation surface exists (REST/MCP/Tauri/frontend
  searches for approve/approval/grant/setApproval/markReady return nothing).

## 2. Security position

Approval is a durable, actor-bound, plan-bound grant checked by the native
Rust authority at execution time. A schema-valid `ApprovalReference` is
nothing unless the native approval store holds the matching record and every
binding field (plan content digest, risk, evidence lineage, capability,
subject, expiry) still matches. The approval path cannot be satisfied by
Brain-side validation alone.

## 3. Threats

### 3.1 Risk/authority/side-effect/reversibility downgrades

Any plan field that understates the compiled binding (risk level, required
authority, side-effect class, reversibility) must be natively rejected by
comparing the plan against the compiled binding the adapter registered. The
canonical example: compiled binding medium/L2/reversible_write vs plan
low/L0/read_only -> native reject; Brain-side checks cannot be the only
defense. `required_approval` downgrades are the same family: medium/L2
write, high/L3 destructive, and external_effect plans must natively require
approval; a caller cannot set `required_approval=false`. A read_only L0
plan with `required_approval=false` is legal; a read_only plan that opts
into `required_approval=true` must carry a REAL approval.

### 3.2 Approval reference forgery

A structurally legal `ApprovalReference` (approval_id, token_reference,
token_digest, plan_id) whose record does not exist in the native
ApprovalStore must be rejected: schema-valid != approved. Approval id
collisions, token reference/digest forgery, and store spoof all fail
against the server/native-owned store.

### 3.3 Mutation after approval

An approval binds the plan content it authorized. Each of these mutated
individually must invalidate the old approval: decision_id, capability_id,
capability_version, adapter_id, normalized_inputs, risk snapshot, coverage
snapshot, timeout, verification plan, rollback plan, expires_at. The
binding is a canonical content digest over the approval-binding fields
(see `cp7-approval-binding-contract.json`), so any mutation breaks the
digest match.

### 3.4 Evidence binding

Approval binds the CP6 authoritative coverage digest and Guard lineage
(guard_run_id -> qualified evidence ids -> coverage digest). A forged
caller-constructed coverage snapshot cannot obtain a valid approval path:
the native authority must only accept coverage lineage that traces to the
CP6 Evidence Guard / Eligibility service output.

### 3.5 Plan A -> Plan B / cross scope

Two plans identical except plan_id: A's approval can never authorize B.
Approving repoA/issue#1 then substituting repoB/issue#2 must produce a
binding mismatch. The same applies cross-capability, cross-subject,
cross-repository, and cross-user.

### 3.6 Actor authority

An actor may grant only actions at or below its own authority:
L0 -> L1 reject; L1 -> L2 reject; L2 -> L2 allow; L2 -> L3 reject;
L3 -> L3 allow. Actor kinds model / skill / provider / system can never
grant an elevated action; only an owner/user actor at sufficient authority
can grant. LLM, Skill, and Provider self-approval are rejected by
construction (no such path exists).

### 3.7 Expiry and time

Grant TTL edge, exact expiry, expiry+1ms, future granted_at, grant that
expires before it is granted, grant expiring after plan expiry, and
unbounded expiry must all be enforced against a trusted clock. Trusted
clock only: wall-clock manipulation is fail-closed.

### 3.8 Replay / restart / concurrency

Same plan + same approval sequential, same pair concurrent, same approval
on a different plan, same plan with a different fake approval, restart of
the same plan, restart of the same approval, and crash-after-consume-
before-spawn all fail closed. The consume transition must be durable and
atomic BEFORE spawn; the memory-only executed_plans ledger is replaced by
a durable ledger in CP7 (memory loss must not allow a second execution).

### 3.9 Durable ledger corruption

Malformed JSON, unknown schema version, duplicate plan reservations,
duplicate approval records, truncated files, unknown fields, invalid
digests, and invalid states must disable broker execution (fail closed).
The store must NEVER be silently reset to empty.

### 3.10 Public surfaces / IPC

No REST, MCP, Tauri invoke, or frontend API path may let a model/WebView
grant approval; any such path found in integration is BLOCKS_CP7. Generic
execute IPC stays false; CP7 must not open `executePlan(plan)` to WebView.
Production GitHub write bindings stay 0 during CP7 (red-team uses synthetic
fixtures only).

### 3.11 Cross-language binding conformance

TS `ApprovalBindingPayload` and the Rust approval binding digest must agree
1:1 on a canonical field set. Canonicalization rules: object key reorder,
nested object reorder, array order, unicode, empty strings, large ints,
negative zero, NaN, Infinity, undefined, BigInt, and control chars must all
be deterministic or fail closed in both languages (see
`cp7-approval-binding-contract.json`).

### 3.12 Secret/token leakage

FAKE_CP7_TOKEN / FAKE_CP7_SECRET must never appear in ordinary logs,
Broker errors, future Approval UI summaries, or audit traces. Real GitHub
tokens are never read in this lane.

## 4. Fail oracle

Any of the following makes CP7 integration FAIL:

- caller can set required_approval false on write
- plan risk can understate compiled binding risk
- schema-only ApprovalReference accepted
- approval can authorize mutated plan
- approval can authorize another plan
- insufficient authority actor grants
- LLM/Skill/Provider grants approval
- expired/revoked/denied/consumed grant executes
- same plan executes twice after restart
- corrupt ledger resets empty
- approval consumed after spawn instead of before
- public generic approval mutation API exists
- generic execute IPC enabled
- production write binding added during CP7