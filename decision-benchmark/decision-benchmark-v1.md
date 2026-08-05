# Omni-Context Decision Benchmark v1

Status: **specification + fixtures + integrity tests**. This round builds the
benchmark; it does **not** run formal model evaluation.

## 1. Purpose

Evaluate the **decision capability** of Omni-Context (or any decision system)
deterministically: given a fixed memory timeline and a decision situation, does
the system pick the right action, at the right time, with a traceable
explanation? The benchmark fixes every input, so scores are reproducible
without provider calls.

## 2. Scope & non-goals

- ✅ Deterministic scoring from fixed fixtures (reference judge, no LLM).
- ✅ 15 task types covering the decision failure modes the product cares about.
- ✅ Regression + development fixture pools and a holdback construction plan.
- ✅ Integrity tests that verify the benchmark itself.
- ❌ No model/provider evaluation is run in this round.
- ❌ No performance claim about the product is derived from these fixtures.

## 3. Task types (任务类型)

| # | Type | Expected action family |
|---|---|---|
| 1 | 信息充分，必须二选一 | `decide` |
| 2 | 缺失关键变量，应只问一个关键问题 | `clarify` (exactly 1) |
| 3 | 两方案都可行，但一个违反硬约束 | `decide` (exclude violator) |
| 4 | 旧事实已经过期 | `decide`/`persist` with current fact |
| 5 | 多来源冲突 | `decide` (resolvable) or `clarify` (unresolvable) |
| 6 | 新证据足以推翻旧决定 | `revise` |
| 7 | 新证据不足以推翻旧决定 | `persist` |
| 8 | 低风险可逆决策 | `decide` (decisive) |
| 9 | 高风险不可逆决策 | `decide` (with risk) or `clarify` (key unknown) |
| 10 | 执行失败后的修订 | `revise` |
| 11 | 结果良好后的决策延续 | `persist`/`continue` |
| 12 | 多 Agent 建议冲突 | `decide` (resolve) or `clarify` (missing variable) |
| 13 | 用户主动覆盖 AI 决定 | `accept_override` |
| 14 | 到达 revisit_at | `flag_review` |
| 15 | 删除证据后的决策失效传播 | `flag_review` (invalidate chain) |

## 4. Sample schema

Every sample is a single JSON object; see
`decision-benchmark-schema.json` (JSON Schema draft 2020-12) for the complete
constraints. Required fields per sample:

- identity & metadata: `schema_version`, `sample_id`, `task_type`, `title`,
  `narrative`, `tags`;
- decision anatomy: `goal`, `candidates`, `hard_constraints`,
  `soft_preferences`;
- evidence anatomy: `valid_evidence`, `expired_evidence`,
  `conflicting_evidence` (with conflict `group`), all carrying `entity_id`,
  `content`, and temporal status;
- history & outcomes: `historical_decisions` (with status + optional
  `revisit_at`), `execution_results` (with `outcome_score`, failure details);
- expected behavior: `expected_decision_action`,
  `expected_action_detail` (action, selected_candidate, clarifying_question,
  max_clarifying_questions, revision_type, persisted_decision_id, risk_level),
  `acceptable_explanation` (features with `must_mention` tokens),
  `severe_failure_label`;
- `memory_timeline`: ordered events of kinds `goal`, `candidate`,
  `hard_constraint`, `soft_preference`, `evidence`, `evidence_expired`,
  `evidence_conflict`, `evidence_deleted`, `decision`, `decision_revision`,
  `outcome`, `agent_advice`, `user_override`, `revisit_due`.

## 5. Protocol (运行协议)

### 5.1 Seeding

For each sample:

1. Create a fresh, empty Omni-Context database (`initDatabase(':memory:')`).
2. Replay `memory_timeline` deterministically:
   - `goal`/`candidate`/`hard_constraint`/`soft_preference` → recorded as
     entities/metadata (goal & constraints may be attached to the situation
     narrative);
   - `evidence` → `addEntity` (type `evidence`, with `valid_until` for expired
     items);
   - `evidence_deleted` → `deleteEntity(evidence_id)` (hard delete, which is
     exactly what the invalidation-propagation task must observe);
   - `decision` → `save_decision` with the decision's metadata
     (conclusion, confidence, revisit_at for task 14, lineage links for
     task 15);
   - `outcome` → `record_decision_outcome`;
   - `agent_advice`/`user_override`/`revisit_due` → recorded as entities with
     clear provenance so retrieval surfaces them.
3. The situation `narrative` is presented as the user's current question.

### 5.2 Response envelope

The system-under-test must return (or the harness extracts) a structured
response:

```json
{
  "action": "decide|clarify|persist|revise|flag_review|accept_override|abstain",
  "selected_candidate": "candidate id or null",
  "clarifying_questions": ["..."],
  "revision_type": "supersede|reverse|revise|continue|invalidate|null",
  "revised_decision_id": "id or null",
  "explanation": "free text",
  "cited_evidence_ids": ["entity ids"]
}
```

The harness may derive this envelope from the decision tools
(`get_decision_context`, `analyze_decision`, `save_decision`,
`record_decision_outcome`) or from the system's direct answer; the mapping must
be fixed before scoring and covered by integrity tests.

### 5.3 Scoring

The deterministic reference judge (`benchmark-integrity-tests/lib/
reference-scorer.mjs`) computes the 14 metrics defined in
`metric-definitions.md` and the failure class per `failure-taxonomy.md`.

Safety gate: if any hard-constraint sample's chosen candidate violates a hard
constraint (`Hard Constraint Violation Rate > 0` over task-type-3 samples), the
run is **FAILED_GATE** regardless of other metrics.

## 6. Fixture pools

- `development-fixtures.jsonl` — 34 samples, ≥2 per task type (types 1,2,5 have
  3–4). Used for development and per-type diagnostics.
- `regression-fixtures.jsonl` — 15 samples (one per task type + edge cases).
  Disjoint from development (distinct `sample_id` namespace `reg-*`, distinct
  narratives/entity ids). Used to catch regressions in decision behavior.
- Holdback construction: see `holdback-construction-plan.md`.

## 7. Integrity requirements

`benchmark-integrity-tests/` must pass before any scoring run is trusted:

1. All fixture lines parse as JSON and satisfy `decision-benchmark-schema.json`
   (validated by `tests/schema.test.mjs` against the field rules).
2. Development set covers all 15 task types; every sample's
   `expected_decision_action` is legal for its task type.
3. Development and regression sets are disjoint (ids, narratives, entity ids).
4. Timelines are internally consistent (expired evidence has `valid_until` in
   the past; `evidence_deleted` references an entity id present earlier; task 14
   samples have `revisit_at` ≤ timeline end; task 15 samples contain
   `evidence_deleted`).
5. The reference judge is deterministic (same input → same score) and its
   per-metric formulas are unit-tested on handcrafted micro-cases.
6. The failure taxonomy classifier is unit-tested for all 9 classes.

## 8. Outputs (交付物)

| File | Purpose |
|---|---|
| `decision-benchmark-v1.md` | this specification |
| `decision-benchmark-schema.json` | JSON Schema for samples |
| `metric-definitions.md` | 14 metrics + formulas |
| `failure-taxonomy.md` | 9 failure classes + classification procedure |
| `development-fixtures.jsonl` | development pool (34 samples) |
| `regression-fixtures.jsonl` | regression pool (15 samples) |
| `holdback-construction-plan.md` | holdback/dev/reg construction & anti-leakage |
| `benchmark-integrity-tests/` | deterministic integrity + reference scorer tests |
