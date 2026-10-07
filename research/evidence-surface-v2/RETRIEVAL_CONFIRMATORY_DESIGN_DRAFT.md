# Evidence Surface V2 — Retrieval Confirmatory Freeze Design

**Status:** DRAFT / OUTCOME EMBARGO ACTIVE  
**Confirmatory retrieval outcomes authorized:** **NO**

This document fixes the retrieval-layer design constraints that must be satisfied before the frozen 160-pair confirmatory corpus is touched by BM25 or BGE ranking.

## 1. Physical truth firewall

Retrieval construction produces two files:

1. `retriever-input.jsonl` — the **only** file passed to BM25/BGE.
2. `scoring-truth.jsonl` — held back until ranking is complete and used only for scoring.

The retriever input must not contain:

- pair ID;
- A/B member;
- family or ledger profile;
- target document ID;
- valid decisive actions;
- formal completeness truth;
- `is_target`, Gold, correctness, or treatment labels.

The truth sidecar binds opaque `case_id` values back to scoring metadata only after ranking.

## 2. Opaque identifiers

Retriever-visible case, document, and source-event IDs are deterministic hash-derived opaque identifiers.

IDs must not contain semantic tokens such as:

- `target`
- `hidden`
- `transition`
- `visible`
- `distractor`
- family names
- A/B membership.

Stable tie-breaking may use opaque document IDs only.

## 3. Matched transition slot

For each paired world:

- A and B have exactly the same document count;
- A and B have exactly the same ordered document-ID list;
- all non-slot documents are byte/canonical identical;
- exactly one shared opaque slot differs semantically.

World A slot:

- decision-irrelevant matched control;
- no candidate support;
- same token count as the B transition document;
- same timestamp position.

World B slot:

- the authoritative decision-changing transition;
- structured role/currentness/support metadata needed by the downstream policy.

The matched slot removes corpus-size, document-count and obvious identifier side channels. It does **not** make A and B retrieval corpora identical; retrieval is supposed to detect semantic evidence when it exists.

## 4. Development gate before confirmatory construction

Before confirmatory retrieval construction is frozen, the development-only workflow must pass:

- input/truth schema checks;
- truth-field recursive leakage audit;
- equal A/B document counts;
- identical A/B document ID order;
- non-slot document identity;
- matched slot token-count equality;
- opaque ID checks;
- BM25 and pinned BGE execution;
- downstream scoring tests.

No confirmatory retrieval ranking is permitted to repair a development failure.

## 5. Frozen retrievers

The planned retrieval conditions remain:

- BM25 Okapi, `rank-bm25==0.2.2`;
- `BAAI/bge-small-en-v1.5`, revision `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`;
- normalized embeddings;
- cosine similarity via dot product;
- CPU;
- stable opaque-ID tie-break;
- budgets `k ∈ {2,4,6}`.

The exact resolved Python environment must be committed as a lock and reproduced on development data before authorization.

## 6. Confirmatory construction-only step

After the development gate passes, a construction-only workflow may generate the 160-pair retrieval input/truth bundle and record hashes. It must **not** invoke:

- BM25 ranking;
- BGE encoding/ranking;
- downstream policy scoring;
- M0-M4 outcome computation;
- any LLM.

Confirmatory retrieval execution remains blocked until the separate execution authorization freeze.
