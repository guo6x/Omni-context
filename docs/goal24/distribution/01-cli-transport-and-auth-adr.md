# D1A ADR - CLI transport and auth

## Decision

The omctx CLI uses the existing Brain HTTP API at loopback with Bearer
auth. The canonical MCP transport is `POST /mcp` (JSON-RPC, methods
`ping` / `tools/call`), NOT `/api/mcp/tool/:name`.

## Why POST /mcp JSON-RPC

- It is the protocol layer shared by the stdio and HTTP adapters
  (`brain-server/src/api/handlers/mcp.ts`): same dispatcher, same input ->
  same result. The CLI adds no business semantics.
- Per-tool scope checks happen inside `handleMcpRpcMessage`
  (`scopeForMcpTool`), so the CLI's read-only allowlist is enforced twice:
  locally in the CLI and remotely by the Brain auth layer.
- `/api/mcp/tool/:name` resolves scopes from the path only and carries the
  admin:delete fallback for unknown names; using it from the CLI would
  introduce an unnecessary second path with different error semantics.

## Auth

- Same Bearer token as the existing Brain auth: local token
  (`local_desktop` principal, all scopes). The CLI resolves it from
  `OMNI_LOCAL_API_TOKEN` or the real Desktop token file
  (`%LOCALAPPDATA%/omni-context/local-token.txt` on Windows,
  `~/.omni-context/local-token.txt` on Unix - verified in
  `desktop-daemon/src-tauri/src/brain_server.rs`).
- The token is never a CLI argument and is never copied into any new config
  file. All output passes the central `redactSecrets` scrubber.

## History endpoint

`GET /api/decisions?limit=1..100` was added as a NARROW read-only decision
history route (the Brain had no decision list route). It accepts no search
text, no filters and no arbitrary entity types; the global auth layer maps
paths containing `/decision` to `decision:read` for GET. The CLI never
opens the SQLite file directly (the Brain is the data authority).

## Loopback-only policy

Default `http://127.0.0.1:3001`; `--api-url` accepts only 127.0.0.1 /
localhost / ::1. Anything else is rejected before any request (exit 2,
`OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA`). HTTP redirects are never
followed (`redirect: 'error'`).
