# CI & Release Configuration Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Environment Unification

| Item | Status | Detail |
|------|--------|--------|
| Node version | FIXED | 22 across all jobs (was 18 in release) |
| Package manager | FIXED | npm (npm ci --omit=dev for staging) |
| Lockfile strategy | FIXED | package-lock.json committed for all 4 packages |
| App version | FIXED | 0.1.1 unified across root, brain-server, desktop-daemon, browser-extension, mobile-app, Cargo.toml, tauri.conf.json |

## 2. Release Pipeline Fixes

| Issue | Was | Now | Status |
|-------|-----|-----|--------|
| Node version | 18 | 22 | FIXED |
| npm cache | None | cache-dependency-path for brain-server + desktop-daemon | FIXED |
| Root npm ci | Blocked (no root install needed) | Removed from release.yml | FIXED |
| package-all.js path | cd desktop-daemon && node scripts/package-all.js | node scripts/package-all.js (from root) | FIXED |
| CHANGELOG | Missing | CHANGELOG.md with 0.1.1 hardening notes | FIXED |
| Updater signature | TAURI_PRIVATE_KEY env var | CI provides via secrets | FIXED |
| Installer format | MSI only | MSI + NSIS (updaterJsonPreferNsis: true) | FIXED |

## 3. package-all.js Fixes

| Item | Status | Detail |
|------|--------|--------|
| Error propagation | FIXED | package-guard.js throws on any component failure |
| Cross-platform cleanup | FIXED | Node fs.rmSync replaces Unix-only rm -rf |
| privacy.js inclusion | FIXED | Added to extension include list |
| Onnx runtime exclusion | FIXED | onnxruntime-web deleted from staging (65MB waste) |
| Node.js embedding | FIXED | node.exe v22.16.0 cached and copied to staging |

## 4. Release Dry-Run

| Artifact | Size | Status |
|----------|------|--------|
| MSI installer | 263.1 MB | FIXED |
| NSIS installer | 199.5 MB | FIXED |
| Brain server staging | 657 MB (node.exe + 42 JS + 344 deps) | FIXED |
| Extension unpacked | 11 files, 0.1.1 | FIXED |
| Extension zip | ~37 KB | PARTIALLY_FIXED (sandbox blocks rebuild) |
