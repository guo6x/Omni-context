# Mobile Platform Report - Omni-Context 0.1.1

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Platform Status

| Platform | Status | Detail |
|----------|--------|--------|
| Android APK | BUILT | 37.6 MB, arm64-v8a, versionCode=2, versionName=0.1.1 |
| Android Device Install | BLOCKED | MIUI USB policy rejects sideload (INSTALL_FAILED_USER_RESTRICTED) |
| Android Device Test | NOT VERIFIED | Device present (Android 15 API 35, MIUI V816) but install blocked |
| iOS | NOT VERIFIED | No Xcode/macOS build environment |
| Product Mode | read-mostly-companion | MOBILE_WRITES_ENABLED=false enforced |

## 2. Product Architecture

**Positioning:** Freeze v1 mobile is a read-mostly companion. All writes are blocked at the sync service level; only pullFromServer is active.

**Test coverage:**
- `scripts/verify-read-only.mjs` verifies product mode flag, write blocking, and missing QuickCapture component

**Source:** 29 TypeScript/TSX files

## 3. Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| APK cannot be installed on device (MIUI USB policy) | MEDIUM | ENV_BLOCKED |
| iOS build not attempted (no macOS) | LOW | DEFERRED |
| Expo SDK 49 + Gradle 8.0.1 requires JDK 17 (not 21) | LOW | PARTIALLY_FIXED (JDK 17 path documented) |
| Flipper debug deps block offline debug build | LOW | NOT_FIXED |
| No E2E sync test with live brain-server | MEDIUM | DEFERRED |
| No offline queue, tombstones, or conflict resolution | HIGH | DEFERRED (v2 scope) |
| Entity ID mapping not implemented | HIGH | DEFERRED (v2 scope) |

## 4. Build Verification

| Check | Result |
|-------|--------|
| Release APK assembled | PASS (arm64-v8a) |
| APK package name | PASS (com.omnicontext.mobile) |
| APK version | PASS (0.1.1, code 2) |
| APK signing (release) | NOT_SIGNED (by design; CI signs) |
| APK signing (test) | PASS (v1/v2/v3, debug key) |
| APK SHA-256 | 72FB0285E9DD0F6133BB581B2B77B435796B12361D367C08B1209C4B874BB5A6 |
| TypeScript typecheck | PASS (npm run typecheck) |

## 5. Recommendations

1. **Immediate:** Retry USB install with MIUI developer option "USB debugging (Security settings)" enabled, or use `adb install -r -g`
2. **Short-term:** Add E2E sync test (pair + pull + read + verify entities on device)
3. **v2 scope:** Implement offline queue, tombstones, conflict resolution, entity ID mapping, incremental cursor
4. **iOS:** Defer until macOS build host available; mark as NOT VERIFIED in freeze checklist
