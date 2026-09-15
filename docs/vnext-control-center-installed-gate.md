# vNext Decision Control Center — Installed Gate

Status: **PREPARED / NOT EXECUTED**

This gate is intentionally separate from the Goal29 V1 freeze evidence. It validates the vNext Decision Control Center on a real installed Windows Desktop artifact without changing the frozen Goal29 record or claiming that the historical V1 installer already contained these diagnostics.

## Purpose

Prove, at installed-app level, that the owner can open the real Desktop Control Center and inspect the two evidence layers added by vNext:

1. **Live Guard trace** — bounded process-local CP6 diagnostic data while the Guard ledger still contains the run.
2. **Bound plan snapshot** — immutable evidence coverage already attached to the authorized plan.

This is an observability gate, not an execution gate.

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

The harness never presses **Approve** and never presses **Run approved action**.

## Installed checkpoints

The gate passes only if all of the following are observed in the packaged Desktop UI:

- packaged app and Brain start under an isolated profile
- D1B1 controlled fixture is created through the normal CP6/CP7 path
- `More -> Control Center` opens `Decision Control Center`
- at least two `github.issue.close` plan cards are visible
- plans remain `awaiting_approval` and the execution button is absent
- `Live Guard trace` is visible
- Guard action is `proceed`
- controlled provider provenance is visible:
  - `d1b1-controlled-cp6-fixture@1.0.0`
  - source reference `d1b1-controlled-local-fixture`
- `Bound plan snapshot` is visible
- `repository.current_state` and `issue.current_state` are visible
- authority copy still states `Approved ≠ Executed`
- a screenshot is captured
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

## Run on the exact installed artifact

Windows PowerShell:

```powershell
$env:OMNI_VNEXT_E2E_INSTALL_DIR = 'C:\path\to\installed-app'
$env:OMNI_VNEXT_E2E_PROFILE_DIR = 'C:\path\to\isolated-vnext-profile'
$env:OMNI_VNEXT_E2E_EVIDENCE_DIR = 'C:\path\to\vnext-e2e-evidence'
$env:OMNI_VNEXT_E2E_EXPECTED_SHA = '<exact git head used to build the installer>'

cd desktop-daemon
npm run e2e:vnext-control-center:installed
```

The gate environment must already have Playwright available, matching the repository's existing installed-E2E convention.

## Output

Expected evidence files:

- `vnext-d1b1-controlled-fixture.json`
- `vnext-control-center-installed.png`
- `vnext-control-center-installed-result.json`

The result JSON records:

- PASS / FAIL
- exact expected Git head if supplied
- installed `Omni-Context.exe` SHA-256
- checkpoint results
- explicit zero-write / zero-execution authority invariants
- screenshot filename
- failure reason when applicable

## Promotion rule

Do **not** call this gate PASS from source review, CI build success, or the existence of the harness.

Promotion to `INSTALLED_WINDOWS_LOCAL_CONTROLLED = PASS` requires an actual run against the exact installed artifact and review of both the result JSON and screenshot. Until then the authoritative state remains:

```text
VNEXT_CONTROL_CENTER_INSTALLED_GATE = PREPARED_NOT_EXECUTED
```
