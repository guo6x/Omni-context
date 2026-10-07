# Evidence Surface V2 — Execution Preregistration Draft

**Status:** BLOCKED / NOT FROZEN  
**Confirmatory execution authorized:** **NO**  
**Frozen corpus:** `research/evidence-surface-v2/confirmatory/frozen/paired-worlds.jsonl`  
**Frozen corpus SHA-256:** `944ab3ddf3726bc54f10d5336fc3a6fdab2cb95c5d2049db6c861259b25b755d`

This document specifies the outcome phase. It is intentionally separate from the already frozen corpus.

No confirmatory decision-policy, monitor-conditioned action, retriever-downstream, or LLM outcomes may be executed until every blocker in `EXECUTION_READINESS.json` is resolved and a separate authorization freeze is committed.

## 1. Scientific hierarchy

V2 separates three levels of evidence.

### Level 1 — formal information boundary

Already established by the frozen paired-world construction:

- each pair has exactly the same downstream policy input;
- valid decisive actions are nonempty and disjoint across the two worlds.

For a deterministic surface-only policy, identical input implies identical output. Any decisive output is therefore invalid in at least one member of the pair.

This is the primary conceptual result. It is not a prevalence estimate and does not require a significance test.

### Level 2 — controlled policy / monitor behavior

Measure how often concrete policies choose to act or defer, and how acquisition-side completeness information changes the risk/completion trade-off.

This is a controlled benchmark result.

### Level 3 — retrieval / LLM replication

Test whether the mechanism persists with:

- a pretrained semantic retriever under frozen retrieval budgets; and
- independent LLM decision policies, only when exact reproducible runtimes are available before outcomes.

No Level-3 claim is allowed if those conditions remain unresolved.

## 2. Unit of execution

The frozen corpus contains **160 unique decision surfaces**, each paired with two hidden worlds.

For every surface-only deterministic policy:

- execute the policy **once per unique surface**, not once per world;
- score that single output against both world A and world B.

This prevents duplicate calls on byte-identical inputs from being misrepresented as independent policy observations.

For stochastic or remotely hosted LLMs, the same one-surface-one-call rule is the default. Any repeated-sampling experiment would require a separately frozen repetition count and seed/runtime policy before execution.

## 3. Deterministic decision policies

These are frozen conceptually now; source hashes will be recorded in the final execution freeze.

### P0 — SURFACE_VOTE

A simple surface-only evidence-vote policy.

- reads only `policy_input`;
- selects the candidate with greatest visible support;
- deterministic lexical tie-break;
- DEFER if no candidate has positive visible support.

Purpose: transparent decisive baseline, not a state-of-the-art agent.

### P1 — CURRENTNESS_FIRST

The independently implemented V2 policy in `policy-currentness-first.mjs`.

- reads only `policy_input`;
- handles non-current metadata conservatively when present;
- honors visible current overrides/resolutions;
- otherwise uses visible evidence voting.

All frozen paired surfaces are clean-current, so P1 cannot use hidden pair membership.

Purpose: show that fixing V1's specific `superseded`-cue bug does not break the V2 information boundary.

No deterministic-policy tuning is allowed after confirmatory outcome execution begins.

## 4. Monitor conditions

### M0 — NO_MONITOR

Run the selected decision policy on the visible surface.

### M1 — ALWAYS_DEFER

Return DEFER without a decision-policy call.

Purpose: trivial zero-completion safety reference.

### M2 — SURFACE_ONLY_HEURISTIC

Completeness heuristic may read only `policy_input`.

Frozen rule:

- if any visible evidence is non-current, classify incomplete;
- otherwise classify complete.

Because the frozen V2 surfaces are clean-current, M2 is expected to be unable to identify hidden pair membership. It is a negative control, not a proposed solution.

### M3 — ACQUISITION_LEDGER

Use only frozen acquisition metadata:

- required channel inventory;
- source-head sequence;
- retrieved-head sequence;
- index-complete flag;
- retrieval-complete flag.

M3 may not read:

- hidden event content;
- hidden world state;
- valid action labels;
- pair member;
- formal completeness truth.

Frozen rule:

classify incomplete if any required channel is missing, index/retrieval completion is false, or retrieved head differs from source head.

If M3 says incomplete: DEFER.  
If M3 says complete: execute the selected decision policy on the shared surface.

M3 is a controlled architectural probe, not an oracle and not a universal deployment solution.

### M4 — ORACLE_COMPLETENESS

Uses `surface_complete_truth`.

If false: DEFER.  
If true: execute the selected policy.

M4 is an upper bound / sanity check only and cannot support a deployability claim.

## 5. Frozen ledger-fidelity strata

The corpus contains exactly 40 pairs per profile and 8 per family/profile cell.

- **L0_CLEAN_TRACKED** — source-head state is accurate and exposes the hidden update.
- **L1_BENIGN_ADVANCE** — complete world A has a decision-irrelevant unseen event; conservative head-gap detection can false-incomplete.
- **L2_STALE_SOURCE_HEAD** — harmful hidden update exists but source-head metadata fails to advance; M3 can false-complete.
- **L3_UNTRACKED_CHANNEL** — harmful update arrives on an authoritative channel absent from configured inventory; M3 can false-complete.

Profile frequencies are experimental design weights, not estimates of real-world frequency.

## 6. Primary outcome metrics

### WAVR — World-Action Violation Rate

Among all worlds:

[
WAVR = \frac{\#\{decisive\ outputs\ invalid\ under\ hidden\ world\ contract\}}{\# worlds}.
]

### Completion rate

[
Completion = \frac{\# decisive\ outputs}{\# worlds}.
]

### Pair decisive-violation rate (PDVR)

For each paired surface, mark 1 if at least one of its two worlds receives an invalid decisive output; otherwise 0.

Report:

- PDVR among all pairs;
- PDVR among pairs where the policy is decisive.

### Decisive correctness

A decisive output is correct only when the full `(action_family, selected_candidate_id)` belongs to the hidden world's valid decisive-action set.

### Monitor false complete

Monitor says COMPLETE when `surface_complete_truth=false`.

### Monitor false incomplete

Monitor says INCOMPLETE when `surface_complete_truth=true`.

### Risk-coverage point

For every policy × monitor condition, report the ordered pair:

[
(Completion, WAVR).
]

Do not collapse this trade-off into a single scalar unless a scalar is preregistered before outcomes.

## 7. Primary confirmatory comparisons

There is **no binary winner threshold** and no real-world prevalence hypothesis.

Primary controlled comparisons:

1. **Surface-only bound realization:** P0 and P1 under M0.
   - report completion, WAVR and PDVR;
   - interpret only as behavior on the frozen benchmark.

2. **Acquisition-side information effect:** M3 versus M0 for each deterministic policy.
   - report absolute WAVR difference;
   - report absolute completion difference;
   - report jointly, never safety alone.

3. **Ledger-fidelity sensitivity:** M3 results stratified by L0-L3.
   - no pooling claim about deployment prevalence;
   - all four strata must be reported.

4. **Oracle distance:** M3 versus M4.
   - diagnostic only.

5. **Always-defer distance:** M3 versus M1.
   - quantifies completion recovered relative to trivial abstention.

## 8. Statistical reporting

Because the corpus is procedurally constructed:

- exact counts and rates are primary;
- no p-value will be used to imply real-world prevalence;
- no ordinary iid sample bootstrap will be presented as deployment uncertainty;
- if an interval is reported, it must be explicitly labelled benchmark-resampling uncertainty and preserve family × ledger-profile cell weights;
- family and ledger-profile stratified tables are mandatory;
- negative / null conditions remain in the paper.

The formal paired-world result is proven from the construction and is not a statistical claim.

## 9. Retrieval replication — planned, not yet authorized

A separate retrieval layer will be frozen before it touches confirmatory outcomes.

### Lexical baseline

- BM25 Okapi;
- package target: `rank-bm25==0.2.2`;
- deterministic lowercase/alphanumeric tokenizer to be frozen in source;
- retrieval budgets to be frozen before confirmatory execution.

### Pretrained semantic baseline

Selected model:

- `BAAI/bge-small-en-v1.5`
- Hugging Face revision:
  `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`
- model license: MIT
- sentence-transformers target: `6.1.0`
- cosine similarity over normalized embeddings
- CPU inference acceptable
- exact Python / torch / transformers dependency lock remains a blocker until a dev CI run succeeds.

Retrieval outcomes are forbidden on the frozen confirmatory corpus until:

- source-store/distractor generator is frozen;
- query construction is frozen;
- retrieval budgets are frozen;
- exact Python environment lock is committed;
- the retriever is validated on development-only data.

## 10. LLM policy replication — interface frozen, models unresolved

A common LLM policy interface will require strict JSON:

```json
{
  "action_family": "...",
  "selected_candidate_id": "... or null",
  "decisive": true,
  "reason_code": "..."
}
```

LLM input may contain only the shared `policy_input` plus the frozen decision instruction.

It may not contain:

- world A/B label;
- hidden state;
- ledger profile;
- valid action set;
- completeness truth.

Model selection rules:

- at least two distinct model families are required for an LLM-replication claim;
- exact provider/model snapshot/version must be recorded before outputs;
- prompt, decoding settings, parser and retry policy must be frozen;
- all preregistered models must be reported;
- no replacing a weak model after seeing outcomes;
- if reproducible access cannot be frozen, omit the LLM replication claim rather than substituting post hoc models.

Exact model identities are currently unresolved; therefore LLM confirmatory execution remains blocked.

## 11. Parsing / failure rules

Deterministic policies cannot error silently.

For future LLM conditions:

- transport/API failure is not an outcome;
- a fixed retry policy must be frozen before execution;
- malformed output after allowed retries becomes `PARSE_FAILURE`, not a manually repaired answer;
- parse failure is reported separately and is non-decisive for action metrics;
- no human editing of individual model outputs.

## 12. Stop rules

After execution authorization:

Do not:

- modify the frozen 160-pair corpus;
- change family/profile weights;
- tune M3 using confirmatory errors;
- alter P0/P1 after outcomes;
- alter primary metrics;
- hide failed preregistered models;
- change retriever budgets after inspecting confirmatory retrieval;
- add/remove a model because of its result.

Any implementation bug discovered after outcomes requires:

1. preserve the original run;
2. document the bug;
3. issue a versioned correction;
4. rerun the full affected condition;
5. report the correction transparently.

## 13. Current blockers

Execution remains unauthorized until all of the following are frozen and CI-validated:

1. retrieval source-store/distractor construction;
2. retrieval budgets and exact dependency lock;
3. LLM exact model identities or an explicit decision to omit LLM replication;
4. frozen LLM prompt/parser/retry policy if LLM replication is retained;
5. exact deterministic policy source hashes;
6. exact monitor source hashes;
7. final result table schema;
8. final execution manifest schema;
9. explicit authorization record.

Until then, **do not run any confirmatory outcomes**.
