# 08 — Task 7: AgentLoop Concurrency Lock in runCycle

**Commit**: `a214b49`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`isCycleRunning = true` (line 193) and `cycleTimeout` (line 194) were inside `stop()`, not `runCycle()`. `runCycle()` (line 259) had no lock — no `isCycleRunning = true` at start, no `false` at end, no try/finally. Consequence: multiple `runCycle()` instances could run concurrently (e.g., if the interval fired while a previous cycle was still running), and `stop()` paradoxically set the lock instead of clearing it.

## Production Entry Point
`AgentLoop` class in `brain-server/src/agent/agent-loop.ts` — instantiated by the Brain Server on startup. `runCycle()` is called on a fixed interval (`setInterval`) to run proactive insight generation, decay warnings, and blindspot detection.

## Call Chain
1. Brain Server starts → `new AgentLoop(db, extractor, llm)` → `start()` sets `setInterval(runCycle, intervalMs)`
2. `runCycle()` fires:
   - **Concurrency guard**: `if (this.isCycleRunning) { this.skippedCycleCount++; return; }`
   - `this.isCycleRunning = true; this.lastCycleStart = new Date();`
   - **Timeout guard**: `setTimeout(() => { if (this.isCycleRunning) { this.isCycleRunning = false; this.lastError = ...; } }, this.cycleTimeoutMs)`
   - `try { ... insight generation, consolidation, decay warning, blindspot detection ... }`
   - `catch (error) { this.lastError = error; }`
   - `finally { clearTimeout(cycleTimeout); this.isCycleRunning = false; this.lastCycleEnd = new Date(); }`
3. `stop()`: clears `setInterval`, does NOT touch `isCycleRunning` (lets in-flight cycle finish naturally with its own timeout guard)
4. `getStatus()`: returns `{ running, cycleCount, skippedCount, lastCycleStart, lastCycleEnd, lastError }` for monitoring

## Modified Files
- `brain-server/src/agent/agent-loop.ts`:
  - `stop()`: removed `isCycleRunning = true` and `cycleTimeout` setup (was the bug — lock set in wrong function); now only clears `this.interval`
  - `runCycle()`: added concurrency guard (`if (this.isCycleRunning) return`), `isCycleRunning = true` at start, `try/catch/finally` with `clearTimeout` + `isCycleRunning = false` in `finally`
  - Added timeout guard inside `runCycle()` that force-releases the lock if a cycle runs too long
  - Added `getStatus()` method exposing `running`, `cycleCount`, `skippedCount`, `lastCycleStart`, `lastCycleEnd`, `lastError`
  - Added private fields: `lastCycleStart`, `lastCycleEnd`, `lastError`

## Tests
- Normal path: `agent-loop-scheduling.test.ts` — `runCycle` sets `isCycleRunning = true` during execution and `false` after; `getStatus()` returns correct cycle count and timing
- Failure path: `agent-loop-scheduling.test.ts` — concurrent `runCycle` calls skip (`skippedCount++`); timeout guard force-releases lock after `cycleTimeoutMs`; `stop()` does not set the lock
- Run: `cd brain-server && npx vitest run tests/agent-loop-scheduling.test.ts`

## Remaining Risk
- The timeout guard force-releases the lock but does not abort in-flight LLM calls — a stuck LLM fetch continues in the background. This is addressed in Task 12 (`5dc1e91`) which adds a cycle-level `AbortController` that cancels in-flight LLM fetches on `stop()` or timeout.
- `getStatus()` is not yet exposed via an HTTP endpoint — it's only callable from within the Brain Server process.
