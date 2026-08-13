# Goal24 Checkpoint 6 — Lane B: Evidence Surface Guard Control Runtime

- Lane: `B — EVIDENCE GUARD`
- Base SHA: `09147b16a284fafa3ec922c6159ac4f2c26084c4` (`origin/dev/goal24-cli-skills`)
- Status: `LANE_B_COMPLETE`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp6-evidence-guard`
- Local branch: `local/cp6-evidence-guard` (no push)

## Scope

When evidence coverage already exists, the system needs a deterministic
answer to "what next?". This lane implements that control runtime with five
canonical actions:

```
PROCEED | RETRIEVE_MORE | CLARIFY | DEFER | BLOCK
```

Out of scope for Lane B: raw Evidence Candidate, Evidence Provider Registry,
qualification engine, GitHub provider, Decision Kernel rewrite, Execution,
and Approval.

## Files owned by this lane

- `brain-server/src/evidence/guard-types.ts`
- `brain-server/src/evidence/guard-policy.ts`
- `brain-server/src/evidence/guard.ts`
- `brain-server/tests/goal24-evidence-guard.test.ts`
- `docs/goal24/cp6-lane-b-evidence-guard.md`
- `docs/goal24/checkpoint6-lane-b-manifest.json`

Lane A files (`brain-server/src/evidence/model.ts`, `provider.ts`,
`provider-registry.ts`, `qualification.ts`, `coverage-builder.ts`) are
untouched.

## Existing contracts only

The guard consumes the existing contracts verbatim and redefines nothing:

- `EvidenceRequirement` from `capabilities/contracts.ts`
- `EvidenceCoverageSnapshot`, `CoverageAssessment`, and
  `assessEvidenceCoverage()` from `execution/contracts.ts`

`assessEvidenceCoverage()` is the single source of truth for whether
mandatory evidence is missing / stale / unverified / conflicted / satisfied.
The guard only maps that assessment (plus structured provider outcomes) to
a control action.

## Five guard actions

| Action | Meaning |
| --- | --- |
| `proceed` | EVIDENCE GATE CLEARED only. Not approved, not executed, not "ready to spawn a process". |
| `retrieve_more` | At least one unsatisfied mandatory class still has a structured retrieval path and budget remains. |
| `clarify` | Mandatory evidence depends on user input, and only when a provider outcome explicitly says `user_context_required`. |
| `defer` | Mandatory evidence is transiently unavailable (timeout / rate-limit-style provider state) with no immediately usable alternative. Never degrades into proceed. |
| `block` | Hard gap: permanent unavailability, provider integrity failure, persistent conflict/unverified, or retrieval exhausted with an unresolved mandatory gap. |

## Action precedence (deterministic)

1. Coverage regression → `block` (fail closed, checked every round).
2. Assessment satisfied → `proceed`. Optional evidence can never downgrade
   this decision.
3. Budget remains and a structured outcome marks a class retryable →
   `retrieve_more`, requesting only the unsatisfied mandatory classes.
4. Exhausted stage: hard gap (`block`) > user context (`clarify`) >
   temporary-only unavailability (`defer`).

Mixed failures never let a lighter outcome mask a serious one: a hard block
reason always wins at the exhausted stage.

## Retrieval bounds

- `max_retrieval_rounds` is required and must be an integer in `0..10`;
  there is no unbounded retrieve loop.
- `per_round_timeout_ms` is required and bounded to `100..86_400_000` ms
  (the existing `execution/contracts.ts` timeout bounds).
- `max_retrieval_rounds = 0` means no retrieval is attempted; the initial
  assessment alone decides the action.
- Each round requests only currently-unsatisfied mandatory classes; optional
  classes are never chased (no evidence over-fetch).
- The injected callback receives an `AbortSignal`. External abort yields a
  cancel-safe `defer` with `GUARD_ABORTED`; per-round timeout is recorded as
  `temporary_unavailable` and continued or deferred per policy.

## Collection callback abstraction

Lane A types are not imported. The guard injects a narrow callback:

```
collectCoverage({
  requirements,
  previousCoverage,
  requestedClasses,
  round,
  signal,
})
```

returning `{ coverage, outcomes }`. Integration later adapts the Lane A
provider runtime behind this seam.

## Provider outcome taxonomy

Structured metadata only; English error text is never parsed:

`collected`, `not_found`, `temporary_unavailable`,
`permanent_unavailable`, `user_context_required`, `provider_error`,
`collection_limit_exceeded`.

When no structured retry signal exists the guard never fantasizes a
provider: an unattempted class is retrievable once, and after an attempt
without a retryable outcome it becomes a hard gap (fail closed).

## Optional evidence semantics

Optional evidence can never change a `proceed` into `retrieve_more`,
`clarify`, `defer`, or `block`. Optional gaps only surface as `warnings`
and `non_blocking_findings`. Dedicated tests cover optional missing / stale
/ unverified.

## Coverage regression

A mandatory class that was satisfied in the previous assessment and is then
silently deleted, marked `missing`, or verification-downgraded while still
`present` fails closed with `COVERAGE_REGRESSION` → `block`. An explicit
move to `stale` / `conflicted` / `unverified` (every coverage entry carries
`checked_at`) is an allowed degradation and is refreshed through
`retrieve_more`.

## Stale / conflict / unverified handling

- Mandatory stale: refresh path → `retrieve_more`; refreshed → `proceed`;
  refresh temporarily unavailable → `defer`; permanently impossible →
  `block`.
- Conflict policy is not reimplemented. `assessEvidenceCoverage()` already
  applies reject / warn / allow, so a warn-policy conflict with sufficient
  verification proceeds.
- Mandatory unverified with a stronger or alternate provider →
  `retrieve_more`; no provider or exhausted → `block`. `verification=none`
  never lets an unsatisfied `unverified` class pass.

## Boundaries

- **Decision Kernel**: untouched. Helper `evidenceGateCleared(result)` is
  true only for `action === 'proceed'`. The guard never generates a ready
  `ExecutionPlan`.
- **Approval**: untouched. `proceed` only clears the evidence gate; if the
  capability requires approval, CP7 must still run. No `ApprovalReference`
  is created and the CP3 fail-closed broker behavior is not relaxed.
- **Execution**: 0 process execution. No Tauri Broker, no `gh`, no skill
  execution, no shell.
- **No LLM action choice**: the guard is deterministic. No model call, no
  prompt, no model-chosen proceed/block. The guard is not another agent.

## Synthetic evidence-surface omission regression (core product test)

A capability requires mandatory class A and mandatory class B. The
collector keeps returning only strong, fresh, verified coverage for class A
and never returns class B. The guard must **never** `proceed`: it issues
`retrieve_more` for class B each round and then finalizes as `block` /
`defer` / `clarify` depending on the structured provider outcome. This is a
dedicated regression test and must not be weakened.

## Reason codes

`EVIDENCE_SATISFIED`, `EVIDENCE_MISSING`, `EVIDENCE_STALE`,
`EVIDENCE_UNVERIFIED`, `EVIDENCE_CONFLICT`, `RETRIEVAL_AVAILABLE`,
`RETRIEVAL_EXHAUSTED`, `USER_CONTEXT_REQUIRED`,
`PROVIDER_TEMPORARY_UNAVAILABLE`, `PROVIDER_PERMANENT_UNAVAILABLE`,
`PROVIDER_ERROR`, `COLLECTION_LIMIT_EXCEEDED`, `COVERAGE_REGRESSION`,
plus `GUARD_ABORTED` for cancel safety.

## Trace

Every run returns a deterministic audit trace: `round`, `checked_at` from
coverage, requested classes, assessment summary, chosen action, and reason
codes. Raw evidence payloads and credentials are never persisted or
returned in the result.

## Validation

- `npm run typecheck` — PASS
- full `vitest` — PASS (48 files, 804 tests; lane file has 41 tests)
- `npm run build` — PASS
- `npm run lint` — PASS (0 errors in lane files)
- `git diff --check` — PASS