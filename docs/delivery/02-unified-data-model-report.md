# Unified Data Model Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Single Source of Truth

| Item | Status | Detail |
|------|--------|--------|
| Domain schema | FIXED | brain-server/src/schema/domain.ts (DOMAIN_SCHEMA_VERSION=1) |
| Entity types | FIXED | 19 types (was misdocumented as 18) |
| Relationship types | FIXED | 30 types with Zod validation |
| Notification types | FIXED | 9 types including proactive_question, conflict, consolidation |
| MCP tools | FIXED | 26 tools (was misdocumented as 14, then 25) |
| Zod schemas generated from domain | FIXED | EntityTypeSchema, RelationshipTypeSchema, NotificationTypeSchema |

## 2. Generated Artifacts

| Artifact | Status | Detail |
|----------|--------|--------|
| schema_manifest.json | FIXED | Auto-generated; 19 entities, 30 relationships, 9 notifications |
| mcp_tool_manifest.json | FIXED | Auto-generated; 26 tools with full input schemas |
| generated_capability_matrix.md | FIXED | Auto-generated; per-product-line breakdown |
| shared/generated-domain-types.ts | FIXED | TypeScript types for shared code |
| mobile-app/src/types/generated-domain.ts | FIXED | Mobile type mirror |
| Schema drift check in CI | FIXED | npm run schema:check; git diff --exit-code |

## 3. Known Drift (Pre-Fix)

| Issue | Was | Now | Status |
|-------|-----|-----|--------|
| Entity type count | 18 in old docs | 19 in code | FIXED |
| Relationship add_relationship API | Missing types | All 30 types exposed | FIXED |
| Notification types | Missing proactive/consolidation | All 9 in schema | FIXED |
| MCP tool count | 14 in product docs | 26 in code | FIXED |
| Manual checklist conflicts | Multiple inconsistent docs | Single generated source | FIXED |

## 4. Contract Tests

| Test | Status |
|------|--------|
| schema-contract.test.ts: deterministic generated types | FIXED (toolCount=26) |
| Schema check in CI (npm run schema:check) | FIXED |
| mcp_tool_manifest.json consistent with tools[] array | FIXED |
