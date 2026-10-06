# Post-TMLR #12888 Paper Autopsy

**Status:** research triage after second TMLR desk rejection  
**Submission:** TMLR #12888  
**Manuscript:** *Evidence-Qualified and Revision-Aware Decision Intelligence for Long-Lived AI Agents: A Safety-Gated Ablation Study*  
**Decision:** desk rejected without external review; no individualized editor comment was provided  
**Research baseline:** `research/decision-benchmark-holdback-v2`  
**Date:** 2026-10-06

---

## 1. Executive verdict

Do **not** submit the current manuscript to TMLR a third time with only writing changes.

The current work contains a publishable research seed, but the strongest seed is narrower than the current paper:

> **A downstream decision policy cannot enforce evidence requirements over evidence that an upstream retrieval stage fails to expose.**

The present manuscript tries to carry six contributions at once:

- a decision architecture;
- a deterministic Decision Kernel;
- authority / approval semantics;
- revision / outcome / lineage semantics;
- a benchmark + safety-gated methodology;
- an empirical failure mechanism.

The evidence is not equally strong for all six.

The strongest defensible finding is the **evidence-surface failure**. The weakest part is the claim that the current experiment demonstrates broad "decision intelligence" for long-lived agents.

Recommended scientific disposition:

> **B — core finding is potentially valuable, but the present evidence is not strong enough for another TMLR attempt. Run a small set of targeted experiments that directly test the evidence-surface mechanism, then rewrite the paper around that result.**

---

## 2. Why the current paper is vulnerable under TMLR's two criteria

TMLR's first criterion asks whether claims are supported by accurate and convincing evidence. The second asks whether the findings teach something of interest to some TMLR readers.

The paper is transparent about its limitations, but those limitations materially weaken the current top-line framing.

### 2.1 The evaluation is contract conformance, not independent decision quality

The manuscript explicitly states that Gold is not human-preference ground truth. Gold encodes a frozen decision contract and "decision accuracy" measures conformance to that contract.

That is legitimate for testing an engineered policy, but it means:

```text
0.9542 decision accuracy
!=
95.42% real-world decision quality
```

The paper says this correctly, but the title and architecture framing still invite the reader to interpret the result as evidence about "Decision Intelligence" broadly.

A stronger paper must either:

1. narrow the claim to policy / contract conformance; or
2. add independent evidence that the contract corresponds to sensible human decisions.

### 2.2 Human validation of Gold is currently too weak

This is the most serious evidence issue.

The recovered human audit reports:

- preferred-action exact agreement: **11/45 = 24.44%**;
- acceptable-set Jaccard: **0.0778**;
- approval exact: **9/45 = 20.00%**;
- lineage: **0/21 eligible**;
- clarification: **25/45 = 55.56%**.

Round 2 then invalidated the acceptable-actions submetric because of representation mismatch. Policy adjudication remains pending.

The 300/300 "independent review" is a mechanical rule-based consistency audit derived from the same benchmark contract. It is useful for internal consistency, but it is **not independent human validation of the Gold semantics**.

Therefore the current study convincingly shows:

> the system conforms to the benchmark contract,

but it does not yet convincingly show:

> the benchmark contract is a valid proxy for good human decision behavior.

That distinction alone can make the paper difficult to send to reviewers.

### 2.3 The ablation arms are not a clean apples-to-apples intervention

A0–A3 are provider-backed proposal arms.

A4–A5 are deterministic Decision Kernel executions and make no provider calls.

This is disclosed clearly in the manuscript, but it means the headline A0→A5 / A3→A5 gains mix together:

- model behavior;
- deterministic policy behavior;
- outcome / lineage machinery;
- arm-specific control logic.

In particular, A5's perfect revision recall / precision and decision stability are unsurprising when:

1. those operations are explicitly encoded in the deterministic layer; and
2. the benchmark Gold is generated from the same task taxonomy and policy contract.

This is not necessarily circular leakage, but it is a weak causal ablation design for a broad architecture claim.

A better experiment needs to hold the decision policy constant while changing only the evidence-surface variable being studied.

### 2.4 The strongest "mechanism finding" is currently supported by only four formal violations

A5 UDR is:

```text
4 / 43 = 0.0930
```

All four formal violations occur in **TT08**.

The paper correctly notes latent examples in other task types, but those are diagnostic rather than formal gate events.

This is enough to discover a failure mode.

It is not enough to establish a general relationship such as:

> decision safety is bounded by evidence-surface recall

with strong generality across task families, retrieval systems and models.

The exact interval in the paper is wide:

```text
UDR 95% exact CI ≈ (0.0259, 0.2214)
```

The next paper should expand the denominator and diversify the contexts in which mandatory evidence can disappear.

### 2.5 The failure is entangled with one particular lexical retrieval proxy

The manuscript explicitly says the offline benchmark uses `memoryCandidateScore` as a lexical stand-in for semantic retrieval, with the UDR failure sensitive to the frozen `min_score=1` cutoff.

This weakens a broad upstream-retrieval safety conclusion because the observed mechanism could be:

```text
one lexical scoring policy + one cutoff
```

rather than a robust phenomenon across realistic retrieval stacks.

This is actually good news: it suggests a very focused repair experiment.

### 2.6 Provider and benchmark generalization are narrow

Current formal evidence uses:

- one provider setting;
- one synthetic benchmark family;
- 120 samples per arm;
- one formal unseen post-repair epoch.

The manuscript acknowledges that architecture and provider effects cannot be separated.

For the evidence-surface paper, multiple providers are not necessarily required if the core experiment is deterministic / retrieval-level.

But if the paper keeps claims about LLM agents broadly, at least two substantially different model families should be tested.

### 2.7 The experimental history imposes a large trust burden

The manuscript transparently reports:

- multiple execution-only invalid runs;
- a post-V2 scientific-method repair after observing V2;
- generation of a new V3 epoch;
- a failed V3 acquisition followed by an execution-only rerun;
- a reconstructed manuscript / bibliography;
- unrecovered raw human-review files;
- a Gold-checklist reporting defect.

Transparency is a strength.

But editorially this creates a lot of verification burden before the reader reaches the core result.

For a paper whose central finding can be stated simply, the next version should avoid making the experimental chronology itself one of the main intellectual objects.

---

## 3. What is scientifically strongest in the existing evidence

The following pieces should be retained.

### 3.1 The safety gate was allowed to fail

This is good science.

The system achieved high aggregate contract accuracy but did not get to claim confirmatory success because UDR exceeded the preregistered gate.

That is a meaningful demonstration that aggregate performance and a non-compensable safety requirement can diverge.

### 3.2 The failure has a concrete location in the pipeline

The important causal hypothesis is not "the model reasoned badly."

It is:

```text
mandatory evidence exists in source state
        ↓
retrieval / filtering
        ↓
mandatory evidence absent from decision-visible surface
        ↓
decision policy cannot enforce a requirement over invisible evidence
        ↓
unsupported decision
```

This is much more general and testable than the current full architecture story.

### 3.3 The system already records enough artifacts for intervention experiments

The project has:

- frozen samples;
- required-evidence IDs;
- evidence visibility;
- deterministic scorer;
- arm execution records;
- temporal / provenance semantics.

That means the next experiment can be much smaller and more causal than the original campaign.

---

## 4. Recommended new paper

### Working title

**When Safety Gates Cannot See: Evidence-Surface Recall Limits Reliable Agent Decisions**

Alternative:

**Upstream Retrieval Failures Defeat Downstream Decision Safety Gates**

Do not put "Omni-Context" or "Decision Intelligence" in the title.

The product can be the experimental system, not the scientific claim.

### New central question

> If an agent decision policy requires specific evidence before acting, how does upstream evidence visibility affect unsupported decisions?

### New core claim

A defensible version:

> In our controlled agent-decision setting, missing mandatory evidence at the decision-visible surface causes safety-policy failures that cannot be repaired by downstream evidence sufficiency checks alone.

Avoid claiming a universal theorem.

---

## 5. Minimum experiment package before another archival submission

The goal is not another huge campaign. The goal is a small causal study.

### E1 — Evidence visibility intervention

Take UDR-eligible samples and create paired conditions:

```text
A. mandatory evidence visible
B. same sample, mandatory evidence hidden
```

Everything else must be identical.

Measure:

- unsupported-decision rate;
- action selection;
- abstain / clarify behavior.

This is the most important experiment.

If hiding mandatory evidence reliably increases UDR, the mechanism becomes causal rather than post-hoc.

### E2 — Oracle retrieval control

Add an "oracle evidence surface" that always delivers every required evidence item.

Compare:

```text
lexical retrieval
embedding retrieval
hybrid retrieval
oracle required-evidence coverage
```

If UDR collapses under oracle coverage while policy logic remains unchanged, the mechanism is strongly supported.

### E3 — Retrieval budget / threshold sweep

Vary:

- top-k;
- lexical threshold;
- semantic threshold;
- hybrid coverage guarantee.

Plot:

```text
mandatory-evidence recall
vs
unsupported-decision rate
```

This is much stronger than one frozen `min_score=1` point.

### E4 — More eligible samples across task families

Do not let all formal failures live in TT08.

Create a fresh, independently authored set where required evidence can be lost across:

- ordinary decision;
- approval;
- revision;
- clarification;
- user override / authority;
- temporal invalidation.

Target at least enough eligible cases that 4 failures do not dominate the entire conclusion.

### E5 — Independent human Gold validation

Use at least two genuinely independent human annotators who did not author the generator rules.

They should label:

- action family;
- whether a decision is supported;
- required evidence;
- whether abstention / clarification is acceptable.

Resolve disagreements before freezing the final evaluation set.

The benchmark should not depend on a rule-based "independent reviewer" as its main validity argument.

### E6 — Clean same-policy comparison

For the causal mechanism study, avoid the current A0–A5 mixed execution modes.

Use the **same downstream decision policy** in all conditions.

Only evidence-surface construction should change.

Optional secondary study:

- repeat with 2–3 reasoning models to test whether the phenomenon persists across proposal models.

---

## 6. What to stop spending time on

Do not add more architecture layers to the paper.

Do not create more safety metrics unless they test the central mechanism.

Do not spend more time polishing the current six-contribution framing.

Do not open the old Holdback merely to "get another result." The benchmark validity and research question are changing; a new evaluation protocol is cleaner.

Do not present mechanical consistency checking as Gold validity.

Do not use the 0.9542 headline as the paper's main selling point.

---

## 7. What can be reused unchanged

Preserve as research artifacts:

- the frozen V3 run;
- UDR gate result;
- exact failure cases;
- scorer;
- raw run chronology;
- source / evidence traces;
- current benchmark as development / mechanism-discovery data;
- preregistration artifacts;
- negative result.

The old experiment becomes **discovery evidence** for the new hypothesis.

The next study should generate independent confirmation evidence.

---

## 8. Suggested paper structure

```text
1. Problem
   downstream safety gates only operate on visible evidence

2. Hypothesis
   missing mandatory evidence creates irreducible downstream safety failures

3. Controlled setup
   one fixed decision policy
   paired evidence-surface interventions

4. Experiments
   visibility intervention
   oracle retrieval
   retrieval sweep
   cross-task validation
   optional cross-model validation

5. Results
   evidence recall ↔ UDR relationship

6. Failure analysis
   exact invisible-evidence pathways

7. Implications
   retrieval must be inside the safety contract

8. Limitations
   controlled benchmark, not deployment proof
```

This is much easier for an AE to understand than the current architecture + kernel + authority + lineage + preregistration + negative-result stack.

---

## 9. Venue strategy

Do not choose the next venue until E1–E5 are complete.

If the causal result is strong and independently validated, TMLR becomes plausible again because the paper would then cleanly satisfy:

1. a focused claim with convincing evidence; and
2. a generalizable lesson for agent / retrieval / safety researchers.

If the mechanism remains narrow to one benchmark or retrieval implementation, prefer a focused agent / LLM safety / memory workshop or empirical venue rather than forcing a broad journal framing.

---

## 10. Decision

**Current manuscript:** archive as historical submission artifact.  
**Current benchmark:** keep as mechanism-discovery / development evidence.  
**Current TMLR strategy:** stop iterative resubmission.  
**Research continuation:** proceed only as a new evidence-surface safety study.

Success criterion for restarting archival submission work:

> We can show, with independent Gold validation and controlled interventions, that changing only mandatory-evidence visibility changes unsupported-decision behavior in a reproducible way.

Until that is true, product work on Omni should have higher priority than further manuscript polishing.
