# vNext Decision Control Center — Installed Gate

Status: **PREPARED / NOT EXECUTED**

This gate is intentionally separate from the Goal29 V1 freeze evidence. It validates the vNext Decision Control Center on a real installed Windows Desktop artifact without changing the frozen Goal29 record or claiming that the historical V1 installer already contained these diagnostics.

## Purpose

Prove, at installed-app level, that the owner can open the real Desktop Control Center and inspect the two evidence layers added by vNext:

1. **Live Guard trace** — bounded process-local CP6 diagnostic data while the Guard ledger still contains the run.
2. **Bound plan snapshot** — immutable evidence coverage already attached to the authorized plan.

This is an observability gate, not an execution gate.

## Exact-artifact binding

A typed Git SHA alone is not enough to establish which binary was tested. Before launching the installed app, the harness requires and verifies all of the following:

1. `OMNI_VNEXT_E2E_EXPECTED_SHA` is a full 40-character Git SHA.
2. The current repository `HEAD` equals that SHA.
3. Staged tracked content matches `HEAD` (`git diff --cached --quiet --no-ext-diff HEAD --`).
4. Working-tree tracked content matches `HEAD` (`git diff --quiet --no-ext-diff HEAD --`).
5. There are no non-ignored untracked files (`git ls-files --others --exclude-standard`).
6. `OMNI_VNEXT_E2E_BUILD_EXE` points to the exact Desktop executable produced by that build.
7. SHA-256 of the build executable equals SHA-256 of the installed `Omni-Context.exe`.

Why content identity rather than requiring an empty `git status --porcelain`: on Windows, the Tauri/NSIS toolchain can leave a tracked file with a stat/index-only `.M` advisory even when its Git blob is byte-identical to `HEAD`, `git diff` is empty, and no staged content changed. This occurred during the first real gate attempt on `48f8def7ae45deb8a3fd6ddb4d8af91ccfe9152d`: `desktop-daemon/src-tauri/Cargo.toml` retained `.M` after `git update-index --refresh` / `git add --refresh`, while HEAD and worktree blob hashes were both `1d925069e43dfc3553c9ee20f74661b8426a0712` and working/cached diffs were empty. That attempt correctly remained `PREPARED_NOT_EXECUTED`; the harness was then corrected so future runs distinguish source-content drift from Windows stat-cache noise.

The harness records porcelain output as an advisory but blocks only on actual tracked-content differences or non-ignored untracked source files. The result JSON records the declared/observed HEAD, staged/worktree content checks, any advisory porcelain rows, non-ignored untracked files, and both executable hashes. This gives the installed run a procedural source/build/install binding without treating Windows stat-cache noise as source drift.

## Controlled fixture

The harness reuses the existing `D1B1_CONTROLLED_LOCAL_ONLY` composition path. On startup the packaged Brain creates two real `github.issue.close` plans through:

`EvidenceSurfaceRuntime.evaluateForCapability -> AuthorizationService.authorize`

Expected fixture properties:

- both plans are `awaiting_approval`
- `execution_started = false`
- `github_writes = 0`
- `receipts_created = 0`
- `readback_started = false`
- `outcome_finalized = false`

The harness verifies that the owner **Approve** controls are visible but never presses them, and it never presses **Run approved action**.

## Installed checkpoints

The gate passes only if all of the following are observed:

- source/build/installed artifact identity checks pass
- Brain port and CDP port are free before launch
- packaged app and Brain start under an isolated profile
- D1B1 controlled fixture is created through the normal CP6/CP7 path
- `More -> Control Center` opens `Decision Control Center`
- at least two `github.issue.close` plan cards are visible
- plans remain `awaiting_approval`
- owner **Approve** controls are visible but the execution button is absent
- within the **Live Guard trace** block:
  - Guard action is `proceed`
  - provider `d1b1-controlled-cp6-fixture@1.0.0` is visible
  - source reference `d1b1-controlled-local-fixture` is visible
- within the **Bound plan snapshot** block:
  - the immutable-snapshot explanation is visible
  - `repository.current_state` is visible
  - `issue.current_state` is visible
- authority copy still states `Approved ≠ Executed`
- focused screenshots of both evidence layers and an overview screenshot are captured
- a machine-readable result JSON is written

The source-level unit tests separately cover the restart/eviction `NOT_AVAILABLE` state. This installed gate does **not** fake a restart-invalidated Guard trace or rebuild one from plan state.

## Safety / authority constraints

The gate must preserve all of these invariants:

- no Decision Kernel change
- no CP6 qualification change
- no approval mutation
- no execution
- no external GitHub write
- no receipt registration
- no read-back
- no final outcome mutation
- no reopen operation
- no generic shell / execution gateway
- no persistence of GuardRunStore or QualifiedEvidenceStore
- no paid model evaluation
- no Holdback access

If port `127.0.0.1:3001` is already occupied, the harness fails instead of killing an unrelated running Omni-Context instance.

Preflight failures also write the result JSON when the evidence directory is writable; the gate does not silently disappear before producing a failure record.

## Run on the exact installed artifact

Build the exact content-clean head, install the produced package, then point the gate at both the build executable and installed directory.

Windows PowerShell:

```powershell
$env:OMNI_VNEXT_E2E_INSTALL_DIR = 'C:\path\to\installed-app'
$env:OMNI_VNEXT_E2E_BUILD_EXE = 'C:\path\to\exact-build-output\omni-context-desktop.exe'
$env:OMNI_VNEXT_E2E_PROFILE_DIR = 'C:\path\to\isolated-vnext-profile'
$env:OMNI_VNEXT_E2E_EVIDENCE_DIR = 'C:\path\to\vnext-e2e-evidence'
$env:OMNI_VNEXT_E2E_EXPECTED_SHA = '<full 40-char git head used for the build>'

cd desktop-daemon
npm run e2e:vnext-control-center:installed
```

The gate environment must already have Playwright available, matching the repository's existing installed-E2E convention.

## Output

Expected evidence files:

- `vnext-d1b1-controlled-fixture.json`
- `vnext-control-center-live-guard.png`
- `vnext-control-center-bound-snapshot.png`
- `vnext-control-center-installed.png`
- `vnext-control-center-installed-result.json`

The result JSON records:

- PASS / FAIL
- declared and observed Git HEAD
- staged tracked-content identity versus HEAD
- working-tree tracked-content identity versus HEAD
- non-ignored untracked files
- advisory porcelain rows and whether they were stat-only
- build executable SHA-256
- installed executable SHA-256
- whether the executable hashes match
- checkpoint results
- explicit zero-write / zero-execution authority invariants
- captured screenshot filenames
- failure reason when applicable

## CI preflight versus installed execution

Normal CI runs only a syntax preflight:

```text
node --check desktop-daemon/e2e-control-center-installed.cjs
```

That protects the harness from syntax drift but is **not** an installed gate execution and must never be reported as one.

## Promotion rule

Do **not** call this gate PASS from source review, CI build success, syntax preflight success, or the existence of the harness.

Promotion to `INSTALLED_WINDOWS_LOCAL_CONTROLLED = PASS` requires an actual run against the exact bound installed artifact and review of the result JSON plus screenshots. Until then the authoritative state remains:

```text
VNEXT_CONTROL_CENTER_INSTALLED_GATE = PREPARED_NOT_EXECUTED
```
