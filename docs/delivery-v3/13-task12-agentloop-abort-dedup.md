# 13 — Task 12: Cycle-Level AbortController + Notification Dedup Guards

**Commit**: `5dc1e91`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`stop()` cleared timers but left an in-flight cycle running for up to 4 minutes (the lock-release timeout). LLM calls inside the cycle had their own 30s timeout `AbortController`s, but `stop()` had no way to reach them — the engine kept making LLM calls and DB writes after "stop". Notification creation for `insight` / `decay_warning` / `blindspot` had no `hasRecentNotification` guard at the creation site:
- `insight`: 7-day `cooldownUntil` was recorded in `proactive_insights` but never queried before creating a new insight — same insight fired every cycle
- `decay_warning`: no dedup at all — fired every 6 cycles (~6 min) as long as the same items remained decayed
- `blindspot`: detector-level 24h per-entity-set dedup only — no creation-site safety net if the detector's title-text inference broke

## Production Entry Point
`AgentLoop` class in `brain-server/src/agent/agent-loop.ts` — `runCycle()` creates a fresh `AbortController` per cycle; `stop()` aborts it.

## Call Chain
1. `runCycle()` creates `this.cycleAbort = new AbortController()` at start
2. Signal passed to `polishInsightWithLLM(insight, cycleSignal)` and `InsightGenerator.generateInsight(nodes, cycleSignal)`
3. Both chain the cycle signal to their local timeout controllers via `addEventListener('abort', ...)`
4. `stop()` calls `this.cycleAbort.abort()` → cancels in-flight LLM fetches immediately
5. Cycle timeout guard also aborts the controller (stuck cycle cancels its LLM calls, not just releases lock)
6. `finally` block clears `this.cycleAbort = null` for next cycle
7. Before creating any notification:
   - `insight`: `hasRecentNotification(title, 1)` guard — skip if same title in last 24h
   - `decay_warning`: `hasRecentNotification('记忆衰减预警', 1)` guard
   - `blindspot`: `hasRecentNotification(bs.title, 1)` belt-and-suspenders guard

## Modified Files
- `brain-server/src/agent/agent-loop.ts`:
  - Added private `cycleAbort: AbortController | null` field
  - `runCycle()`: creates fresh `AbortController`, stores on `this.cycleAbort`, passes signal to `polishInsightWithLLM` and `InsightGenerator.generateInsight`
  - `stop()`: calls `this.cycleAbort.abort()` to cancel in-flight LLM fetches
  - Cycle timeout guard also aborts the controller
  - `finally` block clears `this.cycleAbort = null`
  - `polishInsightWithLLM(insight, cycleSignal?)`: chains cycle signal to local timeout controller; cleanup removes listener
  - `InsightGenerator.generateInsight(nodes, cycleSignal?)`: same chaining
  - `insight` creation: added `hasRecentNotification(title, 1)` guard (24h)
  - `decay_warning` creation: added `hasRecentNotification('记忆衰减预警', 1)` guard
  - `blindspot` creation: added `hasRecentNotification(bs.title, 1)` guard

## Tests
- Normal path: `agent-loop-abort-dedup.test.ts` (12 tests) — AgentLoop construct/stop/restart lifecycle; `hasRecentNotification`: fresh DB, after creation, prefix matching, days window (30-day-old notification found by 365-day window but not 1-day), `contentIncludes` substring filter
- Failure path: `agent-loop-abort-dedup.test.ts` — `decay_warning` dedup: manual notification blocks repeat creation; `insight` dedup: same title blocked within 24h; `blindspot` dedup: same title blocked within 24h; `generateInsight` with already-aborted signal fails fast (<5s, not 30s)
- Note: The `AbortError` in the test log is expected — it proves the signal is threaded through to the fetch call.
- Run: `cd brain-server && npx vitest run tests/agent-loop-abort-dedup.test.ts`

## Remaining Risk
- `MemoryDecayScheduler` has an unhandled rejection in tests (known issue, not introduced by this commit) — the scheduler's promise rejection is not caught in the test environment.
- The `AbortError` logged during tests is expected behavior, but in production it could noise up logs if cycles are frequently aborted.
- `hasRecentNotification` queries the `notifications` table by title prefix — if two distinct insights share a title prefix, one could block the other.
