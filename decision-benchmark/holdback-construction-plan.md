# Holdback Construction Plan (holdback 构建计划)

This plan defines how a **holdback** set is constructed from the fixture pool so
that a future real evaluation of the decision benchmark is not contaminated.
This round does **not** run that evaluation; it only establishes the process and
the anti-leakage invariants, and pins the current dev/reg pool as the seed.

## 1. Roles of the three sets

| Set | Role | Used for | May the system tune on it? |
|---|---|---|---|
| `development-fixtures.jsonl` | development | debugging, metric sanity, per-type diagnostics | yes |
| `regression-fixtures.jsonl` | regression | catching regressions between releases | only via the frozen reference judge (no sample-content leakage) |
| **holdback** | final measurement | the only set reported as "benchmark result" | **never** |

## 2. Construction procedure (for a future holdback)

1. **Author new samples** for each of the 15 task types (≥ 3 per type), using
   `decision-benchmark-schema.json`. Author independently of dev/reg content
   (different domains where possible).
2. **Split** the union pool (dev + reg + new) into three disjoint sets:
   - development ≈ 70%,
   - regression ≈ 15%,
   - holdback ≈ 15%, **stratified by task_type** (each set keeps ≥1 sample per
     type, and the holdback keeps the same task-type balance as the union).
3. **Freeze** the holdback:
   - write `holdback-manifest.json` with `schema_version`, per-file SHA-256,
     per-sample `sample_id` list, `frozen_at`, and the exact `node`/judge
     version used for scoring;
   - store it in a reviewer-only location (separate PR, no merge into the dev
     branch) so the system-under-test never sees holdback content.
4. **Score** dev/reg first; only after the judge passes its integrity tests
   may the holdback be scored, once, by the frozen judge.

## 3. Anti-leakage invariants (must hold for every pair of sets)

For any two samples in different sets (dev vs reg, dev vs holdback, reg vs
holdback):

- `sample_id` differs (namespaces `dev-*`, `reg-*`, `hbk-*`).
- Normalized `narrative` differs (whitespace/lowercase normalization, plus a
  similarity guard: no 8-gram overlap ≥ 3 between narratives).
- Entity id sets are disjoint (`ev-*`, `dec-*`, `E-*`, `F-*`, `cost-*`, ...).
- Decision ids referenced in `historical_decisions` are disjoint across sets.
- No shared distinctive proper nouns (vendor/company names) across sets.

These invariants are enforced by `benchmark-integrity-tests/tests/
leakage.test.mjs` for the current dev/reg pair and are a required CI gate for
any future holdback addition.

## 4. Why current dev/reg already satisfy the invariants

- Namespaces: `dev-001..dev-034` vs `reg-001..reg-015` — disjoint.
- Domains deliberately differ (tech stack/office/insurance vs
  framework/device/log-storage/...).
- Entity/decision ids are namespaced and disjoint (`ev-*`/`dec-1..25` vs
  `dec-20..26`, `cost-1`, ...).

## 5. Freeze & authorization checklist (when a real run is authorized)

- [ ] `benchmark-integrity-tests` all green (schema, coverage, scorer,
      taxonomy, leakage).
- [ ] Holdback manifest signed/frozen (annotated tag or reviewer-approved
      commit) BEFORE the run.
- [ ] Reference judge pinned (commit hash recorded in manifest).
- [ ] Run protocol executed exactly per `decision-benchmark-v1.md` §5.
- [ ] No fixture content added/modified after freeze; any change requires a new
      freeze version.

## 6. This round's deliverable status

- Seed pools authored and validated (dev 34, reg 15).
- Leakage invariants implemented as tests for the dev/reg pair.
- Holdback manifest **not** created and no holdback evaluation run — both are
  future, operator-gated steps per §2–§5.
