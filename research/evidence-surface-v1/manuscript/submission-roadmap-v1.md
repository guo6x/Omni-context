# Submission Roadmap — Silent Omission Paper

**Status date:** 2026-10-07  
**Manuscript:** `research/evidence-surface-v1/manuscript/draft-v1.md`  
**Evidence baseline:** frozen P1/P2 only; P3 optional / not required.

## Venue decision

### Primary submission window: ARR 2026 October cycle — **2026-10-12 AoE**

This is now the preferred route.

Why:

- NAACL 2027 and COLING 2027 both accept papers through the ARR 2026 October cycle;
- ARR long papers allow **8 content pages**, with a required Limitations section outside the content-page count and unlimited references;
- the paper fits the ACL/ARR topic surface through language agents, long-term memory, retrieval, evidence sufficiency, abstention, and evaluation;
- most importantly, ACL/ARR explicitly permits generative-AI writing/coding assistance when its scope is disclosed in the Responsible NLP Checklist and Acknowledgements.

After ARR reviews/meta-review, the paper can be committed to one eligible venue under that cycle's rules.

Current target ordering:

1. **ARR 2026-10-12** → decide NAACL 2027 vs COLING 2027 at commitment;
2. **ARR 2027-01-04** → ACL 2027 if the October submission is not ready or needs revision;
3. **ECAI 2027** as a later broad-AI backup.

### IJCAI 2027 — paused for policy compliance

IJCAI 2027 currently lists:

- abstract deadline: **2027-01-04 AoE**
- full paper deadline: **2027-01-11 AoE**

However, the most recent available IJCAI main-track policy (2026) says LLMs may be used to polish style/language but not to write paper content, with violations subject to desk rejection.

Our actual workflow includes substantive generative-AI assistance in framing and drafting. Therefore IJCAI must **not** be treated as an active target unless the official IJCAI 2027 policy explicitly permits this workflow.

### ACL/ARR disclosure requirement

For ARR submission:

- generative-AI writing/coding assistance must be disclosed truthfully;
- the Responsible NLP Checklist must describe scope;
- details should be retained for the Acknowledgements/camera-ready disclosure;
- AI must not be listed as an author;
- human authors remain responsible for every claim, citation, analysis, and submitted artifact.

### AAMAS 2027

The topic fit is strong, but the required abstract deadline (2026-10-01 AoE) has already passed. Do not attempt a noncompliant submission.

### ICLR / AISTATS / AAAI 2027

Their applicable main-track deadlines have already passed.

### TMLR

Do not resubmit the old architecture paper. The current manuscript is a materially different study.

## Work plan to ARR submission

### M1 — scientific narrative lock
Target: now

- [x] freeze P1/P2 evidence
- [x] rewrite around silent omission
- [x] distinguish detectable gaps vs silent omissions
- [x] expose F6 concentration
- [x] add C2–C4 family-level retrieval heterogeneity
- [x] qualify non-monotonic recall result
- [x] bound C5 as oracle-quality mechanism test
- [x] position against STALE
- [x] position against Revoked but Still Authoritative
- [x] create reviewer-risk audit

### M2 — submission-grade evidence presentation

Required:

1. conceptual failure-mode figure;
2. primary C0/C1 paired-result figure;
3. family heterogeneity figure;
4. retrieval recall vs UDR plot with explicit non-monotonicity;
5. C4 vs C5 same-surface mitigation figure;
6. compact reproducibility / preregistration table.

No new experiment is needed for these figures.

### M3 — manuscript compression

Convert the Markdown research draft into a venue-neutral LaTeX source.

Main-text priority:

1. Abstract
2. Introduction
3. nearest-work boundary
4. formal mechanism
5. benchmark + freeze
6. C0/C1 primary result
7. family heterogeneity
8. retrieval results
9. C4/C5 mitigation
10. limitations

Move implementation minutiae and extended audit detail to appendix/supplement.

### M4 — citation audit

Before submission:

- verify every 2026 citation against primary source;
- do not cite secondary summaries when the original paper is available;
- explicitly cite STALE and Revoked but Still Authoritative;
- check whether materially closer work appears between 2026-10-07 and submission;
- rerun a novelty search shortly before abstract submission.

### M5 — reproducibility check

Desirable but non-mutating:

- repository-local Node replay of frozen P2;
- verify artifact hashes;
- regenerate all figures/tables from frozen result JSON;
- record environment/version.

The replay is a reproducibility check only. It cannot modify P1/P2 samples, policy, retrieval parameters, statistics, gates, or outcome claims.

## P3 decision

**Current decision: do not run P3.**

P3 is not required for the current mechanism claim.

Reconsider only if all of the following become true:

1. a reproducible zero-marginal-cost model runtime is available;
2. model identities/prompts can be frozen before outputs;
3. the result adds external validity rather than changing the P2 story;
4. running it does not force post-hoc selection or threaten the frozen claim boundary.

## Current manuscript thesis

> Safety checks downstream of retrieval can fail when a required state transition is omitted without leaving a policy-visible gap. Aggregate retrieval recall is an incomplete safety surrogate; an independent evidence-obligation coverage signal can prevent the measured unsupported decisions on a fixed retrieval surface, but obtaining that signal reliably in open-world agents remains unsolved.

This thesis should remain stable unless new evidence falsifies it.
