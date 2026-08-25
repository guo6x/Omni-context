Omni-Context - Evidence-grounded decision control for long-lived AI agents.

Usage:
  omctx <command> [args] [flags]

Commands (Current Alpha - read-only plus explicit local approval):
  doctor            Check local Brain Server health, auth and transport
  ask <situation>   Read-only judgment query: principles, precedents, conflicts
  inspect <id>      Inspect one decision by id
  history           Judgment history (newest first; --limit 1..100, default 20)
  version           Print the CLI version

Control (Desktop session required):
  approve <plan-id> Approve one awaiting plan (execution is never started)

Locked (TARGET - fail closed in this Alpha):
  verify            Control surface not enabled (exit 3)

Future:
  reopen            Not implemented (exit 3)

Flags:
  --json            Machine-readable output
  --api-url <url>   Loopback Brain API URL only (default http://127.0.0.1:3001)
  --limit <n>       history page size (1..100, default 20)

This CLI does not execute arbitrary shell commands.
Reads require the local Brain API token. Approve requires an ephemeral
approve-only session explicitly enabled in Omni Desktop; no read token fallback
or token CLI argument is accepted. Approval never starts execution.
