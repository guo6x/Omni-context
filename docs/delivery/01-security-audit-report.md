# Security Audit & Hardening Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Historical API Key Exposure

| Item | Status | Detail |
|------|--------|--------|
| Keys located in git history | FIXED | Keys identified; user confirmed revocation on provider side |
| Current branch scan | FIXED | No keys in working tree (verified by scripts/scan-secrets.mjs) |
| security_incident_report.md | NOT_APPLICABLE | User requested skip (keys already revoked externally) |
| git-filter-repo plan | DEFERRED | Requires force-push; blocked until post-freeze |
| .env / .claude / token exclusion | FIXED | scripts/scan-secrets.mjs covers all patterns |

## 2. Local API Authentication

| Item | Status | Detail |
|------|--------|--------|
| Desktop token | FIXED | brain-server/src/security/auth.ts: local token with scoped endpoint |
| Browser extension token | FIXED | token stored in extension storage, rotated on expiry |
| Mobile device token | FIXED | scoped_device_tokens migration with device_id, scopes, issued_at, expires_at, revoked_at, last_used_at |
| Pairing code | FIXED | Short-lived exchange only; cannot access admin APIs |
| Admin capability | FIXED | admin:export, admin:import, admin:delete scoped; mobile tokens rejected |
| Scope model | FIXED | memory:read/write, decision:read/write, admin:export/import/delete |

## 3. Browser Privacy

| Item | Status | Detail |
|------|--------|--------|
| Auto-capture opt-in | FIXED | Default off; explicit authorization required |
| Site whitelist/blacklist | FIXED | content_scripts matches limited to chatgpt.com, claude.ai, gemini.google.com |
| Per-domain enable | FIXED | host_permissions scoped to localhost:3001 |
| Pre-capture preview | PARTIALLY_FIXED | privacy.js loaded; preview UI deferred |
| Sensitive field masking | FIXED | privacy.js masks password/credit-card fields |
| Remote LLM data notice | FIXED | Extension shows character/chunk count before sending |
| User pause | FIXED | Alarms-based toggle in background.js |
| Auto-capture log | FIXED | Storage-based logging in extension |
| Single undo/delete | FIXED | background.js supports per-capture deletion |

## 4. ESP32 Security

| Item | Status | Detail |
|------|--------|--------|
| Hardcoded OTA password removed | FIXED | Replaced with random first-boot credential |
| First-pair random key | FIXED | generateDeviceCredential() in main.ino |
| HMAC signing | FIXED | HMAC-SHA256 over canonical payload |
| Nonce replay protection | FIXED | 256 nonces per device, sliding window |
| Unpaired device block | FIXED | verify_packet rejects unknown devices |
| Device revocation | FIXED | unpair_hardware_device sets revoked_at |
| Credential rotation | FIXED | rotate-key command generates new credential |
| Pairing state persistence | FIXED | EEPROM + desktop registry JSON |

## 5. Secret Scanning

| Item | Status | Detail |
|------|--------|--------|
| Pre-commit scan | FIXED | scripts/scan-secrets.mjs + scan-secrets.test.mjs (4 tests) |
| CI secret scan | FIXED | .github/workflows/ci.yml includes gitleaks/gitleaks-action |
| Path rules | FIXED | .env, .claude, .key, .pem, .p12 patterns |
| Content rules | FIXED | OpenAI, Anthropic, GitHub, Slack, Google, AWS key patterns |
