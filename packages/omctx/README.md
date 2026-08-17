# omctx (alpha candidate - NOT published)

`omctx` is the Omni-Context judgment CLI. This is the **D1A alpha candidate**:
a private, unpublishable package that exposes an **authenticated read-only**
judgment surface against a local Brain Server.

> This package is NOT published to npm (`private: true`). There is no
> `npm i -g omctx` yet. Do not treat `approve` / `verify` as usable: they
> fail closed until a future control-surface gate passes.

## What works in this Alpha

- `omctx --help`
- `omctx version [--json]`
- `omctx doctor` - local Brain health + auth + loopback transport check
- `omctx ask "<situation>"` - read-only judgment query (decision context only;
  ACTION_AUTHORITY = NONE)
- `omctx inspect <decision-id>` - read-only decision inspection
- `omctx history [--limit 1..100]` - judgment history via the fixed
  `GET /api/decisions` endpoint

## Locked / future

- `omctx approve` - TARGET_LOCKED (fail closed, exit 3)
- `omctx verify` - TARGET_LOCKED (fail closed, exit 3)
- `omctx reopen` - FUTURE (exit 3)

## Safety boundaries

- loopback transport only (127.0.0.1 / localhost / ::1); remote URLs rejected
- auth: existing Brain local API token (env `OMNI_LOCAL_API_TOKEN` or the
  Omni Desktop token file); the token is never a CLI argument
- fixed read-only MCP tool allowlist; anything else is rejected locally
- no shell, no subprocess, no generic HTTP passthrough, no direct database
  access

## Development

```
node bin/omctx.js --help
npm test            # node:test suite
npm run smoke       # help/version smoke
npm run pack:dry    # pack dry-run
```
