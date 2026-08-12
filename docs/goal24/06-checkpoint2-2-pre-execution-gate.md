# Goal24 Checkpoint 2.2 — Integration: Pre-Execution Gate

Date: 2026-08-13
Status: CHECKPOINT_2_2_PRE_EXECUTION_GATE (integration complete; no process execution added)
Base: `2cc35b5eed48c780ad4c1b7ef1de1bd793c6f2d4` (origin/dev/goal24-cli-skills)
Integration branch: `local/cp2.2-integration` (worktree `D:\ai_code\Omni-context-worktrees\cp2.2-integration`)

This checkpoint integrates the three parallel CP2.2 lanes and closes the last
pre-CP3 security blocker (the vulnerable `rustls-webpki` TLS stack on the
desktop daemon). It adds **no process execution implementation**.

## 1. Integration base

- `origin/dev/goal24-cli-skills` at start: `2cc35b5eed48c780ad4c1b7ef1de1bd793c6f2d4` (verified after `git fetch --all --tags --prune`; unchanged during the task).
- All three lanes were based on the same SHA.

## 2. Integrated commits

Lane commits are preserved as-is (original SHAs listed; cherry-picked SHAs in
the integration branch in parentheses).

| Lane | Original commit | Message | Integrated SHA |
| --- | --- | --- | --- |
| A (fix) | `0fc4b949abe0443fdfcb25c2e5f95d6264c73f50` | fix(execution): make evidence qualification fail closed | `d699ef9` |
| A (docs) | `efc2523ca0d87849ce663204854a02b8aff8a7ef` | docs(goal24): add cp2.2 lane A evidence report | `889bcc0` |
| B | `f53bac3d39d329a2dd6d8915df3c2472ed672495` | security(brain-server): close pre-execution runtime advisories | `037ebbf` |
| C | `de8d1d50a05ced48d78cfccc72e4bf599703a8ba` | security(tauri): establish Rust advisory gate and broker threat model | `51fde10` |
| Rust gate closure | `2da7f55` | security(tauri): close pre-execution TLS advisory gate | — |
| Final docs | (see commit after this document) | docs(goal24): finalize checkpoint 2.2 pre-execution gate | — |

## 3. Evidence semantics (Lane A)

Integrated and verified by the full vitest suite (41 files / 479 tests):

- `mandatory unverified` = **BLOCK**, including when `verification_requirement` is
  undefined or `none` (fail-closed).
- Undeclared `conflict_policy` = **reject** via the canonical
  `effectiveConflictPolicy()` helper in `brain-server/src/capabilities/contracts.ts`.
- Optional evidence can **never** block execution: optional gaps land in
  `CoverageAssessment.non_blocking_findings` (or `warnings` for tolerated
  conflicts), never in `blocking_reasons`.
- Tests: `tests/goal24-execution-contracts.test.ts` (fail-closed 2.2 suite)
  and `tests/goal24-capability-contracts.test.ts` cover all of the above.

## 4. Node security (Lane B)

Integrated. Dependency-tree verification (`npm ls`) confirms the overrides are
effective with no duplicate vulnerable runtime version on the execution-adjacent
path:

- `@modelcontextprotocol/sdk@1.29.0` → `@hono/node-server@2.1.0` (overridden) → `hono@4.12.34` (deduped)
- `fast-uri@3.1.5` (overridden, under `ajv`), `ip-address@10.5.0` (overridden),
  `undici@7.29.0` (overridden), `glob@10.5.0` / `brace-expansion@2.1.4` (scoped overrides under `archiver`).
- The remaining `glob@7.2.3` is install-time only (`sqlite3` → `node-gyp`), not a runtime path.

### 4.1 Major transitive override

`@hono/node-server` `1.19.14 → 2.1.0` is a **MAJOR VERSION TRANSITION**
(SemVer), even though it is a transitive override driven by the MCP SDK's
`^1.19.9` range. Lane B's `MAJOR_UPGRADE_USED=NO` wording is **corrected** here:

```
major_transitive_override=true
```

### 4.2 `npm audit --omit=dev --audit-level=critical`

16 findings remain (1 critical `tar`, 4 high: `brace-expansion` (1.1.x
install-time chain), `@xenova/transformers`, `sharp`, `xlsx`; 8 moderate;
3 low). All are classified:

- `tar` (critical): `sqlite3` → `node-gyp` **install-time** chain; brain-server
  runtime never imports `tar`. Fix requires `sqlite3@6` semver-major (owner decision).
- `brace-expansion` 1.1.x: install-time chain (`node-gyp` → `glob@7.2.3`).
- `@xenova/transformers` / `sharp`: optional local-embedding chain (runtime
  import is dynamic and guarded; not on the Goal24 execution path).
- `xlsx`: spreadsheet ingestion only; no npm fix exists (SheetJS distribution discontinued).
- `protobufjs` / `onnx-*` / `node-gyp` / `make-fetch-happen` / `cacache` /
  `http-proxy-agent` / `@tootallnate/once` / `qs` / `body-parser`: embedding or
  install-time chains, or `express` transitive deps never imported by the
  brain-server runtime (verified: no runtime `express`/`body-parser`/`qs`/`tar`
  imports in `brain-server/src`).

**Execution-adjacent unresolved: 0** (`UNKNOWN=0`, `FIX_BEFORE_CP3=0`, `BLOCKS_CP3=0`).

### 4.3 MCP / API runtime smoke — PASS

The major transitive override was validated with a real runtime smoke (not
unit tests only):

- `node dist/api-server.js` with a fresh temp DB (`OMNI_EVALUATION_MODE=1`,
  `LOCAL_API_TOKEN` set): server starts, migrations apply, listens on `127.0.0.1`.
- `GET /health` → `200` `{"ok":true,...}`.
- MCP HTTP surface `POST /mcp`: `initialize` → `200`, `tools/list` → `200`,
  read-only `tools/call get_stats` → `200` with valid JSON result.
- REST read-only `GET /api/memory/core/stats` → `200`.
- SDK `streamableHttp` module loads against `@hono/node-server@2.1.0`;
  `serve()` from `@hono/node-server` + `hono` answered `200`.
- Clean shutdown via SIGTERM; no runtime import/API incompatibility observed.

No destructive MCP operation was invoked; no Holdback data was accessed.

## 5. Rust advisory gate (Lane C) and integration root cause

Lane C's audit (`docs/goal24/audit-tauri-rust.json`, cargo-audit 0.22.2,
advisory DB `D:\environment\advisory-db`, 1216 advisories) found 8
vulnerabilities and classified the `rustls-webpki 0.101.7` cluster
(RUSTSEC-2026-0098 / 0099 / 0104) as `FIX_BEFORE_CP3`.

Integration re-analyzed the real dependency/features path:

- `rustls-webpki 0.101.7` ← `rustls 0.21.12` ← `hyper-rustls 0.24.2` /
  `tokio-rustls 0.24.1` ← `reqwest 0.11.27` ←
  - `omni-context-desktop` (direct `reqwest` with `default-features=false, features=["json","rustls-tls"]`), and
  - `tauri 1.8.3` (feature `updater`; `reqwest` with default features → `default-tls`/native-tls).
- Feature unification: the single `reqwest 0.11.27` build carried **both**
  `rustls-tls` (enabled **only** by the direct dependency) and `default-tls`
  (enabled by tauri/updater).
- Updater is shipped active: `tauri.conf.json` `updater.active=true`, endpoint
  `https://github.com/guo6x/Omni-context/releases/latest/download/latest.json`;
  the production build (`tauri build -c src-tauri/tauri.prod.conf.json`) merges
  over the base config and does not disable the updater. (`tauri.ci.conf.json`
  disables the updater for CI builds; pre-existing.)
- Direct `reqwest` usage in the daemon is localhost-only
  (`hardware_actions.rs`, `DEFAULT_BRAIN_URL = "http://127.0.0.1:3001"`);
  no `https://` call exists in `desktop-daemon/src-tauri/src`.

### 5.1 Fix applied (Option A — feature pruning)

Removed the unnecessary direct `rustls-tls` feature:

```toml
reqwest = { version = "0.11", default-features = false, features = ["json"] }
```

- The vulnerable `rustls 0.21 / rustls-webpki 0.101.7 / hyper-rustls /
  tokio-rustls` stack is eliminated from the dependency graph (Cargo.lock
  −86 lines; `cargo tree -i rustls-webpki@0.101.7` → no match).
- The Tauri updater keeps its HTTPS path via `reqwest` default features →
  `default-tls` → native-tls (schannel on Windows). **The updater was NOT
  disabled and no product feature was removed.**
- Direct daemon HTTP calls (localhost) are unaffected.

### 5.2 RustSec disposition

| Advisory | Disposition | Evidence |
| --- | --- | --- |
| RUSTSEC-2026-0098 | **FIXED** | `rustls-webpki 0.101.7` removed from the dependency graph; no longer present in `cargo audit` |
| RUSTSEC-2026-0099 | **FIXED** | same |
| RUSTSEC-2026-0104 | **FIXED** | same |

### 5.3 `cargo audit` final

- Vulnerabilities: **5** (all previously classified NOT_REACHABLE on the
  Windows target): RUSTSEC-2026-0204 `crossbeam-epoch` (crash-only
  `fmt::Pointer`; never exercised), RUSTSEC-2026-0194/0195 `quick-xml 0.30.0`
  (Linux/X11 build-dependency via `xcb → display-info → screenshots`) and
  `quick-xml 0.39.3` (macOS `plist` + Linux `wayland-scanner`, not compiled on
  Windows). Paths reconfirmed with `cargo tree --target all`.
- Warnings: 17 informational (unchanged from Lane C).
- `UNKNOWN=0`, `FIX_BEFORE_CP3=0`, `BLOCKS_CP3=0`.

### 5.4 Rust regression

- `cargo fmt --check` — PASS
- `cargo check` — PASS (1 pre-existing `dead_code` warning in `src/clipboard.rs`)
- `cargo clippy --all-targets` — PASS (11 pre-existing warnings)
- `cargo test` — PASS (10/10)
- `cargo audit` — executed (see 5.3)
- Desktop web prerequisite (`npm ci && npm run build` in `desktop-daemon`,
  Next.js static export) — PASS; `verify:controlled` snapshot updated for the
  intentional Cargo.toml/Cargo.lock change and re-verified.

## 6. Checkpoint 3 security gate

`CHECKPOINT3_SECURITY_GATE=PASS` — see `docs/goal24/checkpoint2-2-security-gate.json`.

## 7. Scientific firewall

- Holdback branch/contents: not read, not modified.
- `science/*` tags and scientific rulesets: untouched.
- Benchmark / gold / formal output / paper: untouched.

## 8. Scope compliance

- 0 process-execution implementation added (no `Command::new`, no `spawn`,
  no GitHub CLI adapter, no Execution Broker runtime).
- Lane commits preserved (no squash).
- No force push; dev branch updated by fast-forward only.
- No new environment installed on C:.