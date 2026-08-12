# Goal24 Checkpoint 2.2 — Lane B: Brain-Server Pre-Execution Node Security

## Summary

Lane B closed all four previously flagged `FIX_BEFORE_CHECKPOINT3` advisories (`ip-address`, `fast-uri`, `hono`, `@hono/node-server`) and additionally closed `undici`, `glob`, and `brace-expansion` (runtime chain) via minimal, non-breaking dependency overrides. The remaining HIGH/CRITICAL findings are install-time build chains (`tar`/node-gyp), the embedding chain (`sharp`/`@xenova/transformers`/`onnx*`), or packages with no available npm fix (`xlsx`) — none are on the Goal24 execution path.

- Lane: **B — Node Security**
- Base SHA: `2cc35b5eed48c780ad4c1b7ef1de1bd793c6f2d4`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp2.2-node-security`
- Branch: `local/cp2.2-node-security` (local only, not pushed)
- Status: **LANE_B_COMPLETE**

## Method

- Environment: Node `v22.23.2` / npm `10.9.8` located at `D:\environment\node\node-v22.23.2-win-x64` (D-drive environment policy; no new environment installed).
- Commands run in `brain-server`:
  - `npm audit --omit=dev --audit-level=critical --json` (before and after; raw before result kept at `D:\environment\temp\audit-brain-server-cp2-2-before.json`, final result committed as `docs/goal24/audit-brain-server-cp2-2.json`)
  - `npm install` (lockfile re-resolution for overrides)
  - `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm audit --omit=dev --audit-level=critical`, `git diff --check`
- No `npm audit fix`, no `npm audit fix --force`, no `npm install --force` used for fixes.

## Dependency Changes

All changes are `package.json` `overrides` (plus the resulting `package-lock.json` update). No direct dependency ranges were changed.

| Package | Old version(s) | New version | Mechanism | Why required |
| --- | --- | --- | --- | --- |
| `ip-address` | 10.1.0 (via `express-rate-limit@8.5.0`), 10.2.0 (via `socks@2.8.8`) | 10.5.0 | override | GHSA advisories 1130722 (high, `<=10.3.0`), 1130723/1130724 (moderate), 1118827 (moderate): SSRF / trust-boundary bypass in `Address4`/`Address6`. On the MCP HTTP surface. Was `FIX_BEFORE_CHECKPOINT3`. |
| `fast-uri` | 3.1.2 | 3.1.5 | override | Advisories 1124064, 1130720, 1138395 (high): host confusion via backslash authority delimiters / failed IDN canonicalization. Used by `ajv` (MCP SDK JSON-schema validation). Was `FIX_BEFORE_CHECKPOINT3`. |
| `hono` | 4.12.29 (override-pinned) | 4.12.34 | override (version bump of existing override) | Advisories 1130733, 1138771, 1138772, 1138773 (moderate/low, patched `<4.12.34`): CORS ReDoS, cross-user SSR `memo()` retention, proxy `Connection` header leak, Language middleware DoS. On the MCP HTTP surface. Was `FIX_BEFORE_CHECKPOINT3`. |
| `@hono/node-server` | 1.19.14 | 2.1.0 | override | Advisory 1124006 (moderate, patched `>=2.0.5`): Windows path traversal in `serve-static`. No patched 1.x exists; 2.x is API-compatible (`getRequestListener` unchanged, peer `hono ^4`, verified against SDK usage and 462-test suite). Was `FIX_BEFORE_CHECKPOINT3`. |
| `undici` | 7.26.0 (via `jsdom@29.1.1`) | 7.29.0 | override | Advisories 1121187, 1121244, 1121247, 1130718 (high) + 8 moderate/low, patched `>=7.29.0`. HTTP client in the same process as untrusted-HTML ingestion; non-breaking patch. |
| `glob` | 10.4.5 (via `archiver-utils@5.0.2`) | 10.5.0 | scoped override (`archiver → archiver-utils`) | Advisory 1109842 (high, `>=10.2.0 <10.5.0`): glob CLI command injection. Scoped so the install-time `glob@7.2.3` (node-gyp) is untouched. |
| `brace-expansion` | 2.1.1 (two chains under `archiver`) | 2.1.4 | scoped overrides (`archiver → archiver-utils → glob → minimatch`, `archiver → readdir-glob → minimatch`) | Advisories 1123896, 1130589, 1130736 (high, 2.x line): exponential-time / OOM DoS via crafted brace patterns. Runtime chain only; dev-tree 1.1.14/2.1.2 untouched. |

Intentionally **not** changed (recorded per scope policy):

- `tar` install-time path (`tar` 7.5.16 override retained; `sqlite3` → `node-gyp` → `make-fetch-happen` → `cacache`): fixing requires `sqlite3@6` semver-major — owner decision.
- `xlsx` ingestion (`xlsx` 0.18.5): no npm fix exists (SheetJS distribution discontinued).
- `sharp` / `@xenova/transformers` embedding path (`sharp` 0.32.6, `onnxruntime-web`/`onnx-proto`/`protobufjs` 7.6.3 override retained): full fix requires transformers/sharp major — owner decision.
- Mobile Expo dependencies: not part of this lane.

## Audit Results

Command: `npm audit --omit=dev --audit-level=critical --json`

| Metric | Before (base `2cc35b5`) | After |
| --- | --- | --- |
| critical | 1 | 1 |
| high | 8 | 4 |
| moderate | 12 | 8 |
| low | 3 | 3 |
| total | 24 | 16 |

## Remaining HIGH/CRITICAL Classification

| Package | Severity | Advisory(s) | Classification | Rationale |
| --- | --- | --- | --- | --- |
| `tar` | critical | 1123940 (+1123939, 1123941, 1123942, 1124287) | `ACCEPTED_TEMPORARY_RISK` | npm-install-time only (`node-gyp` build inputs for `sqlite3`); brain-server runtime never imports `tar`. Fix requires `sqlite3@6` semver-major (owner decision). |
| `@xenova/transformers` | high | via `sharp` 1124066, `onnxruntime-web` | `ACCEPTED_TEMPORARY_RISK` | Embedding chain; fix requires transformers/sharp major. Not on Goal24 execution path. |
| `sharp` | high | 1124066 | `ACCEPTED_TEMPORARY_RISK` | Embedding chain (`0.32.6 < 0.35.0`); libvips upgrade is an owner decision. Not on Goal24 execution path. |
| `brace-expansion` | high | 1123897, 1130588, 1130737 (1.1.x line) | `NOT_ON_EXECUTION_PATH` | Install-time chain only (`node-gyp → glob@7.2.3 → minimatch@3.1.5`); runtime code never imports it. Same disposition family as `tar`/`cacache`. |
| `xlsx` | high | 1108110, 1108111 | `ACCEPTED_TEMPORARY_RISK` | No npm fix (SheetJS distribution discontinued); spreadsheet ingestion API only, not Goal24 execution path. |

Remaining moderate/low (`protobufjs` 7.6.3, `onnx-proto`, `onnxruntime-web`, `node-gyp`, `make-fetch-happen`, `cacache`, `http-proxy-agent`, `@tootallnate/once`, `qs` 6.15.1, `body-parser` 2.2.2) are embedding-chain or install-time/build-time chains, or `express` transitive deps not imported by the brain-server runtime — `NOT_ON_EXECUTION_PATH` / `ACCEPTED_TEMPORARY_RISK`.

## Former FIX_BEFORE_CHECKPOINT3 Status

| Package | Status | Detail |
| --- | --- | --- |
| `ip-address` | **FIXED** | 10.1.0/10.2.0 → 10.5.0 (override) |
| `fast-uri` | **FIXED** | 3.1.2 → 3.1.5 (override) |
| `hono` | **FIXED** | 4.12.29 → 4.12.34 (override) |
| `@hono/node-server` | **FIXED** | 1.19.14 → 2.1.0 (override) |

## Execution-Adjacent Unresolved

None. All execution-adjacent / MCP-HTTP-surface / API-adjacent HIGH and CRITICAL advisories are resolved or are on non-execution chains. Lane B completion condition met: no `UNKNOWN`, `FIX_BEFORE_CP3`, or `BLOCKS_CP3` among execution-adjacent unresolved.

## Regression Results

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` (vitest, full) | PASS — 41 files / 462 tests |
| `npm run build` | PASS |
| `npm run lint` | PASS — 0 errors (9 pre-existing warnings) |
| `npm audit --omit=dev --audit-level=critical` | Ran; 1 critical / 4 high remain, all classified above |
| `git diff --check` | PASS |

## Scope Compliance

- No changes to `brain-server/src/capabilities/`, `brain-server/src/execution/`, `brain-server/src/skills/`, `desktop-daemon/`, `Cargo.*`, or mobile Expo dependencies.
- No `npm audit fix` / `npm audit fix --force` used.
- No major migration performed; only non-major compatible patches and scoped overrides.
- Holdback/scientific artifacts not read or touched.
- No tokens, credentials, or private registry secrets present in committed evidence (scanned).
- No remote branch push; commit exists only on `local/cp2.2-node-security`.
