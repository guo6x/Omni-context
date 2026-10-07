# Reviewer-Style Audit — Silent Omission Manuscript

**Manuscript:** `research/evidence-surface-v1/manuscript/draft-v1.md`  
**Study:** `evidence-surface-safety-v1`  
**Audit date:** 2026-10-07  
**Purpose:** identify rejection-grade objections before formatting or venue submission.

## Executive verdict

The new paper is substantially more defensible than the prior architecture paper because it makes one narrow mechanism claim and anchors that claim to a frozen paired intervention.

The manuscript should **not** be sold as a broad LLM-agent benchmark or as a field estimate of safety failures. Its strongest form is a **controlled mechanism / systems-safety paper**:

> downstream safety checks can fail when an evidence obligation is uncovered *and the omission itself leaves no policy-visible trace*; obligation coverage is distinct from relevance and from visible-evidence sufficiency.

The paper is viable only if this boundary remains explicit.

## P0 — rejection-grade issues

### R1. Closest-prior-work collision: revocation enforcement
**Risk:** HIGH  
**Status:** ADDRESSED IN DRAFT, MUST KEEP CURRENT

Shen, Toyoda & Leung (2026), *Revoked but Still Authoritative*, is very close thematically. A reviewer could initially read our F6 result as rediscovering their revocation failure.

**Necessary distinction:**

- their failure: an already revoked/invalid item is still returned and acted upon;
- our failure: the superseding/invalidating item is absent from the decision surface, leaving the older item locally coherent;
- their guard filters visible revoked/conflicting records;
- our C5 tests whether independent obligation-completeness information can protect a policy even when the missing content is not supplied.

The manuscript now states this explicitly in Introduction, Related Work, and Discussion.

**Do not claim:** first paper on revocation, stale memory, or invalidated memory.

### R2. Closest-prior-work collision: stale-state reasoning
**Risk:** HIGH  
**Status:** ADDRESSED IN DRAFT

STALE (Chao et al., 2026) already studies later evidence invalidating earlier memory and downstream policy adaptation.

**Necessary distinction:**

- STALE: later observation is available but the agent must infer/update state;
- ours: transition evidence itself is absent from the decision-visible surface;
- STALE is primarily state-resolution / memory-revision capability;
- ours is evidence-surface observability / obligation-coverage.

**Do not claim:** first study of changing state, supersession, or outdated memory.

### R3. “F6 is tautological / constructed to fail”
**Risk:** HIGH  
**Status:** PARTIALLY ADDRESSED; INHERENT LIMITATION REMAINS

The frozen deterministic policy has explicit visible-gap rules for several families and no way to infer a completely omitted later override. A reviewer can argue that F6=30/30 follows by construction.

Response must not pretend otherwise.

The paper now frames P2 as **mechanism identification**, not prevalence estimation. The stronger empirical support comes from C2–C4: top-k retrieval creates unsupported decisions in F1, F2, F4, and F6, showing that silentness is a property of the resulting surface relative to the policy, not merely a family label.

Still unresolved by design: the study does not show how often this mechanism occurs in deployed agents.

### R4. C5 looks like an oracle-bit triviality
**Risk:** HIGH  
**Status:** ADDRESSED AS MECHANISM TEST; NOT SOLVED AS DEPLOYMENT METHOD

C5 receives the true formal `coverage_complete` bit. Given the frozen rule “if incomplete, DEFER,” 0% UDR is mechanically expected.

The scientific claim must therefore be:

> on an identical evidence surface, knowledge of obligation completeness is sufficient to prevent the measured unsupported decisions without revealing missing content.

It must **not** be:

> we solved retrieval safety.

The open problem is constructing a trustworthy completeness signal in open-world systems, including false-complete and false-incomplete errors.

## P1 — major-review issues

### R5. Synthetic benchmark / no human-preference validity
**Risk:** MEDIUM-HIGH  
**Status:** EXPLICIT BOUNDARY

The 180 samples are formally constructed and validated, not human-preference Gold.

Strength: exact intervention, dual validators, metamorphic controls, frozen source truth.

Weakness: no ecological or human-preference validity.

Allowed claim: formal evidence-obligation safety under the benchmark contract.

### R6. Deterministic policy only
**Risk:** MEDIUM-HIGH  
**Status:** EXPLICIT BOUNDARY

P2 establishes the mechanism without stochastic model confounds, but not prevalence across LLM policies.

P3 remains optional and should not be retroactively made necessary just to make the story look more “AI-like.”

If a venue strongly expects model-level external validity, this becomes a venue-fit issue rather than a reason to contaminate P2.

### R7. Retrieval baselines are controlled, not state of the art
**Risk:** MEDIUM  
**Status:** EXPLICIT BOUNDARY

C2 lexical, C3 hashed char-trigram dense, and C4 fixed RRF are reproducible surfaces, not SOTA retrieval claims.

The paper must not make ranking claims about modern embedding models.

The purpose is to create heterogeneous upstream omissions under frozen retrieval rules.

### R8. Statistical inference on procedurally constructed cases
**Risk:** MEDIUM  
**Status:** ADDRESSED

McNemar and bootstrap were preregistered, but the 180 cases are not a probability sample from a defined real-world population.

The manuscript now states that p-values/CIs summarize the paired benchmark-level intervention and must not be interpreted as field prevalence.

### R9. Aggregate effect hides complete family concentration
**Risk:** MEDIUM  
**Status:** ADDRESSED

C1-C0 overall: +16.67 pp.

But direct family effects:
- F1-F5: 0/30;
- F6: 30/30.

This must remain prominent, not buried after the aggregate statistic.

### R10. “Recall matters” claim is too strong
**Risk:** MEDIUM  
**Status:** ADDRESSED

Strict monotonicity fails:
- hash-dense 57.22% recall → 33.89% UDR;
- hybrid 60.00% → 29.44%;
- lexical 63.06% → 31.11%.

Allowed interpretation:

> aggregate recall is an incomplete safety surrogate; obligation identity and detectability also matter.

### R14. “Evidence obligation / coverage” is not novel terminology
**Risk:** HIGH  
**Status:** ADDRESSED; CLAIM REMOVED

HALT (Roh & Han, 2026) frames search-agent stopping as evidence coverage over expected claims. Kim (2026), *Evidence-Obligation Pool-Gated Retrieval*, explicitly uses evidence obligations, an evidence ledger, and terminal coverage/gap states.

Therefore the paper must **not** claim that it introduces evidence obligations, evidence coverage, or coverage-gated control.

The remaining novelty claim is narrower:

- controlled causal intervention on visibility of required state-transition evidence;
- policy-relative distinction between detectable and silent omissions;
- concentration of the direct effect in superseding override/invalidation cases;
- same-surface demonstration that completeness information is sufficient to change downstream behavior.

### R15. Evidence-deletion benchmark shortcut
**Risk:** HIGH  
**Status:** ADDRESSED AS CLAIM BOUNDARY

Mondal et al. (2026), *Before Answering*, shows that deleting support can leak insufficiency labels through memory size.

Our C1 also removes evidence, so a reviewer can ask whether “silent” is false because cardinality changes.

Required response:

- the frozen policy has no treatment label, Gold access, expected-count input, or learned insufficiency detector;
- “silent” is explicitly **policy-relative**, meaning the declared downstream gap checks do not fire;
- the paper does **not** claim that the reduced surface is statistically indistinguishable to every possible detector;
- future learned coverage monitors must use size-matched or otherwise shortcut-resistant construction.

## P2 — presentation / reviewer-friction issues

### R11. Title breadth
**Risk:** LOW-MEDIUM  
**Status:** IMPROVED

Current:
**When Missing Evidence Leaves No Trace: Silent Retrieval Failures in Agent Decision Safety**

The subtitle now names the differentiating construct: obligation coverage.

### R12. UDR can be mistaken for generic action accuracy
**Risk:** LOW-MEDIUM  
**Status:** DEFINED EARLY

UDR is contract-level supportedness:
a decisive action while a frozen required evidence obligation is uncovered.

It is not human correctness, utility, or preference.

### R13. “Causal” wording can sound broader than the intervention supports
**Risk:** LOW-MEDIUM  
**Status:** CONTROLLED

C0/C1 supports a causal statement *within the frozen benchmark and policy* because world state and policy are held fixed and evidence visibility is intervened on.

Do not generalize causal magnitude to arbitrary agents/tasks.

## Nearest-work comparison

| Work | Main failure | Is the updating/revoking evidence visible to the relevant stage? | Main boundary | Mitigation direction |
|---|---|---|---|---|
| SURE-RAG (Qiu et al., 2026) | visible retrieved set may be insufficient for an answer | yes, evaluates the delivered set | evidence sufficiency / selective answering | verify support/refute/insufficient |
| STALE (Chao et al., 2026) | later evidence does not correctly update prior state | later observation exists in context/memory | state revision / implicit conflict | write-time consolidation + propagation-aware search |
| Revoked but Still Authoritative (Shen et al., 2026) | already revoked record is still returned/used | revocation state exists in memory/retrieval path | revocation enforcement | filter revoked/conflicting records |
| **This work** | superseding required evidence disappears, leaving no visible gap cue | **no, by intervention/retrieval omission** | **obligation coverage / silent omission** | expose coverage incompleteness independently of missing content |

## Submission-positioning rule

Pitch the work as:

> a controlled study of a compositional safety boundary between evidence acquisition and downstream decision policy.

Do **not** pitch it as:

- a new general-purpose agent architecture;
- a broad benchmark of LLM intelligence;
- a universal memory-safety framework;
- a real-world safety validation;
- a SOTA retrieval paper.

## Remaining non-negotiable weaknesses

These are not bugs to “write away”:

1. synthetic formal benchmark;
2. deterministic policy;
3. oracle-quality formal coverage bit in C5;
4. controlled non-SOTA retrievers;
5. no P3 model replication;
6. no human external-validity layer;
7. direct C1 effect concentrated in F6.

A venue that requires all of these to disappear is the wrong venue for the current zero-cost study.

## Current readiness decision

**Scientific narrative:** READY FOR NEXT DRAFT  
**Frozen evidence integrity:** KEEP UNCHANGED  
**Need P3 before continuing:** NO  
**Need more paid experiments:** NO  
**Next work:** turn draft into submission-grade paper structure, figures, bibliography, and venue-specific formatting without changing P1/P2.
