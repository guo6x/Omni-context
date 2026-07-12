# Proactive Cognition Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. AgentLoop Task Isolation

| Item | Status | Detail |
|------|--------|--------|
| insight_generation independent | FIXED | One task failure does not block others |
| blindspot_detection independent | FIXED | Runs every 10 cycles; failure logs and continues |
| decay_warning independent | FIXED | Runs every 6 cycles |
| decision_review_reminder independent | FIXED | Runs every cycle; never blocked by insight failure |
| cycleCount persists through empty batches | FIXED | Cycle increments even when no consolidation entities |

## 2. Decay Formula Fix

| Item | Status | Detail |
|------|--------|--------|
| base_weight | FIXED | Per-relationship baseline |
| last_decay_at | FIXED | Incremental time-only decay |
| last_reinforced_at | FIXED | Reinforcement event timestamp |
| reinforcement_reason | FIXED | Why reinforced (e.g., "roundtrip-test") |
| decay_version | FIXED | Version column for formula migration |
| No cumulative re-decay | FIXED | Distance from base_weight, not cumulative |

## 3. Behavior Events (Replacing access_count)

| Event | Status | Detail |
|-------|--------|--------|
| captured | FIXED | record_capture, extract_from_capture, save_conclusion |
| viewed | NOT_IMPLEMENTED | UI-level tracking deferred |
| searched | FIXED | search_entities, vector_search, unified_memory_search |
| retrieved | FIXED | All search/context tools |
| cited | FIXED | ask_memory, graph_answer, analyze/decide |
| edited | FIXED | update_entity |
| decided | FIXED | save_decision |
| alert_shown/clicked/dismissed/rejected | PARTIALLY_FIXED | proactive_insights table with feedback field (useful/not_useful/incorrect/remind_later/stop_this_type) |

## 4. Blindspot Detection

| Type | Status | Detail |
|------|--------|--------|
| consume-without-action | FIXED | behavior_events join confirms no action events follow |
| source-homogeneity | FIXED | Topic clustering by source domain |
| search-without-save | FIXED | Semantic topic filtering with stopwords |
| User deferral respected | FIXED | user_deferred flag check skips |
| No-action-intent skip | FIXED | activity_type check |

## 5. Insight Quality

| Gate | Status | Detail |
|------|--------|--------|
| Graph path discovery | FIXED | generateGraphInsights in graph-insight.ts |
| Semantic consistency | FIXED | LLM polish with validity check |
| Novelty check | FIXED | hasRecentNotification dedup |
| Evidence citation | FIXED | evidenceIds + related_entities |
| User value judgment | FIXED | feedback: useful/not_useful/incorrect/remind_later/stop_this_type |
| Anti-consensus via keywords | PARTIALLY_FIXED | Graph-based; keyword approach superseded |
| Cooldown | FIXED | cooldown_until per insight type |

## 6. Tests

| Test | Count |
|------|-------|
| agent-loop-scheduling.test.ts | 3 |
| blindspot-behavior.test.ts | 2 |
| behavior-events.test.ts | 3 |
| incremental-decay.test.ts | 3 |
