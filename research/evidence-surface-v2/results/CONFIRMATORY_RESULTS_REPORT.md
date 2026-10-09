# Evidence Surface V2 — Confirmatory Results (Post-Outcome Report)

**Status:** Confirmatory execution completed; independent result-file integrity recheck passed; not peer reviewed.  
**Date:** 2026-10-09  
**Authorization:** `ESV2-CONF-20261009-V1`  
**Execution commit:** `abd6d1d1ffb775f67399432171bb68fb1c2db59b`  
**GitHub Actions run:** https://github.com/guo6x/Omni-context/actions/runs/37914035880  
**Artifact ID:** `11608486569`  
**Artifact archive digest:** `sha256:a183507b188557f912e3db094fac6d4a83cd2114a42f2cd927b8b4643ee27239`

> This file is a descriptive, post-outcome summary. It does not alter frozen scenarios, source code, metrics, registries, strata, gates, model conditions, or the preregistration. The original immutable run artifact, rather than this report, is the source of measured outcomes.

## 1. Frozen design and execution

- 160 paired worlds, 320 hidden-world states; five transition families × 32 pairs; 16 domains; four ledger profiles × 40 pairs.
- Nine paired-surface conditions (8 policy–monitor combinations plus one policy-independent always-defer) yielded **1,440 pair-condition rows** and 2,880 world-level ratings.
- Twelve retrieval conditions (BM25 or pinned BGE-small-en-v1.5 × k=2/4/6 × P0/P1) yielded **3,840 case-condition scores** and 1,920 ranking rows.
- Frozen pair corpus SHA256: `944ab3ddf3726bc54f10d5336fc3a6fdab2cb95c5d2049db6c861259b25b755d`.
- Frozen retrieval input SHA256: `55cd2e6f988c7dc09c15ce51600e0606f5250db45732731549f52179b56321a1`.
- Frozen retrieval truth SHA256: `553a9e234a4a7ad0fb9c8de180f538aec1c57ddcdd14aa484e017ea534fcc1d5`.
- Python 3.11.16, exact dependency lock, CPU, no LLM policy conditions or model API inference.
- All required GitHub Actions execution and artifact steps **SUCCESS**.

## 2. Paired-surface outcome

World-action violation rate (WAVR): fraction of world-level scores whose decisive action is not in the full-world allowed-action set. Completion: fraction producing a decisive action. These are separate axes; coverage alone does not certify action correctness.

| Monitor | Policies | WAVR (of 320) | Decisive actions (of 320) | Correct decisive |
|---|---|---:|---:|---:|
| M0 no monitor | P0, P1 separately | 160 (50.00%) each | 320 (100.00%) each | 160 |
| M1 always-defer | P_NONE once | 0 (0%) | 0 (0%) | 0 |
| M2 surface-only heuristic | P0, P1 separately | 160 (50.00%) each | 320 (100.00%) each | 160 |
| M3 acquisition ledger | P0, P1 separately | 80 (25.00%) each | 200 (62.50%) each | 120 |
| M4 oracle completeness | P0, P1 separately | 0 (0%) each | 160 (50.00%) each | 160 |

M3 versus M0 within this **balanced synthetic benchmark**: 25 percentage points lower WAVR, at a 37.5-point cost in completion. M3 still has **80/160 (50%) false-complete** classifications among incomplete worlds and **40/160 (25%) false-incomplete** classifications among complete worlds.

M3 profiles (same for P0 and P1; each 40 pairs / 80 world scores):

| Ledger profile | WAV count /80 | Decisive count /80 | False-complete | False-incomplete |
|---|---:|---:|---:|---:|
| L0 CLEAN_TRACKED | 0 | 40 | 0 | 0 |
| L1 BENIGN_ADVANCE | 0 | 0 | 0 | 40 |
| L2 STALE_SOURCE_HEAD | 40 | 80 | 40 | 0 |
| L3 UNTRACKED_CHANNEL | 40 | 80 | 40 | 0 |

Across all five families, M0 had 32/64 violations and M3 had 16/64, reflecting the frozen balancing of family × profile combinations. These rates must not be interpreted as the prevalence of failures in real deployments.

## 3. Retrieval × policy outcome

Denominators: B-target-hit is of **160** B-world cases; WAV / decisive / correct decisive are of **320** A+B cases.

| Retriever | k | Policy | B target hit | WAV | Decisive | Correct decisive |
|---|---:|---|---:|---:|---:|---:|
| BM25 | 2 | P0 surface vote | 114 | 96 | 311 | 215 |
| BM25 | 2 | P1 currentness first | 114 | 50 | 311 | 261 |
| BM25 | 4 | P0 | 159 | 128 | 315 | 187 |
| BM25 | 4 | P1 | 159 | 5 | 315 | 310 |
| BM25 | 6 | P0 | 160 | 129 | 319 | 190 |
| BM25 | 6 | P1 | 160 | 0 | 319 | 319 |
| BGE small v1.5 | 2 | P0 | 126 | 77 | 296 | 219 |
| BGE small v1.5 | 2 | P1 | 126 | 39 | 296 | 257 |
| BGE small v1.5 | 4 | P0 | 160 | 130 | 319 | 189 |
| BGE small v1.5 | 4 | P1 | 160 | 0 | 319 | 319 |
| BGE small v1.5 | 6 | P0 | 160 | 128 | 320 | 192 |
| BGE small v1.5 | 6 | P1 | 160 | 0 | 320 | 320 |

**Controlled diagnostic:** On identical BGE k=4 retrieval surfaces with target hit 160/160, P0 had 130/320 WAV while P1 had 0/320. Retrieval success does not ensure a fixed downstream decision rule uses state-transition evidence correctly. This is a comparison between two constructed deterministic policies, **not across LLM families**.

## 4. Independent output verification

An independent read-only verification of the downloaded artifact checked:

- Exactly 1,440 unique `(condition_id, pair_id)` paired rows.
- Exactly 3,840 unique `(case_id, retriever, k, policy)` retrieval rows.
- All world-action violation labels versus independent truth-sidecar allowed-action sets; decisive/correct-decisive consistency.
- All monitor false-complete/false-incomplete labels against the world completeness truth.
- All retrieval target-hit labels, base-evidence recalls, condition-level counts and aggregation.
- All result/manifest hashes against `RESULT_HASHES.txt` and `CONFIRMATORY_SUMMARY.json`.

**Result:** No disagreement found. CI result schemas and the execution manifest also passed.

Immutable artifact file hashes:

| Artifact file | SHA256 |
|---|---|
| `CONFIRMATORY_SUMMARY.json` | `4c0134e475e6b3e6199e5f5f9c935aabd0d08cff682d7e2952444b53d712ab7f` |
| `execution-manifest.json` | `48a4b87037a489c5730e56563c05088c4d80e2bb21c45c59dfd274a9cf8b861d` |
| `paired-results.json` | `2f2c3543e80bc69a465b446f536076f37e073c45d863bf14400b821b2295cbbb` |
| `retrieval-rankings.json` | `31e6f3e08cfb721bbdba463ca62f30e57ecb62c7064b3c2e9eb945880856ea61` |
| `retrieval-results.json` | `5adca6883c03685fbeb0912e34e5b02c48350316a2cff27b6b432f8536bf7cc9` |

## 5. Interpretation and external-validity limits

1. The formal paired-world indistinguishability claim is an information bound. Measured error rates are constructed benchmark outcomes, not population or field incident rates.
2. M3 is **not** a demonstrated general completeness solution. In stale or untracked source regimes it still acts with incomplete truth.
3. M4 has a world-truth oracle and a mechanically zero unsupported-action rate by design, so it is a diagnostic reference, not a deployable method success.
4. Both policies are hand-specified deterministic rules. No LLM replication was included in this pre-registered experiment; none may be appended post hoc to rescue conclusions.
5. The paired corpus, slot matching, document metadata, source channel errors, and domain text remain procedural synthetic constructs. Independent human plausibility and ecological validity are not established.
6. Retrieval results depend on the frozen target, action-candidate support metadata, roles, and policy logic. They do not evaluate open-world natural language agents.
7. The safe next steps are a separate preregistered external replication, independent scenario realism checks, stronger decision policies, and an updated manuscript explicitly stating all these boundaries.

**Publication status:** research evidence produced and cross-checked; revised paper and independent peer review still pending.
