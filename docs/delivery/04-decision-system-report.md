# Decision Intelligence System Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Decision Structure

| Field | Status | Detail |
|-------|--------|--------|
| situation | FIXED | SaveDecisionSchema |
| decision_question | FIXED | Added to schema |
| goals | FIXED | Added to schema |
| selected_option | FIXED | Maps to conclusion if not explicit |
| alternatives | FIXED | String or string[] |
| hard_constraints | FIXED | String array |
| soft_preferences | FIXED | String array |
| evaluation_criteria | FIXED | String array |
| assumptions | FIXED | String array |
| uncertainties | FIXED | String array |
| expected_outcomes | FIXED | String array |
| risks | FIXED | String array |
| supporting_evidence_ids | FIXED | With supported_by relationship |
| opposing_evidence_ids | FIXED | With opposed_by relationship |
| principle_ids | FIXED | With supported_by relationship |
| confidence | FIXED | high/medium/low |
| valid_from / valid_until | FIXED | Temporal fields |
| revisit_at | FIXED | Triggers AgentLoop reminder |
| previous_decision_id | FIXED | Creates explicit lineage relationship |
| supersedes_decision_id | FIXED | Creates supersedes relationship |
| lineage_relation | FIXED | continues/revises/supersedes/reverses/invalidates |
| model_config_snapshot | FIXED | Record<string, unknown> |
| provenance | FIXED | Record<string, unknown> |

## 2. Decision Lineage

| Item | Status | Detail |
|------|--------|--------|
| Recursive query | FIXED | getRecursiveDecisionLineage in decision-store.ts |
| Relationship direction | FIXED | outgoing/incoming tracked |
| Depth tracking | FIXED | depth field per chain node |
| Current vs historical | FIXED | valid_until filtering |
| Change reason | FIXED | change_reason field |
| Invalidation reason | FIXED | invalidation_reason field |
| Evidence binding | FIXED | decision_referenced/supported_by/opposed_by |
| Pending lineage candidates | FIXED | Semantic matches go to pending_confirmation, never auto-link |
| Both MCP entries | FIXED | HTTP handler + stdio server use same decision-store |

## 3. Outcome Feedback

| Item | Status | Detail |
|------|--------|--------|
| actual_outcome | FIXED | RecordDecisionOutcomeSchema |
| outcome_timestamp | FIXED | ISO datetime |
| outcome_score | FIXED | 0-1 float |
| assumption_failures | FIXED | String array |
| unexpected_factors | FIXED | String array |
| lessons_learned | FIXED | String array |
| confidence_calibration | FIXED | -1 to 1 float |
| follow_up_actions | FIXED | String array |
| Outcome entity | FIXED | Creates event entity with outcome_of relationship |
| Principles unchanged | FIXED | Verified in test: single outcome never modifies core principles |

## 4. Review Reminders

| Item | Status | Detail |
|------|--------|--------|
| revisit_at triggers | FIXED | AgentLoop queries decisions with past revisit_at, no outcomes |
| Deduplication | FIXED | hasRecentNotification prevents spam |
| Independent task | FIXED | Review runs even if insight_generation fails |

## 5. Tests

| Test | Status |
|------|--------|
| decision-system.test.ts: complete structure storage | FIXED |
| decision-system.test.ts: recursive lineage + outcome recording | FIXED |
| agent-loop-scheduling.test.ts: review reminder for due decision | FIXED |
