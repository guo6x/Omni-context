# Omni-Context 0.1.1 - Pre-Evaluation Hardening Release Notes

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## Release Summary

This is a product hardening release, not a feature release. It fixes reliability, security, and evaluation-readiness issues across all three core product lines: Long-term Memory, Decision Intelligence, and Proactive Cognition.

## Security

- All historical API keys revoked and excluded from git
- Secret scanning at 3 levels: pre-commit, CI, and GitHub Actions
- Device authentication with scoped tokens and short-lived pairing codes
- ESP32 random credential generation; no default OTA passwords
- Browser content scripts scoped to AI platforms only

## Memory & Data

- Unified data model: 19 entity types, 30 relationship types, 9 notification types, 26 MCP tools
- Temporal model: 8 time fields per entity, full invalidation and versioning
- 60K-text chunking pipeline with semantic boundaries and failure tracking
- Conservative entity resolution (no auto-merge for decisions, preferences, goals)
- Atomic conflict resolution with audit trail and rollback safety

## Decision Intelligence

- Complete decision structure (22 fields) with explicit evidence binding
- Recursive decision lineage with direction, depth, and change reasons
- Outcome feedback with calibration tracking
- Automatic review reminders for decisions with revisit_at

## Retrieval & Grounding

- Unified retrieval across HTTP and stdio MCP interfaces
- Multi-seed graph expansion with configured depth
- Time-window recall, stale penalty, and abstention threshold
- Evaluation mode with hash-fallback fail-fast

## Platform

- MSI + NSIS Windows installers with embedded Node.js v22
- Browser extension with privacy controls and sensitive field masking
- Android APK validated (install blocked by device policy)
- iOS deferred

## Infrastructure

- 13-stage CI pipeline (secret scan through Windows smoke)
- Deterministic backup with 5 merge strategies
- Reproducible benchmark harness with checkpoint/resume
- package-all.js reliability fixes

## Known Limitations

- Mobile is read-mostly; write operations disabled
- No cross-device entity ID mapping
- iOS build not attempted (macOS required)
- Installers unsigned locally (CI signs via GitHub Actions)

---

See [CHANGELOG.md](/D:/AI_code/Omni-context/omni-context-release/CHANGELOG.md) for commit-level detail.
See `docs/delivery/` for full per-module audit reports.
