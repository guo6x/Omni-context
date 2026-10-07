# Evidence Surface V2 — Strengthening Plan

**Branch:** `research/evidence-surface-v2-strengthening`  
**Baseline:** V1 / PR #9 head `37766a3e154d2cd0953fe4cdd9ae1db30f881e57`  
**Status:** planning / preregistration only  
**Rule:** V1 P1/P2 artifacts remain immutable.

## Decision

Do not submit the current V1 paper unchanged.

V1 remains the controlled mechanism baseline. V2 must answer the reviewer-level questions that V1 cannot:

1. Does the phenomenon survive an **independent action-quality metric**, not only UDR?
2. Can we construct omissions that are **observationally indistinguishable at the decision surface**, rather than merely missed by one frozen policy?
3. Can a **non-oracle** completeness mechanism reduce action violations?
4. Does the effect reproduce across independent policies / LLMs and a modern semantic retriever?
5. Can a reader reproduce every reported result from an anonymous package?

## Phase A — V1 forensic audit (no new experiment)

Use only frozen V1 artifacts.

Required outputs:

- per-condition action-family violation against frozen world contract;
- per-condition divergence from the C0 full-evidence decision;
- family-stratified decomposition of UDR vs actual action divergence;
- exact explanation of C1 mandatory-fact recall = 16.67%;
- explicit audit of F6 `currentness=superseded` metadata;
- bootstrap interpretation audit;
- one complete F1 example and one complete F6 example;
- raw-row → table traceability.

### New diagnostic metrics

Let the formal world contract define allowed full-evidence action families.

- **WAVR — World-Action Violation Rate:** fraction of all cases where a decisive action family is not allowed by the frozen world contract.
- **FEDD — Full-Evidence Decision Divergence:** fraction of all cases whose `(action_family, selected_candidate_id)` differs from the same sample under C0.
- **Unsupported-but-correct:** decisive action under incomplete coverage that nevertheless matches the C0 decision.
- **Fallback rate:** fraction of non-decisive responses.

UDR remains reported as a support metric, not an action-correctness metric.

## Phase B — V2 preregistered benchmark

### B1. Two benchmark strata

#### Stratum S1 — policy-relative omissions

A cleaned successor to V1 where visible cues are explicit and internally consistent.

Purpose:
- test how different policies react to missing required evidence when cues may or may not remain visible.

#### Stratum S2 — surface-identical paired worlds

Construct paired worlds `A` and `B` such that:

- the decision-visible evidence surface is byte-for-byte / field-for-field identical;
- visible record count is identical;
- visible text length distribution is matched;
- visible metadata is identical;
- query is identical;
- candidate set is identical;
- the hidden source truth differs by a later state transition;
- the correct decisive action differs across the pair.

Example:
- World A: standing instruction remains valid.
- World B: the same instruction was later revoked, but the revocation is not in the visible surface.
- Both worlds expose exactly the same downstream input.

This supports a real observational-indistinguishability statement:
a policy that receives only the visible surface cannot choose different actions for the two worlds.

The safety trade-off is then explicit:
- always deciding cannot be correct on both members of some pairs;
- always deferring can avoid action violation but sacrifices task completion.

### B2. Hidden-transition families

Candidate transition families:

1. revocation / override;
2. authorization withdrawal;
3. changed constraint / invalidated prerequisite;
4. outcome-triggered revision;
5. conflict-resolution update.

Do not freeze family count or sample count until the dev set is audited.

### B3. Development and confirmatory split

Use a small development set only to debug construction and metrics.

Before any confirmatory policy/model outputs:

- freeze the confirmatory sample set;
- freeze prompts / policies;
- freeze retrievers and retrieval budgets;
- freeze all metrics and primary estimands;
- freeze random seeds and model versions;
- freeze stopping / exclusion rules.

Do not reuse V1 Holdback.

## Phase C — practical non-oracle completeness mechanisms

C5 from V1 becomes **oracle completeness upper bound**, not a method contribution.

V2 compares:

1. **No monitor** — ordinary downstream policy.
2. **Always defer** — trivial safety / zero-completion baseline.
3. **Surface-only monitor** — may use only the visible decision surface.
4. **Acquisition-ledger monitor** — may use retrieval / source bookkeeping but not hidden content or world truth.
5. **Oracle coverage gate** — diagnostic upper bound only.

### Acquisition-ledger monitor idea

Use source/retrieval metadata that can exist in a real system, for example:

- per-source monotonic sequence / version;
- retrieval checkpoint / high-water mark;
- required source channels;
- source-head vs retrieved-head consistency;
- explicit tombstone / revision index availability;
- retrieval completion status.

The monitor must not read:
- hidden evidence content;
- world-spec Gold;
- treatment labels;
- correct action.

Primary monitor errors:

- **false complete:** monitor says complete when a required transition may be missing;
- **false incomplete:** monitor says incomplete when coverage is adequate.

Evaluate both safety and task-completion consequences.

## Phase D — independent policies / agents

Minimum replication set:

1. frozen V1 deterministic policy;
2. a second independently designed deterministic policy that explicitly handles `currentness=superseded`;
3. at least two frozen LLM decision policies if a reproducible runtime is available.

LLM replication rules:

- freeze model identity/version before outputs;
- freeze prompt and decoding settings;
- no prompt/model selection after seeing confirmatory outcomes;
- report every preregistered model, including negative results;
- keep V1/P2 untouched.

The purpose is not to maximize model count; it is to test whether the mechanism survives policy changes.

## Phase E — retrieval robustness

Retain V1 lexical/hash/hybrid baselines as controlled references.

Add:

- at least one frozen pretrained semantic retriever;
- multiple preregistered retrieval budgets;
- matched-cardinality / matched-length controls where evidence deletion is used.

Do not claim a universal recall→safety law.

The stronger question is:
for comparable recall/budget, does the **type and detectability of omitted evidence** predict action violation?

## Phase F — primary outcomes

Primary outcomes must separate support, correctness and utility:

1. UDR — unsupported decisive action;
2. WAVR — decisive action violates frozen world contract;
3. FEDD — action differs from C0 full-evidence decision;
4. fallback / defer rate;
5. completion / decisive rate;
6. monitor false-complete / false-incomplete rates;
7. risk-coverage curve.

For S2 surface-identical pairs, add pair-level correctness / abstention analysis.

## Phase G — statistics

Do not over-interpret p-values on procedurally constructed data.

- report exact counts first;
- report family-stratified effects;
- keep family weights fixed in any stratified bootstrap;
- distinguish benchmark uncertainty from population uncertainty;
- avoid presenting a narrow CI as evidence of real-world prevalence;
- use exact paired tests only where they answer a meaningful paired question.

For S2, the observational-indistinguishability result should be stated formally; it does not require a significance test.

## Phase H — reproducibility package

Before paper rewrite, produce an anonymous package containing:

- all confirmatory samples;
- dev/confirmatory split manifest;
- generators;
- validators;
- policy implementations / prompts;
- retrieval implementations;
- per-condition visible evidence IDs;
- per-run actions and scores;
- metrics / statistics scripts;
- environment versions;
- one-command replay;
- frozen manifests / hashes;
- full illustrative cases.

The paper must not rely on a private GitHub path for core reproducibility.

## Paper repositioning

V1 claim:
> A frozen visible-gap policy can fail when required evidence is missing in a way its checks do not catch.

V2 target claim:
> State-transition evidence can be omitted so that downstream decision surfaces become observationally indistinguishable across worlds requiring different actions. This creates a safety–completion trade-off for surface-only policies; acquisition-side completeness signals can partially recover the missing information without revealing hidden content.

This is stronger, cleaner, and less dependent on one hand-written policy.

## Stop / success gates

Do not rewrite the final paper until:

- Phase A forensic audit is complete;
- V2 preregistration is frozen;
- S2 identical-surface construction passes exact equality checks;
- non-oracle monitor is defined without Gold access;
- at least one independent-policy replication is completed;
- anonymous one-command reproduction succeeds.

No P1/P2 artifact may be modified to make V2 look better.
