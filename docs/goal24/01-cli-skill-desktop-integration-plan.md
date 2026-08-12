# Goal24 — CLI/Skill-First + Desktop Integration Plan

Date: 2026-08-12
Status: DESIGN BASELINE

## Product rule

Omni-Context is not an MCP-centric product. MCP, CLI, native API, and local tools are execution adapters beneath the decision-control layer.

Canonical stack:

`Memory -> Evidence Qualification -> Evidence Coverage -> Decision Kernel -> Approval -> ExecutionPlan -> Adapter -> Outcome -> Revisit`

## Responsibility split

### Brain Server — decides why/what

Owns:

- Skill Registry
- Capability Registry
- evidence requirements
- temporal/provenance qualification
- Evidence Coverage Guard
- Decision Kernel
- authority/risk/reversibility policy
- approval requirements
- ExecutionPlan creation
- outcome persistence
- revisit/revise/reverse/invalidate lifecycle

Brain Server must not embed arbitrary shell commands inside decision logic.

### Tauri desktop native layer — executes locally

The existing desktop is Next.js + Tauri and already owns local-native capabilities including screen capture, clipboard, global shortcuts, Brain Server lifecycle, local tokens, pairing, foreground-window inspection, and MCP client installation/status.

Goal24 extends this native layer into a **Local Execution Broker** responsible for:

- executable discovery
- process spawn
- argument-array execution (no shell-string concatenation by default)
- cwd isolation
- environment allowlist
- timeout/cancellation
- stdout/stderr capture
- exit code
- output-size limits
- capability-to-command binding verification
- approval-token verification for gated actions
- audit event emission

The Tauri broker must execute only a previously approved `ExecutionPlan`; it must not independently choose capabilities or reinterpret user intent.

### Desktop UI — makes control visible

New product surfaces should be additive and staged:

1. **Connections / Adapters**
   - GitHub CLI / API / MCP status
   - installed executable/version
   - available capabilities

2. **Skills**
   - installed skill
   - provided capabilities
   - prerequisites
   - required evidence classes
   - risk/reversibility
   - verification/rollback support

3. **Approvals**
   - pending action
   - reason for approval
   - evidence summary
   - side effects
   - reversible/non-reversible status

4. **Activity / Decisions**
   - DECIDE / CLARIFY / DEFER / BLOCK
   - missing evidence
   - selected skill/capability
   - adapter used
   - execution result
   - read-back verification
   - resulting outcome/revisit link

MCP-specific UI should gradually move under the broader `Connections / Adapters` concept rather than remain the product center.

## Core contracts to add

### Capability

Transport-independent semantic action, e.g. `github.issue.create`, `github.pr.merge`, `notion.page.update`.

Minimum fields:

- `id`
- `version`
- `input_schema`
- `required_authority`
- `risk_level`
- `reversible`
- `side_effect_class`
- `required_evidence_classes`
- `verification_capability`
- `rollback_capability` (optional)

### Skill Manifest

A skill teaches procedure, not transport.

Minimum fields:

- `name`
- `version`
- `capabilities`
- `prerequisites`
- `required_evidence`
- `procedure`
- `risk`
- `verification`
- `rollback`
- `adapter_preference: any | cli | api | mcp | local`

`SKILL.md` may contain procedural instructions, but enforceable safety/authority/evidence fields must be machine-readable and validated.

### ExecutionPlan

Produced only after evidence + decision + approval policy.

Minimum fields:

- `plan_id`
- `decision_id`
- `capability_id`
- `adapter_id`
- `normalized_inputs`
- `required_approval`
- `approval_token` when applicable
- `risk_snapshot`
- `evidence_coverage_snapshot`
- `timeout_ms`
- `verification_plan`
- `rollback_plan` when available

## Evidence Surface Guard

Before any write/destructive capability is eligible for execution:

1. resolve the capability's declared required evidence classes;
2. map retrieved evidence to those classes;
3. distinguish `present`, `missing`, `stale`, `conflicted`, and `unverified`;
4. block DECIDE-to-EXECUTE transition if mandatory evidence is not qualified;
5. route to `retrieve_more`, `clarify`, or `defer` rather than silently treating the visible subset as complete.

This is a product guardrail, not a claim that the frozen scientific UDR result has been repaired.

## First vertical slice: GitHub CLI

Use GitHub as the first adapter because the host environment can run `gh` and the action space provides clear read/write/verification examples.

Initial capabilities:

Read-only:
- `github.repo.inspect`
- `github.issue.search`
- `github.issue.read`
- `github.pr.read`
- `github.pr.checks.read`

Low-risk writes:
- `github.issue.create`
- `github.issue.comment`

Gated writes:
- `github.issue.close`
- `github.pr.merge`

For every write, perform read-back verification.

## Checkpoints

1. Architecture baseline audit
2. Capability Contract
3. Tauri CLI Execution Broker
4. GitHub CLI Adapter
5. Skill Registry V1
6. Evidence Coverage Contract / Guard
7. Approval + risk enforcement
8. Outcome read-back verification
9. End-to-end desktop demo
10. Regression/security/package freeze

## Non-goals for the first slice

- no generic unrestricted shell agent;
- no arbitrary command strings from LLM output;
- no mass skill marketplace;
- no MCP removal;
- no rewrite of Decision Kernel;
- no scientific benchmark rerun;
- no Holdback access;
- no `main` migration until Goal24 is independently verified.
