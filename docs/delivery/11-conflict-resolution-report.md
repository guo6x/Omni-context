# Conflict Resolution Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Assertion-Based Conflict Model

| Item | Status | Detail |
|------|--------|--------|
| Conflicts act on Assertions/Facts | FIXED | Not entity-pair comparison |
| New fact verified then saved in transaction | FIXED | resolveConflicts with BEGIN IMMEDIATE |
| Old fact invalidated in same transaction | FIXED | invalidated_at set atomically |
| Conflict evidence stored | FIXED | assertion_conflict_audit table |
| LLM context includes entity name + fact text + time + source | FIXED | relationshipEvidence function |
| LLM output Zod-validated | FIXED | parseConflictResolution with ConflictSchema |
| Low confidence conflicts don't auto-invalidate | FIXED | confidence threshold check |
| Manual confirmation + undo | FIXED | audit records support manual review |
| All conflict operations in audit log | FIXED | assertion_conflict_audit with operation, confidence, evidence |

## 2. Transaction Guarantees

| Guarantee | Status | Detail |
|-----------|--------|--------|
| Atomicity | FIXED | db.withTransaction or BEGIN IMMEDIATE |
| Rollback on insert failure | FIXED | Verified: target entity missing -> old fact preserved, audit clean |
| Single-valued relationships enforced | FIXED | SINGLE_VALUED_REL_TYPES (works_at, lives_in, etc.) |
| Migration upgrade safe | FIXED | v17 DB without audit table -> schema upgraded without data loss |

## 3. Tests

| Test | Count | Detail |
|------|-------|--------|
| conflict-transactions.test.ts | 4 | Validation, atomic write, rollback, migration upgrade |
| temporal-assertions.test.ts | - | Temporal conflict scenarios |

## 4. Known Gaps

| Issue | Status |
|-------|--------|
| Conflict detection without LLM (rule-based fallback) | PARTIALLY_FIXED (single-valued relationships auto-resolve) |
| Multi-assertion batch conflict (3+ contradictory facts) | DEFERRED |
