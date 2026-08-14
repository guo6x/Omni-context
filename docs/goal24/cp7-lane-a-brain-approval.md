# Goal24 Checkpoint 7, Lane A - Brain Approval Policy + Risk Enforcement + Plan Authorization Lifecycle

Date: 2026-08-14
Branch: `local/cp7-brain-approval`
Base: `dfc666ac32c23df34ade0e612aec4e925e9f6d00` (`origin/dev/goal24-cli-skills`, verified exact)
Worktree: `D:\ai_code\Omni-context-worktrees\cp7-brain-approval`

## Scope

This lane implements the Brain Server approval layer: the V1 fail-closed
approval/risk policy, the server-owned plan authorization lifecycle, the
CP6 EvidenceEligibility -> ExecutionPlan bridge, the approval request model,
actor authority enforcement and the immutable approval binding payload/digest.

**In scope**

- `brain-server/src/approval/contracts.ts` - strict request / actor / binding
  / approval-request / grant / store-record schemas
- `brain-server/src/approval/policy.ts` - V1 approval policy, authority
  ordering, risk snapshot derivation, expiry bounds
- `brain-server/src/approval/binding.ts` - canonical binding payload + digest
- `brain-server/src/approval/authorization-store.ts` - bounded in-memory
  server-owned store
- `brain-server/src/approval/authorization-service.ts` - authorize /
  applyApproval / deny / revoke / expiry sweep lifecycle
- `brain-server/src/approval/errors.ts` - stable `ApprovalError` codes
- `brain-server/src/approval/index.ts` - barrel exports
- Tests: `brain-server/tests/goal24-approval-policy.test.ts` (33),
  `brain-server/tests/goal24-authorization-service.test.ts` (48), fixtures in
  `brain-server/tests/helpers/fake-approval.ts`

**Not in scope (explicitly not implemented)**

- Tauri Approval Authority, Broker native approval validation
- Rust persistent replay ledger
- Approval UI (Checkpoint 9 wiring)
- GitHub write bindings, Outcome verification
- Any public mutation API (grantApproval / approvePlan / setApproval /
  setAuthority / markReady are not exposed to REST / MCP / Tauri IPC / LLM
  tools)

No existing runtime files were modified. `brain-server/src/execution/contracts.ts`
is untouched and the current `ApprovalReference` wire shape is kept
compatible: CP7 fills `token_digest` with the core-computed binding digest
(the "real computation" deferred by CP2.1). No wire migration was needed.
No new dependencies were added.

## V1 approval policy (fail closed)

`APPROVAL_POLICY_VERSION = 'goal24-approval-policy-v1'`.

Approval is NOT required only for the minimum case:

```text
side_effect_class == read_only
&& risk_level == low
&& required_authority == L0
```

Any other combination - a write / external-effect side effect, a risk level
above `low`, or an authority above `L0` - requires explicit approval. In V1
every write or external-effect capability requires explicit approval; there
is no write auto-approval and no system/LLM grant path. Future relaxation
is a separate, deliberately out-of-scope checkpoint.

`approvalRequired(capability)` is the single pure policy predicate; the
service has no other approval decision path.

## Caller authority boundary

`ExecutionAuthorizationRequestSchema` is a strict Zod object. The only
caller-supplied fields are: `decision_id`, `capability_id`,
`capability_version`, `adapter_id`, `normalized_inputs`, `guard_run_id`,
`timeout_ms`, `verification_plan`, `rollback_plan`, optional `requested_by`,
`correlation_id`, `expires_at`.

Caller-supplied `required_approval`, `risk_snapshot`, `state`, `approval`,
`evidence_coverage_snapshot`, `plan_id`, `now` and `granted_at` (and any
other unknown key) are rejected with `APPROVAL_INPUT_INVALID`. Reserved
top-level `normalized_inputs` keys (`shell`, `command`, `exec`, `bash`,
`powershell`, `cmd`, `cmdline`, `script`) are rejected by the same boundary.

## Risk snapshot is server-derived

`deriveRiskSnapshot(capability)` builds `{ risk_level, reversible,
side_effect_class, required_authority, capability_version }` exclusively
from the trusted `CapabilityDefinition`. The caller can never provide a risk
snapshot; a risk-downgrade attempt is schema-rejected and the final plan
always carries the capability-declared risk/authority.

## Evidence comes from CP6 only

`AuthorizationService.authorize` calls
`EvidenceEligibilityService.materializeEvidenceForExecutablePlan(
{ guard_run_id, capability_id, capability_version, normalized_inputs })`
before any plan state is decided. The request has no coverage field; forged
or caller-constructed coverage can never enter CP7. Materialization failures
surface as `APPROVAL_EVIDENCE_INELIGIBLE` with the structured CP6 error code.

The materialized `authoritative_coverage` is written into the plan's
`evidence_coverage_snapshot` and its digest is bound into the approval
binding payload.

## Server-owned plan id and plan states

`plan_id = 'plan-' + crypto.randomUUID()` (matches `PLAN_ID_PATTERN`);
callers can never choose or replay a plan id.

- approval NOT required -> `state = ready`
- approval REQUIRED -> `state = awaiting_approval`

The caller cannot choose `ready`. Both states are validated through
`ExecutionPlanSchema` and `validateExecutionPlanAgainstCapabilities` at
creation and at every transition.

## Approval request record

For `awaiting_approval` plans the core creates an
`ApprovalRequestRecord` (status `pending`) with: `approval_request_id`,
`plan_id`, `decision_id`, `capability_id`, `capability_version`,
`risk_snapshot`, `side_effect_summary`, `reversible`, `evidence_summary`
(guard_run_id, coverage_digest, mandatory_classes, mandatory_satisfied),
`coverage_digest`, `normalized_inputs_digest`, `approval_binding_digest`,
`required_authority`, `policy_version`, `created_at`, `expires_at`,
`status`. No raw secret or token is stored.

## Approval binding payload + digest

`ApprovalBindingPayload` binds everything approval must not silently change:

- `plan_id`, `decision_id`, `capability_id`, `capability_version`,
  `adapter_id`
- `normalized_inputs_digest`, `risk_snapshot_digest`,
  `evidence_coverage_digest`, `evidence_guard_run_id`
- `timeout_ms`, `verification_plan_digest`, `rollback_plan_digest`
- `created_at`, `expires_at`, `policy_version`

`state` and `approval` are deliberately absent: awaiting_approval -> ready is
a legal transition.

The digest algorithm is canonical deterministic JSON (object keys stably
sorted, array order preserved) + SHA-256 lowercase hex, reusing the CP6
`canonicalJson` / `sha256Hex` primitives. NaN, Infinity, undefined, BigInt,
class instances and cycles are rejected, never coerced. All digest fields
are core-computed; providers/callers can never announce their own.

`applyApproval` recomputes the payload from the stored plan and compares it
to the recorded `approval_binding_digest`: input swap, coverage swap, risk
downgrade, adapter/timeout/verification-plan/rollback-plan/decision/expiry
mutations all fail with `APPROVAL_BINDING_MISMATCH`.

## Actor authority

`TrustedApprovalActorSchema` is strict: `actor_id`, `actor_kind`
(`owner` | `admin`), `authority_level` (`L0`..`L3`), `source` literal
`trusted_local`. A model, skill, provider or untrusted API caller can never
declare itself a trusted approval actor.

Authority ordering is canonical: `L0 < L1 < L2 < L3`. A grant requires
`actor.authority_level >= capability.required_authority`; otherwise
`APPROVAL_AUTHORITY_INSUFFICIENT`. A verified L2 actor can grant the
medium/L2 synthetic write; an L2 actor against the high/L3 destructive
capability is rejected; an L3 owner may grant it (the plan becomes ready but
is still never executed in this lane).

## Native grant verifier abstraction

The Brain never honors an `ApprovalReference` merely because it is
structurally valid. `ApprovalGrantVerifier` is an injected internal
interface:

```ts
verifyGrant({ plan, approval_reference, approval_binding_digest })
  -> { valid: true, grant: { actor, authority, granted_at,
                             expires_at, native_record_id } }
  |  { valid: false }
```

A bare reference (`approval_id` / `token_reference` / `token_digest`) can
never move `awaiting_approval` to `ready` unless the verifier confirms a
real native grant. Lane A tests use deterministic fake verifiers; Lane B
wires the native authority.

## applyApproval checks (all mandatory, fail closed)

1. plan state is `awaiting_approval`
2. approval request exists and is `pending`
3. approval request policy version equals the current runtime policy
4. approval request is not expired (trusted clock)
5. binding digest recomputes unchanged from the stored plan
6. `approval_reference.plan_id` matches exactly
7. `approval_reference.policy_version` matches exactly
8. native verifier returns a valid grant (structured metadata validated)
9. grant authority equals actor authority level
10. actor authority >= required authority
11. `granted_at` is not in the future
12. grant is not expired
13. grant expiry does not exceed plan expiry / policy TTL cap
14. the transitioned plan re-passes `ExecutionPlanSchema`

On success: `state -> ready`, the wire `ApprovalReference` is written
(`token_digest = approval_binding_digest`), the request becomes `granted`
and the verified grant metadata is recorded.

## Rejection / revocation / expiry

The Brain lifecycle supports `pending`, `granted`, `denied`, `revoked`,
`expired`. `denyApproval` and `revokeApproval` are internal service methods:
denied plans become `blocked` and can never be ready; a grant revoked before
execution moves the plan back to `blocked` with the approval cleared;
`applyApproval` on either fails with `APPROVAL_STATE_CONFLICT`.
`sweepExpired()` fails closed: expired pending requests and expired grants
transition to `blocked` with status `expired`.

## Expiry policy and clock

`DEFAULT_MAX_APPROVAL_TTL_MS = 15 minutes`. Plan expiry is always
`created_at + TTL` bounded; a caller `expires_at` may only shorten the bound
and must be strictly after `created_at`. Grant expiry must not exceed
`min(plan expiry, policy TTL)`. The clock is trusted and constructor
injected; callers can never submit `now`, `granted_at` or expiry overrides
as authority. The expiry boundary is inclusive (`now >= expires_at` is
expired), matching `isExecutionPlanExpired`.

## Plan store (honest V1 limits)

`AuthorizationStore` is a bounded (default 200) in-memory, server-owned
store. This is documented honestly: after a Brain Server restart, pending
and ready authorization records no longer exist and every plan must be
re-materialized and re-approved (fail closed). There is no persistent
authorization claim in this lane; the native replay ledger is persisted by
Lane B. A full store rejects new records with `APPROVAL_STORE_FULL` rather
than silently evicting a pending approval; duplicate plan ids are
`APPROVAL_STORE_CONFLICT`.

## Read-only flow

The five CP4 read capabilities (`github.repo.inspect`, `github.issue.search`,
`github.issue.read`, `github.pr.read`, `github.pr.checks.read`) keep
`required_approval=false`: after CP6 evidence materialization they become
`state=ready` with no `ApprovalReference`.

## Synthetic write capabilities (test-only)

- `test.resource.update` - reversible_write, medium, L2, verification +
  rollback capability bound
- `test.resource.destroy` - destructive_write, high, L3
- `test.resource.read` / `test.resource.rollback` - supporting read caps

No production GitHub write capability was added.

## No process execution

No runtime code in this lane uses `child_process`, `spawn`, `exec`,
`execFile`, `Command::new`, `powershell`, `cmd.exe` or `sh -c`. The lane
calls no Broker and no `gh`. Only deterministic fake verifiers exist in
tests.

## Tests

- `goal24-approval-policy.test.ts` (33): V1 policy matrix (all side-effect /
  risk / authority combinations), server-derived risk snapshot, authority
  ordering, expiry bounds and clamping, inclusive expiry boundary, strict
  caller-boundary rejections for every authority key, reserved input keys,
  actor kinds/source enforcement, binding payload shape (no state/approval),
  digest determinism, key-order invariance, non-JSON-safe rejection,
  per-field mutation sensitivity, approval request record strictness,
  server plan id generation.
- `goal24-authorization-service.test.ts` (48): read-only -> ready without
  approval; all five CP4 reads stay approval-free; write -> awaiting_approval;
  caller forced approvals/risk/state/approval/coverage/plan_id rejected;
  forged guard_run_id cannot materialize; bare reference cannot ready;
  verified native grant can ready; wrong plan id / binding digest rejected;
  L1 vs L2 rejected, L2 vs L2 accepted, L2 vs L3 rejected, L3 owner accepted;
  expired grant rejected; future granted_at rejected; grant past policy cap
  rejected; stale policy version rejected; runtime policy change fails old
  pending grants closed; denied / revoked / expired never ready; input /
  coverage / risk / adapter / timeout / verification-plan / rollback-plan /
  decision / expiry mutations all invalidate the binding digest; bounded
  store fail-closed; expiry sweep transitions; caller expiry clamp.

## Verification gates

- `npx tsc --noEmit` - PASS
- `npx vitest run` - PASS (56 files, 1038 passed, 0 failed; 81 new CP7 tests)
- build (`tsc` emit) - PASS
- lint - PASS (0 errors; only pre-existing warnings outside `src/approval`;
  `eslint src/approval` is clean)
- `git diff --check` - PASS
- static no-execution scan of `brain-server/src/approval` - PASS
- `npm audit` - not run; no dependency changes

## Known limitations

- The grant verifier is Lane A injected; native approval validation is wired
  in Lane B, and CP9 owns the approval UI.
- The authorization store is memory-only: Brain restart invalidates all
  pending/ready authorization records (fail closed, documented, not
  persistent). The native replay ledger is a Lane B concern.
- Plan expiry is uniformly bounded by the 15-minute V1 TTL; long-running
  approvals need an explicit future policy change.
- `verification_plan` / `rollback_plan` are caller-supplied semantic plans;
  they are validated against the capability declaration and bound into the
  digest, so mutations invalidate approvals, but their content correctness is
  verified at outcome-verification time (Checkpoint 8).
- No production write capability exists yet; the write path is exercised with
  test-only capabilities.

## CP7 does not use LLMs to approve

Approval authority lives solely in explicit owner/admin decisions validated
through the native grant verifier. No LLM, Skill, Evidence Provider or
system path can auto-grant a write or elevated action in V1.