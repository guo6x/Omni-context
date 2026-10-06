# Submission Roadmap — Silent Omission Paper

**Status date:** 2026-10-07  
**Manuscript:** `research/evidence-surface-v1/manuscript/draft-v1.md`  
**Evidence baseline:** frozen P1/P2 only; P3 optional / not required.

## Venue decision

### Primary target: IJCAI 2027 — provisional

Current official IJCAI 2027 dates:

- abstract deadline: **2027-01-04 AoE**
- full paper deadline: **2027-01-11 AoE**
- notification: **2027-04-21**
- conference: Kyoto, Japan, 2027-08-07 to 2027-08-13

Why it currently fits:

- broad AI scope rather than narrowly ML-statistical novelty;
- paper concerns autonomous-agent decision safety, memory/retrieval boundaries, reasoning, and system architecture;
- the contribution is a controlled mechanism finding rather than a new neural model;
- enough time remains to produce a clean submission without contaminating frozen P2.

Caveat: the 2027 site currently exposes the dates but the full author/formatting call must be rechecked when published. Do not lock page layout until the official 2027 author instructions are live.

### Secondary target: ACL 2027 via ARR

Current official ACL 2027 timeline:

- ARR cycle deadline: **2027-01-04 AoE**
- ACL main conference: Kyoto, Japan, 2027-08-20 to 2027-08-22

ACL becomes attractive if the paper is positioned more strongly around:

- memory-grounded language agents;
- evidence sufficiency;
- retrieval and selective decision behavior;
- stale/superseding conversational memory.

Risk: the deterministic policy and formal systems-safety framing may fit broad AI better than core NLP unless the language-agent relevance is made explicit.

### Backup: ECAI 2027

Current official full-paper deadline:

- **2027-04-14**

Useful as a later broad-AI backup if IJCAI/ARR positioning is not satisfactory.

## Venues not actionable in this cycle

### AAMAS 2027
The topic fit is strong, especially its Generative and Agentic AI area, but:

- abstract deadline: 2026-10-01 AoE — **missed**
- full paper deadline: 2026-10-08 AoE

A new submission cannot be started after missing the required abstract deadline. Do not rush or attempt a noncompliant submission.

### ICLR 2027
- abstract deadline: 2026-09-18 AoE — passed
- paper deadline: 2026-09-25 AoE — passed

### AISTATS 2027
- abstract deadline: 2026-09-29 AoE — passed
- paper deadline: 2026-10-06 AoE — passed

### AAAI 2027 main track
- abstract deadline: 2026-07-21 AoE — passed
- paper deadline: 2026-07-28 AoE — passed

### TMLR
Do not immediately resubmit a third version of the old architecture paper. The new manuscript is a materially different research story and should be treated as a new paper.

## Work plan to IJCAI/ARR window

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
