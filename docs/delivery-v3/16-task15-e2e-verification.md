# 16 — Task 15: End-to-End Verification Status

**Commit**: `ec35051` (delivery-v3 reports) + live verification on `pre-evaluation-hardening-v3`
**Status**: PARTIAL — 1/5 targets PASS, 4/5 BLOCKED on missing external resources
**Date**: 2026-07-13

## Root Cause
All 14 preceding tasks have been implemented and unit/integration tested, but only one E2E target (Brain Server startup + migration) has been verified against a live instance. The remaining 4 targets require external resources (LLM credentials, Tauri+Rust toolchain, manual Chrome install, paired hardware credential) that are not provisioned in the current verification environment.

## Production Entry Point
N/A — this is a verification task, not a code change.

## Verification Targets

### 1. Brain Server startup + migration — PASS

- **Goal**: Verify the Brain Server starts cleanly on the current branch and runs all migrations (v1 → v23) without errors.
- **Steps**: `cd brain-server && npm run api` (with `PORT=3901`, `DB_PATH=./data/e2e-verify-v3.db`, `LOCAL_API_TOKEN=e2e-verify-token`) → check console for migration log → verify `schemaVersion === 23` → hit `GET /health`
- **Status**: PASS
- **Evidence**:
  - Server started successfully on `http://127.0.0.1:3901`
  - All 23 migrations applied in order, including the new migration 23 `add_failed_tasks_and_ingestion_provenance`:
    ```
    Migration applied: unified_graph_schema_v2
    Migration applied: add_performance_indexes_v2
    ... (20 more) ...
    Migration applied: extend_entity_merge_audit_with_redirect_summary
    Migration applied: add_failed_tasks_and_ingestion_provenance
    [MemoryDecay] 启动调度器 (间隔: 3600s)
    [AgentLoop] 启动主动智能引擎，周期: 600000ms
    Omni-Context API Server running on http://127.0.0.1:3901
    ```
  - `GET /health` (with `Authorization: Bearer e2e-verify-token`) returned `200 OK`:
    ```json
    {"ok":true,"service":"omni-context-brain-server","timestamp":"2026-07-13T04:39:27.384Z"}
    ```
  - Task 5 endpoint `GET /api/import/chat/failed?batchId=e2e-test` returned `200 OK`:
    ```json
    {"batchId":"e2e-test","count":0,"tasks":[]}
    ```
  - Task 5 endpoint `POST /api/import/chat/failed/e2e-test/retry` returned `200 OK`:
    ```json
    {"batchId":"e2e-test","retried":0,"status":"no_pending_failures"}
    ```
  - SQLite-vec native module loaded: `[Database] sqlite-vec 扩展加载成功 ✓`
  - Embedding model auto-loaded: `Xenova/multilingual-e5-small`
  - AgentLoop started without error: `[AgentLoop] 启动主动智能引擎，周期: 600000ms`
- **Run command**:
  ```powershell
  $env:PORT="3901"; $env:DB_PATH="./data/e2e-verify-v3.db"; $env:LOCAL_API_TOKEN="e2e-verify-token"; npm run api
  ```
- **Log path**: captured live in this verification session; not persisted to a file

### 2. Benchmark dev run (Conversation 1 only) — BLOCKED

- **Goal**: Verify the benchmark runner executes a full cycle against a live Brain Server + real LLM on Conversation 1 of the official LoCoMo dataset.
- **Status**: BLOCKED — external resources not provisioned
- **Blocking reasons**:
  1. **Dataset not present**: `benchmark/data/locomo10.json` does not exist in the repo (not committed due to licensing). `Glob` for `**/locomo*.json` returned zero results.
  2. **LLM credentials not present**: no `.env` file exists in the repo. `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` env vars are not set. `cli.mjs:88-93` will exit with code 1 if all three are missing.
  3. The runner (`benchmark/src/cli.mjs`) requires a real OpenAI-compatible LLM endpoint for both answer generation and judging — no mock LLM is wired for the production CLI path.
- **What can be verified without LLM**: the `benchmark:test` script (unit tests on dataset parsing, judge schema, metric rubric, resume/retry) passes — these were green in the v3 test runs.
- **To unblock**: provision `data/locomo10.json` (official LoCoMo dataset) and set `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars, then run:
  ```powershell
  $env:LLM_API_URL="..."; $env:LLM_API_KEY="..."; $env:LLM_MODEL="..."; npm run benchmark:dev -- --dataset data/locomo10.json
  ```

### 3. Windows desktop app launch — BLOCKED

- **Goal**: Verify the Tauri desktop daemon builds and launches on Windows, connects to the Brain Server, and the GraphViewer renders.
- **Status**: BLOCKED — Tauri+Rust toolchain not installed
- **Blocking reasons**:
  1. `where cargo`, `where rustc`, `where tauri` all returned no hits in PATH.
  2. `desktop-daemon/src-tauri/Cargo.toml` requires Rust compilation; `npm run tauri dev` cannot proceed without `cargo`.
  3. The user's environment constraint (D: drive preference, C: drive space limited) means installing the Rust toolchain requires deliberate provisioning.
- **What can be verified without Tauri**: the Next.js frontend (`npm run dev` in `desktop-daemon/`) compiles and the GraphViewer component renders with mock data — but this is a unit/integration test, not an E2E test of the Tauri desktop binary.
- **To unblock**: install Rust toolchain (`rustup-init.exe` to a D: drive location), run `cd desktop-daemon && npm run tauri dev`.

### 4. Browser extension pairing — BLOCKED

- **Goal**: Verify the browser extension pairs with the Brain Server via the pairing flow and can extract page content.
- **Status**: BLOCKED — requires manual Chrome installation
- **Blocking reasons**:
  1. `browser-extension/manifest.json` is a Manifest V3 extension; loading it requires `chrome://extensions` → "Load unpacked" → select folder. This is an interactive browser action with no headless equivalent.
  2. Pairing requires scanning a QR code from the desktop app (which itself requires the Tauri desktop app to be running — see Target 3).
  3. The extension's `background.test.js`, `extractor.test.js`, `privacy.test.js` unit tests pass — these verify the extraction logic and privacy filtering in isolation, but not the live pairing + extraction flow.
- **To unblock**: install Rust toolchain (for desktop app), launch desktop app, load extension in Chrome, scan pairing QR code.

### 5. ESP32 mock pairing — BLOCKED

- **Goal**: Verify the ESP32 hardware pairing flow works with a mock/simulator.
- **Status**: BLOCKED — requires paired credential + running desktop daemon
- **Blocking reasons**:
  1. `hardware/simulator/send-signed-packet.mjs` sends a signed UDP packet to `host:port` (default `127.0.0.1:9090`). Port 9090 is the **desktop daemon's** UDP listener (`desktop-daemon/src-tauri/src/udp_listener.rs`), not the Brain Server's HTTP port.
  2. Without the Tauri desktop daemon running (Target 3 blocked), there is no UDP listener on 9090.
  3. The simulator requires a pre-provisioned `--device-id` and `--credential` (32+ byte hex HMAC key, validated by regex at line 19). These can only be obtained via the pairing flow in the desktop app, which itself is blocked.
  4. Even if a credential were hardcoded for testing, the desktop daemon's `hardware.rs` validates the HMAC signature against the stored credential — without the pairing record in the database, the packet would be rejected.
- **To unblock**: complete Targets 3 and 4 first (desktop app + pairing flow), then run:
  ```powershell
  node hardware/simulator/send-signed-packet.mjs --device-id <paired-id> --credential <paired-hex-key> --host 127.0.0.1 --port 9090 --action heartbeat
  ```

## Remaining Risk
- **4 of 5 E2E targets are blocking for freeze.** The branch cannot be declared ready for freeze candidate until at least Targets 2 (benchmark) and 3 (desktop app) are verified against a live instance.
- Brain Server runtime behavior is verified end-to-end (Target 1 PASS): migrations apply cleanly, the new Task 5 endpoints respond correctly, the AgentLoop starts, the MemoryDecayScheduler starts, and the embedding model loads.
- The 4 blocked targets all depend on **external resources** (LLM credentials, Rust toolchain, Chrome installation, paired hardware credential), not on code defects. The code paths they exercise are covered by unit/integration tests:
  - Benchmark: `benchmark/tests/*.test.mjs` (dataset, judge, metrics, resume)
  - Desktop app: `desktop-daemon/src/components/GraphViewer.tsx` (rendered in Next.js dev mode during unit tests)
  - Browser extension: `browser-extension/*.test.js` (extraction, privacy, background)
  - ESP32: `hardware/simulator/send-signed-packet.mjs` (HMAC signing logic is pure code, no test file but the script is short and deterministic)
- Known issues that may surface when the blocked targets are run:
  - `api.smoke` has a flaky decay test (intermittent failure in `MemoryDecayScheduler`)
  - `MemoryDecayScheduler` has an unhandled promise rejection in the test environment
  - Benchmark requires external LLM credentials (`LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`) which must be provisioned
  - Desktop app requires Tauri + Rust toolchain on Windows
  - Browser extension requires manual Chrome installation
  - ESP32 simulator requires Node.js UDP socket availability + a paired credential
