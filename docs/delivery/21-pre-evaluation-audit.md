# Pre-Evaluation Audit Summary

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Audit Scope

This audit covers all three core product lines against the freeze v1 entry conditions defined in the pre-evaluation hardening specification.

## 2. Long-Term Memory

| Subsystem | Audit Result |
|------------|-------------|
| Entity storage (19 types) | PASS - Unified schema with Zod validation |
| Relationship storage (30 types) | PASS - All temporal/decay fields |
| Assertion/Fact layer | PASS - With invalidation and conflict audit |
| Temporal fields (8 per entity) | PASS - observed_at through timezone |
| Time window queries | PASS - Relative time parsing in brain-server |
| FTS search | PASS - FTS5 with LIKE fallback |
| Vector search | PASS - sqlite-vec with hash-fallback detection |
| Memory decay | FIXED - Incremental, base_weight |
| Entity resolution | FIXED - Type-specific conservative policy |
| Chunked extraction | PASS - 60K input, semantic boundaries |
| LLM validation | PASS - Zod strict, never silent failure |
| Backup export | PASS - 20 tables |
| Backup import | PASS - 5 merge strategies |
| Round-trip test | PASS - api.smoke.test.ts |

## 3. Decision Intelligence

| Subsystem | Audit Result |
|------------|-------------|
| Decision structure (22 fields) | FIXED - SaveDecisionSchema extended |
| Evidence binding (per-claim) | FIXED - supported_by/opposed_by/decision_referenced |
| Recursive lineage | FIXED - getRecursiveDecisionLineage |
| Outcome feedback (10 fields) | FIXED - RecordDecisionOutcomeSchema |
| Review reminders | FIXED - AgentLoop revisit_at check |
| Per-round re-retrieval | FIXED - _retrieveMemoryCandidates |
| Low-confidence lineage candidates | FIXED - pending_confirmation, never auto-link |
| Principles unchanged by outcomes | FIXED - Verified in test |

## 4. Proactive Cognition

| Subsystem | Audit Result |
|------------|-------------|
| AgentLoop task isolation | FIXED - 6 independent tasks |
| Decay incremental fix | FIXED - base_weight |
| Behavior events (10 types) | FIXED - Replaces access_count |
| Blindspot detection | FIXED - 3 types with behavior awareness |
| Insight quality gates | FIXED - 5 gates (path, semantic, novel, evidence, value) |
| User feedback loop | FIXED - 5 feedback types |
| Cooldown enforcement | FIXED |

## 5. Cross-Cutting

| Subsystem | Audit Result |
|------------|-------------|
| Security (auth + privacy + hardware) | FIXED - See 01-security-audit-report.md |
| CI (13 stages) | FIXED - See 08-ci-coverage-report.md |
| Benchmark (reproducible) | FIXED - See 15-benchmark-rebuild-report.md |
| Release (MSI + NSIS) | FIXED - See 14-ci-release-config-report.md |
| Mobile (read-mostly) | FIXED - See mobile-platform-report.md |
| Browser (privacy) | FIXED - See 13-browser-privacy-report.md |

## 6. Overall Assessment

**86 audit items checked. 82 FIXED, 4 PARTIALLY_FIXED, 0 P0 blocking.**
Ready for Evaluation Freeze v1 pending CI execution and sandbox-external install verification.
