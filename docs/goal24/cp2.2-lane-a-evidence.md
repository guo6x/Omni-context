# Goal24 Checkpoint 2.2 — Lane A: Evidence Fail-Closed Semantics

## Identity

- **lane**: A — Evidence / Contract safety semantics
- **branch**: `local/cp2.2-evidence-semantics` (local-only, never pushed)
- **worktree**: `D:\ai_code\Omni-context-worktrees\cp2.2-evidence`
- **base_sha**: `2cc35b5eed48c780ad4c1b7ef1de1bd793c6f2d4`
- **commit_sha**: `0fc4b949abe0443fdfcb25c2e5f95d6264c73f50` (fix commit; this report is a follow-up docs commit)

## Files changed

- `brain-server/src/capabilities/contracts.ts` — added canonical `effectiveConflictPolicy` helper.
- `brain-server/src/execution/contracts.ts` — fail-closed `assessEvidenceCoverage`; added `CoverageAssessment.non_blocking_findings`; validator behavior unchanged in shape (it already gates executable states on `mandatory_satisfied`).
- `brain-server/tests/goal24-execution-contracts.test.ts` — new fail-closed coverage assessment describe plus validator-level unverified/draft cases.
- `brain-server/tests/goal24-capability-contracts.test.ts` — new `effectiveConflictPolicy` default-policy tests.
- `docs/goal24/cp2.2-lane-a-evidence.md` — this report.

No other files were modified. No `package.json`/`package-lock.json`, no `desktop-daemon/`, no `Cargo.*`, no CI, no Holdback, no scientific artifacts.

## Semantics before

- `status=unverified` satisfied a requirement when `verification_requirement` was undefined or `none` — even for `mandatory=true`. (Checkpoint 2.1 independent review finding.)
- `status=conflicted` with an undeclared `conflict_policy` fell through to the "not reject" branch and could be satisfied (and produced no warning), effectively defaulting to `allow`.
- Optional evidence with `missing`/`stale`/`unverified`/`conflicted` statuses pushed reasons into `blocking_reasons`, even though it never flips `mandatory_satisfied`.

## Semantics after (fail-closed)

- `missing`, `stale`, and `unverified` NEVER satisfy a requirement. In particular, `status=unverified` + `mandatory=true` blocks even when `verification_requirement` is undefined or explicitly `none`.
- `conflicted` + mandatory requirement:
  - `conflict_policy` undefined → default `reject` → BLOCK.
  - `conflict_policy=reject` → BLOCK.
  - `conflict_policy=warn` → satisfied (verification met) + explicit warning.
  - `conflict_policy=allow` → satisfied (verification met).
- The default is defined exactly once: `effectiveConflictPolicy(requirement) = requirement.conflict_policy ?? 'reject'`, exported from `capabilities/contracts.ts` next to `EvidenceRequirementSchema`. All policy consumers (Execution validator now; Evidence Guard later) use the same helper. The schema keeps `conflict_policy` optional, so wire serialization is unchanged and never implies a serialized default.
- `present` continues to satisfy according to `verification_requirement` (e.g. `present` + `asserted` satisfies `none`; `present` + `asserted` cannot satisfy `verified`).
- Optional evidence never contributes to `blocking_reasons` and never flips `mandatory_satisfied`. Its findings land in the new `CoverageAssessment.non_blocking_findings` (or in `warnings` when `conflict_policy=warn` tolerates the conflict). **OPTIONAL EVIDENCE CAN BLOCK EXECUTION = NO.**
- `validateExecutionPlanAgainstCapabilities` gates executable states (`ready`, `executing`) on `mandatory_satisfied`; draft and other pre-approval states keep their existing non-execution-gate semantics (verified by tests).

## Tests

- `brain-server typecheck` (`tsc --noEmit`): PASS
- `brain-server vitest` full suite: PASS — 41 files / 479 tests
  - `goal24-execution-contracts.test.ts`: 87 tests PASS (was 72 at base; +15 fail-closed/validator cases)
  - `goal24-capability-contracts.test.ts`: 48 tests PASS (was 45 at base; +3 default-policy cases)
- Required 12 semantics: all covered and passing
  1. mandatory unverified + `verification_requirement` undefined → BLOCK
  2. mandatory unverified + `verification_requirement=none` → BLOCK
  3. mandatory conflicted + `conflict_policy` undefined → BLOCK
  4. mandatory conflicted + `reject` → BLOCK
  5. mandatory conflicted + `warn` → satisfied + warning
  6. mandatory conflicted + `allow` → satisfied
  7. optional missing → `mandatory_satisfied` unaffected
  8. optional stale → not in `blocking_reasons`
  9. optional unverified → no block
  10. optional conflicted → no block of mandatory gate
  11. present asserted + `verification_requirement=none` → satisfied
  12. present asserted + `verification_requirement=verified` → BLOCK
- `git diff --check`: PASS

## Scope compliance

- PROCESS_EXECUTION_ADDED: NO
- HOLDBACK_TOUCHED: NO
- REMOTE_BRANCH_PUSHED: NO
- Worktree intentionally left in place (clean) for Integration AI cherry-pick/merge.