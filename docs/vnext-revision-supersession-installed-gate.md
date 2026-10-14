# vNext Revision Supersession — Installed Gate

Status: **PREPARED / NOT EXECUTED**

This gate is separate from the historical Goal27 and Goal29 freeze evidence. It validates one vNext user-facing refinement on a real installed Windows artifact: once a judgment has been revised, the historical judgment remains auditable but is explicitly marked **superseded** and exposes no mutation controls.

## Purpose

Goal27 already enforces a linear DecisionRevision chain server-side. Only the latest decision may be reopened; attempting to reopen a stale ancestor fails closed with `REVISION_FORK_BLOCKED`.

This gate proves the Desktop projection matches that authority model before the user sends a request:

- the historical decision stays visible for audit;
- it is labeled `Superseded judgment`;
- the card identifies the chain's current decision;
- historical mutation controls are absent;
- the current revised judgment is labeled `Current judgment`;
- the fresh revised plan remains `awaiting_approval` and still requires a new human approval.

The gate does **not** change the Goal27 writer or make the UI authoritative over revision validity.

## Controlled lifecycle fixture

The explicit opt-in fixture is:

`brain-server/src/revision/vnext-supersession-fixture.ts`

It is composed only when all required local gate environment variables are set. It uses the existing controlled D1B1 evidence provider and the real production composition:

`CP6 evidence qualification -> CP7 authorization -> controlled synthetic mismatch read-back -> Goal27 DecisionRevisionService.reopen`

The fixture intentionally registers one deterministic in-memory execution receipt and one deterministic synthetic read-back observation so the real outcome service can produce `MISMATCH` and the real Goal27 revision service can create a fresh judgment. This is controlled-local evidence only:

- native broker execution: **NO**
- external GitHub write: **0**
- model-provider calls: **0**
- Holdback access: **NO**
- old approval reused: **NO**
- old grant reused: **NO**
- old plan reused: **NO**
- fresh revised plan: **awaiting_approval**

The fixture must never be described as a zero-receipt or zero-read-back test; it uses synthetic controlled receipt/read-back material by design. The safety claim is that no native/external side effect occurs and no historical authority is reused.

## Exact source / artifact binding

Before UI assertions, `desktop-daemon/e2e-supersession-installed.cjs` requires:

1. a full expected 40-character Git SHA;
2. current repository `HEAD` equals that SHA;
3. staged tracked content equals `HEAD`;
4. working-tree tracked content equals `HEAD`;
5. no non-ignored untracked source files;
6. SHA-256(build `Omni-Context.exe`) equals SHA-256(installed `Omni-Context.exe`).

Windows stat-cache-only porcelain differences may be recorded as advisory when content identity checks are clean; content drift is never ignored.

## Installed checkpoints

A PASS requires all of the following on the real installed Desktop artifact:

- packaged Desktop and Brain start under an isolated profile;
- the controlled supersession fixture completes through the real Goal27 revision service;
- original outcome is `MISMATCH`;
- revised plan is `awaiting_approval` and requires fresh approval;
- `More -> Control Center` opens `Decision Control Center`;
- the original card has `data-decision-role="superseded"`;
- the revised card has `data-decision-role="current"`;
- the original card visibly says `Superseded judgment` and `Historical judgment · superseded`;
- the original card still shows its historical `MISMATCH` outcome and the current decision id;
- the original card has zero `Approve`, `Run approved action`, `Verify reality`, `Reopen with current evidence`, and `Reconsider judgment` buttons;
- the original card states that mutation controls are disabled;
- the current card visibly says `Current judgment`;
- the current card shows revision history including revision 1;
- the current revised plan exposes exactly one `Approve` control and no execution control before approval;
- the harness never clicks any mutation control.

## Evidence outputs

A real run writes, at minimum:

- `vnext-supersession-d1b1-fixture.json`
- `vnext-supersession-fixture.json`
- `vnext-supersession-original-card.png`
- `vnext-supersession-current-card.png`
- `vnext-supersession-installed.png`
- `vnext-supersession-installed-result.json`

The result JSON records exact source/artifact binding, checkpoints, and these authority invariants:

- `ui_mutation_clicked = false`
- `native_execution_started = false`
- `external_github_writes = 0`
- `synthetic_receipt_registered = true`
- `synthetic_readback_registered = true`
- `old_approval_reused = false`
- `old_grant_reused = false`
- `old_plan_reused = false`

## Run command

The harness is intentionally not added to the controlled Desktop `package.json`. Run it directly from the exact source checkout:

```powershell
cd desktop-daemon
node e2e-supersession-installed.cjs
```

It requires external Playwright tooling to be resolvable by Node. The previous vNext installed gate used Playwright `1.41.2` from a tooling directory outside the product source tree; reusing that external tooling is acceptable and must not mutate product source or lockfiles.

Required environment variables:

- `OMNI_VNEXT_SUPERSESSION_INSTALL_DIR`
- `OMNI_VNEXT_SUPERSESSION_PROFILE_DIR`
- `OMNI_VNEXT_SUPERSESSION_EVIDENCE_DIR`
- `OMNI_VNEXT_SUPERSESSION_BUILD_EXE`
- `OMNI_VNEXT_SUPERSESSION_EXPECTED_SHA`

## Promotion rule

Source review, unit tests, CI build, harness syntax success, or historical Goal27 gates are not sufficient for this vNext installed claim.

Only after an exact-bound installed Windows run and manual review of the result JSON plus screenshots may the state become:

```text
VNEXT_REVISION_SUPERSESSION_INSTALLED_GATE = INSTALLED_WINDOWS_LOCAL_CONTROLLED_PASS
```

Until then the authoritative state is:

```text
VNEXT_REVISION_SUPERSESSION_INSTALLED_GATE = PREPARED_NOT_EXECUTED
```
