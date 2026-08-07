# Dataset Card — Decision Benchmark v2 (Goal 18)

## Summary
- Name: Decision Benchmark v2 (paper-level decision benchmark for Omni-Context)
- Task: single-agent memory-based decision making with 15 task types, 13 actions, 26 severe-failure labels
- Size: validation 120 samples (15 x 8), sealed holdback 180 samples (15 x 12), total 300
- License/ethics: all synthetic; no real user data; high-risk domains (medical/legal/financial) contain only approval/refusal/referral/override-boundary golds — never autonomous high-risk execution

## Provenance
- Generator: goal18-generator/v2.0.0 (deterministic; same seed + same version => byte-identical output)
- Validation seed: goal18-validation-seed-7f3a9c2e (recorded in validation-manifest.json)
- Holdback seed: offline custody (sha256 recorded in holdback-public-manifest.json); two-person rule per Goal 15A
- Source mix (of 300): human_design 120 (40%); multi_model_reconstruction 90 (30%); anonymized_pattern_synthesis 60 (20%); adversarial_boundary 30 (10%)
- Generator identity + prompt_hash + editor/reviewer recorded per sample in construction_provenance

## Splits
- Validation: system-level checks before formal experiments; frozen (no sample-level patching after validation)
- Holdback: sealed (AES-256-GCM, key derived from offline seed); single authorized run only; plaintext offline in custody
- dev/reg (35 v1 fixtures): permanently DEVELOPMENT_VISIBLE + NON_CONFIRMATORY; excluded from both splits

## Per task type (validation / holdback)
- TT01: 8 / 12
- TT02: 8 / 12
- TT03: 8 / 12
- TT04: 8 / 12
- TT05: 8 / 12
- TT06: 8 / 12
- TT07: 8 / 12
- TT08: 8 / 12
- TT09: 8 / 12
- TT10: 8 / 12
- TT11: 8 / 12
- TT12: 8 / 12
- TT13: 8 / 12
- TT14: 8 / 12
- TT15: 8 / 12

## Domains (17)
- career-job-search: 18
- community-events: 19
- content-publishing: 19
- files-knowledge: 19
- financial-planning: 6
- health-lifestyle: 21
- home-living: 20
- learning-courses: 21
- legal-matters: 8
- longterm-project: 22
- medical-care: 9
- privacy-device: 21
- purchase-budget: 18
- schedule-time: 19
- software-dev: 19
- team-collaboration: 20
- travel-planning: 21

## Risk / authority distribution
- risk: low 53; medium 180; negligible 47; high 13; critical 7
- authority: L3 119; L4 93; L5 68; L0 3; L1 4; L2 13

## Gold & evaluation
- Gold contract: v1.1 (unchanged); scored by scorer v1.1 semantics (frozen, unmodified)
- Independent gold review: reviewer-agreement-report.md; adjudication-log.jsonl
- Integrity: benchmark-integrity-tests (18 checks); see commands-and-results.log

## Intended use
- Formal paper experiments: validation for system-level checks; holdback for the single confirmatory run after authorization
- Not intended for: training data, fine-tuning corpora, or benchmark shopping

## Contact / roles
- Constructor: goal18-constructor-1; Gold reviewer: goal18-gold-reviewer-1; Second reviewer: goal18-gold-reviewer-2; Adjudicator: goal18-adjudicator-1
