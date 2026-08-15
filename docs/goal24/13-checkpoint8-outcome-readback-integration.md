# Goal24 Checkpoint 8 — Outcome Read-back Verification Integration (CP8)

Status: `CHECKPOINT8_SECURITY_GATE=PASS` (see `docs/goal24/checkpoint8-security-gate.json`)

Base: `01e1204d8d2a9b232b6745a96667a205841e6f60` (`origin/dev/goal24-cli-skills`, verified exact before integration)

Integrated lanes (atomic cherry-picks, no squash):
- Lane A (Outcome Core, Brain): `51296f5` `b3b32a4` `df7350e` `060f7ed` `3ae0bda`
- Lane B (Native Readback, Rust): `75b9095e` `d73b974c` `0b22ba3a` `26d911c3`
- Lane C (Security Oracle, docs): `b10d7481`

## 1. The core security proposition

**process execution success != verified external outcome.** `exit_code == 0`,
`BrokerExecutionResult.success == true`, `ExecutionPlan.state == succeeded`, stdout
containing "success", stderr absence, an approval grant, LLM text, skill claims and
evidence notes can NONE of them produce `Outcome.verification_status = verified`.
Only a trusted native read-back observation plus a trusted deterministic Brain
evaluator can.

## 2. Trust boundaries (unified contracts)

Production path for receipts:
`receipt_id` -> trusted internal `NativeReceiptResolver` -> native persistent
`ReceiptStore` -> validated narrow `TrustedExecutionReceipt` snapshot ->
`OutcomeService`. A caller-shaped `{ success: true, exit_code: 0, plan_id: ... }`
object can never enter: `BrokerExecutionResult` has no `Deserialize` implementation
(compile-time closure of CP8A-002) and no submit/register/import IPC surface exists.

Production path for observations: `observation_id` / native attempt ->
`TrustedObservationResolver` -> trusted native observation -> deterministic Brain
evaluator. No public readback IPC, REST observation import or MCP "mark verified"
tool exists. Tests may fake the resolvers.

The machine-readable unified contracts:
- `docs/goal24/cp8-execution-receipt-transfer-contract.json` (receipt_id, plan_id,
  decision_id, capability_id, capability_version, adapter_id, normalized_inputs_digest,
  verification_plan_digest, execution_state, accepted_at, spawn_started_at?,
  finished_at?, exit_code?, timed_out, cancelled, receipt_digest, source=native_broker)
- `docs/goal24/cp8-readback-observation-contract.json` (observation_id,
  verification_attempt_id a.k.a. native_attempt_id, origin_plan_id,
  origin_execution_receipt_id, verification_capability_id, subject_key,
  attempt_started_at, observed_at, payload, payload_digest, parser_status, truncated,
  source_adapter, source_binding + process metadata)

`receipt_digest` is a NATIVE integrity/audit field; real trust comes from the
trusted resolver against the persistent native store, never from a
caller-provided digest. The Brain core recomputes the digest over canonical
content for mutation detection only.

## 3. Execution state mapping (cross-language, 0 mismatches)

`docs/goal24/fixtures/cp8-outcome/execution-state-mapping.json` (26 vectors) is
validated by BOTH the Rust test
`execution_broker::readback::cross_language_tests` and the Brain test
`goal24-outcome-cross-language.test.ts`.

- completed + exit 0 -> `process_succeeded`
- completed + nonzero -> `process_failed`
- completed + timeout -> `timed_out` (precedence over exit code)
- completed + cancel -> `cancelled` (precedence over exit code)
- spawn_failed (strict proof the child never existed) -> `not_started`
- recovered accepted -> `unknown_after_crash` (NEVER not_started: spawn + effect +
  crash-before-fsync is possible)
- recovered spawn_started -> `unknown_after_crash`
- live spawn_started -> `spawn_started` (in-flight, read-back eligible)
- live accepted -> `in_flight` (not materializable yet)

## 4. ExecutionPlan.succeeded semantics freeze

`ExecutionPlan.succeeded` = process/execution lifecycle succeeded, NOT business
outcome verified. `ExecutionPlan.failed` = lifecycle failed, NOT external effect
definitely absent. Regression tests:
- `goal24-outcome-hardening.test.ts` asserts no `brain-server/src/outcome/**` file
  ever reads `plan.state`, and that state=succeeded vs state=executing produce
  identical expectations.
- `goal24-outcome-cross-language.test.ts` expectation vectors exp-016/019/020:
  plan.state, timeout_ms and timestamps never change the expectation digest.

## 5. Freshness, replay, cardinality

- Timestamps come only from the trusted native clock (receipt accepted/spawn/finish,
  attempt reservation, observed_at). Callers can never declare observed_at.
- `attempt_started_at >= receipt.spawn_started_at`; `observed_at >= attempt_started_at`;
  `observed_at >= receipt.accepted_at`; `observed_at <= now + 60s skew`.
- Replay defeated by observation_id + native attempt id + plan/receipt/subject/
  capability binding + single-use observation ids (same outcome: service check;
  cross-outcome: store-level global observation index).
- One canonical OutcomeRecord per (plan_id, execution_receipt_id); the store file
  carrying two outcomes for one receipt (or one receipt under two plans) is corrupt.

## 6. Verification inputs immutability + verifier read-only rule

- Read-back capability, inputs, subject, argv, executable, cwd and env all come
  from the approved `ExecutionPlan.verification_plan` frozen into the receipt; the
  receipt digest binds `normalized_inputs_digest` + `verification_plan_digest`.
- Verifier bindings must declare `side_effect_class=read_only`, `risk_level=low`,
  `required_authority=L0`; anything else is rejected at registration
  (`READBACK_BINDING_NOT_READ_ONLY`). Outcome verification can never become a
  second covert execution channel.

## 7. Truncation / malformed / parser gate

`truncated=true` or `parser_status=truncated` -> `verification_failed` /
`READBACK_TRUNCATED`; `parser_status!=parsed` -> `verification_failed` /
`READBACK_MALFORMED` / `READBACK_UNSUPPORTED`. Never verified; malformed/unsupported
payloads never reach the semantic evaluator. Native failed parses emit an empty
object payload (no partial truth) and the envelope carries no verified/success
field.

## 8. Retry / eventual consistency

Brain default max_attempts = 3; native hard maximum = 5 (MAX_VERIFICATION_ATTEMPTS).
Each native call performs exactly one attempt; no while-true retry. Attempt 1
mismatch with budget -> pending; attempt 3 verified -> verified. Budget exhausted
without verified -> final status is the last trusted result (mismatch /
inconclusive / verification_failed), never a default success. History is preserved
append-only.

## 9. Outcome / Receipt stores

Both persistent, restart-recoverable, corruption fail-closed (never reset empty),
history append-only, duplicate attempts/observations rejected, illegal transitions
rejected. Evidence matrix: `docs/goal24/checkpoint8-store-recovery-matrix.json`.

## 10. Rollback / Revisit

`rollback_candidate` is a boolean eligibility flag only (mismatch + rollback plan +
reversible). CP8 never executes, approves or auto-triggers rollback, and never
retries the original write. `revisit_required`: verified/not_required -> false,
pending -> false (awaiting verification), mismatch/inconclusive/verification_failed
-> true. No full Revisit engine is implemented.

## 11. Lane C closure

`potential_before = 2`, `potential_after = 0`, `blocks_before = 0`,
`blocks_after = 0`. Neither potential was closed via OUT_OF_SCOPE:
- CP8A-002: `BrokerExecutionResult` `Deserialize` removed (compile-time),
- CP8A-013: decision journal records stamped `outcome_authority: "journal"` +
  `verified: false`, structurally unreachable from the outcome layer.
Details: `docs/goal24/checkpoint8-bypass-closure.json`.

## 12. Adversarial oracle

265 vectors mapped: 201 COVERED_BY_EXISTING_TEST, 50 AUTOMATED, 4 MANUAL, 10
NOT_APPLICABLE (GitHub write catalog semantics; the write surface does not exist).
unmapped = 0, failed = 0.
`docs/goal24/checkpoint8-adversarial-execution-map.json`.

## 13. Synthetic E2E (6 cases, both halves automated)

Test-only synthetic write binding + test-only read-only verifier + trusted internal
test bridge (shared contracts + golden fixtures). No public IPC added. Matrix:
`docs/goal24/checkpoint8-e2e-matrix.json`.

## 14. GitHub future read-back catalog (unchanged, honest gaps)

`github.issue.create`: LOCATOR_GAP (gh stdout URL is a locator candidate only);
`github.issue.comment`: READBACK_CAPABILITY_GAP (github.issue.read cannot fully
verify comments); `github.issue.close`: MAPPED; `github.pr.merge`: MAPPED_PARTIAL
(merge metadata structured-field gap). Production write bindings remain 0.
Enablement prerequisites: `docs/goal24/cp8-write-enablement-prerequisites.json`.

## 15. Security surface (final)

`generic_execute_ipc = false`, `public_readback_ipc = false`,
`public_outcome_finalize_api = 0`, `public_approval_mutation_ipc = 0`,
`production GitHub write bindings = 0`, `LLM judge = false`,
`automatic rollback = false`.

## 16. Regression evidence

- Brain: typecheck PASS, vitest 1279/1279 PASS, build PASS, lint exit 0 (10
  pre-existing warnings), npm audit exit 1 (28 pre-existing findings, none in the
  outcome/evidence/approval runtime; recorded honestly).
- Rust: cargo fmt --check PASS, cargo check --all-targets PASS, clippy exit 0 (12
  warnings in pre-existing files), cargo test 203 passed / 0 failed / 7 ignored,
  cargo audit recorded in the gate doc, NEW_DEPENDENCIES = NONE.
- Cross-language: state mapping 26 vectors mismatch = 0; observation 35 vectors
  mismatch = 0 (both suites).
- CP6 Evidence Guard regression: PASS (evidence suite green in the full run).
- CP7 Approval/Risk regression: PASS (approval suites green; Rust approval/crash
  tests unchanged and green).

## 17. Environment

See `docs/goal24/checkpoint8-environment.json`. No new toolchains installed to C:;
existing D: environments were used. No new dependencies were added on either side.

## 18. Scientific firewall

No Holdback, `science/*`, Gold, formal, paper or scientific frozen refs were read or
modified. The dirty legacy worktree `D:\ai_code\Omni-context\.worktrees\goal24-cp21`
was not touched.
