# Evidence Surface V2 — Confirmatory Corpus Freeze

**Status:** CORPUS FROZEN / CONFIRMATORY EXECUTION NOT AUTHORIZED

- Pairs: **160**
- Worlds: **320**
- Corpus SHA-256: `944ab3ddf3726bc54f10d5336fc3a6fdab2cb95c5d2049db6c861259b25b755d`
- Structural audit SHA-256: `d5fbd56a23a0aaa109ee5380d9b7adf3ec2eb2d993ee6610278586e39ccf424a`
- Generator SHA-256: `77f7470dd996ae91c85509a2b65e42ac4a7450a179c5f8b494b6c27e8a549c4d`
- Schema SHA-256: `fb8f6dbf96b372ff512d776856c120da1ba550e455f18007d00e1a920d64de67`
- Validator A SHA-256: `6a5ad96581b1eac19d1a28e159ac46205c8cf2356a67796c2d21f96787977ea8`
- Validator B SHA-256: `b25522ba32103ee8e7320c935c1bae21c1710c58a5bbbf0d60c834864d365a3e`

## Balance

- 5 transition families × 32 pairs = 160 pairs.
- 16 confirmatory-only domains × 10 pairs = 160 pairs.
- 4 ledger-fidelity profiles × 40 pairs = 160 pairs.
- Within every family, every ledger profile has exactly 8 pairs.

## Structural gates

- pair_count_160: **true**
- five_families_32_each: **true**
- sixteen_domains_10_each: **true**
- four_profiles_40_each: **true**
- every_family_has_each_profile_8: **true**
- exact_surface_unique: **true**
- no_near_duplicates_at_090: **true**
- no_dev_confirmatory_leakage_at_085: **true**
- template_concentration_le_2pct: **true**
- all_clean_current: **true**
- all_profile_shapes_valid: **true**
- dual_validators_pass: **true**

## Pre-freeze outcome embargo

- confirmatory policy outcomes executed: **false**
- confirmatory monitor-conditioned action outcomes executed: **false**
- confirmatory LLM outputs executed: **false**
- confirmatory retriever downstream outcomes executed: **false**

Two independent structure-only CI runs produced the same corpus SHA before this repository freeze.

## Important

This record freezes only the confirmatory corpus and its structural contract.
**It does not authorize confirmatory execution.**
Execution remains blocked until policy/model/retriever conditions, primary estimands, thresholds, exclusions, seeds, and reporting rules are frozen in a separate execution preregistration.
