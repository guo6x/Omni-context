# Goal24 Checkpoint 2 — Capability / Skill / ExecutionPlan Contract Design

Date: 2026-08-12
Status: CHECKPOINT_2_CONTRACTS (schema + validation + contract tests; no runtime)

History: Checkpoint 2 initial contract -> independent review -> Checkpoint
2.1 hardening (`docs/goal24/05-checkpoint2-1-contract-hardening.md`). The 2.1
corrections below are the only places this document differs from the
original Checkpoint 2 record; the original design is not rewritten.

This checkpoint implements transport-independent contracts only. It adds no
CLI process execution, no GitHub adapter, no Skill Registry runtime, no
Evidence Surface Guard runtime, no Approval Engine and no Tauri broker.

## Design authority

- `docs/goal24/GOAL24_SCOPE_FREEZE.json`
- `docs/goal24/01-cli-skill-desktop-integration-plan.md`
- `docs/goal24/02-checkpoint1-current-code-map.md`
- `docs/goal24/03-main-promotion-sync.md`

Canonical stack (unchanged):

`Memory -> Evidence Qualification -> Evidence Coverage -> Decision Kernel -> Approval -> ExecutionPlan -> Adapter -> Outcome -> Revisit`

MCP / CLI / API / Local are adapters below this layer, never core semantics.

## Contract modules

| Module | Contents |
|--------|----------|
| `brain-server/src/capabilities/contracts.ts` | `CapabilityDefinition`, `EvidenceRequirement`, authority/risk/side-effect enums, id/version patterns |
| `brain-server/src/skills/contracts.ts` | `SkillManifest`, `ProcedureStep`, adapter preference |
| `brain-server/src/execution/contracts.ts` | `ExecutionPlan`, `RiskSnapshot`, `EvidenceCoverageEntry/Snapshot`, `ApprovalReference`, `VerificationPlan`, `RollbackPlan`, coverage assessment, registry-bound validation |

## Capability

A capability is a semantic action ("what the system allows"), never a command
("how it is executed"). The contract cannot express shell strings.

Fields: `id`, `version`, `description`, `input_schema`, `required_authority`,
`risk_level`, `reversible`, `side_effect_class`, `required_evidence`
(canonical `EvidenceRequirement[]`; 2.1 hardening replaced the Checkpoint 2
`required_evidence_classes: string[]` so the capability's safety policy is
not lost - the legacy field is rejected as an unknown key),
`verification_capability` (required for writes), `rollback_capability` (optional).

Rules:

- `id` must match `provider.resource.action` (3-5 lowercase dot-separated
  segments) and must not start with a reserved transport prefix
  (`cli`, `mcp`, `api`, `http`, `transport`, `shell`, `exec`, `cmd`).
- `version` is the capability semantic version (semver). Adapter
  implementation versions are a separate concern.
- `required_evidence` is unique by `class_id` and carries the full policy
  (`mandatory`, `freshness_policy`, `conflict_policy`,
  `verification_requirement`). Simple read capabilities use `[]`.
- `rollback_capability` requires `reversible=true` and must reference a
  different capability id.
- `side_effect_class=read_only` requires `risk_level=low`,
  `reversible=false` and forbids a rollback capability.
- `reversible_write` requires `reversible=true`; `destructive_write`
  requires `reversible=false`; `external_effect` reversibility is
  capability-specific and must be declared explicitly (2.1).
- Non-read-only capabilities must declare `verification_capability` (read-back
  verification is required for every write).
- `input_schema` is a JSON-safe plain-object descriptor (2.1): Date, BigInt,
  function, symbol, class instances, non-finite numbers and circular
  objects are rejected; it is a JSON-compatible schema descriptor, not an
  over-claimed full JSON Schema validator.

Authority model (new; the repository previously had no capability-level
authority semantics — the API server has transport scopes only, which remain
orthogonal):

- `L0` - no special authority (safe reads)
- `L1` - trusted local actor (routine local writes)
- `L2` - elevated authority (gated writes with evidence requirements)
- `L3` - highest authority (destructive or external-impact actions)

Decision authority and execution authority are distinct concepts;
`required_authority` is the minimum execution authority. User override remains
highest priority but is a later-checkpoint runtime concern.

## Skill Manifest

A skill teaches procedure, not transport. The manifest carries the
machine-readable safety fields; an optional `SKILL.md` may carry
human/agent-readable instructions (no filesystem discovery in this
checkpoint).

Fields: `name`, `version`, `description`, `capabilities`,
`prerequisites`, `required_evidence`, `procedure`, `risk`,
`verification`, `rollback`, `adapter_preference`.

Rules:

- `capabilities` are unique and non-empty; procedure steps, verification and
  rollback references must point at declared capabilities.
- `procedure` is structured procedural knowledge (steps with optional
  capability references and notes). It is not an execution layer:
  `command`, `shell`, `exec` fields are rejected by the strict schema.
- `adapter_preference` is `any | cli | api | mcp | local` and is a
  preference only; it cannot change required authority, risk, evidence or
  reversibility.

## EvidenceRequirement

Machine schema: `class_id` (dotted identifier), `mandatory`, optional
`freshness_policy.max_age_ms`, optional `conflict_policy`
(`reject | warn | allow`), optional `verification_requirement`
(`none | asserted | verified`).

Retrieval and the Evidence Surface Guard runtime are later checkpoints.

## EvidenceCoverageSnapshot

`EvidenceCoverageEntry`: `evidence_class`, `status`
(`present | missing | stale | conflicted | unverified`), `verification_level`
(`none | asserted | verified`; required since 2.1), `evidence_ids` (unique),
`checked_at`, optional `stale_since`, `conflict_evidence_ids`, `note`.

Status-specific invariants (2.1, machine-enforced): `present` requires >= 1
evidence id and forbids conflict ids / `stale_since`; `missing` requires
empty ids and forbids conflict ids / `stale_since`; `stale` requires >= 1 id
and `stale_since`; `conflicted` requires >= 1 id, >= 1 conflict id and
disjoint sets; `unverified` requires >= 1 id.

`EvidenceCoverageSnapshot`: entries unique by `evidence_class`.

`assessEvidenceCoverage(requirements, coverage)` is pure contract logic used
by the future guard (2.1 policy-aware): `verified` requirements cannot be
satisfied by `asserted`/`none` evidence; `conflict_policy=reject` is never
satisfied by `conflicted` status; `conflict_policy=warn` tolerates
`conflicted` but returns a non-silent warning; `stale` never satisfies;
`unverified` satisfies only when no verification requirement exists. The
assessment reports `blocking_reasons` and `warnings`.

## Risk snapshot

`RiskSnapshot`: `risk_level`, `reversible`, `side_effect_class`,
`required_authority`, `capability_version` (required since 2.1).

The snapshot is captured at plan creation and must equal the referenced
capability declaration; `validateExecutionPlanAgainstCapabilities` enforces
this so an adapter can never silently re-derive risk at execution time. The
2.1 version chain is `risk_snapshot.capability_version ==`
`plan.capability_version == capability.version`.

## Approval reference

`ApprovalReference`: `approval_id`, `plan_id`, `granted_by`,
`granted_at`, `policy_version`, `token_reference`, `token_digest`.

2.1 hardening: the raw `approval_token` on the plan is replaced by
`ExecutionPlan.approval: ApprovalReference | null`. No raw token travels on
the wire; `token_digest` is a placeholder (real digest computation and token
verification are Checkpoint 7 concerns; no cryptography here). Completed
plans keep the reference for auditability. Schema only.

## ExecutionPlan

The only formal handoff between Decision / Evidence / Approval and Adapter
execution.

Fields: `plan_id`, `decision_id`, `capability_id`, `capability_version`,
`adapter_id`, `normalized_inputs`, `required_approval`,
`approval`, `risk_snapshot`, `evidence_coverage_snapshot`,
`timeout_ms`, `verification_plan`, `rollback_plan`, `state`,
`created_at`, optional `expires_at`, `correlation_id`, `requested_by`.

Rules:

- No shell strings: the schema is strict and also rejects reserved keys
  (`shell`, `command`, `exec`, `bash`, `powershell`, `cmd`, `cmdline`,
  `script`) inside `normalized_inputs`. Future adapters build argv from
  `capability_id` + `normalized_inputs` only.
- `adapter_id` is an implementation identity (e.g. `github-cli`) strictly
  separate from `capability_id`.
- `timeout_ms` is bounded (100 ms .. 24 h).
- State machine (contract only; executor state machine is a later
  checkpoint): `draft | awaiting_approval | ready | executing | succeeded |
  failed | blocked | cancelled`. Executable states: `ready`, `executing`.
- Approval: `awaiting_approval` requires `required_approval=true`;
  `ready | executing | succeeded | failed` states require an `approval`
  reference when `required_approval=true`; pre-approval states
  (`draft | awaiting_approval | blocked | cancelled`) must not carry one;
  `approval.plan_id` must equal `plan.plan_id` (2.1).
- Read-only plans must not carry `rollback_plan`; any `rollback_plan`
  requires `risk_snapshot.reversible=true`; write plans must carry a
  `verification_plan`.
- Verification / rollback binding (2.1): plan verification/rollback
  capability ids must equal the capability declaration and must exist in
  the registry lookup (referential integrity only).
- `normalized_inputs`, `verification_inputs` and `rollback_inputs` are
  JSON-safe (2.1); `expires_at` must be after `created_at`;
  `isExecutionPlanExpired(plan, now)` is a deterministic helper the future
  broker must call before spawning any process.
- `validateExecutionPlanAgainstCapabilities(plan, lookup)` checks capability
  existence, version match, risk-snapshot equality and mandatory evidence
  coverage for executable states. The registry lookup is injected because no
  Registry runtime exists yet.

## Security boundary

All contracts are strict Zod objects: unknown keys (including `shell`,
`command`, `exec`) are rejected at runtime, not only by TypeScript types.
Security-relevant rejection is covered by unit tests.

## What is contract-only vs runtime (later checkpoints)

| Item | This checkpoint | Runtime checkpoint |
|------|-----------------|--------------------|
| Capability / Skill / ExecutionPlan schemas | contract + validation | - |
| Skill Registry | - | Checkpoint 5 |
| Capability Registry | - | Checkpoint 5 (adapter-bound in 4) |
| Evidence Surface Guard | coverage assessment logic | Checkpoint 6 |
| Approval Engine | ApprovalReference schema + plan gating rules | Checkpoint 7 |
| CLI process execution / Tauri broker | - | Checkpoint 3 |
| GitHub adapter | - | Checkpoint 4 |
| Outcome read-back verification | VerificationPlan contract | Checkpoint 8 |

## Known pre-existing security debt (NOT fixed here)

Marked `KNOWN PRE-EXISTING SECURITY DEBT` (recorded by Goal23.5):

- `brain-server`: 1 critical npm advisory.
- `mobile-app`: 1 critical npm advisory.

Per owner instructions, no `npm audit fix` was run in this checkpoint.
Checkpoint 3 must perform a full dependency security triage before any real
local process execution is introduced.

## Non-blocking hygiene (recorded, not fixed)

- `README.md` / `README.zh-CN.md` reference `./LICENSE`, which does not
  exist in the repository. Adding a license file or changing the MIT
  declaration is an owner/legal choice and is intentionally out of scope.

## Verification run

- `brain-server` typecheck, unit tests (vitest), build, eslint: PASS
- `git diff --check`: PASS
- MCP behavior: unchanged (additive contracts only, no MCP files touched)
- Decision Kernel behavior: unchanged
- No arbitrary shell execution, no CLI runtime, no GitHub adapter, no
  Registry runtime added
- Holdback: untouched
- Scientific artifacts: untouched
