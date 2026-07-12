# Omni-Context Hardware Protocol v1

Hardware actions use a signed JSON UDP envelope. Plain-text commands and unsigned JSON are rejected.

```json
{
  "version": 1,
  "device_id": "esp32-001122aabbcc",
  "action": "precipitate",
  "timestamp": 1783785600,
  "nonce": "00112233445566778899aabbccddeeff",
  "signature": "64 lowercase hexadecimal characters"
}
```

The signature is HMAC-SHA256 over this exact UTF-8 string:

```text
version|device_id|action|timestamp|nonce
```

The credential is 32 random bytes represented as 64 hexadecimal characters. The HMAC key is the decoded 32-byte value. Supported actions are `precipitate`, `decision`, `reset`, and `heartbeat`.

Security rules:

- A device must be registered in the desktop pairing panel before any packet can trigger an action.
- Timestamps are Unix seconds and must be within 120 seconds of desktop time.
- Nonces are retained per device and replayed packets are rejected, including after restart.
- Revocation immediately disables a credential. Re-pairing the same device ID rotates its key version.
- Packet bodies, signatures, and credentials must not be logged.
- The ESP32 generates its credential on first boot and displays it once on the serial console. `rotate-key` invalidates the previous pairing after the desktop is re-paired.
- OTA authentication uses the same random device credential; there is no default OTA password.

For LAN hardware, explicitly set `OMNI_UDP_BIND=0.0.0.0:9090` before starting the desktop app. The default remains loopback-only.

The simulator can exercise the same UDP envelope without physical hardware:

```powershell
node hardware/simulator/send-signed-packet.mjs --device-id esp32-001122aabbcc --credential $env:OMNI_HW_CREDENTIAL --action heartbeat
```

Use a disposable development credential. The simulator never prints it or the resulting signature.

The desktop replies to the packet source with a JSON acknowledgement. `heartbeat` is acknowledged
after authentication; action packets are acknowledged only after the desktop action worker reports
completion, failure, or the 75-second timeout. The simulator exits non-zero for rejection, action
failure, timeout, malformed acknowledgement, or no acknowledgement.
