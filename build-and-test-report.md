# Build & Test Report (构建与测试报告)

Branch: `product/omni-v3-unified-r1` (based on `17dc1d0`).
Date: 2026-08-05.

> This is an **engineering** build/test report for the product baseline.
> It is NOT a formal benchmark result and makes no performance claims
> (see `docs/PRODUCT-BASELINE.md`).

## 1. Environment

- Node.js 22.23.2 (D:\environment\node)
- npm 10.9.8 (registry mirror: registry.npmmirror.com)
- Rust 1.97.1 / Cargo 1.97.1 (D:\environment\cargo + rustup)
- Git (D:\environment\Git)
- Python 3.13 (pgAdmin-bundled, used only for file encoding operations)

## 2. Brain Server (brain-server/)

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `npm run build` (tsc) | ✅ clean |
| Full unit/integration suite | `npx vitest run` | ✅ **344/344 tests, 39 files** |

Suite highlights:

- `tests/contract-mcp.test.ts` (8) — unified dispatch: tool parity, determinism,
  stdio/HTTP payload equivalence, HTTP endpoint contract, shared write semantics.
- `tests/embedding-reembed-migration.test.ts` (3) — embedding v3 fixture flow:
  metadata recording, interrupt/resume with old index preserved, mix guard.
- `tests/device-scope.test.ts` (4) — JSON-RPC per-tool scope enforcement + revoke-401.
- `tests/api.smoke.test.ts` (36) — full HTTP surface incl. canonical evidence
  retrieval semantics.
- `tests/auth.test.ts` — scoped device tokens, pair exchange, revocation.

## 3. Browser Extension (browser-extension/)

| Check | Command | Result |
|---|---|---|
| Test suite (node:test) | `npm test` | ✅ **14/14 tests** (privacy, extractor, background) |

Privacy tests cover: autoCapture default off, legacy migration to explicit
consent, blocklist/pause override, sensitive-domain patterns, redaction rules.

## 4. Desktop (desktop-daemon/)

| Check | Command | Result |
|---|---|---|
| Frontend build | `npm run build` (next build) | ✅ succeeds (static export to `out/`) |
| Rust unit tests | `cargo test --bin omni-context-desktop` | ✅ **10/10 tests** |
| Tauri controlled-file guard | `npm run verify:controlled` | ✅ unchanged after build/test |

Rust tests cover: signed-packet acceptance + replay rejection,
unknown/bad-signature/expired/revoked packet rejection, registry survives reload
without exposing credentials, UDP listener dispatch roundtrip, hardware action
business chain, MCP helper install/status.

## 5. Re-embed tool (scripts/re-embed.mjs)

Fixture-mode smoke test on a fresh DB: migration v28 applied, shadow rebuild ran
(0 entities / 0 assertions), `verifyEmbeddingIndexConsistency` OK for both
indexes, report JSON written. No model download, no real re-embed (per Phase 3
policy).

## 6. What was verified vs. not run

**Verified (engineering):**

- Unified business dispatch (stdio + HTTP) — same input → same result.
- Embedding v3 migration flow with fixtures (resume, interrupt, mix guard).
- Device scope enforcement, token revocation, browser privacy defaults,
  ESP32 replay rejection (Rust tests).
- Controlled-file integrity across `next build` + `cargo test`.
- All lockfiles in sync with their `package.json`
  (brain-server / desktop / browser / mobile / benchmark).

**Not run this round (explicitly out of scope):**

- ❌ No formal benchmark (Targeted-7 / Development-35 / LoCoMo).
- ❌ No full real re-embed (fixture only; remote model not downloaded).
- ❌ No macOS/Linux builds (Windows-only environment).
- ❌ No MSI packaging (`package-all.js` requires a pinned local model + signing).

## 7. Regression baseline

The 344 brain-server tests include the pre-existing 337 tests (all passing at
`17dc1d0`) plus 7 new tests added by this branch's phases; the 2 pre-existing
hard-coded migration-version expectations were bumped 27 → 28 in lockstep with
the new migration v28.
