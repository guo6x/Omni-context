# Hardware E2E Verification Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Protocol (PROTOCOL.md)

| Item | Status | Detail |
|------|--------|--------|
| JSON envelope v1 | FIXED | version, device_id, action, timestamp, nonce, signature |
| HMAC-SHA256 signing | FIXED | canonical payload: version|id|action|timestamp|nonce |
| 32-byte random credential | FIXED | 64 hex chars |
| Timestamp window | FIXED | 120 seconds |
| Nonce replay protection | FIXED | 256 nonces per device, sliding window |
| Device registration required | FIXED | Pairing panel -> RegistryFile |
| Revocation | FIXED | revoked_at disables immediately |
| Key rotation | FIXED | key_version incremented on re-pair |
| Packet size limit | FIXED | 2048 bytes max |
| No packet logging | FIXED | eprintln never logs packet content |
| Protocol document | FIXED | hardware/PROTOCOL.md updated with ACK spec |

## 2. Desktop UDP Listener

| Item | Status | Detail |
|------|--------|--------|
| JSON parsing | FIXED | serde_json deserialization |
| Device verification | FIXED | verify_packet(registry lookup + HMAC + nonce) |
| Signature verification | FIXED | HMAC-SHA256 verify |
| Replay protection | FIXED | recent_nonces per device |
| Paired-only enforcement | FIXED | device.paired && !device.revoked_at |
| Device registry persistence | FIXED | Atomic JSON file (write temp -> rename) |
| Business chain on precipitate | FIXED | capture screen + clipboard -> submit authenticated ingest -> poll job |
| Business chain on decision | FIXED | Open main window + emit decision event |
| Business chain on reset | FIXED | Emit transient-UI-reset only |
| ACK to sender | FIXED | JSON HardwareAck: accepted, status, detail |
| ACK timing | FIXED | After action completion (up to 75s timeout) |
| Loopback default | FIXED | 127.0.0.1:9090 (OMNI_UDP_BIND env override) |

## 3. ESP32 Firmware

| Item | Status | Detail |
|------|--------|--------|
| OTA password removed | FIXED | Uses random device credential |
| First-boot credential | FIXED | generateDeviceCredential() |
| HMAC signing | FIXED | mbedtls HMAC-SHA256 |
| NTP time sync | FIXED | pool.ntp.org + time.cloudflare.com |
| Button debounce | FIXED | 50ms delay |
| Heartbeat | FIXED | 30s interval |
| Credential rotation | FIXED | rotate-key serial command |
| WiFi reconnect | FIXED | 5s interval |

## 4. Simulator

| Item | Status | Detail |
|------|--------|--------|
| Signed packet generation | FIXED | send-signed-packet.mjs |
| ACK reception | FIXED | socket.on('message') handler |
| Non-zero exit on rejection | FIXED | !ack.accepted -> exitCode=1 |
| Timeout handling | FIXED | 80s timeout, non-zero exit |

## 5. Tests

| Test | Count | Status |
|------|-------|--------|
| hardware::accepts_signed_packet_and_rejects_replay | 1 | FIXED |
| hardware::rejects_unknown_bad_signature_expired_and_revoked_packets | 1 | FIXED |
| hardware::registry_survives_reload_without_exposing_credentials | 1 | FIXED |
| hardware_actions::reset_contract_is_non_destructive_by_design | 1 | FIXED |
| hardware_actions::submit_and_wait_runs_authenticated_ingest_business_chain | 1 | FIXED |
| udp_listener::signed_packet_dispatches_action_and_returns_completion | 1 | FIXED |
| mcp_helper | 3 | FIXED |
| **Total Rust tests** | **9** | **All PASS** |

## 6. Gaps

| Issue | Status |
|-------|--------|
| No physical ESP32 connected for E2E test | DEFERRED (simulator covers protocol) |
| ESP32 does not read desktop ACK | PARTIALLY_FIXED (UDP is one-way; ACK not parsed on MCU) |
