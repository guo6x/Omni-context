# Pilot workflow

1. Agent calls `agent_ask` with the semantic question and inputs.
2. Brain qualifies evidence and returns a disposition and missing/conflicting
   evidence.
3. If explicitly requested and eligible, Brain creates a server-owned plan.
4. Desktop Control Center shows evidence, risk, side effects, expiry and the
   approval requirement.
5. Owner approves. The plan becomes `ready`; no process starts.
6. Owner presses **Run approved action**. The UI sends only `plan_id`.
7. Native broker records a receipt and leaves the outcome `PENDING`.
8. Independent read-back and deterministic evaluation produce VERIFIED,
   MISMATCH, or INCONCLUSIVE. The Agent may observe the final state.
