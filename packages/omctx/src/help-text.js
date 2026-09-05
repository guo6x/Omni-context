Omni-Context - Evidence-grounded decision control for long-lived AI agents.

Usage:
  omctx <command> [args] [flags]

Commands (Current Alpha - read-only plus explicit local control):
  doctor            Check local Brain Server health, auth and transport
  ask <situation>   Read-only judgment query: principles, precedents, conflicts
  inspect <id>      Inspect one decision by id
  history           Judgment history (newest first; --limit 1..100, default 20)
  version           Print the CLI version

Control (Desktop session required):
  approve <plan-id> Approve one awaiting plan (execution is never started)
  verify <plan-id> Verify through trusted read-back (never writes or retries)
  reopen <decision-id> Re-run a new human-authorized judgment (never executes)

Flags:
  --json            Machine-readable output
  --api-url <url>   Loopback Brain API URL only (default http://127.0.0.1:3001)
  --limit <n>       history page size (1..100, default 20)
  --reason <text>   Optional owner audit reason for reopen only
  --outcome <id>    Optional already-recorded outcome id for reopen only

This CLI does not execute arbitrary shell commands.
Before network commands it requires the Brain /health identity and control
protocol handshake. Doctor reports SERVICE_OK, UNSUPPORTED_CONTROL_PROTOCOL,
WRONG_SERVICE, or AUTH_REQUIRED without exposing credentials.
Reads require the local Brain API token. Approve requires an ephemeral
approve-only session explicitly enabled in Omni Desktop. Verify requires a
separate ephemeral verify-only session explicitly enabled in Omni Desktop;
neither command accepts a read token fallback or token CLI argument. Approval
and verification never start execution, retry writes, or perform rollback.
Reopen requires its own short-lived `control:reopen` Desktop session. It
creates a new judgment after evidence requalification; it never undoes the
original action, reuses an approval/grant, retries, or starts execution.
