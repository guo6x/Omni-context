# 16 — Task 15: End-to-End Verification Status

**Commit**: N/A (verification not yet run)
**Status**: PENDING
**Date**: 2026-07-13

## Root Cause
All 14 preceding tasks have been implemented and unit/integration tested, but no end-to-end verification has been run against a live Brain Server, real LLM, desktop app, browser extension, or ESP32 hardware. The code compiles and unit tests pass, but production runtime behavior is unverified.

## Production Entry Point
N/A — this is a verification task, not a code change.

## Verification Targets

The following 5 E2E verification targets have **NOT** been run yet:

### 1. Brain Server startup + migration
- **Goal**: Verify the Brain Server starts cleanly on the current branch and runs all migrations (v1 → v23) without errors.
- **Steps**: `cd brain-server && npm run dev` → check console for migration log → verify `schemaVersion === 23` in `api.smoke` → hit `GET /api/health`
- **Status**: NOT RUN

### 2. Benchmark dev run (Conversation 1 only)
- **Goal**: Verify the benchmark runner executes a full cycle against a live Brain Server + real LLM on Conversation 1 of the official LoCoMo dataset.
- **Steps**: Set `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` env vars → start Brain Server → `npm run benchmark:dev -- --dataset data/locomo10.json` → verify `results.jsonl` is written → verify `manifest.json` status is `completed` or `partial`
- **Status**: NOT RUN

### 3. Windows desktop app launch
- **Goal**: Verify the Tauri desktop daemon builds and launches on Windows, connects to the Brain Server, and the GraphViewer renders.
- **Steps**: `cd desktop-daemon && npm run tauri dev` → verify window opens → verify Brain Server connection → verify GraphViewer loads entities
- **Status**: NOT RUN

### 4. Browser extension pairing
- **Goal**: Verify the browser extension pairs with the Brain Server via the pairing flow and can extract page content.
- **Steps**: Load extension in Chrome → trigger pairing → verify token exchange → navigate to a page → trigger extraction → verify entity appears in Brain Server
- **Status**: NOT RUN

### 5. ESP32 mock pairing
- **Goal**: Verify the ESP32 hardware pairing flow works with a mock/simulator.
- **Steps**: Run `hardware/simulator/send-signed-packet.mjs` → verify Brain Server receives signed UDP packet → verify pairing completes → verify hardware event appears in UI
- **Status**: NOT RUN

## Remaining Risk
- **All 5 targets are blocking for freeze.** Until E2E verification is run, the branch cannot be declared ready for freeze candidate.
- Known issues that may surface during E2E:
  - `api.smoke` has a flaky decay test (intermittent failure in `MemoryDecayScheduler`)
  - `MemoryDecayScheduler` has an unhandled promise rejection in the test environment
  - Benchmark requires external LLM credentials (`LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`) which must be provisioned
  - Desktop app requires Tauri + Rust toolchain on Windows
  - Browser extension requires manual Chrome installation
  - ESP32 simulator requires Node.js UDP socket availability
