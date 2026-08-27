# Omni-Context Agent Pilot contract

The Agent Pilot is a least-authority decision interface. It may ask a real
eligibility question, inspect server-owned plan status, read judgment history,
and observe an outcome. It is never an approval actor and never an execution
or outcome-finalization authority.

## MCP tools

`agent_ask` accepts a question, a trusted capability id/version, and normalized
semantic inputs. Evidence is collected by Brain. `create_plan` is opt-in; an
insufficient or conflicted evidence result never creates a plan.

`agent_inspect`, `agent_history`, and `agent_outcome` are read-only. Approval
references, grant tokens, native bridge secrets, store handles, and raw
process output are omitted from their responses.

Canonical dispositions are `DECIDE`, `CLARIFY`, `DEFER`, and `BLOCK`.
`DECIDE` means evidence is sufficient for the Decision Kernel to materialize a
plan; it does not mean approved or executed.
