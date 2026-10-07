# Evidence Surface V2 — Confirmatory LLM Replication Decision

**Decision status:** FROZEN BEFORE CONFIRMATORY OUTCOMES  
**Decision:** OMIT LLM POLICY REPLICATION FROM THE CONFIRMATORY EXECUTION  
**Confirmatory execution authorized by this document:** NO

## Decision

The V2 confirmatory study will not include an LLM decision-policy condition.

Accordingly, the confirmatory paper must not claim that the measured policy rates generalize across contemporary LLM families.

## Why this is the cleaner confirmatory design

The primary scientific claim is an information-boundary claim: two hidden worlds can expose the same downstream decision surface while requiring disjoint decisive actions. That claim does not depend on a particular language model.

The empirical confirmatory study already contains:

- two deterministic decision policies with frozen source code;
- five monitor conditions;
- four acquisition-ledger fidelity strata;
- BM25 retrieval;
- a pinned pretrained BGE semantic retriever;
- a frozen 160-pair / 320-world confirmatory corpus;
- a leakage-controlled retrieval construction.

Adding LLM policies now would add a second, orthogonal research question about model-specific behavior. A convincing LLM replication would require choosing representative model families, freezing exact weight/provider snapshots, inference runtimes, prompts, parsers, retry behavior, quantization and sampling settings, and then defending those choices as scientifically representative.

Using very small local models merely because they fit CI would improve reproducibility while weakening representativeness. Using large or remotely hosted models would improve capability while weakening reproducibility, cost control, and snapshot stability.

Neither trade-off is necessary for the V2 confirmatory claim.

## Binding consequences

Before any confirmatory outcome is run:

- no LLM model will be selected for the confirmatory matrix;
- no LLM prompt/parser/retry contract is needed for this confirmatory execution;
- the execution manifest must set `llm_replication.enabled=false`;
- the model list must be empty;
- confirmatory result tables will contain no LLM-policy rows;
- the manuscript must state this scope limitation explicitly.

## Anti-post-hoc rule

After confirmatory outcomes are first observed, this decision cannot be reversed merely because an LLM result might strengthen or rescue the story.

Any future LLM study must:

1. be separately preregistered before its own outcomes;
2. freeze model identities/weights or provider snapshots;
3. freeze inference/runtime settings;
4. report all preregistered models;
5. be labeled as a separate follow-up replication, not as part of the original confirmatory execution.

## Claims boundary

Allowed:

> The paired-world information boundary is policy-agnostic as a formal statement, while the measured empirical behavior in this confirmatory execution is limited to the preregistered deterministic policies and retrieval conditions.

Not allowed:

> We empirically demonstrate the effect across LLM families.

No confirmatory LLM inference has been executed as of this freeze decision.
