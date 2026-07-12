# Omni-Context Benchmark Metric Rubric v2

**Frozen**: 2026-07-12 | **Schema**: JudgeOutputSchema (Zod strict)

## Overview

All core metrics are normalized to [0,1]. The composite score combines them equally.

## Metric Definitions

### 1. binary_accuracy [0,1]

Core correctness: does the answer match the reference?

| Value | Meaning |
|-------|---------|
| 0 | Completely wrong or contradicted by reference |
| 0.5 | Partially correct, or correct but missing detail |
| 1 | Fully correct per reference |

**Abstention handling**: If reference is "unknown" and candidate says "unknown"/"not stated", score 1. If reference has answer but candidate abstains, score 0.

### 2. factual_score [0,1]

Per-claim truthfulness against reference.

| Value | Meaning |
|-------|---------|
| 0 | Every specific claim is false or unsupported |
| 0.5 | Some claims correct, some wrong or unsupported |
| 1 | All specific claims correct |

Claims not in reference are treated as unsupported (penalized).

### 3. temporal_score [0,1]

Temporal accuracy of the answer.

| Value | Meaning |
|-------|---------|
| 0 | Completely wrong time context |
| 0.5 | Approximately correct (e.g., within a week) |
| 1 | Exactly correct time information |

If question has no temporal component, score 1. Approximate times ("last week" for "5 days ago") can score 0.8-0.9.

### 4. contextual_score [0,1]

Relevance of conversational and situational context.

| Value | Meaning |
|-------|---------|
| 0 | Context completely wrong or irrelevant |
| 0.5 | Some relevant context captured |
| 1 | All relevant context captured |

Cannot assess? Score 0.5 (neutral).

### 5. abstention_accuracy [0,1]

Correct abstention behavior.

| Value | Meaning |
|-------|---------|
| 0 | Should have abstained but answered, or should have answered but abstained |
| 0.5 | Partial hedged abstention |
| 1 | Perfect: answered when answerable, abstained when unanswerable |

Adversarial question: must say "unknown" / "not stated" / "I don't know" for score 1.

### 6. evidence_precision [0,1]

Proportion of cited evidence that is relevant.

**Numerator**: Number of cited evidence items relevant to answer.
**Denominator**: Total evidence items cited.

| Value | Meaning |
|-------|---------|
| 0 | No evidence cited, or all cited evidence is irrelevant |
| 0.5 | Half of cited evidence is relevant |
| 1 | All cited evidence is relevant |

No citations at all? Score 0.

### 7. stale_memory_leakage [0,1]

**Direction: Higher is WORSE (inverted in composite).**

Proportion of answer based on expired/stale facts.

| Value | Meaning |
|-------|---------|
| 0 | No stale facts in answer |
| 0.5 | Some stale facts appear but not central |
| 1 | Answer fundamentally built on stale memories |

## Composite Score

```
(factual_score + temporal_score + contextual_score + abstention_accuracy +
 evidence_precision + (1 - stale_memory_leakage)) / 6
```

All values must be in [0,1]. Missing metrics are errors, not zero-filled.

## Handling Edge Cases

- **Missing judge field**: Question marked error, not silently continued.
- **Metric out of [0,1]**: Schema validation rejects immediately.
- **Unanswerable question answered**: abstention_accuracy = 0, binary also likely 0.
- **No evidence available**: evidence_precision = 0 (precision is about citation quality).
- **Stale fact in answer**: stale_memory_leakage proportion of stale content, not just binary.

## Subset Analysis

- `answerable`: Questions with a ground-truth answer.
- `adversarial`: Unanswerable questions (reference is "unknown").

Both subsets report independent binary_accuracy and composite scores.

## Schema Enforcement

Judge output must pass `JudgeOutputSchema` (Zod strict). Extra keys are rejected. Non-numeric or out-of-range values are rejected. Missing fields are rejected.
