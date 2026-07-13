# 15 — Task 14: Repository Hygiene — Remove Temp Scripts, Fix CI, Clean Local Paths

**Commit**: `5375070`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
13 one-time patch scripts were tracked in the `work/` directory (`batch-fixes.py`, `fix-final.js`, `fix-last-test.js`, `fix-p08-p04.js`, `fix-provenance.js`, `fix-return.js`, `fix-tests.js`, `fix-ts.js`, `fix3.js`, `p0-batch.js`, `p012.js`, `p05-p06.js`, `batch-p013-p04.js`), violating repo hygiene. The GitHub Actions `benchmark-scripts` CI job used `npm install` (non-reproducible), had a broken test command path, and no npm cache. `docs/CLAUDE_CODE_SYNC.md` contained local absolute paths (`D:\AI_code\...`, `E:\app_update\...`).

## Production Entry Point
- CI: `.github/workflows/ci.yml` → `benchmark-scripts` job
- Docs: `docs/CLAUDE_CODE_SYNC.md`

## Call Chain
1. **Temp script removal**: 13 files deleted from `work/` (971 lines removed) — these were local one-time fix scripts that should never have been committed
2. **CI fix** (`benchmark-scripts` job):
   - Switched from `npm install` to `npm ci` for reproducible installs
   - Added npm cache via `cache-dependency-path: benchmark/package-lock.json`
   - Fixed test command: `node --test tests/*.test.mjs` with `working-directory: benchmark` (was incorrectly rooted at repo top)
3. **Local path cleanup** (`docs/CLAUDE_CODE_SYNC.md`):
   - Replaced `D:\AI_code\...` workspace path with relative reference
   - Replaced `E:\app_update\...` MCP config paths with `<install-path>` placeholders
4. **Schema cleanup**: confirmed `VALID_ENTITY_TYPES`/`VALID_RELATIONSHIP_TYPES` in `extractor.ts` already derive from central `domain.ts` (`ENTITY_TYPES`/`RELATIONSHIP_TYPES`) — no manual duplication remains (originally fixed in `a214b49`)

## Modified Files
- `.github/workflows/ci.yml` — `benchmark-scripts` job: `npm install` → `npm ci`, added cache, fixed test command path + working directory (10 lines changed)
- `docs/CLAUDE_CODE_SYNC.md` — replaced local absolute paths with relative references / placeholders (6 lines changed)
- `work/batch-fixes.py` — deleted (174 lines)
- `work/batch-p013-p04.js` — deleted (80 lines)
- `work/fix-final.js` — deleted (21 lines)
- `work/fix-last-test.js` — deleted (12 lines)
- `work/fix-p08-p04.js` — deleted (128 lines)
- `work/fix-provenance.js` — deleted (28 lines)
- `work/fix-return.js` — deleted (12 lines)
- `work/fix-tests.js` — deleted (9 lines)
- `work/fix-ts.js` — deleted (38 lines)
- `work/fix3.js` — deleted (19 lines)
- `work/p0-batch.js` — deleted (325 lines)
- `work/p012.js` — deleted (13 lines)
- `work/p05-p06.js` — deleted (106 lines)

## Tests
- No functional code changes — tests unaffected.
- CI `benchmark-scripts` job now runs `node --test tests/*.test.mjs` in `benchmark/` working directory.
- Run: CI pipeline triggers on push/PR.

## Remaining Risk
- The `work/` directory itself is not gitignored — future temp scripts could be re-added. A `.gitignore` entry for `work/` would prevent recurrence.
- Only the `benchmark-scripts` CI job was fixed; other CI jobs (brain-server, desktop-rust) were not modified in this commit.
- The `CLAUDE_CODE_SYNC.md` path placeholders (`<install-path>`) require manual substitution by the reader — no build-time templating.
- Additional hardening from `a214b49` (MCP auth scope fix — closing query-param bypass and adding JSON-RPC per-tool scope check in `auth.ts` + `mcp.ts`) is related security hygiene but was committed separately.
