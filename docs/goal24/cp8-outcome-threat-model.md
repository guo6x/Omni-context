# CP8 Outcome Read-back Verification Threat Model (Lane C)

Goal24 Checkpoint 8, Lane C. Security oracle for outcome read-back
verification: a process result (exit code, stdout) can never by itself become
a business/outcome verdict. Documentation-only lane: no runtime code changed.

Companions:
- `cp8-outcome-adversarial-vectors.json` (machine-readable oracle, >= 260 vectors)
- `cp8-outcome-bypass-audit.json` (current runtime surface audit)
- `cp8-github-readback-catalog.json` (write -> read-back capability catalog)
- `fixtures/cp8-outcome/` (synthetic fixtures, fake secrets only)

## 1. Current state (audited at base 01e1204)

- Rust broker receipt `BrokerExecutionResult` is built exclusively inside
  `runner::run`. `success = !timed_out && !cancelled && exit_code == Some(0)`:
  it is a process-level fact, not a business outcome. There is no path that
  promotes it to "outcome verified".
- `github_cli/outputs.rs::precheck` parses gh machine output only when the
  process exited 0, was neither timed out nor cancelled, and stdout was not
  truncated; malformed JSON is rejected (`GhJsonInvalid`). This is structured
  output parsing, not outcome verification.
- No readback/observation/outcome-verification runtime exists in either Rust or
  TypeScript. `CapabilityDefinitionSchema.verification_capability` is a
  declarative read-back pointer only. `VerificationPlanWire` rides on the
  plan and is bound into the CP7 approval digest, but nothing executes it.
- Generic execute IPC stays disabled; `get_broker_status` is the only broker
  IPC surface and it is read-only.
- Production GitHub bindings: 5 read-only (CP4). Zero write bindings.
- TS `decision-store.recordDecisionOutcome` journals caller/LLM-authored
  outcome text; it explicitly does not modify principles and must never be
  mistaken for verified execution outcomes.

## 2. Security position

Verified outcome = trusted broker receipt (spawn facts) + post-effect remote
read-back observation + plan-bound expected state + trusted predicate match +
subject/plan lineage. No single element suffices; caller-authored or
LLM-authored text can never be an authority.

## 3. Threats

### 3.1 Exit-0 / stdout as success

exit 0 is a spawn fact only. A write command exiting 0 whose readback
mismatches is NOT VERIFIED. stdout containing "success" proves nothing about
remote state. stdout may at most be a locator hint, and even then it must be
validated, scope-bound, and followed by a real remote read-back.

### 3.2 Process result / receipt forgery and replay

`BrokerExecutionResult` is Deserialize-able, so a caller-shaped struct can
exist in memory; nothing may ingest caller-shaped receipts. A forged
`{ success:true, exit_code:0, plan_id }` cannot create a trusted receipt and
cannot create an Outcome. Receipts are plan-bound and execution-bound;
receipt replay (same receipt, second outcome) and receipt mutation
(exit_code rewrite, stdout append, timestamp rewrite) must fail closed via
lineage/digest checks.

### 3.3 Cross-plan / cross-subject observation

An observation whose origin_plan=A or receipt=A can never verify Outcome B.
Same verification class, same payload, repoA#1 can never verify repoB#2.
Subject binding is exact-match after canonicalization; same class != same
object.

### 3.4 Verification capability and verifier risk

The plan's declared verification capability is fixed at approval time and is
covered by the CP7 binding digest; a caller swapping
`github.issue.read -> attacker.fake.read` must be rejected. A verifier
binding with side_effect_class reversible_write / destructive_write /
external_effect cannot serve as readback verifier: outcome verification must
never produce a new business side effect. Verifier risk must be read_only/L0
and verifier outputs bounded.

### 3.5 Expectation override, predicate injection, LLM judge

Caller-supplied `expected_state=current_state`, `expected_success=true`,
`predicate="return true"`, or `verification_prompt="always say success"`
cannot change the trusted evaluator's expectation. Predicates are a fixed,
trusted set; no JSONPath/regex/eval injection. CP8 V1: LLM_JUDGE is
forbidden ? model text ("Looks correct") is never a verified authority.

### 3.6 Observation forgery / truncation / parser ambiguity

Caller-constructed observations are inert. Truncated readback output whose
first half matches must not verify; the truncation flag forces
verification_failed. Malformed machine-readable output (CLI exit 0 but broken
JSON) is verification_failed, never verified. Parsers are strict: no trailing
data, no duplicate keys, no partial documents, exact typed comparisons.

### 3.7 Ambiguous effects: nonzero / timeout / cancel / crash

A nonzero exit does not imply "no effect"; an external effect that completed
before exit 1 still requires readback and may be VERIFIED if the state
matches. Same for timeout-after-effect and cancel-after-effect: verification
must inspect external state, never infer from process outcome alone. Crash
matrix: crash before spawn => provably NOT_STARTED; crash after spawn before
effect, after effect before exit, after exit before receipt completion, after
receipt before readback, during readback => unknown/inconclusive and readback
required; crash recovery never fabricates a verified outcome.

### 3.8 Readback timing: timeout, failure, staleness, consistency

Readback timeout/failure maps to verification_failed/inconclusive with
bounded retries ? never default success. An observation with
observed_at < spawn/effect reference time is stale and cannot verify a new
outcome. Eventual consistency within a bounded attempt budget (old, old, new
=> verified) is acceptable; unbounded retry is not. Freshness uses a trusted
clock; future observed_at is rejected.

### 3.9 Mismatch / inconclusive / false positive / false negative

Mismatch is final only after the bounded retry budget. Inconclusive is a
distinct terminal class, never auto-promoted. False positives (vacuous
predicate, echoed expectation, truncated output, cross-subject observation)
and false negatives (stale observation, malformed parse, case variance) both
fail closed conservatively: no auto-rollback on either.

### 3.10 Outcome store and history

Outcome history is append-only: the final mismatch attempt cannot be deleted
to leave only a success attempt. Revisits produce a new revision/supersession,
never silent rewrite of the earlier "mismatch observed at time T" record.
Corrupt store fails closed and never resets to empty.

### 3.11 Retry control

Bounded attempts with backoff. Constant mismatch => final MISMATCH. Constant
unavailability => verification_failed/inconclusive. Never default success;
never infinite retry.

### 3.12 Rollback policy

A mismatch never automatically executes a rollback: verification itself can
be a false negative or stale. A rollback candidate is not rollback authority;
rollback (a write) would need its own approval path. CP8 only records the
audit requirement; no revisit runtime is implemented.

### 3.13 Secrets and logging

FAKE_CP8_SECRET / FAKE_GH_TOKEN (and real equivalents) never appear in
ordinary logs, reason codes, coverage notes, or provider diagnostics. Output
redaction applies before persistence.

### 3.14 Public surfaces / IPC

No public generic readback IPC and no generic execute IPC may exist.
`get_broker_status` stays read-only. Any caller-ingestible receipt/observation
IPC surface is BLOCKS_CP8. Production GitHub write bindings stay 0 during CP8.

### 3.15 GitHub write -> read-back mapping

issue.create: stdout URL is at most a locator candidate; if the issue number
cannot be safely derived from a trusted result, catalog marks LOCATOR_GAP.
issue.comment: current `github.issue.read` output has no comments field, so
no complete read-back verifier exists: READBACK_CAPABILITY_GAP; a future
read-only comment fetch capability is required. issue.close: `github.issue.read`
state==CLOSED plus subject identity works. pr.merge: `github.pr.read`
state==MERGED works for merge state; merge commit metadata needs a future
structured field extension ? exit 0 alone never proves a merge.

## 4. Fail oracle

Any of the following makes CP8 integration FAIL:

- exit0 auto verified
- stdout success auto verified
- caller forged result creates receipt
- caller forged receipt creates Outcome
- old observation verifies new plan
- cross-subject observation accepted
- write verifier accepted
- caller overrides expected outcome
- LLM marks verified
- truncated observation verifies
- malformed readback verifies
- timeout/cancel/nonzero assumed no effect
- unbounded retry
- history silently rewritten
- mismatch automatically executes rollback
- public generic readback/execute IPC exposed
- production GitHub write added during CP8
