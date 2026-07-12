# ProactiveMemBench Specification

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Overview

A neutral benchmark evaluating proactive memory capabilities: stale memory suppression, timely reminders, blindspot detection, and cross-topic connection discovery.

## 2. Dimensions (8 total)

### 2.1 Stale Memory Suppression
- **Test:** Does the system de-prioritize outdated information without losing historical access?
- **Positive:** Current facts rank above expired facts in general queries
- **Negative:** Outdated job info presented as current without qualification
- **Edge:** Fact expired 5 years ago but user explicitly asked "what was I doing in 2021?"

### 2.2 Proactive Reminder Timing
- **Test:** At appropriate intervals, does the system surface items needing attention?
- **Positive:** revisit_at triggers a notification within 1 AgentLoop cycle
- **Negative:** No reminder for a decision marked "review in 1 month"
- **Edge:** User dismisses reminder; system respects cooldown

### 2.3 Action Gap Detection
- **Test:** When user consumes information but takes no action, is this flagged?
- **Positive:** User searches "buy laptop" 3 times in 2 weeks -> blindspot notification
- **Negative:** Flag raised when user explicitly deferred action
- **Edge:** Multiple searches across different topics; only repetitive intents flagged

### 2.4 Source Homogeneity
- **Test:** Is the system aware when all recent information comes from one domain?
- **Positive:** All captures from Reddit for 3 days -> source diversity alert
- **Negative:** System doesn't distinguish between web domains, files, and AI sources
- **Edge:** User explicitly chose to focus on one source

### 2.5 Cross-Topic Connection
- **Test:** Does the system discover non-obvious links between stored concepts?
- **Positive:** "GraphRAG" and "local-first" are connected via a common project entity
- **Negative:** Connection is purely surface-level keyword match
- **Edge:** Connection exists but is trivial (already known to user)

### 2.6 Anti-Consensus Detection
- **Test:** Does the system identify when user behavior contradicts stated preferences?
- **Positive:** User says "prefer open-source" but last 5 tools are proprietary
- **Negative:** Single exception triggers false contradiction
- **Edge:** Circumstances explain the deviation (work requirement)

### 2.7 Decision Review Reminders
- **Test:** For decisions with revisit_at in the past and no recorded outcome, is the user prompted?
- **Positive:** Decision from 3 months ago with revisit_at=2 months triggers reminder
- **Negative:** Reminder fires for decisions that already have outcomes
- **Edge:** 50 decisions due for review; system batches or prioritizes

### 2.8 Cross-AI Migration & Privacy
- **Test:** Can memory be exported, transferred, and imported without data loss?
- **Positive:** Round-trip export→import preserves all non-sensitive data
- **Negative:** API keys or tokens leak into export
- **Edge:** Merge with existing data (duplicate handling, version preservation)

## 3. Dataset Requirements

| Requirement | Detail |
|-------------|--------|
| Development split | 150+ scenarios |
| Hidden test split | 150+ scenarios with SHA-256 |
| Positives | Good reminders, correct connections |
| Negatives | Missed reminders, false connections |
| Edge cases | Cooldown, deferral, batching, privacy boundaries |

## 4. Scoring

| Metric | Weight |
|--------|--------|
| Stale suppression accuracy | 0.15 |
| Reminder precision/recall | 0.20 |
| Action gap detection | 0.10 |
| Source diversity awareness | 0.10 |
| Cross-topic precision | 0.15 |
| Anti-consensus accuracy | 0.10 |
| Review follow-through | 0.10 |
| Privacy/migration integrity | 0.10 |

## 5. Status

**DEFERRED** - Specification complete; data generation and scoring pending post-freeze.
