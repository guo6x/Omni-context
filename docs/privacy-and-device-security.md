# Privacy & Device Security (隐私与设备安全)

Status: design + implementation on the product baseline branch. This document
describes the privacy posture of capture, and the device-token security model
for browser / mobile / ESP32, including what is implemented, how it is verified,
and the remaining risks.

## 1. Browser autoCapture: OFF by default (默认关闭)

**Implemented.** `browser-extension/privacy.js`:

- `autoCapture: false` is the default (`DEFAULT_SETTINGS`).
- `migrateSettings()` force-disables autoCapture for legacy users whose
  `privacyConsentVersion !== 1`, and clears `allowedDomains`.
- `evaluateCapturePolicy()` refuses automatic capture unless `autoCapture` is on
  AND the domain is explicitly allowlisted (`reason: 'auto-disabled'`).

Tested in `browser-extension/privacy.test.js` ("automatic capture is off and
requires an explicitly enabled supported domain", "migrates legacy default-on
users back to explicit consent").

## 2. First-enable explicit authorization (首次启用明确授权)

**Implemented.** `browser-extension/popup.js` — flipping the autoCapture toggle
requires an explicit confirmation dialog that states:

- what will be read (the AI conversation on the current supported site);
- where data goes (local Brain Server; if a remote LLM is configured, content
  may leave the machine);
- the domain is only added to `allowedDomains` **after** confirmation.

If the user cancels (or no domain is active), the toggle is reverted.

## 3. Capture scope & exclusion rules (捕获范围与排除规则)

**Implemented.**

Browser (`privacy.js`):

- `SENSITIVE_DOMAIN_PATTERNS`: login/accounts, mail, payments (paypal/stripe),
  banking/health/insurance, password managers — automatic capture is refused.
- `allowedDomains` / `blockedDomains`: per-site opt-in / opt-out.
- `REDACTION_RULES`: private keys, bearer tokens, API keys, password fields,
  credit-card patterns are redacted from captured content.
- `capturePaused` global kill-switch.

Desktop (`desktop-daemon/src/app/page.tsx` + `SettingsPanel.tsx`):

- `capturePaused` default on (privacy-first first-run).
- `captureBlocklist` (sensitive application exclusion): when the foreground
  window matches a blocklist rule, capture is skipped with a privacy notice.

## 4. ESP32 uses a device token (设备 token)

**Implemented.** `hardware/esp32-firmware/src/main.ino` generates a random
32-byte credential on first boot (displayed once on the serial console). Every
UDP packet is an HMAC-SHA256 signed JSON envelope:

```json
{ "version":1, "device_id":"...", "action":"precipitate",
  "timestamp":1783785600, "nonce":"...", "signature":"..." }
```

The desktop (`desktop-daemon/src-tauri/src/hardware.rs`) verifies the signature
with the registered per-device credential. Packets, signatures, and credentials
are never logged. OTA uses the same credential (`ArduinoOTA.setPassword`).

## 5. Nonce / timestamp (nonce/timestamp)

**Implemented.**

- ESP32 mints a fresh random `nonce` per packet (`esp_random`, 32 hex chars).
- `timestamp` is Unix seconds; desktop enforces
  `MAX_CLOCK_SKEW_SECONDS = 120` (±120s of desktop time).
- `hardware.rs` validates nonce format (16-128 hex chars) and timestamp window.

## 6. Replay protection (防重放)

**Implemented.**

- Desktop retains a per-device nonce queue (`recent_nonces`); a replayed nonce is
  rejected with `"replayed hardware packet"` (`hardware.rs`).
- Nonce state is persisted with the device state, so replays are rejected after
  a desktop restart.
- `udp_listener.rs` tests assert replay rejection end-to-end
  (`replay_ack["accepted"] == false`, detail contains `replayed`).
- **Hardening in this round**: `MAX_NONCES_PER_DEVICE` raised 256 → 4096 so a
  local attacker cannot trivially evict old nonces by flooding valid signed
  packets and then replaying inside the 120s window.

## 7. Token revocation (token 吊销)

**Implemented** (two layers):

- **ESP32 credential**: revoking a device in the desktop pairing panel disables
  its credential immediately (`revoked_at`); re-pairing rotates the key
  (`rotate-key`).
- **HTTP device tokens**: `POST /api/auth/devices/:id/revoke` sets
  `revoked_at`; `authenticate()` returns null for revoked tokens → 401.
  Re-pairing the same `device_id` revokes all prior active tokens
  (`AuthService.handlePairExchange`).

Tested: `auth.test.ts` (afterRevoke → 401) and `device-scope.test.ts`.

## 8. Device permission scopes (设备权限作用域)

**Implemented.**

- `AuthService.handlePairExchange` issues tokens only with scopes permitted by
  `DEVICE_SCOPE_POLICY[device_type]` (mobile: `memory:read`, `decision:read`;
  browser/esp32 similar minimum set). Over-requesting (`admin:export`) → 403.
- `requiredScope()` maps each route/tool to a scope; `authorize()` enforces it.
- JSON-RPC `/mcp` `tools/call` checks the per-tool scope
  (`scopeForMcpTool`) before dispatch → `Permission denied: missing scope ...`.
- **New in this round**: `brain-server/tests/device-scope.test.ts` verifies
  end-to-end that a read-scoped device can call `search_entities` but is denied
  `add_entity` (`memory:write`) and `delete_entity` (`admin:delete`), and that
  revocation produces 401 on the very next call.

## Verification summary (验证)

| Layer | Verified by |
|---|---|
| Browser privacy defaults/consent/redaction | `browser-extension/privacy.test.js` |
| Device token issuance/scopes/revocation (REST) | `brain-server/tests/auth.test.ts` |
| JSON-RPC per-tool scope enforcement + revoke-401 | `brain-server/tests/device-scope.test.ts` |
| ESP32 signed envelope + replay rejection | Rust unit/integration tests in `udp_listener.rs` |

## Remaining risks (未决风险)

- **Nonce queue is bounded** (now 4096/device): an attacker with a valid
  credential could still evict older nonces by flooding; the 120s timestamp
  window bounds replay impact. A persistent high-watermark (largest accepted
  nonce per device) is a future hardening.
- **Timestamp-based window** (±120s) assumes roughly synchronized clocks; an ESP32
  with a stale clock must re-sync before packets are accepted (heartbeat
  reports time skew).
- **Local-only network assumption**: `OMNI_UDP_BIND` defaults to loopback; opening
  LAN exposure (`0.0.0.0`) is operator action with no transport encryption
  (HMAC authenticates, does not encrypt). Documented in `hardware/PROTOCOL.md`.
- **Browser redaction is best-effort**: patterns cover common secret formats,
  not arbitrary sensitive text; users are told content may leave the machine
  when a remote LLM is configured.
- **Device token TTL** is 90 days; no automatic re-enrollment prompt is
  implemented yet (tokens simply expire → 401).
