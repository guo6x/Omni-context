# First-user onboarding (10–15 minute happy path)

1. Start Desktop and wait for the Brain health indicator.
2. Open Connections and confirm GitHub CLI discovery/auth status (no secrets
   are displayed).
3. Create an `AGENT_PILOT` credential through pairing; keep the returned token
   in a protected local file or environment variable.
4. Install the MCP profile and run one `agent_ask` question.
5. Inspect the returned decision and evidence coverage.
6. If eligible, opt in to plan creation and open Control Center → Pending.
7. Enable the explicit Desktop approval session, then press **Approve**.
8. Confirm the card says **Approved ≠ Executed**, then press **Run approved
   action**. The only renderer input is `plan_id`.
9. Enable the separate verification session and choose **Verify reality**.
10. Read the activity timeline and call `agent_outcome` for the final result.

## Doctor checklist

The useful diagnostics are Desktop, Brain health, protocol version, GitHub CLI
discovery/auth, agent profile, MCP connection, approval-session availability,
native broker status, and read-back support. Missing Brain, wrong protocol,
missing/expired token, closed Desktop, unavailable adapter, expired plan, or a
failed read-back are reported as actionable states; raw stacks and secrets are
not shown.
