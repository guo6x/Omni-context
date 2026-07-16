# Candidate v3.1 final execution evidence

This directory archives the development-only gate evidence for product commit
`17dc1d0107b0474de84058205a91b302ba290a74` and benchmark commit lineage rooted
at `ede9914389dca80df57142e822499d795791ae82`.

- Retrieval preflight baseline: 7/7, Top-10 20/38 (failed).
- Product fix round 1: semantic raw-event lane, core-before-support selection,
  temporal coverage, and unique quote-anchor grouping.
- Retrieval preflight round 1: 7/7, Top-10 37/38 (passed).
- Fresh Targeted-7: 7/7, errors 0, Overall 0.840868, 30-slot coverage 28/30.
- Development Full Omni: 35/35, errors 0, Overall 0.884842.
- Development No Memory: 35/35, errors 0, Overall 0.366713.
- Development Retrieval-Only: 35/35, errors 0, Overall 0.563853.
- Deterministic rescore audit: 105/105 exact, duplicate completed 0,
  invalid citations 0, scoring defects 0.
- Secondary Agent Review: 20/20, explicitly non-human and non-independent.
- Selector-off ablation: not run; no existing safe switch.
- Evidence-group-off ablation: not run; no existing safe switch.

The approximately 0.98 GiB of per-scenario databases and server logs remains in
the D-drive run archive and is referenced by hashes in the freeze manifest; API
keys are not present in this directory.
