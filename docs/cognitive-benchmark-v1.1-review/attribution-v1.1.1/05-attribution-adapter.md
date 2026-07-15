# Attribution Review Adapter v1.1

The model schema no longer contains `old_review_was_correct` or `old_review_error_types`. These fields and `old_review_comparable` are derived locally only after the independent model judgment.

The adapter uses JSON-object structured output, strict keys and enums, documented normalization only, a concrete validation-error repair prompt, three attempts per review, a 60-attempt global limit, and per-review Checkpoint writes.

The final run completed 20/20 logical reviews in 21 physical attempts. One overlong `notes` response was repaired on its second attempt. Failures were zero.
