Omni-Context - Evidence-grounded decision control for long-lived AI agents.

Usage:
  omctx <command> [args] [flags]

Commands (Current Alpha - read-only):
  doctor            Check local Brain Server health, auth and transport
  ask <situation>   Read-only judgment query: principles, precedents, conflicts
  inspect <id>      Inspect one decision by id
  history           Judgment history (newest first; --limit 1..100, default 20)
  version           Print the CLI version

Locked (TARGET - fail closed in this Alpha):
  approve           Control surface not enabled (exit 3)
  verify            Control surface not enabled (exit 3)

Future:
  reopen            Not implemented (exit 3)

Flags:
  --json            Machine-readable output
  --api-url <url>   Loopback Brain API URL only (default http://127.0.0.1:3001)
  --limit <n>       history page size (1..100, default 20)

This CLI does not execute arbitrary shell commands.
All reads require the local Brain API token (OMNI_LOCAL_API_TOKEN or the
Omni Desktop token file). Nothing here can execute, approve or verify an action.
