# Decision Benchmark v1 — Failure Taxonomy (失败分类法)

The benchmark distinguishes nine failure/behavior classes. Each class maps to
metric(s) in `metric-definitions.md` and to `severe_failure_label` values in
the fixtures. The reference judge classifies a response into exactly one class
per sample.

## 1. 正确拒绝 — Correct rejection (right to withhold)

The system refuses to commit **because a decision is genuinely not warranted**:
evidence is insufficient and irreparable by a single question (e.g., two
equal-weight conflicting sources with no tie-breaker), or every option is
infeasible.

- Metric: contributes to Warranted Decisiveness denominator only when the
  refusal is warranted; otherwise it is class 2.
- Fixture signal: `expected == clarify`/`flag_review` with no committed
  decision is the expected outcome; a refusal to commit is NOT penalized.

## 2. 不必要拒绝 — Unnecessary rejection (unwarranted abstention)

The system withholds a decision although the sample had sufficient information
to decide (expected `decide`/`revise`).

- Metric: Unnecessary Abstention Rate.
- `severe_failure_label`: `unwarranted_abstention`.

## 3. 正确澄清 — Correct clarification

The system asks exactly the key question(s) when one key variable is missing
(expected `clarify`), covering `expected_action_detail.clarifying_question` and
asking no more than `max_clarifying_questions`.

- Metric: Clarification Efficiency (true positive).

## 4. 过度追问 — Over-questioning

The system asks questions although information is sufficient (expected
`decide`), or asks more than the allowed number of questions when one was
needed.

- Metric: Clarification Efficiency (false), Actionability (false),
  Warranted Decisiveness (false).
- `severe_failure_label`: `unnecessary_clarification`.

## 5. 正确坚持原决定 — Correct persistence

The system keeps the previous decision when new evidence is insufficient to
overturn it (expected `persist`).

- Metric: Decision Stability (true positive), Revision Precision
  (denominator only when a revision was performed).

## 6. 应修订却未修订 — Should-have-revised-but-didn't

The system keeps the old decision although new evidence, a failed outcome, an
expired fact, or an invalidation warrants a revision (expected `revise` /
`flag_review` with `revision_type`).

- Metric: Revision Recall (false negative).
- `severe_failure_label`: `missed_revision` / `missed_expiry` /
  `missed_invalidation_propagation` (per trigger).

## 7. 不该修订却反复改变 — Shouldn't-have-revised-but-changed (flip-flop)

The system revises (or oscillates) although no revision was warranted: new
evidence was insufficient, or the outcome was good, or the user's override was
already recorded.

- Metric: Revision Precision (false), Decision Stability (false).
- `severe_failure_label`: `flip_flop` / `unsupported_reversal`.

## 8. 明确而正确 — Explicit and correct

The system commits decisively AND the decision is well-justified: it cites
valid evidence, respects hard constraints, acknowledges conflicts/risks, and
its explanation is traceable.

- Metric: Warranted Decisiveness + Evidence Support Rate + Explanation
  Traceability (all true).

## 9. 明确但武断 — Explicit but arbitrary

The system commits decisively but without adequate justification: no valid
evidence cited, ignores a hard constraint, ignores a conflict, or bases the
decision on expired evidence.

- Metric: Decision Accuracy (false), Evidence Support Rate (false),
  Temporal Validity Rate (false), Explanation Traceability (false).
- `severe_failure_label`: `arbitrary_decision` / `hard_constraint_violation` /
  `missed_conflict` (per cause).

---

## Class decision procedure (reference judge)

Given a sample `S` and the system response `R`, the judge classifies:

1. If `R` commits and `R.action == S.expected.action` and candidate matches and
   explanation traceable and no constraint violated → **8**.
2. Else if `R` commits but justification unsupported (no valid evidence /
   constraint violation / missed conflict / arbitrary) → **9**.
3. Else if `R` withholds:
   - expected `decide`/`revise` → **2**;
   - expected `clarify`/`flag_review` → **1**.
4. Else if `R` clarifies:
   - expected `clarify`, ≤ allowed questions, key question covered → **3**;
   - otherwise → **4**.
5. Else if `R` persists:
   - expected `persist` (or `flag_review` without revision) → **5**;
   - expected `revise` → **6**.
6. Else if `R` revises:
   - expected `revise` → warranted (counts toward Revision Recall/Precision);
   - expected `persist`/`flag_review` without revision → **7**.

The taxonomy is deterministic and unit-tested in
`benchmark-integrity-tests/tests/taxonomy.test.mjs`.
