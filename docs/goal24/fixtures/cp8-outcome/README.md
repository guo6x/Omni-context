# CP8 Outcome Read-back Synthetic Fixture Corpus

Lane C synthetic fixtures for Goal24 Checkpoint 8 (Outcome Read-back Verification Security Oracle).

- All fixtures are synthetic: no real repositories mutated, no real credentials.
- Fake secrets used where applicable: FAKE_CP8_SECRET and FAKE_GH_TOKEN only.
- Nothing here is executed; these are deterministic JSON regression inputs for the CP8 integration gate.
- Each fixture carries fixture_id, kind, and expected verdict; process receipts mirror the CP3/CP7 BrokerExecutionResult shape and readback observations mirror the planned CP8 observation shape.

## Inventory

| File | Fixture | Expected verdict |
| --- | --- | --- |
| exit0-no-effect.json | exit 0 but readback mismatch | NOT_VERIFIED |
| exit1-with-effect.json | effect completes then exit 1 | readback required; VERIFIED possible |
| timeout-with-effect.json | effect produced then hang until timeout | inspect external state |
| cancel-with-effect.json | effect before cancel | readback required |
| crash-unknown-effect.json | crash matrix around spawn/effect/receipt/readback | NOT_STARTED only pre-spawn; else INCONCLUSIVE + readback |
| valid-readback.json | trusted receipt + post-effect observation + expectation match | VERIFIED |
| mismatch.json | 3 bounded attempts all OPEN vs expected CLOSED | MISMATCH; no auto-rollback |
| stale-readback.json | observation observed before effect reference time | REJECT/STALE |
| malformed.json | exit 0 but partial JSON stdout | VERIFICATION_FAILED |
| truncated.json | truncated stdout whose prefix matches | NOT_VERIFIED |
| cross-plan.json | plan A receipt/observation used for plan B outcome | REJECT |
| cross-subject.json | repoA#1 observation used for repoB#2 | REJECT |
| write-verifier.json | reversible_write binding as readback verifier | REJECT |
| replayed-observation.json | old verified observation reused for a new plan | REJECT |

These fixtures encode the CP8 fail oracle from docs/goal24/cp8-outcome-threat-model.md and are referenced by docs/goal24/cp8-outcome-adversarial-vectors.json where applicable.
