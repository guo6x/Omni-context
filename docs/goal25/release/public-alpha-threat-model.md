# Omni-Context public alpha threat model

## Scope

This document covers the `omctx` npm candidate, the local Brain HTTP API it
contacts, and the Desktop-created token/session files. The candidate is a
loopback client, not a network service. The analysis does not claim to solve a
compromised OS, a malicious process running as the same user, or compromise of
the Desktop/Brain binaries.

## Assets and trust boundaries

- The read token authenticates the user's local Brain queries.
- Separate five-minute `control:approve` and `control:verify` sessions grant
  narrowly scoped control actions. They are not persisted by Brain and are
  never accepted as command-line arguments.
- Approval records, trusted receipts, and the SQLite database belong to the
  Desktop/Brain installation and are outside the npm tarball.
- The package boundary is an explicit npm `files` allowlist. The tarball is
  checked for secrets, paths, fixtures, databases, Git metadata, and research
  outputs before release.

## Threats and mitigations

| Threat | Mitigation / residual risk |
|---|---|
| Malicious local package consumer | CLI has no shell, subprocess, database, or generic HTTP passthrough; its allowlisted code is auditable. Installing an npm package still executes Node package code at invocation, so use normal npm provenance and review. |
| Malicious browser probing localhost | Brain authenticates business routes, rejects control `Origin`, validates loopback address and Host, and does not treat localhost as an authentication bypass. |
| Stolen read/control token | Read and control scopes are separate, sessions expire in five minutes, control sessions are revoked on restart/disable, and output redaction prevents accidental printing. Same-user malware can still read user files. |
| Package tampering or dependency substitution | Zero runtime dependencies, locked package allowlist, tarball hashes, registry preflight, and a documented provenance recommendation. |
| Typosquat/name collision | `npm view omctx` must be clear immediately before owner publication; collision is a hard stop. |
| Malicious config or environment | API URL is parsed and loopback-only; credentials/query/fragments are rejected; token CLI flags are rejected. Environment values are never copied into config files. |
| Multi-user Windows machine | `%LOCALAPPDATA%` is user-scoped. Explicit ACL isolation from another process is not claimed in this alpha. |
| Old daemon/new CLI or new daemon/old CLI | `/health` publishes `product_version` and `control_protocol_version`; CLI rejects missing or unsupported protocol before network commands. The old CLI cannot be made safe retroactively, so upgrades must be coordinated. |
| Partial upgrade, stale session, downgrade | Health handshake is fail-closed; session expiry and Brain restart revocation make stale control files unusable; package version is surfaced by `version`. |
| Hostile proxy environment | All requests use validated loopback URLs and Node's native fetch without a proxy dispatcher; no `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` value is interpreted by the CLI. Proxy adversarial tests assert the requested URL remains loopback and no proxy headers are emitted. |
| Redirect secret forwarding | Every HTTP method sets `redirect: 'error'`; `Location` is never surfaced or replayed. |

## Authority model

`ask`, `inspect`, and `history` are read-only and declare
`ACTION_AUTHORITY = NONE`. `approve` sends only a plan id through the fixed
approval gateway and visibly states `Execution has NOT started`. `verify` asks
the server to perform trusted read-back and distinguishes `VERIFIED`,
`MISMATCH` (with `revisit_required=true`), and `INCONCLUSIVE`. No command is a
generic execution gateway, and `reopen` remains FUTURE.

## Release claims

`PROVEN_PUBLIC_ALPHA`: loopback-only transport, fixed read allowlist,
zero-dependency tarball, separate control sessions, redirect rejection,
protocol fail-closed behavior, and the command/exit contract exercised by the
release tests.

`DESIGNED_TO`: preserve evidence-grounded decision control across upgrades and
keep Decision Authority separate from Execution Authority.

`FUTURE`: `reopen`, generic execution, automatic correction/rollback, and
universal agent safety.

`DO_NOT_CLAIM`: production-ready security, same-user process isolation, any
runtime/memory-system compatibility, or Linux availability without a trusted
Unix end-to-end run.
