# Goal 18H-E Final Pre-Goal-20 Gate

Branch: research/decision-benchmark-holdback-v2
Date: 2026-08-09
Freeze ID: VALIDATION_GOLD_FREEZE_V2
Overall verdict: PASS
Final status: VALIDATION_V2_FROZEN_GOAL20_READY

## Gates (all PASS unless noted)

1. Q2 acceptable-actions formal human-gold metric: INVALID_DUE_TO_REPRESENTATION_MISMATCH (corrigendum recorded; raw evidence preserved byte-identical).
2. Original Round 2 raw / agreement / agreement report preserved byte-identical (hashes in commands-and-results.log).
3. HREV-052 (tt03-002): ISOLATED_FIXTURE_DEFECT; deterministic generator repair forces REJECT/no-feasible-option at L0/L1; sample replaced; 0 authority defects in final 120.
4. TT15: all 8 audited; pre-repair 8 provenance defects; post-repair 0.
5. Contract audits on final V2 (120 = 15 x 8): deleted-source provenance 0 errors; authority/action 0; action eligibility 0; approval/confirmation 0; lineage 0; evidence 0; constraints 0; clarification 0; referential integrity 0. All 8 dimension CSVs + summary CSV = 120 PASS each.
6. Validation V2 frozen: fixture e884bf7d..., gold 7bb38f4b..., manifest e0a56ef0...; freeze package commit e2df7b5c20d074b1c3e40a7c073d796054a8dd0a.
7. Goal19F synchronized: formal-run-config-v1.json changed only in goal18_integrity (new sha 98328ee2...).
8. Runner 34/34, scorer v1.1 19/19, harness 13/13.
9. Byte stability: r2-001/002/003 run_id-normalized identical (49 files/run; only self-referential artifact manifest differs); non-overwrite enforced.
10. Holdback V2 untouched: sealed sha 4737bc77... unchanged; no plaintext access.
11. No A0-A5 formal run; no purpose=formal run manifests; no formal Validation output.
12. Schema validation: 0 errors (merged fixture+gold vs item schema; fixture vs set schema; gold vs gold schema).
13. Prompt identity 30/30; model/budget OWNER_APPROVED (deepseek-v4-flash / kimi-k2.6; 200/20/220 CNY; temperature 0; retries 3).
14. Dataset hashes match config (development e7396d70..., regression fb1b91e4...).
15. Secret scan: staged + goal18he-output scans PASS (0 findings). Tracked-tree scan has one PRE-EXISTING out-of-scope finding (mobile-app/android/app/debug.keystore, tracked since initial release 98bdec9, unchanged by this goal; remediation commit 205583c exists on other branches only). Disclosed as a pre-existing condition, not a goal failure.
16. Worktree cleanliness (goal scope): all Goal 18H-E outputs committed; unrelated pre-existing dirty state untouched.

## Limitations (recorded, not hidden)

- Exact Validation-to-development/regression overlap cannot be recomputed here (goal14-output dev/reg fixtures absent); prior 4200-pair proxy evidence: 0 matches; frozen config prohibits those splits in runs.
- configuration_sha256_sealed in the Goal 19F config holds pre-sync bytes; formal-run preflight must recompute the executed-config hash.
- Q2 agreement is formally invalid (representation mismatch); diagnostic reconstruction only (DIAGNOSTIC_ONLY).

## Machine evidence

- commands-and-results.log (this directory)
- artifact-sha256.txt (this directory)
- validation-v2-freeze-record.json (freeze_commit = e2df7b5c20d074b1c3e40a7c073d796054a8dd0a)
- goal18he-status.json (this directory)
