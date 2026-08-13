# CP6 Evidence Fixture Corpus (LANE C EXCLUSIVE)

Deterministic JSON fixtures for the Evidence Surface security oracle.
Synthetic regression data only: no real users, no real repositories, no real
tokens. Any secret-looking value is a fake (FAKE_CP6_SECRET).

Each fixture carries:
- fixture_id, description, expected_guard_verdict
- decision_context (capability + subject under decision)
- requirements (evidence requirement model for the decision)
- provider_records (retrieved claims with provenance and timestamps)
- coverage_snapshot (the snapshot a caller/Guard might assemble)

Fixtures:
- valid.json               mandatory A+B satisfied, fresh, verified -> PROCEED
- missing.json             mandatory B missing -> NEVER PROCEED
- stale.json               mandatory B stale -> NEVER PROCEED
- unverified.json          mandatory B unverified -> NEVER PROCEED
- conflict.json            two providers disagree, conflict_policy=reject -> BLOCK
- agreeing.json            two providers agree -> PROCEED
- future.json              observed_at in the future -> REJECT (never fresh)
- wrong-class.json         provider returns required_checks.status while registered for pull_request.current_state -> PROVIDER_CLASS_MISMATCH
- cross-subject.json       evidence subject repoA#1 vs decision context repoB#9 -> REJECT
- provider-flood.json      100 irrelevant optional claims + mandatory B missing -> NEVER PROCEED
- optional-gap.json        optional missing while mandatory set valid -> PROCEED with non-blocking finding
- coverage-regression.json previous snapshot covered B, new snapshot drops B -> REJECT
- secret-leak.json         fake secrets in claim text -> SANITIZED, no leakage

These fixtures are inputs for future integration tests; nothing here executes.