# Evidence Surface V2 — Confirmatory Corpus Design

**Status:** design locked for structural candidate generation; outcomes forbidden.  
**Purpose:** prepare a confirmatory corpus without running any decision policy, monitor-conditioned action policy, retriever, or LLM on it.

## Size and balance

Candidate confirmatory size:

- **160 paired-world cases / 320 worlds**
- 5 transition families
- 32 pairs per family
- 16 confirmatory-only domains
- 2 cases per family-domain combination
- 4 acquisition-ledger fidelity profiles, balanced within every family

Transition families:

1. REVOCATION
2. AUTHORITY_WITHDRAWAL
3. CONSTRAINT_CHANGE
4. OUTCOME_REVISION
5. CONFLICT_RESOLUTION_UPDATE

## Why 160 pairs

The paired-world information-boundary result is formal and does not derive its validity from sample size.

The 160-pair corpus is for:

- family-stratified empirical replication;
- monitor sensitivity analysis;
- independent-policy / LLM behavior summaries;
- enough within-family counts to expose heterogeneity without inflating the benchmark with near-identical templates.

It is not intended to estimate real-world failure prevalence.

## Ledger fidelity profiles

Every family contains exactly 8 pairs in each profile.

### L0 — CLEAN_TRACKED

- World A: tracked source head equals retrieved head.
- World B: tracked source head is one event ahead of retrieved head.
- M3 should distinguish the worlds if the ledger is functioning as assumed.

### L1 — BENIGN_ADVANCE

- World A: source head is ahead because of a decision-irrelevant event; formal decision surface is still complete.
- World B: source head is ahead because of the hidden decision-changing transition.
- A conservative head-gap monitor should defer in both worlds.
- This deliberately creates false-incomplete behavior in World A.

### L2 — STALE_SOURCE_HEAD

- World A: source/retrieved heads match.
- World B: a harmful transition occurred, but source-head metadata failed to advance.
- This deliberately creates false-complete behavior for a pure head-gap monitor.

### L3 — UNTRACKED_CHANNEL

- World A: tracked required channel is complete.
- World B: the harmful transition occurs through an authoritative channel absent from the configured channel inventory.
- This deliberately creates an inventory-coverage false complete.

## Expected role of M3

The confirmatory corpus must **not** be designed so M3 is perfect.

M3 is evaluated conditionally on explicit acquisition-ledger fidelity strata. Its scientific role is:

> a non-oracle architectural probe showing what additional acquisition-side state can and cannot recover from an information-insufficient decision surface.

No claim will be made that real deployments have these profile frequencies.

## Surface contract

Every pair must satisfy:

- byte/canonical equality of downstream `policy_input`;
- all visible evidence has `currentness=current`;
- same visible record count, text and metadata;
- same question and candidate set;
- no Gold / correctness / pair-membership / completeness labels in `policy_input`;
- nonempty and disjoint valid decisive-action sets;
- hidden event IDs absent from visible source-event IDs;
- dual validator agreement.

## Split independence

Confirmatory generation uses:

- a separate domain/entity bank from development;
- a separate lexical template bank;
- independent pair IDs and source-event IDs.

Cross-split audit must report:

- exact surface collisions;
- maximum word-trigram Jaccard;
- pairs exceeding the preregistered similarity threshold.

A structural candidate is rejected before freeze if cross-split exact collisions exist or the lexical-leakage gate fails.

## Outcome embargo

Before the full preregistration freeze:

**Allowed**

- generate confirmatory JSONL;
- run schema/construct validators;
- compute duplicate and lexical-similarity diagnostics;
- compute hashes/manifests;
- inspect aggregate structural counts.

**Forbidden**

- run M0-M4 action outcomes on confirmatory pairs;
- run deterministic policy outcomes on confirmatory pairs;
- run LLM prompts on confirmatory pairs;
- run retrievers and inspect downstream decision outcomes;
- change sample composition based on outcome behavior.

## Freeze artifact

The eventual corpus-freeze record must contain:

- pair count and balance;
- generator version;
- generated JSONL SHA-256;
- generator source SHA-256;
- schema SHA-256;
- validator A/B SHA-256;
- structural audit SHA-256;
- CI run ID;
- statement that no confirmatory decision outcomes were executed before the freeze commit.

The corpus freeze does not by itself authorize confirmatory execution. Full preregistration/model/policy freeze is a separate gate.

## Structure workflow trigger status

The structure-only CI workflow is enabled. This section exists only to trigger the first structural candidate run after the workflow file was added. The outcome embargo remains in force.
