# Omni-Context Candidate v3.1 paper evidence package

This version-locked package supports paper drafting, result review, chart production, and offline evidence verification. It does not modify product or benchmark behavior and did not invoke a paid provider.

## Version lock

Product: 17dc1d0107b0474de84058205a91b302ba290a74; benchmark: 62b0b20f944f7e9a2c58f02ce1c65bb43dfbf841; freeze tag: evaluation-freeze-candidate-v3.1; manifest SHA-256: 88744914a97c2bb2c665a7fd8353aad09e7cd368be2ed28f4159a0efdf7f5ca8.

## Use

- Open `index.html` directly for the offline report.
- Run `node validation/validate_evidence.mjs` from this directory or repository root.
- Read `tables/table-main-results.md` for the main result table.
- Trace a number through `provenance/metric-provenance.json`, then `provenance/source-file-map.csv`.
- Use `provenance/claim-evidence-map.csv` for bounded paper wording.
- Put provider errors, absent ablations, Synthetic Curated scope, and LoCoMo NOT RUN in Limitations.

LoCoMo was not run because Candidate v3.1 was not bound to the existing held-out authorization; Conversation 2–10 remained unaccessed. The frozen product/tag must not be edited because hashes, runtime attestation, and all reported results are bound to that exact artifact.
