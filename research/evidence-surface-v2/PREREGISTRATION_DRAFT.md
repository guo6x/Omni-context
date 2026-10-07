# Evidence Surface V2 — Preregistration Draft

**Status:** DRAFT ONLY — not frozen.  
**Do not run confirmatory model outputs from this document.**

This draft exists so design choices are resolved before confirmatory outcomes are observed.

## 1. Core claim target

V2 targets a narrower and stronger claim than V1:

> State-transition evidence can be absent while two underlying worlds expose an identical decision-visible surface but require different decisive actions. Surface-only policies therefore face an information-limited safety/completion trade-off. A non-oracle acquisition-side completeness mechanism may reduce action violations by exposing missing-state risk without revealing the hidden event content.

## 2. Research questions

### RQ1 — Information boundary

Can we construct validated paired worlds with:

- exact downstream input equality; and
- disjoint valid decisive actions?

This is a construction/validation question, not a significance-test question.

### RQ2 — Policy replication

Across independently specified decision policies, what fraction of paired worlds produce:

- decisive action;
- world-action violation;
- fallback;
- identical decisions across the pair?

### RQ3 — Non-oracle completeness monitoring

Can an acquisition-ledger monitor reduce world-action violations relative to no monitor while preserving materially more completion than always-defer?

### RQ4 — Robustness

How do results change across transition families, retrieval budgets, and at least one pretrained semantic retriever?

## 3. Development versus confirmatory data

Development data may be used to:

- debug schemas;
- test validators;
- choose readable scenario templates;
- debug monitor logic;
- debug prompts and output parsers.

Development data may not be reported as confirmatory evidence.

Before confirmatory outputs, freeze:

- confirmatory scenario set;
- transition-family composition;
- prompts and deterministic policies;
- monitor definitions;
- retriever identities and budgets;
- model identities/versions when applicable;
- metrics;
- exclusion rules;
- random seeds;
- statistical summaries.

The old V1 Holdback remains unopened and unused.

## 4. Paired-world construction gates

Every confirmatory pair must pass:

1. exact canonical equality of policy_input;
2. equal visible evidence count;
3. equal visible text and metadata by construction;
4. no forbidden Gold/coverage/treatment fields in policy_input;
5. hidden event IDs absent from visible source IDs;
6. hidden world states differ;
7. valid decisive-action sets are nonempty and disjoint;
8. at least one safe fallback action is available;
9. two independent validators agree on the pair contract;
10. no unresolved duplicate/template leakage audit.

## 5. Planned transition families

Development candidates:

- revocation / override;
- authorization withdrawal;
- constraint or prerequisite change;
- outcome-triggered revision;
- conflict-resolution update.

Final family set and sample count remain **unfrozen** until development auditing is complete.

Do not choose family weights after confirmatory results.

## 6. Policy conditions

Minimum confirmatory policy set:

### P0 — V1 deterministic policy

Retained only as a historical controlled baseline.

### P1 — independent deterministic policy

Must be designed independently of V1 outcome patterns and must explicitly handle stale/superseded metadata when such metadata is visible.

### P2+ — frozen LLM policies

At least two independently selected LLM decision policies only if a reproducible runtime is available before outcomes.

For every LLM condition:

- freeze exact model/version;
- freeze prompt;
- freeze decoding settings;
- report all preregistered conditions;
- no model/prompt selection after confirmatory outputs.

If reproducible model access is unavailable, do not fabricate an LLM replication claim.

## 7. Monitor conditions

### M0 — no completeness monitor

Policy acts on the decision-visible surface only.

### M1 — always defer

Trivial lower-risk / zero-completion reference.

### M2 — surface-only monitor

May inspect only policy_input. On surface-identical pairs it cannot identify pair membership; this is a diagnostic baseline.

### M3 — acquisition-ledger monitor

May inspect only preregistered acquisition metadata that could exist operationally, such as:

- required source channels;
- source sequence / revision counters;
- retrieved high-water marks;
- source-head versus retrieved-head consistency;
- tombstone/revision-index completion;
- retrieval completion status.

M3 may not inspect hidden event content, Gold world state, treatment labels, or correct actions.

### M4 — oracle completeness gate

Receives formal world-truth completeness. Diagnostic upper bound only; not a method contribution.

## 8. Primary metrics

Metrics must keep evidence support, action correctness, and utility separate.

- **UDR:** decisive action under incomplete formal support.
- **WAVR:** decisive action not permitted by the full hidden-world contract.
- **FEDD:** any output differs from full-information baseline; includes fallback changes.
- **Decisive FEDD:** decisive output differs from full-information baseline.
- **Fallback rate.**
- **Decisive/completion rate.**
- **False-complete rate** of the monitor.
- **False-incomplete rate** of the monitor.
- **Risk-coverage curve:** WAVR versus decisive/completion rate.

For paired worlds also report:

- pair-level at-least-one-world decisive violation;
- both-world fallback rate;
- equal-weight decisive correctness.

## 9. Primary comparison

The intended primary empirical comparison is not yet frozen.

Candidate:

M3 acquisition-ledger monitor versus M0 no-monitor on WAVR, jointly reported with completion rate.

The comparison will be frozen only after the monitor interface and development tests are finalized, before confirmatory outputs.

## 10. Statistical interpretation

- exact counts first;
- family-stratified effects;
- no prevalence language;
- keep family weights fixed in stratified resampling;
- distinguish benchmark resampling uncertainty from population uncertainty;
- do not use a narrow p-value/CI to imply cross-policy or real-world generality.

The surface-identical impossibility result is formal and does not require a significance test.

## 11. Stop rules

Do not:

- modify V1 P1/P2 artifacts;
- inspect confirmatory outcomes before freeze;
- tune monitor thresholds on confirmatory data;
- select models after outcome inspection;
- suppress failed preregistered policies;
- change family weights after outcomes;
- convert M4 oracle performance into a deployability claim.

## 12. Freeze requirements

This document becomes a confirmatory preregistration only after:

- Phase A audit is passing;
- paired-world schema/validator tests are passing;
- development examples pass exact-surface gates;
- non-oracle acquisition-ledger interface is implemented and unit-tested;
- final transition families/sample counts are fixed;
- all policy/model conditions are frozen;
- primary comparison and success thresholds are fixed.

Until then, status remains DRAFT.
