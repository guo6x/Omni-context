# CP7 Approval Synthetic Fixture Corpus

Lane C synthetic fixtures for Goal24 Checkpoint 7 (Approval + Risk Enforcement Security Oracle).

- All fixtures are synthetic: no real user data, no real repositories mutated, no real tokens.
- Fake secrets used: FAKE_CP7_TOKEN and FAKE_CP7_SECRET only.
- Nothing in this directory is executable, is executed, or describes a command to run.
- Every fixture carries fixture_id, kind, and expected_result; payloads mirror the ExecutionPlan / approval store shapes used by the CP3 contracts so the CP7 integration gate can replay them as regression inputs.

## Inventory

| File | Fixture | Expected behavior |
| --- | --- | --- |
| valid-read-plan.json | Valid read-only L0 plan, required_approval=false | ACCEPT (fast path) |
| valid-write-awaiting-approval.json | Write plan parked in awaiting_approval | PENDING approval |
| forged-low-risk-write.json | Write plan whose risk_snapshot understates the compiled binding | NATIVE_REJECT |
| fake-reference.json | Structurally valid ApprovalReference absent from the durable store | NATIVE_REJECT |
| mutated-input.json | normalized_inputs changed after approval | BINDING_MISMATCH |
| mutated-evidence.json | evidence lineage changed after approval | BINDING_MISMATCH |
| expired-grant.json | Grant with expires_at in the past | NATIVE_REJECT |
| revoked.json | Grant with status revoked | NATIVE_REJECT |
| denied.json | Grant with status denied | NATIVE_REJECT |
| consumed.json | Consumed grant reused for a second execution | NATIVE_REJECT |
| L1-vs-L2.json | L1 actor attempting an L2 grant | REJECT |
| restart-replay.json | Same plan replayed after restart against a memory-only ledger | REJECT (durable ledger) |
| corrupt-store.json | Truncated / checksum-mismatched store record | FAIL_CLOSED |

These fixtures encode the CP7 fail oracle from docs/goal24/cp7-approval-threat-model.md and are referenced by docs/goal24/cp7-approval-adversarial-vectors.json where applicable.
