# 12 — AgentLoop real timeout report

Status: **FIXED**

## Implementation

`AgentLoop` now accepts an injected positive `cycleTimeoutMs` for deterministic testing while retaining the four-minute production default. Each cycle owns:

- a local `AbortController`;
- a unique lifecycle token;
- a timeout that aborts the local controller, records `Cycle timeout`, releases the lock, and records the end time.

If a non-abortable database Promise settles after timeout, the invalidated token stops that stale continuation before it mutates data. Its `finally` block cannot clear the controller or lock belonging to a newer cycle.

## Strong timeout test

The test injects a `getEntitiesForConsolidation()` Promise that never resolves, configures a 30ms cycle timeout, and asserts lock release and the `Cycle timeout` error in less than 500ms. The recorded full-suite run measured **53ms**. Before releasing the old Promise, it runs a second cycle successfully. It then releases the old Promise and verifies that the stale cycle does not corrupt the new lifecycle state.

The full Brain Server suite passes 236/236.

Evidence: `evidence/12-13-agentloop-merge-brain-tests.log`.
