# Goal24 Checkpoint 2.1 — Contract Hardening + Pre-Execution Security Triage

Date: 2026-08-12
Status: CHECKPOINT_2_1_HARDENING (schema + validation + contract tests; no runtime)
Base: `3a737f2f4439162814fa0165bf3f7058c984aafe` (Goal24 Checkpoint 2 final)

This is the independent-review hardening round for the Checkpoint 2 contracts.
It is NOT a redesign: the transport-independent capability / skill / execution
plan model is preserved. Every change below tightens machine-verifiable
safety boundaries that the initial Checkpoint 2 review found underspecified.

Lineage:

```
Checkpoint 2 initial contract
  -> independent review (this round)
  -> Checkpoint 2.1 hardening
```

No CLI process execution, no GitHub adapter, no Skill Registry runtime, no
Evidence Surface Guard runtime, no Approval Engine runtime and no Tauri
broker were added. Checkpoint 3 remains the process-execution checkpoint.

## 1. Findings fixed

### Blocker A — evidence status invariants (closed)

`EvidenceCoverageEntry` now enforces status-specific invariants in the
schema (`superRefine`), so `status=present` with `evidence_ids=[]` can no
longer pass:

- `present` — >= 1 evidence id; no `conflict_evidence_ids`; no `stale_since`.
- `missing` — empty `evidence_ids`; no conflict ids; no `stale_since`.
- `stale` — >= 1 evidence id; `stale_since` required.
- `conflicted` — >= 1 evidence id; >= 1 conflict id; the two sets must be
  disjoint.
- `unverified` — >= 1 evidence id.

A mandatory evidence class therefore can never be satisfied by
`status=present + zero evidence`. Negative tests pin each invariant
(`rejects present with zero evidence ids (bypass closed)`, `rejects missing
with non-empty evidence ids`, `rejects stale without stale_since`, `rejects
conflicted without conflict ids`, `rejects conflicted with overlapping
evidence ids`).

### Blocker B — capability carries real evidence policy (closed)

`CapabilityDefinition.required_evidence_classes: string[]` is replaced by
the canonical `required_evidence: EvidenceRequirement[]` (full policy:
`class_id`, `mandatory`, `freshness_policy`, `conflict_policy`,
`verification_requirement`). There is exactly one safety source per
capability; the legacy field is rejected as an unknown key so no second,
possibly-conflicting source can exist. Simple read capabilities use
`required_evidence: []`.

Skill-level evidence can strengthen capability evidence but can never weaken
it (see section 7).

### Blocker C — coverage assessment respects policy (closed)

`assessEvidenceCoverage` is now policy-aware (still a pure contract
function; no retrieval):

- `verified` requirements cannot be satisfied by `asserted` or `none`
  evidence (ranked: `none < asserted < verified`).
- `conflict_policy=reject` is never satisfied by `conflicted` status.
- `conflict_policy=warn` tolerates `conflicted` but returns a non-silent
  warning.
- `stale` never satisfies; `unverified` satisfies only when no verification
  requirement exists.
- Output extended with `blocking_reasons` and `warnings`; `mandatory_satisfied`
  is derived from the same policy-aware path.

### Blocker D — verification / rollback binding (closed)

`validateExecutionPlanAgainstCapabilities` now enforces:

- `plan.verification_plan.verification_capability_id` must equal
  `capability.verification_capability`; a plan cannot invent verification
  when the capability declares none.
- `plan.rollback_plan.rollback_capability_id` must equal
  `capability.rollback_capability`; a plan cannot attach a rollback plan to
  a non-reversible capability or one without a rollback capability.
- Referential integrity: the verification / rollback target capability must
  exist in the injected registry lookup (existence check only, no execution).

### JSON wire safety (closed)

New reusable `brain-server/src/contracts/json-safe.ts` exports
`JsonValueSchema` / `JsonObjectSchema` that accept only `null`, boolean,
finite number, string, arrays and plain objects, with explicit cycle
detection. Rejected: `undefined`, `BigInt`, `Date`, `Map`, `Set`, function,
symbol, class instances, non-finite numbers, circular objects.

Applied to `ExecutionPlan.normalized_inputs`,
`VerificationPlan.verification_inputs`, `RollbackPlan.rollback_inputs` and
`CapabilityDefinition.input_schema`. `input_schema` is documented as a
JSON-compatible schema descriptor — not an over-claimed full JSON Schema
validator.

### Command-key security claim (closed)

The boundary is documented accurately: reserved top-level input keys
(`shell`, `command`, `exec`, `bash`, `powershell`, `cmd`, `cmdline`,
`script`) are rejected in `normalized_inputs`, while semantic TEXT that
mentions commands (e.g. an issue body "the command failed on Windows")
remains valid string data. There is no machine-executable shell field in any
contract; adapters construct argv from `capability_id` + `normalized_inputs`
only. No generic arbitrary-shell capability can be expressed.

### Risk snapshot hardening (closed)

`RiskSnapshot.capability_version` is now required, and
`validateExecutionPlanAgainstCapabilities` enforces the version chain:

```
risk_snapshot.capability_version == plan.capability_version == capability.version
```

Risk-snapshot fields must equal the capability declaration
(`risk_level`, `reversible`, `side_effect_class`, `required_authority`).
Mismatch tests added.

### Side-effect / reversibility consistency (closed)

Schema-level consistency enforced in both `CapabilityDefinition` and
`RiskSnapshot`:

- `read_only` -> `reversible=false`, no rollback capability, `risk_level=low`.
- `reversible_write` -> `reversible=true`.
- `destructive_write` -> `reversible=false`.
- `external_effect` -> reversibility is capability-specific and must be
  declared explicitly; the contract does not force it either way.

Plan-level: `read_only` plans must not carry `rollback_plan`; any
`rollback_plan` requires `risk_snapshot.reversible=true`.

### Execution plan expiry (closed)

`expires_at > created_at` is enforced in the schema. A deterministic helper
`isExecutionPlanExpired(plan, now)` takes an injected `now` (no global
`Date.now()` inside), enabling reproducible tests. The Checkpoint 3 broker
must call it before spawning any process.

### Approval contract cleanup (closed)

`ExecutionPlan.approval_token` is replaced by
`approval: ApprovalReference | null`:

```
ApprovalReference {
  approval_id, plan_id, granted_by, granted_at,
  policy_version, token_reference, token_digest
}
```

No raw token travels on the plan. `token_digest` is a placeholder — real
digest computation and token validation are Checkpoint 7 concerns; no
cryptography is implemented here. State gating:

- `required_approval=true` plans in `ready | executing | succeeded | failed`
  must carry an approval reference (auditability after execution).
- Pre-approval states (`draft | awaiting_approval | blocked | cancelled`)
  must not carry one.
- `approval.plan_id` must equal `plan.plan_id`.
- `approval` must be null when `required_approval=false`.

### Skill safety inheritance (closed)

New pure validator `validateSkillManifestAgainstCapabilities(manifest,
lookup)`:

- every referenced capability must exist;
- skill `risk` must be >= the highest risk of referenced capabilities;
- skill evidence cannot weaken capability mandatory evidence (drop class,
  demote to optional, downgrade `verified` -> `asserted/none`, downgrade
  `conflict_policy=reject`, relax or drop `freshness_policy`);
- skill requirements may only strengthen capability requirements.

### Freshness policy range (closed)

The arbitrary 7-day `max_age_ms` cap is removed. Omni-Context is a
long-lived context system; evidence can legitimately outlive 7 days.
`max_age_ms` is now bounded only by positive integers up to
`Number.MAX_SAFE_INTEGER`. Rationale recorded in code and docs.

## 2. Contract breaking changes (vs Checkpoint 2)

1. `CapabilityDefinition.required_evidence_classes: string[]` ->
   `required_evidence: EvidenceRequirement[]` (canonical policy source;
   legacy field rejected).
2. `ExecutionPlan.approval_token: string` -> `approval: ApprovalReference |
   null` (audit-shaped record; no raw token on wire).
3. `RiskSnapshot.capability_version` optional -> required.
4. `EvidenceCoverageEntry.verification_level` added (required; the coverage
   assessment needs it to honor `verification_requirement`).
5. `CoverageAssessment` output extended with `verification_level` per entry,
   `blocking_reasons`, `warnings`.
6. `input_schema` constrained from `z.record(z.unknown())` to a JSON-safe
   plain-object schema (Date/BigInt/function/cycles rejected).
7. Freshness cap: 7 days -> `Number.MAX_SAFE_INTEGER`.

## 3. Migration note

No production Capability Registry, Skill Registry or persisted ExecutionPlan
store exists yet (all are later checkpoints), so there are no production
persisted records to migrate. The only consumers are the contract tests.
Future registry/plan persistence must use the 2.1 shapes:

- capabilities declare `required_evidence` (never `required_evidence_classes`);
- plans carry `approval` (never `approval_token`);
- coverage entries always include `verification_level`;
- risk snapshots always include `capability_version`.

## 4. Security dependency triage (pre-execution)

Ran `npm audit --omit=dev --audit-level=critical --json` for `brain-server`
and `mobile-app`. Raw machine-readable results are preserved at:

- `docs/goal24/audit-brain-server-critical.json`
- `docs/goal24/audit-mobile-app-critical.json`

Summary: `docs/goal24/checkpoint2-1-security-triage.json`.

- brain-server: 1 critical (tar 1123940, npm-install-time only), 8 high
  (ip-address, fast-uri, undici, sharp, brace-expansion, glob CLI, xlsx),
  12 moderate, 3 low.
- mobile-app: 1 critical (tar 1123940 via Expo toolchain), 28 high
  (Expo/React Native toolchain), 15 moderate, 2 low. Mobile is not on the
  Goal24 execution path.
- Rust/Tauri: `cargo audit` / `cargo deny` are not installed locally and are
  not configured in repository CI -> `NOT RUN / TOOL_UNAVAILABLE`.

No `npm audit fix` was run (owner instruction). MCP/API-surface advisories
with available patches (ip-address, fast-uri, hono, @hono/node-server) are
classified `FIX_BEFORE_CHECKPOINT3`; build-time / non-Goal24 chains are
`NOT_ON_EXECUTION_PATH` or `ACCEPTED_TEMPORARY_RISK` with rationale.

## 5. CHECKPOINT3_SECURITY_GATE

`PASS`

- brain-server critical explained to package/advisory (tar 1123940) and is
  not on the Goal24 execution path.
- No UNKNOWN critical risk affects the future broker.
- All contract blockers closed and machine-tested.
- Gate does not start Checkpoint 3; it only clears the pre-execution gate.

## 6. Verification run

- brain-server typecheck (`tsc --noEmit`): PASS
- brain-server full vitest: 462 PASS (41 files), incl. 118 contract tests
- brain-server build (`tsc`): PASS
- eslint on new/changed modules: 0 errors (remaining warnings are
  intentional `_unused` destructuring in tests)
- `git diff --check`: PASS
- MCP behavior: unchanged (no MCP files touched)
- Decision Kernel behavior: unchanged
- No process execution / CLI runtime / GitHub adapter / Registry runtime /
  Approval Engine runtime / Evidence retrieval runtime added
- Holdback: untouched
- Scientific artifacts: untouched

## 7. Files

Added:

- `brain-server/src/contracts/json-safe.ts`
- `docs/goal24/05-checkpoint2-1-contract-hardening.md`
- `docs/goal24/checkpoint2-1-security-triage.json`
- `docs/goal24/checkpoint2-1-manifest.json`
- `docs/goal24/audit-brain-server-critical.json`
- `docs/goal24/audit-mobile-app-critical.json`

Modified:

- `brain-server/src/capabilities/contracts.ts`
- `brain-server/src/skills/contracts.ts`
- `brain-server/src/execution/contracts.ts`
- `brain-server/tests/goal24-capability-contracts.test.ts`
- `brain-server/tests/goal24-execution-contracts.test.ts`
- `docs/goal24/04-checkpoint2-contract-design.md` (2.1 corrections only)
