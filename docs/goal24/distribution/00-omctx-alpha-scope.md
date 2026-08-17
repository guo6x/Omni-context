# D1A - omctx Public CLI Alpha Candidate - Scope

## What this task delivers

A real, runnable `omctx` Node CLI **package candidate** under `packages/omctx`
with an **authenticated read-only judgment surface** against a local Brain
Server, plus secret/transport hardening and a fail-closed control-surface
gate.

## Hard boundaries (all kept)

- NOT published to npm (`private: true`; no `npm publish`, no name
  reservation beyond the registry-status check).
- NO generic execution, NO public broker execute, NO new public readback or
  approval API. `approve` / `verify` are parser-recognized but FAIL CLOSED
  (exit 3). `reopen` stays FUTURE.
- CP9 NOT started. `main` untouched. Scientific freeze untouched. GitHub
  external state untouched (issues #1/#2/#3 are historical proofs; no new
  fixture was created for this task).

## Real commands in this Alpha

| command | status | side effect | authority |
| --- | --- | --- | --- |
| `--help` | implemented | none | none |
| `version` | implemented | none | none |
| `doctor` | implemented | none (GET /health + MCP ping) | authenticated |
| `ask` | implemented | none (get_decision_context only) | read-only, ACTION_AUTHORITY=NONE |
| `inspect` | implemented | none (get_decision_lineage only) | read-only |
| `history` | implemented | none (GET /api/decisions only) | decision:read |
| `approve` | TARGET_LOCKED | none | - |
| `verify` | TARGET_LOCKED | none | - |
| `reopen` | FUTURE | none | - |

## Verification levels

Feature branch `dev/goal24-omctx-alpha`: at most `VERIFIED_LOCAL_EVIDENCE`.
The candidate carries its own `OMCTX_ALPHA_CANDIDATE_GATE`; being a
candidate PASS does not mean PUBLIC_CLI_AVAILABLE=YES.
