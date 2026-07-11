# Security Hardening Report

Assessment date: 2026-07-11

Assessment baseline: `bf211d91322f20be29a2bbf623802b883699dbc1`

## Status summary

| Control | Status | Evidence | Remaining risk |
| --- | --- | --- | --- |
| Historical secret detection and prevention | **PARTIALLY_FIXED** | Commit `9e15a79cd1feb0af480aa1d4a323128e7591a692`; scanner tests; current index-tree Gitleaks scan has zero findings | Provider revocation and coordinated history rewrite are not confirmed |
| Pairing code isolation | **FIXED** | Pairing code is accepted only by `POST /api/auth/pair/exchange`; HTTP tests reject direct API use and replay | GitHub-hosted CI and packaged desktop runtime are not yet verified |
| Scoped device tokens | **FIXED** | Migration v13; SHA-256 token storage; expiry, revocation, rotation, scopes, `last_used_at`; HTTP tests | Browser extension pairing UI and OS-protected mobile token storage remain incomplete |
| Admin capability isolation | **FIXED** | Admin export/import/delete, settings, MCP transport, and DELETE routes require admin scope; mobile token tests receive 403 | A complete route-to-scope manifest is still needed when the domain schema is centralized |
| Pairing code entropy and lifetime | **FIXED** | Desktop uses OS randomness; code rotates at server start; file modification time creates a 10-minute window; successful exchange is single-use | Physical device/package runtime not yet exercised |
| Browser capture privacy | **NOT_FIXED** | Audit confirms `autoCapture: true` remains the install default | Consent, domain policy, preview, redaction, audit log, and undo are pending |
| ESP32 authentication and replay prevention | **NOT_FIXED** | Existing UDP/hardware protocol audit only | HMAC, nonce, pairing persistence, revocation, rotation, and simulator are pending |
| Remote LLM call audit/disable controls | **PARTIALLY_FIXED** | API-key use is environment/config driven in current code | A unified call audit record and global disable/fail-fast control are pending |

## Scoped authentication model

The local desktop token is an administrative principal and receives all scopes. It remains local-machine state and is not a pairing credential.

Device tokens are random 256-bit bearer credentials. The database stores only `SHA-256(token)`, never the bearer value. Each row records:

- `device_id`
- `device_type`
- `scopes`
- `issued_at`
- `expires_at`
- `revoked_at`
- `last_used_at`

The current device policies are deliberately narrow:

| Device type | Maximum scopes |
| --- | --- |
| Mobile | `memory:read`, `decision:read` |
| Browser extension | `memory:read`, `memory:write`, `decision:read` |
| ESP32 | `memory:write`, `decision:write` |

Requested scopes are intersected with the server policy. Device tokens cannot acquire `admin:export`, `admin:import`, or `admin:delete` through pairing.

Re-pairing the same `device_id` revokes its previous active tokens before issuing a replacement. The local desktop principal can list non-secret device metadata and revoke an active device.

## Database migration

Migration `add_scoped_device_tokens` (v13) creates the device-token table and indexes without modifying existing entity or relationship data. The upgrade test prepares a database with migrations through v12, reopens it, applies v13, and verifies both the table and migration record.

## Modified files

- `brain-server/src/security/auth.ts`
- `brain-server/src/api/routes.ts`
- `brain-server/src/db/sqlite.ts`
- `brain-server/tests/auth.test.ts`
- `desktop-daemon/src-tauri/src/brain_server.rs`
- `mobile-app/src/services/api.ts`
- `mobile-app/src/services/deviceIdentity.ts`
- `mobile-app/src/screens/PairScanScreen.tsx`
- `mobile-app/src/navigation/AppNavigator.tsx`
- `mobile-app/src/services/syncService.ts`
- `security_incident_report.md`
- `security_hardening_report.md`

## Automated verification

- Brain Server TypeScript typecheck: passed.
- Scoped authentication HTTP test: passed.
- v12-to-v13 migration test: passed.
- Mobile TypeScript typecheck: passed.
- Rust `cargo check`: passed with three pre-existing warnings (`cfg(updater)` twice and one unused function).
- Full Brain Server test suite: passed, 6 files and 97 tests.
- `cargo fmt --check`: baseline failure across pre-existing Rust files; not counted as a regression from this change.

## Freeze impact

Overall status: **PARTIALLY_FIXED**.

The direct pairing-code privilege escalation is closed in code and covered by tests. Freeze v1 remains blocked by unconfirmed credential revocation, incomplete browser privacy controls, missing ESP32 authentication, incomplete remote-LLM auditability, and unverified packaged runtime behavior.

The mobile client is explicitly treated as read-mostly for Freeze v1: pairing requests only read scopes, the quick-capture write tab is not registered, and periodic/full sync only pulls from the server. The unused legacy write implementation remains in source for later protocol work but has no active navigation entry and cannot pass server authorization with a mobile token.
