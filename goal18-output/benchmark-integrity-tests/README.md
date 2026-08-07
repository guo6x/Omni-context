# Decision Benchmark v2 — Integrity Tests (Goal 18)

Zero-dependency Node.js suite (>= 18) for the Decision Benchmark v2 deliverables.

## Files
- `integrity.test.mjs` — 18-check suite (T1..T18): schema, ids, references, timeline order,
  evidence validity, gold contract (C1..C12), approval consistency, risk/reversibility,
  lineage, failure labels, split isolation, near-duplicate detection, distribution coverage,
  scorer v1.1 compatibility, hash seals/manifests/access log, provenance, decision_question,
  acceptable-action discipline.
- `fixtures-loader.mjs` — loads validation set/gold and holdback fixtures.
- `schema-validator.mjs` — JSON-schema validation (draft 2020-12 style).
- `scorer.mjs` — scorer v1.1 copy (semantics frozen, unmodified).
- `run.mjs` — full pipeline: pre-seal integrity run -> holdback seal -> post-seal verification.
- `verify-seal.mjs` ? post-seal checks (manifest, custody plaintext hash, sealed artifact
  header/version/layout + decryption with the custody seed, access log, repository absence).
- Post-seal, the integrity suite reads the holdback plaintext from the offline custody copy
  (read-only) because the repo copy is sealed away.
- `fixture-sha256.txt` — sha256 of validation-set.jsonl, validation-gold.jsonl, holdback-fixtures.jsonl
  (computed at freeze time; holdback hash is re-verified against the custody copy post-seal).

## Usage
```text
# Pre-seal integrity run (T15 is expected to be "pending seal" at this stage)
node --test benchmark-integrity-tests/integrity.test.mjs

# Full pipeline (integrity -> seal -> post-seal verification)
node benchmark-integrity-tests/run.mjs
```

## Required inputs for sealing
- `goal18-output/holdback-run-auth.json` (generation authorization; explicitly forbids model runs)
- Offline custody directory with `seed-holdback.txt` (outside the repository)
- The seed's sha256 must match `holdback-run-auth.json` and the custody `seed-sha256.txt`

## Protocol notes (Goal 15A)
- Plaintext holdback fixtures exist only in offline custody after sealing.
- The repository keeps only `holdback-sealed.bin` (AES-256-GCM, key = scrypt(seed)) and
  `holdback-public-manifest.json`.
- Any byte change to sealed fixtures invalidates the split; invalid-run protocol only.
