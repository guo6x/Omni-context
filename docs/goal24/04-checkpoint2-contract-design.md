# Goal24 Checkpoint 2 — Capability / Skill / ExecutionPlan Contract Design

Date: 2026-08-12
Status: CHECKPOINT_2_CONTRACTS (schema + validation + contract tests; no runtime)

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
`risk_level`, `reversible`, `side_effect_class`, `required_evidence_classes`,
`verification_capability` (required for writes), `rollback_capability` (optional).

Rules:

- `id` must match `provider.resource.action` (3-5 lowercase dot-separated
  segments) and must not start with a reserved transport prefix
  (`cli`, `mcp`, `api`, `http`, `transport`, `shell`, `exec`, `cmd`).
- `version` is the capability semantic version (semver). Adapter
  implementation versions are a separate concern.
- `required_evidence_classes` are unique.
- `rollback_capability` requires `reversible=true` and must reference a
  different capability id.
- `side_effect_class=read_only` requires `risk_level=low` and forbids a
  rollback capability.
- Non-read-only capabilities must declare `verification_capability` (read-back
  verification is required for every write).

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
(`present | missing | stale | conflicted | unverified`), `evidence_ids`
(unique), `checked_at`, optional `stale_since`, `conflict_evidence_ids`,
`note`.

`EvidenceCoverageSnapshot`: entries unique by `evidence_class`.

`assessEvidenceCoverage(requirements, coverage)` is pure contract logic used
by the future guard: an entry is satisfied only when status is `present`.

## Risk snapshot

`RiskSnapshot`: `risk_level`, `reversible`, `side_effect_class`,
`required_authority`, optional `capability_version`.

The snapshot is captured at plan creation and must equal the referenced
capability declaration; `validateExecutionPlanAgainstCapabilities` enforces
this so an adapter can never silently re-derive risk at execution time.

## Approval reference

`ApprovalReference`: `approval_id`, `plan_id`, `granted_by`,
`granted_at`, `token`, optional `policy_version`.

Schema only. Enforcement (token verification, cryptography) is a later
checkpoint. `ExecutionPlan.required_approval=true` plans must carry
`approval_token` before entering an executable state.

## ExecutionPlan

The only formal handoff between Decision / Evidence / Approval and Adapter
execution.

Fields: `plan_id`, `decision_id`, `capability_id`, `capability_version`,
`adapter_id`, `normalized_inputs`, `required_approval`,
`approval_token`, `risk_snapshot`, `evidence_coverage_snapshot`,
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
  executable states require `approval_token` when `required_approval=true`.
- Read-only plans must not carry `rollback_plan`; any `rollback_plan`
  requires `risk_snapshot.reversible=true`; write plans must carry a
  `verification_plan`.
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
