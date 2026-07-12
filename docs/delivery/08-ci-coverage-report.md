# CI & Release Coverage Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. CI Pipeline (ci.yml)

| Stage | Runs on | Status |
|-------|---------|--------|
| secret-scan | ubuntu-latest | FIXED (gitleaks) |
| dependency-audit | ubuntu-latest | FIXED (npm audit --audit-level=critical) |
| brain-server lint | ubuntu-latest | FIXED |
| brain-server typecheck | ubuntu-latest | FIXED |
| brain-server tests (unit+migration+roundtrip) | ubuntu-latest | FIXED |
| brain-server schema drift check | ubuntu-latest | FIXED |
| desktop-web build | ubuntu-latest | FIXED |
| desktop-rust (fmt+check+clippy+test) | windows-latest | FIXED |
| browser-extension tests | ubuntu-latest | FIXED |
| mobile typecheck | ubuntu-latest | FIXED |
| mobile product-mode verify | ubuntu-latest | FIXED |
| benchmark-scripts tests | ubuntu-latest | FIXED |
| windows-smoke build | windows-latest | FIXED |

**Total:** 13 stages, all push+PR gated

## 2. Release Pipeline (release.yml)

| Item | Status | Detail |
|------|--------|--------|
| Node version | FIXED | 22 (was 18) |
| npm cache | FIXED | cache-dependency-path for brain-server + desktop-daemon |
| Root npm ci removed | FIXED | No root package.json install needed |
| package-all.js path | FIXED | Runs from repo root, not desktop-daemon |
| Build Brain Server | FIXED | npm ci then npm run build |
| Desktop Next.js build | FIXED | npm run build |
| Tauri build | FIXED | tauri-apps/tauri-action@v0 |
| Updater JSON | FIXED | includeUpdaterJson: true |
| NSIS preference | FIXED | updaterJsonPreferNsis: true |
| CHANGELOG reference | FIXED | CHANGELOG.md created |

## 3. Verification Gate Coverage

| Gate | Local Verified | CI Equivalent |
|------|---------------|---------------|
| Rust fmt | PASS | cargo fmt -- --check |
| Rust check | PASS | cargo check --locked |
| Rust clippy | PASS (10 warnings, 0 errors) | cargo clippy --locked --all-targets |
| Rust test | PASS (9/9) | cargo test --locked |
| Brain TS typecheck | PASS | tsc --noEmit |
| Brain TS lint | PASS (0 errors, 14 warnings) | eslint src --ext .ts |
| Brain tests | PASS (all suites) | vitest run |
| Extension tests | PASS | node --test |
| Mobile typecheck | PASS | tsc --noEmit |
| Mobile product-mode | PASS | node scripts/verify-read-only.mjs |
| Benchmark tests | PASS (4/4) | node --test |
| Schema drift | PASS | npm run schema:check |
| Secret scan | PASS (4/4) | node --test scripts/*.test.mjs |
| Package guard | PASS (4/4) | node --test scripts/*.test.mjs |

## 4. Release Dry-Run

| Item | Status |
|------|--------|
| MSI installer generated | FIXED (263.1 MB, 0.1.1) |
| NSIS installer generated | FIXED (199.5 MB, 0.1.1) |
| Brain server compiled + staged | FIXED (42 files, node.exe embedded) |
| Browser extension manifest | FIXED (0.1.1, v3) |
| Extension zip | PARTIALLY_FIXED (privacy.js added but zip blocked by sandbox) |
| package-all.js error propagation | FIXED |
| Installer code signing | NOT_APPLICABLE (CI signs via TAURI_PRIVATE_KEY) |
| Full install + launch test | BLOCKED (sandbox timeout/policy) |
