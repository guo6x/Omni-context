# D1A - CLI command contract

## Output contract

Every real command supports `--json` with the envelope:

```json
{
  "ok": true,
  "command": "...",
  "status": "...",
  "data": ...,
  "error": null,
  "meta": { "cli_version": "0.1.0-alpha.0", "server_version": "..." }
}
```

No `undefined`, no stack traces, no raw HTTP responses, no secret headers
ever appear in output.

## Exit code contract (frozen)

| code | meaning |
| --- | --- |
| 0 | SUCCESS |
| 2 | USAGE_ERROR |
| 3 | FEATURE_LOCKED_OR_POLICY_BLOCKED |
| 4 | AUTH_ERROR |
| 5 | SERVICE_UNAVAILABLE |
| 6 | CONTRACT_OR_DATA_ERROR |
| 7 | INTERNAL_ERROR |

## Error codes (frozen subset)

OMCTX_BRAIN_OFFLINE, OMCTX_AUTH_MISSING, OMCTX_AUTH_REJECTED,
OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA, OMCTX_INVALID_DECISION_ID,
OMCTX_DECISION_NOT_FOUND, OMCTX_CONTROL_SURFACE_LOCKED,
OMCTX_UNEXPECTED_RESPONSE, CLI_READ_TOOL_NOT_ALLOWED,
FEATURE_NOT_AVAILABLE, USAGE_ERROR.

## Command semantics

- `ask` -> `get_decision_context` ONLY; always states ACTION_AUTHORITY = NONE;
  never generates an ExecutionPlan or any write.
- `inspect` -> `get_decision_lineage` ONLY; missing fields render
  NOT_AVAILABLE.
- `history` -> `GET /api/decisions` ONLY; newest first; limit 1..100
  (default 20).
- `approve` / `verify` -> OMCTX_CONTROL_SURFACE_LOCKED, exit 3. `verify`
  rejects caller verdict flags (`--success`, `--verified`, `--expected`,
  `--predicate`, `--regex`, `--jsonpath`) as unknown flags.
- `reopen` -> FEATURE_NOT_AVAILABLE, exit 3.

## Config surface (deliberately minimal)

`--api-url` is the only configuration today (plus `--json` / `--limit`
flags). No config file exists; a future config file may only contain
`api_url` / output preferences and never command/shell/executable/hook/
script/plugin/preCommand/postCommand keys.
