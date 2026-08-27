# Security boundaries

The external token is a scoped, expiring device token with the AGENT_PILOT
profile. Pair exchange is the only issuance path. Revocation and expiry are
checked on every request. MCP `tools/list` is filtered to the explicit agent
allowlist, and every `tools/call` is checked again.

The Brain owns evidence qualification and the Decision Kernel owns plans. The
Desktop owns approval and the fixed `execute_ready_plan(plan_id)` action. The
native broker revalidates state, expiry, approval binding, capability, adapter,
and replay ledger before spawning. Process success does not verify reality;
trusted read-back and a deterministic evaluator do.
