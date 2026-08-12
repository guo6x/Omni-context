# Goal24 Checkpoint 3 — Lane C: Existing Local Process Surface Audit

Status: **AUDIT ONLY** — no runtime code changed. No Broker implemented.

Date: 2026-08-13

Scope: inventory and classify every existing process / shell / native
execution surface in `desktop-daemon` (Rust `src-tauri` + shipped TS/JS) at
base `93d9cf53c91e56d4c7b13e85d6197014d0a879c7`, and answer the Broker
bypass question for a prompt-injected / compromised desktop caller.

Related artifact: `docs/goal24/cp3-execution-broker-threat-model.md` (CP3
design gate, Lane C) treats `brain_server.rs` as pre-existing surface; this
audit is the concrete inventory that backs that treatment.

---

## 1. Method

- Full-text scan of `desktop-daemon/src-tauri` for `Command::new`, `spawn`,
  `output`, `status`, `kill`, `std::process`, `tokio::process`,
  `shell::open`, `cmd.exe`, `powershell`, `sh`, `bash`, `taskkill`, `start`,
  `ShellExecute`, `open_folder`, PATH lookup, env injection.
- Full-text scan of shipped desktop TS/JS (`src/`, `src-tauri/icons/`) for
  `child_process`, `spawn`, `exec`, shell open usage.
- Read of `tauri.conf.json`, `tauri.prod.conf.json`, `tauri.ci.conf.json`,
  `Cargo.toml`, `main.rs`, `commands.rs`, `brain_server.rs`, `mcp_helper.rs`,
  `hardware.rs`, `hardware_actions.rs`, `udp_listener.rs`,
  `clipboard.rs`, `screen_capture.rs`, `log_writer.rs`.
- Machine-readable inventory: `docs/goal24/cp3-existing-process-surface.json`.
- Lane manifest: `docs/goal24/checkpoint3-lane-c-manifest.json`.

No file outside the three audit artifacts was created or modified.

---

## 2. Surface inventory (14)

| # | File | Function | Classification |
|---|------|----------|----------------|
| S1 | `src-tauri/src/brain_server.rs` | `start_inner()` — spawn node brain-server | LEGITIMATE_BASELINE |
| S2 | `src-tauri/src/brain_server.rs` | `kill_zombie_by_pid_file()` — taskkill / kill -9 | LEGACY_RISK |
| S3 | `src-tauri/src/brain_server.rs` | `open_folder_in_explorer()` / `open_logs_folder()` | LEGITIMATE_BASELINE |
| S4 | `src-tauri/src/mcp_helper.rs` | `get_mcp_server_command()` + `install_mcp_to()` | LEGITIMATE_BASELINE (residual) |
| S5 | `src-tauri/src/mcp_helper.rs` | `open_config_folder()` | LEGITIMATE_BASELINE |
| S6 | `tauri.conf.json` + `src/components/SettingsPanel.tsx` | `allowlist.shell.open` + `@tauri-apps/api/shell` `open()` | POTENTIAL_BROKER_BYPASS |
| S7 | `src-tauri/src/commands.rs` | `start_brain_server` / `stop_brain_server` / `restart_brain_server` / `quit_app` | LEGITIMATE_BASELINE |
| S8 | `src-tauri/src/commands.rs` | `register_global_shortcuts()` | LEGACY_RISK |
| S9 | `src-tauri/src/commands.rs` | `process_dropped_paths()` | OUT_OF_SCOPE (FS, not process) |
| S10 | `tauri.conf.json` + `Cargo.toml` | allowlist `fs.readFile` scope `**`, `path-all`, `clipboard-all`, `window-all` | OUT_OF_SCOPE (FS/permission, not process) |
| S11 | `main.rs` + `tauri.conf.json` | Tauri built-in updater (signed GitHub release) | LEGITIMATE_BASELINE |
| S12 | `tauri.conf.json` `beforeDevCommand` + `e2e-installed.cjs` | dev / e2e harness spawn | OUT_OF_SCOPE (dev tooling) |
| S13 | `udp_listener.rs` + `hardware_actions.rs` | UDP-triggered precipitate → HTTP ingest | OUT_OF_SCOPE (no process exec) |
| S14 | `tauri.conf.json` CSP | `script-src 'unsafe-inline' 'unsafe-eval'` (default conf) | OUT_OF_SCOPE (enabler) |

Classification counts: LEGITIMATE_BASELINE 6, LEGACY_RISK 2,
POTENTIAL_BROKER_BYPASS 1, BLOCKS_CP3 0, OUT_OF_SCOPE 5.

---

## 3. Key surfaces

### S1 — brain-server lifecycle spawn (LEGITIMATE_BASELINE)

- Executable selection: bundled `node.exe`/`node` at fixed
  `current_exe`-relative paths, else literal `"node"` (PATH fallback).
- argv: single fixed script path from an internal candidate list
  (`brain_server_paths()`), existence-checked.
- cwd: `LOCALAPPDATA\omni-context\data` (or home fallback).
- env: internal fixed set (`HOST`, `PORT`, `DB_PATH`, `EMBEDDING_*`,
  `PAIR_CODE`, `PAIR_CODE_FILE`, `LAN_IP`, `LOCAL_API_TOKEN`); pairing
  code/token are internally generated, not caller-supplied.
- stdout/stderr piped to log file; child killed on health-check failure;
  `child.kill()` + `wait()` on stop; `CREATE_NO_WINDOW` on Windows.
- No shell. No caller-controlled node_exe / script / args / cwd / env.
- Residual risks (recorded, not blockers): PATH fallback for `node`
  (local attacker with PATH control could substitute a binary); lifecycle
  commands are webview-invocable (availability: stop/restart brain server);
  PID file in user-writable data dir (see S2).
- Future action: pin a resolved node path for shipped builds; route
  lifecycle commands through Broker policy; never copy this pattern into the
  Broker (Broker must use adapter-registry-bound executables).

### S2 — zombie PID kill (LEGACY_RISK)

- `kill_zombie_by_pid_file()` reads a PID from `data/brain-server.pid` and
  runs `taskkill /F /PID <pid>` (Windows) or `kill -9 <pid>` (POSIX).
- The PID file lives in a user-writable data directory. The Tauri webview
  cannot write it (allowlist has `fs.readFile` only, no write), so a
  prompt-injected webview caller cannot weaponize it; any *local process*
  attacker can. Attack: kill an arbitrary PID (DoS) by planting a pid file.
- Future action: verify PID ownership (process image/command line matches
  the expected brain-server node) before killing; move PID state into
  app-owned storage.

### S3 — open data/logs folder (LEGITIMATE_BASELINE)

- `explorer` / `open` / `xdg-open` (platform-selected) with a fixed internal
  directory argument (user data dir / logs dir). No caller-controlled path.
- Residual: PATH lookup of the OS helper (local attacker only).

### S4 — MCP config writer (LEGITIMATE_BASELINE, residual)

- `get_mcp_server_command()` returns `{command: <node>, args:
  [<mcp-proxy.js>]}`; `install_mcp_to()` writes that entry into third-party
  MCP client config files (Claude, Cursor, Cline, Roo, Windsurf, Trae, LM
  Studio, Continue). It does **not** spawn anything itself; the third-party
  client later spawns the recorded command.
- command/args are internally generated (bundled node or PATH `node`
  fallback + fixed proxy path). `client_id` is caller-controlled but
  constrained to a fixed enum; unknown ids are rejected.
- Residual: PATH fallback `node` gets baked into third-party configs (a
  local PATH attacker influences what those apps execute); config writes
  touch user-owned files outside app storage.
- Future action: pin the resolved node path when writing configs; gate MCP
  installs behind Broker policy in CP4/CP7; back up/validate before merge.

### S5 — open MCP config folder (LEGITIMATE_BASELINE)

- Same `explorer`/`open`/`xdg-open` pattern as S3 with per-client fixed
  config dirs. No arbitrary path from caller.

### S6 — Tauri shell-open + webview `open()` (POTENTIAL_BROKER_BYPASS)

- `tauri.conf.json` sets `allowlist.shell.open = true` (no URL/args
  restriction; Tauri v1 `shell.open` is all-or-nothing). `Cargo.toml`
  enables the `shell-open` feature.
- App code (`SettingsPanel.tsx openExternal`) only calls `open()` with
  fixed https URLs from `LLM_API_KEY_URLS` (a static map), with a
  `window.open` fallback.
- BUT the `open()` capability is exposed to any webview JS. A
  prompt-injected / XSS-compromised webview caller can call `open()` with an
  arbitrary argument: `file://` paths, custom URI schemes
  (`ms-settings:`, `mailto:`, SMB/UNC paths), or a local executable path —
  on Windows, ShellExecute "open" on an `.exe`/`.bat`/`.cmd` **executes
  it**.
- This is a direct Broker bypass: even a perfectly safe Broker cannot stop a
  compromised webview from invoking `open()` on the OS directly.
- Verdict: **not BLOCKS_CP3** (Broker design/implementation is independent),
  but **must be closed before CP7** (and ideally in CP4): restrict `open()`
  to a fixed allowlist of https URLs enforced in Rust (drop `shell-open`
  feature and expose a dedicated command), or remove shell-open entirely.

### S7 — process lifecycle commands (LEGITIMATE_BASELINE)

- Webview-invocable `start_brain_server` / `stop_brain_server` /
  `restart_brain_server` / `quit_app` manage the fixed node child and the
  app. Params are fixed; impact is availability only (stop/restart/quit).

### S8 — global shortcuts (LEGACY_RISK)

- `register_global_shortcuts(shortcuts)` takes caller-controlled accelerator
  strings and registers system-wide hotkeys that emit frontend events
  (precipitate / decision / reset). Not process execution, but a compromised
  webview can hijack hotkeys or spam registrations. Validate accelerators
  against an allowlist.

### S9–S14 — adjacent / out-of-scope surfaces

- S9 `process_dropped_paths(paths, extensions)`: caller-controlled recursive
  path walk returning file metadata (no execution). Adjacent FS exposure.
- S10 allowlist breadth: `fs.readFile` scope `["**"]`, `path.all`,
  `clipboard.all`, `window.all` — a compromised webview can read any file
  and use all path/clipboard/window APIs. Not process execution, but a
  primary exfiltration/abuse channel; narrow scopes in CP4/CP7.
- S11 updater: built-in Tauri updater against the GitHub release endpoint
  with a pinned pubkey — signed update install, legitimate baseline.
- S12 `beforeDevCommand: npm run dev` and `e2e-installed.cjs` (spawns the
  installed exe + taskkill): dev/e2e tooling only, not shipped runtime.
- S13 UDP hardware trigger (`udp_listener` + `hardware_actions`): signature-
  verified packets on loopback (default) trigger screen/clipboard ingest to
  the brain server over HTTP; no process spawn. Residual: `OMNI_BRAIN_URL`
  env override redirects ingest target (local attacker).
- S14 default CSP `script-src 'unsafe-inline' 'unsafe-eval'`: raises
  webview-compromise likelihood, which activates the S6 bypass. Make the
  prod/CI CSP (`script-src 'self'`) the shipped default.

---

## 4. Bypass question (Broker-complete world)

> If the future Broker is perfectly safe, can a prompt-injected /
> compromised desktop caller bypass it via existing Tauri commands to:
> execute an arbitrary executable, construct a shell command, manipulate the
> Node process, abuse shell-open, or open a dangerous URI/file handler?

| Question | Answer |
|---|---|
| Arbitrary executable via existing Tauri command | NO — no command accepts an executable path or argv; brain-server spawn uses internal fixed node+script. |
| Shell command construction | NO — no `cmd.exe`/`powershell`/`sh -c` anywhere in the shipped runtime; `taskkill`/`explorer` use fixed args. |
| Manipulate Node process | Lifecycle only (start/stop/restart/quit of the fixed brain-server child). node_exe/script/args/cwd/env are not caller-controllable. |
| Abuse shell-open | **YES** — S6: compromised webview JS can call `open()` with an arbitrary URI or local executable path (Windows ShellExecute executes `.exe`/`.bat`/`.cmd`). |
| Dangerous URI / file handler | **YES** — via S6 (`file://`, `ms-settings:`, SMB/UNC, protocol handlers). |
| Other abuse | S8 hotkey hijack, S9/S10 broad FS read + path APIs, S2 PID-file kill (local attacker only), S7 lifecycle DoS. |

Conclusion: the only genuine Broker-bypass process surface is S6
(`shell-open`). It is **POTENTIAL_BROKER_BYPASS**, not **BLOCKS_CP3**: the
Broker can be designed and implemented independently, but shell-open must be
closed (fixed-https allowlist or removal) **before CP7**, ideally in CP4.
All other execution surfaces are internal-fixed baselines with recorded
residual risks; none lets a webview caller select or construct a process.

---

## 5. Scope compliance

- RUNTIME_CODE_CHANGED: NO
- PROCESS_EXECUTION_ADDED: NO
- HOLDBACK_TOUCHED: NO
- REMOTE_BRANCH_PUSHED: NO
- Files created: `docs/goal24/cp3-existing-process-surface-audit.md`,
  `docs/goal24/cp3-existing-process-surface.json`,
  `docs/goal24/checkpoint3-lane-c-manifest.json` (manifest references the
  audit commit SHA).