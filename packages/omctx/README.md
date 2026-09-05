# omctx (0.1.0-alpha.0)

`omctx` is the local-first Omni-Context command-line client for
evidence-grounded decision control for long-lived AI agents. It reads decision
context from a local Brain Server and exposes narrowly scoped, authenticated
control-session commands.

This is an alpha candidate. The package remains `private: true` and is **not
published to npm** until an owner explicitly approves publication.

## What this is (and is not)

The CLI is a transport and presentation surface for an existing local
Omni-Context installation. It is not an agent runtime, an execution gateway, a
general HTTP client, a memory database, or an automatic safety/rollback system.
It does not claim compatibility with arbitrary runtimes or memory systems.

The architecture separates Decision Authority from Execution Authority:

```
QUALIFY BEFORE  ->  BIND  ->  READ BACK AFTER  ->  REOPEN
```

Reopen is a separate human-authorized control step. It creates a new immutable
judgment after current evidence is requalified; it does not undo, retry, replay,
or execute the historical action.

## Available commands

```text
omctx --help
omctx version [--json]
omctx doctor [--json]
omctx ask "<situation>" [--json]
omctx inspect <decision-id> [--json]
omctx history [--limit 1..100] [--json]
omctx approve <plan-id> [--json]
omctx verify <plan-id> [--json]
omctx reopen <decision-id> [--reason "..."] [--outcome <outcome-id>] [--json]
```

`ask`, `inspect`, and `history` are read-only decision queries. `approve`
requires a short-lived Desktop `control:approve` session and grants approval
only: **execution has NOT started**. `verify` requires a separate
`control:verify` session and performs trusted read-back, returning exactly
`VERIFIED`, `MISMATCH`, or `INCONCLUSIVE`; a mismatch includes
`revisit_required=true`. Neither command retries a write, executes a process,
or performs rollback.
`reopen` requires a distinct short-lived Desktop `control:reopen` session;
a read, approve, or verify token cannot be used for it. The server derives the
revision lineage, evidence delta, and any fresh plan. A revised `DECIDE` has a
new plan and must receive a new approval; no command starts execution.

## Prerequisites and local security model

The Omni-Context Desktop app must be running with its local Brain Server. The
Brain is reached only over loopback (`127.0.0.1`, `localhost`, or `::1`) and a
version handshake is required before public commands proceed. A read token is
resolved from `OMNI_LOCAL_API_TOKEN` or the Desktop user-scoped token file.
Approval and verification use separate, ephemeral Desktop session files; a
read token cannot be used for either command and tokens are never accepted as
CLI arguments.

The client has a fixed read-tool allowlist, rejects redirects, does not follow
proxy redirects for control traffic, and contains no shell, subprocess,
database, or generic HTTP passthrough surface. The token and session contents
are redacted from output. User-scoped Windows `%LOCALAPPDATA%` storage limits
accidental exposure, but this alpha does **not** claim isolation from another
process already running as the same OS user.

## Output and exit codes

Human output is sent to stdout for successful commands and stderr for errors.
`--json` emits a stable machine-readable envelope. Exit codes are:

```text
0 success | 2 usage | 3 locked/future | 4 authentication
5 service unavailable | 6 contract/data error | 7 internal error
```

`doctor` distinguishes `SERVICE_OK`, `UNSUPPORTED_CONTROL_PROTOCOL`,
`WRONG_SERVICE`, and `AUTH_REQUIRED` through its structured error taxonomy.

## Alpha limitations

- A Desktop + local Brain installation is required; no remote Brain is
  supported.
- The control surface is intentionally limited to approval, trusted read-back,
  and human-authorized reopen. There is no generic execution gateway.
- Verification evidence is limited to the server's trusted local receipt and
  read-back scope.
- Windows ACL hardening beyond user-scoped storage is not asserted; same-user
  OS compromise is outside this alpha threat model.
- Unix end-to-end validation depends on an available trusted runtime; consult
  the release candidate record for the exact validation scope.

## Status

This README records claims proven or designed for the public alpha candidate;
it is not a production-security or universal-agent-safety claim. The package
will remain private until the owner reviews the release candidate and gives a
separate, explicit publication approval.
