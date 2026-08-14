# Goal24 Checkpoint 8, Lane A - Brain Outcome Core + Trusted Verification Evaluation + Outcome Persistence

Date: 2026-08-14
Branch: `local/cp8-outcome-core`
Base: `01e1204d8d2a9b232b6745a96667a205841e6f60` (`origin/dev/goal24-cli-skills`, verified exact)
Worktree: `D:\ai_code\Omni-context-worktrees\cp8-outcome-core`

## Scope

This lane implements the Brain Server outcome core: outcome contracts, the
execution-vs-outcome semantic separation, the trusted Outcome Evaluator
Registry, deterministic structured observation evaluation, the outcome
lifecycle, the persistent Outcome Store V1 and revisit-signal derivation.

**In scope**

- `brain-server/src/outcome/contracts.ts` - execution effect states,
  verification statuses, trusted execution receipt, read-back observation
  envelope, outcome expectation, verification attempt, outcome record and
  store-file schemas (all strict)
- `brain-server/src/outcome/digests.ts` - canonical expectation / observation /
  receipt digests
- `brain-server/src/outcome/evaluator.ts` - `OutcomeEvaluatorV1` contract with
  fail-closed result parsing
- `brain-server/src/outcome/evaluator-registry.ts` - internal trusted registry
- `brain-server/src/outcome/lifecycle.ts` - pure status transitions, revisit /
  rollback-candidate derivation, transition validation
- `brain-server/src/outcome/store.ts` - `OutcomeStore` interface,
  `InMemoryOutcomeStore`, `FileOutcomeStore` V1
- `brain-server/src/outcome/service.ts` - `OutcomeService` trusted pipeline
- `brain-server/src/outcome/errors.ts`, `brain-server/src/outcome/index.ts`
- Tests: `brain-server/tests/goal24-outcome-contracts.test.ts` (27),
  `brain-server/tests/goal24-outcome-evaluator.test.ts` (22),
  `brain-server/tests/goal24-outcome-store.test.ts` (20),
  `brain-server/tests/goal24-outcome-lifecycle.test.ts` (45), fixtures in
  `brain-server/tests/helpers/fake-outcome.ts`

**Not in scope (explicitly not implemented)**

- Native read-back execution (Lane B), Tauri Broker, GitHub live verification
- GitHub write bindings, approval changes, rollback execution
- Decision Kernel rewrite, CP9 UI
- No production write capability was added (`test.item.update` exists only in
  test fixtures)

No existing runtime files were modified. `brain-server/src/execution/contracts.ts`
is untouched: `ExecutionPlan.verification_plan` (with `verification_capability_id`,
`verification_inputs`, `description?`) remains the authoritative wire contract,
and the outcome layer consumes it read-only. No wire migration was needed.
No new dependencies were added.

## Fundamental rule: execution result != verified outcome

`exit_code=0` and `BrokerExecutionResult.success=true` describe **local
execution knowledge** only. They can never produce
`outcome.verification_status=verified`.

- `ExecutionEffectState` (`not_started`, `spawn_started`, `process_succeeded`,
  `process_failed`, `timed_out`, `cancelled`, `unknown_after_crash`) only
  describes what the local runtime knows about the process.
- For `side_effect_class != read_only`, even `process_succeeded` leaves the
  outcome `pending` until a trusted read-back satisfies a trusted evaluator
  expectation.
- Ambiguous execution (`timed_out`, `cancelled`, `process_failed` after spawn,
  `unknown_after_crash`) defaults to `pending` with read-back required: the
  external effect may have partially or fully occurred.
- `not_started` (trusted native receipt proves the process never spawned)
  implies no external effect: `verification_status=not_required`.
- `read_only` capabilities default to `not_required` in V1.

## Verification statuses

`not_required`, `pending`, `verified`, `mismatch`, `inconclusive`,
`verification_failed`.

- `verified` - trusted read-back satisfies the expected postcondition.
- `mismatch` - read-back succeeded but the external state does not match.
- `inconclusive` - observation exists but cannot establish truth.
- `verification_failed` - read-back itself failed / malformed / truncated /
  unavailable (decided by the parser/read-back runtime BEFORE any evaluator).
- `pending` - execution occurred / may have occurred and verification is not
  yet complete.

## Trusted boundaries

- **Receipts**: `OutcomeService.openOutcome` accepts only a `receipt_id`,
  resolved through an injected trusted receipt resolver. A raw
  `BrokerExecutionResult` can never enter as caller authority. The receipt
  schema accepts only `source: native_broker`, and the core recomputes
  `receipt_digest` over the canonical content (mutation detection).
- **Observations**: `completeVerificationAttempt` accepts only an
  `observation_id` (+ the in-flight attempt id), resolved through an injected
  trusted observation resolver. Handcrafted payloads, LLM text ("mark
  verified"), skill claims and evidence notes can never change an outcome.
- **Expectations**: only trusted `OutcomeEvaluatorV1.deriveExpectation(plan)`
  can produce `OutcomeExpectation` from the approved `normalized_inputs` +
  `verification_plan`. The strict schema rejects `expected`, `predicate`,
  `jsonpath`, `regex`, `success_condition`, `result`, `comparison_prompt` and
  `judge_prompt` keys. The core computes `expected_outcome_digest`
  (canonical JSON + SHA-256) at openOutcome; every later verification
  re-derives the expectation and fails with `OUTCOME_EXPECTATION_CHANGED` on
  any drift.
- **LLM judge**: none. Evaluation is deterministic, typed, structured field
  comparison. Evaluators may only return `verified` / `mismatch` /
  `inconclusive` plus machine-readable reason codes; any non-conforming
  result is rejected.

## Binding checks before evaluation

Every observation must bind exactly to the outcome:

- `origin_plan_id` == outcome plan (`OUTCOME_PLAN_MISMATCH`)
- `origin_execution_receipt_id` == outcome receipt (`OUTCOME_RECEIPT_MISMATCH`)
- `verification_capability_id` == plan verification capability AND trusted
  evaluator metadata (`OUTCOME_VERIFICATION_CAPABILITY_MISMATCH`)
- `verification_attempt_id` == the in-flight core-generated attempt id
  (`OUTCOME_ATTEMPT_MISMATCH`)
- `subject_key` == expectation subject (`OUTCOME_SUBJECT_MISMATCH`)
- `payload_digest` == core-recomputed payload digest
  (`OUTCOME_OBSERVATION_INVALID`)

Parser gate (before the evaluator): `parser_status != parsed` ->
`verification_failed` (`READBACK_MALFORMED` / `READBACK_UNSUPPORTED`);
`truncated=true` -> `verification_failed` (`READBACK_TRUNCATED`), fail closed.

## Lifecycle

- Attempts are bounded: `max_verification_attempts` is configurable between 1
  and `MAX_VERIFICATION_ATTEMPTS_BOUND=5`; the V1 default is 3.
- Eventual consistency is supported but bounded:
  `pending -> mismatch attempt -> pending retry -> verified`. When the budget
  is exhausted, the final status is `mismatch` / `inconclusive` /
  `verification_failed`.
- `revisit_required`: `verified`/`not_required` -> false, `mismatch` /
  `inconclusive` / `verification_failed` -> true, `pending` -> false
  (awaiting verification is not a revisit failure).
- `rollback_candidate`: `mismatch` AND `plan.rollback_plan` exists AND
  `risk_snapshot.reversible=true`. It is a boolean eligibility flag only:
  CP8 never executes, spawns, approves or plans a rollback.

## Persistent outcome store

`FileOutcomeStore` V1 owns Brain outcome persistence:

- Strict file shape: `schema_version: 1`, strict parsing, duplicate
  outcome/attempt ids rejected.
- Writes: temp file + fsync + atomic rename, serialized mutation queue,
  best-effort directory fsync.
- Corruption (`OUTCOME_STORE_CORRUPT`) always fails closed; the store never
  resets to an empty state and keeps failing on every subsequent access.
- Transition validation (shared by both stores): identity fields immutable,
  verification attempts append-only (history can never be deleted or
  rewritten), legal status transitions only, monotonic `updated_at`,
  immutable `expected_outcome_digest`. A future Revisit creates a new
  revision/outcome instead of overwriting history.

Known limitation (documented honestly): the plan snapshot + derived
expectation used during verification live in service memory. A Brain restart
invalidates in-flight verification (fail closed, `OUTCOME_CONTEXT_UNAVAILABLE`);
persisted statuses and attempt history survive restarts. The native replay
ledger is Lane B's responsibility.

## Reason codes

`OUTCOME_VERIFIED`, `OUTCOME_MISMATCH`, `OUTCOME_INCONCLUSIVE`,
`READBACK_NOT_AVAILABLE`, `READBACK_MALFORMED`, `READBACK_TRUNCATED`,
`READBACK_UNSUPPORTED`, `OUTCOME_SUBJECT_MISMATCH`, `OUTCOME_PLAN_MISMATCH`,
`OUTCOME_RECEIPT_MISMATCH`, `OUTCOME_VERIFICATION_CAPABILITY_MISMATCH`,
`OUTCOME_EVALUATOR_NOT_FOUND`, `OUTCOME_EXPECTATION_CHANGED`,
`OUTCOME_STORE_CORRUPT`.

## Explicit statement

CP8 DOES NOT USE LLMs TO DECIDE WHETHER AN OUTCOME IS VALID. Verification is
deterministic, typed and bounded; execution success is never conflated with a
verified outcome; no process execution, shell, Broker or `gh` calls exist in
`brain-server/src/outcome`.
