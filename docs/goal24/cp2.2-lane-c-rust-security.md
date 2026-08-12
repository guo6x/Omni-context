# Goal24 Checkpoint 2.2 — Lane C: Rust/Tauri Advisory Gate

Date: 2026-08-12
Status: LANE_C_RUST_SECURITY (advisory gate + CP3 threat model; design only, no runtime)
Base: `2cc35b5eed48c780ad4c1b7ef1de1bd793c6f2d4` (Goal24 dev branch HEAD at lane start)
Branch: `local/cp2.2-rust-security-design` (worktree `D:\ai_code\Omni-context-worktrees\cp2.2-rust-security`)

Lane C is the Rust/Tauri dependency security gate for Goal24 Checkpoint 3 (local
execution broker). It performs a **real** `cargo audit` against the Tauri daemon
lockfile, classifies every advisory against the future broker design, and
produces the Checkpoint 3 threat model. It adds **no process execution code**.

- `docs/goal24/audit-tauri-rust.json` — raw machine-readable `cargo audit --json` output (no credentials/tokens/secrets).
- `docs/goal24/cp3-execution-broker-threat-model.md` — Checkpoint 3 threat model (design only).
- `docs/goal24/cp2.2-lane-c-environment.json` — environment location policy manifest.
- This file — audit run record, per-advisory classification, gate verdict.

---

## 1. Environment policy compliance

Policy: search `D:` first, then `C:`; new tooling may only be installed under
`D:\environment`; no new environment may be installed on `C:`.

| Tool | Where found | Path | Version |
|------|-------------|------|---------|
| `cargo` | D: (existing) | `D:\environment\cargo\bin\cargo.exe` | 1.97.1 (c980f4866 2026-06-30) |
| `rustc` | D: (existing) | `D:\environment\cargo\bin\rustc.exe` | 1.97.1 (8bab26f4f 2026-07-14) |
| `rustup` | D: (existing) | `D:\environment\rustup` | 1.29.0 (28d1352db 2026-03-05) |
| `cargo-audit` | not found on D: or C: → installed | `D:\environment\cargo-audit\bin\cargo-audit.exe` | 0.22.2 |
| `cargo-deny` | not found on D: or C: | — | not installed (not required for this gate; would also go to `D:\environment`) |
| RustSec advisory DB | cloned during this lane | `D:\environment\advisory-db` | RustSec/advisory-db @ 69f93e1d081d8b6fbee010e48f0b5e0d13661415 (shallow, `--depth 1`) |

Environment variables:

- `CARGO_HOME=D:\environment\cargo` — pre-existing, user scope (unchanged).
- `RUSTUP_HOME=D:\environment\rustup` — pre-existing, user scope (unchanged).
- `CARGO_TARGET_DIR=D:\environment\cargo-target` — session-local during the
  `cargo install` build only; **not persisted**.
- `PATH` — unchanged.
- **New environment installed on C: — false.** (`new_environment_installed_on_C: false`)

Why a local advisory DB: `cargo-audit` 0.22 fetches the advisory DB with its own
git implementation (`gix`), which did not honor the machine's git proxy
(`http.proxy http://127.0.0.1:7897`) and failed to reach
`https://github.com/RustSec/advisory-db.git`. A shallow `git clone` (which does
honor the proxy) into `D:\environment\advisory-db` and
`cargo audit --db D:\environment\advisory-db --no-fetch` is the D-drive-local,
reproducible equivalent. 1,216 advisories were loaded.

---

## 2. Audit run record

```
cwd:    desktop-daemon/src-tauri (worktree D:\ai_code\Omni-context-worktrees\cp2.2-rust-security)
lockfile: desktop-daemon/src-tauri/Cargo.lock (581 crate dependencies)
command: D:\environment\cargo-audit\bin\cargo-audit.exe audit --db D:\environment\advisory-db --no-fetch
result:  8 vulnerabilities found; 17 informational warnings allowed
json:    docs/goal24/audit-tauri-rust.json (cargo audit --json, 2026-08-12)
```

The raw JSON file contains only advisory metadata (crate names, versions,
checksums, descriptions, CVSS). No credentials, tokens or private absolute
user secrets are stored.

---

## 3. Advisory classification

Classification policy (Lane C):

- `BLOCKS_CP3` — actively blocks the Checkpoint 3 security-ready claim.
- `FIX_BEFORE_CP3` — must be fixed before the broker ships; reported to
  Integration, **no self-served large-scale upgrade in this lane**.
- `NOT_REACHABLE` — not compiled on the current Windows target and/or the
  affected API is never exercised by the daemon.
- `ACCEPTED_TEMPORARY_RISK` — reachable but accepted with recorded rationale.
- `UNKNOWN` — cannot determine; treated as blocking until resolved.

Runtime reachability was established with `cargo tree -i <crate>@<version>`
(Windows default target, plus `--target all` where needed).

### 3.1 Vulnerabilities (8)

| # | Crate | Installed | Advisory | Severity | Patched | Dependency path | Runtime reachability | Goal24 broker relevance | Classification |
|---|-------|-----------|----------|----------|---------|-----------------|----------------------|--------------------------|----------------|
| V1 | crossbeam-epoch | 0.9.18 | RUSTSEC-2026-0204 | n/a (no CVSS) | >=0.9.20 | crossbeam-deque → ignore → tauri; rayon-core → image/exr/jpeg-decoder/tiff | Windows runtime; affected `fmt::Pointer`/`fmt::Display` impls for `Atomic`/`Shared` are never exercised by daemon code or its deps (formatting of epoch pointers is not used) | none — crash-only formatting bug, no broker data flow | NOT_REACHABLE |
| V2 | quick-xml | 0.30.0 | RUSTSEC-2026-0194 | 7.5 high | >=0.41.0 | [build-dependencies] xcb → display-info → screenshots → omni-context-desktop | Linux/X11 only; build-time XML protocol generation; not compiled on Windows | none | NOT_REACHABLE |
| V3 | quick-xml | 0.30.0 | RUSTSEC-2026-0195 | 7.5 high | >=0.41.0 | same as V2 | Linux/X11 only; build-time only | none | NOT_REACHABLE |
| V4 | quick-xml | 0.39.3 | RUSTSEC-2026-0194 | 7.5 high | >=0.41.0 | plist → tauri / tauri-codegen → tauri-macros; wayland-scanner → wayland-client/protocols → wl-clipboard-rs → arboard → app + tauri-runtime-wry | macOS plist parsing + Linux wayland proc-macro; not compiled on Windows | none | NOT_REACHABLE |
| V5 | quick-xml | 0.39.3 | RUSTSEC-2026-0195 | 7.5 high | >=0.41.0 | same as V4 | same as V4 | none | NOT_REACHABLE |
| V6 | rustls-webpki | 0.101.7 | RUSTSEC-2026-0098 | n/a (unassessed) | >=0.103.12,<0.104.0-alpha.1 or >=0.104.0-alpha.6 | rustls 0.21.12 → hyper-rustls 0.24.2 → reqwest 0.11.27 → omni-context-desktop (and tauri) | Windows runtime; TLS stack compiled into daemon via reqwest `rustls-tls` feature; today the daemon only calls `http://127.0.0.1:3001` (plain HTTP), so certificate verification is not yet exercised | HIGH — the future GitHub CLI adapter and any broker network client sit on this TLS stack | FIX_BEFORE_CP3 |
| V7 | rustls-webpki | 0.101.7 | RUSTSEC-2026-0099 | n/a (unassessed) | >=0.103.12,<0.104.0-alpha.1 or >=0.104.0-alpha.6 | same as V6 | same as V6 | HIGH — same TLS verification path | FIX_BEFORE_CP3 |
| V8 | rustls-webpki | 0.101.7 | RUSTSEC-2026-0104 | n/a (unassessed) | >=0.103.13,<0.104.0-alpha.1 or >=0.104.0-alpha.7 | same as V6 | Windows runtime compiled; reachable panic is in CRL parsing, and CRL APIs are not used by reqwest/daemon today (unreachable function) | MEDIUM — same dependency cluster; grouped with the reqwest/rustls upgrade | FIX_BEFORE_CP3 |

### 3.2 Informational warnings (17)

| # | Crate | Installed | Advisory | Kind | Patched | Dependency path | Reachability / rationale | Classification |
|---|-------|-----------|----------|------|---------|-----------------|---------------------------|----------------|
| W1 | atk | 0.15.1 | RUSTSEC-2024-0413 | unmaintained | — | tao/wry GTK3 stack (Linux) | Linux-only, not compiled on Windows | NOT_REACHABLE |
| W2 | atk-sys | 0.15.1 | RUSTSEC-2024-0416 | unmaintained | — | same | Linux-only | NOT_REACHABLE |
| W3 | fxhash | 0.2.1 | RUSTSEC-2025-0057 | unmaintained | — | display-info → screenshots → app; selectors → kuchikiki → tauri-utils | Windows runtime (screenshots); no known vulnerability, no patched release | ACCEPTED_TEMPORARY_RISK |
| W4 | gdk | 0.15.4 | RUSTSEC-2024-0412 | unmaintained | — | tao/wry GTK3 stack | Linux-only | NOT_REACHABLE |
| W5 | gdk-sys | 0.15.1 | RUSTSEC-2024-0418 | unmaintained | — | same | Linux-only | NOT_REACHABLE |
| W6 | gdkwayland-sys | 0.15.3 | RUSTSEC-2024-0411 | unmaintained | — | tao (Wayland) | Linux-only | NOT_REACHABLE |
| W7 | gdkx11-sys | 0.15.1 | RUSTSEC-2024-0414 | unmaintained | — | tao (X11) | Linux-only | NOT_REACHABLE |
| W8 | gtk | 0.15.5 | RUSTSEC-2024-0415 | unmaintained | — | tao/wry/libappindicator/webkit2gtk (Linux) | Linux-only | NOT_REACHABLE |
| W9 | gtk-sys | 0.15.3 | RUSTSEC-2024-0420 | unmaintained | — | same | Linux-only | NOT_REACHABLE |
| W10 | gtk3-macros | 0.15.6 | RUSTSEC-2024-0419 | unmaintained | — | gtk (Linux) | Linux-only | NOT_REACHABLE |
| W11 | instant | 0.1.13 | RUSTSEC-2024-0384 | unmaintained | — | tao → wry → tauri-runtime-wry → tauri | Windows runtime; no known vulnerability; removed in newer tauri generations | ACCEPTED_TEMPORARY_RISK |
| W12 | proc-macro-error | 1.0.4 | RUSTSEC-2024-0370 | unmaintained | — | glib-macros → glib (Linux) | Linux-only | NOT_REACHABLE |
| W13 | proc-macro-error2 | 2.0.1 | RUSTSEC-2026-0173 | unmaintained | — | getset → neli → local-ip-address → omni-context-desktop | Windows build-time proc-macro; no known vulnerability | ACCEPTED_TEMPORARY_RISK |
| W14 | rustls-pemfile | 1.0.4 | RUSTSEC-2025-0134 | unmaintained | — | reqwest (TLS) | Windows runtime; no known vulnerability; replacement arrives with the reqwest/rustls upgrade (V6-V8) | ACCEPTED_TEMPORARY_RISK |
| W15 | anyhow | 1.0.102 | RUSTSEC-2026-0190 | unsound | >=1.0.103 | direct dep; screenshots; tauri; tauri-build | Windows runtime, but the affected API `Error::downcast_mut()` is not used anywhere in the daemon source (verified by grep) | NOT_REACHABLE |
| W16 | glib | 0.15.12 | RUSTSEC-2024-0429 | unsound | >=0.20.0 | GTK3 stack (tao/wry/webkit2gtk/libappindicator) | Linux-only | NOT_REACHABLE |
| W17 | rand | 0.7.3 | RUSTSEC-2026-0097 | unsound | >=0.8.6 (0.8.x line) | phf_generator → phf_macros/phf_codegen → selectors → kuchikiki → tauri-utils | Windows build-time/proc-macro only; the advisory requires a pathological custom-logger re-entering `rand::rng()` during reseed — absent in build scripts | NOT_REACHABLE |

---

## 4. Gate verdict

| Bucket | Count | IDs |
|--------|-------|-----|
| BLOCKS_CP3 | 0 | — |
| FIX_BEFORE_CP3 | 3 | RUSTSEC-2026-0098, RUSTSEC-2026-0099, RUSTSEC-2026-0104 (all `rustls-webpki` 0.101.7 via `reqwest`/`rustls`) |
| NOT_REACHABLE | 18 | RUSTSEC-2026-0204, -0194 (x2), -0195 (x2), -0413, -0416, -0412, -0418, -0411, -0414, -0415, -0420, -0419, -0370, -0190, -0429, -0097 |
| ACCEPTED_TEMPORARY_RISK | 4 | RUSTSEC-2025-0057, -2024-0384, -2026-0173, -2025-0134 |
| UNKNOWN | 0 | — |

Result: **no BLOCKS_CP3 and no UNKNOWN findings.** Lane C can claim the
advisory gate for CP3, with one explicit condition reported to Integration:

> **FIX_BEFORE_CP3 (report to Integration):** the `rustls-webpki 0.101.7` cluster
> (RUSTSEC-2026-0098/0099/0104) sits on the daemon's TLS stack
> (`reqwest 0.11`/`rustls 0.21`). It is not exploitable through today's
> localhost-only HTTP usage, but the future broker's GitHub CLI / network
> adapter surface will use HTTPS. The fix requires upgrading
> `reqwest` → 0.12 line (rustls 0.23 / rustls-webpki 0.103) — a coordinated
> dependency upgrade that Lane C deliberately did **not** perform in isolation,
> because `tauri 1.8` also depends on `reqwest 0.11`. This must be scheduled by
> Integration before CP3 runtime ships.

CI changes: **none** — `security.yml` already runs secret scanning; a
`cargo audit` CI step is deferred to Integration so the FIX_BEFORE_CP3 upgrade
can land together with the gate (no CI file was modified in this lane).

---

## 5. Scientific firewall

- `research/decision-benchmark-holdback-v2` — not read, not modified.
- No scientific files or tags modified.

## 6. Verification run (see final response for live results)

- cargo fmt --check — PASS (0 diffs)
- cargo check — PASS (1 pre-existing dead-code warning in src/clipboard.rs)
- cargo clippy --all-targets — PASS (11 pre-existing warnings, incl. 'await_holding_lock' in src/udp_listener.rs)
- cargo test — PASS (10 passed, 0 failed)
- cargo audit (db D:\environment\advisory-db, --no-fetch) — PASS for gate (8 vulnerabilities + 17 warnings, classified in section 3; 0 BLOCKS_CP3, 0 UNKNOWN)
- git diff --check — PASS
- Rust baseline required a local 
pm ci && npm run build in desktop-daemon (Next.js static export into gitignored out/) because the Tauri generate_context! macro requires distDir to exist; this matches the CI desktop-rust job.
- `PROCESS_EXECUTION_CODE_ADDED: NO` — no `Command::new`, `spawn` or process-execution code was added by this lane. Pre-existing baseline spawning in `desktop-daemon/src-tauri/src/brain_server.rs` (node launch, `explorer`/`open`/`xdg-open`) is untouched.

## 7. Deliverables in this lane

- `docs/goal24/audit-tauri-rust.json`
- `docs/goal24/cp2.2-lane-c-rust-security.md` (this file)
- `docs/goal24/cp3-execution-broker-threat-model.md`
- `docs/goal24/cp2.2-lane-c-environment.json`

