# D1A - CLI secret threat model

## Attackers considered

- malicious webpage (cannot reach the token: same-origin policy + loopback
  bearer auth; the CLI itself is not a service)
- malicious local process WITHOUT full user-account control (cannot read
  the token file if permissions hold, cannot intercept CLI memory)
- stolen token file (mitigations: minimal permissions, regeneration path,
  token never copied elsewhere)
- shell history leakage (token can never be a CLI argument)
- stdout/stderr leakage (central redaction on every output path)
- remote redirect / host override (loopback-only + redirect:'error')
- malformed Brain response (strict shape checks, fail closed)
- tool-name injection (fixed allowlist checked before any request)
- path injection / decision-id injection (ids validated, opaque; the CLI
  never constructs filesystem paths from them)
- arbitrary MCP dispatch / HTTP dispatch (no generic request API; fixed
  paths only)
- supply-chain changes (zero runtime dependencies; lockfile-free package)

## Explicit non-claim

This Alpha does NOT claim to defend against a malicious local process that
already fully controls the current user account (same-user process
isolation is not promised).

## Token handling audit result

- Desktop writes the local token with default permissions; on Unix the
  omctx D1A change now chmods it to 0600 after write.
- Windows: the file lives under %LOCALAPPDATA% with the user's default ACL
  (current user + SYSTEM + Administrators); explicit ACL rewriting is
  deferred (TOKEN_FILE_ACL_HARDENING_DEFERRED on Windows) to avoid
  introducing a large security dependency.
- The CLI reads the token only at process start, keeps it in memory, and
  redacts every output path.
