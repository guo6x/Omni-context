# Remaining Risks Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Code-Level Risks

| Risk | Severity | Detail |
|------|----------|--------|
| Clippy warnings (10) not fixed | LOW | 10 warnings; no errors; some are dead-code (has_clipboard_content), some are style (collapsible_if). None affect behavior |
| ESLint warnings (12) not fixed | LOW | Unused imports; no errors. Does not affect runtime behavior |
| privacy.js preview UI incomplete | LOW | Sensitive field masking works; preview display deferred |
| ESP32 ACK not consumed | LOW | UDP is fire-and-forget from MCU; desktop ACK is correctly sent |
| Graph insight OPPOSING_KEYWORDS unused | LOW | Dead code from earlier anti-consensus approach |

## 2. Test Coverage Gaps

| Gap | Severity | Detail |
|-----|----------|--------|
| Full brain-server integration test | MEDIUM | Individual units tested; no full-stack server start + query + verify test |
| Mobile E2E sync test | MEDIUM | Product mode verified; no live brain-server sync verified on device |
| Browser extension E2E (live ChatGPT/Claude) | MEDIUM | Fixture tests planned but not implemented |
| ESP32 physical hardware test | LOW | Simulator covers protocol; physical button-to-action chain not tested |
| 1000+ entity scale test | LOW | Migration tests use small DBs; no scale stress test |

## 3. Infrastructure Risks

| Risk | Severity | Detail |
|------|----------|--------|
| CI not run in GitHub Actions | MEDIUM | All local gates pass; CI requires push + network |
| NSIS silent install not verified | LOW | Sandbox blocks exe launch; installer structure validated |
| MSI full install not verified | LOW | Timeout in sandbox; structure verified |
| Release signing | MEDIUM | CI provides TAURI_PRIVATE_KEY; local builds unsigned |
| sqlite-vec platform compatibility | LOW | Verified on Windows; Linux/macOS CI would catch |
| JDK 17 required for Android build | LOW | Documented; Android Studio JBR 21 incompatible |

## 4. Feature Gaps (v2 Scope)

| Feature | Impact | Detail |
|---------|--------|--------|
| Mobile offline queue | HIGH | Writes blocked; no conflict resolution for mobile-originated data |
| Entity ID mapping for sync | HIGH | No stable cross-device ID mapping |
| Incremental sync cursor | MEDIUM | Full pull each time; no delta sync |
| Tombstone GC | LOW | Deleted records accumulate indefinitely |
| ML-based coreference | MEDIUM | Rule-based entity resolution only |
| Rule-based conflict detection | MEDIUM | Relies on LLM for complex conflicts |
| Discussion export | LOW | Discussions stored but not in export format beyond raw JSON |
