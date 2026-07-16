# Attribution assessment

The stratified Secondary Agent Review completed 20/20 records: 5 low, 5
medium, 5 high, and 5 baseline-or-disputed. It is explicitly a non-human,
non-independent review and cannot mutate scores.

The model returned 12 `score_issue` flags. These are not accepted as scoring
defects because their notes predominantly describe answer omissions or
unsupported claims already reflected by the rubric. Three baseline notes also
incorrectly claim that No Memory should use Gold facts, which would violate the
benchmark isolation contract. This is classified as a secondary-review
limitation, not a scoring defect.

The deterministic audit independently recomputed all 105 completed records
from Dataset, Answer, visible evidence IDs/Agents, and Primary Judge input:

- recompute mismatches: 0;
- duplicate completed records: 0;
- invalid citations: 0;
- scoring defects: 0;
- unresolved P0: 0.

Remaining P1: the Secondary Agent Review taxonomy is too permissive around the
meaning of `score_issue`; its flags remain preserved as evidence but do not
override deterministic results.
