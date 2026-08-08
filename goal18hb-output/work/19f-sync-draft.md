# Goal 19F → Holdback V2 Sync Draft (Goal 18HB)

Status: **DRAFT — READ-ONLY research output**. Prepared by the Goal 18HB agent; no `goal19f-output` file was modified. The final `formal-config-holdback-v2-sync-report.md` is written by the lead **after** the V2 seal.

## 1. Scope and constraints honored

- Source of truth: `D:\ai_code\Omni-context\goal19f-output\` (8 files examined) and Goal 18 **public metadata only** (`goal18-output/holdback-public-manifest.json`, `goal18-output/holdback-run-auth.json`).
- Never read, listed, or opened `C:\Users\00\.codex\goal18-holdback-custody\` (prohibited).
- `holdback-fixtures.jsonl` never read anywhere; its path string appears only as metadata inside `holdback-public-manifest.json`.
- `goal18-output/holdback-sealed.bin` not opened; only its `sha256`/`cipher` metadata (from manifests) is referenced.
- `ablation-harness-identity.json` contains **no holdback references** (verified by full-file scan) — zero sync impact.

## 2. Summary

- **UPDATE: 12 fields** — 10 sanctioned by the §17 allowlist + 2 flagged **SPEC_GAP** (not on the allowlist but necessarily change at V2; need lead sign-off).
- **NO_CHANGE: 37 fields** — includes 3 allowlisted-but-unchanged items (schema hash ×2, replacement-note item with no 19F field).
- Total holdback-related references mapped: **49**.
- Machine-readable detail: `work/19f-holdback-refs.json` (one record per field: file, json_path, line, current_value, action, reason, allowed_by_spec, new_value).

## 3. UPDATE fields (new value = `TBD_AFTER_SEAL` until the V2 seal)

### 3.1 Sanctioned by §17 allowlist (10)

| # | JSON path | File:line | Current value | New value | §17 item |
|---|-----------|-----------|---------------|-----------|----------|
| 1 | `goal18_integrity.holdback_public_manifest.file` | formal-run-config-v1.json:418 | `goal18-output/holdback-public-manifest.json` | `TBD_AFTER_SEAL` | 1 identity (path) |
| 2 | `goal18_integrity.holdback_public_manifest.schema` | formal-run-config-v1.json:419 | `holdback-seal-manifest-v2` | `TBD_AFTER_SEAL` | 1 identity (schema) |
| 3 | `goal18_integrity.holdback_public_manifest.holdback_fixture_sha256` | formal-run-config-v1.json:420 | `f3a69fcd2d0167dafa8d6debd8ccb0b4893434a80811f96d6241f4feb668ba4a` | `TBD_AFTER_SEAL` | 4 fixture hash |
| 4 | `goal18_integrity.holdback_public_manifest.sealed_artifact.file` | formal-run-config-v1.json:422 | `goal18-output/holdback-sealed.bin` | `TBD_AFTER_SEAL` | 1 identity (sealed-artifact path) |
| 5 | `goal18_integrity.holdback_public_manifest.sealed_artifact.sha256` | formal-run-config-v1.json:423 | `f0d08a12731299fd0246492babc2edd118a08c836588ad0aa841b84543333ea3` | `TBD_AFTER_SEAL` | 5 seal hash |
| 6 | `budget_estimates.holdback.samples` | formal-run-config-v1.json:471 | `TBD (target 180 per D-08)` | `TBD_AFTER_SEAL` | 2 sample count |
| 7 | `goal18_integrity.holdback_public_manifest` | formal-experiment-freeze-manifest.json:130 | `goal18-output/holdback-public-manifest.json (schema holdback-seal-manifest-v2; fixture sha256 f3a69fcd...; sealed artifact f0d08a12...)` | `TBD_AFTER_SEAL` | 1+4+5 (compact string) |
| 8 | `model_identity.validation_holdback_estimates.holdback` | formal-experiment-freeze-manifest.json:165 | `single sealed pass; samples TBD (target 180 per D-08)` | `TBD_AFTER_SEAL` | 2 sample count |
| 9 | `budget_estimates.holdback.samples` | model-and-budget-owner-decision.json:52 | `TBD (target 180 per D-08; holdback-public-manifest counts.total is null pending dataset freeze)` | `TBD_AFTER_SEAL` | 2 sample count |
| 10 | `R-BUDGET-1` (holdback sentence) | unresolved-formal-run-risks.md:107 | `confirmed; validation (120) and holdback (TBD, target 180) cost estimates are` | `TBD_AFTER_SEAL` | 2 sample count |

Exact new values are copied from the V2 public manifest / seal output during the post-seal sync.

### 3.2 SPEC_GAP — change required but NOT on the §17 allowlist (2, need lead decision)

| # | JSON path | File:line | Current value | New value | Why it drifts |
|---|-----------|-----------|---------------|-----------|---------------|
| 11 | `goal18_integrity.holdback_public_manifest.seed_hash` | formal-run-config-v1.json:426 | `0f898583f08b4aeaab5bf334224582c4144eeec581612bace4e7345b770909cf` | `TBD_AFTER_SEAL` | A V2 fixture set necessarily has a new seed → this value must change, but §17 lists only identity, sample count, schema/fixture/seal hash, replacement note. |
| 12 | `goal18_integrity.holdback_public_manifest.sha256_of_manifest` | formal-run-config-v1.json:427 | `d433bfa5edd9a10d361dd478a3b4a68a4e8271766b17e07f0c7976d6bdbb0fd8` | `TBD_AFTER_SEAL` | Hash of the manifest file itself; necessarily changes when the V2 manifest replaces v1. Not explicitly listed; arguably covered by "manifest identity". |

**Lead action:** either (a) treat both as within "holdback public manifest identity" and record that interpretation in the final sync report, or (b) issue an explicit scope extension to §17. The sync must not touch them otherwise.

## 4. NO_CHANGE fields (37) — grouped by file

### 4.1 formal-run-config-v1.json (12)

- `datasets.prohibited[1]` (L382) — policy prohibition; remains true for V2 (plaintext never decrypted, manifest metadata-only).
- `goal18_integrity.note` (L399) — metadata-only policy note; not allowlisted.
- `goal18_integrity.holdback_public_manifest.sealed_artifact.cipher` (L424) — not allowlisted; AES-256-GCM expected unchanged.
- `goal18_integrity.benchmark_schema.sha256` (L431) — **allowlisted (schema hash) but expected unchanged**: decision-benchmark-v2 schema is shared with validation; UPDATE only if V2 references a different schema.
- `goal18_integrity.access_policy` (L437) — policy statement; not allowlisted.
- `budget_estimates.holdback.arms` (L472) — budget/design; §17 budgets = NO_CHANGE.
- `budget_estimates.holdback.max_attempts` (L473) — budget/design; §17 budgets = NO_CHANGE.
- `budget_estimates.holdback.formula` (L474) — budget formula; §17 budgets = NO_CHANGE.
- `budget_estimates.holdback.estimated_cost_cny` (L475) — budget estimate (null until pricing); §17 budgets = NO_CHANGE.
- `budget_estimates.holdback.note` (L476) — budget note; the §17 "replacement note" item refers to the V2 manifest note, not this field.
- `remote_data_processing.prohibited[6]` (L493) — egress prohibition; not allowlisted.
- `remote_data_processing.holdback_rule` (L495) — two-person ceremony egress rule; not allowlisted.

### 4.2 formal-experiment-freeze-manifest.json (6)

- `blocker_status.B1.decided.remote_processing` (L19) — owner-decision policy text; not allowlisted.
- `datasets.goal18.holdback` (L83) — status text ("NOT RUN; plaintext never decrypted; public manifest metadata only") stays true for V2.
- `goal18_integrity.benchmark_schema_sha256` (L131) — **allowlisted (schema hash) but expected unchanged** (same reasoning as 4.1).
- `goal18_integrity.note` (L132) — metadata-only policy note; not allowlisted.
- `model_identity.validation_holdback_estimates.status` (L163) — budget status; §17 budgets = NO_CHANGE.
- `model_identity.validation_holdback_estimates.validation` (L164) — validation estimate (120); not holdback, not allowlisted.

### 4.3 model-and-budget-owner-decision.json (12)

- `approved_main_model.role` (L12) — model role text; §17 model = NO_CHANGE; remains true for the V2 pass.
- `budget_cny.rules[1]` (L38) — budget rule; §17 budgets = NO_CHANGE.
- `budget_estimates.validation.note` (L49) — budget note; §17 budgets = NO_CHANGE.
- `budget_estimates.holdback.arms` (L53), `.max_attempts` (L54), `.formula` (L55), `.estimated_cost_cny` (L56), `.note` (L57) — budget fields; §17 budgets = NO_CHANGE.
- `remote_data_processing.prohibited[6]` (L76) — egress prohibition; not allowlisted.
- `remote_data_processing.holdback_rule` (L78) — ceremony egress rule; not allowlisted.
- `next_steps[0]` (L108) — next-step text on finalizing estimates; not allowlisted.
- `next_steps[2]` (L110) — run-order plan ("validation (120) then single sealed holdback ceremony"); remains true; not allowlisted.

### 4.4 formal-run-authorization-template.json (2)

- `frozen.model.note` (L145) — authorization template; §17 explicitly lists authorization template = NO_CHANGE.
- `frozen.model.remote_processing` (L157) — authorization template egress policy; §17 = NO_CHANGE.

### 4.5 prompt-byte-manifest.json (1)

- `provenance.validation_holdback_note` (L10) — prompt policy note; §17 explicitly lists prompts = NO_CHANGE (the note itself forbids holdback-specific wording, which stays true for V2).

### 4.6 unresolved-formal-run-risks.md (1)

- `R-HOLD-1` (L72-78) — risk register; risk and mitigation remain true for V2; not allowlisted.

### 4.7 dry-run-report.md (2) — historical report, skimmed for holdback only

- L6-7 constraints-honored sentences — record of the completed preflight; not allowlisted.
- L72 authorization-refusal test description — historical; not allowlisted.

### 4.8 Allowlist item with no 19F field (1)

- `replacement note` (§17 item 6) — no Goal 19F file contains a replacement-note field; the note is carried by the V2 public manifest itself. Nothing to sync.

## 5. Quoted current lines (verbatim, UTF-8)

### 5.1 formal-run-config-v1.json L417-437 — `goal18_integrity.holdback_public_manifest` block + schema/access-policy

```
    "holdback_public_manifest": {
      "file": "goal18-output/holdback-public-manifest.json",
      "schema": "holdback-seal-manifest-v2",
      "holdback_fixture_sha256": "f3a69fcd2d0167dafa8d6debd8ccb0b4893434a80811f96d6241f4feb668ba4a",
      "sealed_artifact": {
        "file": "goal18-output/holdback-sealed.bin",
        "sha256": "f0d08a12731299fd0246492babc2edd118a08c836588ad0aa841b84543333ea3",
        "cipher": "AES-256-GCM"
      },
      "seed_hash": "0f898583f08b4aeaab5bf334224582c4144eeec581612bace4e7345b770909cf",
      "sha256_of_manifest": "d433bfa5edd9a10d361dd478a3b4a68a4e8271766b17e07f0c7976d6bdbb0fd8"
    },
    "benchmark_schema": {
      "file": "goal18-output/schema/decision-benchmark-v2-schema.json",
      "sha256": "aad31f90203322b2f71c586f21379eb991b5faa1ceeddf4185b92577293264f4"
    },
    "annotation_guide": {
      "file": "annotation-guide.md",
      "note": "read-only reference; governs gold annotation semantics"
    },
    "access_policy": "formal runs never read validation fixture/gold content or holdback plaintext; only the hashes above are used for integrity gates"
```

### 5.2 formal-run-config-v1.json L470-477 — `budget_estimates.holdback` block

```
    "holdback": {
      "samples": "TBD (target 180 per D-08)",
      "arms": 6,
      "max_attempts": 3,
      "formula": "samples x arms x attempts x tokens_per_call x price_per_token",
      "estimated_cost_cny": null,
      "note": "single sealed pass; finalized before holdback ceremony; fits within ¥220"
    }
```

### 5.3 Other key lines

`formal-experiment-freeze-manifest.json:130`

```
    "holdback_public_manifest": "goal18-output/holdback-public-manifest.json (schema holdback-seal-manifest-v2; fixture sha256 f3a69fcd...; sealed artifact f0d08a12...)",
```

`model-and-budget-owner-decision.json:52`

```
      "samples": "TBD (target 180 per D-08; holdback-public-manifest counts.total is null pending dataset freeze)",
```

`unresolved-formal-run-risks.md:107`

```
  confirmed; validation (120) and holdback (TBD, target 180) cost estimates are
```

## 6. §17 allowlist coverage map

| §17 item | Goal 19F field(s) it maps to | Sync disposition |
|----------|------------------------------|------------------|
| 1 identity (path/schema) | config L418, L419, L422; freeze L130 (path+schema inside string) | UPDATE |
| 2 sample count | config L471; freeze L165; owner L52; risks L107 | UPDATE |
| 3 schema hash | config L431; freeze L131 | NO_CHANGE (permitted; expected identical) |
| 4 fixture hash | config L420; freeze L130 (inside string) | UPDATE |
| 5 seal hash | config L423; freeze L130 (inside string) | UPDATE |
| 6 replacement note | no Goal 19F field exists | NO_CHANGE (carried by V2 manifest) |
| — (spec gap) | config L426 seed_hash, L427 sha256_of_manifest | UPDATE only with lead scope sign-off |

## 7. Post-sync obligations (lead, after V2 seal)

- Copy new values from the V2 public manifest (path/schema identity, `counts.total` → sample count, `schema_sha256`, `sha256` fixture hash, `sealed_artifact.sha256` seal hash) and from the seal output (seed hash, manifest sha256).
- Re-hash the edited configuration (`configuration_sha256_sealed.development/regression` in formal-run-config-v1.json L9-13) — not a holdback field, but any config edit invalidates the old sealed hashes; the final sync report must record the new hashes.
- Re-verify `ready_conditions` in the freeze manifest after editing L130/L165 (the freeze manifest re-verification is already a formal-run requirement).
- Do NOT touch: model, prompts, A0-A5 definitions, scorer, product, evaluator, validation protocol, hypothesis, metrics, budgets (except the allowlisted sample-count fields), authorization template.
- This draft must NOT be treated as the final report; the lead writes `formal-config-holdback-v2-sync-report.md` after the V2 seal.
