# DecisionMemBench Specification

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Overview

A neutral, system-independent benchmark evaluating memory-grounded decision support. Tests whether a memory system provides complete context for decision-making without making the decision for the user.

## 2. Dimensions (10 total)

### 2.1 Context Completeness
- **Test:** Given a user with stored preferences, goals, and past decisions, does the system retrieve ALL relevant context?
- **Positive:** System returns the hard constraint, relevant past decision, and user goal
- **Negative:** System misses a stored preference that directly contradicts the proposed option
- **Edge:** User has 50+ stored preferences; only 3 are relevant

### 2.2 Hard Constraint Recognition
- **Test:** Does the system distinguish hard constraints from soft preferences?
- **Positive:** System flags that "must have offline capability" is a hard constraint from past decisions
- **Negative:** System treats "nice to have dark mode" as equally binding
- **Edge:** Constraint was stated in one conversation but never explicitly called a "constraint"

### 2.3 Principle Consistency
- **Test:** Does the system check stored principles against the current decision?
- **Positive:** System cites "prefer local-first ownership" principle when cloud option is proposed
- **Negative:** System ignores a directly relevant principle
- **Edge:** Two principles conflict; system must surface both with evidence

### 2.4 Insufficient Information & Clarification
- **Test:** When evidence is insufficient, does the system ask clarifying questions instead of guessing?
- **Positive:** System returns "insufficient_evidence" with specific questions
- **Negative:** System generates confident advice from weak evidence
- **Edge:** Surface-level info exists but deeper context (budget, timeline) is missing

### 2.5 Option Trade-off Analysis
- **Test:** For each pro/con/risk, does the system cite specific evidence?
- **Positive:** Each pro con has evidence_ids, evidence_type, inference_level, confidence
- **Negative:** All sources marked as generic "relevant"
- **Edge:** Evidence contradicts itself (old pref vs new behavior)

### 2.6 Decision Updates
- **Test:** When user changes their mind, does the system create a proper decision chain?
- **Positive:** New decision has continues/revises/supersedes relationship to old one
- **Negative:** Old decision is simply deleted or orphaned
- **Edge:** Decision is reversed after 6 months with new evidence

### 2.7 Decision Lineage
- **Test:** Can the system recursively trace all decisions in a chain?
- **Positive:** get_decision_lineage returns all ancestors with direction, depth, and reasons
- **Negative:** Only returns 1-hop relationships
- **Edge:** Decision chain has 10+ nodes with branches

### 2.8 Robustness
- **Test:** Does the system handle adversarial inputs gracefully?
- **Positive:** System handles contradictory facts with explicit conflict markers
- **Negative:** System silently picks one version
- **Edge:** Multiple users/agents contributed conflicting information

### 2.9 Outcome Feedback
- **Test:** Does the system record and learn from outcomes without auto-modifying principles?
- **Positive:** Outcome recorded with assumptions_failed, lessons_learned, calibration
- **Negative:** Single bad outcome changes a core principle
- **Edge:** One assumption failed but overall outcome was positive

### 2.10 Confidence Calibration
- **Test:** Is the system's stated confidence aligned with actual outcomes?
- **Positive:** System reports lower confidence when evidence is sparse
- **Negative:** All decisions marked "high" confidence regardless of evidence
- **Edge:** Multiple outcomes show systematic overconfidence

## 3. Dataset Requirements

| Requirement | Detail |
|-------------|--------|
| Development split | 200+ scenarios across all 10 dimensions |
| Hidden test split | 200+ scenarios with fixed SHA-256 |
| Positives | Scenarios where correct context should be retrievable |
| Negatives | Scenarios where insufficient evidence should trigger abstention |
| Edge cases | Boundary conditions (conflicts, sparse data, temporal shifts) |
| System names anonymized | Human evaluator blind review |

## 4. Scoring

| Metric | Weight | Description |
|--------|--------|-------------|
| Context completeness | 0.15 | All relevant entities retrieved |
| Constraint recognition | 0.15 | Hard vs soft distinguished |
| Principle consistency | 0.10 | Principles cited when relevant |
| Clarification quality | 0.10 | Appropriate questions when evidence lacking |
| Evidence binding | 0.15 | Each claim has evidence_ids |
| Lineage correctness | 0.10 | Recursive chain accuracy |
| Outcome calibration | 0.10 | Predicted vs actual alignment |
| Robustness | 0.10 | Adversarial handling |
| Abstention accuracy | 0.05 | Correctly says "I don't know" |

## 5. Status

**DEFERRED** - Dataset design complete; data generation and scoring scripts pending post-freeze.
