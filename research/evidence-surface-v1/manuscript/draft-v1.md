# When Missing Evidence Leaves No Trace: Obligation Coverage and Silent Retrieval Failures in Agent Decision Safety

> **Draft v0.1 — evidence-surface rewrite**
>
> Status: first manuscript reconstruction from frozen P1/P2 artifacts.  
> Study: `evidence-surface-safety-v1`  
> Confirmatory evidence used here: P2 only.  
> P3 model replication: **not run / not required**.  
> Scope: formally specified synthetic safety benchmark; no human-preference, deployment-safety, or universal-agent-safety claim.

## Abstract

Decision-capable agents often rely on retrieved evidence before taking consequential actions. Safety policies can detect some missing evidence from visible cues—for example, an approval requirement with no approval record—and abstain. But other omissions are *silent*: the retrieved surface can remain locally coherent even after a superseding instruction, revocation, or invalidation record disappears. We study this failure mode in a preregistered, formally specified synthetic benchmark of 180 decision scenarios spanning six task families and 12 domains. Holding the downstream deterministic policy and world state fixed, we compare a full-evidence condition with a paired intervention that hides exactly one formally required item. Unsupported-decision rate (UDR) rises from 0/180 to 30/180 (16.67 percentage points; paired bootstrap 95% CI [11.67, 22.22]; exact two-sided McNemar p = 1.86×10^-9). The effect is highly heterogeneous: all 30 direct-treatment failures occur in override/invalidation scenarios, where removing a later superseding record leaves an older instruction apparently actionable; the other five families expose visible gaps and trigger conservative fallback. Under three frozen top-k retrieval conditions, UDR ranges from 29.44% to 33.89%, while aggregate mandatory-fact recall does not induce a strict monotonic safety ordering. Finally, on the identical frozen hybrid retrieval surface, adding only a one-bit evidence-obligation completeness signal reduces UDR from 29.44% to 0% while preserving decisive actions on all 93/180 cases with complete formal coverage. These results isolate a distinction between *missing evidence* and *undetectably missing evidence*: retrieval quality matters, but downstream safety also depends on whether the policy can know that a required obligation is uncovered.

## 1. Introduction

Long-horizon agents increasingly act over state assembled from memory, retrieval, tools, logs, and prior decisions. In such systems, the decision policy rarely sees the entire underlying world state. It sees a *decision-visible evidence surface*: a finite set of records selected by upstream retrieval and filtering stages.

This creates a safety problem that ordinary relevance metrics do not fully capture. A policy can be conservative when missing information is visible. If the current approval is absent while an approval requirement remains visible, the policy can request approval. If a stale record is visible without a current replacement, the policy can defer. If two claims conflict and no resolution record is present, the policy can clarify. These are *detectable gaps*.

A different failure occurs when evidence loss removes not only a required item but also the only clue that anything is missing. Consider an older instruction to execute an action followed by a later override cancelling it. If retrieval drops the cancellation, the remaining surface may contain a coherent old instruction plus readiness evidence. A downstream policy that checks only what it can see has no local signal that a later override exists. We call this a **silent evidence omission**.

The distinction matters because many safety mechanisms operate downstream of retrieval. Abstention, approval checks, temporal filtering, conflict handling, and rule-based policies can only reason over the evidence delivered to them. A downstream policy can therefore be locally cautious yet globally unsafe if an upstream omission is invisible relative to the policy's checks.

This failure is complementary to two nearby problems studied in recent agent-memory work. STALE studies whether agents can recognize that an older memory has become invalid when later evidence is available but requires state revision. Revocation-enforcement work studies the opposite read-path failure in which an already revoked record is still returned and acted upon. Our intervention isolates a different case: the superseding or invalidating record itself is absent from the decision surface, so the older record can remain locally coherent without an observable revocation cue. This distinction is central to our claim of novelty.

We investigate three questions:

1. **Causal visibility:** Does hiding formally required evidence, while holding task and policy fixed, increase unsupported decisive behavior?
2. **Failure mechanism:** Are all missing obligations equally dangerous, or are failures concentrated where absence is silent relative to visible-gap checks?
3. **Coverage signaling:** Can an explicit signal that required evidence obligations are incomplete prevent unsupported decisions without revealing the missing content itself?

We answer these questions using a fresh, preregistered, formally specified synthetic benchmark with 180 scenarios across six task families and 12 domains. Every scenario has a machine-readable source truth, explicit evidence obligations, rendered evidence, a fixed decision-safety contract, and paired FULL/HIDDEN treatments. Two separately implemented formal validators must agree on required facts, action families, fallback behavior, and coverage status before a sample is admitted.

The confirmatory experiment uses a frozen deterministic downstream policy and six conditions. C0 exposes all formal evidence. C1 removes exactly one designated mandatory item. C2–C4 use lexical, hashed-dense, and hybrid top-k retrieval. C5 reuses the identical C4 hybrid surface and adds only a boolean `coverage_complete` signal; it does not reveal the missing evidence content.

The principal result is not that all missing evidence is dangerous. Under the direct C0→C1 intervention, UDR increases from 0% to 16.67%, but all 30 failures occur in the override/invalidation family. In the other five families, evidence removal leaves visible cues that activate conservative fallback. The mechanism is therefore more specific: **an omission becomes dangerous when the remaining surface does not expose that an obligation is missing**.

The retrieval experiments reinforce this interpretation. Aggregate mandatory-fact recall and UDR are related but not strictly monotonic across the three frozen retrievers. Lexical retrieval attains slightly higher aggregate recall than hybrid retrieval yet slightly higher UDR. Which obligation disappears, and whether its absence is detectable, matters in addition to aggregate recall.

Finally, the coverage-aware condition isolates the information requirement of the mitigation. C5 receives the same hybrid evidence surface as C4 and only one extra bit indicating whether all formal obligations are covered. UDR falls from 29.44% to 0%, while the policy remains decisive on all 93 cases with complete coverage. This is not a claim that real systems can obtain a trustworthy coverage bit for free. Rather, it demonstrates where the missing safety information lives: the downstream policy does not necessarily need the omitted content to avoid an unsupported decision, but it does need a reliable indication that an obligation is uncovered.

### Contributions

This paper makes five bounded contributions:

- We formalize **silent evidence omission** as uncovered required evidence whose absence is not detectable by the downstream policy's visible-gap checks, distinguishing it from stale-memory resolution and from retrieval that incorrectly returns already-revoked records.
- We provide a preregistered paired intervention that holds world state and policy fixed while changing only mandatory-evidence visibility.
- We show strong heterogeneity across obligation types: direct hiding is benign under the frozen policy when the gap remains visible, but catastrophic for superseding override/invalidation evidence whose omission leaves a locally actionable surface.
- We show that aggregate retrieval recall alone does not induce a strict monotonic safety ordering in our benchmark.
- We demonstrate, on an identical retrieval surface, that an obligation-completeness signal is sufficient for the frozen policy to eliminate unsupported decisive behavior without suppressing decisions when formal coverage is complete.

Our claims are intentionally narrow. The benchmark is synthetic and formal; it does not establish human-preference validity, real-world decision quality, deployment safety, or a universal theorem about all agents.

## 2. Related Work

### 2.1 Agent memory and retrieval

Long-term agent-memory systems study how histories should be stored, organized, retrieved, and updated. MemGPT and subsequent agent-memory systems treat memory as an external substrate that can be selectively surfaced to a model. A-Mem develops dynamic linked memory organization, while Hindsight separates world facts, experiences, observations, and opinions and combines vector, keyword, graph, and temporal retrieval. These systems improve access to long-horizon context, but improved retrieval quality alone does not answer a downstream safety question: what should a decision policy do when a required item is absent from the retrieved surface?

Our study does not propose another memory architecture. It treats retrieval as an upstream intervention and asks how evidence visibility changes downstream supportedness.

### 2.2 Evidence sufficiency and selective answering

Selective prediction and abstention study when a system should decline to answer. AbstentionBench shows that modern reasoning models still struggle with unanswerable or underspecified questions. Recent evidence-sufficiency work such as SURE-RAG explicitly separates topical retrieval from whether the retrieved set actually supports an answer, and evidence-sufficiency boundary training studies the transition from insufficient to sufficient evidence.

Our setting differs in two ways. First, the output is a bounded decision action rather than only a factual answer. Second, our main failure mode is *silent omission*: the visible evidence can look internally sufficient because the record that would reveal supersession or invalidation is itself absent. This shifts attention from assessing the content of visible evidence to assessing whether the evidence obligations themselves are covered.

### 2.3 Temporal state, revision, revocation, and supersession

Persistent agents must reason over changing state. Temporal reasoning, belief revision, and truth-maintenance work provide formal foundations for updates, conflict, and supersession. Recent benchmarks make the problem concrete. STALE (Chao et al., 2026) studies *implicit conflict*: later observations invalidate earlier memory even without explicit negation, and evaluates whether agents resolve the current state, resist stale premises, and adapt downstream behavior. Memora similarly penalizes reliance on obsolete or invalidated memory in long-term personalized agents.

A particularly close contemporary result is *Revoked but Still Authoritative* (Shen et al., 2026), which tests five agent-memory systems and finds that records already marked as revoked can still be returned, outrank their replacements, and induce unsafe actions. Its mitigation filters revoked or conflicting records before the agent sees them.

Our failure mode is complementary rather than identical. Revocation-enforcement failures expose an invalid record that should have been withheld; our silent-omission intervention withholds the *superseding valid record* that would reveal that an older instruction is no longer actionable. STALE asks whether an agent can revise state when later evidence is available; we ask what happens when the evidence encoding that state change never reaches the downstream policy. In our F6 cases, the older instruction need not carry any visible stale or revoked marker after the later override disappears. A filter that only removes explicitly marked revoked records therefore addresses a different boundary.

| Work | Primary failure boundary | Status of updating / revoking evidence | Main mitigation direction |
|---|---|---|---|
| SURE-RAG (Qiu et al., 2026) | visible retrieved set may be insufficient to support an answer | delivered evidence is inspected for set-level sufficiency | selective verification / abstention |
| STALE (Chao et al., 2026) | later evidence is available but prior state is not correctly revised | later observation exists in context or memory | state consolidation and propagation-aware retrieval |
| Revoked but Still Authoritative (Shen et al., 2026) | an already revoked record is still returned and acted upon | revocation/replacement state exists in the memory path | filter revoked or conflicting records |
| **This work** | superseding required evidence disappears and the remaining surface may look complete | **updating / invalidating evidence is absent from the decision-visible surface** | **independent obligation-coverage signaling** |

The comparison is deliberately functional rather than chronological: these works address adjacent failure surfaces, and none should be treated as a weaker baseline for another.

### 2.4 Safety gates downstream of retrieval

Agent-safety benchmarks and policy layers often constrain actions using approvals, permissions, hard rules, or abstention. Such controls are effective only over inputs they can inspect. Our experiments isolate a compositional boundary: a downstream policy can satisfy its own local checks while still acting on an incomplete global evidence surface. The coverage-aware condition operationalizes one way to expose this boundary explicitly.

## 3. Problem Formulation

### 3.1 Evidence obligations

For each decision instance `x`, let `O(x)` be the set of evidence obligations required by a frozen formal safety contract. Each obligation corresponds to one or more source-truth facts that must be represented on the decision-visible surface before a consequential decisive action is supported.

Let `S(x)` denote the evidence surface delivered to the downstream policy.

Define formal coverage `C(x, S)` as:

- `C(x, S) = 1` if every required obligation in `O(x)` is covered by `S`;
- `C(x, S) = 0` otherwise.

Coverage is evaluated from the frozen formal world specification, not inferred by the downstream policy.

### 3.2 Unsupported decisive behavior

Let `a(x, S)` be the policy action. Actions are partitioned into decisive actions and safe fallback actions such as CLARIFY, DEFER, or REQUEST_APPROVAL.

We define `U(x, S) = 1` iff the policy issues a consequential decisive action while `C(x, S) = 0`. The **unsupported-decision rate (UDR)** is the mean of `U` over a condition.

This metric does not claim that a covered decisive action is human-preferred or real-world correct. It measures compliance with the frozen formal evidence-obligation contract.

### 3.3 Detectable gaps and silent omissions

The downstream policy contains fixed visible-gap checks `G(S)`. Examples include a visible authority requirement with no current grant, visible stale state without a current replacement, or visible conflicting claims without a resolution.

A missing obligation is **detectable** when incomplete coverage also activates a visible-gap check that routes the policy to a safe fallback.

A missing obligation is **silent relative to the policy** when both:

- `C(x, S) = 0`; and
- `G(S) = 0`.

In that case, the remaining evidence surface offers no local cue that a required item is absent.

This definition is policy-relative: an omission that is silent for one policy may be detectable for another.

The mechanism can be summarized by separating *formal coverage* from *policy-visible gap evidence*:

| Formal obligation coverage | Visible gap cue | Expected policy state under our frozen rules |
|---|---|---|
| complete | irrelevant | decisive action may be supported |
| incomplete | present | detectable gap → safe fallback |
| incomplete | absent | **silent omission → unsupported-decision risk** |
| incomplete + explicit coverage signal | gap may still be absent | coverage-aware fallback |

This table is a mechanism taxonomy, not a claim that every real agent implements the same fallback rules.

### 3.4 Coverage-completeness signal

C5 augments the policy input with a single boolean `z = C(x, S)`.

No missing evidence content is disclosed. If `z = 0`, the frozen C5 rule returns DEFER before the ordinary decision logic. If `z = 1`, it executes the same decision logic as the coverage-blind conditions.

C5 is therefore a mechanism test, not a learned retrieval improvement. It asks whether making obligation incompleteness observable is sufficient to prevent the measured unsupported-decision failure on a fixed surface.

## 4. Benchmark and Formal Validation

### 4.1 Dataset construction

We construct 180 fresh scenarios: six task families with 30 samples each, distributed across 12 domains.

| Family | Decision-safety obligation |
|---|---|
| F1 | constraint-sensitive choice |
| F2 | authority / approval |
| F3 | temporal validity |
| F4 | conflict resolution |
| F5 | outcome / revision |
| F6 | override / invalidation |

Each sample contains a machine-readable `world_spec`, source records with timestamps and provenance, a rendered decision question, distractor evidence, explicit required facts, permissible action families, and a safe fallback when obligations are uncovered.

The dataset is independent of the earlier TMLR validation benchmark and sealed Holdback. Those earlier artifacts are not reused as confirmatory evidence in this study.

### 4.2 Dual formal validators

Every sample is checked by two separately implemented validators:

1. a declarative evaluator that reads the frozen `world_spec.decision_contract`;
2. a family-specific evaluator that independently derives required fact types and action families from the task-family specification.

They must agree exactly on required fact IDs, mandatory evidence IDs, full-evidence action families, fallback action families, and coverage completeness.

### 4.3 Metamorphic controls

Before P2, every sample must satisfy:

- FULL covers all required obligations;
- hiding the designated treatment target makes at least one required obligation uncovered;
- removing a declared non-mandatory item preserves complete coverage;
- the underlying world truth remains unchanged across paired treatments.

The frozen dataset passes with zero schema failures, zero dual-validator failures, zero renderer/world-spec consistency failures, zero dataset-audit errors, and zero near-duplicate warnings.

### 4.4 Claim boundary

The benchmark is a **formally specified synthetic safety benchmark**. Its Gold contract is not human-preference Gold. We do not claim that its decisions represent human-preferred actions or real-world deployment ground truth.

## 5. Experimental Design

### 5.1 Frozen downstream policy

P2 uses one deterministic policy frozen before outcomes are observed. In C0–C4 it can read only the decision question, visible evidence role, currentness, candidate support, candidates, and prior-state fields. It cannot read `world_spec`, Gold, condition labels, treatment targets, or construction metadata.

Its visible-gap rules are:

- constraint requirement without visible feasibility evidence → CLARIFY;
- authority requirement without a current authorization grant → REQUEST_APPROVAL;
- visible stale state without current state → DEFER;
- visible conflicting claims without resolution → CLARIFY;
- visible prior conditional decision without outcome-change evidence → DEFER.

Otherwise it chooses a decisive action from the visible evidence using frozen role and currentness weights.

### 5.2 Conditions

**C0 FULL.** All formal evidence is visible.

**C1 HIDDEN.** Exactly one designated formally required evidence item and its direct source/reference copies are removed. World truth and all other inputs remain fixed.

**C2 LEXICAL.** Frozen IDF-weighted token-overlap retrieval, top-k = 2.

**C3 HASH-DENSE.** Frozen 256-dimensional signed feature hash over normalized character trigrams with cosine ranking, top-k = 2. This is a deterministic dense-vector baseline, not a pretrained semantic embedding model.

**C4 HYBRID.** Reciprocal-rank fusion of C2 and C3 with score `1 / (60 + rank)`, top-k = 2.

**C5 COVERAGE-AWARE.** The exact same C4 retrieved surface plus the boolean `coverage_complete`. Missing content is not revealed.

All retrieval and policy parameters were frozen before P2 outcomes were observed.

### 5.3 Endpoints and statistics

The primary endpoint is the paired risk difference `UDR(C1) - UDR(C0)`.

The preregistered primary test is a two-sided exact McNemar test with alpha = 0.05. We report a paired nonparametric percentile-bootstrap 95% confidence interval using 10,000 replicates and frozen seed 20261006.

Secondary analyses include condition-level UDR, mandatory-fact recall, complete-coverage rate, decisive rate, safe-decisive rate, family-stratified effects, and the relationship between retrieval recall and UDR.

Because the benchmark is procedurally constructed rather than sampled from a defined real-world task population, the inferential statistics should not be read as estimates of real-world prevalence. They quantify the paired benchmark-level intervention under the frozen construction and analysis protocol; the mechanism and effect heterogeneity are the primary scientific objects.

## 6. Results

### 6.1 Hiding required evidence causally increases unsupported decisions overall

C0 FULL produces no unsupported decisions:

`0/180 = 0%`.

C1 HIDDEN produces:

`30/180 = 16.67%`.

The paired risk difference is **+16.67 percentage points**, with paired bootstrap 95% CI **[11.67, 22.22] percentage points**. The exact two-sided McNemar p-value is **1.8626451492309587×10^-9**.

Thus the preregistered primary causal gate passes.

### 6.2 The causal effect is entirely concentrated in override/invalidation cases

The aggregate effect hides extreme family heterogeneity.

| Family | C0 UDR | C1 UDR | Difference |
|---|---:|---:|---:|
| F1 constraint | 0/30 | 0/30 | 0 pp |
| F2 authority | 0/30 | 0/30 | 0 pp |
| F3 temporal | 0/30 | 0/30 | 0 pp |
| F4 conflict | 0/30 | 0/30 | 0 pp |
| F5 outcome/revision | 0/30 | 0/30 | 0 pp |
| F6 override/invalidation | 0/30 | 30/30 | +100 pp |

F1–F5 do not become unsafe under the direct treatment because hiding the designated item leaves a visible structural cue that activates a frozen fallback rule. F6 is different. Its treatment removes a later override, revocation, or invalidation record completely. The remaining earlier instruction and readiness evidence remain locally actionable, so the coverage-blind policy continues decisively.

The direct experiment therefore does **not** support the claim that any missing mandatory evidence is dangerous. It supports the narrower mechanism claim that an otherwise conservative visible-gap policy can fail when superseding evidence disappears without leaving a detectable trace.

### 6.3 Practical retrieval produces substantial unsupported-decision rates

The three frozen retrievers produce:

| Condition | Mandatory-fact recall | Complete coverage | UDR | Decisive rate | Safe-decisive rate |
|---|---:|---:|---:|---:|---:|
| C2 Lexical | 63.06% | 53.33% | 31.11% | 84.44% | 53.33% |
| C3 Hash-dense | 57.22% | 47.78% | 33.89% | 81.67% | 47.78% |
| C4 Hybrid | 60.00% | 51.67% | 29.44% | 81.11% | 51.67% |

These conditions show that retrieval loss can induce unsupported decisions beyond the single-item C1 intervention. The family pattern also broadens under retrieval because top-k retrieval can omit combinations of evidence rather than exactly one preregistered target.

| Family | C2 Lexical UDR | C3 Hash-dense UDR | C4 Hybrid UDR | C5 Coverage-aware UDR |
|---|---:|---:|---:|---:|
| F1 constraint | 66.67% | 86.67% | 70.00% | 0% |
| F2 authority | 40.00% | 26.67% | 6.67% | 0% |
| F3 temporal | 0% | 0% | 0% | 0% |
| F4 conflict | 20.00% | 13.33% | 20.00% | 0% |
| F5 outcome/revision | 0% | 0% | 0% | 0% |
| F6 override/invalidation | 60.00% | 76.67% | 80.00% | 0% |

This table is important for interpreting the F6 result. “Silent” is not simply a fixed synonym for the F6 family label. Under the single-item C1 intervention, F1–F5 retain enough structural cues to trigger fallback. Under top-k retrieval, multiple records or the cue-bearing record itself can disappear, creating silent surfaces in F1, F2, and F4 as well. F3 and F5 remain protected by the frozen policy under these retrievers. The relevant unit is therefore the *resulting evidence surface relative to the policy's checks*, not only the nominal task family.

### 6.4 Recall is relevant but not a strict monotonic safety surrogate

Ordering the retrieval conditions by aggregate mandatory-fact recall gives:

- C3 Hash-dense: 57.22% recall, 33.89% UDR;
- C4 Hybrid: 60.00% recall, 29.44% UDR;
- C2 Lexical: 63.06% recall, 31.11% UDR.

The preregistered directional gate passes within its ±2 percentage-point tolerance, but **strict monotonicity fails**: lexical recall is 3.06 percentage points higher than hybrid recall while its UDR is 1.67 percentage points higher.

We therefore reject a stronger interpretation such as “higher retrieval recall necessarily yields monotonically safer decisions.” Aggregate recall loses information about *which* obligation was omitted and whether the resulting absence is visible to the downstream policy.

### 6.5 A one-bit coverage signal closes the measured gap on the frozen hybrid surface

C5 uses the exact same retrieved evidence as C4. The only additional policy-visible input is whether all formal obligations are covered.

C4:

- UDR = **53/180 = 29.44%**;
- complete coverage = **93/180 = 51.67%**;
- safe decisive rate = **93/180 = 51.67%**.

C5:

- UDR = **0/180 = 0%**;
- decisive rate = **93/180 = 51.67%**;
- safe decisive rate = **93/180 = 51.67%**;
- fallback rate = **87/180 = 48.33%**.

C5 therefore does not obtain zero UDR by refusing every sample. It remains decisive on every case whose formal obligations are fully covered and falls back exactly when the formal coverage signal is incomplete.

This experiment should be interpreted mechanistically. Because the C5 rule explicitly defers when `coverage_complete=false`, the zero-UDR result is not evidence that the coverage signal can be estimated reliably in real deployments. It shows that the missing information needed to prevent this class of unsupported decision can be reduced, in this benchmark, to knowledge of obligation completeness rather than knowledge of the omitted content itself.

## 7. Discussion

### 7.1 Missing evidence is not the same as unknowably missing evidence

The strongest result is the contrast between F1–F5 and F6. The same formal fact—an obligation is uncovered—has different downstream consequences depending on whether the remaining surface advertises the gap.

This suggests a useful decomposition: **decision safety risk is not a function of aggregate retrieval recall alone**.

Instead, risk depends jointly on at least:

1. which obligation is missing;
2. whether the remaining evidence surface exposes a gap;
3. how the downstream policy responds to visible gaps;
4. whether the system has an independent coverage signal.

This helps explain why aggregate recall is not strictly monotonic with UDR in C2–C4.

### 7.2 Superseding evidence is a particularly sharp silent-omission case

Override and invalidation records have an asymmetric semantics: a later record can cancel the actionability of an earlier one. If the later record is missing, the earlier record does not necessarily look incomplete. It may look *more* coherent because the contradiction has disappeared.

This makes supersession structurally different from many ordinary missing-fact cases. A missing budget, approval, or current-state fact can leave a visible hole. A missing revocation can erase the hole itself.

The result motivates treating superseding evidence as a first-class safety obligation in long-lived decision systems.

### 7.3 The failure is not equivalent to stale-memory or revocation-enforcement failure

The nearest prior work makes the distinction sharper. STALE shows that an agent may retrieve changing evidence yet fail to infer that an older belief is no longer valid. Revocation-enforcement studies show that a memory system may retain and retrieve a record even after it has been explicitly marked revoked. Both are important failures, but both leave some representation of the update or revocation available somewhere in the state or retrieval path.

Our controlled F6 intervention removes the later override/invalidation from the decision-visible surface. The older instruction then need not be contradictory, stale-marked, or revoked-marked from the downstream policy's perspective. The safety failure is therefore one of **missing transition evidence**, not merely incorrect adjudication of visible transition evidence.

This difference also changes the mitigation boundary. A better state resolver helps when the update is visible. A revocation filter helps when the stale record is explicitly marked as invalid. An obligation-coverage mechanism is aimed at the case where the policy cannot establish that the evidence required to authorize a decision has actually been surfaced.

### 7.4 Mechanism identification, not prevalence estimation

The benchmark deliberately constructs controlled worlds and a deterministic policy so that evidence visibility can be intervened on without stochastic model confounds. This gives the study strong internal control but narrow external scope. The 16.67-point aggregate effect should not be interpreted as “16.67% of real agent decisions fail this way,” and the 100% F6 direct-treatment rate should not be interpreted as a field prevalence estimate.

The contribution is instead a reproducible mechanism demonstration and boundary characterization: under a fixed policy with explicit visible-gap checks, some obligation omissions are self-revealing and others are not; top-k retrieval can convert additional families into silent surfaces; and an independently supplied completeness bit changes behavior on the same retrieved content.

### 7.5 Why an obligation-coverage interface may be more useful than another confidence score

A model-confidence score asks how confident the policy is given the evidence it received. Silent omission is specifically a case where the received evidence can be coherent enough to support high local confidence.

An obligation-coverage signal asks a different question: whether the evidence acquisition layer satisfied a predeclared set of requirements. The C5 experiment indicates that these two questions should not be conflated.

A practical architecture might therefore separate:

- **retrieval relevance:** which records appear useful;
- **obligation coverage:** whether required evidence classes are represented;
- **decision policy:** what action is justified given the covered evidence.

### 7.6 C5 moves rather than solves the hard problem

The main limitation of the mitigation is also its research implication. In our benchmark, `coverage_complete` is computed from a frozen formal world specification. Real systems rarely possess an oracle inventory of all facts that ought to exist.

The next technical problem is therefore not simply “add a boolean.” It is how to construct trustworthy evidence obligations and coverage monitors from schemas, workflows, policies, provenance graphs, temporal update channels, or learned detectors without reintroducing silent failure at the monitoring layer itself.

Coverage monitoring can itself fail silently. A deployment claim would require studying errors in the coverage signal, including false-complete and false-incomplete states.

### 7.7 Why P3 is not required for the present claim

The primary result concerns a compositional property of a frozen evidence surface and a frozen downstream policy. P2 already identifies the mechanism through controlled evidence interventions with no stochastic model confound.

A model-based replication could test whether similar failure modes occur in independently chosen LLM policies, but it is not required to establish the narrower deterministic causal result reported here. We therefore do not treat the absence of P3 as missing confirmatory data. If P3 is later run, model identities and prompts must be frozen before observing outputs and its results must remain a replication layer rather than a retroactive modification of P2.

## 8. Threats to Validity and Limitations

**Synthetic formal benchmark.** The 180 scenarios are constructed from formal world specifications. They support exact causal interventions and contract-level supportedness claims, but not human-preference or ecological-validity claims.

**Deterministic policy.** The confirmatory study uses one frozen deterministic policy. This isolates the evidence-surface mechanism but does not establish prevalence across LLM agents.

**Formal obligation oracle.** C5 receives an accurate completeness signal derived from the benchmark's formal obligations. Producing such a signal robustly in open-world systems is unresolved.

**Retriever realism.** C2 is a lexical baseline; C3 is a deterministic hash-vector baseline rather than a pretrained semantic encoder; C4 is their fixed RRF fusion. These are controlled retrieval mechanisms, not claims about state-of-the-art retrieval.

**Top-k choice.** All retrieval conditions use frozen top-k = 2. Different budgets may change both coverage and failure patterns.

**Family and policy construction.** The direct C1 effect is concentrated entirely in F6. The frozen policy was intentionally designed with explicit visible-gap fallbacks for several other obligation types, so this heterogeneity is partly a property of the policy–benchmark pair. The result identifies a controlled mechanism; it does not estimate how often each failure type occurs in deployed agents.

**Inferential scope.** McNemar and bootstrap results summarize the paired 180-scenario benchmark under its frozen construction. The scenarios are not a probability sample from a defined real-world population, so p-values and intervals should not be interpreted as population-prevalence estimates.

**Coverage-signal errors are not studied.** C5 assumes the signal itself is correct. False-complete coverage is likely the most safety-relevant next failure mode.

**No deployment claim.** The results do not establish safety in real decision-making systems or high-stakes domains.

## 9. Reproducibility

The study was preregistered before P2 outcomes. The 180 formal samples, dual validators, treatment contract, downstream policy, retrievers, top-k, hash dimension, RRF constant, endpoint, McNemar test, bootstrap procedure, seed, and gates were frozen before the confirmatory run.

P2 contains 1,080 deterministic evaluations over six conditions. It uses zero provider/model calls and zero cash cost.

The reported P2 results were produced by replaying the frozen GitHub artifacts and frozen JavaScript logic in a V8 execution environment. A repository-local Node replay remains desirable as a runtime-equivalence check. Such a replay cannot alter the frozen samples, policy, retriever parameters, statistical rules, or reported outcomes.

## 10. Conclusion

A downstream safety policy can only reason about the evidence it can see. In our formally specified synthetic benchmark, hiding required evidence increases unsupported decisive behavior from 0% to 16.67%, but the effect is not generic: it is concentrated in override/invalidation cases where the omitted superseding record leaves no visible trace that anything is missing. Practical top-k retrieval produces UDRs near 30%, and aggregate mandatory-fact recall is not a strictly monotonic safety surrogate.

On an identical hybrid retrieval surface, a one-bit evidence-obligation completeness signal eliminates the measured unsupported decisions while preserving decisive behavior whenever formal coverage is complete. The result does not imply that reliable coverage monitoring is easy. It isolates the architectural requirement: systems that place safety checks downstream of retrieval need a way to distinguish “the visible evidence looks sufficient” from “the required evidence obligations are actually covered.”

The next research problem is therefore not only better retrieval. It is **trustworthy evidence-obligation accounting under open-world, changing state**.

## References

Alchourrón, C. E., Gärdenfors, P., & Makinson, D. (1985). On the logic of theory change: Partial meet contraction and revision functions. *Journal of Symbolic Logic*, 50(2), 510–530.

Allen, J. F. (1983). Maintaining knowledge about temporal intervals. *Communications of the ACM*, 26(11), 832–843.

Kirichenko, P., Ibrahim, M., Chaudhuri, K., & Bell, S. J. (2025). AbstentionBench: Reasoning LLMs Fail on Unanswerable Questions. *NeurIPS 2025 Datasets and Benchmarks Track*.

Latimer, C., Boschi, N., Neeser, A., Bartholomew, C., Srivastava, G., Wang, X., & Ramakrishnan, N. (2026). Hindsight: Structured Agent Memory that Retains, Recalls, and Reflects. *ACL 2026 System Demonstrations*, 275–285.

Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. *NeurIPS 2020*.

Qiu, J., Han, Z., & Huang, C. (2026). SURE-RAG: Sufficiency and Uncertainty-Aware Evidence Verification for Selective Retrieval-Augmented Generation. arXiv:2605.03534.

Chao, H., Bai, Y., Sheng, R., Li, T., & Sun, Y. (2026). STALE: Can LLM Agents Know When Their Memories Are No Longer Valid? arXiv:2605.06527.

Shen, Y. T., Toyoda, K., & Leung, A. (2026). Revoked but Still Authoritative: An Empirical Study of Revocation Enforcement in Agent-Memory Systems. arXiv:2609.08258.

Uddin, M. N., Shubham, K., Blanco, E., Baral, C., & Wang, G. (2026). From Recall to Forgetting: Benchmarking Long-Term Memory for Personalized Agents. arXiv:2604.20006.

Xu, W., Liang, Z., Mei, K., Gao, H., Tan, J., & Zhang, Y. (2025). A-Mem: Agentic Memory for LLM Agents. *NeurIPS 2025*.

---

## Author-side claim checklist before submission

Allowed:

- “In this formally specified synthetic benchmark …”
- “Under the frozen deterministic policy …”
- “The direct effect was concentrated in F6 override/invalidation …”
- “Aggregate retrieval recall was not strictly monotonic with UDR …”
- “On the identical C4 surface, adding formal coverage completeness changed UDR from 29.44% to 0% …”
- “The result motivates explicit evidence-obligation accounting.”

Do not write:

- “All missing evidence makes agents unsafe.”
- “Higher recall always improves safety.”
- “C5 solves retrieval safety.”
- “Coverage completeness can be obtained reliably in real systems.”
- “The benchmark represents human-preferred decisions.”
- “The result establishes deployment safety.”
- “This is a universal law for LLM agents.”
