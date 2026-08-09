# Generator Repair Diff (Goal 18H-E)

Scope: two generator source files under `goal18-output/scripts/generator/`.
Repair commit: a17864b931fbcbd8761dd46a94fc06054f1f981e
Pre-repair repo HEAD: fcbf9d22518798decf36623a5dc12f159d87c547

## 1. TT03 authority/action repair — builders-tt01-05.mjs

Before:

```js
const allViolate = variant === 1;
```

After:

```js
// Goal 18H-E repair: authority L0/L1 grants no AI decision right (A can_decide L0/L1 = false; K:195 DECIDE gate requires authority allows).
// A TT03 slot at L0/L1 can therefore only exercise the refusal/referral (REJECT, no feasible option) path, never DECIDE.
const allViolate = variant === 1 || ctx.authority === 'L0' || ctx.authority === 'L1';
```

Root cause (HREV-052, sample decision-bench-v2-val-tt03-002):
- Frozen authority contract: L0/L1 `can_decide=false`, `decision_right=user`;
  the DECIDE gate requires "authority allows" (EXTRACT-A §§1.3, 3.2; K:195;
  P L2-CONFIRM-BEFORE-ACTION).
- TT03's only golden branches are DECIDE or REJECT. At L0/L1 DECIDE is legally
  impossible, and the generator's compliant-option branch produced DECIDE for
  variant 0/2. The deterministic rule now forces the no-feasible-option REJECT
  branch for every L0/L1 slot (all candidates violate a hard constraint).
- Classification: ISOLATED_FIXTURE_DEFECT resolved by deterministic generator
  repair; no other TT03 slot carries the defect (full 120-sample audit: 0).

## 2. TT15 delete-source propagation repair — builders-tt11-15.mjs

Before:

```js
mkEvidence('ev001', 'fact', `${labA} 仍为可用选项（现行信息）`, qtMs - 5 * 86400000, ['opt-a', 'opt-b'], 0.8, 'e001'),
```

After:

```js
// Goal 18H-E repair: re-express ev001 as evidence of the deletion event itself (source_ref=e004,
// timestamp=e004.at, supports=[]); no current fact may be sourced from deleted e001 (RI-06; G:94-99).
mkEvidence('ev001', 'fact', `原决定依据（${factText}）已被撤回/删除`, deletedAt, [], 1, 'e004'),
```

Root cause (HREV-088/089/090 + full-audit extension, all 8 TT15 samples):
- timeline e001 -> old decision depends on e001 -> e004 deletes e001 ->
  ex001 correctly `source_deleted`, but qualified ev001 still sourced e001.
- Violates RI-06 / G:94-99 (no current fact from a deleted source). The repair
  re-expresses ev001 as evidence of the deletion event itself using only facts
  already present (delete event e004 + propagation principle ev002). No new
  real-world event is invented.
- Gold semantics preserved: INVALIDATE, lineage invalidate(parent=decision-d1),
  required_evidence [ev001, ev002], prohibited_evidence [ex001].

## 3. What was NOT changed

- Round 1/2 raw, agreement JSON/report, rubric, crosswalk, scorer v1.1,
  Decision Kernel, prompts, models, budgets, statistical policy, Holdback V2.
- No HR1 answer or future model result influenced any repair.

## 4. Provenance assembly rule for Validation V2

- Regenerated with the repaired generator (v2.1.0) using the frozen seed
  `goal18-validation-seed-7f3a9c2e`.
- The 111 human-review-unchanged samples keep `generator_identity =
  goal18-generator/v2.0.0`; the 9 post-review-modified samples carry
  `goal18-generator/v2.1.0`.
- Gold is byte-identical to the generator output; the V2 fixture equals the
  generator output after that provenance normalization.

## 5. Regression coverage

See `generator-repair-regression-tests/` (8 tests, all pass):
- deterministic regeneration matches committed V2 (gold byte-identical; fixture
  matches under the provenance assembly rule);
- TT03 L0/L1 = REJECT/no_feasible_option, never DECIDE;
- TT15 ev001 sources e004 with supports=[], ex001/ev002 preserved;
- full 120 x 9-dimension contract audit ERROR=0;
- source-level invariant: no HR1/model-output dependence.
